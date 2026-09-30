import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { compileAsset, decodePackage } from '../src/asset-compiler.ts';
import type { AssetFile } from '../src/asset-compiler.ts';

const encode = (json: unknown) => new TextEncoder().encode(JSON.stringify(json));
const sha = (data: Uint8Array | string) => crypto.createHash('sha256').update(data).digest('hex');
const bytes = (data: Uint8Array) => Buffer.from(data);
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

// A small independent fixture: no downloaded models, production asset writers,
// sibling workspaces, generated reports, or test-order dependencies.
function fixtureFiles(): AssetFile[] {
  const chunks: Uint8Array[] = [];
  const bufferViews: any[] = [], accessors: any[] = [];
  let length = 0;
  const accessor = (array: Float32Array | Uint16Array | Uint8Array, type: string, componentType: number, extra: object = {}) => {
    const padding = (4 - length % 4) % 4;
    chunks.push(new Uint8Array(padding)); length += padding;
    const data = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    chunks.push(data); length += data.length;
    const count = array.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[type]!;
    accessors.push({ bufferView, componentType, type, count, ...extra });
    return accessors.length - 1;
  };
  const position = accessor(new Float32Array([0, -0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', 5126, { min: [0, 0, 0], max: [1, 1, 0] });
  const uv = accessor(new Float32Array([0, 0, 1, 0, 0, 1]), 'VEC2', 5126);
  const joints = accessor(new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]), 'VEC4', 5121);
  const weights = accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]), 'VEC4', 5126);
  const indices = accessor(new Uint16Array([0, 1, 2]), 'SCALAR', 5123);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const inverseBindMatrices = accessor(new Float32Array([...identity, ...identity]), 'MAT4', 5126);
  const times = accessor(new Float32Array([0, 1]), 'SCALAR', 5126, { min: [0], max: [1] });
  const translations = accessor(new Float32Array([0, 0, 0, 1, 2, 3]), 'VEC3', 5126);
  const rotations = accessor(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]), 'VEC4', 5126);
  const scales = accessor(new Float32Array([1, 1, 1, 2, 2, 2]), 'VEC3', 5126);
  const json = {
    asset: { version: '2.0', generator: 'portable independent test fixture' },
    buffers: [{ uri: 'model.bin', byteLength: length }], bufferViews, accessors,
    images: [{ uri: 'texture.png' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: position, TEXCOORD_0: uv, JOINTS_0: joints, WEIGHTS_0: weights }, indices, material: 0 }] }],
    nodes: [{ children: [1, 2] }, { mesh: 0, skin: 0 }, { name: 'jointA', children: [3] }, { name: 'jointB' }],
    skins: [{ joints: [2, 3], inverseBindMatrices, skeleton: 2 }], scenes: [{ nodes: [0] }], scene: 0,
    animations: [
      { name: 'translate', samplers: [{ input: times, output: translations, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }] },
      { name: 'rotate', samplers: [{ input: times, output: rotations, interpolation: 'STEP' }], channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }] },
      { name: 'scale', samplers: [{ input: times, output: scales, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 2, path: 'scale' } }] },
    ],
  };
  const binary = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { binary.set(chunk, offset); offset += chunk.length; }
  return [{ name: 'model.gltf', data: encode(json) }, { name: 'model.bin', data: binary }, { name: 'texture.png', data: png.slice() }];
}

function fixtureGlb(): Uint8Array {
  const files = fixtureFiles(), json = JSON.parse(bytes(files[0]!.data).toString());
  const binary = files[1]!.data, imageOffset = Math.ceil(binary.length / 4) * 4;
  const opaqueOffset = Math.ceil((imageOffset + png.length) / 4) * 4;
  const opaque = new Uint8Array([0x44, 0x52, 0x41, 0x43, 0x4f, 0, 255, 7]);
  const payload = new Uint8Array(opaqueOffset + opaque.length);
  payload.set(binary); payload.set(png, imageOffset); payload.set(opaque, opaqueOffset);
  json.buffers = [{ byteLength: payload.length }];
  json.images = [{ bufferView: json.bufferViews.length, mimeType: 'image/png' }];
  json.bufferViews.push({ buffer: 0, byteOffset: imageOffset, byteLength: png.length });
  // Deliberately opaque data, not a claimed valid Draco stream. v1 preserves
  // unknown required extensions and their payloads without decoding them.
  json.extensionsUsed = json.extensionsRequired = ['TEST_opaque_payload'];
  json.extensions = { TEST_opaque_payload: { bufferView: json.bufferViews.length, extras: { retained: true } } };
  json.bufferViews.push({ buffer: 0, byteOffset: opaqueOffset, byteLength: opaque.length });
  const jsonBytes = encode(json), jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const result = new Uint8Array(28 + jsonLength + payload.length), view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + jsonLength); result.set(jsonBytes, 20);
  view.setUint32(20 + jsonLength, payload.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  result.set(payload, 28 + jsonLength); return result;
}

