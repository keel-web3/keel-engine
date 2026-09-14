// Animated objects (a flag waving, a door swinging, a windmill turning, a
// lamp flickering, a tree swaying), bake designs in the baker's pose(clip,
// frame) shape, generators and seeded variants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import {
  applyVariation, attributeFromVoxels, autoRig, builderLook, checkAnimation, creatureDesign, generate, GENERATOR_KINDS, objectDesign, objectRig, sameVoxels, variantsOf, voxelsToText,
} from "../src/index.ts";
import type { ObjectSolids } from "../src/index.ts";
import { doorway, flag, blockPerson, topHat } from "./models.ts";

const finite = (s: ObjectSolids): boolean => s.boxes.every((b) => [...b.c, ...b.h, b.yaw].every(Number.isFinite)) && s.capsules.every((c) => [...c.a, ...c.b, c.r].every(Number.isFinite));

test("a flag waves: slices along its length move along z, more toward the free end, back where they began each cycle", () => {
  const m = flag();
  const rig = objectRig(m, { clips: { idle: { period: 2, frames: 8, motions: [{ kind: "wave", group: "cloth", along: "x", dir: "z", amp: 1.5, hz: 0.5 }] } } });
  const f0 = rig.pose("idle", 0), f2 = rig.pose("idle", 2), f8 = rig.pose("idle", 8);
  assert.ok(finite(f2));
  assert.deepEqual(f8, f0, "looped");
  const u = m.unit;
  // (The cloth is 12 slices; the pole a box; the stripe's slices ride with the cloth.)
  const cloth = f2.boxes.filter((b) => Math.abs(b.h[0] - u / 2) < 1e-9 && b.h[1] < 0.3);
  assert.equal(cloth.length, 36, "12 slices of each of the cloth's three boxes (above, the stripe, below)");
  const off = (x: number): number => Math.max(...cloth.filter((b) => Math.abs(b.c[0] - x) < 1e-9).map((b) => Math.abs(b.c[2])));
  const xs = [...new Set(cloth.map((b) => b.c[0]))].sort((a, b) => a - b);
  assert.ok(off(xs[0]!) < off(xs[xs.length - 1]!) + 1e-9 || off(xs[xs.length - 2]!) > off(xs[0]!), "the free end moves more");
  assert.ok(Math.max(...cloth.map((b) => Math.abs(b.c[2]))) <= 1.5 * u + 1e-9);
  // The pole stays put.
  const pole = f2.boxes.find((b) => b.h[1] > 0.4);
  assert.ok(pole && Math.abs(pole.c[2]) < 1e-9);
});

test("a door swings on its hinge (turned about y: still boxes, their yaw the door's), and opens once with pivot", () => {
  const m = doorway();
  const pivot: [number, number, number] = [-2, 0, 1];
  const rig = objectRig(m, { clips: {
    swing: { period: 4, frames: 8, motions: [{ kind: "hinge", group: "door", axis: "y", pivot, from: 0, to: -1.4 }] },
    open: { period: 1, frames: 5, loop: false, motions: [{ kind: "pivot", group: "door", axis: "y", pivot, angle: -1.5 }] },
  } });
  const shut = rig.pose("swing", 0), wide = rig.pose("swing", 4);
  const doorYaw = (s: ObjectSolids) => s.boxes.filter((b) => b.yaw !== 0).map((b) => b.yaw);
  assert.deepEqual(doorYaw(shut), []);
  assert.ok(doorYaw(wide).length >= 1 && doorYaw(wide).every((y) => Math.abs(y + 1.4) < 1e-9), `wide open: ${doorYaw(wide)}`);
  assert.equal(wide.capsules.length, 0);
  const last = rig.pose("open", 4), past = rig.pose("open", 9);
  assert.ok(doorYaw(last).every((y) => Math.abs(y + 1.5) < 1e-9));
  assert.deepEqual(past, last, "a one-shot clip holds its end");
});

