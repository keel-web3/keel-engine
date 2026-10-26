// The material gauntlet: does a generated sheet still look like the exact one
// it came from? Both are read at art resolution, family block by family block,
// and compared on what the eye reads: the average cell (where light, rims and
// shapes sit), the palette, edge and texture contrast at a fine and a coarse
// scale, and how much cells differ from each other. A family passes when every
// measure is inside its limit; a sheet passes when every family does.

import { checkRaster, luminance, resampleArea } from "./raster.ts";
import type { Raster } from "./raster.ts";

export interface MaterialLayout {
  /** Family blocks per sheet row. */
  readonly blocks: number;
  /** Cells per block side. */
  readonly columns: number;
  /** Art pixels per cell side. */
  readonly pixels: number;
  /** The families' names, in block order. */
  readonly families: readonly string[];
}

/**
 * The limits. meanCell: RMS difference of the average cell (0..255 RGB).
 * palette: mean difference of the colour quantiles (0..255). The others are
 * the candidate's measure over the reference's, [low, high].
 */
export interface GauntletLimits {
  readonly meanCell: number;
  readonly palette: number;
  readonly edge: readonly [number, number];
  readonly fine: readonly [number, number];
  readonly coarse: readonly [number, number];
  readonly spread: readonly [number, number];
  readonly cellStd: readonly [number, number];
}

export const GAUNTLET_LIMITS: GauntletLimits = {
  meanCell: 13,
  palette: 8,
  // Pixel art may be crisper than a painted source, never blurrier, and only so much noisier.
  edge: [0.9, 1.5],
  fine: [0.9, 1.6],
  coarse: [0.9, 1.15],
  spread: [0.8, 1.3],
  cellStd: [0.65, 1.5],
};

/** Limits for an exemplar against its own sheet at variance 0: how much distilling may lose. */
export const FIDELITY_LIMITS: GauntletLimits = {
  meanCell: 2,
  palette: 3,
  edge: [0.95, 1.05],
  fine: [0.95, 1.05],
  coarse: [0.95, 1.05],
  spread: [0.95, 1.05],
  cellStd: [0.95, 1.05],
};

export interface FamilyScore {
  readonly name: string;
  readonly meanCell: number;
  readonly palette: number;
  readonly edge: number;
  readonly fine: number;
  readonly coarse: number;
  readonly spread: number;
  readonly cellStd: number;
  /** The measures outside their limits. */
  readonly failures: readonly (keyof GauntletLimits)[];
  readonly pass: boolean;
}

export interface GauntletScore {
  readonly families: readonly FamilyScore[];
  readonly pass: boolean;
}

interface Stats {
  readonly mean: Float64Array;
  readonly quantiles: number[][];
  readonly edge: number;
  readonly fine: number;
  readonly coarse: number;
  readonly spread: number;
  readonly cellStd: number;
}