const mutateFixture = (fn: (json: any) => void) => {
  const files = fixtureFiles(), json = JSON.parse(bytes(files[0]!.data).toString());
  fn(json); files[0]!.data = encode(json); return files;
};
const sameFiles = (before: AssetFile[], after: AssetFile[]) => {
  assert.equal(after.length, before.length, 'every provided file must survive');
  const map = new Map(after.map(file => [file.name, file.data]));
  assert.equal(map.size, after.length, 'decoded filenames must be unique');
  for (const file of before) {
    assert(map.has(file.name), `missing restored resource ${file.name}`);
    assert.deepEqual(bytes(map.get(file.name)!), bytes(file.data), `resource bytes changed: ${file.name}`);
  }
};

test('glTF restores all original resource bytes, metadata, rig and all three animations', async () => {
  const files = fixtureFiles(), result = await compileAsset({ files, entry: 'model.gltf', mode: 'lossless' });
  const decoded = await decodePackage(result.packageBytes); sameFiles(files, decoded.files);
  assert.equal(decoded.entry, 'model.gltf');
  const doc = JSON.parse(bytes(decoded.files.find(file => file.name === decoded.entry)!.data).toString());
  assert.equal(doc.animations.length, 3); assert.deepEqual(doc.skins[0].joints, [2, 3]); assert.equal(doc.nodes.length, 4);
  assert.equal(result.manifest.validation.resourceBytesExact, true);
});

test('GLB preserves opaque extension payloads and every metadata/image byte', async () => {
  const original = fixtureGlb(), result = await compileAsset({ files: [{ name: 'scene.glb', data: original }], entry: 'scene.glb', mode: 'lossless' });
  const decoded = await decodePackage(result.packageBytes);
  assert.equal(decoded.files.length, 1); assert.deepEqual(bytes(decoded.files[0]!.data), bytes(original));
  const data = bytes(decoded.files[0]!.data), jsonLength = data.readUInt32LE(12), json = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
  assert(json.extensionsRequired.includes('TEST_opaque_payload'));
  assert.equal(json.images.length, 1); assert.equal(json.meshes.length, 1); assert.equal(json.nodes.length, 4); assert.equal(json.animations.length, 3);
  assert(result.manifest.warnings.some(warning => warning.includes('TEST_opaque_payload')));
});

test('Repeated runs and input-file order produce identical package bytes', async () => {
  const first = await compileAsset({ files: fixtureFiles(), entry: 'model.gltf', mode: 'lossless' });
  for (const files of [fixtureFiles(), fixtureFiles().reverse(), [fixtureFiles()[1]!, fixtureFiles()[2]!, fixtureFiles()[0]!]]) {
    const next = await compileAsset({ files, entry: 'model.gltf', mode: 'lossless' });
    assert.deepEqual(bytes(next.packageBytes), bytes(first.packageBytes)); assert.equal(next.program, first.program);
  }
});

test('GLB package identity does not depend on uploaded filename', async () => {
  const data = fixtureGlb();
  const first = await compileAsset({ files: [{ name: 'scene.glb', data }], entry: 'scene.glb', mode: 'lossless' });
  const renamed = await compileAsset({ files: [{ name: 'renamed-scene.glb', data }], entry: 'renamed-scene.glb', mode: 'lossless' });
  assert.deepEqual(bytes(first.packageBytes), bytes(renamed.packageBytes));
});

test('Fresh Node processes reproduce glTF and GLB package hashes from an unrelated cwd', async () => {
  const compilerUrl = new URL('../src/asset-compiler.ts', import.meta.url).href;
  const script = `
    import { readFileSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    const { compileAsset } = await import(${JSON.stringify(compilerUrl)});
    const input = JSON.parse(readFileSync(0, 'utf8'));
    input.files = input.files.map(file => ({ name: file.name, data: new Uint8Array(Buffer.from(file.base64, 'base64')) }));
    const result = await compileAsset(input);
    console.log(createHash('sha256').update(result.packageBytes).digest('hex'));
  `;
  for (const files of [fixtureFiles(), [{ name: 'scene.glb', data: fixtureGlb() }]]) {
    const entry = files[0]!.name, expected = await compileAsset({ files, entry, mode: 'lossless' });
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 30_000,
      input: JSON.stringify({ entry, mode: 'lossless', files: files.map(file => ({ name: file.name, base64: bytes(file.data).toString('base64') })) }),
    });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), sha(expected.packageBytes));
  }
});

