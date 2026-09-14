// The generative pixel font. Every glyph is a few strokes on named lines
// (baseline, x-height, cap, descender, the middles), drawn one pixel wide
// between whole-pixel points -- so it is pixel art at any size, never a
// scaled outline. Seeded parameters shape the family: width, x-height,
// descender, how round the corners are, stroke weight, serifs, slant,
// tracking and the zero. One parameter set gives every size from 5 to 16 px.
//
// The glyph language (GLYPHS below):
//   "M0,b L0,c~ L1,c~ L1,b M0,h L1,h"      an A
//   M starts a stroke, L (or nothing) goes on, Z closes it, F before M fills it.
//   x: 0..1 across the glyph's box, with a pixel offset ("1-1": one in from the right).
//   y: b baseline, x x-height, c cap, a ascender (the cap, or a pixel above it), d descender,
//      h half the cap, k half the x-height,
//      s the top of i's and j's stem, t the top of t's; a number is a share of the cap (".25"), or of a line (".34x");
//      a pixel offset may follow ("c-1", "b+2"; "h+r": half the glyph's width, a square cross's arm).
//   ~  a soft corner: cut by the font's roundness (0 square, 1 a pixel diagonal, more at large sizes).
//   ^  a corner that is always cut, square fonts included (D's, so it never draws as an O).

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import { makeFont, trimGlyph } from "./font.ts";
import type { Glyph, PixelFont } from "./font.ts";
import { crisp, rasterize } from "./raster.ts";

export const SERIFS = ["none", "slab", "foot"] as const;
export type Serif = (typeof SERIFS)[number];
export const ZEROS = ["plain", "dot", "slash"] as const;
export const SOFTS = ["all", "top", "bottom"] as const;
export type SoftCorners = (typeof SOFTS)[number];
export type ZeroStyle = (typeof ZEROS)[number];

/** A family's shape: one set, every size. */
export interface FontParams {
  /** Normal glyph width over the cap height (0.5..0.9). */
  readonly width: number;
  /** x-height over the cap height (0.55..0.8). */
  readonly xHeight: number;
  /** Descender over the cap height (0.15..0.4). */
  readonly descender: number;
  /** Corner roundness: 0 square, 1 a pixel cut, 2..3 rounder at large sizes. */
  readonly round: number;
  /** Stroke weight over the cap height (0.06..0.25): 1 px at small sizes whatever it is. */
  readonly stroke: number;
  readonly serif: Serif;
  /** 0 upright, 1 oblique. */
  readonly slant: number;
  /** Pixels between glyphs (1..3). */
  readonly tracking: number;
  readonly zero: ZeroStyle;
  /** Lower-case ascenders (b d f h k l) rise this many pixels above the cap (0 or 1). */
  readonly ascend: number;
  /** Which corners are soft: all, only the upper ones, or only the lower ones. */
  readonly soft: SoftCorners;
  /** Capitals this many pixels wider than lower case (0 or 2). */
  readonly capWidth: number;
}

export const DEFAULT_FONT: FontParams = { width: 0.62, xHeight: 0.7, descender: 0.28, round: 1, stroke: 0.12, serif: "none", slant: 0, tracking: 1, zero: "dot", ascend: 0, soft: "all", capWidth: 0 };

/** Ranges a culture draws its family from (see theme.ts CULTURES). */
export interface FontRanges {
  readonly width: readonly [number, number];
  readonly xHeight: readonly [number, number];
  readonly round: readonly number[];
  readonly stroke: readonly [number, number];
  readonly serif: ReadonlyArray<readonly [Serif, number]>;
  readonly slant: number;
  readonly tracking: readonly number[];
}
export const DEFAULT_FONT_RANGES: FontRanges = { width: [0.52, 0.86], xHeight: [0.56, 0.8], round: [0, 1, 2], stroke: [0.08, 0.22], serif: [["none", 3], ["slab", 2], ["foot", 1]], slant: 0.15, tracking: [1, 2] };

