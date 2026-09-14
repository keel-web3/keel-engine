// Wave Function Collapse, both flavours, one solver.
//
//   SIMPLE TILED   tiles with edge labels: A may sit east of B when A's west
//                  edge reads the same as B's east edge. Tiles can be given
//                  as 3 x 3 character patterns (edgeTiles), rotated; their
//                  edges are their border rows and columns.
//   OVERLAPPING    patterns are the N x N windows of a sample picture (with
//                  rotations and reflections), weighted by how often they
//                  occur; two may overlap when they agree where they do. The
//                  output cell is its pattern's top-left value.
//
// The solver: every cell holds a domain (a bitset of tiles still possible);
// the cell of least entropy (weighted, a hashed tie-break) collapses to a
// weighted choice; the choice propagates (arc consistency over the adjacency
// table). CONSTRAINTS restrict domains up front (a border that must be wall,
// a cell pinned to a tile). On a contradiction it BACKTRACKS: the last
// decisions are snapshots; restore, ban the choice, propagate again. A STEP
// BUDGET (decisions plus backtracks) and a cap on backtracks bound it: past
// either, it stops with ok: false and the best it had (undecided cells take
// their likeliest tile), so a caller always gets a grid. (Steps, never
// milliseconds: a time budget stops at a different point on a slower or busier
// machine, and the same seed would make a different map there.)

import { dlog } from "@keel-engine/core";
import { hash01, rngOf, seedOf } from "./noise.ts";

export interface WfcModel {
  readonly count: number;
  readonly weights: Float64Array;
  /** allowed[d][t]: the bitset (words) of tiles allowed at the neighbour in direction d (0 N / y-1, 1 E / x+1, 2 S / y+1, 3 W / x-1) of tile t. */
  readonly allowed: readonly (readonly Uint32Array[])[];
  readonly words: number;
  /** A name per tile (tiled) or its value (overlapping). */
  readonly names: readonly string[];
}

export interface WfcOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: string | number;
  /** Restrict a cell's domain: return the tiles it may take (null: any). */
  readonly constrain?: (x: number, y: number) => readonly number[] | null;
  /** Decisions plus backtracks before giving up (default 8 x the cells; a solvable grid takes about one a cell). */
  readonly steps?: number;
  readonly maxBacktracks?: number;
  /** Snapshots kept for backtracking (default 64). */
  readonly depth?: number;
}

export interface WfcResult {
  readonly ok: boolean;
  /** A tile index per cell (row-major); -1 only if never decided and no likely tile (ok: false). */
  readonly grid: Int32Array;
  readonly contradictions: number;
  readonly backtracks: number;
  readonly decisions: number;
  readonly reason: "solved" | "steps" | "backtracks" | "impossible";
}

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

// ---------------------------------------------------------------- models

/** A simple tiled model from tiles with edge labels [n, e, s, w] (read clockwise? no: n and s left-to-right, e and w top-to-bottom). */
export function tiledModel(tiles: ReadonlyArray<{ readonly name: string; readonly weight: number; readonly edges: readonly [string, string, string, string] }>): WfcModel {
  const count = tiles.length, words = Math.ceil(count / 32);
  const allowed = [0, 1, 2, 3].map(() => tiles.map(() => new Uint32Array(words)));
  const opp = [2, 3, 0, 1];
  for (let a = 0; a < count; a += 1) for (let b = 0; b < count; b += 1) for (let d = 0; d < 4; d += 1) {
    if (tiles[a]!.edges[d] === tiles[b]!.edges[opp[d]!]) { const row = allowed[d]![a]!; row[b >> 5] = row[b >> 5]! | (1 << (b & 31)); }
  }
  return { count, words, allowed, weights: Float64Array.from(tiles.map((t) => t.weight)), names: tiles.map((t) => t.name) };
}

/**
 * Tiles from character patterns (rows of equal length), each with its
 * rotations (distinct ones only): edges are the pattern's border rows and
 * columns, so two tiles fit where their touching borders match cell for cell.
 */
