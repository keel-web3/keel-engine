// Walkability: the terrain as a grid a thousand units can path over. Per
// tile a COST (0: blocked) and LINKS -- a byte, bit d set when a unit can step
// from the tile to its dir8 neighbour d. Links are the cliff rule
// (cliffs.ts): two tiles join when their tops meet along their shared edge,
// so a cliff blocks, a ramp's foot and top join the levels it spans, and
// ramps side by side join each other. A diagonal step needs both orthogonal
// steps round it (no cutting corners past a cliff).
//
// Move classes (keel-rts RTS.md 5.4):
//   ground      dry land; shallow water fords at a cost; bridges along their axis
//   large       ground that needs its 3 x 3 around it clear (big units)
//   hover       ground, and any water at its surface
//   amphibious  ground, and any water, slowly
// Air needs no grid (separation only).
//
// A level adds what stands on the ground (buildings, walls) with `blocked`.

import { DX4, DX8, DZ4, DZ8, FLAG, WATER_NONE, opposite4 } from "./types.ts";
import { cornerLevels } from "./cliffs.ts";
import type { Terrain } from "./grid.ts";

export type MoveClass = "ground" | "large" | "hover" | "amphibious";
export const MOVE_CLASSES: readonly MoveClass[] = ["ground", "large", "hover", "amphibious"];

export interface PathGrid {
  readonly width: number;
  readonly depth: number;
  readonly moveClass: MoveClass;
  /** Per tile: 0 blocked, else the cost of stepping onto it (orthogonal; diagonal x1.4). */
  readonly cost: Uint8Array;
  /** Per tile: bit d set when a step to its dir8 neighbour d is allowed. */
  readonly links: Uint8Array;
  /** Per tile: the level a unit walks at there (steps; a ramp's lower level, a deck's, the water's). */
  readonly level: Int16Array;
  /** The terrain version it was built from. */
  readonly version: number;
  passable(i: number, j: number): boolean;
  /** Can a unit step from tile (i, j) to its dir8 neighbour d? */
  linked(i: number, j: number, d: number): boolean;
}

export interface PathOptions {
  readonly moveClass?: MoveClass;
  /** Tiles something stands on: a byte a tile (1: blocked), or a test. */
  readonly blocked?: Uint8Array | ((i: number, j: number) => boolean) | null;
  /** Cost overrides by terrain type name (0: impassable). */
  readonly costs?: Readonly<Record<string, number>>;
  /** Cost of fording shallow water (ground classes; default 5) and of crossing water (hover 1, amphibious 4). */
  readonly ford?: number;
  /** A bridge deck's cost (default 1). */
  readonly bridge?: number;
}

/** Build the walkability grid of a terrain for a move class. */
export function buildPathGrid(t: Terrain, { moveClass = "ground", blocked = null, costs = {}, ford = 5, bridge = 1 }: PathOptions = {}): PathGrid {
  const { width, depth } = t;
  const n = width * depth;
  const cost = new Uint8Array(n);
  const links = new Uint8Array(n);
  const level = new Int16Array(n);
  const corners = new Int16Array(n * 4);
  const typeCost = t.types.list.map((ty) => Math.max(0, Math.min(255, Math.round(costs[ty.name] ?? ty.cost))));
  const isBlocked = typeof blocked === "function" ? blocked : blocked ? (i: number, j: number) => blocked[j * width + i] === 1 : () => false;
  const onWater = moveClass === "hover" || moveClass === "amphibious";
  const waterCost = moveClass === "hover" ? 1 : moveClass === "amphibious" ? 4 : ford;

  for (let j = 0; j < depth; j += 1) for (let i = 0; i < width; i += 1) {
    const k = j * width + i;
    const f = t.flags[k]!;
    let c = 0;
    let flat: number | null = null;
    if (f & FLAG.BRIDGE) { c = bridge; flat = t.deck[k]!; }
    else {
      const w = t.water[k]!;
      const wet = w !== WATER_NONE ? w - t.height[k]! : 0;
      if (wet > 0) {
        if (onWater || wet === 1) { c = Math.max(waterCost, onWater ? 0 : typeCost[t.type[k]!]!); flat = w; }
      } else c = typeCost[t.type[k]!]!;
    }
    if (c > 0 && isBlocked(i, j)) c = 0;
    cost[k] = c;
    if (flat !== null) { corners[k * 4] = corners[k * 4 + 1] = corners[k * 4 + 2] = corners[k * 4 + 3] = flat; level[k] = flat; }
    else { const cl = cornerLevels(t, i, j); corners.set(cl, k * 4); level[k] = t.height[k]!; }
  }
  // Orthogonal links: both passable, their tops meeting along the shared edge, a bridge only along its axis.
  const EDGE: readonly (readonly [number, number])[] = [[2, 3], [1, 3], [0, 1], [0, 2]];
  const along = (k: number, d: number): boolean => !(t.flags[k]! & FLAG.BRIDGE) || (t.dir[k] === 0 ? (d & 1) === 0 : (d & 1) === 1);
  for (let j = 0; j < depth; j += 1) for (let i = 0; i < width; i += 1) {
    const k = j * width + i;
    if (!cost[k]) continue;
    let m = 0;
    for (let d = 0; d < 4; d += 1) {
      const ni = i + DX4[d]!, nj = j + DZ4[d]!;
      if (ni < 0 || nj < 0 || ni >= width || nj >= depth) continue;
      const nk = nj * width + ni;
      if (!cost[nk] || !along(k, d) || !along(nk, d)) continue;
      const [a0, a1] = EDGE[d]!, [b0, b1] = EDGE[opposite4(d)]!;
      if (corners[k * 4 + a0] === corners[nk * 4 + b0] && corners[k * 4 + a1] === corners[nk * 4 + b1]) m |= 1 << (d * 2);
    }
    links[k] = m;
  }
  // Diagonals: both orthogonal steps round them, both ways.
  for (let j = 0; j < depth; j += 1) for (let i = 0; i < width; i += 1) {
    const k = j * width + i;
    const m = links[k]!;
    if (!m) continue;
    let add = 0;
    for (let d = 1; d < 8; d += 2) {
      const a = (d + 7) & 7, b = (d + 1) & 7;
      if (!(m & (1 << a)) || !(m & (1 << b))) continue;
      const ak = (j + DZ8[a]!) * width + (i + DX8[a]!), bk = (j + DZ8[b]!) * width + (i + DX8[b]!);
      // (From the side tiles on to the diagonal: a's neighbour toward b, b's toward a.)
      if (links[ak]! & (1 << b) && links[bk]! & (1 << a)) add |= 1 << d;
    }
    links[k] = m | add;
  }
  if (moveClass === "large") shrink(width, depth, cost, links);
  return grid(width, depth, moveClass, cost, links, level, t.version);
}

