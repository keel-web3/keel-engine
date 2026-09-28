import { test } from "node:test";
import assert from "node:assert/strict";
import { SWEEP_SEGMENTS, backPanelOf, generateCar, signalLamps, signalLit, signalStyle } from "../src/index.ts";

test("indicators sit where a real car's do: on the mirror, at the nose's and tail's outer corners, mirrored side to side", () => {
  let mirrors = 0;
  for (let i = 0; i < 300; i += 1) {
    const car = generateCar(`sig${i}`), g = car.body;
    const left = signalLamps(car, -1), right = signalLamps(car, 1);
    assert.equal(left.length, right.length);
    left.forEach((l, k) => { const r = right[k]!; assert.equal(l.kind, r.kind); assert.equal(l.x, -r.x); assert.equal(l.y, r.y); assert.equal(l.z, r.z); });
    for (const l of right) {
      assert.ok(l.x > 0 && Number.isFinite(l.y + l.z), `${car.seed} ${l.kind}`);
      assert.ok(l.y > g.ride - 0.01 && l.y < g.roof, `${car.seed} ${l.kind} y ${l.y}`);
      assert.ok(Math.abs(l.z) <= g.length / 2 + 0.05, `${car.seed} ${l.kind} z`);
    }
    const kinds = right.map((l) => l.kind);
    assert.ok(kinds.includes("front") && kinds.includes("rear"), car.seed);
    if (car.parts.semi || car.parts.service) continue;
    assert.equal(kinds.filter((k) => k === "mirror" || k === "side").length, 1, car.seed);
    const m = right.find((l) => l.kind === "mirror");
    if (m) { mirrors += 1; assert.ok(m.x > g.cabWidth / 2 && m.y > g.belt && m.z < g.cabFront, car.seed); }
    for (const rear of right.filter((l) => l.kind === "rear")) assert.ok(rear.x + rear.h[0] <= backPanelOf(car).half + 1e-9, car.seed);
  }
  assert.ok(mirrors > 100, `${mirrors} cars with mirrors`);
});

test("indicators vary by car -- forms, shades, rates -- from their own draws, and a sweep grows outward", () => {
  const forms = new Set<string>(), hues = new Set<number>(), rates = new Set<number>();
  for (let i = 0; i < 400; i += 1) {
    const car = generateCar(`var${i}`), st = signalStyle(car);
    assert.deepEqual(signalStyle(generateCar(`var${i}`)), st);
    forms.add(st.form); hues.add(st.rear.hue); rates.add(Math.round(st.hz * 10));
    assert.ok(st.hz >= 1.2 && st.hz <= 2.1);
    const rear = signalLamps(car, 1, st).filter((l) => l.kind === "rear");
    if (st.form !== "sweep") { assert.equal(rear.length, 1); continue; }
    assert.equal(rear.length, SWEEP_SEGMENTS);
    // (Innermost first, each further out; lit in that order, then all out together.)
    for (let k = 1; k < rear.length; k += 1) assert.ok(rear[k]!.x > rear[k - 1]!.x && rear[k]!.seg === k);
    const lit = (t: number) => rear.map((l) => signalLit(st, l, t / st.hz));
    assert.deepEqual(lit(0.01), [1, 0, 0, 0, 0]);
    assert.deepEqual(lit(0.4), [1, 1, 1, 1, 1]);
    assert.deepEqual(lit(0.7), [0, 0, 0, 0, 0]);
  }
  assert.deepEqual([...forms].sort(), ["bulb", "dot", "led", "sweep"]);
  assert.ok(hues.size >= 3 && rates.size >= 4, `${hues.size} hues, ${rates.size} rates`);
});

test("a bulb warms up and dies away; an LED snaps", () => {
  const car = generateCar("x"), st = signalStyle(car), lamp = { seg: 0, of: 1 };
  const bulb = { ...st, form: "bulb" as const, hz: 1 }, led = { ...st, form: "led" as const, hz: 1 };
  assert.ok(signalLit(bulb, lamp, 0.02) > 0 && signalLit(bulb, lamp, 0.02) < 1);
  assert.ok(signalLit(bulb, lamp, 0.53) > 0 && signalLit(bulb, lamp, 0.53) < 1);
  assert.equal(signalLit(led, lamp, 0.02), 1); assert.equal(signalLit(led, lamp, 0.53), 0);
});
