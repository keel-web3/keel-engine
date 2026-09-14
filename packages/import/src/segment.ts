// Boundaries: the voxels cut into parts, every cue kept.
//
//   meshes      each source node is its own part to begin with
//   components  a node's cells in pieces well apart (more than two cells) are
//               separate parts (a pair of boots in one mesh: two; a blade thinner
//               than a cell with its guard and grip: one)
//   materials   in a mesh holding nearly everything (a single-mesh export),
//               each material's connected region -- small ones folded into the
//               neighbour they touch most. Several meshes: their materials are
//               colours, the meshes are the parts.
//   narrowing   a big part whose cross-section jumps (a statue on its plinth, a
//               tree's trunk under its crown) is cut where it does
//   skeleton    a creature's body splits by body region -- from the skin
//               weights (the dominant joint of every cell), or from the
//               builder's rig reading (limb narrowing along the bones)
//
// The result is a PART GRAPH: parts (cells, bounds, where they came from,
// what cut them off) and the edges where they touch (how many faces, which
// cues say it's a boundary, how sure).

import type { V3 } from "./math.ts";
import type { VoxelGrid } from "./voxelize.ts";

export type PartKind = "body" | "attribute" | "mark" | "prop";

export interface PartNode {
  /** The group name it becomes ("helmet", "body.arm.L", "lid"). */
  id: string;
  index: number;
  cells: number;
  /** Cells with an open face. */
  surface: number;
  /** Grid coordinates, inclusive. */
  min: V3;
  max: V3;
  /** Mean cell centre, grid coordinates. */
  centroid: V3;
  /** The source node it came from (-1: several) and that node's name. */
  node: number;
  nodeName: string;
  /** Materials by cells, most first. */
  materials: Array<[string, number]>;
  /** Dominant skin joint (node index) and the share of its cells it holds, when skinned. */
  joint: number;
  jointShare: number;
  /** A creature's body region ("head", "arm.L", "leg.FL"...) or the contract bone it rides. */
  region?: string;
  bone?: string;
  /** What cut it off from its neighbours, in words. */
  cues: string[];
  /** 0..1: how sure the boundary round it is. */
  confidence: number;
  kind: PartKind;
  /** An attribute's socket. */
  socket?: string;
  why: string[];
}

export interface PartEdge {
  readonly a: number;
  readonly b: number;
  /** Faces they share. */
  readonly contact: number;
  readonly cues: readonly string[];
  readonly confidence: number;
}

export interface Segmentation {
  /** Per cell: its part (-1 empty). */
  readonly label: Int32Array;
  readonly parts: PartNode[];
  edges: PartEdge[];
}

const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const NEAR: Array<[number, number, number]> = [];
for (let dz = -2; dz <= 2; dz += 1) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if (dx || dy || dz) NEAR.push([dx, dy, dz]);

