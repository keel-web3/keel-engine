import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zlibSync } from 'fflate';
import { SCREEN_IDS } from '@keel-engine/core';
import { encodeSpriteFrames, decodeSpriteFrames, SPRITE_FRAME_MAX_FRAMES, SPRITE_FRAME_MAX_PIXELS } from '../src/sprite-frame-codec.ts';
import type { SpriteFrameInput, SpriteFrameRecipe } from '../src/sprite-frame-codec.ts';
import { encodeStylizedTexture } from '../src/styled-texture-codec.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { crc32 } from '../src/png.ts';

const options = { paletteSize: 8 as const, kind: 'pixel' as const, screen: 'bayer4' as const };
function frame(width: number, height: number, color: (x: number, y: number) => number[]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bytes.set(color(x, y), (y * width + x) * 4);
  return bytes;
}
function verify(input: SpriteFrameInput) {
  const original = input.frames.map(f => new Uint8Array(f)), encoded = encodeSpriteFrames(input), stored = packAsset(encoded.recipe);
  const repeated = encodeSpriteFrames(input), replayed = decodeSpriteFrames(unpackAsset(stored));
  assert.deepEqual(input.frames, original, 'does not mutate input');
  assert.deepEqual(packAsset(repeated.recipe), stored, 'deterministic complete serialized bytes');
  assert.deepEqual(repeated.report, encoded.report);
  assert.deepEqual(replayed, encoded.frames);
  assert.equal(encoded.report.serializedBytes, stored.length);
  assert.equal(encoded.report.serializedBytes, Math.min(...encoded.report.candidates.map(c => c.serializedBytes)));
  assert.equal(encoded.report.metadataBytes + encoded.report.payloadBytes, stored.length);
  assert(encoded.report.candidates.length <= 4);
  for (let f = 0; f < input.frames.length; f++) for (let i = 3; i < input.frames[f]!.length; i += 4) assert.equal(encoded.frames[f]![i], input.frames[f]![i], 'alpha is byte exact');
  return encoded;
}

test('global palette and exact alpha persist across animation frames and binary transport', () => {
  const width = 19, height = 11;
  const frames = [0, 1, 2].map(f => frame(width, height, (x, y) => [(x % 2) * 255, (y % 2) * 111, f === 1 ? 99 : 33, (x * 19 + y * 3 + f) & 255]));
  const result = verify({ ...options, width, height, frames });
  assert.equal(result.report.paletteSize, 8);
  assert.deepEqual(result.frames, frames);
  assert.equal(result.recipe.alpha, 'plane');
  assert.equal(result.report.quantizationError.rgbRMSE, 0);
  assert(!Object.keys(result.recipe).some(key => /original|model|texture|fallback/.test(key)));
  frames[0]!.fill(4); result.frames[1]!.fill(8);
  assert.notDeepEqual(decodeSpriteFrames(result.recipe)[0], frames[0]);
  assert.notDeepEqual(decodeSpriteFrames(result.recipe)[1], result.frames[1]);
});

test('repeated and locally edited frames use real compact deltas and own their output', () => {
  const width = 128, height = 96;
  let state = 381;
  const base = frame(width, height, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return [state & 1 ? 255 : 0, 42, 89, state >>> 24]; });
  const frames = Array.from({ length: 14 }, () => new Uint8Array(base));
  frames[7]!.set([255, 42, 89, 0], (40 * width + 29) * 4);
  const result = verify({ ...options, width, height, frames });
  const delta = result.report.candidates.find(c => c.encoding === 'delta')!;
  assert.equal(delta.repeatFrames, 11);
  assert.equal(result.recipe.encoding, 'delta');
  assert(result.report.serializedBytes < result.report.sourceRGBABytes / 12);
  const replay = decodeSpriteFrames(result.recipe);
  replay[0]!.fill(0);
  assert.deepEqual(replay[1], frames[1], 'repeat outputs do not alias');
});

