// packs/foliage: every kind builds in the pixel and the voxel style over 50
// seeds -- the same colliders and sockets in both, the footprint within a
// voxel (plus what the pixel style's rounder approximations add), inside the
// renderer's budgets, every part on a role its look names; the massive kinds
// make few shapes and never collide; trees sway; the profiles hold; the same
// seed, the same thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import "@keel-engine/builder";
import { bakeDesignOf, designBounds, lookFor, placeContent, shapeCount, shapeGrid, styleSetting } from "@keel-engine/object";
import type { BuiltObject } from "@keel-engine/object";
import { PROFILES, pack } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const SEEDS = 50;
function budget(b: BuiltObject): { boxes: number; wedges: number; capsules: number } {
  let boxes = 0, wedges = 0, capsules = 0;
  for (const p of b.def.parts) { if (p.wedge) wedges += 1; else if (p.prim?.type === "box") boxes += 1; else if (p.prim?.type === "capsule") capsules += 1; }
  return { boxes, wedges, capsules };
}

test("the manifest lists every object with its tier, and needs only keel/object", () => {
  assert.equal(manifest.id, "packs/foliage");
  assert.deepEqual([...manifest.needs], ["keel/object@^0.1"]);
  assert.equal(manifest.contents!.objects!.length, 16);
  for (const o of manifest.contents!.objects!) assert.ok(o.tags!.includes("tier:background"), o.id);
});

test("every kind builds in both styles over 50 seeds: same colliders and sockets, footprint within a voxel, inside the budgets, roles known", () => {
  const rows: string[] = [];
  for (const def of pack.objects) {
    let maxPix = 0, maxVox = 0, worst = 0;
    const rolesSeen = new Set<string>();
    for (let s = 0; s < SEEDS; s += 1) {
      const p = def.build({ seed: s, style: "pixel" });
      const v = def.build({ seed: s, style: "voxel" });
      assert.equal(p.style, "pixel");
      assert.equal(v.style, "voxel", `${def.id} seed ${s}: ${v.why}`);
      assert.deepEqual(v.def.colliders, p.def.colliders, `${def.id} ${s} colliders`);
      assert.deepEqual(v.def.sockets, p.def.sockets, `${def.id} ${s} sockets`);
      const unit = v.stats["unit"]!;
      const size = Math.max(p.def.bounds[3] - p.def.bounds[0], p.def.bounds[4] - p.def.bounds[1], p.def.bounds[5] - p.def.bounds[2]);
      for (let i = 0; i < 6; i += 1) {
        const d = Math.abs(v.def.bounds[i]! - p.def.bounds[i]!);
        worst = Math.max(worst, d / unit);
        // (A voxel, and a little for the pixel style's spheres standing in for flattened balls.)
        assert.ok(d <= unit + size * 0.08, `${def.id} ${s} bound ${i}: ${d.toFixed(3)} > unit ${unit} + ${(size * 0.08).toFixed(3)}`);
      }
      for (const b of [p, v]) {
        const n = budget(b);
        assert.ok(n.boxes <= 256 && n.capsules <= 256 && n.wedges <= 128, `${def.id} ${b.style} ${s}: ${JSON.stringify(n)}`);
        for (const part of b.def.parts) { const r = (part as { role?: string }).role!; assert.ok(def.look.roles[r], `${def.id}: role ${r}`); rolesSeen.add(r); }
      }
      // (The design stands on y = 0; the pixel style's spheres, standing in for flattened balls, may dip a little.)
      assert.ok(designBounds(p.design.solids)[1] >= -1e-9, `${def.id} ${s}: its design dips below the ground (${designBounds(p.design.solids)[1]})`);
      assert.ok(p.def.bounds[1] >= -0.04 * size, `${def.id} ${s}: pixel parts dip ${p.def.bounds[1]}`);
      maxPix = Math.max(maxPix, p.def.parts.length);
      maxVox = Math.max(maxVox, v.def.parts.length);
    }
    // (Every role it declares turns up in some seed.)
    for (const r of Object.keys(def.look.roles)) assert.ok(rolesSeen.has(r), `${def.id} never uses its role ${r}`);
    rows.push(`${def.id}: pixel <= ${maxPix} parts, voxel <= ${maxVox} boxes, footprints within ${worst.toFixed(2)} voxels`);
  }
  console.log(rows.join("\n"));
});

