import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettings } from "@keel-engine/world";
import { buildPathGrid, regions } from "@keel-engine/terrain";
import {
  applyLevelOp, createLevel, decodeLevel, encodeLevel, expandAll, fairness, generateFair, generateLevel, levelInstances, levelOf, levelOpReference, placeholderContent, runLevelOps,
  validateLevelOps,
} from "../src/index.ts";
import type { LevelDocument } from "../src/index.ts";

const bytes = (d: LevelDocument): string => Buffer.from(encodeLevel(d)).toString("base64");

test("generation is deterministic: the same seed and locks build the same level, byte for byte", () => {
  for (const seed of ["1", "7", "demo"]) {
    const a = generateLevel({ seed, width: 64, depth: 64, players: 2 }).level.toDocument();
    const b = generateLevel({ seed, width: 64, depth: 64, players: 2 }).level.toDocument();
    assert.equal(bytes(a), bytes(b));
  }
  const c = generateLevel({ seed: "1", width: 64, depth: 64, players: 2 }).level.toDocument();
  const d = generateLevel({ seed: "2", width: 64, depth: 64, players: 2 }).level.toDocument();
  assert.notEqual(bytes(c), bytes(d));
});

test("locks: a locked choice is used; locking the seed's own choice changes nothing; one thing's lock changes that thing only", () => {
  const base = generateLevel({ seed: "5", width: 80, depth: 80, players: 1 }).level;
  const doc0 = base.toDocument();
  // Lock what the seed chose anyway: the same level.
  const same = generateLevel({ seed: "5", width: 80, depth: 80, players: 1, settings: `scene/level.biome=${String(base.meta["biome"])};scene/level.template=${String(base.meta["template"])}` }).level.toDocument();
  assert.deepEqual(same.terrain, doc0.terrain);
  assert.deepEqual(same.things, doc0.things);
  // A different biome: used, and written down as a lock.
  const other = base.meta["biome"] === "desert" ? "tundra" : "desert";
  const s = createSettings();
  s.lock("project", "level.biome", other);
  const locked = generateLevel({ seed: "5", width: 80, depth: 80, players: 1, settings: s }).level;
  assert.equal(locked.meta["biome"], other);
  assert.equal(locked.settings.explain("level.biome").lockedAt, "project");
  // ...and the other choices weren't reshuffled: each drew from its own stream.
  for (const key of ["level.template", "level.relief", "level.sea", "level.towns", "level.foliage"]) {
    assert.deepEqual(locked.settings.scope("seed")[key], base.settings.scope("seed")[key], key);
  }
  // One building's object locked: that building changes, every other thing stays.
  const b1 = [...base.things.values()].find((x) => x.layer === "buildings");
  assert.ok(b1, "a building to lock");
  const pick = b1.object === "tower" ? "barn" : "tower";
  const one = generateLevel({ seed: "5", width: 80, depth: 80, players: 1, settings: `id:${b1.id}/object=${pick}` }).level;
  assert.equal(one.things.get(b1.id)!.object, pick);
  for (const th of base.things.values()) if (th.id !== b1.id) assert.deepEqual(one.things.get(th.id), th, th.id);
  assert.deepEqual(one.toDocument().terrain, doc0.terrain);
  // Style: a level-wide setting and one thing's own lock, through the settings (the most specific wins; a lock above it would win).
  const st = generateLevel({ seed: "5", width: 80, depth: 80, players: 1, settings: `scene/style=~voxel;id:${b1.id}/style=pixel` }).level;
  assert.equal(st.styleOf(), "voxel");
  assert.equal(st.styleOf(st.things.get(b1.id)!), "pixel");
  const another = [...st.things.values()].find((x) => x.id !== b1.id)!;
  assert.equal(st.refOf(another).style, "voxel");
});

test("a locked lake changes its own basin; the rest of the map keeps its tiles", () => {
  const settings = "scene/level.lakes=1;scene/level.template=highlands;scene/level.rivers=0;scene/level.towns=0";
  const a = generateLevel({ seed: "lakes", width: 72, depth: 72, players: 1, settings }).level;
  const lake = a.water.find((w) => w.id === "lake-0");
  assert.ok(lake, "the lake is there");
  const b = generateLevel({ seed: "lakes", width: 72, depth: 72, players: 1, settings: `${settings};id:lake-0/radius=3` }).level;
  const at = lake.at!;
  let outside = 0, differ = 0;
  for (let j = 0; j < 72; j += 1) for (let i = 0; i < 72; i += 1) {
    if (Math.hypot(i - at[0], j - at[1]) <= 10) continue;
    outside += 1;
    const k = j * 72 + i;
    if (a.terrain.height[k] !== b.terrain.height[k] || a.terrain.water[k] !== b.terrain.water[k]) differ += 1;
  }
  // (Ramps are laid where plateaus need joining, so a few tiles may move with the lake; the map doesn't reshuffle.)
  assert.ok(differ / outside < 0.02, `${differ} of ${outside} tiles away from the lake differ`);
});

