// TrueType (and WOFF 1.0 wrapping TrueType) parsed here, in plain
// TypeScript: cmap (formats 4 and 12), head/hhea/maxp/hmtx/loca/glyf (simple
// and composite glyphs), kern (format 0), OS/2's cap and x-heights. CFF-based
// OpenType ("OTTO") and WOFF2 aren't parsed -- rasterise those through the
// browser (browser.ts: FontFace + canvas) instead; parseFont says so.
//
// rasteriseFont then draws the outlines at a whole pixel size with a
// hinting pass for pixel art: the scale is chosen so the cap height is
// exactly `size` pixels, vertical positions are mapped piecewise so the
// baseline, x-height and cap line land on pixel edges (the blue zones), and
// coverage becomes pixels through a threshold with dropout control
// (raster.ts) -- crisp, no blur, no broken stems.

import { makeFont, trimGlyph } from "../font.ts";
import type { Glyph, PixelFont } from "../font.ts";
import { crisp, quadTo, rasterize } from "../raster.ts";
import type { Contour } from "../raster.ts";
import { inflate } from "./inflate.ts";

export interface SfntFont {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly numGlyphs: number;
  /** Code point to glyph index. */
  readonly cmap: ReadonlyMap<number, number>;
  readonly advance: (glyph: number) => number;
  /** A glyph's outline: contours of [x, y, onCurve] points, font units, y up. */
  readonly outline: (glyph: number) => Array<Array<[number, number, boolean]>>;
  /** Kerning by (left glyph << 16 | right glyph), font units. */
  readonly kern: ReadonlyMap<number, number>;
  readonly name: string;
}

const tag = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

/** The tables of a TTF or WOFF1 file, by tag. */
export function sfntTables(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = tag(bytes, 0);
  const tables = new Map<string, Uint8Array>();
  if (sig === "wOF2") throw new RangeError("WOFF2 isn't parsed here (Brotli): load it with loadBrowserFont, or convert it to TTF.");
  if (sig === "wOFF") {
    const flavor = dv.getUint32(4);
    if (flavor === 0x4f54544f) throw new RangeError("This WOFF wraps CFF outlines (OpenType/OTTO): load it with loadBrowserFont.");
    const n = dv.getUint16(12);
    for (let i = 0; i < n; i += 1) {
      const e = 44 + i * 20;
      const t = tag(bytes, e);
      const off = dv.getUint32(e + 4), comp = dv.getUint32(e + 8), orig = dv.getUint32(e + 12);
      const raw = bytes.subarray(off, off + comp);
      tables.set(t, comp < orig ? inflate(raw, orig) : raw);
    }
    return tables;
  }
  if (sig === "OTTO") throw new RangeError("This is CFF-flavoured OpenType (OTTO): load it with loadBrowserFont, or use a TrueType (glyf) build.");
  if (dv.getUint32(0) !== 0x00010000 && sig !== "true") throw new RangeError("Not a TrueType font.");
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i += 1) {
    const e = 12 + i * 16;
    tables.set(tag(bytes, e), bytes.subarray(dv.getUint32(e + 8), dv.getUint32(e + 8) + dv.getUint32(e + 12)));
  }
  return tables;
}

const view = (t: Uint8Array): DataView => new DataView(t.buffer, t.byteOffset, t.byteLength);

function parseCmap(t: Uint8Array): Map<number, number> {
  const d = view(t);
  const n = d.getUint16(2);
  let best = -1, bestScore = -1;
  for (let i = 0; i < n; i += 1) {
    const pid = d.getUint16(4 + i * 8), eid = d.getUint16(6 + i * 8), off = d.getUint32(8 + i * 8);
    const fmt = d.getUint16(off);
    const score = fmt === 12 ? (pid === 3 && eid === 10 ? 5 : pid === 0 ? 4 : 0) : fmt === 4 ? (pid === 3 && eid === 1 ? 3 : pid === 0 ? 2 : 0) : 0;
    if (score > bestScore) { bestScore = score; best = off; }
  }
  const map = new Map<number, number>();
  if (best < 0 || bestScore <= 0) return map;
  const fmt = d.getUint16(best);
  if (fmt === 4) {
    const segX2 = d.getUint16(best + 6);
    const ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s += 1) {
      const end = d.getUint16(ends + s * 2), start = d.getUint16(starts + s * 2), delta = d.getInt16(deltas + s * 2), ro = d.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c += 1) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + ro + (c - start) * 2;
          g = d.getUint16(at);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (fmt === 12) {
    const groups = d.getUint32(best + 12);
    for (let i = 0; i < groups; i += 1) {
      const o = best + 16 + i * 12;
      const s = d.getUint32(o), e = d.getUint32(o + 4), g0 = d.getUint32(o + 8);
      for (let c = s; c <= e && c - s < 0x10000; c += 1) map.set(c, g0 + c - s);
    }
  }
  return map;
}

