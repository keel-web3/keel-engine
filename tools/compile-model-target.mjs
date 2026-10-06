// Host-only browser model target for compile-asset.mjs; ordinary GLB conversion stays unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { build } from 'esbuild';
import { generate, GENERATOR_KINDS } from '../packages/builder/src/generate.ts';
import { loadModel } from '../packages/builder/src/construction.ts';
import { storeVoxels } from '../packages/builder/src/voxel-store.ts';
import { planModelRepresentations } from '../packages/keel/src/model-plan.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node tools/compile-asset.mjs model.kc2 output [other model packets...] --model-target browser [--compression none|gzip|brotli] [--max-evaluations 32]\nGenerator: node tools/compile-asset.mjs tree output --model-target browser --generator tree --seed 42 [--plan humanoid|quadruped]';
export function parseModelCompilerArgs(args) {
  const positional = [], options = { compression: 'none', maxEvaluations: 32, seed: '0' };
  const keys = { '--model-target': 'target', '--compression': 'compression', '--generator': 'generator',
    '--seed': 'seed', '--plan': 'plan', '--max-evaluations': 'maxEvaluations' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = keys[arg];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(usage + '\nInvalid option: ' + arg);
    options[key] = key === 'maxEvaluations' ? Number(args[++i]) : args[++i];
  }
  if (!positional.length || options.target !== 'browser' || !['none', 'gzip', 'brotli'].includes(options.compression)) throw Error(usage);
  if (options.generator && (!GENERATOR_KINDS.includes(options.generator) || positional.length > 2)) throw Error(usage);
  if (options.plan && !['humanoid', 'quadruped'].includes(options.plan)) throw Error(usage);
  if (!options.generator && (args.includes('--seed') || options.plan)) throw Error('--seed/--plan require --generator');
  return { ...options, source: positional[0], out: positional[1] ?? 'compiled-model', dependencies: positional.slice(2) };
}
const uri = bytes => 'data:text/javascript;base64,' + Buffer.from(bytes).toString('base64');
const packed = (bytes, compression) => compression === 'none' ? bytes : compression === 'gzip'
  ? gzipSync(bytes, { level: 9 }) : brotliCompressSync(bytes, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 22,
  } });

export async function compileModelTarget(options) {
  const started = performance.now();
  const models = options.generator
    ? [{ id: path.parse(options.source).name, model: generate(options.generator, options.seed,
      options.plan ? { plan: options.plan } : {}).model }]
    : await Promise.all([options.source, ...options.dependencies].map(async source => {
      const data = new Uint8Array(await fs.readFile(source)), text = new TextDecoder().decode(data).trim();
      return { id: path.parse(source).name, model: loadModel(/^(?:KC[12]|KV1):/.test(text) ? text : data) };
    }));
  const originals = new Map(models.map(({ id, model }) => [id, storeVoxels(model)]));
  const license = new Uint8Array(await fs.readFile(path.join(root, 'LICENSE')));
  const runtimes = new Map(); // At most three target decoder graphs for this invocation.
  const runtimeFor = async selection => {
    const kind = selection.dependencies.includes('model:generator') ? 'generator'
      : selection.dependencies.includes('model:construction') ? 'construction' : 'voxels';
    if (!runtimes.has(kind)) {
      const entry = kind === 'generator' ? ['loadModel', 'construction.ts']
        : kind === 'construction' ? ['loadPrimitiveModel', 'construction-runtime.ts'] : ['loadVoxels', 'voxel-store.ts'];
      runtimes.set(kind, build({ stdin: { contents: `export {${entry[0]} as load} from ${JSON.stringify(path.join(root, 'packages/builder/src', entry[1]))};`,
        resolveDir: root, loader: 'js' }, absWorkingDir: root, bundle: true, write: false, minify: true,
        platform: 'browser', target: 'es2022', format: 'esm', legalComments: 'eof', metafile: true, logLevel: 'error',
      }).then(result => {
        if (Object.values(result.metafile.outputs).some(output => output.imports.length)) throw Error('Model target: unresolved runtime dependency');
        // These selected decoders use only KEEL source. A future third-party runtime must declare its license costs.
        if (Object.keys(result.metafile.inputs).some(input => !path.resolve(root, input).startsWith(root + path.sep) || input.includes('node_modules/'))) {
          throw Error('Model target: external runtime requires explicit dependency/license pricing');
        }
        return result.outputFiles[0].contents;
      }));
    }
    return runtimes.get(kind);
  };
  const targetBuild = async selection => {
    const records = selection.assets.map(asset => [asset.id, Buffer.from(asset.candidate.value.bytes).toString('base64')]);
    const creator = Buffer.from(`import {load} from "./model-runtime.mjs";\nexport const target={format:"keel-browser-models@1",platform:"browser-es2022"};\nexport const packets=${JSON.stringify(records)};\nexport const build=()=>packets.map(([id,packet])=>[id,load(Uint8Array.from(atob(packet),c=>c.charCodeAt(0)))]);\n`);
    return [
      { id: 'model-runtime.mjs', bytes: await runtimeFor(selection), scope: 'shared', compression: options.compression, provides: selection.dependencies },
      { id: 'model.generated.mjs', bytes: creator, scope: 'creator', compression: options.compression, provides: selection.assets.map(asset => asset.id) },
      { id: 'KEEL-LICENSE.txt', bytes: license, scope: 'shared', compression: options.compression },
    ];
  };
  const targetValidate = async selection => {
    const resources = await targetBuild(selection);
    const creator = Buffer.from(resources[1].bytes).toString('utf8').replace('"./model-runtime.mjs"', JSON.stringify(uri(resources[0].bytes)));
    const result = await import(uri(Buffer.from(creator)));
    return result.build().every(([id, model]) => Buffer.from(storeVoxels(model)).equals(originals.get(id)));
  };
  const plan = await planModelRepresentations({ models, build: targetBuild, validate: targetValidate,
    objective: 'full', maxEvaluations: options.maxEvaluations });
  const resources = await targetBuild(plan.selection);
  await fs.mkdir(options.out, { recursive: true });
  const transportFiles = [];
  for (const resource of resources) {
    await fs.writeFile(path.join(options.out, resource.id), resource.bytes);
    const suffix = options.compression === 'none' ? '' : options.compression === 'gzip' ? '.gz' : '.br';
    const transport = packed(resource.bytes, options.compression);
    if (transport.length !== plan.cost.resources.find(row => row.id === resource.id).storedBytes) throw Error('Model target: emitted cost differs');
    if (suffix) await fs.writeFile(path.join(options.out, resource.id + suffix), transport);
    transportFiles.push(resource.id + suffix);
  }
  const manifest = { format: 'keel-browser-model-graph@1', target: 'browser-es2022', objective: 'full',
    transport: options.compression === 'none' ? 'source bytes' : `HTTP Content-Encoding ${options.compression === 'gzip' ? 'gzip' : 'br'}; browser native decoding`,
    models: plan.selection.assets.map(asset => ({ id: asset.id, representation: asset.candidate.id, packetBytes: asset.candidate.value.bytes.length })),
    resources: resources.map(resource => resource.id), transportFiles, excludedDiagnostics: ['manifest.json'],
    baselineCost: plan.baselineCost, cost: plan.cost, savedBytes: plan.baselineCost.fullBytes - plan.cost.fullBytes,
    validation: { exactHostReplay: true, emittedModuleReplay: true, metadataAndGroupsExact: true },
    conversionMs: performance.now() - started };
  await fs.writeFile(path.join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
