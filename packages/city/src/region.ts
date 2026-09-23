// The land round a city, out to the horizon: what you see past its edge from a car. A city stands in a REGION --
// farmland on one bearing, forested hills on another, the sea or a range of mountains, a river valley, the next
// town's water tower and a metro's skyline on the horizon, freeways and a rail line out to them on viaducts where the
// land drops, pylons marching across the fields to the power station, an airport's runway lights, a wind farm on the
// ridge. None of it is driven (the city's road graph ends at its slab); all of it is a pure function of the city.
//
// Planned the way a region grows: the sectors first (what the land IS on each bearing, the site's own edge traits
// first among them), then the water (a sea, lakes, a river down its valley), then the towns where the land lets them
// stand, then the roads that join them to the city, then the things roads and towns bring -- the power station and
// its lines, the airport, the farms along the country roads, the truck stop at the freeway, the golf course and the
// regional park on the city's edge. Heights include the roads' grading, so a freeway runs in its cutting and on its
// embankment instead of through the hills.
//
// In a world of cities (site.cell), the land is keyed by the WORLD's seed and world coordinates, so two neighbours'
// regions are one land; their towns and roads are still each city's own.

import { datan2, dcos, dexp, dhypot, dpow, dsin, fbm2, hash2 } from "@keel-engine/core";
import { blockCentre } from "./districts.ts";
import { drawsFor } from "./site.ts";
import { SEA_LEVEL, groundAt } from "./terrain.ts";
import type { City, EdgeTrait } from "./types.ts";
import { VENUE_BOX, VENUE_KINDS, filletPath, nearsSelf, placeCourse, rallyControls, rallyProfile, venueLayout, venueLocal } from "./venues.ts";
import type { RallyStage, Venue, VenueKind } from "./venues.ts";
import type { Airport, Lake, Region, RegionGround, RegionLand, RegionLine, RegionRoad, RegionRoadKind, RegionSector, RegionSite, RegionSky, RegionWater, River, Settlement, SettlementKind, SiteKind } from "./region-types.ts";

export type * from "./region-types.ts";

/** How far a region reaches (m): past the fog, to the horizon's ranges. */
export const REGION_REACH = 9000;

const TAU = Math.PI * 2;
const apart = (a: number, b: number): number => { const d = (((a - b) % TAU) + TAU) % TAU; return d > Math.PI ? TAU - d : d; };
const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ramp = (v: number, a: number, b: number): number => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fnv = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0;
};
const bearingOf = (x: number, z: number): number => datan2(x, z);
const at = (a: number, d: number): [number, number] => [dsin(a) * d, dcos(a) * d];

/** Per edge trait, the land it becomes out in the region. */
const TRAIT_LAND: Readonly<Record<EdgeTrait, RegionLand>> = { ocean: "ocean", mountain: "mountains", river: "valley", desert: "desert", forest: "forest" };
/** What an open bearing tends to be (weights), before sprawl takes its share. */
const OPEN_LAND: readonly (readonly [RegionLand, number])[] = [["farmland", 3], ["hills", 3], ["plains", 2], ["forest", 2.5], ["mountains", 1.2], ["desert", 0.4]];

/** A nearest point on a polyline: its distance, and the sample it's nearest. */
function nearestOn(xs: readonly number[] | Float64Array, zs: readonly number[] | Float64Array, x: number, z: number): { d: number; i: number; t: number } {
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const ax = xs[i]!, az = zs[i]!, dx = xs[i + 1]! - ax, dz = zs[i + 1]! - az, l2 = dx * dx + dz * dz || 1;
    const t = sat(((x - ax) * dx + (z - az) * dz) / l2), px = ax + dx * t - x, pz = az + dz * t - z, d = px * px + pz * pz;
    if (d < best) { best = d; bi = i; bt = t; }
  }
  return { d: Math.sqrt(best), i: bi, t: bt };
}

/** A bucket grid over road segments (road id, first sample), so a height lookup only walks the segments near it. */
class Buckets {
  readonly cell = 120;
  readonly map = new Map<number, number[]>();
  key(x: number, z: number): number { return (Math.floor(x / this.cell) + 4096) * 8192 + (Math.floor(z / this.cell) + 4096); }
  add(x: number, z: number, id: number, i: number): void {
    const k = this.key(x, z), l = this.map.get(k);
    if (l) l.push(id, i); else this.map.set(k, [id, i]);
  }
  near(x: number, z: number): number[] {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const l = this.map.get(this.key(x + dx * this.cell, z + dz * this.cell));
      if (l) for (const v of l) out.push(v);
    }
    return out;
  }
}

