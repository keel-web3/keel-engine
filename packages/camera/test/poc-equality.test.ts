// The TypeScript camera against the JavaScript proof of concept it was ported
// from (src/camera/camera.js, imported from its repo, never written to): the
// helpers over random inputs (clearance, sphereCast, armPath, normalAt,
// frameView, rails scrubbed), and whole cameras stepped side by side over long
// runs in every mode -- mode switches and blends, shake and thuds, fov kicks,
// target sizes, rig options, custom rigs -- every field, every rig's own
// state and every view, to the bit.
//
// Gated on the two fixes (README "Fixes"): worlds here are boxes (and floors
// and SDFs) with no wedges, and subjects are 0.8 m tall or more -- where the
// proof of concept and the port must agree. test/fixes.test.ts shows where
// they part.

import { test } from "node:test";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { createCharacter } from "@keel-engine/physics";
import type { Box } from "@keel-engine/physics";
import * as tCam from "../src/camera.ts";
import type { Camera, CameraOptions, CameraWorld, Rig, Subject } from "../src/camera.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
const J = hasPoc ? await poc<typeof tCam>("src/camera/camera.js") : (null as unknown as typeof tCam);
const { same, exact, summary } = counter();

const r3 = (r: () => number, s = 1): Vec3 => [(r() * 2 - 1) * s, (r() * 2 - 1) * s, (r() * 2 - 1) * s];
const exactN = (k: string, a: readonly number[] | null | undefined, b: readonly number[] | null | undefined, msg: string): void => {
  if (!a || !b) { same(k, a ?? null, b ?? null, msg); return; }
  same(k, a.length, b.length, `${msg} length`);
  a.forEach((v, i) => exact(k, v, b[i], `${msg}[${i}]`));
};

// A random world of boxes (turned walls, pads, roofs, posts), sometimes a floor plane or an SDF.
function worldOf(seed: number): CameraWorld & { boxes: Box[] } {
  const r = rand(seed);
  const boxes: Box[] = [{ c: [0, -1, 0], h: [30, 1, 30], mat: 1 }];
  const n = 2 + Math.floor(r() * 12);
  for (let k = 0; k < n; k += 1) {
    const c: Vec3 = [(r() * 2 - 1) * 8, 0, (r() * 2 - 1) * 8];
    const yaw = r() < 0.3 ? 0 : (r() * 2 - 1) * Math.PI;
    const kind = r();
    if (kind < 0.4) boxes.push({ c: [c[0], 1.5 + r() * 2, c[2]], h: [0.1 + r() * 0.4, 1.5 + r() * 2, 1 + r() * 5], yaw }); // (a wall)
    else if (kind < 0.6) boxes.push({ c: [c[0], 1.8 + r() * 1.5, c[2]], h: [1 + r() * 3, 0.1 + r() * 0.3, 1 + r() * 3], yaw }); // (a roof)
    else if (kind < 0.8) { const hy = 0.1 + r() * 0.6; boxes.push({ c: [c[0], hy, c[2]], h: [0.5 + r() * 2, hy, 0.5 + r() * 2], yaw }); } // (a pad)
    else boxes.push({ c: [c[0], 1, c[2]], h: [0.1 + r() * 0.3, 1 + r(), 0.1 + r() * 0.3], yaw }); // (a post)
  }
  const floorY = r() < 0.2 ? -0.5 : undefined;
  const ball = r3(r, 5);
  const distance = r() < 0.15 ? (p: Vec3Like): number => Math.hypot(p[0] - ball[0], p[1] - 1 - ball[1] * 0.2, p[2] - ball[2]) - 0.8 : undefined;
  return { boxes, floorY, distance };
}