/** A name as a group id: lower-case words joined by dashes ("Helmet_01" -> "helmet", "Cape.001" -> "cape"). */
export function idOf(name: string, fallback: string): string {
  const s = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\.\d+$|[_ -]?\d+$/g, "").replace(/\b(mesh|geo|geometry|obj|object|node|shape|model|primitive|lod ?\d?)\b/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

/** Unique ids: a second "boot" is "boot-2". */
export function uniqueIds(parts: PartNode[]): void {
  const seen = new Map<string, number>();
  for (const p of parts) {
    const n = (seen.get(p.id) ?? 0) + 1;
    seen.set(p.id, n);
    if (n > 1) p.id = `${p.id}-${n}`;
  }
}

/** Source parts: nodes -> components -> material regions, small regions folded in. */
export function segmentSource(grid: VoxelGrid, { minCells }: { minCells?: number } = {}): Segmentation {
  const [sx, sy, sz] = grid.size;
  const n = grid.occ.length;
  const at = (x: number, y: number, z: number): number => x + sx * (y + sy * z);
  let total = 0;
  for (let i = 0; i < n; i += 1) if (grid.occ[i]) total += 1;
  const small = minCells ?? Math.max(4, Math.round(total * 0.002));
  // Components per node: cells within two of each other are one piece (a blade, its guard and its grip thinner than a
  // cell are still one sword), so only pieces well apart -- a pair of boots -- come apart.
  const comp = new Int32Array(n).fill(-1);
  let comps = 0;
  const compNode: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (!grid.occ[i] || comp[i]! >= 0) continue;
    const node = grid.node[i]!;
    const stack = [i];
    comp[i] = comps;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % sx, y = Math.floor(k / sx) % sy, z = Math.floor(k / (sx * sy));
      for (const [dx, dy, dz] of NEAR) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
        const q = at(nx, ny, nz);
        if (!grid.occ[q] || comp[q]! >= 0 || grid.node[q] !== node) continue;
        comp[q] = comps;
        stack.push(q);
      }
    }
    compNode.push(node);
    comps += 1;
  }
  // Material regions per component (6-connected) -- only in a mesh holding (nearly) everything: a file of several
  // meshes has drawn its parts already, and their materials are colours; one mesh may hold a collar in its own material.
  const nodeCells = new Map<number, number>();
  for (let i = 0; i < n; i += 1) if (grid.occ[i]) nodeCells.set(grid.node[i]!, (nodeCells.get(grid.node[i]!) ?? 0) + 1);
  const splits = new Set([...nodeCells].filter(([, c]) => nodeCells.size === 1 || c >= total * 0.85).map(([k]) => k));
  const region = new Int32Array(n).fill(-1);
  const regComp: number[] = [], regMat: number[] = [], regSize: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (!grid.occ[i] || region[i]! >= 0) continue;
    const c = comp[i]!, mat = grid.material[i]!;
    const id = regComp.length;
    const stack = [i];
    region[i] = id;
    let size = 0;
    while (stack.length) {
      const k = stack.pop()!;
      size += 1;
      const x = k % sx, y = Math.floor(k / sx) % sy, z = Math.floor(k / (sx * sy));
      for (const [dx, dy, dz] of NEAR) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
        const q = at(nx, ny, nz);
        if (!grid.occ[q] || region[q]! >= 0 || comp[q] !== c) continue;
        // (Split by material: face neighbours of the same material only.)
        if (splits.has(grid.node[q]!) && (grid.material[q] !== mat || Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1)) continue;
        region[q] = id;
        stack.push(q);
      }
    }
    regComp.push(c); regMat.push(mat); regSize.push(size);
  }
  // Fold small material regions into the neighbour (same component) they share most faces with -- smallest first, repeatedly.
  const parent = regSize.map((_s, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const sizeOf = [...regSize];
  for (let pass = 0; pass < 3; pass += 1) {
    const contact = new Map<number, Map<number, number>>();
    for (let i = 0; i < n; i += 1) {
      if (!grid.occ[i]) continue;
      const ri = find(region[i]!);
      if (sizeOf[ri]! >= small) continue;
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      for (const [dx, dy, dz] of N6) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
        const q = at(nx, ny, nz);
        if (!grid.occ[q] || comp[q] !== comp[i]) continue;
        const rq = find(region[q]!);
        if (rq === ri) continue;
        const m = contact.get(ri) ?? new Map<number, number>();
        m.set(rq, (m.get(rq) ?? 0) + 1);
        contact.set(ri, m);
      }
    }
    let changed = false;
    for (const ri of [...contact.keys()].sort((a, b) => sizeOf[a]! - sizeOf[b]! || a - b)) {
      if (find(ri) !== ri || sizeOf[ri]! >= small) continue;
      let best = -1, bc = 0;
      for (const [rq, c] of contact.get(ri)!) { const r = find(rq); if (r !== ri && (c > bc || (c === bc && r < best))) { best = r; bc = c; } }
      if (best < 0) continue;
      parent[ri] = best;
      sizeOf[best]! += sizeOf[ri]!;
      changed = true;
    }
    if (!changed) break;
  }
  // (A small region touching nothing of its piece -- a buckle a cell off its belt -- joins the piece's biggest.)
  const biggestOf = new Map<number, number>();
  for (let r = 0; r < regComp.length; r += 1) { const root = find(r); const b = biggestOf.get(regComp[r]!); if (b === undefined || sizeOf[root]! > sizeOf[find(b)]!) biggestOf.set(regComp[r]!, root); }
  for (let r = 0; r < regComp.length; r += 1) {
    const root = find(r), big = find(biggestOf.get(regComp[r]!)!);
    if (root !== big && sizeOf[root]! < small) { parent[root] = big; sizeOf[big]! += sizeOf[root]!; }
  }
  // Parts: one per surviving region.
  const partOf = new Map<number, number>();
  const label = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    if (!grid.occ[i]) continue;
    const r = find(region[i]!);
    let p = partOf.get(r);
    if (p === undefined) { p = partOf.size; partOf.set(r, p); }
    label[i] = p;
  }
  const roots = [...partOf.keys()];
  // (Regions that survived the folding, per component: a piece with one left is named by its node alone.)
  const surviving = new Map<number, number>();
  for (const r of roots) surviving.set(regComp[r]!, (surviving.get(regComp[r]!) ?? 0) + 1);
  const parts = roots.map((r, index): PartNode => {
    const node = compNode[regComp[r]!]!;
    const nodeName = grid.nodeNames[node] ?? `part${index}`;
    const several = (surviving.get(regComp[r]!) ?? 1) > 1;
    const matName = regMat[r]! >= 0 ? grid.materialNames[regMat[r]!] ?? "" : "";
    const nodeParts = roots.filter((q) => compNode[regComp[q]!] === node).length;
    const id = idOf(several && nodeParts > 1 && matName ? `${nodeName} ${matName}` : nodeName, `part-${index}`);
    const cues = [`node "${nodeName}"`];
    if (roots.filter((q) => compNode[regComp[q]!] === node && regComp[q] !== regComp[r]).length) cues.push("a separate piece of its node");
    if (several) cues.push(`material "${matName}"`);
    return { id, index, cells: 0, surface: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], centroid: [0, 0, 0], node, nodeName, materials: [], joint: -1, jointShare: 0, cues, confidence: 0, kind: "prop", why: [] };
  });
  const seg: Segmentation = { label, parts, edges: [] };
  measure(grid, seg);
  uniqueIds(parts);
  return seg;
}

