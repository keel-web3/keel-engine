import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { unzipSync } from 'fflate';
import { compileAsset } from '../src/asset-compiler-v6.ts';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { readGlb } from '../src/gltf.ts';
import { encodePng } from '../src/png.ts';
import { createStyledAsset, createVoxelStyledAsset, importStyledAsset, isStyledAsset, makeStyledAssetArchive, rebuildStyledVoxels, styledAssetJson, STYLED_ASSET_DEPENDENCIES, VOXEL_ASSET_DEPENDENCIES } from '../src/styled-asset.ts';

const style = { kind: 'voxel' as const, pixelSize: 4, toneLevels: 8, screen: 'bayer4' as const };
const attribution = { version: '2.0', copyright: 'Independent fixture author; CC0', extras: { source: 'https://example.invalid/fixture', license: 'CC0-1.0' } };
function acceptedSnapshot() {
  return {
    version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static',
    size: [9, 7, 11], origin: [-Math.PI, 1.25, -3.01], unit: 0.175,
    indices: [400, 0, 692, 37, 19, 84, 15, 683],
    colors: [-0, .3, 1 / 3, .2, .7, .8, 0, .4, 1, .1, .2, .3, .9, .5, .125, .01, .02, .03, 1, 0, 1, .25, .5, .75],
    sourcePose: { animation: 'Walk', time: 0.3 },
    fidelity: { pose: 'static', color: 'sampled-linear-base-color', alpha: 'opaque' },
    warnings: ['Static sampled pose; source rig and animation are not preserved'],
    occupancy: [1, 1, 1, 1, 1, 1, 1, 1], material: Array(8).fill(0), node: Array(8).fill(0),
    materialNames: ['SOURCE_MATERIAL_SENTINEL'], nodeNames: ['SOURCE_MESH_SENTINEL'], options: { fill: 'none' },
  };
}
function sourceFixture() {
  const arrays = [new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array([0, 1, 2]), new Uint8Array(12), new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), new Float32Array([0, 1]), new Float32Array([0, 0, 0, 2, 0, 0]), new Float32Array([0, 0, 1, 0, 0, 1])];
  const json = { asset: attribution, accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { componentType: 5123, count: 3, type: 'SCALAR' }, { componentType: 5121, count: 3, type: 'VEC4' }, { componentType: 5126, count: 3, type: 'VEC4' }, { componentType: 5126, count: 1, type: 'MAT4' }, { componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { componentType: 5126, count: 2, type: 'VEC3' }, { componentType: 5126, count: 3, type: 'VEC2' }], meshes: [{ name: 'SOURCE_MESH_SENTINEL', primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3, TEXCOORD_0: 7 }, indices: 1, material: 0 }] }], nodes: [{ name: 'source mesh', mesh: 0, skin: 0 }, { name: 'source bone' }], skins: [{ inverseBindMatrices: 4, joints: [1] }], animations: [{ name: 'SOURCE_ANIMATION_SENTINEL', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }], samplers: [{ input: 5, output: 6, interpolation: 'LINEAR' }] }], materials: [{ name: 'SOURCE_MATERIAL_SENTINEL', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }], images: [{ mimeType: 'image/png' }], scenes: [{ nodes: [0, 1] }], scene: 0 };
  return writeNativeGlb(json, arrays, [{ mimeType: 'image/png', data: encodePng({ width: 2, height: 2, data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 127, 63, 31, 255]) }) }]);
}
let compiled: ReturnType<typeof compileAsset> | undefined;
function source() { return compiled ??= compileAsset({ mode: 'lossless', entry: 'source.glb', files: [{ name: 'source.glb', data: sourceFixture() }] }); }
const sha = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))).toString('hex');
function binaryFields(value: any, path = ''): string[] {
  if (value instanceof Uint8Array) return [path];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => binaryFields(child, path ? path + '.' + key : key));
}

