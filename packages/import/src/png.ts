// PNG in and out, with no dependencies: an inflater (RFC 1951, behind the
// zlib wrapper), the scanline filters, every colour type at 8 bits (16-bit
// channels keep their high byte; 1/2/4-bit grey and palette unpack), tRNS
// transparency. Enough for the textures glTF files embed. Interlaced PNGs and
// JPEGs go through a host decoder (the importer's `decodeImage` option).
// encodePng writes stored (uncompressed) deflate blocks: small test textures.

import type { ImportImage } from "./scene.ts";

// ---------------------------------------------------------------- inflate

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman { counts: Uint16Array; symbols: Uint16Array }
function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i += 1) counts[lengths[i]!]! += 1;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i += 1) offs[i] = offs[i - 1]! + counts[i - 1]!;
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i += 1) if (lengths[i]) symbols[offs[lengths[i]!]!++] = i;
  return { counts, symbols };
}

/** Raw deflate -> bytes. Throws on a corrupt stream. */
export function inflateRaw(src: Uint8Array): Uint8Array {
  let pos = 0, bit = 0, bitCount = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let n = 0;
  const need = (k: number): void => {
    if (n + k <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, n + k));
    next.set(out.subarray(0, n));
    out = next;
  };
  const bits = (k: number): number => {
    while (bitCount < k) {
      if (pos >= src.length) throw new RangeError("deflate: the stream ends early");
      bit |= src[pos++]! << bitCount;
      bitCount += 8;
    }
    const v = bit & ((1 << k) - 1);
    bit >>>= k;
    bitCount -= k;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len += 1) {
      code |= bits(1);
      const count = h.counts[len]!;
      if (code - count < first) return h.symbols[index + (code - first)]!;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new RangeError("deflate: a bad Huffman code");
  };
  let fixedLit: Huffman | null = null, fixedDist: Huffman | null = null;
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bit = 0; bitCount = 0;
      if (pos + 4 > src.length) throw new RangeError("deflate: a stored block ends early");
      const len = src[pos]! | (src[pos + 1]! << 8);
      const nlen = src[pos + 2]! | (src[pos + 3]! << 8);
      if ((len ^ 0xffff) !== nlen) throw new RangeError("deflate: a stored block's length check fails");
      pos += 4;
      if (pos + len > src.length) throw new RangeError("deflate: a stored block ends early");
      need(len);
      out.set(src.subarray(pos, pos + len), n);
      n += len; pos += len;
      continue;
    }
    let lit: Huffman, dist: Huffman;
    if (type === 1) {
      if (!fixedLit) {
        const l = new Uint8Array(288);
        l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
        fixedLit = huffman(l);
        fixedDist = huffman(new Uint8Array(30).fill(5));
      }
      lit = fixedLit; dist = fixedDist!;
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i += 1) cl[CL_ORDER[i]!] = bits(3);
      const clh = huffman(cl);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(clh);
        if (sym < 16) { lens[i++] = sym; continue; }
        let rep = 0, val = 0;
        if (sym === 16) { if (!i) throw new RangeError("deflate: a repeat with nothing before it"); val = lens[i - 1]!; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > lens.length) throw new RangeError("deflate: code lengths overrun");
        lens.fill(val, i, i + rep);
        i += rep;
      }
      lit = huffman(lens.subarray(0, hlit));
      dist = huffman(lens.subarray(hlit));
    } else throw new RangeError("deflate: block type 3 is reserved");
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) { need(1); out[n++] = sym; continue; }
      if (sym === 256) break;
      const li = sym - 257;
      if (li >= 29) throw new RangeError("deflate: a bad length code");
      const len = LEN_BASE[li]! + bits(LEN_EXTRA[li]!);
      const di = decode(dist);
      if (di >= 30) throw new RangeError("deflate: a bad distance code");
      const d = DIST_BASE[di]! + bits(DIST_EXTRA[di]!);
      if (d > n) throw new RangeError("deflate: a distance before the start");
      need(len);
      for (let k = 0; k < len; k += 1) { out[n] = out[n - d]!; n += 1; }
    }
  }
  return out.subarray(0, n);
}

/** A zlib stream (2-byte header, deflate, Adler-32) -> bytes. */
export function inflateZlib(src: Uint8Array): Uint8Array {
  if (src.length < 6) throw new RangeError("zlib: too short");
  const cmf = src[0]!, flg = src[1]!;
  if ((cmf & 15) !== 8 || ((cmf << 8) | flg) % 31 !== 0) throw new RangeError("zlib: not a deflate stream");
  if (flg & 32) throw new RangeError("zlib: preset dictionaries aren't supported");
  const out = inflateRaw(src.subarray(2, src.length - 4));
  const want = ((src[src.length - 4]! << 24) | (src[src.length - 3]! << 16) | (src[src.length - 2]! << 8) | src[src.length - 1]!) >>> 0;
  if (adler32(out) !== want) throw new RangeError("zlib: the Adler-32 check fails");
  return out;
}

