/** Explicit fixed-material 3D approximation. The grid changes base positions;
 * flat shading removes normal/tangent streams. Skin, UV, color and POSITION morph
 * records remain exact at retained vertices. Animation samplers are never edited.
 * No camera or clip is baked, and the ordinary native/styled runtime is reused. */
import { normalizeAsset } from './asset-normalize-v3.ts';
import type { NormalizedAsset, NormalizedAccessor, NormalizeAssetInput, NativeArray } from './asset-normalize-v3.ts';
import { writeNativeGlb } from './asset-native-base-v3.ts';
import { compileAsset } from './asset-compiler-v6.ts';
import { compileStyledAsset } from './styled-asset-compiler.ts';
import { evaluateGeometryPoses } from './optimization/geometry-pose.ts';
import { weldExactVertices } from './optimization/geometry.ts';
import { prepareForceTargetGeometry } from './optimization/force-target-geometry.ts';
export { prepareForceTargetGeometry } from './optimization/force-target-geometry.ts';
export type { ForceTargetGeometrySettings, ForceTargetPrimitiveReport } from './optimization/force-target-geometry.ts';

export const PIXEL_MODEL_PRESETS = Object.freeze({
  small: Object.freeze({ gridCells: 16, maxError: .1, maxDimension: 128 as const, paletteSize: 8 as const }),
  balanced: Object.freeze({ gridCells: 32, maxError: .05, maxDimension: 256 as const, paletteSize: 16 as const }),
  detailed: Object.freeze({ gridCells: 64, maxError: .025, maxDimension: 512 as const, paletteSize: 32 as const }),
});
export interface PixelModelSettings {
  representation: 'model-3d';
  /** Explicit target-first mode bypasses grid/error fidelity gates. */
  geometry?: { policy: 'force-target'; targetTriangles: number };
  preset?: keyof typeof PIXEL_MODEL_PRESETS;
  quality?: { gridCells?: number; maxDimension?: number; paletteSize?: 8 | 16 | 32 | 64; maxError?: number; samplesPerClip?: number };
  name?: string;
  onProgress?: (event: { stage: string; done: number; total: number }) => void;
}
export interface ForceTargetSourceSettings {
  targetTriangles: number;
  name?: string;
  onProgress?: (event: { stage: string; done: number; total: number }) => void;
}
/** Style-independent target pass shared by Original, Pixel and Dither. Compile
 * directly from source on every invocation; never simplify a previous result. */
