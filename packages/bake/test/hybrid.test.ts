// Hybrid records: a population stored as its recipe, its look re-rolls, pins
// per unit and layer, and explicit parts -- and everything regenerated from
// that is the batch's population exactly: all of it, or any one unit alone.
// The army's 10,000 units (test/cast.ts) are the proof, with a voxel hero
// from the builder wearing seeded wearables, and the size table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { lookDistance } from "@keel-engine/core";
import { voxelBodyReader } from "@keel-engine/builder";
import { HYBRID_POPULATION, POPULATION, encode, populationRecordOf, toJSON, fromJSON } from "@keel-engine/codec";
import { IDLE_STYLES, OBJECT_PART, paintSlots, populate, populationOf, readRecord, recordBytes, recordOf, recordPrefix, unitFrame, unitOf } from "../src/index.ts";
import type { Population, UnitExplicit, UnitPins } from "../src/index.ts";
import { ARMY, armyOptions, crownDoc, voxelHero } from "./cast.ts";

const env = { generators: [ARMY] };
const ms = (t0: number): string => `${(performance.now() - t0).toFixed(0)} ms`;
/** Everything a unit is, as one string: its signature says body, coverage, looks, wears; its animation beside it. */
const whole = (u: { readonly signature: string; readonly anim: unknown }): string => `${u.signature}#${JSON.stringify(u.anim)}`;

let army: Population | null = null;
const army10k = (): Population => (army ??= populate(armyOptions("1", 10000)));

