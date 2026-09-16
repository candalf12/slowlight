/* slowlight — birds.
 *
 * A fixed pool. Flocks are drawn from it and returned to it; when the pool is
 * busy no new flock starts, which caps the cost and the memory for good. They
 * fly in the world now rather than across the frame, so a flock can pass ahead
 * of the bow, behind the stern, or straight overhead.
 *
 * Each bird is one small billboard off a strip of wing positions, which keeps
 * the silhouette soft at the size they are actually seen at.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, mix = SL.mix, TAU = SL.TAU;

  var POOL = 26, FRAMES = 8;
  var FW = 64, FH = 32;
  var GONE = 620;

  /* A gull, drawn once at each point of its flap. */
  function buildAtlas() {
    var c = SL.glCanvas(FW * FRAMES, FH);
    var g = c.getContext('2d');
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (var f = 0; f < FRAMES; f++) {
      var lift = Math.sin(f / FRAMES * TAU);
      var ox = f * FW + FW * 0.5, oy = FH * 0.60;
      var w = FW * 0.40, l = lift * FH * 0.30;
      g.lineWidth = 3.0;
      g.beginPath();
      g.moveTo(ox - w, oy - l * 0.55);
      g.quadraticCurveTo(ox - w * 0.4, oy - l, ox, oy);
      g.quadraticCurveTo(ox + w * 0.4, oy - l, ox + w, oy - l * 0.55);
      g.stroke();
    }
    return c;
  }

  function Birds(world) {
    this.rand = world.stream('birds3');
    this.list = [];
    for (var i = 0; i < POOL; i++) {
      this.list.push({
        alive: false, wx: 0, wy: 0, wz: 0,
        vx: 0, vy: 0, vz: 0, s: 1, ph: 0, rate: 1, drift: 0.4, a: 0,
        x: 0, y: 0
      });
    }
    this.hold = 12 + this.rand() * 40;
    this.tex = null;
    this._p = [0, 0, 0];
  }

  Birds.prototype.init = function (gl) {
    this.tex = SL.glTexture(gl, buildAtlas());
  };

  Birds.prototype.spawnFlock = function (s) {
    var r = this.rand;
    var free = 0, i;
    for (i = 0; i < POOL; i++) if (!this.list[i].alive) free++;
    var want = 2 + Math.floor(r() * 6);
    if (free < want) return;

    /* Somewhere out on the water, crossing rather than following. */
    var bearing = r() * TAU;
    var dist = lerp(105, 300, r());
    var cx = s.boatX + Math.sin(bearing) * dist;
    var cz = s.boatZ + Math.cos(bearing) * dist;
    var cy = lerp(14, 85, Math.pow(r(), 1.3));
    var course = bearing + Math.PI + (r() - 0.5) * 1.9;
    var speed = lerp(6, 14, r());
    var scale = lerp(1.15, 2.45, r());

    var placed = 0;
    for (var j = 0; j < POOL && placed < want; j++) {
      var b = this.list[j];
      if (b.alive) continue;
      b.alive = true;
      b.wx = cx + (r() - 0.5) * 34;
      b.wz = cz + (r() - 0.5) * 34;
      b.wy = cy + (r() - 0.5) * 9;
      b.vx = Math.sin(course) * speed * lerp(0.92, 1.08, r());
      b.vz = Math.cos(course) * speed * lerp(0.92, 1.08, r());
      b.vy = 0;
      b.s = scale * lerp(0.82, 1.18, r());
      b.ph = r() * TAU;
      b.rate = lerp(2.6, 4.6, r());
      b.drift = lerp(0.25, 0.7, r());
      b.a = lerp(0.45, 0.9, r());
      placed++;
    }
  };

  Birds.prototype.update = function (dt, s) {
    for (var i = 0; i < POOL; i++) {
      var b = this.list[i];
      if (!b.alive) continue;
      b.wx += b.vx * dt * s.motion;
      b.wz += b.vz * dt * s.motion;
      b.wy += Math.sin(s.t * b.drift + b.ph) * 2.6 * dt * s.motion;
      b.ph += dt * b.rate;
      var dx = b.wx - s.boatX, dz = b.wz - s.boatZ;
      if (dx * dx + dz * dz > GONE * GONE) b.alive = false;
    }
    this.hold -= dt;
    if (this.hold <= 0) {
      this.hold = 22 + this.rand() * 70;
      /* Birds keep off the wing in heavy weather and deep dark. */
      if (s.weather.rain < 0.35 && s.pal.light > 0.13) this.spawnFlock(s);
    }
  };

  /* When the origin is rebased the flock has to move with it. */
  Birds.prototype.shift = function (dx, dz) {
    for (var i = 0; i < POOL; i++) {
      this.list[i].wx += dx;
      this.list[i].wz += dz;
    }
  };

  Birds.prototype.draw = function (batch, s) {
    var pal = s.pal;
    var col = mix(pal.skyTop, [0, 0, 0], 0.30);
    var base = clamp(pal.light * 1.5 + 0.12, 0, 1) * (1 - s.weather.haze * 0.45);
    var rx = s.camRight[0], ry = s.camRight[1], rz = s.camRight[2];
    var ux = s.camUp[0], uy = s.camUp[1], uz = s.camUp[2];
    var fx = s.camFwd[0], fy = s.camFwd[1], fz = s.camFwd[2];
    var uw = 1 / FRAMES;
    var p = this._p;

    for (var i = 0; i < POOL; i++) {
      var b = this.list[i];
      if (!b.alive) continue;
      var x = b.wx, y = b.wy, z = b.wz;
      var dx = x - s.eyeX, dy = y - s.eyeY, dz = z - s.eyeZ;
      /* Where it is on the screen, so the sound can sit where the bird does.
       * One behind the eye is nowhere in particular, so it is put in the
       * middle rather than dragging the flock's pan off to one side. */
      SL.m4project(s.viewProj, x, y, z, p);
      var ahead = p[2] > 1e-4;
      b.x = ahead ? (p[0] / p[2] * 0.5 + 0.5) * s.W : s.W * 0.5;
      b.y = ahead ? (0.5 - p[1] / p[2] * 0.5) * s.H : s.H * 0.5;
      if (dx * fx + dy * fy + dz * fz < 1) continue;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      var fog = 1 - Math.exp(-(dist * dist) / (s.fogD * s.fogD));
      var a = b.a * base * (1 - fog);
      if (a < 0.02) continue;
      var c = mix(col, pal.haze, fog * 0.7);
      var frame = Math.floor((b.ph / TAU % 1 + 1) % 1 * FRAMES);
      var hw = b.s * 0.95;
      batch.billboard(x, y, z, rx, ry, rz, ux, uy, uz, hw, hw * (FH / FW),
                      frame * uw, 0, (frame + 1) * uw, 1,
                      c[0] / 255, c[1] / 255, c[2] / 255, clamp(a, 0, 1));
    }
    batch.flush(this.tex);
  };

  SL.Birds = Birds;
})(window.SL);
