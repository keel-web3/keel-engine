// Documents: a value's bits behind a tiny header that says what schema wrote
// them, and the registry that resolves it.
//
//   header "id"    0xB1 · the schema id's first 4 bytes · body       (5 bytes of header)
//   header "self"  0xB2 · schema length (LEB128) · the schema's bytes · body
//   header "none"  the body alone (encodeRaw)
//
// The body starts on a byte and ends zero-padded to one. decode(schema, bytes)
// checks the header names this schema -- or, when it names another one the
// registry knows (or carries it), that the reader can read it (evolve.ts).
// readDocument(bytes) needs no schema at all: the header's schema comes from
// the document itself or the registry, so a generic tool decodes anything.

import { BitReader, BitWriter } from "./bits.ts";
import { decodeSchema, encodeSchema, schemaId, schemaName, shortId } from "./canonical.ts";
import { CodecError, finishReading, readValue, writeValue } from "./codec.ts";
import type { DecodeOptions, EncodeOptions } from "./codec.ts";
import { compatibility } from "./evolve.ts";
import type { Infer, Type } from "./schema.ts";

export const HEADER_ID = 0xb1;
export const HEADER_SELF = 0xb2;
export type HeaderMode = "id" | "self" | "none";

// ---------------------------------------------------------------- the registry

export interface RegisteredSchema {
  readonly id: string;
  readonly short: string;
  readonly schema: Type<unknown>;
  /** Its named() name and version, when it has one. */
  readonly name: string | null;
  readonly version: number | null;
  /** Other names it was registered under ("keel/object@1"). */
  readonly aliases: readonly string[];
}

export interface Registry {
  /** Register a schema (and, optionally, a name for it); returns its id. The same schema twice is fine. */
  register(schema: Type<unknown>, alias?: string): string;
  /** By id (64 hex digits), short id (8), or a name registered with it. */
  get(key: string): RegisteredSchema | undefined;
  has(key: string): boolean;
  list(): RegisteredSchema[];
}

export function createRegistry(): Registry {
  const byId = new Map<string, RegisteredSchema>();
  const byKey = new Map<string, RegisteredSchema>();
  const reg: Registry = {
    register(schema, alias) {
      const id = schemaId(schema);
      const named = schemaName(schema);
      const have = byId.get(id);
      const aliases = new Set(have?.aliases ?? []);
      if (alias) {
        const other = byKey.get(alias);
        if (other && other.id !== id) throw new RangeError(`The name ${alias} is already schema ${other.short}.`);
        aliases.add(alias);
      }
      const entry: RegisteredSchema = { id, short: id.slice(0, 8), schema: have?.schema ?? schema, name: named?.name ?? null, version: named?.version ?? null, aliases: [...aliases] };
      const clash = byKey.get(entry.short);
      if (clash && clash.id !== id) throw new RangeError(`Two schemas share the short id ${entry.short} (${clash.id} and ${id}): a header can't tell them apart.`);
      byId.set(id, entry);
      for (const k of [id, entry.short, ...aliases, ...(named ? [`${named.name}@${named.version}`] : [])]) byKey.set(k, entry);
      return id;
    },
    get: (key) => byKey.get(key),
    has: (key) => byKey.has(key),
    list: () => [...byId.values()],
  };
  return reg;
}

/** The registry every document call uses unless given another (packs register their schemas into it at load). */
export const defaultRegistry: Registry = createRegistry();
/** registerSchema(schema) or registerSchema("keel/object@1", schema): into the default registry; returns the id. */
export function registerSchema(a: Type<unknown> | string, b?: Type<unknown>): string {
  return typeof a === "string" ? defaultRegistry.register(b!, a) : defaultRegistry.register(a);
}
/** A schema from the default registry, by id, short id or name. */
export const lookupSchema = (key: string): Type<unknown> | undefined => defaultRegistry.get(key)?.schema;

// ---------------------------------------------------------------- encode / decode

export interface DocumentEncodeOptions extends EncodeOptions {
  /** "id" (default): the schema's short id · "self": the schema itself · "none": the bare body. */
  readonly header?: HeaderMode;
}
export interface DocumentDecodeOptions extends DecodeOptions {
  /** Where to find the schema a header names, when it isn't the reader's (default: defaultRegistry). */
  readonly registry?: Registry;
}

function leb(o: BitWriter, n: number): void {
  do { const b = n % 128; n = Math.floor(n / 128); o.bits(b | (n > 0 ? 128 : 0), 8); } while (n > 0);
}
function unleb(i: BitReader): number {
  let v = 0, scale = 1;
  for (;;) {
    const b = i.bits(8);
    v += (b & 127) * scale;
    if (!(b & 128)) return v;
    scale *= 128;
    if (scale > 2 ** 49) throw new CodecError("A header length is too long.", [], i.at);
  }
}

/** A value as a document: header + bits (see the top of this file). */
export function encode<S extends Type<unknown>>(schema: S, value: Infer<S>, opts: DocumentEncodeOptions = {}): Uint8Array {
  const mode = opts.header ?? "id";
  const o = new BitWriter(512);
  if (mode === "id") {
    o.bits(HEADER_ID, 8);
    o.bits(parseInt(shortId(schema), 16) >>> 0, 32);
  } else if (mode === "self") {
    const s = encodeSchema(schema);
    o.bits(HEADER_SELF, 8);
    leb(o, s.length);
    o.bytes(s);
  }
  writeValue(o, schema, value, opts);
  return o.finish();
}

/** What a header said. */
export interface Header {
  readonly mode: HeaderMode;
  /** The short id ("id" headers) or the full id of the carried schema ("self"). */
  readonly id: string | null;
  /** The schema a "self" header carries. */
  readonly schema: Type<unknown> | null;
  /** Where the body starts (bytes). */
  readonly bodyByte: number;
}

