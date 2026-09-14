// HPA*: long routes over a coarse graph, so a flow field only has to cover
// the corridor a group actually walks. The map is cut into SECTORS (16 x 16
// tiles, keel-rts RTS.md); every run of crossings along a border between two
// sectors becomes a PORTAL (a node each side, joined by the step across); the
// nodes in one sector are joined by their walking costs inside it. A route is
// A* over that graph, the start and goal joined to their sectors' nodes by a
// local search; its sectors are the corridor flowField(..., { within }) runs in.
//
//   const hpa = buildSectors(grid, { size: 16, spacing: 5 });   // a portal every 5 tiles of a long border run
//   const r = hpa.route([i0, j0], [i1, j1]);      // { cost, sectors, nodes } or null
//   const f = flowField(grid, [goal], { within: hpa.corridor(r, 1) });
//
// Costs are the flow field's (5 an orthogonal step onto a cost-1 tile, 7 a
// diagonal), so a route's cost and a field's integration value compare.

import { DX8, DZ8 } from "./types.ts";
import type { PathGrid } from "./pathing.ts";

const ORTH = 5;
const DIAG = 7;

export interface SectorNode {
  /** The tile it stands on. */
  readonly k: number;
  readonly sector: number;
}

export interface SectorRoute {
  /** The route's cost (flow-field units). */
  readonly cost: number;
  /** The sectors it passes through, in order (start's first). */
  readonly sectors: readonly number[];
  /** The portal nodes it passes through. */
  readonly nodes: readonly number[];
}

export interface SectorGraph {
  readonly size: number;
  readonly sectorsX: number;
  readonly sectorsZ: number;
  readonly nodes: readonly SectorNode[];
  /** Per node: [to, cost] pairs. */
  readonly edges: readonly (readonly (readonly [number, number])[])[];
  sectorOf(i: number, j: number): number;
  /** The sector's tile rectangle [i0, j0, i1, j1) (end exclusive). */
  sectorRect(s: number): [number, number, number, number];
  /** A route between two tiles, or null when the goal can't be reached. */
  route(from: readonly [number, number], to: readonly [number, number]): SectorRoute | null;
  /** The tiles of a route's sectors (and `pad` sectors round each) as a mask: flowField's `within`. */
  corridor(route: SectorRoute, pad?: number, into?: Uint8Array): Uint8Array;
  /** Rebuild from the grid (after the terrain changed and the grid was rebuilt in place). */
  refresh(grid?: PathGrid): void;
  /** How long the last build took (ms) and how big the graph is. */
  readonly stats: { readonly ms: number; readonly nodes: number; readonly edges: number };
}

// A small binary heap of (priority, value) pairs.
class Heap {
  private p: number[] = [];
  private v: number[] = [];
  get size(): number { return this.p.length; }
  push(pr: number, val: number): void {
    const p = this.p, v = this.v;
    let i = p.length;
    p.push(pr); v.push(val);
    while (i > 0) { const up = (i - 1) >> 1; if (p[up]! <= pr) break; p[i] = p[up]!; v[i] = v[up]!; i = up; }
    p[i] = pr; v[i] = val;
  }
  pop(): [number, number] {
    const p = this.p, v = this.v;
    const top: [number, number] = [p[0]!, v[0]!];
    const lp = p.pop()!, lv = v.pop()!;
    if (p.length) {
      let i = 0;
      const n = p.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mp = lp;
        if (l < n && p[l]! < mp) { m = l; mp = p[l]!; }
        if (r < n && p[r]! < mp) { m = r; mp = p[r]!; }
        if (m === i) break;
        p[i] = p[m]!; v[i] = v[m]!; i = m;
      }
      p[i] = lp; v[i] = lv;
    }
    return top;
  }
}

