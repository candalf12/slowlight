/* slowlight — what is between the scene and the eye.
 *
 * Rain, which falls on the glass rather than in the world, and the last pass:
 * a vignette, a breath of haze, and the film grain the picture has always had.
 * Both work in screen pixels, so both share one orthographic matrix.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp;

  var POST_VERT = [
    'precision highp float;',
    'attribute vec2 aPos;',
    'varying vec2 vUV;',
    'void main() {',
    '  vUV = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var POST_FRAG = [
    'precision mediump float;',
    'uniform sampler2D uGrain;',
    'uniform vec2 uGrainScale;',
    'uniform vec3 uHazeC;',
    'uniform vec4 uPost;',   /* vignette, grain, haze, — */
    'varying vec2 vUV;',
    'void main() {',
    '  float d = distance(vUV, vec2(0.5, 0.52)) * 1.62;',
    '  float vig = smoothstep(0.34, 1.0, d) * uPost.x;',
    '  float hz = uPost.z;',
    '  float a = clamp(vig + hz, 0.0, 0.92);',
    '  float share = a > 0.0001 ? hz / a : 0.0;',
    '  vec3 tint = uHazeC * share;',
    /* Premultiplied, so the grain can lift as well as sit. */
    '  float g = (texture2D(uGrain, vUV * uGrainScale).r - 0.5) * uPost.y;',
    '  gl_FragColor = vec4(tint * a + vec3(g), a);',
    '}'
  ].join('\n');

  var POST_LAYOUT = [['aPos', 2, 0]];

  function grainTexture(gl) {
    var n = 128;
    var c = SL.glCanvas(n, n);
    var g = c.getContext('2d');
    var img = g.createImageData(n, n);
    var d = img.data;
    /* Deterministic, and static once built — static grain never flickers. */
    var r = SL.mulberry32(0x5105117);
    for (var i = 0; i < n * n; i++) {
      var v = (r() * 255) | 0;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return SL.glTexture(gl, c, gl.REPEAT, gl.REPEAT);
  }

  function Overlay(gl) {
    this.gl = gl;
    this.prog = SL.glProgram(gl, POST_VERT, POST_FRAG);
    this.vbo = SL.glBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]));
    this.grain = grainTexture(gl);
    this.ortho = new Float32Array(16);
    this.col = new Float32Array(3);
  }

  Overlay.prototype.setSize = function (W, H) {
    SL.m4ortho(this.ortho, 0, W, H, 0, -1, 1);
  };

  /* Rain: straight lines on the glass, leaning with the wind. The world's own
   * answer to it — rings on the water — is in the sea shader. */
  Overlay.prototype.drawRain = function (batch, s) {
    var weather = s.weather;
    if (weather.dropCount < 1) return;
    var tint = SL.mix(s.pal.haze, [225, 232, 238], 0.5);
    var tr = tint[0] / 255, tg = tint[1] / 255, tb = tint[2] / 255;
    var slant = 0.16 + weather.wind * 0.42;
    var wet = clamp(weather.rain * 1.4, 0, 1);
    batch.begin(this.ortho);
    for (var i = 0; i < weather.dropCount; i++) {
      var d = weather.drops[i];
      var l = d.len * d.depth;
      var a = d.a * d.depth * wet;
      if (a < 0.01) continue;
      var x0 = d.x, y0 = d.y, x1 = d.x + l * slant, y1 = d.y + l;
      var dx = x1 - x0, dy = y1 - y0;
      var ln = Math.sqrt(dx * dx + dy * dy) || 1;
      var w = (0.6 + d.depth * 0.8) * 1.6;
      var nx = -dy / ln * w, ny = dx / ln * w;
      batch.quad(
        x0 - nx, y0 - ny, 0, x1 - nx, y1 - ny, 0,
        x1 + nx, y1 + ny, 0, x0 + nx, y0 + ny, 0,
        0.06, 0.5, 0.94, 0.5, tr, tg, tb, clamp(a, 0, 0.6));
    }
    batch.flush(batch.dot);
  };

  Overlay.prototype.draw = function (s) {
    var gl = this.gl, p = this.prog, u = p.u;
    var weather = s.weather;
    gl.useProgram(p.p);
    SL.putColor(this.col, 0, s.pal.haze);
    gl.uniform3fv(u.uHazeC, this.col);
    gl.uniform4f(u.uPost, 0.30,
                 0.034,
                 clamp(weather.haze * 0.13 + weather.rain * 0.09, 0, 0.22),
                 0);
    gl.uniform2f(u.uGrainScale, s.W * s.dpr / 128, s.H * s.dpr / 128);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.grain);
    gl.uniform1i(u.uGrain, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    SL.glAttribs(gl, p, 2, POST_LAYOUT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    SL.glDisableAttribs(gl, p, POST_LAYOUT);
  };

  SL.Overlay = Overlay;
})(window.SL);
