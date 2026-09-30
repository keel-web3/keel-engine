import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, constants } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { decode as decodePNG } from 'fast-png';
import { unzipSync } from 'fflate';
import { compileAsset as compileV4 } from '../src/asset-compiler-v4.ts';
import { compileAsset as compileV5 } from '../src/asset-compiler-v5.ts';
import { compileAsset as compileV6, makeNativeArchive } from '../src/asset-compiler-v6.ts';
import { buildAsset, buildFromPackage, COMPILER_VERSION, V6_FORMAT } from '../src/asset-replay-v6.ts';
import { nativeBody } from '../src/asset-replay-v5.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { crc32, encodePng } from '../src/png.ts';

const utf8 = new TextEncoder();
const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const costCodec = { id: 'independent-v6-node-brotli-q4', compress: (a: Uint8Array) => brotliCompressSync(a, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) };
const forcePng = { id: 'independent-v6-select-png-test-only', compress: (a: Uint8Array) => new Uint8Array(JSON.stringify(unpackAsset(a)).includes('exact-png-scanlines-v1') ? 1 : 1000000) };
const geometry = { targetRatio: .5, maxError: .01, samplesPerClip: 3, maxSurfaceSamples: 32 };
const textures = { maxDimension: 16, quality: 65, maxRgbaRmse: 255, maxRgbaError: 255, maxAlphaRmse: 255, maxAlphaError: 255, maxAlphaCoverageError: 1 };
function join(parts: Uint8Array[]) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; }
function chunk(type: string, data: Uint8Array) { const out = new Uint8Array(data.length + 12), d = new DataView(out.buffer); d.setUint32(0, data.length); out.set(utf8.encode(type), 4); out.set(data, 8); d.setUint32(out.length - 4, crc32(out, 4, out.length - 4)); return out; }

