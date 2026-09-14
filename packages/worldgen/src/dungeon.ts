// Dungeons, Diablo-style. A dungeon is a grid of CELLS (wall, floor,
// corridor, door, locked door, water, pit) with rooms, a start, an exit, a key
// and a boss, props and lights -- made by one of several generators, then made
// FAIR by the same checks whichever made it:
//
//   bsp       binary space partition: split the rectangle until the pieces
//             are room-sized, a room in each leaf, corridors joining sibling
//             subtrees (L-shaped), a few extra for loops
//   rooms     prefab ROOM TEMPLATES stitched by a GRAPH GRAMMAR: start ->
//             rooms -> (a branch to the key) -> locked door -> boss -> exit,
//             each room attached at a free door anchor of one already placed,
//             through a short corridor; side rooms (treasure) on branches
//   cave      cellular automaton (the 4-5 rule) over hashed noise; the
//             biggest cave kept, the rest tunnelled to it
//   drunkard  walkers carving until a share of the map is open
//   wfc       wave function collapse over macro tiles (wfc.ts)
//
// Then: every open cell joined to the start (tunnels through the fewest
// walls), the exit the farthest cell, the boss room next to it behind a
// LOCKED door, the key somewhere reachable without passing that door; the
// act's THEME dresses it (floor, walls, props, torches: a light map the
// ground bakes in, darkness between the torches).
//
// checkDungeon() is the fairness gate: test/dungeon.test.ts runs it over a
// thousand seeds of every generator.

import { FLAG, WATER_NONE } from "@keel-engine/terrain";
import type { TerrainTable } from "@keel-engine/terrain";
import { createLayers } from "./map.ts";
import type { TileLayers, WorldThing } from "./map.ts";
import { hash01, rng, seedOf, value2 } from "./noise.ts";
import type { Rng } from "./noise.ts";
import { wfcDungeonCells } from "./wfc.ts";

export const CELL = Object.freeze({ WALL: 0, FLOOR: 1, CORRIDOR: 2, DOOR: 3, LOCKED: 4, WATER: 5, PIT: 6 });
export type DungeonAlgorithm = "bsp" | "rooms" | "cave" | "drunkard" | "wfc";
export const DUNGEON_ALGORITHMS: readonly DungeonAlgorithm[] = ["bsp", "rooms", "cave", "drunkard", "wfc"];

export interface Room {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  kind: "start" | "room" | "key" | "boss" | "exit" | "treasure" | "cave";
  readonly template: string | null;
}
export interface DungeonProp { readonly x: number; readonly y: number; readonly kind: string }
export interface Dungeon {
  readonly w: number;
  readonly d: number;
  readonly cells: Uint8Array;
  readonly rooms: Room[];
  start: [number, number];
  exit: [number, number];
  key: [number, number] | null;
  boss: [number, number] | null;
  readonly props: DungeonProp[];
  readonly lights: Array<[number, number, number]>;
  readonly algorithm: DungeonAlgorithm;
  readonly seed: string;
  readonly stats: Record<string, number>;
}

export interface DungeonParams {
  readonly algorithm?: DungeonAlgorithm;
  /** Rooms the rooms/bsp generators aim for. */
  readonly rooms?: number;
  /** BSP: smallest leaf (cells). */
  readonly minLeaf?: number;
  /** Extra corridors for loops (0..1 of the rooms). */
  readonly loops?: number;
  /** Cave: initial fill share and automaton steps. */
  readonly fill?: number;
  readonly steps?: number;
  /** Drunkard: share of the map to open. */
  readonly coverage?: number;
  /** A locked boss room with a key (default true). */
  readonly boss?: boolean;
  /** Room templates (rooms generator; default ROOM_TEMPLATES). */
  readonly templates?: readonly RoomTemplate[];
  /** WFC: its time budget (ms). */
  readonly budget?: number;
}

const isOpen = (c: number): boolean => c !== CELL.WALL && c !== CELL.PIT;

// ---------------------------------------------------------------- room templates

/**
 * A prefab room as text: '#' wall, '.' floor, 'D' a door anchor (on its edge),
 * 'T' torch, 'C' chest, 'P' pillar (wall), '~' water, 'o' pit, 'r' rubble,
 * 'B' the boss's spot, 'K' the key's, 'S' the start, 'E' the exit -- and the
 * furniture letters of TEMPLATE_PROPS (a floor cell with that prop on it:
 * 'b' a bookshelf, 's' a sarcophagus, 'h' a throne...).
 */
export interface RoomTemplate {
  readonly id: string;
  /** Which grammar symbols it can play. */
  readonly roles: readonly Room["kind"][];
  readonly rows: readonly string[];
  readonly weight?: number;
}

/** The furniture letters a room template may use: a floor cell with that prop (packs/dungeon's object ids) on it. */
export const TEMPLATE_PROPS: Readonly<Record<string, string>> = {
  b: "bookshelf", s: "sarcophagus", a: "altar", t: "table", w: "weapon-rack", c: "cage", u: "urn", x: "crate", y: "barrel", h: "throne",
  i: "statue", z: "brazier", l: "candelabra", q: "bones", k: "skull-pile", n: "banner", m: "chains", g: "tombstone", f: "anvil", v: "crystals",
};

/** A yaw in [-pi, pi] (the level codec's range: the same turn). */
export const wrapYaw = (yaw: number): number => { const t = Math.PI * 2; let y = ((yaw % t) + t) % t; if (y > Math.PI) y -= t; return y; };

