import { test } from "node:test";
import assert from "node:assert/strict";
import { createLookTable, planBake } from "@keel-engine/bake";
import {
  BODY_SLOT,
  BODY_STYLES, CATEGORIES, DIALS, ONE_PPM, PANELS, SITES, SPIN_FRAMES, TIER_LADDER, bodyPaint, carDecals, carDesigns, carState, chipsOf, generateCar, geometryKey, onchainAttributes, panelSlot, papers,
  placeWheels, points, spinFrame, stepCar, traitPpm, wheelPaint,
} from "../src/index.ts";

test("a car is its seed: the same seed is the same car; styles, dials and traits pin", () => {
  assert.deepEqual(generateCar("42"), generateCar("42"));
  assert.notDeepEqual(generateCar("42"), generateCar("43"));
  for (const s of BODY_STYLES) assert.equal(generateCar("7", { style: s.name }).style, s.name);
  assert.equal(generateCar("7", { dials: { low: 1 } }).dials.low, 1);
  const odd = generateCar("7", { style: "Pickup", traits: { Condition: "Odd Door", Spoiler: "None" } });
  assert.ok(odd.traits.some((t) => t.name === "Odd Door") && odd.paints.panels.some((p) => p.kind === "odd" && (p.panel === "doorL" || p.panel === "doorR")));
});

test("traits the marine's way: integer odds, several per site, the rarest takes the chip, a fixed scored vector", () => {
  assert.equal(points(ONE_PPM), 0);
  // (Half-octaves, ceilinged so each step always advances: a coin flip is three, one in a million thirty-nine or forty.)
  assert.equal(points(500_000), 3);
  for (let p = 200; p < ONE_PPM; p = Math.ceil(p * 1.7)) assert.ok(Math.abs(points(p) - 2 * Math.log2(ONE_PPM / p)) <= 1.5, `${p}`);
  // Every table entry's odds, summed over what a style can draw, never passes certainty.
  for (const c of CATEGORIES) { const names = new Set(Object.values(c.tables).flatMap((t) => t!.entries.map(([n]) => n))); let sum = 0; for (const n of names) sum += traitPpm(c.name, n); assert.ok(sum <= ONE_PPM, c.name); }
  let multi = 0;
  for (let i = 0; i < 400; i += 1) {
    const car = generateCar(`t${i}`);
    assert.deepEqual(Object.keys(car.chips), [...SITES]);
    for (const site of SITES) {
      const here = car.traits.filter((t) => t.site === site);
      if (here.length > 1) multi += 1;
      const rarest = here.reduce<(typeof here)[number] | null>((b, t) => (!b || t.ppm < b.ppm ? t : b), null);
      assert.equal(car.chips[site].name, rarest ? rarest.name : "None");
    }
    assert.equal(car.score, SITES.reduce((a, s) => a + points(car.chips[s].ppm), 0));
    assert.deepEqual(chipsOf(car.traits), car.chips);
    const attrs = onchainAttributes(car);
    for (const site of SITES) assert.ok(attrs.some((a) => a.trait_type === site));
    assert.equal(papers(car).length, SITES.length);
  }
  assert.ok(multi > 400, `${multi} sites holding more than one trait`);
});

test("variance: a thousand cars are a thousand shapes and looks, every style, every part", () => {
  const cars = Array.from({ length: 1000 }, (_, i) => generateCar(String(i)));
  assert.ok(new Set(cars.map(geometryKey)).size > 990);
  assert.ok(new Set(cars.map((c) => c.style)).size >= 20);
  for (const k of ["head", "tail", "spoiler", "grille", "exhaust", "roof"] as const) assert.ok(new Set(cars.map((c) => c.parts[k])).size >= 4, k);
  assert.ok(new Set(cars.map((c) => `${c.paints.body.hue}/${c.paints.body.light}`)).size > 150);
  for (const d of DIALS) { const v = cars.map((c) => c.dials[d]); assert.ok(Math.max(...v) - Math.min(...v) > 1.2, d); }
  // (Inside a base: the same wing is never the same wing twice.)
  const wings = cars.filter((c) => c.parts.spoiler === "wing").map((c) => JSON.stringify(c.parts.wing));
  assert.ok(new Set(wings).size > wings.length * 0.8);
});

test("the tier ladder holds its shares (the census it was struck on, smaller)", () => {
  const N = 6000;
  const scores = Array.from({ length: N }, (_, i) => generateCar(`ladder${i}`).score);
  const share = (min: number) => scores.filter((s) => s >= min).length / N;
  const at = (id: string) => TIER_LADDER.find((t) => t.id === id)!.min;
  assert.ok(Math.abs(share(at("uncommon")) - 0.43) < 0.04, `uncommon+ ${share(at("uncommon"))}`);
  assert.ok(Math.abs(share(at("rare")) - 0.1) < 0.02, `rare+ ${share(at("rare"))}`);
  assert.ok(share(at("epic")) < 0.02);
});