export function edgeTiles(patterns: ReadonlyArray<{ readonly name: string; readonly rows: readonly string[]; readonly weight: number; readonly rotate?: boolean }>): Array<{ name: string; weight: number; edges: [string, string, string, string]; rows: string[] }> {
  const out: Array<{ name: string; weight: number; edges: [string, string, string, string]; rows: string[] }> = [];
  const rot = (rows: readonly string[]): string[] => { const n = rows.length; return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => rows[n - 1 - x]![y]!).join("")); };
  for (const p of patterns) {
    const seen = new Set<string>();
    let rows = [...p.rows];
    const turns = p.rotate === false ? 1 : 4;
    const variants: string[][] = [];
    for (let r = 0; r < turns; r += 1) { const key = rows.join("/"); if (!seen.has(key)) { seen.add(key); variants.push(rows); } rows = rot(rows); }
    for (const [r, v] of variants.entries()) {
      const n = v.length;
      const edges: [string, string, string, string] = [v[0]!, v.map((row) => row[n - 1]!).join(""), v[n - 1]!, v.map((row) => row[0]!).join("")];
      out.push({ name: variants.length > 1 ? `${p.name}.${r}` : p.name, weight: p.weight / variants.length, edges, rows: v });
    }
  }
  return out;
}

/** An overlapping model from a sample (w x h values), N x N patterns, with rotations/reflections. */
export function overlappingModel(sample: ArrayLike<number>, sw: number, sh: number, { N = 3, symmetry = 8, periodic = true }: { readonly N?: number; readonly symmetry?: 1 | 2 | 4 | 8; readonly periodic?: boolean } = {}): WfcModel & { readonly patterns: readonly Uint8Array[]; readonly N: number } {
  const at = (x: number, y: number): number => sample[((y + sh) % sh) * sw + ((x + sw) % sw)]!;
  const index = new Map<string, number>();
  const patterns: Uint8Array[] = [];
  const counts: number[] = [];
  const rotate = (p: Uint8Array): Uint8Array => { const q = new Uint8Array(N * N); for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) q[y * N + x] = p[(N - 1 - x) * N + y]!; return q; };
  const reflect = (p: Uint8Array): Uint8Array => { const q = new Uint8Array(N * N); for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) q[y * N + x] = p[y * N + N - 1 - x]!; return q; };
  const ymax = periodic ? sh : sh - N + 1, xmax = periodic ? sw : sw - N + 1;
  for (let y = 0; y < ymax; y += 1) for (let x = 0; x < xmax; x += 1) {
    const base = new Uint8Array(N * N);
    for (let dy = 0; dy < N; dy += 1) for (let dx = 0; dx < N; dx += 1) base[dy * N + dx] = at(x + dx, y + dy);
    const vs: Uint8Array[] = [base];
    for (let i = 1; i < 8; i += 1) vs.push(i % 2 ? reflect(vs[i - 1]!) : rotate(vs[i - 2]!));
    for (let i = 0; i < symmetry; i += 1) {
      const key = vs[i]!.join(",");
      const have = index.get(key);
      if (have === undefined) { index.set(key, patterns.length); patterns.push(vs[i]!); counts.push(1); } else counts[have] = counts[have]! + 1;
    }
  }
  const count = patterns.length, words = Math.ceil(count / 32);
  const agree = (a: Uint8Array, b: Uint8Array, dx: number, dy: number): boolean => {
    for (let y = Math.max(0, dy); y < Math.min(N, N + dy); y += 1) for (let x = Math.max(0, dx); x < Math.min(N, N + dx); x += 1) if (a[y * N + x] !== b[(y - dy) * N + (x - dx)]) return false;
    return true;
  };
  const allowed = [0, 1, 2, 3].map((d) => patterns.map((a) => { const bits = new Uint32Array(words); patterns.forEach((b, j) => { if (agree(a, b, DX[d]!, DY[d]!)) bits[j >> 5] = bits[j >> 5]! | (1 << (j & 31)); }); return bits; }));
  return { count, words, allowed, weights: Float64Array.from(counts), names: patterns.map((p) => String(p[0])), patterns, N };
}

// ---------------------------------------------------------------- the solver

