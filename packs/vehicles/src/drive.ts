// Driving: a car's state stepped on a fixed step from its handling (car.ts)
// and a driver's input -- a bicycle model with grip: the steering turns the
// car by speed / wheelbase until the turn asks more than the tyres hold, then
// the rear lets go (a slide, bled off by the grip). Arcade, deterministic
// (dmath), and made of the same dials the car was drawn from: a light winged
// car on wide tyres corners where a heavy pickup slides.

import { dcos, dsin, dtan } from "@keel-engine/core";
import type { Handling } from "./car.ts";

export interface CarState {
  /** Ground position (m), heading (frame convention: 0 faces +z). */
  x: number;
  z: number;
  yaw: number;
  /** Speed along the heading, and the sideways slide (m/s, + to the right). */
  speed: number;
  slide: number;
  /** The front wheels' steering angle (rad, + turns right... toward +x), and how far the wheels have rolled (rad per radius: metres). */
  steer: number;
  rolled: number;
  /** How hard the car is sliding (0..1): skids, smoke, a squeal. */
  skid: number;
}

export interface DriveInput {
  /** -1 (brake / reverse) .. 1 (full throttle). */
  readonly throttle: number;
  /** -1 (left) .. 1 (right). */
  readonly steer: number;
}

export const carState = (x: number, z: number, yaw: number): CarState => ({ x, z, yaw, speed: 0, slide: 0, steer: 0, rolled: 0, skid: 0 });

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Step a car by dt seconds. */
export function stepCar(s: CarState, h: Handling, input: DriveInput, dt: number): void {
  const throttle = clamp(input.throttle, -1, 1);
  // Steering: less lock at speed, eased toward the wanted angle.
  const lock = h.steer / (1 + Math.abs(s.speed) / 22);
  const want = clamp(input.steer, -1, 1) * lock;
  const rate = 3.2 * dt;
  s.steer += clamp(want - s.steer, -rate, rate);
  // Power against weight and air. The engine's push is its power over its speed (so it pulls hardest from low down and
  // tails off), capped by what the tyres can lay down; drag grows with the square of speed and sets the top end on its
  // own. Everything divides by the car's mass -- which is why a two-tonne truck gets going slowly and stops slowly.
  const m = h.massKg > 0 ? h.massKg : Math.max(300, h.mass * 1000);
  const v = Math.abs(s.speed);
  const drag = (h.drag ?? 0.4) * v * v;
  const roll = (h.roll ?? 0.015) * m * 9.81;
  if (throttle > 0) {
    const push = Math.min((h.power ?? h.accel * m) / Math.max(4, v), m * h.grip * 0.75);
    s.speed += ((push * throttle - drag - roll) / m) * dt;
  } else if (s.speed > 0.5) {
    // Brakes: what the tyres will take, and the air helps.
    s.speed = Math.max(0, s.speed + (throttle * (h.brakeG ?? 1) * 9.81 - (drag + roll) / m) * dt);
  } else {
    s.speed = Math.max(-(h.topSpeed * 0.25), s.speed + ((h.power ?? h.accel * m) * 0.35 * throttle) / Math.max(4, v) / m * dt);
  }
  if (throttle === 0) s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), ((drag + roll) / m) * dt);
  // Turning: the bicycle's yaw rate, limited by what the tyres grip; the rest becomes a slide.
  const yawRate = (s.speed * dtan(s.steer)) / h.wheelbase;
  const lateral = Math.abs(s.speed * yawRate);
  const limit = h.grip;
  const over = lateral > limit ? limit / lateral : 1;
  s.yaw += yawRate * (0.35 + 0.65 * over) * dt;
  if (s.yaw > Math.PI) s.yaw -= 2 * Math.PI; else if (s.yaw < -Math.PI) s.yaw += 2 * Math.PI;
  // (A turn past the grip pushes the car wide -- outward, away from the turn -- and scrubs speed.)
  if (over < 1) { s.slide -= Math.sign(yawRate) * (lateral - limit) * 0.35 * dt; s.speed -= (1 - over) * s.speed * 0.5 * dt; }
  s.slide -= s.slide * Math.min(1, (h.grip / 6) * dt);
  s.skid = clamp(Math.max(1 - over, Math.abs(s.slide) / 6), 0, 1);
  // Move: along the heading, and sideways by the slide (right = [cos, 0, -sin]).
  const fx = dsin(s.yaw), fz = dcos(s.yaw);
  s.x += (fx * s.speed + fz * s.slide) * dt;
  s.z += (fz * s.speed - fx * s.slide) * dt;
  s.rolled += s.speed * dt;
}

