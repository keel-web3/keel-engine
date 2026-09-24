// A car's glasshouse, measured once: where each pane of glass is -- the windscreen, the rear glass, the two side
// windows -- as the corners of a real pane, and the room inside them. Everything that has to agree with the glass
// reads it from here: shapes.ts builds the panes, the pillars and the roof over them from it and keeps the cabin's
// contents inside it; a game's cracks, wipers, cockpit view and seated driver fit to the same corners.
//
// A closed car's greenhouse is a truncated pyramid on the belt: its foot the cabin's full width (C2 a side) from the
// cabin's rear to its front, its top the roof's narrower flat (Ci a side, the side glass leaning in by `tumble`) from
// the rear glass's top (zr) to the windscreen's (zs). Four planar panes close it -- each a trapezoid whose edges are
// the pillars it shares with its neighbours -- under a roof slab. An open car keeps only its short screen.
//
// The frame convention: +z the car's front, +x its right, +y up; the ground under the car's middle.

import { dhypot } from "@keel-engine/core";
import type { Car } from "./car.ts";

export type V3 = readonly [number, number, number];
export type PaneName = "screen" | "rear" | "left" | "right";

/**
 * One pane: its corners on its OUTER face, foot first -- [foot, foot, top, top], in order round it -- its outward
 * normal, and how thick it is (m). `u` runs across it (level), `v` up it from its foot; `centre`, `hu`, `hv` the box
 * they span. Its corners in (u, v) about the centre are `shape` -- the trapezoid a crack stays inside.
 */
export interface GlassPane {
  readonly name: PaneName;
  readonly corners: readonly [V3, V3, V3, V3];
  readonly normal: V3;
  readonly u: V3;
  readonly v: V3;
  readonly centre: V3;
  readonly hu: number;
  readonly hv: number;
  readonly shape: readonly (readonly [number, number])[];
  readonly thickness: number;
}

/** An inside half-space: a point p is in when n.p <= d (n unit, pointing OUT of the cabin; d at the glass's inner face). */
export interface CabinPlane { readonly n: V3; readonly d: number; readonly name: string }

export interface Glasshouse {
  readonly kind: "closed" | "open";
  /** The belt the glass stands on, and how far below it the panes' feet are tucked into the body. */
  readonly belt: number;
  readonly foot: number;
  /** The panes' tops (tucked into the roof slab), the headlining (the slab's underside) and the roof's top. */
  readonly top: number;
  readonly headlining: number;
  readonly roof: number;
  /** Half widths: at the foot, and at the roof (the side glass leans in by the difference). */
  readonly C2: number;
  readonly Ci: number;
  /** Along the car: the cabin's front and rear (the panes' feet), and the roof flat between the screens' tops. */
  readonly cabFront: number;
  readonly cabRear: number;
  readonly zs: number;
  readonly zr: number;
  readonly panes: Readonly<Record<PaneName, GlassPane | null>>;
  /** The room inside the glass: every plane a thing in the cabin has to stay behind (the headlining among them). */
  readonly planes: readonly CabinPlane[];
}

/** How thick glass is (m): laminated screen and tempered side glass alike, at the scale a car is drawn. */
export const GLASS_THICKNESS = 0.012;
/** How far below the belt a pane's foot tucks into the body, and into the roof slab its top. */
const TUCK = 0.02;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = dhypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** A pane from its four outer corners (foot, foot, top, top, in order round it); `inside` a point in the cabin. */
function paneOf(name: PaneName, corners: readonly [V3, V3, V3, V3], inside: V3, thickness = GLASS_THICKNESS): GlassPane {
  const [a, b, , d] = corners;
  let normal = unit(cross(sub(b, a), sub(d, a)));
  if (dot(normal, sub(a, inside)) < 0) normal = [-normal[0], -normal[1], -normal[2]];
  // (Across: level and in the pane; up: the rest, pointing from the foot toward the top.)
  let u = unit([normal[2], 0, -normal[0]]);
  if (dhypot(normal[2], normal[0]) < 1e-6) u = [1, 0, 0];
  if (dot(u, sub(b, a)) < 0) u = [-u[0], -u[1], -u[2]];
  let v = cross(normal, u);
  if (dot(v, sub(d, a)) < 0) v = [-v[0], -v[1], -v[2]];
  const c: V3 = [0, 1, 2].map((k) => (corners[0][k]! + corners[1][k]! + corners[2][k]! + corners[3][k]!) / 4) as unknown as V3;
  const shape = corners.map((p) => [dot(sub(p, c), u), dot(sub(p, c), v)] as const);
  let hu = 0, hv = 0;
  for (const [pu, pv] of shape) { hu = Math.max(hu, Math.abs(pu)); hv = Math.max(hv, Math.abs(pv)); }
  // (The centre of the uv box, not the corners' mean: a trapezoid's box is what a crack's (u, v) are measured over.)
  const u0 = (Math.min(...shape.map((s) => s[0])) + Math.max(...shape.map((s) => s[0]))) / 2, v0 = (Math.min(...shape.map((s) => s[1])) + Math.max(...shape.map((s) => s[1]))) / 2;
  const centre: V3 = [c[0] + u[0] * u0 + v[0] * v0, c[1] + u[1] * u0 + v[1] * v0, c[2] + u[2] * u0 + v[2] * v0];
  const around = shape.map(([pu, pv]) => [pu - u0, pv - v0] as const);
  hu = Math.max(...around.map((s) => Math.abs(s[0]))); hv = Math.max(...around.map((s) => Math.abs(s[1])));
  return { name, corners, normal, u, v, centre, hu, hv, shape: around, thickness };
}

