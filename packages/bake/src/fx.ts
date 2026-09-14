// Per-instance effects for layered sprites (SpriteRenderer.drawLayersFx): the
// layer instance's spare float carries a FLASH and a DISSOLVE, so a strategy
// game can show a unit taking a hit (a flash up its ramps), a death fading out
// or a warp-in fading in (texels dropped on a 4x4 screen), and a corpse
// dissolving away -- with no extra bake, no extra draw, and every pixel still
// a palette entry.
//
//   instances.data[i * LAYER_INSTANCE_FLOATS + 13] = packFx(flash, dissolve);
//   sprites.drawLayersFx(view, instances, style);
//
// The packing: the whole part is the dissolve in 16ths (0..16: that share of
// the 4x4 Bayer screen is dropped, anchored to the screen like the dither), the
// fraction is the flash (0..0.999). A flash lifts each texel `ceil(flash * len)`
// steps up its own ramp; past FLASH_WHITE it's the ramp's lightest entry. The
// outline stays dark (a flashing unit keeps its silhouette). Plain RGBA sprites
// (look -1) dissolve but don't flash (their colours are baked).
//
// fxIndex / fxDropped are the shader's rules as plain code (the tests' reference).

/** Past this flash every texel is its ramp's lightest entry. */
export const FLASH_WHITE = 0.7;

/** The spare float for a flash (0..1) and a dissolve (0..1, the share of texels dropped). */
export function packFx(flash: number, dissolve: number): number {
  const d = Math.max(0, Math.min(16, Math.round(dissolve * 16)));
  const f = Math.max(0, Math.min(0.999, flash));
  return d + f;
}
/** The spare float back to { flash, dissolve }. */
export function unpackFx(v: number): { flash: number; dissolve: number } {
  const x = Math.max(0, v);
  const d = Math.floor(x);
  return { flash: x - d, dissolve: Math.min(16, d) / 16 };
}
/** Where a texel on step `idx` of a ramp `len` long lands under a flash (the shader's rule; the outline isn't flashed). */
export function fxIndex(idx: number, len: number, flash: number, edge = false): number {
  if (edge || flash <= 0) return idx;
  if (flash > FLASH_WHITE) return len - 1;
  return Math.min(len - 1, idx + Math.ceil(flash * len));
}
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Is the screen pixel (x, y) dropped at this dissolve (the shader's rule: the 4x4 Bayer threshold)? */
export function fxDropped(x: number, y: number, dissolve: number): boolean {
  if (dissolve <= 0) return false;
  const b = (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
  return b < dissolve;
}
