import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine, defineManifest } from "@keel-engine/runtime";
import { FLAG, WATER_NONE } from "@keel-engine/terrain";
import { fairness } from "@keel-engine/level";
import {
  createBiomeTable, createWorldStream, decodeBiomes, decodeRecipe, decodeRooms, decodeTileset, defineRecipe, defineStage, defineWorldPack, encodeBiomes, encodeRecipe, encodeRooms,
  encodeTileset, generateWorldLevel, hashLayers, interiorRecipe, levelWorld, runPipeline, scatterIn, stageKinds, worldOptions, worldPackManifest, DEFAULT_BIOMES, ROOM_TEMPLATES,
} from "../src/index.ts";
import type { WorldRecipe } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const MIXED = defineRecipe({
  seed: "mixed-1", width: 144, depth: 112,
  stages: [
    { id: "ground", use: "overworld@1", params: { land: 0.6, scale: 0.4 } },
    { id: "caves", use: "cave@1", mask: { kind: "circle", at: [34, 36], r: 20, feather: 3 } },
    { id: "town", use: "town@1", mask: { kind: "rect", rect: [90, 16, 126, 46] } },
    { id: "crypt", use: "dungeon@1", params: { algorithm: { pick: ["rooms", "bsp", "wfc"] }, rooms: { int: [7, 11] } }, mask: { kind: "rect", rect: [64, 60, 140, 108] } },
  ],
  pins: [{ rect: [8, 90, 18, 100], height: 7, type: "rock" }],
});

test("the same recipe builds the same tiles, byte for byte; the stage kinds are registered", () => {
  const a = runPipeline(MIXED), b = runPipeline(MIXED);
  assert.equal(hashLayers(a, 0, 0, 144, 112), hashLayers(b, 0, 0, 144, 112));
  assert.deepEqual(a.things.map((t) => t.id), b.things.map((t) => t.id));
  const other = runPipeline({ ...MIXED, seed: "mixed-2" });
  assert.notEqual(hashLayers(a, 0, 0, 144, 112), hashLayers(other, 0, 0, 144, 112));
  for (const k of ["overworld@1", "biome@1", "dungeon@1", "cave@1", "town@1", "level@1", "foliage@1"]) assert.ok(stageKinds().includes(k), k);
  assert.ok(manifest.provides.includes("worldgen/stage/dungeon@1.0.0"));
});

test("mixing: each stage writes inside its mask; the town and the dungeon are there; pins win over every stage", () => {
  const m = runPipeline(MIXED);
  const at = (i: number, j: number): number => j * m.w + i;
  // The dungeon: walls and floors of its theme inside its rectangle; outside, the overworld.
  const brick = m.types.id("brick");
  let walls = 0;
  for (let j = 60; j < 108; j += 1) for (let i = 64; i < 140; i += 1) if (m.type[at(i, j)] === brick) walls += 1;
  assert.ok(walls > 400, `${walls} dungeon walls`);
  assert.ok(m.things.some((t) => t.id.startsWith("crypt:") && t.kind === "boss"));
  assert.ok(m.things.some((t) => t.id.startsWith("town:") && t.kind === "building"), "town houses");
  assert.ok(m.regions.some((r) => r.id === "town") && m.regions.some((r) => r.id === "crypt"));
  // The pin: height 7 rock, whatever the stages did.
  for (let j = 90; j < 100; j += 1) for (let i = 8; i < 18; i += 1) { assert.equal(m.height[at(i, j)], 7); assert.equal(m.type[at(i, j)], m.types.id("rock")); }
});

test("locks reach a stage's rolled params, and change only that", () => {
  const base = runPipeline(MIXED);
  const algo = String(base.meta["crypt.algorithm"]);
  const other = algo === "bsp" ? "rooms" : "bsp";
  const locked = runPipeline({ ...MIXED, locks: `id:crypt/algorithm=${other}` });
  assert.equal(locked.meta["crypt.algorithm"], other);
  // Outside the dungeon's rectangle nothing moved.
  let diff = 0;
  for (let j = 0; j < 112; j += 1) for (let i = 0; i < 144; i += 1) {
    if (i >= 60 && i < 144 && j >= 56) continue; // (the dungeon and a margin)
    const k = j * 144 + i;
    if (base.height[k] !== locked.height[k] || base.type[k] !== locked.type[k]) diff += 1;
  }
  assert.equal(diff, 0);
});

