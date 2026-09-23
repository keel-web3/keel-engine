// Skin: a spec and a posed skeleton -> capsules for the renderer, in the world.
// Ported from the proof of concept's src/entity/skin.js; the equality test
// proves the capsules identical. A sphere is a capsule with both ends
// together. Every capsule is tagged with the PART it is (so front detection,
// tests and games can find the face, the hands, the toes) and the ROLE its
// material plays (fur, cloth, ...), which a caller's table turns into the
// renderer's material numbers.
//
//   const caps = skinOf(spec, skeleton, { fur: 6, cloth: 7, accent: 8, dark: 3, blush: 9 });
//
// Parts (L is the entity's own left, R its right):
//   two legs   hips chest neck head eye.L eye.R brow.L brow.R nose snout ear.L ear.R
//              innerEar.L innerEar.R hair hair.back hood pack tail tail.tip accessory
//              upperArm.* forearm.* hand.* thigh.* shin.* foot.*
//   four legs  body chest neck head eye.* nose snout ear.* antler.* collar tail tail.mid tail.tip
//              upper.FL.. lower.FL.. paw.FL..
// A foot.* / paw.* capsule runs heel (a) -> toe (b): its b is the toe, on the front.

import type { Vec3, Vec3Like } from "@keel-engine/core";
import { boneToWorld } from "./rig.ts";
import type { Skeleton } from "./rig.ts";
import type { EntitySpec, HumanoidSpec, QuadrupedSpec } from "./species.ts";
import { dlen } from "@keel-engine/core";

/**
 * What a capsule's material plays. The first eight are the skin's; the rest are what wearables and props
 * name (a look fills every one: core's look.ts ROLES).
 */
export type Role = "fur" | "furAlt" | "cloth" | "clothAlt" | "accent" | "dark" | "blush" | "hair" | "skin" | "eye" | "primary" | "secondary" | "trim" | "detail" | "glow" | "metal";
export type MaterialTable = Readonly<Partial<Record<Role, number>>>;

/** A capsule in the world: ends a and b, radius r, the renderer's material, and what it is. */
export interface Capsule {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly r: number;
  readonly mat: number;
  readonly part: string;
  readonly role: Role;
}

/** WALLRUN's material numbers (projects/wallrun/palette.js), the default table. */
export const DEFAULT_MATERIALS: MaterialTable = Object.freeze({ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9 });
// (A role the caller's table leaves out falls back along here.)
const FALLBACK: Readonly<Partial<Record<Role, Role>>> = { furAlt: "fur", clothAlt: "dark", hair: "dark", accent: "cloth", blush: "fur", cloth: "fur", fur: "dark", skin: "fur", eye: "dark", primary: "cloth", secondary: "clothAlt", trim: "accent", detail: "dark", glow: "accent", metal: "dark" };
/** The most capsules a skin makes (the renderer holds 64 in a whole scene). */
export const MAX_CAPSULES = 28;

export function materialFor(role: Role, table: MaterialTable = DEFAULT_MATERIALS): number {
  let r: Role | undefined = role;
  for (let i = 0; i < 8 && r !== undefined && table[r] === undefined; i += 1) r = FALLBACK[r];
  return (r === undefined ? undefined : table[r]) ?? 0;
}

export interface SkinOptions {
  /** At most this many capsules (default MAX_CAPSULES). */
  readonly max?: number;
}

interface Draft { a: Vec3; b: Vec3; r: number; part: string; role: Role; drop: number }
interface Pen {
  cap(part: string, role: Role, a: Vec3, b: Vec3, r: number, drop?: number): void;
  ball(part: string, role: Role, p: Vec3, r: number, drop?: number): void;
  W(bone: string, local: Vec3Like): Vec3;
  P(bone: string): Vec3;
}
type Head = (x: number, y: number, z: number) => Vec3;

/**
 * skinOf(spec, skeleton, materials?, { max }) -> [{ a, b, r, mat, part, role }]
 * No more than `max` (28) capsules: the least important (inner ears first) go when a look runs over.
 */
