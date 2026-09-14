import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CodecError, array, compatibility, createRegistry, decode, decodeRaw, encode, encodeRaw, enumOf, explainBits, extend, fixed, named, nodeAtBit, optional, ref,
  string, struct, uint, union, withDefault, costs,
} from "../src/index.ts";

// Version 1 of a record, open for growth; version 2 adds a group; version 3 another.
const V1 = struct({ name: string(), hp: uint(8), kind: enumOf(["cat", "dog"], { capacity: 8 }) }, { open: true });
const V2 = extend(V1, { speed: withDefault(fixed(0, 20, 0.01), 1), title: optional(string()) });
const V3 = extend(V2, { tags: withDefault(array(ref("tags")), []) });

test("evolution: an open struct costs 1 bit until it grows", () => {
  const v = { name: "rex", hp: 10, kind: "dog" as const };
  const plain = struct({ name: string(), hp: uint(8), kind: enumOf(["cat", "dog"], { capacity: 8 }) });
  const a = encodeRaw(plain, v), b = encodeRaw(V1, v);
  assert.ok(b.length - a.length <= 1);
  // A v2 writer with nothing new to say writes what v1 writes.
  assert.deepEqual(encodeRaw(V2, { ...v, speed: 1 }), b);
});

test("evolution: an old reader reads new data (skipping what it doesn't know); a new reader reads old data (filling in)", () => {
  const new3 = { name: "rex", hp: 10, kind: "dog" as const, speed: 4.5, title: "good boy", tags: ["pet", "loud"] };
  const bytes3 = encodeRaw(V3, new3);
  assert.deepEqual(decodeRaw(V1, bytes3), { name: "rex", hp: 10, kind: "dog" });
  assert.deepEqual(decodeRaw(V2, bytes3), { name: "rex", hp: 10, kind: "dog", speed: 4.5, title: "good boy" });
  assert.deepEqual(decodeRaw(V3, bytes3), new3);
  const bytes1 = encodeRaw(V1, { name: "tom", hp: 3, kind: "cat" });
  assert.deepEqual(decodeRaw(V3, bytes1), { name: "tom", hp: 3, kind: "cat", speed: 1, tags: [] });
  // Nested: an array of v3 read as v1 skips each item's groups, strings (in the text section) and all.
  const list = [new3, { ...new3, name: "fido", tags: ["pet"] }, { name: "x", hp: 1, kind: "cat" as const, speed: 1, tags: [] }];
  assert.deepEqual(decodeRaw(array(V1), encodeRaw(array(V3), list)).map((x) => x.name), ["rex", "fido", "x"]);
  // The rules agree.
  assert.ok(compatibility(V3, V1).ok);
  assert.ok(compatibility(V1, V3).ok);
});

