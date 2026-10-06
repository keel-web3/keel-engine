import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { context } from 'esbuild';
import ts from 'typescript';
import { compilePrimitiveMacros, constructionCompilerPlugin } from '../src/construction-compiler.ts';

const options = { primitives: [{ callee: 'box', numeric: [2, 3, 4, 5, 6, 7] }], mode: 'reuse' as const };
const call = 'box(out,0,-(half*1.0000000000000002),y,0,half*1.0000000000000002,y,1);';
const fixture = `const out=[]; const box=(out,...args)=>{out.push(args)}; const half=input/2,y=3; ${call.repeat(12)} globalThis.output=out;`;
const execute = (source: string, input: number) => {
  const context: Record<string, any> = { input };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.output;
};
const numberBits = (value: unknown): string => {
  const numbers: number[] = [];
  const visit = (v: any) => { if (typeof v === 'number') numbers.push(v); else if (Array.isArray(v)) v.forEach(visit); };
  visit(value);
  return Buffer.from(Float64Array.from(numbers).buffer).toString('hex');
};

test('native primitive macros preserve Float64 bits, signed zero and complete original arithmetic', () => {
  const result = compilePrimitiveMacros(fixture, options);
  assert.ok(result.macros.length > 0);
  assert.equal(result.calls, 12);
  for (const input of [0, -0, 1, -3.75, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity, NaN]) {
    assert.equal(numberBits(execute(result.code, input)), numberBits(execute(fixture, input)));
  }
  assert.deepEqual(compilePrimitiveMacros(fixture, options), result);
});

test('opaque RNG calls and getters retain their original order and draw counts', () => {
  const source = `const out=[],events=[]; const box=(out,...args)=>{events.push('box');out.push(args)};
    const dims={get width(){events.push('get');return 2}};
    const draw=()=>{events.push('draw');return events.length/7};
    ${'box(out,0,-dims.width,draw(),0,dims.width,draw(),1);'.repeat(14)}
    globalThis.output=[out,events];`;
  const result = compilePrimitiveMacros(source, { ...options, mode: 'combined' });
  assert.equal(JSON.stringify(execute(result.code, 0)), JSON.stringify(execute(source, 0)));
});

test('mutable numeric parameters and shadowed primitives are not reused or redirected', () => {
  const source = `const out=[];const box=(out,...args)=>{out.push(args)};
    function f(x:number){${'box(out,0,-x,x=3,0,x,0,1);'.repeat(12)}}
    function shadow(box:any){${call.repeat(12)}}
    f(2);globalThis.output=out;`;
  const result = compilePrimitiveMacros(source, options);
  assert.equal(JSON.stringify(execute(result.code, 0)), JSON.stringify(execute(source, 0)));
  assert.ok(result.code.includes(call.repeat(12)));
});

test('receiver macros retain this, tuple element evaluation and copied-array behavior', () => {
  const source = `const out=[],events=[];const draw=()=>{events.push(events.length);return events.length};
    class Kit{limb(a,b,r,slot){out.push([this.tag,a,b,r,slot])} tag='same'} const K=new Kit();
    ${'K.limb([draw(),0,draw()],[draw(),1,draw()],.02,"bark");'.repeat(18)}
    globalThis.output=[out,events];`;
  const result = compilePrimitiveMacros(source, { primitives: [{ callee: 'K.limb', inlineArrays: [0, 1], numeric: [2] }], mode: 'arrays' });
  assert.ok(result.macros.length > 0);
  assert.equal(JSON.stringify(execute(result.code, 0)), JSON.stringify(execute(source, 0)));
});

test('unsupported syntax and bounded compiler work retain the exact original source', () => {
  for (const limit of [{ maxSourceBytes: 1 }, { maxCalls: 1 }, { maxVariants: 1 }, { maxMacros: 0 }]) {
    const result = compilePrimitiveMacros(fixture, { ...options, ...limit });
    assert.equal(result.code, fixture);
    assert.equal(result.macros.length, 0);
  }
  const malformed = 'const result=box(;;;';
  assert.equal(compilePrimitiveMacros(malformed, options).code, malformed);
  const deep = 'const box=(...x)=>{};box(' + '('.repeat(2_000) + '1' + ')'.repeat(2_000) + ');';
  assert.equal(compilePrimitiveMacros(deep, options).code, deep);
  const collision = fixture + '\nconst __keelPrimitive0="authored";';
  assert.equal(compilePrimitiveMacros(collision, options).code, collision);
  for (const escaped of ['\\u005f\\u005fkeelPrimitive0', '\\u{5f}\\u{5f}keelPrimitive0']) {
    const input = fixture + '\nconst ' + escaped + '=1;';
    assert.equal(compilePrimitiveMacros(input, options).code, input);
    const argument = fixture.replace('box(out,0,', 'box(out,' + escaped + ',');
    assert.equal(compilePrimitiveMacros(argument, options).code, argument);
  }
});

test('arrow-expression primitive calls keep observable return values', () => {
  const arrows = `const out=[];const box=(...args)=>args.length;const half=input/2,y=3;
    ${Array.from({ length: 12 }, (_, i) => 'const draw' + i + '=()=>'+call.slice(0,-1)+';out.push(draw'+i+'());').join('')}
    globalThis.output=out;`;
  const compiled = compilePrimitiveMacros(arrows, options);
  assert.ok(compiled.macros.length > 0);
  assert.equal(JSON.stringify(execute(compiled.code, 4)), JSON.stringify(execute(arrows, 4)));
});

test('arbitrary return-value calls remain verbatim outside the void primitive contract', () => {
  const source = `const box=(...args)=>args; function f(){return box(1,2,3,4,5,6,7,8)}; globalThis.output=f();`;
  assert.equal(compilePrimitiveMacros(source, options).code, source);
});


test('reusable construction plugin rereads edited sources on real esbuild rebuilds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keel-construction-'));
  const fileName = join(dir, 'generator.ts');
  const plugin = constructionCompilerPlugin({ sources: [{ ...options, fileName }] });
  await writeFile(fileName, fixture);
  const build = await context({ entryPoints: [fileName], write: false, bundle: true,
    format: 'iife', platform: 'browser', target: 'es2022', plugins: [plugin], logLevel: 'error' });
  try {
    const original = (await build.rebuild()).outputFiles[0]!.text;
    assert.equal(numberBits(execute(original, 4)), numberBits(execute(fixture, 4)));
    const edited = fixture.replace('y=3', 'y=4');
    await writeFile(fileName, edited);
    const rebuilt = (await build.rebuild()).outputFiles[0]!.text;
    assert.notEqual(rebuilt, original);
    assert.equal(numberBits(execute(rebuilt, 4)), numberBits(execute(edited, 4)));
    assert.equal((await build.rebuild()).outputFiles[0]!.text, rebuilt);
  } finally {
    await build.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
