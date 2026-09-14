// A generated map: tile layers in structure-of-arrays typed arrays (the
// terrain's own, plus what generation knows that the terrain doesn't: each
// tile's biome, its light, the underground layer, ore, which stage wrote it),
// and the things generation placed (houses, props, lights, entrances,
// resources, spawns). Every generator writes into one; toTerrain() and
// intoLevel() hand it to keel/terrain and keel/level.
//
// A map covers tiles [i0, i0 + w) x [j0, j0 + d) of the world: a finite map
// starts at (0, 0); an infinite world's chunk block starts wherever it is.

import { FLAG, WATER_NONE, createTerrain, terrainTypes } from "@keel-engine/terrain";
import type { Terrain, TerrainTable } from "@keel-engine/terrain";

/** Ore / resource kinds in the ore layer (0: none). */
export const ORES = ["", "mass", "crystal", "flux"] as const;
export type OreKind = "mass" | "crystal" | "flux";

export interface TileLayers {
  /** The world tile at index 0. */
  readonly i0: number;
  readonly j0: number;
  readonly w: number;
  readonly d: number;
  readonly height: Int16Array;
  readonly type: Uint8Array;
  readonly water: Int16Array;
  readonly flags: Uint8Array;
  readonly dir: Uint8Array;
  /** The biome table's index. */
  readonly biome: Uint8Array;
  /** 0..255: how lit (dungeons' torches; 255 in daylight). */
  readonly light: Uint8Array;
  /** The underground layer: 0 solid, 1 open (caves), 2 water. */
  readonly under: Uint8Array;
  /** Ore under or at the surface (ORES index). */
  readonly ore: Uint8Array;
  /** Which stage (its index + 1) last wrote the tile; 0 none. */
  readonly zone: Uint8Array;
}

/** Something generation placed. Positions are world metres (y the ground's). */
export interface WorldThing {
  readonly id: string;
  readonly kind: "building" | "prop" | "plant" | "light" | "entrance" | "resource" | "spawn" | "marker" | "door" | "key" | "boss" | "exit" | "start" | (string & {});
  readonly pack?: string;
  readonly object?: string;
  readonly pos: readonly [number, number, number];
  readonly yaw: number;
  readonly scale: number;
  /** Tiles it stands on and blocks [i0, j0, i1, j1) (world tiles), or null. */
  readonly footprint: readonly [number, number, number, number] | null;
  readonly tags: readonly string[];
  readonly data?: Readonly<Record<string, string | number | boolean>>;
}

export interface WorldMap extends TileLayers {
  readonly seed: string;
  readonly types: TerrainTable;
  readonly tileSize: number;
  readonly stepHeight: number;
  things: WorldThing[];
  /** Named rectangles (world tiles): rooms, the town, a stage's region. */
  regions: Array<{ readonly id: string; readonly kind: string; readonly rect: readonly [number, number, number, number]; readonly tags: readonly string[] }>;
  meta: Record<string, string | number | boolean>;
}

export function createLayers(i0: number, j0: number, w: number, d: number, types: TerrainTable, { fill = "grass", level = 0 }: { readonly fill?: string; readonly level?: number } = {}): TileLayers {
  const n = w * d;
  return {
    i0, j0, w, d,
    height: new Int16Array(n).fill(level), type: new Uint8Array(n).fill(types.id(fill)), water: new Int16Array(n).fill(WATER_NONE),
    flags: new Uint8Array(n), dir: new Uint8Array(n), biome: new Uint8Array(n), light: new Uint8Array(n).fill(255),
    under: new Uint8Array(n), ore: new Uint8Array(n), zone: new Uint8Array(n),
  };
}

export function createMap(spec: { readonly seed: string; readonly width: number; readonly depth: number; readonly i0?: number; readonly j0?: number; readonly types?: TerrainTable; readonly tileSize?: number; readonly stepHeight?: number; readonly fill?: string; readonly level?: number }): WorldMap {
  const types = spec.types ?? terrainTypes();
  const L = createLayers(spec.i0 ?? 0, spec.j0 ?? 0, spec.width, spec.depth, types, { fill: spec.fill ?? "grass", level: spec.level ?? 0 });
  return { ...L, seed: spec.seed, types, tileSize: spec.tileSize ?? 2, stepHeight: spec.stepHeight ?? 1, things: [], regions: [], meta: {} };
}