export const ROOM_TEMPLATES: readonly RoomTemplate[] = [
  { id: "stairs-up", roles: ["start"], rows: ["###D###", "#T...T#", "D..S..D", "#.....#", "###D###"] },
  { id: "chamber", roles: ["room", "treasure", "key"], weight: 3, rows: ["####D####", "#T.....T#", "#.......#", "D...K...D", "#.......#", "#.r...r.#", "####D####"] },
  { id: "hall-pillars", roles: ["room"], weight: 2, rows: ["#####D#####", "#T.......T#", "#..P...P..#", "D.........D", "#..P...P..#", "#.........#", "#####D#####"] },
  { id: "cross", roles: ["room", "key"], weight: 2, rows: ["###D###", "###.###", "#T...T#", "D..K..D", "#.....#", "###.###", "###D###"] },
  { id: "pool", roles: ["room", "treasure"], weight: 1, rows: ["####D####", "#.......#", "#..~~~..#", "D..~~~..D", "#..~~~..#", "#T.....T#", "####D####"] },
  { id: "vault", roles: ["treasure", "key"], weight: 1, rows: ["##D##", "#...#", "D.C.D", "#.K.#", "#####"] },
  { id: "crypt-row", roles: ["room"], weight: 2, rows: ["###D#####", "#.......#", "#r.r.r..D", "#.......#", "D.r.r.r.#", "#T.....T#", "#####D###"] },
  { id: "arena", roles: ["boss"], rows: ["######D######", "#T.........T#", "#...P...P...#", "#...........#", "D.....B.....D", "#...........#", "#...P...P...#", "#T.........T#", "######D######"] },
  { id: "pit-room", roles: ["room"], weight: 1, rows: ["####D####", "#T.....T#", "#..ooo..#", "D..ooo..D", "#.......#", "####D####"] },
  { id: "stairs-down", roles: ["exit"], rows: ["###D###", "#T...T#", "D..E..D", "#.....#", "###D###"] },
];

// ---------------------------------------------------------------- the generators

const blank = (w: number, d: number): Uint8Array => new Uint8Array(w * d);
const carveRect = (c: Uint8Array, w: number, x: number, y: number, rw: number, rh: number, v: number = CELL.FLOOR): void => {
  for (let j = y; j < y + rh; j += 1) for (let i = x; i < x + rw; i += 1) c[j * w + i] = v;
};
const carveL = (c: Uint8Array, w: number, ax: number, ay: number, bx: number, by: number, R: Rng): void => {
  const horizFirst = R.chance(0.5);
  const put = (i: number, j: number): void => { if (c[j * w + i] === CELL.WALL) c[j * w + i] = CELL.CORRIDOR; };
  if (horizFirst) { for (let i = Math.min(ax, bx); i <= Math.max(ax, bx); i += 1) put(i, ay); for (let j = Math.min(ay, by); j <= Math.max(ay, by); j += 1) put(bx, j); }
  else { for (let j = Math.min(ay, by); j <= Math.max(ay, by); j += 1) put(ax, j); for (let i = Math.min(ax, bx); i <= Math.max(ax, bx); i += 1) put(i, by); }
};

function bsp(w: number, d: number, R: Rng, P: DungeonParams): { cells: Uint8Array; rooms: Room[] } {
  const cells = blank(w, d);
  const min = P.minLeaf ?? 9;
  const rooms: Room[] = [];
  interface Node { x: number; y: number; w: number; h: number; a?: Node; b?: Node; room?: Room }
  const split = (n: Node, depth: number): void => {
    const canH = n.h >= min * 2, canV = n.w >= min * 2;
    if ((!canH && !canV) || depth > 7) {
      const rw = R.int(Math.max(4, Math.floor(n.w * 0.45)), Math.max(4, n.w - 2)), rh = R.int(Math.max(4, Math.floor(n.h * 0.45)), Math.max(4, n.h - 2));
      const rx = n.x + R.int(1, Math.max(1, n.w - rw - 1)), ry = n.y + R.int(1, Math.max(1, n.h - rh - 1));
      const room: Room = { id: rooms.length, x: rx, y: ry, w: Math.min(rw, n.x + n.w - 1 - rx), h: Math.min(rh, n.y + n.h - 1 - ry), kind: "room", template: null };
      if (room.w >= 3 && room.h >= 3) { rooms.push(room); carveRect(cells, w, room.x, room.y, room.w, room.h); n.room = room; }
      return;
    }
    const vertical = canV && (!canH || n.w > n.h * 1.2 || (n.w * 1.2 >= n.h && R.chance(0.5)));
    if (vertical) { const at = R.int(min, n.w - min); n.a = { x: n.x, y: n.y, w: at, h: n.h }; n.b = { x: n.x + at, y: n.y, w: n.w - at, h: n.h }; }
    else { const at = R.int(min, n.h - min); n.a = { x: n.x, y: n.y, w: n.w, h: at }; n.b = { x: n.x, y: n.y + at, w: n.w, h: n.h - at }; }
    split(n.a, depth + 1); split(n.b, depth + 1);
  };
  const root: Node = { x: 1, y: 1, w: w - 2, h: d - 2 };
  split(root, 0);
  const roomsOf = (n: Node): Room[] => (n.room ? [n.room] : [...(n.a ? roomsOf(n.a) : []), ...(n.b ? roomsOf(n.b) : [])]);
  const centre = (r: Room): [number, number] => [r.x + (r.w >> 1), r.y + (r.h >> 1)];
  const join = (n: Node): void => {
    if (!n.a || !n.b) return;
    join(n.a); join(n.b);
    const A = roomsOf(n.a), B = roomsOf(n.b);
    if (!A.length || !B.length) return;
    // (The closest pair across the split.)
    let best: [Room, Room] = [A[0]!, B[0]!], bd = Infinity;
    for (const a of A) for (const b of B) { const [ax, ay] = centre(a), [bx, by] = centre(b); const dd = Math.abs(ax - bx) + Math.abs(ay - by); if (dd < bd) { bd = dd; best = [a, b]; } }
    const [ax, ay] = centre(best[0]), [bx, by] = centre(best[1]);
    carveL(cells, w, ax, ay, bx, by, R);
  };
  join(root);
  // Loops: a few extra corridors between near rooms.
  const extra = Math.round(rooms.length * (P.loops ?? 0.25));
  for (let n = 0; n < extra && rooms.length > 2; n += 1) {
    const a = R.pick(rooms);
    const near = rooms.filter((r) => r !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[R.int(0, 1)]!;
    const [ax, ay] = centre(a), [bx, by] = centre(near);
    carveL(cells, w, ax, ay, bx, by, R);
  }
  return { cells, rooms };
}

function cave(w: number, d: number, R: Rng, P: DungeonParams, s: number): { cells: Uint8Array; rooms: Room[] } {
  let cur = blank(w, d), next = blank(w, d);
  const fill = P.fill ?? 0.45;
  for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
    const edge = i === 0 || j === 0 || i === w - 1 || j === d - 1;
    // (1 = open. A low-frequency bias makes big chambers and narrow necks.)
    cur[j * w + i] = !edge && hash01(i, j, s) > fill + (value2(i * 0.08, j * 0.08, s + 1) - 0.5) * 0.18 ? 1 : 0;
  }
  for (let step = 0; step < (P.steps ?? 5); step += 1) {
    for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
      const k = j * w + i;
      if (i === 0 || j === 0 || i === w - 1 || j === d - 1) { next[k] = 0; continue; }
      let walls = 0;
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) if ((di || dj) && !cur[(j + dj) * w + i + di]) walls += 1;
      next[k] = cur[k] ? (walls >= 5 ? 0 : 1) : (walls >= 4 ? 0 : 1) ;
    }
    [cur, next] = [next, cur];
  }
  const cells = blank(w, d);
  for (let k = 0; k < w * d; k += 1) cells[k] = cur[k] ? CELL.FLOOR : CELL.WALL;
  // Pools in the lowest noise, a few pits.
  for (let j = 1; j < d - 1; j += 1) for (let i = 1; i < w - 1; i += 1) {
    const k = j * w + i;
    if (cells[k] !== CELL.FLOOR) continue;
    if (value2(i * 0.12, j * 0.12, s + 5) < 0.16) cells[k] = CELL.WATER;
  }
  void R;
  return { cells, rooms: [] };
}

