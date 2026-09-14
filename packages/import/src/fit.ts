// Primitive fitting: a part's voxels as a few boxes, capsules and wedges --
// the generative engine's own vocabulary -- each candidate scored by the
// overlap (IoU) of its rasterised cells with the part's:
//
//   capsule  along the principal axis (or a limb bone's segment), the radius
//            that keeps the part's bulk
//   box      turned about y to the part's horizontal principal axis (the
//            renderer's boxes turn about y only), snapped square when near
//   wedge    that box with its top sloping down to `lo` across one side
//            (roofs, lids, bevels, noses)
//   boxes    the builder's greedy boxes, biggest first until they cover it
//
// The simplest candidate that fits well enough wins (a long round part a
// capsule, else a box, a wedge only when it fits clearly better); boxes when
// nothing single does. Roles: each primitive takes the role most of its cells
// play; a role covering a good share of a part gets primitives of its own.
//
//   fitCells(cells, roleOf)               -> { prims, iou }      (voxel coordinates)
//   fittedSkin(rig, model)                -> a VoxelSkin of primitives per bone, for poseVoxels / the animator
//   rasterPrims(prims)                    -> the cells they cover (back to builder voxels: a generative base)

import { greedyGrid } from "@keel-engine/builder";
import type { BoundBox, BoundCapsule, VoxelRig, VoxelSkin } from "@keel-engine/builder";
import { restJoints } from "@keel-engine/entity";
import type { V3 } from "./math.ts";

export type Prim =
  | { readonly shape: "box"; readonly c: V3; readonly h: V3; readonly yaw: number; readonly role: string }
  | { readonly shape: "wedge"; readonly c: V3; readonly h: V3; readonly yaw: number; readonly lo: number; readonly role: string }
  | { readonly shape: "capsule"; readonly a: V3; readonly b: V3; readonly r: number; readonly role: string };

export interface PartFit {
  readonly prims: readonly Prim[];
  /** Overlap of the primitives' cells with the part's (intersection over union). */
  readonly iou: number;
  /** Which candidate won, and every candidate's IoU. */
  readonly chosen: string;
  readonly candidates: Readonly<Record<string, number>>;
}

export interface FitOptions {
  /** Fit a capsule along this segment (a limb bone), voxel coordinates. */
  readonly axis?: readonly [V3, V3];
  /** Boxes only, never turned (a creature's skin: boxes ride their bone's heading). */
  readonly axisAligned?: boolean;
  /** Most boxes for the fallback (default 6). */
  readonly maxBoxes?: number;
  /** Good enough for a single primitive (default 0.72). */
  readonly good?: number;
  /** Allow capsules (default true). */
  readonly capsules?: boolean;
}

const key = (x: number, y: number, z: number): number => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);

/** Is point p (voxel coordinates) inside the primitive? */
export function insidePrim(p: readonly number[], q: Prim): boolean {
  if (q.shape === "capsule") {
    const ab = [q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]];
    const L2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
    const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0]! - q.a[0]) * ab[0]! + (p[1]! - q.a[1]) * ab[1]! + (p[2]! - q.a[2]) * ab[2]!) / L2)) : 0;
    return Math.hypot(p[0]! - q.a[0] - ab[0]! * t, p[1]! - q.a[1] - ab[1]! * t, p[2]! - q.a[2] - ab[2]! * t) <= q.r;
  }
  // (Into the box's frame: turned by -yaw about y; core frame, x' = c x - s z, z' = s x + c z.)
  const co = Math.cos(q.yaw), si = Math.sin(q.yaw);
  const dx = p[0]! - q.c[0], dy = p[1]! - q.c[1], dz = p[2]! - q.c[2];
  const lx = co * dx - si * dz, lz = si * dx + co * dz;
  if (Math.abs(lx) > q.h[0] || Math.abs(dy) > q.h[1] || Math.abs(lz) > q.h[2]) return false;
  if (q.shape === "box") return true;
  // (The wedge's top slopes from full height at -z down to lo x its height at +z, as the renderer draws it.)
  const k = (lz + q.h[2]) / (2 * q.h[2]);
  const top = -q.h[1] + 2 * q.h[1] * (1 - k * (1 - q.lo));
  return dy <= top;
}

