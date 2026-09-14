// Clips: procedural animation as pure functions. Ported from the proof of
// concept's src/entity/clips.js (the animator that blends them is
// animator.ts); the equality test proves every clip identical.
//
//   clip(spec, t, phase, params) -> pose        (rig.ts explains a pose)
//     t       seconds (breathing, looking about, balancing)
//     phase   { phase, landT }: phase is the gait cycle 0..1, advanced by DISTANCE
//             travelled, so a planted foot stays where it was put
//     params  { speed, vy, wall, wallGap, turn, seat }
//
// Legs are placed by IK: a foot in stance slides back under the body exactly as
// fast as the body goes forward (so it stands still in the world), a foot in
// swing arcs forward. A walk has both feet down at once, a run has both up.
// Arms swing against the legs. Every pose also says how far one cycle carries
// the body (`cycle`), which is how the animator turns distance into phase.

import { clamp, dcos, dsin, fract, TAU } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { poseSkeleton } from "./rig.ts";
import type { IkGoal, Plan, Pose, Skeleton } from "./rig.ts";
import type { EntitySpec, HumanoidSpec, QuadrupedSpec } from "./species.ts";

// (The proof of concept's smooth: one argument, clamped 0..1 -- core's takes an edge pair.)
const smooth = (v: number): number => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const SIDES = [["L", -1], ["R", 1]] as const;
const FEET = ["FL", "FR", "HL", "HR"] as const;
export type Foot = (typeof FEET)[number];

// ---------------------------------------------------------------- types

/** Where a clip is in its cycle: the gait phase 0..1, and seconds since landing. */
export interface ClipPhase {
  readonly phase: number;
  readonly landT?: number;
}
/** What a clip is told about the body. */
export interface ClipParams {
  /** Ground speed (run lean and duty; the move gait's blend). */
  readonly speed?: number;
  readonly vy?: number;
  /** +1: the wall is on its left; -1: on its right. */
  readonly wall?: number;
  /** How far its feet point is from the wall (the feet are moved onto it). */
  readonly wallGap?: number | undefined;
  /** Turn rate, rad/s, + to its right. */
  readonly turn?: number;
  /** Sit: the seat's height (0: the floor; default seatOf(spec)). */
  readonly seat?: number | undefined;
}

/** The pose a clip makes: every field of Pose there. */
export interface ClipPose extends Pose {
  root: { yaw: number; pitch: number; roll: number; off: Vec3; shift?: Vec3 };
  rot: Record<string, Vec3>;
  ik: Record<string, IkGoal>;
  ears: number;
  cycle: number;
}

export type Clip<S extends EntitySpec = EntitySpec> = (spec: S, t: number, ph: ClipPhase, params?: ClipParams) => ClipPose;

export type HumanoidClipName = "idle" | "walk" | "run" | "move" | "skim" | "jump" | "fall" | "land" | "wallRun" | "wallrun" | "grind" | "sit" | "turn";
export type QuadrupedClipName = "idle" | "move" | "walk" | "trot" | "gallop" | "bound" | "sit" | "lie" | "leap";
export type ClipName = HumanoidClipName | QuadrupedClipName;

/**
 * One foot through a cycle. q: its own phase 0..1 (0 = touch down). In stance
 * (q < duty) it goes from +s/2 to -s/2 at a steady rate; in swing it comes back
 * over an arc of height `lift`. Returns { z, y, stance, u } (u: progress in that part).
 */
export function footCycle(q: number, duty: number, s: number, lift: number): { z: number; y: number; stance: boolean; u: number } {
  if (q < duty) { const u = q / duty; return { z: s / 2 - s * u, y: 0, stance: true, u }; }
  const u = (q - duty) / (1 - duty);
  return { z: -s / 2 + s * smooth(u), y: lift * dsin(Math.PI * u), stance: false, u };
}

/** A pose with nothing in it (every clip starts from one). */
export const blankPose = (): ClipPose => ({ root: { yaw: 0, pitch: 0, roll: 0, off: [0, 0, 0] }, rot: {}, ik: {}, ears: 0, cycle: 0 });
const blank = blankPose;

export const LAND_TIME = 0.22;

// ---------------------------------------------------------------- two legs

function legsAt(spec: HumanoidSpec) {
  const b = spec.body;
  return { b, reach: b.hipH - b.ankleH, w: b.hipW };
}

/** How a two-legged gait moves (walk, run, skim; the move gait slides between). */
export interface BipedGait {
  duty: number; s: number; lift: number; bob: number; sway: number; crouch: number; lean: number;
  twist: number; armAmp: number; armOut: number; elbow: number; ears: number; armBack?: number;
}

