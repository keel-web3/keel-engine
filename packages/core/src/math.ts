// Scalar helpers, hashing and loop-safe noise -- ported from the proof of
// concept's src/core/math.js (NOCTURNES' math.js); test/*-equality.test.ts
// proves every export identical.
//
// Everything that moves is a function of t in [0,1). A loop is seamless when
// every periodic term completes a WHOLE number of cycles over t, so the helpers
// here take integer cycle counts rather than speeds.

/** [x, y, z]. */
export type Vec3 = [number, number, number];
/** A vec3 this code only reads. */
export type Vec3Like = readonly [number, number, number];

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const fract = (v: number): number => v - Math.floor(v);
export const smooth = (a: number, b: number, v: number): number => {
  const t = sat((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Triangle wave in [0,1], peak at 0.5. */
export const tri = (v: number): number => 1 - Math.abs(2 * fract(v) - 1);

export function hash2(x: number, y: number, s = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3(x: number, y: number, z: number, s = 0): number {
  return hash2(x, Math.imul(y | 0, 0x1b873593) ^ (z | 0), s);
}

const fade = (t: number): number => t * t * (3 - 2 * t);

export function vnoise2(x: number, y: number, s = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

/** Value noise that wraps every `period` cells in x -- a strip that can scroll forever. */
export function wrapNoise2(x: number, y: number, period: number, s = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const a = hash2(x0, yi, s);
  const b = hash2(x1, yi, s);
  const c = hash2(x0, yi + 1, s);
  const d = hash2(x1, yi + 1, s);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

export function fbm2(x: number, y: number, s = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * vnoise2(x, y, s + o * 31);
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.2;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * fbm that drifts by (dx,dy) over one loop and still closes: two samples a
 * full drift apart, crossfaded by t. At t=0 and t=1 it is the same field.
 */
export function loopFbm2(x: number, y: number, dx: number, dy: number, t: number, s = 0, octaves = 3): number {
  const a = fbm2(x + dx * t, y + dy * t, s, octaves);
  const b = fbm2(x + dx * (t - 1), y + dy * (t - 1), s, octaves);
  return mix(a, b, t);
}

// ---- small vec3 helpers (arrays, used outside hot loops) ----

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3Like, b: Vec3Like): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3Like, b: Vec3Like): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3Like, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3Like, b: Vec3Like): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3Like): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3Like): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
