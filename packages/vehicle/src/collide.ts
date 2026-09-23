// Two cars hitting each other: an impulse at the point they touch, at the
// height they touch -- so it turns them as well as shoving them. Mass decides
// who gives: a truck barely notices a coupe, the coupe is thrown. And because
// the blow lands at bumper height, above a light car's centre of mass, a big
// enough side hit tips it up onto two wheels and over.
//
// Each car is an oriented box (its spec's width x length, on its own heading);
// the test is a separating-axis check in the ground plane (cars are low and
// wide: the plane is where they meet), the normal is the axis of least overlap.

import { tuningAt } from "./assist.ts";
import { add, addScaled, clamp, cross, dot, rotate, scale, sign, sub, unrotate } from "./math.ts";
import type { V3 } from "./math.ts";
import { inertiaOf } from "./spec.ts";
import type { Vehicle } from "./vehicle.ts";

/** What a collision did: how hard (closing speed along the normal, m/s), the impulse (N s), and where (world). */
export interface Hit {
  readonly closing: number;
  readonly impulse: number;
  readonly at: V3;
  /** The normal from a to b (ground plane, unit). */
  readonly normal: V3;
  /** Each car's share of the harm -- the lighter car takes more (0..1, sums to 1). */
  readonly hurtA: number;
  readonly hurtB: number;
}

/** How much of the closing speed comes back as a bounce (steel crumples: little). */
const RESTITUTION = 0.18;
/** Friction between the two bodies at the contact: a glancing blow drags. */
const RUB = 0.3;
/** How much of a blow's roll and pitch survives the crumpling (see applyImpulse). */
const CRUSH = 0.5;
/** Bumper height as a share of a body's height. */
const BUMPER = 0.42;

