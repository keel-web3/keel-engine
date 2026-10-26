// Reads an exact sheet into a material exemplar, and says what it is first.
//
// analyzeMaterialSheet measures before anything is decided: the block grid,
// the cell grid, whether the sheet is pixel art scaled up or painted, and,
// block by block, the evidence the rulebook reads (plates across cells, rows
// that change light, a second hue, framed cells, shading). It runs the
// rulebook (rules.ts) on that evidence and returns the plan with the rules
// that fired. It guesses what each block may depict from its colour, but what
// a block depicts, and what the sheet is for, is for the author to say.
//
// distillMaterial then follows a plan: each block at the plan's art
// resolution, its light split off when the plan says so, its colours
// quantised, and the pixel-art finish's palette taken from the composite.

import { checkExemplar, samplesPerSide } from "./exemplar.ts";
import type { ExemplarFamily, ExemplarLayer, MaterialExemplar } from "./exemplar.ts";
import { FIDELITY_LIMITS, scoreMaterial } from "./gauntlet.ts";
import type { GauntletScore } from "./gauntlet.ts";
import { recombineMaterialAtlas, upsample } from "./recipe.ts";
import { checkRaster, luminance, paletteRaster, quantize, resampleArea, resampleNearest, sampleMode } from "./raster.ts";
import type { Raster } from "./raster.ts";
import { planMaterial } from "./rules.ts";
import type { BlockEvidence, SheetEvidence, SheetPlan } from "./rules.ts";

export type SheetKind = "material-atlas" | "sprite-sheet" | "texture";

export interface BlockAnalysis {
  readonly index: number;
  /** The block's place in the sheet, in blocks. */
  readonly x: number;
  readonly y: number;
  /** The block's mean colour, #rrggbb. */
  readonly colour: string;
  /** What the colour suggests the block depicts: guesses for the author to confirm. */
  readonly looksLike: readonly string[];
  readonly evidence: BlockEvidence;
  /** The block rules that fired, in order. */
  readonly rules: readonly string[];
}

export interface SheetAnalysis {
  readonly kind: SheetKind;
  readonly width: number;
  readonly height: number;
  /** Family blocks across and down. */
  readonly blocks: { readonly x: number; readonly y: number };
  /** Cells per block side. */
  readonly columns: number;
  readonly evidence: SheetEvidence;
  /** The sheet rule that fired. */
  readonly rule: string;
  /** Texels per art pixel at the plan's art resolution. */
  readonly texelsPerArtPixel: number;
  /** Distinct colours in the sheet (capped at 4096). */
  readonly colours: number;
  readonly blockAnalyses: readonly BlockAnalysis[];
  /** What the rulebook decided: distil with this (after naming the families). */
  readonly plan: SheetPlan;
}

export interface AnalyzeOptions {
  /** Blocks across and down, when known; detected otherwise. */
  readonly blocks?: { readonly x: number; readonly y: number };
  /** Cells per block side, when known; detected otherwise. */
  readonly columns?: number;
}

const toHex = (c: readonly number[]): string => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function crop(image: Raster, x0: number, y0: number, w: number, h: number): Raster {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) rgba.set(image.rgba.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, rgba };
}

// A block cut from a sheet, its edges mended: painters let a neighbour's
// texels bleed a pixel or two over the line (snow's top under the leaves), and
// moved cells would carry that bleed into the middle as a dash. A texel near an
// edge whose colour the block's inside never uses takes the texel mirrored
// inward across the bleed's depth.
function blockOf(image: Raster, x0: number, y0: number, w: number, h: number, cellTexels: number): Raster {
  const block = crop(image, x0, y0, w, h), depth = Math.max(2, Math.round(cellTexels / 16));
  const inside = crop(block, 2 * depth, 2 * depth, w - 4 * depth, h - 4 * depth);
  const { palette } = quantize(inside.rgba, 48);
  const stray = (i: number): boolean => {
    let best = Infinity;
    for (let c = 0; c < palette.length; c += 4) best = Math.min(best, Math.hypot(block.rgba[i]! - palette[c]!, block.rgba[i + 1]! - palette[c + 1]!, block.rgba[i + 2]! - palette[c + 2]!, block.rgba[i + 3]! - palette[c + 3]!));
    return best > 48;
  };
  const mend = (x: number, y: number, fx: number, fy: number): void => {
    const i = (y * w + x) * 4;
    if (stray(i)) block.rgba.copyWithin(i, (fy * w + fx) * 4, (fy * w + fx) * 4 + 4);
  };
  for (let d = 0; d < depth; d += 1) {
    for (let x = 0; x < w; x += 1) { mend(x, d, x, 2 * depth - d); mend(x, h - 1 - d, x, h - 1 - 2 * depth + d); }
    for (let y = 0; y < h; y += 1) { mend(d, y, 2 * depth - d, y); mend(w - 1 - d, y, w - 1 - 2 * depth + d, y); }
  }
  return block;
}

