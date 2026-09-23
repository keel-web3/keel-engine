// The region's VENUES: three places out past a city's edge where cars go to do what the streets won't let them -- a
// dirt track (an oval, and a rally figure-eight in its infield end with jumps), a drift park (a big skid pad and a tight
// technical course of hairpins, a chicane and a long sweeper) and a demolition-derby bowl. Every city has all three.
//
// This file is their SHAPES: each venue's ground box (its middle, its level, which way it faces, its half extents) and
// its courses, laid out in the venue's own frame and handed back in world metres, sampled every metre with a half-width
// and a crest (how far the course stands above the venue's level: a jump's kicker and landing, a washboard's bumps).
// Where they go is region.ts's (placeVenues): out in the land past the city's own ground, flat, dry, clear of the
// water, the towns and the airport, their ground levelled like the airport's, a country road to each gate.
//
// Pure data on the seed (drawsFor), core's deterministic maths and keel/road's paths: a race could run on a course
// later (its samples bake to a track profile the way a street loop's do), nothing here depends on a frame or a screen.

import { dcos, dhypot, dsin } from "@keel-engine/core";
import { nearsItself, pathThrough, tightest } from "@keel-engine/road";
import type { Draws } from "./site.ts";

export type VenueKind = "dirt" | "drift" | "derby";
/** What the ground or a course is: dirt (profile.ts SURFACES "dirt"), tarmac, or the derby's mud. */
export type VenueSurface = "dirt" | "tarmac" | "mud";
export type VenueCourseName = "oval" | "rally" | "skidpad" | "technical";

/** A course in a venue: a line every ~1 m (world m), its half-width and its crest (m over the venue's level) there. */
export interface VenueCourse {
  readonly name: VenueCourseName;
  readonly surface: VenueSurface;
  /** A closed course's last sample runs back to its first (a lap); an open one runs start to finish. */
  readonly closed: boolean;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly half: Float64Array;
  readonly crest: Float64Array;
  /** The jumps: each lip's sample, and how high it stands (m). */
  readonly jumps: readonly { readonly i: number; readonly h: number }[];
  /** Its length (m). */
  readonly length: number;
}

/** A venue's gate: where its access road meets its ground (world m), facing in. */
export interface VenueGate { readonly x: number; readonly z: number; readonly yaw: number }

/**
 * A venue: its ground box -- middle (x, z), level (y), heading (yaw: its `along` axis faces (sin yaw, cos yaw)), half
 * extents across (hw) and along (hd) -- the ground's surface, its gate, its courses, and (a derby) its walled bowl.
 * The venue's own frame: a point `u` across and `v` along is (x + cos(yaw) u + sin(yaw) v, z - sin(yaw) u + cos(yaw) v).
 */
export interface Venue {
  readonly kind: VenueKind;
  readonly seed: string;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly yaw: number;
  readonly hw: number;
  readonly hd: number;
  readonly surface: VenueSurface;
  readonly gate: VenueGate;
  readonly courses: readonly VenueCourse[];
  /** The derby's bowl in the venue's frame: its middle along (v) and half extents; null for the others. */
  readonly bowl: { readonly v: number; readonly hw: number; readonly hd: number } | null;
}

/** Every city's three venues. */
export interface RegionVenues { readonly dirt: Venue; readonly drift: Venue; readonly derby: Venue }

/** Each venue's ground box's half extents (m): across, along. */
export const VENUE_BOX: Readonly<Record<VenueKind, readonly [number, number]>> = { dirt: [120, 185], drift: [115, 160], derby: [75, 80] };
export const VENUE_KINDS: readonly VenueKind[] = ["dirt", "drift", "derby"];

/** A course laid out in the venue's frame, before it's put in the world. */
interface Local { readonly u: number[]; readonly v: number[]; readonly half: number[]; readonly crest: number[]; readonly jumps: { i: number; h: number }[]; readonly closed: boolean }

const TAU = Math.PI * 2;

