import type { PinballViewStyle } from "./types.ts";

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** Actual ordered Bayer quantization; alpha and physics are untouched. */
export function ditherRgba(data: Uint8ClampedArray, width: number, height: number): void {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const threshold = (BAYER_4[(y % 4) * 4 + x % 4]! / 16 - 0.5) * 40;
    for (let channel = 0; channel < 3; channel++) {
      const value = Math.max(0, Math.min(255, (data[offset + channel] ?? 0) + threshold));
      data[offset + channel] = Math.round(value / 51) * 51;
    }
  }
}

export function renderPixelRatio(style: PinballViewStyle, width: number, height: number, displayRatio: number): number {
  if (style === "pixel") return Math.min(0.5, 640 / Math.max(width, height));
  if (style === "dither") return Math.min(0.75, 480 / Math.max(width, height), Math.sqrt(130_000 / (width * height)));
  return displayRatio;
}
