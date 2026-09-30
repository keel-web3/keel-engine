/** Isolated, opt-in experiment: ordinary JPEG/PNG candidates plus finite rendered
 * base-color error gates. This does not establish all-view or PBR equivalence.
 * The existing texture optimizer supplies bounded parsing, linear-light reduction,
 * and unchanged source-texel alpha/normal gates. No frozen compiler is changed.
 */
import { optimizeTextures } from './textures.ts';
import type { TextureImageReport } from './textures.ts';
import type { NormalizedAsset } from '../asset-normalize-v3.ts';

export interface AppearanceRaster {
  width: number;
  height: number;
  rgba: Uint8Array;
  coverage: Uint8Array;
}
export interface AppearanceError {
  colorRmse: number;
  colorMax: number;
  colorP99: number;
  edgeRmse: number;
  edgeMax: number;
  coverageDifference: number;
  coveredPixels: number;
  comparedEdges: number;
}
export interface AppearanceSample extends AppearanceError { id: string; viewport: [number, number] }
export interface AppearanceLimits {
  maxColorRmse: number;
  maxColorP99: number;
  maxEdgeRmse: number;
  maxCoverageDifference: number;
  minCoveredPixels: number;
}
export const APPEARANCE_LIMITS: Readonly<AppearanceLimits> = Object.freeze({
  maxColorRmse: 8, maxColorP99: 40, maxEdgeRmse: 12, maxCoverageDifference: 0,
  minCoveredPixels: 16,
});
export const APPEARANCE_LADDER = Object.freeze([
  Object.freeze({ maxDimension: 1024, quality: 85 }),
  Object.freeze({ maxDimension: 512, quality: 85 }),
  Object.freeze({ maxDimension: 512, quality: 65 }),
]);
export interface AppearanceCandidate {
  maxDimension: number;
  quality: number;
  texture: TextureImageReport;
  samples: AppearanceSample[];
  accepted: boolean;
  reason: string;
  seconds: { texture: number; render: number };
}
export interface AppearanceImageReport {
  imageIndex: number;
  sourceBytes: number;
  outputBytes: number;
  changed: boolean;
  reason: string;
  winner: number | null;
  candidates: AppearanceCandidate[];
}
export interface AppearanceReport {
  mode: 'finite-base-color-experiment';
  measurement: string;
  limits: AppearanceLimits;
  textureLimits: { maxRgbaRmse: number; maxRgbaError: number; maxAlphaRmse: number; maxAlphaError: number; maxNormalAngleDegrees: number; maxAlphaCoverageError: number };
  ladder: { maxDimension: number; quality: number }[];
  sourceBytes: number;
  outputBytes: number;
  savedBytes: number;
  changedImages: number;
  encodedCandidates: number;
  images: AppearanceImageReport[];
  finalSamples: AppearanceSample[];
  finalAccepted: boolean;
  finalReason: string;
  seconds: { texture: number; render: number; total: number };
}

/** RGB error uses the union of covered pixels, excluding background dilution.
 * Edge error compares horizontal/vertical RGB finite differences touching that
 * union. Coverage is XOR / union; it cannot be hidden by equal mask populations.
 * Units are 8-bit sRGB, not a perceptual JND claim. */
export function measureAppearance(source: AppearanceRaster, output: AppearanceRaster): AppearanceError {
  if (source.width !== output.width || source.height !== output.height || source.rgba.length !== source.width * source.height * 4 || output.rgba.length !== source.rgba.length || source.coverage.length !== source.width * source.height || output.coverage.length !== source.coverage.length) throw new Error('Appearance raster dimensions do not match');
  let square = 0, maximum = 0, pixels = 0, coverage = 0, edgeSquare = 0, edgeMaximum = 0, edges = 0;
  const histogram = new Uint32Array(256), union = new Uint8Array(source.coverage.length);
  for (let p = 0; p < union.length; p++) {
    if (!source.coverage[p] && !output.coverage[p]) continue;
    union[p] = 1; pixels++; coverage += Number(!!source.coverage[p] !== !!output.coverage[p]);
    for (let c = 0; c < 3; c++) { const d = Math.abs(source.rgba[p * 4 + c]! - output.rgba[p * 4 + c]!); square += d * d; maximum = Math.max(maximum, d); histogram[d]!++; }
  }
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const p = y * source.width + x;
    for (const q of [x + 1 < source.width ? p + 1 : -1, y + 1 < source.height ? p + source.width : -1]) {
      if (q < 0 || !union[p] && !union[q]) continue;
      edges++;
      for (let c = 0; c < 3; c++) {
        const d = (source.rgba[p * 4 + c]! - source.rgba[q * 4 + c]!) - (output.rgba[p * 4 + c]! - output.rgba[q * 4 + c]!);
        edgeSquare += d * d; edgeMaximum = Math.max(edgeMaximum, Math.abs(d));
      }
    }
  }
  let n = 0, p99 = 0;
  for (; p99 < 255; p99++) { n += histogram[p99]!; if (n >= Math.ceil(pixels * 3 * .99)) break; }
  return { colorRmse: pixels ? Math.sqrt(square / (pixels * 3)) : 0, colorMax: maximum, colorP99: p99, edgeRmse: edges ? Math.sqrt(edgeSquare / (edges * 3)) : 0, edgeMax: edgeMaximum, coverageDifference: pixels ? coverage / pixels : 0, coveredPixels: pixels, comparedEdges: edges };
}