/** A family from a seed (and a culture's ranges): a fixed number of draws, so pins never move the others. */
export function fontParamsOf(S: Stream, ranges: FontRanges = DEFAULT_FONT_RANGES, pins: Partial<FontParams> = {}): FontParams {
  const drawn: FontParams = {
    width: round2(S.between(ranges.width[0], ranges.width[1])),
    xHeight: round2(S.between(ranges.xHeight[0], ranges.xHeight[1])),
    descender: round2(S.between(0.2, 0.34)),
    round: S.pick(ranges.round),
    stroke: round2(S.between(ranges.stroke[0], ranges.stroke[1])),
    serif: S.weighted(ranges.serif),
    slant: S.chance(ranges.slant) ? 1 : 0,
    tracking: S.pick(ranges.tracking),
    zero: S.pick(ZEROS),
    ascend: S.chance(0.4) ? 1 : 0,
    soft: S.weighted([["all", 3], ["top", 1], ["bottom", 1]] as const),
    capWidth: S.chance(0.3) ? 2 : 0,
  };
  return { ...drawn, ...pins };
}
const round2 = (v: number): number => Math.round(v * 100) / 100;

// Width classes: n normal, w wide, s narrow and odd (symmetric), t tight, i one stroke, o normal but wide enough for a
// gap between two strokes (G's bar and its left side; +'s bar past t's) whatever the weight, I a capital I 5 wide
// where the figures would be narrower, d a figure: tabular, and at least 5 wide, room for 8's waist and 0's oval at every size.
type WidthClass = "n" | "w" | "s" | "t" | "i" | "o" | "I" | "d";