/** Recount every part's cells, bounds, centroid, materials and joints, and the edges between parts. */
export function measure(grid: VoxelGrid, seg: Segmentation): void {
  const [sx, sy, sz] = grid.size;
  const { label, parts } = seg;
  const mats = parts.map(() => new Map<number, number>());
  const joints = parts.map(() => new Map<number, number>());
  const sum = parts.map(() => [0, 0, 0]);
  for (const p of parts) { p.cells = 0; p.surface = 0; p.min = [Infinity, Infinity, Infinity]; p.max = [-Infinity, -Infinity, -Infinity]; }
  const contact = new Map<string, number>();
  const nodes = parts.map(() => new Set<number>());
  for (let i = 0; i < label.length; i += 1) {
    const l = label[i]!;
    if (l < 0) continue;
    const p = parts[l]!;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    p.cells += 1;
    if (grid.occ[i] === 1) p.surface += 1;
    p.min = [Math.min(p.min[0], x), Math.min(p.min[1], y), Math.min(p.min[2], z)];
    p.max = [Math.max(p.max[0], x), Math.max(p.max[1], y), Math.max(p.max[2], z)];
    sum[l]![0]! += x + 0.5; sum[l]![1]! += y + 0.5; sum[l]![2]! += z + 0.5;
    const m = grid.material[i]!;
    mats[l]!.set(m, (mats[l]!.get(m) ?? 0) + 1);
    if (grid.joint[i]! >= 0) joints[l]!.set(grid.joint[i]!, (joints[l]!.get(grid.joint[i]!) ?? 0) + 1);
    nodes[l]!.add(grid.node[i]!);
    // (Faces shared with another part: +x, +y, +z neighbours, so each face counts once.)
    for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx >= sx || ny >= sy || nz >= sz) continue;
      const q = label[nx + sx * (ny + sy * nz)]!;
      if (q < 0 || q === l) continue;
      const k = l < q ? `${l},${q}` : `${q},${l}`;
      contact.set(k, (contact.get(k) ?? 0) + 1);
    }
  }
  parts.forEach((p, i) => {
    p.index = i;
    p.centroid = p.cells ? [sum[i]![0]! / p.cells, sum[i]![1]! / p.cells, sum[i]![2]! / p.cells] : [0, 0, 0];
    p.materials = [...mats[i]!.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([m, c]) => [m >= 0 ? grid.materialNames[m] ?? `material ${m}` : "none", c]);
    const js = [...joints[i]!.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    p.joint = js[0]?.[0] ?? -1;
    p.jointShare = js[0] && p.cells ? js[0][1] / p.cells : 0;
    if (nodes[i]!.size > 1) p.node = -1;
  });
  seg.edges = [...contact.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, c]) => {
    const [a, b] = k.split(",").map(Number) as [number, number];
    const A = parts[a]!, B = parts[b]!;
    const cues: string[] = [];
    let conf = 0.2;
    if (A.node !== B.node || A.node === -1) { cues.push("different source meshes"); conf += 0.6; }
    if (A.materials[0]?.[0] !== B.materials[0]?.[0]) { cues.push("material changes"); conf += 0.2; }
    if (A.region && B.region && A.region !== B.region) { cues.push(`body regions ${A.region} / ${B.region}`); conf += 0.2; }
    if (A.cues.some((q) => q.startsWith("narrows")) || B.cues.some((q) => q.startsWith("narrows"))) { cues.push("the section narrows"); conf += 0.2; }
    return { a, b, contact: c, cues, confidence: Math.min(1, +conf.toFixed(2)) };
  });
}

