import { datan2, dsin, dhypot } from "@keel-engine/core";
import { headingOf } from "./vehicle.ts";
import type { Vehicle, VehicleInput } from "./vehicle.ts";
import { lockAt } from "./assist.ts";
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
/** A road/path follower for the normal vehicle solver. The target is ahead on the path; speed is m/s.
 * It never edits position or orientation. A stopped car cannot slide toward its target. */
export function followPath(car: Vehicle, target: { readonly x: number; readonly z: number }, speed: number): VehicleInput {
  const h = headingOf(car), dx = target.x - car.p[0], dz = target.z - car.p[2];
  const distance = Math.max(3, dhypot(dx, dz));
  const alpha = datan2(dx, dz) - h.yaw, curvature = 2 * dsin(alpha) / distance;
  const wheelbase = car.spec.frontAxle - car.spec.rearAxle;
  const angle = datan2(wheelbase * curvature, 1) + .045 * (h.forward * curvature - car.w[1]);
  const lock = lockAt(car.spec, Math.abs(h.forward), .6);
  const steer = speed < .1 ? 0 : clamp(angle, -lock, lock) / car.spec.steerLock;
  // Brake before a bend, using lateral grip, rather than forcing a heading change.
  const bendSpeed = Math.sqrt(Math.max(1, car.spec.grip * 5.5) / Math.max(.001, Math.abs(curvature)));
  const want = Math.max(0, Math.min(speed, bendSpeed)), dv = want - h.forward;
  return { steer, throttle: want > .1 && dv > -.2 ? clamp(.16 + dv * .35, 0, 1) : 0,
    brake: want < .1 ? 1 : clamp(-dv * .3, 0, 1), handbrake: 0, traction: 1, stability: .35, arcade: .6 };
}