/** A gait on two legs (walk, run, skim): cfg says how. */
function bipedGait(spec: HumanoidSpec, _t: number, ph: ClipPhase, _params: ClipParams, cfg: BipedGait): ClipPose {
  const { b, reach, w } = legsAt(spec);
  const p = blank();
  const s = cfg.s * reach * (b.stride ?? 1);
  const duty = cfg.duty;
  const zs: Record<string, number> = {};
  for (const [side, x] of SIDES) {
    const c = footCycle(fract(ph.phase + (x > 0 ? 0.5 : 0)), duty, s, cfg.lift * reach);
    zs[side] = c.z / (s / 2 || 1);
    p.ik[`leg.${side}`] = { at: [x * w * 1.05, b.ankleH + c.y, c.z], w: 1, pitch: c.stance ? 0 : 0.35 * dsin(Math.PI * c.u), yaw: x * 0.06 };
  }
  // Up and down twice a cycle (a walk vaults over the stance leg, a run sinks into it), side to side once.
  const mid = ph.phase - duty / 2;
  const sway = -cfg.sway * reach * dcos(TAU * mid);
  let lift = -cfg.crouch * reach + cfg.bob * reach * dcos(TAU * 2 * mid);
  // (Never so high a planted foot can't reach the ground: the hips drop into a long step.)
  const twist = cfg.twist * zs["L"]!;
  for (const [side, x] of SIDES) {
    const g = p.ik[`leg.${side}`]!;
    if (g.at[1] > b.ankleH + 1e-12) continue;
    const hx = sway + x * w * dcos(twist);
    const hz = -x * w * dsin(twist);
    const flat2 = (g.at[0] - hx) ** 2 + (g.at[2] - hz) ** 2;
    const high = b.ankleH + Math.sqrt(Math.max(0, (reach * 0.985) ** 2 - flat2)) - b.hipH;
    if (lift > high) lift = high;
  }
  p.root.off = [sway, lift, 0];
  p.rot["hips"] = [0, twist, 0];
  p.rot["spine"] = [cfg.lean, 0, 0];
  p.rot["chest"] = [cfg.lean * 0.3, -cfg.twist * 1.4 * zs["L"]!, 0];
  p.rot["neck"] = [-cfg.lean * 0.6, 0, 0];
  p.rot["head"] = [-cfg.lean * 0.5, cfg.twist * 0.5 * zs["L"]!, 0];
  for (const [side, x] of SIDES) {
    // (Leg forward, same arm back: a hanging bone swings back with +rx.)
    const k = zs[side]!;
    const arm = cfg.armBack ?? 0;
    p.rot[`upperArm.${side}`] = [arm + cfg.armAmp * k, 0, x * cfg.armOut];
    p.rot[`forearm.${side}`] = [-cfg.elbow - 0.35 * cfg.armAmp * Math.max(0, -k), 0, 0];
  }
  p.rot["tail0"] = [0.15 + cfg.lean * 0.4, 0.3 * dsin(TAU * ph.phase), 0];
  p.rot["tail1"] = [0.1, 0.35 * dsin(TAU * ph.phase - 0.8), 0];
  p.ears = cfg.ears;
  p.cycle = s / duty;
  return p;
}

export const WALK: Readonly<BipedGait> = { duty: 0.62, s: 0.85, lift: 0.16, bob: 0.03, sway: 0.035, crouch: 0.04, lean: 0.06, twist: 0.14, armAmp: 0.38, armOut: 0.1, elbow: 0.25, ears: 0.1 };
/** The run a speed calls for: faster -> less time on the ground and more in the air (a sprint is mostly flight). */
export const runCfg = (spec: HumanoidSpec, speed: number): BipedGait => {
  const v = speed / (Math.max(0.05, spec.body.hipH - spec.body.ankleH) * 10);
  return { duty: clamp(0.4 - 0.065 * v, 0.15, 0.38), s: 1.12, lift: 0.42, bob: -0.05, sway: 0.012, crouch: 0.1, lean: 0.3 + clamp(v * 0.03, 0, 0.12), twist: 0.2, armAmp: 0.85, armOut: 0.14, elbow: 1.35, ears: 0.6 };
};

const SEAT_SINK = 0.85;
/** The seat a two-legged spec sits on best: thighs level, feet flat (its knee height, less its bottom). */
export const seatOf = (spec: HumanoidSpec): number => spec.body.ankleH + spec.body.shin - spec.body.torsoR * SEAT_SINK;

