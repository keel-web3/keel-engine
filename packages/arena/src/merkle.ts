// The settlement tree for big fields: one leaf per entrant (index, token, SCRAP spent),
// sha256 with domain bytes (0x00 leaf, 0x01 node), levels built left to right, an odd
// last node promoted unchanged. The contract checks a claim with the sibling list
// bottom-up, the index choosing left or right -- no sorting, so no second-preimage games
// between leaves and nodes.

import { sha256 } from "@keel-engine/codec";
import { createPacker, equalBytes } from "@keel-engine/proof";

export function settlementLeaf(index: number, tokenId: bigint, spent: bigint): Uint8Array {
  return sha256(createPacker().u8(0).u32(index).u256(tokenId).u128(spent).finish());
}

const node = (l: Uint8Array, r: Uint8Array): Uint8Array => sha256(createPacker().u8(1).bytes32(l).bytes32(r).finish());

export interface SettlementTree {
  readonly root: Uint8Array;
  /** Siblings bottom-up for leaf i (a promoted level contributes none). */
  proof(i: number): Uint8Array[];
}

export function settlementTree(leaves: readonly Uint8Array[]): SettlementTree {
  if (!leaves.length) throw new RangeError("a settlement tree needs a leaf");
  const levels: Uint8Array[][] = [leaves.slice()];
  while (levels[levels.length - 1]!.length > 1) {
    const cur = levels[levels.length - 1]!;
    const up: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) up.push(i + 1 < cur.length ? node(cur[i]!, cur[i + 1]!) : cur[i]!);
    levels.push(up);
  }
  return {
    root: levels[levels.length - 1]![0]!,
    proof(i) {
      if (!Number.isInteger(i) || i < 0 || i >= leaves.length) throw new RangeError("no such leaf");
      const out: Uint8Array[] = [];
      for (let l = 0; l < levels.length - 1; l += 1) {
        const sib = i ^ 1;
        if (sib < levels[l]!.length) out.push(levels[l]![sib]!);
        i >>= 1;
      }
      return out;
    },
  };
}

/** What the contract does with a claim: rebuild the root from leaf i and its siblings. `n` is the leaf count (it decides where promotions happen). */
export function verifySettlement(root: Uint8Array, n: number, index: number, leaf: Uint8Array, proof: readonly Uint8Array[]): boolean {
  let h = leaf, i = index, width = n, k = 0;
  while (width > 1) {
    const sib = i ^ 1;
    if (sib < width) {
      const s = proof[k++];
      if (!s) return false;
      h = i % 2 === 0 ? node(h, s) : node(s, h);
    }
    i >>= 1;
    width = (width + 1) >> 1;
  }
  return k === proof.length && equalBytes(h, root);
}
