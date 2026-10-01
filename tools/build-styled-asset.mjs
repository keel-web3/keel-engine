import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildStyledAsset(out) {
  await fs.mkdir(out, { recursive: true });
  const result = await build({ absWorkingDir: root, entryPoints: [path.join(root, 'packages/import/src/styled-asset-runtime.ts')], outfile: path.join(out, 'styled-asset-runtime.mjs'), bundle: true, platform: 'browser', format: 'esm', minify: true, metafile: true, charset: 'utf8', legalComments: 'eof', external: ['node:fs/promises'] });
  await build({ absWorkingDir: root, entryPoints: [path.join(root, 'packages/import/src/styled-asset-compiler.ts')], outfile: path.join(out, 'styled-asset-compiler.mjs'), bundle: true, platform: 'browser', format: 'esm', minify: true, charset: 'utf8', legalComments: 'eof', external: ['node:fs/promises'] });
  for (const [from, name] of [['LICENSE', 'LICENSE-KEEL.txt'], ['packages/import/node_modules/fflate/LICENSE', 'LICENSE-fflate.txt'], ['LICENSE-DRACO-APACHE-2.0.txt', 'LICENSE-Draco-Apache-2.0.txt'], ['packages/import/node_modules/meshoptimizer/LICENSE.md', 'LICENSE-meshoptimizer.txt']]) await fs.copyFile(path.join(root, from), path.join(out, name));
  // Compile-time color decoders are installed once with the compiler, not with
  // each asset or the replay-only runtime.
  for (const name of ['jpeg-js', 'fast-png']) await fs.copyFile(path.join(root, 'packages/import/node_modules', name, 'LICENSE'), path.join(out, 'LICENSE-compiler-' + name + '.txt'));
  const original = await fs.readFile(path.join(root, 'node_modules/draco3dgltf/draco_decoder_gltf_nodejs.js'), 'utf8');
  await fs.writeFile(path.join(out, 'draco-factory.mjs'), '// Official draco3dgltf 1.5.7, portable ESM adapter; WASM supplied explicitly.\nconst process=undefined;const __filename=undefined;\n' + original + '\nexport default DracoDecoderModule;\n');
  await fs.copyFile(path.join(root, 'node_modules/draco3dgltf/draco_decoder_gltf.wasm'), path.join(out, 'draco_decoder_gltf.wasm'));
  const bytes = await fs.readFile(path.join(out, 'styled-asset-runtime.mjs'));
  const report = { runtime: 'keel-styled-asset-5.0.0', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), threeBundled: Object.keys(result.metafile.inputs).some(p => p.includes('node_modules/three/')), inputs: Object.keys(result.metafile.inputs) };
  await fs.writeFile(path.join(out, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(await buildStyledAsset(path.resolve(process.argv[2] ?? 'styled-asset-dist')));
