import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, constants } from 'node:zlib';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import jpeg from 'jpeg-js';
import { compileAsset } from '../src/asset-compiler-v6.ts';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { normalizeAsset } from '../src/asset-normalize-v3.ts';
import { encodePng, decodePng } from '../src/png.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { compileStyledAsset } from '../src/styled-asset-compiler.ts';
import { createStyledAsset, importStyledAsset, styledAssetJson } from '../src/styled-asset.ts';
import { nativeTextureTables, replayStyledTexturePackage } from '../src/styled-texture-replay.ts';

const style = { kind: 'dither' as const, pixelSize: 4, toneLevels: 8, screen: 'bayer4' as const };
const texture = { maxDimension: 128 as const, paletteSize: 16 as const };
const raw = (value: ArrayBufferView) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
const brotli = (bytes: Uint8Array) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

// Independent fixture includes a skinned mesh, a morph, two animation channels,
// UV metadata, opaque texture, and non-default material and sampler state.
export function styledIndependentFixture(options: { alpha?: boolean; roles?: boolean } = {}) {
  const width = 256, height = 128, rgba = new Uint8Array(width * height * 4);
  let random = 0x1838d13;
  for (let i = 0; i < width * height; i++) {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    rgba.set([random & 255, random >>> 8 & 255, random >>> 16 & 255, options.alpha ? [0, 64, 128, 255][i % 4]! : 255], i * 4);
  }
  const data = encodePng({ width, height, data: rgba });
  const arrays = [
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array([0, 1, 2]),
    new Uint8Array(12), new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    new Float32Array([0, 1]), new Float32Array([0, 0, 0, 2, 0, 0]),
    new Float32Array([0, 0, 1, 0, 0, 1]), new Float32Array([0, 0, .1, 0, 0, .2, 0, 0, .3]),
    new Float32Array([0, 1]),
  ];
  const json: any = {
    asset: { version: '2.0', extras: { marker: 'independent fixture' } },
    accessors: [
      { componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { componentType: 5123, count: 3, type: 'SCALAR' }, { componentType: 5121, count: 3, type: 'VEC4' },
      { componentType: 5126, count: 3, type: 'VEC4' }, { componentType: 5126, count: 1, type: 'MAT4' },
      { componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { componentType: 5126, count: 2, type: 'VEC3' },
      { componentType: 5126, count: 3, type: 'VEC2' }, { componentType: 5126, count: 3, type: 'VEC3' },
      { componentType: 5126, count: 2, type: 'SCALAR' },
    ],
    meshes: [{ weights: [.25], extras: { targetNames: ['Lift'] }, primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3, TEXCOORD_0: 7 }, indices: 1, material: 0, targets: [{ POSITION: 8 }] }] }],
    nodes: [{ name: 'mesh', mesh: 0, skin: 0, weights: [.4] }, { name: 'bone' }],
    skins: [{ inverseBindMatrices: 4, joints: [1] }],
    animations: [{ name: 'Move and morph', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }, { sampler: 1, target: { node: 0, path: 'weights' } }], samplers: [{ input: 5, output: 6, interpolation: 'LINEAR' }, { input: 5, output: 9, interpolation: 'STEP' }] }],
    materials: [{ name: 'Color', pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 0 }, baseColorFactor: [.8, .6, .4, options.alpha ? .8 : 1], metallicFactor: .3, roughnessFactor: .6 }, alphaMode: options.alpha ? 'BLEND' : 'OPAQUE', doubleSided: true, extras: { preserve: 123 } }],
    images: [{ mimeType: 'image/png', name: 'Independent source' }], textures: [{ source: 0, sampler: 0, name: 'Color texture' }],
    samplers: [{ minFilter: 9987, magFilter: 9729, wrapS: 10497, wrapT: 33648, name: 'Original sampler' }],
    scenes: [{ nodes: [0, 1] }], scene: 0,
  };
  const images = [{ mimeType: 'image/png', data }];
  if (options.roles) {
    for (let i = 1; i <= 3; i++) { json.images.push({ mimeType: 'image/png', name: 'Protected ' + i }); json.textures.push({ source: i, sampler: 0 }); images.push({ mimeType: 'image/png', data: data.slice() }); }
    json.materials.push({ normalTexture: { index: 1 } }, { pbrMetallicRoughness: { metallicRoughnessTexture: { index: 2 } }, occlusionTexture: { index: 2 } }, { pbrMetallicRoughness: { baseColorTexture: { index: 3 } }, normalTexture: { index: 3 } });
  }
  return { glb: writeNativeGlb(json, arrays, images), json, arrays, images, rgba, width, height };
}
let pending: ReturnType<typeof compileAsset>;
const compiled = () => pending ??= compileAsset({ mode: 'lossless', entry: 'fixture.glb', files: [{ name: 'fixture.glb', data: styledIndependentFixture().glb }] });

