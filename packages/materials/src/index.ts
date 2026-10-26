// @keel-engine/materials: surface materials as pixel-art texture atlases,
// varied by seed. Two sources, one atlas:
//
//  - an exemplar: an exact sheet distilled to its palettes and art-resolution
//    blocks, recombined by its recipe (plates, cells, dark-seam quilts, hue
//    leans, procedural cells in its palette). analyzeMaterialSheet says what a
//    sheet is, distillMaterial keeps it, and scoreMaterial (the gauntlet) says
//    whether a variant still looks like it.
//  - no exemplar: bark, leaves, blossom and snow painted procedurally.

import { paintProceduralAtlas } from "./atlas.ts";
import type { MaterialAtlas, MaterialAtlasOptions } from "./atlas.ts";
import { recombineMaterialAtlas } from "./recipe.ts";
import type { ExemplarAtlasOptions } from "./recipe.ts";

export { MATERIAL_FAMILIES, MATERIAL_PALETTES, materialCell, paintMaterialField, paintProceduralAtlas } from "./atlas.ts";
export type { MaterialAtlas, MaterialAtlasOptions, MaterialFamily, MaterialPalette } from "./atlas.ts";
export { DITHER_SCREENS, checkExemplar, checkLayer, decodeMaterialExemplar, encodeMaterialExemplar, samplesPerSide } from "./exemplar.ts";
export type { Composite, DitherScreen, ExemplarFamily, ExemplarLayer, Finish, MaterialExemplar, MaterialLayer } from "./exemplar.ts";
export { recombineMaterialAtlas } from "./recipe.ts";
export type { ExemplarAtlasOptions } from "./recipe.ts";
export { analyzeMaterialSheet, distillMaterial } from "./distill.ts";
export type { AnalyzeOptions, BlockAnalysis, DistillOptions, Distilled, SheetAnalysis, SheetKind } from "./distill.ts";
export { BLOCK_RULES, SHEET_RULES, planMaterial } from "./rules.ts";
export type { BlockEvidence, BlockRule, FamilyPlan, Rule, SheetEvidence, SheetPlan, SheetRule } from "./rules.ts";
export { FIDELITY_LIMITS, GAUNTLET_LIMITS, scoreMaterial, toArt } from "./gauntlet.ts";
export type { FamilyScore, GauntletLimits, GauntletScore, MaterialLayout } from "./gauntlet.ts";
export { luminance, paletteRaster, quantize, resampleArea, resampleNearest, sampleMode } from "./raster.ts";
export type { Raster } from "./raster.ts";

/** An atlas from an exemplar (recombined by its recipes) or, without one, painted procedurally. */
export function paintMaterialAtlas(options: ExemplarAtlasOptions | MaterialAtlasOptions = {}): MaterialAtlas {
  return "exemplar" in options && options.exemplar !== undefined ? recombineMaterialAtlas(options) : paintProceduralAtlas(options as MaterialAtlasOptions);
}
