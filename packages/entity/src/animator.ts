// The animator: clips blended from a physics body. Ported from the proof of
// concept's src/entity/clips.js `animator`; the equality test drives both
// with the same scripted bodies and compares every frame. save() / load() are
// the engine's addition (the POC world needed them: a restored world keeps
// its poses, mid-stride, mid-crossfade).
//
//   const anim = animator(spec);
//   anim.step(dt, body);                       // body: { pos, vel, facing, mode, wall }
//   renderer.setWorld({ capsules: anim.capsules(materials) });
//   const saved = anim.save();                 // plain data (JSON-safe)
//   animator(spec).load(saved);                // carries on exactly where it was

import { rightOf } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { FADES, LAND_TIME, QUAD_GAIT_AT, RUN_FROM, blankPose, blendPoses, clipsFor } from "./clips.ts";
import type { ClipParams, ClipPose } from "./clips.ts";
import { poseSkeleton } from "./rig.ts";
import type { Place, Plan, Skeleton } from "./rig.ts";
import { skinOf } from "./skin.ts";
import type { Capsule, MaterialTable, SkinOptions } from "./skin.ts";
import type { EntitySpec } from "./species.ts";

const frac = (v: number): number => v - Math.floor(v);

/** What a physics body is doing (physics' character modes). */
export type BodyMode = "ground" | "air" | "wall" | "grind" | "skim" | "sink";

/**
 * The body the animator follows -- the shape of physics' character body, so
 * one steps the other with no conversion.
 */
export interface AnimatorBody {
  /** Feet on the ground: the point between them (the physics body's bottom). */
  readonly pos: Vec3Like;
  readonly vel?: Vec3Like;
  /** Its yaw (physics sets facing = atan2(vel.x, vel.z)). */
  readonly facing: number;
  readonly mode?: BodyMode | undefined;
  /** The wall's normal, from the wall to the body. */
  readonly wall?: Vec3Like | undefined;
  /** How far pos is from the wall (given, the feet go onto it). */
  readonly wallGap?: number | undefined;
}

export interface Layer {
  name: string;
  w: number;
}

export interface AnimatorOptions {
  /** Crossfade length, seconds (each clip scales it: FADES). Default 0.14. */
  readonly fade?: number;
}

export interface StepOptions {
  /** Distance travelled so far, if the caller counts it (else it's measured from pos). */
  readonly dist?: number;
}

/** What anim.state reads. */
export interface AnimatorState {
  readonly clip: string | null;
  readonly phase: number;
  readonly time: number;
  readonly dist: number;
  readonly layers: Layer[];
}

// Everything the animator carries from one step to the next.
interface Inner {
  layers: Layer[];
  phase: number;
  time: number;
  dist: number;
  landT: number;
  mode: BodyMode | null | undefined;
  facing: number | null;
  turn: number;
  last: number | null;
  clip: string | null;
  held: { clip: string; params: ClipParams } | null;
  params: ClipParams;
  prevPos?: Vec3;
  gait?: number;
}

/** A saved animator: plain data, safe through JSON. */
export interface AnimatorSave {
  readonly schema: "keel-entity-animator@1";
  /** Which entity it animated (load() checks the plan; the rest is for the caller). */
  readonly entity: { readonly seed: string; readonly kind: string; readonly species: string; readonly plan: Plan };
  readonly state: {
    readonly layers: readonly Layer[];
    readonly phase: number;
    readonly time: number;
    readonly dist: number;
    readonly landT: number;
    readonly mode: BodyMode | null;
    readonly facing: number | null;
    readonly turn: number;
    readonly last: number | null;
    readonly clip: string | null;
    readonly held: { readonly clip: string; readonly params: ClipParams } | null;
    readonly params: ClipParams;
    readonly prevPos: Vec3 | null;
    readonly gait: number | null;
  };
  readonly pose: ClipPose;
  /** Where skeleton() stands it when not told: the last body's feet and heading. */
  readonly place: { readonly pos: Vec3; readonly yaw: number };
}

