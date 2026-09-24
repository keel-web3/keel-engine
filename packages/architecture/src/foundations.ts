// Foundations: how a building meets its ground on a city's terraces (keel/city
// terraces.ts: each block graded to the pavements round it, following each
// road's grade along it). The floor is set by the DOOR -- level with the
// pavement it opens onto (a shop, a garage, a tower's lobby: anything driven or
// wheeled in), or up a stoop (a walk-up's front steps, a house's, a church's).
// The building stands level on the sloped terrace: set into the ground on its
// uphill side, a PLINTH showing on its downhill side -- a concrete course round
// every mass that stands on the ground, reaching below the lowest ground under
// it, capped with a ledge where it shows. Steps down from a stoop to the ground
// in front of it. And whatever stands free on the lot -- a car park and its
// cars, a pump canopy, a sign's pylon, a park's benches and trees -- is set down
// on the terrace where it stands, not on the floor: a thin slab laid on a slope
// becomes a wedge following it, a canopy's posts reach down to the ground under
// each. All of it boxes, like the rest of a plan.

import { dcos, dsin } from "@keel-engine/core";
import type { CityHeight, Draws } from "@keel-engine/city";
import type { BakeBox, BakeCapsule } from "@keel-engine/bake";
import { addBox, toFrame, toWorld } from "./frame.ts";
import type { Build, Mass } from "./frame.ts";
import type { Door, Range, Solid } from "./types.ts";

/** A level door's floor over the pavement it opens onto (m): a hair, so the threshold never z-fights the ground. */
export const DOOR_LIFT = 0.02;
/** A stoop's riser and tread, and the landing at its door (m). */
export const RISER = 0.17, TREAD = 0.3, LANDING = 0.9;
/** The plinth: its top under the floor's own slabs, how far it stands out of the walls, how deep under the lowest ground. */
const PLINTH_TOP = 0.02, PLINTH_OUT = 0.12, PLINTH_DEEP = 0.3;
/** Its cap: a ledge proud of the plinth, its top where the old foundation's was (under every slab laid at 6 cm). */
const CAP_TOP = 0.045, CAP_H = 0.05, CAP_OUT = 0.08;
/** How far the ground must fall below the floor somewhere round a mass before its plinth shows (and is capped). */
export const CAP_SHOWS = 0.12;
/** A slab laid on the ground within this of level (m, end to end) stays a box; past it, a wedge. */
const FLAT = 0.04;

/** Masses that aren't buildings: things a car hits (a parked car, a pylon's leg, a container). */
const things = new WeakSet<Mass>();
/** Mark a mass as a thing on the lot, not a building (it stands on the ground where it is: no plinth). */
export function thing(m: Mass): Mass { things.add(m); return m; }
/** Solids that keep the level they were placed at (a lake's water and its edge: level across its block). */
const level = new WeakSet<Solid>();
/** Keep every solid a build added from index `from` on at the level it was placed at. */
export function keepLevel(b: Build, from: number): void { for (let k = from; k < b.solids.length; k += 1) level.add(b.solids[k]!); }

/** The masses standing on the ground that are buildings: what gets a plinth, and what the lot's furniture stands clear of. */
export function groundMasses(b: Build): Mass[] {
  return b.masses.filter((m) => m.y0 < 0.01 && !things.has(m) && m.y1 - m.y0 > 0.3);
}

/**
 * The door and its floor: the middle of the envelope's front, and the floor a hair over the ground in front of it --
 * the terrace, flush with the pavement where the door is near it, graded gently up or down from the pavement where
 * the lot is set back from it -- or a stoop's rise over it (never more than the steps can climb in the room in front
 * of the door). The pavement abreast of the door on the road the building faces goes with it.
 */
