// Terraces: a block's ground graded to the pavements round it. Each block of the
// city is one surface, set cell by cell from its sides -- the back edge of every
// pavement round it, and the road's height there -- weighted by how near each
// side is (inverse square). So along a lot's frontage the ground follows its
// road's grade, flush with the pavement's back edge; across its depth it's level
// near the road, easing over to the next road's level across the middle of the
// block, where the lots' back yards meet. Neighbours along a road meet each other
// continuously, back-to-back rows meet at their back fences, and nothing is ever
// a step: the steepest part of a block is its middle, and no steeper than the
// roads round it make it. All of it arithmetic and square roots.

import { cellX, cellZ } from "@keel-engine/elevation";
import type { HeightGrid } from "@keel-engine/elevation";
import { pointAt } from "@keel-engine/road";
import type { RoadEdge, RoadField, RoadGraph } from "@keel-engine/road";
import { sidewalkReach } from "./sidewalks.ts";
import type { Block } from "./types.ts";

/** Metres between the samples of a pavement's back edge. */
const SPACING = 2;
/** How far past its four corners a block's ground may reach (m): where a road round it bows outward. */
const BOW = 24;
/** The nearest a side is counted (m): a cell on its edge takes its height, not a division by nothing. */
const NEAR = 0.5;

/** A block's ground: its height at a point (exactly what its cells were set to), and the block it is. */
export interface Terrace {
  readonly block: number;
  at(x: number, z: number): number;
}

/** A side's pavement back edge, sampled along it: points and the road's height at each. */
interface Side { readonly x: Float64Array; readonly z: Float64Array; readonly y: Float64Array; readonly n: number; readonly ax: number; readonly az: number; readonly ex: number; readonly ez: number; readonly l2: number }

/** What the terraces need of the city: its roads, their field and their graded heights. */
export interface TerraceRoads {
  readonly graph: RoadGraph;
  readonly field: RoadField;
  roadAt(edge: number, s: number): number;
}

/** The roads between each pair of junctions (both ways), and each junction by where it stands. */
function indexOf(g: RoadGraph): { node: Map<string, number>; between: Map<string, RoadEdge[]> } {
  const node = new Map<string, number>(), between = new Map<string, RoadEdge[]>();
  for (const n of g.nodes) node.set(`${n.x},${n.z}`, n.id);
  for (const e of g.edges) for (const k of [`${e.a},${e.b}`, `${e.b},${e.a}`]) { const l = between.get(k); if (l) l.push(e); else between.set(k, [e]); }
  return { node, between };
}
const indexes = new WeakMap<RoadGraph, ReturnType<typeof indexOf>>();

/** The road (a piece or two, through a T) from junction a to junction b, each piece with the way it runs. */
function roadsBetween(g: RoadGraph, a: number, b: number): { e: RoadEdge; fwd: boolean }[] | null {
  let ix = indexes.get(g);
  if (!ix) { ix = indexOf(g); indexes.set(g, ix); }
  const direct = ix.between.get(`${a},${b}`);
  if (direct?.length) { const e = direct.reduce((p, q) => (q.path.length < p.path.length ? q : p)); return [{ e, fwd: e.a === a }]; }
  // (A T on the side, from a street across the road: two pieces, through the T's junction.)
  let best: { e: RoadEdge; fwd: boolean }[] | null = null, len = Infinity;
  for (const e of g.edges) {
    if (e.a !== a && e.b !== a) continue;
    const m = e.a === a ? e.b : e.a;
    for (const f of ix.between.get(`${m},${b}`) ?? []) {
      if (f === e) continue;
      const l = e.path.length + f.path.length;
      if (l < len) { len = l; best = [{ e, fwd: e.a === a }, { e: f, fwd: f.a === m }]; }
    }
  }
  return best;
}

/**
 * A block's terrace: its four sides' pavements sampled (clear of the corners, where the next road's pavement takes
 * over), and the ground at a point weighted over them. Null for a block whose sides can't be found.
 */
