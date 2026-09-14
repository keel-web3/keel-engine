// The schema DSL: typed descriptions of data that the codec turns into bits.
// A schema is plain data -- a tree of nodes, each a small record ({ kind:
// "uint", bits: 8 }) -- so it can be hashed, encoded (a schema-schema:
// canonical.ts), shown in the editor and decoded by a tool that has no code
// for it. The TypeScript type rides along as a phantom: decode(schema, bytes)
// returns Infer<typeof schema>.
//
//   const Piece = t.struct({
//     key: t.ref("keys"),                        // a string, deduped through a table
//     size: t.fixed(0, 64, 0.001),               // 0..64 in millimetres: 16 bits
//     kind: t.enum(["level", "prop"]),           // 1 bit
//     tags: t.array(t.ref("tags"), { max: 15 }), // 4-bit length
//     glow: t.withDefault(t.bool(), false),      // 1 bit when it's the default
//     note: t.optional(t.string()),              // 1 presence bit
//   });
//   type Piece = Infer<typeof Piece>;
//
// Every node is frozen, and the field order you write is the order it's
// encoded in (and part of its hash).

/** A value a document can hold with no schema: JSON's, plus -0, NaN and the infinities (a dyn() carries them). */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
/** An enum's or a const's value. */
export type Lit = string | number | boolean;

/** Every kind of node, in the order the schema-schema tags them (append only). */
export const KINDS = [
  "uint", "int", "bool", "fixed", "float", "enum", "varuint", "varint", "string", "ref", "bytes", "hex", "biguint",
  "array", "optional", "nullable", "default", "struct", "tuple", "union", "alt", "map", "delta", "runs", "planes",
  "dyn", "num", "const", "named", "rec", "self", "lz",
] as const;
export type Kind = (typeof KINDS)[number];

/** A schema: a node, with the value it describes as a phantom type. */
export interface Type<V = unknown> {
  readonly kind: Kind;
  /** (Type-level only: never set.) */
  readonly __value?: V;
}
/** The value a schema describes. */
export type Infer<S> = S extends Type<infer V> ? V : never;

