export { compileRasterStyledAsset, compileRasterSourceAsset } from './raster-compiler.ts';
/** Explicit lossy styling: replace color textures with compact inferred palettes
 * and KEEL screen recipes. Geometry and animation are inherited from native KAP. */
import { buildFromPackage } from './asset-replay-v6.ts';
import { packAsset, unpackAsset } from './asset-binary-v3.ts';
import { createStyledAsset, importStyledAsset, validateStyledAssetStyle } from './styled-asset.ts';
import type { StyledAssetStyle, StyledAssetBounds } from './styled-asset.ts';
import { decodeTexturePixels } from './optimization/textures.ts';
import { encodeStylizedTexture } from './styled-texture-codec.ts';
import { nativeTextureTables, removeStyledSourceImage, STYLIZED_TEXTURE_FORMAT } from './styled-texture-replay.ts';
import { decodePng } from './png.ts';
import { compileAnimatedVoxels } from './animated-voxel.ts';
import { createAnimatedVoxelStyledAsset } from './styled-asset.ts';

export async function compileAnimatedVoxelStyledAsset(input: Parameters<typeof compileAnimatedVoxels>[0] & { name?: string; style?: StyledAssetStyle; sourceBounds?: StyledAssetBounds | null }) {
  const start = performance.now();
  const result = await compileAnimatedVoxels(input);
  const wrapStart = performance.now();
  const assetBytes = await createAnimatedVoxelStyledAsset({ recipe: result.recipe, ...(input.name === undefined ? {} : { name: input.name }), ...(input.style === undefined ? {} : { style: input.style }), ...(input.sourceBounds === undefined ? {} : { sourceBounds: input.sourceBounds }) });
  const imported = await importStyledAsset(assetBytes);
  return { assetBytes, imported, report: { ...result.report, assetBytes: assetBytes.length, assetSha256: await hash(assetBytes), reconstructedGlbSha256: await hash(imported.glb) }, timings: { ...result.timings, voxelCompile: result.timings.total, envelopeAndValidation: performance.now() - wrapStart, total: performance.now() - start } };
}

export interface CompileStyledAssetInput {
  packageBytes: Uint8Array;
  style: StyledAssetStyle;
  texture: { maxDimension: 128 | 256 | 512; paletteSize: 8 | 16 | 32 | 64 };
  name?: string;
  sourceBounds?: StyledAssetBounds | null;
  dracoDecoder?: any;
  onProgress?: (event: { stage: string; done: number; total: number }) => void;
}
const raw = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const hash = async (a: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(a)))).map(v => v.toString(16).padStart(2, '0')).join('');

