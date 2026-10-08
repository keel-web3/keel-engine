import assert from "node:assert/strict";
import { test } from "node:test";
import { BODY_STYLES, SERVICE_STYLES, carDesigns, carrierDecks, generateCar, physicsOf } from "../src/index.ts";

const solids = (d: ReturnType<typeof carDesigns>["body"]) => {
  const world = d.pose("still", 0);
  return [...(world.boxes ?? []), ...(world.wedges ?? []), ...(world.capsules ?? [])];
};

test("an empty canonical cabin removes only the person and keeps seats, controls, glass and running gear", () => {
  for (const style of [...BODY_STYLES.map(s => s.name), "Semi Truck", ...Object.values(SERVICE_STYLES)]) {
    const car = generateCar(`empty:${style}`, { style }), occupied = carDesigns(car), empty = carDesigns(car, { occupied: false });
    const original = solids(occupied.body), names = occupied.body.components!;
    assert.deepEqual(solids(empty.body), original.filter((_, i) => names[i] !== "driver"), style);
    assert.ok(!empty.body.components!.includes("driver"), `${style}: no baked driver`);
    assert.notEqual(empty.body.key, occupied.body.key, `${style}: pooled occupancy never aliases`);
    assert.deepEqual(empty.glass.pose("still", 0), occupied.glass.pose("still", 0), `${style}: cabin remains closed`);
    assert.deepEqual(empty.wheels.map(w => w.key), occupied.wheels.map(w => w.key));
    assert.deepEqual(carDesigns(car).body.pose("still", 0), occupied.body.pose("still", 0), "empty rendering does not mutate the canonical source car");
  }
});

test("canonical rigid carriers have fitted cargo mounts, rolling axles and ordinary diesel physics", () => {
  for (const [style, count] of [["Flatbed Truck", 1], ["Long Flatbed Truck", 2], ["Compact Car Carrier", 2]] as const) {
    for (let i = 0; i < 16; i++) {
      const car = generateCar(`carrier:${i}`, { style }), sv = car.parts.service!;
      const mounts = carrierDecks(car);
      assert.equal(mounts.length, count); assert.ok(!car.parts.semi && !car.parts.bed);
      assert.equal(car.mounts.length, 6); assert.equal(car.mounts.filter(w => w.steers).length, 2);
      for (const m of mounts) {
        assert.ok(m.z > sv.m.z0! && m.z < sv.m.z1! && m.lift >= sv.m.floor!);
        const deck = solids(carDesigns(car).body).find(s => "c" in s && Math.abs(s.c[1]! + s.h[1]! - m.lift) < 1e-6 && m.z >= s.c[2]! - s.h[2]! && m.z <= s.c[2]! + s.h[2]!);
        assert.ok(deck, `${style}: each mount stands on an actual generated deck`);
      }
      const physics = physicsOf(car); assert.ok(Number.isFinite(physics.spec.finalDrive) && physics.com.y > 0 && Number.isFinite(physics.com.z));
    }
  }
});

test("advertising vehicle is one canonical box truck with no trailer coupling or emergency flash", () => {
  const car = generateCar("advert:box", { style: "Advertising Truck" });
  const body = carDesigns(car).body;
  assert.equal(car.parts.service!.kind, "advertising"); assert.ok(!car.parts.semi && !car.parts.bed && !car.parts.beacons);
  assert.equal(car.body.length, 12); assert.equal(car.mounts.length, 6);
  assert.ok(body.components!.includes("advertisingBox") && !body.components!.includes("dumpRam"));
  assert.ok(body.height >= 5.76 && body.height <= 5.82);
  assert.equal(carrierDecks(car).length, 0);
});