export function floorOf(height: CityHeight, b: Pick<Build, "frame" | "site">, D: Draws, stoop: Range | undefined, edge: number | undefined): { base: number; rise: number; door: Door } {
  const f = b.frame, s = b.site, c = dcos(f.yaw), sn = dsin(f.yaw);
  const u = s.x, v = s.z + s.hd, x = f.x + u * c + v * sn, z = f.z - u * sn + v * c;
  // (The ground a step out of the door.)
  const ground = height.heightAt(x + 0.3 * sn, z + 0.3 * c), door = { x, z, pave: height.pavementAt(x, z, edge), ground };
  if (!stoop) return { base: ground + DOOR_LIFT, rise: 0, door };
  // (The steps run out from the door toward the road, inside the lot: its front, and the strip to the pavement.)
  const room = Math.max(0, f.hd - v + 1.2 - LANDING);
  const want = stoop[0] + (stoop[1] - stoop[0]) * D.u("stoop"), most = (Math.floor(room / TREAD) + 1) * RISER;
  const rise = Math.min(want, most);
  return rise < 2 * RISER ? { base: ground + DOOR_LIFT, rise: 0, door } : { base: ground + rise, rise, door };
}

/**
 * A plinth under each building mass on the ground: from under the lowest ground round it up to just under the floor,
 * a hand proud of its walls -- never floating, never a gap -- and a ledge capping it where the ground falls away from
 * it. Returns the lowest ground under the building (its foundation's foot), or the floor if it has no mass.
 */
export function plinths(b: Build, height: CityHeight): number {
  const f = b.frame, y = f.y ?? 0;
  let foot = Infinity;
  for (const m of groundMasses(b)) {
    // (Clipped to the envelope, as the footprint is: what overhangs it stands on the plinth's edge.)
    const s = b.site, x0 = Math.max(m.x - m.hw, s.x - s.hw), x1 = Math.min(m.x + m.hw, s.x + s.hw), z0 = Math.max(m.z - m.hd, s.z - s.hd), z1 = Math.min(m.z + m.hd, s.z + s.hd);
    if (x1 - x0 < 0.5 || z1 - z0 < 0.5) continue;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, hw = (x1 - x0) / 2, hd = (z1 - z0) / 2, [wx, , wz] = toWorld(b, mx, 0, mz);
    const lo = height.under(wx, wz, hw + PLINTH_OUT, hd + PLINTH_OUT, f.yaw)[0], drop = y - lo;
    foot = Math.min(foot, lo);
    const bottom = -Math.max(0, drop) - PLINTH_DEEP;
    addBox(b, 2, mx, (PLINTH_TOP + bottom) / 2, mz, hw + PLINTH_OUT, (PLINTH_TOP - bottom) / 2, hd + PLINTH_OUT, "concreteDark");
    if (drop > CAP_SHOWS) addBox(b, 1, mx, CAP_TOP - CAP_H, mz, hw + PLINTH_OUT + CAP_OUT, CAP_H, hd + PLINTH_OUT + CAP_OUT, "concreteLight");
  }
  return foot === Infinity ? y : foot;
}

/**
 * A stoop: a landing at the door and steps down from it to the ground in front, a door and a half wide, each tread a
 * box from under the ground up to its top; a cheek either side sloping down with the flight.
 */
export function stoopSteps(b: Build, height: CityHeight, rise: number): void {
  if (rise <= 0) return;
  const s = b.site, y = b.frame.y ?? 0, z0 = s.z + s.hd, hw = 1.4, n = Math.max(1, Math.round(rise / RISER)), riser = rise / n;
  const groundUnder = (za: number, zb: number, w: number): number => { const [wx, , wz] = toWorld(b, s.x, 0, (za + zb) / 2); return height.under(wx, wz, w, (zb - za) / 2, b.frame.yaw)[0] - y; };
  // (Tread k's top is k risers under the floor: the landing, k = 0, level with it.)
  let end = z0;
  for (let k = 0; k < n; k += 1) {
    const top = -k * riser, za = k ? z0 + LANDING + (k - 1) * TREAD : z0, zb = za + (k ? TREAD : LANDING), ground = groundUnder(za, zb, hw);
    if (top - 0.05 <= ground) break;
    const bottom = ground - 0.15;
    addBox(b, 1, s.x, (top + bottom) / 2, (za + zb) / 2, hw, (top - bottom) / 2, (zb - za) / 2, "concreteLight");
    end = zb;
  }
  if (end <= z0) return;
  // (The cheeks: wedges, full height at the door, their foot at the flight's end.)
  const bottom = groundUnder(z0, end, hw + 0.24) - 0.15, hi = 0.35, lowTop = -rise + 0.35 + riser;
  const H = hi - bottom, lo = Math.max(0.05, Math.min(1, (lowTop - bottom) / H));
  for (const side of [-1, 1]) addBox(b, 1, s.x + side * (hw + 0.12), bottom + H / 2, (z0 + end) / 2, 0.12, H / 2, (end - z0) / 2, "concreteDark", { wedge: true, lo });
}

