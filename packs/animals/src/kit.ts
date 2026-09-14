// What this pack's attributes build with: choices that always draw (so a pin
// never reshuffles the rest), and a ring round an "around" socket's axis.
// Designs are AttributeShapes (keel/entity's fitting convention): capsules and
// boxes in the socket's frame -- +z the entity's front at rest, +y up, +x its
// right hand -- sized from the socket's size.

import type { AttributeCapsule, Role } from "@keel-engine/entity";
import type { Pins, Socket, Stream } from "@keel-engine/runtime";

export type V3 = [number, number, number];

/** A list choice: drawn every time, the pin (checked) wins. */
export function choose<T extends string | number | boolean>(S: Stream, pins: Pins, name: string, options: readonly T[]): T {
  const drawn = S.pick(options);
  const pin = pins[name];
  if (pin === undefined) return drawn;
  if (!options.includes(pin as T)) throw new RangeError(`${name} = ${JSON.stringify(pin)} is not one of ${JSON.stringify(options)}.`);
  return pin as T;
}

/** A numeric choice in [lo, hi]: drawn every time, the pin (checked) wins. */
export function amount(S: Stream, pins: Pins, name: string, [lo, hi]: readonly [number, number]): number {
  const drawn = S.between(lo, hi);
  const pin = pins[name];
  if (pin === undefined) return drawn;
  if (typeof pin !== "number" || !(pin >= lo && pin <= hi)) throw new RangeError(`${name} = ${JSON.stringify(pin)} is outside ${lo}..${hi}.`);
  return pin;
}

const norm = (v: readonly number[]): V3 => { const l = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) || 1; return [(v[0] ?? 0) / l, (v[1] ?? 0) / l, (v[2] ?? 0) / l]; };

/**
 * An "around" socket's axis, in its frame. keel/entity's neck socket sits
 * halfway up its bone, so its origin in the bone's frame (`at`) points along
 * the neck -- tilted forward on four legs, straight up on two. (Without `at`,
 * or at the bone's root: straight up.)
 */
export function axisOf(fit: Socket): V3 {
  const at = (fit as { at?: readonly number[] }).at;
  return at && Math.hypot(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0) > 1e-9 ? norm(at) : [0, 1, 0];
}

/** Which way things grow off a surface socket (keel/entity's `out`); up without one. */
export function outOf(fit: Socket): V3 {
  const out = (fit as { out?: readonly number[] }).out;
  return out ? norm(out) : [0, 1, 0];
}

/**
 * A ring of n capsules of radius t round `axis`, radius R, through the origin.
 * Returns the ring and the point at its front-and-below (where a tag hangs).
 */
export function ring(axis: V3, R: number, t: number, n: number, role: Role, part: string): { capsules: AttributeCapsule[]; front: V3 } {
  // (x is square to any neck: its axis lies in the y-z plane. The second vector points ahead, or down the throat.)
  const e1: V3 = [1, 0, 0];
  const e2: V3 = norm([0, -axis[2], axis[1]]);
  const at = (k: number): V3 => {
    const th = (k / n) * Math.PI * 2;
    const c = Math.cos(th) * R;
    const s = Math.sin(th) * R;
    return [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s];
  };
  const capsules: AttributeCapsule[] = [];
  for (let k = 0; k < n; k += 1) capsules.push({ a: at(k), b: at(k + 1), r: t, role, part });
  return { capsules, front: [e2[0] * R, e2[1] * R, e2[2] * R] };
}
