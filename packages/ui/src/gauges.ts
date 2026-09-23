// Gauges for a game's HUD, drawn into bitmaps a picture node (image, minimap,
// portrait) shows: pixel text with an arcade outline, a dial (a tach, a boost
// gauge -- a segmented sweep, a redline, a needle), and a radar (a minimap
// that turns with the player: lines for roads or paths, one highlighted as the
// route, markers for everyone else). Pure pixels: nothing smoothed, nothing
// scaled -- the UI layer shows them at the UI's own whole scale.

import { fillRect, line, plot } from "./bitmap.ts";
import type { Bitmap } from "./bitmap.ts";
import type { Rgba } from "./color.ts";
import { glyphOf } from "./font.ts";
import type { Glyph, PixelFont } from "./font.ts";

/** A string's width in a font (px). */
export function textWidth(font: PixelFont, s: string): number {
  let w = 0;
  for (const ch of s) w += glyphOf(font, ch.charCodeAt(0))?.adv ?? Math.ceil(font.size / 2);
  return w;
}

// Glyph geometry is immutable (the font atlas uses the same contract). Cache only coverage,
// so colors, alignment and destination contents stay live. The LRU holds at most 128 KiB.
const GLYPH_BYTES = 128 * 1024, GLYPH_COUNT = 256;
type GlyphRuns = { ink: Int32Array; outline: Int32Array; bytes: number };
const glyphRuns = new Map<Glyph, GlyphRuns>();
let glyphBytes = 0;
function runsOf(g: Glyph): GlyphRuns {
  const found = glyphRuns.get(g);
  if (found) { glyphRuns.delete(g); glyphRuns.set(g, found); return found; }
  const stride = g.w + 2, mask = new Uint8Array(stride * (g.h + 2));
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.bits[y * g.w + x]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) mask[(y + dy + 1) * stride + x + dx + 1] = 1;
    }
  }
  const runs = (bits: Uint8Array, w: number, h: number, offset: number): Int32Array => {
    const out: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
      if (!bits[y * w + x]) { x++; continue; }
      const from = x++;
      while (x < w && bits[y * w + x]) x++;
      out.push(y + offset, from + offset, x + offset);
    }
    return Int32Array.from(out);
  };
  const ink = runs(g.bits, g.w, g.h, 0), outline = runs(mask, stride, g.h + 2, -1);
  const made = { ink, outline, bytes: ink.byteLength + outline.byteLength + g.bits.byteLength };
  if (made.bytes <= GLYPH_BYTES) {
    while (glyphBytes + made.bytes > GLYPH_BYTES || glyphRuns.size >= GLYPH_COUNT) {
      const first = glyphRuns.keys().next().value!;
      glyphBytes -= glyphRuns.get(first)!.bytes; glyphRuns.delete(first);
    }
    glyphRuns.set(g, made); glyphBytes += made.bytes;
  }
  return made;
}
function stampGlyph(b: Bitmap, g: Glyph, x: number, y: number, c: Rgba, outlined: boolean): void {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    // Keep the direct painter's exact arithmetic for fractional font metrics/positions.
    for (let dy = outlined ? -1 : 0; dy <= (outlined ? 1 : 0); dy++) for (let dx = outlined ? -1 : 0; dx <= (outlined ? 1 : 0); dx++) {
      if (outlined && dx === 0 && dy === 0) continue;
      for (let gy = 0; gy < g.h; gy++) for (let gx = 0; gx < g.w; gx++) if (g.bits[gy * g.w + gx]) plot(b, x + gx + dx, y + gy + dy, c);
    }
    return;
  }
  const cached = runsOf(g), runs = outlined ? cached.outline : cached.ink;
  for (let i = 0; i < runs.length; i += 3) {
    const Y = y + runs[i]!;
    if (Y < 0 || Y >= b.h) continue;
    const start = Math.max(0, x + runs[i + 1]!), end = Math.min(b.w, x + runs[i + 2]!);
    if (start < end) b.px.fill(c, Y * b.w + start, Y * b.w + end);
  }
}

/** Text into a bitmap with its top at y; x is its left, centre or right; an outline all round when asked. */
export function textInto(b: Bitmap, font: PixelFont, s: string, x: number, y: number, c: Rgba, o: { readonly outline?: Rgba; readonly align?: "left" | "center" | "right" } = {}): void {
  const w = textWidth(font, s);
  const x0 = Math.round(o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x), base = y + font.ascent;
  const pass = (outline: boolean, col: Rgba): void => {
    let pen = x0;
    for (const ch of s) {
      const g = glyphOf(font, ch.charCodeAt(0));
      if (!g) { pen += Math.ceil(font.size / 2); continue; }
      stampGlyph(b, g, pen + g.ox, base + g.oy, col, outline);
      pen += g.adv;
    }
  };
  // All outlines precede all ink, including glyphs whose bearings/advances overlap.
  if (o.outline !== undefined) pass(true, o.outline);
  pass(false, c);
}

/** A filled disc. */
export function discInto(b: Bitmap, cx: number, cy: number, r: number, c: Rgba): void {
  for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) if (x * x + y * y <= r * r + r * 0.6) plot(b, Math.round(cx + x), Math.round(cy + y), c);
}

