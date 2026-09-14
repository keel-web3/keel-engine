// The engine's standard body contracts, and their SOCKETS.
//
// A body contract is what everything bound to a body by interface may rely
// on: an AI (`ai/herd` needs "contract:body/quadruped@^1"), an attribute
// (a beanie targets "body/humanoid@^1"), a game. This package DEFINES the two
// standard ones; packs PROVIDE them (a pack whose entities are built on them
// lists the contract in its manifest's `provides`):
//
//   body/humanoid@1.0.0   two legs: people, and anthro animals (an animal's
//                         head, ears, tail and snout on a person's body)
//   body/quadruped@1.0.0  four legs
//
// Each promises its bones, its IK chains, the clips its entities play, and
// its sockets. A SOCKET is where an attribute attaches: a bone it rides, an
// origin in that bone's frame, a size, and which way attachments grow out.
// Every socket's frame is its bone's frame, and every bone's rest frame is
// the entity's own frame -- so at rest a socket's frame IS the own frame:
// +z front, +x its right hand, +y up. An attribute built in a socket's frame
// therefore has its front on the entity's front whatever the socket (a cap's
// peak faces where the face does, on a head socket or a back one), and it
// turns with its bone through every clip.
//
// Sizes come from the rig's proportions (headR, torsoR, pawR ...), so the
// same design is built to a mouse's head or a bear's. Two ways to sit:
//   surface  the origin is ON the skin; `out` is the skin's outward normal
//            there (a hat's brim sits on the crown, a pack on the back)
//   around   the origin is on the part's axis, inside it; attachments wrap
//            it (a collar, a belt, a shoe, a held thing's grip)
//
// A minor version (1.1.0) may ADD sockets, bones or clips; removing or moving
// one is a major version (2.0.0). Attributes target a range ("body/humanoid@^1").

import { add, dcos, dhypot, dsin } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import type { Socket } from "@keel-engine/runtime";
import { restJoints } from "./rig.ts";
import type { Plan } from "./rig.ts";
import type { EntitySpec, HumanoidSpec, QuadrupedSpec } from "./species.ts";

// ---------------------------------------------------------------- types

export type SocketSits = "surface" | "around";

/** A socket as a contract promises it (the same for every entity of the body). */
export interface SocketConvention {
  readonly name: string;
  /** Every entity of the body has it (false: only where the body has the part -- a tail). */
  readonly required: boolean;
  /** The bone it rides. */
  readonly bone: string;
  /** The skin part it sits on or in (a part name from skin.ts). */
  readonly part: string;
  readonly sits: SocketSits;
  /** Which way attachments grow, in the socket's frame (unit). */
  readonly out: Vec3Like;
  /** Where it is and what goes there. */
  readonly what: string;
  /** How its size [width x, height y, depth z] comes from the rig's proportions. */
  readonly size: string;
}

export interface BodyContract {
  /** "body/humanoid" */
  readonly name: string;
  readonly version: string;
  /** The exact contract a pack provides and an entity declares: "body/humanoid@1.0.0". */
  readonly ref: string;
  /** The range an attribute targets or a module needs: "body/humanoid@^1". */
  readonly range: string;
  readonly plan: Plan;
  readonly title: string;
  /** Bones every entity of it has (an AI may read them off a posed skeleton). */
  readonly bones: readonly string[];
  /** IK chains every entity of it has. */
  readonly chains: readonly string[];
  /** Clips every entity of it plays (posed(), animator().hold()). */
  readonly clips: readonly string[];
  readonly sockets: readonly SocketConvention[];
}

/**
 * A socket on one entity: the runtime Socket (pos, yaw, size in the entity's
 * own frame, at rest), and what the engine needs to follow it through a pose.
 */
export interface EntitySocket extends Socket {
  readonly name: string;
  /** Its origin at rest, in the own frame. */
  readonly pos: Vec3;
  /** Always 0: a socket's frame is its bone's, the own frame at rest (+z front). */
  readonly yaw: number;
  readonly size: Vec3;
  readonly bone: string;
  /** Its origin in the bone's frame. */
  readonly at: Vec3;
  readonly out: Vec3;
  readonly part: string;
  readonly sits: SocketSits;
}

