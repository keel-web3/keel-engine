// A provable simulation: a pure function from canonical input bytes (plus an
// optional witness the input commits to by digest) to canonical result bytes.
// The zkVM guest runs the same function and commits the PUBLIC VALUES envelope:
//
//   bytes32 programId    sha256(utf8(id)), e.g. sha256("redline/race@1")
//   bytes32 inputDigest  sha256(input bytes)
//   bytes   result       the result bytes
//
// A contract that already knows the input (it built it from its own storage)
// checks the first 64 bytes and decodes the rest -- it never trusts a result,
// only a proof over this envelope. The TypeScript sim is what the game shows
// and what parity vectors are generated from; the guest must match it byte
// for byte (see vectors.ts).

import { sha256 } from "@keel-engine/codec";
import { createPacker, createReader, equalBytes, toHex } from "./bytes.ts";

const utf8 = new TextEncoder();

/** sha256(utf8(id)): the program's name as the chain sees it. Put the version in the id ("game/thing@1"). */
export const programIdOf = (id: string): Uint8Array => sha256(utf8.encode(id));

export interface ProvableSpec<I, R, W = undefined> {
  /** "<game>/<sim>@<version>" -- a new rules version is a new id, never an edit. */
  readonly id: string;
  encodeInput(input: I): Uint8Array;
  decodeInput(bytes: Uint8Array): I;
  /** The simulation. Must be deterministic: integers, the portable roll, no clock, no Math transcendentals. */
  run(input: I, witness: W): R;
  encodeResult(result: R): Uint8Array;
  decodeResult(bytes: Uint8Array): R;
  /** Throws unless the witness is the one the input commits to (e.g. sha256(track) == input.trackDigest). */
  checkWitness?(input: I, witness: W): void;
}

export interface Execution<I, R> {
  readonly input: I;
  readonly inputBytes: Uint8Array;
  readonly inputDigest: Uint8Array;
  readonly result: R;
  readonly resultBytes: Uint8Array;
  readonly publicValues: Uint8Array;
}

export interface Provable<I, R, W = undefined> extends ProvableSpec<I, R, W> {
  readonly programId: Uint8Array;
  /** Run it and build what a guest would commit. */
  execute(input: I, witness: W): Execution<I, R>;
  /** Re-run from the input and compare with claimed public values: what anyone can do without a prover. */
  audit(input: I, witness: W, publicValues: Uint8Array): { ok: boolean; reason: string; expected: Uint8Array };
}

export function publicValuesOf(programId: Uint8Array, inputDigest: Uint8Array, result: Uint8Array): Uint8Array {
  return createPacker().bytes32(programId).bytes32(inputDigest).raw(result).finish();
}

export function readPublicValues(bytes: Uint8Array): { programId: Uint8Array; inputDigest: Uint8Array; result: Uint8Array } {
  const r = createReader(bytes);
  const programId = r.bytes32();
  const inputDigest = r.bytes32();
  return { programId, inputDigest, result: r.raw(r.remaining) };
}

export function defineProvable<I, R, W = undefined>(spec: ProvableSpec<I, R, W>): Provable<I, R, W> {
  const programId = programIdOf(spec.id);
  const execute = (input: I, witness: W): Execution<I, R> => {
    spec.checkWitness?.(input, witness);
    const inputBytes = spec.encodeInput(input);
    // The sim reads the canonical form, not the caller's object: what's hashed is what runs.
    const canonical = spec.decodeInput(inputBytes);
    const inputDigest = sha256(inputBytes);
    const result = spec.run(canonical, witness);
    const resultBytes = spec.encodeResult(result);
    return { input: canonical, inputBytes, inputDigest, result, resultBytes, publicValues: publicValuesOf(programId, inputDigest, resultBytes) };
  };
  return {
    ...spec,
    programId,
    execute,
    audit(input, witness, publicValues) {
      const expected = execute(input, witness).publicValues;
      if (equalBytes(expected, publicValues)) return { ok: true, reason: "", expected };
      const claimed = readPublicValues(publicValues);
      const mine = readPublicValues(expected);
      const reason = !equalBytes(claimed.programId, programId) ? `program ${toHex(claimed.programId)} is not ${spec.id}`
        : !equalBytes(claimed.inputDigest, mine.inputDigest) ? "the input digest differs: a different race was proven"
        : "same input, different result";
      return { ok: false, reason, expected };
    },
  };
}
