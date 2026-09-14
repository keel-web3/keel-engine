// Shapes: what an indexed bake is cached by. A SHAPE is geometry only --
// never colour -- so one bake serves every look, and a thing is baked once
// however many wear it.
//
//   bodyShape(spec)   an entity's body (and anything that bends with it: a
//                     "body"-layer attribute, boots) posed through its clips.
//                     Keyed by its geometry over every frame it bakes: two
//                     specs that pose the same capsules are one shape, whatever
//                     their seeds or colours. Its capsules carry SLOTS by part
//                     (head, chest, forearm, ...), not by role: which role each
//                     slot wears -- is the forearm a sleeve or bare? -- is the
//                     look's call (slotRoles(coverage)), so a jacket, a tee or a
//                     coat's markings change nothing baked.
//   attributeShape()  a rigid wearable, built to a SOCKET CLASS (the socket's
//                     size on a 20% ladder, its axes rounded) and baked alone,
//                     once per class and direction -- not once per wearer. Its
//                     slots are its parts' roles.
//
// The layering: a body records, for every clip, frame and direction, where
// each socket lands on its sprite (screen metres right and up of the ground
// anchor), whether what sits there is in front of the body or behind it (a
// pack from the front is behind; from the back, in front), and the socket's
// screen tilt. The draw puts each attribute's sprite on its body's socket for
// the frame being shown, a hair in front or behind. So a bake costs
//   Σ bodies × frames × directions  +  Σ attribute shapes × directions,
// not their product. Rigid attributes ride the socket's position but not its
// bone's roll (v1: a hat stays upright through a nod; the tilt is recorded for
// a later tilt bucket); what must bend is baked into the body ("body" layer).

