// The terrain grid: tiles in structure-of-arrays typed arrays, cut into
// chunks (32 x 32 tiles by default) that the baker, the colliders and the
// editor work in. A tile has
//
//   height   integer steps (Int16): its top is at height x stepHeight metres
//   type     its ground (types.ts): grass, sand, rock ...
//   flags    FLAG.RAMP, BRIDGE, BLOCKED, NOBUILD, RIVER
//   dir      a ramp's uphill dir4; a bridge's axis (0: along z, 1: along x)
//   water    the water surface's level in steps (WATER_NONE: dry); deeper
//            than the ground by one step is shallow, two or more deep
//   deck     a bridge deck's level in steps (when BRIDGE)
//
// Tile (i, j) covers x in [i, i+1) x tileSize and z in [j, j+1) x tileSize.
// Every write marks the chunks whose picture or colliders it can change (its
// own and, near a border, its neighbours': the ground's edges, shores and
// outlines read two tiles round) and bumps their versions; listeners hear a
// change event per write (or one per batch).

import { DX4, DZ4, FLAG, WATER_NONE, terrainTypes } from "./types.ts";
import type { TerrainTable } from "./types.ts";

export interface TerrainSpec {
  /** Tiles across x and z. */
  readonly width: number;
  readonly depth: number;
  /** Metres a tile (default 2). */
  readonly tileSize?: number;
  /** Metres a height step (default 1). */
  readonly stepHeight?: number;
  /** Tiles a chunk side (default 32). */
  readonly chunk?: number;
  readonly types?: TerrainTable;
  /** The type everything starts as (default "grass"). */
  readonly fill?: string;
  /** The level everything starts at (default 0). */
  readonly level?: number;
  /** A name for bake keys (default "terrain"). */
  readonly id?: string;
}

/** A change: the chunks it touched, and the tile rectangle [i0, j0, i1, j1] (inclusive). */
export interface TerrainChange {
  readonly chunks: readonly number[];
  readonly rect: readonly [number, number, number, number];
}

/** A rectangle of tiles as plain arrays (undo, the editor's clipboard). */
export interface TilePatch {
  readonly i0: number;
  readonly j0: number;
  readonly w: number;
  readonly d: number;
  readonly height: Int16Array;
  readonly type: Uint8Array;
  readonly flags: Uint8Array;
  readonly dir: Uint8Array;
  readonly water: Int16Array;
  readonly deck: Int16Array;
}

export interface Terrain {
  readonly id: string;
  readonly width: number;
  readonly depth: number;
  readonly tileSize: number;
  readonly stepHeight: number;
  readonly chunk: number;
  readonly chunksX: number;
  readonly chunksZ: number;
  readonly types: TerrainTable;
  readonly height: Int16Array;
  readonly type: Uint8Array;
  readonly flags: Uint8Array;
  readonly dir: Uint8Array;
  readonly water: Int16Array;
  readonly deck: Int16Array;
  /** Per chunk: bumped on every change that can alter it. */
  readonly chunkVersion: Uint32Array;
  /** Bumped on every change. */
  readonly version: number;
  index(i: number, j: number): number;
  inside(i: number, j: number): boolean;
  /** The chunk index of a tile. */
  chunkOf(i: number, j: number): number;
  /** A chunk's tile rectangle [i0, j0, i1, j1) (end exclusive). */
  chunkRect(c: number): [number, number, number, number];

  setHeight(i: number, j: number, h: number): void;
  setType(i: number, j: number, type: number | string): void;
  setFlag(i: number, j: number, flag: number, on?: boolean): void;
  /** Make a ramp rising toward dir4 `dir` (null: not a ramp). */
  setRamp(i: number, j: number, dir: number | null): void;
  /** The water surface's level (null: dry). */
  setWater(i: number, j: number, level: number | null): void;
  /** A bridge deck at `level` along `axis` (0: z, 1: x); null: none. */
  setDeck(i: number, j: number, level: number | null, axis?: 0 | 1): void;
  /** Writes grouped into one change event. */
  batch<T>(fn: () => T): T;
  onChange(fn: (change: TerrainChange) => void): () => void;
  /** Chunks changed since the last call (and forget them). */
  takeDirty(): number[];

