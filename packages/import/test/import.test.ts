// The import end to end on the samples: the knight's five worn things in the
// right sockets (named and not, skinned and not), the dog's collar on its
// neck, the chest's base, lid and lock (and its front from the lock), the
// crate's frame and panels, the statue's plinth and figure (cut where its
// section narrows, the figure split by region), the robot's antenna. Skeleton
// names in every dialect. Determinism.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLES, importModel, knightBuild, mapSkeleton, readName, writeGlb } from "../src/index.ts";
import type { ImportResult, Sample } from "../src/index.ts";

const cache = new Map<string, ImportResult>();
const run = (s: Sample): ImportResult => {
  const had = cache.get(s.name);
  if (had) return had;
  const r = importModel(s.bytes ?? s.text!, { name: s.name, ...(s.mtl ? { mtl: s.mtl } : {}), ...(s.options as object) });
  cache.set(s.name, r);
  return r;
};
const sample = (name: string): Sample => SAMPLES().find((s) => s.name === name)!;
const worn = (r: ImportResult): Record<string, string> => Object.fromEntries(r.attributes.map((a) => [a.part, a.slot]));

test("every sample reads as what it is: creature or prop, its body, its worn things and their sockets", () => {
  const report: string[] = [];
  for (const s of SAMPLES()) {
    const r = run(s);
    const p = r.proposal;
    report.push(`${s.name}: ${p.kind}${p.creature ? ` ${p.creature.plan} (${p.creature.source})` : ""}; parts ${p.parts.map((x) => x.id + (x.socket ? `@${x.socket}` : "")).join(" ")}`);
    assert.equal(p.kind, s.truth.kind, `${s.name} is a ${s.truth.kind}`);
    if (s.truth.plan) assert.equal(p.creature?.plan, s.truth.plan);
    if (s.truth.attributes) assert.deepEqual(worn(r), s.truth.attributes, `${s.name}'s worn things`);
    if (s.truth.parts) for (const want of s.truth.parts) assert.ok(p.parts.some((x) => x.id === want || x.id.startsWith(`${want}.`)), `${s.name} has a ${want} (${p.parts.map((x) => x.id).join(", ")})`);
    // Every part is a group; every cell belongs to exactly one.
    let grouped = 0;
    r.model.forEach((x, y, z) => { if (r.model.groupAt(x, y, z)) grouped += 1; });
    assert.equal(grouped, r.model.count, `${s.name}: every voxel is in a part`);
    assert.equal(r.model.groups.size, p.parts.length);
  }
  console.log(`\n${report.join("\n")}`);
});

test("the knight: five worn things -- from names and skin, and from geometry alone (no names, no skin)", () => {
  const truth = { helmet: "head", shield: "hand.L", cape: "back", sword: "hand.R", belt: "waist" };
  const r = run(sample("knight"));
  assert.deepEqual(worn(r), truth);
  assert.equal(r.proposal.creature!.source, "skin");
  // Body regions from the skin weights: two arms, two legs, a head and a torso.
  assert.deepEqual(r.proposal.parts.filter((p) => p.kind === "body").map((p) => p.id).sort(), ["arm.L", "arm.R", "head", "leg.L", "leg.R", "torso"]);
  // The source skeleton mapped onto the contract.
  assert.equal(r.proposal.creature!.bones["upperArm.L"], "LeftUpperArm");
  assert.equal(r.proposal.creature!.bones["shin.R"], "RightLowerLeg");
  // Unnamed meshes and no skin: the same five sockets, found by how the parts sit on the body.
  const bare = importModel(writeGlb(knightBuild({ names: false, skin: false })), { name: "bare", voxels: 64 });
  assert.equal(bare.proposal.creature!.source, "shape");
  assert.deepEqual(Object.values(worn(bare)).sort(), Object.values(truth).sort());
  assert.deepEqual(Object.keys(worn(bare)).sort(), ["backpiece", "beltwear", "headwear", "held-left", "held-right"]);
  // Confidences: each worn part sure of itself and of its socket.
  for (const a of r.attributes) assert.ok(a.confidence >= 0.7 && a.socketConfidence >= 0.55, `${a.part}: ${a.confidence} / ${a.socketConfidence}`);
  for (const a of bare.attributes) assert.ok(a.confidence >= 0.5 && a.socketConfidence >= 0.5, `${a.part}: ${a.confidence} / ${a.socketConfidence}`);
});

