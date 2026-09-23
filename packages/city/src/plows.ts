// Snow plows: when snow lies on a city's roads the city sends its plows out, and a road a plow has been down is a road
// cleared -- its blade takes nine tenths of what lay there and its salt keeps it from icing a while. A pure function of the
// city and the game clock, like the weather it answers: every screen has the same plows in the same places, and a race
// formed on a snowy day is raced on the roads as the plows had left them then (the arterial just cleared is wet tarmac,
// the side street they haven't reached is snow).
//
// Shifts: one a game day (24 real minutes). If snow lies on the roads at any half-hour of the shift, the fleet leaves its
// depots round the ring at that minute and drives till the shift ends -- a plow a road at a time, choosing at each
// junction what matters (the big roads first) and what nobody has cleared yet, by seeded draws. A game minute is a real
// second, so a plow's metres a game minute are its metres a second: 11 on the big roads, 8 on the streets.

import { hash2 } from "@keel-engine/core";
import { roadField } from "@keel-engine/road";
import type { RoadEdge, RoadField } from "@keel-engine/road";
import { drawsFor } from "./site.ts";
import type { City } from "./types.ts";
import { MINUTES_PER_DAY, ROAD_SNOW, roadSurfaceOf, weatherFor } from "./weather.ts";
import type { Here, RoadSurface, Weather } from "./weather.ts";

/** A shift is a game day. */
export const PLOW_SHIFT = MINUTES_PER_DAY;
/** Metres a game minute (= a real second) on the big roads and on the streets. */
const FAST = 11, SLOW = 8;
/** Road snow (mm) that brings the plows out. */
const CALL_OUT = 4;
/** How the plows rank the roads: the big ones first. */
const PRIORITY: Readonly<Record<RoadEdge["cls"], number>> = { freeway: 6, highway: 6, ramp: 4, arterial: 4, street: 2, alley: 0 };

/** One road a plow drove: which, which way, and the minutes it entered and left it. */
export interface PlowLeg { readonly plow: number; readonly edge: number; readonly fwd: boolean; readonly t0: number; readonly t1: number }
/** Where a plow is: on which road, how far along it (m), which way, and its place and heading in the world. */
export interface PlowAt { readonly plow: number; readonly edge: number; readonly s: number; readonly fwd: boolean; readonly x: number; readonly z: number; readonly yaw: number }

export interface Plows {
  /** How many plows the city has. */
  readonly fleet: number;
  /** The shift's legs (every plow's), or none when the plows stayed in. */
  legs(shift: number): readonly PlowLeg[];
  /** Where every plow out on the road is at a moment (game minutes, fractional: a real second is a game minute). */
  at(minute: number): PlowAt[];
  /** The minutes a plow went over a point of a road (edge, metres along it), before `minute`: this shift's and the last two. */
  passes(edge: number, s: number, minute: number): number[];
  /** What's on a road at a point: the weather's, with the plows' passes (x, z, the ground's height there). */
  road(x: number, z: number, altitude: number, minute: number): Here;
  /** A point's race surface: on a road, as the plows left it; off one, the weather's. */
  surfaceAt(x: number, z: number, altitude: number, minute: number): RoadSurface;
  /** The snow a plow has pushed off the road at a point, this shift and the last two (mm over the road's width): its bank. */
  cleared(edge: number, s: number, x: number, z: number, altitude: number, minute: number): number;
}

