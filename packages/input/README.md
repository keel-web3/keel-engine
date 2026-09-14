# `@keel-engine/input`

Devices in, intents out: the keyboard (WASD or arrows, space to jump — hold it
to go higher — shift to sprint), the mouse under Pointer Lock, a gamepad and
touch, all taken once per fixed simulation step as the same `Intent`; and the
arbiter that decides who is driving, the player or the autopilot. Module
`keel/input@0.1.0` (`kind: "runtime"`, needs `keel/core@^0.1`). No DOM in the
core; `attach` is the only part that touches a browser.

```ts
import { createInput, createArbiter, codeOf, GAME_KEYS } from "@keel-engine/input";
import type { Input, Intent, InputOptions, Driver, PadState } from "@keel-engine/input";
```

A TypeScript port of the proof of concept's `src/input/input.js`, names
unchanged, proven identical:

- `test/poc-equality.test.ts` — the same scripted event sequences into both
  (keys by name, code and event, with modifiers, repeats and shortcuts; mouse,
  touch drags, sticks, taps, gamepads, blur) over 200 seeds × 600 steps, and
  through `attach()` the DOM-shaped events (keys, clicks and the lock, mouse,
  touches, pads, blur, visibility) over 40 seeds — every sample to the bit;
  `codeOf` for every name × code; the arbiter over 50 runs.
- `test/input.test.ts` — the proof of concept's `tests/input.test.mjs`, ported,
  plus touch through `attach`.

## Intents

```ts
const input = createInput({ sensitivity: 0.0025, invertY: false, idle: 6 });
const detach = input.attach(window, { canvas });   // click the canvas = pointer lock; Esc releases
const it = input.sample(STEP, cam.yaw);             // once per fixed step
body.step(STEP, it.player ? it : autopilot());
```

`Intent`: `{ move: [x, z], axes: [strafe, fwd], look: [dyaw, dpitch], jump, hold, sprint, driver, player }`

- `move` — a world direction on the ground, camera-relative (`moveFromView`):
  W is forward along the view's yaw, D the screen's right.
- `look` — radians this step: + yaw turns the view to the screen's right, + pitch looks up.
- `jump` — pressed since the last step (latched: a tap between steps counts);
  `hold` — held (the body cuts short hops without it).
- An `Intent` is a `@keel-engine/physics` `BodyInput` and a `@keel-engine/camera` `LookInput`.

| Device | How |
| --- | --- |
| keyboard | by `KeyboardEvent.code` (WASD by place, any layout) and arrows; `input.key("w", true)` / `input.key(event, down)` |
| mouse | `movementX/Y × sensitivity` while locked; without the lock, drag on the canvas; one event clamped to `maxMouse` px |
| gamepad | standard mapping, polled in `sample`: left stick moves, right stick looks at `lookSpeed` rad/s, A (0) jumps, L3/RB sprint; round dead zone; `input.pad({ axes, buttons })` |
| touch | left half of the canvas a stick (`touchRadius` px), right half drags to look, a quick tap there jumps |

**Only game keys count.** Meta/Ctrl/Alt/CapsLock, or any key pressed with Meta,
Ctrl or Alt held, neither move nor take over; a modifier going down releases
held keys (their key-ups may never come after Cmd+Tab); so does window blur.
Shift alone takes nothing over. Typing in an `<input>` is ignored.

**Who's driving** (`createArbiter({ idle, start })`): `"autopilot"` until real
input, then `"player"` until `idle` seconds of nothing (`Infinity`: never give
it back). `input.arbiter.takeOver()` / `giveBack()`.

`attach(target, { canvas, lock, touch, document, navigator })` takes
structural DOM shapes (`EventTargetLike`, `DocumentLike`, `CanvasLike`,
`NavigatorLike`), so tests hand it plain `EventTarget`s. It asks for
`{ unadjustedMovement: true }` and falls back to a plain lock, then to
drag-to-look. Returns `detach()`.
