# slowlight

An endless, self-sailing ocean. A small boat crosses procedural water under a
twenty-minute dusk-to-night-to-dawn sky, weather drifting in and out, islands
passing, birds now and then. It sails itself and runs until you stop it.

## Run it

From the repo root:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

That is the whole story — static files, no build step, no dependencies, no
network access at runtime. Any static file server works, and it will run from a
subpath too, since every asset path is relative.

## Keys

- **← / →** — take the boat across the water, and heel it as it turns.
- **↑ / ↓** — take it further out or nearer in. It slides through the swells,
  smaller and hazier toward the horizon, larger and closer at hand, and the
  waves in front of it pass between you and the hull.
- **Esc** — stops it. Closing the tab stops it. Nothing else does.

All of it is optional. Let go and the boat settles back to sailing itself, on
its own course and its own water; steering is never required and never needed.

## Seeds

The world is seeded from the URL:

```
http://localhost:8000/?seed=driftwood
```

The same seed always gives the same world and starts the boat in the same
place, at the same distance out; a different seed sets out from different
water, at a different hour, past different land. With no seed in the URL one
is picked and written back, so you can always return to the world you were
watching. The current seed sits in
the bottom-left corner — click it to copy the link.

## Sound

There is an ambient soundscape, and it is synthesised in the browser from the
same world state the picture is drawn from: the swell under the hull, the wind,
the rain when it turns, the hull working as the boat pitches, gulls as the
birds actually cross. Nothing is downloaded and nothing loops — like the sea it
describes, it never comes round again. The seed picks its voice the way it
picks the colours, so a world always sounds like itself.

It starts low and arrives out of silence, and only once you have touched the
page, since browsers hold sound until then. The control sits in the
bottom-right corner, opposite the seed: click it to mute, hover or tab to it
for the volume. Your choice is remembered.

Sound is an addition to this, never a requirement of it. A browser without Web
Audio, or one that refuses to start it, watches exactly the same scene.

## Notes

`prefers-reduced-motion` is honoured by calming the swell, not by stopping the
scene. It calms the sound the same way, rather than silencing it.

A hidden tab goes quiet and lets its audio sleep, and Esc fades the sound out
with the picture.
