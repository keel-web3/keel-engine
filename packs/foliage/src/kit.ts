// What foliage is built with: the world roles every plant, rock and crystal
// draws from (each paints its own slot, so a season recolours all of them at
// once and none collide), wind presets, and the pieces trees are made of --
// a trunk that tapers and leans, branches, a canopy of blobs.
//
// Everything is in metres in the thing's own frame: +y up, the pivot in the
// middle of its base, +z its front (foliage has none: fronts are null).

import { solid } from "@keel-engine/object";
import type { DesignSolid, SwaySpec, WorldRoleSpec } from "@keel-engine/object";
import type { Stream, Vec3 } from "@keel-engine/core";

/** Every world role foliage uses, and the slot it paints (distinct: one look paints them all). */
export const ROLES = {
  bark: { as: "detail", stuff: "wood", finishes: ["matte"], patterns: ["none", "none", "bands"] },
  paperbark: { as: "furAlt", stuff: "bone", finishes: ["matte"], patterns: ["bands"] },
  leaf: { as: "primary", stuff: "cloth", finishes: ["matte"], patterns: ["none", "none", "spots"] },
  needle: { as: "secondary", stuff: "cloth", finishes: ["matte"], patterns: ["none"] },
  blossom: { as: "accent", stuff: "paint", finishes: ["matte"], patterns: ["none", "spots"] },
  fruit: { as: "trim", stuff: "paint", finishes: ["matte"], patterns: ["none"] },
  moss: { as: "clothAlt", stuff: "cloth", finishes: ["matte"], patterns: ["none", "spots"] },
  stone: { as: "cloth", stuff: "bone", finishes: ["matte"], patterns: ["none", "spots", "camo"] },
  crystal: { as: "metal", stuff: "metal", finishes: ["metal", "glow"], patterns: ["none", "bands"] },
  glow: { as: "glow", stuff: "glow", finishes: ["glow"], patterns: ["none"] },
  cap: { as: "skin", stuff: "paint", finishes: ["matte"], patterns: ["none", "gradient"] },
  stem: { as: "fur", stuff: "bone", finishes: ["matte"], patterns: ["none"] },
  spot: { as: "blush", stuff: "paint", finishes: ["matte", "glow"], patterns: ["none"] },
  wood: { as: "hair", stuff: "wood", finishes: ["matte"], patterns: ["bands"] },
  dark: { as: "dark", stuff: "dark", finishes: ["matte"], patterns: ["none"] },
} as const satisfies Readonly<Record<string, WorldRoleSpec>>;
export type FoliageRole = keyof typeof ROLES;

/** The roles an asset uses, in its order (the first leads its look's harmony). */
export function roles<K extends FoliageRole>(...names: K[]): { [P in K]: (typeof ROLES)[P] } {
  const out = {} as { [P in K]: (typeof ROLES)[P] };
  for (const n of names) out[n] = ROLES[n];
  return out;
}

/** Wind presets: a tree's top moves a few per cent of its height; grass a lot; a rock not at all. */
export const WIND = {
  tree: { amp: 0.035, hz: 0.35, bend: 1.8, from: 1.2 },
  conifer: { amp: 0.025, hz: 0.3, bend: 2, from: 1.5 },
  palm: { amp: 0.05, hz: 0.3, bend: 2.2, from: 1 },
  bush: { amp: 0.05, hz: 0.5, bend: 1.2, from: 0.1 },
  grass: { amp: 0.16, hz: 0.7, bend: 1.6, from: 0 },
  flower: { amp: 0.12, hz: 0.6, bend: 1.5, from: 0 },
  reed: { amp: 0.1, hz: 0.45, bend: 1.8, from: 0.05 },
} as const satisfies Readonly<Record<string, SwaySpec>>;

export const num = (v: unknown): number => v as number;
export const str = (v: unknown): string => v as string;
export const bool = (v: unknown): boolean => v as boolean;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A direction from a yaw (0: +z) and a pitch up from level. */
export const dirOf = (yaw: number, pitch: number): Vec3 => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

