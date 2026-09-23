// Zoning: what a city decides before any one lot draws its building -- the
// way a real one grows. Each district's landmark lot; whole blocks kept as a
// park, and (in some cities) a lake in a ring of park; the buildings a city or
// a district has one of (a stadium on its biggest lot, a hospital, a fire
// station a district, a substation where the industry is); and the blend at
// district borders, where a lot near a district of another kind draws that
// kind's buildings too and its storeys lean to that kind's -- downtown steps
// down into midtown, midtown into the suburbs, the strip bleeds into both.
// A pure function of the catalogue and the city's lots (never their geometry).

import { drawsFor } from "@keel-engine/city";
import type { DistrictKind, Draws, Lot } from "@keel-engine/city";
import { dcos, dsin } from "@keel-engine/core";
import { frameOf } from "./frame.ts";
import type { Frame } from "./frame.ts";
import type { Archetype, Catalogue, CityLike } from "./types.ts";

/** An axis-aligned box in a block's own frame (its lots' axes, from its middle). */
export interface Rect { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number }
export type FeatureKind = "pond" | "fountain" | "playground" | "bandstand";
/** A park's piece, where it stands in the block (u, v), how much room it takes, and the lot that draws it. */
export interface Feature { readonly u: number; readonly v: number; readonly r: number; readonly kind: FeatureKind; readonly lot: string }

/** A block kept whole as a park or a lake: its box, its water, its lots' boxes, its pieces -- in the block's frame. */
export interface CommonsBlock {
  readonly block: number;
  readonly role: "park" | "lake";
  readonly rect: Rect;
  readonly water: Rect | null;
  /** The block's middle (world) and its axes' turn. */
  readonly cx: number;
  readonly cz: number;
  readonly yaw: number;
  readonly lots: ReadonlyMap<string, Rect>;
  readonly features: readonly Feature[];
  /** A lake's pier: its root on the shore (u, v), which way it runs (a unit step), its length, and the lot that has it. */
  readonly pier: { readonly u: number; readonly v: number; readonly du: number; readonly dv: number; readonly len: number; readonly lot: string } | null;
  readonly D: Draws;
}
/** A commons lot's building: its block, and its own middle in the block's frame. The lake's surface over its floor (m). */
export interface CommonsSite { readonly info: CommonsBlock; readonly u: number; readonly v: number; readonly level: number }

/** A lot near a district of another kind: that kind, how much it leans to it (0..max), and that kind's storeys. */
export interface Blend { readonly kind: DistrictKind; readonly t: number; readonly band: readonly [number, number] }

export interface Zoning {
  /** Each district's landmark lot (district -> lot key). */
  readonly landmarks: ReadonlyMap<number, string>;
  readonly commons: ReadonlyMap<number, CommonsBlock>;
  /** Lots given a unique building (lot key -> archetype id). */
  readonly assigned: ReadonlyMap<string, string>;
  readonly blend: ReadonlyMap<string, Blend>;
}

export const drawsOf = (city: CityLike, lot: Lot): Draws => drawsFor(city.site.seed, `bldg|${lot.key}`);

/** Whether a lot can hold an archetype. */
export const fits = (a: Archetype, f: Frame, lot: Lot): boolean =>
  f.hw * 2 >= a.fits.minFront && f.hd * 2 >= a.fits.minDepth && (!a.fits.corner || lot.fronts.length >= 2);

