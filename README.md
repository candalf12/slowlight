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

## Notes

`prefers-reduced-motion` is honoured by calming the swell, not by stopping the
scene.