export interface DialStyle {
  /** The sweep: start and end angle (radians, 0 up, clockwise), and its ring's inner and outer radius. */
  readonly from: number;
  readonly to: number;
  readonly inner: number;
  readonly outer: number;
  /** Steps it's cut into (0: continuous). */
  readonly segments: number;
  /** Lit, unlit, the redline zone's colour (lit or not), the needle and the face (0: none for either). */
  readonly on: Rgba;
  readonly off: Rgba;
  readonly red: Rgba;
  readonly needle: Rgba;
  readonly face: Rgba;
}

/**
 * A dial into a square bitmap `size` across, centred: the sweep lit to `value` (0..1), the stretch past `redline` (0..1)
 * in the red colour, and a needle at the value. A tach; with a second, thinner call inside it, a boost ring.
 */
export function dialInto(b: Bitmap, cx: number, cy: number, value: number, redline: number, s: DialStyle): void {
  const v = Math.max(0, Math.min(1, value));
  if (s.face) discInto(b, cx, cy, s.inner - 1, s.face);
  for (let y = -s.outer; y <= s.outer; y += 1) for (let x = -s.outer; x <= s.outer; x += 1) {
    const d = Math.sqrt(x * x + y * y);
    if (d < s.inner || d > s.outer) continue;
    const t = (Math.atan2(x, -y) - s.from) / (s.to - s.from);
    if (t < 0 || t > 1) continue;
    if (s.segments > 0 && (t * s.segments) % 1 > 0.72) continue;
    plot(b, cx + x, cy + y, t > redline ? (t <= v ? s.red : s.off) : t <= v ? s.on : s.off);
  }
  const a = s.from + (s.to - s.from) * v;
  if (s.needle) line(b, cx, cy, Math.round(cx + Math.sin(a) * (s.outer - 1)), Math.round(cy - Math.cos(a) * (s.outer - 1)), s.needle);
}

export interface RadarStyle {
  /** The disc's colour, its rim, the lines (roads), the route, the player marker, other markers. */
  readonly ground: Rgba;
  readonly rim: Rgba;
  readonly lines: Rgba;
  readonly route: Rgba;
  readonly player: Rgba;
  readonly marker: Rgba;
}

export interface RadarView {
  /** The world point at its middle, and which way is up (the player's heading, frame convention: 0 faces +z). */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** World metres from the middle to the rim. */
  readonly reach: number;
}

/**
 * A round radar into a bitmap, centred at (cx, cy) with radius r, turning with the player: `lines` as world polylines
 * (x, z pairs) -- roads, paths -- the `route` over them in its own colour, other markers as dots, and the player as an
 * arrowhead in the middle pointing up. Anything past the rim is clipped (a marker past it sits ON the rim: still seen).
 */
export function radarInto(b: Bitmap, cx: number, cy: number, r: number, view: RadarView, lines: readonly Float32Array[], route: Float32Array | null, markers: readonly { readonly x: number; readonly z: number; readonly c?: Rgba }[], s: RadarStyle): void {
  const k = r / view.reach, cyaw = Math.cos(view.yaw), syaw = Math.sin(view.yaw);
  // (World to radar: turn so the heading points up; +x right.)
  const to = (x: number, z: number): [number, number] => {
    const dx = x - view.x, dz = z - view.z;
    const right = dx * cyaw - dz * syaw, fwd = dx * syaw + dz * cyaw;
    return [cx + right * k, cy - fwd * k];
  };
  const inside = (x: number, y: number): boolean => (x - cx) ** 2 + (y - cy) ** 2 <= (r - 1) ** 2;
  discInto(b, cx, cy, r, s.ground);
  const draw = (pl: Float32Array, c: Rgba, thick: boolean): void => {
    for (let i = 0; i + 3 < pl.length; i += 2) {
      const [x0, y0] = to(pl[i]!, pl[i + 1]!), [x1, y1] = to(pl[i + 2]!, pl[i + 3]!);
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let t = 0; t <= n; t += 1) {
        const x = Math.round(x0 + ((x1 - x0) * t) / n), y = Math.round(y0 + ((y1 - y0) * t) / n);
        if (!inside(x, y)) continue;
        plot(b, x, y, c);
        if (thick) { plot(b, x + 1, y, c); plot(b, x, y + 1, c); }
      }
    }
  };
  for (const pl of lines) draw(pl, s.lines, false);
  if (route) draw(route, s.route, true);
  for (const m of markers) {
    let [x, y] = to(m.x, m.z);
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (d > r - 3) { x = cx + ((x - cx) / d) * (r - 3); y = cy + ((y - cy) / d) * (r - 3); }
    fillRect(b, Math.round(x) - 1, Math.round(y) - 1, 3, 3, m.c ?? s.marker);
  }
  // The player: an arrowhead pointing up.
  for (let row = 0; row < 5; row += 1) for (let col = -row; col <= row; col += 1) if (row < 4 || Math.abs(col) >= 2) plot(b, cx + col, cy - 3 + row, s.player);
  // The rim.
  for (let a = 0; a < 360; a += 1) { const t = (a * Math.PI) / 180; plot(b, Math.round(cx + Math.sin(t) * r), Math.round(cy - Math.cos(t) * r), s.rim); }
}
