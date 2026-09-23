// A road's line: a smooth curve through control points, resampled a metre
// apart, with its heading and its curvature at every sample -- what a car
// follows, what a corner is measured by, and what the ground is painted from.
// Open (a street between two junctions) or closed (a circuit, a ring road).
//
// Everything a racer asks of a road is here: where am I along it and how far
// off its centre (locate), and where is the point s metres along, d metres to
// the right (pointAt). Deterministic: core's dmath for every angle.

import { datan2, dcos, dhypot, dsin } from "@keel-engine/core";

export interface Path {
  /** Samples a metre apart: position, heading (frame convention: 0 faces +z), curvature (1/m, + turning right). */
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly yaw: Float64Array;
  readonly curve: Float64Array;
  /** Samples (= metres). A closed path's last sample runs back to its first. */
  readonly length: number;
  readonly closed: boolean;
}

const TAU = Math.PI * 2;
export const wrapAngle = (a: number): number => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

export interface PathOptions {
  /** A loop (default false). */
  readonly closed?: boolean;
  /** Spline steps between two control points before resampling (default 40). */
  readonly per?: number;
  /** Curvature is averaged over this many metres either side (default 4): a driver brakes for corners, not wobbles. */
  readonly smooth?: number;
}

/** A Catmull-Rom curve through the points, resampled a metre apart. An open one runs exactly from the first to the last. */
export function pathThrough(px: readonly number[], pz: readonly number[], { closed = false, per = 40, smooth = 4 }: PathOptions = {}): Path {
  const n = px.length;
  if (n < 2) throw new Error("A path needs two points.");
  // The dense curve (an open path's ends are mirrored so the curve starts and ends on its end points).
  const at = (i: number, a: readonly number[]): number => {
    if (closed) return a[((i % n) + n) % n]!;
    if (i < 0) return 2 * a[0]! - a[Math.min(1, n - 1)]!;
    if (i >= n) return 2 * a[n - 1]! - a[Math.max(0, n - 2)]!;
    return a[i]!;
  };
  const sx: number[] = [], sz: number[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i += 1) {
    for (let k = 0; k < per; k += 1) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const cr = (p0: number, p1: number, p2: number, p3: number): number => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      sx.push(cr(at(i - 1, px), at(i, px), at(i + 1, px), at(i + 2, px)));
      sz.push(cr(at(i - 1, pz), at(i, pz), at(i + 1, pz), at(i + 2, pz)));
    }
  }
  if (!closed) { sx.push(px[n - 1]!); sz.push(pz[n - 1]!); }
  // Arc length along it, then a sample every metre.
  const m = sx.length, segs = closed ? m : m - 1;
  const cum = [0];
  for (let i = 0; i < segs; i += 1) { const j = (i + 1) % m; cum.push(cum[i]! + dhypot(sx[j]! - sx[i]!, sz[j]! - sz[i]!)); }
  const total = cum[segs]!;
  const length = Math.max(2, closed ? Math.round(total) : Math.round(total) + 1);
  const x = new Float64Array(length), z = new Float64Array(length);
  let seg = 0;
  for (let k = 0; k < length; k += 1) {
    const target = closed ? (k / length) * total : (k / (length - 1)) * total;
    while (seg < segs - 1 && cum[seg + 1]! < target) seg += 1;
    const t = (target - cum[seg]!) / Math.max(1e-9, cum[seg + 1]! - cum[seg]!);
    const j = (seg + 1) % m;
    x[k] = sx[seg]! + (sx[j]! - sx[seg]!) * t;
    z[k] = sz[seg]! + (sz[j]! - sz[seg]!) * t;
  }
  return withShape(x, z, closed, smooth);
}

/** Headings and curvature for samples already a metre apart. */
export function withShape(x: Float64Array, z: Float64Array, closed: boolean, smooth = 4): Path {
  const L = x.length;
  const idx = (i: number): number => (closed ? ((i % L) + L) % L : Math.max(0, Math.min(L - 1, i)));
  const yaw = new Float64Array(L), curve = new Float64Array(L), raw = new Float64Array(L);
  for (let i = 0; i < L; i += 1) { const a = idx(i + 1), b = idx(i - 1); yaw[i] = datan2(x[a]! - x[b]!, z[a]! - z[b]!); }
  for (let i = 0; i < L; i += 1) { const a = idx(i + 2), b = idx(i - 2); raw[i] = a === b ? 0 : wrapAngle(yaw[a]! - yaw[b]!) / Math.max(1, a - b + (closed && a < b ? L : 0)); }
  for (let i = 0; i < L; i += 1) {
    let acc = 0, n = 0;
    for (let k = -smooth; k <= smooth; k += 1) { const j = idx(i + k); if (!closed && j !== i + k) continue; acc += raw[j]!; n += 1; }
    curve[i] = acc / Math.max(1, n);
  }
  return { x, z, yaw, curve, length: L, closed };
}

