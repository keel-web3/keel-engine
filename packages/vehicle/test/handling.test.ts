import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SPEC, createVehicle, lockAt, rotate, steerCommand, stepVehicle, tuningAt, usefulLock, wallContact } from "../src/index.ts";
import type { Vehicle, VehicleInput } from "../src/index.ts";

// The assists (arcade > 0) against the plain physics: the numbers HANDLING.md asks of a street racer's feel.

const DT = 1 / 60;
const NFS = 0.7;
const rolling = (speed: number): Vehicle => {
  const car = createVehicle(DEFAULT_SPEC, 0, 0, 0);
  car.v = [0, 0, speed];
  for (const w of car.wheels) w.spin = speed / DEFAULT_SPEC.wheelRadius;
  return car;
};
/** The slide: sideways over forward speed (rad, near enough). */
const slipOf = (car: Vehicle): number => {
  const f = rotate(car.q, [0, 0, 1]), r = rotate(car.q, [1, 0, 0]);
  return (car.v[0] * r[0] + car.v[2] * r[2]) / Math.max(3, Math.abs(car.v[0] * f[0] + car.v[2] * f[2]));
};
const speedOf = (car: Vehicle): number => Math.sqrt(car.v[0] * car.v[0] + car.v[2] * car.v[2]);
const drive = (car: Vehicle, input: (i: number) => VehicleInput, frames: number, each?: (car: Vehicle) => void): void => {
  for (let i = 0; i < frames; i += 1) { stepVehicle(car, input(i), DT); each?.(car); }
};
const laneChange = (arcade: number): { slip: number; car: Vehicle } => {
  const car = rolling(30);
  let slip = 0;
  drive(car, (i) => ({ throttle: 0.5, brake: 0, steer: i < 30 ? 1 : i < 60 ? -1 : 0, handbrake: 0, arcade }), 240, (c) => { slip = Math.max(slip, Math.abs(slipOf(c))); });
  return { slip, car };
};

test("handling: arcade 0 is the physics as it is -- no assist touches the car", () => {
  const run = (input: Partial<VehicleInput>): string => {
    const car = rolling(20);
    drive(car, (i) => ({ throttle: 0.8, brake: 0, steer: ((i % 90) - 45) / 45, handbrake: i % 150 < 15 ? 1 : 0, boost: i > 100 ? 0.5 : 0, ...input }), 300);
    return JSON.stringify([car.p, car.q, car.v, car.w]);
  };
  assert.equal(run({ arcade: 0 }), run({}));
  assert.equal(lockAt(DEFAULT_SPEC, 30, 0), DEFAULT_SPEC.steerLock / (1 + 30 / 70));
});

test("handling: a flick lane change at 108 km/h -- the physics spins, the assisted car holds a 6 degree slide", () => {
  const plain = laneChange(0), nfs = laneChange(NFS);
  assert.ok(plain.slip > 0.5, `plain slip ${plain.slip}`);
  assert.ok(nfs.slip < 0.105, `assisted slip ${nfs.slip}`);
  assert.ok(speedOf(nfs.car) > 30, `kept its speed: ${speedOf(nfs.car)}`);
});

test("handling: a key asks for a rate of turn -- quick to it, held at the grip's limit, and never rolled over", () => {
  for (const arcade of [NFS, 1]) {
    const car = rolling(25), yaw: number[] = [];
    drive(car, () => ({ throttle: 0.4, brake: 0, steer: 1, handbrake: 0, arcade }), 180, (c) => { yaw.push(c.w[1]); });
    const steady = yaw.slice(120).reduce((a, b) => a + b, 0) / 60;
    const rise = yaw.findIndex((y) => y >= 0.63 * steady) / 60;
    assert.ok(steady > 0.35, `arcade ${arcade}: turns (${steady})`);
    assert.ok(rise < 0.2, `arcade ${arcade}: rise ${rise} s`);
    assert.ok(rotate(car.q, [0, 1, 0])[1] > 0.9, `arcade ${arcade}: on its wheels`);
    // Lifting mid-corner doesn't swap its ends.
    let slip = 0;
    drive(car, () => ({ throttle: 0, brake: 0, steer: 1, handbrake: 0, arcade }), 120, (c) => { slip = Math.max(slip, Math.abs(slipOf(c))); });
    assert.ok(slip < 0.12, `arcade ${arcade}: lift-off slip ${slip}`);
  }
});

