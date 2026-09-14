// Objects as data: a definition (the spec defineObject takes, with its parts
// as prims -- boxes, capsules, wedges -- in fixed point) and placed instances
// (a level, a course). What a catalogue piece or a WALLRUN course is when it
// is stored in a pack or a document; @keel-engine/object rebuilds it with
// defineObject(objectSpecOf(record)) and placeObject.
//
// Millimetres and 65536ths of a turn: a record is the design to the
// millimetre, not the last bit of a double (see README "Precision").
// Structural types only -- the codec imports no engine package, so the object
// package can import these without a cycle.

import { alt, array, bool, dyn, enumOf, map, named, nullable, num, optional, ref, struct, tuple, uint, union, varuint, withDefault, fixed } from "../schema.ts";
import type { Infer, Json } from "../schema.ts";
import { dhalf3, dir3, dvec3, half3, lvec3, seedText, size, sizeDelta, unit, vec3, yaw } from "./common.ts";

const Mat = alt([ref("mats"), uint(8)]);

/** A part: one prim, its name, material, look role and flags. */
export const OBJECT_PART = struct({
  name: optional(ref("parts")),
  mat: optional(Mat),
  role: optional(ref("roles")),
  collide: withDefault(enumOf([true, false, "bounds"]), true),
  render: withDefault(bool(), true),
  shape: union("type", {
    box: struct({ c: dvec3, h: dhalf3, yaw: withDefault(yaw, 0), round: withDefault(size, 0) }),
    capsule: struct({ a: dvec3, b: dvec3, r: sizeDelta }),
    /** A ramp: a box whose top slopes from `lo` x its height at local +z to its full height at -z (physics' wedge). */
    wedge: struct({ c: dvec3, h: dhalf3, yaw: withDefault(yaw, 0), lo: withDefault(unit, 0) }),
  }, { capacity: 8 }),
}, { open: true });

/** A collider box given by hand (colliders left out are the parts' own). */
export const OBJECT_COLLIDER = struct({
  c: lvec3, h: half3, yaw: withDefault(yaw, 0), mat: withDefault(Mat, 0),
  part: optional(ref("parts")), approx: withDefault(bool(), false), capsule: withDefault(bool(), false),
});

export const OBJECT_SOCKET = struct({
  kind: enumOf(["top", "seat", "grab", "view", "anchor", "hang", "spawn"], { other: true }),
  pos: lvec3,
  yaw: nullable(yaw),
  extent: optional(tuple([size, size])),
  normal: optional(dir3),
  meta: optional(dyn()),
}, { open: true });

/** An object definition as data (the spec defineObject takes; its colliders, bounds and auto sockets are derived again). */
export const OBJECT = named("keel/object", struct({
  key: ref("keys"),
  parts: array(OBJECT_PART),
  front: nullable(yaw),
  /** The side to show a viewer, when it isn't the front. */
  show: optional(yaw),
  tags: array(ref("tags")),
  colliders: optional(array(OBJECT_COLLIDER)),
  sockets: map(ref("sockets"), OBJECT_SOCKET, { order: "kept" }),
  rest: withDefault(enumOf(["base", "hang", "float"]), "base"),
  rails: array(array(dvec3)),
  meta: withDefault(dyn(), {}),
  /** A catalogue piece: the realm and seed it came from. */
  realm: optional(ref("realms")),
  seed: optional(alt([seedText, num()])),
}, { open: true }), { doc: "An object definition: prims in millimetres, sockets, rails, tags." });

/** Placed objects: the definitions once each, then every instance by index (a level, a WALLRUN course). */
export const PLACED = named("keel/object/placed", struct({
  defs: array(OBJECT),
  objects: array(struct({
    id: ref("ids"),
    def: varuint({ k: 2 }),
    pos: vec3,
    yaw: withDefault(yaw, 0),
    scale: withDefault(fixed(0, 64, 1 / 1024), 1),
    tags: withDefault(array(ref("tags")), []),
  })),
}, { open: true }), { doc: "Objects in a world: definitions and placements." });

export type ObjectRecord = Infer<typeof OBJECT>;
export type PlacedRecord = Infer<typeof PLACED>;
type PartRecord = Infer<typeof OBJECT_PART>;
type V3 = readonly [number, number, number];

// ---------------------------------------------------------------- from and to the object package's shapes

/** What objectRecordOf reads of a definition (@keel-engine/object's ObjectDef, structurally). */
export interface ObjectDefLike {
  readonly key: string;
  readonly parts: readonly {
    readonly name?: string | undefined; readonly mat?: string | number | null | undefined; readonly role?: unknown;
    readonly collide?: boolean | "bounds" | undefined; readonly render?: boolean | undefined;
    readonly prim?: { readonly type: "box"; readonly c: V3; readonly h: V3; readonly yaw: number } | { readonly type: "capsule"; readonly a: V3; readonly b: V3; readonly r: number } | undefined;
    readonly wedge?: { readonly c: V3; readonly h: V3; readonly yaw?: number; readonly lo?: number } | undefined;
  }[];
  readonly front: number | null;
  readonly show: number | null;
  readonly tags: readonly string[];
  readonly colliders?: readonly { readonly c: V3; readonly h: V3; readonly yaw: number; readonly mat: string | number; readonly part?: string; readonly approx?: boolean; readonly capsule?: boolean }[];
  readonly sockets: Readonly<Record<string, { readonly kind: string; readonly pos: V3; readonly yaw: number | null; readonly extent?: readonly [number, number]; readonly normal?: V3; readonly meta?: unknown; readonly auto?: boolean }>>;
  readonly rest: "base" | "hang" | "float";
  readonly rails: readonly (readonly V3[])[];
  readonly meta: object;
  readonly realm?: string;
  readonly seed?: unknown;
}