export function adler32(b: Uint8Array): number {
  let a = 1, s = 0;
  for (let i = 0; i < b.length; i += 1) { a = (a + b[i]!) % 65521; s = (s + a) % 65521; }
  return ((s << 16) | a) >>> 0;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array, start = 0, end = b.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC[(c ^ b[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- PNG

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
export const isPng = (b: Uint8Array): boolean => b.length > 8 && SIG.every((v, i) => b[i] === v);

/** PNG bytes -> RGBA. */
export function decodePng(b: Uint8Array): ImportImage {
  if (!isPng(b)) throw new RangeError("png: no PNG signature");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pos = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= b.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(b[pos + 4]!, b[pos + 5]!, b[pos + 6]!, b[pos + 7]!);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (pos + 12 + len > b.length) throw new RangeError(`png: chunk ${type} runs past the end`);
    if (type === "IHDR") { w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12); depth = b[pos + 16]!; ctype = b[pos + 17]!; interlace = b[pos + 20]!; }
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!w || !h) throw new RangeError("png: no IHDR");
  if (interlace) throw new RangeError("png: interlaced images need the host's decoder (decodeImage)");
  const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : ctype === 6 ? 4 : 0;
  if (!channels) throw new RangeError(`png: colour type ${ctype}`);
  if (![1, 2, 4, 8, 16].includes(depth)) throw new RangeError(`png: bit depth ${depth}`);
  const total = idat.reduce((s, d) => s + d.length, 0);
  const z = new Uint8Array(total);
  let o = 0;
  for (const d of idat) { z.set(d, o); o += d.length; }
  const raw = inflateZlib(z);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((w * channels * depth) / 8);
  if (raw.length < h * (stride + 1)) throw new RangeError("png: image data is short");
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp]! : 0, up = prev ? prev[x]! : 0, c = prev && x >= bpp ? prev[x - bpp]! : 0;
      let v = line[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      else if (f !== 0) throw new RangeError(`png: filter ${f}`);
      cur[x] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const sample = (row: Uint8Array, i: number): number => {
    if (depth === 8) return row[i]!;
    if (depth === 16) return row[i * 2]!;
    const per = 8 / depth, byte = row[Math.floor(i / per)]!, shift = 8 - depth * ((i % per) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  for (let y = 0; y < h; y += 1) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < w; x += 1) {
      const q = (y * w + x) * 4;
      if (ctype === 3) {
        const i = sample(row, x);
        if (!palette || i * 3 + 2 >= palette.length) throw new RangeError("png: a palette index past the palette");
        out[q] = palette[i * 3]!; out[q + 1] = palette[i * 3 + 1]!; out[q + 2] = palette[i * 3 + 2]!; out[q + 3] = trns && i < trns.length ? trns[i]! : 255;
      } else if (ctype === 0 || ctype === 4) {
        const g = Math.round(sample(row, x * channels) * scale);
        out[q] = out[q + 1] = out[q + 2] = g;
        out[q + 3] = ctype === 4 ? sample(row, x * channels + 1) : 255;
      } else {
        out[q] = sample(row, x * channels); out[q + 1] = sample(row, x * channels + 1); out[q + 2] = sample(row, x * channels + 2);
        out[q + 3] = ctype === 6 ? sample(row, x * channels + 3) : 255;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** RGBA -> PNG bytes (colour type 6, stored deflate blocks: no compression, exact). */
export function encodePng(img: { width: number; height: number; data: Uint8Array }): Uint8Array {
  const { width: w, height: h } = img;
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y += 1) raw.set(img.data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i += 1) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    z[o++] = i === blocks - 1 ? 1 : 0;
    z[o++] = part.length & 255; z[o++] = part.length >> 8; z[o++] = ~part.length & 255; z[o++] = (~part.length >> 8) & 255;
    z.set(part, o); o += part.length;
  }
  const ad = adler32(raw);
  z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 255; z[o++] = (ad >>> 8) & 255; z[o++] = ad & 255;
  const chunks: Uint8Array[] = [];
  const chunk = (type: string, data: Uint8Array): void => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    chunks.push(c);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  chunk("IHDR", ihdr);
  chunk("IDAT", z.subarray(0, o));
  chunk("IEND", new Uint8Array(0));
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  out.set(SIG, 0);
  let p = 8;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
