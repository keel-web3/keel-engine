// Skeletons: bone trees with rest offsets in the entity's own frame (core
// frame: +z FRONT, +x its RIGHT hand, +y UP), posed by forward kinematics and
// a small two-bone IK for feet and hands. Ported from the proof of concept's
// src/entity/rig.js; test/poc-equality.test.ts proves it identical.
//
// Two body plans:
//   humanoid   hips, spine, chest, neck, head, L/R shoulder-upperArm-forearm-hand,
//              L/R thigh-shin-foot, and a two-bone tail (skinned only when the
//              spec has one) -- people, and ANTHRO animals on a person's body.
//   quadruped  pelvis, spine, chest, neck, head, four legs of upper-lower-paw
//              (FL FR HL HR: fore/hind, left/right), a three-bone tail.
//
// "L" is always the entity's own left (-x), "R" its right (+x). Every bone's
// rest frame is the entity's frame, so a rest offset reads straight off the
// convention: [0, 0, 1] is ahead of the parent, [1, 0, 0] to its right.
//
// A POSE is plain data, easy to blend (clips.ts makes them):
//   {
//     root: { yaw, pitch, roll, off, shift },      // the whole body about its ground point; off [x,y,z] moves the top
//                                                  // bone (bob, crouch), shift [x,y,z] moves everything (heading frame)
//     rot:  { boneName: [rx, ry, rz] },            // each bone about its own axes, Ry * Rx * Rz
//     ik:   { chainName: { at: [x, y, z], w, pitch, yaw } },  // an end target in the ROOT frame (feet planted), weight 0..1
//     ears, cycle                                  // extras the skin reads (ears swept back), the gait's cycle length
//   }
// Rotation signs (right-handed about the bone's own axis):
//   rx > 0  tips a bone that points up FORWARD, swings a hanging one BACK, tips a forward one DOWN
//           (and so LIFTS one pointing back, like a tail)
//   ry > 0  turns the bone's front (+z) toward its right hand (+x) -- the same way a yaw turns
//   rz > 0  tips a bone that points up toward -x (its left), swings a hanging one toward +x (its right)

import { add, cross, dot, frontOf, len, scale, sub } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import type { Mat3, Mat3Like } from "@keel-engine/scene";

// ---------------------------------------------------------------- types

export type Plan = "humanoid" | "quadruped";

/** One bone: its parent, its joint's offset from the parent's joint (rest, own frame), and where its end is. */
export interface Bone {
  readonly name: string;
  readonly parent: string | null;
  readonly off: Vec3;
  /** The far end of a bone nothing hangs off (a head's crown, a toe, a tail's tip), in its own frame. */
  readonly tip?: Vec3;
}

/** A two-bone IK chain: three bones (root, middle, end), the way its middle joint bends, and in whose frame. */
export interface Chain {
  readonly bones: readonly [string, string, string];
  readonly pole: Vec3;
  readonly poleIn: string;
  /** The rest lengths of the two bones the IK moves (kept exactly). */
  lengths: [number, number];
}
export type ChainInput = Omit<Chain, "lengths">;

/** Two-legged proportions (world units): what species.ts makes from a seed. */
export interface HumanoidBody {
  H: number;
  hipH: number;
  ankleH: number;
  footR: number;
  neck: number;
  torso: number;
  headR: number;
  torsoR: number;
  thigh: number;
  shin: number;
  footLen: number;
  hipW: number;
  shoulderW: number;
  upperArm: number;
  forearm: number;
  handLen: number;
  legR: number;
  armR: number;
  tailLen: number;
  stride: number;
}

/** Four-legged proportions (world units). */
export interface QuadrupedBody {
  shoulderH: number;
  hipH: number;
  ankleH: number;
  bodyR: number;
  legR: number;
  H: number;
  bodyLen: number;
  neckLen: number;
  neckRise: number;
  headR: number;
  w: number;
  upperF: number;
  lowerF: number;
  upperH: number;
  lowerH: number;
  pawR: number;
  pawLen: number;
  snoutLen: number;
  tailLen: number;
  tailRise: number;
  stride: number;
}