/** Walk speed -> run speed, in leg lengths a second (the animator's "walk" below, "run" above). */
export const RUN_FROM = 4.5;
const mixCfg = (a: Readonly<BipedGait>, b: Readonly<BipedGait>, k: number): BipedGait => {
  const A = a as unknown as Record<string, number | undefined>;
  const B = b as unknown as Record<string, number | undefined>;
  return Object.fromEntries(Object.keys(b).map((n) => [n, (A[n] ?? 0) + ((B[n] ?? 0) - (A[n] ?? 0)) * k])) as unknown as BipedGait;
};

const idle: Clip<HumanoidSpec> = (spec, t) => {
  const { b, reach, w } = legsAt(spec);
  const p = blank();
  const br = dsin((TAU * t) / 3.4);
  p.root.off = [0, -reach * 0.035 + br * b.H * 0.004, 0];
  p.rot["spine"] = [0.03 + br * 0.012, 0, 0];
  p.rot["chest"] = [br * 0.02, 0, 0];
  p.rot["head"] = [-0.04 + 0.03 * dsin((TAU * t) / 5.1), 0.28 * dsin((TAU * t) / 7.3) * dsin((TAU * t) / 11.1), 0];
  for (const [side, x] of SIDES) {
    p.rot[`upperArm.${side}`] = [0.04, 0, x * (0.1 + br * 0.02)];
    p.rot[`forearm.${side}`] = [-0.25, 0, 0];
    p.ik[`leg.${side}`] = { at: [x * w * 1.15, b.ankleH, 0.01 * b.H], w: 1, yaw: x * 0.12 };
  }
  p.rot["tail0"] = [0.1, 0.3 * dsin((TAU * t) / 2.3), 0];
  p.rot["tail1"] = [0.2, 0.3 * dsin((TAU * t) / 2.3 - 0.9), 0];
  return p;
};

const wallRun: Clip<HumanoidSpec> = (spec, t, ph, params = {}) => {
  const p = bipedGait(spec, t, ph, params, runCfg(spec, params.speed ?? 8));
  const side = params.wall ?? 0;
  // (+roll tips the head toward -x; a wall on the left (side +1) tips it toward +x, away.)
  p.root.roll = -0.5 * side;
  // (Given how far the body is from the wall, the feet go onto it.)
  if (params.wallGap !== undefined && params.wallGap > 0 && side !== 0) p.root.shift = [-side * Math.max(0, params.wallGap - spec.body.footR), 0, 0];
  const near = side > 0 ? "L" : "R";
  if (side !== 0) { p.rot[`upperArm.${near}`] = [0.35, 0, -side * 1.25]; p.rot[`forearm.${near}`] = [-0.3, 0, 0]; }
  return p;
};

