// Text: rich runs, layout and drawing. Layout wraps greedily at spaces (a
// word longer than the line breaks between letters), aligns left, centre or
// right, cuts the last line with an ellipsis, kerns, and can set figures
// tabular (every digit the widest digit's advance, centred) so counters don't
// jitter. Runs carry a tone (ink, dim, accent, good, warn, bad, team3...) or a
// colour, and icons sit inline, centred on the cap height.
//
//   layoutText(parseRich("Mass {icon:mass} {good}+25{/}"), { font, width: 80 })
//
// Markup: {tone}...{/}, {#rrggbb}...{/}, {icon:name}, {tab}...{/} (tabular
// figures); {{ is a literal brace. Everything is whole pixels.

import { blitMask, createBitmap } from "./bitmap.ts";
import type { Bitmap, Clip } from "./bitmap.ts";
import { fromHex } from "./color.ts";
import type { Rgba } from "./color.ts";
import { digitAdvance, glyphOf, kernKey } from "./font.ts";
import type { PixelFont } from "./font.ts";
import type { UiAtlas } from "./atlas.ts";

export interface TextRun {
  readonly text?: string;
  readonly icon?: string;
  readonly tone?: string;
  readonly color?: Rgba;
  readonly tabular?: boolean;
}

export function parseRich(src: string): TextRun[] {
  const runs: TextRun[] = [];
  const stack: Array<{ tone?: string; color?: Rgba; tabular?: boolean }> = [{}];
  let buf = "";
  const top = () => stack[stack.length - 1]!;
  const flush = () => { if (buf) { runs.push({ text: buf, ...top() }); buf = ""; } };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (ch === "{" && src[i + 1] === "{") { buf += "{"; i += 1; continue; }
    if (ch !== "{") { buf += ch; continue; }
    const end = src.indexOf("}", i);
    if (end < 0) { buf += src.slice(i); break; }
    const tag = src.slice(i + 1, end);
    i = end;
    flush();
    if (tag === "/") { if (stack.length > 1) stack.pop(); }
    else if (tag.startsWith("icon:")) runs.push({ icon: tag.slice(5), ...top() });
    else if (tag === "tab") stack.push({ ...top(), tabular: true });
    else if (tag.startsWith("#")) stack.push({ ...top(), color: fromHex(tag) });
    else stack.push({ ...top(), tone: tag });
  }
  flush();
  return runs;
}

export interface LayoutOptions {
  readonly font: PixelFont;
  /** The line width to wrap and cut at (none: one unbounded line per \n). */
  readonly width?: number;
  readonly wrap?: boolean;
  readonly align?: "left" | "center" | "right";
  /** Cut an overflowing last line with "…". */
  readonly ellipsis?: boolean;
  readonly maxLines?: number;
  readonly tabular?: boolean;
  /** Extra pixels between lines. */
  readonly lineGap?: number;
  /** Inline icons' size (default: the cap height + 2). */
  readonly iconSize?: number;
  /** Set it all in capitals. */
  readonly caps?: boolean;
}

/** A glyph or icon placed: x is its pen position, y its line's baseline, in the layout's own pixels. */
export interface PlacedItem {
  readonly icon: string | null;
  readonly code: number;
  x: number;
  readonly y: number;
  readonly w: number;
  readonly tone: string | undefined;
  readonly color: Rgba | undefined;
}

export interface TextLayout {
  readonly font: PixelFont;
  readonly w: number;
  readonly h: number;
  readonly lines: number;
  readonly items: readonly PlacedItem[];
  readonly truncated: boolean;
  readonly iconSize: number;
}

interface Tok { icon: string | null; code: number; adv: number; tone: string | undefined; color: Rgba | undefined; space: boolean; newline: boolean }