/** A pane's inner face as a cabin plane (normal out of the cabin). */
const planeOf = (p: GlassPane): CabinPlane => ({ n: p.normal, d: dot(p.normal, p.corners[0]) - p.thickness, name: p.name });

/** What of a car its glass is measured from (any Car is one). */
export interface GlassCar {
  readonly archetype: string;
  readonly body: Pick<Car["body"], "belt" | "roof" | "cabFront" | "cabRear" | "cabWidth" | "screenRun" | "rearRun">;
  readonly parts: { readonly open: boolean; readonly semi?: unknown };
  readonly dials: { readonly round: number };
}

const made = new WeakMap<GlassCar, Glasshouse | null>();

/**
 * The car's glasshouse (null: a semi tractor, whose cab is its own -- semi.ts). Worked out from the body's own
 * measurements, so a car's glass is part of what its seed makes, never stored on it.
 */
export function glasshouse(car: GlassCar): Glasshouse | null {
  if (made.has(car)) return made.get(car)!;
  const g = car.body, p = car.parts;
  let out: Glasshouse | null = null;
  if (!p.semi) {
    const C2 = g.cabWidth / 2, cabF = g.cabFront, cabR = g.cabRear, foot = g.belt - TUCK;
    if (p.open || car.archetype === "buggy") {
      // An open top's short screen standing on the scuttle, raked back 0.9 of its height; no roof.
      const buggy = car.archetype === "buggy";
      const screenH = buggy ? 0.3 : Math.min(0.32, g.roof - g.belt), top = g.belt + screenH;
      const zTop = cabF - screenH * 0.9, zFoot = cabF + (TUCK / Math.max(0.05, screenH)) * screenH * 0.9;
      const screen = paneOf("screen", [[C2, foot, zFoot], [-C2, foot, zFoot], [-C2, top, zTop], [C2, top, zTop]], [0, g.belt, (cabF + cabR) / 2]);
      out = { kind: "open", belt: g.belt, foot, top, headlining: top, roof: top, C2, Ci: C2, cabFront: cabF, cabRear: cabR, zs: zTop, zr: cabR, panes: { screen, rear: null, left: null, right: null }, planes: [planeOf(screen)] };
    } else {
      const roofT = 0.05, headlining = g.roof - roofT, top = g.roof - 0.006;
      const tumble = Math.min(C2 * 0.3, (g.roof - g.belt) * (0.22 + 0.25 * Math.max(0, car.dials.round)));
      const Ci = C2 - tumble;
      // (The screens' tops, where the roof flat starts and ends. Screens raked so far they'd cross meet in a short ridge.)
      let zs = cabF - g.screenRun, zr = cabR + g.rearRun;
      if (zs - zr < 0.1) { const m = (zs * g.rearRun + zr * g.screenRun) / Math.max(1e-6, g.screenRun + g.rearRun); zs = m + 0.05; zr = m - 0.05; }
      // (Each pane's edges run straight from the belt at the cabin's end up to the roof: the feet, tucked below the belt,
      // sit on those lines extended.)
      const riseS = top - g.belt, ext = TUCK / Math.max(0.05, riseS);
      const zFootF = cabF + (cabF - zs) * ext, zFootR = cabR - (zr - cabR) * ext, C2f = C2 + tumble * ext;
      // (Outer corners, round each pane: foot then top.)
      const mid: V3 = [0, (g.belt + g.roof) / 2, (cabF + cabR) / 2];
      const screen = paneOf("screen", [[-C2f, foot, zFootF], [C2f, foot, zFootF], [Ci, top, zs], [-Ci, top, zs]], mid);
      const rear = paneOf("rear", [[C2f, foot, zFootR], [-C2f, foot, zFootR], [-Ci, top, zr], [Ci, top, zr]], mid);
      const left = paneOf("left", [[-C2f, foot, zFootR], [-C2f, foot, zFootF], [-Ci, top, zs], [-Ci, top, zr]], mid);
      const right = paneOf("right", [[C2f, foot, zFootF], [C2f, foot, zFootR], [Ci, top, zr], [Ci, top, zs]], mid);
      out = {
        kind: "closed", belt: g.belt, foot, top, headlining, roof: g.roof, C2, Ci, cabFront: cabF, cabRear: cabR, zs, zr,
        panes: { screen, rear, left, right },
        planes: [{ n: [0, 1, 0], d: headlining, name: "headlining" }, planeOf(screen), planeOf(rear), planeOf(left), planeOf(right)],
      };
    }
  }
  made.set(car, out);
  return out;
}

