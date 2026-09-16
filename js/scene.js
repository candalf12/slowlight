/* slowlight — one running scene.
 *
 * Owns the world and everything drawn in it. Kept separate from the page
 * plumbing so a scene can be built, advanced and drawn on any canvas.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, approach = SL.approach;
  var rgba = SL.rgba, css = SL.css, mix = SL.mix, TAU = SL.TAU;

  var BASE_SPEED = 0.042;      /* fraction of `unit` travelled per second */

  /* Helming. Left and right move the boat across the water, up and down move
   * it through the band stack; both are rates, and both ease, so the boat
   * glides rather than jumping. Released, each one drifts back to the course
   * this world sails on its own. */
  var ACROSS_RATE = 0.155;     /* fraction of the frame crossed per second */
  var ACROSS_HOME = 0.40;
  var ACROSS_SETTLE = 24;      /* seconds to give the wheel back to the sea */
  var ACROSS_EASE = 0.55;
  var DEPTH_RATE = 0.125;      /* fraction of the depth range per second */
  var DEPTH_SETTLE = 32;
  var DEPTH_EASE = 0.70;
  var grainPattern = null;

  function buildGrain(ctx) {
    if (grainPattern) return grainPattern;
    var n = 128;
    var c = document.createElement('canvas');
    c.width = n; c.height = n;
    var g = c.getContext('2d');
    var img = g.createImageData(n, n);
    var d = img.data;
    /* Deterministic, and static once built — static grain never flickers. */
    var r = SL.mulberry32(0x5105117);
    for (var i = 0; i < n * n; i++) {
      var v = (r() * 255) | 0;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(c, 'repeat');
    return grainPattern;
  }

  function Scene(canvas, seed) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.seed = seed;

    var world = this.world = new SL.World(seed);
    this.sky = new SL.Sky(world.stream('sky'));
    this.sea = new SL.Sea(world);
    this.islands = new SL.Islands(world);
    this.boat = new SL.Boat(world);
    this.birds = new SL.Birds(world);
    this.weather = new SL.Weather(world.stream('weather'));
    this.sky.init();

    var s = this.s = {
      W: 0, H: 0, dpr: 1, unit: 900,
      t: 0, phase: 0, startPhase: 0,
      worldX: 0, speed: 0, course: 1,
      steer: 0, steerInput: 0, depthInput: 0,
      boatX: 0, wind: 0.3,
      /* Where the boat sits on the water: `across` is its lane in the frame,
       * `depth` is 0 at the far end of the band stack and 1 at the near end.
       * `boatLayerF` is that depth as a continuous band coordinate, and
       * `boatScale` is how big the boat reads at it. */
      across: ACROSS_HOME, acrossTarget: ACROSS_HOME,
      depth: 0, depthTarget: 0, depthHome: 0,
      boatLayerF: 0, boatScale: 1,
      horizonY: 0, horizonBase: 0,
      motion: 1, reduced: false,
      pal: SL.makePalette(),
      weather: this.weather
    };

    /* The seed decides where in the world this voyage begins — a different
     * seed sets out from different water, past different land... */
    s.worldX = world.value('start') * 5.0e6;
    /* ...and at a different hour, within the stretch of the cycle worth
     * arriving in: late light through to the blue hour. */
    s.startPhase = (0.88 + world.value('hour') * 0.30) % 1;
    s.phase = s.startPhase;
    /* ...and on slightly different water, a little nearer or further out.
     * The range is centred on the band the boat used to be pinned to. */
    s.depthHome = SL.SEA_DEPTH_HOME - 0.10 + world.value('depth') * 0.20;
    s.depth = s.depthTarget = s.depthHome;
    s.boatLayerF = SL.lerp(SL.SEA_DEPTH_FAR, SL.SEA_DEPTH_NEAR, s.depth);
    this.vignette = null;
  }

  Scene.prototype.setReduced = function (reduced) {
    var s = this.s;
    s.reduced = !!reduced;
    /* Reduced motion softens the swell; it never stops the scene. */
    s.motion = s.reduced ? 0.45 : 1;
    if (s.W) this.weather.resize(s.W, s.H, s.reduced);
  };

  Scene.prototype.setSize = function (W, H, dpr) {
    var s = this.s, ctx = this.ctx;
    s.W = W; s.H = H; s.dpr = dpr;
    s.unit = Math.min(W, H * 1.5);
    s.horizonBase = Math.round(H * 0.455);
    s.horizonY = s.horizonBase;

    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.sea.resize(W, H, s.horizonY, s.unit);
    this.sky.resizeClouds(W, H);
    this.weather.resize(W, H, s.reduced);
    s.boatX = W * s.across;

    var vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.30,
                                      W * 0.5, H * 0.52, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    this.vignette = vg;
    buildGrain(ctx);
    SL.samplePalette(s.pal, s.phase, this.weather);
  };

  /* Run the simulation forward without drawing, so the scene never opens on
   * a flat sea. */
  Scene.prototype.warmup = function (seconds) {
    var step = 1 / 24;
    var n = Math.min(Math.round(seconds / step), 4000);
    for (var i = 0; i < n; i++) this.update(step);
  };

  /* ---------- helm ------------------------------------------------------
   *
   * Where the boat sits: `depth` walks it through the band stack, `across`
   * slides it over the water. Both are pushed by the arrow keys and, left
   * alone, drift back to the course the world sails on its own.
   */

  Scene.prototype.helm = function (dt) {
    var s = this.s, sea = this.sea;

    if (s.depthInput) {
      s.depthTarget = clamp(s.depthTarget + s.depthInput * DEPTH_RATE * dt, 0, 1);
    } else {
      s.depthTarget = approach(s.depthTarget, s.depthHome, DEPTH_SETTLE, dt);
    }
    s.depth = clamp(approach(s.depth, s.depthTarget, DEPTH_EASE, dt), 0, 1);
    s.boatLayerF = lerp(SL.SEA_DEPTH_FAR, SL.SEA_DEPTH_NEAR, s.depth);

    /* The boat reads smaller the further below the horizon its water sits —
     * the same relation the bands are laid out with, so it shrinks with
     * distance exactly as the water it rides on does. */
    var refDy = Math.max(1, sea.topAt(sea.boatLayer) - s.horizonY);
    var dy = Math.max(0.5, sea.topAt(s.boatLayerF) - s.horizonY);
    s.boatScale = clamp(Math.pow(dy / refDy, 0.70), 0.12, 2.0);

    /* A distant boat crosses the frame slowly; a near one sweeps across it. */
    var rate = ACROSS_RATE * lerp(0.35, 1, s.boatScale);
    if (s.steerInput) {
      s.acrossTarget += s.steerInput * rate * dt;
    } else {
      s.acrossTarget = approach(s.acrossTarget, ACROSS_HOME, ACROSS_SETTLE, dt);
    }
    /* Keep the whole boat in frame, whatever size it is at this depth. */
    var margin = clamp(s.unit * 0.105 * s.boatScale * 0.80 / s.W, 0.03, 0.42);
    s.acrossTarget = clamp(s.acrossTarget, margin, 1 - margin);
    s.across = approach(s.across, s.acrossTarget, ACROSS_EASE, dt);

    var drift = SL.sfbm(s.t * 0.019, 11.3, 2);
    var lane = s.across + s.steer * 0.042 + drift * 0.022;
    s.boatX = s.W * clamp(lane, margin, 1 - margin);
  };

  /* ---------- update ---------------------------------------------------- */

  Scene.prototype.update = function (dt) {
    var s = this.s, weather = this.weather;
    s.t += dt;
    s.phase = s.startPhase + s.t / SL.CYCLE_SECONDS;
    weather.update(dt, s.t);
    SL.samplePalette(s.pal, s.phase, weather);
    s.wind = weather.wind;

    /* Steering eases in and, with nothing held, eases straight back to zero. */
    s.steer = approach(s.steer, s.steerInput, s.steerInput === 0 ? 1.6 : 0.9, dt);
    if (Math.abs(s.steer) < 0.0015) s.steer = 0;

    /* Left alone, the boat still wanders on a slow noise of its own. */
    var wander = SL.sfbm(s.t * 0.012, 4.7, 2);
    s.course = clamp(1 + s.steer * 0.55 + wander * 0.26, 0.18, 1.9);
    s.speed = s.unit * BASE_SPEED * s.course;
    s.worldX += s.speed * dt * s.motion;

    /* The viewer's own vantage breathes a little. */
    s.horizonY = s.horizonBase +
      Math.sin(s.t * 0.11) * s.H * 0.0035 * s.motion +
      Math.sin(s.t * 0.047 + 2.1) * s.H * 0.0025 * s.motion;
    this.sea.resize(s.W, s.H, s.horizonY, s.unit);
    this.helm(dt);

    this.sky.update(dt, s);
    this.islands.update(s);
    this.birds.update(dt, s);
    weather.stepRain(dt, s.W, s.H, s.reduced);
  };

  /* ---------- draw ------------------------------------------------------ */

  Scene.prototype.drawRipples = function () {
    var weather = this.weather, s = this.s, ctx = this.ctx, sea = this.sea;
    if (weather.rippleCount < 1) return;
    var pal = s.pal;
    var last = SL.SEA_LAYERS - 1;
    ctx.save();
    for (var i = 0; i < weather.rippleCount; i++) {
      var p = weather.ripples[i];
      var li = last - (p.band < 0.5 ? 0 : 1);
      var y = sea.waveY(li, p.x, s) + (p.band < 0.5 ? p.band * 70 : (p.band - 0.5) * 40) + 6;
      if (y > s.H + 6) continue;
      var k = p.life / p.ttl;
      var a = k * k * 0.22 * clamp(weather.rain * 1.4, 0, 1) * (0.3 + pal.light * 0.8);
      if (a < 0.012) continue;
      ctx.strokeStyle = rgba(pal.foam, a);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(p.x, y, p.r, p.r * 0.3, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  };

  Scene.prototype.drawAtmosphere = function () {
    var s = this.s, ctx = this.ctx, weather = this.weather, pal = s.pal;
    var fogA = clamp(weather.haze * 0.26 + weather.rain * 0.16, 0, 0.38);
    if (fogA > 0.005) {
      /* Denser toward the horizon, where distance piles up. */
      var top = s.horizonY - s.H * 0.22;
      var g = ctx.createLinearGradient(0, top, 0, s.H);
      g.addColorStop(0, rgba(pal.haze, fogA * 0.25));
      g.addColorStop(0.3, rgba(pal.haze, fogA));
      g.addColorStop(1, rgba(pal.haze, fogA * 0.3));
      ctx.fillStyle = g;
      ctx.fillRect(0, top, s.W, s.H - top);
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, s.W, s.H);
    if (grainPattern) {
      ctx.save();
      ctx.globalAlpha = 0.024;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = grainPattern;
      ctx.fillRect(0, 0, s.W, s.H);
      ctx.restore();
    }
  };

  Scene.prototype.draw = function () {
    var ctx = this.ctx, s = this.s, self = this;
    var body = this.sky.bodyState(s);
    this.sky.drawGradient(ctx, s);
    this.sky.drawStars(ctx, s);
    this.sky.drawBody(ctx, s, body);
    this.sky.drawClouds(ctx, s);
    this.sky.drawHorizonHaze(ctx, s, body);
    this.birds.draw(ctx, s);
    this.islands.draw(ctx, s);
    this.sea.draw(ctx, s, body, function () { self.boat.draw(ctx, self.sea, s); });
    this.drawRipples();
    this.weather.drawRain(ctx, s.W, s.H, s.pal);
    this.drawAtmosphere();
  };

  SL.Scene = Scene;
})(window.SL);
