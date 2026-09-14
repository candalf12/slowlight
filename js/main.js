/* slowlight — page plumbing.
 *
 * Reads the seed, builds the scene, and runs it until the viewer presses Esc
 * or closes the tab. It never asks for anything and never ends on its own.
 */
(function (SL) {
  'use strict';
  var canvas, seedEl, scene;
  var raf = 0, lastTime = 0, running = false, stopping = false, fade = 0;
  var resizePending = false, reducedQuery = null;

  /* ---------- layout ---------------------------------------------------- */

  function layout() {
    var W = Math.max(320, window.innerWidth);
    var H = Math.max(240, window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    /* Keep the backing store within reach of a plain laptop. */
    var maxPx = 2900000;
    if (W * H * dpr * dpr > maxPx) dpr = Math.max(1, Math.sqrt(maxPx / (W * H)));
    scene.setSize(W, H, dpr);
  }

  function requestLayout() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(function () { resizePending = false; layout(); });
  }

  /* ---------- loop ------------------------------------------------------ */

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    /* A long pause — tab hidden, laptop asleep — must not jolt the scene. */
    if (dt > 0.05) dt = 0.05;

    if (stopping) {
      fade = Math.min(1, fade + dt / 2.2);
      scene.update(dt * (1 - fade));
      scene.draw();
      var ctx = scene.ctx;
      ctx.fillStyle = SL.rgba([4, 6, 11], fade);
      ctx.fillRect(0, 0, scene.s.W, scene.s.H);
      if (fade >= 1) halt();
      return;
    }
    scene.update(dt);
    scene.draw();
  }

  function start() {
    if (running) return;
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
    var ctx = scene.ctx;
    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, scene.s.W, scene.s.H);
  }

  /* ---------- input ----------------------------------------------------- */

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (!stopping) { stopping = true; start(); }
      return;
    }
    if (e.key === 'ArrowLeft') { scene.s.steerInput = -1; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { scene.s.steerInput = 1; e.preventDefault(); }
  }

  function onKeyUp(e) {
    var s = scene.s;
    if (e.key === 'ArrowLeft' && s.steerInput < 0) s.steerInput = 0;
    else if (e.key === 'ArrowRight' && s.steerInput > 0) s.steerInput = 0;
  }

  /* ---------- seed label ------------------------------------------------ */

  function setupSeedLabel(seed) {
    var idle = 'seed ' + seed;
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

  /* ---------- boot ------------------------------------------------------ */

  function boot() {
    canvas = document.getElementById('scene');
    seedEl = document.getElementById('seed');

    var seed = SL.readSeed() || SL.mintSeed();
    SL.reflectSeed(seed);
    setupSeedLabel(seed);

    scene = new SL.Scene(canvas, seed);

    reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    scene.setReduced(reducedQuery && reducedQuery.matches);

    layout();
    scene.warmup(14);

    window.addEventListener('resize', requestLayout);
    window.addEventListener('orientationchange', requestLayout);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { scene.s.steerInput = 0; });

    if (reducedQuery) {
      var onChange = function (e) { scene.setReduced(e.matches); };
      if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', onChange);
      else if (reducedQuery.addListener) reducedQuery.addListener(onChange);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (!stopping) pause(); }
      else if (!document.body.classList.contains('slowlight-stopped')) start();
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