export async function compileForceTargetSourceAsset(input: ForceTargetSourceSettings & NormalizeAssetInput) {
  const started = performance.now();
  input.onProgress?.({ stage: 'force-target-source', done: 0, total: 1 });
  const source = await normalizeAsset(input), prepared = await prepareForceTargetGeometry(source, { targetTriangles: input.targetTriangles });
  input.onProgress?.({ stage: 'force-target-encode', done: 0, total: 1 });
  const data = writeNativeGlb(prepared.normalized.json, prepared.normalized.accessors.map(a => a.array), prepared.normalized.images);
  const native = await compileAsset({ entry: 'force-target.glb', files: [{ name: 'force-target.glb', data }], mode: 'lossless', onProgress: input.onProgress });
  const report = { representation: 'model-3d', mode: 'force-target', geometry: prepared.report, warnings: prepared.report.warnings };
  // "lossless" describes the final transport relative to the destructively
  // selected candidate, never the relationship to the uploaded source.
  const manifest = { ...native.manifest, mode: 'force-target', settings: { ...native.manifest.settings, geometry: { policy: 'force-target', targetTriangles: input.targetTriangles } }, passes: { ...native.manifest.passes, geometry: prepared.report }, validation: { ...native.manifest.validation, losslessSourceAccessorsExact: false, decodedCandidateExact: true, geometryScope: 'destructive hard-budget topology; exact retained source vertex records and all animation samples', fidelityGuaranteed: false }, warnings: [...prepared.report.warnings, ...native.manifest.warnings.filter((warning: string) => !warning.includes('All original decoded accessors are exact'))] };
  return { ...native, manifest, report, timings: { ...native.timings, total: performance.now() - started } };
}
const arity: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
function fail(s: string): never { throw Error('Pixel 3D: ' + s); }
function bounds(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { const k = i % 3, v = p[i]!; if (!Number.isFinite(v)) fail('nonfinite position'); min[k] = Math.min(min[k]!, v); max[k] = Math.max(max[k]!, v); }
  return { min, max, diagonal: Math.hypot(...max.map((v, k) => v - min[k]!)) };
}
function references(json: any, visit: (object: any, key: string) => void) {
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    if (p.indices !== undefined) visit(p, 'indices');
    for (const key of Object.keys(p.attributes)) visit(p.attributes, key);
    for (const t of p.targets ?? []) for (const key of Object.keys(t)) visit(t, key);
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) visit(s, 'inverseBindMatrices');
  for (const a of json.animations ?? []) for (const s of a.samplers) { visit(s, 'input'); visit(s, 'output'); }
}
/** Exported for independent pose/record validation before transport compilation. */
export function preparePixelModel(source: NormalizedAsset, settings: { gridCells: number; maxError: number; samplesPerClip: number }) {
  const { gridCells, maxError, samplesPerClip } = settings;
  if (!Number.isSafeInteger(gridCells) || gridCells < 8 || gridCells > 256) fail('gridCells must be an integer from 8 to 256');
  if (!Number.isFinite(maxError) || maxError < 0 || maxError > 1) fail('invalid maxError');
  if (!Number.isSafeInteger(samplesPerClip) || samplesPerClip < 2 || samplesPerClip > 64) fail('invalid samplesPerClip');
  // The normalizer admits Draco (already decoded) and texture transforms only;
  // neither has accessor references in this IR. Unknown extensions fail there.
  const normalized: NormalizedAsset = { ...source, json: structuredClone(source.json), accessors: source.accessors.slice() };
  const append = (a: NormalizedAccessor, prior: any = {}) => {
    const id = normalized.accessors.length;
    normalized.accessors.push(a);
    const metadata = { ...prior, type: a.type, componentType: a.componentType, count: a.count };
    delete metadata.bufferView; delete metadata.byteOffset; delete metadata.sparse;
    if (a.normalized) metadata.normalized = true; else delete metadata.normalized;
    if (prior.min || prior.max) {
      const width = arity[a.type]!, min = Array<number>(width).fill(Infinity), max = Array<number>(width).fill(-Infinity);
      for (let i = 0; i < a.array.length; i++) { const k = i % width; min[k] = Math.min(min[k]!, a.array[i]!); max[k] = Math.max(max[k]!, a.array[i]!); }
      if (prior.min) metadata.min = min; if (prior.max) metadata.max = max;
    }
    normalized.json.accessors.push(metadata); return id;
  };
  const reports: any[] = [];
  let removedShadingStreams = 0, removedTriangles = 0;
  for (let mi = 0; mi < (source.json.meshes ?? []).length; mi++) {
    const mesh = source.json.meshes[mi], grids = mesh.primitives.map((p: any) => {
      const a = source.accessors[p.attributes?.POSITION];
      if (!a || a.type !== 'VEC3' || !(a.array instanceof Float32Array) || !a.count || a.array.length !== a.count * 3) fail('unsupported POSITION');
      return bounds(a.array);
    });
    const origin = [0, 1, 2].map(k => Math.min(...grids.map((b: any) => b.min[k])));
    const extent = [0, 1, 2].map(k => Math.max(...grids.map((b: any) => b.max[k])) - origin[k]!);
    const step = Math.max(...extent) / gridCells;
    for (let pi = 0; pi < mesh.primitives.length; pi++) {
      const p = mesh.primitives[pi], out = normalized.json.meshes[mi].primitives[pi];
      if ((p.mode ?? 4) !== 4) fail('only triangle lists can use the geometry grid');
      const position = source.accessors[p.attributes.POSITION]!, count = position.count;
      const positions = Float32Array.from(position.array, (v, i) => step ? origin[i % 3]! + Math.round((v - origin[i % 3]!) / step) * step : v);
      out.attributes.POSITION = append({ ...position, array: positions }, source.json.accessors[p.attributes.POSITION]);
      for (const group of [out.attributes, ...(out.targets ?? [])]) for (const semantic of ['NORMAL', 'TANGENT']) if (group[semantic] !== undefined) { delete group[semantic]; removedShadingStreams++; }
      // Empty normal-only targets still occupy their original weight/name slot.
      for (const target of out.targets ?? []) if (!Object.keys(target).length) target.POSITION = append({ ...position, sourceIndex: -1, array: new Float32Array(count * 3) });
      const sourcePoses = evaluateGeometryPoses(source, mi, p, { samplesPerClip, allowFloatSkinWeightRoundoff: true });
      const outputPoses = evaluateGeometryPoses(normalized, mi, out, { samplesPerClip, allowFloatSkinWeightRoundoff: true });
      const errors = [{ name: 'base mesh coordinates', positions: position.array as Float32Array }, ...sourcePoses].map((pose, i) => {
        const candidate = i === 0 ? positions : outputPoses[i - 1]!.positions, diagonal = bounds(pose.positions).diagonal;
        let max = 0, sum = 0;
        for (let v = 0; v < count; v++) { const d = Math.hypot(...[0, 1, 2].map(k => pose.positions[v * 3 + k]! - candidate[v * 3 + k]!)); max = Math.max(max, d); sum += d * d; }
        const relativeMaxError = diagonal ? max / diagonal : max === 0 ? 0 : Infinity;
        if (!Number.isFinite(max) || max > diagonal * maxError + Math.max(diagonal * 1e-12, 1e-12)) fail(`grid exceeds sampled positional error budget at mesh ${mi}, primitive ${pi}, ${pose.name}; choose a finer grid or explicit larger maxError`);
        return { pose: pose.name, vertices: count, maxError: max, rmsError: Math.sqrt(sum / count), boundsDiagonal: diagonal, relativeMaxError };
      });
      const streams = new Map<number, NormalizedAccessor>();
      for (const group of [out.attributes, ...(out.targets ?? [])]) for (const id of Object.values(group) as number[]) {
        const a = normalized.accessors[id];
        if (!a || a.count !== count || !arity[a.type] || a.array.length !== count * arity[a.type]! || a.array.some(v => !Number.isFinite(v))) fail('malformed retained vertex stream');
        streams.set(id, a);
      }
      const index = p.indices === undefined ? Uint32Array.from({ length: count }, (_, i) => i) : new Uint32Array(source.accessors[p.indices]!.array);
      if (!index.length || index.length % 3 || index.some(v => v >= count)) fail('invalid triangle indices');
      const welded = weldExactVertices(index, streams, count), kept: number[] = [];
      for (let i = 0; i < welded.length; i += 3) {
        const a = welded[i]!, b = welded[i + 1]!, c = welded[i + 2]!;
        // Repeated complete records stay coincident for every skin/morph pose.
        // Merely collinear/rest-coincident vertices with different records stay.
        if (a !== b && a !== c && b !== c) kept.push(a, b, c);
      }
      if (!kept.length) fail('grid removes the entire primitive; choose a finer grid');
      removedTriangles += (index.length - kept.length) / 3;
      const retained = [...new Set(kept)].sort((a, b) => a - b), remap = new Map(retained.map((v, i) => [v, i]));
      const streamRemap = new Map<number, number>();
      for (const [id, a] of streams) {
        const width = arity[a.type]!, values = new (a.array.constructor as any)(retained.length * width) as NativeArray;
        for (let v = 0; v < retained.length; v++) values.set(a.array.subarray(retained[v]! * width, (retained[v]! + 1) * width), v * width);
        streamRemap.set(id, append({ ...a, count: retained.length, array: values }, normalized.json.accessors[id]));
      }
      for (const group of [out.attributes, ...(out.targets ?? [])]) for (const key of Object.keys(group)) group[key] = streamRemap.get(group[key]);
      out.indices = append({ sourceIndex: -1, type: 'SCALAR', componentType: retained.length <= 65536 ? 5123 : 5125, normalized: false, count: kept.length, array: retained.length <= 65536 ? Uint16Array.from(kept, v => remap.get(v)!) : Uint32Array.from(kept, v => remap.get(v)!) });
      reports.push({ mesh: mi, primitive: pi, gridStep: step, originalVertices: count, outputVertices: retained.length, originalTriangles: index.length / 3, outputTriangles: kept.length / 3, retainedSourceVertices: retained, sampledErrors: errors });
    }
  }
  const used = new Set<number>(); references(normalized.json, (o, k) => used.add(o[k]));
  const ids = [...used].sort((a, b) => a - b), map = new Map(ids.map((id, i) => [id, i]));
  references(normalized.json, (o, k) => { o[k] = map.get(o[k]); });
  normalized.accessors = ids.map(id => normalized.accessors[id]!);
  normalized.json.accessors = ids.map(id => normalized.json.accessors[id]);
  normalized.validation = { ...source.validation, accessorCount: ids.length, decodedBytes: normalized.accessors.reduce((n, a) => n + a.array.byteLength, 0) + normalized.images.reduce((n, i) => n + i.data.length, 0) };
  return { normalized, report: { settings, primitives: reports, removedShadingStreams, removedTriangles, animationSamplersUnchanged: true, positionMorphDeltasExactAtRetainedVertices: true, skinUvColorRecordsExactAtRetainedVertices: true, errors: 'All vertices, default pose and evenly spaced samples of every clip and mesh instance; finite sampling is not a continuous animation guarantee.' } };
}

