// Fonts the parser here doesn't read -- CFF-flavoured OpenType (OTF) and
// WOFF2 -- rasterised through the browser: the bytes go to a FontFace, each
// glyph is drawn to a canvas at the size that makes its cap height `size`
// pixels (measured off "H"), and the canvas's coverage goes through the same
// threshold and dropout pass as the TrueType path, so it comes out just as
// crisp. Browser only (it needs FontFace and a 2D canvas); in Node, use
// loadFont (TTF/WOFF1). The result is an ordinary PixelFont: store it with
// encodeFont and it never needs the browser again.

import { makeFont, trimGlyph } from "../font.ts";
import type { Glyph, PixelFont } from "../font.ts";
import { crisp } from "../raster.ts";

export interface BrowserFontOptions {
  readonly codes?: Iterable<number>;
  readonly threshold?: number;
  readonly family?: string;
  /** Measure kerning between these characters (default: letters and digits). */
  readonly kernChars?: string;
}

interface Canvas2D {
  font: string;
  textBaseline: string;
  fillStyle: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number; actualBoundingBoxAscent: number };
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

let serial = 0;

/**
 * Load a font the browser can read -- bytes (OTF, WOFF2, anything), or a CSS source ("local('Georgia')",
 * "url(font.woff2)") -- and rasterise it at a whole pixel size.
 */
export async function loadBrowserFont(data: ArrayBuffer | Uint8Array | string, size: number, o: BrowserFontOptions = {}): Promise<PixelFont> {
  const g = globalThis as unknown as { FontFace?: new (f: string, d: ArrayBuffer | string) => { load(): Promise<unknown> }; document?: { fonts: { add(f: unknown): void }; createElement(t: string): { width: number; height: number; getContext(k: string, o?: object): Canvas2D | null } } };
  if (!g.FontFace || !g.document) throw new Error("loadBrowserFont needs a browser (FontFace and a canvas). In Node, load TTF/WOFF with loadFont.");
  const family = o.family ?? `keel-ui-font-${++serial}`;
  const buf = data instanceof Uint8Array ? data.slice().buffer : data;
  const face = new g.FontFace(family, buf);
  await face.load();
  g.document.fonts.add(face);
  const canvas = g.document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D canvas.");
  ctx.font = `100px "${family}"`;
  const capAt100 = ctx.measureText("H").actualBoundingBoxAscent || 70;
  const px = (size * 100) / capAt100;
  const cell = Math.ceil(px * 2) + 4;
  canvas.width = cell; canvas.height = cell;
  ctx.font = `${px}px "${family}"`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  const base = Math.ceil(px * 1.3);
  const glyphs: Glyph[] = [];
  const codes = [...(o.codes ?? Array.from({ length: 95 }, (_, i) => 32 + i))];
  for (const code of codes) {
    const ch = String.fromCodePoint(code);
    ctx.clearRect(0, 0, cell, cell);
    ctx.fillText(ch, 2, base);
    const img = ctx.getImageData(0, 0, cell, cell).data;
    const cov = new Float32Array(cell * cell);
    for (let i = 0; i < cov.length; i += 1) cov[i] = img[i * 4 + 3]! / 255;
    const bits = crisp(cov, cell, cell, { threshold: o.threshold ?? 0.5 });
    glyphs.push(trimGlyph({ code, w: cell, h: cell, ox: -2, oy: -base, adv: Math.max(1, Math.round(ctx.measureText(ch).width + 0.3)), bits }));
  }
  const kern: Array<[number, number, number]> = [];
  const kc = [...(o.kernChars ?? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,")];
  const wOf = new Map(kc.map((c) => [c, ctx.measureText(c).width]));
  for (const a of kc) for (const b of kc) {
    const dx = Math.round(ctx.measureText(a + b).width - wOf.get(a)! - wOf.get(b)!);
    if (dx) kern.push([a.codePointAt(0)!, b.codePointAt(0)!, dx]);
  }
  const m = ctx.measureText("Hg") as unknown as { fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number };
  const ascent = Math.max(size, Math.round(m.fontBoundingBoxAscent ?? px * 0.9));
  const descent = Math.max(1, Math.round(m.fontBoundingBoxDescent ?? px * 0.25));
  return makeFont({ name: family, size, ascent, descent, lineHeight: ascent + descent + 1, glyphs, kern, source: "browser" });
}
