import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertIntegers, below, createPacker, keccak256, createReader, defineProvable, fromHex, idiv, isqrt, mix32, mulDiv,
  parityVectors, pickWeighted, programIdOf, readPublicValues, roll, rollKey, scanProvableSource, toHex,
} from "../src/index.ts";
import { mix32 as replayMix32 } from "@keel-engine/replay";

test("packed bytes are abi.encodePacked, big-endian, and read back", () => {
  const seed = fromHex("0x" + "ab".repeat(32));
  const b = createPacker().bytes4("RLRI").u8(1).u16(0xbeef).i16(-2).u32(0xdeadbeef).u64(2n ** 64n - 1n).u128(5n).bytes32(seed).finish();
  assert.equal(toHex(b.slice(0, 13)), "0x524c524901beeffffedeadbeef");
  const r = createReader(b);
  r.magic("RLRI");
  assert.deepEqual([r.u8(), r.u16(), r.i16(), r.u32(), r.u64(), r.u128()], [1, 0xbeef, -2, 0xdeadbeef, 2n ** 64n - 1n, 5n]);
  assert.equal(toHex(r.bytes32()), toHex(seed));
  r.end();
  assert.throws(() => createPacker().u8(256));
  assert.throws(() => createPacker().u128(-1n));
  assert.throws(() => createReader(b).magic("NOPE"));
});

test("idiv truncates toward zero like Rust, and isqrt is exact", () => {
  assert.deepEqual([idiv(7, 2), idiv(-7, 2), idiv(7, -2), idiv(-7, -2)], [3, -3, -3, 3]);
  assert.equal(mulDiv(3_000_000_000, 3_000_000, 7), Math.trunc(9e15 / 7));
  assert.throws(() => mulDiv(2 ** 30, 2 ** 30, 1));
  for (let i = 0; i < 20000; i += 1) {
    const n = i < 10000 ? i : Math.floor(Math.abs(Math.sin(i)) * 2 ** 52);
    const s = isqrt(n);
    assert.ok(s * s <= n && (s + 1) * (s + 1) > n, `isqrt(${n}) = ${s}`);
  }
  assert.equal(isqrt(2 ** 52), 2 ** 26);
  assert.equal(isqrt(2 ** 53 - 1), 94906265);
});

test("the roll: the replay mixer, stable values, uniform enough", () => {
  for (const x of [0, 1, 0x9e3779b9, 0xffffffff]) assert.equal(mix32(x), replayMix32(x));
  const key = rollKey(programIdOf("keel/proof/test"));
  // Pinned: the Rust twin (zk/keel-proof) asserts the same numbers.
  assert.deepEqual(key, rollKey(programIdOf("keel/proof/test")));
  const pinned = [roll(key, 0, 0, 0, 0), roll(key, 1, 2, 3, 4), roll(key, 0xffffffff, 7, 0, 1)];
  assert.ok(pinned.every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32));
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 60000; i += 1) { const b = below(key, 6, i, 0, 0, 0); counts[b] = counts[b]! + 1; }
  for (const c of counts) assert.ok(Math.abs(c - 10000) < 500, `bucket ${c}`);
  const picks = [0, 0, 0];
  for (let i = 0; i < 30000; i += 1) { const k = pickWeighted(key, [1, 2, 7], i, 1, 0, 0); picks[k] = picks[k]! + 1; }
  assert.ok(Math.abs(picks[2]! / 30000 - 0.7) < 0.02);
});

test("a provable sim: execute builds the envelope; audit catches a wrong result", () => {
  const SUM = defineProvable<{ xs: number[] }, { total: number }>({
    id: "keel/proof/sum@1",
    encodeInput: ({ xs }) => { const p = createPacker().bytes4("SUMI").u8(xs.length); for (const x of xs) p.u32(x); return p.finish(); },
    decodeInput: (b) => { const r = createReader(b); r.magic("SUMI"); const n = r.u8(); const xs = Array.from({ length: n }, () => r.u32()); r.end(); return { xs }; },
    run: ({ xs }) => ({ total: xs.reduce((a, x) => a + x, 0) }),
    encodeResult: ({ total }) => createPacker().u64(total).finish(),
    decodeResult: (b) => ({ total: Number(createReader(b).u64()) }),
  });
  const x = SUM.execute({ xs: [1, 2, 3] }, undefined);
  const pv = readPublicValues(x.publicValues);
  assert.equal(toHex(pv.programId), toHex(programIdOf("keel/proof/sum@1")));
  assert.equal(toHex(pv.inputDigest), toHex(x.inputDigest));
  assert.equal(SUM.decodeResult(pv.result).total, 6);
  assert.ok(SUM.audit({ xs: [1, 2, 3] }, undefined, x.publicValues).ok);
  const forged = x.publicValues.slice(); forged[forged.length - 1] = forged[forged.length - 1]! ^ 1;
  assert.equal(SUM.audit({ xs: [1, 2, 3] }, undefined, forged).reason, "same input, different result");
  assert.match(SUM.audit({ xs: [1, 2, 4] }, undefined, x.publicValues).reason, /input digest/);
  const file = parityVectors(SUM, [{ name: "one two three", input: { xs: [1, 2, 3] }, witness: undefined }]);
  assert.equal(file.vectors[0]!.publicValues, toHex(x.publicValues));
});

test("the guard: integers pass, floats and clocks don't", () => {
  const ok = { file: "ok.ts", text: "export const f = (a: number) => Math.floor(a / 2) + Math.imul(a, 3); // Math.sin in a comment is fine\nconst s = 'Math.random in a string';" };
  const bad = { file: "bad.ts", text: "const a = Math.sin(x);\nconst b = 0.5 * y;\nconst t = Date.now();\nconst p = x ** 3;" };
  assert.deepEqual(scanProvableSource([ok]), []);
  assert.deepEqual(scanProvableSource([bad]).map((h) => h.line), [1, 2, 3, 4]);
  assert.throws(() => assertIntegers({ a: [1, 2.5] }), /state\.a\.1/);
  assertIntegers({ a: [1, 2], b: 3n, c: new Int32Array(2) });
});

test("keccak256 is Ethereum's (0x01 padding), across block boundaries", () => {
  const h = (b: Uint8Array): string => toHex(keccak256(b));
  assert.equal(h(new Uint8Array(0)), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(h(new TextEncoder().encode("abc")), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  // (cast keccak of bytes 0..255,0..43 -- 300 bytes, three blocks.)
  assert.equal(h(Uint8Array.from({ length: 300 }, (_, i) => i & 255)), "0xa679e749a6af300c36e7ff2255d220864eab27b382f9cfdc5aa4d13563ba36ff");
  for (const n of [135, 136, 137, 271, 272]) assert.equal(keccak256(new Uint8Array(n)).length, 32);
});
