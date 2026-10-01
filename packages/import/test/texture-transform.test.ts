import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAsset as normalizeV2 } from '../src/asset-normalize-v2.ts';
import { normalizeAsset as normalizeV3 } from '../src/asset-normalize-v3.ts';
import { compileAsset, buildFromPackage } from '../src/asset-compiler-v6.ts';
import { compileStyledAsset } from '../src/styled-asset-compiler.ts';
import { importStyledAsset } from '../src/styled-asset.ts';
import { parseGltf, readGlb } from '../src/gltf.ts';
import { soupOf, sampleTexture } from '../src/scene.ts';
import { voxelize } from '../src/voxelize.ts';
import { readTextureTransform } from '../src/texture-transform.ts';
import { textureTransformFixture } from './texture-transform-fixture.ts';
const ext = 'KHR_texture_transform';
const close = (actual: ArrayLike<number>, expected: ArrayLike<number>) => { assert.equal(actual.length, expected.length); for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i]! - expected[i]!) < 1e-6, `${i}: ${actual[i]} != ${expected[i]}`); };

for (const [name, normalize] of [['v2', normalizeV2], ['v3', normalizeV3]] as const) {
  test(`${name}: optional/required transforms preserve all material slots, declarations and UV bytes`, async () => {
    for (const required of [false, true]) {
      const f = textureTransformFixture({ required, allRoles: true }), result = await normalize(f.input());
      for (const key of ['materials', 'textures', 'samplers', 'extensionsUsed', 'extensionsRequired']) assert.deepEqual(result.json[key], f.json[key], key);
      for (let i = 0; i < f.arrays.length; i++) assert.deepEqual(result.accessors[i]!.array, f.arrays[i]);
    }
  });
  test(`${name}: malformed transforms, wrong placement and missing overridden UVs reject clearly`, async () => {
    for (const value of [null, [], { offset: [0] }, { offset: [0, '1'] }, { scale: [1, null] }, { rotation: null }, { texCoord: -1 }, { texCoord: .5 }]) {
      const f = textureTransformFixture(); f.json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions[ext] = value;
      await assert.rejects(normalize(f.input()), /invalid KHR_texture_transform/);
    }
    const f = textureTransformFixture(); delete f.json.meshes[0].primitives[0].attributes.TEXCOORD_1;
    await assert.rejects(normalize(f.input()), /KHR_texture_transform TEXCOORD_1/);
    const wrong = textureTransformFixture(); wrong.json.materials[0].extensions = { [ext]: {} };
    await assert.rejects(normalize(wrong.input()), /KHR_texture_transform at unsupported location/);
    for (const required of [false, true]) {
      const unknown = textureTransformFixture(); unknown.json[required ? 'extensionsRequired' : 'extensionsUsed'] = ['VENDOR_unknown'];
      await assert.rejects(normalize(unknown.input()), new RegExp(`unsupported ${required ? 'required' : 'optional'} extension VENDOR_unknown`));
    }
  });
}
test('transform defaults and numeric validation include unbounded negative scales', () => {
  assert.deepEqual(readTextureTransform({}), { offset: [0, 0], rotation: 0, scale: [1, 1] });
  assert.deepEqual(readTextureTransform({ scale: [-100, 0], texCoord: 2 }).scale, [-100, 0]);
  for (const value of [{ offset: [Infinity, 0] }, { rotation: NaN }, { scale: [1, -Infinity] }]) assert.throws(() => readTextureTransform(value), /invalid/);
});
test('voxel import applies offset * rotation * scale and UV override per textureInfo before wrapping', () => {
  const f = textureTransformFixture(), scene = parseGltf(f.glb()), soup = soupOf(scene);
  close(soup.uvs.slice(0, 6), [.75, -.3125, 1, -.625, -.25, -.375]);
  close(soup.uvs.slice(6), [.625, 0, 1.25, .125, .75, -.5]);
  assert.equal(scene.textures.length, 1, 'shared texture keeps independent material transforms');
  const uv = [.75, -.3125];
  assert.deepEqual(sampleTexture(scene, 0, ...uv as [number, number]), [0, 1, 0, 1]);
  for (const [wrap, expected] of [['repeat', [0, 0, 1, 1]], ['clamp', [0, 1, 0, 1]], ['mirror', [0, 1, 0, 1]]] as const) {
    const wrapped = { ...scene, textures: [{ ...scene.textures[0]!, wrapS: wrap, wrapT: wrap }] };
    assert.deepEqual(sampleTexture(wrapped, 0, 1.25, -.25), expected);
  }
});
test('sparse arbitrary UV sets retain their indices and missing referenced UVs never fall back silently', () => {
  const f = textureTransformFixture({ set: 2 }); delete f.json.meshes[0].primitives[0].attributes.TEXCOORD_0;
  const scene = parseGltf(f.glb()); assert.equal(scene.meshes[0]!.primitives[0]!.uvs![0], undefined); assert.equal(scene.materials[0]!.texture!.texCoord, 2);
  close(soupOf(scene).uvs.slice(0, 6), [.75, -.3125, 1, -.625, -.25, -.375]);
  delete f.json.meshes[0].primitives[0].attributes.TEXCOORD_2;
  assert.throws(() => parseGltf(f.glb()), /missing TEXCOORD_2/);
});
test('voxel colors equal independently pre-baked UVs for every wrap/filter combination', () => {
  for (const mode of [10497, 33071, 33648]) for (const filter of [9728, 9729]) {
    const f = textureTransformFixture(); f.json.samplers[0] = { wrapS: mode, wrapT: mode, magFilter: filter, minFilter: filter };
    const transformed = parseGltf(f.glb()), baked = parseGltf(f.glb());
    const meshes = baked.meshes.map(mesh => ({ ...mesh, primitives: mesh.primitives.map((p, i) => {
      const uv = i === 0 ? [.75, -.3125, 1, -.625, -.25, -.375] : [.625, 0, 1.25, .125, .75, -.5];
      return { ...p, uvs: [new Float32Array(uv)] };
    }) }));
    const materials = baked.materials.map(m => ({ ...m, texture: { texture: 0, texCoord: 0 } }));
    const a = voxelize(transformed, { voxels: 8, fill: 'none' }), b = voxelize({ ...baked, meshes, materials }, { voxels: 8, fill: 'none' });
    assert.deepEqual(a.occ, b.occ); close(a.colour, b.colour);
  }
});
test('native encode/decode/export preserves transform records in lossless and bounded-lossy modes', async () => {
  for (const mode of ['lossless', 'visual-preservation', 'bounded-lossy']) {
    const f = textureTransformFixture({ required: true, allRoles: true }), compiled = await compileAsset({ ...f.input(), mode, textures: { maxDimension: 128, quality: 90 } });
    const rebuilt = await buildFromPackage(compiled.packageBytes), normalized = await normalizeV3({ entry: 'out.glb', files: [{ name: 'out.glb', data: rebuilt.glb }] });
    for (const key of ['materials', 'textures', 'samplers', 'extensionsUsed', 'extensionsRequired']) assert.deepEqual(normalized.json[key], f.json[key], `${mode} ${key}`);
    close(soupOf(parseGltf(rebuilt.glb)).uvs, soupOf(parseGltf(f.glb())).uvs);
  }
});
test('pixel/dither exported assets retain transformed UVs, shared image references and extension declarations', async () => {
  const f = textureTransformFixture({ required: true }), compiled = await compileAsset({ ...f.input(), mode: 'lossless' });
  for (const kind of ['pixel', 'dither'] as const) {
    const result = await compileStyledAsset({ packageBytes: compiled.packageBytes, style: { kind, pixelSize: 4, toneLevels: 8, screen: 'bayer4' }, texture: { maxDimension: 128, paletteSize: 8 } });
    const imported = await importStyledAsset(result.assetBytes), json = readGlb(imported.glb).json;
    assert.equal(result.report.changedImages, 1);
    for (const key of ['materials', 'extensionsUsed', 'extensionsRequired']) assert.deepEqual(json[key], f.json[key]);
    close(soupOf(parseGltf(imported.glb)).uvs, soupOf(parseGltf(f.glb())).uvs);
    assert.equal((json.textures as any[])[0].source, 0);
  }
});
