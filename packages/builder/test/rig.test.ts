// Auto-rigging: the body read from the shape, joints where the voxels put
// them, every voxel bound to a bone, the engine's clips and animator driving
// it, the contract's sockets, and the manual overrides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import { HUMANOID_BODY, QUADRUPED_BODY, animator, missingSockets, posed, restJoints } from "@keel-engine/entity";
import { analyseShape, applyVariation, autoRig, builderLook, generate, jointError, markSocket, moveJoint, poseVoxels, reassign } from "../src/index.ts";
import type { PosedSolids, VoxelRig } from "../src/index.ts";
import { dog, knight, blockPerson } from "./models.ts";

const finite = (s: PosedSolids): boolean => s.boxes.every((b) => [...b.c, ...b.h, b.yaw].every(Number.isFinite)) && s.capsules.every((c) => [...c.a, ...c.b, c.r].every(Number.isFinite));
const lowest = (s: PosedSolids): number => Math.min(...s.boxes.map((b) => b.c[1] - b.h[1]), ...s.capsules.map((c) => Math.min(c.a[1], c.b[1]) - c.r));

test("the body is read from the shape: 60 generated critters of each plan, every one right, joints within a voxel", () => {
  const rows: string[] = [];
  for (const plan of ["quadruped", "humanoid"] as const) {
    let right = 0;
    const errs: number[] = [];
    let worst = { e: 0, seed: "", joint: "" };
    for (let i = 0; i < 60; i += 1) {
      const g = generate("critter", `acc-${i}`, { plan });
      const a = analyseShape(g.model);
      if (a.plan === plan) right += 1;
      const r = autoRig(g.model);
      const e = jointError(r, g.truth!.joints);
      errs.push(e.mean);
      if (e.max > worst.e) worst = { e: e.max, seed: `acc-${i}`, joint: e.worst };
      assert.deepEqual(r.missing, [], `${plan} acc-${i}: keeps its contract`);
    }
    const mean = errs.reduce((x, y) => x + y, 0) / errs.length;
    rows.push(`${plan.padEnd(10)} ${right}/60 picked right; joint error mean ${mean.toFixed(2)} voxels, worst ${worst.e.toFixed(2)} (${worst.joint}, ${worst.seed})`);
    assert.equal(right, 60, `${plan}: every one picked right`);
    assert.ok(mean < 0.5, `${plan}: mean joint error ${mean}`);
    assert.ok(worst.e <= 2.5, `${plan}: worst joint error ${worst.e} at ${worst.joint} (${worst.seed})`);
  }
  console.log(`\n${rows.join("\n")}`);
});

test("variants keep their body: legs longer and shorter, heads bigger, tails gone -- still read right", () => {
  let right = 0, total = 0;
  for (const plan of ["quadruped", "humanoid"] as const) for (let i = 0; i < 12; i += 1) {
    const g = generate("critter", `var-${i}`, { plan });
    for (let k = 0; k < 4; k += 1) {
      const v = applyVariation(g.model, g.rules, stream(createRoll(deriveSeed(`v${i}`, k)), 0));
      total += 1;
      if (analyseShape(v.model).plan === plan) right += 1;
    }
  }
  console.log(`\nvariants: ${right}/${total} read as the body they were built as`);
  assert.ok(right / total >= 0.95, `${right}/${total}`);
});

test("hand-built: a block-builder person (legs touching), a dog with a neck and tail, a knight with arms held out", () => {
  const s = autoRig(blockPerson());
  assert.equal(s.plan, "humanoid");
  const e = jointError(s, { hips: [0, 12, 0], "thigh.L": [-2, 12, 0], "thigh.R": [2, 12, 0], "upperArm.L": [-6, 22, 0], "upperArm.R": [6, 22, 0], neck: [0, 24, 0], head: [0, 24, 0] });
  assert.ok(e.max <= 1, `blockPerson: ${JSON.stringify(e.each)}`);
  assert.ok(s.analysis.regions["arm.L"]! > 150 && s.analysis.regions["arm.R"]! > 150, "both arms found");
  // The head socket is on the crown.
  const u = s.model.unit;
  assert.ok(Math.abs(s.sockets["head"]!.pos[1] / u - 32) < 0.5);
  const d = autoRig(dog());
  assert.equal(d.plan, "quadruped");
  assert.ok(d.analysis.regions["q.tail"]! >= 8 && d.analysis.regions["q.neck"]! > 0 && d.analysis.regions["q.head"]! > 0);
  assert.ok(d.sockets["tail"], "a tail socket where it has a tail");
  // (The dog's crown: its head's top is y 17 (ears above it on 17-18).)
  const crown = d.sockets["head"]!.pos[1] / d.model.unit + d.analysis.origin[1];
  assert.ok(Math.abs(crown - 17) <= 2, `dog crown ${crown}`);
  const k = autoRig(knight());
  assert.equal(k.plan, "humanoid");
  assert.ok(k.analysis.why.some((w) => w.includes("held out")));
  const arm = restJoints(k.spec.rig);
  assert.ok(arm["hand.L"]![0] < arm["upperArm.L"]![0] - 0.3, "the left hand is out to the left");
});

test("every voxel is bound to one bone of its region; skin boxes and capsules account for all of them", () => {
  for (const r of [autoRig(blockPerson()), autoRig(dog()), autoRig(generate("critter", "b1", { plan: "quadruped" }).model)]) {
    assert.equal(r.binding.size, r.model.count);
    const total = Object.values(r.skin.cells).reduce((a, b) => a + b, 0);
    assert.equal(total, r.model.count);
    const legBones = r.plan === "humanoid" ? ["thigh.L", "shin.L", "foot.L"] : ["upper.FL", "lower.FL", "paw.FL"];
    const lowLeft = [...r.binding].filter(([k]) => { const [x, y] = k.split(",").map(Number); return y === 0 && x! < r.analysis.origin[0] - 0.5; });
    assert.ok(lowLeft.length > 0 && lowLeft.every(([, b]) => legBones.includes(b) || b.endsWith(".HL")), `${r.model.name}: the ground on the left is the left leg's`);
  }
});