export const HUMANOID_CLIPS: Readonly<Record<HumanoidClipName, Clip<HumanoidSpec>>> = {
  /** Standing: breathing, looking about, arms loose. */
  idle,
  walk: (spec, t, ph) => bipedGait(spec, t, ph, {}, WALK),
  run: (spec, t, ph, params = {}) => bipedGait(spec, t, ph, params, runCfg(spec, params.speed ?? 8)),
  /**
   * Walk into run as ONE gait, its duty, stride, bob and arms sliding with the speed
   * (params.speed): what the animator plays on the ground, so there's no crossfade
   * between a foot in stance and the same foot in swing.
   */
  move(spec, t, ph, params = {}) {
    const reach = spec.body.hipH - spec.body.ankleH;
    const v = (params.speed ?? 0) / reach;
    const k = smooth((v - RUN_FROM * 0.55) / (RUN_FROM * 0.9));
    return bipedGait(spec, t, ph, params, k <= 0 ? WALK : mixCfg(WALK, runCfg(spec, params.speed ?? 0), k));
  },
  /** Low and fast over water: short quick steps, leaning in, arms straight back. */
  skim: (spec, t, ph) => bipedGait(spec, t, ph, {}, { duty: 0.3, s: 0.75, lift: 0.14, bob: -0.02, sway: 0.01, crouch: 0.24, lean: 0.55, twist: 0.1, armAmp: 0.15, armOut: 0.3, armBack: 0.95, elbow: 0.15, ears: 1 }),
  /** Going up: one knee tucked high, the other trailing, arms up. */
  jump(spec) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    p.ik["leg.L"] = { at: [-w, b.hipH - reach * 0.45, reach * 0.35], w: 1, pitch: 0.3 };
    p.ik["leg.R"] = { at: [w, b.ankleH + reach * 0.22, -reach * 0.3], w: 1, pitch: 0.5 };
    p.rot["spine"] = [0.15, 0, 0];
    p.rot["head"] = [-0.15, 0, 0];
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-1.7, 0, x * 0.45]; p.rot[`forearm.${side}`] = [-0.6, 0, 0]; }
    p.rot["tail0"] = [0.5, 0, 0];
    p.ears = 0.8;
    return p;
  },
  /** Coming down: legs reaching for the ground, arms up and out for balance. */
  fall(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    p.ik["leg.L"] = { at: [-w * 1.4, b.ankleH + reach * 0.2, reach * 0.18], w: 1, pitch: 0.3 };
    p.ik["leg.R"] = { at: [w * 1.4, b.ankleH + reach * 0.14, -reach * 0.08], w: 1, pitch: 0.35 };
    p.rot["spine"] = [-0.04, 0, 0];
    const flap = 0.12 * dsin(TAU * t * 2.2);
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-0.3, 0, x * (2 + flap)]; p.rot[`forearm.${side}`] = [-0.45, 0, 0]; }
    p.rot["tail0"] = [-0.3, 0, 0];
    p.ears = 1;
    return p;
  },
  /** Just landed: squashed down on planted feet, springing back as landT runs 0 -> LAND_TIME. */
  land(spec, _t, ph) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const sq = 1 - smooth((ph.landT ?? 0) / LAND_TIME);
    p.root.off = [0, -reach * (0.04 + 0.3 * sq), 0];
    p.rot["spine"] = [0.08 + 0.35 * sq, 0, 0];
    p.rot["head"] = [-0.25 * sq, 0, 0];
    for (const [side, x] of SIDES) {
      p.ik[`leg.${side}`] = { at: [x * w * 1.35, b.ankleH, x * 0.03 * reach], w: 1, yaw: x * 0.15 };
      p.rot[`upperArm.${side}`] = [-0.7 * sq, 0, x * (0.25 + 0.3 * sq)];
      p.rot[`forearm.${side}`] = [-0.5, 0, 0];
    }
    p.ears = 0.4 * sq;
    return p;
  },
  /**
   * Running along a wall: the run, tilted off it -- feet toward the wall, head away.
   * params.wall: +1 the wall is on its left, -1 on its right; params.wallGap: how far its
   * feet point is from the wall (optional: the feet are moved onto it).
   */
  wallRun,
  /** On a rail: crouched, feet one before the other, arms out, balancing. */
  grind(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const bal = dsin(TAU * t * 0.9);
    // (Balancing sways the body over planted feet: at the hips, not the root, so the feet stay on the rail.)
    p.root.off = [0.06 * reach * bal, -reach * 0.28, 0];
    p.rot["hips"] = [0, 0.3, 0.06 * bal];
    p.rot["spine"] = [0.25, 0, -0.1 * bal];
    p.rot["chest"] = [0.05, -0.2, 0];
    p.rot["head"] = [-0.2, -0.1, 0];
    p.ik["leg.L"] = { at: [-w * 0.55, b.ankleH, -reach * 0.3], w: 1, yaw: -0.5 };
    p.ik["leg.R"] = { at: [w * 0.55, b.ankleH, reach * 0.3], w: 1, yaw: 0.25 };
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-0.1, 0, x * (1.35 + 0.1 * bal * x)]; p.rot[`forearm.${side}`] = [-0.2, 0, 0]; }
    p.rot["tail0"] = [0, 0.4 * bal, 0];
    p.ears = 0.3;
    return p;
  },
  /**
   * Sitting on something params.seat high: thighs level, feet on the ground, hands on the knees.
   * The default seat is the one its legs fit (seatOf); a higher one leaves the feet dangling;
   * seat 0 is the floor (legs out ahead, hands behind).
   */
  sit(spec, t, _ph, params = {}) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const br = dsin((TAU * t) / 3.8);
    if (params.seat === 0) {
      const hy = b.torsoR * 0.95;
      const z = Math.sqrt(Math.max(0, (reach * 0.97) ** 2 - (hy - b.ankleH) ** 2));
      p.root.off = [0, hy - b.hipH, 0];
      for (const [side, x] of SIDES) {
        p.ik[`leg.${side}`] = { at: [x * w * 1.3, b.ankleH, z], w: 1, yaw: x * 0.2, pole: [0, 1, 0.2] };
        p.ik[`arm.${side}`] = { at: [x * (b.shoulderW + b.armR * 2), b.armR * 1.2, -b.torsoR * 1.3], w: 1 };
      }
    } else {
      // (It sits on its bottom: the hip joints ride a little under a torso's radius above the seat.)
      const hy = (params.seat ?? seatOf(spec)) + b.torsoR * SEAT_SINK;
      const drop = Math.sqrt(Math.max(0, (reach * 0.995) ** 2 - b.thigh ** 2));
      p.root.off = [0, hy - b.hipH, 0];
      for (const [side, x] of SIDES) {
        p.ik[`leg.${side}`] = { at: [x * w * 1.15, Math.max(b.ankleH, hy - drop), b.thigh], w: 1, yaw: x * 0.08, pole: [0, 0.35, 1] };
        p.ik[`arm.${side}`] = { at: [x * w * 1.25, hy + b.legR * 1.6, b.thigh * 0.75], w: 1 };
      }
    }
    p.rot["spine"] = [-0.04 + br * 0.01, 0, 0];
    p.rot["head"] = [0.05, 0.2 * dsin((TAU * t) / 9), 0];
    p.rot["tail0"] = [-0.45, 0.5, 0];
    p.rot["tail1"] = [-0.2, 0.6, 0];
    return p;
  },
  /** Turning on the spot: stepping foot to foot, the upper body leading. params.turn: turn rate (rad/s, + to its right). */
  turn(spec, t, ph, params = {}) {
    const { b, reach, w } = legsAt(spec);
    const p = idle(spec, t, ph);
    const q = fract(t * 1.8);
    for (const [side, x] of SIDES) {
      const u = x < 0 ? q * 2 : q * 2 - 1;
      const lift = u > 0 && u < 1 ? dsin(Math.PI * u) * reach * 0.12 : 0;
      p.ik[`leg.${side}`] = { at: [x * w * 1.15, b.ankleH + lift, 0.01 * b.H], w: 1, yaw: x * 0.12 - Math.sign(params.turn ?? 0) * 0.2 * (lift > 0 ? 1 : 0) };
    }
    p.rot["chest"] = [0, Math.sign(params.turn ?? 0) * 0.15, 0];
    p.rot["head"] = [0, Math.sign(params.turn ?? 0) * 0.3, 0];
    return p;
  },
  // (The proof of concept's alias, last, as it was added there.)
  wallrun: wallRun,
};

