import assert from "node:assert/strict";
import { test } from "node:test";
import { collideCars, createVehicle, DEFAULT_SPEC, FLAT, headingOf, rotate, stepVehicle } from "../src/index.ts";
import type { Ground, Vehicle, VehicleInput, VehicleSpec } from "../src/index.ts";

const DT = 1 / 60;
const IDLE: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const TRUCK: VehicleSpec = {
  ...DEFAULT_SPEC, mass: 4200, width: 2.3, height: 2.6, length: 6, comHeight: 0.9, halfTrack: 1.0,
  wheelRadius: 0.45, springRate: 110000, damping: 11000, antiRoll: 40000,
};

const run = (car: Vehicle, input: VehicleInput, seconds: number): void => { for (let i = 0; i < Math.round(seconds * 60); i += 1) stepVehicle(car, input, DT); };
const rolling = (spec: VehicleSpec, speed: number): Vehicle => {
  const car = createVehicle(spec, 0, 0, 0);
  car.v = [0, 0, speed];
  for (const w of car.wheels) w.spin = speed / spec.wheelRadius;
  return car;
};
const upOf = (car: Vehicle): number => rotate(car.q, [0, 1, 0])[1];

test("vehicle: a car set down stands still, its weight shared by four wheels", () => {
  const car = createVehicle(DEFAULT_SPEC, 0, 0, 0);
  run(car, IDLE, 3);
  assert.ok(Math.abs(car.v[0]) + Math.abs(car.v[1]) + Math.abs(car.v[2]) < 1e-3);
  const total = car.wheels.reduce((a, w) => a + w.load, 0);
  assert.ok(Math.abs(total - DEFAULT_SPEC.mass * 9.81) < 50, `loads ${total}`);
});

test("vehicle: the same inputs give the same car, bit for bit", () => {
  const drive = (): string => {
    const car = createVehicle(DEFAULT_SPEC, 0, 0, 0.3);
    for (let i = 0; i < 600; i += 1) stepVehicle(car, { throttle: i < 300 ? 1 : 0.3, brake: 0, steer: ((i % 120) - 60) / 60, handbrake: i % 200 < 20 ? 1 : 0 }, DT);
    return JSON.stringify([car.p, car.q, car.v, car.w, car.wheels.map((w) => w.spin)]);
  };
  assert.equal(drive(), drive());
});

test("vehicle: 0-100 km/h in a street car's time, and a top speed the drag allows", () => {
  const car = createVehicle(DEFAULT_SPEC, 0, 0, 0);
  let t = 0;
  while (headingOf(car).forward < 27.78 && t < 20) { stepVehicle(car, { ...IDLE, throttle: 1 }, DT); t += DT; }
  assert.ok(t > 4.5 && t < 8.5, `0-100 in ${t.toFixed(2)} s`);
  run(car, { ...IDLE, throttle: 1 }, 40);
  const kmh = headingOf(car).forward * 3.6;
  assert.ok(kmh > 240 && kmh < 320, `top ${kmh.toFixed(0)} km/h`);
  assert.equal(car.pt.gear, DEFAULT_SPEC.gears.length);
});

test("vehicle: ABS brakes stop from 100 km/h straight and short", () => {
  const car = rolling(DEFAULT_SPEC, 27.78);
  let t = 0;
  while (headingOf(car).forward > 0.3 && t < 10) { stepVehicle(car, { ...IDLE, brake: 1 }, DT); t += DT; }
  assert.ok(car.p[2] > 30 && car.p[2] < 45, `100-0 in ${car.p[2].toFixed(1)} m`);
  assert.ok(Math.abs(car.p[0]) < 0.2 && Math.abs(headingOf(car).yaw) < 0.02);
});

test("vehicle: a steady corner pulls near the tyres' grip and stays on its wheels", () => {
  const car = rolling(DEFAULT_SPEC, 15);
  let g = 0;
  for (let i = 0; i < 480; i += 1) {
    const f = headingOf(car).forward;
    stepVehicle(car, { ...IDLE, throttle: Math.min(1, Math.max(0, (15 - f) * 0.3)), steer: 0.5 }, DT);
    g = (Math.sqrt(car.v[0] * car.v[0] + car.v[2] * car.v[2]) * Math.abs(car.w[1])) / 9.81;
  }
  assert.ok(g > 0.75 && g < 1.1, `skidpad ${g.toFixed(2)} g`);
  assert.ok(upOf(car) > 0.95);
  // Load moves to the outside: turning right, the left wheels carry it.
  assert.ok(car.wheels[0]!.load > car.wheels[1]!.load && car.wheels[2]!.load > car.wheels[3]!.load);
});

test("vehicle: the handbrake locks the rears and the tail comes round -- a drift", () => {
  const grip = rolling(DEFAULT_SPEC, 20), drift = rolling(DEFAULT_SPEC, 20);
  run(grip, { ...IDLE, steer: 0.6 }, 0.8);
  run(drift, { ...IDLE, steer: 0.6, handbrake: 1 }, 0.8);
  const slip = (car: Vehicle): number => Math.abs(headingOf(car).yaw - Math.atan2(car.v[0], car.v[2]));
  assert.ok(slip(drift) > 0.4 && slip(drift) > slip(grip) * 3, `drift slip ${slip(drift).toFixed(2)} vs ${slip(grip).toFixed(2)}`);
  assert.ok(drift.wheels[2]!.slide > 1 && drift.wheels[3]!.slide > 1);
});

