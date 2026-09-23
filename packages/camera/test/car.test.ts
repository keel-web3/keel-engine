import assert from "node:assert/strict";
import { test } from "node:test";
import { createCarCamera, mirrorShot } from "../src/index.ts";
import type { CarPose, CarShot } from "../src/index.ts";

const POSE: CarPose = {
  x: 0, z: 0, yaw: 0, speed: 20, halfLength: 2.2, height: 1.3,
  hood: { along: 0.9, up: 1.2, noseAlong: 2.2, noseUp: 0.5 },
  cockpit: { along: -0.2, up: 1.15, side: -0.35 },
};

test("car camera: C runs chase, cockpit, dash, first person and round again", () => {
  const cam = createCarCamera();
  assert.deepEqual([cam.cycle(), cam.cycle(), cam.cycle(), cam.cycle()], ["cockpit", "dash", "first", "chase"]);
});

test("car camera: the cockpit sits in the driver's seat -- behind the hood cam, under the roof, off to the driver's side -- and sees the nose", () => {
  const cam = createCarCamera({ mode: "cockpit" });
  const shot = cam.step(POSE, 1 / 60);
  assert.ok(Math.abs(shot.eye[2] - -0.2) < 1e-9 && shot.eye[1] < POSE.height && Math.abs(shot.eye[0] - -0.35) < 1e-9);
  cam.mode = "hood";
  assert.ok(cam.step(POSE, 1 / 60).eye[2] > shot.eye[2]);
  // (Looking down the road and tipped toward the nose: the nose's tip is below the line of sight, inside the lens.)
  const down = Math.atan2(shot.eye[1] - shot.target[1], shot.target[2] - shot.eye[2]);
  const toNose = Math.atan2(shot.eye[1] - 0.5, 2.2 - -0.2);
  assert.ok(down > 0 && toNose - down < shot.fov / 2, `tip ${down}, nose ${toNose}`);
});

test("car camera: the dash view frames the bonnet to a quarter of the screen, whatever the car's nose does", () => {
  for (const noseUp of [0.35, 0.6, 0.9]) {
    const cam = createCarCamera({ mode: "dash" });
    const pose: CarPose = { ...POSE, hood: { along: 0.9, up: 1.2, noseAlong: 2.2, noseUp }, dash: { along: 0.7, up: 1.15 } };
    const shot = cam.step(pose, 1 / 60);
    // The nose's share of the picture up from the bottom, by the exact tangent: a quarter.
    const sight = Math.atan2(shot.eye[1] - shot.target[1], shot.target[2] - shot.eye[2]);
    const nose = Math.atan2(shot.eye[1] - noseUp, 2.2 - 0.7);
    assert.ok(Math.abs(0.5 - Math.tan(nose - sight) / (2 * Math.tan(shot.fov / 2)) - 0.25) < 1e-9, `nose up ${noseUp}`);
  }
});

/** Where a car-frame point lands, as a share of the picture's height up from the bottom (a level car at the origin facing +z). */
const shareOf = (shot: CarShot, fov: number, p: readonly [number, number, number]): number => {
  const sight = Math.atan2(shot.eye[1] - shot.target[1], shot.target[2] - shot.eye[2]);
  const dep = Math.atan2(shot.eye[1] - p[1], p[2] - shot.eye[2]);
  // (Past the picture's bottom edge -- or behind the lens altogether -- it's not in the picture.)
  return dep - sight < fov / 2 ? 0.5 - Math.tan(dep - sight) / (2 * Math.tan(fov / 2)) : -Infinity;
};

