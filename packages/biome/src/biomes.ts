// Earth's biomes as data. Each says how the land lies, what covers the ground,
// what grows where, and the light and wind it stands in. Colours are in the
// ballpark of the real places; a biome is a spec you can copy and change, and
// defineBiome adds your own.

import type { ColorRepresentation } from "@keel-engine/lit";
import type { ShellKind } from "@keel-engine/flora";
import type { Relief } from "./relief.ts";

export type Ramp = readonly [ColorRepresentation, ColorRepresentation, ColorRepresentation, ColorRepresentation];

/** Where a ground layer lies; every condition given must hold. */
export interface GroundRule {
  /** Metres above the biome's zero. */
  readonly height?: readonly [number, number];
  /** Rise over run. */
  readonly slope?: readonly [number, number];
  /** Metres above the water (needs water). */
  readonly shore?: readonly [number, number];
  /** Blotches: their size in metres, and how much they cover (0..1). */
  readonly patches?: readonly [number, number];
}

export interface GroundLayer {
  readonly name: string;
  readonly ramp: Ramp;
  readonly pattern?: "flat" | "noise" | "speckle" | "cobble" | "ripple" | "tufts" | "stripes";
  readonly scale?: number;
  readonly when?: GroundRule;
  /** Its 3D overlay: colours default to the ramp's. */
  readonly shell?: { readonly kind: ShellKind; readonly scale?: number; readonly height?: number; readonly give?: number };
}

export interface PlantRule {
  readonly kind: string;
  /** Plants per 100 square metres. */
  readonly per100: number;
  /** Height range, metres. */
  readonly size: readonly [number, number];
  readonly wide?: number;
  /** Ground layers it grows on (default any). */
  readonly on?: readonly string[];
  readonly height?: readonly [number, number];
  /** Steepest ground it takes (default 0.9). */
  readonly slope?: number;
  /** in: stands in the water; float: on it; shore: at its edge; dry (default): above it. */
  readonly water?: "dry" | "shore" | "in" | "float";
  /** Grows in stands this many metres across. */
  readonly stand?: number;
  readonly tints?: readonly ColorRepresentation[];
  readonly blooms?: readonly ColorRepresentation[];
  /** Hangs rather than stands: from the boughs of whatever is tall here, or with `on`, this far up a cliff. */
  readonly hangFrom?: number;
  /** Big enough for hangers to hang from (listed before them). */
  readonly bears?: boolean;
}

export interface TreeRule {
  /** A keel tree-growth species. */
  readonly species: string;
  readonly per100: number;
  readonly on?: readonly string[];
}

export interface BiomeLight {
  readonly sun: ColorRepresentation;
  readonly power: number;
  readonly sky: ColorRepresentation;
  readonly earth: ColorRepresentation;
  readonly fog: ColorRepresentation;
  /** Where the fog begins and closes, metres. */
  readonly haze: readonly [number, number];
}

export interface BiomeSpec {
  readonly id: string;
  readonly label: string;
  /** Mean temperature in Celsius and rain in mm a year: where it sits on Whittaker's chart. */
  readonly climate: { readonly temperature: number; readonly rain: number };
  readonly relief: Relief;
  readonly water?: { readonly level: number; readonly color: ColorRepresentation; readonly clarity?: number };
  /** Ground layers, base first (eight at most). */
  readonly ground: readonly GroundLayer[];
  /** Height of the 3D ground in metres. */
  readonly depth?: number;
  readonly plants: readonly PlantRule[];
  /** Sprite ground cover: kind weights, plants per square metre, on which layers. */
  readonly cover?: { readonly kinds: Readonly<Record<string, number>>; readonly per1: number; readonly on: readonly string[]; readonly size: readonly [number, number]; readonly tints: readonly ColorRepresentation[]; readonly blooms?: readonly ColorRepresentation[] };
  /** Vines over the rocks. */
  readonly vines?: { readonly per100: number; readonly on: string; readonly tint: ColorRepresentation; readonly bloom?: ColorRepresentation };
  readonly trees?: readonly TreeRule[];
  readonly light: BiomeLight;
  /** Usual wind, 0..1. */
  readonly wind: number;
}

const FRESH = ["#5f8f3e", "#74a548", "#4f7f3a"], DEEP = ["#2f6a34", "#3a7a3c", "#28583a"], SAGE = ["#8d9c7c", "#9aa78a", "#7c8a70"], GOLD = ["#b9a658", "#c9b76a", "#a8964e"], WET = ["#4a7a44", "#5a8a48", "#3e6a42"], COLD = ["#5e7a4c", "#6e8452", "#4e6a48"];
const shade = (a: ColorRepresentation, b: ColorRepresentation, c: ColorRepresentation, d: ColorRepresentation): Ramp => [a, b, c, d];

const SOIL = shade("#3a2a20", "#4e3a2a", "#604836", "#725842"), LOAM = shade("#2e2218", "#3e2e20", "#4e3c2c", "#604a36");
const SAND = shade("#b89a62", "#cfb47c", "#e0c992", "#efdfb0"), RED_SAND = shade("#8e4a2a", "#a95c34", "#c07444", "#d48c58"), GREY_SAND = shade("#8a8678", "#a29e8e", "#b8b4a4", "#cecabc");
const GRASS = shade("#3e6a2e", "#4f7f36", "#62933e", "#78a84a"), DARK_GRASS = shade("#23452a", "#2f5832", "#3c6a38", "#4c7c40"), DRY_GRASS = shade("#8a7a44", "#a08e50", "#b6a35e", "#c9b76e"), STEPPE = shade("#7c7a50", "#908c5c", "#a3a068", "#b6b276");
const ROCK = shade("#55524e", "#6c6965", "#84807b", "#9c9892"), DARK_ROCK = shade("#2a282c", "#37353a", "#47454a", "#59565c"), RED_ROCK = shade("#6e3a26", "#8a4a2e", "#a65e3a", "#c07a50");
const SNOW = shade("#d6e2ec", "#e4ecf3", "#f0f5f9", "#fbfdff"), ICE = shade("#7fb0c8", "#9cc6d8", "#bcdce8", "#dcf0f6");
const MUD = shade("#2e261c", "#3e3324", "#4e422e", "#5e5038"), PEAT = shade("#20180f", "#2c2216", "#3a2e1e", "#483a26"), SALT = shade("#c8c4b8", "#dcd8cc", "#ece8dc", "#fbf9f0");
const MOSS = shade("#2a4a26", "#3a6030", "#4c7a38", "#609044"), LICHEN = shade("#6a7056", "#808668", "#969c78", "#b0b48c"), LITTER = shade("#4a3220", "#6a4628", "#8a5c30", "#a8743a");
const ASH = shade("#1e1c1e", "#2a282a", "#383538", "#484448");

