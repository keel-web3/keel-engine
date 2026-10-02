import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareForceTargetGeometry } from '../src/optimization/force-target-geometry.ts';
import { normalizeAsset } from '../src/asset-normalize-v3.ts';
import type { NormalizedAsset, NativeArray } from '../src/asset-normalize-v3.ts';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { compileForceTargetSourceAsset, compilePixelModelSourceAsset } from '../src/pixel-model-compiler.ts';
import { compileStyledAsset } from '../src/styled-asset-compiler.ts';
import { createStyledAsset, importStyledAsset, styledAssetJson } from '../src/styled-asset.ts';
import { encodePng } from '../src/png.ts';
import { evaluateGeometryPoses } from '../src/optimization/geometry-pose.ts';

function fixture(offset = 0) {
  const arrays: NativeArray[] = [], descriptors: any[] = [];
  const add = (array: NativeArray, type: string, normalized = false) => {
    const id = arrays.length, componentType = array instanceof Uint8Array ? 5121 : array instanceof Uint16Array ? 5123 : 5126;
    arrays.push(array); descriptors.push({ type, componentType, count: array.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!), ...(normalized ? { normalized } : {}) }); return id;
  };
  const meshes: any[] = [];
  for (let mesh = 0; mesh < 3; mesh++) {
    const primitives: any[] = [];
    for (let primitive = 0; primitive < 2; primitive++) {
      const positions: number[] = [];
      for (let triangle = 0; triangle < 4; triangle++) {
        const x = offset + mesh * 30 + primitive * 10 + triangle * 2;
        positions.push(x, 0, 0, x + 1, 0, 0, x, 1, 0);
      }
      const attributes = {
        POSITION: add(new Float32Array(positions), 'VEC3'),
        NORMAL: add(Float32Array.from({ length: 36 }, (_, i) => i % 3 === 2 ? 1 : 0), 'VEC3'),
        TANGENT: add(Float32Array.from({ length: 48 }, (_, i) => i % 4 === 0 || i % 4 === 3 ? 1 : 0), 'VEC4'),
        TEXCOORD_0: add(Float32Array.from({ length: 24 }, (_, i) => i / 24), 'VEC2'),
        COLOR_0: add(Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : i * 3), 'VEC4', true),
        JOINTS_0: add(Uint8Array.from({ length: 48 }, (_, i) => Number(i % 4 === 0 && i % 8 === 0)), 'VEC4'),
        WEIGHTS_0: add(Float32Array.from({ length: 48 }, (_, i) => Number(i % 4 === 0)), 'VEC4'),
        _SOURCE: add(Float32Array.from({ length: 12 }, (_, i) => i === 0 ? -0 : i), 'SCALAR'),
      };
      const targets = [{ POSITION: add(Float32Array.from({ length: 36 }, (_, i) => i % 3 === 2 ? i / 100 : 0), 'VEC3') }, { NORMAL: add(Float32Array.from({ length: 36 }, (_, i) => i % 3 === 1 ? .1 : 0), 'VEC3') }];
      primitives.push({ attributes, indices: add(Uint16Array.from({ length: 12 }, (_, i) => i), 'SCALAR'), targets, material: mesh * 2 + primitive, extras: { part: primitive } });
    }
    meshes.push({ name: 'mesh ' + mesh, weights: [.25, .5], extras: { targetNames: ['Lift', 'Normal'] }, primitives });
  }
  const time = add(new Float32Array([0, 1]), 'SCALAR'), move = add(new Float32Array([0, 0, 0, 0, 0, 2]), 'VEC3'), weights = add(new Float32Array([0, 0, .5, 1]), 'SCALAR');
  const inverse = add(Float32Array.from({ length: 32 }, (_, i) => Number(i % 16 === 0 || i % 16 === 5 || i % 16 === 10 || i % 16 === 15)), 'MAT4');
  const png = encodePng({ width: 2, height: 2, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]) });
  const images = Array.from({ length: 7 }, () => ({ mimeType: 'image/png', data: png }));
  const json: any = { asset: { version: '2.0' }, accessors: descriptors, meshes, nodes: [{ mesh: 0, skin: 0 }, { mesh: 1, skin: 0 }, { mesh: 2, skin: 0 }, { name: 'joint A' }, { name: 'joint B' }], skins: [{ joints: [3, 4], inverseBindMatrices: inverse }], animations: [{ name: 'Everything moves', extras: { original: true }, samplers: [{ input: time, output: move, interpolation: 'LINEAR' }, { input: time, output: weights, interpolation: 'STEP' }], channels: [{ sampler: 0, target: { node: 4, path: 'translation' } }, ...[0, 1, 2].map(node => ({ sampler: 1, target: { node, path: 'weights' } }))] }], materials: images.map((_, i) => ({ name: 'material ' + i, pbrMetallicRoughness: { baseColorTexture: { index: i } } })), textures: images.map((_, i) => ({ source: i, sampler: i })), samplers: images.map(() => ({ magFilter: 9729 })), images: images.map(() => ({})), scenes: [{ nodes: [0, 1, 2, 3, 4] }], scene: 0 };
  return { json, arrays, images, input: { entry: 'source.glb', files: [{ name: 'source.glb', data: writeNativeGlb(json, arrays, images) }] } };
}
function rig(asset: NormalizedAsset) {
  const json = structuredClone(asset.json), value = (id: number) => ({ ...asset.accessors[id], sourceIndex: null });
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = value(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { sampler.input = value(sampler.input); sampler.output = value(sampler.output); }
  return { nodes: json.nodes, skins: json.skins, animations: json.animations };
}
function triangles(asset: NormalizedAsset) {
  let count = 0;
  for (const mesh of asset.json.meshes ?? []) for (const primitive of mesh.primitives) if ((primitive.mode ?? 4) === 4) {
    const positions = asset.accessors[primitive.attributes.POSITION]!.array, indices = asset.accessors[primitive.indices]!.array;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
      const u = [0, 1, 2].map(k => positions[b + k]! - positions[a + k]!), v = [0, 1, 2].map(k => positions[c + k]! - positions[a + k]!);
      assert(Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) > 0);
      count++;
    }
  }
  return count;
}
function exactVertices(source: NormalizedAsset, output: NormalizedAsset, before: any, after: any, retained: number[]) {
  for (const [index, group] of [before.attributes, ...(before.targets ?? [])].entries()) {
    const current = index === 0 ? after.attributes : after.targets[index - 1];
    assert.deepEqual(Object.keys(current), Object.keys(group));
    for (const semantic of Object.keys(group)) {
      const a = source.accessors[group[semantic]]!, b = output.accessors[current[semantic]]!, width = a.array.length / a.count;
      assert.equal(a.componentType, b.componentType); assert.equal(a.normalized, b.normalized);
      retained.forEach((v, i) => assert.deepEqual(b.array.slice(i * width, (i + 1) * width), a.array.slice(v * width, (v + 1) * width), semantic));
    }
  }
}

