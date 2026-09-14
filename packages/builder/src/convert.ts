// Convert: voxels -> the engine's own things.
//
//   partsFromVoxels(model)            scene parts (boxes, or capsules where smoothing asks), named by group or role
//   objectFromVoxels(model, opts)     an object definition: parts, colliders, top sockets, a detected front
//   attributeFromVoxels(model, opts)  a runtime attribute built in its socket's frame, sized to the socket
//   (entities: rig.ts -- entityFromVoxels)
//
// Everything is in metres in the thing's own frame: a voxel is `model.unit`
// on a side, and the model's pivot (`origin`, or the middle of its base) is
// the origin -- so an object stands on y = 0 and faces +z as it was built.

import { defineObject, topsOf } from "@keel-engine/object";
import type { Collider, ObjectDef, ObjectPart, SocketSpec } from "@keel-engine/object";
import type { AttributeBox, AttributeCapsule, AttributeShape, Role as EntityRole } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import type { AttributeDef, AttributeTarget, Choice, Pins, Socket, Stream } from "@keel-engine/runtime";
import { detectFront } from "@keel-engine/scene";
import type { FrontResult, FrontSpec, PartLike } from "@keel-engine/scene";
import { entityRoleOf, materialOf } from "./look.ts";
import type { Look } from "./look.ts";
import { byGroupAndRole, greedyBoxes } from "./mesh.ts";
import type { VoxelBox } from "./mesh.ts";
import { applyVariation, variationChoices } from "./variation.ts";
import type { VariationRules } from "./variation.ts";
import type { V3, VoxelModel } from "./voxels.ts";

/** A box in metres (own frame), with what it plays and where it came from. */
export interface MetreBox {
  readonly c: V3;
  readonly h: V3;
  readonly role: string;
  readonly group: string | null;
  /** Voxels it covers. */
  readonly cells: number;
}
/** A capsule in metres (own frame). */
export interface MetreCapsule {
  readonly a: V3;
  readonly b: V3;
  readonly r: number;
  readonly role: string;
  readonly group: string | null;
}

export interface SmoothOptions {
  /** Turn long boxes into capsules (organic limbs, poles, sails): at least this long for their thickness (default 2.5); only these roles / groups (default all). */
  readonly capsules?: boolean | { readonly minAspect?: number; readonly roles?: readonly string[]; readonly groups?: readonly string[] };
  /** Round every box's edges by this share of its thinnest half-extent (SDF parts only: the renderer's boxes are sharp). */
  readonly round?: number;
}

/** The label a greedy box carries (group * 256 + role index) back to names. */
export function labelNames(model: VoxelModel, label: number): { role: string; group: string | null } {
  const names = [...model.groups.keys()];
  const g = label >> 8;
  return { role: model.roles[(label & 255) - 1] ?? "primary", group: g ? names[g - 1] ?? null : null };
}

/** Greedy boxes by group and role, in metres about the pivot. */
export function metreBoxes(model: VoxelModel, { pivot = model.pivot(), boxes }: { pivot?: V3; boxes?: readonly VoxelBox[] } = {}): MetreBox[] {
  const list = boxes ?? greedyBoxes(model, { label: byGroupAndRole(model) });
  const u = model.unit;
  return list.map((b) => {
    const { role, group } = labelNames(model, b.label);
    return {
      c: [(b.min[0] + b.size[0] / 2 - pivot[0]) * u, (b.min[1] + b.size[1] / 2 - pivot[1]) * u, (b.min[2] + b.size[2] / 2 - pivot[2]) * u],
      h: [(b.size[0] / 2) * u, (b.size[1] / 2) * u, (b.size[2] / 2) * u],
      role, group, cells: b.size[0] * b.size[1] * b.size[2],
    };
  });
}