/** Every glyph: [code point, width class, strokes]. ASCII 32..126 and the UI's own symbols. */
export const GLYPHS: ReadonlyArray<readonly [number, WidthClass, string]> = [
  // Capitals.
  [65, "n", "M0,b L0,c~ L1,c~ L1,b M0,h L1,h"],
  // (B, D, O, S and I are at least 5 wide -- wider than the figures in a narrow family's small sizes -- so none of
  // them is ever an 8, a 0, a 5 or a 1.)
  [66, "o", "M0,b L0,c L1,c^ L1,h^ L0,h M0,h L1,h^ L1,b^ L0,b"],
  [67, "n", "M1,c L0,c~ L0,b~ L1,b"],
  [68, "o", "M0,b L0,c L1,c^ L1,b^ L0,b"],
  [69, "n", "M1,c L0,c L0,b L1,b M0,h L1-1,h"],
  [70, "n", "M1,c L0,c L0,b M0,h L1-1,h"],
  // (G: open at the top-right -- its top stops short of the corner and never turns down -- the right side rises from
  // the baseline to the middle, and a bar comes in from it; never reaching the left side, so no B-like join. At least
  // 5 px wide, room for the gap between that bar and the left stem.)
  [71, "o", "M1-2,c L0,c^ L0,b^ L1,b^ L1,h L.5+1,h"],
  [72, "n", "M0,b L0,c M1,b L1,c M0,h L1,h"],
  [73, "I", "M0,c L1,c M.5,c L.5,b M0,b L1,b"],
  [74, "n", "M1,c L1,b~ L0,b~ L0,.25"],
  [75, "n", "M0,b L0,c M1,c L0+1,h L1,b"],
  [76, "n", "M0,c L0,b L1,b"],
  [77, "w", "M0,b L0,c L.5,.45 L1,c L1,b"],
  [78, "n", "M0,b L0,c L1,b L1,c"],
  [79, "o", "M0,b~ L0,c~ L1,c~ L1,b~ Z"],
  [80, "n", "M0,b L0,c L1,c~ L1,h~ L0,h"],
  [81, "n", "M0,b~ L0,c~ L1,c~ L1,b~ Z M.5,.3 L1,b-1"],
  [82, "n", "M0,b L0,c L1,c~ L1,h^ L0,h M0+1,h L1,b"],
  [83, "o", "M1,c L0,c^ L0,h^ L1,h^ L1,b^ L0,b"],
  [84, "n", "M0,c L1,c M.5,c L.5,b"],
  [85, "n", "M0,c L0,b~ L1,b~ L1,c"],
  [86, "n", "M0,c L0,.3 L.5,b L1,.3 L1,c"],
  [87, "w", "M0,c L0,b L.5,.55 L1,b L1,c"],
  [88, "n", "M0,c L0,.75 L1,.25 L1,b M1,c L1,.75 L0,.25 L0,b"],
  [89, "n", "M0,c L0,.75 L.5,h L1,.75 L1,c M.5,h L.5,b"],
  [90, "n", "M0,c L1,c L1,.8 L0,.2 L0,b L1,b"],
  // Lower case.
  [97, "n", "M0+1,x L1,x~ L1,b M1,k L0,k~ L0,b~ L1,b"],
  [98, "n", "M0,a L0,b L1,b~ L1,x~ L0,x"],
  [99, "n", "M1,x L0,x~ L0,b~ L1,b"],
  [100, "n", "M1,a L1,b L0,b~ L0,x~ L1,x"],
  [101, "n", "M0,k L1,k L1,x~ L0,x~ L0,b~ L1-1,b"],
  [102, "s", "M1,a L.5,a~ L.5,b M0,x L1-1,x"],
  [103, "n", "M1,b L0,b~ L0,x~ L1,x L1,d~ L0,d"],
  [104, "n", "M0,a L0,b M0,x L1,x~ L1,b"],
  [105, "i", "M0,b L0,s M0,c"],
  [106, "t", "M1,s L1,d~ L0,d M1,c"],
  [107, "n", "M0,a L0,b M1,x L0+1,k L1,b"],
  [108, "i", "M0,a L0,b"],
  [109, "w", "M0,b L0,x L1,x~ L1,b M.5,x L.5,b"],
  [110, "n", "M0,b L0,x L1,x~ L1,b"],
  [111, "n", "M0,b~ L0,x~ L1,x~ L1,b~ Z"],
  [112, "n", "M0,d L0,x L1,x~ L1,b~ L0,b"],
  [113, "n", "M1,d L1,x L0,x~ L0,b~ L1,b"],
  [114, "t", "M0,b L0,x L1,x"],
  [115, "n", "M1,x L0,x~ L0,.6x L1,.4x L1,b~ L0,b"],
  // (t: a crossbar through the stem at the x-height, both sides; the stem only a little above it -- well under l's
  // ascender -- and a foot turned right, always cut, square fonts too: never an l.)
  [116, "s", "M.5,t L.5,b^ L1,b M0,x L1,x"],
  [117, "n", "M0,x L0,b~ L1,b L1,x"],
  [118, "n", "M0,x L0,.4x L.5,b L1,.4x L1,x"],
  [119, "w", "M0,x L0,b L.5,k L1,b L1,x"],
  [120, "n", "M0,x L1,b M1,x L0,b"],
  [121, "n", "M0,x L0,b~ L1,b M1,x L1,d~ L0,d"],
  [122, "n", "M0,x L1,x L0,b L1,b"],
  // Figures (tabular: all one width).
  // (Figures: 0 narrower than its cell where there's room -- an oval, never an O; 8 two stacked loops, the upper one
  // narrower, pinched at the waist -- never a flat-sided B; 1 a long flag and a foot; 5 a flat top over a bowl.)
  [48, "d", "M0+i,b^ L0+i,c^ L1-i,c^ L1-i,b^ Z"],
  [49, "d", "M0,c-2 L0,c-1 L.5,c L.5,b M0,b L1,b"],
  [50, "d", "M0,c L1,c~ L1,h~ L0,h~ L0,b L1,b"],
  [51, "d", "M0,c L1,c^ L1,h^ L.5,h M.5,h L1,h^ L1,b^ L0,b"],
  [52, "d", "M0,c L0,h L1,h M1,c L1,b"],
  [53, "d", "M1,c L0,c L0,.7 L1,.7~ L1,b~ L0,b"],
  [54, "d", "M1,c L0,c~ L0,b~ L1,b~ L1,h~ L0,h"],
  [55, "d", "M0,c L1,c L1,.75 L.5,.35 L.5,b"],
  [56, "d", "M0+i,h L0+i,c^ L1-i,c^ L1-i,h Z M0+i,h L0,h-1 L0,b^ L1,b^ L1,h-1 L1-i,h"],
  [57, "d", "M.5,b L1,b~ L1,c~ L0,c~ L0,h~ L1,h"],
  // Punctuation and symbols.
  [33, "i", "M0,c L0,b+2 M0,b"],
  [34, "s", "M0,c L0,c-1 M1,c L1,c-1"],
  [35, "w", "M.25,c L.25,b M.75,c L.75,b M0,.7 L1,.7 M0,.3 L1,.3"],
  [36, "n", "M1,c-1 L0,c-1~ L0,h~ L1,h~ L1,b+1~ L0,b+1 M.5,c L.5,b"],
  [37, "n", "M0,c M1,c L0,b M1,b"],
  [38, "n", "M1,b L0,.55 L0,c~ L1-1,c~ L1-1,.7 L0,.3 L0,b~ L1-1,b L1,.3"],
  [39, "i", "M0,c L0,c-1"],
  [40, "t", "M1,c L0,c-1 L0,b+1 L1,b"],
  [41, "t", "M0,c L1,c-1 L1,b+1 L0,b"],
  [42, "n", "M0,.75 L1,.25 M1,.75 L0,.25 M.5,.85 L.5,.15"],
  // (+: at least 5 wide, its arms as long as the room allows each way -- a cross, never a t without its foot.)
  [43, "o", "M0,h L1,h M.5,h+r L.5,h-r"],
  [44, "t", "M1,b L0,b-1"],
  [45, "s", "M0,h L1,h"],
  [46, "i", "M0,b"],
  [47, "n", "M1,c L0,b"],
  [58, "i", "M0,b M0,.75x"],
  [59, "t", "M1,.75x M1,b L0,b-1"],
  [60, "s", "M1,c-1 L0,h L1,b+1"],
  [61, "s", "M0,.65 L1,.65 M0,.35 L1,.35"],
  [62, "s", "M0,c-1 L1,h L0,b+1"],
  [63, "n", "M0,c L1,c~ L1,h~ L.5,h L.5,b+2 M.5,b"],
  [64, "w", "M1,.3 L1,c~ L0,c~ L0,b~ L1,b M.75,.3 L.35,.3 L.35,.7 L.75,.7 L.75,.3"],
  [91, "t", "M1,c L0,c L0,b L1,b"],
  [92, "n", "M0,c L1,b"],
  [93, "t", "M0,c L1,c L1,b L0,b"],
  [94, "s", "M0,.7 L.5,c L1,.7"],
  [95, "n", "M0,b-1 L1,b-1"],
  [96, "t", "M0,c L1,c-1"],
  [123, "s", "M1,c L.5,c~ L.5,h+1 L0,h L.5,h-1 L.5,b~ L1,b"],
  [124, "i", "M0,c L0,b-1"],
  [125, "s", "M0,c L.5,c~ L.5,h+1 L1,h L.5,h-1 L.5,b~ L0,b"],
  [126, "w", "M0,h L.25,h+1 L.5,h L.75,h-1 L1,h"],
  // The UI's own: ellipsis, bullet, multiply, divide, degree, arrows, triangles, squares, tick, heart, star.
  [0x2026, "w", "M0,b M.5,b M1,b"],
  [0x2022, "s", "FM0,h-1 L1,h-1 L1,h+1 L0,h+1 Z"],
  [0x00d7, "s", "M0,.7 L1,.3 M0,.3 L1,.7"],
  [0x00f7, "s", "M0,h L1,h M.5,h+2 M.5,h-2"],
  [0x00b0, "t", "M0,c L1,c L1,c-1 L0,c-1 Z"],
  [0x2190, "w", "M0,h L1,h M0+2,h+2 L0,h L0+2,h-2"],
  [0x2192, "w", "M0,h L1,h M1-2,h+2 L1,h L1-2,h-2"],
  [0x2191, "n", "M.5,c L.5,b M0,c-1 L.5,c L1,c-1"],
  [0x2193, "n", "M.5,c L.5,b M0,b+1 L.5,b L1,b+1"],
  [0x25b2, "n", "FM0,.15 L.5,.85 L1,.15 Z"],
  [0x25bc, "n", "FM0,.85 L.5,.15 L1,.85 Z"],
  [0x25c0, "n", "FM1,.9 L0,h L1,.1 Z"],
  [0x25b6, "n", "FM0,.9 L1,h L0,.1 Z"],
  [0x25a0, "n", "FM0,.8 L1,.8 L1,.2 L0,.2 Z"],
  [0x25a1, "n", "M0,.8 L1,.8 L1,.2 L0,.2 Z"],
  [0x2713, "n", "M0,h L.4,b+1 L1,c-1"],
  [0x2665, "n", "FM.5,.05 L0,.55 L0,.78 L.25,.95 L.5,.78 L.75,.95 L1,.78 L1,.55 Z"],
  [0x2605, "w", "FM.5,1 L.62,.62 L1,.62 L.69,.38 L.81,0 L.5,.24 L.19,0 L.31,.38 L0,.62 L.38,.62 Z"],
];