test("10,000 units from a recipe: the record regenerates the batch exactly, any unit alone is the batch's unit, all distinct", () => {
  let t0 = performance.now();
  const pop = army10k();
  const batchMs = ms(t0);
  t0 = performance.now();
  const rec = recordOf(pop);
  const bytes = recordBytes(rec);
  assert.ok(rec.exceptions.length < pop.units.length * 0.2, `${rec.exceptions.length} units re-rolled a look: sparse`);
  assert.deepEqual(readRecord(bytes), rec);
  // The whole population from the record: no look pool, the same units.
  t0 = performance.now();
  const again = populationOf(bytes, env);
  const againMs = ms(t0);
  assert.equal(again.units.length, 10000);
  again.units.forEach((u, i) => assert.equal(whole(u), whole(pop.units[i]!), `unit ${i}`));
  assert.deepEqual(again.units[4711]!.look, pop.units[4711]!.look);
  assert.deepEqual(again.bodies.map((b) => b.key), pop.bodies.map((b) => b.key));
  assert.deepEqual(again.attributes.map((a) => a.key), pop.attributes.map((a) => a.key));
  // Every unit alone: derived from (the cast, the seed, i) and its exceptions -- nothing else.
  t0 = performance.now();
  for (let i = 0; i < 10000; i += 1) {
    const u = unitOf(bytes, i, env);
    assert.equal(whole(u), whole(pop.units[i]!), `unit ${i} alone`);
  }
  const aloneMs = ms(t0);
  const lone = unitOf(bytes, 9999, env);
  assert.deepEqual(lone.look, pop.units[9999]!.look);
  assert.deepEqual(lone.wears.map((w) => w.shape.key), pop.units[9999]!.wears.map((w) => pop.attributes[w.shape]!.key));
  // All distinct, and visibly: two of one kind in one coverage at least the threshold apart.
  assert.equal(new Set(pop.units.map((u) => u.signature)).size, 10000);
  const groups = new Map<string, Population["units"][number][]>();
  for (const u of pop.units) { const g = `${u.entity}|${JSON.stringify(Object.entries(u.coverage).sort())}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(u); }
  let closest = Infinity;
  for (const us of groups.values()) for (let i = 0; i < us.length; i += 1) for (let j = i + 1; j < us.length; j += 1) closest = Math.min(closest, lookDistance(us[i]!.look, us[j]!.look));
  assert.ok(closest >= 0.08, `closest ${closest}`);
  assert.equal(pop.stats.failures, 0);
  console.log(`  10,000 units: batch ${batchMs}, from the record ${againMs}, each alone ${aloneMs} for all; ${rec.exceptions.length} units with re-rolls (${pop.stats.rerolls} body looks, ${pop.stats.attributeRerolls} worn), closest pair ${closest.toFixed(3)}`);
});

test("the animation layer: speed, stride, idle style and phase per unit, on their own stream; frames follow them", () => {
  const pop = army10k();
  const speeds = new Set(pop.units.map((u) => u.anim.speed));
  assert.ok(speeds.size > 20, `${speeds.size} speeds`);
  for (const u of pop.units) {
    assert.ok(u.anim.speed >= 0.88 && u.anim.speed <= 1.12 && u.anim.stride >= 0.9 && u.anim.stride <= 1.1);
    assert.ok(u.anim.idle >= 0 && u.anim.idle < IDLE_STYLES.length && u.anim.phase >= 0 && u.anim.phase < 1);
  }
  assert.equal(new Set(pop.units.map((u) => u.anim.idle)).size, IDLE_STYLES.length);
  const body = pop.bodies[pop.units[0]!.body]!;
  const idle = body.clip("idle"), walk = body.clip("walk");
  // Two units at the same moment, idle: their own phases; walking the same distance: their own strides.
  const a = { speed: 1, stride: 1, idle: 0, phase: 0 }, b = { speed: 1, stride: 1.1, idle: 1, phase: 0.5 };
  assert.notEqual(unitFrame(idle, a, 0, 1), unitFrame(idle, b, 0, 1));
  const at = walk.cycle * 0.95; // (7.6 frames in at a stride of 1; 6.9 at 1.1)
  assert.notEqual(unitFrame(walk, a, at, 0), unitFrame(walk, b, at, 0));
});

test("pins per layer: a pin on one layer never reshuffles another, and other units keep their shapes and moves", () => {
  const base = populate(armyOptions("2", 2000));
  const u = base.units;
  // An entity other than unit 40's own.
  const other = base.entities.findIndex((_, i) => i !== u[40]!.entity && base.entities[i]!.def.body === base.entities[u[40]!.entity]!.def.body);
  const pins = new Map<number, UnitPins>([
    [10, { anim: { speed: 1.5, idle: 3 } }],
    [20, { wear: [] }],
    [30, { look: { profile: "neon", "cloth.hue": 200 } }],
    [40, { body: { entity: base.entities[other]!.def.id } }],
  ]);
  const pinned = populate(armyOptions("2", 2000, { pins }));
  const p = pinned.units;
  const shapeOf = (pop: Population, i: number) => JSON.stringify([pop.units[i]!.entity, pop.bodies[pop.units[i]!.body]!.key, pop.units[i]!.coverage]);
  const wearsOf = (pop: Population, i: number) => pop.units[i]!.wears.map((w) => pop.attributes[w.shape]!.key).join(",");
  // Animation: only the animation.
  assert.deepEqual(p[10]!.anim, { ...u[10]!.anim, speed: 1.5, idle: 3 });
  assert.equal(shapeOf(pinned, 10), shapeOf(base, 10));
  assert.equal(wearsOf(pinned, 10), wearsOf(base, 10));
  assert.equal(p[10]!.look.signature, u[10]!.look.signature);
  // Wear: nothing worn; body, look and moves as they were.
  assert.equal(p[20]!.wears.length, 0);
  assert.equal(shapeOf(pinned, 20), shapeOf(base, 20));
  assert.deepEqual(p[20]!.anim, u[20]!.anim);
  assert.equal(p[20]!.look.signature, u[20]!.look.signature);
  // Look: pinned where pinned; its shapes, wears and moves as they were.
  assert.equal(p[30]!.look.profile, "neon");
  assert.equal(p[30]!.look.roles.cloth?.hue, 200);
  assert.equal(shapeOf(pinned, 30), shapeOf(base, 30));
  assert.equal(wearsOf(pinned, 30), wearsOf(base, 30));
  assert.deepEqual(p[30]!.anim, u[30]!.anim);
  // Body: another entity; its moves as they were.
  assert.equal(p[40]!.entity, other);
  assert.deepEqual(p[40]!.anim, u[40]!.anim);
  // Everyone else: the same shapes, wears and moves (looks may re-roll round a pinned one: the pools are the batch's).
  let looksMoved = 0;
  for (let i = 0; i < 2000; i += 1) {
    if (pins.has(i)) continue;
    assert.equal(shapeOf(pinned, i), shapeOf(base, i), `unit ${i}`);
    assert.equal(wearsOf(pinned, i), wearsOf(base, i), `unit ${i}`);
    assert.deepEqual(p[i]!.anim, u[i]!.anim);
    if (p[i]!.look.signature !== u[i]!.look.signature) looksMoved += 1;
  }
  assert.ok(looksMoved <= 4, `${looksMoved} other looks moved`);
  // Through a record: the pinned population, whole and unit by unit.
  const bytes = recordBytes(recordOf(pinned));
  const again = populationOf(bytes, env);
  again.units.forEach((x, i) => assert.equal(whole(x), whole(p[i]!), `unit ${i}`));
  for (const i of [10, 20, 30, 40, 41]) assert.equal(whole(unitOf(bytes, i, env)), whole(p[i]!));
  // recordOf(pop, pins) re-runs the batch with them: the same record as the pinned population's.
  assert.deepEqual(recordOf(base, pins), recordOf(pinned));
});

test("an explicit voxel body: a hand-built hero keeps its seeded look, wears seeded things on its own sockets, and walks", () => {
  const hero = voxelHero();
  const crown = OBJECT_PART.wear!(crownDoc(), "head");
  const explicit = new Map<number, UnitExplicit>([[0, { body: hero }], [5, { wears: [crown] }], [7, { body: hero, wears: [crown] }]]);
  const plain = populate(armyOptions("3", 1500));
  const pop = populate(armyOptions("3", 1500, { explicit }));
  const u0 = pop.units[0]!, body = pop.bodies[u0.body]!;
  assert.equal(body.spec, hero.spec, "unit 0's body is the hero's");
  assert.ok(body.key.startsWith("explicit:"));
  assert.deepEqual(u0.anim, plain.units[0]!.anim, "its moves are still drawn");
  assert.equal(u0.entity, plain.units[0]!.entity, "and its entity (whose look it wears)");
  // It wears seeded things, each built to the hero's own sockets.
  assert.ok(u0.wears.length >= 1);
  const rec = body.records(8, 0.6);
  assert.deepEqual([...rec.sockets].sort(), Object.keys(hero.sockets).sort());
  for (const w of u0.wears) assert.ok(hero.sockets[pop.attributes[w.shape]!.socket], `${pop.attributes[w.shape]!.attribute} on the hero's ${pop.attributes[w.shape]!.socket}`);
  // It walks: the walk moves over the ground, its frames differ, its sockets move with it.
  const walk = body.clip("walk");
  assert.ok(walk.speed > 0 && walk.cycle > 0);
  assert.notDeepEqual(body.pose("walk", 0).boxes, body.pose("walk", 4).boxes);
  const head = rec.sockets.indexOf("head");
  const ys = Array.from({ length: walk.frames }, (_, f) => rec.data[rec.at(1, f, 0, head) + 1]!);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.003, "the head bobs");
  // Its look paints it: its slots wear its skin's roles.
  const paint = paintSlots(u0.look, body.slotRoles(u0.coverage));
  assert.ok(paint.filter((x) => x).length >= 4, "several slots painted");
  // The crown sits on unit 5's head (whatever was drawn there went), and on the hero's.
  for (const i of [5, 7]) {
    const onHead = pop.units[i]!.wears.filter((w) => pop.attributes[w.shape]!.socket === "head");
    assert.equal(onHead.length, 1);
    assert.equal(pop.attributes[onHead[0]!.shape]!.attribute, crown.def.id);
  }
  assert.equal(pop.bodies[pop.units[7]!.body]!.spec, hero.spec);
  // Stored: two documents (the hero once), four replaced layers; read back with the builder's reader.
  const record = recordOf(pop);
  assert.equal(record.parts.length, 2);
  assert.deepEqual(record.explicit.map((e) => [e.unit, e.layer]), [[0, "body"], [5, "wear"], [7, "body"], [7, "wear"]]);
  const bytes = recordBytes(record);
  const withVoxels = { generators: [ARMY], parts: [voxelBodyReader()] };
  const again = populationOf(bytes, withVoxels);
  again.units.forEach((x, i) => assert.equal(whole(x), whole(pop.units[i]!), `unit ${i}`));
  for (const i of [0, 5, 7, 8]) assert.equal(whole(unitOf(bytes, i, withVoxels)), whole(pop.units[i]!));
  assert.throws(() => populationOf(bytes, env), /no part reader/);
});

