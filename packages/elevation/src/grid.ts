// The height field itself: metres on a regular grid, and the one way every
// system reads it -- bilinear between cells, so the physics, the renderer, the
// cameras and a prop's placement all agree on the ground to the millimetre.
// Past the grid's edge the edge's heights carry on.

/** Ground heights (m) on a regular grid: row-major, x fastest; cell `cell` m; the first cell's corner at (x0, z0). */
export interface HeightGrid {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  readonly data: Float32Array;
}

/** A flat grid at `height` covering the rectangle from (x0, z0), `w` x `h` cells. */
export function createGrid(x0: number, z0: number, cell: number, w: number, h: number, height = 0): HeightGrid {
  if (!(cell > 0 && Number.isInteger(w) && Number.isInteger(h) && w >= 2 && h >= 2)) throw new RangeError(`A height grid needs a positive cell and at least 2x2 whole cells (got ${cell}, ${w}x${h}).`);
  const data = new Float32Array(w * h);
  if (height) data.fill(height);
  return { x0, z0, cell, w, h, data };
}

/** A grid covering a world rectangle (min corner, size in metres) at `cell` m. */
export const gridOver = (x0: number, z0: number, width: number, depth: number, cell: number): HeightGrid => createGrid(x0, z0, cell, Math.max(2, Math.ceil(width / cell) + 1), Math.max(2, Math.ceil(depth / cell) + 1));

/** A cell's world position. */
export const cellX = (g: HeightGrid, i: number): number => g.x0 + i * g.cell;
export const cellZ = (g: HeightGrid, j: number): number => g.z0 + j * g.cell;

/** The height at a world point: bilinear between the four cells round it. */
export function sample(g: HeightGrid, x: number, z: number): number {
  const u = Math.max(0, Math.min(g.w - 1, (x - g.x0) / g.cell)), v = Math.max(0, Math.min(g.h - 1, (z - g.z0) / g.cell));
  const i = Math.min(g.w - 2, Math.floor(u)), j = Math.min(g.h - 2, Math.floor(v)), fu = u - i, fv = v - j, d = g.data, k = j * g.w + i;
  return (d[k]! * (1 - fu) + d[k + 1]! * fu) * (1 - fv) + (d[k + g.w]! * (1 - fu) + d[k + g.w + 1]! * fu) * fv;
}

/** A height field as systems use it. */
export interface Elevation {
  heightAt(x: number, z: number): number;
  /** The ground's unit normal (x, y, z) at a point. */
  normalAt(x: number, z: number): [number, number, number];
  readonly grid: HeightGrid;
  readonly min: number;
  readonly max: number;
  /** The steepest rise between neighbouring cells (m per m): what a raycast may safely step by. */
  readonly slope: number;
}

/** A grid as an Elevation (its range and steepest slope measured once). */
export function elevationOf(g: HeightGrid): Elevation {
  let min = Infinity, max = -Infinity, slope = 0;
  for (let j = 0; j < g.h; j += 1) {
    for (let i = 0; i < g.w; i += 1) {
      const k = j * g.w + i, v = g.data[k]!;
      if (v < min) min = v;
      if (v > max) max = v;
      if (i + 1 < g.w) slope = Math.max(slope, Math.abs(g.data[k + 1]! - v) / g.cell);
      if (j + 1 < g.h) slope = Math.max(slope, Math.abs(g.data[k + g.w]! - v) / g.cell);
    }
  }
  const e = g.cell * 0.5;
  return {
    grid: g, min, max, slope,
    heightAt: (x, z) => sample(g, x, z),
    normalAt(x, z) {
      const dx = sample(g, x + e, z) - sample(g, x - e, z), dz = sample(g, x, z + e) - sample(g, x, z - e);
      const nx = -dx / (2 * e), nz = -dz / (2 * e), l = Math.sqrt(nx * nx + 1 + nz * nz);
      return [nx / l, 1 / l, nz / l];
    },
  };
}

/** Flat ground (height 0 everywhere): what a world without hills hands in. */
export const FLAT_ELEVATION: Elevation = elevationOf(createGrid(-1, -1, 1, 2, 2));

/**
 * The lowest and highest ground under an oriented box (centre, half width along its yaw, half depth, yaw as sine and
 * cosine): exact for the bilinear surface -- every grid point inside it, and its outline walked finely (where the
 * surface can peak between grid points). What a building's floor and its foundation are set by.
 */
export function rangeUnder(g: HeightGrid, x: number, z: number, hw: number, hd: number, c: number, s: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  const take = (px: number, pz: number): void => { const y = sample(g, px, pz); if (y < lo) lo = y; if (y > hi) hi = y; };
  // (The outline, every quarter cell.)
  const step = g.cell / 4;
  for (const [ax, az, bx, bz] of [[-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [hw, hd, -hw, hd], [-hw, hd, -hw, -hd]] as const) {
    const n = Math.max(1, Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) / step));
    for (let k = 0; k < n; k += 1) { const u = ax + ((bx - ax) * k) / n, v = az + ((bz - az) * k) / n; take(x + u * c + v * s, z - u * s + v * c); }
  }
  // (Every grid point inside.)
  const r = Math.sqrt(hw * hw + hd * hd);
  const i0 = Math.max(0, Math.floor((x - r - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.ceil((x + r - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((z - r - g.z0) / g.cell)), j1 = Math.min(g.h - 1, Math.ceil((z + r - g.z0) / g.cell));
  for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) {
    const px = g.x0 + i * g.cell - x, pz = g.z0 + j * g.cell - z, u = px * c - pz * s, v = px * s + pz * c;
    if (Math.abs(u) <= hw && Math.abs(v) <= hd) { const y = g.data[j * g.w + i]!; if (y < lo) lo = y; if (y > hi) hi = y; }
  }
  return [lo, hi];
}
