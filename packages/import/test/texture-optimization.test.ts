import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import jpeg from 'jpeg-js';
import { optimizeTextures } from '../src/optimization/textures.ts';
import type { TextureOptimizationOptions } from '../src/optimization/textures.ts';
import type { NormalizedAsset } from '../src/asset-normalize-v3.ts';
import { crc32, decodePng, encodePng } from '../src/png.ts';

function pixels(width: number, height: number, fn: (x: number, y: number) => number[]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4);
  return { width, height, data };
}
function asset(data: Uint8Array, mimeType = 'image/png', material: any = { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }): NormalizedAsset {
  const json = { asset: { version: '2.0' }, images: [{ mimeType, name: 'source texture', extras: { preserve: true } }], textures: [{ source: 0, sampler: 0 }], samplers: [{ wrapS: 10497, wrapT: 33071 }], materials: [material] };
  return { format: 'KEEL-NATIVE-SCENE', version: 2, json, sourceJson: structuredClone(json), accessors: [], images: [{ sourceIndex: 0, mimeType, data }], source: { entry: 'fixture.glb', container: 'glb', files: [] }, validation: { accessorCount: 0, sourceAccessorCount: 0, decodedBytes: data.length, dracoPrimitives: 0, meshPrimitives: 0, imageBytes: data.length, preservedSourceIndices: true, decodedReference: 'source-accessor-values', warnings: [] }, runtime: { dependencies: [], dracoRequiredForReplay: false, decoderCostIncluded: false, decoderNote: '' } };
}
const loose: TextureOptimizationOptions = { mode: 'lossy', maxDimension: 1, maxRgbaRmse: 255, maxRgbaError: 255, maxAlphaRmse: 255, maxAlphaError: 255, maxNormalAngleDegrees: 180, maxAlphaCoverageError: 1 };

test('lossless bypass preserves all bytes, metadata, hidden RGB, arrays and unsupported images exactly', () => {
  const input = asset(Uint8Array.from([255, 216, 255, 255]), 'image/jpeg');
  input.accessors.push({ sourceIndex: 0, type: 'SCALAR', componentType: 5126, count: 2, normalized: false, array: new Float32Array([1, -0]) });
  const result = optimizeTextures(input, { mode: 'lossless', maxDimension: 1, quality: 1 });
  assert.deepEqual(result.asset, input); assert.equal(result.report.savedBytes, 0); assert.equal(result.report.changedImages, 0);
  result.asset.images[0]!.data[0] = 0; result.asset.accessors[0]!.array[0] = 7; result.asset.json.materials[0].test = true;
  assert.equal(input.images[0]!.data[0], 255); assert.equal(input.accessors[0]!.array[0], 1); assert.equal(input.json.materials[0].test, undefined);
  assert.equal(result.report.images[0]!.candidates.length, 0);
});

test('opaque color uses deterministic linear-light filtering and retains every material field', () => {
  const input = asset(encodePng(pixels(8, 8, (x) => x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])));
  input.json.materials[0] = { pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 }, baseColorFactor: [0.3, 0.7, 0.1, 0.8], metallicFactor: 0.2, roughnessFactor: 0.3 }, alphaMode: 'BLEND', doubleSided: true, emissiveFactor: [0.2, 0.1, 0], name: 'full PBR', extras: { keep: 'all' } };
  const result = optimizeTextures(input, loose), again = optimizeTextures(input, loose);
  assert.equal(result.report.changedImages, 1); assert.deepEqual(result, again);
  assert.deepEqual(result.asset.json.materials, input.json.materials); assert.deepEqual(result.asset.json.textures, input.json.textures); assert.deepEqual(result.asset.sourceJson, input.sourceJson);
  const p = decodePng(result.asset.images[0]!.data); assert.deepEqual([p.width, p.height], [1, 1]); assert.deepEqual(Array.from(p.data), [188, 188, 188, 255]);
  assert.equal(result.report.images[0]!.error.comparedPixels, 64);
  assert.equal(result.asset.validation.imageBytes, result.asset.images[0]!.data.length);
});

test('alpha remains PNG and premultiplied filtering avoids transparent RGB bleeding', () => {
  const input = asset(encodePng(pixels(8, 8, x => x % 2 ? [0, 0, 255, 255] : [255, 0, 0, 0])));
  const result = optimizeTextures(input, loose), image = result.asset.images[0]!;
  assert.equal(result.report.changedImages, 1); assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(Array.from(decodePng(image.data).data), [0, 0, 255, 128]);
  assert(result.report.images[0]!.error.alphaRmse > 100); assert.equal(result.report.images[0]!.candidates.length, 1);
  const strict = optimizeTextures(input, { ...loose, maxAlphaRmse: 1 });
  assert.equal(strict.report.changedImages, 0); assert.deepEqual(strict.asset.images[0]!.data, input.images[0]!.data);
});

