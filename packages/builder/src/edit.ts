// Editing: the brush ops a person (or an agent) builds with, symmetry, and an
// undo history kept as compact diffs.
//
//   const ed = createEditor(createVoxels(), { symmetry: { mode: "x" } });
//   ed.box([-2, 0, -1], [1, 3, 1], "primary");   // one history entry
//   ed.sphere([0, 6, 0], 2.5, "skin");
//   ed.undo(); ed.redo();
//   ed.log();                                     // the ops that made it (replayable JSON)
//
// Every op is a BrushOp (plain JSON). Under symmetry each cell an op writes is
// also written at its mirror images, so a person builds half a critter and
// gets the whole. History entries hold the op and, for every cell it changed,
// the cell's packed position and its index before and after (Int16 triplets +
// two bytes a cell): undo and redo are exact and cost what the op changed.

import { createVoxels, regionOf } from "./voxels.ts";
import type { V3, Vec3i, VoxelModel } from "./voxels.ts";

/** none · x: mirror across the plane x = cx · xz: across x = cx and z = cz · radial4: four turns about the y axis through (cx, cz). */
export type SymmetryMode = "none" | "x" | "z" | "xz" | "radial4";
export interface Symmetry {
  readonly mode: SymmetryMode;
  /**
   * The mirror plane(s) in voxel coordinates: [cx, cz]. A whole number puts
   * the plane between two voxels (cx = 0: between -1 and 0, so voxel x meets
   * -1 - x); a half puts it through a voxel's middle (cx = 0.5: voxel 0 is its own mirror).
   */
  readonly center?: readonly [number, number];
}

/** Plain-JSON brush ops (the agent op list's building half; ops.ts validates them). */
export type BrushOp =
  | { readonly op: "set"; readonly at: Vec3i; readonly role: string | null }
  | { readonly op: "box"; readonly from: Vec3i; readonly to: Vec3i; readonly role: string | null; readonly hollow?: boolean }
  | { readonly op: "fill"; readonly from: Vec3i; readonly to: Vec3i; readonly role: string | null; readonly only?: string | null }
  | { readonly op: "sphere"; readonly center: readonly [number, number, number]; readonly radius: number; readonly role: string | null; readonly scale?: readonly [number, number, number] }
  | { readonly op: "line"; readonly from: Vec3i; readonly to: Vec3i; readonly role: string | null; readonly radius?: number }
  | { readonly op: "mirror"; readonly axis: "x" | "z"; readonly center?: number; readonly keep?: "positive" | "negative" }
  | { readonly op: "erase"; readonly from?: Vec3i; readonly to?: Vec3i }
  | { readonly op: "recolour"; readonly from: string; readonly to: string; readonly region?: { readonly from: Vec3i; readonly to: Vec3i } };

/** Symmetry for the ops after it (not itself a history entry: the entries remember the symmetry they ran under). */
export interface SymmetryOp { readonly op: "symmetry"; readonly mode: SymmetryMode; readonly center?: readonly [number, number] }
export type EditOp = BrushOp | SymmetryOp;

export interface HistoryEntry {
  readonly op: BrushOp;
  readonly symmetry: Symmetry;
  /** Changed cells: x, y, z triplets. */
  readonly at: Int16Array;
  readonly before: Uint8Array;
  readonly after: Uint8Array;
}

export interface EditorOptions {
  readonly symmetry?: Symmetry;
  /** Undo depth (default 512 entries). */
  readonly depth?: number;
}