const kindOf = (city: CityLike, l: Lot): DistrictKind => city.districts[l.district]?.kind ?? "suburb";
const area = (l: Lot): number => l.obb.hw * l.obb.hd;
/** Bigger first, then by key: a stable order. */
const bigger = (a: Lot, b: Lot): number => area(b) - area(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const cache = new WeakMap<readonly Lot[], WeakMap<Catalogue, Zoning>>();

/** The city's zoning under a catalogue (made once, then looked up). */
export function zoningOf(cat: Catalogue, city: CityLike): Zoning {
  let byCat = cache.get(city.lots);
  if (!byCat) { byCat = new WeakMap(); cache.set(city.lots, byCat); }
  let z = byCat.get(cat);
  if (!z) { z = zone(cat, city); byCat.set(cat, z); }
  return z;
}

function zone(cat: Catalogue, city: CityLike): Zoning {
  const lots = city.lots, seed = city.site.seed;
  // A district's landmark lot: of its lots big enough (20 m each way), the one its seeded draw ranks first.
  const landmarks = new Map<number, string>(), best = new Map<number, number>();
  for (const l of lots) {
    const f = frameOf(l);
    if (l.height[1] <= 0 || Math.min(f.hw, f.hd) < 10) continue;
    const u = drawsOf(city, l).u("landmark");
    if (u < (best.get(l.district) ?? Infinity)) { best.set(l.district, u); landmarks.set(l.district, l.key); }
  }
  const taken = new Set<string>(cat.landmark ? landmarks.values() : []);
  const commons = cat.commons ? commonsOf(cat, city, taken) : new Map<number, CommonsBlock>();
  for (const c of commons.values()) for (const k of c.lots.keys()) taken.add(k);
  // The unique buildings, in the catalogue's order: each rule's lot is gone before the next looks.
  const assigned = new Map<string, string>();
  for (const rule of cat.uniques ?? []) {
    const a = cat.archetypes.find((x) => x.id === rule.archetype);
    if (!a) continue;
    const cands = lots.filter((l) => !taken.has(l.key) && l.height[1] > 0 && l.use !== "yard" && rule.districts.includes(kindOf(city, l))
      && fits(a, frameOf(l), l) && (!rule.roads || l.fronts.some((f) => rule.roads!.includes(f.cls))));
    const groups = new Map<number, Lot[]>();
    if (rule.per === "city") groups.set(-1, cands);
    else {
      const size = new Map<number, number>();
      for (const l of lots) size.set(l.district, (size.get(l.district) ?? 0) + 1);
      for (const l of cands) if ((size.get(l.district) ?? 0) >= (rule.minLots ?? 0)) { const g = groups.get(l.district) ?? []; g.push(l); groups.set(l.district, g); }
    }
    for (const g of groups.values()) {
      if (!g.length) continue;
      const pick = rule.largest ? [...g].sort(bigger)[0]! : g.reduce((p, l) => (drawsOf(city, l).u(`unique|${a.id}`) < drawsOf(city, p).u(`unique|${a.id}`) ? l : p));
      assigned.set(pick.key, a.id); taken.add(pick.key);
    }
  }
  return { landmarks, commons, assigned, blend: blendOf(cat, city) };
}

/** The border blend: every lot's nearest lot of another district kind, if it's within reach. */
function blendOf(cat: Catalogue, city: CityLike): Map<string, Blend> {
  const reach = cat.blend?.reach ?? 80, max = cat.blend?.max ?? 0.55, lots = city.lots, out = new Map<string, Blend>();
  // (A kind's storeys: its ordinary lots' band -- a garage's or a yard's is its own.)
  const band = new Map<DistrictKind, readonly [number, number]>();
  for (const l of lots) { const k = kindOf(city, l); if (!band.has(k) && l.use !== "garage" && l.use !== "yard" && l.height[1] > 0) band.set(k, l.height); }
  const kinds = lots.map((l) => kindOf(city, l)), rad = lots.map((l) => Math.min(l.obb.hw, l.obb.hd));
  lots.forEach((l, i) => {
    let near = Infinity, at = -1;
    for (let j = 0; j < lots.length; j += 1) {
      if (kinds[j] === kinds[i]) continue;
      const m = lots[j]!, dx = m.obb.x - l.obb.x, dz = m.obb.z - l.obb.z;
      const d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - rad[i]! - rad[j]!);
      if (d < near) { near = d; at = j; }
    }
    if (at < 0 || near >= reach) return;
    const k = kinds[at]!;
    out.set(l.key, { kind: k, t: max * (1 - near / reach), band: band.get(k) ?? lots[at]!.height });
  });
  return out;
}

