# `@keel-engine/world`

The world runtime: entities that move (a spec, a physics body, an animator),
objects that don't, rails, water, a camera, input and particles, held in one
place and stepped by **systems in a fixed order on a fixed step**; every
setting under **layers and locks**; generation through the settings (locked
items stay, the rest draw from their own streams without reshuffling);
**target rules** by picture size; a headless `frame()` for the renderer;
**snapshot / restore / record / replay**. Module `keel/world@0.1.0`
(`kind: "runtime"`, needs `keel/core`, `keel/physics`, `keel/camera`,
`keel/input`, `keel/particles`, `keel/object`, `keel/entity`, `keel/codec`). No DOM, no
renderer: `draw(renderer)` takes anything shaped like `@keel-engine/render`'s.

A TypeScript port of the proof of concept's `src/world` (and the piece of
`src/scene/config.js` it stands on); `docs/WORLD.md` there is the long guide.

```ts
import { createWorld } from "@keel-engine/world";

const world = createWorld({ seed: "7", width: 128, height: 128, config: { project: { "render.palette": "meadow" }, locks: "tag:animal/species=cat" }, materials, palettes });
world.generate((g) => { g.place("bench", { id: "bench-1", pos: [2, 0, 1], on: "auto" }); g.spawn({ id: "cat-1", kind: "animal", tags: ["animal"], brain: "wander" }); });
world.system("spin", { order: 650, step(w, dt) { /* ... */ } });
world.simulate(10);
const snap = world.snapshot(); world.restore(snap);   // exact: the next frames are the same frames
world.restoreBytes(world.snapshotBytes());             // the same, as codec bytes
world.draw(renderer);                                  // in a browser
```

| File | What |
| --- | --- |
| `world.ts` | `createWorld`, `tuningFor`, `SYSTEM_ORDER` (input 0, control 100, physics 200, animation 300, particles 400, camera 500, custom 600), `RENDER_BUDGET`, `RENDER_FX_NAMES` |
| `settings.ts` | `createSettings` (engine → project → scene → seed → seed:&lt;id&gt; → tag:&lt;t&gt; → id:&lt;id&gt; → runtime; the first lock wins over every later scope; `explain`, `propose`), `parseLocks` / `formatLocks` |
| `config.ts` | `layers`: the layered config with locks the scopes resolve through |
| `rules.ts` | `targetRules(w, h)` (screen, dither, ramp length, fov, arm, particle size ... by picture size), `RULE_KEYS`, `resolveRules` |
| `defaults.ts` | `ENGINE_DEFAULTS`: every setting the runtime reads |
| `streams.ts` | `namedStream` (core's streams, cursor in the open, so snapshots save it), `worldSeed` |

Tests: `test/world.test.ts` (the proof of concept's `tests/world.test.mjs`,
ported), `test/restore.test.ts` (restore is pixel-exact: mid-stride, mid-blend,
mid-fov-kick, frame shots, held clips, into a fresh world through JSON and
through the codec's bytes) and
`test/poc-equality.test.ts` (beside the proof of concept's world: settings,
streams and target rules over random operations; the test level at three
sizes, 48 checkpoints each, every snapshot field v1 carried and every frame
to the bit; a keyboard run recorded and replayed; generation under locks).
The garden's own tests are in `examples/garden/test`.

## Snapshots as bytes

`world.snapshotBytes()` writes `snapshot()` through the codec
(`@keel-engine/codec`'s `WORLD_SNAPSHOT`, `keel/world/snapshot`): settings
and entities typed, the free JSON (system state, minds, bodies, animators,
the camera) self-described with its keys through one table.
`world.restoreBytes(bytes)` is `restore()` from them, exactly as the JSON
path: the snapshot it restores is JSON-equal to the one written, and the
frames after it are the same frames, in the same world or a fresh one
(`test/restore.test.ts`). Bytes of another document, or cut short, are a
`TypeError` saying why, before anything is touched.

The test world (3 entities, 24-33 particles): 13.6-16 KB of JSON (4.3-5.1 KB
gzipped) against 4.3-5 KB of codec bytes (3.6-4.3 KB gzipped).

## Differences from the proof of concept (on purpose)

1. **The camera's subject is an entity's real height.** The proof of
   concept's world held every subject to at least 0.6 m (its camera started
   the arm at half the height: inside the floor's room for a cat). The camera
   package now starts a small subject's arm clear of the floor itself, so the
   workaround is gone: views of subjects under 0.6 m (chase, orbit) differ;
   0.6 m and up, and every frame shot (fitted to bounds), are the same. The
   simulation never reads the camera, so bodies and brains are unchanged.
2. **restore() is exact.** Animators, the camera (a blend in progress, the
   fov kick, `entering`/`fresh`, every rig's state) and particles are the
   engine's own and save/load themselves; the proof of concept restarted the
   animators and dropped the blend (its own copies of the particle pool and a
   camera field copier are gone).
3. **Snapshots are v2**: `camera` is the camera's saved state, each entity
   carries `anim` (and `heldKey`); everything v1 carried is the same, field
   for field. A v1 snapshot is refused.
4. `world.intent` before the first step, snapshots and events are the proof
   of concept's; the input device's own state (keys held) is still not in a
   snapshot (drive or replay for exact runs, as there).

## Still as the proof of concept had it

- `RENDER_BUDGET` and `RENDER_FX_NAMES` are kept here so the simulation never
  loads the renderer; a test holds them to `@keel-engine/render`'s.
- `g.place(..., { on })` places the settled object again with the yaw as
  given (the object package's moved copy wraps an already-wrapped yaw, a bit
  off): the same placements, to the bit.
- One dither screen per picture; `g.fits` is box against box.
