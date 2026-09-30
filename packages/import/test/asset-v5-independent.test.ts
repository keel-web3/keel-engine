import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, constants, deflateSync, inflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { decode as decodePNG } from 'fast-png';
import { compileAsset } from '../src/asset-compiler-v5.ts';
import { buildAsset, buildFromPackage, nativeBody } from '../src/asset-replay-v5.ts';
import { buildMixedAsset, MIXED_FORMAT } from '../src/asset-replay-mixed.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { normalizeAsset } from '../src/asset-normalize-v3.ts';
import { optimizeUnusedRenderAttributes, optimizeUnusedTangents } from '../src/optimization/exact-geometry-experiment.ts';
import { crc32, encodePng } from '../src/png.ts';

const utf8 = new TextEncoder(), widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const costCodec = { id: 'node-brotli-q4-independent-v1', compress: (a: Uint8Array) => brotliCompressSync(a, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) };
function join(parts: Uint8Array[]) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; }
function chunk(type: string, data: Uint8Array) { const out = new Uint8Array(data.length + 12), d = new DataView(out.buffer); d.setUint32(0, data.length); out.set(utf8.encode(type), 4); out.set(data, 8); d.setUint32(out.length - 4, crc32(out, 4, out.length - 4)); return out; }
function diagonalPng() {
  const data = new Uint8Array(128 * 128 * 4); for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) data.set(x < y * .8 + 12 ? [20, 170, 95, 255] : [201, 75, 217, 0], (y * 128 + x) * 4);
  const png = encodePng({ width: 128, height: 128, data });
  return join([png.slice(0, 33), chunk('IDAT', deflateSync(inflateSync(png.slice(41, -16)), { level: 1 })), png.slice(-12)]);
}
function imageInput(image = diagonalPng()) { return { entry: 'scene.gltf', files: [{ name: 'scene.gltf', data: utf8.encode(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'image.png' }] })) }, { name: 'image.png', data: image }] }; }
function fixture() {
  const arrays: ArrayBufferView[] = [], descriptors: any[] = [], views: any[] = [], blocks: Uint8Array[] = [];
  let offset = 0;
  const add = (array: ArrayBufferView & { length: number }, type: string, componentType = 5126, normalized = false) => {
    const id = arrays.length, padding = (4 - offset % 4) % 4; if (padding) { blocks.push(new Uint8Array(padding)); offset += padding; }
    arrays.push(array); views.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength }); blocks.push(bytes(array)); offset += array.byteLength;
    descriptors.push({ bufferView: id, componentType, type, count: array.length / widths[type]!, ...(normalized ? { normalized: true } : {}) }); return id;
  };
  const order = [0, 1, 2, 0, 2, 3], quad = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const position = add(new Float32Array(order.flatMap(i => quad[i]!)), 'VEC3');
  const normal = add(new Int8Array(order.flatMap(() => [0, 0, 127])), 'VEC3', 5120, true);
  const tangent = add(new Float32Array(order.flatMap(() => [1, 0, 0, 1])), 'VEC4');
  const uv0 = add(new Float32Array(order.flatMap(i => quad[i]!.slice(0, 2))), 'VEC2');
  const uv1 = add(new Float32Array(order.flatMap(i => quad[i]!.slice(0, 2))), 'VEC2');
  const joints = add(new Uint8Array(order.flatMap(() => [0, 1, 0, 0])), 'VEC4', 5121);
  const weights = add(new Uint16Array(order.flatMap(() => [32768, 32767, 0, 0])), 'VEC4', 5123, true);
  const color = add(new Uint8Array(order.flatMap(() => [200, 100, 75, 128])), 'VEC4', 5121, true);
  const morph = add(new Float32Array(order.flatMap(() => [.125, 0, 0])), 'VEC3');
  const ibm = add(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 'MAT4');
  const time = add(new Float32Array([0, 1]), 'SCALAR'), rotation = add(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]), 'VEC4');
  const primitive = { material: 0, attributes: { POSITION: position, NORMAL: normal, TANGENT: tangent, TEXCOORD_0: uv0, TEXCOORD_1: uv1, JOINTS_0: joints, WEIGHTS_0: weights, COLOR_0: color }, targets: [{ POSITION: morph }] };
  const json: any = { asset: { version: '2.0', extras: { author: 'Independent test', license: 'CC0' } }, buffers: [{ uri: 'buffer.bin', byteLength: offset }], bufferViews: views, accessors: descriptors, meshes: [{ weights: [.5], primitives: [primitive] }], nodes: [{ mesh: 0, skin: 0, rotation: [0, 0, 0, 1], children: [1, 2] }, { name: 'joint A' }, { name: 'joint B' }], skins: [{ joints: [1, 2], inverseBindMatrices: ibm }], animations: [{ samplers: [{ input: time, output: rotation, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }] }], scenes: [{ nodes: [0] }], scene: 0, materials: [{ alphaMode: 'BLEND', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 }, metallicFactor: 0 } }], textures: [{ source: 0, sampler: 0 }], samplers: [{ wrapS: 33071, wrapT: 33648 }], images: [{ uri: 'image.png' }] };
  const data = join(blocks), image = encodePng({ width: 1, height: 1, data: new Uint8Array([255, 127, 0, 90]) });
  return { json, arrays, image, input: () => ({ entry: 'scene.gltf', files: [{ name: 'scene.gltf', data: utf8.encode(JSON.stringify(json)) }, { name: 'buffer.bin', data }, { name: 'image.png', data: image }] }) };
}
// This parser intentionally does not use any production normalizer or replay accessor reader.
function inspectGlb(data: Uint8Array) {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength); assert.equal(d.getUint32(0, true), 0x46546c67); assert.equal(d.getUint32(8, true), data.length);
  let json: any, bin: Uint8Array = new Uint8Array(); for (let at = 12; at < data.length;) { const n = d.getUint32(at, true), type = d.getUint32(at + 4, true), payload = data.subarray(at + 8, at + 8 + n); if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(payload)); else if (type === 0x004e4942) bin = payload; at += 8 + n; }
  const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const arrays: Uint8Array[] = json.accessors?.map((a: any) => { const v = json.bufferViews[a.bufferView], stride = widths[a.type]! * sizes[a.componentType]!, out = new Uint8Array(a.count * stride); for (let i = 0; i < a.count; i++) { const at = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? stride); out.set(bin.subarray(at, at + stride), i * stride); } return out; }) ?? [];
  const indices = (p: any) => { if (p.indices === undefined) return Array.from({ length: json.accessors[p.attributes.POSITION].count }, (_, i) => i); const a = json.accessors[p.indices], b = arrays[p.indices]!, dv = new DataView(b.buffer, b.byteOffset, b.length); return Array.from({ length: a.count }, (_, i) => a.componentType === 5121 ? dv.getUint8(i) : a.componentType === 5123 ? dv.getUint16(i * 2, true) : dv.getUint32(i * 4, true)); };
  const images = (json.images ?? []).map((im: any) => { const v = json.bufferViews[im.bufferView]; return bin.slice(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); });
  return { json, arrays, images, indices };
}
function proveScene(source: ReturnType<typeof fixture>, glb: Uint8Array, visual: boolean) {
  const out = inspectGlb(glb), src = source.json, before = src.meshes[0].primitives[0], after = out.json.meshes[0].primitives[0], index = out.indices(after);
  assert.equal(index.length, 6);
  for (const [name, id] of Object.entries(before.attributes) as [string, number][]) {
    if (visual && ['TANGENT', 'TEXCOORD_0'].includes(name)) { assert.equal(after.attributes[name], undefined); continue; }
    const old = src.accessors[id], current = out.json.accessors[after.attributes[name]], expected = bytes(source.arrays[id]!), actual = out.arrays[after.attributes[name]]!, stride = expected.length / old.count;
    for (const key of ['componentType', 'type', 'normalized']) assert.equal(current[key], old[key], name + ' ' + key);
    index.forEach((v, corner) => assert.deepEqual(actual.slice(v * stride, (v + 1) * stride), expected.slice(corner * stride, (corner + 1) * stride), name + ' corner ' + corner));
  }
  const oldMorph = bytes(source.arrays[before.targets[0].POSITION]!); index.forEach((v, c) => assert.deepEqual(out.arrays[after.targets[0].POSITION]!.slice(v * 12, (v + 1) * 12), oldMorph.slice(c * 12, (c + 1) * 12)));
  for (const k of ['nodes', 'scenes', 'scene', 'materials', 'textures', 'samplers']) assert.deepEqual(out.json[k], src[k], k);
  assert.deepEqual(out.arrays[out.json.skins[0].inverseBindMatrices], bytes(source.arrays[src.skins[0].inverseBindMatrices]!));
  for (const k of ['input', 'output']) assert.deepEqual(out.arrays[out.json.animations[0].samplers[0][k]], bytes(source.arrays[src.animations[0].samplers[0][k]]!));
  assert.deepEqual(out.json.animations[0].channels, src.animations[0].channels); assert.equal(out.json.animations[0].samplers[0].interpolation, 'LINEAR');
  assert.deepEqual(decodePNG(out.images[0]!, { checkCrc: true }), decodePNG(source.image, { checkCrc: true }));
  return out;
}

