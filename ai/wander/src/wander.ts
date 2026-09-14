// Wander: one animal on its own. It meanders (a heading that drifts by a
// seeded jitter), stops to look about, sits a while, and gets up again --
// each for a seeded time -- keeps off obstacles, other animals and the pen's
// edges, and bolts from a threat until it has been clear of it a moment.
//
//   const brain = createBrain("0x2a", { walkSpeed: 0.9 });
//   agent = brain.step(agent, world);   // every fixed step (params.dt)

import type { Agent, AnimalMode, Brain, BrainSave, SocketSizes, WorldQuery } from "./contract.ts";
import { add, along, avoid, contain, drawer, flat, integrate, len, mul, sub, turn, unit, wrap, yawOf } from "./steer.ts";
import type { V2 } from "./steer.ts";

export const MODULE = "ai/wander";

export interface WanderParams {
  /** The fixed step, seconds. */
  readonly dt: number;
  readonly walkSpeed: number;
  readonly runSpeed: number;
  readonly maxAccel: number;
  /** Radians per second. */
  readonly maxTurn: number;
  /** How hard the heading drifts while it walks (radians per second, at most). */
  readonly jitter: number;
  /** Seconds, [least, most]. */
  readonly walkFor: readonly [number, number];
  readonly idleFor: readonly [number, number];
  readonly sitFor: readonly [number, number];
  /** Chance a walk ends in sitting rather than standing about. */
  readonly sitChance: number;
  /** A threat this close sends it running. */
  readonly fleeRadius: number;
  /** Seconds clear of the threat before it calms down. */
  readonly calmFor: number;
  /** Personal space: other animals inside this are pushed off. */
  readonly personal: number;
  /** Its own radius on the ground (for obstacles). */
  readonly bodyR: number;
  /** It turns back this far from the pen's edge. */
  readonly margin: number;
}

export const DEFAULTS: WanderParams = Object.freeze({
  dt: 1 / 30,
  walkSpeed: 0.9, runSpeed: 3, maxAccel: 3, maxTurn: 4, jitter: 1.6,
  walkFor: [3, 8] as const, idleFor: [1.5, 4] as const, sitFor: [4, 10] as const, sitChance: 0.3,
  fleeRadius: 4, calmFor: 2, personal: 0.9, bodyR: 0.3, margin: 1.5,
});

/** Speeds and ranges for a body, from its sockets: the back socket's depth is 0.6 of the body's length. */
export function paramsFor(sockets: SocketSizes): Partial<WanderParams> {
  const back = sockets["back"];
  if (!back) return {};
  const L = back.size[2] / 0.6;
  return { walkSpeed: 1.6 * L, runSpeed: 5.5 * L, maxAccel: 5 * L, personal: 1.5 * L, bodyR: 0.5 * L, fleeRadius: Math.max(3, 8 * L), margin: Math.max(0.5, 2 * L) };
}

type Doing = "walk" | "idle" | "sit" | "flee";
export interface WanderMemory { doing: Doing; timer: number; heading: number; look: number; calm: number; draws: number }

