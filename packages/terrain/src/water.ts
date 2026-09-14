// Water: a surface level over the ground. A tile is wet when its water level
// stands above its ground; one step of water is SHALLOW (fordable by the
// ground move classes, at a cost), two or more DEEP (hover and boats only).
// Shores and foam are auto-tiles (autotile.ts rules "shore" and "foam"); the
// ground baker paints water with the palette's cycling water ramps, so it
// moves without a rebake.

import { DX4, DZ4, WATER_NONE } from "./types.ts";
import type { Terrain } from "./grid.ts";

export type WaterClass = "dry" | "shallow" | "deep";

/** A tile's water: dry, shallow (one step) or deep (two or more). */
export function waterClass(t: Terrain, i: number, j: number): WaterClass {
  const d = t.waterDepth(i, j);
  return d === 0 ? "dry" : d === 1 ? "shallow" : "deep";
}

/**
 * Fill a basin: every tile 4-connected to (i, j) whose ground is below `level`
 * gets water at `level` (a lake, a sea). `max` caps how many tiles it may take
 * (a basin that leaks off the map would otherwise flood it all); over the cap,
 * nothing is filled and null comes back.
 */
export function floodWater(t: Terrain, i: number, j: number, level: number, { max = Infinity, edges = true }: { readonly max?: number; readonly edges?: boolean } = {}): Array<[number, number]> | null {
  if (!t.inside(i, j) || t.height[t.index(i, j)]! >= level) return [];
  const seen = new Uint8Array(t.width * t.depth);
  const out: Array<[number, number]> = [];
  const stack: number[] = [t.index(i, j)];
  seen[t.index(i, j)] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const ci = k % t.width, cj = (k - ci) / t.width;
    out.push([ci, cj]);
    if (out.length > max) return null;
    for (let d = 0; d < 4; d += 1) {
      const ni = ci + DX4[d]!, nj = cj + DZ4[d]!;
      if (!t.inside(ni, nj)) { if (!edges) return null; continue; }
      const nk = t.index(ni, nj);
      if (seen[nk] || t.height[nk]! >= level) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  t.batch(() => { for (const [a, b] of out) t.setWater(a, b, level); });
  return out;
}

/** Take the water off tiles (all, or those whose level is `level`). */
export function drain(t: Terrain, level: number | null = null): number {
  let n = 0;
  t.batch(() => {
    for (let k = 0; k < t.water.length; k += 1) {
      const w = t.water[k]!;
      if (w === WATER_NONE || (level !== null && w !== level)) continue;
      t.setWater(k % t.width, Math.floor(k / t.width), null);
      n += 1;
    }
  });
  return n;
}

/** A body of water: its tiles (4-connected, one level), its level, its bounding rectangle [i0, j0, i1, j1] inclusive. */
export interface WaterBody {
  readonly level: number;
  readonly tiles: number;
  readonly rect: readonly [number, number, number, number];
  /** Tiles that are deep. */
  readonly deep: number;
  /** A tile in it. */
  readonly at: readonly [number, number];
}

/** Every body of water on the map, largest first. */
export function waterBodies(t: Terrain): WaterBody[] {
  const seen = new Uint8Array(t.width * t.depth);
  const out: WaterBody[] = [];
  for (let k0 = 0; k0 < seen.length; k0 += 1) {
    if (seen[k0] || t.water[k0] === WATER_NONE || t.water[k0]! <= t.height[k0]!) continue;
    const level = t.water[k0]!;
    const stack = [k0];
    seen[k0] = 1;
    let tiles = 0, deep = 0, i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % t.width, j = (k - i) / t.width;
      tiles += 1;
      if (level - t.height[k]! >= 2) deep += 1;
      i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j);
      for (let d = 0; d < 4; d += 1) {
        const ni = i + DX4[d]!, nj = j + DZ4[d]!;
        if (!t.inside(ni, nj)) continue;
        const nk = t.index(ni, nj);
        if (seen[nk] || t.water[nk] !== level || t.water[nk]! <= t.height[nk]!) continue;
        seen[nk] = 1;
        stack.push(nk);
      }
    }
    out.push({ level, tiles, deep, rect: [i0, j0, i1, j1], at: [k0 % t.width, Math.floor(k0 / t.width)] });
  }
  return out.sort((a, b) => b.tiles - a.tiles || a.at[1] - b.at[1] || a.at[0] - b.at[0]);
}

/**
 * Carve a river along a path of tiles (source first): its water level never
 * rises downstream (the lowest bank so far), its bed `depth` steps under the
 * water, `width` tiles across. Returns the levels along the path.
 */
export function carveRiver(t: Terrain, path: readonly (readonly [number, number])[], { width = 2, depth = 1, flag = 16 }: { readonly width?: number; readonly depth?: number; readonly flag?: number } = {}): number[] {
  const levels: number[] = [];
  let lv = Infinity;
  for (const [i, j] of path) {
    const k = t.index(i, j);
    // (A river already wet here -- the sea, a lake -- sets the level it flows into.)
    const here = t.water[k] !== WATER_NONE ? t.water[k]! : t.height[k]!;
    lv = Math.min(lv, here);
    levels.push(lv);
  }
  const r0 = -Math.floor((width - 1) / 2), r1 = r0 + width - 1;
  t.batch(() => {
    path.forEach(([i, j], s) => {
      const level = levels[s]!;
      for (let dj = r0; dj <= r1; dj += 1) for (let di = r0; di <= r1; di += 1) {
        const a = i + di, b = j + dj;
        if (!t.inside(a, b)) continue;
        const k = t.index(a, b);
        const bed = level - depth;
        if (t.water[k] !== WATER_NONE && t.water[k]! < level) continue; // (don't raise water already lower: the sea, a lower stretch)
        if (t.height[k]! > bed) t.setHeight(a, b, bed);
        t.setRamp(a, b, null);
        t.setWater(a, b, level);
        t.setFlag(a, b, flag, true);
      }
    });
  });
  return levels;
}
