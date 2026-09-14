// What cloth builds with: choices that always draw (so a pin never reshuffles
// the rest), a ring round an "around" socket, and the axes of a surface socket
// things stand off. Designs are AttributeShapes (keel/entity's fitting
// convention): capsules and boxes in the socket's frame -- +z the entity's front
// at rest, +y up, +x its right hand -- sized from the socket's size.

import type { AttributeCapsule, Role } from "@keel-engine/entity";
import type { Pins, Socket, Stream } from "@keel-engine/runtime";
import { dcos, dhypot, dsin } from "@keel-engine/core";

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

const norm = (v: readonly number[]): V3 => { const l = dhypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) || 1; return [(v[0] ?? 0) / l, (v[1] ?? 0) / l, (v[2] ?? 0) / l]; };

/**
 * An "around" socket's axis, in its frame. keel/entity's neck socket sits
 * halfway up its bone, so its origin in the bone's frame (`at`) points along
 * the neck -- tilted forward on four legs, straight up on two. (Without `at`,
 * or at the bone's root: straight up.)
 */
export function axisOf(fit: Socket): V3 {
  const at = (fit as { at?: readonly number[] }).at;
  return at && dhypot(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0) > 1e-9 ? norm(at) : [0, 1, 0];
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
    const c = dcos(th) * R;
    const s = dsin(th) * R;
    return [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s];
  };
  const capsules: AttributeCapsule[] = [];
  for (let k = 0; k < n; k += 1) capsules.push({ a: at(k), b: at(k + 1), r: t, role, part });
  return { capsules, front: [e2[0] * R, e2[1] * R, e2[2] * R] };
}

/**
 * A surface socket's axes for things that stand off it (packs): x is always
 * across; `out` is the socket's out; `up` is the remaining axis -- the
 * socket's y on a humanoid's back (out -z), its z on a quadruped's (out +y).
 * `v(across, along, off)` builds a vector in those axes.
 */
export function standOff(fit: Socket): { out: V3; up: V3; across: number; along: number; off: number; v: (x: number, u: number, o: number) => V3 } {
  const out = outOf(fit);
  const outAxis = Math.abs(out[1]) >= Math.abs(out[2]) ? 1 : 2;
  const upAxis = outAxis === 1 ? 2 : 1;
  const up: V3 = upAxis === 1 ? [0, 1, 0] : [0, 0, 1];
  const v = (x: number, u: number, o: number): V3 => [x + out[0] * o, up[1] * u + out[1] * o, up[2] * u + out[2] * o];
  return { out, up, across: fit.size[0], along: fit.size[upAxis] ?? 0, off: fit.size[outAxis] ?? 0, v };
}

/** Half-extents for a box in standOff() axes: across (x), along `up`, along `out`. */
export function halves(fit: Socket, x: number, u: number, o: number): V3 {
  const out = outOf(fit);
  return Math.abs(out[1]) >= Math.abs(out[2]) ? [x, o, u] : [x, u, o];
}

/** A turn about y: where a point [x, y, z] goes when its heading turns by `yaw` (the frame convention: yaw 0 is +z). */
export function turnY([x, y, z]: V3, yaw: number): V3 {
  const c = dcos(yaw), s = dsin(yaw);
  return [x * c + z * s, y, -x * s + z * c];
}

/** The largest of a socket's sizes: what a design built to it may reach (twice the socket, twice the design). */
export const bigOf = (fit: Socket): number => Math.max(fit.size[0], fit.size[1], fit.size[2]);

// Roles, as a look reads them (runtime's RoleSpec): what each part is made of. A look paints them at draw time,
// so none of this is baked -- a knit's bands, a flag's stripes, a helmet's metal are the look's.
export const KNIT = { stuff: "knit" } as const;
export const CLOTH = { stuff: "cloth" } as const;
export const LEATHER = { stuff: "leather" } as const;
export const METAL = { stuff: "metal" } as const;
export const WOOD = { stuff: "wood" } as const;
export const BONE = { stuff: "bone" } as const;
export const PAINT = { stuff: "paint" } as const;
export const DARK = { stuff: "dark" } as const;

// Who cloth is made for: characters from packs/humans, animals from packs/animals.
export const HUMANS = { body: "body/humanoid@^1", packs: ["packs/humans@^1"] } as const;
export const ANIMALS = { body: "body/quadruped@^1", packs: ["packs/animals@^1"] } as const;
