// Seed arithmetic, in the shape a contract will read it -- ported from the
// proof of concept's src/core/rng.js (itself NOCTURNES' rng.js + genome.js's
// `stream` and `deriveSeed`). test/*-equality.test.ts proves every export
// identical to both.
//
// A token seed is bytes32 == sixteen big-endian 16-bit words. A trait reads a
// FIXED SLOT, never "the next word", so adding a trait later cannot reshuffle
// tokens that already exist. Slots past 15 are expanded with FNV-1a over the
// seed bytes and the slot index -- 32-bit integer math with an obvious
// Solidity twin, and no hash library in the browser bundle.

/** A seed: "0x" + 64 lower-case hex digits (bytes32). */
export type Seed = string;

/** [[value, weight], ...] -- the only shape the catalogue uses. */
export type Weighted<T> = ReadonlyArray<readonly [T, number]>;

/** An integer stream hanging off one slot: each draw is 16 bits. */
export interface SubStream {
  next(): number;
  index(length: number): number;
  pick<T>(list: readonly T[]): T;
  range(low: number, high: number): number;
  chance(numerator: number, denominator?: number): boolean;
  weighted<T>(entries: Weighted<T>): T;
}

/** A reader over one seed: fixed slots, and private sub-streams. */
export interface Roll {
  readonly seed: Seed;
  /** A 16-bit draw, stable forever: slots 0..15 are the seed's words, higher ones are hashed. */
  at(slot: number): number;
  pick<T>(slot: number, list: readonly T[]): T;
  index(slot: number, length: number): number;
  /** Inclusive at both ends. */
  range(slot: number, low: number, high: number): number;
  chance(slot: number, numerator: number, denominator?: number): boolean;
  weighted<T>(slot: number, entries: Weighted<T>): T;
  sub(slot: number): SubStream;
}

/** The float stream every generator draws from. `f()` is a 16-bit draw over 65536. */
export interface Stream {
  f(): number;
  between(a: number, b: number): number;
  /** Inclusive at both ends. */
  int(a: number, b: number): number;
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
  weighted<T>(entries: Weighted<T>): T;
}

const HEX_SEED = /^0x[0-9a-f]{64}$/u;

export function normalizeSeed(value: unknown): Seed {
  const clean = String(value ?? "").toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]+$/u.test(clean) || clean.length > 64) {
    throw new TypeError("Seed must be one to sixty-four hexadecimal digits.");
  }
  const seed = `0x${clean.padStart(64, "0")}`;
  if (!HEX_SEED.test(seed)) throw new TypeError("Seed must resolve to bytes32.");
  return seed;
}

/** Local gallery seeds. A live token is handed the contract's seed instead. */
export function seedFromToken(tokenId: number | bigint | string, collection = "nocturnes-v0"): Seed {
  const index = BigInt(tokenId);
  if (index < 0n) throw new RangeError("Token ID must not be negative.");
  let state = 0x811c9dc5;
  const feed = (text: string): number => {
    for (let at = 0; at < text.length; at += 1) {
      state = Math.imul(state ^ text.charCodeAt(at), 0x01000193) >>> 0;
      state = (state ^ (state >>> 13)) >>> 0;
    }
    return state >>> 0;
  };
  feed(`${collection}:${index}`);
  let hex = "";
  for (let word = 0; word < 8; word += 1) hex += feed(`:${word}`).toString(16).padStart(8, "0");
  return `0x${hex}`;
}

function seedBytes(seed: unknown): Uint8Array {
  const clean = normalizeSeed(seed).slice(2);
  const bytes = new Uint8Array(32);
  for (let at = 0; at < 32; at += 1) bytes[at] = Number.parseInt(clean.slice(at * 2, at * 2 + 2), 16);
  return bytes;
}

function expand(bytes: Uint8Array, slot: number): number {
  let state = 0x811c9dc5;
  for (const byte of bytes) state = Math.imul(state ^ byte, 0x01000193) >>> 0;
  for (let shift = 0; shift < 32; shift += 8) {
    state = Math.imul(state ^ ((slot >>> shift) & 0xff), 0x01000193) >>> 0;
  }
  state = (state ^ (state >>> 15)) >>> 0;
  return state & 0xffff;
}

// (Shared by every weighted draw: the ticket walks the weights in order.)
function draw<T>(entries: Weighted<T>, ticket: number): T {
  for (const [value, weight] of entries) {
    if (ticket < weight) return value;
    ticket -= weight;
  }
  return (entries[entries.length - 1] as readonly [T, number])[0];
}
const totalOf = <T>(entries: Weighted<T>): number => {
  let total = 0;
  for (const [, weight] of entries) total += weight;
  return total;
};

/**
 * A reader over one seed. `at(slot)` is stable forever; `sub(slot)` gives a
 * private sequence hanging off one slot, for generators (a logo, a lexicon
 * walk) that need many numbers without eating the slot budget.
 */
export function createRoll(seed: unknown): Roll {
  const bytes = seedBytes(seed);
  const words = new Uint16Array(16);
  for (let at = 0; at < 16; at += 1) words[at] = ((bytes[at * 2] as number) << 8) | (bytes[at * 2 + 1] as number);

  const at = (slot: number): number => (slot < 16 ? (words[slot] as number) : expand(bytes, slot));

  const api: Roll = {
    seed: normalizeSeed(seed),
    at,
    /** Uniform-enough over a 16-bit draw: every table here is far under 256 wide. */
    pick: <T>(slot: number, list: readonly T[]): T => list[at(slot) % list.length] as T,
    index: (slot, length) => at(slot) % length,
    range: (slot, low, high) => low + (at(slot) % (high - low + 1)),
    chance: (slot, numerator, denominator = 100) => at(slot) % denominator < numerator,
    weighted: <T>(slot: number, entries: Weighted<T>): T => draw(entries, at(slot) % totalOf(entries)),
    /** A private stream off one slot: sub(slot).next() walks its own words. */
    sub(slot) {
      let cursor = 0;
      const base = 0x10000 + slot * 4096;
      const next = (): number => expand(bytes, base + cursor++);
      return {
        next,
        index: (length) => next() % length,
        pick: <T>(list: readonly T[]): T => list[next() % list.length] as T,
        range: (low, high) => low + (next() % (high - low + 1)),
        chance: (numerator, denominator = 100) => next() % denominator < numerator,
        weighted: <T>(entries: Weighted<T>): T => draw(entries, next() % totalOf(entries)),
      };
    },
  };
  return api;
}

/**
 * A float/int stream over one seed slot (NOCTURNES genome.js `stream`): the
 * shape every generator draws from. `f()` is a 16-bit draw over 65536, so the
 * stream is exact on every machine.
 */
export function stream(roll: Roll, slot: number): Stream {
  const sub = roll.sub(slot);
  const f = (): number => sub.next() / 65536;
  return {
    f,
    between: (a, b) => a + (b - a) * f(),
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(f() * list.length)] as T,
    chance: (p) => f() < p,
    // (The total is summed before the draw, as the original does: the draw order is part of the stream.)
    weighted: <T>(entries: Weighted<T>): T => { const total = totalOf(entries); return draw(entries, f() * total); },
  };
}

/** A child seed named by a label (NOCTURNES genome.js `deriveSeed`): one seed, many independent assets. */
export function deriveSeed(seed: string, label: string | number): Seed {
  let h = 0x811c9dc5;
  const text = `${seed}:${label}`;
  let hex = "";
  for (let w = 0; w < 8; w += 1) {
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ w, 0x01000193) >>> 0;
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `0x${hex}`;
}
