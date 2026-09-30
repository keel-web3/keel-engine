/** Exercise the real host adapter with Three r180 + GLTFLoader, without a GPU.
 * Pass an installed Three package directory; never downloads dependencies. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileAsset } from '../packages/import/src/asset-compiler-v6.ts';
import { animatedFixture, voxelFixture } from '../packages/import/test/styled-asset.test.ts';
import { createStyledAsset, importStyledAsset } from '../packages/import/src/styled-asset.ts';
import { createStyledAssetPlayer } from '../packages/import/src/styled-asset-player.ts';
const threeRoot = path.resolve(process.argv[2] ?? 'node_modules/three');
const THREE = await import(pathToFileURL(path.join(threeRoot, 'build/three.module.js')));
const { GLTFLoader } = await import(pathToFileURL(path.join(threeRoot, 'examples/jsm/loaders/GLTFLoader.js')));
const out = path.resolve(process.argv[3] ?? 'styled-player-check'); await fs.mkdir(out, { recursive: true });
const fixture = animatedFixture();
const compiled = await compileAsset({ mode: 'lossless', entry: 'rig.glb', files: [{ name: 'rig.glb', data: fixture.glb }] });
const style = { kind: 'dither', pixelSize: 4, toneLevels: 8, screen: 'bayer4' };
const records = [];
for (const kind of ['original', 'pixel', 'dither', 'voxel']) {
  const bytes = await createStyledAsset({ packageBytes: compiled.packageBytes, name: `Animated fixture (${kind})`, style: { ...style, kind }, ...(kind === 'voxel' ? { voxel: voxelFixture } : {}) });
  await fs.writeFile(path.join(out, `${kind}.keelasset`), bytes);
  const asset = await importStyledAsset(bytes), draws = [], targets = []; let target = null;
  const renderer = { extensions: { has: () => false }, getRenderTarget: () => target, setRenderTarget: value => { target = value; targets.push(value); }, clear() {}, render: (scene, camera) => draws.push({ scene, camera, target }) };
  const player = await createStyledAssetPlayer({ THREE, GLTFLoader, renderer, asset }), camera = new THREE.PerspectiveCamera();
  assert.equal(player.model.parent, player.scene);
  if (kind !== 'voxel') {
    assert.equal(player.clips.length, 1); player.seek(.25);
    assert.equal(player.model.getObjectByName('bone').position.x, .5);
    let skinned = 0; player.model.traverse(o => { if (o.isSkinnedMesh) skinned++; }); assert.equal(skinned, 1);
  } else { assert.equal(player.clips.length, 0); assert.equal(player.asset.voxelMesh.positions.length, 144); }
  player.render(camera, { width: 160, height: 120, time: .5 });
  const styled = kind === 'pixel' || kind === 'dither';
  assert.equal(draws.length, styled ? 2 : 1);
  assert.equal(draws[0].scene, player.scene);
  if (styled) {
    assert.equal(draws[0].target.width, 40); assert.equal(draws[0].target.height, 30);
    assert.equal(player.uniforms.levels.value, 8); assert.equal(player.uniforms.ditherStrength.value, kind === 'dither' ? 1 : 0);
    assert.equal(player.uniforms.thresholdTexture.value.image.data.length, 192 * 192);
    assert.equal(draws[1].target, null);
    player.setStyle({ ...style, kind: 'pixel', pixelSize: 8, toneLevels: 4, screen: 'weave' });
    player.render(camera, { width: 160, height: 120 });
    assert.equal(player.uniforms.lowSize.value.x, 20); assert.equal(player.uniforms.levels.value, 4);
  }
  records.push({ kind, envelopeBytes: bytes.length, geometryLoaded: true, animationClips: player.clips.length, styleRendered: true, gpuPixelsVerified: false });
  player.dispose(); assert.throws(() => player.render(camera, { width: 160, height: 120 }), /disposed/);
}
await fs.writeFile(path.join(out, 'player-report.json'), JSON.stringify({ three: THREE.REVISION, records, limitations: ['Real Three scene, animation mixer and render-pass wiring exercised using a renderer spy. Actual GPU pixels are not verified by this headless check.'] }, null, 2));
console.log(JSON.stringify(records));
