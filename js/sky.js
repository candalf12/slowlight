/* slowlight - everything above the horizon.
 *
 * The gradient, the sun and moon and the band of light on the horizon all live
 * in `skyColor` in `js/gl.js`, because the sea reflects them and the land fogs
 * into them; this file draws that function across the sky, and adds the things
 * that are not a function of direction alone - the milky way, the stars, the
 * clouds drifting round the dome, and the very occasional meteor.
 *
 * Clouds sit on a dome around the eye rather than in the world: at their real
 * distance they would not parallax with a boat anyway, and the boat can now go
 * anywhere. They drift on the wind, and each one is quietly replaced after a
 * few minutes, so the sky never comes round to an arrangement you have seen.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep;
  var TAU = SL.TAU;

  var SPRITE_W = 256, SPRITE_H = 128, PAD = 26;
  var ATLAS_COLS = 3, ATLAS_ROWS = 2, SPRITES = 6;
  var CLOUDS = 46, DOME = 2600;
  var STARS = 1500;

  /* ---------- cloud sprites -------------------------------------------- */

  /* A soft alpha mask built from stacked radial gradients, flattened at the
   * base so it reads as a cloud sitting on air rather than a ball of fluff. */
  function drawCloudMask(g, ox, oy, rand) {
    var puffs = 10 + Math.floor(rand() * 7);
    var baseY = SPRITE_H * 0.70;
    var maxR = (SPRITE_H - baseY) + PAD;
    g.save();
    g.translate(ox, oy);
    g.beginPath();
    g.rect(0, 0, SPRITE_W, SPRITE_H);
    g.clip();
    for (var i = 0; i < puffs; i++) {
      var t = i / (puffs - 1);
      /* Loft the middle of the cloud, taper the ends. */
      var envelope = Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.75);
      var r = (9 + envelope * 30) * lerp(0.7, 1.2, rand());
      /* Keep every gradient wholly inside the cell, or its edge clips into a
       * hard rectangle once the sprite is scaled up across the sky. */
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
     * sprite's own edges so its cell in the atlas can never show. */
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
    g.restore();
  }

  function buildCloudAtlas(rand) {
    var c = SL.glCanvas(SPRITE_W * ATLAS_COLS, SPRITE_H * ATLAS_ROWS);
    var g = c.getContext('2d');
    for (var i = 0; i < SPRITES; i++) {
      drawCloudMask(g, (i % ATLAS_COLS) * SPRITE_W, Math.floor(i / ATLAS_COLS) * SPRITE_H, rand);
    }
    return c;
  }

  /* A band of light across the whole sky, generated so it tiles exactly in the
   * direction it wraps - the noise is sampled round a circle, so there is no
   * seam to find however far the sky turns. */
  function buildMilkyWay() {
    var W = 512, H = 256;
    var c = SL.glCanvas(W, H);
    var g = c.getContext('2d');
    var img = g.createImageData(W, H);
    var d = img.data;
    for (var y = 0; y < H; y++) {
      var dy = (y - H * 0.5) / (H * 0.5);
      var band = Math.exp(-dy * dy * 9.0);
      for (var x = 0; x < W; x++) {
        var a = x / W * TAU;
        var cx = Math.cos(a) * 2.6 + 11.3, cy = Math.sin(a) * 2.6 + 4.7;
        var n = SL.fbm2(cx * 1.9, cy * 1.9 + dy * 2.2, 4);
        var v = band * clamp(n * 1.55 - 0.30, 0, 1);
        /* A dark rift down the middle, as in the real thing. */
        v *= 1 - 0.55 * Math.exp(-dy * dy * 160.0);
        var i = (y * W + x) * 4;
        d[i] = 198; d[i + 1] = 208; d[i + 2] = 230;
        d[i + 3] = clamp(v, 0, 1) * 205;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /* ---------- shaders --------------------------------------------------- */

  var SKY_VERT = [
    'precision highp float;',
    'attribute vec2 aPos;',
    'uniform vec3 uCamR, uCamU, uCamF;',
    'uniform vec2 uTan;',
    'varying vec3 vRay;',
    'void main() {',
    '  vRay = uCamF + uCamR * (aPos.x * uTan.x) + uCamU * (aPos.y * uTan.y);',
  /* Parked on the far plane, so with LEQUAL it only fills what the sea and
   * the land have not already covered. */
    '  gl_Position = vec4(aPos, 1.0, 1.0);',
    '}'
  ].join('\n');

  var SKY_FRAG = [
    SL.GLSL_AIR,
    'varying vec3 vRay;',
    'uniform sampler2D uMilky;',
    'uniform vec3 uGalX, uGalY, uGalZ;',
    'uniform float uMilkyA, uMilkyOff;',
    'void main() {',
    '  vec3 d = normalize(vRay);',
    '  vec3 c;',
    '  if (d.y >= 0.0) {',
    '    c = skyColor(d, 1.0);',
    '    if (uMilkyA > 0.003) {',
    '      float gx = dot(d, uGalX), gy = dot(d, uGalY), gz = dot(d, uGalZ);',
    '      vec4 m = texture2D(uMilky, vec2(atan(gz, gx) * 0.15915494 + uMilkyOff, 0.5 + gy * 1.25));',
    '      c += m.rgb * (m.a * uMilkyA * smoothstep(0.0, 0.16, d.y));',
    '    }',
    '  } else {',
    /* Below the line the sky is only ever the seam the sea fogs into, so the
     * last pixel of water and the first pixel of sky are the same colour. */
    '    c = hazeSeam(d);',
    '  }',
    '  c += (dither(gl_FragCoord.xy) - 0.5) * (1.6 / 255.0);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var STAR_VERT = [
    'precision highp float;',
    'attribute vec3 aDir;',
    'attribute vec4 aStar;',   /* magnitude, size, twinkle rate, twinkle phase */
    'attribute vec3 aTint;',
    'uniform mat4 uViewProj;',
    'uniform vec3 uEye;',
    'uniform vec2 uSpin;',
    'uniform float uT, uAlpha, uPixel;',
    'varying float vA;',
    'varying vec3 vC;',
    'void main() {',
    '  vec3 d = vec3(aDir.x * uSpin.x - aDir.z * uSpin.y, aDir.y,',
    '                aDir.x * uSpin.y + aDir.z * uSpin.x);',
    /* Fade out near the horizon, where the haze lives. */
    '  float low = smoothstep(0.0, 0.18, d.y);',
    '  float tw = 0.78 + 0.22 * sin(uT * aStar.z + aStar.w);',
    '  vA = uAlpha * aStar.x * tw * low;',
    '  vC = aTint;',
    '  gl_PointSize = max(1.4, aStar.y * uPixel);',
    '  gl_Position = uViewProj * vec4(uEye + d * 4000.0, 1.0);',
    '}'
  ].join('\n');

  var STAR_FRAG = [
    'precision mediump float;',
    'varying float vA;',
    'varying vec3 vC;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5) * 2.0;',
    '  float a = vA * exp(-d * d * 3.0);',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(vC, a);',
    '}'
  ].join('\n');

  var SKY_LAYOUT = [['aPos', 2, 0]];
  var STAR_LAYOUT = [['aDir', 3, 0], ['aStar', 4, 3], ['aTint', 3, 7]];

  /* ---------- sky ------------------------------------------------------- */

  function Sky(rand, world) {
    this.rand = rand;
    this.world = world;
    this.clouds = [];
    this.spin = rand() * TAU;
    this.moonPhase = rand();
    this.bodyAz = rand() * TAU;
    this.meteor = { active: false, dx: 0, dy: 0, dz: 0, vx: 0, vy: 0, vz: 0, life: 0, ttl: 1 };
    this.meteorHold = 60 + rand() * 180;

    /* The galactic plane, tilted its own way in every world. */
    var tilt = 0.55 + rand() * 0.55, roll = rand() * TAU;
    var ny = Math.cos(tilt), nr = Math.sin(tilt);
    this.gal = {
      y: [nr * Math.cos(roll), ny, nr * Math.sin(roll)],
      x: [0, 0, 0], z: [0, 0, 0]
    };
    /* Any two perpendiculars will do; take one off the world axis. */
    var gy = this.gal.y;
    var ax = [0, 1, 0];
    if (Math.abs(gy[1]) > 0.9) ax = [1, 0, 0];
    var gx = [gy[1] * ax[2] - gy[2] * ax[1], gy[2] * ax[0] - gy[0] * ax[2], gy[0] * ax[1] - gy[1] * ax[0]];
    var l = Math.sqrt(gx[0] * gx[0] + gx[1] * gx[1] + gx[2] * gx[2]);
    this.gal.x = [gx[0] / l, gx[1] / l, gx[2] / l];
    gx = this.gal.x;
    this.gal.z = [gy[1] * gx[2] - gy[2] * gx[1], gy[2] * gx[0] - gy[0] * gx[2], gy[0] * gx[1] - gy[1] * gx[0]];

    this._g3 = new Float32Array(3);
    for (var i = 0; i < CLOUDS; i++) this.clouds.push(this.spawnCloud(true));
  }

  Sky.prototype.spawnCloud = function (anywhere) {
    var rand = this.rand;
    var band = rand();
    /* band 0..1: 0 is high and small, 1 is low, wide and slow-looking. */
    var scale = lerp(0.5, 2.3, Math.pow(band, 0.8)) * lerp(0.85, 1.3, rand());
    var ttl = 150 + rand() * 260;
    return {
      band: band,
      az: rand() * TAU,
      el: lerp(0.62, 0.030, Math.pow(band, 1.1)) + (rand() - 0.5) * 0.045,
      scale: scale,
      sprite: Math.floor(rand() * SPRITES),
      alpha: lerp(0.30, 0.78, rand()) * lerp(1, 0.55, band * 0.5),
      par: lerp(0.28, 1.0, band) * lerp(0.8, 1.2, rand()),
      flip: rand() < 0.5,
      ttl: ttl,
      /* Start the opening pool part-way through their lives, or the whole sky
       * would fade in and out together. */
      life: anywhere ? rand() * ttl : ttl
    };
  };

  Sky.prototype.init = function (gl) {
    this.gl = gl;
    this.skyProg = SL.glProgram(gl, SKY_VERT, SKY_FRAG);
    this.starProg = SL.glProgram(gl, STAR_VERT, STAR_FRAG);
    this.skyVbo = SL.glBuffer(gl, gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]));

    this.milky = SL.glTexture(gl, buildMilkyWay(), gl.REPEAT, gl.CLAMP_TO_EDGE);
    this.atlas = SL.glTexture(gl, buildCloudAtlas(this.rand));

    var rand = this.rand;
    var data = new Float32Array(STARS * 10);
    for (var i = 0; i < STARS; i++) {
      var m = Math.pow(rand(), 2.4);
      /* Uniform over the upper hemisphere: equal area, so nothing clumps. */
      var sy = Math.pow(rand(), 0.92);
      var r = Math.sqrt(Math.max(0, 1 - sy * sy));
      var az = rand() * TAU;
      var warm = rand();
      var col = warm > 0.78 ? [255, 226, 200] : warm < 0.18 ? [206, 222, 255] : [232, 238, 248];
      var o = i * 10;
      data[o] = Math.cos(az) * r; data[o + 1] = sy; data[o + 2] = Math.sin(az) * r;
      data[o + 3] = 0.30 + m * 0.85;
      data[o + 4] = 1.3 + m * 2.5;
      data[o + 5] = 0.5 + rand() * 1.1;
      data[o + 6] = rand() * TAU;
      data[o + 7] = col[0] / 255; data[o + 8] = col[1] / 255; data[o + 9] = col[2] / 255;
    }
    this.starVbo = SL.glBuffer(gl, gl.ARRAY_BUFFER, data);
  };

  /* Where the sun or moon sits, and how strongly it lights the water. */
  Sky.prototype.bodyState = function (s) {
    var a = SL.arcParam(s.phase);
    var isMoon = a >= 0.5;
    var u = isMoon ? (a - 0.5) / 0.5 : a / 0.5;
    var elev = Math.sin(Math.PI * u);
    var b = s.body;
    /* It travels across the sky rather than straight up it, and sinks a little
     * under the horizon at both ends, so it sets rather than blinking out. */
    var ang = elev * (isMoon ? 0.54 : 0.64) - 0.05;
    var az = this.bodyAz + (u - 0.5) * 2.30;
    var ca = Math.cos(ang);
    b.dx = ca * Math.sin(az);
    b.dy = Math.sin(ang);
    b.dz = ca * Math.cos(az);
    b.isMoon = isMoon;
    b.u = u;
    b.elev = elev;
    b.radius = isMoon ? 0.0125 : 0.0135;
    b.glow = lerp(0.052, 0.105, 1 - elev);
    b.vis = smoothstep(-0.02, 0.09, u) * smoothstep(1.02, 0.91, u);
    /* The axis the moon's shadow falls along: level with the horizon. */
    var hl = Math.sqrt(b.dx * b.dx + b.dz * b.dz);
    if (hl < 1e-4) { b.mx = 1; b.my = 0; b.mz = 0; } else {
      b.mx = -b.dz / hl; b.my = 0; b.mz = b.dx / hl;
    }
    b.moonPhase = Math.cos(this.moonPhase * TAU);
    return b;
  };

  Sky.prototype.update = function (dt, s) {
    var motion = s.motion;
    this.spin += dt * 0.00085 * (s.reduced ? 0.5 : 1);

    var drift = (0.0013 + s.wind * 0.0040) * motion;
    for (var i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i];
      c.az += drift * c.par * dt;
      c.life -= dt;
      if (c.life < -22) this.clouds[i] = this.spawnCloud(false);
    }

    /* A rare, faint meteor - only worth drawing when the sky is actually dark. */
    var m = this.meteor;
    if (m.active) {
      m.life -= dt;
      m.dx += m.vx * dt; m.dy += m.vy * dt; m.dz += m.vz * dt;
      if (m.life <= 0) m.active = false;
    } else {
      this.meteorHold -= dt;
      if (this.meteorHold <= 0) {
        this.meteorHold = 90 + this.rand() * 260;
        if (s.pal.star > 0.75) this.lightMeteor(s);
      }
    }
  };

  Sky.prototype.lightMeteor = function (s) {
    var m = this.meteor, r = this.rand;
    /* Somewhere in the half of the sky the viewer is actually facing. */
    var az = Math.atan2(s.camFwd[0], s.camFwd[2]) + (r() - 0.5) * 1.8;
    var el = 0.22 + r() * 0.85;
    var ce = Math.cos(el);
    m.dx = ce * Math.sin(az); m.dy = Math.sin(el); m.dz = ce * Math.cos(az);
    var side = r() < 0.5 ? -1 : 1;
    var sp = lerp(0.20, 0.42, r());
    m.vx = side * Math.cos(az) * sp;
    m.vy = -lerp(0.10, 0.22, r());
    m.vz = -side * Math.sin(az) * sp;
    m.ttl = 0.9 + r() * 0.7;
    m.life = m.ttl;
    m.active = true;
  };

  /* ---------- drawing --------------------------------------------------- */

  Sky.prototype.drawSky = function (gl, s) {
    var p = this.skyProg, u = p.u;
    gl.useProgram(p.p);
    SL.setAir(gl, p, s);
    gl.uniform3f(u.uCamR, s.camRight[0], s.camRight[1], s.camRight[2]);
    gl.uniform3f(u.uCamU, s.camUp[0], s.camUp[1], s.camUp[2]);
    gl.uniform3f(u.uCamF, s.camFwd[0], s.camFwd[1], s.camFwd[2]);
    gl.uniform2f(u.uTan, s.tanX, s.tanY);

    var spin = this.spin;
    var cs = Math.cos(spin), sn = Math.sin(spin);
    var g = this.gal, o = this._g3;
    this.rotY(g.x, cs, sn, o); gl.uniform3fv(u.uGalX, o);
    this.rotY(g.y, cs, sn, o); gl.uniform3fv(u.uGalY, o);
    this.rotY(g.z, cs, sn, o); gl.uniform3fv(u.uGalZ, o);
    gl.uniform1f(u.uMilkyA, s.pal.star * 0.46 * (1 - s.weather.haze * 0.9));
    gl.uniform1f(u.uMilkyOff, 0.5);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.milky);
    gl.uniform1i(u.uMilky, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyVbo);
    SL.glAttribs(gl, p, 2, SKY_LAYOUT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    SL.glDisableAttribs(gl, p, SKY_LAYOUT);
  };

  Sky.prototype.rotY = function (v, c, sn, o) {
    o[0] = v[0] * c - v[2] * sn;
    o[1] = v[1];
    o[2] = v[0] * sn + v[2] * c;
    return o;
  };

  Sky.prototype.drawStars = function (gl, s) {
    var a = s.pal.star;
    if (a < 0.012) return;
    var p = this.starProg, u = p.u;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uViewProj, false, s.viewProj);
    gl.uniform3f(u.uEye, s.eyeX, s.eyeY, s.eyeZ);
    gl.uniform2f(u.uSpin, Math.cos(this.spin), Math.sin(this.spin));
    gl.uniform1f(u.uT, s.t);
    gl.uniform1f(u.uAlpha, a * (1 - s.weather.haze * 0.75));
    gl.uniform1f(u.uPixel, s.dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starVbo);
    SL.glAttribs(gl, p, 10, STAR_LAYOUT);
    gl.drawArrays(gl.POINTS, 0, STARS);
    SL.glDisableAttribs(gl, p, STAR_LAYOUT);
  };

  /* Clouds and the meteor share the scene's batch; the caller has already put
   * the blend state where it wants it. */
  Sky.prototype.drawClouds = function (batch, s) {
    var pal = s.pal;
    var thick = clamp(0.45 + s.weather.haze * 0.75 + s.weather.rain * 0.4, 0, 1.25);
    var clouds = this.clouds;
    var fx = s.camFwd[0], fy = s.camFwd[1], fz = s.camFwd[2];
    var uw = 1 / ATLAS_COLS, uh = 1 / ATLAS_ROWS;

    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var ce = Math.cos(c.el);
      var dx = ce * Math.sin(c.az), dy = Math.sin(c.el), dz = ce * Math.cos(c.az);
      if (dx * fx + dy * fy + dz * fz < -0.15) continue;

      /* Clouds near the horizon dissolve into the haze. */
      var low = smoothstep(0.010, 0.085, c.el);
      /* Each one arrives and leaves on its own slow fade. */
      var age = c.ttl - c.life;
      var born = smoothstep(0, 22, age);
      var going = 1 - smoothstep(0, 22, -c.life);
      var a = clamp(c.alpha * thick * low * born * going * 0.92, 0, 1);
      if (a < 0.006) continue;

      /* Written out rather than mixed into a pair of fresh arrays: with this
       * many clouds that would be the busiest allocation in the frame. */
      var k = (1 - low) * 0.7;
      var lr = lerp(pal.cloudLit[0], pal.haze[0], k) / 255;
      var lg = lerp(pal.cloudLit[1], pal.haze[1], k) / 255;
      var lb = lerp(pal.cloudLit[2], pal.haze[2], k) / 255;
      var dr = lerp(pal.cloudDark[0], pal.haze[0], k) / 255;
      var dg = lerp(pal.cloudDark[1], pal.haze[1], k) / 255;
      var db = lerp(pal.cloudDark[2], pal.haze[2], k) / 255;

      var hw = DOME * c.scale * 0.078;
      var hh = hw * (SPRITE_H / SPRITE_W);
      /* Upright against the world, not rolled with the camera. */
      var rx = dz, rz = -dx;
      var rl = Math.sqrt(rx * rx + rz * rz);
      if (rl < 1e-5) continue;
      rx /= rl; rz /= rl;
      /* up = dir x right, so the cloud's top edge is the one facing the sky. */
      var ux = dy * rz, uy = dz * rx - dx * rz, uz = -dy * rx;

      var cc = (c.sprite % ATLAS_COLS), row = Math.floor(c.sprite / ATLAS_COLS);
      var u0 = cc * uw, u1 = u0 + uw;
      if (c.flip) { var sw = u0; u0 = u1; u1 = sw; }
      var v0 = row * uh, v1 = v0 + uh;

      var px = dx * DOME + s.eyeX, py = dy * DOME + s.eyeY, pz = dz * DOME + s.eyeZ;
      var axx = rx * hw, axz = rz * hw;
      var ayx = ux * hh, ayy = uy * hh, ayz = uz * hh;
      /* Lit along the top edge, shaded along the base - the gradient the 2D
       * sprites were tinted with, carried by the corners instead. */
      batch.vertex(px - axx + ayx, py + ayy, pz - axz + ayz, u0, v0, lr, lg, lb, a);
      batch.vertex(px + axx + ayx, py + ayy, pz + axz + ayz, u1, v0, lr, lg, lb, a);
      batch.vertex(px + axx - ayx, py - ayy, pz + axz - ayz, u1, v1, dr, dg, db, a);
      batch.vertex(px - axx + ayx, py + ayy, pz - axz + ayz, u0, v0, lr, lg, lb, a);
      batch.vertex(px + axx - ayx, py - ayy, pz + axz - ayz, u1, v1, dr, dg, db, a);
      batch.vertex(px - axx - ayx, py - ayy, pz - axz - ayz, u0, v1, dr, dg, db, a);
    }
    batch.flush(this.atlas);
  };

  Sky.prototype.drawMeteor = function (batch, s) {
    var m = this.meteor;
    if (!m.active) return;
    var k = m.life / m.ttl;
    var a = Math.sin(Math.PI * k) * 0.55 * s.pal.star;
    if (a < 0.01) return;
    var D = 3400;
    var tl = 0.13;
    var hx = m.dx - m.vx * tl, hy = m.dy - m.vy * tl, hz = m.dz - m.vz * tl;
    var wx = -m.vz, wz = m.vx;
    var wl = Math.sqrt(wx * wx + wz * wz) || 1;
    var w = D * 0.0016;
    wx = wx / wl * w; wz = wz / wl * w;
    var ax = m.dx * D + s.eyeX, ay = m.dy * D + s.eyeY, az = m.dz * D + s.eyeZ;
    var bx = hx * D + s.eyeX, by = hy * D + s.eyeY, bz = hz * D + s.eyeZ;
    var r = 0.92, g = 0.94, b = 0.98;
    batch.vertex(ax - wx, ay, az - wz, 0.5, 0.5, r, g, b, a);
    batch.vertex(ax + wx, ay, az + wz, 0.5, 0.5, r, g, b, a);
    batch.vertex(bx + wx, by, bz + wz, 0.5, 0.5, r, g, b, 0);
    batch.vertex(ax - wx, ay, az - wz, 0.5, 0.5, r, g, b, a);
    batch.vertex(bx + wx, by, bz + wz, 0.5, 0.5, r, g, b, 0);
    batch.vertex(bx - wx, by, bz - wz, 0.5, 0.5, r, g, b, 0);
    batch.flush(batch.white);
  };

  SL.Sky = Sky;
})(window.SL);
