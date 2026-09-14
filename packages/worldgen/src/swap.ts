// BIOME SWAPPING, three ways.
//
//   RE-SKIN     a region (or the whole map) becomes another biome and keeps
//               its SHAPE: the same heights and water, the new biome's
//               materials (its ground partition at each tile), beds, steep
//               ground, palette ramps and foliage. reskin() on tile layers;
//               the "biome@1" stage in a recipe.
//   SEASONS     the same layout in other colours: seasonPaletteFor() gives
//               the ground palette of a season (a palette upload: nothing
//               rebakes), foliageProfile() the look profile a plant wears
//               (looks are painted at draw time: nothing rebakes either).
//   AT RUNTIME  corruption spreading, an RTS race's creep terraforming the
//               ground: createBiomePainter() paints tiles of a live terrain
//               (types and the surface's biome map) and spreads a front a
//               step at a time. The terrain marks the chunks a write
//               reaches; the ground baker's keys follow the tiles and the
//               biome map, so only those chunks rebake (README: measured).

import { FLAG, SEASONS, WATER_NONE, seasonPalette } from "@keel-engine/terrain";
import type { GroundPalette, GroundPaletteOptions, Terrain, TerrainTable } from "@keel-engine/terrain";
import type { BiomeTable } from "./biomes.ts";
import type { TileLayers } from "./map.ts";
import { fbm, hash01, rngOf, seedOf } from "./noise.ts";

const PAVED = new Set(["road", "path", "flagstone", "brick"]);

/** The material a biome's ground partition gives a tile (the overworld's own rule, on the re-skin's seed). */
export function groundTypeAt(table: BiomeTable, types: TerrainTable, biome: number, i: number, j: number, seed: number): number {
  const b = table.list[biome]!;
  const total = b.ground.reduce((a, g) => a + g.weight, 0) || 1;
  const n = fbm({ freq: 1 / 15, octaves: 2 }, i, j, seed + biome * 7);
  const x = Math.max(0, Math.min(0.999, (n - 0.5) * 2.2 + 0.5));
  let acc = 0;
  for (const g of b.ground) { acc += g.weight / total; if (x < acc) return types.has(g.type) ? types.id(g.type) : types.id("grass"); }
  const last = b.ground[b.ground.length - 1];
  return last && types.has(last.type) ? types.id(last.type) : types.id("grass");
}

/**
 * Re-skin tiles of layers to a biome, keeping heights and water: each tile in
 * `where` takes the biome's ground (its bed under water, its steep type on
 * steep ground), and its biome index. Paved tiles (roads, paths, paving,
 * walls) keep theirs unless `keepPaved` is false. Returns the tiles changed.
 */
export function reskin(L: TileLayers, table: BiomeTable, types: TerrainTable, to: string, where: (i: number, j: number) => boolean, { seed = "reskin", keepPaved = true }: { readonly seed?: string; readonly keepPaved?: boolean } = {}): number {
  const b = table.index(to), def = table.list[b]!;
  const s = seedOf(seed, "reskin:ground");
  const paved = new Set([...PAVED].filter((n) => types.has(n)).map((n) => types.id(n)));
  const bed = types.has(def.bed ?? "") ? types.id(def.bed!) : null;
  const steep = def.steep && types.has(def.steep) ? types.id(def.steep) : null;
  let n = 0;
  for (let j = 0; j < L.d; j += 1) for (let i = 0; i < L.w; i += 1) {
    const wi = L.i0 + i, wj = L.j0 + j;
    if (!where(wi, wj)) continue;
    const k = j * L.w + i;
    if (keepPaved && paved.has(L.type[k]!)) { L.biome[k] = b; continue; }
    const underwater = L.water[k] !== WATER_NONE && L.water[k]! > L.height[k]!;
    let ty = underwater && bed !== null ? bed : groundTypeAt(table, types, b, wi, wj, s);
    if (!underwater && steep !== null) {
      const h = L.height[k]!;
      const nb = [i > 0 ? L.height[k - 1]! : h, i < L.w - 1 ? L.height[k + 1]! : h, j > 0 ? L.height[k - L.w]! : h, j < L.d - 1 ? L.height[k + L.w]! : h];
      if (nb.some((v) => Math.abs(v - h) >= 2)) ty = steep;
    }
    if (L.type[k] !== ty || L.biome[k] !== b) n += 1;
    L.type[k] = ty; L.biome[k] = b;
  }
  return n;
}

/** A season's ground palette for a biome table (the same layout as every other season's: swap it in, rebake nothing). */
export function seasonPaletteFor(types: TerrainTable, table: BiomeTable, season: string, opts: GroundPaletteOptions = {}): GroundPalette {
  const s = SEASONS[season];
  if (!s) throw new RangeError(`No season "${season}" (${Object.keys(SEASONS).join(", ")}).`);
  return seasonPalette(types, table.surfaceBiomes(), s, opts);
}

