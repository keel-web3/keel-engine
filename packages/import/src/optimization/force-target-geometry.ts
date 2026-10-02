/** Explicit destructive triangle budget. There is no shape/error preservation
 * gate: simplify topology first, then prune spatially distributed triangles if
 * necessary. Every surviving vertex record and every animation sample is exact.
 * A budget counts stored mesh triangles, once per primitive, not draw instances. */
import { MeshoptSimplifier } from 'meshoptimizer';
import type { NormalizedAsset, NormalizedAccessor, NativeArray } from '../asset-normalize-v3.ts';
import { materialTextureInfos } from '../texture-transform.ts';

export interface ForceTargetGeometrySettings { targetTriangles: number }
export interface ForceTargetPrimitiveReport {
  mesh: number; primitive: number; outputPrimitive: number | null;
  originalTriangles: number; eligibleTriangles: number; targetTriangles: number; outputTriangles: number;
  originalVertices: number; outputVertices: number; retainedSourceVertices: number[];
  method: 'unchanged' | 'simplify' | 'spatial-prune' | 'removed';
  reason: string; removedDegenerateTriangles: number; simplifierError: number | null;
}
const arity: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
function fail(message: string): never { throw Error('Force target geometry: ' + message); }
function accessorReferences(json: any, visit: (object: any, key: string) => void) {
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) {
    if (p.indices !== undefined) visit(p, 'indices');
    for (const group of [p.attributes, ...(p.targets ?? [])]) for (const key of Object.keys(group)) visit(group, key);
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) visit(skin, 'inverseBindMatrices');
  for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { visit(sampler, 'input'); visit(sampler, 'output'); }
}
function triangleIndices(source: NormalizedAsset, p: any): Uint32Array | null {
  const mode = p.mode ?? 4;
  if (![4, 5, 6].includes(mode)) return null;
  const a = source.accessors[p.attributes.POSITION]!;
  const indices = p.indices === undefined ? Uint32Array.from({ length: a.count }, (_, i) => i) : new Uint32Array(source.accessors[p.indices]!.array);
  if (indices.some(v => v >= a.count)) fail('index outside POSITION stream');
  if (mode === 4) { if (indices.length % 3) fail('triangle-list index count must be divisible by three'); return indices; }
  const out = new Uint32Array(Math.max(0, indices.length - 2) * 3);
  for (let i = 0; i < indices.length - 2; i++) {
    out[i * 3] = mode === 6 ? indices[0]! : indices[i + i % 2]!;
    out[i * 3 + 1] = mode === 6 ? indices[i + 1]! : indices[i + 1 - i % 2]!;
    out[i * 3 + 2] = indices[i + 2]!;
  }
  return out;
}
function triangleArea(positions: Float32Array, indices: Uint32Array, offset: number) {
  const a = indices[offset]! * 3, b = indices[offset + 1]! * 3, c = indices[offset + 2]! * 3;
  const x = positions[b]! - positions[a]!, y = positions[b + 1]! - positions[a + 1]!, z = positions[b + 2]! - positions[a + 2]!;
  const u = positions[c]! - positions[a]!, v = positions[c + 1]! - positions[a + 1]!, w = positions[c + 2]! - positions[a + 2]!;
  return Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u);
}
function nondegenerate(positions: Float32Array, indices: Uint32Array): Uint32Array {
  const kept: number[] = [];
  for (let i = 0; i < indices.length; i += 3) if (triangleArea(positions, indices, i) > 0) kept.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
  return new Uint32Array(kept);
}
/** Select the largest triangle in each spatially ordered interval. Morton order
 * distributes a tiny budget across the surface without quadratic N*budget work. */
