import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { zlibSync } from 'fflate';
import { build } from 'esbuild';
import { encodeBuffer, decodeBuffer, bufferCodecMetadataBytes, BUFFER_CODEC_MAX_BYTES } from '../src/asset-buffer-codec.ts';
import type { EncodedBuffer, BufferHints } from '../src/asset-buffer-codec.ts';
let seed = 0x1248abcd;
function random(length: number): Uint8Array { const out = new Uint8Array(length); for (let i = 0; i < length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; out[i] = seed & 255; } return out; }
function serialized(e: EncodedBuffer): string { return JSON.stringify({ codec: e.codec, parameters: e.parameters, sourceLength: e.sourceLength, candidates: e.candidates }) + ':' + Buffer.from(e.data).toString('hex'); }
function roundtrip(source: Uint8Array, hints?: BufferHints): EncodedBuffer {
  const copy = new Uint8Array(source), e = encodeBuffer(source, hints), d = decodeBuffer(e);
  assert.deepEqual(d, copy); assert.deepEqual(new Uint8Array(source), copy, 'source was mutated');
  assert.equal(serialized(e), serialized(encodeBuffer(source, hints)), 'repeated output differs');
  assert.equal(e.candidates.find(c => c.codec === e.codec)!.bytes, e.data.length + bufferCodecMetadataBytes(e));
  assert.equal(e.candidates.find(c => c.codec === e.codec)!.bytes, Math.min(...e.candidates.map(c => c.bytes)));
  return e;
}
test('empty, tiny, raw fallback, repeats, unaligned inputs and owned output', () => {
  for (const length of [0, 1, 2, 3, 4, 7, 255, 256, 65535]) { roundtrip(random(length)); roundtrip(new Uint8Array(length).fill(123), { stride: 4, componentBytes: 4 }); }
  assert.equal(roundtrip(random(127)).codec, 'raw');
  assert.equal(roundtrip(new Uint8Array(65536).fill(13)).codec, 'zlib');
  const storage = random(1027); roundtrip(storage.subarray(1, 1025), { stride: 16, componentBytes: 8 });
  const buffer = Buffer.from([7, 8, 9]), encoded = encodeBuffer(buffer); buffer[0] = 99; assert.equal(encoded.data[0], 7);
  const decoded = decodeBuffer(encoded); decoded[0] = 12; assert.equal(encoded.data[0], 7);
});
test('Float32 bit patterns including NaNs, negative zero, infinities and interleaved rows', () => {
  const source = new Uint8Array(24 * 4096), view = new DataView(source.buffer);
  const values = [0, 0x80000000, 0x7f800000, 0xff800000, 0x7fc00001, 0x7fa01234, 1, 0x3f800000];
  for (let row = 0; row < 4096; row++) for (let lane = 0; lane < 6; lane++) view.setUint32(row * 24 + lane * 4, lane < 2 ? values[(row + lane) % values.length]! : (row * 123 + lane) >>> 0, true);
  roundtrip(source, { stride: 24, componentBytes: 4 });
  roundtrip(source, { stride: 24, componentBytes: 8 });
});
test('independent reversal of every predictive codec and both 32/64-bit carry paths', () => {
  for (const width of [1, 2, 4, 8]) for (const stride of [width, width * 3]) {
    const source = random(stride * 111);
    for (const xor of [false, true]) for (const plane of [false, true]) {
      if (width === 1 && plane) continue;
      let transformed = new Uint8Array(source.length);
      for (let i = 0; i < source.length; i += width) {
        let current = 0n, previous = 0n;
        for (let lane = width - 1; lane >= 0; lane--) { current = current * 256n + BigInt(source[i + lane]!); previous = previous * 256n + BigInt(i < stride ? 0 : source[i - stride + lane]!); }
        const mask = (1n << BigInt(width * 8)) - 1n;
        let delta = (xor ? current ^ previous : current - previous) & mask;
        for (let lane = 0; lane < width; lane++) { transformed[i + lane] = Number(delta & 255n); delta >>= 8n; }
      }
      if (plane) { const out = new Uint8Array(source.length), words = source.length / width; for (let word = 0; word < words; word++) for (let lane = 0; lane < width; lane++) out[lane * words + word] = transformed[word * width + lane]!; transformed = out; }
      const codec = `${xor ? 'xor' : 'delta'}-${plane ? 'byteplanes-' : ''}zlib`;
      assert.deepEqual(decodeBuffer({ codec, data: zlibSync(transformed, { level: 9 }), sourceLength: source.length, parameters: { version: 1, stride, componentBytes: width }, candidates: [] }), source);
    }
    if (width > 1) { const out = new Uint8Array(source.length), words = source.length / width; for (let word = 0; word < words; word++) for (let lane = 0; lane < width; lane++) out[lane * words + word] = source[word * width + lane]!; assert.deepEqual(decodeBuffer({ codec: 'byteplanes-zlib', data: zlibSync(out), parameters: { version: 1, stride, componentBytes: width }, sourceLength: source.length, candidates: [] }), source); }
  }
});
test('exact row dictionaries and deterministic fuzz/candidate selection', () => {
  const rows = random(64 * 256), source = new Uint8Array(64 * 4096);
  for (let i = 0; i < 4096; i++) { const index = random(1)[0]!; source.set(rows.subarray(index * 64, (index + 1) * 64), i * 64); }
  const e = roundtrip(source, { stride: 64, componentBytes: 4 });
  assert(e.candidates.some(c => c.codec === 'row-dictionary-zlib'));
  for (let i = 0; i < 160; i++) { const width = [1, 2, 4, 8][i % 4]!, stride = width * (1 + i % 7), count = i * 3 % 127; let bytes = random(count * stride); if (i % 3 === 0) for (let k = stride; k < bytes.length; k++) if (k % 5) bytes[k] = bytes[k - stride]!; roundtrip(bytes, { stride, componentBytes: width }); }
  const hashes = Array.from({ length: 3 }, () => createHash('sha256').update(serialized(encodeBuffer(source, { stride: 64, componentBytes: 4 }))).digest('hex'));
  assert.equal(new Set(hashes).size, 1);
});
test('malformed metadata, truncation, checksums, invalid dictionaries and inflate bombs reject', () => {
  const valid = encodeBuffer(new Uint8Array(10000).fill(17));
  for (const sourceLength of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, BUFFER_CODEC_MAX_BYTES + 1]) assert.throws(() => decodeBuffer({ ...valid, sourceLength }));
  assert.throws(() => decodeBuffer(valid, 9999));
  assert.throws(() => decodeBuffer({ ...valid, codec: 'unknown' }));
  assert.throws(() => decodeBuffer({ ...valid, parameters: { version: 2 } }));
  assert.throws(() => decodeBuffer({ ...valid, parameters: { version: 1, extra: 1 } }));
  for (const hints of [{ stride: 0 }, { stride: -1 }, { stride: 3, componentBytes: 2 }, { componentBytes: 3 }, { stride: Infinity }]) assert.throws(() => encodeBuffer(new Uint8Array(16), hints));
  for (let i = 0; i < valid.data.length; i++) assert.throws(() => decodeBuffer({ ...valid, data: valid.data.subarray(0, i) }));
  const corrupt = new Uint8Array(valid.data); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1; assert.throws(() => decodeBuffer({ ...valid, data: corrupt }), /checksum/);
  assert.throws(() => decodeBuffer({ ...valid, sourceLength: 32 }), /exceeds/);
  const bomb = zlibSync(new Uint8Array(1024 * 1024)); assert.throws(() => decodeBuffer({ ...valid, data: bomb, sourceLength: 64 }, 64));
  const trailing = new Uint8Array(valid.data.length + 1); trailing.set(valid.data); assert.throws(() => decodeBuffer({ ...valid, data: trailing }));
  const badDictionary: EncodedBuffer = { codec: 'row-dictionary-zlib', data: zlibSync(Uint8Array.of(1, 2, 3, 4, 1)), parameters: { version: 1, stride: 4, dictionaryRows: 1, indexBytes: 1 }, sourceLength: 4, candidates: [] };
  assert.throws(() => decodeBuffer(badDictionary), /index/);
  assert.throws(() => decodeBuffer({ ...badDictionary, parameters: { ...badDictionary.parameters, dictionaryRows: 1e20 } }));
});
test('source-inferred exact Float32 affine operations win by measured cost', () => {
  const source = new Uint8Array(12 * 2048), view = new DataView(source.buffer);
  for (let row = 0; row < 2048; row++) { view.setFloat32(row * 12, Math.fround(-100 + row * 0.25), true); view.setFloat32(row * 12 + 4, Math.fround(5 + row * 2), true); view.setFloat32(row * 12 + 8, Math.fround(1 - row * 0.125), true); }
  const encoded = roundtrip(source, { stride: 12, componentBytes: 4 });
  assert.equal(encoded.codec, 'float32-runs-zlib');
  // Damage one arithmetic sample: still exact, with literal exception rows as needed.
  view.setUint32(511 * 12 + 4, view.getUint32(511 * 12 + 4, true) ^ 1, true);
  roundtrip(source, { stride: 12, componentBytes: 4 });
  // Signed zero and NaN payloads are literal/repeat data unless arithmetic proves identical.
  const special = new Uint8Array(4 * 64), specialView = new DataView(special.buffer);
  for (let row = 0; row < 64; row++) specialView.setUint32(row * 4, row < 16 ? 0x80000000 : row < 32 ? 0 : 0x7fc00042, true);
  roundtrip(special, { stride: 4, componentBytes: 4 });
});
test('procedural run bounds are validated before output expansion', () => {
  const payload = new Uint8Array(13), view = new DataView(payload.buffer); payload[0] = 2; view.setUint32(1, 0xffffffff, true);
  const record: EncodedBuffer = { codec: 'float32-runs-zlib', data: zlibSync(payload), parameters: { version: 1, stride: 4, componentBytes: 4, decodedLength: 13 }, sourceLength: 16, candidates: [] };
  assert.throws(() => decodeBuffer(record), /procedural run/);
  assert.throws(() => decodeBuffer({ ...record, parameters: { ...record.parameters, decodedLength: 1e20 } }));
});
test('multi-block/stored zlib and 16/32-bit dictionary indices', () => {
  for (const level of [0, 1, 9] as const) {
    const source = random(200000), encoded: EncodedBuffer = { codec: 'zlib', data: zlibSync(source, { level }), parameters: { version: 1 }, sourceLength: source.length, candidates: [] };
    assert.deepEqual(decodeBuffer(encoded), source);
  }
  for (const dictionaryRows of [257, 65537]) {
    const stride = 8, rows = dictionaryRows + 1, indexBytes = dictionaryRows <= 65536 ? 2 : 4;
    const payload = new Uint8Array(dictionaryRows * stride + rows * indexBytes), view = new DataView(payload.buffer), expected = new Uint8Array(rows * stride);
    for (let row = 0; row < dictionaryRows; row++) { view.setUint32(row * stride, row, true); view.setUint32(row * stride + 4, row ^ 0x87654321, true); }
    for (let row = 0; row < rows; row++) { const i = row % dictionaryRows; expected.set(payload.subarray(i * stride, i * stride + stride), row * stride); if (indexBytes === 2) view.setUint16(dictionaryRows * stride + row * indexBytes, i, true); else view.setUint32(dictionaryRows * stride + row * indexBytes, i, true); }
    assert.deepEqual(decodeBuffer({ codec: 'row-dictionary-zlib', data: zlibSync(payload), parameters: { version: 1, stride, dictionaryRows, indexBytes }, sourceLength: expected.length, candidates: [] }), expected);
  }
});

test('browser bundle and Node source produce identical recipes and bytes', async () => {
  const bundled = await build({ entryPoints: [new URL('../src/asset-buffer-codec.ts', import.meta.url).pathname], bundle: true, platform: 'browser', format: 'esm', minify: true, write: false });
  const browser = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.contents).toString('base64'));
  const source = new Uint8Array(12 * 2048), view = new DataView(source.buffer);
  for (let row = 0; row < 2048; row++) { view.setFloat32(row * 12, row * .25, true); view.setFloat32(row * 12 + 4, row * -2, true); view.setFloat32(row * 12 + 8, 5, true); }
  const node = encodeBuffer(source, { stride: 12, componentBytes: 4 });
  assert.equal(serialized(browser.encodeBuffer(source, { stride: 12, componentBytes: 4 })), serialized(node));
  assert.deepEqual(browser.decodeBuffer(node), source);
});
