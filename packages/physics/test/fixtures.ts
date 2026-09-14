// The proof of concept's tests/physics-golden.test.mjs fixtures: recorded
// input sequences through fixed worlds (a course, a yard, a skim), the step
// trace that fingerprints a run to the bit, and the proof of concept's pins.
// Shared by test/golden.test.ts and test/poc-equality.test.ts.

import { createHash } from "node:crypto";
import type { Vec3Like } from "@keel-engine/core";
import { createCharacter } from "../src/character.ts";
import type { BodyInput, Character, CharacterSpec, Tuning } from "../src/character.ts";
import type { Box, Rail } from "../src/solids.ts";
import { dcos, dsin } from "@keel-engine/core"; // (the worlds and inputs too: a golden is only as portable as its fixtures)

export const DT = 1 / 120;
export const slab = (x0: number, x1: number, z0: number, z1: number, y = 0.35, mat = 1): Box => ({ c: [(x0 + x1) / 2, y - 1.5, (z0 + z1) / 2], h: [(x1 - x0) / 2, 1.5, (z1 - z0) / 2], mat });
export const wall = (x: number, z0: number, z1: number, top = 9, thick = 0.5, yaw = 0): Box => ({ c: [x, (top - 3) / 2, (z0 + z1) / 2], h: [thick / 2, (top + 3) / 2, (z1 - z0) / 2], yaw, mat: 0 });

/** A world for createCharacter (every field given). */
export interface World extends CharacterSpec {
  readonly boxes: Box[];
  readonly rails: Rail[];
  readonly waterY: number;
  readonly spawn: Vec3Like;
}

// A little course: a start pad, a walled corridor over water, a pad, a rail over water, a pad with a turned wall, hops.
export const COURSE: World = (() => {
  const boxes = [slab(-4, 4, -6, 15), wall(-3, 15, 33), wall(3, 15, 33), slab(-4, 4, 33, 40)];
  const rail: [number, number, number][] = [];
  for (let k = 0; k <= 10; k += 1) rail.push([dsin((Math.PI * k) / 10) ** 2 * 1.5, 1.1 + 0.3 * dsin((Math.PI * k) / 10), 41.5 + k * 1.6]);
  boxes.push(slab(-4, 4, 59, 68), { c: [1.5, 1.5, 64], h: [1.6, 3, 0.3], yaw: 0.4, mat: 0 });
  boxes.push(slab(-1.5, 1.5, 70.5, 73, 0.6), slab(-0.5, 2.5, 75.5, 78, 0.9), slab(-4, 4, 80.5, 90));
  return { boxes, rails: [rail], waterY: 0, spawn: [0, 0.45, -4] };
})();

/** A body (either implementation) as the trace reads it. */
export interface Traced {
  pos: number[];
  vel: number[];
  facing: number;
  mode: string;
  events: { type: string }[];
  step(dt: number, input: BodyInput): unknown;
}
export type Drive = (body: Character, i: number) => BodyInput;

// Every step, to the bit: position, velocity, mode, events.
export function trace(world: CharacterSpec, drive: Drive, steps: number, tuning?: Partial<Tuning>, make: (spec: CharacterSpec) => Traced = createCharacter) {
  const body = make({ ...world, tuning });
  const h = createHash("sha256");
  const buf = new Float64Array(7);
  const modes: Record<string, number> = {};
  const events: Record<string, number> = {};
  for (let i = 0; i < steps; i += 1) {
    body.step(DT, drive(body as Character, i));
    buf.set([...body.pos, ...body.vel, body.facing]);
    h.update(Buffer.from(buf.buffer));
    h.update(body.mode);
    for (const e of body.events) { h.update(e.type); events[e.type] = (events[e.type] ?? 0) + 1; }
    modes[body.mode] = (modes[body.mode] ?? 0) + 1;
  }
  return { hash: h.digest("hex").slice(0, 24), modes, events, body };
}

