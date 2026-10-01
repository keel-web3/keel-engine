import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zlibSync } from 'fflate';
import { encodeVoxelSnapshot, replayVoxelSnapshot, VOXEL_SNAPSHOT_MAX_BYTES, VOXEL_SNAPSHOT_MAX_CUBES } from '../src/styled-voxel-codec.ts';
import type { ReplayedVoxelSnapshot, VoxelSnapshotRecipe, VoxelSnapshotFidelity } from '../src/styled-voxel-codec.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { decodeBuffer } from '../src/asset-buffer-codec.ts';
import { rebuildStyledVoxels } from '../src/styled-asset.ts';
import { crc32 } from '../src/png.ts';

function fixture(count = 1024, unique = false): ReplayedVoxelSnapshot {
  let state = 0x8ac39013;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  const colors = Array.from({ length: count * 3 }, (_, i) => unique ? random() : [0.1, 0.25, 0.625, 1, -0, 0][i % 6]!);
  return {
    version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static',
    size: [Math.max(1, count), 1, 1], origin: [-2.3, -0, 7.01], unit: 0.17,
    indices: Array.from({ length: count }, (_, i) => count - 1 - i), colors,
  };
}
function verify(input: ReplayedVoxelSnapshot) {
  const before = structuredClone(input), encoded = encodeVoxelSnapshot(input), bytes = packAsset(encoded.recipe);
  const again = encodeVoxelSnapshot(input), replay = replayVoxelSnapshot(unpackAsset(bytes));
  assert.deepEqual(input, before, 'input is not mutated');
  assert.deepEqual(packAsset(again.recipe), bytes, 'encoding is byte deterministic');
  assert.deepEqual(encoded.report, again.report);
  assert.deepEqual(replay.indices, input.indices);
  assert.deepEqual(replay.colors, input.colors.map(Math.fround));
  assert.deepEqual(replay.size, input.size); assert.deepEqual(replay.origin, input.origin); assert.equal(replay.unit, input.unit);
  assert.equal(encoded.report.serializedBytes, bytes.length);
  assert.equal(encoded.report.serializedBytes, Math.min(...encoded.report.candidates.map(c => c.serializedBytes)));
  assert.equal(encoded.report.metadataBytes + encoded.report.payloadBytes, bytes.length);
  assert.equal(encoded.report.cubeCount, input.indices.length);
  assert.equal(encoded.report.sourceSampleBytes, input.indices.length * 16);
  return { ...encoded, replay };
}
function rawPayload(recipe: VoxelSnapshotRecipe): VoxelSnapshotRecipe {
  return { ...recipe, codec: 'raw', parameters: { version: 1 }, data: decodeBuffer(recipe, VOXEL_SNAPSHOT_MAX_BYTES) };
}
function withPayload(recipe: VoxelSnapshotRecipe, mutate: (data: Uint8Array) => void): VoxelSnapshotRecipe {
  const raw = rawPayload(recipe); mutate(raw.data); raw.payloadCRC32 = crc32(raw.data); return raw;
}

test('repeated tint colors use an exact Float32 palette and count every serialized byte', () => {
  const input = fixture(4096), result = verify(input);
  assert.equal(result.recipe.encoding, 'palette-f32');
  assert.equal(result.recipe.paletteSize, 2);
  assert.equal(result.report.paletteSize, 2);
  assert.equal(result.report.exactOccupiedOrder, true);
  assert.equal(result.report.exactFloat32Colors, true);
  assert.equal(result.report.exactGridTransform, true);
  assert.equal(result.report.staticPose, true);
  assert(result.report.serializedBytes < packAsset(input).length / 4);
  assert.equal(result.report.candidates.length, 2);
  assert.equal(Object.is(result.replay.colors[4], -0), true);
});

test('arbitrary Float32 tint colors choose raw words when a palette would cost more', () => {
  const result = verify(fixture(2048, true));
  assert.equal(result.recipe.encoding, 'raw-f32');
  assert.equal(result.recipe.paletteSize, 0);
  assert.equal(result.report.paletteSize, 2048);
  const palette = result.report.candidates.find(c => c.encoding === 'palette-f32')!;
  assert(result.report.serializedBytes < palette.serializedBytes);
});