/** A straight path from one point to another, a metre apart. */
export function straight(ax: number, az: number, bx: number, bz: number): Path {
  const L = Math.max(2, Math.round(dhypot(bx - ax, bz - az)) + 1);
  const x = new Float64Array(L), z = new Float64Array(L);
  for (let i = 0; i < L; i += 1) { const t = i / (L - 1); x[i] = ax + (bx - ax) * t; z[i] = az + (bz - az) * t; }
  return withShape(x, z, false, 0);
}

/** Where a point is on a path: metres along (s), signed metres from its centre (+ right), the nearest sample. Searches near `hint`. */
export function locate(p: Path, x: number, z: number, hint = -1): { s: number; d: number; i: number } {
  const L = p.length;
  let best = -1, bd = Infinity;
  const scan = (from: number, to: number): void => {
    for (let m = from; m <= to; m += 1) {
      const i = p.closed ? ((m % L) + L) % L : m;
      if (i < 0 || i >= L) continue;
      const dx = x - p.x[i]!, dz = z - p.z[i]!, e = dx * dx + dz * dz;
      if (e < bd) { bd = e; best = i; }
    }
  };
  if (hint >= 0) scan(hint - 30, hint + 30);
  if (best < 0 || bd > 900) scan(0, L - 1);
  const i = best;
  const fx = dsin(p.yaw[i]!), fz = dcos(p.yaw[i]!);
  const dx = x - p.x[i]!, dz = z - p.z[i]!;
  const along = dx * fx + dz * fz;
  const s = p.closed ? (((i + along) % L) + L) % L : Math.max(0, Math.min(L - 1, i + along));
  return { s, d: dx * fz - dz * fx, i };
}

/** The point s metres along, d metres to the right of the centre; its heading and curvature. */
export function pointAt(p: Path, s: number, d = 0): { x: number; z: number; yaw: number; curve: number } {
  const L = p.length;
  const u = p.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L - 1, s));
  const i = Math.min(L - 1, Math.floor(u)), j = p.closed ? (i + 1) % L : Math.min(L - 1, i + 1), f = u - i;
  const yaw = p.yaw[i]! + wrapAngle(p.yaw[j]! - p.yaw[i]!) * f;
  const fx = dsin(yaw), fz = dcos(yaw);
  return { x: p.x[i]! + (p.x[j]! - p.x[i]!) * f + fz * d, z: p.z[i]! + (p.z[j]! - p.z[i]!) * f - fx * d, yaw, curve: p.curve[i]! + (p.curve[j]! - p.curve[i]!) * f };
}

/** The box round a path: [x0, z0, x1, z1]. */
export function boundsOf(p: Path): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 1) { x0 = Math.min(x0, p.x[i]!); x1 = Math.max(x1, p.x[i]!); z0 = Math.min(z0, p.z[i]!); z1 = Math.max(z1, p.z[i]!); }
  return [x0, z0, x1, z1];
}

/** Whether a path comes within `clear` metres of itself anywhere more than `gap` metres apart along it. */
export function nearsItself(p: Path, clear: number, gap = 40, step = 4): boolean {
  const L = p.length, c2 = clear * clear;
  for (let a = 0; a < L; a += step) for (let b = a + gap; b < L; b += step) {
    if (p.closed && L - (b - a) < gap) continue;
    const dx = p.x[a]! - p.x[b]!, dz = p.z[a]! - p.z[b]!;
    if (dx * dx + dz * dz < c2) return true;
  }
  return false;
}

/** The tightest corner on a path (1/m). */
export function tightest(p: Path): number {
  let k = 0;
  for (let i = 0; i < p.length; i += 1) k = Math.max(k, Math.abs(p.curve[i]!));
  return k;
}
