// @keel-engine/level: a level document -- terrain and layers of placed things
// (objects by pack/id/pins/look/style, foliage scatter, buildings, bridges,
// roads, water, spawns, resources, markers, trigger regions) -- versioned and
// codec-packed; seeded generation where every choice is a lockable setting;
// fairness for N-player maps; an edit op list that streams change events.

export { LEVEL_FORMAT, LEVEL_VERSION, STYLES, createLevel, levelOf } from "./document.ts";
export type {
  ContentRef, Level, LevelChange, LevelDocument, LevelSpec, LoadTier, Marker, Rect, Region, Resource, ResourceKind, Road, ScatterRegion, ScatterRule, Spawn, Style,
  TerrainRecord, Thing, ThingLayer, Tile, V3, WaterFeature,
} from "./document.ts";

export { CONTENT_IDS, chainContent, groundSolids, placeholderContent } from "./content.ts";
export type { ContentResolver } from "./content.ts";

export { BIOMES, BIOME_NAMES } from "./biomes.ts";
export type { Biome } from "./biomes.ts";

export { TEMPLATES, chooser, generateFair, generateLevel } from "./generate.ts";
export type { Chooser, GenerateOptions, GenerateReport, LevelWorld, Template } from "./generate.ts";

export { SYMMETRIES, canonical, fairness, symmetricPositions } from "./fairness.ts";
export type { FairnessReport, PlayerMetrics, Symmetry } from "./fairness.ts";

export { bulkStream, clearMask, expandAll, expandScatter, poissonDisk } from "./scatter.ts";
export type { ScatterInstance } from "./scatter.ts";

export { roadNetwork, roadPath } from "./roads.ts";
export type { RoadOptions } from "./roads.ts";

export { LEVEL_OPS, applyLevelOp, levelOpReference, runLevelOps, streamLevelOps, validateLevelOps } from "./ops.ts";
export type { LevelOp, LevelOpError, LevelOpResult, LevelRunResult } from "./ops.ts";

export { LEVEL, decodeLevel, encodeLevel } from "./schema.ts";
export type { LevelRecord } from "./schema.ts";

export { groundExtrasOf, levelInstances } from "./instances.ts";
export type { LevelInstances, PlacedInstance } from "./instances.ts";