test("one record serves every smaller size: its first n units are the population of n, re-rolls, pins and parts cut to them", () => {
  const hero = voxelHero();
  const crown = OBJECT_PART.wear!(crownDoc(), "head");
  const pins = new Map<number, UnitPins>([[3, { anim: { idle: 1 } }], [900, { wear: [] }]]);
  const explicit = new Map<number, UnitExplicit>([[1, { body: hero }], [700, { wears: [crown] }]]);
  const big = recordOf(populate(armyOptions("5", 1200, { pins, explicit })));
  const cut = recordPrefix(big, 800);
  assert.equal(cut.parts.length, 2);
  assert.equal(recordPrefix(big, 500).parts.length, 1);
  const small = populate(armyOptions("5", 800, { pins: new Map([...pins].filter(([u]) => u < 800)), explicit: new Map([...explicit].filter(([u]) => u < 800)) }));
  assert.deepEqual(cut, recordOf(small), "the same record as the smaller population's own");
  const again = populationOf(recordBytes(cut), { generators: [ARMY], parts: [voxelBodyReader()] });
  again.units.forEach((x, i) => assert.equal(whole(x), whole(small.units[i]!), `unit ${i}`));
  assert.throws(() => recordPrefix(big, 1300), /no first 1300/);
});

test("a record names its generator at exact versions: another version is refused, and no generator is said", () => {
  const bytes = recordBytes(recordOf(populate(armyOptions("4", 50))));
  const newer = { ...ARMY, modules: ARMY.modules.map((m) => m.replace("packs/cloth@1.0.0", "packs/cloth@1.1.0")) };
  assert.throws(() => populationOf(bytes, { generators: [newer] }), /made with .*packs\/cloth@1\.0\.0.*generator is .*packs\/cloth@1\.1\.0/);
  assert.throws(() => populationOf(bytes, {}), /No generator for fixtures\/army@0\.1\.0/);
  // The readable view: the record as JSON and back, the same bytes.
  const rec = readRecord(bytes);
  assert.deepEqual(encode(HYBRID_POPULATION, fromJSON(HYBRID_POPULATION, JSON.parse(JSON.stringify(toJSON(HYBRID_POPULATION, rec))))), bytes);
});

