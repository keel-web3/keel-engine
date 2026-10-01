/** Declarative styled-asset transport. Only this trusted runtime executes code;
 * uploaded assets contain data, never import paths or executable programs. */
import { SCREENS } from '@keel-engine/core';
import type { ScreenId } from '@keel-engine/core';
import { COMPILER_VERSION } from './asset-replay-v6.ts';
import { replayStyledTexturePackage as buildFromPackage, STYLIZED_TEXTURE_FORMAT } from './styled-texture-replay.ts';
import { packAsset, unpackAsset } from './asset-binary-v3.ts';
import { addBox, meshData, writeGlb } from './write.ts';
import { readGlb } from './gltf.ts';
import { makeAssetZip } from './asset-package-v3.ts';
import type { ArchiveFile } from './asset-package-v3.ts';

export const STYLED_ASSET_FORMAT = 'KEEL-STYLED-ASSET';
export const STYLED_ASSET_VERSION = 2;
export const STYLED_ASSET_RUNTIME_VERSION = 'keel-styled-asset-2.0.0';
const LEGACY_DEPENDENCIES = Object.freeze({
  runtime: 'keel-styled-asset-1.0.0',
  nativeCompiler: COMPILER_VERSION,
  '@keel-engine/import': '0.1.0', '@keel-engine/core': '0.1.0',
  fflate: '0.8.2', meshoptimizer: '0.25.0', draco3dgltf: '1.5.7',
  renderer: 'three@0.180.0', loader: 'three@0.180.0/GLTFLoader',
  screen: 'keel-core-float32-tile192-top-left-v1',
});
export const STYLED_ASSET_DEPENDENCIES = Object.freeze({ ...LEGACY_DEPENDENCIES, runtime: STYLED_ASSET_RUNTIME_VERSION, textureCodec: 'keel-stylized-textures-v1' });
export interface StyledAssetStyle {
  kind: 'original' | 'pixel' | 'dither' | 'voxel';
  pixelSize: number;
  toneLevels: number;
  screen: ScreenId;
}
export interface StyledAssetBounds {
  min: [number, number, number]; max: [number, number, number];
  space?: 'source-world'; pose?: 'static-hint';
}
export interface StyledAssetInput {
  packageBytes: Uint8Array;
  style: StyledAssetStyle;
  sourceBounds?: StyledAssetBounds | null;
  name?: string;
  voxel?: unknown;
}
const MAX_KAP = 128 * 1024 * 1024, MAX_ENVELOPE = 192 * 1024 * 1024, MAX_CUBES = 50_000;
const utf8 = new TextDecoder('utf-8', { fatal: true });
function fail(message: string): never { throw new TypeError('KEEL styled asset: ' + message); }
function record(value: any, label: string): any {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + ' must be a data object');
  return value;
}
function keys(value: any, allowed: readonly string[], label: string): void {
  record(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(label + ': unknown field ' + key);
}
function finite(value: any, lo: number, hi: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) fail('invalid ' + label);
  return value;
}
function integer(value: any, lo: number, hi: number, label: string): number {
  finite(value, lo, hi, label); if (!Number.isSafeInteger(value)) fail('invalid ' + label); return value;
}
function vector(value: any, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail('invalid ' + label);
  return value.map(v => finite(v, -1e20, 1e20, label)) as [number, number, number];
}
export function validateStyledAssetStyle(value: unknown): StyledAssetStyle {
  const v = value as any; keys(v, ['kind', 'pixelSize', 'toneLevels', 'screen'], 'style');
  if (!['original', 'pixel', 'dither', 'voxel'].includes(v.kind)) fail('unsupported style kind');
  integer(v.pixelSize, 1, 64, 'pixel size'); integer(v.toneLevels, 2, 256, 'tone levels');
  if (typeof v.screen !== 'string' || !Object.hasOwn(SCREENS, v.screen)) fail('unknown KEEL screen');
  return { kind: v.kind, pixelSize: v.pixelSize, toneLevels: v.toneLevels, screen: v.screen };
}
function bounds(value: any): StyledAssetBounds | null {
  if (value == null) return null;
  keys(value, ['min', 'max', 'space', 'pose'], 'source bounds');
  if (value.space !== undefined && value.space !== 'source-world') fail('unsupported bounds space');
  if (value.pose !== undefined && value.pose !== 'static-hint') fail('unsupported bounds semantics');
  const min = vector(value.min, 'minimum bounds'), max = vector(value.max, 'maximum bounds');
  if (min.some((v, i) => v > max[i]!)) fail('inverted bounds');
  return { min, max, space: 'source-world', pose: 'static-hint' };
}
function base64(bytes: Uint8Array): string {
  let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
function unbase64(value: any): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_KAP / 3) * 4 || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) fail('invalid native KAP encoding');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0, first = value.indexOf('=');
  if (first !== -1 && first !== value.length - padding) fail('invalid native KAP padding');
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_KAP) fail('native KAP exceeds limit'); return bytes;
}
function parseEnvelope(bytes: Uint8Array): any {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_ENVELOPE) fail('invalid envelope extent');
  return bytes.length >= 4 && bytes[0] === 0x4b && bytes[1] === 0x41 && bytes[2] === 0x50 && bytes[3] === 0x33 ? unpackAsset(bytes) : JSON.parse(utf8.decode(bytes));
}
function nativeBytesOf(native: any): Uint8Array {
  if (native?.encoding === 'base64-kap') return unbase64(native.data);
  if (native?.encoding !== 'kap' || !(native.data instanceof Uint8Array) || !native.data.length || native.data.length > MAX_KAP) fail('unsupported native encoding');
  return native.data;
}
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(v => v.toString(16).padStart(2, '0')).join('');
}
function needsDraco(bytes: Uint8Array): boolean {
  let recipe = unpackAsset(bytes);
  if (recipe?.format === STYLIZED_TEXTURE_FORMAT) recipe = recipe.base;
  for (let depth = 0; depth < 4; depth++) {
    if (recipe?.format === 'KEEL-MIXED-PRIMITIVES-V1') return true;
    if (recipe?.format === 'KEEL-NATIVE-V5' || recipe?.format === 'KEEL-NATIVE-V6') recipe = recipe.base;
    else return false;
  }
  fail('unsupported native wrapper depth');
}
function conversionOf(bytes: Uint8Array, style: StyledAssetStyle) {
  const recipe = unpackAsset(bytes), transformed = recipe?.format === STYLIZED_TEXTURE_FORMAT;
  if (transformed && !['pixel', 'dither'].includes(style.kind)) fail('stylized textures require pixel/dither style');
  return { mode: style.kind === 'original' ? 'native-input' : style.kind === 'voxel' ? 'static-pose' : 'stylized-lossy', textureEncoding: transformed ? 'palette-pattern-v1' : 'native-input', changedImages: transformed && Array.isArray(recipe.images) ? recipe.images.length : 0, supersededColorPayloadRemoved: transformed };
}
/** Reject executable values/prototype keys and bound metadata traversal before use. */
function dataOnly(value: any, depth = 0, budget = { n: 0 }): void {
  if (++budget.n > 2_000_000 || depth > 48) fail('metadata exceeds limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (value instanceof Uint8Array) { if (value.length > MAX_KAP) fail('binary metadata exceeds limit'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('nonfinite metadata'); return; }
  if (typeof value !== 'object') fail('only declarative data is accepted');
  if (!Array.isArray(value)) record(value, 'metadata');
  for (const key of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('unsafe metadata key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) fail('metadata accessors are not allowed');
    dataOnly(descriptor.value, depth + 1, budget);
  }
}
export function validateVoxelRecipe(input: unknown): any {
  const v = typeof input === 'string' ? JSON.parse(input) : input;
  dataOnly(v); record(v, 'voxel recipe');
  if (v.version !== 1 || v.kind !== 'keel-static-voxel-style' || v.coordinateSpace !== 'source-world' || v.colorSpace !== 'linear-srgb' || v.pose !== 'static') fail('unsupported voxel recipe');
  const size = vector(v.size, 'voxel size'), origin = vector(v.origin, 'voxel origin');
  size.forEach(n => integer(n, 1, 1_000_000, 'grid dimension'));
  const cells = size[0] * size[1] * size[2]; integer(cells, 1, 1_000_000, 'grid volume');
  const unit = finite(v.unit, Number.MIN_VALUE, 1e15, 'voxel unit');
  if (!Array.isArray(v.indices) || !v.indices.length || v.indices.length > MAX_CUBES) fail('voxel count must be 1..50,000');
  if (!Array.isArray(v.colors) || v.colors.length !== v.indices.length * 3) fail('voxel colors length differs');
  const seen = new Set<number>();
  for (const index of v.indices) { integer(index, 0, cells - 1, 'voxel index'); if (seen.has(index)) fail('duplicate voxel index'); seen.add(index); }
  v.colors.forEach((c: unknown) => finite(c, 0, 1, 'linear voxel color'));
  for (const label of ['occupancy', 'material', 'node']) if (v[label] !== undefined && (!Array.isArray(v[label]) || v[label].length !== v.indices.length)) fail('voxel ' + label + ' length differs');
  if (v.occupancy) v.occupancy.forEach((n: unknown) => integer(n, 1, 2, 'voxel occupancy'));
  return { ...v, size, origin, unit };
}
/** Rebuild explicit occupied cubes with KEEL's native mesh writer, not a saved GLB. */
export function rebuildStyledVoxels(input: unknown) {
  const v = validateVoxelRecipe(input), mesh = meshData(), h = v.unit / 2;
  for (let i = 0; i < v.indices.length; i++) {
    const index = v.indices[i], x = index % v.size[0], y = Math.floor(index / v.size[0]) % v.size[1], z = Math.floor(index / (v.size[0] * v.size[1]));
    addBox(mesh, [v.origin[0] + (x + .5) * v.unit, v.origin[1] + (y + .5) * v.unit, v.origin[2] + (z + .5) * v.unit], [h, h, h], { colour: [v.colors[i * 3], v.colors[i * 3 + 1], v.colors[i * 3 + 2], 1] });
  }
  const glb = writeGlb({ nodes: [{ name: 'Static voxel pose', mesh: 0 }], meshes: [{ name: 'voxel cubes', primitives: [{ mesh, material: 0, colours: true }] }], materials: [{ name: 'sampled linear vertex colors', colour: [1, 1, 1, 1], metallic: 0 }] });
  return { glb, mesh, recipe: v };
}

export async function createStyledAsset(input: StyledAssetInput): Promise<Uint8Array> {
  if (!(input.packageBytes instanceof Uint8Array) || !input.packageBytes.length || input.packageBytes.length > MAX_KAP) fail('native KAP bytes required');
  const style = validateStyledAssetStyle(input.style), sourceBounds = bounds(input.sourceBounds);
  const name = input.name ?? 'Styled asset'; if (typeof name !== 'string' || name.length > 240) fail('invalid name');
  const voxel = style.kind === 'voxel' ? validateVoxelRecipe(input.voxel) : null;
  if (style.kind !== 'voxel' && input.voxel !== undefined) fail('voxel recipe requires voxel style');
  const envelope = { format: STYLED_ASSET_FORMAT, version: STYLED_ASSET_VERSION, name, dependencies: STYLED_ASSET_DEPENDENCIES, native: { encoding: 'kap', byteLength: input.packageBytes.length, sha256: await hash(input.packageBytes), dracoRequired: needsDraco(input.packageBytes), data: input.packageBytes }, style, conversion: conversionOf(input.packageBytes, style), sourceBounds, animation: { mode: style.kind === 'voxel' ? 'static-pose' : 'preserved' }, voxel };
  const bytes = packAsset(envelope); if (bytes.length > MAX_ENVELOPE) fail('envelope exceeds limit');
  return bytes;
}
export function isStyledAsset(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_ENVELOPE) return false;
  const binary = bytes[0] === 0x4b && bytes[1] === 0x41 && bytes[2] === 0x50 && bytes[3] === 0x33;
  if (!binary && !/^\s*\{/.test(new TextDecoder().decode(bytes.subarray(0, 256)))) return false;
  try { return parseEnvelope(bytes)?.format === STYLED_ASSET_FORMAT; } catch { return false; }
}
/** Optional readable export. The canonical download remains compact binary. */
export function styledAssetJson(bytes: Uint8Array): string {
  const envelope = parseEnvelope(bytes);
  if (envelope?.format !== STYLED_ASSET_FORMAT || ![1, 2].includes(envelope.version)) fail('unsupported envelope version');
  const nativeBytes = nativeBytesOf(envelope.native);
  return JSON.stringify({ ...envelope, native: { ...envelope.native, encoding: 'base64-kap', data: base64(nativeBytes) } }, null, 2);
}
export async function importStyledAsset(bytes: Uint8Array, options: { dracoDecoder?: any } = {}) {
  const e = parseEnvelope(bytes); dataOnly(e);
  keys(e, ['format', 'version', 'name', 'dependencies', 'native', 'style', 'sourceBounds', 'animation', 'voxel', ...(e.version === 2 ? ['conversion'] : [])], 'envelope');
  if (e.format !== STYLED_ASSET_FORMAT || ![1, 2].includes(e.version)) fail('unsupported envelope version');
  if (typeof e.name !== 'string' || e.name.length > 240) fail('invalid name');
  const dependencies = e.version === 1 ? LEGACY_DEPENDENCIES : STYLED_ASSET_DEPENDENCIES;
  keys(e.dependencies, Object.keys(dependencies), 'dependencies');
  for (const [key, value] of Object.entries(dependencies)) if (e.dependencies[key] !== value) fail('unsupported dependency ' + key);
  const style = validateStyledAssetStyle(e.style), sourceBounds = bounds(e.sourceBounds);
  keys(e.animation, ['mode'], 'animation');
  if (e.animation.mode !== (style.kind === 'voxel' ? 'static-pose' : 'preserved')) fail('animation claim conflicts with style');
  keys(e.native, ['encoding', 'byteLength', 'sha256', 'dracoRequired', 'data'], 'native');
  const nativeBytes = nativeBytesOf(e.native);
  if (nativeBytes.length !== e.native.byteLength || await hash(nativeBytes) !== e.native.sha256) fail('native KAP integrity mismatch');
  if (e.native.dracoRequired !== needsDraco(nativeBytes)) fail('native decoder dependency differs');
  const conversion = conversionOf(nativeBytes, style);
  if (e.version === 1 && conversion.textureEncoding === 'palette-pattern-v1') fail('palette textures require styled envelope v2');
  if (e.version === 2) { keys(e.conversion, Object.keys(conversion), 'conversion'); for (const [k, v] of Object.entries(conversion)) if (e.conversion[k] !== v) fail('conversion claim differs'); }
  const voxel = style.kind === 'voxel' ? validateVoxelRecipe(e.voxel) : null;
  if (style.kind !== 'voxel' && e.voxel !== null) fail('voxel recipe requires voxel style');
  const built = await buildFromPackage(nativeBytes, options), sourceGlb = built.glb;
  const snapshot = voxel ? rebuildStyledVoxels(voxel) : null;
  const glb = snapshot?.glb ?? sourceGlb;
  const json = readGlb(glb).json as any;
  const animation = { mode: e.animation.mode as 'preserved' | 'static-pose', clips: (json.animations ?? []).length, skins: (json.skins ?? []).length };
  // Source native records retain every source clip/skin even for the static voxel branch.
  return { format: 'KEEL-IMPORTED-STYLED-ASSET' as const, version: e.version as 1 | 2, name: e.name as string, style, conversion, sourceBounds, nativeScene: built.scene, reconstructedGlb: sourceGlb, sourceGlb, glb, animation, voxel, voxelMesh: snapshot?.mesh ?? null, envelope: e };
}
export type ImportedStyledAsset = Awaited<ReturnType<typeof importStyledAsset>>;

export const STYLED_ASSET_PROGRAM = `// Trusted loader for KEEL-STYLED-ASSET v1/v2. Uploaded recipes are never executed.\nimport {importStyledAsset,createStyledAssetPlayer} from './styled-asset-runtime.mjs';\nexport async function build(data,options={}){if(!data){const url=new URL('./asset.keelasset',import.meta.url);if(typeof process!=='undefined'&&process.versions?.node)data=new Uint8Array(await(await import('node:fs/promises')).readFile(url));else{const r=await fetch(url);if(!r.ok)throw Error('Styled asset data unavailable');data=new Uint8Array(await r.arrayBuffer());}}return importStyledAsset(data,options);}\nexport async function createPlayer(host,data,options={}){return createStyledAssetPlayer({...host,asset:await build(data,options)});}\n`;
export function makeStyledAssetArchive(bytes: Uint8Array, support: { runtime: Uint8Array; licenses: ArchiveFile[]; dracoFiles?: ArchiveFile[] }): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_ENVELOPE) fail('invalid envelope extent');
  const envelope = parseEnvelope(bytes);
  if (envelope?.format !== STYLED_ASSET_FORMAT || ![1, 2].includes(envelope.version)) fail('unsupported archive envelope');
  if (needsDraco(nativeBytesOf(envelope.native))) for (const name of ['draco-factory.mjs', 'draco_decoder_gltf.wasm']) if (!support.dracoFiles?.some(f => f.name === name)) fail('missing shared decoder file ' + name);
  for (const name of ['LICENSE-KEEL.txt', 'LICENSE-fflate.txt', 'LICENSE-Draco-Apache-2.0.txt', 'LICENSE-meshoptimizer.txt']) if (!support.licenses.some(f => f.name === name)) fail('missing runtime license ' + name);
  return makeAssetZip([{ name: 'asset.keelasset', data: bytes }, { name: 'asset.generated.mjs', data: STYLED_ASSET_PROGRAM }, { name: 'styled-asset-runtime.mjs', data: support.runtime }, { name: 'dependencies.json', data: JSON.stringify(envelope.dependencies, null, 2) }, { name: 'README.txt', data: 'KEEL styled asset v2 (v1 compatible). Import build or createPlayer from asset.generated.mjs. build() reconstructs native data and GLB; createPlayer({THREE, GLTFLoader, renderer}) replays the saved style and source animations. Host must provide Three.js 0.180.0 and its GLTFLoader. The shared runtime and Three dependencies are installed once. Pixel/dither may contain intentionally lossy palette/pattern textures; inspect the conversion field. Superseded color textures are absent when textureEncoding is palette-pattern-v1. Voxel is a static posed cube reconstruction. Source bounds are optional camera hints, not animation bounds. No on-chain deployment is claimed.\n' }, ...(support.dracoFiles ?? []), ...support.licenses]);
}