/** The code points the generated font covers. */
export const GENERATED_CODES: readonly number[] = [32, ...GLYPHS.map(([c]) => c)].sort((a, b) => a - b);

interface Metrics {
  C: number; X: number; D: number; B: number; asc: number; r: number; stroke: number; serifPad: number; slantPad: number;
}

function metricsOf(p: FontParams, size: number): Metrics {
  const C = size;
  const X = Math.max(Math.min(C - 1, Math.round(C * p.xHeight)), Math.max(3, Math.ceil(C * 0.55)), C <= 5 ? 4 : 0);
  const D = Math.max(1, Math.round(C * p.descender));
  let B = Math.max(3, Math.round(C * p.width));
  if (B % 2 === 0) B += C * p.width > B ? 1 : -1;
  B = Math.max(3, B);
  const r = p.round <= 0 ? 0 : C < 9 ? 1 : Math.min(p.round, 1 + Math.floor((C - 9) / 4) + (p.round >= 3 ? 1 : 0));
  const stroke = Math.max(1, Math.min(3, Math.round(C * p.stroke)));
  const serifPad = p.serif !== "none" && C >= 7 ? 1 : 0;
  const slantPad = p.slant ? Math.max(1, Math.floor((C + 1) / 6)) : 0;
  return { C, X, D, B, asc: p.ascend ? 1 : 0, r, stroke, serifPad, slantPad };
}

