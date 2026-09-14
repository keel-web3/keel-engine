// Biomes: data, picked from CLIMATE the way Minecraft's multi-noise does it.
// A world has five climate fields (climate.ts): temperature, humidity,
// continentalness, erosion and weirdness. Each land biome names a POINT in
// that space (plus, optionally, the heights it may stand at); a tile wears the
// nearest biome's look -- so the table is Whittaker's diagram as data, and a
// pack adds a biome by adding a point (contract "biome/<id>@1"), no code.
//
// A biome says everything a world needs from it:
//   ground     tile materials with weights (patches by a noise partition)
//   relief     height shaping: steps added, hills' amplitude, terracing
//   foliage    scatter rules by layer (canopy, understory, shrub, grass,
//              flower, rock), with groves, forest cover and edges
//   surface    the ground's palette ramps: tint, own colours, decals, petals
//   water      its water's colour, rivers (width) and lakes (chance)
//   ambient    particle and sound hooks, a music mood
//
// TRANSITIONS (beach, stony shore, river banks, treeline) are rules on the
// same fields -- not biomes to be placed: a beach is where land meets sea
// low and warm, a treeline where the forest climbs toward the peaks.
//
// ACTS (Diablo's) are curated subsets: a level or region generated "in act
// 2" only ever picks from the act's biomes (the nearest of those), and its
// dungeons wear the act's tile theme.

import type { SurfaceBiome } from "@keel-engine/terrain";

export type FoliageLayer = "canopy" | "understory" | "shrub" | "grass" | "flower" | "rock";
export const FOLIAGE_LAYERS: readonly FoliageLayer[] = ["canopy", "understory", "shrub", "grass", "flower", "rock"];
/** Each layer's Poisson radius (metres) and the order they're placed in (a canopy trunk keeps lower layers off it). */
export const LAYER_SPACING: Readonly<Record<FoliageLayer, number>> = { canopy: 3.4, understory: 2.3, shrub: 1.6, grass: 0.62, flower: 0.9, rock: 3 };

export interface FoliageRule {
  readonly layer: FoliageLayer;
  /** The pack's object id ("oak"). */
  readonly object: string;
  /** Default "packs/foliage". */
  readonly pack?: string;
  /** Among the layer's rules that may grow at a point. */
  readonly weight: number;
  /** 0..1: how many of the layer's candidates it keeps, before the forest field. */
  readonly density: number;
  /** Terrain types it grows on (default: any dry, unpaved land). */
  readonly on?: readonly string[];
  readonly scale?: readonly [number, number];
  /** 0..1: how strongly it keeps to its own groves (a birch stand in an oak wood). */
  readonly grove?: number;
  /** Where in the forest field: its core (big trees), its edge (shrubs), the open (grass, flowers), anywhere. */
  readonly where?: "core" | "edge" | "open" | "any";
  /** Only within this many tiles of water (reeds); negative: at least that far. */
  readonly water?: number;
  readonly pins?: Readonly<Record<string, string | number | boolean>>;
}

export interface BiomeDef {
  readonly id: string;
  /** land (by climate), ocean (under the sea), or a transition's own look (beach, shore, river). */
  readonly kind?: "land" | "ocean" | "beach" | "shore" | "river" | "underground";
  /** Its point in climate space (each -1..1). */
  readonly climate: { readonly temperature: number; readonly humidity: number; readonly erosion?: number; readonly weirdness?: number };
  /** Steps it may stand at (land): peaks only high, marsh only low. */
  readonly height?: { readonly min?: number; readonly max?: number };
  /** Height shaping: steps added, hills' amplitude (1 as default), terraces (0..1: flattens between steps). */
  readonly relief?: { readonly base?: number; readonly amp?: number; readonly mountains?: number };
  /** Tile materials and their shares. */
  readonly ground: ReadonlyArray<{ readonly type: string; readonly weight: number }>;
  /** Under water, at the waterline, on the steep bits, above the snowline. */
  readonly bed?: string;
  readonly shore?: string;
  readonly steep?: string;
  readonly snowline?: number;
  /** 0..1: how much of it is forest (the forest field's threshold). */
  readonly forest?: number;
  readonly foliage: readonly FoliageRule[];
  /** The ground palette's look for it (surface.ts SurfaceBiome, less the name). */
  readonly surface?: Omit<SurfaceBiome, "name">;
  readonly water?: { readonly hue?: number; readonly chroma?: number };
  /** River width scale (0: none here) and a lake's chance per lake cell. */
  readonly rivers?: number;
  readonly lakes?: number;
  readonly ambient?: { readonly particles?: readonly string[]; readonly sound?: readonly string[] };
  readonly music?: string;
  readonly tags?: readonly string[];
}

