// A WORLD of places from one seed: a big city and the places round it -- a second city over the water, suburbs, towns,
// a works town -- each its own city (its own seed, its own roads, its own blocks and lots), joined by LINKS: freeways
// over the land between them, and now and then a bridge over the sea. Two to nine places; the first is always the
// biggest, and the second always stands over the water from it, a bridge between them (links[0]).
//
// Every place is built in its own frame, its middle at its origin: a game builds one place at a time (its roads, its
// ground, its region round it) and the rest are what it sees on the horizon. Where two places meet is their link: a
// road the WORLD lays, in the world's frame, from one city's portal (where its freeway on the link's bearing ends,
// keel/city arterials.ts portalRadius) to the other's, with its deck's height every metre -- so both places draw it
// the same, and a car driving it passes from one to the other at its SEAM (the middle) on the same deck in both.
//
// Laid out without building a single city: a place's site and its portals are pure functions of its seed and size, so
// the layout -- where each place stands, which way its links leave, where its sea is -- is a few hundred draws.
//
//   const world = generateCityWorld("redline:world:2");
//   const city = worldCity(world, 0, wants);              // the first place's city, its links' freeways out to its portals
//   const region = regionOf(city, regionAround(world, 0)); // the land round it: the other places, the links to them
//
// Pure and deterministic (keel/core dmath, seeded draws by name): the same seed is the same world on every machine.

import { datan2, dcos, dhypot, dsin, fbm2 } from "@keel-engine/core";
import { pathThrough } from "@keel-engine/road";
import type { Path } from "@keel-engine/road";
import { cityReach, portalRadius } from "./arterials.ts";
import { citySite, generateCity } from "./city.ts";
import { drawsFor } from "./site.ts";
import { SEA_LEVEL, groundAt } from "./terrain.ts";
import type { RegionAround, SettlementKind } from "./region-types.ts";
import type { City, CityLink, CityOptions, CitySite, EdgeTrait, LandmarkWant } from "./types.ts";

const TAU = Math.PI * 2;

/** What a place is: the big city, a city, a suburb, a town, a works town. */
export type PlaceKind = "metro" | "city" | "suburb" | "town" | "industrial";

/** A place in a world: what, how big, where, reached from where, and what its city is asked for. */
export interface WorldPlace {
  readonly id: number;
  readonly kind: PlaceKind;
  /** Its city's seed (`<world>|place|<id>`) and slab (m). */
  readonly seed: string;
  readonly size: number;
  /** Its middle in the world's frame (its own frame is the world's, moved here). */
  readonly x: number;
  readonly z: number;
  /** The place it was reached from (-1 for the first), and how many links from the first it is. */
  readonly parent: number;
  readonly depth: number;
  /** Its links (world link ids), in the order its city's options list them (CityOptions.links, City.portals). */
  readonly links: readonly number[];
  /** What its city is built with: its edges (its sea where a bridge leaves) and its links' bearings. */
  readonly options: CityOptions;
}

export type LinkKind = "freeway" | "bridge";

/** A link between two places: the road the world lays from one's portal to the other's. */
export interface WorldLink {
  readonly id: number;
  readonly kind: LinkKind;
  /** The places at its ends (a the one it was laid from), and which of each one's links it is (WorldPlace.links index). */
  readonly a: number;
  readonly b: number;
  readonly at: readonly [number, number];
  /** Its line in the world's frame, a sample a metre, from a's portal to b's. */
  readonly path: Path;
  /** Its deck's height at every sample (m): the same in both places. */
  readonly y: Float64Array;
  /** Metres along it where it passes from a to b: its middle. */
  readonly seam: number;
  /** How high its deck stands over the sea at its highest (bridges; 0 for a freeway over land). */
  readonly clearance: number;
}

export interface CityWorld {
  readonly seed: string;
  readonly places: readonly WorldPlace[];
  readonly links: readonly WorldLink[];
}

