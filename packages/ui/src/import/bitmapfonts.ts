// Bitmap fonts: AngelCode BMFont (the text and XML descriptions, with their
// page images) and image-grid fonts (a sheet of equal cells in a known
// character order). Either becomes a PixelFont: glyphs trimmed to their ink,
// placed on the baseline, advances and kerning kept.
//
//   const font = bmFont(parseBmFont(fntText), [decodePng(pageBytes)]);
//   const font = gridFont(decodePng(sheet), { cellW: 8, cellH: 8, chars: " !\"#$%&'()*+,-./0123456789:;<=>?@ABC..." });

import type { Bitmap } from "../bitmap.ts";
import { makeFont, trimGlyph } from "../font.ts";
import type { Glyph, PixelFont } from "../font.ts";

export interface BmChar { id: number; x: number; y: number; width: number; height: number; xoffset: number; yoffset: number; xadvance: number; page: number }
export interface BmFontDesc {
  face: string;
  size: number;
  lineHeight: number;
  base: number;
  pages: string[];
  chars: BmChar[];
  kernings: Array<{ first: number; second: number; amount: number }>;
}

/** Parse a BMFont description: the text format ("char id=65 x=...") or the XML one (<char id="65" .../>). */
export function parseBmFont(src: string): BmFontDesc {
  const desc: BmFontDesc = { face: "bmfont", size: 0, lineHeight: 0, base: 0, pages: [], chars: [], kernings: [] };
  const xml = src.trimStart().startsWith("<");
  const lines = xml ? [...src.matchAll(/<(\w+)\s([^>]*?)\/?>/g)].map((m) => [m[1]!, m[2]!] as const) : src.split(/\r?\n/).map((l) => { const i = l.indexOf(" "); return [i < 0 ? l : l.slice(0, i), i < 0 ? "" : l.slice(i + 1)] as const; });
  for (const [kind, rest] of lines) {
    const a: Record<string, string> = {};
    for (const m of rest.matchAll(/(\w+)=("([^"]*)"|\S+)/g)) a[m[1]!] = m[3] ?? m[2]!;
    const n = (k: string): number => Number(a[k] ?? 0);
    if (kind === "info") { desc.face = a.face ?? desc.face; desc.size = Math.abs(n("size")); }
    else if (kind === "common") { desc.lineHeight = n("lineHeight"); desc.base = n("base"); }
    else if (kind === "page") desc.pages[n("id")] = a.file ?? "";
    else if (kind === "char") desc.chars.push({ id: n("id"), x: n("x"), y: n("y"), width: n("width"), height: n("height"), xoffset: n("xoffset"), yoffset: n("yoffset"), xadvance: n("xadvance"), page: n("page") });
    else if (kind === "kerning") desc.kernings.push({ first: n("first"), second: n("second"), amount: n("amount") });
  }
  if (!desc.chars.length) throw new RangeError("No characters in this BMFont description.");
  return desc;
}

// (Ink: opaque enough -- or, on a sheet with no transparency, brighter than its background.)
function inkTest(img: Bitmap): (c: number) => boolean {
  let opaque = true;
  for (let i = 0; i < img.px.length; i += 1) if ((img.px[i]! >>> 24) < 255) { opaque = false; break; }
  if (!opaque) return (c) => (c >>> 24) >= 128;
  const bg = img.px[0]!;
  const lum = (c: number) => (c & 255) * 0.299 + ((c >>> 8) & 255) * 0.587 + ((c >>> 16) & 255) * 0.114;
  const bl = lum(bg);
  return (c) => Math.abs(lum(c) - bl) >= 64;
}

function cut(img: Bitmap, ink: (c: number) => boolean, x: number, y: number, w: number, h: number): Uint8Array {
  const bits = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) {
    const sx = x + xx, sy = y + yy;
    if (sx >= 0 && sy >= 0 && sx < img.w && sy < img.h && ink(img.px[sy * img.w + sx]!)) bits[yy * w + xx] = 1;
  }
  return bits;
}

/** A BMFont (its description and page images) as a pixel font. */
export function bmFont(desc: BmFontDesc, pages: readonly Bitmap[], { name }: { name?: string } = {}): PixelFont {
  const inks = pages.map(inkTest);
  const glyphs: Glyph[] = desc.chars.map((c) => {
    const img = pages[c.page];
    if (!img) throw new RangeError(`Char ${c.id} is on page ${c.page}, which wasn't given.`);
    const g: Glyph = { code: c.id, w: c.width, h: c.height, ox: c.xoffset, oy: c.yoffset - desc.base, adv: c.xadvance, bits: cut(img, inks[c.page]!, c.x, c.y, c.width, c.height) };
    return trimGlyph(g);
  });
  const H = glyphs.find((g) => g.code === 72);
  const size = H && H.h ? H.h : desc.base;
  const descent = Math.max(1, desc.lineHeight - desc.base);
  return makeFont({ name: name ?? desc.face, size, ascent: desc.base, descent, lineHeight: desc.lineHeight || desc.base + descent + 1, glyphs, kern: desc.kernings.map((k) => [k.first, k.second, k.amount] as const), source: "bmfont" });
}

export interface GridFontOptions {
  readonly cellW: number;
  readonly cellH: number;
  /** The characters in cell order, left to right, top to bottom (default: ASCII 32..126). */
  readonly chars?: string;
  /** The baseline's row within a cell (default: the bottom row of "H"'s ink, plus one). */
  readonly baseline?: number;
  /** Pixels between glyphs (default 1). */
  readonly spacing?: number;
  /** Keep every glyph the cell's width (a monospace sheet). */
  readonly mono?: boolean;
  /** Cells start this far in (default 0). */
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly name?: string;
}

/** An image-grid font: equal cells, one character each. */
export function gridFont(img: Bitmap, o: GridFontOptions): PixelFont {
  const chars = [...(o.chars ?? Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(""))];
  const cols = Math.floor((img.w - (o.offsetX ?? 0)) / o.cellW);
  const ink = inkTest(img);
  const raw = chars.map((ch, i) => {
    const x = (o.offsetX ?? 0) + (i % cols) * o.cellW, y = (o.offsetY ?? 0) + Math.floor(i / cols) * o.cellH;
    return { code: ch.codePointAt(0)!, bits: cut(img, ink, x, y, o.cellW, o.cellH) };
  });
  let baseline = o.baseline;
  if (baseline === undefined) {
    const H = raw.find((r) => r.code === 72) ?? raw.find((r) => r.bits.some(Boolean));
    baseline = o.cellH;
    if (H) for (let y = o.cellH - 1; y >= 0; y -= 1) if (H.bits.subarray(y * o.cellW, (y + 1) * o.cellW).some(Boolean)) { baseline = y + 1; break; }
  }
  const spacing = o.spacing ?? 1;
  const glyphs: Glyph[] = raw.map(({ code, bits }) => {
    const t = trimGlyph({ code, w: o.cellW, h: o.cellH, ox: 0, oy: -baseline!, adv: o.cellW, bits });
    if (o.mono) return { ...t, adv: o.cellW };
    if (!t.w) return { ...t, adv: Math.max(2, Math.ceil(o.cellW / 2)) };
    return { ...t, ox: 0, adv: t.w + spacing };
  });
  let cap = baseline;
  const H = glyphs.find((g) => g.code === 72);
  if (H && H.h) cap = H.h;
  return makeFont({ name: o.name ?? "grid", size: cap, ascent: baseline, descent: Math.max(1, o.cellH - baseline), lineHeight: o.cellH + 1, glyphs, source: "grid" });
}