test("evolution: an enum or union grows within its capacity; a reader meeting a value it doesn't know says so", () => {
  const E1 = enumOf(["cat", "dog"], { capacity: 8 });
  const E2 = enumOf(["cat", "dog", "fox"], { capacity: 8 });
  assert.equal(decodeRaw(E2, encodeRaw(E1, "dog")), "dog");
  assert.throws(() => decodeRaw(E1, encodeRaw(E2, "fox")), /Enum index 2 is not a value this reader knows \(it knows 2: data from a newer schema\?\)/);
  const c = compatibility(E2, E1);
  assert.ok(c.ok);
  assert.match(c.warnings[0]!, /doesn't know \("fox"\)/);
  // Without capacity, crossing a power of two changes the width: incompatible.
  const bad = compatibility(enumOf(["a", "b", "c"]), enumOf(["a", "b"]));
  assert.ok(!bad.ok);
  assert.match(bad.problems[0]!, /enum width \(bits\) 2 written, 1 read/);
  const U1 = union("type", { box: struct({ w: uint(4) }), ball: struct({ r: uint(4) }) }, { capacity: 4 });
  const U2 = union("type", { box: struct({ w: uint(4) }), ball: struct({ r: uint(4) }), cone: struct({ h: uint(4) }) }, { capacity: 4 });
  assert.deepEqual(decodeRaw(U2, encodeRaw(U1, { type: "ball", r: 3 })), { type: "ball", r: 3 });
  assert.throws(() => decodeRaw(U1, encodeRaw(U2, { type: "cone", h: 3 })), /Union tag 2 is not a variant this reader knows/);
});

test("evolution: what may not change is caught, field by field", () => {
  const A = struct({ a: uint(8), b: fixed(0, 10, 0.01), c: string() });
  const checks: [unknown, RegExp][] = [
    [struct({ a: uint(9), b: fixed(0, 10, 0.01), c: string() }), /^a: bits 8 written, 9 read\.$/],
    [struct({ a: uint(8), b: fixed(0, 10, 0.1), c: string() }), /^b: grid \[0,10,0.01\] written, \[0,10,0.1\] read\.$/],
    [struct({ a: uint(8), c: string(), b: fixed(0, 10, 0.01) }), /^\(root\): base fields \["a","b","c"\] written, \["a","c","b"\] read\.$/],
    [struct({ a: uint(8), b: fixed(0, 10, 0.01), c: ref() }), /^c: written as string, read as ref\.$/],
    [struct({ a: uint(8), b: fixed(0, 10, 0.01), c: string() }, { open: true }), /^\(root\): open false written, true read\.$/],
  ];
  for (const [reader, re] of checks) {
    const c = compatibility(A, reader as typeof A);
    assert.ok(!c.ok);
    assert.match(c.problems[0]!, re);
  }
  assert.throws(() => extend(struct({ a: uint(2) }) as never, { b: optional(uint(2)) }), /Only an open struct can be extended/);
  assert.throws(() => extend(V1, { hp2: uint(2) } as never), /must be optional\(\) or withDefault\(\)/);
});

test("documents across versions: decode() finds the writer's schema in the registry and reads it when the rules allow", () => {
  const W1 = named("test/pet", V1, { version: 1 });
  const W3 = named("test/pet", V3, { version: 3 });
  const reg = createRegistry();
  reg.register(W1);
  reg.register(W3);
  const doc3 = encode(W3, { name: "rex", hp: 10, kind: "dog", speed: 2, tags: ["a"] });
  assert.deepEqual(decode(W1, doc3, { registry: reg }), { name: "rex", hp: 10, kind: "dog" });
  const doc1 = encode(W1, { name: "tom", hp: 3, kind: "cat" });
  assert.deepEqual(decode(W3, doc1, { registry: reg }), { name: "tom", hp: 3, kind: "cat", speed: 1, tags: [] });
  const Other = named("test/pet", struct({ name: string() }), { version: 9 });
  reg.register(Other);
  assert.throws(() => decode(Other, doc1, { registry: reg }), (e: unknown) => e instanceof CodecError && /can't be read as [0-9a-f]{8}: \(root\): open true written, false read/.test(e.message));
  // A self-describing document of v3 read by v1, no registry needed.
  assert.deepEqual(decode(W1, encode(W3, { name: "a", hp: 1, kind: "cat", speed: 1, tags: [] }, { header: "self" }), { registry: createRegistry() }), { name: "a", hp: 1, kind: "cat" });
});

test("explainBits: groups, unknown groups skipped, strings' bytes in the text section, nodeAtBit and costs", () => {
  const doc = encode(V3, { name: "rex", hp: 10, kind: "dog", speed: 4.5, title: "good boy", tags: ["pet"] });
  const x = explainBits(doc, { schema: V3 });
  let at = 0;
  for (const s of x.spans) { assert.equal(s.bit, at, s.path); at += s.bits; }
  assert.equal(at, doc.length * 8);
  const text = x.spans.filter((s) => s.label === "text");
  assert.deepEqual(text.map((s) => s.value), ["rex", "good boy", "pet"]);
  assert.ok(text.every((s) => s.bit >= x.textBit));
  // Hover a byte of "good boy" in the hex view: the tree path is its field.
  const goodBoy = text[1]!;
  const hit = nodeAtBit(x, goodBoy.bit + 9);
  assert.equal(hit[hit.length - 2]?.path, "title");
  const hp = x.root.children!.find((c) => c.label === "hp")!;
  assert.deepEqual(nodeAtBit(x, hp.bit + 3).map((n) => n.label), ["", "hp"]);
  // The same bytes through an old reader: the groups it doesn't know are named and skipped.
  const old = explainBits(doc, { schema: V1, raw: false, registry: createRegistry() });
  assert.ok(old.spans.some((s) => s.label.includes("(unknown)")));
  assert.ok(costs(x).some((c) => c.path === "title#text"));
});
