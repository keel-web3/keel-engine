// packs/buildings: every variant and piece builds in the pixel and the voxel
// style over 50 seeds -- the same colliders and sockets, the footprint within
// a voxel, inside the renderer's budgets, roles known; buildings face +z (a
// door on it, front detection agrees), their entrances stand outside every
// collider; bridges' end sockets land on the span's ends; segments along a
// path meet end to end; ramps and stairs are wedges you walk up.
import { test } from "node:test";
import assert from "node:assert/strict";
import "@keel-engine/builder";
import { localToWorld } from "@keel-engine/core";
import { createCharacter } from "@keel-engine/physics";
import { bakeForPhysics, designBounds, frontOfObject, placeContent, placeObject, worldColliders, worldSockets } from "@keel-engine/object";
import type { BuiltObject } from "@keel-engine/object";
import { alongPath, bridgeFor, pack } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const SEEDS = 50;
const inBox = (p: readonly number[], b: { c: readonly number[]; h: readonly number[]; yaw: number }, pad = 0): boolean => {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const dx = p[0]! - b.c[0]!, dz = p[2]! - b.c[2]!;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) < b.h[0]! - pad && Math.abs(p[1]! - b.c[1]!) < b.h[1]! - pad && Math.abs(lz) < b.h[2]! - pad;
};
function budget(b: BuiltObject): { boxes: number; wedges: number; capsules: number } {
  let boxes = 0, wedges = 0, capsules = 0;
  for (const p of b.def.parts) { if (p.wedge) wedges += 1; else if (p.prim?.type === "box") boxes += 1; else if (p.prim?.type === "capsule") capsules += 1; }
  return { boxes, wedges, capsules };
}

test("the manifest lists every object; needs only keel/object", () => {
  assert.equal(manifest.id, "packs/buildings");
  assert.deepEqual([...manifest.needs], ["keel/object@^0.1"]);
  assert.equal(manifest.contents!.objects!.length, 20);
});

test("every object builds in both styles over 50 seeds: same colliders and sockets, footprint within a voxel, inside the budgets, roles known", () => {
  const rows: string[] = [];
  for (const def of pack.objects) {
    let maxPix = 0, maxVox = 0, worst = 0;
    for (let s = 0; s < SEEDS; s += 1) {
      const p = def.build({ seed: s, style: "pixel" });
      const v = def.build({ seed: s, style: "voxel" });
      assert.equal(v.style, "voxel", `${def.id} ${s}: ${v.why}`);
      assert.deepEqual(v.def.colliders, p.def.colliders, `${def.id} ${s} colliders`);
      assert.deepEqual(v.def.sockets, p.def.sockets, `${def.id} ${s} sockets`);
      assert.ok(p.def.colliders.length > 0 || def.id === "path-stones", `${def.id} collides`);
      const unit = v.stats["unit"]!;
      const size = Math.max(p.def.bounds[3] - p.def.bounds[0], p.def.bounds[4] - p.def.bounds[1], p.def.bounds[5] - p.def.bounds[2]);
      for (let i = 0; i < 6; i += 1) {
        const d = Math.abs(v.def.bounds[i]! - p.def.bounds[i]!);
        worst = Math.max(worst, d / unit);
        assert.ok(d <= unit + size * 0.05, `${def.id} ${s} bound ${i}: ${d.toFixed(3)} (unit ${unit})`);
      }
      for (const b of [p, v]) {
        const n = budget(b);
        assert.ok(n.boxes <= 256 && n.capsules <= 256 && n.wedges <= 128, `${def.id} ${b.style} ${s}: ${JSON.stringify(n)}`);
        for (const part of b.def.parts) assert.ok(def.look.roles[(part as { role?: string }).role!], `${def.id}: role ${(part as { role?: string }).role}`);
      }
      // (Only what spans water or a gap reaches below the ground: bridges' piers, docks' piles.)
      if (!["bridge", "dock"].includes(def.id)) assert.ok(designBounds(p.design.solids)[1] >= -1e-9, `${def.id} ${s} dips below the ground`);
      maxPix = Math.max(maxPix, p.def.parts.length);
      maxVox = Math.max(maxVox, v.def.parts.length);
    }
    rows.push(`${def.id}: pixel <= ${maxPix} parts, voxel <= ${maxVox} boxes, footprints within ${worst.toFixed(2)} voxels`);
  }
  console.log(rows.join("\n"));
});

test("buildings face +z: a door on that face, front detection agrees; the entrance stands clear of every collider", () => {
  const withDoors = ["building", "cottage", "tower", "hall", "workshop", "shop", "hab", "dome", "factory", "hive"];
  for (const id of withDoors) for (let s = 0; s < 20; s += 1) {
    const b = pack.get(id)!.build({ seed: s });
    assert.equal(b.def.front, 0, `${id} declares +z`);
    const door = b.def.parts.find((p) => p.name === "door");
    if (b.values["door"] === "none") continue;
    assert.ok(door, `${id} ${s} has a door part`);
    assert.ok(door.bounds[5] >= b.def.bounds[5] - 1.6, `${id} ${s}: the door is on the front`);
    const f = frontOfObject(b.def);
    assert.notEqual(f.agrees, false, `${id} ${s}: front detection disagrees (${f.why.join("; ")})`);
    const entrance = b.def.sockets["entrance"];
    assert.ok(entrance, `${id} ${s} has an entrance`);
    const probe = [entrance.pos[0], 0.5, entrance.pos[2]];
    for (const c of b.def.colliders) assert.ok(!inBox(probe, c), `${id} ${s}: the entrance is inside ${c.part}`);
    assert.equal((b.def.meta as { building?: { walkable: boolean } }).building?.walkable, false);
  }
});

