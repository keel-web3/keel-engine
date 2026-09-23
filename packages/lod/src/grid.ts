// Tiles: nodes gathered into an n x n grid over the ground they stand on, for a
// far pass that draws a whole city's coarsest level in a handful of draws (each
// tile one merged mesh a look). A node goes to the cell its box's middle is in.

import type { Vec3 } from "./types.ts";

export interface Tile {
  /** Its cell: column + row * n. */
  readonly cell: number;
  /** Indices into the items passed, in their order. */
  readonly members: readonly number[];
  readonly lo: Vec3;
  readonly hi: Vec3;
}

/** Group boxes into an n x n grid over their xz extent (empty cells left out; cells in order). */
export function gridTiles(items: readonly { readonly lo: Vec3; readonly hi: Vec3 }[], n: number): Tile[] {
  if (!items.length) return [];
  const cells = Math.max(1, Math.floor(n));
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const it of items) {
    const cx = (it.lo[0] + it.hi[0]) / 2, cz = (it.lo[2] + it.hi[2]) / 2;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz);
  }
  const w = Math.max(1e-6, x1 - x0), d = Math.max(1e-6, z1 - z0);
  const groups = new Map<number, number[]>();
  items.forEach((it, i) => {
    const cx = (it.lo[0] + it.hi[0]) / 2, cz = (it.lo[2] + it.hi[2]) / 2;
    const col = Math.min(cells - 1, Math.floor(((cx - x0) / w) * cells)), row = Math.min(cells - 1, Math.floor(((cz - z0) / d) * cells));
    const cell = col + row * cells;
    const g = groups.get(cell);
    if (g) g.push(i); else groups.set(cell, [i]);
  });
  return [...groups.keys()].sort((a, b) => a - b).map((cell) => {
    const members = groups.get(cell)!;
    const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const i of members) for (let a = 0; a < 3; a += 1) { lo[a] = Math.min(lo[a]!, items[i]!.lo[a]!); hi[a] = Math.max(hi[a]!, items[i]!.hi[a]!); }
    return { cell, members, lo, hi };
  });
}