test("bake shapes: panels one solid a slot, wheels spinning over SPIN_FRAMES, within the renderer's limits", () => {
  for (let i = 0; i < 200; i += 1) {
    const car = generateCar(`s${i}`);
    const { body, wheels } = carDesigns(car);
    const w = body.pose("still", 0);
    assert.ok((w.boxes?.length ?? 0) <= 256 && (w.wedges?.length ?? 0) <= 128 && (w.capsules?.length ?? 0) <= 256, car.seed);
    // (A decal lands once: every panel but the roof is exactly one solid.)
    const solids = [...(w.boxes ?? []), ...(w.wedges ?? []), ...(w.capsules ?? [])];
    for (const p of PANELS) if (["hood", "trunk", "doorL", "doorR"].includes(p)) assert.ok(solids.filter((s) => s.mat === panelSlot(p)).length <= (p === "hood" && car.parts.head === "frog" ? 3 : 1), `${car.seed} ${p}`);
    for (const wd of wheels) {
      assert.equal(wd.clips[0]!.frames, SPIN_FRAMES);
      const f0 = wd.pose("spin", 0), f1 = wd.pose("spin", 1);
      assert.ok((f0.capsules?.length ?? 0) <= 256, `${car.seed} wheel capsules ${f0.capsules?.length}`);
      assert.notDeepEqual(f0.capsules, f1.capsules);
    }
  }
  // (A car with no spinner has no spinner design: the nulls drop out.)
  const plan = planBake(Object.values(carDesigns(generateCar("1"))).flat().filter(Boolean) as never, { directions: 32, pixelsPerMetre: 16, pitch: 0.8 });
  assert.ok(plan.sprites.length >= 32 + 32 * SPIN_FRAMES);
});

test("paints: every slot a solid uses is painted; panels, decals, conditions and screens per part", () => {
  const table = createLookTable();
  let decals = 0, panelled = 0;
  for (let i = 0; i < 300; i += 1) {
    const car = generateCar(`p${i}`);
    const body = bodyPaint(car), wheel = wheelPaint(car);
    const pose = carDesigns(car).body.pose("still", 0);
    const glassPose = carDesigns(car).glass.pose("still", 0);
    assert.ok([...(glassPose.boxes ?? []), ...(glassPose.wedges ?? []), ...(glassPose.capsules ?? [])].every((x) => x.mat === BODY_SLOT.glass || x.mat === BODY_SLOT.screen));
    for (const s of new Set((["boxes", "wedges", "capsules"] as const).flatMap((k) => (pose[k] ?? []).map((x) => x.mat ?? 0)))) assert.ok(body[s], `${car.seed}: body slot ${s} unpainted`);
    for (const s of carDesigns(car).wheels[0].pose("spin", 0).capsules!.map((c) => c.mat ?? 0)) assert.ok(wheel[s], `wheel slot ${s}`);
    assert.ok(new Set(body.filter(Boolean).map((p) => p!.screen)).size >= 4);
    const placed = carDecals(car);
    decals += placed.length;
    for (const d of placed) { assert.ok(body[panelSlot(d.panel)]!.decal, `${car.seed}: ${d.kind} on ${d.panel}`); assert.ok(d.rect[0] >= 0 && d.rect[2] <= 1 && d.rect[0] < d.rect[2]); }
    if (car.paints.panels.length) { panelled += 1; for (const pp of car.paints.panels) if (pp.kind !== "faded" || pp.panel !== "roof") assert.notDeepEqual(body[panelSlot(pp.panel)]!.look, body[0]!.look); }
    table.add(body); table.add(wheel);
  }
  assert.ok(decals > 30 && panelled > 3, `${decals} decals, ${panelled} cars with odd panels`);
  assert.ok(table.decals > 20 && table.placements > 20);
});

test("driving: a car accelerates, steers the way it's told, and its wheels roll and turn", () => {
  const car = generateCar("drive");
  const s = carState(0, 0, 0);
  for (let i = 0; i < 120; i += 1) stepCar(s, car.handling, { throttle: 1, steer: 0 }, 1 / 60);
  assert.ok(s.speed > 5 && s.z > 3 && Math.abs(s.x) < 1e-9);
  for (let i = 0; i < 60; i += 1) stepCar(s, car.handling, { throttle: 0.5, steer: 1 }, 1 / 60);
  assert.ok(s.yaw > 0.1 && s.x > 0 && s.steer > 0, `${s.yaw} ${s.x}`);
  const wheels = placeWheels(car, s.x, s.z, s.yaw, s.steer, s.rolled);
  assert.equal(wheels.length, 4);
  assert.ok(wheels.filter((w) => w.mount.steers).every((w) => w.yaw > s.yaw));
  assert.ok(wheels.filter((w) => !w.mount.steers).every((w) => w.yaw === s.yaw));
  assert.equal(spinFrame(car.wheels[0], 0), 0);
});
