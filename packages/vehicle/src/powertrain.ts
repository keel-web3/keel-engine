// The engine and the gearbox: how a throttle becomes torque at the driven
// wheels. The engine's torque curve rises from idle, holds, and falls toward the
// redline so its POWER peaks where the spec says; the gearbox multiplies it
// (a lot in first, little in top); an automatic changes up near the redline and
// down when the revs sag, with a moment of no drive while it shifts.
//
// Reverse is the way arcade racers do it: at a standstill, holding the brake
// selects reverse and the brake pedal becomes the throttle; touch the throttle
// and it goes back to first.

import type { VehicleSpec } from "./spec.ts";

export interface Powertrain {
  /** 1..gears.length forward, -1 reverse, 0 neutral. */
  gear: number;
  rpm: number;
  /** Reverse selected by holding the brake; explicit manual R still uses the accelerator. */
  brakeReverse?: boolean;
  /** Seconds left in a shift (no drive while it's > 0). */
  shifting: number;
}

export const powertrain = (): Powertrain => ({ gear: 1, rpm: 900, shifting: 0 });

const TAU = Math.PI * 2;

/** The engine's torque (N m) at an rpm, full throttle: a curve whose POWER peaks at the spec's peak rpm. */
export function engineTorque(s: VehicleSpec, rpm: number): number {
  const r = Math.max(s.idleRpm, Math.min(s.redline, rpm));
  // (Peak torque sits a little under peak power; a flat-ish plateau between, falling to 70% at the redline.)
  const peakT = s.peakRpm * 0.7;
  const shape = r < peakT ? 0.62 + 0.38 * ((r - s.idleRpm) / Math.max(1, peakT - s.idleRpm))
    : 1 - 0.3 * ((r - peakT) / Math.max(1, s.redline - peakT));
  // (Scaled so torque x angular speed = the spec's power at its peak rpm.)
  const shapeAtPeak = 1 - 0.3 * ((s.peakRpm - peakT) / Math.max(1, s.redline - peakT));
  const tMax = s.power / ((s.peakRpm * TAU) / 60) / shapeAtPeak;
  return tMax * shape;
}

/** The overall ratio from engine to wheel in the current gear (0 in neutral). */
export function ratioOf(s: VehicleSpec, gear: number): number {
  if (gear > 0) return (s.gears[gear - 1] ?? 1) * s.finalDrive;
  if (gear < 0) return -s.reverse * s.finalDrive;
  return 0;
}

/**
 * Step the gearbox: the engine's revs from the driven wheels' speed, and an automatic's shifts. `wheelSpeed` is the
 * driven wheels' mean angular speed (rad/s), `forward` the car's speed along its heading (m/s).
 */
export function stepGearbox(p: Powertrain, s: VehicleSpec, wheelSpeed: number, forward: number, throttle: number, brake: number, dt: number, manual = false, shift: -1 | 0 | 1 = 0): void {
  if (p.shifting > 0) p.shifting = Math.max(0, p.shifting - dt);
  if (!manual && p.gear === 0) p.gear = 1;
  if (manual && shift && p.shifting <= 0) {
    const next = Math.max(-1, Math.min(s.gears.length, p.gear + shift));
    const roadRpm = Math.abs(forward / s.wheelRadius * ratioOf(s, next)) * 60 / TAU;
    // Reverse/neutral are selected only near a stop; a downshift cannot over-rev the engine.
    if (next !== p.gear && (next > 0 && p.gear >= 0 || Math.abs(forward) < 1.5) && (next >= p.gear || roadRpm < s.redline * .98)) {
      p.gear = next; p.shifting = .16; p.brakeReverse = false;
    }
  }
  // Brake-to-reverse works in either shifting mode. An explicit manual shift into R instead uses gas.
  // Keep neutral deliberate, and never change direction while the car is still moving at speed.
  if (p.gear > 0 && Math.abs(forward) < 0.6 && brake > 0.3 && throttle < 0.05 && !shift) {
    p.gear = -1; p.shifting = 0.2; p.brakeReverse = true;
  } else if (p.gear < 0 && (!manual || p.brakeReverse) && throttle > 0.05 && forward > -0.6) {
    p.gear = 1; p.shifting = 0.2; p.brakeReverse = false;
  }
  const ratio = ratioOf(s, p.gear);
  const wheelRpm = Math.abs(wheelSpeed * ratio) * (60 / TAU);
  // (A slipping clutch: pulling away, the engine holds revs above the wheels' -- which is also what lights them up.)
  // (Both pedals down on the line is a burnout: the engine is held up near its peak.)
  const held = p.gear === 1 && throttle > 0.5 && brake > 0.5 ? 0.85 : 0.55;
  const launch = s.idleRpm + (s.peakRpm * held - s.idleRpm) * Math.min(1, Math.max(throttle, brake * (p.gear < 0 ? 1 : 0)));
  p.rpm = Math.max(s.idleRpm, Math.min(s.redline * 1.02, Math.max(wheelRpm, p.gear <= 1 ? launch : 0)));
  if (manual || p.gear <= 0 || p.shifting > 0) return;
  // An automatic: up near the redline, down only when the lower gear has room under its redline (so it doesn't hunt).
  // (Shifts go by the road speed, not the wheels': a wheel spinning up in first is not a reason to change up.)
  const roadRpm = (Math.abs(forward / s.wheelRadius) * ratio * 60) / TAU;
  if (roadRpm > s.redline * 0.93 && p.gear < s.gears.length) { p.gear += 1; p.shifting = 0.16; }
  else if (p.gear > 1 && roadRpm < s.peakRpm * 0.5 && roadRpm * ((s.gears[p.gear - 2] ?? 1) / (s.gears[p.gear - 1] ?? 1)) < s.redline * 0.75) { p.gear -= 1; p.shifting = 0.12; }
}

/** Drive torque at the axle (N m, before the split to the driven wheels), for a throttle 0..1. */
export function driveTorque(p: Powertrain, s: VehicleSpec, throttle: number): number {
  // (The rev limiter: nothing past the redline.)
  if (p.shifting > 0 || p.gear === 0 || p.rpm >= s.redline) return 0;
  return engineTorque(s, p.rpm) * ratioOf(s, p.gear) * 0.88 * throttle;
}
