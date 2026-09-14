// Herd: animals that keep together. Boids -- separation (not too close),
// alignment (go the way the others go), cohesion (toward the others) -- plus a
// LEADER the rest follow, settling a gap behind it when it stops to graze, and
// FLIGHT: a threat close by sends an animal running straight away from it, and
// one running animal spooks the ones round it (alarm), so the herd bolts as one.
// The leader meanders and rests on seeded timers.
//
//   const lead = createBrain("0x1", { leader: true });
//   const cow  = createBrain("0x2");
//   every fixed step: next[i] = brain[i].step(agent[i], world)   // all against the same snapshot

import type { Agent, AnimalMode, Brain, BrainSave, Neighbour, SocketSizes, WorldQuery } from "./contract.ts";
import { add, along, avoid, contain, drawer, flat, integrate, len, limit, mul, sub, turn, unit, wrap, yawOf } from "./steer.ts";
import type { V2 } from "./steer.ts";

export const MODULE = "ai/herd";

export interface HerdParams {
  /** The fixed step, seconds. */
  readonly dt: number;
  readonly walkSpeed: number;
  readonly runSpeed: number;
  readonly maxAccel: number;
  /** Radians per second. */
  readonly maxTurn: number;
  /** Its own radius on the ground (for obstacles). */
  readonly bodyR: number;
  /** It turns back this far from the pen's edge. */
  readonly margin: number;
  /** How far it sees the others (alignment, cohesion, alarm). */
  readonly view: number;
  /** How far it sees the leader (a herd keeps an eye on it from further off). */
  readonly leaderView: number;
  /** Closer than this is too close. */
  readonly separation: number;
  readonly wSeparation: number;
  readonly wAlignment: number;
  readonly wCohesion: number;
  readonly wLeader: number;
  /** Followers settle this far from a leader that has stopped. */
  readonly followGap: number;
  /** A threat this close sends it running. */
  readonly fleeRadius: number;
  /** Seconds clear of the threat (or of running neighbours) before it calms down. */
  readonly calmFor: number;
  /** A running neighbour spooks it. */
  readonly alarm: boolean;
  /** This one leads: it meanders and rests; the others follow it. */
  readonly leader: boolean;
  /** How hard the leader's heading drifts (radians per second, at most). */
  readonly jitter: number;
  /** The leader's walks and rests, seconds [least, most]. */
  readonly walkFor: readonly [number, number];
  readonly restFor: readonly [number, number];
}

export const DEFAULTS: HerdParams = Object.freeze({
  dt: 1 / 30,
  walkSpeed: 1, runSpeed: 3.2, maxAccel: 3, maxTurn: 4, bodyR: 0.3, margin: 1.5,
  view: 4, leaderView: 12, separation: 1, wSeparation: 2.5, wAlignment: 1, wCohesion: 0.8, wLeader: 1.2, followGap: 1.5,
  fleeRadius: 5, calmFor: 2, alarm: true, leader: false,
  jitter: 1.2, walkFor: [4, 9] as const, restFor: [2, 6] as const,
});

/** Speeds and ranges for a body, from its sockets: the back socket's depth is 0.6 of the body's length. */
export function paramsFor(sockets: SocketSizes): Partial<HerdParams> {
  const back = sockets["back"];
  if (!back) return {};
  const L = back.size[2] / 0.6;
  return {
    walkSpeed: 1.7 * L, runSpeed: 6 * L, maxAccel: 5 * L, bodyR: 0.5 * L, margin: Math.max(0.5, 2 * L),
    view: 6 * L, leaderView: 18 * L, separation: 1.6 * L, followGap: 2.5 * L, fleeRadius: Math.max(3, 9 * L),
  };
}

type Doing = "walk" | "rest" | "follow" | "flee";
export interface HerdMemory { doing: Doing; timer: number; heading: number; calm: number; away: number; brave: number; draws: number }