export interface CityWorldOptions {
  /** How many places (2..9); absent, the seed decides (four or five most worlds, nine rarely). */
  readonly places?: number;
}

/** How many places a world has, weighted: two now and then, four or five most, nine rarely. */
export const PLACE_COUNT_WEIGHTS: Readonly<Record<number, number>> = { 2: 6, 3: 20, 4: 26, 5: 20, 6: 12, 7: 8, 8: 5, 9: 3 };
/** What the places past the second tend to be (weights). */
const KIND_WEIGHTS: readonly (readonly [PlaceKind, number])[] = [["suburb", 34], ["town", 26], ["industrial", 20], ["city", 20]];
/** Each kind's slab (m): its smallest, and how much bigger the seed may make it. */
const SIZES: Readonly<Record<PlaceKind, readonly [number, number]>> = {
  metro: [3400, 1000], city: [2300, 700], suburb: [1500, 500], town: [1100, 400], industrial: [1300, 400],
};
/** How far apart two places' portals stand over a link (m): over land, per kind reached; over water. */
const LAND_GAP: Readonly<Record<PlaceKind, readonly [number, number]>> = {
  metro: [2400, 2000], city: [2000, 2400], suburb: [900, 900], town: [1200, 1600], industrial: [1000, 1400],
};
const WATER_GAP: readonly [number, number] = [950, 650];
/** The first bridge's water (m): the big crossing, a strait a ship goes up. */
const STRAIT: readonly [number, number] = [1300, 700];
/** How often a link past the first is a bridge: rare, a little less rare off a place already over the water. */
const BRIDGE_ODDS = 0.1, BRIDGE_ODDS_ISLAND = 0.2;
/** Two links out of one place leave at least this far apart (rad); a freeway keeps this far off the place's sea. */
const LINK_APART = 0.95, OFF_THE_SEA = 0.9;
/** The first bridge's deck over the sea at its middle (m), and any other's: a ship goes under the big one. */
const MAIN_CLEAR = 42, BRIDGE_CLEAR = 24;
/** A link's deck at a portal over the water (m): the city's own deck there (keel/city height.ts, BRIDGE_CLEAR over the sea). */
const PORTAL_DECK = SEA_LEVEL + 16;
/** The steepest a link's deck climbs (a freeway's grade). */
const GRADE = 0.045;

const apart = (a: number, b: number): number => { const d = (((a - b) % TAU) + TAU) % TAU; return d > Math.PI ? TAU - d : d; };
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;
const dir = (a: number): [number, number] => [dsin(a), dcos(a)];
const bearing = (x: number, z: number): number => datan2(x, z);

/** A place's settlement kind, as its skyline is drawn from another place's region. */
export const PLACE_SETTLEMENT: Readonly<Record<PlaceKind, SettlementKind>> = { metro: "metro", city: "city", suburb: "town", town: "town", industrial: "industrial" };

interface Draft {
  id: number;
  kind: PlaceKind;
  seed: string;
  size: number;
  x: number;
  z: number;
  parent: number;
  depth: number;
  site: CitySite;
  reach: number;
  edges: { trait: EdgeTrait; bearing: number }[];
  /** Its links so far: world link id, bearing, over water. */
  out: { link: number; bearing: number; bridge: boolean }[];
}

interface LinkDraft { id: number; kind: LinkKind; a: number; b: number; ba: number; bb: number }

