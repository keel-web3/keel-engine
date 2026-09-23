// A car as a rigid body on four raycast wheels -- full 3D, so it pitches under
// braking, squats on power, leans in a corner, and can roll right over.
//
// Each step, per wheel: a ray from its mount down the body's own "down" finds
// the ground; the spring and damper push back by how far they're squashed; the
// tyre pushes along and across the road by how much it's slipping (tyre.ts),
// within the grip the spring's load gives it. Every one of those forces acts at
// the point it acts at, so it turns the body as well as moving it -- which is
// all it takes for weight to move, for a light car to be tipped by a heavy one,
// and for a car on two wheels to go over.
//
// The engine drives the driven wheels through the gearbox (powertrain.ts); the
// brakes and the handbrake hold them; a locked rear axle has little grip left
// for cornering, so the tail comes round: a drift.
//
// Deterministic: arithmetic and square roots only in the step (the tyre curve is
// tabled once with core's dmath), a fixed sub-step, no clock.

import { datan2, dcos, dsin, dtan } from "@keel-engine/core";
import { assistState, gripAtSpeed, lockAt, tuningAt } from "./assist.ts";
import type { AssistState } from "./assist.ts";
import { add, addScaled, clamp, cross, dot, integrateQuat, norm, rotate, scale, sign, sub, unrotate, yawQuat } from "./math.ts";
import type { Quat, V3 } from "./math.ts";
import { driveTorque, powertrain, stepGearbox } from "./powertrain.ts";
import type { Powertrain } from "./powertrain.ts";
import { inertiaOf } from "./spec.ts";
import type { VehicleSpec } from "./spec.ts";
import { curve, tyreForce } from "./tyre.ts";
import type { Ground } from "./ground.ts";
import { FLAT } from "./ground.ts";

const G = 9.81;
/** Sub-steps a 1/60 s step is cut into: the springs and the tyres are stiff. */
const SUBSTEPS = 8;
/** The tyre curve's slope at zero slip (C B of the magic formula), and rolling resistance as a share of load. */
const TYRE_SLOPE = 2.4;
const ROLLING = 0.012;

/** What the driver asks for. */
export interface VehicleInput {
  readonly manual?: boolean;
  /** One press, consumed by the outer physics step. */
  readonly shift?: -1 | 0 | 1;
  /** 0..1. In reverse, the brake pedal drives and this brakes. */
  readonly throttle: number;
  /** 0..1. At a standstill, holding it selects reverse. */
  readonly brake: number;
  /** -1 (left) .. 1 (right). */
  readonly steer: number;
  /** Use the mechanical rack at every speed. Arcade retains its own assisted steering range. */
  readonly fullSteering?: boolean;
  /** 0..1: locks the rear wheels -- the drift button. */
  readonly handbrake: number;
  /** Extra engine power as a share (nitrous: 0.6 is 60% more), 0 if absent. */
  readonly boost?: number;
  /**
   * Traction control, 0 (off: all the wheelspin you can make) .. 1 (full): the engine is cut back while the driven
   * wheels spin past the tyres' peak. A burnout (both pedals) and the handbrake get round it.
   */
  readonly traction?: number;
  /**
   * Stability control, 0 (off) .. 1: a car that yaws faster or slower than its wheel asks is eased back toward it. Below
   * full it lets a slide be once it's plainly being driven sideways -- the less of it, the smaller the slide it leaves
   * alone (at 0.5, past ~17 degrees): a drift. The handbrake always switches it out.
   */
  readonly stability?: number;
  /** Held on the line (a race's grid): every brake on, but it isn't the pedal -- no reverse; gas on top is a burnout. */
  readonly hold?: boolean;
  /**
   * The handling assists, 0 (off: the physics as it is) .. 1 (full arcade); ~0.7 is Need for Speed's feel. See
   * assist.ts: a grip-aware steering lock, a yaw-rate controller, sticky grip, counter-steer, a sliding handbrake.
   */
  readonly arcade?: number;
}

export interface Wheel {
  /** Metres of spring squashed (0: hanging free). */
  compression: number;
  /** Angular speed (rad/s), and how far it has turned (rad) -- what the renderer spins it by. */
  spin: number;
  turned: number;
  /** The load on the tyre (N), whether it touches, and how far past its grip it is (0..). */
  load: number;
  contact: boolean;
  slide: number;
  /** Its spin against the road, in units of the tyre's peak (+ spinning up, - locking; past 1 it's lost its grip). */
  spinSlip: number;
  /** Its slip angle, the same way (how much of its grip is going on cornering). */
  sideSlip: number;
  /** Seconds until this tyre can strike another curb face; avoids repeatedly hitting one edge. */
  strikeCooldown: number;
}