test('Nested relative resources remain fully byte-exact', async () => {
  const files = fixtureFiles().map(file => ({ ...file, name: 'models/' + file.name }));
  const result = await compileAsset({ files, entry: 'models/model.gltf', mode: 'lossless' });
  sameFiles(files, (await decodePackage(result.packageBytes)).files);
});

test('Parent-directory URIs within upload root resolve correctly', async () => {
  const files = mutateFixture(json => { json.buffers[0].uri = '../shared/model.bin'; json.images[0].uri = '../shared/texture.png'; });
  files[0]!.name = 'models/model.gltf'; files[1]!.name = 'shared/model.bin'; files[2]!.name = 'shared/texture.png';
  const result = await compileAsset({ files, entry: 'models/model.gltf', mode: 'lossless' });
  sameFiles(files, (await decodePackage(result.packageBytes)).files);
});

test('Nested entries cannot shadow absolute or scheme-bearing resource URIs with uploads', async () => {
  for (const uri of ['/model.bin', '%2fmodel.bin', 'https://example.invalid/model.bin', 'https%3a%2f%2fexample.invalid/model.bin']) {
    const files = mutateFixture(json => { json.buffers[0].uri = uri; });
    files[0]!.name = 'models/model.gltf'; files[1]!.name = uri.includes('http') ? 'models/https:/example.invalid/model.bin' : 'models/model.bin'; files[2]!.name = 'models/texture.png';
    await assert.rejects(() => compileAsset({ files, entry: 'models/model.gltf', mode: 'lossless' }), `nested unsafe URI ${uri}`);
  }
});

test('Embedded data URI buffers and images survive exactly', async () => {
  const files = fixtureFiles(), json = JSON.parse(bytes(files[0]!.data).toString());
  for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + bytes(files.find(file => file.name === buffer.uri)!.data).toString('base64');
  for (const image of json.images) image.uri = 'data:image/png;base64,' + bytes(files.find(file => file.name === image.uri)!.data).toString('base64');
  const input = [{ name: 'embedded.gltf', data: encode(json) }], result = await compileAsset({ files: input, entry: 'embedded.gltf', mode: 'lossless' });
  sameFiles(input, (await decodePackage(result.packageBytes)).files);
});

test('Unknown optional extension metadata, extras and unused upload files are preserved', async () => {
  const files = mutateFixture(json => {
    json.extras = { preservation: { unicode: '狐🦊', null: null, number: 0.000000000123, list: [false, 0, ''] } };
    json.extensionsUsed = ['TEST_preserve_opaque']; json.extensions = { TEST_preserve_opaque: { payload: { a: 1, b: [2, 3] } } };
    json.nodes[0].extras = { keep: 'node metadata' }; json.materials[0].extras = { keep: 'material metadata' };
  });
  files.push({ name: 'LICENSE.txt', data: new TextEncoder().encode('Uploaded license metadata: preserve byte for byte\r\n') });
  const result = await compileAsset({ files, entry: 'model.gltf', mode: 'lossless' });
  sameFiles(files, (await decodePackage(result.packageBytes)).files);
});

test('Morph-target metadata and opaque sparse descriptions survive without semantic rewriting', async () => {
  const files = mutateFixture(json => {
    const mesh = json.meshes[0], primitive = mesh.primitives[0];
    mesh.weights = [0]; mesh.extras = { targetNames: ['preservation-probe'] }; primitive.targets = [{ POSITION: primitive.attributes.POSITION }];
    json.extensionsUsed = ['TEST_opaque_sparse_description'];
    json.extensions = { TEST_opaque_sparse_description: { sparse: { count: 1, indices: { bufferView: 0, componentType: 5123 }, values: { bufferView: 0 } } } };
  });
  const result = await compileAsset({ files, entry: 'model.gltf', mode: 'lossless' });
  sameFiles(files, (await decodePackage(result.packageBytes)).files);
});

