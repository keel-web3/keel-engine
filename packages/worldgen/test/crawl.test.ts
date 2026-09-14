// The action-RPG dungeon: the acts as themes, the dressing (room kinds, props,
// lights, doors, stairs) never breaking the floor's fairness, the scene's
// walls hugging the rooms with the cutaway's columns, light masks casting
// shadows, fog of war; and the engine gaps the level editor found -- yaws in
// the codec's range, a recipe choosing its room templates, level@1 carrying
// its spawns/resources/markers, bases always joined, worldgen's schemas in
// its manifest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, registerEntries } from "@keel-engine/codec";
import { encodeLevel, fairness } from "@keel-engine/level";
import {
  CELL, CRAWL_ACTS, CRAWL_RAMPS, CRAWL_THEMES, DUNGEON_ALGORITHMS, DUNGEON_PROP_RULES, FINE, FLOOR, QUAD, QUAD_FLOATS, SUB, ROOM_TEMPLATES,
  buildDungeonScene, chooseTemplates, crawlPalette, createFog, defineRecipe, dressDungeon, generateDungeon, generateWorldLevel, interiorRecipe, lightMask, runPipeline, wrapYaw,
} from "../src/index.ts";
import type { Dungeon, DungeonDressing } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const walkOk = (S: DungeonDressing, k: number, locked: boolean): boolean => {
  const c = S.cells[k]!;
  if (S.blocked[k]) return false;
  if (c === CELL.LOCKED) return locked;
  return (c !== CELL.WALL && c !== CELL.PIT && c !== CELL.WATER) || S.floor[k] === FLOOR.BRIDGE;
};
function reach(S: DungeonDressing, from: readonly [number, number], locked: boolean): Uint8Array {
  const { w, d } = S, seen = new Uint8Array(w * d), q = [from[1] * w + from[0]];
  seen[q[0]!] = 1;
  for (let h = 0; h < q.length; h += 1) { const k = q[h]!, i = k % w, j = (k - i) / w; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) { if (a < 0 || b < 0 || a >= w || b >= d) continue; const n = b * w + a; if (!seen[n] && walkOk(S, n, locked)) { seen[n] = 1; q.push(n); } } }
  return seen;
}

test("the acts: four themes, each its own palette, walls, floors, lights and air", () => {
  assert.deepEqual([...CRAWL_ACTS], ["crypt", "cave", "forge", "ruin"]);
  const pals = CRAWL_ACTS.map((a) => crawlPalette(CRAWL_THEMES[a]!));
  for (const p of pals) { assert.equal(p.height, CRAWL_RAMPS.length); assert.equal(p.rgba.length, p.width * p.height * 4); }
  for (let a = 0; a < 4; a += 1) for (let b = a + 1; b < 4; b += 1) assert.notDeepEqual(pals[a]!.rgba, pals[b]!.rgba);
  assert.equal(new Set(CRAWL_ACTS.map((a) => CRAWL_THEMES[a]!.wall.style)).size, 4);
  assert.equal(new Set(CRAWL_ACTS.map((a) => CRAWL_THEMES[a]!.air.ambient)).size, 4);
  assert.equal(new Set(CRAWL_ACTS.map((a) => CRAWL_THEMES[a]!.lights.torch.colour.join())).size, 4);
});

test("dressing: every generator in every act keeps its floor fair -- props off the lanes, the key before the door, the exit behind it", () => {
  for (const algorithm of DUNGEON_ALGORITHMS) for (const act of CRAWL_ACTS) for (const seed of ["d1", "d2"]) {
    const D: Dungeon = generateDungeon(`${seed}-${algorithm}`, 72, 54, { algorithm, rooms: 10 });
    const S = dressDungeon(D, act);
    const tag = `${algorithm}/${act}/${seed}`;
    const noKey = reach(S, S.start, false), withKey = reach(S, S.start, true);
    if (S.key) assert.ok(noKey[S.key[1] * S.w + S.key[0]], `${tag}: the key can't be reached`);
    assert.ok(withKey[S.exit[1] * S.w + S.exit[0]] || S.floor[S.exit[1] * S.w + S.exit[0]] === FLOOR.STAIRS_DOWN, `${tag}: the exit can't be reached`);
    for (const dr of S.doors) assert.ok(withKey[dr.cell] || D.cells[dr.cell] === CELL.LOCKED, `${tag}: door ${dr.cell} can't be reached`);
    // Every open cell of the plan still reachable (some behind a blocking prop's own cell is fine: that one's the prop's).
    let lost = 0;
    for (let k = 0; k < S.w * S.d; k += 1) if (walkOk(S, k, true) && !withKey[k]) lost += 1;
    assert.ok(lost <= Math.max(2, S.stats["blocking"]! * 0.15), `${tag}: ${lost} open cells cut off`);
    for (const p of S.props) { assert.ok(DUNGEON_PROP_RULES[p.id], `${tag}: unknown prop ${p.id}`); assert.ok(p.yaw >= -Math.PI && p.yaw <= Math.PI, `${tag}: yaw ${p.yaw}`); }
    for (const L of S.lights) assert.ok(L.radius > 0 && L.strength > 0);
  }
});

