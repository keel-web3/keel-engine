// Cars against the world that doesn't move: buildings' footprints (boxes on the
// ground, any heading), and the small things along a street -- lamp posts,
// signals, bins, hydrants, benches (discs; some break off when hit hard
// enough). A spatial hash keeps each car to the few shapes near it. A hit is a
// proper contact: the car's footprint (a box round its body) against the
// shape, the contact point and the normal from the deepest overlap, the car
// set back out, and an impulse there -- what it drove in taken off with a little
// bounce, the slide along it scrubbed by friction -- so clipping a building's
// corner spins the car, a glancing scrape keeps its speed, a head-on stops it.
// Deterministic: arithmetic, square roots, dmath's cos and sin.

import { dcos, dsin } from "@keel-engine/core";
import { applyImpulse } from "./collide.ts";
import { cross, dot, rotate, unrotate } from "./math.ts";
import type { V3 } from "./math.ts";
import { inertiaOf } from "./spec.ts";
import type { Vehicle } from "./vehicle.ts";

/**
 * What a shape can take, when it has a meter (both optional; without `strength` a shape behaves as it always did):
 * `strength` the energy (J) blows must put into it before it gives -- a breakable one (`breaks`) then breaks free and
 * the car goes on through, paying that energy and shoving the thing's `mass` (kg) out of its way; one that doesn't
 * break only counts its blows (see StaticWorld.wear: a pole bends, a wall cracks) and stands.
 */
export interface StaticMeter {
  readonly strength?: number; readonly mass?: number;
  /** Optional world heights. Without these the legacy footprint remains infinitely tall. */
  readonly yMin?: number; readonly yMax?: number;
}
/** A box standing on the ground (a building's mass): centre, half width (along its heading's right), half depth, heading. */
export interface StaticBox extends StaticMeter { readonly kind: "box"; readonly x: number; readonly z: number; readonly hw: number; readonly hd: number; readonly yaw: number; readonly breaks?: boolean }
/** A post or a small thing (a lamp, a bin): centre and radius; `breaks` if a hard enough hit knocks it over. */
export interface StaticDisc extends StaticMeter { readonly kind: "disc"; readonly x: number; readonly z: number; readonly r: number; readonly breaks?: boolean }
export type StaticShape = StaticBox | StaticDisc;

/**
 * One contact this step: which shape, where, how hard (m/s into it), and whether it broke (it's gone now). Also the
 * energy the blow cost the car (J, along the contact's normal: what crumples it -- a sign clipped costs a little, a
 * pole met head-on a lot) and the normal (unit, from the car into the shape).
 */
export interface StaticHit { readonly shape: number; readonly x: number; readonly z: number; readonly speed: number; readonly broke: boolean; readonly energy?: number; readonly nx?: number; readonly nz?: number }

export interface StaticWorld {
  readonly shapes: readonly StaticShape[];
  /** Shapes knocked over (broken props): no longer collide. */
  readonly broken: ReadonlySet<number>;
  /** The energy (J) blows have put into each shape with a meter (`strength`) so far: its meter is 1 - wear / strength. */
  readonly wear?: Map<number, number>;
  /** The shapes whose bounds come within `r` of a point. */
  near(x: number, z: number, r: number): number[];
}

const radiusOf = (s: StaticShape): number => (s.kind === "disc" ? s.r : Math.sqrt(s.hw * s.hw + s.hd * s.hd));

/** A world of static shapes, hashed on a grid of `cell` metres. */
export function createStaticWorld(shapes: readonly StaticShape[], cell = 16): StaticWorld {
  const grid = new Map<number, number[]>(), key = (i: number, j: number): number => i * 73856093 ^ j * 19349663;
  shapes.forEach((s, n) => {
    const r = radiusOf(s);
    for (let j = Math.floor((s.z - r) / cell); j <= Math.floor((s.z + r) / cell); j += 1) {
      for (let i = Math.floor((s.x - r) / cell); i <= Math.floor((s.x + r) / cell); i += 1) {
        const k = key(i, j), list = grid.get(k);
        if (list) list.push(n); else grid.set(k, [n]);
      }
    }
  });
  const broken = new Set<number>(), wear = new Map<number, number>();
  return {
    shapes, broken, wear,
    near(x, z, r) {
      const out = new Set<number>();
      for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j += 1) {
        for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i += 1) for (const n of grid.get(key(i, j)) ?? []) if (!broken.has(n)) out.add(n);
      }
      return [...out].sort((a, b) => a - b);
    },
  };
}

interface Overlap { readonly nx: number; readonly nz: number; readonly depth: number; readonly px: number; readonly pz: number }

// The car's footprint: the body's box on the ground, centred between its axles (the centre of mass sits forward of it).
function footprintOf(car: Vehicle): { cx: number; cz: number; fx: number; fz: number; hl: number; hw: number } {
  const f = rotate(car.q, [0, 0, 1]), l = Math.sqrt(f[0] * f[0] + f[2] * f[2]) || 1, fx = f[0] / l, fz = f[2] / l;
  const mid = (car.spec.frontAxle + car.spec.rearAxle) / 2;
  return { cx: car.p[0] + fx * mid, cz: car.p[2] + fz * mid, fx, fz, hl: car.spec.length / 2, hw: car.spec.width / 2 };
}

