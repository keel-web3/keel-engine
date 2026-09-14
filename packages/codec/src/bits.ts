// The bit stream: a writer and a reader over bytes, most significant bit
// first (the first bit written is bit 7 of byte 0 -- so a hex dump reads left
// to right, and a Solidity reader shifts a word right by 256 - offset - width).
// No per-bit allocation: the writer grows its buffer by doubling, the reader
// walks the bytes it was given. Numbers up to 53 bits (a double's integers);
// anything wider is a bigint, written 32 bits at a time.

const F = new DataView(new ArrayBuffer(8));
const P32 = 2 ** 32;

/** Where a read ran out or went wrong: the bit it happened at. */
export class BitError extends RangeError {
  readonly bit: number;
  constructor(message: string, bit: number) {
    super(message);
    this.name = "BitError";
    this.bit = bit;
  }
}

/** Bits needed to hold every integer 0..n-1 (0 for n <= 1). */
export function bitsFor(n: number): number {
  if (n <= 1) return 0;
  if (n <= 0x100000000) return 32 - Math.clz32(n - 1);
  let b = 32;
  let v = Math.floor((n - 1) / 0x100000000);
  while (v >= 1) { v = Math.floor(v / 2); b += 1; }
  return b;
}
/** How many bits a positive integer takes (1 for 1, 3 for 5). */
const lengthOf = (x: number): number => (x < 0x100000000 ? 32 - Math.clz32(x) : 32 + lengthOf(Math.floor(x / 0x100000000)));

/** A float as the IEEE half it rounds to (bits), and back. */
export function toHalf(v: number): number {
  F.setFloat32(0, v);
  const x = F.getUint32(0);
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && (h & 1))) h += 1;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  // (A carry out of the mantissa rolls into the exponent: the right answer, up to infinity.)
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h += 1;
  return sign | h;
}
export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

