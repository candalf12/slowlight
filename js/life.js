/* slowlight — what lives out there.
 *
 * Whales, and dolphins that come to the bow. Both are rare and both are slow,
 * because the point of them is to be something you are glad you caught and
 * never something that makes you jump. A whale takes five seconds to leave the
 * water and three to come back into it, the white water it leaves blooms over
 * as long again and takes ten more to settle, and nothing anywhere in here
 * arrives on a beat: the gaps are drawn from the world's own stream and they
 * are minutes long, so the same seed always has the same whales at the same
 * moments and no two of them are ever evenly spaced.
 *
 * Everything is a soft-edged sprite, the way the gulls and the clouds are —
 * the scene has no hard edges in it anywhere and a whale should not be the
 * first. Whales keep their distance, which is the other reason a sprite is
 * honest here; the dolphins come close, and a dolphin in an arc is a shape a
 * flat sprite genuinely is.
 *
 * Positions are absolute and turned into the local frame only at the moment of
 * drawing, so nothing here has to be shifted when the origin moves.
 *
 * Nothing in this file makes a sound. It should: a blow carries a long way
 * over flat water. `js/audio.js` belongs to someone else, so the hook is left
 * for them — `scene.life.event` says what is happening and where.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep, TAU = SL.TAU;

  var W_BLOW = 0, W_FLUKE = 1, W_BREACH = 2;
  var POD = 7;

  var TW = 256, TH = 128, COLS = 3, ROWS = 2;
  var UV = [];

  var S_BACK = 0, S_BODY = 1, S_FLUKE = 2, S_DOLPHIN = 3, S_PUFF = 4, S_WASH = 5;

  function buildSheet() {
    var c = SL.glCanvas(TW * COLS, TH * ROWS);
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    function at(col, row) {
      g.save();
      g.translate(col * TW + TW / 2, row * TH + TH / 2);
    }

    /* An animal is lit along its back and dark under it. Laid over what has
     * just been drawn without touching its alpha, so the silhouette is still a
     * silhouette and the tint it is given still decides the colour. */
    function round(top, bottom) {
      g.globalCompositeOperation = 'source-atop';
      var sh = g.createLinearGradient(0, -TH / 2, 0, TH / 2);
      sh.addColorStop(0, 'rgba(255,255,255,' + top + ')');
      sh.addColorStop(0.52, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,' + bottom + ')');
      g.fillStyle = sh;
      g.fillRect(-TW / 2, -TH / 2, TW, TH);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#fff';
    }

    /* 0,0 — the back of a whale, rolling through: a long low curve and the
     * smallest of dorsal fins a third of the way back from the tail. */
    at(0, 0);
    g.beginPath();
    g.moveTo(-112, 40);
    g.bezierCurveTo(-70, -8, -10, -22, 40, -14);
    g.bezierCurveTo(78, -8, 100, 10, 116, 40);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(52, -14);
    g.quadraticCurveTo(66, -44, 78, -12);
    g.closePath();
    g.fill();
    round(0.55, 0.52);
    g.restore();

    /* 1,0 — the whole animal, clear of the water, on her side as they come. */
    at(1, 0);
    g.beginPath();
    g.moveTo(-108, 22);
    g.bezierCurveTo(-70, -26, 6, -40, 58, -22);
    g.bezierCurveTo(86, -12, 96, 6, 104, 26);
    g.bezierCurveTo(78, 16, 44, 40, 4, 44);
    g.bezierCurveTo(-40, 48, -84, 40, -108, 22);
    g.closePath();
    g.fill();
    /* A pectoral fin, thrown out, which is the whole silhouette of a breach. */
    g.beginPath();
    g.moveTo(-6, 22);
    g.quadraticCurveTo(-30, 62, -64, 56);
    g.quadraticCurveTo(-36, 40, -20, 18);
    g.closePath();
    g.fill();
    /* And the long groove of the throat. */
    g.globalAlpha = 0.35;
    g.lineWidth = 2.4;
    for (var q = 0; q < 4; q++) {
      g.beginPath();
      g.moveTo(-96, 26 + q * 4);
      g.quadraticCurveTo(-40, 38 + q * 3, 8, 34 + q * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    round(0.62, 0.48);
    g.restore();

    /* 2,0 — the flukes, going under: wide, notched in the middle, and on the
     * end of a peduncle thick enough to see, or they read as a gull. */
    at(2, 0);
    g.beginPath();
    g.moveTo(-15, 62); g.lineTo(15, 62); g.lineTo(10, 12); g.lineTo(-10, 12);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(0, 16);
    g.bezierCurveTo(-34, -2, -74, -22, -116, -34);
    g.bezierCurveTo(-98, 0, -52, 16, -11, 24);
    g.lineTo(0, 13);
    g.lineTo(11, 24);
    g.bezierCurveTo(52, 16, 98, 0, 116, -34);
    g.bezierCurveTo(74, -22, 34, -2, 0, 16);
    g.closePath();
    g.fill();
    round(0.50, 0.42);
    g.restore();

    /* 0,1 — a dolphin in an arc, which is the only way anyone ever sees one. */
    at(0, 1);
    g.beginPath();
    g.moveTo(-96, 44);
    g.bezierCurveTo(-56, -6, 10, -30, 62, -8);
    g.bezierCurveTo(84, 2, 94, 14, 104, 30);
    g.bezierCurveTo(80, 26, 66, 22, 54, 18);
    g.bezierCurveTo(6, 6, -44, 30, -82, 54);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(-4, -22);
    g.quadraticCurveTo(14, -54, 26, -16);
    g.closePath();
    g.fill();
    round(0.70, 0.30);
    g.restore();

    /* 1,1 — a soft puff: spray, and the hang of a blow. */
    at(1, 1);
    var grd = g.createRadialGradient(0, 8, 0, 0, 8, 58);
    grd.addColorStop(0, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.40, 'rgba(255,255,255,0.42)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(-TW / 2, -TH / 2, TW, TH);
    g.fillStyle = '#fff';
    g.restore();

    /* 2,1 — white water: broken, wide and low. */
    at(2, 1);
    for (var i = 0; i < 14; i++) {
      var a = i / 14 * TAU;
      var rx = Math.cos(a) * (40 + (i % 4) * 16);
      var ry = Math.sin(a) * (9 + (i % 3) * 6);
      var gg = g.createRadialGradient(rx, ry, 0, rx, ry, 30 - (i % 3) * 7);
      gg.addColorStop(0, 'rgba(255,255,255,0.74)');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gg;
      g.fillRect(-TW / 2, -TH / 2, TW, TH);
    }
    g.fillStyle = '#fff';
    g.restore();

    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++) {
        UV[r * COLS + cc] = [cc / COLS + 0.0015, r / ROWS + 0.003,
                             (cc + 1) / COLS - 0.0015, (r + 1) / ROWS - 0.003];
      }
    }
    return c;
  }

  /* ---------- drawing helpers -------------------------------------------- */

  /* A billboard turned in the plane of the glass, which is what lets a whale
   * come out of the water at an angle and a dolphin arc rather than hop. */
  function turned(batch, s, x, y, z, hw, hh, rot, flip, sp, r, g, b, a) {
    var c = Math.cos(rot), sn = Math.sin(rot);
    var rx = s.camRight[0] * c + s.camUp[0] * sn;
    var ry = s.camRight[1] * c + s.camUp[1] * sn;
    var rz = s.camRight[2] * c + s.camUp[2] * sn;
    var ux = s.camUp[0] * c - s.camRight[0] * sn;
    var uy = s.camUp[1] * c - s.camRight[1] * sn;
    var uz = s.camUp[2] * c - s.camRight[2] * sn;
    var uv = UV[sp];
    var u0 = flip ? uv[2] : uv[0], u1 = flip ? uv[0] : uv[2];
    batch.billboard(x, y, z, rx, ry, rz, ux, uy, uz, hw, hh,
                    u0, uv[1], u1, uv[3], r, g, b, a);
  }

  /* The same, with everything below the waterline cut off, so a back showing
   * through the surface is a back showing through the surface and not a decal
   * sitting on top of the sea. */
  function surfaced(batch, s, x, y, z, hw, hh, wy, flip, sp, r, g, b, a) {
    var top = y + hh, bot = y - hh;
    if (top <= wy + 0.05) return;
    if (bot < wy) bot = wy;
    var uv = UV[sp];
    var keep = (top - bot) / (2 * hh);
    var v1 = uv[1] + (uv[3] - uv[1]) * keep;
    var u0 = flip ? uv[2] : uv[0], u1 = flip ? uv[0] : uv[2];
    batch.billboard(x, (top + bot) * 0.5, z,
                    s.camRight[0], s.camRight[1], s.camRight[2],
                    s.camUp[0], s.camUp[1], s.camUp[2],
                    hw, (top - bot) * 0.5, u0, uv[1], u1, v1, r, g, b, a);
  }

  /* ---------- the scene's living things ----------------------------------- */

  function Life(world) {
    this.rand = world.stream('whales');
    this.podRand = world.stream('dolphins');
    /* The first whale is never in the first minute: arriving somewhere should
     * be arriving somewhere, not an event. */
    this.hold = 120 + this.rand() * 330;
    this.event = null;
    this.podHold = 200 + this.podRand() * 520;
    this.pod = null;
    this.fins = [];
    for (var i = 0; i < POD; i++) {
      this.fins.push({ on: false, side: 1, lead: 0, beam: 0, ph: 0, rate: 1, sc: 1 });
    }
    this.tex = null;
    this._w = { h: 0, gx: 0, gz: 0 };
  }

  Life.prototype.init = function (gl) {
    this.tex = SL.glTexture(gl, buildSheet());
  };

  /* ---------- whales ------------------------------------------------------ */

  Life.prototype.startWhale = function (s) {
    var r = this.rand;
    var pick = r();
    var kind = pick < 0.50 ? W_BLOW : pick < 0.82 ? W_FLUKE : W_BREACH;
    /* A blow is something you see a long way off; a breach you want near
     * enough to read, and never so near that it is on top of her. */
    var dist = kind === W_BLOW ? lerp(340, 1000, r())
             : kind === W_FLUKE ? lerp(140, 430, r())
             : lerp(82, 180, r());
    /* Somewhere in the forward half of the world, so it is not missed. */
    var bearing = s.heading + (r() - 0.5) * 2.5;
    this.event = {
      kind: kind, t0: s.t,
      dur: kind === W_BLOW ? 19 : kind === W_FLUKE ? 20 : 24,
      x: s.worldX + Math.sin(bearing) * dist,
      z: s.worldZ + Math.cos(bearing) * dist,
      /* Travelling slowly across her, not at her. */
      course: bearing + Math.PI * 0.5 + (r() - 0.5) * 1.4,
      speed: lerp(1.6, 3.2, r()),
      sc: lerp(0.82, 1.18, r()),
      flip: r() < 0.5,
      seed: r()
    };
  };

  Life.prototype.updateWhale = function (dt, s) {
    var e = this.event;
    if (!e) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.hold = 150 + this.rand() * 330;
        /* Not in the thick of it: you would not see one anyway. */
        if (s.weather.rain < 0.55) this.startWhale(s);
      }
      return;
    }
    e.x += Math.sin(e.course) * e.speed * dt * s.motion;
    e.z += Math.cos(e.course) * e.speed * dt * s.motion;
    if (s.t - e.t0 > e.dur) this.event = null;
  };

  Life.prototype.drawWhale = function (batch, sea, s, cr, cg, cb, lr, lg, lb, light) {
    var e = this.event;
    if (!e) return;
    var age = s.t - e.t0;
    var cx = e.x - s.orgX, cz = e.z - s.orgZ;
    var ex = e.x - s.worldX, ez = e.z - s.worldZ;
    var dist = Math.sqrt(ex * ex + ez * ez);
    var fog = 1 - Math.exp(-(dist * dist) / (s.fogD * s.fogD));
    var vis = (1 - fog) * light;
    if (vis < 0.012) return;
    sea.sample(cx, cz, s.t, this._w);
    var wy = this._w.h;
    /* 16 metres of whale, against 8.6 of boat: the one reliable ruler in the
     * whole scene is how big she is beside it. */
    var L = 17 * e.sc;
    var dr = cr * 0.95, dg = cg * 0.95, db = cb * 1.0;

    if (e.kind === W_BLOW) {
      /* The back comes up, she blows, the spray hangs and leans off downwind,
       * and she is gone. Nothing in it is faster than a breath. */
      var up = smoothstep(0, 3.0, age) * (1 - smoothstep(11.5, 15.5, age));
      if (up > 0.002) {
        surfaced(batch, s, cx, wy + 1.7 - (1 - up) * 2.4, cz, L * 0.5, L * 0.25, wy,
                 e.flip, S_BACK, dr, dg, db, vis * up);
      }
      var bl = smoothstep(2.6, 3.6, age) * (1 - smoothstep(7.0, 12.0, age));
      if (bl > 0.003) {
        var rise = smoothstep(2.6, 6.5, age);
        var drift = rise * rise * 5.0 * Math.cos(s.windFrom);
        var driz = rise * rise * 5.0 * Math.sin(s.windFrom);
        for (var i = 0; i < 4; i++) {
          var sp = 0.55 + i * 0.35;
          var h = 1.2 + rise * (4.2 + i * 1.5) * e.sc;
          batch.billboard(cx + drift * sp + (i - 1.5) * 0.7, wy + h, cz + driz * sp,
                          s.camRight[0], s.camRight[1], s.camRight[2],
                          0, 1, 0,
                          (1.1 + rise * 2.4 + i * 0.5) * e.sc,
                          (1.6 + rise * 3.0) * e.sc,
                          UV[S_PUFF][0], UV[S_PUFF][1], UV[S_PUFF][2], UV[S_PUFF][3],
                          lr, lg, lb, vis * bl * (0.34 - i * 0.055));
        }
      }
      return;
    }

    if (e.kind === W_FLUKE) {
      /* She rolls through, arches, and the flukes come up and go quietly
       * under. The tail is the last of her and it takes its time. */
      var back = smoothstep(0, 3.0, age) * (1 - smoothstep(7.5, 10.5, age));
      if (back > 0.002) {
        var arch = smoothstep(4.0, 9.0, age);
        surfaced(batch, s, cx, wy + 1.7 - (1 - back) * 2.4 + arch * 0.8, cz,
                 L * 0.5, L * 0.25, wy,
                 e.flip, S_BACK, dr, dg, db, vis * back);
      }
      var fl = smoothstep(8.0, 11.5, age);
      var down = smoothstep(13.0, 18.0, age);
      var lift = (fl - down * down);
      if (lift > 0.002) {
        var fy = wy - 1.5 + lift * L * 0.30;
        var tilt = (1 - lift) * 0.45;
        turned(batch, s, cx - Math.sin(e.course) * L * 0.36, fy,
               cz - Math.cos(e.course) * L * 0.36,
               L * 0.27, L * 0.135, e.flip ? -tilt : tilt, e.flip,
               S_FLUKE, dr, dg, db, vis * clamp(lift * 1.4, 0, 1));
        /* What runs off them. */
        if (lift > 0.35 && lift < 0.98) {
          batch.billboard(cx - Math.sin(e.course) * L * 0.36, wy + 0.5,
                          cz - Math.cos(e.course) * L * 0.36,
                          s.camRight[0], s.camRight[1], s.camRight[2], 0, 1, 0,
                          L * 0.34, L * 0.10,
                          UV[S_WASH][0], UV[S_WASH][1], UV[S_WASH][2], UV[S_WASH][3],
                          lr, lg, lb, vis * 0.26 * (1 - down));
        }
      }
      return;
    }

    /* A breach. Five seconds to leave the water, a moment held, three to come
     * back into it, and then a long slow bloom of white water that takes ten
     * more to go flat. Anything quicker than this would be a fright. */
    var leave = smoothstep(3.0, 7.6, age);
    var fall = smoothstep(8.0, 10.4, age);
    var rise = leave - fall * fall;
    var swim = smoothstep(0, 2.2, age) * (1 - smoothstep(2.6, 4.0, age));
    if (swim > 0.004) {
      surfaced(batch, s, cx, wy + 1.5, cz, L * 0.5, L * 0.25, wy,
               e.flip, S_BACK, dr, dg, db, vis * swim * 0.9);
    }
    if (rise > 0.003) {
      /* The water she is coming out of, and then falling back into: without it
       * a whale clear of the surface is a shape hanging in the air. */
      var foot = clamp(rise * 1.6, 0, 1);
      batch.billboard(cx, wy + 0.5, cz,
                      s.camRight[0], s.camRight[1], s.camRight[2], 0, 1, 0,
                      L * (0.30 + foot * 0.26), L * (0.08 + foot * 0.07),
                      UV[S_WASH][0], UV[S_WASH][1], UV[S_WASH][2], UV[S_WASH][3],
                      lr, lg, lb, vis * foot * 0.62);
      var y = wy + rise * L * 0.36 - L * 0.19;
      /* She comes out nose first and falls back on her flank. */
      var rot = lerp(-0.95, 0.35, leave) + fall * 0.55;
      var al = vis * clamp(smoothstep(2.2, 3.4, age) * (1 - smoothstep(9.8, 10.8, age)), 0, 1);
      turned(batch, s, cx, y, cz, L * 0.52, L * 0.26,
             e.flip ? -rot : rot, e.flip, S_BODY, dr, dg, db, al);
    }
    /* The white water. It arrives with her, spreads, and settles. */
    var bloom = smoothstep(9.9, 11.8, age);
    var gone = smoothstep(13.0, 23.0, age);
    var wash = bloom * (1 - gone * gone);
    if (wash > 0.004) {
      var spread = 1 + bloom * 2.2 + gone * 0.9;
      batch.billboard(cx, wy + 0.35, cz,
                      s.camRight[0], s.camRight[1], s.camRight[2], 0, 1, 0,
                      L * 0.46 * spread, L * 0.12 * spread,
                      UV[S_WASH][0], UV[S_WASH][1], UV[S_WASH][2], UV[S_WASH][3],
                      lr, lg, lb, vis * wash * 0.92);
      /* What goes up when she lands, and comes down again over a good few
       * seconds: this is the part anyone remembers. */
      var plume = bloom * (1 - smoothstep(11.0, 16.5, age));
      for (var k = 0; k < 4; k++) {
        var lean = (k - 1.5) * 0.66;
        batch.billboard(cx + lean * L * 0.24 * (0.4 + plume), 
                        wy + 1.0 + plume * (3.4 + k * 0.7) - lean * lean * plume * 0.5,
                        cz + lean * L * 0.10,
                        s.camRight[0], s.camRight[1], s.camRight[2], 0, 1, 0,
                        L * (0.15 + plume * 0.20), L * (0.17 + plume * 0.26),
                        UV[S_PUFF][0], UV[S_PUFF][1], UV[S_PUFF][2], UV[S_PUFF][3],
                        lr, lg, lb, vis * plume * 0.58);
      }
    }
  };

  /* ---------- dolphins ---------------------------------------------------- */

  Life.prototype.startPod = function (s) {
    var r = this.podRand;
    var want = 3 + Math.floor(r() * 4);
    this.pod = { t0: s.t, dur: 55 + r() * 60, side: r() < 0.5 ? -1 : 1 };
    for (var i = 0; i < POD; i++) {
      var f = this.fins[i];
      f.on = i < want;
      if (!f.on) continue;
      /* Two lines off the bow, the way they actually ride one. */
      f.side = (i % 2 ? 1 : -1) * (r() < 0.25 ? -1 : 1);
      f.lead = lerp(2.0, 13.0, r());
      f.beam = f.side * lerp(2.6, 7.5, r());
      f.ph = r() * TAU;
      f.rate = lerp(2.05, 2.75, r());
      f.sc = lerp(0.86, 1.12, r());
      f.join = i * 1.6 + r() * 3.0;
    }
  };

  Life.prototype.updatePod = function (dt, s) {
    if (!this.pod) {
      this.podHold -= dt;
      if (this.podHold <= 0) {
        this.podHold = 260 + this.podRand() * 620;
        if (s.weather.rain < 0.7 && s.course > 0.5) this.startPod(s);
      }
      return;
    }
    if (s.t - this.pod.t0 > this.pod.dur) this.pod = null;
  };

  Life.prototype.drawPod = function (batch, sea, s, cr, cg, cb, lr, lg, lb, light) {
    var p = this.pod;
    if (!p) return;
    var age = s.t - p.t0;
    var leaving = smoothstep(p.dur - 16, p.dur, age);
    var hx = Math.sin(s.heading), hz = Math.cos(s.heading);
    var px = hz, pz = -hx;                      /* abeam */
    var o = this._w;
    for (var i = 0; i < POD; i++) {
      var f = this.fins[i];
      if (!f.on) continue;
      /* They come up from astern one by one, ride, and peel off. */
      var join = smoothstep(f.join, f.join + 7, age);
      if (join <= 0.001) continue;
      var lead = lerp(-26, f.lead, join);
      var beam = f.beam * lerp(0.35, 1, join) + leaving * p.side * 34;
      var x = s.boatX + hx * lead + px * beam;
      var z = s.boatZ + hz * lead + pz * beam;
      sea.sample(x, z, s.t, o);

      /* One porpoise in every turn of the phase: a long time under, a short
       * clean arc over. */
      var u = ((s.t * f.rate * 0.42 + f.ph) / TAU % 1 + 1) % 1;
      var arc = u < 0.34 ? Math.sin(u / 0.34 * Math.PI) : 0;
      if (arc < 0.02) continue;
      var y = o.h + arc * 0.95 * f.sc * (0.5 + 0.5 * s.motion) - 0.30;
      var rot = Math.cos(u / 0.34 * Math.PI) * 0.62;
      var a = light * (1 - leaving) * clamp(arc * 1.9, 0, 1) * 0.92;
      if (a < 0.02) continue;
      var L = 1.42 * f.sc;
      /* Turned to face the way they are going, which is the way she is. */
      turned(batch, s, x, y, z, L, L * 0.5, f.side > 0 ? rot : -rot,
             f.side > 0, S_DOLPHIN, cr * 0.86, cg * 0.86, cb * 0.92, a);
      if (arc > 0.55) {
        batch.billboard(x - hx * L * 0.9, o.h + 0.16, z - hz * L * 0.9,
                        s.camRight[0], s.camRight[1], s.camRight[2], 0, 1, 0,
                        L * 1.1, L * 0.30,
                        UV[S_WASH][0], UV[S_WASH][1], UV[S_WASH][2], UV[S_WASH][3],
                        lr, lg, lb, a * 0.32);
      }
    }
  };

  /* ---------- the two of them together ------------------------------------ */

  Life.prototype.update = function (dt, s) {
    this.updateWhale(dt, s);
    this.updatePod(dt, s);
  };

  Life.prototype.draw = function (batch, sea, s) {
    if (!this.event && !this.pod) return;
    var pal = s.pal;
    /* An animal is the hour's near water, a shade under it; what it throws up
     * is foam. Both come from the palette, so a whale at three in the morning
     * is a silhouette and at six a grey back with a sheen on it. */
    var cr = lerp(pal.seaNear[0], pal.crest[0], 0.40) / 255;
    var cg = lerp(pal.seaNear[1], pal.crest[1], 0.40) / 255;
    var cb = lerp(pal.seaNear[2], pal.crest[2], 0.40) / 255;
    var lr = pal.foam[0] / 255, lg = pal.foam[1] / 255, lb = pal.foam[2] / 255;
    var light = clamp(0.32 + pal.light * 0.95, 0, 1.15) * (1 - s.weather.haze * 0.35);
    this.drawWhale(batch, sea, s, cr, cg, cb, lr, lg, lb, light);
    this.drawPod(batch, sea, s, cr, cg, cb, lr, lg, lb, light);
    batch.flush(this.tex);
  };

  SL.Life = Life;
})(window.SL);
