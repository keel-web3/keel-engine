// ai/herd: deterministic from the seed, saves and carries on exactly, bounded
// speeds; a scattered herd gathers round its leader without piling up, moves
// together, bolts from a threat (the alarm spreading past the threat's reach)
// and calms down after; bound to bodies by their contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import { pack } from "@keel-engine/animals";
import { DEFAULTS, contract, createBrain, drives, id, paramsFor, setup, social } from "../src/index.ts";
import type { Agent, HerdParams, Neighbour, Vec3, WorldQuery } from "../src/index.ts";

const BOUNDS = [-20, -20, 20, 20] as const;

function world(agents: readonly Agent[], leaderId: string, threat: Vec3 | null): WorldQuery {
  return {
    neighbours: (pos, r) => agents.filter((a) => Math.hypot(a.pos[0] - pos[0], a.pos[2] - pos[2]) < r).map((a): Neighbour => ({ id: a.id, pos: a.pos, vel: a.vel, mode: a.mode, leader: a.id === leaderId })),
    obstacles: [{ pos: [8, 0, -6], r: 2 }],
    bounds: BOUNDS,
    threat,
  };
}

/** A herd of n scattered over a square of side `spread`, the first one leading. */
function herd(seed: string, n: number, spread: number, params: Partial<HerdParams> = {}) {
  const S = stream(createRoll(deriveSeed(seed, "start")), 0);
  const agents: Agent[] = Array.from({ length: n }, (_, i) => ({ id: `h${i}`, pos: [S.between(-spread / 2, spread / 2), 0, S.between(-spread / 2, spread / 2)], vel: [0, 0, 0], facing: S.between(-3, 3), mode: "idle" }));
  const brains = agents.map((_, i) => createBrain(deriveSeed(seed, i), { ...params, leader: i === 0 }));
  return { agents, brains };
}

function run(seed: string, n: number, steps: number, threatAt: (k: number, agents: readonly Agent[]) => Vec3 | null = () => null, spread = 10) {
  const h = herd(seed, n, spread);
  let agents = h.agents;
  const frames: Agent[][] = [agents];
  for (let k = 0; k < steps; k += 1) {
    const w = world(agents, "h0", threatAt(k, agents));
    agents = agents.map((a, i) => h.brains[i]!.step(a, w));
    frames.push(agents);
  }
  return { frames, brains: h.brains };
}

const speed = (a: Agent) => Math.hypot(a.vel[0], a.vel[2]);
const centroid = (f: readonly Agent[]): [number, number] => [f.reduce((s, a) => s + a.pos[0], 0) / f.length, f.reduce((s, a) => s + a.pos[2], 0) / f.length];
const spreadOf = (f: readonly Agent[]) => { const [cx, cz] = centroid(f); return f.reduce((s, a) => s + Math.hypot(a.pos[0] - cx, a.pos[2] - cz), 0) / f.length; };
const nearest = (f: readonly Agent[]) => f.reduce((s, a) => s + Math.min(...f.filter((b) => b !== a).map((b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]))), 0) / f.length;
const polarisation = (f: readonly Agent[]) => { let x = 0; let z = 0; for (const a of f) { const s = speed(a) || 1; x += a.vel[0] / s; z += a.vel[2] / s; } return Math.hypot(x, z) / f.length; };

test("the module keeps the ai/animal@1.0.0 contract", () => {
  assert.equal(contract, "ai/animal@1.0.0");
  assert.equal(id, "ai/herd");
  assert.equal(social, true);
  assert.equal(DEFAULTS.leader, false);
});

test("deterministic: the same seeds make the same herd; another seed another", () => {
  const a = run("0x5", 10, 600).frames;
  assert.deepEqual(a, run("0x5", 10, 600).frames);
  assert.notDeepEqual(a.at(-1), run("0x6", 10, 600).frames.at(-1));
});

test("save -> JSON -> load carries on bit-identical", () => {
  const h = herd("0x9", 6, 8);
  let agents = h.agents;
  for (let k = 0; k < 200; k += 1) { const w = world(agents, "h0", null); agents = agents.map((a, i) => h.brains[i]!.step(a, w)); }
  const again = h.brains.map((b, i) => createBrain(b.seed, { leader: i === 0 }).load(JSON.parse(JSON.stringify(b.save()))));
  let x = agents;
  let y = agents;
  for (let k = 0; k < 400; k += 1) {
    const threat: Vec3 | null = k > 100 && k < 160 ? [0, 0, 0] : null;
    const wx = world(x, "h0", threat);
    const wy = world(y, "h0", threat);
    x = x.map((a, i) => h.brains[i]!.step(a, wx));
    y = y.map((a, i) => again[i]!.step(a, wy));
  }
  assert.deepEqual(x, y);
});