export function skinOf(spec: EntitySpec, skel: Skeleton, materials: MaterialTable = DEFAULT_MATERIALS, { max = MAX_CAPSULES }: SkinOptions = {}): Capsule[] {
  const list: Draft[] = [];
  // (drop: 0 is essential; higher goes first when over budget)
  const pen: Pen = {
    cap: (part, role, a, b, r, drop = 0) => { list.push({ a, b, r, part, role, drop }); },
    ball: (part, role, p, r, drop = 0) => pen.cap(part, role, p, p, r, drop),
    W: (bone, local) => boneToWorld(skel, bone, local),
    P: (bone) => skel.bones[bone]!.p,
  };
  if (spec.plan === "quadruped") skinQuadruped(spec, skel, pen);
  else skinHumanoid(spec, skel, pen);
  let out = list;
  if (out.length > max) {
    // (Drop the most droppable, latest first, until it fits.)
    const order = out.map((c, i) => [c.drop, i] as const).sort((x, y) => y[0] - x[0] || y[1] - x[1]);
    const gone = new Set(order.slice(0, out.length - max).map(([, i]) => i));
    out = out.filter((_, i) => !gone.has(i));
  }
  return out.map(({ a, b, r, part, role }) => ({ a, b, r, mat: materialFor(role, materials), part, role }));
}

