// The solids a body collides with, and its rails -- ported from the proof of
// concept's src/physics/character.js (boxDistance, wedgeSection, slopeOf,
// wedgeDistance, solidDistance, nearestOnRail); test/poc-equality.test.ts
// proves every one identical, bit for bit.
//
//   box     { c: [x, y, z], h: [hx, hy, hz], yaw = 0, mat }   half extents, turned about y
//   wedge   { kind: "wedge", c, h, yaw, lo = 0, mat }         a ramp: a box whose top slopes
//   rail    [[x, y, z], ...]                                  a polyline to grind
//
// The frame is core's: world -> a solid's own frame is x' = c x - s z,
// z' = s x + c z (c = cos yaw, s = sin yaw), so its local +z face looks along
// frontOf(yaw).

import type { Vec3, Vec3Like } from "@keel-engine/core";

/** A box turned by yaw about y: centre, half extents, and (for the renderer) a material. */
export interface Box {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number | undefined;
  readonly mat?: number | string | undefined;
  /** Anything but "wedge": a box. (A list may carry both; see Solid.) */
  readonly kind?: string | undefined;
}

/**
 * A wedge -- a ramp: a box { c, h, yaw } whose top slopes, rising from its
 * foot at local +z (`lo` x its height there, default 0: a knife edge) to its
 * full height at local -z. Its slope looks along frontOf(yaw).
 */
export interface Wedge {
  readonly kind: "wedge";
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number | undefined;
  /** The foot's height as a share of the full height (clamped to 0..0.98). */
  readonly lo?: number | undefined;
  readonly mat?: number | string | undefined;
}

/** Either solid: a wedge says so by its kind. */
export type Solid = Box | Wedge;

/** A distance and the outward normal there. */
export interface Hit {
  d: number;
  n: Vec3;
}

/** A rail: a polyline [[x, y, z], ...] (two points or more). */
export type Rail = readonly Vec3Like[];

/** The nearest point on a rail: the segment i, how far along it t, the point q, its unit tangent, the segment's length. */
export interface RailPoint {
  d: number;
  i: number;
  t: number;
  q: Vec3;
  tan: Vec3;
  segLen: number;
}

const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3Like): number => Math.hypot(a[0], a[1], a[2]);

/** Is this solid a wedge? */
export const isWedge = (s: Solid): s is Wedge => s.kind === "wedge";

/** Distance from p to a box turned by yaw about y, and the outward normal there. */
export function boxDistance(p: Vec3Like, b: Box | Wedge): Hit {
  const c = Math.cos(b.yaw ?? 0);
  const s = Math.sin(b.yaw ?? 0);
  const x = p[0] - b.c[0];
  const y = p[1] - b.c[1];
  const z = p[2] - b.c[2];
  const l: Vec3 = [c * x - s * z, y, s * x + c * z]; // (world -> the box's frame: core frame worldToLocal)
  const q: Vec3 = [Math.abs(l[0]) - b.h[0], Math.abs(l[1]) - b.h[1], Math.abs(l[2]) - b.h[2]];
  const o: Vec3 = [Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)];
  const out = len(o);
  let n: Vec3;
  let d: number;
  if (out > 0) { d = out; n = [Math.sign(l[0]) * o[0] / out, Math.sign(l[1]) * o[1] / out, Math.sign(l[2]) * o[2] / out]; }
  else {
    const k = q[0] > q[1] ? (q[0] > q[2] ? 0 : 2) : q[1] > q[2] ? 1 : 2;
    d = q[k];
    n = [0, 0, 0];
    n[k] = Math.sign(l[k]) || 1;
  }
  return { d, n: [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]] };
}