export interface UintNode extends Type<number> { readonly kind: "uint"; readonly bits: number }
export interface IntNode extends Type<number> { readonly kind: "int"; readonly bits: number }
export interface BoolNode extends Type<boolean> { readonly kind: "bool" }
/** What fixed() does with a number off its grid (or out of range): round it (to the nearest step; out of range throws), throw, or keep it exactly (a flag bit, then a float64). */
export type OffGrid = "round" | "strict" | "exact";
export interface FixedNode extends Type<number> { readonly kind: "fixed"; readonly min: number; readonly max: number; readonly step: number; readonly off: OffGrid; readonly k: number; readonly delta: boolean }
export interface FloatNode extends Type<number> { readonly kind: "float"; readonly bits: 16 | 32 | 64 }
export interface EnumNode<V extends Lit = Lit> extends Type<V> { readonly kind: "enum"; readonly values: readonly V[]; readonly capacity: number; readonly open: boolean; readonly other: boolean }
export interface VarNode extends Type<number> { readonly kind: "varuint" | "varint"; readonly k: number; readonly group: number }
export interface StringNode extends Type<string> { readonly kind: "string"; readonly max: number; readonly packHex: boolean }
export interface RefNode extends Type<string> { readonly kind: "ref"; readonly table: string; readonly packHex: boolean }
export interface BytesNode extends Type<Uint8Array> { readonly kind: "bytes"; readonly length: number }
export interface HexNode extends Type<string> { readonly kind: "hex"; readonly bytes: number }
export interface BigNode extends Type<bigint> { readonly kind: "biguint"; readonly bits: number }
export interface ArrayNode<V = unknown> extends Type<readonly V[]> { readonly kind: "array"; readonly of: Node; readonly length: number; readonly max: number }
export interface OptionalNode<V = unknown> extends Type<V | undefined> { readonly kind: "optional"; readonly of: Node; readonly optional: true }
export interface NullableNode<V = unknown> extends Type<V | null> { readonly kind: "nullable"; readonly of: Node }
export interface DefaultNode<V = unknown> extends Type<V> { readonly kind: "default"; readonly of: Node; readonly value: unknown }
export interface Field { readonly name: string; readonly type: Node }
export interface StructNode<V = unknown> extends Type<V> { readonly kind: "struct"; readonly fields: readonly Field[]; readonly open: boolean; readonly ext: readonly (readonly Field[])[] }
export interface TupleNode<V = unknown> extends Type<V> { readonly kind: "tuple"; readonly items: readonly Node[] }
export interface UnionNode<V = unknown> extends Type<V> { readonly kind: "union"; readonly tag: string; readonly variants: readonly Field[]; readonly capacity: number }
export interface AltNode<V = unknown> extends Type<V> { readonly kind: "alt"; readonly of: readonly Node[] }
export interface MapNode<V = unknown> extends Type<Readonly<Record<string, V>>> { readonly kind: "map"; readonly key: Node; readonly value: Node; readonly order: "sorted" | "kept" }
export interface DeltaNode extends Type<readonly number[]> { readonly kind: "delta"; readonly of: Node; readonly k: number }
export interface RunsNode<V = unknown> extends Type<readonly V[]> { readonly kind: "runs"; readonly of: Node }
export interface PlanesNode extends Type<readonly number[]> { readonly kind: "planes"; readonly bits: number }
export interface DynNode extends Type<Json> { readonly kind: "dyn" }
export interface NumNode extends Type<number> { readonly kind: "num" }
export interface ConstNode<V = unknown> extends Type<V> { readonly kind: "const"; readonly value: Json }
export interface NamedNode<V = unknown> extends Type<V> { readonly kind: "named"; readonly name: string; readonly version: number; readonly doc: string; readonly of: Node }
export interface RecNode<V = unknown> extends Type<V> { readonly kind: "rec"; readonly of: Node }
export interface SelfNode<V = unknown> extends Type<V> { readonly kind: "self"; readonly depth: number }
export interface LzNode<V = unknown> extends Type<readonly V[]> { readonly kind: "lz"; readonly of: Node; readonly min: number }

/** Any node (the untyped view the codec walks). */
export type Node =
  | UintNode | IntNode | BoolNode | FixedNode | FloatNode | EnumNode | VarNode | StringNode | RefNode | BytesNode | HexNode | BigNode
  | ArrayNode | OptionalNode | NullableNode | DefaultNode | StructNode | TupleNode | UnionNode | AltNode | MapNode | DeltaNode | RunsNode
  | PlanesNode | DynNode | NumNode | ConstNode | NamedNode | RecNode | SelfNode | LzNode;

/** A schema error: the definition itself is wrong. */
export class SchemaError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}
const bad = (why: string): never => { throw new SchemaError(why); };
const whole = (v: number, lo: number, hi: number, what: string): number => {
  if (!Number.isInteger(v) || v < lo || v > hi) bad(`${what} must be a whole number in ${lo}..${hi} (got ${v}).`);
  return v;
};
const node = <N extends Node>(n: N): N => Object.freeze(n);
/** The node behind a schema (every Type is one). */
export const asNode = (t: Type<unknown>): Node => t as Node;

// ---------------------------------------------------------------- numbers

/** An unsigned integer in exactly `bits` bits (1..53). */
export const uint = (bits: number): UintNode => node({ kind: "uint", bits: whole(bits, 1, 53, "uint bits") });
/** A signed integer in `bits` bits (2..53), zigzagged: -1 is 1, 1 is 2. Range -(2^(bits-1)) .. 2^(bits-1) - 1. */
export const int = (bits: number): IntNode => node({ kind: "int", bits: whole(bits, 2, 53, "int bits") });
export const bool = (): BoolNode => node({ kind: "bool" });
/**
 * A number on a grid -- the whole multiples of `step` in [min, max] -- stored as its step count in exactly
 * ceil(log2((max - min) / step + 1)) bits. Decimal steps (0.01, 0.001) and 1/n steps decode as exact decimals
 * (3.14, never 3.1400000000000006); other steps as count x step (a power-of-two fraction of pi is exact).
 * Off the grid: `off: "round"` (default) rounds to the nearest step, "strict" throws, "exact" spends one flag
 * bit on every value and keeps an off-grid one whole as a float64 (lossless: authored decimals stay small).
 * `k`: instead of the fixed width, the step count from zero (zigzagged when min < 0) as Exp-Golomb of order k --
 * small values in few bits: a part's corner 0.25 m from its pivot in 11 bits (k = 8) instead of 24.
 * `delta` (with k): the step count's difference from the last value this field had in the document -- a
 * polyline's next point, a stair's next step -- as a flag (0: the same again, 1 bit) and Exp-Golomb of order k.
 */
