import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { buildEngineFeatures } from '../src/features.ts';
import { normalizeSeed, createRoll } from '../../core/src/rng.ts';
import { encodeRetroFrame } from '../../codec/src/retro.ts';
import { createVoxels, sameVoxels } from '../../builder/src/voxels.ts';
import { storeVoxels } from '../../builder/src/voxel-store.ts';
import { moduleForImport, readWorkspace } from '../src/workspace.ts';

test('feature profiles keep only their selected runtime dependencies and obey byte budgets', async () => {
  for (const name of ['seed-runtime', 'retro-decoder', 'mesh-runtime', 'primitive-model-runtime']) {
    const profile = JSON.parse(await readFile(new URL(`../../../tools/profiles/${name}.json`, import.meta.url), 'utf8'));
    const built = await buildEngineFeatures(profile), again = await buildEngineFeatures(profile);
    assert.deepEqual(built.bytes, again.bytes);
    assert.deepEqual(gunzipSync(built.gzip), Buffer.from(built.bytes));
    assert.deepEqual(brotliDecompressSync(built.brotli), Buffer.from(built.bytes));
    assert.deepEqual(built.brotli, again.brotli);
    const ctx = createContext({ TextEncoder, TextDecoder, atob, btoa }); runInContext(new TextDecoder().decode(built.bytes), ctx);
    if (name === 'seed-runtime') {
      for (const seed of [0, 1, 42]) {
        const expected = createRoll(normalizeSeed(seed)), actual = ctx.KEEL_FEATURES.core_rng__createRoll(ctx.KEEL_FEATURES.core_rng__normalizeSeed(seed));
        for (let slot = 0; slot < 32; slot++) assert.equal(actual.at(slot), expected.at(slot));
      }
    } else if (name === 'retro-decoder') {
      const frame = Uint8Array.from({ length: 256 }, (_, i) => i % 7);
      assert.deepEqual(Array.from(ctx.KEEL_FEATURES.codec_retro__decodeRetroFrame(encodeRetroFrame(frame))), Array.from(frame));
      assert.ok(!('codec_retro__encodeRetroFrame' in ctx.KEEL_FEATURES));
    } else if (name === 'mesh-runtime') {
      const mesh = ctx.KEEL_FEATURES.bake_mesh__lookMesh({ boxes: [{ c: [0, 0, 0], h: [1, 1, 1], mat: 0 }] });
      assert.ok(mesh.indices.length > 0);
    } else {
      const model = createVoxels(); model.set(0, 0, 0, 'primary'); model.set(0, 1, 0, 'trim');
      assert.ok(sameVoxels(ctx.KEEL_FEATURES.builder_primitive_runtime__loadPrimitiveModel(storeVoxels(model)), model));
    }
    console.log({ profile: name, rawBytes: built.report.rawBytes, gzipBytes: built.report.gzipBytes });
  }
});

test('unknown exports, aliases, forbidden dependencies and exceeded budgets fail before delivery', async () => {
  const profile = { name: 'test', features: [{ module: '@keel-engine/core/rng', exports: ['normalizeSeed'] }] };
  await assert.rejects(buildEngineFeatures({ ...profile, maxGzipBytes: 1 }), /budget/);
  await assert.rejects(buildEngineFeatures({ ...profile, maxBrotliBytes: 1 }), /Brotli budget/);
  await assert.rejects(buildEngineFeatures({ ...profile, maxBrotliBytes: -1 }), /Invalid engine byte budget/);
  await assert.rejects(buildEngineFeatures({ ...profile, forbidInputs: ['core/src/rng.ts'] }), /Forbidden/);
  await assert.rejects(buildEngineFeatures({ ...profile, features: [{ module: '@keel-engine/core/absent', exports: ['a'] }] }), /not exported/);
  await assert.rejects(buildEngineFeatures({ ...profile, features: [{ module: '@keel-engine/core/rng', exports: ['absent'] }] }), /No matching runtime export/);
  await assert.rejects(buildEngineFeatures({ ...profile, features: [profile.features[0]!, { module: '@keel-engine/core-rng', exports: ['normalizeSeed'] }] }), /collision/);
});

test('feature subpaths keep their owning KEEL module dependency and SDK identity', async () => {
  const workspace = await readWorkspace(new URL('../../..', import.meta.url).pathname);
  for (const name of ['@keel-engine/core/rng', '@keel/game-engine/core/rng']) assert.equal(moduleForImport(name, workspace), 'keel/core');
  assert.equal(moduleForImport('@keel-engine/codec/schemas/construction', workspace), 'keel/codec');
  assert.equal(moduleForImport('@keel-engine/unknown/rng', workspace), undefined);
  assert.equal(moduleForImport('@keel-engine/core/absent', workspace), undefined);
  const leaf = await buildEngineFeatures({ name: 'seed', features: [{ module: '@keel-engine/core/rng', exports: ['normalizeSeed'] }] });
  const broad = await buildEngineFeatures({ name: 'seed', features: [{ module: '@keel-engine/core', exports: ['normalizeSeed'] }] });
  assert.ok(leaf.report.gzipBytes < broad.report.gzipBytes / 2);
  console.log({ selectedSeedGzipBytes: leaf.report.gzipBytes, broadImportGzipBytes: broad.report.gzipBytes });
});
