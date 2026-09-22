// How a car SITS as it drives: its body on its springs, and its wheels on their
// axles. A car's weight moves about -- forward under braking, back under power,
// outward through a corner -- and the springs take it: the nose dives, the tail
// squats, the body leans on the outside springs. The wheels stay on the road
// while that happens; what changes is how far the body is above each of them.
//
// This is where a racer stops looking like a box sliding about. Everything is a
// spring and a damper toward a target, so it settles instead of snapping, and it
// is deterministic (core's dmath), so a replay puts the body exactly where it was.
//
//   const st = carStance();
//   stepStance(st, car, { speed, steer, slide, accel }, dt);
//   // st.pitch, st.roll -- the body; st.lift[i] -- how far the body sits over mount i.

import { dcos, dsin } from "@keel-engine/core";
import { clamp } from "./draws.ts";
import type { Car } from "./car.ts";

/** How a car's body sits this frame, and where each wheel is under it. */
export interface Stance {
  /** Nose down (+, braking) or nose up (-, on power), radians. */
  pitch: number;
  /** Leaning on its outside springs, radians (+ : the right side rises, a right-hand corner). */
  roll: number;
  /** Per mount (the car's own order): how far the body has moved down onto that wheel, metres (+ compressed). */
  readonly squash: number[];
  /** Per mount: how far the WHEEL had to move, metres -- 0 while the spring can take it, only lifting past its travel. */
  readonly lift: number[];
  /** The speed each one is changing at (the damper's state). */
  readonly vel: number[];
  pitchVel: number;
  rollVel: number;
  /** The speed last step, to find the acceleration along the car. */
  lastSpeed: number;
}

/** What the stance is worked out from this step. */
export interface StanceInput {
  /** Metres a second. */
  readonly speed: number;
  /** The front wheels' angle (rad). */
  readonly steer: number;
  /** How far it is sliding (0..1), if the sim knows. */
  readonly slide?: number;
  /** Along the car, m/s² -- given, or worked out from the speed since the last step. */
  readonly accel?: number;
  /** A jolt straight into the springs (a kerb, a landing), m/s. */
  readonly jolt?: number;
}

/** How the springs behave: stiffer springs lean less and settle faster. */
export interface SpringSpec {
  /** Radians of lean at 1 g (soft: 0.09, stiff: 0.03). */
  readonly rollAt1G: number;
  /** Radians of dive at 1 g. */
  readonly pitchAt1G: number;
  /** Metres a spring can take before the wheel has to move with the body. */
  readonly travel: number;
  /** How fast it settles (higher: stiffer). */
  readonly rate: number;
  /** How much of the motion it eats (1: dead, 0: bouncy). */
  readonly damp: number;
}

const G = 9.81;

/** A car's springs, from what it is: a slammed sports car is stiff, a lifted truck is soft and leans. */
export function springsOf(car: Car): SpringSpec {
  const soft = clamp(0.5 + car.dials.ride * 0.4 - car.dials.low * 0.3 + car.dials.mass * 0.2, 0.1, 1.2);
  return {
    rollAt1G: 0.03 + 0.06 * soft,
    pitchAt1G: 0.02 + 0.045 * soft,
    travel: 0.02 + 0.05 * soft,
    rate: 26 - 9 * soft,
    damp: 0.72,
  };
}

/** A car sitting still on its springs. */
export const carStance = (): Stance => ({
  pitch: 0, roll: 0, squash: [0, 0, 0, 0], lift: [0, 0, 0, 0], vel: [0, 0, 0, 0], pitchVel: 0, rollVel: 0, lastSpeed: 0,
});

/** Move a spring toward where the weight is putting it (a critically damped step, so it settles and never rings). */
const spring = (value: number, target: number, vel: number, rate: number, damp: number, dt: number): [number, number] => {
  const a = (target - value) * rate * rate - vel * 2 * damp * rate;
  const v = vel + a * dt;
  return [value + v * dt, v];
};

/**
 * Step a car's stance. The body's weight moves with what the driver is doing; the springs follow it, the wheels stay
 * down until the springs run out of travel, and a solid rear axle moves as ONE (a muscle car's tail hops; a sports
 * car's rear wheels move on their own).
 */
export function stepStance(st: Stance, car: Car, input: StanceInput, dt: number): Stance {
  if (dt <= 0) return st;
  const sp = springsOf(car);
  const h = car.handling;
  const accel = input.accel ?? (input.speed - st.lastSpeed) / dt;
  st.lastSpeed = input.speed;
  // The weight: forward under braking (+, nose down), outward through a corner (+, the right side rises).
  const gLong = clamp(-accel / G, -1.2, 1.2);
  const gLat = clamp((input.speed * input.speed * dsin(input.steer)) / (dcos(input.steer) || 1) / Math.max(0.6, h.wheelbase) / G, -1.4, 1.4);
  const [pitch, pitchVel] = spring(st.pitch, gLong * sp.pitchAt1G, st.pitchVel, sp.rate, sp.damp, dt);
  const [roll, rollVel] = spring(st.roll, gLat * sp.rollAt1G, st.rollVel, sp.rate, sp.damp, dt);
  st.pitch = pitch; st.pitchVel = pitchVel;
  st.roll = roll; st.rollVel = rollVel;
  // What that does over each wheel: the body's corner drops by how far it has turned about that mount.
  const jolt = input.jolt ?? 0;
  const solidRear = car.archetype === "pickup" || car.archetype === "muscle" || car.archetype === "buggy";
  let rearSum = 0, rearCount = 0;
  car.mounts.forEach((m, i) => {
    const drop = st.pitch * m.z - st.roll * m.x;
    const [v, vel] = spring(st.squash[i] ?? 0, drop, st.vel[i] ?? 0, sp.rate, sp.damp, dt);
    st.squash[i] = v + (i === 0 ? jolt * dt : 0);
    st.vel[i] = vel;
    if (solidRear && m.shape === 1) { rearSum += st.squash[i]!; rearCount += 1; }
  });
  // A solid axle: both its wheels take the average -- it cannot twist, so the whole axle moves together.
  if (rearCount > 1) car.mounts.forEach((m, i) => { if (m.shape === 1) st.squash[i] = rearSum / rearCount; });
  // The wheel only moves once the spring is out of travel: until then it stays on the road and the body moves over it.
  car.mounts.forEach((_, i) => {
    const s = st.squash[i] ?? 0;
    st.lift[i] = s > sp.travel ? s - sp.travel : s < -sp.travel ? s + sp.travel : 0;
  });
  return st;
}