const F = "packs/foliage";
const r = (layer: FoliageLayer, object: string, weight: number, density: number, extra: Partial<FoliageRule> = {}): FoliageRule => ({ layer, object, pack: F, weight, density, ...extra });

// A temperate floor the grass layers share.
const MEADOW_GRASS = [r("grass", "grass", 1, 0.22, { where: "open", scale: [0.8, 1.3], grove: 0.6 }), r("flower", "flowers", 1, 0.05, { where: "open", grove: 0.9 })];

/** The engine's biomes. Append-only by id; a pack adds its own (packs.ts). */
export const DEFAULT_BIOMES: readonly BiomeDef[] = [
  // ---- under the sea
  { id: "ocean", kind: "ocean", climate: { temperature: 0, humidity: 0 }, ground: [{ type: "sand", weight: 1 }], bed: "sand", foliage: [], water: { hue: 222, chroma: 0.1 }, ambient: { sound: ["waves"] } },
  { id: "warm-ocean", kind: "ocean", climate: { temperature: 0.7, humidity: 0.3 }, ground: [{ type: "sand", weight: 1 }], bed: "sand", foliage: [], water: { hue: 196, chroma: 0.12 }, ambient: { sound: ["waves"] } },
  { id: "frozen-ocean", kind: "ocean", climate: { temperature: -0.75, humidity: 0 }, ground: [{ type: "gravel", weight: 1 }], bed: "gravel", foliage: [], water: { hue: 214, chroma: 0.06 }, ambient: { sound: ["wind"] } },
  // ---- transitions' looks
  {
    id: "beach", kind: "beach", climate: { temperature: 0.3, humidity: 0 }, ground: [{ type: "sand", weight: 1 }], bed: "sand",
    foliage: [r("rock", "rock", 1, 0.06, { scale: [0.3, 0.6] }), r("grass", "grass", 1, 0.08, { scale: [0.8, 1.1] })],
    surface: { decals: { pebbles: 0.4 } }, ambient: { sound: ["waves", "gulls"] },
  },
  { id: "stony-shore", kind: "shore", climate: { temperature: -0.2, humidity: 0 }, ground: [{ type: "gravel", weight: 0.6 }, { type: "rock", weight: 0.4 }], bed: "gravel", foliage: [r("rock", "rock", 1, 0.3, { scale: [0.5, 1.4] })], ambient: { sound: ["waves"] } },
  { id: "river", kind: "river", climate: { temperature: 0, humidity: 0.5 }, ground: [{ type: "gravel", weight: 0.5 }, { type: "sand", weight: 0.5 }], bed: "gravel", foliage: [r("shrub", "reeds", 1, 0.5, { water: 1 })], ambient: { sound: ["stream"] } },
  // ---- land
  {
    id: "plains", climate: { temperature: 0.15, humidity: -0.15, erosion: 0.4 }, relief: { amp: 0.6 },
    ground: [{ type: "grass", weight: 0.85 }, { type: "dirt", weight: 0.1 }, { type: "moss", weight: 0.05 }], forest: 0.12,
    foliage: [r("canopy", "oak", 1, 0.5, { where: "core", scale: [0.8, 1.2], grove: 0.4 }), r("shrub", "bush", 1, 0.25, { where: "edge" }), ...MEADOW_GRASS, r("rock", "rock", 1, 0.04, { scale: [0.5, 1] })],
    surface: { petals: [350, 52, 280], decals: { flowers: 1.6 } }, ambient: { particles: ["pollen"], sound: ["birds", "wind"] }, music: "pastoral",
  },
  {
    id: "forest", climate: { temperature: 0.2, humidity: 0.35 }, relief: { amp: 0.9 },
    ground: [{ type: "litter", weight: 0.5 }, { type: "grass", weight: 0.3 }, { type: "moss", weight: 0.2 }], forest: 0.72,
    foliage: [
      r("canopy", "oak", 3, 0.9, { where: "core", scale: [0.85, 1.35], grove: 0.6 }), r("canopy", "birch", 1.4, 0.9, { where: "any", scale: [0.8, 1.2], grove: 0.9 }),
      r("understory", "bush", 1, 0.55, { where: "edge" }), r("understory", "stump", 0.15, 0.3), r("understory", "log", 0.12, 0.3),
      r("shrub", "bush", 1, 0.3, { where: "edge", scale: [0.5, 0.9] }), r("shrub", "mushroom", 0.1, 0.2, { where: "core", scale: [0.2, 0.3] }),
      r("grass", "grass", 1, 0.14, { where: "open", grove: 0.6 }), r("flower", "flowers", 1, 0.03, { where: "open", grove: 0.8 }), r("rock", "rock", 1, 0.06, { scale: [0.5, 1.1] }),
    ],
    surface: { tint: { hue: 4, chroma: 1.05, light: 0.96 }, decals: { leaves: 1.2 } }, ambient: { particles: ["leaves", "fireflies"], sound: ["birds", "leaves"] }, music: "woodland",
  },
  {
    id: "birch-forest", climate: { temperature: 0.05, humidity: 0.15, weirdness: 0.55 }, relief: { amp: 0.8 },
    ground: [{ type: "grass", weight: 0.55 }, { type: "litter", weight: 0.35 }, { type: "moss", weight: 0.1 }], forest: 0.6,
    foliage: [r("canopy", "birch", 3, 0.85, { where: "any", scale: [0.85, 1.25], grove: 0.3 }), r("understory", "bush", 1, 0.4, { where: "edge" }), ...MEADOW_GRASS, r("rock", "rock", 1, 0.04)],
    surface: { tint: { hue: 12, chroma: 0.95, light: 1.04 }, petals: [60, 0, 300] }, ambient: { particles: ["pollen"], sound: ["birds"] }, music: "woodland",
  },
  {
    id: "dark-forest", climate: { temperature: 0.3, humidity: 0.75, weirdness: -0.6 }, relief: { amp: 0.9 },
    ground: [{ type: "moss", weight: 0.5 }, { type: "litter", weight: 0.35 }, { type: "mud", weight: 0.15 }], forest: 0.88,
    foliage: [
      r("canopy", "oak", 2, 0.95, { where: "core", scale: [1.1, 1.5] }), r("canopy", "mushroom", 0.6, 0.8, { where: "core", grove: 0.9, scale: [0.7, 1.2] }),
      r("understory", "log", 0.3, 0.4), r("understory", "stump", 0.3, 0.4), r("shrub", "mushroom", 0.5, 0.3, { scale: [0.2, 0.35] }), r("shrub", "bush", 0.6, 0.3, { where: "edge" }),
      r("grass", "grass", 1, 0.15, { where: "open" }), r("rock", "rock", 1, 0.08),
    ],
    surface: { tint: { hue: -10, chroma: 0.9, light: 0.82 }, decals: { leaves: 1.5, flowers: 0.3 }, petals: [280, 200, 320] }, ambient: { particles: ["spores", "fireflies"], sound: ["owls", "wind"] }, music: "eerie",
  },
  {
    id: "swamp", climate: { temperature: 0.45, humidity: 0.95, erosion: 0.8 }, height: { max: 3 }, relief: { base: -1, amp: 0.35 }, lakes: 1.6,
    ground: [{ type: "mud", weight: 0.45 }, { type: "moss", weight: 0.35 }, { type: "grass", weight: 0.2 }], forest: 0.45,
    foliage: [
      r("canopy", "dead-tree", 1, 0.5, { where: "core", scale: [0.9, 1.3] }), r("canopy", "oak", 0.6, 0.4, { where: "core", scale: [0.8, 1.1] }),
      r("shrub", "reeds", 2, 0.7, { water: 2 }), r("shrub", "mushroom", 0.3, 0.2, { scale: [0.2, 0.3] }), r("grass", "grass", 1, 0.4), r("understory", "log", 0.2, 0.3),
    ],
    surface: { tint: { hue: 18, chroma: 0.8, light: 0.9 }, colours: { grass: { h: 110, C: 0.08 } } }, water: { hue: 150, chroma: 0.07 }, ambient: { particles: ["fireflies", "mist"], sound: ["frogs", "insects"] }, music: "bog",
  },
  {
    id: "jungle", climate: { temperature: 0.85, humidity: 0.8 }, relief: { amp: 1.1 },
    ground: [{ type: "grass", weight: 0.5 }, { type: "moss", weight: 0.3 }, { type: "mud", weight: 0.2 }], forest: 0.85,
    foliage: [
      r("canopy", "palm", 2, 0.9, { where: "any", scale: [0.9, 1.4], grove: 0.5 }), r("canopy", "oak", 1, 0.8, { where: "core", scale: [1.1, 1.5] }),
      r("understory", "bush", 2, 0.8), r("shrub", "bush", 1, 0.5, { scale: [0.5, 0.9] }), r("grass", "grass", 1, 0.22, { grove: 0.5 }), r("flower", "flowers", 1, 0.06, { grove: 0.8 }),
    ],
    surface: { tint: { hue: -6, chroma: 1.2, light: 0.94 }, petals: [330, 20, 45] }, water: { hue: 180, chroma: 0.1 }, ambient: { particles: ["fireflies"], sound: ["parrots", "insects"] }, music: "tribal",
  },
  {
    id: "savanna", climate: { temperature: 0.65, humidity: -0.45, erosion: 0.3 }, relief: { amp: 0.6 },
    ground: [{ type: "grass", weight: 0.6 }, { type: "dirt", weight: 0.25 }, { type: "clay", weight: 0.15 }], forest: 0.1,
    foliage: [r("canopy", "oak", 1, 0.35, { where: "core", scale: [0.7, 1], pins: { crown: "wide" } }), r("shrub", "bush", 0.5, 0.15), r("grass", "grass", 1, 0.3, { scale: [1, 1.5], grove: 0.5 }), r("rock", "rock", 1, 0.08, { scale: [0.6, 1.4] })],
    surface: { tint: { hue: 16, chroma: 0.9, light: 1.04 }, colours: { grass: { h: 92, C: 0.1, L: [0.34, 0.8] } }, decals: { flowers: 0.2 }, petals: [40, 55, 20] }, ambient: { particles: ["dust"], sound: ["crickets", "wind"] }, music: "plains",
  },
  {
    id: "desert", climate: { temperature: 0.95, humidity: -0.9 }, relief: { amp: 0.5 }, rivers: 0.5, lakes: 0.2,
    ground: [{ type: "sand", weight: 0.85 }, { type: "sandstone", weight: 0.1 }, { type: "clay", weight: 0.05 }], forest: 0,
    foliage: [r("shrub", "cactus", 1, 0.12, { scale: [0.8, 1.3] }), r("understory", "dead-tree", 0.3, 0.06), r("rock", "rock", 1, 0.07, { scale: [0.5, 1.3] }), r("grass", "grass", 1, 0.05, { scale: [0.7, 1] })],
    surface: { tint: { hue: 6, chroma: 1, light: 1.05 }, decals: { pebbles: 0.6 } }, water: { hue: 190, chroma: 0.12 }, ambient: { particles: ["sand"], sound: ["wind"] }, music: "desert",
  },
  {
    id: "badlands", climate: { temperature: 0.8, humidity: -0.6, erosion: -0.5 }, relief: { base: 1, amp: 1.2, mountains: 1.3 },
    ground: [{ type: "clay", weight: 0.55 }, { type: "sandstone", weight: 0.35 }, { type: "sand", weight: 0.1 }], forest: 0, steep: "sandstone",
    foliage: [r("understory", "dead-tree", 0.5, 0.08), r("shrub", "cactus", 0.5, 0.05), r("rock", "rock", 1, 0.14, { scale: [0.6, 1.6] })],
    surface: { tint: { hue: -2, chroma: 0.95, light: 1 }, colours: { clay: { h: 45, C: 0.085 } }, decals: { cracks: 1.4 } }, ambient: { particles: ["dust"], sound: ["wind"] }, music: "desert",
  },
  {
    id: "taiga", climate: { temperature: -0.45, humidity: 0.3 }, relief: { amp: 1 },
    ground: [{ type: "litter", weight: 0.4 }, { type: "grass", weight: 0.3 }, { type: "moss", weight: 0.2 }, { type: "snow", weight: 0.1 }], forest: 0.7,
    foliage: [r("canopy", "pine", 3, 0.9, { where: "any", scale: [0.85, 1.35], grove: 0.3 }), r("understory", "bush", 0.5, 0.3, { where: "edge" }), r("understory", "log", 0.2, 0.3), r("grass", "grass", 1, 0.3), r("rock", "rock", 1, 0.1)],
    surface: { tint: { hue: -14, chroma: 0.85, light: 0.97 }, colours: { grass: { h: 150 } }, decals: { flowers: 0.2 }, petals: [220, 270, 0] }, water: { hue: 214, chroma: 0.08 }, ambient: { particles: ["snow"], sound: ["wind", "owls"] }, music: "north",
  },
  {
    id: "cold-steppe", climate: { temperature: -0.45, humidity: -0.35 }, relief: { amp: 0.7 },
    ground: [{ type: "grass", weight: 0.6 }, { type: "gravel", weight: 0.18 }, { type: "moss", weight: 0.14 }, { type: "snow", weight: 0.08 }], forest: 0.1,
    foliage: [r("canopy", "pine", 1, 0.4, { where: "core", scale: [0.7, 1] }), r("shrub", "bush", 0.5, 0.15), r("grass", "grass", 1, 0.45), r("rock", "rock", 1, 0.1, { scale: [0.5, 1.2] })],
    surface: { tint: { hue: -12, chroma: 0.75, light: 1.02 }, colours: { grass: { h: 115, C: 0.08 } }, decals: { flowers: 0.3 }, petals: [240, 60, 0] }, ambient: { particles: ["snow"], sound: ["wind"] }, music: "north",
  },
  {
    id: "tundra", climate: { temperature: -0.85, humidity: -0.3 }, relief: { amp: 0.7 },
    ground: [{ type: "snow", weight: 0.6 }, { type: "gravel", weight: 0.2 }, { type: "moss", weight: 0.2 }], forest: 0.08, snowline: 0,
    foliage: [r("canopy", "pine", 1, 0.35, { where: "core", scale: [0.6, 0.9] }), r("understory", "dead-tree", 0.3, 0.1), r("rock", "rock", 1, 0.12, { scale: [0.5, 1.2] }), r("grass", "grass", 1, 0.12)],
    surface: { tint: { hue: -18, chroma: 0.7, light: 1.04 }, colours: { moss: { h: 170, C: 0.06 } } }, water: { hue: 210, chroma: 0.06 }, ambient: { particles: ["snow"], sound: ["wind"] }, music: "north",
  },
  {
    id: "mountains", climate: { temperature: -0.1, humidity: 0, erosion: -0.9 }, height: { min: 6 }, relief: { amp: 1.2, mountains: 1.2 },
    ground: [{ type: "rock", weight: 0.6 }, { type: "gravel", weight: 0.25 }, { type: "grass", weight: 0.15 }], forest: 0.25, snowline: 9, steep: "rock",
    foliage: [r("canopy", "pine", 1, 0.5, { where: "core", scale: [0.7, 1.1] }), r("rock", "rock", 1, 0.25, { scale: [0.6, 1.8] }), r("grass", "grass", 1, 0.15)],
    surface: { tint: { hue: -6, chroma: 0.85, light: 1 } }, ambient: { particles: ["mist"], sound: ["wind"] }, music: "heights",
  },
  {
    id: "alpine", climate: { temperature: -0.2, humidity: 0.1, erosion: -0.6 }, height: { min: 5, max: 8 },
    ground: [{ type: "grass", weight: 0.55 }, { type: "rock", weight: 0.25 }, { type: "moss", weight: 0.2 }], forest: 0.2, steep: "rock",
    foliage: [r("canopy", "pine", 1, 0.4, { where: "core", scale: [0.6, 0.95] }), ...MEADOW_GRASS, r("rock", "rock", 1, 0.12)],
    surface: { tint: { hue: -8, chroma: 0.9, light: 1.03 }, petals: [260, 55, 0], decals: { flowers: 1.3 } }, ambient: { particles: ["pollen"], sound: ["wind", "bells"] }, music: "heights",
  },
  {
    id: "snowy-peaks", climate: { temperature: -0.7, humidity: 0.2, erosion: -1 }, height: { min: 8 }, relief: { amp: 1.3, mountains: 1.4 },
    ground: [{ type: "snow", weight: 0.7 }, { type: "ice", weight: 0.15 }, { type: "rock", weight: 0.15 }], forest: 0, snowline: 0, steep: "rock",
    foliage: [r("rock", "rock", 1, 0.15, { scale: [0.6, 1.5] })],
    surface: { tint: { hue: -10, chroma: 0.7, light: 1.05 } }, ambient: { particles: ["snow"], sound: ["wind"] }, music: "heights",
  },
  {
    id: "volcanic", climate: { temperature: 0.9, humidity: -0.2, weirdness: 0.95 }, relief: { base: 1, amp: 1.2, mountains: 1.2 },
    ground: [{ type: "ash", weight: 0.6 }, { type: "rock", weight: 0.3 }, { type: "lava", weight: 0.1 }], forest: 0.05, steep: "rock",
    foliage: [r("understory", "dead-tree", 1, 0.15), r("rock", "rock", 1, 0.2, { scale: [0.6, 1.6] }), r("shrub", "crystal", 0.2, 0.06, { scale: [0.4, 0.8] })],
    surface: { tint: { hue: -12, chroma: 0.85, light: 0.92 } }, water: { hue: 30, chroma: 0.05 }, ambient: { particles: ["embers", "ash"], sound: ["rumble"] }, music: "inferno", tags: ["act:4"],
  },
  {
    id: "alien", climate: { temperature: 0.4, humidity: 0.5, weirdness: 1 }, relief: { amp: 1.1 },
    ground: [{ type: "grass", weight: 0.45 }, { type: "crystal", weight: 0.2 }, { type: "moss", weight: 0.35 }], forest: 0.5,
    foliage: [r("canopy", "alien-tree", 2, 0.8, { where: "core", scale: [0.8, 1.3], grove: 0.5 }), r("canopy", "mushroom", 1, 0.6, { where: "any", grove: 0.8 }), r("shrub", "crystal", 1, 0.25, { scale: [0.4, 1] }), r("grass", "grass", 1, 0.2, { grove: 0.5 }), r("flower", "flowers", 1, 0.05, { grove: 0.8 })],
    surface: { tint: { hue: 150, chroma: 1.1, light: 1 }, petals: [180, 60, 300] }, water: { hue: 300, chroma: 0.12 }, ambient: { particles: ["spores"], sound: ["hum"] }, music: "alien",
  },
  // ---- underground (dungeon floors wear these: never picked by the overworld's climate)
  { id: "crypt", kind: "underground", climate: { temperature: 0, humidity: 0 }, ground: [{ type: "flagstone", weight: 1 }], foliage: [], surface: { tint: { hue: 28, chroma: 1.3, light: 1.02 }, colours: { flagstone: { h: 60, C: 0.035 }, brick: { h: 40, C: 0.04 } }, decals: { bones: 3 } }, ambient: { particles: ["dust"], sound: ["drips"] }, music: "crypt" },
  { id: "tomb", kind: "underground", climate: { temperature: 0.8, humidity: -0.8 }, ground: [{ type: "sandstone", weight: 1 }], foliage: [], surface: { tint: { hue: 6, chroma: 1.1, light: 1.02 }, decals: { bones: 2 } }, ambient: { particles: ["sand"], sound: ["wind"] }, music: "tomb" },
  { id: "ice-cave", kind: "underground", climate: { temperature: -0.9, humidity: 0 }, ground: [{ type: "ice", weight: 1 }], foliage: [], surface: { tint: { hue: -6, chroma: 1, light: 1.03 } }, ambient: { particles: ["snow"], sound: ["drips"] }, music: "north" },
  { id: "abyss", kind: "underground", climate: { temperature: 1, humidity: -0.5 }, ground: [{ type: "ash", weight: 1 }], foliage: [], surface: { tint: { hue: -18, chroma: 1.2, light: 0.95 }, colours: { rock: { h: 20, C: 0.04 } }, decals: { bones: 2 } }, ambient: { particles: ["embers"], sound: ["rumble"] }, music: "inferno" },
  {
    id: "corruption", climate: { temperature: 0.5, humidity: 0, weirdness: -1.2 }, height: { min: 99 },
    ground: [{ type: "creep", weight: 0.75 }, { type: "ash", weight: 0.25 }], forest: 0.15, steep: "rock",
    foliage: [r("canopy", "dead-tree", 1, 0.4, { where: "core" }), r("shrub", "crystal", 1, 0.2, { scale: [0.4, 0.9] }), r("rock", "rock", 1, 0.1)],
    surface: { tint: { hue: 14, chroma: 0.75, light: 0.86 }, colours: { grass: { h: 95, C: 0.06 }, moss: { h: 90, C: 0.05 } }, petals: [300, 320, 280] }, water: { hue: 300, chroma: 0.1 }, ambient: { particles: ["spores", "embers"], sound: ["drone"] }, music: "blight", tags: ["creep"],
  },
];