/** A world of places from its seed. */
export function generateCityWorld(seed: string, options: CityWorldOptions = {}): CityWorld {
  const W = drawsFor(seed, "world");
  const counts = Object.keys(PLACE_COUNT_WEIGHTS).map(Number), weights = counts.map((c) => PLACE_COUNT_WEIGHTS[c]!);
  const want = Math.max(2, Math.min(9, options.places ?? counts[pickWeighted(W.u("count"), weights)]!));
  const places: Draft[] = [], links: LinkDraft[] = [];

  const draft = (id: number, kind: PlaceKind, size: number, x: number, z: number, parent: number): Draft => {
    const placeSeed = `${seed}|place|${id}`, site = citySite(placeSeed, size);
    return { id, kind, seed: placeSeed, size, x, z, parent, depth: parent < 0 ? 0 : places[parent]!.depth + 1, site, reach: cityReach(site), edges: site.edges.map((e) => ({ ...e })), out: [] };
  };
  const sizeOf = (kind: PlaceKind, tag: string, i: number): number => SIZES[kind][0] + SIZES[kind][1] * W.u(tag, i);
  /** Whether a place `reach` round (x, z) stands clear of every other, and a straight road from p to q clear of the rest. */
  const clear = (x: number, z: number, reach: number, skip: readonly number[]): boolean =>
    places.every((o) => skip.includes(o.id) || dhypot(o.x - x, o.z - z) > o.reach + reach + 700);
  const roadClear = (ax: number, az: number, bx: number, bz: number, skip: readonly number[]): boolean => places.every((o) => {
    if (skip.includes(o.id)) return true;
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / l2));
    return dhypot(ax + dx * t - o.x, az + dz * t - o.z) > o.reach + 300;
  });
  /** Whether a link may leave place p on bearing b: clear of its other links, and a freeway off its sea. */
  const free = (p: Draft, b: number, bridge: boolean): boolean =>
    p.out.every((o) => apart(o.bearing, b) > LINK_APART) && (bridge || p.edges.every((e) => e.trait !== "ocean" || apart(e.bearing, b) > OFF_THE_SEA));
  /** Link p to q (placed): each end's bearing, its sea where it's a bridge, no other trait in a freeway's way. */
  const join = (p: Draft, q: Draft, kind: LinkKind, bp: number, bq: number): void => {
    const id = links.length, bridge = kind === "bridge";
    bp = wrap(bp); bq = wrap(bq);
    links.push({ id, kind, a: p.id, b: q.id, ba: bp, bb: bq });
    for (const [r, b] of [[p, bp], [q, bq]] as const) {
      r.out.push({ link: id, bearing: b, bridge });
      if (bridge) {
        // (A bridge leaves over the sea: the place's own coast, turned to face it, or a new one.)
        const coast = r.edges.find((e) => e.trait === "ocean" && apart(e.bearing, b) < 1.2 && !r.out.some((o) => o.bridge && o.link !== id && apart(o.bearing, e.bearing) < 0.3));
        if (coast) coast.bearing = b; else r.edges.push({ trait: "ocean", bearing: b });
      }
      // (Nothing else stands where a link leaves: no mountain in a freeway's way, no sea but a bridge's own.)
      for (let i = r.edges.length - 1; i >= 0; i -= 1) {
        const e = r.edges[i]!;
        if (apart(e.bearing, b) > OFF_THE_SEA || (bridge && e.trait === "ocean" && e.bearing === b)) continue;
        if (e.trait === "ocean" && r.out.some((o) => o.bridge && o.link !== id && apart(o.bearing, e.bearing) < 0.3)) continue;
        r.edges.splice(i, 1);
      }
    }
  };
  /** Where a place of `reach` goes to be `gap` past p's portal on bearing b (its own portal facing back). */
  const across = (p: Draft, site: CitySite, b: number, gap: number): [number, number] => {
    const d = portalRadius(p.site, b) + gap + portalRadius(site, b + Math.PI), [dx, dz] = dir(b);
    return [p.x + dx * d, p.z + dz * d];
  };

  // ---- the first place: the big city, at the world's middle. Its coast is where the second stands: its own sea if the
  // seed gave it one, else one drawn.
  const first = draft(0, "metro", sizeOf("metro", "size", 0), 0, 0, -1);
  places.push(first);
  const coast = first.edges.find((e) => e.trait === "ocean")?.bearing ?? W.u("coast") * TAU;

  // ---- the second: a city over the water, a bridge to it. Always there, always smaller than the first.
  {
    const size = Math.min(sizeOf("city", "size", 1), first.size - 600), b = coast + W.flat("coastTurn") * 0.15;
    const second = draft(1, "city", size, 0, 0, 0);
    const [x, z] = across(first, second.site, b, STRAIT[0] + STRAIT[1] * W.u("gap", 1));
    second.x = x; second.z = z;
    places.push(second);
    join(first, second, "bridge", b, b + Math.PI);
  }

  // ---- the rest: each off a place already there, over the land (a freeway) or now and then the water (a bridge).
  for (let id = 2, tries = 0; id < want && tries < 160; tries += 1) {
    const kind = KIND_WEIGHTS[pickWeighted(W.u("kind", id, tries), KIND_WEIGHTS.map(([, w]) => w))]![0];
    // (Off the big city most often, then the second, then the rest -- never more than three links out.)
    const parents = places.filter((p) => p.depth < 3 && p.out.length < 4);
    if (!parents.length) break;
    const p = parents[pickWeighted(W.u("parent", id, tries), parents.map((q) => (q.id === 0 ? 4 : q.id === 1 ? 2.5 : 1.2)))]!;
    const island = p.out.some((o) => o.bridge);
    const bridge = W.u("bridge", id, tries) < (island ? BRIDGE_ODDS_ISLAND : BRIDGE_ODDS);
    const b = bridge ? (p.edges.find((e) => e.trait === "ocean" && free(p, e.bearing, true))?.bearing ?? W.u("bearing", id, tries) * TAU) + W.flat("turn", id, tries) * 0.2 : W.u("bearing", id, tries) * TAU;
    if (!free(p, b, bridge)) continue;
    const size = kind === "city" ? Math.min(sizeOf(kind, "size", id), first.size - 600) : sizeOf(kind, "size", id);
    const next = draft(id, kind, size, 0, 0, p.id);
    const gap = bridge ? WATER_GAP[0] + WATER_GAP[1] * W.u("gap", id, tries) : LAND_GAP[kind][0] + LAND_GAP[kind][1] * W.u("gap", id, tries);
    const [x, z] = across(p, next.site, b, gap);
    if (!clear(x, z, next.reach, [])) continue;
    const [pdx, pdz] = dir(b), pr = portalRadius(p.site, b);
    if (!roadClear(p.x + pdx * pr, p.z + pdz * pr, x - pdx * portalRadius(next.site, b + Math.PI), z - pdz * portalRadius(next.site, b + Math.PI), [p.id])) continue;
    // (A freeway doesn't run out into the other place's sea either: the new place's own coast turns away, or goes.)
    next.x = x; next.z = z;
    places.push(next);
    join(p, next, bridge ? "bridge" : "freeway", b, b + Math.PI);
    id += 1;
  }

  // ---- a freeway or two between places already there, where one can run clear: the places a web, not a tree.
  const extras = W.u("extras") < 0.45 ? 1 + (W.u("extras2") < 0.3 ? 1 : 0) : 0;
  for (let k = 0, tries = 0; k < extras && tries < 60 && places.length > 2; tries += 1) {
    const i = Math.floor(W.u("ei", tries) * places.length), j = Math.floor(W.u("ej", tries) * places.length);
    const p = places[i]!, q = places[j]!;
    if (i === j || links.some((l) => (l.a === i && l.b === j) || (l.a === j && l.b === i)) || p.out.length >= 4 || q.out.length >= 4) continue;
    const bp = bearing(q.x - p.x, q.z - p.z), bq = bp + Math.PI;
    if (!free(p, bp, false) || !free(q, bq, false)) continue;
    const [dx, dz] = dir(bp), ap = portalRadius(p.site, bp), aq = portalRadius(q.site, bq), d = dhypot(q.x - p.x, q.z - p.z);
    if (d - ap - aq < 900 || d - ap - aq > 7000) continue;
    if (!roadClear(p.x + dx * ap, p.z + dz * ap, q.x - dx * aq, q.z - dz * aq, [i, j])) continue;
    join(p, q, "freeway", bp, bq);
    k += 1;
  }

  // ---- the places as a game builds them, and the links' roads.
  const out: WorldPlace[] = places.map((p) => ({
    id: p.id, kind: p.kind, seed: p.seed, size: p.size, x: p.x, z: p.z, parent: p.parent, depth: p.depth,
    links: p.out.map((o) => o.link),
    options: { edges: p.edges.map((e) => ({ trait: e.trait, bearing: e.bearing })), links: p.out.map((o): CityLink => ({ bearing: o.bearing, bridge: o.bridge })) },
  }));
  const roads = links.map((l) => layLink(seed, l, places[l.a]!, places[l.b]!));
  return { seed, places: out, links: roads };
}

