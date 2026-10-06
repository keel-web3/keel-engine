import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildEngineFeatures } from '../packages/keel/src/features.ts';

const [profileFile, outputDir] = process.argv.slice(2);
if (!profileFile || !outputDir) throw Error('Usage: node tools/build-features.mjs <profile.json> <output-dir>');
const profile = JSON.parse(await readFile(resolve(profileFile), 'utf8'));
const built = await buildEngineFeatures(profile);
const out = resolve(outputDir);
await mkdir(out, { recursive: true });
await writeFile(resolve(out, profile.name + '.js'), built.bytes);
await writeFile(resolve(out, profile.name + '.js.gz'), built.gzip);
await writeFile(resolve(out, profile.name + '.js.br'), built.brotli);
await writeFile(resolve(out, profile.name + '.json'), JSON.stringify(built.report, null, 2) + '\n');
console.log(JSON.stringify({ profile: profile.name, rawBytes: built.report.rawBytes, gzipBytes: built.report.gzipBytes, brotliBytes: built.report.brotliBytes, sha256: built.report.sha256 }));
