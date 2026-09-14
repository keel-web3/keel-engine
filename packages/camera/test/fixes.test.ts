// What the port does that the proof of concept didn't (README "Fixes"), each
// shown against the proof of concept where it parts from it:
//
//   1. the arm collides with wedges as wedges: solidDistance over world.boxes
//      (a wedge among them) and world.wedges (the proof of concept took every
//      solid for a box, and never looked at world.wedges);
//   2. a small subject's arm starts at least radius + skin over its feet (the
//      proof of concept started it at half the height: under 0.4 m that is in
//      the floor's room and the eye sat in the floor; it changes outputs under 0.56 m);
//   3. save() / load(): the camera's private state (the blend, the fov kick,
//      entering, every rig's own state) as plain JSON, so a loaded camera takes
//      the very steps the saved one would have.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Vec3 } from "@keel-engine/core";
import { createCharacter, solidDistance } from "@keel-engine/physics";
import type { Box, Wedge } from "@keel-engine/physics";
import * as tCam from "../src/camera.ts";
import type { Camera, CameraOptions, CameraState, CameraWorld, Subject } from "../src/camera.ts";
import { POC, hasPoc, poc, rand } from "./reference.ts";

const STEP = 1 / 120;
const J = hasPoc ? await poc<typeof tCam>("src/camera/camera.js") : null;
const needsPoc = hasPoc ? false : `the proof of concept not found at ${POC}`;
const FLOOR: Box = { c: [0, -1, 0], h: [40, 1, 40] };
const RADIUS = 0.2;

// A ramp behind a subject facing +z: its foot toward the subject (local +z), its high face 7 m back.
const RAMP: Wedge = { kind: "wedge", c: [0, 1.25, -4], h: [3, 1.25, 3] };

test("fix 1: a wedge on the wedges list keeps the arm out (the proof of concept never saw it)", { skip: needsPoc }, () => {
  const s: Subject = { pos: [0, 0, 0], yaw: 0, vel: [0, 0, 0], height: 1.1, radius: 0.26 };
  const world: CameraWorld = { boxes: [FLOOR], wedges: [RAMP] };
  let pocInside = 0;
  for (const pitch of [-0.1, -0.3, -0.5]) {
    const a = tCam.createCamera({ mode: "orbit", orbit: { pitch, distance: 6 } });
    const b = J!.createCamera({ mode: "orbit", orbit: { pitch, distance: 6 } });
    for (let i = 0; i < 240; i += 1) {
      a.step(STEP, s, world, { look: [Math.sin(i * 0.03) * 0.01, 0] });
      b.step(STEP, s, world, { look: [Math.sin(i * 0.03) * 0.01, 0] });
      assert.ok(solidDistance(a.eye, RAMP).d >= RADIUS - 2e-3, `the port's eye is out of the ramp (pitch ${pitch}, step ${i})`);
      if (solidDistance(b.eye, RAMP).d < RADIUS - 2e-3) pocInside += 1;
    }
  }
  assert.ok(pocInside > 0, "and the proof of concept's went into it");
});

test("fix 1: a wedge among the boxes is its slope, not its box: the arm keeps the room over the slope", { skip: needsPoc }, () => {
  const s: Subject = { pos: [0, 0, 0], yaw: 0, vel: [0, 0, 0], height: 1.1, radius: 0.26 };
  const world: CameraWorld = { boxes: [FLOOR, RAMP] };
  const a = tCam.createCamera({ mode: "orbit", orbit: { pitch: -0.35, distance: 5 } });
  const b = J!.createCamera({ mode: "orbit", orbit: { pitch: -0.35, distance: 5 } });
  for (let i = 0; i < 120; i += 1) { a.step(STEP, s, world); b.step(STEP, s, world); }
  assert.ok(solidDistance(a.eye, RAMP).d >= RADIUS - 2e-3, "out of the ramp");
  assert.ok(a.rigs.orbit.arm! > b.rigs.orbit.arm! + 0.3, `a longer arm over the slope (${a.rigs.orbit.arm!.toFixed(2)} vs the box's ${b.rigs.orbit.arm!.toFixed(2)})`);
  // (clearance, normalAt and armPath dispatch the same way.)
  const p: Vec3 = [0, 2.2, -3];
  assert.equal(tCam.clearance(world, p), Math.min(solidDistance(p, FLOOR).d, solidDistance(p, RAMP).d));
  assert.ok(tCam.clearance(world, p) > J!.clearance(world, p) + 0.2);
});

test("fix 1: a boxes-only world is untouched (the equality tests hold it to the bit)", { skip: needsPoc }, () => {
  const world: CameraWorld = { boxes: [FLOOR, { c: [0, 2, -1.5], h: [3, 3, 0.3] }] };
  const r = rand(4);
  for (let i = 0; i < 500; i += 1) {
    const p: Vec3 = [r() * 6 - 3, r() * 4, r() * 6 - 3];
    assert.equal(tCam.clearance(world, p), J!.clearance(world, p));
    assert.deepEqual(tCam.normalAt(world, p), J!.normalAt(world, p));
  }
});