function drunkard(w: number, d: number, R: Rng, P: DungeonParams): { cells: Uint8Array; rooms: Room[] } {
  const cells = blank(w, d);
  const goal = Math.floor((w - 2) * (d - 2) * (P.coverage ?? 0.36));
  let open = 0;
  const walkers: Array<[number, number, number]> = [[w >> 1, d >> 1, R.int(0, 3)]];
  const DX = [0, 1, 0, -1], DY = [1, 0, -1, 0];
  let guard = 0;
  while (open < goal && guard++ < w * d * 40) {
    for (const wk of walkers) {
      const k = wk[1] * w + wk[0];
      if (cells[k] === CELL.WALL) { cells[k] = CELL.FLOOR; open += 1; }
      // (Now and then a wide stretch: a 2 x 2 blot.)
      if (R.chance(0.08)) for (const [a, b] of [[1, 0], [0, 1], [1, 1]] as const) { const q = (wk[1] + b) * w + wk[0] + a; if (wk[0] + a < w - 1 && wk[1] + b < d - 1 && cells[q] === CELL.WALL) { cells[q] = CELL.FLOOR; open += 1; } }
      if (R.chance(0.35)) wk[2] = R.int(0, 3);
      const nx = wk[0] + DX[wk[2]]!, ny = wk[1] + DY[wk[2]]!;
      if (nx > 1 && ny > 1 && nx < w - 2 && ny < d - 2) { wk[0] = nx; wk[1] = ny; } else wk[2] = (wk[2] + 2) & 3;
    }
    if (walkers.length < 5 && R.chance(0.02)) { const src = R.pick(walkers); walkers.push([src[0], src[1], R.int(0, 3)]); }
  }
  return { cells, rooms: [] };
}

