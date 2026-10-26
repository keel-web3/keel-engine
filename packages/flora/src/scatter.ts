// Where plants grow: a jittered grid (one candidate per cell, nudged within
// it), so a field is even without rows and the same seed always plants the
// same spots. A density function thins it: each candidate keeps a roll, and
// grows where the roll falls under the density there.

export interface ScatterPoint {
  readonly x: number;
  readonly z: number;
  /** A roll of its own (0..1), for the caller's choices: kind, size, variant. */
  readonly roll: number;
  readonly roll2: number;
}

export interface ScatterSpec {
  /** [x0, z0, x1, z1] in world units. */
  readonly bounds: readonly [number, number, number, number];
  /** The grid's cell size: the closest plants come to one another, about. */
  readonly spacing: number;
  readonly seed?: number;
  /** How far a candidate wanders inside its cell (0 a strict grid, 1 anywhere in it). */
  readonly jitter?: number;
  /** 0..1 at x, z: the share of candidates that grow there. */
  readonly density?: (x: number, z: number) => number;
  /** A cap on how many come back (the first ones in grid order). */
  readonly limit?: number;
}

/** A 0..1 hash of integers. */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function scatter({ bounds, spacing, seed = 1, jitter = 0.9, density, limit = Infinity }: ScatterSpec): ScatterPoint[] {
  if (!(spacing > 0)) throw new RangeError("Scatter spacing must be positive.");
  const [x0, z0, x1, z1] = bounds;
  const cols = Math.ceil((x1 - x0) / spacing), rows = Math.ceil((z1 - z0) / spacing);
  if (cols * rows > 4_000_000) throw new RangeError("Scatter would test more than 4 million cells.");
  const out: ScatterPoint[] = [];
  for (let j = 0; j < rows && out.length < limit; j += 1) {
    for (let i = 0; i < cols && out.length < limit; i += 1) {
      const x = x0 + (i + 0.5 + (hash3(i, j, seed) - 0.5) * jitter) * spacing;
      const z = z0 + (j + 0.5 + (hash3(i, j, seed + 101) - 0.5) * jitter) * spacing;
      if (x > x1 || z > z1) continue;
      const keep = hash3(i, j, seed + 211);
      if (density !== undefined && keep >= density(x, z)) continue;
      out.push({ x, z, roll: hash3(i, j, seed + 307), roll2: hash3(i, j, seed + 401) });
    }
  }
  return out;
}

/** Picks a key by weight with a 0..1 roll (weights need not sum to 1). */
export function pickWeighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>, roll: number): K | null {
  let total = 0;
  for (const w of Object.values<number | undefined>(weights)) total += Math.max(0, w ?? 0);
  if (total <= 0) return null;
  let at = roll * total;
  for (const [key, w] of Object.entries(weights) as Array<[K, number | undefined]>) {
    at -= Math.max(0, w ?? 0);
    if (at < 0) return key;
  }
  return null;
}
