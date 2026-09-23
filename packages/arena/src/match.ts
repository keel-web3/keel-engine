// The generic match: what every format's proof commits to and what the arena contract
// applies (Hashers SPEC 5.3-5.4). The contract builds the MatchInput from its own
// storage; the program gets the params, the track and the entrant list as witness and
// checks each against its digest. So a new format is a new program -- the bytes a chain
// sees never change shape.

import { sha256 } from "@keel-engine/codec";
import { createPacker, createReader } from "@keel-engine/proof";

/** A staked token in a match: which token, the seed it IS, what's staked with it, how it's set up (format-defined). */
export interface Entrant {
  readonly tokenId: bigint;
  readonly seed: Uint8Array;
  readonly stake: bigint;
  readonly config: Uint8Array;
}

export interface MatchInput {
  readonly formatId: number;
  readonly matchId: bigint;
  readonly paramsDigest: Uint8Array;
  /** sha256 of the track bytes, or 32 zero bytes when the format has no track. */
  readonly trackDigest: Uint8Array;
  readonly seed: Uint8Array;
  readonly n: number;
  readonly entrantsDigest: Uint8Array;
}

export interface Placing { readonly entrant: number; readonly score: number }

export type Settlement =
  | { readonly mode: "inline"; readonly spent: readonly bigint[] }
  | { readonly mode: "merkle"; readonly root: Uint8Array; readonly totalSpent: bigint };

export interface MatchResult { readonly n: number; readonly placings: readonly Placing[]; readonly settlement: Settlement }

export const ZERO32 = new Uint8Array(32);
export const MAX_PLACINGS = 32;
export const ENTRANT_BYTES = 112;

export function entrantBytes(e: Entrant): Uint8Array {
  if (e.seed.length !== 32 || e.config.length !== 32) throw new RangeError("an entrant's seed and config are 32 bytes");
  return createPacker().u256(e.tokenId).bytes32(e.seed).u128(e.stake).bytes32(e.config).finish();
}

/** The entrant chain: d0 = sha256("HSME" || matchId), d(i+1) = sha256(d(i) || entrant i). What a contract can keep for 10 000 entrants in one slot. */
export function entrantsDigest(matchId: bigint, entrants: readonly Entrant[]): Uint8Array {
  let d = sha256(createPacker().bytes4("HSME").u64(matchId).finish());
  for (const e of entrants) d = sha256(createPacker().bytes32(d).raw(entrantBytes(e)).finish());
  return d;
}

export function encodeEntrants(entrants: readonly Entrant[]): Uint8Array {
  const p = createPacker();
  for (const e of entrants) p.raw(entrantBytes(e));
  return p.finish();
}

export function decodeEntrants(b: Uint8Array): Entrant[] {
  if (b.length % ENTRANT_BYTES !== 0) throw new RangeError("the entrant list is whole 112-byte records");
  const r = createReader(b);
  const out: Entrant[] = [];
  while (r.remaining) out.push({ tokenId: r.u256(), seed: r.bytes32(), stake: r.u128(), config: r.bytes32() });
  return out;
}

export function encodeMatchInput(m: MatchInput): Uint8Array {
  return createPacker().bytes4("HSMI").u8(1).u32(m.formatId).u64(m.matchId).bytes32(m.paramsDigest).bytes32(m.trackDigest)
    .bytes32(m.seed).u32(m.n).bytes32(m.entrantsDigest).finish();
}

export function decodeMatchInput(b: Uint8Array): MatchInput {
  const r = createReader(b);
  r.magic("HSMI");
  if (r.u8() !== 1) throw new RangeError("unknown match input version");
  const m = { formatId: r.u32(), matchId: r.u64(), paramsDigest: r.bytes32(), trackDigest: r.bytes32(), seed: r.bytes32(), n: r.u32(), entrantsDigest: r.bytes32() };
  r.end();
  return m;
}

export function encodeMatchResult(res: MatchResult): Uint8Array {
  if (res.placings.length > MAX_PLACINGS) throw new RangeError(`at most ${MAX_PLACINGS} placings`);
  const p = createPacker().bytes4("HSMR").u8(1).u32(res.n).u8(res.placings.length);
  for (const x of res.placings) p.u32(x.entrant).u32(x.score);
  if (res.settlement.mode === "inline") {
    if (res.settlement.spent.length !== res.n) throw new RangeError("inline settlement lists every entrant");
    p.u8(0);
    for (const s of res.settlement.spent) p.u128(s);
  } else p.u8(1).bytes32(res.settlement.root).u128(res.settlement.totalSpent);
  return p.finish();
}

export function decodeMatchResult(b: Uint8Array): MatchResult {
  const r = createReader(b);
  r.magic("HSMR");
  if (r.u8() !== 1) throw new RangeError("unknown match result version");
  const n = r.u32();
  const k = r.u8();
  if (k > MAX_PLACINGS) throw new RangeError("too many placings");
  const placings = Array.from({ length: k }, () => ({ entrant: r.u32(), score: r.u32() }));
  const mode = r.u8();
  let settlement: Settlement;
  if (mode === 0) settlement = { mode: "inline", spent: Array.from({ length: n }, () => r.u128()) };
  else if (mode === 1) settlement = { mode: "merkle", root: r.bytes32(), totalSpent: r.u128() };
  else throw new RangeError("unknown settlement mode");
  r.end();
  return { n, placings, settlement };
}