export async function compilePixelModelSourceAsset(input: PixelModelSettings & NormalizeAssetInput) {
  const start = performance.now();
  if (input.representation !== 'model-3d') fail('choose model-3d representation explicitly');
  const preset = input.preset ?? 'balanced';
  if (!Object.hasOwn(PIXEL_MODEL_PRESETS, preset)) fail('unknown quality preset');
  if (input.quality && Object.keys(input.quality).some(k => !['gridCells', 'maxDimension', 'paletteSize', 'maxError', 'samplesPerClip'].includes(k))) fail('unknown quality control');
  const settings = { ...PIXEL_MODEL_PRESETS[preset], samplesPerClip: 5, ...input.quality };
  if (!Number.isSafeInteger(settings.maxDimension) || settings.maxDimension < 1 || ![8, 16, 32, 64].includes(settings.paletteSize)) fail('invalid texture quality');
  if (input.geometry) {
    if (input.geometry.policy !== 'force-target') fail('unknown geometry policy');
    const native = await compileForceTargetSourceAsset({ ...input, targetTriangles: input.geometry.targetTriangles });
    const styled = await compileStyledAsset({ packageBytes: native.packageBytes, style: { kind: 'pixel', pixelSize: 4, toneLevels: 8, screen: 'bayer4' }, texture: { maxDimension: settings.maxDimension, paletteSize: settings.paletteSize }, ...(input.name === undefined ? {} : { name: input.name }) });
    return { ...styled, report: { ...styled.report, representation: 'model-3d', fidelity: { freeCamera: true, allClipsRetained: true, rigRetained: true, positionMorphsRetained: true, shading: 'source records exact at retained vertices', sourceModelRetained: false, fidelityGuaranteed: false }, geometry: native.report.geometry, warnings: [...styled.report.warnings, ...native.report.warnings] }, timings: { ...styled.timings, total: performance.now() - start } };
  }
  input.onProgress?.({ stage: 'pixel-model-source', done: 0, total: 1 });
  const source = await normalizeAsset(input), prepared = preparePixelModel(source, settings);
  const glb = writeNativeGlb(prepared.normalized.json, prepared.normalized.accessors.map(a => a.array), prepared.normalized.images);
  // Approximation is complete. Exact-data encoding prevents a second vertex
  // remap or material-input prune from changing the validated correspondence.
  const native = await compileAsset({ entry: 'pixel-model.glb', files: [{ name: 'pixel-model.glb', data: glb }], mode: 'lossless', onProgress: input.onProgress });
  const styled = await compileStyledAsset({ packageBytes: native.packageBytes, style: { kind: 'pixel', pixelSize: 4, toneLevels: 8, screen: 'bayer4' }, texture: { maxDimension: settings.maxDimension, paletteSize: settings.paletteSize }, ...(input.name === undefined ? {} : { name: input.name }) });
  return { ...styled, report: { ...styled.report, representation: 'model-3d', fidelity: { freeCamera: true, allClipsRetained: true, rigRetained: true, positionMorphsRetained: true, shading: 'flat; base and morph normals/tangents removed', sourceModelRetained: false }, geometry: prepared.report, warnings: [...styled.report.warnings, 'Explicit geometry grid approximation with flat shading. POSITION morph deltas and animation samplers remain exact at retained vertices; normal/tangent morph shading is discarded.', 'Vertex/accessor identities, custom material edits and metadata that observes those identities are outside this fixed-material mode.'] }, timings: { ...styled.timings, total: performance.now() - start } };
}