test("an infinite world: chunks the same whichever order they're asked in, region stages cut into the chunks they reach", () => {
  const inf = defineRecipe({ seed: "inf-1", width: 0, depth: 0, stages: [{ id: "ground", use: "overworld@1" }, { id: "crypt", use: "dungeon@1", params: { algorithm: "cave" }, mask: { kind: "rect", rect: [20, 20, 80, 70] } }, { id: "dunes", use: "biome@1", params: { biome: "desert" }, mask: { kind: "circle", at: [-40, -40], r: 30 } }] });
  const A = createWorldStream(inf), B = createWorldStream(inf);
  const order = [[0, 0], [1, 1], [2, 1], [-2, -2], [-1, -1], [1, 2]] as const;
  const a = order.map(([x, z]) => A.chunk(x, z));
  const b = [...order].reverse().map(([x, z]) => B.chunk(x, z)).reverse();
  a.forEach((c, n) => assert.equal(hashLayers(c.layers, c.layers.i0, c.layers.j0, c.layers.i0 + 36, c.layers.j0 + 36), hashLayers(b[n]!.layers, c.layers.i0, c.layers.j0, c.layers.i0 + 36, c.layers.j0 + 36), `chunk ${order[n]}`));
  // The dungeon reaches chunk (1, 1): its walls are there; the desert re-skin reaches (-2, -2) with its heights kept.
  const c11 = a[1]!;
  assert.ok([...c11.layers.type].some((t) => t === A.types.id("brick") || t === A.types.id("rock")));
  const plain = createWorldStream(defineRecipe({ seed: "inf-1", width: 0, depth: 0, stages: [{ id: "ground", use: "overworld@1" }] })).chunk(-2, -2);
  const d = a[3]!.layers;
  let kept = 0, skinned = 0;
  for (let k = 0; k < d.w * d.d; k += 1) { if (d.height[k] === plain.layers.height[k]) kept += 1; if (A.table.list[d.biome[k]!]!.id === "desert") skinned += 1; }
  assert.equal(kept, d.w * d.d, "a re-skin keeps the shape");
  assert.ok(skinned > 100, `${skinned} tiles re-skinned`);
  // The same tiles as a finite run over the same rectangle.
  const fin = runPipeline({ ...inf, width: 100, depth: 100 });
  const c0 = a[0]!.layers;
  for (let j = 2; j < 34; j += 1) for (let i = 2; i < 34; i += 1) {
    const wi = c0.i0 + i, wj = c0.j0 + j;
    assert.equal(c0.height[j * c0.w + i], fin.height[wj * 100 + wi], `${wi},${wj}`);
  }
});

