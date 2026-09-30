#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const QUALITY_POLICY = Object.freeze({
  maxDirectSourceFiles: 30,
  absoluteMaxLines: 999,
  roles: Object.freeze({
    entry: Object.freeze({ maxLines: 150, maxFunctionLines: 120 }),
    feature: Object.freeze({ maxLines: 300, maxFunctionLines: 75 }),
    module: Object.freeze({ maxLines: 500, maxFunctionLines: 120 }),
    coordinator: Object.freeze({ maxLines: 800, maxFunctionLines: 200 }),
  }),
  maxPublicArguments: 3,
  maxInternalArguments: 5,
});

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.css', '.scss', '.sass', '.less', '.glsl', '.vert',
  '.frag', '.wgsl', '.vs', '.fs', '.sh', '.c', '.h', '.cc', '.cpp',
  '.hh', '.hpp',
]);

export const DEFAULT_SCAN_ROOTS = Object.freeze(['packages', 'packs', 'ai', 'systems', 'tools']);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.cache', '.next', '.turbo', 'node_modules', 'dist', 'build',
  'coverage', 'target', 'vendor', 'out', 'generated',
]);

function isSourcePath(path) {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase())
    && !/(?:^|[._-])(?:generated|gen)(?:[._-]|$)/i.test(basename(path));
}

function isManifestPath(path) {
  return basename(path) === 'package.json';
}

function extensionConvention(extension) {
  if (['.py', '.rs', '.c', '.h', '.cc', '.cpp', '.hh', '.hpp'].includes(extension)) {
    return { name: 'snake_case', pattern: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/ };
  }
  if (SOURCE_EXTENSIONS.has(extension)) {
    return { name: 'kebab-case', pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ };
  }
  return null;
}

export function getFileRole(path) {
  const normalized = path.split(sep).join('/');
  const file = basename(path);
  const extension = extname(file);
  const stem = extension ? file.slice(0, -extension.length) : file;

  if (isManifestPath(path) || /^(?:index|main|cli|module|mod|entry|bootstrap)$/.test(stem)) {
    return { name: 'entry', ...QUALITY_POLICY.roles.entry };
  }

  if (/^packages\/(?:ui|controls|input)\/src\//.test(normalized)) {
    return { name: 'feature', ...QUALITY_POLICY.roles.feature };
  }

  if (/^packages\/worldgen\/src\/dungeon-gl(?:-(?:world|fx)-shaders)?\.ts$/.test(normalized)) {
    return { name: 'coordinator', ...QUALITY_POLICY.roles.coordinator };
  }

  if (/^packages\/(?:bake|runtime|worldgen|terrain|render|physics|road|world|scene)\/src\/(?:engine|bake|world|mesh|terrain|road|renderer|scene|sprites)\.(?:ts|tsx)$/.test(normalized)) {
    return { name: 'coordinator', ...QUALITY_POLICY.roles.coordinator };
  }

  return { name: 'module', ...QUALITY_POLICY.roles.module };
}

function lineCount(source) {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\r|\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function scriptKindFor(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (['.js', '.mjs', '.cjs'].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasModifier(node, modifier) {
  return node.modifiers?.some((entry) => entry.kind === modifier) ?? false;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node);
}

function isPublicApi(node, sourceFile) {
  let current = node;
  while (current && current !== sourceFile) {
    if (hasModifier(current, ts.SyntaxKind.PrivateKeyword)
      || hasModifier(current, ts.SyntaxKind.ProtectedKeyword)) return false;
    if (hasModifier(current, ts.SyntaxKind.ExportKeyword)) return true;
    if (current !== node && ts.isFunctionLike(current)) return false;
    if (current !== node && ts.isClassLike(current)) {
      return hasModifier(current, ts.SyntaxKind.ExportKeyword);
    }
    current = current.parent;
  }
  return false;
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isMethodDeclaration(node) && node.name) return node.name.getText();
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    && ts.isVariableDeclaration(node.parent)
    && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    && ts.isPropertyAssignment(node.parent)) return node.parent.name.getText();
  return '<anonymous>';
}

