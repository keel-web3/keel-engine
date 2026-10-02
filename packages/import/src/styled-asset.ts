/** Declarative styled-asset transport. Only this trusted runtime executes code;
 * uploaded assets contain data, never import paths or executable programs. */
import { importRasterEnvelope } from './raster-asset.ts';
import { SCREENS } from '@keel-engine/core';
import type { ScreenId } from '@keel-engine/core';
import { COMPILER_VERSION } from './asset-replay-v6.ts';
import { replayStyledTexturePackage as buildFromPackage, STYLIZED_TEXTURE_FORMAT, nativeTextureTables } from './styled-texture-replay.ts';
import { encodeVoxelSnapshot, replayVoxelSnapshot } from './styled-voxel-codec.ts';
import { normalizeAsset } from './asset-normalize-v3.ts';
import { buildAnimatedVoxelAsset, ANIMATED_VOXEL_FORMAT, MORPH_VOXEL_FORMAT } from './animated-voxel-replay.ts';
import type { AnimatedVoxelReplayOptions } from './animated-voxel-replay.ts';
import { packAsset, unpackAsset } from './asset-binary-v3.ts';
import { addBox, meshData, writeGlb } from './write.ts';
import { readGlb } from './gltf.ts';
import { makeAssetZip } from './asset-package-v3.ts';
import type { ArchiveFile } from './asset-package-v3.ts';

export const STYLED_ASSET_FORMAT = 'KEEL-STYLED-ASSET';
export const STYLED_ASSET_VERSION = 2;
export const VOXEL_STYLED_ASSET_VERSION = 3;
export const STYLED_ASSET_RUNTIME_VERSION = 'keel-styled-asset-7.0.0';
const LEGACY_DEPENDENCIES = Object.freeze({
  runtime: 'keel-styled-asset-1.0.0',
  nativeCompiler: COMPILER_VERSION,
  '@keel-engine/import': '0.1.0', '@keel-engine/core': '0.1.0',
  fflate: '0.8.2', meshoptimizer: '0.25.0', draco3dgltf: '1.5.7',
  renderer: 'three@0.180.0', loader: 'three@0.180.0/GLTFLoader',
  screen: 'keel-core-float32-tile192-top-left-v1',
});
// Keep v2 dependency bytes fixed: upgrading the shared runtime does not rewrite
// existing compact Pixel/Dither assets.
export const STYLED_ASSET_DEPENDENCIES = Object.freeze({ ...LEGACY_DEPENDENCIES, runtime: 'keel-styled-asset-2.0.0', textureCodec: 'keel-stylized-textures-v1' });
export const VOXEL_ASSET_DEPENDENCIES = Object.freeze({ runtime: 'keel-styled-asset-3.0.0', '@keel-engine/import': '0.1.0', '@keel-engine/core': '0.1.0', fflate: '0.8.2', renderer: 'three@0.180.0', loader: 'three@0.180.0/GLTFLoader', voxelCodec: 'keel-static-voxel-snapshot-v1' });
export const ANIMATED_VOXEL_DEPENDENCIES = Object.freeze({ ...VOXEL_ASSET_DEPENDENCIES, runtime: 'keel-styled-asset-4.0.0', animationCodec: ANIMATED_VOXEL_FORMAT });
export const MORPH_VOXEL_DEPENDENCIES = Object.freeze({ ...ANIMATED_VOXEL_DEPENDENCIES, runtime: 'keel-styled-asset-6.0.0', animationCodec: MORPH_VOXEL_FORMAT });
/** Keep existing dependency bytes for small recipes. Extended sparse grids,
 * generated cube counts and explicit larger host budgets need the v7 reader. */
