// A voxel model as a population's explicit body: rigged, its skin posed
// through the rig's bones by part and entity role, its sockets the rig's --
// and the same body again from its stored document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { poseSkeleton, clipsFor } from "@keel-engine/entity";
import { VOXELS, readHeader, shortId } from "@keel-engine/codec";
import { generate, voxelBody, voxelBodyReader } from "../src/index.ts";

test("voxelBody: a rigged voxel model's skin by bone and entity role, its sockets, and back from its document", () => {
  const model = generate("critter", "1", { plan: "humanoid", unit: 0.075 }).model;
  const hero = voxelBody(model);
  assert.equal(hero.spec.plan, "humanoid");
  assert.equal(readHeader(hero.doc).id, shortId(VOXELS), "its document is a VOXELS document");
  assert.ok(hero.sockets["head"] && hero.sockets["hand.R"], "the contract's sockets");
  const walk = clipsFor(hero.spec)["walk"]!;
  const skel = poseSkeleton(hero.spec.rig, walk(hero.spec, 0.2, { phase: 0.2, landT: 0 }, { speed: 1 }), { pos: [0, 0, 0], yaw: 0 });
  const skin = hero.skin(skel);
  assert.equal(skin.boxes.length + skin.capsules.length, hero.spec.voxel.skin.boxes.length + hero.spec.voxel.skin.capsules.length);
  const roles = new Set(skin.boxes.map((b) => b.role));
  for (const r of roles) assert.ok(["cloth", "clothAlt", "furAlt", "accent", "fur", "dark", "blush"].includes(r), r);
  assert.ok(skin.boxes.some((b) => b.part.startsWith("forearm") || b.part.startsWith("upperArm")), "limbs by bone");
  // Read back from its document (what a hybrid record stores): the same body.
  const again = voxelBodyReader().body(hero.doc);
  assert.deepEqual(again.spec.rig, hero.spec.rig);
  assert.deepEqual(again.skin(skel), skin);
});