// The colour step across a line of the sheet: the mean colour of the band
// just before it against the band just after it.
function stepAt(image: Raster, axis: "x" | "y", at: number, band: number): number {
  const means = [at - band, at].map((from) => {
    const sum = [0, 0, 0];
    let count = 0;
    for (let i = Math.max(0, from); i < Math.min(axis === "x" ? image.width : image.height, from + band); i += 1) {
      for (let j = 0; j < (axis === "x" ? image.height : image.width); j += 1) {
        const o = (axis === "x" ? j * image.width + i : i * image.width + j) * 4;
        for (let k = 0; k < 3; k += 1) sum[k]! += image.rgba[o + k]!;
        count += 1;
      }
    }
    return sum.map((v) => v / count);
  });
  return Math.hypot(...[0, 1, 2].map((k) => means[0]![k]! - means[1]![k]!));
}

// How many blocks run along an axis: the most even split whose every line is
// a sharp colour step, well above the steps across the blocks' middles.
// (Shading changes gradually; a new block changes at once.)
function blocksAlong(image: Raster, axis: "x" | "y"): number {
  const size = axis === "x" ? image.width : image.height;
  let best = 1;
  for (let n = 2; n <= 4; n += 1) {
    const band = Math.max(1, Math.floor(size / (2 * n)));
    const lines = Array.from({ length: n - 1 }, (_, k) => stepAt(image, axis, Math.round(((k + 1) * size) / n), band));
    const middles = Array.from({ length: n }, (_, k) => stepAt(image, axis, Math.round(((k + 0.5) * size) / n), Math.max(1, Math.floor(band / 2))));
    const control = [...middles].sort((a, b) => a - b)[middles.length >> 1]!;
    if (Math.min(...lines) > Math.max(24, control * 2.5)) best = n;
  }
  return best;
}

// The cell period of a block, in texels: the smallest strong peak of its
// high-passed light profiles' autocorrelation (multiples repeat, less sharply).
function cellPeriod(block: Raster): number {
  const profile = (axis: "x" | "y"): Float64Array => {
    const n = axis === "x" ? block.width : block.height, other = axis === "x" ? block.height : block.width;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j = 0; j < other; j += 1) {
        const o = (axis === "x" ? j * block.width + i : i * block.width + j) * 4;
        s += luminance(block.rgba[o]!, block.rgba[o + 1]!, block.rgba[o + 2]!);
      }
      out[i] = s / other;
    }
    const k = Math.max(2, Math.floor(n / 24));
    return out.map((v, i) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j += 1) { s += out[j]!; c += 1; }
      return v - s / c;
    });
  };
  const px = profile("x"), py = profile("y");
  const n = Math.min(block.width, block.height);
  const r = (lag: number): number => {
    let s = 0, e = 0;
    for (const p of [px, py]) for (let i = 0; i + lag < p.length; i += 1) { s += p[i]! * p[i + lag]!; e += p[i]! * p[i]!; }
    return s / Math.max(1e-9, e);
  };
  const lags = Array.from({ length: Math.max(0, Math.floor(n / 2) - 2) }, (_, i) => i + 3);
  const scores = lags.map(r);
  const top = Math.max(0, ...scores);
  for (let i = 1; i + 1 < lags.length; i += 1) {
    if (scores[i]! >= scores[i - 1]! && scores[i]! >= scores[i + 1]! && scores[i]! >= top * 0.6) return lags[i]!;
  }
  return n;
}