/** How far a point is inside the glass (m, the least of its planes' margins; negative: through one of them). */
export function cabinMargin(house: Glasshouse, p: V3): number {
  let m = Infinity;
  for (const q of house.planes) m = Math.min(m, q.d - dot(q.n, p));
  return m;
}

/** The highest a thing may stand at (x, z) and keep `clear` (m) inside the glass: under the headlining, the screens and the side glass. */
export function ceilingAt(house: Glasshouse, x: number, z: number, clear = 0): number {
  let y = Infinity;
  for (const q of house.planes) {
    if (q.n[1] <= 1e-6) continue;
    // n.p <= d - clear, solved for y.
    y = Math.min(y, (q.d - clear - q.n[0] * x - q.n[2] * z) / q.n[1]);
  }
  return y;
}

/** The furthest forward (dir +1) or back (-1) a thing at height y and across x may reach and keep `clear` inside the glass. */
export function reachAt(house: Glasshouse, x: number, y: number, dir: 1 | -1, clear = 0): number {
  let z = dir * Infinity;
  for (const q of house.planes) {
    if (q.n[2] * dir <= 1e-6) continue;
    const at = (q.d - clear - q.n[0] * x - q.n[1] * y) / q.n[2];
    z = dir > 0 ? Math.min(z, at) : Math.max(z, at);
  }
  return z;
}

/**
 * A point pulled back inside the glass with `clear` (m) to spare -- each plane it's through pushes it straight back in,
 * round the planes a few times (the room is convex: the pushes settle). A capsule whose two ends come back in with its
 * radius to spare is inside all along.
 */
export function keepInside(house: Glasshouse, p: V3, clear: number): V3 {
  let q: [number, number, number] = [p[0], p[1], p[2]];
  for (let k = 0; k < 12; k += 1) {
    let moved = false;
    for (const pl of house.planes) {
      const over = dot(pl.n, q) - (pl.d - clear);
      if (over > 1e-9) { q = [q[0] - pl.n[0] * over, q[1] - pl.n[1] * over, q[2] - pl.n[2] * over]; moved = true; }
    }
    if (!moved) break;
  }
  return q;
}

/**
 * Where the car's stand-in driver sits (shapes.ts draws one in every closed car -- a torso, a helmet, the wheel's hub
 * ahead of them -- and a game that seats its own driver takes the stand-in out by these exact figures): the helmet's
 * centre and radius, the hub's two ends and radius, the torso's box [x0, y0, z0, x1, y1, z1]. Null: an open car (its
 * seats are empty) or a semi.
 */
export interface StandIn { readonly helmet: V3; readonly helmetR: number; readonly hub: readonly [V3, V3]; readonly hubR: number; readonly torso: readonly [number, number, number, number, number, number]; readonly seatZ: number }

const seats = new WeakMap<GlassCar, StandIn | null>();
export function standIn(car: GlassCar): StandIn | null {
  if (seats.has(car)) return seats.get(car)!;
  const house = glasshouse(car);
  let out: StandIn | null = null;
  if (house && house.kind === "closed") {
    const g = car.body, { Ci, zs, zr, headlining } = house, clear = 0.03;
    // (Laid out round a person: their head where the roof is highest, just behind the windscreen's top edge.)
    const zHead = Math.max(g.cabRear + 0.42, zs - Math.max(0.06, Math.min(0.14, (zs - zr) * 0.3)));
    const dx = -Math.max(0.2, Ci * 0.45), hr = Math.min(0.11, (headlining - g.belt) * 0.3);
    // The helmet: under the headlining, behind the screen, ahead of the rear glass, inside the side glass -- slid and
    // lowered from the seat's own place till it clears them all.
    const helmet = keepInside(house, [dx, Math.min(headlining - hr - 0.015, g.belt + 0.36), zHead], hr + clear);
    const hy = helmet[1], hz = helmet[2];
    const hub0 = keepInside(house, [dx, g.belt + 0.2, hz + 0.34], 0.055 + clear), hub1 = keepInside(house, [dx, g.belt + 0.24, hz + 0.3], 0.055 + clear);
    const tTop = Math.max(g.belt + 0.1, Math.min(hy - hr, g.belt + 0.3, ...[dx - 0.14, dx + 0.14].flatMap((x) => [hz - 0.12, hz + 0.06].map((z) => ceilingAt(house, x, z, clear)))));
    out = { helmet, helmetR: hr, hub: [hub0, hub1], hubR: 0.055, torso: [dx - 0.14, g.belt + 0.06, hz - 0.12, dx + 0.14, tTop, hz + 0.06], seatZ: zHead };
  }
  seats.set(car, out);
  return out;
}
