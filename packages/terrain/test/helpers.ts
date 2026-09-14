// Test helpers: seeded numbers, random terrains with plateaus, ramps and water.
import { createTerrain, floodWater, layRamp, rampSites } from "../src/index.ts";
import type { Terrain } from "../src/index.ts";

export const rng = (seed: number): (() => number) => {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

/** A terrain of plateaus (rectangles raised a step or two), a few ramps, a lake, mixed types. */
export function randomTerrain(seed: number, width = 48, depth = 40, { chunk = 16, water = true, ramps = 12 }: { chunk?: number; water?: boolean; ramps?: number } = {}): Terrain {
  const f = rng(seed);
  const t = createTerrain({ width, depth, chunk, fill: "grass", level: 2 });
  const types = ["grass", "dirt", "sand", "rock", "snow", "road", "path", "mud"];
  t.batch(() => {
    for (let n = 0; n < 14; n += 1) {
      const w = 3 + Math.floor(f() * Math.min(12, width - 4)), d = 3 + Math.floor(f() * Math.min(10, depth - 4));
      const i0 = Math.floor(f() * (width - w)), j0 = Math.floor(f() * (depth - d));
      const up = f() < 0.7 ? 1 : 2;
      const ty = types[Math.floor(f() * types.length)]!;
      for (let j = j0; j < j0 + d; j += 1) for (let i = i0; i < i0 + w; i += 1) { t.setHeight(i, j, t.height[t.index(i, j)]! + up); if (f() < 0.8) t.setType(i, j, ty); }
    }
    if (water) {
      // (A basin, then water in it.)
      const ci = Math.floor(width * 0.3 + f() * width * 0.4), cj = Math.floor(depth * 0.3 + f() * depth * 0.4);
      for (let j = cj - 4; j <= cj + 4; j += 1) for (let i = ci - 5; i <= ci + 5; i += 1) if (t.inside(i, j)) t.setHeight(i, j, Math.min(t.height[t.index(i, j)]!, (Math.abs(i - ci) + Math.abs(j - cj)) < 5 ? 0 : 1));
      floodWater(t, ci, cj, 2, { max: 400 });
    }
  });
  const sites = rampSites(t);
  for (let n = 0; n < ramps && sites.length; n += 1) {
    const s = sites[Math.floor(f() * sites.length)]!;
    layRamp(t, s.i, s.j, s.dir, 1 + Math.floor(f() * 3));
  }
  return t;
}
