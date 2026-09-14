// A ray against a design's solids, exactly: the boxes, wedges and capsules a
// BakeWorld holds (keel/render's raymarcher draws the same solids as distance
// fields; here each is intersected analytically). What the occlusion checks
// judge a depth sprite by -- the point a pixel of a thing really shows -- and
// what picking in 3D can use.
//
//   const t = raycastWorld(world, origin, dir);   // the first hit's distance along dir (Infinity: none)
//   const w = placeWorld(world, at, yaw, scale);  // a posed design moved into the world

import { dcos, dsin } from "@keel-engine/core";
import type { BakeBox, BakeWorld } from "./bake.ts";

type V3 = readonly [number, number, number];

// (World -> a box's frame: the renderer's turn -- x' = c x - s z, z' = s x + c z.)
function toBox(b: BakeBox, o: V3, d: V3): { o: [number, number, number]; d: [number, number, number] } {
  const yaw = b.yaw ?? 0, c = dcos(yaw), s = dsin(yaw);
  const x = o[0] - (b.c[0] ?? 0), y = o[1] - (b.c[1] ?? 0), z = o[2] - (b.c[2] ?? 0);
  return { o: [c * x - s * z, y, s * x + c * z], d: [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]] };
}

/** A ray against a box (turned about y): the entry distance, or Infinity. */
export function rayBox(b: BakeBox, o: V3, d: V3): number {
  const r = toBox(b, o, d);
  let t0 = -Infinity, t1 = Infinity;
  for (let i = 0; i < 3; i += 1) {
    const h = b.h[i] ?? 0, oi = r.o[i]!, di = r.d[i]!;
    if (Math.abs(di) < 1e-12) { if (oi < -h || oi > h) return Infinity; continue; }
    let a = (-h - oi) / di, c = (h - oi) / di;
    if (a > c) { const t = a; a = c; c = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t1 < 0 ? Infinity : Math.max(0, t0);
}

/** A ray against a wedge (keel/render's: its section in (z, y) the foot at +z, `lo` x its height, rising to full height at -z). */
export function rayWedge(b: BakeBox, o: V3, d: V3): number {
  const r = toBox(b, o, d);
  const hx = b.h[0] ?? 0, hy = b.h[1] ?? 0, hz = b.h[2] ?? 0, lo = Math.max(0, Math.min(0.98, b.lo ?? 0));
  let t0 = -Infinity, t1 = Infinity;
  // (x: a slab.)
  if (Math.abs(r.d[0]) < 1e-12) { if (Math.abs(r.o[0]) > hx) return Infinity; }
  else { let a = (-hx - r.o[0]) / r.d[0], c = (hx - r.o[0]) / r.d[0]; if (a > c) { const t = a; a = c; c = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
  // (The section: four edges, inside where the cross product is <= 0 -- the renderer's sdSection.)
  const v: Array<[number, number]> = [[-hz, -hy], [hz, -hy], [hz, -hy + 2 * hy * lo], [-hz, hy]];
  for (let i = 0; i < 4; i += 1) {
    const a = v[i]!, bb = v[(i + 1) & 3]!, ez = bb[0] - a[0], ey = bb[1] - a[1];
    if (ez * ez + ey * ey < 1e-12) continue;
    // s(t) = (wz + dz t) ey - (wy + dy t) ez <= 0
    const s0 = (r.o[2] - a[0]) * ey - (r.o[1] - a[1]) * ez, ds = r.d[2] * ey - r.d[1] * ez;
    if (Math.abs(ds) < 1e-12) { if (s0 > 0) return Infinity; continue; }
    const t = -s0 / ds;
    if (ds > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
  }
  if (t0 > t1 || t1 < 0) return Infinity;
  return Math.max(0, t0);
}

/** A ray against a capsule (a == b: a ball): the entry distance, or Infinity. */
export function rayCapsule(A: ArrayLike<number>, B: ArrayLike<number>, rad: number, o: V3, d: V3): number {
  const ba: V3 = [(B[0] ?? 0) - (A[0] ?? 0), (B[1] ?? 0) - (A[1] ?? 0), (B[2] ?? 0) - (A[2] ?? 0)];
  const oa: V3 = [o[0] - (A[0] ?? 0), o[1] - (A[1] ?? 0), o[2] - (A[2] ?? 0)];
  const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const sphere = (oc: V3): number => {
    const b = dot(oc, d), c = dot(oc, oc) - rad * rad, h = b * b - c;
    if (h < 0) return Infinity;
    const t = -b - Math.sqrt(h);
    return t < 0 ? (-b + Math.sqrt(h) < 0 ? Infinity : 0) : t;
  };
  const baba = dot(ba, ba);
  const ob: V3 = [o[0] - (B[0] ?? 0), o[1] - (B[1] ?? 0), o[2] - (B[2] ?? 0)];
  // (A convex union's first entry is its parts' first: the cylinder's side where it's between the ends, the two end
  // balls. iq's capsule intersection, taken apart.)
  let best = Math.min(sphere(oa), sphere(ob));
  if (baba < 1e-12) return best;
  const bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
  const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - rad * rad * baba;
  const h = b * b - a * c;
  if (h >= 0 && a > 1e-12) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0 && t < best) best = t;
  }
  return best;
}

/** The first hit of a ray (origin, unit direction) on a world's solids: its distance, or Infinity. */
export function raycastWorld(world: BakeWorld, o: V3, d: V3): number {
  let best = Infinity;
  for (const b of world.boxes ?? []) { const t = b.kind === "wedge" ? rayWedge(b, o, d) : rayBox(b, o, d); if (t < best) best = t; }
  for (const b of world.wedges ?? []) { const t = rayWedge(b, o, d); if (t < best) best = t; }
  for (const c of world.capsules ?? []) { const t = rayCapsule(c.a, c.b, c.r, o, d); if (t < best) best = t; }
  return best;
}

/** A design's world moved into the world: turned by `yaw` (the frame convention: +z toward (sin, cos)), scaled, set at `at`. */
export function placeWorld(world: BakeWorld, at: V3, yaw = 0, scale = 1): BakeWorld {
  const c = dcos(yaw), s = dsin(yaw);
  const P = (p: ArrayLike<number>): [number, number, number] => {
    const x = (p[0] ?? 0) * scale, y = (p[1] ?? 0) * scale, z = (p[2] ?? 0) * scale;
    return [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c];
  };
  // (A box's turn is the frame convention's too -- the renderer's x' = c x - s z is its inverse -- so turns add.)
  const box = (b: BakeBox): BakeBox => ({ ...b, c: P(b.c), h: [(b.h[0] ?? 0) * scale, (b.h[1] ?? 0) * scale, (b.h[2] ?? 0) * scale], yaw: (b.yaw ?? 0) + yaw });
  return {
    capsules: (world.capsules ?? []).map((cp) => ({ ...cp, a: P(cp.a), b: P(cp.b), r: cp.r * scale })),
    boxes: (world.boxes ?? []).map(box),
    wedges: (world.wedges ?? []).map(box),
  };
}
