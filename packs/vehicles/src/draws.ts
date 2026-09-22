// The draws a generated thing is made from: every draw hashed from (seed, tag),
// so the same seed is the same car everywhere and the order draws are made in
// never matters (a new dial doesn't move the old ones). The shapes are the
// Pixel Marine's (keel-pixel-pfps gen.js): flat, triangular (the middle
// likelier), a chance, a weighted pick -- and each gate and pick notes how
// unlikely what it drew was, in half-bits, for the rarity.

import { dlog2 } from "@keel-engine/core";

/** A 32-bit hash of (seed, tag): FNV-1a, then a finishing mix. Exact integer maths. */
export function hash32(seed: string, tag: string): number {
  let h = 0x811c9dc5;
  const s = `${seed}|${tag}`;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** A dial (-1..1) as a value between lo and hi. */
export const at = (d: number, lo: number, hi: number): number => lo + (hi - lo) * (clamp(d, -1, 1) + 1) / 2;
/** Rounded to a step (so shapes that land on the same values share a bake). */
export const snap = (v: number, step: number): number => Math.round(v / step) * step;

export interface Draws {
  /** 0..1 */
  u(tag: string): number;
  /** -1..1, uniform */
  flat(tag: string): number;
  /** -1..1, triangular: the middle likelier */
  tri(tag: string): number;
  /** A gate: true with probability p (noted for the rarity). */
  gate(tag: string, p: number): boolean;
  /** A weighted pick (noted for the rarity). Weights <= 0 are never picked. */
  pick<T>(tag: string, table: ReadonlyArray<readonly [T, number]>): T;
  /** How unlikely the noted draws were, in half-bits. */
  readonly rarity: number;
}

export function drawsOf(seed: string): Draws {
  let rarity = 0;
  // (The marine's points(): how many sqrt(2) steps a roll's odds are from certain.)
  const note = (p: number): void => { rarity += Math.max(0, Math.round(-2 * dlog2(Math.max(1e-6, p)))); };
  const u = (tag: string): number => hash32(seed, tag) / 4294967296;
  return {
    u,
    flat: (t) => u(t) * 2 - 1,
    tri: (t) => u(`${t}.a`) + u(`${t}.b`) - 1,
    gate(tag, p) {
      const q = clamp(p, 0, 1);
      const hit = u(tag) < q;
      note(hit ? q : 1 - q);
      return hit;
    },
    pick(tag, table) {
      const live = table.filter(([, w]) => w > 0);
      if (!live.length) throw new RangeError(`Nothing to pick for "${tag}".`);
      const total = live.reduce((a, [, w]) => a + w, 0);
      let r = u(tag) * total;
      for (const [v, w] of live) { if (r < w) { note(w / total); return v; } r -= w; }
      const [v, w] = live[live.length - 1]!;
      note(w / total);
      return v;
    },
    get rarity() { return rarity; },
  };
}