/** Two boxes on the ground (centres, unit forward axes, half lengths along/across): the least overlap, or null. */
function boxBox(a: { cx: number; cz: number; fx: number; fz: number; hl: number; hw: number }, b: { cx: number; cz: number; fx: number; fz: number; hl: number; hw: number }): Overlap | null {
  const axes: [number, number][] = [[a.fx, a.fz], [-a.fz, a.fx], [b.fx, b.fz], [-b.fz, b.fx]];
  const cornersOf = (s: typeof a): [number, number][] => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, v]) => [s.cx + s.fx * s.hl * u! - s.fz * s.hw * v!, s.cz + s.fz * s.hl * u! + s.fx * s.hw * v!]);
  const ca = cornersOf(a), cb = cornersOf(b);
  let best: { nx: number; nz: number; depth: number } | null = null;
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    const d = Math.min(a1 - b0, b1 - a0);
    if (d <= 0) return null;
    if (!best || d < best.depth) {
      // (The normal points from the car INTO the shape.)
      const s = (b.cx - a.cx) * ax + (b.cz - a.cz) * az >= 0 ? 1 : -1;
      best = { nx: ax * s, nz: az * s, depth: d };
    }
  }
  // The contact point: the car's corners inside the shape (or the shape's inside the car), averaged.
  const inside = (s: typeof a, x: number, z: number): boolean => Math.abs((x - s.cx) * s.fx + (z - s.cz) * s.fz) <= s.hl + 1e-9 && Math.abs(-(x - s.cx) * s.fz + (z - s.cz) * s.fx) <= s.hw + 1e-9;
  let pts = ca.filter(([x, z]) => inside(b, x, z));
  if (!pts.length) pts = cb.filter(([x, z]) => inside(a, x, z));
  if (!pts.length) pts = [[(a.cx + b.cx) / 2, (a.cz + b.cz) / 2]];
  const px = pts.reduce((s, p) => s + p[0], 0) / pts.length, pz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { ...best!, px, pz };
}

/** The car's box against a disc: the least overlap, or null. */
function boxDisc(a: { cx: number; cz: number; fx: number; fz: number; hl: number; hw: number }, d: StaticDisc): Overlap | null {
  const lx = (d.x - a.cx) * a.fx + (d.z - a.cz) * a.fz, lz = -(d.x - a.cx) * a.fz + (d.z - a.cz) * a.fx;
  const qx = Math.max(-a.hl, Math.min(a.hl, lx)), qz = Math.max(-a.hw, Math.min(a.hw, lz));
  const ex = lx - qx, ez = lz - qz, e2 = ex * ex + ez * ez;
  if (e2 > d.r * d.r) return null;
  let nlx: number, nlz: number, depth: number;
  if (e2 > 1e-12) { const e = Math.sqrt(e2); nlx = ex / e; nlz = ez / e; depth = d.r - e; }
  else {
    // (The post's centre is inside the car's box: out the nearest side.)
    const sx = a.hl - Math.abs(lx), sz = a.hw - Math.abs(lz);
    if (sx < sz) { nlx = Math.sign(lx) || 1; nlz = 0; depth = sx + d.r; } else { nlx = 0; nlz = Math.sign(lz) || 1; depth = sz + d.r; }
  }
  return { nx: nlx * a.fx - nlz * a.fz, nz: nlx * a.fz + nlz * a.fx, depth, px: a.cx + qx * a.fx - qz * a.fz, pz: a.cz + qx * a.fz + qz * a.fx };
}

/** How hard a breakable prop must be hit to go over (m/s into it). */
export const BREAK_SPEED = 4;
/** The slowest blow (m/s into it) a meter counts: leaning on a thing wears nothing. */
const METER_SPEED = 0.5;
/** How much of a hit on a wall or post reaches the car's roll and pitch (the rest crumples away): see collide.ts CRUSH. */
const CRUSH_STATIC = 0.6;

/**
 * Collide a car with the static world this step: every shape it overlaps is resolved (set out, impulse at the contact
 * with `bounce` and `friction`), breakable props hit hard enough are knocked over (and stop colliding). The hits, for
 * sparks, sound, damage and debris.
 */
