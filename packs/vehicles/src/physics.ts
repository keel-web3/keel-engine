// A generated car as the physics drives it (keel/vehicle's VehicleSpec): the
// same car the showroom draws, measured for the road. Its weight and power are
// its Handling's; its wheels, axles and track its body's; the rest follows the
// kind of car it is -- a pickup sits high on soft springs and turns its wheel
// slowly, a hypercar is low and stiff and puts its power down through all four,
// a kei car revs to the moon through a front axle. Deterministic: a car's spec
// is a function of its seed.

import { dcbrt } from "@keel-engine/core";
import type { Drivetrain, VehicleSpec } from "@keel-engine/vehicle";
import type { Car } from "./car.ts";
import { clamp, drawsOf } from "./draws.ts";

const G = 9.81;

/** Where each class's engine makes its power (rpm), and its drivetrain odds. */
const ENGINE: Readonly<Record<string, { peak: number; drive: ReadonlyArray<readonly [Drivetrain, number]> }>> = {
  hyper: { peak: 7600, drive: [["awd", 6], ["rwd", 4]] }, proto: { peak: 8400, drive: [["rwd", 1]] },
  gt: { peak: 6800, drive: [["rwd", 7], ["awd", 3]] }, muscle: { peak: 5600, drive: [["rwd", 1]] },
  rally: { peak: 6900, drive: [["awd", 8], ["fwd", 2]] }, kei: { peak: 7800, drive: [["fwd", 7], ["rwd", 3]] },
  pickup: { peak: 4800, drive: [["rwd", 5], ["awd", 5]] }, buggy: { peak: 6200, drive: [["rwd", 1]] },
};
/** A semi tractor's: a diesel's low peak, driving its rear tandem. */
const SEMI_ENGINE: { peak: number; drive: ReadonlyArray<readonly [Drivetrain, number]> } = { peak: 1800, drive: [["rwd", 1]] };
/** Six forward ratios, first to top (the final drive sets the car's own reach). */
const GEARS = [3.4, 2.25, 1.62, 1.26, 1.0, 0.8] as const;

/**
 * The physics' measure of a generated car: its spec, and where its centre of mass sits in the car's own frame (the
 * body mesh's origin is the ground under its middle; the physics' is the centre of mass) -- a renderer's offset.
 */
export interface CarPhysics { readonly spec: VehicleSpec; readonly com: { readonly y: number; readonly z: number } }