/** Body-to-ground contacts measured by the suspension solver before its impulses slow the car. */
export interface GroundContact {
  corner: number; at: V3; normal: V3; speed: number; slide: number; work: number;
}
export interface Vehicle {
  readonly spec: VehicleSpec;
  /** Centre of mass (world, m), orientation, velocity (m/s) and angular velocity (rad/s, world). */
  p: V3;
  q: Quat;
  v: V3;
  w: V3;
  /** FL, FR, RL, RR. */
  readonly wheels: readonly Wheel[];
  readonly pt: Powertrain;
  /** The front wheels' angle (rad, + right). */
  steer: number;
  /** Seconds it's been upside down (a game can reset it after a while). */
  upsideDown: number;
  /** How much traction control is cutting the engine (0..1). */
  tcCut: number;
  /** The handling assists' memory. */
  readonly assist: AssistState;
  /**
   * Opt-in wear and damage (a game's damage model sets it; absent, the car is as built and steps exactly as it always
   * has). Per wheel FL, FR, RL, RR, and the engine's share of its power.
   */
  condition?: VehicleCondition;
  /** This step only. Read-only to consumers; no damage rules feed back into the contact solver. */
  groundContacts?: GroundContact[];
}

/** One corner's state: see VehicleCondition. */
export interface WheelCondition {
  /** Its tyre's grip, as a share (1 as built; a bent rim or a flat less). */
  grip: number;
  /** How much of the wheel's steering reaches it (1; a bent track rod less). A front wheel only. */
  steer: number;
  /** A fixed toe it's been knocked to (rad, + right): a bent corner pulls the car to one side. */
  toe: number;
  /** Its spring's stiffness as a share (1; a bent strut sags the corner). */
  spring: number;
  /** Gone: no spring, no tyre -- the corner drops onto the body and scrapes. */
  off: boolean;
}

/** A car's damage as its physics feels it (every field at its "as built" value is the same as no condition at all). */
export interface VehicleCondition {
  readonly wheels: readonly WheelCondition[];
  /** The engine's power as a share (1 as built; a damaged engine less). */
  power: number;
  /** Remaining cabin height above the beltline, 1 as built. */
  roofCompression?: number;
}

/** Where each wheel mounts in the body's frame (origin at the centre of mass): FL, FR, RL, RR. */
export function mountsOf(s: VehicleSpec): V3[] {
  const sag = (s.mass * G) / 4 / s.springRate;
  const y = s.wheelRadius + s.springLength - sag - s.comHeight;
  return [[-s.halfTrack, y, s.frontAxle], [s.halfTrack, y, s.frontAxle], [-s.halfTrack, y, s.rearAxle], [s.halfTrack, y, s.rearAxle]];
}

/** A car standing on flat ground at (x, z), heading `yaw` (frame convention: 0 faces +z). */
export function createVehicle(spec: VehicleSpec, x: number, z: number, yaw: number, ground: Ground = FLAT): Vehicle {
  const sag = (spec.mass * G) / 4 / spec.springRate;
  return {
    spec,
    p: [x, ground.height(x, z) + spec.comHeight, z],
    q: yawQuat(dcos(yaw / 2), dsin(yaw / 2)),
    v: [0, 0, 0],
    w: [0, 0, 0],
    wheels: [0, 1, 2, 3].map(() => ({ compression: sag, spin: 0, turned: 0, load: (spec.mass * G) / 4, contact: true, slide: 0, spinSlip: 0, sideSlip: 0, strikeCooldown: 0 })),
    pt: powertrain(),
    steer: 0,
    upsideDown: 0,
    tcCut: 0,
    assist: assistState(),
  };
}

