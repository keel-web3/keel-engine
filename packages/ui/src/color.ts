// Colours as the UI layer holds them: one 32-bit word per pixel, RGBA bytes in
// memory order (a Uint32Array over the layer's bytes on a little-endian
// machine -- every browser and every Node we run on), so a pixel is written in
// one store and the layer's bytes go straight to a canvas or a texture.
// 0 is transparent; everything the UI draws is opaque (translucency is a
// dither, never an alpha smear).

import { oklch as oklchRgb } from "@keel-engine/core";
import type { RGB } from "@keel-engine/core";

/** A pixel: RGBA in memory order, as a little-endian uint32 (0xAABBGGRR). */
export type Rgba = number;

export const CLEAR: Rgba = 0;

export const rgba = (r: number, g: number, b: number, a = 255): Rgba => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
export const rgbOf = (c: Rgba): RGB => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
export const alphaOf = (c: Rgba): number => c >>> 24;
export const fromRgb = (rgb: readonly number[]): Rgba => rgba(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0);
/** An OKLCH colour as a pixel (chroma pulled in until it exists in sRGB). */
export const fromOklch = (L: number, C: number, h: number): Rgba => fromRgb(oklchRgb(L, C, h));

/** "#rrggbb" (or "#rgb") as a pixel. */
export function fromHex(hex: string): Rgba {
  let s = hex.replace(/^#/, "");
  if (s.length === 3) s = [...s].map((ch) => ch + ch).join("");
  const n = Number.parseInt(s.slice(0, 6), 16);
  if (!(s.length >= 6) || Number.isNaN(n)) throw new RangeError(`"${hex}" isn't a colour.`);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
export const toHex = (c: Rgba): string => `#${rgbOf(c).map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const lin = (v: number): number => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/** WCAG relative luminance, 0..1. */
export function luminance(c: Rgba): number {
  const [r, g, b] = rgbOf(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio, 1..21. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** sRGB bytes to OKLab (for distances and palette snapping). */
export function oklab(c: Rgba): [number, number, number] {
  const [r8, g8, b8] = rgbOf(c);
  const r = lin(r8), g = lin(g8), b = lin(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function labDistance(a: Rgba, b: Rgba): number {
  const p = oklab(a);
  const q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The nearest of a set of colours, in OKLab (palette snapping). */
export function nearest(c: Rgba, palette: readonly Rgba[]): Rgba {
  const p = oklab(c);
  let best = palette[0] ?? c;
  let bd = Infinity;
  for (const q of palette) {
    const l = oklab(q);
    const d = (p[0] - l[0]) ** 2 + (p[1] - l[1]) ** 2 + (p[2] - l[2]) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