function fixture(seams = true, metadata = false) {
  const descriptors: any[] = [], views: any[] = [], blocks: Uint8Array[] = [];
  let offset = 0;
  const add = (array: ArrayBufferView & { length: number }, type: string, componentType = 5126, normalized = false) => {
    const id = descriptors.length, padding = (4 - offset % 4) % 4; if (padding) { blocks.push(new Uint8Array(padding)); offset += padding; }
    views.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength }); blocks.push(bytes(array)); offset += array.byteLength;
    descriptors.push({ bufferView: id, componentType, type, count: array.length / widths[type]!, ...(normalized ? { normalized: true } : {}) }); return id;
  };
  const position: number[] = [], normal: number[] = [], tangent: number[] = [], uv: number[] = [], joints: number[] = [], weights: number[] = [], morph: number[] = [], index: number[] = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) for (const triangle of [[[x, y], [x + 1, y], [x + 1, y + 1]], [[x, y], [x + 1, y + 1], [x, y + 1]]]) {
    const triangleId = position.length / 9;
    for (const [px, py] of triangle) { position.push(px! / 4, py! / 4, 0); normal.push(0, 0, 127); tangent.push(seams ? triangleId : 1, 0, 0, 1); uv.push(px! / 4, py! / 4); joints.push(0, 1, 0, 0); weights.push(32768, 32767, 0, 0); morph.push(.02, 0, .04); }
  }
  if (!seams) {
    position.length = normal.length = tangent.length = uv.length = joints.length = weights.length = morph.length = 0;
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) { position.push(x / 4, y / 4, 0); normal.push(0, 0, 127); tangent.push(1, 0, 0, 1); uv.push(x / 4, y / 4); joints.push(0, 1, 0, 0); weights.push(32768, 32767, 0, 0); morph.push(.02, 0, .04); }
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const a = y * 5 + x; index.push(a, a + 1, a + 6, a, a + 6, a + 5); }
  }
  const attributes = { POSITION: add(Float32Array.from(position), 'VEC3'), NORMAL: add(Int8Array.from(normal), 'VEC3', 5120, true), TANGENT: add(Float32Array.from(tangent), 'VEC4'), TEXCOORD_0: add(Float32Array.from(uv), 'VEC2'), TEXCOORD_1: add(Float32Array.from(uv), 'VEC2'), JOINTS_0: add(Uint8Array.from(joints), 'VEC4', 5121), WEIGHTS_0: add(Uint16Array.from(weights), 'VEC4', 5123, true) };
  const targets = [{ POSITION: add(Float32Array.from(morph), 'VEC3') }], indices = seams ? {} : { indices: add(Uint16Array.from(index), 'SCALAR', 5123) };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const inverse = add(new Float32Array([...identity, ...identity]), 'MAT4'), time = add(new Float32Array([0, 1]), 'SCALAR'), translation = add(new Float32Array([0, 0, 0, .3, .1, .2]), 'VEC3');
  const json: any = { asset: { version: '2.0', extras: { author: 'Independent v6 audit', license: 'CC0' } }, buffers: [{ uri: 'buffer.bin', byteLength: offset }], bufferViews: views, accessors: descriptors, meshes: [{ weights: [.5], primitives: [{ material: 0, attributes, targets, ...indices }] }], nodes: [{ mesh: 0, skin: 0, children: [1, 2] }, { name: 'animated joint' }, { name: 'rest joint', translation: [0, 0, -.1] }], skins: [{ joints: [1, 2], inverseBindMatrices: inverse }], animations: [{ samplers: [{ input: time, output: translation, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }], scenes: [{ nodes: [0] }], scene: 0, materials: [{ alphaMode: 'BLEND', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }], textures: [{ source: 0, sampler: 0 }], samplers: [{ wrapS: 33071, wrapT: 33071, magFilter: 9728, minFilter: 9728 }], images: [{ uri: 'image.png' }] };
  const pixels = new Uint8Array(64 * 64 * 4); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels.set([x * 4, y * 4, 100, 160], (y * 64 + x) * 4);
  const png = encodePng({ width: 64, height: 64, data: pixels }), image = metadata ? join([png.slice(0, 33), chunk('gAMA', new Uint8Array([0, 0, 177, 143])), png.slice(33)]) : png;
  const data = join(blocks);
  return { json, image, input: () => ({ entry: 'scene.gltf', files: [{ name: 'scene.gltf', data: utf8.encode(JSON.stringify(json)) }, { name: 'buffer.bin', data }, { name: 'image.png', data: image }] }) };
}

// Independent GLB/accessor reader: no production normalizer, pose evaluator,
// accessor reader or optimizer is used by the corner, pose or raster assertions.
function inspectGlb(data: Uint8Array) {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength); assert.equal(d.getUint32(0, true), 0x46546c67); assert.equal(d.getUint32(8, true), data.length);
  let json: any, bin: Uint8Array = new Uint8Array();
  for (let at = 12; at < data.length;) { const n = d.getUint32(at, true), type = d.getUint32(at + 4, true), payload = data.subarray(at + 8, at + 8 + n); if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(payload)); else if (type === 0x004e4942) bin = payload; at += 8 + n; }
  const arrays: Uint8Array[] = (json.accessors ?? []).map((a: any) => { const v = json.bufferViews[a.bufferView], stride = widths[a.type]! * sizes[a.componentType]!, out = new Uint8Array(a.count * stride); for (let i = 0; i < a.count; i++) { const at = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? stride); out.set(bin.subarray(at, at + stride), i * stride); } return out; });
  const values = (id: number) => { const a = json.accessors[id], b = arrays[id]!, v = new DataView(b.buffer, b.byteOffset, b.length); return Array.from({ length: a.count * widths[a.type]! }, (_, i) => { const at = i * sizes[a.componentType]!; let x = a.componentType === 5120 ? v.getInt8(at) : a.componentType === 5121 ? v.getUint8(at) : a.componentType === 5122 ? v.getInt16(at, true) : a.componentType === 5123 ? v.getUint16(at, true) : a.componentType === 5125 ? v.getUint32(at, true) : v.getFloat32(at, true); if (a.normalized) x = a.componentType === 5120 ? Math.max(-1, x / 127) : a.componentType === 5121 ? x / 255 : a.componentType === 5122 ? Math.max(-1, x / 32767) : x / 65535; return x; }); };
  const indices = (p: any) => p.indices === undefined ? Array.from({ length: json.accessors[p.attributes.POSITION].count }, (_, i) => i) : values(p.indices);
  const images: Uint8Array[] = (json.images ?? []).map((im: any) => { const v = json.bufferViews[im.bufferView]; return bin.slice(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); });
  return { json, arrays, values, images, indices };
}
type Inspected = ReturnType<typeof inspectGlb>;
function protectedRecords(s: Inspected) {
  const record: any = Object.fromEntries(['asset', 'nodes', 'skins', 'animations', 'materials', 'samplers', 'textures', 'cameras', 'scenes', 'scene'].map(k => [k, structuredClone(s.json[k] ?? null)]));
  const accessor = (id: number) => ({ type: s.json.accessors[id].type, componentType: s.json.accessors[id].componentType, normalized: s.json.accessors[id].normalized ?? false, count: s.json.accessors[id].count, data: s.arrays[id] });
  for (const skin of record.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = accessor(skin.inverseBindMatrices);
  for (const animation of record.animations ?? []) for (const sampler of animation.samplers) { sampler.input = accessor(sampler.input); sampler.output = accessor(sampler.output); }
  return record;
}
function assertCorners(before: Inspected, after: Inspected, removed = ['TANGENT', 'TEXCOORD_1']) {
  assert.deepEqual(protectedRecords(after), protectedRecords(before));
  for (let mi = 0; mi < before.json.meshes.length; mi++) for (let pi = 0; pi < before.json.meshes[mi].primitives.length; pi++) {
    const a = before.json.meshes[mi].primitives[pi], b = after.json.meshes[mi].primitives[pi], ai = before.indices(a), bi = after.indices(b); assert.equal(bi.length, ai.length);
    for (const name of removed) assert.equal(b.attributes[name], undefined, name);
    const groups = [[a.attributes, b.attributes], ...(a.targets ?? []).map((target: any, i: number) => [target, b.targets[i]])];
    for (const [old, current] of groups) for (const [semantic, id] of Object.entries(current) as [string, number][]) {
      const oldId = old[semantic], ad = before.json.accessors[oldId], bd = after.json.accessors[id], stride = widths[ad.type]! * sizes[ad.componentType]!;
      for (const field of ['type', 'componentType', 'normalized']) assert.equal(bd[field], ad[field], semantic + ' descriptor');
      bi.forEach((v, i) => assert.deepEqual(after.arrays[id]!.slice(v * stride, (v + 1) * stride), before.arrays[oldId]!.slice(ai[i]! * stride, (ai[i]! + 1) * stride), semantic + ' corner ' + i));
      if (semantic === 'NORMAL' || /^TEXCOORD_/.test(semantic)) {
        const av = before.values(oldId), bv = after.values(id), width = widths[ad.type]!;
        for (let t = 0; t < ai.length; t += 3) for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.2, .3, .5]]) for (let k = 0; k < width; k++) assert.equal(weights.reduce((n, w, c) => n + w * bv[bi[t + c]! * width + k]!, 0), weights.reduce((n, w, c) => n + w * av[ai[t + c]! * width + k]!, 0));
      }
    }
  }
  assert.equal(after.images.length, before.images.length); before.images.forEach((image, i) => assert.deepEqual(decodePNG(after.images[i]!, { checkCrc: true }), decodePNG(image, { checkCrc: true })));
}
function posedVertices(s: Inspected, time: number) {
  const p = s.json.meshes[0].primitives[0], position = s.values(p.attributes.POSITION), morph = s.values(p.targets[0].POSITION), weights = s.values(p.attributes.WEIGHTS_0), joints = s.values(p.attributes.JOINTS_0), inverse = s.values(s.json.skins[0].inverseBindMatrices), sampler = s.json.animations[0].samplers[0], times = s.values(sampler.input), translations = s.values(sampler.output), factor = (time - times[0]!) / (times[1]! - times[0]!), morphWeight = s.json.meshes[0].weights[0];
  const animated = [0, 1, 2].map(k => translations[k]! * (1 - factor) + translations[3 + k]! * factor), rest = s.json.nodes[2].translation;
  return Array.from({ length: position.length / 3 }, (_, i) => {
    const local = [0, 1, 2].map(k => position[i * 3 + k]! + morph[i * 3 + k]! * morphWeight), total = weights.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0), out = [0, 0, 0];
    for (let influence = 0; influence < 4; influence++) { const joint = joints[i * 4 + influence]!, w = weights[i * 4 + influence]! / total, transform = joint === 0 ? animated : rest, base = joint * 16; for (let k = 0; k < 3; k++) out[k]! += w * (inverse[base + k]! * local[0]! + inverse[base + 4 + k]! * local[1]! + inverse[base + 8 + k]! * local[2]! + inverse[base + 12 + k]! + transform[k]!); }
    return out;
  });
}
function render(s: Inspected, time: number) {
  const p = s.json.meshes[0].primitives[0], vertices = posedVertices(s, time), ids = s.indices(p), uv = s.values(p.attributes.TEXCOORD_0), normal = s.values(p.attributes.NORMAL), texture = decodePNG(s.images[0]!), size = 48, rgba = new Uint8Array(size * size * 4), coverage = new Uint8Array(size * size), depth = new Float64Array(size * size).fill(Infinity);
  const screen = vertices.map(v => [(v[0]! + .25 * v[2]! + .1) * size / 1.5, (v[1]! - .2 * v[2]! + .1) * size / 1.5, v[2]!]);
  for (let at = 0; at < ids.length; at += 3) { const index = ids.slice(at, at + 3), a = screen[index[0]!]!, b = screen[index[1]!]!, c = screen[index[2]!]!, denom = (b[1]! - c[1]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[1]! - c[1]!); if (!denom) continue;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const w0 = ((b[1]! - c[1]!) * (x + .5 - c[0]!) + (c[0]! - b[0]!) * (y + .5 - c[1]!)) / denom, w1 = ((c[1]! - a[1]!) * (x + .5 - c[0]!) + (a[0]! - c[0]!) * (y + .5 - c[1]!)) / denom, w = [w0, w1, 1 - w0 - w1]; if (w.some(v => v < -1e-9)) continue;
      const z = w.reduce((sum, v, i) => sum + v * screen[index[i]!]![2]!, 0), dst = y * size + x; if (z >= depth[dst]!) continue; depth[dst] = z; coverage[dst] = 1;
      const interpolate = (data: number[], width: number, k: number) => w.reduce((sum, v, i) => sum + v * data[index[i]! * width + k]!, 0), u = interpolate(uv, 2, 0), v = interpolate(uv, 2, 1), tx = Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width))), ty = Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height))), texel = (ty * texture.width + tx) * 4, light = .25 + .75 * Math.max(0, interpolate(normal, 3, 2));
      for (let k = 0; k < 4; k++) rgba[dst * 4 + k] = Math.round(texture.data[texel + k]! * (k === 3 ? 1 : light));
    }
  }
  assert.ok(coverage.some(x => x > 0)); return { rgba, coverage, depth: bytes(depth) };
}
function support(decoder = 'export async function buildFromPackage(){throw Error("test fixture")}') { return { decoder, licenses: ['LICENSE-KEEL.txt', 'LICENSE-fflate.txt', 'LICENSE-Draco-Apache-2.0.txt', 'LICENSE-meshoptimizer.txt'].map(name => ({ name, data: 'Independent archive shape fixture: ' + name })) }; }