const popcount = (v: number): number => { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };

export function solveWfc(model: WfcModel, opts: WfcOptions): WfcResult {
  const { width: W, height: H } = opts;
  const { count: T, words: Wd, weights, allowed } = model;
  const N = W * H;
  const steps = opts.steps ?? 8 * N, maxBack = opts.maxBacktracks ?? 2000, depthCap = opts.depth ?? 64;
  let dom: Uint32Array = new Uint32Array(N * Wd);
  const full = new Uint32Array(Wd);
  for (let t = 0; t < T; t += 1) full[t >> 5] = full[t >> 5]! | (1 << (t & 31));
  for (let c = 0; c < N; c += 1) dom.set(full, c * Wd);
  const seed = typeof opts.seed === "number" ? opts.seed : seedOf(opts.seed, "wfc");
  const f = rngOf(seed);
  const logW = Float64Array.from(weights, (w) => (w > 0 ? w * dlog(w) : 0));
  let contradictions = 0, backtracks = 0, decisions = 0;
  const stack: number[] = [];
  const onStack = new Uint8Array(N);
  const tmp = new Uint32Array(Wd);
  // Propagate from the cells on the stack: each neighbour keeps only what some tile here allows.
  const propagate = (): boolean => {
    while (stack.length) {
      const c = stack.pop()!;
      onStack[c] = 0;
      const x = c % W, y = (c - x) / W;
      for (let d = 0; d < 4; d += 1) {
        const nx = x + DX[d]!, ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        tmp.fill(0);
        for (let wd = 0; wd < Wd; wd += 1) {
          let bits = dom[c * Wd + wd]!;
          while (bits) { const b = bits & -bits; const t = (wd << 5) + (31 - Math.clz32(b)); bits ^= b; const al = allowed[d]![t]!; for (let q = 0; q < Wd; q += 1) tmp[q] = tmp[q]! | al[q]!; }
        }
        let changed = false, any = false;
        for (let q = 0; q < Wd; q += 1) { const o = dom[n * Wd + q]!, v = o & tmp[q]!; if (v !== o) { dom[n * Wd + q] = v; changed = true; } if (v) any = true; }
        if (!any) return false;
        if (changed && !onStack[n]) { onStack[n] = 1; stack.push(n); }
      }
    }
    return true;
  };
  const clearStack = (): void => { while (stack.length) onStack[stack.pop()!] = 0; };
  // Constraints first.
  if (opts.constrain) {
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const allow = opts.constrain(x, y);
      if (!allow) continue;
      const c = y * W + x;
      const bits = new Uint32Array(Wd);
      for (const t of allow) bits[t >> 5] = bits[t >> 5]! | (1 << (t & 31));
      for (let q = 0; q < Wd; q += 1) dom[c * Wd + q] = dom[c * Wd + q]! & bits[q]!;
      onStack[c] = 1; stack.push(c);
    }
  }
  const finish = (ok: boolean, reason: WfcResult["reason"]): WfcResult => {
    const grid = new Int32Array(N).fill(-1);
    for (let c = 0; c < N; c += 1) {
      let best = -1, bw = -1;
      for (let t = 0; t < T; t += 1) if (dom[c * Wd + (t >> 5)]! & (1 << (t & 31)) && weights[t]! > bw) { bw = weights[t]!; best = t; }
      grid[c] = best;
    }
    return { ok, grid, contradictions, backtracks, decisions, reason };
  };
  // (Arc consistency over the whole grid first: a tile set that can't tile the plane at all is found here.)
  for (let c = 0; c < N; c += 1) if (!onStack[c]) { onStack[c] = 1; stack.push(c); }
  if (!propagate()) return finish(false, "impossible");
  // Decisions: snapshots for backtracking.
  const snaps: Array<{ dom: Uint32Array; cell: number; tile: number }> = [];
  for (;;) {
    if (decisions + backtracks >= steps) return finish(false, "steps");
    // The least-entropy undecided cell.
    let best = -1, bestE = Infinity;
    for (let c = 0; c < N; c += 1) {
      let n = 0;
      for (let q = 0; q < Wd; q += 1) n += popcount(dom[c * Wd + q]!);
      if (n <= 1) continue;
      let sw = 0, swl = 0;
      for (let q = 0; q < Wd; q += 1) { let bits = dom[c * Wd + q]!; while (bits) { const b = bits & -bits; const t = (q << 5) + (31 - Math.clz32(b)); bits ^= b; sw += weights[t]!; swl += logW[t]!; } }
      const e = dlog(sw) - swl / sw + hash01(c, decisions, seed) * 1e-6;
      if (e < bestE) { bestE = e; best = c; }
    }
    if (best < 0) return finish(true, "solved");
    // A weighted pick among what's left.
    let sw = 0;
    for (let t = 0; t < T; t += 1) if (dom[best * Wd + (t >> 5)]! & (1 << (t & 31))) sw += weights[t]!;
    let r = f() * sw, pick = -1;
    for (let t = 0; t < T; t += 1) if (dom[best * Wd + (t >> 5)]! & (1 << (t & 31))) { pick = t; r -= weights[t]!; if (r < 0) break; }
    snaps.push({ dom: dom.slice(), cell: best, tile: pick });
    if (snaps.length > depthCap) snaps.shift();
    decisions += 1;
    for (let q = 0; q < Wd; q += 1) dom[best * Wd + q] = 0;
    dom[best * Wd + (pick >> 5)] = 1 << (pick & 31);
    onStack[best] = 1; stack.push(best);
    let ok = propagate();
    // Backtrack: restore the snapshot, ban its choice, propagate; on failure go further back.
    while (!ok) {
      contradictions += 1;
      clearStack();
      const s = snaps.pop();
      if (!s) return finish(false, "impossible");
      backtracks += 1;
      if (backtracks > maxBack) { dom = s.dom; return finish(false, "backtracks"); }
      dom = s.dom;
      dom[s.cell * Wd + (s.tile >> 5)] = dom[s.cell * Wd + (s.tile >> 5)]! & ~(1 << (s.tile & 31));
      let left = 0;
      for (let q = 0; q < Wd; q += 1) left += popcount(dom[s.cell * Wd + q]!);
      if (!left) continue;
      onStack[s.cell] = 1; stack.push(s.cell);
      // (Chronological backtracking: the ban lives in the restored state; the next decision snapshots again, and a
      // contradiction from here unwinds to the decision before this one.)
      ok = propagate();
    }
  }
}

