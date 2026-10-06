// Voxel storage runtime, independent of the editor and its op catalogue.
import { HEADER_ID, decode, encode, fromBase64, toBase64 } from "@keel-engine/codec/runtime";
import { VOXELS, voxelRecordOf } from "@keel-engine/codec/schemas/voxel";
import type { VoxelRecord } from "@keel-engine/codec/schemas/voxel";
import { decodeVoxels } from "./codec.ts";
import { createVoxels } from "./voxels.ts";
import type { V3, VoxelModel } from "./voxels.ts";
import { STORE_FORMAT } from "./store-format.ts";
const TEXT = "KC1:";

// ---------------------------------------------------------------- voxels

/** The record a model stores as: only the roles something uses, in first-use order over the box (as KV1 did). */
function recordOf(m: VoxelModel): VoxelRecord {
  const d = m.dense();
  const used: number[] = [];
  const remap = new Uint8Array(256);
  for (const v of d.data) if (v && !remap[v]) { used.push(v); remap[v] = used.length; }
  const data = d.data.map((v) => remap[v]!);
  return voxelRecordOf({
    name: m.name, unit: m.unit, origin: m.origin, groups: m.groups,
    roles: used.map((v) => m.roles[v - 1]!),
    dense: () => ({ min: d.min, size: d.size, data }),
  });
}

/** A stored record back to a model (the cells over its box, x fastest, then y, then z -- as decodeVoxels reads KV1). */
function modelOf(r: VoxelRecord): VoxelModel {
  const m = createVoxels({ unit: r.unit, roles: r.roles, origin: r.origin ? [r.origin[0], r.origin[1], r.origin[2]] : null, name: r.name });
  const [sx, sy, sz] = r.size;
  if (r.cells.length !== sx * sy * sz) throw new RangeError(`Stored voxels hold ${r.cells.length} cells for a ${sx}x${sy}x${sz} box.`);
  for (let k = 0; k < r.cells.length; k += 1) {
    const v = r.cells[k]!;
    if (!v) continue;
    if (v > r.roles.length) throw new RangeError(`Stored voxels name role ${v} of ${r.roles.length}.`);
    m.setIndex(r.min[0] + (k % sx), r.min[1] + (Math.floor(k / sx) % sy), r.min[2] + Math.floor(k / (sx * sy)), v);
  }
  for (const [name, rs] of Object.entries(r.groups)) m.groups.set(name, rs.map((g) => ({ min: [...g.min] as V3, max: [...g.max] as V3 })));
  return m;
}

/** A model's voxels as stored bytes: a keel/builder/voxels@1 document. */
export const storeVoxels = (m: VoxelModel): Uint8Array => encode(VOXELS, recordOf(m));
/** A model's voxels as stored text ("KC1:" + base64url of the document): what exported pack code embeds. */
export const storeVoxelsText = (m: VoxelModel): string => TEXT + toBase64(storeVoxels(m));

/** Stored voxels (bytes or text, any format this builder reads) back to a model. */
export function loadVoxels(data: Uint8Array | string): VoxelModel {
  if (typeof data === "string") {
    const t = data.trim();
    if (t.startsWith(TEXT)) return loadVoxels(fromBase64(t.slice(TEXT.length).replace(/\s+/g, "")));
    if (t.startsWith("KV1:")) return decodeVoxels(t);
    throw new TypeError(`Stored voxel text of an unknown format ("${data.slice(0, 6)}..."; this builder reads ${TEXT} and KV1:).`);
  }
  if (data[0] === HEADER_ID) return modelOf(decode(VOXELS, data));
  if (data[0] === 0x4b && data[1] === 0x56) return decodeVoxels(data);
  throw new TypeError(`Stored voxel bytes of an unknown format (tag ${data[0]}, ${data[1]}; this builder reads ${STORE_FORMAT.voxels} and KV1).`);
}