test('v5 independently preserves every consumed typed corner, morph, skin, animation and scene record', async () => {
  const source = fixture(), result = await compileAsset({ ...source.input(), mode: 'visual-preservation', costCodec });
  const out = proveScene(source, result.preview.data, true); assert.equal(out.json.accessors[out.json.meshes[0].primitives[0].attributes.POSITION].count, 4);
  assert.equal(result.manifest.passes.unusedRenderInputs!.removedAccessors, 2); assert.equal(result.manifest.passes.renderWeld!.outputVertices, 4);
});

test('v5 lossless preserves all original accessor descriptors, bytes and order', async () => {
  const source = fixture(), result = await compileAsset({ ...source.input(), mode: 'lossless', costCodec }), out = proveScene(source, result.preview.data, false);
  assert.equal(out.arrays.length, source.arrays.length); source.arrays.forEach((a, i) => assert.deepEqual(out.arrays[i], bytes(a)));
});

test('unused-input gate retains normal maps, texture consumers, opaque metadata and custom attributes', async () => {
  const cases: [string, (s: ReturnType<typeof fixture>) => void][] = [
    ['normal map', s => { s.json.materials[0].normalTexture = { index: 0, texCoord: 0 }; }],
    ['extension', s => { s.json.materials[0].extensions = { EXT_custom_material: { tangentAccessor: 2 } }; }],
    ['declared extension', s => { s.json.extensionsUsed = ['EXT_custom_material']; }],
    ['root extras', s => { s.json.extras = { accessor: 2 }; }],
    ['nested extras', s => { s.json.nodes[0].extras = { accessor: 2 }; }],
    ['custom attribute', s => { s.json.meshes[0].primitives[0].attributes._CUSTOM = 2; }],
  ];
  for (const [name, change] of cases) { const s = fixture(), source = await normalizeAsset(s.input()); change({ ...s, json: source.json }); const result = optimizeUnusedRenderAttributes(source); assert.equal(result.report.removedAccessors, 0, name); assert.deepEqual(result.normalized.json, source.json, name); }
});