function assertProtectedScene(before: any, after: any) {
  assert.equal(after.accessors.length, before.accessors.length);
  for (let i = 0; i < before.accessors.length; i++) assert.deepEqual(raw(after.accessors[i]), raw(before.accessors[i]), 'accessor ' + i);
  const protectedJson = (json: any) => { const result = structuredClone(json); delete result.images; delete result.samplers; delete result.textures; return result; };
  assert.deepEqual(protectedJson(after.json), protectedJson(before.json));
}

test('independent: downloaded v2 asset reconstructs lossy textures and exact rig, morphs and accessors', async () => {
  const base = await compiled(), result = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture, name: 'QA download' });
  const imported = await importStyledAsset(new Uint8Array(result.assetBytes));
  assert.equal(unpackAsset(result.assetBytes).version, 2);
  assertProtectedScene(base.nativeScene, imported.nativeScene);
  const reimported = await normalizeAsset({ files: [{ name: 'download.glb', data: imported.glb }], entry: 'download.glb' });
  for (let i = 0; i < base.nativeScene.accessors.length; i++) assert.deepEqual(raw(reimported.accessors[i]!.array), raw(base.nativeScene.accessors[i]), 'download accessor ' + i);
  assert.deepEqual(reimported.json.animations, base.nativeScene.json.animations);
  assert.deepEqual(reimported.json.skins, base.nativeScene.json.skins);
  assert.deepEqual(reimported.json.meshes, base.nativeScene.json.meshes);
  const pixels = decodePng(imported.nativeScene.images[0].data);
  assert(pixels.width <= texture.maxDimension && pixels.height <= texture.maxDimension);
  assert.notDeepEqual(imported.nativeScene.images[0].data, base.nativeScene.images[0].data);
  const original = await createStyledAsset({ packageBytes: base.packageBytes, style: { ...style, kind: 'original' } });
  assert(brotli(result.assetBytes) < brotli(original) * .5, 'actual compressed download must remove substantial texture storage');
  const readable = new TextEncoder().encode(styledAssetJson(result.assetBytes));
  assert.deepEqual((await importStyledAsset(readable)).glb, imported.glb);
});

test('independent: selected image storage is stripped from every native image layer', async () => {
  const base = await compiled(), result = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
  const envelope = unpackAsset(result.assetBytes), recipe = unpackAsset(envelope.native.data), { body, wrappers } = nativeTextureTables(recipe.base);
  assert(recipe.images.length > 0);
  for (const item of recipe.images) {
    assert.equal(body.native.base.images[item.image].data, null);
    assert.equal(body.native.images.some((entry: any) => entry.image === item.image), false);
    for (const wrapper of wrappers) assert.equal(wrapper.images.some((entry: any) => entry.image === item.image), false);
  }
  const source = base.nativeScene.images[0].data;
  function walk(value: any) {
    if (value instanceof Uint8Array) { assert.equal(Buffer.from(value).includes(Buffer.from(source)), false, 'original PNG retained in binary leaf'); return; }
    if (typeof value === 'string') assert.equal(value.includes(Buffer.from(source).toString('base64')), false, 'original PNG retained as base64');
    if (value && typeof value === 'object') for (const child of Object.values(value)) walk(child);
  }
  walk(recipe);
});