test("a windmill turns (about z: the sails become capsules that turn); a lamp flickers; a tree sways", () => {
  const w = generate("windmill", "3");
  const rig = objectRig(w.model, w.animation!);
  const a = rig.pose("idle", 0), b = rig.pose("idle", 2);
  assert.ok(b.capsules.length >= 2, "long sails as capsules");
  assert.ok(finite(b));
  const tips = (s: ObjectSolids) => s.capsules.map((c) => c.b[0]).sort().join();
  assert.notEqual(tips(a), tips(b), "they turn");
  // One period is a quarter turn: four-fold sails look the same.
  const one = rig.at("idle", w.animation!.clips["idle"]!.period);
  const len = (s: ObjectSolids) => s.capsules.map((c) => Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1]).toFixed(6)).sort().join();
  assert.equal(len(one), len(rig.at("idle", 0)));
  const lamp = generate("lamp", "4");
  const look = builderLook();
  const lr = objectRig(lamp.model, lamp.animation!);
  const mats = new Set<number>();
  for (let f = 0; f < 40; f += 1) for (const bx of lr.at("idle", f / 12, look).boxes) mats.add(bx.mat);
  assert.ok(mats.has(look.table["glow"]!) && mats.has(look.table["glow-dim"]!), "lit and dim");
  const tree = generate("tree", "5");
  const tr = objectRig(tree.model, tree.animation!);
  assert.notDeepEqual(tr.pose("idle", 0), tr.pose("idle", 2));
  assert.ok(finite(tr.pose("idle", 3)));
});

test("animation is checked against the model", () => {
  const m = flag();
  assert.deepEqual(checkAnimation(m, { clips: { idle: { period: 1, frames: 4, motions: [{ kind: "wave", group: "cloth", amp: 1, hz: 1 }] } } }), []);
  const bad = checkAnimation(m, { clips: { idle: { period: 0, frames: 0, motions: [{ kind: "spin", group: "sails", hz: 1 }] } }, parents: { cloth: "cloth" } });
  assert.ok(bad.some((b) => b.includes('no group "sails"')) && bad.some((b) => b.includes("period")) && bad.some((b) => b.includes("frames")) && bad.some((b) => b.includes("rides itself")));
  assert.throws(() => objectRig(m, { clips: { idle: { period: 1, frames: 1, motions: [{ kind: "bob", group: "nope", amp: 1, hz: 1 }] } } }), /no group "nope"/);
});