test('independent voxel: standalone v3 retains exactly the accepted cube GLB and no original payload', async () => {
  const input = acceptedSnapshot(), expected = rebuildStyledVoxels(input), original = await source();
  const bytes = await createStyledAsset({ packageBytes: original.packageBytes, style, voxel: input, staticPose: true, name: 'Accepted pose' });
  const envelope = unpackAsset(bytes), imported = await importStyledAsset(bytes, { dracoDecoder: new Proxy({}, { get() { throw Error('Draco must not be touched'); } }) });
  assert(imported.version === 3);
  assert.equal(isStyledAsset(bytes), true);
  assert.equal(envelope.version, 3);
  assert.deepEqual(envelope.native, { encoding: 'none', byteLength: 0, dracoRequired: false });
  assert.deepEqual(envelope.dependencies, VOXEL_ASSET_DEPENDENCIES);
  assert.equal(Object.hasOwn(envelope.dependencies, 'draco3dgltf'), false);
  assert.equal(Object.hasOwn(envelope.dependencies, 'nativeCompiler'), false);
  assert.deepEqual(binaryFields(envelope), ['voxel.data']);
  for (const marker of ['SOURCE_MESH_SENTINEL', 'SOURCE_MATERIAL_SENTINEL', 'SOURCE_ANIMATION_SENTINEL']) assert.equal(Buffer.from(bytes).includes(Buffer.from(marker)), false);
  assert.equal(Buffer.from(bytes).includes(Buffer.from(original.packageBytes)), false);
  assert.deepEqual(imported.glb, expected.glb);
  assert.equal(imported.sourceGlb, imported.glb);
  assert.equal(imported.reconstructedGlb, imported.glb);
  assert.deepEqual(imported.animation, { mode: 'static-pose', clips: 0, skins: 0 });
  const json = readGlb(imported.glb).json as any;
  for (const key of ['animations', 'skins', 'images', 'textures']) assert.equal(json[key], undefined);
  assert.equal(imported.nativeScene.images.length, 0);
  assert.equal((imported.nativeScene.json.animations ?? []).length, 0);
  assert.equal((imported.nativeScene.json.skins ?? []).length, 0);
  assert.equal(imported.nativeScene.primitives.length, 1);
  assert.equal(imported.voxelMesh!.positions.length, input.indices.length * 24 * 3);
  assert.equal(imported.voxelMesh!.indices.length, input.indices.length * 36);
  assert.deepEqual(imported.attribution, attribution);
  assert.deepEqual(imported.voxel.sourcePose, input.sourcePose);
  assert.deepEqual(imported.voxel.fidelity, input.fidelity);
  assert.deepEqual(imported.voxel.warnings, input.warnings);
  for (const field of ['occupancy', 'material', 'node', 'materialNames', 'nodeNames', 'options']) assert.equal(Object.hasOwn(envelope.voxel, field), false);
  assert.equal(imported.conversion.sourceGeometryRemoved, true);
  assert.equal(imported.conversion.sourceTexturesRemoved, true);
  assert.equal(imported.conversion.sourceAnimationRemoved, true);
});

test('independent voxel: direct construction needs no source and repeated binary/readable downloads are stable', async () => {
  const voxel = acceptedSnapshot(), before = structuredClone(voxel);
  const input = { voxel, style, name: 'Accepted pose', attribution, sourceBounds: { min: [-4, -1, -4] as [number, number, number], max: [4, 4, 4] as [number, number, number] } };
  const bytes = await createVoxelStyledAsset(input), repeated = await createVoxelStyledAsset(input);
  assert.deepEqual(bytes, repeated); assert.deepEqual(voxel, before);
  const readable = styledAssetJson(bytes), json = JSON.parse(readable);
  assert.equal(json.native.encoding, 'none'); assert.equal(json.voxel.data.encoding, 'base64');
  assert.equal(Object.hasOwn(json.native, 'data'), false);
  const binaryImport = await importStyledAsset(bytes), textImport = await importStyledAsset(new TextEncoder().encode(readable));
  assert(binaryImport.version === 3 && textImport.version === 3);
  assert.deepEqual(textImport.glb, binaryImport.glb);
  assert.deepEqual(textImport.voxel, binaryImport.voxel);
  assert.deepEqual(textImport.attribution, attribution);
  assert.deepEqual(textImport.sourceBounds, { ...input.sourceBounds, space: 'source-world', pose: 'static-hint' });
  assert.equal(styledAssetJson(repeated), readable);
  assert.deepEqual(await createVoxelStyledAsset({ voxel: textImport.voxel, style, name: input.name, attribution: textImport.attribution, sourceBounds: textImport.sourceBounds }), bytes);
});