test("handling: the handbrake swings the tail out, and the car gathers itself up after", () => {
  const car = rolling(20);
  drive(car, () => ({ throttle: 0.3, brake: 0, steer: 1, handbrake: 1, arcade: NFS }), 45);
  const f = rotate(car.q, [0, 0, 1]);
  assert.ok(Math.abs(Math.atan2(f[0], f[2])) > 0.5, "swung round");
  drive(car, () => ({ throttle: 0.6, brake: 0, steer: 0, handbrake: 0, arcade: NFS }), 180);
  assert.ok(Math.abs(slipOf(car)) < 0.02 && speedOf(car) > 10, `recovered: slip ${slipOf(car)} speed ${speedOf(car)}`);
});

test("handling: nitrous is a shove along the car", () => {
  const run = (boost: number): number => {
    const car = rolling(20);
    drive(car, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0, boost, arcade: NFS }), 120);
    return speedOf(car);
  };
  const gain = run(1) - run(0);
  assert.ok(gain > tuningAt(NFS).boostAccel * 2 * 0.6, `gain ${gain} m/s over 2 s`);
});

test("handling: a glancing scrape along a wall keeps its speed; head-on it stops", () => {
  // A wall along z at x = 1 (its normal +x, into it).
  const a = 5 * Math.PI / 180;
  const scrape = createVehicle(DEFAULT_SPEC, 0, 0, a);
  scrape.v = [40 * Math.sin(a), 0, 40 * Math.cos(a)];
  const hit = wallContact(scrape, 1, 0, 0.2, DT, NFS);
  assert.ok(hit > 3 && scrape.v[0] <= 0, `pushed out (${hit})`);
  assert.ok(speedOf(scrape) >= 0.85 * 40, `kept ${speedOf(scrape)}`);
  assert.ok(scrape.w[1] < 0, "the nose turned back along the wall");
  const head = rolling(20);
  head.v = [20, 0, 0];
  wallContact(head, 1, 0, 0.2, DT, NFS);
  assert.ok(speedOf(head) < 4, `head-on ${speedOf(head)}`);
  // Nothing past the wall, nothing done.
  const clear = rolling(20);
  assert.equal(wallContact(clear, 1, 0, 0, DT, NFS), 0);
  assert.deepEqual(clear.v, [0, 0, 20]);
});

test("handling: a key asks for the lock the tyres can use -- a tap at 110 km/h is a lane change, not a yank", () => {
  assert.equal(steerCommand(DEFAULT_SPEC, 30, 0.6, false), 0.6);
  const key = steerCommand(DEFAULT_SPEC, 30, 1, true);
  assert.ok(key > 0.1 && key < 0.4, `a full key at speed: ${key}`);
  assert.ok(steerCommand(DEFAULT_SPEC, 3, 1, true) > 0.95, "parking: all of it");
  assert.ok(usefulLock(DEFAULT_SPEC, 30, 0.6) < usefulLock(DEFAULT_SPEC, 30), "less on grass");
  // Held full through a bend at 108 km/h on the throttle, with TC: the car stays on its line.
  const car = rolling(30);
  let slip = 0;
  drive(car, () => ({ throttle: 1, brake: 0, steer: steerCommand(DEFAULT_SPEC, 30, 1, true), handbrake: 0, traction: 1 }), 150, (c) => { slip = Math.max(slip, Math.abs(slipOf(c))); });
  assert.ok(slip < 0.2, `slip ${slip}`);
  assert.ok(lockAt(DEFAULT_SPEC, 30) > usefulLock(DEFAULT_SPEC, 30));
});
