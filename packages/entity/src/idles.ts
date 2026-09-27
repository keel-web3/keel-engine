// Idle acts: what a person standing about does with themselves -- on their
// phone, on a call, arms crossed, hands on their hips or in their pockets,
// checking the time, looking up and down the street, stretching, waving,
// tapping a foot, shifting their weight. Each is built on the idle clip
// (clips.ts), so the breathing carries on underneath, and played by time: a
// loop of `period` seconds (phase 0..1), with the moves in it eased in and out
// so any moment of it is a pose a person would hold.
//
// The idle clip and the body contract stay as they are: an act is looked up
// here, like an action (actions.ts).
//
//   const pose = idleActPose(spec, "phone", t / IDLE_PERIOD.phone % 1, t);
//   const skeleton = posedIdle(spec, "phone", t);

import { clamp, dsin, fract, TAU } from "@keel-engine/core";
import type { Vec3Like } from "@keel-engine/core";
import { HUMANOID_CLIPS } from "./clips.ts";
import type { ClipPose } from "./clips.ts";
import { poseSkeleton } from "./rig.ts";
import type { IkGoal, Skeleton } from "./rig.ts";
import type { HumanoidSpec } from "./species.ts";

/** What a person can be doing, standing about. */
export const IDLE_ACTS = ["stand", "shift", "phone", "call", "arms", "hips", "pockets", "watch", "look", "stretch", "wave", "tap"] as const;
export type IdleAct = (typeof IDLE_ACTS)[number];

/** How long one loop of each act takes, seconds. */
export const IDLE_PERIOD: Readonly<Record<IdleAct, number>> = {
  stand: 6.8, shift: 7.6, phone: 9.5, call: 8.2, arms: 8.8, hips: 7.4, pockets: 8.4, watch: 6.2, look: 7.2, stretch: 7.8, wave: 3.6, tap: 2.4,
};

