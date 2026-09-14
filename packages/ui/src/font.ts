// Pixel fonts: every font the UI draws -- generated, imported from TTF/WOFF,
// BMFont or an image grid -- ends up as the same thing: 1-bit glyph bitmaps at
// one integer size, with advances and kerning pairs. No font is ever drawn
// scaled or filtered: a different size is a different font.
//
// Metrics, in pixels, y down from the baseline:
//   size        the cap height (what "an 8 px font" means here)
//   ascent      rows above the baseline a line needs
//   descent     rows below it
//   lineHeight  baseline to baseline
// A glyph's bitmap sits at (pen + ox, baseline + oy): oy is negative (its top row is above the baseline).

import type { Bitmap } from "./bitmap.ts";

export interface Glyph {
  readonly code: number;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
  /** Pen advance, tracking included. */
  readonly adv: number;
  /** w*h, 1 where ink. */
  readonly bits: Uint8Array;
}

export type FontSource = "generated" | "ttf" | "bmfont" | "grid" | "browser" | "codec";

export interface PixelFont {
  readonly name: string;
  readonly size: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineHeight: number;
  readonly glyphs: ReadonlyMap<number, Glyph>;
  /** Kerning by kernKey(a, b): pixels added to the advance between them. */
  readonly kern: ReadonlyMap<number, number>;
  /** A key naming this exact font (its content): the glyph atlas caches by it. */
  readonly key: string;
  readonly source: FontSource;
}

export const kernKey = (a: number, b: number): number => a * 0x200000 + b;

export interface FontInput {
  readonly name: string;
  readonly size: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineHeight: number;
  readonly glyphs: Iterable<Glyph>;
  readonly kern?: Iterable<readonly [number, number, number]>;
  readonly source: FontSource;
}

/** A font from its parts; its key is a hash of everything in it, so equal fonts share atlas entries. */
export function makeFont(input: FontInput): PixelFont {
  const glyphs = new Map<number, Glyph>();
  for (const g of input.glyphs) {
    if (g.bits.length !== g.w * g.h) throw new RangeError(`Glyph ${g.code}: ${g.bits.length} bits for ${g.w}x${g.h}.`);
    glyphs.set(g.code, g);
  }
  const kern = new Map<number, number>();
  for (const [a, b, dx] of input.kern ?? []) if (dx !== 0) kern.set(kernKey(a, b), dx);
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0; };
  for (const v of [input.size, input.ascent, input.descent, input.lineHeight]) mix(v);
  for (const code of [...glyphs.keys()].sort((a, b) => a - b)) {
    const g = glyphs.get(code)!;
    mix(code); mix(g.w); mix(g.h); mix(g.ox); mix(g.oy); mix(g.adv);
    let word = 0;
    for (let i = 0; i < g.bits.length; i += 1) { word = (word << 1) | g.bits[i]!; if ((i & 31) === 31) { mix(word); word = 0; } }
    mix(word);
  }
  for (const k of [...kern.keys()].sort((a, b) => a - b)) { mix(k % 0x200000); mix(Math.floor(k / 0x200000)); mix(kern.get(k)!); }
  return {
    name: input.name, size: input.size, ascent: input.ascent, descent: input.descent, lineHeight: input.lineHeight,
    glyphs, kern, key: `${input.source}:${input.name}:${input.size}:${h.toString(16)}`, source: input.source,
  };
}

const QUESTION = 63;
/** The glyph for a code point, or the font's stand-in ("?", else any). */
export function glyphOf(font: PixelFont, code: number): Glyph | undefined {
  return font.glyphs.get(code) ?? font.glyphs.get(QUESTION) ?? font.glyphs.values().next().value;
}

/** The width of a line of text in a font (kerning included, no wrapping). */
export function measure(font: PixelFont, text: string, { tabular = false }: { tabular?: boolean } = {}): number {
  let w = 0;
  let prev = -1;
  const digit = tabular ? digitAdvance(font) : 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const g = glyphOf(font, code);
    if (!g) continue;
    if (prev >= 0) w += font.kern.get(kernKey(prev, code)) ?? 0;
    w += tabular && code >= 48 && code <= 57 ? digit : g.adv;
    prev = code;
  }
  return w;
}

/** The widest digit's advance: tabular figures all take this. */
export function digitAdvance(font: PixelFont): number {
  let m = 0;
  for (let c = 48; c <= 57; c += 1) m = Math.max(m, font.glyphs.get(c)?.adv ?? 0);
  return m;
}

/** A glyph from a bitmap region (any non-transparent pixel is ink). */
export function glyphFromBitmap(code: number, src: Bitmap, x: number, y: number, w: number, h: number, ox: number, oy: number, adv: number): Glyph {
  const bits = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) {
    const sx = x + xx, sy = y + yy;
    if (sx >= 0 && sy >= 0 && sx < src.w && sy < src.h && (src.px[sy * src.w + sx]! >>> 24) >= 128) bits[yy * w + xx] = 1;
  }
  return { code, w, h, ox, oy, adv, bits };
}

/** Trim a glyph's empty rows and columns (keeping where it sits and how far it advances). */
export function trimGlyph(g: Glyph): Glyph {
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  for (let y = 0; y < g.h; y += 1) for (let x = 0; x < g.w; x += 1) if (g.bits[y * g.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return { ...g, w: 0, h: 0, bits: new Uint8Array(0) };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) bits[y * w + x] = g.bits[(y + y0) * g.w + x + x0]!;
  return { code: g.code, w, h, ox: g.ox + x0, oy: g.oy + y0, adv: g.adv, bits };
}
