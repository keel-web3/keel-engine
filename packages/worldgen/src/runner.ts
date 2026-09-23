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
  /**
   * What waits at its end: the way on turns "left" or "right" -- or "end" (the last leg) -- or "split": a room where
   * the way parts round a solid block, left and right (`split`), and meets again in a second room, going on the
   * same way it came (the next leg).
   */
  readonly turn: "left" | "right" | "end" | "split";
  /** At a split: the two ways round (each three legs, from the first room to the second). */
  readonly split?: { readonly left: readonly RunnerLeg[]; readonly right: readonly RunnerLeg[] };
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
  /** Chance a leg ends in a split: a room where the way parts, left and right, round a block, and meets again (default 0). */
  readonly loops?: number;
  /** A split's size in cells: how far out each way goes, how long the block is (default [5, 12..18]). */
  readonly loop?: { readonly out?: number; readonly length?: readonly [number, number] };
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

  // Where a leg from `from` heading `hd`, `len` long, hands on to one turning `nh` (the corner square's convention).
  const cornerOf = (from: readonly [number, number], hd: Heading, len: number, nh: Heading): [number, number] => {
    const [sx, sz] = STEP[hd]!;
    const to: [number, number] = [from[0] + sx * len, from[1] + sz * len];
    if (nh === (((hd + 1) & 3) as Heading)) return to;
    const [px, pz] = STEP[((hd + 1) & 3) as Heading]!;
    return [to[0] - sx * (width - 1) + px * (width - 1), to[1] - sz * (width - 1) + pz * (width - 1)];
  };
  const leftOf = (hd: Heading): Heading => ((hd + 1) & 3) as Heading;
  const rightOf = (hd: Heading): Heading => ((hd + 3) & 3) as Heading;
  /** The cells a leg covers. */
  const cellsOf = (from: readonly [number, number], hd: Heading, len: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    box(from, hd, len, 0, (i, j) => { out.push([i, j]); });
    return out;
  };
  const OUT = Math.max(width + 3, params.loop?.out ?? 5);
  /** A split at the end of a leg: both ways round, the rooms, and where the way goes on -- or null if it doesn't fit. */
  function split(from: readonly [number, number], hd: Heading, len: number, b: number): { split: { left: RunnerLeg[]; right: RunnerLeg[] }; on: [number, number] } | null {
    const L = leftOf(hd), Rt = rightOf(hd);
    const way = (first: Heading, second: Heading): { legs: RunnerLeg[]; on: [number, number]; cells: Array<[number, number]>; ends: Array<Array<[number, number]>> } => {
      // (Out sideways, on along the way, back in -- three legs, turning so they come back to the middle.)
      const a0 = cornerOf(from, hd, len, first);
      const b0 = cornerOf(a0, first, OUT, hd);
      const c0 = cornerOf(b0, hd, b, second);
      const on = cornerOf(c0, second, OUT, hd);
      const mk = (f: readonly [number, number], h2: Heading, l: number, turn: "left" | "right"): RunnerLeg => {
        const [sx, sz] = STEP[h2]!;
        return { from: [f[0], f[1]], to: [f[0] + sx * l, f[1] + sz * l], heading: h2, length: l, turn, fork: false, hall: -1, hallSpan: [0, 0], hallReach: 0 };
      };
      const toH = (x: Heading): "left" | "right" => (x === leftOf(first) ? "left" : "right");
      const legsOut = [mk(a0, first, OUT, first === L ? "right" : "left"), mk(b0, hd, b, second === Rt ? "right" : "left"), mk(c0, second, OUT, toH(hd))];
      const ca = cellsOf(a0, first, OUT), cb = cellsOf(b0, hd, b), cc = cellsOf(c0, second, OUT);
      return { legs: legsOut, on, cells: [...ca, ...cb, ...cc], ends: [ca, cc] };
    };
    const lw = way(L, Rt), rw = way(Rt, L);
    if (lw.on[0] !== rw.on[0] || lw.on[1] !== rw.on[1]) return null;
    // (The rooms: the ways' first and last legs, and all between them -- open floor.)
    const roomOf = (a: Array<[number, number]>, c: Array<[number, number]>): [number, number, number, number] => {
      let i0 = w, j0 = d, i1 = -1, j1 = -1;
      for (const [i, j] of [...a, ...c]) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
      return [i0, j0, i1, j1];
    };
    const r1 = roomOf(lw.ends[0]!, rw.ends[0]!), r2 = roomOf(lw.ends[1]!, rw.ends[1]!);
    // (All of it, with its margin, must be free -- but for the leg it ends, which is already there.)
    const all = [...lw.cells, ...rw.cells];
    let i0 = Math.min(r1[0], r2[0]), j0 = Math.min(r1[1], r2[1]), i1 = Math.max(r1[2], r2[2]), j1 = Math.max(r1[3], r2[3]);
    for (const [i, j] of all) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
    const pad = margin - width;
    const own = new Set<number>();
    box(from, hd, len, pad, (i, j) => { own.add(j * w + i); });
    for (let j = j0 - pad; j <= j1 + pad; j += 1) for (let i = i0 - pad; i <= i1 + pad; i += 1) {
      if (!inside(i, j)) return null;
      if (claim[j * w + i] && !own.has(j * w + i)) return null;
    }
    // (And the way must go on from there.)
    if (!free(lw.on, hd, lenLo)) return null;
    for (const [i, j] of all) cells[j * w + i] = CELL.CORRIDOR;
    for (const [a0, b0, a1, b1] of [r1, r2]) {
      for (let j = b0; j <= b1; j += 1) for (let i = a0; i <= a1; i += 1) cells[j * w + i] = CELL.FLOOR;
      rooms.push({ id: rooms.length, x: a0, y: b0, w: a1 - a0 + 1, h: b1 - b0 + 1, kind: "room", template: null });
    }
    for (let j = j0 - pad; j <= j1 + pad; j += 1) for (let i = i0 - pad; i <= i1 + pad; i += 1) claim[j * w + i] = 1;
    return { split: { left: lw.legs, right: rw.legs }, on: lw.on };
  }

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
    // A split: the way parts round a block and meets again (only where it all fits, and never the last legs).
    if (n < legsWanted - 2 && R.chance(params.loops ?? 0)) {
      const made = split(at, h, len, R.int(params.loop?.length?.[0] ?? 12, params.loop?.length?.[1] ?? 18));
      if (made) {
        legs.push({ from: [at[0], at[1]], to, heading: h, length: len, turn: "split", fork: false, hall, hallSpan, hallReach: hall >= 0 ? reach : 0, split: made.split });
        at = made.on;
        lastTurn = null;
        continue;
      }
    }
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
    stats: { legs: legs.length, forks: legs.filter((l) => l.fork).length, halls: rooms.length, splits: legs.filter((l) => l.split).length },
  };
  return { dungeon, legs, width };
}