/** A solid's plan in the building's frame (an axis-aligned box round it), its bottom and top over the floor. */
interface Plan { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }
function planOf(b: Build, s: Solid): Plan | null {
  const y = b.frame.y ?? 0;
  if (s.box) {
    const B = s.box, [fx, fz] = toFrame(b, B.c[0]!, B.c[2]!), r = (B.yaw ?? 0) - b.frame.yaw, c = Math.abs(dcos(r)), sn = Math.abs(dsin(r));
    const ex = c * B.h[0]! + sn * B.h[2]!, ez = sn * B.h[0]! + c * B.h[2]!;
    return { x0: fx - ex, x1: fx + ex, z0: fz - ez, z1: fz + ez, y0: B.c[1]! - B.h[1]! - y, y1: B.c[1]! + B.h[1]! - y };
  }
  if (s.capsule) {
    const C = s.capsule, [ax, az] = toFrame(b, C.a[0]!, C.a[2]!), [bx, bz] = toFrame(b, C.b[0]!, C.b[2]!);
    return { x0: Math.min(ax, bx) - C.r, x1: Math.max(ax, bx) + C.r, z0: Math.min(az, bz) - C.r, z1: Math.max(az, bz) + C.r, y0: Math.min(C.a[1]!, C.b[1]!) - C.r - y, y1: Math.max(C.a[1]!, C.b[1]!) + C.r - y };
  }
  return null;
}

const overlaps = (p: Plan, q: { x0: number; x1: number; z0: number; z1: number }, pad = 0): boolean => p.x0 < q.x1 + pad && q.x0 < p.x1 + pad && p.z0 < q.z1 + pad && q.z0 < p.z1 + pad;

/** A solid moved up (or down) by dy. */
function lift(s: Solid, dy: number): Solid {
  if (s.box) return { ...s, box: { ...s.box, c: [s.box.c[0]!, s.box.c[1]! + dy, s.box.c[2]!] } };
  if (s.capsule) return { ...s, capsule: { ...s.capsule, a: [s.capsule.a[0]!, s.capsule.a[1]! + dy, s.capsule.a[2]!], b: [s.capsule.b[0]!, s.capsule.b[1]! + dy, s.capsule.b[2]!] } };
  return s;
}

/**
 * Set what stands free on the lot down on the terrace. A solid is the BUILDING's (left at the floor) where its plan
 * touches a building mass's (a sign on its wall, an awning, its bay doors, its roof kit); a thin slab laid on the
 * ground (a car park, an apron, a park's lawn and paths) follows the ground under it -- level where it's level, a wedge
 * where it slopes; everything else is gathered into what touches in plan (a canopy and its posts, a pylon and its
 * sign, a car's body and glass) and each lot of it moved to the ground at its middle, its posts reaching down to the
 * ground under each. The plants, ad faces and anchors standing among them go with them.
 */
