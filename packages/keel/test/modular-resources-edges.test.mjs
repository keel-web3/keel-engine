import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {build,transform} from 'esbuild';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { MODULE_RUNTIME, packageModularOutputs } from '../src/modular-resources.mjs';
const compact = async source => (await transform(source,{minify:true,target:'es2022'})).code;

async function compile(root, names) {
  const result = await build({ entryPoints: Object.fromEntries(names.map(name => [name, resolve(root, name + '.js')])), absWorkingDir: root,
    outdir: resolve(root, 'dist'), entryNames: '[name]', chunkNames: 'chunk-[hash]', bundle: true, splitting: true,
    format: 'esm', write: false, metafile: true, target: 'es2022' });
  return packageModularOutputs({ result, transform, compact, typescript: ts, roots: { fixture: root }, workingDir: root,
    entryIds: new Map(names.map(name => [resolve(root, name + '.js'), 'fixture.' + name])) });
}

test('static cyclic modules share live bindings across facades without eager factory execution', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'keel-module-cycle-'));
  try {
    await writeFile(resolve(root, 'a.js'), 'import {b,nextB} from "./b.js";export let a=0;export function run(){a++;nextB();return [a,b]}');
    await writeFile(resolve(root, 'b.js'), 'import {a} from "./a.js";export let b=10;export function nextB(){b+=a}');
    await writeFile(resolve(root, 'game.js'), 'export {run} from "./a.js";globalThis.started=(globalThis.started||0)+1;');
    const resources = await compile(root, ['game', 'a', 'b']);
    const context = {}; runInNewContext(MODULE_RUNTIME, context);
    for (const resource of resources.slice().reverse()) runInNewContext(resource.bytes.toString(), context);
    assert.equal(context.started, undefined);
    const game = context.__KEEL_STATIC_MODULES__.require('fixture.game');
    assert.equal(context.started, 1);
    assert.deepEqual(Array.from(game.run()), [1, 11]);
    assert.deepEqual(Array.from(game.run()), [2, 13]);
    assert.equal(context.__KEEL_STATIC_MODULES__.require('fixture.a').a, 2);
    assert.equal(context.__KEEL_STATIC_MODULES__.require('fixture.b').b, 13);
    context.__KEEL_STATIC_MODULES__.require('fixture.game');
    assert.equal(context.started, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dynamic emitted ESM imports reject before static packaging', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'keel-module-dynamic-'));
  try {
    await writeFile(resolve(root, 'game.js'), 'export const load=()=>import("./other.js");');
    await writeFile(resolve(root, 'other.js'), 'export const value=7;');
    await assert.rejects(() => compile(root, ['game']), /Dynamic module imports are unsupported/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function synthetic(input, root = '/tmp/known-fixture') {
  const path = resolve(root, 'dist/chunk.js');
  const result = { metafile: { inputs: {}, outputs: { [path]: { inputs: { [input]: { bytesInOutput: 7 } }, imports: [], exports: ['value'] } } },
    outputFiles: [{ path, contents: Buffer.from('export const value=7;') }] };
  return packageModularOutputs({ result, transform, compact, typescript: ts, roots: { fixture: root }, workingDir: root, entryIds: new Map() });
}

test('virtual namespace identities do not become fake paths under a checkout root', async () => {
  const first = await synthetic('palette-data:amber', '/tmp/checkout-a');
  const second = await synthetic('palette-data:amber', '/tmp/checkout-b');
  assert.deepEqual(first[0].sources, ['palette-data:amber']);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].sha256, second[0].sha256);
});

test('unknown absolute source roots reject', async () => {
  await assert.rejects(() => synthetic('/tmp/outside-fixture/shared.js'), /Unregistered module source root/);
});

test('unknown relative source roots also reject', async () => {
  await assert.rejects(() => synthetic('../outside-fixture/shared.js'), /Unregistered module source root/);
});