/** The cells (integer voxel coordinates) whose centres a primitive holds. */
export function rasterPrim(q: Prim): Array<[number, number, number]> {
  let lo: V3, hi: V3;
  if (q.shape === "capsule") {
    lo = [Math.min(q.a[0], q.b[0]) - q.r, Math.min(q.a[1], q.b[1]) - q.r, Math.min(q.a[2], q.b[2]) - q.r];
    hi = [Math.max(q.a[0], q.b[0]) + q.r, Math.max(q.a[1], q.b[1]) + q.r, Math.max(q.a[2], q.b[2]) + q.r];
  } else {
    const e = Math.hypot(q.h[0], q.h[2]);
    lo = [q.c[0] - e, q.c[1] - q.h[1], q.c[2] - e];
    hi = [q.c[0] + e, q.c[1] + q.h[1], q.c[2] + e];
  }
  const out: Array<[number, number, number]> = [];
  for (let z = Math.floor(lo[2] - 0.5); z <= Math.ceil(hi[2]); z += 1) for (let y = Math.floor(lo[1] - 0.5); y <= Math.ceil(hi[1]); y += 1) for (let x = Math.floor(lo[0] - 0.5); x <= Math.ceil(hi[0]); x += 1) {
    if (insidePrim([x + 0.5, y + 0.5, z + 0.5], q)) out.push([x, y, z]);
  }
  return out;
}

/** Cells covered by a set of primitives (each cell once), and the role the first primitive holding it gives it. */
export function rasterPrims(prims: readonly Prim[]): Map<number, { at: [number, number, number]; role: string }> {
  const out = new Map<number, { at: [number, number, number]; role: string }>();
  for (const q of prims) for (const c of rasterPrim(q)) { const k = key(...c); if (!out.has(k)) out.set(k, { at: c, role: q.role }); }
  return out;
}

/** How well primitives cover a set of cells (intersection over union of the cells their centres fall in). */
export const iouWith = (prims: readonly Prim[], cells: ReadonlyArray<readonly [number, number, number]>): number => +iouOf(prims, new Set(cells.map((c) => key(c[0], c[1], c[2])))).toFixed(3);

function iouOf(prims: readonly Prim[], set: ReadonlySet<number>): number {
  const covered = new Set<number>();
  for (const q of prims) for (const c of rasterPrim(q)) covered.add(key(...c));
  let inter = 0;
  for (const k of covered) if (set.has(k)) inter += 1;
  return inter / (covered.size + set.size - inter || 1);
}

// Jacobi eigenvectors of a symmetric 3x3: columns sorted by eigenvalue, largest first.
function eigen3(m: number[][]): { values: number[]; vectors: V3[] } {
  const a = m.map((r) => [...r]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep += 1) {
    let off = 0;
    for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) off += a[i]![j]! ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p += 1) for (let q = p + 1; q < 3; q += 1) {
      if (Math.abs(a[p]![q]!) < 1e-15) continue;
      const th = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k += 1) { const akp = a[k]![p]!, akq = a[k]![q]!; a[k]![p] = c * akp - s * akq; a[k]![q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k += 1) { const apk = a[p]![k]!, aqk = a[q]![k]!; a[p]![k] = c * apk - s * aqk; a[q]![k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k += 1) { const vkp = v[k]![p]!, vkq = v[k]![q]!; v[k]![p] = c * vkp - s * vkq; v[k]![q] = s * vkp + c * vkq; }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j]![j]! - a[i]![i]!);
  return { values: order.map((i) => a[i]![i]!), vectors: order.map((i) => [v[0]![i]!, v[1]![i]!, v[2]![i]!] as V3) };
}

