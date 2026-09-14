// ai/wander: deterministic from the seed, saves and carries on exactly,
// bounded speeds, stays in the pen and out of obstacles, walks, idles and sits
// on its timers, bolts from a threat; bound to bodies by their contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import { pack } from "@keel-engine/animals";
import { createBrain, paramsFor, setup, drives, DEFAULTS, contract, id, social } from "../src/index.ts";
import type { Agent, Brain, Neighbour, Obstacle, Vec3, WanderParams, WorldQuery } from "../src/index.ts";

const BOUNDS = [-10, -10, 10, 10] as const;
const OBSTACLES: Obstacle[] = [{ pos: [3, 0, 2], r: 1.5 }, { pos: [-4, 0, -3], r: 1 }];

function world(agents: readonly Agent[], threat: Vec3 | null = null): WorldQuery {
  return {
    neighbours: (pos, r) => agents.filter((a) => Math.hypot(a.pos[0] - pos[0], a.pos[2] - pos[2]) < r).map((a): Neighbour => ({ id: a.id, pos: a.pos, vel: a.vel, mode: a.mode })),
    obstacles: OBSTACLES,
    bounds: BOUNDS,
    threat,
  };
}

function start(n: number, seed: string): Agent[] {
  const S = stream(createRoll(deriveSeed(seed, "start")), 0);
  const out: Agent[] = [];
  while (out.length < n) {
    const pos: Vec3 = [S.between(-9, 9), 0, S.between(-9, 9)];
    if (OBSTACLES.some((o) => Math.hypot(pos[0] - o.pos[0], pos[2] - o.pos[2]) < o.r + 0.5)) continue;
    out.push({ id: `a${out.length}`, pos, vel: [0, 0, 0], facing: S.between(-3, 3), mode: "idle" });
  }
  return out;
}

/** Run n agents for `steps` fixed steps, every brain against the same snapshot; the frames. */
function run(seed: string, n: number, steps: number, threatAt: (k: number) => Vec3 | null = () => null, params: Partial<WanderParams> = {}) {
  const brains = Array.from({ length: n }, (_, i) => createBrain(deriveSeed(seed, i), params));
  let agents = start(n, seed);
  const frames: Agent[][] = [agents];
  for (let k = 0; k < steps; k += 1) {
    const w = world(agents, threatAt(k));
    agents = agents.map((a, i) => brains[i]!.step(a, w));
    frames.push(agents);
  }
  return { frames, brains };
}
const speed = (a: Agent) => Math.hypot(a.vel[0], a.vel[2]);

test("the module keeps the ai/animal@1.0.0 contract", () => {
  assert.equal(contract, "ai/animal@1.0.0");
  assert.equal(id, "ai/wander");
  assert.equal(social, false);
  assert.equal(typeof createBrain, "function");
  assert.equal(DEFAULTS.dt, 1 / 30);
});

test("deterministic: the same seeds make the same walk; another seed another", () => {
  const a = run("0x2a", 6, 600).frames;
  const b = run("0x2a", 6, 600).frames;
  assert.deepEqual(a, b);
  const c = run("0x2b", 6, 600).frames;
  assert.notDeepEqual(a.at(-1), c.at(-1));
});

test("save -> JSON -> load carries on bit-identical", () => {
  const brain = createBrain("0x7");
  let agents = start(1, "0x7");
  for (let k = 0; k < 300; k += 1) agents = [brain.step(agents[0]!, world(agents))];
  const saved = JSON.parse(JSON.stringify(brain.save()));
  const again = createBrain("0x7").load(saved);
  let x = agents[0]!;
  let y = agents[0]!;
  for (let k = 0; k < 600; k += 1) { x = brain.step(x, world([x])); y = again.step(y, world([y])); }
  assert.deepEqual(x, y);
  assert.throws(() => createBrain("0x8").load(saved), /seed/);
});

