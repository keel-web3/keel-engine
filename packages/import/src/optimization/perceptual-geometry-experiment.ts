/** Existing-vertex triangle reduction. meshoptimizer is import-time only.
 * Reference: https://github.com/zeux/meshoptimizer/blob/v0.25/js/README.md#simplifier
 * The error gate uses fixed bidirectional surface correspondences at finitely
 * sampled poses. It is not a continuous animation, Hausdorff or screen-space bound.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import type { NormalizedAsset, NormalizedAccessor, NativeArray } from '../asset-normalize-v3.ts';
import { evaluateGeometryPoses } from './geometry-pose.ts';
import { surfaceBVH, surfacePosition, surfaceSamples } from './geometry-search.ts';
import type { SurfacePoint } from './geometry-search.ts';

/**
 * EXPERIMENTAL LOSSY appearance-aware existing-vertex simplification.
 * Two fixed candidates only. Shading/UV seam locks are relaxed; meshoptimizer's
 * topology handling plus the supplied visual gate decides whether the result is
 * usable. Border, deformation/custom-stream discontinuities and rest-degenerate
 * triangles stay protected. No source normals, UVs, skin weights or morph deltas
 * are regenerated. Changed interpolation is lossy, even with exact vertex rows.
 *
 * This module is deliberately separate from the frozen conservative optimizer.
 * The mandatory host visual gate must compare source/candidate at deterministic
 * camera and pose samples. CPU base-color evidence does not prove PBR/GPU parity.
 */
export type PerceptualGeometryCandidate = 'relaxed' | 'permissive';
export interface PerceptualVisualGateResult { accepted: boolean; reason: string; evidence?: unknown }
export interface PerceptualGeometryOptions {
  candidate: PerceptualGeometryCandidate;
  visualGate: (source: NormalizedAsset, candidate: NormalizedAsset) => PerceptualVisualGateResult | Promise<PerceptualVisualGateResult>;
}
function simplifierFlags(candidate: PerceptualGeometryCandidate): Parameters<typeof MeshoptSimplifier.simplifyWithAttributes>[9] {
  // meshoptimizer 0.25's implementation exports Permissive; its bundled .d.ts
  // omits that flag. Pin this experiment to that installed version.
  return (candidate === 'permissive' ? ['ErrorAbsolute', 'LockBorder', 'Permissive'] : ['ErrorAbsolute', 'LockBorder']) as Parameters<typeof MeshoptSimplifier.simplifyWithAttributes>[9];
}
function protectedDiscontinuities(asset: NormalizedAsset, primitive: any): Map<number, NormalizedAccessor> {
  const result = new Map<number, NormalizedAccessor>();
  for (const [semantic, id] of Object.entries(primitive.attributes ?? {})) {
    if (!/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/.test(semantic)) result.set(id as number, asset.accessors[id as number]!);
  }
  for (const target of primitive.targets ?? []) for (const id of Object.values(target)) result.set(id as number, asset.accessors[id as number]!);
  return result;
}