for (const budget of [1, 2, 5]) test(`global ${budget}-triangle budget prunes parts and preserves exact rig, morph, and vertex records`, async () => {
  const source = await normalizeAsset(fixture().input), before = structuredClone(source), result = await prepareForceTargetGeometry(source, { targetTriangles: budget }), output = result.normalized;
  assert.equal(result.report.requestedTriangles, budget); assert.equal(result.report.achievedTriangles, budget); assert.equal(triangles(output), budget);
  assert.equal(result.report.targetMet, true); assert.equal(result.report.validation.fidelityGuaranteed, false);
  assert.equal(result.report.primitives.reduce((n, p) => n + p.targetTriangles, 0), budget);
  assert(result.report.primitives.some(p => p.targetTriangles === 0)); assert.deepEqual(source, before); assert.deepEqual(rig(output), rig(source));
  for (const report of result.report.primitives) if (report.outputPrimitive !== null) {
    const a = source.json.meshes[report.mesh].primitives[report.primitive], b = output.json.meshes[report.mesh].primitives[report.outputPrimitive];
    exactVertices(source, output, a, b, report.retainedSourceVertices);
    const originalPoses = evaluateGeometryPoses(source, report.mesh, a), outputPoses = evaluateGeometryPoses(output, report.mesh, b);
    for (let pose = 0; pose < originalPoses.length; pose++) report.retainedSourceVertices.forEach((v, i) => assert.deepEqual(outputPoses[pose]!.positions.slice(i * 3, i * 3 + 3), originalPoses[pose]!.positions.slice(v * 3, v * 3 + 3)));
  }
  for (const carrier of result.report.invisibleAnimationCarriers) {
    const p = output.json.meshes[carrier.mesh].primitives[0]; assert.equal(p.mode, 0);
    assert.equal(output.json.materials[p.material].alphaMode, 'MASK'); assert.equal(output.json.materials[p.material].pbrMetallicRoughness.baseColorFactor[3], 0);
    exactVertices(source, output, source.json.meshes[carrier.mesh].primitives[carrier.sourcePrimitive], p, [carrier.sourceVertex]);
  }
  assert(output.images.length < source.images.length); assert(output.accessors.reduce((n, a) => n + a.array.byteLength, 0) < source.accessors.reduce((n, a) => n + a.array.byteLength, 0));
  const rebuilt = await normalizeAsset({ entry: 'out.glb', files: [{ name: 'out.glb', data: writeNativeGlb(output.json, output.accessors.map(a => a.array), output.images) }] });
  assert.equal(triangles(rebuilt), budget); assert.deepEqual(rig(rebuilt), rig(source));
});