// Stitched rooms: templates attached at door anchors through short corridors, by a grammar.
function stitched(w: number, d: number, R: Rng, P: DungeonParams): { cells: Uint8Array; rooms: Room[]; props: DungeonProp[]; lights: Array<[number, number, number]>; marks: Record<string, [number, number]>; locked: Array<[number, number]> } | null {
  const cells = blank(w, d);
  const used = new Uint8Array(w * d); // (cells a room or corridor occupies, walls included)
  const templates = P.templates ?? ROOM_TEMPLATES;
  const rooms: Room[] = [];
  const props: DungeonProp[] = [];
  const lights: Array<[number, number, number]> = [];
  const marks: Record<string, [number, number]> = {};
  const anchors: Array<{ room: number; x: number; y: number; dir: number; used: boolean }> = [];
  const locked: Array<[number, number]> = [];
  const DX = [0, 1, 0, -1], DY = [1, 0, -1, 0];
  // (A door anchor's outward direction: which edge it sits on.)
  const dirOf = (t: RoomTemplate, x: number, y: number): number => (y === t.rows.length - 1 ? 0 : x === t.rows[0]!.length - 1 ? 1 : y === 0 ? 2 : 3);
  const fits = (t: RoomTemplate, ox: number, oy: number): boolean => {
    const tw = t.rows[0]!.length, th = t.rows.length;
    if (ox < 1 || oy < 1 || ox + tw > w - 1 || oy + th > d - 1) return false;
    for (let y = -1; y <= th; y += 1) for (let x = -1; x <= tw; x += 1) if (used[(oy + y) * w + ox + x]) return false;
    return true;
  };
  const place = (t: RoomTemplate, ox: number, oy: number, kind: Room["kind"], entry: [number, number] | null): number => {
    const tw = t.rows[0]!.length, th = t.rows.length;
    const id = rooms.length;
    rooms.push({ id, x: ox, y: oy, w: tw, h: th, kind, template: t.id });
    for (let y = 0; y < th; y += 1) for (let x = 0; x < tw; x += 1) {
      const ch = t.rows[y]![x]!, k = (oy + y) * w + ox + x;
      used[k] = 1;
      if (ch === "#" || ch === "P") continue;
      if (ch === "D") {
        if (entry && entry[0] === x && entry[1] === y) { cells[k] = CELL.DOOR; continue; }
        anchors.push({ room: id, x: ox + x, y: oy + y, dir: dirOf(t, x, y), used: false });
        continue; // (an unused anchor stays wall)
      }
      cells[k] = ch === "~" ? CELL.WATER : ch === "o" ? CELL.PIT : CELL.FLOOR;
      if (ch === "T") lights.push([ox + x, oy + y, 6]);
      if (ch === "C") props.push({ x: ox + x, y: oy + y, kind: "chest" });
      if (ch === "r") props.push({ x: ox + x, y: oy + y, kind: "rubble" });
      const furniture = TEMPLATE_PROPS[ch];
      if (furniture) props.push({ x: ox + x, y: oy + y, kind: furniture });
      if (ch === "S" || ch === "E" || ch === "K" || ch === "B") marks[ch] = [ox + x, oy + y];
    }
    return id;
  };
  const pickT = (kind: Room["kind"]): RoomTemplate => R.weighted(templates.filter((t) => t.roles.includes(kind)), (t) => t.weight ?? 1);
  // Attach a room of `kind` to one of `from`'s free anchors: returns its id, or -1.
  const attach = (from: readonly number[], kind: Room["kind"], lockIt = false): number => {
    for (let tries = 0; tries < 80; tries += 1) {
      const free = anchors.filter((a) => !a.used && from.includes(a.room));
      if (!free.length) return -1;
      const a = R.pick(free);
      const t = pickT(kind);
      const back = (a.dir + 2) & 3;
      // (The new room's anchors facing back toward a.)
      const cand: Array<[number, number]> = [];
      t.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "D" && dirOf(t, x, y) === back) cand.push([x, y]); }));
      if (!cand.length) continue;
      const [bx, by] = R.pick(cand);
      const len = R.int(2, 5);
      const ex = a.x + DX[a.dir]! * (len + 1), ey = a.y + DY[a.dir]! * (len + 1);
      const ox = ex - bx, oy = ey - by;
      // (The corridor's cells must be free, and the room must fit.)
      // (The corridor's cells and the cells either side of it must be free: two corridors side by side would join.)
      let clear = true;
      const sx0 = DY[a.dir]!, sy0 = DX[a.dir]!;
      for (let s = 1; s <= len && clear; s += 1) {
        const cx = a.x + DX[a.dir]! * s, cy = a.y + DY[a.dir]! * s;
        for (const side of [0, 1, -1]) { const qx = cx + sx0 * side, qy = cy + sy0 * side; if (qx < 1 || qy < 1 || qx >= w - 1 || qy >= d - 1 || used[qy * w + qx]) { clear = false; break; } }
      }
      if (!clear || !fits(t, ox, oy)) continue;
      a.used = true;
      cells[a.y * w + a.x] = lockIt ? CELL.LOCKED : CELL.DOOR;
      if (lockIt) locked.push([a.x, a.y]);
      for (let s = 1; s <= len; s += 1) {
        const cx = a.x + DX[a.dir]! * s, cy = a.y + DY[a.dir]! * s;
        cells[cy * w + cx] = CELL.CORRIDOR;
        for (const side of [0, 1, -1]) used[(cy + sy0 * side) * w + cx + sx0 * side] = 1;
      }
      return place(t, ox, oy, kind, [bx, by]);
    }
    return -1;
  };
  const startT = pickT("start");
  const sx = (w >> 1) - (startT.rows[0]!.length >> 1), sy = 2 + R.int(0, Math.max(0, (d >> 2)));
  place(startT, sx, sy, "start", null);
  const main: number[] = [0];
  const target = Math.max(3, P.rooms ?? 9);
  // The main path: rooms one after another.
  const mainLen = Math.max(2, Math.round(target * 0.6));
  for (let n = 0; n < mainLen; n += 1) { const id = attach([main[main.length - 1]!], "room"); if (id < 0) { const alt = attach(main, "room"); if (alt < 0) break; main.push(alt); } else main.push(id); }
  // The key: a branch off the main path's first half (reachable without the boss door).
  const keyRoom = attach(main.slice(0, Math.max(1, main.length - 1)), "key");
  // Side rooms: treasure and filler on branches.
  for (let n = rooms.length; n < target; n += 1) attach(rooms.map((r) => r.id).filter((id) => rooms[id]!.kind !== "boss"), R.chance(0.3) ? "treasure" : "room");
  // The boss behind a locked door off the last main room, and the exit off the boss.
  let boss = -1;
  if (P.boss ?? true) {
    for (let back = main.length - 1; back >= 0 && boss < 0; back -= 1) boss = attach([main[back]!], "boss", true);
  }
  const exitFrom = boss >= 0 ? [boss] : [main[main.length - 1]!];
  const exit = attach(exitFrom, "exit");
  if (exit < 0 || ((P.boss ?? true) && (boss < 0 || keyRoom < 0))) return null;
  return { cells, rooms, props, lights, marks, locked };
}

// ---------------------------------------------------------------- connecting and roles

/** Label the open regions (4-connected); returns labels (-1 walls) and the count. */
function regionsOf(cells: Uint8Array, w: number, d: number, pass: (c: number) => boolean = isOpen): { label: Int32Array; count: number; sizes: number[] } {
  const label = new Int32Array(w * d).fill(-1);
  const sizes: number[] = [];
  let count = 0;
  const stack: number[] = [];
  for (let k = 0; k < w * d; k += 1) {
    if (label[k]! >= 0 || !pass(cells[k]!)) continue;
    let size = 0;
    label[k] = count; stack.push(k);
    while (stack.length) {
      const q = stack.pop()!;
      size += 1;
      const x = q % w, y = (q - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= d) continue;
        const n = ny * w + nx;
        if (label[n]! < 0 && pass(cells[n]!)) { label[n] = count; stack.push(n); }
      }
    }
    sizes.push(size);
    count += 1;
  }
  return { label, count, sizes };
}