export interface Rig<B = HumanoidBody | QuadrupedBody, P extends Plan = Plan> {
  readonly plan: P;
  readonly bones: readonly Bone[];
  readonly index: Readonly<Record<string, number>>;
  readonly children: Readonly<Record<string, string[]>>;
  readonly chains: Readonly<Record<string, Chain>>;
  readonly body: B;
  /** The top bone (hips, pelvis): the one root.off moves. */
  readonly top: string;
}
export type HumanoidRig = Rig<HumanoidBody, "humanoid">;
export type QuadrupedRig = Rig<QuadrupedBody, "quadruped">;
export type AnyRig = HumanoidRig | QuadrupedRig;

/** The whole body about its ground point. */
export interface RootPose {
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Moves the top bone (bob, crouch). */
  off?: Vec3;
  /** Moves everything, feet and all, in the heading frame (onto a wall, off a ledge). */
  shift?: Vec3;
}

/** An IK chain's end target, in the ROOT frame. */
export interface IkGoal {
  at: Vec3;
  /** 0..1: how far from where FK leaves the end toward the target. */
  w?: number;
  pitch?: number;
  yaw?: number;
  /** The way the middle joint bends, in the chain's poleIn bone's frame (the chain's own when absent). */
  pole?: Vec3;
  /** Lie flat in the root frame (a planted foot); defaults to w >= 1. */
  flat?: boolean;
}

/** A pose: plain data (see the top). */
export interface Pose {
  root?: RootPose;
  rot?: Record<string, Vec3>;
  ik?: Record<string, IkGoal>;
  /** How far the ears are swept back, 0..1. */
  ears?: number;
  /** How far one gait cycle carries the body (0: not moving). */
  cycle?: number;
}

/** Where the entity stands: its ground point and heading. */
export interface Place {
  readonly pos?: Vec3Like;
  readonly yaw?: number;
}

/** A bone in the world: its joint and its rotation (local -> world). */
export interface PosedBone {
  readonly p: Vec3;
  readonly m: Mat3;
}

export interface Skeleton<P extends Plan = Plan> {
  readonly plan: P;
  readonly root: { readonly pos: Vec3; readonly yaw: number; readonly m: Mat3 };
  readonly bones: Readonly<Record<string, PosedBone>>;
  readonly pose: Pose;
}

// ---------------------------------------------------------------- 3x3 rotations (row-major, local -> world)

export const IDENTITY: Mat3Like = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3);
export const rotX = (a: number): Mat3 => { const c = Math.cos(a); const s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (a: number): Mat3 => { const c = Math.cos(a); const s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (a: number): Mat3 => { const c = Math.cos(a); const s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
export function mul(a: Mat3Like, b: Mat3Like): Mat3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  }
  return o as Mat3;
}
export const apply = (m: Mat3Like, v: Vec3Like): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** Ry(ry) * Rx(rx) * Rz(rz): yaw, then pitch, then roll (the order scene's rotation uses). */
export function euler(rx = 0, ry = 0, rz = 0): Mat3 {
  if (rx === 0 && ry === 0 && rz === 0) return [...IDENTITY] as Mat3;
  return mul(rotY(ry), mul(rotX(rx), rotZ(rz)));
}
/** The transpose: world -> local for a rotation. */
export const transpose = (m: Mat3Like): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

// (The proof of concept's unit: a zero vector stays zero, where core's norm would divide by one.)
const unit = (a: Vec3Like): Vec3 => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };

/** The rotation that takes unit vector u onto unit vector v (the shortest turn). */
export function rotateOnto(u: Vec3Like, v: Vec3Like): Mat3 {
  const c = dot(u, v);
  if (c > 1 - 1e-12) return [...IDENTITY] as Mat3;
  let k = cross(u, v);
  if (c < -1 + 1e-9) {
    // (Opposite: half a turn about anything perpendicular.)
    k = Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]);
    k = unit(k);
    return [2 * k[0] * k[0] - 1, 2 * k[0] * k[1], 2 * k[0] * k[2], 2 * k[1] * k[0], 2 * k[1] * k[1] - 1, 2 * k[1] * k[2], 2 * k[2] * k[0], 2 * k[2] * k[1], 2 * k[2] * k[2] - 1];
  }
  const s = len(k);
  k = scale(k, 1 / s);
  const t = 1 - c;
  const [x, y, z] = k;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

// ---------------------------------------------------------------- two-bone IK

