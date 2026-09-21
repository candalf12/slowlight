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
  /* pos3, nrm3, mat1, flex2, uv2 */
  var STRIDE = 11;

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

  /* Scale back a chroma that would take a channel off the end of the scale,
   * rather than clip the one channel and bend the hue with it. */
  function fit(k, l, d) {
    if (d > 1e-4) return Math.min(k, (255 - l) / d);
    if (d < -1e-4) return Math.min(k, l / -d);
    return k;
  }

  /* Open a colour's chroma out about its own luminance. The palette's warm
   * keys are warm, but only just - they are air, and air is pale. Cloth and
   * paint are neither, and mixed straight out of those keys they come back as
   * warm greys. This is the same move `SL.waterCharacter` makes on the sea and
   * it obeys the same rule: chroma only, so the hour keeps every say in how
   * light she is at any point of the cycle. */
  function chroma(c, k) {
    var l = lum(c);
    var dr = (c[0] - l) * k, dg = (c[1] - l) * k, db = (c[2] - l) * k;
    var f = fit(fit(fit(1, l, dr), l, dg), l, db);
    return [l + dr * f, l + dg * f, l + db * f];
  }

  /* ---------- mesh ------------------------------------------------------ */

  function Mesh() {
    this.pos = []; this.nrm = []; this.mat = []; this.flex = []; this.uv = [];
    this.idx = [];
  }

  /* One parametric patch. `fn(u, v, out)` writes a position and how far that
   * point bellies out when the wind fills it. The (u, v) it was asked for goes
   * to the shader as well: it is the only coordinate that knows a sail from
   * its leech or a hull from its sheer, and painting a line on either without
   * it would mean geometry to carry the line. */
  Mesh.prototype.patch = function (nu, nv, closedU, mat, grp, fn) {
    var base = this.pos.length / 3;
    var out = [0, 0, 0, 0, 0, 0];
    var du = closedU ? 1 / nu : 1 / (nu - 1);
    var i, j;
    for (i = 0; i < nu; i++) {
      for (j = 0; j < nv; j++) {
        var u = i * du, v = j / (nv - 1);
        /* The patch coordinate, unless the surface has something better to
         * send: `out[4]` and `out[5]` are the hull's drop below its own sheer
         * and the deck's depth into the cockpit well, which are what a painted
         * line and a shadow are actually measured in. */
        out[4] = u; out[5] = v;
        fn(u, v, out);
        this.pos.push(out[0], out[1], out[2]);
        this.nrm.push(0, 0, 0);
        this.mat.push(mat);
        this.flex.push(grp, out[3]);
        this.uv.push(out[4], out[5]);
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
    var data = new Float32Array(count * STRIDE);
    for (i = 0; i < count; i++) {
      var o = i * STRIDE;
      data[o] = p[i * 3]; data[o + 1] = p[i * 3 + 1]; data[o + 2] = p[i * 3 + 2];
      data[o + 3] = n[i * 3]; data[o + 4] = n[i * 3 + 1]; data[o + 5] = n[i * 3 + 2];
      data[o + 6] = this.mat[i];
      data[o + 7] = this.flex[i * 2]; data[o + 8] = this.flex[i * 2 + 1];
      data[o + 9] = this.uv[i * 2]; data[o + 10] = this.uv[i * 2 + 1];
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
      /* How far below her own sheer this point sits. A sheer line and a cove
       * stripe are painted that way and follow the deck edge round; the boot
       * top is level and reads off the height instead. */
      o[5] = dy - o[1];
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
      /* The fan closes on a point at the height of the sheer, which would put
       * the middle of the transom on the sheer line. Push the inside of the
       * fan away from it; only its rim is really the deck edge. */
      o[5] = sheer(0) - o[1] + (1 - r) * 0.30;
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
      /* A cockpit is a hole in a deck and holes are dark. Without this the
       * well is lit exactly like the deck around it and the whole of her
       * after end reads as one bright moulded tray. */
      o[5] = well;
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

    /* A tiller, lying forward into the well off the rudder head. It is a
     * finger long on the glass and still worth its hundred triangles: it is
     * the one thing on her that says somebody has been steering. */
    m.patch(9, 6, true, MAT_RIG, GRP_FIXED, function (u, t, o) {
      var r = lerp(0.048, 0.028, t);
      var ph = u * TAU;
      o[0] = Math.cos(ph) * r;
      o[1] = lerp(0.26, 0.52, t) + Math.sin(ph) * r;
      o[2] = lerp(-3.42, -2.00, t);
      o[3] = 0;
    });

    /* Mainsail: luff up the mast, foot along the boom, and a belly that fills
     * with the wind. The bulge is carried as a weight and scaled in the shader
     * so it breathes with the weather rather than being baked in.
     *
     * The leech between the clew and the head is not the straight line it was.
     * A sail is cut with a roach standing out past that line and finishes in a
     * headboard rather than a point, and at any distance at all that curve is
     * most of what a sail's outline is. The foot rounds up off the boom in the
     * middle for the same reason: cloth has a shape, card does not. */
    var y0 = BOOM_Y, y1 = DECK0 + MAST - 0.18;
    var HEAD = 0.20, ROACH = 0.34;
    m.patch(22, 15, false, MAT_SAIL, GRP_MAIN, function (t, r, o) {
      var chord = lerp(BOOM * 0.97, HEAD, t) +
                  ROACH * Math.pow(Math.sin(Math.PI * t), 0.75);
      o[0] = 0;
      o[1] = lerp(y0, y1, t) + Math.sin(Math.PI * r) * 0.13 * (1 - t * 0.65);
      o[2] = 0.05 - r * chord;
      /* Draft sits forward of the middle of the chord and fullest at half
       * height, which is how cloth on a straight spar actually sets. */
      o[3] = Math.pow(Math.sin(Math.PI * t), 0.55) *
             Math.sin(Math.PI * Math.pow(r, 0.80));
    });

    /* Jib, on the forestay from the stemhead to three-quarters up the mast.
     * Its leech is slightly hollow, the way a working headsail's is, so it
     * cannot be mistaken for a small copy of the main. */
    var jy0 = STEM_Y, jy1 = HOUNDS;
    m.patch(18, 13, false, MAT_SAIL, GRP_JIB, function (t, r, o) {
      var hollow = -0.14 * Math.sin(Math.PI * t) * r;
      o[0] = 0;
      o[1] = lerp(lerp(jy0, jy1, t), lerp(jy0 + 0.9, jy1, t), r) +
             Math.sin(Math.PI * r) * 0.14 * (1 - t * 0.6);
      o[2] = lerp(lerp(TACK_Z, 0.22, t), lerp(-0.25, 0.22, t), r) - hollow;
      o[3] = Math.pow(Math.sin(Math.PI * t), 0.55) *
             Math.sin(Math.PI * Math.pow(r, 0.80)) * 0.85;
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
    'attribute vec2 aUV;',
    'uniform mat4 uViewProj, uModel;',
    'uniform vec3 uMatCol[5];',
    'uniform vec2 uSail;',   /* boom angle, jib angle */
    'uniform float uBulge;',
    'varying vec3 vNrm;',
    'varying vec3 vCol;',
    'varying vec3 vWorld;',
    'varying vec3 vPart;',   /* material, height in her own frame, and belly */
    'varying vec2 vUV;',     /* where on its own patch this point sits */
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
    '  vUV = aUV;',
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
    'varying vec2 vUV;',
    'uniform vec3 uEye;',
    'uniform float uSun;',
    /* The plane the hull is floating on: which way the sea under her tilts,
     * and where it sits. See `settle`. */
    'uniform vec3 uWater;',
    /* The cove stripe: its colour, and whether this world carries one. */
    'uniform vec4 uTrim;',
    'void main() {',
    '  vec3 N = normalize(vNrm);',
    '  if (!gl_FrontFacing) N = -N;',
    '  float mat = vPart.x, ly = vPart.y;',
    '  float cloth = step(3.5, mat);',
    /* Ambient is the sky the surface actually faces, so the boat is lit by the
     * hour rather than by a constant. */
    '  vec3 amb = skyColor(normalize(N * 0.7 + vec3(0.0, 0.62, 0.0)), 0.0);',
    /* Overhead that sky is deep blue, and a cream sail multiplied by it comes
     * out grey - she ends up the one colourless thing on a blue sea. Keep how
     * much light it brings and let go of most of its hue, so she carries her
     * own colour and the hour still decides how bright she is. Cloth gives up
     * more of it than paint does, because cloth is thin and is lit as much by
     * the water under it and by the sail on the other side of the mast as by
     * the patch of sky it happens to face. */
    '  amb = mix(amb, vec3(dot(amb, vec3(0.299, 0.587, 0.114))),',
    '            mix(0.62, 0.88, cloth));',
    /* Weighted by which way the surface faces, or a sail would be one flat
     * shape from luff to leech with nothing in it. Cloth is weighted far less
     * for the same reason: a standing sail is nearly vertical everywhere, and
     * on the paint weighting it came out darker than the deck it is set over. */
    '  amb *= mix(0.42, 0.80, cloth) + mix(0.58, 0.24, cloth) * (N.y * 0.5 + 0.5);',
    '  float d = max(dot(N, uBodyDir), 0.0);',
    '  vec3 col = vCol * (amb * 0.92 + uBodyGlow * (d * uSun));',
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
    /* Panels. A sail is not one piece of cloth, it is a dozen cross-cut cloths
     * seamed together, and the seams are the only thing at this distance that
     * says so. Deliberately barely there: they should read as cloth, never as
     * stripes, so they are worth a few per cent and no more. */
    '    float f = fract(vUV.x * 9.0);',
    '    float seam = 1.0 - smoothstep(0.0, 0.10, min(f, 1.0 - f));',
    '    col *= 1.0 - 0.055 * seam;',
    /* Tabling: the doubled cloth along the leech and round the luff, which is
     * what gives a sail an edge instead of a cut-out. */
    '    float edge = smoothstep(0.90, 1.00, vUV.y) + smoothstep(0.05, 0.0, vUV.y);',
    '    col *= 1.0 - 0.11 * min(edge, 1.0);',
    '  } else if (mat < 0.5) {',
    /* Topsides above the boot top, antifouling below it. A boot top is level,
     * so it is read off the height; everything else painted on a hull follows
     * the sheer, so it is read off the drop below it. */
    '    float drop = vUV.y;',
    '    col *= mix(0.55, 1.0, smoothstep(-0.03, 0.13, ly));',
    /* The line at the sheer. A toe rail throws a shadow the width of itself
     * and no more, and at any distance that one dark line is the whole of
     * what separates a deck from the topsides under it. */
    '    col *= 1.0 - 0.46 * (1.0 - smoothstep(0.0, 0.048, drop));',
    /* And, in some worlds, a cove stripe under it. */
    '    col = mix(col, uTrim.rgb * (0.26 + 0.74 * uAir.z),',
    '              (1.0 - smoothstep(0.0, 0.016, abs(drop - 0.090))) * uTrim.w',
    '              * 0.80);',
    /* And a hull is wet for a hand's breadth above wherever the water happens
     * to be this instant - which is not a fixed height on her, because she
     * pitches and heels and the swell under her is a slope. Without it her
     * waterline was a clean geometric cut and she read as pasted on top of the
     * sea rather than sitting down in it. */
    '    float above = vWorld.y -',
    '      (uWater.z + uWater.x * vWorld.x + uWater.y * vWorld.z);',
    '    float wet = 1.0 - smoothstep(0.01, 0.30, above);',
    '    col *= 1.0 - 0.42 * wet;',
    '    col = mix(col, uSeaNear * 0.50, wet * 0.20);',
    '  } else if (mat < 1.5) {',
    /* The cockpit sole and its walls see a slot of sky and no more. */
    '    col *= 1.0 - 0.46 * clamp(vUV.y, 0.0, 1.0);',
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

  var LAYOUT = [['aPos', 3, 0], ['aNrm', 3, 3], ['aMat', 1, 6], ['aFlex', 2, 7],
                ['aUV', 2, 9]];

  /* ---------- her paint ---------------------------------------------------
   *
   * Classic hulls are dark blue, bottle green, oxblood, black. Not one of
   * those colours is written down here, because `js/palette.js` is the only
   * authority on colour: a world's paint is the hour's own water turned about
   * the grey axis and opened out or closed down, which is exactly the move
   * `SL.waterCharacter` makes on the sea itself. The hour keeps every say in
   * how light she is; the seed only says which way round her paint is turned
   * and how much colour is in it.
   */
  function turnOf(t) {
    return t < 0 ? -Math.pow(-t, 1.6) * 2.45 : 2.25 + t * 1.05;
  }

  function paintCharacter(world) {
    var rnd = world.stream('boat/paint');
    return {
      /* Which way round her paint is turned from the blue of the water. One
       * way runs through teal and bottle green to olive and is taken in small
       * steps, because a dark blue hull is the commonest boat afloat; the
       * other jumps the violets, which no boat has ever been painted, and
       * lands in the oxbloods and the brick reds. */
      turn: turnOf(rnd() * 2 - 1),
      /* Squared, so most worlds get a quiet near-black hull and only a few get
       * a boat that announces its colour from a mile off. */
      chroma: 0.35 + rnd() * rnd() * 1.55,
      deep: rnd(),
      /* And some of them carry a cove stripe under the rail. */
      cove: rnd()
    };
  }

  var RT3 = Math.sqrt(3);

  /* Turn a colour's chroma about the grey axis and scale it. Rodrigues'
   * rotation about (1,1,1), which is the line every grey lies on, so the
   * luminance the hour chose comes through untouched and only the hue moves. */
  function turnHue(c, ang, k) {
    var l = lum(c);
    var dr = c[0] - l, dg = c[1] - l, db = c[2] - l;
    var cs = Math.cos(ang), sn = Math.sin(ang);
    var ax = (dr + dg + db) * (1 - cs) / 3;
    var nr = (dr * cs + (db - dg) / RT3 * sn + ax) * k;
    var ng = (dg * cs + (dr - db) / RT3 * sn + ax) * k;
    var nb = (db * cs + (dg - dr) / RT3 * sn + ax) * k;
    var f = fit(fit(fit(1, l, nr), l, ng), l, nb);
    return [l + nr * f, l + ng * f, l + nb * f];
  }

  /* ---------- the boat -------------------------------------------------- */

  function Boat(world) {
    /* Each world gets a slightly different boat, within a narrow range. */
    this.paint = paintCharacter(world);
    this.sailTint = world.unit('boat/sail');
    this.bobPhase = world.unit('boat/bob') * TAU;
    this.model = new Float32Array(16);
    this.matCol = new Float32Array(15);
    this._w = { h: 0, gx: 0, gz: 0 };
    this._s = { x: 0, y: 0, slope: 0 };
    this.cols = null;
    this.wgx = 0; this.wgz = 0; this.wgc = 0;
    this.boom = 0;
    this.jib = 0;
    this.bulge = 0.85;
    this.spray = 0;
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
    /* The same five reads, turned into the plane the hull is floating on: a
     * height and a gradient in world x and z. The shader wets her topsides off
     * it, so the waterline rides the swell instead of sitting at one height on
     * the paint. `fx, fz` is the way she is pointing and `fz, -fx` is her
     * beam, and the two slopes are the gradient resolved onto them. */
    this.wgx = alongSlope * fx + acrossSlope * fz;
    this.wgz = alongSlope * fz - acrossSlope * fx;
    this.wgc = yc - this.wgx * x - this.wgz * z;
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
    /* How much water she is throwing. Motion is not this file's business, so
     * this reads what she is already doing rather than making her do anything:
     * the way she has on and how steep the sea is under her. It eases, so she
     * throws water in bursts as she comes off a swell and not continuously. */
    this.spray = SL.approach(this.spray,
                             clamp(s.course - 0.45, 0, 1.3) *
                             clamp(Math.abs(alongSlope) * 4.2, 0, 1.15), 0.55, dt);
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
    var p = this.paint;
    /* Her topsides: this hour's water, turned off its blue by however far this
     * world's paint is turned, and always well below the tone of the sea she
     * is sitting on, because a hull is an object on lit water. How far below
     * is the seed's too, so some worlds get a boat that is nearly black and
     * some one that still has some light left in her. */
    var hull = darkerThan(mix(pal.seaNear, pal.skyHor, 0.06), water,
                          lerp(28, 56, p.deep));
    /* Turned after she has been put at her tone and not before, so what is
     * left of the chroma after the hour has had its say is what gets turned.
     * `turnHue` scales back anything that would run off the end of a channel,
     * which is why a nearly black hull comes out nearly black whatever the
     * seed asks for: paint that dark has nowhere to put the colour. */
    hull = turnHue(hull, p.turn, p.chroma);
    /* Cloth, and the one bright note anywhere in the frame. It is cut from the
     * warm end of the hour - the crest colour and the light off the sun or the
     * moon - because the sea is her background and the sea is blue: a sail
     * mixed out of the sky above her comes back the colour of the sky. The
     * seed decides only whether this world's cloth is a white one or a flax
     * one, which is the whole range a working sail is ever found in. */
    var cream = chroma(mix(pal.crest, pal.bodyGlow, 0.24 + pal.light * 0.52),
                       1.02 + pal.light * 0.26);
    var sail = mix(cream, pal.body, 0.04 + this.sailTint * 0.14);
    sail = mix(sail, pal.haze, 0.10 + s.weather.haze * 0.30);
    sail = lighterThan(sail, water, 34);
    /* The sea is her background and the sea is blue, so she carries the warm
     * end of the hour instead: a laid deck, a trunk a shade off it, and
     * brightwork on the spars. Still the palette's colours, only the other
     * side of it. */
    var warm = mix(pal.crest, pal.skyHor, 0.45);
    return {
      hull: hull,
      /* A deck is pale and a hull is dark, and the step between them at the
       * sheer is most of how a boat reads at all. Only a little of her paint
       * comes up onto it, or she goes back to being one coloured mass. */
      deck: mix(mix(hull, warm, 0.82), pal.crest, 0.12),
      cabin: mix(hull, warm, 0.46),
      rig: mix(hull, warm, 0.56),
      /* The cove stripe, in the worlds that carry one: a line of the deck's
       * own colour taken up bright, which is the one light note a dark hull
       * is ever given. */
      trim: lighterThan(mix(warm, pal.crest, 0.30), water, 24),
      coveAmt: smoothstep(0.42, 0.58, p.cove),
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
    var tr = c.trim;

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
    gl.uniform3f(u.uWater, this.wgx, this.wgz, this.wgc);
    gl.uniform4f(u.uTrim, tr[0] / 255, tr[1] / 255, tr[2] / 255, c.coveAmt);
    gl.uniform1f(u.uSun, s.body.vis * (s.body.isMoon ? 0.30 : 1.0) * lerp(0.22, 1.0, s.pal.light));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    SL.glAttribs(gl, p, STRIDE, LAYOUT);
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
    this.cutwater(batch, sea, s);
    this.drawSpray(batch, sea, s);
    this.drawRigging(batch, s);
  };

  /* Where she cuts. A hull meeting the water is the one edge in a seascape
   * that every eye knows by heart, and hers was a clean geometric line with
   * nothing at all on either side of it. A run of broken water down each side,
   * loudest at the bow and again at the quarter where the sea closes behind
   * her, is what says she is going through it rather than resting on a picture
   * of it.
   *
   * It stands up rather than lying flat. The eye is four metres up and looks
   * down about five degrees, so anything laid on the surface is edge-on and
   * worth almost nothing on the glass however wide it is made; the same foam
   * turned to face the eye reads at once. That is also why the flat quads that
   * used to be the bow wave are gone from `foam` and their work is done here.
   */
  Boat.prototype.cutwater = function (batch, sea, s) {
    var foam = s.pal.foam;
    var fr = foam[0] / 255, fg = foam[1] / 255, fb = foam[2] / 255;
    var light = (0.28 + s.pal.light * 0.62) * s.motion;
    var way = clamp(s.course - 0.16, 0, 1.4);
    if (light * way < 0.02) return;
    var ch = Math.cos(s.heading), sh = Math.sin(s.heading);
    var rx = s.camRight[0], ry = s.camRight[1], rz = s.camRight[2];
    var ux = s.camUp[0], uy = s.camUp[1], uz = s.camUp[2];
    var N = 18, side, i;
    for (side = -1; side <= 1; side += 2) {
      for (i = 0; i < N; i++) {
        var t = 0.06 + (i + 0.5) / N * 0.92;
        /* Broken up along her length and over time, so it is never a painted
         * line drawn round a shape. */
        var n = SL.noise2(t * 7.3 + side * 3.1, s.t * 1.45);
        /* A hull makes two waves, one where it opens the water and one where
         * the water closes again behind it, with a quiet stretch amidships
         * between them. */
        var bow = smoothstep(0.30, 0.96, t);
        var quarter = 1 - smoothstep(0.03, 0.34, t);
        var a = (0.16 + bow * 0.80 + quarter * 0.34) * (0.26 + n * 1.10) *
                light * way;
        if (a < 0.015) continue;
        var up = (0.12 + bow * 0.26 + quarter * 0.10) * (0.60 + n * 0.80);
        var lx = side * (beamAt(t) * 0.95 + 0.04 + up * 0.7), lz = rakeZ(t, 0.10);
        var cx = s.boatX + lx * ch + lz * sh;
        var cz = s.boatZ - lx * sh + lz * ch;
        /* Sitting just proud of the surface: the sea in front of it cuts off
         * whatever hangs below, which is what gives it a waterline of its own. */
        var y = sea.heightAt(cx, cz, s.t) + up * 0.40;
        batch.billboard(cx, y, cz, rx, ry, rz, ux, uy, uz, up * 1.25, up * 0.95,
                        0, 0, 1, 1, fr, fg, fb, clamp(a, 0, 0.70));
      }
    }
  };

  /* What she throws. Half a dozen puffs off the stem, each on its own short
   * arc - up, out, and left behind as she sails past them. Nothing is retained
   * between frames here any more than anywhere else in the scene: a puff is
   * simply wherever its own fraction of the clock has got to this frame. */
  Boat.prototype.drawSpray = function (batch, sea, s) {
    var amt = this.spray * (0.30 + s.pal.light * 0.70) * s.motion;
    if (amt < 0.02) return;
    var foam = s.pal.foam;
    var fr = foam[0] / 255, fg = foam[1] / 255, fb = foam[2] / 255;
    var hx = Math.sin(s.heading), hz = Math.cos(s.heading);
    var rx = s.camRight[0], ry = s.camRight[1], rz = s.camRight[2];
    var ux = s.camUp[0], uy = s.camUp[1], uz = s.camUp[2];
    for (var k = 0; k < 8; k++) {
      var g = SL.hash2(k, 31);
      var ph = (s.t * (0.62 + g * 0.45) + k * 0.613) % 1;
      var side = (k & 1) ? 1 : -1;
      /* Thrown out and up, and falling back as she runs out from under it. */
      var out = (0.55 + ph * 1.9) * side;
      var fwd = 4.05 - ph * 3.2;
      var x = s.boatX + hx * fwd + hz * out;
      var z = s.boatZ + hz * fwd - hx * out;
      var lift = ph * (1 - ph) * 4;
      var y = sea.heightAt(x, z, s.t) + 0.10 + lift * (0.55 + g * 0.55);
      var sz = 0.16 + ph * 0.42 + g * 0.10;
      var a = amt * (1 - ph) * (1 - ph) * (0.35 + g * 0.75);
      if (a < 0.01) continue;
      batch.billboard(x, y, z, rx, ry, rz, ux, uy, uz, sz, sz * 0.85,
                      0, 0, 1, 1, fr, fg, fb, clamp(a, 0, 0.42));
    }
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
