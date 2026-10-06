import { encode, sha256 } from "@keel-engine/codec/runtime";
import { VOXEL_CONSTRUCTION } from "@keel-engine/codec/schemas/construction";
import { toBase64 } from "./codec.ts";
import { generate } from "./generate.ts";
import { generatorRecords } from "./generator-record.ts";
import { greedyBoxes } from "./mesh.ts";
import { storeVoxels } from "./voxel-store.ts";
import type { V3, VoxelModel } from "./voxels.ts";

export { CONSTRUCTION_REVISION, CONSTRUCTION_MAX_CELLS, loadPrimitiveModel } from "./construction-runtime.ts";
import { CONSTRUCTION_REVISION, CONSTRUCTION_MAX_CELLS, constructionMetadata as metadata, replayModel } from "./construction-runtime.ts";
type Part = { min: V3; size: V3; role: number; count: number; step: V3 };
function partsOf(model: VoxelModel): Part[] | null {
  const boxes = greedyBoxes(model);
  if (boxes.length > 4096) return null;
  const key = (min: readonly number[], size: readonly number[], role: number) => `${role}:${size}:${min}`;
  const byPosition = new Map(boxes.map((b, i) => [key(b.min, b.size, b.label), i]));
  const groups = new Map<string, number[]>();
  boxes.forEach((b, i) => { const k = `${b.label}:${b.size}`; const g = groups.get(k) ?? []; g.push(i); groups.set(k, g); });
  const used = new Set<number>(), out: Part[] = [];
  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;
    const box = boxes[i]!; used.add(i);
    let step: V3 = [0, 0, 0], chain: number[] = [], attempts = 0;
    for (const j of groups.get(`${box.label}:${box.size}`)!) {
      if (j <= i || used.has(j)) continue;
      if (++attempts > 64) break;
      const delta = boxes[j]!.min.map((v, k) => v - box.min[k]!) as V3, candidates = [j];
      for (let n = 2; n < 511; n++) {
        const k = byPosition.get(key(box.min.map((v, a) => v + delta[a]! * n), box.size, box.label));
        if (k === undefined || used.has(k)) break;
        candidates.push(k);
      }
      if (candidates.length > chain.length) { chain = candidates; step = delta; }
    }
    for (const k of chain) used.add(k);
    out.push({ min: box.min, size: box.size, role: box.label, count: chain.length + 1, step });
  }
  return out;
}


/** Host planners can compare complete graphs; irregular models retain the raw fallback. */
export function compileVoxelConstructionCandidates(model: VoxelModel): { kind: string; bytes: Uint8Array }[] {
  const raw = storeVoxels(model), candidates: { kind: string; bytes: Uint8Array }[] = [{ kind: "voxels", bytes: raw }];
  const dense = model.dense();
  if (dense.data.length <= CONSTRUCTION_MAX_CELLS) {
    const common = { checksum: sha256(raw) };
    const parts = partsOf(model);
    if (parts) candidates.push({ kind: "boxes", bytes: encode(VOXEL_CONSTRUCTION, { ...common, metadata: metadata(model), source: { kind: "boxes", parts } }) });
    const provenance = generatorRecords.get(model);
    if (provenance) {
      const edits: { at: V3; role: number }[] = [];
      const coordinates = new Map<string, V3>();
      provenance.baseline.forEach((x, y, z) => coordinates.set(`${x},${y},${z}`, [x, y, z]));
      model.forEach((x, y, z) => coordinates.set(`${x},${y},${z}`, [x, y, z]));
      for (const at of [...coordinates.values()].sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])) {
        if (model.roleAt(...at) !== provenance.baseline.roleAt(...at)) edits.push({ at, role: model.get(...at) });
        if (edits.length > 512) break;
      }
      if (edits.length <= 512) candidates.push({ kind: "generator", bytes: encode(VOXEL_CONSTRUCTION, { ...common, ...(JSON.stringify(metadata(model)) === JSON.stringify(metadata(provenance.baseline)) ? {} : { metadata: metadata(model) }), source: {
        kind: "generator", revision: CONSTRUCTION_REVISION, generator: provenance.kind, seed: provenance.seed,
        ...provenance.options, ...(edits.length || JSON.stringify(metadata(model)) !== JSON.stringify(metadata(provenance.baseline)) ? { baseline: sha256(storeVoxels(provenance.baseline)) } : {}), edits,
      } }) });
    }
  }
  return candidates;
}

/** Compare complete documents. Existing standalone storage keeps its raw-byte policy. */
export function compileVoxelConstruction(model: VoxelModel) {
  const candidates = compileVoxelConstructionCandidates(model);
  // Stable ties favor the raw representation, then explicit primitives.
  const selected = candidates.reduce((a, b) => b.bytes.length < a.bytes.length ? b : a);
  return { bytes: selected.bytes, kind: selected.kind, candidates: candidates.map(c => ({ kind: c.kind, bytes: c.bytes.length })) };
}
export const storeModel = (model: VoxelModel) => compileVoxelConstruction(model).bytes;
export const storeModelText = (model: VoxelModel) => "KC2:" + toBase64(storeModel(model));

/** Full replay explicitly includes the pinned generator library. */
export const loadModel = (input: Uint8Array | string): VoxelModel => replayModel(input, generate);