test('v6 preserves the actual v4 lossy passes, retained typed corners, morphs, poses, interpolation and CPU pixels', async () => {
  for (const seams of [true, false]) {
    const s = fixture(seams), input = { ...s.input(), mode: 'bounded-lossy', geometry, textures }, original = structuredClone(input), baseline = await compileV4(input), result = await compileV6({ ...input, costCodec: forcePng }), a = inspectGlb(baseline.preview.data), b = inspectGlb(result.preview.data);
    assert.deepEqual(input, original); assert.deepEqual(result.manifest.passes.geometry, baseline.manifest.passes.geometry); assert.deepEqual(result.manifest.passes.textures, baseline.manifest.passes.textures); assert.deepEqual(result.manifest.settings.geometry, baseline.manifest.settings.geometry); assert.deepEqual(result.manifest.settings.textures, baseline.manifest.settings.textures);
    assert.equal(result.manifest.passes.textures.changedImages, 1); assert.ok((result.manifest.passes as any).renderInputPostpass.pruning.removedAccessors >= 2); assertCorners(a, b);
    const ap = a.json.meshes[0].primitives[0], bp = b.json.meshes[0].primitives[0];
    if (seams) { assert.equal(baseline.manifest.passes.geometry.outputTriangles, 32); assert.ok(b.json.accessors[bp.attributes.POSITION].count < a.json.accessors[ap.attributes.POSITION].count); }
    else assert.ok(baseline.manifest.passes.geometry.outputTriangles < 32, 'fixture exercises accepted v4 simplification');
    for (const time of [0, .37, 1]) { const av = posedVertices(a, time), bv = posedVertices(b, time), ai = a.indices(ap), bi = b.indices(bp); bi.forEach((v, c) => assert.deepEqual(bv[v], av[ai[c]!])); assert.deepEqual(render(b, time), render(a, time)); }
    const validation: any = result.manifest.validation; assert.equal(validation.postpassAddsNoGeometryOrTextureLoss, true); assert.equal(validation.renderedInputsExactToAcceptedV4, true); assert.equal(validation.sourceProtectedSceneExact, true); assert.equal(result.manifest.mode, 'bounded-lossy');
    assert.deepEqual((await buildFromPackage(result.packageBytes)).glb, result.preview.data);
  }
});

