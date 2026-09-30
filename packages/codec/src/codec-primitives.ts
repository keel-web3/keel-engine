// Shared canonical codec primitives: error paths, string tables, numeric
// encoding, equality, and UTF-8 helpers used by the schema compiler.

import { BitError, BitReader, BitWriter, bitsFor, fromHalf, toHalf } from "./bits.ts";
import { SchemaError, categoryOf } from "./schema.ts";
import type { Category, Field, FixedNode, Infer, Json, Node, Type } from "./schema.ts";

// ---------------------------------------------------------------- errors

/** An encode or decode error: the path to the field, and why. */
export class CodecError extends Error {
  /** Field names and indices from the root ("parts", 3, "shape(box)", "h", 1). */
  readonly path: (string | number)[];
  /** The reason, without the path. */
  readonly why: string;
  /** Decoding: the bit it happened at. */
  bit: number | null;
  constructor(why: string, path: (string | number)[] = [], bit: number | null = null) {
    super(why);
    this.name = "CodecError";
    this.why = why;
    this.path = path;
    this.bit = bit;
    this.message = CodecError.format(why, path, bit);
  }
  static format(why: string, path: readonly (string | number)[], bit: number | null): string {
    const p = pathText(path);
    return `${p ? `${p}: ` : ""}${why}${bit !== null ? ` (at bit ${bit})` : ""}`;
  }
}
/** "parts[3].shape(box).h[1]" */
export function pathText(path: readonly (string | number)[]): string {
  let out = "";
  for (const k of path) out += typeof k === "number" ? `[${k}]` : out ? `.${k}` : k;
  return out;
}
export const fail = (why: string): never => { throw new CodecError(why); };
/** An error from inside a field, with the field's label put in front of its path. */
export function under(e: unknown, label: string | number, bit: number | null = null): CodecError {
  if (e instanceof CodecError) {
    e.path.unshift(label);
    if (e.bit === null && bit !== null) e.bit = bit;
    e.message = CodecError.format(e.why, e.path, e.bit);
    return e;
  }
  if (e instanceof BitError) return new CodecError(e.message.replace(/ at bit \d+/, ""), [label], e.bit);
  if (e instanceof Error) return new CodecError(e.message, [label]);
  return new CodecError(String(e), [label]);
}

// ---------------------------------------------------------------- tables

/** The shared string tables ref() fields write through: one per name, in first-use order. */
export class Tables {
  private readonly m = new Map<string, { list: string[]; index: Map<string, number> }>();
  constructor(init: Readonly<Record<string, readonly string[]>> = {}) {
    for (const [name, list] of Object.entries(init)) for (const s of list) this.add(name, s);
  }
  table(name: string): { list: string[]; index: Map<string, number> } {
    let t = this.m.get(name);
    if (!t) { t = { list: [], index: new Map() }; this.m.set(name, t); }
    return t;
  }
  add(name: string, s: string): number {
    const t = this.table(name);
    const have = t.index.get(s);
    if (have !== undefined) return have;
    t.list.push(s);
    t.index.set(s, t.list.length - 1);
    return t.list.length - 1;
  }
  private readonly n = new Map<string, { list: number[]; index: Map<number, number> }>();
  /** A table of numbers (dyn()'s fractional numbers: a repeated one is its index). */
  numbers(name: string): { list: number[]; index: Map<number, number> } {
    let t = this.n.get(name);
    if (!t) { t = { list: [], index: new Map() }; this.n.set(name, t); }
    return t;
  }
  private readonly sh = new Map<string, { list: string[][]; index: Map<string, number> }>();
  /** A table of object shapes (dyn()'s key lists: an object shaped like one before is its index, then its values). */
  shapes(name: string): { list: string[][]; index: Map<string, number> } {
    let t = this.sh.get(name);
    if (!t) { t = { list: [], index: new Map() }; this.sh.set(name, t); }
    return t;
  }
  /** Every table's strings, by name (what a pack stores once when its documents share tables). */
  toJSON(): Record<string, string[]> {
    return Object.fromEntries([...this.m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, [...v.list]]));
  }
}
/** Tables to share across documents (encode them all with one, decode them in the same order with another made from the same start). */
export const createTables = (init: Readonly<Record<string, readonly string[]>> = {}): Tables => new Tables(init);

// ---------------------------------------------------------------- tracing (explainBits)