test("scatter: chunk independent, blue noise per layer, nothing on roads, water or paving; forests' cores older", () => {
  const S = createWorldStream(defineRecipe({ seed: "plants", width: 0, depth: 0, stages: [{ id: "ground", use: "overworld@1", params: { land: 0.9, scale: 0.4, biomes: ["forest", "plains", "ocean", "beach", "river"] } }] }));
  const opts = { seed: "plants", table: S.table, types: S.types };
  const B = S.block(-6, -6, 76, 44);
  const whole = scatterIn(B, [0, 0, 128, 64], opts);
  const left = scatterIn(S.block(-6, -6, 44, 44), [0, 0, 64, 64], opts), right = scatterIn(S.block(26, -6, 44, 44), [64, 0, 128, 64], opts);
  const key = (p: { layer: string; x: number; z: number; object: string }): string => `${p.layer}|${p.x.toFixed(4)}|${p.z.toFixed(4)}|${p.object}`;
  assert.deepEqual(new Set([...left, ...right].map(key)), new Set(whole.map(key)), "two chunks = one block");
  assert.ok(whole.length > 400, `${whole.length} plants`);
  for (const layer of ["canopy", "grass"] as const) {
    const mine = whole.filter((p) => p.layer === layer);
    const r = layer === "canopy" ? 3.4 : 0.62;
    for (let a = 0; a < mine.length; a += 1) for (let b = a + 1; b < Math.min(mine.length, a + 400); b += 1) assert.ok(Math.hypot(mine[a]!.x - mine[b]!.x, mine[a]!.z - mine[b]!.z) >= r * 0.999, `${layer} too close`);
  }
  for (const p of whole) {
    const k = (Math.floor(p.z / 2) - B.j0) * B.w + Math.floor(p.x / 2) - B.i0;
    assert.ok(B.water[k] === WATER_NONE || B.water[k]! <= B.height[k]!, "not in water");
    assert.ok(!(B.flags[k]! & (FLAG.RAMP | FLAG.BLOCKED)), "not on ramps or buildings");
    assert.ok(!["road", "path", "flagstone", "brick"].includes(S.types.get(B.type[k]!).name), "not on paving");
  }
});

test("codec: recipes, biome tables, tilesets and room templates round-trip exactly", () => {
  const bytes = encodeRecipe(MIXED);
  assert.deepEqual(decodeRecipe(bytes), JSON.parse(JSON.stringify(MIXED)));
  console.log(`# the mixed recipe packs to ${bytes.length} bytes (its ${144 * 112} tiles are never stored)`);
  assert.ok(bytes.length < 400);
  const biomes = encodeBiomes(DEFAULT_BIOMES);
  assert.deepEqual(decodeBiomes(biomes), JSON.parse(JSON.stringify(DEFAULT_BIOMES)));
  console.log(`# the engine's ${DEFAULT_BIOMES.length} biomes pack to ${biomes.length} bytes`);
  const ts = { id: "meadow", layout: "rpgmaker-a2" as const, tile: 16, materials: [{ type: "grass", at: [0, 0] as const }, { type: "dirt", at: [2, 0] as const, variants: 2 }] };
  assert.deepEqual(decodeTileset(encodeTileset(ts)), JSON.parse(JSON.stringify(ts)));
  assert.deepEqual(decodeRooms(encodeRooms(ROOM_TEMPLATES)), JSON.parse(JSON.stringify(ROOM_TEMPLATES)));
  // A decoded recipe builds the same world.
  assert.equal(hashLayers(runPipeline(decodeRecipe(bytes)), 0, 0, 144, 112), hashLayers(runPipeline(MIXED), 0, 0, 144, 112));
});

test("packs: a world pack ships biomes, rooms and tilesets as contracts the registry resolves", async () => {
  const mire = defineWorldPack({
    id: "packs/bogs", version: "1.0.0",
    biomes: [{ id: "mire", climate: { temperature: 0.3, humidity: 1.3 }, ground: [{ type: "mud", weight: 0.7 }, { type: "moss", weight: 0.3 }], foliage: [], surface: { tint: { hue: 30 } } }],
    rooms: [{ id: "bog-hut", roles: ["room"], rows: ["##D##", "#...#", "D.~.D", "#...#", "##D##"] }],
    tilesets: [{ id: "bog-tiles", layout: "blob47", tile: 16, materials: [{ type: "mud", at: [0, 0] }] }],
  });
  assert.deepEqual(mire.contracts(), ["biome/mire@1.0.0", "tileset/bog-tiles@1.0.0", "rooms/bogs@1.0.0"]);
  const eng = createEngine();
  eng.define(manifest, () => ({}));
  for (const id of manifest.needs.map((n) => n.split("@")[0]!)) eng.define(defineManifest({ id, version: "0.1.0", kind: "runtime" }), () => ({}));
  eng.define(worldPackManifest(mire), () => mire);
  eng.define(defineManifest({ id: "games/swamp", version: "0.1.0", kind: "game", needs: ["contract:biome/mire@^1"] }), () => ({}));
  const r = eng.resolve();
  assert.equal(r.ok, true, r.problems.map((p) => p.detail).join("; "));
  // The pack's biome and room join the engine's.
  const W = worldOptions([mire]);
  assert.ok(createBiomeTable(W.biomes).has("mire"));
  assert.ok(W.templates.some((t) => t.id === "bog-hut"));
  const map = runPipeline(defineRecipe({ seed: "bog", width: 64, depth: 64, stages: [{ id: "g", use: "overworld@1", params: { only: "mire", land: 1 } }] }), W);
  const table = createBiomeTable(W.biomes);
  assert.ok([...map.biome].some((b) => table.list[b]!.id === "mire"));
  assert.throws(() => defineWorldPack({ id: "packs/x", version: "1.0.0", rooms: [{ id: "bad", roles: ["room"], rows: ["###", "#.#", "###"] }] }), /door/);
  // A pack's own stage kind.
  defineStage({ id: "flood-test", version: "1.0.0", local: true, describe: "floods everything", run(ctx) { ctx.map.water.fill(9); } });
  assert.throws(() => defineStage({ id: "flood-test", version: "1.2.0", local: true, describe: "", run() {} }), /twice/);
});

