# @keel-engine/proof

Simulations a chain can settle on. A **provable** sim is a pure function from canonical
packed input bytes (plus a witness the input commits to by digest) to canonical result
bytes, written in integers with the portable roll. Its Rust twin — crate `keel-proof` in
`zk/keel-proof` — reproduces it byte for byte inside a zkVM guest (SP1), and the guest
commits the **public-values envelope** a contract checks:

```
bytes32 programId     sha256("game/sim@version")
bytes32 inputDigest   sha256(input bytes) -- the contract built those bytes itself
bytes   result
```

```ts
import { defineProvable, createPacker, createReader, rollKey, below, isqrt } from "@keel/game-engine/proof";

const SIM = defineProvable({ id: "mygame/duel@1", encodeInput, decodeInput, run, encodeResult, decodeResult, checkWitness });
const x = SIM.execute(input, witness);          // { inputBytes, inputDigest, result, resultBytes, publicValues }
SIM.audit(input, witness, claimedPublicValues);  // anyone, no prover: is this the true result?
parityVectors(SIM, cases, witnessBytes);         // JSON the Rust twin's test replays
```

- **Packed bytes** (`createPacker`, `createReader`): big-endian, fixed width, no padding — `abi.encodePacked`.
- **The roll** (`rollKey`, `roll`, `below`, `ppm`, `chancePpm`, `pickWeighted`): a counter-based u32 hash of
  `(seed, a, b, c, d)`. No state, so a draw is named by its coordinates and order never matters. `Math.imul`,
  xor and shifts only; pinned in `test/vectors.mjs` and in the Rust crate's tests.
- **Integers** (`idiv`, `mulDiv`, `isqrt`, `assertIntegers`): Rust's semantics, checked to stay exact.
- **The guard** (`assertProvableSource`): stricter than the engine's deterministic-math rule — a provable
  file may not use floats, `**`, clocks or dmath, because the twin in another language has to match it.
  A game calls it on its own provable directory from its own test.

Staked matches between tokens build on this: see `@keel-engine/arena`.