export function plowsOf(city: City, weather: Weather = weatherFor(city.site)): Plows {
  const g = city.graph, D = drawsFor(city.site.seed, "plows");
  const index = new Map(g.nodes.map((n, i) => [n.id, i]));
  const roads = g.edges.filter((e) => e.cls !== "alley" && e.path.length > 1);
  const km = roads.reduce((a, e) => a + e.path.length, 0) / 1000;
  const fleet = Math.max(2, Math.min(10, 2 + Math.round(km / 6)));
  // The depots: the ring's junctions (a highway's), spread round it.
  const ringNodes = [...new Set(g.edges.filter((e) => e.cls === "highway").flatMap((e) => [e.a, e.b]))].sort((a, b) => a - b);
  const depots = Array.from({ length: fleet }, (_, i) => ringNodes.length ? ringNodes[Math.floor(((i + D.u("depot")) / fleet) * ringNodes.length) % ringNodes.length]! : g.nodes[0]!.id);

  // A shift's call-out: the first half-hour of it with snow lying on the roads (at the city's middle).
  const callouts = new Map<number, number | null>();
  const callOut = (shift: number): number | null => {
    if (callouts.has(shift)) return callouts.get(shift)!;
    let when: number | null = null;
    for (let m = shift * PLOW_SHIFT; m < (shift + 1) * PLOW_SHIFT; m += 30) {
      if (weather.at(0, 0, 0, m).snow * ROAD_SNOW > CALL_OUT) { when = m; break; }
    }
    callouts.set(shift, when);
    if (callouts.size > 64) callouts.delete(callouts.keys().next().value!);
    return when;
  };

  // A shift's drive: every plow from its depot, a road at a time, till the shift ends.
  const shifts = new Map<number, { legs: PlowLeg[]; byEdge: Map<number, PlowLeg[]> }>();
  const drive = (shift: number): { legs: PlowLeg[]; byEdge: Map<number, PlowLeg[]> } => {
    const hit = shifts.get(shift);
    if (hit) return hit;
    const legs: PlowLeg[] = [], byEdge = new Map<number, PlowLeg[]>();
    const start = callOut(shift);
    if (start !== null) {
      const end = (shift + 1) * PLOW_SHIFT, visits = new Map<number, number>();
      // (In time order -- whichever plow is furthest behind moves next -- so a plow only avoids what's been cleared.)
      const fleetNow = Array.from({ length: fleet }, (_, p) => ({ node: depots[p]!, t: start + p * 2, last: -1, step: 0, done: false }));
      for (let guard = 0; guard < fleet * 4000; guard += 1) {
        let p = -1;
        fleetNow.forEach((q, i) => { if (!q.done && q.t < end && (p < 0 || q.t < fleetNow[p]!.t)) p = i; });
        if (p < 0) break;
        const q = fleetNow[p]!;
        const at = g.at[index.get(q.node)!] ?? [];
        let best = -1, bestScore = -Infinity;
        for (const id of at) {
          const e = g.edges[id]!;
          if (e.cls === "alley" || e.path.length < 2) continue;
          // (A one-way ramp only its own way.)
          if (e.oneWay && e.a !== q.node) continue;
          const seen = visits.get(id) ?? 0;
          const score = PRIORITY[e.cls] * (seen === 0 ? 3 : 1 / (1 + seen)) - (id === q.last ? 20 : 0) + hash2(shift * 131 + p, q.step * 977 + id, 0x5170) * 1.5;
          if (score > bestScore) { bestScore = score; best = id; }
        }
        if (best < 0) { q.done = true; continue; }
        const e = g.edges[best]!, fwd = e.a === q.node || e.a === e.b, speed = PRIORITY[e.cls] >= 4 ? FAST : SLOW;
        const t1 = q.t + e.path.length / speed;
        const leg: PlowLeg = { plow: p, edge: best, fwd, t0: q.t, t1 };
        legs.push(leg);
        const l = byEdge.get(best);
        if (l) l.push(leg); else byEdge.set(best, [leg]);
        visits.set(best, (visits.get(best) ?? 0) + 1);
        q.node = fwd ? e.b : e.a; q.last = best; q.t = t1; q.step += 1;
      }
    }
    const out = { legs, byEdge };
    shifts.set(shift, out);
    if (shifts.size > 8) shifts.delete(shifts.keys().next().value!);
    return out;
  };

  const passes = (edge: number, s: number, minute: number): number[] => {
    const shift = Math.floor(minute / PLOW_SHIFT), out: number[] = [];
    for (let k = shift - 2; k <= shift; k += 1) for (const leg of drive(k).byEdge.get(edge) ?? []) {
      const len = g.edges[edge]!.path.length, f = Math.max(0, Math.min(1, (leg.fwd ? s : len - 1 - s) / Math.max(1, len - 1)));
      const t = leg.t0 + (leg.t1 - leg.t0) * f;
      if (t <= minute) out.push(t);
    }
    return out.sort((a, b) => a - b);
  };

  let field: RoadField | null = null;
  const onRoad = (x: number, z: number): { edge: number; s: number } | null => {
    field ??= roadField(g);
    const at = field.at(x, z);
    return at && Math.abs(at.d) <= Math.abs(at.half) + 0.5 && g.edges[at.edge]!.cls !== "alley" ? { edge: at.edge, s: at.s } : null;
  };
  const road = (x: number, z: number, altitude: number, minute: number): Here => {
    const r = onRoad(x, z);
    return r ? weather.plowed(x, z, altitude, minute, passes(r.edge, r.s, minute)) : weather.at(x, z, altitude, minute);
  };

  const at = (minute: number): PlowAt[] => {
    const out: PlowAt[] = [];
    const seen = new Set<number>();
    for (const leg of drive(Math.floor(minute / PLOW_SHIFT)).legs) {
      if (seen.has(leg.plow) || minute < leg.t0 || minute >= leg.t1) continue;
      seen.add(leg.plow);
      const e = g.edges[leg.edge]!, p = e.path, L = p.length, f = (minute - leg.t0) / (leg.t1 - leg.t0);
      const s = (leg.fwd ? f : 1 - f) * (L - 1), i = Math.max(0, Math.min(L - 2, Math.floor(s))), u = s - i;
      const x = p.x[i]! + (p.x[i + 1]! - p.x[i]!) * u, z = p.z[i]! + (p.z[i + 1]! - p.z[i]!) * u;
      out.push({ plow: leg.plow, edge: leg.edge, s, fwd: leg.fwd, x, z, yaw: p.yaw[i]! + (leg.fwd ? 0 : Math.PI) });
    }
    return out;
  };

  const cleared = (edge: number, s: number, x: number, z: number, altitude: number, minute: number): number => {
    const ps = passes(edge, s, minute);
    let total = 0;
    ps.forEach((t, i) => { total += weather.plowed(x, z, altitude, t - 0.5, ps.slice(0, i)).snow * ROAD_SNOW * 0.9; });
    return total;
  };

  return {
    fleet, at, passes, road, cleared,
    legs: (shift) => drive(shift).legs,
    surfaceAt: (x, z, altitude, minute) => roadSurfaceOf(road(x, z, altitude, minute)),
  };
}

const fleets = new WeakMap<City, Plows>();
/** A city's plows, made once a city. */
export function plowsFor(city: City): Plows {
  let p = fleets.get(city);
  if (!p) { p = plowsOf(city); fleets.set(city, p); }
  return p;
}