/** One herd step: pure -- the next agent and the next memory from these. */
export function stepHerd(agent: Agent, world: WorldQuery, P: HerdParams, mem: HerdMemory, draw: (n: number) => number): { agent: Agent; memory: HerdMemory } {
  const m: HerdMemory = { ...mem };
  const u = (): number => draw(m.draws++);
  const span = ([a, b]: readonly [number, number]): number => a + (b - a) * u();
  const dt = P.dt;
  const pos = flat(agent.pos);
  const vel = flat(agent.vel);
  const speed = len(vel);

  const seen = world.neighbours(agent.pos, Math.max(P.view, P.leaderView)).filter((n) => n.id !== agent.id);
  const local: Array<{ n: Neighbour; off: V2; d: number }> = [];
  for (const n of seen) { const off = sub(flat(n.pos), pos); const d = len(off); if (d < P.view) local.push({ n, off, d }); }

  // Flight: from a threat in range, or -- alarmed -- the way running neighbours run.
  const threat = world.threat ? flat(world.threat) : null;
  if (threat !== null && len(sub(pos, threat)) < P.fleeRadius) {
    m.calm = P.calmFor;
    m.away = yawOf(sub(pos, threat));
    m.doing = "flee";
  } else if (P.alarm && m.doing !== "flee" && m.brave <= 0) {
    // (Only a calm animal is spooked, and not straight after a fright -- else two would keep spooking each other.)
    const running = local.filter((l) => l.n.mode === "flee");
    if (running.length) {
      let dir: V2 = [0, 0];
      for (const r of running) dir = add(dir, unit(flat(r.n.vel)));
      if (len(dir) > 1e-6) { m.away = yawOf(dir); m.calm = Math.max(m.calm, P.calmFor * 0.5); m.doing = "flee"; }
    }
  }
  if (m.doing === "flee" && !(threat !== null && len(sub(pos, threat)) < P.fleeRadius)) {
    m.calm -= dt;
    if (m.calm <= 0) { m.doing = P.leader ? "walk" : "follow"; m.timer = span(P.walkFor); m.heading = speed > 1e-6 ? yawOf(vel) : m.heading; m.brave = P.calmFor; }
  } else if (m.doing !== "flee") m.brave = Math.max(0, m.brave - dt);

  // The leader's own timers: walk a while, rest a while.
  if (P.leader && m.doing !== "flee") {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.doing = m.doing === "walk" ? "rest" : "walk";
      m.timer = span(m.doing === "walk" ? P.walkFor : P.restFor);
      if (m.doing === "walk") m.heading = wrap(agent.facing + (u() - 0.5) * 1.5);
    }
  }

  // Boids.
  let sep: V2 = [0, 0];
  let avgVel: V2 = [0, 0];
  let centre: V2 = [0, 0];
  for (const l of local) {
    if (l.d < P.separation) sep = add(sep, mul(unit(mul(l.off, -1)), (P.separation - l.d) / P.separation));
    avgVel = add(avgVel, flat(l.n.vel));
    centre = add(centre, l.off);
  }
  const k = local.length;
  const align: V2 = k ? sub(mul(avgVel, 1 / k), vel) : [0, 0];
  const cohere: V2 = k ? mul(centre, 1 / (k * P.view)) : [0, 0];
  const keep = add(mul(avoid(pos, world.obstacles, P.bodyR, P.bodyR * 2 + 0.5), P.maxAccel), mul(contain(pos, world.bounds, P.margin), P.maxAccel));

  let accel: V2;
  let maxSpeed = Math.max(P.walkSpeed, speed - P.maxAccel * dt);
  if (m.doing === "flee") {
    const want = mul(along(m.away), P.runSpeed);
    accel = add(add(mul(sub(want, vel), 3), mul(sep, P.maxAccel * P.wSeparation)), keep);
    maxSpeed = P.runSpeed;
  } else if (P.leader) {
    // (It walks slower than the herd can, and slower still while the herd is strung out behind it.)
    const behind = seen.length ? seen.reduce((t, n) => t + len(sub(flat(n.pos), pos)), 0) / seen.length : 0;
    const wait = Math.max(0.25, Math.min(1, 1 - (behind - 2 * P.followGap) / P.leaderView));
    const want: V2 = m.doing === "walk" ? mul(along((m.heading = wrap(m.heading + (u() * 2 - 1) * P.jitter * dt * 3))), P.walkSpeed * 0.75 * wait) : [0, 0];
    accel = add(add(mul(sub(want, vel), 2), mul(sep, P.maxAccel * P.wSeparation * 0.4)), keep);
  } else {
    m.doing = "follow";
    const lead = seen.find((n) => n.leader);
    let chase: V2 = mul(vel, -0.5); // (no leader in sight: settle, as a grazing herd does)
    if (lead) {
      const to = sub(flat(lead.pos), pos);
      const d = len(to);
      // (Go the leader's way at its pace, and close up on it when strung out -- so the ones ahead of it move on
      // rather than stand in its road.)
      const want = limit(add(flat(lead.vel), mul(unit(to), P.walkSpeed * Math.max(0, Math.min(1, (d - P.followGap) / (P.followGap * 2))))), P.walkSpeed);
      chase = mul(sub(want, vel), 2 * P.wLeader);
    }
    accel = add(add(add(add(mul(sep, P.maxAccel * P.wSeparation), mul(align, 2 * P.wAlignment)), mul(cohere, P.maxAccel * P.wCohesion)), chase), keep);
  }

  const s = len(vel);
  const mode: AnimalMode = m.doing === "flee" ? "flee" : s < P.walkSpeed * 0.15 ? "idle" : s > P.walkSpeed * 1.25 ? "run" : "walk";
  const next = integrate(agent, world, { accel, maxSpeed, maxAccel: P.maxAccel * (m.doing === "flee" ? 1.6 : 1), mode, bodyR: P.bodyR }, dt);
  const nv = flat(next.vel);
  const facing = len(nv) > P.walkSpeed * 0.1 ? turn(agent.facing, yawOf(nv), P.maxTurn * dt) : agent.facing;
  if (P.leader && m.doing === "walk") {
    // (A walk the pen or an obstacle bends keeps its new line; one pressed square into a wall turns off it.)
    if (len(nv) > P.walkSpeed * 0.1) m.heading = turn(m.heading, yawOf(nv), P.maxTurn * dt * 0.5);
    if (len(keep) > P.maxAccel * 0.1) m.heading = turn(m.heading, yawOf(add(along(m.heading), unit(keep))), P.maxTurn * dt);
  }
  return { agent: { ...next, facing }, memory: m };
}

