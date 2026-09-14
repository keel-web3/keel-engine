// Dressing a dungeon: what turns a fair floor plan (dungeon.ts) into a place
// -- the kind of every room, the floor under your feet, the props, the lights,
// the doors, the stairs. Deterministic from the dungeon and a seed, and it
// never breaks the plan: props that block the way keep off each room's LANES
// (the shortest walks between its entries and its marks), chasms only cut a
// room where a bridge carries the lane over them, and an openable chest no
// one can reach is left out.
//
//   rooms     the grammar's roles (start, key, boss, exit, treasure) become an
//             entry hall, a shrine, a throne room, a stairwell, a vault; the
//             rest are drawn by the act's weights: crypt, library, armoury,
//             storage, prison, sewer, hall, cavern, forge, garden, well.
//             Generators without rooms (caves, walks, WFC) get pseudo-rooms:
//             the open ground grown out from well-spaced wide cells.
//   floor     a code per cell (room, corridor, cave, water, lava, pit,
//             bridge, stairs, door) and decor bits (cracked, moss, puddle,
//             grate, stain, lava crack, sigil, broken paving) from the act's
//             densities and noise fields; rugs in grand rooms; a runner from
//             the throne room's door to the throne.
//   props     by rule: against walls (their backs on the wall, facing in), in
//             corners, in clusters, in the middle; each room kind its own
//             list (a library's shelves, a crypt's sarcophagi, a prison's
//             cages); the corridors' litter. Ids are packs/dungeon's.
//   lights    wall torches every few cells (back walls first: the walls the
//             camera sees), braziers, candles, crystals, fungi, lava cracks,
//             moon shafts through a ruin's roof, the key's glow, a sigil.

import { CELL, wrapYaw } from "./dungeon.ts";
import type { Dungeon } from "./dungeon.ts";
import { hash01, rng, seedOf, value2 } from "./noise.ts";
import type { Rng } from "./noise.ts";
import { CRAWL_ROOM_KINDS, CRAWL_THEMES } from "./crawl-themes.ts";
import type { CrawlLightKind, CrawlRoomKind, CrawlTheme } from "./crawl-themes.ts";

/** A cell's floor. */
export const FLOOR = Object.freeze({ ROOM: 0, CORRIDOR: 1, CAVE: 2, WATER: 3, LAVA: 4, PIT: 5, BRIDGE: 6, STAIRS_UP: 7, STAIRS_DOWN: 8, DOOR: 9, WALL: 10 });
/** A cell's decor bits. */
export const DECOR = Object.freeze({ CRACKED: 1, MOSS: 2, PUDDLE: 4, GRATE: 8, STAIN: 16, LAVA_CRACK: 32, SIGIL: 64, BROKEN: 128 });

/** Directions: 0 +x, 1 +z, 2 -x, 3 -z. */
export const DIR_X = [1, 0, -1, 0] as const;
export const DIR_Z = [0, 1, 0, -1] as const;

/** How a prop is placed (packs/dungeon's PROPS says the same of its own). `back`: its design's back is at local z = 0. */
export interface PropRule {
  readonly radius: number;
  readonly place: "wall" | "corner" | "floor" | "centre" | "decal";
  readonly block: boolean;
  readonly destructible: boolean;
  readonly openable: boolean;
  readonly light: CrawlLightKind | null;
  readonly back?: boolean;
}
const R = (radius: number, place: PropRule["place"], block: boolean, extra: Partial<PropRule> = {}): PropRule => ({ radius, place, block, destructible: false, openable: false, light: null, ...extra });
/** The rules for packs/dungeon's props (a game may pass its own). */
export const DUNGEON_PROP_RULES: Readonly<Record<string, PropRule>> = {
  torch: R(0.2, "wall", false, { light: "torch", back: true }), brazier: R(0.45, "floor", true, { light: "brazier" }), candelabra: R(0.3, "floor", false, { light: "candle" }),
  crystals: R(0.5, "floor", true, { light: "crystal" }), mushrooms: R(0.3, "floor", false, { light: "fungus" }),
  barrel: R(0.4, "corner", true, { destructible: true }), crate: R(0.45, "corner", true, { destructible: true }), urn: R(0.3, "wall", true, { destructible: true }),
  chest: R(0.5, "wall", true, { openable: true }), bones: R(0.5, "decal", false), "skull-pile": R(0.45, "corner", false), stain: R(0.6, "decal", false),
  rubble: R(0.6, "floor", false), cobweb: R(0.3, "corner", false, { back: true }), chains: R(0.2, "wall", false, { back: true }), banner: R(0.2, "wall", false, { back: true }),
  roots: R(0.2, "wall", false, { back: true }), bookshelf: R(0.9, "wall", true, { back: true }), table: R(1, "centre", true, { light: "candle" }),
  "weapon-rack": R(0.8, "wall", true, { back: true }), cage: R(0.6, "floor", true), altar: R(0.9, "centre", true, { light: "candle" }), sarcophagus: R(1.2, "centre", true),
  tombstone: R(0.4, "floor", true), throne: R(1.1, "centre", true), statue: R(0.5, "wall", true), stalagmite: R(0.5, "floor", true), anvil: R(0.45, "floor", true),
  furnace: R(0.45, "wall", true, { light: "brazier", back: true }), "ore-cart": R(0.6, "floor", true, { destructible: true }),
  key: R(0.35, "centre", false, { light: "key" }),
};

export interface DressedRoom {
  readonly id: number;
  /** Its cells' bounding box (i0, j0 inclusive; i1, j1 exclusive). */
  readonly i0: number; readonly j0: number; readonly i1: number; readonly j1: number;
  kind: CrawlRoomKind;
  readonly cells: readonly number[];
  /** Its cells that open onto somewhere else (a door, a corridor, another room). */
  readonly entries: readonly number[];
}
export interface DressedProp {
  /** packs/dungeon's object id. */
  readonly id: string;
  /** World metres (the dungeon's corner at 0, 0; cell (i, j)'s middle at ((i + 0.5) tile, (j + 0.5) tile)). */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly seed: number;
  readonly pins: Readonly<Record<string, string | number | boolean>>;
  readonly block: boolean;
  readonly destructible: boolean;
  readonly openable: boolean;
  readonly room: number;
  /** The wall it's backed against (a direction), or -1. */
  readonly wall: number;
  /** Its light's index, or -1. */
  light: number;
}
export interface DressedLight {
  x: number; y: number; z: number;
  readonly kind: CrawlLightKind;
  readonly radius: number;
  readonly colour: readonly [number, number, number];
  readonly strength: number;
  readonly flicker: number;
  readonly speed: number;
  readonly seed: number;
  /** The prop it hangs on (-1: none -- a lava crack, a moon shaft). */
  readonly prop: number;
  /** A flame is drawn at it (torches, braziers, candles). */
  readonly flame: boolean;
}
export interface DressedDoor {
  readonly cell: number;
  readonly i: number;
  readonly j: number;
  /** The way through it: 0 along x (its leaf spans z), 1 along z (its leaf spans x). */
  readonly axis: 0 | 1;
  readonly locked: boolean;
  /** Walls either side (jambs); without them it stands in its own frame. */
  readonly jambs: boolean;
}
export interface Stairs { readonly i: number; readonly j: number; readonly dir: number }