test('independent: normal, linear and mixed-use images stay exact while color sampling changes are isolated', async () => {
  const fixture = styledIndependentFixture({ roles: true });
  const base = await compileAsset({ mode: 'lossless', entry: 'roles.glb', files: [{ name: 'roles.glb', data: fixture.glb }] });
  const result = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
  assertProtectedScene(base.nativeScene, result.imported.nativeScene);
  assert.notDeepEqual(result.imported.nativeScene.images[0].data, base.nativeScene.images[0].data);
  for (let i = 1; i < 4; i++) {
    assert.deepEqual(result.imported.nativeScene.images[i].data, base.nativeScene.images[i].data, 'protected image ' + i);
    const before = base.nativeScene.json.textures[i], after = result.imported.nativeScene.json.textures[i];
    assert.deepEqual(after, before, 'protected texture ' + i);
    assert.deepEqual(result.imported.nativeScene.json.samplers[after.sampler], base.nativeScene.json.samplers[before.sampler], 'protected sampler ' + i);
  }
});

test('independent: protected-only maps retain original native bytes and make no compact-texture claim', async () => {
  const fixture = styledIndependentFixture();
  fixture.json.materials[0].normalTexture = { index: 0 };
  delete fixture.json.materials[0].pbrMetallicRoughness.baseColorTexture;
  const glb = writeNativeGlb(fixture.json, fixture.arrays, fixture.images);
  const base = await compileAsset({ mode: 'lossless', entry: 'normal.glb', files: [{ name: 'normal.glb', data: glb }] });
  const result = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
  assert.equal(result.report.changedImages, 0);
  assert.equal(result.report.retainedImages, 1);
  assert.deepEqual(result.packageBytes, base.packageBytes);
  assert.deepEqual(unpackAsset(result.assetBytes).native.data, base.packageBytes);
  assert.ok('textureEncoding' in result.imported.conversion && 'supersededColorPayloadRemoved' in result.imported.conversion && 'changedImages' in result.imported.conversion);
  assert.equal(result.imported.conversion.textureEncoding, 'native-input');
  assert.equal(result.imported.conversion.supersededColorPayloadRemoved, false);
  assert.equal(result.imported.conversion.changedImages, 0);
  assert.deepEqual(result.imported.nativeScene.json, base.nativeScene.json);
  assert.deepEqual(result.imported.nativeScene.images, base.nativeScene.images);
  assertProtectedScene(base.nativeScene, result.imported.nativeScene);
});

test('independent: repeated compiles produce deterministic actual transport bytes', async () => {
  const base = await compiled();
  const a = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
  const b = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
  assert.deepEqual(a.assetBytes, b.assetBytes); assert.deepEqual(a.imported.glb, b.imported.glb);
});

test('independent: alpha is preserved at sampled texels and resizing loss is measurable', async () => {
  const fixture = styledIndependentFixture({ alpha: true });
  const base = await compileAsset({ mode: 'lossless', entry: 'alpha.glb', files: [{ name: 'alpha.glb', data: fixture.glb }] });
  for (const maxDimension of [128, 256] as const) {
    const result = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture: { ...texture, maxDimension } });
    const decoded = decodePng(result.imported.nativeScene.images[0].data);
    for (let y = 0; y < decoded.height; y++) for (let x = 0; x < decoded.width; x++) {
      const sx = Math.min(fixture.width - 1, Math.floor((x + .5) * fixture.width / decoded.width));
      const sy = Math.min(fixture.height - 1, Math.floor((y + .5) * fixture.height / decoded.height));
      assert.equal(decoded.data[(y * decoded.width + x) * 4 + 3], fixture.rgba[(sy * fixture.width + sx) * 4 + 3], 'sampled alpha');
    }
    assert.deepEqual(result.imported.nativeScene.json.materials, base.nativeScene.json.materials);
    assertProtectedScene(base.nativeScene, result.imported.nativeScene);
  }
});

