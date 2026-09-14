# `@keel-engine/view`

How a game is seen: an **overview** that zooms continuously from the whole map
down to one unit's buttons, a **chase** camera behind a possessed unit and a
**first-person** view from its eyes, and the eased moves between them -- all
pixel art. Module `keel/view@0.1.0` (`kind: "runtime"`, needs `keel/core@^0.1`,
`keel/camera@^0.1`, `keel/terrain@^0.1`, `keel/render@^0.1`). No DOM, no GL: it
decides what to draw; the game draws it (the overview on keel/bake's sprite
renderer, the perspective views on keel/render's raster mode).

```ts
import { createViewModes, createZoom, zoomLadder, createCommandStream, sampleCommand, stepPossessed, terrainChunkMesh, terrainDistance } from "@keel-engine/view";

const zoom = createZoom({ ladder: zoomLadder(2, 128), k: 8, buckets: [{ upTo: 16, pitch: 0.72 }, { upTo: Infinity, pitch: 0.5 }] });
const modes = createViewModes({ zoom, center: [x, 0, z], picture: [480, 270], world: { distance: terrainDistance(terrain) } });
modes.possess(unit, subject);      // F on a selected unit
modes.toggleFirstPerson();         // V
modes.release();                   // Esc
// each frame:
const f = modes.step(dt, subject, { look: [dx, dy] });
if (f.shot.kind === "ortho") drawOverview(f.shot); else drawPerspective(f.shot);   // f.blend: a second shot, dissolved in
```

That's all a game needs for the modes. `examples/level-demo` (in the KEEL SDK)
is the whole thing wired up: a generated valley, 2,000 walkers, all three views.

## Why a package of its own

The modes are glue between parts that each stay what they are: the camera's
rigs (`keel/camera`: orbit for the chase, first for first person, their
blends and arm collision), the terrain's public data (`keel/terrain`), the
renderer's raster mode (`keel/render`) and the bake's streams and billboards
(`keel/bake`). Put in any one of them, it would drag the others in; here it
depends on them, and they gain only small additive options (below). An RTS
imports `createViewModes` and gets deep zoom and hero control; a game with its
own camera takes just the zoom, the command stream or the terrain mesh.

## The parts

| file | what |
| --- | --- |
| `zoom.ts` | `zoomLadder(min, max, perOctave)` (2..128 px/m, a rung a quarter octave: 25 rungs), `createZoom({ ladder, k, buckets, hysteresis, rate })`: the drawn scale eases in log space toward a target that is always a rung, and **lands exactly on it** (sprites then bake texel for pixel); pitch **buckets** with a hysteresis band |
| `lod.ts` | `spriteLod(px)` (dot / far / near by picture pixels tall), `perspectiveScale(z, fov, H)`, `bakedScale(ladder, k)`, `solidBandFor(height, fov, H)` and `solidShare(d, band)` -- the dithered sprite/solid switch |
| `possess.ts` | the **command stream**: `commandOf`, `sampleCommand` (keys + camera yaw -> a world move, a facing, action bits), `encodeCommands` / `decodeCommands` (13 bytes each), `createCommandStream({ delay })`, `stepPossessed(state, command, dt, rules)` |
| `modes.ts` | `createViewModes(...)`: overview / glide / swap / dolly / chase / fps and back; `matchingPersp(ortho, H, D)`, `dollyShot(a, b, t)` |
| `terrain-mesh.ts` | `terrainChunkMesh(t, chunk, { material })` / `terrainRectMesh`: tops (ramps sloped), cliff faces, water, a skirt at the map's edge -- keel/render's `RasterMesh`; `terrainDistance(t)` for the camera's arm |
| `solids.ts` | `pushWorld(solids, world, { pos, yaw, scale, mat, look })`: a design's boxes, wedges and capsules into keel/render's `RasterSolids`; `worldExtent` |

## Deep zoom

- **Continuous**: the wheel moves the target a rung (x 2^(1/4)); the drawn scale eases to it (rate 14/s in log space,
  so 4 -> 8 takes as long as 64 -> 128). While it moves, sprites draw from the nearest baked scale at their per-instance
  scale; settled, it is a rung and the stream bakes that rung exactly (debounced: a wheel through five rungs bakes one).
- **Crisp**: the picture is a low-res target (480 x 270 by default) scaled up pixel for pixel by CSS; nothing is ever
  filtered. The ground's chunk layers bake up to 32 px/m (a chunk at 64 px/m took 6 s and 24 MB) and are drawn scaled
  closer in; trees and props bake up to 48 px/m (bake's new `maxScale`); units bake at every rung to 128.
- **Detail, not just bigger pixels**: the level demo's three sprite streams are three LOD bands -- far (steep 0.72 pitch,
  8 directions; a unit under 10 px is its body only), near (0.5 pitch, 16 directions, every clip including keel/entity's
  new attack, everything worn), eye (0.14 pitch, 16 directions, for perspective billboards). A tree in front of the
  middle of the picture is cut away past 40 px/m.
- **Tactical tilt**: past 16 px/m (x 1.12 hysteresis) the pitch goes from 0.72 to 0.5 -- a bucket, so its own bake; the
  next bucket's ground is baked ahead as the zoom nears the edge.

## Possession, and what an RTS takes from it

```ts
const cmds = createCommandStream({ delay: 0 });          // lockstep: delay = input delay in ticks
each frame:  cmds.push(sampleCommand(tick, unit, { forward, strafe, act, facing: fps ? "camera" : "move" }, camYaw, unitYaw));
each tick:   units.step(DT, cmds.take(tick));            // the possessed unit: stepPossessed(driven, command, DT, { walk, run, turn, move })
```

- A command is `{ tick, unit, mx, mz (int8), face (uint16 of a turn), act (bits: attack, use, run, jump, possess, release) }`
  -- 13 bytes. What's quantised is what's simulated, so a sender and every receiver agree bit for bit. The camera, the
  frame rate and the mouse never reach the simulation: only commands do.
- **Lockstep-ready**: each peer samples its hero's command for tick T and sends it; every peer applies commands
  scheduled for T at T (`createCommandStream({ delay })` schedules a sampled command `delay` ticks later -- the input
  delay that hides the network); the unit's AI is suspended for exactly the ticks it's possessed, which is itself a
  command (`ACT.possess` / `ACT.release`), so a hero changes hands on the same tick everywhere. Tested: a scripted run
  and its encoded-then-decoded replay are identical, and an input delay only shifts it.
- `stepPossessed` moves through the game's own ground rule (`move(x, z, nx, nz)` -- the level demo's never steps off a
  cliff), turns at `turn` rad/s toward the command's facing, plants the unit for an attack's 0.62 s.