/** What a touch between two cars was: where, which way, how hard, and what each one took for it. */
export interface Impact {
  /** Where they met (world). */
  readonly x: number;
  readonly z: number;
  /** The contact normal, from a toward b. */
  readonly nx: number;
  readonly nz: number;
  /** How fast they were closing along it (m/s), and the momentum traded (kg m/s). */
  readonly closing: number;
  readonly impulse: number;
  /** What each took, in joules a kilogram of its own mass -- the number a damage model reads. */
  readonly hurtA: number;
  readonly hurtB: number;
}

/**
 * Push two overlapping cars apart, trading a little speed. Each car is a CAPSULE along its heading (its length less
 * its width, rounded by half its width), so noses and tails collide where they are -- not a circle that lets a
 * nose through another car's door. Returns true when they touched.
 */
export function separateCars(a: CarState, ha: Handling, b: CarState, hb: Handling): Impact | null {
  const dx0 = b.x - a.x, dz0 = b.z - a.z;
  const reach = ha.halfLength + hb.halfLength;
  if (dx0 * dx0 + dz0 * dz0 > reach * reach) return null;
  const seg = (s: CarState, h: Handling): [number, number, number, number] => {
    const l = Math.max(0, h.halfLength - h.halfWidth), fx = dsin(s.yaw) * l, fz = dcos(s.yaw) * l;
    return [s.x - fx, s.z - fz, s.x + fx, s.z + fz];
  };
  const [ax0, az0, ax1, az1] = seg(a, ha), [bx0, bz0, bx1, bz1] = seg(b, hb);
  // The closest points of the two segments (clamped), by a few alternating projections.
  const proj = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number): [number, number] => {
    const ex = x1 - x0, ez = z1 - z0, e2 = ex * ex + ez * ez;
    const t = e2 > 1e-9 ? Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / e2)) : 0;
    return [x0 + ex * t, z0 + ez * t];
  };
  let [pb, qb] = proj(a.x, a.z, bx0, bz0, bx1, bz1);
  let [pa, qa] = proj(pb, qb, ax0, az0, ax1, az1);
  for (let i = 0; i < 3; i += 1) { [pb, qb] = proj(pa, qa, bx0, bz0, bx1, bz1); [pa, qa] = proj(pb, qb, ax0, az0, ax1, az1); }
  const dx = pb - pa, dz = qb - qa;
  const r = ha.halfWidth + hb.halfWidth;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = d2 > 1e-12 ? dx / d : dcos(a.yaw), nz = d2 > 1e-12 ? dz / d : -dsin(a.yaw);
  const push = r - d;
  const ma = ha.massKg > 0 ? ha.massKg : ha.mass * 1000, mb = hb.massKg > 0 ? hb.massKg : hb.mass * 1000;
  const wa = mb / (ma + mb), wb = 1 - wa;
  a.x -= nx * push * wa; a.z -= nz * push * wa;
  b.x += nx * push * wb; b.z += nz * push * wb;
  // (Along the contact normal the closing speed is shared out; the one behind loses a little.)
  const vax = dsin(a.yaw) * a.speed, vaz = dcos(a.yaw) * a.speed, vbx = dsin(b.yaw) * b.speed, vbz = dcos(b.yaw) * b.speed;
  const closing = (vax - vbx) * nx + (vaz - vbz) * nz;
  let hurtA = 0, hurtB = 0;
  if (closing > 0) {
    const along = (s: CarState, sign: number, w: number) => { const f = (dsin(s.yaw) * nx + dcos(s.yaw) * nz) * sign; s.speed -= closing * w * Math.max(0, f) * 0.9; };
    along(a, 1, wa); along(b, -1, wb);
    a.slide -= closing * wa * 0.3; b.slide += closing * wb * 0.3;
    // What each one takes: the energy the OTHER one brings, over its own weight. A loaded truck shrugs off the hit it
    // deals -- the light car it clipped wears nearly all of it.
    const energy = 0.5 * ((ma * mb) / (ma + mb)) * closing * closing;
    hurtA = energy / ma;
    hurtB = energy / mb;
  }
  // (Where they touched, so the damage can be put on the corner that took it.)
  return { x: (pa + pb) / 2, z: (qa + qb) / 2, nx, nz, closing: Math.max(0, closing), impulse: Math.max(0, closing) * ((ma * mb) / (ma + mb)), hurtA, hurtB };
}