test("the massive kinds make few shapes, never collide, bake one direction, sit in the background", () => {
  for (const id of ["grass", "flowers", "reeds"]) {
    const def = pack.get(id)!;
    assert.equal(def.instancing, "massive");
    assert.equal(def.tier, "background");
    const S = stream(createRoll(deriveSeed(`meadow/${id}`, 0)), 0);
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const b = def.build({ seed: i, pins: shapeGrid(def, S, { steps: 2 }) });
      keys.add(b.key);
      assert.equal(b.def.colliders.length, 0);
      if (i === 0) assert.equal(bakeDesignOf(b).symmetric, true);
    }
    assert.ok(keys.size <= shapeCount(def, 2) && keys.size <= 96, `${id}: ${keys.size} shapes for a thousand tufts (grid ${shapeCount(def, 2)})`);
  }
});

test("trees sway (their trunks stay put); rocks, logs and crystals don't", () => {
  for (const id of ["oak", "pine", "birch", "palm", "bush", "grass"]) { const s = pack.get(id)!.sway; assert.ok(s && s.amp > 0 && s.hz > 0, id); }
  for (const id of ["rock", "log", "stump", "crystal", "cactus", "dead-tree"]) assert.equal(pack.get(id)!.sway, null, id);
  const oak = pack.get("oak")!.build({ seed: 1 });
  assert.ok(oak.sway!.from > 0.5);
  assert.equal(bakeDesignOf(oak, { swayFrames: 4 }).clips[1]!.frames, 4);
});

test("every profile an asset names is the pack's; a season's ranges hold for its leaves", () => {
  const ids = new Set(PROFILES.map((p) => p.id));
  for (const def of pack.objects) for (const p of def.look.profiles ?? []) assert.ok(ids.has(p), `${def.id}: ${p}`);
  const summer = pack.profile("summer")!, autumn = pack.profile("autumn")!;
  for (let i = 0; i < 30; i += 1) {
    const s = lookFor(pack.get("oak")!, `oak${i}`, { profile: summer }).roles.primary!;
    assert.ok(s.hue >= 142 && s.hue <= 160, `summer leaf ${s.hue}`);
    const a = lookFor(pack.get("oak")!, `oak${i}`, { profile: autumn }).roles.primary!;
    assert.ok(a.hue >= 30 && a.hue <= 85, `autumn leaf ${a.hue}`);
  }
});

test("placing: a record builds, places and wears its season (a look choice naming a profile); a locked voxel setting draws voxels", () => {
  const placed = placeContent([pack], { pack: "packs/foliage", id: "oak", seed: 3, pins: { season: "winter" }, pos: [2, 0, 5], yaw: 1 });
  assert.ok(placed.look.roles.primary!.light >= 0.85, "winter leaves are snow");
  assert.equal(placed.tier, "background");
  const vox = placeContent([pack], { pack: "packs/foliage", id: "pine", seed: 3, style: "pixel" }, { setting: styleSetting("voxel", { locked: true }) });
  assert.equal(vox.built.style, "voxel");
});

test("the same seed makes the same thing, run to run", () => {
  for (const def of pack.objects) {
    const a = def.build({ seed: "same", style: "pixel" }), b = def.build({ seed: "same", style: "pixel" });
    assert.equal(a.key, b.key);
    const again = def.designOf(a.shape);
    assert.equal(JSON.stringify(again.solids), JSON.stringify(a.design.solids));
  }
});