/** The commons: whole blocks kept as parks, and a city's lake. */
function commonsOf(cat: Catalogue, city: CityLike, taken: ReadonlySet<string>): Map<number, CommonsBlock> {
  const spec = cat.commons!, C = drawsFor(city.site.seed, "commons");
  const byBlock = new Map<number, Lot[]>();
  for (const l of city.lots) { const g = byBlock.get(l.block) ?? []; g.push(l); byBlock.set(l.block, g); }
  const ids = [...byBlock.keys()].sort((a, b) => a - b);
  // (A block with a yard kept in it, or its district's landmark, stays as it is.)
  const eligible = ids.filter((id) => byBlock.get(id)!.every((l) => l.use !== "yard" && l.height[1] > 0 && !taken.has(l.key)));
  const kind = (id: number): DistrictKind => kindOf(city, byBlock.get(id)![0]!);
  const frameOfBlock = (id: number) => blockFrame(byBlock.get(id)!);
  const out = new Map<number, CommonsBlock>();
  // (Never more than a seventh of the city's lots, nor more than a third of a district's: a park is part of a place.)
  const budget = Math.max(6, Math.floor(city.lots.length / 7)), perDistrict = new Map<number, number>(), used = new Map<number, number>();
  for (const l of city.lots) perDistrict.set(l.district, (perDistrict.get(l.district) ?? 0) + 1);
  let spent = 0;
  const room = (id: number): boolean => {
    const ls = byBlock.get(id)!, d = ls[0]!.district;
    return ls.length <= 12 && spent + ls.length <= budget && (used.get(d) ?? 0) + ls.length <= Math.max(4, (perDistrict.get(d) ?? 0) / 3);
  };
  const take = (id: number, role: "park" | "lake"): void => {
    const ls = byBlock.get(id)!, c = commonsBlock(id, ls, role, city.site.seed);
    out.set(id, c);
    spent += ls.length; used.set(ls[0]!.district, (used.get(ls[0]!.district) ?? 0) + ls.length);
  };
  // The lake: a seeded block in the suburbs, midtown, the strip or the old town, and up to two of its neighbours.
  const LAKE: Partial<Record<DistrictKind, number>> = { suburb: 1, midtown: 0.8, strip: 0.6, oldtown: 0.4 };
  if (C.u("lake") < spec.lake) {
    const cands = eligible.filter((id) => (LAKE[kind(id)] ?? 0) > 0 && Math.min(...span(frameOfBlock(id).rect)) >= 36 && room(id));
    const first = [...cands].sort((a, b) => C.u("lakeSeed", a) / LAKE[kind(a)]! - C.u("lakeSeed", b) / LAKE[kind(b)]! || a - b)[0];
    if (first !== undefined) {
      const f0 = frameOfBlock(first), more = Math.floor(C.u("lakeBlocks") * 3);
      const near = cands.filter((id) => id !== first).map((id) => { const f = frameOfBlock(id); return { id, d: Math.sqrt((f.cx - f0.cx) ** 2 + (f.cz - f0.cz) ** 2) }; })
        .filter((n) => n.d < 200).sort((a, b) => a.d - b.d || a.id - b.id).slice(0, more);
      for (const id of [first, ...near.map((n) => n.id)]) if (id === first || room(id)) take(id, "lake");
    }
  }
  // The parks: each block by its district kind's chance; every city has at least one.
  for (const id of eligible) if (!out.has(id) && C.u("park", id) < (spec.park[kind(id)] ?? 0) && room(id)) take(id, "park");
  if (![...out.values()].some((c) => c.role === "park")) {
    // (Where people live first: the suburbs, midtown, the old town; the smaller block, then the draw.)
    const PREFER: Partial<Record<DistrictKind, number>> = { suburb: 0, midtown: 1, oldtown: 2, strip: 3, core: 5 };
    const rank = (id: number): number => PREFER[kind(id)] ?? 4;
    const id = eligible.filter((i) => !out.has(i) && room(i)).sort((a, b) => rank(a) - rank(b) || byBlock.get(a)!.length - byBlock.get(b)!.length || C.u("park", a) - C.u("park", b))[0];
    if (id !== undefined) take(id, "park");
  }
  return out;
}

const span = (r: Rect): [number, number] => [r.x1 - r.x0, r.z1 - r.z0];