// (A smooth 0..1 between two phases; up then back down over [a, b] .. [c, d].)
const ramp = (x: number, a: number, b: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hold = (x: number, a: number, b: number, c: number, d: number): number => Math.min(ramp(x, a, b), 1 - ramp(x, c, d));
const SIDES = [["L", -1], ["R", 1]] as const;

/** Where a person's parts are over their feet (the root frame: +x right, +y up, +z front). */
function frame(spec: HumanoidSpec) {
  const b = spec.body;
  const shoulder = b.hipH + b.torso * 0.92;
  return {
    b, shoulder, chest: b.hipH + b.torso * 0.62, waist: b.hipH + b.torso * 0.12,
    ear: shoulder + b.neck + b.headR * 1.1, front: b.torsoR,
  };
}
const hand = (at: Vec3Like, pole?: Vec3Like): IkGoal => ({ at: [at[0], at[1], at[2]], w: 1, ...(pole ? { pole: [pole[0], pole[1], pole[2]] } : {}) });
const turn = (p: ClipPose, bone: string, dx: number, dy: number, dz = 0): void => {
  const [x, y, z] = p.rot[bone] ?? [0, 0, 0];
  p.rot[bone] = [x + dx, y + dy, z + dz];
};

/** One idle act's pose at a phase (0..1) of its loop; `t` seconds drives the breathing under it. */
export function idleActPose(spec: HumanoidSpec, act: IdleAct, phase: number, t = 0): ClipPose {
  const p = HUMANOID_CLIPS.idle(spec, t, { phase: 0, landT: 99 });
  const f = frame(spec), b = f.b, u = fract(phase);
  const reach = b.hipH - b.ankleH, w = b.hipW;
  // (The idle clip looks about slowly on its own: an act that looks somewhere says where instead.)
  const head = (pitch: number, yaw: number): void => { p.rot["head"] = [pitch, yaw, 0]; };
  switch (act) {
    case "stand": break;
    case "shift": {
      // Weight onto one leg, the other knee easing, the hips dropping to that side; over to the other and back.
      const s = dsin(TAU * u);
      p.root.off = [p.root.off[0] + s * w * 0.35, p.root.off[1] - Math.abs(s) * reach * 0.015, p.root.off[2]];
      p.root.roll = -s * 0.05;
      for (const [side, x] of SIDES) {
        const soft = Math.max(0, -s * x);
        p.ik[`leg.${side}`] = { at: [x * w * 1.2, b.ankleH + soft * reach * 0.04, soft * reach * 0.06], w: 1, yaw: x * 0.15 };
      }
      turn(p, "chest", 0, 0, s * 0.04);
      break;
    }
    case "phone": {
      // Both hands in front of the chest, the head bowed over it; now and then a glance up.
      const up = hold(u, 0.55, 0.62, 0.7, 0.78);
      p.ik["arm.R"] = hand([b.shoulderW * 0.2, f.chest - b.torso * 0.12, f.front + reach * 0.17], [0.4, -1, -0.2]);
      p.ik["arm.L"] = hand([-b.shoulderW * 0.05, f.chest - b.torso * 0.15, f.front + reach * 0.15], [-0.4, -1, -0.2]);
      turn(p, "neck", 0.25 * (1 - up), 0);
      head(0.45 * (1 - up) - 0.05, 0.25 * up * dsin(TAU * u * 3));
      break;
    }
    case "call": {
      // A phone to the right ear, the other hand on the hip or hanging; pacing the talk with a nod and a turn.
      const talk = dsin(TAU * u * 2);
      p.ik["arm.R"] = hand([b.headR * 1.05, f.ear - b.headR * 0.35, b.headR * 0.35], [0.35, -1, 0.25]);
      if (u < 0.5) p.ik["arm.L"] = hand([-w * 1.35, f.waist + b.torso * 0.05, -f.front * 0.1], [-1, 0, -0.4]);
      head(0.08 + 0.05 * talk, -0.25 * dsin(TAU * u));
      turn(p, "chest", 0, 0.12 * dsin(TAU * u));
      break;
    }
    case "arms": {
      // Arms folded across the chest, the weight back on the heels.
      p.ik["arm.L"] = hand([b.shoulderW * 0.45, f.chest - b.torso * 0.02, f.front * 1.25], [-0.6, -0.5, 0.2]);
      p.ik["arm.R"] = hand([-b.shoulderW * 0.45, f.chest + b.torso * 0.04, f.front * 1.35], [0.6, -0.5, 0.2]);
      p.root.pitch = -0.03;
      head(-0.05, 0.3 * dsin(TAU * u) * ramp(Math.abs(dsin(TAU * u)), 0.3, 0.9));
      break;
    }
    case "hips": {
      // Hands on the hips, elbows out; a look one way down the street, and the other.
      for (const [side, x] of SIDES) p.ik[`arm.${side}`] = hand([x * b.shoulderW * 0.95, f.waist, -f.front * 0.1], [x, 0, -0.35]);
      turn(p, "chest", -0.03, 0);
      head(0, 0.45 * (hold(u, 0.15, 0.25, 0.4, 0.5) - hold(u, 0.6, 0.7, 0.85, 0.95)));
      break;
    }
    case "pockets": {
      // Hands in the front pockets, the shoulders up a little; a shift from foot to foot.
      for (const [side, x] of SIDES) p.ik[`arm.${side}`] = hand([x * w * 1.15, b.hipH - reach * 0.02, f.front * 0.55], [x * 0.6, 0, -1]);
      turn(p, "chest", 0.05, 0);
      const s = dsin(TAU * u);
      p.root.off = [p.root.off[0] + s * w * 0.18, p.root.off[1], p.root.off[2]];
      head(0.08, 0.2 * dsin(TAU * u * 0.5 + 1));
      break;
    }
    case "watch": {
      // The left wrist up in front, a look at it, down again; a glance up the road in between.
      const k = hold(u, 0.1, 0.22, 0.45, 0.58), glance = hold(u, 0.62, 0.72, 0.84, 0.94);
      p.ik["arm.L"] = { ...hand([-b.shoulderW * 0.05, f.chest - b.torso * 0.02, f.front + reach * 0.3], [-1, -0.3, -0.2]), w: k };
      head(0.4 * k - 0.02, 0.15 * k - 0.5 * glance);
      break;
    }
    case "look": {
      // Up and down the street: the head leading, the shoulders following, a pause each way.
      const s = hold(u, 0.05, 0.18, 0.36, 0.48) - hold(u, 0.55, 0.68, 0.86, 0.98);
      head(-0.02, 0.8 * s);
      turn(p, "chest", 0, 0.25 * s);
      turn(p, "spine", 0, 0.1 * s);
      break;
    }
    case "stretch": {
      // Arms up over the head by the sides, up on the toes a little, held, and down the way they went; then just standing.
      const k = hold(u, 0.08, 0.28, 0.42, 0.6);
      for (const [side, x] of SIDES) {
        turn(p, `upperArm.${side}`, -0.35 * k, 0, x * 2.75 * k);
        turn(p, `forearm.${side}`, 0.2 * k, 0);
      }
      turn(p, "spine", -0.08 * k, 0);
      head(-0.25 * k, 0);
      p.root.off = [p.root.off[0], p.root.off[1] + reach * 0.03 * k, p.root.off[2]];
      break;
    }
    case "wave": {
      // The right hand up, waving from the elbow; then down.
      const k = hold(u, 0.02, 0.14, 0.72, 0.88), wag = dsin(TAU * u * 5);
      p.rot["upperArm.R"] = [-0.5 * k + 0.04, 0, 0.1 + 1.9 * k];
      p.rot["forearm.R"] = [-0.25 - 0.3 * k, 0, 0.9 * k + 0.35 * wag * k];
      head(-0.05, 0.1 * k);
      break;
    }
    case "tap": {
      // The right foot tapping, heel down, toe up and down: impatient.
      const tap = Math.max(0, dsin(TAU * u * 2));
      p.ik["leg.R"] = { at: [w * 1.2, b.ankleH + tap * reach * 0.035, reach * 0.08], w: 1, yaw: 0.2, pitch: -0.35 * tap };
      for (const [side, x] of SIDES) p.ik[`arm.${side}`] = hand([x * w * 1.15, b.hipH - reach * 0.02, f.front * 0.55], [x * 0.6, 0, -1]);
      head(-0.04, 0.2 * dsin(TAU * u * 0.5));
      break;
    }
  }
  return p;
}

/** An act at `t` seconds into it, posed: a skeleton the skin (skin.ts) dresses. */
export function posedIdle(spec: HumanoidSpec, act: IdleAct, t: number, { pos = [0, 0, 0], yaw = 0 }: { pos?: Vec3Like; yaw?: number } = {}): Skeleton<"humanoid"> {
  return poseSkeleton(spec.rig, idleActPose(spec, act, t / IDLE_PERIOD[act], t), { pos, yaw }) as Skeleton<"humanoid">;
}

/**
 * Which act a person is doing: a pick for someone (their id, and which stop this is -- `visit` -- so the same person
 * stood somewhere else may do something else), weighted the way people stand about: most look at their phone, stand,
 * shift their weight or fold their arms; a few call, stretch or wave. `waiting` for something (a crossing, a bus): more
 * looking up the road and tapping a foot.
 */
export function idleActFor(seed: number, visit = 0, waiting = false): IdleAct {
  let h = Math.imul((seed ^ Math.imul(visit + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  const table: ReadonlyArray<readonly [IdleAct, number]> = waiting
    ? [["look", 5], ["tap", 3], ["phone", 4], ["stand", 2], ["arms", 2], ["pockets", 2], ["watch", 2], ["shift", 2], ["hips", 1]]
    : [["phone", 6], ["stand", 4], ["shift", 4], ["arms", 3], ["pockets", 3], ["hips", 2], ["call", 2], ["look", 2], ["watch", 2], ["stretch", 1], ["tap", 1], ["wave", 1]];
  const total = table.reduce((a, [, n]) => a + n, 0);
  let r = ((h >>> 0) / 0x1_0000_0000) * total;
  for (const [act, n] of table) { r -= n; if (r < 0) return act; }
  return "stand";
}