test("fairness: exact symmetries measure even; the gate rerolls near ones", () => {
  for (const [seed, players, size] of [["f1", 2, 96], ["f2", 2, 96], ["f3", 4, 96]] as const) {
    const sym = players === 4 ? "rot4" : undefined;
    const { level } = generateLevel({ seed, width: size, depth: size, players, ...(sym ? { settings: `scene/level.symmetry=${sym}` } : {}) });
    const f = fairness(level);
    assert.ok(f.connected, `${seed}: every main reaches every other`);
    assert.equal(level.spawns.length, players);
    for (const key of ["toNatural", "toEnemy", "resources", "height"] as const) assert.ok(f.spread[key] <= 0.05, `${seed} ${key} spread ${f.spread[key]}`);
    assert.ok(f.pass, `${seed}: worst ${f.worst.metric} ${f.worst.spread}`);
    // Every base has 8 mass and one of each advanced site.
    for (const s of level.spawns) {
      const mine = level.resources.filter((r) => r.owner === s.player && r.id.startsWith("base-"));
      assert.equal(mine.filter((r) => r.kind === "mass").length, 8);
      for (const kind of ["crystal", "flux", "fertile", "wreck"]) assert.equal(mine.filter((r) => r.kind === kind).length, 1, `${seed} player ${s.player} ${kind}`);
    }
  }
  const r = generateFair({ seed: "wedge", width: 112, depth: 112, players: 3, tries: 4 }, (l) => fairness(l));
  assert.ok(r.attempt >= 0 && r.attempt < 4);
  assert.ok(Number.isFinite(r.fair.worst.spread));
});

test("the document round-trips: JSON and the codec, exactly", () => {
  const { level } = generateLevel({ seed: "rt", width: 96, depth: 64, players: 1, chunk: 16 });
  level.markers = [...level.markers, { id: "m", kind: "note", pos: [1.25, 2, 3.5], tags: ["x"], data: { text: "hello", n: [1, 2] } }];
  assert.ok(applyLevelOp(level, { op: "place", id: "shrine-1", pack: "packs/buildings", object: "shrine", pos: [20.5, 3, 30.25], yaw: 1.5707963267948966, pins: { roof: "slate" }, tier: "ground", footprint: [9, 14, 11, 16], tags: ["holy"] }).ok);
  assert.ok(applyLevelOp(level, { op: "region", id: "ambush", kind: "trigger", rect: [30, 30, 36, 36], script: "spawn wolves" }).ok);
  const doc = level.toDocument();
  const packed = encodeLevel(doc);
  const back = decodeLevel(packed);
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(doc)));
  const again = levelOf(back).toDocument();
  assert.equal(bytes(again), bytes(doc));
  const json = JSON.stringify(doc).length;
  console.log(`# level 96x64, ${level.things.size} things, ${level.scatter.length} scatter regions: codec ${packed.length} bytes, JSON ${json} bytes`);
  assert.ok(packed.length < json / 5);
  // The settings (with the locks) ride along.
  assert.deepEqual(levelOf(back).settings.toJSON(), level.settings.toJSON());
});

