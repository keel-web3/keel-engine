// Flow fields: one search from a goal answers every unit heading there.
// An INTEGRATION field (the cost of the cheapest way to the goal from every
// tile) by Dijkstra over the path grid's links, then a DIRECTION per tile (the
// dir8 step down the field). Thousands of units share one field; each reads
// its tile's direction (or steer() for a smooth heading) -- no per-unit search.
//
// Costs are whole numbers (an orthogonal step onto a tile costs 5 x its cost,
// a diagonal 7 x: 1.4), so the search is Dial's bucket queue -- O(tiles + the
// largest distance), no heap -- over typed arrays kept between calls. A
// 256 x 256 map (keel-rts RTS.md's 24-player size) takes a few milliseconds
// (test/flowfield.test.ts measures).
//
//   const f = flowField(grid, [goalTile]);
//   f.dir[k]           dir8 to step (GOAL at a goal, NONE where unreachable)
//   f.dist[k]          the integration value (UNREACHED where unreachable)
//   steer(f, x, z, tileSize) -> [dx, dz]   a unit heading, blended across tiles

import { dhypot } from "@keel-engine/core";
import { DX8, DZ8 } from "./types.ts";
import type { PathGrid } from "./pathing.ts";

export const UNREACHED = 0xffffffff;
export const GOAL = 8;
export const NONE = 255;
const ORTH = 5;
const DIAG = 7;

export interface FlowField {
  readonly width: number;
  readonly depth: number;
  /** Integration: the cost to the nearest goal (UNREACHED: none). */
  readonly dist: Uint32Array;
  /** The dir8 step toward the goal; GOAL on a goal; NONE where it can't be reached. */
  readonly dir: Uint8Array;
  readonly goals: readonly number[];
  /** Tiles the search settled (reached). */
  readonly reached: number;
}

export interface FlowOptions {
  /** Reuse a field's arrays (same size): no allocation. */
  readonly into?: FlowField;
  /** Only tiles whose byte is 1 may be crossed (a corridor from HPA*); null: all. */
  readonly within?: Uint8Array | null;
  /** Stop spreading past this integration value (a local field). */
  readonly maxDist?: number;
}

// Scratch kept between calls: bucket heads and a pool of queue entries.
let pool = { size: 0, node: new Int32Array(0), next: new Int32Array(0) };
const BUCKETS = 2048; // (> the largest step: 7 x 255)
const MASK = BUCKETS - 1;
const head = new Int32Array(BUCKETS);

/** Goals as tile indices (numbers) or [i, j] pairs. */
export type Goals = readonly number[] | readonly (readonly [number, number])[];

/** The flow field toward a set of goal tiles (the cheapest way to the nearest). */
export function flowField(g: PathGrid, goalsIn: Goals, { into, within = null, maxDist = UNREACHED - 1 }: FlowOptions = {}): FlowField {
  const { width, depth, cost, links } = g;
  const n = width * depth;
  const goals = goalsIn.map((x) => (typeof x === "number" ? x : x[1] * width + x[0])).filter((k) => k >= 0 && k < n && cost[k]! > 0 && (!within || within[k] === 1));
  const dist = into && into.dist.length === n ? into.dist : new Uint32Array(n);
  const dir = into && into.dir.length === n ? into.dir : new Uint8Array(n);
  dist.fill(UNREACHED);
  dir.fill(NONE);
  const want = n * 8 + goals.length + 16;
  if (pool.size < want) pool = { size: want, node: new Int32Array(want), next: new Int32Array(want) };
  const { node, next } = pool;
  head.fill(-1);
  let used = 0;
  let queued = 0;
  const push = (k: number, d: number): void => {
    const b = d & MASK;
    node[used] = k;
    next[used] = head[b]!;
    head[b] = used;
    used += 1;
    queued += 1;
  };
  for (const k of goals) { if (dist[k] !== 0) { dist[k] = 0; push(k, 0); } }
  let cur = 0;
  let reached = 0;
  // (Stepping from a tile u onto v costs v's cost: spreading from v back to u, u -> v must be linked.)
  while (queued > 0) {
    const b = cur & MASK;
    let e = head[b]!;
    while (e !== -1) {
      head[b] = next[e]!;
      queued -= 1;
      const v = node[e]!;
      e = head[b]!;
      if (dist[v] !== cur) continue; // (a stale entry: settled cheaper before)
      reached += 1;
      const vi = v % width, vj = (v - vi) / width;
      const lv = links[v]!;
      const cv = cost[v]!;
      for (let d = 0; d < 8; d += 1) {
        if (!(lv & (1 << d))) continue; // (links are symmetric: v -> u allowed means u -> v)
        const u = (vj + DZ8[d]!) * width + vi + DX8[d]!;
        if (within && within[u] !== 1) continue;
        const nd = cur + (d & 1 ? DIAG : ORTH) * cv;
        if (nd < dist[u]! && nd <= maxDist) { dist[u] = nd; push(u, nd); }
      }
    }
    cur += 1;
  }
  // Directions: each reached tile steps to the neighbour its best way runs through.
  for (let k = 0; k < n; k += 1) {
    const dk = dist[k]!;
    if (dk === UNREACHED) continue;
    if (dk === 0) { dir[k] = GOAL; continue; }
    const i = k % width, j = (k - i) / width;
    const lk = links[k]!;
    let best = UNREACHED, bestD = UNREACHED, bd = NONE;
    for (let d = 0; d < 8; d += 1) {
      if (!(lk & (1 << d))) continue;
      const v = (j + DZ8[d]!) * width + i + DX8[d]!;
      const dv = dist[v]!;
      if (dv === UNREACHED) continue;
      const via = dv + (d & 1 ? DIAG : ORTH) * cost[v]!;
      // (Ties: the neighbour nearer the goal -- a diagonal through open ground over two orthogonal steps.)
      if (via < best || (via === best && dv < bestD)) { best = via; bestD = dv; bd = d; }
    }
    dir[k] = bd;
  }
  return { width, depth, dist, dir, goals, reached };
}

