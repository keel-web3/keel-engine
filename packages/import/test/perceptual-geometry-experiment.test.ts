import test from 'node:test';
import assert from 'node:assert/strict';
import type { NormalizedAsset, NativeArray } from '../src/asset-normalize-v3.ts';
import { optimizePerceptualGeometry as optimizeGeometry } from '../src/optimization/perceptual-geometry-experiment.ts';
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

test('permissive candidate preserves retained skin and morph rows and fixed-pose positions', async () => {
  const source = fixture(12, true, true), before = structuredClone(source);
  const accept = () => ({ accepted: true, reason: 'test fixture gate; production caller must supply visual evidence' });
  const result = await optimizeGeometry(source, { candidate: 'permissive', visualGate: accept });
  assert(result.report.accepted); assert(result.report.outputTriangles < result.report.originalTriangles * .8);
  assertRetainedSamples(source, result); assert.deepEqual(source, before);
  for (const key of ['animations', 'skins', 'nodes', 'materials']) assert.deepEqual(result.normalized.json[key], source.json[key]);
  const sourcePoses = evaluateGeometryPoses(source, 0, source.json.meshes[0].primitives[0]), outputPoses = evaluateGeometryPoses(result.normalized, 0, result.normalized.json.meshes[0].primitives[0]);
  assert.equal(sourcePoses.length, outputPoses.length);
  for (let p = 0; p < sourcePoses.length; p++) result.correspondence[0]!.retainedSourceVertices.forEach((v, i) => assert.deepEqual(outputPoses[p]!.positions.slice(i * 3, i * 3 + 3), sourcePoses[p]!.positions.slice(v * 3, v * 3 + 3)));
  const repeat = await optimizeGeometry(source, { candidate: 'permissive', visualGate: accept });
  assert.deepEqual(repeat.normalized, result.normalized);
});
test('failed, throwing, missing and malformed visual gates return the exact input object', async () => {
  const source = fixture(4), before = structuredClone(source);
  for (const gate of [() => ({ accepted: false, reason: 'deliberately fails image budget' }), () => { throw Error('renderer unavailable'); }, undefined, () => ({ accepted: 'yes' })]) {
    const result = await optimizeGeometry(source, { candidate: 'relaxed', visualGate: gate } as any);
    assert.equal(result.normalized, source); assert.equal(result.asset, source); assert.equal(result.report.accepted, false);
    assert.equal(result.report.outputTriangles, result.report.originalTriangles); assert.equal(result.report.changedPrimitives, 0);
    assert.deepEqual(source, before);
  }
});
test('opaque semantics fail closed without remapping and invalid candidate identifiers reject', async () => {
  const source = fixture(4); source.json.extensionsUsed = ['VENDOR_unknown'];
  const result = await optimizeGeometry(source, { candidate: 'permissive', visualGate: () => ({ accepted: true, reason: 'unused' }) });
  assert.equal(result.normalized, source); assert.equal(result.report.accepted, false);
  assert.match(result.report.metrics[0]!.reason, /opaque extension/);
  await assert.rejects(() => optimizeGeometry(source, { candidate: 'other' } as any), /two fixed candidates/);
});
