// Schemas as data: the schema-schema (a schema, in the DSL, that describes
// every schema), so a schema encodes to bytes, a document can carry the
// schema it was written with, and a tool with no code for it can still read
// it. And the schema id: the SHA-256 of a schema's canonical bytes (with its
// docs left out, so rewording a note doesn't change it).
//
//   encodeSchema(Piece) -> bytes        decodeSchema(bytes) -> the same schema
//   schemaId(Piece) -> "3f9a...": 64 hex digits; shortId -> the first 8 (what a header carries)

import { decodeRaw, encodeRaw } from "./codec.ts";
import {
  alt, array, biguint, bool, bytes, constant, delta, dyn, enumOf, extend, fixed, float16, float32, float64, hex, int, map, named, nullable, num, optional,
  lz, planes, recursive, ref, runs, string, struct, tuple, uint, union, varint, varuint, SchemaError,
} from "./schema.ts";
import type { StructType } from "./schema.ts";
import type { Field, Json, Lit, Node, Type } from "./schema.ts";
import { sha256, toHex } from "./sha256.ts";

/** A schema as plain data: what the schema-schema encodes and the editor shows (a default's value as its own bytes). */
export type SchemaRecord = Readonly<Record<string, unknown>> & { readonly kind: string };

const NAMES = "$names";
const field = (self: Type<SchemaRecord>) => struct({ name: ref(NAMES), type: self });

/** The schema of schemas. Its variants are KINDS in order (append only: 64 kinds of room). */
export const SCHEMA_SCHEMA = named("keel/codec/schema", recursive<SchemaRecord>((self) => union("kind", {
  uint: struct({ bits: uint(6) }),
  int: struct({ bits: uint(6) }),
  bool: struct({}),
  fixed: struct({ min: num(), max: num(), step: num(), off: enumOf(["round", "strict", "exact"]), k: int(7), delta: bool() }),
  float: struct({ bits: enumOf([16, 32, 64]) }),
  enum: struct({ values: array(alt([string(), num(), bool()])), capacity: varuint(), open: bool(), other: bool() }),
  varuint: struct({ k: uint(5), group: uint(5) }),
  varint: struct({ k: uint(5), group: uint(5) }),
  string: struct({ max: varuint(), packHex: bool() }),
  ref: struct({ table: ref(NAMES), packHex: bool() }),
  bytes: struct({ length: varuint() }),
  hex: struct({ bytes: varuint() }),
  biguint: struct({ bits: uint(9) }),
  array: struct({ of: self, length: varuint(), max: varuint() }),
  optional: struct({ of: self }),
  nullable: struct({ of: self }),
  default: struct({ of: self, value: bytes() }),
  struct: struct({ fields: array(field(self)), open: bool(), ext: array(array(field(self))) }),
  tuple: struct({ items: array(self) }),
  union: struct({ tag: ref(NAMES), variants: array(field(self)), capacity: varuint() }),
  alt: struct({ of: array(self) }),
  map: struct({ key: self, value: self, order: enumOf(["sorted", "kept"]) }),
  delta: struct({ of: self, k: uint(5) }),
  runs: struct({ of: self }),
  planes: struct({ bits: uint(6) }),
  dyn: struct({}),
  num: struct({}),
  const: struct({ value: dyn() }),
  named: struct({ name: ref(NAMES), version: varuint(), doc: string(), of: self }),
  rec: struct({ of: self }),
  self: struct({ depth: varuint() }),
  lz: struct({ of: self, min: uint(4) }),
}, { capacity: 64 }) as unknown as Type<SchemaRecord>), { doc: "Every schema, as data: a document can carry its own." });