export function fixed(min: number, max: number, step: number, { off = "round", k = -1, delta = false }: { readonly off?: OffGrid; readonly k?: number; readonly delta?: boolean } = {}): FixedNode {
  if (![min, max, step].every(Number.isFinite)) bad("fixed(min, max, step) takes finite numbers.");
  if (!(step > 0)) bad(`fixed step must be positive (got ${step}).`);
  if (!(max > min)) bad(`fixed max must be above min (got ${min}..${max}).`);
  const steps = Math.round((max - min) / step);
  if (steps > 2 ** 52) bad(`fixed(${min}, ${max}, ${step}) has more than 2^52 steps.`);
  if (!["round", "strict", "exact"].includes(off)) bad(`fixed off must be "round", "strict" or "exact" (got ${off}).`);
  if (delta && k < 0) bad("fixed delta needs a Golomb k (the differences are Golomb-coded).");
  return node({ kind: "fixed", min, max, step, off, k: whole(k, -1, 31, "fixed k"), delta });
}
export const float16 = (): FloatNode => node({ kind: "float", bits: 16 });
export const float32 = (): FloatNode => node({ kind: "float", bits: 32 });
export const float64 = (): FloatNode => node({ kind: "float", bits: 64 });
/**
 * A variable-length unsigned integer. Default: Exp-Golomb of order `k` (k = 0 is Elias-gamma: 0 in 1 bit,
 * 1..2 in 3, 3..6 in 5, ...; a bigger k spends k bits more on small numbers and fewer on big ones).
 * `group: g` instead writes LEB-style groups of g bits, each followed by a "more" bit.
 */
export const varuint = ({ k = 0, group = 0 }: { readonly k?: number; readonly group?: number } = {}): VarNode =>
  node({ kind: "varuint", k: whole(k, 0, 31, "varuint k"), group: whole(group, 0, 31, "varuint group") });
/** varuint of the zigzagged value. */
export const varint = ({ k = 0, group = 0 }: { readonly k?: number; readonly group?: number } = {}): VarNode =>
  node({ kind: "varint", k: whole(k, 0, 31, "varint k"), group: whole(group, 0, 31, "varint group") });
/**
 * A number of any kind, lossless, 2 tag bits: a safe integer (zigzag Exp-Golomb); a short decimal (up to 8
 * places: 0.35, 10.016) as its digits and places; a float32 when it is exactly one; else a float64.
 */
export const num = (): NumNode => node({ kind: "num" });
/** A bigint below 2^bits (1..256): a bytes32 seed is biguint(256). */
export const biguint = (bits: number): BigNode => node({ kind: "biguint", bits: whole(bits, 1, 256, "biguint bits") });

// ---------------------------------------------------------------- choices and text

/**
 * One of a list: its index in ceil(log2 n) bits. `capacity` reserves room for values appended later (the
 * width is ceil(log2 capacity), so growth up to it keeps old data readable); `open` uses a varuint index
 * instead (grows forever, costs more for big lists); `other` adds one more code for any string not in the
 * list, written in full after it (a pinned instrument the list doesn't know survives).
 */