/** What a traced decode reports: explain.ts builds its tree from these calls. */
export interface Tracer {
  open(label: string | number, node: Node, bit: number): void;
  close(value: unknown, bit: number): void;
  /** A piece of a container that isn't a field: a length, a presence bit, a tag, a table index. */
  meta(label: string, bit: number, bits: number, value: unknown, note: string): void;
}

export interface Ctx {
  tables: Tables;
  trace: Tracer | null;
  strict: boolean;
  /** Encoding: where strings' bytes go (the body's text section). */
  text: BitWriter | null;
  /** Decoding: where strings' bytes come from. */
  tr: BitReader | null;
  /** Each delta field's last value in this document (by its place in the schema). */
  last: Map<object, number> | null;
}
export const fresh = (): Ctx => ({ tables: new Tables(), trace: null, strict: true, text: new BitWriter(64), tr: null, last: null });
export const lastOf = (x: Ctx): Map<object, number> => (x.last ??= new Map());

export interface C {
  readonly node: Node;
  w(o: BitWriter, v: unknown, x: Ctx): void;
  r(i: BitReader, x: Ctx): unknown;
}

export function wr(c: C, o: BitWriter, v: unknown, x: Ctx, label: string | number): void {
  try { c.w(o, v, x); } catch (e) { throw under(e, label, null); }
}
export function rd(c: C, i: BitReader, x: Ctx, label: string | number): unknown {
  const start = i.at;
  try {
    if (x.trace === null) return c.r(i, x);
    x.trace.open(label, c.node, start);
    const v = c.r(i, x);
    x.trace.close(v, i.at);
    return v;
  } catch (e) { throw under(e, label, start); }
}
export const meta = (x: Ctx, label: string, start: number, i: BitReader, value: unknown, note = ""): void => { x.trace?.meta(label, start, i.at - start, value, note); };

// ---------------------------------------------------------------- equality

