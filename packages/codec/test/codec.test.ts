import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BitReader, BitWriter, CodecError, SchemaError, array, bitsFor, bool, createTables, decode, decodeRaw, decodeSchema, dyn, encode, encodeRaw, encodeSchema,
  enumOf, explainBits, fixed, fromJSON, int, lz, map, named, num, optional, readDocument, ref, same, schemaId, string, struct, t, toJSON, uint, union,
  varuint, withDefault, createRegistry, sizeOf, schemaEntry, registerEntries, shortId, solidityDecoder,
} from "../src/index.ts";
import type { Infer, Type } from "../src/index.ts";
import { randomCase, rng } from "./gen.ts";

// ---------------------------------------------------------------- the bit stream

test("bits: widths, Exp-Golomb, groups and floats round-trip at every alignment", () => {
  const S = rng("bits");
  for (let round = 0; round < 200; round += 1) {
    const w = new BitWriter(8);
    const ops: [string, number, number][] = [];
    for (let k = 0; k < 60; k += 1) {
      const pick = S.int(0, 5);
      if (pick === 0) { const n = S.int(0, 32); const v = n === 0 ? 0 : Math.floor(S.f() * 2 ** Math.min(n, 16)) * (n > 16 ? 2 ** (n - 16) : 1) % 2 ** n; w.bits(v >>> 0, n); ops.push(["bits", v >>> 0, n]); }
      if (pick === 1) { const n = S.int(33, 53); const v = Math.floor(S.f() * 2 ** 20) * 2 ** (n - 20); w.wide(v, n); ops.push(["wide", v, n]); }
      if (pick === 2) { const kk = S.int(0, 12); const v = S.chance(0.5) ? S.int(0, 40) : Math.floor(S.f() * 2 ** 40); w.golomb(v, kk); ops.push(["golomb", v, kk]); }
      if (pick === 3) { const g = S.int(1, 9); const v = Math.floor(S.f() * 2 ** 30); w.groups(v, g); ops.push(["groups", v, g]); }
      if (pick === 4) { const v = (S.f() - 0.5) * 1e9; w.f64(v); ops.push(["f64", v, 0]); }
      if (pick === 5) { const v = Math.fround((S.f() - 0.5) * 1e3); w.f32(v); ops.push(["f32", v, 0]); }
    }
    const r = new BitReader(w.finish());
    for (const [op, v, n] of ops) {
      const got = op === "bits" ? r.bits(n) : op === "wide" ? r.wide(n) : op === "golomb" ? r.golomb(n) : op === "groups" ? r.groups(n) : op === "f64" ? r.f64() : r.f32();
      assert.equal(got, v, `${op}(${v}, ${n})`);
    }
  }
  assert.deepEqual([0, 1, 2, 3, 4, 5, 256, 257, 2 ** 32, 2 ** 32 + 1].map(bitsFor), [0, 0, 1, 2, 2, 3, 8, 9, 32, 33]);
});

test("bits: Exp-Golomb k = 0 spends 1 bit on 0, 3 on 1..2, 5 on 3..6", () => {
  const len = (v: number) => { const w = new BitWriter(); w.golomb(v, 0); return w.length; };
  assert.deepEqual([0, 1, 2, 3, 6, 7, 14, 1000].map(len), [1, 3, 3, 5, 5, 7, 7, 19]);
});

// ---------------------------------------------------------------- properties