test('alpha mask coverage honors cutoff and base color alpha factor', () => {
  const input = asset(encodePng(pixels(8, 8, x => [20, 100, 220, x % 2 ? 255 : 0])), 'image/png', { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 0.5] }, alphaMode: 'MASK', alphaCutoff: 0.5 });
  const result = optimizeTextures(input, { ...loose, maxAlphaCoverageError: 0.01 });
  assert.equal(result.report.changedImages, 0); assert.equal(result.report.images[0]!.candidates[0]!.error!.alphaCoverageMaxDifference, 0.5);
  assert.match(result.report.images[0]!.candidates[0]!.reason, /coverage/);
});

test('normal filtering renormalizes vectors and error bounds include material scale', () => {
  const input = asset(encodePng(pixels(8, 8, x => [x % 2 ? 204 : 51, 128, 230, 255])), 'image/png', { normalTexture: { index: 0, scale: 1 }, alphaMode: 'OPAQUE' });
  const result = optimizeTextures(input, { ...loose, maxNormalAngleDegrees: 45 });
  assert.equal(result.report.changedImages, 1); assert.equal(result.asset.images[0]!.mimeType, 'image/png');
  assert.deepEqual(Array.from(decodePng(result.asset.images[0]!.data).data), [128, 128, 255, 255]);
  assert(result.report.images[0]!.error.normalAngleMaxDegrees < 40);
  input.json.materials[0].normalTexture.scale = 2;
  const strict = optimizeTextures(input, { ...loose, maxNormalAngleDegrees: 45 });
  assert.equal(strict.report.changedImages, 0); assert.match(strict.report.images[0]!.candidates[0]!.reason, /normal angular/);
});

test('linear PBR maps do not receive sRGB conversion or JPEG, mixed uses stay exact', () => {
  const input = asset(encodePng(pixels(8, 8, x => x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 'image/png', { pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } }, occlusionTexture: { index: 0, strength: 0.3 } });
  const result = optimizeTextures(input, loose);
  assert.equal(result.report.changedImages, 1); assert.equal(result.asset.images[0]!.mimeType, 'image/png');
  assert.deepEqual(Array.from(decodePng(result.asset.images[0]!.data).data), [128, 128, 128, 255]);
  input.json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  const mixed = optimizeTextures(input, loose);
  assert.equal(mixed.report.changedImages, 0); assert.match(mixed.report.images[0]!.reason, /mixed-use/); assert.deepEqual(mixed.asset.images[0]!.data, input.images[0]!.data);
});

test('adaptive PNG filtering roundtrips grayscale, RGB and alpha with prime dimensions', () => {
  const cases: Array<[(x: number, y: number) => number[], number]> = [
    [(x, y) => { const n = (x * 7 + y * 3) & 255; return [n, n, n, 255]; }, 0],
    [(x, y) => { const n = (x * 7 + y * 3) & 255; return [n, n, n, (x * 11) & 255]; }, 4],
    [(x, y) => [(x * 7) & 255, (y * 13) & 255, (x * 3 + y * 2) & 255, 255], 2],
    [(x, y) => [(x * 7) & 255, (y * 13) & 255, (x * 3 + y * 2) & 255, (x * 11) & 255], 6],
  ];
  for (const [fn, colorType] of cases) {
    const raw = pixels(127, 59, fn), input = asset(encodePng(raw), 'image/png', { occlusionTexture: { index: 0 } });
    const result = optimizeTextures(input, { mode: 'lossy', maxDimension: 256, maxRgbaRmse: 0, maxRgbaError: 0 });
    assert.equal(result.report.changedImages, 1); assert.equal(result.asset.images[0]!.data[25], colorType);
    assert.deepEqual(decodePng(result.asset.images[0]!.data).data, raw.data); assert.equal(result.report.images[0]!.error.rgbaRmse, 0);
    const resized = optimizeTextures(input, { ...loose, maxDimension: 37 });
    assert(resized.report.images[0]!.candidates.every(c => c.error === null || Number.isFinite(c.error.rgbaRmse)));
  }
});