function animatedVoxelDependencies(recipe: any) {
  const legacy = recipe?.format === MORPH_VOXEL_FORMAT ? MORPH_VOXEL_DEPENDENCIES : ANIMATED_VOXEL_DEPENDENCIES;
  const parts = Array.isArray(recipe?.parts) ? recipe.parts : [], motion = Array.isArray(recipe?.motion) ? recipe.motion : [];
  const cubes = parts.reduce((n: number, p: any) => n + (p?.snapshot?.count ?? 0), 0);
  const extended = cubes > 20000 || parts.some((p: any) => Array.isArray(p?.snapshot?.size) && p.snapshot.size.reduce((n: number, v: number) => n * v, 1) > 1000000 || (p?.snapshot?.sourceLength ?? 0) > 825000) || motion.reduce((n: number, r: any) => n + (r?.buffer?.sourceLength ?? 0), 0) > 64 * 1024 * 1024 || parts.reduce((n: number, p: any) => n + (p?.snapshot?.count ?? 0) * 12 * 24 * (p?.morphs?.length ?? 0), 0) > 64 * 1024 * 1024;
  return extended ? { ...legacy, runtime: 'keel-styled-asset-7.0.0' } : legacy;
}
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
  /** Required to deliberately discard clips from an animated source. */
  staticPose?: boolean;
}
export interface VoxelStyledAssetInput {
  voxel: unknown;
  style?: StyledAssetStyle;
  sourceBounds?: StyledAssetBounds | null;
  name?: string;
  /** Attribution only; no source buffers, geometry or textures are embedded. */
  attribution?: Record<string, unknown> | null;
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
  if (bytes.length >= 4 && bytes[0] === 0x4b && bytes[1] === 0x41 && bytes[2] === 0x50 && bytes[3] === 0x33) return unpackAsset(bytes);
  const value = JSON.parse(utf8.decode(bytes));
  if (value?.version === 3 && value?.voxel?.data?.encoding === 'base64') { keys(value.voxel.data, ['encoding', 'data'], 'voxel data'); value.voxel.data = unbase64(value.voxel.data.data); }
  if (value?.version === 5 && value.raster?.recipe?.data?.encoding === 'base64') { keys(value.raster.recipe.data, ['encoding', 'data'], 'raster data'); value.raster.recipe.data = unbase64(value.raster.recipe.data.data); }
  if (value?.version === 4) {
    const r = value.animatedVoxel;
    if (!Array.isArray(r?.motion) || r.motion.length > 8192 || !Array.isArray(r?.parts) || r.parts.length > 512) fail('invalid animated voxel tables');
    const restore = (wire: any) => { if (wire?.data?.encoding === 'base64') { keys(wire.data, ['encoding', 'data'], 'animated voxel data'); wire.data = unbase64(wire.data.data); } };
    for (const motion of r.motion) restore(motion?.buffer);
    for (const part of r.parts) { restore(part?.snapshot); restore(part?.joints); restore(part?.weights); if (Array.isArray(part?.morphs)) for (const morph of part.morphs) restore(morph); }
  }
  return value;
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

function voxelAttribution(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  dataOnly(value); record(value, 'attribution');
  const visit = (x: any): void => { if (x instanceof Uint8Array) fail('binary attribution is not allowed'); if (x && typeof x === 'object') for (const v of Object.values(x)) visit(v); };
  visit(value);
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536) fail('attribution exceeds limit');
  return structuredClone(value) as Record<string, unknown>;
}
const VOXEL_CONVERSION = Object.freeze({ mode: 'static-pose', textureEncoding: 'none', voxelEncoding: 'palette-grid-v1', sourceGeometryRemoved: true, sourceTexturesRemoved: true, sourceAnimationRemoved: true });
/** A standalone posed voxel asset. The original native KAP is not a dependency. */
export async function createVoxelStyledAsset(input: VoxelStyledAssetInput): Promise<Uint8Array> {
  const style = validateStyledAssetStyle(input.style ?? { kind: 'voxel', pixelSize: 1, toneLevels: 8, screen: 'bayer4' });
  if (style.kind !== 'voxel') fail('voxel snapshot requires voxel style');
  const name = input.name ?? 'Static voxel pose'; if (typeof name !== 'string' || name.length > 240) fail('invalid name');
  const voxel = encodeVoxelSnapshot(validateVoxelRecipe(input.voxel)).recipe;
  const envelope = { format: STYLED_ASSET_FORMAT, version: VOXEL_STYLED_ASSET_VERSION, name, dependencies: VOXEL_ASSET_DEPENDENCIES, native: { encoding: 'none', byteLength: 0, dracoRequired: false }, style, conversion: VOXEL_CONVERSION, sourceBounds: bounds(input.sourceBounds), animation: { mode: 'static-pose' }, attribution: voxelAttribution(input.attribution), voxel };
  const bytes = packAsset(envelope); if (bytes.length > MAX_ENVELOPE) fail('envelope exceeds limit'); return bytes;
}
export async function createAnimatedVoxelStyledAsset(input: { recipe: any; style?: StyledAssetStyle; name?: string; sourceBounds?: StyledAssetBounds | null; maxWorkingBytes?: number }): Promise<Uint8Array> {
  const style = validateStyledAssetStyle(input.style ?? { kind: 'voxel', pixelSize: 1, toneLevels: 8, screen: 'bayer4' });
  if (style.kind !== 'voxel') fail('animated voxel recipe requires voxel style');
  const name = input.name ?? 'Animated voxels'; if (typeof name !== 'string' || name.length > 240) fail('invalid name');
  dataOnly(input.recipe); await buildAnimatedVoxelAsset(input.recipe, input.maxWorkingBytes === undefined ? {} : { maxWorkingBytes: input.maxWorkingBytes });
  const envelope = { format: STYLED_ASSET_FORMAT, version: 4, name, dependencies: animatedVoxelDependencies(input.recipe), native: { encoding: 'rigged-voxel', byteLength: 0, dracoRequired: false }, style, sourceBounds: bounds(input.sourceBounds), animation: { mode: 'preserved' }, animatedVoxel: input.recipe };
  const bytes = packAsset(envelope); if (bytes.length > MAX_ENVELOPE) fail('envelope exceeds limit'); return bytes;
}
async function importAnimatedVoxelEnvelope(e: any, options: AnimatedVoxelReplayOptions = {}) {
  keys(e, ['format', 'version', 'name', 'dependencies', 'native', 'style', 'sourceBounds', 'animation', 'animatedVoxel'], 'animated voxel envelope');
  if (e.format !== STYLED_ASSET_FORMAT || e.version !== 4 || typeof e.name !== 'string' || e.name.length > 240) fail('invalid animated voxel envelope');
  const dependencies = animatedVoxelDependencies(e.animatedVoxel);
  keys(e.dependencies, Object.keys(dependencies), 'dependencies'); for (const [k, v] of Object.entries(dependencies)) if (e.dependencies[k] !== v) fail('unsupported animated voxel dependency ' + k);
  keys(e.native, ['encoding', 'byteLength', 'dracoRequired'], 'animated voxel source'); if (e.native.encoding !== 'rigged-voxel' || e.native.byteLength !== 0 || e.native.dracoRequired !== false) fail('animated voxel source claim differs');
  keys(e.animation, ['mode'], 'animation'); if (e.animation.mode !== 'preserved') fail('animated voxel clips must be preserved');
  const style = validateStyledAssetStyle(e.style); if (style.kind !== 'voxel') fail('animated voxels require voxel style');
  const built = await buildAnimatedVoxelAsset(e.animatedVoxel, options);
  return { format: 'KEEL-IMPORTED-STYLED-ASSET' as const, version: 4 as const, name: e.name as string, style, conversion: { mode: 'animated-voxel-lossy', sourceGeometryRemoved: true, sourceTexturesRemoved: true, sourceAnimationRemoved: false }, sourceBounds: bounds(e.sourceBounds), nativeScene: built.scene, reconstructedGlb: built.glb, sourceGlb: built.glb, glb: built.glb, animation: { mode: 'preserved' as const, clips: built.scene.json.animations.length, skins: built.scene.json.skins.length }, voxel: null, voxelMesh: null, voxelCount: built.cubes, envelope: e };
}
async function importVoxelEnvelope(e: any) {
  keys(e, ['format', 'version', 'name', 'dependencies', 'native', 'style', 'conversion', 'sourceBounds', 'animation', 'attribution', 'voxel'], 'voxel envelope');
  if (e.format !== STYLED_ASSET_FORMAT || e.version !== 3 || typeof e.name !== 'string' || e.name.length > 240) fail('invalid voxel envelope');
  keys(e.dependencies, Object.keys(VOXEL_ASSET_DEPENDENCIES), 'dependencies');
  for (const [k, v] of Object.entries(VOXEL_ASSET_DEPENDENCIES)) if (e.dependencies[k] !== v) fail('unsupported voxel dependency ' + k);
  keys(e.native, ['encoding', 'byteLength', 'dracoRequired'], 'voxel native data');
  if (e.native.encoding !== 'none' || e.native.byteLength !== 0 || e.native.dracoRequired !== false) fail('voxel snapshot must not carry a source model');
  keys(e.conversion, Object.keys(VOXEL_CONVERSION), 'voxel conversion');
  for (const [k, v] of Object.entries(VOXEL_CONVERSION)) if (e.conversion[k] !== v) fail('voxel conversion claim differs');
  keys(e.animation, ['mode'], 'animation'); if (e.animation.mode !== 'static-pose') fail('voxel snapshot cannot contain animation');
  const style = validateStyledAssetStyle(e.style); if (style.kind !== 'voxel') fail('voxel snapshot requires voxel style');
  const sourceBounds = bounds(e.sourceBounds), attribution = voxelAttribution(e.attribution), voxel = replayVoxelSnapshot(e.voxel), snapshot = rebuildStyledVoxels(voxel);
  const normalized = await normalizeAsset({ entry: 'static-voxel.glb', files: [{ name: 'static-voxel.glb', data: snapshot.glb }] });
  const primitive = normalized.json.meshes[0].primitives[0];
  const nativeScene = { format: 'KEEL-NATIVE-SCENE' as const, version: 2 as const, json: normalized.json, accessors: normalized.accessors.map(a => a.array), images: [], primitives: [{ mesh: 0, primitive: 0, mode: 4, material: 0, geometry: snapshot.mesh, attributes: primitive.attributes, targets: [] }] };
  return { format: 'KEEL-IMPORTED-STYLED-ASSET' as const, version: 3 as const, name: e.name as string, style, conversion: VOXEL_CONVERSION, sourceBounds, nativeScene, reconstructedGlb: snapshot.glb, sourceGlb: snapshot.glb, glb: snapshot.glb, animation: { mode: 'static-pose' as const, clips: 0, skins: 0 }, attribution, voxel, voxelMesh: snapshot.mesh, envelope: e };
}

