// Pixel bitmaps: the UI layer, atlas pages, glyphs, icons and frame pieces are
// all one shape -- a width, a height and a Uint32Array of RGBA words (see
// color.ts). Every drawing call clips to a rectangle, so a redraw can be
// confined to the dirty part of the layer.

import type { Rgba } from "./color.ts";

export interface Bitmap {
  readonly w: number;
  readonly h: number;
  readonly px: Uint32Array;
}

/** A clip rectangle: x0,y0 inclusive, x1,y1 exclusive. */
export interface Clip { x0: number; y0: number; x1: number; y1: number }
export interface Rect { x: number; y: number; w: number; h: number }

export function createBitmap(w: number, h: number): Bitmap {
  if (!(w >= 0 && h >= 0 && Number.isInteger(w) && Number.isInteger(h))) throw new RangeError(`A bitmap is whole pixels (got ${w}x${h}).`);
  return { w, h, px: new Uint32Array(w * h) };
}
/** The bitmap's bytes (RGBA, row by row): what a canvas's ImageData or a texture upload takes. */
export const bytesOf = (b: Bitmap): Uint8ClampedArray => new Uint8ClampedArray(b.px.buffer, b.px.byteOffset, b.px.byteLength);

export const fullClip = (b: Bitmap): Clip => ({ x0: 0, y0: 0, x1: b.w, y1: b.h });
export const clipOf = (r: Rect): Clip => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
export function intersect(a: Clip, b: Clip): Clip {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}
export const isEmpty = (c: Clip): boolean => c.x1 <= c.x0 || c.y1 <= c.y0;
export const overlaps = (r: Rect, c: Clip): boolean => r.x < c.x1 && r.x + r.w > c.x0 && r.y < c.y1 && r.y + r.h > c.y0;

/** Fill a rectangle with one colour. */
export function fillRect(dst: Bitmap, x: number, y: number, w: number, h: number, c: Rgba, clip: Clip = fullClip(dst)): void {
  const x0 = Math.max(x, clip.x0, 0), y0 = Math.max(y, clip.y0, 0);
  const x1 = Math.min(x + w, clip.x1, dst.w), y1 = Math.min(y + h, clip.y1, dst.h);
  if (x1 <= x0) return;
  const px = dst.px;
  for (let yy = y0; yy < y1; yy += 1) px.fill(c, yy * dst.w + x0, yy * dst.w + x1);
}

/** Fill a rectangle with a tile repeated in LAYER coordinates (so patterns line up across panels). 0 in the tile leaves the pixel. */
export function fillTile(dst: Bitmap, x: number, y: number, w: number, h: number, tile: Bitmap, clip: Clip = fullClip(dst)): void {
  const x0 = Math.max(x, clip.x0, 0), y0 = Math.max(y, clip.y0, 0);
  const x1 = Math.min(x + w, clip.x1, dst.w), y1 = Math.min(y + h, clip.y1, dst.h);
  if (x1 <= x0) return;
  const tw = tile.w, th = tile.h, tp = tile.px, px = dst.px;
  for (let yy = y0; yy < y1; yy += 1) {
    const trow = (yy % th) * tw;
    let o = yy * dst.w + x0;
    for (let xx = x0; xx < x1; xx += 1, o += 1) {
      const c = tp[trow + (xx % tw)]!;
      if (c !== 0) px[o] = c;
    }
  }
}

/** Copy a rectangle of `src` to (dx, dy); transparent source pixels leave the destination. */
export function blit(dst: Bitmap, src: Bitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, clip: Clip = fullClip(dst)): void {
  const cx0 = Math.max(clip.x0, 0, dx), cy0 = Math.max(clip.y0, 0, dy);
  const cx1 = Math.min(clip.x1, dst.w, dx + sw), cy1 = Math.min(clip.y1, dst.h, dy + sh);
  if (cx1 <= cx0 || cy1 <= cy0) return;
  const sp = src.px, px = dst.px;
  for (let yy = cy0; yy < cy1; yy += 1) {
    let s = (sy + yy - dy) * src.w + sx + (cx0 - dx);
    let o = yy * dst.w + cx0;
    for (let xx = cx0; xx < cx1; xx += 1, s += 1, o += 1) {
      const c = sp[s]!;
      if (c !== 0) px[o] = c;
    }
  }
}

/** Draw a mask (any non-zero source pixel) in one colour: glyphs, and icons drawn as silhouettes. */
export function blitMask(dst: Bitmap, src: Bitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, c: Rgba, clip: Clip = fullClip(dst)): void {
  const cx0 = Math.max(clip.x0, 0, dx), cy0 = Math.max(clip.y0, 0, dy);
  const cx1 = Math.min(clip.x1, dst.w, dx + sw), cy1 = Math.min(clip.y1, dst.h, dy + sh);
  if (cx1 <= cx0 || cy1 <= cy0) return;
  const sp = src.px, px = dst.px;
  for (let yy = cy0; yy < cy1; yy += 1) {
    let s = (sy + yy - dy) * src.w + sx + (cx0 - dx);
    let o = yy * dst.w + cx0;
    for (let xx = cx0; xx < cx1; xx += 1, s += 1, o += 1) if (sp[s]! !== 0) px[o] = c;
  }
}

/** A one-pixel rectangle outline. */
export function strokeRect(dst: Bitmap, x: number, y: number, w: number, h: number, c: Rgba, clip: Clip = fullClip(dst)): void {
  if (w <= 0 || h <= 0) return;
  fillRect(dst, x, y, w, 1, c, clip);
  fillRect(dst, x, y + h - 1, w, 1, c, clip);
  fillRect(dst, x, y + 1, 1, h - 2, c, clip);
  fillRect(dst, x + w - 1, y + 1, 1, h - 2, c, clip);
}

/** Set one pixel (clipped). */
export function plot(dst: Bitmap, x: number, y: number, c: Rgba, clip: Clip = fullClip(dst)): void {
  if (x >= clip.x0 && y >= clip.y0 && x < clip.x1 && y < clip.y1 && x >= 0 && y >= 0 && x < dst.w && y < dst.h) dst.px[y * dst.w + x] = c;
}

/** A Bresenham line, one pixel wide. */
export function line(dst: Bitmap, x0: number, y0: number, x1: number, y1: number, c: Rgba, clip: Clip = fullClip(dst)): void {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(dst, x0, y0, c, clip);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** A copy of part of a bitmap. */
export function crop(src: Bitmap, x: number, y: number, w: number, h: number): Bitmap {
  const out = createBitmap(w, h);
  blit(out, src, x, y, w, h, 0, 0);
  return out;
}

/** Hash a bitmap's pixels (FNV-1a over the words): determinism checks and cache keys. */
export function hashBitmap(b: Bitmap): string {
  let h = 0x811c9dc5;
  h = Math.imul(h ^ b.w, 0x01000193) >>> 0;
  h = Math.imul(h ^ b.h, 0x01000193) >>> 0;
  for (let i = 0; i < b.px.length; i += 1) h = Math.imul(h ^ b.px[i]!, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