function widthOf(cls: WidthClass, m: Metrics): number {
  switch (cls) {
    case "n": return m.B;
    case "w": return m.B + 2;
    case "s": { const s = Math.max(3, m.B - 2); return s % 2 ? s : s + 1; }
    case "t": return Math.max(2, m.B - 1);
    case "i": return 1;
    case "o": return Math.max(5 + 2 * (m.stroke - 1), m.B);
    case "d": return Math.max(5, m.B);
    case "I": { const s = Math.max(3, m.B - 2); return m.B >= 5 ? (s % 2 ? s : s + 1) : 5; }
  }
}

interface Pt { x: number; y: number; soft: boolean; must?: boolean }
interface Sub { pts: Pt[]; closed: boolean; fill: boolean }

const X_RE = /^(-?\d*\.?\d+)([+-](?:\d+|i))?$/;
const Y_RE = /^(\d*\.?\d+)?([abxcdhkst])?([+-](?:\d+|r))?$/;

// (Rows count up from the baseline: 0 is the baseline row, C-1 the cap row, -D the descender's last.)
// (An offset "+r" / "-r" is the arm of a cross: half the glyph's width, as far as the cap and the baseline allow.)
function rowOf(tok: string, m: Metrics, W = 1): number {
  const mm = Y_RE.exec(tok);
  if (!mm) throw new SyntaxError(`Bad y "${tok}".`);
  const [, num, line, off] = mm;
  const lineRow = (l: string | undefined): number => {
    switch (l) {
      case "b": return 0;
      case "x": return m.X - 1;
      case "c": return m.C - 1;
      case "d": return -m.D;
      case "h": return Math.round((m.C - 1) / 2);
      case "k": return Math.round((m.X - 1) / 2);
      case "s": return Math.min(m.X - 1, m.C - 3);
      // (t's top: above the x-height by half the room to the cap, at least a row -- so it stops short of l's
      // wherever the family leaves room between its x-height and its cap.)
      case "t": { const room = m.C - m.X; return m.X - 1 + (room >= 3 ? Math.round(room / 2) : 1); }
      case "a": return m.C - 1 + m.asc;
      default: return m.C - 1;
    }
  };
  let y: number;
  if (num !== undefined) y = Math.round(Number(num) * lineRow(line ?? "c"));
  else y = lineRow(line);
  if (off === "+r" || off === "-r") {
    const h = Math.round((m.C - 1) / 2);
    // (And shorter than t's stem under its crossbar, so a + is never a t without its foot.)
    // (Never on the cap line or the baseline either: a slab serif there would turn it into a T.)
    const r = Math.max(1, Math.min(Math.floor((W - 1) / 2), m.C - 2 - h, h - 1, m.X - 3));
    return y + (off === "+r" ? r : -r);
  }
  return y + (off ? Number(off) : 0);
}

