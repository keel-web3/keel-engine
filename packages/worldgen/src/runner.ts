// RUNNER: a dungeon laid out as a run -- a corridor that goes on and on,
// turning left and right at junctions, widening now and then into a hall,
// with side passages that go nowhere (the turn you didn't take) and a way
// on at the end. Made for games that follow a path through a dungeon at
// speed (a runner, a rail shooter, a chase) and drawn by the same dressing,
// scene and renderer as any other dungeon: the result is a Dungeon.
//
// Beside the cells it gives the ROUTE: the path's centre line as straight
// legs, each with its heading and what waits at its end (a turn left or
// right, and whether the other way is open too -- a fork -- or a wall).
// The route walks through the grid without ever touching itself, a margin
// of wall kept between any two legs, so a camera following it never sees
// the next leg through the last one's wall.
//
//   const { dungeon, route } = generateRunner("seed", { legs: 14 });
//   const S = dressDungeon(dungeon, "crypt", { seed });   // then buildDungeonScene(S), the renderer...

import { CELL } from "./dungeon.ts";
import type { Dungeon, Room } from "./dungeon.ts";
import { rng, seedOf } from "./noise.ts";

/** A heading on the grid: 0 +x, 1 +z, 2 -x, 3 -z (a quarter turn left adds 1). */
export type Heading = 0 | 1 | 2 | 3;
const STEP: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export interface RunnerLeg {
  /** Where it starts and ends, in cells (the corridor's centre line). */
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly heading: Heading;
  readonly length: number;
  /** What waits at its end: the way on turns "left" or "right" -- or "end" (the last leg). */
  readonly turn: "left" | "right" | "end";
  /** At the end: the other way is open too (a passage that goes nowhere; take the wrong one and you're stopped). */
  readonly fork: boolean;
  /** The hall it runs through, if it widens (an index into the dungeon's rooms), or -1. */
  readonly hall: number;
  /** Where along the leg (cells from its start) the hall begins and ends, and how far it reaches out either side. */
  readonly hallSpan: readonly [number, number];
  readonly hallReach: number;
}

export interface RunnerParams {
  /** How many legs (default 12). */
  readonly legs?: number;
  /** Leg lengths in cells (default 7..14). */
  readonly length?: readonly [number, number];
  /** The corridor's width in cells (default 2). */
  readonly width?: number;
  /** Chance a leg widens into a hall (default 0.3). */
  readonly halls?: number;
  /** How far a hall reaches out either side of the corridor, in cells (default 2; the legs keep their distance to fit it). */
  readonly hallReach?: number;
  /** Chance a turn is a fork -- the other way open too (default 0.35). */
  readonly forks?: number;
  /** The grid (default: 120 x 120 cells, more for big halls). */
  readonly size?: readonly [number, number];
}

export interface Runner {
  readonly dungeon: Dungeon;
  readonly legs: readonly RunnerLeg[];
  readonly width: number;
}

