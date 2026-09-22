/* She sails herself.
 *
 * The README makes one promise before it makes any other: "She sails herself
 * and runs until you stop her... steering is never required and never needed."
 * These are the checks that keep it true - that she is under way on a cold
 * load with nobody at the keyboard, on any seed, and that she goes back to
 * being under way on her own after the screen is taken away from her.
 *
 *   node test/sails-herself.js
 */
'use strict';
var harness = require('./harness.js');
var page = require('./page.js');

var failures = 0, checks = 0;

function ok(what, cond, detail) {
  checks++;
  if (cond) { console.log('  ok   ' + what); return; }
  failures++;
  console.log('  FAIL ' + what + (detail ? '\n         ' + detail : ''));
}

function group(name) { console.log('\n' + name); }

/* ---------- she makes way, on a cold load, with no hand on the helm ------- */

group('under way on a cold load, no key ever pressed');

var SL = harness.load();
var seeds = [];
for (var i = 0; i < 40; i++) seeds.push('seed-' + i);
seeds = seeds.concat(['driftwood', 'slowlight', 'kelp', 'harbour', 'albatross', 'lantern']);

var slowest = null, stalled = [];
seeds.forEach(function (sd) {
  var r = harness.sail(SL, sd, 30);
  if (!slowest || r.madeGood < slowest.madeGood) slowest = r;
  /* Made good over the ground, not the speed she claims: a boat that reports
   * way on while staying where she is has not sailed anywhere. */
  if (r.madeGood < 1) stalled.push(sd + ' (' + r.madeGood.toFixed(3) + ' m/s)');
  if (r.minSpeed <= 0) stalled.push(sd + ' (stopped dead at some point)');
});

ok(seeds.length + ' seeds all make way with no input', stalled.length === 0,
   stalled.slice(0, 6).join(', '));
ok('the slowest of them still makes a real pace',
   slowest.madeGood > 2,
   'slowest was ' + slowest.seed + ' at ' + slowest.madeGood.toFixed(3) + ' m/s');
ok('she covers ground, not just reports speed',
   slowest.displaced > 30,
   slowest.seed + ' displaced ' + slowest.displaced.toFixed(1) + ' m in 30 s');

/* prefers-reduced-motion calms the swell; it must never take the way off her. */
var calm = harness.sail(SL, 'driftwood', 30, { reduced: true });
ok('reduced motion still leaves her sailing', calm.madeGood > 1,
   'made good ' + calm.madeGood.toFixed(3) + ' m/s');

/* ---------- and the whole page does the same thing ----------------------- */

group('the page itself, booted as the browser boots it');

var p = page.boot({ seed: 'driftwood' });
p.run(20);
var s = p.scene().s;
ok('she is under way twenty seconds after load, untouched', s.speed > 1,
   'speed ' + s.speed.toFixed(3));
ok('she has moved', Math.hypot(s.worldX - s.orgX, s.worldZ - s.orgZ) > 0);
ok('no still frame is showing', p.still.shown === false);
ok('the context was asked for exactly once', p.asks.count === 1,
   'asked ' + p.asks.count + ' times');

/* ---------- Escape still stops her, and anything starts her again -------- */

group('Escape stops her; anything at all sets her going again');

var before = p.scene().s.t;
p.window.fire('keydown', { key: 'Escape', preventDefault: function () {} });
p.run(5);                                   /* the fade is 2.2 s */
var stoppedAt = p.scene().s.t;
p.run(5);
ok('Escape brings her to a stop', p.scene().s.t - stoppedAt < 0.2,
   'scene time still advancing by ' + (p.scene().s.t - stoppedAt).toFixed(3));
ok('she was sailing before Escape', stoppedAt > before);
ok('the page says so', p.body.classList.contains('slowlight-stopped'));

var restartFrom = p.scene().s.t;
p.window.fire('keydown', { key: 'ArrowUp', preventDefault: function () {} });
p.run(5);
ok('a key sets her going again', p.scene().s.t - restartFrom > 3,
   'advanced ' + (p.scene().s.t - restartFrom).toFixed(2) + ' s');
