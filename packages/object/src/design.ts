// Designs: what a styled thing IS, before any style draws it -- a list of
// solids, each with a ROLE (bark, leaf, wall, roof... never a colour), plus
// the thing's colliders, sockets, front and wind. A style (style.ts) turns the
// same design into parts: the pixel style into the renderer's own solids
// (boxes, wedges, capsules), the voxel style into a builder VoxelModel and its
// greedy boxes, a custom style into whatever it makes -- so one oak, one
// cottage, one bridge is drawn any way a game likes, and plays the same in
// every one (colliders and sockets are the design's, not the style's).
//
//   solids (own frame: +z front, +y up, the pivot in the middle of the base)
//     box       { c, h, yaw }                 a box turned about y
//     wedge     { c, h, yaw, lo }             a ramp: its top slopes, foot at local +z
//     capsule   { a, b, r }                   a stem, a branch, a beam, a sphere (a = b)
//     ball      { c, r: [rx, ry, rz] }        an ellipsoid blob: a canopy, a bush, a rock
//     cone      { c, r, h, top }              upright, base centre c, base radius r, top radius `top`
//     cylinder  { c, r, h }                   upright, base centre c
//
// Solids are painted in order (a later one wins a voxel), each carries a role,
// an optional group (a part's name for front detection and animation: "door",
// "canopy") and flags (collide, render, and which styles draw it).

import { sdBox, sdCapsule, sdEllipsoid } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { wedgeDistance } from "@keel-engine/physics";
import type { Bounds, FrontSpec } from "@keel-engine/scene";
import type { ColliderSpec, RestMode, SocketSpec } from "./object.ts";

export type SolidKind = "box" | "wedge" | "capsule" | "ball" | "cone" | "cylinder";

interface SolidBase {
  /** Its look role ("bark", "leaf", "wall"): the design's look says what each role wears. */
  readonly role: string;
  /** Its part name (else the role): what front detection reads ("door", "window", "sign"). */
  readonly name?: string | undefined;
  /** A group of solids that move together (a canopy that sways, a door that swings). */
  readonly group?: string | undefined;
  /** false: no collider (default true -- a ball collides as its inner box). */
  readonly collide?: boolean | undefined;
  /** Only these styles draw it ("pixel", "voxel"...): a detail finer than a voxel, say. Default: every style. */
  readonly styles?: readonly string[] | undefined;
}
export interface BoxSolid extends SolidBase { readonly kind: "box"; readonly c: Vec3Like; readonly h: Vec3Like; readonly yaw?: number | undefined }
export interface WedgeSolid extends SolidBase { readonly kind: "wedge"; readonly c: Vec3Like; readonly h: Vec3Like; readonly yaw?: number | undefined; readonly lo?: number | undefined }
export interface CapsuleSolid extends SolidBase { readonly kind: "capsule"; readonly a: Vec3Like; readonly b: Vec3Like; readonly r: number }
export interface BallSolid extends SolidBase { readonly kind: "ball"; readonly c: Vec3Like; readonly r: Vec3Like }
/** A cone's section in the pixel style: "star" (two squares a step, one turned 45°: needles, a spiky crown -- the default), 8 (an octagon), 4 (a square: a stepped pyramid). */
export type ConeSides = 4 | 8 | "star";
export interface ConeSolid extends SolidBase { readonly kind: "cone"; readonly c: Vec3Like; readonly r: number; readonly h: number; readonly top?: number | undefined; readonly sides?: ConeSides | undefined; /** Pixel steps (default: from its shape, 2..7). */ readonly steps?: number | undefined }
export interface CylinderSolid extends SolidBase { readonly kind: "cylinder"; readonly c: Vec3Like; readonly r: number; readonly h: number; readonly sides?: 4 | 8 | undefined }
export type DesignSolid = BoxSolid | WedgeSolid | CapsuleSolid | BallSolid | ConeSolid | CylinderSolid;