function spatialPrune(positions: Float32Array, indices: Uint32Array, budget: number): Uint32Array {
  if (indices.length / 3 <= budget) return indices;
  const centers: Array<{ triangle: number; center: number[]; area: number; key: number }> = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < indices.length; i += 3) {
    const center = [0, 1, 2].map(k => (positions[indices[i]! * 3 + k]! + positions[indices[i + 1]! * 3 + k]! + positions[indices[i + 2]! * 3 + k]!) / 3);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, center[k]!); max[k] = Math.max(max[k]!, center[k]!); }
    centers.push({ triangle: i / 3, center, area: triangleArea(positions, indices, i), key: 0 });
  }
  for (const item of centers) {
    const q = item.center.map((v, k) => max[k] === min[k] ? 0 : Math.round((v - min[k]!) / (max[k]! - min[k]!) * 1023));
    for (let bit = 0; bit < 10; bit++) for (let k = 0; k < 3; k++) item.key += ((q[k]! >>> bit) & 1) * 2 ** (bit * 3 + k);
  }
  centers.sort((a, b) => a.key - b.key || a.triangle - b.triangle);
  const selected: number[] = [];
  for (let n = 0; n < budget; n++) {
    const start = Math.floor(n * centers.length / budget), end = Math.floor((n + 1) * centers.length / budget);
    let best = centers[start]!;
    for (let i = start + 1; i < end; i++) if (centers[i]!.area > best.area) best = centers[i]!;
    selected.push(best.triangle);
  }
  selected.sort((a, b) => a - b);
  return Uint32Array.from(selected.flatMap(t => [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!]));
}
function allocate(counts: number[], budget: number): number[] {
  const total = counts.reduce((n, count) => n + count, 0), limit = Math.min(budget, total);
  if (limit === total) return counts.slice();
  const allocations = counts.map(count => Math.floor(count / total * limit));
  let remaining = limit - allocations.reduce((n, count) => n + count, 0);
  const ranked = counts.map((count, i) => ({ i, remainder: count / total * limit - allocations[i]!, count })).sort((a, b) => b.remainder - a.remainder || b.count - a.count || a.i - b.i);
  for (const entry of ranked) if (remaining && allocations[entry.i]! < entry.count) { allocations[entry.i]!++; remaining--; }
  if (remaining) fail('global budget allocation failed');
  return allocations;
}
function compactResources(asset: NormalizedAsset) {
  const json = asset.json, before = { accessors: asset.accessors.length, materials: (json.materials ?? []).length, textures: (json.textures ?? []).length, images: asset.images.length, samplers: (json.samplers ?? []).length };
  const compact = (key: string, refs: Array<{ object: any; key: string }>) => {
    const ids = [...new Set<number>(refs.map(ref => ref.object[ref.key]))].sort((a, b) => a - b), map = new Map(ids.map((id, i) => [id, i]));
    for (const ref of refs) ref.object[ref.key] = map.get(ref.object[ref.key]);
    if (json[key] !== undefined) json[key] = ids.map(id => json[key][id]);
    return ids;
  };
  const refs: Array<{ object: any; key: string }> = [];
  accessorReferences(json, (object, key) => refs.push({ object, key }));
  const ids = compact('accessors', refs); asset.accessors = ids.map(id => asset.accessors[id]!);
  const primitives = (json.meshes ?? []).flatMap((m: any) => m.primitives);
  compact('materials', primitives.filter((p: any) => p.material !== undefined).map((object: any) => ({ object, key: 'material' })));
  compact('textures', (json.materials ?? []).flatMap((material: any) => materialTextureInfos(material).map(object => ({ object, key: 'index' }))));
  compact('samplers', (json.textures ?? []).filter((t: any) => t.sampler !== undefined).map((object: any) => ({ object, key: 'sampler' })));
  const images = compact('images', (json.textures ?? []).map((object: any) => ({ object, key: 'source' }))); asset.images = images.map(id => asset.images[id]!);
  const after = { accessors: asset.accessors.length, materials: (json.materials ?? []).length, textures: (json.textures ?? []).length, images: asset.images.length, samplers: (json.samplers ?? []).length };
  return { before, after };
}