function analyzeTypeScript(source, path, role, policy) {
  const warnings = [];
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKindFor(path));

  const visit = (node) => {
    if (isFunctionLike(node) && node.body) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endOffset = Math.max(node.end - 1, node.getStart(sourceFile));
      const endLine = sourceFile.getLineAndCharacterOfPosition(endOffset).line + 1;
      const lines = endLine - startLine + 1;
      if (lines > role.maxFunctionLines) {
        warnings.push({
          rule: 'function-lines',
          path,
          line: startLine,
          message: `${functionName(node)} spans ${lines} lines; ${role.name} function limit is ${role.maxFunctionLines}`,
        });
      }

      const publicApi = isPublicApi(node, sourceFile);
      const maxArguments = publicApi
        ? policy.maxPublicArguments
        : policy.maxInternalArguments;
      if (node.parameters.length > maxArguments) {
        warnings.push({
          rule: 'max-arguments',
          path,
          line: startLine,
          message: `${functionName(node)} has ${node.parameters.length} arguments; ${publicApi ? 'public API' : 'internal'} limit is ${maxArguments}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return warnings;
}

export function analyzeSource(source, path, { policy = QUALITY_POLICY, roleForPath = getFileRole } = {}) {
  const warnings = [];
  const role = roleForPath(path);
  const lines = lineCount(source);

  if (lines > role.maxLines) {
    warnings.push({
      rule: 'file-lines',
      path,
      message: `${lines} lines; ${role.name} file limit is ${role.maxLines}`,
    });
  }
  if (lines > policy.absoluteMaxLines) {
    warnings.push({
      rule: 'absolute-file-lines',
      path,
      message: `${lines} lines; absolute source limit is ${policy.absoluteMaxLines}`,
    });
  }

  if (isSourcePath(path)) {
    const convention = extensionConvention(extname(path).toLowerCase());
    if (convention) {
      const extension = extname(path);
      const parts = basename(path).slice(0, -extension.length).split('.');
      if (parts.some((part) => !convention.pattern.test(part))) {
        warnings.push({
          rule: 'file-naming',
          path,
          message: `expected ${convention.name} names for ${extension} files`,
        });
      }
    }

    if (['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(extname(path).toLowerCase())) {
      warnings.push(...analyzeTypeScript(source, path, role, policy));
    }
  }

  return warnings;
}

function walk(root, path, files, directories, excludeFile) {
  const absolutePath = resolve(root, path);
  let entries;
  try {
    entries = readdirSync(absolutePath, { withFileTypes: true });
  } catch {
    return;
  }

  directories.push({
    path,
    directSourceCount: entries.filter((entry) => entry.isFile()
      && isSourcePath(entry.name)
      && !excludeFile(path ? `${path}/${entry.name}` : entry.name)).length,
  });
  for (const entry of entries) {
    const relativePath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) walk(root, relativePath, files, directories, excludeFile);
      continue;
    }
    if (entry.isFile() && (isSourcePath(entry.name) || isManifestPath(entry.name)) && !excludeFile(relativePath)) {
      files.push(relativePath);
    }
  }
}

export function scanProject(root = PROJECT_ROOT, {
  roots = DEFAULT_SCAN_ROOTS,
  policy = QUALITY_POLICY,
  roleForPath = getFileRole,
  excludeFile = () => false,
} = {}) {
  const files = [];
  const directories = [];
  for (const directory of roots) {
    if (statSync(resolve(root, directory), { throwIfNoEntry: false })?.isDirectory()) {
      walk(root, directory, files, directories, excludeFile);
    }
  }
  if (statSync(resolve(root, 'package.json'), { throwIfNoEntry: false })?.isFile() && !excludeFile('package.json')) files.push('package.json');

  const warnings = [];
  for (const path of files) {
    warnings.push(...analyzeSource(readFileSync(resolve(root, path), 'utf8'), path, { policy, roleForPath }));
  }
  for (const directory of directories) {
    if (directory.directSourceCount > policy.maxDirectSourceFiles) {
      warnings.push({
        rule: 'directory-files',
        path: directory.path,
        message: `${directory.directSourceCount} direct source files; directory limit is ${policy.maxDirectSourceFiles}`,
      });
    }
  }
  warnings.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule));
  return { filesScanned: files.length, warnings };
}

export function summarize(warnings) {
  const counts = {};
  for (const warning of warnings) counts[warning.rule] = (counts[warning.rule] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function formatReport(result) {
  const counts = summarize(result.warnings);
  const lines = [`KEEL quality audit: ${result.filesScanned} files scanned, ${result.warnings.length} warning(s)`];
  for (const [rule, count] of Object.entries(counts)) lines.push(`  ${rule}: ${count}`);
  if (result.warnings.length) {
    lines.push('');
    for (const warning of result.warnings) {
      const location = warning.line ? `:${warning.line}` : '';
      lines.push(`WARN ${warning.rule} ${warning.path}${location} — ${warning.message}`);
    }
  }
  lines.push('', 'All structure rules are warning-only.');
  return lines.join('\n');
}

function main() {
  const result = scanProject();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ...result, counts: summarize(result.warnings) }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(result)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