// ---------------------------------------------------------------- the contracts

const HUMANOID_SOCKETS: readonly SocketConvention[] = [
  { name: "head", required: true, bone: "head", part: "head", sits: "surface", out: [0, 1, 0], what: "the crown: the top of the head ball (hats, helmets, halos)", size: "[2 headR, headR, 2 headR]" },
  { name: "face", required: true, bone: "head", part: "head", sits: "surface", out: [0, 0, 1], what: "the front of the head at eye height (glasses, masks, goggles)", size: "[1.8 headR, 0.9 headR, 0.6 headR]" },
  { name: "neck", required: true, bone: "neck", part: "neck | chest", sits: "around", out: [0, 0, 1], what: "where the head meets the body, a ring round it (collars, scarves, necklaces); a person's neck capsule, an anthro's chest top", size: "[2 n, n, 2 n], n the body's radius there (person: 1.25 armR; anthro: 0.94 torsoR)" },
  { name: "chest", required: true, bone: "chest", part: "chest", sits: "surface", out: [0, 0, 1], what: "the front of the chest (badges, bibs, straps' buckles)", size: "[2 torsoR, 0.5 torso, torsoR]" },
  { name: "back", required: true, bone: "chest", part: "chest", sits: "surface", out: [0, 0, -1], what: "between the shoulder blades (backpacks, capes, quivers, wings)", size: "[2 torsoR, 0.6 torso, 1.5 torsoR]" },
  { name: "waist", required: true, bone: "hips", part: "hips", sits: "around", out: [0, 0, 1], what: "round the hips (belts, holsters, skirts)", size: "[2 h, 0.25 torso, 2 h], h the hips capsule's radius" },
  { name: "hand.L", required: true, bone: "hand.L", part: "hand.L", sits: "around", out: [0, -1, 0], what: "the left palm's centre; a held thing's grip runs along the socket's x, pointing ahead (+z)", size: "[2 g, 2 g, 2 g], g the hand ball's radius" },
  { name: "hand.R", required: true, bone: "hand.R", part: "hand.R", sits: "around", out: [0, -1, 0], what: "the right palm's centre (as hand.L)", size: "[2 g, 2 g, 2 g], g the hand ball's radius" },
  { name: "foot.L", required: true, bone: "foot.L", part: "foot.L", sits: "around", out: [0, -1, 0], what: "the middle of the left foot, heel to toe along +z (shoes, boots)", size: "[2 footR, 2 footR, 0.96 footLen + 2 footR]" },
  { name: "foot.R", required: true, bone: "foot.R", part: "foot.R", sits: "around", out: [0, -1, 0], what: "the middle of the right foot (as foot.L)", size: "[2 footR, 2 footR, 0.96 footLen + 2 footR]" },
  { name: "tail", required: false, bone: "tail1 | tail0", part: "tail", sits: "around", out: [0, 0.482, -0.876], what: "only with a tail: its middle joint (a puff or stub: the ball); out runs down the tail (bows, rings)", size: "[2 t, 2 t, s], t the tail's radius there, s its segment" },
];

