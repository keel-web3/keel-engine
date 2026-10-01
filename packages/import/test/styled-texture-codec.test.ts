import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zlibSync } from 'fflate';
import { SCREENS, SCREEN_IDS } from '@keel-engine/core';
import type { ScreenId } from '@keel-engine/core';
import { encodeStylizedTexture, replayStylizedTexture, STYLIZED_TEXTURE_MAX_SOURCE_PIXELS } from '../src/styled-texture-codec.ts';
import type { StylizedTextureInput, StylizedTextureOptions, StylizedTextureRecipe } from '../src/styled-texture-codec.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { crc32 } from '../src/png.ts';

const options: StylizedTextureOptions = { maxDimension: 128, paletteSize: 8, kind: 'pixel', screen: 'bayer4' };
function image(width: number, height: number, color: (x: number, y: number) => number[]): StylizedTextureInput {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  return { width, height, data };
}
function verify(input: StylizedTextureInput, settings = options) {
  const original = new Uint8Array(input.data), encoded = encodeStylizedTexture(input, settings), stored = packAsset(encoded.recipe);
  const second = encodeStylizedTexture(input, settings), replay = replayStylizedTexture(unpackAsset(stored));
  assert.deepEqual(packAsset(second.recipe), stored, 'recipe is byte deterministic');
  assert.deepEqual(second.report, encoded.report, 'error metrics are deterministic');
  assert.deepEqual(input.data, original, 'input is not mutated');
  assert.deepEqual(replay, { width: encoded.width, height: encoded.height, rgba: encoded.rgba });
  assert.equal(encoded.report.serializedBytes, stored.length);
  assert.equal(encoded.report.serializedBytes, Math.min(...encoded.report.candidates.map(c => c.serializedBytes)));
  assert.equal(encoded.report.metadataBytes + encoded.report.payloadBytes, stored.length);
  assert.equal(encoded.report.quantizationError.alphaChangedPixels, 0);
  assert.equal(encoded.report.quantizationError.alphaMaxError, 0);
  return encoded;
}

test('source colors produce a compact palette; alpha, including hidden transparent color samples, is separate', () => {
  const source = image(128, 79, (x, y) => [(x % 2) * 255, (y % 2) * 127, 33, [0, 1, 127, 254, 255][(x + y) % 5]!]);
  const encoded = verify(source);
  assert.equal(encoded.report.paletteSize, 4);
  assert.equal(encoded.recipe.alpha, 'plane');
  assert.deepEqual(encoded.rgba, source.data);
  assert.equal(encoded.report.quantizationError.rgbRMSE, 0);
  assert.equal(encoded.report.sourceError.rgbRMSE, 0);
  assert(encoded.report.serializedBytes < source.data.length / 10);
  assert.equal(encoded.report.alphaLossFromResize, false);
  assert.equal(encoded.recipe.encoding, 'palette-indices');
  assert(!Object.keys(encoded.recipe).some(key => /original|fallback|sourcePixels/.test(key)));
  source.data.fill(17);
  assert.notDeepEqual(replayStylizedTexture(encoded.recipe).rgba, source.data, 'recipe owns its data');
  encoded.rgba.fill(44);
  assert.notDeepEqual(replayStylizedTexture(encoded.recipe).rgba, encoded.rgba, 'replay owns its output');
});

test('bounded center-nearest resize is explicit and alpha remains byte-exact at the resized resolution', () => {
  const source = image(513, 257, (x, y) => [x & 255, y & 255, (x ^ y) & 255, x % 3 === 0 ? 0 : (x + y) & 255]);
  const result = verify(source);
  assert.equal(result.width, 128); assert.equal(result.height, 64);
  assert.equal(result.report.resized, true); assert.equal(result.report.resize, 'center-nearest');
  assert.equal(result.report.alphaExactAtResizedResolution, true); assert.equal(result.report.alphaLossFromResize, true);
  assert(result.report.sourceError.alphaChangedPixels > 0);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
    const sy = Math.floor((y + 0.5) * source.height / result.height), sx = Math.floor((x + 0.5) * source.width / result.width);
    assert.equal(result.rgba[(y * result.width + x) * 4 + 3], source.data[(sy * source.width + sx) * 4 + 3]);
  }
  for (const [w, h] of [[1, 900], [900, 1], [7, 19], [1, 1]]) {
    const small = verify(image(w!, h!, () => [17, 66, 112, 0]));
    assert.equal(small.recipe.alpha, 0); assert(small.width > 0 && small.height > 0);
    assert(small.width <= 128 && small.height <= 128);
  }
});

