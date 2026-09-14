// What buildings are built with: their world roles (each paints its own
// slot, so a culture -- a village, a stone town, a sci-fi colony -- recolours
// every house at once), choice helpers, and the pieces that aren't buildings
// but go with them: posts, rails, planks.
//
// Metres, the thing's own frame: +y up, +z its front (a door, a bridge's
// first end, a ramp's foot), the pivot in the middle of its base.

import { solid } from "@keel-engine/object";
import type { DesignSolid, WorldRoleSpec } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";

/** Every world role buildings and their kin use, and the slot each paints (all distinct). */
export const ROLES = {
  wall: { as: "primary", stuff: "paint", finishes: ["matte"], patterns: ["none", "none", "spots", "gradient"] },
  roof: { as: "secondary", stuff: "paint", finishes: ["matte"], patterns: ["checks", "bands", "none", "stripes"] },
  trim: { as: "trim", stuff: "paint", finishes: ["matte"], patterns: ["none"] },
  wood: { as: "detail", stuff: "wood", finishes: ["matte"], patterns: ["none", "bands"] },
  stone: { as: "cloth", stuff: "bone", finishes: ["matte"], patterns: ["none", "checks", "spots"] },
  glass: { as: "eye", stuff: "dark", finishes: ["matte", "glow"], patterns: ["none"] },
  door: { as: "accent", stuff: "paint", finishes: ["matte"], patterns: ["none", "bands"] },
  metal: { as: "metal", stuff: "metal", finishes: ["metal"], patterns: ["none", "bands"] },
  glow: { as: "glow", stuff: "glow", finishes: ["glow"], patterns: ["none"] },
  cloth: { as: "clothAlt", stuff: "cloth", finishes: ["cloth"], patterns: ["stripes", "stripes", "none", "checks"] },
  sign: { as: "skin", stuff: "paint", finishes: ["matte"], patterns: ["none", "trim"] },
  rope: { as: "furAlt", stuff: "leather", finishes: ["leather"], patterns: ["none"] },
  plank: { as: "hair", stuff: "wood", finishes: ["matte"], patterns: ["bands", "none"] },
  organic: { as: "fur", stuff: "skin", finishes: ["matte"], patterns: ["none", "spots", "gradient"] },
  dark: { as: "dark", stuff: "dark", finishes: ["matte"], patterns: ["none"] },
} as const satisfies Readonly<Record<string, WorldRoleSpec>>;
export type BuildingRole = keyof typeof ROLES;

/** The roles an asset uses, in its order (the first leads its look). */
export function roles<K extends BuildingRole>(...names: K[]): { [P in K]: (typeof ROLES)[P] } {
  const out = {} as { [P in K]: (typeof ROLES)[P] };
  for (const n of names) out[n] = ROLES[n];
  return out;
}

export const num = (v: unknown): number => v as number;
export const str = (v: unknown): string => v as string;
export const bool = (v: unknown): boolean => v as boolean;

/** An upright post: a box (square timber, a stone pier) from y0 to y1. */
export const post = (role: string, x: number, z: number, y0: number, y1: number, half: number, extra: { name?: string; collide?: boolean; yaw?: number } = {}): DesignSolid =>
  solid.box(role, [x, (y0 + y1) / 2, z], [half, Math.max(1e-3, (y1 - y0) / 2), half], extra.yaw ?? 0, { name: extra.name ?? "post", collide: extra.collide ?? false });

/** A rail between two points: a capsule (a rope, a pipe, a rounded bar). */
export const rail = (role: string, a: Vec3, b: Vec3, r: number, name = "rail"): DesignSolid => solid.capsule(role, a, b, r, { name, collide: false });

/** Points along a polyline's run from a to b, `n` segments, with a sag (a rope's catenary as a parabola) of `sag` metres at the middle. */
export function sagLine(a: Vec3, b: Vec3, n: number, sag: number): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t] as Vec3;
  });
}

/**
 * Where a two-ended piece goes so its ends land on two points: the length between them (along the ground), the
 * rise from a to b, and a placement -- the pivot at a's height under the middle, turned so its +z end is at a.
 * (Bridges run along z: endA at +z. Walls and fences run along x: use `along: "x"`, endA at -x.)
 */
export function spanBetween(a: readonly [number, number, number], b: readonly [number, number, number], along: "z" | "x" = "z"): { length: number; rise: number; pos: Vec3; yaw: number } {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const length = Math.hypot(dx, dz);
  const pos: Vec3 = [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2];
  // (z: the local +z end at a -- its front faces from b toward a. x: the local +x end at b -- right = (b - a) = (cos yaw, -sin yaw).)
  const yaw = along === "z" ? Math.atan2(-dx, -dz) : Math.atan2(-dz, dx);
  return { length, rise: b[1] - a[1], pos, yaw };
}
