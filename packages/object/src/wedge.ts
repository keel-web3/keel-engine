// Wedges as parts: physics' and the renderer's third solid -- a box turned
// about y whose top slopes, rising from its foot at local +z (`lo` x its
// height there) to its full height at local -z -- made into an object part
// that remembers what it was, so an object built from it hands the same wedge
// back to the character controller (bakeForPhysics: a box with kind "wedge")
// and the renderer (bakeForRenderer: the same). The catalogue's ramps are
// stairs of slabs (the proof of concept's, kept identical); a ramp built from
// a wedge is one solid you walk up.
//
//   defineObject({ key: "ramp", parts: [{ wedge: { c, h, yaw, lo }, name: "slope", mat: "floor" }] })
//
// A part keeps it as `wedge` (what @keel-engine/codec's object records read).

import type { Vec3, Vec3Like } from "@keel-engine/core";
import { wedgeDistance } from "@keel-engine/physics";
import { boxBounds, part } from "@keel-engine/scene";
import type { PartFields, SdfPart } from "@keel-engine/scene";

/** A wedge: centre, half extents, a turn about y, and the foot's height as a share of the full height (0..0.98). */
export interface WedgeSpec {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number | undefined;
  readonly lo?: number | undefined;
}
/** What a wedge part remembers. */
export interface WedgePrim {
  readonly c: Vec3;
  readonly h: Vec3;
  readonly yaw: number;
  readonly lo: number;
}
/** A wedge as a part is given to defineObject: { wedge, name, mat, ... }. */
export type WedgePartLike = PartFields & { readonly wedge: WedgeSpec; readonly [field: string]: unknown };

const num3 = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError(`${what} must be [x, y, z].`);
  return [v[0] as number, v[1] as number, v[2] as number];
};

/** Is this part-like a wedge (and not already a part)? */
export const isWedgeLike = (p: unknown): p is WedgePartLike =>
  !!p && typeof p === "object" && "wedge" in p && !!(p as { wedge?: unknown }).wedge && typeof (p as { sdf?: unknown }).sdf !== "function";

/** A wedge as a part: an SDF (physics' wedgeDistance, exact) and its box's bounds, keeping `wedge`. */
export function wedgePart<E extends PartFields & Record<string, unknown>>(spec: WedgeSpec, extra: E = {} as E): SdfPart & E & { readonly wedge: WedgePrim } {
  const c = num3(spec.c, "wedge.c");
  const h = num3(spec.h, "wedge.h");
  if (!h.every((v) => v > 0)) throw new RangeError("wedge.h must be positive half-extents.");
  const wedge: WedgePrim = { c, h, yaw: spec.yaw ?? 0, lo: Math.max(0, Math.min(0.98, spec.lo ?? 0)) };
  const solid = { kind: "wedge" as const, ...wedge };
  const p: Vec3 = [0, 0, 0];
  const sdf = (x: number, y: number, z: number): number => { p[0] = x; p[1] = y; p[2] = z; return wedgeDistance(p, solid).d; };
  return part({ ...extra, sdf, bounds: boxBounds(wedge), wedge }) as unknown as SdfPart & E & { readonly wedge: WedgePrim };
}

/** A wedge part-like (defineObject's `{ wedge: {...}, ... }`) as a part. */
export function wedgeFromLike(p: WedgePartLike): SdfPart & { readonly wedge: WedgePrim } {
  const { wedge, ...rest } = p;
  return wedgePart(wedge, rest as PartFields & Record<string, unknown>);
}
