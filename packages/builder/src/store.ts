// The storage seam. Everything the builder STORES -- a model's voxels, an op
// list, the plain data riding with an asset (rig edits, animation,
// variation) -- goes through these few functions, so the stored format lives
// in this one file. It is the engine's bit codec (@keel-engine/codec): each
// form is a codec document (header 0xB1 and the schema's short id, then the
// bits), so any tool with the registry reads it. JSON stays the authoring and
// debugging view (op lists as agents emit them, the literals in exported pack
// code); it is not what's stored.
//
//   storeVoxels(model) -> bytes          loadVoxels(bytes | text) -> model
//   storeVoxelsText(model) -> text        (what an exported pack file embeds)
//   storeOps(ops) -> bytes                loadOps(bytes) -> ops (validate with validateOps before running)
//   storeData(value) -> bytes             loadData(bytes) -> value
//
// Written now: voxels as keel/builder/voxels@1 (text: "KC1:" + base64url of
// the document), op lists as keel/builder/ops@1 (made from OPS, so the two
// never drift), asset data as keel/builder/data@1 (a dyn: any JSON-like value,
// -0 included). Still read: the old KV1 voxels (codec.ts; bytes "KV" 1, text
// "KV1:") and the old JSON op lists and data ("J" 1). The first byte tells
// them apart: 0xB1 a codec document, "K" old voxels, "J" old JSON.

import { HEADER_ID, decode, dyn, encode, fromBase64, named, opListSchema, toBase64, VOXELS, voxelRecordOf } from "@keel-engine/codec";
import type { OpTable, VoxelRecord } from "@keel-engine/codec";
import { decodeVoxels } from "./codec.ts";
import { OPS } from "./ops.ts";
import { createVoxels } from "./voxels.ts";
import type { V3, VoxelModel } from "./voxels.ts";

/** What each stored form is written as now, and the older forms still read. */
export const STORE_FORMAT = Object.freeze({
  voxels: "keel/builder/voxels@1",
  voxelsText: "KC1",
  ops: "keel/builder/ops@1",
  data: "keel/builder/data@1",
  reads: Object.freeze(["KV1", "J1"] as const),
} as const);

const TEXT = "KC1:";
const J1 = [0x4a, 0x01];
/** Asset data: any JSON-like value, self-described. */
const DATA = named("keel/builder/data", dyn(), { doc: "Plain asset data riding with a builder asset: rig edits, animation, variation, a look." });
// (Made on first use: OPS lives in ops.ts, which imports this file through export.ts.)
let opList: ReturnType<typeof opListSchema> | null = null;
const opsSchema = () => (opList ??= opListSchema(OPS as OpTable));

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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

// ---------------------------------------------------------------- op lists and data

// (The old form: UTF-8 JSON behind "J" 1. Read, never written.)
const isJson = (b: Uint8Array): boolean => b[0] === J1[0] && b[1] === J1[1];
const loadJson = (b: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(b.subarray(2)));
const unknownFormat = (b: Uint8Array, what: string, format: string): TypeError =>
  new TypeError(`Stored ${what} of an unknown format (tag ${b[0]}, ${b[1]}; this builder reads ${format} and J1).`);

/** An op list as stored bytes: a keel/builder/ops@1 document. Every op must be in OPS (validateOps says what was meant). */
export function storeOps(ops: ReadonlyArray<{ readonly op: string }>): Uint8Array {
  ops.forEach((o, i) => {
    if (!Object.hasOwn(OPS, o?.op)) throw new TypeError(`Can't store op ${i}: "${o?.op}" isn't a builder op (validateOps names the one meant).`);
  });
  try {
    return encode(opsSchema(), ops as never);
  } catch (e) {
    throw new TypeError(`Can't store these ops: ${why(e)}`, { cause: e });
  }
}
/** Stored op-list bytes back to the op list (check it with validateOps; runOps does). */
export function loadOps(b: Uint8Array): Array<{ readonly op: string; readonly [field: string]: unknown }> {
  if (b[0] === HEADER_ID) return [...decode(opsSchema(), b)];
  if (!isJson(b)) throw unknownFormat(b, "ops", STORE_FORMAT.ops);
  const v = loadJson(b);
  if (!Array.isArray(v)) throw new TypeError("Stored ops aren't a list.");
  return v as Array<{ readonly op: string }>;
}

/** Plain asset data (rig edits, animation, variation, a look) as stored bytes -- a keel/builder/data@1 document -- and back. */
export function storeData(v: unknown): Uint8Array {
  try {
    return encode(DATA, v as never);
  } catch (e) {
    throw new TypeError(`Can't store this data: ${why(e)}`, { cause: e });
  }
}
export function loadData(b: Uint8Array): unknown {
  if (b[0] === HEADER_ID) return decode(DATA, b);
  if (!isJson(b)) throw unknownFormat(b, "data", STORE_FORMAT.data);
  return loadJson(b);
}
