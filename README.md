# slowlight

An endless, self-sailing ocean, seen from just astern of the boat. She crosses
procedural water under a twenty-minute dusk-to-night-to-dawn sky, weather
drifting in and out. Land comes up over the horizon and she runs close past it,
near enough to see the trees on it and the water breaking on the sand. Whales
blow and sound and breach; dolphins come to the bow. Shoals work the surface
and open out ahead of her as she comes through them, and flying fish break off
a wave face and go back in. Kelp and driftwood go by, a raft of birds gets up
as she passes, a buoy leans in the swell, and there is often another sail a
long way off. She sails herself and runs until you stop her.

## Run it

From the repo root:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

That is the whole story - static files, no build step, no dependencies, no
network access at runtime. Any static file server works, and it will run from a
subpath too, since every asset path is relative.

## Keys

- **Left / Right** - turn her. She answers within a second, but the circle she
  turns in is wide and she leans into it; nothing here is quick.
- **Up / Down** - how hard she is sailing. More way on, or less.
- **Esc** - stops her, and anything at all sets her going again.

The swell has its own say in all of this: she gathers way running down the face
of a wave and loses it climbing the next, so her speed is never quite the speed
you asked for. She will not run aground either, whatever you do with the helm:
close in, the shore leans on it until she goes round.

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
current seed sits in the bottom-left corner - click it to copy the link.

## Sound

There is an ambient soundscape, and it is synthesised in the browser from the
same world state the picture is drawn from: the swell under the hull, the wind,
the rain when it turns, the hull working as the boat pitches, gulls as the
birds actually cross. Nothing is downloaded and nothing loops - like the sea it
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
browser takes the context away mid-voyage - a laptop closing its lid does
exactly that - it puts up one still frame of the same world at the same hour
rather than a blank page, and takes the sea back the moment it can - and, since there is no
voyage left to listen to, it does that in silence.

`prefers-reduced-motion` is honoured by calming the swell and settling the
camera, not by stopping the scene. It calms the sound the same way, rather than
silencing it.

A hidden tab goes quiet and lets its audio sleep, and Esc fades the sound out
with the picture.