/** A schema as a record (the schema-schema's value). `docs: false` blanks named() docs (what the id hashes). */
export function toRecord(type: Type<unknown>, { docs = true }: { readonly docs?: boolean } = {}): SchemaRecord {
  const walk = (n: Node): SchemaRecord => {
    const fl = (fs: readonly Field[]): SchemaRecord[] => fs.map((f) => ({ name: f.name, type: walk(f.type) }) as unknown as SchemaRecord);
    switch (n.kind) {
      case "uint": case "int": case "biguint": case "planes": return { kind: n.kind, bits: n.bits };
      case "bool": case "dyn": case "num": return { kind: n.kind };
      case "fixed": return { kind: "fixed", min: n.min, max: n.max, step: n.step, off: n.off, k: n.k, delta: n.delta };
      case "float": return { kind: "float", bits: n.bits };
      case "enum": return { kind: "enum", values: [...n.values], capacity: n.capacity, open: n.open, other: n.other };
      case "varuint": case "varint": return { kind: n.kind, k: n.k, group: n.group };
      case "string": return { kind: "string", max: n.max, packHex: n.packHex };
      case "ref": return { kind: "ref", table: n.table, packHex: n.packHex };
      case "bytes": return { kind: "bytes", length: n.length };
      case "hex": return { kind: "hex", bytes: n.bytes };
      case "array": return { kind: "array", of: walk(n.of), length: n.length, max: n.max };
      case "optional": case "nullable": case "runs": case "rec": return { kind: n.kind, of: walk(n.of) };
      case "default": {
        let value: Uint8Array;
        try { value = encodeRaw(n.of, n.value); } catch (e) { throw new SchemaError(`A default can't be written as data: ${(e as Error).message}`); }
        return { kind: "default", of: walk(n.of), value };
      }
      case "struct": return { kind: "struct", fields: fl(n.fields), open: n.open, ext: n.ext.map((g) => fl(g)) };
      case "tuple": return { kind: "tuple", items: n.items.map((x) => walk(x)) };
      case "union": return { kind: "union", tag: n.tag, variants: fl(n.variants), capacity: n.capacity };
      case "alt": return { kind: "alt", of: n.of.map((x) => walk(x)) };
      case "map": return { kind: "map", key: walk(n.key), value: walk(n.value), order: n.order };
      case "delta": return { kind: "delta", of: walk(n.of), k: n.k };
      case "const": return { kind: "const", value: n.value };
      case "named": return { kind: "named", name: n.name, version: n.version, doc: docs ? n.doc : "", of: walk(n.of) };
      case "self": return { kind: "self", depth: n.depth };
      case "lz": return { kind: "lz", of: walk(n.of), min: n.min };
    }
  };
  return walk(type as Node);
}

