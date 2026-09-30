import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGeometryPoses, UnsupportedGeometryPoseError } from '../src/optimization/geometry-pose.ts';
import type { NormalizedAsset, NativeArray } from '../src/asset-normalize-v3.ts';

function fixture(position = [1, 0, 0]) {
  const asset = { json: { meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }] }, accessors: [] } as unknown as NormalizedAsset;
  const accessor = (data: number[] | NativeArray, type = 'VEC3', normalized = false): number => {
    const array = Array.isArray(data) ? new Float32Array(data) : data;
    const componentType = array instanceof Uint8Array ? 5121 : array instanceof Uint16Array ? 5123 : array instanceof Int8Array ? 5120 : array instanceof Int16Array ? 5122 : 5126;
    const index = asset.accessors.length;
    asset.accessors.push({ sourceIndex: index, componentType, normalized, type, count: array.length / ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!), array });
    return index;
  };
  accessor(position);
  const primitive = asset.json.meshes[0].primitives[0];
  return { asset, accessor, primitive, evaluate: (samplesPerClip = 5) => evaluateGeometryPoses(asset, 0, primitive, { samplesPerClip }) };
}
const near = (actual: ArrayLike<number>, expected: number[], epsilon = 1e-5) => {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => assert(Math.abs(actual[i]! - value) < epsilon, `component ${i}: ${actual[i]} != ${value}`));
};
const translationMatrix = (x: number, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

test('every mesh instance uses hierarchy, matrices, TRS, and its own default morph weights', () => {
  const f = fixture();
  f.primitive.targets = [{ POSITION: f.accessor([2, 0, 0]) }];
  f.asset.json.meshes[0].weights = [0.5];
  f.asset.json.nodes = [{ matrix: translationMatrix(10), children: [1] }, { mesh: 0, scale: [2, 1, 1] }, { mesh: 0, translation: [-2, 0, 0], weights: [1] }];
  f.asset.json.scenes = [{ nodes: [0] }];
  const before = structuredClone(f.asset), poses = f.evaluate();
  assert.deepEqual(poses.map(p => [p.node, p.animation, p.time]), [[1, null, null], [2, null, null]]);
  near(poses[0]!.positions, [14, 0, 0]); near(poses[1]!.positions, [1, 0, 0]);
  assert.deepEqual(f.asset, before, 'source arrays and metadata remain unchanged');
  f.asset.json.nodes = [];
  const uninstanced = f.evaluate();
  assert.equal(uninstanced[0]!.node, null); near(uninstanced[0]!.positions, [2, 0, 0]);
});

test('all clips sample endpoints and intermediate times independently on all instances', () => {
  const f = fixture();
  f.asset.json.nodes = [{ children: [1] }, { mesh: 0 }, { mesh: 0, translation: [20, 0, 0] }];
  const times = f.accessor([2, 6], 'SCALAR'), output = f.accessor([0, 0, 0, 8, 0, 0]);
  f.asset.json.animations = [{ name: 'move', samplers: [{ input: times, output }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] },
    { name: 'hold', samplers: [{ input: times, output }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }];
  const poses = f.evaluate(3);
  assert.equal(poses.length, 14);
  assert.deepEqual(poses.filter(p => p.node === 1 && p.animation === 0).map(p => p.time), [2, 4, 6]);
  near(poses[4]!.positions, [5, 0, 0]); near(poses[5]!.positions, [21, 0, 0]);
  near(poses[8]!.positions, [1, 0, 0]); near(poses[10]!.positions, [5, 0, 0]);
});

test('LINEAR rotation uses shortest-path spherical interpolation, including normalized integer keys', () => {
  const f = fixture();
  const times = f.accessor([0, 1], 'SCALAR');
  const output = f.accessor([0, 0, 0, 1, 0, 0, -Math.sqrt(3) / 2, -0.5], 'VEC4');
  f.asset.json.animations = [{ samplers: [{ input: times, output }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }];
  near(f.evaluate()[2]!.positions, [Math.sqrt(3) / 2, 0.5, 0]);
  f.asset.json.animations[0].samplers[0].output = f.accessor(new Int16Array([0, 0, 0, 32767, 0, 0, 32767, 0]), 'VEC4', true);
  near(f.evaluate(3)[2]!.positions, [0, 1, 0]);
});

test('STEP changes value exactly at a key and keeps the final endpoint', () => {
  const f = fixture(), times = f.accessor([0, 1, 2], 'SCALAR'), output = f.accessor([0, 0, 0, 10, 0, 0, 20, 0, 0]);
  f.asset.json.animations = [{ samplers: [{ input: times, output, interpolation: 'STEP' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }];
  assert.deepEqual(f.evaluate().slice(1).map(p => p.positions[0]), [1, 1, 11, 11, 21]);
});

test('duplicate times are right-continuous at the first, interior, and final key without changing source data', () => {
  const f = fixture(), times = f.accessor([0, 0, 1, 1, 2, 2], 'SCALAR');
  const output = f.accessor([0, 0, 0, 2, 0, 0, 4, 0, 0, 6, 0, 0, 8, 0, 0, 10, 0, 0]);
  f.asset.json.animations = [{ samplers: [{ input: times, output }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }];
  const before = structuredClone(f.asset);
  assert.deepEqual(f.evaluate().slice(1).map(p => p.positions[0]), [3, 4, 7, 8, 11]);
  assert.deepEqual(f.asset, before);
  f.asset.json.animations[0].samplers[0].interpolation = 'STEP';
  assert.deepEqual(f.evaluate().slice(1).map(p => p.positions[0]), [3, 3, 7, 7, 11]);
});

test('CUBICSPLINE scales tangents by duration and normalizes interpolated quaternions', () => {
  const f = fixture(), times = f.accessor([2, 4], 'SCALAR');
  const translation = f.accessor([0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const rotation = f.accessor([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], 'VEC4');
  f.asset.json.animations = [{ samplers: [{ input: times, output: translation, interpolation: 'CUBICSPLINE' }, { input: times, output: rotation, interpolation: 'CUBICSPLINE' }],
    channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }, { sampler: 1, target: { node: 0, path: 'rotation' } }] }];
  near(f.evaluate(3)[2]!.positions, [1, 1, 0]);
});

test('CUBICSPLINE weights use in/value/out groups for all targets', () => {
  const f = fixture();
  f.primitive.targets = [{ POSITION: f.accessor([1, 0, 0]) }, { POSITION: f.accessor([0, 1, 0]) }];
  const times = f.accessor([0, 2], 'SCALAR');
  const weights = f.accessor([0, 0, 0, 1, 2, 0, 0, 0, 1, 0, 0, 0], 'SCALAR');
  f.asset.json.animations = [{ samplers: [{ input: times, output: weights, interpolation: 'CUBICSPLINE' }], channels: [{ sampler: 0, target: { node: 0, path: 'weights' } }] }];
  near(f.evaluate(3)[2]!.positions, [2, 0.5, 0]);
});

test('morphing precedes skinning; all normalized influence sets and inverse binds contribute in world space', () => {
  const f = fixture();
  f.primitive.targets = [{ POSITION: f.accessor([2, 0, 0]) }];
  f.asset.json.meshes[0].weights = [1];
  f.primitive.attributes.JOINTS_0 = f.accessor(new Uint8Array([0, 0, 0, 0]), 'VEC4');
  f.primitive.attributes.WEIGHTS_0 = f.accessor(new Uint8Array([128, 0, 0, 0]), 'VEC4', true);
  f.primitive.attributes.JOINTS_1 = f.accessor(new Uint16Array([1, 0, 0, 0]), 'VEC4');
  f.primitive.attributes.WEIGHTS_1 = f.accessor(new Uint8Array([127, 0, 0, 0]), 'VEC4', true);
  f.asset.json.nodes = [{ mesh: 0, skin: 0, translation: [100, 0, 0] }, { translation: [3, 0, 0], children: [2, 3] }, { translation: [10, 0, 0] }, { translation: [20, 0, 0] }];
  f.asset.json.skins = [{ joints: [2, 3], inverseBindMatrices: f.accessor([...translationMatrix(-1), ...translationMatrix(-2)], 'MAT4') }];
  near(f.evaluate()[0]!.positions, [(15 * 128 + 24 * 127) / 255, 0, 0]);
  const times = f.accessor([0, 1], 'SCALAR'), translation = f.accessor([10, 0, 0, 12, 0, 0]);
  f.asset.json.animations = [{ samplers: [{ input: times, output: translation }], channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }] }];
  near(f.evaluate(3)[3]!.positions, [(17 * 128 + 24 * 127) / 255, 0, 0]);
});

test('unsafe animation, skin, hierarchy and transforms fail explicitly', () => {
  {
    const f = fixture(), times = f.accessor([1, 0], 'SCALAR'), output = f.accessor([0, 0, 0, 1, 0, 0]);
    f.asset.json.animations = [{ samplers: [{ input: times, output }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }];
    assert.throws(() => f.evaluate(), /nondecreasing/);
  }
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.asset.json.nodes[0].children = [0]; },
    (f: ReturnType<typeof fixture>) => { f.asset.json.nodes[0].rotation = [0, 0, 0, 0]; },
    (f: ReturnType<typeof fixture>) => { f.asset.json.nodes[0].matrix = translationMatrix(0); f.asset.json.nodes[0].matrix[3] = 1; },
    (f: ReturnType<typeof fixture>) => { f.asset.json.nodes[0].skin = 0; f.asset.json.skins = [{ joints: [0] }]; },
    (f: ReturnType<typeof fixture>) => { f.asset.accessors[0]!.array[0] = NaN; },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => f.evaluate(), UnsupportedGeometryPoseError);
  }
  assert.throws(() => fixture().evaluate(1), UnsupportedGeometryPoseError);
});