function freshMemory(draw: (n: number) => number, P: HerdParams): HerdMemory {
  let n = 0;
  const u = () => draw(n++);
  const heading = wrap((u() * 2 - 1) * Math.PI);
  const timer = P.walkFor[0] + (P.walkFor[1] - P.walkFor[0]) * u();
  return { doing: P.leader ? "walk" : "follow", timer, heading, calm: 0, away: heading, brave: 0, draws: n };
}

/** A herd brain for one animal, from a seed ({ leader: true } for the one that leads). */
export function createBrain(seed: string, params: Partial<HerdParams> = {}): Brain<HerdParams> {
  const P: HerdParams = Object.freeze({ ...DEFAULTS, ...params });
  const draw = drawer(seed, MODULE);
  let mem = freshMemory(draw, P);
  const brain: Brain<HerdParams> = {
    seed,
    params: P,
    step(agent, world) {
      const r = stepHerd(agent, world, P, mem, draw);
      mem = r.memory;
      return r.agent;
    },
    save: (): BrainSave => ({ schema: "keel-ai-animal@1", module: MODULE, seed, params: { ...P }, memory: { ...mem } }),
    load(save) {
      if (save.schema !== "keel-ai-animal@1" || save.module !== MODULE) throw new TypeError(`Not a ${MODULE} save (${save.module}).`);
      if (save.seed !== seed) throw new RangeError(`That save is for seed ${save.seed}, this brain is ${seed}.`);
      mem = { ...(save.memory as unknown as HerdMemory) };
      return brain;
    },
  };
  return brain;
}