test('processing and candidate budgets are enforced across images', () => {
  const input = asset(encodePng(pixels(8, 8, () => [20, 110, 200, 255])));
  input.images.push({ ...input.images[0]!, sourceIndex: 1, data: input.images[0]!.data.slice() });
  input.json.images.push({ ...input.json.images[0] }); input.json.textures.push({ source: 1 });
  input.json.materials.push({ emissiveTexture: { index: 1 } });
  const result = optimizeTextures(input, { ...loose, maxTotalSourcePixels: 64, maxCandidates: 1 });
  assert.equal(result.report.images[0]!.candidates.length, 1); assert.equal(result.report.images[1]!.candidates.length, 0);
  assert.match(result.report.images[1]!.reason, /budget/); assert.deepEqual(result.asset.images[1]!.data, input.images[1]!.data);
});

test('JPEG texture size reduction is real, bounded, full-resolution measured, deterministic', () => {
  const source = pixels(512, 256, (x, y) => [Math.round(120 + 90 * Math.sin(x / 70)), Math.round(120 + 90 * Math.cos(y / 55)), Math.round(120 + 90 * Math.sin((x + y) / 110)), 255]);
  const input = asset(new Uint8Array(jpeg.encode(source, 98).data), 'image/jpeg'), before = structuredClone(input);
  const options: TextureOptimizationOptions = { mode: 'lossy', maxDimension: 128, quality: 80, maxRgbaRmse: 6, maxRgbaError: 30 };
  const result = optimizeTextures(input, options);
  assert.equal(result.report.changedImages, 1); assert(result.report.outputBytes < result.report.sourceBytes * 0.35);
  assert.deepEqual(result.report.images[0]!.outputDimensions, [128, 64]); assert(result.report.images[0]!.error.rgbaRmse < 6);
  assert.equal(result.report.images[0]!.error.comparedPixels, 512 * 256); assert.equal(result.report.images[0]!.candidates.length, 2);
  assert.deepEqual(result, optimizeTextures(input, options)); assert.deepEqual(input, before);
  const strict = optimizeTextures(input, { ...options, maxRgbaRmse: 0, maxRgbaError: 0 });
  assert.equal(strict.report.changedImages, 0); assert.deepEqual(strict.asset.images, input.images);
});

test('unsupported metadata, unknown extension slots and resource limits retain original bytes', () => {
  const raw = encodePng(pixels(8, 8, () => [21, 80, 111, 255]));
  const chunk = new Uint8Array(13), view = new DataView(chunk.buffer); view.setUint32(0, 1); chunk.set(new TextEncoder().encode('sRGB'), 4); view.setUint32(9, crc32(chunk, 4, 9));
  const profiled = new Uint8Array(raw.length + chunk.length); profiled.set(raw.subarray(0, 33)); profiled.set(chunk, 33); profiled.set(raw.subarray(33), 46);
  const input = asset(profiled), result = optimizeTextures(input, loose);
  assert.equal(result.report.changedImages, 0); assert.match(result.report.images[0]!.reason, /metadata/); assert.deepEqual(result.asset.images, input.images);
  const unknown = asset(raw, 'image/png', { extensions: { unknown: { normalTexture: { index: 0 } } } });
  assert.equal(optimizeTextures(unknown, loose).report.changedImages, 0);
  assert.equal(optimizeTextures(asset(raw), { ...loose, maxSourcePixels: 1 }).report.changedImages, 0);
  assert.throws(() => optimizeTextures(asset(raw), { ...loose, quality: NaN }), /quality/);
  assert.throws(() => optimizeTextures(asset(raw), { ...loose, maxCandidates: 3 }), /maxCandidates/);
});

test('browser bundle without ambient Buffer produces exactly the Node bytes and report', async () => {
  const root = new URL('../../..', import.meta.url).pathname;
  const bundle = await build({ stdin: { contents: "export { optimizeTextures } from './packages/import/src/optimization/textures.ts'", resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'optimizer', platform: 'browser', target: 'es2022', inject: [root + '/packages/import/src/optimization/browser-buffer.ts'] });
  const run = runInNewContext(bundle.outputFiles[0]!.text + '; optimizer.optimizeTextures', { structuredClone, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Float32Array, Float64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder });
  const input = asset(new Uint8Array(jpeg.encode(pixels(64, 32, (x, y) => [x * 3, y * 7, 90, 255]), 98).data), 'image/jpeg');
  const options: TextureOptimizationOptions = { mode: 'lossy', maxDimension: 16, maxRgbaRmse: 30 };
  const node = optimizeTextures(input, options), browser = run(input, options);
  assert.deepEqual(browser.asset.images[0].data, node.asset.images[0]!.data); assert.equal(JSON.stringify(browser.report), JSON.stringify(node.report));
});