/** Resample a polyline to ~1 m spacing (closed: back round to its start). */
function resample(us: readonly number[], vs: readonly number[], closed: boolean): { u: number[]; v: number[] } {
  const n = us.length, segs = closed ? n : n - 1, cum = [0];
  for (let i = 0; i < segs; i += 1) { const j = (i + 1) % n; cum.push(cum[i]! + dhypot(us[j]! - us[i]!, vs[j]! - vs[i]!)); }
  const total = cum[segs]!, count = Math.max(2, Math.round(total)), step = total / count, u: number[] = [], v: number[] = [];
  let k = 0;
  for (let s = 0; s < (closed ? count : count + 1); s += 1) {
    const at = Math.min(total, s * step);
    while (k < segs - 1 && cum[k + 1]! < at) k += 1;
    const j = (k + 1) % n, t = (at - cum[k]!) / Math.max(1e-9, cum[k + 1]! - cum[k]!);
    u.push(us[k]! + (us[j]! - us[k]!) * t); v.push(vs[k]! + (vs[j]! - vs[k]!) * t);
  }
  return { u, v };
}

/** A kicker at sample `i` of `n`: up `rise` m over `up` samples to the lip, down over `down` past it (added to crest). */
function jump(crest: number[], i: number, h: number, up: number, down: number, closed: boolean): void {
  const n = crest.length;
  for (let k = -up; k <= down; k += 1) {
    const j = closed ? (((i + k) % n) + n) % n : i + k;
    if (j < 0 || j >= n) continue;
    const t = k <= 0 ? 1 + k / up : 1 - k / down;
    crest[j] = crest[j]! + h * t;
  }
}

/** A dirt oval: two straights along the venue and two turns, `R` round, laid about (0, vc). */
function oval(D: Draws, vc: number, Ls: number, R: number, half: number): Local {
  const us: number[] = [], vs: number[] = [];
  // (Down the right straight, round the top turn, up the left, round the bottom: sampled finely, then every metre.)
  for (let k = 0; k <= 20; k += 1) { us.push(R); vs.push(vc - Ls / 2 + (Ls * k) / 20); }
  for (let k = 1; k < 40; k += 1) { const a = (k / 40) * Math.PI; us.push(R * dcos(a)); vs.push(vc + Ls / 2 + R * dsin(a)); }
  for (let k = 0; k <= 20; k += 1) { us.push(-R); vs.push(vc + Ls / 2 - (Ls * k) / 20); }
  for (let k = 1; k < 40; k += 1) { const a = Math.PI + (k / 40) * Math.PI; us.push(R * dcos(a)); vs.push(vc - Ls / 2 + R * dsin(a)); }
  const { u, v } = resample(us, vs, true);
  // (Graded but bumpy: a washboard along the straights, ruts through the turns.)
  const ph = D.u("ovalBumps") * TAU;
  const crest = u.map((_, i) => 0.1 + 0.05 * dsin(i * 1.7 + ph) + 0.04 * dsin(i * 0.43 + ph * 2));
  return { u, v, half: u.map(() => half), crest, jumps: [], closed: true };
}

/** The rally figure-eight: a lemniscate A m across and B m either side of (0, vc), crossing itself at its middle, with jumps. */
function figureEight(D: Draws, vc: number, A: number, B: number, half: number): Local {
  const us: number[] = [], vs: number[] = [];
  const n = 32;
  for (let k = 0; k < n; k += 1) { const t = (k / n) * TAU; us.push(A * dsin(t)); vs.push(vc + B * dsin(2 * t)); }
  const p = pathThrough(us, vs, { closed: true, per: 24 });
  const u = Array.from(p.x), v = Array.from(p.z), L = u.length;
  const crest = u.map((_, i) => 0.1 + 0.08 * dsin(i * 1.1 + D.u("rallyBumps") * TAU) * dsin(i * 0.21));
  // (Jumps on the diagonals, away from the crossing and the lobes' turns: three or four of them, 1.2..2.2 m.)
  const at = [0.1, 0.4, 0.6, 0.9], count = 3 + (D.u("rallyJumps") < 0.5 ? 1 : 0), jumps: { i: number; h: number }[] = [];
  for (let k = 0; k < count; k += 1) {
    const i = Math.round(at[(k + Math.floor(D.u("rallyJump0") * 4)) % 4]! * L) % L, h = 1.2 + D.u("rallyJumpH", k) * 1;
    jump(crest, i, h, 10, 12, true);
    jumps.push({ i, h });
  }
  jumps.sort((a, b) => a.i - b.i);
  return { u, v, half: u.map((_, i) => half + 1.5 * Math.abs(dsin((i / L) * TAU * 2))), crest, jumps, closed: true };
}

