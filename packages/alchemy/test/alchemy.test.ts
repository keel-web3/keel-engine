// keel/alchemy: expressions are pure and bounded; a program is read through its
// contract (the unknown dropped, the too-far pulled back, the over-budget scaled
// down -- drawbacks earning budget back -- the same reading every time); a sheet
// lays programs in a fixed order and fires triggers; the matrix asks each cell
// once and keeps it; the relay queue speaks the bridge's claim/result protocol.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExpr, createMatrix, createRelayQueue, createSheet, defineContract, evalExpr, jsonFromText, memoryStore, readProgram, relayOracle, seededOracle } from "../src/index.ts";
import type { Oracle } from "../src/index.ts";

const C = defineContract({
  id: "test", version: 1,
  stats: {
    hp: { min: 0, max: 999, base: 0, worth: 1, reach: 20, pool: true, text: "health (a pool)" },
    maxHp: { min: 10, max: 500, base: 100, worth: 1, reach: 25, text: "max health" },
    splash: { min: 0, max: 4, base: 0, worth: 20, reach: 1, text: "splash radius" },
    takeFire: { min: 0.1, max: 3, base: 1, worth: -40, reach: 0.4, text: "fire damage taken" },
    pierce: { whole: true, min: 0, max: 5, base: 0, worth: 12, reach: 1, text: "mobs a bolt goes through" },
  },
  vars: { "count.fire": { nominal: 2, text: "fire in him" }, "hp.frac": { nominal: 0.6, text: "health left", live: true } },
  events: { kill: { rate: 0.2, text: "he kills a mob" } },
  looks: { auras: ["ember", "mist"], trails: ["fire"] },
  elements: {
    fire: { name: "Fire", leans: ["splash"], hue: 30, aura: "ember", words: [["Burning"], ["Ember"]], text: "heat" },
    water: { name: "Water", leans: ["maxHp"], hue: 210, aura: "mist", words: [["Misty"], ["Tide"]], text: "flow" },
  },
  limits: { budget: { base: 10, perLeaf: 10, perTier: 5 }, mods: { base: 2, perTier: 1 }, triggers: { base: 0, perTier: 1 }, nodes: { base: 8, perTier: 6 }, reachPerTier: 0.5 },
});

test("expressions: unknown variables and operators are zero, sizes are bounded, division by zero is zero", () => {
  const vars = new Set(["a"]);
  assert.deepEqual(checkExpr(["mul", 2, ["var", "a"]], vars).expr, ["mul", 2, ["var", "a"]]);
  assert.deepEqual(checkExpr(["pow", 2, 3], vars).expr, 0);
  assert.deepEqual(checkExpr(["var", "b"], vars).expr, 0);
  const deep = checkExpr(["add", ["add", ["add", ["add", ["add", ["add", ["add", 1, 1], 1], 1], 1], 1], 1], 1], vars, 32, 4);
  assert.ok(deep.problems.includes("too deep"));
  assert.equal(evalExpr(["div", 1, 0], {}), 0);
  assert.equal(evalExpr(["clamp", ["var", "a"], 0, 1], { a: 5 }), 1);
});

test("a program is read through its contract: the unknown dropped, pools only in triggers, too-far pulled back", () => {
  const r = readProgram(C, { name: "Steam<script>", mods: [{ stat: "nope", op: "add", value: 1 }, { stat: "hp", op: "add", value: 5 }, { stat: "maxHp", op: "add", value: 1000 }] }, 1, 2);
  assert.equal(r.program.name, "Steamscript");
  assert.equal(r.program.mods.length, 1);
  assert.ok(r.notes.some((n) => n.includes("no stat nope")) && r.notes.some((n) => n.includes("pool")));
  const v = evalExpr(r.program.mods[0]!.value, {});
  assert.ok(v <= 25 * 1.5 + 1e-9, `pulled back to its reach (${v})`);
  assert.deepEqual(readProgram(C, { mods: [{ stat: "splash", op: "add", value: 0.5 }] }, 1, 2), readProgram(C, { mods: [{ stat: "splash", op: "add", value: 0.5 }] }, 1, 2), "the same reading every time");
});

test("over budget, the good parts are scaled down; a drawback earns budget back", () => {
  const greedy = readProgram(C, { mods: [{ stat: "splash", op: "add", value: 1.5 }, { stat: "maxHp", op: "add", value: 30 }] }, 1, 2);
  assert.ok(greedy.cost <= greedy.budget + 1e-9, `${greedy.cost} <= ${greedy.budget}`);
  const withDrawback = readProgram(C, { mods: [{ stat: "splash", op: "add", value: 1.5 }, { stat: "maxHp", op: "add", value: 30 }, { stat: "takeFire", op: "add", value: 0.6 }] }, 1, 2);
  const splashOf = (r: typeof greedy): number => evalExpr(r.program.mods.find((m) => m.stat === "splash")!.value, {});
  assert.ok(splashOf(withDrawback) > splashOf(greedy), "the weakness pays for more splash");
});

