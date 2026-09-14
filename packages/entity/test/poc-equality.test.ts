// The TypeScript entity system against the JavaScript proof of concept it was
// ported from (src/entity/*.js, imported from its repo, never written to): the
// same outputs, bit for bit (deepStrictEqual: numbers by Object.is) -- specs
// over hundreds of seeds x kinds x pins, the rig's maths, every clip posed and
// skinned at many phases, blends, fronts, and animators driven by the same
// scripted bodies, frame by frame.

import { test } from "node:test";
import { frontOf } from "@keel-engine/core";
import type { Vec3 } from "@keel-engine/core";
import * as T from "../src/index.ts";
import type { AnimatorBody, BodyMode, ClipParams, EntityPins, EntitySpec, Kind } from "../src/index.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
const J = hasPoc ? await poc<typeof T>("src/entity/index.js") : (null as unknown as typeof T);
const { same, exact, summary } = counter();
const KINDS: readonly Kind[] = ["humanoid", "anthro", "animal"];
const r3 = (r: () => number, s = 1): Vec3 => [(r() * 2 - 1) * s, (r() * 2 - 1) * s, (r() * 2 - 1) * s];

// Random valid pins for a seed: some choices pinned to one of their options (or a nudged number),
// each option read off the entity as pinned so far (ears come in the pinned species' shapes).
function randomPins(r: () => number, seed: string, kind: Kind): EntityPins {
  const pins: Record<string, unknown> = {};
  for (const ch of T.CHOICES) {
    if (ch.name === "kind" || r() > 0.25) continue;
    const made = T.entityOf(seed, { kind, pins: pins as EntityPins }).choices;
    const opts = T.optionsOf(ch.name, made) as readonly unknown[] | undefined;
    if (opts) pins[ch.name] = opts[Math.floor(r() * opts.length)];
    else if (ch.range) pins[ch.name] = ch.range[0] + (ch.range[1] - ch.range[0]) * r();
  }
  return pins as EntityPins;
}

test("specs: every seed x kind, pins, species and sizes", { skip }, () => {
  for (let i = 0; i < 300; i += 1) {
    const seed = i % 7 === 0 ? `0x${(i * 2654435761 >>> 0).toString(16)}` : String(i);
    for (const kind of [...KINDS, undefined]) same("specs (seed x kind)", T.entityOf(seed, { kind }), J.entityOf(seed, { kind }));
  }
  const r = rand(11);
  for (let i = 0; i < 400; i += 1) {
    const kind = KINDS[i % 3]!;
    const seed = String(1000 + i);
    const pins = randomPins(r, seed, kind);
    const size = i % 5 === 0 ? 0.2 + r() * 1.8 : undefined;
    same("specs (pinned)", T.entityOf(seed, { kind, pins, size }), J.entityOf(seed, { kind, pins, size }));
  }
  for (const kind of KINDS) {
    for (const [species] of T.SPECIES[kind]) {
      for (let s = 0; s < 20; s += 1) same("specs (species)", T.entityOf(String(s), { kind, species }), J.entityOf(String(s), { kind, species }));
    }
  }
  // (Aliases, and the errors, word for word.)
  same("specs (species)", T.entityOf("1", { kind: "animal", species: "bunny" }), J.entityOf("1", { kind: "animal", species: "bunny" }));
  const err = (f: () => unknown): string => { try { f(); return "no error"; } catch (e) { return `${(e as Error).name}: ${(e as Error).message}`; } };
  for (const bad of [{ kind: "animal", species: "frog" }, { pins: { wings: 2 } }, { kind: "anthro", pins: { ears: "side" } }, { kind: "humanoid", pins: { top: "cape" } }]) {
    same("errors", err(() => T.entityOf("1", bad as T.EntityOptions)), err(() => J.entityOf("1", bad as T.EntityOptions)));
  }
  // The catalogue itself.
  for (const ch of T.CHOICES) {
    const j = J.CHOICES.find((c) => c.name === ch.name)!;
    same("catalogue", [ch.name, ch.reads, ch.options], [j.name, j.reads, j.options]);
    same("catalogue", [...T.readsOf(ch.name)], [...J.readsOf(ch.name)]);
    for (let s = 0; s < 5; s += 1) { const a = T.choiceStream(s, ch.name); const b = J.choiceStream(s, ch.name); for (let k = 0; k < 4; k += 1) exact("catalogue", a.f(), b.f()); }
  }
  same("catalogue", T.CHOICES.map((c) => c.name), J.CHOICES.map((c) => c.name));
  same("catalogue", [T.SPECIES, T.EARS, T.KINDS], [J.SPECIES, J.EARS, J.KINDS]);
});

