// Action clips: what a unit does on the spot when told to -- an attack, a
// use. The engine's addition (the proof of concept had none): the gait and
// idle tables (clips.ts) stay exactly the proof of concept's, and an action
// is looked up here after them (clipOf). Each is one cycle of `period`
// seconds, played by time (phase 0..1), built on the idle pose so the feet
// stay planted and the breathing carries on underneath.
//
//   attack   two legs: a wind-up over the right shoulder, a strike down and
//            across, the recovery; four legs: a crouch, a lunge with the
//            head down, back.
//   use      two legs: a reach forward and down with the right hand (open a
//            door, pick something up); four legs: a sniff.
//
//   const pose = clipOf(spec, "attack")(spec, t, { phase: 0.4, landT: 0 });

import { clamp } from "@keel-engine/core";
import { HUMANOID_CLIPS, QUADRUPED_CLIPS, clipsFor } from "./clips.ts";
import type { AnyClip, Clip, ClipPose } from "./clips.ts";
import type { EntitySpec, HumanoidSpec, QuadrupedSpec } from "./species.ts";
import type { Plan } from "./rig.ts";

/** An action's names. */
export type ActionClipName = "attack" | "use";

/** How long one action takes, seconds (what a bake's frames span and the animator plays over). */
export const ACTION_PERIOD: Readonly<Record<ActionClipName, number>> = { attack: 0.62, use: 0.9 };

// (A smooth 0..1 between two phases.)
const ramp = (x: number, a: number, b: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** The attack's arc through a cycle: wind-up to 0.38, strike to 0.56, recovery to 1 (0 rest, 1 wound, -1 struck). */
function arc(phase: number): number {
  if (phase < 0.38) return ramp(phase, 0.02, 0.38);
  if (phase < 0.56) return mix(1, -1, ramp(phase, 0.38, 0.56));
  return mix(-1, 0, ramp(phase, 0.56, 0.98));
}

const humanAttack: Clip<HumanoidSpec> = (spec, t, ph, params) => {
  const p = HUMANOID_CLIPS.idle(spec, t, ph, params);
  const a = arc(ph.phase);
  const wound = Math.max(0, a), struck = Math.max(0, -a);
  const b = spec.body;
  const reach = b.hipH - b.ankleH;
  // (A hanging bone swings forward with -rx: -2.7 is the arm raised over the head, -0.9 swung down in front.)
  p.rot["upperArm.R"] = [mix(mix(0.04, -2.7, wound), -0.95, struck), 0, mix(0.1, 0.35, wound) - 0.15 * struck];
  p.rot["forearm.R"] = [mix(-0.25, -1.3, wound) + 1.0 * struck, 0, 0];
  p.rot["upperArm.L"] = [mix(0.04, -0.5, wound) + 0.3 * struck, 0, -0.1 - 0.25 * wound];
  p.rot["forearm.L"] = [-0.25 - 0.6 * wound, 0, 0];
  // (Wind up turned toward its right -- the right shoulder back -- then strike across and lean in.)
  const [cx, , cz] = p.rot["chest"] ?? [0, 0, 0];
  const [sx] = p.rot["spine"] ?? [0, 0, 0];
  p.rot["chest"] = [cx - 0.12 * wound + 0.18 * struck, 0.38 * wound - 0.42 * struck, cz];
  p.rot["spine"] = [sx + 0.22 * struck - 0.06 * wound, 0.1 * wound - 0.12 * struck, 0];
  p.rot["head"] = [0.05 * struck, -0.2 * wound + 0.25 * struck, 0];
  // (A braced stance: the left foot forward, the right back; the hips drop into the strike.)
  for (const [side, x] of [["L", -1], ["R", 1]] as const) {
    const g = p.ik[`leg.${side}`];
    if (g) p.ik[`leg.${side}`] = { ...g, at: [x * b.hipW * 1.3, g.at[1], (x < 0 ? 0.16 : -0.1) * reach] };
  }
  p.root.off = [p.root.off[0], p.root.off[1] - reach * (0.05 * struck + 0.02 * wound), 0.03 * reach * struck];
  return p;
};

const humanUse: Clip<HumanoidSpec> = (spec, t, ph, params) => {
  const p = HUMANOID_CLIPS.idle(spec, t, ph, params);
  const k = Math.sin(Math.PI * clamp(ph.phase, 0, 1));
  const reach = spec.body.hipH - spec.body.ankleH;
  p.rot["upperArm.R"] = [mix(0.04, -1.2, k), 0, 0.1];
  p.rot["forearm.R"] = [mix(-0.25, -0.1, k), 0, 0];
  p.rot["spine"] = [0.03 + 0.4 * k, 0, 0];
  p.rot["neck"] = [0.15 * k, 0, 0];
  p.root.off = [p.root.off[0], p.root.off[1] - reach * 0.12 * k, 0];
  return p;
};

const quadAttack: Clip<QuadrupedSpec> = (spec, t, ph, params) => {
  const p = QUADRUPED_CLIPS.idle(spec, t, ph, params);
  const a = arc(ph.phase);
  const crouch = Math.max(0, a), lunge = Math.max(0, -a);
  const b = spec.body;
  // (Down on the haunches, then forward and low with the head out.)
  // (Small moves of the body -- its planted paws dip when it tips far -- and the neck and head make the lunge.)
  p.root.off = [0, p.root.off[1] - b.bodyR * 0.1 * crouch - b.bodyR * 0.04 * lunge, b.bodyLen * (0.12 * lunge - 0.05 * crouch)];
  p.root.pitch = 0.04 * lunge - 0.04 * crouch;
  p.rot["neck"] = [0.45 * lunge - 0.3 * crouch, 0, 0];
  p.rot["head"] = [-0.25 * lunge + 0.1 * crouch, 0, 0];
  p.ears = crouch;
  return p;
};

const quadUse: Clip<QuadrupedSpec> = (spec, t, ph, params) => {
  const p = QUADRUPED_CLIPS.idle(spec, t, ph, params);
  const k = Math.sin(Math.PI * clamp(ph.phase, 0, 1));
  p.rot["neck"] = [0.6 * k, 0, 0];
  p.rot["head"] = [0.3 * k, 0.15 * Math.sin(ph.phase * 25), 0];
  return p;
};

/** The action clips, per body plan. */
export const ACTION_CLIPS: Readonly<Record<Plan, Readonly<Record<ActionClipName, AnyClip>>>> = {
  humanoid: { attack: humanAttack as unknown as AnyClip, use: humanUse as unknown as AnyClip },
  quadruped: { attack: quadAttack as unknown as AnyClip, use: quadUse as unknown as AnyClip },
};

/** A clip by name for a spec's plan: its gaits and idles (clipsFor), then its actions. Undefined when it has neither. */
export function clipOf(spec: { readonly plan: Plan }, name: string): AnyClip | undefined {
  return clipsFor(spec)[name] ?? (ACTION_CLIPS[spec.plan] as Readonly<Record<string, AnyClip>>)[name];
}

/** Is it an action (played by time, once a cycle, feet planted)? */
export const isAction = (name: string): name is ActionClipName => name === "attack" || name === "use";

/** An action's pose at a phase (0..1) of its cycle. */
export function actionPose(spec: EntitySpec, name: ActionClipName, phase: number, t = 0): ClipPose {
  return ACTION_CLIPS[spec.plan][name](spec, t, { phase, landT: 99 });
}
