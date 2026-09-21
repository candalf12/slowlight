/* slowlight - the sound of the place.
 *
 * Everything here is synthesised in the browser: filtered noise, a couple of
 * oscillators, envelopes. No files, no network, nothing to download.
 *
 * The soundscape reads the same scene state the picture is drawn from - the
 * swell under the hull, the wind, the rain, the birds, the hour - so it always
 * describes what is actually on screen. Because that state never repeats,
 * neither does the sound: there is no cycle to come round again.
 *
 * It is an addition to the page, never a requirement of it. With no Web Audio,
 * with autoplay refused, or with the viewer muted, the scene runs exactly as
 * it did before and nothing is logged.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, approach = SL.approach, sfbm = SL.sfbm;

  var STORE_ON = 'slowlight.sound';
  var STORE_VOL = 'slowlight.volume';
  var DEFAULT_VOL = 0.34;      /* quiet by default; the viewer can come up */
  var CEILING = 0.52;          /* what a volume of 1 actually means at the master */
  var PUSH = 0.05;             /* seconds between pushes of scene state at the graph */
  var ARRIVE = 6.0;            /* seconds for the first sound to arrive out of silence */
  var NOMINAL = 44100;         /* rate the noise is generated against */
  var NOISE = [8.3, 11.9, 6.7]; /* seconds of noise: three unrelated lengths */

  function Ctor() { return window.AudioContext || window.webkitAudioContext || null; }

  function readStore(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }          /* storage blocked: use the default */
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* nothing to do */ }
  }

  /* ---------- material ---------------------------------------------------
   *
   * Three noise buffers of unrelated lengths, played back at unrelated rates.
   * Nothing lines up, so nothing beats against itself into a pattern.
   */

  /* Pink noise (Kellet's filter over seeded white). Pink sits far easier on the
   * ear across twenty minutes than white, and it is what moving water is.
   *
   * Generated against a nominal rate rather than the context's: this is noise,
   * so a few percent either way is neither here nor there, and it means the
   * expensive part can be made before there is a context to make it for. */
  function pink(seconds, rand) {
    var n = Math.max(1, Math.round(NOMINAL * seconds));
    var fade = Math.min(Math.round(NOMINAL * 0.4), n >> 2);
    var raw = new Float32Array(n + fade);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < n + fade; i++) {
      var w = rand() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
    /* Cross-fade the tail into the head so the seam itself is never a click -
     * a click once per loop is exactly the repeat we are avoiding. */
    for (var j = 0; j < fade; j++) {
      var t = j / fade;
      raw[j] = raw[j] * t + raw[n + j] * (1 - t);
    }
    var peak = 1e-6;
    for (var k = 0; k < n; k++) { var a = raw[k] < 0 ? -raw[k] : raw[k]; if (a > peak) peak = a; }
    var scale = 0.82 / peak;
    var out = new Float32Array(n);
    for (var m = 0; m < n; m++) out[m] = raw[m] * scale;
    return out;
  }

  function toBuffer(ctx, pcm) {
    var buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buf.getChannelData(0).set(pcm);
    return buf;
  }

  /* A short, dark, diffuse tail. Open water has no reverb to speak of; this is
   * only enough air to put the gulls and the hull at a distance. */
  function airBuffer(ctx, seconds, rand) {
    var n = Math.max(1, Math.round(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      var lp = 0;
      for (var i = 0; i < n; i++) {
        lp += ((rand() * 2 - 1) - lp) * 0.2;
        d[i] = lp * Math.pow(1 - i / n, 3.2);
      }
    }
    return buf;
  }

  /* One looping noise voice: source -> filter -> gain -> (pan) -> destination. */
  function Voice(ctx, buf, rate, offset, type, freq, q, pan, dest) {
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;

    var flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    flt.Q.value = q;

    var gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(flt);
    flt.connect(gain);

    var out = gain;
    if (pan && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      out = p;
    }
    out.connect(dest);

    src.start(0, offset % buf.duration);
    this.src = src;
    this.filter = flt;
    this.gain = gain;
  }

  function ramp(param, v, tau, now) {
    if (!isFinite(v)) return;
    param.setTargetAtTime(v, now, tau);
  }

  /* ---------- the ambience ----------------------------------------------- */

  function Ambience(scene) {
    this.scene = scene;
    this.world = scene.world;
    this.s = scene.s;
    this.rand = scene.world.stream('audio');

    this.enabled = readStore(STORE_ON, 'on') !== 'off';
    var vol = parseFloat(readStore(STORE_VOL, String(DEFAULT_VOL)));
    this.volume = isFinite(vol) ? clamp(vol, 0, 1) : DEFAULT_VOL;

    this.ctx = null;
    this.g = null;
    this.pcm = null;
    this.ready = false;
    this.broken = false;
    this.opened = false;
    this.stopping = false;
    this.hidden = !!document.hidden;
    this.sleepTimer = 0;

    this.acc = 0;
    this.swellE = 0;
    this.prevPitch = 0;
    this.prevRate = 0;
    this.creakHold = 6;
    this.gullHold = 4;
    this.prevBirds = 0;

    /* The seed picks this world's voice the same way it picks its colours.
     * `world.value` hands back the signed reading of its hash, so fold it into
     * [0,1) here rather than touching a helper every existing world depends on. */
    var w = this.world;
    var v = function (name) {
      var x = w.value('audio/' + name);
      return x < 0 ? x + 1 : x;
    };
    this.chr = {
      drone: lerp(46, 63, v('drone')),
      swell: lerp(250, 430, v('swell')),
      wind: lerp(620, 1040, v('wind')),
      rain: lerp(1050, 1500, v('rain')),
      creak: lerp(155, 285, v('creak')),
      gull: lerp(840, 1160, v('gull')),
      width: lerp(0.16, 0.34, v('width')),
      rateA: lerp(0.74, 0.86, v('rate/a')),
      rateB: lerp(0.62, 0.74, v('rate/b')),
      rateC: lerp(0.95, 1.12, v('rate/c'))
    };

    this.mountUI();
    this.arm();
    this.watch();
    this.prepare();

    /* A handle on the running soundscape, for the console - the same courtesy
     * the seed label pays the URL. */
    SL.ambience = this;
  }

  /* ---------- lifecycle --------------------------------------------------- */

  /* Making the noise is the one costly moment in all of this. Do it in the idle
   * time after the scene opens, so the first interaction only has to wire the
   * nodes up and nothing ever stutters under anyone's hand. */
  Ambience.prototype.noise = function () {
    if (!this.pcm) {
      var r = this.world.stream('audio/noise');
      this.pcm = [pink(NOISE[0], r), pink(NOISE[1], r), pink(NOISE[2], r)];
    }
    return this.pcm;
  };

  Ambience.prototype.prepare = function () {
    var self = this;
    var make = function () { if (!self.broken) self.noise(); };
    if (window.requestIdleCallback) window.requestIdleCallback(make, { timeout: 4000 });
    else window.setTimeout(make, 600);
  };

  /* Built only from a real interaction, so the browser never has to refuse it
   * and never has anything to warn about. */
  Ambience.prototype.ensure = function () {
    if (this.ready || this.broken) return this.ready;
    var AC = Ctor();
    if (!AC) { this.broken = true; return false; }
    var ctx;
    try { ctx = new AC({ latencyHint: 'playback' }); }
    catch (e) {
      try { ctx = new AC(); } catch (e2) { this.broken = true; return false; }
    }
    try { this.build(ctx); }
    catch (e3) { this.fail(); return false; }
    this.ready = true;
    return true;
  };

  Ambience.prototype.build = function (ctx) {
    this.ctx = ctx;
    var space = this.world.stream('audio/space');
    var pcm = this.noise();
    var bufA = this.bufA = toBuffer(ctx, pcm[0]);
    var bufB = this.bufB = toBuffer(ctx, pcm[1]);
    var bufC = this.bufC = toBuffer(ctx, pcm[2]);

    var master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    /* A gentle ceiling. Whatever the sea does, nothing can jump at anyone. */
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 30;
    comp.ratio.value = 4;
    comp.attack.value = 0.05;
    comp.release.value = 0.7;
    comp.connect(master);

    /* The hour and the weather tilt the whole picture: night and haze are
     * darker and further off, daylight is a little more open. */
    var tilt = ctx.createBiquadFilter();
    tilt.type = 'lowpass';
    tilt.frequency.value = 2400;
    tilt.Q.value = 0.4;
    tilt.connect(comp);

    var rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 28;
    rumble.Q.value = 0.5;
    rumble.connect(tilt);

    var bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(rumble);

    var revIn = ctx.createGain();
    revIn.gain.value = 1;
    var conv = ctx.createConvolver();
    conv.buffer = airBuffer(ctx, 1.5, space);
    var revOut = ctx.createGain();
    revOut.gain.value = 0.7;
    revIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(bus);

    var c = this.chr;
    var g = this.g = {
      master: master, comp: comp, tilt: tilt, bus: bus, revIn: revIn,
      /* The swell: two slow, dark voices a little apart, so the low end
       * breathes rather than sitting still. */
      swellL: new Voice(ctx, bufA, c.rateA, 1.3, 'lowpass', c.swell, 0.7, -c.width, bus),
      swellR: new Voice(ctx, bufB, c.rateB, 5.7, 'lowpass', c.swell * 0.92, 0.7, c.width, bus),
      /* Water breaking near the hull - only there when the swell is up. */
      wash: new Voice(ctx, bufC, c.rateC, 2.9, 'bandpass', 1150, 0.5, 0, bus),
      /* Wind, wide, moving with the weather. */
      windL: new Voice(ctx, bufB, 1.27, 8.1, 'bandpass', c.wind, 0.8, -0.52, bus),
      windR: new Voice(ctx, bufA, 1.41, 3.3, 'bandpass', c.wind * 1.16, 0.8, 0.52, bus),
      /* Rain: the hiss above and the body of it on the water below. */
      rainHi: new Voice(ctx, bufC, 1.63, 4.1, 'highpass', c.rain, 0.6, 0, bus),
      rainLo: new Voice(ctx, bufA, 1.09, 6.9, 'bandpass', 430, 0.8, 0, bus)
    };

    /* A very faint bed underneath, so the quiet hours are still warm. */
    var drone = ctx.createGain();
    drone.gain.value = 0;
    var droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 220;
    drone.connect(droneLp);
    droneLp.connect(bus);
    g.drone = drone;
    g.droneOsc = [];
    var ratios = [1, 1.4985, 2.0031];
    var levels = [1, 0.5, 0.22];
    for (var i = 0; i < ratios.length; i++) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = c.drone * ratios[i];
      var og = ctx.createGain();
      og.gain.value = levels[i];
      osc.connect(og);
      og.connect(drone);
      osc.start(0);
      g.droneOsc.push(osc);
    }
  };

  /* Any surprise at all: go quiet for good and leave the scene alone. */
  Ambience.prototype.fail = function () {
    this.broken = true;
    this.ready = false;
    var ctx = this.ctx;
    this.ctx = null;
    this.g = null;
    if (ctx && ctx.close) { try { ctx.close(); } catch (e) { /* already gone */ } }
    if (this.ui) this.ui.root.hidden = true;
  };

  Ambience.prototype.resume = function () {
    var ctx = this.ctx;
    if (!ctx || ctx.state === 'running') return;
    try {
      var p = ctx.resume();
      if (p && p.catch) p.catch(function () { /* refused: stay silent */ });
    } catch (e) { /* refused: stay silent */ }
  };

  /* Called on the first real interaction, and whenever sound is turned on. */
  Ambience.prototype.wake = function () {
    if (this.stopping || this.broken || !this.enabled || this.hidden) return;
    if (!this.ensure()) return;
    this.resume();
    this.level();
  };

  Ambience.prototype.arm = function () {
    var self = this;
    var names = ['pointerdown', 'touchend', 'keydown', 'wheel'];
    var opts = { capture: true, passive: true };
    function go(e) {
      /* Escape is the viewer leaving, not arriving: never start sound on it. */
      if (e && e.key === 'Escape') return;
      for (var i = 0; i < names.length; i++) window.removeEventListener(names[i], go, opts);
      self.wake();
    }
    for (var j = 0; j < names.length; j++) window.addEventListener(names[j], go, opts);
  };

  /* The scene's own lifecycle, watched from here so the page plumbing does not
   * have to know about any of it. */
  Ambience.prototype.watch = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') self.fadeOut();
    });
    document.addEventListener('visibilitychange', function () {
      self.hidden = !!document.hidden;
      if (self.hidden) self.level();
      else { self.resume(); self.level(); }
    });
  };

  /* Escape stops the scene; the sound goes with it, over the same breath. */
  Ambience.prototype.fadeOut = function () {
    if (this.stopping) return;
    this.stopping = true;
    this.level();
  };

  /* And comes back with it, because the scene can now be started again. */
  Ambience.prototype.sailOn = function () {
    if (!this.stopping) return;
    this.stopping = false;
    this.wake();
  };

  /* ---------- level ------------------------------------------------------- */

  Ambience.prototype.target = function () {
    if (!this.enabled || this.stopping || this.hidden) return 0;
    return this.volume * CEILING;
  };

  /* Set the master, and let the context sleep once it is silent - a hidden tab
   * or a muted page should cost nothing at all. */
  Ambience.prototype.level = function () {
    if (!this.ready || this.broken) return;
    var ctx = this.ctx, v = this.target();
    var tau = v > 0 && !this.opened ? ARRIVE / 4 : (this.stopping ? 0.55 : 0.3);
    if (v > 0) this.opened = true;
    try { ramp(this.g.master.gain, v, tau, ctx.currentTime); }
    catch (e) { this.fail(); return; }

    if (this.sleepTimer) { window.clearTimeout(this.sleepTimer); this.sleepTimer = 0; }
    var self = this;
    if (v <= 0) {
      this.sleepTimer = window.setTimeout(function () {
        self.sleepTimer = 0;
        if (self.target() > 0 || !self.ctx) return;
        try {
          /* The ramp only ever approaches zero; land on it before sleeping. */
          self.g.master.gain.cancelScheduledValues(self.ctx.currentTime);
          self.g.master.gain.setValueAtTime(0, self.ctx.currentTime);
          var p = self.ctx.suspend();
          if (p && p.catch) p.catch(function () { /* nothing to do */ });
        } catch (e2) { /* nothing to do */ }
      }, (this.stopping ? 3200 : 1400));
    }
  };

  /* ---------- the scene, heard ------------------------------------------- */

  Ambience.prototype.update = function (dt) {
    if (!this.ready || this.broken) return;
    this.acc += dt;
    if (this.acc < PUSH) return;
    var step = this.acc;
    this.acc = 0;
    try { this.push(step); } catch (e) { this.fail(); }
  };

  Ambience.prototype.push = function (dt) {
    var s = this.s, sc = this.scene, g = this.g, ctx = this.ctx;
    var now = ctx.currentTime;
    var weather = s.weather, pal = s.pal;
    var reduced = !!s.reduced;

    /* Three slow drifts on incommensurate scales of the scene's own clock.
     * They come from the same unbounded noise field the sea does, so they
     * wander forever and never come back round. */
    var d1 = sfbm(s.t * 0.0137, 3.1, 2);
    var d2 = sfbm(s.t * 0.0071, 19.7, 2);
    var d3 = sfbm(s.t * 0.0043, 41.3, 2);

    /* Every noise voice is very slowly detuned, each by its own drift. A loop
     * you never arrive back at the same way is not a loop at all. */
    var c0 = this.chr;
    ramp(g.swellL.src.playbackRate, c0.rateA * (1 + d1 * 0.035), 1.5, now);
    ramp(g.swellR.src.playbackRate, c0.rateB * (1 + d3 * 0.035), 1.5, now);
    ramp(g.wash.src.playbackRate, c0.rateC * (1 + d2 * 0.03), 1.5, now);
    ramp(g.windL.src.playbackRate, 1.27 * (1 - d2 * 0.04), 1.5, now);
    ramp(g.windR.src.playbackRate, 1.41 * (1 + d1 * 0.04), 1.5, now);
    ramp(g.rainHi.src.playbackRate, 1.63 * (1 - d3 * 0.03), 1.5, now);
    ramp(g.rainLo.src.playbackRate, 1.09 * (1 + d2 * 0.03), 1.5, now);

    /* The swell as it actually is under the hull, this instant - the same
     * reading the boat steers and pitches by, so the sea sounds the way it
     * looks. `Boat.sample` gives the height of the water under her and the
     * slope she is lying on; `Sea.amp` is how much swell is running, so the
     * lift comes out as a share of it whatever the wind is doing. */
    var sea = sc.sea;
    var pos = sc.boat.sample(sea, s);
    var rel = pos.y / Math.max(0.2, sea.amp);
    var lift = rel < 0 ? -rel : rel;
    this.swellE = approach(this.swellE, clamp(lift, 0, 1.6), reduced ? 0.55 : 0.32, dt);

    var swellE = this.swellE;
    var wind = clamp(s.wind, 0, 1.2);
    var rain = clamp(weather.rain, 0, 1);
    var haze = clamp(weather.haze, 0, 1);
    var light = clamp(pal.light, 0, 1);
    var calm = reduced ? 0.6 : 1;

    /* --- the sea ------------------------------------------------------- */
    var body = (0.20 + 0.26 * swellE * calm) * (0.72 + 0.34 * wind);
    var cut = c0.swell * (0.72 + 0.75 * wind + 0.45 * swellE) * (1 + d1 * 0.14);
    ramp(g.swellL.gain.gain, body * (1 + d2 * 0.12), 0.12, now);
    ramp(g.swellR.gain.gain, body * (1 - d2 * 0.12), 0.12, now);
    ramp(g.swellL.filter.frequency, clamp(cut, 110, 900), 0.2, now);
    ramp(g.swellR.filter.frequency, clamp(cut * 0.88, 100, 860), 0.2, now);

    /* Water only breaks when there is something to break. */
    var wash = clamp((swellE - 0.32) * 1.35, 0, 1) * (0.28 + 0.62 * wind) * 0.17 * calm;
    ramp(g.wash.gain.gain, wash + rain * 0.03, 0.14, now);
    ramp(g.wash.filter.frequency, clamp(950 + wind * 900 + d1 * 180, 500, 2600), 0.25, now);

    /* --- wind ---------------------------------------------------------- */
    var air = (0.018 + 0.135 * Math.pow(wind, 1.6)) * calm;
    ramp(g.windL.gain.gain, air * (1 - d1 * 0.16), 0.22, now);
    ramp(g.windR.gain.gain, air * (1 + d1 * 0.16), 0.22, now);
    var wf = c0.wind * (0.72 + 0.62 * wind) * (1 + d2 * 0.1);
    ramp(g.windL.filter.frequency, clamp(wf, 300, 2200), 0.3, now);
    ramp(g.windR.filter.frequency, clamp(wf * 1.16, 340, 2600), 0.3, now);

    /* --- rain ---------------------------------------------------------- */
    var wet = Math.pow(rain, 1.15);
    ramp(g.rainHi.gain.gain, wet * 0.16 * calm, 0.5, now);
    ramp(g.rainLo.gain.gain, wet * 0.085 * calm, 0.5, now);
    ramp(g.rainHi.filter.frequency, clamp(c0.rain - rain * 260, 700, 1600), 0.5, now);

    /* --- the hour ------------------------------------------------------ */
    ramp(g.drone.gain, (0.05 + 0.028 * (1 - light)) * (1 + d2 * 0.18) * calm, 0.6, now);
    /* Night is darker and further away; haze and rain draw the curtain too. */
    var open = lerp(1500, 4800, light) * (1 - haze * 0.24 - rain * 0.18) * (1 + d1 * 0.06);
    ramp(g.tilt.frequency, clamp(open, 900, 5200), 0.8, now);
    ramp(g.bus.gain, (0.88 + 0.12 * light) * (reduced ? 0.8 : 1), 0.8, now);

    if (this.target() <= 0) return;
    this.workHull(dt, pos, swellE, calm);
    this.callBirds(dt, rain, light, calm);
  };

  /* The hull works at the top and bottom of a roll, not on a clock. */
  Ambience.prototype.workHull = function (dt, pos, swellE, calm) {
    var pitch = Math.atan(pos.slope);
    var rate = (pitch - this.prevPitch) / dt;
    var turned = rate * this.prevRate < 0;
    this.prevPitch = pitch;
    this.prevRate = rate;

    this.creakHold -= dt;
    if (this.creakHold > 0 || !turned) return;
    var load = clamp((Math.abs(pitch) - 0.035) / 0.13, 0, 1);
    if (load < 0.08) return;      /* below this it would not be heard anyway */
    /* Not every roll speaks, or it would tick like a clock. */
    if (this.rand() > 0.35 + load * 0.3) return;
    this.creakHold = lerp(17, 8, load) + this.rand() * 12;
    this.creak(load * calm);
  };

  Ambience.prototype.creak = function (load) {
    var ctx = this.ctx, g = this.g, r = this.rand;
    var t = ctx.currentTime + 0.02;
    var f = this.chr.creak * lerp(0.82, 1.3, r());
    var life = 1.0 + r() * 0.5;

    var src = ctx.createBufferSource();
    src.buffer = this.bufC;
    src.playbackRate.value = 0.45 + r() * 0.35;

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 7 + r() * 7;
    bp.frequency.setValueAtTime(f * 1.18, t);
    bp.frequency.exponentialRampToValueAtTime(f * 0.74, t + life);

    var gn = ctx.createGain();
    var peak = Math.max(0.0004, 0.052 * load);
    gn.gain.setValueAtTime(0.0001, t);
    /* A slow swell into it: timber leaning, never a knock. */
    gn.gain.exponentialRampToValueAtTime(peak, t + 0.12);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + life);

    src.connect(bp);
    bp.connect(gn);
    gn.connect(g.bus);
    var send = ctx.createGain();
    send.gain.value = 0.3;
    gn.connect(send);
    send.connect(g.revIn);

    var offset = Math.max(0, r() * (this.bufC.duration - life - 0.1));
    src.start(t, offset, life + 0.05);
    src.onended = function () {
      try { src.disconnect(); bp.disconnect(); gn.disconnect(); send.disconnect(); }
      catch (e) { /* already torn down */ }
    };
  };

  /* Gulls call when gulls are actually on the wing, from where they are. */
  Ambience.prototype.callBirds = function (dt, rain, light, calm) {
    this.gullHold -= dt;
    var list = this.scene.birds.list;
    var alive = 0, sx = 0;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].alive) continue;
      alive++;
      sx += list[i].x;
    }
    var flock = alive > this.prevBirds;
    this.prevBirds = alive;
    if (!flock || this.gullHold > 0 || alive < 1) return;
    if (this.rand() > 0.32) { this.gullHold = 12; return; }

    this.gullHold = 55 + this.rand() * 110;
    var pan = clamp((sx / alive) / Math.max(1, this.s.W) * 2 - 1, -0.75, 0.75);
    var amp = 0.034 * clamp(light * 1.6, 0.2, 1) * (1 - rain * 0.7) * calm;
    var n = 2 + Math.floor(this.rand() * 3);
    var when = this.ctx.currentTime + 0.5 + this.rand() * 3.5;
    for (var j = 0; j < n; j++) {
      this.gull(when, pan, amp * lerp(0.7, 1, this.rand()));
      when += 0.3 + this.rand() * 0.5;
    }
  };

  Ambience.prototype.gull = function (t, pan, amp) {
    var ctx = this.ctx, g = this.g, r = this.rand;
    var f = this.chr.gull * lerp(0.86, 1.16, r());
    var life = 0.32 + r() * 0.22;

    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f * 0.7, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.1, t + life * 0.24);
    osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + life);

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 1.35;
    bp.Q.value = 1.6;
    /* Far off, over water: the top comes off everything at this distance. */
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;

    var gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(Math.max(0.0004, amp), t + 0.07);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + life + 0.1);

    osc.connect(bp);
    bp.connect(lp);
    lp.connect(gn);

    var out = gn;
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = pan;
      gn.connect(p);
      out = p;
    }
    out.connect(g.bus);
    var send = ctx.createGain();
    send.gain.value = 0.45;
    out.connect(send);
    send.connect(g.revIn);

    osc.start(t);
    osc.stop(t + life + 0.2);
    osc.onended = function () {
      try { osc.disconnect(); bp.disconnect(); lp.disconnect(); gn.disconnect(); send.disconnect(); }
      catch (e) { /* already torn down */ }
    };
  };

  /* ---------- the control ------------------------------------------------- */

  Ambience.prototype.mountUI = function () {
    var root = document.getElementById('sound');
    if (!root || !Ctor()) return;          /* no Web Audio: offer nothing */
    var btn = root.querySelector('#sound-toggle');
    var lvl = root.querySelector('#sound-level');
    if (!btn || !lvl) return;

    var self = this;
    this.ui = { root: root, btn: btn, lvl: lvl };
    lvl.value = String(Math.round(this.volume * 100));

    btn.addEventListener('click', function () { self.setEnabled(!self.enabled); });
    lvl.addEventListener('input', function () {
      var v = clamp((parseFloat(lvl.value) || 0) / 100, 0, 1);
      self.volume = v;
      writeStore(STORE_VOL, String(v));
      /* Sliding to nothing is muting; sliding back up is turning it on. */
      if (v <= 0.005) self.setEnabled(false);
      else if (!self.enabled) self.setEnabled(true);
      else { self.level(); self.paint(); }
    });

    root.hidden = false;
    this.paint();
  };

  Ambience.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    writeStore(STORE_ON, this.enabled ? 'on' : 'off');
    if (this.enabled && this.volume <= 0.02) {
      this.volume = DEFAULT_VOL;
      writeStore(STORE_VOL, String(this.volume));
      if (this.ui) this.ui.lvl.value = String(Math.round(this.volume * 100));
    }
    this.paint();
    if (this.enabled) this.wake();
    else this.level();
  };

  Ambience.prototype.paint = function () {
    if (!this.ui) return;
    var on = this.enabled;
    this.ui.btn.textContent = on ? 'sound on' : 'sound off';
    this.ui.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.ui.btn.title = on ? 'Turn the ambient sound off' : 'Turn the ambient sound on';
    this.ui.root.classList.toggle('is-muted', !on);
  };

  SL.Ambience = Ambience;
})(window.SL);
