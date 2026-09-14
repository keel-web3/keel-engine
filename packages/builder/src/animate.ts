// Animating things that aren't creatures: a flag waving, a door swinging, a
// windmill turning, a lamp flickering, a tree swaying. Motions are data on
// part groups (the model's named regions), gathered into clips; a clip
// plays by time and poses to the same solids the baker draws.
//
//   const anim = { clips: { idle: { period: 2, frames: 8, motions: [{ kind: "wave", group: "cloth", hz: 0.5, amp: 1.5 }] } } };
//   const rig = objectRig(model, anim);
//   rig.pose("idle", 3, look.table)   -> { boxes, capsules }   (the baker's pose(clip, frame) shape)
//
// Motions (angles in radians, distances in voxels, pivots in voxel coordinates):
//   hinge    swings between `from` and `to` and back about `axis` through `pivot` (a door, a gate, a lid)
//   pivot    turns once from 0 to `angle` over the clip (not looping: a door opening)
//   spin     turns round `axis` through `pivot`, `hz` turns a second (a windmill, a fan, a wheel)
//   sway     rocks by +-`amp` about `axis` through `pivot` (a tree, a hanging sign, a lamp on a chain)
//   bob      moves +-`amp` along `axis` (a buoy, a floating crystal)
//   wave     a travelling wave down the group: each slice along `along` moves along `dir` by
//            amp * sin(2 pi (hz t - d / wavelength)), growing from the `pin` end (a flag, a banner, a cape)
//   flicker  the group's "glow" cells go dim on a seeded pattern, `rate` changes a second, lit `duty` of the time (a lamp, a torch)
//
// The renderer turns boxes about y only: a group turned about y stays boxes;
// turned about x or z its long boxes become capsules (a windmill's sails)
// and the rest split into cells whose centres turn -- a blocky thing turning,
// drawn as blocks. Groups may ride a parent group (sails on a turning cap).

import { byGroupAndRole, greedyBoxes } from "./mesh.ts";
import { capsuleOfBox, labelNames } from "./convert.ts";
import { materialOf } from "./look.ts";
import type { Look } from "./look.ts";
import type { V3, VoxelModel } from "./voxels.ts";

export type Axis = "x" | "y" | "z";
export type Motion =
  | { readonly kind: "hinge"; readonly group: string; readonly axis?: Axis; readonly pivot?: readonly [number, number, number]; readonly from?: number; readonly to: number; readonly hz?: number; readonly phase?: number }
  | { readonly kind: "pivot"; readonly group: string; readonly axis?: Axis; readonly pivot?: readonly [number, number, number]; readonly angle: number }
  | { readonly kind: "spin"; readonly group: string; readonly axis?: Axis; readonly pivot?: readonly [number, number, number]; readonly hz: number; readonly phase?: number }
  | { readonly kind: "sway"; readonly group: string; readonly axis?: Axis; readonly pivot?: readonly [number, number, number]; readonly amp: number; readonly hz: number; readonly phase?: number }
  | { readonly kind: "bob"; readonly group: string; readonly axis?: Axis; readonly amp: number; readonly hz: number; readonly phase?: number }
  | { readonly kind: "wave"; readonly group: string; readonly along?: Axis; readonly dir?: Axis; readonly amp: number; readonly hz: number; readonly wavelength?: number; readonly pin?: "min" | "max" }
  | { readonly kind: "flicker"; readonly group: string; readonly rate?: number; readonly duty?: number; readonly seed?: number };
export type MotionKind = Motion["kind"];
export const MOTION_KINDS: readonly MotionKind[] = ["hinge", "pivot", "spin", "sway", "bob", "wave", "flicker"];

export interface ObjectClip {
  /** Seconds a cycle (a looping clip) or the whole clip. */
  readonly period: number;
  /** Frames the baker draws. */
  readonly frames: number;
  readonly loop?: boolean;
  readonly motions: readonly Motion[];
}
export interface ObjectAnimation {
  readonly clips: Readonly<Record<string, ObjectClip>>;
  /** Group -> the group it rides (its motions apply on top of its parent's). */
  readonly parents?: Readonly<Record<string, string>>;
}

