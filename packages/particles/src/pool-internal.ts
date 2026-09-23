import type { EmitterRecipe } from "./recipe.ts";

export const CURVE_SAMPLES = 32;
export const STYLE_WIDTH = CURVE_SAMPLES + 4;
export const MAX_STYLES = 256;

/** A 30-bit hash of an integer. */
export function h30(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 2;
}

export interface Compiled {
  readonly name: string;
  readonly index: number;
  readonly src: EmitterRecipe;
  mode: number; shape: number;
  count0: number; count1: number; rate: number; density: number; perMetre: number; duration: number; delay: number;
  radius: number; areaView: boolean; ax: number; ay: number; az: number;
  dx: number; dy: number; dz: number; oneMinusCos: number;
  speed0: number; speed1: number; up0: number; up1: number; vx: number; vy: number; vz: number; inherit: number;
  ox: number; oy: number; oz: number; priority: number; budget: number; reach: number;
  also: number[];
  alsoRefs: readonly (string | EmitterRecipe)[];
  life0: number; life1: number; meanSize: number;
}