export function terraceOf(roads: TerraceRoads, block: Block): Terrace | null {
  const g = roads.graph, q = block.corners;
  if (q.length < 3) return null;
  let gx = 0, gz = 0;
  for (const [x, z] of q) { gx += x / q.length; gz += z / q.length; }
  let ix = indexes.get(g);
  if (!ix) { ix = indexOf(g); indexes.set(g, ix); }
  // Each side's road, and how far its pavement reaches from its centre (what the next side's samples keep clear of).
  const pieces = q.map(([ax, az], k) => {
    const [bx, bz] = q[(k + 1) % q.length]!, a = ix!.node.get(`${ax},${az}`), b = ix!.node.get(`${bx},${bz}`);
    return a !== undefined && b !== undefined ? roadsBetween(g, a, b) : null;
  });
  const reachOf = (k: number): number => {
    const p = pieces[(k + q.length) % q.length];
    return p ? Math.max(...p.map(({ e }) => sidewalkReach(e.cls, e.half))) : 8;
  };
  const sides: Side[] = [];
  for (let k = 0; k < q.length; k += 1) {
    const [ax, az] = q[k]!, [bx, bz] = q[(k + 1) % q.length]!, xs: number[] = [], zs: number[] = [], ys: number[] = [];
    const push = (x: number, z: number, y: number): void => { xs.push(x); zs.push(z); ys.push(y); };
    const p = pieces[k];
    if (p) {
      const total = p.reduce((t, { e }) => t + (e.path.length - 1), 0), clear0 = reachOf(k - 1), clear1 = reachOf(k + 1);
      let run = 0;
      for (const { e, fwd } of p) {
        const L = e.path.length - 1, reach = sidewalkReach(e.cls, e.half);
        // (Which side of the road the block is on: the offset that lands nearer its middle.)
        const m0 = pointAt(e.path, L / 2, reach), m1 = pointAt(e.path, L / 2, -reach);
        const sign = (m0.x - gx) ** 2 + (m0.z - gz) ** 2 <= (m1.x - gx) ** 2 + (m1.z - gz) ** 2 ? 1 : -1;
        const n = Math.max(1, Math.round(L / SPACING));
        for (let i = 0; i <= n; i += 1) {
          const along = run + (L * i) / n;
          if (along < clear0 || along > total - clear1) continue;
          const s = fwd ? (L * i) / n : L - (L * i) / n, pt = pointAt(e.path, s, sign * reach);
          push(pt.x, pt.z, roads.roadAt(e.id, s));
        }
        run += L;
      }
    }
    // (A side with no road found -- or too short to clear its corners -- is sampled off the road field along its chord.)
    if (xs.length < 2) {
      xs.length = 0; zs.length = 0; ys.length = 0;
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(L / SPACING));
      for (let i = 1; i < n; i += 1) {
        const cx = ax + ((bx - ax) * i) / n, cz = az + ((bz - az) * i) / n, at = roads.field.at(cx, cz);
        if (!at) continue;
        const e = g.edges[at.edge]!, reach = sidewalkReach(e.cls, e.half), p0 = pointAt(e.path, at.s, reach), p1 = pointAt(e.path, at.s, -reach);
        const pt = (p0.x - gx) ** 2 + (p0.z - gz) ** 2 <= (p1.x - gx) ** 2 + (p1.z - gz) ** 2 ? p0 : p1;
        push(pt.x, pt.z, roads.roadAt(at.edge, at.s));
      }
    }
    if (!xs.length) continue;
    const ex = bx - ax, ez = bz - az;
    sides.push({ x: Float64Array.from(xs), z: Float64Array.from(zs), y: Float64Array.from(ys), n: xs.length, ax, az, ex, ez, l2: ex * ex + ez * ez || 1 });
  }
  if (!sides.length) return null;
  return { block: block.id, at: (x, z) => blend(sides, x, z) };
}