test("sizes: 10,000 units as a recipe, +1% pinned, +a voxel hero -- against the whole POPULATION record and JSON", () => {
  const pop = army10k();
  const kb = (n: number): string => (n >= 10240 ? `${(n / 1024).toFixed(0)} KB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
  const gz = (b: Uint8Array | string): number => gzipSync(typeof b === "string" ? Buffer.from(b) : b, { level: 9 }).length;
  // 1% pinned: every hundredth unit, the layers in turn.
  const kinds = pop.entities.map((e) => e.def.id);
  const pins = new Map<number, UnitPins>();
  for (let i = 0; i < 10000; i += 100) {
    const k = (i / 100) % 5;
    pins.set(i, k === 0 ? { look: { profile: "team", "cloth.hue": (i * 7) % 360 } }
      : k === 1 ? { wear: [{ attribute: "beanie", variant: i % 3 }] }
        : k === 2 ? { anim: { speed: 1.1, idle: 2 } }
          : k === 3 ? { body: { entity: kinds[(i / 100) % kinds.length]!, body: 0 } }
            : { wearLooks: { flag: { "primary.hue": 30 } }, look: { "cloth.light": 0.5 } });
  }
  const pinned = populate({ ...pop.options, pins });
  const hero = voxelHero();
  const heroed = populate({ ...pop.options, pins, explicit: new Map([[0, { body: hero }]]) });
  const rows: [string, Uint8Array, string][] = [];
  const recipeOnly = recordBytes(recordOf(pop));
  const withPins = recordBytes(recordOf(pinned));
  const withHero = recordBytes(recordOf(heroed));
  const fullRec = populationRecordOf(pop.options.seed, pop as never);
  const full = encode(POPULATION, fullRec);
  rows.push(["recipe + re-rolls", recipeOnly, JSON.stringify(toJSON(HYBRID_POPULATION, recordOf(pop)))]);
  rows.push(["+ 1% pinned (100 units, every layer)", withPins, JSON.stringify(toJSON(HYBRID_POPULATION, recordOf(pinned)))]);
  rows.push(["+ 1% pinned + a voxel hero body", withHero, JSON.stringify(toJSON(HYBRID_POPULATION, recordOf(heroed)))]);
  rows.push(["the whole POPULATION record", full, JSON.stringify(fullRec)]);
  console.log("  | 10,000 units | codec | codec+gz | JSON view | JSON+gz |\n  | --- | ---: | ---: | ---: | ---: |");
  for (const [name, b, json] of rows) console.log(`  | ${name} | ${kb(b.length)} | ${kb(gz(b))} | ${kb(Buffer.byteLength(json))} | ${kb(gz(json))} |`);
  // KEEL's slug is 23 KB: the pinned record with its hero fits many times over.
  assert.ok(withHero.length < 23 * 1024 / 2 && gz(withHero) < 23 * 1024 / 2, `${withHero.length} B`);
  assert.ok(recipeOnly.length * 100 < full.length);
  // And it's the pinned, heroed population.
  const again = populationOf(withHero, { generators: [ARMY], parts: [voxelBodyReader()] });
  for (const i of [0, 100, 200, 300, 400, 500, 4711, 9999]) assert.equal(whole(again.units[i]!), whole(heroed.units[i]!));
});
