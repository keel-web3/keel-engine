// The tile systems: how a cell's neighbours pick the tile drawn there. One
// grid can use several at once, a system per material (see surface.ts).
//
//   blend       no tiles: the material's edge is a noisy field between cell
//               centres, cut at the pixel grid (organic, crisp, no art needed)
//   blob47      the 47-tile Wang blob set from the 8 neighbours (corners count
//               only where both edges beside them are in)
//   wang16      16 tiles by corner: a corner is in when its two edges and the
//               diagonal are (NE 1, SE 2, SW 4, NW 8)
//   cardinal16  16 tiles by edge (N 1, E 2, S 4, W 8): roads, paths, fences
//   dual16      the dual grid: tiles sit half a cell off, their four corners on
//               four cell centres (NE 1, SE 2, SW 4, NW 8), so 16 tiles cover
//               every case the blob set does
//
// Neighbours go round from north (+z) clockwise, bit k for neighbour k: N 0,
// NE 1, E 2, SE 3, S 4, SW 5, W 6, NW 7 -- the same order as keel/terrain's
// autotile masks, so a blob index here is the same tile there.

export type TileSystem = "blend" | "blob47" | "wang16" | "cardinal16" | "dual16";
export const TILE_SYSTEMS: readonly TileSystem[] = ["blend", "blob47", "wang16", "cardinal16", "dual16"];
/** The shader's number for each system. */
export const SYSTEM_CODE: Readonly<Record<TileSystem, number>> = { blend: 0, blob47: 1, wang16: 2, cardinal16: 3, dual16: 4 };
/** How many tiles a system's atlas holds, and how many to a row. */
export const SYSTEM_TILES: Readonly<Record<Exclude<TileSystem, "blend">, { readonly count: number; readonly cols: number }>> = {
  blob47: { count: 47, cols: 8 },
  wang16: { count: 16, cols: 4 },
  cardinal16: { count: 16, cols: 4 },
  dual16: { count: 16, cols: 4 },
};

export const DX8 = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const DZ8 = [1, 1, 0, -1, -1, -1, 0, 1] as const;

/** A blob mask reduced: corner bits kept only where both edges beside them are set. */
export function reduceBlob(mask: number): number {
  let m = mask & 0x55;
  for (let c = 1; c < 8; c += 2) {
    const a = (c + 7) & 7, b = (c + 1) & 7;
    if (mask & (1 << c) && mask & (1 << a) && mask & (1 << b)) m |= 1 << c;
  }
  return m;
}
/** The 47 reduced masks, ascending: blob tile i is BLOB47[i]. */
export const BLOB47: readonly number[] = [...new Set(Array.from({ length: 256 }, (_, m) => reduceBlob(m)))].sort((a, b) => a - b);
/** Every raw 8-bit mask's blob tile (0..46): the shader's lookup table. */
export const BLOB_LUT: Uint8Array = Uint8Array.from({ length: 256 }, (_, m) => BLOB47.indexOf(reduceBlob(m)));
export const blobIndex = (mask: number): number => BLOB_LUT[mask & 255]!;
/** Corners from an 8-neighbour mask: a corner in when its two edges and the diagonal are (NE 1, SE 2, SW 4, NW 8). */
export function wangIndex(mask: number): number {
  const on = (a: number, b: number, c: number): boolean => (mask & (1 << a)) !== 0 && (mask & (1 << b)) !== 0 && (mask & (1 << c)) !== 0;
  return (on(0, 1, 2) ? 1 : 0) | (on(2, 3, 4) ? 2 : 0) | (on(4, 5, 6) ? 4 : 0) | (on(6, 7, 0) ? 8 : 0);
}
/** Edges from an 8-neighbour mask (N 1, E 2, S 4, W 8). */
export const cardinalIndex = (mask: number): number => (mask & 1) | ((mask >> 1) & 2) | ((mask >> 2) & 4) | ((mask >> 3) & 8);
/** A dual tile from its four corner cells (true: in). */
export const dualIndex = (ne: boolean, se: boolean, sw: boolean, nw: boolean): number => (ne ? 1 : 0) | (se ? 2 : 0) | (sw ? 4 : 0) | (nw ? 8 : 0);

/** The tile a system draws for an 8-neighbour mask (blob47, wang16 or cardinal16). */
export function tileFor(system: "blob47" | "wang16" | "cardinal16", mask: number): number {
  return system === "blob47" ? blobIndex(mask) : system === "wang16" ? wangIndex(mask) : cardinalIndex(mask);
}

/**
 * The 3 x 3 neighbourhood a tile stands for, row by row from the north-west
 * (true: the material is there; the centre is always in): what an atlas
 * painter needs to draw that tile. A dual tile's 2 x 2 corners come back as
 * the four outer corners (the middle row and column copy their neighbours).
 */
export function tileNeighbourhood(system: Exclude<TileSystem, "blend">, index: number): boolean[] {
  if (system === "dual16") {
    const ne = (index & 1) !== 0, se = (index & 2) !== 0, sw = (index & 4) !== 0, nw = (index & 8) !== 0;
    return [nw, nw || ne, ne, nw || sw, true, ne || se, sw, sw || se, se];
  }
  let mask: number;
  if (system === "blob47") mask = BLOB47[index] ?? 0;
  else if (system === "wang16") {
    // A corner's three cells in; an edge cell in when either corner beside it is.
    mask = 0;
    const corners: ReadonlyArray<readonly [number, number, number]> = [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0]];
    corners.forEach((cells, c) => { if (index & (1 << c)) for (const k of cells) mask |= 1 << k; });
  } else mask = (index & 1 ? 1 : 0) | (index & 2 ? 4 : 0) | (index & 4 ? 16 : 0) | (index & 8 ? 64 : 0);
  // Neighbour k sits at (DX8[k], DZ8[k]); north is the top row.
  const out = [false, false, false, false, true, false, false, false, false];
  for (let k = 0; k < 8; k += 1) if (mask & (1 << k)) out[(1 - DZ8[k]!) * 3 + (DX8[k]! + 1)] = true;
  return out;
}