export function collideStatic(car: Vehicle, world: StaticWorld, o: { bounce?: number; friction?: number } = {}): StaticHit[] {
  const bounce = o.bounce ?? 0.2, friction = o.friction ?? 0.35, hits: StaticHit[] = [];
  const fp = footprintOf(car), I = inertiaOf(car.spec);
  const right = rotate(car.q, [1, 0, 0]), up = rotate(car.q, [0, 1, 0]), forward = rotate(car.q, [0, 0, 1]);
  // Match the body's ground-contact box: its underside clears the tyre contact plane by 12 cm.
  // A car resting on a terrace must not be pushed sideways by that terrace's vertical faces.
  const cy = car.p[1] + up[1] * ((car.spec.height + .12) / 2 - car.spec.comHeight);
  const ry = Math.abs(right[1]) * fp.hw + Math.abs(up[1]) * (car.spec.height - .12) / 2 + Math.abs(forward[1]) * fp.hl;
  for (const n of world.near(fp.cx, fp.cz, Math.sqrt(fp.hl * fp.hl + fp.hw * fp.hw))) {
    if (world.broken.has(n)) continue;
    const s = world.shapes[n]!;
    if ((s.yMin !== undefined && cy + ry <= s.yMin) || (s.yMax !== undefined && cy - ry >= s.yMax)) continue;
    const ov = s.kind === "box" ? boxBox(fp, { cx: s.x, cz: s.z, fx: dsin(s.yaw), fz: dcos(s.yaw), hl: s.hd, hw: s.hw }) : boxDisc(fp, s);
    if (!ov) continue;
    // On a finite-height object's top, the shallow contact is vertical. Let the suspension/body ground
    // contacts resolve it; the footprint solver must not eject a landing car off the side of the platform.
    if (s.yMax !== undefined && cy > s.yMax && s.yMax - (cy - ry) < ov.depth) continue;
    // How fast the contact point is going into the shape.
    const r: V3 = [ov.px - car.p[0], 0, ov.pz - car.p[2]], n3: V3 = [ov.nx, 0, ov.nz];
    const vp = cross(car.w, r), vIn = (car.v[0] + vp[0]) * ov.nx + (car.v[2] + vp[2]) * ov.nz;
    const M = car.spec.mass;
    // A thing with a meter: the blow's energy (the car's motion into it) goes on its wear; a breakable one whose meter
    // runs out breaks free -- the car pays what was left of it and shoves its mass along, and goes on through.
    if (s.strength !== undefined && vIn > METER_SPEED) {
      const wear = world.wear, was = wear?.get(n) ?? 0, blow = 0.5 * M * vIn * vIn;
      if (s.breaks && blow >= s.strength - was) {
        (world.broken as Set<number>).add(n);
        wear?.set(n, s.strength);
        const left = Math.max(0, s.strength - was), m = Math.max(0, s.mass ?? 0);
        const v1 = Math.sqrt(Math.max(0, vIn * vIn - (2 * left) / M)), v2 = (v1 * M) / (M + m);
        const rn = cross(r, n3), rnL = unrotate(car.q, rn), kN = 1 / M + dot(rnL, [rnL[0] / I[0], rnL[1] / I[1], rnL[2] / I[2]]);
        const jn = (vIn - v2) / kN;
        applyImpulse(car, r, [-ov.nx * jn, 0, -ov.nz * jn], 0.2);
        hits.push({ shape: n, x: ov.px, z: ov.pz, speed: vIn, broke: true, energy: 0.5 * M * (vIn * vIn - v2 * v2), nx: ov.nx, nz: ov.nz });
        continue;
      }
      wear?.set(n, Math.min(s.strength, was + blow));
    }
    // A breakable thing hit hard goes over: a nudge to the car, and it's gone.
    else if (s.kind === "disc" && s.breaks && s.strength === undefined && vIn > BREAK_SPEED) {
      (world.broken as Set<number>).add(n);
      applyImpulse(car, r, [-ov.nx * car.spec.mass * 0.6, 0, -ov.nz * car.spec.mass * 0.6], 0.2);
      const v2 = Math.max(0, vIn - 0.6);
      hits.push({ shape: n, x: ov.px, z: ov.pz, speed: vIn, broke: true, energy: 0.5 * M * (vIn * vIn - v2 * v2), nx: ov.nx, nz: ov.nz });
      continue;
    }
    // Set back out.
    car.p[0] -= ov.nx * ov.depth; car.p[2] -= ov.nz * ov.depth;
    fp.cx -= ov.nx * ov.depth; fp.cz -= ov.nz * ov.depth;
    if (vIn <= 0) continue;
    // The impulse along the normal (the car's mass and its turn about the contact), then friction along the slide.
    const rn = cross(r, n3), rnL = unrotate(car.q, rn), kN = 1 / car.spec.mass + dot(rnL, [rnL[0] / I[0], rnL[1] / I[1], rnL[2] / I[2]]);
    const jn = ((1 + bounce) * vIn) / kN;
    applyImpulse(car, r, [-ov.nx * jn, 0, -ov.nz * jn], CRUSH_STATIC);
    const vp2 = cross(car.w, r), tx = car.v[0] + vp2[0], tz = car.v[2] + vp2[2], vn2 = tx * ov.nx + tz * ov.nz;
    const sx = tx - ov.nx * vn2, sz = tz - ov.nz * vn2, sl = Math.sqrt(sx * sx + sz * sz);
    if (sl > 1e-6) {
      const jt = Math.min(friction * jn, sl * car.spec.mass * 0.5);
      applyImpulse(car, r, [(-sx / sl) * jt, 0, (-sz / sl) * jt], CRUSH_STATIC);
    }
    hits.push({ shape: n, x: ov.px, z: ov.pz, speed: vIn, broke: false, energy: (0.5 * vIn * vIn * (1 - bounce * bounce)) / kN, nx: ov.nx, nz: ov.nz });
  }
  return hits;
}
