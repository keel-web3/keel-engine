// The arithmetic behind the touch controls, kept apart from the DOM so it's
// testable: a thumb's offset on a virtual stick, a device's tilt, a slider's
// travel -- each to a value with a dead zone.

import { shapeAnalog } from "../actions.ts";

/** A virtual stick: the thumb's offset from the stick's centre (px) over its radius, through a round dead zone. */
export function stickValue(dx: number, dy: number, radius: number, deadzone = 0.12): { x: number; y: number; knob: { x: number; y: number } } {
  const l = Math.sqrt(dx * dx + dy * dy), r = Math.max(1, radius);
  if (l === 0) return { x: 0, y: 0, knob: { x: 0, y: 0 } };
  // (The value is the thumb's direction times its shaped reach; the knob stops at the rim.)
  const reach = shapeAnalog(Math.min(1, l / r), deadzone), k = Math.min(1, r / l);
  return { x: (dx / l) * reach, y: (dy / l) * reach, knob: { x: dx * k, y: dy * k } };
}

/**
 * Steering by tilt: the device's roll (degrees) about `zero` (where the player holds it level), full at `range`,
 * nothing inside `deadzone`.
 */
export function tiltValue(angle: number, zero = 0, range = 25, deadzone = 2): number {
  let d = angle - zero;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return shapeAnalog(Math.max(-1, Math.min(1, d / range)), deadzone / range);
}

/**
 * Which angle is the roll for a steering-wheel grip: in landscape it's the device's beta (front-back tilt, as the
 * phone lies), in portrait its gamma. `screenAngle` is screen.orientation.angle (0, 90, -90/270, 180).
 */
export function rollOf(beta: number, gamma: number, screenAngle: number): number {
  const a = ((screenAngle % 360) + 360) % 360;
  return a === 90 ? beta : a === 270 ? -beta : a === 180 ? -gamma : gamma;
}

/** A slider's value: how far up its track the thumb is (0 at the bottom, 1 at the top). */
export const sliderValue = (y: number, top: number, height: number): number => Math.max(0, Math.min(1, (top + height - y) / Math.max(1, height)));