export function physicsOf(car: Car): CarPhysics {
  const g = car.body, h = car.handling, cls = car.archetype, D = drawsOf(`keel-vehicles|physics|${car.seed}`);
  const truck = cls === "pickup", buggy = cls === "buggy", low = cls === "hyper" || cls === "proto";
  const mass = h.massKg;
  // (The road's scale: Handling's power and drag are the showroom's numbers; on the road a car wears a little less of
  // the one and a little more of the other, so the fastest top out near 330 km/h and a kei near 160.)
  const power = h.power, drag = h.drag * 1.25;
  const radius = (car.wheels[0].radius + car.wheels[1].radius) / 2;
  // (The centre of mass: about a third of the way from the floor to the roof, as real cars measure -- a slammed
  // hypercar's ~0.45 m, a hatchback's ~0.55, a lifted pickup's ~0.9, its load up high. What a tall narrow car pays for:
  // a hard turn loads its outside wheels until the inside ones lift, and a yank the other way throws it over.)
  const roof = Math.max(g.belt + 0.2, g.roof);
  // (A semi tractor's sits low on its frame for all the cab over it: an engine, a gearbox and the rails, ~1.1 m.)
  const semi = !!car.parts.semi;
  const comHeight = semi ? 1.1 : g.ride + (roof - g.ride) * (truck ? 0.42 : buggy ? 0.36 : low ? 0.3 : 0.34);
  // (And a little ahead of the axles' middle -- an engine up front, as most cars carry theirs; a mid-engined car's
  // sits nearer the middle. A car heavier at the front is stable flat out; one heavier at the back wants to swap ends.)
  const wheelbase = g.frontAxle - g.rearAxle;
  const comZ = (g.frontAxle + g.rearAxle) / 2 + wheelbase * (low || buggy ? 0.02 : 0.04);
  // Springs: how far the car settles onto them (a lifted truck is soft, a slammed car stiff), damped a little under critical.
  const sag = clamp(0.075 + 0.05 * car.dials.ride + (truck || buggy ? 0.035 : 0) - (low ? 0.02 : 0), 0.04, 0.16);
  const springRate = (mass * G) / 4 / sag;
  const damping = 2 * 0.42 * Math.sqrt(springRate * (mass / 4));
  const tyre = car.wheels[1].tyre;
  // (Street rubber: ~0.9 of a g on a road car, a semi-slick hypercar ~1.15 -- a corner taken too fast is not taken.)
  const grip = clamp((h.grip / 10.2) * 0.85, 0.7, 1.12) * (tyre === "knobby" ? 0.92 : tyre === "slick" ? 1.05 : 1);
  const engine = semi ? SEMI_ENGINE : ENGINE[cls] ?? { peak: 6500, drive: [["rwd", 1]] as const };
  const peakRpm = engine.peak, redline = peakRpm + 700;
  // Gearing: top gear tops out a little past where the car's power meets its drag (so it pulls its last gear to the end).
  const vmax = dcbrt((power * 0.88) / Math.max(0.05, drag)) * 1.06;
  const finalDrive = ((redline * Math.PI) / 30) * radius / (vmax * GEARS[5]);
  const aero = car.parts.spoiler === "bigwing" || car.parts.spoiler === "swan" ? 0.9 : car.parts.spoiler === "wing" ? 0.5 : car.parts.spoiler === "none" ? 0.1 : 0.25;
  const spec: VehicleSpec = {
    mass, width: g.width, height: roof, length: g.length, comHeight,
    crushBelt: g.belt - comHeight, wheelWidth: (car.wheels[0].width + car.wheels[1].width) / 2,
    bodyContacts: [
      // Preserve the established floor clearance and footprint; shape the upper hull to the cabin.
      ...[-g.width / 2, g.width / 2].flatMap(x => [-g.length / 2, g.length / 2].map(z => [x, .12 - comHeight, z] as const)),
      ...[-g.width / 2, g.width / 2].flatMap(x => [-g.length / 2, g.length / 2].map(z => [x, g.belt - comHeight, z - comZ] as const)),
      ...[-g.cabWidth / 2, g.cabWidth / 2].flatMap(x => [g.cabRear + g.rearRun, g.cabFront - g.screenRun].map(z => [x, roof - comHeight, z - comZ] as const)),
    ],
    frontAxle: g.frontAxle - comZ, rearAxle: g.rearAxle - comZ, halfTrack: (g.track[0] + g.track[1]) / 2, wheelRadius: radius,
    springLength: sag + 0.14 + (truck || buggy ? 0.1 : 0), springRate, damping, antiRoll: springRate * (truck ? 0.5 : 0.35),
    // (Staggered tyres -- wider at the back -- grip a little more there.)
    grip, rearGrip: clamp(1 + (Math.sqrt(car.wheels[1].width / Math.max(0.1, car.wheels[0].width)) - 1) * 0.5, 1, 1.08), peakAngle: tyre === "knobby" ? 0.18 : 0.14, peakRatio: tyre === "knobby" ? 0.16 : 0.12,
    power, peakRpm, idleRpm: 850, redline,
    gears: GEARS, reverse: 3.3, finalDrive, drivetrain: D.pick("drive", engine.drive),
    diffLock: cls === "muscle" ? 0.6 : cls === "rally" ? 0.5 : cls === "kei" ? 0.2 : 0.4,
    brakeBias: 0.62, brakeTorque: (mass * G * h.brakeG * radius) / 4 * 1.3, abs: true, handbrakeTorque: mass * G * radius * 0.5,
    steerLock: h.steer, steerRate: truck ? 1.9 : buggy ? 3 : mass > 1800 ? 2.5 : 3.6,
    drag, downforce: drag * aero + (low ? 0.25 : 0),
  };
  return { spec, com: { y: comHeight, z: comZ } };
}
