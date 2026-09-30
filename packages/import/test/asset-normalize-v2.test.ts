import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeAsset } from '../src/asset-normalize-v2.ts';
import type { GltfJSON, NativeArray } from '../src/asset-normalize-v2.ts';

const encode = (json: any) => new TextEncoder().encode(JSON.stringify(json));
const bytes = (array: NativeArray) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const benchmark = path.resolve(root, '../animated-model-benchmark');
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

function fixture() {
  const json: GltfJSON = { asset: { version: '2.0', generator: 'independent synthetic fixture', extras: { keep: true } }, accessors: [], bufferViews: [], extras: { extensions: { arbitraryApplicationMetadata: true } } };
  const chunks: Uint8Array[] = [], expected = new Map<number, NativeArray>();
  let total = 0;
  const view = (data: Uint8Array, extra: any = {}) => {
    const padding = (4 - total % 4) % 4;
    if (padding) { chunks.push(new Uint8Array(padding)); total += padding; }
    const id = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: total, byteLength: data.length, ...extra }); chunks.push(data); total += data.length;
    return id;
  };
  const accessor = (array: NativeArray, type: string, componentType: number, extra: any = {}) => {
    const count = array.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as any)[type];
    const id = json.accessors.length;
    json.accessors.push({ bufferView: view(bytes(array)), type, componentType, count, ...extra }); expected.set(id, array); return id;
  };
  const positions = new Float32Array([0, -0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const interleaved = new Float32Array(18);
  for (let i = 0; i < 3; i++) { interleaved.set(positions.subarray(i * 3, i * 3 + 3), i * 6); interleaved.set(normals.subarray(i * 3, i * 3 + 3), i * 6 + 3); }
  const iv = view(bytes(interleaved), { byteStride: 24 });
  json.accessors.push({ bufferView: iv, type: 'VEC3', componentType: 5126, count: 3, min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: iv, byteOffset: 12, type: 'VEC3', componentType: 5126, count: 3 });
  expected.set(0, positions); expected.set(1, normals);
  const tangent = accessor(new Float32Array([1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1]), 'VEC4', 5126);
  const uv1 = accessor(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 'VEC2', 5123, { normalized: true });
  const joints = accessor(new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]), 'VEC4', 5121);
  const weights = accessor(new Uint8Array([255, 0, 0, 0, 128, 127, 0, 0, 0, 255, 0, 0]), 'VEC4', 5121, { normalized: true });
  const indices = accessor(new Uint8Array([0, 1, 2]), 'SCALAR', 5121);
  const sparseIndices = view(new Uint8Array([1])), sparseValues = view(bytes(new Float32Array([0, 0, 0.5])));
  const morph = json.accessors.length;
  json.accessors.push({ type: 'VEC3', componentType: 5126, count: 3, sparse: { count: 1, indices: { bufferView: sparseIndices, componentType: 5121 }, values: { bufferView: sparseValues } } });
  expected.set(morph, new Float32Array([0, 0, 0, 0, 0, 0.5, 0, 0, 0]));
  const morphNormal = accessor(new Float32Array(9), 'VEC3', 5126);
  const paddedMatrix = json.accessors.length;
  json.accessors.push({ bufferView: view(new Uint8Array([1, 2, 3, 99, 4, 5, 6, 99, 7, 8, 9])), componentType: 5121, type: 'MAT3', count: 1 });
  expected.set(paddedMatrix, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  const matrices = accessor(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -4, -5, -6, 1]), 'MAT4', 5126);
  const times = accessor(new Float32Array([0, 1]), 'SCALAR', 5126, { min: [0], max: [1] });
  const translations = accessor(new Float32Array([0, 0, 0, 1, 2, 3]), 'VEC3', 5126);
  const rotations = accessor(new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]), 'VEC4', 5126);
  const morphWeights = accessor(new Uint8Array([0, 255]), 'SCALAR', 5121, { normalized: true });
  const shortRotations = accessor(new Int16Array([0, 0, 0, 32767, 0, 0, 32767, 0]), 'VEC4', 5122, { normalized: true });
  json.meshes = [{ name: 'arbitrary-name', extras: { targetNames: ['bulge'] }, weights: [0.25], primitives: [{ mode: 4, attributes: { POSITION: 0, NORMAL: 1, TANGENT: tangent, TEXCOORD_1: uv1, JOINTS_0: joints, WEIGHTS_0: weights, _CUSTOM: 0 }, indices, material: 0, targets: [{ POSITION: morph, NORMAL: morphNormal, TANGENT: morphNormal }] }] }];
  json.nodes = [{ name: 'root', children: [1, 2, 3], translation: [1, 2, 3] }, { mesh: 0, skin: 0, weights: [0.75], rotation: [0, 0, 0, 1] }, { name: 'jointA' }, { name: 'jointB', scale: [2, 3, 4] }, { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1], camera: 0 }];
  json.skins = [{ joints: [3, 2], inverseBindMatrices: matrices, skeleton: 0, extras: { order: 'intentional' } }];
  json.cameras = [{ type: 'perspective', perspective: { yfov: 0.9, znear: 0.1, zfar: 100 } }];
  json.scenes = [{ nodes: [0, 4], name: 'complete' }]; json.scene = 0;
  json.samplers = [{ magFilter: 9728, minFilter: 9987, wrapS: 33071, wrapT: 33648 }];
  json.images = [{ uri: '../textures/tiny.png', extras: { image: true } }];
  json.textures = [{ sampler: 0, source: 0 }];
  json.materials = [{ name: 'PBR', alphaMode: 'MASK', alphaCutoff: 0.2, doubleSided: true, emissiveFactor: [0.1, 0.2, 0.3], pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.25, 0.75], metallicFactor: 0.3, roughnessFactor: 0.6, baseColorTexture: { index: 0, texCoord: 1 }, metallicRoughnessTexture: { index: 0 } }, normalTexture: { index: 0, scale: 0.7 }, occlusionTexture: { index: 0, strength: 0.4 }, emissiveTexture: { index: 0 } }];
  json.animations = [{ name: 'mixed', samplers: [{ input: times, output: translations, interpolation: 'STEP' }, { input: times, output: rotations, interpolation: 'CUBICSPLINE' }, { input: times, output: morphWeights, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }, { sampler: 1, target: { node: 2, path: 'rotation' } }, { sampler: 2, target: { node: 1, path: 'weights' } }] }, { name: 'integer quaternion', samplers: [{ input: times, output: shortRotations }], channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }, { sampler: 0, target: { path: 'rotation' }, extras: { inert: true } }] }];
  const binary = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { binary.set(chunk, offset); offset += chunk.length; }
  json.buffers = [{ uri: 'mesh.bin', byteLength: binary.length, extras: { bufferMetadata: true } }];
  const input = () => ({ entry: 'models/model.gltf', files: [{ name: 'models/model.gltf', data: encode(json) }, { name: 'models/mesh.bin', data: binary }, { name: 'textures/tiny.png', data: png }] });
  return { json, binary, expected, input, morph, paddedMatrix, times };
}

