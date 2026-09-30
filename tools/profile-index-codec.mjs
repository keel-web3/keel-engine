#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { build } from 'esbuild';
import draco from 'draco3dgltf';
import { MeshoptEncoder } from '../packages/import/node_modules/meshoptimizer/meshopt_encoder.module.js';
import { MeshoptDecoder } from '../packages/import/node_modules/meshoptimizer/meshopt_decoder.module.js';
import { normalizeAsset } from '../packages/import/src/asset-normalize-v3.ts';
import { encodeSurface, encodeExactBuffer } from '../packages/import/src/optimization/exact-encoding.ts';
import { packAsset } from '../packages/import/src/asset-binary-v3.ts';
import { encodeExactIndexSequence } from '../packages/import/src/optimization/index-codec.ts';
const [file] = process.argv.slice(2);
if (!file) throw Error('Usage: node tools/profile-index-codec.mjs model.glb');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const source = new Uint8Array(await fs.readFile(file)), dracoDecoder = await draco.createDecoderModule();
const normalized = await normalizeAsset({ files: [{ name: path.basename(file), data: source }], entry: path.basename(file), dracoDecoder });
const bytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const equal = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const variants = { current: [], sequence: [], sequenceDeflate: [], trianglesRotations: [], trianglesRotationsDeflate: [] }, metrics = [];
let indexBytes = 0, totalIndices = 0, totalRotated = 0, encodeMs = 0, decodeMs = 0;
for (let mesh = 0; mesh < (normalized.json.meshes ?? []).length; mesh++) for (let primitive = 0; primitive < normalized.json.meshes[mesh].primitives.length; primitive++) {
  const p = normalized.json.meshes[mesh].primitives[primitive]; if (p.indices === undefined) continue;
  const original = normalized.accessors[p.indices].array, array = original instanceof Uint8Array ? new Uint16Array(original) : original, size = array.BYTES_PER_ELEMENT, data = bytes(array), count = array.length;
  indexBytes += original.byteLength; totalIndices += count;
  const existing = encodeSurface({ positions: normalized.accessors[p.attributes.POSITION].array, indices: original, mode: p.mode ?? 4 }).recipe.topology;
  const at = performance.now(), sequence = MeshoptEncoder.encodeIndexSequence(data, count, size), triangles = MeshoptEncoder.encodeIndexBuffer(data, count, size); encodeMs += performance.now() - at;
  const restoredSequence = new Uint8Array(data.length), restoredTriangles = new Uint8Array(data.length), start = performance.now();
  MeshoptDecoder.decodeIndexSequence(restoredSequence, count, size, sequence); MeshoptDecoder.decodeIndexBuffer(restoredTriangles, count, size, triangles); decodeMs += performance.now() - start;
  if (!equal(data, restoredSequence)) throw Error('Sequence is not exact');
  const words = size === 2 ? new Uint16Array(restoredTriangles.buffer) : new Uint32Array(restoredTriangles.buffer), rotations = new Uint8Array(Math.ceil(count / 3 / 4));
  let rotated = 0;
  for (let i = 0; i < count; i += 3) {
    let rotation = -1;
    for (let r = 0; r < 3; r++) if ([0, 1, 2].every(k => words[i + ((k + r) % 3)] === array[i + k])) { rotation = r; break; }
    if (rotation < 0) throw Error('Triangle encoder changed more than a cyclic corner rotation');
    if (rotation) rotated++;
    rotations[Math.floor(i / 12)] |= rotation << ((i / 3 % 4) * 2);
    const a = words[i], b = words[i + 1], c = words[i + 2];
    words[i] = rotation === 0 ? a : rotation === 1 ? b : c;
    words[i + 1] = rotation === 0 ? b : rotation === 1 ? c : a;
    words[i + 2] = rotation === 0 ? c : rotation === 1 ? a : b;
  }
  if (!equal(data, restoredTriangles)) throw Error('Rotation-corrected triangles are not exact');
  totalRotated += rotated;
  const descriptor = { version: 1, count, componentType: normalized.accessors[p.indices].componentType };
  const sequenceWire = encodeExactBuffer(sequence).recipe, trianglesWire = encodeExactBuffer(triangles).recipe, rotationsWire = encodeExactBuffer(rotations).recipe;
  variants.current.push(existing);
  variants.sequence.push((await encodeExactIndexSequence(original)).recipe);
  variants.sequenceDeflate.push((await encodeExactIndexSequence(original, { compress: true })).recipe);
  variants.trianglesRotations.push({ ...descriptor, kind: 'meshopt-triangles-rotations', data: triangles, rotations });
  variants.trianglesRotationsDeflate.push({ ...descriptor, kind: 'meshopt-triangles-rotations', data: trianglesWire, rotations: rotationsWire });
  metrics.push({ mesh, primitive, accessor: p.indices, indexBytes: original.byteLength, currentPackedBytes: packAsset(existing).length, sequenceBytes: sequence.length, sequenceDeflateBytes: sequenceWire.data.length, triangleBytes: triangles.length, triangleDeflateBytes: trianglesWire.data.length, rotationBytes: rotations.length, rotationDeflateBytes: rotationsWire.data.length, rotatedTriangles: rotated });
}
const bundle = await build({ stdin: { contents: "export { MeshoptDecoder } from './packages/import/node_modules/meshoptimizer/meshopt_decoder.module.js';", resolveDir: process.cwd() }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false });
const decoder = bundle.outputFiles[0].contents, license = await fs.readFile('packages/import/node_modules/meshoptimizer/LICENSE.md');
const full = await build({ stdin: { contents: "export {decodeExactIndexSequence} from './packages/import/src/optimization/index-codec.ts';", resolveDir: process.cwd() }, bundle: true, minify: true, format: 'esm', platform: 'browser', write: false });
const fullDecoder = full.outputFiles[0].contents;
const costs = Object.fromEntries(Object.entries(variants).map(([name, value]) => { const packed = packAsset(value); return [name, { packedBytes: packed.length, brotliBytes: brotliCompressSync(packed).length }]; }));
console.log(JSON.stringify({ file, primitiveCount: metrics.length, indexBytes, totalIndices, totalRotated, encodeMs, decodeMs, exactSequence: true, exactRotationCorrectedTriangles: true, costs, decoder: { meshoptBrowserBundleBytes: decoder.length, meshoptBrotliBytes: brotliCompressSync(decoder).length, fullIndexDecoderBundleBytes: fullDecoder.length, fullIndexDecoderBrotliBytes: brotliCompressSync(fullDecoder).length, fullIndexDecoderScope: 'wrapper, complete meshoptimizer decoder with embedded WASM, and all buffer codec/inflate dependencies; no encoder', licenseBytes: license.length, licenseBrotliBytes: brotliCompressSync(license).length, embeddedWasmIncluded: true }, metrics }));