/** Deep equality as the codec sees it: numbers by Object.is (-0 is not 0), arrays, bytes, bigints, plain objects (any key order). */
export function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array) || a.length !== b.length) return false;
    for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) return false;
    return true;
  }
  const aa = Array.isArray(a) || ArrayBuffer.isView(a);
  if (aa !== (Array.isArray(b) || ArrayBuffer.isView(b))) return false;
  if (aa) {
    const x = a as ArrayLike<unknown>, y = b as ArrayLike<unknown>;
    if (x.length !== y.length) return false;
    for (let k = 0; k < x.length; k += 1) if (!same(x[k], y[k])) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

// ---------------------------------------------------------------- numbers

/** Set a key, even "__proto__" (as an own property, never the prototype). */
export function put(o: Record<string, unknown>, k: string, v: unknown): void {
  if (k === "__proto__") Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
}
export const zig = (v: number): number => (v >= 0 ? v * 2 : -v * 2 - 1);
export const unzig = (u: number): number => (u % 2 ? -(u + 1) / 2 : u / 2);
export const describe = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}...` : v) : typeof v === "bigint" ? `${v}n` : Array.isArray(v) ? `an array of ${v.length}` : v instanceof Uint8Array ? `${v.length} bytes` : v === null ? "null" : typeof v === "object" ? "an object" : String(v));

/** A fixed() node's grid: value n / den (den = 1/step, when that is whole) or n * step, n in lo..hi. */
export interface Grid {
  readonly lo: number;
  readonly hi: number;
  readonly bits: number;
  readonly den: number;
  readonly step: number;
  /** Decimal places a value shows with (the JSON view rounds to these), or -1 for a non-decimal step. */
  readonly places: number;
  value(n: number): number;
  units(v: number): number;
}
const GRIDS = new WeakMap<FixedNode, Grid>();
export function gridOf(n: FixedNode): Grid {
  const have = GRIDS.get(n);
  if (have) return have;
  const inv = 1 / n.step;
  const den = Math.abs(inv - Math.round(inv)) < 1e-9 * Math.max(1, inv) ? Math.round(inv) : 0;
  const value = den ? (k: number): number => k / den : (k: number): number => k * n.step;
  const units = den ? (v: number): number => Math.round(v * den) : (v: number): number => Math.round(v / n.step);
  // (Grid points are whole multiples of the step within [min, max]; a bound a hair off one, by float error, is on it.)
  const near = (x: number): number | null => (Math.abs(x - Math.round(x)) <= 1e-9 * Math.max(1, Math.abs(x)) ? Math.round(x) : null);
  const lo = near(n.min / n.step) ?? Math.ceil(n.min / n.step);
  const hi = near(n.max / n.step) ?? Math.floor(n.max / n.step);
  let places = -1;
  // (Powers of ten by exact integer products, not `**`: pow's last bit is the engine's to choose.)
  if (den) for (let p = 0, ten = 1; p <= 15; p += 1, ten *= 10) if (ten % den === 0) { places = p; break; }
  const g: Grid = { lo, hi, bits: bitsFor(hi - lo + 1), den, step: n.step, places, value, units };
  GRIDS.set(n, g);
  return g;
}

export function intCheck(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) fail(`${describe(v)} is not a whole number (${what}).`);
  return v as number;
}

// A number with no schema of its own (num(), and dyn()'s numbers): an integer, a short decimal, a float32, a float64.
export const NUM_KINDS = ["int", "decimal", "float32", "float64"];
const TEN = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8];
/** The fewest decimal places (1..8) that spell a number exactly, or 0. */
export function placesOf(v: number): number {
  if (!Number.isFinite(v) || Object.is(v, -0) || Math.abs(v) > 2 ** 40) return 0;
  for (let p = 1; p <= 8; p += 1) {
    const m = Math.round(v * TEN[p]!);
    if (Math.abs(m) <= 2 ** 51 && m / TEN[p]! === v) return p;
  }
  return 0;
}
/** Write a number's kind in `tagBits` (int 0, decimal 1, float32 2, float64 3) and then the number. */
export function writeNum(o: BitWriter, v: number, tagBits: number): void {
  if (Number.isSafeInteger(v) && !Object.is(v, -0) && Math.abs(v) <= 2 ** 51) { o.bits(0, tagBits); o.golomb(zig(v), 0); return; }
  const p = placesOf(v);
  if (p) { o.bits(1, tagBits); o.bits(p - 1, 3); o.golomb(zig(Math.round(v * TEN[p]!)), 0); return; }
  if (Number.isNaN(v) || Object.is(Math.fround(v), v)) { o.bits(2, tagBits); o.f32(v); return; }
  o.bits(3, tagBits);
  o.f64(v);
}
export function readNum(i: BitReader, tag: number): number {
  if (tag === 0) return unzig(i.golomb(0));
  if (tag === 1) { const p = i.bits(3) + 1; const m = unzig(i.golomb(0)); const v = m / TEN[p]!; if (Number.isInteger(v) || placesOf(v) !== p) throw new CodecError(`A decimal with ${p} places that isn't its shortest spelling (not canonical).`); return v; }
  if (tag === 2) return i.f32();
  return i.f64();
}

// ---------------------------------------------------------------- compile

const COMPILED = new WeakMap<Node, C>();

/** The compiled codec for a schema (cached per schema). */
export function compiled(root: Node, compile: (node: Node, recs: C[]) => C): C {
  const have = COMPILED.get(root);
  if (have) return have;
  const c = compile(root, []);
  COMPILED.set(root, c);
  return c;
}

const enc = new TextEncoder();
/** A string's UTF-8 (ASCII the quick way). */
export function utf8(s: string): Uint8Array {
  const n = s.length;
  if (n < 64) {
    let ascii = true;
    for (let k = 0; k < n; k += 1) if (s.charCodeAt(k) > 0x7f) { ascii = false; break; }
    if (ascii) { const b = new Uint8Array(n); for (let k = 0; k < n; k += 1) b[k] = s.charCodeAt(k); return b; }
  }
  return enc.encode(s);
}
/** `len` bytes of UTF-8 from a (byte-aligned) reader, checked. */
export function fromUtf8(tr: BitReader, len: number): string {
  const b = tr.bytes(len);
  if (len < 64) {
    let ascii = true;
    for (let k = 0; k < len; k += 1) if (b[k]! > 0x7f) { ascii = false; break; }
    if (ascii) return String.fromCharCode.apply(null, b as unknown as number[]);
  }
  return dec.decode(b);
}
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** No lone surrogates: the string survives UTF-8. */
export const wellFormed = (s: string): boolean => !LONE.test(s);
export const SCRATCH = new BitWriter(64);
const dec = new TextDecoder("utf-8", { fatal: true });