// ---------------------------------------------------------------- dungeons and towns by WFC

/** The dungeon's macro tiles: 3 x 3 cells, '#' wall, '.' floor. */
export const DUNGEON_TILES = edgeTiles([
  { name: "solid", rows: ["###", "###", "###"], weight: 7, rotate: false },
  { name: "room", rows: ["...", "...", "..."], weight: 4, rotate: false },
  { name: "corridor", rows: ["#.#", "#.#", "#.#"], weight: 3 },
  { name: "corner", rows: ["#.#", "#..", "###"], weight: 2 },
  { name: "tee", rows: ["#.#", "...", "###"], weight: 0.8 },
  { name: "cross", rows: ["#.#", "...", "#.#"], weight: 0.4, rotate: false },
  { name: "end", rows: ["#.#", "#.#", "###"], weight: 0.25 },
  { name: "wall-side", rows: ["###", "...", "..."], weight: 2 },
  { name: "wall-corner", rows: ["###", "#..", "#.."], weight: 1.6 },
  { name: "doorway", rows: ["#.#", "...", "..."], weight: 0.9 },
  { name: "pillar", rows: ["...", ".#.", "..."], weight: 0.25, rotate: false },
]);

/** A dungeon's cells (0 wall, 1 floor) by simple tiled WFC over DUNGEON_TILES, walls round the border. */
export function wfcDungeonCells(seed: string, w: number, d: number, steps?: number): Uint8Array {
  const tiles = DUNGEON_TILES;
  const model = tiledModel(tiles);
  const gw = Math.max(2, Math.floor(w / 3)), gh = Math.max(2, Math.floor(d / 3));
  const solid = (edge: string): boolean => !edge.includes(".");
  const res = solveWfc(model, {
    width: gw, height: gh, seed: seedOf(seed, "wfc-dungeon"), ...(steps === undefined ? {} : { steps }),
    constrain: (x, y) => {
      if (x > 0 && y > 0 && x < gw - 1 && y < gh - 1) return null;
      return tiles.map((t, i) => ((y > 0 || solid(t.edges[0])) && (x < gw - 1 || solid(t.edges[1])) && (y < gh - 1 || solid(t.edges[2])) && (x > 0 || solid(t.edges[3])) ? i : -1)).filter((i) => i >= 0);
    },
  });
  const cells = new Uint8Array(w * d);
  for (let gy = 0; gy < gh; gy += 1) for (let gx = 0; gx < gw; gx += 1) {
    const t = res.grid[gy * gw + gx]!;
    if (t < 0) continue;
    const rows = tiles[t]!.rows;
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) {
      const cx = gx * 3 + x, cy = gy * 3 + y;
      if (cx < w && cy < d) cells[cy * w + cx] = rows[y]![x] === "." ? 1 : 0;
    }
  }
  // (The map's own border is wall whatever the tiles said.)
  for (let i = 0; i < w; i += 1) { cells[i] = 0; cells[(d - 1) * w + i] = 0; }
  for (let j = 0; j < d; j += 1) { cells[j * w] = 0; cells[j * w + w - 1] = 0; }
  return cells;
}

