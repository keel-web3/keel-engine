import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { defineManifest } from '@keel-engine/runtime';
import { buildKeelInlineShellFragments } from '@keel/sdk/inline-viewer-graph';
import { buildGameDocument } from '../src/document.ts';
import type { WorkspaceModule } from '../src/workspace.ts';

test('actual engine document builder applies the saved mode to page scripts and game module bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-engine-storage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src/index.ts'), 'export async function main(host){host.textContent="Storage fixture";}');
  const module: WorkspaceModule = { manifest: defineManifest({ id: 'fixtures/storage', version: '1.0.0',
    kind: 'game', phase: 'game', weight: 0, needs: [], provides: [] }), packageName: '@fixture/storage', dir, origin: 'project' };
  const shell = await buildKeelInlineShellFragments();
  const repeated = new TextEncoder().encode('globalThis.fixtureValue=7;\n'.repeat(2048));
  const tiny = new TextEncoder().encode('x=1');
  for (const payloadStorage of [undefined, 'raw'] as const) {
    const result = await buildGameDocument('fixtures/storage', [module], { modules: 'dev', shell, payloadStorage,
      pageScripts: [{ id: 'fixture/repeated', version: '1', bytes: repeated, weight: -1 },
                    { id: 'fixture/tiny', version: '1', bytes: tiny, weight: 0 }] });
    for (const report of result.modules) {
      const part = result.document.parts.find(part => part.moduleId === report.id)!;
      const item = JSON.parse(new TextDecoder().decode(part.bytes).replace(/^,|,$/g, ''));
      assert.equal(report.stored, item.embedded.storedIntegrity.byteLength);
      if (payloadStorage === 'raw') {
        assert.equal(item.embedded.compression, 'none');
        assert.equal(item.embedded.storedBase64, undefined);
        assert.equal(report.stored, report.bytes);
      }
      if (report.id === 'fixture/repeated') {
        if (payloadStorage === 'raw') assert.deepEqual(new TextEncoder().encode(item.embedded.storedText), repeated);
        else {
          assert.equal(item.embedded.compression, 'gzip');
          assert.ok(report.stored < report.bytes);
          assert.deepEqual(new Uint8Array(gunzipSync(Buffer.from(item.embedded.storedBase64, 'base64'))), repeated);
        }
      }
      if (report.id === 'fixture/tiny') {
        assert.equal(item.embedded.compression, 'none');
        assert.equal(item.embedded.storedText, 'x=1');
      }
    }
  }
});

test('engine rejects an invalid storage mode before generating or resolving any module', async () => {
  await assert.rejects(buildGameDocument('missing', [], { payloadStorage: 'encoded' as any }), /compact or raw/);
});