function statsOf(art: Raster, layout: MaterialLayout, family: number): Stats {
  const { blocks, columns: C, pixels: N } = layout, Q = C * N;
  const ox = (family % blocks) * Q, oy = Math.floor(family / blocks) * Q;
  const at = (x: number, y: number, k: number): number => art.rgba[((oy + y) * art.width + ox + x) * 4 + k]!;
  const L = new Float64Array(Q * Q);
  for (let y = 0; y < Q; y += 1) for (let x = 0; x < Q; x += 1) L[y * Q + x] = luminance(at(x, y, 0), at(x, y, 1), at(x, y, 2));
  const mean = new Float64Array(N * N * 3), sq = new Float64Array(N * N), cellL: number[] = [];
  const channels: number[][] = [[], [], []];
  let edge = 0;
  for (let c = 0; c < C * C; c += 1) {
    let s = 0;
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        const X = (c % C) * N + x, Y = Math.floor(c / C) * N + y, l = L[Y * Q + X]!;
        for (let k = 0; k < 3; k += 1) { mean[(y * N + x) * 3 + k]! += at(X, Y, k) / (C * C); channels[k]!.push(at(X, Y, k)); }
        sq[y * N + x]! += (l * l) / (C * C);
        s += l;
        if (x + 1 < N) edge += Math.abs(L[Y * Q + X + 1]! - l);
        if (y + 1 < N) edge += Math.abs(L[(Y + 1) * Q + X]! - l);
      }
    }
    cellL.push(s / (N * N));
  }
  let spread = 0;
  for (let i = 0; i < N * N; i += 1) {
    const m = luminance(mean[i * 3]!, mean[i * 3 + 1]!, mean[i * 3 + 2]!);
    spread += Math.sqrt(Math.max(0, sq[i]! - m * m)) / (N * N);
  }
  const m = cellL.reduce((a, b) => a + b, 0) / cellL.length;
  const cellStd = Math.sqrt(cellL.reduce((a, b) => a + (b - m) ** 2, 0) / cellL.length);
  const quantiles = channels.map((v) => {
    v.sort((a, b) => a - b);
    return Array.from({ length: 21 }, (_, i) => v[Math.min(v.length - 1, Math.floor((i / 20) * v.length))]!);
  });
  const box = (r: number): Float64Array => {
    const out = new Float64Array(Q * Q);
    for (let y = 0; y < Q; y += 1) for (let x = 0; x < Q; x += 1) {
      let s = 0, count = 0;
      for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= Q || Y >= Q) continue;
        s += L[Y * Q + X]!; count += 1;
      }
      out[y * Q + x] = s / count;
    }
    return out;
  };
  const b1 = box(1), b3 = box(3);
  let fine = 0, coarse = 0;
  for (let i = 0; i < Q * Q; i += 1) { fine += Math.abs(L[i]! - b1[i]!); coarse += Math.abs(b1[i]! - b3[i]!); }
  return { mean, quantiles, edge: edge / (C * C), fine: fine / (Q * Q), coarse: coarse / (Q * Q), spread, cellStd };
}

/** The sheet at art resolution: one pixel per art pixel, by area. */
export function toArt(image: Raster, layout: MaterialLayout): Raster {
  checkRaster(image);
  const side = layout.columns * layout.pixels, rows = Math.ceil(layout.families.length / layout.blocks);
  const w = layout.blocks * side, h = rows * side;
  return image.width === w && image.height === h ? image : resampleArea(image, w, h);
}

/** Scores a candidate sheet against its reference; both are any size, read at the layout's art resolution. */
export function scoreMaterial(reference: Raster, candidate: Raster, layout: MaterialLayout, limits: GauntletLimits = GAUNTLET_LIMITS): GauntletScore {
  const ref = toArt(reference, layout), cand = toArt(candidate, layout);
  const ratio = (a: number, b: number): number => (b === 0 ? (a === 0 ? 1 : Infinity) : a / b);
  const families = layout.families.map((name, f): FamilyScore => {
    const o = statsOf(ref, layout, f), s = statsOf(cand, layout, f);
    let mc = 0;
    for (let i = 0; i < o.mean.length; i += 1) mc += (o.mean[i]! - s.mean[i]!) ** 2;
    let palette = 0;
    for (let k = 0; k < 3; k += 1) for (let i = 0; i < 21; i += 1) palette += Math.abs(o.quantiles[k]![i]! - s.quantiles[k]![i]!) / 63;
    const score = {
      name,
      meanCell: Math.sqrt(mc / o.mean.length),
      palette,
      edge: ratio(s.edge, o.edge),
      fine: ratio(s.fine, o.fine),
      coarse: ratio(s.coarse, o.coarse),
      spread: ratio(s.spread, o.spread),
      cellStd: ratio(s.cellStd, o.cellStd),
    };
    const failures: (keyof GauntletLimits)[] = [];
    if (score.meanCell > limits.meanCell) failures.push("meanCell");
    if (score.palette > limits.palette) failures.push("palette");
    for (const k of ["edge", "fine", "coarse", "spread", "cellStd"] as const) if (!(score[k] >= limits[k][0] && score[k] <= limits[k][1])) failures.push(k);
    return { ...score, failures, pass: failures.length === 0 };
  });
  return { families, pass: families.every((f) => f.pass) };
}
