/* slowlight — weather that drifts in and out on its own slow schedule.
 *
 * A tiny state machine picks a target mood, then everything crossfades over
 * tens of seconds. Nothing ever cuts. Rain uses a fixed, pre-allocated pool,
 * so memory is flat no matter how long the scene runs.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, approach = SL.approach;

  var MOODS = [
    { name: 'clear',    haze: 0.04, rain: 0.00, weight: 3.0, dwell: [150, 330] },
    { name: 'soft',     haze: 0.22, rain: 0.00, weight: 2.4, dwell: [120, 260] },
    { name: 'haze',     haze: 0.52, rain: 0.00, weight: 1.6, dwell: [110, 240] },
    { name: 'mist',     haze: 0.40, rain: 0.14, weight: 1.2, dwell: [ 90, 200] },
    { name: 'drizzle',  haze: 0.34, rain: 0.40, weight: 1.2, dwell: [ 90, 210] },
    { name: 'rain',     haze: 0.46, rain: 0.78, weight: 0.9, dwell: [ 80, 180] }
  ];
  var TOTAL_WEIGHT = MOODS.reduce(function (s, m) { return s + m.weight; }, 0);

  function Weather(rand) {
    this.rand = rand;
    this.haze = 0.08;
    this.rain = 0;
    this.target = MOODS[0];
    this.hold = 90 + rand() * 90;
    this.wind = 0.3;
    this.windTarget = 0.3;
    this.windHold = 40;
    this.drops = [];
    this.dropCount = 0;
  }

  Weather.prototype.pick = function () {
    var r = this.rand() * TOTAL_WEIGHT;
    for (var i = 0; i < MOODS.length; i++) {
      r -= MOODS[i].weight;
      if (r <= 0) return MOODS[i];
    }
    return MOODS[0];
  };

  Weather.prototype.update = function (dt, t) {
    this.hold -= dt;
    if (this.hold <= 0) {
      var next = this.pick();
      /* Avoid repeating the same mood twice in a row. */
      if (next === this.target) next = this.pick();
      this.target = next;
      this.hold = lerp(next.dwell[0], next.dwell[1], this.rand());
    }
    /* Long crossfade: haze moves slower than rain so skies thicken before it falls. */
    this.haze = approach(this.haze, this.target.haze, 26, dt);
    this.rain = approach(this.rain, this.target.rain, 18, dt);

    this.windHold -= dt;
    if (this.windHold <= 0) {
      this.windTarget = 0.12 + this.rand() * 0.85;
      this.windHold = 25 + this.rand() * 60;
    }
    this.wind = approach(this.wind, this.windTarget + this.rain * 0.25, 9, dt);
  };

  /* --- rain ----------------------------------------------------------
   *
   * Drops fall in screen pixels: they are on the glass between the viewer and
   * the sea, not in the world. What the rain does to the water — rings, and
   * the light going out of it — belongs to the sea shader.
   */

  Weather.prototype.resize = function (w, h, reduced) {
    var want = clamp(Math.round(w * h / 3400), 90, 460);
    var drops = this.drops;
    while (drops.length < want) {
      drops.push({ x: 0, y: 0, len: 0, speed: 0, a: 0, depth: 1, seeded: false });
    }
    drops.length = want;
    for (var i = 0; i < want; i++) drops[i].seeded = false;
  };

  Weather.prototype.seedDrop = function (d, w, h, reduced, fresh) {
    var r = this.rand;
    d.x = r() * (w + 260) - 130;
    d.y = fresh ? r() * h : -r() * 120 - 10;
    d.len = lerp(9, 30, r()) * (reduced ? 0.6 : 1);
    d.speed = lerp(480, 980, r()) * (reduced ? 0.45 : 1);
    d.a = lerp(0.10, 0.30, r());
    d.depth = lerp(0.55, 1, r());
    d.seeded = true;
  };

  Weather.prototype.stepRain = function (dt, w, h, reduced) {
    var want = Math.round(this.drops.length * clamp(this.rain, 0, 1));
    this.dropCount = want;
    var slant = (0.16 + this.wind * 0.42);
    for (var i = 0; i < want; i++) {
      var d = this.drops[i];
      if (!d.seeded) this.seedDrop(d, w, h, reduced, true);
      var vy = d.speed * d.depth;
      d.y += vy * dt;
      d.x += vy * slant * dt;
      if (d.y > h + 20 || d.x > w + 160 || d.x < -160) this.seedDrop(d, w, h, reduced, false);
    }
  };

  SL.Weather = Weather;
})(window.SL);
