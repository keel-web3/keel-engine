import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { encodeExactIndexSequence, decodeExactIndexSequence } from '../src/optimization/index-codec.ts';

test('meshopt sequence preserves every index slot and all unsigned source types', async () => {
  for (const C of [Uint8Array, Uint16Array, Uint32Array]) for (const compress of [false, true]) {
    for (const source of [[], [1], [0, 2, 1, 0, 3, 2, 0, 4, 3, 9, 8, 7], Array.from({ length: 3000 }, (_, i) => (i * 77) % 251)]) {
      const indices = new C(source), { recipe } = await encodeExactIndexSequence(indices, { compress });
      const decoded = await decodeExactIndexSequence(recipe, 256);
      assert.equal(decoded.constructor, indices.constructor);
      assert.deepEqual(decoded, indices);
    }
  }
});
test('large supported jumps and offset views roundtrip; unsupported Uint32 values reject', async () => {
  const data = new Uint32Array([99, 0, 0x3fffffff, 1, 0x3ffffffe, 0x20000000, 3, 17]);
  const indices = data.subarray(1, 7), { recipe } = await encodeExactIndexSequence(indices);
  assert.deepEqual(await decodeExactIndexSequence(recipe), indices);
  await assert.rejects(encodeExactIndexSequence(new Uint32Array([0, 0x40000000, 1])), /retain residual/);
  await assert.rejects(encodeExactIndexSequence(new Uint32Array([0xffffffff])), /retain residual/);
});
test('invalid counts, payload sizes, compressed extents and vertex references reject', async () => {
  const { recipe } = await encodeExactIndexSequence(new Uint16Array([0, 2, 1]));
  await assert.rejects(decodeExactIndexSequence({ ...recipe, count: 1e12 }));
  await assert.rejects(decodeExactIndexSequence({ ...recipe, data: { ...recipe.data, sourceLength: 1e12 } }));
  await assert.rejects(decodeExactIndexSequence({ ...recipe, data: { ...recipe.data, data: recipe.data.data.subarray(0, 2) } }));
  await assert.rejects(decodeExactIndexSequence(recipe, 2));
  const wide = await encodeExactIndexSequence(new Uint16Array([256]));
  await assert.rejects(decodeExactIndexSequence({ ...wide.recipe, componentType: 5121 }));
  const wider = await encodeExactIndexSequence(new Uint32Array([65536]));
  await assert.rejects(decodeExactIndexSequence({ ...wider.recipe, componentType: 5123 }));
});
test('standalone browser replay includes decoder WASM and excludes encoder', async () => {
  const bundle = await build({ stdin: { contents: "export {decodeExactIndexSequence} from './packages/import/src/optimization/index-codec.ts';", resolveDir: process.cwd() }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, metafile: true });
  assert(Object.keys(bundle.metafile!.inputs).some(path => path.endsWith('meshopt_decoder.module.js')));
  assert(!Object.keys(bundle.metafile!.outputs).some(path => path.includes('encoder')));
  const emittedInputs = Object.values(bundle.metafile!.outputs)[0]!.inputs;
  assert.equal(Object.entries(emittedInputs).filter(([path, value]) => path.includes('meshopt_encoder') && value.bytesInOutput > 0).length, 0);
  const browser = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0]!.contents).toString('base64'));
  const source = new Uint32Array([5, 3, 1, 8, 6, 4]), encoded = await encodeExactIndexSequence(source, { compress: true });
  assert.deepEqual(await browser.decodeExactIndexSequence(encoded.recipe), source);
});