test('dither frames use every actual KEEL screen consistently with the established texture codec', () => {
  const width = 31, height = 23, source = frame(width, height, (x, y) => [x * 8, y * 11, (x * 7 + y * 5) & 255, 213]);
  const patterns = new Set<string>();
  for (const screen of SCREEN_IDS) {
    const input: SpriteFrameInput = { ...options, kind: 'dither', screen, width, height, frames: [source, source] };
    const result = encodeSpriteFrames(input), texture = encodeStylizedTexture({ width, height, data: source }, { ...options, kind: 'dither', screen, maxDimension: 128 });
    assert.deepEqual(result.recipe.palette, texture.recipe.palette, screen);
    assert.deepEqual(result.frames[0], texture.rgba, screen);
    assert.deepEqual(result.frames[0], result.frames[1], 'unchanged pixels do not crawl between frames');
    patterns.add(Buffer.from(result.frames[0]!).toString('base64'));
  }
  assert(patterns.size >= 10);
});

test('loss is measured against actual decoded RGB, including hidden transparent colors', () => {
  const width = 43, height = 29, frames = [0, 1, 2].map(f => frame(width, height, (x, y) => [x * 5, y * 8, (x * 11 + y * 7 + f * 59) & 255, f ? 255 : 0]));
  const result = verify({ ...options, kind: 'dither', screen: 'stipple', width, height, frames });
  let sum = 0, squared = 0, maximum = 0;
  for (let f = 0; f < frames.length; f++) for (let i = 0; i < frames[f]!.length; i++) if (i % 4 !== 3) {
    const error = Math.abs(frames[f]![i]! - result.frames[f]![i]!); sum += error; squared += error * error; maximum = Math.max(maximum, error);
  }
  const count = width * height * frames.length * 3;
  assert.deepEqual(result.report.quantizationError, { rgbMAE: sum / count, rgbRMSE: Math.sqrt(squared / count), rgbMaxError: maximum, alphaMAE: 0, alphaMaxError: 0, alphaChangedPixels: 0 });
  assert(result.report.quantizationError.rgbRMSE > 0);
  for (const paletteSize of [8, 16, 32, 64] as const) assert(encodeSpriteFrames({ ...options, width, height, frames, paletteSize }).report.paletteSize <= paletteSize);
});

function recipe(encoding: SpriteFrameRecipe['encoding'], width: number, height: number, data: Uint8Array, frames: Uint8Array[], extra: Partial<SpriteFrameRecipe> = {}): SpriteFrameRecipe {
  return { version: 1, kind: 'pixel', encoding, width, height, frameCount: frames.length, screen: 'bayer4', palette: [0, 0, 0, 255, 255, 255], alpha: 255, frameCRC32: frames.map(f => crc32(f)), codec: 'raw', parameters: { version: 1 }, sourceLength: data.length, data, ...extra };
}
function rectangle(op: number, x: number, y: number, width: number, height: number, body: number[]): number[] {
  const bytes = new Uint8Array(9), view = new DataView(bytes.buffer); bytes[0] = op;
  [x, y, width, height].forEach((n, i) => view.setUint16(1 + i * 2, n, true));
  return [...bytes, ...body];
}
test('independent fixtures replay full RGBA, packed indices, partial tiles and all four delta opcodes', () => {
  const width = 3, height = 2;
  const black = frame(width, height, () => [0, 0, 0, 255]), white = frame(width, height, () => [255, 255, 255, 255]);
  const indexed = frame(width, height, (x, y) => x === y ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  assert.deepEqual(decodeSpriteFrames(recipe('rgba', width, height, indexed, [indexed])), [indexed]);
  assert.deepEqual(decodeSpriteFrames(recipe('indexed', width, height, Uint8Array.of(17), [indexed])), [indexed]);
  const changed = new Uint8Array(black); changed.set([255, 255, 255, 255], 4);
  const filled = new Uint8Array(changed); filled.set([255, 255, 255, 255], 12); filled.set([255, 255, 255, 255], 16);
  const data = Uint8Array.from([1, 0, 0, ...rectangle(2, 1, 0, 1, 1, [1]), ...rectangle(3, 0, 1, 2, 1, [1]), 1, 1]);
  const frames = [black, black, changed, filled, white];
  assert.deepEqual(decodeSpriteFrames(recipe('delta', width, height, data, frames)), frames);
  // First dictionary tile has white pixels at (0,0) and (1,1); the frame clips 8x8 to 3x2.
  assert.deepEqual(decodeSpriteFrames(recipe('tiles', width, height, Uint8Array.of(1, 2, 0, 0, 0, 0, 0, 0, 0), [indexed], { dictionaryTiles: 1 })), [indexed]);
  const transparent = frame(1, 1, () => [255, 255, 255, 17]);
  assert.deepEqual(decodeSpriteFrames(recipe('delta', 1, 1, Uint8Array.of(1, 1, 17, 0), [transparent, transparent], { alpha: 'plane' })), [transparent, transparent]);
});

test('tile dictionary wins on many rearrangements of reusable detailed tiles', () => {
  const width = 128, height = 128, tilePatterns: number[][] = [];
  let state = 5;
  for (let t = 0; t < 12; t++) tilePatterns.push(Array.from({ length: 64 }, () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state >>> 24; }));
  const frames = Array.from({ length: 8 }, (_, f) => frame(width, height, (x, y) => {
    const t = ((x >>> 3) * 7 + (y >>> 3) * 11 + f * 5) % tilePatterns.length;
    return [((x ^ y ^ t) & 1) * 255, 23, 77, tilePatterns[t]![(y & 7) * 8 + (x & 7)]!];
  }));
  const result = verify({ ...options, width, height, frames });
  assert.equal(result.recipe.encoding, 'tiles');
  assert.equal(result.recipe.dictionaryTiles, 12);
  assert(result.report.serializedBytes < result.report.sourceRGBABytes / 50);
});