const QUADRUPED_SOCKETS: readonly SocketConvention[] = [
  { name: "head", required: true, bone: "head", part: "head", sits: "surface", out: [0, 1, 0], what: "the crown: the top of the head ball (hats, horns' caps, flowers)", size: "[2 headR, headR, 2 headR]" },
  { name: "face", required: true, bone: "head", part: "head", sits: "surface", out: [0, 0, 1], what: "the front of the head at eye height, above the snout (glasses, masks)", size: "[1.8 headR, 0.9 headR, 0.6 headR]" },
  { name: "neck", required: true, bone: "neck", part: "neck", sits: "around", out: [0, 0, 1], what: "halfway up the neck, a ring round it (collars, bells, scarves)", size: "[2 n, n, 2 n], n = min(0.55 bodyR, 0.75 headR), the neck's radius" },
  { name: "chest", required: true, bone: "chest", part: "chest", sits: "surface", out: [0, 0, 1], what: "the front of the chest ball, between the fore legs (bibs, harness fronts)", size: "[1.6 bodyR, 1.4 bodyR, 0.6 bodyR]" },
  { name: "back", required: true, bone: "chest", part: "body", sits: "surface", out: [0, 1, 0], what: "the top of the back, mid-body (saddles, packs, riders); it rides the chest, which a gait keeps level, reaching back half a body length", size: "[1.8 bodyR, bodyR, 0.6 bodyLen]" },
  ...(["FL", "FR", "HL", "HR"] as const).map((k): SocketConvention => ({
    name: `paw.${k}`, required: true, bone: `paw.${k}`, part: `paw.${k}`, sits: "around", out: [0, -1, 0],
    what: `the middle of the ${k[0] === "F" ? "fore" : "hind"} ${k[1] === "L" ? "left" : "right"} paw, heel to toe along +z (boots, anklets)`, size: "[2 pawR, 2 pawR, pawLen + 1.3 pawR]",
  })),
  { name: "tail", required: false, bone: "tail1 | tail0", part: "tail | tail.mid", sits: "around", out: [0, 0, -1], what: "only with a tail: its middle joint (a puff or stub: the ball); out runs down the tail (back, raised by the species' tailRise: each entity's socket carries its own)", size: "[2 t, 2 t, s], t the tail's radius there, s its segment" },
];

const HUMANOID_BONES = ["hips", "spine", "chest", "neck", "head", "tail0", "tail1", ...["L", "R"].flatMap((s) => ["shoulder", "upperArm", "forearm", "hand", "thigh", "shin", "foot"].map((b) => `${b}.${s}`))];
const QUADRUPED_BONES = ["pelvis", "spine", "chest", "neck", "head", "tail0", "tail1", "tail2", ...["FL", "HL", "FR", "HR"].flatMap((k) => ["upper", "lower", "paw"].map((b) => `${b}.${k}`))];

const contract = (name: string, version: string, rest: Omit<BodyContract, "name" | "version" | "ref" | "range">): BodyContract =>
  Object.freeze({ name, version, ref: `${name}@${version}`, range: `${name}@^${version.split(".")[0]!}`, ...rest });

/** Two legs: people and anthro animals. */
export const HUMANOID_BODY: BodyContract = contract("body/humanoid", "1.0.0", {
  plan: "humanoid",
  title: "Humanoid (two legs): people and anthro animals",
  bones: HUMANOID_BONES,
  chains: ["leg.L", "leg.R", "arm.L", "arm.R"],
  clips: ["idle", "walk", "run", "move", "skim", "jump", "fall", "land", "wallRun", "grind", "sit", "turn"],
  sockets: HUMANOID_SOCKETS,
});

/** Four legs. */
export const QUADRUPED_BODY: BodyContract = contract("body/quadruped", "1.0.0", {
  plan: "quadruped",
  title: "Quadruped (four legs)",
  bones: QUADRUPED_BONES,
  chains: ["leg.FL", "leg.FR", "leg.HL", "leg.HR"],
  clips: ["idle", "move", "walk", "trot", "gallop", "bound", "sit", "lie", "leap"],
  sockets: QUADRUPED_SOCKETS,
});

/** The standard contracts, by plan. */
export const BODY_CONTRACTS: Readonly<Record<Plan, BodyContract>> = Object.freeze({ humanoid: HUMANOID_BODY, quadruped: QUADRUPED_BODY });

/** The contract a spec's entity provides. */
export const contractOf = (spec: { readonly plan: Plan }): BodyContract => BODY_CONTRACTS[spec.plan];

// ---------------------------------------------------------------- sockets from a spec