test('v6 retains normal-map/morph tangent consumers, custom attributes and opaque extension or extras gates', async () => {
  const cases: [string, (s: ReturnType<typeof fixture>) => void, string[]][] = [
    ['normal map', s => { s.json.materials[0].normalTexture = { index: 0, texCoord: 1 }; }, []],
    ['morph tangent', s => { const p = s.json.meshes[0].primitives[0]; p.targets[0].TANGENT = p.targets[0].POSITION; }, ['TEXCOORD_1']],
    ['custom attribute', s => { const p = s.json.meshes[0].primitives[0]; p.attributes._CUSTOM = p.attributes.TANGENT; }, []],
    ['opaque extras', s => { s.json.nodes[0].extras = { observeVertex: 2 }; }, []],
  ];
  for (const [name, change, removed] of cases) { const s = fixture(); change(s); const input = { ...s.input(), mode: 'bounded-lossy', geometry }, a = await compileV4(input), b = await compileV6(input); assert.deepEqual(b.manifest.passes.geometry, a.manifest.passes.geometry, name); assertCorners(inspectGlb(a.preview.data), inspectGlb(b.preview.data), removed); const p = inspectGlb(b.preview.data).json.meshes[0].primitives[0]; assert.notEqual(p.attributes.TANGENT, undefined, name); if (!removed.length) assert.equal((b.manifest.passes as any).renderInputPostpass.pruning.changedPrimitives, 0, name); }
  for (const change of [(s: ReturnType<typeof fixture>) => { s.json.materials[0].extensions = { EXT_audit: { accessor: 2 } }; }, (s: ReturnType<typeof fixture>) => { s.json.extensionsUsed = ['EXT_audit']; }]) { const s = fixture(); change(s); const input = { ...s.input(), mode: 'bounded-lossy', geometry }; await assert.rejects(compileV4(input), /unsupported.*extension/); await assert.rejects(compileV6(input), /unsupported.*extension/); }
});

