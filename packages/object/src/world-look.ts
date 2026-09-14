// World looks: what a styled thing's roles wear. A tree's parts carry WORLD
// roles -- bark, leaf, blossom, moss; a house's wall, roof, trim, glass --
// named for what they are. The look system (core's look.ts, the bake's layer
// shader) paints SLOTS named by core's LOOK_ROLES; so each world role says
// which slot it paints (`as`) and what it is made of (stuff, patterns,
// finishes -- runtime's RoleSpec):
//
//   look: { roles: { bark: { as: "detail", stuff: "wood" }, leaf: { as: "primary", stuff: "cloth", patterns: ["none", "spots"] } } }
//
// A PROFILE is a season, a biome, a building culture: per world role, the
// ranges its colour is drawn from (hue, chroma, lightness), and maybe its
// finish and pattern -- so an autumn oak is always an autumn oak, and a
// thousand of them are a thousand different ones. worldLook() draws the ranges
// from the seed and hands them to core's lookOf as pins: a look is still a
// core Look (the bake's paintRoles takes it), keyed by the slots.

import { FINISHES, LOOK_ROLES, PATTERNS, lookOf, rampColours } from "@keel-engine/core";
import type { Finish, Look, LookProfile, LookRole, LookRoles, Pattern, RGB, RoleSpecLike } from "@keel-engine/core";
import { deriveSeed } from "@keel-engine/core";

/** A world role: the slot it paints, and what it is made of. */
export interface WorldRoleSpec extends RoleSpecLike {
  readonly as: LookRole;
}
export type WorldRoles = Readonly<Record<string, WorldRoleSpec>>;

/** The world roles, checked: every `as` is a look role, no two share one (a slot paints one thing). */
export function checkWorldRoles(owner: string, roles: WorldRoles): WorldRoles {
  const used = new Map<string, string>();
  for (const [name, r] of Object.entries(roles)) {
    if (!(LOOK_ROLES as readonly string[]).includes(r.as)) throw new RangeError(`${owner}: role ${name} paints "${r.as}", which isn't a look role (${LOOK_ROLES.join(", ")}).`);
    const had = used.get(r.as);
    if (had) throw new RangeError(`${owner}: roles ${had} and ${name} both paint ${r.as}.`);
    used.set(r.as, name);
    if (r.like !== undefined && !roles[r.like]) throw new RangeError(`${owner}: role ${name} is like "${r.like}", which it hasn't got.`);
  }
  return roles;
}

/** The look roles (core's, by slot) a thing's world roles make, in its order: what lookOf and the bake's paintRoles take. */
export function lookRolesOf(roles: WorldRoles): LookRoles {
  const out: Record<string, RoleSpecLike> = {};
  for (const r of Object.values(roles)) {
    const { as: slot, like, ...rest } = r;
    out[slot] = { ...rest, ...(like !== undefined ? { like: roles[like]!.as } : {}) };
  }
  return out;
}

/** A world role's slot (its index in LOOK_ROLES: the bake's slot); an unknown role is slot 0. */
export function slotOf(roles: WorldRoles, role: string): number {
  const r = roles[role];
  return r ? LOOK_ROLES.indexOf(r.as) : 0;
}

// ---------------------------------------------------------------- profiles

/** What a profile says about one world role: ranges to draw from, and a finish or patterns to use. */
export interface ProfileRole {
  /** Degrees; a range may wrap (340..20 is reds). */
  readonly hue?: readonly [number, number] | undefined;
  readonly chroma?: readonly [number, number] | undefined;
  readonly light?: readonly [number, number] | undefined;
  readonly span?: readonly [number, number] | undefined;
  readonly finish?: Finish | undefined;
  /** One is used, or one of a list is drawn. */
  readonly pattern?: Pattern | readonly Pattern[] | undefined;
}
/** A season, a biome, a culture: per world role, where its colours come from. */
export interface WorldProfile {
  readonly id: string;
  readonly title?: string | undefined;
  /** Core's harmony for anything the profile leaves open. */
  readonly harmony?: LookProfile | undefined;
  readonly roles: Readonly<Record<string, ProfileRole>>;
  readonly tags?: readonly string[] | undefined;
}

export function defineProfile(p: WorldProfile): WorldProfile {
  if (!/^[a-z][a-z0-9-]*$/.test(p.id)) throw new TypeError(`Profile id "${p.id}": lower-case letters, digits and dashes.`);
  for (const [role, r] of Object.entries(p.roles)) {
    if (r.finish !== undefined && !(FINISHES as readonly string[]).includes(r.finish)) throw new RangeError(`Profile ${p.id}: ${role}.finish "${r.finish}" isn't a finish.`);
    const pats = r.pattern === undefined ? [] : typeof r.pattern === "string" ? [r.pattern] : r.pattern;
    for (const x of pats) if (!(PATTERNS as readonly string[]).includes(x)) throw new RangeError(`Profile ${p.id}: ${role}.pattern "${x}" isn't a pattern.`);
  }
  return Object.freeze(p);
}

