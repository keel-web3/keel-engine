import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeSource, getFileRole, QUALITY_POLICY, scanProject, summarize } from '../quality-audit.mjs';

test('file roles give entries and features smaller budgets than engine libraries', () => {
  assert.equal(getFileRole('packages/core/src/index.ts').maxLines, 150);
  assert.equal(getFileRole('packages/ui/src/menu.ts').maxLines, 300);
  assert.equal(getFileRole('packages/core/src/math.ts').maxLines, 500);
  assert.equal(getFileRole('packages/bake/src/mesh.ts').maxLines, 800);
  assert.equal(getFileRole('packages/bake/src/sprites.ts').maxLines, 800);
  assert.equal(getFileRole('packages/worldgen/src/dungeon-gl-world-shaders.ts').maxLines, 800);
});

test('audit warns on long modules, overlong functions and oversized argument lists', () => {
  const body = Array.from({ length: 125 }, (_, index) => `  const value${index} = ${index};`).join('\n');
  const source = [
    'export function publicApi(a, b, c, d) { return a; }',
    'function internalHelper(a, b, c, d, e, f) { return a; }',
    `function oversized() {\n${body}\n}`,
    ...Array.from({ length: 510 }, () => '// module line'),
  ].join('\n');
  const warnings = analyzeSource(source, 'packages/core/src/large-module.ts');
  const counts = summarize(warnings);
  assert.ok(counts['file-lines'] >= 1);
  assert.equal(counts['function-lines'], 1);
  assert.equal(counts['max-arguments'], 2);
});

test('nested helpers use the internal argument limit inside exported functions', () => {
  const source = [
    'export function wrapper(a, b, c, d) {',
    '  function smallHelper(a, b, c, d) { return a; }',
    '  function largeHelper(a, b, c, d, e, f) { return a; }',
    '}',
  ].join('\n');
  const warnings = analyzeSource(source, 'packages/core/src/helpers.ts')
    .filter((warning) => warning.rule === 'max-arguments');
  assert.deepEqual(warnings.map((warning) => warning.message), [
    'wrapper has 4 arguments; public API limit is 3',
    'largeHelper has 6 arguments; internal limit is 5',
  ]);
});

test('audit applies filename conventions and directory limits while ignoring generated outputs and sibling projects', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'keel-quality-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = join(root, 'packages', 'sample', 'src');
  mkdirSync(sourceDirectory, { recursive: true });
  for (let index = 0; index < 31; index += 1) {
    writeFileSync(join(sourceDirectory, `part-${index}.ts`), 'export const value = 1;\n');
  }
  writeFileSync(join(sourceDirectory, 'BadName.ts'), 'export const value = 1;\n');
  mkdirSync(join(root, 'packages', 'sample', 'dist'), { recursive: true });
  writeFileSync(join(root, 'packages', 'sample', 'dist', 'bad_name.ts'), 'not source\n');
  mkdirSync(join(root, 'packages', 'sample', 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'packages', 'sample', 'node_modules', 'BadName.ts'), 'not source\n');
  mkdirSync(join(root, 'apps', 'web', 'src'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'src', 'ignored.ts'), `${Array.from({ length: 510 }, () => '// sibling source').join('\n')}\n`);

  const result = scanProject(root);
  assert.equal(result.warnings.filter((warning) => warning.rule === 'directory-files').length, 1);
  assert.ok(result.warnings.some((warning) => warning.rule === 'file-naming' && warning.path.endsWith('BadName.ts')));
  assert.equal(result.filesScanned, 32);
  assert.ok(!result.warnings.some((warning) => warning.path.includes('/dist/') || warning.path.includes('/node_modules/')));
  assert.ok(!result.warnings.some((warning) => warning.path.startsWith('apps/web/')));
});

test('scan roots, path roles and thresholds can be supplied by a repository profile', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'keel-quality-profile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = join(root, 'app', 'src');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(join(sourceDirectory, 'entry.ts'), 'export function run(a, b, c, d) {\n  return a;\n}\n');
  writeFileSync(join(sourceDirectory, 'value.ts'), 'export const value = 1;\n');

  const result = scanProject(root, {
    roots: ['app'],
    roleForPath: (path) => path.endsWith('/entry.ts')
      ? { name: 'profile-entry', maxLines: 2, maxFunctionLines: 1 }
      : { name: 'profile-module', maxLines: 10, maxFunctionLines: 10 },
    policy: {
      ...QUALITY_POLICY,
      absoluteMaxLines: 20,
      maxDirectSourceFiles: 1,
      maxPublicArguments: 4,
    },
  });
  assert.equal(result.warnings.filter((warning) => warning.rule === 'directory-files').length, 1);
  assert.equal(result.warnings.filter((warning) => warning.rule === 'file-lines').length, 1);
  assert.equal(result.warnings.filter((warning) => warning.rule === 'function-lines').length, 1);
  assert.equal(result.warnings.filter((warning) => warning.rule === 'max-arguments').length, 0);
});

test('repository profiles can exclude an exact generated source artifact', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'keel-quality-exclude-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = join(root, 'tools', 'performance', 'wasm');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(join(sourceDirectory, 'compare.js'), `${Array.from({ length: 1_001 }, () => 'const generated = 1;').join('\n')}\n`);

  const result = scanProject(root, {
    roots: ['tools'],
    excludeFile: (path) => path === 'tools/performance/wasm/compare.js',
  });
  assert.equal(result.filesScanned, 0);
  assert.equal(result.warnings.length, 0);
});
