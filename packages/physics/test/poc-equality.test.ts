// The TypeScript body against the JavaScript proof of concept it was ported
// from (src/physics/character.js, imported from its repo, never written to):
// the solids' distances over random points and solids, and whole bodies
// stepped side by side -- every field after every step, to the bit
// (position, velocity, mode, facing, timers, wall, rail, slope, checkpoint,
// and every event with its payload) -- over the golden runs and many random
// worlds of boxes, wedges, rails and water driven by random input streams.

import { test } from "node:test";
import type { Vec3 } from "@keel-engine/core";
import * as tChar from "../src/character.ts";
import * as tSol from "../src/solids.ts";
import type { BodyInput, Character, CharacterSpec } from "../src/character.ts";
import type { Box, Rail, Solid, Wedge } from "../src/solids.ts";
import { COURSE, DT, SKIM, YARD, coursePilot, skimDrive, trace, wanderInputs } from "./fixtures.ts";
import type { Drive } from "./fixtures.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

type Phys = typeof tChar & typeof tSol;
const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
const J = hasPoc ? await poc<Phys>("src/physics/character.js") : (null as unknown as Phys);
const { same, exact, summary } = counter();

const r3 = (r: () => number, s = 1): Vec3 => [(r() * 2 - 1) * s, (r() * 2 - 1) * s, (r() * 2 - 1) * s];
const exact3 = (k: string, a: readonly number[] | null, b: readonly number[] | null, msg: string): void => {
  if (a === null || b === null) { same(k, a, b, msg); return; }
  for (let i = 0; i < 3; i += 1) exact(k, a[i], b[i], `${msg}[${i}]`);
};

test("solids: boxDistance, wedgeDistance, solidDistance, wedgeSection, slopeOf, nearestOnRail", { skip }, () => {
  const r = rand(11);
  for (let i = 0; i < 20000; i += 1) {
    const s = r() < 0.5 ? 1 : 4;
    const c = r3(r, s);
    const h: Vec3 = [0.01 + r() * s, 0.01 + r() * s, 0.01 + r() * s];
    const yaw = r() < 0.1 ? undefined : (r() * 2 - 1) * 7;
    const lo = r() < 0.3 ? undefined : r() * 1.2 - 0.1;
    const p = r() < 0.05 ? c : r3(r, s * 2);
    const box: Box = { c, h, yaw };
    const wedge: Wedge = { kind: "wedge", c, h, yaw, lo };
    same("boxDistance", tSol.boxDistance(p, box), J.boxDistance(p, box));
    const a = tSol.wedgeDistance(p, wedge);
    const b = J.wedgeDistance(p, wedge);
    exact("wedgeDistance", a.d, b.d, "d");
    exact3("wedgeDistance", a.n, b.n, "n");
    same("solidDistance", tSol.solidDistance(p, wedge), J.solidDistance(p, wedge));
    same("solidDistance", tSol.solidDistance(p, box), J.solidDistance(p, box));
    same("wedgeSection", tSol.wedgeSection(wedge), J.wedgeSection(wedge));
    exact("slopeOf", tSol.slopeOf(wedge), J.slopeOf(wedge));
    if (i % 4 === 0) {
      const n = 1 + Math.floor(r() * 7);
      const rail: Vec3[] = Array.from({ length: n }, () => r3(r, 5));
      if (r() < 0.05 && n > 1) rail[1] = [...rail[0]!]; // (a zero-length segment)
      same("nearestOnRail", tSol.nearestOnRail(p, rail), J.nearestOnRail(p, rail));
    }
  }
  same("TUNING", { ...tChar.TUNING }, { ...J.TUNING });
});

// Every field of two bodies, to the bit.
function sameBody(a: Character, b: Character, msg: string): void {
  exact3("body pos", a.pos, b.pos, `${msg} pos`);
  exact3("body vel", a.vel, b.vel, `${msg} vel`);
  same("body mode", a.mode, b.mode, `${msg} mode`);
  for (const k of ["facing", "time", "wallTime", "railS", "railDir", "coyote", "buffer", "sinking"] as const) exact("body timers", a[k], b[k], `${msg} ${k}`);
  same("body rail", a.rail, b.rail, `${msg} rail`);
  exact3("body wall", a.wall, b.wall, `${msg} wall`);
  exact3("body wall", a.wallFace, b.wallFace, `${msg} wallFace`);
  exact3("body slope", a.slope, b.slope, `${msg} slope`);
  exact3("body checkpoint", a.checkpoint, b.checkpoint, `${msg} checkpoint`);
  same("body events", a.events.length, b.events.length, `${msg} events`);
  a.events.forEach((e, i) => {
    const f = b.events[i]! as Record<string, unknown>;
    same("body events", Object.keys(e).sort(), Object.keys(f).sort(), `${msg} event ${e.type}`);
    for (const [k, v] of Object.entries(e)) {
      if (Array.isArray(v)) exact3("body event payloads", v as number[], f[k] as number[], `${msg} ${e.type}.${k}`);
      else if (typeof v === "number") exact("body event payloads", v, f[k], `${msg} ${e.type}.${k}`);
      else same("body events", v, f[k], `${msg} ${e.type}.${k}`);
    }
  });
}

// Step both bodies with the same inputs (a drive reads the TS body; the same object goes to both).
function lockstep(world: CharacterSpec, drive: Drive, steps: number, label: string): Record<string, number> {
  const a = tChar.createCharacter(world);
  const b = J.createCharacter(world);
  const modes: Record<string, number> = {};
  sameBody(a, b, `${label} start`);
  for (let i = 0; i < steps; i += 1) {
    const input = drive(a, i);
    a.step(DT, input);
    b.step(DT, input);
    sameBody(a, b, `${label} step ${i}`);
    modes[a.mode] = (modes[a.mode] ?? 0) + 1;
  }
  return modes;
}