test('unused-input gate retains morph tangent and shared consumed accessors while compacting skin/animation references', async () => {
  const s = fixture(), p = s.json.meshes[0].primitives[0]; p.targets[0].TANGENT = p.targets[0].POSITION;
  const source = await normalizeAsset(s.input()), before = structuredClone(source), result = optimizeUnusedRenderAttributes(source);
  assert.equal(result.report.removedAccessors, 1); assert.notEqual(result.normalized.json.meshes[0].primitives[0].attributes.TANGENT, undefined); assert.deepEqual(source, before);
  const t = fixture(), q = structuredClone(t.json.meshes[0].primitives[0]); t.json.materials.push({ normalTexture: { index: 0, texCoord: 0 } }); q.material = 1; t.json.meshes[0].primitives.push(q);
  const normalized = await normalizeAsset(t.input()), mixed = optimizeUnusedRenderAttributes(normalized); assert.equal(mixed.report.removedAccessors, 0); assert.equal(mixed.normalized.json.meshes[0].primitives[0].attributes.TANGENT, undefined); assert.equal(mixed.normalized.json.meshes[0].primitives[1].attributes.TANGENT, 2);
  const tangentOnly = optimizeUnusedTangents(await normalizeAsset(fixture().input())); assert.deepEqual(tangentOnly.report.removedSemantics, ['TANGENT']);
});

test('v5 no cost codec and a losing exact-image candidate preserve noncanonical PNG pixels', async () => {
  const input = imageInput();
  for (const codec of [undefined, { id: 'reject-all-exact-candidates-test-v1', compress: (a: Uint8Array) => new Uint8Array(JSON.stringify(unpackAsset(a)).includes('exact-png-scanlines-v1') ? 1000000 : 1) }]) {
    const result = await compileAsset({ ...input, mode: 'lossless', costCodec: codec }); assert.deepEqual(decodePNG(inspectGlb(result.preview.data).images[0]!), decodePNG(input.files[1]!.data)); assert.equal(result.manifest.passes.exactImageTransport[0].selected, false);
  }
});

