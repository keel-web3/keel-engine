// Chrome for a game's front end, drawn straight into a bitmap: see-through
// panels with bevelled corners, a highlight edge and a glow; slanted bars
// (the racing-game highlight); segmented meters and stat bars that show a
// change before it's bought; ordered-dither fades and diagonal wipes for
// transitions; and anchoring. Pure pixels at the layer's own resolution:
// nothing smoothed, the dither pattern locked to the screen so nothing crawls.

import type { Bitmap } from "./bitmap.ts";
import { rgba } from "./color.ts";
import type { Rgba } from "./color.ts";
import type { Anchor } from "./node.ts";

const R = (c: Rgba): number => c & 255, G = (c: Rgba): number => (c >>> 8) & 255, B = (c: Rgba): number => (c >>> 16) & 255, A = (c: Rgba): number => c >>> 24;

/** Two colours mixed (t: 0 all a .. 1 all b), alpha too. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const u = Math.max(0, Math.min(1, t));
  const m = (x: number, y: number): number => Math.round(x + (y - x) * u);
  return rgba(m(R(a), R(b)), m(G(a), G(b)), m(B(a), B(b)), m(A(a), A(b)));
}

/** A colour at an opacity (0..1) -- its own alpha scaled. */
export const fade = (c: Rgba, alpha: number): Rgba => rgba(R(c), G(c), B(c), Math.round(A(c) * Math.max(0, Math.min(1, alpha))));

/** One pixel laid OVER what's there (source-over, straight alpha): see-through panels over a see-through layer. */
export function blend(b: Bitmap, x: number, y: number, c: Rgba): void {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const sa = A(c) / 255;
  if (sa <= 0) return;
  const i = y * b.w + x, d = b.px[i]!;
  if (sa >= 1) { b.px[i] = c; return; }
  const da = A(d) / 255;
  if (da <= 0) { b.px[i] = c; return; }
  const oa = sa + da * (1 - sa), k = (da * (1 - sa)) / oa, s = sa / oa;
  b.px[i] = rgba(Math.round(R(c) * s + R(d) * k), Math.round(G(c) * s + G(d) * k), Math.round(B(c) * s + B(d) * k), Math.round(oa * 255));
}

export function blendRect(b: Bitmap, x: number, y: number, w: number, h: number, c: Rgba): void {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(b.w, Math.round(x + w)), y1 = Math.min(b.h, Math.round(y + h));
  for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) blend(b, xx, yy, c);
}

// A 4x4 Bayer matrix: an ordered dither, fixed to the screen.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Is (x, y) on at a coverage level (0 none .. 1 all), by the Bayer pattern. */
export const dither = (x: number, y: number, level: number): boolean => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 < level;

/** A rectangle filled only where the dither is on at `level` (a see-through fill that stays pixel art). */
export function ditherRect(b: Bitmap, x: number, y: number, w: number, h: number, c: Rgba, level: number): void {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(b.w, Math.round(x + w)), y1 = Math.min(b.h, Math.round(y + h));
  for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) if (dither(xx, yy, level)) blend(b, xx, yy, c);
}

/** A vertical gradient top -> bottom in `steps` bands, dithered where the bands meet (no smooth ramp: pixel art). */
export function gradientRect(b: Bitmap, x: number, y: number, w: number, h: number, top: Rgba, bottom: Rgba, steps = 6): void {
  const rx = Math.round(x), ry = Math.round(y), rh = Math.max(1, Math.round(h));
  for (let row = 0; row < rh; row += 1) {
    const t = rh > 1 ? (row / (rh - 1)) * (steps - 1) : 0, band = Math.floor(t), frac = t - band;
    const c0 = mix(top, bottom, band / Math.max(1, steps - 1)), c1 = mix(top, bottom, Math.min(steps - 1, band + 1) / Math.max(1, steps - 1));
    const yy = ry + row;
    if (yy < 0 || yy >= b.h) continue;
    for (let xx = Math.max(0, rx); xx < Math.min(b.w, rx + Math.round(w)); xx += 1) blend(b, xx, yy, dither(xx, yy, frac) ? c1 : c0);
  }
}

/**
 * A parallelogram: `h` rows, each shifted so the top sits `slant` px right of the bottom (negative leans the other way)
 * -- the racing menus' highlight bar, a slanted plate behind a number.
 */
export function slantRect(b: Bitmap, x: number, y: number, w: number, h: number, slant: number, c: Rgba): void {
  const rh = Math.max(1, Math.round(h));
  for (let row = 0; row < rh; row += 1) {
    const off = Math.round((slant * (rh - 1 - row)) / Math.max(1, rh - 1));
    blendRect(b, x + off, y + row, w, 1, c);
  }
}

