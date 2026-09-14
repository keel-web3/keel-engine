// The JSON view: the authoring and debugging form of any value, lossless both
// ways. Enums are their names, fixed() numbers the decimals they stand for
// (3.14, never 3.1400000000000006), bytes and big numbers "0x" hex, and the
// few numbers JSON can't spell as strings: "NaN", "Infinity", "-Infinity",
// "-0". In a dyn() (where any string is already a value) they are escaped as
// { "$float": "NaN" } (and an object that is literally { "$float": ... },
// { "$obj": ... } or { "$none": ... } as { "$obj": {...} }). An optional left
// out is left out of its struct; anywhere else it is { "$none": true }.
//
//   toJSON(schema, value) -> JSON      fromJSON(schema, json) -> the value (checked against the schema)

import { CodecError, gridOf, put, under, validate } from "./codec.ts";
import type { Infer, Json, Node, Type } from "./schema.ts";
import { toHex } from "./sha256.ts";

const special = (v: number): string | null => (Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : Object.is(v, -0) ? "-0" : null);
const SPECIAL: Readonly<Record<string, number>> = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity, "-0": -0 };
// (A dyn object whose only key is one of these is escaped as { "$obj": ... }.)
const ESCAPES: ReadonlySet<string> = new Set(["$float", "$obj", "$none"]);
/** Can a node's JSON form be null? (If not, a null where an optional of it stands means absent.) */
function takesNull(n: Node): boolean {
  switch (n.kind) {
    case "nullable": case "dyn": case "optional": return true;
    case "const": return n.value === null;
    case "named": case "default": return takesNull(n.of);
    case "alt": return n.of.some(takesNull);
    default: return false;
  }
}
const isNone = (j: unknown): boolean => j !== null && typeof j === "object" && !Array.isArray(j) && Object.keys(j).length === 1 && (j as Record<string, unknown>)["$none"] === true;

function dynTo(v: unknown): Json {
  if (typeof v === "number") { const s = special(v); return s === null ? v : { $float: s }; }
  if (Array.isArray(v)) return v.map(dynTo);
  if (v !== null && typeof v === "object") {
    const o: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) put(o, k, dynTo(x));
    const keys = Object.keys(o);
    return keys.length === 1 && ESCAPES.has(keys[0]!) ? { $obj: o } : o;
  }
  return v as Json;
}
function dynFrom(j: unknown): Json {
  if (Array.isArray(j)) return j.map(dynFrom);
  if (j !== null && typeof j === "object") {
    const keys = Object.keys(j);
    const rec = j as Record<string, unknown>;
    if (keys.length === 1 && keys[0] === "$float") {
      const s = rec["$float"];
      if (typeof s !== "string" || !(s in SPECIAL)) throw new CodecError(`{ "$float": ${JSON.stringify(s)} } isn't NaN, Infinity, -Infinity or -0.`);
      return SPECIAL[s]!;
    }
    const src = keys.length === 1 && keys[0] === "$obj" ? (rec["$obj"] as Record<string, unknown>) : rec;
    const o: Record<string, Json> = {};
    for (const [k, x] of Object.entries(src)) put(o, k, dynFrom(x));
    return o;
  }
  return j as Json;
}

const hexOf = (b: Uint8Array): string => `0x${toHex(b)}`;
function bytesFrom(j: unknown): Uint8Array {
  if (typeof j !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(j)) throw new CodecError(`${JSON.stringify(j)} isn't "0x" + hex byte pairs.`);
  const out = new Uint8Array((j.length - 2) / 2);
  for (let k = 0; k < out.length; k += 1) out[k] = parseInt(j.slice(2 + k * 2, 4 + k * 2), 16);
  return out;
}

interface JsonOptions {
  /** Leave out struct fields that hold their default (shorter authoring files; fromJSON fills them in). */
  readonly omitDefaults?: boolean;
}

