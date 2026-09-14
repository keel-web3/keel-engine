// @keel-engine/worldgen: world generation -- climate biomes as data (packs
// add their own), biome swapping (re-skin a region keeping its shape,
// seasons, runtime spread), the infinite Minecraft-style overworld, Diablo-
// style dungeons (BSP, stitched room templates by a graph grammar, cellular
// caves, drunkard walks, wave function collapse) with fairness checks,
// chunk-independent foliage scatter, and generator PIPELINES: stages with
// masks, pins and locks, stored as codec recipes, finite or streamed.

export { hash01, hashU32, noiseField, fbm, rng, rngOf, seedOf, simplex2, value2 } from "./noise.ts";
export type { NoiseSpec, Rng } from "./noise.ts";

export { DEFAULT_ACTS, DEFAULT_BIOMES, FOLIAGE_LAYERS, LAYER_SPACING, createBiomeTable } from "./biomes.ts";
export type { ActDef, BiomeDef, BiomeTable, Climate, FoliageLayer, FoliageRule } from "./biomes.ts";

export { ORES, blit, createLayers, createMap, cropLayers, hashLayers, toTerrain, writeTerrain } from "./map.ts";
export type { OreKind, TileLayers, WorldMap, WorldThing } from "./map.ts";

export { createOverworld } from "./overworld.ts";
export type { Column, Overworld, OverworldParams } from "./overworld.ts";

export { STRUCTURES, stampStructure, structuresIn } from "./structures.ts";
export type { PlacedStructure, StructureContext, StructureDef, StructurePlan } from "./structures.ts";

export { CELL, DUNGEON_ALGORITHMS, ROOM_TEMPLATES, TEMPLATE_PROPS, THEMES, checkDungeon, distances, dungeonLayers, generateDungeon, wrapYaw } from "./dungeon.ts";
export type { Dungeon, DungeonAlgorithm, DungeonCheck, DungeonParams, DungeonProp, DungeonTheme, Room, RoomTemplate } from "./dungeon.ts";

export { DUNGEON_TILES, TOWN_TILES, edgeTiles, overlappingModel, solveWfc, tiledModel, wfcDungeonCells, wfcTown } from "./wfc.ts";
export type { WfcModel, WfcOptions, WfcResult } from "./wfc.ts";

export { drawLayersFor, scatterIn } from "./scatter.ts";
export type { PlantInstance, ScatterOptions } from "./scatter.ts";

export { createBiomePainter, foliageProfile, groundTypeAt, reskin, seasonPaletteFor } from "./swap.ts";
export type { BiomePainter } from "./swap.ts";

export { RECIPE_FORMAT, RECIPE_VERSION, chooseTemplates, createWorldStream, defineRecipe, defineStage, maskBounds, maskFn, runPipeline, stageKinds, stageOf } from "./pipeline.ts";
export type { MaskSpec, ParamValue, PinSpec, PipelineOptions, StageContext, StageDef, StageSpec, WorldChunk, WorldRecipe, WorldStream } from "./pipeline.ts";

export { BIOME_TABLE, ROOM_TEMPLATES_SCHEMA, TILESET_RULES, WORLD_RECIPE, decodeBiomes, decodeRecipe, decodeRooms, decodeTileset, encodeBiomes, encodeRecipe, encodeRooms, encodeTileset } from "./schema.ts";

export { defineWorldPack, worldOptions, worldPackManifest } from "./packs.ts";
export type { WorldPack } from "./packs.ts";

export { generateWorldLevel, interiorRecipe, joinBases, levelWorld, worldSurface } from "./level.ts";

export { createWorldBaker } from "./world-baker.ts";
export type { WorldBaker, WorldBakerOptions, WorldChunkState } from "./world-baker.ts";

// The action-RPG dungeon: acts as themes, the dressing (room kinds, floors, props, lights, doors, stairs), the scene
// (walls with height, pillars, lintels, stairs, bridges as quads), light masks and fog of war, and the pixel-art renderer
// (a light map with flicker, palette-true surfaces, the cutaway, lit sprites, flames, the abyss).
export { CRAWL_ACTS, CRAWL_RAMPS, CRAWL_ROOM_KINDS, CRAWL_THEMES, RAMP_LENGTH, crawlPalette, crawlRamp } from "./crawl-themes.ts";
export type { CrawlLight, CrawlLightKind, CrawlRamp, CrawlRoomKind, CrawlTheme, RampSpec } from "./crawl-themes.ts";
export { DECOR, DIR_X, DIR_Z, DUNGEON_PROP_RULES, FLOOR, dressDungeon } from "./dungeon-dress.ts";
export type { DressOptions, DressedDoor, DressedLight, DressedProp, DressedRoom, DungeonDressing, PropRule, Stairs } from "./dungeon-dress.ts";
export { DECOR_NAMES, FINE, FLAME_KIND, MAT, NO_COLUMN, QUAD, QUAD_FLOATS, SUB, buildDungeonScene, walkableAt } from "./dungeon-scene.ts";
export type { DungeonScene, SceneDoor, SceneFlame } from "./dungeon-scene.ts";
export { MASK_PER_METRE, createFog, lightMask } from "./dungeon-light.ts";
export type { Fog, LightMask } from "./dungeon-light.ts";
export { LIT_SPRITE_FLOATS, createDungeonRenderer } from "./dungeon-gl.ts";
export type { DungeonDrawOptions, DungeonDrawView, DungeonRenderer, LookLayout } from "./dungeon-gl.ts";