/** Parse a TTF or WOFF1 (TrueType outlines). */
export function parseFont(bytes: Uint8Array, name = "imported"): SfntFont {
  const T = sfntTables(bytes);
  const need = (t: string): Uint8Array => { const v = T.get(t); if (!v) throw new RangeError(`The font has no ${t} table${t === "glyf" ? " (CFF outlines? use loadBrowserFont)" : ""}.`); return v; };
  const head = view(need("head")), hhea = view(need("hhea")), maxp = view(need("maxp"));
  const unitsPerEm = head.getUint16(18);
  const longLoca = head.getInt16(50) === 1;
  const numGlyphs = maxp.getUint16(4);
  const nHM = hhea.getUint16(34);
  const hmtx = view(need("hmtx"));
  const loca = view(need("loca"));
  const glyf = need("glyf");
  const gv = view(glyf);
  const cmap = parseCmap(need("cmap"));
  const os2 = T.get("OS/2");
  let capHeight = 0, xHeight = 0;
  if (os2 && os2.length >= 90 && view(os2).getUint16(0) >= 2) { xHeight = view(os2).getInt16(86); capHeight = view(os2).getInt16(88); }
  const off = (g: number): [number, number] => longLoca ? [loca.getUint32(g * 4), loca.getUint32(g * 4 + 4)] : [loca.getUint16(g * 2) * 2, loca.getUint16(g * 2 + 2) * 2];
  const advance = (g: number): number => hmtx.getUint16(Math.min(g, nHM - 1) * 4);

  const outline = (g: number, depth = 0): Array<Array<[number, number, boolean]>> => {
    if (g < 0 || g >= numGlyphs || depth > 8) return [];
    const [a, b] = off(g);
    if (b <= a) return [];
    const nC = gv.getInt16(a);
    if (nC >= 0) {
      const endPts: number[] = [];
      for (let i = 0; i < nC; i += 1) endPts.push(gv.getUint16(a + 10 + i * 2));
      const nPts = nC ? endPts[nC - 1]! + 1 : 0;
      let p = a + 10 + nC * 2;
      p += 2 + gv.getUint16(p);
      const flags: number[] = [];
      while (flags.length < nPts) {
        const f = glyf[p++]!;
        flags.push(f);
        if (f & 8) { let r = glyf[p++]!; while (r-- > 0) flags.push(f); }
      }
      const xs: number[] = [], ys: number[] = [];
      let v = 0;
      for (const f of flags) { if (f & 2) { const d = glyf[p++]!; v += f & 16 ? d : -d; } else if (!(f & 16)) { v += gv.getInt16(p); p += 2; } xs.push(v); }
      v = 0;
      for (const f of flags) { if (f & 4) { const d = glyf[p++]!; v += f & 32 ? d : -d; } else if (!(f & 32)) { v += gv.getInt16(p); p += 2; } ys.push(v); }
      const out: Array<Array<[number, number, boolean]>> = [];
      let s = 0;
      for (const e of endPts) { const c: Array<[number, number, boolean]> = []; for (let i = s; i <= e; i += 1) c.push([xs[i]!, ys[i]!, !!(flags[i]! & 1)]); out.push(c); s = e + 1; }
      return out;
    }
    // Composite: parts, each moved (and maybe scaled).
    const out: Array<Array<[number, number, boolean]>> = [];
    let p = a + 10;
    for (;;) {
      const flags = gv.getUint16(p), gi = gv.getUint16(p + 2);
      p += 4;
      let dx: number, dy: number;
      if (flags & 1) { dx = gv.getInt16(p); dy = gv.getInt16(p + 2); p += 4; } else { dx = gv.getInt8(p); dy = gv.getInt8(p + 1); p += 2; }
      let m = [1, 0, 0, 1];
      if (flags & 8) { const s = gv.getInt16(p) / 16384; m = [s, 0, 0, s]; p += 2; }
      else if (flags & 0x40) { m = [gv.getInt16(p) / 16384, 0, 0, gv.getInt16(p + 2) / 16384]; p += 4; }
      else if (flags & 0x80) { m = [gv.getInt16(p) / 16384, gv.getInt16(p + 2) / 16384, gv.getInt16(p + 4) / 16384, gv.getInt16(p + 6) / 16384]; p += 8; }
      // (Point-matched offsets -- flags & 2 unset -- are rare in fonts people import; treated as no offset.)
      if (!(flags & 2)) { dx = 0; dy = 0; }
      for (const c of outline(gi, depth + 1)) out.push(c.map(([x, y, on]) => [m[0]! * x + m[2]! * y + dx, m[1]! * x + m[3]! * y + dy, on]));
      if (!(flags & 0x20)) break;
    }
    return out;
  };

  const kern = new Map<number, number>();
  const k = T.get("kern");
  if (k) {
    const d = view(k);
    const nt = d.getUint16(2);
    let o = 4;
    for (let t = 0; t < nt && o < k.length; t += 1) {
      const len = d.getUint16(o + 2), cov = d.getUint16(o + 4);
      if ((cov >> 8) === 0 && (cov & 1)) {
        const np = d.getUint16(o + 6);
        for (let i = 0; i < np; i += 1) kern.set((d.getUint16(o + 14 + i * 6) << 16) | d.getUint16(o + 16 + i * 6), d.getInt16(o + 18 + i * 6));
      }
      o += len;
    }
  }
  const box = (g: number): { yMax: number } => { const [a, b] = off(g); return { yMax: b > a ? gv.getInt16(a + 8) : 0 }; };
  if (!capHeight) capHeight = box(cmap.get(72) ?? 0).yMax || Math.round(unitsPerEm * 0.7);
  if (!xHeight) xHeight = box(cmap.get(120) ?? 0).yMax || Math.round(capHeight * 0.7);
  return { unitsPerEm, ascender: hhea.getInt16(4), descender: hhea.getInt16(6), lineGap: hhea.getInt16(8), capHeight, xHeight, numGlyphs, cmap, advance, outline, kern, name };
}