interface Box { c: V3; ax: V3; az: V3; hw: number; hl: number }
function boxOf(car: Vehicle): Box {
  const f = rotate(car.q, [0, 0, 1]), r = rotate(car.q, [1, 0, 0]);
  const flat = (v: V3): V3 => { const l = Math.sqrt(v[0] * v[0] + v[2] * v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
  return { c: [car.p[0], 0, car.p[2]], ax: flat(r), az: flat(f), hw: car.spec.width / 2, hl: car.spec.length / 2 };
}
const reach = (b: Box, n: V3): number => b.hw * Math.abs(dot(b.ax, n)) + b.hl * Math.abs(dot(b.az, n));

/** Separate two cars if they overlap: push them apart and apply the impulse. Returns the hit, or null. */
export function collideCars(a: Vehicle, b: Vehicle): Hit | null {
  const A = boxOf(a), B = boxOf(b);
  const d = sub(B.c, A.c);
  let best = Infinity, n: V3 = [1, 0, 0];
  for (const axis of [A.ax, A.az, B.ax, B.az]) {
    const over = reach(A, axis) + reach(B, axis) - Math.abs(dot(d, axis));
    if (over <= 0) return null;
    if (over < best) { best = over; n = dot(d, axis) < 0 ? scale(axis, -1) : axis; }
  }
  // Where they touch: B's point deepest toward A along -n, pulled halfway to A's face -- at bumper height.
  // (Bumpers meet between their heights: a truck's is up at a coupe's door handles, which is what tips the coupe.)
  const height = (a.spec.height + b.spec.height) * 0.5 * BUMPER;
  const tip = (bx: Box, dir: V3): V3 => {
    const sx = dot(bx.ax, dir) >= 0 ? 1 : -1, sz = dot(bx.az, dir) >= 0 ? 1 : -1;
    // (Clamp to the face's middle when nearly face-on: a corner that isn't a corner.)
    const kx = Math.abs(dot(bx.ax, dir)) < 0.2 ? 0 : sx, kz = Math.abs(dot(bx.az, dir)) < 0.2 ? 0 : sz;
    return add(bx.c, add(scale(bx.ax, kx * bx.hw), scale(bx.az, kz * bx.hl)));
  };
  const pa = tip(A, n), pb = tip(B, scale(n, -1));
  const floor = (a.p[1] - a.spec.comHeight + b.p[1] - b.spec.comHeight) / 2;
  const at: V3 = [(pa[0] + pb[0]) / 2, floor + height, (pa[2] + pb[2]) / 2];
  // Push the pair apart by mass (the heavy one moves less).
  const ma = a.spec.mass, mb = b.spec.mass, share = mb / (ma + mb);
  addScaled(a.p, n, -best * share);
  addScaled(b.p, n, best * (1 - share));
  // The impulse: closing velocity at the contact, through both bodies' mass and turning inertia.
  const ra = sub(at, a.p), rb = sub(at, b.p);
  const va = add(a.v, cross(a.w, ra)), vb = add(b.v, cross(b.w, rb));
  const rel = sub(vb, va);
  const closing = -dot(rel, n);
  if (closing <= 0) return { closing: 0, impulse: 0, at, normal: n, hurtA: share, hurtB: 1 - share };
  const angular = (car: Vehicle, r: V3, dir: V3): number => {
    const I = inertiaOf(car.spec);
    const t = unrotate(car.q, cross(r, dir));
    const iw: V3 = [t[0] / I[0], t[1] / I[1], t[2] / I[2]];
    return dot(cross(rotate(car.q, iw), r), dir);
  };
  const j = ((1 + RESTITUTION) * closing) / (1 / ma + 1 / mb + angular(a, ra, n) + angular(b, rb, n));
  // Plus a rub along the contact, against the sliding (capped by Coulomb).
  const slideV = sub(rel, scale(n, dot(rel, n)));
  const sl = Math.sqrt(dot(slideV, slideV));
  const t: V3 = sl > 1e-6 ? scale(slideV, 1 / sl) : [0, 0, 0];
  const jt = sl > 1e-6 ? Math.min(RUB * j, sl / (1 / ma + 1 / mb)) : 0;
  const J = add(scale(n, j), scale(t, jt));
  applyImpulse(a, ra, scale(J, -1), CRUSH);
  applyImpulse(b, rb, J, CRUSH);
  return { closing, impulse: j, at, normal: n, hurtA: share, hurtB: 1 - share };
}

/**
 * An impulse (N s, world) at an offset from the centre of mass: into velocity and spin. `tip` scales what it does to
 * roll and pitch (1: all of it) -- a crash isn't an instant: crumpling steel spreads the blow and soaks up most of what
 * would tip a car, so a side hit spins it and shoves it, and only a heavy, fast one puts it on its roof.
 */
export function applyImpulse(car: Vehicle, r: V3, J: V3, tip = 1): void {
  const I = inertiaOf(car.spec);
  addScaled(car.v, J, 1 / car.spec.mass);
  const t = unrotate(car.q, cross(r, J));
  addScaled(car.w, rotate(car.q, [(t[0] * tip) / I[0], t[1] / I[1], (t[2] * tip) / I[2]]), 1);
}

/**
 * A car against a wall: `nx, nz` the wall's normal pointing INTO it (away from the road), `depth` how far the car is
 * past it (m). The car is set back out, what it drove into the wall is taken off (with a little bounce), and the slide
 * along it scrubbed like friction -- no more than the hit's own push times the scrub, so a glancing scrape keeps nearly
 * all its speed where a head-on stops. With the assists (arcade > 0) a glance also turns the nose parallel to the wall
 * over a moment, the way an arcade racer lets you ride one. Returns how hard it hit (m/s into the wall), for sound and
 * damage.
 */
export function wallContact(car: Vehicle, nx: number, nz: number, depth: number, dt: number, arcade = 0): number {
  if (depth <= 0) return 0;
  const t = tuningAt(arcade);
  car.p[0] -= nx * depth; car.p[2] -= nz * depth;
  const vn = car.v[0] * nx + car.v[2] * nz;
  if (vn <= 0) return 0;
  // Out of the wall...
  const pushed = vn * (1 + t.wallBounce);
  car.v[0] -= nx * pushed; car.v[2] -= nz * pushed;
  // ...and the scrub along it: Coulomb, capped by the push.
  const tx = -nz, tz = nx, vt = car.v[0] * tx + car.v[2] * tz;
  const scrub = sign(vt) * Math.min(Math.abs(vt), t.wallScrub * pushed);
  car.v[0] -= tx * scrub; car.v[2] -= tz * scrub;
  // The nose laid along the wall (the way the car's going along it).
  if (t.wallAlign > 0) {
    const f = rotate(car.q, [0, 0, 1]), along = f[0] * tx + f[2] * tz < 0 ? -1 : 1;
    const err = f[2] * tx * along - f[0] * tz * along;
    car.w[1] += clamp(err * t.wallAlign, -2, 2) * Math.min(1, dt * 10);
  }
  return vn;
}
