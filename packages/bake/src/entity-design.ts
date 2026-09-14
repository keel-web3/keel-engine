// Entity designs: a posed, skinned entity (with what it wears) as something
// the baker can draw. entityDesign(spec, ...) -> a DesignSpec for planBake
// (a key from everything that changes its pixels; its size, measured over
// every frame it bakes) and a BakeSource for bakeSprites (its palette and
// materials; its capsules at any clip's frame, at the origin facing +z).
//
//   const fox = entityDesign(entityOf("42", { kind: "anthro" }), { attributes: [beanie] });
//   const plan = planBake([fox, ...], { pixelsPerMetre: 24 });
//   bakeSprites(px, plan.sprites, new Map([[fox.key, fox], ...]));
//   fox.clip("walk") -> { frames, cycle, speed, period }   (frames advance by distance: frameOf)

import { createRoll, deriveSeed, oklch, stream } from "@keel-engine/core";
import type { Oklch } from "@keel-engine/entity";
import { LOCOMOTION, clipsFor, placeAttribute, poseSkeleton, skinOf, wear } from "@keel-engine/entity";
import type { AttributeShape, Capsule, EntitySpec, MaterialTable, Worn } from "@keel-engine/entity";
import type { AttributeDef, Pins } from "@keel-engine/runtime";
import type { BakeBox, BakeMaterial, BakePalette, BakeSource, BakeWorld } from "./bake.ts";
import type { ClipSpec, DesignSpec } from "./plan.ts";

/** Clips baked by default: 6-8 frames a cycle. */
export const HUMANOID_BAKE_CLIPS: readonly ClipSpec[] = [{ name: "idle", frames: 6, loop: true }, { name: "walk", frames: 8, loop: true }, { name: "run", frames: 8, loop: true }];
export const QUADRUPED_BAKE_CLIPS: readonly ClipSpec[] = [{ name: "idle", frames: 6, loop: true }, { name: "walk", frames: 8, loop: true }, { name: "trot", frames: 8, loop: true }, { name: "gallop", frames: 8, loop: true }];
/** The same with keel/entity's actions after the gaits (attack, 8 frames a cycle): a population's `clipsFor`. */
export const ACTION_BAKE_CLIPS = (plan: "humanoid" | "quadruped"): readonly ClipSpec[] => [...(plan === "quadruped" ? QUADRUPED_BAKE_CLIPS : HUMANOID_BAKE_CLIPS), { name: "attack", frames: 8, loop: true }];

/** The material numbers each role wears (WALLRUN's runner table: 4 and 5 stay the water's and the sky's). */
export const ENTITY_MATERIALS: MaterialTable = Object.freeze({ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9, furAlt: 11, clothAlt: 12, hair: 13 });

/** How a baked clip plays: frames a cycle, metres a cycle (0 for a clip on the spot), its speed (m/s) and seconds a cycle. */
export interface ClipInfo {
  readonly name: string;
  readonly frames: number;
  readonly loop: boolean;
  readonly cycle: number;
  readonly speed: number;
  readonly period: number;
}

/** An attribute to wear: its def (an AttributeShape design, built to its socket), and pins. */
export type WornAttribute = AttributeDef<AttributeShape> | { readonly def: AttributeDef<AttributeShape>; readonly pins?: Pins };

export interface EntityDesignOptions {
  /** The pack the entity comes from (part of the key). */
  readonly pack?: string;
  /** Clips and frames to bake (default: by body plan). */
  readonly clips?: readonly ClipSpec[];
  /** Material numbers by role (default ENTITY_MATERIALS). */
  readonly materials?: MaterialTable;
  /** The palette and the renderer's materials (default: ramps round the entity's own colours). */
  readonly palette?: { readonly palette: BakePalette; readonly materials: readonly BakeMaterial[] };
  /** What it wears. */
  readonly attributes?: readonly WornAttribute[];
  /** Entries per ramp in the default palette (default 5). */
  readonly rampLength?: number;
}

export interface EntityDesign extends DesignSpec, BakeSource {
  readonly spec: EntitySpec;
  readonly worn: readonly Worn[];
  /** The role -> material table its capsules use. */
  readonly roles: MaterialTable;
  /** How each baked clip plays. */
  clip(name: string): ClipInfo;
  readonly clipInfo: Readonly<Record<string, ClipInfo>>;
  /** Its capsules at a clip's frame (world space, at the origin facing +z). */
  capsules(clip: string, frame: number): Capsule[];
}

