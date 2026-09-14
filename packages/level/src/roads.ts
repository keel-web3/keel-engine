// Roads between points: A* over tiles, four ways (so a crossing is straight
// and a bridge can take it). A road steps from tile to tile only where their
// tops meet (cliffs are walls; ramps are how it climbs), prefers flat, open,
// dry ground and roads already laid, and may cross water in a STRAIGHT run of
// at most `maxSpan` tiles from a bank to a bank at the same level -- exactly
// what bridgeSpans() accepts, so every crossing it makes gets its bridge.

import { DX4, DZ4, FLAG, cornerLevels, edgeLevels, opposite4 } from "@keel-engine/terrain";
import type { Terrain } from "@keel-engine/terrain";
import type { Tile } from "./document.ts";

export interface RoadOptions {
  /** Longest water crossing (default 8). */
  readonly maxSpan?: number;
  /** Tiles a road may not use (spawns' cores, buildings). */
  readonly avoid?: Uint8Array | null;
  /** Cost of a water tile (default 6: a bridge is worth a detour of a few tiles, not a long one). */
  readonly water?: number;
}

// Flat and dry: the level it stands at, or null.
function flatLevel(t: Terrain, i: number, j: number): number | null {
  const k = t.index(i, j);
  if (t.waterDepth(i, j) > 0 || t.flags[k]! & FLAG.BLOCKED) return null;
  const c = cornerLevels(t, i, j);
  return c[0] === c[1] && c[1] === c[2] && c[2] === c[3] ? c[0] : null;
}

/** A road's tiles from `from` to `to` (both included), or null when there's no way. */
export function roadPath(t: Terrain, from: Tile, to: Tile, { maxSpan = 8, avoid = null, water = 6 }: RoadOptions = {}): Tile[] | null {
  const W = t.width, n = t.width * t.depth;
  const road = t.types.has("road") ? t.types.id("road") : -1;
  const lava = t.types.has("lava") ? t.types.id("lava") : -1;
  const cost = (k: number): number => {
    const ty = t.type[k]!;
    if (ty === lava) return Infinity;
    if (ty === road) return 0.35;
    const c = t.types.get(ty).cost;
    return c <= 0 ? Infinity : 0.6 + c * 0.35;
  };
  // State: a tile, and when in water, which way it's crossing (0..3) and how far; the bank's level rides along.
  // Index: k * 5 + (4 on land | the crossing's dir).
  const S = n * 5;
  const g = new Float64Array(S).fill(Infinity);
  const prev = new Int32Array(S).fill(-1);
  const bank = new Int16Array(S);
  const run = new Uint8Array(S);
  const heapK: number[] = [], heapF: number[] = [];
  const push = (s: number, f: number): void => {
    let i = heapK.length;
    heapK.push(s); heapF.push(f);
    while (i > 0) { const p = (i - 1) >> 1; if (heapF[p]! <= f) break; heapK[i] = heapK[p]!; heapF[i] = heapF[p]!; i = p; }
    heapK[i] = s; heapF[i] = f;
  };
  const pop = (): number => {
    const top = heapK[0]!;
    const lk = heapK.pop()!, lf = heapF.pop()!;
    if (heapK.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mf = lf;
        if (l < heapK.length && heapF[l]! < mf) { m = l; mf = heapF[l]!; }
        if (r < heapK.length && heapF[r]! < mf) { m = r; mf = heapF[r]!; }
        if (m === i) break;
        heapK[i] = heapK[m]!; heapF[i] = heapF[m]!; i = m;
      }
      heapK[i] = lk; heapF[i] = lf;
    }
    return top;
  };
  const goal = t.index(to[0], to[1]);
  const h = (k: number): number => { const i = k % W, j = (k - i) / W; return (Math.abs(i - to[0]) + Math.abs(j - to[1])) * 0.5; };
  const start = t.index(from[0], from[1]) * 5 + 4;
  if (flatLevel(t, from[0], from[1]) === null && !t.isRamp(from[0], from[1])) return null;
  g[start] = 0;
  push(start, h(start / 5 | 0));
  let found = -1;
  while (heapK.length) {
    const s = pop();
    const k = (s / 5) | 0, mode = s % 5;
    if (k === goal && mode === 4) { found = s; break; }
    const gs = g[s]!;
    const i = k % W, j = (k - i) / W;
    for (let d = 0; d < 4; d += 1) {
      if (mode !== 4 && d !== mode) continue; // (in water: straight on)
      const ni = i + DX4[d]!, nj = j + DZ4[d]!;
      if (!t.inside(ni, nj)) continue;
      const nk = nj * W + ni;
      if (avoid && avoid[nk] && nk !== goal) continue;
      const wet = t.waterDepth(ni, nj) > 0;
      let ns: number, c: number, nb = bank[s]!, nr = 0;
      if (mode === 4) {
        if (wet) {
          // (Off a flat dry bank into water: a crossing starts, at the bank's level; nothing under it may stand above.)
          const lv = flatLevel(t, i, j);
          if (lv === null || t.water[nk]! > lv || Math.max(...cornerLevels(t, ni, nj)) > lv) continue;
          ns = nk * 5 + d; nb = lv; nr = 1; c = water;
        } else {
          const a = edgeLevels(t, i, j, d), b = edgeLevels(t, ni, nj, opposite4(d));
          if (a[0] !== b[0] || a[1] !== b[1]) continue; // (a cliff)
          ns = nk * 5 + 4; c = cost(nk);
        }
      } else {
        if (wet) {
          if (run[s]! >= maxSpan || t.water[nk]! > nb || Math.max(...cornerLevels(t, ni, nj)) > nb) continue;
          ns = nk * 5 + d; nr = run[s]! + 1; c = water;
        } else {
          // (Out of the water onto a bank at the crossing's level, or not at all.)
          if (flatLevel(t, ni, nj) !== nb) continue;
          ns = nk * 5 + 4; c = cost(nk);
        }
      }
      if (!Number.isFinite(c)) continue;
      const ng = gs + c;
      if (ng < g[ns]!) { g[ns] = ng; prev[ns] = s; bank[ns] = nb; run[ns] = nr; push(ns, ng + h(nk)); }
    }
  }
  if (found < 0) return null;
  const out: Tile[] = [];
  for (let s = found; s >= 0; s = prev[s]!) { const k = (s / 5) | 0; out.push([k % W, Math.floor(k / W)]); }
  return out.reverse();
}

/** Pairs of points to join so every point is reached (a minimum spanning tree by straight distance), plus `extra` shortest others for loops. */
export function roadNetwork(points: readonly Tile[], extra = 0): Array<[number, number]> {
  const n = points.length;
  const edges: Array<[number, number, number]> = [];
  for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) edges.push([Math.hypot(points[a]![0] - points[b]![0], points[a]![1] - points[b]![1]), a, b]);
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  const out: Array<[number, number]> = [];
  const rest: Array<[number, number]> = [];
  for (const [, a, b] of edges) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) { parent[ra] = rb; out.push([a, b]); } else rest.push([a, b]);
  }
  return [...out, ...rest.slice(0, extra)];
}
