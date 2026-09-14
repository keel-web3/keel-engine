// Primitives as parts -- ported from the proof of concept's src/object/prims.js
// (it lives here, not in @keel-engine/object, because front detection reads
// raw solids and scene can't depend on object; object re-exports it). The
// renderer's and the physics' two solids -- a box turned about y, and a
// capsule -- made into scene parts (an SDF and its bounds) that remember what
// they were, so an object built from them can hand the same solids back to
// the renderer and the character controller.
//
//   box      { c:[x,y,z], h:[hx,hy,hz], yaw }   turned about y (core frame)
//   capsule  { a:[x,y,z], b:[x,y,z], r }
//
// A box's yaw is the frame's yaw: its own +z face looks along frontOf(yaw) --
// the same box the physics' boxDistance and the GPU shader draw.

import { dcos, dsin, sdBox, sdCapsule, worldToLocal } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { part, unionBounds } from "./kit.ts";
import type { Bounds, PartFields, PartOf, Sdf, SdfPart, Shape } from "./kit.ts";

/** A box turned by yaw about y: centre, half-extents, and an optional rounding. */
export interface BoxSpec {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number | undefined;
  readonly round?: number | undefined;
}
export interface CapsuleSpec {
  readonly a: Vec3Like;
  readonly b: Vec3Like;
  readonly r: number;
}

/** What a prim part remembers it was. */
export type Prim =
  | { readonly type: "box"; readonly c: Vec3; readonly h: Vec3; readonly yaw: number }
  | { readonly type: "capsule"; readonly a: Vec3; readonly b: Vec3; readonly r: number };

/** A part's other fields, when it is given as a prim: its name, material, and anything else that rides along. */
export interface PartExtras extends PartFields {
  readonly [field: string]: unknown;
}

/**
 * Anything part-like (toPart):
 *   { box: {c,h,yaw}, name, mat, ... }       a box part
 *   { capsule: {a,b,r}, name, mat, ... }     a capsule part
 *   { shape: {f,b}, name, mat, ... }         a kit shape
 *   { c, h, yaw?, name? }                    a bare renderer box
 *   { a, b, r, name? }                       a bare renderer capsule
 *   { sdf, bounds, ... }                     already a part (kept as it is)
 */
export type PartLike =
  | SdfPart
  | (PartExtras & { readonly box: BoxSpec })
  | (PartExtras & { readonly capsule: CapsuleSpec })
  | (PartExtras & { readonly shape: Shape })
  | (PartExtras & BoxSpec)
  | (PartExtras & CapsuleSpec);

const num3 = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError(`${what} must be [x, y, z].`);
  return [v[0] as number, v[1] as number, v[2] as number];
};

/** The AABB of a box turned by yaw about y: its four corners, boxed again. */
export function boxBounds({ c, h, yaw = 0 }: BoxSpec): Bounds {
  const co = Math.abs(dcos(yaw));
  const si = Math.abs(dsin(yaw));
  const ex = h[0] * co + h[2] * si;
  const ez = h[0] * si + h[2] * co;
  return [c[0] - ex, c[1] - h[1], c[2] - ez, c[0] + ex, c[1] + h[1], c[2] + ez];
}

/** A capsule's AABB. */
export const capsuleBounds = ({ a, b, r }: CapsuleSpec): Bounds => unionBounds([
  [a[0] - r, a[1] - r, a[2] - r, a[0] + r, a[1] + r, a[2] + r],
  [b[0] - r, b[1] - r, b[2] - r, b[0] + r, b[1] + r, b[2] + r],
]);

/** Signed distance to a turned box (no allocation: the hot path). */
export function boxSdf({ c, h, yaw = 0, round = 0 }: BoxSpec): Sdf {
  const co = dcos(yaw);
  const si = dsin(yaw);
  const [cx, cy, cz] = c;
  const [hx, hy, hz] = h;
  return (x, y, z) => {
    const dx = x - cx;
    const dz = z - cz;
    // (world -> the box's frame, core worldToLocal: x' = c x - s z, z' = s x + c z)
    return sdBox(dx * co - dz * si, y - cy, dx * si + dz * co, hx, hy, hz, round);
  };
}

export const capsuleSdf = ({ a, b, r }: CapsuleSpec): Sdf => (x, y, z) => sdCapsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r);

/** A part made from a prim: its extras, an SDF and bounds, and the prim it was. */
export type PrimPart<E extends object = PartFields> = PartOf<E & SdfPart & { prim: Prim }>;

/** A box as a part: { name, mat, ... } plus prim { type:"box", c, h, yaw }. */
export function boxPart<E extends object = PartFields>(spec: BoxSpec, extra: E = {} as E): PrimPart<E> {
  const c = num3(spec.c, "box.c");
  const h = num3(spec.h, "box.h");
  if (!h.every((v) => v > 0)) throw new RangeError("box.h must be positive half-extents.");
  const yaw = spec.yaw ?? 0;
  const prim = { type: "box" as const, c, h, yaw };
  return part({ ...extra, sdf: boxSdf({ c, h, yaw, round: spec.round ?? 0 }), bounds: boxBounds(prim), prim }) as PrimPart<E>;
}

/** A capsule as a part: prim { type:"capsule", a, b, r }. */
export function capsulePart<E extends object = PartFields>(spec: CapsuleSpec, extra: E = {} as E): PrimPart<E> {
  const a = num3(spec.a, "capsule.a");
  const b = num3(spec.b, "capsule.b");
  if (!(spec.r > 0)) throw new RangeError("capsule.r must be positive.");
  const prim = { type: "capsule" as const, a, b, r: spec.r };
  return part({ ...extra, sdf: capsuleSdf(prim), bounds: capsuleBounds(prim), prim }) as PrimPart<E>;
}

/** Anything part-like -> a part (see PartLike). A part comes back as it is. */
export function toPart(spec: PartLike): SdfPart & PartFields {
  if (!spec || typeof spec !== "object") throw new TypeError("A part must be an object.");
  if (typeof (spec as Partial<SdfPart>).sdf === "function") return spec as SdfPart;
  const { box, capsule, shape, ...rest } = spec as PartExtras & { box?: BoxSpec; capsule?: CapsuleSpec; shape?: Shape };
  // (Its other fields ride along whatever they are: typed here as the ones a part knows.)
  const fields = rest as PartFields;
  if (box) return boxPart(box, fields);
  if (capsule) return capsulePart(capsule, fields);
  if (shape) return part({ ...fields, sdf: shape.f, bounds: shape.b });
  const s = spec as PartExtras & Partial<BoxSpec> & Partial<CapsuleSpec>;
  if (s.c && s.h) {
    const { c, h, yaw, round, ...more } = s;
    return boxPart({ c, h, yaw, round }, more as PartFields);
  }
  if (s.a && s.b && s.r) {
    const { a, b, r, ...more } = s;
    return capsulePart({ a, b, r }, more as PartFields);
  }
  throw new TypeError(`Part ${String(s.name ?? "?")} is neither a box, a capsule, a shape nor an SDF part.`);
}

/** Is a point inside a turned box's footprint (x, z)? */
export function overTop(p: Vec3Like, bx: BoxSpec, margin = 0): boolean {
  const l = worldToLocal(bx.c, bx.yaw ?? 0, p);
  return Math.abs(l[0]) <= bx.h[0] + margin && Math.abs(l[2]) <= bx.h[2] + margin;
}