export interface DungeonDressing {
  readonly theme: CrawlTheme;
  readonly w: number;
  readonly d: number;
  readonly tile: number;
  /** The dungeon's cells with the dressing's chasms cut in (CELL codes). */
  readonly cells: Uint8Array;
  readonly floor: Uint8Array;
  readonly decor: Uint8Array;
  /** A hash per cell (texture variants). */
  readonly variant: Uint8Array;
  readonly roomOf: Int16Array;
  readonly rooms: readonly DressedRoom[];
  readonly props: DressedProp[];
  readonly lights: DressedLight[];
  readonly doors: readonly DressedDoor[];
  readonly rugs: ReadonlyArray<{ readonly i0: number; readonly j0: number; readonly i1: number; readonly j1: number; readonly style: number }>;
  readonly stairsUp: Stairs | null;
  readonly stairsDown: Stairs | null;
  /** Wall cells standing alone (all four neighbours open): pillars. */
  readonly pillars: readonly number[];
  /** Cells a blocking prop stands in (the path grid avoids them), and cells you can walk. */
  readonly blocked: Uint8Array;
  readonly start: readonly [number, number];
  readonly exit: readonly [number, number];
  readonly key: readonly [number, number] | null;
  readonly boss: readonly [number, number] | null;
  readonly stats: Record<string, number>;
}

export interface DressOptions {
  readonly seed?: string;
  readonly tile?: number;
  readonly rules?: Readonly<Record<string, PropRule>>;
  /** Props per room scale (1: the act's own). */
  readonly density?: number;
}

const walkable = (c: number): boolean => c !== CELL.WALL && c !== CELL.PIT && c !== CELL.WATER;