function drive(r: VoxelRig, speed: number, frames = 240): { min: number; max: number } {
  const anim = animator(r.spec);
  const look = builderLook();
  let min = Infinity, max = -Infinity;
  for (let f = 0; f < frames; f += 1) {
    const t = f / 60;
    const v = f < 60 ? 0 : speed;
    anim.step(1 / 60, { pos: [0, 0, v * t], vel: [0, 0, v], facing: 0, mode: "ground" });
    const s = poseVoxels(r, anim.skeleton(), look);
    assert.ok(finite(s), `${r.model.name}: frame ${f} is finite`);
    min = Math.min(min, lowest(s));
    max = Math.max(max, ...s.boxes.map((b) => b.c[1] + b.h[1]));
  }
  return { min, max };
}

test("the engine's animator drives them: idle, walk, run (trot, gallop) with no NaN and the feet near the ground", () => {
  for (const [r, speeds] of [[autoRig(blockPerson()), [1.5, 5]], [autoRig(dog()), [1, 3, 6]], [autoRig(generate("critter", "anim", { plan: "quadruped" }).model), [1, 4]], [autoRig(generate("critter", "anim", { plan: "humanoid" }).model), [1.2, 4]]] as const) {
    for (const v of speeds) {
      const { min, max } = drive(r, v);
      const u = r.model.unit;
      assert.ok(min > -3 * u && min < 3 * u, `${r.model.name} at ${v}: lowest ${min.toFixed(3)} (voxel ${u})`);
      assert.ok(max < (r.model.bounds()!.max[1] + 4) * u, `${r.model.name}: stays its size`);
    }
  }
});

test("every clip of the contract poses the voxel skin (and moves it)", () => {
  for (const r of [autoRig(blockPerson()), autoRig(dog())]) {
    const clips = r.plan === "humanoid" ? HUMANOID_BODY.clips : QUADRUPED_BODY.clips;
    const rest = poseVoxels(r, posed(r.spec, "idle", { t: 0 }));
    for (const clip of clips) for (const phase of [0, 0.25, 0.5, 0.75]) {
      const s = poseVoxels(r, posed(r.spec, clip, { phase, t: phase * 2, params: { speed: 4 } }));
      assert.ok(finite(s), `${r.model.name} ${clip} ${phase}`);
      assert.equal(s.boxes.length + s.capsules.length, rest.boxes.length + rest.capsules.length);
    }
    const a = poseVoxels(r, posed(r.spec, r.plan === "humanoid" ? "walk" : "trot", { phase: 0.1 }));
    const b = poseVoxels(r, posed(r.spec, r.plan === "humanoid" ? "walk" : "trot", { phase: 0.6 }));
    const moved = [...a.capsules.map((c, i) => Math.abs(c.b[2] - b.capsules[i]!.b[2])), ...a.boxes.map((x, i) => Math.abs(x.c[2] - b.boxes[i]!.c[2]))];
    assert.ok(moved.some((d) => d > r.model.unit), `${r.model.name}: its legs swing`);
  }
});

test("overrides: move a joint, reassign a region, mark a socket -- all plain data the export carries", () => {
  const r = autoRig(dog());
  const u = r.model.unit;
  // Move the neck joint up by two voxels.
  const n0 = r.analysis.joints["neck"]!;
  const r2 = moveJoint(r, "neck", [n0[0], n0[1] + 2, n0[2]]);
  const j = restJoints(r2.spec.rig)["neck"]!;
  assert.ok(Math.abs(j[1] / u + r2.analysis.origin[1] - (n0[1] + 2)) < 1e-9);
  assert.deepEqual(r2.edits.joints, { neck: [n0[0], n0[1] + 2, n0[2]] });
  // Give the ears to the neck.
  const r3 = reassign(r2, { from: [-3, 17, 7], to: [2, 18, 7] }, "neck");
  assert.equal(r3.binding.get("2,17,7"), "neck");
  assert.equal(r3.binding.get("-3,18,7"), "neck");
  // Mark a saddle on the spine.
  const r4 = markSocket(r3, "saddle", { bone: "spine", at: [0, 11, 0], size: [6, 2, 6], out: [0, 1, 0] });
  const sad = r4.sockets["saddle"]!;
  assert.equal(sad.bone, "spine");
  assert.ok(Math.abs(sad.pos[1] / u + r4.analysis.origin[1] - 11) < 1e-9);
  assert.deepEqual(missingSockets(QUADRUPED_BODY, r4.sockets), []);
  // The edits are JSON and reproduce the same rig.
  const again = autoRig(r4.model, JSON.parse(JSON.stringify(r4.edits)));
  assert.deepEqual(again.skin, r4.skin);
  assert.throws(() => moveJoint(r, "wing.L", [0, 0, 0]), /no bone "wing.L"/);
  assert.throws(() => reassign(r, { from: [0, 0, 0], to: [1, 1, 1] }, "wing.L"), /no bone "wing.L"/);
  // Forcing the other body works, and says so.
  const forced = autoRig(dog(), { plan: "humanoid" });
  assert.equal(forced.plan, "humanoid");
  assert.ok(forced.analysis.why.some((w) => w.includes("asked for humanoid")));
});