test('dense IR preserves every semantic, sparse/interleaved data, rig, TRS/matrix, animation and image', async () => {
  const f = fixture(), original = structuredClone(f.json), result = await normalizeAsset(f.input());
  assert.deepEqual(result.sourceJson, original);
  assert.equal(result.accessors.length, f.expected.size);
  for (const [id, expected] of f.expected) { const actual = result.accessors[id]!; assert.equal(actual.sourceIndex, id); assert.equal(actual.array.constructor, expected.constructor); assert.deepEqual(bytes(actual.array), bytes(expected), `accessor ${id}`); }
  assert(Object.is(result.accessors[0]!.array[1], -0));
  for (const key of ['meshes', 'nodes', 'skins', 'animations', 'materials', 'textures', 'samplers', 'cameras', 'scenes', 'scene', 'extras']) assert.deepEqual(result.json[key], original[key], key);
  assert.deepEqual(result.images[0]!.data, png); assert.equal(result.images[0]!.mimeType, 'image/png');
  assert.equal(result.json.buffers, undefined); assert.equal(result.json.bufferViews, undefined); assert.equal(result.json.images[0].uri, undefined);
  for (const accessor of result.json.accessors) { assert.equal(accessor.bufferView, undefined); assert.equal(accessor.sparse, undefined); }
  assert.equal(result.source.files.length, 3); assert(result.source.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
  assert.equal(result.runtime.dracoRequiredForReplay, false); assert.deepEqual(result.validation.warnings, []);
  assert.deepEqual(f.json, original, 'input metadata is not mutated');
});

test('mixed morph/non-morph primitives, surplus inverse-bind matrices and object extras survive', async () => {
  const f = fixture();
  const plain = structuredClone(f.json.meshes[0].primitives[0]); delete plain.targets;
  f.json.meshes[0].primitives.unshift(plain);
  f.json.skins[0].joints = [3]; // glTF permits more inverse-bind matrices than joints.
  for (const key of ['accessors', 'materials', 'nodes', 'skins', 'animations']) f.json[key][0].extras = { unicode: '狐', custom: [0, false, null], nested: { keep: true } };
  const result = await normalizeAsset(f.input());
  for (const key of ['accessors', 'materials', 'nodes', 'skins', 'animations']) assert.deepEqual(result.json[key][0].extras, f.json[key][0].extras);
  assert.equal(result.json.meshes[0].primitives[0].targets, undefined);
  assert.equal(result.accessors[f.json.skins[0].inverseBindMatrices]!.count, 2);
});

test('negative zero in source JSON metadata remains negative zero', async () => {
  const data = new TextEncoder().encode('{"asset":{"version":"2.0"},"extras":{"zero":-0}}');
  const result = await normalizeAsset({ entry: 'a.gltf', files: [{ name: 'a.gltf', data }] });
  assert(Object.is(result.json.extras.zero, -0)); assert(Object.is(result.sourceJson.extras.zero, -0));
});

test('embedded data URI resources decode to identical native arrays and image bytes', async () => {
  const f = fixture(); f.json.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(f.binary).toString('base64');
  f.json.images[0].uri = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
  const result = await normalizeAsset({ entry: 'inline.gltf', files: [{ name: 'inline.gltf', data: encode(f.json) }] });
  for (const [id, expected] of f.expected) assert.deepEqual(bytes(result.accessors[id]!.array), bytes(expected));
  assert.deepEqual(result.images[0]!.data, png);
});

test('unused zero-base and padded signed MAT3 sparse accessors are retained', async () => {
  const json: any = { asset: { version: '2.0' }, buffers: [{ uri: 'b.bin', byteLength: 28 }], bufferViews: [{ buffer: 0, byteLength: 1 }, { buffer: 0, byteOffset: 4, byteLength: 22 }], accessors: [{ componentType: 5122, type: 'MAT3', count: 2, sparse: { count: 1, indices: { bufferView: 0, componentType: 5121 }, values: { bufferView: 1 } } }] };
  const binary = new Uint8Array(28), dv = new DataView(binary.buffer); binary[0] = 1;
  for (let i = 0; i < 9; i++) dv.setInt16(4 + Math.floor(i / 3) * 8 + (i % 3) * 2, i - 4, true);
  const result = await normalizeAsset({ entry: 'm.gltf', files: [{ name: 'm.gltf', data: encode(json) }, { name: 'b.bin', data: binary }] });
  assert.deepEqual(Array.from(result.accessors[0]!.array), [...new Array(9).fill(0), -4, -3, -2, -1, 0, 1, 2, 3, 4]);
});

test('duplicate animation times are preserved and explicitly warned, never sorted or removed', async () => {
  const f = fixture(), accessor = f.json.accessors[f.times], view = f.json.bufferViews[accessor.bufferView];
  new DataView(f.binary.buffer).setFloat32(view.byteOffset + 4, 0, true);
  const result = await normalizeAsset(f.input());
  assert.deepEqual(Array.from(result.accessors[f.times]!.array), [0, 0]);
  assert.equal(result.validation.warnings.length, 1); assert.match(result.validation.warnings[0]!, /1 duplicate times/);
});

test('unsupported extensions reject instead of silently stripping metadata', async () => {
  for (const key of ['extensionsRequired', 'extensionsUsed']) {
    const f = fixture(); f.json[key] = ['VENDOR_unsupported'];
    await assert.rejects(normalizeAsset(f.input()), /unsupported.*extension VENDOR_unsupported/);
  }
  const f = fixture(); f.json.materials[0].extensions = { KHR_materials_transmission: { transmissionFactor: 1 } };
  await assert.rejects(normalizeAsset(f.input()), /unsupported extension KHR_materials_transmission/);
});

test('malformed references, unsafe URIs, out-of-bounds reads and hierarchy cycles reject', async () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.json.meshes[0].primitives[0].attributes.NORMAL = 999; },
    f => { f.json.buffers[0].uri = '../../../secret'; },
    f => { f.json.buffers[0].uri = 'https://example.invalid/mesh.bin'; },
    f => { f.json.buffers[0].uri = '%2fmesh.bin'; },
    f => { f.json.accessors[0].count = 999; },
    f => { f.json.nodes[2].children = [0]; },
    f => { f.json.accessors[f.morph].sparse.count = 9; },
    f => { f.json.accessors[f.paddedMatrix].byteOffset = 1; },
    f => { f.json.images[0].mimeType = 'image/webp'; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); await assert.rejects(normalizeAsset(f.input()), /Asset normalizer v2:/); }
});

