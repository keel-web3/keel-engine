import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SPEC, SURFACES, createVehicle, rotate, stepVehicle, surfaceGround } from "../src/index.ts";
import type { Ground, VehicleSpec } from "../src/index.ts";

// A road 16 m wide down z, grass either side.
const road = surfaceGround(() => 0, (x) => (Math.abs(x) > 8 ? SURFACES.grass : SURFACES.tarmac));
const TALL: VehicleSpec = { ...DEFAULT_SPEC, mass: 2300, height: 1.95, comHeight: 0.9, halfTrack: 0.85, springRate: 70000, damping: 7000, antiRoll: 25000, grip: 0.8 };
const LOW: VehicleSpec = { ...DEFAULT_SPEC, comHeight: 0.42, halfTrack: 0.82, grip: 1.05 };

/** 100 km/h, a full-lock yank off the road: how far over it went (the body's up, lowest). */
const yank = (spec: VehicleSpec, ground: Ground): number => {
  const car = createVehicle(spec, -4, 0, 0);
  car.v = [0, 0, 27.8];
  for (const w of car.wheels) w.spin = 27.8 / spec.wheelRadius;
  let up = 1;
  for (let i = 0; i < 300; i += 1) {
    stepVehicle(car, { throttle: 0.5, brake: 0, steer: 1, handbrake: 0 }, 1 / 60, ground);
    up = Math.min(up, rotate(car.q, [0, 1, 0])[1]);
  }
  return up;
};

test("surface: the table's grips and trips run from ice-slick to a kerb's face", () => {
  for (const s of Object.values(SURFACES)) assert.ok(s.grip > 0 && s.grip <= 1 && s.trip >= 0 && s.trip <= 1, s.name);
  assert.ok(SURFACES.kerb.trip > SURFACES.grass.trip && SURFACES.grass.trip > SURFACES.tarmac.trip);
});

test("surface: a ground answers per point, the same whatever it was asked before", () => {
  const a = surfaceGround(() => 0, (x) => (x > 8 ? SURFACES.sand : SURFACES.tarmac));
  const b = surfaceGround(() => 0, (x) => (x > 8 ? SURFACES.sand : SURFACES.tarmac));
  for (let i = 0; i < 6000; i += 1) a.grip((i * 7.31) % 400 - 200, (i * 3.7) % 400);
  for (const x of [0, 7.9, 8.4, 30]) assert.equal(a.grip(x, 5), b.grip(x, 5));
  assert.equal(a.surface(20, 0).name, "sand");
  assert.equal(a.drag!(20, 0), SURFACES.sand.drag);
});

test("surface: yank the wheel at 100 km/h -- a tall car sliding off onto the grass trips and goes over; a low one slews", () => {
  assert.ok(yank(TALL, road) < 0, "the tall car rolled");
  assert.ok(yank(LOW, road) > 0.8, "the low car stayed on its wheels");
  // (On an endless car park of tarmac nothing trips it: the tall car just ploughs round.)
  assert.ok(yank(TALL, { height: () => 0, grip: () => 1 }) > 0.8, "no trip, no roll");
});
