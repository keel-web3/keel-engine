// @keel-engine/proof: simulations a chain can settle on. A provable sim is a
// pure function from canonical packed input bytes to canonical result bytes,
// written in integers with the portable roll, so a zkVM guest (the Rust twin,
// crate keel-proof in zk/keel-proof) reproduces it exactly and commits the
// public-values envelope a contract checks against the input it built itself.

export { createPacker, createReader, equalBytes, fromHex, toHex } from "./bytes.ts";
export type { Packer, Reader } from "./bytes.ts";
export { assertIntegers, clampInt, idiv, isqrt, mulDiv } from "./int.ts";
export { below, chancePpm, mix32, pickWeighted, ppm, roll, rollKey } from "./roll.ts";
export type { RollKey } from "./roll.ts";
export { defineProvable, programIdOf, publicValuesOf, readPublicValues } from "./provable.ts";
export type { Execution, Provable, ProvableSpec } from "./provable.ts";
export { parityVectors } from "./vectors.ts";
export type { ParityFile, ParityVector } from "./vectors.ts";
export { assertProvableSource, scanProvableSource } from "./guard.ts";
export type { GuardHit, SourceFile } from "./guard.ts";
export { keccak256 } from "./keccak.ts";
export { aggregate, defineStepped, encodeOutput, encodeWitness, fieldHash, jobsIn, jobsOf, proveJob, runStepped, traceHash, windowsOf } from "./stepped.ts";
export type { JobOutput, JobWitness, SteppedRun, SteppedSpec, Window } from "./stepped.ts";
