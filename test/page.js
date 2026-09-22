/* Just enough browser to boot `js/main.js` in Node, plus a clock the test
 * winds by hand so a thirty-second retry ladder takes no time to watch.
 *
 * Nothing here draws. `Scene.prototype.init` is the one seam the tests move:
 * it is what asks the browser for a context, so making it fail and then
 * succeed is exactly "the GPU went away and came back", with no mock WebGL
 * underneath it.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

/* index.html's own order, without the sound - `SL.Ambience` being absent is a
 * case the page already supports, and it keeps Web Audio out of this. The
 * plumbing goes in last, on its own, because booting it is the thing under
 * test and the seams have to be in place before it runs. */
var FILES = require('./harness.js').scripts(['audio.js', 'main.js']);

function clock() {
  var now = 0, seq = 0, pending = [];
  return {
    now: function () { return now; },
    set: function (fn, ms) {
      var id = ++seq;
      pending.push({ id: id, at: now + (ms || 0), fn: fn });
      return id;
    },
    clear: function (id) {
      for (var i = 0; i < pending.length; i++) {
        if (pending[i].id === id) { pending.splice(i, 1); return; }
      }
    },
    /* Wind forward, firing what falls due, in order. */
    advance: function (ms) {
      var end = now + ms;
      for (;;) {
        var next = null;
        for (var i = 0; i < pending.length; i++) {
          if (pending[i].at <= end && (!next || pending[i].at < next.at ||
              (pending[i].at === next.at && pending[i].id < next.id))) next = pending[i];
        }
        if (!next) break;
        pending.splice(pending.indexOf(next), 1);
        now = next.at;
        next.fn();
      }
      now = end;
    },
    pending: function () { return pending.length; }
  };
}

function element(id) {
  var listeners = Object.create(null);
  return {
    id: id,
    width: 1200, height: 800, hidden: false, textContent: '', title: '',
    style: {},
    classList: {
      _set: Object.create(null),
      add: function (c) { this._set[c] = true; },
      remove: function (c) { delete this._set[c]; },
      contains: function (c) { return !!this._set[c]; }
    },
    addEventListener: function (type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    removeEventListener: function () {},
    /* What the browser would do: hand the page an event it is listening for. */
    fire: function (type, ev) {
      var fns = listeners[type] || [];
      ev = ev || {};
      if (!ev.preventDefault) ev.preventDefault = function () {};
      for (var i = 0; i < fns.length; i++) fns[i].call(this, ev);
      return fns.length;
    },
    listenerCount: function (type) { return (listeners[type] || []).length; },
    getContext: function () { return null; },
    appendChild: function () {}, removeChild: function () {},
    getBoundingClientRect: function () { return { width: 1200, height: 800 }; }
  };
}

/* Boot the page. Returns the handles a test needs to poke at it. */
function boot(opts) {
  opts = opts || {};
  var c = clock();
  var canvas = element('scene');
  var els = { scene: canvas, seed: element('seed'), notice: element('notice') };
  var frames = [];                    /* queued requestAnimationFrame callbacks */

  var body = element('body');
  var doc = {
    readyState: 'complete',
    hidden: false,
    body: body,
    documentElement: element('html'),
    getElementById: function (id) { return els[id] || null; },
    querySelector: function () { return null; },
    createElement: function (tag) { return element(tag); },
    addEventListener: function (t, fn) { doc._l = doc._l || {}; (doc._l[t] || (doc._l[t] = [])).push(fn); },
    removeEventListener: function () {},
    fire: function (t, ev) {
      var fns = (doc._l && doc._l[t]) || [];
      for (var i = 0; i < fns.length; i++) fns[i](ev || {});
      return fns.length;
    },
    createRange: function () { return { selectNodeContents: function () {} }; }
  };

  var sandbox = {
    console: console, Math: Math, Date: Date, JSON: JSON,
    Float32Array: Float32Array, Uint16Array: Uint16Array,
    Uint8Array: Uint8Array, Int32Array: Int32Array,
    URLSearchParams: URLSearchParams,
    performance: { now: function () { return c.now(); } },
    setTimeout: function (fn, ms) { return c.set(fn, ms); },
    clearTimeout: function (id) { return c.clear(id); },
    requestAnimationFrame: function (fn) { frames.push(fn); return frames.length; },
    cancelAnimationFrame: function () {},
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
    document: doc,
    location: { search: '?seed=' + (opts.seed || 'driftwood'), hash: '', href: 'http://x/' },
    history: { replaceState: function () {} },
    navigator: { clipboard: null },
    matchMedia: function () {
      return { matches: !!opts.reduced, addEventListener: function () {}, addListener: function () {} };
    },
    getSelection: function () { return { removeAllRanges: function () {}, addRange: function () {} }; },
    crypto: null
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = function (t, fn) {
    sandbox._l = sandbox._l || {};
    (sandbox._l[t] || (sandbox._l[t] = [])).push(fn);
  };
  sandbox.window.removeEventListener = function () {};
  sandbox.fire = function (t, ev) {
    var fns = (sandbox._l && sandbox._l[t]) || [];
    for (var i = 0; i < fns.length; i++) fns[i](ev || {});
    return fns.length;
  };
  vm.createContext(sandbox);

  /* Load everything but main.js, then put the seams in, then boot. */
  FILES.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox,
                    { filename: 'js/' + f });
  });

  var SL = sandbox.SL;
  var still = { shown: false };
  /* The still frame is a picture; this test is about whether she is sailing. */
  SL.showStill = function () { still.shown = true; };
  SL.hideStill = function () { still.shown = false; };

  /* The seam: every ask for a context, and whether it is granted. */
  var asks = { count: 0, grant: opts.grantContext !== false };
  var Scene = SL.Scene, built = { scene: null };
  SL.Scene = function (cv, sd) {
    var s = new Scene(cv, sd);
    built.scene = s;
    return s;
  };
  SL.Scene.prototype = Scene.prototype;
  Scene.prototype.init = function () {
    asks.count++;
    if (!asks.grant) return false;
    /* A context that answers to anything and does nothing: enough for the
     * bookkeeping around drawing, and nothing here looks at a pixel. */
    this.gl = new Proxy({}, { get: function () { return function () { return 1; }; } });
    this.ok = true;
    return true;
  };
  /* These two only paint - the fade included - and nothing here looks at a
   * pixel. Everything the tests do read is worked out in update(). */
  Scene.prototype.draw = function () {};
  Scene.prototype.fadeOut = function () {};

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8'), sandbox,
                  { filename: 'js/main.js' });

  /* Run the animation loop for a stretch of wall time, at a steady 60. */
  function run(seconds) {
    var step = 1000 / 60;
    for (var i = 0; i < Math.round(seconds * 60); i++) {
      c.advance(step);
      var due = frames;
      frames = [];
      for (var j = 0; j < due.length; j++) due[j](c.now());
    }
  }

  return {
    SL: SL, window: sandbox, document: doc, canvas: canvas, body: body,
    clock: c, asks: asks, still: still, run: run,
    scene: function () { return built.scene; },
    /* Wind the clock without drawing - what a stopped page does. */
    idle: function (seconds) { c.advance(seconds * 1000); }
  };
}

module.exports = { boot: boot, element: element, clock: clock };