test('two-byte tile references and a bounded dictionary search handle detailed frames', () => {
  const width = 512, height = 40, black = frame(width, height, () => [0, 0, 0, 255]);
  const dictionaryTiles = 257, placements = Math.ceil(width / 8) * Math.ceil(height / 8);
  const data = new Uint8Array(dictionaryTiles * 8 + placements * 2);
  for (let i = dictionaryTiles * 8; i < data.length; i += 2) data[i + 1] = 1;
  assert.deepEqual(decodeSpriteFrames(recipe('tiles', width, height, data, [black], { dictionaryTiles })), [black]);
  data[data.length - 2] = 1;
  assert.throws(() => decodeSpriteFrames(recipe('tiles', width, height, data, [black], { dictionaryTiles })), /reference/);

  let state = 317;
  const noisy = Array.from({ length: 2 }, () => frame(512, 512, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return [0, 0, 0, state >>> 24];
  }));
  const result = encodeSpriteFrames({ ...options, width: 512, height: 512, frames: noisy });
  assert.equal(result.report.candidates.length, 3);
  assert.deepEqual(result.report.skippedCandidates, [{ encoding: 'tiles', reason: 'More than 4096 unique 8x8 tiles; bounded dictionary search stopped.' }]);
  assert.deepEqual(decodeSpriteFrames(result.recipe), noisy);
});

test('complete recipe cost includes metadata and honestly reports tiny assets that grow', () => {
  const tiny = verify({ ...options, width: 1, height: 1, frames: [Uint8Array.of(19, 27, 131, 0)] });
  assert(tiny.report.serializedBytes > tiny.report.sourceRGBABytes);
  assert.equal(tiny.recipe.alpha, 0);
  assert.match(tiny.report.selectionBasis, /Shared decoder\/runtime.*counted once separately/);
  assert.equal(tiny.report.candidates.length, 4);
  assert.equal(tiny.report.candidates.find(c => c.encoding === 'rgba')!.payloadBytes, 4);
});

test('shape, frame, option and aggregate allocation bounds fail before fitting', () => {
  const base: SpriteFrameInput = { ...options, width: 1, height: 1, frames: [Uint8Array.of(1, 2, 3, 4)] };
  const patches: unknown[] = [{ width: 0 }, { height: 513 }, { width: 1.5 }, { frames: [] }, { frames: new Array(SPRITE_FRAME_MAX_FRAMES + 1).fill(base.frames[0]) }, { frames: [new Uint8Array(3)] }, { frames: [[1, 2, 3, 4]] }, { paletteSize: 256 }, { kind: 'fake' }, { screen: '__proto__' }, { width: 512, height: 512, frames: new Array(SPRITE_FRAME_MAX_PIXELS / (512 * 512) + 1).fill(base.frames[0]) }];
  for (const patch of patches) assert.throws(() => encodeSpriteFrames({ ...base, ...patch as object } as SpriteFrameInput));
});

