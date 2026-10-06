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

import { HEADER_ID, decode, dyn, encode, named } from "@keel-engine/codec/runtime";
import { opListSchema } from "@keel-engine/codec/schemas/voxel";
import type { OpTable } from "@keel-engine/codec/schemas/voxel";
import { OPS } from "./ops.ts";

export { STORE_FORMAT } from "./store-format.ts";
import { STORE_FORMAT } from "./store-format.ts";
export { storeVoxels, storeVoxelsText, loadVoxels } from "./voxel-store.ts";
const J1 = [0x4a, 0x01];
/** Asset data: any JSON-like value, self-described. */
const DATA = named("keel/builder/data", dyn(), { doc: "Plain asset data riding with a builder asset: rig edits, animation, variation, a look." });
// (Made on first use: OPS lives in ops.ts, which imports this file through export.ts.)
let opList: ReturnType<typeof opListSchema> | null = null;
const opsSchema = () => (opList ??= opListSchema(OPS as OpTable));

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