export function layoutText(input: string | readonly TextRun[], opts: LayoutOptions): TextLayout {
  const { font, width = Infinity, align = "left", ellipsis = true, maxLines = Infinity, lineGap = 0, caps = false } = opts;
  const wrap = opts.wrap ?? Number.isFinite(width);
  const iconSize = opts.iconSize ?? font.size + 3;
  const runs = typeof input === "string" ? [{ text: input }] : input;
  const digitW = digitAdvance(font);
  const toks: Tok[] = [];
  for (const r of runs) {
    if (r.icon) { toks.push({ icon: r.icon, code: 0, adv: iconSize + 1, tone: r.tone, color: r.color, space: false, newline: false }); continue; }
    const text = caps ? (r.text ?? "").toUpperCase() : (r.text ?? "");
    const tab = opts.tabular || r.tabular;
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      if (code === 10) { toks.push({ icon: null, code, adv: 0, tone: r.tone, color: r.color, space: false, newline: true }); continue; }
      const g = glyphOf(font, code);
      const adv = tab && code >= 48 && code <= 57 ? digitW : g?.adv ?? 0;
      toks.push({ icon: null, code, adv, tone: r.tone, color: r.color, space: code === 32, newline: false });
    }
  }
  const kernOf = (a: Tok | undefined, b: Tok): number => (a && !a.icon && !b.icon ? font.kern.get(kernKey(a.code, b.code)) ?? 0 : 0);
  // Break into lines of tokens.
  const lines: Tok[][] = [];
  let line: Tok[] = [];
  let lineW = 0;
  const widthOf = (ts: readonly Tok[]): number => { let w = 0; for (let i = 0; i < ts.length; i += 1) w += ts[i]!.adv + (i ? kernOf(ts[i - 1], ts[i]!) : 0); return w; };
  const push = () => { while (line.length && line[line.length - 1]!.space) line.pop(); lines.push(line); line = []; lineW = 0; };
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (t.newline) { push(); i += 1; continue; }
    if (t.space) { if (line.length) { line.push(t); lineW += t.adv; } i += 1; continue; }
    // A word: up to the next space or newline.
    let j = i;
    while (j < toks.length && !toks[j]!.space && !toks[j]!.newline) j += 1;
    const word = toks.slice(i, j);
    const ww = widthOf(word) + (line.length ? kernOf(line[line.length - 1], word[0]!) : 0);
    if (!wrap || lineW + ww <= width || (!line.length && ww <= width)) { line.push(...word); lineW += ww; i = j; continue; }
    if (line.length) { push(); continue; }
    // (A word wider than the line: as much of it as fits, then the rest on the next.)
    let k = 0, w = 0;
    while (k < word.length && w + word[k]!.adv <= width) { w += word[k]!.adv; k += 1; }
    k = Math.max(1, k);
    line.push(...word.slice(0, k));
    push();
    i += k;
  }
  if (line.length || !lines.length) push();
  let truncated = false;
  if (lines.length > maxLines) { lines.length = maxLines; truncated = true; }
  // Ellipsis on the last line if it (or what was cut) overflows.
  const last = lines[lines.length - 1]!;
  if (ellipsis && Number.isFinite(width) && (truncated || widthOf(last) > width)) {
    const dotsCode = font.glyphs.has(0x2026) ? 0x2026 : 46;
    const dot: Tok = { icon: null, code: dotsCode, adv: glyphOf(font, dotsCode)?.adv ?? 0, tone: last[last.length - 1]?.tone, color: last[last.length - 1]?.color, space: false, newline: false };
    const dots = dotsCode === 46 ? [dot, dot, dot] : [dot];
    const dw = widthOf(dots);
    while (last.length && widthOf(last) + dw > width) last.pop();
    while (last.length && last[last.length - 1]!.space) last.pop();
    last.push(...dots);
    truncated = true;
  }
  const lh = font.lineHeight + lineGap;
  const items: PlacedItem[] = [];
  let maxW = 0;
  lines.forEach((ts, li) => {
    const w = widthOf(ts);
    maxW = Math.max(maxW, w);
    const box = Number.isFinite(width) ? width : w;
    const x0 = align === "center" ? Math.floor((box - w) / 2) : align === "right" ? box - w : 0;
    const y = font.ascent + li * lh;
    let pen = x0;
    ts.forEach((t, k) => {
      if (k) pen += kernOf(ts[k - 1], t);
      if (!t.space) {
        // (A tabular digit is centred in the widest digit's advance.)
        const g = t.icon ? null : glyphOf(font, t.code);
        const nudge = g && t.adv !== g.adv ? Math.floor((t.adv - g.adv) / 2) : 0;
        items.push({ icon: t.icon, code: t.code, x: pen + nudge, y, w: t.icon ? iconSize : g?.w ?? 0, tone: t.tone, color: t.color });
      }
      pen += t.adv;
    });
  });
  const h = font.ascent + font.descent + (lines.length - 1) * lh;
  return { font, w: Number.isFinite(width) && align !== "left" ? Math.min(width, Math.max(maxW, 0)) : maxW, h, lines: lines.length, items, truncated, iconSize };
}

/** A glyph's mask in the atlas (made on first use). */
export function glyphSprite(atlas: UiAtlas, font: PixelFont, code: number) {
  return atlas.sprite(`${font.key}#${code}`, () => {
    const g = glyphOf(font, code);
    if (!g || !g.w) return createBitmap(0, 0);
    const b = createBitmap(g.w, g.h);
    for (let i = 0; i < g.bits.length; i += 1) if (g.bits[i]) b.px[i] = 0xffffffff;
    return b;
  });
}

export interface DrawTextOptions {
  /** A tone's colour ("ink", "good", ...); items without one take `ink`. */
  readonly tone: (tone: string | undefined) => Rgba;
  /** A 1-px drop shadow in this colour. */
  readonly shadow?: Rgba;
  /** A 1-px outline all round in this colour (over a busy fill: a bar's segments, a picture). */
  readonly outline?: Rgba;
  /** Inline icons: draw `name` at (x, y) (top-left), `size` px. */
  readonly icon?: (name: string, x: number, y: number, size: number, color: Rgba) => void;
}

/** Draw a layout with its top-left at (x, y). */
export function drawText(dst: Bitmap, atlas: UiAtlas, layout: TextLayout, x: number, y: number, clip: Clip, o: DrawTextOptions): void {
  const font = layout.font;
  const page = atlas.page;
  // (Passes: the outline's eight offsets, or the shadow's one, then the text itself.)
  const passes: ReadonlyArray<readonly [number, number, Rgba | null]> = o.outline !== undefined
    ? [[-1, -1, o.outline], [0, -1, o.outline], [1, -1, o.outline], [-1, 0, o.outline], [1, 0, o.outline], [-1, 1, o.outline], [0, 1, o.outline], [1, 1, o.outline], [0, 0, null]]
    : o.shadow !== undefined ? [[1, 1, o.shadow], [0, 0, null]] : [[0, 0, null]];
  for (const [dx, dy, under] of passes) {
    for (const it of layout.items) {
      const color = under ?? it.color ?? o.tone(it.tone);
      if (it.icon) {
        if (!under && o.icon) o.icon(it.icon, x + it.x, y + it.y - font.size + Math.floor((font.size - layout.iconSize) / 2), layout.iconSize, color);
        continue;
      }
      const g = glyphOf(font, it.code);
      if (!g || !g.w) continue;
      const s = glyphSprite(atlas, font, it.code);
      blitMask(dst, page, s.x, s.y, s.w, s.h, x + it.x + g.ox + dx, y + it.y + g.oy + dy, color, clip);
    }
  }
}
