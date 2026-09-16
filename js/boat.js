/* slowlight — the boat.
 *
 * A small sloop sailing the band stack rather than sitting on one band of it.
 * `s.boatLayerF` is its depth as a continuous band coordinate and `s.across`
 * its lane in the frame; from those it reads the surface height and slope
 * beneath it, so it pitches with the swell rather than being animated on its
 * own clock, and it scales, tints and is occluded by its distance.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, rgba = SL.rgba, css = SL.css;
  var mix = SL.mix, TAU = SL.TAU;

  function lum(c) { return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114; }

  /* Scale a colour to a given luminance. Multiplicative, so the hue and the
   * saturation survive the move — nothing here ever goes grey. */
  function atLum(c, target) {
    var l = lum(c);
    if (l < 1) return [target, target, target];
    var k = target / l;
    return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)];
  }

  /* Push a colour away from its own luminance. Distance mixing flattens
   * colour; this is what keeps the far boat vivid instead of hazy grey. */
  function vivid(c, k) {
    var l = lum(c);
    return [clamp(l + (c[0] - l) * k, 0, 255),
            clamp(l + (c[1] - l) * k, 0, 255),
            clamp(l + (c[2] - l) * k, 0, 255)];
  }

  /* A hull is an object on lit water, so it belongs below the water's tone by
   * `minDelta` — that is what keeps a boat pushed toward the horizon reading
   * as a clean silhouette instead of dissolving into the haze. When the water
   * is already near black there is nothing darker to be; night is left as it
   * is and the sails carry the read. */
  function darkerThan(col, water, minDelta) {
    var target = lum(water) - minDelta;
    if (target < 9) return col;
    return lum(col) <= target ? col : atLum(col, target);
  }

  /* Sails are the bright note, so they stay above the water's tone however
   * light the water gets. */
  function lighterThan(col, water, minDelta) {
    var target = Math.min(lum(water) + minDelta, 248);
    return lum(col) >= target ? col : atLum(col, target);
  }

  function Boat(world) {
    /* Each world gets a slightly different boat, within a narrow range. */
    this.hullTint = world.value('boat/hull');
    this.sailTint = world.value('boat/sail');
    this.bobPhase = world.value('boat/bob') * TAU;
  }

  /* The water under the boat, read at its own depth: height, and the slope it
   * pitches to. The slope is measured across the hull, so a small far boat
   * answers to the wavelets it actually spans and not to a fixed span of
   * pixels it would only read as jitter. */
  Boat.prototype.sample = function (sea, s, L) {
    var li = s.boatLayerF, x = s.boatX;
    var d = clamp(L * 0.42, 3, s.unit * 0.05);
    var y = sea.surfaceY(li, x, s);
    var slope = (sea.surfaceY(li, x + d, s) - sea.surfaceY(li, x - d, s)) / (2 * d);
    return { x: x, y: y, slope: slope };
  };

  /* Hull, sail and rigging at this depth and this hour. Distance pulls the
   * boat toward the air between it and the eye; the guards above keep that
   * from washing it out or muddying it at the far end. */
  Boat.prototype.colors = function (sea, s) {
    var pal = s.pal;
    var far = clamp(1 - s.depth, 0, 1);
    var water = sea.waterAt(s.boatLayerF, s);
    /* The air the far water is already dissolving into. */
    var air = mix(pal.haze, pal.skyHor, 0.35);
    var atm = clamp(Math.pow(far, 1.35) * (0.34 + s.weather.haze * 0.14), 0, 0.42);

    var hull = mix(pal.seaNear, [10, 13, 20], lerp(0.30, 0.55, this.hullTint));
    hull = mix(hull, pal.skyHor, 0.06);
    hull = vivid(mix(hull, air, atm), 1 + far * 0.22);
    hull = darkerThan(hull, water, lerp(13, 33, far));

    var deck = mix(hull, pal.crest, 0.22);

    var sail = mix(pal.crest, [244, 242, 236], 0.30 + this.sailTint * 0.2);
    sail = mix(sail, pal.haze, 0.18 + s.weather.haze * 0.3);
    /* Sails keep their own light: they lean on the crest colour with
     * distance, not on the haze, so they stay the bright note in the frame. */
    sail = mix(sail, mix(air, pal.crest, 0.55), atm * 0.75);
    sail = vivid(sail, 1 + far * 0.16);
    sail = lighterThan(sail, water, lerp(15, 38, far));

    return {
      hull: hull,
      deck: deck,
      sailLit: sail,
      sailShade: mix(sail, pal.skyTop, lerp(0.42, 0.26, far)),
      rig: mix(hull, pal.crest, 0.30)
    };
  };

  Boat.prototype.draw = function (ctx, sea, s) {
    var pal = s.pal;
    /* Hull length: the boat's size is its distance. */
    var L = s.unit * 0.105 * s.boatScale;
    var pos = this.sample(sea, s, L);
    var bob = Math.sin(s.t * 0.55 + this.bobPhase) * L * 0.012 * s.motion;

    /* Pitch follows the swell; heel comes from steering and settles back. */
    var pitch = Math.atan(pos.slope) * 0.85 * s.motion;
    var heel = s.steer * 0.10 * s.motion;

    var cols = this.colors(sea, s);
    var hull = cols.hull, deck = cols.deck, rig = cols.rig;
    var sailLit = cols.sailLit, sailShade = cols.sailShade;

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
    var h = L * 1.45;
    /* A small boat far off has a short reflection; drawing 22 rows into it
     * would just stack sub-pixel strokes. */
    var rows = clamp(Math.round(h / 2.6), 7, 22);
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
    var li = s.boatLayerF;
    ctx.save();
    ctx.lineCap = 'round';
    var n = 16;
    for (var k = 0; k < n; k++) {
      var f = k / n;
      var x = pos.x - L * 0.42 - f * L * 3.4;
      if (x < -30) break;
      var y = sea.surfaceY(li, x, s) + L * 0.04;
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
