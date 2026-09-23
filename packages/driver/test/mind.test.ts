import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTINCTS, RARITY_WEIGHT, driverSeed, driverSkills, generateDriver, mistakeAt } from "../src/index.ts";
import type { DriverSkills } from "../src/index.ts";

const N = 4000;
const drivers = Array.from({ length: N }, (_, i) => generateDriver(driverSeed(`d${i}`), ["hyper", "muscle", "kei", "gt", ""][i % 5]));
const avg = (sk: DriverSkills): number => (sk.cornering + sk.braking + sk.weaving + sk.control + sk.nerve) / 5;

test("mind: a driver is a function of their seed", () => {
  assert.deepEqual(generateDriver(driverSeed("same"), "gt"), generateDriver(driverSeed("same"), "gt"));
  assert.notDeepEqual(generateDriver(driverSeed("a")).skills, generateDriver(driverSeed("b")).skills);
});

test("mind: rarity follows the weights -- mostly commons, a legendary now and then", () => {
  const count = (r: string): number => drivers.filter((d) => d.rarity === r).length / N;
  assert.ok(count("common") > 0.3 && count("common") < 0.7, `common ${count("common")}`);
  assert.ok(count("legendary") > 0 && count("legendary") < 0.05, `legendary ${count("legendary")}`);
  assert.ok(RARITY_WEIGHT.common > RARITY_WEIGHT.legendary && INSTINCTS.length >= 10);
});

test("mind: rarer drivers are smarter on average, but plenty of commons are brilliant", () => {
  const mean = (r: string): number => { const d = drivers.filter((x) => x.rarity === r); return d.reduce((t, x) => t + avg(x.skills), 0) / d.length; };
  const mistakes = (r: string): number => { const d = drivers.filter((x) => x.rarity === r); return d.reduce((t, x) => t + x.mistakes.overcook + x.mistakes.lateBrake + x.mistakes.lift, 0) / d.length; };
  assert.ok(mean("epic") > mean("common"), `epic ${mean("epic")} vs common ${mean("common")}`);
  assert.ok(mistakes("legendary") < mistakes("common"), "legendaries err less");
  const top = [...drivers].sort((a, b) => avg(b.skills) - avg(a.skills)).slice(0, N / 20);
  assert.ok(top.filter((d) => d.rarity === "common").length > top.length * 0.15, "commons among the best 5%");
});

test("mind: the car leans the driver -- muscle-car drivers are more aggressive than kei drivers", () => {
  let muscle = 0, kei = 0;
  for (let i = 0; i < 500; i += 1) { muscle += driverSkills(driverSeed(`s${i}`), "muscle").aggression; kei += driverSkills(driverSeed(`s${i}`), "kei").aggression; }
  assert.ok(muscle > kei + 500 * 0.3);
});

test("mind: weak spots make mistakes, pressure multiplies them, and the same stretch makes the same one", () => {
  const good: DriverSkills = { cornering: 0.95, braking: 0.95, weaving: 0.95, control: 0.95, aggression: 0.3, nerve: 0.95 };
  const poor: DriverSkills = { cornering: 0.2, braking: 0.2, weaving: 0.2, control: 0.2, aggression: 0.8, nerve: 0.2 };
  const tally = (sk: DriverSkills, pressure: number): number => { let n = 0; for (let k = 0; k < 20000; k += 1) if (mistakeAt(7, k, sk, 1 / 40, 30, pressure)) n += 1; return n; };
  const p0 = tally(poor, 0), p1 = tally(poor, 1), g0 = tally(good, 0);
  assert.ok(p0 > g0 * 4, `poor ${p0} good ${g0}`);
  assert.ok(p1 > p0 * 1.8, `pressure ${p1} vs ${p0}`);
  assert.deepEqual(mistakeAt(99, 1234, poor, 1 / 40, 30, 0.5), mistakeAt(99, 1234, poor, 1 / 40, 30, 0.5));
  // On a straight at low speed, no corner mistakes.
  for (let k = 0; k < 2000; k += 1) { const m = mistakeAt(3, k, poor, 0, 15, 0); assert.ok(!m || m.kind === "dive", m?.kind); }
});