/** A long box as a capsule along its long axis (or null when it isn't long enough, or its section isn't square-ish). */
export function capsuleOfBox(b: Pick<MetreBox, "c" | "h">, minAspect = 2.5, maxFlat = 1.6): { a: V3; b: V3; r: number } | null {
  const ax = b.h[0] >= b.h[1] && b.h[0] >= b.h[2] ? 0 : b.h[1] >= b.h[2] ? 1 : 2;
  const others = [0, 1, 2].filter((i) => i !== ax).map((i) => b.h[i]!);
  const thick = Math.max(...others);
  if (b.h[ax]! < minAspect * thick || Math.max(...others) > maxFlat * Math.min(...others)) return null;
  // (A square section of half-side h holds a circle of the same area at r = 1.13 h: the capsule keeps the voxels' bulk.)
  const r = ((others[0]! + others[1]!) / 2) * 1.1;
  const reach = Math.max(0, b.h[ax]! - r);
  const a: V3 = [...b.c];
  const e: V3 = [...b.c];
  a[ax] -= reach;
  e[ax] += reach;
  return { a, b: e, r };
}

/** Boxes and capsules after smoothing. */
export function smoothed(boxes: readonly MetreBox[], smooth: SmoothOptions = {}): { boxes: MetreBox[]; capsules: MetreCapsule[] } {
  const cfg = smooth.capsules;
  if (!cfg) return { boxes: [...boxes], capsules: [] };
  const opt = cfg === true ? {} : cfg;
  const out: MetreBox[] = [];
  const caps: MetreCapsule[] = [];
  for (const b of boxes) {
    const wanted = (!opt.roles || opt.roles.includes(b.role)) && (!opt.groups || (b.group !== null && opt.groups.includes(b.group)));
    const c = wanted ? capsuleOfBox(b, opt.minAspect ?? 2.5) : null;
    if (c) caps.push({ ...c, role: b.role, group: b.group });
    else out.push(b);
  }
  return { boxes: out, capsules: caps };
}

export interface PartOptions {
  readonly smooth?: SmoothOptions;
  readonly pivot?: V3;
}
/** A built part: a box or capsule part-like (scene's toPart takes it), its name (group, else role), its role as its material. */
export type VoxelPart = PartLike & { readonly name: string; readonly mat: string; readonly role: string; readonly group: string | null };

/** The model as scene parts (PartLike: { box } or { capsule }, name, mat = role, role, group). */
export function partsFromVoxels(model: VoxelModel, { smooth = {}, pivot }: PartOptions = {}): VoxelPart[] {
  const s = smoothed(metreBoxes(model, pivot ? { pivot } : {}), smooth);
  const round = smooth.round ?? 0;
  return [
    ...s.boxes.map((b): VoxelPart => ({ box: { c: b.c, h: b.h, ...(round > 0 ? { round: Math.min(...b.h) * round } : {}) }, name: b.group ?? b.role, mat: b.role, role: b.role, group: b.group })),
    ...s.capsules.map((c): VoxelPart => ({ capsule: { a: c.a, b: c.b, r: c.r }, name: c.group ?? c.role, mat: c.role, role: c.role, group: c.group })),
  ];
}

/** The model's solids for the pixel renderer (setWorld), placed at `pos` turned by `yaw`, materials from a look. */
export function renderSolids(model: VoxelModel, look: Pick<Look, "table">, { pos = [0, 0, 0], yaw = 0, smooth = {} }: { pos?: readonly number[]; yaw?: number; smooth?: SmoothOptions } = {}): { boxes: { c: V3; h: V3; yaw: number; mat: number }[]; capsules: { a: V3; b: V3; r: number; mat: number }[] } {
  const s = smoothed(metreBoxes(model), smooth);
  const co = Math.cos(yaw), si = Math.sin(yaw);
  // (Own frame -> world: turned about y by yaw, then moved; core frame, x' = c x + s z, z' = -s x + c z.)
  const W = (p: V3): V3 => [pos[0]! + co * p[0] + si * p[2], pos[1]! + p[1], pos[2]! - si * p[0] + co * p[2]];
  return {
    boxes: s.boxes.map((b) => ({ c: W(b.c), h: b.h, yaw, mat: materialOf(look, b.role) })),
    capsules: s.capsules.map((c) => ({ a: W(c.a), b: W(c.b), r: c.r, mat: materialOf(look, c.role) })),
  };
}