const DAY: BiomeLight = { sun: "#fff2dc", power: 3, sky: "#dbe9ff", earth: "#6e6a5c", fog: "#c6dbe8", haze: [30, 110] };
const light = (o: Partial<BiomeLight>): BiomeLight => ({ ...DAY, ...o });
const FLOWERS = ["#f4f0e4", "#f2b6c8", "#b7a6f0", "#f5c84c", "#ef8a6a"];

export const BIOMES: Record<string, BiomeSpec> = {
  rainforest: {
    id: "rainforest", label: "Tropical rainforest", climate: { temperature: 26, rain: 3200 }, relief: { kind: "hills", amp: 3, scale: 26 }, wind: 0.12, depth: 0.16,
    ground: [{ name: "soil", ramp: LOAM, pattern: "speckle", shell: { kind: "litter", scale: 7, height: 0.5, give: 0.2 } }, { name: "moss", ramp: MOSS, pattern: "noise", when: { patches: [7, 0.45] }, shell: { kind: "moss", scale: 5, give: 0.2 } }, { name: "stone", ramp: DARK_ROCK, pattern: "noise", when: { slope: [0.8, 9] } }],
    plants: [{ kind: "monstera", per100: 7, size: [0.8, 1.6], on: ["soil", "moss"], stand: 6 }, { kind: "banana", per100: 2.5, size: [2.2, 3.6], stand: 8 }, { kind: "tree-fern", per100: 2.5, size: [2, 3.4] }, { kind: "fern", per100: 16, size: [0.5, 1], stand: 5, tints: DEEP }, { kind: "taro", per100: 7, size: [0.8, 1.4], stand: 5, tints: DEEP }, { kind: "heliconia", per100: 3, size: [1, 1.7], blooms: ["#d8342a", "#f0a030"] }, { kind: "bromeliad", per100: 4, size: [0.3, 0.5], blooms: ["#e0407a"] }, { kind: "orchid", per100: 3, size: [0.4, 0.6], blooms: ["#d97ad8", "#f4f0e4"] }, { kind: "mossy-log", per100: 0.7, size: [0.5, 0.7], wide: 1.2, tints: DEEP }, { kind: "bracket", per100: 2, size: [0.12, 0.2], blooms: ["#d8944a"] }, { kind: "liana", per100: 9, size: [2.5, 4.5], hangFrom: 5.5, tints: DEEP }, { kind: "aerial-roots", per100: 3, size: [2, 3.5], hangFrom: 5 }, { kind: "mossy-boulder", per100: 1, size: [0.5, 1.1], tints: DEEP }],
    vines: { per100: 1, on: "mossy-boulder", tint: "#3a7a3c" }, trees: [{ species: "mango", per100: 1 }, { species: "fig", per100: 0.8 }, { species: "palm", per100: 0.4 }],
    light: light({ sun: "#ffe8b8", power: 2, sky: "#c6e0b8", earth: "#2c3a22", fog: "#8fae84", haze: [10, 62] }),
  },
  monsoon: {
    id: "monsoon", label: "Monsoon forest", climate: { temperature: 25, rain: 1800 }, relief: { kind: "hills", amp: 4, scale: 28 }, wind: 0.2,
    ground: [{ name: "soil", ramp: RED_SAND, pattern: "speckle", shell: { kind: "litter", scale: 6, height: 0.6, give: 0.2 } }, { name: "grass", ramp: GRASS, pattern: "tufts", when: { patches: [8, 0.5] }, shell: { kind: "fuzz", scale: 24, height: 0.7 } }],
    plants: [{ kind: "bamboo", per100: 3, size: [4, 7], stand: 9 }, { kind: "banana", per100: 1.5, size: [2, 3] }, { kind: "fern", per100: 7, size: [0.5, 0.9] }, { kind: "taro", per100: 5, size: [0.7, 1.2], stand: 4 }, { kind: "cycad", per100: 1.5, size: [1, 1.8] }, { kind: "lily", per100: 3, size: [0.6, 1], blooms: ["#f08a30", "#f4f0e4"], stand: 4 }, { kind: "boulder", per100: 0.5, size: [0.5, 1] }],
    trees: [{ species: "mango", per100: 0.8 }], light: light({ sun: "#ffe2b0", power: 2.4, fog: "#b8c8a8", haze: [16, 78] }),
  },
  mangrove: {
    id: "mangrove", label: "Mangrove coast", climate: { temperature: 27, rain: 2200 }, relief: { kind: "hummocks", amp: 0.8, scale: 13 }, water: { level: 0.02, color: "#4a6a58", clarity: 0.72 }, wind: 0.22, depth: 0.1,
    ground: [{ name: "mud", ramp: MUD, pattern: "noise", shell: { kind: "mounds", scale: 2.4, height: 0.6, give: 0 } }, { name: "sand", ramp: GREY_SAND, pattern: "speckle", when: { shore: [0.12, 9] } }],
    plants: [{ kind: "mangrove", per100: 4, size: [2.2, 4.4], wide: 1.1, water: "shore", tints: DEEP, stand: 12, bears: true }, { kind: "sedge", per100: 4, size: [0.5, 0.8], water: "shore" }, { kind: "driftwood", per100: 0.5, size: [0.2, 0.3], wide: 0.9 }, { kind: "aerial-roots", per100: 2.5, size: [1, 1.8], hangFrom: 2.2 }],
    light: light({ sun: "#fff0c8", power: 2.8, sky: "#d4ecec", fog: "#cfe2d8", haze: [18, 90] }),
  },
  swamp: {
    id: "swamp", label: "Cypress swamp", climate: { temperature: 19, rain: 1400 }, relief: { kind: "hummocks", amp: 1, scale: 11 }, water: { level: 0.05, color: "#39402a", clarity: 0.82 }, wind: 0.08, depth: 0.14,
    ground: [{ name: "peat", ramp: PEAT, pattern: "noise", shell: { kind: "mounds", scale: 3, height: 0.5, give: 0 } }, { name: "moss", ramp: MOSS, pattern: "noise", when: { shore: [0.04, 9], patches: [4, 0.7] }, shell: { kind: "moss", scale: 6, give: 0.2 } }, { name: "sedges", ramp: DARK_GRASS, pattern: "tufts", when: { shore: [0.15, 9] }, shell: { kind: "fuzz", scale: 20, height: 0.8 } }],
    plants: [{ kind: "cattail", per100: 22, size: [1.2, 1.9], water: "shore", stand: 6 }, { kind: "reed", per100: 11, size: [1.3, 2.1], water: "shore", stand: 5 }, { kind: "sedge", per100: 13, size: [0.5, 0.9], water: "shore" }, { kind: "palmetto", per100: 5, size: [0.9, 1.5], stand: 7 }, { kind: "water-lily", per100: 9, size: [0.7, 1.1], water: "float", stand: 6, blooms: ["#f4f0e4", "#f2b6c8"] }, { kind: "lily-pad", per100: 18, size: [0.6, 1], water: "float", stand: 6 }, { kind: "horsetail", per100: 8, size: [0.4, 0.8], water: "shore" }, { kind: "pitcher-plant", per100: 3, size: [0.3, 0.5], blooms: ["#8a3a46", "#a8bf5a"], on: ["moss"] }, { kind: "mossy-log", per100: 0.8, size: [0.5, 0.7], wide: 1.1, tints: WET }, { kind: "spanish-moss", per100: 8, size: [1.2, 2.3], hangFrom: 3.8 }, { kind: "bolete", per100: 3, size: [0.14, 0.25], blooms: ["#a8743a"] }, { kind: "stump", per100: 0.6, size: [0.4, 0.9], water: "shore", tints: WET }],
    trees: [{ species: "willow", per100: 0.9, on: ["moss", "sedges"] }],
    light: light({ sun: "#efe6b8", power: 1.7, sky: "#b8c6a8", earth: "#2a2a1c", fog: "#a4ae88", haze: [8, 50] }),
  },
  bog: {
    id: "bog", label: "Peat bog", climate: { temperature: 7, rain: 1100 }, relief: { kind: "hummocks", amp: 0.9, scale: 9 }, water: { level: -0.08, color: "#2e2a1c", clarity: 0.9 }, wind: 0.35, depth: 0.14,
    ground: [{ name: "peat", ramp: PEAT, pattern: "noise" }, { name: "sphagnum", ramp: shade("#6a7a2a", "#8a8e32", "#a89a3a", "#c0a84a"), pattern: "noise", when: { shore: [0.02, 9] }, shell: { kind: "moss", scale: 9, give: 0.15 } }, { name: "heath", ramp: shade("#4a3a3e", "#5e4648", "#6e5650", "#80685a"), pattern: "tufts", when: { shore: [0.28, 9] }, shell: { kind: "fuzz", scale: 18, height: 0.8 } }],
    plants: [{ kind: "sphagnum", per100: 8, size: [0.25, 0.5], wide: 1.5, tints: ["#8a8e32", "#a8863a", "#a85a3a"] }, { kind: "sedge", per100: 18, size: [0.4, 0.7], tints: GOLD, water: "shore" }, { kind: "heather", per100: 9, size: [0.3, 0.5], on: ["heath"], tints: COLD, blooms: ["#a85a9a", "#c47ab0"], stand: 5 }, { kind: "pitcher-plant", per100: 2.5, size: [0.2, 0.35], blooms: ["#8a3a46"], on: ["sphagnum"] }, { kind: "cattail", per100: 3, size: [0.9, 1.3], water: "shore", stand: 4 }],
    light: light({ sun: "#f4e8d0", power: 1.6, sky: "#c0c8c8", earth: "#3a3428", fog: "#b8bcb4", haze: [14, 74] }),
  },
  marsh: {
    id: "marsh", label: "Salt marsh", climate: { temperature: 13, rain: 900 }, relief: { kind: "hummocks", amp: 0.7, scale: 16 }, water: { level: 0, color: "#5a7a7e", clarity: 0.6 }, wind: 0.5,
    ground: [{ name: "mud", ramp: MUD, pattern: "noise", shell: { kind: "cracks", scale: 2.2, height: 0.3, give: 0 } }, { name: "cordgrass", ramp: DRY_GRASS, pattern: "tufts", when: { shore: [0.03, 9] }, shell: { kind: "fuzz", scale: 20 } }],
    plants: [{ kind: "reed", per100: 30, size: [1.2, 1.9], water: "shore", tints: GOLD, stand: 8 }, { kind: "sedge", per100: 34, size: [0.5, 0.9], tints: GOLD, water: "shore" }, { kind: "saltbush", per100: 3, size: [0.4, 0.7], tints: SAGE }, { kind: "driftwood", per100: 0.4, size: [0.2, 0.28] }],
    light: light({ sun: "#fff2d8", power: 2.8, sky: "#d8e6ee", fog: "#d8e0dc", haze: [24, 100] }),
  },
  deciduous: {
    id: "deciduous", label: "Temperate forest", climate: { temperature: 11, rain: 1000 }, relief: { kind: "hills", amp: 3, scale: 24 }, wind: 0.25, depth: 0.15,
    ground: [{ name: "soil", ramp: LOAM, pattern: "speckle" }, { name: "litter", ramp: LITTER, pattern: "noise", when: { patches: [9, 0.75] }, shell: { kind: "litter", scale: 8, height: 0.7, give: 0.3 } }, { name: "moss", ramp: MOSS, pattern: "noise", when: { patches: [4, 0.2] }, shell: { kind: "moss", scale: 6, give: 0.2 } }],
    plants: [{ kind: "fern", per100: 10, size: [0.5, 1], stand: 6, tints: FRESH }, { kind: "bluebell", per100: 28, size: [0.25, 0.38], stand: 7, blooms: ["#5a5ad8"] }, { kind: "holly", per100: 1.5, size: [1.2, 2.2], tints: DEEP }, { kind: "rhododendron", per100: 1, size: [1.5, 2.4], tints: DEEP, blooms: ["#c85aa0"] }, { kind: "bramble", per100: 2, size: [0.7, 1.1], stand: 5 }, { kind: "mossy-log", per100: 0.6, size: [0.5, 0.7] }, { kind: "stump", per100: 0.5, size: [0.4, 0.7], tints: DEEP }, { kind: "toadstool", per100: 3, size: [0.14, 0.26], blooms: ["#c8342a"] }, { kind: "bolete", per100: 3, size: [0.14, 0.24], blooms: ["#8a5a30"] }, { kind: "ivy-curtain", per100: 2, size: [1.2, 2.2], hangFrom: 3, tints: DEEP }, { kind: "mossy-boulder", per100: 0.7, size: [0.5, 1], tints: DEEP }],
    vines: { per100: 0.7, on: "mossy-boulder", tint: "#2f6a34" }, trees: [{ species: "oak", per100: 0.8 }, { species: "maple", per100: 0.5 }, { species: "birch", per100: 0.3 }],
    light: light({ sun: "#fff0c8", power: 2.3, fog: "#c0d2c0", haze: [12, 76] }),
  },
  "temperate-rainforest": {
    id: "temperate-rainforest", label: "Temperate rainforest", climate: { temperature: 9, rain: 2800 }, relief: { kind: "hills", amp: 4, scale: 22 }, wind: 0.12, depth: 0.18,
    ground: [{ name: "soil", ramp: LOAM, pattern: "speckle" }, { name: "moss", ramp: MOSS, pattern: "noise", when: { patches: [7, 0.85] }, shell: { kind: "moss", scale: 4.5, give: 0.15 } }],
    plants: [{ kind: "fern", per100: 34, size: [0.7, 1.5], tints: DEEP }, { kind: "mossy-log", per100: 1.2, size: [0.6, 0.9] }, { kind: "stump", per100: 1, size: [0.6, 1.2], tints: DEEP }, { kind: "mossy-boulder", per100: 1.2, size: [0.6, 1.4], tints: DEEP }, { kind: "bolete", per100: 4, size: [0.14, 0.26], blooms: ["#b8884a"] }, { kind: "spanish-moss", per100: 7, size: [1, 2], hangFrom: 3.6, tints: FRESH }],
    trees: [{ species: "redwood", per100: 0.6 }, { species: "spruce", per100: 0.5 }],
    light: light({ sun: "#e8ecd0", power: 1.6, sky: "#b8cbb8", earth: "#26301e", fog: "#a8bca8", haze: [8, 56] }),
  },
  taiga: {
    id: "taiga", label: "Boreal taiga", climate: { temperature: -2, rain: 500 }, relief: { kind: "hills", amp: 3, scale: 26 }, wind: 0.3,
    ground: [{ name: "needles", ramp: shade("#3a2c22", "#4e3c2c", "#5e4a36", "#705840"), pattern: "speckle", shell: { kind: "litter", scale: 14, height: 0.4, give: 0.2 } }, { name: "moss", ramp: shade("#3e5a34", "#4e6e3c", "#628044", "#76904e"), pattern: "noise", when: { patches: [6, 0.55] }, shell: { kind: "moss", scale: 6, give: 0.2 } }, { name: "snow", ramp: SNOW, pattern: "noise", when: { patches: [10, 0.18] }, shell: { kind: "mounds", scale: 1.6, height: 0.16, give: 0.6 } }],
    plants: [{ kind: "blueberry", per100: 10, size: [0.3, 0.5], stand: 6, tints: COLD }, { kind: "fern", per100: 4, size: [0.4, 0.7], tints: COLD }, { kind: "juniper", per100: 2, size: [0.4, 0.9], tints: DEEP }, { kind: "mossy-boulder", per100: 0.8, size: [0.5, 1.1], tints: COLD }, { kind: "mossy-log", per100: 0.6, size: [0.4, 0.6] }],
    trees: [{ species: "spruce", per100: 1.1 }, { species: "pine", per100: 0.6 }, { species: "birch", per100: 0.2 }], light: light({ sun: "#fff0d4", power: 2.2, sky: "#d0dceb", fog: "#ccd8e2", haze: [16, 84] }),
  },
  tundra: {
    id: "tundra", label: "Arctic tundra", climate: { temperature: -10, rain: 220 }, relief: { kind: "hummocks", amp: 1.4, scale: 15 }, wind: 0.6, depth: 0.1,
    ground: [{ name: "gravel", ramp: ROCK, pattern: "speckle", shell: { kind: "pebbles", scale: 8, give: 0 } }, { name: "lichen", ramp: LICHEN, pattern: "noise", when: { patches: [7, 0.62] }, shell: { kind: "moss", scale: 8, height: 0.7, give: 0.05 } }, { name: "sedge", ramp: shade("#6a6238", "#807844", "#968c50", "#aaa05c"), pattern: "tufts", when: { patches: [5, 0.28] }, shell: { kind: "fuzz", scale: 16, height: 0.75 } }, { name: "snow", ramp: SNOW, pattern: "noise", when: { patches: [8, 0.13] }, shell: { kind: "mounds", scale: 1.4, height: 0.16, give: 0.5 } }],
    plants: [{ kind: "dwarf-willow", per100: 7, size: [0.15, 0.3], tints: COLD, stand: 6 }, { kind: "sedge", per100: 15, size: [0.2, 0.35], tints: GOLD, on: ["sedge", "lichen"] }, { kind: "gentian", per100: 3, size: [0.1, 0.16], blooms: ["#4a5ad8"], stand: 4 }, { kind: "edelweiss", per100: 3, size: [0.08, 0.14], blooms: ["#f4f0e4"], tints: SAGE }, { kind: "boulder", per100: 1.2, size: [0.3, 1] }, { kind: "scree", per100: 0.5, size: [0.2, 0.4], wide: 1.2 }],
    light: light({ sun: "#fff4e0", power: 2.4, sky: "#d8e4f0", fog: "#dde6ee", haze: [26, 120] }),
  },
  meadow: {
    id: "meadow", label: "Alpine meadow", climate: { temperature: 3, rain: 1100 }, relief: { kind: "hills", amp: 6, scale: 30 }, wind: 0.45,
    ground: [{ name: "turf", ramp: GRASS, pattern: "tufts", shell: { kind: "fuzz", scale: 26 } }, { name: "rock", ramp: ROCK, pattern: "cobble", when: { slope: [0.62, 9] }, shell: { kind: "strata", scale: 3, height: 0.7, give: 0 } }],
    plants: [{ kind: "gentian", per100: 16, size: [0.12, 0.2], blooms: ["#3a4ad8"], stand: 6 }, { kind: "edelweiss", per100: 6, size: [0.1, 0.16], tints: SAGE, on: ["rock", "turf"] }, { kind: "crocus", per100: 12, size: [0.12, 0.18], blooms: ["#a07ae0", "#f4f0e4"], stand: 5 }, { kind: "lupin", per100: 6, size: [0.5, 0.8], blooms: ["#5a5ae0", "#c868b8"], stand: 5 }, { kind: "bunchgrass", per100: 18, size: [0.3, 0.55], tints: FRESH }, { kind: "juniper", per100: 1, size: [0.3, 0.6], tints: DEEP }, { kind: "boulder", per100: 0.8, size: [0.4, 1.1] }],
    cover: { kinds: { grass: 7, "tall-grass": 2, clover: 2, wildflower: 1, daisy: 1 }, per1: 3, on: ["turf"], size: [0.2, 0.36], tints: FRESH, blooms: FLOWERS },
    trees: [{ species: "spruce", per100: 0.1 }], light: light({ sun: "#fff6e4", power: 3.2, sky: "#c8def8", fog: "#d4e4f2", haze: [30, 140] }),
  },
  mountains: {
    id: "mountains", label: "High mountains", climate: { temperature: -4, rain: 1300 }, relief: { kind: "ridges", amp: 16, scale: 34 }, wind: 0.65, depth: 0.2,
    ground: [{ name: "scree", ramp: ROCK, pattern: "speckle", shell: { kind: "pebbles", scale: 4, give: 0 } }, { name: "turf", ramp: DARK_GRASS, pattern: "tufts", when: { height: [-9, 3.5], slope: [0, 0.9] }, shell: { kind: "fuzz", scale: 22 } }, { name: "cliff", ramp: DARK_ROCK, pattern: "stripes", when: { slope: [1, 99] }, shell: { kind: "strata", scale: 1.6, give: 0 } }, { name: "snow", ramp: SNOW, pattern: "noise", when: { height: [6, 99], slope: [0, 1.5] }, shell: { kind: "mounds", scale: 1, height: 0.16, give: 0.4 } }],
    plants: [{ kind: "scree", per100: 2, size: [0.3, 0.7], wide: 1.3, on: ["scree"], slope: 1.2 }, { kind: "boulder", per100: 1.2, size: [0.5, 1.8], slope: 1.2 }, { kind: "bunchgrass", per100: 12, size: [0.25, 0.5], on: ["turf"], tints: COLD }, { kind: "juniper", per100: 2.5, size: [0.3, 0.7], on: ["turf"], tints: DEEP }, { kind: "edelweiss", per100: 4, size: [0.1, 0.16], tints: SAGE, on: ["turf", "scree"] }, { kind: "gentian", per100: 5, size: [0.1, 0.16], on: ["turf"], blooms: ["#3a4ad8"], stand: 4 }],
    trees: [{ species: "pine", per100: 0.2, on: ["turf"] }], light: light({ sun: "#fff8ec", power: 3.4, sky: "#b8d4f6", fog: "#d8e6f4", haze: [40, 170] }),
  },
  glacier: {
    id: "glacier", label: "Ice sheet", climate: { temperature: -25, rain: 150 }, relief: { kind: "crags", amp: 4, scale: 22 }, wind: 0.75, depth: 0.16,
    ground: [{ name: "ice", ramp: ICE, pattern: "noise", shell: { kind: "cracks", scale: 0.9, height: 0.5, give: 0 } }, { name: "snow", ramp: SNOW, pattern: "noise", when: { slope: [0, 0.7], patches: [10, 0.65] }, shell: { kind: "ripples", scale: 2.2, height: 0.08, give: 0.1 } }],
    plants: [{ kind: "ice-block", per100: 0.6, size: [0.4, 1.3], tints: ["#a9d3e6"] }], light: light({ sun: "#fff8f0", power: 3.4, sky: "#cfe2f8", earth: "#a8c0d4", fog: "#e4eef6", haze: [24, 120] }),
  },
  prairie: {
    id: "prairie", label: "Tallgrass prairie", climate: { temperature: 11, rain: 800 }, relief: { kind: "plain", amp: 2, scale: 34 }, wind: 0.55,
    ground: [{ name: "soil", ramp: SOIL, pattern: "speckle" }, { name: "grass", ramp: DRY_GRASS, pattern: "tufts", when: { patches: [7, 0.94] }, shell: { kind: "fuzz", scale: 22 } }],
    plants: [{ kind: "feathergrass", per100: 120, size: [0.8, 1.3], tints: GOLD }, { kind: "wheatgrass", per100: 70, size: [0.7, 1.1], tints: GOLD, stand: 8 }, { kind: "coneflower", per100: 7, size: [0.6, 0.9], blooms: ["#c868a8", "#f0c040"], stand: 5 }, { kind: "sunflower", per100: 2.5, size: [1, 1.6], blooms: ["#f5c830"], stand: 5 }, { kind: "lupin", per100: 2.5, size: [0.5, 0.8], blooms: ["#5a5ae0"], stand: 4 }],
    cover: { kinds: { grass: 7, "tall-grass": 3, wildflower: 1 }, per1: 2.6, on: ["grass"], size: [0.25, 0.4], tints: GOLD, blooms: FLOWERS },
    light: light({ sun: "#fff0c8", power: 3.1, fog: "#e0dec0", haze: [30, 140] }),
  },
  plains: {
    id: "plains", label: "Green plains", climate: { temperature: 12, rain: 650 }, relief: { kind: "plain", amp: 2.4, scale: 30 }, wind: 0.4,
    ground: [{ name: "soil", ramp: SOIL, pattern: "speckle" }, { name: "grass", ramp: GRASS, pattern: "tufts", when: { patches: [8, 0.96] }, shell: { kind: "fuzz", scale: 26 } }],
    plants: [{ kind: "bunchgrass", per100: 24, size: [0.35, 0.65], tints: FRESH }, { kind: "daisy", per100: 14, size: [0.2, 0.32], stand: 7 }, { kind: "poppy", per100: 8, size: [0.3, 0.5], blooms: ["#d8342a"], stand: 6 }, { kind: "dandelion", per100: 6, size: [0.14, 0.24], blooms: ["#f5c830", "#e8e6dc"] }, { kind: "hydrangea", per100: 0.4, size: [0.7, 1.1], blooms: ["#8a9ae0"], tints: FRESH }, { kind: "boxwood", per100: 0.5, size: [0.7, 1.1], tints: DEEP }, { kind: "boulder", per100: 0.2, size: [0.4, 0.9] }],
    cover: { kinds: { grass: 8, "tall-grass": 2, clover: 3, daisy: 0.8, wildflower: 0.8 }, per1: 3, on: ["grass"], size: [0.2, 0.34], tints: FRESH, blooms: FLOWERS },
    trees: [{ species: "oak", per100: 0.08 }], light: light({ power: 3.2 }),
  },
  steppe: {
    id: "steppe", label: "Cold steppe", climate: { temperature: 5, rain: 320 }, relief: { kind: "plain", amp: 3, scale: 36 }, wind: 0.65,
    ground: [{ name: "soil", ramp: shade("#6a5c44", "#7c6c50", "#8e7e5c", "#a09068"), pattern: "speckle", shell: { kind: "pebbles", scale: 9, height: 0.35, give: 0 } }, { name: "grass", ramp: STEPPE, pattern: "tufts", when: { patches: [6, 0.68] }, shell: { kind: "fuzz", scale: 18, height: 0.8 } }],
    plants: [{ kind: "feathergrass", per100: 60, size: [0.4, 0.75], tints: ["#a3a068", "#b6b276"] }, { kind: "sagebrush", per100: 5, size: [0.4, 0.8], tints: SAGE }, { kind: "tumbleweed", per100: 0.6, size: [0.4, 0.7], tints: ["#a68f62"] }, { kind: "allium", per100: 3, size: [0.3, 0.45], blooms: ["#b87ad0"], stand: 5 }, { kind: "boulder", per100: 0.2, size: [0.3, 0.8] }],
    light: light({ sun: "#fff0d8", power: 3.2, sky: "#d8e4f0", fog: "#dcd8c8", haze: [34, 150] }),
  },
  savanna: {
    id: "savanna", label: "Savanna", climate: { temperature: 25, rain: 800 }, relief: { kind: "plain", amp: 2.4, scale: 34 }, wind: 0.4,
    ground: [{ name: "earth", ramp: RED_SAND, pattern: "speckle", shell: { kind: "cracks", scale: 2, height: 0.3, give: 0 } }, { name: "grass", ramp: DRY_GRASS, pattern: "tufts", when: { patches: [7, 0.8] }, shell: { kind: "fuzz", scale: 18 } }],
    plants: [{ kind: "tussock", per100: 70, size: [0.6, 1.2], tints: GOLD }, { kind: "pampas", per100: 3, size: [1.2, 1.9], tints: GOLD, stand: 8 }, { kind: "saltbush", per100: 1.5, size: [0.5, 0.9], tints: SAGE }, { kind: "aloe", per100: 1.5, size: [0.5, 0.9], blooms: ["#e0542a"] }, { kind: "termite-mound", per100: 0.25, size: [1, 2.2] }, { kind: "boulder", per100: 0.3, size: [0.5, 1.4], tints: SAGE }],
    trees: [{ species: "acacia", per100: 0.18 }, { species: "baobab", per100: 0.04 }], light: light({ sun: "#ffe8b0", power: 3.4, sky: "#e0e4cc", fog: "#e8d8b0", haze: [30, 130] }),
  },
  chaparral: {
    id: "chaparral", label: "Mediterranean scrub", climate: { temperature: 16, rain: 450 }, relief: { kind: "hills", amp: 5, scale: 24 }, wind: 0.4,
    ground: [{ name: "earth", ramp: shade("#7a5a3a", "#8e6e48", "#a28256", "#b69664"), pattern: "speckle", shell: { kind: "pebbles", scale: 10, height: 0.4, give: 0 } }, { name: "grass", ramp: DRY_GRASS, pattern: "tufts", when: { patches: [5, 0.45] }, shell: { kind: "fuzz", scale: 16, height: 0.7 } }, { name: "rock", ramp: shade("#7c7468", "#90887a", "#a49c8c", "#b8b0a0"), pattern: "cobble", when: { slope: [0.8, 99] } }],
    plants: [{ kind: "lavender", per100: 12, size: [0.35, 0.6], tints: SAGE, blooms: ["#8a6ad8"], stand: 6 }, { kind: "manzanita", per100: 3, size: [1, 1.9], tints: ["#5a7a50"] }, { kind: "sagebrush", per100: 4, size: [0.4, 0.8], tints: SAGE }, { kind: "oleander", per100: 1, size: [1.2, 2], blooms: ["#e87aa0", "#f4f0e4"], tints: DEEP }, { kind: "gorse", per100: 3, size: [0.6, 1.1], tints: DEEP, blooms: ["#f0c830"], stand: 5 }, { kind: "yucca", per100: 0.8, size: [0.8, 1.5], tints: SAGE }, { kind: "boulder", per100: 0.8, size: [0.4, 1.1], tints: SAGE }],
    trees: [{ species: "lemon", per100: 0.05 }, { species: "fig", per100: 0.05 }], light: light({ sun: "#fff0c0", power: 3.4, sky: "#cfe2f6", fog: "#e6dfca", haze: [30, 130] }),
  },
  fynbos: {
    id: "fynbos", label: "Fynbos heath", climate: { temperature: 16, rain: 700 }, relief: { kind: "hills", amp: 5, scale: 26 }, wind: 0.55,
    ground: [{ name: "sand", ramp: GREY_SAND, pattern: "speckle", shell: { kind: "pebbles", scale: 9, height: 0.3, give: 0 } }, { name: "scrub", ramp: shade("#4c5a3c", "#5e6e46", "#708050", "#82925a"), pattern: "tufts", when: { patches: [6, 0.66] }, shell: { kind: "fuzz", scale: 18 } }],
    plants: [{ kind: "protea", per100: 4, size: [0.9, 1.5], tints: SAGE, blooms: ["#d85a80", "#f0a0a8"], stand: 6 }, { kind: "heather", per100: 26, size: [0.3, 0.55], blooms: ["#d87aa0", "#f4f0e4"], tints: COLD, stand: 6 }, { kind: "tussock", per100: 16, size: [0.4, 0.7], tints: ["#8a9060"] }, { kind: "bird-of-paradise", per100: 1.2, size: [0.7, 1.1], blooms: ["#f08a30"] }, { kind: "boulder", per100: 0.6, size: [0.4, 1], tints: SAGE }],
    light: light({ sun: "#fff4dc", power: 3.2, sky: "#d0e4f4", fog: "#dde4e0", haze: [28, 120] }),
  },
  moor: {
    id: "moor", label: "Heather moor", climate: { temperature: 8, rain: 1200 }, relief: { kind: "hills", amp: 4, scale: 30 }, wind: 0.7,
    ground: [{ name: "peat", ramp: PEAT, pattern: "noise" }, { name: "heath", ramp: shade("#4a3a44", "#5e4650", "#705660", "#84686c"), pattern: "tufts", when: { patches: [8, 0.8] }, shell: { kind: "fuzz", scale: 18, height: 0.8 } }, { name: "rock", ramp: ROCK, pattern: "noise", when: { slope: [0.6, 99] } }],
    plants: [{ kind: "heather", per100: 60, size: [0.3, 0.55], tints: COLD, blooms: ["#a85aa8", "#c47ac0"] }, { kind: "gorse", per100: 3, size: [0.6, 1.1], tints: DEEP, blooms: ["#f0c830"], stand: 6 }, { kind: "tussock", per100: 16, size: [0.4, 0.7], tints: GOLD }, { kind: "mossy-boulder", per100: 0.9, size: [0.5, 1.3], tints: COLD }],
    light: light({ sun: "#ece6d8", power: 1.9, sky: "#b8c0cc", earth: "#3a3430", fog: "#b8bec4", haze: [14, 80] }),
  },
  desert: {
    id: "desert", label: "Sonoran desert", climate: { temperature: 22, rain: 220 }, relief: { kind: "plain", amp: 3, scale: 30 }, wind: 0.3,
    ground: [{ name: "sand", ramp: shade("#a07e56", "#b89668", "#ccae7c", "#dcc290"), pattern: "speckle", shell: { kind: "pebbles", scale: 7, height: 0.4, give: 0 } }, { name: "hardpan", ramp: shade("#8a6a4a", "#a0805a", "#b4946a", "#c6a87a"), pattern: "noise", when: { patches: [8, 0.32] }, shell: { kind: "cracks", scale: 1.7, height: 0.4, give: 0 } }],
    plants: [{ kind: "saguaro", per100: 1, size: [3, 6], wide: 1.1 }, { kind: "barrel", per100: 3, size: [0.4, 0.8], blooms: ["#f0c040", "#e0542a"] }, { kind: "prickly-pear", per100: 3, size: [0.7, 1.2], blooms: ["#f0c040"] }, { kind: "ocotillo", per100: 1.5, size: [2, 3.2], tints: FRESH }, { kind: "creosote", per100: 5, size: [0.8, 1.5], tints: ["#6a7a48"] }, { kind: "agave", per100: 2, size: [0.5, 0.9] }, { kind: "yucca", per100: 1, size: [1, 1.8], tints: SAGE }, { kind: "sandstone", per100: 0.6, size: [0.4, 1.1] }, { kind: "tumbleweed", per100: 0.8, size: [0.3, 0.6] }],
    light: light({ sun: "#fff0c8", power: 3.8, sky: "#dfe6ee", earth: "#a08a68", fog: "#ecdcc0", haze: [34, 150] }),
  },
  erg: {
    id: "erg", label: "Sand sea", climate: { temperature: 29, rain: 40 }, relief: { kind: "dunes", amp: 6, scale: 26 }, wind: 0.7,
    ground: [{ name: "sand", ramp: shade("#c08a48", "#d6a25c", "#e6b870", "#f2cc88"), pattern: "stripes", scale: 0.6, shell: { kind: "ripples", scale: 7, height: 0.7, give: 0.04 } }],
    plants: [{ kind: "spinifex", per100: 0.8, size: [0.3, 0.6], tints: ["#a8a460"] }, { kind: "tumbleweed", per100: 0.3, size: [0.3, 0.5] }],
    light: light({ sun: "#ffefc4", power: 4, sky: "#eadfca", earth: "#c49a60", fog: "#f0dcb4", haze: [30, 130] }),
  },
  badlands: {
    id: "badlands", label: "Red badlands", climate: { temperature: 14, rain: 260 }, relief: { kind: "terraces", amp: 6, scale: 26 }, wind: 0.45,
    ground: [{ name: "clay", ramp: RED_SAND, pattern: "stripes", shell: { kind: "cracks", scale: 1.6, height: 0.4, give: 0 } }, { name: "cliff", ramp: RED_ROCK, pattern: "stripes", scale: 1.5, when: { slope: [0.7, 99] }, shell: { kind: "strata", scale: 1.8, give: 0 } }],
    plants: [{ kind: "sagebrush", per100: 4, size: [0.3, 0.7], tints: SAGE, slope: 0.5 }, { kind: "yucca", per100: 0.8, size: [0.5, 1.1], tints: SAGE, slope: 0.5 }, { kind: "sandstone", per100: 1.5, size: [0.4, 1.4] }, { kind: "bunchgrass", per100: 5, size: [0.25, 0.4], tints: GOLD, slope: 0.5 }],
    trees: [{ species: "pine", per100: 0.03 }], light: light({ sun: "#ffe8c0", power: 3.6, sky: "#dfe2e6", earth: "#8a5a40", fog: "#e8cfb0", haze: [34, 140] }),
  },
  "salt-flat": {
    id: "salt-flat", label: "Salt flat", climate: { temperature: 16, rain: 90 }, relief: { kind: "plain", amp: 0.25, scale: 40 }, wind: 0.5, depth: 0.06,
    ground: [{ name: "salt", ramp: SALT, pattern: "noise", shell: { kind: "cracks", scale: 0.8, height: 0.7, give: 0 } }],
    plants: [{ kind: "saltbush", per100: 0.2, size: [0.2, 0.4], tints: SAGE }], light: light({ sun: "#fff6e4", power: 3.8, sky: "#c8def6", earth: "#d8d4c8", fog: "#ecf0f2", haze: [40, 170] }),
  },
  beach: {
    id: "beach", label: "Tropical beach", climate: { temperature: 27, rain: 1500 }, relief: { kind: "hills", amp: 1.8, scale: 24 }, water: { level: -0.2, color: "#3ab4c0", clarity: 0.5 }, wind: 0.45,
    ground: [{ name: "sand", ramp: SAND, pattern: "speckle", shell: { kind: "ripples", scale: 5, height: 0.4, give: 0.03 } }, { name: "grass", ramp: GRASS, pattern: "tufts", when: { shore: [0.7, 9] }, shell: { kind: "fuzz", scale: 18, height: 0.8 } }],
    plants: [{ kind: "marram", per100: 16, size: [0.5, 0.9], on: ["sand", "grass"], tints: ["#8fa058"], stand: 6, water: "dry" }, { kind: "bird-of-paradise", per100: 1.2, size: [0.8, 1.3], blooms: ["#f08a30"], on: ["grass"] }, { kind: "banana", per100: 1, size: [2, 3], on: ["grass"] }, { kind: "driftwood", per100: 0.4, size: [0.2, 0.3], on: ["sand"] }, { kind: "boulder", per100: 0.2, size: [0.4, 0.9], tints: SAGE }],
    trees: [{ species: "palm", per100: 0.2, on: ["grass", "sand"] }], light: light({ sun: "#fff4cc", power: 3.6, sky: "#bfe6f8", fog: "#d4eef4", haze: [34, 150] }),
  },
  dunes: {
    id: "dunes", label: "Coastal dunes", climate: { temperature: 13, rain: 800 }, relief: { kind: "dunes", amp: 3, scale: 18 }, wind: 0.7,
    ground: [{ name: "sand", ramp: SAND, pattern: "stripes", scale: 0.8, shell: { kind: "ripples", scale: 6, height: 0.6, give: 0.04 } }],
    plants: [{ kind: "marram", per100: 42, size: [0.6, 1], tints: ["#8fa058", "#a0a86a"], stand: 7 }, { kind: "saltbush", per100: 1.5, size: [0.4, 0.7], tints: SAGE }, { kind: "driftwood", per100: 0.2, size: [0.18, 0.26] }],
    light: light({ sun: "#fff2d8", power: 3, sky: "#d0e4f0", fog: "#e0e6e4", haze: [26, 120] }),
  },
  volcanic: {
    id: "volcanic", label: "Volcanic field", climate: { temperature: 12, rain: 1000 }, relief: { kind: "crags", amp: 5, scale: 20 }, wind: 0.35, depth: 0.18,
    ground: [{ name: "ash", ramp: ASH, pattern: "speckle", shell: { kind: "pebbles", scale: 6, give: 0 } }, { name: "lava", ramp: DARK_ROCK, pattern: "cobble", when: { patches: [7, 0.45] }, shell: { kind: "cracks", scale: 0.9, height: 0.8, give: 0 } }, { name: "moss", ramp: shade("#4a5a3a", "#5e7044", "#72844e", "#869858"), pattern: "noise", when: { patches: [5, 0.14] }, shell: { kind: "moss", scale: 6, give: 0.1 } }],
    plants: [{ kind: "basalt", per100: 1.5, size: [0.5, 1.5] }, { kind: "fern", per100: 2.5, size: [0.3, 0.6], on: ["moss"], tints: FRESH }, { kind: "bunchgrass", per100: 2, size: [0.2, 0.4], on: ["moss"], tints: GOLD }],
    light: light({ sun: "#f8dcc0", power: 2, sky: "#a8a8b4", earth: "#2a2426", fog: "#8e8a8e", haze: [14, 80] }),
  },
  karst: {
    id: "karst", label: "Karst limestone", climate: { temperature: 18, rain: 1500 }, relief: { kind: "crags", amp: 8, scale: 18 }, wind: 0.25, depth: 0.16,
    ground: [{ name: "limestone", ramp: shade("#7c7c76", "#92928a", "#a8a8a0", "#c0c0b6"), pattern: "stripes", shell: { kind: "strata", scale: 2, give: 0 } }, { name: "scrub", ramp: GRASS, pattern: "tufts", when: { slope: [0, 0.6] }, shell: { kind: "fuzz", scale: 22 } }],
    plants: [{ kind: "fern", per100: 10, size: [0.4, 0.8], tints: FRESH, on: ["scrub"] }, { kind: "ivy-curtain", per100: 5, size: [1, 2.2], hangFrom: 2.4, on: ["limestone"], slope: 3, tints: FRESH }, { kind: "bamboo", per100: 1.5, size: [3, 5], on: ["scrub"], stand: 7 }, { kind: "mossy-boulder", per100: 1, size: [0.5, 1.3], tints: FRESH }, { kind: "orchid", per100: 3, size: [0.3, 0.5], on: ["scrub"], blooms: ["#e87ab0"] }],
    vines: { per100: 1, on: "mossy-boulder", tint: "#4f7f3a", bloom: "#e8a0c8" }, light: light({ sun: "#f6efd8", power: 2.2, sky: "#c4d4d0", fog: "#c0d0cc", haze: [12, 74] }),
  },
  oasis: {
    id: "oasis", label: "Desert oasis", climate: { temperature: 27, rain: 80 }, relief: { kind: "hills", amp: 2.2, scale: 26 }, water: { level: -0.1, color: "#2a7a6a", clarity: 0.55 }, wind: 0.3,
    ground: [{ name: "sand", ramp: SAND, pattern: "stripes", shell: { kind: "ripples", scale: 6, height: 0.5, give: 0.04 } }, { name: "grass", ramp: GRASS, pattern: "tufts", when: { shore: [0, 0.75] }, shell: { kind: "fuzz", scale: 22 } }],
    plants: [{ kind: "papyrus", per100: 26, size: [1.3, 2.2], water: "shore", stand: 5 }, { kind: "reed", per100: 18, size: [1.1, 1.8], water: "shore", stand: 4 }, { kind: "banana", per100: 2, size: [2, 3], on: ["grass"] }, { kind: "lily-pad", per100: 8, size: [0.6, 1], water: "float", stand: 5 }, { kind: "agave", per100: 0.8, size: [0.5, 0.8], on: ["sand"] }],
    trees: [{ species: "palm", per100: 0.5, on: ["grass"] }], light: light({ sun: "#fff0c0", power: 3.8, sky: "#dce6ee", earth: "#b49a70", fog: "#ecdcc0", haze: [30, 140] }),
  },
  bamboo: {
    id: "bamboo", label: "Bamboo grove", climate: { temperature: 15, rain: 1500 }, relief: { kind: "hills", amp: 2.5, scale: 22 }, wind: 0.3,
    ground: [{ name: "litter", ramp: shade("#7a6a3e", "#8e7c4a", "#a29056", "#b4a262"), pattern: "noise", shell: { kind: "litter", scale: 16, height: 0.4, give: 0.3 } }, { name: "moss", ramp: MOSS, pattern: "noise", when: { patches: [5, 0.3] }, shell: { kind: "moss", scale: 6, give: 0.2 } }],
    plants: [{ kind: "bamboo", per100: 13, size: [4.5, 8], wide: 1.1 }, { kind: "fern", per100: 7, size: [0.4, 0.8], tints: FRESH }, { kind: "hosta", per100: 5, size: [0.3, 0.5], stand: 4, tints: DEEP }, { kind: "bolete", per100: 2, size: [0.1, 0.2], blooms: ["#a8743a"] }, { kind: "mossy-boulder", per100: 0.5, size: [0.4, 0.9], tints: DEEP }],
    light: light({ sun: "#f6f2c8", power: 2.2, sky: "#c8dcb8", earth: "#343a22", fog: "#b8ceac", haze: [10, 66] }),
  },
};

export const BIOME_IDS = Object.keys(BIOMES);

/** Adds a biome, or replaces one. */
export function defineBiome(spec: BiomeSpec): void { BIOMES[spec.id] = spec; }

/** The listed biome nearest a climate, on Whittaker's two axes. */
export function biomeForClimate(temperature: number, rain: number): BiomeSpec {
  let best: BiomeSpec | null = null, gap = Infinity;
  for (const b of Object.values(BIOMES)) {
    const d = Math.hypot((b.climate.temperature - temperature) / 30, (Math.log(b.climate.rain) - Math.log(Math.max(1, rain))) / 2);
    if (d < gap) { gap = d; best = b; }
  }
  return best!;
}