/**
 * Cut a part where its cross-section jumps (along y, then x, then z): the
 * boundary with the biggest ratio of mean section below to above, both
 * sides holding at least `minShare` of it. Returns the new part's index, or -1.
 */
export function narrowingCut(grid: VoxelGrid, seg: Segmentation, part: number, { minRatio = 3, minShare = 0.12, window = 3 } = {}): number {
  const [sx, sy] = grid.size;
  const p = seg.parts[part]!;
  const cells: number[] = [];
  for (let i = 0; i < seg.label.length; i += 1) if (seg.label[i] === part) cells.push(i);
  let best: { axis: number; at: number; ratio: number } | null = null;
  for (const axis of [1, 0, 2]) {
    const lo = p.min[axis]!, hi = p.max[axis]!;
    const len = hi - lo + 1;
    if (len < 2 * window + 2) continue;
    const area = new Array<number>(len).fill(0);
    for (const i of cells) { const c = [i % sx, Math.floor(i / sx) % sy, Math.floor(i / (sx * sy))]; area[c[axis]! - lo]! += 1; }
    const cum: number[] = [0];
    for (const a of area) cum.push(cum[cum.length - 1]! + a);
    for (let t = window; t <= len - window; t += 1) {
      const below = cum[t]!, above = cells.length - below;
      if (below < cells.length * minShare || above < cells.length * minShare) continue;
      const mb = (cum[t]! - cum[t - window]!) / window, ma = (cum[t + window]! - cum[t]!) / window;
      const ratio = Math.max(mb, ma) / Math.max(1, Math.min(mb, ma));
      if (ratio >= minRatio && (!best || ratio > best.ratio)) best = { axis, at: lo + t, ratio };
    }
    if (best) break;
  }
  if (!best) return -1;
  const q = seg.parts.length;
  const axisName = "xyz"[best.axis]!;
  const np: PartNode = { ...p, id: `${p.id}-${best.axis === 1 ? "top" : axisName === "x" ? "right" : "front"}`, index: q, cues: [...p.cues, `narrows ${best.ratio.toFixed(1)}x across ${axisName} = ${best.at}`], why: [] };
  seg.parts.push(np);
  p.cues.push(`narrows ${best.ratio.toFixed(1)}x across ${axisName} = ${best.at}`);
  if (best.axis === 1) p.id = `${p.id}-base`;
  for (const i of cells) { const c = [i % sx, Math.floor(i / sx) % sy, Math.floor(i / (sx * sy))]; if (c[best.axis]! >= best.at) seg.label[i] = q; }
  return q;
}