function skinHumanoid(spec: HumanoidSpec, skel: Skeleton, { cap, ball, W, P }: Pen): void {
  const B = spec.body;
  const F = spec.features;
  const O = spec.outfit;
  const human = spec.kind === "humanoid";
  const hr = B.headR;
  const T = B.torso;
  const longTop = O.top === "jacket" || O.top === "hoodie";
  const sleeves = longTop || O.top === "tee";
  const bare = O.top === "none";

  // The torso: a pelvis and a chest (a person's chest runs across the shoulders).
  cap("hips", longTop ? "cloth" : O.pants !== "none" ? "clothAlt" : bare ? "fur" : "cloth", P("hips"), P("spine"), B.torsoR * (human ? 0.9 : 0.93));
  if (human) cap("chest", bare ? "fur" : "cloth", W("chest", [-B.shoulderW * 0.42, T * 0.24, 0]), W("chest", [B.shoulderW * 0.42, T * 0.24, 0]), B.torsoR);
  else cap("chest", bare ? "fur" : "cloth", P("spine"), W("neck", [0, -B.torsoR * 0.35, 0]), B.torsoR);

  // A robe instead of legs: it hangs from the hips in rings that follow the legs' swing -- to the ankles over the
  // feet, or (hovering) tapering to a trailing tail with nothing under it.
  if (O.pants === "robe" || O.pants === "hover") {
    const hover = O.pants === "hover";
    const mid = (a: Vec3, b: Vec3, t = 0.5): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const hip = P("hips");
    const knee = mid(P("shin.L"), P("shin.R"));
    const ankle = mid(P("foot.L"), P("foot.R"));
    const w = B.torsoR;
    // (A cartoon's robe flares to a bell: the toon build widens the knees and the hem; true to life, a straight fall.)
    const t = spec.choices.kind === "humanoid" ? Math.max(0, Math.min(1, spec.choices.toon ?? 0)) : 0;
    const flare = (a: number, b: number): number => a + (b - a) * t;
    cap("robe", "cloth", hip, mid(hip, knee, 0.6), w * 1.05);
    cap("robe", "cloth", mid(hip, knee, 0.6), hover ? mid(knee, ankle, 0.35) : knee, w * flare(1.2, 1.35));
    if (hover) cap("robe.tail", "cloth", mid(knee, ankle, 0.35), [ankle[0] * 0.5 + knee[0] * 0.5, ankle[1] + (knee[1] - ankle[1]) * 0.25, ankle[2] * 0.5 + knee[2] * 0.5 - w * 0.5], w * flare(0.55, 0.8));
    else {
      cap("robe.hem", "clothAlt", knee, [ankle[0], ankle[1] + B.footR, ankle[2]], w * flare(1.35, 1.75));
      for (const s of ["L", "R"]) {
        const sole = -(B.ankleH - B.footR);
        cap(`foot.${s}`, O.shoes === "bare" ? "fur" : "dark", W(`foot.${s}`, [0, sole, -B.footLen * 0.05]), W(`foot.${s}`, [0, sole, B.footLen * 0.78]), B.footR);
      }
    }
  } else for (const s of ["L", "R"]) {
    cap(`thigh.${s}`, O.pants === "none" ? "fur" : "clothAlt", P(`thigh.${s}`), P(`shin.${s}`), B.legR);
    cap(`shin.${s}`, O.pants === "long" ? "clothAlt" : "fur", P(`shin.${s}`), P(`foot.${s}`), B.legR * 0.92);
    const sole = -(B.ankleH - B.footR);
    cap(`foot.${s}`, O.shoes === "bare" ? (F.coat === "socks" ? "furAlt" : "fur") : "dark", W(`foot.${s}`, [0, sole, -B.footLen * 0.18]), W(`foot.${s}`, [0, sole, B.footLen * 0.78]), B.footR);
  }
  // Arms: sleeves as far as the top has them, fur (or skin) past that.
  for (const s of ["L", "R"]) {
    cap(`upperArm.${s}`, sleeves ? "cloth" : "fur", P(`upperArm.${s}`), P(`forearm.${s}`), B.armR);
    cap(`forearm.${s}`, longTop ? "cloth" : "fur", P(`forearm.${s}`), P(`hand.${s}`), B.armR * 0.95);
    ball(`hand.${s}`, F.coat === "socks" ? "furAlt" : "fur", W(`hand.${s}`, [0, -B.handLen * 0.45, 0]), B.armR * (human ? 1.15 : 1.3));
  }

  // The head. Its centre sits a radius up the head bone; the face is its +z.
  const C: Head = (x, y, z) => W("head", [x * hr, hr * (1 + y), z * hr]);
  if (human) cap("neck", "fur", P("neck"), P("head"), B.armR * 1.25);
  ball("head", "fur", C(0, 0, 0.04), hr);
  const er = F.eyes.r * hr;
  if (F.frogEyes) {
    for (const [s, x] of [["L", -1], ["R", 1]] as const) {
      ball(`brow.${s}`, "fur", C(x * 0.5, 0.62, 0.42), hr * 0.34);
      ball(`eye.${s}`, "dark", C(x * 0.5, 0.72, 0.72), er);
    }
  } else {
    for (const [s, x] of [["L", -1], ["R", 1]] as const) ball(`eye.${s}`, "dark", C(x * F.eyes.spread, 0.02, 0.88), er);
  }
  const sn = F.snout;
  if (human) ball("nose", "fur", C(0, -0.12, 0.98), hr * 0.12);
  else if (sn > 0.3) {
    cap("snout", F.coat === "muzzle" ? "furAlt" : "fur", C(0, -0.3, 0.55), C(0, -0.32, 0.72 + sn), hr * 0.3);
    ball("nose", spec.species === "bear" || spec.species === "dog" ? "dark" : "blush", C(0, -0.2, 0.98 + sn), hr * 0.12);
  } else if (sn > 0) {
    if (F.coat === "muzzle") ball("snout", "furAlt", C(0, -0.3, 0.72), hr * 0.3);
    ball("nose", "blush", C(0, -0.18, 0.93 + sn * 0.6), hr * (0.07 + sn * 0.3));
  } else {
    ball("nose", "fur", C(0, -0.25, 0.97), hr * 0.08); // (a frog: a nub of a nose, still on the front)
  }
  ears(spec, cap, ball, C, hr, skel.pose?.ears ?? 0);

  // Hair, hood, hat, pack, tail.
  const hair = F.hair;
  if (hair !== "none") {
    ball("hair", "hair", C(0, 0.14, -0.1), hr * 0.99);
    if (hair === "long") cap("hair.back", "hair", C(0, 0.1, -0.4), C(0, -1.25, -0.55), hr * 0.66);
    if (hair === "bun") ball("hair.back", "hair", C(0, 0.95, -0.5), hr * 0.42);
    if (hair === "spiky") cap("hair.back", "hair", C(0, 0.4, -0.15), C(0, 1.05, -0.5), hr * 0.5);
    if (hair === "pony") cap("hair.back", "hair", C(0, 0.45, -0.9), C(0, -0.7, -1.3), hr * 0.3);
  }
  if (O.hood) cap("hood", "cloth", C(0, 0.06, -0.3), C(0, -0.4, -0.45), hr * 0.95, 4);
  const acc = O.accessory;
  if (acc === "scarf") cap("accessory", "accent", W("neck", [-B.torsoR * 0.55, 0, B.torsoR * 0.2]), W("neck", [B.torsoR * 0.55, 0, B.torsoR * 0.2]), B.armR * 1.15, 3);
  if (acc === "cap") cap("accessory", "accent", C(0, 0.72, -0.1), C(0, 0.55, 0.78), hr * 0.48, 3);
  if (acc === "goggles") cap("accessory", "dark", C(-0.55, 0.42, 0.78), C(0.55, 0.42, 0.78), hr * 0.18, 3);
  if (acc === "headband") cap("accessory", "accent", C(-0.62, 0.5, 0.62), C(0.62, 0.5, 0.62), hr * 0.12, 3);
  if (O.pack !== "none") {
    const pr = B.torsoR * (O.pack === "round" ? 0.95 : O.pack === "tall" ? 0.72 : 0.7);
    const back = -(B.torsoR + pr * 0.45);
    if (O.pack === "tall") cap("pack", "accent", W("chest", [0, -T * 0.08, back]), W("chest", [0, T * 0.3, back]), pr, 2);
    else ball("pack", "accent", W("chest", [0, T * 0.12, back]), pr, 2);
  }
  tail(spec, cap, ball, P, W, B.legR, B.torsoR);
}

