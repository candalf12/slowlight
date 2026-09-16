# slowlight

An endless, self-sailing ocean, seen from just astern of the boat. She crosses
procedural water under a twenty-minute dusk-to-night-to-dawn sky, weather
drifting in and out, islands passing, birds now and then. She sails herself and
runs until you stop her.

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

- **← / →** — turn her. The circle is wide and she leans into it; nothing here
  is quick.
- **↑ / ↓** — how hard she is sailing. More way on, or less.
- **Esc** — stops it. Closing the tab stops it. Nothing else does.

The water is open in every direction and there is nowhere in particular to go.
All of it is optional: let go and she settles back to sailing herself, on her
own course and her own water; steering is never required and never needed.

## Seeds

The world is seeded from the URL:

```
http://localhost:8000/?seed=driftwood
```

The same seed always gives the same world and starts her in the same place, on
the same point of sail; a different seed sets out from different water, at a
different hour, past different land. With no seed in the URL one is picked and
written back, so you can always return to the world you were watching. The
current seed sits in the bottom-left corner — click it to copy the link.

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

The scene is drawn with WebGL, written by hand: no library, no build step, and
nothing fetched while it runs. Where there is no WebGL to sail on, or the
browser takes the context away mid-voyage, it puts up one still frame of the
same world at the same hour rather than a blank page — and, since there is no
voyage left to listen to, it does that in silence.

`prefers-reduced-motion` is honoured by calming the swell and settling the
camera, not by stopping the scene. It calms the sound the same way, rather than
silencing it.

A hidden tab goes quiet and lets its audio sleep, and Esc fades the sound out
with the picture.
