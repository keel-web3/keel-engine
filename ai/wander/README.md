# `ai/wander` (`@keel-engine/wander`)

One animal on its own: meander (a heading drifting by a seeded jitter), stand
and look about, sit, get up -- each for a seeded time -- keep off obstacles,
other animals and the pen's edge, and bolt from a threat until clear of it a
moment. Module `ai/wander@1.0.0` (`kind: "ai"`), needs `keel/core@^0.1`
and **`contract:body/quadruped@^1`**; **provides** `ai/animal@1.0.0`.

```ts
import { createBrain, paramsFor } from "@keel-engine/wander";
const brain = createBrain(seed, paramsFor(entity.sockets(spec)));   // speeds scaled to the body
agent = brain.step(agent, world);          // once per fixed step (params.dt, default 1/30 s)
brain.save() / createBrain(seed).load(saved)   // JSON-safe; continues bit-identical
```

- **Agent** `{ id, pos, vel, facing, mode }` -- core frame, `facing` is the yaw
  (`atan2(dx, dz)`), so it feeds a physics body or keel/entity's animator
  directly. Moves x/z only. `mode`: `idle walk run sit flee` (a game maps it
  to clips: sit -> `anim.hold("sit")`, the rest by speed).
- **WorldQuery** `{ neighbours(pos, r), obstacles: [{ pos, r }], bounds?: [x0, z0, x1, z1], threat? }`.
- **Pure**: `stepWander(agent, world, params, memory, draw)` returns the next
  agent and memory; `createBrain` only holds the memory. Random draws are
  core's roll at `0x100 + n`, `n` counted in the memory.
- **Bound by contract**: `paramsFor(sockets)` reads only what
  body/quadruped promises (the back socket's depth is 0.6 of the body's length),
  and `setup(ctx)` records the packs providing body/quadruped (`drives()`).
- The module's exports are the contract's face: `contract`, `id`, `social:
  false`, `defaults`, `createBrain`, `paramsFor` (also as `ai`).

`src/contract.ts` and `src/steer.ts` are the same files as ai/herd's (a
contract's types want a home of their own -- see the handover).

Tests: `node --test ai/wander/test/*.test.ts` -- determinism (and seed
sensitivity), save/JSON/load continuity, speeds <= walk without a threat and
<= run with one, pen and obstacles hold, walk/idle/sit each seen (sitting
still), flee (straight away, faces away, calms after), params scale with the
body (bear vs mouse), setup's binding, the bundle (reaches only keel/core; on a
page it finds packs/animals by contract).
