# `@keel-engine/camera`

Cameras: a camera `{ eye, target, fov, yaw, pitch }` moved by rigs — `orbit`,
`chase`, `first`, `frame`, `rail`, `fixed` — with blends between them, shake,
a landing's nod, an fov kick, arm collision against the physics' solids, and
saved state. Module `keel/camera@0.1.0` (`kind: "runtime"`, needs
`keel/core@^0.1`, `keel/physics@^0.1`). No DOM.

```ts
import { createCamera, subjectOf, frameView, fovForTarget } from "@keel-engine/camera";
import type { Camera, Subject, CameraWorld, View, CameraState } from "@keel-engine/camera";
```

A TypeScript port of the proof of concept's `src/camera/camera.js`, names
unchanged, proven identical where the fixes below don't apply:

- `test/poc-equality.test.ts` — the helpers (`clearance`, `normalAt`,
  `sphereCast`, `armPath`, `alongPath`, `frameView`, `boundsOf`, rails
  scrubbed) over random worlds and inputs, and 48 long runs (72 000 steps)
  through random worlds of boxes (with floor planes and SDFs) in every mode —
  switches, blends, shake, thuds, fov kicks, target sizes, rig options, a custom
  rig — every camera field, every rig's own state, `view()` and `move()`, to the bit.
  (Gated: no wedges in those worlds, subjects 0.8 m and up.)
- `test/fixes.test.ts` — the fixes, each shown against the proof of concept.
- `test/camera.test.ts` — the proof of concept's `tests/camera.test.mjs`, ported
  (it drives the real body and the real input).

## Fixes (what differs from the proof of concept, on purpose)

1. **Wedges.** The arm (`clearance`, `normalAt`, `sphereCast`, `armPath`, every
   rig) collides with `solidDistance` over `world.boxes` and `world.wedges`: a
   wedge among the boxes is its slope, not its bounding box, and a wedge list is
   seen at all. *Changes outputs* only in worlds with wedges.
2. **Small subjects.** A rig's arm starts from the subject's middle, but never
   less than `radius + SKIN` over its feet (the proof of concept used half the
   height: under 0.4 m that start is inside the floor's room, so the sweep got
   nowhere and the eye sat in the floor). *Changes outputs* for subjects under 0.56 m.
3. **`save()` / `load()`.** The camera's private state — the blend in progress,
   the fov kick, `entering`/`fresh`, the nod spring, and every rig's own state
   (orbit pivot and arm spring, chase eye and look, frame turn, rail time) — as
   plain JSON (`CameraState`, `schema: "keel-camera@1"`). A camera made with the
   same options and loaded takes the very steps the saved one would have
   (tested mid-blend and mid-shake in every mode). Options are not saved. A
   custom rig joins by giving `save()`/`load()`.

## Subjects and worlds

A **subject** (`Subject`) is anything the camera watches:
`{ pos, yaw?, vel?, height?, radius?, mode?, wall?, bounds? }` (`pos` is its
feet; `yaw` its front, else its velocity's heading; `wall` a wall-run's normal;
`bounds` `[x0,y0,z0,x1,y1,z1]` or `{ min, max }` for `frame`). From a physics
body: `subjectOf(body, { height, radius })`.

A **world** (`CameraWorld`) is what the camera must not enter:
`{ boxes?, wedges?, floorY?, distance?(p) }` — the same solids the renderer
draws and `@keel-engine/physics` collides with.

## Rigs

Every rig is a `Rig<O>`: `{ name, opt, hidesSubject?, enter?(cam, subject, fresh), step(dt, subject, world, input, cam) -> { eye, target, fov? }, save?(), load?(state) }`.
Options per rig: `createCamera({ orbit: { distance: 4 }, chase: {...}, rail: { keys } })`,
or later through `cam.rigs.orbit.opt`. More rigs: `createCamera({ rigs: { name: rig } })`.

| Mode | For | Driven by | Key options (`*Options`) |
| --- | --- | --- | --- |
| `orbit` | the player's third person | `input.look` | `distance` 3.4, `above` 0.45, `pitch` −0.28, `minPitch` −1.2, `maxPitch` 0.55, `shoulder`, `follow`/`followY`, `recover`, `radius` 0.2, `recenter` |
| `chase` | attract mode / autopilot | the subject's heading and speed | `distance` 3, `height` 1.5, `lookAhead` 1.4, `lead` 0.12, `turn` + `turnBySpeed`, `swing` 1.5, `unblock` 4 |
| `first` | first person (`hidesSubject`) | `input.look` | `eyeHeight` 0.88, pitch limits ±1.45 |
| `frame` | showcase stills and turntables: the subject's FRONT, its bounds fitted | `input.look[0]` spins it | `turn` 0.45, `elevation` 0.14, `spin`, `fill`, `pixels`, `rate`, `front`, `collide` |
| `rail` | scripted flythroughs | time | `keys: RailKey[]` (`{ at, eye, target?, fov? }`), `loop`, `speed`, `period`; `rig.at(t, subject)` scrubs |
| `fixed` | a security camera | — | `eye`, `target?` |

**Collision** (orbit, chase, frame): the arm is sphere-cast (radius 0.2) from a
pivot over the subject's head out to where the eye wants to be; a wall pulls
the eye in at once, and it springs back out (critically damped). Against a
ceiling or floor the arm slides along it (`armPath`). The eye is never inside
a solid. When it ends up in the subject's face, `cam.hidesSubject` is true.

**Frame fitting** (`frameView`) is solved, not searched: every corner of the
bounds lands inside `fill` of the picture at this fov and aspect.

## The camera

```ts
const cam = createCamera({ mode: "orbit", width: 128, height: 128, fovKick: 0.06 });
cam.setMode("chase", { blend: 0.3 });  // eye/target/fov blend (smoothstep)
cam.step(dt, subject, world, input);   // each FIXED step
cam.shake(0.3); cam.thud(0.06);        // trauma (fades) / a landing's nod
cam.setTarget(w, h);                   // fov = fovForTarget(w, h) unless `fov` was fixed
px.render({ ...cam.view(), time });    // eye, target, fov (shake and nod turn the view, never move the eye)
const saved = cam.save(); cam.load(saved);
```

`cam.yaw` / `cam.pitch` are always those of what is on the screen, so
`cam.move(forward, strafe)` (W is forward along the camera's yaw) follows the
picture even mid-blend. `fovForTarget(w, h) = 1.15 · clamp((min(w,h)/128)^0.3, 0.6, 1)`;
`fillForTarget` grows the framed share at small targets. Deterministic: every
rig eases with `1 − e^(−rate·dt)`; shake is fixed sines of the camera's own clock.

## Changes needed elsewhere

`test/camera.test.ts` imports `@keel-engine/input` by path
(`../../input/src/index.ts`): input is not one of camera's dependencies. Add
`"@keel-engine/input": "workspace:*"` to camera's `devDependencies` (and
`pnpm install`) to import it by name.
