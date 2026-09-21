/* slowlight - page plumbing.
 *
 * Reads the seed, builds the scene, and runs it until the viewer presses Esc
 * or closes the tab. It never asks for anything and never ends on its own.
 * If there is no WebGL to sail on - or the context is taken away mid-voyage -
 * it puts up a still frame of the same world rather than a blank page.
 */
(function (SL) {
  'use strict';
  var canvas, seedEl, scene, seed, ambience;
  var raf = 0, lastTime = 0, running = false, stopping = false, fade = 0;
  var resizePending = false, reducedQuery = null, dead = false;
  var restoreTimer = 0, waiting = false;

  /* ---------- layout ---------------------------------------------------- */

  function viewport() {
    var W = Math.max(320, window.innerWidth);
    var H = Math.max(240, window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    /* Keep the backing store within reach of a plain laptop. */
    var maxPx = 2900000;
    if (W * H * dpr * dpr > maxPx) dpr = Math.max(1, Math.sqrt(maxPx / (W * H)));
    return { W: W, H: H, dpr: dpr };
  }

  function layout() {
    var v = viewport();
    scene.setSize(v.W, v.H, v.dpr);
  }

  function requestLayout() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(function () {
      resizePending = false;
      if (dead) { showStill(); return; }
      layout();
    });
  }

  /* ---------- loop ------------------------------------------------------ */

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    /* A long pause - tab hidden, laptop asleep - must not jolt the scene. */
    if (dt > 0.05) dt = 0.05;
    if (ambience) ambience.update(dt);

    if (stopping) {
      fade = Math.min(1, fade + dt / 2.2);
      scene.update(dt * (1 - fade));
      scene.draw();
      scene.fadeOut(fade);
      if (fade >= 1) halt();
      return;
    }
    scene.update(dt);
    scene.draw();
  }

  function start() {
    if (running || dead) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function halt() {
    pause();
    document.body.classList.add('slowlight-stopped');
    scene.fadeOut(1);
    setNotice('stopped - press any key to sail on');
  }

  /* Escape stops her, and Escape is also the key a viewer is most likely to
   * press out of habit while working in another window. So stopping has to be
   * something you can come back from: anything at all sets her sailing again,
   * and the line above says so, because a black rectangle explains nothing. */
  function sailOn() {
    if (!stopping || dead) return;
    stopping = false;
    fade = 0;
    document.body.classList.remove('slowlight-stopped');
    setNotice('');
    if (ambience && ambience.sailOn) ambience.sailOn();
    start();
  }

  function setNotice(text) {
    var note = document.getElementById('notice');
    if (!note) return;
    note.textContent = text;
    note.hidden = !text;
  }

  /* ---------- the still frame ------------------------------------------- */

  function showStill(reason) {
    var v = viewport();
    SL.showStill(canvas, seed, v.W, v.H, v.dpr, reason);
  }

  function giveUp() {
    dead = true;
    pause();
    /* Nothing is moving any more, so nothing should still be sounding. */
    if (ambience) ambience.fadeOut();
    showStill('nogl');
    document.body.classList.add('slowlight-ready');
  }

  /* ---------- input ----------------------------------------------------- */

  /* The arrow keys are the whole control surface: left and right turn her,
   * up and down decide how hard she is sailing. Held keys are tracked so
   * opposite pairs cancel and releasing one of a pair leaves the other in. */
  var held = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };

  function applyHeld() {
    var s = scene.s;
    s.steerInput = (held.ArrowRight ? 1 : 0) + (held.ArrowLeft ? -1 : 0);
    s.throttleInput = (held.ArrowUp ? 1 : 0) + (held.ArrowDown ? -1 : 0);
  }

  function releaseKeys() {
    held.ArrowLeft = held.ArrowRight = held.ArrowUp = held.ArrowDown = false;
    applyHeld();
  }

  function onKeyDown(e) {
    if (waiting) revive();
    /* Anything brings her back, including a second Escape: someone who stopped
     * her by accident should not have to work out that a reload is the cure. */
    if (stopping) { sailOn(); return; }
    if (e.key === 'Escape') {
      if (!dead) { stopping = true; start(); }
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(held, e.key)) return;
    held[e.key] = true;
    applyHeld();
    e.preventDefault();
  }

  function onKeyUp(e) {
    if (!Object.prototype.hasOwnProperty.call(held, e.key)) return;
    held[e.key] = false;
    applyHeld();
  }

  /* ---------- seed label ------------------------------------------------ */

  function setupSeedLabel(value) {
    var idle = 'seed ' + value;
    seedEl.textContent = idle;
    seedEl.title = 'Click to copy this world’s link';

    function selectFallback() {
      /* No clipboard permission: leave the text selected so Ctrl+C works. */
      try {
        var r = document.createRange();
        r.selectNodeContents(seedEl);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) { /* nothing useful to do */ }
    }

    seedEl.addEventListener('click', function () {
      var link = window.location.href;
      var done = function () {
        seedEl.textContent = 'link copied';
        seedEl.classList.add('is-copied');
        window.setTimeout(function () {
          seedEl.textContent = idle;
          seedEl.classList.remove('is-copied');
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, selectFallback);
      } else {
        selectFallback();
      }
    });
  }

  /* ---------- the context ----------------------------------------------- */

  /* A lost context is never the end. A machine that slept all evening is the
   * ordinary case here, and coming back to a dead screen that claims this
   * browser has no WebGL - when it plainly does - is the worst thing the page
   * could say. So: put the still frame up quickly, tell the truth about it,
   * and take the context back at the first opportunity. */
  function onContextLost(e) {
    e.preventDefault();
    pause();
    scene.ok = false;
    waiting = true;
    window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(function () {
      if (waiting) showStill('lost');
    }, 1200);
  }

  /* Called when the browser says the context is back, when the viewer returns
   * to the tab, and when they touch anything - because a machine waking from
   * sleep does not always announce itself. Never on a blind timer: each
   * attempt asks for a context, and the browser only allows so many. */
  function revive() {
    if (!waiting || dead) return;
    scene.islands.reset();
    if (!scene.init()) return;
    window.clearTimeout(restoreTimer);
    waiting = false;
    SL.hideStill(canvas);
    layout();
    if (!document.body.classList.contains('slowlight-stopped')) start();
  }

  /* ---------- boot ------------------------------------------------------ */

  function boot() {
    canvas = document.getElementById('scene');
    seedEl = document.getElementById('seed');

    seed = SL.readSeed() || SL.mintSeed();
    SL.reflectSeed(seed);
    setupSeedLabel(seed);

    scene = new SL.Scene(canvas, seed);

    reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    scene.setReduced(reducedQuery && reducedQuery.matches);

    window.addEventListener('resize', requestLayout);
    window.addEventListener('orientationchange', requestLayout);

    if (!scene.init()) { giveUp(); return; }
    /* Sound is an addition, never a requirement: if it cannot be had, the
     * scene never knows the difference. It waits until there is a voyage to
     * listen to, so a held still frame is a silent one. */
    ambience = SL.Ambience ? new SL.Ambience(scene) : null;
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', revive, false);

    layout();
    scene.warmup(14);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseKeys);

    if (reducedQuery) {
      var onChange = function (e) { scene.setReduced(e.matches); };
      if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', onChange);
      else if (reducedQuery.addListener) reducedQuery.addListener(onChange);
    }
    window.addEventListener('pointerdown', function () {
      if (waiting) revive();
      else sailOn();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { releaseKeys(); if (!stopping) pause(); return; }
      if (waiting) { revive(); return; }
      if (!document.body.classList.contains('slowlight-stopped')) start();
    });

    document.body.classList.add('slowlight-ready');
    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.SL);