const majority = (cells: ReadonlyArray<readonly [number, number, number]>, roleOf: (x: number, y: number, z: number) => string | null, fallback: string): string => {
  const n = new Map<string, number>();
  for (const c of cells) { const r = roleOf(c[0], c[1], c[2]); if (r) n.set(r, (n.get(r) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? fallback;
};

/** Fit primitives to a part's cells (see the top). Cells are integer voxel coordinates; primitives come back in the same frame (cell centres at +0.5). */
export function fitCells(cells: ReadonlyArray<readonly [number, number, number]>, roleOf: (x: number, y: number, z: number) => string | null, opts: FitOptions = {}): PartFit {
  const n = cells.length;
  if (!n) return { prims: [], iou: 0, chosen: "none", candidates: {} };
  const set = new Set(cells.map((c) => key(c[0], c[1], c[2])));
  const pts = cells.map((c) => [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5] as V3);
  const mean: V3 = [0, 0, 0];
  for (const p of pts) { mean[0] += p[0] / n; mean[1] += p[1] / n; mean[2] += p[2] / n; }
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) cov[i]![j]! += ((p[i]! - mean[i]!) * (p[j]! - mean[j]!)) / n;
  const { values, vectors } = eigen3(cov);
  const fallbackRole = majority(cells, roleOf, "primary");
  const candidates: Record<string, number> = {};
  const options: Array<{ name: string; prims: Prim[]; iou: number; rank: number }> = [];
  const add = (name: string, prims: Prim[], rank: number): void => { const iou = iouOf(prims, set); candidates[name] = +iou.toFixed(3); options.push({ name, prims, iou, rank }); };
  // Box: turned about y to the horizontal principal axis, snapped square when within 8 degrees.
  let yaw = 0;
  if (!opts.axisAligned) {
    const cxx = cov[0]![0]!, czz = cov[2]![2]!, cxz = cov[0]![2]!;
    const ang = 0.5 * Math.atan2(2 * cxz, cxx - czz);
    const snap = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    yaw = Math.abs(ang - snap) < 0.14 || Math.abs(cxx - czz) + Math.abs(cxz) < 1e-6 ? 0 : -ang;
  }
  const boxFor = (yw: number): { c: V3; h: V3 } => {
    const co = Math.cos(yw), si = Math.sin(yw);
    let lx0 = Infinity, lx1 = -Infinity, y0 = Infinity, y1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
    for (const p of pts) {
      const dx = p[0] - mean[0], dz = p[2] - mean[2];
      const lx = co * dx - si * dz, lz = si * dx + co * dz;
      lx0 = Math.min(lx0, lx - 0.5); lx1 = Math.max(lx1, lx + 0.5); lz0 = Math.min(lz0, lz - 0.5); lz1 = Math.max(lz1, lz + 0.5);
      y0 = Math.min(y0, p[1] - 0.5); y1 = Math.max(y1, p[1] + 0.5);
    }
    const mx = (lx0 + lx1) / 2, mz = (lz0 + lz1) / 2;
    // (Back to the model frame: the local centre turned by yaw.)
    const c: V3 = [mean[0] + co * mx + si * mz, (y0 + y1) / 2, mean[2] - si * mx + co * mz];
    return { c, h: [(lx1 - lx0) / 2, (y1 - y0) / 2, (lz1 - lz0) / 2] };
  };
  const b = boxFor(yaw);
  add("box", [{ shape: "box", c: b.c, h: b.h, yaw, role: fallbackRole }], 1);
  // Capsule: along the limb's segment if given, else the principal axis.
  if (opts.capsules !== false) {
    let dir: V3 = vectors[0]!;
    let origin = mean;
    if (opts.axis) {
      const [a, e] = opts.axis;
      const d: V3 = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
      const l = Math.hypot(...d);
      if (l > 1e-6) { dir = [d[0] / l, d[1] / l, d[2] / l]; origin = mean; }
    }
    let t0 = Infinity, t1 = -Infinity;
    for (const p of pts) { const t = (p[0] - origin[0]) * dir[0] + (p[1] - origin[1]) * dir[1] + (p[2] - origin[2]) * dir[2]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    t0 -= 0.5; t1 += 0.5;
    const len = Math.max(1, t1 - t0);
    const r = Math.max(0.5, Math.sqrt(n / len / Math.PI));
    const ta = Math.min(t0 + r, (t0 + t1) / 2), tb = Math.max(t1 - r, (t0 + t1) / 2);
    const P = (t: number): V3 => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    const elong = values[0]! / Math.max(1e-9, values[1]!);
    add("capsule", [{ shape: "capsule", a: P(ta), b: P(tb), r, role: fallbackRole }], elong > 3 ? 0 : 2);
  }
  // Wedge: the box, sloping across each of its four sides in turn.
  if (!opts.axisAligned && n >= 12) {
    let best: { prims: Prim[]; iou: number } | null = null;
    for (let k = 0; k < 4; k += 1) {
      const yw = yaw + (k * Math.PI) / 2;
      const bb = boxFor(yw);
      for (const lo of [0, 0.25, 0.5, 0.75]) {
        const prims: Prim[] = [{ shape: "wedge", c: bb.c, h: bb.h, yaw: yw, lo, role: fallbackRole }];
        const iou = iouOf(prims, set);
        if (!best || iou > best.iou) best = { prims, iou };
      }
    }
    if (best) { candidates["wedge"] = +best.iou.toFixed(3); options.push({ name: "wedge", prims: best.prims, iou: best.iou, rank: 3 }); }
  }
  // Boxes: the builder's greedy boxes, biggest first until they cover nine tenths of it.
  {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const c of cells) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); z0 = Math.min(z0, c[2]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); z1 = Math.max(z1, c[2]); }
    const size: V3 = [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1];
    const labels = new Int32Array(size[0] * size[1] * size[2]);
    for (const c of cells) labels[c[0] - x0 + size[0] * (c[1] - y0 + size[1] * (c[2] - z0))] = 1;
    const boxes = greedyGrid(labels, size, [x0, y0, z0], [0, 2, 1]).sort((p, q) => q.size[0] * q.size[1] * q.size[2] - p.size[0] * p.size[1] * p.size[2]);
    const prims: Prim[] = [];
    let covered = 0;
    for (const bx of boxes) {
      if (prims.length >= (opts.maxBoxes ?? 6) || covered >= n * 0.9) break;
      const vol = bx.size[0] * bx.size[1] * bx.size[2];
      const inBox: Array<[number, number, number]> = [];
      for (let z = 0; z < bx.size[2]; z += 1) for (let y = 0; y < bx.size[1]; y += 1) for (let x = 0; x < bx.size[0]; x += 1) inBox.push([bx.min[0] + x, bx.min[1] + y, bx.min[2] + z]);
      prims.push({ shape: "box", c: [bx.min[0] + bx.size[0] / 2, bx.min[1] + bx.size[1] / 2, bx.min[2] + bx.size[2] / 2], h: [bx.size[0] / 2, bx.size[1] / 2, bx.size[2] / 2], yaw: 0, role: majority(inBox, roleOf, fallbackRole) });
      covered += vol;
    }
    add("boxes", prims, 4);
  }
  const good = opts.good ?? 0.72;
  const single = options.filter((o) => o.name !== "boxes");
  const bestSingle = [...single].sort((p, q) => q.iou - p.iou)[0]!;
  const boxes = options.find((o) => o.name === "boxes")!;
  // (The simplest that is good enough, by rank; a wedge only when clearly better than the box.)
  const boxIou = candidates["box"] ?? 0;
  const okay = single.filter((o) => o.iou >= good && (o.name !== "wedge" || o.iou >= boxIou + 0.06)).sort((p, q) => p.rank - q.rank || q.iou - p.iou);
  let pick = okay[0] ?? bestSingle;
  if (boxes.iou > pick.iou + 0.05 && (!okay.length || boxes.iou > pick.iou + 0.12)) pick = boxes;
  return { prims: pick.prims, iou: +pick.iou.toFixed(3), chosen: pick.name, candidates };
}

