// Colliders: the terrain as the solids @keel-engine/physics' character body
// stands on -- turned boxes and wedges -- merged per chunk so a 32 x 32 chunk
// is tens of solids, not a thousand.
//
//   flat tiles    columns from under the chunk up to their tops, merged
//                 greedily into rectangles of one level
//   ramps         a column up to the ramp's lower level, and a wedge rising
//                 one step toward its dir (side-by-side ramps merged into one)
//   bridge decks  a slab at the deck's level, merged along the span
//
// Water is not solid (physics has its own water plane: waterY).

import type { Box, Wedge } from "@keel-engine/physics";
import { FLAG } from "./types.ts";
import type { Terrain } from "./grid.ts";

export interface ChunkColliders {
  readonly chunk: number;
  readonly boxes: Box[];
  readonly wedges: Wedge[];
  /** The chunk version they were made from. */
  readonly version: number;
}

// A ramp rising toward dir d is a wedge whose foot (local +z) faces away from d: frontOf(yaw) = -d.
export const RAMP_YAW: readonly number[] = [Math.PI, -Math.PI / 2, 0, Math.PI / 2];

export interface ColliderOptions {
  /** Bridge decks as slabs (default true; off when the bridge objects bring their own). */
  readonly decks?: boolean;
  /** A deck slab's thickness in metres (default 0.25). */
  readonly deckThickness?: number;
  /** Where every column starts (a level in steps; default: one step under the lowest ground in the chunk and round it). */
  readonly floor?: number;
}

/** One chunk's solids. */
export function chunkColliders(t: Terrain, c: number, { decks = true, deckThickness = 0.25, floor }: ColliderOptions = {}): ChunkColliders {
  const [i0, j0, i1, j1] = t.chunkRect(c);
  const ts = t.tileSize, sh = t.stepHeight;
  const w = i1 - i0, d = j1 - j0;
  let low = Infinity;
  for (let j = Math.max(0, j0 - 1); j < Math.min(t.depth, j1 + 1); j += 1) for (let i = Math.max(0, i0 - 1); i < Math.min(t.width, i1 + 1); i += 1) low = Math.min(low, t.height[t.index(i, j)]!);
  const bottom = (floor ?? low - 1) * sh;
  const boxes: Box[] = [];
  const wedges: Wedge[] = [];
  // Columns: every tile's ground top (a ramp's lower level), merged greedily.
  const top = new Int32Array(w * d);
  for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) top[j * w + i] = t.height[t.index(i0 + i, j0 + j)]!;
  const used = new Uint8Array(w * d);
  for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
    if (used[j * w + i]) continue;
    const lv = top[j * w + i]!;
    let iw = 1;
    while (i + iw < w && !used[j * w + i + iw] && top[j * w + i + iw] === lv) iw += 1;
    let jd = 1;
    grow: while (j + jd < d) {
      for (let a = 0; a < iw; a += 1) if (used[(j + jd) * w + i + a] || top[(j + jd) * w + i + a] !== lv) break grow;
      jd += 1;
    }
    for (let b = 0; b < jd; b += 1) used.fill(1, (j + b) * w + i, (j + b) * w + i + iw);
    const y1 = lv * sh;
    if (y1 <= bottom) continue;
    boxes.push({ c: [(i0 + i + iw / 2) * ts, (bottom + y1) / 2, (j0 + j + jd / 2) * ts], h: [(iw * ts) / 2, (y1 - bottom) / 2, (jd * ts) / 2], yaw: 0, mat: t.type[t.index(i0 + i, j0 + j)]! });
  }
  // Ramps: a wedge each, side-by-side ones (same level, same way) merged across their rise.
  const done = new Uint8Array(w * d);
  for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
    const k = t.index(i0 + i, j0 + j);
    if (done[j * w + i] || !(t.flags[k]! & FLAG.RAMP)) continue;
    const dir = t.dir[k]!, h = t.height[k]!;
    const alongZ = dir === 0 || dir === 2; // (rising along z: merge across x)
    const same = (a: number, b: number): boolean => { if (a >= w || b >= d || done[b * w + a]) return false; const kk = t.index(i0 + a, j0 + b); return (t.flags[kk]! & FLAG.RAMP) !== 0 && t.dir[kk] === dir && t.height[kk] === h; };
    let n = 1;
    while (alongZ ? same(i + n, j) : same(i, j + n)) n += 1;
    for (let s = 0; s < n; s += 1) done[(alongZ ? j : j + s) * w + (alongZ ? i + s : i)] = 1;
    const cx = alongZ ? (i0 + i + n / 2) * ts : (i0 + i + 0.5) * ts;
    const cz = alongZ ? (j0 + j + 0.5) * ts : (j0 + j + n / 2) * ts;
    wedges.push({ kind: "wedge", c: [cx, (h + 0.5) * sh, cz], h: [(n * ts) / 2, sh / 2, ts / 2], yaw: RAMP_YAW[dir]!, lo: 0, mat: t.type[k]! });
  }
  // Decks: slabs along their spans.
  if (decks) {
    const seen = new Uint8Array(w * d);
    for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
      const k = t.index(i0 + i, j0 + j);
      if (seen[j * w + i] || !(t.flags[k]! & FLAG.BRIDGE)) continue;
      const axis = t.dir[k]!, lv = t.deck[k]!;
      const same = (a: number, b: number): boolean => { if (a >= w || b >= d || seen[b * w + a]) return false; const kk = t.index(i0 + a, j0 + b); return (t.flags[kk]! & FLAG.BRIDGE) !== 0 && t.dir[kk] === axis && t.deck[kk] === lv; };
      let n = 1;
      while (axis === 1 ? same(i + n, j) : same(i, j + n)) n += 1;
      for (let s = 0; s < n; s += 1) seen[(axis === 1 ? j : j + s) * w + (axis === 1 ? i + s : i)] = 1;
      const y1 = lv * sh;
      boxes.push({ c: [axis === 1 ? (i0 + i + n / 2) * ts : (i0 + i + 0.5) * ts, y1 - deckThickness / 2, axis === 1 ? (j0 + j + 0.5) * ts : (j0 + j + n / 2) * ts], h: [axis === 1 ? (n * ts) / 2 : ts / 2, deckThickness / 2, axis === 1 ? ts / 2 : (n * ts) / 2], yaw: 0, mat: "deck" });
    }
  }
  return { chunk: c, boxes, wedges, version: t.chunkVersion[c]! };
}

