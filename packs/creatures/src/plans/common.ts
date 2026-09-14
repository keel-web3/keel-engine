// What a plan is: its rig, its choices, and a build that makes its spec, the
// role each part group wears, its skin over a posed skeleton and its socket sites.

import { entityOf, humanoidRig, quadrupedRig } from "@keel-engine/entity";
import type { EntitySpec, HumanoidBody, HumanoidSpec, QuadrupedBody, QuadrupedSpec, Skeleton, Species } from "@keel-engine/entity";
import type { ChoiceSpec, Pen, SlotRoles, SocketSite } from "../kit.ts";

export interface PlanBuild {
  readonly spec: EntitySpec;
  readonly roles: SlotRoles;
  /** Draw the creature over a posed skeleton. */
  skin(skel: Skeleton, P: Pen): void;
  readonly sites: Readonly<Record<string, SocketSite>>;
}

export interface PlanDef {
  /** The keel/entity rig it rides. */
  readonly rig: "humanoid" | "quadruped";
  readonly choices: Readonly<Record<string, ChoiceSpec>>;
  /** Weights for list choices (in the list's order); equal when absent. */
  readonly weights?: Readonly<Record<string, readonly number[]>>;
  build(seed: string, size: number, c: Readonly<Record<string, unknown>>): PlanBuild;
}

/** A four-legged spec on its own proportions: entityOf's (for its seed's features), with the body and rig replaced. */
export function quadSpec(seed: string, species: Species, body: QuadrupedBody): QuadrupedSpec {
  const base = entityOf(`${seed}|rig`, { kind: "animal", species, pins: { accessory: "none", antlers: false } }) as QuadrupedSpec;
  return { ...base, body, rig: quadrupedRig(body), features: { ...base.features, tail: { shape: base.features.tail.shape, len: body.tailLen } } };
}

/** A two-legged spec on its own proportions. */
export function humanSpec(seed: string, body: HumanoidBody): HumanoidSpec {
  const base = entityOf(`${seed}|rig`, { kind: "humanoid", pins: { pack: "none", accessory: "none", hood: false, hair: "none" } }) as HumanoidSpec;
  return { ...base, body, rig: humanoidRig(body), features: { ...base.features, tail: { shape: "none", len: 0 } } };
}

/** Four-legged proportions from a few numbers (world units). */
export function quadBody(o: { sh: number; hip: number; ankle: number; bodyR: number; legR: number; len: number; w: number; neck: number; rise: number; headR: number; pawR: number; pawLen: number; tail: number; tailRise: number }): QuadrupedBody {
  return {
    shoulderH: o.sh, hipH: o.hip, ankleH: o.ankle, bodyR: o.bodyR, legR: o.legR,
    H: o.sh + o.bodyR + o.neck * Math.sin(o.rise) + o.headR * 2,
    bodyLen: o.len, neckLen: o.neck, neckRise: o.rise, headR: o.headR, w: o.w,
    upperF: (o.sh - o.ankle) * 0.5, lowerF: (o.sh - o.ankle) * 0.5, upperH: (o.hip - o.ankle) * 0.5, lowerH: (o.hip - o.ankle) * 0.5,
    pawR: o.pawR, pawLen: o.pawLen, snoutLen: 0, tailLen: o.tail, tailRise: o.tailRise, stride: 1,
  };
}

/** Two-legged proportions from a height and a few shares of it. */
export function humanBody(H: number, o: { hip: number; ankle: number; headR: number; torsoR: number; neck: number; hipW: number; shoulderW: number; arm: number; legR: number; armR: number; footLen: number }): HumanoidBody {
  const hipH = H * o.hip, ankleH = H * o.ankle, headR = H * o.headR, neck = H * o.neck;
  const reach = hipH - ankleH;
  return {
    H, hipH, ankleH, footR: Math.min(ankleH * 0.8, H * 0.03), neck, torso: H - hipH - neck - headR * 2, headR, torsoR: H * o.torsoR,
    thigh: reach * 0.5, shin: reach * 0.5, footLen: H * o.footLen, hipW: H * o.hipW, shoulderW: H * o.shoulderW,
    upperArm: H * o.arm * 0.54, forearm: H * o.arm * 0.46, handLen: H * 0.04, legR: H * o.legR, armR: H * o.armR, tailLen: 0, stride: 1,
  };
}