export interface Trunk {
  readonly solids: DesignSolid[];
  /** The point at a share t (0 foot, 1 top) up the trunk. */
  at(t: number): Vec3;
  /** The radius there. */
  radiusAt(t: number): number;
  readonly top: Vec3;
}

/**
 * A trunk: capsules from the ground up, tapering from r0 to r1, leaning toward `leanYaw` by `lean` of its
 * height at the top (bending more the higher it goes), a root flare at its foot. `segments` capsules.
 */
export function trunk(role: string, height: number, r0: number, r1: number, { lean = 0, leanYaw = 0, segments = 4, flare = true, bendPow = 1.6, from = [0, 0, 0] as Vec3 }: { lean?: number; leanYaw?: number; segments?: number; flare?: boolean; bendPow?: number; from?: Vec3 } = {}): Trunk {
  const at = (t: number): Vec3 => {
    const off = lean * height * t ** bendPow;
    return [from[0] + Math.sin(leanYaw) * off, from[1] + r0 + (height - r0) * t, from[2] + Math.cos(leanYaw) * off];
  };
  const radiusAt = (t: number): number => r0 + (r1 - r0) * t;
  const solids: DesignSolid[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = at(i / segments), b = at((i + 1) / segments);
    solids.push(solid.capsule(role, a, b, radiusAt((i + 0.5) / segments), { name: "trunk", collide: i === 0 }));
  }
  // (The foot: a squat cylinder a little wider than the trunk, so it stands on the ground instead of on a point.)
  if (flare) solids.push(solid.cylinder(role, from, r0 * 1.35, r0 * 1.4, { name: "roots", collide: false }));
  return { solids, at, radiusAt, top: at(1) };
}

/** A branch: a capsule from a point along a direction. */
export function branch(role: string, from: Vec3, dir: Vec3, length: number, r: number, name = "branch"): { solid: DesignSolid; tip: Vec3 } {
  const tip = add(from, [dir[0] * length, dir[1] * length, dir[2] * length]);
  return { solid: solid.capsule(role, from, tip, r, { name, collide: false }), tip };
}

/**
 * A canopy: `count` blobs round a centre, inside an ellipsoid of radii `R`, each a squashed ball; the biggest in
 * the middle. `J` jitters where they sit (the design's own stream: the same shape, the same canopy).
 */
export function canopy(role: string, J: Stream, centre: Vec3, R: Vec3, count: number, { flat = 0.75, group = "canopy" }: { flat?: number; group?: string } = {}): DesignSolid[] {
  const out: DesignSolid[] = [solid.ball(role, centre, [R[0] * 0.72, R[1] * 0.72 * flat + R[1] * 0.2, R[2] * 0.72], { name: "canopy", group, collide: false })];
  for (let i = 0; i < count; i += 1) {
    const th = (i / count) * Math.PI * 2 + J.between(-0.4, 0.4);
    const up = J.between(-0.35, 0.55);
    const reach = J.between(0.45, 0.62);
    const c: Vec3 = [centre[0] + Math.sin(th) * R[0] * reach, centre[1] + up * R[1] * 0.6, centre[2] + Math.cos(th) * R[2] * reach];
    const s = J.between(0.42, 0.58);
    out.push(solid.ball(role, c, [R[0] * s, R[1] * s * flat + R[1] * 0.12, R[2] * s], { name: "canopy", group, collide: false }));
  }
  return out;
}

/** A small ring of balls (fruit, blossoms, berries) scattered on the outside of an ellipsoid. */
export function scatter(role: string, J: Stream, centre: Vec3, R: Vec3, count: number, r: number, { below = -0.2, group = "canopy", name = role }: { below?: number; group?: string; name?: string } = {}): DesignSolid[] {
  const out: DesignSolid[] = [];
  for (let i = 0; i < count; i += 1) {
    const th = (i / count) * Math.PI * 2 + J.between(-0.5, 0.5);
    const y = J.between(below, 0.8);
    const k = Math.sqrt(Math.max(0, 1 - y * y));
    out.push(solid.ball(role, [centre[0] + Math.sin(th) * R[0] * k * 0.98, centre[1] + y * R[1] * 0.98, centre[2] + Math.cos(th) * R[2] * k * 0.98], r, { name, group, collide: false }));
  }
  return out;
}