/** Never reinterpret normal/linear or unfamiliar material maps as display colors. */
export function styledImageUsages(json: any, count: number): { roles: string[]; colorOnly: boolean; reason: string }[] {
  const roles = Array.from({ length: count }, () => new Set<string>());
  for (const material of json.materials ?? []) {
    const visit = (value: any, path: string) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'extras') continue;
        const next = path ? path + '.' + key : key;
        if (key.endsWith('Texture') && child && typeof child === 'object') {
          const texture = json.textures?.[(child as any).index], source = texture?.source;
          const role = next === 'pbrMetallicRoughness.baseColorTexture' || next === 'emissiveTexture' ? 'color' : next === 'normalTexture' ? 'normal' : next === 'occlusionTexture' || next === 'pbrMetallicRoughness.metallicRoughnessTexture' ? 'linear' : 'unknown';
          if (roles[source]) roles[source]!.add(role);
          for (const ext of Object.values(texture?.extensions ?? {}) as any[]) if (roles[ext?.source]) roles[ext.source]!.add('unknown');
        } else visit(child, next);
      }
    };
    visit(material, '');
  }
  return roles.map(r => ({ roles: [...r].sort(), colorOnly: r.size === 1 && r.has('color'), reason: !r.size ? 'Unreferenced or unsupported texture role retained' : r.size === 1 && r.has('color') ? 'Standard base-color/emissive image' : 'Normal, linear, mixed or unknown material usage retained' }));
}
function pixelError(source: { width: number; height: number; data: Uint8Array }, result: { width: number; height: number; rgba: Uint8Array }) {
  const sums = [0, 0, 0, 0], maxima = [0, 0, 0, 0]; let changedAlpha = 0, coverage = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const at = (y * source.width + x) * 4, to = (Math.min(result.height - 1, Math.floor((y + .5) * result.height / source.height)) * result.width + Math.min(result.width - 1, Math.floor((x + .5) * result.width / source.width))) * 4;
    for (let c = 0; c < 4; c++) { const d = Math.abs(source.data[at + c]! - result.rgba[to + c]!); sums[c]! += d * d; maxima[c] = Math.max(maxima[c]!, d); }
    changedAlpha += Number(source.data[at + 3] !== result.rgba[to + 3]); coverage += Number((source.data[at + 3]! >= 128) !== (result.rgba[to + 3]! >= 128));
  }
  const n = source.width * source.height;
  return { channelRmse: sums.map(x => Math.sqrt(x / n)), channelMax: maxima, alphaChangedPixels: changedAlpha, alphaCoverageChangeAtHalf: coverage / n, comparedSourcePixels: n, reconstruction: 'nearest at original texel centers' };
}
export async function compileStyledAsset(input: CompileStyledAssetInput) {
  const started = performance.now(), style = validateStyledAssetStyle(input.style), timings: Record<string, number> = {};
  if (!['pixel', 'dither'].includes(style.kind)) throw Error('Texture styling requires explicit pixel/dither lossy style');
  if (![128, 256, 512].includes(input.texture?.maxDimension) || ![8, 16, 32, 64].includes(input.texture?.paletteSize)) throw Error('Invalid stylized texture settings');
  let at = performance.now(); input.onProgress?.({ stage: 'styled-native-replay', done: 0, total: 1 });
  const source = await buildFromPackage(input.packageBytes, { dracoDecoder: input.dracoDecoder }); timings.nativeReplay = performance.now() - at;
  const base = unpackAsset(input.packageBytes), { body } = nativeTextureTables(base), usages = styledImageUsages(source.scene.json, source.images.length), images: any[] = [], reports: any[] = [], expected = new Map<number, Uint8Array>();
  const json = body.native.base.json, changed = new Set<number>(); let sourcePixels = 0;
  at = performance.now();
  for (let i = 0; i < source.images.length; i++) {
    input.onProgress?.({ stage: 'styled-textures', done: i, total: source.images.length });
    const image = source.images[i], usage = usages[i]!;
    if (!usage.colorOnly) { reports.push({ image: i, changed: false, sourceBytes: image.data.length, ...usage }); continue; }
    let pixels;
    try { pixels = decodeTexturePixels({ ...image, sourceIndex: i }); }
    catch (e) { reports.push({ image: i, changed: false, sourceBytes: image.data.length, roles: usage.roles, reason: (e as Error).message }); continue; }
    sourcePixels += pixels.width * pixels.height; if (sourcePixels > 64 * 1024 * 1024) throw Error('Styled source pixel budget exceeded');
    const encoded = encodeStylizedTexture(pixels, { ...input.texture, kind: style.kind as 'pixel' | 'dither', screen: style.screen });
    images.push({ image: i, recipe: encoded.recipe }); expected.set(i, encoded.rgba); changed.add(i); removeStyledSourceImage(base, i);
    reports.push({ image: i, changed: true, roles: usage.roles, sourceBytes: image.data.length, sourceDimensions: [pixels.width, pixels.height], outputDimensions: [encoded.width, encoded.height], recipeBytes: packAsset(encoded.recipe).length, error: pixelError(pixels, encoded), codec: encoded.report, reason: 'Explicit lossy palette/pattern replacement; superseded color image removed' });
  }
  // Use a dedicated nearest sampler per prior wrap-state. Shared normal-map samplers stay untouched.
  const samplerMap = new Map<string, number>();
  for (const texture of json.textures ?? []) if (changed.has(texture.source)) {
    const previous = texture.sampler === undefined ? {} : json.samplers?.[texture.sampler] ?? {}, next = { ...previous, magFilter: 9728, minFilter: 9728 }, key = JSON.stringify(next);
    if (!samplerMap.has(key)) { json.samplers ??= []; samplerMap.set(key, json.samplers.length); json.samplers.push(next); }
    texture.sampler = samplerMap.get(key);
  }
  timings.textureEncoding = performance.now() - at;
  const packageBytes = images.length ? packAsset({ format: STYLIZED_TEXTURE_FORMAT, version: 1, mode: 'stylized-lossy', base, images }) : new Uint8Array(input.packageBytes);
  at = performance.now(); const assetBytes = await createStyledAsset({ packageBytes, style, ...(input.name === undefined ? {} : { name: input.name }), ...(input.sourceBounds === undefined ? {} : { sourceBounds: input.sourceBounds }) });
  const imported = await importStyledAsset(assetBytes, { dracoDecoder: input.dracoDecoder });
  if (source.accessors.length !== imported.nativeScene.accessors.length) throw Error('Styled accessor count changed');
  for (let i = 0; i < source.accessors.length; i++) if (!same(raw(source.accessors[i]), raw(imported.nativeScene.accessors[i]))) throw Error('Styled geometry/animation accessor changed: ' + i);
  for (const [i, rgba] of expected) if (!same(decodePng(imported.nativeScene.images[i].data).data, rgba)) throw Error('Styled texture replay differs: ' + i);
  for (let i = 0; i < source.images.length; i++) if (!changed.has(i) && !same(source.images[i].data, imported.nativeScene.images[i].data)) throw Error('Retained map changed: ' + i);
  const before = structuredClone(source.scene.json), after = structuredClone(imported.nativeScene.json);
  delete before.samplers; delete after.samplers;
  for (const j of [before, after]) for (const texture of j.textures ?? []) if (changed.has(texture.source)) delete texture.sampler;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Styled scene metadata changed outside declared texture sampling');
  timings.validation = performance.now() - at; timings.total = performance.now() - started;
  const report = { version: 1, mode: 'stylized-lossy', settings: { style, texture: input.texture }, nativeInputBytes: input.packageBytes.length, assetBytes: assetBytes.length, assetSha256: await hash(assetBytes), reconstructedGlbSha256: await hash(imported.glb), changedImages: images.length, retainedImages: source.images.length - images.length, images: reports, validation: { decodedAccessorsExactToNativeInput: true, sceneExceptTextureSamplingExact: true, generatedTexturePixelsExactToRecipe: true, retainedImagesExact: true, noSupersededTexturePayload: true }, warnings: ['Palette reduction, resolution changes, nearest sampling and dithering are intentional visual loss.', 'sourceGlb/reconstructedGlb contain the styled reconstruction; superseded color textures are unavailable from this download.', 'Normal, linear, mixed and unknown image roles are retained.', 'No guarantee that every styled asset is smaller. Measure the complete downloaded asset with the same encoder.', 'Animation data is unchanged; GPU pixel parity is not verified.'] };
  return { assetBytes, packageBytes, imported, report, timings };
}