const GEOMETRY_OPTIMIZER_VERSION = 'keel-perceptual-geometry-experiment-0.1.0';
interface GeometryOptions {
  candidate: PerceptualGeometryCandidate;
  attributeWeight: number;
  mode?: 'lossless' | 'bounded-lossy';
  targetRatio?: number;
  /** Fraction of the base bounding-box diagonal; also gates each sampled pose
   * relative to that pose's bounding-box diagonal, including every mesh instance. */
  maxError?: number;
  /** Additional hard limit in each evaluated coordinate system, if supplied. */
  maxAbsoluteError?: number;
  samplesPerClip?: number;
  maxSurfaceSamples?: number;
  /** Keep material/primitive borders fixed. Defaults true. */
  lockBorder?: boolean;
  /** Less aggressive target retries when the sampled deformation gate rejects. */
  maxAttempts?: number;
}
interface GeometryError {
  pose: string; sampleCount: number; maxError: number; rmsError: number;
  relativeMaxError: number; boundsDiagonal: number; allowedError: number;
}
interface GeometryPrimitiveReport {
  mesh: number; primitive: number; applied: boolean; reason: string;
  originalTriangles: number; outputTriangles: number; originalVertices: number; outputVertices: number;
  targetTriangles: number; simplifierError: number; lockedSeamVertices: number;
  preservedDegenerateTriangles: number;
  sampledErrors: GeometryError[]; appearanceErrors?: ReturnType<typeof sampledAppearance>; correspondenceIndex: number | null;
  attempts: Array<{ targetTriangles: number; outputTriangles: number; accepted: boolean; reason: string }>;
  metricAttributes: string[]; warnings: string[];
}
interface GeometryCorrespondence {
  mesh: number; primitive: number;
  /** Output vertex index -> original vertex index. Every attribute and morph
   * value at an output vertex is a byte-exact sample from this source vertex. */
  retainedSourceVertices: Uint32Array;
  samples: Array<{ source: SurfacePoint; candidate: SurfacePoint; direction: 'source-to-candidate' | 'candidate-to-source' }>;
  /** Both sample vertex lists refer to ORIGINAL vertices, so a source pose
   * evaluator suffices to validate the changed topology without nearest rematches. */
  coordinates: 'original-vertex-indices';
}
const arity: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const fail = (s: string): never => { throw Error('Geometry optimizer: ' + s); };
function bound(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) fail('invalid ' + name); return value;
}
function dimensions(p: Float32Array): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { const k = i % 3, v = p[i]!; if (!Number.isFinite(v)) fail('nonfinite evaluated position'); lo[k] = Math.min(lo[k]!, v); hi[k] = Math.max(hi[k]!, v); }
  return p.length ? Math.hypot(...hi.map((x, k) => x - lo[k]!)) : 0;
}
function numberAt(a: NormalizedAccessor, i: number): number {
  const v = a.array[i]!;
  if (!a.normalized) return v;
  switch (a.componentType) { case 5120: return Math.max(-1, v / 127); case 5121: return v / 255; case 5122: return Math.max(-1, v / 32767); case 5123: return v / 65535; default: return v; }
}
function degenerate(p: Float32Array, indices: Uint32Array): boolean {
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    if (a === b || a === c || b === c) return true;
    const x = p[b]! - p[a]!, y = p[b + 1]! - p[a + 1]!, z = p[b + 2]! - p[a + 2]!;
    const u = p[c]! - p[a]!, v = p[c + 1]! - p[a + 1]!, w = p[c + 2]! - p[a + 2]!;
    if (Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u) === 0) return true;
  }
  return false;
}
function references(json: any, visit: (object: any, key: string) => void): void {
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    if (primitive.indices !== undefined) visit(primitive, 'indices');
    for (const key of Object.keys(primitive.attributes ?? {})) visit(primitive.attributes, key);
    for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) visit(target, key);
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) visit(skin, 'inverseBindMatrices');
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers ?? []) { visit(sampler, 'input'); visit(sampler, 'output'); }
}
function metadata(a: NormalizedAccessor, prior: any = {}): any {
  const out = { ...prior, componentType: a.componentType, type: a.type, count: a.count };
  delete out.bufferView; delete out.byteOffset; delete out.sparse;
  if (a.normalized) out.normalized = true; else delete out.normalized;
  if (prior.min || prior.max) {
    const n = arity[a.type]!, min = new Array<number>(n).fill(Infinity), max = new Array<number>(n).fill(-Infinity);
    for (let i = 0; i < a.array.length; i++) { min[i % n] = Math.min(min[i % n]!, a.array[i]!); max[i % n] = Math.max(max[i % n]!, a.array[i]!); }
    if (prior.min) out.min = min; if (prior.max) out.max = max;
  }
  return out;
}
function hasExtensions(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.extensions && Object.keys(value.extensions).length) return true;
  return Object.entries(value).some(([key, child]) => key !== 'extras' && hasExtensions(child));
}
function primitiveInput(asset: NormalizedAsset, primitive: any) {
  if ((primitive.mode ?? 4) !== 4) throw Error('non-triangle-list primitive is retained');
  const position = asset.accessors[primitive.attributes?.POSITION];
  if (!position || position.type !== 'VEC3' || position.componentType !== 5126 || position.normalized || !(position.array instanceof Float32Array)) throw Error('unsupported POSITION representation');
  const count = position.count, positions = position.array;
  if (!Number.isSafeInteger(count) || count < 3 || positions.length !== count * 3) throw Error('empty or malformed position stream');
  const streams = new Map<number, NormalizedAccessor>();
  for (const group of [primitive.attributes, ...(primitive.targets ?? [])]) for (const [semantic, id] of Object.entries(group ?? {})) {
    const a = asset.accessors[id as number], n = a && arity[a.type];
    if (!a || !n || a.count !== count || a.array.length !== count * n || a.array.some(x => !Number.isFinite(x))) throw Error('unsupported or malformed vertex stream ' + semantic);
    streams.set(id as number, a);
  }
  for (const target of primitive.targets ?? []) for (const [semantic, id] of Object.entries(target)) {
    const a = asset.accessors[id as number]!;
    if (!['POSITION', 'NORMAL', 'TANGENT'].includes(semantic) || a.type !== 'VEC3' || a.componentType !== 5126) throw Error('unsupported morph target stream ' + semantic);
  }
  let indices: Uint32Array;
  if (primitive.indices === undefined) indices = Uint32Array.from({ length: count }, (_, i) => i);
  else {
    const a = asset.accessors[primitive.indices];
    if (!a || a.type !== 'SCALAR' || a.normalized || ![5121, 5123, 5125].includes(a.componentType) || a.array.length !== a.count) throw Error('unsupported index representation');
    indices = new Uint32Array(a.array);
  }
  if (indices.length < 3 || indices.length % 3 || indices.some(i => i >= count)) throw Error('malformed triangle indices');
  // A rest-degenerate triangle can become visible under a morph or skin pose.
  // Keep it verbatim, lock its vertices, and simplify the remaining surface.
  const valid: number[] = [], protectedIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) { const destination = degenerate(positions, indices.subarray(i, i + 3)) ? protectedIndices : valid; destination.push(indices[i]!, indices[i + 1]!, indices[i + 2]!); }
  if (!valid.length) throw Error('all source triangles are degenerate; retained unchanged');
  dimensions(positions);
  return { positions, indices: new Uint32Array(valid), protectedIndices: new Uint32Array(protectedIndices), count, streams };
}
function seamLocks(positions: Float32Array, streams: Map<number, NormalizedAccessor>): Uint8Array {
  const count = positions.length / 3, locks = new Uint8Array(count), groups = new Map<string, number[]>();
  for (let v = 0; v < count; v++) { const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`; const group = groups.get(key); if (group) group.push(v); else groups.set(key, [v]); }
  for (const vertices of groups.values()) {
    if (vertices.length < 2) continue;
    const first = vertices[0]!;
    const discontinuity = vertices.slice(1).some(v => [...streams.values()].some(a => {
      const n = arity[a.type]!; for (let k = 0; k < n; k++) if (!Object.is(a.array[first * n + k], a.array[v * n + k])) return true; return false;
    }));
    if (discontinuity) for (const v of vertices) locks[v] = 1;
  }
  return locks;
}
/** Welding is allowed only across byte-identical complete vertex records,
 * including joints, weights, custom attributes and every morph delta. */
function weldExactVertices(indices: Uint32Array, streams: Map<number, NormalizedAccessor>, count: number): Uint32Array {
  const fields = [...streams.values()].map(a => ({ bytes: new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength), stride: arity[a.type]! * a.array.BYTES_PER_ELEMENT }));
  const buckets = new Map<number, number[]>(), remap = new Uint32Array(count);
  for (let v = 0; v < count; v++) {
    let hash = 2166136261;
    for (const { bytes, stride } of fields) for (let k = 0; k < stride; k++) hash = Math.imul(hash ^ bytes[v * stride + k]!, 16777619);
    const bucket = buckets.get(hash) ?? [];
    const match = bucket.find(other => fields.every(({ bytes, stride }) => { for (let k = 0; k < stride; k++) if (bytes[v * stride + k] !== bytes[other * stride + k]) return false; return true; }));
    remap[v] = match ?? v;
    if (match === undefined) { bucket.push(v); buckets.set(hash, bucket); }
  }
  return Uint32Array.from(indices, v => remap[v]!);
}
function metricStreams(asset: NormalizedAsset, primitive: any, count: number, scale: number, attributeWeight: number) {
  const fields: Array<{ name: string; accessor: NormalizedAccessor; width: number; weight: number }> = [];
  let width = 0;
  const add = (name: string, id: number, weight: number) => { const a = asset.accessors[id]!, n = arity[a.type]!; if (width + n <= 32) { fields.push({ name, accessor: a, width: n, weight }); width += n; } };
  for (const semantic of Object.keys(primitive.attributes).sort()) if (/^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/.test(semantic)) add(semantic, primitive.attributes[semantic], attributeWeight);
  for (let i = 0; i < (primitive.targets ?? []).length; i++) for (const semantic of Object.keys(primitive.targets[i]).sort()) add(`morph${i}.${semantic}`, primitive.targets[i][semantic], semantic === 'POSITION' ? 1 / Math.max(scale, 1e-30) : 1);
  const array = new Float32Array(count * width), weights: number[] = [];
  let offset = 0;
  for (const field of fields) { for (let k = 0; k < field.width; k++) weights.push(field.weight); for (let v = 0; v < count; v++) for (let k = 0; k < field.width; k++) array[v * width + offset + k] = numberAt(field.accessor, v * field.width + k); offset += field.width; }
  return { array, weights, width, names: fields.map(f => f.name) };
}
function validateCorrespondence(positions: Float32Array, source: Uint32Array, output: Uint32Array, limit: number, poses: Array<{ name: string; positions: Float32Array }>, maxError: number, maxAbsoluteError: number) {
  const closestSource = surfaceBVH(positions, source), closestCandidate = surfaceBVH(positions, output);
  const samples: GeometryCorrespondence['samples'] = [];
  for (const point of surfaceSamples(source, limit)) samples.push({ source: point, candidate: closestCandidate(surfacePosition(positions, point)), direction: 'source-to-candidate' });
  for (const point of surfaceSamples(output, limit)) samples.push({ source: closestSource(surfacePosition(positions, point)), candidate: point, direction: 'candidate-to-source' });
  const errors: GeometryError[] = [];
  for (const pose of [{ name: 'base mesh coordinates', positions }, ...poses]) {
    const diagonal = dimensions(pose.positions), allowed = Math.min(diagonal * maxError, maxAbsoluteError);
    let max = 0, sum = 0;
    for (const pair of samples) { const a = surfacePosition(pose.positions, pair.source), b = surfacePosition(pose.positions, pair.candidate), distance = Math.hypot(...a.map((v, k) => v - b[k]!)); max = Math.max(max, distance); sum += distance * distance; }
    errors.push({ pose: pose.name, sampleCount: samples.length, maxError: max, rmsError: Math.sqrt(sum / samples.length), relativeMaxError: diagonal ? max / diagonal : max === 0 ? 0 : Infinity, boundsDiagonal: diagonal, allowedError: allowed });
  }
  return { samples, errors, accepted: errors.every(e => Number.isFinite(e.maxError) && e.maxError <= e.allowedError + Math.max(e.boundsDiagonal * 1e-12, 1e-12)) };
}

/** Local-space rest-surface interpolation diagnostic, not skinned lighting. */
function sampledAppearance(asset: NormalizedAsset, primitive: any, pairs: GeometryCorrespondence['samples']) {
  const report: Record<string, { samples: number; rmsDegrees: number; p95Degrees: number; maxDegrees: number; handednessMismatches: number }> = {};
  for (const semantic of ['NORMAL', 'TANGENT']) {
    const id = primitive.attributes[semantic]; if (id === undefined) continue;
    const a = asset.accessors[id]!, width = arity[a.type]!;
    if (width < 3) continue;
    const angles: number[] = []; let sum = 0, handednessMismatches = 0;
    const interpolate = (point: SurfacePoint, component: number) => point.vertices.reduce((v, vertex, k) => v + numberAt(a, vertex * width + component) * point.weights[k]!, 0);
    for (const pair of pairs) {
      const source = [0, 1, 2].map(k => interpolate(pair.source, k)), candidate = [0, 1, 2].map(k => interpolate(pair.candidate, k));
      const den = Math.hypot(...source) * Math.hypot(...candidate);
      const angle = den > 1e-20 ? Math.acos(Math.max(-1, Math.min(1, source.reduce((v, x, k) => v + x * candidate[k]!, 0) / den))) * 180 / Math.PI : 180;
      angles.push(angle); sum += angle * angle;
      if (semantic === 'TANGENT' && width === 4 && Math.sign(interpolate(pair.source, 3)) !== Math.sign(interpolate(pair.candidate, 3))) handednessMismatches++;
    }
    angles.sort((a, b) => a - b);
    report[semantic] = { samples: angles.length, rmsDegrees: Math.sqrt(sum / Math.max(1, angles.length)), p95Degrees: angles[Math.min(angles.length - 1, Math.floor(angles.length * .95))] ?? 0, maxDegrees: angles.at(-1) ?? 0, handednessMismatches };
  }
  return report;
}

async function constructCandidate(asset: NormalizedAsset, options: GeometryOptions) {
  const mode = options.mode ?? 'bounded-lossy';
  if (!['lossless', 'bounded-lossy'].includes(mode)) fail('invalid mode');
  const targetRatio = bound(options.targetRatio ?? .5, 'targetRatio', Number.EPSILON, 1), maxError = bound(options.maxError ?? .01, 'maxError', 0, 1);
  const maxAbsoluteError = options.maxAbsoluteError === undefined ? Infinity : bound(options.maxAbsoluteError, 'maxAbsoluteError', 0, Number.MAX_VALUE);
  const samplesPerClip = bound(options.samplesPerClip ?? 5, 'samplesPerClip', 2, 64), maxSurfaceSamples = bound(options.maxSurfaceSamples ?? 2048, 'maxSurfaceSamples', 8, 65536), maxAttempts = bound(options.maxAttempts ?? 3, 'maxAttempts', 1, 8);
  if (![samplesPerClip, maxSurfaceSamples, maxAttempts].every(Number.isInteger)) fail('sample and attempt counts must be integers');
  const normalized: NormalizedAsset = { ...asset, json: structuredClone(asset.json), sourceJson: structuredClone(asset.sourceJson), accessors: asset.accessors.map(a => ({ ...a, array: a.array.slice() as NativeArray })), images: asset.images.map(i => ({ ...i, data: i.data.slice() })), validation: structuredClone(asset.validation), source: structuredClone(asset.source), runtime: structuredClone(asset.runtime) };
  const metrics: GeometryPrimitiveReport[] = [], correspondence: GeometryCorrespondence[] = [];
  let surfaceQAMilliseconds = 0;
  const generated: Array<{ source: number | null; value: NormalizedAccessor; metadata: any }> = [];
  const originalCount = asset.accessors.length;
  const append = (source: number | null, value: NormalizedAccessor) => { const id = originalCount + generated.length; generated.push({ source, value, metadata: metadata(value, source === null ? {} : asset.json.accessors?.[source]) }); return id; };
  const opaque = hasExtensions(asset.json) || (asset.json.extensionsUsed ?? []).length > 0 || (asset.json.extensionsRequired ?? []).length > 0;
  if (mode !== 'lossless' && targetRatio < 1 && !opaque) { if (!MeshoptSimplifier.supported) fail('WebAssembly mesh simplifier is unavailable'); await MeshoptSimplifier.ready; }
  for (let mi = 0; mi < (asset.json.meshes ?? []).length; mi++) for (let pi = 0; pi < asset.json.meshes[mi].primitives.length; pi++) {
    const primitive = asset.json.meshes[mi].primitives[pi], originalPosition = asset.accessors[primitive.attributes?.POSITION], originalIndex = asset.accessors[primitive.indices];
    const originalTriangles = (primitive.mode ?? 4) === 4 ? Math.floor((originalIndex?.count ?? originalPosition?.count ?? 0) / 3) : 0;
    const metric: GeometryPrimitiveReport = { mesh: mi, primitive: pi, applied: false, reason: '', originalTriangles, outputTriangles: originalTriangles, originalVertices: originalPosition?.count ?? 0, outputVertices: originalPosition?.count ?? 0, targetTriangles: Math.max(1, Math.floor(originalTriangles * targetRatio)), simplifierError: 0, lockedSeamVertices: 0, preservedDegenerateTriangles: 0, sampledErrors: [], correspondenceIndex: null, attempts: [], metricAttributes: [], warnings: [] };
    metrics.push(metric);
    if (mode === 'lossless' || targetRatio === 1) { metric.reason = mode === 'lossless' ? 'lossless mode bypasses triangle removal' : 'targetRatio is one'; continue; }
    if (opaque) { metric.reason = 'opaque extension accessor/vertex references cannot be safely remapped'; continue; }
    const generatedStart = generated.length;
    try {
      const input = primitiveInput(asset, primitive), scale = dimensions(input.positions), locks = seamLocks(input.positions, protectedDiscontinuities(asset, primitive));
      const weldedIndices = weldExactVertices(input.indices, input.streams, input.count);
      metric.lockedSeamVertices = locks.reduce((n, v) => n + v, 0);
      metric.preservedDegenerateTriangles = input.protectedIndices.length / 3;
      for (const v of input.protectedIndices) locks[v] = 1;
      if (input.protectedIndices.length) metric.warnings.push('Rest-degenerate triangles are retained verbatim and their vertices locked; morph or skin poses can make them visible.');
      const attributes = metricStreams(asset, primitive, input.count, scale, options.attributeWeight); metric.metricAttributes = attributes.names;
      const poseStarted = performance.now();
      const poses = evaluateGeometryPoses(asset, mi, primitive, { samplesPerClip });
      surfaceQAMilliseconds += performance.now() - poseStarted;
      let selected: { indices: Uint32Array; error: number; checked: ReturnType<typeof validateCorrespondence> } | undefined;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const ratio = 1 - (1 - targetRatio) / 2 ** attempt, target = Math.max(3, Math.floor(originalTriangles * ratio) * 3 - input.protectedIndices.length);
        if (target >= input.indices.length) break;
        const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(weldedIndices, input.positions, 3, attributes.array, attributes.width, attributes.weights, locks, target, Math.min(scale * maxError, maxAbsoluteError), simplifierFlags(options.candidate));
        if (indices.length >= input.indices.length || !indices.length) { metric.attempts.push({ targetTriangles: target / 3 + metric.preservedDegenerateTriangles, outputTriangles: indices.length / 3 + metric.preservedDegenerateTriangles, accepted: false, reason: 'topology, seams or error budget prevents reduction' }); break; }
        if (degenerate(input.positions, indices)) { metric.attempts.push({ targetTriangles: target / 3, outputTriangles: indices.length / 3, accepted: false, reason: 'candidate contains a degenerate triangle' }); continue; }
        const validationStarted = performance.now();
        const checked = validateCorrespondence(input.positions, input.indices, indices, maxSurfaceSamples, poses, maxError, maxAbsoluteError);
        surfaceQAMilliseconds += performance.now() - validationStarted;
        metric.attempts.push({ targetTriangles: target / 3 + metric.preservedDegenerateTriangles, outputTriangles: indices.length / 3 + metric.preservedDegenerateTriangles, accepted: checked.accepted, reason: checked.accepted ? 'sampled rest and animation correspondence passes' : 'sampled deformation error exceeds budget' });
        metric.sampledErrors = checked.errors;
        if (checked.accepted) { selected = { indices, error, checked }; break; }
      }
      if (!selected) { metric.reason = metric.attempts.at(-1)?.reason ?? 'too few triangles to reduce'; continue; }
      const selectedIndices = new Uint32Array(selected.indices.length + input.protectedIndices.length);
      selectedIndices.set(selected.indices); selectedIndices.set(input.protectedIndices, selected.indices.length);
      const retained = Uint32Array.from([...new Set(selectedIndices)].sort((a, b) => a - b)), remap = new Uint32Array(input.count);
      retained.forEach((v, i) => { remap[v] = i; });
      const target = structuredClone(primitive), accessorIds = new Map<number, number>();
      for (const [id, a] of input.streams) {
        const n = arity[a.type]!, array = new (a.array.constructor as { new(length: number): NativeArray })(retained.length * n);
        for (let i = 0; i < retained.length; i++) array.set(a.array.subarray(retained[i]! * n, (retained[i]! + 1) * n), i * n);
        accessorIds.set(id, append(id, { ...a, count: retained.length, array }));
      }
      for (const group of [target.attributes, ...(target.targets ?? [])]) for (const key of Object.keys(group)) group[key] = accessorIds.get(group[key])!;
      const array = retained.length <= 65535 ? new Uint16Array(selectedIndices.length) : new Uint32Array(selectedIndices.length);
      selectedIndices.forEach((v, i) => { array[i] = remap[v]!; });
      target.indices = append(primitive.indices ?? null, { sourceIndex: originalIndex?.sourceIndex ?? -1, type: 'SCALAR', componentType: array instanceof Uint16Array ? 5123 : 5125, normalized: false, count: array.length, array });
      normalized.json.meshes[mi].primitives[pi] = target;
      metric.applied = true; metric.reason = 'existing-vertex simplification passed finite rest/animation surface checks'; metric.outputTriangles = array.length / 3; metric.outputVertices = retained.length; metric.simplifierError = selected.error; metric.sampledErrors = selected.checked.errors;
      const appearanceStarted = performance.now();
      metric.appearanceErrors = sampledAppearance(asset, primitive, selected.checked.samples);
      surfaceQAMilliseconds += performance.now() - appearanceStarted;
      metric.correspondenceIndex = correspondence.length;
      correspondence.push({ mesh: mi, primitive: pi, retainedSourceVertices: retained, samples: selected.checked.samples, coordinates: 'original-vertex-indices' });
    } catch (error) { generated.length = generatedStart; normalized.json.meshes[mi].primitives[pi] = structuredClone(primitive); metric.applied = false; metric.outputTriangles = originalTriangles; metric.outputVertices = originalPosition?.count ?? 0; metric.reason = 'retained original: ' + (error instanceof Error ? error.message : String(error)); }
  }
  // Reuse an original slot only when no unmodified semantic still references it.
  // Aliases in other primitives, animation, skinning or morph targets keep their
  // original data/index; each changed primitive receives independent new storage.
  const stillUsed = new Set<number>(); references(normalized.json, (o, k) => { if (o[k] < originalCount) stillUsed.add(o[k]); });
  const slotMap = new Map<number, number>(), reused = new Set<number>();
  const jsonAccessors = structuredClone(asset.json.accessors ?? asset.accessors.map(a => metadata(a)));
  for (let i = 0; i < generated.length; i++) {
    const item = generated[i]!, reuse = item.source !== null && !stillUsed.has(item.source) && !reused.has(item.source);
    const slot = reuse ? item.source! : normalized.accessors.length;
    if (reuse) reused.add(slot);
    normalized.accessors[slot] = item.value; jsonAccessors[slot] = item.metadata; slotMap.set(originalCount + i, slot);
  }
  references(normalized.json, (o, k) => { if (slotMap.has(o[k])) o[k] = slotMap.get(o[k]); });
  if (asset.json.accessors !== undefined || jsonAccessors.length) normalized.json.accessors = jsonAccessors;
  if (generated.length) {
    normalized.validation.accessorCount = normalized.accessors.length;
    normalized.validation.decodedBytes = normalized.accessors.reduce((n, a) => n + a.array.byteLength, 0) + normalized.images.reduce((n, i) => n + i.data.byteLength, 0);
  }
  const report = { version: GEOMETRY_OPTIMIZER_VERSION, mode, simplifier: 'meshoptimizer@0.25.0', settings: { candidate: options.candidate, attributeWeight: options.attributeWeight, targetRatio, maxError, maxAbsoluteError: Number.isFinite(maxAbsoluteError) ? maxAbsoluteError : null, samplesPerClip, maxSurfaceSamples, maxAttempts, lockBorder: options.lockBorder !== false }, metrics, originalTriangles: metrics.reduce((n, m) => n + m.originalTriangles, 0), outputTriangles: metrics.reduce((n, m) => n + m.outputTriangles, 0), changedPrimitives: metrics.filter(m => m.applied).length, warnings: ['Error is measured at finite deterministic bidirectional surface samples and clip times; it is not a continuous, all-surface or screen-space guarantee. Animation blending and arbitrary unanimated morph-weight combinations are not covered.', 'Retained vertices copy all source attributes and morph deltas exactly; removed vertices and changed triangle interpolation are explicitly lossy.', 'All source clips, channels, node transforms, rigs, materials and images are preserved; shared accessors are isolated before remapping.', 'Duplicate source animation timestamps, where present, use the last key at an exact timestamp for measurement; source clip data is unchanged.', 'No visibility, camera-dependent culling, disconnected-component pruning, or attribute regeneration is performed.'] };
  return { normalized, asset: normalized, report, correspondence, surfaceQAMilliseconds };
}

/** Both a failed gate and an unavailable/throwing gate return the exact input. */
export async function optimizePerceptualGeometry(asset: NormalizedAsset, options: PerceptualGeometryOptions) {
  if (!options || !['relaxed', 'permissive'].includes(options.candidate)) throw Error('Perceptual geometry experiment requires one of its two fixed candidates');
  const settings = options.candidate === 'relaxed' ? { targetRatio: .5, attributeWeight: .25 } : { targetRatio: .35, attributeWeight: .1 };
  const started = performance.now();
  const built = await constructCandidate(asset, { ...settings, candidate: options.candidate, maxError: .01, maxAttempts: 1, samplesPerClip: 5, maxSurfaceSamples: 2048, lockBorder: true });
  const constructionMilliseconds = performance.now() - started - built.surfaceQAMilliseconds;
  const qaStarted = performance.now();
  let visual: PerceptualVisualGateResult;
  try {
    visual = typeof options.visualGate === 'function' ? await options.visualGate(asset, built.normalized) : { accepted: false, reason: 'mandatory finite-view visual gate was not supplied' };
    if (!visual || typeof visual.accepted !== 'boolean' || typeof visual.reason !== 'string') visual = { accepted: false, reason: 'invalid visual gate response' };
  } catch (error) { visual = { accepted: false, reason: 'visual gate failed: ' + (error instanceof Error ? error.message : String(error)) }; }
  const accepted = visual.accepted && built.report.changedPrimitives > 0;
  return {
    normalized: accepted ? built.normalized : asset, asset: accepted ? built.normalized : asset,
    correspondence: accepted ? built.correspondence : [],
    report: { ...built.report, lossy: true, accepted, visual, constructionMilliseconds, surfaceQAMilliseconds: built.surfaceQAMilliseconds, visualQAMilliseconds: performance.now() - qaStarted,
      candidateOutputTriangles: built.report.outputTriangles, outputTriangles: accepted ? built.report.outputTriangles : built.report.originalTriangles,
      candidateChangedPrimitives: built.report.changedPrimitives, changedPrimitives: accepted ? built.report.changedPrimitives : 0,
      fallback: accepted ? null : 'exact input asset returned unchanged' },
  };
}
