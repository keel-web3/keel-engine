// Cliffs and ramps: where the ground steps, and where it slopes.
//
// Every tile's top has four CORNERS, each at a level (in steps): a flat tile
// has its height at all four; a ramp tile at height h rising toward dir d has
// h at its foot edge and h + 1 at the edge toward d (a wedge between the
// levels). Two tiles side by side meet along an EDGE; comparing the two
// tiles' corner levels along it says everything:
//
//   equal at both ends        they join: walk across (flat-flat, a ramp's foot
//                             or top on the level it meets, two ramps side by side)
//   one higher                a CLIFF face stands there, from the lower edge up
//                             to the higher (a ramp's side over flat ground is a
//                             trapezoid face)
//
// So cliffs, ramp sides, walkability and the ground's faces all come from
// one rule (edgeLevels), and nothing is special-cased.

import { DX4, DZ4, FLAG, opposite4 } from "./types.ts";
import type { Terrain } from "./grid.ts";

/** A tile's corner levels (steps): [x0z0, x1z0, x0z1, x1z1]. */
export function cornerLevels(t: Terrain, i: number, j: number): [number, number, number, number] {
  const k = t.index(i, j);
  const h = t.height[k]!;
  if (!(t.flags[k]! & FLAG.RAMP)) return [h, h, h, h];
  switch (t.dir[k]) {
    case 0: return [h, h, h + 1, h + 1]; // (rising toward +z)
    case 1: return [h, h + 1, h, h + 1]; // (+x)
    case 2: return [h + 1, h + 1, h, h]; // (-z)
    default: return [h + 1, h, h + 1, h]; // (-x)
  }
}

// Which corners lie on each dir4 edge, in world order (lower x or z first).
const EDGE_CORNERS: readonly (readonly [number, number])[] = [[2, 3], [1, 3], [0, 1], [0, 2]];

/** The levels at the two ends of a tile's edge toward dir4 `d`, in world order (x or z increasing). */
export function edgeLevels(t: Terrain, i: number, j: number, d: number): [number, number] {
  const c = cornerLevels(t, i, j);
  const [a, b] = EDGE_CORNERS[d]!;
  return [c[a]!, c[b]!];
}

/** Do two neighbouring tiles' tops meet along their shared edge (same level at both ends)? */
export function meets(t: Terrain, i: number, j: number, d: number): boolean {
  const ni = i + DX4[d]!, nj = j + DZ4[d]!;
  if (!t.inside(ni, nj)) return false;
  const a = edgeLevels(t, i, j, d), b = edgeLevels(t, ni, nj, opposite4(d));
  return a[0] === b[0] && a[1] === b[1];
}

/** A cliff face: on tile (i, j)'s edge toward `dir`, from the neighbour's edge levels up to this tile's. */
export interface CliffFace {
  readonly i: number;
  readonly j: number;
  readonly dir: number;
  /** The lower side's edge levels and this tile's, both in world order. */
  readonly low: readonly [number, number];
  readonly high: readonly [number, number];
  /** The biggest drop along it, in steps. */
  readonly drop: number;
}

/** The face on tile (i, j)'s edge toward `d`, if it stands higher there than its neighbour (off the map: down to `floor`). */
export function cliffFace(t: Terrain, i: number, j: number, d: number, floor = -Infinity): CliffFace | null {
  const ni = i + DX4[d]!, nj = j + DZ4[d]!;
  const high = edgeLevels(t, i, j, d);
  let low: [number, number];
  if (t.inside(ni, nj)) low = edgeLevels(t, ni, nj, opposite4(d));
  else if (floor === -Infinity) return null;
  else low = [floor, floor];
  if (high[0] < low[0] || high[1] < low[1]) return null; // (the neighbour's face, not this one's; or a crossing: never, levels are whole steps and ramps rise one)
  const drop = Math.max(high[0] - low[0], high[1] - low[1]);
  return drop > 0 ? { i, j, dir: d, low, high, drop } : null;
}

/** Every cliff face on the map (or in a tile rectangle [i0, j0, i1, j1)). */
export function cliffFaces(t: Terrain, rect: readonly [number, number, number, number] = [0, 0, t.width, t.depth]): CliffFace[] {
  const out: CliffFace[] = [];
  for (let j = rect[1]; j < rect[3]; j += 1) for (let i = rect[0]; i < rect[2]; i += 1) for (let d = 0; d < 4; d += 1) {
    const f = cliffFace(t, i, j, d);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Can tile (i, j) become a ramp rising toward `d`? Its own height h, the tile
 * toward d one step up (its top meets the ramp's top edge), the tile behind at
 * h (or a ramp whose top meets the foot: a long ramp), and nothing already there.
 */
export function canRamp(t: Terrain, i: number, j: number, d: number): boolean {
  if (!t.inside(i, j)) return false;
  const k = t.index(i, j);
  if (t.flags[k]! & (FLAG.RAMP | FLAG.BRIDGE | FLAG.BLOCKED)) return false;
  if (t.waterDepth(i, j) > 0) return false;
  const h = t.height[k]!;
  const ti = i + DX4[d]!, tj = j + DZ4[d]!;
  const bi = i - DX4[d]!, bj = j - DZ4[d]!;
  if (!t.inside(ti, tj) || !t.inside(bi, bj)) return false;
  const top = edgeLevels(t, ti, tj, opposite4(d));
  const back = edgeLevels(t, bi, bj, d);
  if (t.waterDepth(ti, tj) > 0 || t.waterDepth(bi, bj) > 0) return false;
  return top[0] === h + 1 && top[1] === h + 1 && back[0] === h && back[1] === h;
}

/** A ramp site: the low tile that becomes the wedge, and the way it rises. */
export interface RampSite {
  readonly i: number;
  readonly j: number;
  readonly dir: number;
  /** The level it rises from. */
  readonly from: number;
}

/** Every tile that could become a ramp (canRamp), in tile order. */
export function rampSites(t: Terrain, rect: readonly [number, number, number, number] = [0, 0, t.width, t.depth]): RampSite[] {
  const out: RampSite[] = [];
  for (let j = rect[1]; j < rect[3]; j += 1) for (let i = rect[0]; i < rect[2]; i += 1) for (let d = 0; d < 4; d += 1) {
    if (canRamp(t, i, j, d)) out.push({ i, j, dir: d, from: t.height[t.index(i, j)]! });
  }
  return out;
}

/**
 * Lay a ramp `width` tiles wide (centred on (i, j), across its rise): every
 * tile that can take it does. Returns the tiles made ramps.
 */
export function layRamp(t: Terrain, i: number, j: number, d: number, width = 1): Array<[number, number]> {
  const made: Array<[number, number]> = [];
  const ax = DZ4[d]!, az = DX4[d]!; // (across the rise)
  const half = Math.floor((width - 1) / 2);
  t.batch(() => {
    for (let s = -half; s < width - half; s += 1) {
      const ri = i + ax * s, rj = j + az * s;
      if (canRamp(t, ri, rj, d)) { t.setRamp(ri, rj, d); made.push([ri, rj]); }
    }
  });
  return made;
}
