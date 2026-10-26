// A tile grid: one material per cell, materials ordered from the base (0) up.
// A higher material lies over every lower one, so a cell "has" material L
// when its own material is L or above: the grass's edge runs over the dirt,
// the dirt's over the sand. That is the membership every tile system reads.

import { DX8, DZ8, dualIndex, tileFor } from "./systems.ts";
import type { TileSystem } from "./systems.ts";

export interface TileGrid {
  readonly width: number;
  readonly depth: number;
  /** Material names, base first. */
  readonly materials: readonly string[];
  /** One material index per cell, row by row along +x, rows along +z. */
  readonly cells: Uint8Array;
  /** Bumped by every change, so a surface knows to upload. */
  readonly version: number;
  index(material: string): number;
  /** The cell's material index (cells off the grid read as their nearest edge cell). */
  at(x: number, z: number): number;
  set(x: number, z: number, material: string | number): void;
  fill(material: string | number): void;
  /** Paints every cell whose centre `inside` accepts. */
  paint(material: string | number, inside: (x: number, z: number) => boolean): void;
  /** True when cell (x, z) has material L or one above it. */
  has(x: number, z: number, layer: number): boolean;
  /** The 8-neighbour mask of material L round cell (x, z) (N 0 .. NW 7). */
  mask(x: number, z: number, layer: number): number;
  /** The tile a system draws for material L at cell (x, z); a dual tile at grid vertex (x, z), between cells x-1..x and z-1..z. */
  tile(system: Exclude<TileSystem, "blend">, x: number, z: number, layer: number): number;
}

export function createTileGrid({ width, depth, materials, fill = 0 }: { readonly width: number; readonly depth: number; readonly materials: readonly string[]; readonly fill?: string | number }): TileGrid {
  if (!Number.isInteger(width) || !Number.isInteger(depth) || width < 1 || depth < 1 || width > 4096 || depth > 4096) throw new RangeError("A tile grid is 1..4096 cells on a side.");
  if (materials.length < 1 || materials.length > 8) throw new RangeError("A tile grid has 1..8 materials.");
  if (new Set(materials).size !== materials.length) throw new Error("Tile materials must be distinct.");
  const cells = new Uint8Array(width * depth);
  let version = 0;
  const resolve = (m: string | number): number => {
    const i = typeof m === "number" ? m : materials.indexOf(m);
    if (!Number.isInteger(i) || i < 0 || i >= materials.length) throw new Error(`Unknown tile material ${String(m)}.`);
    return i;
  };
  const at = (x: number, z: number): number => cells[Math.min(depth - 1, Math.max(0, z)) * width + Math.min(width - 1, Math.max(0, x))]!;
  const has = (x: number, z: number, layer: number): boolean => at(x, z) >= layer;
  const mask = (x: number, z: number, layer: number): number => {
    let m = 0;
    for (let k = 0; k < 8; k += 1) if (has(x + DX8[k]!, z + DZ8[k]!, layer)) m |= 1 << k;
    return m;
  };
  cells.fill(resolve(fill));
  return {
    width, depth, materials, cells,
    get version() { return version; },
    index: (m) => resolve(m),
    at, has, mask,
    set(x, z, m) {
      if (x < 0 || z < 0 || x >= width || z >= depth) return;
      const i = resolve(m);
      if (cells[z * width + x] === i) return;
      cells[z * width + x] = i;
      version += 1;
    },
    fill(m) { cells.fill(resolve(m)); version += 1; },
    paint(m, inside) {
      const i = resolve(m);
      for (let z = 0; z < depth; z += 1) for (let x = 0; x < width; x += 1) if (inside(x + 0.5, z + 0.5)) cells[z * width + x] = i;
      version += 1;
    },
    tile(system, x, z, layer) {
      if (system === "dual16") return dualIndex(has(x, z, layer), has(x, z - 1, layer), has(x - 1, z - 1, layer), has(x - 1, z, layer));
      return tileFor(system, mask(x, z, layer));
    },
  };
}
