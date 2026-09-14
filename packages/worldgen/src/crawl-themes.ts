// The acts of an action-RPG dungeon, as data: each a palette (OKLCH ramps
// with the pixel artist's hue shift -- shadows cool, lights warm), how its
// walls and floors are built (ashlar, raw rock, basalt with molten seams,
// broken brick), its liquid, its lights (torch, sconce, brazier, candle,
// crystal, fungus, lava, moon shaft, the hero's own), its ambient, its
// abyss, the rooms it favours and the particles in its air.
//
// The dungeon renderer (dungeon-gl.ts) reads a theme; dressDungeon
// (dungeon-dress.ts) reads its room weights and decor densities; the look
// profile of the same name paints packs/dungeon's props.
//
//   crypt   cold blue-grey ashlar, burial niches, warm torchlight, dust
//   cave    raw brown rock with irregular edges, cyan crystals, drips
//   forge   black basalt with molten seams, lava, braziers, embers
//   ruin    broken sandstone brick, ivy and moss, moonlight shafts, spores

import { oklch } from "@keel-engine/core";
import type { RGB } from "@keel-engine/core";

/** A ramp: OKLCH lightness from L0 to L1 over `n` entries, a chroma, a hue, and how far the hue turns dark -> light. */
export interface RampSpec { readonly h: number; readonly c: number; readonly L: readonly [number, number]; readonly shift?: number }

/** The ramps every theme lays out, in palette row order (the renderer indexes them by this list). */
export const CRAWL_RAMPS = ["floor", "floorAlt", "corridor", "wall", "wallAlt", "cap", "trim", "moss", "water", "lava", "wood", "iron", "gold", "rug", "rugAlt", "bone", "abyss", "glow", "flame", "ivy", "dirt", "magic", "mist", "shaft"] as const;
export type CrawlRamp = (typeof CRAWL_RAMPS)[number];
export const RAMP_LENGTH = 10;

export type CrawlLightKind = "torch" | "sconce" | "brazier" | "candle" | "crystal" | "fungus" | "lava" | "shaft" | "hero" | "key" | "sigil";
/** A light kind: colour (linear-ish 0..1), radius (m), strength, flicker (0..1 of it), flicker speed (Hz), height it hangs at (m). */
export interface CrawlLight { readonly colour: readonly [number, number, number]; readonly radius: number; readonly strength: number; readonly flicker: number; readonly speed: number }

export type CrawlRoomKind = "entry" | "stairwell" | "throne" | "shrine" | "vault" | "crypt" | "library" | "armoury" | "storage" | "prison" | "sewer" | "hall" | "cavern" | "forge" | "garden" | "well";
export const CRAWL_ROOM_KINDS: readonly CrawlRoomKind[] = ["entry", "stairwell", "throne", "shrine", "vault", "crypt", "library", "armoury", "storage", "prison", "sewer", "hall", "cavern", "forge", "garden", "well"];

