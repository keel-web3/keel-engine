// What a dungeon is dressed with: the world roles every prop draws from
// (each paints its own slot, so an act -- a crypt's cold stone, a forge's
// soot and brass, a ruin's moss -- recolours every prop at once, at no bake
// cost), choice helpers, and the small pieces props share: a skull, a bone,
// a candle, an iron band, a plank.
//
// Metres, the thing's own frame: +y up, the pivot in the middle of its base,
// +z its front (the side a wall-mounted thing shows the room). A prop that
// carries a flame names where in `meta.flames` ([x, y, z] in its own frame):
// the renderer draws the flame there and lights the room from it.

import { solid } from "@keel-engine/object";
import type { DesignSolid, WorldRoleSpec } from "@keel-engine/object";
import type { Stream, Vec3 } from "@keel-engine/core";
import { dcos, dsin } from "@keel-engine/core";

/** Every world role the dungeon uses, and the slot it paints (all distinct: one look paints them all). */
export const ROLES = {
  stone: { as: "primary", stuff: "bone", finishes: ["matte"], patterns: ["none", "none", "spots", "camo"] },
  wood: { as: "detail", stuff: "wood", finishes: ["matte"], patterns: ["bands", "none"] },
  metal: { as: "metal", stuff: "metal", finishes: ["metal"], patterns: ["none"] },
  gold: { as: "trim", stuff: "metal", finishes: ["metal"], patterns: ["none"] },
  cloth: { as: "clothAlt", stuff: "cloth", finishes: ["cloth"], patterns: ["none", "bands", "trim", "stripes"] },
  bone: { as: "fur", stuff: "bone", finishes: ["matte"], patterns: ["none"] },
  paper: { as: "furAlt", stuff: "bone", finishes: ["matte"], patterns: ["none", "bands"] },
  leather: { as: "hair", stuff: "leather", finishes: ["leather"], patterns: ["none"] },
  wax: { as: "skin", stuff: "paint", finishes: ["matte"], patterns: ["none"] },
  ichor: { as: "blush", stuff: "paint", finishes: ["matte"], patterns: ["none"] },
  moss: { as: "secondary", stuff: "cloth", finishes: ["matte"], patterns: ["none", "spots"] },
  web: { as: "eye", stuff: "bone", finishes: ["matte"], patterns: ["none"] },
  accent: { as: "accent", stuff: "paint", finishes: ["matte"], patterns: ["none"] },
  cushion: { as: "cloth", stuff: "cloth", finishes: ["cloth"], patterns: ["none", "checks"] },
  glow: { as: "glow", stuff: "glow", finishes: ["glow"], patterns: ["none"] },
  dark: { as: "dark", stuff: "dark", finishes: ["matte"], patterns: ["none"] },
} as const satisfies Readonly<Record<string, WorldRoleSpec>>;
export type DungeonRole = keyof typeof ROLES;

/** The roles an asset uses, in its order (the first leads its look's harmony). */
export function roles<K extends DungeonRole>(...names: K[]): { [P in K]: (typeof ROLES)[P] } {
  const out = {} as { [P in K]: (typeof ROLES)[P] };
  for (const n of names) out[n] = ROLES[n];
  return out;
}

/** The act profiles every prop can wear (see profiles.ts). */
export const ACTS = ["crypt", "cave", "forge", "ruin"] as const;

export const num = (v: unknown): number => v as number;
export const str = (v: unknown): string => v as string;
export const bool = (v: unknown): boolean => v as boolean;

/** An iron (or brass) band round an upright thing: a thin cylinder a hair wider than what it binds. */
export const band = (role: string, y: number, r: number, h = 0.05): DesignSolid => solid.cylinder(role, [0, y, 0], r, h, { name: "band", collide: false, sides: 8 });

/** A skull: a cranium, a jaw, two dark sockets facing `yaw` (0: +z). */
export function skull(out: DesignSolid[], at: Vec3, s = 0.12, yaw = 0, role = "bone"): void {
  const fx = dsin(yaw), fz = dcos(yaw), rx = dcos(yaw), rz = -dsin(yaw);
  out.push(solid.ball(role, [at[0], at[1] + s * 0.55, at[2]], [s * 0.5, s * 0.5, s * 0.55], { name: "skull", collide: false }));
  out.push(solid.ball(role, [at[0] + fx * s * 0.18, at[1] + s * 0.18, at[2] + fz * s * 0.18], [s * 0.34, s * 0.2, s * 0.34], { name: "jaw", collide: false }));
  for (const side of [-1, 1]) out.push(solid.ball("dark", [at[0] + fx * s * 0.42 + rx * side * s * 0.18, at[1] + s * 0.52, at[2] + fz * s * 0.42 + rz * side * s * 0.18], s * 0.12, { name: "socket", collide: false }));
}

/** A long bone from a to b: a shaft and its two knobbed ends. */
export function bone(out: DesignSolid[], a: Vec3, b: Vec3, r = 0.025, role = "bone"): void {
  out.push(solid.capsule(role, a, b, r, { name: "bone", collide: false }));
  out.push(solid.ball(role, a, r * 1.8, { name: "knob", collide: false }));
  out.push(solid.ball(role, b, r * 1.8, { name: "knob", collide: false }));
}

/** A candle standing at `at`: a wax stick and its tiny baked flame (the glow role); returns where the flame is. */
export function candle(out: DesignSolid[], at: Vec3, h = 0.18, r = 0.03): Vec3 {
  out.push(solid.cylinder("wax", at, r, h, { name: "candle", collide: false, sides: 8 }));
  const top: Vec3 = [at[0], at[1] + h + r * 1.2, at[2]];
  out.push(solid.ball("glow", top, [r * 0.8, r * 1.6, r * 0.8], { name: "flame", collide: false }));
  return top;
}

/** Planks side by side along x, `n` of them, each a box (a lid, a table top, a crate's face). */
export function planks(out: DesignSolid[], role: string, c: Vec3, h: Vec3, n: number, J: Stream, name = "plank"): void {
  const w = (h[0] * 2) / n;
  for (let i = 0; i < n; i += 1) {
    const x = c[0] - h[0] + w * (i + 0.5);
    const dy = J.between(-0.006, 0.006);
    out.push(solid.box(role, [x, c[1] + dy, c[2]], [w / 2 * 0.94, h[1], h[2]], 0, { name, collide: false }));
  }
}

/** A chain of links from a to b (alternating flat and edge-on boxes), `links` of them. */
export function chain(out: DesignSolid[], a: Vec3, b: Vec3, links: number, s = 0.035, role = "metal"): void {
  for (let i = 0; i < links; i += 1) {
    const t = (i + 0.5) / links;
    const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const turn = i % 2 === 0;
    out.push(solid.box(role, p, [turn ? s * 0.9 : s * 0.3, s * 1.2, turn ? s * 0.3 : s * 0.9], 0, { name: "link", collide: false }));
  }
}