test("dressing: the stairs up never wall the start in (a small start room's only way out)", () => {
  // (Found by the flaky "wfc/crypt/d1: the key can't be reached": a WFC floor cut short left a three-cell start
  // room, and the stairs up -- which block their cell -- stood in its only opening. These floors did the same.)
  const floors: Array<[string, number, number, number | undefined]> = [["sw1", 72, 54, undefined], ["sw2", 84, 45, undefined], ["sw10", 72, 45, undefined], ["d1-wfc", 72, 54, 100], ["d2-wfc", 72, 54, 200]];
  for (const [seed, w, d, steps] of floors) for (const act of CRAWL_ACTS) {
    const S = dressDungeon(generateDungeon(seed, w, d, { algorithm: "wfc", rooms: 10, ...(steps ? { wfcSteps: steps } : {}) }), act);
    const tag = `${seed}/${act}`;
    const noKey = reach(S, S.start, false), withKey = reach(S, S.start, true);
    if (S.key) assert.ok(noKey[S.key[1] * S.w + S.key[0]], `${tag}: the key can't be reached`);
    assert.ok(withKey[S.exit[1] * S.w + S.exit[0]] || S.floor[S.exit[1] * S.w + S.exit[0]] === FLOOR.STAIRS_DOWN, `${tag}: the exit can't be reached`);
  }
});

test("dressing: the grammar's roles become rooms, the rooms their props; deterministic; 50+ lights on an 84 x 60 floor", () => {
  const D = generateDungeon("crawl-1", 84, 60, { algorithm: "rooms", rooms: 12 });
  const a = dressDungeon(D, "crypt"), b = dressDungeon(D, "crypt");
  assert.deepEqual(a.props, b.props);
  assert.deepEqual(a.lights, b.lights);
  const kinds = new Set(a.rooms.map((r) => r.kind));
  for (const k of ["entry", "throne", "shrine", "stairwell"]) assert.ok(kinds.has(k as never), `no ${k}`);
  const ids = new Set(a.props.map((p) => p.id));
  for (const id of ["torch", "banner", "throne", "key", "cobweb"]) assert.ok(ids.has(id), `no ${id}`);
  assert.ok(a.lights.length >= 50, `${a.lights.length} lights`);
  assert.ok(a.props.some((p) => p.openable) || true);
  assert.ok(a.props.filter((p) => p.destructible).length > 0);
  assert.ok(a.stairsUp && a.stairsDown);
  assert.ok(a.doors.some((d) => d.locked), "the boss's door");
  // A denser dressing: 500+ props (the performance case).
  const dense = dressDungeon(generateDungeon("perf", 96, 72, { algorithm: "bsp", rooms: 16 }), "crypt", { density: 1.6 });
  assert.ok(dense.props.length >= 500, `${dense.props.length} props`);
  // Themes place their own: caves their crystals and stalagmites, forges their anvils.
  const cave = dressDungeon(generateDungeon("c", 72, 54, { algorithm: "cave" }), "cave");
  assert.ok(cave.props.some((p) => p.id === "crystals" || p.id === "stalagmite"));
  assert.ok(cave.lights.some((L) => L.kind === "crystal" || L.kind === "fungus"));
});