export function enumOf<const V extends readonly Lit[]>(values: V, opts?: { readonly capacity?: number; readonly open?: boolean; readonly other?: false }): EnumNode<V[number]>;
export function enumOf<const V extends readonly Lit[]>(values: V, opts: { readonly capacity?: number; readonly open?: boolean; readonly other: true }): EnumNode<V[number] | (string & {})>;
export function enumOf<const V extends readonly Lit[]>(values: V, { capacity = 0, open = false, other = false }: { readonly capacity?: number; readonly open?: boolean; readonly other?: boolean } = {}): EnumNode<Lit> {
  if (!values.length) bad("An enum needs values.");
  const seen = new Set<string>();
  for (const v of values) {
    const key = `${typeof v}:${String(v)}`;
    if (!["string", "number", "boolean"].includes(typeof v)) bad(`Enum values are strings, numbers or booleans (got ${typeof v}).`);
    if (seen.has(key)) bad(`Enum value ${JSON.stringify(v)} is listed twice.`);
    seen.add(key);
  }
  if (capacity && capacity < values.length) bad(`Enum capacity ${capacity} is below its ${values.length} values.`);
  return node({ kind: "enum", values: Object.freeze([...values]) as readonly Lit[], capacity: whole(capacity, 0, 2 ** 32, "enum capacity"), open, other });
}
/**
 * UTF-8 text, its byte length first (a varuint; `max` bytes fixes the length's width instead). `packHex`: a
 * flag bit, and a string that is "0x" + lower-case hex byte pairs (a bytes32 seed) goes as its bytes -- half the size.
 */
export const string = ({ max = 0, packHex = false }: { readonly max?: number; readonly packHex?: boolean } = {}): StringNode =>
  node({ kind: "string", max: whole(max, 0, 2 ** 32, "string max"), packHex });
/**
 * A string through a shared table: the first time a string appears it is written in full (and joins the
 * table), after that it is its index -- ceil(log2(n + 1)) bits for a table of n. Tables are named: every
 * ref("tags") in a document (or in every document encoded with the same tables) shares one. The default
 * table, "str", is also where dyn() keeps its strings. `packHex` writes a new "0x" hex string as its bytes.
 */
export const ref = (table = "str", { packHex = false }: { readonly packHex?: boolean } = {}): RefNode =>
  node({ kind: "ref", table: table || bad("ref needs a table name."), packHex });
/** Raw bytes: a varuint length, or exactly `length`. */
export const bytes = ({ length = 0 }: { readonly length?: number } = {}): BytesNode => node({ kind: "bytes", length: whole(length, 0, 2 ** 32, "bytes length") });
/** "0x" + lower-case hex digits, stored as bytes: exactly `bytes` of them, or a varuint count. */
export const hex = ({ bytes: n = 0 }: { readonly bytes?: number } = {}): HexNode => node({ kind: "hex", bytes: whole(n, 0, 2 ** 20, "hex bytes") });
/** A value that is always the same: costs nothing. */
export const constant = <const V extends Json>(value: V): ConstNode<V> => node({ kind: "const", value });
/** Any JSON-like value, self-described: 3 tag bits, integers as varints, floats as float32 when exact, strings and keys through a table. */
export const dyn = (): DynNode => node({ kind: "dyn" });

// ---------------------------------------------------------------- containers

type AnyType = Type<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A list: a varuint length first, or exactly `length` items, or a length in ceil(log2(max + 1)) bits. */
export function array<S extends AnyType>(of: S, { length = 0, max = 0 }: { readonly length?: number; readonly max?: number } = {}): ArrayNode<Infer<S>> {
  if (length && max) bad("An array has a fixed length or a max, not both.");
  return node({ kind: "array", of: asNode(of), length: whole(length, 0, 2 ** 32, "array length"), max: whole(max, 0, 2 ** 32, "array max") });
}
/** Maybe there: a presence bit. In a struct, the field may be left out (and is left out when decoded). */
export const optional = <S extends AnyType>(of: S): OptionalNode<Infer<S>> => node({ kind: "optional", of: asNode(of), optional: true });
/** The value or null: a presence bit. */
export const nullable = <S extends AnyType>(of: S): NullableNode<Infer<S>> => node({ kind: "nullable", of: asNode(of) });
/** A value that is usually `value`: 1 bit when it is (and an absent field counts as it), 1 bit + the value when not. */
export const withDefault = <S extends AnyType>(of: S, value: Infer<S>): DefaultNode<Infer<S>> => node({ kind: "default", of: asNode(of), value });

