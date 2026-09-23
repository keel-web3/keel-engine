// Tyres: where a car's grip comes from. A tyre pushes back against how much it
// is slipping -- forward (spinning or locked: slip RATIO) and sideways (pointed
// one way, going another: slip ANGLE) -- rising to a peak and then falling
// away, which is the whole feel of driving: grip up to the limit, a slide past
// it. The shape is the "magic formula" curve, sin(C atan(B x)).
//
// The two slips SHARE one budget of grip (a friction circle): a tyre spinning
// or locked has little left for cornering -- which is exactly why pulling the
// handbrake mid-corner lets the rear step out, and why flooring it out of a
// bend kicks the tail round.
//
// The curve is tabled ONCE at load (core's dmath, so it is the same table on
// every machine); a step only interpolates it -- no transcendentals per wheel
// per sub-step.

import { datan, dsin, dtan } from "@keel-engine/core";

/** The curve's shape factor: how sharply it peaks and how far it falls after (1.6 ~ a road tyre). */
const C = 1.6;
/** Slip in units of "the peak" (1 = the top of the curve) the table covers; past it the curve is flat. */
const SPAN = 8;
const N = 512;
const TABLE = new Float64Array(N + 1);
{
  // (B puts the peak at x = 1: C atan(B) = pi / 2.)
  const B = dtan(Math.PI / (2 * C));
  for (let i = 0; i <= N; i += 1) TABLE[i] = dsin(C * datan(B * ((i / N) * SPAN)));
}

/** The curve at a normalised slip (1 = the peak): 0..1, rising to 1 at 1, easing off past it. */
export function curve(s: number): number {
  const a = Math.abs(s);
  if (a >= SPAN) return TABLE[N]!;
  const f = (a / SPAN) * N, i = Math.floor(f), t = f - i;
  return TABLE[i]! + (TABLE[i + 1]! - TABLE[i]!) * t;
}

/** A tyre's forces, from its slips and the load on it. */
export interface TyreForce { readonly fx: number; readonly fy: number; /** How far past its peak it is (0..): skids, smoke, the squeal. */ readonly slide: number }

/**
 * Longitudinal (fx, along the wheel) and lateral (fy, across it) force for a slip ratio and a slip angle, under a normal
 * load, at a friction `mu`: both slips share one budget of grip (the friction circle).
 */
export function tyreForce(ratio: number, angle: number, load: number, mu: number, peakRatio: number, peakAngle: number, latScale = 1, floor = 0): TyreForce {
  if (load <= 0) return { fx: 0, fy: 0, slide: 0 };
  const sx = ratio / peakRatio, sy = angle / peakAngle;
  const s = Math.sqrt(sx * sx + sy * sy);
  if (s < 1e-9) return { fx: 0, fy: 0, slide: 0 };
  // (An arcade tyre: past its peak it holds at least `floor` of its grip, and it corners `latScale` harder than it brakes.)
  const c = curve(s), f = mu * load * (s > 1 && c < floor ? floor : c);
  return { fx: (f * sx) / s, fy: (-f * sy * latScale) / s, slide: Math.max(0, s - 1) };
}
