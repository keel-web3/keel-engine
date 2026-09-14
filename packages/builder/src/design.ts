// Builder outputs as bake designs: the same `pose(clip, frame)` contract as
// @keel-engine/bake's entityDesign -- a DesignSpec (key, clips, height,
// radius) and a BakeSource (palette, materials, pose) -- so planBake and
// bakeSprites take a voxel creature, an animated prop or a static crate as
// they take any entity.
//
//   const fox = creatureDesign(autoRig(model), { pack: "packs/mine" });
//   const flag = objectDesign(model, { animation });
//   planBake([fox, flag], { pixelsPerMetre: 24 }); bakeSprites(px, plan.sprites, new Map([[fox.key, fox], [flag.key, flag]]));

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import { LOCOMOTION, clipsFor, placeAttribute, poseSkeleton, wear } from "@keel-engine/entity";
import type { AttributeShape, MaterialTable, Worn } from "@keel-engine/entity";
import type { AttributeDef, Pins } from "@keel-engine/runtime";
import { objectRig } from "./animate.ts";
import type { ObjectAnimation, ObjectSolids } from "./animate.ts";
import type { EntitySpec } from "@keel-engine/entity";
import { storeVoxels } from "./store.ts";
import { renderSolids } from "./convert.ts";
import type { SmoothOptions } from "./convert.ts";
import { builderLook } from "./look.ts";
import type { Look, Oklch } from "./look.ts";
import { characterLook, characterSolids, characterSpec } from "./character.ts";
import type { AttributeRegistry, CharacterDesign } from "./character.ts";
import { poseVoxels } from "./rig.ts";
import type { VoxelRig, VoxelSpec } from "./rig.ts";
import type { VoxelModel } from "./voxels.ts";

/** A clip to bake: its name, frames a cycle, whether it loops (the baker's ClipSpec). */
export interface DesignClip { readonly name: string; readonly frames: number; readonly loop?: boolean }
/** How a baked clip plays (the baker's ClipInfo): frames, metres a cycle (0 on the spot), m/s, seconds a cycle. */
export interface DesignClipInfo { readonly name: string; readonly frames: number; readonly loop: boolean; readonly cycle: number; readonly speed: number; readonly period: number }

/** What planBake and bakeSprites take (structurally @keel-engine/bake's DesignSpec & BakeSource). */
export interface BuilderDesign {
  readonly key: string;
  readonly clips: readonly DesignClip[];
  readonly height: number;
  readonly radius: number;
  readonly symmetric?: boolean;
  readonly palette: Look["palette"];
  readonly materials: Look["materials"];
  readonly look: Look;
  readonly clipInfo: Readonly<Record<string, DesignClipInfo>>;
  clip(name: string): DesignClipInfo;
  pose(clip: string, frame: number): ObjectSolids;
}

/** An attribute to wear (the baker's WornAttribute): its def, and pins. */
export type WornAttribute = AttributeDef<AttributeShape> | { readonly def: AttributeDef<AttributeShape>; readonly pins?: Pins };

/** A look's materials by the engine's entity roles (what attributes built for packs' characters play). */
export function entityMaterials(look: Pick<Look, "table">): MaterialTable {
  const t = look.table;
  return { cloth: t["primary"]!, clothAlt: t["secondary"]!, furAlt: t["trim"]!, accent: t["accent"]!, fur: t["skin"]!, dark: t["dark"]!, blush: t["glow"]!, hair: t["dark"]! };
}

export interface DesignOptions {
  /** The pack it comes from (part of the key). */
  readonly pack?: string;
  readonly clips?: readonly DesignClip[];
  /** Colours per role (OKLCH), or a whole look. */
  readonly colours?: Readonly<Record<string, Oklch>>;
  readonly look?: Look;
}

// (FNV-1a, two lanes -- as the baker's contentHash -- for keys.)
export function contentHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x0100019d) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export const HUMANOID_CLIPS: readonly DesignClip[] = [{ name: "idle", frames: 6, loop: true }, { name: "walk", frames: 8, loop: true }, { name: "run", frames: 8, loop: true }];
export const QUADRUPED_CLIPS: readonly DesignClip[] = [{ name: "idle", frames: 6, loop: true }, { name: "walk", frames: 8, loop: true }, { name: "trot", frames: 8, loop: true }, { name: "gallop", frames: 8, loop: true }];
// (Speeds in leg lengths a second, and one breath for idle: the baker's.)
const SPEED: Readonly<Record<string, number>> = { walk: 2.2, run: 6.5, skim: 6, move: 2.2, trot: 3.9, gallop: 8.5, bound: 7 };
const IDLE_PERIOD: Readonly<Record<string, number>> = { humanoid: 3.4, quadruped: 3 };

