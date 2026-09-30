#!/usr/bin/env node
/** Isolated geometry/attribute profile. No image or package claims. */
import fs from 'node:fs/promises';
import path from 'node:path';
import draco from 'draco3dgltf';
import { normalizeAsset } from '../packages/import/src/asset-normalize-v3.ts';
import { compileSurface, replaySurface } from '../packages/import/src/asset-native-surface-v3.ts';
import { encodeAttribute } from '../packages/import/src/asset-normal-codec-v3.ts';
import { decodeBuffer } from '../packages/import/src/asset-buffer-codec.ts';
import { encodeSurface, encodeResidualAttribute, exactRecipeBytes } from '../packages/import/src/optimization/exact-encoding.ts';
const args = process.argv.slice(2), legacy = args.includes('--legacy'), files = args.filter(x => x !== '--legacy');
if (!files.length) throw Error('Usage: node tools/profile-exact-encoding.mjs model.glb [more.glb] [--legacy]');
const dracoDecoder = await draco.createDecoderModule();
const bytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const equal = (a, b) => Buffer.from(bytes(a)).equals(Buffer.from(bytes(b)));
for (const file of files) {
  const source = new Uint8Array(await fs.readFile(file)), start = performance.now(), normalized = await normalizeAsset({ files: [{ name: path.basename(file), data: source }], entry: path.basename(file), dracoDecoder }), normalizedMs = performance.now() - start;
  const owners = new Set(), surfaces = [], attributes = [];
  let surfacesMs = 0, attributesMs = 0, replayMs = 0, legacySurfacesMs = 0, legacyAttributesMs = 0, oldBytes = 0;
  for (let mi = 0; mi < (normalized.json.meshes ?? []).length; mi++) for (let pi = 0; pi < normalized.json.meshes[mi].primitives.length; pi++) {
    const p = normalized.json.meshes[mi].primitives[pi], input = { positions: normalized.accessors[p.attributes.POSITION].array, indices: p.indices === undefined ? null : normalized.accessors[p.indices].array, mode: p.mode ?? 4 };
    owners.add(p.attributes.POSITION); if (p.indices !== undefined) owners.add(p.indices);
    let at = performance.now(); const result = encodeSurface(input); surfacesMs += performance.now() - at;
    at = performance.now(); const replay = replaySurface(result.recipe); replayMs += performance.now() - at;
    if (!equal(replay.positions, input.positions) || (input.indices && !equal(replay.indices, input.indices))) throw Error('Surface replay differs');
    surfaces.push({ mesh: mi, primitive: pi, ...result.metrics });
    if (legacy) { at = performance.now(); const previous = compileSurface(input); legacySurfacesMs += performance.now() - at; const binary = JSON.parse(JSON.stringify(previous.recipe)); const visit = x => { if (!x || typeof x !== 'object') return; if (x.codec && typeof x.data === 'string') x.data = new Uint8Array(Buffer.from(x.data, 'base64')); else for (const v of Object.values(x)) visit(v); }; visit(binary); oldBytes += exactRecipeBytes(binary); }
  }
  for (let id = 0; id < normalized.accessors.length; id++) if (!owners.has(id)) {
    const input = normalized.accessors[id]; let at = performance.now(); const result = encodeResidualAttribute(input); attributesMs += performance.now() - at;
    at = performance.now(); if (!equal(decodeBuffer(result.recipe), input.array)) throw Error('Attribute replay differs'); replayMs += performance.now() - at;
    attributes.push({ accessor: id, ...result.metrics });
    if (legacy) { at = performance.now(); const previous = encodeAttribute(input); legacyAttributesMs += performance.now() - at; oldBytes += exactRecipeBytes(previous.recipe); }
  }
  console.log(JSON.stringify({ file, sourceBytes: source.length, normalizedMs, surfacesMs, attributesMs, replayMs, encodingMs: surfacesMs + attributesMs, recipeBytes: [...surfaces, ...attributes].reduce((sum, item) => sum + item.recipeBytes, 0), fixedResidualRecipeBytes: [...surfaces, ...attributes].reduce((sum, item) => sum + item.residualRecipeBytes, 0), legacy: legacy ? { surfacesMs: legacySurfacesMs, attributesMs: legacyAttributesMs, encodingMs: legacySurfacesMs + legacyAttributesMs, recipeBytes: oldBytes } : null, exact: true, surfaces, attributes }));
}