export interface Editor {
  readonly model: VoxelModel;
  symmetry: Symmetry;
  /** Run a brush op (under the current symmetry) as one history entry; returns how many cells changed. A symmetry op sets the symmetry (0). */
  apply(op: EditOp): number;
  set(at: Vec3i, role: string | null): number;
  box(from: Vec3i, to: Vec3i, role: string | null, opts?: { hollow?: boolean }): number;
  fill(from: Vec3i, to: Vec3i, role: string | null, only?: string | null): number;
  sphere(center: readonly [number, number, number], radius: number, role: string | null, scale?: readonly [number, number, number]): number;
  line(from: Vec3i, to: Vec3i, role: string | null, radius?: number): number;
  mirror(axis: "x" | "z", opts?: { center?: number; keep?: "positive" | "negative" }): number;
  erase(from?: Vec3i, to?: Vec3i): number;
  recolour(from: string, to: string, region?: { from: Vec3i; to: Vec3i }): number;
  undo(): boolean;
  redo(): boolean;
  /** The entry undo() would revert, and the one redo() would re-apply (what a live preview reads). */
  last(): HistoryEntry | undefined;
  next(): HistoryEntry | undefined;
  /** The last n entries in effect, oldest first (what an op made: a recolour over a group's regions is several). */
  recent(n: number): HistoryEntry[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The ops in effect (undone ones left out), symmetry ops where it changed: replaying them on an empty model rebuilds this one. */
  log(): EditOp[];
  /** History entries in effect, and what they hold (bytes). */
  history(): { entries: number; cells: number; bytes: number; serial: number };
}

/** Every mirror image of a cell under a symmetry (the cell itself first, no repeats). */
export function imagesOf(x: number, y: number, z: number, sym: Symmetry): V3[] {
  const [cx, cz] = sym.center ?? [0, 0];
  const mx = (v: number): number => Math.round(2 * cx - 1 - v);
  const mz = (v: number): number => Math.round(2 * cz - 1 - v);
  let list: V3[];
  switch (sym.mode) {
    case "x": list = [[x, y, z], [mx(x), y, z]]; break;
    case "z": list = [[x, y, z], [x, y, mz(z)]]; break;
    case "xz": list = [[x, y, z], [mx(x), y, z], [x, y, mz(z)], [mx(x), y, mz(z)]]; break;
    case "radial4": {
      // (Turns about the axis through the corner/middle (cx, cz): a voxel's centre (x + 0.5, z + 0.5) turned by 90 degrees.)
      const px = x + 0.5 - cx;
      const pz = z + 0.5 - cz;
      const turn = (a: number, b: number): V3 => [Math.round(a + cx - 0.5), y, Math.round(b + cz - 0.5)];
      list = [turn(px, pz), turn(-pz, px), turn(-px, -pz), turn(pz, -px)];
      break;
    }
    default: list = [[x, y, z]];
  }
  const seen = new Set<string>();
  return list.filter((p) => { const k = p.join(","); if (seen.has(k)) return false; seen.add(k); return true; });
}

const int3 = (v: readonly number[], what: string): V3 => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isInteger(n))) throw new TypeError(`${what} must be [x, y, z] whole numbers.`);
  return [v[0]!, v[1]!, v[2]!];
};