// Which foliage look profile (packs/foliage's profiles) a biome's plants wear; temperate ones follow the season.
const PROFILE_OF: Readonly<Record<string, string>> = {
  savanna: "dry", desert: "desert", badlands: "dry", jungle: "tropical", alien: "alien", "dark-forest": "fungal", swamp: "fungal",
  volcanic: "ash", corruption: "ash", tundra: "ice", "snowy-peaks": "ice", "cold-steppe": "winter", beach: "tropical",
};
/** The look profile a plant in `biome` wears in `season` (a look: painted, never baked). */
export function foliageProfile(biome: string, season: string): string {
  const own = PROFILE_OF[biome];
  if (own) return season === "winter" && own !== "tropical" && own !== "desert" ? (own === "ice" ? "ice" : "winter") : own;
  return SEASONS[season] ? season : "summer";
}

// ---------------------------------------------------------------- at runtime

export interface BiomePainter {
  /** Paint tiles (terrain indices) as a biome: types by its ground, the biome map. Returns the chunks touched. */
  paint(tiles: readonly number[], biome: string): number[];
  /**
   * Spread a biome from where it already is (or from `seeds`): each step every
   * tile of the front takes a neighbour with chance `rate` (a ragged noise
   * front). Returns the tiles taken this call.
   */
  spread(biome: string, { steps, rate, seeds, limit }?: { readonly steps?: number; readonly rate?: number; readonly seeds?: readonly number[]; readonly limit?: number }): number[];
  /** How many tiles are that biome now. */
  count(biome: string): number;
}

/**
 * Paint biomes into a live terrain (keel/terrain) and its biome map (the
 * ground surface's `biome` array, mutated in place). Heights and water stay:
 * a re-skin, tile by tile. Walls, water and paving never change.
 */
export function createBiomePainter({ terrain: t, biome, table, seed = "paint" }: { readonly terrain: Terrain; readonly biome: Uint8Array; readonly table: BiomeTable; readonly seed?: string }): BiomePainter {
  const s = seedOf(seed, "paint:ground");
  const f = rngOf(seedOf(seed, "paint:spread"));
  const paved = new Set([...PAVED].filter((n) => t.types.has(n)).map((n) => t.types.id(n)));
  const W = t.width;
  const paintable = (k: number): boolean => !paved.has(t.type[k]!) && !(t.flags[k]! & (FLAG.BLOCKED | FLAG.BRIDGE)) && t.waterDepth(k % W, Math.floor(k / W)) === 0;
  const paint = (tiles: readonly number[], name: string): number[] => {
    const b = table.index(name);
    const touched = new Set<number>();
    const off = t.onChange((c) => { for (const x of c.chunks) touched.add(x); });
    t.batch(() => {
      for (const k of tiles) {
        if (k < 0 || k >= t.width * t.depth || !paintable(k)) continue;
        const i = k % W, j = (k - i) / W;
        biome[k] = b;
        t.setType(i, j, groundTypeAt(table, t.types, b, i, j, s));
        // (A biome-only change still has to reach the baker: the surface's key hashes the biome map per chunk.)
        touched.add(t.chunkOf(i, j));
      }
    });
    off();
    return [...touched].sort((x, y) => x - y);
  };
  return {
    paint,
    spread(name, { steps = 1, rate = 0.35, seeds = [], limit = Infinity } = {}) {
      const b = table.index(name);
      const taken: number[] = [];
      for (const k of seeds) if (k >= 0 && k < biome.length && paintable(k) && biome[k] !== b) { taken.push(k); biome[k] = b; }
      let front: number[] = [];
      for (let k = 0; k < biome.length; k += 1) if (biome[k] === b) {
        const i = k % W, j = (k - i) / W;
        if ((i > 0 && biome[k - 1] !== b) || (i < W - 1 && biome[k + 1] !== b) || (j > 0 && biome[k - W] !== b) || (j < t.depth - 1 && biome[k + W] !== b)) front.push(k);
      }
      for (let step = 0; step < steps && taken.length < limit; step += 1) {
        const next: number[] = [];
        for (const k of front) {
          const i = k % W, j = (k - i) / W;
          for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
            if (a < 0 || c < 0 || a >= W || c >= t.depth) continue;
            const q = c * W + a;
            if (biome[q] === b || !paintable(q)) continue;
            // (A ragged front: noise decides where it pushes ahead and where it lags.)
            const push = rate * (0.35 + 1.3 * fbm({ freq: 1 / 9, octaves: 2 }, a, c, s + 17)) * (0.6 + 0.8 * hash01(a, c, s + step));
            if (f() < push) { biome[q] = b; next.push(q); taken.push(q); }
          }
        }
        front = next.concat(front.filter(() => f() < 0.7));
      }
      paint(taken, name);
      return taken;
    },
    count(name) { const b = table.index(name); let n = 0; for (let k = 0; k < biome.length; k += 1) if (biome[k] === b) n += 1; return n; },
  };
}