// Pixel art scaled up has a knee: some coarse art size rebuilds the block
// (area down, nearest up) almost as well as full size does.
function knee(block: Raster, columns: number): number | undefined {
  const most = Math.max(4, Math.min(64, Math.floor(block.width / columns)));
  for (const p of [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32].filter((q) => q * 1.5 <= most)) {
    const side = p * columns;
    const back = resampleNearest(resampleArea(block, side, side), block.width, block.height);
    let e = 0;
    for (let i = 0; i < block.rgba.length; i += 4) e += Math.abs(luminance(block.rgba[i]!, block.rgba[i + 1]!, block.rgba[i + 2]!) - luminance(back.rgba[i]!, back.rgba[i + 1]!, back.rgba[i + 2]!));
    if (e / (block.width * block.height) < 1.5) return p;
  }
  return undefined;
}

function looksLike([r, g, b]: readonly number[]): string[] {
  const l = luminance(r!, g!, b!), max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!), sat = max === 0 ? 0 : (max - min) / max;
  if (l > 140 && sat < 0.25) return ["snow", "ice", "cloud", "plaster"];
  if (sat < 0.15) return l < 90 ? ["stone", "slate", "metal"] : ["stone", "concrete", "ash"];
  if (g! >= r! && g! >= b!) return ["foliage", "grass", "moss"];
  if (r! > g! && g! > b! && l < 70) return ["bark", "wood", "earth"];
  if (r! > g! * 1.4 && g! > b!) return ["autumn leaves", "fire", "clay", "brick"];
  if (r! > g! && b! > g!) return ["blossom", "petals", "crystal"];
  if (b! >= r! && b! >= g!) return ["water", "ice", "night sky"];
  return ["wood", "sand", "earth"];
}

// The block's smooth light: its luminance blurred over a third of a cell,
// over the block's mean (1 is average), per pixel.
function smoothLight(block: Raster, cellTexels: number): Float32Array {
  const { width: w, height: h } = block, r = Math.max(1, Math.round(cellTexels / 3));
  const L = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i += 1) { L[i] = luminance(block.rgba[i * 4]!, block.rgba[i * 4 + 1]!, block.rgba[i * 4 + 2]!); mean += L[i]! / (w * h); }
  const blur = (src: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let s = 0, c = 0;
      for (let d = -r; d <= r; d += 1) {
        const X = horizontal ? x + d : x, Y = horizontal ? y : y + d;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        s += src[Y * w + X]!; c += 1;
      }
      out[y * w + x] = s / c;
    }
    return out;
  };
  const smooth = blur(blur(L, true), false);
  const light = smooth.map((v) => Math.max(0.2, Math.min(1.99, v / Math.max(1, mean))));
  // A bright block's albedo would pass white where its light is below the
  // mean (snow): lift the light until the brightest albedo just fits.
  let over = 1;
  for (let i = 0; i < w * h; i += 1) over = Math.max(over, Math.max(block.rgba[i * 4]!, block.rgba[i * 4 + 1]!, block.rgba[i * 4 + 2]!) / light[i]! / 255);
  return over === 1 ? light : light.map((v) => Math.min(1.99, v * over));
}

