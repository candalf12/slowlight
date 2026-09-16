/* slowlight — land.
 *
 * Islands are anchored to squares of the open sea, not spawned on a timer, so
 * the same seed always sails past the same land wherever it wanders, and a
 * different starting position genuinely sets out from different surroundings.
 * Only the handful of squares near the boat are ever built, and a square is
 * only built once it is far enough out to be wholly lost in the haze, so land
 * arrives out of the distance rather than appearing in it.
 *
 * The boat can sail right up to one. It will not sail into one: the shore
 * pushes gently on the course and takes the way off her, the way she avoids
 * everything else — by easing, not by stopping.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep, TAU = SL.TAU;

  var CELL = 3800;          /* world units between candidate island sites */
  var REACH = 2700;         /* how far out a site is built */
  var RINGS = 26, SECTORS = 40;

  var VERT = [
    'precision highp float;',
    'attribute vec3 aPos;',
    'attribute vec3 aNrm;',
    'attribute float aShade;',
    'uniform mat4 uViewProj;',
    'uniform vec3 uOrigin;',
    'varying vec3 vNrm;',
    'varying vec3 vWorld;',
    'varying float vShade;',
    'void main() {',
    '  vec3 w = aPos + uOrigin;',
    '  vNrm = aNrm;',
    '  vWorld = w;',
    '  vShade = aShade;',
    '  gl_Position = uViewProj * vec4(w, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    SL.GLSL_AIR,
    'varying vec3 vNrm;',
    'varying vec3 vWorld;',
    'varying float vShade;',
    'uniform vec3 uEye;',
    'uniform float uSun, uSurf;',
    'void main() {',
    '  vec3 N = normalize(vNrm);',
    '  if (!gl_FrontFacing) N = -N;',
    '  vec3 amb = skyColor(normalize(N * 0.6 + vec3(0.0, 0.7, 0.0)), 0.0);',
    /* Land is a stain the colour of the hour, lifted where it catches light. */
    '  vec3 body = uIslandC * (0.62 + 0.62 * vShade);',
    '  float d = max(dot(N, uBodyDir), 0.0);',
    '  vec3 col = body * (0.55 + 0.80 * amb) + uBodyGlow * body * (d * uSun * 0.55);',
    /* The shore: a soft band of broken water where the land meets the sea. */
    '  float band = smoothstep(2.2, 0.0, vWorld.y) * smoothstep(-2.0, -0.2, vWorld.y);',
    '  col = mix(col, uFoam, band * uSurf);',
    '  col = mix(col, hazeSeam(normalize(vWorld - uEye)), fogAmount(length(vWorld - uEye)));',
    '  col += (dither(gl_FragCoord.xy) - 0.5) * (1.6 / 255.0);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var LAYOUT = [['aPos', 3, 0], ['aNrm', 3, 3], ['aShade', 1, 6]];

  var EMPTY = { empty: true };

  function Islands(world) {
    this.world = world;
    this.cache = Object.create(null);
    this.live = [];
    this.pending = [];
    this.gl = null;
  }

  /* A site is a pure function of (seed, i, j): what is there, and where. */
  Islands.prototype.plan = function (i, j) {
    var w = this.world;
    function v(n, salt) { return w.cell2('isle/' + n, i, j, salt || 0); }
    if (v('exists') > 0.34) return EMPTY;

    var count = v('count') < 0.30 ? (v('count2') < 0.45 ? 3 : 2) : 1;
    var cx = (i + v('ox') * 0.7 + 0.15) * CELL;
    var cz = (j + v('oz') * 0.7 + 0.15) * CELL;
    var spread = lerp(220, 640, v('spread'));
    var blobs = [];
    for (var b = 0; b < count; b++) {
      var sub = b * 101 + 7;
      var main = b === 0;
      var R = lerp(110, 270, v('r', sub)) * (main ? 1 : lerp(0.34, 0.68, v('r2', sub)));
      var H = R * lerp(0.13, 0.34, v('h', sub)) * lerp(0.8, 1.25, v('h2', sub));
      var peaks = [];
      var np = 1 + Math.floor(v('np', sub) * 3);
      for (var k = 0; k < np; k++) {
        var ang = v('pa', sub + k * 13) * TAU;
        var rad = v('pr', sub + k * 17) * R * 0.46;
        peaks.push({
          x: Math.cos(ang) * rad, z: Math.sin(ang) * rad,
          h: lerp(0.30, 1.0, v('ph', sub + k * 19)),
          s: R * lerp(0.18, 0.46, v('ps', sub + k * 23))
        });
      }
      var maxh = 0;
      for (var q = 0; q < peaks.length; q++) maxh = Math.max(maxh, peaks[q].h);
      blobs.push({
        dx: main ? 0 : (v('bx', sub) - 0.5) * spread,
        dz: main ? 0 : (v('bz', sub) - 0.5) * spread,
        R: R, H: H / maxh,
        peaks: peaks,
        grain: v('grain', sub) * 40 + 3
      });
    }
    var radius = 0;
    for (var m = 0; m < blobs.length; m++) {
      var bm = blobs[m];
      radius = Math.max(radius, Math.sqrt(bm.dx * bm.dx + bm.dz * bm.dz) + bm.R);
    }
    return { empty: false, x: cx, z: cz, blobs: blobs, radius: radius,
             vbo: null, ibo: null, count: 0 };
  };

  /* Height above the waterline at a point in a blob's own frame. Sinks below
   * it well inside the outer ring, so land always ends under water. */
  function blobHeight(b, dx, dz) {
    var h = 0;
    for (var i = 0; i < b.peaks.length; i++) {
      var pk = b.peaks[i];
      var ex = (dx - pk.x) / pk.s, ez = (dz - pk.z) / pk.s;
      h += pk.h * Math.exp(-(ex * ex + ez * ez));
    }
    var r = Math.sqrt(dx * dx + dz * dz) / b.R;
    /* Ridges and gullies, so the silhouette is not a smooth dome. */
    h *= 1 + 0.34 * SL.sfbm(dx / b.R * 3.1 + b.grain, dz / b.R * 3.1 + b.grain, 3)
           + 0.16 * SL.sfbm(dx / b.R * 8.7 - b.grain, dz / b.R * 8.7 + b.grain, 2);
    h *= 1 - smoothstep(0.46, 1.0, r);
    return h * b.H - 5.5 * smoothstep(0.66, 1.02, r);
  }

  Islands.prototype.build = function (isle) {
    var gl = this.gl;
    var blobs = isle.blobs;
    var per = RINGS * SECTORS;
    var verts = new Float32Array(blobs.length * per * 7);
    var idx = new Uint16Array(blobs.length * (RINGS - 1) * SECTORS * 6);
    var ix = 0;
    for (var b = 0; b < blobs.length; b++) {
      var bl = blobs[b];
      var base = b * per;
      for (var i = 0; i < RINGS; i++) {
        var r = bl.R * Math.pow(i / (RINGS - 1), 1.12);
        for (var j = 0; j < SECTORS; j++) {
          var a = j / SECTORS * TAU;
          var dx = Math.cos(a) * r, dz = Math.sin(a) * r;
          var y = blobHeight(bl, dx, dz);
          /* Slope and height decide what the ground is made of. */
          var e = 0.6;
          var gx = (blobHeight(bl, dx + e, dz) - blobHeight(bl, dx - e, dz)) / (2 * e);
          var gz = (blobHeight(bl, dx, dz + e) - blobHeight(bl, dx, dz - e)) / (2 * e);
          var nl = Math.sqrt(gx * gx + gz * gz + 1);
          var o = (base + i * SECTORS + j) * 7;
          verts[o] = bl.dx + dx; verts[o + 1] = y; verts[o + 2] = bl.dz + dz;
          verts[o + 3] = -gx / nl; verts[o + 4] = 1 / nl; verts[o + 5] = -gz / nl;
          verts[o + 6] = clamp(0.25 + y / Math.max(bl.H, 1) * 0.85 -
                               Math.sqrt(gx * gx + gz * gz) * 0.35, 0, 1);
        }
      }
      for (i = 0; i < RINGS - 1; i++) {
        for (j = 0; j < SECTORS; j++) {
          var j1 = (j + 1) % SECTORS;
          var p0 = base + i * SECTORS + j, p1 = base + i * SECTORS + j1;
          var p2 = base + (i + 1) * SECTORS + j, p3 = base + (i + 1) * SECTORS + j1;
          idx[ix++] = p0; idx[ix++] = p2; idx[ix++] = p3;
          idx[ix++] = p0; idx[ix++] = p3; idx[ix++] = p1;
        }
      }
    }
    isle.vbo = SL.glBuffer(gl, gl.ARRAY_BUFFER, verts);
    isle.ibo = SL.glBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, idx);
    isle.count = ix;
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
        if (d2 > (REACH + CELL) * (REACH + CELL)) continue;
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

  /* How hard the nearest shore is pushing, and which way. Writes into `out`. */
  Islands.prototype.avoid = function (x, z, out) {
    out.push = 0; out.dx = 0; out.dz = 0; out.depth = 1;
    var live = this.live;
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      var bx = isle.x - x, bz = isle.z - z;
      if (bx * bx + bz * bz > (isle.radius + 320) * (isle.radius + 320)) continue;
      for (var b = 0; b < isle.blobs.length; b++) {
        var bl = isle.blobs[b];
        var dx = x - (isle.x + bl.dx), dz = z - (isle.z + bl.dz);
        var d = Math.sqrt(dx * dx + dz * dz);
        /* The shoal reaches a little further out than the land does. */
        var safe = bl.R * 0.86 + 34;
        if (d > safe || d < 1e-3) continue;
        var f = 1 - d / safe;
        if (f > out.push) {
          out.push = f;
          out.dx = dx / d; out.dz = dz / d;
        }
      }
    }
    out.depth = 1 - out.push;
    return out;
  };

  Islands.prototype.draw = function (gl, s) {
    var live = this.live;
    if (!live.length) return;
    var p = this.prog, u = p.u;
    gl.useProgram(p.p);
    SL.setAir(gl, p, s);
    gl.uniformMatrix4fv(u.uViewProj, false, s.viewProj);
    gl.uniform3f(u.uEye, s.eyeX, s.eyeY, s.eyeZ);
    gl.uniform1f(u.uSun, s.body.vis * (s.body.isMoon ? 0.35 : 1) * lerp(0.2, 1, s.pal.light));
    gl.uniform1f(u.uSurf, (0.20 + s.pal.light * 0.28) * clamp(0.4 + s.wind, 0, 1.3));
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      if (!isle.count) continue;
      gl.uniform3f(u.uOrigin, isle.x - s.orgX, 0, isle.z - s.orgZ);
      gl.bindBuffer(gl.ARRAY_BUFFER, isle.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, isle.ibo);
      SL.glAttribs(gl, p, 7, LAYOUT);
      gl.drawElements(gl.TRIANGLES, isle.count, gl.UNSIGNED_SHORT, 0);
    }
    SL.glDisableAttribs(gl, p, LAYOUT);
  };

  /* A ring of broken water round the nearest shore, drawn on the sea itself. */
  Islands.prototype.drawSurf = function (batch, sea, s) {
    var live = this.live;
    var foam = s.pal.foam;
    var fr = foam[0] / 255, fg = foam[1] / 255, fb = foam[2] / 255;
    var light = 0.20 + s.pal.light * 0.42;
    for (var i = 0; i < live.length; i++) {
      var isle = live[i];
      if (!isle.count) continue;
      var ddx = isle.x - s.worldX, ddz = isle.z - s.worldZ;
      if (ddx * ddx + ddz * ddz > 700 * 700) continue;
      for (var b = 0; b < isle.blobs.length; b++) {
        var bl = isle.blobs[b];
        var cx = isle.x - s.orgX + bl.dx, cz = isle.z - s.orgZ + bl.dz;
        var n = 44;
        for (var k = 0; k < n; k++) {
          var a0 = k / n * TAU, a1 = (k + 1) / n * TAU;
          var pulse = 0.5 + 0.5 * Math.sin(s.t * 0.9 + k * 1.7 + bl.grain);
          var rr = bl.R * 0.80 + 6 + pulse * 5;
          var al = light * (0.35 + pulse * 0.5) * clamp(0.5 + s.wind, 0, 1.2);
          if (al < 0.02) continue;
          var x0 = cx + Math.cos(a0) * rr, z0 = cz + Math.sin(a0) * rr;
          var x1 = cx + Math.cos(a1) * rr, z1 = cz + Math.sin(a1) * rr;
          var w = 7 + pulse * 5;
          var ox0 = Math.cos(a0) * w, oz0 = Math.sin(a0) * w;
          var ox1 = Math.cos(a1) * w, oz1 = Math.sin(a1) * w;
          var y0 = sea.heightAt(x0, z0, s.t) + 0.10;
          var y1 = sea.heightAt(x1, z1, s.t) + 0.10;
          batch.quad(
            x0 - ox0, y0, z0 - oz0, x1 - ox1, y1, z1 - oz1,
            x1 + ox1, y1, z1 + oz1, x0 + ox0, y0, z0 + oz0,
            0.5, 0.05, 0.5, 0.95, fr, fg, fb, clamp(al, 0, 0.42));
        }
      }
    }
  };

  SL.Islands = Islands;
  SL.ISLAND_CELL = CELL;
})(window.SL);