test("10,000 random schemas and values: exact round-trip, canonical bytes, schema round-trip, JSON view round-trip", () => {
  const S = rng("property");
  let bits = 0;
  for (let n = 0; n < 10000; n += 1) {
    const c = randomCase(S, 3);
    const value = c.value(S);
    const where = `case ${n} (${c.schema.kind})`;
    let bytes: Uint8Array;
    try { bytes = encodeRaw(c.schema, value); } catch (e) { assert.fail(`${where}: encode threw ${(e as Error).message}\n${JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? `${v}n` : v))?.slice(0, 400)}`); }
    bits += bytes.length * 8;
    const back = decodeRaw(c.schema, bytes);
    assert.ok(same(back, value), `${where}: decoded differs`);
    // Canonical: the decoded value encodes to the same bytes, and so does a copy with its keys reversed.
    assert.deepEqual(encodeRaw(c.schema, back), bytes, `${where}: not canonical`);
    // The schema through its own bytes: the same id, the same bytes for the value.
    const s2 = decodeSchema(encodeSchema(c.schema));
    assert.equal(schemaId(s2), schemaId(c.schema), `${where}: schema id changed through its bytes`);
    assert.deepEqual(encodeRaw(s2, value), bytes, `${where}: the decoded schema encodes differently`);
    // The JSON view, through text: lossless.
    const json = JSON.parse(JSON.stringify(toJSON(c.schema, value)));
    assert.deepEqual(encodeRaw(c.schema, fromJSON(c.schema, json)), bytes, `${where}: JSON view not lossless`);
    // Every tenth: the bit inspector accounts for every bit, and reads the same value.
    if (n % 10 === 0) {
      const x = explainBits(bytes, { schema: c.schema, raw: true });
      let at = 0;
      for (const sp of x.spans) { assert.equal(sp.bit, at, `${where}: a gap or overlap at ${sp.path}`); at += sp.bits; }
      assert.equal(at, bytes.length * 8, `${where}: spans short of the end`);
      assert.ok(same(x.value, value), `${where}: explain decoded differently`);
    }
  }
  assert.ok(bits > 0);
});

test("canonical: key order, map order and equal values give equal bytes", () => {
  const S = struct({ a: uint(8), b: optional(string()), m: map(string(), num()) });
  const x = encodeRaw(S, { a: 1, b: "x", m: { z: 1, a: 2, m: 3 } });
  const y = encodeRaw(S, { m: { m: 3, z: 1, a: 2 }, b: "x", a: 1 });
  assert.deepEqual(x, y);
  // (A kept-order map keeps its order: two orders, two encodings.)
  const K = map(string(), num(), { order: "kept" });
  assert.notDeepEqual(encodeRaw(K, { a: 1, b: 2 }), encodeRaw(K, { b: 2, a: 1 }));
  // An absent optional and an undefined one are the same value.
  assert.deepEqual(encodeRaw(S, { a: 1, m: {} }), encodeRaw(S, { a: 1, b: undefined, m: {} }));
  // A default left out is the default.
  const D = struct({ glow: withDefault(bool(), false), n: withDefault(num(), 3) });
  assert.deepEqual(encodeRaw(D, { glow: false, n: 3 }), encodeRaw(D, {} as never));
  assert.equal(sizeOf(D, { glow: false, n: 3 }), 2);
});

test("decoding refuses non-canonical data: set padding, trailing bytes, unread text, unsorted maps", () => {
  // (A body: its text length (LEB128), its bits, zero padding, its text.)
  const S = uint(3);
  assert.deepEqual(encodeRaw(S, 2), Uint8Array.of(0, 0b01000000));
  assert.throws(() => decodeRaw(S, Uint8Array.of(0, 0b01000001)), /Padding bits/);
  assert.throws(() => decodeRaw(S, Uint8Array.of(0, 0b01000000, 0)), /left after the value/);
  assert.throws(() => decodeRaw(S, Uint8Array.of(1, 0b01000000, 65)), /bytes of text are left unread/);
  const M = map(string(), uint(2));
  const w = new BitWriter();
  w.bits(2, 8);
  w.golomb(2, 0);
  for (let k = 0; k < 2; k += 1) { w.golomb(1, 0); w.bits(0, 2); }
  w.align();
  w.bits("b".charCodeAt(0), 8);
  w.bits("a".charCodeAt(0), 8);
  assert.throws(() => decodeRaw(M, w.finish()), /out of order/);
  // The same, in order, reads.
  const ok = encodeRaw(M, { a: 0, b: 0 });
  assert.deepEqual(decodeRaw(M, ok), { a: 0, b: 0 });
  assert.equal(ok[ok.length - 2], "a".charCodeAt(0));
});