/**
 * Wind: how a thing sways, style-independent. Sprites sway in the sprite
 * shader (each texel row shifted by whole pixels -- `swayShift` is the
 * reference), or from baked frames (`swayPose`) where the shader can't.
 */
export interface SwaySpec {
  /** How far the top moves, as a share of the thing's height (0.03: a tree; 0.12: grass). */
  readonly amp: number;
  /** Sways a second. */
  readonly hz: number;
  /** How it bends: the shift at height y is amp * ((y - from) / (top - from))^bend -- 1 a shear, 2 a whip. */
  readonly bend: number;
  /** Below this height nothing moves (a trunk's stiff foot), metres. */
  readonly from: number;
  /** Only these groups sway (default: everything above `from`). */
  readonly groups?: readonly string[] | undefined;
}

/** A design: the solids, and what doesn't depend on how they're drawn. */
export interface Design {
  readonly solids: readonly DesignSolid[];
  /** Collider boxes in the own frame (default: from the solids -- see collidersOfDesign). */
  readonly colliders?: readonly ColliderSpec[] | undefined;
  readonly sockets?: Readonly<Record<string, SocketSpec>> | undefined;
  readonly front?: FrontSpec;
  readonly show?: FrontSpec;
  readonly tags?: readonly string[] | undefined;
  readonly rest?: RestMode | undefined;
  readonly rails?: readonly (readonly Vec3Like[])[] | undefined;
  readonly sway?: SwaySpec | null | undefined;
  /** A voxel style's hint: metres per voxel for this design (else its style picks from its size). */
  readonly voxel?: { readonly unit?: number | undefined } | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

// ---------------------------------------------------------------- building solids

type Extra = Omit<SolidBase, "role">;
/** Solids in one line each: S.box("wall", c, h), S.ball("leaf", c, [rx, ry, rz]) ... */
export const solid = {
  box: (role: string, c: Vec3Like, h: Vec3Like, yaw = 0, extra: Extra = {}): BoxSolid => ({ kind: "box", role, c: v(c), h: v(h), yaw, ...extra }),
  wedge: (role: string, c: Vec3Like, h: Vec3Like, yaw = 0, lo = 0, extra: Extra = {}): WedgeSolid => ({ kind: "wedge", role, c: v(c), h: v(h), yaw, lo, ...extra }),
  capsule: (role: string, a: Vec3Like, b: Vec3Like, r: number, extra: Extra = {}): CapsuleSolid => ({ kind: "capsule", role, a: v(a), b: v(b), r, ...extra }),
  ball: (role: string, c: Vec3Like, r: number | Vec3Like, extra: Extra = {}): BallSolid => ({ kind: "ball", role, c: v(c), r: typeof r === "number" ? [r, r, r] : v(r), ...extra }),
  cone: (role: string, c: Vec3Like, r: number, h: number, top = 0, extra: Extra & { sides?: ConeSides; steps?: number } = {}): ConeSolid => ({ kind: "cone", role, c: v(c), r, h, top, ...extra }),
  cylinder: (role: string, c: Vec3Like, r: number, h: number, extra: Extra & { sides?: 4 | 8 } = {}): CylinderSolid => ({ kind: "cylinder", role, c: v(c), r, h, ...extra }),
};
const v = (a: Vec3Like): Vec3 => [a[0], a[1], a[2]];

/** Does this style draw this solid? */
export const drawnIn = (s: DesignSolid, style: string): boolean => !s.styles || s.styles.includes(style);

// ---------------------------------------------------------------- geometry of solids

/** A solid's AABB in its own frame. */
export function solidBounds(s: DesignSolid): Bounds {
  switch (s.kind) {
    case "box": case "wedge": {
      const co = Math.abs(Math.cos(s.yaw ?? 0)), si = Math.abs(Math.sin(s.yaw ?? 0));
      const ex = s.h[0] * co + s.h[2] * si, ez = s.h[0] * si + s.h[2] * co;
      return [s.c[0] - ex, s.c[1] - s.h[1], s.c[2] - ez, s.c[0] + ex, s.c[1] + s.h[1], s.c[2] + ez];
    }
    case "capsule": return [Math.min(s.a[0], s.b[0]) - s.r, Math.min(s.a[1], s.b[1]) - s.r, Math.min(s.a[2], s.b[2]) - s.r, Math.max(s.a[0], s.b[0]) + s.r, Math.max(s.a[1], s.b[1]) + s.r, Math.max(s.a[2], s.b[2]) + s.r];
    case "ball": return [s.c[0] - s.r[0], s.c[1] - s.r[1], s.c[2] - s.r[2], s.c[0] + s.r[0], s.c[1] + s.r[1], s.c[2] + s.r[2]];
    case "cone": { const r = Math.max(s.r, s.top ?? 0); return [s.c[0] - r, s.c[1], s.c[2] - r, s.c[0] + r, s.c[1] + s.h, s.c[2] + r]; }
    case "cylinder": return [s.c[0] - s.r, s.c[1], s.c[2] - s.r, s.c[0] + s.r, s.c[1] + s.h, s.c[2] + s.r];
  }
}

/** The union of solids' bounds (all of them, or those a style draws). */
export function designBounds(solids: readonly DesignSolid[]): Bounds {
  const b: Bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    const o = solidBounds(s);
    for (let i = 0; i < 3; i += 1) { b[i] = Math.min(b[i]!, o[i]!); b[i + 3] = Math.max(b[i + 3]!, o[i + 3]!); }
  }
  return b;
}

