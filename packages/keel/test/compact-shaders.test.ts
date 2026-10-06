import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { compactGlsl, compactShaderLiterals, shaderTokens } from '../src/compact-shaders.ts';

test('GLSL compaction preserves operators, decimals, macros, directive boundaries and line continuations', () => {
  const glsl = `#version 300 es\n#define INC(x) ((x) + 1)\n#define LONG(x) \\\n+ ((x) * 2)\nprecision highp float; // comment\n/* multiline\ncomment */\nvoid main() { float x = 1.e-2; x = x + +x; x = x / *p; gl_Position = vec4(x); }\n`;
  const compact = compactGlsl(glsl);
  assert.ok(compact.length < glsl.length);
  assert.deepEqual(shaderTokens(compact), shaderTokens(glsl));
  assert.ok(compact.includes('#define INC(x) ((x) + 1)\n'));
  assert.equal(compactGlsl('#version 300 es\nint x=__LINE__;'), '#version 300 es\nint x=__LINE__;');
});

test('script compaction preserves interpolated shader values and opaque expression evaluation', () => {
  const sources = [
    'const k=140; globalThis.shader=`#version 300 es\n#define FAR ${k}.0\nprecision highp float; // gone\nvoid main(){float a=FAR;}\n`;',
    'const k=4; globalThis.shader="#version 300 es\\nprecision highp float;\\nuniform vec4 a["+k+"]; // gone\\nvoid main(){}\\n";',
    'let calls=0; const f=()=>{calls++;return "float z;\\n"}; globalThis.shader="#version 300 es\\n"+f()+"void main() { }\\n"; globalThis.calls=calls;',
    'const k=2; globalThis.shader=`#version 300 es\n// ${k} interpolated comment\nvoid main() { }`;',
  ];
  for (const source of sources) {
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    runInNewContext(source, before);
    runInNewContext(compactShaderLiterals(source).code, after);
    assert.deepEqual(shaderTokens(after.shader as string), shaderTokens(before.shader as string));
    assert.equal(after.calls, before.calls);
  }
  assert.equal(compactShaderLiterals('globalThis.text="Ordinary text,  unchanged.";').shaders, 0);
});

test('exact substring patches and variant assertions still run after literal compaction', () => {
  const source = `const base = "#version 300 es\\nprecision highp float;\\n// removable comment\\nvoid main() {\\n  float L = d.r;\\n}\\n";
    const variant = base.replace("  float L = d.r;\\n", "  float L = d.r * 2.0;\\n");
    if (!variant.includes("float L = d.r * 2.0;")) throw Error("variant patch broke");
    globalThis.shader = variant;`;
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  runInNewContext(source, before);
  const compact = compactShaderLiterals(source);
  runInNewContext(compact.code, after);
  assert.ok(compact.savedBytes > 0);
  assert.deepEqual(shaderTokens(after.shader as string), shaderTokens(before.shader as string));
});