// (FNV-1a, two lanes: a 64-bit-ish content hash for keys, as hex.)
export function contentHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x0100019d) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

// A ramp of n entries dark to light round a colour (WALLRUN's rampAround): chroma easing off at both ends, the hue turning a little.
function rampAround([L, C, h]: Oklch, n: number): Array<[number, number, number]> {
  const L0 = Math.max(0.12, L - 0.42), L1 = Math.min(0.98, L + 0.16), c = Math.max(C, 0.02), turn = 12;
  return Array.from({ length: n }, (_, i) => { const k = n > 1 ? i / (n - 1) : 0.5; return oklch(L0 + (L1 - L0) * k, c * Math.sin(Math.PI * (0.15 + 0.7 * k)), h + turn * (k - 0.5)); });
}

/** The default look: a ramp round each of the entity's colour roles, and WALLRUN's materials over them. */
export function entityPalette(spec: EntitySpec, rampLength = 5): { palette: BakePalette; materials: BakeMaterial[] } {
  const c = spec.colours;
  const list: Record<string, Array<[number, number, number]>> = {
    dark: rampAround(c.dark, Math.max(3, rampLength - 1)),
    fur: rampAround(c.fur, rampLength),
    furAlt: rampAround(c.furAlt, rampLength),
    cloth: rampAround(c.cloth, rampLength),
    clothAlt: rampAround(c.clothAlt, rampLength),
    accent: rampAround(c.accent, rampLength),
    blush: rampAround(c.blush, Math.max(3, rampLength - 1)),
    hair: rampAround(c.hair, rampLength),
  };
  const colours: Array<[number, number, number]> = [];
  const ramps: Record<string, [number, number]> = {};
  for (const [name, r] of Object.entries(list)) { ramps[name] = [colours.length, r.length]; colours.push(...r); }
  const materials: BakeMaterial[] = [
    { ramp: "dark" }, { ramp: "dark" }, { ramp: "dark" }, { ramp: "dark", light: 0.8 }, { ramp: "dark" }, { ramp: "dark" },
    { ramp: "fur", light: 1.1 }, { ramp: "cloth" }, { ramp: "accent" }, { ramp: "blush" }, { ramp: "accent" },
    { ramp: "furAlt", light: 1.1 }, { ramp: "clothAlt" }, { ramp: "hair" },
  ];
  return { palette: { colours, ramps }, materials };
}

// Suggested speeds, in leg lengths a second: two legs walk ~2.2 and run ~6.5 (RUN_FROM is 4.5); four legs walk, trot, gallop.
const SPEED: Readonly<Record<string, number>> = { walk: 2.2, run: 6.5, skim: 6, move: 2.2, trot: 3.9, gallop: 8.5, bound: 7 };
const IDLE_PERIOD: Readonly<Record<string, number>> = { humanoid: 3.4, quadruped: 3 }; // (one breath)

