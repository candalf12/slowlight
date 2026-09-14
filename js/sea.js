/* slowlight — the sea.
 *
 * Stacked parallax bands. Each band is a filled region whose top edge is a
 * procedural swell profile; nearer bands are drawn last, so they overlap the
 * ones behind and the whole thing reads as depth. The profile is a sum of
 * incommensurate travelling sines plus fbm, sampled in absolute world
 * coordinates, so it drifts forever without ever repeating.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep;
  var rgba = SL.rgba, css = SL.css, mix = SL.mix, sfbm = SL.sfbm, TAU = SL.TAU;

  var LAYERS = 7;

  function Sea(world) {
    this.world = world;
    this.layers = [];
    /* Each layer gets its own slice of the noise field. */
    var rnd = world.stream('sea');
    for (var i = 0; i < LAYERS; i++) {
      var d = i / (LAYERS - 1);
      this.layers.push({
        d: d,
        off: rnd() * 900 + i * 137.4,
        phase: rnd() * TAU,
        top: 0, amp: 0, par: 0, xs: 0, step: 6
      });
    }
    this.boatLayer = LAYERS - 3;
  }

  Sea.prototype.resize = function (W, H, hy, unit) {
    var seaH = Math.max(40, H - hy);
    for (var i = 0; i < LAYERS; i++) {
      var L = this.layers[i];
      var d = L.d;
      L.top = hy + seaH * Math.pow(d, 1.75) * 0.90;
      L.amp = lerp(2.2, unit * 0.040, Math.pow(d, 1.25));
      L.par = lerp(0.05, 1.0, Math.pow(d, 1.45));
      /* Far water has short, dense wavelets; near water has long swells. */
      L.xs = lerp(0.085, 0.0105, Math.pow(d, 0.85));
      /* Sample often enough for the shortest wave in the band to stay smooth. */
      L.step = clamp(Math.round((TAU / L.xs) / 16), 3, 14);
      L.oct = d > 0.45 ? 3 : 2;
      L.sw = lerp(0.30, 0.66, Math.pow(d, 0.8));
      L.nw = lerp(0.92, 0.46, Math.pow(d, 0.8));
    }
    /* Each band is filled down to just past the crest of the band in front,
     * so its own gradient is spent across the sliver you can actually see. */
    for (var j = 0; j < LAYERS; j++) {
      var next = this.layers[j + 1];
      this.layers[j].bottom = next ? next.top + next.amp * 1.6 : H + 6;
    }
  };

  /* Surface height of one band at screen x. Cheap enough to call per sample. */
  Sea.prototype.waveY = function (i, x, s) {
    var L = this.layers[i];
    var u = (x + s.worldX * L.par) * L.xs + L.off;
    var t = s.t;
    var chop = 0.55 + s.wind * 0.75;
    /* Near water is swell-shaped and reads as travelling sines; far water is
     * mostly texture, so it leans on noise and never looks periodic. */
    var sw = L.sw, nw = L.nw;
    var p = sw * (
        0.55 * Math.sin(u + t * 0.62 * chop + L.phase) +
        0.28 * Math.sin(u * 2.17 - t * 0.95 * chop + L.phase * 1.7) +
        0.17 * Math.sin(u * 0.57 + t * 0.31 * chop + 4.1)
      ) + nw * (
        0.64 * sfbm(u * 0.42, t * 0.05 + L.off, L.oct) +
        0.30 * sfbm(u * 1.35, t * 0.09 + L.off * 1.7, 2)
      );
    /* Wind ruffles the surface of the nearer bands. */
    if (L.d > 0.35) {
      p += 0.07 * s.wind * L.d * Math.sin(u * 5.3 - t * 2.1 * chop + L.off);
    }
    /* Real water arrives in groups — some stretches run high, some lie flat. */
    var group = 0.62 + 0.62 * SL.noise2(u * 0.085, t * 0.021 + L.off * 0.5);
    return L.top - p * group * L.amp * s.motion;
  };

  Sea.prototype.bandColors = function (i, s) {
    var L = this.layers[i], pal = s.pal, d = L.d;
    var base = mix(pal.seaFar, pal.seaNear, Math.pow(d, 0.7));
    /* Nearer water is deeper water, and reads darker for it. */
    base = mix(base, [3, 6, 12], lerp(0, 0.13, Math.pow(d, 1.3)));
    /* The surface mostly reflects the sky; more so the further away it is,
     * but even near crests pick up enough of it to keep the water alive. */
    var topC = mix(base, pal.skyHor, lerp(0.74, 0.30, Math.pow(d, 0.55)));
    /* The trough at the foot of each band sits in the shadow of the next. */
    var botC = mix(base, [2, 4, 9], lerp(0.12, 0.40, d));
    return { base: base, top: topC, bot: botC };
  };

  Sea.prototype.drawLayer = function (ctx, i, s, body) {
    var L = this.layers[i];
    var W = s.W, H = s.H;
    var step = L.step;
    var cols = this.bandColors(i, s);
    var n = Math.ceil(W / step) + 2;

    var xs = this._xs || (this._xs = []);
    var ys = this._ys || (this._ys = []);
    xs.length = 0; ys.length = 0;
    for (var k = 0; k <= n; k++) {
      var x = -step + k * step;
      xs.push(x);
      ys.push(this.waveY(i, x, s));
    }

    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (var j = 1; j <= n; j++) ctx.lineTo(xs[j], ys[j]);
    var floor = Math.min(H + 6, L.bottom);
    ctx.lineTo(W + step, floor);
    ctx.lineTo(-step, floor);
    ctx.closePath();

    var spanTop = L.top - L.amp * 1.35;
    var spanBot = Math.max(spanTop + 12, floor);
    var g = ctx.createLinearGradient(0, spanTop, 0, spanBot);
    g.addColorStop(0, css(cols.top));
    g.addColorStop(0.22, css(mix(cols.top, cols.base, 0.7)));
    g.addColorStop(0.6, css(cols.base));
    g.addColorStop(1, css(cols.bot));
    ctx.fillStyle = g;
    ctx.fill();

    this.drawFace(ctx, i, s, xs, ys, n, cols);
    this.drawCrest(ctx, i, s, body, xs, ys, n, cols);
  };

  /* The shadowed front face just under each crest. This is what gives the
   * band volume rather than leaving it a flat ribbon with a line on top. */
  Sea.prototype.drawFace = function (ctx, i, s, xs, ys, n, cols) {
    var L = this.layers[i];
    if (L.amp < 3) return;
    var depth = L.amp * 0.9;
    var shade = mix(cols.base, [2, 4, 9], 0.5);
    var a = lerp(0.10, 0.30, L.d);
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (var j = 1; j <= n; j++) ctx.lineTo(xs[j], ys[j]);
    for (var k = n; k >= 0; k--) ctx.lineTo(xs[k], ys[k] + depth);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, L.top - L.amp, 0, L.top + L.amp + depth);
    g.addColorStop(0, rgba(shade, a));
    g.addColorStop(1, rgba(shade, 0));
    ctx.fillStyle = g;
    ctx.fill();
  };

  /* The lit edge along the top of a band, plus the specular column that runs
   * back toward whichever body is in the sky. */
  Sea.prototype.drawCrest = function (ctx, i, s, body, xs, ys, n, cols) {
    var L = this.layers[i], pal = s.pal;
    var W = s.W;
    var damp = 1 - clamp(s.weather.haze * 0.55 + s.weather.rain * 0.45, 0, 0.9);

    /* Base edge: faint everywhere, so swells read even under cloud. */
    var edgeCol = mix(cols.top, pal.crest, 0.55);
    var edgeA = (0.07 + 0.26 * pal.light) * lerp(0.45, 1, L.d) * damp;
    if (edgeA > 0.012) {
      ctx.strokeStyle = rgba(edgeCol, edgeA);
      ctx.lineWidth = lerp(0.7, 1.5, L.d);
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (var j = 1; j <= n; j++) ctx.lineTo(xs[j], ys[j]);
      ctx.stroke();
    }

    if (!body || body.vis < 0.03) return;
    var gx = body.x;
    /* Low bodies throw a long, wide path; high ones a tight pool. */
    var colW = W * lerp(0.30, 0.10, body.elev) * lerp(0.7, 1.35, L.d);
    var strength = body.vis * damp * (body.isMoon ? 0.55 : 1) *
                   lerp(0.25, 1, pal.light) * lerp(0.35, 1, L.d);
    if (strength < 0.02) return;

    var glint = mix(pal.crest, pal.bodyGlow, 0.55);
    var grd = ctx.createLinearGradient(gx - colW, 0, gx + colW, 0);
    grd.addColorStop(0, rgba(glint, 0));
    grd.addColorStop(0.5, rgba(glint, clamp(0.40 * strength, 0, 0.55)));
    grd.addColorStop(1, rgba(glint, 0));
    ctx.strokeStyle = grd;
    ctx.lineWidth = lerp(1.0, 2.4, L.d);
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (var q = 1; q <= n; q++) ctx.lineTo(xs[q], ys[q]);
    ctx.stroke();

    /* Individual glints: short flat facets near the top of each wavelet,
     * only inside the column, twinkling on a slow noise. */
    var t = s.t;
    ctx.strokeStyle = rgba(glint, 1);
    ctx.lineCap = 'round';
    for (var p = 1; p < n; p++) {
      var x = xs[p];
      var dxg = (x - gx) / colW;
      if (dxg < -1 || dxg > 1) continue;
      var slope = Math.abs(ys[p + 1] - ys[p - 1]);
      if (slope > L.amp * 0.34 + 0.7) continue;
      var col = Math.exp(-dxg * dxg * 2.2);
      var tw = SL.noise2(x * 0.09 + L.off, t * 1.6 + p * 0.31);
      var a = strength * col * clamp(tw * 1.8 - 0.55, 0, 1) * 0.85;
      if (a < 0.025) continue;
      var len = lerp(2, 9, L.d) * lerp(0.6, 1.4, tw);
      ctx.globalAlpha = clamp(a, 0, 0.7);
      ctx.lineWidth = lerp(0.8, 1.9, L.d);
      ctx.beginPath();
      ctx.moveTo(x - len * 0.5, ys[p]);
      ctx.lineTo(x + len * 0.5, ys[p]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  /* Wind-driven texture on the two nearest bands: broken foam lines that sit
   * just under the crest. Entirely procedural, so there is nothing to retain. */
  Sea.prototype.drawTexture = function (ctx, i, s) {
    var L = this.layers[i];
    if (L.d < 0.55) return;
    var strength = clamp((s.wind - 0.28) * 1.3, 0, 1) * L.d * s.motion;
    if (strength < 0.05) return;
    var foam = s.pal.foam;
    var W = s.W;
    var step = 9;
    ctx.save();
    ctx.lineCap = 'round';
    for (var x = -step; x < W + step; x += step) {
      var u = (x + s.worldX * L.par) * L.xs * 1.6 + L.off * 3;
      var m = SL.noise2(u * 1.7, s.t * 0.12 + L.off);
      if (m < 0.62) continue;
      var y = this.waveY(i, x, s);
      var a = (m - 0.62) * 2.4 * strength * (0.25 + s.pal.light * 0.6);
      if (a < 0.02) continue;
      ctx.strokeStyle = rgba(foam, clamp(a, 0, 0.4));
      ctx.lineWidth = lerp(0.8, 1.6, L.d);
      var len = lerp(5, 16, m);
      ctx.beginPath();
      ctx.moveTo(x, y + L.amp * 0.10);
      ctx.lineTo(x + len, y + L.amp * 0.13);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* Draws far to near, handing control back at the band the boat rides so it
   * can be slotted into the stack and occluded by the swells in front of it. */
  Sea.prototype.draw = function (ctx, s, body, onBoatLayer) {
    /* Flood the sea area first so no gradient seam can show through. */
    var pal = s.pal;
    ctx.fillStyle = css(mix(pal.seaFar, pal.skyHor, 0.5));
    ctx.fillRect(0, s.horizonY - 1, s.W, s.H - s.horizonY + 2);

    for (var i = 0; i < LAYERS; i++) {
      this.drawLayer(ctx, i, s, body);
      this.drawTexture(ctx, i, s);
      if (i === this.boatLayer && onBoatLayer) onBoatLayer();
    }
  };

  SL.Sea = Sea;
  SL.SEA_LAYERS = LAYERS;
})(window.SL);
