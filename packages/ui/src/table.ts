// Tables: a scoreboard, a results sheet, a parts list -- columns with fixed or
// flexible widths and their own alignment, a header row, striped rows, one row
// picked out (you), a colour chip per row (a car's paint), cells in their own
// colour (a gap in amber, a best lap in magenta). Column layout is its own
// pure function (a test can check it); drawing goes into a bitmap.

import { blendRect, slantRect } from "./chrome.ts";
import type { Bitmap } from "./bitmap.ts";
import type { Rgba } from "./color.ts";
import type { PixelFont } from "./font.ts";
import { textInto, textWidth } from "./gauges.ts";

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  /** Fixed width (px), or a share of what's left over after the fixed ones (grow; default 1 when no width). */
  readonly width?: number;
  readonly grow?: number;
  readonly align?: "left" | "center" | "right";
}

export interface TableRow {
  readonly cells: Readonly<Record<string, string>>;
  /** Picked out (the player's row). */
  readonly highlight?: boolean;
  /** A colour chip at the row's start (a car's paint); none when absent. */
  readonly chip?: Rgba;
  /** Cells in their own colour, by column key. */
  readonly tones?: Readonly<Record<string, Rgba>>;
  /** The whole row dimmed (out of the race, not started). */
  readonly dim?: boolean;
}

export interface TableStyle {
  readonly font: PixelFont;
  readonly headerFont?: PixelFont;
  readonly header: Rgba;
  readonly text: Rgba;
  readonly dimText: Rgba;
  readonly rowH: number;
  readonly headerH?: number;
  /** Every other row's backing (none: no stripes). */
  readonly stripe?: Rgba;
  readonly highlightBg: Rgba;
  readonly highlightText: Rgba;
  /** The highlight bar leans this many px (the racing look). */
  readonly slant?: number;
  /** A rule under the header. */
  readonly rule?: Rgba;
  readonly outline?: Rgba;
  /** Space between columns (px). */
  readonly gap?: number;
  /** A chip's width (px; the row starts after it). */
  readonly chipW?: number;
}

/** Each column's left edge and width across `width` px: the fixed ones first, the rest shared by grow. */
export function columnLayout(cols: readonly TableColumn[], width: number, gap = 4): { x: number; w: number }[] {
  const fixed = cols.reduce((a, c) => a + (c.width ?? 0), 0) + gap * Math.max(0, cols.length - 1);
  const grows = cols.reduce((a, c) => a + (c.width === undefined ? c.grow ?? 1 : c.grow ?? 0), 0);
  const spare = Math.max(0, width - fixed);
  const growOf = (c: TableColumn): number => (c.width === undefined ? c.grow ?? 1 : c.grow ?? 0);
  const widths = cols.map((c) => (c.width ?? 0) + (grows > 0 ? Math.floor((spare * growOf(c)) / grows) : 0));
  // (What rounding lost goes to the last growing column.)
  let last = -1;
  cols.forEach((c, i) => { if (growOf(c) > 0) last = i; });
  if (last >= 0) widths[last]! += spare - cols.reduce((a, c) => a + Math.floor((spare * growOf(c)) / grows), 0);
  let x = 0;
  return widths.map((w) => { const out = { x, w }; x += w + gap; return out; });
}

/** Cut a string to fit `w` px (an ellipsis when cut). */
export function fitText(font: PixelFont, s: string, w: number): string {
  if (textWidth(font, s) <= w) return s;
  let t = s;
  while (t.length > 1 && textWidth(font, `${t}…`) > w) t = t.slice(0, -1);
  return `${t}…`;
}

/** The table into a bitmap at (x, y), `w` px wide; returns its height. */
export function tableInto(b: Bitmap, x: number, y: number, w: number, cols: readonly TableColumn[], rows: readonly TableRow[], s: TableStyle): number {
  const hf = s.headerFont ?? s.font, headerH = s.headerH ?? hf.lineHeight + 4, gap = s.gap ?? 4, chipW = s.chipW ?? 3;
  const anyChip = rows.some((r) => r.chip !== undefined);
  const inner = anyChip ? chipW + 3 : 0;
  const lay = columnLayout(cols, w - inner - 4, gap);
  const cellX = (i: number): number => x + 2 + inner + lay[i]!.x;
  const put = (font: PixelFont, text: string, i: number, ty: number, c: Rgba): void => {
    const col = cols[i]!, L = lay[i]!, t = fitText(font, text, L.w);
    const tx = col.align === "right" ? cellX(i) + L.w : col.align === "center" ? cellX(i) + Math.floor(L.w / 2) : cellX(i);
    textInto(b, font, t, tx, ty, c, { align: col.align ?? "left", ...(s.outline !== undefined ? { outline: s.outline } : {}) });
  };
  cols.forEach((c, i) => put(hf, c.label, i, y + Math.floor((headerH - hf.lineHeight) / 2), s.header));
  if (s.rule !== undefined) blendRect(b, x, y + headerH - 1, w, 1, s.rule);
  let ry = y + headerH + 1;
  rows.forEach((r, n) => {
    if (r.highlight) slantRect(b, x, ry, w, s.rowH, s.slant ?? 0, s.highlightBg);
    else if (s.stripe !== undefined && n % 2 === 1) blendRect(b, x, ry, w, s.rowH, s.stripe);
    if (r.chip !== undefined) blendRect(b, x + 2, ry + 1, chipW, s.rowH - 2, r.chip);
    const ty = ry + Math.floor((s.rowH - s.font.lineHeight) / 2) + 1;
    cols.forEach((c, i) => put(s.font, r.cells[c.key] ?? "", i, ty, r.tones?.[c.key] ?? (r.highlight ? s.highlightText : r.dim ? s.dimText : s.text)));
    ry += s.rowH;
  });
  return ry - y;
}