export function entityDesign(spec: EntitySpec, options: EntityDesignOptions = {}): EntityDesign {
  const { pack = "keel/entity", rampLength = 5 } = options;
  const clips = options.clips ?? (spec.plan === "quadruped" ? QUADRUPED_BAKE_CLIPS : HUMANOID_BAKE_CLIPS);
  const roles = options.materials ?? ENTITY_MATERIALS;
  const look = options.palette ?? entityPalette(spec, rampLength);
  const table = clipsFor(spec);
  const leg = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH;

  // What it wears: each attribute built to its socket from its own stream (so adding one never changes another).
  const wearing = (options.attributes ?? []).map((a) => ("def" in a ? a : { def: a, pins: {} }));
  const worn = wearing.map(({ def, pins = {} }) => wear(def, spec, stream(createRoll(deriveSeed(String(spec.seed), `attribute:${def.id}`)), 0), pins));

  // How each clip plays.
  const clipInfo: Record<string, ClipInfo> = {};
  for (const c of clips) {
    const fn = table[c.name];
    if (!fn) throw new RangeError(`A ${spec.plan} has no clip "${c.name}" (${Object.keys(table).join(", ")}).`);
    if (!(c.frames >= 1)) throw new RangeError(`Clip ${c.name}: frames must be at least 1.`);
    const moving = LOCOMOTION.has(c.name);
    const speed = moving ? (SPEED[c.name] ?? 3) * leg : 0;
    const cycle = moving ? fn(spec, 0, { phase: 0 }, { speed }).cycle : 0;
    clipInfo[c.name] = { name: c.name, frames: c.frames, loop: c.loop ?? true, cycle, speed, period: moving ? cycle / Math.max(1e-6, speed) : IDLE_PERIOD[spec.plan] ?? 3 };
  }

  // Posed capsules, once per clip frame (directions share them).
  const memo = new Map<string, Capsule[]>();
  const boxMemo = new Map<string, BakeBox[]>();
  const pose = (clip: string, frame: number): { capsules: Capsule[]; boxes: BakeBox[] } => {
    const id = `${clip}#${frame}`;
    const had = memo.get(id);
    if (had) return { capsules: had, boxes: boxMemo.get(id)! };
    const info = clipInfo[clip];
    if (!info) throw new RangeError(`${spec.species}: clip "${clip}" isn't baked (${Object.keys(clipInfo).join(", ")}).`);
    const phase = (((frame % info.frames) + info.frames) % info.frames) / info.frames;
    const p = table[clip]!(spec, phase * info.period, { phase, landT: 0 }, { speed: info.speed });
    const skel = poseSkeleton(spec.rig, p, { pos: [0, 0, 0], yaw: 0 });
    const capsules = skinOf(spec, skel, roles);
    const boxes: BakeBox[] = [];
    for (const w of worn) {
      const f = placeAttribute(skel, w.socket, w.design, { materials: roles });
      capsules.push(...f.capsules);
      for (const b of f.boxes) boxes.push({ c: b.c, h: b.h, yaw: b.yaw, mat: b.mat });
    }
    memo.set(id, capsules);
    boxMemo.set(id, boxes);
    return { capsules, boxes };
  };

  // Its size over every frame it bakes: the tallest point, the farthest reach from the origin on the ground.
  let height = 0;
  let radius = 0;
  for (const c of clips) for (let f = 0; f < c.frames; f += 1) {
    const { capsules, boxes } = pose(c.name, f);
    for (const k of capsules) for (const p of [k.a, k.b]) { height = Math.max(height, p[1] + k.r); radius = Math.max(radius, Math.hypot(p[0], p[2]) + k.r); }
    for (const b of boxes) { const e = Math.hypot(b.h[0] ?? 0, b.h[1] ?? 0, b.h[2] ?? 0); height = Math.max(height, (b.c[1] ?? 0) + e); radius = Math.max(radius, Math.hypot(b.c[0] ?? 0, b.c[2] ?? 0) + e); }
  }

  // The key: where it's from, who it is, a hash of everything that shapes it (the spec, what it wears, the clips' frames, the look).
  const wornKey = wearing.map(({ def, pins = {} }) => `+${def.id}${Object.keys(pins).length ? JSON.stringify(Object.fromEntries(Object.entries(pins).sort(([a], [b]) => (a < b ? -1 : 1)))) : ""}`).join("");
  const shape = contentHash(JSON.stringify({ spec, worn: worn.map((w) => w.design), clips: clips.map((c) => [c.name, c.frames]) }));
  const paint = contentHash(JSON.stringify({ look, roles }));
  const key = `${pack}:${spec.kind}/${spec.species}#${String(spec.seed)}${wornKey}~${shape}~${paint}`;

  const world = (clip: string, frame: number): BakeWorld => pose(clip, frame);
  return {
    key, clips, height, radius, spec, worn, roles, clipInfo,
    palette: look.palette, materials: look.materials,
    pose: world,
    capsules: (clip, frame) => pose(clip, frame).capsules,
    clip(name) { const c = clipInfo[name]; if (!c) throw new RangeError(`Clip "${name}" isn't baked.`); return c; },
  };
}

/** Which frame a clip shows: by distance travelled (a moving clip: feet stay planted) or by time (on the spot). */
export function frameOf(info: ClipInfo, dist: number, time: number): number {
  const u = info.cycle > 0 ? dist / info.cycle : time / info.period;
  const f = Math.floor((u - Math.floor(u)) * info.frames);
  return f >= info.frames ? info.frames - 1 : f;
}
