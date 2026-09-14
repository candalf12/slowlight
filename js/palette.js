/* slowlight — the light cycle.
 *
 * One full turn of `phase` (0..1) is one dusk -> night -> dawn -> day loop.
 * Colours are keyframed and interpolated, so the grade is continuous and the
 * wrap from 1 back to 0 is seamless. Everything stays muted and low-contrast;
 * the night keys are deliberately dark-leaning but never pure black.
 */
(function (SL) {
  'use strict';
  var hex = SL.hex, mix = SL.mix, lerp = SL.lerp, clamp = SL.clamp, desat = SL.desat;

  var KEYS = [
    /* p      skyTop    skyMid    skyHor    body      seaFar    seaNear   crest     light star */
    [0.00, 0x4a6480, 0x90a0ad, 0xdcbe9c, 0xffe2b8, 0x6c7d8d, 0x3a4b5d, 0xcbbda9, 0.90, 0.00],
    [0.08, 0x3b5273, 0x80849a, 0xdda47c, 0xffa877, 0x5e6c82, 0x33425a, 0xc2a08c, 0.72, 0.00],
    [0.15, 0x2b3f60, 0x5f6480, 0xb87b70, 0xd9775f, 0x4a566e, 0x2a3550, 0xa5808a, 0.50, 0.06],
    [0.22, 0x1c2c48, 0x39435f, 0x6d5567, 0xa85f55, 0x344058, 0x1f2940, 0x77667c, 0.30, 0.32],
    [0.30, 0x111c33, 0x1e2941, 0x3a3d55, 0x8b93b4, 0x212a40, 0x141c2e, 0x4b5170, 0.16, 0.72],
    [0.42, 0x08101f, 0x0e1527, 0x1a2138, 0xc9d2e4, 0x121930, 0x090f1d, 0x39415e, 0.09, 1.00],
    [0.56, 0x060b17, 0x0a1020, 0x141a2e, 0xd2d9ea, 0x0e1428, 0x070c18, 0x333b57, 0.08, 1.00],
    [0.68, 0x0b1428, 0x152036, 0x2c3450, 0xb9c2dc, 0x18203a, 0x0d1425, 0x424a6a, 0.14, 0.58],
    [0.76, 0x1b2c4c, 0x3a4666, 0x71607a, 0xcf8f7c, 0x33405c, 0x1d2740, 0x7a6c86, 0.32, 0.14],
    [0.84, 0x2f4a6e, 0x6e7893, 0xc9967e, 0xffb98d, 0x536480, 0x2d3c57, 0xb29a94, 0.60, 0.00],
    [0.92, 0x3f5d7d, 0x8598aa, 0xd4b8a0, 0xffdcbc, 0x64768a, 0x374859, 0xc4b6a6, 0.84, 0.00]
  ];

  /* Pre-decode the packed hex columns once. */
  var FRAMES = KEYS.map(function (k) {
    return {
      p: k[0],
      skyTop: hex(k[1]), skyMid: hex(k[2]), skyHor: hex(k[3]), body: hex(k[4]),
      seaFar: hex(k[5]), seaNear: hex(k[6]), crest: hex(k[7]),
      light: k[8], star: k[9]
    };
  });

  var COLOR_FIELDS = ['skyTop', 'skyMid', 'skyHor', 'body', 'seaFar', 'seaNear', 'crest'];

  /* A reusable palette object, so sampling never allocates per frame. */
  function makePalette() {
    var pal = { light: 0, star: 0, haze: null, fog: 0, wet: 0 };
    COLOR_FIELDS.forEach(function (f) { pal[f] = [0, 0, 0]; });
    pal.bodyGlow = [0, 0, 0];
    pal.cloudLit = [0, 0, 0];
    pal.cloudDark = [0, 0, 0];
    pal.haze = [0, 0, 0];
    pal.island = [0, 0, 0];
    pal.foam = [0, 0, 0];
    return pal;
  }

  function writeMix(out, a, b, t) {
    out[0] = lerp(a[0], b[0], t);
    out[1] = lerp(a[1], b[1], t);
    out[2] = lerp(a[2], b[2], t);
  }

  /* Sample the keyframes at `phase`, then fold in weather. */
  function sample(pal, phase, weather) {
    var p = phase - Math.floor(phase);
    var i = 0;
    while (i < FRAMES.length - 1 && FRAMES[i + 1].p <= p) i++;
    var a = FRAMES[i];
    var b = FRAMES[(i + 1) % FRAMES.length];
    var span = (b.p > a.p ? b.p : b.p + 1) - a.p;
    var t = span > 0 ? (p - a.p) / span : 0;
    t = t * t * (3 - 2 * t);

    for (var k = 0; k < COLOR_FIELDS.length; k++) {
      var f = COLOR_FIELDS[k];
      writeMix(pal[f], a[f], b[f], t);
    }
    pal.light = lerp(a.light, b.light, t);
    pal.star = lerp(a.star, b.star, t);

    var fog = weather ? weather.haze : 0;
    var rain = weather ? weather.rain : 0;
    pal.fog = fog;
    pal.wet = rain;

    /* Haze colour: the horizon band, flattened and lifted a little. */
    writeMix(pal.haze, pal.skyHor, pal.skyMid, 0.45);
    var hz = desat(pal.haze, 0.55 + 0.2 * rain);
    pal.haze[0] = hz[0]; pal.haze[1] = hz[1]; pal.haze[2] = hz[2];

    /* Overcast / rain pulls everything toward the haze and drops contrast. */
    var flatten = clamp(fog * 0.42 + rain * 0.3, 0, 0.72);
    if (flatten > 0.001) {
      for (var m = 0; m < COLOR_FIELDS.length; m++) {
        var fld = COLOR_FIELDS[m];
        if (fld === 'body') continue;
        var c = desat(pal[fld], flatten * 0.7);
        writeMix(pal[fld], c, pal.haze, flatten * 0.34);
      }
      pal.light *= 1 - flatten * 0.35;
      pal.star *= 1 - clamp(fog * 1.1 + rain * 1.2, 0, 1);
    }

    /* Derived colours. */
    writeMix(pal.bodyGlow, pal.body, pal.skyHor, 0.45);
    writeMix(pal.cloudLit, pal.skyHor, pal.body, 0.16 + 0.18 * pal.light);
    var cl = desat(pal.cloudLit, 0.3 + 0.3 * fog);
    pal.cloudLit[0] = cl[0]; pal.cloudLit[1] = cl[1]; pal.cloudLit[2] = cl[2];
    writeMix(pal.cloudDark, pal.skyMid, pal.skyTop, 0.5);
    var cd = desat(pal.cloudDark, 0.25);
    pal.cloudDark[0] = cd[0]; pal.cloudDark[1] = cd[1]; pal.cloudDark[2] = cd[2];
    writeMix(pal.island, pal.skyHor, pal.skyTop, 0.62);
    writeMix(pal.foam, pal.crest, [235, 238, 240], 0.35 + 0.25 * pal.light);
    return pal;
  }

  /* Sun and moon share one arc parameter `a` in [0,1):
   * a in [0,0.5) the sun is up, a in [0.5,1) the moon is. The mapping is
   * skewed so night occupies most of the cycle. */
  function arcParam(phase) {
    var p = phase - Math.floor(phase);
    var NIGHT_START = 0.15, NIGHT_END = 0.80;
    if (p >= NIGHT_START && p < NIGHT_END) {
      return 0.5 + (p - NIGHT_START) / (NIGHT_END - NIGHT_START) * 0.5;
    }
    var q = p >= NIGHT_END ? p - NIGHT_END : p + (1 - NIGHT_END);
    return q / (1 - (NIGHT_END - NIGHT_START)) * 0.5;
  }

  SL.makePalette = makePalette;
  SL.samplePalette = sample;
  SL.arcParam = arcParam;
  SL.CYCLE_SECONDS = 1200;
})(window.SL);