test('source-first calls are deterministic across changed targets and replacement sources', async () => {
  const input = fixture().input, a = await compileForceTargetSourceAsset({ ...input, targetTriangles: 1 });
  await compileForceTargetSourceAsset({ ...input, targetTriangles: 5 });
  const replacement = await compileForceTargetSourceAsset({ ...fixture(100).input, targetTriangles: 1 });
  const b = await compileForceTargetSourceAsset({ ...input, targetTriangles: 1 });
  assert.deepEqual(a.packageBytes, b.packageBytes); assert.notDeepEqual(a.packageBytes, replacement.packageBytes);
  assert.equal(a.manifest.mode, 'force-target'); assert.equal(a.manifest.validation.losslessSourceAccessorsExact, false);
  const rebuilt = await normalizeAsset({ entry: 'out.glb', files: [{ name: 'out.glb', data: a.preview.data }] }); assert.equal(triangles(rebuilt), 1);
});

test('Original, Pixel and Dither share forced geometry and replay every source clip', async () => {
  const input = fixture().input, source = await normalizeAsset(input), compiled = await compileForceTargetSourceAsset({ ...input, targetTriangles: 2 });
  for (const kind of ['original', 'pixel', 'dither'] as const) {
    const style = { kind, pixelSize: 4, toneLevels: 8, screen: 'bayer4' as const };
    const bytes = kind === 'original' ? await createStyledAsset({ packageBytes: compiled.packageBytes, style }) : (await compileStyledAsset({ packageBytes: compiled.packageBytes, style, texture: { maxDimension: 1, paletteSize: 8 } })).assetBytes;
    const binary = await importStyledAsset(bytes), readable = await importStyledAsset(new TextEncoder().encode(styledAssetJson(bytes)));
    assert.deepEqual(binary.glb, readable.glb);
    const result = await normalizeAsset({ entry: 'out.glb', files: [{ name: 'out.glb', data: readable.glb }] });
    assert.equal(triangles(result), 2, kind); assert.deepEqual(rig(result), rig(source), kind);
  }
  const pixel = await compilePixelModelSourceAsset({ ...input, representation: 'model-3d', geometry: { policy: 'force-target', targetTriangles: 1 }, quality: { maxDimension: 1, maxError: 0 } });
  assert('policy' in pixel.report.geometry); assert.equal(pixel.report.geometry.policy, 'force-target'); assert.equal(pixel.report.geometry.achievedTriangles, 1);
});

test('no-triangle and all-degenerate sources report zero without fabricating geometry', async () => {
  const f = fixture();
  for (const mesh of f.json.meshes) for (const p of mesh.primitives) p.mode = 0;
  let source = await normalizeAsset({ entry: 'none.glb', files: [{ name: 'none.glb', data: writeNativeGlb(f.json, f.arrays, f.images) }] });
  let result = await prepareForceTargetGeometry(source, { targetTriangles: 1 });
  assert.equal(result.report.achievedTriangles, 0); assert.equal(result.report.targetMet, true); assert.equal(result.report.exactlyRequested, false); assert.match(result.report.reason, /no triangle topology/); assert.deepEqual(rig(result.normalized), rig(source));
  for (const mesh of f.json.meshes) for (const p of mesh.primitives) { p.mode = 4; f.arrays[p.attributes.POSITION]!.fill(0); }
  source = await normalizeAsset({ entry: 'degenerate.glb', files: [{ name: 'degenerate.glb', data: writeNativeGlb(f.json, f.arrays, f.images) }] });
  result = await prepareForceTargetGeometry(source, { targetTriangles: 1 });
  assert.equal(result.report.achievedTriangles, 0); assert.equal(result.report.removedDegenerateTriangles, 24); assert.match(result.report.reason, /no nondegenerate/); assert.equal(result.report.invisibleAnimationCarriers.length, 3); assert.deepEqual(rig(result.normalized), rig(source));
});

test('large upper bounds keep all eligible source triangles and invalid budgets are rejected', async () => {
  const source = await normalizeAsset(fixture().input), result = await prepareForceTargetGeometry(source, { targetTriangles: Number.MAX_SAFE_INTEGER });
  assert.equal(triangles(result.normalized), 24); assert.equal(result.report.achievedTriangles, 24); assert.equal(result.report.exactlyRequested, false); assert.match(result.report.reason, /below/);
  for (const targetTriangles of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(prepareForceTargetGeometry(source, { targetTriangles }), /positive safe integer/);
});
