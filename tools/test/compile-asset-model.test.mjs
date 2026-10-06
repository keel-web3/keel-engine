import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { brotliDecompressSync } from 'node:zlib';
import { generate } from '../../packages/builder/src/generate.ts';
import { storeVoxels, storeVoxelsText } from '../../packages/builder/src/voxel-store.ts';
import { createVoxels } from '../../packages/builder/src/voxels.ts';
import { storeModel } from '../../packages/builder/src/construction.ts';
import { compileAsset } from '../../packages/import/src/asset-compiler.ts';
const execute = promisify(execFile), cli = fileURLToPath(new URL('../compile-asset.mjs', import.meta.url));

test('canonical asset CLI prices real browser model runtime/data/license and replays its generated module', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-model-cli-'));
  try {
    const out = join(dir, 'browser');
    const { stdout } = await execute(process.execPath, [cli, 'tree', out, '--model-target', 'browser', '--generator', 'tree', '--seed', '42', '--compression', 'brotli']);
    const summary = JSON.parse(stdout), manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    assert.equal(summary.fullBytes, manifest.cost.fullBytes);
    assert.ok(summary.savedBytes > 0);
    assert.equal(manifest.cost.resources.length, 3);
    assert.equal(manifest.cost.resources.filter(row => row.id === 'model-runtime.mjs').length, 1);
    let bytes = 0;
    for (const name of manifest.transportFiles) {
      const packed = await readFile(join(out, name)); bytes += packed.length;
      assert.deepEqual(brotliDecompressSync(packed), await readFile(join(out, name.slice(0, -3))));
    }
    assert.equal(bytes, manifest.cost.fullBytes);
    const module = await import(pathToFileURL(join(out, 'model.generated.mjs')).href);
    const [[id, model]] = module.build();
    assert.equal(id, 'tree');
    assert.deepEqual(storeVoxels(model), storeVoxels(generate('tree', '42').model));
    assert.deepEqual(manifest.validation, { exactHostReplay: true, emittedModuleReplay: true, metadataAndGroupsExact: true });
    console.log({ cliFull: manifest.cost.fullBytes, cliBaseline: manifest.baselineCost.fullBytes, cliSaved: manifest.savedBytes });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ordinary GLB/glTF CLI keeps existing lossless package bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-asset-cli-'));
  try {
    const source = join(dir, 'tiny.gltf'), out = join(dir, 'ordinary');
    const data = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }));
    await writeFile(source, data);
    await execute(process.execPath, [cli, source, out]);
    const expected = await compileAsset({ entry: 'tiny.gltf', files: [{ name: 'tiny.gltf', data }], mode: 'lossless' });
    assert.deepEqual(await readFile(join(out, 'asset.kac')), Buffer.from(expected.packageBytes));
    assert.equal(await readFile(join(out, 'asset.generated.mjs'), 'utf8'), expected.program);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('existing binary/text model packets retain groups and share one priced runtime', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-packet-cli-'));
  try {
    const tree = generate('tree', 7).model, fence = createVoxels({ name: 'fence', unit: .125 });
    for (let x = 0; x < 8; x++) for (let y = 0; y < 4; y++) fence.set(x * 3, y, 0, 'primary');
    fence.groups.set('posts', [{ min: [0, 0, 0], max: [21, 3, 0] }]);
    const a = join(dir, 'tree.kc2'), b = join(dir, 'fence.kc1'), out = join(dir, 'models');
    await writeFile(a, storeModel(tree)); await writeFile(b, storeVoxelsText(fence));
    await execute(process.execPath, [cli, a, out, b, '--model-target', 'browser']);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.models.length, 2);
    assert.equal(manifest.cost.resources.filter(row => row.id === 'model-runtime.mjs').length, 1);
    const module = await import(pathToFileURL(join(out, 'model.generated.mjs')).href);
    const originals = new Map([['tree', tree], ['fence', fence]]);
    for (const [id, model] of module.build()) assert.deepEqual(storeVoxels(model), storeVoxels(originals.get(id)));
    assert.equal(manifest.cost.resources.reduce((n, row) => n + row.rawBytes, 0), manifest.cost.fullBytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