test('GLB unknown chunks reject and truncated containers reject', async () => {
  const json = encode({ asset: { version: '2.0' } }), length = Math.ceil(json.length / 4) * 4;
  const binary = new Uint8Array(28 + length), dv = new DataView(binary.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, binary.length, true); dv.setUint32(12, length, true); dv.setUint32(16, 0x4e4f534a, true);
  binary.fill(32, 20, 20 + length); binary.set(json, 20); dv.setUint32(24 + length, 0x12345678, true);
  await assert.rejects(normalizeAsset({ entry: 'a.glb', files: [{ name: 'a.glb', data: binary }] }), /unsupported GLB chunk/);
  await assert.rejects(normalizeAsset({ entry: 'a.glb', files: [{ name: 'a.glb', data: binary.subarray(0, 24) }] }), /GLB header/);
});

const foxDirectory = path.join(root, 'external/fox');
test('development Fox preserves rig ordering, all channels and all accessor bytes against independent glTF-Transform', { skip: !fs.existsSync(path.join(foxDirectory, 'Fox.gltf')) }, async () => {
  const files = ['Fox.gltf', 'Fox.bin', 'Texture.png'].map(name => ({ name, data: new Uint8Array(fs.readFileSync(path.join(foxDirectory, name))) }));
  const result = await normalizeAsset({ files, entry: 'Fox.gltf' });
  const { WebIO } = await import(pathToFileURL(path.join(benchmark, 'node_modules/@gltf-transform/core/dist/index.js')).href);
  const reference = await new WebIO().readJSON({ json: JSON.parse(Buffer.from(files[0]!.data).toString()), resources: { 'Fox.bin': files[1]!.data, 'Texture.png': files[2]!.data } });
  const original = reference.getRoot().listAccessors();
  assert.equal(original.length, result.accessors.length);
  original.forEach((accessor: any, i: number) => assert.deepEqual(bytes(result.accessors[i]!.array), bytes(accessor.getArray()), `Fox accessor ${i}`));
  assert.equal(result.json.animations.length, 3); assert.equal(result.json.skins[0].joints.length, 24); assert.deepEqual(result.json.skins, result.sourceJson.skins);
});