test("a sheet lays programs (sets, adds, multiplies, clamps) and fires triggers: pools gifted, buffs timed", () => {
  const p1 = readProgram(C, { mods: [{ stat: "maxHp", op: "add", value: ["mul", 5, ["var", "count.fire"]] }], triggers: [{ on: "kill", every: 1, do: [{ stat: "hp", op: "add", value: 4 }, { stat: "splash", op: "add", value: 0.5, for: 2 }] }] }, 2, 3).program;
  const s = createSheet(C, [p1], { "count.fire": 3 });
  assert.equal(s.get("maxHp"), 115);
  assert.deepEqual(s.fire("kill", { "hp.frac": 1 }, 0), { hp: 4 });
  assert.equal(s.get("splash"), 0.5);
  assert.deepEqual(s.fire("kill", {}, 0.5), {}, "cooling down");
  s.tick(2.1);
  assert.equal(s.get("splash"), 0);
});

test("the matrix asks each cell once, keeps it, and names it by its content", async () => {
  let asked = 0;
  const counting: Oracle = { name: "count", answer: () => { asked += 1; return { name: "Steam", text: "hot mist", mods: [{ stat: "splash", op: "add", value: 0.4 }], look: { aura: "mist" } }; } };
  const M = createMatrix({ contract: C, store: memoryStore(), oracles: [counting, seededOracle()] });
  const a = await M.combine("fire", "water");
  const b = await M.combine("water", "fire");
  assert.equal(asked, 1);
  assert.equal(a.id, b.id);
  assert.equal(a.tier, 1);
  assert.deepEqual(a.leaves, { fire: 1, water: 1 });
  const deeper = await M.combine(a.id, "fire");
  assert.equal(deeper.tier, 2);
  assert.ok(deeper.budget > a.budget, "deeper, more to spend");
});

test("the seeded oracle answers any cell, the same way every time; a failing oracle falls through to it", async () => {
  const broken: Oracle = { name: "broken", answer: () => { throw new Error("down"); } };
  const M1 = createMatrix({ contract: C, store: memoryStore(), oracles: [broken, seededOracle()] });
  const M2 = createMatrix({ contract: C, store: memoryStore(), oracles: [seededOracle()] });
  const x = await M1.combine("fire", "fire"), y = await M2.combine("fire", "fire");
  assert.equal(x.id, y.id);
  assert.equal(x.by, "seeded");
});

test("the relay queue: the bridge claims a job, posts its text; the oracle reads the JSON out of it", async () => {
  const q = createRelayQueue({ timeoutMs: 2000 });
  const M = createMatrix({ contract: C, store: memoryStore(), oracles: [relayOracle(q), seededOracle()] });
  const made = M.combine("fire", "water");
  const job = await q.claim(500);
  assert.ok(job && job.prompt.includes("Budget"));
  assert.equal(await q.claim(0), null, "one job for one cell");
  assert.ok(q.result(job!.id, { text: "Here you go:\n```json\n{\"name\":\"Hot Spring\",\"text\":\"warm\",\"mods\":[{\"stat\":\"maxHp\",\"op\":\"add\",\"value\":10}]}\n```" }));
  const e = await made;
  assert.equal(e.program.name, "Hot Spring");
  assert.equal(e.by, "bridge");
  assert.deepEqual(jsonFromText("junk {\"a\":1} junk"), { a: 1 });
});

test("whole stats: a fraction is rounded, and rounded down when rounding up would break the budget", () => {
  const cheap = readProgram(C, { mods: [{ stat: "pierce", op: "add", value: 0.7 }] }, 1, 2);
  assert.equal(cheap.program.mods[0]!.value, 1);
  const tight = readProgram(C, { mods: [{ stat: "splash", op: "add", value: 1.5 }, { stat: "maxHp", op: "add", value: 37 }, { stat: "pierce", op: "add", value: 1 }] }, 1, 2);
  const p = tight.program.mods.find((m) => m.stat === "pierce")!;
  assert.ok(Number.isInteger(p.value as number), `whole: ${JSON.stringify(p.value)}`);
  assert.ok(tight.cost <= tight.budget + 1e-9);
});