test('v6 exact PNG override preserves v4 decoded RGBA and non-IDAT color metadata', async () => {
  const s = fixture(true, true), input = { ...s.input(), mode: 'bounded-lossy', geometry }, a = await compileV4(input), b = await compileV6({ ...input, costCodec: forcePng }), recipe: any = unpackAsset(b.packageBytes);
  assert.equal(recipe.format, V6_FORMAT); assert.equal(recipe.compilerVersion, COMPILER_VERSION); assert.equal(recipe.mode, 'bounded-lossy'); assert.equal(recipe.images.length, 1); assert.equal(nativeBody(recipe.base).mode, 'bounded-lossy');
  const before = inspectGlb(a.preview.data).images[0]!, after = inspectGlb(b.preview.data).images[0]!; assert.deepEqual(after.slice(0, 49), before.slice(0, 49)); assert.deepEqual(decodePNG(after), decodePNG(before)); assert.equal(nativeBody(recipe.base).native.base.images[0].data, null); assert.equal(nativeBody(recipe.base).native.images.length, 0);
});

test('v6 delegates exact-data and appearance modes to frozen v5 with unchanged bytes and manifest', async () => {
  for (const mode of ['lossless', 'visual-preservation', undefined]) { const input = { ...fixture().input(), mode, costCodec }, a = await compileV5(input), b = await compileV6(input); assert.deepEqual(b.packageBytes, a.packageBytes); assert.deepEqual(b.preview, a.preview); assert.deepEqual(b.manifest, a.manifest); assert.deepEqual((await buildFromPackage(b.packageBytes)).glb, a.preview.data); }
});