// Ears by shape, on the top of the head, leaning out; `back` sweeps them back (a run, a fall).
function ears(spec: EntitySpec, cap: Pen["cap"], ball: Pen["ball"], C: Head, hr: number, back: number): void {
  const E = spec.features.ears;
  if (E.shape === "none" || !(E.len > 0)) return;
  const sp = E.spread;
  const up = Math.sqrt(Math.max(0, 1 - sp * sp));
  for (const [s, x] of [["L", -1], ["R", 1]] as const) {
    const base: Vec3 = [x * sp * 0.95, up * 0.95, -0.05];
    let dir: Vec3;
    if (E.shape === "lop") dir = [x * 0.75, -0.62, -0.15];
    else if (E.shape === "flop") dir = [x * 0.45, -0.88, 0.1];
    else if (E.shape === "side") dir = [x * 0.95, 0.3, -0.15];
    else dir = [x * 0.28, 1, -0.08 - back * 0.9];
    const l = dlen(dir);
    const tip: Vec3 = [base[0] + (dir[0] / l) * E.len, base[1] + (dir[1] / l) * E.len, base[2] + (dir[2] / l) * E.len];
    if (E.shape === "round" || E.shape === "big") { ball(`ear.${s}`, "fur", C(base[0] * 1.05, base[1] * 1.05, 0), E.w * hr); continue; }
    cap(`ear.${s}`, "fur", C(...base), C(...tip), E.w * hr);
    if (E.shape !== "flop" && E.shape !== "lop" && E.shape !== "side") {
      cap(`innerEar.${s}`, "blush", C(base[0], base[1], 0.02), C((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2 + E.w * 0.6), E.w * hr * 0.5, 9);
    }
  }
}

function tail(spec: EntitySpec, cap: Pen["cap"], ball: Pen["ball"], P: Pen["P"], W: Pen["W"], legR: number, bodyR: number): void {
  const T = spec.features.tail;
  if (T.shape === "none" || !(T.len > 0)) return;
  const quad = spec.plan === "quadruped";
  const tipOf = (bone: string): Vec3Like => spec.rig.bones[spec.rig.index[bone]!]!.tip!;
  const tip = quad ? W("tail2", tipOf("tail2")) : W("tail1", tipOf("tail1"));
  const tipped: Role = spec.features.coat === "tipped" ? "furAlt" : "fur";
  if (T.shape === "puff" || T.shape === "stub") { ball("tail", quad ? "furAlt" : "fur", P("tail0"), Math.max(T.len * (quad ? 0.3 : 0.9), legR)); return; }
  const r = T.shape === "bushy" ? bodyR * (quad ? 0.32 : 0.28) : T.shape === "thin" ? legR * 0.32 : legR * (quad ? 0.8 : 0.62);
  if (quad) {
    cap("tail", "fur", P("tail0"), P("tail1"), r * (T.shape === "bushy" ? 0.8 : 1));
    cap("tail.mid", "fur", P("tail1"), P("tail2"), r * (T.shape === "bushy" ? 1.25 : 1), 1);
    cap("tail.tip", tipped, P("tail2"), tip, r * (T.shape === "bushy" ? 1.15 : 0.9));
  } else {
    cap("tail", "fur", P("tail0"), P("tail1"), r * (T.shape === "bushy" ? 0.85 : 1));
    cap("tail.tip", tipped, P("tail1"), tip, r * (T.shape === "bushy" ? 1.3 : 0.9), 1);
  }
}

function skinQuadruped(spec: QuadrupedSpec, skel: Skeleton, { cap, ball, W, P }: Pen): void {
  const B = spec.body;
  const F = spec.features;
  const hr = B.headR;
  cap("body", "fur", W("pelvis", [0, 0, -B.bodyR * 0.15]), P("chest"), B.bodyR);
  ball("chest", "fur", W("chest", [0, -B.bodyR * 0.08, B.bodyR * 0.1]), B.bodyR * 1.08, 5);
  cap("neck", "fur", P("neck"), P("head"), Math.min(B.bodyR * 0.55, hr * 0.75));
  const C: Head = (x, y, z) => W("head", [x * hr, hr * (0.25 + y), hr * (0.5 + z)]);
  ball("head", "fur", C(0, 0, 0), hr);
  const sn = F.snout;
  cap("snout", F.coat === "muzzle" ? "furAlt" : "fur", C(0, -0.25, 0.4), C(0, -0.3, 0.55 + sn), hr * 0.42);
  ball("nose", spec.species === "cat" || spec.species === "rabbit" || spec.species === "mouse" ? "blush" : "dark", C(0, -0.14, 0.9 + sn), hr * 0.15);
  for (const [s, x] of [["L", -1], ["R", 1]] as const) ball(`eye.${s}`, "dark", C(x * F.eyes.spread * 1.1, 0.3, 0.84), F.eyes.r * hr);
  ears(spec, cap, ball, (x, y, z) => C(x, y, z - 0.1), hr, skel.pose?.ears ?? 0);
  if (F.antlers) {
    for (const [s, x] of [["L", -1], ["R", 1]] as const) {
      cap(`antler.${s}`, "furAlt", C(x * 0.35, 0.85, -0.1), C(x * 1.1, 2.4, -0.45), hr * 0.1);
      cap(`antler.${s}`, "furAlt", C(x * 0.75, 1.6, -0.27), C(x * 0.55, 2.3, 0.35), hr * 0.08, 6);
    }
  }
  if (spec.outfit.accessory === "collar") cap("collar", "accent", W("neck", [-B.bodyR * 0.5, 0, B.bodyR * 0.1]), W("neck", [B.bodyR * 0.5, 0, B.bodyR * 0.1]), B.legR * 0.9, 3);
  for (const k of ["FL", "FR", "HL", "HR"]) {
    const hind = k[0] === "H";
    cap(`upper.${k}`, "fur", P(`upper.${k}`), P(`lower.${k}`), B.legR * (hind ? 1.45 : 1.15));
    cap(`lower.${k}`, "fur", P(`lower.${k}`), P(`paw.${k}`), B.legR);
    const sole = -(B.ankleH - B.pawR);
    cap(`paw.${k}`, F.coat === "socks" ? "furAlt" : "fur", W(`paw.${k}`, [0, sole, -B.pawR * 0.3]), W(`paw.${k}`, [0, sole, B.pawLen]), B.pawR);
  }
  tail(spec, cap, ball, P, W, B.legR, B.bodyR);
}

/** Lowest point of a set of capsules (the soles, standing). */
export const lowestY = (caps: readonly Pick<Capsule, "a" | "b" | "r">[]): number => Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r));
/** Capsules of one part (or parts starting with a prefix: "eye." -> both eyes). */
export const partsOf = <C extends Pick<Capsule, "part">>(caps: readonly C[], name: string): C[] => caps.filter((c) => c.part === name || (name.endsWith(".") && c.part.startsWith(name)));
