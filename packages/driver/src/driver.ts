// An AI driver: given where its car is on a route and how it's moving, the
// pedals and the wheel. It does what a quick human does --
//
//   * the LINE: toward the inside of what's coming, by how tight it is, and off
//     it past a car just ahead;
//   * the WHEEL: pure pursuit -- the arc from here through a point on the line a
//     way ahead (further the faster it's going), as the wheel angle that drives
//     it -- plus a correction toward the yaw rate that arc wants, so the car is
//     steered by how it's actually turning, not only where its nose points;
//   * the SPEED: the most the next 150 m allow (each corner's grip-limited speed,
//     and the braking to get there from here), on the car's own grip, with a
//     margin that grows with speed (drag and throttle use some of the tyres).
//
// It knows nothing about races: a route is a keel/road path, the traffic is
// where the others are along it. Deterministic (core's dmath).

import { datan2, dsin } from "@keel-engine/core";
import { pointAt, wrapAngle } from "@keel-engine/road";
import type { Path } from "@keel-engine/road";
import { gripAtSpeed, lockAt, tuningAt } from "@keel-engine/vehicle";
import type { VehicleSpec } from "@keel-engine/vehicle";
import { STRETCH, mistakeAt } from "./mind.ts";
import type { DriverSkills, Mistake, MistakeKind } from "./mind.ts";

/** A driver's personality: how close to the limit (0.8..1), which side of the road it likes (-1..1), how far ahead it looks (x). */
export interface DriverTraits {
  readonly skill: number;
  readonly line: number;
  readonly look: number;
}

/** The car as the driver feels it: where, which way, how fast, how fast it's turning, what it is. */
export interface DriverView {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly yawRate: number;
  readonly spec: VehicleSpec;
}

/** Another car near on the route: how far ahead of us along it (m, - behind), and how far off its centre (+ right). */
export interface Traffic {
  readonly gap: number;
  readonly d: number;
}

export interface DriveOptions {
  /** Half the road's width (m): how far off the centre the line may go. */
  readonly half: number;
  /** The grip under the car as a share of tarmac (grass ~0.6). */
  readonly surface?: number;
  /** A speed it won't go past (m/s): cruising after the flag, traffic. */
  readonly cruise?: number;
  /** The handling assists the car is driven with (vehicle's `arcade`, 0..1): the wheel and the grip it plans on. */
  readonly arcade?: number;
  /**
   * A mind (mind.ts; a generateDriver's seed, skills, mistakes and size fit it): who's driving -- their skills shape how they drive, and their mistakes come out of their weak
   * spots, stretch by stretch of road from their seed (the same race, the same mistakes). Left out: a flawless driver.
   * `rate` scales how error-prone the whole field is (1: a normal street race).
   */
  readonly mind?: { readonly seed: number; readonly skills: DriverSkills; readonly rate?: number; readonly mistakes?: Readonly<Record<MistakeKind, number>>; readonly size?: number };
}

export interface Pedals {
  readonly throttle: number;
  readonly brake: number;
  readonly steer: number;
}

