// PNG in and out, in the page and in Node alike: decodePng for imported icons,
// bitmap fonts and image-grid fonts (8-bit greyscale, grey+alpha, RGB, RGBA
// and palette images, 1/2/4/8-bit palettes, non-interlaced -- what pixel art
// tools write); encodePng (stored, uncompressed: exact and small code) for the
// tools' captures and the tests' fixtures.

import { createBitmap } from "../bitmap.ts";
import type { Bitmap } from "../bitmap.ts";
import { deflateStored, inflate } from "./inflate.ts";

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(bytes: Uint8Array): Bitmap {
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== SIG[i]) throw new RangeError("Not a PNG.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const kind = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = data[8]!; type = data[9]!; interlace = data[12]!; }
    else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (interlace) throw new RangeError("Interlaced PNGs aren't supported: save it non-interlaced.");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || (depth !== 8 && !(type === 3 || type === 0)) || depth > 8) throw new RangeError(`PNG colour type ${type} at ${depth} bits isn't supported.`);
  const all = new Uint8Array(idat.reduce((s, d) => s + d.length, 0));
  let o = 0;
  for (const d of idat) { all.set(d, o); o += d.length; }
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((w * channels * depth) / 8);
  const raw = inflate(all, (stride + 1) * h);
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = createBitmap(w, h);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp]! : 0, b = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
      let v = row[i]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x += 1) {
      let r = 0, g = 0, bl = 0, al = 255;
      if (depth < 8) {
        const per = 8 / depth;
        const s = (cur[Math.floor(x / per)]! >> ((per - 1 - (x % per)) * depth)) & ((1 << depth) - 1);
        if (type === 3) { r = palette![s * 3]!; g = palette![s * 3 + 1]!; bl = palette![s * 3 + 2]!; al = trns && s < trns.length ? trns[s]! : 255; }
        else { r = g = bl = Math.round((s * 255) / ((1 << depth) - 1)); }
      } else if (type === 0) { r = g = bl = cur[x]!; if (trns && trns.length >= 2 && ((trns[0]! << 8) | trns[1]!) === r) al = 0; }
      else if (type === 4) { r = g = bl = cur[x * 2]!; al = cur[x * 2 + 1]!; }
      else if (type === 2) { r = cur[x * 3]!; g = cur[x * 3 + 1]!; bl = cur[x * 3 + 2]!; }
      else if (type === 6) { r = cur[x * 4]!; g = cur[x * 4 + 1]!; bl = cur[x * 4 + 2]!; al = cur[x * 4 + 3]!; }
      else { const s = cur[x]!; r = palette![s * 3]!; g = palette![s * 3 + 1]!; bl = palette![s * 3 + 2]!; al = trns && s < trns.length ? trns[s]! : 255; }
      out.px[y * w + x] = ((al << 24) | (bl << 16) | (g << 8) | r) >>> 0;
    }
    prev.set(cur);
  }
  return out;
}

/** An RGBA PNG of a bitmap, optionally scaled up by a whole factor (nearest). */
export function encodePng(b: Bitmap, scale = 1): Uint8Array {
  const w = b.w * scale, h = b.h * scale;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const o = y * (w * 4 + 1);
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x += 1) {
      const c = b.px[sy * b.w + Math.floor(x / scale)]!;
      raw[o + 1 + x * 4] = c & 255; raw[o + 2 + x * 4] = (c >>> 8) & 255; raw[o + 3 + x * 4] = (c >>> 16) & 255; raw[o + 4 + x * 4] = c >>> 24;
    }
  }
  const z = deflateStored(raw);
  const chunks: Array<[string, Uint8Array]> = [["IHDR", ihdr(w, h)], ["IDAT", z], ["IEND", new Uint8Array(0)]];
  const size = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(SIG, 0);
  let p = 8;
  for (const [kind, d] of chunks) {
    dv.setUint32(p, d.length);
    for (let i = 0; i < 4; i += 1) out[p + 4 + i] = kind.charCodeAt(i);
    out.set(d, p + 8);
    dv.setUint32(p + 8 + d.length, crc32(out, p + 4, p + 8 + d.length));
    p += 12 + d.length;
  }
  return out;
}
function ihdr(w: number, h: number): Uint8Array {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  d[8] = 8; d[9] = 6;
  return d;
}
