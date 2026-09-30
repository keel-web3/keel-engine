import test from 'node:test';
import assert from 'node:assert/strict';
import type { NormalizedAsset, NativeArray } from '../src/asset-normalize-v3.ts';
import { optimizeGeometry } from '../src/optimization/geometry.ts';
import { evaluateGeometryPoses } from '../src/optimization/geometry-pose.ts';

function fixture(size = 16, animated = false, seam = false): NormalizedAsset {
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], joints: number[] = [], weights: number[] = [], morph: number[] = [], indices: number[] = [];
  const pieces = seam ? 2 : 1;
  for (let piece = 0; piece < pieces; piece++) {
    const offset = positions.length / 3;
    for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
      const px = (piece + x / size) / pieces, py = y / size;
      positions.push(px, py, 0); normals.push(0, 0, 1); uv.push(x / size, py);
      joints.push(0, 1, 0, 0); weights.push(1 - px, px, 0, 0); morph.push(0, 0, px * .05);
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const a = offset + y * (size + 1) + x, b = a + 1, c = a + size + 1, d = c + 1; indices.push(a, b, d, a, d, c); }
  }
  const accessors: any[] = [], descriptors: any[] = [];
  const add = (array: NativeArray, type: string, componentType = 5126, normalized = false) => { const width = type === 'SCALAR' ? 1 : Number(type.slice(-1)), count = array.length / width, id = accessors.length; accessors.push({ sourceIndex: id, type, componentType, count, normalized, array }); descriptors.push({ type, componentType, count, ...(normalized ? { normalized } : {}) }); return id; };
  const attributes: Record<string, number> = { POSITION: add(new Float32Array(positions), 'VEC3'), NORMAL: add(new Float32Array(normals), 'VEC3'), TEXCOORD_0: add(new Float32Array(uv), 'VEC2') };
  const primitive: any = { attributes, indices: add(new Uint32Array(indices), 'SCALAR', 5125), material: 0, extras: { keep: 'primitive metadata' } };
  const json: any = { asset: { version: '2.0' }, accessors: descriptors, meshes: [{ primitives: [primitive] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.2, .5, 1, 1] } }] };
  if (animated) {
    attributes.JOINTS_0 = add(new Uint8Array(joints), 'VEC4', 5121);
    attributes.WEIGHTS_0 = add(new Float32Array(weights), 'VEC4');
    primitive.targets = [{ POSITION: add(new Float32Array(morph), 'VEC3') }, { POSITION: add(Float32Array.from(positions, (v, i) => i % 3 === 0 ? -v * .03 : 0), 'VEC3') }];
    json.meshes[0].weights = [.25, .75]; json.nodes = [{ mesh: 0, skin: 0 }, { children: [2] }, {}]; json.scenes[0].nodes = [0, 1]; json.skins = [{ joints: [1, 2] }];
    const times = add(new Float32Array([0, 1]), 'SCALAR'), translation = add(new Float32Array([0, 0, 0, 0, .5, 0]), 'VEC3'), morphWeights = add(new Float32Array([0, .5, 1, -.2]), 'SCALAR');
    json.animations = [{ name: 'move and morph', samplers: [{ input: times, output: translation }, { input: times, output: morphWeights }], channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }, { sampler: 1, target: { node: 0, path: 'weights' } }] }];
  }
  return { format: 'KEEL-NATIVE-SCENE', version: 2, json, sourceJson: structuredClone(json), accessors, images: [{ sourceIndex: 0, mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }], source: { entry: 'test.gltf', container: 'gltf', files: [] }, validation: { accessorCount: accessors.length, sourceAccessorCount: accessors.length, decodedBytes: accessors.reduce((n, a) => n + a.array.byteLength, 3), dracoPrimitives: 0, meshPrimitives: 1, imageBytes: 3, preservedSourceIndices: true, decodedReference: 'source-accessor-values', warnings: [] }, runtime: { dependencies: [], dracoRequiredForReplay: false, decoderCostIncluded: false, decoderNote: '' } };
}
function assertRetainedSamples(source: NormalizedAsset, result: Awaited<ReturnType<typeof optimizeGeometry>>): void {
  for (const correspondence of result.correspondence) {
    const before = source.json.meshes[correspondence.mesh].primitives[correspondence.primitive], after = result.normalized.json.meshes[correspondence.mesh].primitives[correspondence.primitive];
    for (let group = 0; group < 1 + (before.targets?.length ?? 0); group++) {
      const a = group === 0 ? before.attributes : before.targets[group - 1], b = group === 0 ? after.attributes : after.targets[group - 1];
      for (const semantic of Object.keys(a)) {
        const old = source.accessors[a[semantic]]!, current = result.normalized.accessors[b[semantic]]!, width = old.array.length / old.count;
        assert.equal(old.componentType, current.componentType); assert.equal(old.normalized, current.normalized);
        correspondence.retainedSourceVertices.forEach((v, i) => assert.deepEqual(current.array.slice(i * width, (i + 1) * width), old.array.slice(v * width, (v + 1) * width), semantic));
      }
    }
  }
}

