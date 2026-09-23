import assert from "node:assert/strict";
import { test } from "node:test";
import { locate, pathThrough } from "@keel-engine/road";
import { DEFAULT_SPEC, createVehicle, headingOf, rotate, stepVehicle } from "@keel-engine/vehicle";
import { drive } from "../src/index.ts";

// A circuit: a rounded rectangle-ish loop with a hairpin.
const route = pathThrough([0, 120, 170, 140, 60, -40, -90, -60], [0, 10, 80, 160, 130, 170, 90, 20], { closed: true });

function lap(seconds: number): { off: number; progress: number; maxSpeed: number } {
  const p0 = route;
  const car = createVehicle(DEFAULT_SPEC, p0.x[0]!, p0.z[0]!, p0.yaw[0]!);
  let hint = 0, off = 0, progress = 0, last = 0, maxSpeed = 0;
  for (let i = 0; i < seconds * 60; i += 1) {
    const f = rotate(car.q, [0, 0, 1]);
    const h = headingOf(car);
    const at = locate(route, car.p[0], car.p[2], hint);
    hint = at.i;
    const pedals = drive({ x: car.p[0], z: car.p[2], yaw: Math.atan2(f[0], f[2]), speed: h.forward, yawRate: car.w[1], spec: DEFAULT_SPEC }, route, at.s, { skill: 0.95, line: 0, look: 1 }, [], { half: 7.3 });
    stepVehicle(car, { ...pedals, handbrake: 0, traction: 1, stability: 1 }, 1 / 60);
    if (Math.abs(at.d) > 7.3 + 0.8) off += 1 / 60;
    let ds = at.s - last; if (ds < -route.length / 2) ds += route.length;
    progress += Math.max(0, ds); last = at.s;
    maxSpeed = Math.max(maxSpeed, h.forward);
  }
  return { off, progress, maxSpeed };
}

test("driver: an AI drives a circuit with a hairpin at pace and stays on the road", () => {
  const r = lap(60);
  assert.ok(r.progress > route.length * 1.5, `${r.progress.toFixed(0)} m in a minute on a ${route.length} m loop`);
  assert.ok(r.off < 1, `${r.off.toFixed(1)} s off the road`);
  assert.ok(r.maxSpeed > 30);
});

test("driver: the same car on the same road drives the same, bit for bit", () => {
  assert.deepEqual(lap(10), lap(10));
});

test("driver: it goes round the car just ahead of it on its line", () => {
  const me = { x: 0, z: 0, yaw: 0, speed: 20, yawRate: 0, spec: DEFAULT_SPEC };
  const straight = pathThrough([0, 0], [0, 400]);
  const clear = drive(me, straight, 0, { skill: 1, line: 0, look: 1 }, [], { half: 7.3 });
  const blocked = drive(me, straight, 0, { skill: 1, line: 0, look: 1 }, [{ gap: 8, d: 0 }], { half: 7.3 });
  assert.ok(Math.abs(clear.steer) < 0.05 && Math.abs(blocked.steer) > 0.05);
});