function measure(clips: readonly DesignClip[], pose: (c: string, f: number) => ObjectSolids): { height: number; radius: number } {
  let height = 0, radius = 0;
  for (const c of clips) for (let f = 0; f < c.frames; f += 1) {
    const s = pose(c.name, f);
    for (const k of s.capsules) for (const p of [k.a, k.b]) { height = Math.max(height, p[1] + k.r); radius = Math.max(radius, Math.hypot(p[0], p[2]) + k.r); }
    for (const b of s.boxes) { const e = Math.hypot(b.h[0], b.h[1], b.h[2]); height = Math.max(height, b.c[1] + b.h[1]); radius = Math.max(radius, Math.hypot(b.c[0], b.c[2]) + e); }
  }
  return { height, radius };
}

/** A rigged voxel creature as a bake design: the engine's clips for its body, its voxel skin at every frame. */
export function creatureDesign(rig: VoxelRig | VoxelSpec, opts: DesignOptions & { readonly attributes?: readonly WornAttribute[] } = {}): BuilderDesign & { readonly worn: readonly Worn[] } {
  const spec: VoxelSpec = "voxel" in rig ? rig : rig.spec;
  const look = opts.look ?? builderLook(opts.colours ?? {});
  // What it wears: each attribute built to its socket from its own stream (as the baker's entityDesign does).
  const wearing = (opts.attributes ?? []).map((a) => ("def" in a ? a : { def: a, pins: {} }));
  const worn = wearing.map(({ def, pins = {} }) => wear(def, spec, stream(createRoll(deriveSeed(String(spec.seed), `attribute:${def.id}`)), 0), pins));
  const roles = entityMaterials(look);
  const clips = opts.clips ?? (spec.plan === "quadruped" ? QUADRUPED_CLIPS : HUMANOID_CLIPS);
  const table = clipsFor(spec);
  const leg = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH;
  const clipInfo: Record<string, DesignClipInfo> = {};
  for (const c of clips) {
    const fn = table[c.name];
    if (!fn) throw new RangeError(`A ${spec.plan} has no clip "${c.name}" (${Object.keys(table).join(", ")}).`);
    const moving = LOCOMOTION.has(c.name);
    const speed = moving ? (SPEED[c.name] ?? 3) * leg : 0;
    const cycle = moving ? fn(spec, 0, { phase: 0 }, { speed }).cycle : 0;
    clipInfo[c.name] = { name: c.name, frames: c.frames, loop: c.loop ?? true, cycle, speed, period: moving ? cycle / Math.max(1e-6, speed) : IDLE_PERIOD[spec.plan] ?? 3 };
  }
  const memo = new Map<string, ObjectSolids>();
  const pose = (clip: string, frame: number): ObjectSolids => {
    const id = `${clip}#${frame}`;
    const had = memo.get(id);
    if (had) return had;
    const info = clipInfo[clip];
    if (!info) throw new RangeError(`${spec.voxel.name}: clip "${clip}" isn't baked (${Object.keys(clipInfo).join(", ")}).`);
    const phase = (((frame % info.frames) + info.frames) % info.frames) / info.frames;
    const p = table[clip]!(spec, phase * info.period, { phase, landT: 0 }, { speed: info.speed });
    const skel = poseSkeleton(spec.rig, p, { pos: [0, 0, 0], yaw: 0 });
    const s = poseVoxels(spec, skel, look);
    for (const w of worn) {
      const f = placeAttribute(skel, w.socket, w.design, { materials: roles });
      for (const c of f.capsules) s.capsules.push({ a: c.a, b: c.b, r: c.r, mat: c.mat });
      for (const b of f.boxes) s.boxes.push({ c: b.c, h: b.h, yaw: b.yaw, mat: b.mat });
    }
    memo.set(id, s);
    return s;
  };
  const { height, radius } = measure(clips, pose);
  const wornKey = wearing.map(({ def, pins = {} }) => `+${def.id}${Object.keys(pins).length ? JSON.stringify(Object.fromEntries(Object.entries(pins).sort(([a], [b]) => (a < b ? -1 : 1)))) : ""}`).join("");
  const shape = contentHash(JSON.stringify({ skin: spec.voxel.skin, rig: spec.rig.bones, body: spec.body, worn: worn.map((w) => w.design), clips: clips.map((c) => [c.name, c.frames]) }));
  const paint = contentHash(JSON.stringify({ c: look.palette, m: look.materials }));
  const key = `${opts.pack ?? "keel/builder"}:voxel/${spec.voxel.name}${wornKey}~${shape}~${paint}`;
  return {
    key, clips, height, radius, palette: look.palette, materials: look.materials, look, clipInfo, pose, worn,
    clip(name) { const c = clipInfo[name]; if (!c) throw new RangeError(`Clip "${name}" isn't baked.`); return c; },
  };
}

