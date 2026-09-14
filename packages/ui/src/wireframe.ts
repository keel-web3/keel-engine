// Wireframes and level icons: a thing's silhouette as a line-drawn outline
// icon -- the classic selection-grid glyph a strategy game tints green, yellow
// or red by health. The game hands in its own silhouette (a sprite's solid
// texels, and optionally the part edges inside it); wireframeOf() crops it,
// fits it into a square with whole-pixel scaling (up by an integer factor, or
// down by coverage), and classifies every pixel into a LEVEL:
//
//   0  nothing
//   1  shadow: the ring just outside the line (so it reads on any panel)
//   2  line: the silhouette's own contour
//   3  detail: an edge between parts inside it (a head, an arm, a turret)
//   4  fill: a sparse dither of the body (it reads as solid, not a hole)
//
// A LEVEL ICON has no colours of its own: registered with ui.registerIcon()
// it's painted in whatever tone the node asks for (`tone: "good" | "warn" |
// "bad"`, or a team ramp) -- one icon per type, every health colour free.

import { createBitmap } from "./bitmap.ts";
import type { Bitmap } from "./bitmap.ts";
import type { Rgba } from "./color.ts";
import type { Ramp } from "./theme.ts";

export const WIRE_LEVELS = { none: 0, shadow: 1, line: 2, detail: 3, fill: 4 } as const;

/** An icon of levels (see the top): painted in a tone's ramp when drawn. */
export interface LevelIcon { readonly w: number; readonly h: number; readonly levels: Uint8Array }
export const isLevelIcon = (x: unknown): x is LevelIcon => !!x && typeof x === "object" && (x as LevelIcon).levels instanceof Uint8Array;

/** A silhouette: 1 where the thing is (row by row), and optionally 1 where an edge between its parts runs. */
export interface Silhouette { readonly w: number; readonly h: number; readonly solid: Uint8Array; readonly edges?: Uint8Array }

export interface WireframeOptions {
  /** Pixels kept free round the drawing (default 1: the shadow ring's room). */
  readonly margin?: number;
  /** The body's dither: "sparse" (1 in 4, default), "none" (a hollow line drawing) or "half" (a checker). */
  readonly fill?: "sparse" | "none" | "half";
  /** Part edges inside the silhouette drawn as detail lines (default true, when the source has them). */
  readonly detail?: boolean;
  /** The most it's scaled up (default: as far as fits). 1 keeps every type at its art size: a group's sizes compare. */
  readonly maxScale?: number;
}

/** A silhouette as a `size` x `size` wireframe level icon (deterministic; see the top). */
export function wireframeOf(src: Silhouette, size: number, o: WireframeOptions = {}): LevelIcon {
  if (!(size >= 4 && Number.isInteger(size))) throw new RangeError(`A wireframe is at least 4 whole pixels (got ${size}).`);
  const margin = Math.max(0, Math.floor(o.margin ?? 1));
  const levels = new Uint8Array(size * size);
  // Crop to what's there.
  let x0 = src.w, y0 = src.h, x1 = -1, y1 = -1;
  for (let y = 0; y < src.h; y += 1) for (let x = 0; x < src.w; x += 1) if (src.solid[y * src.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { w: size, h: size, levels };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const avail = Math.max(1, size - 2 * margin);
  // Whole-pixel fit: up by an integer factor, or down by coverage (never a blurry in-between).
  const up = Math.max(1, Math.min(Math.floor(o.maxScale ?? 99), Math.floor(Math.min(avail / bw, avail / bh))));
  const down = Math.max(1, Math.ceil(Math.max(bw / avail, bh / avail)));
  const tw = bw > avail || bh > avail ? Math.ceil(bw / down) : bw * up;
  const th = bw > avail || bh > avail ? Math.ceil(bh / down) : bh * up;
  const solid = new Uint8Array(tw * th), edge = new Uint8Array(tw * th);
  const detail = o.detail !== false && !!src.edges;
  for (let ty = 0; ty < th; ty += 1) for (let tx = 0; tx < tw; tx += 1) {
    if (bw <= avail && bh <= avail) {
      const sx = x0 + Math.floor(tx / up), sy = y0 + Math.floor(ty / up);
      const i = sy * src.w + sx;
      solid[ty * tw + tx] = src.solid[i]! ? 1 : 0;
      // (Scaled up, an edge texel draws only on its block's first row and column: lines stay one pixel wide.)
      if (detail && src.edges![i] && (tx % up === 0 || ty % up === 0)) edge[ty * tw + tx] = 1;
    } else {
      let on = 0, e = 0, n = 0;
      for (let dy = 0; dy < down; dy += 1) for (let dx = 0; dx < down; dx += 1) {
        const sx = x0 + tx * down + dx, sy = y0 + ty * down + dy;
        if (sx > x1 || sy > y1) continue;
        n += 1;
        const i = sy * src.w + sx;
        if (src.solid[i]) { on += 1; if (detail && src.edges![i]) e += 1; }
      }
      solid[ty * tw + tx] = n && on / n >= 0.4 ? 1 : 0;
      edge[ty * tw + tx] = detail && on && e / on >= 0.34 ? 1 : 0;
    }
  }
  // Centred (bottom-heavy things sit on the same line: the drawing's centre, rounded down).
  const ox = Math.floor((size - tw) / 2), oy = Math.floor((size - th) / 2);
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < tw && y < th ? solid[y * tw + x]! : 0);
  const fill = o.fill ?? "sparse";
  for (let ty = 0; ty < th; ty += 1) for (let tx = 0; tx < tw; tx += 1) {
    if (!at(tx, ty)) continue;
    const X = ox + tx, Y = oy + ty;
    if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
    const contour = !at(tx - 1, ty) || !at(tx + 1, ty) || !at(tx, ty - 1) || !at(tx, ty + 1);
    let lv: number = WIRE_LEVELS.none;
    if (contour) lv = WIRE_LEVELS.line;
    else if (edge[ty * tw + tx]) lv = WIRE_LEVELS.detail;
    else if (fill === "half" ? (X + Y) % 2 === 0 : fill === "sparse" ? X % 2 === 0 && Y % 2 === 0 : false) lv = WIRE_LEVELS.fill;
    levels[Y * size + X] = lv;
  }
  // The shadow ring: every empty pixel touching the drawing (8 ways).
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const i = y * size + x;
    if (levels[i] || at(x - ox, y - oy)) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (at(x - ox + dx, y - oy + dy)) { near = true; break; }
    if (near) levels[i] = WIRE_LEVELS.shadow;
  }
  return { w: size, h: size, levels };
}

/** A level icon painted: shadow in the outline colour, the line bright, detail mid, fill dark -- from one ramp. */
export function paintLevels(icon: LevelIcon, ramp: Ramp, outline: Rgba): Bitmap {
  const b = createBitmap(icon.w, icon.h);
  const colour = [0, outline, ramp[3]!, ramp[2]!, ramp[1]!] as const;
  for (let i = 0; i < icon.levels.length; i += 1) { const l = icon.levels[i]!; if (l) b.px[i] = colour[Math.min(4, l)]!; }
  return b;
}
