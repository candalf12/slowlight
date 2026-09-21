/* slowlight - land.
 *
 * Islands are anchored to squares of the open sea, not spawned on a timer, so
 * the same seed always sails past the same land wherever it wanders, and a
 * different starting position genuinely sets out from different surroundings.
 * Only the handful of squares near the boat are ever built, and a square is
 * only built once it is far enough out to be wholly lost in the haze, so land
 * arrives out of the distance rather than appearing in it.
 *
 * A site is not one cone. Every blob is an ellipse with a wobbling coastline,
 * and its profile has three parts: the mass, which carries the peaks; an apron
 * outside it, which is where the beach lies; and the fall away into the water.
 * The waterline therefore sits on an almost flat shelf rather than on a slope,
 * which is the whole difference between land with a beach and land without
 * one. Sea stacks are the same blob with the apron taken away, a sandbar is
 * the same blob with the mass taken away, and a headland is the same blob
 * stretched - so there is one shape here, not five.
 *
 * Where the waterline actually falls is measured once, at plan time, by
 * walking twenty-four rays out from the middle of each blob until the ground
 * goes under. Everything that needs to know where the shore is - the surf, the
 * trees, the helm - reads that table rather than guessing from the radius.
 *
 * The helm is the point of all of it. She can run the length of a beach a
 * boat-length off it and nothing will argue with her: land only leans on the
 * course when her course is actually standing into it, and the way only comes
 * off her in the last few metres, so that she never ends up aground.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep, TAU = SL.TAU;

  var CELL = 2000;          /* world units between candidate island sites */
  var REACH = 3200;         /* how far out a site is planned; beyond every haze */
  var RINGS = 26, SECTORS = 40;
  var SHORE_N = 24;         /* rays walked out to find each blob's waterline */

  var SHOAL = 34;           /* how near the beach she has to be to feel it */
  var BERTH = 24;           /* and how much water she means to leave herself */
  /* Where along her present course she looks for the bottom. Sampling the
   * track rather than measuring to the middle of an island is the only thing
   * that works on a shape that is not a circle: a headland's nearest point is
   * nowhere near the bearing of its centre. */
  var PROBE = [22, 48, 80, 118, 160, 206, 256, 310];
  var LOOK = 320;           /* how far off a shore she notices she is standing into it */

  var VERT = [
    'precision highp float;',
    'attribute vec3 aPos;',
    'attribute vec3 aNrm;',
    'attribute vec3 aGnd;',   /* shade, sand, green */
    'uniform mat4 uViewProj;',
    'uniform vec3 uOrigin;',
    'varying vec3 vNrm;',
    'varying vec3 vWorld;',
    'varying vec3 vGnd;',
    'void main() {',
    '  vec3 w = aPos + uOrigin;',
    '  vNrm = aNrm;',
    '  vWorld = w;',
    '  vGnd = aGnd;',
    '  gl_Position = uViewProj * vec4(w, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    SL.GLSL_AIR,
    'varying vec3 vNrm;',
    'varying vec3 vWorld;',
    'varying vec3 vGnd;',
    'uniform vec3 uEye;',
    'uniform float uSun, uSurf;',
    /* Sand, rock and leaf, all struck from the one colour the hour hands us.
     * Tinting and then putting the luminance back is what keeps a beach warm
     * and a wood green without either of them stepping outside the light the
     * rest of the scene is lit by - at four in the morning they are both very
     * nearly blue, and they should be. */
    'vec3 keyed(vec3 base, vec3 w) {',
    '  const vec3 L = vec3(0.299, 0.587, 0.114);',
    '  vec3 c = base * w;',
    '  return c * (dot(base, L) / max(dot(c, L), 1e-4));',
    '}',
    'void main() {',
    '  vec3 N = normalize(vNrm);',
    '  if (!gl_FrontFacing) N = -N;',
    '  vec3 amb = skyColor(normalize(N * 0.6 + vec3(0.0, 0.7, 0.0)), 0.0);',
    '  float sh = vGnd.x;',
    '  vec3 rock = keyed(uIslandC, vec3(1.03, 0.99, 1.01)) * (0.60 + 0.66 * sh);',
    '  vec3 leaf = keyed(uIslandC, vec3(0.79, 1.07, 0.82)) * (0.44 + 0.44 * sh);',
    '  vec3 sand = keyed(uIslandC, vec3(1.26, 1.12, 0.86)) * (1.00 + 0.30 * sh);',
    '  vec3 body = mix(rock, leaf, vGnd.z);',
    '  body = mix(body, sand, vGnd.y);',
    '  float d = max(dot(N, uBodyDir), 0.0);',
    '  vec3 col = body * (0.55 + 0.80 * amb) + uBodyGlow * body * (d * uSun * 0.55);',
    /* Sand the sea has been over is darker than sand it has not. */
    '  float wet = smoothstep(1.2, -0.3, vWorld.y) * smoothstep(-3.6, -0.9, vWorld.y);',
    '  col *= 1.0 - 0.36 * wet * vGnd.y;',
    /* And a lace of broken water along the line itself. */
    '  float lace = smoothstep(1.35, 0.0, abs(vWorld.y - 0.3));',
    '  col = mix(col, uFoam, lace * uSurf);',
    '  col = mix(col, hazeSeam(normalize(vWorld - uEye)), fogAmount(length(vWorld - uEye)));',
    '  col += (dither(gl_FragCoord.xy) - 0.5) * (1.6 / 255.0);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var STRIDE = 9;
  var LAYOUT = [['aPos', 3, 0], ['aNrm', 3, 3], ['aGnd', 3, 6]];

  var EMPTY = { empty: true };

  /* `Sea.heightAt` is the water without the distance falloff the sea's own
   * vertex shader settles the far water with, so past a couple of hundred
   * metres the surface actually drawn sits well below what the CPU reports,
   * and anything laid flat on the sampled height is swallowed by the water it
   * is supposed to be floating on. Taking the swell back out with distance and
   * lifting the thing a little in its place covers it, and at the range where
   * either applies neither is a pixel. `Sea` does not offer this; the day it
   * does, this goes with it. Shared by everything of ours that floats. */
  /* How far what floats is lifted as the swell under it is settled away. A
   * thing lying flat at water level is close to invisible from an eye four
   * metres up looking down about five degrees, so as the water it sits on
   * goes flat, it is raised until it can still be seen. Nothing to do with
   * the falloff itself, which the sea owns. */
  var AFLOAT_LIFT = 1.9;

  function settle(sea, o, dist) {
    /* The sea owns the curve that settles the far water; read it there rather
     * than keeping a second copy of it here. */
    var k = sea.settleAt(dist);
    /* And lift what floats as the swell under it goes away, because a thing
     * lying flat at water level is close to invisible from an eye four metres
     * up looking down about five degrees. */
    o.h = o.h * k + (1 - k) * AFLOAT_LIFT;
    o.gx *= k; o.gz *= k;
    return o;
  }

  /* ---------- a scratch mesh --------------------------------------------
   *
   * Terrain, trees and an arch all end up in one buffer per site, so the land
   * is one draw call however much is standing on it. Normals are accumulated
   * off the faces at the end rather than differentiated per surface, which is
   * the only way a cone of leaves and a ridge of rock can share a pass.
   */

  function Mesh(maxV, maxI) {
    this.pos = new Float32Array(maxV * 3);
    this.gnd = new Float32Array(maxV * 3);
    this.nrm = new Float32Array(maxV * 3);
    this.idx = new Uint16Array(maxI);
    this.nv = 0;
    this.ni = 0;
  }

  Mesh.prototype.vert = function (x, y, z, shade, sand, green) {
    var i = this.nv;
    if ((i + 1) * 3 > this.pos.length) return i - 1;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.gnd[i * 3] = shade; this.gnd[i * 3 + 1] = sand; this.gnd[i * 3 + 2] = green;
    this.nv++;
    return i;
  };

  Mesh.prototype.tri = function (a, b, c) {
    if (this.ni + 3 > this.idx.length) return;
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  };

  Mesh.prototype.quad = function (a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  };

  Mesh.prototype.pack = function () {
    var n = this.nv, p = this.pos, g = this.gnd, nr = this.nrm, idx = this.idx;
    var i, a, b, c;
    /* Area-weighted face normals: the cross product is already twice the area,
     * so nothing has to be normalised until the very end. */
    for (i = 0; i < this.ni; i += 3) {
      a = idx[i] * 3; b = idx[i + 1] * 3; c = idx[i + 2] * 3;
      var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      var vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nr[a] += nx; nr[a + 1] += ny; nr[a + 2] += nz;
      nr[b] += nx; nr[b + 1] += ny; nr[b + 2] += nz;
      nr[c] += nx; nr[c + 1] += ny; nr[c + 2] += nz;
    }
    var out = new Float32Array(n * STRIDE);
    for (i = 0; i < n; i++) {
      var o = i * STRIDE, k = i * 3;
      var l = Math.sqrt(nr[k] * nr[k] + nr[k + 1] * nr[k + 1] + nr[k + 2] * nr[k + 2]);
      if (l < 1e-9) { l = 1; nr[k + 1] = 1; }
      out[o] = p[k]; out[o + 1] = p[k + 1]; out[o + 2] = p[k + 2];
      out[o + 3] = nr[k] / l; out[o + 4] = nr[k + 1] / l; out[o + 5] = nr[k + 2] / l;
      out[o + 6] = g[k]; out[o + 7] = g[k + 1]; out[o + 8] = g[k + 2];
    }
    return out;
  };

  /* ---------- the shape of a blob ---------------------------------------- */

  /* Every blob works in its own round frame; the ellipse and the lie of it are
   * applied on the way out, so the height field never has to know about them. */
  function toWorld(b, ux, uz, out) {
    var ax = ux * b.sx, az = uz * b.sz;
    out[0] = b.dx + ax * b.cs - az * b.sn;
    out[1] = b.dz + ax * b.sn + az * b.cs;
    return out;
  }

  function toBlob(b, lx, lz, out) {
    var px = lx - b.dx, pz = lz - b.dz;
    out[0] = (px * b.cs + pz * b.sn) / b.sx;
    out[1] = (-px * b.sn + pz * b.cs) / b.sz;
    return out;
  }

  /* A coastline that is not an ellipse. Three low harmonics is all it takes
   * for a bay on one side and a point on the other. */
  function wobble(b, ang) {
    return 1 + b.w3 * Math.sin(3 * ang + b.p3)
             + b.w5 * Math.sin(5 * ang - b.p5)
             + 0.024 * Math.sin(8 * ang + b.p3 * 1.7);
  }

  /* Height above the waterline at a point in a blob's own round frame. */
  function blobHeight(b, ux, uz) {
    var rr = Math.sqrt(ux * ux + uz * uz);
    var r = rr / (b.R * wobble(b, Math.atan2(uz, ux)));
    var h = 0;
    for (var i = 0; i < b.peaks.length; i++) {
      var pk = b.peaks[i];
      var ex = (ux - pk.x) / pk.s, ez = (uz - pk.z) / pk.s;
      h += pk.h * Math.exp(-(ex * ex + ez * ez));
    }
    /* Ridges and gullies, so the silhouette is not a smooth dome. */
    h *= 1 + 0.34 * SL.sfbm(ux / b.R * 3.1 + b.grain, uz / b.R * 3.1 + b.grain, 3)
           + 0.16 * SL.sfbm(ux / b.R * 8.7 - b.grain, uz / b.R * 8.7 + b.grain, 2);
    h *= 1 - smoothstep(b.mass0, b.crown, r);
    /* The apron the beach lies on, then the fall away underneath. Give the
     * apron its own roll: a flat one would put the waterline on a perfect
     * curve, and a coast reads like that from the first glance. */
    var apron = (1 - smoothstep(b.crown, b.rim, r)) * b.shelf *
                (1 + 0.34 * SL.sfbm(ux / b.R * 2.3 - b.grain, uz / b.R * 2.3 + b.grain, 2));
    var under = smoothstep(b.rim, 1.30, r) * b.deep;
    return h * b.H + apron - under - b.sea;
  }

  function blobSlope(b, ux, uz, e) {
    var gx = (blobHeight(b, ux + e, uz) - blobHeight(b, ux - e, uz)) / (2 * e);
    var gz = (blobHeight(b, ux, uz + e) - blobHeight(b, ux, uz - e)) / (2 * e);
    return Math.sqrt(gx * gx + gz * gz);
  }

  /* Walk out along each ray until the ground goes under, so that everything
   * downstream can ask where the water actually meets the land rather than
   * inferring it from a radius that no longer means anything once the profile
   * has been reshaped. */
  function measureShore(b) {
    var tab = new Float32Array(SHORE_N);
    var mean = 0, max = 0;
    for (var i = 0; i < SHORE_N; i++) {
      var a = i / SHORE_N * TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      /* Walk in from well outside until the ground comes up, then close on
       * that crossing. Coming in rather than going out matters: the apron has
       * a roll of its own, so a ray can cross the waterline more than once,
       * and the one that counts is the outermost - a bisection over the whole
       * span would happily settle on an inner one and put the surf, the trees
       * and the helm's idea of the beach some way up it. */
      var hi = b.R * 1.34, step = b.R * 0.05, found = -1;
      for (var w = 0; w < 24; w++) {
        var rr = hi - w * step;
        if (rr <= b.R * 0.12) break;
        if (blobHeight(b, ca * rr, sa * rr) > 0) { found = rr; break; }
      }
      if (found < 0) {
        tab[i] = b.R * 0.14;             /* nothing dry on this bearing */
      } else {
        var lo = found, hg = found + step;
        for (var k = 0; k < 12; k++) {
          var mid = (lo + hg) * 0.5;
          if (blobHeight(b, ca * mid, sa * mid) > 0) lo = mid; else hg = mid;
        }
        tab[i] = (lo + hg) * 0.5;
      }
      mean += tab[i];
      if (tab[i] > max) max = tab[i];
    }
    b.shore = tab;
    b.shoreMean = mean / SHORE_N;
    b.shoreMax = max;
  }

  /* How much water there is under a point of the world, in world units clear
   * of this blob's measured waterline; negative means the point is on the
   * land. The outward radial is left in `u[2], u[3]` for whoever needs it. */
  function clearance(b, lx, lz, u) {
    toBlob(b, lx, lz, u);
    var ru = Math.sqrt(u[0] * u[0] + u[1] * u[1]);
    var nx, nz;
    /* Dead in the middle there is no outward direction to be had, so one is
     * chosen: anything at all points out of a blob from its centre. */
    if (ru < 1e-3) { ru = 1e-3; nx = 1; nz = 0; }
    else { nx = u[0] / ru; nz = u[1] / ru; }
    u[2] = nx; u[3] = nz;
    /* One unit of the blob's round frame is this many world units, along the
     * bearing the point happens to lie on. */
    var k = Math.sqrt(nx * nx * b.sx * b.sx + nz * nz * b.sz * b.sz);
    return (ru - shoreAt(b, Math.atan2(nz, nx))) * k;
  }

  function shoreAt(b, ang) {
    var f = (ang / TAU + 1) % 1 * SHORE_N;
    var i = Math.floor(f), t = f - i;
    return lerp(b.shore[i % SHORE_N], b.shore[(i + 1) % SHORE_N], t);
  }

  /* ---------- trees -------------------------------------------------------
   *
   * Small, opaque and solid: nothing here is a cut-out, so a wood reads as a
   * ragged edge against the sky from two kilometres out and as individual
   * trees from fifty metres, without either being a different object.
   */

  var TR = [0, 0];

  function addTrunk(m, x, y, z, lx, ly, lz, w, shade) {
    var a = m.vert(x - w, y, z, shade * 0.5, 0.26, 0.30);
    var b = m.vert(x + w, y, z, shade * 0.5, 0.26, 0.30);
    var c = m.vert(lx + w, ly, lz, shade * 0.7, 0.20, 0.42);
    var d = m.vert(lx - w, ly, lz, shade * 0.7, 0.20, 0.42);
    m.quad(a, b, c, d);
    a = m.vert(x, y, z - w, shade * 0.5, 0.26, 0.30);
    b = m.vert(x, y, z + w, shade * 0.5, 0.26, 0.30);
    c = m.vert(lx, ly, lz + w, shade * 0.7, 0.20, 0.42);
    d = m.vert(lx, ly, lz - w, shade * 0.7, 0.20, 0.42);
    m.quad(a, b, c, d);
  }

  /* A conifer: one six-sided spire. */
  function addSpire(m, x, y, z, h, rad, shade) {
    var top = m.vert(x, y + h, z, shade * 1.15, 0, 1);
    var first = 0, prev = 0;
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * TAU;
      var v = m.vert(x + Math.cos(a) * rad, y, z + Math.sin(a) * rad,
                     shade * 0.62, 0, 1);
      if (i === 0) first = v; else m.tri(top, prev, v);
      prev = v;
    }
    m.tri(top, prev, first);
  }

  /* A broadleaf: two rings of six between a cap and a floor. One ring would be
   * cheaper and would read as a diamond on a stick from any distance at all,
   * which is the one thing a wood must not do. */
  var CROWN_Y = [-0.34, 0.06, 0.52, 1.0];
  var CROWN_R = [0.0, 0.94, 0.80, 0.0];

  function addCrown(m, x, y, z, h, rad, shade) {
    var ring = [0, 0, 0, 0, 0, 0], prev = null, i, k, v;
    for (k = 0; k < 4; k++) {
      var yy = y + h * CROWN_Y[k], rr = rad * CROWN_R[k];
      var sh = shade * (0.46 + 0.62 * (k / 3));
      var cur;
      if (rr < 1e-3) {
        v = m.vert(x, yy, z, sh, 0, 1);
        cur = [v, v, v, v, v, v];
      } else {
        cur = [0, 0, 0, 0, 0, 0];
        for (i = 0; i < 6; i++) {
          var a = i / 6 * TAU + 0.4;
          cur[i] = m.vert(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, sh, 0, 1);
        }
      }
      if (prev) {
        for (i = 0; i < 6; i++) {
          var j = (i + 1) % 6;
          m.quad(prev[i], cur[i], cur[j], prev[j]);
        }
      }
      prev = cur;
      ring = cur;
    }
  }

  /* A palm. Each frond is a blade in three lengths that narrows to a point and
   * falls further the further out it goes, because a frond drawn as one flat
   * shape is a kite on a stick and reads as one from half a mile. */
  function addPalm(m, x, y, z, h, rad, lx, lz, shade) {
    var cx = x + lx * h, cy = y + h, cz = z + lz * h;
    addTrunk(m, x, y, z, cx, cy, cz, 0.24, shade);
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * TAU + lx * 7.0;
      var dx = Math.cos(a), dz = Math.sin(a);
      var px = -dz, pz = dx;
      var p0 = m.vert(cx + px * 0.30, cy + 0.20, cz + pz * 0.30, shade * 1.12, 0, 1);
      var p1 = m.vert(cx - px * 0.30, cy + 0.20, cz - pz * 0.30, shade * 1.12, 0, 1);
      for (var k = 1; k <= 3; k++) {
        var t = k / 3;
        var w = 0.26 * (1 - t) + 0.04;
        var ex = cx + dx * rad * t, ez = cz + dz * rad * t;
        var ey = cy + 0.20 + h * 0.12 * t - h * 0.60 * t * t;
        var n0 = m.vert(ex + px * w, ey, ez + pz * w, shade * (1.06 - t * 0.38), 0, 1);
        var n1 = m.vert(ex - px * w, ey, ez - pz * w, shade * (1.06 - t * 0.38), 0, 1);
        m.quad(p0, n0, n1, p1);
        p0 = n0; p1 = n1;
      }
    }
  }

  function plantTrees(m, b, rnd, count) {
    var placed = 0, tries = count * 4;
    for (var k = 0; k < tries && placed < count; k++) {
      var ang = rnd() * TAU;
      var ru = b.R * Math.sqrt(rnd()) * 0.98;
      var ux = Math.cos(ang) * ru, uz = Math.sin(ang) * ru;
      var y = blobHeight(b, ux, uz);
      if (y < b.treeLow || y > b.treeHigh) continue;
      if (blobSlope(b, ux, uz, 0.8) > 0.70) continue;
      /* Thinner on the crest than in the lee, and thinner as the ground dries
       * back toward the sand. */
      var thin = smoothstep(b.treeLow, b.treeLow + 4.5, y) *
                 (1 - smoothstep(b.treeHigh - 9, b.treeHigh, y) * 0.75);
      if (rnd() > thin) continue;
      toWorld(b, ux, uz, TR);
      var h = lerp(5.0, 10.5, rnd()) * b.treeSize;
      var rad = h * lerp(0.26, 0.40, rnd());
      var shade = 0.55 + rnd() * 0.45;
      if (b.palms && y < b.treeLow + 6.5 && rnd() < 0.72) {
        addPalm(m, TR[0], y - 0.4, TR[1], h * 0.95, rad * 1.9,
                (rnd() - 0.5) * 0.24, (rnd() - 0.5) * 0.24, shade);
      } else if (b.conifer) {
        addTrunk(m, TR[0], y - 0.3, TR[1], TR[0], y + h * 0.30, TR[1], 0.22, shade);
        addSpire(m, TR[0], y + h * 0.16, TR[1], h * 0.90, rad, shade);
      } else {
        addTrunk(m, TR[0], y - 0.3, TR[1], TR[0], y + h * 0.52, TR[1], 0.24, shade);
        addCrown(m, TR[0], y + h * 0.62, TR[1], h * 0.42, rad * 1.15, shade);
      }
      placed++;
    }
  }

  /* ---------- an arch ----------------------------------------------------
   *
   * A stack the sea has been through. It is the one thing here that a height
   * field cannot make, because it needs sky underneath it, so it is built as a
   * ring of boxes swept over a half circle and dropped into the same buffer.
   */

  function addArch(m, a) {
    var N = 11;
    var cs = Math.cos(a.rot), sn = Math.sin(a.rot);
    var ring = [0, 0, 0, 0];
    var prev = null;
    for (var i = 0; i <= N; i++) {
      var ph = i / N * Math.PI;
      var cu = Math.cos(ph), cv = Math.sin(ph);
      /* Thicker at the feet than at the crown, the way the sea leaves them. */
      var th = a.th * (1 + (1 - cv) * 0.55);
      var cur = [0, 0, 0, 0];
      for (var q = 0; q < 4; q++) {
        var su = (q === 0 || q === 3) ? -1 : 1;     /* along the arch's radius */
        var sv = (q < 2) ? -1 : 1;                  /* across its thickness */
        var u = cu * (a.r + su * th * 0.5);
        var y = cv * (a.r + su * th * 0.5) + a.base;
        var n = sv * a.depth * 0.5;
        var shade = 0.40 + 0.40 * cv + 0.18 * su;
        cur[q] = m.vert(a.x + u * cs - n * sn, y, a.z + u * sn + n * cs,
                        shade, y < 2.2 ? 0.30 : 0.0, 0);
      }
      if (prev) {
        m.quad(prev[0], cur[0], cur[1], prev[1]);
        m.quad(prev[1], cur[1], cur[2], prev[2]);
        m.quad(prev[2], cur[2], cur[3], prev[3]);
        m.quad(prev[3], cur[3], cur[0], prev[0]);
      } else {
        m.quad(cur[3], cur[2], cur[1], cur[0]);
      }
      prev = cur;
      ring = cur;
    }
    m.quad(ring[0], ring[1], ring[2], ring[3]);
  }

  /* ---------- planning a site -------------------------------------------- */

  function Islands(world) {
    this.world = world;
    this.cache = Object.create(null);
    this.live = [];
    this.gl = null;
    this._u = [0, 0];
    this._m = [0, 0];
  }

  /* Blob shapes. One profile with five sets of numbers on it: the mass carries
   * the peaks, the apron carries the beach, and taking either away is the
   * difference between a mountain, a spit of sand and a stack of rock. */
  function shapeBlob(b, kind, v, sub) {
    b.mass0 = 0.30; b.crown = 0.64; b.rim = 1.00;
    b.shelf = 7.0; b.sea = 1.9; b.deep = 16;
    b.w3 = 0.055 + v('w3', sub) * 0.065;
    b.w5 = 0.020 + v('w5', sub) * 0.045;
    b.p3 = v('p3', sub) * TAU;
    b.p5 = v('p5', sub) * TAU;
    if (kind === 'stack') {
      /* Sheer to the water: no apron, so there is no beach to stand on. */
      b.mass0 = 0.52; b.crown = 0.94; b.rim = 1.02;
      b.shelf = 0.7; b.sea = 0.35; b.deep = 12;
      b.w3 *= 1.6;
    } else if (kind === 'bar') {
      /* Almost all apron: a low tongue of sand with a green spine. */
      b.mass0 = 0.18; b.crown = 0.50; b.rim = 1.06;
      b.shelf = 4.2; b.sea = 1.5; b.deep = 10;
    }
  }

  Islands.prototype.plan = function (i, j) {
    var w = this.world;
    function v(n, salt) { return w.cell2('isle2/' + n, i, j, salt || 0); }
    if (v('exists') > 0.42) return EMPTY;

    /* What sort of place this is. Most land is ordinary land; the rest is
     * what makes finding some of it worth the watching. */
    var kv = v('kind');
    var form = kv < 0.40 ? 'peak' : kv < 0.62 ? 'headland' :
               kv < 0.78 ? 'cove' : kv < 0.91 ? 'bar' : 'stacks';

    var cx = (i + v('ox') * 0.74 + 0.13) * CELL;
    var cz = (j + v('oz') * 0.74 + 0.13) * CELL;
    var lean = v('lie') * TAU;
    var green = clamp(0.15 + v('green') * 1.15, 0, 1);
    var conifer = v('wood') < 0.44;
    var palms = green > 0.35 && v('palm') < 0.34;

    var main = [];
    if (form === 'cove') main = ['land', 'land'];
    else if (form === 'stacks') main = ['stack', 'stack', 'stack'];
    else main = ['land'];
    /* A second, smaller head of land next to the first, often enough that the
     * eye is not always met by a single mound. */
    if (main.length === 1 && v('twin') < 0.42) main.push('land');
    /* And outliers: rock the sea has left standing off the point. */
    var stacks = v('stacks') < 0.46 ? 1 + Math.floor(v('stacks2') * 3) : 0;
    for (var q = 0; q < stacks; q++) main.push('stack');

    var spread = lerp(260, 720, v('spread'));
    var blobs = [];
    for (var n = 0; n < main.length; n++) {
      var sub = n * 101 + 7;
      var kind = main[n];
      var first = n === 0;
      var b = { kind: kind };

      if (kind === 'stack') {
        b.R = lerp(16, 42, v('sr', sub));
        b.H = b.R * lerp(0.80, 1.70, v('sh', sub));
        b.sx = lerp(0.78, 1.28, v('ss', sub));
      } else if (form === 'bar') {
        b.R = lerp(190, 330, v('r', sub)) * (first ? 1 : 0.55);
        b.H = b.R * lerp(0.035, 0.070, v('h', sub));
        b.sx = lerp(1.35, 2.30, v('ax', sub));
      } else if (form === 'headland') {
        b.R = lerp(150, 260, v('r', sub)) * (first ? 1 : lerp(0.4, 0.7, v('r2', sub)));
        b.H = b.R * lerp(0.14, 0.26, v('h', sub));
        b.sx = lerp(1.55, 2.45, v('ax', sub));
      } else {
        b.R = lerp(105, 250, v('r', sub)) * (first ? 1 : lerp(0.42, 0.74, v('r2', sub)));
        b.H = b.R * lerp(0.15, 0.40, v('h', sub)) * lerp(0.82, 1.22, v('h2', sub));
        b.sx = lerp(0.85, 1.55, v('ax', sub));
      }
      b.sz = 1 / b.sx;                        /* the ellipse keeps its area */
      var rot = lean + (first ? 0 : (v('rot', sub) - 0.5) * 1.5);
      b.cs = Math.cos(rot); b.sn = Math.sin(rot);

      /* Where it sits, relative to the site. The parts of a cove face each
       * other across a bay; everything else is scattered. */
      if (first) { b.dx = 0; b.dz = 0; }
      else if (form === 'cove' && n === 1) {
        var ca = lean + 0.5;
        b.dx = Math.cos(ca) * blobs[0].R * 1.28;
        b.dz = Math.sin(ca) * blobs[0].R * 1.28;
      } else if (kind === 'stack') {
        var sa = v('sa', sub) * TAU;
        var sd = blobs[0].R * lerp(1.05, 1.9, v('sd', sub));
        b.dx = Math.cos(sa) * sd;
        b.dz = Math.sin(sa) * sd;
      } else {
        b.dx = (v('bx', sub) - 0.5) * spread;
        b.dz = (v('bz', sub) - 0.5) * spread;
      }

      var peaks = [];
      var np = kind === 'stack' ? 1 : 1 + Math.floor(v('np', sub) * 3);
      for (var k = 0; k < np; k++) {
        var pa = v('pa', sub + k * 13) * TAU;
        var pr = v('pr', sub + k * 17) * b.R * 0.42;
        peaks.push({
          x: Math.cos(pa) * pr, z: Math.sin(pa) * pr,
          h: kind === 'stack' ? 1 : lerp(0.32, 1.0, v('ph', sub + k * 19)),
          s: b.R * lerp(0.20, 0.48, v('ps', sub + k * 23))
        });
      }
      var maxh = 0;
      for (var p = 0; p < peaks.length; p++) maxh = Math.max(maxh, peaks[p].h);
      b.peaks = peaks;
      b.H = b.H / maxh;
      b.grain = v('grain', sub) * 40 + 3;
      shapeBlob(b, kind === 'stack' ? 'stack' : (form === 'bar' ? 'bar' : 'land'), v, sub);
      measureShore(b);

      /* What grows on it. Stacks carry nothing but a little weather-burnt
       * green; a sandbar carries a thin line of palms down its spine. */
      b.conifer = conifer;
      b.palms = palms && form !== 'stacks';
      b.treeLow = kind === 'stack' ? 4.0 : (form === 'bar' ? 1.6 : 2.4);
      b.treeHigh = b.H + b.shelf;
      b.treeSize = kind === 'stack' ? 0.55 : lerp(0.82, 1.15, v('tsz', sub));
      /* A wood covers ground, so a big island carries more of it than a small
       * one rather than the same scatter spread thinner. */
      b.trees = kind === 'stack' ? Math.round(green * 5)
                : Math.round(green * lerp(34, 78, v('tn', sub)) *
                             clamp(b.R / 150, 0.5, 2.1) * (first ? 1 : 0.6));
      blobs.push(b);
    }

    /* An arch, now and then, against the outermost stack. */
    var arch = null;
    if (v('arch') < 0.30) {
      for (var a = blobs.length - 1; a >= 0; a--) {
        if (blobs[a].kind !== 'stack') continue;
        var ab = blobs[a];
        var aa = v('archa') * TAU;
        var ar = lerp(11, 22, v('archr'));
        arch = {
          x: ab.dx + Math.cos(aa) * (ab.R * ab.sx + ar * 0.9),
          z: ab.dz + Math.sin(aa) * (ab.R * ab.sz + ar * 0.9),
          r: ar, th: ar * lerp(0.26, 0.42, v('archt')),
          depth: ar * lerp(0.42, 0.70, v('archd')),
          rot: v('archrot') * TAU, base: -4.5
        };
        break;
      }
    }

    var radius = 0;
    for (var m2 = 0; m2 < blobs.length; m2++) {
      var bm = blobs[m2];
      var reach = Math.sqrt(bm.dx * bm.dx + bm.dz * bm.dz) +
                  bm.shoreMax * Math.max(bm.sx, bm.sz);
      if (reach > radius) radius = reach;
    }

    return { empty: false, x: cx, z: cz, form: form, blobs: blobs, arch: arch,
             radius: radius, rseed: (v('rnd') * 4294967295) >>> 0,
             vbo: null, ibo: null, count: 0 };
  };

  /* ---------- building it ------------------------------------------------ */

  Islands.prototype.build = function (isle) {
    var gl = this.gl;
    var blobs = isle.blobs;
    var per = RINGS * SECTORS;
    var trees = 0, b, i, j;
    for (b = 0; b < blobs.length; b++) trees += blobs[b].trees;
    /* The largest tree is a palm: 5 fronds of 6 vertices plus a crossed trunk. */
    var maxV = blobs.length * per + trees * 56 + 56;
    var maxI = blobs.length * (RINGS - 1) * SECTORS * 6 + trees * 110 + 320;
    var m = new Mesh(maxV, maxI);
    var rnd = SL.mulberry32(isle.rseed);
    var xz = [0, 0];

    for (b = 0; b < blobs.length; b++) {
      var bl = blobs[b];
      var base = m.nv;
      for (i = 0; i < RINGS; i++) {
        /* Rings crowd toward the outside, where the beach and the surf are. */
        var ru = bl.R * 1.28 * Math.pow(i / (RINGS - 1), 0.72);
        for (j = 0; j < SECTORS; j++) {
          var a = j / SECTORS * TAU;
          var ux = Math.cos(a) * ru, uz = Math.sin(a) * ru;
          var y = blobHeight(bl, ux, uz);
          var slope = blobSlope(bl, ux, uz, 0.7);
          toWorld(bl, ux, uz, xz);
          /* What the ground is made of: sand low and flat, leaf above it where
           * it is gentle, bare rock on anything steep or high. */
          var sand = smoothstep(2.5, 0.2, y) * (1 - smoothstep(0.26, 0.66, slope));
          var leafy = smoothstep(1.6, 5.0, y) * (1 - smoothstep(0.38, 0.86, slope));
          var green = clamp(leafy * bl.trees * 0.045, 0, 1) * (1 - sand * 0.7);
          var shade = clamp(0.30 + y / Math.max(bl.H, 1) * 0.80 - slope * 0.42 +
                            0.12 * SL.sfbm(ux * 0.07 + bl.grain, uz * 0.07, 2), 0, 1.25);
          m.vert(xz[0], y, xz[1], shade, sand, green);
        }
      }
      for (i = 0; i < RINGS - 1; i++) {
        for (j = 0; j < SECTORS; j++) {
          var j1 = (j + 1) % SECTORS;
          var p0 = base + i * SECTORS + j, p1 = base + i * SECTORS + j1;
          var p2 = base + (i + 1) * SECTORS + j, p3 = base + (i + 1) * SECTORS + j1;
          m.tri(p0, p2, p3);
          m.tri(p0, p3, p1);
        }
      }
      if (bl.trees > 0) plantTrees(m, bl, rnd, bl.trees);
    }
    if (isle.arch) addArch(m, isle.arch);

    var verts = m.pack();
    isle.vbo = SL.glBuffer(gl, gl.ARRAY_BUFFER, verts);
    isle.ibo = SL.glBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, m.idx.subarray(0, m.ni));
    isle.count = m.ni;
  };

  Islands.prototype.init = function (gl) {
    this.gl = gl;
    this.prog = SL.glProgram(gl, VERT, FRAG);
  };

  /* After a lost context every buffer is gone; the land itself is not, so the
   * squares are simply forgotten and built again as they come round. */
  Islands.prototype.reset = function () {
    this.cache = Object.create(null);
    this.live.length = 0;
  };

  Islands.prototype.release = function (isle) {
    if (!isle || isle.empty || !isle.vbo) return;
    this.gl.deleteBuffer(isle.vbo);
    this.gl.deleteBuffer(isle.ibo);
    isle.vbo = null; isle.ibo = null; isle.count = 0;
  };

  /* Bring the squares around the boat up to date. Where the land is, is known
   * as soon as a square comes into range; the mesh for it is built one per
   * frame at most, so arriving somewhere new never costs a stutter. */
  Islands.prototype.update = function (s) {
    var i0 = Math.floor((s.worldX - REACH) / CELL), i1 = Math.floor((s.worldX + REACH) / CELL);
    var j0 = Math.floor((s.worldZ - REACH) / CELL), j1 = Math.floor((s.worldZ + REACH) / CELL);
    var live = this.live;
    live.length = 0;
    var want = null, wantD = Infinity;
    for (var i = i0; i <= i1; i++) {
      for (var j = j0; j <= j1; j++) {
        var key = (i + 1048576) * 2097152 + (j + 1048576);
        var isle = this.cache[key];
        if (isle === undefined) isle = this.cache[key] = this.plan(i, j);
        if (isle.empty) continue;
        var dx = isle.x - s.worldX, dz = isle.z - s.worldZ;
        var d2 = dx * dx + dz * dz;
        if (d2 > REACH * REACH) continue;
        live.push(isle);
        if (!isle.vbo && d2 < wantD) { want = isle; wantD = d2; }
      }
    }
    if (want && this.gl && !s.warming) this.build(want);
    this.prune(i0 - 1, i1 + 1, j0 - 1, j1 + 1);
  };

  Islands.prototype.prune = function (i0, i1, j0, j1) {
    for (var key in this.cache) {
      var k = +key;
      var i = Math.floor(k / 2097152) - 1048576;
      var j = (k % 2097152) - 1048576;
      if (i < i0 || i > i1 || j < j0 || j > j1) {
        this.release(this.cache[key]);
        delete this.cache[key];
      }
    }
  };

  /* ---------- the helm's share of it -------------------------------------
   *
   * Two quite separate things, and keeping them separate is the whole point.
   *
   * `lead` is the long one: it is only ever non-zero when her present course
   * actually passes inside a shore, and it falls to nothing the moment her
   * track clears it. Running the length of a beach a boat-length off it never
   * raises it at all, which is what lets her sail close and enjoy it.
   *
   * `near` is the short one: the last forty metres, where the shore itself
   * pushes. It carries a true outward direction, not a tangent, so what it
   * produces is a departure and not an orbit - steering round a circle you are
   * already inside is how a boat gets kept there. It exists so she is never
   * aground, and if the first one has done its work it never fires at all.
   *
   * `clear` is the least signed distance to any shore, in world units, so the
   * helm can tell touching from merely close.
   */
  Islands.prototype.avoid = function (x, z, hx, hz, out) {
    out.near = 0; out.nx = 1; out.nz = 0; out.lead = 0; out.side = 0;
    out.clear = Infinity;
    var live = this.live, u = this._u, m = this._m;
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      var rx = isle.x - x, rz = isle.z - z;
      var far = isle.radius + LOOK + SHOAL;
      if (rx * rx + rz * rz > far * far) continue;
      for (var b = 0; b < isle.blobs.length; b++) {
        var bl = isle.blobs[b];

        /* Where she is. The shore that matters is the one she has least water
         * under her from, and the way out is that shore's way out - picking it
         * by anything else lets two overlapping blobs hand her a direction
         * that takes her deeper into the other one. */
        var here = clearance(bl, x - isle.x, z - isle.z, u);
        if (here < out.clear) {
          out.clear = here;
          out.near = 1 - clamp(here / SHOAL, 0, 1);
          var ox = u[2] * bl.sx * bl.cs - u[3] * bl.sz * bl.sn;
          var oz = u[2] * bl.sx * bl.sn + u[3] * bl.sz * bl.cs;
          var ol = Math.sqrt(ox * ox + oz * oz) || 1;
          out.nx = ox / ol; out.nz = oz / ol;
        }

        /* And where this course would take her. The worst of it, weighted by
         * how soon it comes: something shallow a long way ahead is worth a
         * hand on the helm now, and something shallow close to is worth more. */
        var best = 0;
        for (var q = 0; q < PROBE.length; q++) {
          var d = PROBE[q];
          var c = clearance(bl, x + hx * d - isle.x, z + hz * d - isle.z, m);
          if (c >= BERTH) continue;
          var l = clamp(1 - c / BERTH, 0, 1.4) * (1 - d / LOOK);
          if (l > best) best = l;
        }
        if (best > out.lead) {
          out.lead = best;
          /* Round the way that opens the water, which is away from the middle
           * of what is in her road. */
          var tx = isle.x + bl.dx - x, tz = isle.z + bl.dz - z;
          out.side = (tx * hz - tz * hx) >= 0 ? -1 : 1;
        }
      }
    }
    return out;
  };

  /* The least water under a point, over every shore in range. The helm uses
   * it to check a step before taking it, in the rare case where she has
   * touched and any movement at all could still be the wrong movement. */
  Islands.prototype.clearAt = function (x, z) {
    var live = this.live, u = this._u, best = Infinity;
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      var rx = isle.x - x, rz = isle.z - z;
      var far = isle.radius + SHOAL;
      if (rx * rx + rz * rz > far * far) continue;
      for (var b = 0; b < isle.blobs.length; b++) {
        var c = clearance(isle.blobs[b], x - isle.x, z - isle.z, u);
        if (c < best) best = c;
      }
    }
    return best;
  };

  /* ---------- drawing ---------------------------------------------------- */

  Islands.prototype.draw = function (gl, s) {
    var live = this.live;
    if (!live.length) return;
    var p = this.prog, u = p.u;
    /* Past this the haze has taken everything but a thousandth of the colour,
     * so there is nothing there to draw. */
    var cut = s.fogD * 2.6;
    gl.useProgram(p.p);
    SL.setAir(gl, p, s);
    gl.uniformMatrix4fv(u.uViewProj, false, s.viewProj);
    gl.uniform3f(u.uEye, s.eyeX, s.eyeY, s.eyeZ);
    gl.uniform1f(u.uSun, s.body.vis * (s.body.isMoon ? 0.35 : 1) * lerp(0.2, 1, s.pal.light));
    gl.uniform1f(u.uSurf, (0.20 + s.pal.light * 0.28) * clamp(0.4 + s.wind, 0, 1.3));
    var drawn = 0;
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      if (!isle.count) continue;
      var dx = isle.x - s.worldX, dz = isle.z - s.worldZ;
      if (Math.sqrt(dx * dx + dz * dz) - isle.radius > cut) continue;
      gl.uniform3f(u.uOrigin, isle.x - s.orgX, 0, isle.z - s.orgZ);
      gl.bindBuffer(gl.ARRAY_BUFFER, isle.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, isle.ibo);
      SL.glAttribs(gl, p, STRIDE, LAYOUT);
      gl.drawElements(gl.TRIANGLES, isle.count, gl.UNSIGNED_SHORT, 0);
      drawn++;
    }
    if (drawn) SL.glDisableAttribs(gl, p, LAYOUT);
  };

  /* A ring of broken water round every shore near enough to hear, drawn on the
   * sea itself and laid along the measured waterline, so it follows a bay in
   * and a point out instead of ringing a circle nothing is inside. */
  Islands.prototype.drawSurf = function (batch, sea, s) {
    var live = this.live;
    var foam = s.pal.foam;
    var fr = foam[0] / 255, fg = foam[1] / 255, fb = foam[2] / 255;
    var light = 0.20 + s.pal.light * 0.42;
    var wind = clamp(0.5 + s.wind, 0, 1.2);
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      if (!isle.count) continue;
      var ddx = isle.x - s.worldX, ddz = isle.z - s.worldZ;
      if (ddx * ddx + ddz * ddz > 980 * 980) continue;
      for (var b = 0; b < isle.blobs.length; b++) {
        var bl = isle.blobs[b];
        var cx = isle.x - s.orgX + bl.dx, cz = isle.z - s.orgZ + bl.dz;
        var n = bl.kind === 'stack' ? 20 : 52;
        /* One settle for the whole ring: it is a band round a shore a long way
         * off, and the far water under it is all at much the same range. */
        var rx = cx - s.eyeX, rz = cz - s.eyeZ;
        var kk = sea.settleAt(Math.sqrt(rx * rx + rz * rz));
        var px = 0, pz = 0, pox = 0, poz = 0, py = 0, pa = 0, has = false;
        for (var k = 0; k <= n; k++) {
          var a = k / n * TAU;
          var pulse = 0.5 + 0.5 * Math.sin(s.t * 0.72 + a * 3.4 + bl.grain);
          var sr = shoreAt(bl, a) + 1.4 + pulse * 2.8;
          var ca = Math.cos(a), sa = Math.sin(a);
          var ux = ca * sr, uz = sa * sr;
          var ax = ux * bl.sx, az = uz * bl.sz;
          var wx = cx + ax * bl.cs - az * bl.sn;
          var wz = cz + ax * bl.sn + az * bl.cs;
          /* The band lies across the shore, so it has to be widened along the
           * mapped radial rather than the one in the blob's round frame. */
          var ox = ca * bl.sx * bl.cs - sa * bl.sz * bl.sn;
          var oz = ca * bl.sx * bl.sn + sa * bl.sz * bl.cs;
          var ol = Math.sqrt(ox * ox + oz * oz) || 1;
          var w = 6.5 + pulse * 6.0;
          ox = ox / ol * w; oz = oz / ol * w;
          var y = sea.heightAt(wx, wz, s.t) * kk + 0.12 + (1 - kk) * AFLOAT_LIFT;
          var al = clamp(light * (0.34 + pulse * 0.62) * wind, 0, 0.58);
          if (has && (pa > 0.02 || al > 0.02)) {
            batch.quad(px - pox, py, pz - poz, wx - ox, y, wz - oz,
                       wx + ox, y, wz + oz, px + pox, py, pz + poz,
                       0.5, 0.05, 0.5, 0.95, fr, fg, fb, (pa + al) * 0.5);
          }
          px = wx; pz = wz; py = y; pox = ox; poz = oz; pa = al; has = true;
        }
      }
    }
  };

  /* What is under a point of open water, for anything that wants to sit in the
   * shallows rather than out in the deep: 0 out at sea, 1 on the beach. */
  Islands.prototype.shallow = function (x, z) {
    var live = this.live, u = this._u, best = 0;
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      var rx = isle.x - x, rz = isle.z - z;
      var far = isle.radius + 260;
      if (rx * rx + rz * rz > far * far) continue;
      for (var b = 0; b < isle.blobs.length; b++) {
        var bl = isle.blobs[b];
        toBlob(bl, x - isle.x, z - isle.z, u);
        var ru = Math.sqrt(u[0] * u[0] + u[1] * u[1]);
        if (ru < 1e-4) ru = 1e-4;
        var nxu = u[0] / ru, nzu = u[1] / ru;
        var k = Math.sqrt(nxu * nxu * bl.sx * bl.sx + nzu * nzu * bl.sz * bl.sz);
        var clear = (ru - shoreAt(bl, Math.atan2(u[1], u[0]))) * k;
        var v = 1 - clamp(clear / 240, 0, 1);
        if (v > best) best = v;
      }
    }
    return best;
  };

  SL.settleAfloat = settle;
  SL.Islands = Islands;
  SL.ISLAND_CELL = CELL;
})(window.SL);