**For keel-rts:** take `createCommandStream` + `stepPossessed` as the hero path (the sim already runs 20 Hz fixed
steps; a hero's command replaces its flow-field step for the ticks it's held); take `createViewModes` for the camera
(its overview is the RTS camera; possession gives the chase and first person for free); take the zoom ladder with
`maxScale` on props and `upscale: 3` on bodies, and bake's incremental resolve (already in `createSpriteStream`) --
the big win for a 16-direction close zoom.

## The perspective views

A chase or first-person picture is drawn by the game on keel/render's **raster mode** (see its README): the terrain as
`terrainChunkMesh` meshes (uploaded once), houses, trees and near units as instanced `RasterSolids`, far units and trees
as keel/bake **billboards** hidden by the depth `render({ depthOut })` leaves. `solidShare(d, band)` gives each thing
both a solid share and a sprite dissolve share -- complementary on a 4x4 Bayer screen -- so the switch between them is a
dither, never a pop.

The move overview -> chase is solved rather than cut: the overview **glides** onto the unit (keeping its pitch bucket,
landing its zoom at 40 px/m), a perspective camera 60 m off with the fov that frames the same height (`matchingPersp`:
within 2 px of the orthographic picture round its middle) is **dissolved in** over 0.14 s, then **dollies** in: its
distance falls in log steps while its fov widens so the framed height changes one way only (`dollyShot`), its heading
and pitch turning round behind the unit. Release plays it backwards to the overview as it was.

## Tests

`test/view.test.ts` (14): the ladder; the zoom easing and landing on a rung; pitch buckets and hysteresis; the whole mode
machine there and back (phases, which path draws, the swap's two shots, the eye height, the overview restored); the
matching camera within 2.5 px; the dolly's ends and one-way framing; commands quantised and round-tripped through 13
bytes; sampling (W along the camera, facing rules); **command-stream determinism** (400 scripted ticks: the same run, the
same through the wire, an input delay only shifting it; an attack plants the unit); the stream's per-tick ordering; flat
chunk vertex counts and skirts; **seams** (every chunk's triangles together are exactly the whole map's, on a bumpy map
with ramps and water); cliff faces on the high side facing out; ramps sloped; LOD thresholds and the complementary
dissolve.