test('v6 full manifest, package, preview and archive repeat exactly with and without selected PNG transport', async () => {
  for (const codec of [undefined, forcePng]) { const input = { ...fixture().input(), mode: 'bounded-lossy', geometry, textures, costCodec: codec }, a = await compileV6(input), b = await compileV6(input); assert.deepEqual(b.packageBytes, a.packageBytes); assert.deepEqual(b.preview, a.preview); assert.deepEqual(b.manifest, a.manifest); assert.equal(b.program, a.program); const first = makeNativeArchive(a, support()), second = makeNativeArchive(b, support()); assert.deepEqual(second, first); const archive = unzipSync(first); assert.deepEqual(archive['asset-data.kap'], a.packageBytes); assert.deepEqual(JSON.parse(new TextDecoder().decode(archive['manifest.json'])), a.manifest); }
});

test('v6 rejects malformed wrappers, overlapping PNG owners, damaged PNG records and oversized decoded accessors', async () => {
  const result = await compileV6({ ...fixture().input(), mode: 'bounded-lossy', geometry, costCodec: forcePng }), original: any = unpackAsset(result.packageBytes);
  const mutations: [string, (r: any) => void][] = [
    ['version', r => { r.compilerVersion = 'future'; }], ['mode', r => { r.mode = 'lossless'; }], ['unknown format', r => { r.format = 'UNKNOWN-V6'; }], ['null base', r => { r.base = null; }], ['unknown base', r => { r.base = { format: V6_FORMAT }; }], ['null images', r => { r.images = null; }], ['duplicate image', r => { r.images.push(r.images[0]); }], ['negative image', r => { r.images[0].image = -1; }], ['fractional image', r => { r.images[0].image = .5; }], ['out-of-range image', r => { r.images[0].image = 999; }], ['missing image', r => { r.images = []; }], ['PNG checksum', r => { r.images[0].recipe.scanlines[0] ^= 1; }], ['PNG dimensions', r => { r.images[0].recipe.width++; }], ['PNG extent', r => { r.images[0].recipe.scanlines = r.images[0].recipe.scanlines.slice(1); }], ['PNG pixel budget', r => { const p = r.images[0].recipe.prefix, d = new DataView(p.buffer, p.byteOffset, p.byteLength); d.setUint32(16, 0xffffffff); d.setUint32(29, crc32(p, 12, 29)); }],
    ['raw PNG owner overlap', r => { nativeBody(r.base).native.base.images[0].data = { codec: 'raw', parameters: { version: 1 }, sourceLength: 1, data: new Uint8Array([0]) }; }],
    ['PNG override overlap', r => { nativeBody(r.base).native.images.push({ image: 0, recipe: {} }); }],
    ['decoded accessor budget', r => { const body = nativeBody(r.base); body.native.base.descriptors[0].count = 1000000000; }],
  ];
  for (const [name, mutate] of mutations) { const recipe = structuredClone(original); mutate(recipe); await assert.rejects(buildAsset(recipe), name); await assert.rejects(buildFromPackage(packAsset(recipe)), name + ' packed'); }
  await assert.rejects(compileV6({ ...fixture().input(), mode: 'bounded-lossy' }), /explicit/); await assert.rejects(compileV6({ ...fixture().input(), mode: 'unsupported' }), /supports|mode/); await assert.rejects(compileV6({ ...fixture().input(), mode: 'bounded-lossy', geometry, costCodec: { id: 'bad' } }), /codec/);
});