/** A town's tiles: 'g' grass, 'r' road, 'h' a house's lot, 'f' a garden. */
export const TOWN_TILES = edgeTiles([
  { name: "grass", rows: ["ggg", "ggg", "ggg"], weight: 5, rotate: false },
  { name: "road", rows: ["grg", "grg", "grg"], weight: 3 },
  { name: "bend", rows: ["grg", "grr", "ggg"], weight: 1.4 },
  { name: "tee", rows: ["grg", "rrr", "ggg"], weight: 1.2 },
  { name: "cross", rows: ["grg", "rrr", "grg"], weight: 0.6, rotate: false },
  { name: "lot", rows: ["ggg", "ghg", "grg"], weight: 2.2 },
  { name: "garden", rows: ["ggg", "gfg", "ggg"], weight: 0.8, rotate: false },
]);

/** A town plan by simple tiled WFC: per cell 'g' 'r' 'h' 'f' (w x d cells), roads kept off the border's outside. */
export function wfcTown(seed: string, w: number, d: number, steps?: number): { plan: string[]; result: WfcResult } {
  const tiles = TOWN_TILES;
  const model = tiledModel(tiles);
  const gw = Math.max(2, Math.floor(w / 3)), gh = Math.max(2, Math.floor(d / 3));
  const quiet = (edge: string): boolean => !edge.includes("r");
  const result = solveWfc(model, {
    width: gw, height: gh, seed: seedOf(seed, "wfc-town"), ...(steps === undefined ? {} : { steps }),
    constrain: (x, y) => {
      // (Roads may leave the town on its south and west edges' middles -- the way in; elsewhere the border is quiet.)
      if (x > 0 && y > 0 && x < gw - 1 && y < gh - 1) return null;
      return tiles.map((t, i) => ((y > 0 || quiet(t.edges[0]) || x === gw >> 1) && (x < gw - 1 || quiet(t.edges[1])) && (y < gh - 1 || quiet(t.edges[2])) && (x > 0 || quiet(t.edges[3]) || y === gh >> 1) ? i : -1)).filter((i) => i >= 0);
    },
  });
  const plan = Array.from({ length: d }, () => Array.from({ length: w }, () => "g"));
  for (let gy = 0; gy < gh; gy += 1) for (let gx = 0; gx < gw; gx += 1) {
    const t = result.grid[gy * gw + gx]!;
    if (t < 0) continue;
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) { const cy = gy * 3 + y, cx = gx * 3 + x; if (cy < d && cx < w) plan[cy]![cx] = tiles[t]!.rows[y]![x]!; }
  }
  return { plan: plan.map((row) => row.join("")), result };
}