// A closed-loop pilot: its inputs are a pure function of the body's state, so the run is one recorded sequence.
export function coursePilot(body: Character, i: number): BodyInput {
  const [x, , z] = body.pos;
  let move: [number, number] = [0, 1];
  let jump = false;
  if (z > 11 && z < 15) move = [-0.55, 1]; // (angle at the left wall)
  if (z > 13.2 && z < 14 && body.mode === "ground") jump = true;
  if (body.mode === "wall" && body.wallTime > 0.5 && x < 0) jump = true; // (kick across)
  if (body.mode === "wall" && body.wallTime > 0.55 && x > 0) jump = true;
  if (z > 15 && z < 33 && body.mode === "air") move = [Math.sign(body.vel[0]) * 0.8, 1]; // (on across, the way the kick went)
  if (z > 36 && z < 40 && body.mode === "ground") { move = [-x * 0.6, 1]; jump = z > 39.2; }
  if (z > 40 && z < 58 && body.mode === "air") move = [-x * 0.6, 1];
  if (z > 66.5 && z < 68 && body.mode === "ground") jump = true;
  if (z > 72 && z < 73 && body.mode === "ground") jump = true;
  if (z > 77 && z < 78 && body.mode === "ground") jump = true;
  if (z > 86) move = [0, 0];
  return { move, jump, hold: !(i % 97 < 6) };
}

// An open-loop sequence: seeded (an LCG), the stick wandering, jumps tapped and held.
export function wanderInputs(seed: number): () => BodyInput {
  let s = seed >>> 0;
  const r = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  let a = r() * Math.PI * 2;
  let hold = 0;
  return () => {
    a += (r() - 0.5) * 0.35;
    const jump = r() < 0.02;
    if (jump) hold = Math.floor(r() * 40);
    hold = Math.max(0, hold - 1);
    return { move: r() < 0.05 ? [0, 0] : [dsin(a), dcos(a)], jump, hold: hold > 0 };
  };
}
// A yard of turned boxes (every yaw), steps and a trench of water.
export const YARD: World = (() => {
  const boxes = [slab(-12, 12, -12, 12, 0)];
  for (let k = 0; k < 16; k += 1) {
    const a = (k / 16) * Math.PI * 2;
    boxes.push({ c: [dsin(a) * 8, 1, dcos(a) * 8], h: [0.4 + (k % 3) * 0.3, 1 + (k % 4), 1.2], yaw: a + 0.3 * k, mat: 0 });
  }
  boxes.push({ c: [2, 0.25, 2], h: [1, 0.25, 1], yaw: 0.7 }, { c: [2, 0.6, 2], h: [0.6, 0.6, 0.6], yaw: 1.1 });
  boxes.push(slab(-3, 3, 14, 20, 0), { c: [0, -0.2, 13], h: [12, 0.1, 1], mat: 1 });
  return { boxes, rails: [[[-6, 1.3, -5], [-2, 1.6, -5], [3, 1.4, -4]]], waterY: -0.6, spawn: [0, 0.6, 0] };
})();
export const SKIM: World = { boxes: [slab(-3, 3, -3, 6, 0.4)], rails: [], waterY: 0, spawn: [0, 0.5, -2] };
export const skimDrive: Drive = (_b, i) => ({ move: [0, i < 300 ? 1 : 0], jump: false, hold: false });

// Pinned by the proof of concept before wedges existed (2026-09-13); yard2 re-pinned there on purpose
// when the wall-run stopped wrapping round a wall's end. The coverage the course must still show is asserted too.
//
// RE-PINNED 2026-09-14, on purpose, for determinism across platforms: the body (and these fixtures) moved
// from Math.sin/cos/atan2 to core's dmath. The old pins were the proof of concept's, made on an arm64 Mac,
// whose V8 runs fdlibm compiled with fused multiply-adds -- x64 CI (Node 22.23.2) got other bits and failed
// all four. The new pins are pure fdlibm's, the same on every CPU, and are exactly what x64 CI computed with
// native Math before this change (V8 on x64 is pure fdlibm). skim never turns, so it never moved.
//   was: course 0c3e439720e333960674580a, yard1 add14accf73f1181cdd00ecd,
//        yard2 3289a9b11f19199fad2d6fe8, yard3 0bc197782ded99aecbcc2ebc
export const PINS = {
  course: "4bbb6fabf059594d741b59e7",
  yard1: "3d29f88fd5e78609067bce28",
  yard2: "057d190cd56523ab23483ce7",
  yard3: "eb2ab619de1434e82dc34b81",
  skim: "5bf9036cf92fe1f7a408477b",
} as const;