export function buildSectors(gridIn: PathGrid, { size = 16, spacing = 5 }: { readonly size?: number; readonly spacing?: number } = {}): SectorGraph {
  let g = gridIn;
  const W = g.width, D = g.depth;
  const sectorsX = Math.ceil(W / size), sectorsZ = Math.ceil(D / size);
  let nodes: SectorNode[] = [];
  let edges: Array<Array<[number, number]>> = [];
  let bySector: number[][] = [];
  let stats = { ms: 0, nodes: 0, edges: 0 };
  const sectorOf = (i: number, j: number): number => Math.floor(j / size) * sectorsX + Math.floor(i / size);
  const sectorRect = (s: number): [number, number, number, number] => { const si = s % sectorsX, sj = Math.floor(s / sectorsX); return [si * size, sj * size, Math.min(W, (si + 1) * size), Math.min(D, (sj + 1) * size)]; };

  // Local Dijkstra inside a sector's rectangle: forward (the cost of walking from `start` to each tile) or
  // backward (the cost of walking from each tile to `start`). Returns a map-sized view only over the rectangle.
  const local = new Float64Array(W * D).fill(Infinity);
  const touched: number[] = [];
  function search(start: number, rect: readonly [number, number, number, number], backward: boolean): void {
    for (const k of touched) local[k] = Infinity;
    touched.length = 0;
    const [i0, j0, i1, j1] = rect;
    const heap = new Heap();
    local[start] = 0; touched.push(start);
    heap.push(0, start);
    while (heap.size) {
      const [dk, k] = heap.pop();
      if (dk > local[k]!) continue;
      const i = k % W, j = (k - i) / W;
      const lk = g.links[k]!;
      for (let d = 0; d < 8; d += 1) {
        if (!(lk & (1 << d))) continue;
        const ni = i + DX8[d]!, nj = j + DZ8[d]!;
        if (ni < i0 || nj < j0 || ni >= i1 || nj >= j1) continue;
        const nk = nj * W + ni;
        // (Forward: entering nk costs nk's cost. Backward: the step nk -> k enters k.)
        const step = (d & 1 ? DIAG : ORTH) * (backward ? g.cost[k]! : g.cost[nk]!);
        const nd = dk + step;
        if (nd < local[nk]!) { if (local[nk] === Infinity) touched.push(nk); local[nk] = nd; heap.push(nd, nk); }
      }
    }
  }

  function build(): void {
    const t0 = performance.now();
    nodes = [];
    edges = [];
    bySector = Array.from({ length: sectorsX * sectorsZ }, () => []);
    const add = (k: number): number => { const s = sectorOf(k % W, Math.floor(k / W)); const id = nodes.length; nodes.push({ k, sector: s }); edges.push([]); bySector[s]!.push(id); return id; };
    const link = (a: number, b: number): void => {
      const ka = nodes[a]!.k, kb = nodes[b]!.k;
      edges[a]!.push([b, ORTH * g.cost[kb]!]);
      edges[b]!.push([a, ORTH * g.cost[ka]!]);
    };
    // Portals: runs of orthogonal crossings along each border.
    const runs = (len: number, crossing: (s: number) => [number, number] | null): void => {
      let start = -1;
      for (let s = 0; s <= len; s += 1) {
        const c = s < len ? crossing(s) : null;
        if (c && start < 0) start = s;
        if (!c && start >= 0) {
          const end = s - 1;
          // (A short run gets a portal in its middle; a long one, one at each end and every `spacing` between.)
          const at: number[] = [];
          if (end - start < spacing) at.push((start + end) >> 1);
          else { const n = Math.ceil((end - start) / spacing); for (let q = 0; q <= n; q += 1) at.push(Math.round(start + ((end - start) * q) / n)); }
          for (const p of at) { const [a, b] = crossing(p)!; link(add(a), add(b)); }
          start = -1;
        }
      }
    };
    for (let sj = 0; sj < sectorsZ; sj += 1) for (let si = 0; si < sectorsX; si += 1) {
      const [i0, j0, i1, j1] = sectorRect(sj * sectorsX + si);
      if (i1 < W) runs(j1 - j0, (s) => { const k = (j0 + s) * W + i1 - 1; return g.links[k]! & (1 << 2) ? [k, k + 1] : null; });
      if (j1 < D) runs(i1 - i0, (s) => { const k = (j1 - 1) * W + i0 + s; return g.links[k]! & (1 << 0) ? [k, k + W] : null; });
    }
    // Inside each sector: every node to every other it can walk to.
    let count = 0;
    for (let s = 0; s < bySector.length; s += 1) {
      const list = bySector[s]!;
      if (list.length < 2) continue;
      const rect = sectorRect(s);
      for (const a of list) {
        search(nodes[a]!.k, rect, false);
        for (const b of list) if (b !== a && local[nodes[b]!.k] !== Infinity) { edges[a]!.push([b, local[nodes[b]!.k]!]); count += 1; }
      }
    }
    stats = { ms: performance.now() - t0, nodes: nodes.length, edges: count + nodes.length };
  }
  build();

  const octile = (a: number, b: number): number => {
    const ai = a % W, aj = (a - ai) / W, bi = b % W, bj = (b - bi) / W;
    const dx = Math.abs(ai - bi), dz = Math.abs(aj - bj);
    return ORTH * Math.max(dx, dz) + (DIAG - ORTH) * Math.min(dx, dz);
  };

  const api: SectorGraph = {
    size, sectorsX, sectorsZ,
    get nodes() { return nodes; },
    get edges() { return edges; },
    get stats() { return stats; },
    sectorOf, sectorRect,
    route(from, to) {
      const s = from[1] * W + from[0], e = to[1] * W + to[0];
      if (!g.cost[s] || !g.cost[e]) return null;
      const ss = sectorOf(from[0], from[1]), es = sectorOf(to[0], to[1]);
      // The start's costs to its sector's nodes; each end-sector node's cost to the goal.
      search(s, sectorRect(ss), false);
      const startTo = new Map<number, number>();
      for (const a of bySector[ss]!) if (local[nodes[a]!.k] !== Infinity) startTo.set(a, local[nodes[a]!.k]!);
      const direct = ss === es && local[e] !== Infinity ? local[e]! : Infinity;
      search(e, sectorRect(es), true);
      const toGoal = new Map<number, number>();
      for (const b of bySector[es]!) if (local[nodes[b]!.k] !== Infinity) toGoal.set(b, local[nodes[b]!.k]!);
      // A* over the nodes; -1 stands for the goal.
      const G = new Map<number, number>();
      const from_ = new Map<number, number>();
      const heap = new Heap();
      for (const [a, c] of startTo) { G.set(a, c); from_.set(a, -2); heap.push(c + octile(nodes[a]!.k, e), a); }
      let best = direct, bestVia = -2;
      while (heap.size) {
        const [f, a] = heap.pop();
        if (f >= best) break;
        const ga = G.get(a)!;
        if (f - octile(nodes[a]!.k, e) > ga + 1e-9) continue;
        const tg = toGoal.get(a);
        if (tg !== undefined && ga + tg < best) { best = ga + tg; bestVia = a; }
        for (const [b, c] of edges[a]!) {
          const nb = ga + c;
          if (nb < (G.get(b) ?? Infinity)) { G.set(b, nb); from_.set(b, a); heap.push(nb + octile(nodes[b]!.k, e), b); }
        }
      }
      if (best === Infinity) return null;
      const path: number[] = [];
      for (let a = bestVia; a >= 0; a = from_.get(a)!) path.push(a);
      path.reverse();
      const sectors: number[] = [ss];
      for (const a of path) { const sc = nodes[a]!.sector; if (sectors[sectors.length - 1] !== sc) sectors.push(sc); }
      if (sectors[sectors.length - 1] !== es) sectors.push(es);
      return { cost: best, sectors, nodes: path };
    },
    corridor(route, pad = 0, into) {
      const mask = into && into.length === W * D ? into.fill(0) : new Uint8Array(W * D);
      for (const s of route.sectors) {
        const si = s % sectorsX, sj = Math.floor(s / sectorsX);
        for (let dj = -pad; dj <= pad; dj += 1) for (let di = -pad; di <= pad; di += 1) {
          const a = si + di, b = sj + dj;
          if (a < 0 || b < 0 || a >= sectorsX || b >= sectorsZ) continue;
          const [i0, j0, i1, j1] = sectorRect(b * sectorsX + a);
          for (let j = j0; j < j1; j += 1) mask.fill(1, j * W + i0, j * W + i1);
        }
      }
      return mask;
    },
    refresh(next) { if (next) { if (next.width !== W || next.depth !== D) throw new RangeError("refresh takes a grid of the same size."); g = next; } build(); },
  };
  return api;
}