// Large units: a tile stays only when all 8 round it are linked to it (a 3 x 3 clear through its middle).
function shrink(width: number, depth: number, cost: Uint8Array, links: Uint8Array): void {
  const keep = new Uint8Array(cost.length);
  for (let k = 0; k < cost.length; k += 1) keep[k] = cost[k] && links[k] === 255 ? 1 : 0;
  for (let j = 0; j < depth; j += 1) for (let i = 0; i < width; i += 1) {
    const k = j * width + i;
    if (!keep[k]) { cost[k] = 0; links[k] = 0; continue; }
    let m = links[k]!;
    for (let d = 0; d < 8; d += 1) if (m & (1 << d) && !keep[(j + DZ8[d]!) * width + i + DX8[d]!]) m &= ~(1 << d);
    links[k] = m;
  }
}

function grid(width: number, depth: number, moveClass: MoveClass, cost: Uint8Array, links: Uint8Array, level: Int16Array, version: number): PathGrid {
  return {
    width, depth, moveClass, cost, links, level, version,
    passable: (i, j) => i >= 0 && j >= 0 && i < width && j < depth && cost[j * width + i]! > 0,
    linked: (i, j, d) => i >= 0 && j >= 0 && i < width && j < depth && (links[j * width + i]! & (1 << d)) !== 0,
  };
}

/** A path grid from raw arrays (a sim that keeps its own, a test). */
export function pathGridOf(width: number, depth: number, cost: Uint8Array, links: Uint8Array, { moveClass = "ground", level = new Int16Array(width * depth) }: { readonly moveClass?: MoveClass; readonly level?: Int16Array } = {}): PathGrid {
  return grid(width, depth, moveClass, cost, links, level, 0);
}

/** Connected regions: a label per tile (-1 blocked) and how many regions. */
export function regions(g: PathGrid): { label: Int32Array; count: number; sizes: number[] } {
  const label = new Int32Array(g.width * g.depth).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < label.length; s += 1) {
    if (label[s] !== -1 || !g.cost[s]) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const k = stack.pop()!;
      size += 1;
      const i = k % g.width, j = (k - i) / g.width;
      const m = g.links[k]!;
      for (let d = 0; d < 8; d += 2) {
        if (!(m & (1 << d))) continue;
        const nk = (j + DZ8[d]!) * g.width + i + DX8[d]!;
        if (label[nk] === -1) { label[nk] = id; stack.push(nk); }
      }
    }
    sizes.push(size);
  }
  return { label, count: sizes.length, sizes };
}

/**
 * Clearance: per tile, how many tiles of open ground there are round it
 * (chessboard distance to the nearest blocked tile, cliff edge or map edge;
 * 0 blocked, 1 beside a wall). A choke's width is about 2 x clearance - 1.
 */
export function clearance(g: PathGrid): Uint8Array {
  const { width, depth } = g;
  const INF = 255;
  const c = new Uint8Array(width * depth);
  for (let j = 0; j < depth; j += 1) for (let i = 0; i < width; i += 1) {
    const k = j * width + i;
    if (!g.cost[k]) { c[k] = 0; continue; }
    // (Beside a wall: an orthogonal step that isn't allowed -- a cliff, water, the map's edge.)
    c[k] = (g.links[k]! & 0x55) === 0x55 ? INF : 1;
  }
  // Two passes of a chessboard distance transform.
  for (let j = 0; j < depth; j += 1) for (let i = 0; i < width; i += 1) {
    const k = j * width + i;
    if (c[k]! <= 1) continue;
    let v = c[k]!;
    if (i > 0) v = Math.min(v, c[k - 1]! + 1);
    if (j > 0) { v = Math.min(v, c[k - width]! + 1); if (i > 0) v = Math.min(v, c[k - width - 1]! + 1); if (i < width - 1) v = Math.min(v, c[k - width + 1]! + 1); }
    c[k] = v;
  }
  for (let j = depth - 1; j >= 0; j -= 1) for (let i = width - 1; i >= 0; i -= 1) {
    const k = j * width + i;
    if (c[k]! <= 1) continue;
    let v = c[k]!;
    if (i < width - 1) v = Math.min(v, c[k + 1]! + 1);
    if (j < depth - 1) { v = Math.min(v, c[k + width]! + 1); if (i < width - 1) v = Math.min(v, c[k + width + 1]! + 1); if (i > 0) v = Math.min(v, c[k + width - 1]! + 1); }
    c[k] = v;
  }
  return c;
}
