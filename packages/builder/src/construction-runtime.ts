// Model replay without authoring tools or generators. The full construction
// loader explicitly supplies a pinned generator; primitive-only games omit it.
import { decode, HEADER_ID, readHeader, sha256, shortId } from "@keel-engine/codec/runtime";
import { VOXEL_CONSTRUCTION } from "@keel-engine/codec/schemas/construction";
import { fromBase64 } from "./codec.ts";
import { loadVoxels, storeVoxels } from "./voxel-store.ts";
import { createVoxels } from "./voxels.ts";
import type { V3, VoxelModel } from "./voxels.ts";
import type { GeneratorKind, GenerateOptions } from "./generate.ts";
export const CONSTRUCTION_REVISION = 1;
export const CONSTRUCTION_MAX_CELLS = 262144;
type ModelGenerator = (kind: GeneratorKind, seed: string, options: GenerateOptions) => { model: VoxelModel };
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export function constructionMetadata(model: VoxelModel) {
  return { name: model.name, unit: model.unit, origin: model.origin, roles: [...model.roles], groups: Object.fromEntries(model.groups) };
}

/** Replay bounded declarative construction; uploaded JavaScript is never evaluated. */
export function replayModel(input: Uint8Array | string, generate?: ModelGenerator): VoxelModel {
  if (typeof input === "string") {
    if (!input.startsWith("KC2:")) return loadVoxels(input);
    input = fromBase64(input.slice(4).replace(/\s+/g, ""));
  }
  if (input[0] !== HEADER_ID) return loadVoxels(input);
  if (readHeader(input).id !== shortId(VOXEL_CONSTRUCTION)) return loadVoxels(input);
  const record = decode(VOXEL_CONSTRUCTION, input);
  const source = record.source;
  let meta = record.metadata;
  let base: VoxelModel | undefined;
  if (source.kind === "generator") {
    if (source.revision !== CONSTRUCTION_REVISION) throw Error("Unknown generator revision");
    if (source.unit !== undefined && (!(source.unit > 0) || source.unit > 16 || !Number.isFinite(source.unit))) throw Error("Invalid generator unit");
    if (!generate) throw Error("Generator construction is not enabled in this runtime");
    base = generate(source.generator, source.seed, { ...(source.plan ? { plan: source.plan } : {}), ...(source.unit === undefined ? {} : { unit: source.unit }) }).model;
    if (!equal(sha256(storeVoxels(base)), source.baseline ?? record.checksum)) throw Error("Generator drift: pinned baseline differs");
    meta ??= constructionMetadata(base);
  }
  if (!meta || !(meta.unit > 0) || !Number.isFinite(meta.unit) || meta.unit > 16) throw Error("Invalid construction metadata");
  const model = createVoxels({ name: meta.name, unit: meta.unit, origin: meta.origin as V3 | null, roles: meta.roles });
  let work = 0;
  const write = (at: readonly number[], role: number) => {
    if (++work > CONSTRUCTION_MAX_CELLS || role > meta!.roles.length) throw Error("Construction budget or role exceeded");
    model.setIndex(at[0]!, at[1]!, at[2]!, role);
  };
  if (source.kind === "boxes") {
    for (const part of source.parts) {
      const volume = part.size.reduce((n, v) => n * v, 1) * part.count;
      if (!part.count || part.size.some(v => !v) || !part.role || work + volume > CONSTRUCTION_MAX_CELLS) throw Error("Invalid construction volume");
      for (let n = 0; n < part.count; n++) for (let z = 0; z < part.size[2]; z++) for (let y = 0; y < part.size[1]; y++) for (let x = 0; x < part.size[0]; x++) write([
        part.min[0] + part.step[0] * n + x, part.min[1] + part.step[1] * n + y, part.min[2] + part.step[2] * n + z,
      ], part.role);
    }
  } else {
    base!.forEach((x, y, z) => {
      const role = meta!.roles.indexOf(base!.roleAt(x, y, z)!);
      write([x, y, z], role < 0 ? 0 : role + 1);
    });
    for (const edit of source.edits) write(edit.at, edit.role);
  }
  for (const [name, regions] of Object.entries(meta.groups)) model.groups.set(name, regions.map(r => ({ min: [...r.min] as V3, max: [...r.max] as V3 })));
  if (!equal(sha256(storeVoxels(model)), record.checksum)) throw Error("Construction checksum mismatch");
  return model;
}

export const loadPrimitiveModel = (input: Uint8Array | string) => replayModel(input);
