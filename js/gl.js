/* slowlight — the WebGL floor.
 *
 * Context, programs, buffers, textures, and the one chunk of GLSL every other
 * shader shares: the sky. The sea reflects it, the land and the water fog into
 * it, and the sky pass itself draws it, so all three agree on the light by
 * calling the same function rather than by three sets of constants that drift
 * apart. `js/palette.js` is still the authority — every colour below arrives
 * as a uniform sampled from it.
 */
(function (SL) {
  'use strict';

  function context(canvas) {
    var opts = {
      alpha: false, antialias: true, depth: true, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'default', failIfMajorPerformanceCaveat: false
    };
    var gl = null;
    try { gl = canvas.getContext('webgl2', opts); } catch (e) { /* try the next */ }
    if (!gl) { try { gl = canvas.getContext('webgl', opts); } catch (e2) { /* and the next */ } }
    if (!gl) { try { gl = canvas.getContext('experimental-webgl', opts); } catch (e3) { /* none */ } }
    return gl || null;
  }

  function shader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader: ' + log);
    }
    return sh;
  }

  /* A linked program with its uniform and attribute locations already looked
   * up, so nothing in the draw path ever asks the driver for one. */
  function program(gl, vsSrc, fsSrc) {
    var vs = shader(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = shader(gl, gl.FRAGMENT_SHADER, fsSrc);
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error('link: ' + log);
    }
    var o = { p: p, u: {}, a: {} };
    var i, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (i = 0; i < n; i++) {
      var ui = gl.getActiveUniform(p, i);
      o.u[ui.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, ui.name);
    }
    n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (i = 0; i < n; i++) {
      var ai = gl.getActiveAttrib(p, i);
      o.a[ai.name] = gl.getAttribLocation(p, ai.name);
    }
    return o;
  }

  function buffer(gl, target, data, usage) {
    var b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage || gl.STATIC_DRAW);
    return b;
  }

  function texture(gl, source, wrapS, wrapT) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /* Bind a tightly packed interleaved vertex layout in one call.
   * `spec` is [name, size, offsetInFloats] triples against `stride` floats. */
  function attribs(gl, prog, stride, spec) {
    var bytes = stride * 4;
    for (var i = 0; i < spec.length; i++) {
      var loc = prog.a[spec[i][0]];
      if (loc === undefined || loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, spec[i][1], gl.FLOAT, false, bytes, spec[i][2] * 4);
    }
  }

  function disableAttribs(gl, prog, spec) {
    for (var i = 0; i < spec.length; i++) {
      var loc = prog.a[spec[i][0]];
      if (loc === undefined || loc < 0) continue;
      gl.disableVertexAttribArray(loc);
    }
  }

  /* ---------- the shared sky ------------------------------------------- */

  /* Declarations, then the sky itself. Any shader that needs to know what the
   * light is doing pastes both in and gets its uniforms filled by `setAir`. */
  var AIR_DECL = [
    'precision highp float;',
    'uniform vec3 uSkyTop, uSkyMid, uSkyHor, uHazeC, uBodyGlow, uBodyCol;',
    'uniform vec3 uSeaFar, uSeaNear, uCrest, uFoam, uIslandC;',
    'uniform vec3 uBodyDir;',
    'uniform vec4 uMoon;',    /* xyz: the axis its shadow falls along, w: phase */
    'uniform vec4 uAir;',     /* haze, rain, light, body visibility */
    'uniform vec4 uBody2;',   /* disc radius, is-moon, glow spread, horizon band */
    'uniform float uFogD, uT;'
  ].join('\n');

  var AIR_SKY = [
    'vec3 skyGrad(float ang) {',
    /* The same five stops the 2D sky was painted with, read off elevation
     * instead of off screen height, so the grade is the one it always was. */
    '  float k = clamp(1.0 - ang / 1.15, 0.0, 1.0);',
    '  vec3 hi = mix(uSkyTop, uSkyMid, 0.85);',
    '  vec3 lo = mix(uSkyMid, uSkyHor, 0.80);',
    '  if (k < 0.42) return mix(uSkyTop, hi, k / 0.42);',
    '  if (k < 0.74) return mix(hi, uSkyMid, (k - 0.42) / 0.32);',
    '  if (k < 0.94) return mix(uSkyMid, lo, (k - 0.74) / 0.20);',
    '  return mix(lo, uSkyHor, (k - 0.94) / 0.06);',
    '}',
    '',
    'vec3 skyColor(vec3 d, float withDisc) {',
    '  float ang = asin(clamp(d.y, -1.0, 1.0));',
    '  vec3 c = skyGrad(max(ang, 0.0));',
    /* The soft band of light sitting directly on the horizon. */
    '  float t = max(ang, 0.0) / 0.135;',
    '  c = mix(c, uHazeC, exp(-t * t) * uBody2.w);',
    '  float vis = uAir.w;',
    '  if (vis > 0.004) {',
    '    float bang = acos(clamp(dot(d, uBodyDir), -1.0, 1.0));',
    '    float g = uBody2.z;',
    '    c += uBodyGlow * (exp(-bang / g) * 0.30 + exp(-bang / (g * 3.6)) * 0.13) * vis;',
    '    if (withDisc > 0.5) {',
    '      float disc = smoothstep(uBody2.x * 1.45, uBody2.x * 0.55, bang);',
    '      vec3 dc = uBodyCol;',
    /* A gentle terminator, so the moon has a phase rather than being a dot. */
    '      float side = dot(d - uBodyDir * dot(d, uBodyDir), uMoon.xyz) / max(uBody2.x, 1e-4);',
    '      dc = mix(dc, uSkyTop, uBody2.y * smoothstep(-0.9, 1.0, side + uMoon.w) * 0.52);',
    '      c = mix(c, dc, disc * vis * 0.94);',
    '    }',
    '  }',
    '  return c;',
    '}',
    '',
    /* What everything at an unreachable distance settles to: the sky exactly
     * at the horizon, in the direction you are looking. Fogging to this is
     * what keeps the far water from ever showing an edge. */
    'vec3 hazeSeam(vec3 d) {',
    '  vec2 f = d.xz;',
    '  float l = length(f);',
    '  vec3 h = l > 1e-4 ? vec3(f.x / l, 0.0, f.y / l) : vec3(0.0, 0.0, 1.0);',
    '  return skyColor(h, 0.0);',
    '}',
    '',
    'float fogAmount(float dist) {',
    '  float q = dist / uFogD;',
    '  return 1.0 - exp(-q * q);',
    '}',
    '',
    /* Eight-bit banding is loud in a dark, smooth sky. A little noise under
     * the last bit costs nothing and the eye reads it as air. */
    'float dither(vec2 p) {',
    '  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);',
    '}'
  ].join('\n');

  var C3 = new Float32Array(3);
  var C4 = new Float32Array(4);

  function u3(gl, loc, c) {
    if (!loc) return;
    C3[0] = c[0] / 255; C3[1] = c[1] / 255; C3[2] = c[2] / 255;
    gl.uniform3fv(loc, C3);
  }
  function u3raw(gl, loc, x, y, z) {
    if (!loc) return;
    C3[0] = x; C3[1] = y; C3[2] = z;
    gl.uniform3fv(loc, C3);
  }
  function u4(gl, loc, x, y, z, w) {
    if (!loc) return;
    C4[0] = x; C4[1] = y; C4[2] = z; C4[3] = w;
    gl.uniform4fv(loc, C4);
  }

  /* Fill the shared block from the scene state. Called once per program per
   * frame; there are only a handful of programs. */
  function setAir(gl, prog, s) {
    var pal = s.pal, u = prog.u, b = s.body, w = s.weather;
    u3(gl, u.uSkyTop, pal.skyTop);
    u3(gl, u.uSkyMid, pal.skyMid);
    u3(gl, u.uSkyHor, pal.skyHor);
    u3(gl, u.uHazeC, pal.haze);
    u3(gl, u.uBodyGlow, pal.bodyGlow);
    u3(gl, u.uBodyCol, pal.body);
    u3(gl, u.uSeaFar, pal.seaFar);
    u3(gl, u.uSeaNear, pal.seaNear);
    u3(gl, u.uCrest, pal.crest);
    u3(gl, u.uFoam, pal.foam);
    u3(gl, u.uIslandC, pal.island);
    u3raw(gl, u.uBodyDir, b.dx, b.dy, b.dz);
    u4(gl, u.uMoon, b.mx, b.my, b.mz, b.moonPhase);
    u4(gl, u.uAir, w.haze, w.rain, pal.light, b.vis);
    u4(gl, u.uBody2, b.radius, b.isMoon ? 1 : 0, b.glow, s.hazeBand);
    if (u.uFogD) gl.uniform1f(u.uFogD, s.fogD);
    if (u.uT) gl.uniform1f(u.uT, s.t);
  }

  SL.glContext = context;
  SL.glProgram = program;
  SL.glBuffer = buffer;
  SL.glTexture = texture;
  SL.glAttribs = attribs;
  SL.glDisableAttribs = disableAttribs;
  SL.GLSL_AIR = AIR_DECL + '\n' + AIR_SKY;
  SL.GLSL_AIR_DECL = AIR_DECL;
  SL.setAir = setAir;
})(window.SL);