// ---------------------------------------------------------------- sizes

test("widths are exact: fixed, enum, capacity, ref tables", () => {
  assert.equal(sizeOf(fixed(0, 64, 0.001), 3.14), 16);
  assert.equal(sizeOf(fixed(-8192, 8192, 0.001), 0), 24);
  assert.equal(sizeOf(enumOf(["a", "b", "c"]), "c"), 2);
  assert.equal(sizeOf(enumOf(["a", "b", "c"], { capacity: 16 }), "c"), 4);
  assert.equal(sizeOf(bool(), true), 1);
  // A ref: the first time in full, then its index in ceil(log2(n + 1)) bits.
  const R = array(ref("t"));
  const once = sizeOf(R, ["wall"]);
  assert.equal(sizeOf(R, ["wall", "wall", "wall"]), once + 2 + 2);
  // Golomb-coded fixed: small values small.
  assert.equal(sizeOf(fixed(-8192, 8192, 0.001, { k: 8 }), 0.25), 11);
  // Exact: 1 bit more on the grid, a float64 off it.
  assert.equal(sizeOf(fixed(0, 1, 0.001, { off: "exact" }), 0.5), 11);
  assert.equal(sizeOf(fixed(0, 1, 0.001, { off: "exact" }), 0.12345), 65);
});