function parseGlyph(src: string, W: number, m: Metrics): Sub[] {
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  for (let tok of src.trim().split(/\s+/)) {
    let fill = false;
    if (tok === "Z") { if (cur) cur.closed = true; continue; }
    if (tok.startsWith("F")) { fill = true; tok = tok.slice(1); }
    let move = false;
    if (tok.startsWith("M")) { move = true; tok = tok.slice(1); } else if (tok.startsWith("L")) tok = tok.slice(1);
    const must = tok.endsWith("^");
    const soft = must || tok.endsWith("~");
    if (soft) tok = tok.slice(0, -1);
    const [xs, ys] = tok.split(",");
    const mx = X_RE.exec(xs ?? "");
    if (!mx || ys === undefined) throw new SyntaxError(`Bad point "${tok}".`);
    // ("+i" / "-i": a pixel in from the side where the glyph is 5 wide or more, none in a narrower one.)
    const off = mx[2] === "+i" ? (W >= 5 ? 1 : 0) : mx[2] === "-i" ? (W >= 5 ? -1 : 0) : mx[2] ? Number(mx[2]) : 0;
    const x = Math.round(Number(mx[1]) * (W - 1)) + off;
    const pt = { x: Math.max(0, Math.min(W - 1, x)), y: rowOf(ys, m, W), soft, must };
    if (move || !cur) { cur = { pts: [pt], closed: false, fill }; subs.push(cur); } else cur.pts.push(pt);
  }
  return subs;
}