// The exact distance to a convex polygon in 2D, and its outward gradient (edges of zero length are skipped).
function polyDistance(u: number, v: number, P: ReadonlyArray<readonly [number, number]>): { d: number; gu: number; gv: number } {
  let best = Infinity;
  let gu = 0;
  let gv = 0;
  let inside = true;
  let far = -Infinity;
  let fu = 0;
  let fv = 0;
  for (let i = 0; i < P.length; i += 1) {
    const [au, av] = P[i]!;
    const [bu, bv] = P[(i + 1) % P.length]!;
    const eu = bu - au;
    const ev = bv - av;
    const L2 = eu * eu + ev * ev;
    if (L2 < 1e-18) continue;
    const t = Math.max(0, Math.min(1, ((u - au) * eu + (v - av) * ev) / L2));
    const du = u - (au + eu * t);
    const dv = v - (av + ev * t);
    const d = Math.hypot(du, dv);
    if (d < best) { best = d; gu = du; gv = dv; }
    // (Counter-clockwise: the outward normal of an edge is (ev, -eu).)
    const L = Math.sqrt(L2);
    const s = ((u - au) * ev - (v - av) * eu) / L;
    if (s > 0) inside = false;
    if (s > far) { far = s; fu = ev / L; fv = -eu / L; }
  }
  if (inside) return { d: far, gu: fu, gv: fv };
  return { d: best, gu: gu / (best || 1), gv: gv / (best || 1) };
}

/** A wedge's cross-section (local z, y), counter-clockwise: the foot at +z, rising to its full height at -z. */
export function wedgeSection({ h, lo = 0 }: { readonly h: Vec3Like; readonly lo?: number | undefined }): [number, number][] {
  const f = Math.max(0, Math.min(0.98, lo));
  return [[-h[2], -h[1]], [h[2], -h[1]], [h[2], -h[1] + 2 * h[1] * f], [-h[2], h[1]]];
}
/** A wedge's slope in radians (0 flat, PI/2 a wall). */
export const slopeOf = ({ h, lo = 0 }: { readonly h: Vec3Like; readonly lo?: number | undefined }): number =>
  Math.atan2(2 * h[1] * (1 - Math.max(0, Math.min(0.98, lo))), 2 * h[2]);

/**
 * Distance from p to a wedge -- a ramp: a box { c, h, yaw } whose top slopes,
 * rising from its foot at local +z (`lo` x its height there, default 0) to its
 * full height at local -z; so its slope looks along frontOf(yaw), the way the
 * catalogue's ramps face -- and the outward normal there. Exact inside and out.
 */
export function wedgeDistance(p: Vec3Like, w: Omit<Wedge, "kind"> & { readonly kind?: string | undefined }): Hit {
  const c = Math.cos(w.yaw ?? 0);
  const s = Math.sin(w.yaw ?? 0);
  const x = p[0] - w.c[0];
  const y = p[1] - w.c[1];
  const z = p[2] - w.c[2];
  const lx = c * x - s * z; // (world -> the wedge's frame, as boxDistance)
  const lz = s * x + c * z;
  const a = Math.abs(lx) - w.h[0];
  const sec = polyDistance(lz, y, wedgeSection(w));
  const b = sec.d;
  let n: Vec3;
  let d: number;
  if (a > 0 && b > 0) { d = Math.hypot(a, b); n = [(Math.sign(lx) * a) / d, (sec.gv * b) / d, (sec.gu * b) / d]; }
  else if (a > b) { d = a; n = [Math.sign(lx) || 1, 0, 0]; }
  else { d = b; n = [0, sec.gv, sec.gu]; }
  return { d, n: [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]] };
}

/** Distance to any solid: a box, or a wedge ({ kind: "wedge" }). */
export const solidDistance = (p: Vec3Like, b: Solid): Hit => (b.kind === "wedge" ? wedgeDistance(p, b) : boxDistance(p, b));

/** The nearest point on a rail (a polyline) to p: segment, fraction, the point, its tangent. Null for a rail of fewer than two points. */
export function nearestOnRail(p: Vec3Like, rail: Rail): RailPoint | null {
  let best: RailPoint | null = null;
  for (let i = 0; i < rail.length - 1; i += 1) {
    const a = rail[i]!;
    const b = rail[i + 1]!;
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = dot(ab, ab);
    const t = Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1], p[2] - a[2]], ab) / L2));
    const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (!best || d < best.d) { const l = Math.sqrt(L2); best = { d, i, t, q, tan: [ab[0] / l, ab[1] / l, ab[2] / l], segLen: l }; }
  }
  return best;
}