/** A turn and a move: p -> R (p - pivot) + pivot + t, in voxel units. */
interface Xf { m: number[]; t: V3 }
const IDENT = (): Xf => ({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
const rotAbout = (axis: Axis, a: number): number[] => {
  const c = Math.cos(a), s = Math.sin(a);
  // (Right-handed: about y, +a turns +z toward +x -- the frame's yaw.)
  return axis === "x" ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === "y" ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
};
const mul = (a: number[], b: number[]): number[] => { const o = new Array<number>(9); for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!; return o; };
const ap = (m: number[], v: readonly number[]): V3 => [m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!, m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!, m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!];
const applyXf = (x: Xf, p: readonly number[]): V3 => { const r = ap(x.m, p); return [r[0] + x.t[0], r[1] + x.t[1], r[2] + x.t[2]]; };
/** a after b: p -> a(b(p)). */
const compose = (a: Xf, b: Xf): Xf => ({ m: mul(a.m, b.m), t: applyXf(a, b.t) });
const turnAbout = (axis: Axis, ang: number, pivot: V3): Xf => { const m = rotAbout(axis, ang); const r = ap(m, pivot); return { m, t: [pivot[0] - r[0], pivot[1] - r[1], pivot[2] - r[2]] }; };
const AX: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };

const hash = (n: number, seed: number): number => { let h = Math.imul(n ^ (seed * 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** The solids a posed object is, for the renderer and the baker. */
export interface ObjectSolids {
  /** Boxes turned about y (a wedge: kind "wedge", its foot at lo). */
  boxes: Array<{ c: V3; h: V3; yaw: number; mat: number; kind?: "wedge"; lo?: number }>;
  capsules: Array<{ a: V3; b: V3; r: number; mat: number }>;
}

export interface ObjectRig {
  readonly model: VoxelModel;
  readonly animation: ObjectAnimation;
  /** Clip names, and each clip's frame count. */
  readonly clips: Readonly<Record<string, ObjectClip>>;
  /** The solids at a clip's frame (metres, own frame: pivot at the origin, +z front). */
  pose(clip: string, frame: number, look?: Pick<Look, "table">): ObjectSolids;
  /** The solids at a time (seconds) into a clip. */
  at(clip: string, time: number, look?: Pick<Look, "table">): ObjectSolids;
}

/** Check an animation against a model: groups exist, numbers make sense. Returns problems (empty: fine). */
export function checkAnimation(model: VoxelModel, anim: ObjectAnimation): string[] {
  const bad: string[] = [];
  const groups = new Set(model.groups.keys());
  for (const [name, c] of Object.entries(anim.clips)) {
    if (!(c.period > 0)) bad.push(`clips.${name}.period: seconds, above 0 (got ${c.period}).`);
    if (!(Number.isInteger(c.frames) && c.frames >= 1)) bad.push(`clips.${name}.frames: a whole number, at least 1 (got ${c.frames}).`);
    c.motions.forEach((mo, i) => {
      const at = `clips.${name}.motions[${i}] (${mo.kind})`;
      if (!MOTION_KINDS.includes(mo.kind)) bad.push(`${at}: kind is one of ${MOTION_KINDS.join(", ")}.`);
      if (!groups.has(mo.group)) bad.push(`${at}: no group "${mo.group}" (groups: ${[...groups].join(", ") || "none -- name one with a group op"}).`);
      const nums = Object.entries(mo).filter(([k]) => ["hz", "amp", "from", "to", "angle", "rate", "duty", "wavelength", "phase"].includes(k));
      for (const [k, v] of nums) if (typeof v !== "number" || !Number.isFinite(v)) bad.push(`${at}: ${k} must be a number.`);
    });
  }
  for (const [g, p] of Object.entries(anim.parents ?? {})) {
    if (!groups.has(g)) bad.push(`parents.${g}: no such group.`);
    if (!groups.has(p)) bad.push(`parents.${g}: its parent "${p}" is no group.`);
    let q: string | undefined = p;
    for (let k = 0; q && k < 32; k += 1) { if (q === g) { bad.push(`parents.${g}: rides itself.`); break; } q = anim.parents?.[q]; }
  }
  return bad;
}

/** A group's bounds, for default pivots: [min, max] (voxel edges). */
function groupBounds(model: VoxelModel): Map<string, { lo: V3; hi: V3 }> {
  const out = new Map<string, { lo: V3; hi: V3 }>();
  model.forEach((x, y, z) => {
    const g = model.groupAt(x, y, z);
    if (g === null) return;
    const b = out.get(g) ?? { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    b.lo = [Math.min(b.lo[0], x), Math.min(b.lo[1], y), Math.min(b.lo[2], z)];
    b.hi = [Math.max(b.hi[0], x + 1), Math.max(b.hi[1], y + 1), Math.max(b.hi[2], z + 1)];
    out.set(g, b);
  });
  return out;
}

/** An object rig: the model's groups driven by the animation's clips (see the top). */
export function objectRig(model: VoxelModel, animation: ObjectAnimation): ObjectRig {
  const bad = checkAnimation(model, animation);
  if (bad.length) throw new RangeError(`Animation for ${model.name}:\n  ${bad.join("\n  ")}`);
  const pivot = model.pivot();
  const u = model.unit;
  const bounds = groupBounds(model);
  const boxes = greedyBoxes(model, { label: byGroupAndRole(model) }).map((b) => ({ ...b, ...labelNames(model, b.label) }));
  const defaultPivot = (g: string): V3 => { const b = bounds.get(g); return b ? [(b.lo[0] + b.hi[0]) / 2, b.lo[1], (b.lo[2] + b.hi[2]) / 2] : [...pivot]; };

  // Each group's own motion at time t (seconds into the clip), and whether its glow is lit.
  const own = (clip: ObjectClip, g: string, t: number): { xf: Xf; lit: boolean; wave: Extract<Motion, { kind: "wave" }> | null; waveT: number } => {
    let xf = IDENT();
    let lit = true;
    let wave: Extract<Motion, { kind: "wave" }> | null = null;
    const u01 = clip.loop === false ? Math.min(1, t / clip.period) : 0;
    for (const mo of clip.motions) {
      if (mo.group !== g) continue;
      const ph = "phase" in mo ? mo.phase ?? 0 : 0;
      switch (mo.kind) {
        case "hinge": { const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((mo.hz ?? 1 / clip.period) * t + ph)); xf = compose(turnAbout(mo.axis ?? "y", (mo.from ?? 0) + (mo.to - (mo.from ?? 0)) * k, [...(mo.pivot ?? defaultPivot(g))] as V3), xf); break; }
        case "pivot": { const k = u01 * u01 * (3 - 2 * u01); xf = compose(turnAbout(mo.axis ?? "y", mo.angle * k, [...(mo.pivot ?? defaultPivot(g))] as V3), xf); break; }
        case "spin": xf = compose(turnAbout(mo.axis ?? "y", 2 * Math.PI * (mo.hz * t + ph), [...(mo.pivot ?? defaultPivot(g))] as V3), xf); break;
        case "sway": xf = compose(turnAbout(mo.axis ?? "z", mo.amp * Math.sin(2 * Math.PI * (mo.hz * t + ph)), [...(mo.pivot ?? defaultPivot(g))] as V3), xf); break;
        case "bob": { const d = mo.amp * Math.sin(2 * Math.PI * (mo.hz * t + ph)); const tt: V3 = [0, 0, 0]; tt[AX[mo.axis ?? "y"]] = d; xf = compose({ m: IDENT().m, t: tt }, xf); break; }
        case "wave": wave = mo; break;
        case "flicker": { const rate = mo.rate ?? 8; lit = hash(Math.floor(t * rate), mo.seed ?? 7) < (mo.duty ?? 0.8); break; }
      }
    }
    return { xf, lit, wave, waveT: t };
  };

  // Groups a clip turns far about x or z (a sail, a lid flipping): drawn turned in every frame (capsules and cells),
  // so the solids don't change kind mid-clip. A small tilt (a tree's sway) just moves its boxes.
  const turnedIn = new Map<string, Set<string>>();
  const turnedOf = (name: string, clip: ObjectClip): Set<string> => {
    let set = turnedIn.get(name);
    if (set) return set;
    set = new Set<string>();
    for (const mo of clip.motions) {
      if (!("axis" in mo) || mo.kind === "bob" || (mo.axis ?? (mo.kind === "sway" ? "z" : "y")) === "y") continue;
      const reach = mo.kind === "spin" ? Math.PI : mo.kind === "sway" ? Math.abs(mo.amp) : mo.kind === "pivot" ? Math.abs(mo.angle) : Math.max(Math.abs(mo.from ?? 0), Math.abs(mo.to));
      if (reach > 0.15) set.add(mo.group);
    }
    // (Riders of a turned group turn with it.)
    for (let k = 0; k < 8; k += 1) for (const [g, p] of Object.entries(animation.parents ?? {})) if (set.has(p)) set.add(g);
    turnedIn.set(name, set);
    return set;
  };

  const solve = (clipName: string, t: number, look: Pick<Look, "table">): ObjectSolids => {
    const clip = animation.clips[clipName];
    if (!clip) throw new RangeError(`${model.name} has no clip "${clipName}" (${Object.keys(animation.clips).join(", ") || "none"}).`);
    const turned = turnedOf(clipName, clip);
    const cache = new Map<string, ReturnType<typeof own>>();
    const ownOf = (g: string): ReturnType<typeof own> => { let v = cache.get(g); if (!v) { v = own(clip, g, t); cache.set(g, v); } return v; };
    const full = (g: string): Xf => {
      let xf = ownOf(g).xf;
      for (let p = animation.parents?.[g], k = 0; p && k < 32; p = animation.parents?.[p], k += 1) xf = compose(ownOf(p).xf, xf);
      return xf;
    };
    const out: ObjectSolids = { boxes: [], capsules: [] };
    const toM = (p: readonly number[]): V3 => [(p[0]! - pivot[0]) * u, (p[1]! - pivot[1]) * u, (p[2]! - pivot[2]) * u];
    for (const b of boxes) {
      const g = b.group;
      const lit = g ? ownOf(g).lit : true;
      const role = b.role === "glow" && !lit ? "glow-dim" : b.role;
      const mat = materialOf(look, role);
      const c: V3 = [b.min[0] + b.size[0] / 2, b.min[1] + b.size[1] / 2, b.min[2] + b.size[2] / 2];
      const half: V3 = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
      if (!g) { out.boxes.push({ c: toM(c), h: [half[0] * u, half[1] * u, half[2] * u], yaw: 0, mat }); continue; }
      const xf = full(g);
      const w = ownOf(g).wave;
      // (Its turn: about y alone, or not.)
      const m = xf.m;
      const yawOnly = !turned.has(g);
      if (w) {
        // A wave: slices one voxel thick along `along`, each moved along `dir`.
        const al = AX[w.along ?? "x"], di = AX[w.dir ?? "z"];
        const gb = bounds.get(g)!;
        const L = w.wavelength ?? Math.max(4, (gb.hi[al] - gb.lo[al]) * 1.2);
        for (let k = 0; k < b.size[al]; k += 1) {
          const sc: V3 = [...c];
          sc[al] = b.min[al] + k + 0.5;
          const sh: V3 = [...half];
          sh[al] = 0.5;
          const d = (w.pin ?? "min") === "min" ? sc[al] - gb.lo[al] : gb.hi[al] - sc[al];
          const reach = Math.min(1, d / Math.max(1, (gb.hi[al] - gb.lo[al]) * 0.35));
          const off = w.amp * reach * Math.sin(2 * Math.PI * (w.hz * t - d / L));
          sc[di] += off;
          const p = applyXf(xf, sc);
          out.boxes.push({ c: toM(p), h: [sh[0] * u, sh[1] * u, sh[2] * u], yaw: yawOnly ? Math.atan2(m[2]!, m[8]!) : 0, mat });
        }
        continue;
      }
      if (yawOnly) {
        // (Turned about y, or tilted a little: the box moves, turned by its heading.)
        out.boxes.push({ c: toM(applyXf(xf, c)), h: [half[0] * u, half[1] * u, half[2] * u], yaw: Math.atan2(m[2]!, m[8]!) + 0, mat });
        continue;
      }
      // Turned about x or z: a long box as a capsule, the rest as cells whose centres turn.
      // (A plank two cells by one still reads as a spar when it turns.)
      const cap = capsuleOfBox({ c, h: half }, 2.5, 2.1);
      if (cap) {
        out.capsules.push({ a: toM(applyXf(xf, cap.a)), b: toM(applyXf(xf, cap.b)), r: cap.r * u, mat });
        continue;
      }
      const cell = Math.max(1, Math.ceil(Math.cbrt((b.size[0] * b.size[1] * b.size[2]) / 27)));
      for (let z = 0; z < b.size[2]; z += cell) for (let y = 0; y < b.size[1]; y += cell) for (let x = 0; x < b.size[0]; x += cell) {
        const e: V3 = [Math.min(cell, b.size[0] - x), Math.min(cell, b.size[1] - y), Math.min(cell, b.size[2] - z)];
        const cc: V3 = [b.min[0] + x + e[0] / 2, b.min[1] + y + e[1] / 2, b.min[2] + z + e[2] / 2];
        out.boxes.push({ c: toM(applyXf(xf, cc)), h: [(e[0] / 2) * u, (e[1] / 2) * u, (e[2] / 2) * u], yaw: 0, mat });
      }
    }
    return out;
  };

  return {
    model, animation, clips: animation.clips,
    pose(clip, frame, look = { table: {} }) {
      const c = animation.clips[clip];
      if (!c) throw new RangeError(`${model.name} has no clip "${clip}" (${Object.keys(animation.clips).join(", ") || "none"}).`);
      const f = c.loop === false ? Math.min(frame, c.frames - 1) : ((frame % c.frames) + c.frames) % c.frames;
      const t = c.loop === false ? (c.frames > 1 ? (f / (c.frames - 1)) * c.period : 0) : (f / c.frames) * c.period;
      return solve(clip, t, look);
    },
    at: (clip, time, look = { table: {} }) => solve(clip, time, look),
  };
}
