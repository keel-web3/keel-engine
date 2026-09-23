// The handling assists: what an arcade racer lays between the player's keys
// and a physical car so it feels planted and quick instead of twitchy (see
// redline/docs/research/HANDLING.md). One slider, ARCADE (0..1): at 0 every
// assist is off and the car is exactly the physics; ~0.7 is Need for Speed's
// street feel; 1 is full arcade. The physics underneath is never replaced --
// the assists only shape the steering, scale the grip, and add the forces a
// good driver's hands would.
//
//   * the steering lock follows the grip: a full key at speed asks for a
//     corner at the tyres' limit, not for more angle than they can use;
//   * a yaw-rate controller: a key asks for a RATE of turn, and the car is
//     helped to it -- adding rotation on turn-in, taking it out on overshoot;
//   * sticky sideways grip under a small slip (no ice, no wobble), counter-
//     steer and an anti-spin limit on the slide;
//   * a tyre that doesn't fall off a cliff past its peak, a little more grip
//     sideways than lengthways, grip that rises with speed, a planted rear;
//   * a handbrake that slides the rears instead of locking them dead;
//   * nitrous as a straight shove the traction control can't eat.
//
// Deterministic: arithmetic and square roots in the step, tables made once.

import type { VehicleSpec } from "./spec.ts";

/** Everything the assists are tuned by, at one arcade setting. */
export interface Tuning {
  /** Lock: slip margin over the grip-limited angle (x peakAngle). */
  readonly kAlpha: number;
  /** Yaw asked above the grip-limited rate, the controller's gain (1/s) and damping (s), its cap (rad/s^2). */
  readonly kTurn: number;
  readonly kp: number;
  readonly kd: number;
  readonly alphaMax: number;
  /** Sticky grip: under this slip angle (x peakAngle), the sideways slide is pulled out over tau (s), capped at muExtra x load. */
  readonly stickAngle: number;
  readonly stickTau: number;
  readonly muExtra: number;
  /** The slide the anti-spin allows (rad), and counter-steer's share of the slide put on the front wheels. */
  readonly betaMax: number;
  readonly kCounter: number;
  /** Grip rising with speed (1/(m/s)^2), up to a cap; the rear's extra grip; sideways over lengthways grip; the floor past the peak. */
  readonly kDownforce: number;
  readonly downforceCap: number;
  readonly rearScale: number;
  readonly latScale: number;
  readonly floor: number;
  /** The slip ratio the handbrake holds the rears at (-1: locked). */
  readonly handbrakeSlip: number;
  /** Nitrous as a push (m/s^2). */
  readonly boostAccel: number;
  /** Walls: bounce, scrub and how hard a glancing hit turns the nose parallel. */
  readonly wallBounce: number;
  readonly wallScrub: number;
  readonly wallAlign: number;
  /** How much of the tyres' roll and pitch lever on the body is kept (1: all of it, the physics). */
  readonly rollArm: number;
}

// Sim (arcade 0), Need for Speed (0.7) and full arcade (1): the tuning table's three columns.
const COLUMNS: Readonly<Record<keyof Tuning, readonly [number, number, number]>> = {
  kAlpha: [0, 0.6, 0.45],
  kTurn: [1, 1, 1.05],
  kp: [0, 7, 10],
  kd: [0, 0.03, 0.04],
  alphaMax: [0, 5, 8],
  stickAngle: [0, 0.7, 0.8],
  stickTau: [0.1, 0.1, 0.06],
  muExtra: [0, 0.2, 0.35],
  betaMax: [9, 0.14, 0.1],
  kCounter: [0, 0.7, 0.9],
  kDownforce: [0, 1e-4, 1.5e-4],
  downforceCap: [1, 1.35, 1.5],
  rearScale: [1, 1.1, 1.15],
  latScale: [1, 1.15, 1.25],
  floor: [0, 0.8, 0.9],
  handbrakeSlip: [-1, -0.35, -0.25],
  boostAccel: [0, 3.5, 4.5],
  wallBounce: [0.3, 0.15, 0.1],
  wallScrub: [0.6, 0.25, 0.15],
  wallAlign: [0, 2.5, 3.5],
  rollArm: [1, 0.45, 0.35],
};