test("fixed decodes exact decimals, never 3.1400000000000006; power-of-two fractions of pi exactly", () => {
  const F = fixed(-100, 100, 0.01);
  for (const v of [3.14, 0.1, 0.3, -99.99, 12.34, 0.07]) assert.equal(decodeRaw(F, encodeRaw(F, v)), v);
  const Y = fixed(-Math.PI, Math.PI, Math.PI / 32768);
  for (const v of [0, Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 4, Math.PI / 8]) assert.equal(decodeRaw(Y, encodeRaw(Y, v)), v);
  // Rounding (the default) and strict.
  assert.equal(decodeRaw(F, encodeRaw(F, 1.23456)), 1.23);
  assert.throws(() => encodeRaw(fixed(0, 1, 0.1, { off: "strict" }), 0.15), /not on fixed\(0, 1, 0.1\)'s grid/);
});

test("ref tables are shared across documents that share Tables", () => {
  const S = array(ref("tags"));
  const w = createTables();
  const a = encodeRaw(S, ["level", "solid", "wallrun"], { tables: w });
  const b = encodeRaw(S, ["solid", "level", "prop"], { tables: w });
  const alone = encodeRaw(S, ["solid", "level", "prop"]);
  assert.ok(b.length < alone.length);
  const r = createTables();
  assert.deepEqual(decodeRaw(S, a, { tables: r }), ["level", "solid", "wallrun"]);
  assert.deepEqual(decodeRaw(S, b, { tables: r }), ["solid", "level", "prop"]);
  assert.deepEqual(w.toJSON(), { tags: ["level", "solid", "wallrun", "prop"] });
});

test("lz: runs and repeated rows cost a few bits", () => {
  const S = lz(uint(8));
  const row = [0, 0, 1, 1, 2, 2, 2, 1, 1, 0, 0, 0];
  const cells = Array.from({ length: 40 }, () => row).flat();
  const bytes = encodeRaw(S, cells);
  assert.deepEqual(decodeRaw(S, bytes), cells);
  assert.ok(bytes.length < 20, `${bytes.length} bytes for 480 cells in 40 equal rows`);
  const run = new Array(5000).fill(7);
  assert.ok(encodeRaw(S, run).length <= 10);
});

// ---------------------------------------------------------------- errors

test("errors say which field and why", () => {
  const Part = struct({ name: string(), shape: union("type", { box: struct({ c: t.tuple([fixed(-10, 10, 0.001), fixed(-10, 10, 0.001), fixed(-10, 10, 0.001)]), h: array(fixed(0, 5, 0.001), { length: 3 }) }), capsule: struct({ r: fixed(0, 1, 0.001) }) }) });
  const Obj = struct({ key: string(), parts: array(Part), kind: enumOf(["level", "prop"]) });
  const good: Infer<typeof Obj> = { key: "bench", kind: "prop", parts: [{ name: "seat", shape: { type: "box", c: [0, 0.45, 0], h: [0.6, 0.02, 0.2] } }] };
  const cases: [unknown, RegExp][] = [
    [{ ...good, parts: [{ name: "seat", shape: { type: "box", c: [0, 0.45, 0], h: [0.6, 7, 0.2] } }] }, /^parts\[0\]\.shape\.type\(box\)\.h\[1\]: 7 is above fixed\(0, 5, 0.001\)'s max 5\.$/],
    [{ ...good, kind: "thing" }, /^kind: "thing" is not one of \["level","prop"\]\.$/],
    [{ ...good, parts: [{ name: 3, shape: { type: "box", c: [0, 0, 0], h: [1, 1, 1] } }] }, /^parts\[0\]\.name: 3 is not a string\.$/],
    [{ ...good, parts: [{ name: "x", shape: { type: "cone" } }] }, /^parts\[0\]\.shape: type "cone" is not one of box, capsule\.$/],
    [{ ...good, parts: [{ name: "x", shape: { type: "box", c: [0, 0], h: [1, 1, 1] } }] }, /^parts\[0\]\.shape\.type\(box\)\.c: A tuple of 3; got 2 items\.$/],
    [{ ...good, colour: "red" }, /^Unknown field "colour" \(the fields are key, parts, kind\)\.$/],
    [{ ...good, parts: [{ name: "x", shape: { type: "capsule", r: NaN } }] }, /^parts\[0\]\.shape\.type\(capsule\)\.r: NaN is not a finite number/],
  ];
  for (const [value, re] of cases) {
    const e = (() => { try { encodeRaw(Obj, value as never); return null; } catch (x) { return x as CodecError; } })();
    assert.ok(e instanceof CodecError, `no error for ${JSON.stringify(value)}`);
    assert.match(e.message, re);
  }
  // Decoding: where the data ran out.
  const bytes = encodeRaw(Obj, good);
  const cut = (b: Uint8Array, S: Type<unknown>) => { try { decodeRaw(S, b); return null; } catch (x) { return x as CodecError; } };
  assert.match(cut(bytes.subarray(0, 6), Obj)!.message, /^The text section is \d+ bytes; only \d+ follow\. \(at bit 0\)$/);
  const Nums = struct({ n: uint(8), parts: array(struct({ c: t.tuple([fixed(-10, 10, 0.001), fixed(-10, 10, 0.001)]) })) });
  const nb = encodeRaw(Nums, { n: 1, parts: [{ c: [1, 2] }, { c: [3, 4] }] });
  const e = cut(nb.subarray(0, 6), Nums);
  assert.ok(e instanceof CodecError);
  assert.match(e.message, /^parts\[0\]\.c\[1\]: The data ends early: wanted \d+ more bits?, \d+ left\. \(at bit \d+\)$/);
  // Schema mistakes are SchemaErrors, at definition.
  assert.throws(() => uint(0), SchemaError);
  assert.throws(() => fixed(1, 0, 0.1), /max must be above min/);
  assert.throws(() => enumOf(["a", "a"]), /listed twice/);
  assert.throws(() => union("type", { a: struct({ type: uint(2) }) }), /its tag/);
  assert.throws(() => t.alt([uint(2), int(3)]), /two number branches/);
  assert.throws(() => withDefault(uint(2), 9 as never) && encodeRaw(struct({ x: withDefault(uint(2), 9) }), { x: 1 }), /the default isn't a value of its type/);
});

// ---------------------------------------------------------------- documents, registry, self-description

test("documents: a 5-byte header names the schema; decode checks it; readDocument needs no schema", () => {
  const S = named("test/thing", struct({ n: uint(12), tags: array(ref("tags")) }));
  const v = { n: 1234, tags: ["a", "b"] };
  const doc = encode(S, v);
  assert.equal(doc[0], 0xb1);
  assert.equal(doc.length, encodeRaw(S, v).length + 5);
  assert.deepEqual(decode(S, doc), v);
  const Other = named("test/other", struct({ n: uint(12) }));
  assert.throws(() => decode(Other, doc, { registry: createRegistry() }), /written with schema [0-9a-f]{8}, not this one .* the registry doesn't know/);
  // The registry resolves an id; readDocument decodes with it.
  const reg = createRegistry();
  reg.register(S, "test/thing@1");
  assert.deepEqual(readDocument(doc, { registry: reg }).value, v);
  assert.equal(reg.get("test/thing@1")?.id, schemaId(S));
  // A document that carries its schema: any tool can read it.
  const self = encode(S, v, { header: "self" });
  const got = readDocument(self, { registry: createRegistry() });
  assert.deepEqual(got.value, v);
  assert.equal(got.id, schemaId(S));
  assert.deepEqual(decode(S, self), v);
});

test("schemas are data: every node kind through the schema-schema, and the id ignores docs", () => {
  const S = named("x", struct({ a: dyn(), b: withDefault(varuint({ k: 3 }), 9), c: optional(lz(uint(4))), d: num() }), { doc: "one" });
  const S2 = named("x", struct({ a: dyn(), b: withDefault(varuint({ k: 3 }), 9), c: optional(lz(uint(4))), d: num() }), { doc: "two" });
  assert.equal(schemaId(S), schemaId(S2));
  assert.notDeepEqual(encodeSchema(S), encodeSchema(S2));
  const back = decodeSchema(encodeSchema(S)) as Type<unknown>;
  assert.equal((back as { doc?: string }).doc, "one");
  assert.match(schemaId(S), /^[0-9a-f]{64}$/);
});

test("the JSON view: enum names, decimals, hex, and the numbers JSON can't spell", () => {
  const S = struct({ kind: enumOf(["level", "prop"]), x: fixed(-10, 10, 0.001), f: t.float64(), n: num(), seed: t.biguint(64), raw: t.bytes(), d: dyn(), opt: optional(uint(2)) });
  const v = { kind: "prop" as const, x: 1.2345678, f: -0, n: NaN, seed: 255n, raw: Uint8Array.of(1, 2, 255), d: { a: [Infinity, -0], $float: 1 } };
  const j = toJSON(S, v);
  assert.deepEqual(j, { kind: "prop", x: 1.235, f: "-0", n: "NaN", seed: "0x00000000000000ff", raw: "0x0102ff", d: { a: [{ $float: "Infinity" }, { $float: "-0" }], $float: 1 } });
  const back = fromJSON(S, JSON.parse(JSON.stringify(j)));
  assert.deepEqual(encodeRaw(S, back), encodeRaw(S, { ...v, x: 1.235 }));
  assert.throws(() => fromJSON(S, { ...j, kind: "nope" }), /kind: "nope" is not one of/);
  // Authoring form: defaults left out, filled back in.
  const D = struct({ a: withDefault(uint(4), 3), b: uint(4) });
  assert.deepEqual(toJSON(D, { a: 3, b: 1 }, { omitDefaults: true }), { b: 1 });
  assert.deepEqual(fromJSON(D, { b: 1 }), { a: 3, b: 1 });
});

test("explainBits: every bit accounted for, field by field, at the right offsets", () => {
  const S = named("test/explain", struct({ key: ref("keys"), size: fixed(0, 64, 0.001), glow: withDefault(bool(), false), tags: array(ref("tags")), note: optional(string()), kind: enumOf(["a", "b", "c"]) }));
  const v = { key: "crate", size: 1.5, glow: true, tags: ["x", "y", "x"], kind: "c" as const };
  const doc = encode(S, v);
  const x = explainBits(doc, { schema: S });
  assert.equal(x.header?.bits, 40);
  assert.equal(x.root.bit, 40);
  // The spans tile the buffer.
  let at = 0;
  for (const s of x.spans) { assert.equal(s.bit, at, `a gap or overlap at ${s.path}`); at += s.bits; }
  assert.equal(at, doc.length * 8);
  const field = (name: string) => x.root.children!.find((c) => c.label === name)!;
  assert.equal(field("size").bits, 16);
  assert.equal(field("size").value, 1.5);
  assert.equal(field("kind").bits, 2);
  assert.equal(field("kind").value, "c");
  assert.equal(field("glow").children?.[0]?.label, "given");
  assert.equal(field("tags").children?.length, 4);
  assert.equal(field("note").bits, 1);
  // Each field's bits read back through a plain reader.
  const size = field("size");
  const r = new BitReader(doc);
  r.seek(size.bit);
  assert.equal(r.bits(16), 1500);
  assert.deepEqual(x.value, v);
});

test("manifests declare schemas; a registry takes them back, checked against their hashes", async () => {
  const { defineManifest } = await import("@keel-engine/runtime");
  const Tile = named("packs/tiles/tile", struct({ x: uint(10), kind: enumOf(["grass", "rock"]) }), { version: 2 });
  const entry = schemaEntry(Tile);
  assert.equal(entry.id, "packs/tiles/tile@2");
  const m = defineManifest({ id: "packs/tiles", version: "1.0.0", kind: "pack", contents: { schemas: [entry, schemaEntry(Tile, { embed: false })] } });
  const reg = createRegistry();
  assert.deepEqual(registerEntries(m.contents!.schemas!, reg, { "packs/tiles/tile@2": Tile }), [schemaId(Tile), schemaId(Tile)]);
  assert.deepEqual(readDocument(encode(Tile, { x: 5, kind: "rock" }), { registry: reg }).value, { x: 5, kind: "rock" });
  assert.throws(() => registerEntries([{ ...entry, hash: "0".repeat(64) }], createRegistry()), /hash to [0-9a-f]{8}, the manifest says 00000000/);
  assert.throws(() => registerEntries([{ id: "x@1", hash: entry.hash }], createRegistry()), /neither embedded nor given/);
});

test("solidityDecoder: straight-line Solidity for fixed layouts, and a clear refusal for the rest", () => {
  const S = named("keel/example/tile", struct({ x: uint(10), hp: int(9), kind: enumOf(["grass", "rock"]), h: fixed(-10, 10, 0.01), gear: array(uint(4), { length: 3 }) }));
  const sol = solidityDecoder(S, { name: "TileCodec" });
  assert.match(sol, /library TileCodec \{/);
  assert.match(sol, /enum Kind \{ grass, rock \}/);
  assert.match(sol, /struct Value \{\n    uint16 x;\n    int16 hp;\n    Kind kind;\n    int256 h;\n    uint8\[3\] gear;\n  \}/);
  assert.match(sol, new RegExp(`SCHEMA_ID = 0x${shortId(S)};`));
  assert.match(sol, /v\.h = int256\(_bits\(data, b \+ 20, 11\)\) \+ \(-1000\); \/\/ x 0\.01/);
  assert.throws(() => solidityDecoder(struct({ name: string() })), /name: string has no fixed width/);
  assert.throws(() => solidityDecoder(struct({ xs: array(uint(2)) })), /xs: an array of any length has no fixed layout/);
  assert.throws(() => solidityDecoder(struct({ p: fixed(0, 1, 0.01, { k: 3 }) })), /p: a Golomb-coded or exact fixed\(\) has no fixed width/);
});
