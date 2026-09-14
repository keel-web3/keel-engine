// Noise for worlds: seeded, deterministic, integer-safe. Every lattice point
// is an integer hash (Math.imul, no floating seeds), so the same seed and the
// same coordinates give the same number on every machine, in any order, for
// any chunk -- the whole of chunk independence rests on this.
//
//   value2     smooth value noise (the core's vnoise2), 0..1
//   simplex2   2D simplex (Gustavson's skew, 12 hashed gradients), -1..1:
//              no axis-aligned streaks, which matter at climate scale
//   fbm        octaves of either, normalised to 0..1; `ridged` folds each
//              octave (1 - |n|): mountain crests and river channels
//   warp       domain warp: the point pushed by two other fields before
//              sampling -- continents and biomes that curl instead of blob
//
//   const f = noiseField(seedOf("world-1", "temperature"), { freq: 1 / 320, octaves: 4, warp: { freq: 1 / 200, amp: 60 } });
//   f(x, z) -> 0..1

import { hash2, vnoise2 } from "@keel-engine/core";

/** A 32-bit seed from text and a label (FNV-1a, then an avalanche): the same text, the same seed, everywhere. */
export function seedOf(seed: string | number, label = ""): number {
  const text = `${seed}|${label}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h | 0;
}

/** A uint32 hash of an integer point and a seed. */
export function hashU32(x: number, y: number, s: number): number {
  return Math.floor(hash2(x, y, s) * 4294967296) >>> 0;
}

/** 0..1 from an integer point (the core's hash2). */
export const hash01 = hash2;

/** Smooth value noise, 0..1. */
export const value2 = vnoise2;

// 12 gradient directions, 30 degrees apart, picked by hash.
const GX = Array.from({ length: 12 }, (_, i) => Math.cos((i * Math.PI) / 6));
const GY = Array.from({ length: 12 }, (_, i) => Math.sin((i * Math.PI) / 6));
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const grad = (i: number, j: number, s: number, x: number, y: number): number => {
  const g = Math.floor(hash2(i, j, s) * 12);
  return GX[g]! * x + GY[g]! * y;
};

/** 2D simplex noise, about -1..1. */
export function simplex2(x: number, y: number, s: number): number {
  const sk = (x + y) * F2;
  const i = Math.floor(x + sk), j = Math.floor(y + sk);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  let n = 0;
  let a = 0.5 - x0 * x0 - y0 * y0;
  if (a > 0) { a *= a; n += a * a * grad(i, j, s, x0, y0); }
  a = 0.5 - x1 * x1 - y1 * y1;
  if (a > 0) { a *= a; n += a * a * grad(i + i1, j + j1, s, x1, y1); }
  a = 0.5 - x2 * x2 - y2 * y2;
  if (a > 0) { a *= a; n += a * a * grad(i + 1, j + 1, s, x2, y2); }
  return Math.max(-1, Math.min(1, n * 70));
}

export interface NoiseSpec {
  /** Cycles a unit (a tile, a metre: the caller's unit). */
  readonly freq: number;
  readonly octaves?: number;
  readonly lacunarity?: number;
  readonly gain?: number;
  readonly kind?: "simplex" | "value";
  /** Fold each octave: 1 - |n| (crests), squared (sharper). */
  readonly ridged?: boolean;
  /** Push the point by two fields of this frequency and amplitude (units) first. */
  readonly warp?: { readonly freq: number; readonly amp: number; readonly octaves?: number };
}

/** Octaves of noise at a point, normalised to 0..1 (ridged: 0 in the valleys, 1 on the crests). */
export function fbm(spec: NoiseSpec, x: number, z: number, s: number): number {
  const oct = spec.octaves ?? 3, lac = spec.lacunarity ?? 2.03, gain = spec.gain ?? 0.5;
  const simplex = (spec.kind ?? "simplex") === "simplex";
  let f = spec.freq, amp = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o += 1) {
    const so = (s + Math.imul(o + 1, 0x632be5ab)) | 0;
    let n = simplex ? simplex2(x * f + o * 17.13, z * f - o * 9.71, so) : vnoise2(x * f + o * 17.13, z * f - o * 9.71, so) * 2 - 1;
    if (spec.ridged) { n = 1 - Math.abs(n); n *= n; } else n = n * 0.5 + 0.5;
    sum += n * amp; norm += amp;
    f *= lac; amp *= gain;
  }
  return sum / norm;
}

/** A field: fbm with its domain warp, bound to a seed. */
export function noiseField(s: number, spec: NoiseSpec): (x: number, z: number) => number {
  const w = spec.warp;
  if (!w) return (x, z) => fbm(spec, x, z, s);
  const ws = { freq: w.freq, octaves: w.octaves ?? 2 };
  const sx = (s ^ 0x5bd1e995) | 0, sz = (s ^ 0x1b873593) | 0;
  return (x, z) => {
    const dx = (fbm(ws, x, z, sx) - 0.5) * 2 * w.amp, dz = (fbm(ws, x + 31.7, z - 11.3, sz) - 0.5) * 2 * w.amp;
    return fbm(spec, x + dx, z + dz, s);
  };
}

/** A fast float stream from a 32-bit seed (mulberry32): layout draws, the same everywhere. */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Helpers on a float stream. */
export interface Rng {
  f(): number;
  int(a: number, b: number): number;
  between(a: number, b: number): number;
  chance(p: number): boolean;
  pick<T>(list: readonly T[]): T;
  weighted<T>(list: readonly T[], weight: (x: T) => number): T;
  shuffle<T>(list: T[]): T[];
}
export function rng(seed: number): Rng {
  const f = rngOf(seed);
  const r: Rng = {
    f,
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    between: (a, b) => a + (b - a) * f(),
    chance: (p) => f() < p,
    pick: (list) => list[Math.floor(f() * list.length)]!,
    weighted(list, weight) {
      let total = 0;
      for (const x of list) total += Math.max(0, weight(x));
      let t = f() * total;
      for (const x of list) { t -= Math.max(0, weight(x)); if (t < 0) return x; }
      return list[list.length - 1]!;
    },
    shuffle(list) { for (let i = list.length - 1; i > 0; i -= 1) { const j = Math.floor(f() * (i + 1)); [list[i], list[j]] = [list[j]!, list[i]!]; } return list; },
  };
  return r;
}
