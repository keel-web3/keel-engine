// @keel-engine/elevation: continuous ground elevation -- one height field every system reads (renderers, physics,
// cameras, props, AI). Rolling hills from a seed; the shaping built worlds are made of (roads graded along their line,
// junctions and pads levelled, all blended into the land); a raycast; and the GLSL that marches the same ground on the
// GPU. Deterministic: arithmetic, square roots and core's value noise.

export { manifest } from "./module.ts";
export type { Elevation, HeightGrid } from "./grid.ts";
export { FLAT_ELEVATION, cellX, cellZ, createGrid, elevationOf, gridOver, rangeUnder, sample } from "./grid.ts";
export type { CorridorOptions, HillOptions, LevelOptions } from "./shape.ts";
export { addHills, gradeCorridor, levelDisc, levelRect, lockGrid } from "./shape.ts";
export { raycast } from "./raycast.ts";
export type { ElevationTexture } from "./glsl.ts";
export { ELEVATION_GLSL, uploadElevation } from "./glsl.ts";
