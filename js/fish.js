/* slowlight - fish.
 *
 * The sea had whales and dolphins in it and nothing smaller, which is the
 * wrong way round: the big animals are the thing you are glad you caught, and
 * the small ones are what makes the water look like water rather than like a
 * surface. These are the small ones.
 *
 * A shoal is anchored to a square of open water through `World.cell2`, the way
 * the flotsam and the land are, so a seed always has the same fish working the
 * same patch. Nothing about one is stored between frames except which shoals
 * she has already run through, and that is pruned with the squares.
 *
 * What is actually drawn, at four metres above the water:
 *
 * - The dimple. A shoal working just under the surface ruffles it, and that
 *   broad soft patch is the only part of this that carries at two hundred
 *   metres. It is what tells you there is something there before you can see
 *   anything at all.
 * - The backs. Each fish rises, breaks the surface for a moment and goes down
 *   again, on its own phase, so the patch is never all up or all down.
 * - The flash. Every half-minute or so the school turns together and the light
 *   comes off their flanks at once - one slow pulse, gone in a second and a
 *   half. It is the only bright thing here.
 * - The scatter. She runs through a shoal and it opens out ahead of her bow
 *   and is gone, once, the way the rafts of birds get up.
 * - The fliers. Now and then, and always when she comes through them, two or
 *   three break away off a wave face and glide low over the water before they
 *   go back in. This is the one thing out here that leaves the sea.
 *
 * Everything is a leaning billboard through `SL.drawAfloat`, floated on the
 * settled swell through `SL.settleAfloat`, and drawn through the one batch, so
 * the whole shoal field costs one draw call and allocates nothing per frame.
 *
 * Nothing in here makes a sound, and nothing in here should: a fish rising is
 * not audible from the cockpit of a boat under way.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep, TAU = SL.TAU;

  /* Close together and small, rather than far apart and large. The eye is
   * four and a half metres up, so a shoal a hundred metres off is already
   * within a few pixels of the horizon and reads as nothing at all: the whole
   * of this happens in the near water, and the spacing is set so that the
   * nearest one is usually forty metres off rather than a hundred. Past
   * `RANGE` there is nothing to see anyway, which is why the field is small
   * and thick rather than wide and thin. */
  var CELL = 52;            /* world units between candidate shoals */
  var RANGE = 320;          /* every square this near the boat is considered */
  var FADE0 = 215, FADE1 = 312;   /* and the far ones dissolve before the edge */
  var DENSITY = 0.34;
  var POOL = 56;            /* shoals held at once, for good */
  /* Past this a fish is a fraction of a pixel and only the ruffle it makes is
   * worth drawing, so the whole per-fish half of this is simply not run. It
   * is what lets the field reach out to the haze without the cost following
   * it out there. */
  var NEAR = 140;
  var FISH = 10;            /* and fish drawn per shoal, at most */

  var SCATTER_NEAR = 26;    /* how near she gets before a shoal opens out */
  var SCATTER_GONE = 9;     /* and how long it takes to be gone */
  var FLY = 2.7;            /* how long a flier is off the water */
  var FLIERS = 3;           /* how many leave at once when she comes through */

  /* ---------- the sprites -------------------------------------------------
   *
   * One sheet, drawn white and tinted at the point of use, so every part of it
   * takes the hour's colour and the haze without a second texture. */

  var TILE = 128, COLS = 4, ROWS = 2;
  var UV = [];

  var S_DIMPLE = 0, S_BACK = 1, S_FLASH = 2, S_FLYER = 3, S_SPLASH = 4;

  function buildSheet() {
    var c = SL.glCanvas(TILE * COLS, TILE * ROWS);
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    var i, a, grd;

    function at(col, row) {
      g.save();
      g.translate(col * TILE + TILE / 2, row * TILE + TILE / 2);
    }

    /* 0,0 - the dimple: broken water over a shoal. Seen from four metres up a
     * round patch of sea is a flat bar, so this is wide and low - but it is
     * scattered rather than laid out on a ring, and it thins toward both ends,
     * or it comes out as a straight dark rule and reads as a log. */
    at(0, 0);
    var dimple = SL.mulberry32(0x5f1a33);
    for (i = 0; i < 26; i++) {
      var u = dimple() * 2 - 1;
      var dx = u * 58;
      var dy = (dimple() * 2 - 1) * 13 * (1 - Math.abs(u) * 0.45);
      var rr = (4 + dimple() * 11) * (1 - Math.abs(u) * 0.55);
      grd = g.createRadialGradient(dx, dy, 0, dx, dy, rr);
      grd.addColorStop(0, 'rgba(255,255,255,0.50)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(-TILE / 2, -TILE / 2, TILE, TILE);
    }
    g.fillStyle = '#fff';
    g.restore();

    /* 1,0 - a back breaking the surface: a low crescent with the smallest of
     * dorsals. A soft halo under the fill keeps the edge from being a cut at
     * the three or four pixels this is ever seen at. */
    at(1, 0);
    g.globalAlpha = 0.30;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(-42, 12);
    g.quadraticCurveTo(0, -12, 42, 12);
    g.stroke();
    g.globalAlpha = 1;
    g.beginPath();
    g.moveTo(-44, 14);
    g.quadraticCurveTo(-18, -8, 6, -9);
    g.quadraticCurveTo(30, -9, 44, 14);
    g.quadraticCurveTo(0, 4, -44, 14);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(-2, -8);
    g.quadraticCurveTo(6, -30, 16, -7);
    g.closePath();
    g.fill();
    g.restore();

    /* 2,0 - the flash: a flank turned into the light. A lens, not a shape. */
    at(2, 0);
    g.save();
    g.scale(1, 0.34);
    grd = g.createRadialGradient(0, 0, 0, 0, 0, 52);
    grd.addColorStop(0, 'rgba(255,255,255,0.96)');
    grd.addColorStop(0.38, 'rgba(255,255,255,0.44)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(-TILE, -TILE, TILE * 2, TILE * 2);
    g.restore();
    g.fillStyle = '#fff';
    g.restore();

    /* 3,0 - a flier, nose to the right: a slim body, a forked tail, and the
     * two long pectorals that are the whole of the silhouette. */
    at(3, 0);
    g.beginPath();
    g.moveTo(-34, 0);
    g.quadraticCurveTo(-8, -9, 46, -2);
    g.quadraticCurveTo(-8, 9, -34, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(-32, 0); g.lineTo(-52, -16); g.lineTo(-46, 0); g.lineTo(-52, 16);
    g.closePath();
    g.fill();
    for (i = -1; i <= 1; i += 2) {
      g.beginPath();
      g.moveTo(18, i * 2);
      g.quadraticCurveTo(-2, i * 20, -34, i * 30);
      g.quadraticCurveTo(-14, i * 12, 10, i * 5);
      g.closePath();
      g.fill();
    }
    g.restore();

    /* 0,1 - what goes up where one leaves the water, and where it comes back
     * in. Small, and softer than it is bright. */
    at(0, 1);
    for (i = 0; i < 7; i++) {
      a = i / 7 * TAU;
      var sx = Math.cos(a) * 15, sy = Math.sin(a) * 7 - 4;
      grd = g.createRadialGradient(sx, sy, 0, sx, sy, 20);
      grd.addColorStop(0, 'rgba(255,255,255,0.72)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(-TILE / 2, -TILE / 2, TILE, TILE);
    }
    g.fillStyle = '#fff';
    g.restore();

    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++) {
        UV[r * COLS + cc] = [cc / COLS + 0.002, r / ROWS + 0.004,
                             (cc + 1) / COLS - 0.002, (r + 1) / ROWS - 0.004];
      }
    }
    return c;
  }

  /* ---------- the field --------------------------------------------------- */

  function Fish(world) {
    this.world = world;
    this.list = [];
    for (var i = 0; i < POOL; i++) {
      this.list.push({ key: 0, x: 0, z: 0, r: 4, n: 8, a: 0, ph: 0, spin: 1,
                       turn: 0.08, rise: 0.3, flashEvery: 24, flashAt: 0,
                       flyEvery: 40, flyAt: 0, flies: false, scat: -1 });
    }
    this.n = 0;
    /* The one thing kept between frames: which shoals she has already been
     * through. Pruned with the squares, exactly as the rafts of birds are. */
    this.scattered = Object.create(null);
    this.tex = null;
    this._w = { h: 0, gx: 0, gz: 0 };
  }

  Fish.prototype.init = function (gl) {
    this.tex = SL.glTexture(gl, buildSheet());
  };

  /* What sort of shoal is on this square of water. A pure function of the seed
   * and the square, so it is the same shoal every time anyone comes past. */
  Fish.prototype.plan = function (item, i, j) {
    var w = this.world;
    item.r = lerp(1.8, 5.0, w.cell2('fish/spread', i, j));
    item.n = 4 + Math.floor(w.cell2('fish/count', i, j) * (FISH - 3));
    /* Not every shoal has fliers in it, so a boat coming through one is not
     * always the same event. */
    item.flies = w.cell2('fish/flier', i, j) < 0.45;
    item.a = w.cell2('fish/bearing', i, j) * TAU;
    item.ph = w.cell2('fish/phase', i, j) * TAU;
    item.spin = w.cell2('fish/hand', i, j) < 0.5 ? -1 : 1;
    item.turn = lerp(0.045, 0.115, w.cell2('fish/turn', i, j));
    item.rise = lerp(0.20, 0.38, w.cell2('fish/rise', i, j));
    item.flashEvery = lerp(17, 43, w.cell2('fish/glint', i, j));
    item.flashAt = w.cell2('fish/glint2', i, j) * item.flashEvery;
    item.flyEvery = lerp(34, 96, w.cell2('fish/flight', i, j));
    item.flyAt = w.cell2('fish/flight2', i, j) * item.flyEvery;
    return item;
  };

  Fish.prototype.update = function (dt, s, islands) {
    var w = this.world;
    var i0 = Math.floor((s.worldX - RANGE) / CELL), i1 = Math.floor((s.worldX + RANGE) / CELL);
    var j0 = Math.floor((s.worldZ - RANGE) / CELL), j1 = Math.floor((s.worldZ + RANGE) / CELL);
    var n = 0;
    for (var i = i0; i <= i1 && n < POOL; i++) {
      for (var j = j0; j <= j1 && n < POOL; j++) {
        if (w.cell2('fish/on', i, j) > DENSITY) continue;
        var x = (i + w.cell2('fish/x', i, j) * 0.84 + 0.08) * CELL;
        var z = (j + w.cell2('fish/z', i, j) * 0.84 + 0.08) * CELL;
        var dx = x - s.worldX, dz = z - s.worldZ;
        var d2 = dx * dx + dz * dz;
        if (d2 > RANGE * RANGE) continue;
        /* Fish work a shore as happily as open water, but not the beach
         * itself: a shoal on dry sand is a shoal in the wrong place. */
        if (islands && islands.shallow(x, z) > 0.93) continue;
        var item = this.list[n];
        item.key = (i + 1048576) * 2097152 + (j + 1048576);
        item.x = x; item.z = z;
        this.plan(item, i, j);
        /* A shoal she comes up on opens out, once, and stays gone. */
        var t0 = this.scattered[item.key];
        if (t0 === undefined && d2 < SCATTER_NEAR * SCATTER_NEAR) {
          t0 = this.scattered[item.key] = s.t;
        }
        item.scat = t0 === undefined ? -1 : t0;
        if (item.scat >= 0 && s.t - item.scat > SCATTER_GONE) continue;
        n++;
      }
    }
    this.n = n;
    this.prune(i0, i1, j0, j1);
  };

  Fish.prototype.prune = function (i0, i1, j0, j1) {
    for (var key in this.scattered) {
      var k = +key;
      var i = Math.floor(k / 2097152) - 1048576;
      var j = (k % 2097152) - 1048576;
      if (i < i0 || i > i1 || j < j0 || j > j1) delete this.scattered[key];
    }
  };

  /* ---------- drawing ----------------------------------------------------- */

  Fish.prototype.draw = function (batch, sea, s) {
    if (!this.n) return;
    var pal = s.pal;
    /* A fish's back is the hour's own near water, well under it - the same
     * move the driftwood makes, and for the same reason: a thing on the
     * surface has to read against water that is genuinely blue and genuinely
     * bright, and it has centimetres of freeboard to do it with. What it
     * breaks is foam. Both come from the palette, so a shoal at three in the
     * morning is a stir in the dark and at six a scatter of small dark backs
     * with the light off their flanks. */
    var dr = pal.seaNear[0] * 0.38 / 255;
    var dg = pal.seaNear[1] * 0.38 / 255;
    var db = pal.seaNear[2] * 0.44 / 255;
    var fr = pal.foam[0] / 255, fg = pal.foam[1] / 255, fb = pal.foam[2] / 255;
    var hr = pal.haze[0] / 255, hg = pal.haze[1] / 255, hb = pal.haze[2] / 255;
    var light = clamp(0.26 + pal.light * 0.92, 0, 1.1) * (1 - s.weather.haze * 0.3);
    var calm = 0.45 + 0.55 * s.motion;
    var o = this._w;
    var k;

    for (var i = 0; i < this.n; i++) {
      var it = this.list[i];
      var cx = it.x - s.orgX, cz = it.z - s.orgZ;
      var ex = it.x - s.worldX, ez = it.z - s.worldZ;
      var dist = Math.sqrt(ex * ex + ez * ez);
      var edge = 1 - smoothstep(FADE0, FADE1, dist);
      if (edge <= 0.002) continue;
      var fog = 1 - Math.exp(-(dist * dist) / (s.fogD * s.fogD));
      var a0 = edge * (1 - fog) * light;
      if (a0 < 0.012) continue;

      /* One sample for the whole shoal - it is a few metres across, and the
       * gradient it comes back with carries the rest of the way across it. */
      SL.settleAfloat(sea, sea.sample(cx, cz, s.t, o), dist);
      var wy = o.h, gx = o.gx, gz = o.gz;

      var cr = lerp(dr, hr, fog * 0.8), cg = lerp(dg, hg, fog * 0.8),
          cb = lerp(db, hb, fog * 0.8);
      var lr = lerp(fr, hr, fog * 0.7), lg = lerp(fg, hg, fog * 0.7),
          lb = lerp(fb, hb, fog * 0.7);

      /* She has been through it: it opens out ahead of her and is gone. */
      var scat = it.scat >= 0 ? clamp((s.t - it.scat) / SCATTER_GONE, 0, 1) : 0;
      var open = 1 + scat * scat * 5.5;
      /* They hold together a moment, then go: a shoal that faded from the
       * instant she touched it would never be seen scattering at all. */
      var left = 1 - scat * scat * scat;

      /* The school turns together, and for a second and a half the light is
       * off all of them at once. */
      var fu = (s.t - it.flashAt) / it.flashEvery;
      var turn = (fu - Math.floor(fu)) * it.flashEvery;
      var glint = smoothstep(0, 0.35, turn) * (1 - smoothstep(0.9, 1.7, turn));

      /* The dimple, which is all there is of this from any way off: a shoal
       * working just under the surface darkens the water over it, and the
       * broken water it pushes up sits on top of that. Wide and barely tall,
       * because a billboard does not foreshorten - a metre of height here is
       * a metre of height on the glass, and a ruffle on the sea is
       * centimetres. */
      var spread = it.r * 1.9 * (1 + scat * 1.3);
      var ruf = a0 * left;
      if (ruf > 0.010) {
        SL.drawAfloat(batch, s, o, cx, cz, spread, it.r * 0.26, 0.20, 0.9,
                      UV[S_DIMPLE], cr, cg, cb, ruf * 0.92);
        SL.drawAfloat(batch, s, o, cx, cz, spread * 0.82, it.r * 0.15,
                      0.60, 0.9, UV[S_DIMPLE], lr, lg, lb,
                      ruf * (0.30 + glint * 0.38));
      }

      /* Far out, the ruffle is the whole of it. */
      if (dist >= NEAR) continue;

      for (k = 0; k < it.n; k++) {
        var ang = it.a + k * 2.39942 +
                  s.t * it.turn * it.spin * (1 + scat * 2.6);
        var rad = it.r * (0.34 + (k % 5) * 0.17) * open;
        var fx = cx + Math.cos(ang) * rad, fz = cz + Math.sin(ang) * rad;

        /* Each fish rises on its own phase: a long time under, a moment up. */
        var u = (s.t * it.rise + it.ph + k * 0.6180) % 1;
        var arc = u < 0.30 ? Math.sin(u / 0.30 * Math.PI) : 0;
        var up = a0 * left * clamp(arc * 1.5, 0, 1);
        var gl = a0 * left * glint * (0.30 + 0.70 * arc);
        if (up < 0.012 && gl < 0.012) continue;
        /* The one sample is taken at the middle of the patch; the gradient it
         * came back with carries it the few metres out to each fish, which is
         * exact enough at this size and costs nothing. */
        o.h = wy + gx * (fx - cx) + gz * (fz - cz);
        if (up > 0.012) {
          SL.drawAfloat(batch, s, o, fx, fz, 0.60, 0.22,
                        0.14 + arc * 0.60 * calm, 1.3,
                        UV[S_BACK], cr, cg, cb, up * 0.95);
          /* What a fish breaks when it comes up. A dark back on bright water
           * is a speck; the white round it is what the eye actually catches,
           * so it is only drawn for the top of the rise. */
          if (arc > 0.52) {
            SL.drawAfloat(batch, s, o, fx, fz, 0.78, 0.17, 0.26, 1.0,
                          UV[S_SPLASH], lr, lg, lb,
                          up * (arc - 0.52) * 1.5);
          }
        }
        if (gl > 0.012) {
          SL.drawAfloat(batch, s, o, fx, fz, 0.62, 0.20, 0.30, 1.0,
                        UV[S_FLASH], lr, lg, lb, gl * 0.70);
        }
      }
      o.h = wy;

      /* And the ones that leave. They go of their own accord now and then,
       * and they all go at once when she comes through them. */
      this.drawFliers(batch, s, it, cx, cz, wy, gx, gz, a0, calm,
                      cr, cg, cb, lr, lg, lb, o);
    }

    batch.flush(this.tex);
  };

  /* A flier is off the water for `FLY` seconds: up off a wave face, a long low
   * glide, and back in. Two splashes, one at each end, because a fish that
   * leaves the water without breaking it is a fish drawn on the sky. */
  Fish.prototype.drawFliers = function (batch, s, it, cx, cz, wy, gx, gz,
                                        a0, calm, cr, cg, cb, lr, lg, lb, o) {
    var t = s.t;
    var cycle = (t - it.flyAt) / it.flyEvery;
    var solo = (cycle - Math.floor(cycle)) * it.flyEvery;
    /* She puts them all up together; otherwise it is one at a time. */
    var burst = (it.scat >= 0 && it.flies) ? (t - it.scat) : -1;
    var n = burst >= 0 ? FLIERS : (solo < FLY ? 1 : 0);
    if (!n) return;

    for (var k = 0; k < n; k++) {
      var age = burst >= 0 ? burst - k * 0.55 : solo;
      if (age < 0 || age > FLY) continue;
      var u = age / FLY;
      var fa = it.a + (burst >= 0 ? k * 1.91 + it.ph : it.ph * 2.3);
      var dx = Math.cos(fa), dz = Math.sin(fa);
      var off = it.r * 0.7;
      var run = off + 26 * u;
      var lx = cx + dx * off, lz = cz + dz * off;      /* where it left */
      var fx = cx + dx * run, fz = cz + dz * run;      /* where it is now */
      /* The one sample's gradient carries the water out to both points. */
      var hy = wy + gx * (fx - cx) + gz * (fz - cz);
      var ly = wy + gx * (lx - cx) + gz * (lz - cz);
      var lift = Math.sin(u * Math.PI);
      var y = hy + lift * 1.15 * calm;
      var a = a0 * clamp(smoothstep(0, 0.10, u) * (1 - smoothstep(0.86, 1.0, u)), 0, 1);
      if (a < 0.012) continue;

      /* Turned to the way it is going: nose up leaving, nose down arriving. */
      var rot = Math.cos(u * Math.PI) * 0.46;
      var away = dx * s.camRight[0] + dz * s.camRight[2];
      var flip = away < 0;
      SL.drawTurned(batch, s, fx, y, fz, 0.48, 0.24,
                    flip ? -rot : rot, flip, UV[S_FLYER], cr, cg, cb, a * 0.95);

      /* What it left behind stays where it left, and what it makes going back
       * in is under the fish - one of them travelling with the other would be
       * a wake in the air. */
      var went = 1 - smoothstep(0, 0.34, u);
      if (went > 0.02) {
        o.h = ly;
        SL.drawAfloat(batch, s, o, lx, lz, 0.80, 0.24, 0.26, 1.0,
                      UV[S_SPLASH], lr, lg, lb, a0 * went * 0.50);
      }
      var back = smoothstep(0.78, 1.0, u);
      if (back > 0.02) {
        o.h = hy;
        SL.drawAfloat(batch, s, o, fx, fz, 0.80, 0.24, 0.26, 1.0,
                      UV[S_SPLASH], lr, lg, lb, a0 * back * 0.50);
      }
    }
  };

  SL.Fish = Fish;
})(window.SL);