test('independent: malformed dimensions, image ownership and duplicate recipe entries reject before replay', async () => {
  const base = await compiled(), result = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
  const recipe = unpackAsset(unpackAsset(result.assetBytes).native.data);
  const mutations = [
    (r: any) => { r.images[0].recipe.width = 0; },
    (r: any) => { r.images[0].recipe.height = 513; },
    (r: any) => { r.images[0].recipe.width = 1.1; },
    (r: any) => { r.images[0].image = -1; },
    (r: any) => { r.images.push(structuredClone(r.images[0])); },
    (r: any) => { nativeTextureTables(r.base).body.native.base.images[r.images[0].image].data = { codec: 'raw', parameters: { version: 1 }, sourceLength: 1, data: new Uint8Array([1]) }; },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(recipe); mutate(invalid); await assert.rejects(replayStyledTexturePackage(packAsset(invalid))); }
});

test('independent: browser bundle without ambient Buffer reconstructs exact Node download bytes', async () => {
  const base = await compiled(), result = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
  const root = new URL('../../..', import.meta.url).pathname;
  const bundle = await build({ stdin: { contents: "export {importStyledAsset} from './packages/import/src/styled-asset.ts'", resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'styled', platform: 'browser', target: 'es2022', define: { 'import.meta.url': JSON.stringify('https://fixture.invalid/styled-asset-runtime.mjs') }, external: ['node:fs/promises'] });
  // A host-realm structuredClone would manufacture host object prototypes. Clone
  // inside this isolated realm, as the browser's actual native function does.
  const clone = 'function structuredClone(v){if(v===null||typeof v!=="object")return v;if(ArrayBuffer.isView(v))return new v.constructor(v);if(v instanceof ArrayBuffer)return v.slice(0);if(Array.isArray(v))return v.map(structuredClone);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,structuredClone(x)]));}';
  const load = runInNewContext(clone + bundle.outputFiles[0]!.text + '; styled.importStyledAsset', { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, crypto, btoa, atob, performance, WebAssembly });
  const imported = await load(result.assetBytes);
  assert.deepEqual(imported.glb, result.imported.glb);
});

test('independent: browser compiler decodes PNG and JPEG without ambient Buffer and matches Node bytes', async () => {
  const root = new URL('../../..', import.meta.url).pathname;
  const bundle = await build({ stdin: { contents: "export {compileStyledAsset} from './packages/import/src/styled-asset-compiler.ts'", resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'styled', platform: 'browser', target: 'es2022', define: { 'import.meta.url': JSON.stringify('https://fixture.invalid/styled-asset-compiler.mjs') }, external: ['node:fs/promises'] });
  const clone = 'function structuredClone(v){if(v===null||typeof v!=="object")return v;if(ArrayBuffer.isView(v))return new v.constructor(v);if(v instanceof ArrayBuffer)return v.slice(0);if(Array.isArray(v))return v.map(structuredClone);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,structuredClone(x)]));}';
  const run = runInNewContext(clone + bundle.outputFiles[0]!.text + '; (packageBytes)=>styled.compileStyledAsset({packageBytes,style:{kind:"dither",pixelSize:4,toneLevels:8,screen:"bayer4"},texture:{maxDimension:128,paletteSize:16}})', { Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, crypto, btoa, atob, performance, WebAssembly });
  const fixture = styledIndependentFixture();
  const jpegBytes = new Uint8Array(jpeg.encode({ width: fixture.width, height: fixture.height, data: fixture.rgba }, 92).data);
  fixture.json.images[0].mimeType = 'image/jpeg';
  const jpegGlb = writeNativeGlb(fixture.json, fixture.arrays, [{ mimeType: 'image/jpeg', data: jpegBytes }]);
  const jpegBase = await compileAsset({ mode: 'lossless', entry: 'jpeg.glb', files: [{ name: 'jpeg.glb', data: jpegGlb }] });
  for (const base of [await compiled(), jpegBase]) {
    const node = await compileStyledAsset({ packageBytes: base.packageBytes, style, texture });
    const browser = await run(base.packageBytes);
    assert.equal(browser.report.changedImages, 1, 'browser must convert, not skip the image');
    assert.deepEqual(browser.assetBytes, node.assetBytes);
    assert.deepEqual(browser.imported.glb, node.imported.glb);
    assert.equal(JSON.stringify(browser.report), JSON.stringify(node.report));
  }
});
