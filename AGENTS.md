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
  outward - see the header of `js/sea.js`. It fogs to exactly the sky's horizon
  colour, so it has no edge to find. Wave height is a pure function of world
  position and `s.t`, evaluated in the vertex shader for the picture and
  mirrored on the CPU by `Sea.sample` for the boat, the camera and the wake:
  change one and you must change the other, or the boat floats on water that is
  not the water being drawn.
- World coordinates are unbounded and float32 is not. Everything handed to the
  GPU is in a local frame rebased near the boat (`s.orgX/orgZ`, `Scene.rebase`),
  and each wave's share of that origin is folded into its phase in double
  precision. Anything that lives in the local frame - the camera, the boat's
  path, the birds - has to be shifted when the origin moves.
- Everything is derived from the URL seed through `World.stream` / `World.value`
  / `World.cell` / `World.cell2` in `js/seed.js`, so a seed always gives the
  same world. Name a new stream rather than reusing one: adding a name never
  shifts the worlds that already exist.
- Nothing is retained between frames except the boat's own path, a fixed ring
  the wake is drawn along so the foam can curve when she does. Waves, foam,
  reflections, surf and rain are all regenerated from world coordinates and
  `s.t` every frame. Keep it that way, and keep per-frame allocation out of the
  draw path - `js/batch.js` is the one dynamic buffer and it is written in
  place.
- `Batch.quad` cuts its four corners into two triangles on one diagonal. Give
  it corners that are not a parallelogram *and* a UV that varies along both
  axes and the two halves get different maps, so the soft round dot tears along
  that diagonal into a hard straight edge. Either keep such quads
  parallelograms, hold one UV axis constant along their length as the wake
  ribbons do, or use `Batch.billboard`.
- The sea settles the far water flat so it cannot crawl at the horizon, and
  `Sea.sample` leaves that falloff out because it is ~1 wherever the boat, the
  camera and the wake read. Anything floating further out must apply it through
  `Sea.settleAt`, or it sits under the water being drawn. That curve lives in
  `js/sea.js` and the vertex shader is built from the same constants; do not
  keep a second copy of it anywhere.
- Her speed is not the speed you asked for: `Scene.helm` feeds the slope under
  her hull back into it, so she gathers way down a swell and loses it climbing
  the next. The gain is set against the measured distribution of that slope,
  not by eye - remeasure before changing it.
- `prefers-reduced-motion` calms the swell and settles the camera (`s.motion`),
  it never stops the scene. Escape stops her, and any key or click starts her
  again; a lost context is waited for rather than given up on, because a laptop
  that slept all evening is the ordinary case.
- Never a white screen: `js/fallback.js` paints one still, seeded frame of the
  same world when there is no WebGL, or when the context is lost and not given
  back.
- `World.value(name)` returns a **signed** fraction in `(-1, 1)`, not `[0, 1)`
  as its comment says: the `^` there yields a signed int32. Existing worlds are
  baked against that, so correcting it would change worlds people have links to
  - reach for `World.unit` when you want a plain fraction, or fold the result
  where you consume it, as `js/audio.js` does.

## The land, and what floats

- `js/islands.js` owns every shape that is not water: the ground, the trees on
  it, and the arch. One blob profile makes all five forms - the mass carries
  the peaks, the apron outside it carries the beach, and what is left falls
  away underwater. Read its header before changing any of those numbers.
- How much land there is comes from two numbers and nothing else: `CELL` and
  the `exists` threshold in `plan`. How *varied* it is comes from `bulk`, which
  is the size of a site, not the number of them: most seeds get the island this
  scene has always drawn, some get a rock, and one in seven gets a proper piece
  of country. Reach for `bulk` before reaching for the density - a fuller sea
  made of one repeated island is worse than an emptier one. Two things do not
  follow the size, and should not: a stack (a rock twice the width of the
  biggest island is a monolith) and the beach (`BEACH_R`, or a big island
  arrives wearing half a kilometre of sand).
- A blob's mesh, and its ring of surf, are sized from its own `R` rather than
  fixed, so one shape at many sizes stays about as fine underfoot on all of
  them. Sites are planned out to `REACH + SPAN` and kept by where their shore
  is, not their middle, so a big place is in hand long before any part of it
  could be drawn - land has to come out of the haze, never appear in it.
- Where a shore actually is, is measured once per blob at plan time and kept in
  a table (`measureShore` / `shoreAt`). The surf, the trees and the helm all
  read it. Do not re-derive a waterline from a radius; the apron has a roll of
  its own and the answer is not a circle.
- Land talks to the helm twice, and the two must stay separate. `Islands.avoid`
  is the lean: a long, gentle one that fires only when her present course would
  pass inside a shore, and a short one in the last thirty metres that carries a
  true outward heading. Steering a tangent out of a shoal produces an orbit,
  not an escape, and that is how a boat ends up parked inside a hill. A hand on
  the helm out-votes the long lean (`HAND` in `js/scene.js`), because sailing
  close in is the point of having beaches.
- `Islands.hold` is the other one, and it is not a lean: `Scene.helm` offers it
  every step before taking it, and a step that would cross a measured waterline
  comes back turned along the shore, or out to sea, or not at all. One rule -
  end with her keel's worth of water, or with half a step more than you began
  with, whichever is the smaller ask - and she starts her voyage in open water
  (`Scene.offing`), so she is never anywhere else. Open `test/aground.html`
  over a static server after touching either of them: it sails her at land from
  every bearing for a few minutes and says PASS or FAIL. It is seconds, not the
  twelve-hour soak the PR history mentions, which is no longer asked for.
- `SL.settleAfloat` exists because `Sea.heightAt` reports the swell *without*
  the distance falloff the sea's vertex shader settles the far water with, so
  anything laid on the sampled height a few hundred metres out sinks under the
  water it is meant to be floating on. Everything of ours that floats goes
  through it. If `Sea` ever offers this itself, delete it and use that.
- The eye is four metres above the water. Anything drawn as a horizontal quad
  is therefore seen at about five degrees and is a smear: `js/flotsam.js` draws
  every drifting thing as a billboard that sits in the water and leans with it,
  and the same goes for anything else on the surface.
- `js/life.js` owns the whales and the dolphins. They are rare on purpose and
  slow on purpose; `scene.life.event` says what is happening and where, for
  whoever wires the sound.

## The boat

- `js/boat.js` owns her hull, her rig, the wake, the water she breaks and what
  she throws. She is built once as a parametric mesh and only ever moved;
  nothing about her is animated on its own clock. Each surface tells the shader
  what its own coordinate means - the hull sends its drop below the sheer, the
  deck how deep into the cockpit it has dipped - so a painted line or a shadow
  needs no geometry to carry it.
- Her wire is not mesh. A shroud is centimetres thick and a cylinder that thin
  falls between two pixels and flickers, so the standing and running rigging is
  drawn in the blended pass as ribbons turned to face the eye and measured in
  pixels rather than metres. `Boat.drawWake` is where they go in, last, after
  the foam; `js/scene.js` owns when that is called.
- Her paint is the hour's own water put at her tone and then turned about the
  grey axis, which is `SL.waterCharacter`'s move on the sea and obeys the same
  rule: the seed moves chroma, the hour keeps luminance. Turn her *after* she
  is at her tone, not before, or a nearly black hull comes out lurid.
- She must stay a silhouette at night. Any change to her colour wants measuring
  at both ends of the cycle, not only in daylight: sail against the water
  beside her is the number that has been argued over most.

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