/** Every chunk's solids, for createCharacter({ boxes, wedges }). */
export function terrainColliders(t: Terrain, opts: ColliderOptions = {}): { boxes: Box[]; wedges: Wedge[]; chunks: ChunkColliders[] } {
  const chunks: ChunkColliders[] = [];
  for (let c = 0; c < t.chunksX * t.chunksZ; c += 1) chunks.push(chunkColliders(t, c, opts));
  return { boxes: chunks.flatMap((x) => x.boxes), wedges: chunks.flatMap((x) => x.wedges), chunks };
}

/** The solids near a point (the chunks within `radius` metres): what a body there needs. */
export function collidersNear(t: Terrain, x: number, z: number, radius: number, cache?: Map<number, ChunkColliders>, opts: ColliderOptions = {}): { boxes: Box[]; wedges: Wedge[] } {
  const cs = t.chunk * t.tileSize;
  const boxes: Box[] = [];
  const wedges: Wedge[] = [];
  for (let cj = Math.max(0, Math.floor((z - radius) / cs)); cj <= Math.min(t.chunksZ - 1, Math.floor((z + radius) / cs)); cj += 1) {
    for (let ci = Math.max(0, Math.floor((x - radius) / cs)); ci <= Math.min(t.chunksX - 1, Math.floor((x + radius) / cs)); ci += 1) {
      const c = cj * t.chunksX + ci;
      let cc = cache?.get(c);
      if (!cc || cc.version !== t.chunkVersion[c]) { cc = chunkColliders(t, c, opts); cache?.set(c, cc); }
      boxes.push(...cc.boxes);
      wedges.push(...cc.wedges);
    }
  }
  return { boxes, wedges };
}
