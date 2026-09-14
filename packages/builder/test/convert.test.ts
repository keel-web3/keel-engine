// Conversion: voxels -> objects (parts, colliders, sockets, a detected
// front), attributes (fitted to sockets, worn by the engine's own
// characters) and entities (on the body contracts, with every required socket).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, stream } from "@keel-engine/core";
import { HUMANOID_BODY, QUADRUPED_BODY, contractOf, entityOf, missingSockets, placeAttribute, posed, socketsOf, speciesEntity, wear } from "@keel-engine/entity";
import { bakeForPhysics, bakeForRenderer, placeObject, settle, socketOf, worldColliders } from "@keel-engine/object";
import { defineManifest, definePack, fits } from "@keel-engine/runtime";
import { aabbOf, containsPoint } from "@keel-engine/scene";
import {
  attributeFromVoxels, builderLook, capsuleOfBox, entityFromVoxels, fitToSocket, generate, greedyBoxes, objectFromVoxels, partsFromVoxels, renderSolids,
} from "../src/index.ts";
import { dog, doorway, flag, blockPerson, topHat } from "./models.ts";

const S = (seed = "1") => stream(createRoll(`0x${seed.padStart(4, "0")}`), 0);

test("an object: box parts named by group or role, merged colliders, top sockets, sitting on y = 0", () => {
  const m = generate("crate", "3").model;
  const def = objectFromVoxels(m, { key: "crate" });
  assert.equal(def.kind, "object");
  assert.equal(def.parts.length, greedyBoxes(m).length);
  assert.ok(def.parts.every((p) => p.prim?.type === "box"));
  assert.ok(Math.abs(def.bounds[1]) < 1e-9, "stands on y = 0");
  // Colliders: the occupancy merged whatever the roles -- fewer than the parts, covering the same space.
  assert.ok(def.colliders.length < def.parts.length, `${def.colliders.length} colliders for ${def.parts.length} parts`);
  const vol = (list: ReadonlyArray<{ h: readonly number[] }>) => list.reduce((v, b) => v + 8 * b.h[0]! * b.h[1]! * b.h[2]!, 0);
  assert.ok(Math.abs(vol(def.colliders) - vol(def.parts.map((p) => ({ h: (p.prim as { h: number[] }).h })))) < 1e-9);
  // Its top: the crate's lid, in the middle, at its height.
  const top = def.sockets["top"]!;
  assert.equal(top.kind, "top");
  assert.ok(Math.abs(top.pos[1] - def.bounds[4]) < 1e-9);
  // Placed and settled like any object; baked for the renderer and physics.
  const inst = placeObject(def, { pos: [2, 3, -1], yaw: Math.PI / 2 });
  const s = settle(inst, [0]);
  assert.ok(s.rests && Math.abs(aabbOf(s.instance)[1]) < 1e-9);
  assert.equal(bakeForRenderer([inst]).boxes.length, def.parts.length);
  assert.equal(bakeForPhysics([inst]).boxes.length, def.colliders.length);
  assert.ok(containsPoint(inst, socketOf(inst, "top")!.pos));
  assert.equal(worldColliders(inst).length, def.colliders.length);
});

test("an object's front is detected from what it's made of (a door), and declared ones are checked", () => {
  const door = objectFromVoxels(doorway(), { key: "doorway" });
  assert.equal(door.front, 0, `the door faces +z: ${door.meta.builder.front.why.join("; ")}`);
  assert.ok(door.meta.builder.front.confidence > 0.35);
  assert.ok(door.sockets["view"], "a view socket in front");
  // Turned round in voxels, it faces -z.
  const back = doorway();
  const turned = objectFromVoxels((() => { const t = back.clone(); t.clear(); back.forEach((x, y, z, v) => t.setIndex(x, y, -z, v)); t.groups.set("door", [{ min: [-2, 0, -2], max: [1, 8, -1] }]); return t; })(), { key: "back" });
  assert.ok(Math.abs(Math.abs(turned.front!) - Math.PI) < 1e-9, `turned: ${turned.front}`);
  // A plain crate has no front to find; a declared one is kept.
  assert.equal(objectFromVoxels(generate("crate", "8").model).front, null);
  assert.equal(objectFromVoxels(generate("crate", "8").model, { front: "+x" }).front, Math.PI / 2);
  // The windmill's door and sails say it faces +z.
  assert.equal(objectFromVoxels(generate("windmill", "2").model).front, 0);
});

test("smoothing turns long boxes into capsules (organic limbs, poles); the renderer's solids come with materials", () => {
  const f = flag();
  const parts = partsFromVoxels(f, { smooth: { capsules: { roles: ["trim"] } } });
  const caps = parts.filter((p) => "capsule" in p);
  assert.equal(caps.length, 1, "the pole");
  assert.equal(caps[0]!.role, "trim");
  assert.equal(capsuleOfBox({ c: [0, 0, 0], h: [1, 1, 1] }), null, "a cube stays a box");
  const look = builderLook();
  const solids = renderSolids(f, look, { pos: [1, 0, 0], yaw: Math.PI / 2, smooth: { capsules: true } });
  assert.ok(solids.boxes.every((b) => b.yaw === Math.PI / 2 && b.mat === look.table["primary"] || b.mat === look.table["secondary"]));
  assert.ok(solids.capsules.length >= 1);
});