export async function createStyledAsset(input: StyledAssetInput): Promise<Uint8Array> {
  if (!(input.packageBytes instanceof Uint8Array) || !input.packageBytes.length || input.packageBytes.length > MAX_KAP) fail('native KAP bytes required');
  const style = validateStyledAssetStyle(input.style), sourceBounds = bounds(input.sourceBounds);
  const name = input.name ?? 'Styled asset'; if (typeof name !== 'string' || name.length > 240) fail('invalid name');
  if (style.kind === 'voxel') {
    let source = unpackAsset(input.packageBytes); if (source?.format === STYLIZED_TEXTURE_FORMAT) source = source.base;
    const sourceJson = nativeTextureTables(source).body.native.base.json;
    if (sourceJson.animations?.length && input.staticPose !== true) fail('Animated source: use compileAnimatedVoxelStyledAsset to preserve clips, or explicitly choose staticPose:true');
    const attribution = sourceJson.asset ?? null;
    return createVoxelStyledAsset({ voxel: input.voxel, style, sourceBounds, name, attribution });
  }
  const voxel = null;
  if (input.voxel !== undefined) fail('voxel recipe requires voxel style');
  const envelope = { format: STYLED_ASSET_FORMAT, version: STYLED_ASSET_VERSION, name, dependencies: STYLED_ASSET_DEPENDENCIES, native: { encoding: 'kap', byteLength: input.packageBytes.length, sha256: await hash(input.packageBytes), dracoRequired: needsDraco(input.packageBytes), data: input.packageBytes }, style, conversion: conversionOf(input.packageBytes, style), sourceBounds, animation: { mode: 'preserved' }, voxel };
  const bytes = packAsset(envelope); if (bytes.length > MAX_ENVELOPE) fail('envelope exceeds limit');
  return bytes;
}
export function isStyledAsset(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_ENVELOPE) return false;
  const binary = bytes[0] === 0x4b && bytes[1] === 0x41 && bytes[2] === 0x50 && bytes[3] === 0x33;
  if (!binary && !/^\s*\{/.test(new TextDecoder().decode(bytes.subarray(0, 256)))) return false;
  try { return parseEnvelope(bytes)?.format === STYLED_ASSET_FORMAT; } catch { return false; }
}
/** JSON permits -0 literals although JSON.stringify erases their sign. Preserve
 * source transform metadata as well as exact binary fields in readable v4. */
