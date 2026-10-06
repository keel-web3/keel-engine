import { compactShaderLiterals } from "./compact-shaders.ts";
// Node authoring tool: compile an explicit feature selection from the real
// engine sources. Runtime games receive only the resulting browser script.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

export interface EngineFeature {
  readonly module: string;
  readonly exports: readonly string[];
}
export interface EngineFeatureProfile {
  readonly name: string;
  readonly features: readonly EngineFeature[];
  readonly maxGzipBytes?: number;
  readonly maxBrotliBytes?: number;
  /** Source paths that must not survive tree shaking (relative to engine root). */
  readonly forbidInputs?: readonly string[];
}
export interface EngineFeatureOptions extends EngineFeatureProfile {
  readonly engineRoot?: string;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const GROUPS = ['packages', 'packs', 'ai', 'systems'];
export async function buildEngineFeatures(options: EngineFeatureOptions) {
  const engineRoot = resolve(options.engineRoot ?? resolve(import.meta.dirname, '../../..'));
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(options.name) || !options.features.length) throw Error('Invalid or empty engine feature profile');
  for (const budget of [options.maxGzipBytes, options.maxBrotliBytes]) {
    if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 1)) throw Error('Invalid engine byte budget');
  }
  const selected = new Map<string, { module: string; name: string }>();
  for (const feature of options.features) {
    if (!/^@keel-engine\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(feature.module) || !feature.exports.length) throw Error('Invalid engine feature import');
    const prefix = feature.module.slice('@keel-engine/'.length).replaceAll('/', '_').replaceAll('-', '_');
    for (const name of feature.exports) {
      if (!IDENTIFIER.test(name) || name === 'default') throw Error('Feature exports must be explicit named exports');
      const key = `${prefix}__${name}`, prior = selected.get(key);
      if (prior && (prior.module !== feature.module || prior.name !== name)) throw Error('Engine feature alias collision');
      selected.set(key, { module: feature.module, name });
    }
  }
  const bindings = [...selected].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const packages = new Map<string, { dir: string; exports: Record<string, string> }>();
  const resolver = {
    name: 'keel-feature-exports',
    setup(b: import('esbuild').PluginBuild) {
      b.onResolve({ filter: /^@keel-engine\// }, async args => {
        const [part, ...tail] = args.path.slice('@keel-engine/'.length).split('/');
        let pkg = packages.get(part!);
        if (!pkg) {
          for (const group of GROUPS) {
            const dir = resolve(engineRoot, group, part!);
            try {
              const data = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'));
              if (data.name === '@keel-engine/' + part) { pkg = { dir, exports: data.exports }; break; }
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
          if (!pkg) throw Error(`Unknown engine package: ${part}`);
          packages.set(part!, pkg);
        }
        const key = tail.length ? './' + tail.join('/') : '.';
        let target = pkg.exports[key];
        if (!target) for (const [pattern, value] of Object.entries(pkg.exports)) {
          if (!pattern.endsWith('*') || !key.startsWith(pattern.slice(0, -1))) continue;
          target = value.replace('*', key.slice(pattern.length - 1)); break;
        }
        if (!target || typeof target !== 'string') throw Error(`Engine feature is not exported: ${args.path}`);
        const path = resolve(pkg.dir, target);
        if (!path.startsWith(pkg.dir + sep)) throw Error('Engine feature escaped its package');
        return { path };
      });
    },
  };
  // TypeScript can erase a missing re-export as if it were a type. Check the
  // actual runtime export surface instead of accepting a silently empty build.
  for (const module of new Set(bindings.map(([, b]) => b.module))) {
    const probe = await build({ stdin: { contents: `export * from ${JSON.stringify(module)};`, resolveDir: engineRoot, loader: 'ts' },
      bundle: true, write: false, metafile: true, absWorkingDir: engineRoot, format: 'esm', platform: 'browser', target: 'es2022', plugins: [resolver], logLevel: 'silent' });
    const names = Object.values(probe.metafile.outputs)[0]!.exports;
    for (const [, binding] of bindings) if (binding.module === module && !names.includes(binding.name)) throw Error(`No matching runtime export ${binding.name} in ${module}`);
  }
  const result = await build({ stdin: { contents: bindings.map(([key, b]) => `export { ${b.name} as ${key} } from ${JSON.stringify(b.module)};`).join('\n'),
    resolveDir: engineRoot, loader: 'ts' }, bundle: true, write: false, metafile: true, minify: true, legalComments: 'none',
    absWorkingDir: engineRoot, format: 'iife', globalName: 'KEEL_FEATURES', platform: 'browser', target: 'es2022',
    plugins: [resolver], logLevel: 'silent' });
  const shaderBuild = compactShaderLiterals(Buffer.from(result.outputFiles[0]!.contents).toString("utf8"));
  const bytes = new Uint8Array(Buffer.from(shaderBuild.code));
  const gzip = new Uint8Array(gzipSync(bytes, { level: 9 }));
  const brotli = new Uint8Array(brotliCompressSync(bytes, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 22,
  } }));
  if (!gunzipSync(gzip).equals(Buffer.from(bytes)) || !brotliDecompressSync(brotli).equals(Buffer.from(bytes))) throw Error('Engine compression mismatch');
  const inputs = Object.values(result.metafile.outputs).flatMap(out => Object.entries(out.inputs))
    .filter(([file, value]) => file !== '<stdin>' && value.bytesInOutput > 0)
    .map(([file, value]) => ({ file: relative(engineRoot, resolve(engineRoot, file)).replaceAll(sep, '/'), bytes: value.bytesInOutput }))
    .sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  for (const forbidden of options.forbidInputs ?? []) {
    const found = inputs.find(input => input.file.includes(forbidden));
    if (found) throw Error(`Forbidden engine dependency: ${found.file}`);
  }
  if (options.maxGzipBytes !== undefined && gzip.length > options.maxGzipBytes) throw Error(`Engine profile ${options.name} exceeds gzip budget: ${gzip.length} > ${options.maxGzipBytes}`);
  if (options.maxBrotliBytes !== undefined && brotli.length > options.maxBrotliBytes) throw Error(`Engine profile ${options.name} exceeds Brotli budget: ${brotli.length} > ${options.maxBrotliBytes}`);
  return { bytes, gzip, brotli, report: { profile: options.name, target: 'browser-es2022', rawBytes: bytes.length, gzipBytes: gzip.length, brotliBytes: brotli.length,
    shaderCompaction: { shaders: shaderBuild.shaders, savedBytes: shaderBuild.savedBytes },
    sha256: createHash('sha256').update(bytes).digest('hex'), maxGzipBytes: options.maxGzipBytes ?? null, maxBrotliBytes: options.maxBrotliBytes ?? null,
    exports: bindings.map(([key, binding]) => ({ key, ...binding })), inputs,
    note: 'Source-built browser feature artifact; native GB/GBC projects use compiled C and tile assets. No chain receipt or deployment implied.' } };
}