test("car camera: with the body's crest, the dash view frames what stands highest -- a scoop -- not the nose, through the lens that's drawn", () => {
  // A flat bonnet at 0.8 with a scoop on it rising to 1.0, 0.6 m ahead of the eye; the nose at 0.5.
  const crest: number[] = [];
  for (let i = 0; i <= 28; i += 1) for (let j = -4; j <= 4; j += 1) { const z = 0.8 + i * 0.05, x = j * 0.2; crest.push(z, Math.abs(z - 1.3) < 0.15 && Math.abs(x) < 0.3 ? 1.0 : 0.8, x, x); }
  const pose: CarPose = { ...POSE, hood: { along: 0.9, up: 1.2, noseAlong: 2.2, noseUp: 0.5, crest }, dash: { along: 0.7, up: 1.15 } };
  for (const lens of [undefined, { widen: 0.3, kick: 1.185, aspect: 9 / 16 }]) {
    const cam = createCarCamera({ mode: "dash" });
    let shot!: CarShot;
    for (let f = 0; f < 60; f += 1) shot = cam.step({ ...pose, ...(lens ? { lens } : {}) }, 0.1);
    const fov = (shot.fov + (lens?.widen ?? 0)) * (lens?.kick ?? 1);
    let top = -Infinity;
    for (let i = 0; i < crest.length; i += 4) if (Math.abs(crest[i + 2]!) < 0.05) top = Math.max(top, shareOf(shot, fov, [0, crest[i + 1]!, crest[i]!]));
    assert.ok(Math.abs(top - 0.25) < 1e-6, `the scoop's top at a quarter (${JSON.stringify(lens)}: ${top})`);
    assert.ok(shareOf(shot, fov, [0, 0.5, 2.2]) < 0.25, "the nose below it");
  }
});

test("car camera: something on the bonnet as high as the eye lifts the eye clear of it, and the view leans with the body", () => {
  const crest = [0.85, 1.2, 0, 0, 1.5, 0.8, 0, 0, 2.2, 0.6, 0, 0];
  const pose: CarPose = { ...POSE, hood: { along: 0.9, up: 1.2, noseAlong: 2.2, noseUp: 0.5, crest }, dash: { along: 0.7, up: 1.15 } };
  const shot = createCarCamera({ mode: "dash" }).step(pose, 1 / 60);
  assert.ok(shot.eye[1] > 1.2 && shot.eye[1] < 1.3, `eye ${shot.eye[1]}`);
  // (Nose down 0.05: the stack's top stays where it was in the picture -- the eye and the view turn with the body.)
  const level = createCarCamera({ mode: "dash" }).step(pose, 1 / 60), down = createCarCamera({ mode: "dash" }).step({ ...pose, pitch: 0.05 }, 1 / 60);
  const turned = (p: readonly [number, number, number], a: number): [number, number, number] => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
  const inView = (s: CarShot, p: readonly [number, number, number]): number => {
    const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]], l = Math.hypot(f[0]!, f[1]!, f[2]!);
    const d = [p[0] - s.eye[0], p[1] - s.eye[1], p[2] - s.eye[2]], fd = (d[0]! * f[0]! + d[1]! * f[1]! + d[2]! * f[2]!) / l;
    const upv = [0, f[2]! / l, -f[1]! / l];
    return (d[1]! * upv[1]! + d[2]! * upv[2]!) / fd;
  };
  const stack: [number, number, number] = [0, 1.2, 1.5];
  assert.ok(Math.abs(inView(level, stack) - inView(down, turned(stack, 0.05))) < 1e-9);
});

test("car camera: a mirror looks back from the eye", () => {
  const m = mirrorShot([0, 1.1, 0], 0);
  assert.ok(m.target[2] < -20 && m.target[1] < 1.1 && m.fov < 1);
});

test("car camera: on a hill every view rises with the ground under the car", () => {
  for (const mode of ["chase", "cockpit", "dash", "first"] as const) {
    const flat = createCarCamera({ mode }).step(POSE, 1 / 60), hill = createCarCamera({ mode }).step({ ...POSE, y: 12 }, 1 / 60);
    assert.ok(Math.abs(hill.eye[1] - flat.eye[1] - 12) < 1e-9 && Math.abs(hill.target[1] - flat.target[1] - 12) < 1e-9, mode);
  }
});
