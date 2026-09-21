/* slowlight - small numeric, colour and matrix helpers shared by every layer
 * of the scene. Nothing here allocates once the scene is running. */
window.SL = window.SL || {};
(function (SL) {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  /* Frame-rate independent easing: how far to move toward a target in dt seconds. */
  function approach(cur, target, tau, dt) {
    return cur + (target - cur) * (1 - Math.exp(-dt / tau));
  }
  /* Shortest signed way round from `a` to `b` on a circle. */
  function angleDelta(a, b) {
    var d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Integer hash -> [0,1). No lookup table, so the noise field never wraps. */
  function hash2(i, j) {
    var n = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function noise2(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function fbm2(x, y, oct) {
    var s = 0, amp = 0.5, f = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      s += amp * noise2(x * f, y * f);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / norm;
  }

  /* Signed fbm in [-1,1]. */
  function sfbm(x, y, oct) { return fbm2(x, y, oct) * 2 - 1; }

  function hex(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function css(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
  }
  /* Pull a colour toward its own luminance; used for weather desaturation. */
  function desat(c, amount) {
    var l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    return mix(c, [l, l, l], amount);
  }
  function brighten(c, k) {
    return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)];
  }
  /* Palette colours are 0..255; shaders want 0..1. Writes in place. */
  function putColor(arr, at, c) {
    arr[at] = c[0] / 255; arr[at + 1] = c[1] / 255; arr[at + 2] = c[2] / 255;
  }

  /* ---------- 4x4 matrices ----------------------------------------------
   *
   * Column-major, the layout WebGL wants, and always written into a caller's
   * Float32Array so the draw path never allocates one.
   */

  function m4identity(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  }

  function m4perspective(o, fovY, aspect, near, far) {
    var f = 1 / Math.tan(fovY * 0.5), nf = 1 / (near - far);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
    o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  }

  function m4ortho(o, l, r, b, t, n, f) {
    o[0] = 2 / (r - l); o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 2 / (t - b); o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = -2 / (f - n); o[11] = 0;
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b);
    o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  }

  function m4lookAt(o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    var zx = ex - cx, zy = ey - cy, zz = ez - cz;
    var l = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (l < 1e-6) { zx = 0; zy = 0; zz = 1; l = 1; }
    l = 1 / l; zx *= l; zy *= l; zz *= l;
    var xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    l = Math.sqrt(xx * xx + xy * xy + xz * xz);
    if (l < 1e-6) { xx = 1; xy = 0; xz = 0; l = 1; }
    l = 1 / l; xx *= l; xy *= l; xz *= l;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez);
    o[13] = -(yx * ex + yy * ey + yz * ez);
    o[14] = -(zx * ex + zy * ey + zz * ez);
    o[15] = 1;
    return o;
  }

  function m4mul(o, a, b) {
    for (var c = 0; c < 4; c++) {
      var b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      o[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
      o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
      o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return o;
  }

  /* A boat's own frame: heading about Y, then pitch about X, then heel about Z. */
  function m4model(o, x, y, z, yaw, pitch, roll, sc) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cr = Math.cos(roll), sr = Math.sin(roll);
    /* R = Ry * Rx * Rz */
    var r00 = cy * cr + sy * sp * sr, r01 = -cy * sr + sy * sp * cr, r02 = sy * cp;
    var r10 = cp * sr,                r11 = cp * cr,                 r12 = -sp;
    var r20 = -sy * cr + cy * sp * sr, r21 = sy * sr + cy * sp * cr, r22 = cy * cp;
    o[0] = r00 * sc; o[1] = r10 * sc; o[2] = r20 * sc; o[3] = 0;
    o[4] = r01 * sc; o[5] = r11 * sc; o[6] = r21 * sc; o[7] = 0;
    o[8] = r02 * sc; o[9] = r12 * sc; o[10] = r22 * sc; o[11] = 0;
    o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
    return o;
  }

  /* Project a world point with a view-projection matrix. Writes [x, y, w] into
   * `out` in clip space; the caller decides what to do behind the eye. */
  function m4project(m, x, y, z, out) {
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return out;
  }

  SL.TAU = TAU;
  SL.clamp = clamp;
  SL.lerp = lerp;
  SL.smoothstep = smoothstep;
  SL.approach = approach;
  SL.angleDelta = angleDelta;
  SL.mulberry32 = mulberry32;
  SL.hash2 = hash2;
  SL.noise2 = noise2;
  SL.fbm2 = fbm2;
  SL.sfbm = sfbm;
  SL.hex = hex;
  SL.mix = mix;
  SL.css = css;
  SL.rgba = rgba;
  SL.desat = desat;
  SL.brighten = brighten;
  SL.putColor = putColor;
  SL.m4identity = m4identity;
  SL.m4perspective = m4perspective;
  SL.m4ortho = m4ortho;
  SL.m4lookAt = m4lookAt;
  SL.m4mul = m4mul;
  SL.m4model = m4model;
  SL.m4project = m4project;
})(window.SL);