/** A block's frame: its lots' axes, its middle, its box, and each lot's box in it. */
function blockFrame(lots: readonly Lot[]): { cx: number; cz: number; yaw: number; rect: Rect; lots: Map<string, Rect> } {
  const yaw = lots[0]!.obb.yaw, c = dcos(yaw), s = dsin(yaw);
  // (World to the lots' axes: the inverse of a frame's turn.)
  const local = lots.map((l) => [l.obb.x * c - l.obb.z * s, l.obb.x * s + l.obb.z * c] as const);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  lots.forEach((l, i) => { const [u, v] = local[i]!; x0 = Math.min(x0, u - l.obb.hw); x1 = Math.max(x1, u + l.obb.hw); z0 = Math.min(z0, v - l.obb.hd); z1 = Math.max(z1, v + l.obb.hd); });
  const mu = (x0 + x1) / 2, mv = (z0 + z1) / 2;
  const boxes = new Map<string, Rect>();
  lots.forEach((l, i) => { const [u, v] = local[i]!; boxes.set(l.key, { x0: u - mu - l.obb.hw, x1: u - mu + l.obb.hw, z0: v - mv - l.obb.hd, z1: v - mv + l.obb.hd }); });
  return { cx: mu * c + mv * s, cz: -mu * s + mv * c, yaw, rect: { x0: x0 - mu, x1: x1 - mu, z0: z0 - mv, z1: z1 - mv }, lots: boxes };
}

const inside = (r: Rect, u: number, v: number): boolean => u >= r.x0 && u < r.x1 && v >= r.z0 && v < r.z1;

function commonsBlock(id: number, lots: readonly Lot[], role: "park" | "lake", seed: string): CommonsBlock {
  const D = drawsFor(seed, `commons|${id}`), f = blockFrame(lots), R = f.rect;
  const order = [...lots].sort(bigger);
  let water: Rect | null = null;
  if (role === "lake") {
    const shore = 6 + 3 * D.u("shore");
    water = { x0: R.x0 + shore, x1: R.x1 - shore, z0: R.z0 + shore, z1: R.z1 - shore };
    if (Math.min(...span(water)) < 14) { water = null; role = "park"; }
  }
  const features: Feature[] = [];
  order.forEach((l, k) => {
    const r = f.lots.get(l.key)!, u = (r.x0 + r.x1) / 2, v = (r.z0 + r.z1) / 2, room = Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2 - 1.5;
    if (water && inside({ x0: water.x0 - 4, x1: water.x1 + 4, z0: water.z0 - 4, z1: water.z1 + 4 }, u, v)) return;
    const roll = D.u("feature", k);
    const kind: FeatureKind | null = k === 0 && !water ? (roll < 0.5 ? "pond" : "fountain") : roll < 0.35 ? "playground" : roll < 0.6 ? "bandstand" : null;
    const size = kind === "pond" ? 6 : kind === "playground" ? 5 : kind === "bandstand" ? 3.8 : 3.4;
    if (!kind || room < size) return;
    // (A piece stands beside the paths across the park, not on them: pushed off whichever one it's on, if there's room.)
    const off = (c: number, lo: number, hi: number, side: number): number => {
      if (Math.abs(c) > size + 1) return c;
      const at = side * (size + 1.2);
      return at - size >= lo + 1 && at + size <= hi - 1 ? at : c;
    };
    const side = k % 2 ? 1 : -1;
    features.push({ u: k ? off(u, r.x0, r.x1, side) : u, v: k ? off(v, r.z0, r.z1, side) : v, r: size, kind, lot: l.key });
  });
  let pier: CommonsBlock["pier"] = null;
  if (water) {
    // (The pier: out from the middle of one of the lake's sides, owned by the lot its root is in.)
    const side = Math.floor(D.u("pierSide") * 4), t = 0.3 + 0.4 * D.u("pierAt");
    const u = side < 2 ? water.x0 + (water.x1 - water.x0) * t : side === 2 ? water.x0 : water.x1;
    const v = side === 0 ? water.z0 : side === 1 ? water.z1 : water.z0 + (water.z1 - water.z0) * t;
    const du = side === 2 ? 1 : side === 3 ? -1 : 0, dv = side === 0 ? 1 : side === 1 ? -1 : 0;
    const len = Math.min(14, 0.35 * (du ? water.x1 - water.x0 : water.z1 - water.z0));
    const owner = order.find((l) => inside(f.lots.get(l.key)!, u - du * 0.5, v - dv * 0.5));
    if (owner) pier = { u, v, du, dv, len, lot: owner.key };
  }
  return { block: id, role, rect: R, water, cx: f.cx, cz: f.cz, yaw: f.yaw, lots: f.lots, features, pier, D };
}