function to(n: Node, v: unknown, recs: Node[], o: JsonOptions): Json {
  switch (n.kind) {
    case "fixed": {
      if (typeof v !== "number") return v as Json;
      const g = gridOf(n);
      if (n.off === "exact") { const k = Number.isFinite(v) ? g.units(v) : NaN; if (!(k >= g.lo && k <= g.hi && Object.is(g.value(k) === 0 ? 0 : g.value(k), v))) return special(v) ?? v; }
      if (!Number.isFinite(v)) return v as Json;
      const x = g.value(g.units(v));
      return g.places >= 0 ? Number(x.toFixed(g.places)) : x;
    }
    case "float": case "num": return typeof v === "number" ? (special(v) ?? v) : (v as Json);
    case "bytes": return v instanceof Uint8Array ? hexOf(v) : (v as Json);
    case "biguint": return typeof v === "bigint" ? `0x${v.toString(16).padStart(Math.ceil(n.bits / 4), "0")}` : (v as Json);
    case "dyn": case "const": return dynTo(v);
    case "array": case "runs": case "lz": return Array.isArray(v) ? v.map((x) => to(n.of, x, recs, o) ?? null) : (v as Json);
    case "delta": return Array.isArray(v) ? v.map((x) => to(n.of, x, recs, o)) : (v as Json);
    case "planes": return Array.isArray(v) ? [...v] : (v as Json);
    // (Outside a struct -- where an absent field is simply left out -- absence is { "$none": true }: null may be a value.)
    case "optional": return v === undefined ? { $none: true } : to(n.of, v, recs, o);
    case "nullable": return v === null ? null : to(n.of, v, recs, o);
    case "default": return to(n.of, v === undefined ? n.value : v, recs, o);
    case "struct": {
      if (v === null || typeof v !== "object") return v as Json;
      const rec = v as Record<string, unknown>;
      const out: Record<string, Json> = {};
      for (const f of [...n.fields, ...n.ext.flat()]) {
        const x = rec[f.name];
        if (x === undefined && f.type.kind === "optional") continue;
        if (o.omitDefaults && f.type.kind === "default" && (x === undefined || JSON.stringify(to(f.type.of, x, recs, o)) === JSON.stringify(to(f.type.of, f.type.value, recs, o)))) continue;
        put(out, f.name, to(f.type, x, recs, o));
      }
      return out;
    }
    case "tuple": return Array.isArray(v) ? n.items.map((it, k) => to(it, v[k], recs, o)) : (v as Json);
    case "union": {
      if (v === null || typeof v !== "object") return v as Json;
      const tag = (v as Record<string, unknown>)[n.tag];
      const variant = n.variants.find((x) => x.name === tag);
      if (!variant) return v as Json;
      return { [n.tag]: tag as string, ...(to(variant.type, v, recs, o) as Record<string, Json>) };
    }
    case "alt": {
      const cat = typeof v === "bigint" ? "bigint" : v instanceof Uint8Array ? "bytes" : Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
      const b = n.of.find((x) => categoryMatches(x, cat));
      return b ? to(b, v, recs, o) : (v as Json);
    }
    case "map": {
      if (v === null || typeof v !== "object") return v as Json;
      const out: Record<string, Json> = {};
      const keys = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined);
      if (n.order === "sorted") keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const k of keys) put(out, k, to(n.value, (v as Record<string, unknown>)[k], recs, o));
      return out;
    }
    case "named": return to(n.of, v, recs, o);
    case "rec": return to(n.of, v, [...recs, n], o);
    case "self": return to(recs[recs.length - 1 - n.depth]!, v, recs.slice(0, recs.length - 1 - n.depth), o);
    default: return v as Json;
  }
}

function categoryMatches(n: Node, cat: string): boolean {
  switch (n.kind) {
    case "uint": case "int": case "fixed": case "float": case "varuint": case "varint": case "num": return cat === "number";
    case "bool": return cat === "boolean";
    case "string": case "ref": case "hex": return cat === "string";
    case "biguint": return cat === "bigint";
    case "bytes": return cat === "bytes";
    case "array": case "delta": case "runs": case "planes": case "tuple": case "lz": return cat === "array";
    case "struct": case "union": case "map": return cat === "object";
    case "enum": return n.values.some((x) => typeof x === cat) || (n.other && cat === "string");
    case "const": return (n.value === null ? "null" : Array.isArray(n.value) ? "array" : typeof n.value) === cat;
    case "named": case "default": return categoryMatches(n.of, cat);
    default: return false;
  }
}

function jsonFits(n: Node, j: unknown): boolean {
  switch (n.kind) {
    case "float": case "num": return typeof j === "number" || (typeof j === "string" && j in SPECIAL);
    case "fixed": return typeof j === "number" || (n.off === "exact" && typeof j === "string" && j in SPECIAL);
    case "uint": case "int": case "varuint": case "varint": return typeof j === "number";
    case "bool": return typeof j === "boolean";
    case "string": case "ref": case "hex": case "bytes": return typeof j === "string";
    case "biguint": return typeof j === "string" || typeof j === "number";
    case "array": case "delta": case "runs": case "planes": case "tuple": case "lz": return Array.isArray(j);
    case "struct": case "union": case "map": return j !== null && typeof j === "object" && !Array.isArray(j);
    case "enum": return n.values.includes(j as never) || (n.other && typeof j === "string");
    case "const": return JSON.stringify(n.value) === JSON.stringify(j);
    case "named": case "default": return jsonFits(n.of, j);
    default: return true;
  }
}