test("edit ops: validated, applied with change events, undone and redone; runs are atomic", () => {
  const level = createLevel({ width: 32, depth: 32, chunk: 16 });
  const events: string[] = [];
  level.onChange((c) => events.push(c.kind));
  assert.equal(validateLevelOps([{ op: "height", rect: [0, 0, 4] }]).ok, false);
  assert.equal(validateLevelOps([{ op: "nope" }]).errors[0]!.message.startsWith("unknown op"), true);
  let r = applyLevelOp(level, { op: "height", rect: [10, 10, 20, 20], add: 1 });
  assert.ok(r.ok && r.event.chunks.length > 0);
  r = applyLevelOp(level, { op: "ramp", at: [15, 9], dir: 0, width: 2 });
  assert.ok(r.ok, !r.ok ? r.error.message : "");
  assert.ok(level.terrain.isRamp(15, 9));
  assert.equal(regions(level.pathGrid()).count, 1);
  r = applyLevelOp(level, { op: "place", id: "tower-1", pack: "packs/buildings", object: "tower", pos: [30, 1, 30], tier: "ground", footprint: [14, 14, 16, 16] });
  assert.ok(r.ok);
  assert.equal(level.blocked()[15 * 32 + 15], 1);
  r = applyLevelOp(level, { op: "style", scope: "id:tower-1", style: "voxel", lock: true });
  assert.ok(r.ok);
  assert.equal(level.styleOf(level.things.get("tower-1")!), "voxel");
  // A lock refuses a write under it.
  r = applyLevelOp(level, { op: "set", scope: "id:tower-1", key: "style", value: "pixel" });
  assert.ok(!r.ok);
  // Undo the style and the place; redo the place.
  assert.ok(applyLevelOp(level, { op: "undo", steps: 2 }).ok);
  assert.equal(level.things.has("tower-1"), false);
  assert.equal(level.styleOf(), "pixel");
  assert.ok(applyLevelOp(level, { op: "redo" }).ok);
  assert.equal(level.things.has("tower-1"), true);
  // Atomic: the third op fails, the first two are taken back.
  const before = bytes(level.toDocument());
  const run = runLevelOps(level, [{ op: "paint", type: "sand", rect: [0, 0, 5, 5] }, { op: "water", at: [2, 2], level: -1 }, { op: "move", id: "nobody", yaw: 1 }]);
  assert.equal(run.ok, false);
  assert.equal(bytes(level.toDocument()), before);
  assert.ok(events.includes("terrain") && events.includes("things") && events.includes("settings"));
  assert.ok(levelOpReference().includes("ramp:"));
});

test("scatter: deterministic, spaced, and never on roads, water or blocked ground", () => {
  const { level } = generateLevel({ seed: "trees", width: 80, depth: 80, players: 1, settings: "scene/level.biome=temperate" });
  const a = expandAll(level), b = expandAll(level);
  assert.deepEqual(a, b);
  assert.ok(a.length > 500, `${a.length} plants`);
  const t = level.terrain;
  const road = t.types.id("road");
  const blocked = level.blocked();
  for (const p of a) {
    const [i, j] = t.tileAt(p.pos[0], p.pos[2]);
    const k = j * t.width + i;
    assert.notEqual(t.type[k], road);
    assert.equal(t.waterDepth(i, j), 0);
    assert.equal(blocked[k], 0);
  }
  // Spacing: no two plants of a region closer than the smaller spacing of their two rules.
  const flora = a.filter((p) => p.region === "flora");
  const rules = level.scatter.find((r) => r.id === "flora")!.rules;
  for (let x = 0; x < Math.min(flora.length, 400); x += 1) for (let y = x + 1; y < flora.length; y += 1) {
    const p = flora[x]!, q = flora[y]!;
    const d = Math.hypot(p.pos[0] - q.pos[0], p.pos[2] - q.pos[2]);
    assert.ok(d >= Math.min(rules[p.rule]!.spacing, rules[q.rule]!.spacing) - 1e-9);
  }
});

test("instances: every reference resolves through the placeholders; ground-tier things become their chunk's extras", () => {
  const { level } = generateLevel({ seed: "v6", width: 96, depth: 96, players: 1 });
  const inst = levelInstances(level, placeholderContent());
  assert.deepEqual(inst.missing, []);
  const groundThings = [...level.things.values()].filter((x) => x.tier === "ground");
  assert.ok(groundThings.length > 0);
  for (const th of groundThings) {
    const [i, j] = level.terrain.tileAt(th.pos[0], th.pos[2]);
    const c = level.terrain.chunkOf(i, j);
    assert.ok((inst.ground.get(c) ?? []).length > 0, `${th.id}'s chunk has its solids`);
    assert.notEqual(inst.groundKey(c), "");
  }
  assert.ok(inst.sprites.length > 100);
  // Every plant stands on the ground.
  for (const s of inst.sprites.slice(0, 200)) assert.ok(Math.abs(s.pos[1] - level.terrain.heightAt(s.pos[0], s.pos[2])) < 1e-9);
  // Bridges join what the river cut.
  if ((level.meta["bridges"] as number) > 0) {
    const g = buildPathGrid(level.terrain);
    const reg = regions(g);
    for (const s of level.spawns) assert.ok(reg.label[s.at[1] * level.terrain.width + s.at[0]]! >= 0);
  }
});
