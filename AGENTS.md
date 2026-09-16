# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## The scene

- Plain scripts on `window.SL`, loaded in order by `index.html`. No build step,
  no dependencies, no network at runtime, relative paths only, so it runs from
  a subpath. Serve it with any static server: `python3 -m http.server 8000`.
- The ocean is **not** 3D and has no camera. It is seven stacked parallax bands
  seen side-on, drawn far to near — see the header of `js/sea.js`. Depth is a
  continuous coordinate through that stack (`SL.SEA_DEPTH_*`, `s.boatLayerF`),
  which is how the boat moves in and out; `js/boat.js` explains its end of it.
- Everything is derived from the URL seed through `World.stream` /
  `World.value` / `World.cell` in `js/seed.js`, so a seed always gives the same
  world. Name a new stream rather than reusing one: adding a name never shifts
  the worlds that already exist.
- Nothing is retained between frames: waves, foam, wake and reflections are
  regenerated from world coordinates and `s.t` every frame. Keep it that way,
  and keep per-frame allocation out of the draw path.
- `prefers-reduced-motion` calms the swell (`s.motion`), it never stops the
  scene. Escape stops it; nothing else does.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
