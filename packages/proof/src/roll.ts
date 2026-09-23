// The portable roll: a counter-based 32-bit hash of (seed, a, b, c, d). No
// state, so a draw is named by its coordinates (tick, racer, lap, purpose) and
// the order draws are made in never matters -- the same rule packs/vehicles'
// draws follow. Only Math.imul, xor and shifts: the Rust twin is u32
// wrapping_mul and the same shifts, bit for bit.
//
//   const key = rollKey(raceSeed);          // bytes32 -> two words
//   roll(key, tick, racer, LAP, 0);          // uint32
//   below(key, 6, lap, racer, WILD, 0);      // 0..5
//   chancePpm(key, 250_000, tick, racer, MISTAKE, 0);   // true 25% of the time

/** murmur3's finaliser (the same mix32 as @keel-engine/replay). */
export function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export type RollKey = readonly [number, number];

const fold = (seed: Uint8Array, start: number): number => {
  if (seed.length !== 32) throw new RangeError("rollKey needs a 32-byte seed");
  let h = start >>> 0;
  for (let i = 0; i < 32; i += 4) {
    const w = ((seed[i]! << 24) | (seed[i + 1]! << 16) | (seed[i + 2]! << 8) | seed[i + 3]!) >>> 0;
    h = (mix32((h ^ w) >>> 0) + 0x9e3779b9) >>> 0;
  }
  return mix32(h);
};

/** Two words from a 32-byte seed; every seed bit reaches both. */
export const rollKey = (seed: Uint8Array): RollKey => [fold(seed, 0x243f6a88), fold(seed, 0x85a308d3)];

/** A uint32 named by four coordinates (each taken mod 2^32). */
export function roll(key: RollKey, a: number, b: number, c: number, d: number): number {
  let h = mix32((key[0] ^ Math.imul(a, 0x9e3779b1)) >>> 0);
  h = mix32((h ^ Math.imul(b, 0x85ebca77) ^ key[1]) >>> 0);
  h = mix32((h ^ Math.imul(c, 0xc2b2ae3d)) >>> 0);
  return mix32((h ^ Math.imul(d, 0x27d4eb2f) ^ key[0]) >>> 0);
}

/** 0..n-1, n <= 2^21 (Rust: (r as u64 * n) >> 32). */
export function below(key: RollKey, n: number, a: number, b: number, c: number, d: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 21) throw new RangeError("below: 1 <= n <= 2^21");
  return Math.floor((roll(key, a, b, c, d) * n) / 4294967296);
}

/** 0..999_999. */
export const ppm = (key: RollKey, a: number, b: number, c: number, d: number): number => below(key, 1_000_000, a, b, c, d);

/** True with probability p/1e6. */
export const chancePpm = (key: RollKey, p: number, a: number, b: number, c: number, d: number): boolean => ppm(key, a, b, c, d) < p;

/** A weighted pick over integer weights (index), deterministic, no floats. Total weight <= 2^21. */
export function pickWeighted(key: RollKey, weights: readonly number[], a: number, b: number, c: number, d: number): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = below(key, total, a, b, c, d);
  for (let i = 0; i < weights.length; i += 1) { if (r < weights[i]!) return i; r -= weights[i]!; }
  return weights.length - 1;
}