/** Acts: curated biome sets (and the tile theme a dungeon of the act wears: dungeon.ts THEMES). */
export interface ActDef { readonly id: string; readonly name: string; readonly biomes: readonly string[]; readonly theme: string }
export const DEFAULT_ACTS: readonly ActDef[] = [
  { id: "act1", name: "The Verdant March", biomes: ["ocean", "beach", "river", "plains", "forest", "birch-forest", "dark-forest", "swamp", "alpine", "mountains"], theme: "crypt" },
  { id: "act2", name: "The Burning Sands", biomes: ["warm-ocean", "beach", "river", "desert", "badlands", "savanna", "jungle", "mountains"], theme: "tomb" },
  { id: "act3", name: "The Frozen Reach", biomes: ["frozen-ocean", "stony-shore", "river", "taiga", "cold-steppe", "tundra", "alpine", "mountains", "snowy-peaks"], theme: "ice" },
  { id: "act4", name: "The Blight", biomes: ["ocean", "stony-shore", "river", "volcanic", "alien", "corruption", "badlands", "mountains"], theme: "hell" },
];

// ---------------------------------------------------------------- the table

export interface Climate {
  /** -1..1 each. */
  readonly temperature: number;
  readonly humidity: number;
  readonly continentalness: number;
  readonly erosion: number;
  readonly weirdness: number;
}

