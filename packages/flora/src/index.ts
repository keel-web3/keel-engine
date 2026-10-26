// @keel-engine/flora: foliage drawn by keel/lit. Pixel-art sprites painted
// from a seed (or a creator's own), crossed into X and star cards or grown as
// 3D blades, instanced by the thousand; lit as the ground under them so a
// field shades as one surface with the terrain, bent by gusting wind and
// parted by whatever walks through.

export { FLORA_KINDS, ROLE, paintFoliageAtlas, spriteCell } from "./sprites.ts";
export type { FloraAtlas, FloraKind } from "./sprites.ts";

export { bladeClump, crossCards } from "./cards.ts";
export type { BladeOptions, CardOptions } from "./cards.ts";

export { MAX_PUSHERS, createFloraField } from "./field.ts";
export type { FloraField, FloraFieldSpec, FloraPlacement, Pusher } from "./field.ts";

export { hash3, pickWeighted, scatter } from "./scatter.ts";
export type { ScatterPoint, ScatterSpec } from "./scatter.ts";