export interface CrawlTheme {
  readonly id: string;
  readonly title: string;
  /** The look profile packs/dungeon's props wear. */
  readonly profile: string;
  /** Walls: 0 ashlar, 1 raw rock, 2 basalt with molten seams, 3 broken brick; cap height range (m); thickness (0.5 m steps); rough edges (0..1). */
  readonly wall: { readonly style: number; readonly height: readonly [number, number]; readonly thickness: number; readonly rough: number };
  /** Floors: 0 flagstones, 1 packed earth and rock, 2 basalt tiles, 3 broken paving. */
  readonly floor: { readonly style: number; readonly corridor: number };
  readonly liquid: "water" | "lava" | "slime";
  readonly ramps: Readonly<Record<CrawlRamp, RampSpec>>;
  /** Light between the lights (0..1 RGB) and how much an explored room out of sight keeps. */
  readonly ambient: readonly [number, number, number];
  readonly remembered: number;
  readonly lights: Readonly<Record<CrawlLightKind, CrawlLight>>;
  /** The abyss below: its depth (m), its fog colour, a glow far down (lava) or none, mist (0..1). */
  readonly abyss: { readonly depth: number; readonly fog: readonly [number, number, number]; readonly glow: readonly [number, number, number] | null; readonly mist: number };
  /** Room kinds by weight (for the rooms the grammar leaves plain). */
  readonly rooms: Readonly<Partial<Record<CrawlRoomKind, number>>>;
  /** Floor decor densities (0..1 of cells) and wall decor. */
  readonly decor: { readonly moss: number; readonly cracks: number; readonly puddles: number; readonly stains: number; readonly grates: number; readonly niches: number; readonly ivy: number; readonly lavaCracks: number; readonly broken: number; readonly shafts: number };
  /** The air: ambient particles, and whether fires throw embers and smoke. */
  readonly air: { readonly ambient: "dust" | "drips" | "embers" | "spores"; readonly fire: boolean };
  /** Torch spacing along walls (cells) and how many braziers a big room gets. */
  readonly torchEvery: number;
}

const L = (colour: readonly [number, number, number], radius: number, strength: number, flicker: number, speed: number): CrawlLight => ({ colour, radius, strength, flicker, speed });
const WARM = [1, 0.62, 0.3] as const;