test("vehicle: holding the brake at a standstill backs up; the throttle takes it out of reverse", () => {
  const car = createVehicle(DEFAULT_SPEC, 0, 0, 0);
  run(car, { ...IDLE, brake: 1 }, 3);
  assert.equal(car.pt.gear, -1);
  assert.ok(headingOf(car).forward < -3);
  run(car, { ...IDLE, throttle: 1 }, 2);
  assert.equal(car.pt.gear > 0, true);
  assert.ok(headingOf(car).forward > 0);
});

test("vehicle: both pedals on the line is a burnout -- rears lit up, the car held", () => {
  const car = createVehicle(DEFAULT_SPEC, 0, 0, 0);
  run(car, { ...IDLE, throttle: 1, brake: 1 }, 2);
  assert.ok(Math.abs(car.p[2]) < 1, `crept ${car.p[2].toFixed(2)} m`);
  assert.ok(car.wheels[2]!.slide > 2 && car.wheels[0]!.spin === 0);
});

test("vehicle: an upside-down car lands on its roof, slides to a stop and knows it's upside down", () => {
  const car = createVehicle(DEFAULT_SPEC, 0, 0, 0);
  car.q = [0, 0, 1, 0];
  car.p[1] = 2;
  car.v = [4, 0, 3];
  run(car, { ...IDLE, throttle: 1 }, 5);
  assert.ok(upOf(car) < -0.9 && car.upsideDown > 3);
  assert.ok(Math.abs(car.v[0]) + Math.abs(car.v[2]) < 0.05);
  assert.ok(car.p[1] > 0.6 && car.p[1] < 0.9);
});

// A striker at `speed` into a still car's side; the struck car's lowest "up".
function tbone(striker: VehicleSpec, struck: VehicleSpec, speed: number, ground: Ground = FLAT): { minUp: number; hit: number; struckV: number; strikerV: number } {
  const b = createVehicle(struck, 0, 0, 0), a = createVehicle(striker, -3 - striker.length / 2, 0, Math.PI / 2);
  run(a, IDLE, 1);
  run(b, IDLE, 1);
  a.v = [speed, 0, 0];
  for (const w of a.wheels) w.spin = speed / striker.wheelRadius;
  let minUp = 1, hit = 0, struckV = 0, strikerV = 0;
  for (let i = 0; i < 300; i += 1) {
    stepVehicle(a, IDLE, DT, ground);
    stepVehicle(b, IDLE, DT, ground);
    const h = collideCars(a, b);
    if (h && h.impulse > 0 && !hit) { hit = h.impulse; struckV = b.v[0]; strikerV = a.v[0]; }
    minUp = Math.min(minUp, upOf(b));
  }
  return { minUp, hit, struckV, strikerV };
}

test("collide: mass decides who gives -- a truck shoves a coupe and barely slows", () => {
  const r = tbone(TRUCK, DEFAULT_SPEC, 14);
  assert.ok(r.hit > 0);
  assert.ok(r.struckV >= r.strikerV * 0.95 && r.strikerV > 9, `coupe ${r.struckV.toFixed(1)} m/s, truck ${r.strikerV.toFixed(1)} m/s`);
  const back = tbone(DEFAULT_SPEC, TRUCK, 14);
  assert.ok(back.struckV < 7 && back.strikerV < 3, `truck ${back.struckV.toFixed(1)} m/s, coupe ${back.strikerV.toFixed(1)} m/s`);
});

test("collide: a heavy, fast side hit shoves a light car into the kerb and over; light or slow ones don't", () => {
  const KERB: Ground = { height: () => 0, grip: () => 1, trip: (x) => (x > 2 ? 0.8 : 0) };
  assert.ok(tbone(TRUCK, DEFAULT_SPEC, 26, KERB).minUp < 0, "a truck at 94 km/h puts a coupe over the kerb");
  // (A blow that size tips it even on open tarmac: most of a side hit crumples away, not all of it.)
  assert.ok(tbone(TRUCK, DEFAULT_SPEC, 26).minUp < 0.5, "on open tarmac it's thrown over too");
  assert.ok(tbone(TRUCK, DEFAULT_SPEC, 12).minUp > 0.9, "at 43 km/h it only shoves it");
  assert.ok(tbone(DEFAULT_SPEC, DEFAULT_SPEC, 14, KERB).minUp > 0.9, "a coupe at 50 km/h shoves a coupe against the kerb, not over it");
  assert.ok(tbone(DEFAULT_SPEC, DEFAULT_SPEC, 28).minUp > 0.9, "a coupe doesn't roll a coupe");
  assert.ok(tbone(DEFAULT_SPEC, TRUCK, 28).minUp > 0.9, "nor a truck");
});