test('hostile metadata and inflated payloads are rejected with bounded work', () => {
  const frame0 = frame(3, 1, () => [0, 0, 0, 255]), good = recipe('indexed', 3, 1, Uint8Array.of(0), [frame0]);
  const patches: unknown[] = [{ version: 2 }, { kind: 'fake' }, { encoding: 'fake' }, { width: 513 }, { height: NaN }, { frameCount: 257 }, { sourceLength: 2 ** 30 }, { frameCRC32: [] }, { frameCRC32: [-1] }, { frameCRC32: [(crc32(frame0) + 1) >>> 0] }, { screen: '__proto__' }, { palette: [] }, { palette: [NaN, 0, 1] }, { palette: new Array(195).fill(0) }, { alpha: 256 }, { alpha: 'bad' }, { dictionaryTiles: 1 }, { originalModel: {} }, { codec: 'row-dictionary-zlib' }, { parameters: { version: 2 } }, { data: [] }, { data: new Uint8Array() }, { codec: 'zlib', data: zlibSync(new Uint8Array(1_000_000)) }];
  for (const patch of patches) assert.throws(() => decodeSpriteFrames({ ...good, ...patch as object } as SpriteFrameRecipe));
  assert.throws(() => decodeSpriteFrames({ ...good, data: Uint8Array.of(128) }), /padding/);
  assert.throws(() => decodeSpriteFrames({ ...good, palette: [0, 0, 0], data: Uint8Array.of(1) }), /index/);
  assert.throws(() => decodeSpriteFrames(recipe('rgba', 3, 1, frame0, [frame0], { alpha: 0 })), /alpha/);
  const compressed = zlibSync(Uint8Array.of(0)); compressed[compressed.length - 1] = compressed[compressed.length - 1]! ^ 1;
  assert.throws(() => decodeSpriteFrames({ ...good, codec: 'zlib', data: compressed }), /checksum/);
});

test('malformed delta records and dictionary references reject before producing frames', () => {
  const black = frame(3, 2, () => [0, 0, 0, 255]);
  const records = [[0], [9], [1], [1, 3], [1, 0, 0], rectangle(2, 0, 0, 0, 2, []), rectangle(2, 3, 0, 1, 1, [0]), rectangle(2, 0, 0, 1, 1, [0]), rectangle(2, 0, 0, 3, 2, []), rectangle(2, 0, 0, 3, 2, [128])];
  for (const data of records) assert.throws(() => decodeSpriteFrames(recipe('delta', 3, 2, Uint8Array.from(data), [black])));
  assert.throws(() => decodeSpriteFrames(recipe('tiles', 3, 2, Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1), [black], { dictionaryTiles: 1 })), /reference/);
  for (const dictionaryTiles of [0, 4097, 1.5]) assert.throws(() => decodeSpriteFrames(recipe('tiles', 3, 2, new Uint8Array(9), [black], { dictionaryTiles })));
});

test('browser-target bundle and native runtime produce identical serialized recipes and all frames', async () => {
  const output = await build({ stdin: { contents: "export { encodeSpriteFrames, decodeSpriteFrames } from './packages/import/src/sprite-frame-codec.ts';", resolveDir: new URL('../../..', import.meta.url).pathname }, bundle: true, minify: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  const browser = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0]!.contents).toString('base64'));
  const width = 39, height = 27, frames = [0, 1, 2].map(f => frame(width, height, (x, y) => [x * 5, y * 8, (x + y + f * 33) & 255, x % 7 ? 255 : f * 40]));
  const input: SpriteFrameInput = { ...options, width, height, frames, kind: 'dither', screen: 'halftone' };
  const native = encodeSpriteFrames(input), bundled = browser.encodeSpriteFrames(input);
  assert.deepEqual(packAsset(bundled.recipe), packAsset(native.recipe));
  assert.deepEqual(bundled.report, native.report);
  assert.deepEqual(browser.decodeSpriteFrames(bundled.recipe), decodeSpriteFrames(native.recipe));
});