  isRamp(i: number, j: number): boolean;
  isBridge(i: number, j: number): boolean;
  /** Water depth in steps (0: dry). */
  waterDepth(i: number, j: number): number;
  /** The ground's top at a world point (ramps sloped; outside the map: the nearest tile). */
  heightAt(x: number, z: number): number;
  /** What stands at a world point: the tile, its ground height, the water's and the deck's (null where none). */
  surfaceAt(x: number, z: number): { i: number; j: number; ground: number; water: number | null; deck: number | null; type: number };
  /** Tile of a world point (clamped to the map). */
  tileAt(x: number, z: number): [number, number];
  /** The world point at a tile's centre (its ground height). */
  centre(i: number, j: number): [number, number, number];

  read(i0: number, j0: number, w: number, d: number): TilePatch;
  write(patch: TilePatch): void;
  clone(): Terrain;
}

export function createTerrain(spec: TerrainSpec): Terrain {
  const { width, depth, tileSize = 2, stepHeight = 1, chunk = 32, types = terrainTypes(), fill = "grass", level = 0, id = "terrain" } = spec;
  if (!Number.isInteger(width) || !Number.isInteger(depth) || width < 1 || depth < 1 || width > 4096 || depth > 4096) throw new RangeError("Terrain width and depth are whole numbers 1..4096.");
  if (!(tileSize > 0) || !(stepHeight > 0)) throw new RangeError("tileSize and stepHeight must be positive.");
  if (!Number.isInteger(chunk) || chunk < 4 || chunk > 256) throw new RangeError("chunk is a whole number 4..256.");
  const n = width * depth;
  const chunksX = Math.ceil(width / chunk);
  const chunksZ = Math.ceil(depth / chunk);
  const height = new Int16Array(n).fill(level);
  const type = new Uint8Array(n).fill(types.id(fill));
  const flags = new Uint8Array(n);
  const dir = new Uint8Array(n);
  const water = new Int16Array(n).fill(WATER_NONE);
  const deck = new Int16Array(n).fill(WATER_NONE);
  const chunkVersion = new Uint32Array(chunksX * chunksZ);
  return build({ id, width, depth, tileSize, stepHeight, chunk, types, height, type, flags, dir, water, deck, chunkVersion });
}

interface Arrays {
  id: string; width: number; depth: number; tileSize: number; stepHeight: number; chunk: number; types: TerrainTable;
  height: Int16Array; type: Uint8Array; flags: Uint8Array; dir: Uint8Array; water: Int16Array; deck: Int16Array; chunkVersion: Uint32Array;
}

// How far a tile's change reaches: the ground's edges, shores and outlines read two tiles round.
const REACH = 2;