type Fields = Readonly<Record<string, AnyType>>;
type OptionalKeys<F> = { [K in keyof F]: F[K] extends OptionalNode<unknown> ? K : never }[keyof F];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** A struct's value: every field, the optional ones optional. */
export type StructValue<F> = Simplify<{ readonly [K in Exclude<keyof F, OptionalKeys<F>>]: Infer<F[K]> } & { readonly [K in OptionalKeys<F>]?: Infer<F[K]> }>;
/** A struct node that remembers its fields' types (for extend()). */
export interface StructType<F extends Fields> extends StructNode<StructValue<F>> { readonly __fields?: F }

const fieldsOf = (fields: Fields, what: string): Field[] => {
  const out: Field[] = [];
  for (const [name, type] of Object.entries(fields)) {
    if (!name) bad(`${what}: a field needs a name.`);
    if (!type || typeof (type as Node).kind !== "string") bad(`${what}: field ${name} is not a schema.`);
    out.push(Object.freeze({ name, type: asNode(type) }));
  }
  return out;
};

/**
 * Named fields, written in the order given. `open: true` makes room to append fields later (extend()):
 * the struct then carries a count of extension groups after its fields (1 bit while there are none),
 * so an old reader can skip what it doesn't know, and a new reader fills in what old data lacks.
 */
export function struct<const F extends Fields>(fields: F, { open = false }: { readonly open?: boolean } = {}): StructType<F> {
  return node({ kind: "struct", fields: Object.freeze(fieldsOf(fields, "struct")), open, ext: Object.freeze([]) }) as StructType<F>;
}

/**
 * A new version of an open struct: its fields, plus a group of new ones at the end. New fields must be
 * optional() or withDefault() (old data doesn't have them: a reader fills them in).
 */
export function extend<F extends Fields, const G extends Fields>(base: StructType<F>, fields: G): StructType<F & G> {
  if (base.kind !== "struct") bad("extend() takes a struct.");
  if (!base.open) bad("Only an open struct can be extended: declare it struct({...}, { open: true }) from its first version.");
  const group = fieldsOf(fields, "extend");
  if (!group.length) bad("extend() needs at least one field.");
  const names = new Set([...base.fields, ...base.ext.flat()].map((f) => f.name));
  for (const f of group) {
    if (names.has(f.name)) bad(`extend(): the struct already has a field ${f.name}.`);
    if (f.type.kind !== "optional" && f.type.kind !== "default") bad(`extend(): new field ${f.name} must be optional() or withDefault() (old data doesn't carry it).`);
  }
  return node({ kind: "struct", fields: base.fields, open: true, ext: Object.freeze([...base.ext, Object.freeze(group)]) }) as StructType<F & G>;
}

type TupleValue<T extends readonly AnyType[]> = { readonly [K in keyof T]: Infer<T[K]> };
/** Positional values, each its own type. */
export const tuple = <const T extends readonly AnyType[]>(items: T): TupleNode<TupleValue<T>> => node({ kind: "tuple", items: Object.freeze(items.map(asNode)) });

type Variants = Readonly<Record<string, StructType<any>>>; // eslint-disable-line @typescript-eslint/no-explicit-any
type UnionValue<Tag extends string, V extends Variants> = { [K in keyof V & string]: Simplify<{ readonly [P in Tag]: K } & Infer<V[K]>> }[keyof V & string];

/**
 * One of several structs, told apart by a tag field: { type: "box", c, h } | { type: "capsule", a, b, r }.
 * The tag is the variant's index in ceil(log2 n) bits (or ceil(log2 capacity), room to add variants later).
 */
export function union<const Tag extends string, const V extends Variants>(tag: Tag, variants: V, { capacity = 0 }: { readonly capacity?: number } = {}): UnionNode<UnionValue<Tag, V>> {
  const list = fieldsOf(variants, "union");
  if (!list.length) bad("A union needs variants.");
  for (const v of list) {
    if (v.type.kind !== "struct") bad(`Union variant ${v.name} must be a struct.`);
    const st = v.type as StructNode;
    if ([...st.fields, ...st.ext.flat()].some((f) => f.name === tag)) bad(`Union variant ${v.name} has a field called ${tag}, its tag.`);
  }
  if (capacity && capacity < list.length) bad(`Union capacity ${capacity} is below its ${list.length} variants.`);
  return node({ kind: "union", tag, variants: Object.freeze(list), capacity: whole(capacity, 0, 2 ** 16, "union capacity") });
}