/** The skid pad: a circle `R` round about (0, vc), its half the pad's width. */
function skidPad(vc: number, R: number, half: number): Local {
  const us: number[] = [], vs: number[] = [];
  for (let k = 0; k < 96; k += 1) { const a = (k / 96) * TAU; us.push(R * dsin(a)); vs.push(vc + R * dcos(a)); }
  const { u, v } = resample(us, vs, true);
  return { u, v, half: u.map(() => half), crest: u.map(() => 0), jumps: [], closed: true };
}

/**
 * The technical course: points round an ellipse in the box (u0..u1 across, v0..v1 along), some pinched deep for hairpins,
 * one pair jogged for a chicane, the rest long and open for the sweeper; kept only if it fits, never nears itself and has
 * no corner tighter than a hairpin. A plain ellipse if no draw passes.
 */
function technical(D: Draws, u0: number, u1: number, v0: number, v1: number, half: number): Local {
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, au = (u1 - u0) / 2 - half - 3, av = (v1 - v0) / 2 - half - 3;
  const fits = (p: { x: Float64Array; z: Float64Array; length: number }): boolean => {
    for (let i = 0; i < p.length; i += 1) if (Math.abs(p.x[i]! - cu) > au + 2 || Math.abs(p.z[i]! - cv) > av + 2) return false;
    return true;
  };
  for (let n = 0; n < 120; n += 1) {
    const count = 9 + Math.floor(D.u("techCount", n) * 4), hair = Math.floor(D.u("techHair", n) * count), chic = (hair + 2 + Math.floor(D.u("techChic", n) * (count - 4))) % count;
    const us: number[] = [], vs: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU + D.flat("techAng", n, i) * (0.3 / count) * TAU;
      // (A deep pinch is a hairpin: the one drawn, and maybe another.)
      const pinch = i === hair || D.u("techPinch", n, i) < 0.15;
      const r = pinch ? 0.3 + 0.15 * D.u("techPr", n, i) : 0.8 + 0.2 * D.u("techR", n, i);
      us.push(cu + dsin(a) * au * r); vs.push(cv + dcos(a) * av * r);
      if (i === chic) {
        // (A chicane: a jog in and back out before the next point.)
        const b = a + (0.5 / count) * TAU, dir = D.u("techChicSide", n) < 0.5 ? 1 : -1;
        us.push(cu + dsin(b) * au * (r - 0.18 * dir)); vs.push(cv + dcos(b) * av * (r - 0.18 * dir));
      }
    }
    const p = pathThrough(us, vs, { closed: true });
    if (p.length < 300 || !fits(p) || tightest(p) > 1 / 9 || nearsItself(p, half * 2 + 4, 40, 3)) continue;
    const u = Array.from(p.x), v = Array.from(p.z);
    return { u, v, half: u.map(() => half), crest: u.map(() => 0), jumps: [], closed: true };
  }
  const us: number[] = [], vs: number[] = [];
  for (let k = 0; k < 16; k += 1) { const a = (k / 16) * TAU; us.push(cu + dsin(a) * au); vs.push(cv + dcos(a) * av); }
  const p = pathThrough(us, vs, { closed: true }), u = Array.from(p.x), v = Array.from(p.z);
  return { u, v, half: u.map(() => half), crest: u.map(() => 0), jumps: [], closed: true };
}

