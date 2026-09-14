// The level document's packed form: a codec schema (keel/level) -- the
// terrain's arrays as runs (a meadow is one run of grass), things by table-
// deduped names and millimetre positions, settings as the world's own schema.
// encodeLevel / decodeLevel round-trip a document exactly (test/level.test.ts).

import { SETTINGS, array, decode, dyn, encode, enumOf, fixed, int, map, named, nullable, num, optional, ref, runs, string, struct, tuple, uint, vec3, withDefault, yaw } from "@keel-engine/codec";
import type { Infer } from "@keel-engine/codec";
import type { LevelDocument } from "./document.ts";

const tile = tuple([uint(13), uint(13)]);
const rect = tuple([int(14), int(14), int(14), int(14)]);
const metres = fixed(0, 1024, 0.0001, { off: "exact" });

const TERRAIN = struct({
  width: uint(13),
  depth: uint(13),
  tileSize: metres,
  stepHeight: metres,
  chunk: uint(9),
  types: array(ref("types")),
  height: runs(int(16)),
  type: runs(uint(8)),
  flags: runs(uint(8)),
  dir: runs(uint(2)),
  water: runs(int(16)),
  deck: runs(int(16)),
});

const THING = struct({
  id: ref("ids"),
  layer: enumOf(["objects", "buildings", "bridges", "props"], { other: true }),
  pack: ref("packs"),
  object: ref("objects"),
  pins: map(ref("pins"), dyn()),
  look: nullable(dyn()),
  tier: enumOf(["main", "foreground", "background", "ground"]),
  pos: vec3,
  yaw: withDefault(yaw, 0),
  scale: withDefault(fixed(0, 64, 1 / 1024, { off: "exact" }), 1),
  tags: withDefault(array(ref("tags")), []),
  footprint: nullable(rect),
}, { open: true });

const RULE = struct({
  pack: ref("packs"),
  object: ref("objects"),
  pins: optional(map(ref("pins"), dyn())),
  on: array(ref("types")),
  weight: num(),
  spacing: num(),
  scale: tuple([num(), num()]),
  clump: optional(num()),
  water: optional(num()),
  tags: optional(array(ref("tags"))),
}, { open: true });

/** A level document, packed. */
export const LEVEL = named("keel/level", struct({
  format: enumOf(["keel-level"]),
  version: uint(8),
  id: ref("ids"),
  name: string(),
  seed: string({ packHex: true }),
  terrain: TERRAIN,
  settings: SETTINGS,
  things: array(THING),
  scatter: array(struct({ id: ref("ids"), rect, rules: array(RULE), density: num(), clear: uint(4) }, { open: true })),
  roads: array(struct({ id: ref("ids"), kind: enumOf(["road", "path"]), path: array(tile) })),
  water: array(struct({ id: ref("ids"), kind: enumOf(["sea", "lake", "river"]), level: int(16), at: nullable(tile), path: nullable(array(tile)) })),
  spawns: array(struct({ id: ref("ids"), player: uint(6), team: uint(6), at: tile, natural: nullable(tile) })),
  markers: array(struct({ id: ref("ids"), kind: ref("kinds"), pos: vec3, tags: array(ref("tags")), data: nullable(dyn()) })),
  regions: array(struct({ id: ref("ids"), kind: enumOf(["trigger", "area", "nobuild", "nowalk"], { other: true }), rect, tags: array(ref("tags")), script: nullable(string()) })),
  resources: array(struct({ id: ref("ids"), kind: enumOf(["mass", "crystal", "flux", "fertile", "wreck"]), at: tile, amount: num(), owner: nullable(uint(6)) })),
  meta: map(ref("meta"), dyn()),
}, { open: true }), { doc: "A level: terrain (runs per tile array), placed things by content reference, foliage regions, roads, water, spawns, markers, regions, resources, and the settings (with locks) that made it." });
export type LevelRecord = Infer<typeof LEVEL>;

/** A document as bytes (the codec's self-describing header by default: "id"). */
export function encodeLevel(doc: LevelDocument, { header = "id" }: { readonly header?: "id" | "self" | "none" } = {}): Uint8Array {
  return encode(LEVEL, doc as unknown as LevelRecord, { header });
}

/** Bytes back to a document. */
export function decodeLevel(bytes: Uint8Array): LevelDocument {
  return decode(LEVEL, bytes) as unknown as LevelDocument;
}