test("rig maths: rotations, rotateOnto, two-bone IK, rest and measured lengths", { skip }, () => {
  const r = rand(5);
  for (let i = 0; i < 4000; i += 1) {
    const [x, y, z] = r3(r, 4);
    same("rig rotations", [T.rotX(x), T.rotY(y), T.rotZ(z), T.euler(x, y, z), T.euler(0, 0, 0)], [J.rotX(x), J.rotY(y), J.rotZ(z), J.euler(x, y, z), J.euler(0, 0, 0)]);
    const m = T.euler(x, y, z);
    const n = T.euler(z, x, y);
    const v = r3(r);
    same("rig rotations", [T.mul(m, n), T.apply(m, v)], [J.mul(m, n), J.apply(m, v)]);
    const u = r3(r);
    const w = i % 50 === 0 ? ([-u[0], -u[1], -u[2]] as Vec3) : i % 77 === 0 ? u : r3(r);
    const nu = Math.hypot(...u);
    const nw = Math.hypot(...w);
    const un: Vec3 = [u[0] / nu, u[1] / nu, u[2] / nu];
    const wn: Vec3 = [w[0] / nw, w[1] / nw, w[2] / nw];
    same("rig rotations", T.rotateOnto(un, wn), J.rotateOnto(un, wn));
    const a = r3(r, 2);
    const t = i % 40 === 0 ? a : r3(r, 2);
    const L1 = 0.1 + r();
    const L2 = 0.1 + r();
    const pole = i % 60 === 0 ? ([0, 0, 0] as Vec3) : r3(r);
    same("rig IK", T.solveTwoBone(a, t, L1, L2, pole), J.solveTwoBone(a, t, L1, L2, pole));
  }
  for (const kind of KINDS) {
    for (let s = 0; s < 20; s += 1) {
      const spec = T.entityOf(String(s), { kind });
      same("rig lengths", T.restLengths(spec.rig), J.restLengths(spec.rig));
    }
  }
});

