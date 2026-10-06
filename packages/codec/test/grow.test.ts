import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BitWriter, array, compatibility, decodeRaw, decodeSchema, encodeRaw, encodeSchema, explainBits, fromJSON, grow, holds, optional, ref, schemaId, struct,
  toJSON, typeText, uint, union,
} from "../src/index.ts";

// An array that outgrew its layout: a cap of 2 (a 2-bit length, so 3 is the spare code), items that gained a field.
const Item = struct({ a: uint(4), name: optional(ref("names")) });
const Item2 = struct({ a: uint(4), name: optional(ref("names")), detail: optional(uint(2)) });
const Old = array(Item, { max: 2 });
const New = grow(Old, array(Item2, { max: 5 }));

test("grow: what the base holds is written exactly as the base wrote it", () => {
  for (const v of [[], [{ a: 1 }], [{ a: 1, name: "x" }, { a: 15, name: "x" }]]) {
    assert.deepEqual(encodeRaw(New, v), encodeRaw(Old, v));
    assert.deepEqual(decodeRaw(New, encodeRaw(Old, v)), v);
  }
});

test("grow: more items, or a field the base lacks, takes the spare code and the grown layout", () => {
  for (const v of [[{ a: 1, detail: 2 }], [{ a: 1 }, { a: 2 }, { a: 3 }], [{ a: 1, name: "y", detail: 0 }, { a: 2, name: "y" }, { a: 3 }, { a: 4 }, { a: 5, detail: 1 }]]) {
    const bytes = encodeRaw(New, v);
    assert.deepEqual(decodeRaw(New, bytes), v);
    assert.throws(() => decodeRaw(Old, bytes), /items; the max is 2/);
  }
  assert.throws(() => encodeRaw(New, Array.from({ length: 6 }, () => ({ a: 1 }))), /max is 5/);
  // The spare code then the grown array's own 3-bit length: 2 + 3 bits, ahead of the items.
  const w = new BitWriter(16);
  w.bits(3, 2);
  w.bits(1, 3);
  w.bits(7, 4);
  w.bool(false);
  w.bool(true);
  w.bits(1, 2);
  const body = w.finish();
  assert.deepEqual(encodeRaw(New, [{ a: 7, detail: 1 }]).subarray(1), body);
});

test("grow: the grown layout of a value the base holds is not canonical", () => {
  const w = new BitWriter(16);
  w.bits(3, 2);
  w.bits(1, 3);
  w.bits(7, 4);
  w.bool(false);
  w.bool(false);
  const bytes = new Uint8Array([0, ...w.finish()]);
  assert.throws(() => decodeRaw(New, bytes), /not canonical/);
});

test("grow: a schema like any other (bytes, id, evolution, JSON view, the bit inspector)", () => {
  const back = decodeSchema(encodeSchema(New));
  assert.equal(schemaId(back), schemaId(New));
  assert.deepEqual(decodeRaw(back, encodeRaw(New, [{ a: 1, detail: 1 }])), [{ a: 1, detail: 1 }]);
  assert.ok(compatibility(Old, New).ok);
  const down = compatibility(New, Old);
  assert.ok(down.ok);
  assert.equal(down.warnings.length, 1);
  assert.ok(!compatibility(array(Item, { max: 3 }), New).ok);
  const v = [{ a: 1, name: "q", detail: 2 }, { a: 2 }];
  assert.deepEqual(fromJSON(New, toJSON(New, v)), v);
  assert.match(typeText(New), /grown to/);
  assert.ok(explainBits(encodeRaw(New, v), { schema: New, raw: true }));
  assert.ok(explainBits(encodeRaw(New, [{ a: 1 }]), { schema: New, raw: true }));
  // Grown again later: the grown layout is itself the base of the next growth.
  const Newer = grow(Old, grow(array(Item2, { max: 5 }), array(Item2, { max: 40 })));
  for (const x of [[{ a: 1 }], v, Array.from({ length: 20 }, (_, i) => ({ a: i % 16 }))]) assert.deepEqual(decodeRaw(Newer, encodeRaw(Newer, x)), x);
  assert.deepEqual(encodeRaw(Newer, v), encodeRaw(New, v));
  assert.ok(compatibility(New, Newer).ok);
});

test("grow: refused where there is no spare length code", () => {
  assert.throws(() => grow(array(uint(2), { max: 3 }), array(uint(2), { max: 9 })), /no spare length code/);
  assert.throws(() => grow(array(uint(2)), array(uint(2), { max: 9 })), /base array with a max/);
  assert.throws(() => grow(array(uint(2), { length: 2 }), array(uint(2), { max: 9 })), /base array with a max/);
  assert.throws(() => grow(array(uint(2), { max: 2 }), uint(2) as never), /grows into an array/);
});

test("holds: shape only -- lengths and fields", () => {
  const U = union("kind", { a: struct({ x: uint(2) }), b: struct({ y: uint(2) }) });
  assert.equal(holds(array(U, { max: 2 }), [{ kind: "a", x: 1 }, { kind: "b", y: 1 }]), true);
  assert.equal(holds(array(U, { max: 2 }), [{ kind: "a", x: 1, y: 1 }]), false);
  assert.equal(holds(array(U, { max: 1 }), [{ kind: "a", x: 1 }, { kind: "a", x: 1 }]), false);
  assert.equal(holds(Item, { a: 1, name: undefined }), true);
  assert.equal(holds(Item, { a: 99 }), true, "a range is the writer's to refuse");
});
