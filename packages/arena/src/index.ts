// @keel-engine/arena: matches between staked tokens that a contract settles from a zk
// proof. Every format commits to the same MatchInput (params, track, seed, the entrant
// chain) and yields the same MatchResult (placings, inline or Merkle settlement), so a
// game adds a kind of match -- a sprint, a 10 000-car royale, a tournament round -- by
// writing one defineMatchFormat and registering its program on-chain.

export {
  ENTRANT_BYTES, MAX_PLACINGS, ZERO32, decodeEntrants, decodeMatchInput, decodeMatchResult, encodeEntrants, encodeMatchInput, encodeMatchResult,
  entrantBytes, entrantsDigest,
} from "./match.ts";
export type { Entrant, MatchInput, MatchResult, Placing, Settlement } from "./match.ts";
export { settlementLeaf, settlementTree, verifySettlement } from "./merkle.ts";
export type { SettlementTree } from "./merkle.ts";
export { defineMatchFormat } from "./format.ts";
export type { Match, MatchFormat, MatchFormatSpec, MatchRun, MatchWitness } from "./format.ts";