test('independent voxel: malformed versions, dependencies, false native sources, missing and extra payloads reject', async () => {
  const bytes = await createVoxelStyledAsset({ voxel: acceptedSnapshot() });
  const mutations: [string, (e: any) => void][] = [
    ['version', e => { e.version = 4; }], ['format', e => { e.format = 'something else'; }],
    ['missing dependency', e => { delete e.dependencies.voxelCodec; }], ['changed dependency', e => { e.dependencies.runtime = 'keel-styled-asset-2.0.0'; }],
    ['extra dependency', e => { e.dependencies.draco3dgltf = '1.5.7'; }],
    ['fake source', e => { e.native = { encoding: 'kap', byteLength: 1, data: Uint8Array.of(1), dracoRequired: false }; }],
    ['extra source bytes', e => { e.native.data = Uint8Array.of(1); }], ['source hash', e => { e.native.sha256 = '0'.repeat(64); }],
    ['claimed source size', e => { e.native.byteLength = 1; }], ['claimed Draco', e => { e.native.dracoRequired = true; }],
    ['missing native', e => { delete e.native; }], ['missing voxel', e => { delete e.voxel; }], ['missing data', e => { delete e.voxel.data; }],
    ['empty data', e => { e.voxel.data = new Uint8Array(); }], ['extra data', e => { e.voxel.sourceGlb = Uint8Array.of(1); }],
    ['extra envelope data', e => { e.sourceGlb = Uint8Array.of(1); }], ['missing checksum', e => { delete e.voxel.payloadCRC32; }],
    ['corrupt data', e => { e.voxel.data[0] ^= 1; }], ['wrong extent', e => { e.voxel.sourceLength++; }],
    ['animated claim', e => { e.animation.mode = 'preserved'; }], ['extra clip', e => { e.animation.clips = ['Walk']; }],
    ['wrong style', e => { e.style.kind = 'pixel'; }], ['false conversion', e => { e.conversion.sourceGeometryRemoved = false; }],
    ['extra conversion', e => { e.conversion.lossless = true; }], ['executable field', e => { e.code = 'globalThis.pwned=true'; }],
    ['binary attribution', e => { e.attribution = { source: Uint8Array.of(1) }; }],
  ];
  for (const [label, mutate] of mutations) { const invalid = unpackAsset(bytes); mutate(invalid); await assert.rejects(importStyledAsset(packAsset(invalid)), label); }
  const readable = JSON.parse(styledAssetJson(bytes));
  readable.voxel.data.unexpected = 'ignored?';
  await assert.rejects(importStyledAsset(new TextEncoder().encode(JSON.stringify(readable))), /unknown field/);
  assert.equal((globalThis as any).pwned, undefined);
});

test('independent voxel: legacy source-retaining v1 and v2 envelopes still import the same cubes', async () => {
  const original = await source(), voxel = acceptedSnapshot();
  const common = { format: 'KEEL-STYLED-ASSET', name: 'Legacy static pose', native: { encoding: 'kap', byteLength: original.packageBytes.length, sha256: await sha(original.packageBytes), dracoRequired: false, data: original.packageBytes }, style, sourceBounds: null, animation: { mode: 'static-pose' }, voxel };
  const { textureCodec: _textureCodec, ...legacyDependencies } = STYLED_ASSET_DEPENDENCIES;
  const legacy = [
    { ...common, version: 1, dependencies: { ...legacyDependencies, runtime: 'keel-styled-asset-1.0.0' } },
    { ...common, version: 2, dependencies: STYLED_ASSET_DEPENDENCIES, conversion: { mode: 'static-pose', textureEncoding: 'native-input', changedImages: 0, supersededColorPayloadRemoved: false } },
  ];
  const current = await importStyledAsset(await createVoxelStyledAsset({ voxel }));
  for (const envelope of legacy) {
    const bytes = packAsset(envelope), imported = await importStyledAsset(bytes);
    assert.equal(imported.version, envelope.version);
    assert.deepEqual(imported.glb, current.glb);
    assert.deepEqual(imported.animation, { mode: 'static-pose', clips: 0, skins: 0 });
    assert.equal((readGlb(imported.sourceGlb).json.animations as any[]).length, 1);
    assert.equal((readGlb(imported.sourceGlb).json.skins as any[]).length, 1);
    // Legacy readable JSON uses ordinary number arrays, so JSON normalizes -0.
    // The v3 binary color payload above retains the Float32 sign in both forms.
    const readable = new TextEncoder().encode(styledAssetJson(bytes));
    assert.deepEqual((await importStyledAsset(readable)).glb, rebuildStyledVoxels(JSON.parse(JSON.stringify(voxel))).glb);
  }
});

