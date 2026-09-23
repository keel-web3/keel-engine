// Keccak-256 (the Ethereum hash, original padding 0x01 -- not NIST SHA3-256's 0x06), in
// 32-bit halves so it needs no BigInt: fast enough to grind millions of candidate seeds
// the way a contract derives them (keccak256(abi.encodePacked(...))).

const RC = [
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000, 0x0000808b, 0x00000000,
  0x80000001, 0x00000000, 0x80008081, 0x80000000, 0x00008009, 0x80000000, 0x0000008a, 0x00000000, 0x00000088, 0x00000000,
  0x80008009, 0x00000000, 0x8000000a, 0x00000000, 0x8000808b, 0x00000000, 0x0000008b, 0x80000000, 0x00008089, 0x80000000,
  0x00008003, 0x80000000, 0x00008002, 0x80000000, 0x00000080, 0x80000000, 0x0000800a, 0x00000000, 0x8000000a, 0x80000000,
  0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x80000001, 0x00000000, 0x80008008, 0x80000000,
];
// Rotation offsets and the pi permutation, lane index order x + 5y.
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const PI = [0, 10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2, 12, 22, 23, 8, 18, 3, 13, 14, 24, 9, 19, 4];

function permute(s: Uint32Array): void {
  // s holds 25 lanes as (lo, hi) pairs.
  const c = new Uint32Array(10), b = new Uint32Array(50);
  for (let round = 0; round < 24; round += 1) {
    for (let x = 0; x < 5; x += 1) {
      c[2 * x] = s[2 * x]! ^ s[2 * x + 10]! ^ s[2 * x + 20]! ^ s[2 * x + 30]! ^ s[2 * x + 40]!;
      c[2 * x + 1] = s[2 * x + 1]! ^ s[2 * x + 11]! ^ s[2 * x + 21]! ^ s[2 * x + 31]! ^ s[2 * x + 41]!;
    }
    for (let x = 0; x < 5; x += 1) {
      const n = ((x + 1) % 5) * 2, p = ((x + 4) % 5) * 2;
      const lo = c[p]! ^ ((c[n]! << 1) | (c[n + 1]! >>> 31));
      const hi = c[p + 1]! ^ ((c[n + 1]! << 1) | (c[n]! >>> 31));
      for (let y = 0; y < 25; y += 5) { s[2 * (x + y)] = s[2 * (x + y)]! ^ lo; s[2 * (x + y) + 1] = s[2 * (x + y) + 1]! ^ hi; }
    }
    for (let i = 0; i < 25; i += 1) {
      const r = ROT[i]!, lo = s[2 * i]!, hi = s[2 * i + 1]!;
      let rlo: number, rhi: number;
      if (r === 0) { rlo = lo; rhi = hi; }
      else if (r < 32) { rlo = (lo << r) | (hi >>> (32 - r)); rhi = (hi << r) | (lo >>> (32 - r)); }
      else if (r === 32) { rlo = hi; rhi = lo; }
      else { const q = r - 32; rlo = (hi << q) | (lo >>> (32 - q)); rhi = (lo << q) | (hi >>> (32 - q)); }
      const j = PI[i]!;
      b[2 * j] = rlo; b[2 * j + 1] = rhi;
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x += 1) {
        const i = 2 * (x + y), i1 = 2 * (((x + 1) % 5) + y), i2 = 2 * (((x + 2) % 5) + y);
        s[i] = b[i]! ^ (~b[i1]! & b[i2]!);
        s[i + 1] = b[i + 1]! ^ (~b[i1 + 1]! & b[i2 + 1]!);
      }
    }
    s[0] = s[0]! ^ RC[2 * round]!;
    s[1] = s[1]! ^ RC[2 * round + 1]!;
  }
}

/** keccak256(data): 32 bytes. */
export function keccak256(data: Uint8Array): Uint8Array {
  const RATE = 136;
  const s = new Uint32Array(50);
  const blocks = Math.floor(data.length / RATE) + 1;
  const padded = new Uint8Array(blocks * RATE);
  padded.set(data);
  padded[data.length] = padded[data.length]! ^ 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! ^ 0x80;
  for (let blk = 0; blk < blocks; blk += 1) {
    const o = blk * RATE;
    for (let i = 0; i < RATE / 4; i += 1) {
      s[i] = s[i]! ^ (padded[o + 4 * i]! | (padded[o + 4 * i + 1]! << 8) | (padded[o + 4 * i + 2]! << 16) | (padded[o + 4 * i + 3]! << 24));
    }
    permute(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    const w = s[i]!;
    out[4 * i] = w & 0xff; out[4 * i + 1] = (w >>> 8) & 0xff; out[4 * i + 2] = (w >>> 16) & 0xff; out[4 * i + 3] = w >>> 24;
  }
  return out;
}
