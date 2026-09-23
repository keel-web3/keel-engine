// Where a ray meets the ground: a camera held above a hill, a click picked on
// the terrain, a headlight's reach. Each step is as long as it can safely be --
// the height above the ground over how fast the ray can close on it (its own
// fall plus the field's steepest slope) -- so open air is crossed in a few
// strides; the hit is bisected to a few millimetres. The GLSL in glsl.ts is the
// same march, so the CPU and the GPU agree on the ground.

import type { Elevation } from "./grid.ts";

/** The distance along a ray (unit direction) to the ground, or -1 if it doesn't meet it within `far`. */
export function raycast(e: Elevation, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, near = 0): number {
  const close = Math.max(0, -dy) + e.slope * Math.sqrt(dx * dx + dz * dz) + 1e-6;
  let t = near, prev = t;
  for (let k = 0; k < 256; k += 1) {
    const h = oy + dy * t - e.heightAt(ox + dx * t, oz + dz * t);
    if (h < 0) {
      let lo = prev, hi = t;
      for (let r = 0; r < 20; r += 1) { const m = (lo + hi) / 2; if (oy + dy * m - e.heightAt(ox + dx * m, oz + dz * m) < 0) hi = m; else lo = m; }
      return hi;
    }
    if (t >= far) return -1;
    prev = t;
    t = Math.min(far, t + Math.max(0.05 + t * 0.002, h / close));
  }
  // (Out of steps without passing `far`: a grazing ray skimming the ground -- where it had got to is the answer.)
  return t;
}
