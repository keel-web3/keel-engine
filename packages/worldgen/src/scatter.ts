// Foliage scatter: where plants stand, by layer, the same whichever chunk
// asks. Each layer (canopy, understory, shrub, grass, flower, rock) is its
// own BLUE-NOISE set: one candidate per cell of a grid the layer's spacing
// across, jittered, with a hashed priority; a candidate stands if no
// candidate within the spacing has a higher priority. That needs only the
// hashes of the neighbouring cells -- never another chunk's results -- so the
// sets are chunk-independent and still Poisson-disc-like.
//
// Then the rules (the biome's FoliageRule list, per layer) decide what grows:
//
//   the FOREST FIELD   low-frequency noise against the biome's forest cover:
//                      0 in clearings and open land, 1 in a forest's core;
//                      its edge (0.5) is where shrubs and understory crowd.
//                      Big old trees in the core (age), young at the edge.
//   GROVES             each species has its own slow noise: a birch stand
//                      inside an oak wood (a rule's `grove` says how much).
//   MOISTURE & SLOPE   reeds within a few tiles of water; trees and bushes
//                      off cliff edges and ramps.
//   EXCLUSION          roads, paths, paving, water, bridges, ramps, blocked
//                      tiles (buildings), structures' ground, spawns and
//                      resources (an `exclude` callback), dark dungeon floor.
//   LAYER ORDER        a canopy trunk keeps the lower layers a little off it.
//
// Instances carry a seed (their look and shape pick), an age, a scale and a
// yaw. What draws them is the game's: tier and zoom tell it which layers
// matter (drawLayersFor).

import { FLAG, WATER_NONE } from "@keel-engine/terrain";
import type { TerrainTable } from "@keel-engine/terrain";
import { FOLIAGE_LAYERS, LAYER_SPACING } from "./biomes.ts";
import type { BiomeTable, FoliageLayer, FoliageRule } from "./biomes.ts";
import type { TileLayers } from "./map.ts";
import { fbm, hash01, hashU32, seedOf } from "./noise.ts";

export interface PlantInstance {
  readonly layer: FoliageLayer;
  readonly pack: string;
  readonly object: string;
  /** World metres; y the ground's. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly yaw: number;
  /** 0 young .. 1 old. */
  readonly age: number;
  /** For the plant's own shape and look pick. */
  readonly seed: number;
  readonly biome: number;
  readonly pins?: Readonly<Record<string, string | number | boolean>>;
}

export interface ScatterOptions {
  readonly seed: string;
  readonly table: BiomeTable;
  readonly types: TerrainTable;
  readonly tileSize?: number;
  readonly stepHeight?: number;
  /** Only these layers (default all). */
  readonly layers?: readonly FoliageLayer[];
  /** A density scale over every rule (default 1). */
  readonly density?: number;
  /** World tiles nothing grows on (spawns, resources, a player's base). */
  readonly exclude?: ((i: number, j: number) => boolean) | null;
  /** Remap a biome for foliage (a swap: the corrupted forest grows the corruption's plants). */
  readonly biomeOf?: ((i: number, j: number, biome: number) => number) | null;
}

// Ground nothing grows on.
const PAVED = new Set(["road", "path", "flagstone", "brick", "lava", "ice"]);

/**
 * Plants standing in a world-metre rectangle [x0, z0, x1, z1), from tile
 * layers that cover it and a margin of at least 3 tiles (water distance and
 * the canopy's reach read round it).
 */