function from(n: Node, j: unknown, recs: Node[]): unknown {
  switch (n.kind) {
    case "fixed": return n.off === "exact" && typeof j === "string" && j in SPECIAL ? SPECIAL[j] : j;
    case "float": case "num": return typeof j === "string" && j in SPECIAL ? SPECIAL[j] : j;
    case "bytes": return bytesFrom(j);
    case "biguint": {
      if (typeof j === "number" && Number.isSafeInteger(j)) return BigInt(j);
      if (typeof j === "string" && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(j)) return BigInt(j);
      throw new CodecError(`${JSON.stringify(j)} isn't a big number ("0x" hex, decimal digits, or a safe integer).`);
    }
    case "dyn": case "const": return dynFrom(j);
    case "array": case "runs": case "delta": case "tuple": case "lz": {
      if (!Array.isArray(j)) throw new CodecError(`${JSON.stringify(j)?.slice(0, 40)} isn't an array.`);
      return j.map((x, k) => { try { return from(n.kind === "tuple" ? n.items[k] ?? n.items[0]! : n.of, x, recs); } catch (e) { throw under(e, k); } });
    }
    case "optional": return j === undefined || isNone(j) || (j === null && !takesNull(n.of)) ? undefined : from(n.of, j, recs);
    case "nullable": return j === null ? null : from(n.of, j, recs);
    case "default": return j === undefined ? structuredClone(n.value) : from(n.of, j, recs);
    case "struct": {
      if (j === null || typeof j !== "object" || Array.isArray(j)) throw new CodecError(`${JSON.stringify(j)?.slice(0, 40)} isn't an object.`);
      const rec = j as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const names = new Set<string>();
      for (const f of [...n.fields, ...n.ext.flat()]) {
        names.add(f.name);
        let x: unknown;
        try { x = from(f.type, rec[f.name], recs); } catch (e) { throw under(e, f.name); }
        if (x !== undefined) put(out, f.name, x);
      }
      for (const k of Object.keys(rec)) if (!names.has(k)) put(out, k, rec[k]);
      return out;
    }
    case "union": {
      if (j === null || typeof j !== "object") throw new CodecError(`${JSON.stringify(j)?.slice(0, 40)} isn't an object.`);
      const tag = (j as Record<string, unknown>)[n.tag];
      const variant = n.variants.find((x) => x.name === tag);
      if (!variant) throw new CodecError(`${n.tag} ${JSON.stringify(tag)} is not one of ${n.variants.map((x) => x.name).join(", ")}.`);
      let body: Record<string, unknown>;
      try { body = from(variant.type, j, recs) as Record<string, unknown>; } catch (e) { throw under(e, `${n.tag}(${String(tag)})`); }
      return { ...body, [n.tag]: tag };
    }
    case "alt": {
      // (By the JSON's own kind, first branch first: an alt of two string-shaped types is ambiguous here.)
      const b = n.of.find((x) => jsonFits(x, j));
      if (!b) throw new CodecError(`${JSON.stringify(j)?.slice(0, 40)} fits none of this alt's branches.`);
      return from(b, j, recs);
    }
    case "map": {
      if (j === null || typeof j !== "object" || Array.isArray(j)) throw new CodecError(`${JSON.stringify(j)?.slice(0, 40)} isn't an object.`);
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(j)) { try { put(out, k, from(n.value, x, recs)); } catch (e) { throw under(e, k); } }
      return out;
    }
    case "named": return from(n.of, j, recs);
    case "rec": return from(n.of, j, [...recs, n]);
    case "self": return from(recs[recs.length - 1 - n.depth]!, j, recs.slice(0, recs.length - 1 - n.depth));
    default: return j;
  }
}

/** The value in its readable JSON form (lossless: fromJSON gives it back). */
export function toJSON<S extends Type<unknown>>(schema: S, value: Infer<S>, opts: JsonOptions = {}): Json {
  return to(schema as unknown as Node, value, [], opts);
}

/** A value from its JSON form, checked against the schema (the error says which field and why). */
export function fromJSON<S extends Type<unknown>>(schema: S, json: unknown): Infer<S> {
  const v = from(schema as unknown as Node, json, []);
  validate(schema, v);
  return v as Infer<S>;
}

/** One value's JSON view without its schema's context (explain's leaves). */
export const leafJSON = (n: Node, v: unknown): Json => to(n, v, [], {});
