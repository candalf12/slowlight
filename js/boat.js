/* slowlight — the boat.
 *
 * A small sloop riding one of the sea bands. It reads the surface height and
 * slope beneath it, so it pitches with the swell rather than being animated
 * on its own clock. Steering only heels it and nudges where it sits.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, rgba = SL.rgba, css = SL.css;
  var mix = SL.mix, TAU = SL.TAU;

  function Boat(world) {
    /* Each world gets a slightly different boat, within a narrow range. */
    this.hullTint = world.value('boat/hull');
    this.sailTint = world.value('boat/sail');
    this.bobPhase = world.value('boat/bob') * TAU;
  }

  Boat.prototype.sample = function (sea, s) {
    var i = sea.boatLayer;
    var x = s.boatX;
    var d = Math.max(6, s.unit * 0.02);
    var y = sea.waveY(i, x, s);
    var slope = (sea.waveY(i, x + d, s) - sea.waveY(i, x - d, s)) / (2 * d);
    return { x: x, y: y, slope: slope };
  };

  Boat.prototype.draw = function (ctx, sea, s) {
    var pal = s.pal;
    var pos = this.sample(sea, s);
    var L = s.unit * 0.105;                        /* hull length */
    var bob = Math.sin(s.t * 0.55 + this.bobPhase) * L * 0.012 * s.motion;

    /* Pitch follows the swell; heel comes from steering and settles back. */
    var pitch = Math.atan(pos.slope) * 0.85 * s.motion;
    var heel = s.steer * 0.10 * s.motion;

    var hull = mix(pal.seaNear, [10, 13, 20], lerp(0.30, 0.55, this.hullTint));
    hull = mix(hull, pal.skyHor, 0.06);
    var deck = mix(hull, pal.crest, 0.22);
    var sailLit = mix(pal.crest, [244, 242, 236], 0.30 + this.sailTint * 0.2);
    sailLit = mix(sailLit, pal.haze, 0.18 + s.weather.haze * 0.3);
    var sailShade = mix(sailLit, pal.skyTop, 0.42);
    var rig = mix(hull, pal.crest, 0.30);

    var bulge = (0.05 + s.wind * 0.10) * L;

    this.drawReflection(ctx, s, pos, L, hull, sailLit);

    ctx.save();
    ctx.translate(pos.x, pos.y + bob);
    ctx.rotate(pitch + heel);

    /* --- sails ------------------------------------------------------- */
    var mastX = 0.02 * L, mastTop = -1.52 * L, boomY = -0.25 * L;

    ctx.beginPath();
    ctx.moveTo(mastX, mastTop);
    ctx.quadraticCurveTo(-0.30 * L - bulge, -0.92 * L, -0.40 * L, boomY - 0.02 * L);
    ctx.lineTo(mastX, boomY + 0.01 * L);
    ctx.closePath();
    var gs = ctx.createLinearGradient(-0.40 * L, mastTop, mastX, boomY);
    gs.addColorStop(0, css(sailLit));
    gs.addColorStop(1, css(sailShade));
    ctx.fillStyle = gs;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(mastX + 0.01 * L, -1.26 * L);
    ctx.lineTo(0.50 * L, -0.10 * L);
    ctx.quadraticCurveTo(0.17 * L - bulge * 0.5, -0.60 * L, mastX + 0.01 * L, -1.26 * L);
    ctx.closePath();
    var gj = ctx.createLinearGradient(0.5 * L, -0.1 * L, mastX, -1.26 * L);
    gj.addColorStop(0, css(mix(sailShade, sailLit, 0.5)));
    gj.addColorStop(1, css(sailLit));
    ctx.fillStyle = gj;
    ctx.fill();

    /* --- rigging ----------------------------------------------------- */
    ctx.strokeStyle = rgba(rig, 0.8);
    ctx.lineWidth = Math.max(0.7, L * 0.016);
    ctx.beginPath();
    ctx.moveTo(mastX, -0.05 * L);
    ctx.lineTo(mastX, mastTop - 0.03 * L);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, L * 0.011);
    ctx.beginPath();
    ctx.moveTo(mastX, boomY);
    ctx.lineTo(-0.42 * L, boomY - 0.02 * L);
    ctx.stroke();
    ctx.strokeStyle = rgba(rig, 0.35);
    ctx.lineWidth = Math.max(0.4, L * 0.007);
    ctx.beginPath();
    ctx.moveTo(mastX, mastTop);
    ctx.lineTo(-0.44 * L, -0.06 * L);
    ctx.stroke();

    /* --- hull -------------------------------------------------------- */
    ctx.beginPath();
    ctx.moveTo(-0.45 * L, -0.055 * L);
    ctx.quadraticCurveTo(-0.50 * L, 0.055 * L, -0.33 * L, 0.095 * L);
    ctx.quadraticCurveTo(0.02 * L, 0.175 * L, 0.43 * L, 0.015 * L);
    ctx.lineTo(0.52 * L, -0.105 * L);
    ctx.quadraticCurveTo(0.08 * L, -0.045 * L, -0.45 * L, -0.055 * L);
    ctx.closePath();
    var gh = ctx.createLinearGradient(0, -0.11 * L, 0, 0.18 * L);
    gh.addColorStop(0, css(deck));
    gh.addColorStop(0.35, css(hull));
    gh.addColorStop(1, css(mix(hull, [0, 0, 0], 0.3)));
    ctx.fillStyle = gh;
    ctx.fill();

    /* cabin */
    ctx.fillStyle = css(mix(hull, pal.crest, 0.12));
    ctx.beginPath();
    ctx.moveTo(-0.20 * L, -0.06 * L);
    ctx.lineTo(-0.17 * L, -0.155 * L);
    ctx.lineTo(0.00 * L, -0.16 * L);
    ctx.lineTo(0.02 * L, -0.06 * L);
    ctx.closePath();
    ctx.fill();

    /* The cabin lamp, which only earns its keep once the light drops. */
    var lampA = clamp(1 - pal.light * 1.55, 0, 1);
    if (lampA > 0.02) {
      var lx = -0.09 * L, ly = -0.115 * L;
      var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, L * 0.55);
      lg.addColorStop(0, rgba([255, 214, 150], 0.55 * lampA));
      lg.addColorStop(0.3, rgba([255, 198, 130], 0.16 * lampA));
      lg.addColorStop(1, rgba([255, 190, 120], 0));
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(lx, ly, L * 0.55, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba([255, 228, 178], 0.85 * lampA);
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(0.8, L * 0.018), 0, TAU);
      ctx.fill();
    }

    ctx.restore();

    this.drawWake(ctx, sea, s, pos, L);
  };

  /* A short, broken-up mirror of the boat, drawn as rounded strokes on the
   * water rather than a copy of the shape — a clean mirror reads as glass. */
  Boat.prototype.drawReflection = function (ctx, s, pos, L, hull, sail) {
    var a = 0.12 + s.pal.light * 0.26;
    a *= 1 - s.weather.rain * 0.45;
    if (a < 0.03) return;
    var rows = 22;
    var h = L * 1.45;
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < rows; i++) {
      var f = (i + 0.5) / rows;
      var y = pos.y + f * h;
      if (y > s.H + 4) break;
      /* Break the reflection up on the same noise the water moves to. */
      var n = SL.noise2(pos.x * 0.05 + f * 6.1, s.t * 1.1 + i * 0.7);
      if (n < 0.30) continue;
      var wob = Math.sin(s.t * 1.4 + f * 8.5 + pos.x * 0.02) * L * 0.055 * (0.35 + f) * s.motion;
      /* The hull mirrors first, then the sails taper away below it. */
      var isHull = f < 0.30;
      var col = isHull ? hull : sail;
      var wdt = isHull ? L * lerp(0.80, 0.52, f / 0.30) : L * lerp(0.30, 0.05, (f - 0.30) / 0.70);
      wdt *= 0.55 + n * 0.8;
      var rowA = a * (1 - f) * (1 - f) * (isHull ? 1.15 : 0.5) * (n - 0.2);
      if (rowA < 0.008 || wdt < 1) continue;
      ctx.strokeStyle = rgba(col, clamp(rowA, 0, 0.5));
      ctx.lineWidth = Math.max(1, h / rows * 0.75);
      ctx.beginPath();
      ctx.moveTo(pos.x - wdt * 0.5 + wob, y);
      ctx.lineTo(pos.x + wdt * 0.5 + wob, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* Foam trailing astern — regenerated every frame from the surface itself,
   * so there is no particle list to grow. */
  Boat.prototype.drawWake = function (ctx, sea, s, pos, L) {
    var strength = clamp((s.course - 0.25) * 0.8, 0, 1) * s.motion;
    if (strength < 0.05) return;
    var foam = s.pal.foam;
    var i = sea.boatLayer;
    ctx.save();
    ctx.lineCap = 'round';
    var n = 16;
    for (var k = 0; k < n; k++) {
      var f = k / n;
      var x = pos.x - L * 0.42 - f * L * 3.4;
      if (x < -30) break;
      var y = sea.waveY(i, x, s) + L * 0.04;
      var flick = SL.noise2(x * 0.06 + s.worldX * 0.004, s.t * 0.9 + k);
      var a = (1 - f) * (1 - f) * strength * (0.22 + s.pal.light * 0.5) * (0.4 + flick * 0.9);
      if (a < 0.015) continue;
      ctx.strokeStyle = rgba(foam, clamp(a, 0, 0.5));
      ctx.lineWidth = lerp(2.0, 0.7, f) * (0.7 + flick * 0.6);
      var len = lerp(L * 0.30, L * 0.10, f) * (0.6 + flick);
      ctx.beginPath();
      ctx.moveTo(x - len * 0.5, y);
      ctx.lineTo(x + len * 0.5, y - L * 0.01);
      ctx.stroke();
    }
    ctx.restore();
  };

  SL.Boat = Boat;
})(window.SL);
