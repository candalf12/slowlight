/* slowlight — distant land.
 *
 * Islands are anchored to positions in the world, not spawned on a timer, so
 * the same seed always sails past the same land in the same order, and a
 * different starting position genuinely sets out from different surroundings.
 * Only the two or three cells near the viewer are ever materialised.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep;
  var rgba = SL.rgba, css = SL.css, mix = SL.mix, TAU = SL.TAU;

  var CELL = 3600;          /* world units between candidate island sites */
  var PARALLAX = 0.16;      /* how fast land slides past relative to the boat */

  function Islands(world) {
    this.world = world;
    this.cache = Object.create(null);
    this.live = [];
  }

  /* Build the geometry for one cell. Pure function of (seed, k). */
  Islands.prototype.build = function (k) {
    var w = this.world;
    var v = function (n, salt) { return w.cell('island/' + n, k, salt || 0); };
    if (v('exists') > 0.62) return { k: k, empty: true };

    var count = v('count') < 0.26 ? (v('count2') < 0.4 ? 3 : 2) : 1;
    var depth = lerp(0.12, 1.0, Math.pow(v('depth'), 0.75));
    var groupX = k * CELL + (v('offset') - 0.5) * CELL * 0.72;
    var parts = [];
    var spread = lerp(140, 520, v('spread')) * lerp(0.7, 1.25, depth);

    for (var i = 0; i < count; i++) {
      var sub = i * 97 + 11;
      var isMain = i === 0;
      var scale = (isMain ? lerp(0.75, 1.0, v('scale', sub)) : lerp(0.22, 0.6, v('scale', sub)));
      var width = lerp(150, 520, v('width', sub)) * scale * lerp(0.62, 1.15, 1 - depth * 0.5);
      var height = width * lerp(0.13, 0.42, v('aspect', sub)) * lerp(0.8, 1.25, v('aspect2', sub));
      var peaks = [];
      var np = 1 + Math.floor(v('peaks', sub) * 3);
      for (var p = 0; p < np; p++) {
        peaks.push({
          c: lerp(0.18, 0.82, v('pc', sub + p * 13)),
          h: lerp(0.42, 1.0, v('ph', sub + p * 17)),
          s: lerp(0.10, 0.30, v('ps', sub + p * 19))
        });
      }
      /* Normalise so the tallest peak defines the island height. */
      var maxh = 0;
      for (var q = 0; q < peaks.length; q++) maxh = Math.max(maxh, peaks[q].h);
      parts.push({
        dx: isMain ? 0 : (v('px', sub) - 0.5) * spread * 2,
        width: width,
        height: height / maxh,
        peaks: peaks,
        trees: v('trees', sub) < 0.55,
        treeSeed: sub
      });
    }
    /* Draw the far parts first so overlaps read as depth. */
    parts.sort(function (a, b) { return b.width - a.width; });
    return { k: k, empty: false, x: groupX, depth: depth, parts: parts };
  };

  Islands.prototype.get = function (k) {
    var hit = this.cache[k];
    if (!hit) { hit = this.cache[k] = this.build(k); }
    return hit;
  };

  /* Drop cells that have slid out of range so the cache can't grow. */
  Islands.prototype.prune = function (kMin, kMax) {
    for (var key in this.cache) {
      var k = +key;
      if (k < kMin - 1 || k > kMax + 1) delete this.cache[key];
    }
  };

  Islands.prototype.update = function (s) {
    var pos = s.worldX * PARALLAX;
    var margin = s.W * 0.8 + 700;
    var kMin = Math.floor((pos - s.W * 0.5 - margin) / CELL) - 1;
    var kMax = Math.ceil((pos + s.W * 0.5 + margin) / CELL) + 1;
    this.prune(kMin, kMax);
    var live = this.live;
    live.length = 0;
    for (var k = kMin; k <= kMax; k++) {
      var isle = this.get(k);
      if (isle.empty) continue;
      var sx = isle.x - pos + s.W * 0.5;
      if (sx < -margin || sx > s.W + margin) continue;
      live.push({ isle: isle, sx: sx });
    }
    /* Far islands behind near ones. */
    live.sort(function (a, b) { return b.isle.depth - a.isle.depth; });
  };

  Islands.prototype.draw = function (ctx, s) {
    var pal = s.pal, hy = s.horizonY;
    var live = this.live;
    for (var i = 0; i < live.length; i++) {
      var it = live[i];
      var isle = it.isle;
      var d = isle.depth;                 /* 0 = far away, 1 = comparatively near */
      var sizeK = lerp(0.42, 1.0, d) * (s.unit / 900);
      /* Atmospheric perspective: distant land is barely more than a stain. */
      var fade = lerp(0.72, 0.16, d);
      var body = mix(pal.island, pal.haze, fade);
      var alpha = lerp(0.30, 0.86, d) * (1 - s.weather.haze * 0.55 - s.weather.rain * 0.3);
      if (alpha <= 0.012) continue;
      /* Nearer land sits a touch lower, as if closer to the curve of the sea. */
      var baseY = hy + lerp(-1.5, 2.5, d);

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      for (var j = 0; j < isle.parts.length; j++) {
        this.drawPart(ctx, s, isle, isle.parts[j], it.sx, baseY, sizeK, body, d);
      }
      ctx.restore();
    }
  };

  Islands.prototype.profile = function (part, t) {
    var h = 0;
    for (var i = 0; i < part.peaks.length; i++) {
      var pk = part.peaks[i];
      var dx = (t - pk.c) / pk.s;
      h += pk.h * Math.exp(-dx * dx);
    }
    /* Shoulders drop to the waterline at the edges. */
    var shore = Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.55);
    return h * shore;
  };

  Islands.prototype.drawPart = function (ctx, s, isle, part, groupX, baseY, sizeK, body, d) {
    var w = part.width * sizeK;
    var hgt = part.height * sizeK;
    var x0 = groupX + part.dx * sizeK - w * 0.5;
    if (x0 > s.W + 60 || x0 + w < -60) return;

    var steps = clamp(Math.round(w / 6), 14, 90);
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var y = baseY - this.profile(part, t) * hgt;
      pts.push(x0 + t * w, y);
    }

    ctx.beginPath();
    ctx.moveTo(pts[0], baseY + 3);
    for (var p = 0; p < pts.length; p += 2) ctx.lineTo(pts[p], pts[p + 1]);
    ctx.lineTo(pts[pts.length - 2], baseY + 3);
    ctx.closePath();

    var g = ctx.createLinearGradient(0, baseY - hgt, 0, baseY + 2);
    g.addColorStop(0, css(SL.brighten(body, 1.06)));
    g.addColorStop(1, css(mix(body, s.pal.haze, 0.35)));
    ctx.fillStyle = g;
    ctx.fill();

    /* A faint sun-side edge, only once there's enough light to justify it. */
    if (s.pal.light > 0.12 && d > 0.4) {
      ctx.strokeStyle = rgba(mix(body, s.pal.crest, 0.5), 0.30 * s.pal.light);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (var q = 2; q < pts.length; q += 2) ctx.lineTo(pts[q], pts[q + 1]);
      ctx.stroke();
    }

    /* Ragged treeline on the closer islands. */
    if (part.trees && d > 0.55 && hgt > 8) {
      var w2 = this.world;
      ctx.fillStyle = rgba(mix(body, [0, 0, 0], 0.22), 0.5);
      var n = clamp(Math.round(w / 9), 4, 40);
      for (var tI = 0; tI < n; tI++) {
        var tt = (tI + 0.5) / n;
        var jitter = w2.cell('tree', isle.k, part.treeSeed + tI * 7);
        var ty = baseY - this.profile(part, tt) * hgt;
        var th = lerp(1.5, 4.5, jitter) * clamp(sizeK * 1.4, 0.5, 2);
        var tx = x0 + tt * w + (jitter - 0.5) * 3;
        ctx.fillRect(tx, ty - th, 1.2, th);
      }
    }

    /* Reflection, smeared and short — the sea layers break it up from below. */
    var refA = 0.16 * s.pal.light + 0.05;
    if (refA > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - 4, baseY, w + 8, Math.max(6, hgt * 0.5));
      ctx.clip();
      ctx.globalAlpha *= refA;
      ctx.translate(0, baseY * 2);
      ctx.scale(1, -0.45);
      ctx.beginPath();
      ctx.moveTo(pts[0], baseY);
      for (var r = 0; r < pts.length; r += 2) ctx.lineTo(pts[r], pts[r + 1]);
      ctx.lineTo(pts[pts.length - 2], baseY);
      ctx.closePath();
      ctx.fillStyle = css(body);
      ctx.fill();
      ctx.restore();
    }
  };

  SL.Islands = Islands;
  SL.ISLAND_PARALLAX = PARALLAX;
})(window.SL);