// ---------------------------------------------------------------- four legs

/** A gait by its footfalls: each foot's touch-down in the cycle, how long it stays down, how far it steps. */
export interface QuadGait {
  at: Record<Foot, number>;
  duty: number; s: number; lift: number; bob: number; flex: number; nod: number;
}

/** Gaits by their footfalls. */
export const GAITS: Readonly<Record<"walk" | "trot" | "gallop" | "bound", Readonly<QuadGait>>> = {
  // Lateral-sequence walk: hind left, fore left, hind right, fore right.
  walk: { at: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, duty: 0.66, s: 0.7, lift: 0.2, bob: 0.02, flex: 0.02, nod: 0.05 },
  // Trot: diagonal pairs together. (FR at 1 is FR at 0 -- written so a walk slides into it the short way.)
  trot: { at: { HL: 0, FR: 1, HR: 0.5, FL: 0.5 }, duty: 0.48, s: 0.9, lift: 0.3, bob: 0.03, flex: 0.03, nod: 0.04 },
  // Transverse gallop: the hinds one after the other, then the fores (the spine bends and stretches).
  gallop: { at: { HL: 0, HR: 0.1, FL: 0.42, FR: 0.52 }, duty: 0.3, s: 1.05, lift: 0.38, bob: 0.06, flex: 0.18, nod: 0.08 },
  // Bound (a rabbit's hop): the hinds together, then the fores together.
  bound: { at: { HL: 0, HR: 0.03, FL: 0.5, FR: 0.53 }, duty: 0.32, s: 1.1, lift: 0.45, bob: 0.08, flex: 0.25, nod: 0.06 },
};
const HOPPERS: ReadonlySet<string> = new Set(["rabbit", "mouse"]);
/** Walk -> trot and trot -> gallop speeds, in leg lengths a second (the middle of each blend). */
export const QUAD_GAIT_AT = { trot: 3.2, gallop: 7 } as const;
const GAIT_NUMS = ["duty", "s", "lift", "bob", "flex", "nod"] as const;
const mixGait = (a: Readonly<QuadGait>, b: Readonly<QuadGait>, k: number): QuadGait => ({
  at: Object.fromEntries((Object.keys(a.at) as Foot[]).map((f) => [f, a.at[f] + (b.at[f] - a.at[f]) * k])) as Record<Foot, number>,
  ...(Object.fromEntries(GAIT_NUMS.map((n) => [n, a[n] + (b[n] - a[n]) * k])) as Record<(typeof GAIT_NUMS)[number], number>),
});
/** The gait a quadruped uses at a speed: walk, trot, gallop (a hopper's trot and gallop are its bound), blended between. */
export function gaitAt(spec: QuadrupedSpec, speed: number): QuadGait {
  const v = speed / (spec.body.shoulderH - spec.body.ankleH);
  const hop = HOPPERS.has(spec.species);
  const trot = hop ? GAITS.bound : GAITS.trot;
  const fast = hop ? GAITS.bound : GAITS.gallop;
  const k1 = smooth((v - QUAD_GAIT_AT.trot * 0.75) / (QUAD_GAIT_AT.trot * 0.5));
  const k2 = smooth((v - QUAD_GAIT_AT.gallop * 0.8) / (QUAD_GAIT_AT.gallop * 0.4));
  return k2 > 0 ? mixGait(trot, fast, k2) : mixGait(GAITS.walk, trot, k1);
}

