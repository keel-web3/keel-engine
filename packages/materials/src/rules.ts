// The material rulebook: how KEEL turns an exact sheet into a generative one.
// Each rule reads measured evidence and decides one part of the plan (art
// resolution, layers, recipe steps, the pixel-art finish), and says why. The
// analysis runs every rule and reports which fired, on what evidence, so an
// agent (or a person) can follow the reasoning, overrule a decision, and ask
// the author only what the evidence can't settle: what each block depicts and
// what the sheet is for.

import type { Composite, DitherScreen, MaterialLayer } from "./exemplar.ts";

/** What the analysis measured for the whole sheet. */
export interface SheetEvidence {
  readonly transparent: boolean;
  /** Art pixels per cell when the sheet is pixel art scaled up (a knee in the rebuild error), else undefined. */
  readonly knee: number | undefined;
  /** Texels per cell side in the sheet. */
  readonly cellTexels: number;
}

/** What the analysis measured for one block. */
export interface BlockEvidence {
  /** Share of gap rows with no gap beside them in the next column (0..1): plates breaking at staggered heights. */
  readonly staggeredGaps: number;
  readonly gaps: number;
  /** Range of the block rows' light over its mean: light that changes down the block. */
  readonly rowLightRange: number;
  /** Distance between the two clusters of cells' chroma, each less its row's mean: a second hue. */
  readonly hueSplit: number;
  /** How much darker cell edges are than cell middles (0..1): framed cells. */
  readonly rimContrast: number;
  /** Spread of the block's smooth light over its mean: shading worth its own layer. */
  readonly lightStrength: number;
}

/** What the rules decide for one family. */
export interface FamilyPlan {
  /** Split light from colour: an albedo palette layer and a light scalar layer, composited by multiply. */
  lightLayer: boolean;
  /** Art pixels per light sample. */
  lightScale: number;
  /** Albedo palette sizes to try, fewest first: distilling keeps the first that loses nothing visible. */
  albedoColours: number[];
  recipe: MaterialLayer[];
  compose: Composite[];
  finish: { dither: DitherScreen; amount: number; clean: boolean; colours: number[] } | undefined;
}

export interface SheetPlan {
  readonly pixels: number;
  /** How an art pixel takes its colour from the sheet: area mean (smooth, for the finish to dither) or mode (the exact pixels). */
  readonly sample: "mean" | "mode";
  readonly families: readonly FamilyPlan[];
}

export interface Rule<E> {
  readonly id: string;
  /** When it applies, in words. */
  readonly when: string;
  /** What it decides, in words. */
  readonly then: string;
  readonly why: string;
  readonly test: (evidence: E) => boolean;
}

export interface SheetRule extends Rule<SheetEvidence> {
  readonly decide: (evidence: SheetEvidence) => { pixels: number; sample: "mean" | "mode"; finish: FamilyPlan["finish"] };
}
export interface BlockRule extends Rule<BlockEvidence & { readonly painted: boolean; readonly sprite: boolean }> {
  readonly decide: (plan: FamilyPlan, evidence: BlockEvidence) => void;
}

/** A painted sheet's art resolution: 24 a cell, never finer than the sheet holds. */
const painted = (e: SheetEvidence): number => Math.max(4, Math.min(24, Math.floor(e.cellTexels / 1.5)));

const PAINTED_FINISH = { dither: "bayer4" as const, amount: 0.35, clean: true, colours: [16, 24, 32] };

export const SHEET_RULES: readonly SheetRule[] = [
  {
    id: "sprite-sheet",
    when: "more than 5% of the sheet is transparent",
    then: "keep each art pixel's exact colour and alpha (mode), one palette layer per family, no light layer, no dither",
    why: "Sprites are objects with holes: their silhouettes and alpha must survive exactly.",
    test: (e) => e.transparent,
    decide: (e) => ({ pixels: e.knee ?? painted(e), sample: "mode", finish: undefined }),
  },
  {
    id: "pixel-art-source",
    when: "the sheet rebuilds from a coarse art resolution almost exactly (it is pixel art scaled up)",
    then: "distil at that art resolution by mode, keep the artist's palette, no light layer, no dither",
    why: "The pixels and palette are the artist's decisions; varying the arrangement must not repaint them.",
    test: (e) => !e.transparent && e.knee !== undefined,
    decide: (e) => ({ pixels: e.knee!, sample: "mode", finish: undefined }),
  },
  {
    id: "painted-source",
    when: "no coarse art resolution rebuilds the sheet (it is painted, or drawn at full size)",
    then: "distil at 24 art pixels a cell (at most the cell's texels / 1.5; 16 is chunkier and smaller, 32 finer), by area mean; finish as pixel art: a palette of 16..32 colours, a bayer4 dither at 0.35, lone pixels cleaned",
    why: "Averaging a painting down blurs it; snapping smooth tones to a short palette through a fixed dither turns that blur into crisp pixel clusters, as a pixel artist would.",
    test: (e) => !e.transparent && e.knee === undefined,
    decide: (e) => ({ pixels: painted(e), sample: "mean", finish: { ...PAINTED_FINISH, colours: [...PAINTED_FINISH.colours] } }),
  },
];