export async function prepareForceTargetGeometry(source: NormalizedAsset, settings: ForceTargetGeometrySettings) {
  const { targetTriangles } = settings;
  if (!Number.isSafeInteger(targetTriangles) || targetTriangles < 1) fail('targetTriangles must be a positive safe integer');
  const normalized: NormalizedAsset = { ...source, json: structuredClone(source.json), accessors: source.accessors.slice(), images: source.images.slice(), validation: structuredClone(source.validation) };
  const jobs: Array<{ mesh: number; primitive: number; p: any; indices: Uint32Array; eligible: Uint32Array; positions: Float32Array }> = [];
  let retainedNonTrianglePrimitives = 0;
  for (let mesh = 0; mesh < (source.json.meshes ?? []).length; mesh++) for (let primitive = 0; primitive < source.json.meshes[mesh].primitives.length; primitive++) {
    const p = source.json.meshes[mesh].primitives[primitive], indices = triangleIndices(source, p);
    if (!indices) { retainedNonTrianglePrimitives++; continue; }
    const position = source.accessors[p.attributes.POSITION]!;
    if (!(position.array instanceof Float32Array) || position.array.some(v => !Number.isFinite(v))) fail('invalid POSITION values');
    jobs.push({ mesh, primitive, p, indices, eligible: nondegenerate(position.array, indices), positions: position.array });
  }
  const budgets = allocate(jobs.map(job => job.eligible.length / 3), targetTriangles);
  const reports: ForceTargetPrimitiveReport[] = [], removed = new Set<any>(), carriers: Array<{ mesh: number; sourcePrimitive: number; sourceVertex: number }> = [];
  const append = (accessor: NormalizedAccessor, prior: any = {}) => {
    const id = normalized.accessors.length, metadata: any = { ...prior, type: accessor.type, componentType: accessor.componentType, count: accessor.count };
    delete metadata.bufferView; delete metadata.byteOffset; delete metadata.sparse;
    if (accessor.normalized) metadata.normalized = true; else delete metadata.normalized;
    if (prior.min || prior.max) {
      const width = arity[accessor.type]!, min = Array<number>(width).fill(Infinity), max = Array<number>(width).fill(-Infinity);
      for (let i = 0; i < accessor.array.length; i++) { min[i % width] = Math.min(min[i % width]!, accessor.array[i]!); max[i % width] = Math.max(max[i % width]!, accessor.array[i]!); }
      if (prior.min) metadata.min = min; if (prior.max) metadata.max = max;
    }
    normalized.accessors.push(accessor); normalized.json.accessors ??= []; normalized.json.accessors.push(metadata); return id;
  };
  const copyVertices = (p: any, out: any, retained: number[]) => {
    const map = new Map<number, number>(), count = source.accessors[p.attributes.POSITION]!.count;
    for (const group of [p.attributes, ...(p.targets ?? [])]) for (const id of Object.values(group) as number[]) if (!map.has(id)) {
      const a = source.accessors[id], width = a && arity[a.type];
      if (!a || !width || a.count !== count || a.array.length !== count * width) fail('malformed retained vertex record');
      const array = new (a.array.constructor as any)(retained.length * width) as NativeArray;
      for (let i = 0; i < retained.length; i++) array.set(a.array.subarray(retained[i]! * width, (retained[i]! + 1) * width), i * width);
      const prior = id === p.attributes.POSITION ? { ...source.json.accessors[id], min: [0, 0, 0], max: [0, 0, 0] } : source.json.accessors[id];
      map.set(id, append({ ...a, count: retained.length, array }, prior));
    }
    for (const group of [out.attributes, ...(out.targets ?? [])]) for (const key of Object.keys(group)) group[key] = map.get(group[key]);
  };
  let simplifierAvailable = MeshoptSimplifier.supported, simplifierFailure: string | null = null;
  if (simplifierAvailable && jobs.some((job, i) => budgets[i]! > 0 && budgets[i]! < job.eligible.length / 3)) {
    try { await MeshoptSimplifier.ready; } catch (error) { simplifierAvailable = false; simplifierFailure = String(error); }
  }
  for (const [i, job] of jobs.entries()) {
    const { mesh, primitive, p, indices, eligible, positions } = job, out = normalized.json.meshes[mesh].primitives[primitive], budget = budgets[i]!;
    const report: ForceTargetPrimitiveReport = { mesh, primitive, outputPrimitive: null, originalTriangles: indices.length / 3, eligibleTriangles: eligible.length / 3, targetTriangles: budget, outputTriangles: 0, originalVertices: positions.length / 3, outputVertices: 0, retainedSourceVertices: [], method: 'removed', reason: '', removedDegenerateTriangles: (indices.length - eligible.length) / 3, simplifierError: null };
    reports.push(report);
    if (!budget) { removed.add(out); report.reason = eligible.length ? 'Global budget assigned zero triangles to this part.' : 'No nondegenerate base-pose triangles exist in this part.'; continue; }
    let selected = eligible, method: ForceTargetPrimitiveReport['method'] = 'unchanged', reason = 'Source part already fits its allocated budget.';
    if (eligible.length / 3 > budget) {
      if (simplifierAvailable) {
        try {
          const [simplified, error] = MeshoptSimplifier.simplify(eligible, positions, 3, budget * 3, 1);
          const valid = nondegenerate(positions, simplified);
          if (valid.length) { selected = valid; method = 'simplify'; report.simplifierError = error; reason = 'Topology simplified without a fidelity/error gate; retained source vertex records are exact.'; }
        } catch (error) { reason = 'Topology simplifier failed; deterministic triangle pruning used: ' + String(error); }
      }
      if (selected.length / 3 > budget) { selected = spatialPrune(positions, selected, budget); method = 'spatial-prune'; reason = 'Simplification could not meet the budget with nondegenerate output. Spatial triangle pruning forced the budget; holes and missing parts are expected.'; }
    }
    const retained = [...new Set(selected)].sort((a, b) => a - b), remap = new Map(retained.map((v, j) => [v, j]));
    copyVertices(p, out, retained);
    const array = retained.length <= 65536 ? Uint16Array.from(selected, v => remap.get(v)!) : Uint32Array.from(selected, v => remap.get(v)!);
    out.mode = 4; out.indices = append({ sourceIndex: -1, type: 'SCALAR', componentType: retained.length <= 65536 ? 5123 : 5125, normalized: false, count: selected.length, array });
    Object.assign(report, { outputTriangles: selected.length / 3, outputVertices: retained.length, retainedSourceVertices: retained, method, reason });
  }
  let carrierMaterial: number | null = null;
  for (let mi = 0; mi < (normalized.json.meshes ?? []).length; mi++) {
    const mesh = normalized.json.meshes[mi], original = source.json.meshes[mi], kept = mesh.primitives.filter((p: any) => !removed.has(p));
    if (!kept.length) {
      // A valid, masked-out POINTS primitive keeps morph target slots available
      // for existing weight tracks. Empty accessors would be invalid glTF; a
      // degenerate triangle would dishonestly spend a triangle of the budget.
      const pi = original.primitives.findIndex((p: any) => source.accessors[p.attributes.POSITION]!.count > 0 && (p.targets?.length ?? 0) === Math.max(...original.primitives.map((q: any) => q.targets?.length ?? 0)));
      if (pi < 0) fail('cannot preserve an empty mesh with no source vertices');
      const p = original.primitives[pi], out = structuredClone(p); copyVertices(p, out, [0]); delete out.indices; out.mode = 0;
      if (carrierMaterial === null) { normalized.json.materials ??= []; carrierMaterial = normalized.json.materials.length; normalized.json.materials.push({ name: 'Invisible force-target animation carrier', pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 0], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'MASK', alphaCutoff: .5 }); }
      out.material = carrierMaterial; kept.push(out); carriers.push({ mesh: mi, sourcePrimitive: pi, sourceVertex: 0 });
    }
    for (const report of reports.filter(r => r.mesh === mi && r.outputTriangles)) report.outputPrimitive = kept.indexOf(mesh.primitives[report.primitive]);
    mesh.primitives = kept;
  }
  const resources = compactResources(normalized), originalTriangles = reports.reduce((n, r) => n + r.originalTriangles, 0), eligibleTriangles = reports.reduce((n, r) => n + r.eligibleTriangles, 0), achievedTriangles = reports.reduce((n, r) => n + r.outputTriangles, 0);
  if (achievedTriangles > targetTriangles || eligibleTriangles > 0 && achievedTriangles === 0) fail('hard triangle budget invariant failed');
  const renderedInstanceTriangles = (normalized.json.nodes ?? []).reduce((n: number, node: any) => n + (node.mesh === undefined ? 0 : reports.filter(r => r.mesh === node.mesh).reduce((sum, r) => sum + r.outputTriangles, 0)), 0);
  normalized.validation = { ...normalized.validation, accessorCount: normalized.accessors.length, decodedBytes: normalized.accessors.reduce((n, a) => n + a.array.byteLength, 0) + normalized.images.reduce((n, image) => n + image.data.length, 0), meshPrimitives: (normalized.json.meshes ?? []).reduce((n: number, m: any) => n + m.primitives.length, 0), imageBytes: normalized.images.reduce((n, image) => n + image.data.length, 0) };
  const reason = originalTriangles === 0 ? 'Source has no triangle topology. Existing points/lines and clips remain; no triangles were fabricated.' : eligibleTriangles === 0 ? 'Source has no nondegenerate base-pose triangles. Degenerate triangles were discarded, even if animation could make them visible.' : achievedTriangles < targetTriangles ? 'Output is below the requested upper bound because the source or simplification has fewer usable triangles. No triangles were fabricated.' : 'Requested global triangle upper bound reached.';
  return { normalized, report: { version: 1, policy: 'force-target' as const, requestedTriangles: targetTriangles, originalTriangles, eligibleTriangles, achievedTriangles, targetMet: achievedTriangles <= targetTriangles, exactlyRequested: achievedTriangles === targetTriangles, triangleCountScope: 'stored mesh primitives, once per mesh; draw instances are separate', renderedInstanceTriangles, reason, primitives: reports, removedTriangles: originalTriangles - achievedTriangles, removedPrimitives: reports.filter(r => !r.outputTriangles).length, removedDegenerateTriangles: reports.reduce((n, r) => n + r.removedDegenerateTriangles, 0), invisibleAnimationCarriers: carriers, retainedNonTrianglePrimitives, resources, simplifierFailure, validation: { retainedVertexRecordsExact: true, allAnimationSamplersExact: true, rigAndNodeMetadataRetained: true, sampledFidelityGate: false, fidelityGuaranteed: false }, warnings: ['Target-first geometry destruction is intentional. Shape, silhouette, connectivity, material coverage, and animated appearance can become unrecognizable.', 'Retained vertex attributes, skin records and morph deltas are exact samples of the source. Every source animation clip and sampler is retained; discarded geometry cannot animate visibly.', 'Degenerate base-pose triangles may be removed even when animation would make them visible.', 'A completely removed mesh uses one masked-out point to keep mesh and morph-animation identities valid; that carrier adds zero triangles.', 'Unused accessor/material/texture/image tables are compacted. Application metadata that observes numeric table or vertex identities is outside this mode.', 'A triangle budget does not guarantee a byte budget: animation, skin, metadata, and retained textures can dominate the download.'] } };
}
