// Ground.normal (opt-in): a body corner pressed into the ground is pushed out along the ground's own normal. Without
// one -- or with a flat one -- the car steps exactly as it always has.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createVehicle, DEFAULT_SPEC, stepVehicle } from "../src/index.ts";
import type { Ground, Vehicle, VehicleInput } from "../src/index.ts";

const DT = 1 / 60;
const IDLE: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
/** A car flung onto its side across flat ground: its body corners do the work. */
const tumbling = (): Vehicle => {
  const car = createVehicle(DEFAULT_SPEC, 0, 0, 0);
  car.q = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)];
  car.v = [6, -1, 14]; car.w = [2, 1, -3];
  return car;
};

test("a flat ground's normal changes nothing: the same bits as no normal at all", () => {
  const plain: Ground = { height: () => 0, grip: () => 1 };
  const up: Ground = { ...plain, normal: () => [0, 1, 0] };
  const a = tumbling(), b = tumbling();
  for (let i = 0; i < 180; i += 1) { stepVehicle(a, IDLE, DT, plain); stepVehicle(b, IDLE, DT, up); }
  assert.deepEqual([a.p, a.q, a.v, a.w], [b.p, b.q, b.v, b.w]);
});

test("a steep face with its normal shoves a car back out of it, where without one it's lifted up it", () => {
  // (A wall of ground rising 10 m over 1 m, 3 m ahead; the car on its side sliding into it.)
  const height = (x: number, z: number): number => (z < 3 ? 0 : z > 4 ? 10 : (z - 3) * 10);
  const face = (x: number, z: number): readonly [number, number, number] => (z < 3 || z > 4 ? [0, 1, 0] : [0, 0.0995, -0.995]);
  const run = (ground: Ground): Vehicle => {
    const car = tumbling();
    car.v = [0, 0, 8];
    for (let i = 0; i < 45; i += 1) stepVehicle(car, IDLE, DT, ground);
    return car;
  };
  const lifted = run({ height, grip: () => 1 }), pushed = run({ height, grip: () => 1, normal: face });
  assert.ok(pushed.v[2] < lifted.v[2], `pushed back (${pushed.v[2].toFixed(2)} m/s on, against ${lifted.v[2].toFixed(2)})`);
  assert.ok(pushed.p[1] < lifted.p[1], `and not lifted up the face (${pushed.p[1].toFixed(2)} m, against ${lifted.p[1].toFixed(2)})`);
});