function quadAt(spec: QuadrupedSpec) {
  const b = spec.body;
  return { b, zF: b.bodyLen / 2, zH: -b.bodyLen / 2, rF: b.shoulderH - b.ankleH, rH: b.hipH - b.ankleH };
}

function quadGait(spec: QuadrupedSpec, _t: number, ph: ClipPhase, g: Readonly<QuadGait>): ClipPose {
  const { b, zF, zH, rF, rH } = quadAt(spec);
  const p = blank();
  const reach = (rF + rH) / 2;
  const s = g.s * reach * (b.stride ?? 1);
  for (const k of FEET) {
    const x = k[1] === "L" ? -1 : 1;
    const c = footCycle(fract(ph.phase - g.at[k]), g.duty, s, g.lift * (k[0] === "F" ? rF : rH));
    p.ik[`leg.${k}`] = { at: [x * b.w, b.ankleH + c.y, (k[0] === "F" ? zF : zH) + c.z], w: 1, pitch: c.stance ? 0 : -0.4 * dsin(Math.PI * c.u) };
  }
  const flex = g.flex * dsin(TAU * ph.phase);
  p.root.off = [0, -reach * 0.04 + g.bob * reach * dcos(TAU * 2 * ph.phase), 0];
  p.rot["pelvis"] = [flex * 0.5, 0, 0];
  p.rot["spine"] = [-flex, 0, 0];
  p.rot["chest"] = [flex * 0.5, 0, 0];
  p.rot["neck"] = [g.nod * dsin(TAU * 2 * ph.phase + 0.6), 0, 0];
  p.rot["tail0"] = [-(b.tailRise ?? 0.4) * g.flex * 2.5 + 0.1, 0.3 * dsin(TAU * ph.phase), 0];
  p.rot["tail1"] = [0.1, 0.35 * dsin(TAU * ph.phase - 0.7), 0];
  p.rot["tail2"] = [0.05, 0.35 * dsin(TAU * ph.phase - 1.4), 0];
  p.ears = g.flex;
  p.cycle = s / g.duty;
  return p;
}