// Every clip at many phases, times, params, places: skeletons, capsules, feature points and fronts.
test("every clip posed and skinned, at many phases (bit-identical)", { skip }, () => {
  const r = rand(21);
  const tables = [{ fur: 20, cloth: 21, clothAlt: 22, accent: 23, dark: 24, blush: 25, furAlt: 26, hair: 27 }, { fur: 6 }, T.DEFAULT_MATERIALS];
  for (const kind of KINDS) {
    for (let s = 0; s < 36; s += 1) {
      const pins = s % 4 === 0 ? ({ top: "jacket", hood: true, pack: "tall", accessory: "cap", hair: "long" } as EntityPins) : s % 4 === 1 && kind !== "humanoid" ? ({ species: "fox", coat: "tipped" } as EntityPins) : {};
      const spec = T.entityOf(String(s * 13), { kind, pins: kind === "animal" ? {} : pins });
      const jspec = J.entityOf(String(s * 13), { kind, pins: kind === "animal" ? {} : pins });
      for (const clip of Object.keys(T.clipsFor(spec))) {
        for (let k = 0; k < 10; k += 1) {
          const params: ClipParams = { speed: r() * 14, wall: k % 3 === 0 ? 1 : k % 3 === 1 ? -1 : 0, wallGap: k % 2 ? r() * 0.5 : undefined, turn: r() * 6 - 3, seat: k === 3 ? 0 : k === 4 ? r() * 0.8 : undefined, vy: r() * 4 - 2 };
          const o = { t: r() * 9, phase: k / 10 + r() * 0.05, params, pos: r3(r, 3), yaw: r() * 7 - 3.5, landT: r() * 0.3 };
          const a = T.posed(spec, clip, o);
          const b = J.posed(jspec, clip, o);
          same("posed skeletons", a, b);
          const table = tables[k % 3]!;
          const ca = T.skinOf(spec, a, table, k === 7 ? { max: 12 } : {});
          const cb = J.skinOf(jspec, b, table, k === 7 ? { max: 12 } : {});
          same("skins (capsules)", ca, cb);
          same("feature points", T.featurePoints(ca), J.featurePoints(cb));
          same("entity fronts", T.frontOfEntity(ca, { yaw: o.yaw }), J.frontOfEntity(cb, { yaw: o.yaw }));
          if (k === 0) same("entity fronts", [T.frontOfEntity(a), T.frontOfEntity(spec), T.declaredFront(a), T.measuredLengths(spec.rig, a)], [J.frontOfEntity(b), J.frontOfEntity(jspec), J.declaredFront(b), J.measuredLengths(jspec.rig, b)]);
        }
      }
      // Raw clip poses, and blends of them (two and three at a time, odd weights).
      const clips = Object.keys(T.clipsFor(spec));
      for (let k = 0; k < 8; k += 1) {
        const ph = { phase: r(), landT: r() * 0.3 };
        const t = r() * 5;
        const params: ClipParams = { speed: r() * 12, wall: 1, turn: 2 };
        const names = [clips[Math.floor(r() * clips.length)]!, clips[Math.floor(r() * clips.length)]!, clips[Math.floor(r() * clips.length)]!];
        const pa = names.map((n) => T.clipsFor(spec)[n]!(spec, t, ph, params));
        const pb = names.map((n) => J.clipsFor(jspec)[n]!(jspec, t, ph, params));
        same("clip poses", pa, pb);
        const ws = [r(), r() * 0.5, k % 2 ? 0 : r()];
        same("blends", T.blendPoses(pa.map((p, i) => [p, ws[i]!] as const)), J.blendPoses(pb.map((p, i) => [p, ws[i]!] as const)));
        same("blends", T.blendPoses(pa.slice(0, 2).map((p, i) => [p, ws[i]!] as const)), J.blendPoses(pb.slice(0, 2).map((p, i) => [p, ws[i]!] as const)));
        same("blends", T.blendPoses([]), J.blendPoses([]));
      }
      if (spec.plan === "quadruped") for (let k = 0; k < 20; k += 1) { const v = k * 0.6; same("gaits", T.gaitAt(spec, v), J.gaitAt(jspec as T.QuadrupedSpec, v)); }
      else same("gaits", T.seatOf(spec), J.seatOf(jspec as T.HumanoidSpec));
    }
  }
  for (let i = 0; i < 2000; i += 1) { const q = r(); const d = 0.2 + r() * 0.7; const s = r(); const l = r(); same("gaits", T.footCycle(q, d, s, l), J.footCycle(q, d, s, l)); }
  same("gaits", [T.GAITS, T.QUAD_GAIT_AT, T.RUN_FROM, T.LAND_TIME, [...T.LOCOMOTION]], [J.GAITS, J.QUAD_GAIT_AT, J.RUN_FROM, J.LAND_TIME, [...J.LOCOMOTION]]);
  for (const role of ["fur", "furAlt", "cloth", "clothAlt", "accent", "dark", "blush", "hair"] as const) {
    for (const table of [...tables, {}, { dark: 1 }, { cloth: 2, dark: 5 }]) exact("materials", T.materialFor(role, table), J.materialFor(role, table));
  }
});