/** BFS distances over cells that pass (-1 unreached). */
export function distances(cells: Uint8Array, w: number, d: number, from: readonly [number, number], pass: (c: number) => boolean = isOpen): Int32Array {
  const dist = new Int32Array(w * d).fill(-1);
  const q: number[] = [from[1] * w + from[0]];
  dist[q[0]!] = 0;
  for (let h = 0; h < q.length; h += 1) {
    const k = q[h]!, x = k % w, y = (k - x) / w;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= d) continue;
      const n = ny * w + nx;
      if (dist[n]! < 0 && pass(cells[n]!)) { dist[n] = dist[k]! + 1; q.push(n); }
    }
  }
  return dist;
}

/**
 * Join every walkable region to the start's (or the biggest): a tunnel (corridor) through the fewest walls,
 * region by region, never through `forbid` cells (a sealed pocket and its door). 0-1 BFS: open cells cost 0,
 * walls 1.
 */
function connect(cells: Uint8Array, w: number, d: number, forbid: Uint8Array | null = null, home: number = -1): number {
  let tunnels = 0;
  const walk = (c: number): boolean => c !== CELL.WALL && c !== CELL.PIT && c !== CELL.WATER && c !== CELL.LOCKED;
  const cost = new Int32Array(w * d), prev = new Int32Array(w * d);
  const dq = new Int32Array(w * d * 4);
  for (let guard = 0; guard < 400; guard += 1) {
    const reg = regionsOf(cells, w, d, walk);
    if (reg.count <= 1) break;
    let main = home >= 0 && reg.label[home]! >= 0 ? reg.label[home]! : 0;
    if (home < 0) reg.sizes.forEach((sz, i) => { if (sz > reg.sizes[main]!) main = i; });
    // (Regions inside the forbidden pocket don't need joining: the pocket's door does that.)
    let others = 0;
    for (let k = 0; k < w * d; k += 1) if (reg.label[k]! >= 0 && reg.label[k] !== main && !(forbid && forbid[k])) { others += 1; break; }
    if (!others) break;
    cost.fill(1 << 30); prev.fill(-1);
    let head = w * d * 2, tail = head;
    for (let k = 0; k < w * d; k += 1) if (reg.label[k] === main) { cost[k] = 0; dq[tail++] = k; }
    let hit = -1;
    while (head < tail) {
      const k = dq[head++]!;
      if (reg.label[k]! >= 0 && reg.label[k] !== main && !(forbid && forbid[k])) { hit = k; break; }
      const x = k % w, y = (k - x) / w;
      for (let q = 0; q < 4; q += 1) {
        const nx = x + (q === 0 ? 1 : q === 1 ? -1 : 0), ny = y + (q === 2 ? 1 : q === 3 ? -1 : 0);
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= d - 1) continue;
        const n = ny * w + nx;
        if (forbid && forbid[n]) continue;
        const c = walk(cells[n]!) ? 0 : 1;
        if (cost[k]! + c < cost[n]!) { cost[n] = cost[k]! + c; prev[n] = k; if (c) dq[tail++] = n; else dq[--head] = n; }
      }
    }
    if (hit < 0) break;
    for (let k = hit; k >= 0 && reg.label[k] !== main; k = prev[k]!) if (!walk(cells[k]!)) { cells[k] = CELL.CORRIDOR; tunnels += 1; }
  }
  return tunnels;
}

/**
 * Roles for a dungeon without a grammar: the start and the exit far apart (the exit in the room farthest from
 * the start, when there are rooms); round the exit a POCKET (that room, or the cells a few steps from the exit)
 * sealed but for one LOCKED door on the way in; the boss inside, the key the farthest cell reachable without the
 * door; anything the sealing cut off tunnelled back to the start's side, never into the pocket.
 */
function assignRoles(D: Dungeon, R: Rng, boss: boolean): void {
  const { cells, w, d } = D;
  const walk = (c: number): boolean => c !== CELL.WALL && c !== CELL.PIT && c !== CELL.WATER;
  const at = (k: number): [number, number] => [k % w, Math.floor(k / w)];
  const open = (): number[] => { const o: number[] = []; for (let k = 0; k < w * d; k += 1) if (walk(cells[k]!)) o.push(k); return o; };
  let cellsOpen = open();
  if (!cellsOpen.length) { cells[(d >> 1) * w + (w >> 1)] = CELL.FLOOR; cellsOpen = open(); }
  // (The diameter by two sweeps: a far cell from anywhere, then the farthest from it.)
  let far = cellsOpen[Math.floor(R.f() * cellsOpen.length)]!;
  for (let sweep = 0; sweep < 2; sweep += 1) {
    const dist = distances(cells, w, d, at(far), walk);
    let best = far;
    for (const k of cellsOpen) if (dist[k]! > dist[best]!) best = k;
    if (sweep === 0) D.start = at(best);
    far = best;
  }
  const fromStart = distances(cells, w, d, D.start, walk);
  // The exit: in the room farthest from the start (its middle), else the farthest cell.
  const pocket = new Uint8Array(w * d);
  const room = D.rooms.length ? D.rooms.reduce((a, r) => (fromStart[(r.y + (r.h >> 1)) * w + r.x + (r.w >> 1)]! > fromStart[(a.y + (a.h >> 1)) * w + a.x + (a.w >> 1)]! ? r : a)) : null;
  if (room && fromStart[(room.y + (room.h >> 1)) * w + room.x + (room.w >> 1)]! > 8) {
    D.exit = [room.x + (room.w >> 1), room.y + (room.h >> 1)];
    for (let y = room.y; y < room.y + room.h; y += 1) for (let x = room.x; x < room.x + room.w; x += 1) if (walk(cells[y * w + x]!)) pocket[y * w + x] = 1;
    room.kind = "boss";
  } else {
    D.exit = at(far);
    const fromExit = distances(cells, w, d, D.exit, walk);
    for (let k = 0; k < w * d; k += 1) if (fromExit[k]! >= 0 && fromExit[k]! <= 5) pocket[k] = 1;
  }
  if (!boss) return;
  // The door: the first cell outside the pocket on the start's shortest way to the exit.
  let door = -1;
  for (let k = D.exit[1] * w + D.exit[0], guard = 0; k >= 0 && guard < w * d; guard += 1) {
    if (!pocket[k]) { door = k; break; }
    const x = k % w, y = (k - x) / w;
    let next = -1;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      const n = ny * w + nx;
      if (nx >= 0 && ny >= 0 && nx < w && ny < d && fromStart[n]! >= 0 && fromStart[n]! === fromStart[k]! - 1) { next = n; break; }
    }
    k = next;
  }
  if (door < 0) return;
  // Seal: every walkable cell touching the pocket from outside becomes wall, but the door.
  for (let k = 0; k < w * d; k += 1) {
    if (!pocket[k]) continue;
    const x = k % w, y = (k - x) / w;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= d) continue;
      const n = ny * w + nx;
      if (!pocket[n] && n !== door && cells[n] !== CELL.WALL) cells[n] = CELL.WALL;
    }
  }
  cells[door] = CELL.LOCKED;
  // (What the sealing cut off goes back to the start's side -- tunnels never through the pocket or its door.)
  const forbid = pocket.slice();
  forbid[door] = 1;
  D.stats["tunnels"] = (D.stats["tunnels"] ?? 0) + connect(cells, w, d, forbid, D.start[1] * w + D.start[0]);
  // The boss: the pocket cell nearest its middle, not on the exit.
  let sx = 0, sy = 0, n = 0;
  for (let k = 0; k < w * d; k += 1) if (pocket[k]) { sx += k % w; sy += Math.floor(k / w); n += 1; }
  let bk = -1, bd = Infinity;
  for (let k = 0; k < w * d; k += 1) {
    if (!pocket[k] || !walk(cells[k]!) || (k % w === D.exit[0] && Math.floor(k / w) === D.exit[1])) continue;
    const dd = Math.hypot(k % w - sx / n, Math.floor(k / w) - sy / n);
    if (dd < bd) { bd = dd; bk = k; }
  }
  D.boss = bk >= 0 ? at(bk) : D.exit;
  // The key: reachable from the start without the locked door, as far from the start as can be (a detour).
  const noDoor = distances(cells, w, d, D.start, (c) => walk(c) && c !== CELL.LOCKED);
  let key = -1;
  for (let k = 0; k < w * d; k += 1) if (noDoor[k]! > 0 && !pocket[k] && (key < 0 || noDoor[k]! > noDoor[key]!)) key = k;
  D.key = key >= 0 ? at(key) : D.start;
}

