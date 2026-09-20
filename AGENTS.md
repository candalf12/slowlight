# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## The scene

- Plain scripts on `window.SL`, loaded in order by `index.html`. No build step,
  no dependencies, no network at runtime, relative paths only, so it runs from
  a subpath. Serve it with any static server: `python3 -m http.server 8000`.
- It is a real 3D scene drawn with hand-written WebGL, seen from a chase camera
  just astern of the boat (`js/camera.js`). `js/gl.js` owns the context, the
  program helpers, and the one chunk of GLSL every shader shares: `skyColor`.
  The sea reflects it, the land and the water fog into it, and the sky pass
  draws it, so all three agree on the light by calling one function rather than
  by three sets of constants that drift apart.
- `js/palette.js` is still the only authority on colour and on the twenty-minute
  cycle. Shaders never hold colours of their own; they receive the sampled
  palette as uniforms through `SL.setAir`. The sea is graded once more on top of
  that: `SL.waterCharacter` gives each world its own blue and `SL.gradeWater`
  bends the hour's sea into it, which `js/sea.js` uploads itself because only it
  knows whose water it is drawing. That grade moves chroma, never luminance, so
  the hour keeps control of how light the water is at every point of the cycle.
- The sea is one camera-centred polar grid whose rings grow geometrically
  outward — see the header of `js/sea.js`. It fogs to exactly the sky's horizon
  colour, so it has no edge to find. Wave height is a pure function of world
  position and `s.t`, evaluated in the vertex shader for the picture and
  mirrored on the CPU by `Sea.sample` for the boat, the camera and the wake:
  change one and you must change the other, or the boat floats on water that is
  not the water being drawn.
- World coordinates are unbounded and float32 is not. Everything handed to the
  GPU is in a local frame rebased near the boat (`s.orgX/orgZ`, `Scene.rebase`),
  and each wave's share of that origin is folded into its phase in double
  precision. Anything that lives in the local frame — the camera, the boat's
  path, the birds — has to be shifted when the origin moves.
- Everything is derived from the URL seed through `World.stream` / `World.value`
  / `World.cell` / `World.cell2` in `js/seed.js`, so a seed always gives the
  same world. Name a new stream rather than reusing one: adding a name never
  shifts the worlds that already exist.
- Nothing is retained between frames except the boat's own path, a fixed ring
  the wake is drawn along so the foam can curve when she does. Waves, foam,
  reflections, surf and rain are all regenerated from world coordinates and
  `s.t` every frame. Keep it that way, and keep per-frame allocation out of the
  draw path — `js/batch.js` is the one dynamic buffer and it is written in
  place.
- `prefers-reduced-motion` calms the swell and settles the camera (`s.motion`),
  it never stops the scene. Escape stops it; nothing else does.
- Never a white screen: `js/fallback.js` paints one still, seeded frame of the
  same world when there is no WebGL, or when the context is lost and not given
  back.
- `World.value(name)` returns a **signed** fraction in `(-1, 1)`, not `[0, 1)`
  as its comment says: the `^` there yields a signed int32. Existing worlds are
  baked against that, so correcting it would change worlds people have links to
  — reach for `World.unit` when you want a plain fraction, or fold the result
  where you consume it, as `js/audio.js` does.

## The sound

- `js/audio.js` synthesises the whole soundscape from the same `s` the picture
  is drawn from; it owns its own lifecycle (first interaction, visibility,
  Escape) so `js/main.js` only builds it and calls `update`. It must stay
  optional: no Web Audio, or a refused context, changes nothing on screen.
  It reads the sea and the boat through `Sea.sample` and `Boat.sample`; if
  either changes shape, rewire it rather than muting it.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