export function settle(b: Build, height: CityHeight): void {
  const f = b.frame, y = f.y ?? 0;
  const built = groundMasses(b).map((m) => ({ x0: m.x - m.hw, x1: m.x + m.hw, z0: m.z - m.hd, z1: m.z + m.hd }));
  const onBuilding = (p: Plan, pad: number): boolean => built.some((q) => overlaps(p, q, pad));
  const ground = (fx: number, fz: number): number => { const [wx, , wz] = toWorld(b, fx, 0, fz); return height.heightAt(wx, wz) - y; };
  const free: { k: number; p: Plan }[] = [], pieces: Solid[] = [];
  b.solids.forEach((s, k) => {
    if (level.has(s)) return;
    const p = planOf(b, s);
    if (!p) return;
    // A slab on the ground, mostly clear of the building: follows the ground.
    const B = s.box;
    if (B && B.kind !== "wedge" && p.y0 > -0.08 && p.y1 < 0.2 && B.h[0]! >= 0.9 && B.h[2]! >= 0.9) {
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      if (!built.some((q) => cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1)) { const [first, ...rest] = slabsOn(b, s, B, height); b.solids[k] = first!; pieces.push(...rest); return; }
    }
    if (onBuilding(p, 0.6)) return;
    free.push({ k, p });
  });
  // Clusters: what touches in plan, bucketed by 4 m cells.
  const parent = free.map((_, i) => i), find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const cells = new Map<string, number[]>(), CELL = 4;
  free.forEach(({ p }, i) => {
    for (let gx = Math.floor(p.x0 / CELL); gx <= Math.floor(p.x1 / CELL); gx += 1) for (let gz = Math.floor(p.z0 / CELL); gz <= Math.floor(p.z1 / CELL); gz += 1) {
      const key = `${gx},${gz}`, l = cells.get(key);
      if (l) { for (const j of l) if (find(j) !== find(i) && overlaps(p, free[j]!.p, 0.02)) parent[find(j)] = find(i); l.push(i); } else cells.set(key, [i]);
    }
  });
  const groups = new Map<number, { x0: number; x1: number; z0: number; z1: number; dy: number }>();
  free.forEach(({ p }, i) => {
    const r = find(i), g = groups.get(r);
    if (!g) groups.set(r, { x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, dy: 0 });
    else { g.x0 = Math.min(g.x0, p.x0); g.x1 = Math.max(g.x1, p.x1); g.z0 = Math.min(g.z0, p.z0); g.z1 = Math.max(g.z1, p.z1); }
  });
  for (const g of groups.values()) g.dy = ground((g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2);
  free.forEach(({ k, p }, i) => {
    const g = groups.get(find(i))!;
    let s = lift(b.solids[k]!, g.dy);
    // (A post standing on the ground reaches down -- or is trimmed up -- to the ground under it, its top where it was.)
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, post = Math.max(p.x1 - p.x0, p.z1 - p.z0) <= 0.9 && p.y1 - p.y0 >= 1 && p.y0 < 0.1;
    if (post) s = stand(s, ground(cx, cz) + y + p.y0 - 0.02);
    b.solids[k] = s;
  });
  b.solids.push(...pieces);
  const shiftAt = (fx: number, fz: number): number => {
    for (const g of groups.values()) if (fx >= g.x0 && fx <= g.x1 && fz >= g.z0 && fz <= g.z1) return g.dy;
    const p = { x0: fx, x1: fx, z0: fz, z1: fz, y0: 0, y1: 0 };
    return onBuilding(p, 0.6) ? 0 : ground(fx, fz);
  };
  for (let k = 0; k < b.plants.length; k += 1) { const q = b.plants[k]!, [fx, fz] = toFrame(b, q.x, q.z); b.plants[k] = { ...q, y: q.y + shiftAt(fx, fz) }; }
  for (let k = 0; k < b.ads.length; k += 1) { const q = b.ads[k]!, [fx, fz] = toFrame(b, q.pos[0], q.pos[2]); b.ads[k] = { ...q, pos: [q.pos[0], q.pos[1] + shiftAt(fx, fz), q.pos[2]] }; }
  for (let k = 0; k < b.anchors.length; k += 1) { const q = b.anchors[k]!, [fx, fz] = toFrame(b, q.x, q.z); b.anchors[k] = { ...q, y: q.y + shiftAt(fx, fz) }; }
}

/** A post with its foot at world height `foot` (its top kept). */
function stand(s: Solid, foot: number): Solid {
  if (s.box) {
    const B = s.box, top = B.c[1]! + B.h[1]!;
    if (top - foot < 0.2) return s;
    return { ...s, box: { ...B, c: [B.c[0]!, (top + foot) / 2, B.c[2]!], h: [B.h[0]!, (top - foot) / 2, B.h[2]!] } };
  }
  if (s.capsule) {
    const C: BakeCapsule = s.capsule, low = C.a[1]! <= C.b[1]! ? "a" : "b", end = C[low], y = foot + C.r;
    if (Math.max(C.a[1]!, C.b[1]!) - y < 0.2) return s;
    return { ...s, capsule: { ...C, [low]: [end[0]!, y, end[2]!] } };
  }
  return s;
}

/** The most a slab laid on the ground spans (m) before it's laid in pieces, each following the ground under it. */
const TILE = 12;

/** A slab in pieces no more than TILE across, each set on the ground under it (slabOn). */
function slabsOn(b: Build, s: Solid, B: BakeBox, height: CityHeight): Solid[] {
  const w = B.h[0]!, d = B.h[2]!, nx = Math.max(1, Math.ceil((2 * w) / TILE)), nz = Math.max(1, Math.ceil((2 * d) / TILE));
  if (nx === 1 && nz === 1) return [slabOn(b, s, B, height)];
  const yaw = B.yaw ?? 0, c = dcos(yaw), sn = dsin(yaw), out: Solid[] = [];
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < nz; j += 1) {
    const u = -w + (w / nx) * (2 * i + 1), v = -d + (d / nz) * (2 * j + 1);
    const piece: BakeBox = { ...B, c: [B.c[0]! + u * c + v * sn, B.c[1]!, B.c[2]! - u * sn + v * c], h: [w / nx, B.h[1]!, d / nz] };
    out.push(slabOn(b, { ...s, box: piece }, piece, height));
  }
  return out;
}

