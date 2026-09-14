// The builder's data, as codec schemas it can adopt: a voxel model (its
// roles, pivot, bounding box, the box's cells as runs of palette indices --
// what the builder's KV1 bytes hold, bit-packed) and an op list (the agent's
// { op, ... } edits), whose schema is made from the builder's own OPS table so
// the two never drift: opListSchema(OPS).
//
// (The builder is its own package; nothing here imports it. voxelRecordOf
// takes the model's dense box, which its VoxelModel.dense() hands out.)

import { array, bool, dyn, enumOf, fixed, int, lz, map, named, nullable, num, optional, ref, string, struct, tuple, uint, union, varint } from "../schema.ts";
import type { Infer, Type } from "../schema.ts";
import { oklch } from "./common.ts";

const i12 = int(13); // (voxel coordinates are -2048..2047: 12 bits and a sign)
const int3 = tuple([i12, i12, i12]);
const region = struct({ min: int3, max: int3 });

/** A voxel model: roles, unit, pivot, the box, its cells LZ-coded (x fastest, then y, then z: a run is a copy from one back, a row like the last from a row back), named regions. */
export const VOXELS = named("keel/builder/voxels", struct({
  name: ref("ids"),
  /** Metres per voxel. */
  unit: fixed(0, 16, 0.0001, { off: "exact" }),
  /** Palette: index i >= 1 plays roles[i - 1] (0 is empty). */
  roles: array(ref("roles"), { max: 255 }),
  /** The pivot in voxel coordinates (half voxels allowed); null: the middle of the base. */
  origin: nullable(tuple([fixed(-2048, 2048, 0.5), fixed(-2048, 2048, 0.5), fixed(-2048, 2048, 0.5)])),
  min: int3,
  size: tuple([uint(13), uint(13), uint(13)]),
  cells: lz(uint(8)),
  groups: map(ref("groups"), array(region), { order: "kept" }),
}, { open: true }), { doc: "A voxel model: palette-indexed cells by role, as runs over its box." });
export type VoxelRecord = Infer<typeof VOXELS>;

/** What voxelRecordOf reads: the builder's VoxelModel (its dense box, roles, groups). */
export interface VoxelModelLike {
  readonly name: string;
  readonly unit: number;
  readonly roles: readonly string[];
  readonly origin: readonly [number, number, number] | null;
  readonly groups: ReadonlyMap<string, readonly { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }[]>;
  dense(): { readonly min: readonly [number, number, number]; readonly size: readonly [number, number, number]; readonly data: Uint8Array };
}
const t3 = (v: readonly [number, number, number]): [number, number, number] => [v[0], v[1], v[2]];
export function voxelRecordOf(m: VoxelModelLike): VoxelRecord {
  const d = m.dense();
  return {
    name: m.name, unit: m.unit, roles: [...m.roles], origin: m.origin ? t3(m.origin) : null,
    min: t3(d.min), size: t3(d.size), cells: Array.from(d.data),
    groups: Object.fromEntries([...m.groups].filter(([, rs]) => rs.length).map(([k, rs]) => [k, rs.map((r) => ({ min: t3(r.min), max: t3(r.max) }))])),
  };
}

// ---------------------------------------------------------------- op lists

/** The builder's field types (ops.ts FieldType): each maps to a codec type. */
export type OpFieldType = "int3" | "num3" | "int" | "num" | "pos" | "string" | "id" | "role" | "role?" | "bool" | "range" | "strings" | "colour" | "any" | "object" | readonly string[];
export interface OpTable { readonly [op: string]: { readonly fields: Readonly<Record<string, { readonly type: OpFieldType; readonly required?: boolean }>> } }

const num3 = tuple([num(), num(), num()]);
function fieldType(t: OpFieldType): Type<unknown> {
  if (Array.isArray(t)) return enumOf(t as readonly string[], { other: true });
  switch (t) {
    case "int3": return int3;
    case "num3": return num3;
    case "int": return varint();
    case "num": case "pos": return num();
    case "string": return string();
    case "id": return ref("ids");
    case "role": return ref("roles");
    case "role?": return nullable(ref("roles"));
    case "bool": return bool();
    case "range": return tuple([num(), num()]);
    case "strings": return array(ref("ids"));
    case "colour": return oklch;
    case "object": return map(ref("keys"), dyn());
    default: return dyn();
  }
}

/**
 * The schema of an op list from an op table (the builder's OPS): a union by "op" over every op, each field
 * typed, the optional ones optional. The op's code is its place in the table: append new ops at the end.
 */
export function opListSchema(table: OpTable): Type<readonly ({ readonly op: string } & Readonly<Record<string, unknown>>)[]> {
  const variants: Record<string, ReturnType<typeof struct>> = {};
  for (const [op, spec] of Object.entries(table)) {
    const fields: Record<string, Type<unknown>> = {};
    for (const [name, f] of Object.entries(spec.fields)) fields[name] = f.required ? fieldType(f.type) : optional(fieldType(f.type));
    variants[op] = struct(fields);
  }
  return named("keel/builder/ops", array(union("op", variants, { capacity: Math.max(64, Object.keys(variants).length) }))) as never;
}
