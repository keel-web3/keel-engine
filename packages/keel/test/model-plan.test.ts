import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { generate } from '../../builder/src/generate.ts';
import { createVoxels } from '../../builder/src/voxels.ts';
import { compileVoxelConstruction, compileVoxelConstructionCandidates, loadModel } from '../../builder/src/construction.ts';
import { storeVoxels } from '../../builder/src/voxel-store.ts';
import { planModelRepresentations } from '../src/model-plan.ts';
import type { ModelConstructionCandidate } from '../src/model-plan.ts';
import type { CostResource, RepresentationSelection } from '../src/representation-plan.ts';

const sourcePath = (name: string) => fileURLToPath(new URL('../../builder/src/' + name, import.meta.url));
const runtimeCache = new Map<string, Promise<Uint8Array>>();
async function targetBuild(selection: RepresentationSelection<ModelConstructionCandidate>): Promise<readonly CostResource[]> {
  const decoder = selection.dependencies.includes('model:generator') ? 'generator'
    : selection.dependencies.includes('model:construction') ? 'construction' : 'voxels';
  let runtime = runtimeCache.get(decoder);
  if (!runtime) {
    const entry = decoder === 'generator' ? ['loadModel', 'construction.ts']
      : decoder === 'construction' ? ['loadPrimitiveModel', 'construction-runtime.ts'] : ['loadVoxels', 'voxel-store.ts'];
    runtime = build({ stdin: { contents: `export {${entry[0]} as load} from ${JSON.stringify(sourcePath(entry[1]!))};`,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'js' }, bundle: true, write: false,
      minify: true, format: 'iife', globalName: 'KEEL_MODEL_RUNTIME', platform: 'browser', target: 'es2022', logLevel: 'error',
    }).then(result => result.outputFiles[0]!.contents);
    runtimeCache.set(decoder, runtime);
  }
  const records = selection.assets.map(asset => [asset.id, Buffer.from(asset.candidate.value.bytes).toString('base64')]);
  const creator = Buffer.from(`globalThis.KEEL_MODEL_CASES=${JSON.stringify(records)};globalThis.reconstructModels=()=>KEEL_MODEL_CASES.map(([id,packet])=>[id,KEEL_MODEL_RUNTIME.load(Uint8Array.from(atob(packet),c=>c.charCodeAt(0)))]);`);
  return [
    { id: 'model-runtime', bytes: await runtime, scope: 'shared', compression: 'brotli', provides: selection.dependencies },
    { id: 'model-records', bytes: creator, scope: 'creator', compression: 'brotli', provides: selection.assets.map(asset => asset.id) },
  ];
}

test('real decoder/generator graph is charged once across multiple exact model representations', async () => {
  const tree = generate('tree', 42).model, critter = generate('critter', 7, { plan: 'humanoid' }).model;
  const fence = createVoxels({ name: 'fence', unit: .125 });
  for (let x = 0; x < 24; x++) for (let y = 0; y < 12; y++) fence.set(x * 3, y, 0, 'primary');
  fence.groups.set('posts', [{ min: [0, 0, 0], max: [69, 11, 0] }]);
  const models = [{ id: 'tree', model: tree }, { id: 'critter', model: critter }, { id: 'fence', model: fence }];
  assert.ok(compileVoxelConstructionCandidates(tree).some(candidate => candidate.kind === 'generator'));
  assert.ok(compileVoxelConstructionCandidates(fence).some(candidate => candidate.kind === 'boxes'));
  const standalone = models.map(({ model }) => compileVoxelConstruction(model));
  const full = await planModelRepresentations({ models, build: targetBuild, maxEvaluations: 32, objective: 'full' });
  const creator = await planModelRepresentations({ models, build: targetBuild, maxEvaluations: 32, objective: 'creator' });
  assert.ok(full.cost.fullBytes <= full.baselineCost.fullBytes);
  assert.ok(creator.cost.creatorBytes <= creator.baselineCost.creatorBytes);
  for (const plan of [full, creator]) {
    assert.equal(plan.cost.resources.filter(resource => resource.id === 'model-runtime').length, 1);
    const resources = await targetBuild(plan.selection);
    const context = createContext({ console, TextEncoder, TextDecoder, atob, btoa });
    for (const resource of resources) runInContext(Buffer.from(resource.bytes).toString('utf8'), context);
    for (const [id, model] of context.reconstructModels()) {
      assert.deepEqual(storeVoxels(model), storeVoxels(models.find(original => original.id === id)!.model));
    }
  }
  const forced = await planModelRepresentations({ models: models.slice(0, 2), build: targetBuild,
    baseline: { tree: 'generator', critter: 'generator' }, maxEvaluations: 1 });
  assert.deepEqual(forced.selection.assets.map(asset => asset.candidate.id), ['generator', 'generator']);
  assert.equal(forced.cost.resources.filter(resource => resource.id === 'model-runtime').length, 1);
  assert.deepEqual(forced.selection.dependencies, ['model:voxels', 'model:construction', 'model:generator']);
  models.forEach(({ model }, i) => assert.deepEqual(compileVoxelConstruction(model), standalone[i]));
  console.log({ full: full.cost.fullBytes, fullBaseline: full.baselineCost.fullBytes,
    creator: creator.cost.creatorBytes, creatorBaseline: creator.baselineCost.creatorBytes,
    forcedTwoGenerators: forced.cost.fullBytes, decoderStoredBytes: forced.cost.resources[0]!.storedBytes });
});

test('complete target graphs cannot omit the actual decoder or selected model bytes', async () => {
  const model = generate('tree', 1).model;
  await assert.rejects(planModelRepresentations({ models: [{ id: 'tree', model }], maxEvaluations: 1,
    build: async selection => [{ id: 'records', bytes: selection.assets[0]!.candidate.value.bytes,
      scope: 'creator', compression: 'none', provides: ['tree'] }],
  }), /omitted required helper/);
});

test('target callbacks cannot bypass mandatory replay, metadata and checksum equivalence', async () => {
  const model = generate('tree', 1).model;
  await assert.rejects(planModelRepresentations({ models: [{ id: 'tree', model }], maxEvaluations: 1,
    validate: async selection => {
      const bytes = selection.assets[0]!.candidate.value.bytes; bytes[0] = bytes[0]! ^ 255; return true;
    },
    build: async selection => [{ id: 'all', bytes: Uint8Array.of(1), scope: 'creator', compression: 'none',
      provides: ['tree', ...selection.dependencies] }],
  }), /selected data changed/);
  assert.ok(loadModel(compileVoxelConstruction(model).bytes));
});
