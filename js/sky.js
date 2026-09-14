/* slowlight — everything above the horizon: gradient, stars, sun/moon, clouds. */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep;
  var rgba = SL.rgba, css = SL.css, mix = SL.mix, TAU = SL.TAU;

  /* ---------- cloud sprites -------------------------------------------- */

  var SPRITE_W = 256, SPRITE_H = 128, PAD = 26;

  function makeSpriteCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* A soft alpha mask built from stacked radial gradients, flattened at the
   * base so it reads as a cloud sitting on air rather than a ball of fluff. */
  function buildCloudMask(rand) {
    var c = makeSpriteCanvas(SPRITE_W, SPRITE_H);
    var g = c.getContext('2d');
    var puffs = 10 + Math.floor(rand() * 7);
    var baseY = SPRITE_H * 0.70;
    var maxR = (SPRITE_H - baseY) + PAD;
    for (var i = 0; i < puffs; i++) {
      var t = i / (puffs - 1);
      /* Loft the middle of the cloud, taper the ends. */
      var envelope = Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.75);
      var r = (9 + envelope * 30) * lerp(0.7, 1.2, rand());
      /* Keep every gradient wholly inside the sprite, or its edge clips
       * into a hard rectangle once the sprite is scaled up. */
      r = Math.min(r, maxR);
      var x = lerp(PAD + r, SPRITE_W - PAD - r, t) + (rand() - 0.5) * 10;
      var y = baseY - envelope * lerp(14, 30, rand()) - r * 0.2;
      y = Math.max(y, r + 3);
      var grd = g.createRadialGradient(x, y, r * 0.12, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.42)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    /* Soften the underside so the base is flat and diffuse, and feather the
     * sprite's own edges so its bounding box can never show. */
    g.globalCompositeOperation = 'destination-out';
    var fade = g.createLinearGradient(0, baseY - 10, 0, SPRITE_H);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade;
    g.fillRect(0, baseY - 12, SPRITE_W, SPRITE_H - baseY + 12);

    var sides = g.createLinearGradient(0, 0, SPRITE_W, 0);
    sides.addColorStop(0, 'rgba(0,0,0,1)');
    sides.addColorStop(PAD / SPRITE_W, 'rgba(0,0,0,0)');
    sides.addColorStop(1 - PAD / SPRITE_W, 'rgba(0,0,0,0)');
    sides.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = sides;
    g.fillRect(0, 0, SPRITE_W, SPRITE_H);

    var topFade = g.createLinearGradient(0, 0, 0, PAD);
    topFade.addColorStop(0, 'rgba(0,0,0,1)');
    topFade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = topFade;
    g.fillRect(0, 0, SPRITE_W, PAD);

    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /* Tinting a mask costs a clear+draw+fill, so the result is cached and only
   * rebuilt when the palette has drifted by a visible amount. */
  function CloudArt(rand, count) {
    this.masks = [];
    this.tinted = [];
    for (var i = 0; i < count; i++) {
      this.masks.push(buildCloudMask(rand));
      this.tinted.push(makeSpriteCanvas(SPRITE_W, SPRITE_H));
    }
    this.key = null;
  }

  CloudArt.prototype.retint = function (lit, dark) {
    var k = ((lit[0] | 0) >> 1) + ',' + ((lit[1] | 0) >> 1) + ',' + ((lit[2] | 0) >> 1) + '|' +
            ((dark[0] | 0) >> 1) + ',' + ((dark[1] | 0) >> 1) + ',' + ((dark[2] | 0) >> 1);
    if (k === this.key) return;
    this.key = k;
    for (var i = 0; i < this.masks.length; i++) {
      var g = this.tinted[i].getContext('2d');
      g.clearRect(0, 0, SPRITE_W, SPRITE_H);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(this.masks[i], 0, 0);
      g.globalCompositeOperation = 'source-in';
      var grd = g.createLinearGradient(0, 0, 0, SPRITE_H);
      grd.addColorStop(0, css(lit));
      grd.addColorStop(0.55, css(mix(lit, dark, 0.55)));
      grd.addColorStop(1, css(dark));
      g.fillStyle = grd;
      g.fillRect(0, 0, SPRITE_W, SPRITE_H);
      g.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- sky ------------------------------------------------------ */

  function Sky(rand) {
    this.rand = rand;
    this.stars = [];
    this.starDrift = rand();
    this.art = new CloudArt(rand, 6);
    this.clouds = [];
    this.milky = null;
    this.meteor = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, ttl: 1 };
    this.meteorHold = 60 + rand() * 180;
    this.moonPhase = rand();
  }

  Sky.prototype.buildStars = function () {
    var rand = this.rand;
    var n = 300;
    var stars = this.stars;
    stars.length = 0;
    for (var i = 0; i < n; i++) {
      var m = Math.pow(rand(), 2.4);
      stars.push({
        u: rand(),
        /* Cluster gently toward the upper sky. */
        v: Math.pow(rand(), 1.35),
        mag: 0.2 + m * 0.8,
        r: 0.45 + m * 1.15,
        tw: 0.5 + rand() * 1.1,
        ph: rand() * TAU,
        warm: rand()
      });
    }
  };

  Sky.prototype.buildMilkyWay = function () {
    var W = 384, H = 192;
    var c = makeSpriteCanvas(W, H);
    var g = c.getContext('2d');
    var img = g.createImageData(W, H);
    var d = img.data;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        /* Distance from a tilted centre line. */
        var line = H * 0.5 + (x - W * 0.5) * 0.34;
        var dist = Math.abs(y - line) / (H * 0.30);
        var band = Math.exp(-dist * dist * 1.6);
        var n = SL.fbm2(x * 0.035, y * 0.055, 4);
        var v = band * clamp(n * 1.5 - 0.32, 0, 1);
        /* A dark rift down the middle, as in the real thing. */
        v *= 1 - 0.55 * Math.exp(-Math.pow((y - line) / (H * 0.055), 2));
        var i = (y * W + x) * 4;
        d[i] = 198; d[i + 1] = 208; d[i + 2] = 230;
        d[i + 3] = clamp(v, 0, 1) * 190;
      }
    }
    g.putImageData(img, 0, 0);
    this.milky = c;
  };

  Sky.prototype.init = function () {
    if (!this.stars.length) this.buildStars();
    if (!this.milky) this.buildMilkyWay();
  };

  Sky.prototype.resizeClouds = function (w, h) {
    var rand = this.rand;
    var want = clamp(Math.round(w / 105), 8, 20);
    var clouds = this.clouds;
    while (clouds.length < want) clouds.push(this.spawnCloud(w, h, true));
    clouds.length = want;
    for (var i = 0; i < clouds.length; i++) {
      if (clouds[i].x > w + 400 || clouds[i].x < -400) {
        clouds[i] = this.spawnCloud(w, h, true);
      }
    }
  };

  Sky.prototype.spawnCloud = function (w, h, anywhere) {
    var rand = this.rand;
    var band = rand();
    /* band 0..1: 0 is high and small, 1 is low, wide and slow-looking. */
    var scale = lerp(0.5, 2.3, Math.pow(band, 0.8)) * lerp(0.85, 1.3, rand());
    return {
      band: band,
      x: anywhere ? rand() * (w + 400) - 200 : w + SPRITE_W * scale * 0.6 + rand() * 180,
      yf: lerp(0.05, 0.82, Math.pow(band, 1.15)) + (rand() - 0.5) * 0.06,
      scale: scale,
      sprite: Math.floor(rand() * 6),
      alpha: lerp(0.30, 0.78, rand()) * lerp(1, 0.55, band * 0.5),
      par: lerp(0.10, 0.52, band) * lerp(0.8, 1.2, rand()),
      flip: rand() < 0.5
    };
  };

  Sky.prototype.update = function (dt, ctxState) {
    var w = ctxState.W, h = ctxState.H, hy = ctxState.horizonY;
    var motion = ctxState.motion;
    this.starDrift = (this.starDrift + dt * 0.0000085 * (ctxState.reduced ? 0.5 : 1)) % 1;

    var windPush = (14 + ctxState.wind * 30) * motion;
    for (var i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i];
      c.x -= (ctxState.speed * c.par * 0.55 + windPush * c.par) * dt;
      if (c.x + SPRITE_W * c.scale * 0.75 < -120) {
        this.clouds[i] = this.spawnCloud(w, h, false);
      }
    }

    /* A rare, faint meteor — only worth drawing when the sky is actually dark. */
    var m = this.meteor;
    if (m.active) {
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.life <= 0) m.active = false;
    } else {
      this.meteorHold -= dt;
      if (this.meteorHold <= 0) {
        this.meteorHold = 90 + this.rand() * 260;
        if (ctxState.pal.star > 0.75) {
          m.active = true;
          m.ttl = 0.9 + this.rand() * 0.7;
          m.life = m.ttl;
          m.x = this.rand() * w * 0.9;
          m.y = this.rand() * hy * 0.5;
          var dir = this.rand() < 0.5 ? -1 : 1;
          m.vx = dir * lerp(180, 340, this.rand());
          m.vy = lerp(70, 150, this.rand());
        }
      }
    }
  };

  Sky.prototype.drawGradient = function (ctx, s) {
    var pal = s.pal, hy = s.horizonY, W = s.W;
    var g = ctx.createLinearGradient(0, 0, 0, hy + 2);
    g.addColorStop(0, css(pal.skyTop));
    g.addColorStop(0.42, css(mix(pal.skyTop, pal.skyMid, 0.85)));
    g.addColorStop(0.74, css(pal.skyMid));
    g.addColorStop(0.94, css(mix(pal.skyMid, pal.skyHor, 0.8)));
    g.addColorStop(1, css(pal.skyHor));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hy + 2);
  };

  Sky.prototype.drawStars = function (ctx, s) {
    var pal = s.pal;
    var a = pal.star;
    if (a < 0.01) return;
    var hy = s.horizonY, W = s.W;

    if (this.milky) {
      ctx.save();
      ctx.globalAlpha = a * 0.34 * (1 - s.weather.haze * 0.9);
      var mw = W * 1.7, mh = hy * 1.05;
      var off = -((this.starDrift * 3.1) % 1) * mw;
      ctx.drawImage(this.milky, off, -hy * 0.12, mw, mh);
      ctx.drawImage(this.milky, off + mw, -hy * 0.12, mw, mh);
      ctx.restore();
    }

    var t = s.t;
    var stars = this.stars;
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var x = ((st.u + this.starDrift) % 1) * W;
      var y = st.v * hy * 0.97;
      /* Fade out near the horizon, where the haze lives. */
      var lowFade = smoothstep(hy, hy * 0.62, y);
      var tw = 0.78 + 0.22 * Math.sin(t * st.tw * 0.9 + st.ph);
      var al = a * st.mag * tw * lowFade;
      if (al < 0.012) continue;
      var col = st.warm > 0.78 ? [255, 226, 200] : st.warm < 0.18 ? [206, 222, 255] : [232, 238, 248];
      ctx.fillStyle = rgba(col, al);
      var r = st.r;
      if (r < 0.75) {
        ctx.fillRect(x, y, 1, 1);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    }

    var m = this.meteor;
    if (m.active) {
      var k = m.life / m.ttl;
      var fade = Math.sin(Math.PI * k) * 0.5 * a;
      var tl = 46;
      var gm = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tl / 340, m.y - m.vy * tl / 340);
      gm.addColorStop(0, rgba([235, 240, 250], fade));
      gm.addColorStop(1, rgba([235, 240, 250], 0));
      ctx.strokeStyle = gm;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * tl / 340, m.y - m.vy * tl / 340);
      ctx.stroke();
    }
  };

  /* Where the sun or moon sits, and how strongly it lights the water. */
  Sky.prototype.bodyState = function (s) {
    var a = SL.arcParam(s.phase);
    var isMoon = a >= 0.5;
    var u = isMoon ? (a - 0.5) / 0.5 : a / 0.5;
    var elev = Math.sin(Math.PI * u);
    var hy = s.horizonY;
    var x = s.W * (0.10 + 0.80 * u);
    var arc = isMoon ? hy * 0.66 : hy * 0.78;
    var y = hy - elev * arc;
    /* Sink slightly below the horizon at the very ends so it sets, not blinks. */
    y += (1 - smoothstep(0, 0.10, u) * smoothstep(1, 0.90, u)) * 26;
    return {
      x: x, y: y, isMoon: isMoon, u: u, elev: elev,
      radius: isMoon ? s.unit * 0.021 : s.unit * 0.023,
      vis: smoothstep(-0.02, 0.09, u) * smoothstep(1.02, 0.91, u)
    };
  };

  Sky.prototype.drawBody = function (ctx, s, b) {
    var pal = s.pal;
    if (b.vis < 0.01) return;
    var haze = clamp(s.weather.haze * 0.85 + s.weather.rain * 0.6, 0, 0.95);
    var vis = b.vis * (1 - haze * 0.8);
    var r = b.radius;

    /* Wide atmospheric glow. */
    var gr = r * (b.isMoon ? 11 : 16) * lerp(1, 1.5, 1 - b.elev);
    var g = ctx.createRadialGradient(b.x, b.y, r * 0.5, b.x, b.y, gr);
    g.addColorStop(0, rgba(pal.bodyGlow, 0.34 * vis * (b.isMoon ? 0.55 : 1)));
    g.addColorStop(0.28, rgba(pal.bodyGlow, 0.13 * vis * (b.isMoon ? 0.5 : 1)));
    g.addColorStop(1, rgba(pal.bodyGlow, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, gr, 0, TAU);
    ctx.fill();

    if (b.y > s.horizonY + r) return;

    /* The disc itself: soft-edged so it never reads as a hard bright dot. */
    var core = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 1.35);
    core.addColorStop(0, rgba(pal.body, 0.95 * vis));
    core.addColorStop(0.62, rgba(pal.body, 0.88 * vis));
    core.addColorStop(1, rgba(pal.body, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 1.35, 0, TAU);
    ctx.fill();

    if (b.isMoon) {
      /* A gentle terminator, drawn as a soft offset shadow. */
      var off = Math.cos(this.moonPhase * TAU) * r * 1.0;
      var sh = ctx.createRadialGradient(b.x + off, b.y - r * 0.15, r * 0.2, b.x + off, b.y - r * 0.15, r * 1.5);
      sh.addColorStop(0, rgba(pal.skyTop, 0.42 * vis));
      sh.addColorStop(1, rgba(pal.skyTop, 0));
      ctx.save();
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = sh;
      ctx.fillRect(b.x - r * 2, b.y - r * 2, r * 4, r * 4);
      ctx.restore();
    }
  };

  Sky.prototype.drawClouds = function (ctx, s) {
    var pal = s.pal;
    this.art.retint(pal.cloudLit, pal.cloudDark);
    var hy = s.horizonY;
    var clouds = this.clouds;
    var thick = clamp(0.45 + s.weather.haze * 0.75 + s.weather.rain * 0.4, 0, 1.25);
    ctx.save();
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var w = SPRITE_W * c.scale;
      var h = SPRITE_H * c.scale;
      var x = c.x, y = c.yf * hy - h * 0.5;
      if (x > s.W + 40 || x + w < -40) continue;
      /* Clouds near the horizon dissolve into the haze. */
      var horizonFade = smoothstep(hy * 1.02, hy * 0.72, y + h * 0.7);
      ctx.globalAlpha = clamp(c.alpha * thick * horizonFade * 0.9, 0, 1);
      var img = this.art.tinted[c.sprite];
      if (c.flip) {
        ctx.save();
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(img, x, y, w, h);
      }
    }
    ctx.restore();
  };

  /* The soft band of light sitting directly on the horizon. */
  Sky.prototype.drawHorizonHaze = function (ctx, s, b) {
    var pal = s.pal, hy = s.horizonY, W = s.W;
    var band = s.unit * 0.16 * lerp(1, 1.5, s.weather.haze);
    var g = ctx.createLinearGradient(0, hy - band, 0, hy + 2);
    g.addColorStop(0, rgba(pal.haze, 0));
    g.addColorStop(1, rgba(pal.haze, clamp(0.24 + s.weather.haze * 0.5 + s.weather.rain * 0.2, 0, 0.8)));
    ctx.fillStyle = g;
    ctx.fillRect(0, hy - band, W, band + 2);

    /* Extra warmth pooled under the sun where it meets the sea. */
    if (b && b.vis > 0.02 && !b.isMoon) {
      var spread = W * lerp(0.18, 0.42, 1 - b.elev);
      var gg = ctx.createRadialGradient(b.x, hy, 0, b.x, hy, spread);
      var strength = 0.30 * b.vis * (1 - b.elev * 0.45) * (1 - s.weather.haze * 0.55);
      gg.addColorStop(0, rgba(pal.bodyGlow, strength));
      gg.addColorStop(1, rgba(pal.bodyGlow, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(0, hy - spread, W, spread + 4);
    }
  };

  SL.Sky = Sky;
})(window.SL);