/** One wander step: pure -- the next agent and the next memory from these. */
export function stepWander(agent: Agent, world: WorldQuery, P: WanderParams, mem: WanderMemory, draw: (n: number) => number): { agent: Agent; memory: WanderMemory } {
  const m: WanderMemory = { ...mem };
  const u = (): number => draw(m.draws++);
  const span = ([a, b]: readonly [number, number]): number => a + (b - a) * u();
  const dt = P.dt;
  const pos = flat(agent.pos);
  const vel = flat(agent.vel);
  const speed = len(vel);

  // A threat close by: run (and keep running until clear of it for calmFor).
  const threat = world.threat ? flat(world.threat) : null;
  const near = threat !== null && len(sub(pos, threat)) < P.fleeRadius;
  if (near) { m.doing = "flee"; m.calm = P.calmFor; }
  else if (m.doing === "flee") {
    m.calm -= dt;
    if (m.calm <= 0) { m.doing = "walk"; m.timer = span(P.walkFor); m.heading = speed > 1e-6 ? yawOf(vel) : m.heading; }
  } else {
    m.timer -= dt;
    if (m.timer <= 0) {
      const r = u();
      if (m.doing === "walk") { m.doing = r < P.sitChance ? "sit" : "idle"; m.timer = span(m.doing === "sit" ? P.sitFor : P.idleFor); m.look = wrap(agent.facing + (u() - 0.5) * 2); }
      else if (m.doing === "idle") { m.doing = r < 0.25 ? "sit" : "walk"; m.timer = span(m.doing === "sit" ? P.sitFor : P.walkFor); m.heading = wrap(agent.facing + (u() - 0.5)); }
      else { m.doing = "idle"; m.timer = span(P.idleFor); m.look = agent.facing; }
    }
  }

  // Keep clear: obstacles, the pen, and personal space.
  let keep: V2 = add(mul(avoid(pos, world.obstacles, P.bodyR, P.bodyR * 2 + 0.5), P.maxAccel), mul(contain(pos, world.bounds, P.margin), P.maxAccel));
  for (const n of world.neighbours(agent.pos, P.personal)) {
    if (n.id === agent.id) continue;
    const away = sub(pos, flat(n.pos));
    const d = len(away);
    if (d < P.personal) keep = add(keep, mul(unit(away), (P.maxAccel * (P.personal - d)) / P.personal));
  }

  let want: V2;
  let maxSpeed = P.walkSpeed;
  let mode: AnimalMode;
  if (m.doing === "flee") {
    const dir = threat !== null ? unit(sub(pos, threat)) : unit(vel);
    want = mul(dir, P.runSpeed);
    maxSpeed = P.runSpeed;
    mode = "flee";
  } else if (m.doing === "walk") {
    m.heading = wrap(m.heading + (u() * 2 - 1) * P.jitter * dt * 3);
    want = mul(along(m.heading), P.walkSpeed);
    // (Still slowing from a run: let it ease down rather than snap.)
    maxSpeed = Math.max(P.walkSpeed, speed - P.maxAccel * dt);
    mode = speed > P.walkSpeed * 1.3 ? "run" : "walk";
  } else {
    want = [0, 0];
    maxSpeed = Math.max(P.walkSpeed, speed - P.maxAccel * dt);
    if (m.doing === "idle" && u() < 0.4 * dt) m.look = wrap(agent.facing + (u() - 0.5) * 2.4);
    mode = "idle";
  }
  const accel = add(mul(sub(want, vel), 2.5), keep);
  const next: { -readonly [K in keyof Agent]: Agent[K] } = integrate(agent, world, { accel, maxSpeed, maxAccel: P.maxAccel * (m.doing === "flee" ? 1.6 : 1), mode, bodyR: P.bodyR }, dt);
  const nv = flat(next.vel);
  const moving = len(nv) > P.walkSpeed * 0.1;
  // (It sits once it has stopped: a sitting animal that's bumped stands, and sits again when still.)
  if (m.doing === "sit" && len(nv) < P.walkSpeed * 0.05) next.mode = "sit";
  // (Facing: where it's going when it moves; where it looks when it stands; a sitting animal keeps still.)
  const face = moving ? yawOf(nv) : m.doing === "idle" ? m.look : agent.facing;
  const facing = turn(agent.facing, face, P.maxTurn * dt);
  // (A walk the pen or an obstacle bent keeps its new line, rather than pushing into the wall.)
  if (m.doing === "walk") {
    if (moving) m.heading = turn(m.heading, yawOf(nv), P.maxTurn * dt * 0.5);
    // (One pressed square into a wall turns off it.)
    if (len(keep) > P.maxAccel * 0.1) m.heading = turn(m.heading, yawOf(add(along(m.heading), unit(keep))), P.maxTurn * dt);
  }
  return { agent: { ...next, facing }, memory: m };
}

function freshMemory(draw: (n: number) => number, P: WanderParams): WanderMemory {
  let n = 0;
  const u = () => draw(n++);
  const heading = wrap((u() * 2 - 1) * Math.PI);
  const timer = P.walkFor[0] + (P.walkFor[1] - P.walkFor[0]) * u();
  return { doing: "walk", timer, heading, look: heading, calm: 0, draws: n };
}

/** A wander brain for one animal, from a seed. */
export function createBrain(seed: string, params: Partial<WanderParams> = {}): Brain<WanderParams> {
  const P: WanderParams = Object.freeze({ ...DEFAULTS, ...params });
  const draw = drawer(seed, MODULE);
  let mem = freshMemory(draw, P);
  const brain: Brain<WanderParams> = {
    seed,
    params: P,
    step(agent, world) {
      const r = stepWander(agent, world, P, mem, draw);
      mem = r.memory;
      return r.agent;
    },
    save: (): BrainSave => ({ schema: "keel-ai-animal@1", module: MODULE, seed, params: { ...P }, memory: { ...mem } }),
    load(save) {
      if (save.schema !== "keel-ai-animal@1" || save.module !== MODULE) throw new TypeError(`Not a ${MODULE} save (${save.module}).`);
      if (save.seed !== seed) throw new RangeError(`That save is for seed ${save.seed}, this brain is ${seed}.`);
      mem = { ...(save.memory as unknown as WanderMemory) };
      return brain;
    },
  };
  return brain;
}
