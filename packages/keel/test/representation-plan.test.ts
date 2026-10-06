import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, constants } from 'node:zlib';
import { measureResourceGraph, planRepresentations } from '../src/representation-plan.ts';

const resource = (id: string, length: number, scope: 'shared' | 'creator' = 'creator') => ({ id, bytes: new Uint8Array(length), scope, compression: 'none' as const });

test('whole graph selection amortizes one decoder across multiple assets', async () => {
  const assets = ['left', 'right'].map(id => ({ id, candidates: [
    { id: 'literal', value: 12 }, { id: 'packed', value: 6, requires: ['decoder'] },
  ] }));
  const result = await planRepresentations({ assets, dependencies: [{ id: 'decoder' }], validate: async () => true,
    build: async selected => [...selected.assets.map(asset => resource(asset.id, asset.candidate.value)),
      ...selected.dependencies.map(id => resource(id, 10, 'shared'))] });
  assert.equal(result.baselineCost.fullBytes, 24);
  assert.equal(result.cost.fullBytes, 22);
  assert.equal(result.cost.creatorBytes, 12);
  assert.deepEqual(result.selection.assets.map(asset => asset.candidate.id), ['packed', 'packed']);
  assert.equal(result.cost.resources.filter(r => r.id === 'decoder').length, 1);
});

test('parity failure rejects a smaller representation and repeated plans are deterministic', async () => {
  const options = { assets: [{ id: 'model', candidates: [{ id: 'original', value: 100 }, { id: 'lossy', value: 1 }, { id: 'exact', value: 80 }] }],
    validate: async (selected: any) => selected.assets[0].candidate.id !== 'lossy',
    build: async (selected: any) => [resource('model', selected.assets[0].candidate.value)] };
  const result = await planRepresentations(options), repeat = await planRepresentations(options);
  assert.equal(result.selection.assets[0]!.candidate.id, 'exact');
  assert.equal(result.savedFullBytes, 20);
  assert.deepEqual(result, repeat);
});

test('counts actual independently compressed resources, including helpers bundled inside code', async () => {
  const text = new TextEncoder().encode('let wheels=repeat(box,[1,2,3]);'.repeat(100));
  const br = brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 22 } });
  const result = await planRepresentations({ assets: [{ id: 'geometry', candidates: [{ id: 'js', value: text, requires: ['box'] }] }],
    dependencies: [{ id: 'box' }], validate: async () => true,
    build: async () => [{ id: 'engine', bytes: text, scope: 'shared', compression: 'brotli', provides: ['box', 'geometry'] },
      { id: 'creator', bytes: text, scope: 'creator', compression: 'brotli' }] });
  assert.equal(result.cost.fullBytes, br.length * 2);
  assert.equal(result.cost.creatorBytes, br.length);
  assert.equal(result.cost.resources[0]!.sha256.length, 64);
  assert.throws(() => measureResourceGraph([resource('x', 1), resource('x', 2)]), /duplicate/);
});

test('missing helper, missing baseline, cycle and invalid search bounds fail closed', async () => {
  const options = { assets: [{ id: 'model', candidates: [{ id: 'packed', value: 1, requires: ['decoder'] }] }],
    dependencies: [{ id: 'decoder' }], validate: async () => true, build: async () => [resource('model', 1)] };
  await assert.rejects(planRepresentations(options), /omitted required helper/);
  await assert.rejects(planRepresentations({ ...options, baseline: { model: 'absent' } }), /baseline/);
  await assert.rejects(planRepresentations({ ...options, dependencies: [{ id: 'decoder', requires: ['decoder'] }] }), /cyclic/);
  await assert.rejects(planRepresentations({ ...options, maxEvaluations: 0 }), /bounds/);
  await assert.rejects(planRepresentations({ ...options, beamWidth: 65 }), /beam width/);
});

test('deep helper chains are iterative and build work respects the evaluation cap', async () => {
  const dependencies = Array.from({ length: 4096 }, (_, i) => ({ id: 'helper' + i, requires: i ? ['helper' + (i - 1)] : [] }));
  let calls = 0;
  const result = await planRepresentations({ dependencies, maxEvaluations: 3,
    assets: [{ id: 'model', candidates: Array.from({ length: 20 }, (_, i) => ({ id: String(i), value: 100 - i, requires: ['helper4095'] })) }],
    validate: async () => true, build: async selected => { calls++; return [{ ...resource('model', selected.assets[0]!.candidate.value), provides: selected.dependencies }]; } });
  assert.equal(calls, 3); assert.equal(result.evaluations, 3); assert.equal(result.limitReached, true);
  assert.equal(result.selection.dependencies.length, 4096);
});

test('creator objective reports any full cost growth and equal costs keep the baseline', async () => {
  const assets = [{ id: 'model', candidates: [{ id: 'local', value: [10, 0] }, { id: 'reused', value: [1, 20] }] }];
  const build = async (selected: any) => [{ ...resource('creator', selected.assets[0].candidate.value[0]), provides: ['model'] }, resource('shared', selected.assets[0].candidate.value[1], 'shared')];
  const full = await planRepresentations({ assets, build, validate: async () => true });
  const creator = await planRepresentations({ assets, build, validate: async () => true, objective: 'creator' });
  assert.equal(full.cost.fullBytes, 10);
  assert.equal(creator.cost.creatorBytes, 1); assert.equal(creator.savedFullBytes, -11);
  const tied = await planRepresentations({ assets: [{ id: 'x', candidates: [{ id: 'z', value: 1 }, { id: 'a', value: 1 }] }], validate: async () => true, build: async () => [resource('x', 1)] });
  assert.equal(tied.selection.assets[0]!.candidate.id, 'z');
});

test('inherited record names are valid assets and omitted assets fail closed', async () => {
  const assets = [{ id: 'constructor', candidates: [{ id: 'source', value: 1 }] }];
  const result = await planRepresentations({ assets, baseline: {}, validate: async () => true, build: async () => [resource('constructor', 1)] });
  assert.equal(result.cost.fullBytes, 1);
  await assert.rejects(planRepresentations({ assets, validate: async () => true, build: async () => [resource('unrelated', 1)] }), /omitted asset/);
});
