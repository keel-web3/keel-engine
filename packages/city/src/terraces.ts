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

import { dhypot } from "@keel-engine/core";
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
      const L = dhypot(bx - ax, bz - az), n = Math.max(2, Math.round(L / SPACING));
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
  for (let n = 0; n < sides.length; n += 1) {
    const S = sides[n]!, X = S.x, Z = S.z, Y = S.y, last = S.n - 1;
    // (The nearest sample: from where the point falls along the side's chord, walked downhill in distance.)
    const t = Math.max(0, Math.min(1, ((x - S.ax) * S.ex + (z - S.az) * S.ez) / S.l2));
    let i = Math.round(t * last), best = (X[i]! - x) * (X[i]! - x) + (Z[i]! - z) * (Z[i]! - z);
    for (;;) {
      if (i > 0) { const e = (X[i - 1]! - x) * (X[i - 1]! - x) + (Z[i - 1]! - z) * (Z[i - 1]! - z); if (e < best) { i -= 1; best = e; continue; } }
      break;
    }
    for (;;) {
      if (i < last) { const e = (X[i + 1]! - x) * (X[i + 1]! - x) + (Z[i + 1]! - z) * (Z[i + 1]! - z); if (e < best) { i += 1; best = e; continue; } }
      break;
    }
    // (Then onto the segment either side of it.)
    let dd = best, y = Y[i]!;
    for (let side = -1; side <= 1; side += 2) {
      const j = i + side;
      if (j < 0 || j > last) continue;
      const ux = X[j]! - X[i]!, uz = Z[j]! - Z[i]!, l2 = ux * ux + uz * uz;
      if (l2 <= 0) continue;
      const f = ((x - X[i]!) * ux + (z - Z[i]!) * uz) / l2;
      if (f <= 0) continue;
      const g = f < 1 ? f : 1, ex = X[i]! + ux * g - x, ez = Z[i]! + uz * g - z, e2 = ex * ex + ez * ez;
      if (e2 < dd) { dd = e2; y = Y[i]! + (Y[j]! - Y[i]!) * g; }
    }
    const w = 1 / (dd > NEAR * NEAR ? dd : NEAR * NEAR);
    sw += w; sy += w * y;
  }
  return sy / sw;
}

/**
 * Lay a block's terrace on the grid: every cell of the block's own ground -- what's reached from its middle without
 * crossing a locked cell (a road, its pavements, a junction), within its corners and BOW -- set to the terrace, and
 * locked. Returns the cells it set. (Cells three and more from the block's edge, off the even lattice, are the bilinear
 * mix of the even cells round them: the terrace is smooth there -- millimetres -- and it's most of a block.)
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
  // The block's cells: flooded from the seed over what's free.
  const W = land.w, bw = i1 - i0 + 1, bh = j1 - j0 + 1, near = new Uint8Array(bw * bh), cells: number[] = [], stack = [seed];
  lock[seed] = 2;
  while (stack.length) {
    const k = stack.pop()!, i = k % W, j = (k - i) / W;
    cells.push(k); near[(j - j0) * bw + (i - i0)] = 3;
    if (i > i0 && !lock[k - 1]) { lock[k - 1] = 2; stack.push(k - 1); }
    if (i < i1 && !lock[k + 1]) { lock[k + 1] = 2; stack.push(k + 1); }
    if (j > j0 && !lock[k - W]) { lock[k - W] = 2; stack.push(k - W); }
    if (j < j1 && !lock[k + W]) { lock[k + W] = 2; stack.push(k + W); }
  }
  // How near each is to the block's edge, in cells (a chessboard distance, 3 and over counted as 3).
  const at = (a: number, b: number): number => (a < 0 || b < 0 || a >= bw || b >= bh ? 0 : near[b * bw + a]!);
  for (let b = 0; b < bh; b += 1) for (let a = 0; a < bw; a += 1) {
    const k = b * bw + a;
    if (near[k]) near[k] = Math.min(near[k]!, at(a - 1, b) + 1, at(a, b - 1) + 1, at(a - 1, b - 1) + 1, at(a + 1, b - 1) + 1);
  }
  for (let b = bh - 1; b >= 0; b -= 1) for (let a = bw - 1; a >= 0; a -= 1) {
    const k = b * bw + a;
    if (near[k]) near[k] = Math.min(near[k]!, at(a + 1, b) + 1, at(a, b + 1) + 1, at(a + 1, b + 1) + 1, at(a - 1, b + 1) + 1);
  }
  // Exactly: every cell by the edge, and the even lattice; then the rest from the even cells round them.
  const mixed: number[] = [];
  for (const k of cells) {
    const i = k % W, j = (k - i) / W;
    if (near[(j - j0) * bw + (i - i0)]! < 3 || ((i | j) & 1) === 0) land.data[k] = t.at(cellX(land, i), cellZ(land, j));
    else mixed.push(k);
  }
  for (const k of mixed) {
    const i = k % W, j = (k - i) / W, ia = i & ~1, ja = j & ~1, ib = i & 1 ? ia + 2 : ia, jb = j & 1 ? ja + 2 : ja;
    const d = land.data, a = d[ja * W + ia]!, b = d[ja * W + ib]!, c = d[jb * W + ia]!, e = d[jb * W + ib]!;
    const fu = (i - ia) / 2, fv = (j - ja) / 2;
    d[k] = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + e * fu) * fv;
  }
  return cells.length;
}