test("levels: a recipe as a level's ground (bases, ramps, roads over it), and a level straight from a recipe", () => {
  const recipe: WorldRecipe = defineRecipe({ seed: "lvl", width: 96, depth: 96, stages: [{ id: "ground", use: "overworld@1", params: { land: 0.7, scale: 0.3, biomes: ["plains", "forest", "savanna"] } }] });
  const { level, map } = generateWorldLevel(recipe, { players: 2 });
  assert.equal(level.spawns.length, 2);
  assert.equal(level.meta["world"], levelWorld(recipe).key);
  assert.ok(typeof level.meta["recipe"] === "string");
  assert.equal(map.w, 96);
  const f = fairness(level);
  assert.ok(f.players.length === 2);
  // Every main reaches the other (the level's ramps joined the world's plateaus).
  assert.ok(f.players.every((p) => Number.isFinite(p.toEnemy)), "mains reach each other");
  // No players: the map as a level (a dungeon floor), its things as the level's.
  const floor = generateWorldLevel(interiorRecipe({ id: "entrance@1,2#0", data: { seed: "123", rooms: 9 } }, { act: "act1" }));
  assert.ok(floor.level.markers.some((m) => m.kind === "start") && floor.level.markers.some((m) => m.kind === "exit"));
  assert.ok([...floor.level.terrain.type].includes(floor.level.terrain.types.id("brick")) || [...floor.level.terrain.type].includes(floor.level.terrain.types.id("rock")));
});

test("level@1: keel/level's templates as a stage in a bigger world", () => {
  const m = runPipeline(defineRecipe({ seed: "tmpl", width: 128, depth: 96, stages: [{ id: "ground", use: "overworld@1", params: { land: 0.8 } }, { id: "vale", use: "level@1", params: { template: "valley", biome: "temperate", towns: 1 }, mask: { kind: "rect", rect: [32, 16, 96, 80] } }] }));
  assert.equal(m.meta["vale.template"], "valley");
  // The template wrote its own ground inside the rectangle (its valley's types), the overworld kept the rest.
  const plain = runPipeline(defineRecipe({ seed: "tmpl", width: 128, depth: 96, stages: [{ id: "ground", use: "overworld@1", params: { land: 0.8 } }] }));
  let inside = 0, outside = 0;
  for (let j = 0; j < 96; j += 1) for (let i = 0; i < 128; i += 1) {
    const k = j * 128 + i, diff = m.height[k] !== plain.height[k] || m.type[k] !== plain.type[k];
    if (i >= 32 && i < 96 && j >= 16 && j < 80) { if (diff) inside += 1; } else if (diff) outside += 1;
  }
  assert.ok(inside > 1000, `${inside} tiles from the template`);
  assert.equal(outside, 0);
});
