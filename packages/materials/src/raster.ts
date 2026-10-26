// Pixels in and out of art resolution: area resampling at any ratio, colour
// quantising by median cut, and luminance. Plain RGBA bytes, no canvas, so the
// same code runs in a page, in Node and in the SDK's tools.

/** RGBA bytes, row-major, top-down. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

export const luminance = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

export function checkRaster(image: Raster): void {
  const { width, height, rgba } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_777_216) throw new RangeError("A raster is 1..16M pixels.");
  if (rgba.length !== width * height * 4) throw new RangeError("A raster's RGBA length must be width x height x 4.");
}

// Each target pixel is the area-weighted mean of the source pixels it covers,
// along one axis at a time, so a 512-texel sheet of 42.67-texel cells comes
// down to exactly 16 art pixels a cell.
function weights(from: number, to: number): { readonly start: Int32Array; readonly taps: Float64Array[] } {
  const scale = from / to, start = new Int32Array(to), taps: Float64Array[] = [];
  for (let i = 0; i < to; i += 1) {
    const a = i * scale, b = (i + 1) * scale, first = Math.floor(a), last = Math.min(from - 1, Math.ceil(b) - 1);
    const w = new Float64Array(last - first + 1);
    for (let s = first; s <= last; s += 1) w[s - first] = (Math.min(b, s + 1) - Math.max(a, s)) / scale;
    start[i] = first;
    taps.push(w);
  }
  return { start, taps };
}

/** The image resampled by area to width x height (down or up). */
export function resampleArea(image: Raster, width: number, height: number): Raster {
  checkRaster(image);
  const wx = weights(image.width, width), wy = weights(image.height, height);
  const rows = new Float64Array(image.height * width * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const taps = wx.taps[x]!, s0 = wx.start[x]!;
      for (let k = 0; k < 4; k += 1) {
        let sum = 0;
        for (let t = 0; t < taps.length; t += 1) sum += taps[t]! * image.rgba[(y * image.width + s0 + t) * 4 + k]!;
        rows[(y * width + x) * 4 + k] = sum;
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const taps = wy.taps[y]!, s0 = wy.start[y]!;
    for (let x = 0; x < width; x += 1) {
      for (let k = 0; k < 4; k += 1) {
        let sum = 0;
        for (let t = 0; t < taps.length; t += 1) sum += taps[t]! * rows[((s0 + t) * width + x) * 4 + k]!;
        rgba[(y * width + x) * 4 + k] = Math.round(sum);
      }
    }
  }
  return { width, height, rgba };
}

/** The image scaled to width x height, nearest: how art pixels become texels. */
export function resampleNearest(image: Raster, width: number, height: number): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      rgba.set(image.rgba.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/**
 * Quantises RGBA pixels to at most `colours` colours (RGBA) by median cut,
 * always splitting the box with the most squared colour error, so a minority
 * hue (the red cells among orange ones) gets its own colours rather than being
 * averaged away. Pixels under half alpha share one clear colour. The palette
 * comes back darkest first; `indices` names each pixel's colour.
 */
export function quantize(rgba: Uint8Array | Uint8ClampedArray, colours: number): { readonly palette: Uint8Array; readonly indices: Uint8Array } {
  const count = rgba.length / 4;
  const clear: number[] = [], solid: number[] = [];
  for (let i = 0; i < count; i += 1) (rgba[i * 4 + 3]! < 128 ? clear : solid).push(i);
  type Box = { readonly pixels: number[]; readonly error: number; readonly channel: number };
  const box = (pixels: number[]): Box => {
    let error = 0, channel = 0, widest = -1;
    for (let k = 0; k < 3; k += 1) {
      let sum = 0, sq = 0, lo = 255, hi = 0;
      for (const p of pixels) { const v = rgba[p * 4 + k]!; sum += v; sq += v * v; if (v < lo) lo = v; if (v > hi) hi = v; }
      error += sq - (sum * sum) / pixels.length;
      if (hi - lo > widest) { widest = hi - lo; channel = k; }
    }
    return { pixels, error: widest > 0 ? error : 0, channel };
  };
  const boxes: Box[] = solid.length > 0 ? [box(solid)] : [];
  const room = Math.max(1, colours - (clear.length > 0 ? 1 : 0));
  while (boxes.length > 0 && boxes.length < room) {
    let pick = 0;
    boxes.forEach((b, i) => { if (b.error > boxes[pick]!.error) pick = i; });
    const { pixels, error, channel } = boxes[pick]!;
    if (error <= 0 || pixels.length < 2) break;
    pixels.sort((a, b) => rgba[a * 4 + channel]! - rgba[b * 4 + channel]! || a - b);
    boxes.splice(pick, 1, box(pixels.slice(0, pixels.length >> 1)), box(pixels.slice(pixels.length >> 1)));
  }
  const means = boxes.map(({ pixels }) => [0, 1, 2].map((k) => Math.round(pixels.reduce((s, p) => s + rgba[p * 4 + k]!, 0) / pixels.length)) as [number, number, number]);
  means.sort((a, b) => luminance(...a) - luminance(...b));
  const entries = [...(clear.length > 0 ? [[0, 0, 0, 0]] : []), ...means.map((m) => [...m, 255])];
  const palette = Uint8Array.from(entries.flat());
  const indices = new Uint8Array(count);
  const first = clear.length > 0 ? 1 : 0;
  for (const p of solid) {
    let best = first, bestD = Infinity;
    for (let c = first; c < entries.length; c += 1) {
      const dr = rgba[p * 4]! - palette[c * 4]!, dg = rgba[p * 4 + 1]! - palette[c * 4 + 1]!, db = rgba[p * 4 + 2]! - palette[c * 4 + 2]!;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    indices[p] = best;
  }
  return { palette, indices };
}

/**
 * Palette indices sampled down by the most common index in each target
 * pixel's area (at least one source pixel): edges stay hard where an area
 * mean would blur them into mid-tones.
 */
export function sampleMode(indices: Uint8Array, width: number, height: number, toWidth: number, toHeight: number): Uint8Array {
  const out = new Uint8Array(toWidth * toHeight), counts = new Uint32Array(256);
  for (let y = 0; y < toHeight; y += 1) {
    const y0 = Math.floor((y * height) / toHeight), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / toHeight));
    for (let x = 0; x < toWidth; x += 1) {
      const x0 = Math.floor((x * width) / toWidth), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / toWidth));
      let best = 0, most = 0;
      for (let sy = y0; sy < y1; sy += 1) for (let sx = x0; sx < x1; sx += 1) {
        const i = indices[sy * width + sx]!, c = (counts[i] = counts[i]! + 1);
        if (c > most || (c === most && i < best)) { most = c; best = i; }
      }
      for (let sy = y0; sy < y1; sy += 1) for (let sx = x0; sx < x1; sx += 1) counts[indices[sy * width + sx]!] = 0;
      out[y * toWidth + x] = best;
    }
  }
  return out;
}

/** Palette indices (an RGBA palette) as RGBA. */
export function paletteRaster(palette: Uint8Array, indices: Uint8Array, width: number, height: number): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) rgba.set(palette.subarray(indices[i]! * 4, indices[i]! * 4 + 4), i * 4);
  return { width, height, rgba };
}
