/* slowlight — the seed.
 *
 * The seed comes from the URL (?seed=... or #seed=...). If there isn't one we
 * mint one and write it back, so any world can be returned to or shared.
 * Every procedural stream is derived from it by name, which means adding a new
 * stream later never shifts the worlds that already exist.
 */
(function (SL) {
  'use strict';

  /* String -> 32-bit seed (xmur3). */
  function strHash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
      h = (h << 13) | (h >>> 19);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function readSeed() {
    var loc = window.location;
    var fromQuery = null;
    try {
      fromQuery = new URLSearchParams(loc.search).get('seed');
    } catch (e) { /* very old browser: fall through to the hash */ }
    if (!fromQuery && loc.hash) {
      var m = /(?:^#|[#&?])seed=([^&]+)/.exec(loc.hash);
      if (m) fromQuery = decodeURIComponent(m[1]);
      else if (/^#[A-Za-z0-9_-]{1,32}$/.test(loc.hash)) fromQuery = loc.hash.slice(1);
    }
    if (fromQuery) {
      var cleaned = String(fromQuery).trim().slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '');
      if (cleaned) return cleaned;
    }
    return null;
  }

  /* Only used to pick a brand new seed — never for world generation. */
  function mintSeed() {
    var bytes;
    if (window.crypto && window.crypto.getRandomValues) {
      bytes = new Uint32Array(2);
      window.crypto.getRandomValues(bytes);
    } else {
      bytes = [Date.now() >>> 0, (Math.random() * 4294967296) >>> 0];
    }
    var s = (bytes[0].toString(36) + bytes[1].toString(36)).replace(/[^a-z0-9]/g, '');
    return s.slice(0, 8).padEnd(8, '0');
  }

  function reflectSeed(seed) {
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.get('seed') === seed) return;
      url.searchParams.set('seed', seed);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) {
      /* replaceState can be unavailable in odd embeddings; the scene is
       * unaffected, the URL just won't carry the seed. */
    }
  }

  function World(seed) {
    this.seed = seed;
    this.root = strHash(seed);
  }

  /* An independent, reproducible random stream for one named subsystem. */
  World.prototype.stream = function (name) {
    return SL.mulberry32((this.root ^ strHash('/' + name)) >>> 0);
  };

  /* A stable value in [0,1) for a named aspect of this world. */
  World.prototype.value = function (name) {
    return (this.root ^ strHash('=' + name)) / 4294967296;
  };

  /* A stable value for a named field at integer cell `k` — used for anything
   * anchored to a place in the world rather than to a moment in time. */
  World.prototype.cell = function (name, k, salt) {
    var h = Math.imul((this.root ^ strHash(name)) >>> 0, 374761393);
    h ^= Math.imul(k | 0, 668265263);
    h ^= Math.imul((salt | 0) + 0x9e3779b9, 2246822507);
    h = Math.imul(h ^ (h >>> 15), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  SL.strHash = strHash;
  SL.readSeed = readSeed;
  SL.mintSeed = mintSeed;
  SL.reflectSeed = reflectSeed;
  SL.World = World;
})(window.SL);