export interface TwoBone {
  readonly mid: Vec3;
  readonly end: Vec3;
  readonly reached: boolean;
}

/**
 * Two bones from `a` of lengths L1, L2 reaching for `target`, the middle joint
 * bending toward `pole` (a world direction). Lengths are kept exactly: a target
 * out of reach is reached for along the line and fallen short of.
 */
export function solveTwoBone(a: Vec3Like, target: Vec3Like, L1: number, L2: number, pole: Vec3Like): TwoBone {
  const d = sub(target, a);
  let dist = len(d);
  const n = dist > 1e-9 ? scale(d, 1 / dist) : unit(pole);
  const lo = Math.abs(L1 - L2) + 1e-9;
  const hi = L1 + L2 - 1e-9;
  const reached = dist <= hi && dist >= lo;
  dist = Math.min(hi, Math.max(lo, dist));
  const end = add(a, scale(n, dist));
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  let q = sub(pole, scale(n, dot(pole, n)));
  if (len(q) < 1e-9) q = Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]);
  q = unit(q);
  const mid = add(a, add(scale(n, L1 * cosA), scale(q, L1 * sinA)));
  return { mid, end, reached };
}

// ---------------------------------------------------------------- body plans

/** A humanoid rig from proportions (species.ts makes these from a seed). */
export function humanoidRig(b: HumanoidBody): HumanoidRig {
  const T = b.torso;
  const tl = b.tailLen || b.torsoR * 0.5;
  const tailDir = unit([0, 0.55, -1]);
  const bones: Bone[] = [
    { name: "hips", parent: null, off: [0, b.hipH, 0] },
    { name: "spine", parent: "hips", off: [0, T * 0.28, 0] },
    { name: "chest", parent: "spine", off: [0, T * 0.3, 0] },
    { name: "neck", parent: "chest", off: [0, T * 0.42, 0] },
    { name: "head", parent: "neck", off: [0, b.neck, 0], tip: [0, b.headR * 2, 0] },
    { name: "tail0", parent: "hips", off: [0, T * 0.05, -b.torsoR * 0.8] },
    { name: "tail1", parent: "tail0", off: scale(tailDir, tl * 0.5), tip: scale(tailDir, tl * 0.5) },
  ];
  for (const [s, side] of [[-1, "L"], [1, "R"]] as const) {
    bones.push(
      { name: `shoulder.${side}`, parent: "chest", off: [s * b.shoulderW * 0.35, T * 0.36, 0] },
      { name: `upperArm.${side}`, parent: `shoulder.${side}`, off: [s * b.shoulderW * 0.65, 0, 0] },
      { name: `forearm.${side}`, parent: `upperArm.${side}`, off: [0, -b.upperArm, 0] },
      { name: `hand.${side}`, parent: `forearm.${side}`, off: [0, -b.forearm, 0], tip: [0, -b.handLen, 0] },
      { name: `thigh.${side}`, parent: "hips", off: [s * b.hipW, 0, 0] },
      { name: `shin.${side}`, parent: `thigh.${side}`, off: [0, -b.thigh, 0] },
      // (The foot's tip is the toe: ahead on +z, down at the sole.)
      { name: `foot.${side}`, parent: `shin.${side}`, off: [0, -b.shin, 0], tip: [0, -(b.ankleH - b.footR), b.footLen * 0.78] },
    );
  }
  return makeRig("humanoid", bones, {
    "leg.L": { bones: ["thigh.L", "shin.L", "foot.L"], pole: [0, 0, 1], poleIn: "hips" },
    "leg.R": { bones: ["thigh.R", "shin.R", "foot.R"], pole: [0, 0, 1], poleIn: "hips" },
    // (Elbows bend back and a little out.)
    "arm.L": { bones: ["upperArm.L", "forearm.L", "hand.L"], pole: [-0.35, 0, -1], poleIn: "chest" },
    "arm.R": { bones: ["upperArm.R", "forearm.R", "hand.R"], pole: [0.35, 0, -1], poleIn: "chest" },
  }, b);
}

/**
 * A quadruped rig from proportions. Fore legs bend at the wrist (the joint
 * shows forward), hind legs at the hock (it shows behind).
 */
