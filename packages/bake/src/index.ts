export { createGrid } from "./grid.ts";
export type { Grid, GridOptions } from "./grid.ts";
export { packAtlas } from "./atlas.ts";
export type { Atlas, PackOptions, Place, Rect } from "./atlas.ts";
export { directionFor, planBake, spriteBox, spriteKey } from "./plan.ts";
export type { BakeOptions, BakePlan, ClipSpec, DesignSpec, SpriteJob } from "./plan.ts";
export { pixelView } from "./view.ts";
export type { PixelView, PixelViewSpec, Vec3 } from "./view.ts";
export { INSTANCE_FLOATS, LAYER_INSTANCE_FLOATS, LayerInstances, SpriteInstances, createSpriteRenderer } from "./sprites.ts";
export type { AtlasPage, BillboardCamera, BillboardStyle, LayerStyle, LookTextures, SpriteRenderer } from "./sprites.ts";
export { SWAY_INSTANCE_FLOATS, SwayInstances, packSway, swayShiftPacked, swaySignalOf, unpackSway } from "./sway.ts";
export type { SwayLike, WindStyle } from "./sway.ts";
export { atlasOf, bakeCamera, bakeDistance, bakeSize, bakeSprites, bakeStyleKey, keyColourFor, renderSprites, thinned, trimSprite } from "./bake.ts";
export type {
  BakeAtlas, BakeBox, BakeCamera, BakeCapsule, BakedSprite, BakeMaterial, BakePalette, BakeRenderer, BakeResult, BakeSource, BakeSources, BakeSpriteOptions, BakeStats,
  BakeWorld, SpriteRect,
} from "./bake.ts";
export { BAKE_FORMAT, createSpriteCache, decodeBake, encodeBake, rectsOf, spritesOf } from "./cache.ts";
export type { SavedBake, SpriteCache } from "./cache.ts";
export { ACTION_BAKE_CLIPS, ENTITY_MATERIALS, HUMANOID_BAKE_CLIPS, QUADRUPED_BAKE_CLIPS, contentHash, entityDesign, entityPalette, frameOf } from "./entity-design.ts";
export type { ClipInfo, EntityDesign, EntityDesignOptions, WornAttribute } from "./entity-design.ts";

// Indexed sprites (slot, shade, surface coordinate per texel), their looks, shapes and layering.
export { EMPTY_TEXEL, HEIGHT_STEPS, SLOTS, SLOT_MAT, bakeIndexed, decodeHeight, decodeTexel, encodeHeight, encodeTexel, heightAt, renderIndexedSprites, slotWorld, trimIndexed } from "./indexed.ts";
export { OCCLUSION_LAYERS, SPRITE_DEPTH_GLSL, anchorB, applyLayer, layerOf, overlayShows, anchorPixel, boundsRect, depthKappa, designBounds, pickSprite, pixelPoint, placedBounds, pointDepth, rowB, spriteRect, spriteTexelAt, texelDepth } from "./depth.ts";
export type { DepthAxis, OcclusionLayer, PickSprite } from "./depth.ts";
export { placeWorld, rayBox, rayCapsule, raycastWorld, rayWedge } from "./raycast.ts";
export type { IndexedBakeRenderer, IndexedSource, IndexedSources, Texel } from "./indexed.ts";
export { LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW, createLookTable, paintRoles, paintSlots } from "./looks.ts";
export type { LayerPaint, LookTable, SlotPaint } from "./looks.ts";
export { BODY_SLOTS, SIZE_STEP, WORN_ROLES, WORN_SLOT, attributeShape, bodyShape, directionAxes, slotOfPart, slotOfRole, socketClass, wornSlotOf } from "./shapes.ts";
export type { AttributeShapeDesign, BodyShape, BodyShapeOptions, BodySlot, BodyWear, ExplicitSkin, SocketClass, SocketRecords } from "./shapes.ts";
export { IDLE_PERIOD, IDLE_STYLES, bakeCost, dressPopulation, layerStream, populate, populateShapes, populationUnit, unitFrame } from "./population.ts";
export type {
  CastAttribute, CastEntity, CastWear, ExplicitBody, ExplicitWear, LoneUnit, PopAnim, PopExceptions, PopUnit, PopUnitShape, PopWear, Population, PopulationOptions, PopulationShapes,
  UnitExplicit, UnitPins,
} from "./population.ts";
// Hybrid records: a population stored as its recipe + re-rolls + pins + explicit parts (the bit codec's HYBRID_POPULATION).
export { OBJECT_PART, generatorOptions, objectWear, optionsOf, populationOf, readRecord, recordBytes, recordOf, recordPrefix, registerGenerator, registerPartReader, shapesOf, unitOf } from "./hybrid.ts";
export type { CastOptions, HybridEnv, PartReader, PopulationGenerator } from "./hybrid.ts";
export { createBakeQueue } from "./queue.ts";
export type { BakeQueue } from "./queue.ts";

// Streaming: what's on screen first, the rest while the game plays; off the main thread where it can be.
export { BAKE_TIERS, RANK, STREAM_LUT, createSpriteStream, inferTier } from "./stream.ts";
export type { BakeTier, PreloadSpec, ResolvedTier, SpriteStream, SpriteStreamOptions, StreamDesign, StreamJob, StreamStats, TierHints, TierSettings } from "./stream.ts";
export { createShelfAtlas } from "./shelf.ts";
export type { ShelfAtlas, ShelfAtlasOptions, ShelfRect } from "./shelf.ts";
export { createFrameBudget } from "./budget.ts";
export type { FrameBudget, FrameBudgetOptions } from "./budget.ts";
export { bakeSlice, bakeWorkerSource, createBakeWorkers, serveBakes } from "./worker.ts";
export type { BakeWorkerEntry, BakeWorkers, BakeWorkersOptions, ServeBakesOptions, SliceSources, WorkerBatch, WorkerCanvas } from "./worker.ts";

// Per-instance effects for layers (drawLayersFx): a hit's flash, a death's or a warp-in's dissolve.
export { FLASH_WHITE, fxDropped, fxIndex, packFx, unpackFx } from "./fx.ts";
// Stages: a "fall" clip (a death, then a corpse or wreck) and a building's construction stages, from its own solids.
export { cutWorld, withFall, withStages, worldBounds, worldFloor } from "./stages.ts";
export type { BuildMechanic, FallOptions, StageOptions } from "./stages.ts";
// Portraits: a unit's or building's own design close up, animated (blink, glance, talk, noise, flash; lights, smoke, damage).
export { HEAD_SHARE, HEAD_SLOTS, PORTRAIT_H, PORTRAIT_W, createPortraits, drawPortrait, headOf, paintIndexed, portraitDistance, portraitMask, portraitPlan } from "./portrait.ts";
export type { PortraitPlan, PortraitSheet, PortraitSprite, PortraitState, PortraitSubject, PortraitView, Portraits, PosedBody } from "./portrait.ts";
export { softBake, softMask, type SoftMask, type SoftMaskOptions, type SoftSprite } from "./soft.ts";