/** Torches: along room and cave walls, every few cells, where a floor cell has a wall beside it. */
function torches(D: Dungeon, R: Rng, every = 7): void {
  const { cells, w, d } = D;
  for (let j = 1; j < d - 1; j += 1) for (let i = 1; i < w - 1; i += 1) {
    const k = j * w + i;
    if (cells[k] !== CELL.FLOOR) continue;
    if (cells[k - w] !== CELL.WALL && cells[k + w] !== CELL.WALL && cells[k - 1] !== CELL.WALL && cells[k + 1] !== CELL.WALL) continue;
    if (hash01(i, j, 0x7031) < 1 / (every * 1.6) && !D.lights.some(([x, y]) => Math.abs(x - i) + Math.abs(y - j) < every)) D.lights.push([i, j, 6]);
  }
  void R;
}

/**
 * Generate a dungeon. The same seed and params, the same dungeon. Each
 * attempt is checked (checkDungeon); a failing one is rerolled on the next
 * attempt's stream (up to `tries`), and the last is returned either way.
 */
export function generateDungeon(seed: string, w: number, d: number, params: DungeonParams & { readonly tries?: number } = {}): Dungeon {
  let D: Dungeon | null = null;
  const tries = params.tries ?? 6;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    D = generateOnce(attempt ? `${seed}#${attempt}` : seed, w, d, params);
    D.stats["attempt"] = attempt;
    if (checkDungeon(D, { minPath: Math.min(12, Math.floor((w + d) / 8)) }).pass) break;
  }
  return D!;
}

function generateOnce(seed: string, w: number, d: number, params: DungeonParams): Dungeon {
  const algorithm = params.algorithm ?? "rooms";
  const s = seedOf(seed, `dungeon:${algorithm}`);
  const t0 = performance.now();
  let D: Dungeon | null = null;
  const boss = params.boss ?? true;
  if (algorithm === "rooms") {
    // (The grammar can fail to fit everything; the next attempt's stream tries again, then BSP stands in.)
    for (let attempt = 0; attempt < 12 && !D; attempt += 1) {
      const R = rng(s + attempt * 7919);
      const r = stitched(w, d, R, params);
      if (!r) continue;
      D = { w, d, cells: r.cells, rooms: r.rooms, start: r.marks["S"] ?? [r.rooms[0]!.x + 1, r.rooms[0]!.y + 1], exit: r.marks["E"] ?? [0, 0], key: r.marks["K"] ?? null, boss: r.marks["B"] ?? null, props: r.props, lights: r.lights, algorithm, seed, stats: { attempts: attempt + 1 } };
      // (Every key-capable room marks K: keep the key room's own, drop the rest.)
      const keyRoom = r.rooms.find((room) => room.kind === "key");
      if (keyRoom) { for (let y = keyRoom.y; y < keyRoom.y + keyRoom.h; y += 1) for (let x = keyRoom.x; x < keyRoom.x + keyRoom.w; x += 1) if (D.cells[y * w + x] === CELL.FLOOR && (x === keyRoom.x + (keyRoom.w >> 1))) { D.key = [x, y]; } }
      if (keyRoom && !(D.key && D.key[0] >= keyRoom.x && D.key[0] < keyRoom.x + keyRoom.w && D.key[1] >= keyRoom.y && D.key[1] < keyRoom.y + keyRoom.h)) D.key = [keyRoom.x + (keyRoom.w >> 1), keyRoom.y + (keyRoom.h >> 1)];
    }
    if (!D) return generateOnce(seed, w, d, { ...params, algorithm: "bsp" });
  } else {
    const R = rng(s);
    let base: { cells: Uint8Array; rooms: Room[] };
    if (algorithm === "bsp") base = bsp(w, d, R, params);
    else if (algorithm === "cave") base = cave(w, d, R, params, s);
    else if (algorithm === "drunkard") base = drunkard(w, d, R, params);
    else base = { cells: wfcDungeonCells(seed, w, d, params.budget ?? 250), rooms: [] };
    D = { w, d, cells: base.cells, rooms: base.rooms, start: [0, 0], exit: [0, 0], key: null, boss: null, props: [], lights: [], algorithm, seed, stats: {} };
    // (Caves and walks: the biggest region is home; a room map: the rooms all join.)
    D.stats["tunnels"] = connect(D.cells, w, d);
    assignRoles(D, R, boss);
    torches(D, R);
    // Props: rubble and bones in corners, crystals in caves.
    const P2 = rng(s + 1);
    for (let j = 1; j < d - 1; j += 1) for (let i = 1; i < w - 1; i += 1) {
      const k = j * w + i;
      if (D.cells[k] !== CELL.FLOOR) continue;
      let walls = 0;
      for (const q of [k - 1, k + 1, k - w, k + w]) if (D.cells[q] === CELL.WALL) walls += 1;
      if (walls >= 2 && P2.chance(0.12)) D.props.push({ x: i, y: j, kind: algorithm === "cave" ? (P2.chance(0.5) ? "crystal" : "mushroom") : P2.chance(0.6) ? "rubble" : "bones" });
    }
  }
  if (algorithm === "rooms") {
    D.stats["tunnels"] = 0;
    torches(D, rng(s + 2), 9);
  }
  D.stats["ms"] = performance.now() - t0;
  return D;
}