function readableAnimatedJson(value: any, level = 0): string {
  if (value instanceof Uint8Array) return JSON.stringify({ encoding: 'base64', data: base64(value) });
  if (value === null || typeof value !== 'object') return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => readableAnimatedJson(v, level + 1)).join(', ') + ']';
  const entries = Object.entries(value); if (!entries.length) return '{}';
  const indent = '  '.repeat(level + 1);
  return '{\n' + entries.map(([k, v]) => indent + JSON.stringify(k) + ': ' + readableAnimatedJson(v, level + 1)).join(',\n') + '\n' + '  '.repeat(level) + '}';
}
/** Optional readable export. The canonical download remains compact binary. */
export function styledAssetJson(bytes: Uint8Array): string {
  const envelope = parseEnvelope(bytes);
  if (envelope?.format !== STYLED_ASSET_FORMAT || ![1, 2, 3, 4, 5].includes(envelope.version)) fail('unsupported envelope version');
  if (envelope.version >= 4) return readableAnimatedJson(envelope);
  if (envelope.version >= 3) return JSON.stringify(envelope, (_k, v) => v instanceof Uint8Array ? { encoding: 'base64', data: base64(v) } : v, 2);
  const nativeBytes = nativeBytesOf(envelope.native);
  return JSON.stringify({ ...envelope, native: { ...envelope.native, encoding: 'base64-kap', data: base64(nativeBytes) } }, null, 2);
}
export async function importStyledAsset(bytes: Uint8Array, options: { dracoDecoder?: any; maxWorkingBytes?: number } = {}) {
  const e = parseEnvelope(bytes); dataOnly(e);
  if (e.version === 5) return importRasterEnvelope(e);
  if (e.version === 4) return importAnimatedVoxelEnvelope(e, options);
  if (e.version === 3) return importVoxelEnvelope(e);
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

export const STYLED_ASSET_PROGRAM = `// Trusted loader for KEEL-STYLED-ASSET v1/v2/v3/v4/v5. Uploaded recipes are never executed.\nimport {importStyledAsset,createStyledAssetPlayer} from './styled-asset-runtime.mjs';\nexport async function build(data,options={}){if(!data){const url=new URL('./asset.keelasset',import.meta.url);if(typeof process!=='undefined'&&process.versions?.node)data=new Uint8Array(await(await import('node:fs/promises')).readFile(url));else{const r=await fetch(url);if(!r.ok)throw Error('Styled asset data unavailable');data=new Uint8Array(await r.arrayBuffer());}}return importStyledAsset(data,options);}\nexport async function createPlayer(host,data,options={}){return createStyledAssetPlayer({...host,asset:await build(data,options)});}\n`;
export function makeStyledAssetArchive(bytes: Uint8Array, support: { runtime: Uint8Array; licenses: ArchiveFile[]; dracoFiles?: ArchiveFile[] }): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_ENVELOPE) fail('invalid envelope extent');
  const envelope = parseEnvelope(bytes);
  if (envelope?.format !== STYLED_ASSET_FORMAT || ![1, 2, 3, 4, 5].includes(envelope.version)) fail('unsupported archive envelope');
  const dracoRequired = envelope.version < 3 && needsDraco(nativeBytesOf(envelope.native));
  if (dracoRequired) for (const name of ['draco-factory.mjs', 'draco_decoder_gltf.wasm']) if (!support.dracoFiles?.some(f => f.name === name)) fail('missing shared decoder file ' + name);
  for (const name of ['LICENSE-KEEL.txt', 'LICENSE-fflate.txt', 'LICENSE-Draco-Apache-2.0.txt', 'LICENSE-meshoptimizer.txt']) if (!support.licenses.some(f => f.name === name)) fail('missing runtime license ' + name);
  return makeAssetZip([{ name: 'asset.keelasset', data: bytes }, { name: 'asset.generated.mjs', data: STYLED_ASSET_PROGRAM }, { name: 'styled-asset-runtime.mjs', data: support.runtime }, { name: 'dependencies.json', data: JSON.stringify(envelope.dependencies, null, 2) }, { name: 'README.txt', data: 'KEEL styled asset v1/v2/v3/v4/v5. Import build or createPlayer from asset.generated.mjs. build() reconstructs native data and GLB; createPlayer({THREE, GLTFLoader, renderer}) replays the saved style and source animations. Host must provide Three.js 0.180.0 and its GLTFLoader. The shared runtime and Three dependencies are installed once. Pixel/dither may contain intentionally lossy palette/pattern textures; inspect the conversion field. Superseded color textures are absent when textureEncoding is palette-pattern-v1. Voxel v3 contains only a static posed cube reconstruction, with no source model, textures, rig or animation. Voxel v4 reconstructs cubes with resampled blended weights, original rig and TRS clips. Morph recipes require runtime 6 and retain morph-weight clips with nearest-triangle position displacement per cube; source normal/tangent morph shading and sub-cell detail are not retained. Raster v5 contains sampled RGBA frames and view/clip metadata; its GLB is a static first-frame card and full animation requires this raster runtime. Source bounds are optional camera hints, not animation bounds. No on-chain deployment is claimed.\n' }, ...(dracoRequired ? support.dracoFiles ?? [] : []), ...support.licenses]);
}