export const CRAWL_THEMES: Readonly<Record<string, CrawlTheme>> = {
  crypt: {
    id: "crypt", title: "Crypt", profile: "crypt",
    wall: { style: 0, height: [2.8, 2.8], thickness: 2, rough: 0 },
    floor: { style: 0, corridor: 0 },
    liquid: "water",
    ramps: {
      floor: { h: 255, c: 0.03, L: [0.1, 0.72], shift: -40 }, floorAlt: { h: 275, c: 0.035, L: [0.1, 0.66], shift: -40 },
      corridor: { h: 260, c: 0.025, L: [0.1, 0.66], shift: -30 }, wall: { h: 262, c: 0.035, L: [0.09, 0.7], shift: -45 },
      wallAlt: { h: 285, c: 0.04, L: [0.08, 0.62], shift: -40 }, cap: { h: 265, c: 0.02, L: [0.08, 0.5], shift: -20 },
      trim: { h: 250, c: 0.03, L: [0.12, 0.82], shift: -40 }, moss: { h: 140, c: 0.06, L: [0.1, 0.56], shift: -30 },
      water: { h: 235, c: 0.07, L: [0.08, 0.72], shift: -20 }, lava: { h: 30, c: 0.18, L: [0.25, 0.95], shift: 50 },
      wood: { h: 45, c: 0.06, L: [0.1, 0.6], shift: -30 }, iron: { h: 250, c: 0.015, L: [0.08, 0.72], shift: -20 },
      gold: { h: 80, c: 0.11, L: [0.2, 0.9], shift: -35 }, rug: { h: 15, c: 0.14, L: [0.12, 0.55], shift: -25 },
      rugAlt: { h: 80, c: 0.1, L: [0.2, 0.78], shift: -30 }, bone: { h: 85, c: 0.035, L: [0.15, 0.9], shift: -50 },
      abyss: { h: 270, c: 0.03, L: [0.02, 0.24], shift: -10 }, glow: { h: 290, c: 0.16, L: [0.3, 0.92], shift: 30 },
      flame: { h: 35, c: 0.17, L: [0.4, 0.98], shift: 60 }, ivy: { h: 135, c: 0.08, L: [0.1, 0.55], shift: -30 },
      dirt: { h: 60, c: 0.03, L: [0.08, 0.5], shift: -30 }, magic: { h: 250, c: 0.14, L: [0.4, 0.95], shift: -40 },
      mist: { h: 265, c: 0.03, L: [0.1, 0.4], shift: 0 }, shaft: { h: 230, c: 0.04, L: [0.5, 0.92], shift: 0 },
    },
    ambient: [0.075, 0.074, 0.115], remembered: 0.36,
    lights: {
      torch: L([1, 0.55, 0.22], 6.4, 1.5, 0.2, 7), sconce: L([0.5, 0.62, 1], 5, 0.95, 0.12, 2), brazier: L([1, 0.56, 0.24], 7.5, 1.4, 0.25, 6),
      candle: L([1, 0.74, 0.42], 3.4, 0.7, 0.15, 9), crystal: L([0.55, 0.7, 1], 5, 0.8, 0.08, 0.6), fungus: L([0.5, 1, 0.8], 3, 0.5, 0.05, 0.4),
      lava: L([1, 0.4, 0.12], 5, 1, 0.12, 0.8), shaft: L([0.55, 0.68, 1], 5, 0.8, 0, 0), hero: L([0.9, 0.85, 0.78], 4.6, 0.3, 0.05, 3),
      key: L([1, 0.85, 0.4], 3.5, 0.9, 0.1, 1.2), sigil: L([0.9, 0.2, 0.25], 4, 0.8, 0.2, 1),
    },
    abyss: { depth: 14, fog: [0.02, 0.025, 0.05], glow: null, mist: 0.6 },
    rooms: { crypt: 5, library: 2, armoury: 1.5, storage: 1.5, prison: 1.5, hall: 2, sewer: 1, well: 0.6 },
    decor: { moss: 0.1, cracks: 0.22, puddles: 0.06, stains: 0.025, grates: 0.04, niches: 0.28, ivy: 0, lavaCracks: 0, broken: 0.03, shafts: 0 },
    air: { ambient: "dust", fire: true },
    torchEvery: 6,
  },
  cave: {
    id: "cave", title: "Cave", profile: "cave",
    wall: { style: 1, height: [2.0, 2.8], thickness: 2, rough: 1 },
    floor: { style: 1, corridor: 1 },
    liquid: "water",
    ramps: {
      floor: { h: 70, c: 0.035, L: [0.1, 0.72], shift: -45 }, floorAlt: { h: 55, c: 0.04, L: [0.1, 0.64], shift: -45 },
      corridor: { h: 60, c: 0.03, L: [0.08, 0.64], shift: -35 }, wall: { h: 35, c: 0.025, L: [0.06, 0.56], shift: -60 },
      wallAlt: { h: 38, c: 0.028, L: [0.06, 0.52], shift: -60 }, cap: { h: 30, c: 0.02, L: [0.05, 0.4], shift: -30 },
      trim: { h: 60, c: 0.03, L: [0.1, 0.72], shift: -40 }, moss: { h: 140, c: 0.08, L: [0.1, 0.6], shift: -30 },
      water: { h: 225, c: 0.06, L: [0.04, 0.72], shift: -25 }, lava: { h: 30, c: 0.18, L: [0.25, 0.95], shift: 50 },
      wood: { h: 55, c: 0.05, L: [0.1, 0.58], shift: -30 }, iron: { h: 45, c: 0.03, L: [0.08, 0.62], shift: -20 },
      gold: { h: 85, c: 0.11, L: [0.2, 0.88], shift: -35 }, rug: { h: 40, c: 0.06, L: [0.1, 0.5], shift: -25 },
      rugAlt: { h: 80, c: 0.06, L: [0.2, 0.7], shift: -30 }, bone: { h: 80, c: 0.035, L: [0.15, 0.86], shift: -50 },
      abyss: { h: 40, c: 0.02, L: [0.02, 0.2], shift: -10 }, glow: { h: 195, c: 0.14, L: [0.4, 0.95], shift: -20 },
      flame: { h: 38, c: 0.17, L: [0.4, 0.98], shift: 60 }, ivy: { h: 140, c: 0.07, L: [0.1, 0.52], shift: -30 },
      dirt: { h: 65, c: 0.045, L: [0.1, 0.7], shift: -35 }, magic: { h: 195, c: 0.13, L: [0.4, 0.95], shift: -30 },
      mist: { h: 60, c: 0.02, L: [0.08, 0.34], shift: 0 }, shaft: { h: 200, c: 0.03, L: [0.5, 0.9], shift: 0 },
    },
    ambient: [0.15, 0.14, 0.13], remembered: 0.4,
    lights: {
      torch: L([1, 0.6, 0.28], 6.5, 1.45, 0.22, 7), sconce: L([0.45, 0.85, 1], 5, 0.8, 0.1, 2), brazier: L([1, 0.58, 0.26], 8, 1.3, 0.25, 6),
      candle: L([1, 0.74, 0.42], 3.2, 0.65, 0.15, 9), crystal: L([0.35, 0.9, 1], 7.5, 1.35, 0.1, 0.5), fungus: L([0.45, 1, 0.55], 5, 0.9, 0.06, 0.3),
      lava: L([1, 0.4, 0.12], 5, 1, 0.12, 0.8), shaft: L([0.6, 0.72, 1], 5, 0.8, 0, 0), hero: L([0.9, 0.85, 0.78], 4.6, 0.3, 0.05, 3),
      key: L([1, 0.85, 0.4], 3.5, 0.9, 0.1, 1.2), sigil: L([0.4, 1, 0.9], 4, 0.8, 0.2, 1),
    },
    abyss: { depth: 12, fog: [0.025, 0.022, 0.02], glow: null, mist: 0.4 },
    rooms: { cavern: 6, storage: 1, prison: 0.6, well: 1, garden: 0.8 },
    decor: { moss: 0.16, cracks: 0.1, puddles: 0.1, stains: 0.05, grates: 0, niches: 0, ivy: 0.05, lavaCracks: 0, broken: 0.1, shafts: 0.02 },
    air: { ambient: "drips", fire: true },
    torchEvery: 99,
  },
  forge: {
    id: "forge", title: "Hell forge", profile: "forge",
    wall: { style: 2, height: [3, 3], thickness: 2, rough: 0.2 },
    floor: { style: 2, corridor: 2 },
    liquid: "lava",
    ramps: {
      floor: { h: 25, c: 0.022, L: [0.05, 0.46], shift: -30 }, floorAlt: { h: 15, c: 0.028, L: [0.05, 0.42], shift: -30 },
      corridor: { h: 30, c: 0.02, L: [0.05, 0.44], shift: -25 }, wall: { h: 28, c: 0.04, L: [0.06, 0.58], shift: -40 },
      wallAlt: { h: 350, c: 0.04, L: [0.05, 0.44], shift: -30 }, cap: { h: 20, c: 0.02, L: [0.04, 0.34], shift: -20 },
      trim: { h: 55, c: 0.06, L: [0.08, 0.5], shift: -30 }, moss: { h: 30, c: 0.02, L: [0.1, 0.45], shift: -20 },
      water: { h: 30, c: 0.18, L: [0.25, 0.9], shift: 50 }, lava: { h: 28, c: 0.2, L: [0.22, 0.9], shift: 55 },
      wood: { h: 35, c: 0.04, L: [0.06, 0.45], shift: -25 }, iron: { h: 260, c: 0.012, L: [0.05, 0.6], shift: -20 },
      gold: { h: 75, c: 0.12, L: [0.2, 0.9], shift: -35 }, rug: { h: 20, c: 0.16, L: [0.1, 0.5], shift: -25 },
      rugAlt: { h: 70, c: 0.11, L: [0.2, 0.78], shift: -30 }, bone: { h: 65, c: 0.035, L: [0.12, 0.8], shift: -40 },
      abyss: { h: 25, c: 0.06, L: [0.03, 0.3], shift: 20 }, glow: { h: 35, c: 0.18, L: [0.35, 0.97], shift: 50 },
      flame: { h: 35, c: 0.18, L: [0.4, 0.98], shift: 60 }, ivy: { h: 30, c: 0.02, L: [0.08, 0.4], shift: -20 },
      dirt: { h: 25, c: 0.025, L: [0.05, 0.42], shift: -25 }, magic: { h: 25, c: 0.18, L: [0.4, 0.95], shift: 50 },
      mist: { h: 20, c: 0.05, L: [0.08, 0.36], shift: 10 }, shaft: { h: 40, c: 0.08, L: [0.5, 0.9], shift: 0 },
    },
    ambient: [0.17, 0.07, 0.05], remembered: 0.36,
    lights: {
      torch: L([1, 0.48, 0.18], 6.5, 1.3, 0.22, 7), sconce: L([1, 0.35, 0.15], 5, 0.9, 0.15, 2), brazier: L([1, 0.5, 0.18], 9.5, 1.45, 0.28, 6),
      candle: L([1, 0.66, 0.35], 3.2, 0.65, 0.15, 9), crystal: L([1, 0.45, 0.15], 5.5, 0.95, 0.12, 0.7), fungus: L([1, 0.6, 0.3], 3, 0.5, 0.05, 0.4),
      lava: L([1, 0.4, 0.12], 7, 1.8, 0.15, 0.7), shaft: L([1, 0.5, 0.3], 5, 0.7, 0, 0), hero: L([0.9, 0.85, 0.78], 4.6, 0.3, 0.05, 3),
      key: L([1, 0.85, 0.4], 3.5, 0.9, 0.1, 1.2), sigil: L([1, 0.3, 0.1], 4, 0.9, 0.2, 1),
    },
    abyss: { depth: 16, fog: [0.08, 0.02, 0.01], glow: [1, 0.3, 0.06], mist: 0.35 },
    rooms: { forge: 5, armoury: 2, prison: 2, storage: 1.2, hall: 1.5, crypt: 0.6 },
    decor: { moss: 0, cracks: 0.25, puddles: 0, stains: 0.04, grates: 0.06, niches: 0, ivy: 0, lavaCracks: 0.08, broken: 0.04, shafts: 0 },
    air: { ambient: "embers", fire: true },
    torchEvery: 6,
  },
  ruin: {
    id: "ruin", title: "Overgrown ruin", profile: "ruin",
    wall: { style: 3, height: [2.0, 2.9], thickness: 2, rough: 0.35 },
    floor: { style: 3, corridor: 3 },
    liquid: "water",
    ramps: {
      floor: { h: 82, c: 0.035, L: [0.1, 0.74], shift: -60 }, floorAlt: { h: 70, c: 0.04, L: [0.1, 0.68], shift: -60 },
      corridor: { h: 78, c: 0.03, L: [0.1, 0.68], shift: -55 }, wall: { h: 72, c: 0.045, L: [0.09, 0.72], shift: -65 },
      wallAlt: { h: 55, c: 0.05, L: [0.09, 0.64], shift: -60 }, cap: { h: 110, c: 0.05, L: [0.08, 0.5], shift: -30 },
      trim: { h: 80, c: 0.03, L: [0.12, 0.84], shift: -50 }, moss: { h: 135, c: 0.1, L: [0.1, 0.62], shift: -35 },
      water: { h: 195, c: 0.06, L: [0.08, 0.72], shift: -20 }, lava: { h: 30, c: 0.18, L: [0.25, 0.95], shift: 50 },
      wood: { h: 70, c: 0.04, L: [0.1, 0.58], shift: -30 }, iron: { h: 175, c: 0.05, L: [0.1, 0.68], shift: -20 },
      gold: { h: 85, c: 0.1, L: [0.2, 0.88], shift: -35 }, rug: { h: 215, c: 0.07, L: [0.12, 0.58], shift: -25 },
      rugAlt: { h: 85, c: 0.07, L: [0.2, 0.76], shift: -30 }, bone: { h: 90, c: 0.03, L: [0.15, 0.9], shift: -50 },
      abyss: { h: 160, c: 0.03, L: [0.02, 0.24], shift: -10 }, glow: { h: 110, c: 0.15, L: [0.4, 0.95], shift: 20 },
      flame: { h: 40, c: 0.17, L: [0.4, 0.98], shift: 60 }, ivy: { h: 128, c: 0.12, L: [0.1, 0.62], shift: -40 },
      dirt: { h: 65, c: 0.04, L: [0.08, 0.52], shift: -35 }, magic: { h: 110, c: 0.14, L: [0.4, 0.95], shift: 20 },
      mist: { h: 160, c: 0.03, L: [0.1, 0.42], shift: 0 }, shaft: { h: 215, c: 0.04, L: [0.55, 0.95], shift: 0 },
    },
    ambient: [0.1, 0.13, 0.12], remembered: 0.34,
    lights: {
      torch: L([1, 0.64, 0.32], 6.5, 1.4, 0.2, 7), sconce: L([0.6, 1, 0.6], 5, 0.8, 0.1, 2), brazier: L([1, 0.6, 0.3], 8.5, 1.3, 0.25, 6),
      candle: L([1, 0.76, 0.45], 3.2, 0.65, 0.15, 9), crystal: L([0.6, 1, 0.7], 5, 0.8, 0.08, 0.6), fungus: L([0.7, 1, 0.4], 3.6, 0.65, 0.08, 0.4),
      lava: L([1, 0.4, 0.12], 5, 1, 0.12, 0.8), shaft: L([0.62, 0.76, 1], 6, 1.05, 0.04, 0.2), hero: L([0.9, 0.85, 0.78], 4.6, 0.3, 0.05, 3),
      key: L([1, 0.85, 0.4], 3.5, 0.9, 0.1, 1.2), sigil: L([0.6, 1, 0.5], 4, 0.8, 0.2, 1),
    },
    abyss: { depth: 12, fog: [0.02, 0.035, 0.03], glow: null, mist: 0.7 },
    rooms: { garden: 3, hall: 2.5, library: 1.5, crypt: 1.5, storage: 1, well: 1.2, shrine: 0.5 },
    decor: { moss: 0.18, cracks: 0.2, puddles: 0.08, stains: 0.02, grates: 0.02, niches: 0.05, ivy: 0.4, lavaCracks: 0, broken: 0.2, shafts: 0.35 },
    air: { ambient: "spores", fire: true },
    torchEvery: 7,
  },
};

