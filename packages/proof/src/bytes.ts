// Packed bytes: big-endian, fixed width, no padding -- Solidity's abi.encodePacked
// for the same types, and what the Rust twin's Packer writes. A provable sim's
// input and result are written with these so a contract, a zkVM guest and the
// TypeScript sim hash the same bytes.
//
//   const p = createPacker();
//   p.bytes4("RLRI").u8(1).u64(raceId).bytes32(seed).u128(stake);
//   p.finish();   // Uint8Array

export interface Packer {
  u8(v: number): Packer;
  u16(v: number): Packer;
  i16(v: number): Packer;
  u32(v: number): Packer;
  /** Up to 2^53 as a number, any u64 as a bigint. */
  u64(v: number | bigint): Packer;
  u128(v: bigint): Packer;
  u256(v: bigint): Packer;
  /** Exactly 32 bytes (a Uint8Array or 0x-hex). */
  bytes32(v: Uint8Array | string): Packer;
  /** A 4-byte ASCII magic ("RLRI"). */
  bytes4(magic: string): Packer;
  /** Raw bytes, no length prefix. */
  raw(v: Uint8Array): Packer;
  readonly length: number;
  finish(): Uint8Array;
}

export interface Reader {
  u8(): number;
  u16(): number;
  i16(): number;
  u32(): number;
  u64(): bigint;
  u128(): bigint;
  u256(): bigint;
  bytes32(): Uint8Array;
  /** Reads 4 bytes and throws unless they spell the magic. */
  magic(expect: string): void;
  raw(n: number): Uint8Array;
  readonly offset: number;
  readonly remaining: number;
  /** Throws unless every byte was read. */
  end(): void;
}

const check = (ok: boolean, what: string): void => { if (!ok) throw new RangeError(what); };

const uint = (bits: number, v: bigint, what: string): bigint => {
  check(v >= 0n && v < 1n << BigInt(bits), `${what} out of range for u${bits}`);
  return v;
};

export function createPacker(): Packer {
  let buf = new Uint8Array(256);
  let n = 0;
  const room = (k: number): void => {
    if (n + k <= buf.length) return;
    let size = buf.length * 2;
    while (size < n + k) size *= 2;
    const next = new Uint8Array(size);
    next.set(buf.subarray(0, n));
    buf = next;
  };
  const big = (bits: number, v: bigint): void => {
    const k = bits / 8;
    room(k);
    for (let i = k - 1; i >= 0; i -= 1) { buf[n + i] = Number(v & 0xffn); v >>= 8n; }
    n += k;
  };
  const small = (bytes: number, v: number, what: string): void => {
    check(Number.isInteger(v) && v >= 0 && v < 2 ** (bytes * 8), `${what} out of range`);
    room(bytes);
    for (let i = bytes - 1; i >= 0; i -= 1) { buf[n + i] = v & 0xff; v = Math.floor(v / 256); }
    n += bytes;
  };
  const p: Packer = {
    u8(v) { small(1, v, "u8"); return p; },
    u16(v) { small(2, v, "u16"); return p; },
    i16(v) { check(Number.isInteger(v) && v >= -32768 && v <= 32767, "i16 out of range"); small(2, v < 0 ? v + 65536 : v, "i16"); return p; },
    u32(v) { small(4, v, "u32"); return p; },
    u64(v) { big(64, uint(64, typeof v === "bigint" ? v : BigInt(v), "u64")); return p; },
    u128(v) { big(128, uint(128, v, "u128")); return p; },
    u256(v) { big(256, uint(256, v, "u256")); return p; },
    bytes32(v) {
      const b = typeof v === "string" ? fromHex(v) : v;
      check(b.length === 32, "bytes32 needs 32 bytes");
      return p.raw(b);
    },
    bytes4(magic) {
      check(magic.length === 4 && /^[\x20-\x7e]{4}$/.test(magic), "bytes4 magic is 4 ASCII characters");
      room(4);
      for (let i = 0; i < 4; i += 1) buf[n + i] = magic.charCodeAt(i);
      n += 4;
      return p;
    },
    raw(v) { room(v.length); buf.set(v, n); n += v.length; return p; },
    get length() { return n; },
    finish: () => buf.slice(0, n),
  };
  return p;
}

export function createReader(bytes: Uint8Array): Reader {
  let at = 0;
  const take = (k: number): Uint8Array => {
    check(at + k <= bytes.length, `read past the end (${at + k} > ${bytes.length})`);
    const out = bytes.subarray(at, at + k);
    at += k;
    return out;
  };
  const small = (k: number): number => { let v = 0; for (const b of take(k)) v = v * 256 + b; return v; };
  const big = (k: number): bigint => { let v = 0n; for (const b of take(k)) v = (v << 8n) | BigInt(b); return v; };
  return {
    u8: () => small(1),
    u16: () => small(2),
    i16: () => { const v = small(2); return v >= 32768 ? v - 65536 : v; },
    u32: () => small(4),
    u64: () => big(8),
    u128: () => big(16),
    u256: () => big(32),
    bytes32: () => take(32).slice(),
    magic(expect) {
      const got = String.fromCharCode(...take(4));
      check(got === expect, `bad magic: ${JSON.stringify(got)} (want ${expect})`);
    },
    raw: (k) => take(k).slice(),
    get offset() { return at; },
    get remaining() { return bytes.length - at; },
    end() { check(at === bytes.length, `${bytes.length - at} trailing bytes`); },
  };
}

export function toHex(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;
  check(s.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(s), "bad hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
