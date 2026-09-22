/* Loads the scene's scripts into a bare Node context, with just enough of a
 * browser for the parts that never touch WebGL. `Scene.update` is one of
 * those: it draws nothing, so the helm, the sea and the boat can be sailed
 * here exactly as they are in the page. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

/* Read the running order off index.html rather than keeping a second copy of
 * it here: a module added to the page is a module these tests should be
 * loading too, and a list that has to be updated by hand is a list that will
 * be wrong on the day it matters. */
function scripts(without) {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var re = /<script\s+src="js\/([^"]+)"/g, out = [], m;
  while ((m = re.exec(html))) {
    if (without.indexOf(m[1]) < 0) out.push(m[1]);
  }
  return out;
}

/* Everything Scene is built from. The still frame, the sound and the page
 * plumbing are not part of sailing her. */
var FILES = scripts(['fallback.js', 'audio.js', 'main.js']);

function load() {
  var noop = function () {};
  var sandbox = {
    console: console,
    Math: Math, Date: Date, JSON: JSON,
    Float32Array: Float32Array, Uint16Array: Uint16Array,
    Uint8Array: Uint8Array, Int32Array: Int32Array,
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: noop,
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  /* No document and no canvas: anything that reaches for one is drawing, and
   * nothing here draws. */
  sandbox.document = { createElement: function () { return {}; } };
  vm.createContext(sandbox);

  FILES.forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'js/' + f });
  });
  return sandbox.SL;
}

/* One voyage, with nobody at the helm. Returns where she got to. */
function sail(SL, seed, seconds, opts) {
  opts = opts || {};
  var scene = new SL.Scene({ width: 0, height: 0 }, seed);
  var s = scene.s;
  if (opts.reduced) scene.setReduced(true);
  /* The page gives her a size before the first frame; the helm reads none of
   * it, but the things update() calls do. */
  s.W = 1200; s.H = 800; s.dpr = 1; s.unit = 1000;

  var startX = s.worldX, startZ = s.worldZ;
  var dt = 1 / 60, steps = Math.round(seconds / dt);
  var minSpeed = Infinity, maxSpeed = 0, total = 0;
  var prevX = s.worldX, prevZ = s.worldZ, travelled = 0;

  for (var i = 0; i < steps; i++) {
    scene.update(dt);
    /* Distance actually covered over the ground, not the speed she claims. */
    travelled += Math.hypot(s.worldX - prevX, s.worldZ - prevZ);
    prevX = s.worldX; prevZ = s.worldZ;
    if (s.speed < minSpeed) minSpeed = s.speed;
    if (s.speed > maxSpeed) maxSpeed = s.speed;
    total += s.speed;
  }

  return {
    seed: seed,
    seconds: seconds,
    travelled: travelled,
    displaced: Math.hypot(s.worldX - startX, s.worldZ - startZ),
    meanSpeed: total / steps,
    minSpeed: minSpeed,
    maxSpeed: maxSpeed,
    madeGood: travelled / seconds,
    courseHome: s.courseHome,
    steerInput: s.steerInput,
    throttleInput: s.throttleInput
  };
}

module.exports = { load: load, sail: sail, scripts: scripts, FILES: FILES };