function blockEvidence(art: Raster, columns: number, pixels: number, light: Float32Array): BlockEvidence {
  const n = pixels, side = n * columns;
  const L = (px: number, py: number): number => { const o = (py * side + px) * 4; return luminance(art.rgba[o]!, art.rgba[o + 1]!, art.rgba[o + 2]!); };
  // Gap rows per cell column, and how many have no gap beside them in the next.
  const gapRows: number[][] = [];
  for (let c = 0; c < columns; c += 1) {
    const inner = Math.max(1, Math.floor(n / 8));
    const rows = Array.from({ length: side }, (_, py) => { let s = 0; for (let px = c * n + inner; px < c * n + n - inner; px += 1) s += L(px, py); return s / (n - 2 * inner); });
    const median = [...rows].sort((a, b) => a - b)[side >> 1]!;
    const found: number[] = [];
    for (let py = 1; py < side - n / 2; py += 1) if (rows[py]! < median * 0.6 && rows[py - 1]! >= median * 0.6) found.push(py);
    gapRows.push(found);
  }
  const reach = Math.max(2, Math.round(n / 5));
  let gaps = 0, staggered = 0;
  gapRows.forEach((found, c) => {
    for (const py of found) {
      gaps += 1;
      const beside = [gapRows[c - 1], gapRows[c + 1]].filter((g) => g !== undefined);
      if (beside.every((g) => !g.some((q) => Math.abs(q - py) <= reach))) staggered += 1;
    }
  });
  const rowLight = Array.from({ length: columns }, (_, r) => { let s = 0; for (let py = r * n; py < (r + 1) * n; py += 1) for (let px = 0; px < side; px += 1) s += L(px, py); return s / (n * side); });
  const overall = rowLight.reduce((a, b) => a + b, 0) / columns;
  const raw = Array.from({ length: columns * columns }, (_, c) => {
    let a = 0, b = 0;
    for (let py = Math.floor(c / columns) * n; py < (Math.floor(c / columns) + 1) * n; py += 1) for (let px = (c % columns) * n; px < (c % columns + 1) * n; px += 1) {
      const o = (py * side + px) * 4;
      a += art.rgba[o]! - art.rgba[o + 1]!; b += art.rgba[o + 1]! - art.rgba[o + 2]!;
    }
    return [a / (n * n), b / (n * n)] as const;
  });
  // Each cell's chroma less its row's: banding down a block isn't a second hue.
  const chroma = raw.map((c, i) => {
    const row = raw.filter((_, j) => Math.floor(j / columns) === Math.floor(i / columns));
    return [c[0] - row.reduce((t, r) => t + r[0], 0) / row.length, c[1] - row.reduce((t, r) => t + r[1], 0) / row.length] as const;
  });
  let centres = [chroma.reduce((m, c) => (c[1] < m[1] ? c : m)), chroma.reduce((m, c) => (c[1] > m[1] ? c : m))];
  for (let round = 0; round < 8; round += 1) {
    const groups = [[], []] as (readonly [number, number])[][];
    for (const c of chroma) groups[Math.hypot(c[0] - centres[1]![0], c[1] - centres[1]![1]) < Math.hypot(c[0] - centres[0]![0], c[1] - centres[0]![1]) ? 1 : 0]!.push(c);
    centres = groups.map((g, i) => (g.length === 0 ? centres[i]! : ([g.reduce((t, m) => t + m[0], 0) / g.length, g.reduce((t, m) => t + m[1], 0) / g.length] as const)));
  }
  let rim = 0, middle = 0, rimCount = 0, middleCount = 0;
  for (let py = 0; py < side; py += 1) for (let px = 0; px < side; px += 1) {
    const e = Math.min(px % n, py % n, n - 1 - (px % n), n - 1 - (py % n));
    if (e === 0) { rim += L(px, py); rimCount += 1; } else if (e >= n / 4) { middle += L(px, py); middleCount += 1; }
  }
  let lm = 0, lv = 0;
  for (const v of light) lm += v / light.length;
  for (const v of light) lv += (v - lm) ** 2 / light.length;
  return {
    staggeredGaps: gaps === 0 ? 0 : staggered / gaps,
    gaps,
    rowLightRange: (Math.max(...rowLight) - Math.min(...rowLight)) / Math.max(1, overall),
    hueSplit: Math.hypot(centres[0]![0] - centres[1]![0], centres[0]![1] - centres[1]![1]),
    rimContrast: 1 - rim / rimCount / Math.max(1, middle / middleCount),
    lightStrength: Math.sqrt(lv) / Math.max(1e-6, lm),
  };
}