/** The region round a city. Made once a city (regionOf). */
export function cityRegion(city: City): Region {
  const site = city.site, D = drawsFor(site.seed, "region");
  // (The land is the world's where the city is a cell of one -- neighbours share it -- else the city's own.)
  const landSeed = fnv(site.cell ? `world|${site.cell.world}` : `city|${site.seed}`);
  const ox = site.cell ? site.cell.x * site.size : 0, oz = site.cell ? site.cell.z * site.size : 0;
  const N = (s: number, x: number, z: number, scale: number, oct = 4): number => fbm2((x + ox) / scale, (z + oz) / scale, landSeed + s * 7919, oct);
  const ridged = (s: number, x: number, z: number, scale: number): number => { const v = 1 - Math.abs(2 * N(s, x, z, scale, 5) - 1); return v * v; };
  const [bx0, bz0, bx1, bz1] = city.graph.bounds;
  const edge = Math.max(-bx0, bx1, -bz0, bz1) + 80;
  const reach = REGION_REACH;
  const sprawl = sat(D.u("sprawl") * 1.25 - 0.1);

  // ---- the sectors: five to seven bearings round the city, the site's edge traits first.
  const count = 5 + Math.floor(D.u("sectors") * 3), turn = D.u("turn") * TAU;
  const lands: RegionLand[] = [];
  const bearings = Array.from({ length: count }, (_, i) => turn + (i / count) * TAU + D.flat("jitter", i) * (TAU / count) * 0.2);
  const taken = new Set<number>();
  for (const e of site.edges) {
    let bi = 0, bd = Infinity;
    bearings.forEach((b, i) => { const d = apart(b, e.bearing); if (d < bd && !taken.has(i)) { bd = d; bi = i; } });
    taken.add(bi); lands[bi] = TRAIT_LAND[e.trait]; bearings[bi] = e.bearing;
    // (A coast is long: the sea takes a neighbouring bearing too, often.)
    if (e.trait === "ocean" && D.u("coast") < 0.6) { const n = (bi + (D.u("coastSide") < 0.5 ? 1 : count - 1)) % count; if (!taken.has(n)) { taken.add(n); lands[n] = "ocean"; } }
  }
  // (The sea is a common neighbour -- it suits the game -- even for a city whose own edge doesn't reach it: out past a stretch of land.)
  const open: (readonly [RegionLand, number])[] = [...OPEN_LAND, ["sprawl", 5 * sprawl], ["ocean", site.edges.some((e) => e.trait === "desert") ? 0.5 : 2.6]];
  if (site.edges.some((e) => e.trait === "desert")) open.push(["desert", 3], ["plains", 1]);
  for (let i = 0; i < count; i += 1) {
    if (taken.has(i)) continue;
    const total = open.reduce((a, [, w]) => a + w, 0);
    let u = D.u("land", i) * total, pick: RegionLand = "plains";
    for (const [l, w] of open) { u -= w; if (u <= 0) { pick = l; break; } }
    lands[i] = pick;
  }
  const sectors: RegionSector[] = bearings.map((bearing, i) => ({
    bearing, land: lands[i]!, ...(lands[i] === "ocean" && !taken.has(i) ? { shore: 700 + 1300 * D.u("shore", i) } : {}),
    // (The horizon's ranges: most bearings have mountains standing on the skyline, higher behind mountains.)
    backdrop: lands[i] === "ocean" ? 0 : lands[i] === "mountains" ? 600 : D.u("backdropOn", i) < 0.72 ? 150 + 450 * D.u("backdrop", i) : 0,
  }));
  const sigma = (TAU / count) * 0.42;
  /** Each sector's weight at a bearing (normalized), the bearing wobbled by the land so the borders aren't spokes. */
  const weights = (x: number, z: number, out: number[]): void => {
    const a = bearingOf(x, z) + (N(11, x, z, 2200, 3) - 0.5) * 0.9;
    let s = 0;
    for (let i = 0; i < count; i += 1) { const d = apart(a, sectors[i]!.bearing) / sigma; const w = dexp(-d * d); out[i] = w; s += w; }
    for (let i = 0; i < count; i += 1) out[i] = out[i]! / (s || 1);
  };

  // ---- the river: down its valley from the horizon to the city's edge, meandering.
  const valley = sectors.findIndex((s) => s.land === "valley");
  let river: River | null = null;
  if (valley >= 0) {
    const b = sectors[valley]!.bearing, xs: number[] = [], zs: number[] = [];
    for (let d = edge - 200; d <= reach + 400; d += 180) {
      const wob = (N(21, d, 0, 1400, 3) - 0.5) * Math.min(900, (d - edge) * 0.5 + 60);
      const [px, pz] = at(b, d), nx = dcos(b), nz = -dsin(b);
      xs.push(px + nx * wob); zs.push(pz + nz * wob);
    }
    river = { x: xs, z: zs, width: 35 + 45 * D.u("riverWidth"), level: 0.2 };
  }
  // (The sea that matters is the city's own coast, if it has one; else the nearest of the far ones.)
  const own = sectors.findIndex((s) => s.land === "ocean" && !s.shore);
  const seaIndex = own >= 0 ? own : sectors.map((s, i) => ({ s, i })).filter(({ s }) => s.land === "ocean").sort((a, b) => a.s.shore! - b.s.shore!)[0]?.i ?? -1;
  const sea = seaIndex >= 0 ? { bearing: sectors[seaIndex]!.bearing, level: SEA_LEVEL } : null;

  // ---- the land's own height at a point (before lakes and roads).
  const w: number[] = new Array(count).fill(0);
  const landHeight = (land: RegionLand, x: number, z: number, e: number, shore = 0): number => {
    switch (land) {
      case "plains": return 1.5 + 6 * N(1, x, z, 700);
      case "farmland": return 1 + 3.5 * N(2, x, z, 900);
      case "sprawl": return 1 + 5 * N(3, x, z, 800);
      case "hills": return 2 + ramp(e, 0, 900) * (8 + 85 * dpow(N(4, x, z, 1000), 1.6));
      case "forest": return 2 + ramp(e, 0, 700) * (6 + 45 * dpow(N(5, x, z, 850), 1.3));
      case "mountains": return ramp(e, 0, 1300) * (20 + 90 * N(6, x, z, 900)) + ramp(e, 500, 3200) * 560 * ridged(7, x, z, 1700);
      case "desert": {
        const dunes = 5 * Math.abs(dsin((x + z) / 90 + 6 * N(8, x, z, 400))) * N(9, x, z, 600);
        const mesa = N(10, x, z, 1900) > 0.6 ? Math.min(1, (N(10, x, z, 1900) - 0.6) * 12) : 0;
        return 1 + dunes + ramp(e, 300, 800) * Math.floor(mesa * 3) * 28;
      }
      case "valley": {
        const d = river ? nearestOn(river.x, river.z, x, z).d : 1e9;
        return 0.6 + ramp(e, 0, 900) * ramp(d, 120, 700 + 500 * N(12, x, z, 1200)) * (40 + 240 * N(13, x, z, 1100));
      }
      case "ocean": { const o = Math.max(0, e - shore); return (shore ? 4 * (1 - ramp(e, shore - 300, shore)) : 0) - 8 * ramp(o, 0, shore ? 250 : 1) - 26 * ramp(o, 0, 1600) + 3 * N(14, x, z, 500); }
    }
  };
  /** The ranges on the horizon (m): most bearings have mountains standing on the skyline. */
  const backdropAt = (x: number, z: number, e: number): number => {
    if (e < 2800) return 0;
    weights(x, z, w);
    let back = 0;
    for (let i = 0; i < count; i += 1) back += w[i]! * sectors[i]!.backdrop;
    return ramp(e, 2800, 6200) * back * (0.35 + ridged(15, x, z, 2300));
  };
  const baseHeight = (x: number, z: number): number => {
    const r = dhypot(x, z), e = Math.max(0, r - edge);
    weights(x, z, w);
    let h = 0;
    for (let i = 0; i < count; i += 1) {
      const wi = w[i]!;
      if (wi < 0.01) continue;
      h += wi * landHeight(sectors[i]!.land, x, z, e, sectors[i]!.shore ?? 0);
    }
    return h + groundAt(site, x, z).height + backdropAt(x, z, e);
  };

  // ---- lakes: on the open land, a few kilometres out, level with the ground where they lie.
  const lakes: Lake[] = [];
  const lakeCount = Math.floor(D.u("lakes") * 3.4);
  for (let k = 0, tries = 0; k < lakeCount && tries < 40; tries += 1) {
    const b = D.u("lakeBearing", tries) * TAU, d = edge + 700 + D.u("lakeDist", tries) * 4200, [x, z] = at(b, d);
    weights(x, z, w);
    const land = sectors[w.indexOf(Math.max(...w))]!.land;
    if (land === "ocean" || land === "desert" || land === "mountains") continue;
    const r = 160 + 520 * D.u("lakeSize", tries);
    if (lakes.some((l) => dhypot(l.x - x, l.z - z) < l.r + r + 300)) continue;
    lakes.push({ x, z, r, level: baseHeight(x, z) - 0.4 });
    k += 1;
  }
  /** A lake's shore wobbles: its radius on a bearing from its middle. */
  const lakeR = (l: Lake, x: number, z: number): number => l.r * (0.8 + 0.4 * N(16, l.x + dsin(bearingOf(x - l.x, z - l.z)) * 300, l.z + dcos(bearingOf(x - l.x, z - l.z)) * 300, 260, 2));
  const wetHeight = (x: number, z: number): number => {
    let h = baseHeight(x, z);
    for (const l of lakes) {
      const d = dhypot(x - l.x, z - l.z);
      if (d > l.r * 1.7) continue;
      const R = lakeR(l, x, z);
      // (Inside: a bowl under the water; its shore rises back to the land over a third of it.)
      if (d < R) h = Math.min(h, l.level - 1 - 7 * (1 - d / R));
      else h = Math.min(h, l.level + 0.4 + (h - l.level) * ramp(d, R, R * 1.35));
    }
    if (river) {
      const { d } = nearestOn(river.x, river.z, x, z);
      if (d < river.width * 2.5) h = Math.min(h, d < river.width / 2 ? river.level - 1.8 : river.level + 0.3 + (d - river.width / 2) * 0.12);
    }
    return h;
  };

  /** The towns' own ground: each stands on a plain of its own level, the land rising back to it past its edge. */
  const settlements: Settlement[] = [];
  let airport: Airport | null = null;
  const venueList: Venue[] = [];
  const settledHeight = (x: number, z: number): number => {
    let h = wetHeight(x, z);
    for (const s of settlements) {
      const d = dhypot(x - s.x, z - s.z);
      if (d < s.r * 2.2) h = s.y + (h - s.y) * ramp(d, s.r * 1.05, s.r * 2.2);
    }
    if (airport) {
      // (Its field is levelled: the runways, the taxiways and the terminal side, the land blending back over 300 m.)
      const c = dcos(airport.yaw), sn = dsin(airport.yaw), dx = x - airport.x, dz = z - airport.z;
      const along = Math.abs(dx * sn + dz * c), across = dx * c - dz * sn;
      const w0 = -260 - airport.spacing, w1 = 520;
      const out = Math.max(along - airport.length / 2 - 250, across < w0 ? w0 - across : across > w1 ? across - w1 : 0, 0);
      if (out < 300) h = airport.y + (h - airport.y) * ramp(out, 0, 300);
    }
    // (Each venue's box is levelled, 30 m past its edge, the land blending back over 150 m.)
    for (const v of venueList) {
      const [a, b] = venueLocal(v, x, z), out = Math.max(Math.abs(a) - v.hw - 30, Math.abs(b) - v.hd - 30, 0);
      if (out < 150) h = v.y + (h - v.y) * ramp(out, 0, 150);
    }
    return h;
  };
  const flatAt = (x: number, z: number, span: number): number => {
    const hs = [[0, 0], [span, 0], [-span, 0], [0, span], [0, -span]].map(([dx, dz]) => wetHeight(x + dx!, z + dz!));
    return Math.max(...hs) - Math.min(...hs);
  };
  const wetAt = (x: number, z: number): boolean => {
    if (sea && baseHeight(x, z) < sea.level + 0.5) return true;
    for (const l of lakes) if (dhypot(x - l.x, z - l.z) < lakeR(l, x, z) + 60) return true;
    if (river && nearestOn(river.x, river.z, x, z).d < river.width + 60) return true;
    return false;
  };
  const landAtPoint = (x: number, z: number): RegionLand => { weights(x, z, w); return sectors[w.indexOf(Math.max(...w))]!.land; };

  // ---- the towns: where the land lets them stand -- dry, not too steep, apart. One far city on the skyline at least.
  const want = 3 + Math.floor(D.u("towns") * 4) + Math.round(sprawl * 3);
  for (let tries = 0; tries < 80 && settlements.length < want; tries += 1) {
    const far = settlements.length === 0;
    const b = D.u("townBearing", tries) * TAU, d = far ? 4800 + 3200 * D.u("farDist", tries) : edge + 900 + D.u("townDist", tries) * (reach - edge - 1400);
    const [x, z] = at(b, d);
    const land = landAtPoint(x, z);
    if (land === "ocean" || wetAt(x, z)) continue;
    const y = wetHeight(x, z) - backdropAt(x, z, dhypot(x, z) - edge);
    if (y > 90 || flatAt(x, z, 250) - backdropAt(x, z, dhypot(x, z) - edge) * 0.2 > 30) continue;
    const u = D.u("townKind", tries);
    const kind: SettlementKind = far || (d > 5000 && u < 0.35) ? (u < 0.5 ? "metro" : "city") : land === "sprawl" || u < 0.45 ? "town" : "village";
    const r = kind === "metro" ? 600 + 400 * u : kind === "city" ? 320 + 260 * u : kind === "town" ? 140 + 160 * u : 60 + 70 * u;
    if (settlements.some((s) => dhypot(s.x - x, s.z - z) < s.r + r + 900)) continue;
    const top = kind === "metro" ? 160 + 160 * D.u("townTop", tries) : kind === "city" ? 60 + 80 * D.u("townTop", tries) : kind === "town" ? 14 + 20 * D.u("townTop", tries) : 8;
    settlements.push({ kind, x, z, y, r, top, seed: `${site.seed}|town|${tries}` });
  }
  // (Sprawl: a string of suburbs just past the edge, where the city runs on.)
  const sprawlTowns = Math.round(sprawl * 5);
  for (let k = 0, tries = 0; k < sprawlTowns && tries < 30; tries += 1) {
    const b = D.u("sprawlBearing", tries) * TAU, d = edge + 350 + 900 * D.u("sprawlDist", tries), [x, z] = at(b, d);
    if (wetAt(x, z) || landAtPoint(x, z) === "ocean" || flatAt(x, z, 150) > 18) continue;
    if (settlements.some((s) => dhypot(s.x - x, s.z - z) < s.r + 400)) continue;
    settlements.push({ kind: "town", x, z, y: wetHeight(x, z), r: 180 + 200 * D.u("sprawlR", tries), top: 10 + 16 * D.u("sprawlTop", tries), seed: `${site.seed}|sprawl|${tries}` });
    k += 1;
  }

  // ---- the airport: every city has one -- the flattest long stretch of open land a few kilometres out, its size the
  // city's (a strip for a small one, two runways for a sprawling one).
  {
    const tierU = D.u("airTier") * 0.8 + sprawl * 0.35 + (settlements.some((s) => s.kind === "metro") ? 0.15 : 0);
    const tier: 0 | 1 | 2 = tierU < 0.35 ? 0 : tierU < 0.8 ? 1 : 2;
    const length = tier === 0 ? 1500 + 400 * D.u("airLen") : tier === 1 ? 2400 + 500 * D.u("airLen") : 3200 + 500 * D.u("airLen");
    let best: { x: number; z: number; yaw: number; score: number } | null = null;
    for (let t = 0; t < 60; t += 1) {
      const b = D.u("airB", t) * TAU, d = edge + 1300 + length * 0.4 + 3600 * D.u("airD", t), [x, z] = at(b, d), yaw = D.u("airYaw", t) * Math.PI;
      const land = landAtPoint(x, z);
      if (land === "ocean" || wetAt(x, z) || settlements.some((s) => dhypot(s.x - x, s.z - z) < s.r + length * 0.6 + 300)) continue;
      const hx = dsin(yaw) * length / 2, hz = dcos(yaw) * length / 2;
      if (wetAt(x + hx, z + hz) || wetAt(x - hx, z - hz)) continue;
      const hs = [-1, -0.5, 0, 0.5, 1].map((k) => wetHeight(x + hx * k, z + hz * k) - backdropAt(x + hx * k, z + hz * k, dhypot(x + hx * k, z + hz * k) - edge));
      const score = Math.max(...hs) - Math.min(...hs) + (land === "mountains" ? 60 : land === "hills" ? 15 : 0) + Math.max(...hs) * 0.1;
      if (!best || score < best.score) best = { x, z, yaw, score };
    }
    const a = best ?? { x: at(D.u("airFallback") * TAU, edge + 3000)[0], z: at(D.u("airFallback") * TAU, edge + 3000)[1], yaw: 0 };
    const hx = dsin(a.yaw) * length / 2, hz = dcos(a.yaw) * length / 2;
    const y = Math.max(sea ? sea.level + 3 : 0.5, [-1, 0, 1].reduce((m, k) => m + (wetHeight(a.x + hx * k, a.z + hz * k) - backdropAt(a.x + hx * k, a.z + hz * k, dhypot(a.x + hx * k, a.z + hz * k) - edge)) / 3, 0));
    airport = { x: a.x, z: a.z, y, yaw: a.yaw, length, runways: tier === 2 ? 2 : 1, spacing: tier === 2 ? 380 : 0, tier };
  }
  const port = airport!;
  /** How far past the city's own square ground a point is (m). */
  const past = (x: number, z: number): number => Math.max(Math.abs(x), Math.abs(z)) - edge;
  /** How far outside the airport's levelled field a point is (m). */
  const portC = dcos(port.yaw), portS = dsin(port.yaw);
  const airOut = (x: number, z: number): number => {
    const dx = x - port.x, dz = z - port.z;
    const along = Math.abs(dx * portS + dz * portC), across = dx * portC - dz * portS, w0 = -260 - port.spacing, w1 = 520;
    return Math.max(along - port.length / 2 - 250, across < w0 ? w0 - across : across > w1 ? across - w1 : 0, 0);
  };
  const venueTrig = new Map<Venue, [number, number, number]>();
  const inVenue = (x: number, z: number, pad: number): boolean => venueList.some((v) => {
    let t = venueTrig.get(v);
    if (!t) { t = [dcos(v.yaw), dsin(v.yaw), dhypot(v.hw, v.hd)]; venueTrig.set(v, t); }
    const dx = x - v.x, dz = z - v.z;
    if (Math.abs(dx) > t[2] + pad || Math.abs(dz) > t[2] + pad) return false;
    return Math.abs(t[0] * dx - t[1] * dz) < v.hw + pad && Math.abs(t[1] * dx + t[0] * dz) < v.hd + pad;
  });

  // ---- roads: freeways from the city's edge to the cities and off over the horizon; country roads to the towns.
  const lines0: { kind: RegionRoadKind; xs: number[]; zs: number[]; half: number }[] = [];
  const exits: number[] = [];
  const route = (kind: RegionRoadKind, x0: number, z0: number, x1: number, z1: number, half: number, s: number): { xs: number[]; zs: number[] } => {
    const len = dhypot(x1 - x0, z1 - z0), steps = Math.max(2, Math.ceil(len / 20));
    const nx = -(z1 - z0) / len, nz = (x1 - x0) / len, amp = Math.min(len * 0.12, 700);
    const xs: number[] = [], zs: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps, bend = dsin(t * Math.PI) * (N(30 + s, t * 3000, s * 97, 1200, 2) - 0.5) * 2 * amp;
      xs.push(x0 + (x1 - x0) * t + nx * bend); zs.push(z0 + (z1 - z0) * t + nz * bend);
    }
    lines0.push({ kind, xs, zs, half });
    return { xs, zs };
  };
  const fromEdge = (b: number): [number, number] => at(b, edge - 30);
  const big = settlements.filter((s) => s.kind === "metro" || s.kind === "city");
  // The city's own freeway spurs (keel/city arterials: a freeway road ending in nothing): each carries on from its end.
  const g = city.graph, deg = new Map<number, number>();
  for (const e of g.edges) for (const n of [e.a, e.b]) deg.set(n, (deg.get(n) ?? 0) + 1);
  const spurs = g.edges.filter((e) => e.cls === "freeway" && (deg.get(e.b) === 1 || deg.get(e.a) === 1)).map((e) => {
    const end = deg.get(e.b) === 1 ? e.b : e.a, n = g.nodes.find((q) => q.id === end)!;
    return { x: n.x, z: n.z, b: bearingOf(n.x, n.z), used: false };
  });
  big.forEach((s, i) => {
    const b = bearingOf(s.x, s.z);
    let best = -1, bd = 1.3;
    spurs.forEach((sp, k) => { const d = apart(sp.b, b); if (!sp.used && d < bd) { bd = d; best = k; } });
    const from = best >= 0 ? spurs[best]! : null;
    if (from) from.used = true;
    const [x0, z0] = from ? [from.x, from.z] : fromEdge(b);
    exits.push(from ? from.b : b);
    route("freeway", x0, z0, s.x, s.z, 12, i);
  });
  // (Every spur left over runs on out over the horizon along its own bearing.)
  spurs.filter((sp) => !sp.used).forEach((sp, k) => {
    const [fx, fz] = at(sp.b + D.flat("spurBend", k) * 0.35, reach + 300);
    exits.push(sp.b);
    route("freeway", sp.x, sp.z, fx, fz, 12, 30 + k);
  });
  // (One or two freeways straight out over the horizon, clear of the others: it goes somewhere you can't see.)
  const outs = spurs.length ? 0 : 1 + (D.u("outs") < 0.5 ? 1 : 0);
  for (let k = 0, tries = 0; k < outs && tries < 20; tries += 1) {
    const b = D.u("outBearing", tries) * TAU;
    if (exits.some((e) => apart(e, b) < 0.7)) continue;
    const [fx, fz] = at(b, reach + 300);
    if (landAtPoint(fx * 0.4, fz * 0.4) === "ocean") continue;
    exits.push(b);
    const [x0, z0] = fromEdge(b);
    route("freeway", x0, z0, fx, fz, 12, 10 + k);
    k += 1;
  }
  // ---- the industrial town: in about half the regions, a works town -- sheds, yards, stacks, a rail spur -- a short way
  // out, standing ON a freeway where one passes over flat dry land (the freeway runs straight down its main street), else
  // on its own with a country road run in from the city and on out through it. Its ground is a town's plain
  // (settledHeight), so it's levelled before any road's grading.
  let industry: Settlement | null = null;
  let through: { x: number; z: number; dx: number; dz: number } | null = null;
  {
    const ID = drawsFor(site.seed, "industry");
    if (ID.u("has") < 0.55) {
      const r = 200 + 140 * ID.u("r");
      const ok = (x: number, z: number): boolean => {
        if (past(x, z) < 500 || past(x, z) > 2300 || landAtPoint(x, z) === "ocean" || wetAt(x, z)) return false;
        if ([0, 1, 2, 3, 4, 5].some((k) => wetAt(x + dsin((k * TAU) / 6) * r * 1.2, z + dcos((k * TAU) / 6) * r * 1.2))) return false;
        return flatAt(x, z, r) < 16 && settlements.every((s) => dhypot(s.x - x, s.z - z) > s.r + r + 500) && airOut(x, z) > r * 2.2 + 150;
      };
      const fws = lines0.filter((l) => l.kind === "freeway");
      for (let t = 0; t < 48 && !industry && fws.length; t += 1) {
        const l = fws[Math.floor(ID.u("fw", t) * fws.length)]!, i = 2 + Math.floor(ID.u("fwI", t) * (l.xs.length - 4));
        const x = l.xs[i]!, z = l.zs[i]!;
        if (!ok(x, z)) continue;
        industry = { kind: "industrial", x, z, y: wetHeight(x, z), r, top: 18 + 14 * ID.u("top"), seed: `${site.seed}|industry` };
        const dx = l.xs[i + 1]! - l.xs[i - 1]!, dz = l.zs[i + 1]! - l.zs[i - 1]!, dl = dhypot(dx, dz) || 1;
        through = { x, z, dx: dx / dl, dz: dz / dl };
      }
      for (let t = 0; t < 48 && !industry; t += 1) {
        const b = ID.u("b", t) * TAU, [x, z] = at(b, edge + 700 + 1500 * ID.u("d", t));
        if (!ok(x, z)) continue;
        industry = { kind: "industrial", x, z, y: wetHeight(x, z), r, top: 18 + 14 * ID.u("top"), seed: `${site.seed}|industry` };
        // (Its road: in from the city's edge, straight on through the works and away over the land.)
        const [ex, ez] = fromEdge(b), dl = dhypot(x - ex, z - ez) || 1, dx = (x - ex) / dl, dz = (z - ez) / dl;
        const a = route("road", ex, ez, x, z, 4.2, 90);
        const [fx, fz] = [x + dx * 1800 + dz * 400 * ID.flat("on"), z + dz * 1800 - dx * 400 * ID.flat("on")];
        const bb = route("road", x, z, fx, fz, 4.2, 91);
        void a; void bb;
        through = { x, z, dx, dz };
      }
      if (industry) settlements.push(industry);
    }
  }
  // (Towns and villages hang off the nearest freeway or the city itself by a country road.)
  settlements.filter((s) => s.kind === "town" || s.kind === "village").forEach((s, i) => {
    let bx = 0, bz = 0, bd = Infinity;
    for (const l of lines0) if (l.kind === "freeway") { const n = nearestOn(l.xs, l.zs, s.x, s.z); if (n.d < bd && n.i > 10) { bd = n.d; bx = l.xs[n.i]!; bz = l.zs[n.i]!; } }
    const b = bearingOf(s.x, s.z), [ex, ez] = fromEdge(b), direct = dhypot(s.x - ex, s.z - ez);
    if (direct < bd) { bx = ex; bz = ez; }
    route("road", bx, bz, s.x, s.z, 4.2, 20 + i);
  });
  // (The airport's access road: from its terminal side to the nearest freeway, or the city.)
  {
    const c = dcos(port.yaw), sn = dsin(port.yaw), tx = port.x + c * 380, tz = port.z - sn * 380;
    let bx = 0, bz = 0, bd = Infinity;
    for (const l of lines0) if (l.kind === "freeway") { const n = nearestOn(l.xs, l.zs, tx, tz); if (n.d < bd && n.i > 10) { bd = n.d; bx = l.xs[n.i]!; bz = l.zs[n.i]!; } }
    const b = bearingOf(tx, tz), [ex, ez] = fromEdge(b);
    if (dhypot(tx - ex, tz - ez) < bd) { bx = ex; bz = ez; }
    route("road", bx, bz, tx, tz, 7.5, 60);
  }
  // (A rail line to the far city, where there is one to run to.)
  if (big.length && D.u("rail") < 0.6) {
    const s = big[0]!, b = bearingOf(s.x, s.z) + 0.35 * (D.u("railSide") < 0.5 ? -1 : 1), [x0, z0] = fromEdge(b);
    route("rail", x0, z0, s.x + dcos(b) * 120, s.z - dsin(b) * 120, 4, 40);
  }
  // (The works' rail: a spur off the main line if it passes near, else a siding down the works beside its road.)
  if (industry && through) {
    const rail = lines0.find((l) => l.kind === "rail"), n = rail ? nearestOn(rail.xs, rail.zs, industry.x, industry.z) : null;
    const nx = -through.dz, nz = through.dx, off = industry.r * 0.45;
    const [sx, sz] = [industry.x + nx * off, industry.z + nz * off];
    if (rail && n && n.d < 3000 && n.i > 3) route("rail", rail.xs[n.i]!, rail.zs[n.i]!, sx, sz, 4, 92);
    else route("rail", sx - through.dx * industry.r * 0.9, sz - through.dz * industry.r * 0.9, sx + through.dx * industry.r * 0.9, sz + through.dz * industry.r * 0.9, 4, 93);
  }

  // ---- the venues: a dirt track, a drift park, a derby bowl -- every city has all three, out on flat dry land 0.4..2.5 km
  // past its own ground (never on it: no lot, block or road of the city moves), clear of the water, the towns, the
  // airport, the roads and each other; the flattest of a few dozen seeded spots, its box levelled (settledHeight), a
  // country road from the nearest road or the city's edge to its gate. (No spot clear? The flattest dry one, levelled.)
  {
    const VD = drawsFor(site.seed, "venues");
    const surfaceOf = { dirt: "dirt", drift: "tarmac", derby: "mud" } as const;
    /** The venues' own access roads: never a later venue's road to join. */
    const access = new Set<(typeof lines0)[number]>();
    VENUE_KINDS.forEach((kind: VenueKind, k) => {
      const [hw, hd] = VENUE_BOX[kind], R = dhypot(hw, hd);
      const frame = (x: number, z: number, yaw: number, a: number, b: number): [number, number] => [x + dcos(yaw) * a + dsin(yaw) * b, z - dsin(yaw) * a + dcos(yaw) * b];
      let best: { x: number; z: number; yaw: number; score: number; y: number } | null = null;
      // (The drift park and the dirt track like the works: most of the time, where there's an industrial town, they look
      // beside it first, and a spot there wins over a flatter one further off.)
      const byWorks = industry !== null && kind !== "derby" && VD.u(`${kind}Works`) < 0.75;
      for (const strict of [true, false]) {
        for (let t = 0; t < 48 + (byWorks ? 24 : 0); t += 1) {
          const w = byWorks && t >= 48 ? t - 48 : -1;
          const b = VD.u(`${kind}B`, t) * TAU, d = edge + 400 + R * 0.7 + (2100 - R * 0.7) * VD.u(`${kind}D`, t), yaw = VD.u(`${kind}Yaw`, t) * Math.PI;
          const [x, z] = w >= 0 ? [industry!.x + dsin(VD.u(`${kind}WA`, w) * TAU) * (industry!.r + R * 0.9 + 40 + 260 * VD.u(`${kind}WD`, w)), industry!.z + dcos(VD.u(`${kind}WA`, w) * TAU) * (industry!.r + R * 0.9 + 40 + 260 * VD.u(`${kind}WD`, w))] : at(b, d);
          // (All of it 400 m past the city's ground, its middle no more than 2.5 km.)
          if (past(x, z) > 2500) continue;
          const box: [number, number][] = [];
          for (const a of [-1, -0.5, 0, 0.5, 1]) for (const c of [-1, -0.5, 0, 0.5, 1]) box.push(frame(x, z, yaw, a * (hw + 30), c * (hd + 30)));
          if (box.some(([px, pz]) => past(px, pz) < 400)) continue;
          if (landAtPoint(x, z) === "ocean" || box.some(([px, pz], i) => i % 2 === 0 && wetAt(px, pz))) continue;
          if (venueList.some((v) => dhypot(v.x - x, v.z - z) < dhypot(v.hw, v.hd) + R + 150)) continue;
          if (strict) {
            if (settlements.some((s) => dhypot(s.x - x, s.z - z) < (s.kind === "industrial" ? s.r * 1.05 + R + 30 : s.r * 1.6 + R + 100))) continue;
            if (airOut(x, z) < R + 200) continue;
            if (lines0.some((l) => nearestOn(l.xs, l.zs, x, z).d < R + l.half + 80)) continue;
          }
          const hs = box.map(([px, pz]) => settledHeight(px, pz) - backdropAt(px, pz, dhypot(px, pz) - edge));
          const land = landAtPoint(x, z);
          const score = Math.max(...hs) - Math.min(...hs) + (land === "mountains" ? 40 : land === "hills" ? 8 : 0) + past(x, z) * 0.003 - (w >= 0 ? 12 : 0);
          if (!best || score < best.score) best = { x, z, yaw, score, y: hs.reduce((a, h) => a + h, 0) / hs.length };
        }
        if (best) break;
      }
      if (!best) {
        // (Nowhere dry at all in reach: straight out away from the sea, levelled over whatever's there.)
        const b = (sea ? sea.bearing + Math.PI : 0) + (k - 1) * 0.6, [x, z] = at(b, edge * 1.42 + 400 + R);
        best = { x, z, yaw: 0, score: 0, y: wetHeight(x, z) };
      }
      const { x, z, yaw } = best, y = Math.max(sea ? sea.level + 3 : 0.5, best.y);
      // Its gate: on the side facing the road it joins -- the nearest road or freeway (or the city's edge) its access
      // road can reach without crossing another venue -- where that road ends.
      const seed = `${site.seed}|venue|${kind}`, layout = venueLayout(kind, drawsFor(site.seed, `venue|${kind}`));
      const me = { x, z, yaw, hw, hd };
      const targets: { x: number; z: number; d: number }[] = [];
      for (const l of lines0) if (l.kind !== "rail" && !access.has(l)) { const n = nearestOn(l.xs, l.zs, x, z); if (l.kind === "road" || n.i > 10) targets.push({ x: l.xs[n.i]!, z: l.zs[n.i]!, d: n.d }); }
      { const [ex, ez] = fromEdge(bearingOf(x, z)); targets.push({ x: ex, z: ez, d: dhypot(ex - x, ez - z) }); }
      targets.sort((p, q) => p.d - q.d);
      const sides = ([[hw, 0], [-hw, 0], [0, hd], [0, -hd]] as const).map(([a, c]) => frame(x, z, yaw, a, c));
      /** Whether a road's line keeps off every venue's ground (its own but for its last metres to the gate). */
      const offVenues = (xs: readonly number[], zs: readonly number[], gx: number, gz: number): boolean => xs.every((px, i) => [...venueList, me].every((v) => {
        if (v === me && dhypot(px - gx, zs[i]! - gz) < 30) return true;
        const [a, b] = venueLocal(v, px, zs[i]!);
        return Math.abs(a) > v.hw + 12 || Math.abs(b) > v.hd + 12;
      }));
      let gate: [number, number] | null = null;
      for (let t = 0; t < Math.min(6, targets.length) && !gate; t += 1) {
        const tg = targets[t]!, [gx, gz] = sides.reduce((m, p) => (dhypot(p[0] - tg.x, p[1] - tg.z) < dhypot(m[0] - tg.x, m[1] - tg.z) ? p : m));
        for (let b = 0; b < 3; b += 1) {
          const line = route("road", tg.x, tg.z, gx, gz, 4.2, 70 + k + b * 10);
          if (offVenues(line.xs, line.zs, gx, gz)) { access.add(lines0[lines0.length - 1]!); gate = [gx, gz]; break; }
          lines0.pop();
        }
      }
      if (!gate) {
        // (Hemmed in: the nearest, straight in.)
        const tg = targets[0]!, [gx, gz] = sides.reduce((m, p) => (dhypot(p[0] - tg.x, p[1] - tg.z) < dhypot(m[0] - tg.x, m[1] - tg.z) ? p : m));
        route("road", tg.x, tg.z, gx, gz, 4.2, 70 + k);
        access.add(lines0[lines0.length - 1]!);
        gate = [gx, gz];
      }
      const [gx, gz] = gate;
      venueList.push({
        kind, seed, x, z, y, yaw, hw, hd, surface: surfaceOf[kind],
        gate: { x: gx, z: gz, yaw: datan2(x - gx, z - gz) },
        courses: layout.courses.map((c) => placeCourse(c.name, c.surface, c.local, x, z, yaw)),
        bowl: layout.bowl,
      });
    });
  }

  // ---- obstacles a line across the land keeps clear of: the towns, the venues, the airport's field (as circles).
  const obstacles: { x: number; z: number; r: number; town: boolean }[] = [
    ...settlements.map((s) => ({ x: s.x, z: s.z, r: s.r + 120, town: true })),
    ...venueList.map((v) => ({ x: v.x, z: v.z, r: dhypot(v.hw, v.hd) + 50, town: false })),
  ];
  {
    const ax = dsin(port.yaw), az = dcos(port.yaw), cx = dcos(port.yaw), cz = -dsin(port.yaw), mid = 130 - port.spacing / 2, half = port.length / 2 + 250;
    for (let a = -half; a <= half + 1; a += 300) obstacles.push({ x: port.x + ax * a + cx * mid, z: port.z + az * a + cz * mid, r: 490 + port.spacing / 2, town: false });
  }
  /** Push a line's points (all but `keep` at each end) out of every obstacle, a few rounds. */
  const pushOut = (xs: number[], zs: number[], keep: number, pad = 0): void => {
    for (let it = 0; it < 4; it += 1) for (let i = keep; i < xs.length - keep; i += 1) for (const o of obstacles) {
      const d = dhypot(xs[i]! - o.x, zs[i]! - o.z), r = o.r + pad;
      if (d < r) { const k = (r + 1) / (d || 1); xs[i] = o.x + (xs[i]! - o.x) * k; zs[i] = o.z + (zs[i]! - o.z) * k; }
    }
  };
  const inObstacle = (x: number, z: number, pad: number): boolean => settlements.some((s) => dhypot(s.x - x, s.z - z) < s.r + pad) || inVenue(x, z, pad) || airOut(x, z) < pad;
  const seaOrLake = (x: number, z: number): boolean => (sea !== null && baseHeight(x, z) < sea.level + 0.5) || lakes.some((l) => dhypot(x - l.x, z - l.z) < lakeR(l, x, z) + 15);

  // ---- the rally stage: every city has one -- a dirt road from one road out in the country to another a few
  // kilometres off, swinging across the land with a switchback or two, round the towns, the venues and the airport,
  // fording the river if it meets it. Its line every metre is region.rally; every 5 m it's a "dirt" road, graded in.
  const RD = drawsFor(site.seed, "rally");
  let stage: { x: Float64Array; z: Float64Array } | null = null;
  {
    const ends: { x: number; z: number }[] = [];
    for (const l of lines0) if (l.kind === "road" || l.kind === "freeway") for (let i = 2; i < l.xs.length - 2; i += 4) {
      const x = l.xs[i]!, z = l.zs[i]!;
      if (past(x, z) < 250 || past(x, z) > 5200 || wetAt(x, z) || inObstacle(x, z, 150)) continue;
      ends.push({ x, z });
    }
    const wild = new Set<RegionLand>(["forest", "hills", "farmland", "valley", "plains", "mountains"]);
    let fallback: { x: Float64Array; z: Float64Array } | null = null;
    for (let t = 0; t < 60 && !stage && ends.length > 1; t += 1) {
      const S = ends[Math.floor(RD.u("s", t) * ends.length)]!;
      const far = ends.filter((e) => { const d = dhypot(e.x - S.x, e.z - S.z); return d > 2800 && d < 6000; });
      if (!far.length) continue;
      const E = far[Math.floor(RD.u("e", t) * far.length)]!;
      const c = rallyControls(RD, t, S.x, S.z, E.x, E.z);
      pushOut(c.xs, c.zs, 1, 60);
      // (A cheap look along the control polygon first: the spline stays near it.)
      let rough = false;
      for (let k = 0; k + 1 < c.xs.length && !rough; k += 1) {
        const L = dhypot(c.xs[k + 1]! - c.xs[k]!, c.zs[k + 1]! - c.zs[k]!), m = Math.max(1, Math.ceil(L / 40));
        for (let q = 0; q < m && !rough; q += 1) {
          const px = c.xs[k]! + ((c.xs[k + 1]! - c.xs[k]!) * q) / m, pz = c.zs[k]! + ((c.zs[k + 1]! - c.zs[k]!) * q) / m;
          if ((k > 0 && k < c.xs.length - 2 && inObstacle(px, pz, 10)) || seaOrLake(px, pz)) rough = true;
        }
      }
      if (rough) continue;
      const p = filletPath(c.xs, c.zs, c.rs);
      const x = p.x, z = p.z, n = p.length;
      let bad = false, wildN = 0, all = 0;
      for (let i = 0; i < n && !bad; i += 6) {
        const nearEnd = i < 60 || i > n - 60;
        if ((!nearEnd && inObstacle(x[i]!, z[i]!, 30)) || seaOrLake(x[i]!, z[i]!)) bad = true;
        if (i % 120 === 0) { all += 1; if (wild.has(landAtPoint(x[i]!, z[i]!))) wildN += 1; }
      }
      if (!fallback && !bad) fallback = { x, z };
      if (bad || p.rmin < 9 || wildN < all * 0.5 || nearsSelf(p.x, p.z, 14, 70, 6)) continue;
      stage = { x, z };
    }
    if (!stage) stage = fallback;
    if (!stage) {
      // (Nowhere clean: straight out from the city's edge, away from the sea, round what's in the way.)
      const b = (sea ? sea.bearing + Math.PI : RD.u("fb") * TAU), [x0, z0] = fromEdge(b), [x1, z1] = at(b + 0.4, edge + 4200);
      const c = rallyControls(RD, 99, x0, z0, x1, z1);
      pushOut(c.xs, c.zs, 1, 60);
      const p = filletPath(c.xs, c.zs, c.rs);
      stage = { x: p.x, z: p.z };
    }
    const xs: number[] = [], zs: number[] = [];
    for (let i = 0; i < stage.x.length; i += 5) { xs.push(stage.x[i]!); zs.push(stage.z[i]!); }
    if ((stage.x.length - 1) % 5) { xs.push(stage.x[stage.x.length - 1]!); zs.push(stage.z[stage.z.length - 1]!); }
    lines0.push({ kind: "dirt", xs, zs, half: 4 });
  }
  const stageRoad = lines0.length - 1;
  const ford = (x: number, z: number): boolean => river !== null && nearestOn(river.x, river.z, x, z).d < river.width / 2 + 4;

  // ---- decks: each road's height along it -- the land smoothed and held to a grade, lifted over water.
  const bucket = new Buckets();
  /** A road's deck over the ground `base` gives (the settled land; the rally stage's, the land as the other roads grade it). */
  const deckOf = (l: (typeof lines0)[number], id: number, base: (x: number, z: number) => number): RegionRoad => {
    const n = l.xs.length, ground = new Float64Array(n), y = new Float64Array(n), pier = new Uint8Array(n);
    const dirt = l.kind === "dirt", fords = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      let g = base(l.xs[i]!, l.zs[i]!);
      // (The rally stage fords the river -- down through the water, never over it; every other road bridges water.)
      if (dirt) { if (ford(l.xs[i]!, l.zs[i]!)) { fords[i] = 1; g = Math.min(g, river!.level - 0.1); } }
      else if (wetAt(l.xs[i]!, l.zs[i]!)) g = Math.max(g, (sea?.level ?? 0) + 9, ...lakes.map((k) => k.level + 9), river ? river.level + 9 : -Infinity);
      ground[i] = g;
    }
    // (A running average over ~400 m, then held to the class's grade both ways; a dirt stage hugs the land: ~80 m, 15%.)
    const win = dirt ? 8 : l.kind === "road" ? 6 : 12, grade = dirt ? 0.15 * 5 : (l.kind === "rail" ? 0.02 : l.kind === "freeway" ? 0.045 : 0.08) * 20;
    for (let i = 0; i < n; i += 1) { let s = 0, c = 0; for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k += 1) { s += ground[k]!; c += 1; } y[i] = s / c; }
    for (let i = 1; i < n; i += 1) y[i] = Math.min(Math.max(y[i]!, y[i - 1]! - grade), y[i - 1]! + grade);
    for (let i = n - 2; i >= 0; i -= 1) y[i] = Math.min(Math.max(y[i]!, y[i + 1]! - grade), y[i + 1]! + grade);
    if (dirt) for (let i = 0; i < n; i += 1) if (fords[i]) y[i] = Math.min(y[i]!, river!.level - 0.1);
    for (let i = 0; i < n; i += 1) {
      // (Never below the ground where it's dry by more than a cutting can take; a viaduct where it stands well over it.)
      if (!dirt && (y[i]! - settledHeight(l.xs[i]!, l.zs[i]!) > 5 || wetAt(l.xs[i]!, l.zs[i]!))) pier[i] = 1;
      bucket.add(l.xs[i]!, l.zs[i]!, id, i);
    }
    return { kind: l.kind, x: Float64Array.from(l.xs), z: Float64Array.from(l.zs), y, pier, half: l.half };
  };
  // (The rally stage -- the last line -- comes after the rest: it runs on the land as their cuttings and banks leave it,
  // so where it meets or runs beside a road the two agree.)
  const roads: RegionRoad[] = lines0.slice(0, stageRoad).map((l, id) => deckOf(l, id, settledHeight));

  /** The final height: the wet land, graded to each road where the road runs on the ground. */
  const heightAt = (x: number, z: number): number => {
    let h = settledHeight(x, z);
    // (Per road near here, its nearest segment among the ones bucketed round this point.)
    const near = bucket.near(x, z), best = new Map<number, { d: number; deck: number; pier: number }>();
    for (let k = 0; k < near.length; k += 2) {
      const id = near[k]!, i = near[k + 1]!, r = roads[id]!;
      if (i + 1 >= r.x.length) continue;
      const ax = r.x[i]!, az = r.z[i]!, dx = r.x[i + 1]! - ax, dz = r.z[i + 1]! - az, l2 = dx * dx + dz * dz || 1;
      const t = sat(((x - ax) * dx + (z - az) * dz) / l2), d = dhypot(ax + dx * t - x, az + dz * t - z);
      const b = best.get(id);
      if (!b || d < b.d) best.set(id, { d, deck: r.y[i]! + (r.y[i + 1]! - r.y[i]!) * t, pier: r.pier[i]! });
    }
    // (The rally stage last: it's laid on the land the others leave, and where it runs it is the land.)
    for (let pass = 0; pass < 2; pass += 1) for (const [id, b] of best) {
      const r = roads[id]!;
      if ((r.kind === "dirt") !== (pass === 1)) continue;
      if (b.pier && b.deck > h) continue;
      const shoulder = r.half + (r.kind === "dirt" ? 3 : 3), blend = r.kind === "road" ? 18 : r.kind === "dirt" ? 20 : 40;
      if (b.d > shoulder + blend) continue;
      h = h + (b.deck - 0.25 - h) * (1 - ramp(b.d, shoulder, shoulder + blend));
    }
    return h;
  };
  roads.push(deckOf(lines0[stageRoad]!, stageRoad, heightAt));

  // ---- sites: what a region's roads, towns and land bring.
  const sites: RegionSite[] = [];
  const place = (kind: SiteKind, x: number, z: number, yaw: number, size: number, tag: string): void => {
    sites.push({ kind, x, z, y: heightAt(x, z), yaw, size, seed: `${site.seed}|${kind}|${tag}` });
  };
  const clear = (x: number, z: number, r: number): boolean =>
    dhypot(x, z) > edge + r * 0.6 && !wetAt(x, z)
    && venueList.every((v) => dhypot(v.x - x, v.z - z) > dhypot(v.hw, v.hd) + r)
    && settlements.every((s) => dhypot(s.x - x, s.z - z) > s.r + r)
    && sites.every((q) => dhypot(q.x - x, q.z - z) > q.size * 0.6 + r)
    && roads.every((rd) => nearestOn(rd.x, rd.z, x, z).d > rd.half + r * 0.5 + 10);
  const findSpot = (tag: string, from: number, to: number, r: number, ok: (x: number, z: number) => boolean, tries = 40): [number, number] | null => {
    for (let t = 0; t < tries; t += 1) {
      const b = D.u(`${tag}B`, t) * TAU, d = from + (to - from) * D.u(`${tag}D`, t), [x, z] = at(b, d);
      if (clear(x, z, r) && ok(x, z)) return [x, z];
    }
    return null;
  };
  const openLand = (...ls: RegionLand[]) => (x: number, z: number): boolean => ls.includes(landAtPoint(x, z));
  /** The grid's nodes: where a new line can join it (the city's edge substation, the power station, each substation). */
  const grid: { x: number; z: number }[] = [];
  // The power station: out where the industry faces, by water if it can be; its lines run to the city.
  const industrial = city.blocks.filter((b) => city.lots.some((l) => l.block === b.id && city.districts[l.district]!.kind === "industrial"));
  const [ix, iz] = industrial.length ? industrial.map(blockCentre).reduce((a, c) => [a[0] + c[0] / industrial.length, a[1] + c[1] / industrial.length], [0, 0]) : at(D.u("plantBearing") * TAU, 1);
  const plantB = bearingOf(ix || 1, iz);
  const lines: RegionLine[] = [], pipes: RegionLine[] = [];
  /** Supports every `every` m along a line -- never one in the water, a town, a venue or on the airfield: it spans them. */
  const pylons = (xs: readonly number[], zs: readonly number[], every: number, kind: RegionLine["kind"] = "pylon", feed = true): void => {
    const px: number[] = [], pz: number[] = [], py: number[] = [];
    let run = 0;
    const ok = (x: number, z: number): boolean => !inVenue(x, z, 20) && airOut(x, z) > 20 && !wetAt(x, z) && settlements.every((s) => dhypot(s.x - x, s.z - z) > s.r * 0.95);
    for (let i = 0; i + 1 < xs.length; i += 1) {
      const seg = dhypot(xs[i + 1]! - xs[i]!, zs[i + 1]! - zs[i]!);
      while (run <= seg) {
        const t = run / (seg || 1), x = xs[i]! + (xs[i + 1]! - xs[i]!) * t, z = zs[i]! + (zs[i + 1]! - zs[i]!) * t;
        if (ok(x, z)) { px.push(x); pz.push(z); py.push(heightAt(x, z)); }
        run += every;
      }
      run -= seg;
    }
    if (px.length > 1) (kind === "pipe" ? pipes : lines).push({ kind, feed, x: px, z: pz, y: py });
  };
  /**
   * A line's course from a to b, as a surveyor would lay it: along a road that runs the same way (a field's width off
   * it) where there is one, else a slack curve across the land; either way round the towns, the venues and the airport.
   */
  const survey = (ax: number, az: number, bx: number, bz: number, tag: number): { xs: number[]; zs: number[] } => {
    const L = dhypot(bx - ax, bz - az);
    let xs: number[] = [], zs: number[] = [];
    for (const r of roads) {
      if (r.kind === "rail" || r.kind === "dirt") continue;
      const na = nearestOn(r.x, r.z, ax, az), nb = nearestOn(r.x, r.z, bx, bz);
      if (na.d > 450 || nb.d > 450 || Math.abs(nb.i - na.i) * 20 < L * 0.5 || Math.abs(nb.i - na.i) * 20 > L * 1.7) continue;
      const side = D.u("lineSide", tag) < 0.5 ? -1 : 1, step = na.i < nb.i ? 4 : -4;
      xs = [ax]; zs = [az];
      for (let i = na.i; step > 0 ? i < nb.i : i > nb.i; i += step) {
        const j = Math.min(r.x.length - 1, i + 1), dx = r.x[j]! - r.x[Math.max(0, j - 1)]!, dz = r.z[j]! - r.z[Math.max(0, j - 1)]!, l = dhypot(dx, dz) || 1;
        xs.push(r.x[i]! + (dz / l) * side * 60); zs.push(r.z[i]! - (dx / l) * side * 60);
      }
      xs.push(bx); zs.push(bz);
      break;
    }
    if (!xs.length) {
      const k = Math.max(4, Math.ceil(L / 250)), bow = D.flat("lineBow", tag) * Math.min(400, L * 0.12), nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1);
      for (let i = 0; i <= k; i += 1) { const t = i / k, s2 = dsin(t * Math.PI) * bow; xs.push(ax + (bx - ax) * t + nx * s2); zs.push(az + (bz - az) * t + nz * s2); }
    }
    pushOut(xs, zs, 1, 40);
    return { xs, zs };
  };
  if (D.u("plant") < 0.8) {
    for (let t = 0; t < 30; t += 1) {
      const b = plantB + D.flat("plantB", t) * 0.8, d = edge + 900 + 1800 * D.u("plantD", t), [x, z] = at(b, d);
      if (!clear(x, z, 260) || flatAt(x, z, 200) > 14) continue;
      place("powerplant", x, z, D.u("plantYaw") * TAU, 380, "main");
      // (Its line: a slack curve to the city's edge on its bearing, pylons every 320 m.)
      const [ex, ez] = at(b + 0.15, edge + 40), mx = (x + ex) / 2 + dcos(b) * 300, mz = (z + ez) / 2 - dsin(b) * 300;
      const xs: number[] = [], zs: number[] = [];
      for (let k = 0; k <= 20; k += 1) { const u = k / 20, a = (1 - u) * (1 - u), c = 2 * u * (1 - u), e2 = u * u; xs.push(a * x + c * mx + e2 * ex); zs.push(a * z + c * mz + e2 * ez); }
      pushOut(xs, zs, 1, 40);
      pylons(xs, zs, 320);
      place("substation", ex * 1.01, ez * 1.01, b, 70, "edge");
      grid.push({ x: ex * 1.01, z: ez * 1.01 }, { x, z });
      break;
    }
  }
  // (A second line along the first freeway, a field's width off it.)
  const fw = roads.find((r) => r.kind === "freeway");
  if (fw && D.u("fwLine") < 0.7) {
    const side = D.u("fwSide") < 0.5 ? -1 : 1, xs: number[] = [], zs: number[] = [];
    for (let i = 0; i < fw.x.length; i += 8) {
      const j = Math.min(fw.x.length - 1, i + 1), dx = fw.x[j]! - fw.x[i]!, dz = fw.z[j]! - fw.z[i]!, l = dhypot(dx, dz) || 1;
      xs.push(fw.x[i]! + (dz / l) * side * 70); zs.push(fw.z[i]! - (dx / l) * side * 70);
    }
    pushOut(xs, zs, 1, 40);
    pylons(xs, zs, 300);
  }
  // The airport, as a site (its field is levelled already).
  sites.push({ kind: "airport", x: port.x, z: port.z, y: port.y, yaw: port.yaw, size: port.length, seed: `${site.seed}|airport`, tier: port.tier });
  // The venues, as sites (their ground is levelled already; region.venues has their courses).
  for (const v of venueList) sites.push({ kind: v.kind === "dirt" ? "dirttrack" : v.kind === "drift" ? "driftpark" : "derby", x: v.x, z: v.z, y: v.y, yaw: v.yaw, size: 2 * dhypot(v.hw, v.hd), seed: v.seed });
  // ---- the power: solar and wind farms by the land (how many, the seed's -- a desert's sun brings more), each with its
  // substation and a line on pylons to the nearest of the grid; every town and the works fed by a line of their own
  // (poles to a town, pylons to the works). Lines follow the roads where they run the same way, round what's in the way.
  const PD = drawsFor(site.seed, "power");
  if (!grid.length) { const [gx, gz] = at(PD.u("gridB") * TAU, edge + 40); place("substation", gx, gz, PD.u("gridB") * TAU, 70, "grid"); grid.push({ x: gx, z: gz }); }
  const dryAround = (x: number, z: number, r: number): boolean => [0, 1, 2, 3, 4, 5, 6, 7].every((k) => !wetAt(x + dsin((k * TAU) / 8) * r, z + dcos((k * TAU) / 8) * r));
  const connect = (x: number, z: number, kind: "pylon" | "pole", tag: number): void => {
    const to = grid.reduce((m, q) => (dhypot(q.x - x, q.z - z) < dhypot(m.x - x, m.z - z) ? q : m));
    const c = survey(x, z, to.x, to.z, tag);
    pylons(c.xs, c.zs, kind === "pylon" ? 300 : 110, kind, false);
    grid.push({ x, z });
  };
  /** A farm's substation: at its edge toward the city, clear of the water; its line to the grid. */
  const feedFarm = (x: number, z: number, size: number, tag: number): void => {
    const b = bearingOf(x, z), [sx, sz] = [x - dsin(b) * (size * 0.5 + 50), z - dcos(b) * (size * 0.5 + 50)];
    if (wetAt(sx, sz) || inObstacle(sx, sz, 30)) { grid.push({ x, z }); return; }
    place("substation", sx, sz, b, 50, `farm${tag}`);
    connect(sx, sz, "pylon", 200 + tag);
  };
  const desert = sectors.some((s) => s.land === "desert");
  const nSolar = desert ? 2 + Math.floor(PD.u("solarN") * 3) : Math.floor(PD.u("solarN") * 3.3), nWind = Math.floor(PD.u("windN") * 3.6);
  const sunny = openLand("desert", "plains", "farmland", "sprawl"), windy = openLand("hills", "plains", "farmland", "mountains", "valley");
  for (let k = 0, t = 0; k < nSolar && t < 50; t += 1) {
    const size = 300 + 420 * PD.u("solarSize", t), [x, z] = at(PD.u("solarB", t) * TAU, edge + 700 + 4800 * PD.u("solarD", t));
    if (!clear(x, z, size * 0.6) || !sunny(x, z) || flatAt(x, z, size * 0.45) > 6 || !dryAround(x, z, size * 0.6) || airOut(x, z) < size * 0.7 || inVenue(x, z, size * 0.6)) continue;
    place("solar", x, z, PD.u("solarYaw", t) * TAU, size, `s${k}`);
    feedFarm(x, z, size, k);
    k += 1;
  }
  for (let k = 0, t = 0; k < nWind && t < 50; t += 1) {
    const size = 900 + 700 * PD.u("windSize", t), [x, z] = at(PD.u("windB", t) * TAU, edge + 1300 + 5200 * PD.u("windD", t));
    if (!clear(x, z, size * 0.5) || !windy(x, z) || !dryAround(x, z, size * 0.5) || airOut(x, z) < size * 0.6 || inVenue(x, z, size * 0.5)) continue;
    place("windfarm", x, z, PD.u("windYaw", t) * TAU, size, `w${k}`);
    feedFarm(x, z, size, 10 + k);
    k += 1;
  }
  // Every town, village and the works: a substation at its edge toward the city, fed from the grid (nearest first).
  settlements.filter((s) => s.kind !== "metro" && s.kind !== "city" && dhypot(s.x, s.z) < 7000).map((s, i) => ({ s, i, d: dhypot(s.x, s.z) })).sort((a, b) => a.d - b.d || a.i - b.i).forEach(({ s, i }) => {
    const b = bearingOf(s.x, s.z), [sx, sz] = [s.x - dsin(b) * (s.r + 60), s.z - dcos(b) * (s.r + 60)];
    if (wetAt(sx, sz) || inVenue(sx, sz, 30) || airOut(sx, sz) < 30) return;
    place("substation", sx, sz, b, 40, `town${i}`);
    connect(sx, sz, s.kind === "industrial" ? "pylon" : "pole", 300 + i);
  });
  // A tank farm by the industry (the works, or the power station, or out on the city's industrial side), its pipelines
  // to the works and away over the land.
  {
    const host = industry ?? sites.find((q) => q.kind === "powerplant") ?? null;
    const hr = industry ? industry.r : host ? 200 : 0;
    for (let t = 0; t < 30; t += 1) {
      const b = PD.u("tankB", t) * TAU, [x, z] = host ? [host.x + dsin(b) * (hr + 160 + 200 * PD.u("tankD", t)), host.z + dcos(b) * (hr + 160 + 200 * PD.u("tankD", t))] : at(plantB + PD.flat("tankB", t) * 0.6, edge + 400 + 900 * PD.u("tankD", t));
      if (!clear(x, z, 110) || !dryAround(x, z, 110) || airOut(x, z) < 120 || past(x, z) < 150) continue;
      place("tankfarm", x, z, PD.u("tankYaw") * TAU, 180, "t");
      const to = host ?? { x: fromEdge(bearingOf(x, z))[0], z: fromEdge(bearingOf(x, z))[1] };
      const a = survey(x, z, to.x, to.z, 400);
      pylons(a.xs, a.zs, 30, "pipe", false);
      const ob = bearingOf(x, z) + PD.flat("pipeOut") * 0.7, [fx, fz] = at(ob, Math.min(reach - 200, dhypot(x, z) + 3500));
      const o = survey(x, z, fx, fz, 401);
      pylons(o.xs, o.zs, 30, "pipe", false);
      break;
    }
  }
  const rough = openLand("mountains", "hills");
  if (D.u("quarry") < 0.6) { const p = findSpot("quarry", edge + 700, 4500, 260, rough); if (p) place("quarry", p[0], p[1], D.u("quarryYaw") * TAU, 420, "q"); }
  // (Masts on the highest ground in reach.)
  const masts = 2 + Math.floor(D.u("masts") * 4);
  const cands: [number, number, number][] = [];
  for (let t = 0; t < 60; t += 1) { const [x, z] = at(D.u("mastB", t) * TAU, edge + 600 + 5000 * D.u("mastD", t)); if (!wetAt(x, z)) cands.push([x, z, heightAt(x, z)]); }
  cands.sort((p, q) => q[2] - p[2]);
  for (const [x, z] of cands) { if (sites.filter((s) => s.kind === "mast").length >= masts) break; if (clear(x, z, 60)) place("mast", x, z, 0, 90 + 90 * D.u("mastH", Math.round(x)), `${Math.round(x)}`); }
  // (Cell masts down the freeways, every couple of kilometres, a field off the road.)
  roads.filter((r) => r.kind === "freeway").forEach((r, k) => {
    for (let i = 40 + Math.floor(D.u("cellFrom", k) * 40); i < r.x.length - 2; i += 170) {
      const j = i + 1, dx = r.x[j]! - r.x[i]!, dz = r.z[j]! - r.z[i]!, l = dhypot(dx, dz) || 1, s2 = D.u("cellSide", k, i) < 0.5 ? -1 : 1;
      const x = r.x[i]! + (dz / l) * s2 * (r.half + 40), z = r.z[i]! - (dx / l) * s2 * (r.half + 40);
      if (dhypot(x, z) < reach - 300 && clear(x, z, 12) && airOut(x, z) > 100) place("mast", x, z, 0, 32 + 14 * D.u("cellH", k, i), `cell${k}:${i}`);
    }
  });
  // Farms and orchards: along the farmland, on a loose grid.
  for (let gx = -reach; gx <= reach; gx += 520) for (let gz = -reach; gz <= reach; gz += 520) {
    const jx = gx + D.flat("farmX", gx, gz) * 180, jz = gz + D.flat("farmZ", gx, gz) * 180, r = dhypot(jx, jz);
    if (r < edge + 250 || r > 6500) continue;
    const land = landAtPoint(jx, jz);
    const p = land === "farmland" ? 0.7 : land === "plains" ? 0.25 : land === "valley" ? 0.3 : land === "hills" ? 0.12 : 0;
    if (D.u("farm", gx, gz) > p || !clear(jx, jz, 60) || flatAt(jx, jz, 60) > 8) continue;
    place(D.u("orchard", gx, gz) < 0.2 ? "orchard" : "farm", jx, jz, D.u("farmYaw", gx, gz) * TAU, 120, `${gx},${gz}`);
  }
  // Along the freeways: a truck stop, motels, billboards, a drive-in.
  roads.filter((r) => r.kind === "freeway").forEach((r, k) => {
    const side = (i: number, s: number, off: number): [number, number, number] => {
      const j = Math.min(r.x.length - 1, i + 1), dx = r.x[j]! - r.x[i]!, dz = r.z[j]! - r.z[i]!, l = dhypot(dx, dz) || 1;
      return [r.x[i]! + (dz / l) * s * off, r.z[i]! - (dx / l) * s * off, datan2(-dz / l * s, dx / l * s) + Math.PI / 2];
    };
    for (let i = 20; i < Math.min(r.x.length - 1, 180); i += 18) {
      if (r.pier[i]) continue;
      const s = (i / 18) % 2 ? 1 : -1, [x, z, yaw] = side(i, s, r.half + 22);
      if (!wetAt(x, z) && dhypot(x, z) > edge + 20) place("billboard", x, z, yaw, 14, `${k}:${i}`);
    }
    const pick = (tag: string, kind: SiteKind, from: number, off: number, size: number): void => {
      for (let t = 0; t < 12; t += 1) {
        const i = Math.min(r.x.length - 2, from + Math.floor(D.u(`${tag}${k}`, t) * 80));
        if (r.pier[i]) continue;
        const s = D.u(`${tag}S${k}`, t) < 0.5 ? -1 : 1, [x, z, yaw] = side(i, s, r.half + off);
        if (clear(x, z, size * 0.5)) { place(kind, x, z, yaw, size, `${k}:${t}`); return; }
      }
    };
    if (k === 0) pick("truck", "truckstop", 45, 90, 160);
    if (D.u("motel", k) < 0.6) pick("motel", "motel", 25, 50, 70);
    if (k === 0 && D.u("drivein") < 0.35) pick("drivein", "drivein", 70, 120, 160);
  });
  // On the city's edge: a golf course, a regional park (by a lake or a wood if there is one), a trailer park, a marina.
  const near = (tag: string, kind: SiteKind, size: number, chance: number, ok: (x: number, z: number) => boolean = () => true): void => {
    if (D.u(tag) >= chance) return;
    const p = findSpot(tag, edge + size * 0.7, edge + 2200, size * 0.55, (x, z) => ok(x, z) && flatAt(x, z, size * 0.4) < 22);
    if (p) place(kind, p[0], p[1], D.u(`${tag}Yaw`) * TAU, size, tag);
  };
  near("golf", "golf", 520, 0.45 + 0.3 * sprawl, openLand("hills", "plains", "sprawl", "forest"));
  near("park", "park", 600, 0.9, openLand("forest", "hills", "plains", "valley", "farmland"));
  near("park2", "park", 420, 0.5, openLand("forest", "hills", "valley"));
  near("trailers", "trailers", 160, 0.45, openLand("plains", "desert", "sprawl", "farmland"));
  const shore = lakes[0] ?? null;
  if (sea || shore) {
    for (let t = 0; t < 40; t += 1) {
      const b = sea ? sea.bearing + D.flat("marinaB", t) * 0.9 : bearingOf(shore!.x, shore!.z), d = sea ? edge + 200 + 1500 * D.u("marinaD", t) : dhypot(shore!.x, shore!.z) - shore!.r * (0.8 + 0.3 * D.u("marinaD", t));
      const [x, z] = at(b, d);
      const level = sea ? sea.level : shore!.level;
      if (wetAt(x, z) || heightAt(x, z) > level + 2.5 || inVenue(x, z, 300)) continue;
      // (Its piers run out 90 m on its bearing: water under all of them, or it's a marina on the sand.)
      if (![30, 60, 90].every((k) => { const [px, pz] = at(b, d + k); return heightAt(px, pz) < level - 0.5; })) continue;
      place("marina", x, z, b, 180, `${t}`);
      if (sea) { const [lx, lz] = at(b + 0.25, d + 250); place("lighthouse", lx, lz, 0, 24, "l"); }
      break;
    }
  }

  // ---- the rally stage as data: its line every metre, its graded height, its jumps, hairpins and fords.
  const rally: RallyStage = (() => {
    const x = Float64Array.from(stage!.x), z = Float64Array.from(stage!.z), n = x.length, r = roads[stageRoad]!, y = new Float64Array(n);
    for (let i = 0; i < n; i += 1) { const j = Math.min(r.y.length - 1, Math.floor(i / 5)), k = Math.min(r.y.length - 1, j + 1), t = (i - j * 5) / 5; y[i] = r.y[j]! + (r.y[k]! - r.y[j]!) * Math.min(1, t); }
    const prof = rallyProfile(RD, x, z, y, (i) => ford(x[i]!, z[i]!));
    let length = 0;
    for (let i = 0; i + 1 < n; i += 1) length += dhypot(x[i + 1]! - x[i]!, z[i + 1]! - z[i]!);
    const line = (i: number): { x: number; z: number; yaw: number } => ({ x: x[i]!, z: z[i]!, yaw: datan2(x[i + 1]! - x[i - 1]!, z[i + 1]! - z[i - 1]!) });
    return { name: "stage", seed: `${site.seed}|rally`, surface: "dirt", closed: false, x, z, y, half: new Float64Array(n).fill(4), ...prof, length, start: line(Math.min(40, n - 2)), finish: line(Math.max(1, n - 41)), road: stageRoad };
  })();

  // ---- the ground's cover at a point.
  const ground = (x: number, z: number): RegionGround => {
    const land = landAtPoint(x, z), h = heightAt(x, z);
    let water: number | null = null;
    if (sea && h < sea.level) water = sea.level;
    for (const l of lakes) if (h < l.level && dhypot(x - l.x, z - l.z) < l.r * 1.5) water = l.level;
    if (river && h < river.level && nearestOn(river.x, river.z, x, z).d < river.width) water = river.level;
    const n = N(40, x, z, 420, 3), m = N(41, x, z, 1500, 2);
    const forestBase = land === "forest" ? 0.8 : land === "hills" ? 0.45 : land === "mountains" ? (h < 380 ? 0.5 : 0.1) : land === "valley" ? 0.4 : land === "plains" ? 0.12 : land === "sprawl" ? 0.15 : land === "farmland" ? 0.06 : 0;
    const forest = water !== null || h > 460 ? 0 : sat((forestBase + (n - 0.5) * 0.9 + (m - 0.5) * 0.5) * 1.4 - 0.2);
    const rock = sat((h - 180) / 180) * (land === "mountains" || land === "hills" ? 1 : 0.6) + (land === "desert" && h > 12 ? 0.7 : 0);
    const snow = sat((h - 430 - 60 * n) / 70);
    const sand = land === "desert" ? 0.9 : water === null && (sea ? h < sea.level + 2.2 : false) ? 1 : 0;
    // (Fields: a patchwork on a turned grid, each patch its own crop.)
    let field = -1;
    if (land === "farmland" || (land === "plains" && m > 0.55) || (land === "valley" && h < 20)) {
      const fy = 0.3 + m, c = dcos(fy), s = dsin(fy), u = x * c - z * s, v = x * s + z * c;
      field = Math.abs(hash2(Math.floor(u / 170), Math.floor(v / 110), landSeed) * 1e6) | 0;
    }
    return { land, water, forest: forest * (field >= 0 ? 0.15 : 1), rock: sat(rock), snow, sand, field };
  };

  // ---- the sky: a wind, and clouds scattered over the region at their base -- more of them some days than others.
  const cover = D.u("cover") < 0.15 ? 0.05 : 0.25 + 0.65 * D.u("coverAmt");
  const windA = D.u("windA") * TAU, windS = 3 + 9 * D.u("windS");
  const clouds: { x: number; z: number; y: number; r: number; seed: number }[] = [];
  const base = 700 + 900 * D.u("cloudBase");
  for (let k = 0; k < Math.round(40 + 220 * cover); k += 1) {
    const [x, z] = at(D.u("cloudB", k) * TAU, Math.sqrt(D.u("cloudD", k)) * reach * 1.1);
    clouds.push({ x, z, y: base + 250 * D.u("cloudY", k), r: 120 + 380 * D.u("cloudR", k), seed: (D.u("cloudS", k) * 1e9) | 0 });
  }
  const sky: RegionSky = { wind: [dsin(windA) * windS, dcos(windA) * windS], cover, clouds };

  return { seed: site.seed, edge, reach, sprawl, sectors, water: { sea, lakes, river }, settlements, sites, roads, lines, airport: port, venues: { dirt: venueList[0]!, drift: venueList[1]!, derby: venueList[2]! }, rally, industry, pipes, sky, exits, heightAt, ground };
}

const regions = new WeakMap<City, Region>();
/** A city's region, made once a city. */
export function regionOf(city: City): Region {
  let r = regions.get(city);
  if (!r) { r = cityRegion(city); regions.set(city, r); }
  return r;
}
