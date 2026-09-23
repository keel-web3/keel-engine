import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@keel-engine/codec";
import { createPacker, createReader, readPublicValues, rollKey, below, toHex } from "@keel-engine/proof";
import {
  decodeMatchInput, decodeMatchResult, defineMatchFormat, encodeMatchInput, entrantsDigest, settlementLeaf, settlementTree, verifySettlement,
  type Entrant, type Match,
} from "../src/index.ts";

const h = (s: string): Uint8Array => sha256(new TextEncoder().encode(s));
const field = (n: number): Entrant[] =>
  Array.from({ length: n }, (_, i) => ({ tokenId: BigInt(1000 + i), seed: h(`seed${i}`), stake: BigInt(i % 7) * 10n ** 18n, config: h(`cfg${i}`) }));

// A toy format: a lottery. Everyone pays half their stake; placings are a seeded shuffle's first `places`.
const LOTTO = defineMatchFormat<{ places: number }>({
  id: "keel/arena/lotto@1",
  formatId: 99,
  inlineMax: 8,
  encodeParams: (p) => createPacker().bytes4("LOTP").u8(p.places).finish(),
  decodeParams: (b) => { const r = createReader(b); r.magic("LOTP"); const places = r.u8(); r.end(); return { places }; },
  run: ({ seed, params, entrants }) => {
    const key = rollKey(seed);
    const idx = entrants.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i -= 1) { const j = below(key, i + 1, i, 0, 0, 0); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
    return { placings: idx.slice(0, Math.min(params.places, idx.length)).map((entrant, k) => ({ entrant, score: k })), spent: entrants.map((e) => e.stake / 2n) };
  },
});

const matchOf = (n: number): Match<{ places: number }> => ({ matchId: 7n, seed: h("m7"), params: { places: 3 }, track: null, entrants: field(n) });

test("the settlement tree proves every leaf, at every awkward size", () => {
  for (const n of [1, 2, 3, 5, 8, 13, 64, 65, 300]) {
    const leaves = field(n).map((e, i) => settlementLeaf(i, e.tokenId, BigInt(i)));
    const t = settlementTree(leaves);
    for (let i = 0; i < n; i += 1) {
      assert.ok(verifySettlement(t.root, n, i, leaves[i]!, t.proof(i)), `n=${n} i=${i}`);
      if (n > 1) assert.equal(verifySettlement(t.root, n, (i + 1) % n, leaves[i]!, t.proof(i)), false);
    }
    // A wrong spend doesn't verify.
    assert.equal(verifySettlement(t.root, n, 0, settlementLeaf(0, 1000n, 99n), t.proof(0)), false);
  }
});

test("a small field settles inline; a big one settles by Merkle root", () => {
  const small = matchOf(6);
  const a = LOTTO.execute(LOTTO.inputOf(small), LOTTO.witnessOf(small));
  assert.equal(a.result.settlement.mode, "inline");
  assert.equal(a.result.placings.length, 3);
  const big = matchOf(40);
  const b = LOTTO.execute(LOTTO.inputOf(big), LOTTO.witnessOf(big));
  assert.equal(b.result.settlement.mode, "merkle");
  const s = b.result.settlement;
  if (s.mode !== "merkle") throw new Error("unreachable");
  assert.equal(s.totalSpent, big.entrants.reduce((acc, e) => acc + e.stake / 2n, 0n));
  // A claimant rebuilds its own leaf and proof from the public list and the rerun.
  const tree = settlementTree(big.entrants.map((e, i) => settlementLeaf(i, e.tokenId, e.stake / 2n)));
  assert.equal(toHex(tree.root), toHex(s.root));
  assert.deepEqual(decodeMatchResult(readPublicValues(b.publicValues).result), b.result);
});

test("the input commits to params, track and every entrant", () => {
  const m = matchOf(6);
  const input = LOTTO.inputOf(m);
  assert.deepEqual(decodeMatchInput(encodeMatchInput(input)), input);
  assert.equal(toHex(input.entrantsDigest), toHex(entrantsDigest(7n, m.entrants)));
  const w = LOTTO.witnessOf(m);
  assert.throws(() => LOTTO.execute(input, { ...w, params: LOTTO.encodeParams({ places: 4 }) }), /params/);
  assert.throws(() => LOTTO.execute(input, { ...w, track: new Uint8Array(3) }), /track/);
  const swapped = LOTTO.witnessOf({ ...m, entrants: [...m.entrants].reverse() });
  assert.throws(() => LOTTO.execute(input, swapped), /entrants/);
  assert.throws(() => LOTTO.execute({ ...input, formatId: 1 }, w), /format/);
});
