// What a car IS to the physics: its mass and how it is spread, where its wheels
// are, its springs, its tyres, its engine and gears, its brakes and its air. A
// game builds one from whatever it generates cars from (redline maps
// packs/vehicles' Car onto it); the physics never knows where it came from.

export type Drivetrain = "fwd" | "rwd" | "awd";

export interface VehicleSpec {
  /** Kilograms. */
  readonly mass: number;
  /** The body as a box for its inertia and its ground contacts: full width, height, length (m). */
  readonly width: number;
  readonly height: number;
  readonly length: number;
  /** Height of the centre of mass above the ground at rest (m): a truck's is high, a prototype's low. */
  readonly comHeight: number;
  /** Axles: z forward of the centre (m), and half the track (m). */
  readonly frontAxle: number;
  readonly rearAxle: number;
  readonly halfTrack: number;
  readonly wheelRadius: number;
  readonly wheelWidth?: number;
  /** Generated hull contact points, relative to the centre of mass; otherwise use the body box. */
  readonly bodyContacts?: readonly (readonly [number, number, number])[];
  /** Cabin beltline in the same frame; points above it compress with roof damage. */
  readonly crushBelt?: number;
  /** Springs: rest length (m, from the mount down to the wheel's centre), stiffness (N/m) and damping (N s/m) per wheel. */
  readonly springLength: number;
  readonly springRate: number;
  readonly damping: number;
  /** Anti-roll: N/m of difference between the two wheels of an axle. */
  readonly antiRoll: number;
  /** Tyres: peak friction (1: a street tyre on dry tarmac), and how quickly they reach it. */
  readonly grip: number;
  /** The rear tyres' grip against the fronts' (wider rears: 1.1) -- a car that grips more at the back is stable flat out. */
  readonly rearGrip: number;
  /** Slip angle (rad) at the lateral peak, and slip ratio at the longitudinal peak. */
  readonly peakAngle: number;
  readonly peakRatio: number;
  /** Engine: peak power (W) at `peakRpm`, idle and redline. */
  readonly power: number;
  readonly peakRpm: number;
  readonly idleRpm: number;
  readonly redline: number;
  /** Forward gear ratios (first first), the reverse ratio (positive), and the final drive. */
  readonly gears: readonly number[];
  readonly reverse: number;
  readonly finalDrive: number;
  readonly drivetrain: Drivetrain;
  /** The differential: 0 open (the unloaded wheel spins up), 1 locked (both turn as one: a drift car's). */
  readonly diffLock: number;
  /** Share of brake torque at the front (0..1), and the most the brakes can ask of the tyres (N m per wheel). */
  readonly brakeBias: number;
  readonly brakeTorque: number;
  /** Anti-lock brakes: the pedal holds each wheel at the edge of its grip instead of locking it. */
  readonly abs: boolean;
  /** The handbrake's torque on each rear wheel (N m): enough to lock them is what starts a drift. */
  readonly handbrakeTorque: number;
  /** Steering lock (rad) at a standstill, and how fast the wheel winds on (rad/s): a truck's is slow. */
  readonly steerLock: number;
  readonly steerRate: number;
  /**
   * The speed (m/s) by which a full key's lock has halved -- a variable-ratio rack, and what a keyboard needs; left out,
   * 70 (so at 100 km/h a full key is still ~70% of the lock: yank it and the car goes where physics sends it).
   */
  readonly steerFade?: number;
  /**
   * Tyre load sensitivity: a tyre's grip grows slower than the weight on it (its mu falls by this much per extra
   * share of its static load). What makes weight transfer matter -- lift in a bend and the unloaded rear lets go; the
   * axle with the stiffer anti-roll bar gives first. Left out, 0.15 (a road tyre's).
   */
  readonly loadSens?: number;
  /** Air: drag area (N per (m/s)^2) and downforce (N per (m/s)^2). */
  readonly drag: number;
  readonly downforce: number;
}

/** A plain, reasonable car to start from (a 1300 kg rear-drive coupe). */
export const DEFAULT_SPEC: VehicleSpec = {
  mass: 1300, width: 1.8, height: 1.3, length: 4.3, comHeight: 0.5,
  frontAxle: 1.3, rearAxle: -1.3, halfTrack: 0.78, wheelRadius: 0.33,
  springLength: 0.32, springRate: 36000, damping: 3800, antiRoll: 12000,
  grip: 1.05, rearGrip: 1.05, peakAngle: 0.14, peakRatio: 0.12,
  power: 220000, peakRpm: 6500, idleRpm: 900, redline: 7200,
  gears: [3.3, 2.2, 1.6, 1.25, 1.0, 0.82], reverse: 3.2, finalDrive: 3.6, drivetrain: "rwd", diffLock: 0.4,
  brakeBias: 0.64, brakeTorque: 2600, abs: true, handbrakeTorque: 3200, steerLock: 0.55, steerRate: 3.5,
  drag: 0.38, downforce: 0.05,
};

/** Inertia of the body as a solid box (kg m^2, about x, y, z through the centre of mass). */
export function inertiaOf(s: VehicleSpec): [number, number, number] {
  const m = s.mass, w = s.width, h = s.height, l = s.length;
  return [(m / 12) * (h * h + l * l), (m / 12) * (w * w + l * l), (m / 12) * (w * w + h * h)];
}
