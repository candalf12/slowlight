/* slowlight — one running scene.
 *
 * Owns the world, the helm, and the order everything is drawn in. Kept
 * separate from the page plumbing so a scene can be built, advanced and drawn
 * on any canvas.
 *
 * The world is endless in both directions, and float32 is not: `orgX/orgZ` is
 * an origin snapped near the boat, and everything handed to the GPU is offset
 * against it. `s.worldX/worldZ` stay absolute and stay in double precision.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, approach = SL.approach, TAU = SL.TAU;

  var BASE_SPEED = 5.4;        /* world units per second at her own pace */
  var TURN_RATE = 0.155;       /* radians per second at full helm */
  var STEER_IN = 1.15, STEER_OUT = 1.7;
  var COURSE_RATE = 0.30;      /* how fast the throttle moves under the hand */
  var COURSE_SETTLE = 26;      /* seconds to give the sheets back to the sea */
  var COURSE_EASE = 2.6;
  var ORIGIN_GRID = 1024;

  function Scene(canvas, seed) {
    this.canvas = canvas;
    this.seed = seed;
    this.gl = null;
    this.ok = false;

    var world = this.world = new SL.World(seed);
    this.sky = new SL.Sky(world.stream('sky'), world);
    this.sea = new SL.Sea(world);
    this.islands = new SL.Islands(world);
    this.boat = new SL.Boat(world);
    this.birds = new SL.Birds(world);
    this.weather = new SL.Weather(world.stream('weather'));
    this.camera = new SL.Camera(world);

    var s = this.s = {
      W: 0, H: 0, dpr: 1, unit: 900, horizonY: 0,
      t: 0, phase: 0, startPhase: 0,
      pal: SL.makePalette(), weather: this.weather,
      wind: 0.3, motion: 1, reduced: false, warming: false,

      /* Where she is: absolute in the world, and offset for the shaders. */
      worldX: 0, worldZ: 0, orgX: 0, orgZ: 0,
      boatX: 0, boatZ: 0, boatY: 0,
      heading: 0, windFrom: 0,
      boatPitch: 0, boatRoll: 0, waterRoll: 0, sailHeel: 0,
      waterY: 0, swell: 0,
      speed: 0, course: 1, courseTarget: 1, courseHome: 1,
      steer: 0, steerInput: 0, throttleInput: 0,

      eyeX: 0, eyeY: 4, eyeZ: 0,
      camFwd: null, camRight: null, camUp: null,
      viewProj: null, tanX: 0.8, tanY: 0.46,

      body: {
        dx: 0, dy: 0.5, dz: 1, vis: 0, isMoon: false, elev: 0, u: 0,
        radius: 0.013, glow: 0.08, mx: 1, my: 0, mz: 0, moonPhase: 0
      },
      fogD: 1100, hazeBand: 0.3, specK: 0
    };

    /* The seed decides where in the world this voyage begins — a different
     * seed sets out from different water, past different land... */
    s.worldX = world.value('start') * 4.0e5;
    s.worldZ = world.value('start/z') * 4.0e5;
    /* ...and at a different hour, within the stretch of the cycle worth
     * arriving in: late light through to the blue hour. */
    s.startPhase = (0.88 + world.value('hour') * 0.30 + 1) % 1;
    s.phase = s.startPhase;
    /* ...and on a different point of sail, but always a comfortable one. */
    s.windFrom = this.sea.windDir + Math.PI;
    s.heading = s.windFrom + (world.value('course') < 0 ? -1 : 1) *
                (1.85 + world.unit('course/2') * 0.75);
    s.courseHome = 0.88 + world.unit('pace') * 0.28;
    s.course = s.courseTarget = s.courseHome;
    this.rebase(true);
    this._avoid = { push: 0, dx: 0, dz: 0, depth: 1 };
  }

  /* ---------- setup ------------------------------------------------------ */

  Scene.prototype.init = function () {
    var gl = this.gl = SL.glContext(this.canvas);
    if (!gl) return false;
    try {
      this.sky.init(gl);
      this.sea.init(gl);
      this.islands.init(gl);
      this.boat.init(gl);
      this.birds.init(gl);
      this.batch = new SL.Batch(gl, 8192);
      this.overlay = new SL.Overlay(gl);
    } catch (e) {
      this.gl = null;
      this.error = e;
      return false;
    }
    gl.disable(gl.CULL_FACE);
    gl.depthFunc(gl.LEQUAL);
    this.ok = true;
    return true;
  };

  Scene.prototype.setReduced = function (reduced) {
    var s = this.s;
    s.reduced = !!reduced;
    /* Reduced motion softens the swell; it never stops the scene. */
    s.motion = s.reduced ? 0.45 : 1;
    if (s.W) this.weather.resize(s.W, s.H, s.reduced);
  };

  Scene.prototype.setSize = function (W, H, dpr) {
    var s = this.s;
    s.W = W; s.H = H; s.dpr = dpr;
    s.unit = Math.min(W, H * 1.5);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.camera.setSize(W, H);
    s.tanX = this.camera.tanX;
    s.tanY = this.camera.tanY;
    this.weather.resize(W, H, s.reduced);
    if (this.overlay) this.overlay.setSize(W, H);
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    SL.samplePalette(s.pal, s.phase, this.weather);
  };

  /* Run the simulation forward without drawing, so the scene never opens on
   * a flat sea. */
  Scene.prototype.warmup = function (seconds) {
    var s = this.s;
    s.warming = true;
    var step = 1 / 24;
    var n = Math.min(Math.round(seconds / step), 4000);
    for (var i = 0; i < n; i++) this.update(step);
    s.warming = false;
    this.camera.snap(this.sea, s);
    this.readCamera();
  };

  /* ---------- the origin ------------------------------------------------- */

  /* Keep the numbers the shaders see small. Everything that lives in the local
   * frame moves with the origin; the wave phases are refolded in double
   * precision, so the water itself does not notice. */
  Scene.prototype.rebase = function (force) {
    var s = this.s;
    var nx = Math.round(s.worldX / ORIGIN_GRID) * ORIGIN_GRID;
    var nz = Math.round(s.worldZ / ORIGIN_GRID) * ORIGIN_GRID;
    if (!force && nx === s.orgX && nz === s.orgZ) {
      s.boatX = s.worldX - s.orgX;
      s.boatZ = s.worldZ - s.orgZ;
      return;
    }
    var dx = s.orgX - nx, dz = s.orgZ - nz;
    s.orgX = nx; s.orgZ = nz;
    s.boatX = s.worldX - nx;
    s.boatZ = s.worldZ - nz;
    if (!force) {
      this.camera.shift(dx, dz);
      this.boat.shift(dx, dz);
      this.birds.shift(dx, dz);
    }
    this.sea.rebase(nx, nz);
  };

  /* ---------- helm -------------------------------------------------------
   *
   * Left and right turn her; up and down decide how hard she is sailing. Both
   * are rates and both ease, and left alone both drift back to the course this
   * world sails on its own.
   */

  Scene.prototype.helm = function (dt) {
    var s = this.s;

    /* Steering eases in and, with nothing held, eases straight back to zero. */
    s.steer = approach(s.steer, s.steerInput,
                       s.steerInput === 0 ? STEER_OUT : STEER_IN, dt);
    if (Math.abs(s.steer) < 0.0015) s.steer = 0;

    if (s.throttleInput) {
      s.courseTarget = clamp(s.courseTarget + s.throttleInput * COURSE_RATE * dt, 0.30, 1.75);
    } else {
      s.courseTarget = approach(s.courseTarget, s.courseHome, COURSE_SETTLE, dt);
    }
    s.course = approach(s.course, s.courseTarget, COURSE_EASE, dt);

    /* Left alone, she still wanders on a slow noise of her own. */
    var wander = SL.sfbm(s.t * 0.0095, 4.7, 2) * 0.013;

    /* Land leans on the helm long before it is close enough to matter, and
     * leans harder the nearer it gets. She is never stopped or turned away;
     * she simply finds she would rather go round. */
    var av = this.islands.avoid(s.worldX, s.worldZ, this._avoid);
    var shy = 0;
    if (av.push > 0.001) {
      /* Which way round is whichever way she is already leaning. */
      var hx = Math.sin(s.heading), hz = Math.cos(s.heading);
      var cross = hx * av.dz - hz * av.dx;
      shy = (cross >= 0 ? 1 : -1) * av.push * av.push * 0.30;
    }

    s.heading += (s.steer * TURN_RATE + wander + shy) * dt;
    if (s.heading > TAU) s.heading -= TAU;
    else if (s.heading < 0) s.heading += TAU;

    /* She sails better with the wind on the quarter than on the nose — a
     * character, not a mechanic: she never stops for it. */
    var off = Math.abs(SL.angleDelta(s.heading, s.windFrom));
    var trim = 0.74 + 0.26 * SL.smoothstep(0.22, 1.15, off);
    var shoal = lerp(1, 0.24, SL.smoothstep(0.12, 0.88, av.push));

    s.speed = BASE_SPEED * s.course * trim * shoal * s.motion;
    s.worldX += Math.sin(s.heading) * s.speed * dt;
    s.worldZ += Math.cos(s.heading) * s.speed * dt;
    this.rebase(false);
  };

  /* ---------- update ----------------------------------------------------- */

  Scene.prototype.readCamera = function () {
    var s = this.s, c = this.camera;
    s.eyeX = c.x; s.eyeY = c.y; s.eyeZ = c.z;
    s.camFwd = c.fwd; s.camRight = c.right; s.camUp = c.up;
    s.viewProj = c.viewProj;
    /* Where the horizon lands on the glass, for anything that needs to know. */
    s.horizonY = (0.5 + 0.5 * Math.tan(c.pitch) / Math.max(c.tanY, 1e-4)) * s.H;
  };

  Scene.prototype.update = function (dt) {
    var s = this.s, weather = this.weather;
    s.t += dt;
    s.phase = s.startPhase + s.t / SL.CYCLE_SECONDS;
    weather.update(dt, s.t);
    SL.samplePalette(s.pal, s.phase, weather);
    s.wind = weather.wind;

    this.helm(dt);
    this.sea.setWind(s.wind, s.motion);
    this.boat.settle(this.sea, s, dt);
    this.camera.follow(this.sea, s, dt);
    this.readCamera();

    this.sky.bodyState(s);
    var b = s.body;
    var damp = 1 - clamp(weather.haze * 0.55 + weather.rain * 0.45, 0, 0.9);
    s.fogD = clamp(1150 * (1 - weather.haze * 0.55 - weather.rain * 0.30), 360, 1250);
    s.hazeBand = clamp(0.24 + weather.haze * 0.5 + weather.rain * 0.2, 0, 0.8);
    s.specK = b.vis * damp * (b.isMoon ? 0.5 : 1) * lerp(0.22, 1, s.pal.light);

    this.sky.update(dt, s);
    this.islands.update(s);
    this.birds.update(dt, s);
    weather.stepRain(dt, s.W, s.H, s.reduced);
  };

  /* ---------- draw ------------------------------------------------------- */

  Scene.prototype.draw = function () {
    var gl = this.gl, s = this.s, batch = this.batch;
    if (!gl || !this.ok) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    /* The last pass of the previous frame left depth writes off, and a masked
     * depth buffer does not clear. */
    gl.depthMask(true);
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    /* The world first. The sky then fills what the sea and the land have left,
     * rather than being painted across the whole frame and covered up. */
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    this.sea.draw(gl, s);
    this.islands.draw(gl, s);
    this.boat.draw(gl, s);

    gl.depthMask(false);
    this.sky.drawSky(gl, s);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.sky.drawStars(gl, s);
    batch.begin(s.viewProj);
    this.sky.drawMeteor(batch, s);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.sky.drawClouds(batch, s);

    /* Then everything that lies on the water or flies over it. */
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    batch.begin(s.viewProj);
    this.boat.drawReflection(batch, this.sea, s);
    this.boat.drawWake(batch, this.sea, s);
    this.islands.drawSurf(batch, this.sea, s);
    batch.flush(batch.dot);
    this.birds.draw(batch, s);

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.boat.drawLamp(batch, s);
    batch.flush(batch.dot);

    /* And the glass. */
    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.overlay.drawRain(batch, s);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.overlay.draw(s);
    gl.disable(gl.BLEND);
  };

  /* A last wash of black over everything, for the stop. */
  Scene.prototype.fadeOut = function (amount) {
    var gl = this.gl, s = this.s;
    if (!gl || !this.ok) return;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.batch.begin(this.overlay.ortho);
    this.batch.quad(0, 0, 0, s.W, 0, 0, s.W, s.H, 0, 0, s.H, 0,
                    0.5, 0.5, 0.5, 0.5, 0.016, 0.024, 0.043, clamp(amount, 0, 1));
    this.batch.flush(this.batch.white);
    gl.disable(gl.BLEND);
  };

  SL.Scene = Scene;
})(window.SL);