// ---------------------------------------------------------------- the fairness gate

export interface DungeonCheck {
  readonly pass: boolean;
  readonly problems: readonly string[];
  /** Walking distance start -> exit (with the key, through the door), start -> key, the open share. */
  readonly startToExit: number;
  readonly startToKey: number;
  readonly open: number;
}

/** Is a dungeon fair? Everything open reachable; the exit reachable only through the locked door (when there's a boss); the key reachable without it; the way long enough. */
export function checkDungeon(D: Dungeon, { minPath = 12 }: { readonly minPath?: number } = {}): DungeonCheck {
  const problems: string[] = [];
  const { cells, w, d } = D;
  const walk = (c: number): boolean => c !== CELL.WALL && c !== CELL.PIT && c !== CELL.WATER;
  const all = distances(cells, w, d, D.start, walk);
  let open = 0, unreached = 0;
  for (let k = 0; k < w * d; k += 1) if (walk(cells[k]!)) { open += 1; if (all[k]! < 0) unreached += 1; }
  if (unreached) problems.push(`${unreached} open cells can't be reached from the start`);
  const ek = D.exit[1] * w + D.exit[0];
  const startToExit = all[ek]!;
  if (startToExit < 0) problems.push("the exit can't be reached");
  else if (startToExit < minPath) problems.push(`the exit is only ${startToExit} steps from the start`);
  let startToKey = -1;
  if (D.boss) {
    const noDoor = distances(cells, w, d, D.start, (c) => walk(c) && c !== CELL.LOCKED);
    if (noDoor[ek]! >= 0) problems.push("the exit can be reached without the locked door");
    if (!D.key) problems.push("a boss but no key");
    else {
      startToKey = noDoor[D.key[1] * w + D.key[0]]!;
      if (startToKey < 0) problems.push("the key is behind the locked door (or unreachable)");
    }
    const bk = D.boss[1] * w + D.boss[0];
    if (noDoor[bk]! >= 0) problems.push("the boss can be reached without the locked door");
    if (all[bk]! < 0) problems.push("the boss can't be reached");
  }
  if (!walk(cells[D.start[1] * w + D.start[0]]!)) problems.push("the start isn't open");
  return { pass: problems.length === 0, problems, startToExit, startToKey, open };
}

// ---------------------------------------------------------------- themes and tiles

/** An act's dungeon look: its tile types, props and light. */
export interface DungeonTheme {
  readonly id: string;
  readonly floor: string;
  readonly corridor: string;
  readonly wall: string;
  readonly cave: string;
  readonly liquid: "water" | "lava";
  /** Wall height (steps) and ambient light (0..255) away from torches. */
  readonly wallHeight: number;
  readonly ambient: number;
  /** Props by kind -> a pack object. */
  readonly props: Readonly<Record<string, { readonly pack: string; readonly object: string; readonly scale?: number }>>;
  /** The biome whose ramps it wears (the surface tint). */
  readonly biome: string;
}

export const THEMES: Readonly<Record<string, DungeonTheme>> = {
  crypt: { id: "crypt", floor: "flagstone", corridor: "gravel", wall: "brick", cave: "gravel", liquid: "water", wallHeight: 1, ambient: 120, biome: "crypt", props: { rubble: { pack: "packs/foliage", object: "rock", scale: 0.45 }, bones: { pack: "packs/foliage", object: "log", scale: 0.35 }, chest: { pack: "packs/buildings", object: "path-stones", scale: 0.5 }, crystal: { pack: "packs/foliage", object: "crystal", scale: 0.5 }, mushroom: { pack: "packs/foliage", object: "mushroom", scale: 0.3 } } },
  tomb: { id: "tomb", floor: "sandstone", corridor: "sand", wall: "sandstone", cave: "sand", liquid: "water", wallHeight: 1, ambient: 140, biome: "tomb", props: { rubble: { pack: "packs/foliage", object: "rock", scale: 0.45 }, bones: { pack: "packs/foliage", object: "dead-tree", scale: 0.25 }, chest: { pack: "packs/buildings", object: "path-stones", scale: 0.5 }, crystal: { pack: "packs/foliage", object: "crystal", scale: 0.5 }, mushroom: { pack: "packs/foliage", object: "cactus", scale: 0.3 } } },
  ice: { id: "ice", floor: "ice", corridor: "snow", wall: "rock", cave: "snow", liquid: "water", wallHeight: 1, ambient: 150, biome: "ice-cave", props: { rubble: { pack: "packs/foliage", object: "rock", scale: 0.45 }, bones: { pack: "packs/foliage", object: "log", scale: 0.3 }, chest: { pack: "packs/buildings", object: "path-stones", scale: 0.5 }, crystal: { pack: "packs/foliage", object: "crystal", scale: 0.6 }, mushroom: { pack: "packs/foliage", object: "crystal", scale: 0.35 } } },
  hell: { id: "hell", floor: "ash", corridor: "ash", wall: "rock", cave: "ash", liquid: "lava", wallHeight: 1, ambient: 120, biome: "abyss", props: { rubble: { pack: "packs/foliage", object: "rock", scale: 0.45 }, bones: { pack: "packs/foliage", object: "dead-tree", scale: 0.25 }, chest: { pack: "packs/buildings", object: "path-stones", scale: 0.5 }, crystal: { pack: "packs/foliage", object: "crystal", scale: 0.6 }, mushroom: { pack: "packs/foliage", object: "mushroom", scale: 0.3 } } },
};

