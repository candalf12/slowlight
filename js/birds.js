/* slowlight — birds.
 *
 * A fixed pool. Flocks are drawn from it and returned to it; when the pool is
 * busy no new flock starts, which caps the cost and the memory for good.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, rgba = SL.rgba, TAU = SL.TAU;

  var POOL = 26;

  function Birds(world) {
    this.rand = world.stream('birds');
    this.list = [];
    for (var i = 0; i < POOL; i++) {
      this.list.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, s: 1, ph: 0, rate: 1, a: 0 });
    }
    this.hold = 12 + this.rand() * 40;
  }

  Birds.prototype.spawnFlock = function (s) {
    var r = this.rand;
    var free = 0;
    for (var i = 0; i < POOL; i++) if (!this.list[i].alive) free++;
    var want = 2 + Math.floor(r() * 6);
    if (free < want) return;

    var dir = r() < 0.68 ? -1 : 1;           /* most pass the way the world drifts */
    var baseY = s.horizonY * lerp(0.30, 0.93, Math.pow(r(), 1.3));
    var speed = lerp(26, 62, r());
    var scale = lerp(0.5, 1.25, r()) * (s.unit / 900);
    var startX = dir < 0 ? s.W + 40 : -40;
    var placed = 0;
    for (var j = 0; j < POOL && placed < want; j++) {
      var b = this.list[j];
      if (b.alive) continue;
      b.alive = true;
      b.x = startX + dir * -1 * (placed * lerp(18, 52, r()));
      b.y = baseY + (r() - 0.5) * s.horizonY * 0.16;
      b.vx = dir * speed * lerp(0.9, 1.1, r());
      b.vy = 0;
      b.s = scale * lerp(0.82, 1.18, r());
      b.ph = r() * TAU;
      b.rate = lerp(2.6, 4.6, r());
      b.drift = lerp(0.25, 0.7, r());
      b.a = lerp(0.35, 0.8, r());
      placed++;
    }
  };

  Birds.prototype.update = function (dt, s) {
    for (var i = 0; i < POOL; i++) {
      var b = this.list[i];
      if (!b.alive) continue;
      b.x += b.vx * dt * s.motion;
      b.y += Math.sin(s.t * b.drift + b.ph) * 5 * dt * s.motion;
      b.ph += dt * b.rate;
      if (b.x < -80 || b.x > s.W + 80) b.alive = false;
    }
    this.hold -= dt;
    if (this.hold <= 0) {
      this.hold = 22 + this.rand() * 70;
      /* Birds keep off the wing in heavy weather and deep dark. */
      if (s.weather.rain < 0.35 && s.pal.light > 0.13) this.spawnFlock(s);
    }
  };

  Birds.prototype.draw = function (ctx, s) {
    var pal = s.pal;
    var col = SL.mix(pal.skyTop, [0, 0, 0], 0.35);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = 0; i < POOL; i++) {
      var b = this.list[i];
      if (!b.alive) continue;
      /* Flap: wings sweep between raised and level. */
      var flap = Math.sin(b.ph);
      var w = 5.2 * b.s;
      var lift = flap * 2.6 * b.s;
      var a = b.a * clamp(pal.light * 1.5 + 0.12, 0, 1) * (1 - s.weather.haze * 0.45);
      if (a < 0.02) continue;
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = Math.max(0.7, 1.0 * b.s);
      ctx.beginPath();
      ctx.moveTo(b.x - w, b.y - lift * 0.55);
      ctx.quadraticCurveTo(b.x - w * 0.4, b.y - lift, b.x, b.y);
      ctx.quadraticCurveTo(b.x + w * 0.4, b.y - lift, b.x + w, b.y - lift * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  };

  SL.Birds = Birds;
})(window.SL);