test('one cell needs no index bits, and colors use the same Float32 conversion as the GLB writer', () => {
  for (const colors of [[-0, 0, 1], [1 / 3, Number.MIN_VALUE, 1 - Number.EPSILON]]) {
    const input = { ...fixture(1), colors }, result = verify(input);
    assert.equal(result.recipe.sourceLength, 12);
    assert.deepEqual(rebuildStyledVoxels(result.replay).glb, rebuildStyledVoxels(input).glb);
  }
});

test('palette identity is based on Float32 bits, retaining signed zero and merging equal rounded doubles', () => {
  const count = 256, input = fixture(count);
  const samples = [[0, .1, .25], [-0, .1, .25], [0, Math.fround(.1), .25], [-0, Math.fround(.1), .25]];
  input.colors = Array.from({ length: count }, (_, i) => samples[i % samples.length]!).flat();
  const result = verify(input);
  assert.equal(result.report.paletteSize, 2);
  assert.equal(result.recipe.encoding, 'palette-f32');
  assert.equal(Object.is(result.replay.colors[0], 0), true);
  assert.equal(Object.is(result.replay.colors[3], -0), true);
  assert.deepEqual(rebuildStyledVoxels(result.replay).glb, rebuildStyledVoxels(input).glb);
});

test('unsorted 3D occupied order, double transforms and every reconstructed GLB byte are unchanged', () => {
  const input = fixture(8, true);
  input.size = [9, 7, 11]; input.indices = [400, 0, 692, 37, 19, 84, 15, 683];
  input.origin = [-0, -Math.PI, 1e15 + 0.5]; input.unit = Math.PI / 10;
  input.colors.splice(0, 6, -0, .3, .9, 0, 1 / 3, Number.MIN_VALUE);
  const result = verify(input), before = rebuildStyledVoxels(input), after = rebuildStyledVoxels(result.replay);
  assert.deepEqual(after.glb, before.glb);
  assert.deepEqual(after.mesh.positions, before.mesh.positions);
  assert.deepEqual(after.mesh.indices, before.mesh.indices);
  assert.deepEqual(Float32Array.from(after.mesh.colours), Float32Array.from(before.mesh.colours));
  for (const unit of [Number.MIN_VALUE, 1e-18, 1e15]) {
    const extreme = { ...input, unit };
    assert.deepEqual(rebuildStyledVoxels(replayVoxelSnapshot(encodeVoxelSnapshot(extreme).recipe)).glb, rebuildStyledVoxels(extreme).glb);
  }
});

test('source payloads and unused source arrays are omitted; only validated small pose metadata survives', () => {
  const input = {
    ...fixture(16), sourcePose: { animation: 'Walk', time: 1.25 },
    fidelity: { pose: 'static', color: 'sampled-linear-base-color', alpha: 'mask-sampled+opaque-approximation' } as VoxelSnapshotFidelity, warnings: ['Alpha was approximated'],
    occupancy: Array(16).fill(1), material: Array(16).fill(2), node: Array(16).fill(3),
    materialNames: ['source material'], nodeNames: ['source node'], options: { fill: true }, name: 'Source',
    nativeKAP: Uint8Array.of(11, 22, 33), textures: [Uint8Array.of(44, 55, 66)], geometry: { bytes: Uint8Array.of(77, 88, 99) }, rig: { joints: [0, 1] },
  };
  const result = verify(input), stored = unpackAsset(packAsset(result.recipe));
  assert.deepEqual(result.report.omittedFields, ['geometry', 'material', 'materialNames', 'name', 'nativeKAP', 'node', 'nodeNames', 'occupancy', 'options', 'rig', 'textures']);
  for (const key of result.report.omittedFields) assert.equal(Object.hasOwn(stored, key), false);
  assert.deepEqual(result.replay.sourcePose, input.sourcePose);
  assert.deepEqual(result.replay.fidelity, input.fidelity);
  assert.deepEqual(result.replay.warnings, input.warnings);
  assert.equal(result.report.retainedPoseMetadata, true);
  input.sourcePose.time = 99; input.warnings[0] = 'changed'; input.fidelity.alpha = 'opaque';
  assert.deepEqual(replayVoxelSnapshot(result.recipe).sourcePose, { animation: 'Walk', time: 1.25 });
  assert.deepEqual(replayVoxelSnapshot(result.recipe).warnings, ['Alpha was approximated']);
  result.replay.indices.fill(0); result.replay.colors.fill(0); result.replay.size[0] = 1;
  result.replay.sourcePose!.time = 77; result.replay.warnings![0] = 'edited';
  assert.deepEqual(replayVoxelSnapshot(result.recipe).sourcePose, { animation: 'Walk', time: 1.25 });
  assert.equal(replayVoxelSnapshot(result.recipe).size[0], 16);
});