/** What a value is at run time, for alt(). */
export type Category = "number" | "string" | "boolean" | "bigint" | "null" | "array" | "bytes" | "object" | "any";

/**
 * One of several types told apart by what the value is (a number, a string, an array...): a Mat that is a
 * name or an index. ceil(log2 n) tag bits; the branches must be of different categories.
 */
export function alt<const T extends readonly AnyType[]>(of: T): AltNode<Infer<T[number]>> {
  if (of.length < 2) bad("alt() takes two or more types.");
  const cats = of.map((t) => categoryOf(asNode(t)));
  const seen = new Set<Category>();
  for (const c of cats) {
    if (c === "any") bad("alt() branches must have a definite category (not dyn, optional or a recursion).");
    if (seen.has(c)) bad(`alt() has two ${c} branches: nothing tells them apart.`);
    seen.add(c);
  }
  return node({ kind: "alt", of: Object.freeze(of.map(asNode)) });
}

/** A record with string keys: a varuint count, then each key and value. Sorted by key (canonical), or in the order given ("kept": for maps whose order means something). */
export function map<K extends Type<string>, S extends AnyType>(key: K, value: S, { order = "sorted" }: { readonly order?: "sorted" | "kept" } = {}): MapNode<Infer<S>> {
  if (categoryOf(asNode(key)) !== "string") bad("A map's key must be a string type (string, ref, hex or an enum of strings).");
  return node({ kind: "map", key: asNode(key), value: asNode(value), order });
}

// ---------------------------------------------------------------- sequences

/**
 * Numbers near each other (sorted ids, a polyline, a timeline): the first as `of`, then each difference from
 * the one before, zigzagged, as Exp-Golomb of order k. `of` is an integer type or fixed() (differences in steps).
 */
export function delta(of: Type<number>, { k = 0 }: { readonly k?: number } = {}): DeltaNode {
  const n = asNode(of);
  if (!["uint", "int", "varuint", "varint", "fixed"].includes(n.kind)) bad("delta() takes uint, int, varuint, varint or fixed.");
  if (n.kind === "fixed" && n.delta) bad("delta() of a fixed that is already delta-coded: give it a plain fixed().");
  return node({ kind: "delta", of: n, k: whole(k, 0, 31, "delta k") });
}
/** Runs of equal values (a voxel row): the total length, then each run as its value and its length - 1 (a varuint). */
export const runs = <S extends AnyType>(of: S): RunsNode<Infer<S>> => node({ kind: "runs", of: asNode(of) });
/**
 * A sequence with repeats (a voxel box's cells, a tile map): LZ77 over its items -- each step a literal item or
 * a copy of `min` or more items from some distance back (a run is a copy from 1 back; a row like the row
 * before, from a row back). Items are numbers, strings or booleans. The encoder is greedy (longest match,
 * nearest first), so the bytes are canonical.
 */
export function lz<S extends Type<number | string | boolean>>(of: S, { min = 3 }: { readonly min?: number } = {}): LzNode<Infer<S>> {
  const c = categoryOf(asNode(of));
  if (c !== "number" && c !== "string" && c !== "boolean") bad("lz() takes numbers, strings or booleans (a scalar type).");
  return node({ kind: "lz", of: asNode(of), min: whole(min, 2, 15, "lz min") });
}
/** Small unsigned numbers by bit plane: the length, then the top bit of every value, the next bit of every value... (gzip finds the planes' runs). */
export const planes = (bits: number): PlanesNode => node({ kind: "planes", bits: whole(bits, 1, 32, "planes bits") });

// ---------------------------------------------------------------- names and recursion