/** A run through a dungeon, from a seed. The same seed and params, the same run. */
export function generateRunner(seed: string, params: RunnerParams = {}): Runner {
  const legsWanted = params.legs ?? 12;
  const [lenLo, lenHi] = params.length ?? [7, 14];
  const width = Math.max(1, params.width ?? 2);
  const [w, d] = params.size ?? [120 + 12 * Math.max(0, (params.hallReach ?? 2) - 2), 120 + 12 * Math.max(0, (params.hallReach ?? 2) - 2)];
  const R = rng(seedOf(seed, "runner"));
  const cells = new Uint8Array(w * d); // (CELL.WALL is 0)
  const claim = new Uint8Array(w * d); // (cells a leg -- with its margin -- has taken: the route never comes back near itself)
  const rooms: Room[] = [];
  const legs: RunnerLeg[] = [];
  const inside = (i: number, j: number, m = 2): boolean => i >= m && j >= m && i < w - m && j < d - m;
  const reach = Math.max(1, params.hallReach ?? 2);
  const margin = width + reach + 1;

  // A leg's box of cells (its corridor, and around it the margin that keeps other legs away).
  const box = (from: readonly [number, number], h: Heading, len: number, pad: number, fn: (i: number, j: number) => boolean | void): boolean => {
    const [sx, sz] = STEP[h]!;
    const [px, pz] = STEP[((h + 1) & 3) as Heading]!;
    for (let t = 0; t <= len; t += 1) {
      for (let s = -pad; s < width + pad; s += 1) {
        const i = from[0] + sx * t + px * s;
        const j = from[1] + sz * t + pz * s;
        if (fn(i, j) === false) return false;
      }
    }
    return true;
  };
  const free = (from: readonly [number, number], h: Heading, len: number): boolean => {
    // (Skip its first cells -- the corner and the last leg's margin round it -- they're shared by right.)
    const skip = margin + 1;
    const [sx, sz] = STEP[h]!;
    const start: [number, number] = [from[0] + sx * skip, from[1] + sz * skip];
    return box(start, h, Math.max(0, len - skip), margin - width, (i, j) => inside(i, j) && !claim[j * w + i]);
  };
  const carve = (from: readonly [number, number], h: Heading, len: number): void => {
    box(from, h, len, 0, (i, j) => { if (inside(i, j, 1)) cells[j * w + i] = CELL.CORRIDOR; });
  };
  const stake = (from: readonly [number, number], h: Heading, len: number): void => {
    box(from, h, len, margin - width, (i, j) => { if (inside(i, j, 0)) claim[j * w + i] = 1; });
  };

  let at: [number, number] = [4, Math.floor(d / 2) - (width >> 1)];
  let h: Heading = 0;
  let lastTurn: "left" | "right" | null = null;
  const start: [number, number] = [at[0] + 1, at[1]];
  for (let n = 0; n < legsWanted; n += 1) {
    // A length that fits, trying shorter ones before giving up.
    let len = R.int(lenLo, lenHi);
    while (len >= lenLo && !free(at, h, len)) len -= 1;
    if (len < lenLo) break;
    carve(at, h, len);
    const [sx, sz] = STEP[h]!;
    const to: [number, number] = [at[0] + sx * len, at[1] + sz * len];
    // A hall: the corridor widens round the middle of the leg (only where the margin allows).
    let hall = -1;
    let hallSpan: [number, number] = [0, 0];
    if (R.chance(params.halls ?? 0.3) && len >= 8) {
      const [px, pz] = STEP[((h + 1) & 3) as Heading]!;
      const mid = Math.floor(len / 2);
      const half = Math.min(Math.max(3, reach + 1), Math.floor(len / 2) - 1);
      const grow = reach;
      let i0 = w, j0 = d, i1 = 0, j1 = 0;
      for (let t = mid - half; t <= mid + half; t += 1) for (let s = -grow; s < width + grow; s += 1) {
        const i = at[0] + sx * t + px * s;
        const j = at[1] + sz * t + pz * s;
        if (!inside(i, j, 1)) continue;
        cells[j * w + i] = CELL.FLOOR;
        i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j);
      }
      if (i1 >= i0) { hall = rooms.length; hallSpan = [mid - half, mid + half]; rooms.push({ id: rooms.length, x: i0, y: j0, w: i1 - i0 + 1, h: j1 - j0 + 1, kind: "room", template: null }); }
    }
    stake(at, h, len);
    // The turn: whichever way has room (the seed's choice when both do).
    const left = ((h + 1) & 3) as Heading;
    const right = ((h + 3) & 3) as Heading;
    // (Turning, the new leg covers the corner square: a left turn starts at the leg's end, a right one across the corridor.)
    const cornerFor = (nh: Heading): [number, number] => {
      if (nh === left) return [to[0], to[1]];
      const [px, pz] = STEP[left]!;
      return [to[0] - sx * (width - 1) + px * (width - 1), to[1] - sz * (width - 1) + pz * (width - 1)];
    };
    // (How far each way stays open -- a leg there and room to go on after it: the roomier way keeps the run going.)
    const reachOf = (nh: Heading): number => { let l = lenLo; if (!free(cornerFor(nh), nh, l)) return 0; while (l < lenHi * 3 && free(cornerFor(nh), nh, l + 2)) l += 2; return l; };
    const roomL = reachOf(left);
    const roomR = reachOf(right);
    const canL = roomL > 0;
    const canR = roomR > 0;
    const last = n === legsWanted - 1 || (!canL && !canR);
    // (Both ways open: the one with room to go on, mostly the other way from the last turn when they're alike -- a zigzag, not a spiral.)
    const lean: number = lastTurn === "left" ? 0.25 : lastTurn === "right" ? 0.75 : 0.5;
    const pickL: boolean = roomL > roomR * 1.5 ? true : roomR > roomL * 1.5 ? false : R.chance(lean);
    const turn: "left" | "right" | "end" = last ? "end" : canL && canR ? (pickL ? "left" : "right") : canL ? "left" : "right";
    if (turn !== "end") lastTurn = turn;
    // A fork: the other way open for a few cells, then a wall (or rubble) -- the turn not taken.
    const fork = turn !== "end" && (turn === "left" ? canR : canL) && R.chance(params.forks ?? 0.35);
    if (fork) {
      const other: Heading = turn === "left" ? right : left;
      const stub = Math.min(4, lenLo - 2);
      carve(cornerFor(other), other, stub);
      stake(cornerFor(other), other, stub);
    }
    legs.push({ from: [at[0], at[1]], to, heading: h, length: len, turn, fork, hall, hallSpan, hallReach: hall >= 0 ? reach : 0 });
    if (turn === "end") break;
    h = turn === "left" ? left : right;
    at = cornerFor(h);
  }
  const lastLeg = legs[legs.length - 1]!;
  const exit: [number, number] = [lastLeg.to[0], lastLeg.to[1]];
  // (The first and last cells are floor: the dressing puts its stairs up and down there.)
  cells[start[1] * w + start[0]] = CELL.FLOOR;
  cells[exit[1] * w + exit[0]] = CELL.FLOOR;
  const dungeon: Dungeon = {
    w, d, cells, rooms, start, exit, key: null, boss: null, props: [], lights: [], algorithm: "bsp", seed,
    stats: { legs: legs.length, forks: legs.filter((l) => l.fork).length, halls: rooms.length },
  };
  return { dungeon, legs, width };
}
