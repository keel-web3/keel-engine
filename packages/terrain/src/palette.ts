// The ground's palette: a ramp per terrain type (OKLCH, hue-shifted -- warm
// lights, cool darks, the pixel artist's way), ramps for what objects baked
// into the ground are made of, and CYCLING ramps for water, foam and lava.
// The ground baker writes palette INDICES, never colours: every pixel is a
// palette entry, and a cycling ramp's entries rotate at draw time (the ground
// shader), so water moves without a rebake.
//
//   const pal = groundPalette(terrain.types, { biome: { hue: 0, chroma: 1 } });
//   pal.ramps["grass"] -> [base, length];  pal.cycles -> [{ base, length, speed }]

import { dsin, oklch } from "@keel-engine/core";
import type { RGB } from "@keel-engine/core";
import type { TerrainTable } from "./types.ts";

export interface RampColour { readonly L: readonly [number, number]; readonly C: number; readonly h: number }

export interface CycleRange {
  readonly name: string;
  readonly base: number;
  readonly length: number;
  /** Entries a second. */
  readonly speed: number;
}

export interface GroundPalette {
  readonly colours: readonly RGB[];
  /** { name: [base, length] }: every terrain type's ramp by its name, then "water.shallow", "water.deep", "foam", "lava.flow", the materials. */
  readonly ramps: Readonly<Record<string, readonly [number, number]>>;
  readonly cycles: readonly CycleRange[];
  /** Part of every bake key: the same palette, the same key. */
  readonly key: string;
  ramp(name: string): readonly [number, number];
}

export interface GroundPaletteOptions {
  /** Entries a terrain ramp (default 8). */
  readonly rampLength?: number;
  /** A biome's tint over every land ramp: hue turned by `hue` degrees, chroma scaled by `chroma`, lightness by `light`. */
  readonly biome?: { readonly hue?: number; readonly chroma?: number; readonly light?: number };
  /** Water's hue (default 222) and how clear it is (chroma, default 0.1). */
  readonly water?: { readonly hue?: number; readonly chroma?: number };
  /** Ramps for what objects baked into the ground are made of: { wood: { L, C, h }, ... } (defaults: wood, stone, roof, plaster, metal, deck, dark). */
  readonly materials?: Readonly<Record<string, RampColour>>;
}

export const GROUND_MATERIALS: Readonly<Record<string, RampColour>> = {
  wood: { L: [0.25, 0.68], C: 0.08, h: 55 },
  deck: { L: [0.3, 0.74], C: 0.07, h: 62 },
  stone: { L: [0.3, 0.82], C: 0.02, h: 240 },
  roof: { L: [0.26, 0.64], C: 0.12, h: 28 },
  plaster: { L: [0.5, 0.94], C: 0.035, h: 80 },
  metal: { L: [0.25, 0.85], C: 0.015, h: 230 },
  dark: { L: [0.12, 0.35], C: 0.02, h: 260 },
  glass: { L: [0.3, 0.85], C: 0.06, h: 215 },
  leaf: { L: [0.24, 0.72], C: 0.14, h: 140 },
};

/** A ramp: n entries dark to light, hue leaning cooler in the darks and warmer in the lights (tint: hue turn, chroma and lightness scale). */
export function groundRamp(n: number, c: RampColour, tint: { hue: number; chroma: number; light: number }): RGB[] { return rampOf(n, c, tint); }
function rampOf(n: number, c: RampColour, tint: { hue: number; chroma: number; light: number }): RGB[] {
  const out: RGB[] = [];
  for (let e = 0; e < n; e += 1) {
    const f = n === 1 ? 0.5 : e / (n - 1);
    const L = Math.min(0.99, (c.L[0] + (c.L[1] - c.L[0]) * f) * tint.light);
    const C = c.C * tint.chroma * (0.75 + 0.5 * dsin(Math.PI * f)); // (most chroma in the middle)
    out.push(oklch(L, C, c.h + tint.hue + (f - 0.5) * 24));
  }
  return out;
}

export function groundPalette(types: TerrainTable, { rampLength = 8, biome = {}, water = {}, materials = GROUND_MATERIALS }: GroundPaletteOptions = {}): GroundPalette {
  const tint = { hue: biome.hue ?? 0, chroma: biome.chroma ?? 1, light: biome.light ?? 1 };
  const colours: RGB[] = [];
  const ramps: Record<string, [number, number]> = {};
  const add = (name: string, list: RGB[]): void => { ramps[name] = [colours.length, list.length]; colours.push(...list); };
  for (const ty of types.list) add(ty.name, rampOf(rampLength, ty.colour, ty.glow ? { ...tint, light: 1 } : tint));
  const wh = water.hue ?? 222, wc = water.chroma ?? 0.1;
  // Cycling ramps: loops (they rotate), mostly the body colour with one band of light running through.
  const loop = (Ls: readonly number[], C: number, h: number): RGB[] => Ls.map((L, i) => oklch(L, C * (1 - 0.3 * Math.abs(i - Ls.length / 2) / Ls.length), h + (L - 0.5) * 20));
  const cycles: CycleRange[] = [];
  const cyc = (name: string, list: RGB[], speed: number): void => { add(name, list); cycles.push({ name, base: ramps[name]![0], length: list.length, speed }); };
  cyc("water.shallow", loop([0.56, 0.56, 0.58, 0.62, 0.68, 0.62, 0.58, 0.56], wc * 0.9, wh - 12), 3);
  cyc("water.deep", loop([0.4, 0.4, 0.41, 0.44, 0.5, 0.44, 0.41, 0.4], wc, wh + 6), 2);
  cyc("foam", loop([0.72, 0.8, 0.9, 0.97, 0.9, 0.8, 0.72, 0.66], 0.04, wh - 20), 5);
  cyc("lava.flow", loop([0.45, 0.5, 0.58, 0.7, 0.82, 0.7, 0.58, 0.5], 0.19, 40), 2.5);
  // A still water ramp, for water's dark edge and the waterfall's shade.
  add("water.still", rampOf(6, { L: [0.26, 0.66], C: wc, h: wh }, { hue: 0, chroma: 1, light: 1 }));
  for (const [name, c] of Object.entries(materials)) if (!(name in ramps)) add(name, rampOf(Math.max(4, rampLength - 2), c, { hue: 0, chroma: 1, light: 1 }));
  const key = `gp${hashText(JSON.stringify([rampLength, tint, wh, wc, types.list.map((t) => [t.name, t.colour]), Object.keys(materials)]))}`;
  return {
    colours, ramps, cycles, key,
    ramp(name) { const r = ramps[name]; if (!r) throw new RangeError(`No ground ramp "${name}".`); return r; },
  };
}

/** A short stable hash of text (FNV-1a, base 36). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