interface Site { bone: string; at: Vec3; size: Vec3; out: Vec3; part: string; sits: SocketSits }
const unit = (v: Vec3Like): Vec3 => { const l = dhypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

function humanoidSites(spec: HumanoidSpec): Record<string, Site> {
  const B = spec.body;
  const human = spec.kind === "humanoid";
  const hr = B.headR;
  const T = B.torso;
  const tr = B.torsoR;
  // (The head ball: its centre a radius up the head bone, a touch forward -- skin.ts's C(0, 0, 0.04).)
  const eyeY = 0.02;
  const face: Vec3 = [0, hr * (1 + eyeY), hr * 0.04 + hr * Math.sqrt(1 - eyeY * eyeY)];
  // (A person's chest capsule runs across the shoulders: the socket sits on its front, a little below the axis.
  // An anthro's stands upright from the spine: its front is a torso radius ahead.)
  const chestAt: Vec3 = human ? [0, T * 0.24 - tr * 0.4, tr * Math.sqrt(1 - 0.16)] : [0, T * 0.12, tr];
  // (A person has a neck capsule; an anthro's head sits on the top of its chest, where the chest's radius is this.)
  const nr = human ? B.armR * 1.25 : tr * Math.sqrt(1 - 0.35 * 0.35);
  const hipsR = tr * (human ? 0.9 : 0.93);
  const grip = B.armR * (human ? 1.15 : 1.3);
  const sole = -(B.ankleH - B.footR);
  const out: Record<string, Site> = {
    head: { bone: "head", at: [0, hr * 2, hr * 0.04], size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
    face: { bone: "head", at: face, size: [1.8 * hr, 0.9 * hr, 0.6 * hr], out: [0, 0, 1], part: "head", sits: "surface" },
    neck: { bone: "neck", at: human ? [0, B.neck * 0.5, 0] : [0, 0, 0], size: [2 * nr, nr, 2 * nr], out: [0, 0, 1], part: human ? "neck" : "chest", sits: "around" },
    chest: { bone: "chest", at: chestAt, size: [2 * tr, 0.5 * T, tr], out: [0, 0, 1], part: "chest", sits: "surface" },
    back: { bone: "chest", at: [chestAt[0], chestAt[1], -chestAt[2]], size: [2 * tr, 0.6 * T, 1.5 * tr], out: [0, 0, -1], part: "chest", sits: "surface" },
    waist: { bone: "hips", at: [0, T * 0.14, 0], size: [2 * hipsR, 0.25 * T, 2 * hipsR], out: [0, 0, 1], part: "hips", sits: "around" },
  };
  for (const s of ["L", "R"]) {
    out[`hand.${s}`] = { bone: `hand.${s}`, at: [0, -B.handLen * 0.45, 0], size: [2 * grip, 2 * grip, 2 * grip], out: [0, -1, 0], part: `hand.${s}`, sits: "around" };
    out[`foot.${s}`] = { bone: `foot.${s}`, at: [0, sole, B.footLen * 0.3], size: [2 * B.footR, 2 * B.footR, B.footLen * 0.96 + 2 * B.footR], out: [0, -1, 0], part: `foot.${s}`, sits: "around" };
  }
  const tail = tailSite(spec, B.legR, tr);
  if (tail) out["tail"] = tail;
  return out;
}

function quadrupedSites(spec: QuadrupedSpec): Record<string, Site> {
  const B = spec.body;
  const hr = B.headR;
  // (The head ball: skin.ts's C(0, 0, 0) = [0, 0.25 headR, 0.5 headR] in the head bone's frame.)
  const eyeY = 0.3;
  const nr = Math.min(B.bodyR * 0.55, hr * 0.75);
  const neckOff: Vec3 = [0, B.neckLen * dsin(B.neckRise), B.neckLen * dcos(B.neckRise)];
  const sole = -(B.ankleH - B.pawR);
  const rise = (B.shoulderH - B.hipH) * 0.5;
  const out: Record<string, Site> = {
    head: { bone: "head", at: [0, hr * 1.25, hr * 0.5], size: [2 * hr, hr, 2 * hr], out: [0, 1, 0], part: "head", sits: "surface" },
    face: { bone: "head", at: [0, hr * (0.25 + eyeY), hr * (0.5 + Math.sqrt(1 - eyeY * eyeY))], size: [1.8 * hr, 0.9 * hr, 0.6 * hr], out: [0, 0, 1], part: "head", sits: "surface" },
    neck: { bone: "neck", at: [0, neckOff[1] * 0.5, neckOff[2] * 0.5], size: [2 * nr, nr, 2 * nr], out: [0, 0, 1], part: "neck", sits: "around" },
    chest: { bone: "chest", at: [0, -B.bodyR * 0.08, B.bodyR * 0.1 + B.bodyR * 1.08], size: [1.6 * B.bodyR, 1.4 * B.bodyR, 0.6 * B.bodyR], out: [0, 0, 1], part: "chest", sits: "surface" },
    // (It rides the chest, reaching back to mid-body: a gait flexes the spine one way and the pelvis and chest half
    // back, so the chest stays level and its reach back lands on the straight body capsule's middle -- where a
    // socket on the spine itself would sink into the body by up to half its radius in a bound.)
    back: { bone: "chest", at: [0, B.bodyR - rise, -B.bodyLen / 2], size: [1.8 * B.bodyR, B.bodyR, 0.6 * B.bodyLen], out: [0, 1, 0], part: "body", sits: "surface" },
  };
  for (const k of ["FL", "FR", "HL", "HR"]) {
    out[`paw.${k}`] = { bone: `paw.${k}`, at: [0, sole, (B.pawLen - B.pawR * 0.3) / 2], size: [2 * B.pawR, 2 * B.pawR, B.pawLen + 1.3 * B.pawR], out: [0, -1, 0], part: `paw.${k}`, sits: "around" };
  }
  const tail = tailSite(spec, B.legR, B.bodyR);
  if (tail) out["tail"] = tail;
  return out;
}

// The tail's socket: at its middle joint (as skin.ts draws it), or on a puff or stub's ball.
function tailSite(spec: EntitySpec, legR: number, bodyR: number): Site | null {
  const T = spec.features.tail;
  if (T.shape === "none" || !(T.len > 0)) return null;
  const quad = spec.plan === "quadruped";
  if (T.shape === "puff" || T.shape === "stub") {
    const r = Math.max(T.len * (quad ? 0.3 : 0.9), legR);
    const dir = spec.rig.bones[spec.rig.index["tail1"]!]!.off;
    return { bone: "tail0", at: [0, 0, 0], size: [2 * r, 2 * r, 2 * r], out: unit(dir), part: "tail", sits: "around" };
  }
  const r = T.shape === "bushy" ? bodyR * (quad ? 0.32 : 0.28) : T.shape === "thin" ? legR * 0.32 : legR * (quad ? 0.8 : 0.62);
  // (The radius where the two capsules meet: the larger of the two, as the renderer's union draws it.)
  const k = quad ? (T.shape === "bushy" ? 1.25 : 1) : (T.shape === "bushy" ? 1.3 : 1);
  const next = quad ? spec.rig.bones[spec.rig.index["tail2"]!]!.off : spec.rig.bones[spec.rig.index["tail1"]!]!.tip!;
  const seg = dhypot(next[0], next[1], next[2]);
  return { bone: "tail1", at: [0, 0, 0], size: [2 * r * k, 2 * r * k, seg], out: unit(next), part: quad ? "tail.mid" : "tail", sits: "around" };
}

/**
 * socketsOf(spec) -> { name: EntitySocket }: every socket its body contract
 * promises (and the tail where it has one), sized from its proportions.
 * `pos` is where each sits at rest in the own frame (+z front); on a posed
 * skeleton, fit.ts's socketFrame() follows the bone.
 */
export function socketsOf(spec: EntitySpec): Record<string, EntitySocket> {
  const sites = spec.plan === "quadruped" ? quadrupedSites(spec) : humanoidSites(spec);
  const rest = restJoints(spec.rig);
  const out: Record<string, EntitySocket> = {};
  for (const [name, s] of Object.entries(sites)) {
    out[name] = Object.freeze({ name, pos: add(rest[s.bone]!, s.at), yaw: 0, size: s.size, bone: s.bone, at: s.at, out: s.out, part: s.part, sits: s.sits });
  }
  return out;
}

/** The sockets a contract requires that a socket set lacks (empty: it keeps the contract). */
export function missingSockets(contract: BodyContract, sockets: Readonly<Record<string, Socket>>): string[] {
  return contract.sockets.filter((c) => c.required && !sockets[c.name]).map((c) => c.name);
}
