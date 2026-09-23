// Engine access and moving hardware share the exact geometry used by the body and its damage parts.
import { dsin } from "@keel-engine/core";
import { meshMatrix, mulMatrix } from "@keel-engine/bake";
import type { Car } from "./car.ts";
import { mechanicsOf } from "./mechanics.ts";

export function engineAccess(car: Car) {
  const m = mechanicsOf(car), g = car.body, rear = m.location === "rear";
  return { panel: rear ? "trunk" as const : "hood" as const, exposed: m.bay !== "closed", name: rear ? "ENGINE COVER" : "HOOD",
    hinge: [0, g.belt, rear ? g.cabRear : g.cabFront] as const, angle: (rear ? 1 : -1) * 1.25 };
}

/** Rotate about a fitted pivot, preserving mesh coordinates and the car's existing paint space. */
export function enginePivot(at: readonly [number, number, number], pitch = 0, roll = 0): Float32Array {
  return mulMatrix(meshMatrix({ x: at[0], y: at[1], z: at[2], pitch, roll }), meshMatrix({ x: -at[0], y: -at[1], z: -at[2] }));
}

export function enginePanelPose(car: Car, open: number): Float32Array {
  const a = engineAccess(car), p = Math.max(0, Math.min(1, open)), eased = p * p * (3 - 2 * p);
  return enginePivot(a.hinge, a.angle * eased);
}

export function engineMotion(car: Car, phase: number, rpm: number) {
  const m = mechanicsOf(car), e = m.engine, g = car.body, strength = rpm > 0 ? .01 + Math.min(1, rpm / 6500) * .009 : 0;
  const rock = enginePivot([0, e.y, e.z], 0, dsin(phase * m.cylinders / 2) * strength);
  rock[13] = rock[13]! + dsin(phase * 2) * strength * .42;
  const pulley = enginePivot([0, e.y, e.z + e.length / 2 + .035], 0, phase);
  const ry0 = g.ride + .05, ry1 = Math.max(ry0 + .08, g.ride + (g.belt - g.ride) * g.noseLo - .05);
  const fan = enginePivot([0, (ry0 + ry1) / 2, m.radiatorZ - .08], 0, phase * .7);
  return { block: rock, pulley: mulMatrix(rock, pulley), fan };
}