test("helpers: clearance, sphereCast, armPath, alongPath, normalAt, frameView, boundsOf, fov helpers", { skip }, () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const world = worldOf(seed);
    const r = rand(seed * 5 + 1);
    for (let i = 0; i < 150; i += 1) {
      const p: Vec3 = [(r() * 2 - 1) * 9, r() * 5, (r() * 2 - 1) * 9];
      const q: Vec3 = [(r() * 2 - 1) * 9, r() * 5, (r() * 2 - 1) * 9];
      const rad = 0.05 + r() * 0.3;
      exact("clearance", tCam.clearance(world, p), J.clearance(world, p));
      exactN("normalAt", tCam.normalAt(world, p), J.normalAt(world, p), "normalAt");
      exact("sphereCast", tCam.sphereCast(world, p, q, rad), J.sphereCast(world, p, q, rad));
      const a = tCam.armPath(world, p, q, rad);
      const b = J.armPath(world, p, q, rad);
      exact("armPath", a.reach, b.reach);
      same("armPath", a.points.length, b.points.length);
      a.points.forEach((pt, k) => exactN("armPath", pt, b.points[k], "point"));
      const s = r() * (a.reach + 1);
      exactN("alongPath", tCam.alongPath(a.points, s), J.alongPath(b.points, s), "alongPath");
    }
  }
  const r = rand(99);
  for (let i = 0; i < 4000; i += 1) {
    const [w, h] = [1 + Math.floor(r() * 400), 1 + Math.floor(r() * 400)];
    exact("fov helpers", tCam.fovForTarget(w, h), J.fovForTarget(w, h));
    exact("fov helpers", tCam.fillForTarget(w, h), J.fillForTarget(w, h));
    const pos = r3(r, 4);
    const kind = r();
    const s: Subject = kind < 0.3 ? { pos, yaw: r() * 6 - 3, height: 0.5 + r() * 2, radius: 0.1 + r() * 0.5 }
      : kind < 0.6 ? { pos, vel: r() < 0.2 ? [0, 0, 0] : r3(r, 5), bounds: [pos[0] - r(), pos[1], pos[2] - r(), pos[0] + r(), pos[1] + 0.2 + r() * 2, pos[2] + r()] }
      : { pos, yaw: r() * 6 - 3, bounds: { min: [pos[0] - 1, pos[1], pos[2] - 0.5], max: [pos[0] + 1, pos[1] + r() * 3, pos[2] + 0.5] } };
    same("boundsOf", tCam.boundsOf(s), J.boundsOf(s));
    const front = r() < 0.5 ? undefined : r() < 0.5 ? r() * 6 - 3 : r3(r);
    const o = { front, turn: r() * 2 - 1, elevation: r() * 0.8 - 0.2, fov: 0.4 + r() * 1.2, aspect: 0.4 + r() * 2, fill: 0.3 + r() * 0.65, near: 0.1 + r() * 0.5 };
    same("frameView", tCam.frameView(s, o), J.frameView(s, o));
  }
  for (let i = 0; i < 2000; i += 1) { const y = r() * 8 - 4; const p = r() * 3 - 1.5; exactN("dirOf", tCam.dirOf(y, p), J.dirOf(y, p), "dirOf"); }
});

test("rails: keys scrubbed at any time, looped and held, fovs and missing targets", { skip }, () => {
  const r = rand(7);
  for (let seed = 0; seed < 300; seed += 1) {
    const n = 1 + Math.floor(r() * 6);
    let at = r() * 2;
    const keys = Array.from({ length: n }, () => {
      at += r() < 0.1 ? 0 : 0.2 + r() * 3;
      const k: tCam.RailKey = { at, eye: r3(r, 6), ...(r() < 0.6 ? { target: r3(r, 2) } : {}), ...(r() < 0.5 ? { fov: 0.5 + r() } : {}) };
      return k;
    });
    const opt = { keys, loop: r() < 0.6, speed: 0.5 + r() * 2, period: r() < 0.3 ? 1 + r() * 10 : null };
    const a = tCam.railRig(opt);
    const b = J.railRig(opt);
    const s: Subject | null = r() < 0.8 ? { pos: r3(r, 3), height: 0.8 + r() } : null;
    for (let i = 0; i < 40; i += 1) {
      const t = r() * 30 - 5;
      same("rail scrubs", a.at(t, s), b.at(t, s));
    }
  }
});

// Every field of two cameras (and each rig's own state), to the bit.
function sameCam(a: Camera, b: Camera, msg: string): void {
  exactN("camera eye/target", a.eye, b.eye, `${msg} eye`);
  exactN("camera eye/target", a.target, b.target, `${msg} target`);
  for (const k of ["fov", "yaw", "pitch", "time", "trauma", "nod", "nodVel", "nearSubject", "aspect", "baseFov"] as const) exact("camera numbers", a[k], b[k], `${msg} ${k}`);
  same("camera flags", [a.mode, a.width, a.height, a.hidesSubject], [b.mode, b.width, b.height, b.hidesSubject], msg);
  const va = a.view();
  const vb = b.view();
  exactN("views", va.eye, vb.eye, `${msg} view eye`);
  exactN("views", va.target, vb.target, `${msg} view target`);
  exact("views", va.fov, vb.fov, `${msg} view fov`);
  const m = a.move(1, 0.3);
  exactN("camera move", m, b.move(1, 0.3), `${msg} move`);
  const ra = a.rigs as unknown as Record<string, Record<string, unknown>>;
  const rb = b.rigs as unknown as Record<string, Record<string, unknown>>;
  for (const name of ["orbit", "chase", "first", "frame", "rail", "fixed"]) {
    for (const k of ["yaw", "pitch", "pivot", "arm", "armVel", "idle", "side", "eye", "look", "reach", "turn", "target", "t"]) {
      const x = ra[name]![k];
      if (x === undefined) continue;
      if (Array.isArray(x)) exactN("rig state", x as number[], rb[name]![k] as number[], `${msg} ${name}.${k}`);
      else if (typeof x === "number") exact("rig state", x, rb[name]![k], `${msg} ${name}.${k}`);
      else same("rig state", x, rb[name]![k], `${msg} ${name}.${k}`);
    }
  }
}