// (Tip the pelvis back until the shoulders stand at `want` above the ground.)
function pitchFor(spec: QuadrupedSpec, pelvisY: number, want: number): number {
  const b = spec.body;
  const rise = b.shoulderH - b.hipH;
  const h = (a: number): number => pelvisY + rise * dcos(a) + b.bodyLen * dsin(-a);
  let lo = -1.35;
  let hi = 0;
  for (let i = 0; i < 24; i += 1) { const m = (lo + hi) / 2; if (h(m) > want) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export const QUADRUPED_CLIPS: Readonly<Record<QuadrupedClipName, Clip<QuadrupedSpec>>> = {
  idle(spec, t) {
    const { b, zF, zH, rF } = quadAt(spec);
    const p = blank();
    const br = dsin((TAU * t) / 3);
    p.root.off = [0, -rF * 0.03 + br * b.bodyR * 0.02, 0];
    p.rot["spine"] = [br * 0.01, 0, 0];
    p.rot["neck"] = [-0.05, 0.3 * dsin((TAU * t) / 6.7) * dsin((TAU * t) / 9.9), 0];
    p.rot["head"] = [0.05 * dsin((TAU * t) / 4.3), 0, 0];
    for (const k of FEET) p.ik[`leg.${k}`] = { at: [(k[1] === "L" ? -1 : 1) * b.w, b.ankleH, k[0] === "F" ? zF : zH], w: 1 };
    p.rot["tail0"] = [0.15, 0.4 * dsin((TAU * t) / 2.6), 0];
    p.rot["tail1"] = [0.1, 0.4 * dsin((TAU * t) / 2.6 - 0.8), 0];
    p.rot["tail2"] = [0.05, 0.4 * dsin((TAU * t) / 2.6 - 1.6), 0];
    return p;
  },
  /** Walk into trot into gallop as one gait, by params.speed (what the animator plays). */
  move: (spec, t, ph, params = {}) => quadGait(spec, t, ph, gaitAt(spec, params.speed ?? 0)),
  walk: (spec, t, ph) => quadGait(spec, t, ph, GAITS.walk),
  trot: (spec, t, ph) => quadGait(spec, t, ph, HOPPERS.has(spec.species) ? GAITS.bound : GAITS.trot),
  gallop: (spec, t, ph) => quadGait(spec, t, ph, HOPPERS.has(spec.species) ? GAITS.bound : GAITS.gallop),
  bound: (spec, t, ph) => quadGait(spec, t, ph, GAITS.bound),
  /** Sitting: haunches down, pelvis tipped back, fore legs straight, tail round the paws. */
  sit(spec, t) {
    const { b, zH, rF } = quadAt(spec);
    const p = blank();
    const py = b.bodyR * 1.12;
    const a = pitchFor(spec, py, b.ankleH + rF * 0.96);
    p.root.off = [0, py - b.hipH, 0];
    p.rot["pelvis"] = [a, 0, 0];
    p.rot["neck"] = [-a * 0.75, 0.25 * dsin((TAU * t) / 7), 0];
    p.rot["head"] = [-a * 0.2, 0, 0];
    // Where the shoulders went: up and back, round the pelvis.
    const rise = b.shoulderH - b.hipH;
    const zc = zH + rise * dsin(a) + b.bodyLen * dcos(a);
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w, b.ankleH, zc + b.pawLen * 0.2], w: 1 };
      // (The hind knee comes up by the flank, the hock goes down behind it.)
      p.ik[`leg.H${side}`] = { at: [x * b.w * 1.35, b.ankleH, zH + b.upperH * 0.9], w: 1, pole: [x * 0.3, 0.7, 1] };
    }
    // (A tail pointing back is LIFTED by +rx: this lays it down on the ground, then curls it round.)
    p.rot["tail0"] = [-(b.tailRise ?? 0.4) - a - 0.15, 0.5, 0];
    p.rot["tail1"] = [0.05, 0.7, 0];
    p.rot["tail2"] = [0, 0.7, 0];
    return p;
  },
  /** Lying down: belly on the ground, fore paws out ahead, hinds tucked, head up. */
  lie(spec, t) {
    const { b, zF, zH } = quadAt(spec);
    const p = blank();
    const br = dsin((TAU * t) / 3.6);
    const a = pitchFor(spec, b.bodyR * 1.1, b.bodyR * 1.25 + Math.max(0, b.shoulderH - b.hipH) * 0.3);
    p.root.off = [0, b.bodyR * 1.1 - b.hipH, 0];
    p.rot["pelvis"] = [a, 0, 0];
    p.rot["spine"] = [br * 0.015, 0, 0];
    p.rot["neck"] = [-0.25, 0.3 * dsin((TAU * t) / 8), 0];
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w * 1.1, b.ankleH, zF + b.upperF * 1.25], w: 1 };
      p.ik[`leg.H${side}`] = { at: [x * b.w * 1.9, b.ankleH, zH + b.upperH * 0.9], w: 1, yaw: x * 0.5, pole: [x * 0.8, 0.6, 0.5] };
    }
    p.rot["tail0"] = [-(b.tailRise ?? 0.4) - a - 0.1, 0.5, 0];
    p.rot["tail1"] = [0, 0.5, 0];
    p.rot["tail2"] = [0, 0.4, 0];
    return p;
  },
  /** In the air: fore legs reaching ahead, hinds stretched behind. */
  leap(spec) {
    const { b, zF, zH, rF, rH } = quadAt(spec);
    const p = blank();
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w, b.ankleH + rF * 0.55, zF + rF * 0.6], w: 1, pitch: -0.3 };
      p.ik[`leg.H${side}`] = { at: [x * b.w, b.ankleH + rH * 0.45, zH - rH * 0.65], w: 1, pitch: 0.6 };
    }
    p.rot["spine"] = [-0.08, 0, 0];
    p.rot["neck"] = [0.1, 0, 0];
    p.rot["tail0"] = [0.1, 0, 0];
    p.ears = 0.8;
    return p;
  },
};

/** A clip for whichever spec it's handed (a table's clips, erased to the spec union). */
export type AnyClip = Clip<EntitySpec>;