/** Signed distance to a solid (exact for boxes, wedges, capsules, cylinders; a bound for balls and cones). */
export function solidSdf(s: DesignSolid): (x: number, y: number, z: number) => number {
  switch (s.kind) {
    case "box": {
      const co = Math.cos(s.yaw ?? 0), si = Math.sin(s.yaw ?? 0);
      return (x, y, z) => { const dx = x - s.c[0], dz = z - s.c[2]; return sdBox(dx * co - dz * si, y - s.c[1], dx * si + dz * co, s.h[0], s.h[1], s.h[2], 0); };
    }
    case "wedge": {
      const w = { kind: "wedge" as const, c: s.c, h: s.h, yaw: s.yaw ?? 0, lo: s.lo ?? 0 };
      const p: Vec3 = [0, 0, 0];
      return (x, y, z) => { p[0] = x; p[1] = y; p[2] = z; return wedgeDistance(p, w).d; };
    }
    case "capsule": return (x, y, z) => sdCapsule(x, y, z, s.a[0], s.a[1], s.a[2], s.b[0], s.b[1], s.b[2], s.r);
    case "ball": return (x, y, z) => sdEllipsoid(x - s.c[0], y - s.c[1], z - s.c[2], s.r[0], s.r[1], s.r[2]);
    case "cone": {
      const top = s.top ?? 0;
      // (A truncated cone: the radius at height t is r + (top - r) t; the distance is a bound -- inside tests are exact.)
      const slope = (s.r - top) / s.h;
      const k = 1 / Math.sqrt(1 + slope * slope);
      return (x, y, z) => {
        const t = y - s.c[1];
        // (A square cone is a stepped pyramid in the pixel style: the same square here, its corners on the circle.)
        const rad = s.sides === 4 ? Math.max(Math.abs(x - s.c[0]), Math.abs(z - s.c[2])) * Math.SQRT2 : Math.hypot(x - s.c[0], z - s.c[2]);
        const rAt = s.r + (top - s.r) * Math.max(0, Math.min(1, t / s.h));
        return Math.max((rad - rAt) * k, -t, t - s.h);
      };
    }
    case "cylinder": return (x, y, z) => {
      const t = y - s.c[1];
      const d0 = (s.sides === 4 ? Math.max(Math.abs(x - s.c[0]), Math.abs(z - s.c[2])) * Math.SQRT2 : Math.hypot(x - s.c[0], z - s.c[2])) - s.r;
      const d1 = Math.abs(t - s.h / 2) - s.h / 2;
      return Math.min(Math.max(d0, d1), 0) + Math.hypot(Math.max(d0, 0), Math.max(d1, 0));
    };
  }
}