/** The index a weighted draw lands on (u in 0..1). */
function pickWeighted(u: number, w: readonly number[]): number {
  let x = u * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i += 1) { x -= w[i]!; if (x < 0) return i; }
  return w.length - 1;
}

/**
 * A link's road: out of a's portal square on its bearing, a gentle swing across the land (a bridge barely bends), into
 * b's portal square on its. Its deck: level with each end's city at its portal, over a bridge climbing at a freeway's
 * grade to its clearance over the sea, over land rolling gently with it.
 */
function layLink(seed: string, l: LinkDraft, a: Draft, b: Draft): WorldLink {
  const L = drawsFor(seed, `link|${l.id}`), bridge = l.kind === "bridge";
  const ra = portalRadius(a.site, l.ba), rb = portalRadius(b.site, l.bb);
  const [adx, adz] = dir(l.ba), [bdx, bdz] = dir(l.bb);
  const ax = a.x + adx * ra, az = a.z + adz * ra, bx = b.x + bdx * rb, bz = b.z + bdz * rb;
  const span = dhypot(bx - ax, bz - az), lead = Math.min(320, span / 4);
  // (Square out of each portal for a lead, then through a middle pushed off the straight line by the seed.)
  const nx = -(bz - az) / span, nz = (bx - ax) / span;
  const bend = L.flat("bend") * Math.min(span * (bridge ? 0.05 : 0.14), bridge ? 110 : 600);
  const xs = [ax, ax + adx * lead, (ax + bx) / 2 + nx * bend, bx + bdx * lead, bx];
  const zs = [az, az + adz * lead, (az + bz) / 2 + nz * bend, bz + bdz * lead, bz];
  const path = pathThrough(xs, zs, { smooth: 8 });
  const n = path.length, y = new Float64Array(n);
  const endY = (p: Draft, x: number, z: number): number => (bridge ? PORTAL_DECK : Math.max(0.5, groundAt({ ...p.site, edges: p.edges }, x - p.x, z - p.z).height));
  const y0 = endY(a, ax, az), y1 = endY(b, bx, bz);
  const clearance = bridge ? (l.id === 0 ? MAIN_CLEAR : BRIDGE_CLEAR) : 0;
  const seedN = L.u("roll") * 1e6;
  for (let i = 0; i < n; i += 1) {
    const t = i / Math.max(1, n - 1);
    if (bridge) { y[i] = Math.min(SEA_LEVEL + clearance, y0 + GRADE * i, y1 + GRADE * (n - 1 - i)); continue; }
    // (Over land: straight between its ends, rolling a few metres with the land it crosses -- nothing at the ends.)
    const roll = Math.min(12, n * 0.004) * dsin(Math.PI * t) * (fbm2(t * n / 900, 0.5, seedN, 2) * 2 - 1);
    y[i] = y0 + (y1 - y0) * t + roll;
  }
  // (Rounded over its crest and into its dips: a running average over ~80 m, its ends held.)
  const smooth = Float64Array.from(y);
  for (let i = 1; i < n - 1; i += 1) {
    const w = Math.min(40, i, n - 1 - i);
    let s = 0;
    for (let k = i - w; k <= i + w; k += 1) s += y[k]!;
    smooth[i] = s / (2 * w + 1);
  }
  // (Held to the grade both ways, its ends where they are.)
  const g = GRADE * 0.98;
  for (let i = 1; i < n - 1; i += 1) smooth[i] = Math.min(Math.max(smooth[i]!, smooth[i - 1]! - g), smooth[i - 1]! + g);
  for (let i = n - 2; i > 0; i -= 1) smooth[i] = Math.min(Math.max(smooth[i]!, smooth[i + 1]! - g), smooth[i + 1]! + g);
  return { id: l.id, kind: l.kind, a: l.a, b: l.b, at: [a.out.findIndex((o) => o.link === l.id), b.out.findIndex((o) => o.link === l.id)], path, y: smooth, seam: Math.floor(n / 2), clearance };
}