test('valid serialized legacy producer input is accepted without retaining unused metadata', () => {
  const input = fixture(16, true), result = encodeVoxelSnapshot(JSON.stringify({ ...input, provenance: { license: 'MIT' } }));
  assert.deepEqual(result.report.omittedFields, ['provenance']);
  assert.deepEqual(rebuildStyledVoxels(replayVoxelSnapshot(result.recipe)).glb, rebuildStyledVoxels(JSON.stringify(input)).glb);
  assert.throws(() => encodeVoxelSnapshot('{broken'), /JSON/);
  assert.throws(() => encodeVoxelSnapshot(' '.repeat(16 * 1024 * 1024 + 1)), /limit/);
});

test('maximum cube and grid limits round-trip with bounded binary storage', () => {
  for (const unique of [false, true]) {
    const input = fixture(VOXEL_SNAPSHOT_MAX_CUBES, unique);
    input.size = [100, 100, 100];
    input.indices = input.indices.map(i => i * 19);
    const result = encodeVoxelSnapshot(input), replay = replayVoxelSnapshot(result.recipe);
    assert.deepEqual(replay.indices, input.indices);
    assert.deepEqual(replay.colors, input.colors.map(Math.fround));
    assert(result.recipe.sourceLength <= VOXEL_SNAPSHOT_MAX_BYTES);
    assert.equal(result.report.gridCells, 1_000_000);
  }
});

test('palette IDs wider than one byte preserve first-occurrence order and exact colors', () => {
  const input = fixture(8192), rows = fixture(257, true).colors;
  let state = 73;
  input.colors = Array.from({ length: input.indices.length }, (_, i) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const id = i < 257 ? i : state % 257;
    return rows.slice(id * 3, id * 3 + 3);
  }).flat();
  const result = verify(input);
  assert.equal(result.report.paletteSize, 257);
  assert.equal(result.recipe.encoding, 'palette-f32');
});

test('invalid source grid, coordinates, indices, colors, arrays and counts reject before packing', () => {
  const input = fixture(2);
  for (const patch of [
    { version: 2 }, { kind: 'other' }, { coordinateSpace: 'local' }, { colorSpace: 'srgb' }, { pose: 'animated' },
    { size: [0, 1, 1] }, { size: [1.1, 1, 1] }, { size: [1_000_001, 1, 1] }, { size: [101, 100, 100] }, { size: [1, 1] },
    { origin: [0, Infinity, 0] }, { origin: [0, NaN, 0] }, { origin: [1e21, 0, 0] },
    { unit: 0 }, { unit: -0.1 }, { unit: NaN }, { unit: Infinity }, { unit: 1e16 },
    { indices: [] }, { indices: [0, 0] }, { indices: [0, 2] }, { indices: [0, -1] }, { indices: [0, 0.5] }, { indices: [NaN, 0] },
    { indices: new Uint32Array([0, 1]) }, { indices: Array(50_001).fill(0) },
    { colors: [0, 0, 0] }, { colors: new Float32Array(6) }, { colors: [0, 0, 0, 0, 0, 1.1] }, { colors: [0, 0, 0, 0, 0, -0.1] }, { colors: [0, 0, 0, 0, 0, NaN] }, { colors: new Array(6) },
    { occupancy: [] }, { occupancy: [0, 1] }, { material: [] }, { node: [] },
  ]) assert.throws(() => encodeVoxelSnapshot({ ...input, ...patch }), JSON.stringify(patch));
});

test('pose, fidelity and warning metadata reject animation claims, blobs, unknown fields and excessive sizes', () => {
  const input = fixture(2), recipe = encodeVoxelSnapshot(input).recipe;
  for (const patch of [
    { sourcePose: null }, { sourcePose: { time: -1 } }, { sourcePose: { time: Infinity } }, { sourcePose: { animation: 'x'.repeat(241) } },
    { sourcePose: { data: new Uint8Array(1) } }, { sourcePose: { clips: [] } }, { sourcePose: { animation: [] } },
    { fidelity: { pose: 'animated', color: 'sampled-linear-base-color', alpha: 'opaque' } },
    { fidelity: { pose: 'static', color: 'sampled-linear-base-color', alpha: 'exact-transparent' } },
    { fidelity: { pose: 'static', color: 'sampled-linear-base-color', alpha: 'opaque', native: {} } },
    { warnings: new Uint8Array(2) }, { warnings: Array(17).fill('warning') }, { warnings: ['x'.repeat(513)] }, { warnings: [new Uint8Array(1)] },
  ]) {
    assert.throws(() => encodeVoxelSnapshot({ ...input, ...patch }));
    assert.throws(() => replayVoxelSnapshot({ ...recipe, ...patch }));
  }
});