function appearanceRejection(samples: AppearanceSample[], limits: AppearanceLimits): string | null {
  if (!samples.length) return 'no rendered samples';
  for (const sample of samples) {
    for (const key of ['colorRmse', 'colorMax', 'colorP99', 'edgeRmse', 'edgeMax', 'coverageDifference', 'coveredPixels', 'comparedEdges'] as const) {
      if (!Number.isFinite(sample[key]) || sample[key] < 0) return 'missing, negative or nonfinite rendered metric';
    }
    if (sample.coveredPixels < limits.minCoveredPixels) return `${sample.id}: insufficient covered pixels`;
    if (sample.colorRmse > limits.maxColorRmse) return `${sample.id}: covered RGB RMSE exceeds limit`;
    if (sample.colorP99 > limits.maxColorP99) return `${sample.id}: RGB p99 exceeds limit`;
    if (sample.edgeRmse > limits.maxEdgeRmse) return `${sample.id}: edge RMSE exceeds limit`;
    if (sample.coverageDifference > limits.maxCoverageDifference) return `${sample.id}: coverage differs`;
  }
  return null;
}

/** A source image is eligible only when all its uses are supported base color.
 * Linear, normal, emissive, extension, mixed and BLEND uses remain byte-exact.
 * Other PBR maps in the material remain exact but are not rendered by the oracle.
 */
export function appearanceEligibility(asset: NormalizedAsset, imageIndex: number): string | null {
  const materials = asset.json.materials ?? [], used = new Set<number>();
  let reason: string | null = null;
  const visit = (value: any, path: string, materialIndex: number): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'extras') continue;
      const slot = path ? path + '.' + key : key;
      if (key.endsWith('Texture') && child && typeof child === 'object') {
        const info = child as any, texture = asset.json.textures?.[info.index];
        if (texture?.source !== imageIndex) continue;
        used.add(materialIndex);
        if (slot !== 'pbrMetallicRoughness.baseColorTexture') reason = 'non-base-color or mixed texture use retained exactly';
        if (info.extensions && Object.keys(info.extensions).length || texture.extensions && Object.keys(texture.extensions).length) reason = 'texture extensions are unsupported by the evidence renderer';
        const sampler = asset.json.samplers?.[texture.sampler] ?? {};
        if (sampler.magFilter === 9728 || [9728, 9984, 9986].includes(sampler.minFilter)) reason = 'nearest filtering is unsupported by the evidence renderer';
      } else visit(child, slot, materialIndex);
    }
  };
  for (let i = 0; i < materials.length; i++) visit(materials[i], '', i);
  if (!used.size) return 'unused image retained exactly';
  if (reason) return reason;
  for (const i of used) {
    const material = materials[i];
    if (material.alphaMode === 'BLEND') reason = 'BLEND use retained exactly: finite fixed-order blending is insufficient';
    if (material.extensions && Object.keys(material.extensions).length) reason = 'material extensions are unsupported by the evidence renderer';
  }
  if (reason) return reason;
  let referenced = false;
  for (const mesh of asset.json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    if (!used.has(primitive.material)) continue;
    referenced = true;
    const texCoord = materials[primitive.material].pbrMetallicRoughness.baseColorTexture.texCoord ?? 0;
    if ((primitive.mode ?? 4) !== 4 || primitive.attributes?.[`TEXCOORD_${texCoord}`] === undefined) reason = 'unsupported topology or missing base-color UV';
  }
  return reason ?? (referenced ? null : 'no geometry references this image');
}

/** evaluate must compare candidate bytes to the original source with the same
 * geometry/poses/cameras and emit the declared finite views. imageIndex selects
 * isolated affected draws (without occlusion by unrelated materials), null the
 * final complete scene. Every candidate and the combined output are gated. */