// (The same small generator core's looks use: FNV-1a over the label seeds mulberry32. Exact on every machine.)
function drawer(seed: string, label: string): () => number {
  let h = 0x811c9dc5;
  const text = `${seed}:${label}`;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const within = (f: () => number, [a, b]: readonly [number, number]): number => a + (b - a) * f();
const hueWithin = (f: () => number, [a, b]: readonly [number, number]): number => { const span = (((b - a) % 360) + 360) % 360; return (a + span * f()) % 360; };

export interface WorldLookOptions {
  readonly profile?: WorldProfile | undefined;
  /** Pins by world role ("leaf.hue", "bark.finish") or by slot ("primary.hue"), and "profile" (core's harmony). */
  readonly pins?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A look for a thing's world roles from a seed, in a profile: each role's colour drawn from the profile's ranges
 * (its own stream, a fixed number of draws: pinning one never moves another), everything the profile leaves
 * open drawn by core's lookOf. Pins win over both.
 */
export function worldLook(roles: WorldRoles, seed: string, { profile, pins = {} }: WorldLookOptions = {}): Look {
  const out: Record<string, unknown> = {};
  if (profile) {
    for (const [name, spec] of Object.entries(roles)) {
      const pr = profile.roles[name];
      const f = drawer(seed, `world/${profile.id}/${name}`);
      const u = [f(), f(), f(), f(), f()] as const;
      if (!pr) continue;
      const k = (x: number): (() => number) => () => x;
      if (pr.hue) out[`${spec.as}.hue`] = Math.round(hueWithin(k(u[0]), pr.hue));
      if (pr.chroma) out[`${spec.as}.chroma`] = within(k(u[1]), pr.chroma);
      if (pr.light) out[`${spec.as}.light`] = within(k(u[2]), pr.light);
      if (pr.span) out[`${spec.as}.span`] = within(k(u[3]), pr.span);
      if (pr.finish) out[`${spec.as}.finish`] = pr.finish;
      if (pr.pattern !== undefined) out[`${spec.as}.pattern`] = typeof pr.pattern === "string" ? pr.pattern : pr.pattern[Math.floor(u[4] * pr.pattern.length)];
    }
  }
  for (const [k, v] of Object.entries(pins)) {
    const dot = k.indexOf(".");
    if (dot < 0) { out[k] = v; continue; }
    const head = k.slice(0, dot);
    const slot = roles[head]?.as ?? head;
    out[`${slot}${k.slice(dot)}`] = v;
  }
  return lookOf(profile ? deriveSeed(seed, `profile/${profile.id}`) : seed, lookRolesOf(roles), { pins: out, ...(profile?.harmony ? { profile: profile.harmony } : {}) });
}

// ---------------------------------------------------------------- drawing it directly

/** A material as the pixel renderer takes it (@keel-engine/render's Material). */
export interface WorldMaterial { readonly ramp: string; readonly light?: number; readonly pattern?: number; readonly glow?: number }

/**
 * A look as the pixel renderer's palette and materials, for drawing a thing directly (previews, hero shots, the
 * showcase) instead of through the bake's layer shader: a ramp per world role, a material per role (4 and 5 are
 * left to the renderer's water and sky), and `mats` -- world role -> material index, for bakeForRenderer.
 */
export function rendererLook(roles: WorldRoles, look: Look, rampLen = 6): { colours: RGB[]; ramps: Record<string, [number, number]>; materials: WorldMaterial[]; mats: Record<string, number> } {
  const colours: RGB[] = [];
  const ramps: Record<string, [number, number]> = {};
  const materials: WorldMaterial[] = [];
  const mats: Record<string, number> = {};
  const pad = (): void => { while (materials.length === 4 || materials.length === 5) materials.push({ ramp: materials.length === 4 ? "water" : "sky" }); };
  for (const [name, spec] of Object.entries(roles)) {
    const r = look.roles[spec.as];
    if (!r) continue;
    ramps[name] = [colours.length, rampLen];
    colours.push(...rampColours(r, rampLen));
    pad();
    mats[name] = materials.length;
    materials.push({ ramp: name, ...(r.finish === "glow" ? { glow: 0.6 } : {}) });
  }
  pad();
  // (Always six at least: 4 and 5 are there for the renderer to find, whatever came before them.)
  while (materials.length < 6) materials.push({ ramp: materials.length === 4 ? "water" : materials.length === 5 ? "sky" : Object.keys(mats)[0] ?? "sky" });
  // (The renderer's water and sky read materials 4 and 5: plain ramps, for a caller that draws no world of its own.)
  ramps["water"] ??= [colours.length, 3];
  if (ramps["water"][0] === colours.length) colours.push([30, 60, 90], [50, 90, 120], [80, 130, 160]);
  ramps["sky"] ??= [colours.length, 3];
  if (ramps["sky"][0] === colours.length) colours.push([20, 22, 30], [30, 33, 44], [44, 48, 62]);
  return { colours, ramps, materials, mats };
}
