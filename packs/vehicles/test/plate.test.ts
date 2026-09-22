import { test } from "node:test";
import assert from "node:assert/strict";
import { createLookTable } from "@keel-engine/bake";
import { BODY_SLOT, PLATE_HALF, bodyPaint, carDesigns, carPlate, exhaustTips, generateCar, isVanity, plateFit, plateText, vanityMax } from "../src/index.ts";

test("a token's plate: four digits at the least, every digit past that as it is", () => {
  assert.deepEqual([1, 42, 999, 9999, 10000, 123456].map((t) => plateText(t)), ["0001", "0042", "0999", "9999", "10000", "123456"]);
  assert.equal(plateText(10n ** 30n), `1${"0".repeat(30)}`);
  assert.equal(plateText("0007"), "0007");
  assert.throws(() => plateText("12a"));
});

test("vanity text: A-Z 0-9, inner single spaces or dashes, up to the minted count's digits + 2", () => {
  assert.deepEqual([1, 9, 10, 100, 999, 1000, 123456].map((n) => vanityMax(n)), [3, 3, 4, 5, 5, 6, 8]);
  for (const ok of ["A", "HASHERS", "AB-12", "GO FAST", "12345678"]) assert.ok(isVanity(ok, 8), ok);
  for (const bad of ["", "ABCDEFGHI", "ab", " AB", "AB ", "A  B", "A--B", "Z-", "A_B", "♥"]) assert.ok(!isVanity(bad, 8), bad);
  assert.ok(isVanity("BIO", vanityMax(1)) && !isVanity("BIOB", vanityMax(1)));
  assert.ok(isVanity("BIO B", vanityMax(100)) && !isVanity("BIO BO", vanityMax(100)));
});

test("a plate is its own layer: the car's body, glass and paint don't change for it", () => {
  const car = generateCar("plate:1");
  const before = JSON.stringify([carDesigns(car).body.pose("still", 0), bodyPaint(car)]);
  const p = carPlate(car, "0001")!;
  assert.equal(JSON.stringify([carDesigns(car).body.pose("still", 0), bodyPaint(car)]), before);
  const pose = p.design.pose("still", 0);
  assert.ok(pose.boxes!.some((b) => b.mat === BODY_SLOT.plate));
  const paint = bodyPaint(car, { plate: p.paint });
  assert.ok(paint[BODY_SLOT.plate]?.decal);
  assert.equal(bodyPaint(car)[BODY_SLOT.plate], null);
  createLookTable().add(paint);
  // (The key is the plate's shape, never its text: two tokens on one body share a mesh.)
  assert.equal(carPlate(car, "0002")!.design.key, p.design.key);
});

test("long numbers fit: letters shrink first, then the plate grows, clear of the exhaust tips, then rows", () => {
  const tipsClear = (car: ReturnType<typeof generateCar>, f: NonNullable<ReturnType<typeof plateFit>>): boolean =>
    car.parts.exhaust === "side" || car.parts.exhaust === "stacks" || exhaustTips(car).flatMap((t) => (car.parts.exhaust === "quad" ? [-1, 1].map((k) => ({ x: t.x + k * t.r * 1.2, y: t.y, r: t.r * 0.85 })) : [t])).every((t) => {
      // (The pipes as shapes.ts draws them: a quad's four, each tip 1.25 x its pipe.)
      const r = t.r * 1.25;
      return t.y + r <= f.y0 || t.y - r >= f.y1 || Math.abs(t.x) - r >= f.half || (!f.moved && !f.grown && Math.abs(t.x) - r >= PLATE_HALF);
    });
  let grown = 0, rows2 = 0;
  for (let i = 0; i < 400; i += 1) {
    const car = generateCar(`plate:${i}`);
    const short = plateFit(car, "0001")!, eight = plateFit(car, "12345678")!;
    assert.ok(tipsClear(car, short) && tipsClear(car, eight), `${car.seed}: short plates clear of the tips`);
    // (On its recess -- everywhere but round a centre exit -- a short plate is the car's own, and eight digits shrink its letters.)
    if (!short.moved) assert.ok(!short.grown && short.letter === 0.07, `${car.seed}: a short plate is the car's own`);
    if (!eight.moved) assert.ok(!eight.grown && eight.letter < 0.07, `${car.seed}: eight digits shrink the letters, not grow the plate`);
    for (const t of ["123456789012345", "9".repeat(40)]) {
      const f = plateFit(car, t)!;
      assert.equal(f.rows.join(""), t);
      assert.ok(tipsClear(car, f), `${car.seed}: ${t} clear of the tips`);
      assert.ok(f.half <= car.body.width / 2, `${car.seed}: within the car's width`);
      if (f.grown) grown += 1;
      if (f.rows.length > 1) rows2 += 1;
    }
  }
  assert.ok(grown > 300 && rows2 > 50, `${grown} grown, ${rows2} on rows`);
});
