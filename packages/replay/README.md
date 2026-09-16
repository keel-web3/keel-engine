# @keel-engine/replay

Runs that prove themselves. A deterministic simulation records its **input
tape** (one 32-bit word per tick, run-length coded) with **checksums** every
`every` ticks and a **transcript** hash chain (SHA-256, codec's) over the
header, the checkpoints and the inputs between them. A verifier replays the
payload from its header and **derives** the result: a score is never trusted,
and a replay that leaves the recording names the first checkpoint it missed.

```ts
import { createRecorder, verifyRun } from "@keel/game-engine/replay";

const rec = createRecorder(createRun(header), { header, every: 120, onCheckpoint: stream });
while (playing) rec.step(held ? 1 : 0);   // each fixed step
const payload = rec.finish();             // keel-run@1: header, ticks, tape, checks, transcript, result

const v = verifyRun(payload, createRun);  // { ok, reason, mismatchTick, result, transcript, sim }
```

A simulation takes part through `RunSim`: `tick`, `done`, `step(word)`,
`checksum()` (feed state into `createHasher()`: doubles by their exact bits)
and `result()` (plain JSON derived from state). Simulation code must follow
docs/CONVENTIONS.md "Deterministic math" for a replay to hold across machines.