export function quadrupedRig(b: QuadrupedBody): QuadrupedRig {
  const rise = (b.shoulderH - b.hipH) * 0.5;
  const seg = b.tailLen / 3;
  const tr = b.tailRise ?? 0.4;
  const tailDir: Vec3 = [0, Math.sin(tr), -Math.cos(tr)];
  const bones: Bone[] = [
    { name: "pelvis", parent: null, off: [0, b.hipH, -b.bodyLen / 2] },
    { name: "spine", parent: "pelvis", off: [0, rise, b.bodyLen / 2] },
    { name: "chest", parent: "spine", off: [0, rise, b.bodyLen / 2] },
    { name: "neck", parent: "chest", off: [0, b.bodyR * 0.35, b.bodyR * 0.45] },
    { name: "head", parent: "neck", off: [0, b.neckLen * Math.sin(b.neckRise), b.neckLen * Math.cos(b.neckRise)], tip: [0, 0, b.headR * 2] },
    { name: "tail0", parent: "pelvis", off: [0, b.bodyR * 0.3, -b.bodyR * 0.55] },
    { name: "tail1", parent: "tail0", off: scale(tailDir, seg) },
    { name: "tail2", parent: "tail1", off: scale(tailDir, seg), tip: scale(tailDir, seg) },
  ];
  for (const [s, side] of [[-1, "L"], [1, "R"]] as const) {
    for (const [end, parent, up, lo] of [["F", "chest", b.upperF, b.lowerF], ["H", "pelvis", b.upperH, b.lowerH]] as const) {
      const k = `${end}${side}`;
      bones.push(
        { name: `upper.${k}`, parent, off: [s * b.w, 0, 0] },
        { name: `lower.${k}`, parent: `upper.${k}`, off: [0, -up, 0] },
        { name: `paw.${k}`, parent: `lower.${k}`, off: [0, -lo, 0], tip: [0, -(b.ankleH - b.pawR), b.pawLen] },
      );
    }
  }
  const chains: Record<string, ChainInput> = {};
  for (const k of ["FL", "FR", "HL", "HR"] as const) {
    chains[`leg.${k}`] = { bones: [`upper.${k}`, `lower.${k}`, `paw.${k}`], pole: [0, 0, k[0] === "F" ? 1 : -1], poleIn: k[0] === "F" ? "chest" : "pelvis" };
  }
  return makeRig("quadruped", bones, chains, b);
}

function makeRig<B, P extends Plan>(plan: P, bones: Bone[], chains: Record<string, ChainInput>, body: B): Rig<B, P> {
  const index: Record<string, number> = {};
  bones.forEach((bone, i) => {
    if (bone.parent !== null && index[bone.parent] === undefined) throw new Error(`${plan}: ${bone.name} comes before its parent ${bone.parent}`);
    index[bone.name] = i;
  });
  const children: Record<string, string[]> = Object.fromEntries(bones.map((bn) => [bn.name, []]));
  for (const bn of bones) if (bn.parent) children[bn.parent]!.push(bn.name);
  // Each chain's rest lengths (the IK keeps them).
  const full = chains as Record<string, Chain>;
  for (const c of Object.values(full)) c.lengths = [len(bones[index[c.bones[1]]!]!.off), len(bones[index[c.bones[2]]!]!.off)];
  return { plan, bones, index, children, chains: full, body, top: bones[0]!.name };
}

/** Rest length of every bone that has a parent bone (its offset from that parent). */
export function restLengths(rig: Rig): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bn of rig.bones) if (bn.parent) out[bn.name] = len(bn.off);
  return out;
}

/** Every bone's joint at rest (no pose), in the entity's own frame: the sum of the offsets down from the top. */
export function restJoints(rig: Rig): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const bn of rig.bones) out[bn.name] = bn.parent ? add(out[bn.parent]!, bn.off) : [...bn.off];
  return out;
}

// ---------------------------------------------------------------- posing

/**
 * Pose a rig into the world. `place` is where the entity stands: its ground
 * point `pos` and its heading `yaw` (core frame: yaw 0 faces +z).
 * Returns a skeleton: { plan, root: { pos, yaw, m }, bones: { name: { p, m } }, pose }
 * where p is the bone's joint in the world and m its world rotation.
 */
