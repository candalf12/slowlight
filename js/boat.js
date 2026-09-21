/* slowlight — the boat.
 *
 * A small sloop, built once as a parametric mesh and then only ever moved: the
 * hull is a lofted surface, the sails are curved triangles that swing on the
 * mast and the forestay, and the boom follows them. Nothing about it is
 * animated on its own clock — it pitches and heels because it reads the water
 * under its bow, its stern and its beam every frame, and it heels a little
 * further because of the wheel.
 *
 * The wake is the one thing in the scene that remembers anything: a fixed ring
 * of the last hundred or so places the boat has been, so the foam can curve
 * when the boat does. It is allocated once and overwritten in place.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, mix = SL.mix, TAU = SL.TAU;
  var smoothstep = SL.smoothstep;

  var LOA = 8.6, HALF = LOA * 0.5, BEAM = 2.18, HW = BEAM * 0.5;
  var MAST = 10.2, BOOM = 3.40;
  var MAT_HULL = 0, MAT_DECK = 1, MAT_CABIN = 2, MAT_RIG = 3, MAT_SAIL = 4;
  var GRP_FIXED = 0, GRP_MAIN = 1, GRP_JIB = 2;
  var TACK_Z = 3.90;
  var TRAIL = 108, TRAIL_STEP = 0.85, TRAIL_LIFE = 17;

  function lum(c) { return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114; }

  /* Scale a colour to a given luminance. Multiplicative, so the hue and the
   * saturation survive the move — nothing here ever goes grey. */
  function atLum(c, target) {
    var l = lum(c);
    if (l < 1) return [target, target, target];
    var k = target / l;
    return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)];
  }

  /* Sails are the bright note, so they stay above the water's tone however
   * light the water gets. */
  function lighterThan(col, water, minDelta) {
    var target = Math.min(lum(water) + minDelta, 248);
    return lum(col) >= target ? col : atLum(col, target);
  }

  /* A hull is an object on lit water, so it belongs below the water's tone. */
  function darkerThan(col, water, minDelta) {
    var target = lum(water) - minDelta;
    if (target < 9) return col;
    return lum(col) <= target ? col : atLum(col, target);
  }

  /* ---------- mesh ------------------------------------------------------ */

  function Mesh() {
    this.pos = []; this.nrm = []; this.mat = []; this.flex = []; this.idx = [];
  }

  /* One parametric patch. `fn(u, v, out)` writes a position and how far that
   * point bellies out when the wind fills it. */
  Mesh.prototype.patch = function (nu, nv, closedU, mat, grp, fn) {
    var base = this.pos.length / 3;
    var out = [0, 0, 0, 0];
    var du = closedU ? 1 / nu : 1 / (nu - 1);
    var i, j;
    for (i = 0; i < nu; i++) {
      for (j = 0; j < nv; j++) {
        fn(i * du, j / (nv - 1), out);
        this.pos.push(out[0], out[1], out[2]);
        this.nrm.push(0, 0, 0);
        this.mat.push(mat);
        this.flex.push(grp, out[3]);
      }
    }
    var lastU = closedU ? nu : nu - 1;
    for (i = 0; i < lastU; i++) {
      var i1 = (i + 1) % nu;
      for (j = 0; j < nv - 1; j++) {
        var a = base + i * nv + j, b = base + i1 * nv + j;
        this.idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  };

  /* Smooth normals from the faces that share each vertex. */
  Mesh.prototype.finish = function () {
    var p = this.pos, n = this.nrm, idx = this.idx, i;
    for (i = 0; i < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      var vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
      n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
      n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    for (i = 0; i < n.length; i += 3) {
      var l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]);
      if (l < 1e-6) { n[i + 1] = 1; continue; }
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    var count = this.pos.length / 3;
    var data = new Float32Array(count * 9);
    for (i = 0; i < count; i++) {
      var o = i * 9;
      data[o] = p[i * 3]; data[o + 1] = p[i * 3 + 1]; data[o + 2] = p[i * 3 + 2];
      data[o + 3] = n[i * 3]; data[o + 4] = n[i * 3 + 1]; data[o + 5] = n[i * 3 + 2];
      data[o + 6] = this.mat[i];
      data[o + 7] = this.flex[i * 2]; data[o + 8] = this.flex[i * 2 + 1];
    }
    return { data: data, index: new Uint16Array(this.idx) };
  };

  /* The sheer line, the beam and the keel, as continuous functions of how far
   * along the boat you are. Every part of the boat is hung off these. */
  function sheer(t) {
    var a = 2 * t - 1;
    return 0.38 + (a < 0 ? 0.13 * a * a : 0.36 * a * a);
  }
  function beamAt(t) {
    var w = 0.34 + 0.66 * Math.pow(Math.sin(Math.PI * t), 0.70);
    return HW * w * (1 - smoothstep(0.80, 1.0, t));
  }
  function keelAt(t) {
    return -0.42 - 0.58 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.75);
  }
  /* Where a point that far along and that far up actually sits fore and aft.
   * Both ends overhang — the counter aft and the stem forward rake away from
   * the waterline — and that profile is most of what tells a hull from a tub.
   * Everything built on the hull reads its station from here, or the deck and
   * the topsides would part company at the ends. */
  function rakeZ(t, y) {
    var aft = 1 - smoothstep(0.0, 0.22, t);
    var fore = smoothstep(0.78, 1.0, t);
    return lerp(-HALF, HALF, t) + (y - 0.10) * (fore * 0.70 - aft * 0.85);
  }

  /* Where the mast is stepped, and the heights the rig hangs off. The mesh and
   * the wires both read them from here, so a shroud lands on the deck edge
   * rather than somewhere near it. */
  var DECK0 = sheer(0.5) + 0.06;
  var MASTHEAD = DECK0 + MAST;
  var HOUNDS = DECK0 + MAST * 0.74;    /* where the forestay and lowers meet it */
  var BOOM_Y = DECK0 + 0.95;
  var STEM_Y = sheer(0.95) + 0.10;     /* the stemhead, where the jib is tacked */

  function buildMesh() {
    var m = new Mesh();

    /* Hull: each station is an arc from the port deck edge, round the keel,
     * up to starboard. The exponent is what rounds the bilge. */
    function station(t, u, o) {
      var w = beamAt(t), dy = sheer(t), ky = keelAt(t);
      var ph = Math.PI * u;
      o[0] = -Math.cos(ph) * w;
      o[1] = dy - (dy - ky) * Math.pow(Math.sin(ph), 0.62);
      o[2] = rakeZ(t, o[1]);
      o[3] = 0;
    }
    m.patch(46, 26, false, MAT_HULL, GRP_FIXED, station);

    /* The transom, closing the stern — the one end of the hull the viewer is
     * most often looking into. A fan from the middle of the raked face. */
    var tz = rakeZ(0, sheer(0));
    m.patch(26, 6, false, MAT_HULL, GRP_FIXED, function (u, r, o) {
      station(0, u, o);
      o[0] *= r;
      o[1] = lerp(sheer(0), o[1], r);
      o[2] = lerp(tz, o[2], r);
      o[3] = 0;
    });

    /* Deck, with just enough camber to catch the light across it, flattening
     * at both ends so it meets the hull and the transom cleanly — and dipping
     * into a cockpit well abaft the cabin, which is what makes the whole thing
     * read as a boat rather than as a shape at this size. */
    m.patch(50, 24, false, MAT_DECK, GRP_FIXED, function (t, u, o) {
      var w = beamAt(t), dy = sheer(t), a = u * 2 - 1;
      /* Steep enough at its edge to read as a well with sides rather than a
       * dent pressed into the deck. The exponent is what squares the walls up
       * without needing geometry that doubles back on itself. */
      var well = smoothstep(0.085, 0.130, t) * (1 - smoothstep(0.290, 0.335, t)) *
                 (1 - smoothstep(0.40, 0.52, Math.abs(a)));
      well = well * well * (3 - 2 * well);
      var top = dy + 0.075 * w * (1 - a * a) * Math.sin(Math.PI * t);
      o[0] = a * w;
      o[1] = top - well * 0.44;
      /* Read off the sheer, not off the well, so the deck edge stays welded
       * to the top of the topsides all the way round. */
      o[2] = rakeZ(t, dy);
      o[3] = 0;
    });

    /* Cabin: a low trunk with a flat-ish top and steep sides, and a cap at
     * each end so it is a solid thing rather than a tunnel. */
    var CZ0 = -0.95, CZ1 = 1.70, CW = 0.66, CH = 0.50;
    function trunk(t, u, o) {
      var z = lerp(CZ0, CZ1, t);
      var base = sheer(z / LOA + 0.5) + 0.015;
      var ph = Math.PI * u;
      var narrow = 1 - smoothstep(0.78, 1.0, t) * 0.30;
      o[0] = -Math.cos(ph) * CW * narrow;
      o[1] = base + CH * Math.pow(Math.sin(ph), 0.45) * (1 - smoothstep(0.80, 1.0, t) * 0.34);
      o[2] = z;
      o[3] = 0;
    }
    m.patch(26, 20, false, MAT_CABIN, GRP_FIXED, trunk);
    m.patch(20, 4, false, MAT_CABIN, GRP_FIXED, function (u, r, o) {
      trunk(0, u, o);
      var base = sheer(CZ0 / LOA + 0.5) + 0.015;
      o[0] *= r; o[1] = lerp(base, o[1], r); o[3] = 0;
    });
    m.patch(20, 4, false, MAT_CABIN, GRP_FIXED, function (u, r, o) {
      trunk(1, u, o);
      var base = sheer(CZ1 / LOA + 0.5) + 0.015;
      o[0] *= r; o[1] = lerp(base, o[1], r); o[3] = 0;
    });

    /* Mast, tapering, and the boom that swings with the mainsail. */
    m.patch(14, 10, true, MAT_RIG, GRP_FIXED, function (u, t, o) {
      var r = lerp(0.075, 0.032, t);
      var ph = u * TAU;
      o[0] = Math.cos(ph) * r;
      o[1] = DECK0 + t * MAST;
      o[2] = 0.05 + Math.sin(ph) * r;
      o[3] = 0;
    });
    m.patch(12, 8, true, MAT_RIG, GRP_MAIN, function (u, t, o) {
      var r = lerp(0.055, 0.038, t);
      var ph = u * TAU;
      o[0] = Math.cos(ph) * r;
      o[1] = BOOM_Y + Math.sin(ph) * r;
      o[2] = 0.05 - t * BOOM;
      o[3] = 0;
    });

    /* Mainsail: luff up the mast, foot along the boom, and a belly that fills
     * with the wind. The bulge is carried as a weight and scaled in the shader
     * so it breathes with the weather rather than being baked in. */
    var y0 = BOOM_Y, y1 = DECK0 + MAST - 0.18;
    m.patch(16, 12, false, MAT_SAIL, GRP_MAIN, function (t, r, o) {
      var chord = BOOM * (1 - t) * 0.97;
      o[0] = 0;
      o[1] = lerp(y0, y1, t) + r * chord * 0.10;
      o[2] = 0.05 - r * chord;
      o[3] = Math.pow(Math.sin(Math.PI * t), 0.55) * Math.sin(Math.PI * r);
    });

    /* Jib, on the forestay from the stemhead to three-quarters up the mast. */
    var jy0 = STEM_Y, jy1 = HOUNDS;
    m.patch(14, 10, false, MAT_SAIL, GRP_JIB, function (t, r, o) {
      o[0] = 0;
      o[1] = lerp(lerp(jy0, jy1, t), lerp(jy0 + 0.9, jy1, t), r);
      o[2] = lerp(lerp(TACK_Z, 0.22, t), lerp(-0.25, 0.22, t), r);
      o[3] = Math.pow(Math.sin(Math.PI * t), 0.55) * Math.sin(Math.PI * r) * 0.85;
    });

    return m.finish();
  }

  /* ---------- shaders --------------------------------------------------- */

  var VERT = [
    'precision highp float;',
    'attribute vec3 aPos;',
    'attribute vec3 aNrm;',
    'attribute float aMat;',
    'attribute vec2 aFlex;',
    'uniform mat4 uViewProj, uModel;',
    'uniform vec3 uMatCol[5];',
    'uniform vec2 uSail;',   /* boom angle, jib angle */
    'uniform float uBulge;',
    'varying vec3 vNrm;',
    'varying vec3 vCol;',
    'varying vec3 vWorld;',
    'varying vec3 vPart;',   /* material, height in her own frame, and belly */
    'void main() {',
    '  vec3 p = aPos;',
    '  vec3 n = aNrm;',
    '  float grp = aFlex.x;',
    '  p.x += aFlex.y * uBulge;',
    '  if (grp > 0.5) {',
    '    float ang = grp < 1.5 ? uSail.x : uSail.y;',
    '    vec2 piv = grp < 1.5 ? vec2(0.0, 0.05) : vec2(0.0, ' + TACK_Z.toFixed(2) + ');',
    '    float c = cos(ang), sn = sin(ang);',
    '    vec2 q = p.xz - piv;',
    '    p.xz = piv + vec2(q.x * c + q.y * sn, -q.x * sn + q.y * c);',
    '    n.xz = vec2(n.x * c + n.z * sn, -n.x * sn + n.z * c);',
    '  }',
    '  int mi = int(aMat + 0.5);',
    '  vCol = uMatCol[0];',
    '  if (mi == 1) vCol = uMatCol[1];',
    '  else if (mi == 2) vCol = uMatCol[2];',
    '  else if (mi == 3) vCol = uMatCol[3];',
    '  else if (mi == 4) vCol = uMatCol[4];',
    '  vPart = vec3(aMat, aPos.y, aFlex.y);',
    '  vec4 w = uModel * vec4(p, 1.0);',
    '  vWorld = w.xyz;',
    '  vNrm = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * n;',
    '  gl_Position = uViewProj * w;',
    '}'
  ].join('\n');

  var FRAG = [
    SL.GLSL_AIR,
    'varying vec3 vNrm;',
    'varying vec3 vCol;',
    'varying vec3 vWorld;',
    'varying vec3 vPart;',
    'uniform vec3 uEye;',
    'uniform float uSun;',
    'void main() {',
    '  vec3 N = normalize(vNrm);',
    '  if (!gl_FrontFacing) N = -N;',
    /* Ambient is the sky the surface actually faces, so the boat is lit by the
     * hour rather than by a constant. */
    '  vec3 amb = skyColor(normalize(N * 0.7 + vec3(0.0, 0.62, 0.0)), 0.0);',
    /* Overhead that sky is deep blue, and a cream sail multiplied by it comes
     * out grey - she ends up the one colourless thing on a blue sea. Keep how
     * much light it brings and let go of most of its hue, so she carries her
     * own colour and the hour still decides how bright she is. */
    '  amb = mix(amb, vec3(dot(amb, vec3(0.299, 0.587, 0.114))), 0.62);',
    /* Weighted by which way the surface faces, or a sail would be one flat
     * shape from luff to leech with nothing in it. */
    '  amb *= 0.42 + 0.58 * (N.y * 0.5 + 0.5);',
    '  float d = max(dot(N, uBodyDir), 0.0);',
    '  vec3 col = vCol * (amb * 0.92 + uBodyGlow * (d * uSun));',
    '  float mat = vPart.x, ly = vPart.y;',
    /* Cloth is thin: the sun behind a sail comes through it. */
    '  if (mat > 3.5) {',
    '    float back = max(dot(-N, uBodyDir), 0.0);',
    '    col += vCol * uBodyGlow * (back * uSun * 0.55);',
    /* A sail is barely curved, so its normal hardly moves and the light alone
     * leaves it flat as card. Its own belly is the shape worth drawing: full
     * in the middle, falling away to the boltropes. */
    '    float belly = clamp(vPart.z, 0.0, 1.0);',
    '    col *= 0.74 + 0.40 * belly;',
    /* And it is cloth over a boom, so it is darker down at the foot. */
    '    col *= 0.88 + 0.12 * smoothstep(0.0, 4.0, ly);',
    '  } else if (mat < 0.5) {',
    /* Topsides above the boot top, antifouling below it. */
    '    col *= mix(0.55, 1.0, smoothstep(-0.03, 0.13, ly));',
    '  } else if (mat > 1.5 && mat < 2.5) {',
    /* A band of window down the side of the trunk. */
    '    float w = smoothstep(0.60, 0.65, ly) * (1.0 - smoothstep(0.76, 0.81, ly));',
    '    col = mix(col, col * 0.30, w * 0.85);',
    '  }',
    /* A soft sheen on the hull where it turns away, never a highlight. */
    '  vec3 V = normalize(uEye - vWorld);',
    '  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);',
    '  col += vCol * rim * 0.10 * (0.3 + uAir.z);',
    '  col = mix(col, hazeSeam(normalize(vWorld - uEye)), fogAmount(length(vWorld - uEye)));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var LAYOUT = [['aPos', 3, 0], ['aNrm', 3, 3], ['aMat', 1, 6], ['aFlex', 2, 7]];

  /* ---------- the boat -------------------------------------------------- */

  function Boat(world) {
    /* Each world gets a slightly different boat, within a narrow range. */
    this.hullTint = world.unit('boat/hull');
    this.sailTint = world.unit('boat/sail');
    this.bobPhase = world.unit('boat/bob') * TAU;
    this.model = new Float32Array(16);
    this.matCol = new Float32Array(15);
    this._w = { h: 0, gx: 0, gz: 0 };
    this._s = { x: 0, y: 0, slope: 0 };
    this.cols = null;
    this.boom = 0;
    this.jib = 0;
    this.bulge = 0.85;
    /* The path behind it, for the wake. Written in place, never grown. */
    this.trail = [];
    for (var i = 0; i < TRAIL; i++) {
      this.trail.push({ x: 0, z: 0, y: 0, hx: 0, hz: 1, sp: 0, life: 1e9 });
    }
    this.head = 0;
    this.filled = 0;
    this.lastX = 0;
    this.lastZ = 0;
  }

  Boat.prototype.init = function (gl) {
    var mesh = buildMesh();
    this.prog = SL.glProgram(gl, VERT, FRAG);
    this.vbo = SL.glBuffer(gl, gl.ARRAY_BUFFER, mesh.data);
    this.ibo = SL.glBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.index);
    this.count = mesh.index.length;
  };

  /* ---------- how it sits ------------------------------------------------ */

  /* The water under the hull: its height, and the slopes it answers to along
   * the boat and across it. Five reads of the surface, which is all the hull
   * can feel — a point sample would make it twitch on wavelets it spans. */
  Boat.prototype.settle = function (sea, s, dt) {
    var t = s.t, x = s.boatX, z = s.boatZ;
    var fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    var o = this._w;
    var yc = sea.sample(x, z, t, o).h;
    var yb = sea.sample(x + fx * HALF, z + fz * HALF, t, o).h;
    var ys = sea.sample(x - fx * HALF, z - fz * HALF, t, o).h;
    var yp = sea.sample(x - fz * HW, z + fx * HW, t, o).h;
    var yq = sea.sample(x + fz * HW, z - fx * HW, t, o).h;

    var alongSlope = (yb - ys) / LOA;
    var acrossSlope = (yq - yp) / BEAM;
    s.boatY = (yc * 0.5 + (yb + ys) * 0.25) - 0.10 +
              Math.sin(s.t * 0.55 + this.bobPhase) * 0.045 * s.motion;
    /* Bow rises on the face of a swell: the rotation about X is the negative
     * of the slope it is climbing. */
    s.boatPitch = -Math.atan(alongSlope) * 0.90 * s.motion;
    s.waterRoll = Math.atan(acrossSlope) * 0.75 * s.motion;
    s.swell = alongSlope;
    s.waterY = yc;

    /* Where the wind is on the bow decides which side the sails set, and how
     * far out. Nothing here snaps: the boom eases across. */
    var rel = SL.angleDelta(s.heading, s.windFrom);
    var off = Math.abs(rel);
    /* Close-hauled the boom is nearly amidships; running, it is right out.
     * `rel > 0` is wind off the starboard bow, so the sails set to port. */
    var side = rel >= 0 ? 1 : -1;
    var boomTarget = side * clamp(off * 0.45, 0.28, 1.30);
    this.boom = SL.approach(this.boom, boomTarget, 2.6, dt);
    this.jib = SL.approach(this.jib, boomTarget * 0.62, 2.2, dt);
    this.bulge = SL.approach(this.bulge, 0.62 + clamp(s.wind, 0, 1.2) * 0.72, 1.8, dt);
    /* And she leans away from it, harder the more sail she is carrying. */
    s.sailHeel = side * clamp(s.wind, 0, 1.2) * 0.13 * Math.sin(off) *
                 clamp(s.course, 0, 1.6) * s.motion;
    s.boatRoll = s.waterRoll + s.sailHeel + s.steer * 0.07 * s.motion;

    this.record(s, dt);
  };

  /* The audio reads the boat the way the boat reads the water. */
  Boat.prototype.sample = function (sea, s) {
    var o = this._s;
    o.x = s.boatX;
    o.y = s.waterY;
    o.slope = s.swell;
    return o;
  };

  Boat.prototype.record = function (s, dt) {
    var i;
    for (i = 0; i < TRAIL; i++) this.trail[i].life += dt;
    var dx = s.boatX - this.lastX, dz = s.boatZ - this.lastZ;
    if (dx * dx + dz * dz < TRAIL_STEP * TRAIL_STEP && this.filled > 0) return;
    this.lastX = s.boatX; this.lastZ = s.boatZ;
    this.head = (this.head + 1) % TRAIL;
    var p = this.trail[this.head];
    p.x = s.boatX; p.z = s.boatZ; p.y = s.waterY;
    p.hx = Math.sin(s.heading); p.hz = Math.cos(s.heading);
    p.sp = clamp(s.course, 0, 1.8);
    p.life = 0;
    if (this.filled < TRAIL) this.filled++;
  };

  /* When the origin is rebased, the path has to move with it or the wake would
   * jump away from the stern. */
  Boat.prototype.shift = function (dx, dz) {
    for (var i = 0; i < TRAIL; i++) {
      this.trail[i].x += dx;
      this.trail[i].z += dz;
    }
    this.lastX += dx;
    this.lastZ += dz;
  };

  /* ---------- colour ---------------------------------------------------- */

  Boat.prototype.colors = function (s) {
    var pal = s.pal;
    var water = mix(pal.seaNear, pal.seaFar, 0.18);
    var hull = mix(pal.seaNear, [10, 13, 20], lerp(0.30, 0.55, this.hullTint));
    /* Against grey water a delta of ten was enough to read; against the blue
     * the sea is now, it left her looking like pale plastic. */
    hull = darkerThan(mix(hull, pal.skyHor, 0.08), water, 38);
    var sail = mix(pal.crest, [248, 243, 231], 0.34 + this.sailTint * 0.2);
    sail = mix(sail, pal.haze, 0.16 + s.weather.haze * 0.28);
    sail = lighterThan(mix(sail, pal.body, 0.10), water, 30);
    /* The sea is her background and the sea is blue, so she carries the warm
     * end of the hour instead: a laid deck, a trunk a shade off it, and
     * brightwork on the spars. Still the palette's colours, only the other
     * side of it. */
    var warm = mix(pal.crest, pal.skyHor, 0.45);
    return {
      hull: hull,
      deck: mix(mix(hull, warm, 0.62), pal.body, 0.10),
      cabin: mix(hull, warm, 0.46),
      rig: mix(hull, warm, 0.56),
      sail: sail,
      /* Wire reads as a dark line against a lit sky and disappears against the
       * water under it, which is what standing rigging actually does at this
       * distance. So it is taken well below the sea's tone and left there. */
      wire: darkerThan(mix(hull, pal.skyTop, 0.30), water, 58)
    };
  };

  /* ---------- drawing --------------------------------------------------- */

  Boat.prototype.draw = function (gl, s) {
    var p = this.prog, u = p.u;
    var c = this.cols = this.colors(s);
    var m = this.matCol;
    SL.putColor(m, 0, c.hull);
    SL.putColor(m, 3, c.deck);
    SL.putColor(m, 6, c.cabin);
    SL.putColor(m, 9, c.rig);
    SL.putColor(m, 12, c.sail);

    SL.m4model(this.model, s.boatX, s.boatY, s.boatZ,
               s.heading, s.boatPitch, s.boatRoll, 1);

    gl.useProgram(p.p);
    SL.setAir(gl, p, s);
    gl.uniformMatrix4fv(u.uViewProj, false, s.viewProj);
    gl.uniformMatrix4fv(u.uModel, false, this.model);
    gl.uniform3fv(u.uMatCol, m);
    gl.uniform2f(u.uSail, this.boom, this.jib);
    gl.uniform1f(u.uBulge, this.bulge);
    gl.uniform3f(u.uEye, s.eyeX, s.eyeY, s.eyeZ);
    gl.uniform1f(u.uSun, s.body.vis * (s.body.isMoon ? 0.30 : 1.0) * lerp(0.22, 1.0, s.pal.light));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    SL.glAttribs(gl, p, 9, LAYOUT);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    SL.glDisableAttribs(gl, p, LAYOUT);
  };

  /* A short, broken-up mirror of the boat laid on the water between it and the
   * eye — strokes rather than a copy of the shape, because a clean mirror
   * reads as glass and this water is not glass. */
  Boat.prototype.drawReflection = function (batch, sea, s) {
    var a = 0.14 + s.pal.light * 0.28;
    a *= (1 - s.weather.rain * 0.45) * (1 - s.weather.haze * 0.3);
    if (a < 0.03) return;
    /* Worked out once per frame, in `draw`, which always runs first. */
    var c = this.cols || (this.cols = this.colors(s));
    var tx = s.eyeX - s.boatX, tz = s.eyeZ - s.boatZ;
    var tl = Math.sqrt(tx * tx + tz * tz);
    if (tl < 0.5) return;
    tx /= tl; tz /= tl;
    var px = -tz, pz = tx;
    var rows = 18, span = 7.4;
    for (var i = 0; i < rows; i++) {
      var f = (i + 0.5) / rows;
      var d = f * span;
      var x = s.boatX + tx * d, z = s.boatZ + tz * d;
      var n = SL.noise2(x * 0.6 + f * 6.1, s.t * 1.05 + i * 0.7);
      if (n < 0.28) continue;
      var isHull = f < 0.32;
      var col = isHull ? c.hull : c.sail;
      var w = isHull ? lerp(1.30, 0.80, f / 0.32) : lerp(0.52, 0.10, (f - 0.32) / 0.68);
      w *= 0.55 + n * 0.8;
      var rowA = a * (1 - f) * (1 - f) * (isHull ? 1.2 : 0.55) * (n - 0.18);
      if (rowA < 0.01) continue;
      var wob = Math.sin(s.t * 1.25 + f * 8.5 + x * 0.5) * 0.30 * s.motion;
      var cx = x + px * wob, cz = z + pz * wob;
      var y = sea.heightAt(cx, cz, s.t) + 0.06;
      var hl = span / rows * 0.8;
      batch.quad(
        cx - px * w - tx * hl, y, cz - pz * w - tz * hl,
        cx + px * w - tx * hl, y, cz + pz * w - tz * hl,
        cx + px * w + tx * hl, y, cz + pz * w + tz * hl,
        cx - px * w + tx * hl, y, cz - pz * w + tz * hl,
        0.04, 0.04, 0.96, 0.96,
        col[0] / 255, col[1] / 255, col[2] / 255, clamp(rowA, 0, 0.5));
    }
  };

  /* ---------- rigging ----------------------------------------------------
   *
   * Nine wires, and none of them is mesh. A shroud is a few centimetres thick,
   * and a cylinder that thin falls between two pixels and flickers as she
   * moves. Each one is drawn instead as a ribbon turned to face the eye and
   * measured in pixels rather than metres, so it stays one clean dark line at
   * any window size — which, at the distance the camera sits, is exactly what
   * rigging looks like.
   */

  var W0 = [0, 0, 0], W1 = [0, 0, 0];

  /* A point in her own frame, put where she is. */
  function toWorld(m, x, y, z, o) {
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }

  Boat.prototype.wire = function (batch, s, ax, ay, az, bx, by, bz, col, a, px) {
    var m = this.model;
    toWorld(m, ax, ay, az, W0);
    toWorld(m, bx, by, bz, W1);
    var dx = W1[0] - W0[0], dy = W1[1] - W0[1], dz = W1[2] - W0[2];
    var vx = (W0[0] + W1[0]) * 0.5 - s.eyeX;
    var vy = (W0[1] + W1[1]) * 0.5 - s.eyeY;
    var vz = (W0[2] + W1[2]) * 0.5 - s.eyeZ;
    /* Across the wire and across the line of sight both: the one direction in
     * which giving it a width does not also give it a thickness. */
    var nx = dy * vz - dz * vy, ny = dz * vx - dx * vz, nz = dx * vy - dy * vx;
    var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-6) return;
    nx /= nl; ny /= nl; nz /= nl;
    var dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
    var hw = Math.max(px * dist * s.tanY / Math.max(s.H, 1), 0.006);
    /* The soft dot is sampled straight down its middle, so the wire has a
     * core and two edges that fade rather than one hard-edged strip. */
    batch.quad(
      W0[0] - nx * hw, W0[1] - ny * hw, W0[2] - nz * hw,
      W1[0] - nx * hw, W1[1] - ny * hw, W1[2] - nz * hw,
      W1[0] + nx * hw, W1[1] + ny * hw, W1[2] + nz * hw,
      W0[0] + nx * hw, W0[1] + ny * hw, W0[2] + nz * hw,
      0.5, 0.02, 0.5, 0.98, col[0] / 255, col[1] / 255, col[2] / 255, a);
  };

  Boat.prototype.drawRigging = function (batch, s) {
    /* Worked out once per frame, in `draw`, which always runs first. */
    var c = this.cols || (this.cols = this.colors(s));
    var w = c.wire;
    var a = (0.34 + s.pal.light * 0.40) * (1 - s.weather.rain * 0.30);
    if (a < 0.02) return;

    /* Chainplates, on the deck edge abreast the mast and a little abaft it. */
    var capX = beamAt(0.506) * 0.93, capY = sheer(0.506);
    var lowT = 0.413, lowX = beamAt(lowT) * 0.90;
    var lowY = sheer(lowT), lowZ = rakeZ(lowT, lowY);
    var sternY = sheer(0) + 0.02, sternZ = rakeZ(0, sheer(0));

    /* Standing rigging: what holds the mast up, and the only part of her that
     * never moves in her own frame. */
    this.wire(batch, s, 0, STEM_Y, TACK_Z, 0, HOUNDS, 0.10, w, a, 3.1);
    this.wire(batch, s, 0, MASTHEAD, 0.05, 0, sternY, sternZ, w, a, 2.9);
    this.wire(batch, s, 0, MASTHEAD, 0.05, capX, capY, 0.15, w, a, 3.0);
    this.wire(batch, s, 0, MASTHEAD, 0.05, -capX, capY, 0.15, w, a, 3.0);
    this.wire(batch, s, 0, HOUNDS, 0.05, lowX, lowY, lowZ, w, a * 0.9, 2.6);
    this.wire(batch, s, 0, HOUNDS, 0.05, -lowX, lowY, lowZ, w, a * 0.9, 2.6);

    /* Running rigging swings with the spars, so it is worked out from the same
     * angles the shader swings them by. */
    var cb = Math.cos(this.boom), sb = Math.sin(this.boom);
    var bex = -BOOM * sb, bez = 0.05 - BOOM * cb;
    this.wire(batch, s, 0, MASTHEAD, 0.05, bex, BOOM_Y + 0.05, bez, w, a * 0.75, 2.4);
    this.wire(batch, s, bex * 0.88, BOOM_Y, 0.05 + (bez - 0.05) * 0.88,
              0, sheer(0.07) + 0.04, rakeZ(0.07, sheer(0.07)), w, a * 0.85, 2.5);

    /* One jib sheet, on the side the sail is set, because it is the line that
     * explains why the jib is out there at all. */
    var cj = Math.cos(this.jib), sj = Math.sin(this.jib);
    var clew = TACK_Z + 0.25;
    var jex = -clew * sj, jez = TACK_Z - clew * cj;
    var lead = this.jib >= 0 ? 1 : -1;
    this.wire(batch, s, jex, STEM_Y + 0.90, jez,
              lead * beamAt(0.36) * 0.80, sheer(0.36) + 0.04,
              rakeZ(0.36, sheer(0.36)), w, a * 0.70, 2.3);
  };

  /* Her two contributions to the blended pass, in the order they have to go
   * down. `js/scene.js` owns when this is called; the wire rides along at the
   * end of it so no piece of foam is ever laid across a shroud. */
  Boat.prototype.drawWake = function (batch, sea, s) {
    this.foam(batch, sea, s);
    this.drawRigging(batch, s);
  };

  /* Foam astern, laid along the path the boat actually took, so it curves when
   * she does. Three ribbons: the broken water directly behind, and the two
   * arms that spread away from the bow. */
  Boat.prototype.foam = function (batch, sea, s) {
    if (this.filled < 3) return;
    var foam = s.pal.foam;
    var fr = foam[0] / 255, fg = foam[1] / 255, fb = foam[2] / 255;
    var light = (0.30 + s.pal.light * 0.60) * s.motion;
    var way = clamp(s.course - 0.22, 0, 1.4);
    if (light * way < 0.02) return;
    var hx = Math.sin(s.heading), hz = Math.cos(s.heading);
    var px = 0, py = 0, pz = 0, pnx = 0, pnz = 0, pw = 0, pa = 0, has = false;
    for (var a = 0; a < 3; a++) {
      var arm = a === 0 ? 0 : (a === 1 ? -1 : 1);
      has = false;
      /* Index -1 is the stern itself, so the foam starts at the boat rather
       * than at whichever point on the path was last written down. */
      for (var i = -1; i < this.filled; i++) {
        var p, age, back;
        if (i < 0) {
          p = null;
          age = 0; back = 0;
        } else {
          p = this.trail[(this.head - i + TRAIL * 2) % TRAIL];
          age = clamp(p.life / TRAIL_LIFE, 0, 1);
          if (age >= 1) break;
          back = clamp(i / 38, 0, 1);
        }
        var nx = p ? -p.hz : -hz, nz = p ? p.hx : hx;
        var bx = p ? p.x : s.boatX - hx * 3.9, bz = p ? p.z : s.boatZ - hz * 3.9;
        var by = (p ? p.y : s.waterY) + 0.09;

        /* The arms spread away from the bow and are spent within a few
         * lengths; the broken water astern is wider and softer. */
        var spread = arm * (0.70 + back * 5.4);
        var w = arm === 0 ? lerp(0.85, 3.1, back) : lerp(0.26, 0.70, back);
        var taper = arm === 0 ? (1 - back) * (1 - back)
                              : (1 - back) * (1 - back) * (1 - smoothstep(0.42, 0.95, back));
        var churn = arm === 0 ? 1 :
          0.30 + 0.85 * SL.noise2(bx * 0.22 + arm * 5.3, bz * 0.22 + s.t * 0.05);
        var al = taper * (1 - age) * (1 - age) * light * way * churn *
                 clamp((p ? p.sp : s.course) - 0.18, 0, 1.4) *
                 (arm === 0 ? 0.50 : 0.36);
        var cx = bx + nx * spread, cz = bz + nz * spread;
        /* Foam that comes up alongside the eye smears across the frame edge
         * rather than reading as water, so it is spent before it gets there. */
        var ex = cx - s.eyeX, ez = cz - s.eyeZ;
        al *= smoothstep(4.0, 13.0, Math.sqrt(ex * ex + ez * ez));
        if (has && (pa > 0.006 || al > 0.006)) {
          batch.quad(
            px - pnx * pw, py, pz - pnz * pw,
            cx - nx * w, by, cz - nz * w,
            cx + nx * w, by, cz + nz * w,
            px + pnx * pw, py, pz + pnz * pw,
            0.5, 0.05, 0.5, 0.95, fr, fg, fb, clamp((pa + al) * 0.5, 0, 0.40));
        }
        px = cx; py = by; pz = cz; pnx = nx; pnz = nz; pw = w; pa = al;
        has = true;
      }
    }

    /* The water she is actually pushing, right at the bow. */
    var bowA = clamp(way * 0.42, 0, 0.44) * light;
    if (bowA > 0.02) {
      for (var k = 0; k < 2; k++) {
        var sd = k ? 1 : -1;
        var ox = -hz * sd, oz = hx * sd;
        var fx2 = s.boatX + hx * 2.9 + ox * 0.42, fz2 = s.boatZ + hz * 2.9 + oz * 0.42;
        var fy = sea.heightAt(fx2, fz2, s.t) + 0.10;
        var jig = 0.75 + 0.45 * SL.noise2(s.t * 1.7 + k * 3.3, 7.1);
        batch.quad(
          fx2 - hx * 1.7 - ox * 0.30, fy, fz2 - hz * 1.7 - oz * 0.30,
          fx2 + hx * 1.5, fy, fz2 + hz * 1.5,
          fx2 + hx * 1.5 + ox * 0.55, fy, fz2 + hz * 1.5 + oz * 0.55,
          fx2 - hx * 1.7 + ox * 0.95, fy, fz2 - hz * 1.7 + oz * 0.95,
          0.04, 0.04, 0.96, 0.96, fr, fg, fb, clamp(bowA * jig, 0, 0.34));
      }
    }
  };

  /* The cabin lamp, which only earns its keep once the light drops. */
  Boat.prototype.drawLamp = function (batch, s) {
    var lampA = clamp(1 - s.pal.light * 1.55, 0, 1);
    if (lampA < 0.02) return;
    var ch = Math.cos(s.heading), sh = Math.sin(s.heading);
    var lx = s.boatX + sh * 1.05, lz = s.boatZ + ch * 1.05;
    var ly = s.boatY + 1.10;
    var rx = s.camRight[0], ry = s.camRight[1], rz = s.camRight[2];
    var ux = s.camUp[0], uy = s.camUp[1], uz = s.camUp[2];
    batch.billboard(lx, ly, lz, rx, ry, rz, ux, uy, uz, 1.7, 1.7,
                    0, 0, 1, 1, 1.0, 0.80, 0.52, 0.22 * lampA);
    batch.billboard(lx, ly, lz, rx, ry, rz, ux, uy, uz, 0.28, 0.28,
                    0, 0, 1, 1, 1.0, 0.91, 0.72, 0.75 * lampA);
  };

  SL.Boat = Boat;
  SL.BOAT_LOA = LOA;
})(window.SL);