export async function optimizeAppearanceTextures(
  input: NormalizedAsset,
  evaluate: (candidate: NormalizedAsset, imageIndex: number | null) => Promise<AppearanceSample[]>,
  options: { limits?: Partial<AppearanceLimits>; maxRgbaRmse?: number } = {},
): Promise<{ asset: NormalizedAsset; report: AppearanceReport }> {
  const started = performance.now(), asset = structuredClone(input), limits = { ...APPEARANCE_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid appearance limit ${key}`);
  const textureLimits = { maxRgbaRmse: options.maxRgbaRmse ?? 18, maxRgbaError: 255, maxAlphaRmse: 8, maxAlphaError: 64, maxNormalAngleDegrees: 12, maxAlphaCoverageError: .01 };
  const report: AppearanceReport = {
    mode: 'finite-base-color-experiment', measurement: 'Finite CPU base-color samples only; perspective UV, level-zero bilinear sRGB textures, factors, vertex color, alpha masking and culling. No lighting, normal/metallic/roughness/emissive/occlusion shading, mipmaps, anisotropy, GPU, all-view or continuous-time equivalence. Non-base-color and unsupported image uses retained exactly. Existing source-texel RGBA/alpha/normal/coverage gates also apply.',
    limits, textureLimits, ladder: APPEARANCE_LADDER.map(x => ({ ...x })), sourceBytes: input.images.reduce((n, x) => n + x.data.length, 0), outputBytes: 0, savedBytes: 0, changedImages: 0, encodedCandidates: 0, images: [], finalSamples: [], finalAccepted: true, finalReason: 'unchanged source returned; no final rendered gate needed', seconds: { texture: 0, render: 0, total: 0 },
  };
  for (let imageIndex = 0; imageIndex < input.images.length; imageIndex++) {
    const original = input.images[imageIndex]!, unsupported = appearanceEligibility(input, imageIndex);
    const entry: AppearanceImageReport = { imageIndex, sourceBytes: original.data.length, outputBytes: original.data.length, changed: false, reason: unsupported ?? 'no candidate passes every bound', winner: null, candidates: [] };
    report.images.push(entry);
    if (unsupported) continue;
    // Isolate the image while retaining all material uses for alpha/normal gates.
    // Source dimensions and each candidate always refer to original source bytes.
    const isolated = { ...input, images: [original], json: { ...input.json, images: [input.json.images?.[imageIndex] ?? {}], textures: (input.json.textures ?? []).map((t: any) => ({ ...t, source: t.source === imageIndex ? 0 : -1 })) } };
    let bestBytes = original.data.length;
    for (const rung of APPEARANCE_LADDER) {
      const textureStart = performance.now();
      const optimized = optimizeTextures(isolated, { mode: 'lossy', ...rung, maxCandidates: 1, ...textureLimits });
      const textureSeconds = (performance.now() - textureStart) / 1000, texture = optimized.report.images[0]!;
      const candidate: AppearanceCandidate = { ...rung, texture, samples: [], accepted: false, reason: texture.reason, seconds: { texture: textureSeconds, render: 0 } };
      entry.candidates.push(candidate); report.encodedCandidates += texture.candidates.length; report.seconds.texture += textureSeconds;
      if (!texture.changed) continue;
      if (texture.outputBytes >= bestBytes) { candidate.reason = 'not smaller than the best accepted candidate'; continue; }
      const changed = { ...asset, images: asset.images.slice(), json: structuredClone(asset.json) };
      changed.images[imageIndex] = optimized.asset.images[0]!;
      if (changed.json.images?.[imageIndex]) changed.json.images[imageIndex].mimeType = changed.images[imageIndex]!.mimeType;
      const renderStart = performance.now();
      try { candidate.samples = await evaluate(changed, imageIndex); candidate.reason = appearanceRejection(candidate.samples, limits) ?? 'passes source-texel and finite rendered-view gates'; candidate.accepted = appearanceRejection(candidate.samples, limits) === null; }
      catch (error) { candidate.reason = `render evidence failed: ${error instanceof Error ? error.message : String(error)}`; }
      candidate.seconds.render = (performance.now() - renderStart) / 1000; report.seconds.render += candidate.seconds.render;
      if (candidate.accepted) {
        asset.images[imageIndex] = changed.images[imageIndex]!; asset.json.images = changed.json.images;
        entry.changed = true; entry.outputBytes = texture.outputBytes; entry.winner = entry.candidates.length - 1; entry.reason = 'smallest bounded candidate passing both gates'; bestBytes = texture.outputBytes;
      }
    }
  }
  if (report.images.some(x => x.changed)) {
    const renderStart = performance.now();
    try { report.finalSamples = await evaluate(asset, null); const rejection = appearanceRejection(report.finalSamples, limits); report.finalAccepted = rejection === null; report.finalReason = rejection ?? 'combined output passes finite rendered-view gates'; }
    catch (error) { report.finalAccepted = false; report.finalReason = `render evidence failed: ${error instanceof Error ? error.message : String(error)}`; }
    report.seconds.render += (performance.now() - renderStart) / 1000;
  }
  const output = report.finalAccepted ? asset : structuredClone(input);
  if (!report.finalAccepted) for (const entry of report.images) { entry.changed = false; entry.outputBytes = entry.sourceBytes; entry.winner = null; entry.reason = 'combined rendered-view gate failed; all image changes rolled back'; }
  report.outputBytes = output.images.reduce((n, image) => n + image.data.length, 0); report.savedBytes = report.sourceBytes - report.outputBytes;
  report.changedImages = report.images.filter(x => x.changed).length;
  output.validation.imageBytes = report.outputBytes; output.validation.decodedBytes = input.validation.decodedBytes - report.savedBytes;
  report.seconds.total = (performance.now() - started) / 1000;
  return { asset: output, report };
}