// (Per-vehicle scratch derived from its spec: the body's inverse inertia and its mounts, made once.)
/** A road tyre's load sensitivity (see VehicleSpec.loadSens); a tyre skating sideways faster than this (m/s) over tripping ground digs in, with this much extra grip. */
const LOAD_SENS = 0.15, TRIP_SLIDE = 1.5, TRIP_MU = 1.2;
/** A kerb strike: a step up of more than this (m) met by a wheel sliding sideways faster than this (m/s). */
const STRIKE_STEP = 0.08, STRIKE_SLIDE = 2;
const derived = new WeakMap<VehicleSpec, { invI: V3; mounts: V3[]; wheelI: number; corners: V3[]; tanLock: number; staticLoad: number }>();
function derive(s: VehicleSpec) {
  let d = derived.get(s);
  if (!d) {
    const I = inertiaOf(s);
    // The body's box corners, for when it's on its side or its roof: floor and roof, all round.
    const hw = s.width / 2, hl = s.length / 2, lo = -s.comHeight + 0.12, hi = -s.comHeight + s.height;
    const corners: V3[] = [];
    if (s.bodyContacts) for (const p of s.bodyContacts) corners.push([p[0], p[1], p[2]]);
    else for (const y of [lo, hi]) for (const x of [-hw, hw]) for (const z of [-hl, hl]) corners.push([x, y, z]);
    d = { invI: [1 / I[0], 1 / I[1], 1 / I[2]], mounts: mountsOf(s), wheelI: 1.1 * (s.wheelRadius / 0.33) * (s.wheelRadius / 0.33), corners, tanLock: dtan(s.steerLock), staticLoad: (s.mass * G) / 4 };
    derived.set(s, d);
  }
  return d;
}

/** Apply a force at a world point: into the running force and torque. */
const push = (F: V3, T: V3, p: V3, at: V3, f: V3): void => { addScaled(F, f, 1); const t = cross(sub(at, p), f); addScaled(T, t, 1); };

/** Step a car by dt seconds (a fixed step: 1/60 s). */
export function stepVehicle(car: Vehicle, input: VehicleInput, dt: number, ground: Ground = FLAT): void {
  (car.groundContacts ??= []).length = 0;
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i += 1) substep(car, i === 0 ? input : { ...input, shift: 0 }, h, ground);
}

function recordGround(car: Vehicle, corner: number, at: V3, normal: V3, speed: number, slide: number, work: number): void {
  const contacts = car.groundContacts!, old = contacts.find(c => c.corner === corner);
  if (!old) contacts.push({ corner, at, normal, speed, slide, work });
  else {
    old.work += work; old.slide = Math.max(old.slide, slide);
    if (speed > old.speed) { old.speed = speed; old.at = at; old.normal = normal; }
  }
}