test('v6 browser-target replay runs without Node globals and reconstructs the complete archive payload', async () => {
  const output = await build({ stdin: { contents: "export {buildFromPackage} from './packages/import/src/asset-replay-v6.ts'", resolveDir: new URL('../../..', import.meta.url).pathname }, write: false, bundle: true, minify: true, platform: 'browser', format: 'iife', globalName: 'V6Runtime', target: 'es2022', define: { 'import.meta.url': '"https://audit.invalid/asset-decoder.mjs"' } });
  const decoder = new TextDecoder().decode(output.outputFiles[0]!.contents), globals = { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, TextDecoder, TextEncoder, WebAssembly, atob, btoa, performance, crypto };
  // Node's VM has no structuredClone. Clone this byte/JSON recipe inside the VM
  // so objects keep their browser realm, instead of injecting Node object prototypes.
  const clone = 'globalThis.structuredClone = function clone(v){if(v===null||typeof v!=="object")return v;if(ArrayBuffer.isView(v))return new v.constructor(v);if(Array.isArray(v))return v.map(clone);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));};';
  const runtime = runInNewContext(clone + decoder + ';V6Runtime', globals); assert.equal((globals as any).Buffer, undefined); assert.equal((globals as any).process, undefined); assert.equal((globals as any).require, undefined);
  const result = await compileV6({ ...fixture().input(), mode: 'bounded-lossy', geometry, textures, costCodec: forcePng }), archive = unzipSync(makeNativeArchive(result, support(decoder))), actual = await runtime.buildFromPackage(archive['asset-data.kap']); assert.deepEqual(new Uint8Array(actual.glb), result.preview.data);
});

test('v6 extracted complete archive executes its generated entry point with only the shipped runtime and payload', async () => {
  const output = await build({ stdin: { contents: "export {buildFromPackage} from './packages/import/src/asset-replay-v6.ts'", resolveDir: new URL('../../..', import.meta.url).pathname }, write: false, bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2022' });
  const decoder = new TextDecoder().decode(output.outputFiles[0]!.contents);
  for (const mode of ['bounded-lossy', 'lossless', 'visual-preservation']) {
    const input = { ...fixture(false).input(), mode, geometry, textures, costCodec: forcePng }, result = await compileV6(input), again = await compileV6(input), archive = makeNativeArchive(result, support(decoder));
    assert.deepEqual(makeNativeArchive(again, support(decoder)), archive);
    const directory = await mkdtemp(joinPath(tmpdir(), 'keel-v6-extracted-'));
    try { for (const [name, data] of Object.entries(unzipSync(archive))) await writeFile(directory + '/' + name, data); const generated = await import(pathToFileURL(directory + '/asset.generated.mjs').href), replay = await generated.build(); assert.deepEqual(replay.glb, result.preview.data); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});