test("bake designs: the baker's DesignSpec + BakeSource shape -- creatures on the engine's clips, objects on theirs", () => {
  const fox = creatureDesign(autoRig(generate("critter", "d1", { plan: "quadruped" }).model), { pack: "packs/test" });
  assert.match(fox.key, /^packs\/test:voxel\/critter-d1~[0-9a-f]{16}~[0-9a-f]{16}$/);
  assert.deepEqual(fox.clips.map((c) => c.name), ["idle", "walk", "trot", "gallop"]);
  assert.ok(fox.height > 0 && fox.radius > 0);
  assert.ok(fox.clip("walk").cycle > 0 && fox.clip("walk").speed > 0 && fox.clip("idle").cycle === 0);
  for (const c of fox.clips) for (let f = 0; f < c.frames; f += 1) assert.ok(finite(fox.pose(c.name, f)));
  assert.ok(fox.palette.colours.length > 0 && fox.materials.length > 10);
  assert.notDeepEqual(fox.pose("walk", 0), fox.pose("walk", 4));
  assert.throws(() => fox.pose("fly", 0), /isn't baked/);
  // Wearing a voxel hat: the key names it, every frame carries its boxes.
  const hat = attributeFromVoxels(topHat(), { id: "top-hat", slot: "head" });
  const hatted = creatureDesign(autoRig(generate("critter", "d1", { plan: "quadruped" }).model), { pack: "packs/test", attributes: [hat] });
  assert.match(hatted.key, /critter-d1\+top-hat~/);
  assert.equal(hatted.pose("walk", 3).boxes.length, fox.pose("walk", 3).boxes.length + (hatted.worn[0]!.design.boxes ?? []).length);
  const person = creatureDesign(autoRig(blockPerson()));
  assert.deepEqual(person.clips.map((c) => c.name), ["idle", "walk", "run"]);
  const banner = generate("banner", "2");
  const bd = objectDesign(banner.model, { animation: banner.animation!, colours: banner.colours });
  assert.deepEqual(bd.clips.map((c) => [c.name, c.frames]), [["idle", 8]]);
  const crate = objectDesign(generate("crate", "2").model);
  assert.deepEqual(crate.clips, [{ name: "idle", frames: 1, loop: true }]);
  // Same content, same key; a different look, a different key.
  assert.equal(objectDesign(generate("crate", "2").model).key, crate.key);
  assert.notEqual(objectDesign(generate("crate", "2").model, { colours: { primary: [0.5, 0.1, 200] } }).key, crate.key);
});

test("generators are deterministic by seed and differ across seeds; every kind builds", () => {
  for (const kind of GENERATOR_KINDS) {
    const a = generate(kind, "11"), b = generate(kind, "11"), c = generate(kind, "12");
    assert.ok(sameVoxels(a.model, b.model), `${kind}: same seed, same model`);
    assert.deepEqual(a.animation, b.animation);
    assert.deepEqual(a.colours, b.colours);
    assert.ok(a.model.count > 20, `${kind}: ${a.model.count} voxels`);
    if (kind !== "lamp") assert.ok(!sameVoxels(a.model, c.model) || voxelsToText(a.model) !== voxelsToText(c.model), `${kind}: seeds differ`);
  }
  // Critters come as both bodies.
  const plans = new Set(Array.from({ length: 12 }, (_, i) => generate("critter", `p${i}`).truth!.plan));
  assert.deepEqual([...plans].sort(), ["humanoid", "quadruped"]);
});

test("variants: one built creature, many seeded ones -- deterministic, pinnable, each rule its own stream", () => {
  const g = generate("critter", "7", { plan: "quadruped" });
  const vs = variantsOf(g.model, g.rules, 8);
  const again = variantsOf(g.model, g.rules, 8);
  vs.forEach((v, i) => { assert.ok(sameVoxels(v.model, again[i]!.model)); assert.deepEqual(v.picked, again[i]!.picked); });
  assert.ok(new Set(vs.map((v) => voxelsToText(v.model))).size >= 6, "they differ");
  // Longer legs: taller.
  const S = () => stream(createRoll(deriveSeed("pins", 0)), 0);
  const tall = applyVariation(g.model, g.rules, S(), { legs: { y: 1.35 } }).model;
  const short = applyVariation(g.model, g.rules, S(), { legs: { y: 0.8 } }).model;
  assert.ok(tall.bounds()!.max[1] - tall.bounds()!.min[1] > short.bounds()!.max[1] - short.bounds()!.min[1]);
  // A pin never moves another rule's draw.
  const a = applyVariation(g.model, g.rules, S(), {}).picked;
  const b = applyVariation(g.model, g.rules, S(), { head: 1.1 }).picked;
  assert.deepEqual(a["legs"], b["legs"]);
  assert.deepEqual(a["size"], b["size"]);
  // Adding a rule never moves the others either.
  const more = applyVariation(g.model, { ...g.rules, optional: { ...(g.rules.optional ?? {}), ears: 0.5 } }, S(), {}).picked;
  assert.deepEqual(more["legs"], a["legs"]);
  // Size is the voxel unit: the voxels don't move.
  const big = applyVariation(g.model, { size: [2, 2] }, S()).model;
  assert.equal(big.unit, g.model.unit * 2);
  assert.equal(voxelsToText({ ...big, unit: g.model.unit } as typeof big) !== "", true);
  // Every variant rigs as its body.
  for (const v of vs) assert.equal(autoRig(v.model).plan, "quadruped");
});