test("an attribute is built in its socket's frame and sized to it: the same hat on a mouse's head and a bear's", () => {
  const hat = attributeFromVoxels(topHat(), { id: "voxel-top-hat", slot: "head", fit: "width", fill: 0.9 });
  assert.equal(hat.type, "attribute");
  const mouse = entityOf("5", { kind: "animal", species: "mouse" });
  const bear = entityOf("5", { kind: "animal", species: "bear" });
  const person = entityOf("5", { kind: "humanoid" });
  const widths: number[] = [];
  for (const spec of [mouse, bear, person]) {
    const worn = wear(hat, spec, S());
    const head = socketsOf(spec)["head"]!;
    const xs = worn.design.boxes.flatMap((b) => [b.c[0] - b.h[0], b.c[0] + b.h[0]]);
    const width = Math.max(...xs) - Math.min(...xs);
    assert.ok(Math.abs(width - head.size[0] * 0.9) < 1e-9, `${spec.species}: width ${width} = 0.9 x ${head.size[0]}`);
    // Sits on the crown: its lowest face on the socket's origin (the head socket grows up).
    const ys = worn.design.boxes.flatMap((b) => [b.c[1] - b.h[1], b.c[1] + b.h[1]]);
    assert.ok(Math.abs(Math.min(...ys)) < 1e-9);
    widths.push(width);
    // Placed on a posed skeleton, it rides the head through a run.
    const skel = posed(spec, spec.plan === "quadruped" ? "gallop" : "run", { phase: 0.3 });
    const fitted = placeAttribute(skel, worn.socket, worn.design);
    assert.equal(fitted.boxes.length, worn.design.boxes.length);
    assert.ok(fitted.boxes.every((b) => b.c.every(Number.isFinite)));
    assert.ok(worn.design.boxes.every((b) => ["clothAlt", "accent", "dark"].includes(b.role!)), "builder roles play entity roles");
  }
  assert.ok(widths[1]! > widths[0]! * 3, "a bear's is bigger than a mouse's");
});

test("an attribute's anchor comes from the socket: on the crown, off the back, round the neck", () => {
  const person = entityOf("2", { kind: "humanoid" });
  const s = socketsOf(person);
  const box = fitToSocket(flag(), s["back"]!, { fit: "height" });
  const zs = box.boxes.flatMap((b) => [b.c[2] - b.h[2], b.c[2] + b.h[2]]);
  assert.ok(Math.abs(Math.max(...zs)) < 1e-9, "the back socket grows -z: the flag's front face on it");
  const ring = fitToSocket(topHat(), s["neck"]!, { fit: "width" });
  const ys = ring.boxes.flatMap((b) => [b.c[1] - b.h[1], b.c[1] + b.h[1]]);
  assert.ok(Math.abs(Math.max(...ys) + Math.min(...ys)) < 1e-9, "centred on an around socket");
});

test("attributes fit by the runtime's rules; a voxel pack's attribute goes on another pack's entities only when both agree", () => {
  const hat = attributeFromVoxels(topHat(), { id: "top-hat", slot: "head", targets: [{ body: HUMANOID_BODY.range }] });
  const creator = defineManifest({ id: "packs/voxel-hats", version: "1.0.0", kind: "pack", compatible: ["packs/humans@^1"] });
  const humans = defineManifest({ id: "packs/humans", version: "1.0.0", kind: "pack", compatible: ["packs/voxel-hats@^1"] });
  const animals = defineManifest({ id: "packs/animals", version: "1.0.0", kind: "pack", compatible: ["*"] });
  assert.ok(fits({ def: hat, pack: creator }, { def: speciesEntity("humanoid", "human"), pack: humans }).ok);
  assert.ok(!fits({ def: hat, pack: creator }, { def: speciesEntity("animal", "dog"), pack: animals }).ok, "a humanoid-only hat");
  definePack({ entities: [], attributes: [hat] });
});

test("variation in an attribute: pins win, draws are the seed's", () => {
  const m = topHat();
  m.groups.set("crown", [{ min: [-4, 3, -4], max: [3, 8, 3] }]);
  const hat = attributeFromVoxels(m, { id: "tall-hat", slot: "head", variation: { scale: { tall: { region: "crown", y: [0.5, 2], anchor: "bottom" } } } });
  assert.deepEqual(hat.choices, { tall: { range: [0.5, 2] } });
  const spec = entityOf("1", { kind: "humanoid" });
  const socket = socketsOf(spec)["head"]!;
  const h = (pins = {}, seed = "1") => hat.build(S(seed), socket, pins);
  assert.deepEqual(h(), h(), "same stream, same hat");
  const height = (d: ReturnType<typeof h>) => Math.max(...d.boxes.map((b) => b.c[1] + b.h[1]));
  assert.ok(height(h({ tall: 2 })) > height(h({ tall: 0.5 })) * 1.5);
  assert.deepEqual(h({ tall: 1.3 }).builder.variant, { tall: [1.3, 1.3, 1.3] });
});

test("an entity on its body contract: every required socket, contents a pack's manifest can list", () => {
  for (const [model, plan] of [[dog(), "quadruped"], [blockPerson(), "humanoid"]] as const) {
    const def = entityFromVoxels(model, { id: model.name });
    assert.equal(def.body, contractOf({ plan }).ref);
    const spec = def.build(S(), {});
    assert.equal(spec.plan, plan);
    const sockets = def.sockets(spec);
    assert.deepEqual(missingSockets(plan === "quadruped" ? QUADRUPED_BODY : HUMANOID_BODY, sockets), []);
    // The contract's own sockets, from the voxel creature's own rig.
    assert.deepEqual(Object.keys(sockets).sort(), Object.keys(socketsOf(spec)).sort());
    const pack = definePack({ entities: [def], attributes: [] });
    assert.equal(pack.entities[0]!.id, model.name);
    // The engine's attributes fit it: a cloth-style hat built to its head.
    const hat = attributeFromVoxels(topHat(), { id: "hat", slot: "head" });
    const worn = wear(hat, spec, S());
    assert.ok(worn.design.boxes.length > 0);
  }
});
