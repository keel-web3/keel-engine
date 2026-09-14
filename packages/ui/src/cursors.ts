// Pixel cursors from the theme: the pointer, the targeting crosshair, the
// order cursors (an arrow wearing an icon from the grammar: move, attack,
// harvest, place, blocked) and the eight edge-scroll arrows -- drawn crisp at a
// small art size, shaded like the icons (outline outside, light and shade) in
// the theme's ramps, then scaled up by a WHOLE factor (the UI's scale), so a
// cursor is as crisp as the HUD it moves over. The theme's seed shapes the
// pointer (its tail and slant) and picks the icons' variants: two races'
// cursors are two sets.
//
//   const c = generateCursor("attack", theme, { scale: ui.scale });
//   // c.bitmap (RGBA words), c.hotspot (pixels): a page makes a PNG of it
//   // (encodePng) for CSS `cursor: url(data:image/png;base64,...) x y, auto`.

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import { createBitmap } from "./bitmap.ts";
import type { Bitmap } from "./bitmap.ts";
import { ICON_RECIPES, iconMask, rampOf, shadeIcon } from "./icons.ts";
import { crisp, rasterize } from "./raster.ts";
import type { Contour } from "./raster.ts";
import type { Theme } from "./theme.ts";

export const CURSOR_KINDS = [
  "select", "move", "attack", "harvest", "target", "place", "blocked",
  "scroll-n", "scroll-ne", "scroll-e", "scroll-se", "scroll-s", "scroll-sw", "scroll-w", "scroll-nw",
] as const;
export type CursorKind = (typeof CURSOR_KINDS)[number];

export interface Cursor {
  readonly kind: CursorKind;
  /** The picture (RGBA words), already at `scale`. */
  readonly bitmap: Bitmap;
  /** The click point, pixels from the top-left (at `scale`). */
  readonly hotspot: readonly [number, number];
  readonly scale: number;
}

export interface CursorOptions {
  /** A whole scale factor (default 1; browsers take cursors up to 128 px, so it's capped to fit). */
  readonly scale?: number;
  /** The pointer's art size in pixels (default 12). */
  readonly size?: number;
}

// (Which icon an order cursor wears, and its tone.)
const BADGE: Partial<Record<CursorKind, { icon: string; tone: string }>> = {
  move: { icon: "move", tone: "good" }, harvest: { icon: "gather", tone: "accent" }, place: { icon: "build", tone: "warn" }, blocked: { icon: "stop", tone: "bad" },
};
const DIRS: Readonly<Record<string, readonly [number, number]>> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };

/** Rasterise contours (unit square, y down) into an n-square 1-bit mask. */
function maskOf(shapes: readonly Contour[], n: number): Uint8Array {
  return crisp(rasterize(shapes.map((c) => c.map((v) => v * n)), n, n), n, n, { threshold: 0.45 });
}

/** Copy `src` into `dst` at (dx, dy), transparent pixels left alone. */
function stamp(dst: Bitmap, src: Bitmap, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y += 1) for (let x = 0; x < src.w; x += 1) {
    const c = src.px[y * src.w + x]!;
    const X = dx + x, Y = dy + y;
    if (c && X >= 0 && Y >= 0 && X < dst.w && Y < dst.h) dst.px[Y * dst.w + X] = c;
  }
}

/** Whole-factor nearest scale. */
function upscale(b: Bitmap, k: number): Bitmap {
  if (k === 1) return b;
  const o = createBitmap(b.w * k, b.h * k);
  for (let y = 0; y < o.h; y += 1) for (let x = 0; x < o.w; x += 1) o.px[y * o.w + x] = b.px[Math.floor(y / k) * b.w + Math.floor(x / k)]!;
  return o;
}