/** Looks at a sheet, measures the evidence the rulebook reads, and runs it. */
export function analyzeMaterialSheet(image: Raster, options: AnalyzeOptions = {}): SheetAnalysis {
  checkRaster(image);
  let transparentPixels = 0;
  for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i]! < 250) transparentPixels += 1;
  const transparent = transparentPixels > image.width * image.height * 0.05;
  const blocks = options.blocks ?? { x: blocksAlong(image, "x"), y: blocksAlong(image, "y") };
  const bw = Math.floor(image.width / blocks.x), bh = Math.floor(image.height / blocks.y);
  const raw = Array.from({ length: blocks.x * blocks.y }, (_, b) => crop(image, (b % blocks.x) * bw, Math.floor(b / blocks.x) * bh, bw, bh));
  const columns = options.columns ?? Math.max(1, Math.round(Math.min(bw, bh) / cellPeriod(raw[0]!)));
  const crops = transparent ? raw : raw.map((_, b) => blockOf(image, (b % blocks.x) * bw, Math.floor(b / blocks.x) * bh, bw, bh, Math.min(bw, bh) / columns));
  const knees = crops.map((c) => knee(c, columns));
  const sheet: SheetEvidence = {
    transparent,
    knee: knees.every((k) => k !== undefined) ? Math.max(...(knees as number[])) : undefined,
    cellTexels: Math.min(bw, bh) / columns,
  };
  const pixels = sheet.knee ?? Math.max(4, Math.min(24, Math.floor(sheet.cellTexels / 1.5))), side = pixels * columns;
  const seen = new Set<number>();
  const evidence = crops.map((block) => {
    for (let i = 0; i < block.rgba.length && seen.size < 4096; i += 4) seen.add((block.rgba[i]! << 16) | (block.rgba[i + 1]! << 8) | block.rgba[i + 2]!);
    return blockEvidence(resampleArea(block, side, side), columns, pixels, smoothLight(block, bw / columns));
  });
  const { plan, fired } = planMaterial(sheet, evidence);
  const blockAnalyses = crops.map((block, b): BlockAnalysis => {
    const mean = [0, 1, 2].map((k) => { let s = 0; for (let i = k; i < block.rgba.length; i += 4) s += block.rgba[i]!; return s / (block.width * block.height); });
    return { index: b, x: b % blocks.x, y: Math.floor(b / blocks.x), colour: toHex(mean), looksLike: looksLike(mean), evidence: evidence[b]!, rules: fired.blocks[b]! };
  });
  const kind: SheetKind = transparent ? "sprite-sheet" : columns >= 2 ? "material-atlas" : "texture";
  return { kind, width: image.width, height: image.height, blocks, columns, evidence: sheet, rule: fired.sheet, texelsPerArtPixel: bw / side, colours: seen.size, blockAnalyses, plan };
}

export interface DistillOptions {
  /** One name per block, in reading order: what the author says each block depicts (lowercase slugs). */
  readonly names: readonly string[];
  readonly blocks: { readonly x: number; readonly y: number };
  readonly columns: number;
  /** The rulebook's plan (from analyzeMaterialSheet), as is or overruled. */
  readonly plan: SheetPlan;
}

export interface Distilled {
  readonly exemplar: MaterialExemplar;
  /** How much distilling lost: each family's layers composited (no finish), against the sheet, with the strict fidelity limits. */
  readonly fidelity: GauntletScore;
  /** The finished exemplar at variance 0 against the sheet, with the gauntlet's limits: what the collector sees before any seed. */
  readonly finished: GauntletScore;
}

// A palette layer: the fewest colours of `tries` whose quantising loses
// nothing visible against `target` (read at art resolution).
// `light`, when given, is the stored light the layer will be multiplied by, so
// the choice is judged on what shows.
function paletteLayer(name: string, image: Raster, target: Raster, columns: number, pixels: number, tries: readonly number[], sample: "mean" | "mode", side: number, light?: Uint8Array): ExemplarLayer & { kind: "palette" } {
  const rgba = Uint8Array.from(image.rgba);
  const shown = (r: Raster): Raster => {
    if (light === undefined) return r;
    const lit = Uint8Array.from(r.rgba);
    for (let i = 0; i < light.length; i += 1) for (let k = 0; k < 3; k += 1) lit[i * 4 + k] = Math.min(255, Math.round((r.rgba[i * 4 + k]! * light[i]!) / 128));
    return { ...r, rgba: lit };
  };
  let kept = quantize(rgba, tries[0]!);
  for (const count of tries) {
    if (count !== tries[0]) kept = quantize(rgba, count);
    const f = scoreMaterial(target, shown(paletteRaster(kept.palette, kept.indices, image.width, image.height)), { blocks: 1, columns, pixels, families: [name] }, FIDELITY_LIMITS).families[0]!;
    // With headroom: the moves, the finish and the block's mended edges each cost a little more.
    if (f.meanCell <= FIDELITY_LIMITS.meanCell * 0.75 && f.palette <= FIDELITY_LIMITS.palette * 0.75 && f.failures.length === 0) break;
  }
  const indices = sample === "mode" && (image.width !== side || image.height !== side) ? sampleMode(kept.indices, image.width, image.height, side, side) : kept.indices;
  return { name, kind: "palette", palette: kept.palette, indices };
}