/** A venue's courses and bowl, in its own frame, from its seed's draws. */
export function venueLayout(kind: VenueKind, D: Draws): { courses: { name: VenueCourseName; surface: VenueSurface; local: Local }[]; bowl: Venue["bowl"] } {
  const [hw, hd] = VENUE_BOX[kind];
  if (kind === "dirt") {
    // The oval at the far end; the rally figure-eight in the near end, below it.
    const Ls = 90 + 30 * D.u("ovalLs"), R = 34 + 8 * D.u("ovalR"), half = 7.5 + 1.5 * D.u("ovalHalf");
    const vo = hd - 20 - (Ls / 2 + R + half);
    const B = 30 + 6 * D.u("rallyB"), A = 62 + 18 * D.u("rallyA"), rh = 5 + D.u("rallyHalf");
    const vf = -hd + 20 + B + rh + 2;
    void hw;
    return { courses: [{ name: "oval", surface: "dirt", local: oval(D, vo, Ls, R, half) }, { name: "rally", surface: "dirt", local: figureEight(D, vf, A, B, rh) }], bowl: null };
  }
  if (kind === "drift") {
    // The skid pad at the far end; the technical course filling the rest.
    const R = 30 + 6 * D.u("padR"), vp = hd - 20 - R - 14;
    return {
      courses: [
        { name: "skidpad", surface: "tarmac", local: skidPad(vp, R, 14) },
        { name: "technical", surface: "tarmac", local: technical(D, -hw + 12, hw - 12, -hd + 12, vp - R - 14 - 16, 5.5 + D.u("techHalf")) },
      ],
      bowl: null,
    };
  }
  return { courses: [], bowl: { v: -10, hw: 22.5 + 3 * D.u("bowlW"), hd: 35 + 4 * D.u("bowlL") } };
}

/** A course put in the world at a venue's box. */
export function placeCourse(name: VenueCourseName, surface: VenueSurface, l: Local, x: number, z: number, yaw: number): VenueCourse {
  const c = dcos(yaw), s = dsin(yaw), n = l.u.length;
  const X = new Float64Array(n), Z = new Float64Array(n);
  for (let i = 0; i < n; i += 1) { X[i] = x + c * l.u[i]! + s * l.v[i]!; Z[i] = z - s * l.u[i]! + c * l.v[i]!; }
  let length = 0;
  for (let i = 0; i < (l.closed ? n : n - 1); i += 1) { const j = (i + 1) % n; length += dhypot(X[j]! - X[i]!, Z[j]! - Z[i]!); }
  return { name, surface, closed: l.closed, x: X, z: Z, half: Float64Array.from(l.half), crest: Float64Array.from(l.crest), jumps: l.jumps, length };
}

/** A world point in a venue's frame: [u across, v along]. */
export function venueLocal(v: { readonly x: number; readonly z: number; readonly yaw: number }, x: number, z: number): [number, number] {
  const c = dcos(v.yaw), s = dsin(v.yaw), dx = x - v.x, dz = z - v.z;
  return [c * dx - s * dz, s * dx + c * dz];
}

// ---------------------------------------------------------------------------------------------------- the rally stage

/**
 * Every city's rally stage: a narrow dirt road out through the country from one road to another -- a few kilometres of
 * it, swinging across the land, a switchback or two where it climbs, fords where it meets the river, jumps off its
 * crests. `x`/`z`/`y` a sample every metre (y the graded road's height there, region.heightAt's), `crest` the jumps and
 * washboard over it, `road` its index in region.roads (kind "dirt", the same line every 5 m).
 */
export interface RallyStage extends Omit<VenueCourse, "name"> {
  readonly name: "stage";
  readonly seed: string;
  readonly y: Float64Array;
  /** Where it fords water: sample runs [i0, i1]. */
  readonly splashes: readonly { readonly i0: number; readonly i1: number }[];
  /** Its hairpins: each apex's sample. */
  readonly hairpins: readonly number[];
  /** Its start and finish lines (on the stage, a way in from each end), facing down the stage. */
  readonly start: VenueGate;
  readonly finish: VenueGate;
  readonly road: number;
}

/**
 * A stage's corners from (sx, sz) to (ex, ez) for draw `t`, each with the radius its bend is rounded to: swinging side to
 * side across the line between them (wide sweepers), with one or two Z-shaped switchbacks (out, over, back, over, on --
 * four quarter-turns of radius R, so two hairpins).
 */