/**
 * A dungeon as tile layers at world tile (i0, j0), floor at `level`: walls
 * stand `wallHeight` steps up (the ground baker's cliff faces are its walls),
 * pits drop, water or lava pools a step down; its torches' light baked into
 * the light layer (ambient between them); its things (props, lights, doors,
 * the key, the boss, start and exit) in world metres.
 */
export function dungeonLayers(D: Dungeon, types: TerrainTable, { i0 = 0, j0 = 0, level = 0, theme = THEMES["crypt"]!, biome = 0, tileSize = 2 }: { readonly i0?: number; readonly j0?: number; readonly level?: number; readonly theme?: DungeonTheme; readonly biome?: number; readonly tileSize?: number } = {}): { layers: TileLayers; things: WorldThing[] } {
  const L = createLayers(i0, j0, D.w, D.d, types, { fill: theme.wall, level: level + theme.wallHeight });
  const ty = (n: string): number => (types.has(n) ? types.id(n) : types.id("rock"));
  const floor = ty(theme.floor), corridor = ty(theme.corridor), cave = ty(theme.cave), wall = ty(theme.wall);
  const caveish = D.algorithm === "cave" || D.algorithm === "drunkard";
  for (let k = 0; k < D.w * D.d; k += 1) {
    const c = D.cells[k]!;
    L.biome[k] = biome;
    if (c === CELL.WALL) {
      L.type[k] = wall;
      // (Cave walls wander in height: rock, not masonry.)
      L.height[k] = level + theme.wallHeight + (caveish ? Math.floor(hash01(k % D.w, Math.floor(k / D.w), 91) * 2) : 0);
      L.flags[k] = FLAG.BLOCKED;
      continue;
    }
    L.height[k] = level;
    L.type[k] = c === CELL.CORRIDOR ? corridor : caveish ? cave : floor;
    if (c === CELL.WATER) { L.height[k] = level - 1; L.water[k] = level; L.type[k] = theme.liquid === "lava" ? ty("lava") : cave; if (theme.liquid === "lava") L.water[k] = WATER_NONE; }
    if (c === CELL.PIT) { L.height[k] = level - 4; L.type[k] = wall; L.flags[k] = FLAG.BLOCKED; }
    if (c === CELL.DOOR || c === CELL.LOCKED) L.type[k] = floor;
    L.zone[k] = 1;
  }
  // Light: torches pooled over an ambient floor (a sqrt falloff, so the pool has a soft rim).
  const light = new Float32Array(D.w * D.d).fill(theme.ambient);
  for (const [x, y, r] of D.lights) for (let j = Math.max(0, y - r); j <= Math.min(D.d - 1, y + r); j += 1) for (let i = Math.max(0, x - r); i <= Math.min(D.w - 1, x + r); i += 1) {
    const q = Math.hypot(i - x, j - y) / r;
    if (q < 1) light[j * D.w + i] = Math.max(light[j * D.w + i]!, theme.ambient + (255 - theme.ambient) * (1 - q * q));
  }
  // (Wall tops are the dark between the rooms: their faces, lit from the floor beside them, are the walls you see.)
  for (let k = 0; k < D.w * D.d; k += 1) L.light[k] = Math.round(D.cells[k] === CELL.WALL ? Math.min(light[k]! * 0.08, 12) : light[k]!);
  const things: WorldThing[] = [];
  const pos = (x: number, y: number, dy = 0): readonly [number, number, number] => [(i0 + x + 0.5) * tileSize, level + dy, (j0 + y + 0.5) * tileSize];
  const add = (id: string, kind: WorldThing["kind"], x: number, y: number, extra: Partial<WorldThing> = {}): void => { things.push({ id, kind, pos: pos(x, y), yaw: 0, scale: 1, footprint: null, tags: [], ...extra }); };
  D.props.forEach((p, n) => {
    const pr = theme.props[p.kind] ?? (Object.values(TEMPLATE_PROPS).includes(p.kind) ? { pack: "packs/dungeon", object: p.kind } : undefined);
    // (A yaw in [-pi, pi]: the level codec's range.)
    if (pr) add(`prop-${n}`, "prop", p.x, p.y, { pack: pr.pack, object: pr.object, scale: pr.scale ?? 1, yaw: wrapYaw(hash01(p.x, p.y, 5) * 6.28), tags: [p.kind] });
  });
  D.lights.forEach(([x, y], n) => add(`torch-${n}`, "light", x, y, { tags: ["torch"] }));
  for (let k = 0; k < D.w * D.d; k += 1) if (D.cells[k] === CELL.DOOR || D.cells[k] === CELL.LOCKED) add(`door-${k}`, "door", k % D.w, Math.floor(k / D.w), { tags: D.cells[k] === CELL.LOCKED ? ["locked"] : [] });
  add("start", "start", D.start[0], D.start[1]);
  add("exit", "exit", D.exit[0], D.exit[1]);
  if (D.key) add("key", "key", D.key[0], D.key[1]);
  if (D.boss) add("boss", "boss", D.boss[0], D.boss[1]);
  return { layers: L, things };
}