test("fix 2: a small subject's arm starts over the floor's room -- the eye is never in the floor", { skip: needsPoc }, () => {
  for (const height of [0.1, 0.2, 0.3, 0.45]) {
    for (const mode of ["orbit", "frame"] as const) {
      const s: Subject = { pos: [0, 0, 0], yaw: 0.3, vel: [0, 0, 0], height, radius: height * 0.4 };
      const world: CameraWorld = { boxes: [FLOOR] };
      const a = tCam.createCamera({ mode });
      const b = J!.createCamera({ mode });
      let pocIn = 0;
      for (let i = 0; i < 240; i += 1) {
        a.step(STEP, s, world, { look: [0.01, Math.sin(i * 0.05) * 0.01] });
        b.step(STEP, s, world, { look: [0.01, Math.sin(i * 0.05) * 0.01] });
        assert.ok(a.eye[1] >= RADIUS - 2e-3, `${mode} ${height} m: the eye has its room over the floor (${a.eye[1].toFixed(3)})`);
        if (b.eye[1] < RADIUS - 2e-3) pocIn += 1;
      }
      // (Under 0.4 m -- its middle inside the arm's radius of the floor -- the proof of concept's sweep got nowhere.)
      if (mode === "orbit" && height < 0.4) assert.ok(pocIn > 0, `the proof of concept's ${height} m orbit eye went into the floor's room`);
      if (mode === "orbit") assert.ok(Math.hypot(a.eye[0] - s.pos[0], a.eye[2] - s.pos[2]) > 1, "and the arm reaches out, not stuck on the subject");
    }
  }
  // At 0.56 m and up nothing changes (the equality tests step 0.8 m and up).
  for (const height of [0.56, 0.7, 1.1]) {
    const s: Subject = { pos: [0, 0, 0], yaw: 0.3, vel: [0, 0, 0], height };
    const a = tCam.createCamera({ mode: "orbit" });
    const b = J!.createCamera({ mode: "orbit" });
    for (let i = 0; i < 60; i += 1) { a.step(STEP, s, { boxes: [FLOOR] }); b.step(STEP, s, { boxes: [FLOOR] }); }
    assert.deepEqual(a.view(), b.view(), `${height} m`);
  }
});

// ---- save / load

const OPTIONS: CameraOptions = { mode: "chase", width: 96, height: 64, fovKick: 0.1, rail: { keys: [{ at: 0, eye: [0, 3, -5] }, { at: 2, eye: [4, 3, 0], fov: 0.9 }, { at: 4, eye: [0, 3, 5] }] }, frame: { spin: 0.5 } };
const MODES = ["orbit", "chase", "first", "frame", "rail", "fixed"] as const;

// A run whose every choice is a function of the step (so two runs can take the same steps).
function drive(cam: Camera, body: ReturnType<typeof createCharacter>, world: CameraWorld, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i += 1) {
    if (i % 173 === 40) cam.setMode(MODES[(i * 7) % MODES.length]!, { blend: 0.4 });
    if (i % 97 === 0) cam.shake(0.3).thud(0.02);
    if (i === 700) cam.setTarget(128, 128);
    body.step(STEP, { move: cam.move(1, Math.sin(i * 0.02)), jump: i % 130 === 0, hold: i % 130 < 30 });
    cam.step(STEP, tCam.subjectOf(body), world, { look: [Math.sin(i * 0.011) * 0.01, Math.cos(i * 0.017) * 0.005] });
    const v = cam.view();
    out.push(...v.eye, ...v.target, v.fov, cam.yaw, cam.pitch, cam.nearSubject, cam.hidesSubject ? 1 : 0);
  }
  return out;
}

test("save/load: a camera loaded mid-run (mid-blend, mid-shake, any mode) takes the very steps the saved one would", () => {
  const world: CameraWorld = { boxes: [FLOOR, { c: [3, 2, 6], h: [0.3, 3, 4] }, { c: [-2, 2.4, 10], h: [2, 0.3, 3] }] };
  for (const at of [0, 1, 41, 45, 300, 555, 700, 901, 1111]) {
    const a = tCam.createCamera(OPTIONS);
    const bodyA = createCharacter({ boxes: world.boxes!, waterY: -10, spawn: [0, 0.1, 0] });
    drive(a, bodyA, world, 0, at);
    const saved: CameraState = JSON.parse(JSON.stringify(a.save())) as CameraState;
    // (The body is saved by its own fields: a copy of them.)
    const bodyB = createCharacter({ boxes: world.boxes!, waterY: -10, spawn: [0, 0.1, 0] });
    Object.assign(bodyB, structuredClone({ ...bodyA, step: undefined, events: [] }), { step: bodyB.step });
    const b = tCam.createCamera(OPTIONS).load(saved);
    assert.deepEqual(b.save(), saved, `at ${at}: load then save gives the state back`);
    const rest = 1300 - at;
    assert.deepEqual(drive(b, bodyB, world, at, at + rest), drive(a, bodyA, world, at, at + rest), `loaded at step ${at}: the same run, to the bit`);
  }
  assert.throws(() => tCam.createCamera().load({ schema: "nope" } as unknown as CameraState));
});
