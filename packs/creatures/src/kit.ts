// What every body plan builds with: vectors, a PEN that records pieces by part
// and gives each the role its SLOT wears (one role a slot: a piece whose part
// has no role in the plan's table is a bug, and throws), sockets on bones, and
// choice streams (each choice its own, off the seed, so a pin never moves
// another).
//
// Part names follow keel/entity's skin (bake's slotOfPart reads the part up to
// its first dot): "head", "eye.L", "upper.M2L" (a leg's upper segment: the
// legUpper slot), "collar.band3" (a collar-slot band), "tail.tip" (tailTip).

import { createRoll, deriveSeed, dhypot, stream } from "@keel-engine/core";
import type { Stream, Vec3, Vec3Like } from "@keel-engine/core";
import { apply, boneToWorld, restJoints, transpose } from "@keel-engine/entity";
import type { EntitySocket, Rig, Role, Skeleton, SocketSits } from "@keel-engine/entity";

export type V3 = [number, number, number];

// ---------------------------------------------------------------- vectors

export const v = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: Vec3Like, b: Vec3Like, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const sub = (a: Vec3Like, b: Vec3Like): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3Like, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const lerp = (a: Vec3Like, b: Vec3Like, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const len = (a: Vec3Like): number => dhypot(a[0], a[1], a[2]);
export const unit = (a: Vec3Like): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------- the pen

/** A capsule and a box as bake's ExplicitSkin takes them. */
export interface SkinCapsule { readonly a: Vec3; readonly b: Vec3; readonly r: number; readonly part: string; readonly role: Role }
export interface SkinBox { readonly c: Vec3; readonly h: Vec3; readonly yaw: number; readonly part: string; readonly role: Role }
export interface CreatureSkin { readonly capsules: SkinCapsule[]; readonly boxes: SkinBox[] }

/** A plan's table: the role each part group (a part name up to its first dot, or "tail.tip") wears. */
export type SlotRoles = Readonly<Record<string, Role>>;

/** The group a part belongs to: its name up to the first dot ("tail.tip" is its own). */
export const groupOf = (part: string): string => (part === "tail.tip" ? "tail.tip" : part.split(".")[0]!);

export interface Pen {
  cap(part: string, a: Vec3Like, b: Vec3Like, r: number): void;
  ball(part: string, p: Vec3Like, r: number): void;
  box(part: string, c: Vec3Like, h: Vec3Like, yaw?: number): void;
  /** A world offset added to everything drawn from here on (a floater's lift). */
  offset: V3;
  done(): CreatureSkin;
}

export function pen(roles: SlotRoles): Pen {
  const capsules: SkinCapsule[] = [];
  const boxes: SkinBox[] = [];
  const roleOf = (part: string): Role => {
    const r = roles[groupOf(part)];
    if (!r) throw new RangeError(`No role for part "${part}" (group ${groupOf(part)}).`);
    return r;
  };
  const P: Pen = {
    offset: [0, 0, 0],
    cap(part, a, b, r) { capsules.push({ a: add(a, P.offset), b: add(b, P.offset), r, part, role: roleOf(part) }); },
    ball(part, p, r) { P.cap(part, p, p, r); },
    box(part, c, h, yaw = 0) { boxes.push({ c: add(c, P.offset), h: [h[0], h[1], h[2]], yaw, part, role: roleOf(part) }); },
    done: () => ({ capsules, boxes }),
  };
  return P;
}

// ---------------------------------------------------------------- bones

/** A posed skeleton's reader: joints, points in a bone's frame, a bone's axes, and a vector into a bone's frame. */
export interface Bones {
  P(bone: string): V3;
  W(bone: string, local: Vec3Like): V3;
  /** A direction in a bone's frame -> world. */
  D(bone: string, local: Vec3Like): V3;
  /** A world direction -> a bone's frame. */
  into(bone: string, world: Vec3Like): V3;
}
export function bones(skel: Skeleton): Bones {
  return {
    P: (b) => { const p = skel.bones[b]!.p; return [p[0], p[1], p[2]]; },
    W: (b, l) => { const p = boneToWorld(skel, b, l); return [p[0], p[1], p[2]]; },
    D: (b, l) => { const d = apply(skel.bones[b]!.m, l); return [d[0], d[1], d[2]]; },
    into: (b, w) => { const d = apply(transpose(skel.bones[b]!.m), w); return [d[0], d[1], d[2]]; },
  };
}

// ---------------------------------------------------------------- sockets

export interface SocketSite {
  readonly bone: string;
  /** Its origin in the bone's frame (= the own frame at rest). */
  readonly at: Vec3Like;
  readonly size: Vec3Like;
  readonly out: Vec3Like;
  readonly part: string;
  readonly sits: SocketSits;
}

/** Sockets from sites on a rig: each one's rest position is its bone's rest joint plus `at`. */
export function socketsFrom(rig: Rig, sites: Readonly<Record<string, SocketSite>>): Record<string, EntitySocket> {
  const rest = restJoints(rig);
  const out: Record<string, EntitySocket> = {};
  for (const [name, s] of Object.entries(sites)) {
    const j = rest[s.bone];
    if (!j) throw new RangeError(`Socket ${name}: the rig has no bone ${s.bone}.`);
    const at: Vec3 = [s.at[0], s.at[1], s.at[2]];
    out[name] = Object.freeze({ name, pos: [j[0] + at[0], j[1] + at[1], j[2] + at[2]] as Vec3, yaw: 0, size: [s.size[0], s.size[1], s.size[2]] as Vec3, bone: s.bone, at, out: unit(s.out) as Vec3, part: s.part, sits: s.sits });
  }
  return out;
}

// ---------------------------------------------------------------- choices

/** One choice: a list of values, or a numeric range. */
export type ChoiceSpec = readonly (string | number | boolean)[] | { readonly range: readonly [number, number] };

/** A choice's own stream: one seed, one label per plan and choice (neighbouring seeds start apart: derived twice). */
export const choiceStream = (seed: string, plan: string, name: string): Stream => stream(createRoll(deriveSeed(deriveSeed(`creature:${seed}`, plan), name)), 0);

/**
 * Every choice resolved: each draws from its own stream (always -- so a pin never moves another), weights optional
 * (list choices only, in the list's order); a pin wins, checked against the list or range.
 */
export function resolveChoices(seed: string, plan: string, defs: Readonly<Record<string, ChoiceSpec>>, pins: Readonly<Record<string, unknown>>, weights: Readonly<Record<string, readonly number[]>> = {}): Record<string, unknown> {
  for (const name of Object.keys(pins)) if (!Object.hasOwn(defs, name)) throw new TypeError(`A ${plan} has no choice "${name}" (choices: ${Object.keys(defs).join(", ")}).`);
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(defs)) {
    const S = choiceStream(seed, plan, name);
    let drawn: unknown;
    if (Array.isArray(def)) {
      const w = weights[name];
      drawn = w ? S.weighted(def.map((x, i) => [x, w[i] ?? 1] as const)) : S.pick(def);
    } else {
      const [lo, hi] = (def as { range: readonly [number, number] }).range;
      drawn = Math.round(S.between(lo, hi) * 1000) / 1000;
    }
    const pin = pins[name];
    if (pin === undefined) { out[name] = drawn; continue; }
    if (Array.isArray(def)) {
      if (!def.includes(pin as string)) throw new RangeError(`${plan} ${name} = ${JSON.stringify(pin)} is not one of ${JSON.stringify(def)}.`);
    } else {
      const [lo, hi] = (def as { range: readonly [number, number] }).range;
      if (typeof pin !== "number" || !(pin >= lo && pin <= hi)) throw new RangeError(`${plan} ${name} = ${JSON.stringify(pin)} is outside ${lo}..${hi}.`);
    }
    out[name] = pin;
  }
  return out;
}
