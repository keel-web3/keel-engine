import test from "node:test";
import assert from "node:assert/strict";
import { fnv1a32, fnv1a32Signed, seedTagHash } from "../src/hash.ts";
import { createMulberry32 } from "../src/random.ts";

test("string seed contracts preserve unsigned bits, signed city seeds and UTF-16", () => {
  assert.equal(fnv1a32(""), 2166136261);
  assert.equal(fnv1a32("hello"), 0x4f9f2cab);
  for (const s of ["", "hello", "😀", "\ud800", "\0", "a|b"]) assert.equal(fnv1a32Signed(s), fnv1a32(s) | 0);
  assert.notEqual(fnv1a32("é"), fnv1a32("e\u0301"), "seed hashing does not normalize creator input");
  assert.notEqual(seedTagHash("car", "body"), seedTagHash("car", "wheel"));
});

test("checkpoint hooks replay a stream exactly; ordinary streams allocate no checkpoint hooks", () => {
  const plain = createMulberry32(0xffffffff), saved = createMulberry32(-1, true);
  assert.equal("state" in plain, false);
  for (let i = 0; i < 1000; i++) assert.equal(plain(), saved());
  const state = saved.state(), future = Array.from({ length: 32 }, () => saved());
  saved.restore(state);
  assert.deepEqual(Array.from({ length: 32 }, () => saved()), future);
  saved.restore(0x100000001);
  assert.equal(saved(), createMulberry32(1)());
});
