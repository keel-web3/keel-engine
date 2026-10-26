// @keel-engine/tiles: tile surfaces drawn by keel/lit. A grid holds one
// material per cell, base first; each material finds its edge with its own
// system (an organic blend, or a blob47, wang16, cardinal16 or dual-grid
// atlas, painted here or cut from an artist's sheet), and the surface shader
// draws them all in one pass, snapped to the pixel-art texel grid.

export { BLOB47, BLOB_LUT, DX8, DZ8, SYSTEM_CODE, SYSTEM_TILES, TILE_SYSTEMS, blobIndex, cardinalIndex, dualIndex, reduceBlob, tileFor, tileNeighbourhood, wangIndex } from "./systems.ts";
export type { TileSystem } from "./systems.ts";

export { createTileGrid } from "./grid.ts";
export type { TileGrid } from "./grid.ts";

export { a2Quarter, importTileAtlas, paintTileAtlas } from "./atlas.ts";
export type { AtlasImage, AtlasSystem, PaintOptions, SheetLayout, SheetSpec, TileAtlas } from "./atlas.ts";

export { PATTERN_CODE, createTileSurface } from "./surface.ts";
export type { TileMaterialSpec, TilePattern, TileSurface, TileSurfaceSpec } from "./surface.ts";

export { MAX_TILE_MATERIALS } from "./glsl.ts";