export interface BiomeTable {
  readonly list: readonly BiomeDef[];
  /** Index by id; throws on an unknown one. */
  index(id: string): number;
  get(id: string | number): BiomeDef;
  has(id: string): boolean;
  /**
   * The land biome nearest a climate point (among `allowed`, when given), and
   * the runner-up with how close the call was (0: on the border, 1: deep in).
   */
  nearest(c: Climate, height: number | null, allowed?: ReadonlySet<number> | null): { first: number; second: number; edge: number };
  /** The biomes as the ground's surface sees them (index = biome index). */
  surfaceBiomes(): SurfaceBiome[];
  /** A table restricted to an act (the same indices; `allowed` for nearest()). */
  allowedFor(ids: readonly string[] | null): ReadonlySet<number> | null;
  /** The first biome of a kind among `allowed` nearest in temperature (oceans, beaches). */
  ofKind(kind: NonNullable<BiomeDef["kind"]>, temperature: number, allowed?: ReadonlySet<number> | null): number;
}

/** A table over biome definitions (the defaults, plus packs'). Ids must be unique; at most 250. */
export function createBiomeTable(defs: readonly BiomeDef[] = DEFAULT_BIOMES): BiomeTable {
  if (defs.length > 250) throw new RangeError("At most 250 biomes.");
  const byId = new Map<string, number>();
  defs.forEach((d, i) => { if (byId.has(d.id)) throw new RangeError(`Two biomes called "${d.id}".`); byId.set(d.id, i); });
  const land = defs.map((d, i) => ((d.kind ?? "land") === "land" ? i : -1)).filter((i) => i >= 0);
  const dist = (d: BiomeDef, c: Climate): number => {
    const p = d.climate;
    const dt = c.temperature - p.temperature, dh = c.humidity - p.humidity;
    const de = p.erosion === undefined ? 0 : (c.erosion - p.erosion) * 0.6;
    const dw = p.weirdness === undefined ? (Math.abs(c.weirdness) > 0.75 ? (Math.abs(c.weirdness) - 0.75) * 1.2 : 0) : (c.weirdness - p.weirdness) * 0.9;
    return dt * dt * 1.2 + dh * dh + de * de + dw * dw;
  };
  const table: BiomeTable = {
    list: defs,
    index(id) { const i = byId.get(id); if (i === undefined) throw new RangeError(`No biome "${id}" (${[...byId.keys()].join(", ")}).`); return i; },
    get: (id) => defs[typeof id === "number" ? id : table.index(id)]!,
    has: (id) => byId.has(id),
    nearest(c, height, allowed = null) {
      let first = -1, second = -1, d1 = Infinity, d2 = Infinity;
      for (const i of land) {
        if (allowed && !allowed.has(i)) continue;
        const d = defs[i]!;
        if (height !== null && ((d.height?.min ?? -Infinity) > height || (d.height?.max ?? Infinity) < height)) continue;
        const e = dist(d, c);
        if (e < d1) { second = first; d2 = d1; first = i; d1 = e; } else if (e < d2) { second = i; d2 = e; }
      }
      if (first < 0) first = land[0] ?? 0;
      if (second < 0) second = first;
      // (How deep inside its region: the gap between the two distances, in climate units.)
      const edge = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) / 0.25);
      return { first, second, edge };
    },
    surfaceBiomes: () => defs.map((d) => ({ name: d.id, ...(d.surface ?? {}) })),
    allowedFor(ids) { return ids ? new Set(ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!)) : null; },
    ofKind(kind, temperature, allowed = null) {
      let best = -1, bd = Infinity;
      defs.forEach((d, i) => {
        if ((d.kind ?? "land") !== kind || (allowed && !allowed.has(i))) return;
        const e = Math.abs(d.climate.temperature - temperature);
        if (e < bd) { bd = e; best = i; }
      });
      if (best < 0) defs.forEach((d, i) => { if (best < 0 && (d.kind ?? "land") === kind) best = i; });
      return best;
    },
  };
  return table;
}