// A custom rig (the same one, made twice): circles the subject.
const circleRig = (): Rig<{ r: number }> & { a: number } => {
  const rig = {
    name: "circle", opt: { r: 4 }, a: 0,
    enter() { rig.a = 0; },
    step(dt: number, s: Subject) { rig.a += dt; return { eye: [s.pos[0] + Math.sin(rig.a) * rig.opt.r, s.pos[1] + 2, s.pos[2] + Math.cos(rig.a) * rig.opt.r] as Vec3, target: [s.pos[0], s.pos[1] + 1, s.pos[2]] as Vec3, fov: 0.9 }; },
  };
  return rig;
};

const MODES = ["orbit", "chase", "first", "frame", "rail", "fixed", "circle"] as const;

function optionsOf(r: () => number): CameraOptions {
  const px = [24, 32, 48, 64, 96, 128, 200][Math.floor(r() * 7)]!;
  const keys: tCam.RailKey[] = [{ at: 0, eye: [0, 3, -6] }, { at: 1.5, eye: [5, 4, 0], target: [0, 1, 0], fov: 0.8 }, { at: 3, eye: [0, 2, 6], fov: 1.2 }, { at: 5, eye: [-5, 5, 0] }];
  return {
    mode: MODES[Math.floor(r() * 6)]!,
    width: px, height: r() < 0.3 ? Math.round(px * (0.5 + r())) : px,
    ...(r() < 0.2 ? { fov: 0.6 + r() * 0.8 } : {}),
    blend: r() < 0.2 ? 0 : 0.1 + r() * 0.5,
    fovKick: r() < 0.5 ? 0 : r() * 0.15,
    kickSpeeds: [3 + r() * 3, 8 + r() * 6],
    hideWithin: 0.2 + r() * 0.4,
    shake: { max: 0.02 + r() * 0.06, decay: 0.5 + r() * 2 },
    orbit: { shoulder: r() < 0.5 ? 0 : r() - 0.5, recenter: r() < 0.5 ? 0 : 0.5 + r(), distance: 2 + r() * 3, radius: 0.1 + r() * 0.2 },
    chase: { distance: 2 + r() * 2, lookAhead: r() * 2, swing: r() * 2 },
    frame: { spin: r() < 0.5 ? 0 : r() * 2 - 1, rate: r() < 0.3 ? 0 : 2 + r() * 6, ...(r() < 0.3 ? { pixels: 10 + r() * 40 } : {}), ...(r() < 0.2 ? { fill: 0.5 + r() * 0.4 } : {}), ...(r() < 0.2 ? { front: r() * 6 } : {}), collide: r() < 0.8 },
    rail: { keys, loop: r() < 0.7, speed: 0.5 + r() },
    fixed: r() < 0.5 ? { eye: [3, 4, -5] } : { eye: [0, 6, 0], target: [0, 0, 5] },
    rigs: { circle: circleRig() },
  };
}

test("cameras: 48 long runs through random worlds, every mode, switches, blends, shake, kicks -- every field every step", { skip }, () => {
  const seen: Record<string, number> = {};
  for (let seed = 1; seed <= 48; seed += 1) {
    const r = rand(seed * 17 + 5);
    const world = worldOf(seed);
    const o = optionsOf(r);
    const a = tCam.createCamera(o);
    const b = J.createCamera({ ...o, rigs: { circle: circleRig() } });
    const body = createCharacter({ boxes: world.boxes, waterY: -5, spawn: [0, 0.5, 0] });
    const height = 0.8 + r() * 1.2;
    let yaw = r() * 6;
    for (let i = 0; i < 1500; i += 1) {
      if (r() < 0.006) { const m = MODES[Math.floor(r() * MODES.length)]!; const blend = r() < 0.5 ? {} : { blend: r() * 0.6 }; a.setMode(m, blend); b.setMode(m, blend); }
      if (r() < 0.01) { const s = r(); a.shake(s); b.shake(s); }
      if (r() < 0.008) { const t = r() * 0.1; a.thud(t); b.thud(t); }
      if (r() < 0.003) { const w = 16 + Math.floor(r() * 300); const h = 16 + Math.floor(r() * 300); a.setTarget(w, h); b.setTarget(w, h); }
      yaw += (r() - 0.5) * 0.2;
      body.step(1 / 120, { move: a.move(r() < 0.1 ? 0 : 1, Math.sin(yaw)), jump: r() < 0.02, hold: r() < 0.7 });
      const subject = tCam.subjectOf(body, { height, radius: 0.2 + r() * 0.1 });
      same("subjectOf", subject, J.subjectOf(body, { height: subject.height!, radius: subject.radius! }));
      const look = r() < 0.4 ? {} : { look: [(r() - 0.5) * 0.05, (r() - 0.5) * 0.03] as const };
      const dt = r() < 0.95 ? 1 / 120 : r() * 0.03;
      a.step(dt, subject, world, look);
      b.step(dt, subject, world, look);
      sameCam(a, b, `seed ${seed} step ${i}`);
      seen[a.mode] = (seen[a.mode] ?? 0) + 1;
    }
  }
  for (const m of MODES) if (!seen[m]) throw new Error(`no run stepped ${m}: ${JSON.stringify(seen)}`);
  console.log(summary("camera equality (TS vs the proof of concept)"), `\n  steps by mode: ${JSON.stringify(seen)}`);
});