test("speeds stay bounded; the pen and the obstacles hold", () => {
  const { frames } = run("0x11", 10, 1800);
  for (const f of frames) for (const a of f) {
    assert.ok(speed(a) <= DEFAULTS.walkSpeed + 1e-9, `${a.id} at ${speed(a)} with no threat`);
    assert.ok(a.pos[0] >= BOUNDS[0] && a.pos[0] <= BOUNDS[2] && a.pos[2] >= BOUNDS[1] && a.pos[2] <= BOUNDS[3], "in the pen");
    for (const o of OBSTACLES) assert.ok(Math.hypot(a.pos[0] - o.pos[0], a.pos[2] - o.pos[2]) >= o.r + DEFAULTS.bodyR - 1e-9, "out of the obstacle");
    assert.ok(Number.isFinite(a.facing) && Math.abs(a.facing) <= Math.PI + 1e-12);
  }
  // With a threat running through, never faster than a run.
  const chased = run("0x12", 10, 900, (k) => [Math.sin(k / 40) * 8, 0, Math.cos(k / 55) * 8]).frames;
  let fled = 0;
  for (const f of chased) for (const a of f) { assert.ok(speed(a) <= DEFAULTS.runSpeed + 1e-9); if (a.mode === "flee") fled += 1; }
  assert.ok(fled > 0, "some fled");
});

test("it walks, stands about and sits, each on its timers; sitting is still", () => {
  const { frames } = run("0x33", 8, 30 * 90);
  const seen = new Map<string, number>();
  for (const f of frames) for (const a of f) {
    seen.set(a.mode, (seen.get(a.mode) ?? 0) + 1);
    if (a.mode === "sit") assert.ok(speed(a) < DEFAULTS.walkSpeed * 0.05 + 1e-9);
  }
  for (const m of ["walk", "idle", "sit"]) assert.ok((seen.get(m) ?? 0) > 100, `${m}: ${seen.get(m) ?? 0}`);
  // Walks cover ground: the animals meander over the pen, not on the spot.
  const spread = frames.at(-1)!.map((a, i) => Math.hypot(a.pos[0] - frames[0]![i]!.pos[0], a.pos[2] - frames[0]![i]!.pos[2]));
  assert.ok(spread.some((d) => d > 3), `moved: ${spread.map((d) => d.toFixed(1)).join(" ")}`);
});

test("flee: a threat close by sends it straight away, up to a run", () => {
  const brain: Brain<WanderParams> = createBrain("0x44");
  let a: Agent = { id: "a", pos: [0, 0, 0], vel: [0, 0, 0], facing: 0, mode: "idle" };
  const threat: Vec3 = [1.5, 0, 0];
  const d0 = Math.hypot(a.pos[0] - threat[0], a.pos[2] - threat[2]);
  let top = 0;
  for (let k = 0; k < 45; k += 1) {
    a = brain.step(a, { neighbours: () => [], obstacles: [], bounds: [-20, -20, 20, 20], threat });
    assert.equal(a.mode, k === 0 || Math.hypot(a.pos[0] - threat[0], a.pos[2] - threat[2]) < DEFAULTS.fleeRadius ? "flee" : a.mode);
    top = Math.max(top, speed(a));
  }
  assert.ok(a.pos[0] < -2, `ran away from +x: ${a.pos[0]}`);
  assert.ok(Math.hypot(a.pos[0] - threat[0], a.pos[2] - threat[2]) > d0 + 2);
  assert.ok(top > DEFAULTS.walkSpeed * 2 && top <= DEFAULTS.runSpeed + 1e-9, `top speed ${top}`);
  assert.ok(Math.abs(a.facing - -Math.PI / 2) < 0.2, `faces away: ${a.facing}`);
  // Clear of it a while, it calms down.
  for (let k = 0; k < 150; k += 1) a = brain.step(a, { neighbours: () => [], obstacles: [], bounds: [-20, -20, 20, 20], threat: null });
  assert.notEqual(a.mode, "flee");
});

test("bound by contract: params from a body/quadruped entity's sockets; setup finds the packs providing it", () => {
  const S = stream(createRoll(deriveSeed("bodies", 0)), 0);
  const sized = (eid: string) => { const e = pack.entities.find((x) => x.id === eid)!; return paramsFor(e.sockets(e.build(S, {}))); };
  const mouse = sized("mouse");
  const bear = sized("bear");
  assert.ok(mouse.walkSpeed! > 0 && bear.walkSpeed! > mouse.walkSpeed! * 5, `mouse ${mouse.walkSpeed} bear ${bear.walkSpeed}`);
  assert.deepEqual(paramsFor({}), {});
  const manifest = { id: "packs/animals", version: "1.0.0" };
  setup({ manifest: {} as never, use: () => { throw new Error("no"); }, providers: (c: string) => (c === "body/quadruped" ? [{ manifest, api: {} }] : []) } as never);
  assert.deepEqual(drives(), ["packs/animals@1.0.0"]);
});
