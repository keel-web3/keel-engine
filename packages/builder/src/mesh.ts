// Greedy box merging: voxels -> as few boxes as possible, one label per box
// (a role; or a role within a group, or within a bone). The boxes never
// overlap and their union is exactly the voxel set -- every cell of a box
// has the box's label -- so an object made of them looks and collides as
// the voxels do, at a fraction of the solids (the renderer draws 256 boxes a
// scene; a 12x8 flag is 96 voxels, and 1 box).
//
//   const boxes = greedyBoxes(model);                            // by role
//   const boxes = greedyBoxes(model, { label: byGroupAndRole(model) });
//   meshStats(model)  -> { voxels, runs, boxes }                   // naive, row runs, greedy
//
// The sweep: the first unmerged cell (y, then z, then x) grows along its first
// axis as far as the label runs, then its second axis while the whole row
// matches, then its third while the whole slab matches. Which axis goes first
// changes the count; `order: "best"` tries all six and keeps the fewest.

import type { Dense, V3, VoxelModel } from "./voxels.ts";

/** A box of voxels: min inclusive, size in voxels, the label it carries. */
export interface VoxelBox {
  readonly min: V3;
  readonly size: V3;
  readonly label: number;
}

export type AxisOrder = readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
export const AXIS_ORDERS: readonly AxisOrder[] = [[0, 2, 1], [0, 1, 2], [2, 0, 1], [2, 1, 0], [1, 0, 2], [1, 2, 0]];

export interface GreedyOptions {
  /** A cell's label (0: not merged, left out). Default: its palette index (its role). */
  readonly label?: (x: number, y: number, z: number, index: number) => number;
  /** Which axis grows first, second, third; "best" tries all six (default). */
  readonly order?: AxisOrder | "best";
}

/** Labels over a model's dense box (Int32: role, group * 256 + role, bone * 256 + role...). */
export function labelGrid(d: Dense, label?: GreedyOptions["label"]): Int32Array {
  const out = new Int32Array(d.data.length);
  const [sx, sy] = d.size;
  for (let i = 0; i < d.data.length; i += 1) {
    const v = d.data[i]!;
    if (!v) continue;
    if (!label) { out[i] = v; continue; }
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    out[i] = label(d.min[0] + x, d.min[1] + y, d.min[2] + z, v);
  }
  return out;
}

/** Greedy boxes over a label grid of `size` (index x + sx * (y + sy * z)); boxes in grid coordinates offset by `min`. */
export function greedyGrid(labels: Int32Array, size: V3, min: V3, order: AxisOrder): VoxelBox[] {
  const [sx, sy, sz] = size;
  const used = new Uint8Array(labels.length);
  const idx = (x: number, y: number, z: number): number => x + sx * (y + sy * z);
  const out: VoxelBox[] = [];
  const p: V3 = [0, 0, 0];
  for (let z = 0; z < sz; z += 1) for (let y = 0; y < sy; y += 1) for (let x = 0; x < sx; x += 1) {
    const i0 = idx(x, y, z);
    const L = labels[i0]!;
    if (!L || used[i0]) continue;
    const lo: V3 = [x, y, z];
    const ext: V3 = [1, 1, 1];
    const fits = (a: 0 | 1 | 2, n: number): boolean => {
      // (Would the box grow one more cell along axis a? Every cell of the new face must match and be free.)
      const f: V3 = [...ext];
      f[a] = 1;
      const base: V3 = [...lo];
      base[a] = lo[a] + n;
      if (base[a] >= size[a]) return false;
      for (let k = 0; k < f[2]; k += 1) for (let j = 0; j < f[1]; j += 1) for (let i = 0; i < f[0]; i += 1) {
        p[0] = base[0] + i; p[1] = base[1] + j; p[2] = base[2] + k;
        const q = idx(p[0], p[1], p[2]);
        if (labels[q] !== L || used[q]) return false;
      }
      return true;
    };
    for (const a of order) { while (fits(a, ext[a])) ext[a] += 1; }
    for (let k = 0; k < ext[2]; k += 1) for (let j = 0; j < ext[1]; j += 1) for (let i = 0; i < ext[0]; i += 1) used[idx(lo[0] + i, lo[1] + j, lo[2] + k)] = 1;
    out.push({ min: [min[0] + lo[0], min[1] + lo[1], min[2] + lo[2]], size: ext, label: L });
  }
  return out;
}

/** A model as greedy boxes (see the top). */
export function greedyBoxes(model: VoxelModel, { label, order = "best" }: GreedyOptions = {}): VoxelBox[] {
  const d = model.dense();
  if (!d.data.length) return [];
  const labels = labelGrid(d, label);
  if (order !== "best") return greedyGrid(labels, d.size, d.min, order);
  let best: VoxelBox[] | null = null;
  for (const o of AXIS_ORDERS) {
    const b = greedyGrid(labels, d.size, d.min, o);
    if (!best || b.length < best.length) best = b;
  }
  return best!;
}

/** Row runs (the one-axis merge), for comparison: how many x-runs of one label. */
export function rowRuns(model: VoxelModel): number {
  const d = model.dense();
  const [sx] = d.size;
  let n = 0;
  for (let i = 0; i < d.data.length; i += 1) {
    const v = d.data[i]!;
    if (v && (i % sx === 0 || d.data[i - 1] !== v)) n += 1;
  }
  return n;
}

/** Voxels (naive: a box each), row runs, greedy boxes. */
export function meshStats(model: VoxelModel, opts: GreedyOptions = {}): { voxels: number; runs: number; boxes: number } {
  return { voxels: model.count, runs: rowRuns(model), boxes: greedyBoxes(model, opts).length };
}

/** Every cell of a set of boxes (to prove the union exact): "x,y,z" -> label; throws on an overlap. */
export function rasterize(boxes: readonly VoxelBox[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of boxes) for (let z = 0; z < b.size[2]; z += 1) for (let y = 0; y < b.size[1]; y += 1) for (let x = 0; x < b.size[0]; x += 1) {
    const k = `${b.min[0] + x},${b.min[1] + y},${b.min[2] + z}`;
    if (out.has(k)) throw new Error(`Boxes overlap at ${k}.`);
    out.set(k, b.label);
  }
  return out;
}

/** Labels by group (1-based order of model.groups; 0 none) and role: group * 256 + role index. */
export function byGroupAndRole(model: VoxelModel): (x: number, y: number, z: number, index: number) => number {
  const names = [...model.groups.keys()];
  return (x, y, z, v) => { const g = model.groupAt(x, y, z); return (g === null ? 0 : names.indexOf(g) + 1) * 256 + v; };
}