/** The ground at a point: each side's nearest pavement edge, weighted by the inverse square of the distance to it. */
function blend(sides: readonly Side[], x: number, z: number): number {
  let sw = 0, sy = 0;
  for (const S of sides) {
    // (The nearest sample: from where the point falls along the side's chord, walked downhill in distance.)
    const t = Math.max(0, Math.min(1, ((x - S.ax) * S.ex + (z - S.az) * S.ez) / S.l2));
    let i = Math.round(t * (S.n - 1));
    const d2 = (k: number): number => (S.x[k]! - x) ** 2 + (S.z[k]! - z) ** 2;
    let best = d2(i);
    for (;;) { if (i > 0 && d2(i - 1) < best) { i -= 1; best = d2(i); } else break; }
    for (;;) { if (i < S.n - 1 && d2(i + 1) < best) { i += 1; best = d2(i); } else break; }
    // (Then onto the segment either side of it.)
    let dd = best, y = S.y[i]!;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= S.n) continue;
      const ux = S.x[j]! - S.x[i]!, uz = S.z[j]! - S.z[i]!, l2 = ux * ux + uz * uz;
      if (l2 <= 0) continue;
      const f = Math.max(0, Math.min(1, ((x - S.x[i]!) * ux + (z - S.z[i]!) * uz) / l2));
      const e2 = (S.x[i]! + ux * f - x) ** 2 + (S.z[i]! + uz * f - z) ** 2;
      if (e2 < dd) { dd = e2; y = S.y[i]! + (S.y[j]! - S.y[i]!) * f; }
    }
    const w = 1 / Math.max(dd, NEAR * NEAR);
    sw += w; sy += w * y;
  }
  return sy / sw;
}

/**
 * Lay a block's terrace on the grid: every cell of the block's own ground -- what's reached from its middle without
 * crossing a locked cell (a road, its pavements, a junction), within its corners and BOW -- set to the terrace, and
 * locked. Returns the cells it set.
 */
export function layTerrace(land: HeightGrid, lock: Uint8Array, block: Block, t: Terrace): number {
  const q = block.corners;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, gx = 0, gz = 0;
  for (const [x, z] of q) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); gx += x / q.length; gz += z / q.length; }
  const i0 = Math.max(0, Math.floor((x0 - BOW - land.x0) / land.cell)), i1 = Math.min(land.w - 1, Math.ceil((x1 + BOW - land.x0) / land.cell));
  const j0 = Math.max(0, Math.floor((z0 - BOW - land.z0) / land.cell)), j1 = Math.min(land.h - 1, Math.ceil((z1 + BOW - land.z0) / land.cell));
  // (The seed: the free cell nearest the block's middle.)
  const ci = Math.round((gx - land.x0) / land.cell), cj = Math.round((gz - land.z0) / land.cell);
  let seed = -1;
  for (let r = 0; r <= 12 && seed < 0; r += 1) {
    for (let dj = -r; dj <= r && seed < 0; dj += 1) for (let di = -r; di <= r; di += 1) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < i0 || i > i1 || j < j0 || j > j1) continue;
      if (!lock[j * land.w + i]) { seed = j * land.w + i; break; }
    }
  }
  if (seed < 0) return 0;
  const stack = [seed], w = land.w;
  lock[seed] = 2;
  let set = 0;
  while (stack.length) {
    const k = stack.pop()!, i = k % w, j = (k - i) / w;
    land.data[k] = t.at(cellX(land, i), cellZ(land, j));
    set += 1;
    if (i > i0 && !lock[k - 1]) { lock[k - 1] = 2; stack.push(k - 1); }
    if (i < i1 && !lock[k + 1]) { lock[k + 1] = 2; stack.push(k + 1); }
    if (j > j0 && !lock[k - w]) { lock[k - w] = 2; stack.push(k - w); }
    if (j < j1 && !lock[k + w]) { lock[k + w] = 2; stack.push(k + w); }
  }
  return set;
}