/** Fit a part, then a significant second role (at least `share` of it) gets primitives of its own laid over the first. */
export function fitPart(cells: ReadonlyArray<readonly [number, number, number]>, roleOf: (x: number, y: number, z: number) => string | null, opts: FitOptions & { readonly share?: number } = {}): PartFit {
  const main = fitCells(cells, roleOf, opts);
  const counts = new Map<string, Array<readonly [number, number, number]>>();
  for (const c of cells) { const r = roleOf(c[0], c[1], c[2]) ?? "primary"; const l = counts.get(r) ?? []; l.push(c); counts.set(r, l); }
  const mainRole = main.prims[0]?.role;
  const extra: Prim[] = [];
  for (const [role, list] of [...counts.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (role === mainRole || list.length < Math.max(6, cells.length * (opts.share ?? 0.15))) continue;
    const f = fitCells(list, () => role, { ...opts, maxBoxes: 4, capsules: false });
    // (Only when they fit it: a ring of trim as one box would paint over the whole part.)
    if (f.iou >= 0.6) extra.push(...f.prims.map((p) => ({ ...p, role })));
  }
  if (!extra.length) return main;
  const all = [...extra, ...main.prims];
  const set = new Set(cells.map((c) => key(c[0], c[1], c[2])));
  return { ...main, prims: all, iou: +iouOf(all, set).toFixed(3) };
}

// ---------------------------------------------------------------- creatures

const LIMBS = new Set(["thigh.L", "thigh.R", "shin.L", "shin.R", "upperArm.L", "upperArm.R", "forearm.L", "forearm.R", "tail0", "tail1", "tail2", ...["FL", "FR", "HL", "HR"].flatMap((k) => [`upper.${k}`, `lower.${k}`])]);

/** A rig's skin fitted with primitives: per bone, a capsule along limb bones, boxes elsewhere (in the bone's frame, as poseVoxels takes them). */
export function fittedSkin(rig: VoxelRig): { skin: VoxelSkin; fits: Record<string, PartFit> } {
  const model = rig.model;
  const u = model.unit, O = rig.analysis.origin;
  const rest = restJoints(rig.spec.rig) as Record<string, V3>;
  const byBone = new Map<string, Array<[number, number, number]>>();
  for (const [k, bone] of rig.binding) { const c = k.split(",").map(Number) as [number, number, number]; const l = byBone.get(bone) ?? []; l.push(c); byBone.set(bone, l); }
  const roleOf = (x: number, y: number, z: number): string | null => model.roleAt(x, y, z);
  const toRig = (p: V3): V3 => [(p[0] - O[0]) * u, (p[1] - O[1]) * u, (p[2] - O[2]) * u];
  const boxes: BoundBox[] = [], capsules: BoundCapsule[] = [];
  const fits: Record<string, PartFit> = {};
  const cells: Record<string, number> = {};
  for (const [bone, list] of [...byBone.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    cells[bone] = list.length;
    const j = rest[bone];
    if (!j) continue;
    // (A limb's segment, in voxel coordinates, from its joint to its child's.)
    const end = rest[SEG_END[bone] ?? ""];
    const jv: V3 = [j[0] / u + O[0], j[1] / u + O[1], j[2] / u + O[2]];
    const axis = end ? [jv, [end[0] / u + O[0], end[1] / u + O[1], end[2] / u + O[2]] as V3] as const : undefined;
    // (Every bone may be a capsule -- a head is a ball -- but only a limb's runs along its bone.)
    const f = fitPart(list, roleOf, { axisAligned: true, ...(axis && LIMBS.has(bone) ? { axis } : {}), maxBoxes: LIMBS.has(bone) ? 3 : 5 });
    fits[bone] = f;
    for (const q of f.prims) {
      if (q.shape === "capsule") {
        const a = toRig(q.a), b = toRig(q.b);
        capsules.push({ bone, a: [a[0] - j[0], a[1] - j[1], a[2] - j[2]], b: [b[0] - j[0], b[1] - j[1], b[2] - j[2]], r: q.r * u, role: q.role });
      } else {
        const c = toRig(q.c);
        boxes.push({ bone, c: [c[0] - j[0], c[1] - j[1], c[2] - j[2]], h: [q.h[0] * u, q.h[1] * u, q.h[2] * u], role: q.role });
      }
    }
  }
  return { skin: { boxes, capsules, cells }, fits };
}

const SEG_END: Readonly<Record<string, string>> = {
  "thigh.L": "shin.L", "shin.L": "foot.L", "thigh.R": "shin.R", "shin.R": "foot.R", "upperArm.L": "forearm.L", "forearm.L": "hand.L", "upperArm.R": "forearm.R", "forearm.R": "hand.R",
  tail0: "tail1", tail1: "tail2", "upper.FL": "lower.FL", "lower.FL": "paw.FL", "upper.FR": "lower.FR", "lower.FR": "paw.FR", "upper.HL": "lower.HL", "lower.HL": "paw.HL", "upper.HR": "lower.HR", "lower.HR": "paw.HR",
};
