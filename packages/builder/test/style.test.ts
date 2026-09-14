// The voxel style: loading the builder registers style/voxel@1.0.0; a styled
// object's design becomes a real VoxelModel (its roles, on its grid) and its
// greedy boxes; the same design in pixel and voxel has the same colliders and
// sockets and a footprint within a voxel; a design finer than its unit is
// declined and drawn in pixel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStyleRegistry, defaultStyles, defineStyledObject, pixelStyle, solid } from "@keel-engine/object";
import { VOXEL_BOX_LIMIT, designVoxels, greedyBoxes, voxelStyle, voxelUnitFor } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const house = defineStyledObject({
  id: "house",
  choices: { w: { range: [4, 8] }, roof: ["gable", "flat"] },
  look: { roles: { wall: { as: "primary" }, roof: { as: "secondary" }, door: { as: "accent" } } },
  design: (_J, v) => {
    const w = v["w"] as number;
    return {
      solids: [
        solid.box("wall", [0, 1.5, 0], [w / 2, 1.5, 2]),
        ...(v["roof"] === "gable" ? [solid.wedge("roof", [0, 3.5, 1], [w / 2, 0.5, 1], 0), solid.wedge("roof", [0, 3.5, -1], [w / 2, 0.5, 1], Math.PI)] : [solid.box("roof", [0, 3.1, 0], [w / 2 + 0.1, 0.1, 2.1])]),
        solid.box("door", [0, 1, 2.03], [0.5, 1, 0.04], 0, { name: "door", collide: false }),
      ],
      front: "+z",
      sockets: { door: { kind: "anchor", pos: [0, 0, 2.1], yaw: 0 } },
    };
  },
});

test("the builder provides style/voxel@1.0.0 and registers it when it loads", () => {
  assert.ok(manifest.provides.includes("style/voxel@1.0.0"));
  assert.equal(defaultStyles.get("voxel"), voxelStyle);
});

test("a design as a VoxelModel: its roles, on a grid of its unit, standing on y = 0", () => {
  const b = house.build({ seed: 1, pins: { w: 6, roof: "gable" }, style: "voxel", params: { unit: 0.25 } });
  const { model } = designVoxels(b.design, 0.25);
  assert.deepEqual([...model.roles].sort(), ["door", "roof", "wall"]);
  assert.equal(model.bounds()!.min[1], 0);
  assert.equal(b.stats["unit"], 0.25);
  assert.equal(b.stats["boxes"], b.def.parts.length);
  assert.ok(greedyBoxes(model).length <= model.count);
  for (const p of b.def.parts) {
    const box = p.prim!;
    assert.equal(box.type, "box");
    if (box.type === "box") for (const v of [...box.c, ...box.h]) assert.ok(Math.abs(v / 0.125 - Math.round(v / 0.125)) < 1e-9, `on the grid: ${v}`);
  }
});

test("pixel and voxel: the same colliders and sockets, the footprint within a voxel, the same front", () => {
  for (let s = 0; s < 30; s += 1) {
    const p = house.build({ seed: s, style: "pixel" });
    const v = house.build({ seed: s, style: "voxel" });
    assert.equal(v.style, "voxel");
    assert.deepEqual(v.def.colliders, p.def.colliders);
    assert.deepEqual(v.def.sockets, p.def.sockets);
    assert.equal(v.def.front, p.def.front);
    const u = v.stats["unit"]!;
    for (let i = 0; i < 6; i += 1) assert.ok(Math.abs(v.def.bounds[i]! - p.def.bounds[i]!) <= u + 1e-9, `bound ${i}: ${v.def.bounds[i]} vs ${p.def.bounds[i]} (unit ${u})`);
    assert.ok(v.def.parts.length <= VOXEL_BOX_LIMIT);
    assert.notEqual(v.key, p.key);
    assert.match(v.key, /@voxel~/);
  }
});

test("the unit: a param, the design's hint, else its size over the resolution; a design finer than its unit is drawn in pixel", () => {
  const d = house.designOf({ w: 6, roof: "flat", variant: 0 });
  assert.equal(voxelUnitFor(d, { unit: 0.3 }), 0.3);
  assert.equal(voxelUnitFor(d, { resolution: 10 }), 0.62); // (its roof reaches 6.2 m across)
  assert.equal(voxelUnitFor({ ...d, voxel: { unit: 0.2 } }), 0.2);
  const tiny = defineStyledObject({ id: "speck", look: { roles: { wall: { as: "primary" } } }, design: () => ({ solids: [solid.box("wall", [5, 5, 5], [0.001, 0.001, 0.001])] }) });
  const r = tiny.build({ style: "voxel", params: { unit: 1 } });
  assert.equal(r.style, "pixel");
  assert.equal(r.fellBack, true);
  assert.match(r.why, /declined/);
  // (A registry without the voxel style: the request falls back to pixel too.)
  assert.equal(house.build({ style: "voxel", registry: createStyleRegistry([pixelStyle]) }).style, "pixel");
});
