import type { Bounds } from "./draw-bounds.ts";

export interface ShadowBox { readonly bounds: Bounds; readonly matrix: ArrayLike<number> }

/** Fit to receivers; retain upstream casters whose light-space boxes overlap those receivers.
 * Camera invisibility says nothing about a directional shadow. The false-cull mode is a correctness oracle:
 * it uses exactly the same projection, but submits every caster to the GPU. */
export function shadowView<T extends ShadowBox>(receivers: readonly ShadowBox[], candidates: readonly T[], sun: readonly number[], size: number, cull = true): { matrix: Float32Array; casters: readonly T[] } | null {
  if (!receivers.length) return null;
  const length = Math.hypot(sun[0]!, sun[1]!, sun[2]!) || 1;
  const f = [-sun[0]! / length, -sun[1]! / length, -sun[2]! / length];
  if (f.every(v => v === 0)) return null;
  const up = Math.abs(f[1]!) > .95 ? [0, 0, 1] : [0, 1, 0];
  const r = [f[1]! * up[2]! - f[2]! * up[1]!, f[2]! * up[0]! - f[0]! * up[2]!, f[0]! * up[1]! - f[1]! * up[0]!];
  const rl = Math.hypot(...r); for (let a = 0; a < 3; a++) r[a]! /= rl;
  const u = [r[1]! * f[2]! - r[2]! * f[1]!, r[2]! * f[0]! - r[0]! * f[2]!, r[0]! * f[1]! - r[1]! * f[0]!];
  const axes = [r, u, f];
  const projected = (it: ShadowBox): number[] => {
    const b = it.bounds, m = it.matrix, out = new Array<number>(6);
    for (let a = 0; a < 3; a++) {
      const axis = axes[a]!;
      let center = 0, radius = 0;
      for (let j = 0; j < 3; j++) {
        const v = axis[0]! * m[j * 4]! + axis[1]! * m[j * 4 + 1]! + axis[2]! * m[j * 4 + 2]!;
        center += v * (b[j]! + b[j + 3]!) * .5 + axis[j]! * m[12 + j]!;
        radius += Math.abs(v) * (b[j + 3]! - b[j]!) * .5;
      }
      out[a] = center - radius; out[a + 3] = center + radius;
    }
    return out;
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const receiver of receivers) {
    const b = projected(receiver);
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, b[a]!); hi[a] = Math.max(hi[a]!, b[a + 3]!); }
  }
  if (!lo.every(Number.isFinite) || !hi.every(Number.isFinite)) return null;
  // Cover the half-texel PCF taps and raster precision, even when the receiver footprint is kilometres wide.
  const pad = .25, px = (hi[0]! - lo[0]! + 2 * pad) / Math.max(1, size - 2) + pad, py = (hi[1]! - lo[1]! + 2 * pad) / Math.max(1, size - 2) + pad;
  const kept: T[] = [];
  let front = lo[2]!;
  for (const candidate of candidates) {
    const b = projected(candidate);
    const overlaps = b[3]! >= lo[0]! - px && b[0]! <= hi[0]! + px && b[4]! >= lo[1]! - py && b[1]! <= hi[1]! + py && b[2]! <= hi[2]! + pad;
    if (overlaps) { kept.push(candidate); front = Math.min(front, b[2]!); }
  }
  const sx = 2 / Math.max(.5, hi[0]! - lo[0]! + 2 * px), sy = 2 / Math.max(.5, hi[1]! - lo[1]! + 2 * py), sz = 1 / Math.max(.5, hi[2]! - front + 2 * pad);
  const cx = (lo[0]! + hi[0]!) * .5, cy = (lo[1]! + hi[1]!) * .5;
  return { casters: cull ? kept : candidates, matrix: Float32Array.from([
    r[0]! * sx, u[0]! * sy, f[0]! * sz, 0, r[1]! * sx, u[1]! * sy, f[1]! * sz, 0,
    r[2]! * sx, u[2]! * sy, f[2]! * sz, 0, -cx * sx, -cy * sy, -(front - pad) * sz, 1,
  ]) };
}