test('reduces a grid, bounds sampled bidirectional error, keeps winding and source bytes', async () => {
  const source = fixture(), before = structuredClone(source), result = await optimizeGeometry(source, { targetRatio: .5, maxError: .01 });
  assert.equal(result.report.changedPrimitives, 1); assert(result.report.outputTriangles <= result.report.originalTriangles * .51);
  assertRetainedSamples(source, result); assert.deepEqual(source, before);
  assert.equal(result.normalized.validation.decodedBytes, result.normalized.accessors.reduce((n, a) => n + a.array.byteLength, 3));
  const primitive = result.normalized.json.meshes[0].primitives[0], indices = result.normalized.accessors[primitive.indices]!.array, positions = result.normalized.accessors[primitive.attributes.POSITION]!.array;
  for (let i = 0; i < indices.length; i += 3) { const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3; assert((positions[b]! - positions[a]!) * (positions[c + 1]! - positions[a + 1]!) - (positions[b + 1]! - positions[a + 1]!) * (positions[c]! - positions[a]!) > 0); }
  for (const metric of result.report.metrics) for (const e of metric.sampledErrors) assert(e.maxError <= e.allowedError + 1e-12);
});
test('skinning, simultaneous morphs, clips, seams, material data and all retained streams survive', async () => {
  const source = fixture(12, true, true), result = await optimizeGeometry(source, { targetRatio: .5, maxError: .01 });
  assert.equal(result.report.changedPrimitives, 1); assert(result.report.metrics[0]!.lockedSeamVertices > 0); assertRetainedSamples(source, result);
  for (const key of ['animations', 'skins', 'nodes', 'materials']) assert.deepEqual(result.normalized.json[key], source.json[key], key);
  assert.deepEqual(result.normalized.images, source.images);
  const sourcePoses = evaluateGeometryPoses(source, 0, source.json.meshes[0].primitives[0]), outputPoses = evaluateGeometryPoses(result.normalized, 0, result.normalized.json.meshes[0].primitives[0]);
  assert.equal(sourcePoses.length, outputPoses.length);
  for (let p = 0; p < sourcePoses.length; p++) result.correspondence[0]!.retainedSourceVertices.forEach((v, i) => assert.deepEqual(outputPoses[p]!.positions.slice(i * 3, i * 3 + 3), sourcePoses[p]!.positions.slice(v * 3, v * 3 + 3)));
});
test('lossless mode bypasses removal and gives an independent exact clone', async () => {
  const source = fixture(4, true, true), result = await optimizeGeometry(source, { mode: 'lossless' });
  assert.equal(result.report.changedPrimitives, 0); assert.deepEqual(result.normalized, source); assert.notEqual(result.normalized.accessors[0]!.array, source.accessors[0]!.array);
});
test('shared attributes and underlying buffers remain independent of an untouched primitive', async () => {
  const source = fixture(), alias = source.accessors.length;
  source.accessors.push({ ...source.accessors[0]!, sourceIndex: alias, array: new Float32Array(source.accessors[0]!.array.buffer) });
  source.json.accessors.push({ ...source.json.accessors[0] }); source.json.meshes[0].primitives[0].attributes._COPY = alias;
  const before = structuredClone(source);
  source.json.meshes[0].primitives.push({ ...structuredClone(source.json.meshes[0].primitives[0]), mode: 1 });
  const result = await optimizeGeometry(source, { targetRatio: .4, maxError: .01 });
  assert.equal(result.report.changedPrimitives, 1);
  const edited = result.normalized.json.meshes[0].primitives[0], retained = result.normalized.json.meshes[0].primitives[1];
  assert.notEqual(edited.attributes.POSITION, retained.attributes.POSITION);
  assert.deepEqual(result.normalized.accessors[retained.attributes.POSITION]!.array, before.accessors[0]!.array);
  result.normalized.accessors[edited.attributes.POSITION]!.array[0] = 99;
  assert.deepEqual(source.accessors[0]!.array, before.accessors[0]!.array);
  assert.deepEqual(result.normalized.accessors[retained.attributes.POSITION]!.array, before.accessors[0]!.array);
});
test('animation aliases retain original accessor identity while optimized geometry gets independent storage', async () => {
  const source = fixture(), count = source.accessors[0]!.count, id = source.accessors.length;
  source.accessors.push({ sourceIndex: id, type: 'SCALAR', componentType: 5126, normalized: false, count, array: Float32Array.from({ length: count }, (_, i) => i) });
  source.json.accessors.push({ type: 'SCALAR', componentType: 5126, count });
  source.json.nodes.push({}); source.json.animations = [{ samplers: [{ input: id, output: 0 }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }];
  const result = await optimizeGeometry(source, { targetRatio: .5, maxError: .01 });
  assert.equal(result.report.changedPrimitives, 1); assert.deepEqual(result.normalized.json.animations, source.json.animations);
  assert.deepEqual(result.normalized.accessors[0], source.accessors[0]); assert.notEqual(result.normalized.json.meshes[0].primitives[0].attributes.POSITION, 0);
});
test('degenerate triangles are preserved while neighboring valid triangles reduce', async () => {
  const source = fixture(), primitive = source.json.meshes[0].primitives[0], index = source.accessors[primitive.indices]!;
  index.array = new Uint32Array([...index.array, 0, 0, 1, 0, 1, 2]); index.count += 6; source.json.accessors[primitive.indices].count += 6;
  const result = await optimizeGeometry(source, { targetRatio: .5, maxError: .01 });
  assert.equal(result.report.changedPrimitives, 1); assert.equal(result.report.metrics[0]!.preservedDegenerateTriangles, 2);
  const output = result.normalized.accessors[result.normalized.json.meshes[0].primitives[0].indices]!.array;
  const map = result.correspondence[0]!.retainedSourceVertices;
  assert.deepEqual(Array.from(output.slice(-6), i => map[i]), [0, 0, 1, 0, 1, 2]);
});
test('unsafe modes, opaque aliases, all-degenerate surfaces and morph types retain the original', async () => {
  for (const kind of ['mode', 'extension', 'degenerate', 'morph']) {
    const source = fixture(4), p = source.json.meshes[0].primitives[0];
    if (kind === 'mode') p.mode = 5;
    if (kind === 'extension') source.json.extensionsUsed = ['TEST_accessor_alias'];
    if (kind === 'degenerate') source.accessors[p.indices]!.array.fill(0);
    if (kind === 'morph') p.targets = [{ UNKNOWN: p.attributes.NORMAL }];
    const result = await optimizeGeometry(source, { targetRatio: .5 });
    assert.equal(result.report.changedPrimitives, 0, kind); assert.deepEqual(result.normalized.accessors, source.accessors, kind);
  }
});
test('sampled animation gate rejects simplification that erases alternating skin deformation', async () => {
  const source = fixture(12, true), p = source.json.meshes[0].primitives[0], weights = source.accessors[p.attributes.WEIGHTS_0]!.array;
  for (let v = 0; v < weights.length / 4; v++) { weights[v * 4] = v % 2; weights[v * 4 + 1] = 1 - v % 2; }
  const result = await optimizeGeometry(source, { targetRatio: .25, maxError: .005, maxAttempts: 2 });
  assert.equal(result.report.changedPrimitives, 0); assert(result.report.metrics[0]!.attempts.some(a => a.reason.includes('deformation')));
  assert.deepEqual(result.normalized.accessors, source.accessors);
});
test('invalid options reject and repeated optimization is deterministic', async () => {
  for (const options of [{ targetRatio: 0 }, { targetRatio: NaN }, { maxError: -1 }, { samplesPerClip: 1 }, { maxSurfaceSamples: 0 }, { maxAttempts: 1.5 }]) await assert.rejects(optimizeGeometry(fixture(3), options));
  const source = fixture(6, true), a = await optimizeGeometry(source), b = await optimizeGeometry(source); assert.deepEqual(a, b);
});