function substep(car: Vehicle, input: VehicleInput, h: number, ground: Ground): void {
  const s = car.spec, D = derive(s);
  const up = rotate(car.q, [0, 1, 0]), fwd = rotate(car.q, [0, 0, 1]), right = rotate(car.q, [1, 0, 0]);
  const forward = dot(car.v, fwd);
  // Steering: less lock at speed (with the assists, only as much as the tyres can use), and it takes a moment to wind on.
  const A = clamp(input.arcade ?? 0, 0, 1), t = A > 0 ? tuningAt(A) : null;
  const lock = input.fullSteering && A === 0 ? s.steerLock : lockAt(s, forward, A);
  let wantSteer = clamp(input.steer, -1, 1) * lock;
  // (Counter-steer: the fronts turned toward where a sliding car is going -- less of it the more the player already is.)
  if (t && forward > 3 && input.handbrake < 0.1) {
    const beta = dot(car.v, right) / Math.max(forward, 3);
    wantSteer += clamp(t.kCounter * beta, -lock, lock) * (1 - Math.max(0, clamp(input.steer, -1, 1) * sign(beta)));
  }
  car.steer += clamp(wantSteer - car.steer, -s.steerRate * h, s.steerRate * h);
  // The gearbox, from the driven wheels' speed.
  const W = car.wheels as Wheel[];
  const driven = s.drivetrain === "fwd" ? [0, 1] : s.drivetrain === "rwd" ? [2, 3] : [0, 1, 2, 3];
  let meanSpin = 0;
  for (const k of driven) meanSpin += W[k]!.spin;
  meanSpin /= driven.length;
  stepGearbox(car.pt, s, meanSpin, forward, input.throttle, input.brake, h, input.manual, input.shift);
  // Pedals, with reverse arcade-style: in reverse the brake pedal drives and the throttle brakes.
  const rev = car.pt.gear < 0 && (!input.manual || !!car.pt.brakeReverse);
  const throttle = clamp(rev ? input.brake : input.throttle, 0, 1);
  const brake = input.hold ? 1 : clamp(rev ? input.throttle : input.brake, 0, 1);
  // A burnout: both pedals down, barely rolling -- the brakes hold the fronts alone (a line lock) and the rears light up.
  const lineLock = car.pt.gear > 0 && throttle > 0.5 && brake > 0.5 && Math.abs(forward) < 4;
  // Traction control: the engine never sends the driven wheels more than their tyres can put down (their grip under
  // the load they carried last sub-step, and a little over -- a tyre pulls hardest just past the start of a slip).
  const assist = lineLock || input.handbrake > 0.2 ? 0 : clamp(input.traction ?? 0, 0, 1);
  // (Nitrous: more engine on the plain physics; with the assists, a straight shove -- see below -- that TC can't eat.)
  let drive = driveTorque(car.pt, s, throttle) * (t ? 1 : 1 + Math.max(0, input.boost ?? 0));
  // (A damaged engine: less of it. Absent a condition, untouched.)
  const C = car.condition;
  if (C) drive *= C.power;
  car.tcCut = 0;
  if (assist > 0 && drive > 0) {
    const mu = s.grip * ground.grip(car.p[0], car.p[2]);
    // (What a tyre has for driving is what cornering leaves it -- the friction circle -- so a car powering out of a bend
    // keeps its tail. And a wheel already spinning near its peak gets cut deeper until it hooks up.)
    let holds = 0, spinning = 0;
    for (const k of driven) {
      // (What's left is by force, not slip: a tyre at 80% of its peak slip angle is already giving ~all its grip
      // sideways, and one sliding past its peak has nothing left to drive with -- so a car cornering at the limit
      // can't be floored into a spin with TC on, as a real car's can't.)
      const w = W[k]!, side = curve(Math.min(1, Math.abs(w.sideSlip)));
      holds += mu * w.load * s.wheelRadius * Math.sqrt(Math.max(0.0025, 1 - side * side)) * 0.92;
      spinning = Math.max(spinning, w.spinSlip - 0.8);
    }
    holds *= spinning > 0 ? clamp(1 - spinning * 1.5, 0.3, 1) : 1;
    const capped = Math.min(drive, holds + (1 - assist) * drive);
    car.tcCut = 1 - capped / drive;
    drive = capped;
  }
  const axleTorque = drive;
  const split = lineLock && s.drivetrain !== "fwd" ? [0, 0, 1, 1] : s.drivetrain === "awd" ? [0.4, 0.4, 0.6, 0.6] : s.drivetrain === "fwd" ? [1, 1, 0, 0] : [0, 0, 1, 1];
  const splitSum = split.reduce((a, b) => a + b, 0);

  const F: V3 = [0, -s.mass * G, 0], T: V3 = [0, 0, 0];
  // ---- the springs: every wheel's compression first, so an axle's anti-roll bar can compare its two.
  const comp: number[] = [0, 0, 0, 0], at: V3[] = [], contact: boolean[] = [];
  for (let k = 0; k < 4; k += 1) {
    const mount = add(car.p, rotate(car.q, D.mounts[k]!));
    const gy = ground.height(mount[0], mount[2]);
    // (The ray runs down the body's own "down": on its side or roof, no wheel can reach the road.)
    const t = up[1] > 0.25 && !(C && C.wheels[k]!.off) ? (mount[1] - gy - s.wheelRadius) / up[1] : Infinity;
    const c = s.springLength - t;
    contact[k] = c > 0;
    comp[k] = clamp(c, 0, s.springLength);
    at[k] = [mount[0] - up[0] * t, gy, mount[2] - up[2] * t];
  }
  for (let k = 0; k < 4; k += 1) {
    const wheel = W[k]!;
    wheel.strikeCooldown = Math.max(0, (wheel.strikeCooldown ?? 0) - h);
    const rate = (comp[k]! - wheel.compression) / h;
    wheel.compression = comp[k]!;
    wheel.contact = contact[k]!;
    if (!contact[k]) { wheel.load = 0; wheel.slide = 0; wheel.spinSlip = 0; wheel.sideSlip = 0; spinFree(wheel, k, split[k]! * axleTorque / splitSum, brake, input.handbrake, s, D.wheelI, h); continue; }
    const other = k ^ 1;
    const arb = s.antiRoll * (comp[k]! - comp[other]!);
    // A ray crossing a height step must not feed an effectively infinite shaft speed to a linear damper.
    // High-speed damper blow-off bounds that contribution; the spring and anti-roll bar still carry the body.
    const damper = clamp(s.damping * rate, -2 * D.staticLoad, 2 * D.staticLoad);
    const Fs0 = Math.max(0, s.springRate * comp[k]! + damper + arb);
    const Fs = C ? Fs0 * C.wheels[k]!.spring : Fs0;
    wheel.load = Fs;
    const mount = add(car.p, rotate(car.q, D.mounts[k]!));
    push(F, T, car.p, mount, scale(up, Fs));
    // ---- the tyre: which way it points on the road, how it's slipping, what it pushes back with.
    const steerK = C ? (k < 2 ? car.steer * C.wheels[k]!.steer : 0) + C.wheels[k]!.toe : k < 2 ? car.steer : 0;
    const c = dcosSmall(steerK), sn = dsinSmall(steerK);
    const wf = norm([fwd[0] * c + right[0] * sn, 0, fwd[2] * c + right[2] * sn]);
    const wl: V3 = [wf[2], 0, -wf[0]];
    const cp = at[k]!;
    const vc = add(car.v, cross(car.w, sub(cp, car.p)));
    const vLong = dot(vc, wf), vLat = dot(vc, wl);
    const soft = Math.max(Math.abs(vLong), 3);
    const ratio = (wheel.spin * s.wheelRadius - vLong) / soft;
    const angle = vLat / soft;
    // (With the assists: grip that rises with speed, a planted rear, more grip sideways, no cliff past the peak.)
    // (And load sensitivity: a tyre pressed harder grips more, but by less than the extra weight.)
    const sens = clamp(1 - (s.loadSens ?? LOAD_SENS) * (Fs / D.staticLoad - 1), 0.55, 1.3);
    const mu = (C ? C.wheels[k]!.grip : 1) * s.grip * sens * (k >= 2 ? s.rearGrip * (t ? t.rearScale : 1) : 1) * ground.grip(cp[0], cp[2]) * (t ? gripAtSpeed(t, Math.abs(forward)) : 1), tyreGrip = mu * Fs;
    const tyre = tyreForce(ratio, angle, Fs, mu, s.peakRatio, s.peakAngle, t ? t.latScale : 1, t ? t.floor : 0);
    wheel.slide = tyre.slide;
    wheel.spinSlip = ratio / s.peakRatio;
    wheel.sideSlip = angle / s.peakAngle;
    // (With the assists the tyre pushes from part-way up toward the centre of mass -- a lower roll centre -- so grip
    // past what a real car's track and height would hold doesn't lever it over.)
    const at2 = t ? add(cp, scale(up, dot(sub(car.p, cp), up) * (1 - t.rollArm))) : cp;
    push(F, T, car.p, at2, [wf[0] * tyre.fx + wl[0] * tyre.fy, 0, wf[2] * tyre.fx + wl[2] * tyre.fy]);
    // (Tripping: a tyre skating sideways over ground that catches it -- grass, dirt, a kerb -- digs in, at ground level,
    // past its own grip: a low wide car slews round, a tall narrow one goes over.)
    // (Soft ground's own drag on a rolling tyre.)
    const bog = ground.drag ? ground.drag(cp[0], cp[2]) : 0;
    if (bog > 0) push(F, T, car.p, cp, scale(wf, -clamp(vLong, -1, 1) * bog * Fs));
    const trip = ground.trip ? ground.trip(cp[0], cp[2]) : 0;
    if (trip > 0 && Math.abs(vLat) > TRIP_SLIDE) {
      const dig = -sign(vLat) * trip * TRIP_MU * Fs * Math.min(1, (Math.abs(vLat) - TRIP_SLIDE) / 3);
      push(F, T, car.p, cp, scale(wl, dig));
    }
    // (A kerb's face: a wheel sliding sideways into a step up takes the blow at ground level -- that side stops dead, the
    // body carries on over it, and a tall car goes over. Riding straight up onto a kerb, or over a slope, doesn't.)
    if (Math.abs(vLat) > STRIKE_SLIDE && wheel.strikeCooldown === 0) {
      const side = sign(vLat), reach = Math.abs(vLat) * h + 0.05;
      const rise = ground.height(cp[0] + wl[0] * side * reach, cp[2] + wl[2] * side * reach) - cp[1];
      if (rise > STRIKE_STEP) {
        // One edge impact, bounded by this corner's share of the mass. Assistance softens the trip lever.
        const J = Math.min(1, rise / 0.15) * (Math.abs(vLat) - STRIKE_SLIDE * 0.5) * s.mass * 0.25 * (1 - 0.5 * A);
        push(F, T, car.p, at2, scale(wl, (-side * J) / h));
        wheel.strikeCooldown = 0.12;
      }
    }
    // (Sticky grip: under a small slip the sideways slide is pulled out -- the car rails; past it, the tyre as it is.)
    if (t && input.handbrake < 0.1 && Math.abs(forward) > 2 && Math.abs(angle) < t.stickAngle * s.peakAngle) {
      const extra = clamp((-vLat * (s.mass / 4)) / t.stickTau, -t.muExtra * Fs, t.muExtra * Fs);
      push(F, T, car.p, at2, scale(wl, extra));
    }
    // ---- the wheel: driven, braked, and dragged by the road.
    const drive = (split[k]! * axleTorque) / splitSum;
    // (ABS: the pedal never asks more of a wheel than its tyre can hold -- a car stops straight and short. The
    // handbrake has none: locking the rears is the point of it.)
    const full = lineLock && (s.drivetrain === "fwd" ? k < 2 : k >= 2) ? 0 : brake * s.brakeTorque * (k < 2 ? s.brakeBias : 1 - s.brakeBias) * 2;
    const locking = s.abs && ratio * sign(vLong) < -s.peakRatio;
    // (It holds the tyre just under its peak, not at it: some grip is left over to turn with while braking.)
    // (And the rears are asked less than the fronts -- brake distribution: a rear at its limit has nothing left to hold
    // the tail with, and a car braking into a corner would swap ends.)
    const pedal = locking ? Math.min(full, Math.abs(tyre.fx) * s.wheelRadius * 0.7) : Math.min(full, s.abs ? tyreGrip * s.wheelRadius * (k < 2 ? 0.85 : 0.55) : Infinity);
    // (With the assists the handbrake slides the rears -- held near a slip, not locked dead: they keep some bite.)
    const handbrake = k >= 2 ? input.handbrake * s.handbrakeTorque * (t && ratio * sign(vLong) < t.handbrakeSlip ? 0.15 : 1) : 0;
    const brakeT = pedal + handbrake;
    // (Implicit in the tyre: the road's pull on the wheel is stiff -- stepped plainly it rings -- so the step is
    // taken against the curve's slope at the centre, which holds steady at any sub-step.)
    // (Past the peak the curve is flat: no stiffness to hold against, and a locked wheel must be free to spin back up.)
    const stiff = tyre.slide > 0 ? 0 : (mu * Fs * TYRE_SLOPE * s.wheelRadius * s.wheelRadius) / (s.peakRatio * soft);
    const roll = ROLLING * Fs * s.wheelRadius * sign(wheel.spin);
    let spin = wheel.spin + ((drive - tyre.fx * s.wheelRadius - roll) / D.wheelI) * h / (1 + (h * stiff) / D.wheelI);
    const hold = (brakeT * h) / D.wheelI;
    spin = Math.abs(spin) <= hold ? 0 : spin - sign(spin) * hold;
    wheel.spin = spin;
    wheel.turned += spin * h;
  }
  // ---- the differential: a limited-slip one pulls each driven pair's spins together.
  for (let k = 0; k < 4; k += 2) {
    if (split[k] === 0) continue;
    const l = W[k]!, r = W[k + 1]!, pull = ((r.spin - l.spin) / 2) * s.diffLock;
    l.spin += pull;
    r.spin -= pull;
  }
  // ---- the body itself touching the ground: a car on its side or its roof slides on it, and stops.
  const rolled = up[1] < 0.5, localDown = rolled ? unrotate(car.q, [0, -1, 0]) : null;
  for (let cornerIndex = 0; cornerIndex < D.corners.length + (rolled ? 4 : 0); cornerIndex++) {
    let corner: V3;
    if (cornerIndex < D.corners.length) {
      const p = D.corners[cornerIndex]!, belt = s.crushBelt ?? s.height * 0.6 - s.comHeight;
      corner = p[1] > belt ? [p[0], belt + (p[1] - belt) * (car.condition?.roofCompression ?? 1), p[2]] : p;
    } else {
      // Raycast suspension handles upright tyres. On a side/roof, their shoulders can strike the road too.
      const k = cornerIndex - D.corners.length;
      if (car.condition?.wheels[k]?.off) continue;
      const c = wheelCentre(car, k), down = localDown!, radial = Math.sqrt(down[1] ** 2 + down[2] ** 2);
      corner = [c[0] + sign(down[0]) * (s.wheelWidth ?? 0.22) / 2, c[1] + (radial > 1e-6 ? down[1] / radial * s.wheelRadius : 0), c[2] + (radial > 1e-6 ? down[2] / radial * s.wheelRadius : 0)];
    }
    const pt = add(car.p, rotate(car.q, corner));
    const gy = ground.height(pt[0], pt[2]);
    const pen = gy - pt[1];
    if (pen <= 0) continue;
    const vc = add(car.v, cross(car.w, sub(pt, car.p)));
    // (Ground that says which way it faces -- Ground.normal -- pushes along that: a cliff face shoves a car back out of
    // it instead of lifting it up it. Without one, straight up, as always.)
    const gn = ground.normal ? ground.normal(pt[0], pt[2]) : null;
    if (gn) {
      const depth = pen * gn[1], vn = vc[0] * gn[0] + vc[1] * gn[1] + vc[2] * gn[2];
      const nn = Math.max(0, depth * s.mass * 60 - vn * s.mass * 3);
      const tx = vc[0] - gn[0] * vn, ty = vc[1] - gn[1] * vn, tz = vc[2] - gn[2] * vn, tv = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const fr2 = tv > 1e-6 ? Math.min(nn * 0.6, (tv * s.mass) / (h * 8)) / tv : 0;
      recordGround(car, cornerIndex, pt, [gn[0], gn[1], gn[2]], Math.max(0, -vn), tv, fr2 * tv * tv * h);
      push(F, T, car.p, pt, [gn[0] * nn - tx * fr2, gn[1] * nn - ty * fr2, gn[2] * nn - tz * fr2]);
      continue;
    }
    const n = Math.max(0, pen * s.mass * 60 - vc[1] * s.mass * 3);
    const hv = Math.sqrt(vc[0] * vc[0] + vc[2] * vc[2]);
    const fr = hv > 1e-6 ? Math.min(n * 0.6, (hv * s.mass) / (h * 8)) / hv : 0;
    recordGround(car, cornerIndex, pt, [0, 1, 0], Math.max(0, -vc[1]), hv, fr * hv * hv * h);
    push(F, T, car.p, pt, [-vc[0] * fr, n, -vc[2] * fr]);
  }
  // ---- the air: drag against the motion, downforce with the square of the speed.
  const speed = Math.sqrt(dot(car.v, car.v));
  if (speed > 1e-6) addScaled(F, car.v, -s.drag * speed);
  addScaled(F, up, -s.downforce * forward * forward);
  // ---- the assists: a yaw-rate controller -- a key asks for a RATE of turn (no more than the grip allows), and the car
  // is helped to it, adding rotation on turn-in and taking it out on overshoot -- and an anti-spin limit on the slide.
  let contacts = 0;
  for (const w of W) if (w.contact) contacts += 1;
  if (t) {
    const r = dot(car.w, up), v = Math.abs(forward);
    if (v > 3 && contacts > 0 && input.handbrake < 0.1) {
      const L = s.frontAxle - s.rearAxle, aMax = s.grip * G * gripAtSpeed(t, v) * t.latScale;
      const rDes = clamp(input.steer, -1, 1) * Math.min((v * D.tanLock) / L, aMax / v) * t.kTurn * sign(forward);
      const e = rDes - r;
      let acc = clamp(t.kp * e - (t.kd * (r - car.assist.yawRate)) / h, -t.alphaMax, t.alphaMax);
      // (Adding turn to a car whose fronts are already sliding would only swap its ends.)
      if (sign(e) === sign(rDes) && Math.abs(r) < Math.abs(rDes)) acc *= 1 - clamp(Math.max(Math.abs(W[0]!.sideSlip), Math.abs(W[1]!.sideSlip)) - 1, 0, 1);
      // (Anti-spin: past part of the allowed slide the controller stops turning the nose away from where the car is
      // going, and past all of it the nose is pulled back round toward it.)
      const beta = dot(car.v, right) / Math.max(v, 3), over = (Math.abs(beta) - 0.5 * t.betaMax) / (0.5 * t.betaMax);
      if (acc * beta * sign(forward) < 0 && over > 0) acc *= 1 - clamp(over, 0, 1);
      if (Math.abs(beta) > t.betaMax) acc += 30 * (beta - sign(beta) * t.betaMax) * sign(forward);
      addScaled(T, up, (acc / D.invI[1]) * (contacts / 4));
    }
    car.assist.yawRate = r;
    // Nitrous as a shove along the car (on the road).
    if ((input.boost ?? 0) > 0 && contacts > 0) addScaled(F, fwd, s.mass * t.boostAccel * (contacts / 4));
  }
  // ---- stability control (the plain physics' own): a yaw the wheel isn't asking for is eased out (a held drift is left alone).
  const esc = t ? 0 : clamp(input.stability ?? 0, 0, 1) * (input.handbrake > 0.1 ? 0 : 1);
  if (esc > 0 && Math.abs(forward) > 5) {
    const lateral = dot(car.v, right), bodySlip = Math.abs(lateral) / Math.max(1, Math.abs(forward));
    const leave = esc >= 1 ? Infinity : 0.1 + (1 - esc) * 0.4;
    if (bodySlip < leave) {
      const asked = (forward * car.steer) / Math.max(1, s.frontAxle - s.rearAxle);
      const yaw = dot(car.w, up);
      // (Two things, both only ever taking yaw OUT, as brakes on single wheels do: a yaw past what the wheel asks for, and
      // a slide past an ordinary corner's, the nose brought round toward where the car is going. It never adds turn to an
      // understeering car -- that would only swap its ends.)
      const over = Math.abs(yaw) > Math.abs(asked) && sign(yaw) !== -sign(asked) ? yaw - asked : 0;
      const beta = lateral / Math.max(1, Math.abs(forward)), slideBeyond = Math.abs(beta) > 0.08 ? beta - 0.08 * sign(beta) : 0;
      addScaled(T, up, (-over * 4 + slideBeyond * 6 * sign(forward)) * esc * inertiaOf(s)[1] * (esc >= 1 ? 1 : 1 - bodySlip / leave));
    }
  }
  // ---- integrate: the body's motion, and its turning through its inertia (in its own frame).
  addScaled(car.v, F, h / s.mass);
  const tb = unrotate(car.q, T);
  const ab: V3 = [tb[0] * D.invI[0], tb[1] * D.invI[1], tb[2] * D.invI[2]];
  addScaled(car.w, rotate(car.q, ab), h);
  car.w = scale(car.w, 1 - 0.15 * h);
  addScaled(car.p, car.v, h);
  car.q = integrateQuat(car.q, car.w, h);
  car.upsideDown = up[1] < 0.2 ? car.upsideDown + h : 0;
}