/** Read a document's header (anything else is "none": a bare body). */
export function readHeader(bytes: Uint8Array): Header {
  const i = new BitReader(bytes);
  const tag = bytes[0];
  if (tag === HEADER_ID && bytes.length >= 5) {
    i.skip(8);
    return { mode: "id", id: i.bits(32).toString(16).padStart(8, "0"), schema: null, bodyByte: 5 };
  }
  if (tag === HEADER_SELF) {
    i.skip(8);
    const len = unleb(i);
    const start = i.at / 8;
    if (start + len > bytes.length) throw new CodecError(`The header's schema is ${len} bytes; only ${bytes.length - start} follow.`, [], i.at);
    const schema = decodeSchema(bytes.subarray(start, start + len));
    return { mode: "self", id: schemaId(schema), schema, bodyByte: start + len };
  }
  return { mode: "none", id: null, schema: null, bodyByte: 0 };
}

/** The writer's schema for a header, or null when the header doesn't say. */
function writerOf(h: Header, registry: Registry): Type<unknown> | null {
  if (h.mode === "self") return h.schema;
  if (h.mode === "id") return registry.get(h.id!)?.schema ?? null;
  return null;
}

/**
 * A document back to its value, read with `schema`. A header naming another schema is fine when the
 * reader can read it (a newer or older version under the evolution rules); otherwise it says why not.
 */
export function decode<S extends Type<unknown>>(schema: S, bytes: Uint8Array, opts: DocumentDecodeOptions = {}): Infer<S> {
  const h = readHeader(bytes);
  if (h.mode === "id" && h.id !== shortId(schema)) {
    const writer = writerOf(h, opts.registry ?? defaultRegistry);
    if (!writer) throw new CodecError(`This document was written with schema ${h.id}, not this one (${shortId(schema)}), and the registry doesn't know ${h.id}.`);
    check(writer, schema, h.id!);
  }
  if (h.mode === "self" && h.id !== schemaId(schema)) check(h.schema!, schema, h.id!.slice(0, 8));
  const i = new BitReader(bytes, h.bodyByte);
  const v = readValue(i, schema, opts);
  finishReading(i);
  return v;
}

function check(writer: Type<unknown>, reader: Type<unknown>, id: string): void {
  const c = compatibility(writer, reader);
  if (!c.ok) throw new CodecError(`This document's schema ${id} can't be read as ${shortId(reader)}: ${c.problems.join(" ")}`);
}

/** Any document, decoded with the schema its header names (carried, or from the registry): what a generic tool uses. */
export function readDocument(bytes: Uint8Array, opts: DocumentDecodeOptions = {}): { readonly schema: Type<unknown>; readonly id: string; readonly header: Header; readonly value: unknown } {
  const h = readHeader(bytes);
  const schema = writerOf(h, opts.registry ?? defaultRegistry);
  if (!schema) throw new CodecError(h.mode === "none" ? "This data has no header: say which schema it is (decodeRaw)." : `Schema ${h.id} isn't in the registry (ask the pack that wrote it, or write documents with header "self").`);
  const i = new BitReader(bytes, h.bodyByte);
  const value = readValue(i, schema, opts);
  finishReading(i);
  return { schema, id: schemaId(schema), header: h, value };
}

// ---------------------------------------------------------------- manifests

/** What a module's manifest lists for a schema (runtime's SchemaEntry). */
export interface SchemaEntryLike {
  readonly id: string;
  readonly hash: string;
  readonly schema?: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** base64url, no padding (no globals: the same on every page and in Node). */
export function toBase64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    const k = Math.min(3, b.length - i) + 1;
    for (let j = 0; j < k; j += 1) out += B64[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}
export function fromBase64(t: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < t.length; i += 4) {
    const chunk = t.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j += 1) {
      const c = j < chunk.length ? B64.indexOf(chunk[j]!) : 0;
      if (c < 0) throw new CodecError(`Not base64url: "${chunk[j]}".`);
      n = (n << 6) | c;
    }
    for (let j = 0; j < chunk.length - 1; j += 1) out.push((n >> (16 - 8 * j)) & 255);
  }
  return Uint8Array.from(out);
}

/** A schema as a manifest lists it: "name@version", its id, and (embed: true) its bytes -- defineManifest({ contents: { schemas: [...] } }). */
export function schemaEntry(schema: Type<unknown>, { embed = true }: { readonly embed?: boolean } = {}): SchemaEntryLike {
  const n = schemaName(schema);
  if (!n) throw new CodecError("A manifest's schema needs a name: wrap it in named(\"pack/thing\", ...).");
  return { id: `${n.name}@${n.version}`, hash: schemaId(schema), ...(embed ? { schema: toBase64(encodeSchema(schema)) } : {}) };
}

/**
 * Register a module's declared schemas: each embedded one from its bytes (checked against its hash), each
 * other one from `known` (the module's own exports, by id). Returns the ids registered; throws on a mismatch.
 */
export function registerEntries(entries: readonly SchemaEntryLike[], registry: Registry = defaultRegistry, known: Readonly<Record<string, Type<unknown>>> = {}): string[] {
  return entries.map((e) => {
    const schema = e.schema !== undefined ? decodeSchema(fromBase64(e.schema)) : known[e.id];
    if (!schema) throw new CodecError(`Schema ${e.id} (${e.hash.slice(0, 8)}) is declared but neither embedded nor given.`);
    const id = schemaId(schema);
    if (id !== e.hash) throw new CodecError(`Schema ${e.id}: its bytes hash to ${id.slice(0, 8)}, the manifest says ${e.hash.slice(0, 8)}.`);
    return registry.register(schema, e.id);
  });
}
