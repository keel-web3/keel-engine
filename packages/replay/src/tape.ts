// An input tape: what a player did, one 32-bit word per simulation tick -- a
// bit per button (a one-button game uses bit 0). A tape is the whole of the
// player's part in a run: the seed and the rules make everything else.
//
// On the wire it is run-length coded -- (word, ticks) pairs as LEB128
// varints, then base64url -- so a minute of a button held and let go at
// 120 Hz is a few hundred bytes, not 7,200 words.
//
//   const tape = createTape();
//   tape.push(held ? 1 : 0);          // every tick
//   const text = encodeTape(tape);    // "AQ..."
//   decodeTape(text).at(812);         // the word at tick 812

export type Run = [word: number, ticks: number];

export interface Tape {
  readonly ticks: number;
  readonly runs: readonly Run[];
  push(word: number): Tape;
  /** The word at a tick (0 past either end). Walks forward cheaply; a step back starts from the top. */
  at(tick: number): number;
  /** The first n ticks, as a new tape. */
  slice(n: number): Tape;
  /** Every word, one per tick (tests, small tapes). */
  words(): number[];
}

export function createTape(from: readonly Run[] = []): Tape {
  const R: Run[] = from.map(([w, n]) => [w >>> 0, n]);
  let ticks = R.reduce((s, [, n]) => s + n, 0);
  let cursor = 0; // (the run the last lookup landed in, and the tick it starts at)
  let cursorStart = 0;
  const tape: Tape = {
    get ticks() { return ticks; },
    get runs() { return R; },
    push(word) {
      const w = word >>> 0;
      const last = R[R.length - 1];
      if (last && last[0] === w) last[1] += 1;
      else R.push([w, 1]);
      ticks += 1;
      return tape;
    },
    at(tick) {
      if (tick < 0 || tick >= ticks) return 0;
      if (tick < cursorStart) { cursor = 0; cursorStart = 0; }
      while (cursor < R.length && tick >= cursorStart + R[cursor]![1]) { cursorStart += R[cursor]![1]; cursor += 1; }
      return R[cursor]![0];
    },
    slice(n) {
      const out: Run[] = [];
      let left = n;
      for (const [w, c] of R) { if (left <= 0) break; out.push([w, Math.min(c, left)]); left -= c; }
      return createTape(out);
    },
    words() { const out: number[] = []; for (const [w, n] of R) for (let i = 0; i < n; i += 1) out.push(w); return out; },
  };
  return tape;
}

function pushVarint(out: number[], n: number): void {
  let v = n;
  while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); }
  out.push(v);
}
function readVarint(bytes: Uint8Array, at: number): [number, number] {
  let v = 0;
  let mul = 1;
  let i = at;
  for (;;) {
    if (i >= bytes.length) throw new Error("tape: a varint runs past the end");
    const b = bytes[i++]!;
    v += (b & 0x7f) * mul;
    if (b < 0x80) return [v, i];
    mul *= 0x80;
    if (mul > 2 ** 49) throw new Error("tape: a varint is too long");
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function toBase64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >>> 18) & 63]! + B64[(n >>> 12) & 63]!;
    if (i + 1 < bytes.length) s += B64[(n >>> 6) & 63]!;
    if (i + 2 < bytes.length) s += B64[n & 63]!;
  }
  return s;
}
export function fromBase64url(text: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error(`tape: ${JSON.stringify(ch)} is not base64url`);
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >>> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

/** A tape's bytes: its runs as (word, ticks) varint pairs. */
export function tapeBytes(tape: Tape): Uint8Array {
  const out: number[] = [];
  for (const [w, n] of tape.runs) { pushVarint(out, w); pushVarint(out, n); }
  return new Uint8Array(out);
}
export const encodeTape = (tape: Tape): string => toBase64url(tapeBytes(tape));
export function decodeTape(text: string | Uint8Array): Tape {
  const bytes = typeof text === "string" ? fromBase64url(text) : text;
  const runs: Run[] = [];
  let i = 0;
  while (i < bytes.length) {
    const [w, a] = readVarint(bytes, i);
    const [n, b] = readVarint(bytes, a);
    if (n < 1) throw new Error("tape: an empty run");
    if (w > 0xffffffff) throw new Error("tape: a word past 32 bits");
    runs.push([w, n]);
    i = b;
  }
  return createTape(runs);
}
