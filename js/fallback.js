/* slowlight — when there is no WebGL.
 *
 * Never a white screen, and never an error page: one still frame of the world
 * the seed asks for, painted with the same palette at the same hour, and a
 * line of text under it. It is the scene held rather than the scene refused.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, css = SL.css, rgba = SL.rgba;
  var mix = SL.mix, TAU = SL.TAU;

  function skyStop(pal, k) {
    var hi = mix(pal.skyTop, pal.skyMid, 0.85);
    var lo = mix(pal.skyMid, pal.skyHor, 0.80);
    if (k < 0.42) return mix(pal.skyTop, hi, k / 0.42);
    if (k < 0.74) return mix(hi, pal.skyMid, (k - 0.42) / 0.32);
    if (k < 0.94) return mix(pal.skyMid, lo, (k - 0.74) / 0.20);
    return mix(lo, pal.skyHor, (k - 0.94) / 0.06);
  }

  function paint(canvas, seed, W, H, dpr) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return false;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var world = new SL.World(seed);
    var rand = world.stream('still');
    var pal = SL.makePalette();
    var phase = (0.88 + world.value('hour') * 0.30 + 1) % 1;
    SL.samplePalette(pal, phase, { haze: 0.14, rain: 0 });

    var hy = Math.round(H * 0.44);
    var unit = Math.min(W, H * 1.5);

    /* Sky. */
    var g = ctx.createLinearGradient(0, 0, 0, hy + 2);
    for (var i = 0; i <= 8; i++) g.addColorStop(i / 8, css(skyStop(pal, i / 8)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hy + 2);

    /* Stars, if the hour is dark enough to have any. */
    if (pal.star > 0.04) {
      for (var st = 0; st < 260; st++) {
        var sx = rand() * W, sy = Math.pow(rand(), 1.3) * hy * 0.96;
        var m = Math.pow(rand(), 2.4);
        var a = pal.star * (0.2 + m * 0.8) * SL.smoothstep(hy, hy * 0.6, sy);
        if (a < 0.02) continue;
        ctx.fillStyle = rgba([232, 238, 248], a);
        ctx.fillRect(sx, sy, 1 + (m > 0.7 ? 1 : 0), 1 + (m > 0.7 ? 1 : 0));
      }
    }

    /* Sun or moon, where the hour puts it. */
    var arc = SL.arcParam(phase);
    var isMoon = arc >= 0.5;
    var u = isMoon ? (arc - 0.5) / 0.5 : arc / 0.5;
    var elev = Math.sin(Math.PI * u);
    var bx = W * (0.14 + 0.72 * u), by = hy - elev * hy * 0.72;
    var vis = SL.smoothstep(-0.02, 0.09, u) * SL.smoothstep(1.02, 0.91, u);
    var r = unit * 0.022;
    if (vis > 0.02) {
      var gg = ctx.createRadialGradient(bx, by, r * 0.5, bx, by, r * 14);
      gg.addColorStop(0, rgba(pal.bodyGlow, 0.30 * vis));
      gg.addColorStop(0.3, rgba(pal.bodyGlow, 0.11 * vis));
      gg.addColorStop(1, rgba(pal.bodyGlow, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(bx - r * 14, by - r * 14, r * 28, r * 28);
      if (by < hy) {
        var core = ctx.createRadialGradient(bx, by, 0, bx, by, r * 1.3);
        core.addColorStop(0, rgba(pal.body, 0.95 * vis));
        core.addColorStop(0.65, rgba(pal.body, 0.86 * vis));
        core.addColorStop(1, rgba(pal.body, 0));
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(bx, by, r * 1.3, 0, TAU);
        ctx.fill();
      }
    }

    /* The band of light on the horizon. */
    var band = unit * 0.17;
    var hb = ctx.createLinearGradient(0, hy - band, 0, hy + 2);
    hb.addColorStop(0, rgba(pal.haze, 0));
    hb.addColorStop(1, rgba(pal.haze, 0.34));
    ctx.fillStyle = hb;
    ctx.fillRect(0, hy - band, W, band + 2);

    /* Distant land. */
    var landX = W * (0.12 + world.unit('still/land') * 0.7);
    var landW = unit * (0.16 + world.unit('still/land2') * 0.26);
    var landH = landW * 0.17;
    ctx.fillStyle = rgba(mix(pal.island, pal.haze, 0.45), 0.7);
    ctx.beginPath();
    ctx.moveTo(landX - landW * 0.5, hy + 1);
    for (var p = 0; p <= 24; p++) {
      var t = p / 24;
      var pk = Math.pow(Math.sin(Math.PI * t), 0.6) *
               (0.55 + 0.45 * Math.sin(t * 7.3 + world.unit('still/land3') * 6));
      ctx.lineTo(landX - landW * 0.5 + t * landW, hy + 1 - pk * landH);
    }
    ctx.lineTo(landX + landW * 0.5, hy + 1);
    ctx.closePath();
    ctx.fill();

    /* The sea, and a few swells lying across it. */
    var sg = ctx.createLinearGradient(0, hy, 0, H);
    /* Meet the sky in the haze it is already wearing, so the line where they
     * touch is a seam and not a step. */
    sg.addColorStop(0, css(mix(pal.seaFar, pal.haze, 0.60)));
    sg.addColorStop(0.06, css(mix(pal.seaFar, pal.haze, 0.22)));
    sg.addColorStop(0.35, css(pal.seaFar));
    sg.addColorStop(1, css(mix(pal.seaNear, [3, 6, 12], 0.22)));
    ctx.fillStyle = sg;
    ctx.fillRect(0, hy, W, H - hy);

    ctx.lineCap = 'round';
    for (var k = 0; k < 26; k++) {
      var f = Math.pow((k + 0.5) / 26, 1.7);
      var y = hy + f * (H - hy);
      var amp = lerp(0.6, unit * 0.012, f);
      var seg = lerp(26, 120, f);
      var lift = 0.45 + 0.55 * SL.noise2(k * 1.7, 5.3);
      ctx.strokeStyle = rgba(mix(pal.crest, pal.skyHor, 0.45),
                             (0.02 + pal.light * 0.075) * lerp(0.35, 1, f) * lift);
      ctx.lineWidth = lerp(0.7, 1.6, f);
      ctx.beginPath();
      for (var x = -seg; x < W + seg; x += 8) {
        var wy = y + Math.sin(x * (0.009 + k * 0.0004) + k * 2.1) * amp +
                 Math.sin(x * 0.027 + k * 1.3) * amp * 0.4 +
                 SL.sfbm(x * 0.004 + k * 3.1, k * 0.7, 2) * amp * 0.9;
        if (x <= -seg) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }

    /* And her, hove to for as long as this frame lasts. */
    var L = unit * 0.115;
    var bxx = W * 0.5, byy = hy + (H - hy) * 0.56;
    var hull = mix(pal.seaNear, [10, 13, 20], 0.42);
    var sail = mix(mix(pal.crest, [244, 242, 236], 0.36), pal.haze, 0.2);
    ctx.fillStyle = rgba(sail, 0.9);
    ctx.beginPath();
    ctx.moveTo(bxx + 0.02 * L, byy - 1.55 * L);
    ctx.quadraticCurveTo(bxx - 0.34 * L, byy - 0.92 * L, bxx - 0.42 * L, byy - 0.24 * L);
    ctx.lineTo(bxx + 0.02 * L, byy - 0.23 * L);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(mix(sail, pal.skyTop, 0.22), 0.9);
    ctx.beginPath();
    ctx.moveTo(bxx + 0.03 * L, byy - 1.28 * L);
    ctx.lineTo(bxx + 0.50 * L, byy - 0.10 * L);
    ctx.quadraticCurveTo(bxx + 0.18 * L, byy - 0.62 * L, bxx + 0.03 * L, byy - 1.28 * L);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(hull);
    ctx.beginPath();
    ctx.moveTo(bxx - 0.45 * L, byy - 0.05 * L);
    ctx.quadraticCurveTo(bxx - 0.50 * L, byy + 0.06 * L, bxx - 0.33 * L, byy + 0.10 * L);
    ctx.quadraticCurveTo(bxx + 0.02 * L, byy + 0.18 * L, bxx + 0.43 * L, byy + 0.02 * L);
    ctx.lineTo(bxx + 0.52 * L, byy - 0.10 * L);
    ctx.quadraticCurveTo(bxx + 0.08 * L, byy - 0.04 * L, bxx - 0.45 * L, byy - 0.05 * L);
    ctx.closePath();
    ctx.fill();

    /* A short, broken mirror of her. */
    for (var q = 0; q < 12; q++) {
      var rf = (q + 0.5) / 12;
      var ry = byy + 0.16 * L + rf * L * 1.1;
      var n = SL.noise2(q * 1.7, 3.1);
      if (n < 0.32) continue;
      var rw = (rf < 0.3 ? lerp(0.8, 0.5, rf / 0.3) : lerp(0.28, 0.05, (rf - 0.3) / 0.7)) * L;
      ctx.strokeStyle = rgba(rf < 0.3 ? hull : sail,
                             (0.10 + pal.light * 0.2) * (1 - rf) * (1 - rf));
      ctx.lineWidth = L * 0.09;
      ctx.beginPath();
      ctx.moveTo(bxx - rw * 0.5, ry);
      ctx.lineTo(bxx + rw * 0.5, ry);
      ctx.stroke();
    }

    /* The same vignette the moving scene wears. */
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.30,
                                      W * 0.5, H * 0.52, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    return true;
  }

  /* Swap the live canvas for a still one and say, once, what happened. */
  function show(liveCanvas, seed, W, H, dpr) {
    var still = document.getElementById('still');
    if (!still) {
      still = document.createElement('canvas');
      still.id = 'still';
      liveCanvas.parentNode.insertBefore(still, liveCanvas.nextSibling);
    }
    var painted = false;
    try { painted = paint(still, seed, W, H, dpr); } catch (e) { painted = false; }
    liveCanvas.style.display = 'none';
    var note = document.getElementById('notice');
    if (note) {
      note.textContent = painted
        ? 'this browser has no WebGL to sail on — here is the hour she would have sailed under'
        : 'this browser has no WebGL to sail on';
      note.hidden = false;
    }
    document.body.classList.add('slowlight-still');
    return painted;
  }

  SL.paintStill = paint;
  SL.showStill = show;
})(window.SL);