export interface Animator {
  readonly pose: ClipPose;
  readonly state: AnimatorState;
  /** Hold a clip whatever the body does (sit, lie, a pose for a cutscene) until release(). */
  hold(clip: string, params?: ClipParams): Animator;
  release(): Animator;
  /** Advance by dt seconds with the body as it is now. */
  step(dt: number, body: AnimatorBody, opts?: StepOptions): Animator;
  /** The posed skeleton in the world, at the body's feet, facing its heading. */
  skeleton(place?: Place): Skeleton;
  /** The capsules to draw. */
  capsules(materials?: MaterialTable, opts?: SkinOptions): Capsule[];
  /** Everything it carries, as plain data. */
  save(): AnimatorSave;
  /** Carry on from a save (same plan): the next step is the one the saved animator would have taken. */
  load(saved: AnimatorSave): Animator;
}

// (A deep copy of plain data: arrays and objects, undefined fields left out as JSON would.)
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * animator(spec, { fade }) -> { step(dt, body, { dist }), pose, state, hold(clip, params), release(),
 *                                skeleton(), capsules(materials), save(), load(saved) }
 * The phase runs on distance travelled (body.pos between steps, or `dist` if given).
 */
export function animator(spec: EntitySpec, { fade = 0.14 }: AnimatorOptions = {}): Animator {
  const quad = spec.plan === "quadruped";
  const clips = clipsFor(spec);
  const b = spec.body;
  const reach = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : b.hipH - b.ankleH;
  let st: Inner = { layers: [], phase: 0, time: 0, dist: 0, landT: 99, mode: null, facing: null, turn: 0, last: null, clip: null, held: null, params: {} };
  let pose = blankPose();
  let body0: { pos: Vec3Like; facing?: number } = { pos: [0, 0, 0], facing: 0 };

  function pick(body: AnimatorBody, speed: number): string {
    if (st.held) return st.held.clip;
    const m = body.mode ?? "ground";
    if (quad) {
      if (m === "air" || m === "sink") return "leap";
      if (m === "wall" || m === "skim") return "gallop";
      if (speed < reach * 0.25) return "idle";
      if (speed < reach * QUAD_GAIT_AT.trot) return "walk";
      if (speed < reach * QUAD_GAIT_AT.gallop) return "trot";
      return "gallop";
    }
    if (m === "air") return (body.vel?.[1] ?? 0) > 0.5 ? "jump" : "fall";
    if (m === "sink") return "fall";
    if (m === "wall") return "wallRun";
    if (m === "grind") return "grind";
    if (m === "skim") return "skim";
    const runFrom = reach * RUN_FROM;
    if (st.landT < LAND_TIME && speed < runFrom) return "land";
    if (speed < reach * 0.3) return Math.abs(st.turn) > 1.5 ? "turn" : "idle";
    return speed < runFrom ? "walk" : "run";
  }
  const clipNamed = (name: string) => {
    const fn = clips[name];
    if (!fn) throw new RangeError(`No ${spec.plan} clip "${name}" (${Object.keys(clips).join(", ")}).`);
    return fn;
  };

  const api: Animator = {
    get pose() { return pose; },
    get state() { return { clip: st.clip, phase: st.phase, time: st.time, dist: st.dist, layers: st.layers.map((l) => ({ ...l })) }; },
    hold(clip, params = {}) { clipNamed(clip); st.held = { clip, params }; return api; },
    release() { st.held = null; return api; },
    step(dt, body, { dist } = {}) {
      body0 = body;
      st.time += dt;
      let dd: number;
      if (dist !== undefined) { dd = st.last === null ? 0 : Math.max(0, dist - st.last); st.last = dist; }
      else {
        const prev = st.prevPos ?? body.pos;
        const dy = body.mode === "wall" ? body.pos[1] - prev[1] : 0;
        dd = Math.hypot(body.pos[0] - prev[0], dy, body.pos[2] - prev[2]);
        st.prevPos = [...body.pos];
      }
      // (A teleport -- a respawn -- is not a step.)
      if (dd > reach * 20) dd = 0;
      st.dist += dd;
      const speed = Math.hypot(body.vel?.[0] ?? 0, body.vel?.[2] ?? 0);
      if (st.facing !== null && dt > 0) {
        const d = Math.atan2(Math.sin(body.facing - st.facing), Math.cos(body.facing - st.facing));
        st.turn += (d / dt - st.turn) * Math.min(1, dt * 10);
      }
      st.facing = body.facing ?? 0;
      if (st.mode !== null && st.mode !== "ground" && body.mode === "ground") st.landT = 0;
      else st.landT += dt;
      st.mode = body.mode;
      // Which side the wall is on: +1 its left (the wall's normal points to its right).
      const wall = body.mode === "wall" && body.wall ? Math.sign(body.wall[0] * rightOf(st.facing)[0] + body.wall[2] * rightOf(st.facing)[2]) : 0;
      // (The gait follows the speed a little behind it, so a sudden burst eases the stride open rather than snapping it.)
      // (Four legs take a stride or two to change gait: their footfalls reorder.)
      st.gait = st.gait === undefined ? speed : st.gait + (speed - st.gait) * Math.min(1, dt * (quad ? 3.5 : 10));
      st.params = { speed: st.gait, vy: body.vel?.[1] ?? 0, wall, wallGap: body.wallGap, turn: st.turn, ...(st.held?.params ?? {}) };

      const clip = pick(body, speed);
      // (Walk and run -- and on four legs trot and gallop -- are one layer, the move gait, told the speed.)
      const layer = clip === "walk" || clip === "run" || (quad && (clip === "trot" || clip === "gallop")) ? "move" : clip;
      st.clip = clip;
      if (!st.layers.some((l) => l.name === layer)) st.layers.push({ name: layer, w: st.layers.length ? 0 : 1 });
      const span = fade * (FADES[layer] ?? 1);
      const rate = span > 0 ? dt / span : 1;
      // (The new layer rises; the rest share what's left in the proportions they had, so the weights always sum to 1.)
      const top = st.layers.find((l) => l.name === layer)!;
      top.w = Math.min(1, top.w + rate);
      const rest = st.layers.reduce((a, l) => a + (l === top ? 0 : l.w), 0);
      for (const l of st.layers) if (l !== top) l.w = rest > 0 ? (l.w / rest) * (1 - top.w) : 0;
      st.layers = st.layers.filter((l) => l.w > 1e-6 || l === top);
      if (st.layers.length === 1) top.w = 1;
      // Phase: distance over the cycle length the moving layers ask for.
      if (pose.cycle > 1e-6) st.phase = frac(st.phase + dd / pose.cycle);
      const ph = { phase: st.phase, landT: st.landT };
      pose = blendPoses(st.layers.map((l) => [clipNamed(l.name)(spec, st.time, ph, st.params), l.w] as const));
      if (!(pose.cycle > 0)) {
        // (Standing still, the next step starts from a cycle a walk would use.)
        pose.cycle = clipNamed("move")(spec, st.time, ph, { speed: 0 }).cycle;
      }
      return api;
    },
    skeleton(place) { return poseSkeleton(spec.rig, pose, place ?? { pos: body0.pos, yaw: body0.facing ?? 0 }); },
    capsules(materials, opts) { return skinOf(spec, api.skeleton(), materials, opts); },
    save() {
      return copy<AnimatorSave>({
        schema: "keel-entity-animator@1",
        entity: { seed: spec.seed, kind: spec.kind, species: spec.species, plan: spec.plan },
        state: {
          layers: st.layers, phase: st.phase, time: st.time, dist: st.dist, landT: st.landT, mode: st.mode ?? null, facing: st.facing, turn: st.turn,
          last: st.last, clip: st.clip, held: st.held, params: st.params, prevPos: st.prevPos ?? null, gait: st.gait ?? null,
        },
        pose,
        place: { pos: [body0.pos[0], body0.pos[1], body0.pos[2]], yaw: body0.facing ?? 0 },
      });
    },
    load(saved) {
      if (saved?.schema !== "keel-entity-animator@1") throw new TypeError("Not a saved animator (keel-entity-animator@1).");
      if (saved.entity.plan !== spec.plan) throw new TypeError(`A saved ${saved.entity.plan} animator can't drive a ${spec.plan} (${spec.species} seed ${spec.seed}).`);
      const s = copy(saved.state);
      for (const l of s.layers) clipNamed(l.name);
      if (s.held) clipNamed(s.held.clip);
      st = {
        layers: s.layers.map((l) => ({ ...l })), phase: s.phase, time: s.time, dist: s.dist, landT: s.landT, mode: s.mode, facing: s.facing, turn: s.turn,
        last: s.last, clip: s.clip, held: s.held, params: s.params,
        ...(s.prevPos ? { prevPos: s.prevPos } : {}), ...(s.gait !== null ? { gait: s.gait } : {}),
      };
      pose = copy(saved.pose);
      body0 = { pos: copy(saved.place.pos), facing: saved.place.yaw };
      return api;
    },
  };
  return api;
}