/** The pedals and the wheel, at `s` metres along the route. */
export function drive(me: DriverView, route: Path, s: number, traits: DriverTraits, traffic: readonly Traffic[], o: DriveOptions): Pedals {
  const spec = me.spec, v = Math.max(0, me.speed), half = o.half, mind = o.mind, sk = mind?.skills;
  // (Without a mind, every skill reads as the flawless driver's defaults: the numbers below reduce to the plain ones.)
  const weave = sk ? 10 + sk.weaving * 12 : 14, dodge = sk ? 2.6 + sk.weaving * 1.2 : 3.2;
  // A rival on the bumper: the pressure that makes a driver crack.
  let pressure = 0;
  for (const t of traffic) if (t.gap < 0 && t.gap > -12) pressure = Math.max(pressure, 1 + t.gap / 12);
  // The mistake on this stretch of road, and the ones on the stretches ahead (for the speed plan).
  const bendOf = (n: number): number => Math.abs(pointAt(route, (n + 0.5) * STRETCH).curve);
  const slip = (n: number): Mistake | null => (mind ? mistakeAt(mind.seed, n, mind.skills, bendOf(n), v, pressure, mind.rate ?? 1, mind.mistakes, mind.size ?? 1) : null);
  const here = Math.floor(s / STRETCH), now = slip(here);
  // The line: toward the inside of what's coming, by how tight it is; off it past a car just ahead -- unless this
  // driver holds their line (aggression) or goes for a gap that isn't there (a dive).
  const ahead = pointAt(route, s + 10 + v * 0.5);
  let offset = traits.line * half + Math.sign(ahead.curve) * half * 0.6 * Math.min(1, Math.abs(ahead.curve) * 32);
  const holds = sk ? sk.aggression > 0.7 && sk.weaving < 0.5 : false;
  for (const t of traffic) {
    if (!(t.gap > 0 && t.gap < weave && Math.abs(t.d - offset) < 2.6)) continue;
    if (now?.kind === "dive") offset = t.d + (Math.sign(ahead.curve) || 1) * 1.2;   // up the inside, far too tight
    else if (!holds) offset = t.d + (t.d > 0 ? -dodge : dodge);
  }
  offset = Math.max(-half * 0.8, Math.min(half * 0.8, offset));
  // The wheel: pure pursuit, with yaw-rate feedback. (Further ahead the faster: a short look at speed saws the wheel.)
  const reach = (6 + v * 0.42 + Math.max(0, v - 22) * 0.6) * traits.look;
  const target = pointAt(route, s + reach, offset);
  const alpha = wrapAngle(datan2(target.x - me.x, target.z - me.z) - me.yaw);
  const wheelbase = spec.frontAxle - spec.rearAxle;
  const kappa = (2 * dsin(alpha)) / Math.max(4, reach);
  const angle = datan2(wheelbase * kappa, 1) + (sk ? 0.03 + sk.control * 0.06 : 0.06) * (v * kappa - me.yawRate);
  const arcade = o.arcade ?? 0, lock = lockAt(spec, v, arcade);
  let steer = Math.max(-1, Math.min(1, angle / lock));
  // A twitch: the wheel flinches one way and back over the stretch.
  if (now?.kind === "twitch") steer += now.side * 0.35 * now.size * dsin(Math.PI * ((s - here * STRETCH) / STRETCH));
  // The speed: the most the road ahead allows, on this car's grip (less of it at speed), braking from here.
  const surface = (o.surface ?? 1) * (arcade > 0 ? gripAtSpeed(tuningAt(arcade), v) * tuningAt(arcade).latScale : 1);
  // (A good cornerer dares more of the grip; a good braker brakes later and harder.)
  const lateral = spec.grip * 9.81 * traits.skill * (sk ? 0.9 + sk.cornering * 0.2 : 1) * (0.84 - Math.min(0.14, Math.max(0, v - 25) * 0.006)) * surface;
  const decel = spec.grip * 9.81 * (sk ? 0.5 + sk.braking * 0.2 : 0.6) * surface;
  let allow = o.cruise ?? 200;
  for (let k = 0; k <= 30; k += 1) {
    const ds = k * 5;
    const c = Math.abs(pointAt(route, s + ds).curve);
    // (Mistakes in the plan: a corner judged faster than it is, a braking point judged later.)
    const m = mind ? slip(Math.floor((s + ds) / STRETCH)) : null;
    const lat = m?.kind === "overcook" ? lateral * (1 + 0.8 * m.size) : lateral;
    const dec = m?.kind === "lateBrake" ? decel * (1 - 0.6 * Math.min(1, m.size)) : decel;
    const vc = c > 1e-4 ? Math.sqrt(lat / c) : 200;
    allow = Math.min(allow, Math.sqrt(vc * vc + 2 * dec * ds));
  }
  let throttle = Math.max(0, Math.min(1, (allow - v) * 0.6));
  let brake = Math.max(0, Math.min(1, (v - allow - 0.5) * 0.35));
  // A lift mid-corner: off the throttle through the stretch's first half, then stabbing it back -- the tail steps out.
  if (now?.kind === "lift") { const f = (s - here * STRETCH) / STRETCH; if (f < 0.5) { throttle = 0; brake = 0; } else throttle = 1; }
  // (Aggression: braking late behind a car just ahead, not lifting for it.)
  if (sk && sk.aggression > 0.6) for (const t of traffic) if (t.gap > 0 && t.gap < 8 && Math.abs(t.d - offset) < 1.8) brake *= 0.5;
  // Facing the wrong way round (or backing out of a wall): turn for home.
  const heading = pointAt(route, s).yaw, off = wrapAngle(heading - me.yaw);
  if (Math.abs(off) > 2.2) { steer = Math.sign(off); throttle = 0.5; brake = 0; }
  return { throttle, brake, steer };
}
