// The animator's save() and load(): a saved animator -- mid-stride, mid-
// crossfade, holding a clip -- restored into a fresh one (through JSON, as a
// world snapshot would carry it) carries on exactly: the same state, pose,
// skeleton and capsules, bit for bit, frame after frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf } from "@keel-engine/core";
import type { Vec3 } from "@keel-engine/core";
import { animator, entityOf } from "../src/index.ts";
import type { Animator, AnimatorSave, BodyMode, EntitySpec, Kind } from "../src/index.ts";

interface Body { pos: Vec3; vel: Vec3; facing: number; mode: BodyMode; wall?: Vec3; wallGap?: number }

/** One scripted step of a body going through every mode (the frame index says which). */
function advance(body: Body, spec: EntitySpec, i: number, dt: number): { hold?: string | null } {
  const reach = spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH;
  const t = i * dt;
  const phase = Math.floor(t / 0.6) % 8;
  const v = [0, 2, 9, 9, 5, 0, 7, 1][phase]! * reach;
  const mode: BodyMode = (["ground", "ground", "ground", "air", "ground", "ground", spec.plan === "quadruped" ? "skim" : "wall", "ground"] as const)[phase]!;
  body.facing += (phase === 5 ? 3 : phase === 7 ? -1 : 0) * dt;
  const f = frontOf(body.facing);
  const vy = mode === "air" ? (t % 0.6 < 0.3 ? 3 : -3) : 0;
  body.vel = [f[0] * v, vy, f[2] * v];
  body.pos = [body.pos[0] + body.vel[0] * dt, Math.max(0, body.pos[1] + vy * dt), body.pos[2] + body.vel[2] * dt];
  body.mode = mode;
  if (mode === "wall") { body.wall = [Math.cos(body.facing), 0, -Math.sin(body.facing)]; body.wallGap = 0.2; }
  else { delete body.wall; delete body.wallGap; }
  // (Sit down for a while in the middle of a stand.)
  const k = Math.floor(t / 0.6);
  return phase === 5 && t % 0.6 < dt ? { hold: spec.plan === "quadruped" ? "lie" : "sit" } : k % 8 === 6 && t % 0.6 < dt ? { hold: null } : {};
}

const frameOf = (anim: Animator) => ({ state: anim.state, pose: anim.pose, skel: anim.skeleton(), caps: anim.capsules() });

function step(anim: Animator, body: Body, h: { hold?: string | null }): void {
  if (h.hold) anim.hold(h.hold, { seat: 0 });
  else if (h.hold === null) anim.release();
  anim.step(1 / 60, { ...body, pos: [...body.pos], vel: [...body.vel] });
}

test("save, JSON, load: the restored animator carries on bit-identically", () => {
  let frames = 0;
  for (const kind of ["humanoid", "anthro", "animal"] as Kind[]) {
    for (let s = 0; s < 6; s += 1) {
      const spec = entityOf(String(70 + s), { kind });
      for (const at of [1, 37, 95, 170, 222, 300]) {
        const a = animator(spec, s % 2 ? { fade: 0.25 } : {});
        const body: Body = { pos: [0, 0, 0], vel: [0, 0, 0], facing: s, mode: "ground" };
        let i = 0;
        for (; i < at; i += 1) step(a, body, advance(body, spec, i, 1 / 60));
        const saved = a.save();
        const wire = JSON.parse(JSON.stringify(saved)) as AnimatorSave;
        assert.deepEqual(wire, saved, "a save is plain data: JSON keeps all of it");
        const b = animator(spec, s % 2 ? { fade: 0.25 } : {}).load(wire);
        assert.deepEqual(b.save(), saved, "saving what was loaded gives the same save");
        assert.deepEqual(frameOf(b), frameOf(a), `${kind} seed ${spec.seed}: restored at frame ${at}, before a step`);
        const bodyB: Body = structuredClone(body);
        for (let n = 0; n < 150; n += 1, i += 1) {
          const h = advance(body, spec, i, 1 / 60);
          advance(bodyB, spec, i, 1 / 60);
          step(a, body, h);
          step(b, bodyB, h);
          assert.deepEqual(frameOf(b), frameOf(a), `${kind} seed ${spec.seed}: restored at frame ${at}, ${n + 1} steps on (${a.state.clip})`);
          frames += 1;
        }
      }
    }
  }
  assert.ok(frames > 16000);
});

test("a save names its entity; load refuses another body plan or anything else", () => {
  const cat = entityOf("3", { kind: "animal", species: "cat" });
  const anim = animator(cat);
  anim.hold("sit").step(1 / 60, { pos: [0, 0, 0], facing: 0 });
  const saved = anim.save();
  assert.equal(saved.schema, "keel-entity-animator@1");
  assert.deepEqual(saved.entity, { seed: "3", kind: "animal", species: "cat", plan: "quadruped" });
  assert.equal(saved.state.held?.clip, "sit");
  assert.throws(() => animator(entityOf("3", { kind: "anthro" })).load(saved), /can't drive a humanoid/);
  assert.throws(() => animator(cat).load({} as AnimatorSave), /Not a saved animator/);
  const bad = { ...saved, state: { ...saved.state, layers: [{ name: "moonwalk", w: 1 }] } };
  assert.throws(() => animator(cat).load(bad), RangeError);
  // (Another cat of the same plan may take it: the pose is the pose, on its own bones.)
  const other = animator(entityOf("4", { kind: "animal" })).load(saved);
  assert.equal(other.state.clip, "sit");
});
