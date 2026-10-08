// Live bake runtime: explicit generators/rendering, without optional authoring registries.
// The broad package entry retains the complete API.
export { directionFor, planBake } from "./plan.ts";
export { pixelView } from "./view.ts";
export { LAYER_INSTANCE_FLOATS, LayerInstances, createSpriteRenderer } from "./sprites.ts";
export { lookMesh, meshBounds, mergeMeshes, meshMatrix, mulMatrix, worldsBounds } from "./mesh.ts";
export { cardsMesh } from "./cards.ts";
export { defaultMeshSun, orthoDepthRange, projectionOf, shotOfView } from "./project.ts";
export { coarseLayerMesh, layeredMesh, layeredMeshSteps, prefixMesh, solidSize, prepareMeshDetail } from "./lod-mesh.ts";
export { frustumOf, visible } from "./cull.ts";
export { VOLUME_KIND, VolumeInstances } from "./volumes.ts";
export { SwayInstances, packSway } from "./sway.ts";
export { createSpriteCache } from "./cache.ts";
export { renderIndexedSprites } from "./indexed.ts";
export { createLookTable } from "./looks.ts";
export { createMeshWorker, serveMeshWorker } from "./mesh-worker.ts";
export type * from "./index.ts";

export { bodySpace } from "./geometry.ts";
export { solidLodSteps } from "./solid-lod.ts";
export type { LodSolid, SolidLodStep, SolidLodTerm } from "./solid-lod.ts";

export { cloudLobe } from "./cloud-lobe.ts";

// Live website water, shadows and canonical CPU export share these runtime helpers.
export { createSizeCache } from "./size-cache.ts";
export { shadowView } from "./shadow-view.ts";
export { LOOK_TEXELS, LOOKS_PER_ROW, PAINTS_PER_ROW, PALETTE_ROW, PLACES_PER_ROW } from "./looks.ts";

export { GROUND_ART_SIZE, GROUND_ART_LAYERS, GROUND_ART_METRES, groundArtPixels, uploadGroundArt } from "./ground-art.ts";