export function poseSkeleton<P extends Plan>(rig: Rig<unknown, P>, pose: Pose = {}, place: Place = {}): Skeleton<P> {
  const R = pose.root ?? {};
  const yaw = place.yaw ?? 0;
  // (root.shift moves the whole body, feet and all, in its heading frame: onto a wall, off a ledge.)
  const pos: Vec3Like = R.shift ? add(place.pos ?? [0, 0, 0], apply(rotY(yaw), R.shift)) : place.pos ?? [0, 0, 0];
  const rootM = mul(rotY(yaw + (R.yaw ?? 0)), mul(rotX(R.pitch ?? 0), rotZ(R.roll ?? 0)));
  const rot = pose.rot ?? {};
  const out: Record<string, PosedBone> = {};
  const fk = (bn: Bone): void => {
    const parent = bn.parent ? out[bn.parent]! : { p: pos, m: rootM };
    const off = bn.parent ? bn.off : add(bn.off, R.off ?? [0, 0, 0]);
    const r = rot[bn.name];
    out[bn.name] = { p: add(parent.p, apply(parent.m, off)), m: r ? mul(parent.m, euler(r[0], r[1], r[2])) : parent.m };
  };
  for (const bn of rig.bones) fk(bn);
  const refk = (name: string): void => { for (const c of rig.children[name]!) { fk(rig.bones[rig.index[c]!]!); refk(c); } };

  for (const [name, goal] of Object.entries(pose.ik ?? {})) {
    const chain = rig.chains[name];
    const w = goal?.w ?? 1;
    if (!chain || !(w > 0) || !goal.at) continue;
    const [b0, b1, b2] = chain.bones;
    const A = out[b0]!.p;
    const wanted = add(pos, apply(rootM, goal.at));
    const target = w >= 1 ? wanted : add(out[b2]!.p, scale(sub(wanted, out[b2]!.p), w));
    const pole = unit(apply(out[chain.poleIn]!.m, goal.pole ?? chain.pole));
    const [L1, L2] = chain.lengths;
    const { mid, end } = solveTwoBone(A, target, L1, L2, pole);
    // The two bones turn (shortest turn from where FK had them), the end lands on the target.
    const r0 = rig.bones[rig.index[b1]!]!.off;
    const r1 = rig.bones[rig.index[b2]!]!.off;
    const m0 = mul(rotateOnto(unit(apply(out[b0]!.m, r0)), unit(sub(mid, A))), out[b0]!.m);
    const e1 = rot[b1] ?? [0, 0, 0];
    const m1fk = mul(m0, euler(e1[0], e1[1], e1[2]));
    const m1 = mul(rotateOnto(unit(apply(m1fk, r1)), unit(sub(end, mid))), m1fk);
    out[b0] = { p: A, m: m0 };
    out[b1] = { p: mid, m: m1 };
    // (A planted end lies flat in the root frame, turned by its own pitch and yaw; a free one follows its bone.)
    const flat = goal.flat ?? w >= 1;
    const e2 = rot[b2] ?? [0, 0, 0];
    const m2 = flat ? mul(rootM, euler(goal.pitch ?? 0, goal.yaw ?? 0, 0)) : mul(m1, euler(e2[0], e2[1], e2[2]));
    out[b2] = { p: end, m: m2 };
    refk(b2);
  }
  return { plan: rig.plan, root: { pos: [...pos], yaw, m: rootM }, bones: out, pose };
}

/** A point in a bone's frame -> world. */
export const boneToWorld = (skel: Skeleton, name: string, local: Vec3Like): Vec3 => { const b = skel.bones[name]!; return add(b.p, apply(b.m, local)); };
/** A bone's own +z (its front) in the world. */
export const boneFront = (skel: Skeleton, name: string): Vec3 => apply(skel.bones[name]!.m, [0, 0, 1]);

/** Measured bone lengths of a posed skeleton (distance to the parent's joint). */
export function measuredLengths(rig: Rig, skel: Skeleton): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bn of rig.bones) if (bn.parent) out[bn.name] = len(sub(skel.bones[bn.name]!.p, skel.bones[bn.parent]!.p));
  return out;
}

/** The declared front of a posed skeleton: its heading (plus any root yaw in the pose). */
export const declaredFront = (skel: Skeleton): Vec3 => frontOf(skel.root.yaw + (skel.pose?.root?.yaw ?? 0));
