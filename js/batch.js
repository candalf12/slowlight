/* slowlight — the soft things.
 *
 * Everything in the scene that is a coloured, textured triangle rather than a
 * surface — clouds, birds, the wake, rain, a meteor, the cabin lamp — goes
 * through one dynamic batch. It owns a single pre-allocated vertex array that
 * is rewritten in place every frame and uploaded once per flush, so the draw
 * path allocates nothing however much is going on.
 */
(function (SL) {
  'use strict';

  var FLOATS = 9;              /* pos3, uv2, rgba4 */

  var VERT = [
    'precision highp float;',
    'attribute vec3 aPos;',
    'attribute vec2 aUV;',
    'attribute vec4 aCol;',
    'uniform mat4 uViewProj;',
    'varying vec2 vUV;',
    'varying vec4 vCol;',
    'void main() {',
    '  vUV = aUV;',
    '  vCol = aCol;',
    '  gl_Position = uViewProj * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'precision mediump float;',
    'uniform sampler2D uTex;',
    'varying vec2 vUV;',
    'varying vec4 vCol;',
    'void main() {',
    '  vec4 t = texture2D(uTex, vUV);',
    '  gl_FragColor = vec4(vCol.rgb * t.rgb, vCol.a * t.a);',
    '}'
  ].join('\n');

  var LAYOUT = [['aPos', 3, 0], ['aUV', 2, 3], ['aCol', 4, 5]];

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* A flat white pixel, for everything that wants no texture at all. */
  function whiteTexture(gl) {
    var c = canvasOf(1, 1);
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 1, 1);
    return SL.glTexture(gl, c);
  }

  /* A soft round falloff — the shape every glow in the scene is made of. */
  function dotTexture(gl) {
    var n = 64;
    var c = canvasOf(n, n);
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.42, 'rgba(255,255,255,0.42)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, n, n);
    return SL.glTexture(gl, c);
  }

  function Batch(gl, maxVerts) {
    this.gl = gl;
    this.max = maxVerts;
    this.data = new Float32Array(maxVerts * FLOATS);
    this.n = 0;
    this.prog = SL.glProgram(gl, VERT, FRAG);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.white = whiteTexture(gl);
    this.dot = dotTexture(gl);
    this.vp = null;
    /* Uploading a view of the array avoids copying it, but WebGL 1 has no
     * ranged bufferSubData, and a fresh view per flush would be litter. A
     * handful of power-of-two views covers every batch the scene ever sends;
     * the spare vertices at the end are uploaded and never drawn. */
    this.views = [];
    for (var b = 256; b < maxVerts; b *= 2) {
      this.views.push({ n: b, view: this.data.subarray(0, b * FLOATS) });
    }
    this.views.push({ n: maxVerts, view: this.data });
  }

  Batch.prototype.upload = function (n) {
    for (var i = 0; i < this.views.length; i++) {
      if (this.views[i].n >= n) return this.views[i].view;
    }
    return this.data;
  };

  Batch.prototype.begin = function (viewProj) {
    this.vp = viewProj;
    this.n = 0;
  };

  Batch.prototype.vertex = function (x, y, z, u, v, r, g, b, a) {
    if (this.n >= this.max) return;
    var d = this.data, i = this.n * FLOATS;
    d[i] = x; d[i + 1] = y; d[i + 2] = z;
    d[i + 3] = u; d[i + 4] = v;
    d[i + 5] = r; d[i + 6] = g; d[i + 7] = b; d[i + 8] = a;
    this.n++;
  };

  /* Two triangles from four corners given in order: a b c d around the quad. */
  Batch.prototype.quad = function (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
                                   u0, v0, u1, v1, r, g, b, a) {
    if (this.n + 6 > this.max) return;
    this.vertex(ax, ay, az, u0, v0, r, g, b, a);
    this.vertex(bx, by, bz, u1, v0, r, g, b, a);
    this.vertex(cx, cy, cz, u1, v1, r, g, b, a);
    this.vertex(ax, ay, az, u0, v0, r, g, b, a);
    this.vertex(cx, cy, cz, u1, v1, r, g, b, a);
    this.vertex(dx, dy, dz, u0, v1, r, g, b, a);
  };

  /* A camera-facing quad of half-size (hw, hh) about a world point, held
   * upright against `up` rather than rolling with the camera. */
  Batch.prototype.billboard = function (x, y, z, rx, ry, rz, ux, uy, uz, hw, hh,
                                        u0, v0, u1, v1, r, g, b, a) {
    var axx = rx * hw, axy = ry * hw, axz = rz * hw;
    var ayx = ux * hh, ayy = uy * hh, ayz = uz * hh;
    this.quad(
      x - axx + ayx, y - axy + ayy, z - axz + ayz,
      x + axx + ayx, y + axy + ayy, z + axz + ayz,
      x + axx - ayx, y + axy - ayy, z + axz - ayz,
      x - axx - ayx, y - axy - ayy, z - axz - ayz,
      u0, v0, u1, v1, r, g, b, a);
  };

  Batch.prototype.flush = function (tex) {
    if (this.n < 3) { this.n = 0; return; }
    var gl = this.gl, p = this.prog;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.vp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex || this.white);
    gl.uniform1i(p.u.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.upload(this.n));
    SL.glAttribs(gl, p, FLOATS, LAYOUT);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    SL.glDisableAttribs(gl, p, LAYOUT);
    this.n = 0;
  };

  SL.Batch = Batch;
  SL.glCanvas = canvasOf;
})(window.SL);