// ---------------------------------------------------------------- objects

export interface VoxelObjectMeta {
  readonly builder: {
    readonly voxels: number;
    readonly boxes: number;
    readonly capsules: number;
    readonly colliders: number;
    readonly roles: readonly string[];
    readonly groups: readonly string[];
    /** What front detection said (the object's `front` is it when confident, else as declared). */
    readonly front: { readonly yaw: number; readonly confidence: number; readonly symmetric: boolean; readonly why: readonly string[] };
    /** Anything the caller rides along (animation, variation). */
    readonly [more: string]: unknown;
  };
}

export interface ObjectOptions {
  readonly key?: string;
  /** A declared front (checked by front detection), or "detect" (default): the detected front when it is confident, snapped to the grid's four sides. */
  readonly front?: FrontSpec | "detect";
  readonly tags?: readonly string[];
  readonly smooth?: SmoothOptions;
  /** "merged" (default): the voxels' occupancy merged whatever their roles (fewer boxes) · "parts": one per part · "none". */
  readonly colliders?: "merged" | "parts" | "none";
  readonly sockets?: Readonly<Record<string, SocketSpec>>;
  /** Top surfaces kept as sockets: top, top.1, top.2 ... (default 4), each at least this many square metres (default 2 voxels' faces). */
  readonly tops?: number;
  readonly minTopArea?: number;
  readonly rest?: "base" | "hang" | "float";
  /** Extra meta (animation, variation...) kept under meta.builder. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

// (+ 0: no -0 fronts.)
const snapQuarter = (yaw: number): number => { const q = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2); return (Math.abs(q - yaw) < 0.35 ? Math.atan2(Math.sin(q), Math.cos(q)) : yaw) + 0; };

/** An object definition from a voxel model (see ObjectOptions). */
export function objectFromVoxels(model: VoxelModel, opts: ObjectOptions = {}): ObjectDef<VoxelObjectMeta> {
  const key = opts.key ?? model.name;
  const parts = partsFromVoxels(model, opts.smooth ? { smooth: opts.smooth } : {});
  if (!parts.length) throw new RangeError(`Object ${key}: the model is empty.`);
  const u = model.unit;
  const pivot = model.pivot();
  let colliders: Collider[] | null = null;
  if ((opts.colliders ?? "merged") === "merged") {
    colliders = greedyBoxes(model, { label: () => 1 }).map((b) => ({
      c: [(b.min[0] + b.size[0] / 2 - pivot[0]) * u, (b.min[1] + b.size[1] / 2 - pivot[1]) * u, (b.min[2] + b.size[2] / 2 - pivot[2]) * u],
      h: [(b.size[0] / 2) * u, (b.size[1] / 2) * u, (b.size[2] / 2) * u], yaw: 0, mat: "voxel",
    }));
  } else if (opts.colliders === "none") colliders = [];
  // The front: declared (and checked), or detected.
  const detected: FrontResult = detectFront(parts);
  let front: FrontSpec = null;
  if (opts.front === undefined || opts.front === "detect") {
    if (!detected.symmetric && detected.confidence >= 0.35) front = snapQuarter(detected.yaw);
  } else front = opts.front;
  // Top sockets: every free box top big enough, biggest first (the object's own topsOf, over the colliders).
  const sockets: Record<string, SocketSpec> = {};
  const probe = defineObject({ key, parts, colliders: colliders ?? null, front: null });
  const minArea = opts.minTopArea ?? 2 * u * u;
  const tops = topsOf(probe.parts as ObjectPart[], probe.colliders).filter((t) => t.area >= minArea).slice(0, opts.tops ?? 4);
  tops.forEach((t, i) => { sockets[i ? `top.${i}` : "top"] = { kind: "top", pos: t.pos, yaw: t.yaw, extent: t.extent }; });
  Object.assign(sockets, opts.sockets ?? {});
  const smoothCaps = parts.filter((p) => "capsule" in p).length;
  return defineObject<VoxelObjectMeta>({
    key,
    parts,
    front,
    tags: [...(opts.tags ?? []), "voxel"],
    colliders,
    sockets,
    ...(opts.rest ? { rest: opts.rest } : {}),
    meta: {
      builder: {
        voxels: model.count, boxes: parts.length - smoothCaps, capsules: smoothCaps, colliders: probe.colliders.length,
        roles: [...model.roles], groups: [...model.groups.keys()],
        front: { yaw: detected.detected.yaw, confidence: detected.detected.confidence, symmetric: detected.symmetric, why: detected.why },
        ...(opts.meta ?? {}),
      },
    },
  });
}

// ---------------------------------------------------------------- attributes

export type FitMode = "width" | "height" | "depth" | "contain" | "stretch";
export type Anchor = "auto" | "bottom" | "top" | "back" | "front" | "center";

export interface AttributeOptions {
  readonly id: string;
  readonly slot: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  /** Default: every humanoid and quadruped (runtime's fits() still asks the packs). */
  readonly targets?: readonly AttributeTarget[];
  /** How the model is sized to the socket (default "width": its width is the socket's, times `fill`). */
  readonly fit?: FitMode;
  readonly fill?: number;
  /** Which of its faces sits on the socket's origin (default "auto": from the socket's `out`, or centred on an "around" socket). */
  readonly anchor?: Anchor;
  /** Moved by this share of the socket's size, [x, y, z]. */
  readonly offset?: readonly [number, number, number];
  readonly smooth?: SmoothOptions;
  /** Builder role -> the entity role its material plays (default ENTITY_ROLE_OF). */
  readonly roles?: Readonly<Record<string, EntityRole>>;
  /** Seeded variants: each build draws them from its stream (pins win). */
  readonly variation?: VariationRules;
}

/** An attribute's design: the fitter's AttributeShape, and what it was built from. */
export interface VoxelAttributeShape extends AttributeShape {
  readonly boxes: readonly AttributeBox[];
  readonly capsules: readonly AttributeCapsule[];
  readonly builder: { readonly scale: readonly [number, number, number]; readonly voxels: number; readonly variant: Readonly<Record<string, unknown>> };
}

/** Where the model's own bounds sit against the socket, from the socket's `out` (and `sits`). */
export function anchorFor(fit: Socket, anchor: Anchor = "auto"): Exclude<Anchor, "auto"> {
  if (anchor !== "auto") return anchor;
  const f = fit as Socket & { out?: readonly number[]; sits?: string };
  if (f.sits === "around") return "center";
  const out = f.out ?? [0, 1, 0];
  const ax = Math.abs(out[1]!) >= Math.abs(out[2]!) && Math.abs(out[1]!) >= Math.abs(out[0]!) ? 1 : 2;
  if (ax === 1) return out[1]! >= 0 ? "bottom" : "top";
  return out[2]! >= 0 ? "back" : "front";
}

/** The model built to one socket: boxes (and capsules) in the socket's frame, sized to it. */
export function fitToSocket(model: VoxelModel, fit: Socket, opts: Omit<AttributeOptions, "id" | "slot" | "variation"> = {}): VoxelAttributeShape {
  const b = model.bounds();
  if (!b) throw new RangeError(`${model.name}: an empty model fits nothing.`);
  const size: V3 = [b.max[0] - b.min[0] + 1, b.max[1] - b.min[1] + 1, b.max[2] - b.min[2] + 1];
  const fill = opts.fill ?? 1;
  const want: V3 = [fit.size[0] * fill, fit.size[1] * fill, fit.size[2] * fill];
  const k = (i: number): number => want[i]! / size[i]!;
  const mode = opts.fit ?? "width";
  const s: V3 = mode === "stretch" ? [k(0), k(1), k(2)] : (() => { const u = mode === "height" ? k(1) : mode === "depth" ? k(2) : mode === "contain" ? Math.min(k(0), k(1), k(2)) : k(0); return [u, u, u] as V3; })();
  // (The anchor: which face of the model's box goes on the socket's origin; the other axes centred.)
  const a = anchorFor(fit, opts.anchor ?? "auto");
  const mid: V3 = [(b.min[0] + b.max[0] + 1) / 2, (b.min[1] + b.max[1] + 1) / 2, (b.min[2] + b.max[2] + 1) / 2];
  const at: V3 = [...mid];
  if (a === "bottom") at[1] = b.min[1];
  if (a === "top") at[1] = b.max[1] + 1;
  if (a === "back") at[2] = b.min[2];
  if (a === "front") at[2] = b.max[2] + 1;
  const off = opts.offset ?? [0, 0, 0];
  const shift: V3 = [off[0] * fit.size[0], off[1] * fit.size[1], off[2] * fit.size[2]];
  const P = (vx: number, vy: number, vz: number): V3 => [(vx - at[0]) * s[0] + shift[0], (vy - at[1]) * s[1] + shift[1], (vz - at[2]) * s[2] + shift[2]];
  const roleOf = (r: string): EntityRole => opts.roles?.[r] ?? entityRoleOf(r);
  const boxes = greedyBoxes(model, { label: byGroupAndRole(model) });
  const metre = boxes.map((vb): MetreBox => {
    const { role, group } = labelNames(model, vb.label);
    return { c: P(vb.min[0] + vb.size[0] / 2, vb.min[1] + vb.size[1] / 2, vb.min[2] + vb.size[2] / 2), h: [(vb.size[0] / 2) * s[0], (vb.size[1] / 2) * s[1], (vb.size[2] / 2) * s[2]], role, group, cells: vb.size[0] * vb.size[1] * vb.size[2] };
  });
  const sm = smoothed(metre, opts.smooth ?? {});
  return {
    boxes: sm.boxes.map((m): AttributeBox => ({ c: m.c, h: m.h, part: m.group ?? m.role, role: roleOf(m.role) })),
    capsules: sm.capsules.map((c): AttributeCapsule => ({ a: c.a, b: c.b, r: c.r, part: c.group ?? c.role, role: roleOf(c.role) })),
    builder: { scale: s, voxels: model.count, variant: {} },
  };
}

const BOTH: readonly AttributeTarget[] = [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1" }];

/** An attribute's build(S, fit, pins) from a voxel model: varied by seed (pins win), fitted to the socket it lands on. */
export function voxelAttribute(model: VoxelModel, opts: Omit<AttributeOptions, "id" | "slot" | "title" | "tags" | "targets"> = {}): (S: Stream, fit: Socket, pins: Pins) => VoxelAttributeShape {
  const base = model.clone();
  const rules = opts.variation;
  const memo = new Map<string, VoxelModel>();
  return (S, fit, pins) => {
    let m = base;
    let variant: Record<string, unknown> = {};
    if (rules) {
      const v = applyVariation(base, rules, S, pins);
      variant = v.picked;
      const k = JSON.stringify(v.picked);
      m = memo.get(k) ?? v.model;
      if (memo.size > 64) memo.delete(memo.keys().next().value!);
      memo.set(k, m);
    }
    const shape = fitToSocket(m, fit, opts);
    return { ...shape, builder: { ...shape.builder, variant } };
  };
}

/**
 * A runtime attribute from a voxel model: built in its socket's frame, sized
 * to the socket (the same block-built hat on a mouse's head or a bear's),
 * varied per seed by `variation`. Its design is an AttributeShape, so
 * keel/entity's wear() and placeAttribute() put it on any posed skeleton.
 */
export function attributeFromVoxels(model: VoxelModel, opts: AttributeOptions): AttributeDef<VoxelAttributeShape> {
  const choices: Record<string, Choice> = opts.variation ? variationChoices(opts.variation) : {};
  return defineAttribute<VoxelAttributeShape>({
    id: opts.id,
    slot: opts.slot,
    ...(opts.title ? { title: opts.title } : {}),
    tags: [...(opts.tags ?? []), "voxel"],
    targets: opts.targets ?? BOTH,
    ...(Object.keys(choices).length ? { choices } : {}),
    build: voxelAttribute(model, opts),
  });
}