/** Distils a sheet into an exemplar by a plan: the families named by the author, the layers, recipes and finish the rulebook decided. */
export function distillMaterial(image: Raster, { names, blocks, columns, plan }: DistillOptions): Distilled {
  checkRaster(image);
  if (names.length !== blocks.x * blocks.y || plan.families.length !== names.length) throw new RangeError("Name every block, one plan per block.");
  const { pixels, sample } = plan, side = pixels * columns;
  const bw = Math.floor(image.width / blocks.x), bh = Math.floor(image.height / blocks.y);
  const targets: Raster[] = [];
  const families = names.map((name, f): ExemplarFamily => {
    const fp = plan.families[f]!;
    const block = plan.sample === "mode" ? crop(image, (f % blocks.x) * bw, Math.floor(f / blocks.x) * bh, bw, bh) : blockOf(image, (f % blocks.x) * bw, Math.floor(f / blocks.x) * bh, bw, bh, Math.min(bw, bh) / columns);
    const layers: ExemplarLayer[] = [];
    let albedo: Raster = block;
    let art = resampleArea(block, side, side), stored: Uint8Array | undefined;
    const target = art;
    targets[f] = target;
    if (fp.lightLayer) {
      // The light on its own, and the colour with the stored light divided out: albedo x light/128 rebuilds the block.
      const light = smoothLight(block, bw / columns);
      const lightArt = resampleArea({ width: block.width, height: block.height, rgba: Uint8Array.from({ length: light.length * 4 }, (_, i) => (i % 4 === 3 ? 255 : Math.round(light[i >> 2]! * 128))) }, side, side);
      const samples = samplesPerSide(side, fp.lightScale);
      const values = new Uint8Array(samples * samples);
      for (let j = 0; j < samples; j += 1) for (let i = 0; i < samples; i += 1) {
        const x = Math.max(0, Math.min(side - 1, Math.round((i + 0.5) * fp.lightScale - 0.5))), y = Math.max(0, Math.min(side - 1, Math.round((j + 0.5) * fp.lightScale - 0.5)));
        values[j * samples + i] = lightArt.rgba[(y * side + x) * 4]!;
      }
      layers.push({ name: "light", kind: "scalar", scale: fp.lightScale, values });
      stored = upsample(values, samples, fp.lightScale, side);
      const rgba = new Uint8Array(art.rgba.length);
      for (let i = 0; i < stored.length; i += 1) {
        for (let k = 0; k < 3; k += 1) rgba[i * 4 + k] = Math.min(255, Math.round((art.rgba[i * 4 + k]! * 128) / Math.max(1, stored[i]!)));
        rgba[i * 4 + 3] = art.rgba[i * 4 + 3]!;
      }
      albedo = art = { width: side, height: side, rgba };
    }
    layers.unshift(paletteLayer("albedo", sample === "mean" ? art : albedo, target, columns, pixels, fp.albedoColours ?? [16, 24, 32, 48, 64, 96, 128], sample, side, stored));
    return { name, layers, compose: fp.compose, recipe: fp.recipe };
  });
  // The finish palette: from each family's composite at variance 0, the fewest colours that keep it.
  const bare = checkExemplar({ pixels, columns, blocks: blocks.x, families });
  const composite = recombineMaterialAtlas({ exemplar: bare, variance: 0, size: blocks.x * side });
  const finished = families.map((family, f): ExemplarFamily => {
    const fp = plan.families[f]!;
    if (fp.finish === undefined) return family;
    const art = crop(composite.art, (f % blocks.x) * side, Math.floor(f / blocks.x) * side, side, side);
    const { palette } = paletteLayer("finish", art, art, columns, pixels, fp.finish.colours, "mean", side);
    return { ...family, finish: { palette, dither: fp.finish.dither, amount: fp.finish.amount, clean: fp.finish.clean } };
  });
  const exemplar = checkExemplar({ pixels, columns, blocks: blocks.x, families: finished });
  const layout = { blocks: blocks.x, columns, pixels, families: [...names] };
  // The sheet as distilled (its block edges mended), at art resolution.
  const reference = { width: blocks.x * side, height: blocks.y * side, rgba: new Uint8Array(blocks.x * blocks.y * side * side * 4) };
  targets.forEach((t, f) => { for (let y = 0; y < side; y += 1) reference.rgba.set(t.rgba.subarray(y * side * 4, (y + 1) * side * 4), ((Math.floor(f / blocks.x) * side + y) * reference.width + (f % blocks.x) * side) * 4); });
  return {
    exemplar,
    fidelity: scoreMaterial(reference, composite.art, layout, FIDELITY_LIMITS),
    finished: scoreMaterial(reference, recombineMaterialAtlas({ exemplar, variance: 0, size: blocks.x * side }).art, layout),
  };
}