test('Valid actual sparse accessor values and index resource survive byte-exact', async () => {
  const files = fixtureFiles(), json = JSON.parse(bytes(files[0]!.data).toString());
  const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION], view = json.bufferViews[accessor.bufferView];
  const resource = files.find(file => file.name === json.buffers[view.buffer].uri)!;
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), sparse = Buffer.alloc(16);
  sparse.writeUInt16LE(0, 0); bytes(resource.data).copy(sparse, 4, offset, offset + 12);
  const buffer = json.buffers.length, indices = json.bufferViews.length;
  json.buffers.push({ uri: 'sparse.bin', byteLength: 16 });
  json.bufferViews.push({ buffer, byteOffset: 0, byteLength: 2 }, { buffer, byteOffset: 4, byteLength: 12 });
  accessor.sparse = { count: 1, indices: { bufferView: indices, componentType: 5123 }, values: { bufferView: indices + 1 } };
  files[0]!.data = encode(json); files.push({ name: 'sparse.bin', data: new Uint8Array(sparse) });
  const result = await compileAsset({ files, entry: 'model.gltf', mode: 'lossless' });
  sameFiles(files, (await decodePackage(result.packageBytes)).files);
});

test('Unknown required extensions survive with an explicit compatibility warning', async () => {
  const files = mutateFixture(json => { json.extensionsRequired = ['TEST_required_residual']; json.extensionsUsed = ['TEST_required_residual']; json.extensions = { TEST_required_residual: { opaque: { keep: 'untouched' } } }; });
  const result = await compileAsset({ files, entry: 'model.gltf', mode: 'lossless' });
  sameFiles(files, (await decodePackage(result.packageBytes)).files);
  assert(result.manifest.warnings.some(warning => warning.includes('TEST_required_residual')));
  await assert.rejects(() => compileAsset({ files, entry: 'model.gltf', mode: 'quality' } as any));
});

test('Missing, duplicate, external and root-escaping resources fail closed', async () => {
  await assert.rejects(() => compileAsset({ files: fixtureFiles().filter(file => file.name !== 'model.bin'), entry: 'model.gltf', mode: 'lossless' }));
  await assert.rejects(() => compileAsset({ files: fixtureFiles().filter(file => file.name !== 'texture.png'), entry: 'model.gltf', mode: 'lossless' }));
  await assert.rejects(() => compileAsset({ files: [...fixtureFiles(), fixtureFiles()[1]!], entry: 'model.gltf', mode: 'lossless' }));
  await assert.rejects(() => compileAsset({ files: fixtureFiles(), entry: 'missing.gltf', mode: 'lossless' }));
  for (const uri of ['https://example.invalid/model.bin', 'file:///etc/passwd', '../model.bin', '%2e%2e/model.bin', '/model.bin']) {
    await assert.rejects(() => compileAsset({ files: mutateFixture(json => { json.buffers[0].uri = uri; }), entry: 'model.gltf', mode: 'lossless' }), `unsafe/unresolved URI ${uri}`);
  }
});

test('Malformed source and corrupt/truncated packages fail closed', async () => {
  await assert.rejects(() => compileAsset({ files: [{ name: 'bad.gltf', data: new TextEncoder().encode('{bad JSON') }], entry: 'bad.gltf', mode: 'lossless' }));
  const source = bytes(fixtureGlb()); source.writeUInt32LE(source.length + 4, 8);
  await assert.rejects(() => compileAsset({ files: [{ name: 'bad.glb', data: source }], entry: 'bad.glb', mode: 'lossless' }));
  const original = bytes((await compileAsset({ files: fixtureFiles(), entry: 'model.gltf', mode: 'lossless' })).packageBytes);
  for (const length of [0, 1, Math.floor(original.length / 2), original.length - 1]) await assert.rejects(() => decodePackage(original.subarray(0, length)));
  for (const at of [0, Math.floor(original.length / 2), original.length - 2]) {
    const bad = Buffer.from(original); bad[at] = bad[at]! ^ 1;
    await assert.rejects(() => decodePackage(bad));
  }
});

test('Sparse accessors reject out-of-bounds views and invalid index component types', async () => {
  const cases = [
    { count: 1, indices: { bufferView: 0, byteOffset: 99999999, componentType: 5123 }, values: { bufferView: 0, byteOffset: 99999999 } },
    { count: 1, indices: { bufferView: 0, componentType: 5126 }, values: { bufferView: 0 } },
    { count: 99999999, indices: { bufferView: 0, componentType: 5123 }, values: { bufferView: 0 } },
  ];
  for (const sparse of cases) await assert.rejects(() => compileAsset({ files: mutateFixture(json => { json.accessors[0].sparse = sparse; }), entry: 'model.gltf', mode: 'lossless' }));
});