test('real decoded RGB error is measured, not the fitted pair average', () => {
  const input = image(65, 43, (x, y) => [x * 3, y * 5, (x * 17 + y * 11) & 255, 255]);
  const result = verify(input, { ...options, kind: 'dither' });
  let sum = 0, squared = 0, max = 0;
  for (let i = 0; i < input.data.length; i++) if (i % 4 !== 3) {
    const error = Math.abs(result.rgba[i]! - input.data[i]!); sum += error; squared += error * error; max = Math.max(max, error);
  }
  assert.equal(result.report.quantizationError.rgbMAE, sum / (65 * 43 * 3));
  assert.equal(result.report.quantizationError.rgbRMSE, Math.sqrt(squared / (65 * 43 * 3)));
  assert.equal(result.report.quantizationError.rgbMaxError, max);
  assert(result.report.quantizationError.rgbRMSE > 0);
  assert.equal(result.report.paletteSize, 8);
});

function pairRecipe(screen: ScreenId, mix = 8): { recipe: StylizedTextureRecipe; rgba: Uint8Array } {
  const width = 16, height = 16, count = width * height, firstBytes = count / 8;
  const data = new Uint8Array(firstBytes * 2 + count / 2); data.fill(255, firstBytes, firstBytes * 2); data.fill(mix | mix << 4, firstBytes * 2);
  const rgba = new Uint8Array(count * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = SCREENS[screen].at(x, y) < mix / 16 ? 255 : 0;
    rgba.set([value, value, value, 213], (y * width + x) * 4);
  }
  return { recipe: { version: 1, kind: 'dither', encoding: 'screen-pairs', width, height, screen, palette: [0, 0, 0, 255, 255, 255], alpha: 213, codec: 'raw', parameters: { version: 1 }, sourceLength: data.length, data, rgbaCRC32: crc32(rgba) }, rgba };
}

test('all 13 actual KEEL screens replay palette-pair thresholds, including non-Bayer screens', () => {
  assert.equal(SCREEN_IDS.length, 13);
  const patterns = new Set<string>();
  for (const screen of SCREEN_IDS) for (const mix of [1, 8, 15]) {
    const fixture = pairRecipe(screen, mix), result = replayStylizedTexture(fixture.recipe);
    assert.deepEqual(result.rgba, fixture.rgba, screen);
    if (mix === 8) patterns.add(Buffer.from(result.rgba).toString('base64'));
  }
  assert(patterns.size >= 10, 'screen names are not aliases for one Bayer matrix');
});

test('procedural fields beat stored dither pixels on a smooth noisy-screen ramp using actual serialized costs', () => {
  const source = image(256, 256, x => [x, x, x, 255]);
  const result = verify(source, { ...options, maxDimension: 256, kind: 'dither', screen: 'stipple' });
  assert.equal(result.recipe.encoding, 'screen-pairs');
  assert.equal(result.report.candidates.length, 2);
  const indices = result.report.candidates.find(c => c.encoding === 'palette-indices')!;
  assert(result.report.serializedBytes < indices.serializedBytes);
  assert(result.report.serializedBytes < source.data.length / 20);
  const bayer = verify(source, { ...options, maxDimension: 256, kind: 'dither', screen: 'bayer4' });
  assert.notDeepEqual(bayer.rgba, result.rgba);
});

test('tiny sources may grow; flat colors and all alpha values do not require original pixel fallback', () => {
  const result = verify(image(1, 1, () => [19, 42, 121, 17]), { ...options, kind: 'dither' });
  assert(result.report.serializedBytes > 4);
  assert.equal(result.report.paletteSize, 1);
  assert.equal(result.report.quantizationError.rgbRMSE, 0);
  assert.match(result.report.selectionBasis, /compressed source images can be smaller/);
});

test('requested palette and texture limits are honored without upscaling', () => {
  const source = image(131, 83, (x, y) => [x & 255, y & 255, (x * y) & 255, 255]);
  for (const maxDimension of [128, 256, 512] as const) for (const paletteSize of [8, 16, 32, 64] as const) {
    const result = encodeStylizedTexture(source, { ...options, maxDimension, paletteSize });
    assert(result.report.paletteSize <= paletteSize);
    assert.equal(result.width, maxDimension === 128 ? 128 : 131);
    assert(result.height <= 83);
  }
  const largest = encodeStylizedTexture(image(513, 513, (x, y) => [x & 255, y & 255, (x ^ y) & 255, (x * 3 + y) & 255]), { ...options, maxDimension: 512, paletteSize: 64, kind: 'dither', screen: 'ign' });
  assert.equal(largest.width, 512); assert.equal(largest.height, 512);
  assert.equal(largest.rgba.length, 512 * 512 * 4);
  assert.equal(largest.report.paletteSize, 64);
  assert.deepEqual(replayStylizedTexture(largest.recipe).rgba, largest.rgba);
});