export const BLOCK_RULES: readonly BlockRule[] = [
  {
    id: "separable-light",
    when: "the sheet is painted and its smooth light varies by more than 6% (mounds, pillows, rims, banding)",
    then: "split the block into albedo (its colour, light divided out) and light (a scalar layer, a sample every 4 art pixels), composited by multiply",
    why: "Light and colour then vary apart: cells can move under a light that stays, a painter can relight cells, and the finish dithers the shading.",
    test: (e) => e.painted && !e.sprite && e.lightStrength > 0.06,
    decide: (plan) => { plan.lightLayer = true; plan.lightScale = 4; },
  },
  {
    id: "staggered-plates",
    when: "gap rows cut the cell columns, mostly with no gap beside them in the next column",
    then: "recipe: strips (restack whole plates, cut only at their gaps)",
    why: "Bark, planks and brick courses run across cells; swapping cells would cut a plate mid-length.",
    test: (e) => e.gaps > 0 && e.staggeredGaps > 0.6,
    decide: (plan) => { plan.recipe.push({ layer: "strips", band: 1 }); },
  },
  {
    id: "framed-cells",
    when: "cell edges are over 25% darker than cell middles, and no plates run across cells",
    then: "recipe: cells (whole cells move), no quilting",
    why: "A framed cell holds one whole object (a rosette, a pillow): a seam through it always shows.",
    test: (e) => !(e.gaps > 0 && e.staggeredGaps > 0.6) && e.rimContrast > 0.25,
    decide: (plan) => { plan.recipe.push({ layer: "cells", band: 1 }); },
  },
  {
    id: "open-texture",
    when: "no frames and no plates: a continuous texture",
    then: "recipe: cells, then quilt 40% of them along their darkest seam",
    why: "Without frames a seam can wander through the darkest pixels and hide, making cells the exemplar never had.",
    test: (e) => !(e.gaps > 0 && e.staggeredGaps > 0.6) && e.rimContrast <= 0.25,
    decide: (plan) => { plan.recipe.push({ layer: "cells", band: 1 }, { layer: "quilt", share: 0.4 }); },
  },
  {
    id: "banded-light",
    when: "the block's rows change light by more than 25% down the block (a snow bank, a lit wall)",
    then: "cells stay in their own row (band 0) and plates within a row of where they were (band 1), colour and light together",
    why: "The banding belongs to the place in the block; a cell's own light (its leaf's highlight, its pillow's top) belongs to the cell, so the two never part. A plate is a cell long or more and carries its own shading, so a row's drift keeps the banding within a cell.",
    test: (e) => e.rowLightRange > 0.25,
    decide: (plan) => { for (const step of plan.recipe) if (step.layer === "cells" || step.layer === "strips") (step as { band?: number }).band = step.layer === "cells" ? 0 : 1; },
  },
  {
    id: "two-hues",
    when: "the cells' chroma splits into two clusters more than 12 apart, after each row's mean is removed",
    then: "recipe: lean 20% of cells to the other hue; the albedo keeps at least 32 colours, 16 or so a hue",
    why: "Autumn's reds among oranges, light and deep greens: a cell's hue is part of what varies. A leaning cell trades each colour for the other hue's of nearest light, so each hue needs a full ramp or leaned cells flatten.",
    test: (e) => e.hueSplit >= 12,
    decide: (plan) => { plan.albedoColours = plan.albedoColours.filter((c) => c >= 32); plan.recipe.push({ layer: "lean", share: 0.2, ...(plan.lightLayer ? { target: "albedo" } : {}) }); },
  },
];

/** Runs the rulebook: the sheet's rules, then each block's, in order. */
export function planMaterial(sheet: SheetEvidence, blocks: readonly BlockEvidence[]): { plan: SheetPlan; fired: { sheet: string; blocks: string[][] } } {
  const sheetRule = SHEET_RULES.find((r) => r.test(sheet))!;
  const decided = sheetRule.decide(sheet);
  const fired: string[][] = [];
  const families = blocks.map((evidence) => {
    const plan: FamilyPlan = { lightLayer: false, lightScale: 4, albedoColours: [16, 24, 32, 48, 64, 96, 128], recipe: [], compose: [], finish: decided.finish === undefined ? undefined : { ...decided.finish, colours: [...decided.finish.colours] } };
    const ids: string[] = [];
    const facts = { ...evidence, painted: sheetRule.id === "painted-source", sprite: sheetRule.id === "sprite-sheet" };
    for (const rule of BLOCK_RULES) if (rule.test(facts)) { rule.decide(plan, evidence); ids.push(rule.id); }
    plan.compose = plan.lightLayer ? [{ layer: "albedo", blend: "base" }, { layer: "light", blend: "multiply" }] : [{ layer: "albedo", blend: "base" }];
    fired.push(ids);
    return plan;
  });
  return { plan: { pixels: decided.pixels, sample: decided.sample, families }, fired: { sheet: sheetRule.id, blocks: fired } };
}