// Soft corners: each is replaced by two points, r pixels back along both of its strokes (no more than half of
// a stroke shared with another soft corner, so the two meet in its middle) -- a diagonal cut, the pixel
// artist's curve.
function soften(sub: Sub, r: number, soft: SoftCorners = "all", mid = 0): Pt[] {
  const p = sub.pts;
  const n = p.length;
  if (n < 3) return p;
  const out: Pt[] = [];
  for (let i = 0; i < n; i += 1) {
    const q = p[i]!;
    const interior = sub.closed || (i > 0 && i < n - 1);
    if (!q.soft || !interior || (!q.must && (r <= 0 || (soft === "top" && q.y < mid) || (soft === "bottom" && q.y > mid)))) { out.push(q); continue; }
    const a = p[(i - 1 + n) % n]!, b = p[(i + 1) % n]!;
    const la = Math.max(Math.abs(a.x - q.x), Math.abs(a.y - q.y));
    const lb = Math.max(Math.abs(b.x - q.x), Math.abs(b.y - q.y));
    // (A soft neighbour gets half the stroke between them; a hard one lets the cut run all the way to it.)
    const room = (t: Pt, len: number): number => (t.soft && (sub.closed || (t !== p[0] && t !== p[n - 1])) ? Math.floor(len / 2) : len);
    const k = Math.min(q.must ? Math.max(1, r) : r, room(a, la), room(b, lb));
    if (k <= 0) { out.push(q); continue; }
    const toward = (t: Pt, len: number): Pt => ({ x: q.x + Math.round(((t.x - q.x) / len) * k), y: q.y + Math.round(((t.y - q.y) / len) * k), soft: false });
    out.push(toward(a, la), toward(b, lb));
  }
  return out;
}

function drawGlyph(code: number, cls: WidthClass, src: string, p: FontParams, m: Metrics): Glyph {
  const W = widthOf(cls, m) + (p.capWidth && cls !== "i" && ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) ? p.capWidth : 0);
  const extraW = m.stroke - 1;
  const boxW = W + extraW + m.serifPad * 2 + m.slantPad;
  const H = m.C + m.asc + m.D;
  const top = m.C - 1 + m.asc; // (image row = top - row)
  const bits = new Uint8Array(boxW * H);
  const set = (x: number, row: number) => {
    const yy = top - row;
    const xx = x + m.serifPad;
    if (xx >= 0 && xx < boxW && yy >= 0 && yy < H) bits[yy * boxW + xx] = 1;
  };
  const stroke = (a: Pt, b: Pt) => {
    let x0 = a.x, y0 = a.y;
    const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0);
    const sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      set(x0, y0);
      if (x0 === b.x && y0 === b.y) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const subs = parseGlyph(src, W, m);
  const ends: Array<{ pt: Pt; vertical: boolean }> = [];
  for (const sub of subs) {
    const pts = soften(sub, m.r, p.soft, Math.round((m.X - 1) / 2));
    if (sub.fill) {
      // (Vertices at pixel centres, filled by the rasteriser: a solid shape with its outline stroked on top.)
      const poly = pts.flatMap((q) => [q.x + 0.5, top - q.y + 0.5]);
      const cov = rasterize([poly], W, H, { sub: 4 });
      const on = crisp(cov, W, H, { threshold: 0.5 });
      for (let yy = 0; yy < H; yy += 1) for (let xx = 0; xx < W; xx += 1) if (on[yy * W + xx]) set(xx, top - yy);
    }
    if (pts.length === 1) { set(pts[0]!.x, pts[0]!.y); continue; }
    for (let i = 0; i < pts.length - 1; i += 1) stroke(pts[i]!, pts[i + 1]!);
    if (sub.closed) stroke(pts[pts.length - 1]!, pts[0]!);
    else {
      const [a, a2, b, b2] = [pts[0]!, pts[1]!, pts[pts.length - 1]!, pts[pts.length - 2]!];
      ends.push({ pt: a, vertical: a.x === a2.x && Math.abs(a.y - a2.y) >= 2 }, { pt: b, vertical: b.x === b2.x && Math.abs(b.y - b2.y) >= 2 });
    }
  }
  // The zero's inner mark.
  // (Only where the oval leaves room inside it for the mark: a dot in a 1-pixel counter reads as a theta.)
  if (code === 48 && p.zero !== "plain" && W >= 7) {
    if (p.zero === "slash" && W >= 5 && m.C >= 7) stroke({ x: W - 2, y: m.C - 3, soft: false }, { x: 1, y: 2, soft: false });
    else set(Math.floor(W / 2), Math.round((m.C - 1) / 2));
  }
  // Serifs: a pixel either side of a vertical stroke's end on the baseline, the cap line or the x-height (feet only at the baseline).
  if (m.serifPad) {
    const rows = p.serif === "foot" ? [0] : [0, m.C - 1, m.X - 1, -m.D];
    // (Not on a lower-case ascender's top, and none on l at all: l stays a plain stem, never a capital I.)
    const ascender = code >= 97 && code <= 122 ? m.C - 1 + m.asc : Number.NaN;
    if (code !== 108) for (const { pt, vertical } of ends) if (vertical && rows.includes(pt.y) && pt.y !== ascender) { set(pt.x - 1, pt.y); set(pt.x + 1 + extraW, pt.y); }
  }
  // Weight: every ink pixel carried right (vertical strokes thicken, horizontals lengthen -- the pixel font's bold).
  if (extraW) {
    for (let yy = 0; yy < H; yy += 1) for (let xx = boxW - 1; xx >= 0; xx -= 1) {
      for (let k = 1; k <= extraW; k += 1) if (xx - k >= 0 && bits[yy * boxW + xx - k] && !bits[yy * boxW + xx]) { bits[yy * boxW + xx] = 2; break; }
    }
    for (let i = 0; i < bits.length; i += 1) if (bits[i]) bits[i] = 1;
  }
  // Slant: each row shifted right by how far above the descender it is.
  if (m.slantPad) {
    const out = new Uint8Array(boxW * H);
    for (let yy = 0; yy < H; yy += 1) {
      const shift = Math.floor(((H - 1 - yy) * (m.slantPad + 1)) / (H + 1));
      for (let xx = 0; xx < boxW - shift; xx += 1) out[yy * boxW + xx + shift] = bits[yy * boxW + xx]!;
    }
    bits.set(out);
  }
  return { code, w: boxW, h: H, ox: 0, oy: -(m.C + m.asc), adv: boxW - m.slantPad - m.serifPad + p.tracking + (m.C >= 12 ? 1 : 0), bits };
}

