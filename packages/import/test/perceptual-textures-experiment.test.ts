import test from 'node:test';
import assert from 'node:assert/strict';
import { APPEARANCE_LADDER, appearanceEligibility, measureAppearance, optimizeAppearanceTextures } from '../src/optimization/perceptual-textures-experiment.ts';
import type { AppearanceRaster, AppearanceSample } from '../src/optimization/perceptual-textures-experiment.ts';
import type { NormalizedAsset } from '../src/asset-normalize-v3.ts';
import { encodePng } from '../src/png.ts';

function fixture(width = 64, alpha = false): NormalizedAsset {
  const data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) data.set([90, 140, 200, alpha ? x % 2 * 255 : 255], x * 4);
  const image = encodePng({ width, height: 1, data });
  const json = { asset: { version: '2.0' }, images: [{ mimeType: 'image/png' }], textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }] };
  return { format: 'KEEL-NATIVE-SCENE', version: 2, json, sourceJson: structuredClone(json), accessors: [], images: [{ sourceIndex: 0, mimeType: 'image/png', data: image }], source: { entry: 'fixture.glb', container: 'glb', files: [] }, validation: { accessorCount: 0, sourceAccessorCount: 0, decodedBytes: image.length, dracoPrimitives: 0, meshPrimitives: 1, imageBytes: image.length, preservedSourceIndices: true, decodedReference: 'source-accessor-values', warnings: [] }, runtime: { dependencies: [], dracoRequiredForReplay: false, decoderCostIncluded: false, decoderNote: '' } };
}
const good: AppearanceSample = { id: 'default/256/camera-0', viewport: [256, 256], colorRmse: 0, colorMax: 0, colorP99: 0, edgeRmse: 0, edgeMax: 0, coverageDifference: 0, coveredPixels: 100, comparedEdges: 200 };
function raster(pixels: number[][], coverage: number[]): AppearanceRaster { return { width: pixels.length, height: 1, rgba: new Uint8Array(pixels.flat()), coverage: new Uint8Array(coverage) }; }

test('covered color and edge metrics do not dilute error with background', () => {
  const a = raster([[0,0,0,255],[0,0,0,255],[0,0,0,255],[0,0,0,255]], [0,1,0,0]);
  const b = raster([[0,0,0,255],[30,30,30,255],[0,0,0,255],[0,0,0,255]], [0,1,0,0]);
  const e = measureAppearance(a,b);
  assert.equal(e.colorRmse, 30); assert.equal(e.colorP99, 30); assert.equal(e.coveredPixels, 1);
  assert.equal(e.edgeRmse, 30); assert.equal(e.comparedEdges, 2); assert.equal(e.coverageDifference, 0);
  assert.deepEqual(measureAppearance(a,a), { colorRmse: 0, colorMax: 0, colorP99: 0, edgeRmse: 0, edgeMax: 0, coverageDifference: 0, coveredPixels: 1, comparedEdges: 2 });
});

test('coverage XOR detects exchanged pixels even with identical total coverage', () => {
  const a = raster([[0,0,0,255],[0,0,0,255]], [1,0]), b = raster([[0,0,0,255],[0,0,0,255]], [0,1]);
  assert.equal(measureAppearance(a,b).coverageDifference, 1);
  assert.throws(()=>measureAppearance(a,{...b,width:3}),/dimensions/);
});

test('unsupported maps, mixing, transforms, BLEND and nearest samplers stay exact', async () => {
  for (const material of [
    { normalTexture: { index: 0 } }, { occlusionTexture: { index: 0 } },
    { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, emissiveTexture: { index: 0 } },
    { pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [.2,0] } } } } },
    { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, alphaMode: 'BLEND' },
  ]) {
    const input = fixture(); input.json.materials[0] = material;
    assert(appearanceEligibility(input,0));
    const result = await optimizeAppearanceTextures(input, async()=>{ throw new Error('must not render'); });
    assert.deepEqual(result.asset.images,input.images); assert.equal(result.report.encodedCandidates,0);
  }
  const input = fixture(); input.json.textures[0].sampler = 0; input.json.samplers = [{ magFilter: 9728 }];
  assert.match(appearanceEligibility(input,0)!, /nearest/);
});

test('source alpha gates are mandatory even when texture color error is loosened', async () => {
  const input = fixture(1025,true); input.json.materials[0].alphaMode = 'MASK';
  const result = await optimizeAppearanceTextures(input, async()=>{ assert.fail('alpha failure must precede rendering'); }, { maxRgbaRmse: 255 });
  assert.equal(result.report.changedImages,0); assert.deepEqual(result.asset.images,input.images);
  assert.equal(result.report.encodedCandidates,3);
  for (const candidate of result.report.images[0]!.candidates) { assert(candidate.texture.candidates[0]!.error!.alphaRmse > 8); assert.match(candidate.reason,/no smaller candidate/); }
});

test('bounded three-candidate selection is source-based and keeps input and materials exact', async () => {
  const input = fixture(2048), before = structuredClone(input), calls: Array<number|null> = [];
  const result = await optimizeAppearanceTextures(input, async(asset,index)=>{ calls.push(index); assert.deepEqual(asset.json.materials,input.json.materials); return [good]; });
  assert.equal(APPEARANCE_LADDER.length,3); assert.equal(result.report.encodedCandidates,3);
  assert.equal(result.report.changedImages,1); assert(result.report.outputBytes < result.report.sourceBytes);
  assert.equal(calls.at(-1),null); assert.deepEqual(input,before);
  assert.deepEqual(result.asset.sourceJson,input.sourceJson); assert.deepEqual(result.asset.accessors,input.accessors);
  assert.deepEqual(result.report.images[0]!.candidates.map(c=>c.texture.sourceDimensions),[[2048,1],[2048,1],[2048,1]]);
});

test('render rejection and final combination rollback are conservative', async () => {
  for (const sample of [{...good,colorRmse:9},{...good,colorP99:41},{...good,edgeRmse:13},{...good,coverageDifference:.0001},{...good,coveredPixels:0},{...good,colorRmse:NaN}]) {
    const input=fixture(2048), result=await optimizeAppearanceTextures(input,async()=>[sample]);
    assert.equal(result.report.changedImages,0); assert.deepEqual(result.asset.images,input.images);
  }
  const input=fixture(2048), result=await optimizeAppearanceTextures(input,async(_asset,index)=>index===null?[{...good,coverageDifference:.01}]:[good]);
  assert.equal(result.report.finalAccepted,false); assert.equal(result.report.savedBytes,0); assert.deepEqual(result.asset.images,input.images);
  assert.match(result.report.images[0]!.reason,/rolled back/);
});