// A scripted body: the modes a physics body goes through, speeding up and slowing as it does.
interface Script { v: number; mode: BodyMode; vy: number; turn: number; wall?: boolean; gap?: number; hold?: string | null; teleport?: boolean }
function script(t: number, variant: number): Script {
  const k = variant % 4;
  if (t < 0.5) return { v: 0, mode: "ground", vy: 0, turn: k === 1 ? 3 : 0 };
  if (t < 1.5) return { v: 2, mode: "ground", vy: 0, turn: k === 2 ? 0.8 : 0 };
  if (t < 2.5) return { v: 9, mode: "ground", vy: 0, turn: 0 };
  if (t < 2.8) return { v: 9, mode: "air", vy: 3, turn: 0 };
  if (t < 3.1) return { v: 9, mode: "air", vy: -3, turn: 0 };
  if (t < 3.6) return { v: 0.001, mode: "ground", vy: 0, turn: 0, teleport: k === 3 && t < 3.2 };
  if (t < 4.1) return { v: 7, mode: k === 0 ? "wall" : k === 1 ? "grind" : k === 2 ? "skim" : "sink", vy: 0.8, turn: 0, wall: true, gap: k === 0 ? 0.25 : 0 };
  if (t < 4.7) return { v: 0, mode: "ground", vy: 0, turn: 0, hold: "sit" };
  return { v: 1, mode: "ground", vy: 0, turn: -2, hold: null };
}

function drive(M: typeof T, spec: EntitySpec, variant: number, frames: number, withDist: boolean): unknown[] {
  const anim = M.animator(spec, variant % 3 === 0 ? { fade: 0.2 } : {});
  const reach = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH;
  const body: { pos: Vec3; vel: Vec3; facing: number; mode: BodyMode; wall?: Vec3; wallGap?: number } = { pos: [1, 0, -2], vel: [0, 0, 0], facing: 0.4 + variant, mode: "ground" };
  const dt = 1 / 60;
  let v = 0;
  let dist = 0;
  let held: string | null = null;
  const out: unknown[] = [];
  for (let i = 0; i < frames; i += 1) {
    const t = i * dt;
    const s = script(t, variant);
    const accel = reach * 36 * dt;
    v += Math.max(-accel, Math.min(accel, s.v * reach - v));
    body.facing += s.turn * dt;
    const f = frontOf(body.facing);
    body.vel = [f[0] * v, s.vy, f[2] * v];
    body.pos = s.teleport ? [body.pos[0] + 50, body.pos[1], body.pos[2]] : [body.pos[0] + body.vel[0] * dt, Math.max(0, body.pos[1] + s.vy * dt), body.pos[2] + body.vel[2] * dt];
    body.mode = s.mode;
    if (s.wall) { const rr: Vec3 = [Math.cos(body.facing), 0, -Math.sin(body.facing)]; body.wall = variant % 2 ? rr : [-rr[0], 0, -rr[2]]; body.wallGap = s.gap ?? 0; }
    else { delete body.wall; delete body.wallGap; }
    const want: string | null = s.hold === undefined ? held : s.hold;
    if (want !== held) {
      if (want && spec.plan === "humanoid") anim.hold(want, variant % 2 ? { seat: 0 } : {});
      else if (want) anim.hold(variant % 2 ? "lie" : "sit");
      else anim.release();
      held = want;
    }
    dist += Math.hypot(body.vel[0], body.vel[2]) * dt;
    anim.step(dt, { ...body } as AnimatorBody, withDist ? { dist } : {});
    out.push({ state: anim.state, pose: anim.pose, skel: anim.skeleton(), caps: anim.capsules() });
  }
  return out;
}

test("animators driven by the same scripted bodies, frame by frame (bit-identical)", { skip }, () => {
  for (const kind of KINDS) {
    for (let s = 0; s < 8; s += 1) {
      const seed = String(40 + s * 7);
      const a = drive(T, T.entityOf(seed, { kind }), s, 330, s % 2 === 1);
      const b = drive(J, J.entityOf(seed, { kind }), s, 330, s % 2 === 1);
      for (let i = 0; i < a.length; i += 1) same("animator frames (state, pose, skeleton, capsules)", a[i], b[i], `${kind} seed ${seed} frame ${i}`);
    }
  }
});

test("summary", { skip }, () => {
  console.log(summary("entity vs the proof of concept (all identical)"));
});