/** A generated font: the family `params` at cap height `size` (5..16 px; larger works, it just isn't tuned). */
export function generateFont(params: FontParams = DEFAULT_FONT, size = 7, name = "keel-gen"): PixelFont {
  if (!(Number.isInteger(size) && size >= 5 && size <= 32)) throw new RangeError(`A generated font's size is a whole 5..32 px cap height (got ${size}).`);
  const m = metricsOf(params, size);
  // (Trimmed to their ink -- where they sit and how far they advance kept: smaller atlas entries, smaller records.)
  const glyphs: Glyph[] = GLYPHS.map(([code, cls, src]) => trimGlyph(drawGlyph(code, cls, src, params, m)));
  const space = Math.max(2, Math.ceil(m.B / 2) + (size >= 10 ? 1 : 0));
  glyphs.push({ code: 32, w: 0, h: 0, ox: 0, oy: 0, adv: space + params.tracking, bits: new Uint8Array(0) });
  const gap = 1 + Math.floor(size / 6);
  return makeFont({ name, size, ascent: size + m.asc, descent: m.D, lineHeight: size + m.asc + m.D + gap, glyphs, source: "generated" });
}

/** A family drawn from a seed: generateFont(fontParamsFromSeed(seed), size). */
export const fontParamsFromSeed = (seed: string | number, ranges?: FontRanges, pins?: Partial<FontParams>): FontParams =>
  fontParamsOf(stream(createRoll(deriveSeed(String(seed), "ui/font")), 0), ranges, pins);

/** The recipe key of a generated font (params + size): the glyph atlas caches by it. */
export const fontParamsKey = (p: FontParams): string => `${p.width}/${p.xHeight}/${p.descender}/${p.round}/${p.stroke}/${p.serif}/${p.slant}/${p.tracking}/${p.zero}/${p.ascend}/${p.soft}/${p.capWidth}`;