test('invalid inputs and options fail before allocation or expensive fitting', () => {
  const source = image(1, 1, () => [1, 2, 3, 4]);
  for (const patch of [{ width: 0 }, { width: 0.5 }, { width: 16_385 }, { height: -1 }, { width: STYLIZED_TEXTURE_MAX_SOURCE_PIXELS, height: 2 }, { width: 8192, height: 8192 }, { data: new Uint8Array(3) }, { data: [1, 2, 3, 4] }]) {
    assert.throws(() => encodeStylizedTexture({ ...source, ...patch } as StylizedTextureInput, options));
  }
  for (const patch of [{ maxDimension: 1024 }, { paletteSize: 256 }, { kind: 'normal' }, { screen: 'fake' }, { screen: '__proto__' }]) {
    assert.throws(() => encodeStylizedTexture(source, { ...options, ...patch } as StylizedTextureOptions));
  }
});

test('malformed recipes reject dimensions, unknown fields, padding, indices, pairs, corrupt data and inflation bombs', () => {
  const valid = pairRecipe('bayer4').recipe;
  for (const patch of [
    { version: 2 }, { kind: 'pixel' }, { encoding: 'unknown' }, { width: 513 }, { height: 0 }, { width: 1.5 }, { sourceLength: 2 ** 30 },
    { screen: 'fake' }, { screen: '__proto__' }, { palette: [] }, { palette: [0, 1] }, { palette: [0, 1, NaN] }, { palette: new Array(195).fill(0) },
    { alpha: 256 }, { alpha: 'unknown' }, { rgbaCRC32: -1 }, { rgbaCRC32: (valid.rgbaCRC32 + 1) >>> 0 },
    { data: valid.data.slice(0, -1) }, { codec: 'row-dictionary-zlib' }, { parameters: { version: 2 } }, { originalTexture: new Uint8Array(4) },
  ]) assert.throws(() => replayStylizedTexture({ ...valid, ...patch } as StylizedTextureRecipe));
  const invalidPair = new Uint8Array(valid.data); invalidPair.fill(0, 0, 64); // both IDs 0, but nonzero blend
  assert.throws(() => replayStylizedTexture({ ...valid, data: invalidPair }), /pair/);
  const zeroMix = new Uint8Array(valid.data); zeroMix.fill(0, 64);
  assert.throws(() => replayStylizedTexture({ ...valid, data: zeroMix }), /pair/);
  const bomb = zlibSync(new Uint8Array(1024));
  assert.throws(() => replayStylizedTexture({ ...valid, codec: 'zlib', data: bomb }), /length/);
  const tiny = encodeStylizedTexture(image(1, 1, () => [1, 2, 3, 255]), options).recipe;
  assert.equal(tiny.codec, 'raw');
  assert.throws(() => replayStylizedTexture({ ...tiny, data: Uint8Array.of(0x80) }), /padding/);
  assert.throws(() => replayStylizedTexture({ ...tiny, data: Uint8Array.of(1) }), /index/);
  const zlib = encodeStylizedTexture(image(128, 128, () => [1, 2, 3, 255]), options).recipe;
  assert.equal(zlib.codec, 'zlib');
  const corrupted = new Uint8Array(zlib.data); corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
  assert.throws(() => replayStylizedTexture({ ...zlib, data: corrupted }), /checksum/);
});

test('browser bundle and native execution produce byte-identical recipes and pixels', async () => {
  const output = await build({ stdin: { contents: "export { encodeStylizedTexture, replayStylizedTexture } from './packages/import/src/styled-texture-codec.ts';", resolveDir: new URL('../../..', import.meta.url).pathname }, bundle: true, minify: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  const browser = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0]!.contents).toString('base64'));
  const source = image(71, 49, (x, y) => [x * 3, y * 5, (x + y) & 255, x % 7 ? 255 : 0]), settings = { ...options, kind: 'dither' as const, screen: 'halftone' as const };
  const native = encodeStylizedTexture(source, settings), bundled = browser.encodeStylizedTexture(source, settings);
  assert.deepEqual(packAsset(bundled.recipe), packAsset(native.recipe));
  assert.deepEqual(bundled.report, native.report);
  assert.deepEqual(browser.replayStylizedTexture(bundled.recipe), replayStylizedTexture(native.recipe));
});