test('untrusted getters, sparse arrays, prototype keys and hidden fields are rejected without execution', () => {
  const input = fixture(2), recipe = encodeVoxelSnapshot(input).recipe;
  let calls = 0;
  const sourceGetter = Object.defineProperty({ ...input }, 'unit', { get() { calls++; return 1; }, enumerable: true });
  const recipeGetter = Object.defineProperty({ ...recipe }, 'data', { get() { calls++; return recipe.data; }, enumerable: true });
  const colorGetter = [...input.colors]; Object.defineProperty(colorGetter, 0, { get() { calls++; return 0; }, enumerable: true });
  assert.throws(() => encodeVoxelSnapshot(sourceGetter), /data fields/);
  assert.throws(() => replayVoxelSnapshot(recipeGetter), /data fields/);
  assert.throws(() => encodeVoxelSnapshot({ ...input, colors: colorGetter }), /sample/);
  assert.equal(calls, 0);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const bad = Object.defineProperty({ ...recipe }, key, { value: {}, enumerable: true });
    assert.throws(() => replayVoxelSnapshot(bad), /unsafe/);
  }
  assert.throws(() => replayVoxelSnapshot(Object.assign(Object.create({ inherited: 1 }), recipe)), /invalid/);
  assert.throws(() => replayVoxelSnapshot(Object.defineProperty({ ...recipe }, 'secret', { value: 1 })), /enumerable/);
  const colors = [...input.colors]; Object.assign(colors, { extra: 1 });
  assert.throws(() => encodeVoxelSnapshot({ ...input, colors }), /fields/);
});

test('malformed recipe counts, bounds, codecs, checksums and binary extents reject', () => {
  const valid = encodeVoxelSnapshot(fixture(32)).recipe;
  for (const patch of [
    { version: 2 }, { kind: 'other' }, { pose: 'animated' }, { colorSpace: 'srgb' },
    { size: [1_000_001, 1, 1] }, { size: [101, 100, 100] }, { origin: [0, Infinity, 0] }, { unit: 0 },
    { count: 0 }, { count: 33 }, { count: 50_001 }, { count: 1.1 },
    { encoding: 'other' }, { paletteSize: -1 }, { paletteSize: 33 }, { paletteSize: 0 },
    { sourceLength: valid.sourceLength + 1 }, { sourceLength: 1e15 },
    { payloadCRC32: -1 }, { payloadCRC32: 0x1_0000_0000 }, { payloadCRC32: valid.payloadCRC32 ^ 1 },
    { codec: 'float32-runs-zlib' }, { parameters: { version: 2 } }, { parameters: { version: 1, stride: 4 } }, { parameters: [] },
    { data: [] }, { data: new Uint8Array() }, { data: new Uint8Array(VOXEL_SNAPSHOT_MAX_BYTES + 1024) },
    { data: valid.data.subarray(0, valid.data.length - 1) }, { nativeKAP: new Uint8Array(1) }, { colors: [] }, { sourceGlb: new Uint8Array(1) },
  ]) assert.throws(() => replayVoxelSnapshot({ ...valid, ...patch }));
  const raw = rawPayload(valid);
  assert.throws(() => replayVoxelSnapshot({ ...raw, data: new Uint8Array(raw.data.length + 1) }), /length/);
  assert.throws(() => replayVoxelSnapshot({ ...raw, data: raw.data.map((n, i) => i === 0 ? n ^ 1 : n) }), /checksum/);
});

