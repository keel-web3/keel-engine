import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SPEC, collideStatic, createStaticWorld, createVehicle, rotate, stepVehicle } from "../src/index.ts";
import type { StaticShape, Vehicle } from "../src/index.ts";

const moving = (vx: number, vz: number, yaw = 0, x = 0, z = 0): Vehicle => {
  const car = createVehicle(DEFAULT_SPEC, x, z, yaw);
  car.v = [vx, 0, vz];
  for (const w of car.wheels) w.spin = Math.sqrt(vx * vx + vz * vz) / DEFAULT_SPEC.wheelRadius;
  return car;
};
const run = (car: Vehicle, shapes: readonly StaticShape[], frames: number): { hits: number; broke: number } => {
  const world = createStaticWorld(shapes);
  let hits = 0, broke = 0;
  for (let i = 0; i < frames; i += 1) {
    stepVehicle(car, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, 1 / 60);
    for (const h of collideStatic(car, world)) { hits += 1; if (h.broke) broke += 1; }
  }
  return { hits, broke };
};
const speed = (c: Vehicle): number => Math.sqrt(c.v[0] * c.v[0] + c.v[2] * c.v[2]);

test("static: head-on into a building's wall the car stops at it and never passes through", () => {
  const car = moving(0, 25);
  const wall: StaticShape = { kind: "box", x: 0, z: 20, hw: 15, hd: 5, yaw: 0 };
  const r = run(car, [wall], 90);
  assert.ok(r.hits > 0);
  assert.ok(car.p[2] < 20 - 5, `front of the wall: ${car.p[2]}`);
  assert.ok(speed(car) < 6, `stopped: ${speed(car)}`);
});

test("static: a glancing scrape along a building keeps most of its speed; clipping a corner spins the car", () => {
  // Heading +z, drifting +x into a long wall along z.
  const scrape = moving(2.5, 30);
  run(scrape, [{ kind: "box", x: 3.6, z: 60, hw: 2, hd: 60, yaw: 0 }], 60);
  assert.ok(speed(scrape) > 20 && scrape.p[0] < 3.6 - 2, `kept ${speed(scrape)}, x ${scrape.p[0]}`);
  // A corner caught with the car's left front: it turns.
  const clip = moving(0, 20);
  run(clip, [{ kind: "box", x: -6, z: 15, hw: 5, hd: 5, yaw: 0.3 }], 60);
  const f = rotate(clip.q, [0, 0, 1]);
  assert.ok(Math.abs(Math.atan2(f[0], f[2])) > 0.15, "spun off the corner");
});

test("static: a hydrant goes over when hit hard and is gone; a lamp post doesn't break", () => {
  const car = moving(0, 20);
  const r = run(car, [{ kind: "disc", x: 0, z: 10, r: 0.2, breaks: true }], 60);
  assert.equal(r.broke, 1);
  assert.ok(speed(car) > 15, "barely slowed");
  const post = moving(0, 20);
  const p = run(post, [{ kind: "disc", x: 0.3, z: 10, r: 0.15 }], 60);
  assert.ok(p.hits > 0 && p.broke === 0 && speed(post) < 10);
});

test("static: the same crash lands on the same bits", () => {
  const go = (): string => { const c = moving(1, 22, 0.2); run(c, [{ kind: "box", x: 2, z: 18, hw: 6, hd: 3, yaw: 0.4 }, { kind: "disc", x: -1, z: 8, r: 0.3, breaks: true }], 120); return JSON.stringify([c.p, c.q, c.v, c.w]); };
  assert.equal(go(), go());
});

test("static meters: a sign breaks free and barely slows the car; a bench dents then gives; a steel pole holds and costs far more", () => {
  const hitsOf = (car: Vehicle, shapes: readonly StaticShape[], frames: number) => {
    const world = createStaticWorld(shapes), all = [];
    for (let i = 0; i < frames; i += 1) { stepVehicle(car, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, 1 / 60); all.push(...collideStatic(car, world)); }
    return { all, world };
  };
  // A sign: flimsy, 15 kg, 800 J -- through it at 20 m/s.
  const a = moving(0, 20);
  const sign = hitsOf(a, [{ kind: "disc", x: 0, z: 10, r: 0.1, breaks: true, strength: 800, mass: 15 }], 60);
  assert.equal(sign.all.filter((h) => h.broke).length, 1);
  assert.ok(speed(a) > 18.5, `a sign barely slows it: ${speed(a)}`);
  const signE = sign.all.reduce((s, h) => s + (h.energy ?? 0), 0);
  // A pole: rigid (never breaks), with a meter that counts the blows.
  const b = moving(0, 20);
  const pole = hitsOf(b, [{ kind: "disc", x: 0, z: 10, r: 0.2, strength: 5e5, mass: 800 }], 60);
  assert.ok(pole.all.length > 0 && pole.all.every((h) => !h.broke) && speed(b) < 8, `the pole stops it: ${speed(b)}`);
  const poleE = pole.all.reduce((s, h) => s + (h.energy ?? 0), 0);
  assert.ok(poleE > signE * 10, `pole ${poleE} J vs sign ${signE} J`);
  assert.ok((pole.world.wear?.get(0) ?? 0) > 0);
  // A bench: a light thing that holds a nudge (its meter drops) and gives to a real hit, slowing the car hard.
  const slow = moving(0, 3);
  const bench = hitsOf(slow, [{ kind: "disc", x: 0, z: 3.5, r: 0.5, breaks: true, strength: 30000, mass: 90 }], 60);
  assert.ok(bench.all.every((h) => !h.broke) && (bench.world.wear?.get(0) ?? 0) > 0, "a nudge dents it");
  const fast = moving(0, 20);
  const bench2 = hitsOf(fast, [{ kind: "disc", x: 0, z: 8, r: 0.5, breaks: true, strength: 30000, mass: 90 }], 60);
  assert.equal(bench2.all.filter((h) => h.broke).length, 1);
  assert.ok(speed(fast) < 18.8 && speed(fast) > 12, `slowed by the bench: ${speed(fast)}`);
});
