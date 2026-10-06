import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeByteColumns, decodeByteColumns } from '../src/byte-columns.ts';

test('byte columns preserve complete signed, floating and index bit patterns with offsets and wraparound', () => {
  for (const stride of [1, 2, 3, 9, 16, 4096]) {
    const backing = Uint8Array.from({ length: stride * 43 + 11 }, (_, i) => (Math.imul(i, 7919) ^ (i >>> 3)) & 255);
    const bytes = backing.subarray(7, 7 + stride * 43), prior = bytes.slice();
    for (const signed of [false, true]) {
      const encoded = encodeByteColumns(bytes, stride, signed);
      assert.deepEqual(decodeByteColumns(encoded, stride, signed), bytes);
      assert.deepEqual(bytes, prior);
      assert.deepEqual(encodeByteColumns(bytes, stride, signed), encoded);
    }
  }
  assert.deepEqual(encodeByteColumns(new Uint8Array(), 9), new Uint8Array());
  assert.deepEqual(decodeByteColumns(new Uint8Array(), 9), new Uint8Array());
});

test('byte columns reject invalid sizes before allocating or interpreting a malformed record', () => {
  for (const stride of [0, -1, 1.5, NaN, Infinity, 4097]) {
    assert.throws(() => encodeByteColumns(new Uint8Array(9), stride), /Invalid byte-column/);
    assert.throws(() => decodeByteColumns(new Uint8Array(9), stride), /Invalid byte-column/);
  }
  assert.throws(() => decodeByteColumns(new Uint8Array(8), 3), /Invalid byte-column/);
  assert.throws(() => decodeByteColumns(new Uint8Array(8 * 1024 * 1024 + 1), 1), /Invalid byte-column/);
});


test('signed columns encode tiny negative steps without losing modulo wrapping', () => {
  const bytes = Uint8Array.of(0, 255, 0, 128, 127, 128);
  assert.deepEqual(encodeByteColumns(bytes, 1, true), Uint8Array.of(0, 1, 2, 255, 1, 2));
  assert.deepEqual(encodeByteColumns(bytes, 1), Uint8Array.of(0, 255, 1, 128, 255, 1));
  const transitions = new Uint8Array(256 * 256 * 2);
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
    const i = (a * 256 + b) * 2; transitions[i] = a; transitions[i + 1] = b;
  }
  assert.deepEqual(decodeByteColumns(encodeByteColumns(transitions, 1, true), 1, true), transitions);
});