test('selected exact PNG transport removes the old payload and preserves non-IDAT chunks', async () => {
  const png = diagonalPng(), source = join([png.slice(0, 33), chunk('gAMA', new Uint8Array([0, 0, 177, 143])), png.slice(33)]), input = imageInput(source);
  const codec = { id: 'select-all-exact-candidates-test-v1', compress: (a: Uint8Array) => new Uint8Array(JSON.stringify(unpackAsset(a)).includes('exact-png-scanlines-v1') ? 1 : 1000000) };
  const result = await compileAsset({ ...input, mode: 'lossless', costCodec: codec }), recipe: any = unpackAsset(result.packageBytes), body = nativeBody(recipe.base);
  assert.equal(recipe.images.length, 1); assert.equal(body.native.base.images[0].data, null); assert.equal(body.native.images.some((x: any) => x.image === 0), false);
  const output = inspectGlb(result.preview.data).images[0]!; assert.deepEqual(output.slice(0, 49), source.slice(0, 49)); assert.deepEqual(decodePNG(output), decodePNG(source));
});

test('v5 rejects hostile wrapper versions, duplicate images, bad IDs and missing payloads', async () => {
  const codec = { id: 'select-all-test-v1', compress: (a: Uint8Array) => new Uint8Array(JSON.stringify(unpackAsset(a)).includes('exact-png-scanlines-v1') ? 1 : 1000000) };
  const result = await compileAsset({ ...imageInput(), mode: 'lossless', costCodec: codec }), recipe: any = unpackAsset(result.packageBytes); assert.equal(recipe.images.length, 1);
  for (const change of [(r: any) => { r.compilerVersion = 'future'; }, (r: any) => { r.mode = 'bounded-lossy'; }, (r: any) => { r.images.push(r.images[0]); }, (r: any) => { r.images[0].image = -1; }, (r: any) => { r.images[0].image = 0.5; }, (r: any) => { r.images[0].image = 100; }, (r: any) => { r.images[0].recipe.scanlines[0] ^= 1; }, (r: any) => { r.images = []; }]) { const r = structuredClone(recipe); change(r); await assert.rejects(buildAsset(r)); }
});

test('v5 requires explicit image replacement markers instead of overwriting another payload', async () => {
  const codec = { id: 'select-all-test-v1', compress: (a: Uint8Array) => new Uint8Array(JSON.stringify(unpackAsset(a)).includes('exact-png-scanlines-v1') ? 1 : 1000000) };
  const input = imageInput(), result = await compileAsset({ ...input, mode: 'lossless', costCodec: codec }), recipe: any = unpackAsset(result.packageBytes), body = nativeBody(recipe.base);
  body.native.base.images[0].data = { codec: 'raw', parameters: { version: 1 }, sourceLength: input.files[1]!.data.length, data: input.files[1]!.data };
  await assert.rejects(buildAsset(recipe), /marker|overlap|override|image/i);
});

test('mixed primitive recipe rejects duplicate mappings and descriptor budgets before invoking decoder', async () => {
  const source = fixture(), compiled = await compileAsset({ ...source.input(), mode: 'lossless' }), original: any = unpackAsset(compiled.packageBytes), descriptors = nativeBody(original.base).native.base.descriptors;
  const mini = { asset: { version: '2.0' }, accessors: [{ ...descriptors[0] }, { ...descriptors[0] }], meshes: [{ primitives: [] }] };
  await assert.rejects(buildMixedAsset({ format: MIXED_FORMAT, version: 1, base: original.base, accessorMap: [0, 0], json: mini, blocks: [] }, { dracoDecoder: {} }), /descriptor/i);
  const enormous = structuredClone(original.base), d = nativeBody(enormous).native.base.descriptors[0]; d.count = 1000000000;
  await assert.rejects(buildMixedAsset({ format: MIXED_FORMAT, version: 1, base: enormous, accessorMap: [0], json: { ...mini, accessors: [d] }, blocks: [] }, { dracoDecoder: {} }), /budget|limit|count/i);
});

