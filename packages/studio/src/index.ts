// @keel-engine/studio: physically based product shots, live. Models built from parts (lofts with real bevels,
// lathes, ear-clipped caps), a procedural studio prefiltered for GGX, metal and dielectric materials with print
// inks and baked normal/occlusion, clear plastic, cover glass over a pixel-exact screen, contact shadow, MSAA and
// screen bloom -- at two quality tiers from one renderer. Separate from keel/render: nothing there changes.

export * from "./math.ts";
export { MeshBuilder, boundsOf, box, cross as crossOutline, cylinder, flatten, insetPolygon, lathe, loft, mergeMeshes, outline, quad, roundedRect, signedArea, slab, slabRings, stadium, transformMesh, triangulate } from "./mesh.ts";
export type { Bevel, BevelKind, Bounds, LoftOptions, MeshData, Ring, RoundedPolygon } from "./mesh.ts";
export { STUDIO, boxFrame, studioGlsl, studioRadiance } from "./env.ts";
export type { BoxFrame, SoftBox, Studio } from "./env.ts";
export { ATTR, BLUR_FS, CLEAR_FS, COMPOSITE_FS, GLASS_FS, HEIGHT_BAKE_FS, MAIN_VS, RGBM_RANGE, STANDARD_FS, prefilterFs } from "./shaders.ts";
export { createStudioRenderer } from "./renderer.ts";
export type {
  ClearMaterial, DrawItem, Floor, GlassMaterial, GpuMesh, Impostor, Ink, Material, Quality, ProjectedLight, RendererOptions, RendererStats, Rgb, StandardMaterial, StudioFrame,
  StudioRenderer, StudioTexture, TextureOptions, Blit,
} from "./renderer.ts";
export { createFloat, createKey, createSpin, createSpring, createTween, smoother, springStep } from "./motion.ts";
export type { Float, Key, Spin, SpinOptions, SpinState, Spring } from "./motion.ts";
