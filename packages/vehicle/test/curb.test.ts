import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPEC, SURFACES, createVehicle, rotate, stepVehicle, surfaceGround } from "../src/index.ts";

test("a normal 15 cm curb can be driven onto and off without a suspension force spike", () => {
  for (const speed of [5, 10, 20]) for (const angle of [0, Math.PI / 4]) for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const ground = surfaceGround((x, z) => z >= 10 && z < 20 ? 0.15 : 0, (x, z) => z < 10 || z >= 20 ? SURFACES.tarmac : z < 10.5 ? SURFACES.kerb : SURFACES.pavement);
    const car = createVehicle(DEFAULT_SPEC, 0, 0, angle, ground);
    car.v = [speed * Math.sin(angle), 0, speed * Math.cos(angle)];
    for (const w of car.wheels) w.spin = speed / car.spec.wheelRadius;
    let maxLoad = 0, minUp = 1, lift = 0;
    for (let t = 0; t < 7; t += dt) {
      stepVehicle(car, { throttle: 0.25, brake: 0, steer: 0, handbrake: 0, traction: 1 }, dt, ground);
      maxLoad = Math.max(maxLoad, ...car.wheels.map(w => w.load / (car.spec.mass * 9.81 / 4)));
      minUp = Math.min(minUp, rotate(car.q, [0, 1, 0])[1]);
      lift = Math.max(lift, car.p[1] - car.spec.comHeight - 0.15);
    }
    assert.ok(car.p[2] > 23, `crossed both edges at ${speed}, ${angle}, ${dt}: ${car.p[2]}`);
    assert.ok(maxLoad < 7, `bounded load at ${speed}, ${angle}, ${dt}: ${maxLoad}`);
    assert.ok(minUp > 0.95, `upright: ${minUp}`);
    assert.ok(lift < 0.2, `no launch: ${lift}`);
  }
});