export class BitWriter {
  private buf: Uint8Array;
  private pos = 0;
  private bit = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(Math.max(16, capacity));
  }

  /** Bits written so far. */
  get length(): number {
    return this.pos * 8 + this.bit;
  }

  private room(bytes: number): void {
    if (this.pos + bytes < this.buf.length) return;
    let n = this.buf.length * 2;
    while (n <= this.pos + bytes) n *= 2;
    const next = new Uint8Array(n);
    next.set(this.buf.subarray(0, this.pos + 1));
    this.buf = next;
  }

  /** Write the low `n` bits of `v` (0 <= n <= 32; v an unsigned integer below 2^n). */
  bits(v: number, n: number): void {
    if (n === 0) return;
    this.room(5);
    const buf = this.buf;
    let pos = this.pos;
    let bit = this.bit;
    while (n > 0) {
      const free = 8 - bit;
      if (n >= free) {
        n -= free;
        buf[pos] = buf[pos]! | ((v >>> n) & ((1 << free) - 1));
        pos += 1;
        bit = 0;
      } else {
        buf[pos] = buf[pos]! | ((v & ((1 << n) - 1)) << (free - n));
        bit += n;
        n = 0;
      }
    }
    this.pos = pos;
    this.bit = bit;
  }

  /** Up to 53 bits. */
  wide(v: number, n: number): void {
    if (n <= 32) { this.bits(v >>> 0, n); return; }
    const hi = Math.floor(v / P32);
    this.bits(hi, n - 32);
    this.bits(v >>> 0, 32);
  }

  bool(b: boolean): void {
    this.bits(b ? 1 : 0, 1);
  }

  /** A bigint's low `n` bits. */
  big(v: bigint, n: number): void {
    let left = n;
    while (left > 32) {
      left -= 32;
      this.bits(Number((v >> BigInt(left)) & 0xffffffffn), 32);
    }
    this.bits(Number(v & ((1n << BigInt(left)) - 1n)), left);
  }

  /** Exp-Golomb of order k (k = 0: Elias-gamma of v + 1): small numbers in few bits, any size up to 2^53. */
  golomb(v: number, k: number): void {
    const x = v + (k < 31 ? 1 << k : 2 ** k);
    const len = lengthOf(x);
    // (Zeros: the position just moves -- the buffer is zeroed ahead.)
    const zeros = len - 1 - k;
    if (zeros > 0) { this.room((zeros >>> 3) + 6); const at = this.pos * 8 + this.bit + zeros; this.pos = at >>> 3; this.bit = at & 7; }
    if (len <= 32) this.bits(x >>> 0, len); else this.wide(x, len);
  }

  /** LEB-style groups: `g` bits of the number then a "more" bit, least significant group first. */
  groups(v: number, g: number): void {
    const span = 2 ** g;
    do {
      const part = v % span;
      v = Math.floor(v / span);
      this.bits(part, g);
      this.bool(v > 0);
    } while (v > 0);
  }

  f16(v: number): void { this.bits(toHalf(v), 16); }
  f32(v: number): void { F.setFloat32(0, v); this.bits(F.getUint32(0), 32); }
  f64(v: number): void { F.setFloat64(0, v); this.bits(F.getUint32(0), 32); this.bits(F.getUint32(4), 32); }

  /** Raw bytes (a fast copy when the stream is on a byte boundary). */
  bytes(b: Uint8Array): void {
    if (this.bit === 0) {
      this.room(b.length + 1);
      this.buf.set(b, this.pos);
      this.pos += b.length;
      return;
    }
    for (let i = 0; i < b.length; i += 1) this.bits(b[i]!, 8);
  }

  /** Another writer's bits, appended. */
  append(other: BitWriter): void {
    const n = other.length;
    const src = other.buf;
    const full = n >>> 3;
    if (this.bit === 0) {
      this.room(full + 2);
      this.buf.set(src.subarray(0, full), this.pos);
      this.pos += full;
    } else for (let i = 0; i < full; i += 1) this.bits(src[i]!, 8);
    const rest = n & 7;
    if (rest) this.bits(src[full]! >>> (8 - rest), rest);
  }

  /** Pad with zero bits to the next byte. */
  align(): void {
    if (this.bit) { this.pos += 1; this.bit = 0; this.room(1); }
  }

  /** The bytes (a copy), zero-padded to a whole byte. */
  finish(): Uint8Array {
    return this.buf.slice(0, this.pos + (this.bit ? 1 : 0));
  }

  /** Empty it for reuse (keeps its buffer). */
  reset(): void {
    this.buf.fill(0, 0, this.pos + 1);
    this.pos = 0;
    this.bit = 0;
  }
}

export class BitReader {
  readonly buf: Uint8Array;
  private pos: number;
  private bit = 0;
  private end: number;

  constructor(buf: Uint8Array, startByte = 0, endByte = buf.length) {
    this.buf = buf;
    this.pos = startByte;
    this.end = endByte;
  }

  /** The bit the next read starts at. */
  get at(): number {
    return this.pos * 8 + this.bit;
  }
  /** Bits left. */
  get left(): number {
    return (this.end - this.pos) * 8 - this.bit;
  }
  /** The byte it stops at. */
  get endByte(): number {
    return this.end;
  }
  /** Stop earlier: at this byte (a body's bits end where its text begins). */
  limit(endByte: number): void {
    if (endByte < this.pos || endByte > this.end) throw new BitError(`Can't end the bits at byte ${endByte} (reading byte ${this.pos} of ${this.end}).`, this.at);
    this.end = endByte;
  }

  private short(n: number): never {
    throw new BitError(`The data ends early: wanted ${n} more bit${n === 1 ? "" : "s"} at bit ${this.at}, ${this.left} left.`, this.at);
  }

