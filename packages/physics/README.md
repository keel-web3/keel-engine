# `@keel-engine/physics`

The character body: kinematic, stepped at a fixed rate (WALLRUN: 120 Hz),
colliding with the same solids the renderer draws -- turned boxes and wedges
-- plus rails to grind and water to skim. Module `keel/physics@0.1.0`
(`kind: "runtime"`, needs `keel/core@^0.1`). No DOM; deterministic to the bit
(same inputs, same run, on every machine).

```ts
import { createCharacter, TUNING, boxDistance, wedgeDistance, solidDistance } from "@keel-engine/physics";
import type { Character, BodyEvent, BodyInput, Box, Wedge, Rail } from "@keel-engine/physics";
```

A TypeScript port of the proof of concept's `src/physics/character.js`
(`../keel-pixel-engine`), names unchanged, proven identical:

- `test/golden.test.ts` — the proof of concept's pinned runs (a course, three
  yard wanders, a skim): the TypeScript body makes **the same SHA-256
  fingerprints**, byte for byte (`test/fixtures.ts` holds the worlds, pilots and pins).
- `test/poc-equality.test.ts` — both bodies stepped side by side, every field
  after every step (position, velocity, mode, facing, timers, wall, rail,
  slope, checkpoint, every event and its payload), over the golden runs, six
  yard wanders and 60 random worlds of boxes, wedges (in both lists), rails
  and water with random input streams and tuning; and every solid's distance
  over 20 000 random points.
- `test/physics.test.ts` — the proof of concept's `tests/physics.test.mjs` (and
  the physics part of `tests/frame.test.mjs`), ported.
- WALLRUN's course (the autopilot over 200 seeds, beside the proof of
  concept's `sim.js`) is the example's own test now: `examples/wallrun/test/`.

A test whose reference isn't on the machine is skipped (`KEEL_POC=path`).

| Module | What |
| --- | --- |
| `solids.ts` | `boxDistance`, `wedgeDistance`, `solidDistance`, `wedgeSection`, `slopeOf`, `isWedge`, `nearestOnRail` |
| `character.ts` | `createCharacter`, `TUNING`, `BODY_MODES`, `BODY_EVENTS` |

## The convention

The core frame, as everywhere: +y up; a solid's own frame +z front, +x right;
`yaw` turns it about +y, world -> local `x' = c·x − s·z, z' = s·x + c·z`
(`c = cos yaw, s = sin yaw`). A box's local +z face looks along `frontOf(yaw)`.

## Solids

| Type | Shape |
| --- | --- |
| `Box` | `{ c, h, yaw?, mat?, kind? }` — half extents, turned about y |
| `Wedge` | `{ kind: "wedge", c, h, yaw?, lo?, mat? }` — a ramp |
| `Solid` | `Box \| Wedge` (dispatch on `kind`) |
| `Hit` | `{ d, n }` — signed distance and the outward normal |
| `Rail` / `RailPoint` | a polyline `[[x, y, z], ...]` / `{ d, i, t, q, tan, segLen }` |

**A wedge** is a box whose top slopes: its foot at local **+z** (height `lo x 2hy`,
0 by default: a knife edge), rising to full height at local **−z**. Its slope
looks along `frontOf(yaw)` (the catalogue's ramps face the same way);
`slopeOf(w) = atan(2hy(1 − lo) / 2hz)`. `wedgeDistance` is exact inside and out.

## `createCharacter`

```ts
const body = createCharacter({ boxes, wedges, rails, waterY, spawn, tuning });
body.step(1 / 120, { move: [x, z], jump: pressedThisStep, hold: jumpHeld });
body.pos, body.vel, body.mode, body.facing, body.events, body.slope, body.checkpoint
```

- `boxes` — solids; a box with `kind: "wedge"` is taken as a wedge (one list feeds physics and the renderer).
- `move` — a horizontal world direction, length <= 1: `moveFromView(cam.yaw, forward, strafe)`
  (core), `cam.move(f, s)`, or an input sample (`@keel-engine/input`'s `Intent` is a `BodyInput`).
- `jump` — the press (an edge); `hold` — whether it's held (variable jump height).

**Modes** (`BodyMode`): `ground air wall grind skim sink`. **Events** (`BodyEvent`,
this step only) are a discriminated union on `type`, each with `at` (the position):

| type | payload |
| --- | --- |
| `landed` | `speed` (how fast it fell) |
| `wallStart`, `wallRunning`, `wallJump` | `n` (the wall's normal) |
| `grinding` | `tan` (the way along the rail) |
| `jumped`, `wallEnd`, `railStart`, `railEnd`, `skimStart`, `skimming`, `splashIn`, `respawn` | — |

```ts
for (const e of body.events) if (e.type === "landed") cam.thud(e.speed / 12 * 0.05);   // e.speed: number
```

### The rules (and what the tests hold them to)

| Move | Rule | Tuning |
| --- | --- | --- |
| jump | rises `jump² / 2g` (1.54 m) held; let go early and the rise has 2.4 g against it; a running jump carries run speed × `2 jump / g` (6.8 m) | `jump 8.6`, `gravity 24`, `runSpeed 9.5` |
| coyote time | a jump just after running off an edge still counts | `coyote 0.1` s |
| jump buffer | a jump pressed just before landing fires on landing | `buffer 0.12` s |
| wall-run | in the air, faster than `wallMin`, going along a wall that rises past the head, on one of its faces: light gravity, speed kept along the face; ends after `wallTime`, when slow, or when the face runs out — never wraps round a wall's end; a floor's edge is a step; a wedge is never a wall | `wallMin 4.5`, `wallGravity 0.16`, `wallTime 1.35` |
| wall kick | jump on a wall: `wallKick` off the face and `wallUp` up | `wallKick 7.5`, `wallUp 7.4` |
| rail | falling onto a rail (within `railSnap`) catches it, pushed on by `railPush` but never past `railMax`; downhill speeds it, uphill slows it, it settles toward `railCruise`; it leaves at the end with a little lift, or on a jump | `railSnap 0.45`, `railLift 0.28`, `railPush 3`, `railCruise 11`, `railMax 14` |
| water | at or below `waterY`: faster than `skimMin` it skims (drag `skimDrag`), slower it sinks | `skimMin 6.5`, `skimDrag 1.4` |
| respawn | a sinking body comes back at its checkpoint after `respawn` s | `respawn 0.9` |
| slopes | up to `slopeMax` it stands on a wedge and runs up and down it; steeper, it slides; over a crest it keeps its feet (steps down within `stepDown`) | `slopeMax 42`°, `stepDown 0.3` m |
| falling | never faster than `maxFall` (radius × 120 Hz: no slab is fallen through) | `maxFall 30` |
| collision | three spheres (radius 0.26 at 0.26 / 0.56 / 0.86 m) pushed out of every solid; only the into-the-wall part of the velocity is taken | `radius 0.26` |

`tuning` overrides any of `TUNING` (frozen here; the proof of concept's was a
plain object) for one body. A boxes-only world never runs the wedge code.

## Not here

- Solids turn about y only; a slope is a wedge. Wedges are not wall-run surfaces.
- No save/load of a body: its state is its plain fields (copy them).
- The body's `step` is the only method; `BodyInput` fields are all optional
  (`{}` is standing still).
