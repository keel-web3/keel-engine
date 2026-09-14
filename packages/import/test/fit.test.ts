// Primitive fitting: a box is a box, a rod a capsule, a ramp a wedge, an L
// boxes; a creature's fitted skin rides its rig through the engine's animator;
// the generative base varies by seed and builds as the builder's entity or
// object, and exports as a pack file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, stream } from "@keel-engine/core";
import { animator } from "@keel-engine/entity";
import { buildSession, poseVoxels, runOps } from "@keel-engine/builder";
import { SAMPLES, fitCells, importModel, insidePrim } from "../src/index.ts";
import type { ImportResult, Prim } from "../src/index.ts";

const load = (name: string): ImportResult => { const s = SAMPLES().find((x) => x.name === name)!; return importModel(s.bytes ?? s.text!, { name, ...(s.mtl ? { mtl: s.mtl } : {}), ...(s.options as object) }); };
const cellsIn = (q: Prim, lo: number, hi: number): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = [];
  for (let z = lo; z < hi; z += 1) for (let y = lo; y < hi; y += 1) for (let x = lo; x < hi; x += 1) if (insidePrim([x + 0.5, y + 0.5, z + 0.5], q)) out.push([x, y, z]);
  return out;
};

test("each shape fits as itself: a box, a capsule, a wedge (turned), an L as boxes", () => {
  const box: Array<[number, number, number]> = [];
  for (let z = 0; z < 4; z += 1) for (let y = 0; y < 6; y += 1) for (let x = 0; x < 9; x += 1) box.push([x, y, z]);
  const fb = fitCells(box, () => "primary");
  assert.equal(fb.chosen, "box");
  assert.equal(fb.iou, 1);
  const rod = cellsIn({ shape: "capsule", a: [4, 3, 4], b: [16, 14, 5], r: 2.2, role: "primary" }, -2, 24);
  const fc = fitCells(rod, () => "primary");
  assert.equal(fc.chosen, "capsule");
  assert.ok(fc.iou > 0.8, `rod: ${fc.iou}`);
  const ramp = cellsIn({ shape: "wedge", c: [8, 5, 8], h: [5, 4, 6], yaw: Math.PI / 2, lo: 0, role: "primary" }, -2, 20);
  const fw = fitCells(ramp, () => "primary");
  assert.equal(fw.chosen, "wedge");
  assert.ok(fw.iou > 0.85, `ramp: ${fw.iou} (${JSON.stringify(fw.candidates)})`);
  const L: Array<[number, number, number]> = [];
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 3; x += 1) L.push([x, y, 0], [x, y, 1]);
  for (let y = 0; y < 3; y += 1) for (let x = 3; x < 10; x += 1) L.push([x, y, 0], [x, y, 1]);
  const fl = fitCells(L, (x) => (x < 3 ? "primary" : "trim"));
  assert.equal(fl.chosen, "boxes");
  assert.equal(fl.iou, 1);
  assert.deepEqual(fl.prims.map((p) => p.role).sort(), ["primary", "trim"], "each box takes the role its cells play");
});

test("a creature's fitted skin walks on the engine's animator: capsules along the limbs, feet on the ground", () => {
  for (const name of ["knight", "dog"]) {
    const r = load(name);
    const spec = r.fitted.spec!;
    const skin = spec.voxel.skin;
    assert.ok(skin.capsules.length >= 4, `${name}: limbs as capsules (${skin.capsules.length})`);
    assert.ok(skin.boxes.length + skin.capsules.length < 120, `${name}: a few dozen primitives, not voxels (${skin.boxes.length} boxes, ${skin.capsules.length} capsules)`);
    const anim = animator(spec);
    let lowest = Infinity;
    for (let f = 0; f < 120; f += 1) {
      anim.step(1 / 60, { pos: [0, 0, f / 60], vel: [0, 0, 1], facing: 0, mode: "ground" });
      const s = poseVoxels(spec, anim.skeleton({ pos: [0, 0, 0], yaw: 0 }), { table: {} });
      for (const c of s.capsules) { assert.ok([...c.a, ...c.b].every(Number.isFinite)); lowest = Math.min(lowest, c.a[1] - c.r, c.b[1] - c.r); }
      for (const b of s.boxes) lowest = Math.min(lowest, b.c[1] - b.h[1]);
    }
    assert.ok(Math.abs(lowest) < 0.12, `${name}: the feet reach the ground (${lowest.toFixed(3)} m)`);
    assert.ok(r.fitted.iou > 0.7, `${name}: the fit covers the model (${r.fitted.iou})`);
  }
});

test("the generative base: variants by seed, the builder's entity and object, a pack file from its op list", () => {
  const r = load("dog");
  const e = r.generative.entity!;
  assert.equal(e.body, "body/quadruped@1.0.0");
  assert.ok(e.choices && "legs" in e.choices && "head" in e.choices && "size" in e.choices, JSON.stringify(e.choices));
  const S = (seed: string) => stream(createRoll(seed), 0);
  const heights = ["0x01", "0x02", "0x03", "0x04", "0x05", "0x06"].map((seed) => { const spec = e.build(S(seed), {}); return spec.plan === "quadruped" ? +spec.body.shoulderH.toFixed(4) : 0; });
  assert.ok(new Set(heights).size >= 3, `legs vary by seed: ${heights}`);
  assert.deepEqual(e.build(S("0x01"), {}).body, e.build(S("0x01"), {}).body, "the same seed, the same dog");
  // Its op list builds the same thing through the builder, and exports it as one pack file.
  const built = buildSession(runOps(r.generative.ops).session);
  assert.equal(built.kind, "entity");
  assert.match(built.code, /defineEntity\(/);
  assert.match(built.code, /variation:/);
  // A prop's fitted primitives as an object.
  const chest = load("chest");
  const obj = chest.generative.object!;
  assert.ok(obj.parts.length > 0 && obj.parts.length <= 40, `${obj.parts.length} primitives`);
  assert.ok(chest.fitted.iou > 0.8, `the chest's primitives cover it (${chest.fitted.iou})`);
});
