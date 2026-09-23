// A decal doc as bake decal texels: four bytes a texel -- ink (0 clear, 1..4), tone (128 + 16ths
// of an entry), lit (0..255), 255 -- the layout keel/bake's decal row and packs/vehicles' painted
// decals share, so a registered decal goes on a panel exactly like a generated one.

import { dcbrt, dpow, oklch } from "@keel-engine/core";
import { FONTS } from "./alphabet.ts";
import { STYLE, splitLines, type DecalDoc, type Ink } from "./doc.ts";

export interface DecalTexels { readonly width: number; readonly height: number; readonly texels: Uint8Array }

const LIT = 230;

export function rasterize(d: DecalDoc, { scale = 1 }: { scale?: number } = {}): DecalTexels {
  if (d.kind === "image") {
    const t = new Uint8Array(d.width * d.height * 4);
    d.texels.forEach((ink, i) => { if (ink) { t[i * 4] = ink; t[i * 4 + 1] = 128; t[i * 4 + 2] = LIT; t[i * 4 + 3] = 255; } });
    return { width: d.width, height: d.height, texels: t };
  }
  const f = FONTS[d.font];
  const lines = splitLines(d.glyphs);
  const s = Math.max(1, Math.floor(scale));
  const slant = d.style & STYLE.slant ? 1 : 0;
  const pad = (d.style & (STYLE.plate | STYLE.outline | STYLE.shadow) ? 2 : 0) * s;
  const widest = Math.max(1, ...lines.map((l) => l.length));
  const w = (widest * (f.cols + 1) - 1) * s + 2 * pad + slant * f.rows * s;
  const h = (lines.length * (f.rows + 2) - 2) * s + 2 * pad;
  // Ink roles by how many the decal has: text 1; plate the last; outline 2; shadow 3 (or the plate/outline ink).
  const n = d.inks.length;
  const textInk = 1, plateInk = n, outlineInk = Math.min(2, n), shadowInk = Math.min(3, n);
  const mask = new Uint8Array(w * h);
  lines.forEach((line, li) => {
    const x0 = pad + Math.floor(((widest - line.length) * (f.cols + 1) * s) / 2);
    const y0 = pad + li * (f.rows + 2) * s;
    line.forEach((g, gi) => {
      const rows = f.glyphs[g]!;
      rows.forEach((bits, ry) => {
        for (let rx = 0; rx < f.cols; rx += 1) {
          if (!(bits & (1 << (f.cols - 1 - rx)))) continue;
          const sx = x0 + (gi * (f.cols + 1) + rx) * s + slant * (f.rows - 1 - ry) * s, sy = y0 + ry * s;
          for (let yy = 0; yy < s; yy += 1) for (let xx = 0; xx < s; xx += 1) mask[(sy + yy) * w + sx + xx] = 1;
        }
      });
    });
  });
  const ink = new Uint8Array(w * h);
  if (d.style & STYLE.plate && n > 1) ink.fill(plateInk);
  const near = (x: number, y: number, dx: number, dy: number): boolean => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < w && Y < h && mask[Y * w + X] === 1; };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (mask[y * w + x]) continue;
    if (d.style & STYLE.shadow && n > 1 && near(x, y, -s, -s)) ink[y * w + x] = shadowInk;
    if (d.style & STYLE.outline && n > 1 && (near(x, y, 1, 0) || near(x, y, -1, 0) || near(x, y, 0, 1) || near(x, y, 0, -1))) ink[y * w + x] = outlineInk;
  }
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) ink[i] = textInk;
  const t = new Uint8Array(w * h * 4);
  ink.forEach((k, i) => { if (k) { t[i * 4] = k; t[i * 4 + 1] = 128; t[i * 4 + 2] = LIT; t[i * 4 + 3] = 255; } });
  return { width: w, height: h, texels: t };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** An RGBA picture as an image doc's texels: sized down to fit (never smoothed), alpha dithered by a 4x4 Bayer screen, each kept pixel its nearest ink in OKLab. */
export function imageTexels(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, inks: readonly Ink[], maxW = 96, maxH = 64): { width: number; height: number; texels: Uint8Array } {
  const s = Math.min(1, maxW / w, maxH / h);
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  const lab = inks.map((k) => toLab(...oklch(k.light, k.chroma, k.hue)));
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y += 1) for (let x = 0; x < tw; x += 1) {
    const from = (Math.floor((y * h) / th) * w + Math.floor((x * w) / tw)) * 4;
    if (rgba[from + 3]! <= BAYER[(y % 4) * 4 + (x % 4)]! * 16) continue;
    const p = toLab(rgba[from]!, rgba[from + 1]!, rgba[from + 2]!);
    let bi = 0, bd = Infinity;
    lab.forEach((q, i) => { const e = (p[0] - q[0]) ** 2 * 0.5 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (e < bd) { bd = e; bi = i; } });
    out[y * tw + x] = bi + 1;
  }
  return { width: tw, height: th, texels: out };
}

function toLab(r8: number, g8: number, b8: number): [number, number, number] {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : dpow((c + 0.055) / 1.055, 2.4); };
  const r = lin(r8), g = lin(g8), b = lin(b8);
  const l = dcbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = dcbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = dcbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export type { Ink };