test("bridges: placed by bridgeFor, their end sockets land on the span's ends (any kind, any direction, a rise between)", () => {
  let n = 0;
  for (let i = 0; i < 60; i += 1) {
    const ang = i * 0.7, L = 4 + (i % 9) * 3, rise = ((i % 7) - 3) * 0.8;
    const a: [number, number, number] = [i * 1.3 - 20, 2, i * -0.7];
    const b: [number, number, number] = [a[0] + Math.sin(ang) * L, a[1] + rise, a[2] + Math.cos(ang) * L];
    const kind = (["beam", "arch", "rope", "plank"] as const)[i % 4]!;
    const placed = placeContent([pack], bridgeFor(a, b, { kind, seed: i }));
    const s = worldSockets(placed.instance);
    for (const [name, want] of [["endA", a], ["endB", b]] as const) {
      const d = Math.hypot(s[name]!.pos[0] - want[0], s[name]!.pos[1] - want[1], s[name]!.pos[2] - want[2]);
      assert.ok(d < 2e-3, `${kind} ${i} ${name} ${d}`);
    }
    // (The deck collides where you'd walk: just under each end.)
    for (const want of [a, b]) {
      const inward = [want[0] + (s["middle"]!.pos[0] - want[0]) * 0.05, want[1] - 0.05, want[2] + (s["middle"]!.pos[2] - want[2]) * 0.05];
      assert.ok(worldColliders(placed.instance).some((c) => inBox(inward, c)), `${kind} ${i}: no deck under its end`);
    }
    n += 1;
  }
  assert.equal(n, 60);
  assert.throws(() => bridgeFor([0, 0, 0], [0, 0, 40]), /3\.\.30 m/);
});

test("walls, fences and path stones along a path meet end to end; gates replace the segments asked for", () => {
  const path: Array<[number, number, number]> = [[0, 0, 0], [13, 0, 2], [20, 0, 15], [8, 0, 24]];
  for (const id of ["wall", "fence", "path-stones"] as const) {
    const recs = alongPath(path, { id, gates: id === "path-stones" ? [] : [3], seed: 5 });
    const placed = recs.map((r) => placeContent([pack], r));
    if (id !== "path-stones") assert.equal(placed.filter((p) => p.built.id === "gate").length, 1);
    for (let i = 0; i + 1 < placed.length; i += 1) {
      const b = worldSockets(placed[i]!.instance)["endB"]!.pos, a = worldSockets(placed[i + 1]!.instance)["endA"]!.pos;
      assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) < 2e-3, `${id} ${i}: a gap of ${Math.hypot(a[0] - b[0], a[2] - b[2])}`);
    }
    const first = worldSockets(placed[0]!.instance)["endA"]!.pos, last = worldSockets(placed.at(-1)!.instance)["endB"]!.pos;
    assert.ok(Math.hypot(first[0] - 0, first[2] - 0) < 2e-3 && Math.hypot(last[0] - 8, last[2] - 24) < 2e-3);
    // (One look for the run.)
    assert.equal(new Set(recs.map((r) => r.look?.seed)).size, 1);
  }
});

test("a body walks up a ramp, a flight of stairs and cliff steps (wedges), and stands on the top", () => {
  const floor = { c: [0, -0.5, 0] as [number, number, number], h: [40, 0.5, 40] as [number, number, number] };
  for (const [id, pins] of [["ramp", { length: 6, height: 1.2, width: 2 }], ["stairs", { steps: 8, width: 2, sides: "open" }], ["cliff-steps", { height: 2, width: 2, form: "straight" }]] as const) {
    const b = pack.get(id)!.build({ seed: 1, pins });
    const inst = placeObject(b.def, {});
    const top = b.def.sockets["top"]!.pos;
    const foot = b.def.sockets["foot"]!.pos;
    const body = createCharacter({ boxes: [floor, ...bakeForPhysics([inst]).boxes], spawn: [foot[0], 0.3, foot[2] + 1.5], waterY: -10 });
    for (let i = 0; i < 600 && body.pos[2] > top[2] + 0.25; i += 1) body.step(1 / 60, { move: [0, -1] });
    assert.ok(Math.abs(body.pos[1] - top[1]) < 0.35, `${id}: at the top (${body.pos.map((v) => v.toFixed(2)).join(",")} vs ${top.join(",")})`);
  }
});

test("world placement: an L cottage turned and moved keeps its sockets with it; culture looks leave the shape alone", () => {
  const rec = { pack: "packs/buildings", id: "cottage", seed: 4, pins: { footprint: "L" }, pos: [10, 0, -3] as [number, number, number], yaw: 0.8 };
  const village = placeContent([pack], { ...rec, look: { profile: "village" } });
  const nordic = placeContent([pack], { ...rec, look: { profile: "nordic" } });
  assert.equal(village.built.key, nordic.built.key);
  assert.notEqual(village.look.signature, nordic.look.signature);
  const door = worldSockets(village.instance)["door"]!;
  const want = localToWorld(rec.pos, rec.yaw, village.built.def.sockets["door"]!.pos);
  assert.ok(Math.hypot(door.pos[0] - want[0], door.pos[2] - want[2]) < 1e-9);
});