export interface RasteriseOptions {
  /** Code points (default: printable ASCII plus the UI's symbols the font has). */
  readonly codes?: Iterable<number>;
  /** Coverage that counts as ink (default 0.5; lower is bolder). */
  readonly threshold?: number;
  /** Snap baseline, x-height and cap line to whole pixels (default true). */
  readonly hint?: boolean;
  /** Extra pixels of tracking. */
  readonly tracking?: number;
}

const DEFAULT_CODES = [...Array.from({ length: 95 }, (_, i) => 32 + i), 0x2026, 0x2022, 0x00d7, 0x00b0, 0x2190, 0x2191, 0x2192, 0x2193];

/** A parsed font at a whole pixel size (cap height `size`), as a crisp pixel font. */
export function rasteriseFont(font: SfntFont, size: number, o: RasteriseOptions = {}): PixelFont {
  const hint = o.hint ?? true;
  const s = size / font.capHeight;
  const capPx = size, xPx = Math.max(1, Math.round(font.xHeight * s));
  // (Blue zones: 0..x-height and x-height..cap each mapped onto whole pixels.)
  const mapY = (y: number): number => {
    if (!hint) return y * s;
    if (y <= 0) return y * s;
    if (y <= font.xHeight) return (y / font.xHeight) * xPx;
    if (y <= font.capHeight) return xPx + ((y - font.xHeight) / (font.capHeight - font.xHeight)) * (capPx - xPx);
    return capPx + (y - font.capHeight) * s;
  };
  const ascent = Math.max(capPx, Math.round(font.ascender * s));
  const descent = Math.max(1, Math.round(-font.descender * s));
  const glyphs: Glyph[] = [];
  const byGlyph = new Map<number, number>();
  for (const code of o.codes ?? DEFAULT_CODES) {
    const gi = font.cmap.get(code);
    if (gi === undefined) continue;
    byGlyph.set(gi, code);
    // (Rounded a little generously: at small sizes the pixels of neighbours must not touch.)
    const adv = Math.max(1, Math.round(font.advance(gi) * s + 0.3)) + (o.tracking ?? 0);
    const contours = font.outline(gi);
    if (!contours.length) { glyphs.push({ code, w: 0, h: 0, ox: 0, oy: 0, adv, bits: new Uint8Array(0) }); continue; }
    // Flatten (quadratic B-splines: implied on-curve points between two off-curve ones).
    const flat: Contour[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of contours) {
      if (c.length < 2) continue;
      const pts = c.map(([x, y, on]) => [x * s, -mapY(y), on] as [number, number, boolean]);
      let startI = pts.findIndex((p) => p[2]);
      let start: [number, number];
      if (startI < 0) { const a = pts[0]!, b = pts[1]!; start = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; startI = 0; }
      else start = [pts[startI]![0], pts[startI]![1]];
      const out: number[] = [start[0], start[1]];
      let cur = start;
      let ctrl: [number, number] | null = null;
      for (let k = 1; k <= pts.length; k += 1) {
        const p = pts[(startI + k) % pts.length]!;
        if (p[2]) {
          if (ctrl) quadTo(out, cur[0], cur[1], ctrl[0], ctrl[1], p[0], p[1]); else out.push(p[0], p[1]);
          cur = [p[0], p[1]]; ctrl = null;
        } else if (ctrl) {
          const mid: [number, number] = [(ctrl[0] + p[0]) / 2, (ctrl[1] + p[1]) / 2];
          quadTo(out, cur[0], cur[1], ctrl[0], ctrl[1], mid[0], mid[1]);
          cur = mid; ctrl = [p[0], p[1]];
        } else ctrl = [p[0], p[1]];
      }
      if (ctrl) quadTo(out, cur[0], cur[1], ctrl[0], ctrl[1], start[0], start[1]);
      for (let i = 0; i < out.length; i += 2) { minX = Math.min(minX, out[i]!); maxX = Math.max(maxX, out[i]!); minY = Math.min(minY, out[i + 1]!); maxY = Math.max(maxY, out[i + 1]!); }
      flat.push(out);
    }
    if (!flat.length) { glyphs.push({ code, w: 0, h: 0, ox: 0, oy: 0, adv, bits: new Uint8Array(0) }); continue; }
    const x0 = Math.floor(minX) - 1, y0 = Math.floor(minY) - 1;
    const w = Math.ceil(maxX) - x0 + 1, h = Math.ceil(maxY) - y0 + 1;
    const shifted = flat.map((c) => c.map((v, i) => (i % 2 ? v - y0 : v - x0)));
    const bits = crisp(rasterize(shifted, w, h), w, h, { threshold: o.threshold ?? 0.5 });
    glyphs.push(trimGlyph({ code, w, h, ox: x0, oy: y0, adv, bits }));
  }
  const kern: Array<[number, number, number]> = [];
  for (const [pair, v] of font.kern) {
    const a = byGlyph.get(pair >>> 16), b = byGlyph.get(pair & 0xffff);
    const dx = Math.round(v * s);
    if (a !== undefined && b !== undefined && dx) kern.push([a, b, dx]);
  }
  return makeFont({ name: font.name, size, ascent, descent, lineHeight: ascent + descent + Math.max(1, Math.round(font.lineGap * s)), glyphs, kern, source: "ttf" });
}

/** Parse and rasterise in one: loadFont(bytes, 9). */
export const loadFont = (bytes: Uint8Array, size: number, o: RasteriseOptions & { name?: string } = {}): PixelFont => rasteriseFont(parseFont(bytes, o.name), size, o);
