import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFloat32Runs, decodeFloat32Runs } from "../src/procedural-buffer.ts";
test("exact affine rows and literal exceptions preserve IEEE754 words", () => {
  const data = new Uint8Array(12 * 2048), view = new DataView(data.buffer);
  for (let i = 0; i < 2048; i++) for (let k = 0; k < 3; k++) view.setFloat32(i * 12 + k * 4, -5 + (k + 1) * i * .125, true);
  for (const damaged of [false, true]) {
    if (damaged) view.setUint32(700 * 12, 0x80000000, true);
    const recipe = encodeFloat32Runs(data, 12)!;
    assert.ok(recipe.length < data.length / 20);
    assert.deepEqual(decodeFloat32Runs(recipe, data.length, 12), data);
  }
  assert.throws(() => decodeFloat32Runs(new Uint8Array(5), 12, 12), /run/);
  assert.throws(() => decodeFloat32Runs(new Uint8Array(), 1e12, 4), /extent/);
  assert.throws(() => encodeFloat32Runs(data, 3), /stride/);
});


test("repeated rows preserve exact special words and non-power-of-two extents", () => {
  for (const rows of [2, 3, 5, 7, 31, 257, 65535]) {
    const storage = new Uint8Array(rows * 12 + 3), source = storage.subarray(1, 1 + rows * 12), view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    for (let row = 0; row < rows; row++) { view.setUint32(row * 12, 0x80000000, true); view.setUint32(row * 12 + 4, 0x7fc01234, true); view.setUint32(row * 12 + 8, 0xffffffff, true); }
    const expected = new Uint8Array(17); expected[0] = 1; new DataView(expected.buffer).setUint32(1, rows, true); expected.set(source.subarray(0, 12), 5);
    const encoded = encodeFloat32Runs(source, 12)!;
    assert.deepEqual(encoded, expected);
    assert.deepEqual(decodeFloat32Runs(encoded, source.length, 12), source);
  }
});
test("independent affine runs retain their own steps after scratch reuse", () => {
  const source = new Uint8Array(12 * 63), view = new DataView(source.buffer);
  for (let row = 0; row < 63; row++) for (let k = 0; k < 3; k++) view.setFloat32(row * 12 + k * 4, (row < 17 ? row * .25 : row < 41 ? 200 + row * .125 : -50 + row * -2) * (k + 1), true);
  assert.deepEqual(decodeFloat32Runs(encodeFloat32Runs(source, 12)!, source.length, 12), source);
});