/** The clip table for a spec's body plan. */
export const clipsFor = (spec: { readonly plan: Plan }): Readonly<Record<string, AnyClip>> =>
  (spec.plan === "quadruped" ? QUADRUPED_CLIPS : HUMANOID_CLIPS) as unknown as Readonly<Record<string, AnyClip>>;
/** Which clips move the gait phase (the others hold it where it is). */
export const LOCOMOTION: ReadonlySet<string> = new Set(["walk", "run", "move", "skim", "wallRun", "trot", "gallop", "bound"]);
// How long each clip takes to fade in, in units of the animator's `fade` (a landing is sudden, lying down isn't).
export const FADES: Readonly<Record<string, number>> = { land: 0.85, jump: 0.9, fall: 1.5, sit: 2.5, lie: 3, turn: 1.5, idle: 1.5, gallop: 1.3, trot: 1.3 };

// ---------------------------------------------------------------- blending

/** Blend poses: [[pose, weight], ...] -> one pose (weights normalised). */
export function blendPoses(list: ReadonlyArray<readonly [ClipPose, number]>): ClipPose {
  let total = 0;
  for (const [, w] of list) total += w;
  if (!(total > 0)) return list.length ? list[0]![0] : blank();
  if (list.length === 1) return list[0]![0];
  const out = blank();
  const names = new Set<string>();
  const chains = new Set<string>();
  for (const [p] of list) { for (const n of Object.keys(p.rot)) names.add(n); for (const n of Object.keys(p.ik)) chains.add(n); }
  for (const n of names) out.rot[n] = [0, 0, 0];
  for (const [p, w0] of list) {
    const w = w0 / total;
    out.root.yaw += w * (p.root.yaw ?? 0); out.root.pitch += w * (p.root.pitch ?? 0); out.root.roll += w * (p.root.roll ?? 0);
    for (let i = 0; i < 3; i += 1) out.root.off[i]! += w * (p.root.off?.[i] ?? 0);
    if (p.root.shift) { out.root.shift ??= [0, 0, 0]; for (let i = 0; i < 3; i += 1) out.root.shift[i]! += w * p.root.shift[i]!; }
    for (const n of names) { const r = p.rot[n]; if (r) for (let i = 0; i < 3; i += 1) out.rot[n]![i]! += w * r[i]!; }
    out.ears += w * (p.ears ?? 0);
    out.cycle += w * (p.cycle ?? 0);
  }
  for (const n of chains) {
    let sw = 0;
    const g: IkGoal & { w: number; pitch: number; yaw: number } = { at: [0, 0, 0], w: 0, pitch: 0, yaw: 0 };
    let pole: number[] | null = null;
    for (const [p, w0] of list) {
      const e = p.ik[n];
      if (!e) continue;
      const w = w0 / total;
      sw += w;
      for (let i = 0; i < 3; i += 1) g.at[i]! += w * e.at[i]!;
      g.w += w * (e.w ?? 1); g.pitch += w * (e.pitch ?? 0); g.yaw += w * (e.yaw ?? 0);
      const ep = e.pole;
      if (ep) pole = pole ? pole.map((v, i) => v + w * ep[i]!) : ep.map((v) => v * w);
    }
    g.at = g.at.map((v) => v / sw) as Vec3; g.pitch /= sw; g.yaw /= sw;
    if (pole) g.pole = pole.map((v) => v / sw) as Vec3;
    // (A chain only some clips place blends toward where FK leaves it.)
    g.flat = g.w > 0.999;
    out.ik[n] = g;
  }
  return out;
}

// ---------------------------------------------------------------- one clip at one moment

export interface PosedOptions {
  readonly t?: number;
  readonly phase?: number;
  readonly params?: ClipParams;
  readonly pos?: Vec3Like;
  readonly yaw?: number;
  readonly landT?: number;
}

/** One clip at one moment, posed: for sheets, thumbnails and tests. */
export function posed<S extends EntitySpec>(spec: S, clip: string, { t = 0, phase = 0, params = {}, pos = [0, 0, 0], yaw = 0, landT = 0 }: PosedOptions = {}): Skeleton<S["plan"]> {
  const clips = clipsFor(spec);
  const fn = clips[clip];
  if (!fn) throw new RangeError(`No ${spec.plan} clip "${clip}" (${Object.keys(clips).join(", ")}).`);
  const pose = fn(spec, t, { phase, landT }, params);
  return poseSkeleton(spec.rig, pose, { pos, yaw }) as Skeleton<S["plan"]>;
}