const tokyoPath = path.join(benchmark, 'littlest-tokyo/LittlestTokyo.glb');
test('development Draco scene decodes every primitive and accessor against independent glTF-Transform', { skip: !fs.existsSync(tokyoPath) }, async () => {
  const draco = (await import(pathToFileURL(path.join(benchmark, 'node_modules/draco3dgltf/draco3dgltf.js')).href)).default;
  const { WebIO } = await import(pathToFileURL(path.join(benchmark, 'node_modules/@gltf-transform/core/dist/index.js')).href);
  const { KHRDracoMeshCompression } = await import(pathToFileURL(path.join(benchmark, 'node_modules/@gltf-transform/extensions/dist/index.js')).href);
  const decoder = await draco.createDecoderModule(), data = new Uint8Array(fs.readFileSync(tokyoPath));
  const result = await normalizeAsset({ entry: 'independent-name.glb', files: [{ name: 'independent-name.glb', data }], dracoDecoder: decoder });
  const reference = await new WebIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({ 'draco3d.decoder': decoder }).readBinary(data);
  const original = reference.getRoot().listAccessors(); assert.equal(result.accessors.length, original.length);
  // glTF-Transform downcasts indices based on vertex count. Numeric equality is
  // required there; our own type is separately checked against the original JSON.
  original.forEach((accessor: any, i: number) => {
    assert.deepEqual(Array.from(result.accessors[i]!.array), Array.from(accessor.getArray()), `Draco accessor ${i}`);
    assert.equal(result.accessors[i]!.componentType, result.sourceJson.accessors[i].componentType);
  });
  assert.equal(result.validation.dracoPrimitives, 71); assert.equal(result.images.length, 4); assert.equal(result.json.nodes.length, 214);
  assert.deepEqual(result.json.animations, result.sourceJson.animations);
  assert(!result.json.extensionsRequired); assert(result.sourceJson.extensionsRequired.includes('KHR_draco_mesh_compression'));
  const imageBuffers = reference.getRoot().listTextures().map((texture: any) => texture.getImage());
  result.images.forEach((image, i) => assert.deepEqual(image.data, imageBuffers[i]));
  await assert.rejects(normalizeAsset({ entry: 'a.glb', files: [{ name: 'a.glb', data }] }), /requires an injected/);
});