test('lossless mixed replay retains an existing Draco primitive stream and matches independent decoder records', async () => {
  const moduleName = 'draco3dgltf', draco = (await import(moduleName)).default, encoder = await draco.createEncoderModule(), decoder = await draco.createDecoderModule();
  const mesh = new encoder.Mesh(), builder = new encoder.MeshBuilder(), codec = new encoder.Encoder(), output = new encoder.DracoInt8Array();
  let block: Uint8Array, attribute: number;
  try {
    builder.AddFacesToMesh(mesh, 2, new Uint32Array([0, 1, 2, 0, 2, 3]));
    attribute = builder.AddFloatAttributeToMesh(mesh, encoder.POSITION, 4, 3, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
    codec.SetEncodingMethod(encoder.MESH_SEQUENTIAL_ENCODING); codec.SetSpeedOptions(5, 5);
    const n = codec.EncodeMeshToDracoBuffer(mesh, output); assert(n > 0); block = Uint8Array.from({ length: n }, (_, i) => output.GetValue(i));
  } finally { for (const item of [output, codec, builder, mesh]) encoder.destroy(item); }
  const reader = new decoder.Decoder(), buffer = new decoder.DecoderBuffer(), decodedMesh = new decoder.Mesh(), values = new decoder.DracoFloat32Array(), face = new decoder.DracoInt32Array();
  let positions: Float32Array, indices: Uint16Array;
  try {
    buffer.Init(block!, block!.length); const status = reader.DecodeBufferToMesh(buffer, decodedMesh); assert(status.ok()); decoder.destroy(status);
    reader.GetAttributeFloatForAllPoints(decodedMesh, reader.GetAttributeByUniqueId(decodedMesh, attribute!), values); positions = Float32Array.from({ length: values.size() }, (_, i) => values.GetValue(i));
    indices = new Uint16Array(decodedMesh.num_faces() * 3); for (let i = 0; i < decodedMesh.num_faces(); i++) { assert(reader.GetFaceFromMesh(decodedMesh, i, face)); for (let c = 0; c < 3; c++) indices[i * 3 + c] = face.GetValue(c); }
  } finally { for (const item of [face, values, decodedMesh, buffer, reader]) decoder.destroy(item); }
  const json = { asset: { version: '2.0' }, buffers: [{ uri: 'primitive.drc', byteLength: block!.length }], bufferViews: [{ buffer: 0, byteLength: block!.length }], accessors: [{ componentType: 5126, type: 'VEC3', count: positions!.length / 3 }, { componentType: 5123, type: 'SCALAR', count: indices!.length }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: attribute! } } } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] };
  const input = { entry: 'scene.gltf', files: [{ name: 'scene.gltf', data: utf8.encode(JSON.stringify(json)) }, { name: 'primitive.drc', data: block! }], mode: 'lossless', dracoDecoder: decoder };
  const result = await compileAsset(input), recipe: any = unpackAsset(result.packageBytes), actual = inspectGlb(result.preview.data);
  assert.equal(recipe.base.format, MIXED_FORMAT); assert.equal(recipe.base.blocks.length, 1); assert.deepEqual(recipe.base.blocks[0], block!); assert.deepEqual(actual.arrays[0], bytes(positions!)); assert.deepEqual(actual.arrays[1], bytes(indices!));
  assert.deepEqual((await buildFromPackage(result.packageBytes, { dracoDecoder: decoder })).glb, result.preview.data);
  const again = await compileAsset(input); assert.deepEqual(again.packageBytes, result.packageBytes); assert.deepEqual(again.manifest, result.manifest);
  const bad = structuredClone(recipe), body = nativeBody(bad.base), owner = body.native.base.surfaces[0]; owner.recipe.positions = { kind: 'residual', buffer: { codec: 'raw', parameters: { version: 1 }, sourceLength: positions!.byteLength, data: bytes(positions!) } };
  await assert.rejects(buildAsset(bad, { dracoDecoder: decoder }), /marker|overlap/i);
});

test('v5 small repeated compilations and browser-target replay are byte deterministic', async () => {
  const input = fixture().input(), a = await compileAsset({ ...input, mode: 'visual-preservation', costCodec }), b = await compileAsset({ ...input, mode: 'visual-preservation', costCodec }); assert.deepEqual(a.packageBytes, b.packageBytes); assert.deepEqual(a.preview.data, b.preview.data);
  const bundled = await build({ stdin: { contents: "export {buildFromPackage} from './packages/import/src/asset-replay-v5.ts'", resolveDir: new URL('../../..', import.meta.url).pathname }, write: false, bundle: true, minify: true, external: ['node:*'], platform: 'browser', format: 'esm', target: 'es2022' });
  const browser = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.contents).toString('base64')), actual = await browser.buildFromPackage(a.packageBytes), expected = await buildFromPackage(a.packageBytes);
  assert.deepEqual(actual.glb, expected.glb); assert.deepEqual(actual.accessors, expected.accessors);
});
