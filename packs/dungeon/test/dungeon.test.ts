// packs/dungeon: every prop builds in pixel style over many seeds, inside the
// renderer's budgets, every part on a role its look names, standing on the
// ground; the act profiles paint them all and differently; light sources
// carry their flames; openable things have their other state; its placement
// rules cover every object; its room templates are sound and keel/worldgen
// stitches dungeons from them.
import { test } from "node:test";
import assert from "node:assert/strict";
import "@keel-engine/builder";
import { bakeDesignOf, designBounds, lookFor } from "@keel-engine/object";
import { ACTS, PROPS, ROOMS, pack } from "../src/index.ts";
import { manifest } from "../src/module.ts";
import { TEMPLATE_PROPS, defineRecipe, defineWorldPack, dressDungeon, generateDungeon, runPipeline } from "@keel-engine/worldgen";

test("the manifest lists every object with its tier, and needs keel/object (and keel/runtime, for the hero's gear)", () => {
  assert.equal(manifest.id, "packs/dungeon");
  assert.deepEqual([...manifest.needs], ["keel/runtime@^0.1", "keel/object@^0.1"]);
  assert.equal(manifest.contents!.objects!.length, pack.objects.length);
  assert.ok(pack.objects.length >= 29);
  for (const o of manifest.contents!.objects!) assert.ok(o.tags!.some((t) => t.startsWith("tier:")), o.id);
});

test("every prop builds in pixel style over 40 seeds: inside the budgets, on the ground, every role it declares used", () => {
  const rows: string[] = [];
  for (const def of pack.objects) {
    let max = 0;
    const used = new Set<string>();
    for (let s = 0; s < 40; s += 1) {
      const b = def.build({ seed: s, style: "pixel" });
      assert.equal(b.style, "pixel");
      let boxes = 0, capsules = 0;
      for (const p of b.def.parts) { const r = (p as { role?: string }).role!; assert.ok(def.look.roles[r], `${def.id}: role ${r}`); used.add(r); if ((p as { prim?: { type: string } }).prim?.type === "box") boxes += 1; else capsules += 1; }
      assert.ok(boxes <= 256 && capsules <= 256, `${def.id} ${s}: ${boxes} boxes, ${capsules} capsules`);
      assert.ok(designBounds(b.design.solids)[1] >= -0.02, `${def.id} ${s}: dips below the ground`);
      const bake = bakeDesignOf(b);
      assert.ok(bake.height > 0.01 && bake.radius > 0.01, `${def.id}: a bake box`);
      max = Math.max(max, b.def.parts.length);
    }
    for (const r of Object.keys(def.look.roles)) assert.ok(used.has(r), `${def.id} never uses its role ${r}`);
    rows.push(`${def.id} <= ${max} parts`);
  }
  console.log(rows.join(", "));
});

test("the acts paint every prop, each its own way; the voxel style builds them too", () => {
  for (const def of pack.objects) {
    const b = def.build({ seed: 3, style: "pixel" });
    const looks = ACTS.map((a) => JSON.stringify(lookFor(b, "same", { profile: pack.profile(a)! })));
    assert.equal(new Set(looks).size, ACTS.length, `${def.id}: two acts paint it alike`);
    for (const p of def.look.profiles ?? []) assert.ok(pack.profile(p), `${def.id}: profile ${p}`);
    assert.equal(def.build({ seed: 3, style: "voxel" }).style, "voxel", def.id);
  }
});

test("light sources carry their flames; openable things open; the rules cover every object", () => {
  for (const id of ["torch", "brazier", "candelabra", "altar", "crystals", "key"]) {
    for (let s = 0; s < 10; s += 1) {
      const b = pack.get(id)!.build({ seed: s, style: "pixel" });
      const flames = ((b.def.meta ?? {}) as { flames?: number[][] }).flames ?? [];
      if (id === "altar" && flames.length === 0) continue;
      assert.ok(flames.length >= 1, `${id} ${s}: no flame`);
      const bb = b.def.bounds;
      for (const f of flames) assert.ok(f[1]! > 0 && f[1]! <= bb[4] + 0.3, `${id}: a flame off its object`);
    }
  }
  const chest = pack.get("chest")!;
  assert.notEqual(chest.build({ seed: 1, pins: { state: "closed" } }).key, chest.build({ seed: 1, pins: { state: "open" } }).key);
  assert.deepEqual(Object.keys(PROPS).sort(), pack.objects.map((o) => o.id).sort());
  for (const o of pack.objects) {
    const info = PROPS[o.id]!;
    assert.equal(info.destructible, o.tags.includes("destructible"), `${o.id}: destructible`);
    assert.equal(info.openable, o.tags.includes("openable"), `${o.id}: openable`);
    assert.equal(info.light !== null, o.tags.some((t) => t.startsWith("light:")), `${o.id}: light`);
  }
});

test("room templates: sound, every role played, furniture the pack has; keel/worldgen stitches dungeons from them", () => {
  const letters = new Set(["#", ".", "D", "T", "C", "P", "~", "o", "r", "B", "K", "S", "E", ...Object.keys(TEMPLATE_PROPS)]);
  for (const r of ROOMS) {
    const w = r.rows[0]!.length;
    assert.ok(r.rows.every((row) => row.length === w), `${r.id}: ragged rows`);
    r.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      assert.ok(letters.has(ch), `${r.id}: '${ch}'`);
      if (ch === "D") assert.ok(x === 0 || y === 0 || x === w - 1 || y === r.rows.length - 1, `${r.id}: a door inside`);
    }));
    assert.ok(r.id.startsWith("dungeon-"));
  }
  for (const id of Object.values(TEMPLATE_PROPS)) assert.ok(pack.get(id), `worldgen's letter for ${id}: the pack has it`);
  for (const role of ["start", "room", "key", "boss", "exit"]) assert.ok(ROOMS.some((r) => r.roles.includes(role as never)), role);
  const wp = defineWorldPack({ id: "packs/dungeon-rooms", version: "1.0.0", rooms: ROOMS });
  assert.ok(wp.contracts().includes("rooms/dungeon-rooms@1.0.0"));
  // A recipe naming them: every room of the floor is the pack's.
  const m = runPipeline(defineRecipe({ seed: "pack-rooms", width: 84, depth: 64, stages: [{ id: "floor", use: "dungeon@1", params: { algorithm: "rooms", rooms: 11, templates: "dungeon-*" } }] }), { templates: ROOMS });
  const used = String(m.meta["floor.rooms"]).split(",");
  assert.ok(used.length >= 5 && used.every((id) => id.startsWith("dungeon-")), used.join());
  assert.ok(m.things.some((t) => t.pack === "packs/dungeon" && (t.object === "bookshelf" || t.object === "sarcophagus" || t.object === "weapon-rack" || t.object === "cage")));
  // Dressed: the plan's furniture stands where the plan put it.
  const D = generateDungeon("pack-dress", 84, 64, { algorithm: "rooms", rooms: 11, templates: ROOMS as never });
  const S = dressDungeon(D, "crypt");
  const planned = D.props.filter((p) => PROPS[p.kind]);
  assert.ok(planned.length > 10);
  assert.ok(S.props.filter((p) => ["bookshelf", "sarcophagus", "weapon-rack", "cage", "throne"].includes(p.id)).length >= planned.filter((p) => ["bookshelf", "sarcophagus", "weapon-rack", "cage", "throne"].includes(p.kind)).length * 0.8);
});