ok('and the page stops saying she is stopped',
   !p.body.classList.contains('slowlight-stopped'));

/* ---------- steering still works, and letting go settles her back -------- */

group('steering, and letting go');

var q = page.boot({ seed: 'driftwood' });
q.run(5);
var home = q.scene().s.courseHome;
var heading0 = q.scene().s.heading;

q.window.fire('keydown', { key: 'ArrowRight', preventDefault: function () {} });
q.run(8);
var turned = Math.abs(q.scene().s.heading - heading0);
ok('the helm answers', turned > 0.02, 'turned ' + turned.toFixed(4) + ' rad');

q.window.fire('keydown', { key: 'ArrowUp', preventDefault: function () {} });
q.run(8);
ok('the sheets answer', q.scene().s.course > home + 0.05,
   'course ' + q.scene().s.course.toFixed(3) + ' vs home ' + home.toFixed(3));

q.window.fire('keyup', { key: 'ArrowRight' });
q.window.fire('keyup', { key: 'ArrowUp' });
q.run(90);                                  /* COURSE_SETTLE is 26 s */
ok('letting go settles her back to her own course',
   Math.abs(q.scene().s.course - home) < 0.05,
   'course ' + q.scene().s.course.toFixed(3) + ' vs home ' + home.toFixed(3));
ok('and she is still sailing after all that', q.scene().s.speed > 1);

/* ---------- the screen going away must not end the voyage --------------- */

group('a lost context comes back on its own, with nobody at the keyboard');

var r = page.boot({ seed: 'driftwood' });
r.run(5);
var sailedTo = r.scene().s.t;

/* The browser takes the context away, and never says it is back - which it is
 * not obliged to do. Nobody touches the keyboard or the mouse from here on. */
r.asks.grant = false;
var asksBefore = r.asks.count;
r.canvas.fire('webglcontextlost', { preventDefault: function () {} });

r.run(3);
ok('she stops when the screen goes away', r.scene().s.t - sailedTo < 3.1);
ok('a still frame goes up rather than a blank page', r.still.shown === true);

r.run(60);
ok('she keeps asking for the context back, unprompted',
   r.asks.count > asksBefore + 2,
   'asked ' + (r.asks.count - asksBefore) + ' times in 60 s');

/* The GPU comes back. Still nobody has pressed anything. */
var frozenAt = r.scene().s.t;
r.asks.grant = true;
r.run(45);
ok('she is sailing again, with no key ever pressed',
   r.scene().s.t - frozenAt > 5,
   'advanced ' + (r.scene().s.t - frozenAt).toFixed(2) + ' s');
ok('and the still frame comes down', r.still.shown === false);

var movedFrom = { x: r.scene().s.worldX, z: r.scene().s.worldZ };
r.run(10);
ok('and she is making way over the ground again',
   Math.hypot(r.scene().s.worldX - movedFrom.x, r.scene().s.worldZ - movedFrom.z) > 10);

/* ---------- but she must not hammer the browser for contexts ------------- */

group('asking, without hammering');

var h = page.boot({ seed: 'driftwood' });
h.run(2);
h.asks.grant = false;
var base = h.asks.count;
h.canvas.fire('webglcontextlost', { preventDefault: function () {} });
h.run(300);                                  /* five minutes in the dark */
var inFive = h.asks.count - base;
ok('five minutes of no context costs a bounded number of asks',
   inFive > 3 && inFive < 25, 'asked ' + inFive + ' times in 5 minutes');

/* ---------- and no WebGL at all is still one still frame, not a spin ----- */

group('no WebGL at all');

var n = page.boot({ seed: 'driftwood', grantContext: false });
n.run(60);
ok('the still frame goes up', n.still.shown === true);
ok('and she does not sit there asking for a context that will never come',
   n.asks.count === 1, 'asked ' + n.asks.count + ' times');

/* ---------- ---------------------------------------------------------- */

console.log('\n' + (failures === 0
  ? checks + ' checks, all good'
  : failures + ' of ' + checks + ' checks FAILED'));
process.exit(failures === 0 ? 0 : 1);