const tunings = new Map<number, Tuning>();
/** The tuning at an arcade setting (0..1): the table's columns, straight lines between them (made once a setting). */
export function tuningAt(arcade: number): Tuning {
  const a = Math.max(0, Math.min(1, arcade));
  const known = tunings.get(a);
  if (known) return known;
  const out: Record<string, number> = {};
  for (const [k, [sim, nfs, arc]] of Object.entries(COLUMNS)) out[k] = a <= 0.7 ? sim + ((nfs - sim) * a) / 0.7 : nfs + ((arc - nfs) * (a - 0.7)) / 0.3;
  const t = out as unknown as Tuning;
  tunings.set(a, t);
  return t;
}

const G = 9.81;
/** The speed a full key's lock halves by, when a spec doesn't say (m/s). */
export const STEER_FADE = 70;

/** Grip's rise with speed (a multiplier on mu). */
export const gripAtSpeed = (t: Tuning, v: number): number => Math.min(t.downforceCap, 1 + t.kDownforce * v * v);

/**
 * How far a full key turns the front wheels at a speed (rad). At arcade 0 it's the physics' own (the lock easing off
 * with speed); above, it eases toward the grip-limited angle -- the angle that corners at the tyres' limit, plus a
 * little slip -- so a full key at 40 m/s is ~0.1 rad, not a quarter of a radian that only ploughs the fronts.
 */
export function lockAt(spec: VehicleSpec, speed: number, arcade = 0, mu = spec.grip): number {
  const v = Math.abs(speed), plain = spec.steerLock / (1 + v / (spec.steerFade ?? STEER_FADE));
  if (arcade <= 0) return plain;
  const t = tuningAt(arcade), L = spec.frontAxle - spec.rearAxle;
  const aMax = mu * G * gripAtSpeed(t, v) * t.latScale;
  const grip = Math.min(spec.steerLock, (L * aMax) / Math.max(1, v * v) + t.kAlpha * spec.peakAngle);
  const k = Math.min(1, arcade / 0.7);
  return plain + (Math.min(plain, grip) - plain) * k;
}

/** The assists' own memory, kept on the car (so a replay carries it). */
export interface AssistState {
  /** Yaw rate last sub-step (the controller's damping reads its change). */
  yawRate: number;
}
export const assistState = (): AssistState => ({ yawRate: 0 });

/**
 * The most lock worth asking for at a speed (rad): the angle that corners at the tyres' limit -- the wheelbase over
 * the tightest radius the grip allows -- plus a third of the slip a tyre peaks at. Past it the fronts only plough or the car
 * lets go. What a digital input (a key, a d-pad, a touch button: all or nothing) should ask for, since it can't feather
 * a wheel; an analog stick or wheel asks for its own angle. Never more than the physics' own lock.
 */
export function usefulLock(spec: VehicleSpec, speed: number, mu = spec.grip): number {
  const v = Math.abs(speed), L = spec.frontAxle - spec.rearAxle;
  return Math.min(lockAt(spec, v), (L * mu * G) / Math.max(1, v * v) + spec.peakAngle * 0.3);
}

/**
 * A steering command (-1..1, a share of the lock) from a driver's input: an analog one as it is, a digital one scaled
 * so a full press asks for `usefulLock` -- a tap of a key at 160 km/h is a lane change, not a full-lock yank.
 */
export function steerCommand(spec: VehicleSpec, speed: number, input: number, digital: boolean, mu = spec.grip): number {
  const s = Math.max(-1, Math.min(1, input));
  return digital ? (s * usefulLock(spec, speed, mu)) / lockAt(spec, speed) : s;
}