test('independent voxel: Pixel/Dither keep the pinned v2 byte contract and animated source', async () => {
  const original = await source();
  for (const kind of ['pixel', 'dither'] as const) {
    const savedStyle = { ...style, kind }, bytes = await createStyledAsset({ packageBytes: original.packageBytes, style: savedStyle, name: 'V2 regression' });
    const expected = packAsset({ format: 'KEEL-STYLED-ASSET', version: 2, name: 'V2 regression', dependencies: STYLED_ASSET_DEPENDENCIES, native: { encoding: 'kap', byteLength: original.packageBytes.length, sha256: await sha(original.packageBytes), dracoRequired: false, data: original.packageBytes }, style: savedStyle, conversion: { mode: 'stylized-lossy', textureEncoding: 'native-input', changedImages: 0, supersededColorPayloadRemoved: false }, sourceBounds: null, animation: { mode: 'preserved' }, voxel: null });
    assert.deepEqual(bytes, expected);
    const imported = await importStyledAsset(bytes);
    assert.deepEqual(imported.animation, { mode: 'preserved', clips: 1, skins: 1 });
    assert.deepEqual(imported.glb, original.preview.data);
    assert.equal(imported.envelope.dependencies.runtime, 'keel-styled-asset-2.0.0');
  }
});

test('independent voxel: browser bundle imports the exact standalone GLB without ambient Buffer', async () => {
  const bytes = await createVoxelStyledAsset({ voxel: acceptedSnapshot(), attribution });
  const output = await build({ stdin: { contents: "export {importStyledAsset} from './packages/import/src/styled-asset.ts'", resolveDir: new URL('../../..', import.meta.url).pathname }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'styled', target: 'es2022', define: { 'import.meta.url': JSON.stringify('https://fixture.invalid/runtime.mjs') }, external: ['node:fs/promises'] });
  const clone = 'function structuredClone(v){if(v===null||typeof v!=="object")return v;if(ArrayBuffer.isView(v))return new v.constructor(v);if(Array.isArray(v))return v.map(structuredClone);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,structuredClone(x)]));}';
  const importer = runInNewContext(clone + output.outputFiles[0]!.text + ';styled.importStyledAsset', { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, crypto, btoa, atob, performance, WebAssembly });
  const result = await importer(bytes);
  assert.deepEqual(result.glb, rebuildStyledVoxels(acceptedSnapshot()).glb);
  assert.equal(result.version, 3); assert.equal(result.animation.clips, 0); assert.equal(result.animation.skins, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.attribution)), attribution);
});

test('independent voxel: standalone archive excludes supplied source decoder helpers', async () => {
  const bytes = await createVoxelStyledAsset({ voxel: acceptedSnapshot() });
  const licenses = ['LICENSE-KEEL.txt', 'LICENSE-fflate.txt', 'LICENSE-Draco-Apache-2.0.txt', 'LICENSE-meshoptimizer.txt'].map(name => ({ name, data: 'Test license placeholder' }));
  const archive = makeStyledAssetArchive(bytes, { runtime: new TextEncoder().encode('// trusted runtime supplied by host'), licenses, dracoFiles: [{ name: 'draco-factory.mjs', data: 'throw Error("unused decoder");' }, { name: 'draco_decoder_gltf.wasm', data: Uint8Array.of(0, 97, 115, 109) }] });
  const files = unzipSync(archive);
  assert.equal(Object.hasOwn(files, 'draco-factory.mjs'), false);
  assert.equal(Object.hasOwn(files, 'draco_decoder_gltf.wasm'), false);
  assert.deepEqual(files['asset.keelasset'], bytes);
  assert.equal(JSON.parse(new TextDecoder().decode(files['dependencies.json'])).voxelCodec, 'keel-static-voxel-snapshot-v1');
  assert.deepEqual((await importStyledAsset(files['asset.keelasset']!)).glb, rebuildStyledVoxels(acceptedSnapshot()).glb);
});
