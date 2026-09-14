// The particle ramps the presets name, and the little sprites a particle can
// wear. A game with its own palette maps these names to its own ramps (the
// renderer takes any { name: [base, length] }); these are the defaults, built
// in OKLCH with the pixel artist's hue shift (shadows cool, lights warm).

import { oklch } from "@keel-engine/core";
import type { RGB } from "@keel-engine/core";
import type { ParticleSprite } from "./recipe.ts";

/** A ramp as OKLCH stops from dark to light ([L, C, hue°]), and how many entries it gets. */
export interface ParticleRampSpec {
  readonly stops: readonly (readonly [number, number, number])[];
  readonly length: number;
}

/** The ramps the presets wear. */
export const PARTICLE_RAMPS: Readonly<Record<string, ParticleRampSpec>> = Object.freeze({
  fire: { stops: [[0.28, 0.1, 20], [0.55, 0.2, 35], [0.75, 0.18, 60], [0.92, 0.12, 95], [0.99, 0.03, 100]], length: 8 },
  flash: { stops: [[0.7, 0.16, 55], [0.9, 0.14, 90], [1, 0.02, 100]], length: 5 },
  spark: { stops: [[0.5, 0.18, 35], [0.78, 0.17, 65], [0.95, 0.1, 100]], length: 6 },
  ember: { stops: [[0.3, 0.12, 25], [0.55, 0.19, 38], [0.75, 0.17, 60]], length: 5 },
  smoke: { stops: [[0.2, 0.012, 270], [0.45, 0.012, 260], [0.72, 0.01, 80]], length: 7 },
  dust: { stops: [[0.32, 0.03, 280], [0.55, 0.05, 60], [0.82, 0.04, 80]], length: 7 },
  blood: { stops: [[0.22, 0.08, 15], [0.42, 0.16, 25], [0.6, 0.18, 30]], length: 5 },
  ichor: { stops: [[0.3, 0.08, 150], [0.62, 0.17, 130], [0.9, 0.17, 115]], length: 6 },
  water: { stops: [[0.35, 0.08, 250], [0.65, 0.1, 225], [0.95, 0.03, 200]], length: 6 },
  snow: { stops: [[0.62, 0.03, 260], [0.86, 0.02, 240], [0.99, 0.005, 90]], length: 4 },
  magic: { stops: [[0.3, 0.14, 290], [0.55, 0.22, 320], [0.78, 0.16, 345], [0.97, 0.04, 20]], length: 7 },
  leaf: { stops: [[0.3, 0.07, 150], [0.55, 0.12, 135], [0.78, 0.13, 110]], length: 5 },
  // (Added for the RTS impacts, construction and damage presets: energy weapons and warp-ins, acid, glassy
  // crystal, cool machine metal, organic spores.)
  energy: { stops: [[0.32, 0.1, 265], [0.6, 0.15, 235], [0.84, 0.12, 205], [0.98, 0.03, 195]], length: 6 },
  acid: { stops: [[0.38, 0.11, 140], [0.72, 0.19, 122], [0.95, 0.18, 105]], length: 6 },
  crystal: { stops: [[0.42, 0.08, 285], [0.74, 0.1, 250], [0.97, 0.03, 210]], length: 5 },
  metal: { stops: [[0.24, 0.02, 255], [0.5, 0.025, 240], [0.8, 0.02, 225]], length: 5 },
  spore: { stops: [[0.36, 0.09, 330], [0.62, 0.11, 5], [0.88, 0.08, 70]], length: 5 },
});

/** The default particle palette: colours and { name: [base, length] }, as the renderer's setPalette takes them. */
export function particlePalette(specs: Readonly<Record<string, ParticleRampSpec>> = PARTICLE_RAMPS): { colours: RGB[]; ramps: Record<string, [number, number]> } {
  const colours: RGB[] = [];
  const ramps: Record<string, [number, number]> = {};
  for (const [name, { stops, length }] of Object.entries(specs)) {
    ramps[name] = [colours.length, length];
    for (let i = 0; i < length; i += 1) {
      const x = (i / Math.max(1, length - 1)) * (stops.length - 1);
      const k = Math.min(Math.floor(x), stops.length - 2);
      const f = x - k;
      const a = stops[k]!;
      const b = stops[Math.min(k + 1, stops.length - 1)]!;
      // (Hue the short way round: 345° to 20° is through red, not back through cyan.)
      const dh = ((((b[2] - a[2]) % 360) + 540) % 360) - 180;
      colours.push(oklch(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + dh * f));
    }
  }
  return { colours, ramps };
}

/** Sprite cell size, in texels. */
export const SPRITE_CELL = 8;

// The sprites: lightness masks, '.' empty, '1'..'9' how light (x of 9). Drawn at a whole-number scale once a
// particle is big enough for one (see gpu.ts); smaller than that, a particle is a speck.
const SPRITE_ROWS: Readonly<Record<Exclude<ParticleSprite, "dot">, readonly string[]>> = {
  spark: [
    "...9....",
    "...9....",
    "..797...",
    "99999997",
    "..797...",
    "...9....",
    "...7....",
    "........",
  ],
  puff: [
    "..6778..",
    ".678998.",
    "56789987",
    "56788876",
    "45677765",
    "34566654",
    ".345554.",
    "..3443..",
  ],
  flame: [
    "...8....",
    "...9....",
    "..899...",
    "..8998..",
    ".789987.",
    ".689986.",
    "..6886..",
    "...55...",
  ],
  drop: [
    "...7....",
    "...8....",
    "..787...",
    "..898...",
    ".78998..",
    ".68886..",
    "..565...",
    "........",
  ],
  leaf: [
    "......78",
    "....6897",
    "...6886.",
    "..5786..",
    ".5775...",
    ".565....",
    ".44.....",
    "3.......",
  ],
};

/** The sprite atlas: one row of 8×8 cells (cell 0 empty: "dot"), one byte of lightness a texel (0: empty, else 1..255). */
export function particleSpriteAtlas(): { width: number; height: number; data: Uint8Array } {
  const cells: readonly ParticleSprite[] = ["dot", "spark", "puff", "flame", "drop", "leaf"];
  const width = cells.length * SPRITE_CELL;
  const data = new Uint8Array(width * SPRITE_CELL);
  cells.forEach((name, c) => {
    if (name === "dot") return;
    SPRITE_ROWS[name].forEach((row, y) => {
      for (let x = 0; x < SPRITE_CELL; x += 1) {
        const ch = row[x] ?? ".";
        if (ch !== ".") data[y * width + c * SPRITE_CELL + x] = Math.round((Number(ch) / 9) * 255);
      }
    });
  });
  return { width, height: SPRITE_CELL, data };
}