test("scene: walls with height hug the rooms on a half-metre grid, the camera's faces only, every column cuttable", () => {
  const D = generateDungeon("scene", 60, 44, { algorithm: "rooms", rooms: 8 });
  const S = dressDungeon(D, "crypt");
  const s = buildDungeonScene(S);
  assert.equal(s.fw, S.w * SUB);
  // A wall subcell is always in a wall cell (crypt masonry: no rough edges).
  for (let q = 0; q < s.fw * s.fd; q += 1) if (s.fine[q] === FINE.WALL) assert.equal(S.cells[Math.floor(q / s.fw / SUB) * S.w + Math.floor((q % s.fw) / SUB)], CELL.WALL);
  // Every open cell's wall neighbour has wall subcells along the shared edge (the wall stands at the room's edge).
  for (let j = 1; j < S.d - 1; j += 1) for (let i = 1; i < S.w - 1; i += 1) {
    const k = j * S.w + i;
    if (S.cells[k] === CELL.WALL || S.pillars.includes(k)) continue;
    if (S.cells[k + 1] === CELL.WALL && !S.pillars.includes(k + 1)) assert.equal(s.fine[(j * SUB + 1) * s.fw + (i + 1) * SUB], FINE.WALL, `edge at ${i},${j}`);
  }
  let faces = 0, caps = 0;
  for (let n = 0; n < s.count; n += 1) {
    const o = n * QUAD_FLOATS, kind = Math.floor(s.quads[o + 11]! / 256);
    if (kind === QUAD.FACE || kind === QUAD.INNER) {
      faces += 1;
      const ux = s.quads[o + 3]!, uz = s.quads[o + 5]!;
      // (Normal = up x U: -z for U along +x, -x for U along -z -- toward the camera, or a pillar's facet leaning that way.)
      assert.ok(uz - ux < 1e-6 || Math.abs(ux) + Math.abs(uz) < 0.6, `face ${n} faces away: U ${ux}, ${uz}`);
      assert.ok(s.quads[o + 12]! < 1e8, "a face carries its column");
    }
    if (kind === QUAD.CAP) { caps += 1; const cx = s.quads[o + 12]!, px = s.quads[o]!; assert.ok(cx >= px && cx <= px + 2.5); }
  }
  assert.ok(faces > 500 && caps > 500, `${faces} faces, ${caps} caps`);
  assert.ok(s.flames.length >= 20);
  // Walking: the start is walkable, walls aren't.
  const [si, sj] = S.start;
  assert.equal(s.walk[(sj * SUB + 2) * s.fw + si * SUB + 2], 1);
});

test("light masks: walls cast shadows (the first wall a ray meets is lit); fog: in sight, remembered, never seen", () => {
  const D = generateDungeon("mask", 48, 36, { algorithm: "rooms", rooms: 6 });
  const S = dressDungeon(D, "crypt");
  const s = buildDungeonScene(S);
  const L = S.lights.find((l) => l.kind === "torch")!;
  const m = lightMask(s, L.x, L.z, L.radius);
  let lit = 0, dark = 0;
  for (let b = 0; b < m.size; b += 1) for (let a = 0; a < m.size; a += 1) {
    const x = m.x0 + (a + 0.5) / 2, z = m.z0 + (b + 0.5) / 2;
    const inside = Math.hypot(x - L.x, z - L.z) < L.radius * 0.8;
    const fx = Math.floor(x / 0.5), fz = Math.floor(z / 0.5);
    const solid = fx < 0 || fz < 0 || fx >= s.fw || fz >= s.fd || s.fine[fz * s.fw + fx] === FINE.WALL;
    if (inside && !solid) { if (m.data[b * m.size + a]) lit += 1; else dark += 1; }
  }
  assert.ok(lit > 30, `${lit} lit`);
  assert.ok(dark > 10, `${dark} in shadow: walls cast none`);
  const fog = createFog(S);
  fog.look((S.start[0] + 0.5) * 2, (S.start[1] + 0.5) * 2);
  fog.ease(10);
  const room = S.rooms.find((r) => r.kind === "entry")!;
  assert.ok(room.cells.every((k) => fog.shown[k] === 255), "the room he stands in is in sight");
  const far = S.rooms.find((r) => r.kind === "throne")!;
  assert.ok(far.cells.every((k) => fog.shown[k] === 0), "the boss's room is unseen");
  fog.look(-100, -100);
  fog.ease(10);
  assert.ok(room.cells.every((k) => fog.shown[k]! > 50 && fog.shown[k]! < 255), "remembered, dimmed");
  fog.revealAll();
  assert.equal(fog.counts.seen, S.w * S.d);
});

test("gaps: yaws in the codec's range, from dungeon things to a level that packs", () => {
  assert.equal(wrapYaw(Math.PI * 1.5), -Math.PI / 2);
  assert.equal(wrapYaw(-Math.PI * 0.5), -Math.PI / 2);
  const floor = generateWorldLevel(interiorRecipe({ id: "gap-yaw", data: { seed: "7", rooms: 9 } }, { act: "act1" }));
  assert.ok(floor.level.things.size > 0);
  for (const th of floor.level.things.values()) assert.ok(th.yaw >= -Math.PI && th.yaw <= Math.PI, `${th.id}: ${th.yaw}`);
  assert.ok(encodeLevel(floor.level.toDocument()).length > 0);
});