export function rallyControls(D: Draws, t: number, sx: number, sz: number, ex: number, ez: number): { xs: number[]; zs: number[]; rs: number[] } {
  const L = dhypot(ex - sx, ez - sz), ux = (ex - sx) / L, uz = (ez - sz) / L, nx = -uz, nz = ux;
  const K = 5 + Math.floor(L / 650), amp = Math.min(480, L * 0.13);
  const switches = new Set<number>([1 + Math.floor(D.u("rallySw", t) * (K - 2))]);
  if (D.u("rallySw2", t) < 0.6) switches.add(1 + Math.floor(D.u("rallySw3", t) * (K - 2)));
  const xs = [sx], zs = [sz], rs = [0];
  for (let k = 1; k < K; k += 1) {
    const off = D.flat("rallyOff", t, k) * amp * (k % 2 ? 1 : -0.7);
    const px = sx + ux * (L * k) / K + nx * off, pz = sz + uz * (L * k) / K + nz * off;
    xs.push(px); zs.push(pz); rs.push(60 + 140 * D.u("rallyR", t, k));
    if (switches.has(k)) {
      const side = D.u("rallySwSide", t, k) < 0.5 ? 1 : -1, run = 130, R = 11 + 6 * D.u("rallySwR", t, k), w = 2 * R * side;
      for (const [a, b] of [[run, 0], [run, w], [0, w], [0, 2 * w]] as const) { xs.push(px + ux * a + nx * b); zs.push(pz + uz * a + nz * b); rs.push(R); }
    }
  }
  xs.push(ex); zs.push(ez); rs.push(0);
  return { xs, zs, rs };
}

/** A line through corners, each bend rounded to its radius (as far as its legs allow), every metre; and its tightest radius. */
export function filletPath(xs: readonly number[], zs: readonly number[], rs: readonly number[]): { x: Float64Array; z: Float64Array; length: number; closed: false; rmin: number } {
  const n = xs.length, px: number[] = [xs[0]!], pz: number[] = [zs[0]!];
  let rmin = Infinity;
  const leg = (i: number): number => dhypot(xs[i + 1]! - xs[i]!, zs[i + 1]! - zs[i]!);
  for (let i = 1; i < n - 1; i += 1) {
    const l0 = leg(i - 1), l1 = leg(i), ax = (xs[i]! - xs[i - 1]!) / (l0 || 1), az = (zs[i]! - zs[i - 1]!) / (l0 || 1), bx = (xs[i + 1]! - xs[i]!) / (l1 || 1), bz = (zs[i + 1]! - zs[i]!) / (l1 || 1);
    const cross = ax * bz - az * bx, dot = Math.max(-1, Math.min(1, ax * bx + az * bz)), th = Math.acos(dot);
    if (th < 1e-3 || l0 < 1e-6 || l1 < 1e-6) { px.push(xs[i]!); pz.push(zs[i]!); continue; }
    // (Each leg shared by two bends: a bend takes at most half of it -- all of it at the ends.)
    const tan = Math.tan(th / 2), T = Math.min(rs[i]! * tan, (i === 1 ? l0 : l0 / 2), (i === n - 2 ? l1 : l1 / 2)), r = T / tan;
    rmin = Math.min(rmin, r);
    const x0 = xs[i]! - ax * T, z0 = zs[i]! - az * T, s = cross > 0 ? 1 : -1;
    // (The centre: r off the incoming leg, on the side it turns to.)
    const cx = x0 - az * r * s, cz = z0 + ax * r * s, a0 = Math.atan2(x0 - cx, z0 - cz), steps = Math.max(2, Math.ceil((th * r) / 2));
    for (let q = 0; q <= steps; q += 1) { const a = a0 - s * (th * q) / steps; px.push(cx + dsin(a) * r); pz.push(cz + dcos(a) * r); }
  }
  px.push(xs[n - 1]!); pz.push(zs[n - 1]!);
  const { u, v } = resample(px, pz, false);
  return { x: Float64Array.from(u), z: Float64Array.from(v), length: u.length, closed: false, rmin };
}