/** A name (and version and note) on a schema: part of its hash, shown by the editor, carried by self-describing documents. */
export const named = <S extends AnyType>(name: string, of: S, { version = 1, doc = "" }: { readonly version?: number; readonly doc?: string } = {}): NamedNode<Infer<S>> =>
  node({ kind: "named", name: name || bad("named() needs a name."), version: whole(version, 0, 2 ** 32, "version"), doc, of: asNode(of) });

/**
 * A type that contains itself (a block holding blocks): recursive<Block>((self) => t.struct({ ..., body: t.array(self) })).
 * `self` stands for the whole; inside the schema it is { kind: "self", depth } -- how many recursions out it points.
 */
export function recursive<V>(build: (self: Type<V>) => Type<V>): RecNode<V> {
  const placeholder = Object.freeze({ kind: "self", depth: -1 }) as SelfNode<V>;
  const body = asNode(build(placeholder));
  // (Resolve the placeholder into its depth: how many rec nodes lie between it and this one.)
  const fix = (n: Node, depth: number): Node => {
    if (n === placeholder) return node({ kind: "self", depth });
    return mapChildren(n, (c) => fix(c, depth + (n.kind === "rec" ? 1 : 0)));
  };
  return node({ kind: "rec", of: fix(body, 0) });
}

/** The node with each child node passed through `f` (the same node when nothing changed). */
export function mapChildren(n: Node, f: (child: Node) => Node): Node {
  const fl = (fs: readonly Field[]): readonly Field[] => {
    let changed = false;
    const out = fs.map((x) => { const t = f(x.type); if (t !== x.type) changed = true; return t === x.type ? x : Object.freeze({ name: x.name, type: t }); });
    return changed ? Object.freeze(out) : fs;
  };
  switch (n.kind) {
    case "array": case "optional": case "nullable": case "default": case "delta": case "runs": case "named": case "rec": case "lz": {
      const of = f(n.of);
      return of === n.of ? n : node({ ...n, of } as Node);
    }
    case "struct": {
      const fields = fl(n.fields);
      const ext = n.ext.map(fl);
      return fields === n.fields && ext.every((g, i) => g === n.ext[i]) ? n : node({ ...n, fields, ext: Object.freeze(ext) });
    }
    case "union": { const variants = fl(n.variants); return variants === n.variants ? n : node({ ...n, variants }); }
    case "tuple": { const items = n.items.map(f); return items.every((x, i) => x === n.items[i]) ? n : node({ ...n, items: Object.freeze(items) }); }
    case "alt": { const of = n.of.map(f); return of.every((x, i) => x === n.of[i]) ? n : node({ ...n, of: Object.freeze(of) }); }
    case "map": { const key = f(n.key); const value = f(n.value); return key === n.key && value === n.value ? n : node({ ...n, key, value }); }
    default: return n;
  }
}

/** What kind of value a node holds at run time. */
export function categoryOf(n: Node): Category {
  switch (n.kind) {
    case "uint": case "int": case "fixed": case "float": case "varuint": case "varint": case "num": return "number";
    case "bool": return "boolean";
    case "string": case "ref": case "hex": return "string";
    case "biguint": return "bigint";
    case "bytes": return "bytes";
    case "array": case "delta": case "runs": case "planes": case "tuple": case "lz": return "array";
    case "struct": case "union": case "map": return "object";
    case "nullable": return "any";
    case "enum": { const c = new Set([...n.values.map((v) => typeof v), ...(n.other ? ["string"] : [])]); return c.size === 1 ? ([...c][0] as Category) : "any"; }
    case "const": return n.value === null ? "null" : Array.isArray(n.value) ? "array" : (typeof n.value as Category);
    case "named": case "default": return categoryOf(n.of);
    default: return "any";
  }
}

/** The DSL as one object: t.uint(8), t.enum([...]), t.struct({...}). */
export const t = {
  uint, int, bool, fixed, float16, float32, float64, varuint, varint, num, biguint,
  enum: enumOf, string, ref, bytes, hex, const: constant, dyn,
  array, optional, nullable, withDefault, default: withDefault, struct, extend, tuple, union, alt, map,
  delta, runs, lz, planes, named, recursive,
} as const;
