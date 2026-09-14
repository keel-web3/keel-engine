// Steering on the ground plane: pure functions over [x, z] pairs, and the one
// integration step every brain ends with. Deterministic: plain arithmetic, a
// fixed dt, no clock; random draws come from the seed through core's roll,
// counted in the brain's memory so a save carries on exactly.
//
// (The same file is in ai/wander and ai/herd -- see the README.)

import { createRoll, datan2, dcos, deriveSeed, dhypot, dsin } from "@keel-engine/core";
import type { Agent, AnimalMode, Obstacle, Vec3, WorldQuery } from "./contract.ts";

export type V2 = [number, number];

export const flat = (p: Vec3): V2 => [p[0], p[2]];
export const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
export const len = (a: V2): number => dhypot(a[0], a[1]);
export const unit = (a: V2): V2 => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0]; };
export const limit = (a: V2, max: number): V2 => { const l = len(a); return l > max ? mul(a, max / l) : a; };
/** The ground direction a yaw faces (core frame: yaw 0 faces +z). */
export const along = (yaw: number): V2 => [dsin(yaw), dcos(yaw)];
export const yawOf = (v: V2): number => datan2(v[0], v[1]);
export const wrap = (a: number): number => datan2(dsin(a), dcos(a));
/** Turn from `from` toward `to` by at most `max` radians. */
export const turn = (from: number, to: number, max: number): number => { const d = wrap(to - from); return wrap(from + Math.max(-max, Math.min(max, d))); };

/** Seeded draws for one brain: the n-th draw is fixed by the seed and n alone (n lives in the brain's memory). */
export function drawer(seed: string, module: string): (n: number) => number {
  const roll = createRoll(deriveSeed(seed, module));
  // (Slots from 0x100: past the seed's own sixteen words, each hashed from the seed and its index.)
  return (n) => roll.at(0x100 + n) / 65536;
}

/** Push off obstacles within `reach` of their rim: stronger the closer, straight away from the centre. */
export function avoid(pos: V2, obstacles: readonly Obstacle[], bodyR: number, reach: number): V2 {
  let f: V2 = [0, 0];
  for (const o of obstacles) {
    const away = sub(pos, flat(o.pos));
    const gap = len(away) - o.r - bodyR;
    if (gap < reach) f = add(f, mul(unit(away), (reach - Math.max(gap, 0)) / reach));
  }
  return f;
}

/** Steer back inside the pen when within `margin` of an edge. */
export function contain(pos: V2, bounds: WorldQuery["bounds"], margin: number): V2 {
  if (!bounds) return [0, 0];
  const [x0, z0, x1, z1] = bounds;
  const push = (p: number, lo: number, hi: number): number => (p < lo + margin ? (lo + margin - p) / margin : p > hi - margin ? -(p - (hi - margin)) / margin : 0);
  return [push(pos[0], x0, x1), push(pos[1], z0, z1)];
}

export interface Motion {
  readonly accel: V2;
  /** The fastest it may go this step. */
  readonly maxSpeed: number;
  readonly maxAccel: number;
  readonly mode: AnimalMode;
  readonly bodyR: number;
}

/**
 * One fixed step: velocity from the (limited) acceleration, capped speed,
 * position, then hard limits -- never inside an obstacle, never out of the
 * pen (the velocity into a wall is dropped). The facing is the brain's to turn.
 */
export function integrate(agent: Agent, world: WorldQuery, m: Motion, dt: number): Agent {
  let vel = limit(add(flat(agent.vel), mul(limit(m.accel, m.maxAccel), dt)), m.maxSpeed);
  let pos = add(flat(agent.pos), mul(vel, dt));
  for (const o of world.obstacles) {
    const away = sub(pos, flat(o.pos));
    const d = len(away);
    const min = o.r + m.bodyR;
    if (d < min) {
      const n: V2 = d > 1e-9 ? mul(away, 1 / d) : [1, 0];
      pos = add(flat(o.pos), mul(n, min));
      const into = vel[0] * n[0] + vel[1] * n[1];
      if (into < 0) vel = sub(vel, mul(n, into));
    }
  }
  if (world.bounds) {
    const [x0, z0, x1, z1] = world.bounds;
    if (pos[0] < x0) { pos = [x0, pos[1]]; vel = [Math.max(vel[0], 0), vel[1]]; }
    if (pos[0] > x1) { pos = [x1, pos[1]]; vel = [Math.min(vel[0], 0), vel[1]]; }
    if (pos[1] < z0) { pos = [pos[0], z0]; vel = [vel[0], Math.max(vel[1], 0)]; }
    if (pos[1] > z1) { pos = [pos[0], z1]; vel = [vel[0], Math.min(vel[1], 0)]; }
  }
  return { id: agent.id, pos: [pos[0], agent.pos[1], pos[1]], vel: [vel[0], 0, vel[1]], facing: agent.facing, mode: m.mode };
}
