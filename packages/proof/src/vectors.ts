// Parity vectors: the TypeScript sim is the reference; its zkVM twin (Rust) is
// correct when it reproduces these bytes. A vector file is plain JSON a Rust
// test reads with serde -- hex strings only, so nothing depends on JS numbers.
//
//   writeFileSync("zk/vectors/race.json", JSON.stringify(parityVectors(RACE, cases), null, 1));

import { toHex } from "./bytes.ts";
import type { Provable } from "./provable.ts";

export interface ParityVector {
  readonly name: string;
  /** Hex of the canonical input bytes. */
  readonly input: string;
  /** Hex of the witness bytes (empty when the program takes none). */
  readonly witness: string;
  readonly inputDigest: string;
  readonly result: string;
  readonly publicValues: string;
}

export interface ParityFile {
  readonly format: "keel-proof-vectors@1";
  readonly program: string;
  readonly programId: string;
  readonly vectors: readonly ParityVector[];
}

export function parityVectors<I, R, W>(
  program: Provable<I, R, W>,
  cases: ReadonlyArray<{ readonly name: string; readonly input: I; readonly witness: W }>,
  witnessBytes: (w: W) => Uint8Array = () => new Uint8Array(0),
): ParityFile {
  return {
    format: "keel-proof-vectors@1",
    program: program.id,
    programId: toHex(program.programId),
    vectors: cases.map(({ name, input, witness }) => {
      const x = program.execute(input, witness);
      return {
        name,
        input: toHex(x.inputBytes),
        witness: toHex(witnessBytes(witness)),
        inputDigest: toHex(x.inputDigest),
        result: toHex(x.resultBytes),
        publicValues: toHex(x.publicValues),
      };
    }),
  };
}
