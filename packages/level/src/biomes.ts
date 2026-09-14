// Biomes: which terrain types a generated level wears at each height, how its
// palette leans, and what grows. The generator picks one (a lockable choice,
// "level.biome"); a biome is data, so a pack can add its own.

import { CONTENT_IDS } from "./content.ts";
import type { ScatterRule } from "./document.ts";

export interface Biome {
  readonly name: string;
  /** The ground palette's tint (groundPalette's biome option) and its water. */
  readonly tint: { readonly hue: number; readonly chroma: number; readonly light: number };
  readonly water: { readonly hue: number; readonly chroma: number };
  /** Types by height: under water, at the shore, low ground (dry, wet), high ground, the peaks. */
  readonly bed: string;
  readonly shore: string;
  readonly low: readonly [string, string];
  readonly high: string;
  readonly peak: string;
  /** A type sprinkled in low ground by a noise field (lava pools, crystal fields), or null. */
  readonly accent: string | null;
  /** Foliage. */
  readonly flora: readonly ScatterRule[];
  readonly undergrowth: readonly ScatterRule[];
  /** What the base areas are paved with. */
  readonly base: string;
}

const F = CONTENT_IDS.foliage;
const rule = (object: string, on: readonly string[], weight: number, spacing: number, scale: readonly [number, number], extra: Partial<ScatterRule> = {}): ScatterRule => ({ pack: F, object, on, weight, spacing, scale, ...extra });

export const BIOMES: Readonly<Record<string, Biome>> = {
  temperate: {
    name: "temperate", tint: { hue: 0, chroma: 1, light: 1 }, water: { hue: 222, chroma: 0.1 },
    bed: "sand", shore: "sand", low: ["grass", "dirt"], high: "rock", peak: "snow", accent: null, base: "dirt",
    flora: [rule("tree", ["grass"], 3, 2.6, [0.85, 1.2], { clump: 0.85 }), rule("pine", ["grass", "dirt", "rock"], 1.2, 2.4, [0.8, 1.15], { clump: 0.7 }), rule("rock", ["rock", "dirt", "grass"], 0.35, 3, [0.7, 1.3]), rule("boulder", ["rock"], 0.2, 5, [0.8, 1.2])],
    undergrowth: [rule("bush", ["grass"], 1, 1.6, [0.7, 1.1], { clump: 0.5 }), rule("flowers", ["grass"], 0.6, 1.5, [0.8, 1.2], { clump: 0.7 }), rule("tuft", ["grass", "dirt"], 0.8, 1.4, [0.8, 1.2]), rule("reeds", ["sand", "grass", "mud"], 2, 1.2, [0.8, 1.2], { water: 1 })],
  },
  desert: {
    name: "desert", tint: { hue: 8, chroma: 0.9, light: 1.04 }, water: { hue: 200, chroma: 0.11 },
    bed: "sand", shore: "sand", low: ["sand", "sandstone"], high: "sandstone", peak: "rock", accent: null, base: "sandstone",
    flora: [rule("palm", ["sand"], 2, 3, [0.9, 1.2], { water: 3 }), rule("cactus", ["sand", "sandstone"], 1, 3.5, [0.8, 1.2], { water: -3 }), rule("boulder", ["sandstone", "rock"], 0.4, 5, [0.7, 1.3]), rule("dead-tree", ["sand"], 0.15, 6, [0.8, 1.1])],
    undergrowth: [rule("rock", ["sand", "sandstone"], 0.5, 2.5, [0.5, 1]), rule("tuft", ["sand"], 0.4, 1.5, [0.7, 1]), rule("reeds", ["sand"], 2, 1, [0.8, 1.2], { water: 1 })],
  },
  tundra: {
    name: "tundra", tint: { hue: -10, chroma: 0.75, light: 1.03 }, water: { hue: 210, chroma: 0.08 },
    bed: "rock", shore: "ice", low: ["snow", "grass"], high: "rock", peak: "ice", accent: null, base: "snow",
    flora: [rule("pine", ["snow", "grass"], 3, 2.5, [0.8, 1.25], { clump: 0.8 }), rule("dead-tree", ["snow"], 0.3, 5, [0.8, 1.1]), rule("boulder", ["rock", "snow"], 0.4, 4.5, [0.7, 1.2])],
    undergrowth: [rule("rock", ["snow", "rock"], 0.6, 2.4, [0.5, 1]), rule("bush", ["grass"], 0.6, 1.8, [0.7, 1], { clump: 0.5 })],
  },
  volcanic: {
    name: "volcanic", tint: { hue: -12, chroma: 0.8, light: 0.95 }, water: { hue: 190, chroma: 0.06 },
    bed: "ash", shore: "ash", low: ["ash", "rock"], high: "rock", peak: "ash", accent: "lava", base: "rock",
    flora: [rule("dead-tree", ["ash"], 1, 4, [0.8, 1.2], { clump: 0.6 }), rule("boulder", ["rock", "ash"], 0.8, 3.5, [0.7, 1.3]), rule("crystal", ["rock"], 0.25, 5, [0.8, 1.2])],
    undergrowth: [rule("rock", ["ash", "rock"], 1, 2, [0.4, 0.9])],
  },
  alien: {
    name: "alien", tint: { hue: 150, chroma: 1.1, light: 1 }, water: { hue: 300, chroma: 0.12 },
    bed: "mud", shore: "mud", low: ["grass", "crystal"], high: "rock", peak: "crystal", accent: "crystal", base: "rock",
    flora: [rule("crystal", ["crystal", "rock"], 2, 2.6, [0.8, 1.5], { clump: 0.7 }), rule("tree", ["grass"], 1.5, 2.8, [0.9, 1.3], { clump: 0.8 }), rule("boulder", ["rock"], 0.3, 5, [0.8, 1.2])],
    undergrowth: [rule("bush", ["grass"], 1, 1.6, [0.7, 1.1], { clump: 0.6 }), rule("flowers", ["grass", "crystal"], 1, 1.2, [0.8, 1.2])],
  },
};
export const BIOME_NAMES: readonly string[] = Object.keys(BIOMES);