/** The smallest extent of a solid (what a voxel must be finer than to see it). */
export function thicknessOf(s: DesignSolid): number {
  switch (s.kind) {
    case "box": case "wedge": return 2 * Math.min(s.h[0], s.h[1], s.h[2]);
    case "capsule": return 2 * s.r;
    case "ball": return 2 * Math.min(s.r[0], s.r[1], s.r[2]);
    case "cone": return Math.min(2 * s.r, s.h);
    case "cylinder": return Math.min(2 * s.r, s.h);
  }
}

// ---------------------------------------------------------------- colliders from a design

/**
 * A design's colliders (own frame), from its solids unless it lists its own:
 * a box is its box, a wedge its wedge, an upright or level capsule a box
 * along it (else its AABB, approximate), a cylinder the box inside its
 * octagon, a cone the box at a third of its height, a ball the box at 0.8 of
 * its radii (between the inscribed box and its bounds). `collide: false`
 * leaves a solid out. The SAME colliders serve every style: a game plays the
 * same whatever it's drawn in.
 */
export function collidersOfDesign(design: Pick<Design, "solids" | "colliders">): ColliderSpec[] {
  if (design.colliders) return design.colliders.map((c) => ({ ...c }));
  const out: ColliderSpec[] = [];
  for (const s of design.solids) {
    if (s.collide === false) continue;
    const part = s.name ?? s.role;
    switch (s.kind) {
      case "box": out.push({ c: v(s.c), h: v(s.h), yaw: s.yaw ?? 0, mat: s.role, part }); break;
      case "wedge": out.push({ c: v(s.c), h: v(s.h), yaw: s.yaw ?? 0, mat: s.role, part, kind: "wedge", lo: s.lo ?? 0 }); break;
      case "capsule": {
        const d: Vec3 = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]];
        const L = Math.hypot(...d), flat = Math.hypot(d[0], d[2]);
        const c: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
        if (L < 1e-9 || flat / (L || 1) < 0.02) out.push({ c, h: [s.r, Math.abs(d[1]) / 2 + s.r, s.r], yaw: 0, mat: s.role, part, capsule: true });
        else if (Math.abs(d[1]) / L < 0.02) out.push({ c, h: [s.r, s.r, flat / 2 + s.r], yaw: Math.atan2(d[0], d[2]), mat: s.role, part, capsule: true });
        else { const b = solidBounds(s); out.push({ c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], yaw: 0, mat: s.role, part, approx: true, capsule: true }); }
        break;
      }
      case "ball": out.push({ c: v(s.c), h: [s.r[0] * 0.8, s.r[1] * 0.8, s.r[2] * 0.8], yaw: 0, mat: s.role, part }); break;
      case "cone": { const r = (s.r + ((s.top ?? 0) - s.r) / 3) * 0.8; out.push({ c: [s.c[0], s.c[1] + s.h / 2, s.c[2]], h: [r, s.h / 2, r], yaw: 0, mat: s.role, part }); break; }
      case "cylinder": { const r = s.r * 0.92; out.push({ c: [s.c[0], s.c[1] + s.h / 2, s.c[2]], h: [r, s.h / 2, r], yaw: 0, mat: s.role, part }); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- keys

/** A short stable hash (FNV-1a, 52 bits as base 36): bake keys, shape keys. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return ((h1 >>> 0) * 2 ** 20 + ((h2 >>> 12) & 0xfffff)).toString(36);
}

/** A value as canonical text (keys sorted, numbers to 1/10000): equal designs, equal text. */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 1e4) / 1e4) : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(String(value));
}