test("the dog: a quadruped by its shape, the collar on its neck, its nose and belly marks folded into the body", () => {
  const r = run(sample("dog"));
  assert.equal(r.proposal.creature!.source, "shape");
  assert.deepEqual(worn(r), { collar: "neck" });
  assert.deepEqual(r.proposal.parts.filter((p) => p.kind === "body").map((p) => p.id).sort(), ["head", "leg.FL", "leg.FR", "leg.HL", "leg.HR", "tail", "torso"]);
  assert.ok(r.proposal.parts.find((p) => p.id === "head")!.why.join(" ").includes("marks folded in"), "the nose and snout marks stayed body");
  assert.deepEqual([...r.rig!.missing], []);
});

test("props: the chest's base, lid and lock (its front from the lock, a hinge on the lid), the crate, the statue on its plinth", () => {
  const chest = run(sample("chest"));
  assert.deepEqual(chest.proposal.parts.map((p) => p.id).sort(), ["base", "lid", "lock"]);
  assert.equal(chest.object!.front, 0, "the lock is on +z: the front");
  assert.match(chest.proposal.object!.frontFrom, /lock/);
  assert.ok(chest.ops.some((o) => o.op === "animate" && o["group"] === "lid" && o["motion"] === "hinge"));
  assert.ok(chest.object!.sockets["top"], "a top to put things on");
  const crate = run(sample("crate"));
  assert.deepEqual(crate.proposal.parts.map((p) => p.id).sort(), ["frame", "panels"]);
  assert.match(crate.proposal.object!.why.join(" "), /outline/, "four posts on a frame are not four legs");
  const statue = run(sample("statue"));
  const ids = statue.proposal.parts.map((p) => p.id);
  assert.ok(ids.includes("plinth"));
  assert.deepEqual(ids.filter((i) => i.startsWith("figure.")).sort(), ["figure.arm.L", "figure.arm.R", "figure.head", "figure.leg.L", "figure.leg.R", "figure.torso"]);
  assert.match(statue.proposal.parts.find((p) => p.id === "plinth")!.cues.join(" "), /narrows/);
  assert.equal(statue.proposal.object!.figures[0]!.plan, "humanoid");
});

test("skeleton names in every dialect map onto the contract", () => {
  const dialects: Array<[string, string[]]> = [
    ["mixamo", ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:Neck", "mixamorig:Head", "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand", "mixamorig:RightShoulder", "mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand", "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot", "mixamorig:RightUpLeg", "mixamorig:RightLeg", "mixamorig:RightFoot"]],
    ["blender", ["pelvis", "spine", "spine.001", "chest", "neck", "head", "shoulder.L", "upper_arm.L", "forearm.L", "hand.L", "shoulder.R", "upper_arm.R", "forearm.R", "hand.R", "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"]],
    ["unreal", ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"]],
  ];
  const chain = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 8, 3, 10, 11, 12, 0, 14, 15, 0, 17, 18];
  for (const [name, names] of dialects) {
    const m = mapSkeleton(names, chain);
    assert.equal(m.plan, "humanoid", name);
    assert.equal(m.confidence, 1, `${name}: ${JSON.stringify(m.bones)}`);
    assert.equal(names[m.bones["forearm.R"]!], names[12], `${name}: the right forearm`);
    assert.equal(names[m.bones["shin.L"]!], names[15], `${name}: the left shin`);
    assert.equal(names[m.bones["chest"]!], names[3], `${name}: the chest is the top of the spine`);
  }
  // Four legs, named front and hind.
  const quad = ["root", "spine", "chest", "neck", "head", "front_leg_upper_L", "front_leg_lower_L", "front_paw_L", "front_leg_upper_R", "front_leg_lower_R", "front_paw_R", "back_leg_upper_L", "back_leg_lower_L", "back_paw_L", "back_leg_upper_R", "back_leg_lower_R", "back_paw_R", "tail_1", "tail_2"];
  const qm = mapSkeleton(quad, [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15, 0, 17]);
  assert.equal(qm.plan, "quadruped");
  assert.equal(quad[qm.bones["paw.HR"]!], "back_paw_R");
  assert.equal(quad[qm.bones["tail1"]!], "tail_2");
  assert.deepEqual(readName("RightUpperArm"), { words: ["upper", "arm"], side: "R", end: null }, "'Right' isn't a 'rig' prefix");
});

test("deterministic: the same file imports to the same proposal, op list and model", () => {
  const s = sample("dog");
  const a = importModel(s.bytes!, { name: "dog", ...(s.options as object) });
  const b = importModel(s.bytes!, { name: "dog", ...(s.options as object) });
  assert.equal(JSON.stringify(a.proposal), JSON.stringify(b.proposal));
  assert.equal(JSON.stringify(a.ops), JSON.stringify(b.ops));
  assert.deepEqual([...a.model.dense().data], [...b.model.dense().data]);
});
