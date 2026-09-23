// A match format: the one thing a game writes to add a kind of match. It names its
// program ("game/format@version"), reads its params bytes, and runs a field of staked
// entrants to placings and per-entrant SCRAP spent. defineMatchFormat turns that into a
// provable program over the generic MatchInput / MatchResult, with the witness checks
// (params, track, entrants against their digests) and the settlement mode (inline for
// small fields, a Merkle root past inlineMax) done once, here, for every format.
//
//   export const SPRINT = defineMatchFormat({
//     id: "hashers/sprint@1", formatId: 1,
//     decodeParams, encodeParams,
//     run: ({ params, track, seed, entrants }) => ({ placings, spent }),
//   });
//   SPRINT.execute(SPRINT.inputOf(match), SPRINT.witnessOf(match));  // what the prover runs

import { sha256 } from "@keel-engine/codec";
import { defineProvable, equalBytes, type Provable } from "@keel-engine/proof";
import {
  MAX_PLACINGS, ZERO32, decodeEntrants, decodeMatchInput, decodeMatchResult, encodeEntrants, encodeMatchInput, encodeMatchResult, entrantsDigest,
  type Entrant, type MatchInput, type MatchResult, type Placing,
} from "./match.ts";
import { settlementLeaf, settlementTree } from "./merkle.ts";

/** Everything a match is, before it's reduced to digests. */
export interface Match<P> {
  readonly matchId: bigint;
  readonly seed: Uint8Array;
  readonly params: P;
  /** The track bytes (the format's own encoding), or null. */
  readonly track: Uint8Array | null;
  readonly entrants: readonly Entrant[];
}

/** What the prover is handed beside the input: the bytes behind each digest. */
export interface MatchWitness {
  readonly params: Uint8Array;
  readonly track: Uint8Array | null;
  readonly entrants: Uint8Array;
}

export interface MatchRun {
  /** Best first; the arena pays and the market settles off these. At most 32. */
  readonly placings: readonly Placing[];
  /** SCRAP spent by each entrant, in entry order; never above its stake. */
  readonly spent: readonly bigint[];
}

export interface MatchFormatSpec<P> {
  readonly id: string;
  readonly formatId: number;
  encodeParams(p: P): Uint8Array;
  decodeParams(b: Uint8Array): P;
  run(match: Match<P>): MatchRun;
  /** Fields up to this many settle inline (every stake applied at once); bigger ones settle by Merkle claims. Must equal the on-chain format's inlineMax. */
  readonly inlineMax?: number;
}

export interface MatchFormat<P> extends Provable<MatchInput, MatchResult, MatchWitness> {
  readonly formatId: number;
  readonly inlineMax: number;
  encodeParams(p: P): Uint8Array;
  decodeParams(b: Uint8Array): P;
  inputOf(match: Match<P>): MatchInput;
  witnessOf(match: Match<P>): MatchWitness;
  /** Runs the format on a match directly (the viewer's path; the prover's is execute). */
  runMatch(match: Match<P>): MatchRun;
}

export function defineMatchFormat<P>(spec: MatchFormatSpec<P>): MatchFormat<P> {
  const inlineMax = spec.inlineMax ?? 64;
  const settle = (entrants: readonly Entrant[], run: MatchRun): MatchResult => {
    const n = entrants.length;
    if (run.spent.length !== n) throw new RangeError("a run reports spend for every entrant");
    if (run.placings.length > MAX_PLACINGS) throw new RangeError(`at most ${MAX_PLACINGS} placings`);
    const seen = new Set<number>();
    for (const p of run.placings) {
      if (!Number.isInteger(p.entrant) || p.entrant < 0 || p.entrant >= n || seen.has(p.entrant)) throw new RangeError("placings name distinct entrants");
      seen.add(p.entrant);
    }
    run.spent.forEach((s, i) => { if (s < 0n || s > entrants[i]!.stake) throw new RangeError(`entrant ${i} spent more than its stake`); });
    if (n <= inlineMax) return { n, placings: run.placings, settlement: { mode: "inline", spent: run.spent } };
    const tree = settlementTree(entrants.map((e, i) => settlementLeaf(i, e.tokenId, run.spent[i]!)));
    return { n, placings: run.placings, settlement: { mode: "merkle", root: tree.root, totalSpent: run.spent.reduce((a, s) => a + s, 0n) } };
  };
  const provable = defineProvable<MatchInput, MatchResult, MatchWitness>({
    id: spec.id,
    encodeInput: encodeMatchInput,
    decodeInput: decodeMatchInput,
    checkWitness(input, w) {
      if (input.formatId !== spec.formatId) throw new RangeError(`format ${input.formatId} is not ${spec.id}`);
      if (!equalBytes(sha256(w.params), input.paramsDigest)) throw new RangeError("the params are not the ones the match committed to");
      if (!equalBytes(w.track ? sha256(w.track) : ZERO32, input.trackDigest)) throw new RangeError("the track is not the one the match committed to");
    },
    run(input, w) {
      const entrants = decodeEntrantsChecked(input, w.entrants);
      const match: Match<P> = { matchId: input.matchId, seed: input.seed, params: spec.decodeParams(w.params), track: w.track, entrants };
      return settle(entrants, spec.run(match));
    },
    encodeResult: encodeMatchResult,
    decodeResult: decodeMatchResult,
  });
  return {
    ...provable,
    formatId: spec.formatId,
    inlineMax,
    encodeParams: spec.encodeParams,
    decodeParams: spec.decodeParams,
    inputOf: (m) => ({
      formatId: spec.formatId, matchId: m.matchId, paramsDigest: sha256(spec.encodeParams(m.params)),
      trackDigest: m.track ? sha256(m.track) : ZERO32, seed: m.seed, n: m.entrants.length, entrantsDigest: entrantsDigest(m.matchId, m.entrants),
    }),
    witnessOf: (m) => ({ params: spec.encodeParams(m.params), track: m.track, entrants: encodeEntrants(m.entrants) }),
    runMatch: (m) => spec.run(m),
  };
}

function decodeEntrantsChecked(input: MatchInput, bytes: Uint8Array): Entrant[] {
  const list = decodeEntrants(bytes);
  if (list.length !== input.n) throw new RangeError("the entrant list is not the committed size");
  if (!equalBytes(entrantsDigest(input.matchId, list), input.entrantsDigest)) throw new RangeError("the entrants are not the ones the match committed to");
  return list;
}
