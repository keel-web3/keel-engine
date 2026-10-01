import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAsset } from '../src/asset-compiler-v6.ts';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { readGlb } from '../src/gltf.ts';
import { SCREENS } from '@keel-engine/core';
import { createStyledAsset, importStyledAsset, isStyledAsset, rebuildStyledVoxels, styledAssetJson, STYLED_ASSET_PROGRAM, STYLED_ASSET_DEPENDENCIES } from '../src/styled-asset.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
import { styledPixel, STYLED_PIXEL_FRAGMENT } from '../src/styled-asset-player.ts';

const style = { kind: 'dither' as const, pixelSize: 4, toneLevels: 8, screen: 'bayer4' as const };
export function animatedFixture() {
  const arrays = [new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array([0, 1, 2]), new Uint8Array(12), new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), new Float32Array([0, 1]), new Float32Array([0, 0, 0, 2, 0, 0])];
  const json = { asset: { version: '2.0' }, accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { componentType: 5123, count: 3, type: 'SCALAR' }, { componentType: 5121, count: 3, type: 'VEC4' }, { componentType: 5126, count: 3, type: 'VEC4' }, { componentType: 5126, count: 1, type: 'MAT4' }, { componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { componentType: 5126, count: 2, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1 }] }], nodes: [{ name: 'mesh', mesh: 0, skin: 0 }, { name: 'bone' }], skins: [{ inverseBindMatrices: 4, joints: [1] }], animations: [{ name: 'Move', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }], samplers: [{ input: 5, output: 6, interpolation: 'LINEAR' }] }], scenes: [{ nodes: [0, 1] }], scene: 0 };
  return { glb: writeNativeGlb(json, arrays, []), json, arrays };
}
let pending: ReturnType<typeof compileAsset>;
function compiled() { return pending ??= compileAsset({ mode: 'lossless', entry: 'rig.glb', files: [{ name: 'rig.glb', data: animatedFixture().glb }] }); }
const encode = packAsset;
const decode = unpackAsset;

test('styled envelope reconstructs real native source, rig, clips, and exact style', async () => {
  const c = await compiled(), bytes = await createStyledAsset({ packageBytes: c.packageBytes, style, name: 'Rig' });
  assert.equal(isStyledAsset(bytes), true); const imported = await importStyledAsset(bytes);
  assert.deepEqual(imported.style, style); assert.deepEqual(imported.animation, { mode: 'preserved', clips: 1, skins: 1 });
  assert.deepEqual((readGlb(imported.glb).json as any).animations, animatedFixture().json.animations);
  assert.deepEqual(imported.glb, c.preview.data); assert.equal(imported.sourceGlb, imported.glb);
  assert.deepEqual(imported.nativeScene.accessors[6], animatedFixture().arrays[6]);
  assert.deepEqual(decode(bytes).dependencies, STYLED_ASSET_DEPENDENCIES);
  assert.equal(decode(bytes).native.encoding, 'kap');
  assert.ok(bytes.length < c.packageBytes.length + 1500, 'compact carrier has bounded metadata overhead');
  assert.equal(imported.sourceBounds, null);
  assert.match(STYLED_ASSET_PROGRAM, /importStyledAsset\(data,options\)/);
  assert.doesNotMatch(STYLED_ASSET_PROGRAM, /eval\(|new Function/);
});

test('readable JSON compatibility preserves the canonical binary envelope semantics', async () => {
  const c = await compiled(), binary = await createStyledAsset({ packageBytes: c.packageBytes, style });
  const readable = new TextEncoder().encode(styledAssetJson(binary));
  assert.equal(isStyledAsset(readable), true);
  const imported = await importStyledAsset(readable);
  assert.deepEqual(imported.glb, c.preview.data); assert.deepEqual(imported.style, style);
  assert.equal(isStyledAsset(c.packageBytes), false);
});

test('rejects incompatible, executable, corrupt, malformed, and contradictory envelopes', async () => {
  const c = await compiled(), bytes = await createStyledAsset({ packageBytes: c.packageBytes, style });
  for (const mutate of [(e: any) => e.version = 3, (e: any) => e.style.screen = 'not-a-screen', (e: any) => e.style.pixelSize = 0, (e: any) => e.dependencies.renderer = 'three@latest', (e: any) => e.native.sha256 = '0'.repeat(64), (e: any) => e.native.byteLength++, (e: any) => e.code = 'globalThis.pwned=true', (e: any) => e.animation.mode = 'static-pose', (e: any) => e.style.constructor = {}]) {
    const e = decode(bytes); mutate(e); await assert.rejects(importStyledAsset(encode(e)));
  }
  await assert.rejects(importStyledAsset(new TextEncoder().encode('export default ()=>alert(1)')));
  await assert.rejects(createStyledAsset({ packageBytes: c.packageBytes, style, sourceBounds: { min: [2, 0, 0], max: [1, 1, 1] } }));
});

export const voxelFixture = { version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static', size: [2, 1, 1], origin: [4, 5, 6], unit: .5, indices: [0, 1], colors: [1, 0, 0, 0, 1, 0], occupancy: [1, 1] };
test('voxel import rebuilds cubes from grid recipe and labels static animation truthfully', async () => {
  const c = await compiled(), bytes = await createStyledAsset({ packageBytes: c.packageBytes, style: { ...style, kind: 'voxel' }, voxel: voxelFixture, staticPose: true });
  const imported = await importStyledAsset(bytes), json = readGlb(imported.glb).json as any;
  assert.deepEqual(imported.animation, { mode: 'static-pose', clips: 0, skins: 0 });
  assert.equal(imported.voxelMesh!.positions.length, 2 * 24 * 3); assert.equal(imported.voxelMesh!.indices.length, 2 * 36);
  assert.equal(readGlb(imported.sourceGlb).json.animations, undefined);
  assert.equal(imported.version, 3); assert.equal(imported.envelope.native.encoding, 'none');
  assert.equal(json.skins, undefined); assert.equal(json.animations, undefined);
  assert.equal(Math.min(...imported.voxelMesh!.positions.filter((_, i) => i % 3 === 0)), 4);
  assert.equal(Math.max(...imported.voxelMesh!.positions.filter((_, i) => i % 3 === 0)), 5);
  assert.throws(() => rebuildStyledVoxels({ ...voxelFixture, indices: [0, 0] }), /duplicate/);
});

test('saved tone levels and actual KEEL screens choose exact CPU reference steps', () => {
  for (const screen of Object.keys(SCREENS) as (keyof typeof SCREENS)[]) for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const value = (x + .3) / 21, levels = 6, scaled = value * (levels - 1), threshold = Math.fround(SCREENS[screen].at(x, y));
    const result = styledPixel([value, value, value, .37], x, y, { ...style, screen, toneLevels: levels });
    assert.equal(result[0], (Math.floor(scaled) + Number(scaled % 1 > threshold)) / (levels - 1)); assert.equal(result[3], .37);
  }
  assert.match(STYLED_PIXEL_FRAGMENT, /gl_FragColor.rgb\/gl_FragColor.a/);
  assert.match(STYLED_PIXEL_FRAGMENT, /pixel.y=lowSize.y-1.0-pixel.y/);
});
