/* slowlight - what the sea has on it.
 *
 * Kelp, driftwood, a raft of birds asleep on the water; and, where there is
 * land to mark, a buoy or a withy someone once put there. Small things, and
 * close: the open sea gives the eye nothing to measure the boat against, so
 * until there is something beside her to go past, her speed and her turning
 * are not readable at all. That is what this is for rather more than novelty.
 *
 * Everything here is anchored to a square of water through `World.cell2`, the
 * way the land is, so the same seed always has the same log adrift in the same
 * place. Nothing is stored between frames except which rafts of birds have
 * already got up, and that is pruned with the squares.
 *
 * Positions are kept absolute and only turned into the local frame at the last
 * moment, which is why nothing in here has to be shifted when the origin moves.
 *
 * A sail on the horizon is the one thing that is not anchored: it is somebody
 * else's voyage, on its own slow schedule, and it comes and goes.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, smoothstep = SL.smoothstep, TAU = SL.TAU;

  var CELL = 260;           /* world units between candidate pieces of flotsam */
  var RANGE = 1040;         /* every square this near the boat is considered */
  var FADE0 = 700, FADE1 = 1015;   /* and the far ones dissolve before the edge */
  var DENSITY = 0.20;
  var POOL = 64;

  var K_KELP = 0, K_WOOD = 1, K_RAFT = 2, K_BUOY = 3, K_FLOAT = 4, K_POLE = 5;

  var RAFT_WAKE = 78;       /* how near she gets before a raft lifts off */
  var RAFT_GONE = 13;       /* and how long they take to be gone */

  /* ---------- the sprites ------------------------------------------------
   *
   * One sheet, drawn white and tinted at the point of use, so every piece of
   * it takes the hour's colour and the haze without a second texture. */

  var TILE = 128, COLS = 4, ROWS = 3;
  var UV = [];

  function cell(col, row) {
    var u = 1 / COLS, v = 1 / ROWS;
    return [col * u + 0.002, row * v + 0.002, (col + 1) * u - 0.002, (row + 1) * v - 0.002];
  }

  function buildSheet() {
    var c = SL.glCanvas(TILE * COLS, TILE * ROWS);
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    var i, a;

    function at(col, row) {
      g.save();
      g.translate(col * TILE + TILE / 2, row * TILE + TILE / 2);
    }

    /* 0,0 - a strap of kelp, seen from above, lying along the swell. */
    at(0, 0);
    g.globalAlpha = 0.80;
    for (i = 0; i < 5; i++) {
      var off = (i - 2) * 9;
      g.lineWidth = 7 - Math.abs(i - 2) * 1.6;
      g.beginPath();
      g.moveTo(-54, off * 0.4);
      g.bezierCurveTo(-18, off - 12, 18, off + 12, 54, off * 0.5);
      g.stroke();
    }
    g.restore();

    /* 1,0 - a log. */
    at(1, 0);
    g.globalAlpha = 1;
    g.beginPath();
    g.moveTo(-52, -7); g.lineTo(46, -9);
    g.quadraticCurveTo(56, 0, 46, 9);
    g.lineTo(-52, 7);
    g.quadraticCurveTo(-58, 0, -52, -7);
    g.fill();
    g.restore();

    /* 2,0 - a branch, with what is left of its roots. */
    at(2, 0);
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-50, 4); g.quadraticCurveTo(0, -6, 48, 2);
    g.stroke();
    g.lineWidth = 3;
    for (i = 0; i < 4; i++) {
      a = -0.9 + i * 0.6;
      g.beginPath();
      g.moveTo(-40 + i * 24, 2);
      g.lineTo(-40 + i * 24 + Math.cos(a) * 20, 2 + Math.sin(a) * 20);
      g.stroke();
    }
    g.restore();

    /* 3,0 - a scatter of weed, soft at every edge. */
    at(3, 0);
    for (i = 0; i < 9; i++) {
      a = i / 9 * TAU;
      var rr = 14 + (i % 3) * 13;
      var grd = g.createRadialGradient(Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 0,
                                       Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 20);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(-64, -64, 128, 128);
    }
    g.fillStyle = '#fff';
    g.restore();

    /* 0,1 - a can buoy with a topmark: the shape is the whole of the message. */
    at(0, 1);
    g.beginPath();
    g.moveTo(-13, 46); g.lineTo(-15, 2);
    g.lineTo(15, 2); g.lineTo(13, 46);
    g.closePath(); g.fill();
    g.fillRect(-2.5, -34, 5, 38);
    g.beginPath();
    g.moveTo(0, -56); g.lineTo(11, -34); g.lineTo(-11, -34);
    g.closePath(); g.fill();
    g.restore();

    /* 1,1 - a mooring float, and the ring it is picked up by. */
    at(1, 1);
    g.beginPath(); g.arc(0, 22, 26, 0, TAU); g.fill();
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, -4); g.lineTo(0, -30); g.stroke();
    g.lineWidth = 4;
    g.beginPath(); g.arc(0, -38, 9, 0, TAU); g.stroke();
    g.restore();

    /* 2,1 - a withy: a pole stuck in the sand with a wisp on the end. */
    at(2, 1);
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(1, 56); g.lineTo(-2, -44); g.stroke();
    g.lineWidth = 3;
    for (i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(-2, -44);
      g.quadraticCurveTo(6 + i * 5, -50 + i * 7, 16 + i * 6, -38 + i * 10);
      g.stroke();
    }
    g.restore();

    /* 3,1 - somebody else, hull down: a main, a jib and a sliver of hull. */
    at(3, 1);
    g.beginPath();
    g.moveTo(2, -58); g.lineTo(2, 34); g.lineTo(-30, 34);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(6, -46); g.lineTo(30, 32); g.lineTo(6, 32);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(-34, 36); g.lineTo(34, 36);
    g.quadraticCurveTo(24, 48, -22, 46);
    g.closePath(); g.fill();
    g.restore();

    /* 0,2 - a gull sitting on the water. */
    at(0, 2);
    g.beginPath();
    g.ellipse(2, 14, 34, 15, -0.07, 0, TAU);
    g.fill();
    g.beginPath();
    g.moveTo(-26, 6);
    g.quadraticCurveTo(-30, -20, -14, -24);
    g.quadraticCurveTo(-4, -22, -8, 4);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(28, 6); g.lineTo(46, -6); g.lineTo(30, 14);
    g.closePath(); g.fill();
    g.restore();

    /* 1,2 - and the same gull, off the water. */
    at(1, 2);
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(-50, -18);
    g.quadraticCurveTo(-20, -34, 0, 4);
    g.quadraticCurveTo(20, -34, 50, -18);
    g.stroke();
    g.beginPath();
    g.ellipse(0, 6, 11, 7, 0, 0, TAU);
    g.fill();
    g.restore();

    /* 2,2 - a plank, with the grain gone out of it. */
    at(2, 2);
    g.fillRect(-54, -6, 108, 12);
    g.restore();

    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++) UV[r * COLS + cc] = cell(cc, r);
    }
    return c;
  }

  var S_KELP = 0, S_LOG = 1, S_BRANCH = 2, S_WEED = 3;
  var S_BUOY = 4, S_FLOAT = 5, S_POLE = 6, S_SAIL = 7;
  var S_SIT = 8, S_FLY = 9, S_PLANK = 10;

  /* ---------- the field --------------------------------------------------- */

  function Flotsam(world) {
    this.world = world;
    this.rand = world.stream('sail/other');
    this.list = [];
    for (var i = 0; i < POOL; i++) {
      this.list.push({ kind: 0, key: 0, x: 0, z: 0, a: 0, sc: 1, ph: 0,
                       n: 0, woke: 0 });
    }
    this.n = 0;
    this.woke = Object.create(null);
    this.tex = null;

    /* Somebody else's voyage: a long way off, for a long while, now and then. */
    this.sail = { on: false, hold: 90 + this.rand() * 420, x: 0, z: 0,
                  course: 0, speed: 5, age: 0, ttl: 0, scale: 1 };
    this._w = { h: 0, gx: 0, gz: 0 };
  }

  Flotsam.prototype.init = function (gl) {
    this.tex = SL.glTexture(gl, buildSheet());
  };

  /* What is at this square of water, if anything. A pure function of the seed
   * and the square, plus how shallow the water there happens to be: the things
   * people leave behind are only ever left near land. */
  Flotsam.prototype.plan = function (item, i, j, shallow) {
    var w = this.world;
    var kv = w.cell2('drift/kind', i, j);
    var kind;
    if (shallow > 0.45) {
      /* Off a shore: a mark, or the weed that grows in the shallows. */
      kind = kv < 0.30 ? K_KELP : kv < 0.55 ? K_BUOY : kv < 0.76 ? K_POLE :
             kv < 0.90 ? K_FLOAT : K_WOOD;
    } else {
      kind = kv < 0.34 ? K_KELP : kv < 0.68 ? K_WOOD : K_RAFT;
    }
    item.kind = kind;
    item.a = w.cell2('drift/a', i, j) * TAU;
    item.sc = lerp(0.72, 1.35, w.cell2('drift/s', i, j));
    item.ph = w.cell2('drift/p', i, j) * TAU;
    item.n = 3 + Math.floor(w.cell2('drift/n', i, j) * 7);
    return item;
  };

  Flotsam.prototype.update = function (dt, s, islands) {
    var w = this.world;
    var i0 = Math.floor((s.worldX - RANGE) / CELL), i1 = Math.floor((s.worldX + RANGE) / CELL);
    var j0 = Math.floor((s.worldZ - RANGE) / CELL), j1 = Math.floor((s.worldZ + RANGE) / CELL);
    var n = 0;
    for (var i = i0; i <= i1 && n < POOL; i++) {
      for (var j = j0; j <= j1 && n < POOL; j++) {
        if (w.cell2('drift/on', i, j) > DENSITY) continue;
        var x = (i + w.cell2('drift/x', i, j) * 0.86 + 0.07) * CELL;
        var z = (j + w.cell2('drift/z', i, j) * 0.86 + 0.07) * CELL;
        var dx = x - s.worldX, dz = z - s.worldZ;
        var d2 = dx * dx + dz * dz;
        if (d2 > RANGE * RANGE) continue;
        var item = this.list[n];
        item.key = (i + 1048576) * 2097152 + (j + 1048576);
        item.x = x; item.z = z;
        this.plan(item, i, j, islands ? islands.shallow(x, z) : 0);
        /* A raft she comes up on gets off the water, once, and stays off. */
        if (item.kind === K_RAFT) {
          var t0 = this.woke[item.key];
          if (t0 === undefined && d2 < RAFT_WAKE * RAFT_WAKE) {
            t0 = this.woke[item.key] = s.t;
          }
          item.woke = t0 === undefined ? -1 : t0;
          if (item.woke >= 0 && s.t - item.woke > RAFT_GONE) continue;
        }
        n++;
      }
    }
    this.n = n;
    this.prune(i0, i1, j0, j1);
    this.stepSail(dt, s);
  };

  Flotsam.prototype.prune = function (i0, i1, j0, j1) {
    for (var key in this.woke) {
      var k = +key;
      var i = Math.floor(k / 2097152) - 1048576;
      var j = (k % 2097152) - 1048576;
      if (i < i0 || i > i1 || j < j0 || j > j1) delete this.woke[key];
    }
  };

  Flotsam.prototype.stepSail = function (dt, s) {
    var sail = this.sail, r = this.rand;
    if (!sail.on) {
      sail.hold -= dt;
      if (sail.hold > 0) return;
      sail.on = true;
      sail.age = 0;
      sail.ttl = 300 + r() * 420;
      var bearing = r() * TAU;
      var dist = lerp(1500, 2500, r());
      sail.x = s.worldX + Math.sin(bearing) * dist;
      sail.z = s.worldZ + Math.cos(bearing) * dist;
      /* Crossing rather than following: nobody is chasing anybody. */
      sail.course = bearing + Math.PI * 0.5 + (r() - 0.5) * 1.5;
      sail.speed = lerp(3.4, 6.2, r());
      sail.scale = lerp(0.85, 1.25, r());
      return;
    }
    sail.age += dt;
    sail.x += Math.sin(sail.course) * sail.speed * dt * s.motion;
    sail.z += Math.cos(sail.course) * sail.speed * dt * s.motion;
    /* She wanders too. */
    sail.course += SL.sfbm(s.t * 0.007, 11.3, 2) * 0.004 * dt;
    if (sail.age > sail.ttl) {
      sail.on = false;
      sail.hold = 240 + r() * 900;
    }
  };

  /* ---------- drawing ----------------------------------------------------- */

  /* Everything out here is drawn standing a little proud of the water rather
   * than lying flat on it. The eye is four metres up and a couple of hundred
   * out, so a horizontal quad is seen at five degrees and a raft of kelp nine
   * metres across comes out thirty centimetres tall: it reads as a speck, or
   * as nothing. A billboard that sits in the water and leans with it is the
   * honest shape at this angle. */
  function afloat(batch, s, o, cx, cz, hw, hh, rise, lean, sp, r, g, b, a) {
    var ux = -o.gx * lean, uy = 1, uz = -o.gz * lean;
    var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul; uy /= ul; uz /= ul;
    /* Upright against the water rather than rolled with the camera, so a pole
     * stands up and a log lies down however the eye happens to be tilted. */
    var rx = s.camRight[0], ry = s.camRight[1], rz = s.camRight[2];
    var d = rx * ux + ry * uy + rz * uz;
    rx -= ux * d; ry -= uy * d; rz -= uz * d;
    var rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    var uv = UV[sp];
    batch.billboard(cx, o.h + hh * rise, cz, rx, ry, rz, ux, uy, uz, hw, hh,
                    uv[0], uv[1], uv[2], uv[3], r, g, b, a);
  }

  Flotsam.prototype.draw = function (batch, sea, s) {
    var pal = s.pal;
    /* Everything adrift is the hour's own dark: a little under the near water,
     * so it reads as a thing on the surface and never as a hole in it. */
    /* Well under the water's own colour. A thing adrift has to read against a
     * sea that is now genuinely blue and genuinely bright, and it only has a
     * metre of freeboard to do it with. */
    var dr = pal.seaNear[0] * 0.26 / 255, dg = pal.seaNear[1] * 0.26 / 255,
        db = pal.seaNear[2] * 0.32 / 255;
    var lr = pal.foam[0] / 255, lg = pal.foam[1] / 255, lb = pal.foam[2] / 255;
    var hr = pal.haze[0] / 255, hg = pal.haze[1] / 255, hb = pal.haze[2] / 255;
    var light = clamp(0.30 + pal.light * 0.9, 0, 1.1);
    var o = this._w;
    var i, k;

    for (i = 0; i < this.n; i++) {
      var it = this.list[i];
      var cx = it.x - s.orgX, cz = it.z - s.orgZ;
      var ex = it.x - s.worldX, ez = it.z - s.worldZ;
      var dist = Math.sqrt(ex * ex + ez * ez);
      /* Out at the edge of the field it dissolves rather than winking out. */
      var edge = 1 - smoothstep(FADE0, FADE1, dist);
      if (edge <= 0.002) continue;
      var fog = 1 - Math.exp(-(dist * dist) / (s.fogD * s.fogD));
      var a0 = edge * (1 - fog) * light;
      if (a0 < 0.015) continue;
      SL.settleAfloat(sea.sample(cx, cz, s.t, o), dist);

      /* Colour: the thing itself, faded into the haze with distance. */
      var cr = lerp(dr, hr, fog * 0.8), cg = lerp(dg, hg, fog * 0.8),
          cb = lerp(db, hb, fog * 0.8);
      var sway = Math.sin(s.t * 0.21 + it.ph) * 0.10 * s.motion;

      if (it.kind === K_KELP) {
        /* A bed of it, lying in the water with the fronds awash. */
        for (k = 0; k < it.n; k++) {
          var kr = 2.8 + (k % 3) * 2.4;
          var ka = it.a + k * 2.39;
          var kx = cx + Math.cos(ka) * kr * it.sc;
          var kz = cz + Math.sin(ka) * kr * it.sc;
          afloat(batch, s, o, kx, kz, 3.2 * it.sc, 0.86 * it.sc,
                 0.30 + sway * 0.6, 1.4,
                 k % 4 === 3 ? S_WEED : S_KELP, cr, cg, cb, a0 * 0.84);
        }
      } else if (it.kind === K_WOOD) {
        var wob = 0.34 + Math.sin(s.t * 0.55 + it.ph) * 0.14 * s.motion;
        afloat(batch, s, o, cx, cz, 3.6 * it.sc, 0.95 * it.sc, wob, 1.6,
               S_LOG, cr, cg, cb, a0);
        if (it.n > 6) {
          afloat(batch, s, o, cx + Math.cos(it.a) * 3.0 * it.sc,
                 cz + Math.sin(it.a) * 3.0 * it.sc,
                 2.2 * it.sc, 1.1 * it.sc, 0.55, 1.6,
                 S_BRANCH, cr, cg, cb, a0 * 0.8);
        } else if (it.n < 5) {
          afloat(batch, s, o, cx - Math.sin(it.a) * 2.4 * it.sc,
                 cz + Math.cos(it.a) * 2.4 * it.sc,
                 2.6 * it.sc, 0.62 * it.sc, 0.28, 1.6,
                 S_PLANK, cr, cg, cb, a0 * 0.8);
        }
      } else if (it.kind === K_RAFT) {
        var up = it.woke >= 0 ? clamp((s.t - it.woke) / RAFT_GONE, 0, 1) : 0;
        for (k = 0; k < it.n; k++) {
          var ba = it.ph + k * 2.39;
          var brd = 2.2 + (k % 4) * 2.4;
          var bx = cx + Math.cos(ba) * brd, bz = cz + Math.sin(ba) * brd;
          var ba0 = a0 * 0.9;
          if (up <= 0) {
            afloat(batch, s, o, bx, bz, 0.80 * it.sc, 0.60 * it.sc, 0.55, 1.1,
                   S_SIT, cr, cg, cb, ba0);
          } else {
            /* They get up one after another, climb, and are gone into the
             * haze: it is a departure, not a startle. */
            var t = clamp((up * RAFT_GONE - k * 0.42) / 7.5, 0, 1);
            if (t <= 0) {
              afloat(batch, s, o, bx, bz, 0.80 * it.sc, 0.60 * it.sc, 0.55, 1.1,
                     S_SIT, cr, cg, cb, ba0);
              continue;
            }
            var climb = t * t * 26;
            var go = t * 54;
            var gx2 = bx + Math.cos(ba) * go, gz2 = bz + Math.sin(ba) * go;
            var uv2 = UV[S_FLY];
            var hw2 = 1.05 * it.sc;
            batch.billboard(gx2, o.h + 0.4 + climb, gz2,
                            s.camRight[0], s.camRight[1], s.camRight[2],
                            s.camUp[0], s.camUp[1], s.camUp[2],
                            hw2, hw2 * 0.5, uv2[0], uv2[1], uv2[2], uv2[3],
                            cr, cg, cb, ba0 * (1 - t) * (1 - t));
          }
        }
      } else if (it.kind === K_BUOY || it.kind === K_FLOAT || it.kind === K_POLE) {
        /* A mark stands up and rocks; it is the one thing out here with a
         * right angle in it, so it reads as somebody's work at any distance. */
        var sp = it.kind === K_BUOY ? S_BUOY : it.kind === K_FLOAT ? S_FLOAT : S_POLE;
        var hh = (it.kind === K_POLE ? 2.8 : 2.1) * it.sc;
        var rock = 1.6 + Math.sin(s.t * 0.9 + it.ph) * 0.9 * s.motion;
        afloat(batch, s, o, cx, cz, hh * 0.7, hh, 0.42, rock, sp,
               lerp(cr, lr, 0.30), lerp(cg, lg, 0.30), lerp(cb, lb, 0.30), a0);
      }
    }

    /* And somebody else, a long way off. */
    var sail = this.sail;
    if (sail.on) {
      var sx = sail.x - s.worldX, sz = sail.z - s.worldZ;
      var sd = Math.sqrt(sx * sx + sz * sz);
      var born = smoothstep(0, 55, sail.age) * (1 - smoothstep(sail.ttl - 55, sail.ttl, sail.age));
      var sfog = 1 - Math.exp(-(sd * sd) / (s.fogD * s.fogD));
      var sa = born * (1 - sfog * 0.88) * clamp(0.25 + pal.light, 0, 1) * 0.85;
      if (sa > 0.01) {
        SL.settleAfloat(sea.sample(sail.x - s.orgX, sail.z - s.orgZ, s.t, o), sd);
        var hs = 14 * sail.scale;
        var uvs = UV[S_SAIL];
        var cr2 = lerp(lr, hr, 0.55 + sfog * 0.40);
        var cg2 = lerp(lg, hg, 0.55 + sfog * 0.40);
        var cb2 = lerp(lb, hb, 0.55 + sfog * 0.40);
        batch.billboard(sail.x - s.orgX, o.h + hs * 0.42, sail.z - s.orgZ,
                        s.camRight[0], s.camRight[1], s.camRight[2],
                        0, 1, 0, hs * 0.72, hs,
                        uvs[0], uvs[1], uvs[2], uvs[3], cr2, cg2, cb2, sa);
      }
    }

    batch.flush(this.tex);
  };

  SL.Flotsam = Flotsam;
})(window.SL);