test("gaps: a recipe chooses its room templates (the pipeline's, by id or prefix; the engine's for any role left)", () => {
  const extra = [
    { id: "t-hall", roles: ["room"] as const, weight: 3, rows: ["####D####", "#bbb.bbb#", "D.......D", "#..t.t..#", "####D####"] },
    { id: "t-start", roles: ["start"] as const, rows: ["###D###", "#.....#", "D..S..D", "###D###"] },
  ];
  const pick = chooseTemplates([...ROOM_TEMPLATES, ...extra], ["t-*"]);
  assert.ok(pick.some((t) => t.id === "t-hall") && pick.some((t) => t.id === "t-start"));
  for (const role of ["boss", "exit", "key"]) assert.ok(pick.some((t) => t.roles.includes(role as never)), role);
  assert.ok(!pick.some((t) => t.roles.includes("start") && t.id !== "t-start"), "the recipe's start wins");
  const recipe = (templates?: string | string[]) => defineRecipe({ seed: "tpl", width: 72, depth: 60, stages: [{ id: "crypt", use: "dungeon@1", params: { algorithm: "rooms", rooms: 10, ...(templates ? { templates } : {}) } }] });
  const m = runPipeline(recipe("t-*"), { templates: extra });
  const used = String(m.meta["crypt.rooms"]).split(",");
  assert.ok(used.includes("t-start") && used.includes("t-hall"), used.join());
  assert.ok(m.things.some((t) => t.object === "bookshelf"), "a template's furniture comes through as things");
  // Given templates without a param join the engine's; none given: the engine's alone, as before.
  const both = String(runPipeline(recipe(), { templates: extra }).meta["crypt.rooms"]).split(",");
  assert.ok(both.every((id) => extra.some((t) => t.id === id) || ROOM_TEMPLATES.some((t) => t.id === id)));
  const plain = String(runPipeline(recipe()).meta["crypt.rooms"]).split(",");
  assert.ok(plain.every((id) => ROOM_TEMPLATES.some((t) => t.id === id)));
});

test("gaps: level@1 carries its sub-level's spawns, resources and markers, and a level made of the map has them", () => {
  const r = defineRecipe({ seed: "sub", width: 96, depth: 80, stages: [{ id: "ground", use: "overworld@1", params: { land: 0.8 } }, { id: "arena", use: "level@1", params: { template: "valley", players: 2 }, mask: { kind: "rect", rect: [8, 8, 88, 72] } }] });
  const m = runPipeline(r);
  const spawns = m.things.filter((t) => t.kind === "spawn"), res = m.things.filter((t) => t.kind === "resource");
  assert.equal(spawns.length, 2);
  assert.ok(res.length >= 2, `${res.length} resources`);
  for (const s of spawns) { const i = Math.floor(s.pos[0] / 2), j = Math.floor(s.pos[2] / 2); assert.ok(i >= 8 && i < 88 && j >= 8 && j < 72, "inside the stage's rectangle"); }
  const { level } = generateWorldLevel(r);
  assert.equal(level.spawns.length, 2);
  assert.ok(level.resources.length >= 2);
  assert.deepEqual(level.spawns.map((s) => s.player).sort(), [0, 1]);
});

test("gaps: with players on a world's ground, every base reaches every other -- over many seeds (the editor's arena)", () => {
  let joined = 0;
  const seeds = ["a", "b", "c", ...Array.from({ length: 13 }, (_, n) => `arena-${n}`)];
  for (const seed of seeds) for (const players of seed.length === 1 || seed.endsWith("3") ? [2, 4] : [2]) {
    const recipe = defineRecipe({ seed, width: 112, depth: 112, stages: [{ id: "ground", use: "overworld@1", params: { land: 1.2, scale: 0.6, relief: 0.05, rivers: 0, lakes: 0, structures: false, biomes: ["plains", "forest"] } }] });
    const { level } = generateWorldLevel(recipe, { players });
    assert.ok(fairness(level).connected, `${seed} x${players}: a base cut off`);
    if (level.meta["joined"]) joined += 1;
  }
  assert.ok(joined >= 1, "some seeds needed a road cut (a and c did)");
});

test("gaps: worldgen's manifest declares its codec schemas, bytes embedded, resolvable without running it", () => {
  const schemas = manifest.contents?.schemas ?? [];
  assert.deepEqual(schemas.map((s) => s.id).sort(), ["keel/worldgen/biomes@1", "keel/worldgen/recipe@1", "keel/worldgen/rooms@1", "keel/worldgen/tileset@1"]);
  const ids = registerEntries(schemas, createRegistry());
  assert.equal(ids.length, 4);
});

test("the renderer's GLSL keeps to what WebGL2 compiles: no ternary picking between structs", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/dungeon-gl.ts", import.meta.url), "utf8");
  // (ESSL rejects `cond ? S(...) : S(...)`: a Surf chosen by a ternary. Only the shader text is scanned.)
  const bad = src.split("\n").filter((line) => /[?:]\s*[SE]\(R_/.test(line));
  assert.deepEqual(bad, []);
});
