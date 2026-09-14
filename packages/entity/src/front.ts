// Fronts of entities: which way a thing faces, declared and seen. Ported from
// the proof of concept's src/entity/front.js; the equality test proves the
// readings identical (reasons included).
//
// The declared front is the convention (core frame): an entity's own +z, its
// right hand on +x. The SEEN front is read off the features a skin put on --
// where the face is against the body, which way the eyes' left-to-right runs,
// which way the toes point, which side the right hand is on -- so a wrongly
// turned model (a face on its back, a mirrored rig) shows up as a
// disagreement instead of a bug report.
//
//   frontOfEntity(spec)                    -> { yaw: 0, dir: [0,0,1], confidence: 1, why: "declared ..." }
//   frontOfEntity(capsules)                -> read off the parts (any yaw)
//   frontOfEntity(capsules, { yaw })       -> ... and checked against the yaw you meant: .agrees, .error
//
// (Scene's detectFront reads fronts off any assembly of parts; this one knows
// an entity's anatomy, and is the one the entity tests hold every clip to.)

import { cross, frontOf, sub, yawOf } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { declaredFront } from "./rig.ts";
import type { Skeleton } from "./rig.ts";
import type { DeclaredFront } from "./species.ts";

/** What a reading needs of a capsule: its ends, radius and part. */
export interface PartCapsule {
  readonly a: Vec3Like;
  readonly b: Vec3Like;
  readonly r: number;
  readonly part: string;
}

export interface FrontCue {
  readonly name: string;
  readonly dir: Vec3;
  readonly weight: number;
}

export interface EntityFront {
  readonly yaw: number;
  readonly dir: Vec3;
  /** 0..1: how much the cues agree (1: all point the same way). */
  readonly confidence: number;
  readonly why: string;
  readonly cues: FrontCue[];
  /** Given a yaw you meant: within 45 degrees of it? */
  agrees?: boolean;
  /** Given a yaw you meant: radians off it. */
  error?: number;
}

const TORSO = new Set(["hips", "chest"]);
const FACE = (p: string): boolean => p === "nose" || p === "snout" || p.startsWith("eye.");
const UP: Vec3Like = [0, 1, 0];
const flat = (v: Vec3Like): Vec3 | null => { const l = Math.hypot(v[0], v[2]); return l > 1e-12 ? [v[0] / l, 0, v[2] / l] : null; };
const mid = (c: PartCapsule): Vec3 => [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];

/** Where the named features are, from a skin: centres, plus toe.* (the b end of each foot.* / paw.*) and heel.* (its a end). */
export function featurePoints(caps: readonly PartCapsule[]): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  // (The body's centre: a quadruped's spine capsule alone -- its chest ball would pull it forward --
  // or a two-legged body's pelvis and chest together.)
  const torso = caps.some((c) => c.part === "body") ? new Set(["body"]) : TORSO;
  const sums: Record<string, [number, number, number, number]> = {};
  const push = (k: string, p: Vec3Like, w = 1): void => { const s = (sums[k] ??= [0, 0, 0, 0]); s[0] += p[0] * w; s[1] += p[1] * w; s[2] += p[2] * w; s[3] += w; };
  for (const c of caps) {
    push(c.part, mid(c));
    const m = /^(foot|paw)\.(.+)$/.exec(c.part);
    if (m) { push(`toe.${m[2]!}`, c.b); push(`heel.${m[2]!}`, c.a); }
    if (FACE(c.part)) push("face", mid(c), c.r);
    if (torso.has(c.part)) push("centre", mid(c), c.r ** 3);
  }
  for (const [k, s] of Object.entries(sums)) out[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
  return out;
}

/** Anything frontOfEntity reads: a spec (its declared front), a posed skeleton, or a skin's capsules. */
export type EntityFrontSource = { readonly front: DeclaredFront } | Skeleton | readonly PartCapsule[];

/**
 * frontOfEntity(spec | skeleton | capsules, { yaw }) -> { yaw, dir, confidence, why, cues, agrees?, error? }
 *   spec       the declared front (own frame: yaw 0)
 *   skeleton   the declared front of a posed skeleton (its heading)
 *   capsules   the seen front, from the face, the eyes, the toes and the hands
 */
export function frontOfEntity(thing: EntityFrontSource, { yaw: meant }: { readonly yaw?: number } = {}): EntityFront {
  let res: EntityFront;
  if (Array.isArray(thing)) res = seenFront(thing as readonly PartCapsule[]);
  else if ("bones" in thing && "root" in thing && thing.bones && thing.root) { const dir = declaredFront(thing); res = { yaw: yawOf(dir), dir, confidence: 1, why: "declared: the skeleton's heading (own +z)", cues: [] }; }
  else if ("front" in thing && thing.front) res = { yaw: 0, dir: [...thing.front.dir], confidence: 1, why: "declared: own +z is the front, +x the right hand (core/frame.js)", cues: [] };
  else throw new TypeError("frontOfEntity wants a spec, a posed skeleton or a list of capsules.");
  if (meant !== undefined) {
    const f = frontOf(meant);
    const d = res.dir[0] * f[0] + res.dir[2] * f[2];
    res.error = Math.acos(Math.max(-1, Math.min(1, d)));
    res.agrees = d > Math.cos(Math.PI / 4);
  }
  return res;
}

function seenFront(caps: readonly PartCapsule[]): EntityFront {
  const F = featurePoints(caps);
  const cues: FrontCue[] = [];
  const cue = (name: string, v: Vec3Like | null, weight: number): void => { const d = v && flat(v); if (d) cues.push({ name, dir: d, weight }); };
  const centre = F["centre"] ?? F["head"];
  // The face against the body (the strongest cue: a face is where it looks).
  if (F["face"] && centre) cue("face ahead of the body", sub(F["face"], centre), 3);
  if (F["face"] && F["head"]) cue("face on the front of the head", sub(F["face"], F["head"]), 2);
  // Eyes run left to right: front = right x up.
  if (F["eye.L"] && F["eye.R"]) cue("eyes left-to-right", cross(sub(F["eye.R"], F["eye.L"]), UP), 2);
  // Toes ahead of their heels.
  let toes: Vec3 | null = null;
  for (const k of Object.keys(F)) {
    if (!k.startsWith("toe.")) continue;
    const v = sub(F[k]!, F[`heel.${k.slice(4)}`]!);
    toes = toes ? [toes[0] + v[0], toes[1] + v[1], toes[2] + v[2]] : v;
  }
  cue("toes ahead of heels", toes, 1.5);
  // The right hand on the right: front = right x up.
  if (F["hand.L"] && F["hand.R"]) cue("right hand on the right", cross(sub(F["hand.R"], F["hand.L"]), UP), 1);
  if (!cues.length) return { yaw: 0, dir: [0, 0, 1], confidence: 0, why: "no face, eyes, toes or hands to read", cues };
  let x = 0;
  let z = 0;
  let wsum = 0;
  for (const c of cues) { x += c.dir[0] * c.weight; z += c.dir[2] * c.weight; wsum += c.weight; }
  const l = Math.hypot(x, z);
  const dir: Vec3 = l > 1e-12 ? [x / l, 0, z / l] : [0, 0, 1];
  const against = cues.filter((c) => c.dir[0] * dir[0] + c.dir[2] * dir[2] < 0).map((c) => c.name);
  const why = `seen: ${cues.map((c) => c.name).join(", ")}${against.length ? `; DISAGREEING: ${against.join(", ")}` : "; all agree"}`;
  return { yaw: yawOf(dir), dir, confidence: l / wsum, why, cues };
}