/** The cells an op covers (before symmetry), and what goes in each (a role, or null to empty it); `mirror`/`recolour` read the model. */
function cellsOf(op: BrushOp, model: VoxelModel, emit: (x: number, y: number, z: number, role: string | null) => void): void {
  switch (op.op) {
    case "set": { const p = int3(op.at, "set.at"); emit(p[0], p[1], p[2], op.role); return; }
    case "box":
    case "fill": {
      const r = regionOf(int3(op.from, `${op.op}.from`), int3(op.to, `${op.op}.to`));
      const only = op.op === "fill" ? op.only : undefined;
      const hollow = op.op === "box" && op.hollow;
      for (let y = r.min[1]; y <= r.max[1]; y += 1) for (let z = r.min[2]; z <= r.max[2]; z += 1) for (let x = r.min[0]; x <= r.max[0]; x += 1) {
        if (hollow && x > r.min[0] && x < r.max[0] && y > r.min[1] && y < r.max[1] && z > r.min[2] && z < r.max[2]) continue;
        if (only !== undefined && model.roleAt(x, y, z) !== only) continue;
        emit(x, y, z, op.role);
      }
      return;
    }
    case "sphere": {
      const [cx, cy, cz] = op.center;
      const [sx, sy, sz] = op.scale ?? [1, 1, 1];
      const R = op.radius;
      if (!(R > 0)) throw new RangeError("sphere.radius must be positive.");
      // (A voxel is in when its centre is inside the (scaled) ball.)
      for (let y = Math.floor(cy - R * sy); y <= Math.ceil(cy + R * sy); y += 1) for (let z = Math.floor(cz - R * sz); z <= Math.ceil(cz + R * sz); z += 1) for (let x = Math.floor(cx - R * sx); x <= Math.ceil(cx + R * sx); x += 1) {
        const dx = (x + 0.5 - cx) / sx, dy = (y + 0.5 - cy) / sy, dz = (z + 0.5 - cz) / sz;
        if (dx * dx + dy * dy + dz * dz <= R * R) emit(x, y, z, op.role);
      }
      return;
    }
    case "line": {
      const a = int3(op.from, "line.from");
      const b = int3(op.to, "line.to");
      const r = op.radius ?? 0;
      const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
      const ri = Math.ceil(r);
      const done = new Set<string>();
      for (let i = 0; i <= n; i += 1) {
        const c = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n].map(Math.round) as V3;
        for (let dy = -ri; dy <= ri; dy += 1) for (let dz = -ri; dz <= ri; dz += 1) for (let dx = -ri; dx <= ri; dx += 1) {
          if (dx * dx + dy * dy + dz * dz > r * r + 1e-9) continue;
          const k = `${c[0] + dx},${c[1] + dy},${c[2] + dz}`;
          if (done.has(k)) continue;
          done.add(k);
          emit(c[0] + dx, c[1] + dy, c[2] + dz, op.role);
        }
      }
      return;
    }
    case "mirror": {
      const c = op.center ?? 0;
      const keepPos = (op.keep ?? "positive") === "positive";
      const ax = op.axis === "x" ? 0 : 2;
      const cells: Array<[V3, string | null]> = [];
      // (The kept side is copied over the other; cells of the other side the copy doesn't cover are emptied.)
      model.forEach((x, y, z, v) => {
        const p: V3 = [x, y, z];
        const onKept = keepPos ? p[ax] + 0.5 >= c : p[ax] + 0.5 <= c;
        if (onKept) {
          const q: V3 = [x, y, z];
          q[ax] = Math.round(2 * c - 1 - p[ax]);
          if (q[ax] !== p[ax]) cells.push([q, model.roles[v - 1]!]);
        } else {
          const q: V3 = [x, y, z];
          q[ax] = Math.round(2 * c - 1 - p[ax]);
          if (!model.get(q[0], q[1], q[2])) cells.push([p, null]);
        }
      });
      for (const [p, role] of cells) emit(p[0], p[1], p[2], role);
      return;
    }
    case "erase": {
      if (!op.from || !op.to) { model.forEach((x, y, z) => emit(x, y, z, null)); return; }
      const r = regionOf(int3(op.from, "erase.from"), int3(op.to, "erase.to"));
      model.forEach((x, y, z) => { if (x >= r.min[0] && x <= r.max[0] && y >= r.min[1] && y <= r.max[1] && z >= r.min[2] && z <= r.max[2]) emit(x, y, z, null); });
      return;
    }
    case "recolour": {
      const r = op.region ? regionOf(int3(op.region.from, "recolour.region.from"), int3(op.region.to, "recolour.region.to")) : null;
      model.forEach((x, y, z, v) => {
        if (model.roles[v - 1] !== op.from) return;
        if (r && !(x >= r.min[0] && x <= r.max[0] && y >= r.min[1] && y <= r.max[1] && z >= r.min[2] && z <= r.max[2])) return;
        emit(x, y, z, op.to);
      });
      return;
    }
  }
}

// (Mirror, erase and recolour read the model as it is: symmetry would double them, so they run as given.)
const SELF_SYMMETRIC = new Set(["mirror", "erase", "recolour"]);