  /** Read `n` bits (0 <= n <= 53) as an unsigned number. */
  bits(n: number): number {
    if (n === 0) return 0;
    if (n > this.left) this.short(n);
    const buf = this.buf;
    let pos = this.pos;
    let bit = this.bit;
    let out = 0;
    while (n > 0) {
      const avail = 8 - bit;
      const b = buf[pos]!;
      if (n >= avail) {
        out = out * (1 << avail) + (b & ((1 << avail) - 1));
        n -= avail;
        pos += 1;
        bit = 0;
      } else {
        out = out * (1 << n) + ((b >>> (avail - n)) & ((1 << n) - 1));
        bit += n;
        n = 0;
      }
    }
    this.pos = pos;
    this.bit = bit;
    return out;
  }

  /** Up to 53 bits (the same as bits()). */
  wide(n: number): number {
    return this.bits(n);
  }

  bool(): boolean {
    if (this.left < 1) this.short(1);
    const v = (this.buf[this.pos]! >>> (7 - this.bit)) & 1;
    if (++this.bit === 8) { this.bit = 0; this.pos += 1; }
    return v === 1;
  }

  big(n: number): bigint {
    let v = 0n;
    let left = n;
    while (left > 32) { v = (v << 32n) | BigInt(this.bits(32)); left -= 32; }
    return (v << BigInt(left)) | BigInt(this.bits(left));
  }

  golomb(k: number): number {
    // (Count the leading zeros a byte at a time, then read the rest.)
    const start = this.at;
    let zeros = 0;
    for (;;) {
      if (this.pos >= this.end) this.short(1);
      const avail = 8 - this.bit;
      const b = this.buf[this.pos]! & ((1 << avail) - 1);
      if (b === 0) { zeros += avail; this.pos += 1; this.bit = 0; }
      else { const lead = Math.clz32(b) - 24 - this.bit; zeros += lead; this.bit += lead + 1; if (this.bit === 8) { this.bit = 0; this.pos += 1; } break; }
      if (zeros > 53 - k) throw new BitError(`A variable-length number at bit ${start} is longer than 53 bits.`, start);
    }
    if (zeros > 53 - k) throw new BitError(`A variable-length number at bit ${start} is longer than 53 bits.`, start);
    const len = zeros + k;
    const rest = this.bits(len);
    return (len < 31 ? 1 << len : 2 ** len) + rest - (k < 31 ? 1 << k : 2 ** k);
  }

  groups(g: number): number {
    let v = 0;
    let scale = 1;
    for (;;) {
      v += this.bits(g) * scale;
      scale *= 2 ** g;
      if (!this.bool()) return v;
      if (scale > 2 ** 53) throw new BitError(`A grouped number at bit ${this.at} is longer than 53 bits.`, this.at);
    }
  }

  f16(): number { return fromHalf(this.bits(16)); }
  f32(): number { F.setUint32(0, this.bits(32)); return F.getFloat32(0); }
  f64(): number { F.setUint32(0, this.bits(32)); F.setUint32(4, this.bits(32)); return F.getFloat64(0); }

  bytes(n: number): Uint8Array {
    if (n * 8 > this.left) this.short(n * 8);
    if (this.bit === 0) {
      const out = this.buf.slice(this.pos, this.pos + n);
      this.pos += n;
      return out;
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = this.bits(8);
    return out;
  }

  skip(n: number): void {
    if (n > this.left) this.short(n);
    const at = this.at + n;
    this.pos = at >>> 3;
    this.bit = at & 7;
  }

  /** Move to an absolute bit (within the buffer). */
  seek(bit: number): void {
    this.pos = Math.floor(bit / 8);
    this.bit = bit % 8;
  }

  /** Skip the zero padding to the next byte (throws if any padding bit is set: canonical data pads with zeros). */
  align(): void {
    if (this.bit === 0) return;
    const pad = 8 - this.bit;
    const at = this.at;
    if (this.bits(pad) !== 0) throw new BitError(`Padding bits at bit ${at} aren't zero (not canonical data).`, at);
  }
}
