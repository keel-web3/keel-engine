// State checksums: a running 32-bit hash a simulation feeds its state into
// at the end of a tick, so two runs can be compared tick by tick without
// shipping the state (keel-rts's Hasher: FNV-1a over 32-bit words, finished
// with murmur3's mixer). Doubles go in as their exact IEEE bits, so a
// checksum matches only when every number matches to the last bit.
//
//   const h = createHasher();
//   h.f64(body.x).f64(body.y).int(score).bool(alive);
//   h.value;   // uint32

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** murmur3's finaliser: every input bit reaches every output bit. */
export function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Hasher {
  /** A 32-bit word. */
  u32(w: number): Hasher;
  /** An integer in the safe range (two words). */
  int(n: number): Hasher;
  /** A double, bit for bit (-0 and 0 differ; every NaN is one NaN). */
  f64(x: number): Hasher;
  bool(b: boolean): Hasher;
  str(t: string): Hasher;
  /** A list of doubles, with its length. */
  f64s(list: readonly number[]): Hasher;
  readonly value: number;
}

export function createHasher(seed = 0x811c9dc5): Hasher {
  let h = seed >>> 0;
  const word = (w: number): void => {
    for (let s = 0; s < 32; s += 8) h = Math.imul(h ^ ((w >>> s) & 0xff), 0x01000193) >>> 0;
  };
  const api: Hasher = {
    u32(w) { word(w >>> 0); return api; },
    int(n) { word(n >>> 0); word(Math.floor(n / 4294967296) >>> 0); return api; },
    f64(x) {
      F64[0] = Number.isNaN(x) ? Number.NaN : x;
      if (LITTLE) { word(U32[0]!); word(U32[1]!); } else { word(U32[1]!); word(U32[0]!); }
      return api;
    },
    bool(b) { word(b ? 1 : 0); return api; },
    str(t) { word(t.length); for (let i = 0; i < t.length; i += 1) word(t.charCodeAt(i)); return api; },
    f64s(list) { word(list.length); for (const x of list) api.f64(x); return api; },
    get value() { return mix32(h); },
  };
  return api;
}