export function createEditor(model: VoxelModel = createVoxels(), { symmetry = { mode: "none" }, depth = 512 }: EditorOptions = {}): Editor {
  const done: HistoryEntry[] = [];
  // (Entries in effect, counted without the depth cap: what an op made is what the count grew by, even when the oldest fall off.)
  let serial = 0;
  const undone: HistoryEntry[] = [];

  const run = (op: BrushOp, sym: Symmetry): HistoryEntry => {
    const changes = new Map<number, [number, number, number, number, number]>();
    const write = (x: number, y: number, z: number, role: string | null): void => {
      const idx = role === null ? 0 : model.roleIndex(role);
      const was = model.setIndex(x, y, z, idx);
      const k = ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
      const had = changes.get(k);
      if (had) had[4] = idx;
      else if (was !== idx) changes.set(k, [x, y, z, was, idx]);
    };
    // (Collect first, then write: an op reading the model -- mirror, fill's `only` -- sees it as it was.)
    const planned: Array<[number, number, number, string | null]> = [];
    cellsOf(op, model, (x, y, z, role) => planned.push([x, y, z, role]));
    const useSym = SELF_SYMMETRIC.has(op.op) ? { mode: "none" as const } : sym;
    for (const [x, y, z, role] of planned) for (const [px, py, pz] of imagesOf(x, y, z, useSym)) write(px, py, pz, role);
    const list = [...changes.values()].filter((c) => c[3] !== c[4]);
    const at = new Int16Array(list.length * 3);
    const before = new Uint8Array(list.length);
    const after = new Uint8Array(list.length);
    list.forEach((c, i) => { at[i * 3] = c[0]; at[i * 3 + 1] = c[1]; at[i * 3 + 2] = c[2]; before[i] = c[3]; after[i] = c[4]; });
    return { op, symmetry: useSym, at, before, after };
  };

  const replay = (e: HistoryEntry, which: "before" | "after"): void => {
    const vals = e[which];
    for (let i = 0; i < vals.length; i += 1) model.setIndex(e.at[i * 3]!, e.at[i * 3 + 1]!, e.at[i * 3 + 2]!, vals[i]!);
  };

  const ed: Editor = {
    model,
    symmetry,
    apply(op) {
      if (op.op === "symmetry") { ed.symmetry = op.center ? { mode: op.mode, center: [op.center[0], op.center[1]] } : { mode: op.mode }; return 0; }
      const e = run(op, ed.symmetry);
      done.push(e);
      serial += 1;
      if (done.length > depth) done.shift();
      undone.length = 0;
      return e.before.length;
    },
    set: (at, role) => ed.apply({ op: "set", at, role }),
    box: (from, to, role, opts = {}) => ed.apply({ op: "box", from, to, role, ...(opts.hollow ? { hollow: true } : {}) }),
    fill: (from, to, role, only) => ed.apply(only === undefined ? { op: "fill", from, to, role } : { op: "fill", from, to, role, only }),
    sphere: (center, radius, role, scale) => ed.apply(scale ? { op: "sphere", center, radius, role, scale } : { op: "sphere", center, radius, role }),
    line: (from, to, role, radius) => ed.apply(radius === undefined ? { op: "line", from, to, role } : { op: "line", from, to, role, radius }),
    mirror: (axis, opts = {}) => ed.apply({ op: "mirror", axis, ...(opts.center !== undefined ? { center: opts.center } : {}), ...(opts.keep ? { keep: opts.keep } : {}) }),
    erase: (from, to) => ed.apply(from && to ? { op: "erase", from, to } : { op: "erase" }),
    recolour: (from, to, region) => ed.apply(region ? { op: "recolour", from, to, region } : { op: "recolour", from, to }),
    undo() {
      const e = done.pop();
      if (!e) return false;
      replay(e, "before");
      undone.push(e);
      serial -= 1;
      return true;
    },
    redo() {
      const e = undone.pop();
      if (!e) return false;
      replay(e, "after");
      done.push(e);
      serial += 1;
      return true;
    },
    last: () => done[done.length - 1],
    recent: (n) => (n > 0 ? done.slice(Math.max(0, done.length - n)) : []),
    next: () => undone[undone.length - 1],
    get canUndo() { return done.length > 0; },
    get canRedo() { return undone.length > 0; },
    log() {
      // (Each op under the symmetry it ran with: a symmetry op goes in front where it changes.)
      const out: EditOp[] = [];
      let last = "none";
      for (const e of done) {
        const key = e.symmetry.mode === "none" ? "none" : `${e.symmetry.mode}@${(e.symmetry.center ?? [0, 0]).join(",")}`;
        if (key !== last) out.push(e.symmetry.center ? { op: "symmetry", mode: e.symmetry.mode, center: [e.symmetry.center[0], e.symmetry.center[1]] } : { op: "symmetry", mode: e.symmetry.mode });
        last = key;
        out.push(e.op);
      }
      return out;
    },
    history() {
      const cells = done.reduce((n, e) => n + e.before.length, 0);
      return { entries: done.length, cells, bytes: cells * 8, serial };
    },
  };
  return ed;
}

/** Replay edit ops (a log) onto a model. */
export function replayOps(ops: readonly EditOp[], model: VoxelModel = createVoxels(), symmetry: Symmetry = { mode: "none" }): VoxelModel {
  const ed = createEditor(model, { symmetry, depth: 1 });
  for (const op of ops) ed.apply(op);
  return model;
}
