/* slowlight — the sea.
 *
 * One surface now, not a stack of bands: a camera-centred polar grid of water
 * whose rings grow geometrically outward, so the metre in front of the bow is
 * dense and the kilometre at the horizon is nearly free. It reaches far enough
 * that its outer edge lands within a pixel of the true horizon, and by then it
 * has fogged to exactly the colour the sky has at the horizon, so the sea has
 * no edge to find.
 *
 * Height is a sum of six travelling waves with incommensurate directions and
 * wavelengths, modulated by a slow group envelope — the same idea the bands
 * used, in two dimensions. Nothing is stored: the surface is a pure function of
 * world position and `s.t`, evaluated in the vertex shader for the picture and
 * mirrored on the CPU (`sample`) for the boat, the camera and the wake.
 *
 * World coordinates are unbounded, and float32 is not. Everything handed to the
 * GPU is therefore in a *local* frame rebased near the boat (`s.orgX/orgZ`);
 * the part of each wave's phase that belongs to the origin is folded into its
 * phase offset in double precision, so rebasing never moves the water.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, TAU = SL.TAU;

  var RINGS = 176, SECTORS = 192;
  var R0 = 0.6, RMAX = 6000;
  var WAVES = 6, MICRO = 3;
  var GRAV = 6.2;              /* slowed from the real thing; this is a calm sea */
  var RIPPLE_CELL = 1.28;

  /* Wavelength and share of the swell for each component, longest first. */
  var WAVE_L = [72, 47, 29, 17.5, 10.4, 6.2];
  var WAVE_A = [0.70, 0.45, 0.29, 0.170, 0.098, 0.057];

  var VERT = [
    'precision highp float;',
    'attribute vec2 aGrid;',
    'uniform mat4 uViewProj;',
    'uniform vec3 uEye;',
    'uniform vec2 uCenter;',
    'uniform vec2 uRing;',        /* r0, ln(rmax/r0) */
    'uniform float uSpacing, uT, uAmpRef;',
    'uniform vec4 uWaveA[6];',    /* dirX, dirZ, k, amp */
    'uniform vec2 uWaveB[6];',    /* omega, folded phase */
    'uniform vec4 uGroup;',       /* two folded group phases, unused .zw */
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    'varying float vDist;',
    'varying float vLift;',
    'varying float vBreak;',
    '',
    'void main() {',
    '  float r = uRing.x * exp(uRing.y * aGrid.x);',
    '  vec2 p = uCenter + vec2(cos(aGrid.y), sin(aGrid.y)) * r;',
    /* Two kinds of falloff. The first drops any wave the grid can no longer
     * carry at this radius, which is what keeps the far water from crawling;
     * the second settles the whole surface down with distance. */
    '  float spacing = r * uSpacing;',
    '  float far = exp(-pow(max(r - 60.0, 0.0) / 420.0, 1.6));',
    '  float h = 0.0;',
    '  vec2 g = vec2(0.0);',
    '  float brk = 0.0;',
    '  for (int i = 0; i < 6; i++) {',
    '    vec4 A = uWaveA[i];',
    '    vec2 B = uWaveB[i];',
    '    float lod = 1.0 - smoothstep(0.20, 0.44, spacing * A.z * 0.15915494);',
    '    float a = A.w * lod * far;',
    '    float ph = dot(A.xy, p) * A.z - B.x * uT + B.y;',
    '    h += a * sin(ph);',
    '    g += A.xy * (a * A.z * cos(ph));',
    '    if (i < 3) brk += ph * (0.31 + float(i) * 1.37);',
    '  }',
    /* Water arrives in groups: some stretches run high, some lie flat. */
    '  float grp = 0.74 + 0.30 * sin(dot(p, vec2(0.0121, 0.0089)) - uT * 0.090 + uGroup.x)',
    '                          * sin(dot(p, vec2(-0.0073, 0.0134)) + uT * 0.061 + uGroup.y);',
    '  h *= grp; g *= grp;',
    '  vec3 w = vec3(p.x, h, p.y);',
    '  vWorld = w;',
    '  vNrm = normalize(vec3(-g.x, 1.0, -g.y));',
    '  vDist = distance(w, uEye);',
    '  vLift = clamp(h / max(uAmpRef, 0.001), -1.2, 1.2);',
    /* Carried by the long waves themselves, so the foam is anchored to the
     * water and not to a noise field that would slide when the origin is
     * rebased. Left raw: the fragment shader takes the sine, or interpolating
     * one across a triangle would beat against the grid. */
    '  vBreak = brk;',
    '  gl_Position = uViewProj * vec4(w, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    SL.GLSL_AIR,
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    'varying float vDist;',
    'varying float vLift;',
    'varying float vBreak;',
    'uniform vec3 uEye;',
    'uniform float uWind, uMotion, uSpecK, uFoamK, uRipK;',
    'uniform vec4 uMicroA[3];',
    'uniform vec2 uMicroB[3];',
    '',
    'void main() {',
    '  vec3 V = normalize(uEye - vWorld);',
    /* Detail the grid is too coarse to carry, kept soft and close to hand. */
    '  float near = exp(-vDist / 240.0);',
    '  vec2 g = vec2(0.0);',
    '  for (int i = 0; i < 3; i++) {',
    '    vec4 A = uMicroA[i];',
    '    vec2 B = uMicroB[i];',
    '    g += A.xy * (A.w * cos(dot(A.xy, vWorld.xz) * A.z - B.x * uT + B.y));',
    '  }',
    '  vec3 N = normalize(vNrm + vec3(-g.x, 0.0, -g.y) * near * uWind * uMotion);',
    '  float ndv = clamp(dot(N, V), 0.0, 1.0);',
    '',
    /* Near water is deep water and reads darker for it; far water lightens
     * toward the horizon exactly as the band stack used to. */
    '  float dk = clamp(vDist / 300.0, 0.0, 1.0);',
    '  vec3 deep = mix(uSeaNear, vec3(0.010, 0.020, 0.042), 0.26);',
    '  vec3 base = mix(deep, uSeaFar, smoothstep(0.0, 1.0, pow(dk, 0.50)));',
    /* The trough of a swell sits in the shadow of the one in front. */
    '  base = mix(base, base * 0.52, clamp(-vLift, 0.0, 1.0) * 0.55);',
    '',
    /* The surface reflects the sky it is under — strongly at a grazing angle,
     * barely at all underfoot. Held well short of a mirror on purpose: the sky
     * it hands back is deliberately a little darker than the sky itself. */
    '  vec3 refl = skyColor(reflect(-V, N), 0.0) * (0.78 + 0.14 * uAir.z);',
    '  float F = clamp(0.028 + 0.58 * pow(1.0 - ndv, 5.0), 0.0, 0.62);',
    '  vec3 col = mix(base, refl, F);',
    /* A face turned toward the light lifts, one turned away falls — this is
     * what makes a swell read as a shape rather than as a sheet. */
    '  col *= 0.86 + 0.26 * clamp(dot(N, uBodyDir), -1.0, 1.0) * (0.3 + 0.7 * uAir.z);',
    '',
    /* Light coming up through the top of a swell. */
    '  float crest = clamp(vLift, 0.0, 1.0);',
    '  col += uCrest * (crest * crest) * (0.045 + 0.10 * uAir.z);',
    '',
    /* The path of the sun or moon: wide and low rather than a hot point. */
    '  vec3 H = normalize(V + uBodyDir);',
    '  float nh = max(dot(N, H), 0.0);',
    '  float sp = pow(nh, 130.0) * 0.46 + pow(nh, 18.0) * 0.075;',
    '  col += mix(uCrest, uBodyGlow, 0.55) * sp * uSpecK;',
    '',
    /* Wind tears a little foam off the tops, broken up by the swell itself. */
    '  float steep = length(vec2(N.x, N.z));',
    '  float fm = smoothstep(0.52, 0.98, crest) * smoothstep(0.05, 0.17, steep);',
    '  fm *= uFoamK * smoothstep(0.35, 0.95, 0.5 + 0.5 * sin(vBreak)) * near;',
    '  col = mix(col, uFoam, clamp(fm, 0.0, 0.30));',
    '',
    /* Rain, where it lands. A stipple of rings, close by and faint — at any
     * distance at all this is a texture on the water, not a pattern in it. */
    '  if (uRipK > 0.004) {',
    '    vec2 cell = floor(vWorld.xz / ' + RIPPLE_CELL.toFixed(2) + ');',
    '    float seed = fract(sin(dot(cell, vec2(41.7, 289.3))) * 21713.71);',
    '    float pick = fract(seed * 31.7);',
    '    if (pick > 0.42) {',
    '      float k = fract(uT * 1.6 + seed);',
    '      vec2 c = (cell + 0.5 + 0.30 * vec2(seed - 0.5, pick - 0.5)) * ' + RIPPLE_CELL.toFixed(2) + ';',
    '      float rr = k * 0.24;',
    '      float d = abs(length(vWorld.xz - c) - rr);',
    '      float ring = exp(-d * d * 3400.0) * (1.0 - k) * (1.0 - k);',
    '      col = mix(col, uFoam, clamp(ring * uRipK * exp(-vDist / 13.0), 0.0, 0.075));',
    '    }',
    '  }',
    '',
    '  col = mix(col, hazeSeam(normalize(vWorld - uEye)), fogAmount(vDist));',
    '  col += (dither(gl_FragCoord.xy) - 0.5) * (1.6 / 255.0);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var LAYOUT = [['aGrid', 2, 0]];

  function Sea(world) {
    this.world = world;
    var rnd = world.stream('sea3');
    /* One prevailing direction per world, with each component leaning off it. */
    var base = rnd() * TAU;
    this.windDir = base;
    this.waves = [];
    var i;
    for (i = 0; i < WAVES; i++) {
      var spread = (rnd() - 0.5) * 1.55 * (i < 2 ? 0.45 : 1);
      var th = base + spread;
      var k = TAU / WAVE_L[i];
      this.waves.push({
        dx: Math.cos(th), dz: Math.sin(th),
        k: k, base: WAVE_A[i], amp: WAVE_A[i],
        omega: Math.sqrt(GRAV * k),
        phase0: rnd() * TAU
      });
    }
    /* Detail below the grid's reach, carried by the fragment shader. */
    this.micro = [];
    for (i = 0; i < MICRO; i++) {
      var mt = base + (rnd() - 0.5) * 2.2;
      var mk = TAU / lerp(3.4, 1.15, i / (MICRO - 1));
      this.micro.push({
        dx: Math.cos(mt), dz: Math.sin(mt), k: mk,
        slope: [0.052, 0.038, 0.026][i],
        omega: Math.sqrt(GRAV * mk), phase0: rnd() * TAU
      });
    }
    this.groupPhase = [rnd() * TAU, rnd() * TAU];

    this.ampScale = 1;
    this.amp = 1;
    this.ready = false;

    this._wa = new Float32Array(WAVES * 4);
    this._wb = new Float32Array(WAVES * 2);
    this._ma = new Float32Array(MICRO * 4);
    this._mb = new Float32Array(MICRO * 2);
    this._grp = new Float32Array(4);
    /* Phases folded against the current origin, kept in double precision. */
    this._ph = new Float64Array(WAVES);
    this._mph = new Float64Array(MICRO);
    this._out = { h: 0, gx: 0, gz: 0 };
  }

  /* ---------- the surface, on the CPU ----------------------------------- */

  /* Amplitudes follow the wind, and reduced motion calms the whole swell. */
  Sea.prototype.setWind = function (wind, motion) {
    var k = (0.46 + clamp(wind, 0, 1.3) * 0.62) * motion;
    this.ampScale = k;
    var total = 0;
    for (var i = 0; i < WAVES; i++) {
      this.waves[i].amp = this.waves[i].base * k;
      total += this.waves[i].amp;
    }
    this.amp = total;
  };

  /* Fold the world origin into every phase, so the shader can work in a local
   * frame small enough for float32 without the water ever shifting. */
  Sea.prototype.rebase = function (orgX, orgZ) {
    var i, w;
    for (i = 0; i < WAVES; i++) {
      w = this.waves[i];
      this._ph[i] = (w.phase0 + (w.dx * orgX + w.dz * orgZ) * w.k) % TAU;
    }
    for (i = 0; i < MICRO; i++) {
      w = this.micro[i];
      this._mph[i] = (w.phase0 + (w.dx * orgX + w.dz * orgZ) * w.k) % TAU;
    }
    this._grp[0] = (this.groupPhase[0] + orgX * 0.0121 + orgZ * 0.0089) % TAU;
    this._grp[1] = (this.groupPhase[1] - orgX * 0.0073 + orgZ * 0.0134) % TAU;
  };

  /* Height and surface gradient at a point in the *local* frame — the same
   * frame the vertex shader works in, and with the same origin-folded phases,
   * so the boat floats on exactly the water that is drawn. Minus the distance
   * falloffs, which are ~1 everywhere the boat, the camera and the wake read.
   * One reusable result object. */
  Sea.prototype.sample = function (x, z, t, out) {
    var o = out || this._out;
    var h = 0, gx = 0, gz = 0;
    for (var i = 0; i < WAVES; i++) {
      var w = this.waves[i];
      var ph = (w.dx * x + w.dz * z) * w.k - w.omega * t + this._ph[i];
      h += w.amp * Math.sin(ph);
      var c = Math.cos(ph) * w.amp * w.k;
      gx += w.dx * c;
      gz += w.dz * c;
    }
    var grp = 0.74 + 0.30 *
      Math.sin(x * 0.0121 + z * 0.0089 - t * 0.090 + this._grp[0]) *
      Math.sin(-x * 0.0073 + z * 0.0134 + t * 0.061 + this._grp[1]);
    o.h = h * grp;
    o.gx = gx * grp;
    o.gz = gz * grp;
    return o;
  };

  Sea.prototype.heightAt = function (x, z, t) {
    return this.sample(x, z, t, this._out).h;
  };

  /* ---------- the surface, on the GPU ----------------------------------- */

  Sea.prototype.init = function (gl) {
    this.gl = gl;
    this.prog = SL.glProgram(gl, VERT, FRAG);

    var verts = new Float32Array((RINGS + 1) * SECTORS * 2);
    var n = 0, i, j;
    for (i = 0; i <= RINGS; i++) {
      var rt = i / RINGS;
      for (j = 0; j < SECTORS; j++) {
        verts[n++] = rt;
        verts[n++] = j / SECTORS * TAU;
      }
    }
    var idx = new Uint16Array(RINGS * SECTORS * 6);
    n = 0;
    for (i = 0; i < RINGS; i++) {
      for (j = 0; j < SECTORS; j++) {
        var j1 = (j + 1) % SECTORS;
        var a = i * SECTORS + j, b = i * SECTORS + j1;
        var c = (i + 1) * SECTORS + j, d = (i + 1) * SECTORS + j1;
        idx[n++] = a; idx[n++] = c; idx[n++] = d;
        idx[n++] = a; idx[n++] = d; idx[n++] = b;
      }
    }
    this.vbo = SL.glBuffer(gl, gl.ARRAY_BUFFER, verts);
    this.ibo = SL.glBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, idx);
    this.count = idx.length;
    this.ringLog = Math.log(RMAX / R0);
    this.spacing = Math.exp(this.ringLog / RINGS) - 1;
    this.ready = true;
  };

  Sea.prototype.draw = function (gl, s) {
    var p = this.prog, u = p.u, i, w;
    gl.useProgram(p.p);
    SL.setAir(gl, p, s);

    for (i = 0; i < WAVES; i++) {
      w = this.waves[i];
      this._wa[i * 4] = w.dx; this._wa[i * 4 + 1] = w.dz;
      this._wa[i * 4 + 2] = w.k; this._wa[i * 4 + 3] = w.amp;
      this._wb[i * 2] = w.omega; this._wb[i * 2 + 1] = this._ph[i];
    }
    for (i = 0; i < MICRO; i++) {
      w = this.micro[i];
      this._ma[i * 4] = w.dx; this._ma[i * 4 + 1] = w.dz;
      this._ma[i * 4 + 2] = w.k; this._ma[i * 4 + 3] = w.slope;
      this._mb[i * 2] = w.omega; this._mb[i * 2 + 1] = this._mph[i];
    }
    gl.uniform4fv(u.uWaveA, this._wa);
    gl.uniform2fv(u.uWaveB, this._wb);
    gl.uniform4fv(u.uMicroA, this._ma);
    gl.uniform2fv(u.uMicroB, this._mb);
    gl.uniform4fv(u.uGroup, this._grp);

    gl.uniformMatrix4fv(u.uViewProj, false, s.viewProj);
    gl.uniform3f(u.uEye, s.eyeX, s.eyeY, s.eyeZ);
    gl.uniform2f(u.uCenter, s.eyeX, s.eyeZ);
    gl.uniform2f(u.uRing, R0, this.ringLog);
    gl.uniform1f(u.uSpacing, this.spacing);
    gl.uniform1f(u.uMotion, s.motion);
    gl.uniform1f(u.uAmpRef, Math.max(this.amp, 0.05));
    gl.uniform1f(u.uWind, clamp(s.wind, 0, 1.3));
    gl.uniform1f(u.uFoamK, clamp((s.wind - 0.26) * 1.35, 0, 1) * s.motion * (0.35 + s.pal.light * 0.75));
    gl.uniform1f(u.uSpecK, s.specK);
    gl.uniform1f(u.uRipK, clamp(s.weather.rain * 1.3, 0, 1) * (0.28 + s.pal.light * 0.8) * s.motion);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    SL.glAttribs(gl, p, 2, LAYOUT);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    SL.glDisableAttribs(gl, p, LAYOUT);
  };

  SL.Sea = Sea;
  SL.SEA_RMAX = RMAX;
})(window.SL);