test('occupied and palette padding, out-of-range IDs and duplicate occupied cells reject even with a matching CRC', () => {
  const input = fixture(3); input.size = [3, 1, 1];
  const raw = rawPayload(encodeVoxelSnapshot(input).recipe);
  assert.throws(() => replayVoxelSnapshot(withPayload(raw, data => { data[0] = data[0]! | 0xc0; })), /occupied padding/);
  assert.throws(() => replayVoxelSnapshot(withPayload(raw, data => { data[0] = data[0]! | 3; })), /occupied index/);
  assert.throws(() => replayVoxelSnapshot(withPayload(raw, data => { data[0] = data[0]! & ~3; })), /duplicate occupied/);
  const paletteInput = fixture(128);
  paletteInput.colors = Array.from({ length: 128 }, (_, i) => [[.125, .25, .5], [.25, .5, .75], [.5, .75, 1]][i % 3]!).flat();
  const palette = rawPayload(encodeVoxelSnapshot(paletteInput).recipe);
  assert.equal(palette.encoding, 'palette-f32'); assert.equal(palette.paletteSize, 3);
  const idOffset = Math.ceil(128 * Math.ceil(Math.log2(128)) / 8) + 3 * 12;
  assert.throws(() => replayVoxelSnapshot(withPayload(palette, data => { data[idOffset] = data[idOffset]! | 3; })), /palette index/);
  const odd = fixture(129);
  const oddPalette = rawPayload(encodeVoxelSnapshot(odd).recipe);
  assert.equal(oddPalette.encoding, 'palette-f32');
  assert.throws(() => replayVoxelSnapshot(withPayload(oddPalette, data => { data[data.length - 1] = data[data.length - 1]! | 0x80; })), /palette padding/);
});

test('invalid Float32 words, duplicate or unused palettes and noncanonical palette order reject', () => {
  const input = fixture(128), palette = rawPayload(encodeVoxelSnapshot(input).recipe);
  assert.equal(palette.encoding, 'palette-f32');
  const rgbOffset = Math.ceil(input.indices.length * Math.ceil(Math.log2(input.indices.length)) / 8), idOffset = rgbOffset + palette.paletteSize * 12;
  for (const value of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
    assert.throws(() => replayVoxelSnapshot(withPayload(palette, data => new DataView(data.buffer).setFloat32(rgbOffset, value, true))), /linear color/);
  }
  assert.throws(() => replayVoxelSnapshot(withPayload(palette, data => data.copyWithin(rgbOffset + 12, rgbOffset, rgbOffset + 12))), /duplicate palette/);
  assert.throws(() => replayVoxelSnapshot(withPayload(palette, data => data.fill(0, idOffset))), /unused palette/);
  assert.throws(() => replayVoxelSnapshot(withPayload(palette, data => { data[idOffset] = data[idOffset]! ^ 1; })), /palette order/);
  const raw = rawPayload(encodeVoxelSnapshot(fixture(2, true)).recipe);
  assert.equal(raw.encoding, 'raw-f32');
  assert.throws(() => replayVoxelSnapshot({ ...raw, paletteSize: 1 }), /palette size/);
});

test('zlib checksum corruption and expansion bombs reject under the expected payload allocation bound', () => {
  const recipe = encodeVoxelSnapshot(fixture(4096)).recipe;
  assert.equal(recipe.codec, 'zlib');
  const corrupt = new Uint8Array(recipe.data); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
  assert.throws(() => replayVoxelSnapshot({ ...recipe, data: corrupt }), /checksum/);
  const bomb = zlibSync(new Uint8Array(recipe.sourceLength * 16));
  assert.throws(() => replayVoxelSnapshot({ ...recipe, data: bomb }), /length/);
});

test('browser-target bundle and Node encode/replay are byte identical, including reconstructed GLBs', async () => {
  const output = await build({ stdin: { contents: "export { encodeVoxelSnapshot, replayVoxelSnapshot } from './packages/import/src/styled-voxel-codec.ts';", resolveDir: new URL('../../..', import.meta.url).pathname }, bundle: true, minify: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  const browser = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0]!.contents).toString('base64'));
  for (const unique of [false, true]) {
    const input = fixture(67, unique), native = encodeVoxelSnapshot(input), bundled = browser.encodeVoxelSnapshot(input);
    assert.deepEqual(packAsset(bundled.recipe), packAsset(native.recipe));
    assert.deepEqual(bundled.report, native.report);
    const replay = browser.replayVoxelSnapshot(unpackAsset(packAsset(bundled.recipe)));
    assert.deepEqual(replay, replayVoxelSnapshot(native.recipe));
    assert.deepEqual(rebuildStyledVoxels(replay).glb, rebuildStyledVoxels(input).glb);
  }
});