function build(a: Arrays): Terrain {
  const { width, depth, tileSize, stepHeight, chunk, types, height, type, flags, dir, water, deck, chunkVersion } = a;
  const chunksX = Math.ceil(width / chunk);
  const chunksZ = Math.ceil(depth / chunk);
  let version = 0;
  const dirty = new Set<number>();
  const listeners = new Set<(c: TerrainChange) => void>();
  let batching = 0;
  let pending: Set<number> | null = null;
  let rect: [number, number, number, number] | null = null;

  const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < width && j < depth;
  const index = (i: number, j: number): number => j * width + i;
  const chunkOf = (i: number, j: number): number => Math.floor(j / chunk) * chunksX + Math.floor(i / chunk);

  function emit(chunks: Set<number>, r: [number, number, number, number]): void {
    if (!listeners.size) return;
    const change: TerrainChange = { chunks: [...chunks].sort((x, y) => x - y), rect: r };
    for (const fn of listeners) fn(change);
  }
  function touch(i: number, j: number): void {
    version += 1;
    const touched = new Set<number>();
    const ci0 = Math.max(0, Math.floor((i - REACH) / chunk)), ci1 = Math.min(chunksX - 1, Math.floor((i + REACH) / chunk));
    const cj0 = Math.max(0, Math.floor((j - REACH) / chunk)), cj1 = Math.min(chunksZ - 1, Math.floor((j + REACH) / chunk));
    for (let cj = cj0; cj <= cj1; cj += 1) for (let ci = ci0; ci <= ci1; ci += 1) {
      const c = cj * chunksX + ci;
      chunkVersion[c] = (chunkVersion[c]! + 1) >>> 0;
      dirty.add(c);
      touched.add(c);
    }
    if (batching) {
      for (const c of touched) pending!.add(c);
      rect = rect ? [Math.min(rect[0], i), Math.min(rect[1], j), Math.max(rect[2], i), Math.max(rect[3], j)] : [i, j, i, j];
    } else emit(touched, [i, j, i, j]);
  }
  const check = (i: number, j: number): number => {
    if (!inside(i, j)) throw new RangeError(`Tile ${i},${j} is off the map (${width} x ${depth}).`);
    return index(i, j);
  };
  const whole = (v: number, what: string): number => {
    if (!Number.isInteger(v) || v < -32767 || v > 32767) throw new RangeError(`${what} is a whole number of steps (got ${v}).`);
    return v;
  };

  // A ramp's ground height at a fraction (u, v) across its tile (0..1 along x and z).
  function rampLift(k: number, u: number, v: number): number {
    const d = dir[k]!;
    return d === 0 ? v : d === 1 ? u : d === 2 ? 1 - v : 1 - u;
  }

  const t: Terrain = {
    id: a.id, width, depth, tileSize, stepHeight, chunk, chunksX, chunksZ, types,
    height, type, flags, dir, water, deck, chunkVersion,
    get version() { return version; },
    index, inside, chunkOf,
    chunkRect: (c) => { const ci = c % chunksX, cj = Math.floor(c / chunksX); return [ci * chunk, cj * chunk, Math.min(width, (ci + 1) * chunk), Math.min(depth, (cj + 1) * chunk)]; },

    setHeight(i, j, h) { const k = check(i, j); whole(h, "height"); if (height[k] === h) return; height[k] = h; touch(i, j); },
    setType(i, j, ty) { const k = check(i, j); const v = types.id(ty); if (type[k] === v) return; type[k] = v; touch(i, j); },
    setFlag(i, j, flag, on = true) { const k = check(i, j); const v = on ? flags[k]! | flag : flags[k]! & ~flag; if (v === flags[k]) return; flags[k] = v; touch(i, j); },
    setRamp(i, j, d) {
      const k = check(i, j);
      if (d === null) { if (!(flags[k]! & FLAG.RAMP)) return; flags[k] = flags[k]! & ~FLAG.RAMP; touch(i, j); return; }
      if (!Number.isInteger(d) || d < 0 || d > 3) throw new RangeError("A ramp's dir is 0..3 (n, e, s, w).");
      if ((flags[k]! & FLAG.RAMP) && dir[k] === d && !(flags[k]! & FLAG.BRIDGE)) return;
      flags[k] = (flags[k]! | FLAG.RAMP) & ~FLAG.BRIDGE;
      dir[k] = d;
      touch(i, j);
    },
    setWater(i, j, lv) { const k = check(i, j); const v = lv === null ? WATER_NONE : whole(lv, "water level"); if (water[k] === v) return; water[k] = v; touch(i, j); },
    setDeck(i, j, lv, axis = 0) {
      const k = check(i, j);
      if (lv === null) { if (!(flags[k]! & FLAG.BRIDGE)) return; flags[k] = flags[k]! & ~FLAG.BRIDGE; deck[k] = WATER_NONE; touch(i, j); return; }
      whole(lv, "deck level");
      flags[k] = (flags[k]! | FLAG.BRIDGE) & ~FLAG.RAMP;
      deck[k] = lv;
      dir[k] = axis;
      touch(i, j);
    },
    batch(fn) {
      if (batching === 0) { pending = new Set(); rect = null; }
      batching += 1;
      try { return fn(); } finally {
        batching -= 1;
        if (batching === 0) { const p = pending!, r = rect; pending = null; rect = null; if (r && p.size) emit(p, r); }
      }
    },
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    takeDirty() { const out = [...dirty].sort((x, y) => x - y); dirty.clear(); return out; },

    isRamp: (i, j) => inside(i, j) && (flags[index(i, j)]! & FLAG.RAMP) !== 0,
    isBridge: (i, j) => inside(i, j) && (flags[index(i, j)]! & FLAG.BRIDGE) !== 0,
    waterDepth(i, j) { if (!inside(i, j)) return 0; const k = index(i, j); const w = water[k]!; return w === WATER_NONE ? 0 : Math.max(0, w - height[k]!); },
    tileAt(x, z) { return [Math.max(0, Math.min(width - 1, Math.floor(x / tileSize))), Math.max(0, Math.min(depth - 1, Math.floor(z / tileSize)))]; },
    heightAt(x, z) {
      const [i, j] = t.tileAt(x, z);
      const k = index(i, j);
      let lv = height[k]!;
      if (flags[k]! & FLAG.RAMP) {
        const u = Math.max(0, Math.min(1, x / tileSize - i)), v = Math.max(0, Math.min(1, z / tileSize - j));
        lv += rampLift(k, u, v);
      }
      return lv * stepHeight;
    },
    surfaceAt(x, z) {
      const [i, j] = t.tileAt(x, z);
      const k = index(i, j);
      return {
        i, j, ground: t.heightAt(x, z), type: type[k]!,
        water: water[k] === WATER_NONE ? null : water[k]! * stepHeight,
        deck: flags[k]! & FLAG.BRIDGE ? deck[k]! * stepHeight : null,
      };
    },
    centre: (i, j) => { const x = (i + 0.5) * tileSize, z = (j + 0.5) * tileSize; return [x, t.heightAt(x, z), z]; },

    read(i0, j0, w, d) {
      const p: TilePatch = { i0, j0, w, d, height: new Int16Array(w * d), type: new Uint8Array(w * d), flags: new Uint8Array(w * d), dir: new Uint8Array(w * d), water: new Int16Array(w * d), deck: new Int16Array(w * d) };
      for (let dj = 0; dj < d; dj += 1) for (let di = 0; di < w; di += 1) {
        const k = check(i0 + di, j0 + dj), o = dj * w + di;
        p.height[o] = height[k]!; p.type[o] = type[k]!; p.flags[o] = flags[k]!; p.dir[o] = dir[k]!; p.water[o] = water[k]!; p.deck[o] = deck[k]!;
      }
      return p;
    },
    write(p) {
      t.batch(() => {
        for (let dj = 0; dj < p.d; dj += 1) for (let di = 0; di < p.w; di += 1) {
          const i = p.i0 + di, j = p.j0 + dj, k = check(i, j), o = dj * p.w + di;
          if (height[k] === p.height[o] && type[k] === p.type[o] && flags[k] === p.flags[o] && dir[k] === p.dir[o] && water[k] === p.water[o] && deck[k] === p.deck[o]) continue;
          height[k] = p.height[o]!; type[k] = p.type[o]!; flags[k] = p.flags[o]!; dir[k] = p.dir[o]!; water[k] = p.water[o]!; deck[k] = p.deck[o]!;
          touch(i, j);
        }
      });
    },
    clone: () => build({ ...a, height: height.slice(), type: type.slice(), flags: flags.slice(), dir: dir.slice(), water: water.slice(), deck: deck.slice(), chunkVersion: chunkVersion.slice() }),
  };
  return t;
}

/** The dir4 neighbour of a tile (or null off the map). */
export function neighbour(t: Pick<Terrain, "inside">, i: number, j: number, d: number): [number, number] | null {
  const ni = i + DX4[d]!, nj = j + DZ4[d]!;
  return t.inside(ni, nj) ? [ni, nj] : null;
}

/**
 * A 32-bit hash (FNV-1a) of every tile in a rectangle (clamped to the map):
 * what a chunk's bake key carries, so an unchanged chunk keeps its bake
 * whatever else was edited.
 */
export function hashTiles(t: Terrain, i0: number, j0: number, i1: number, j1: number): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => { h = Math.imul(h ^ (v & 0xff), 0x01000193); h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193); };
  for (let j = Math.max(0, j0); j < Math.min(t.depth, j1); j += 1) for (let i = Math.max(0, i0); i < Math.min(t.width, i1); i += 1) {
    const k = j * t.width + i;
    mix(t.height[k]!); mix(t.type[k]!); mix(t.flags[k]! | (t.dir[k]! << 8)); mix(t.water[k]!); mix(t.deck[k]!);
  }
  return h >>> 0;
}