/** A stage's jumps (off its crests), washboard, hairpins and fords, from its graded heights and where the water is. */
export function rallyProfile(D: Draws, x: Float64Array, z: Float64Array, y: Float64Array, wet: (i: number) => boolean): Pick<RallyStage, "crest" | "jumps" | "hairpins" | "splashes"> {
  const n = x.length, crest = new Float64Array(n), jumps: { i: number; h: number }[] = [], hairpins: number[] = [], splashes: { i0: number; i1: number }[] = [];
  const ph = D.u("rallyWash") * TAU;
  for (let i = 0; i < n; i += 1) crest[i] = 0.08 + 0.05 * dsin(i * 1.3 + ph) * dsin(i * 0.17);
  // Hairpins: where it turns more than 100 degrees within 40 m.
  const head = (i: number): number => Math.atan2(x[Math.min(n - 1, i + 1)]! - x[Math.max(0, i - 1)]!, z[Math.min(n - 1, i + 1)]! - z[Math.max(0, i - 1)]!);
  for (let i = 20; i < n - 20; i += 2) {
    let d = head(i + 20) - head(i - 20);
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    if (Math.abs(d) > 1.75 && (!hairpins.length || i - hairpins[hairpins.length - 1]! > 40)) hairpins.push(i);
  }
  // Fords.
  for (let i = 0; i < n; i += 1) {
    if (!wet(i)) continue;
    const last = splashes[splashes.length - 1];
    if (last && i - last.i1 <= 3) (last as { i1: number }).i1 = i; else splashes.push({ i0: i, i1: i });
  }
  // Jumps off its crests: a rise of a metre and more either side over 25 m, 150 m apart, clear of the ends, hairpins, fords.
  const clearOf = (i: number): boolean => i > 120 && i < n - 120 && hairpins.every((h) => Math.abs(h - i) > 60) && splashes.every((s) => i < s.i0 - 60 || i > s.i1 + 60);
  const cands: { i: number; p: number }[] = [];
  for (let i = 25; i < n - 25; i += 1) {
    const p = y[i]! - Math.max(y[i - 25]!, y[i + 25]!);
    if (p > 1 && y[i]! >= y[i - 1]! && y[i]! >= y[i + 1]! && clearOf(i)) cands.push({ i, p });
  }
  cands.sort((a, b) => b.p - a.p || a.i - b.i);
  for (const c of cands) {
    if (jumps.length >= 6) break;
    if (jumps.some((j) => Math.abs(j.i - c.i) < 150)) continue;
    const h = 0.8 + 0.9 * D.u("rallyJumpH", c.i);
    for (let k = -10; k <= 12; k += 1) { const j = c.i + k; if (j >= 0 && j < n) crest[j] = crest[j]! + h * (k <= 0 ? 1 + k / 10 : 1 - k / 12); }
    jumps.push({ i: c.i, h });
  }
  // (Few crests on flat land: a kicker or two on the straights all the same.)
  for (let k = 0; jumps.length < 3 && k < 30; k += 1) {
    const i = 150 + Math.floor(D.u("rallyKick", k) * Math.max(1, n - 300));
    if (!clearOf(i) || jumps.some((j) => Math.abs(j.i - i) < 150)) continue;
    const h = 0.9 + 0.6 * D.u("rallyKickH", k);
    for (let q = -10; q <= 12; q += 1) { const j = i + q; if (j >= 0 && j < n) crest[j] = crest[j]! + h * (q <= 0 ? 1 + q / 10 : 1 - q / 12); }
    jumps.push({ i, h });
  }
  jumps.sort((a, b) => a.i - b.i);
  return { crest, jumps, hairpins, splashes };
}

/** Whether a line comes back within `clear` m of itself (samples `gap` apart or more, every `step`). */
export function nearsSelf(x: Float64Array, z: Float64Array, clear: number, gap: number, step: number): boolean {
  const n = x.length, c2 = clear * clear;
  for (let a = 0; a < n; a += step) for (let b = a + gap; b < n; b += step) {
    const dx = x[a]! - x[b]!, dz = z[a]! - z[b]!;
    if (dx * dx + dz * dz < c2) return true;
  }
  return false;
}