/**
 * A thin slab on the ground, set on the terrace under it: the ground under it fitted with a plane (least squares over
 * nine points); level on it where it's level, else a wedge rising the way the ground does along whichever of its axes
 * it slopes most, its top that far over the plane at each end.
 */
function slabOn(b: Build, s: Solid, B: BakeBox, height: CityHeight): Solid {
  const y = b.frame.y ?? 0, yaw = B.yaw ?? 0, c = dcos(yaw), sn = dsin(yaw), w = B.h[0]!, d = B.h[2]!, cx = B.c[0]!, cz = B.c[2]!;
  let m = 0, ax = 0, az = 0, low = Infinity;
  for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
    const g = height.heightAt(cx + u * w * c + v * d * sn, cz - u * w * sn + v * d * c);
    m += g / 9; ax += (u * g) / 6; az += (v * g) / 6; low = Math.min(low, g);
  }
  const y0 = B.c[1]! - B.h[1]! - y, t = 2 * B.h[1]!;
  if (2 * Math.max(Math.abs(ax), Math.abs(az)) <= FLAT) return { ...s, box: { ...B, c: [cx, B.c[1]! + m - y, cz] } };
  // (The wedge's foot -- lo of its height -- is at its local +z, its full height at -z: turned so -z is uphill.)
  const zMost = Math.abs(az) >= Math.abs(ax), rise = zMost ? az : ax, other = zMost ? ax : az;
  const turn = zMost ? (rise < 0 ? 0 : Math.PI) : (rise < 0 ? Math.PI / 2 : -Math.PI / 2);
  const bottom = Math.min(low, m - Math.abs(rise) - Math.abs(other)) + y0 - 0.1, top = m + Math.abs(rise) + y0 + t, H = top - bottom;
  const lo = (m - Math.abs(rise) + y0 + t - bottom) / H, hw = zMost ? w : d, hd = zMost ? d : w;
  return { ...s, box: { ...B, kind: "wedge", lo, yaw: yaw + turn, c: [cx, bottom + H / 2, cz], h: [hw, H / 2, hd] } };
}
