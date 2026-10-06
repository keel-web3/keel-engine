import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPixelRenderer } from '../src/pixel-renderer.ts';
import { createIndexedRenderer } from '../src/baker.ts';
import type { RenderCanvas } from '../src/pixel-renderer.ts';
import { standIn } from './gl-stand-in.ts';
import { buildEngineFeatures } from '../../keel/src/features.ts';

function normalize(calls: unknown) {
  const ids = new Map<string, string>();
  return JSON.stringify(calls, (_, value) => typeof value === 'string' ? value.replace(/#(?:buffer|shader|program|texture|framebuffer)\d+/gu, id => {
    let slot = ids.get(id); if (!slot) ids.set(id, slot = '#' + ids.size); return slot;
  }) : value);
}

test('indexed-only backend makes the same GPU draws, uniforms and solid uploads as the complete renderer', () => {
  const a = standIn(), b = standIn();
  const full = createPixelRenderer(a.canvas as RenderCanvas, { width: 32, height: 48, bakeOnly: true });
  const small = createIndexedRenderer(b.canvas as RenderCanvas, { width: 32, height: 48 });
  for (const renderer of [full, small]) {
    renderer.setPalette([[10, 20, 30]], { base: [0, 1], other: [0, 1] });
    renderer.setMaterials([{ ramp: 'other', light: .7, pattern: 1, glow: .3 }]);
    // Warm optional programs before comparing the shared drawing pass.
    renderer.renderIndexed({ eye: [4, 3, 5], target: [0, 1, 0], ortho: 3 });
    renderer.renderIndexedHeights({ eye: [4, 3, 5], target: [0, 1, 0], ortho: 3, pixelsPerMetre: 24 });
  }
  assert.equal(a.calls.filter(([name]) => name === 'createProgram').length, 4);
  assert.equal(b.calls.filter(([name]) => name === 'createProgram').length, 3);
  a.calls.length = 0; b.calls.length = 0;
  for (const renderer of [full, small]) {
    const counts = renderer.setWorld({
      boxes: [{ c: [1, 2, 3], h: [2, 1, .5], yaw: .7 }, { kind: 'wedge', c: [0, 0, 1], h: [2, 3, 4], top: [-.3, .7], skin: .2 }],
      wedges: [{ c: [1, 0, 1], h: [1, 2, 1], lo: .4 }],
      capsules: [{ a: [0, 1, 0], b: [1, 2, 1], r: .3, mat: 1 }],
    });
    assert.deepEqual(counts, { boxes: 1, wedges: 2, capsules: 1, dropped: 0 });
    const camera = { eye: [4, 3, 5] as const, target: [0, 1, 0] as const, fov: 1.1, ortho: 3 };
    renderer.renderIndexed({ ...camera, split: [0, .5, 0], gap: .2, time: 4, sun: [.3, .8, .2] });
    renderer.readIndexed();
    renderer.renderIndexedHeights({ ...camera, pixelsPerMetre: 24, eps: .03 });
    renderer.setTarget(64, 24);
    renderer.renderIndexed(camera);
    renderer.readIndexed();
  }
  assert.equal(normalize(a.calls), normalize(b.calls));
  assert.equal('render' in small, false);
  small.dispose();
});

test('baking feature excludes realtime color, raster, FX and target-profile dependencies', async () => {
  const profile = JSON.parse(await readFile(new URL('../../../tools/profiles/indexed-baker.json', import.meta.url), 'utf8'));
  const artifact = await buildEngineFeatures(profile);
  assert.ok(artifact.gzip.length < 13000, `baker gzip: ${artifact.gzip.length}`);
});


test('identical normalized baking dimensions retain targets; external canvas resize is restored', () => {
  const s = standIn();
  const renderer = createIndexedRenderer(s.canvas as RenderCanvas, { width: 32, height: 48 });
  s.calls.length = 0;
  for (let i = 0; i < 100; i++) renderer.setTarget(32.9, 48.9);
  assert.equal(s.calls.length, 0);
  renderer.setTarget(64, 24);
  assert.equal(s.calls.filter(([name]) => name === 'createTexture').length, 3);
  s.calls.length = 0;
  renderer.setTarget(64, 24);
  assert.equal(s.calls.length, 0);
  s.canvas.width = 8;
  renderer.setTarget(64, 24);
  assert.equal(s.canvas.width, 64);
  assert.equal(s.calls.filter(([name]) => name === 'createTexture').length, 3);
  renderer.dispose();
});