/** The four acts in order (a campaign's first four floors wear them). */
export const CRAWL_ACTS: readonly string[] = ["crypt", "cave", "forge", "ruin"];

/** A ramp's colours: dark to light, the hue turning by `shift` degrees (shadows away from the lights), chroma easing at the ends. */
export function crawlRamp(r: RampSpec, n = RAMP_LENGTH): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const Lt = r.L[0] + (r.L[1] - r.L[0]) * t;
    const C = r.c * (0.55 + 0.45 * Math.sin(Math.PI * (0.12 + 0.76 * t)));
    out.push(oklch(Lt, C, r.h + (r.shift ?? 0) * (0.5 - t) * -1));
  }
  return out;
}

/** A theme's palette: every ramp (CRAWL_RAMPS order) RAMP_LENGTH long, as RGBA8 rows (the renderer's palette texture). */
export function crawlPalette(theme: CrawlTheme): { width: number; height: number; rgba: Uint8Array } {
  const width = RAMP_LENGTH, height = CRAWL_RAMPS.length;
  const rgba = new Uint8Array(width * height * 4);
  CRAWL_RAMPS.forEach((name, row) => crawlRamp(theme.ramps[name]).forEach((c, i) => rgba.set([c[0], c[1], c[2], 255], (row * width + i) * 4)));
  return { width, height, rgba };
}