test("cohesion: a scattered herd gathers round its leader, spaced, and moves as one", () => {
  const { frames } = run("0x21", 12, 30 * 40, () => null, 14);
  const first = frames[0]!;
  const late = frames.slice(30 * 20);
  const meanSpread = late.reduce((s, f) => s + spreadOf(f), 0) / late.length;
  const meanNearest = late.reduce((s, f) => s + nearest(f), 0) / late.length;
  const toLeader = late.reduce((s, f) => s + f.slice(1).reduce((t, a) => t + Math.hypot(a.pos[0] - f[0]!.pos[0], a.pos[2] - f[0]!.pos[2]), 0) / (f.length - 1), 0) / late.length;
  assert.ok(meanSpread < spreadOf(first) * 0.75 && meanSpread < 3.5, `spread ${spreadOf(first).toFixed(2)} -> ${meanSpread.toFixed(2)}`);
  assert.ok(meanNearest > DEFAULTS.separation * 0.6, `nearest neighbour ${meanNearest.toFixed(2)}: no pile-up`);
  assert.ok(toLeader < 4.5, `followers ${toLeader.toFixed(2)} from the leader`);
  // While the herd moves, it moves the same way.
  const moving = late.filter((f) => f.reduce((s, a) => s + speed(a), 0) / f.length > DEFAULTS.walkSpeed * 0.4);
  assert.ok(moving.length > 60, `moving frames ${moving.length}`);
  const pol = moving.reduce((s, f) => s + polarisation(f), 0) / moving.length;
  assert.ok(pol > 0.7, `polarisation ${pol.toFixed(2)}`);
  // And the leader actually leads somewhere: the herd has travelled.
  const [x0, z0] = centroid(frames[30 * 5]!);
  const [x1, z1] = centroid(frames.at(-1)!);
  assert.ok(Math.hypot(x1 - x0, z1 - z0) > 2, "the herd travels");
});

test("speeds stay bounded, with and without a threat", () => {
  const calm = run("0x31", 10, 900).frames;
  for (const f of calm) for (const a of f) assert.ok(speed(a) <= DEFAULTS.walkSpeed + 1e-9, `${a.id} ${speed(a)}`);
  const chased = run("0x32", 10, 900, (k) => [Math.sin(k / 30) * 10, 0, Math.cos(k / 45) * 10]).frames;
  for (const f of chased) for (const a of f) assert.ok(speed(a) <= DEFAULTS.runSpeed + 1e-9, `${a.id} ${speed(a)}`);
});

test("flee: the herd bolts from a threat, the alarm spreading past its reach, and calms after", () => {
  const settle = 30 * 15;
  let threat: Vec3 | null = null;
  const { frames } = run("0x41", 12, settle + 30 * 3 + 30 * 12, (k, agents) => {
    if (k === settle) { const [cx, cz] = centroid(agents); threat = [cx + spreadOf(agents) + 3, 0, cz]; }
    return k >= settle && k < settle + 30 * 3 ? threat : null;
  }, 8);
  const before = frames[settle]!;
  const t = threat as Vec3 | null;
  assert.ok(t);
  const dist = (a: Agent) => Math.hypot(a.pos[0] - t[0], a.pos[2] - t[2]);
  const inReach = before.filter((a) => dist(a) < DEFAULTS.fleeRadius).length;
  const after = frames[settle + 30 * 2]!;
  const fled = new Set<string>();
  for (const f of frames.slice(settle, settle + 30 * 3)) for (const a of f) if (a.mode === "flee") fled.add(a.id);
  assert.ok(fled.size > inReach, `${fled.size} fled, ${inReach} were in the threat's reach: the alarm spread`);
  const gained = after.filter((a, i) => dist(a) > dist(before[i]!) + 1).length;
  assert.ok(gained >= 10, `${gained} of 12 got well away`);
  assert.ok(after.some((a) => speed(a) > DEFAULTS.walkSpeed * 2), "at a run");
  // Clear of it: nobody keeps spooking anybody.
  for (const a of frames.at(-1)!) assert.notEqual(a.mode, "flee");
});

test("bound by contract: params from a body/quadruped entity's sockets; setup finds the packs providing it", () => {
  const S = stream(createRoll(deriveSeed("bodies", 0)), 0);
  const sized = (eid: string) => { const e = pack.entities.find((x) => x.id === eid)!; return paramsFor(e.sockets(e.build(S, {}))); };
  const deer = sized("deer");
  const rabbit = sized("rabbit");
  assert.ok(deer.walkSpeed! > rabbit.walkSpeed! && deer.view! > rabbit.view!, `deer ${deer.walkSpeed} rabbit ${rabbit.walkSpeed}`);
  setup({ manifest: {} as never, use: () => { throw new Error("no"); }, providers: (c: string) => (c === "body/quadruped" ? [{ manifest: { id: "packs/animals", version: "1.0.0" }, api: {} }] : []) } as never);
  assert.deepEqual(drives(), ["packs/animals@1.0.0"]);
});