/** Follow a field from a tile to its goal: the tiles on the way (the start first). Empty if unreachable. */
export function followField(f: FlowField, i: number, j: number, max = f.width * f.depth): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let k = j * f.width + i;
  if (f.dir[k] === NONE) return out;
  for (let s = 0; s < max; s += 1) {
    const ci = k % f.width, cj = (k - ci) / f.width;
    out.push([ci, cj]);
    const d = f.dir[k]!;
    if (d === GOAL || d === NONE) break;
    k = (cj + DZ8[d]!) * f.width + ci + DX8[d]!;
  }
  return out;
}

const INV = 1 / Math.SQRT2;
const VX = DX8.map((x, d) => (d & 1 ? x * INV : x));
const VZ = DZ8.map((z, d) => (d & 1 ? z * INV : z));

/**
 * A unit's heading at a world point: the four nearest tiles' directions
 * blended by distance (so a crowd flows round corners rather than turning on
 * tile lines), normalised; [0, 0] at the goal or where the field has nothing.
 * `out` is reused when given.
 */
export function steer(f: FlowField, x: number, z: number, tileSize: number, out: [number, number] = [0, 0]): [number, number] {
  const fx = x / tileSize - 0.5, fz = z / tileSize - 0.5;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const u = fx - i0, v = fz - j0;
  let sx = 0, sz = 0;
  const here = Math.floor(z / tileSize) * f.width + Math.floor(x / tileSize);
  const hd = here >= 0 && here < f.dir.length ? f.dir[here]! : NONE;
  for (let c = 0; c < 4; c += 1) {
    const i = i0 + (c & 1), j = j0 + (c >> 1);
    if (i < 0 || j < 0 || i >= f.width || j >= f.depth) continue;
    const d = f.dir[j * f.width + i]!;
    if (d >= GOAL) continue;
    const w = (c & 1 ? u : 1 - u) * (c >> 1 ? v : 1 - v);
    sx += VX[d]! * w; sz += VZ[d]! * w;
  }
  // (The tile's own step wins when the blend cancels out or points somewhere it can't go.)
  if (hd < GOAL && sx * VX[hd]! + sz * VZ[hd]! <= 0.1) { sx = VX[hd]!; sz = VZ[hd]!; }
  const L = dhypot(sx, sz);
  if (L < 1e-9) { out[0] = 0; out[1] = 0; return out; }
  out[0] = sx / L; out[1] = sz / L;
  return out;
}

/** Fields by key, the least recently used dropped past `capacity` (keel-rts RTS.md: 256 per goal sector and move class). */
export interface FlowCache {
  /** The field for a key (built with `make` when missing). */
  get(key: string, make: (into: FlowField | undefined) => FlowField): FlowField;
  has(key: string): boolean;
  /** Forget every field (the terrain changed). */
  clear(): void;
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
}

export function createFlowCache({ capacity = 256 }: { readonly capacity?: number } = {}): FlowCache {
  const map = new Map<string, FlowField>();
  let hits = 0, misses = 0;
  return {
    get(key, make) {
      const f = map.get(key);
      if (f) { hits += 1; map.delete(key); map.set(key, f); return f; }
      misses += 1;
      let spare: FlowField | undefined;
      if (map.size >= capacity) { const oldest = map.keys().next().value as string; spare = map.get(oldest); map.delete(oldest); }
      const made = make(spare);
      map.set(key, made);
      return made;
    },
    has: (key) => map.has(key),
    clear() { map.clear(); },
    get size() { return map.size; },
    get hits() { return hits; },
    get misses() { return misses; },
  };
}
