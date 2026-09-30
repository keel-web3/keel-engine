import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { decodeBuffer } from '../src/asset-buffer-codec.ts';
import { replaySurface } from '../src/asset-native-surface-v3.ts';
import type { SurfaceInput } from '../src/asset-native-surface-v3.ts';
import { EXACT_ENCODING_POLICY, encodeExactBuffer, encodeFixedResidual, encodeResidualAttribute, encodeSurface, exactRecipeBytes } from '../src/optimization/exact-encoding.ts';

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
let seed = 0x78523ab1;
function next(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
function checkSurface(input: SurfaceInput) {
  const encoded = encodeSurface(input), replay = replaySurface(encoded.recipe);
  assert.deepEqual(bytes(replay.positions), bytes(input.positions));
  assert.equal(replay.indices?.constructor, input.indices?.constructor);
  if (input.indices) assert.deepEqual(bytes(replay.indices!), bytes(input.indices)); else assert.equal(replay.indices, null);
  assert(encoded.metrics.recipeBytes <= encoded.metrics.residualRecipeBytes);
  assert.deepEqual(encodeSurface(input), encoded);
  return encoded;
}
test('bounded buffers preserve hostile Float32 words, subviews and actual fixed-residual cost', () => {
  const words = new Uint32Array(40002);
  for (let i = 0; i < words.length; i++) words[i] = i % 5 ? next() : [0x80000000, 0x7fc00042, 0xffc000aa, 1, 0x7f800000][Math.floor(i / 5) % 5]!;
  const array = new Float32Array(words.buffer, 4, 40000), source = bytes(array);
  const result = encodeResidualAttribute({ array, count: array.length, componentType: 5126, type: 'SCALAR', normalized: false });
  assert.deepEqual(decodeBuffer(result.recipe), source);
  assert.equal(result.metrics.recipeBytes, exactRecipeBytes(result.recipe));
  assert.equal(result.metrics.residualRecipeBytes, exactRecipeBytes(encodeFixedResidual(source, { stride: 4, componentBytes: 4 })));
  assert(result.metrics.recipeBytes <= result.metrics.residualRecipeBytes);
  assert(result.metrics.screenedBytes <= EXACT_ENCODING_POLICY.sampleBytes);
  assert(result.metrics.fullCandidates <= EXACT_ENCODING_POLICY.fullCandidates);
});
test('all typed attribute layouts and signed integer normalization preserve storage bytes', () => {
  for (const [componentType, C] of [[5120, Int8Array], [5121, Uint8Array], [5122, Int16Array], [5123, Uint16Array], [5125, Uint32Array], [5126, Float32Array]] as const) {
    for (const [type, width] of [['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4], ['MAT2', 4], ['MAT3', 9], ['MAT4', 16]] as const) {
      const array = new C(131 * width); for (let i = 0; i < array.length; i++) array[i] = next() % 1024 - 512;
      const result = encodeResidualAttribute({ array, count: 131, componentType, type, normalized: true });
      assert.deepEqual(decodeBuffer(result.recipe), bytes(array));
    }
  }
});
test('sample misprediction cannot beat the real byte-cost gate and screening is bounded', () => {
  const source = new Uint8Array(262144); for (let i = 0; i < source.length; i++) source[i] = next() & 255;
  for (let block = 0; block < 4; block++) { const at = Math.floor(block * (source.length - 2048) / 3 / 4) * 4; source.fill(0, at, at + 2048); }
  const result = encodeExactBuffer(source, { stride: 4, componentBytes: 4 });
  assert.deepEqual(decodeBuffer(result.recipe), source);
  assert(result.metrics.recipeBytes <= exactRecipeBytes(encodeFixedResidual(source, { stride: 4, componentBytes: 4 })));
  assert(result.metrics.fullCandidates <= 2);
  const wide = encodeExactBuffer(source, { stride: 4096, componentBytes: 8 });
  assert(wide.metrics.screenedBytes <= EXACT_ENCODING_POLICY.sampleBytes);
  assert.deepEqual(decodeBuffer(wide.recipe), source);
});
test('affine and grid operations are source-derived and fully word-exact', () => {
  const positions = new Float32Array(64 * 64 * 3);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) positions.set([x / 4, y / 2, 2], (y * 64 + x) * 3);
  assert.equal(checkSurface({ positions, indices: null }).recipe.positions.kind, 'grid');
  positions[777] = Math.fround(positions[777]! + 0.000001);
  assert.equal(checkSurface({ positions, indices: null }).recipe.positions.kind, 'residual');
  const affine = new Float32Array(900); for (let i = 0; i < 300; i++) affine.set([i / 4, 0, 2], i * 3);
  assert.equal(checkSurface({ positions: affine, indices: null }).recipe.positions.kind, 'affine');
});
test('single-pass fans, strips, mixed literals and all index widths retain ordered topology', () => {
  const positions = new Float32Array(400 * 3); for (let i = 0; i < 400; i++) positions.set([Math.sin(i), Math.cos(i), 2], i * 3);
  const fan: number[] = [], strip: number[] = [];
  for (let i = 2; i < 250; i++) { fan.push(0, i - 1, i); strip.push(i % 2 ? i - 1 : i - 2, i % 2 ? i - 2 : i - 1, i); }
  for (const C of [Uint8Array, Uint16Array, Uint32Array]) for (const indices of [fan, strip, [4, 2, 3, ...fan, 4, 8, 3, ...strip, 7, 2, 9]]) checkSurface({ positions, indices: new C(indices) });
});
test('arbitrary float bit patterns, empty arrays and nontriangle modes never lose a byte', () => {
  for (let trial = 0; trial < 25; trial++) {
    const words = new Uint32Array((3 + next() % 80) * 3); for (let i = 0; i < words.length; i++) words[i] = next();
    const positions = new Float32Array(words.buffer), indices = new Uint16Array(3 * (next() % 100)); for (let i = 0; i < indices.length; i++) indices[i] = next() % (words.length / 3);
    checkSurface({ positions, indices, mode: trial % 7 });
  }
  checkSurface({ positions: new Float32Array(), indices: new Uint8Array() });
  checkSurface({ positions: new Float32Array(new Uint32Array([0x80000000, 0x7fc00042, 1]).buffer), indices: null, mode: 0 });
});
test('invalid input shapes reject before compression', () => {
  assert.throws(() => encodeResidualAttribute({ array: new Float32Array(4), componentType: 5126, type: 'VEC3', count: 1, normalized: false }));
  assert.throws(() => encodeSurface({ positions: new Float32Array(3), indices: new Uint16Array([0, 1, 2]) }));
  assert.throws(() => encodeExactBuffer(new Uint8Array(32), { stride: 3, componentBytes: 2 }));
});
test('browser bundle executes the same bounded recipe and frozen replay decoder', async () => {
  const bundled = await build({ stdin: { contents: "export * from './packages/import/src/optimization/exact-encoding.ts'; export {replaySurface} from './packages/import/src/asset-native-surface-v3.ts';", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', minify: true, write: false });
  const browser = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.contents).toString('base64'));
  const positions = new Float32Array(900); for (let i = 0; i < 300; i++) positions.set([i / 4, 0, 2], i * 3);
  const input = { positions, indices: null }, result = encodeSurface(input);
  assert.deepEqual(browser.encodeSurface(input), result);
  assert.deepEqual(bytes(browser.replaySurface(result.recipe).positions), bytes(positions));
});
test('bounded exact mirror/reuse candidate preserves every source Float32 word',()=>{
 let seed=821947;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};const canonical=Float32Array.from({length:128*3},()=>random()/4294967296*17+.01),positions=new Float32Array(4096*3);for(let i=0;i<4096;i++){const row=(random()>>>8)%128,sign=random()&0x100?1:-1;positions.set(canonical.subarray(row*3,row*3+3),i*3);positions[i*3]=positions[i*3]!*sign;}
 const encoded=encodeSurface({positions,indices:null,mode:4}),replayed=replaySurface(encoded.recipe);assert.equal(encoded.recipe.positions.kind,'mirror');assert(encoded.metrics.mirrorGeneratedVertices>0);assert.deepEqual(new Uint32Array(replayed.positions.buffer),new Uint32Array(positions.buffer));assert(encoded.metrics.recipeBytes<=encoded.metrics.residualRecipeBytes);
});