export interface PanelStyle {
  /** The fill, top to bottom (see-through through their alpha). */
  readonly top: Rgba;
  readonly bottom: Rgba;
  /** The rim, the lit top edge, the dark bottom edge. */
  readonly edge: Rgba;
  readonly hi?: Rgba;
  readonly lo?: Rgba;
  /** Corners cut at 45 degrees, this many px (0: square). Top-left and bottom-right only when `cutTwo`. */
  readonly cut?: number;
  readonly cutTwo?: boolean;
  /** A halo round it (px, and its colour): a dithered glow. */
  readonly glow?: number;
  readonly glowColour?: Rgba;
  /** A bar of accent colour down its left side (px wide) or along its top (px tall). */
  readonly accentLeft?: number;
  readonly accentTop?: number;
  readonly accent?: Rgba;
  /** Horizontal scan lines across the fill (every other row darker): a CRT/LCD panel. */
  readonly scan?: boolean;
}

/** Is (px, py) inside a w x h box whose corners are cut `cut` px (all four, or top-left and bottom-right only). */
const inCut = (px: number, py: number, w: number, h: number, cut: number, two: boolean): boolean => {
  if (cut <= 0) return true;
  if (px + py < cut) return false;
  if ((w - 1 - px) + (h - 1 - py) < cut) return false;
  if (two) return true;
  if ((w - 1 - px) + py < cut) return false;
  if (px + (h - 1 - py) < cut) return false;
  return true;
};

/** A panel: glow, fill (gradient, see-through), cut corners, rim with a lit top and a dark bottom, an accent bar. */
export function panelInto(b: Bitmap, x: number, y: number, w: number, h: number, s: PanelStyle): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const cut = Math.min(s.cut ?? 0, Math.floor(Math.min(w, h) / 2)), two = !!s.cutTwo;
  const g = s.glow ?? 0;
  if (g > 0 && s.glowColour !== undefined) {
    for (let yy = -g; yy < h + g; yy += 1) for (let xx = -g; xx < w + g; xx += 1) {
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && inCut(xx, yy, w, h, cut, two)) continue;
      const dx = xx < 0 ? -xx : xx >= w ? xx - w + 1 : 0, dy = yy < 0 ? -yy : yy >= h ? yy - h + 1 : 0;
      const d = Math.max(dx, dy);
      if (d > g) continue;
      if (dither(x + xx, y + yy, 0.55 * (1 - (d - 1) / g))) blend(b, x + xx, y + yy, s.glowColour);
    }
  }
  const steps = 5;
  for (let row = 0; row < h; row += 1) {
    const t = h > 1 ? (row / (h - 1)) * (steps - 1) : 0, band = Math.floor(t), frac = t - band;
    const c0 = mix(s.top, s.bottom, band / (steps - 1)), c1 = mix(s.top, s.bottom, Math.min(steps - 1, band + 1) / (steps - 1));
    for (let col = 0; col < w; col += 1) {
      if (!inCut(col, row, w, h, cut, two)) continue;
      const X = x + col, Y = y + row;
      let c = dither(X, Y, frac) ? c1 : c0;
      if (s.scan && (Y & 1)) c = mix(c, rgba(0, 0, 0, A(c)), 0.18);
      blend(b, X, Y, c);
    }
  }
  // The rim: every inside pixel with an outside neighbour; lit along the top, dark along the bottom.
  for (let row = 0; row < h; row += 1) for (let col = 0; col < w; col += 1) {
    if (!inCut(col, row, w, h, cut, two)) continue;
    const edge = row === 0 || col === 0 || row === h - 1 || col === w - 1 || !inCut(col - 1, row, w, h, cut, two) || !inCut(col + 1, row, w, h, cut, two) || !inCut(col, row - 1, w, h, cut, two) || !inCut(col, row + 1, w, h, cut, two);
    if (!edge) continue;
    const c = row === 0 && s.hi !== undefined ? s.hi : row === h - 1 && s.lo !== undefined ? s.lo : s.edge;
    blend(b, x + col, y + row, c);
  }
  if (s.accent !== undefined) {
    if (s.accentLeft) for (let row = 1; row < h - 1; row += 1) for (let col = 1; col <= s.accentLeft; col += 1) if (inCut(col, row, w, h, cut, two)) blend(b, x + col, y + row, s.accent);
    if (s.accentTop) for (let row = 1; row <= s.accentTop; row += 1) for (let col = 1; col < w - 1; col += 1) if (inCut(col, row, w, h, cut, two)) blend(b, x + col, y + row, s.accent);
  }
}

export interface SegmentStyle {
  readonly on: Rgba;
  readonly off: Rgba;
  /** A second lit colour the segments ramp to toward the full end (a meter that heats up). */
  readonly hot?: Rgba;
  readonly gap?: number;
  /** Each segment leans this many px (see slantRect). */
  readonly slant?: number;
}