test("bodies: the golden runs, stepped side by side, every field every step", { skip }, () => {
  lockstep(COURSE, coursePilot, 120 * 16, "course");
  for (const seed of [1, 2, 3, 4, 5, 6]) { const next = wanderInputs(seed); lockstep(YARD, () => next(), 120 * 20, `yard ${seed}`); }
  lockstep(SKIM, skimDrive, 120 * 8, "skim");
  // (And the golden trace's own hash, from either body.)
  same("golden hashes", trace(COURSE, coursePilot, 1200).hash, trace(COURSE, coursePilot, 1200, undefined, J.createCharacter as (s: CharacterSpec) => Character).hash);
});

// A random world: a floor (sometimes none), turned boxes -- walls tall enough to run, pads, thin slabs --
// wedges (some given among the boxes), rails, water, and sometimes other tuning.
function worldOf(seed: number): CharacterSpec {
  const r = rand(seed);
  const boxes: Solid[] = [];
  if (r() < 0.9) boxes.push({ c: [0, -1 + r() * 0.5, 0], h: [10 + r() * 20, 1, 10 + r() * 20], mat: 1 });
  const n = 3 + Math.floor(r() * 14);
  for (let k = 0; k < n; k += 1) {
    const kind = r();
    const c: Vec3 = [(r() * 2 - 1) * 12, 0, (r() * 2 - 1) * 12];
    const yaw = r() < 0.3 ? 0 : (r() * 2 - 1) * Math.PI;
    if (kind < 0.35) boxes.push({ c: [c[0], 2 + r() * 3, c[2]], h: [0.1 + r() * 0.4, 2 + r() * 3, 1 + r() * 6], yaw, mat: 0 }); // (a wall)
    else if (kind < 0.6) { const hy = 0.1 + r() * 0.8; boxes.push({ c: [c[0], hy, c[2]], h: [0.5 + r() * 2, hy, 0.5 + r() * 2], yaw }); } // (a pad)
    else if (kind < 0.7) boxes.push({ c: [c[0], 1 + r() * 3, c[2]], h: [0.5 + r() * 2, 0.02 + r() * 0.1, 0.5 + r() * 2], yaw }); // (a thin slab in the air)
    else { const hy = 0.2 + r() * 1.5; const w: Wedge = { kind: "wedge", c: [c[0], hy, c[2]], h: [0.5 + r() * 2, hy, 0.8 + r() * 3], yaw, lo: r() < 0.5 ? 0 : r() * 0.6 }; boxes.push(w); }
  }
  const rails: Rail[] = [];
  const nr = Math.floor(r() * 3);
  for (let k = 0; k < nr; k += 1) {
    const pts: Vec3[] = [];
    const start: Vec3 = [(r() * 2 - 1) * 8, 0.8 + r() * 2, (r() * 2 - 1) * 8];
    const a = r() * Math.PI * 2;
    const m = 2 + Math.floor(r() * 6);
    for (let q = 0; q < m; q += 1) pts.push([start[0] + Math.sin(a) * q * 2 + (r() - 0.5), start[1] + (r() - 0.5) * 1.5, start[2] + Math.cos(a) * q * 2 + (r() - 0.5)]);
    rails.push(pts);
  }
  // (Wedges also given on their own list, now and then.)
  const wedges = r() < 0.3 ? boxes.filter((b): b is Wedge => b.kind === "wedge").splice(0, 1) : [];
  const tuning = r() < 0.2 ? { runSpeed: 7 + r() * 5, jump: 7 + r() * 3, slopeMax: 30 + r() * 20 } : {};
  return { boxes: wedges.length ? boxes.filter((b) => !wedges.includes(b as Wedge)) : boxes, wedges, rails, waterY: r() < 0.5 ? -0.5 : -0.05 - r(), spawn: [(r() * 2 - 1) * 4, 0.5 + r() * 4, (r() * 2 - 1) * 4], tuning };
}

// A random input stream: the stick wanders and snaps, jumps are tapped and held, now and then nothing at all.
function randomDrive(seed: number): Drive {
  const r = rand(seed * 7 + 3);
  let a = r() * Math.PI * 2;
  let hold = 0;
  let mag = 1;
  return (): BodyInput => {
    a += (r() - 0.5) * (r() < 0.02 ? 6 : 0.4);
    if (r() < 0.01) mag = r() < 0.3 ? 0 : 0.2 + r() * 0.8;
    const jump = r() < 0.025;
    if (jump) hold = Math.floor(r() * 50);
    hold = Math.max(0, hold - 1);
    const pick = r();
    if (pick < 0.01) return {}; // (no fields at all)
    return { move: [Math.sin(a) * mag, Math.cos(a) * mag], jump, hold: hold > 0 };
  };
}

test("bodies: 60 random worlds (boxes, wedges, rails, water) x random input streams, every field every step", { skip }, () => {
  const seen: Record<string, number> = {};
  for (let seed = 1; seed <= 60; seed += 1) {
    const modes = lockstep(worldOf(seed), randomDrive(seed), 1500, `world ${seed}`);
    for (const [m, n] of Object.entries(modes)) seen[m] = (seen[m] ?? 0) + n;
  }
  // (The coverage is real: every mode is visited somewhere.)
  for (const m of tChar.BODY_MODES) if (!seen[m]) throw new Error(`no world visited ${m}: ${JSON.stringify(seen)}`);
  console.log(summary("physics equality (TS vs the proof of concept)"), `\n  modes stepped: ${JSON.stringify(seen)}`);
});