/** A record back to a schema (through the DSL, so every rule is checked again). */
export function fromRecord<V = unknown>(record: SchemaRecord): Type<V> {
  const r = record as Record<string, unknown>;
  const of = (key = "of"): Node => fromRecord(r[key] as SchemaRecord) as Node;
  const fields = (list: unknown): Record<string, Type<unknown>> => {
    const out: Record<string, Type<unknown>> = {};
    for (const f of list as { name: string; type: SchemaRecord }[]) {
      if (Object.hasOwn(out, f.name)) throw new SchemaError(`A struct has two fields called ${f.name}.`);
      out[f.name] = fromRecord(f.type);
    }
    return out;
  };
  const n = (x: object): Node => Object.freeze(x) as Node;
  const V = (x: Type<unknown>): Type<V> => x as Type<V>;
  switch (r["kind"]) {
    case "uint": return V(uint(r["bits"] as number));
    case "int": return V(int(r["bits"] as number));
    case "bool": return V(bool());
    case "fixed": return V(fixed(r["min"] as number, r["max"] as number, r["step"] as number, { off: r["off"] as "round", k: r["k"] as number, delta: r["delta"] as boolean }));
    case "float": return V(r["bits"] === 16 ? float16() : r["bits"] === 32 ? float32() : float64());
    case "enum": return V(r["other"] ? enumOf(r["values"] as Lit[], { capacity: r["capacity"] as number, open: r["open"] as boolean, other: true }) : enumOf(r["values"] as Lit[], { capacity: r["capacity"] as number, open: r["open"] as boolean }));
    case "varuint": return V(varuint({ k: r["k"] as number, group: r["group"] as number }));
    case "varint": return V(varint({ k: r["k"] as number, group: r["group"] as number }));
    case "string": return V(string({ max: r["max"] as number, packHex: r["packHex"] as boolean }));
    case "ref": return V(ref(r["table"] as string, { packHex: r["packHex"] as boolean }));
    case "bytes": return V(bytes({ length: r["length"] as number }));
    case "hex": return V(hex({ bytes: r["bytes"] as number }));
    case "biguint": return V(biguint(r["bits"] as number));
    case "array": return V(array(of(), { length: r["length"] as number, max: r["max"] as number }));
    case "optional": return V(optional(of()));
    case "nullable": return V(nullable(of()));
    case "default": {
      const t = of();
      return V(n({ kind: "default", of: t, value: decodeRaw(t, r["value"] as Uint8Array) }));
    }
    case "struct": {
      // (Through struct() and extend(): an extension's fields are checked as they were when it was written.)
      let st = struct(fields(r["fields"]), { open: r["open"] as boolean }) as StructType<Record<string, Type<unknown>>>;
      for (const g of r["ext"] as unknown[]) st = extend(st, fields(g));
      return V(st);
    }
    case "tuple": return V(tuple((r["items"] as SchemaRecord[]).map((x) => fromRecord(x))));
    case "union": return V(union(r["tag"] as string, fields(r["variants"]) as never, { capacity: r["capacity"] as number }));
    case "alt": return V(alt((r["of"] as SchemaRecord[]).map((x) => fromRecord(x))));
    case "map": return V(map(of("key") as Type<string>, of("value"), { order: r["order"] as "sorted" | "kept" }));
    case "delta": return V(delta(of() as Type<number>, { k: r["k"] as number }));
    case "runs": return V(runs(of()));
    case "planes": return V(planes(r["bits"] as number));
    case "dyn": return V(dyn());
    case "num": return V(num());
    case "const": return V(constant(r["value"] as Json));
    case "named": return V(named(r["name"] as string, of(), { version: r["version"] as number, doc: r["doc"] as string }));
    case "rec": return V(n({ kind: "rec", of: of() }));
    case "self": return V(n({ kind: "self", depth: r["depth"] }));
    case "lz": return V(lz(of() as Type<number>, { min: r["min"] as number }));
    default: throw new SchemaError(`No schema kind ${JSON.stringify(r["kind"])}.`);
  }
}

/** A schema's bytes (its record through the schema-schema). */
export const encodeSchema = (type: Type<unknown>, opts: { readonly docs?: boolean } = {}): Uint8Array => encodeRaw(SCHEMA_SCHEMA, toRecord(type, opts));
/** A schema back from encodeSchema()'s bytes. */
export const decodeSchema = <V = unknown>(bytes: Uint8Array): Type<V> => fromRecord<V>(decodeRaw(SCHEMA_SCHEMA, bytes));

const IDS = new WeakMap<object, string>();
/** The schema's id: SHA-256 of its canonical bytes, docs left out (64 hex digits). */
export function schemaId(type: Type<unknown>): string {
  const have = IDS.get(type);
  if (have) return have;
  const id = toHex(sha256(encodeSchema(type, { docs: false })));
  IDS.set(type, id);
  return id;
}
/** The first 4 bytes of the id, as 8 hex digits: what a document's header carries. */
export const shortId = (type: Type<unknown>): string => schemaId(type).slice(0, 8);

/** The name and version a schema carries (its outermost named()), or null. */
export function schemaName(type: Type<unknown>): { readonly name: string; readonly version: number; readonly doc: string } | null {
  const n = type as Node;
  return n.kind === "named" ? { name: n.name, version: n.version, doc: n.doc } : null;
}