const v3 = (v: V3): [number, number, number] => [v[0], v[1], v[2]];
/** Round to the millimetre (the JSON baseline at the codec's precision, and what a record holds). */
export const mm = (v: number): number => Math.round(v * 1000) / 1000;
const roundMeta = (v: Json): Json => (typeof v === "number" ? (Number.isFinite(v) ? mm(v) : v) : Array.isArray(v) ? v.map(roundMeta) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundMeta(x)])) : v);

/**
 * A definition as a record. Colliders are left out (the parts make them again) unless `colliders: true`;
 * sockets defineObject added itself (auto) are left out. An SDF part isn't data: it throws.
 */
export function objectRecordOf(def: ObjectDefLike, { colliders = false }: { readonly colliders?: boolean } = {}): ObjectRecord {
  const parts = def.parts.map((p, i): PartRecord => {
    const extra = {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.mat !== undefined && p.mat !== null ? { mat: p.mat } : {}),
      ...(typeof p.role === "string" ? { role: p.role } : {}),
      collide: p.collide ?? true,
      render: p.render ?? true,
    };
    if (p.prim?.type === "box") return { ...extra, shape: { type: "box", c: v3(p.prim.c), h: v3(p.prim.h), yaw: p.prim.yaw, round: 0 } };
    if (p.prim?.type === "capsule") return { ...extra, shape: { type: "capsule", a: v3(p.prim.a), b: v3(p.prim.b), r: p.prim.r } };
    if (p.wedge) return { ...extra, shape: { type: "wedge", c: v3(p.wedge.c), h: v3(p.wedge.h), yaw: p.wedge.yaw ?? 0, lo: p.wedge.lo ?? 0 } };
    throw new TypeError(`Object ${def.key}: part ${p.name ?? i} is an SDF, not a prim -- it can't be stored as data.`);
  });
  const sockets: Record<string, Infer<typeof OBJECT_SOCKET>> = {};
  for (const [name, s] of Object.entries(def.sockets)) {
    if (s.auto) continue;
    sockets[name] = {
      kind: s.kind, pos: v3(s.pos), yaw: s.yaw,
      ...(s.extent ? { extent: [s.extent[0], s.extent[1]] as const } : {}),
      ...(s.normal ? { normal: v3(s.normal) } : {}),
      ...(s.meta !== undefined ? { meta: s.meta as Json } : {}),
    };
  }
  return {
    key: def.key, parts, front: def.front,
    ...(def.show !== null && def.show !== def.front ? { show: def.show } : {}),
    tags: [...def.tags],
    ...(colliders && def.colliders ? { colliders: def.colliders.map((c) => ({ c: v3(c.c), h: v3(c.h), yaw: c.yaw, mat: c.mat, ...(c.part ? { part: c.part } : {}), approx: !!c.approx, capsule: !!c.capsule })) } : {}),
    sockets, rest: def.rest, rails: def.rails.map((r) => r.map(v3)),
    // (Its meta's numbers to the millimetre too: a catalogue piece's sizes, as its parts have them.)
    meta: roundMeta(JSON.parse(JSON.stringify(def.meta)) as Json),
    ...(def.realm !== undefined ? { realm: def.realm } : {}),
    ...(typeof def.seed === "string" || typeof def.seed === "number" ? { seed: def.seed } : def.seed !== undefined ? { seed: JSON.stringify(def.seed) } : {}),
  };
}

/** The spec defineObject takes, from a record (parts as { box | capsule | wedge, name, mat, role, collide, render }). */
export function objectSpecOf(r: ObjectRecord): {
  key: string; parts: Record<string, unknown>[]; front: number | null; show?: number; tags: string[]; colliders?: Record<string, unknown>[];
  sockets: Record<string, Record<string, unknown>>; rest: "base" | "hang" | "float"; rails: [number, number, number][][]; meta: Record<string, unknown>;
} {
  return {
    key: r.key,
    parts: r.parts.map((p) => {
      const { shape, ...rest } = p;
      const { type, ...geo } = shape;
      return { [type]: geo, ...rest };
    }),
    front: r.front,
    ...(r.show !== undefined ? { show: r.show } : {}),
    tags: [...r.tags],
    ...(r.colliders ? { colliders: r.colliders.map((c) => ({ ...c })) } : {}),
    sockets: Object.fromEntries(Object.entries(r.sockets).map(([k, s]) => [k, { ...s }])),
    rest: r.rest,
    rails: r.rails.map((l) => l.map(v3)),
    meta: { ...(r.meta as Record<string, unknown>) },
  };
}

/** What placedRecordOf reads of an instance (@keel-engine/object's ObjectInstance, structurally). */
export interface InstanceLike {
  readonly id: string | number;
  readonly def: ObjectDefLike;
  readonly transform: { readonly pos: V3; readonly yaw: number; readonly scale: number };
  readonly tags: readonly string[];
}

/** Instances as a placed record: equal definitions stored once. */
export function placedRecordOf(instances: readonly InstanceLike[]): PlacedRecord {
  const defs: ObjectRecord[] = [];
  const index = new Map<string, number>();
  const objects = instances.map((inst) => {
    const rec = objectRecordOf(inst.def);
    const key = JSON.stringify(rec);
    let at = index.get(key);
    if (at === undefined) { at = defs.length; defs.push(rec); index.set(key, at); }
    const own = inst.tags.filter((t) => !inst.def.tags.includes(t));
    return { id: String(inst.id), def: at, pos: v3(inst.transform.pos), yaw: inst.transform.yaw, scale: inst.transform.scale, tags: own };
  });
  return { defs, objects };
}
