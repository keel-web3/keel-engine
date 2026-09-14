// @keel-engine/terrain: tile terrain -- a chunked grid of integer heights,
// types and flags; auto-tiling by a rules table; cliffs, ramps, water and
// bridge spans; merged colliders for the character body; walkability, flow
// fields and HPA* for thousands of units; and the ground baked per chunk into
// palette-true, depth-carrying layers drawn under the units.

export { DIR4_NAMES, DX4, DX8, DZ4, DZ8, FLAG, TERRAIN_TYPES, WATER_NONE, opposite4, terrainTypes } from "./types.ts";
export type { Dir4, TerrainTable, TerrainType, TerrainTypeSpec, TextureKind } from "./types.ts";

export { createTerrain, hashTiles, neighbour } from "./grid.ts";
export type { Terrain, TerrainChange, TerrainSpec, TilePatch } from "./grid.ts";

export { AUTOTILE_RULES, BLOB47, autoTile, blobIndex, cardinalIndex, reduceBlob } from "./autotile.ts";
export type { AutoRule, AutoTiles, Relation, TileClass } from "./autotile.ts";

export { canRamp, cliffFace, cliffFaces, cornerLevels, edgeLevels, layRamp, meets, rampSites } from "./cliffs.ts";
export type { CliffFace, RampSite } from "./cliffs.ts";

export { carveRiver, drain, floodWater, waterBodies, waterClass } from "./water.ts";
export type { WaterBody, WaterClass } from "./water.ts";

export { applyBridge, bridgePlacement, bridgeSpans, removeBridge, spanTiles } from "./bridges.ts";
export type { BridgeSpan, SpanOptions } from "./bridges.ts";

export { RAMP_YAW, chunkColliders, collidersNear, terrainColliders } from "./colliders.ts";
export type { ChunkColliders, ColliderOptions } from "./colliders.ts";

export { MOVE_CLASSES, buildPathGrid, clearance, pathGridOf, regions } from "./pathing.ts";
export type { MoveClass, PathGrid, PathOptions } from "./pathing.ts";

export { GOAL, NONE, UNREACHED, createFlowCache, flowField, followField, steer } from "./flowfield.ts";
export type { FlowCache, FlowField, FlowOptions, Goals } from "./flowfield.ts";

export { buildSectors } from "./hpa.ts";
export type { SectorGraph, SectorNode, SectorRoute } from "./hpa.ts";

export { GROUND_MATERIALS, groundPalette, groundRamp, hashText } from "./palette.ts";
export type { CycleRange, GroundPalette, GroundPaletteOptions, RampColour } from "./palette.ts";

export { bakeChunk, chunkBakeJob, composeGround, depthRefOf, depthStepOf, footprintToward, globalPixel, groundDepth, groundStyleKey, spritePosition, viewAxes } from "./ground.ts";
export type { ChunkBakeInput, ChunkBakeJob, ComposeOptions, GroundExtra, GroundLayer, GroundPainter, GroundStyle, GroundStyleName, GroundView, TexelInfo, ViewAxes } from "./ground.ts";

export { TIERS, chunksIn, createGroundBaker, extrasHash, groundJob, groundKey, groundPriority, groundRectFor, layerOfSprite, spriteOfLayer, surfaceChunkKey, tierPriority } from "./ground-bake.ts";

export { DECAL_KINDS, SEASONS, TEXTURE_TRAITS, createSurfaceShader, groundSurface, hashBiome, seasonPalette, surfaceKey, surfaceLayoutKey, surfacePalette, tileVariant } from "./surface.ts";
export type { DecalKind, GroundSurface, SurfaceBiome, SurfaceBlend, SurfacePaletteOptions, SurfaceSeason, SurfaceShader, SurfaceShaderInput, SurfaceTexel } from "./surface.ts";

export { a2Quarter, importTileset, tilesetPainter, tilesetPalette, tilesetStyle, wangIndex } from "./tileset.ts";
export type { Tileset, TilesetImage, TilesetLayout, TilesetRules } from "./tileset.ts";
export type { GroundBaker, GroundBakerOptions, GroundJob, LayerToDraw, Tier } from "./ground-bake.ts";

export { createGroundRenderer } from "./ground-gl.ts";
export type { GroundDrawView, GroundRenderer } from "./ground-gl.ts";

export { GPU_APRON, GPU_KIND, GPU_TEXTURES, gpuChunkData, gpuTileData } from "./ground-gpu-data.ts";
export type { GpuChunkData, GpuChunkInput, GpuTileData } from "./ground-gpu-data.ts";
export { createGpuGround, createGpuTerrain } from "./ground-gpu.ts";
export type { GpuDrawOptions, GpuGround, GpuGroundCamera, GpuGroundOptions, GpuGroundView, GpuPerspectiveOptions, GpuTerrain, GpuTerrainOptions } from "./ground-gpu.ts";