/** Copy every layer of a rectangle of `src` (world tiles) into `dst` where they overlap; `where(k)` filters by src index. */
export function blit(src: TileLayers, dst: TileLayers, where: ((k: number) => boolean) | null = null): number {
  const a0 = Math.max(src.i0, dst.i0), a1 = Math.min(src.i0 + src.w, dst.i0 + dst.w);
  const b0 = Math.max(src.j0, dst.j0), b1 = Math.min(src.j0 + src.d, dst.j0 + dst.d);
  let n = 0;
  for (let j = b0; j < b1; j += 1) for (let i = a0; i < a1; i += 1) {
    const s = (j - src.j0) * src.w + (i - src.i0), t = (j - dst.j0) * dst.w + (i - dst.i0);
    if (where && !where(s)) continue;
    dst.height[t] = src.height[s]!; dst.type[t] = src.type[s]!; dst.water[t] = src.water[s]!; dst.flags[t] = src.flags[s]!; dst.dir[t] = src.dir[s]!;
    dst.biome[t] = src.biome[s]!; dst.light[t] = src.light[s]!; dst.under[t] = src.under[s]!; dst.ore[t] = src.ore[s]!; dst.zone[t] = src.zone[s]!;
    n += 1;
  }
  return n;
}

/** A sub-rectangle of layers (world tiles), copied. */
export function cropLayers(src: TileLayers, i0: number, j0: number, w: number, d: number, types: TerrainTable): TileLayers {
  const out = createLayers(i0, j0, w, d, types);
  blit(src, out);
  return out;
}

/** A 32-bit hash of every layer the ground's picture depends on, over a rectangle (world tiles). */
export function hashLayers(L: TileLayers, i0: number, j0: number, i1: number, j1: number): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => { h = Math.imul(h ^ (v & 0xff), 0x01000193); h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193); };
  for (let j = Math.max(L.j0, j0); j < Math.min(L.j0 + L.d, j1); j += 1) for (let i = Math.max(L.i0, i0); i < Math.min(L.i0 + L.w, i1); i += 1) {
    const k = (j - L.j0) * L.w + (i - L.i0);
    mix(L.height[k]!); mix(L.type[k]!); mix(L.flags[k]! | (L.dir[k]! << 8)); mix(L.water[k]!); mix(L.biome[k]! | (L.light[k]! << 8));
  }
  return h >>> 0;
}

/**
 * Layers as a keel/terrain Terrain (the same tiles; its (0, 0) is the
 * layers' (i0, j0) -- bake it with `origin: [i0, j0]` so it lands on the
 * world's own pixels).
 */
export function toTerrain(L: TileLayers, { types = terrainTypes(), tileSize = 2, stepHeight = 1, chunk = 32, id = "world" }: { readonly types?: TerrainTable; readonly tileSize?: number; readonly stepHeight?: number; readonly chunk?: number; readonly id?: string } = {}): Terrain {
  const t = createTerrain({ width: L.w, depth: L.d, tileSize, stepHeight, chunk, types, id });
  t.height.set(L.height); t.type.set(L.type); t.water.set(L.water); t.flags.set(L.flags); t.dir.set(L.dir);
  // (A bridge deck's level isn't a worldgen layer: none are laid here.)
  for (let k = 0; k < L.w * L.d; k += 1) if (L.flags[k]! & FLAG.BRIDGE) t.flags[k] = L.flags[k]! & ~FLAG.BRIDGE;
  return t;
}

/** Write layers into an existing terrain (its tiles [i0, j0] onward); returns the tiles written. */
export function writeTerrain(L: TileLayers, t: Terrain, where: ((k: number) => boolean) | null = null): number {
  let n = 0;
  t.batch(() => {
    for (let j = 0; j < L.d; j += 1) for (let i = 0; i < L.w; i += 1) {
      const wi = L.i0 + i, wj = L.j0 + j;
      if (!t.inside(wi, wj)) continue;
      const k = j * L.w + i;
      if (where && !where(k)) continue;
      t.setHeight(wi, wj, L.height[k]!);
      t.setType(wi, wj, L.type[k]!);
      t.setWater(wi, wj, L.water[k] === WATER_NONE ? null : L.water[k]!);
      t.setRamp(wi, wj, L.flags[k]! & FLAG.RAMP ? L.dir[k]! : null);
      for (const f of [FLAG.BLOCKED, FLAG.NOBUILD, FLAG.RIVER]) t.setFlag(wi, wj, f, (L.flags[k]! & f) !== 0);
      n += 1;
    }
  });
  return n;
}
