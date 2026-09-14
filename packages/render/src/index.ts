// @keel-engine/render: the WebGL2 pixel renderer and its fx passes -- palette
// ramps, dither screens, outlines, at any target size. Names as in the proof
// of concept's src/gpu and src/fx.

export { createPixelRenderer, paletteRamps } from "./pixel-renderer.ts";
export type {
  Colour, Material, PixelRenderer, Ramps, RenderBox, RenderCanvas, RenderCapsule, RenderData, RenderOptions, RenderParticle, RenderWedge, RenderWorld, RendererLimits,
  StyleInput, WorldCounts,
} from "./pixel-renderer.ts";

export { ALL_FX, FX, FX_NAMES, FX_ORDER, GRADE_PRESETS, fxUniforms, resolveFx, screenTile, toggleFx } from "./fx.ts";
export type {
  CycleRamp, EntryRef, FxDef, FxEntry, FxList, FxLook, FxName, FxParams, FxResolved, FxResolvedParams, FxTarget, FxUniforms, GradePreset, OutlineMode,
  PixelUniforms, RampRef, RenderStyle,
} from "./fx.ts";

export {
  FAR, FULLSCREEN_VS, MAX_BOXES, MAX_CAPS, MAX_COLOURS, MAX_MATERIALS, MAX_RAMPS, MAX_WEDGES, PALETTE_WIDTH, PARTICLE_MAT, PIXEL_FS, POINTS_FS, POINTS_VS,
  SCREEN_TILE, SKY_MAT, WATER_MAT, WORLD_FS,
} from "./shaders.ts";

// Raster mode (engine): solids and meshes as triangles into pass 1's buffers -- a world seen from the ground.
export { DEPTH_OUT_FS, DIRECT_MAT, DIRECT_PIXEL_FS, RASTER_FLOATS, RASTER_FS, RASTER_VS, RasterBuffer, RasterSolids, boxTemplate, capsuleTemplate } from "./raster.ts";
export type { DepthOut, RasterContext, RasterFrame, RasterLook, RasterMesh, RasterTemplate } from "./raster.ts";

// Bake mode: pass 1 with surface coordinates, and the index pass the baker reads instead of colours.
export { BAKE_WORLD_FS, DEPTH_FS, HEIGHT_FS, INDEX_FS, INDEX_MAX_MATERIAL, readIndexedPixel, unpackDepth, unpackHeight } from "./indexed.ts";
export type { IndexedPixel } from "./indexed.ts";

// A pixel-art sky for perspective views: a gradient and flat pixel clouds, from a raster hook.
export { createSkyPass } from "./sky.ts";
export type { SkyOptions, SkyPass } from "./sky.ts";