import { contentHash } from "./entity-design.ts";
import { HUMANOID_BAKE_CLIPS, QUADRUPED_BAKE_CLIPS } from "./entity-design.ts";
import type { ClipInfo } from "./entity-design.ts";
import type { BakeBox, BakeWorld } from "./bake.ts";
import type { ClipSpec, DesignSpec } from "./plan.ts";
import type { IndexedSource } from "./indexed.ts";
import { SLOTS } from "./indexed.ts";
import { LOOK_ROLES, createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { LookRole, Vec3 } from "@keel-engine/core";
import { ACTION_PERIOD, LOCOMOTION, apply, clipOf, isAction, placeAttribute, poseSkeleton, skinOf, socketFrame, socketsOf } from "@keel-engine/entity";
import type { AttributeShape, Capsule, EntitySocket, EntitySpec, Role, Skeleton, Worn } from "@keel-engine/entity";
import type { AttributeDef, Pins, RoleSpec } from "@keel-engine/runtime";

// ---------------------------------------------------------------- slots

/** A body's slots: its parts by region (28), then four for what's baked into it (boots): its roles by kind. */
export const BODY_SLOTS = [
  "head", "snout", "nose", "eye", "ear", "innerEar", "hair", "neck", "chest", "hips", "upperArm", "forearm", "hand", "thigh", "shin", "foot",
  "tail", "tailTip", "hood", "pack", "accessory", "antler", "brow", "body", "legUpper", "legLower", "paw", "collar",
  "worn.primary", "worn.secondary", "worn.trim", "worn.dark",
] as const;
export type BodySlot = (typeof BODY_SLOTS)[number];
/** The first worn slot. */
export const WORN_SLOT = BODY_SLOTS.indexOf("worn.primary");

const PART_SLOT: Readonly<Record<string, BodySlot>> = {
  head: "head", snout: "snout", nose: "nose", eye: "eye", ear: "ear", innerEar: "innerEar", hair: "hair", neck: "neck", chest: "chest", hips: "hips",
  upperArm: "upperArm", forearm: "forearm", hand: "hand", thigh: "thigh", shin: "shin", foot: "foot", tail: "tail", hood: "hood", pack: "pack",
  accessory: "accessory", antler: "antler", brow: "brow", body: "body", upper: "legUpper", lower: "legLower", paw: "paw", collar: "collar",
};
/** A skin part's slot ("forearm.L" -> forearm, "tail.tip" -> tailTip, "upper.FL" -> legUpper). */
export function slotOfPart(part: string): number {
  if (part === "tail.tip") return BODY_SLOTS.indexOf("tailTip");
  return BODY_SLOTS.indexOf(PART_SLOT[part.split(".")[0]!] ?? "accessory");
}
/** The worn slot a baked-in attribute's role goes to. */
export function wornSlotOf(role: Role): number {
  const kind: BodySlot = role === "secondary" || role === "clothAlt" ? "worn.secondary"
    : role === "dark" || role === "metal" || role === "eye" || role === "detail" ? "worn.dark"
      : role === "trim" || role === "accent" || role === "glow" || role === "blush" || role === "hair" ? "worn.trim" : "worn.primary";
  return BODY_SLOTS.indexOf(kind);
}
/** What the worn slots wear from the worn thing's look. */
export const WORN_ROLES: readonly Role[] = ["primary", "secondary", "trim", "dark"];

/** An attribute part's slot: its role's place in core's LOOK_ROLES. */
export function slotOfRole(role: Role): number {
  const i = (LOOK_ROLES as readonly string[]).indexOf(role);
  return i < 0 ? 0 : i;
}

// ---------------------------------------------------------------- geometry keys

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const geo = (c: { a: ArrayLike<number>; b: ArrayLike<number>; r: number }): number[] => [r4(c.a[0]!), r4(c.a[1]!), r4(c.a[2]!), r4(c.b[0]!), r4(c.b[1]!), r4(c.b[2]!), r4(c.r)];

// ---------------------------------------------------------------- bodies

/** A thing baked into the body (it bends with it): an attribute def (an AttributeShape design) and its shape pins. */
export interface BodyWear { readonly def: AttributeDef<AttributeShape>; readonly pins?: Pins }

/** A body's own skin on a posed skeleton (a hand-built body: a builder voxel model's boxes on its bones), each piece by part and role. */
export interface ExplicitSkin {
  readonly capsules: readonly { readonly a: Vec3; readonly b: Vec3; readonly r: number; readonly part: string; readonly role: Role }[];
  readonly boxes: readonly { readonly c: Vec3; readonly h: Vec3; readonly yaw: number; readonly part: string; readonly role: Role }[];
}

export interface BodyShapeOptions {
  /** Where it's from (part of the key). */
  readonly pack?: string;
  readonly clips?: readonly ClipSpec[];
  /** What's baked into it (boots): built to its own sockets. */
  readonly wear?: readonly BodyWear[];
  /**
   * Its own skin instead of keel/entity's (an explicit body: a voxel hero). Its pieces take slots by part (a bone's
   * name: "forearm.L" is the forearm) and their roles are its own -- a coverage changes nothing on it.
   */
  readonly skin?: (skel: Skeleton) => ExplicitSkin;
  /** Its sockets, when they aren't its contract's (a voxel body's own, from its rig). */
  readonly sockets?: Readonly<Record<string, EntitySocket>>;
}

/** Where each socket lands, per clip, frame and direction: see SocketRecords.at. */
export interface SocketRecords {
  readonly directions: number;
  readonly pitch: number;
  readonly sockets: readonly string[];
  /** Frames a clip, at most (the table's stride). */
  readonly maxFrames: number;
  /** [right, up, front, tilt] per (clip index, frame, direction, socket): screen metres from the ground anchor; 1 if in front of the body; radians. */
  readonly data: Float32Array;
  /** The offset of a record in `data`. */
  at(clip: number, frame: number, direction: number, socket: number): number;
}

export interface BodyShape extends DesignSpec, IndexedSource {
  readonly spec: EntitySpec;
  /** The combined wear, built to this body's sockets. */
  readonly worn: readonly Worn[];
  readonly clipInfo: Readonly<Record<string, ClipInfo>>;
  clip(name: string): ClipInfo;
  /** Its posed capsules at a clip's frame (roles as its own spec's; `mat` is the slot). */
  capsules(clip: string, frame: number): Capsule[];
  /** The posed skeleton at a clip's frame (at the origin facing +z): where a live 3D view puts what it wears (placeAttribute). */
  skeleton(clip: string, frame: number): Skeleton;
  /** Its sockets (as keel/entity's socketsOf), by name. */
  readonly sockets: Readonly<Record<string, EntitySocket>>;
  /**
   * What each slot wears for a coverage -- the look choices that move roles between parts (top, pants, shoes,
   * coat: a tee's forearms are bare, a jacket's are cloth). Unset choices keep the spec's own. null: not baked.
   */
  slotRoles(coverage?: Readonly<Record<string, unknown>>): (Role | null)[];
  /** A coverage as this body wears it (a hooded body's top is a jacket or a hoodie): two that read the same are equal. */
  coverageOf(coverage: Readonly<Record<string, unknown>>): Record<string, unknown>;
  /** Where its sockets land, per clip, frame and direction (cached per directions and pitch). */
  records(directions: number, pitch: number): SocketRecords;
  /** The look roles its worn slots take (the first baked-in thing's roles; empty when nothing is baked in). */
  readonly wornRoles: Readonly<Record<string, RoleSpec>>;
}

// Speeds as entity-design's: leg lengths a second.
const SPEED: Readonly<Record<string, number>> = { walk: 2.2, run: 6.5, skim: 6, move: 2.2, trot: 3.9, gallop: 8.5, bound: 7 };
const IDLE_PERIOD: Readonly<Record<string, number>> = { humanoid: 3.4, quadruped: 3 };

/** The screen axes of a baked direction (as bakeCamera turns its camera round the design). */
export function directionAxes(direction: number, directions: number, pitch: number): { right: Vec3; up: Vec3; forward: Vec3 } {
  const angle = (direction / directions) * Math.PI * 2;
  const yaw = -Math.PI - angle;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const forward: Vec3 = [sy * cp, -sp, cy * cp];
  const right: Vec3 = [cy, 0, -sy];
  const up: Vec3 = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
  return { right, up, forward };
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** An entity's body as a shape: slots by part, keyed by its geometry over every baked frame. */
export function bodyShape(spec: EntitySpec, options: BodyShapeOptions = {}): BodyShape {
  const { pack = "keel/entity" } = options;
  const clips = options.clips ?? (spec.plan === "quadruped" ? QUADRUPED_BAKE_CLIPS : HUMANOID_BAKE_CLIPS);
  // (Its gaits and idles, then the engine's actions -- attack, use -- when a bake asks for them.)
  const table: Readonly<Record<string, ReturnType<typeof clipOf>>> = Object.fromEntries(clips.map((c) => [c.name, clipOf(spec, c.name)]));
  const leg = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH;
  const sockets = options.sockets ?? socketsOf(spec);
  const own = options.skin;
  const worn: Worn[] = (options.wear ?? []).map(({ def, pins = {} }) => {
    const socket = sockets[def.slot];
    if (!socket) throw new RangeError(`${def.id} sits in "${def.slot}"; a ${spec.plan} ${spec.species} has no such socket.`);
    return { slot: def.slot, socket, design: def.build(stream(createRoll(deriveSeed(`attr:${def.id}`, JSON.stringify(pins))), 0), socket, pins) };
  });

  const clipInfo: Record<string, ClipInfo> = {};
  for (const c of clips) {
    const fn = table[c.name];
    if (!fn) throw new RangeError(`A ${spec.plan} has no clip "${c.name}".`);
    const moving = LOCOMOTION.has(c.name);
    const speed = moving ? (SPEED[c.name] ?? 3) * leg : 0;
    const cycle = moving ? fn(spec, 0, { phase: 0 }, { speed }).cycle : 0;
    clipInfo[c.name] = { name: c.name, frames: c.frames, loop: c.loop ?? true, cycle, speed, period: moving ? cycle / Math.max(1e-6, speed) : isAction(c.name) ? ACTION_PERIOD[c.name] : IDLE_PERIOD[spec.plan] ?? 3 };
  }

  interface Posed { skel: Skeleton; capsules: Capsule[]; world: BakeWorld }
  const memo = new Map<string, Posed>();
  const posed = (clip: string, frame: number): Posed => {
    const id = `${clip}#${frame}`;
    const had = memo.get(id);
    if (had) return had;
    const info = clipInfo[clip];
    if (!info) throw new RangeError(`${spec.species}: clip "${clip}" isn't baked (${Object.keys(clipInfo).join(", ")}).`);
    const phase = (((frame % info.frames) + info.frames) % info.frames) / info.frames;
    const p = table[clip]!(spec, phase * info.period, { phase, landT: 0 }, { speed: info.speed });
    const skel = poseSkeleton(spec.rig, p, { pos: [0, 0, 0], yaw: 0 });
    const boxes: BakeBox[] = [];
    let capsules: Capsule[];
    if (own) {
      const k = own(skel);
      capsules = k.capsules.map((c) => ({ a: c.a, b: c.b, r: c.r, part: c.part, role: c.role, mat: slotOfPart(c.part) }));
      for (const b of k.boxes) boxes.push({ c: b.c, h: b.h, yaw: b.yaw, mat: slotOfPart(b.part) });
    } else capsules = skinOf(spec, skel).map((c) => ({ ...c, mat: slotOfPart(c.part) }));
    for (const w of worn) {
      const f = placeAttribute(skel, w.socket, w.design);
      for (const c of f.capsules) capsules.push({ ...c, mat: wornSlotOf(c.role) });
      for (const b of f.boxes) boxes.push({ c: b.c, h: b.h, yaw: b.yaw, mat: wornSlotOf(b.role) });
    }
    const out = { skel, capsules, world: { capsules, boxes } };
    memo.set(id, out);
    return out;
  };

  // Its size over every frame, and its key: the geometry of every frame (parts included: they're its slots).
  let height = 0, radius = 0;
  const shapeText: string[] = [spec.plan, clips.map((c) => `${c.name}:${c.frames}`).join(",")];
  for (const c of clips) for (let f = 0; f < c.frames; f += 1) {
    const { capsules, world } = posed(c.name, f);
    for (const k of capsules) { for (const p of [k.a, k.b]) { height = Math.max(height, p[1] + k.r); radius = Math.max(radius, Math.hypot(p[0], p[2]) + k.r); } shapeText.push(`${k.mat}:${geo(k).join(",")}`); }
    for (const b of world.boxes ?? []) {
      const e = Math.hypot(b.h[0] ?? 0, b.h[1] ?? 0, b.h[2] ?? 0);
      height = Math.max(height, (b.c[1] ?? 0) + e); radius = Math.max(radius, Math.hypot(b.c[0] ?? 0, b.c[2] ?? 0) + e);
      shapeText.push(`b${b.mat}:${[b.c[0], b.c[1], b.c[2], b.h[0], b.h[1], b.h[2], b.yaw ?? 0].map((v) => r4(v ?? 0)).join(",")}`);
    }
  }
  const key = `${pack}:${spec.kind}/${spec.species}~${contentHash(shapeText.join("|"))}`;

  const coverageOf = (coverage: Readonly<Record<string, unknown>>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...coverage };
    // (A hood hangs off a jacket or a hoodie: a hooded body's top is one of them.)
    if (spec.outfit.hood && out["top"] !== undefined && out["top"] !== "jacket" && out["top"] !== "hoodie") out["top"] = "hoodie";
    return out;
  };
  const roleCache = new Map<string, (Role | null)[]>();
  // (An explicit skin's slots wear its pieces' own roles: the first piece in each slot says.)
  const ownRoles = (): (Role | null)[] => {
    const had = roleCache.get("own");
    if (had) return had.slice();
    const out: (Role | null)[] = new Array<Role | null>(SLOTS).fill(null);
    const k = own!(posed(clips[0]!.name, 0).skel);
    for (const c of [...k.capsules, ...k.boxes]) { const sl = slotOfPart(c.part); if (out[sl] === null) out[sl] = c.role; }
    if (worn.length) WORN_ROLES.forEach((r, i) => { out[WORN_SLOT + i] = r; });
    roleCache.set("own", out);
    return out.slice();
  };
  const slotRoles = (coverage: Readonly<Record<string, unknown>> = {}): (Role | null)[] => {
    if (own) return ownRoles();
    const O = spec.outfit;
    const cover = coverageOf(coverage);
    const pick = <T>(name: string, own: T): T => (cover[name] !== undefined ? (cover[name] as T) : own);
    const top = pick("top", O.top);
    const outfit = { ...O, top, pants: pick("pants", O.pants), shoes: pick("shoes", O.shoes) };
    const features = { ...spec.features, coat: pick("coat", spec.features.coat) };
    const id = JSON.stringify([outfit.top, outfit.pants, outfit.shoes, features.coat]);
    const had = roleCache.get(id);
    if (had) return had.slice();
    const covered = { ...spec, outfit, features } as EntitySpec;
    const out: (Role | null)[] = new Array<Role | null>(SLOTS).fill(null);
    for (const c of skinOf(covered, posed(clips[0]!.name, 0).skel)) { const s = slotOfPart(c.part); if (out[s] === null) out[s] = c.role; }
    if (worn.length) WORN_ROLES.forEach((r, i) => { out[WORN_SLOT + i] = r; });
    roleCache.set(id, out);
    return out.slice();
  };

  const recordCache = new Map<string, SocketRecords>();
  const names = Object.keys(sockets);
  const records = (directions: number, pitch: number): SocketRecords => {
    const id = `${directions}|${pitch}`;
    const had = recordCache.get(id);
    if (had) return had;
    const maxFrames = Math.max(...clips.map((c) => c.frames));
    const S = names.length;
    const data = new Float32Array(clips.length * maxFrames * directions * S * 4);
    const at = (c: number, f: number, d: number, s: number) => ((((c * maxFrames + f) * directions + d) * S + s) * 4);
    const axes = Array.from({ length: directions }, (_, d) => directionAxes(d, directions, pitch));
    clips.forEach((clip, ci) => {
      for (let f = 0; f < clip.frames; f += 1) {
        const { skel } = posed(clip.name, f);
        names.forEach((name, si) => {
          const sock = sockets[name]!;
          const fr = socketFrame(skel, sock);
          const out = apply(fr.m, sock.out);
          const upW = apply(fr.m, [0, 1, 0]);
          axes.forEach((ax, d) => {
            const o = at(ci, f, d, si);
            data[o] = dot(fr.p, ax.right);
            data[o + 1] = dot(fr.p, ax.up);
            // (Around a part, what sits there wraps it: its near half is always in front. On a surface, it's in
            // front unless the surface faces well away from the camera.)
            data[o + 2] = sock.sits === "around" || -dot(out, ax.forward) > -0.35 ? 1 : 0;
            data[o + 3] = Math.atan2(dot(upW, ax.right), dot(upW, ax.up));
          });
        });
      }
    });
    const rec: SocketRecords = { directions, pitch, sockets: names, maxFrames, data, at };
    recordCache.set(id, rec);
    return rec;
  };

  const first = options.wear?.[0]?.def.look?.roles;
  const wornRoles: Readonly<Record<string, RoleSpec>> = !worn.length ? {} : first ?? { primary: { stuff: "leather" }, secondary: { stuff: "cloth" }, trim: { stuff: "paint" }, dark: { stuff: "dark" } };
  return {
    key, clips, height, radius, spec, worn, clipInfo, sockets, wornRoles,
    pose: (clip, frame) => posed(clip, frame).world,
    capsules: (clip, frame) => posed(clip, frame).capsules,
    skeleton: (clip, frame) => posed(clip, frame).skel,
    clip(name) { const c = clipInfo[name]; if (!c) throw new RangeError(`Clip "${name}" isn't baked.`); return c; },
    slotRoles,
    coverageOf,
    records,
  };
}

// ---------------------------------------------------------------- socket classes

/**
 * The socket-size ladder: sizes within about 9% of a rung build the same attribute (a hat has that much slack on a
 * head; a finer ladder bakes more shapes for differences a pixel can't show).
 */
export const SIZE_STEP = 1.2;
const rung = (x: number): number => (x > 0 ? Math.round(SIZE_STEP ** Math.round(Math.log(x) / Math.log(SIZE_STEP)) * 1e5) / 1e5 : 0);
const dir = (v: ArrayLike<number>): [number, number, number] => {
  const l = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  return l > 1e-9 ? [Math.round((v[0]! / l) * 10) / 10, Math.round((v[1]! / l) * 10) / 10, Math.round((v[2]! / l) * 10) / 10] : [0, 0, 0];
};

/** A socket class: every socket that builds the same attribute -- its plan, name, size on the ladder, axes rounded. */
export interface SocketClass {
  readonly key: string;
  /** The socket an attribute is built to for this class (the rung's size, rounded axes, at the origin). */
  readonly socket: EntitySocket;
}
export function socketClass(socket: EntitySocket, plan: string): SocketClass {
  const size: Vec3 = [rung(socket.size[0]), rung(socket.size[1]), rung(socket.size[2])];
  const at = dir(socket.at);
  const out = dir(socket.out);
  const key = `${plan}:${socket.name}:${size.join("x")}:${at.join(",")}:${out.join(",")}`;
  return { key, socket: Object.freeze({ ...socket, pos: [0, 0, 0] as Vec3, size, at, out }) };
}

// ---------------------------------------------------------------- attributes

export interface AttributeShapeDesign extends DesignSpec, IndexedSource {
  readonly attribute: string;
  /** The socket it sits in (its slot's name). */
  readonly socket: string;
  readonly design: AttributeShape;
  /** How far up the socket's origin is from the sprite's ground anchor (metres): the design is lifted clear of y = 0. */
  readonly lift: number;
  /** The look roles its parts carry (its slots). */
  readonly roles: readonly LookRole[];
}

/**
 * A rigid attribute as a shape: built to a socket class with these shape pins (from a stream of its own, so the
 * same pins and class are the same shape), posed at rest round the socket's origin, lifted so nothing is below the
 * ground anchor. Keyed by its geometry.
 */
export function attributeShape(def: AttributeDef<AttributeShape>, cls: SocketClass, pins: Pins = {}): AttributeShapeDesign {
  const design = def.build(stream(createRoll(deriveSeed(`attr:${def.id}`, JSON.stringify(pins))), 0), cls.socket, pins);
  const caps = design.capsules ?? [];
  const boxes = design.boxes ?? [];
  let low = 0;
  for (const c of caps) low = Math.min(low, c.a[1] - c.r, c.b[1] - c.r);
  for (const b of boxes) low = Math.min(low, b.c[1] - Math.hypot(b.h[0], b.h[1], b.h[2]));
  const lift = -low + 0.002;
  const roles = new Set<LookRole>();
  const role = (r: Role | undefined): Role => { const x = r ?? "primary"; roles.add(x as LookRole); return x; };
  const world: BakeWorld = {
    capsules: caps.map((c) => ({ a: [c.a[0], c.a[1] + lift, c.a[2]], b: [c.b[0], c.b[1] + lift, c.b[2]], r: c.r, mat: slotOfRole(role(c.role)) })),
    boxes: boxes.map((b) => ({ c: [b.c[0], b.c[1] + lift, b.c[2]], h: [b.h[0], b.h[1], b.h[2]], yaw: b.yaw ?? 0, mat: slotOfRole(role(b.role)) })),
  };
  let height = 0, radius = 0;
  const text: string[] = [def.slot];
  for (const c of world.capsules ?? []) { for (const p of [c.a, c.b]) { height = Math.max(height, p[1]! + c.r); radius = Math.max(radius, Math.hypot(p[0]!, p[2]!) + c.r); } text.push(`${c.mat}:${geo(c).join(",")}`); }
  for (const b of world.boxes ?? []) {
    const e = Math.hypot(b.h[0]!, b.h[1]!, b.h[2]!);
    height = Math.max(height, b.c[1]! + e); radius = Math.max(radius, Math.hypot(b.c[0]!, b.c[2]!) + e);
    text.push(`b${b.mat}:${[b.c[0], b.c[1], b.c[2], b.h[0], b.h[1], b.h[2], b.yaw].map((v) => r4(v ?? 0)).join(",")}`);
  }
  const key = `attr:${def.id}~${contentHash(text.join("|"))}`;
  return {
    key, attribute: def.id, socket: def.slot, design, lift, roles: [...roles], split: [0, lift, 0],
    clips: [{ name: "still", frames: 1 }], height: Math.max(height, 0.01), radius: Math.max(radius, 0.01),
    pose: () => world,
  };
}