/** A voxel object (animated or not) as a bake design: its clips (or one still frame, "idle"). */
export function objectDesign(model: VoxelModel, opts: DesignOptions & { readonly animation?: ObjectAnimation; readonly smooth?: SmoothOptions; readonly symmetric?: boolean } = {}): BuilderDesign {
  const look = opts.look ?? builderLook(opts.colours ?? {});
  const anim = opts.animation;
  const rig = anim ? objectRig(model, anim) : null;
  const clips: readonly DesignClip[] = opts.clips ?? (anim ? Object.entries(anim.clips).map(([name, c]) => ({ name, frames: c.frames, loop: c.loop ?? true })) : [{ name: "idle", frames: 1, loop: true }]);
  const clipInfo: Record<string, DesignClipInfo> = {};
  for (const c of clips) clipInfo[c.name] = { name: c.name, frames: c.frames, loop: c.loop ?? true, cycle: 0, speed: 0, period: anim?.clips[c.name]?.period ?? 1 };
  const still = rig ? null : renderSolids(model, look, opts.smooth ? { smooth: opts.smooth } : {});
  const pose = (clip: string, frame: number): ObjectSolids => {
    if (!clipInfo[clip]) throw new RangeError(`${model.name}: clip "${clip}" isn't baked (${Object.keys(clipInfo).join(", ")}).`);
    return rig ? rig.pose(clip, frame, look) : still!;
  };
  const { height, radius } = measure(clips, pose);
  const shape = contentHash(JSON.stringify({ v: Array.from(storeVoxels(model)), anim: anim ?? null, s: opts.smooth ?? null }));
  const paint = contentHash(JSON.stringify({ c: look.palette, m: look.materials }));
  return {
    key: `${opts.pack ?? "keel/builder"}:voxel/${model.name}~${shape}~${paint}`,
    clips, height, radius, ...(opts.symmetric ? { symmetric: true } : {}),
    palette: look.palette, materials: look.materials, look, clipInfo, pose,
    clip(name) { const c = clipInfo[name]; if (!c) throw new RangeError(`Clip "${name}" isn't baked.`); return c; },
  };
}

function clipInfos(spec: EntitySpec, clips: readonly DesignClip[]): Record<string, DesignClipInfo> {
  const table = clipsFor(spec);
  const leg = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH;
  const out: Record<string, DesignClipInfo> = {};
  for (const c of clips) {
    const fn = table[c.name];
    if (!fn) throw new RangeError(`A ${spec.plan} has no clip "${c.name}" (${Object.keys(table).join(", ")}).`);
    const moving = LOCOMOTION.has(c.name);
    const speed = moving ? (SPEED[c.name] ?? 3) * leg : 0;
    const cycle = moving ? fn(spec, 0, { phase: 0 }, { speed }).cycle : 0;
    out[c.name] = { name: c.name, frames: c.frames, loop: c.loop ?? true, cycle, speed, period: moving ? cycle / Math.max(1e-6, speed) : IDLE_PERIOD[spec.plan] ?? 3 };
  }
  return out;
}

/** A character design (capsules and rig, parts, what it wears) as a bake design: the engine's clips for its body. */
export function characterBakeDesign(d: CharacterDesign, opts: { readonly pack?: string; readonly clips?: readonly DesignClip[]; readonly registry?: AttributeRegistry; readonly look?: Look } = {}): BuilderDesign {
  const spec = characterSpec(d);
  const look = opts.look ?? characterLook(spec);
  const clips = opts.clips ?? (spec.plan === "quadruped" ? QUADRUPED_CLIPS : HUMANOID_CLIPS);
  const clipInfo = clipInfos(spec, clips);
  const table = clipsFor(spec);
  const memo = new Map<string, ObjectSolids>();
  const pose = (clip: string, frame: number): ObjectSolids => {
    const id = `${clip}#${frame}`;
    const had = memo.get(id);
    if (had) return had;
    const info = clipInfo[clip];
    if (!info) throw new RangeError(`${spec.species}: clip "${clip}" isn't baked (${Object.keys(clipInfo).join(", ")}).`);
    const phase = (((frame % info.frames) + info.frames) % info.frames) / info.frames;
    const p = table[clip]!(spec, phase * info.period, { phase, landT: 0 }, { speed: info.speed });
    const s = characterSolids(d, poseSkeleton(spec.rig, p, { pos: [0, 0, 0], yaw: 0 }), look, opts.registry ?? new Map(), spec);
    memo.set(id, s);
    return s;
  };
  const { height, radius } = measure(clips, pose);
  const shape = contentHash(JSON.stringify({ d, clips: clips.map((c) => [c.name, c.frames]) }));
  const paint = contentHash(JSON.stringify({ c: look.palette, m: look.materials }));
  return {
    key: `${opts.pack ?? "keel/builder"}:character/${spec.kind}/${spec.species}#${d.seed}${d.wear.map((w) => `+${w.attribute}`).join("")}~${shape}~${paint}`,
    clips, height, radius, palette: look.palette, materials: look.materials, look, clipInfo, pose,
    clip(name) { const c = clipInfo[name]; if (!c) throw new RangeError(`Clip "${name}" isn't baked.`); return c; },
  };
}