/** A meter cut into `n` segments, lit to `value` (0..1; a part-lit last segment dithers). */
export function segmentsInto(b: Bitmap, x: number, y: number, w: number, h: number, value: number, n: number, s: SegmentStyle): void {
  const gap = s.gap ?? 1, sw = (w - gap * (n - 1)) / n, v = Math.max(0, Math.min(1, value)) * n;
  for (let i = 0; i < n; i += 1) {
    const sx = x + i * (sw + gap), lit = Math.max(0, Math.min(1, v - i));
    const on = s.hot !== undefined ? mix(s.on, s.hot, n > 1 ? i / (n - 1) : 0) : s.on;
    slantRect(b, Math.round(sx), y, Math.max(1, Math.round(sx + sw) - Math.round(sx)), h, s.slant ?? 0, s.off);
    if (lit >= 1) slantRect(b, Math.round(sx), y, Math.max(1, Math.round(sx + sw) - Math.round(sx)), h, s.slant ?? 0, on);
    else if (lit > 0) {
      const W = Math.max(1, Math.round(sx + sw) - Math.round(sx));
      for (let row = 0; row < h; row += 1) for (let col = 0; col < W; col += 1) if (dither(Math.round(sx) + col, y + row, lit)) blend(b, Math.round(sx) + col + Math.round(((s.slant ?? 0) * (h - 1 - row)) / Math.max(1, h - 1)), y + row, on);
    }
  }
}

export interface StatBarStyle {
  readonly on: Rgba;
  readonly off: Rgba;
  /** What a change adds (green) or takes away (red), shown before it's made. */
  readonly gain: Rgba;
  readonly loss: Rgba;
  readonly segments?: number;
}

/** A stat bar at `value` (0..1), with `next` (a part tried on) showing the gain or the loss over it. */
export function statBarInto(b: Bitmap, x: number, y: number, w: number, h: number, value: number, next: number | null, s: StatBarStyle): void {
  const n = s.segments ?? 20, gap = 1, sw = (w - gap * (n - 1)) / n;
  const v = Math.max(0, Math.min(1, value)), nx = next === null ? v : Math.max(0, Math.min(1, next));
  for (let i = 0; i < n; i += 1) {
    const at = (i + 0.5) / n, sx = Math.round(x + i * (sw + gap)), W = Math.max(1, Math.round(x + i * (sw + gap) + sw) - sx);
    const c = at <= Math.min(v, nx) ? s.on : at <= v ? s.loss : at <= nx ? s.gain : s.off;
    blendRect(b, sx, y, W, h, c);
  }
}

/** The whole bitmap covered to `amount` (0..1) by an ordered dither of `c`: a pixel-art fade to black (or any colour). */
export function fadeInto(b: Bitmap, amount: number, c: Rgba): void {
  if (amount <= 0) return;
  for (let y = 0; y < b.h; y += 1) for (let x = 0; x < b.w; x += 1) if (amount >= 1 || dither(x, y, amount)) blend(b, x, y, c);
}

/**
 * A diagonal wipe: `t` 0 nothing covered .. 1 all covered, the edge leaning `slant` px across the height, with a
 * dithered band `soft` px wide on its leading edge. `reverse` wipes the other way (uncovering).
 */
export function wipeInto(b: Bitmap, t: number, c: Rgba, { slant = 40, soft = 8, reverse = false }: { slant?: number; soft?: number; reverse?: boolean } = {}): void {
  if (t <= 0) return;
  const span = b.w + Math.abs(slant) + soft, front = t * span - soft;
  for (let y = 0; y < b.h; y += 1) {
    const lean = (slant * (b.h - 1 - y)) / Math.max(1, b.h - 1);
    for (let x = 0; x < b.w; x += 1) {
      const pos = (reverse ? b.w - 1 - x : x) + lean;
      const d = front - pos;
      if (d >= soft || (d > 0 && dither(x, y, d / soft))) blend(b, x, y, c);
    }
  }
}

/** Where a w x h box goes in a W x H area from an anchor and an inset (x in from its side, y in from its edge). */
export function anchorRect(anchor: Anchor, x: number, y: number, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const col = anchor.endsWith("l") ? 0 : anchor.endsWith("r") ? 2 : 1;
  const row = anchor.startsWith("t") ? 0 : anchor.startsWith("b") ? 2 : 1;
  const ax = col === 0 ? x : col === 2 ? W - w - x : Math.round((W - w) / 2) + x;
  const ay = row === 0 ? y : row === 2 ? H - h - y : Math.round((H - h) / 2) + y;
  return { x: Math.round(ax), y: Math.round(ay) };
}

/** Linear to eased (0..1): out-cubic, the snap a menu panel lands with. */
export const easeOut = (t: number): number => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
/** In-out (0..1). */
export const easeInOut = (t: number): number => { const u = Math.max(0, Math.min(1, t)); return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; };
