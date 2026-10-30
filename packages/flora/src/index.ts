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

export { FLORA_MOTION_HEAD, createFloraMotion } from "./motion.ts";
export type { FloraBody, FloraImpact, FloraMotion, FloraMotionSpec } from "./motion.ts";

export { LEAF_BLADE, LEAF_NEEDLE, LEAF_OVAL, LEAF_ROUND, PlantBuilder, ROLE_BLOOM, ROLE_LEAF, ROLE_OWN } from "./shapes.ts";
export type { LeafOptions, PartStyle, V3 } from "./shapes.ts";

export { PLANTS, PLANT_KINDS, definePlant, plantGeometry } from "./plants.ts";
export type { PlantDef } from "./plants.ts";

export { createPlantField } from "./plant-field.ts";
export type { PlantField, PlantFieldSpec, PlantPlacement } from "./plant-field.ts";

export { crawl, createVineField } from "./vines.ts";
export type { CrawlOptions, Surface, VineField, VineSpec } from "./vines.ts";

export { MAX_SHELL_MATERIALS, SHELL_KINDS, createGroundShells } from "./shells.ts";
export type { GroundShells, GroundShellSpec, ShellKind, ShellLook } from "./shells.ts";