export function scatterIn(L: TileLayers, rect: readonly [number, number, number, number], opts: ScatterOptions): PlantInstance[] {
  const { table, types } = opts;
  const ts = opts.tileSize ?? 2, sh = opts.stepHeight ?? 1;
  const dens = opts.density ?? 1;
  const layers = opts.layers ?? FOLIAGE_LAYERS;
  const base = seedOf(opts.seed, "scatter");
  const paved = new Uint8Array(types.list.length);
  types.list.forEach((t, i) => { if (PAVED.has(t.name) || t.cost === 0) paved[i] = 1; });
  const typeName = types.list.map((t) => t.name);
  const at = (i: number, j: number): number => (i >= L.i0 && j >= L.j0 && i < L.i0 + L.w && j < L.j0 + L.d ? (j - L.j0) * L.w + (i - L.i0) : -1);
  const wet = (k: number): boolean => L.water[k] !== WATER_NONE && L.water[k]! > L.height[k]!;
  // Water distance (tiles, capped at 4), over the layers.
  const wd = new Uint8Array(L.w * L.d).fill(4);
  for (let k = 0; k < L.w * L.d; k += 1) if (wet(k)) wd[k] = 0;
  for (let pass = 0; pass < 4; pass += 1) for (let j = 0; j < L.d; j += 1) for (let i = 0; i < L.w; i += 1) {
    const k = j * L.w + i;
    let v = wd[k]!;
    if (i > 0) v = Math.min(v, wd[k - 1]! + 1); if (i < L.w - 1) v = Math.min(v, wd[k + 1]! + 1);
    if (j > 0) v = Math.min(v, wd[k - L.w]! + 1); if (j < L.d - 1) v = Math.min(v, wd[k + L.w]! + 1);
    wd[k] = v;
  }
  // A tile is level with its four neighbours (trees keep off cliff edges).
  const level = (k: number): boolean => {
    const i = (k % L.w), j = (k - i) / L.w, h = L.height[k]!;
    return (i === 0 || L.height[k - 1] === h) && (i === L.w - 1 || L.height[k + 1] === h) && (j === 0 || L.height[k - L.w] === h) && (j === L.d - 1 || L.height[k + L.w] === h);
  };
  const forestF = (x: number, z: number): number => fbm({ freq: 1 / 70, octaves: 3 }, x, z, base + 1);
  const groveF = (species: string, x: number, z: number): number => fbm({ freq: 1 / 46, octaves: 2 }, x, z, seedOf(opts.seed, `grove:${species}`));
  const smooth = (a: number, b: number, v: number): number => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  const out: PlantInstance[] = [];
  const canopy: Array<[number, number]> = [];
  const [x0, z0, x1, z1] = rect;
  for (const layer of FOLIAGE_LAYERS) {
    if (!layers.includes(layer) && layer !== "canopy") continue;
    const r = LAYER_SPACING[layer];
    const ls = seedOf(opts.seed, `layer:${layer}`);
    const cand = (cx: number, cz: number): [number, number, number] => [(cx + 0.15 + hash01(cx, cz, ls) * 0.7) * r, (cz + 0.15 + hash01(cx, cz, ls + 1) * 0.7) * r, hash01(cx, cz, ls + 2)];
    const c0 = Math.floor(x0 / r) - (layer === "canopy" ? 2 : 0), c1 = Math.floor((x1 - 1e-9) / r) + (layer === "canopy" ? 2 : 0);
    const d0 = Math.floor(z0 / r) - (layer === "canopy" ? 2 : 0), d1 = Math.floor((z1 - 1e-9) / r) + (layer === "canopy" ? 2 : 0);
    const emit = layers.includes(layer);
    for (let cz = d0; cz <= d1; cz += 1) for (let cx = c0; cx <= c1; cx += 1) {
      const [x, z, p] = cand(cx, cz);
      // (The canopy is also looked at a little outside the rectangle: its trunks keep lower layers off.)
      const inside = x >= x0 && x < x1 && z >= z0 && z < z1;
      if (!inside && layer !== "canopy") continue;
      // Blue noise: no candidate within r has a higher priority.
      let top = true;
      for (let dz = -1; dz <= 1 && top; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dz) continue;
        const [qx, qz, qp] = cand(cx + dx, cz + dz);
        if (qp > p && (qx - x) ** 2 + (qz - z) ** 2 < r * r) { top = false; break; }
      }
      if (!top) continue;
      const ti = Math.floor(x / ts), tj = Math.floor(z / ts);
      const k = at(ti, tj);
      if (k < 0) continue;
      if (wet(k) || paved[L.type[k]!] || L.flags[k]! & (FLAG.BLOCKED | FLAG.BRIDGE | FLAG.RAMP) || L.zone[k]! >= 200 || L.light[k]! < 200) continue;
      if (opts.exclude && opts.exclude(ti, tj)) continue;
      const tall = layer === "canopy" || layer === "understory" || layer === "shrub" || layer === "rock";
      if (tall && !level(k)) continue;
      let b = L.biome[k]!;
      if (opts.biomeOf) b = opts.biomeOf(ti, tj, b);
      const bd = table.list[b];
      if (!bd) continue;
      const rules = bd.foliage.filter((ru) => ru.layer === layer);
      if (!rules.length) continue;
      if (layer !== "canopy" && layer !== "grass" && layer !== "flower" && canopy.some(([cxm, czm]) => (cxm - x) ** 2 + (czm - z) ** 2 < 1.6 * 1.6)) continue;
      // The forest field: 0 open, 1 core; the edge peaks between.
      const cover = bd.forest ?? 0.3;
      const F = forestF(x, z);
      const fc = smooth(1 - cover - 0.1, 1 - cover + 0.1, F);
      const edge = 1 - Math.abs(2 * fc - 1);
      let total = 0;
      const ws: number[] = [];
      for (const ru of rules) {
        let w = ru.weight;
        const where = ru.where ?? (layer === "canopy" ? "core" : "any");
        if (where === "core") w *= fc * fc;
        else if (where === "edge") w *= 0.25 + edge * 1.5;
        else if (where === "open") w *= 1 - fc * 0.85;
        if (ru.grove) w *= 1 - ru.grove + ru.grove * smooth(0.35, 0.65, groveF(ru.object, x, z)) * 2;
        if (ru.on && !ru.on.includes(typeName[L.type[k]!]!)) w = 0;
        if (ru.water !== undefined && (ru.water >= 0 ? wd[k]! > ru.water : wd[k]! < -ru.water)) w = 0;
        ws.push(w); total += w;
      }
      if (total <= 0) continue;
      // Which rule, and whether it keeps this candidate (its density, weighted by how well the place suits it).
      let ticket = hash01(cx, cz, ls + 3) * total;
      let pick = 0;
      for (; pick < rules.length - 1; pick += 1) { ticket -= ws[pick]!; if (ticket < 0) break; }
      const rule: FoliageRule = rules[pick]!;
      const suit = Math.min(1, total / rules.reduce((a, ru) => a + ru.weight, 0) * 1.4);
      if (hash01(cx, cz, ls + 4) >= rule.density * dens * suit) continue;
      if (layer === "canopy") canopy.push([x, z]);
      if (!emit || !inside) continue;
      const age = layer === "canopy" || layer === "understory" ? Math.max(0.15, Math.min(1, 0.25 + fc * 0.55 + (hash01(cx, cz, ls + 5) - 0.5) * 0.5)) : hash01(cx, cz, ls + 5);
      const [sa, sb] = rule.scale ?? [0.85, 1.15];
      out.push({
        layer, pack: rule.pack ?? "packs/foliage", object: rule.object, x, y: L.height[k]! * sh, z,
        scale: sa + (sb - sa) * age, yaw: hash01(cx, cz, ls + 6) * Math.PI * 2, age, seed: hashU32(cx, cz, ls + 7), biome: b,
        ...(rule.pins ? { pins: rule.pins } : {}),
      });
    }
  }
  return out;
}

/** Which layers are worth drawing at a pixel scale (px/m): the small ones fade out as the view pulls back (the ground's decals carry them). */
export function drawLayersFor(pixelsPerMetre: number): FoliageLayer[] {
  const k = pixelsPerMetre;
  return FOLIAGE_LAYERS.filter((l) => (l === "grass" || l === "flower" ? k >= 6 : l === "shrub" ? k >= 3 : l === "understory" || l === "rock" ? k >= 2 : true));
}
