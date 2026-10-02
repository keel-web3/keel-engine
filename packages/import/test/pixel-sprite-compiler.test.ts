import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { compilePixelSpriteSourceAsset, compilePixelSpriteStyledAsset, compileRasterSourceAsset, PIXEL_SPRITE_PRESETS } from '../src/raster-compiler.ts';
import { styledIndependentFixture } from './styled-compression-independent.test.ts';
import { compileAsset } from '../src/asset-compiler-v6.ts';
import { importStyledAsset, styledAssetJson } from '../src/styled-asset.ts';
const codec = { id: 'node-brotli-quality11-test', compress: (bytes: Uint8Array) => new Uint8Array(brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })), decompress: (bytes: Uint8Array) => new Uint8Array(brotliDecompressSync(bytes)) };
const source = () => ({ entry: 'fixture.glb', files: [{ name: 'fixture.glb', data: styledIndependentFixture().glb }] });

test('compact Pixel mode has explicit sprite tradeoffs and controls change actual exports', async () => {
 const a = await compilePixelSpriteSourceAsset({ ...source(), representation: 'sprite', clipIndex: 0, preset: 'small', costCodec: codec });
 const b = await compilePixelSpriteSourceAsset({ ...source(), representation: 'sprite', clipIndex: 0, preset: 'balanced', costCodec: codec });
 assert.equal(a.imported.raster.width, 32); assert.equal(b.imported.raster.width, 64);
 assert.notDeepEqual(a.assetBytes, b.assetBytes);
 assert.deepEqual(a.report.fidelity, { freeCamera: false, selectedClip: 0, otherClipsRetained: false, bakedDirections: 1, sourceModelRetained: false });
 assert.equal(a.report.settings.shading, 'unlit'); assert.equal(a.imported.animation.mode, 'baked-frames');
 assert.ok(a.imported.raster.frames.some(frame => frame.some((value, i) => i % 4 === 3 && value > 0)));
 assert.notDeepEqual(a.imported.raster.frames[0], a.imported.raster.frames.at(-1));
 const readable = await importStyledAsset(new TextEncoder().encode(styledAssetJson(a.assetBytes))); assert.ok('raster' in readable);
 assert.deepEqual(readable.raster.frames, a.imported.raster.frames);
 assert.deepEqual((await compilePixelSpriteSourceAsset({ ...source(), representation: 'sprite', clipIndex: 0, preset: 'small', costCodec: codec })).assetBytes, a.assetBytes);
 assert(Object.isFrozen(PIXEL_SPRITE_PRESETS.small));
 await assert.rejects(compilePixelSpriteSourceAsset({ ...source(), representation: 'model-3d', clipIndex: 0 } as any), /explicitly/);
 await assert.rejects(compilePixelSpriteSourceAsset({ ...source(), representation: 'sprite', clipIndex: 0, quality: { files: [] } } as any), /quality control/);
});

test('pinned cost selection measures at most four complete assets and round-trips the chosen pixels', async () => {
 let count = 0;
 const result = await compilePixelSpriteSourceAsset({ ...source(), representation: 'sprite', clipIndex: 0, preset: 'small', costCodec: { ...codec, compress: bytes => { count++; return codec.compress(bytes); } } });
 const transport = result.report.codec.transport!;
 assert(count >= 3 && count <= 4); assert.equal(count, transport.candidates.length);
 assert.equal(transport.bytes, Math.min(...transport.candidates.map(candidate => candidate.transportBytes)));
 assert.equal(codec.compress(result.assetBytes).length, transport.bytes);
 assert.equal(transport.roundTripVerified, true);
 assert.equal(result.assetBytes.length, transport.candidates.find(candidate => candidate.encoding === result.report.codec.selected)!.assetBytes);
 assert(result.timings.transportSelection >= 0);
 const native = await compileAsset({ ...source(), mode: 'lossless' });
 const replayed = await compilePixelSpriteStyledAsset({ packageBytes: native.packageBytes, representation: 'sprite', clipIndex: 0, preset: 'small', costCodec: codec });
 assert.deepEqual(replayed.imported.raster.frames, result.imported.raster.frames);
});

test('a supplied cost encoder cannot bypass transport verification or return an empty measurement', async () => {
 const input = { ...source(), resolution: 32 as const, paletteSize: 8 as const, fps: 8, directions: 1 as const, clipIndex: 0, kind: 'pixel' as const, screen: 'bayer4' as const };
 await assert.rejects(compileRasterSourceAsset({ ...input, costCodec: { id: 'empty', compress: () => new Uint8Array() } }), /invalid bytes/);
 await assert.rejects(compileRasterSourceAsset({ ...input, costCodec: { id: 'invalid', compress: () => new Uint8Array([1]), decompress: () => new Uint8Array([2]) } }), /round-trip/);
 await assert.rejects(compileRasterSourceAsset({ ...input, costCodec: { id: '', compress: codec.compress } }), /cost codec/);
});