/** A cursor of the theme (see the top): deterministic for a theme, kind and options. */
export function generateCursor(kind: CursorKind, theme: Theme, o: CursorOptions = {}): Cursor {
  const size = Math.max(8, Math.floor(o.size ?? 12));
  const S = stream(createRoll(deriveSeed(`${theme.recipe.seed}/${theme.culture}`, "ui/cursor")), 0);
  // (Every choice drawn up front, whatever the kind: a kind never shifts another's.)
  const tail = S.between(0.52, 0.66), slant = S.between(0.2, 0.3), notch = S.between(0.55, 0.7);
  const ringGap = S.pick([1, 2]);
  const outline = theme.palette.outline;
  let art: Bitmap, hot: [number, number];
  if (kind === "target" || kind === "attack") {
    // A crosshair: a ring with a gap each way, four ticks, a centre dot -- an odd size, so it has a middle pixel.
    const n = size + 3 + ((size + 3) % 2 === 0 ? 1 : 0), c = (n - 1) / 2, r = c - 1.5;
    const ramp = rampOf(theme, kind === "attack" ? "bad" : "accent");
    const m = new Uint8Array(n * n);
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
      const d = Math.hypot(x - c, y - c);
      const onAxis = x === c || y === c;
      if (Math.abs(d - r) < 0.62 && !(onAxis && ringGap > 1)) m[y * n + x] = 1;
      if (onAxis && d >= r - 2.5 && d <= r + 1.2 && d > 2) m[y * n + x] = 1;
      if (d < 0.6) m[y * n + x] = 1;
    }
    art = shadeIcon(m, n, ramp, outline, "solid");
    hot = [c + 1, c + 1];
  } else if (kind.startsWith("scroll-")) {
    // An arrowhead pointing off the edge, its tip the hotspot.
    const [dx, dy] = DIRS[kind.slice(7)]!;
    const l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
    const n = size;
    const tip: [number, number] = [0.5 + ux * 0.46, 0.5 + uy * 0.46];
    const back = 0.62, wide = 0.42;
    const bx = tip[0] - ux * back, by = tip[1] - uy * back;
    const shape: Contour = [tip[0], tip[1], bx - uy * wide, by + ux * wide, bx + ux * 0.18, by + uy * 0.18, bx + uy * wide, by - ux * wide];
    art = shadeIcon(maskOf([shape], n), n, rampOf(theme, "accent"), outline, "solid");
    hot = [Math.round(1 + tip[0] * (n - 1)), Math.round(1 + tip[1] * (n - 1))];
  } else {
    // The pointer: an arrow, its tip the hotspot (tail and slant from the theme's seed).
    const n = size;
    const arrow: Contour = [0.04, 0.02, 0.04, 0.9, 0.04 + slant, 0.9 - slant * 0.9, 0.04 + slant + 0.16, 0.98, 0.04 + slant + 0.32, 0.9, 0.04 + slant + 0.18, notch + 0.06, tail + 0.12, notch];
    const pointer = shadeIcon(maskOf([arrow], n), n, rampOf(theme, "ink"), outline, "solid");
    const badge = BADGE[kind];
    if (badge && ICON_RECIPES[badge.icon]) {
      // An order cursor: the pointer with its order's icon at the lower right.
      const bs = Math.max(7, Math.round(size * 0.75));
      const icon = shadeIcon(iconMask(badge.icon, bs, theme.recipe.seed, undefined, theme.icon.stroke), bs, rampOf(theme, badge.tone), outline, "solid");
      art = createBitmap(pointer.w + Math.ceil(bs * 0.6), pointer.h + Math.ceil(bs * 0.6));
      stamp(art, pointer, 0, 0);
      stamp(art, icon, art.w - icon.w, art.h - icon.h);
    } else art = pointer;
    hot = [1, 1];
  }
  const want = Math.max(1, Math.floor(o.scale ?? 1));
  const k = Math.max(1, Math.min(want, Math.floor(128 / Math.max(art.w, art.h))));
  return { kind, bitmap: upscale(art, k), hotspot: [hot[0] * k, hot[1] * k], scale: k };
}