/** A place's city: its seed, its slab, its sea and its links' freeways out to their portals (City.portals, in link order). */
export function worldCity(world: CityWorld, place: number, wants: readonly LandmarkWant[] = [], options: CityOptions = {}): City {
  const p = world.places[place]!;
  return generateCity(p.seed, p.size, null, wants, { ...options, ...p.options });
}

/** A place's middle and slab: what its skyline stands on from another place, and how far out its own ground runs. */
function placeGround(p: WorldPlace): { core: number; land: number } {
  const site = citySite(p.seed, p.size, null, p.options);
  return { core: site.core, land: cityReach(site) + 60 };
}

/**
 * What a place's REGION sees of its world, in the place's own frame: every other place within `reach` of it (each on its
 * own dry ground, its skyline), and every link that comes within it -- its own links from its portals, and the others
 * crossing its land. keel/city region.ts cityRegion(city, around) lays its land round them.
 */
export function regionAround(world: CityWorld, place: number, reach = 9000): RegionAround {
  const me = world.places[place]!;
  const places = world.places.filter((p) => p.id !== place && dhypot(p.x - me.x, p.z - me.z) < reach + 4000).map((p) => {
    const g = placeGround(p), D = drawsFor(p.seed, "skyline");
    const top = p.kind === "metro" ? 200 + 120 * D.u("top") : p.kind === "city" ? 90 + 70 * D.u("top") : p.kind === "industrial" ? 20 + 12 * D.u("top") : 16 + 14 * D.u("top");
    return { place: p.id, kind: PLACE_SETTLEMENT[p.kind], x: p.x - me.x, z: p.z - me.z, r: g.core, land: g.land, top, seed: p.seed };
  });
  const roads = world.links.filter((l) => {
    for (let i = 0; i < l.path.length; i += 50) if (dhypot(l.path.x[i]! - me.x, l.path.z[i]! - me.z) < reach) return true;
    return false;
  }).map((l) => {
    // (Its own links run out from its portal: the end at this place first.)
    const back = l.b === place, n = l.path.length, x = new Float64Array(n), z = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i += 1) { const k = back ? n - 1 - i : i; x[i] = l.path.x[k]! - me.x; z[i] = l.path.z[k]! - me.z; y[i] = l.y[k]!; }
    const at = l.a === place ? l.at[0] : l.b === place ? l.at[1] : -1;
    return { link: l.id, portal: at, bridge: l.kind === "bridge", x, z, y };
  });
  return { places, roads };
}

/** Which place a world point is in: the one whose middle is nearest, counting its own ground's reach (-1: none near). */
export function placeAt(world: CityWorld, x: number, z: number): number {
  let best = -1, bd = Infinity;
  for (const p of world.places) {
    const d = dhypot(x - p.x, z - p.z) / (placeGround(p).land + 600);
    if (d < 1 && d < bd) { bd = d; best = p.id; }
  }
  return best;
}