/** Dress a dungeon in an act's theme (a theme or its id). */
export function dressDungeon(D: Dungeon, themeOrId: CrawlTheme | string = "crypt", opts: DressOptions = {}): DungeonDressing {
  const theme = typeof themeOrId === "string" ? CRAWL_THEMES[themeOrId] ?? CRAWL_THEMES["crypt"]! : themeOrId;
  const seed = opts.seed ?? D.seed;
  const tile = opts.tile ?? 2;
  const rules = opts.rules ?? DUNGEON_PROP_RULES;
  const density = opts.density ?? 1;
  const { w, d } = D;
  const s0 = seedOf(seed, `dress:${theme.id}`);
  const Rn = rng(s0);
  const cells = D.cells.slice();
  const N = w * d;
  const at = (k: number): [number, number] => [k % w, Math.floor(k / w)];
  const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < w && j < d;
  const cellAt = (i: number, j: number): number => (inside(i, j) ? cells[j * w + i]! : CELL.WALL);
  const caveish = D.algorithm === "cave" || D.algorithm === "drunkard";

  // ---------------------------------------------------------------- rooms
  const roomOf = new Int16Array(N).fill(-1);
  const rooms: DressedRoom[] = [];
  const mkRoom = (cellsOf: number[], kind: CrawlRoomKind): DressedRoom => {
    let i0 = w, j0 = d, i1 = 0, j1 = 0;
    for (const k of cellsOf) { const [i, j] = at(k); i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i + 1); j1 = Math.max(j1, j + 1); }
    const id = rooms.length;
    for (const k of cellsOf) roomOf[k] = id;
    const r: DressedRoom = { id, i0, j0, i1, j1, kind, cells: cellsOf, entries: [] };
    rooms.push(r);
    return r;
  };
  const pickKind = (): CrawlRoomKind => {
    const list = Object.entries(theme.rooms) as Array<[CrawlRoomKind, number]>;
    return list.length ? Rn.weighted(list, (e) => e[1])[0] : "hall";
  };
  const has = (p: readonly [number, number] | null, r: { x: number; y: number; w: number; h: number }): boolean => !!p && p[0] >= r.x && p[0] < r.x + r.w && p[1] >= r.y && p[1] < r.y + r.h;
  if (D.rooms.length) {
    for (const room of D.rooms) {
      const list: number[] = [];
      for (let j = room.y; j < room.y + room.h; j += 1) for (let i = room.x; i < room.x + room.w; i += 1) {
        const k = j * w + i;
        if (inside(i, j) && cells[k] !== CELL.WALL && roomOf[k]! < 0 && cells[k] !== CELL.DOOR && cells[k] !== CELL.LOCKED) list.push(k);
      }
      if (!list.length) continue;
      let kind: CrawlRoomKind;
      if (room.kind === "start" || has(D.start, room)) kind = "entry";
      else if (room.kind === "boss" || has(D.boss, room)) kind = "throne";
      else if (room.kind === "exit" || has(D.exit, room)) kind = "stairwell";
      else if (room.kind === "key" || has(D.key, room)) kind = "shrine";
      else if (room.kind === "treasure") kind = "vault";
      else if (room.template === "pool") kind = "well";
      else if (room.template === "crypt-row") kind = theme.id === "cave" ? "cavern" : theme.id === "forge" ? "forge" : "crypt";
      else if (room.template === "hall-pillars") kind = "hall";
      // (A template named for a kind of room is one: "dungeon-library", "crypt-hall"...)
      else if (room.template && CRAWL_ROOM_KINDS.some((k2) => room.template!.includes(k2))) kind = CRAWL_ROOM_KINDS.find((k2) => room.template!.includes(k2))!;
      else if (room.template?.includes("storeroom")) kind = "storage";
      else if (room.template?.includes("colonnade")) kind = "hall";
      else if (room.template?.includes("cistern")) kind = "well";
      else kind = pickKind();
      mkRoom(list, kind);
    }
  } else {
    // Pseudo-rooms: seeds on wide cells, well apart; the open ground grown out from them (multi-source BFS), 6 cells at most.
    const wide = (k: number): boolean => { const [i, j] = at(k); for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) if (!walkable(cellAt(i + di, j + dj))) return false; return true; };
    const order: number[] = [];
    for (let k = 0; k < N; k += 1) if (walkable(cells[k]!) && wide(k)) order.push(k);
    order.sort((a, b) => hash01(a, 1, s0) - hash01(b, 1, s0));
    const seeds: number[] = [];
    for (const k of order) { const [i, j] = at(k); if (seeds.every((q) => { const [a, b] = at(q); return Math.max(Math.abs(a - i), Math.abs(b - j)) >= 7; })) seeds.push(k); }
    const dist = new Int32Array(N).fill(-1), owner = new Int32Array(N).fill(-1);
    const q: number[] = [];
    seeds.forEach((k, n) => { dist[k] = 0; owner[k] = n; q.push(k); });
    for (let h = 0; h < q.length; h += 1) {
      const k = q[h]!, [i, j] = at(k);
      if (dist[k]! >= 6) continue;
      for (let dir = 0; dir < 4; dir += 1) { const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!; if (!inside(a, b)) continue; const n = b * w + a; if (dist[n]! < 0 && walkable(cells[n]!)) { dist[n] = dist[k]! + 1; owner[n] = owner[k]!; q.push(n); } }
    }
    const groups: number[][] = seeds.map(() => []);
    for (let k = 0; k < N; k += 1) if (owner[k]! >= 0) groups[owner[k]!]!.push(k);
    const inCells = (p: readonly [number, number] | null, g: number[]): boolean => !!p && g.includes(p[1] * w + p[0]);
    for (const g of groups) {
      if (g.length < 6) continue;
      const kind: CrawlRoomKind = inCells(D.boss, g) ? "throne" : inCells(D.start, g) ? "entry" : inCells(D.exit, g) ? "stairwell" : inCells(D.key, g) ? "shrine" : caveish ? (Rn.chance(0.75) ? "cavern" : pickKind()) : pickKind();
      mkRoom(g, kind);
    }
  }
  // Entries: room cells next to open ground that isn't the room's.
  for (const r of rooms) {
    const e: number[] = [];
    for (const k of r.cells) { const [i, j] = at(k); for (let dir = 0; dir < 4; dir += 1) { const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!; if (!inside(a, b)) continue; const n = b * w + a; if (roomOf[n] !== r.id && cells[n] !== CELL.WALL && cells[n] !== CELL.PIT) { e.push(k); break; } } }
    (r as unknown as { entries: number[] }).entries = e;
  }

  // ---------------------------------------------------------------- lanes: what props never block
  // (A template's own furniture stands where its plan says: those cells are out of the walks from the start.)
  const planned = new Uint8Array(N);
  for (const tp of D.props) { const r = rules[tp.kind]; if (r?.block && inside(tp.x, tp.y)) planned[tp.y * w + tp.x] = 1; }
  const lane = new Uint8Array(N);
  const marks = [D.start, D.exit, D.key, D.boss].filter((p): p is [number, number] => !!p).map(([i, j]) => j * w + i);
  for (const r of rooms) {
    const inRoom = new Set(r.cells);
    // (Entries in runs -- a cave's pseudo-room opens onto its neighbours along a whole edge -- count once, by a
    // middle cell of each run: the walks join the openings, not every cell of them.)
    const openings: number[] = [];
    const seenE = new Set<number>();
    const isEntry = new Set(r.entries);
    for (const e of r.entries) {
      if (seenE.has(e)) continue;
      const run: number[] = [e]; seenE.add(e);
      for (let h = 0; h < run.length; h += 1) { const [i, j] = at(run[h]!); for (let dir = 0; dir < 4; dir += 1) { const n = (j + DIR_Z[dir]!) * w + i + DIR_X[dir]!; if (isEntry.has(n) && !seenE.has(n)) { seenE.add(n); run.push(n); } } }
      openings.push(run[Math.floor(run.length / 2)]!);
    }
    const targets = [...openings, ...marks.filter((m) => inRoom.has(m))];
    for (const t of targets) { const [i, j] = at(t); lane[t] = 1; for (let dir = 0; dir < 4; dir += 1) { const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!; if (inside(a, b) && inRoom.has(b * w + a)) lane[b * w + a] = 1; } }
    // (A shortest walk from the first target to each other one, inside the room.)
    const from = targets[0];
    if (from === undefined) continue;
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    for (let h = 0; h < q.length; h += 1) { const k = q[h]!, [i, j] = at(k); for (let dir = 0; dir < 4; dir += 1) { const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!; const n = b * w + a; if (inside(a, b) && inRoom.has(n) && !prev.has(n) && walkable(cells[n]!) && !planned[n]) { prev.set(n, k); q.push(n); } } }
    for (const t of targets) for (let k = t; k >= 0 && prev.has(k); k = prev.get(k)!) lane[k] = 1;
  }
  // (Corridors are all lane.)
  for (let k = 0; k < N; k += 1) if (roomOf[k]! < 0 && cells[k] !== CELL.WALL) lane[k] = 1;

  // ---------------------------------------------------------------- chasms and bridges
  const bridge = new Uint8Array(N);
  let chasms = 0;
  // (Pits the templates made: a bridge along the lane where it crosses them, else across their middle.)
  for (let k = 0; k < N; k += 1) if (cells[k] === CELL.PIT && lane[k]) bridge[k] = 1;
  if (theme.id === "ruin" || theme.id === "cave" || theme.id === "forge") {
    for (const r of rooms) {
      if (r.i1 - r.i0 < 7 || r.j1 - r.j0 < 7 || r.kind === "entry" || r.kind === "throne" || r.kind === "stairwell" || !Rn.chance(theme.id === "forge" ? 0.3 : 0.4)) continue;
      // A band two cells wide across the room, bridged where the lane crosses it.
      const alongX = Rn.chance(0.5);
      const mid = alongX ? Math.floor((r.i0 + r.i1) / 2) : Math.floor((r.j0 + r.j1) / 2);
      const band = r.cells.filter((k) => { const [i, j] = at(k); const v = alongX ? i : j; return (v === mid || v === mid + 1) && !marks.includes(k); });
      const cut = band.filter((k) => !lane[k]);
      if (!cut.length || cut.length < band.length * 0.5) continue;
      const save = cut.map((k) => cells[k]!);
      for (const k of cut) cells[k] = CELL.PIT;
      for (const k of band) if (lane[k]) bridge[k] = cells[k] === CELL.PIT ? 1 : 0;
      // (Everything left of the room still reachable from its entries? Otherwise the chasm goes.)
      const inRoom = new Set(r.cells);
      const seen = new Set<number>();
      const q = r.entries.filter((k) => walkable(cells[k]!));
      for (const k of q) seen.add(k);
      for (let h = 0; h < q.length; h += 1) { const k = q[h]!, [i, j] = at(k); for (let dir = 0; dir < 4; dir += 1) { const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!; const n = b * w + a; if (inside(a, b) && inRoom.has(n) && !seen.has(n) && (walkable(cells[n]!) || bridge[n])) { seen.add(n); q.push(n); } } }
      if (r.cells.some((k) => (walkable(cells[k]!) || bridge[k]) && !seen.has(k))) { cut.forEach((k, n) => { cells[k] = save[n]!; }); continue; }
      // (A bridge over a chasm: its lane cells in the band become bridge too.)
      for (const k of band) if (lane[k]) { cells[k] = CELL.PIT; bridge[k] = 1; }
      chasms += 1;
    }
  }

  // ---------------------------------------------------------------- floor codes, decor, variants
  const floor = new Uint8Array(N), decor = new Uint8Array(N), variant = new Uint8Array(N);
  const wallNear = (i: number, j: number): number => { let n = 0; for (let dir = 0; dir < 4; dir += 1) if (cellAt(i + DIR_X[dir]!, j + DIR_Z[dir]!) === CELL.WALL) n += 1; return n; };
  for (let k = 0; k < N; k += 1) {
    const c = cells[k]!, [i, j] = at(k);
    variant[k] = Math.floor(hash01(i, j, s0 + 3) * 256);
    floor[k] = c === CELL.WALL ? FLOOR.WALL : c === CELL.CORRIDOR ? FLOOR.CORRIDOR : c === CELL.DOOR || c === CELL.LOCKED ? FLOOR.DOOR : c === CELL.WATER ? (theme.liquid === "lava" ? FLOOR.LAVA : FLOOR.WATER) : c === CELL.PIT ? (bridge[k] ? FLOOR.BRIDGE : FLOOR.PIT) : caveish ? FLOOR.CAVE : FLOOR.ROOM;
    if (floor[k] !== FLOOR.ROOM && floor[k] !== FLOOR.CORRIDOR && floor[k] !== FLOOR.CAVE) continue;
    const near = wallNear(i, j);
    const dec = theme.decor;
    let b = 0;
    if (hash01(i, j, s0 + 11) < dec.cracks) b |= DECOR.CRACKED;
    if (value2(i * 0.22, j * 0.22, s0 + 12) + near * 0.12 > 1.02 - dec.moss * 1.2) b |= DECOR.MOSS;
    if (value2(i * 0.3 + 5, j * 0.3, s0 + 13) < dec.puddles * 1.3) b |= DECOR.PUDDLE;
    if (hash01(i, j, s0 + 14) < dec.stains) b |= DECOR.STAIN;
    if (value2(i * 0.18, j * 0.18, s0 + 15) < dec.broken * 1.4) b |= DECOR.BROKEN;
    if (dec.lavaCracks > 0 && Math.abs(value2(i * 0.16, j * 0.16, s0 + 16) - 0.5) < dec.lavaCracks * 0.45) b |= DECOR.LAVA_CRACK;
    if (floor[k] === FLOOR.CORRIDOR && hash01(i, j, s0 + 17) < dec.grates * 0.6) b |= DECOR.GRATE;
    decor[k] = b;
  }

  // ---------------------------------------------------------------- doors
  const doors: DressedDoor[] = [];
  const isWall = (i: number, j: number): boolean => cellAt(i, j) === CELL.WALL;
  const addDoor = (k: number, locked: boolean): void => {
    const [i, j] = at(k);
    const zWalls = isWall(i, j - 1) && isWall(i, j + 1), xWalls = isWall(i - 1, j) && isWall(i + 1, j);
    const axis: 0 | 1 = xWalls ? 1 : zWalls ? 0 : walkable(cellAt(i, j - 1)) || walkable(cellAt(i, j + 1)) ? 1 : 0;
    doors.push({ cell: k, i, j, axis, locked, jambs: xWalls || zWalls });
    floor[k] = FLOOR.DOOR;
  };
  for (let k = 0; k < N; k += 1) if (cells[k] === CELL.DOOR || cells[k] === CELL.LOCKED) addDoor(k, cells[k] === CELL.LOCKED);
  // (Rooms without door cells -- BSP's -- get doors where a one-wide corridor meets them between two walls.)
  if (!D.rooms.some((r) => r.template)) {
    for (const r of rooms) {
      let made = 0;
      for (const e of r.entries) {
        const [i, j] = at(e);
        for (let dir = 0; dir < 4 && made < 3; dir += 1) {
          const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!, n = b * w + a;
          if (!inside(a, b) || roomOf[n]! >= 0 || cells[n] !== CELL.CORRIDOR || floor[n] === FLOOR.DOOR) continue;
          const px = DIR_Z[dir]!, pz = DIR_X[dir]!;
          if (isWall(a + px, b + pz) && isWall(a - px, b - pz) && !doors.some((o) => Math.abs(o.i - a) + Math.abs(o.j - b) < 3)) { addDoor(n, false); made += 1; }
        }
      }
    }
  }

  // ---------------------------------------------------------------- stairs
  const stairsFor = (p: readonly [number, number], down: boolean): Stairs | null => {
    // Up: against the nearest wall the camera sees (+z, then +x); down: the mark's own cell, going away from the camera.
    if (down) return { i: p[0], j: p[1], dir: isWall(p[0], p[1] + 1) && !isWall(p[0] + 1, p[1]) ? 0 : 1 };
    for (const dir of [1, 0, 3, 2]) {
      for (let s = 0; s <= 4; s += 1) {
        const i = p[0] + DIR_X[dir]! * s, j = p[1] + DIR_Z[dir]! * s;
        if (!walkable(cellAt(i, j))) break;
        if (isWall(i + DIR_X[dir]!, j + DIR_Z[dir]!) && s >= 1) return { i, j, dir };
      }
    }
    return null;
  };
  const stairsUp = stairsFor(D.start, false);
  const stairsDown = stairsFor(D.exit, true);
  if (stairsUp) floor[stairsUp.j * w + stairsUp.i] = FLOOR.STAIRS_UP;
  if (stairsDown) floor[stairsDown.j * w + stairsDown.i] = FLOOR.STAIRS_DOWN;

  // ---------------------------------------------------------------- pillars
  const pillars: number[] = [];
  for (let k = 0; k < N; k += 1) { if (cells[k] !== CELL.WALL) continue; const [i, j] = at(k); if (!isWall(i + 1, j) && !isWall(i - 1, j) && !isWall(i, j + 1) && !isWall(i, j - 1)) pillars.push(k); }

  // ---------------------------------------------------------------- props and lights
  const props: DressedProp[] = [];
  const lights: DressedLight[] = [];
  const rugs: Array<{ i0: number; j0: number; i1: number; j1: number; style: number }> = [];
  const blocked = new Uint8Array(N);
  const used = new Uint8Array(N); // (bit 0: its floor; bits 1..4: its walls by direction; bit 5: a decal)
  if (stairsUp) { const k = stairsUp.j * w + stairsUp.i; blocked[k] = 1; used[k] = 63; }
  if (stairsDown) used[stairsDown.j * w + stairsDown.i] = 63;
  for (const dr of doors) used[dr.cell] = 63;
  const centreOf = (k: number): [number, number] => { const [i, j] = at(k); return [(i + 0.5) * tile, (j + 0.5) * tile]; };
  const LIGHT_AT: Readonly<Partial<Record<CrawlLightKind, readonly [number, number, number]>>> = { torch: [0, 2.26, 0.31], sconce: [0, 2.1, 0.24], brazier: [0, 1.1, 0], candle: [0, 0.4, 0], crystal: [0, 0.8, 0], fungus: [0, 0.3, 0], key: [0, 0.8, 0] };
  const addLight = (kind: CrawlLightKind, x: number, y: number, z: number, prop: number, flame: boolean, scale = 1): number => {
    const L = theme.lights[kind];
    lights.push({ x, y, z, kind, radius: L.radius * scale, colour: L.colour, strength: L.strength, flicker: L.flicker, speed: L.speed, seed: (seedOf(seed, `light${lights.length}`) >>> 8) / 16777216, prop, flame });
    return lights.length - 1;
  };
  // (Would blocking this cell cut the ground round it in two? Its open neighbours must still join round its ring.)
  const RING_X = [0, 1, 1, 1, 0, -1, -1, -1], RING_Z = [-1, -1, 0, 1, 1, 1, 0, -1];
  const cuts = (k: number): boolean => {
    const [i, j] = at(k);
    const open = RING_X.map((dx, q) => { const a = i + dx, b = j + RING_Z[q]!; return inside(a, b) && (walkable(cells[b * w + a]!) || bridge[b * w + a] === 1) && !blocked[b * w + a]; });
    let runs = 0;
    for (let q = 0; q < 8; q += 1) {
      if (!open[q] || open[(q + 7) % 8]) continue;
      // (A run starts here: does it hold one of the four side neighbours?)
      let side = false;
      for (let r2 = q; open[r2 % 8] && r2 < q + 8; r2 += 1) if ((r2 % 8) % 2 === 0) side = true;
      if (side) runs += 1;
    }
    if (open.every(Boolean)) return false;
    return runs > 1;
  };
  const templatePins = (id: string): Record<string, string | number | boolean> => (id === "chest" ? { size: "large", build: "iron", state: "closed" } : id === "rubble" ? { form: "heap" } : id === "throne" ? { build: "iron", crown: "skulls" } : {});
  const put = (id: string, x: number, z: number, yaw0: number, room: number, wall: number, pins: Record<string, string | number | boolean> = {}, cell = -1): DressedProp | null => {
    const yaw = wrapYaw(yaw0);
    const r = rules[id] ?? R(0.4, "floor", false);
    if (r.block && cell >= 0) { if (lane[cell] || cuts(cell)) return null; blocked[cell] = 1; }
    const p: DressedProp = { id, x, z, yaw, seed: seedOf(seed, `prop${props.length}:${id}`) >>> 0, pins, block: r.block, destructible: r.destructible, openable: r.openable, room, wall, light: -1 };
    props.push(p);
    if (r.light) {
      const off = LIGHT_AT[r.light] ?? [0, 1, 0];
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const flame = r.light === "torch" || r.light === "brazier" || r.light === "candle" || r.light === "sconce";
      // (Candles on a table or an altar sit higher.)
      const y = id === "table" || id === "altar" ? 1.1 : off[1];
      p.light = addLight(r.light, x + off[0] * c + off[2] * s, y, z - off[0] * s + off[2] * c, props.length - 1, flame && id !== "table" && id !== "altar", id === "table" || id === "altar" ? 1.2 : 1);
    }
    return p;
  };
  const yawFacing = (dx: number, dz: number): number => Math.atan2(dx, dz);

  // Spots in a room.
  interface Spot { k: number; dir: number }
  const wallSpots = (r: DressedRoom, back: boolean | null): Spot[] => {
    const out: Spot[] = [];
    for (const k of r.cells) {
      if (!walkable(cells[k]!) || floor[k] === FLOOR.STAIRS_DOWN) continue;
      const [i, j] = at(k);
      for (let dir = 0; dir < 4; dir += 1) {
        if (back !== null && (dir === 0 || dir === 1) !== back) continue;
        if (isWall(i + DIR_X[dir]!, j + DIR_Z[dir]!) && !(used[k]! & (2 << dir))) out.push({ k, dir });
      }
    }
    return out;
  };
  const corners = (r: DressedRoom): Spot[] => {
    const out: Spot[] = [];
    for (const k of r.cells) { if (!walkable(cells[k]!)) continue; const [i, j] = at(k); for (let dir = 0; dir < 4; dir += 1) { const d2 = (dir + 1) & 3; if (isWall(i + DIR_X[dir]!, j + DIR_Z[dir]!) && isWall(i + DIR_X[d2]!, j + DIR_Z[d2]!)) out.push({ k, dir }); } }
    return out;
  };
  const middles = (r: DressedRoom): number[] => r.cells.filter((k) => { const [i, j] = at(k); if (!walkable(cells[k]!)) return false; for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) if (isWall(i + di, j + dj)) return false; return true; });
  const shuffled = <T,>(list: T[], Rr: Rng): T[] => Rr.shuffle(list);

  // Against a wall: its back on the wall's face (the cell's edge), facing in.
  const onWall = (id: string, s: Spot, room: number, pins: Record<string, string | number | boolean> = {}): DressedProp | null => {
    const r = rules[id] ?? R(0.4, "wall", false);
    if (r.block && (used[s.k]! & 1)) return null;
    const [cx, cz] = centreOf(s.k);
    const off = tile / 2 - (r.back ? 0.02 : r.radius + 0.06);
    const p = put(id, cx + DIR_X[s.dir]! * off, cz + DIR_Z[s.dir]! * off, yawFacing(-DIR_X[s.dir]!, -DIR_Z[s.dir]!), room, s.dir, pins, r.block ? s.k : -1);
    if (p) { used[s.k] = used[s.k]! | (2 << s.dir) | (r.block ? 1 : 0); }
    return p;
  };
  const inCorner = (id: string, s: Spot, room: number, Rr: Rng, pins: Record<string, string | number | boolean> = {}): DressedProp | null => {
    const r = rules[id] ?? R(0.4, "corner", false);
    if (used[s.k]! & 1) return null;
    const [cx, cz] = centreOf(s.k);
    const d2 = (s.dir + 1) & 3;
    const off = tile / 2 - r.radius - 0.06;
    const face = id === "cobweb" ? yawFacing(-(DIR_X[s.dir]! + DIR_X[d2]!), -(DIR_Z[s.dir]! + DIR_Z[d2]!)) : Rr.between(0, Math.PI * 2);
    const p = put(id, cx + (DIR_X[s.dir]! + DIR_X[d2]!) * off, cz + (DIR_Z[s.dir]! + DIR_Z[d2]!) * off, face, room, s.dir, pins, r.block ? s.k : -1);
    if (p && r.block) used[s.k] = used[s.k]! | 1;
    return p;
  };
  const onFloor = (id: string, k: number, room: number, Rr: Rng, pins: Record<string, string | number | boolean> = {}, jitter = 0.4, yaw?: number): DressedProp | null => {
    const r = rules[id] ?? R(0.4, "floor", false);
    if (r.block && (used[k]! & 1)) return null;
    if (!r.block && r.place === "decal" && (used[k]! & 32)) return null;
    const [cx, cz] = centreOf(k);
    const p = put(id, cx + Rr.between(-jitter, jitter), cz + Rr.between(-jitter, jitter), yaw ?? Rr.between(0, Math.PI * 2), room, -1, pins, r.block ? k : -1);
    if (p) used[k] = used[k]! | (r.block ? 1 : 0) | (r.place === "decal" ? 32 : 0);
    return p;
  };
  // A cluster: a few of one kind round a cell (barrels, crates, stalagmites).
  const cluster = (ids: readonly string[], k0: number, room: number, n: number, Rr: Rng): void => {
    const [i0, j0] = at(k0);
    for (let m = 0; m < n; m += 1) {
      const i = i0 + Rr.int(-1, 1), j = j0 + Rr.int(-1, 1), k = j * w + i;
      if (!inside(i, j) || roomOf[k] !== room || !walkable(cells[k]!)) continue;
      onFloor(Rr.pick(ids), k, room, Rr, {}, 0.45);
    }
  };

  // Torches along a room's walls, every few cells, back walls first.
  const torchRoom = (r: DressedRoom, Rr: Rng, every = theme.torchEvery): void => {
    // (Back walls only: a front wall is kept low by the cutaway, and a torch on it would hang in the air.)
    const spots = wallSpots(r, true);
    const placed: Array<[number, number]> = [];
    for (const s of spots) {
      const [i, j] = at(s.k);
      if (placed.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) < every * 0.8)) continue;
      const form = theme.id === "cave" ? "bracket" : Rr.chance(0.15) ? "sconce" : Rr.chance(0.2) ? "cage" : "bracket";
      const p = onWall("torch", s, r.id, { form });
      if (p) { placed.push([i, j]); if (form === "sconce") { const L = lights[p.light]!; lights[p.light] = { ...L, kind: "sconce", ...pick(theme.lights.sconce) }; } }
    }
  };
  const pick = (L: { colour: readonly [number, number, number]; radius: number; strength: number; flicker: number; speed: number }) => ({ colour: L.colour, radius: L.radius, strength: L.strength, flicker: L.flicker, speed: L.speed });

  const count = (r: DressedRoom, per: number): number => Math.max(0, Math.round(r.cells.length * per * density));
  // The templates' own props first: a vault's chest where its plan puts it, rubble where it says.
  for (const tp of D.props) {
    const k = tp.y * w + tp.x;
    if (!inside(tp.x, tp.y) || !walkable(cells[k]!)) continue;
    const [cx, cz] = centreOf(k);
    const room = roomOf[k]!;
    const rule = rules[tp.kind];
    if (!rule) continue;
    const r = rooms[room];
    const e = r?.entries[0];
    const [ex, ez] = e !== undefined ? centreOf(e) : [cx, cz - 1];
    // (Backed against the nearest wall if it goes on one; else in the middle of its cell, facing the way in.)
    const wallDir = rule.place === "wall" || rule.back ? [1, 0, 3, 2].find((dir) => isWall(tp.x + DIR_X[dir]!, tp.y + DIR_Z[dir]!)) : undefined;
    if (wallDir !== undefined) { if (onWall(tp.kind, { k, dir: wallDir }, room, templatePins(tp.kind))) continue; }
    const lane0 = lane[k]!; lane[k] = 0; // (a planned piece may stand where the plan put it)
    const p = put(tp.kind, cx + (rule.block ? 0 : Rn.between(-0.3, 0.3)), cz + (rule.block ? 0 : Rn.between(-0.3, 0.3)), rule.block || tp.kind === "throne" ? yawFacing(ex - cx, ez - cz) : Rn.between(-Math.PI, Math.PI), room, -1, templatePins(tp.kind), rule.block ? k : -1);
    lane[k] = lane0;
    if (p && rule.block) used[k] = used[k]! | 1;
  }
  for (const r of rooms) {
    const Rr = rng(seedOf(seed, `room${r.id}:${r.kind}`));
    const walls = shuffled(wallSpots(r, null), Rr), backs = shuffled(wallSpots(r, true), Rr), corner = shuffled(corners(r), Rr), mids = shuffled(middles(r), Rr);
    const freeCells = shuffled(r.cells.filter((k) => walkable(cells[k]!) && !lane[k]), Rr);
    const anyCells = shuffled(r.cells.filter((k) => walkable(cells[k]!) && floor[k] !== FLOOR.STAIRS_DOWN), Rr);
    const take = <T,>(list: T[]): T | undefined => list.shift();
    // (Litter in its own shapes each time: never the same heap of rubble five times over.)
    const varied = (id: string): Record<string, string | number | boolean> => id === "rubble" ? { form: Rr.pick(["heap", "blocks", "column", "heap"]), moss: theme.decor.moss > 0.1 && Rr.chance(0.4) }
      : id === "skull-pile" ? { form: Rr.pick(["heap", "pyramid"]), count: Rr.pick([4, 7, 10]) } : id === "bones" ? { count: Rr.pick([3, 5, 8]), skull: Rr.chance(0.6) } : id === "stain" ? { form: Rr.pick(["pool", "splatter", "trail"]) } : {};
    const decals = (ids: readonly string[], n: number) => { for (let m = 0; m < n; m += 1) { const k = take(anyCells); if (k !== undefined) { const id = Rr.pick(ids); onFloor(id, k, r.id, Rr, varied(id), 0.55); } } };
    const along = (id: string, n: number, list: Spot[] = walls, pins: () => Record<string, string | number | boolean> = () => ({})) => { let m = 0; for (const s of list.slice()) { if (m >= n) break; if (onWall(id, s, r.id, pins())) m += 1; } };
    const inCorners = (ids: readonly string[], n: number) => { let m = 0; for (const s of corner.slice()) { if (m >= n) break; if (inCorner(Rr.pick(ids), s, r.id, Rr)) m += 1; } };
    const cobwebs = (n: number) => { let m = 0; for (const s of corner) { if (m >= n) break; if ((s.dir === 0 && isWall(at(s.k)[0], at(s.k)[1] + 1)) || s.dir === 1 || Rr.chance(0.3)) { if (inCorner("cobweb", s, r.id, Rr)) m += 1; } } };
    const big = r.cells.length;
    torchRoom(r, Rr, r.kind === "throne" || r.kind === "entry" ? Math.max(3, theme.torchEvery - 2) : theme.torchEvery);
    switch (r.kind) {
      case "entry": {
        along("banner", 2, backs, () => ({ tail: Rr.pick(["notched", "pointed", "flat"]) }));
        if (stairsUp) { const k = stairsUp.j * w + stairsUp.i; const [cx, cz] = centreOf(k); for (const side of [-1, 1]) { const px = DIR_Z[stairsUp.dir]! * side * 1.6, pz = DIR_X[stairsUp.dir]! * side * 1.6; const i = Math.floor((cx + px) / tile), j = Math.floor((cz + pz) / tile); if (inside(i, j) && roomOf[j * w + i] === r.id && walkable(cellAt(i, j))) { const kk = j * w + i; if (!lane[kk]) put("brazier", cx + px, cz + pz, 0, r.id, -1, { form: "tripod" }, kk); } } }
        inCorners(["barrel", "crate"], 2); cobwebs(2); decals(["bones", "rubble"], 2);
        break;
      }
      case "stairwell": {
        inCorners(["skull-pile", "barrel", "urn"], 3); cobwebs(3); decals(["bones", "stain", "rubble"], 3);
        for (const k of mids.slice(0, 2)) if (!lane[k]) onFloor("brazier", k, r.id, Rr, { form: "pillar" }, 0.2);
        break;
      }
      case "throne": {
        const b = D.boss ?? [Math.floor((r.i0 + r.i1) / 2), Math.floor((r.j0 + r.j1) / 2)];
        const bk = b[1] * w + b[0];
        decor[bk] = decor[bk]! | DECOR.SIGIL;
        // The throne behind the boss's spot, facing the way in.
        const e = r.entries[0] ?? bk;
        const [ex, ez] = centreOf(e), [bx, bz] = centreOf(bk);
        let tx = bx + Math.sign(bx - ex) * (Math.abs(bx - ex) > Math.abs(bz - ez) ? tile : 0), tz = bz + Math.sign(bz - ez) * (Math.abs(bz - ez) >= Math.abs(bx - ex) ? tile : 0);
        const ti = Math.floor(tx / tile), tj = Math.floor(tz / tile);
        if (!(inside(ti, tj) && roomOf[tj * w + ti] === r.id && walkable(cellAt(ti, tj)))) { tx = bx; tz = bz; }
        if (!props.some((p) => p.id === "throne" && p.room === r.id)) put("throne", tx, tz, yawFacing(ex - tx, ez - tz), r.id, -1, { build: Rr.pick(["stone", "bone", "iron"]), crown: Rr.pick(["spikes", "skulls", "arch"]) });
        // (The runner: from the way in to the throne.)
        // (The runner stops a cell short of the way in: it's the room's, not the doorway's.)
        { const [ei, ej] = at(e); const si = ei + Math.sign(ti - ei), sj = ej + Math.sign(tj - ej); rugs.push({ i0: Math.min(si, ti), j0: Math.min(sj, tj), i1: Math.max(si, ti) + 1, j1: Math.max(sj, tj) + 1, style: 2 }); }
        let n = 0; for (const s of corner) { if (n >= 4) break; if (!lane[s.k] && inCorner("brazier", s, r.id, Rr, { form: "pillar" })) n += 1; }
        along("banner", 3, backs, () => ({ device: "skull", tail: "notched" }));
        along("statue", 2, backs.filter((s) => !lane[s.k]), () => ({ form: Rr.pick(["knight", "idol"]) }));
        inCorners(["skull-pile"], 2); decals(["bones", "stain"], count(r, 0.08));
        break;
      }
      case "shrine": {
        const kk = D.key ? D.key[1] * w + D.key[0] : mids[0];
        if (kk !== undefined) { const [x, z] = centreOf(kk); put("key", x, z, Rr.between(0, 6.28), r.id, -1, { rest: "plinth" }); }
        for (const k of mids.slice(0, 3)) if (!lane[k] && k !== kk) onFloor("candelabra", k, r.id, Rr, { form: "stand", count: 3 }, 0.3);
        along("statue", 2, backs.filter((s) => !lane[s.k]), () => ({ form: Rr.pick(["knight", "obelisk"]) }));
        along("banner", 2, backs); decals(["candelabra"], 2); cobwebs(2);
        break;
      }
      case "vault": {
        along("chest", Math.max(2, Math.min(4, Math.round(big / 10))), walls.filter((s) => !lane[s.k]), () => ({ size: Rr.pick(["small", "large"]), build: Rr.pick(["wood", "iron"]), state: "closed" }));
        along("urn", 3, walls.filter((s) => !lane[s.k]), () => ({ form: Rr.pick(["round", "amphora", "jar"]) }));
        inCorners(["crate", "barrel"], 2); cobwebs(2);
        break;
      }
      case "crypt": {
        // Sarcophagi in the middle, in a row; urns and candles along the walls.
        let n = 0; for (const k of mids) { if (n >= Math.max(1, Math.round(big / 16))) break; if (!lane[k] && onFloor("sarcophagus", k, r.id, Rr, { lid: Rr.pick(["closed", "closed", "closed", "closed", "ajar"]), carving: Rr.pick(["effigy", "effigy", "cross"]) }, 0.1, Rr.chance(0.5) ? 0 : Math.PI / 2)) n += 1; }
        along("urn", count(r, 0.08), walls.filter((s) => !lane[s.k]));
        decals(["candelabra", "candelabra", "bones", "skull-pile"], count(r, 0.1)); cobwebs(3);
        if (theme.id === "ruin") decals(["tombstone"], 2);
        break;
      }
      case "library": {
        along("bookshelf", Math.max(2, Math.round(backs.length * 0.7)), backs.filter((s) => !lane[s.k]), () => ({ fill: Rr.pick(["full", "full", "sparse", "ruined"]), ...(theme.id === "ruin" ? { shelves: 3, fill: Rr.pick(["sparse", "ruined"]) } : {}) }));
        let n = 0; for (const k of mids) { if (n >= Math.max(1, Math.round(big / 18))) break; if (!lane[k] && onFloor("table", k, r.id, Rr, { form: Rr.pick(["long", "square", "round"]), clutter: Rr.pick(["books", "books", "candles", "alchemy"]) }, 0.2, Rr.chance(0.5) ? 0 : Math.PI / 2)) n += 1; }
        decals(["candelabra"], 1); cobwebs(3);
        break;
      }
      case "armoury": {
        along("weapon-rack", Math.max(2, Math.round(backs.length * 0.45)), backs.filter((s) => !lane[s.k]), () => ({ load: Rr.pick(["swords", "spears", "axes", "mixed"]) }));
        if (theme.id === "forge") along("furnace", 1, backs.filter((s) => !lane[s.k]));
        along("statue", 1, backs.filter((s) => !lane[s.k]), () => ({ form: "knight" }));
        inCorners(["crate", "barrel"], 3); if (theme.id === "forge") for (const k of freeCells.slice(0, 1)) onFloor("anvil", k, r.id, Rr);
        along("banner", 1, backs); decals(["rubble"], 1);
        break;
      }
      case "storage": {
        const spots = corner.slice(0, 4);
        for (const s of spots) if (!lane[s.k]) cluster(["barrel", "crate", "crate"], s.k, r.id, 3, Rr);
        along("urn", 2, walls.filter((s) => !lane[s.k])); cobwebs(3); decals(["rubble", "bones"], 2);
        break;
      }
      case "prison": {
        let n = 0; for (const k of freeCells) { if (n >= Math.max(1, Math.round(big / 14))) break; if (onFloor("cage", k, r.id, Rr, { form: Rr.pick(["floor", "hanging"]), inside: Rr.pick(["bones", "skull", "none"]) }, 0.2)) n += 1; }
        along("chains", count(r, 0.12), backs);
        decals(["bones", "stain", "stain"], count(r, 0.12)); inCorners(["skull-pile"], 1);
        for (const k of mids.slice(0, 1)) if (!lane[k]) onFloor("table", k, r.id, Rr, { form: "long", clutter: "none" }, 0.2);
        break;
      }
      case "sewer": {
        for (const k of anyCells.slice(0, Math.max(1, Math.round(big / 12)))) decor[k] = decor[k]! | DECOR.GRATE | DECOR.PUDDLE;
        decals(["stain", "bones", "rubble"], count(r, 0.1)); inCorners(["barrel"], 2); cobwebs(2);
        break;
      }
      case "hall": {
        along("statue", Math.max(2, Math.round(backs.length / 4)), backs.filter((s) => !lane[s.k]), () => ({ form: Rr.pick(["knight", "knight", "obelisk", "idol"]), moss: theme.id === "ruin" }));
        along("banner", 4, backs, () => ({ tail: Rr.pick(["notched", "pointed", "flat"]), device: Rr.pick(["disc", "bar", "skull", "none"]) }));
        for (const k of mids.slice(0, 3)) if (!lane[k]) onFloor("brazier", k, r.id, Rr, { form: Rr.pick(["tripod", "pillar"]) }, 0.2);
        along("urn", 2, walls.filter((s) => !lane[s.k]));
        inCorners(["skull-pile", "rubble", "barrel"], 3);
        decals(["rubble", "bones", "candelabra"], count(r, 0.07)); cobwebs(3);
        break;
      }
      case "cavern": {
        const n = count(r, 0.07);
        for (let m = 0; m < n; m += 1) { const k = freeCells[m]; if (k !== undefined) cluster(["stalagmite", "stalagmite", "rubble"], k, r.id, 2, Rr); }
        for (const k of freeCells.slice(n, n + Math.max(3, Math.round(big / 7)))) { const c2 = theme.id === "forge" || Rr.chance(0.55); onFloor(c2 ? "crystals" : "mushrooms", k, r.id, Rr, c2 ? { height: Math.round(Rr.between(0.5, 1.2) * 10) / 10, count: Rr.pick([4, 5, 7]) } : { count: Rr.pick([5, 7]) }); }
        // (A camp's fire in the big caverns: someone was here.)
        if (big > 24) for (const k of mids.slice(0, 6)) if (!lane[k] && onFloor("brazier", k, r.id, Rr, { form: "bowl" }, 0.2)) { for (const q of [k + 1, k - 1, k + w]) if (roomOf[q] === r.id && walkable(cells[q]!)) onFloor(Rr.pick(["crate", "barrel", "bones", "rubble"]), q, r.id, Rr); break; }
        decals(["mushrooms", "bones", "rubble", "rubble"], count(r, 0.1)); cobwebs(2);
        inCorners(["stalagmite", "stalagmite", "rubble"], 4);
        // (Crystals grow out of the cave's walls, glowing; fungi crowd its damp corners.)
        { let m = 0; for (const s of walls) { if (m >= Math.max(3, Math.round(big / 8))) break; if (!lane[s.k] && !(used[s.k]! & 1) && Rr.chance(0.5)) { const [cx, cz] = centreOf(s.k); const off = tile / 2 - 0.45; if (put(theme.id === "forge" ? "crystals" : Rr.pick(["crystals", "crystals", "mushrooms"]), cx + DIR_X[s.dir]! * off, cz + DIR_Z[s.dir]! * off, Rr.between(-Math.PI, Math.PI), r.id, s.dir, {}, s.k)) { used[s.k] = used[s.k]! | 1; m += 1; } } } }
        break;
      }
      case "forge": {
        for (const k of freeCells.slice(0, Math.max(2, Math.round(big / 12)))) onFloor(Rr.chance(0.7) ? "anvil" : "brazier", k, r.id, Rr, { form: "bowl" });
        let n = 0; for (const s of corner) { if (n >= 4) break; if (!lane[s.k] && inCorner("brazier", s, r.id, Rr, { form: Rr.pick(["bowl", "pillar"]) })) n += 1; }
        along("furnace", Math.max(1, Math.round(backs.length / 8)), backs.filter((s) => !lane[s.k]), () => ({ bellows: true }));
        along("weapon-rack", 2, backs.filter((s) => !lane[s.k])); along("chains", 3, backs);
        for (const k of freeCells.slice(0, 2)) onFloor("ore-cart", k, r.id, Rr, { load: Rr.pick(["ore", "glowing"]) }, 0.2, Rr.chance(0.5) ? 0 : Math.PI / 2);
        inCorners(["crate", "barrel"], 3); decals(["stain", "rubble", "bones"], count(r, 0.06));
        // A molten pool in the middle -- the forge's heart -- where it cuts no one off; and a channel of cracks.
        { const ci = (r.i0 + r.i1) / 2 - 0.5, cj = (r.j0 + r.j1) / 2 - 0.5; const near = mids.slice().sort((a2, b2) => Math.hypot(at(a2)[0] - ci, at(a2)[1] - cj) - Math.hypot(at(b2)[0] - ci, at(b2)[1] - cj));
          let m = 0; for (const k of near) { if (m >= 4) break; if (lane[k] || (used[k]! & 1) || cuts(k)) continue; cells[k] = CELL.WATER; floor[k] = FLOOR.LAVA; used[k] = used[k]! | 1; const [lx, lz] = centreOf(k); addLight("lava", lx, 0.4, lz, -1, false, 1.2); m += 1; } }
        const midJ = Math.floor((r.j0 + r.j1) / 2);
        for (const k of r.cells) { const cj = at(k)[1]; if (cj === midJ && !lane[k] && !(used[k]! & 1) && walkable(cells[k]!)) decor[k] = decor[k]! | DECOR.LAVA_CRACK; }
        break;
      }
      case "garden": {
        along("roots", count(r, 0.1), backs);
        decals(["tombstone", "rubble", "mushrooms"], count(r, 0.07));
        along("statue", 1, backs.filter((s) => !lane[s.k]), () => ({ form: "knight", moss: true, broken: true }));
        for (const k of r.cells) if (hash01(k, 9, s0) < 0.5) decor[k] = decor[k]! | DECOR.MOSS;
        break;
      }
      case "well": {
        along("urn", 3, walls.filter((s) => !lane[s.k])); decals(["candelabra", "bones"], 3); cobwebs(2);
        break;
      }
    }
    // Every room: whatever wall is still bare gets a little of the act's wall dressing, its dark corners webs.
    {
      const wallKit = theme.id === "cave" ? ["roots", "chains"] : theme.id === "forge" ? ["chains", "chains", "banner", "weapon-rack"] : theme.id === "ruin" ? ["roots", "roots", "banner", "chains"] : ["banner", "chains", "urn", "urn"];
      const bare = wallSpots(r, true);
      for (const s of bare) if (Rr.chance(0.22 * density)) onWall(Rr.pick(wallKit), s, r.id, {});

      for (const s of corner.slice(0, 3)) if (!lane[s.k] && Rr.chance(0.35 * density)) inCorner(Rr.pick(theme.id === "cave" ? ["stalagmite", "rubble"] : ["barrel", "crate", "urn", "skull-pile", "rubble"]), s, r.id, Rr);
    }
    // Every room: a little litter, and a rug under a grand room's middle.
    decals(theme.id === "cave" ? ["bones", "rubble"] : ["bones", "rubble", "stain"], count(r, 0.03));
    if ((r.kind === "library" || r.kind === "entry" || r.kind === "hall") && r.i1 - r.i0 >= 6 && r.j1 - r.j0 >= 6 && Rr.chance(0.7)) rugs.push({ i0: r.i0 + 2, j0: r.j0 + 2, i1: r.i1 - 2, j1: r.j1 - 2, style: r.kind === "library" ? 1 : 0 });
    if (theme.decor.ivy > 0 && r.kind !== "garden") along("roots", Math.round(walls.length * theme.decor.ivy * 0.3), backs);
    // A moon shaft through a broken roof.
    if (theme.decor.shafts > 0 && Rr.chance(theme.decor.shafts) && mids.length) { const k = mids[Math.floor(mids.length / 2)]!; const [x, z] = centreOf(k); addLight("shaft", x, 6, z, -1, false); onFloor("rubble", k, r.id, Rr, { moss: true, form: "heap" }, 0.2); }
  }

  // Corridors: a torch now and then on a wall the camera sees, litter, cobwebs.
  {
    const Rc = rng(seedOf(seed, "corridors"));
    const placed: Array<[number, number]> = [];
    for (let k = 0; k < N; k += 1) {
      if (roomOf[k]! >= 0 || cells[k] !== CELL.CORRIDOR) continue;
      const [i, j] = at(k);
      if (!placed.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) < Math.min(theme.torchEvery + 1, 12))) {
        for (const dir of [1, 0]) if (isWall(i + DIR_X[dir]!, j + DIR_Z[dir]!) && Rc.chance(0.5)) { if (onWall("torch", { k, dir }, -1, { form: "bracket" })) { placed.push([i, j]); break; } }
      }
      if (Rc.chance(0.035 * density)) onFloor(Rc.pick(["rubble", "rubble", "bones", "stain"]), k, -1, Rc, {}, 0.5);
      else if (Rc.chance(0.02 * density)) for (const dir of [0, 1]) { const d2 = (dir + 1) & 3; if (isWall(i + DIR_X[dir]!, j + DIR_Z[dir]!) && isWall(i + DIR_X[d2]!, j + DIR_Z[d2]!)) { inCorner("cobweb", { k, dir }, -1, Rc); break; } }
    }
  }

  // Lava: a light over every few cells of it (pools and cracks), for the glow.
  {
    let n = 0;
    for (let k = 0; k < N; k += 1) {
      const [i, j] = at(k);
      const molten = floor[k] === FLOOR.LAVA || (decor[k]! & DECOR.LAVA_CRACK) !== 0;
      if (!molten || (i + j * 3) % 3 !== 0 || hash01(i, j, s0 + 21) > 0.55) continue;
      const [x, z] = centreOf(k);
      if (lights.some((L) => L.kind === "lava" && Math.abs(L.x - x) + Math.abs(L.z - z) < tile * 2.5)) continue;
      addLight("lava", x, 0.4, z, -1, false, floor[k] === FLOOR.LAVA ? 1 : 0.7);
      n += 1;
    }
    void n;
  }
  // The sigil under the boss, and the key's glow is its prop's.
  if (D.boss) { const [x, z] = centreOf(D.boss[1] * w + D.boss[0]); addLight("sigil", x, 0.3, z, -1, false); }

  // An openable prop no one can reach (hemmed in by blocking ones) is taken out.
  {
    const reach = new Uint8Array(N);
    const q = [D.start[1] * w + D.start[0]];
    reach[q[0]!] = 1;
    for (let h = 0; h < q.length; h += 1) { const k = q[h]!, [i, j] = at(k); for (let dir = 0; dir < 4; dir += 1) { const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!; if (!inside(a, b)) continue; const n = b * w + a; if (!reach[n] && (walkable(cells[n]!) || bridge[n]) && !blocked[n]) { reach[n] = 1; q.push(n); } } }
    for (let p = props.length - 1; p >= 0; p -= 1) {
      const pr = props[p]!;
      if (!pr.openable) continue;
      const i = Math.floor(pr.x / tile), j = Math.floor(pr.z / tile);
      let ok = false;
      for (let dir = 0; dir < 4; dir += 1) if (inside(i + DIR_X[dir]!, j + DIR_Z[dir]!) && reach[(j + DIR_Z[dir]!) * w + i + DIR_X[dir]!]) ok = true;
      if (!ok) { props.splice(p, 1); for (const L of lights) if (L.prop > p) (L as { prop: number }).prop -= 1; blocked[j * w + i] = 0; }
    }
  }

  const stats: Record<string, number> = { rooms: rooms.length, props: props.length, lights: lights.length, doors: doors.length, chasms, rugs: rugs.length, pillars: pillars.length, blocking: props.filter((p) => p.block).length };
  return { theme, w, d, tile, cells, floor, decor, variant, roomOf, rooms, props, lights, doors, rugs, stairsUp, stairsDown, pillars, blocked, start: D.start, exit: D.exit, key: D.key, boss: D.boss, stats };
}
