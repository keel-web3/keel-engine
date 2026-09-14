// A small, synchronous inflate (RFC 1950/1951): WOFF tables and PNG pixels
// are zlib streams, and the UI imports them without a platform decompressor
// (KEEL's sandbox and Node alike). After tinf's design: canonical Huffman
// tables built per block, a bit reader over the input. Not fast -- a font or
// an icon is a few kilobytes -- but small, exact, and dependency-free.

class Bits {
  pos = 0;
  bit = 0;
  bitCount = 0;
  readonly src: Uint8Array;
  constructor(src: Uint8Array) { this.src = src; }
  get(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.src.length) throw new RangeError("inflate: the data ends early.");
      this.bit |= this.src[this.pos++]! << this.bitCount;
      this.bitCount += 8;
    }
    const v = this.bit & ((1 << n) - 1);
    this.bit >>>= n;
    this.bitCount -= n;
    return v;
  }
  align(): void { this.bit = 0; this.bitCount = 0; }
}

interface Tree { counts: Uint16Array; symbols: Uint16Array }

function build(lengths: ArrayLike<number>, off: number, n: number): Tree {
  const counts = new Uint16Array(16);
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i += 1) counts[lengths[off + i]!]! += 1;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i += 1) offs[i] = offs[i - 1]! + counts[i - 1]!;
  for (let i = 0; i < n; i += 1) { const l = lengths[off + i]!; if (l) symbols[offs[l]!++] = i; }
  return { counts, symbols };
}

function decodeSym(b: Bits, t: Tree): number {
  let code = 0, first = 0, index = 0;
  for (let len = 1; len < 16; len += 1) {
    code |= b.get(1);
    const count = t.counts[len]!;
    if (code - first < count) return t.symbols[index + code - first]!;
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new RangeError("inflate: a bad Huffman code.");
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const FIXED: { lit: Tree; dist: Tree } = (() => {
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  const d = new Uint8Array(30).fill(5);
  return { lit: build(l, 0, 288), dist: build(d, 0, 30) };
})();

/** Raw DEFLATE (no zlib header). */
export function inflateRaw(src: Uint8Array, sizeHint = 0): Uint8Array {
  const b = new Bits(src);
  let out = new Uint8Array(Math.max(1024, sizeHint));
  let n = 0;
  const room = (k: number) => {
    if (n + k <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, n + k));
    next.set(out.subarray(0, n));
    out = next;
  };
  for (;;) {
    const last = b.get(1);
    const type = b.get(2);
    if (type === 0) {
      b.align();
      const p = b.pos;
      const len = src[p]! | (src[p + 1]! << 8);
      b.pos = p + 4;
      room(len);
      out.set(src.subarray(b.pos, b.pos + len), n);
      n += len;
      b.pos += len;
    } else if (type === 1 || type === 2) {
      let lit = FIXED.lit, dist = FIXED.dist;
      if (type === 2) {
        const hlit = b.get(5) + 257, hdist = b.get(5) + 1, hclen = b.get(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < hclen; i += 1) cl[CL_ORDER[i]!] = b.get(3);
        const clt = build(cl, 0, 19);
        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < hlit + hdist;) {
          const sym = decodeSym(b, clt);
          if (sym < 16) lens[i++] = sym;
          else if (sym === 16) { const prev = lens[i - 1]!; for (let r = b.get(2) + 3; r > 0; r -= 1) lens[i++] = prev; }
          else if (sym === 17) i += b.get(3) + 3;
          else i += b.get(7) + 11;
        }
        lit = build(lens, 0, hlit);
        dist = build(lens, hlit, hdist);
      }
      for (;;) {
        const sym = decodeSym(b, lit);
        if (sym < 256) { room(1); out[n++] = sym; continue; }
        if (sym === 256) break;
        const li = sym - 257;
        const len = LEN_BASE[li]! + b.get(LEN_EXTRA[li]!);
        const di = decodeSym(b, dist);
        const d = DIST_BASE[di]! + b.get(DIST_EXTRA[di]!);
        if (d > n) throw new RangeError("inflate: a copy from before the start.");
        room(len);
        for (let k = 0; k < len; k += 1, n += 1) out[n] = out[n - d]!;
      }
    } else throw new RangeError("inflate: a bad block type.");
    if (last) break;
  }
  return out.slice(0, n);
}

/** A zlib stream (RFC 1950): the two-byte header, the deflate data (the Adler-32 at the end isn't checked). */
export function inflate(src: Uint8Array, sizeHint = 0): Uint8Array {
  if (src.length < 2 || (src[0]! & 0x0f) !== 8 || ((src[0]! << 8) | src[1]!) % 31 !== 0) throw new RangeError("inflate: not a zlib stream.");
  return inflateRaw(src.subarray(2), sizeHint);
}

/** Store bytes as a zlib stream with no compression (what encodePng uses: exact, tiny code). */
export function deflateStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i += 1) {
    const chunk = data.subarray(i * 65535, Math.min(data.length, (i + 1) * 65535));
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = chunk.length & 255; out[o++] = chunk.length >> 8;
    out[o++] = ~chunk.length & 255; out[o++] = (~chunk.length >> 8) & 255;
    out.set(chunk, o);
    o += chunk.length;
  }
  let a = 1, b2 = 0;
  for (let i = 0; i < data.length; i += 1) { a = (a + data[i]!) % 65521; b2 = (b2 + a) % 65521; }
  const adler = ((b2 << 16) | a) >>> 0;
  out[o++] = adler >>> 24; out[o++] = (adler >>> 16) & 255; out[o++] = (adler >>> 8) & 255; out[o++] = adler & 255;
  return out;
}
