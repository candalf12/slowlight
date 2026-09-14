/* slowlight — small numeric + colour helpers shared by every layer of the scene. */
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

  SL.TAU = TAU;
  SL.clamp = clamp;
  SL.lerp = lerp;
  SL.smoothstep = smoothstep;
  SL.approach = approach;
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
})(window.SL);