/** A wheel in the air: driven and braked, with nothing to push against. */
function spinFree(wheel: Wheel, k: number, drive: number, brake: number, handbrake: number, s: VehicleSpec, wheelI: number, h: number): void {
  const brakeT = brake * s.brakeTorque + (k >= 2 ? handbrake * s.handbrakeTorque : 0);
  let spin = wheel.spin + (drive / wheelI) * h;
  const hold = (brakeT * h) / wheelI + 0.02 * Math.abs(spin) * h;
  spin = Math.abs(spin) <= hold ? 0 : spin - sign(spin) * hold;
  wheel.spin = spin;
  wheel.turned += spin * h;
}

// (Steering angles are small, so the wheel's own heading needs no table: cos and sin to well under a pixel's error.)
const dcosSmall = (a: number): number => 1 - (a * a) / 2 + (a * a * a * a) / 24;
const dsinSmall = (a: number): number => a - (a * a * a) / 6 + (a * a * a * a * a) / 120;

/** The car's heading (frame convention: 0 faces +z) and its speed along it. */
export function headingOf(car: Vehicle): { yaw: number; forward: number } {
  const f = rotate(car.q, [0, 0, 1]);
  return { yaw: datan2(f[0], f[2]), forward: dot(car.v, f) };
}

/**
 * Where wheel k's centre is in the body's frame (origin at the centre of mass): its mount, down its spring by however
 * far the spring is out -- what a renderer hangs the wheel from, so a wheel drops off a crest and tucks up in a landing.
 */
export function wheelCentre(car: Vehicle, k: number): V3 {
  const m = derive(car.spec).mounts[k]!;
  return [m[0], m[1] - (car.spec.springLength - car.wheels[k]!.compression), m[2]];
}
