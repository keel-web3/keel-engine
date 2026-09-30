// The streets' furniture, placed the way a city's engineers would: first what
// the junctions need -- at each, a signal on the corner beside every stop line
// where an arterial meets it (a signpost where streets meet), behind the kerb
// return, never in the carriageway; then lamps along every road, staggered
// side to side at their class's spacing (high masts on the highway); then bus
// shelters mid-block on the arterials; then street trees, set back from the
// kerb far enough that their crowns stay over the pavement (or drawn smaller);
// then the district's small furniture, sparse. Every piece keeps its distance
// from every other (a disc each, and a gap by kind), and stays out of the
// junctions' boxes, crossings and sight lines, and the ways into every lot's
// door. All of it a function of the city's seed and each road's id, gathered
// into chunks (one mesh each) on a 200 m grid.

import { SIDEWALK, blockCentre, drawsFor, streetsOf } from "@keel-engine/city";
import { dcos, dsin } from "@keel-engine/core";
import type { City, CityHeight, District, DistrictKind, JunctionArm, Obb } from "@keel-engine/city";
import type { RoadEdge } from "@keel-engine/road";
import { placerAt } from "../frame.ts";
import { frameOf } from "../plan.ts";
import type { AdSlotSpec, FurnitureKind, LightSpot, PlantKind, PlantSpot, PropPart, PropSpot, Solid, StreetCatalogue, StreetSign } from "../types.ts";
import { furniture, lamp, signal, signpost, tree } from "./furniture.ts";
import { planInfraSteps } from "./infra.ts";
import { trafficSign, trafficSignRadius } from "./roadside.ts";
import { districtBlockIndex } from "./district-index.ts";
import type { TrafficSignKind } from "./roadside.ts";

export interface StreetChunk {
  /** Stable: the catalogue's version, the city's seed and the chunk's grid cell. */
  readonly key: string;
  /** The district its middle is in (its look). */
  readonly district: number;
  readonly solids: readonly Solid[];
}
export interface StreetPlan {
  readonly chunks: readonly StreetChunk[];
  readonly lights: readonly LightSpot[];
  readonly props: readonly PropSpot[];
  /** Each of `props`' own solids in the chunks (same order; null where it has none there -- infrastructure, pylons). */
  readonly parts?: readonly (PropPart | null)[];
  /** Street trees (foliage sprites) and the bus shelters' ad panels. */
  readonly plants: readonly PlantSpot[];
  readonly ads: readonly AdSlotSpec[];
  /** Long things a car hits along the highway -- guard rails, sound walls -- as boxes on the ground (world). */
  readonly barriers: readonly Obb[];
  /** Boards with words on them: the exit gantries' (what a renderer letters). */
  readonly signs: readonly StreetSign[];
}

/** What the city's grid hands the streets (none of it needed): substations to run a line in to, feeds from the land round it. */
export interface StreetGrid {
  readonly substations?: readonly { readonly x: number; readonly z: number }[];
  readonly feeds?: readonly { readonly x: number; readonly z: number }[];
}

const CHUNK = 200;
/** The clear walking width left on a pavement behind anything at its kerb side (m). */
const WALK = 1.2;
/** A piece's footprint (its disc, m) and the gap it keeps to any other piece (m, the larger of the two gaps wins). */
const FOOT: Readonly<Record<FurnitureKind | "lamp" | "signal" | "signpost", { r: number; gap: number }>> = {
  lamp: { r: 0.3, gap: 2 }, signal: { r: 0.3, gap: 1 }, signpost: { r: 0.15, gap: 1 },
  busStop: { r: 2.2, gap: 6 }, tree: { r: 0.8, gap: 5 }, bench: { r: 1, gap: 4 }, bin: { r: 0.35, gap: 5 },
  hydrant: { r: 0.25, gap: 5 }, newsBoxes: { r: 0.9, gap: 5 }, planter: { r: 0.8, gap: 5 }, bollards: { r: 3, gap: 4 },
};
/** Metres from a lot's door (and the way from it to the kerb) nothing stands. */
const DOOR_CLEAR = 3;

/** A point of a road at arc length s, and its heading (samples a metre apart). */
const along = (e: RoadEdge, s: number): { x: number; z: number; yaw: number } => {
  const i = Math.max(0, Math.min(e.path.length - 2, Math.floor(s))), t = Math.max(0, Math.min(1, s - i)), p = e.path;
  return { x: p.x[i]! + (p.x[i + 1]! - p.x[i]!) * t, z: p.z[i]! + (p.z[i + 1]! - p.z[i]!) * t, yaw: p.yaw[i]! };
};

/** The streets' furniture (standing on the city's height, if given). */
/** Roads dressed as a highway (masts on the verge, no pavement furniture): the ring, the freeways and their ramps. */
const motorway = (cls: RoadEdge["cls"]): boolean => cls === "highway" || cls === "freeway" || cls === "ramp";

export function planStreets(sc: StreetCatalogue, city: City, height?: CityHeight, grid: StreetGrid = {}): StreetPlan {
  const steps = planStreetsSteps(sc, city, height, grid);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}

/** The synchronous street planner's source, paused between ordered placement batches. */
export function* planStreetsSteps(sc: StreetCatalogue, city: City, height?: CityHeight, grid: StreetGrid = {}): Generator<number, StreetPlan, void> {
  const yAt = (x: number, z: number): number => (height ? height.heightAt(x, z) : 0);
  const g = city.graph, streets = streetsOf(g);
  const centres = city.blocks.map(blockCentre);
  const blockDistrict = new Map<number, number>();
  for (const l of city.lots) blockDistrict.set(l.block, l.district);
  const nearestDistrictBlock = districtBlockIndex(centres, blockDistrict);
  /** The district a point is in: its nearest block's. */
  const districtAt = (x: number, z: number): District => {
    const best = nearestDistrictBlock(x, z);
    return city.districts[blockDistrict.get(best) ?? 0]!;
  };
  const chunks = new Map<string, { district: number; solids: Solid[] }>();
  const lights: LightSpot[] = [], props: PropSpot[] = [], plants: PlantSpot[] = [], ads: AdSlotSpec[] = [], barriers: Obb[] = [], signs: StreetSign[] = [];
  // (Where each chunk stood when a piece was last started in it: a prop pushed after its piece owns the solids since.)
  const starts = new Map<string, number>(), partOf = new Map<PropSpot, { key: string; from: number; to: number }>();
  const chunkAt = (x: number, z: number): Solid[] => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(key);
    if (!c) { c = { district: districtAt((Math.floor(x / CHUNK) + 0.5) * CHUNK, (Math.floor(z / CHUNK) + 0.5) * CHUNK).id, solids: [] }; chunks.set(key, c); }
    starts.set(key, c.solids.length);
    return c.solids;
  };
  /** A prop just pushed: the solids its piece put in its chunk. */
  const note = (q: PropSpot): void => {
    const key = `${Math.floor(q.x / CHUNK)},${Math.floor(q.z / CHUNK)}`, c = chunks.get(key), from = starts.get(key);
    if (c && from !== undefined) partOf.set(q, { key, from, to: c.solids.length });
  };
  const pushProp = (q: PropSpot): void => { props.push(q); note(q); };

  // ---- what's already standing: a disc each in a 16 m hash, so nothing lands on anything else.
  const placed = new Map<string, { x: number; z: number; r: number; gap: number }[]>();
  const HC = 16;
  const roomAt = (x: number, z: number, r: number, gap: number): boolean => {
    const cx = Math.floor(x / HC), cz = Math.floor(z / HC);
    for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) for (const o of placed.get(`${cx + a},${cz + b}`) ?? []) {
      const dx = o.x - x, dz = o.z - z, need = o.r + r + Math.max(o.gap, gap);
      if (dx * dx + dz * dz < need * need) return false;
    }
    return true;
  };
  const clear = (x: number, z: number, r: number): boolean => {
    const cx = Math.floor(x / HC), cz = Math.floor(z / HC);
    for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) for (const o of placed.get(`${cx + a},${cz + b}`) ?? []) {
      const dx = o.x - x, dz = o.z - z, need = o.r + r + 0.1;
      if (dx * dx + dz * dz < need * need) return false;
    }
    return true;
  };
  const claim = (x: number, z: number, r: number, gap: number): void => {
    const k = `${Math.floor(x / HC)},${Math.floor(z / HC)}`, l = placed.get(k) ?? [];
    l.push({ x, z, r, gap }); placed.set(k, l);
  };
  // ---- the ways into the lots: each building's door, and the line from it out to the kerb.
  const doors: { x: number; z: number; fx: number; fz: number }[] = [];
  for (const lot of city.lots) {
    if (lot.height[1] <= 0) continue;
    const f = frameOf(lot), fx = dsin(f.yaw), fz = dcos(f.yaw);
    doors.push({ x: f.x + fx * f.hd, z: f.z + fz * f.hd, fx, fz });
  }
  const doorHash = new Map<string, number[]>();
  doors.forEach((d, i) => { const k = `${Math.floor(d.x / 32)},${Math.floor(d.z / 32)}`, l = doorHash.get(k) ?? []; l.push(i); doorHash.set(k, l); });
  yield 0.08;
  const byDoor = (x: number, z: number, r: number): boolean => {
    const cx = Math.floor(x / 32), cz = Math.floor(z / 32);
    for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) for (const i of doorHash.get(`${cx + a},${cz + b}`) ?? []) {
      const d = doors[i]!, t = Math.max(0, Math.min(12, (x - d.x) * d.fx + (z - d.z) * d.fz)), qx = x - d.x - d.fx * t, qz = z - d.z - d.fz * t;
      if (qx * qx + qz * qz < (DOOR_CLEAR + r) * (DOOR_CLEAR + r)) return true;
    }
    return false;
  };

  /** A spot on a road's pavement: `out` m from its carriageway's edge on one side, at arc length s. */
  const spot = (e: RoadEdge, side: 1 | -1, s: number, out: number): { x: number; z: number; yaw: number } => {
    const q = along(e, s), off = side * (e.half + out);
    return { x: q.x + dcos(q.yaw) * off, z: q.z - dsin(q.yaw) * off, yaw: q.yaw };
  };
  /**
   * Whether a disc of radius r at a point stands on this road's pavement: clear of the carriageway (the kerb returns
   * included) by `kerbClear`, inside the pavement's back edge, not on a crossing or in a junction's box -- and, unless
   * it's a post, out of the sight lines.
   */
  const fits = (e: RoadEdge, x: number, z: number, r: number, post: boolean, kerbClear: number): boolean => {
    const at = streets.at(x, z);
    if (!at) return motorway(e.cls);
    if (at.kerb - r < kerbClear) return false;
    if (!motorway(e.cls) && (at.edge !== e.id || at.kerb > at.kerbW + at.slabW - 0.2)) return false;
    // (Nothing on a crossing, its dropped kerbs or the landing either side of it, nor in a junction's box.)
    if (at.nearCrossing || at.box) return false;
    if (!post && at.sight) return false;
    return true;
  };

  // ---------------------------------------------------------------- junctions: signals and signposts on the corners.
  let junctionIndex = 0;
  for (const j of streets.junctions) {
    if (junctionIndex++ % 8 === 0) yield 0.08 + 0.12 * junctionIndex / Math.max(1, streets.junctions.length);
    const D = drawsFor(city.site.seed, `junction|${j.node}`);
    // (Signals where two arterials cross; where a street meets one, its stop line and a post will do.)
    const arterialRoads = new Set(j.arms.filter((a) => a.cls === "arterial").map((a) => a.group));
    const signals = arterialRoads.size >= 2 && !j.arms.some((a) => a.cls === "highway");
    // (Where motorways only meet -- a freeway's merge or diverge, a ramp's gore -- nobody stops: no post, no signal.)
    if (j.arms.every((a) => motorway(a.cls))) continue;
    j.arms.forEach((a: JunctionArm, k) => {
      if (a.stop === null) return;
      const e = g.edges[a.edge]!, L = e.path.length - 1;
      const s = a.atStart ? a.stop + 1 : L - a.stop - 1;
      if (s < 1 || s > L - 1) return;
      // (Traffic coming in keeps right: at a road's start its kerb is on the road's left, at its end on its right.)
      const side: 1 | -1 = a.atStart ? -1 : 1, kerbW = SIDEWALK[e.cls].kerb;
      const toward = a.atStart ? along(e, s).yaw + Math.PI : along(e, s).yaw;
      // (Signals on two opposite corners -- every approach sees one across the junction -- ahead of each's own stop line.)
      if (signals && k % 2 === 0) {
        const p = spot(e, side, s, kerbW + 0.55);
        if (fits(e, p.x, p.z, FOOT.signal.r, true, kerbW + 0.2) && roomAt(p.x, p.z, FOOT.signal.r, FOOT.signal.gap)) {
          const r = signal(placerAt(D, p.x, p.z, toward + Math.PI, chunkAt(p.x, p.z), plants, ads, yAt(p.x, p.z)), e.half * 0.6, e.cls === "arterial" ? "signalGreen" : "signalRed");
          pushProp({ kind: "signal", x: p.x, z: p.z, r, breaks: true });
          claim(p.x, p.z, FOOT.signal.r, FOOT.signal.gap);
        }
      }
      // (A signpost on one corner where there are no signals: the street names, and its stop sign.)
      if (!signals && k === 0) {
        const p = spot(e, side, s + (a.atStart ? 1.5 : -1.5), kerbW + 1.6);
        if (fits(e, p.x, p.z, FOOT.signpost.r, true, kerbW + 0.2) && roomAt(p.x, p.z, FOOT.signpost.r, FOOT.signpost.gap)) {
          pushProp({ kind: "signpost", x: p.x, z: p.z, r: signpost(placerAt(D, p.x, p.z, toward, chunkAt(p.x, p.z), plants, ads, yAt(p.x, p.z))), breaks: true });
          claim(p.x, p.z, FOOT.signpost.r, FOOT.signpost.gap);
        }
      }
    });
  }

  // ---------------------------------------------------------------- along every road.
  interface Run { e: RoadEdge; kind: DistrictKind | "highway"; s0: number; s1: number; lampS0: number; lampS1: number; D: ReturnType<typeof drawsFor> }
  const runs: Run[] = [];
  const armAt = new Map<string, JunctionArm>();
  for (const j of streets.junctions) for (const a of j.arms) armAt.set(`${a.edge}|${a.atStart ? 0 : 1}`, a);
  let edgeIndex = 0;
  for (const e of g.edges) {
    if (edgeIndex++ % 16 === 0) yield 0.2 + 0.08 * edgeIndex / Math.max(1, g.edges.length);
    const D = drawsFor(city.site.seed, `street|${e.id}`), L = e.path.length - 1;
    const mid = along(e, L / 2), kind: DistrictKind | "highway" = motorway(e.cls) ? "highway" : districtAt(mid.x, mid.z).kind;
    const a0 = armAt.get(`${e.id}|0`), a1 = armAt.get(`${e.id}|1`);
    // (Furniture keeps out of the sight lines at each end; a lamp may stand in them, but not before its crossing.)
    const s0 = a0 ? a0.sight : 4, s1 = L - (a1 ? a1.sight : 4);
    const lampS0 = a0 ? (a0.crossing ? a0.crossing[1] : a0.box) + 2.5 : 3, lampS1 = L - (a1 ? (a1.crossing ? a1.crossing[1] : a1.box) + 2.5 : 3);
    runs.push({ e, kind, s0, s1, lampS0, lampS1, D });
  }

  /** Put a piece on one side of a road near arc length s (nudged along a little to find room); whether it went down. */
  const put = (run: Run, side: 1 | -1, s: number, out: number, r: number, gap: number, post: boolean, kerbClear: number, from: number, to: number, make: (x: number, z: number, yaw: number) => void): boolean => {
    for (const nudge of [0, 1.5, -1.5, 3, -3]) {
      const t = s + nudge;
      if (t < from || t > to) continue;
      const p = spot(run.e, side, t, out);
      if (!fits(run.e, p.x, p.z, r, post, kerbClear) || !roomAt(p.x, p.z, r, gap) || (!post && byDoor(p.x, p.z, r))) continue;
      make(p.x, p.z, p.yaw);
      claim(p.x, p.z, r, gap);
      return true;
    }
    return false;
  };

  // Lamps: staggered side to side at the class's spacing, at the kerb (a highway's masts out on its verge).
  let lampRun = 0;
  for (const run of runs) {
    if (lampRun++ % 2 === 0) yield 0.28 + 0.12 * lampRun / Math.max(1, runs.length);
    const { e, kind, D } = run;
    const spacing = sc.spacing[e.cls], style = sc.lampStyles[(kind !== "highway" ? sc.lampsBy?.[kind]?.[e.cls] : undefined) ?? sc.lamps[kind]];
    if (!(spacing > 0) || !style || run.lampS1 - run.lampS0 < 4) continue;
    const kerbW = SIDEWALK[e.cls].kerb, out = motorway(e.cls) ? kerbW + 2 : kerbW + 0.5;
    // (A span shorter than half the spacing -- a stub between two junctions' crossings -- is lit by theirs.)
    const span = run.lampS1 - run.lampS0, n = Math.round(span / spacing), step = span / Math.max(1, n);
    const first: 1 | -1 = D.u("lampSide") < 0.5 ? 1 : -1;
    for (let k = 0; k < n; k += 1) {
      const side: 1 | -1 = k % 2 ? (-first as 1 | -1) : first, s = run.lampS0 + step * (k + 0.5);
      put(run, side, s, out, FOOT.lamp.r, FOOT.lamp.gap, true, kerbW + 0.15, run.lampS0, run.lampS1, (x, z, yaw) => {
        const l = lamp(placerAt(D, x, z, yaw - (side * Math.PI) / 2, chunkAt(x, z), plants, ads, yAt(x, z)), style);
        lights.push(...l.lights);
        pushProp({ kind: "lamp", x, z, r: Math.max(0.25, l.r), breaks: true });
      });
    }
  }

  // Road signs repeat through long stretches, with separate seeded designs at every placement.
  // Endpoints follow the junction/one-way data; bends follow the road, and parking belongs to ordinary streets.
  let signRun = 0;
  for (const run of runs) {
    if (signRun++ % 2 === 0) yield 0.4 + 0.12 * signRun / Math.max(1, runs.length);
    const { e } = run, highway = motorway(e.cls), kerbW = SIDEWALK[e.cls].kerb;
    const every = sc.signEvery?.[e.cls] ?? (highway ? 180 : e.cls === "arterial" ? 95 : 75);
    if (!(every > 0) || e.bridge) continue;
    const from = Math.max(run.s0 + 2, highway ? 24 : 4), to = Math.min(run.s1 - 2, e.path.length - (highway ? 24 : 5)), span = to - from;
    if (span < 4) continue;
    const n = span < 24 ? 1 : Math.max(2, Math.ceil(span / every) + 1);
    const roadDraw = drawsFor(city.site.seed, `sign-limit|${e.id}`);
    const speeds = e.cls === "freeway" ? [100, 110, 120] : e.cls === "highway" ? [70, 80, 90] : e.cls === "ramp" ? [40, 50, 60] : e.cls === "arterial" ? [40, 50, 60] : e.cls === "alley" ? [20] : [20, 30, 40];
    const limit = speeds[Math.floor(roadDraw.u("limit") * speeds.length)]!;
    for (const side of [1, -1] as const) for (let k = 0; k < n; k++) {
      const D = drawsFor(city.site.seed, `sign|${e.id}|${side}|${k}`);
      const at = from + (n === 1 ? span / 2 : span * k / (n - 1));
      const entering = side > 0 ? k === 0 : k === n - 1, leaving = side > 0 ? k === n - 1 : k === 0;
      const endpoint = armAt.get(`${e.id}|${side > 0 ? 1 : 0}`);
      const ahead = along(e, Math.max(0, Math.min(e.path.length - 2, at + side * 24))), here = along(e, at);
      const delta = ahead.yaw - here.yaw, turn = delta - Math.round(delta / (2 * Math.PI)) * 2 * Math.PI;
      const direction: -1 | 1 = turn < 0 ? -1 : 1;
      let kind: TrafficSignKind = "speed";
      if (e.oneWay) kind = side < 0 ? (entering ? "no-entry" : "one-way") : entering ? "speed" : "one-way";
      else if (entering) kind = "speed";
      else if (Math.abs(turn) > .12) kind = k % 2 ? "bend" : "chevron";
      else if (leaving && (e.cls === "street" || e.cls === "alley") && endpoint && endpoint.stop !== null) kind = "stop";
      else if (leaving && !highway && endpoint?.crossing) kind = "crossing";
      else if (leaving && !highway && endpoint?.stop !== null && endpoint) kind = e.cls === "arterial" ? "yield" : "stop";
      else if (highway) kind = e.cls === "ramp" || k % 2 ? "merge" : "speed";
      else kind = D.u("parking") < .55 ? "parking" : "no-parking";
      const variant = Math.floor(D.u("variant") * 24), radius = trafficSignRadius(kind, variant);
      put(run, side, at, kerbW + (highway ? 2.5 : 1), radius, 2, false, kerbW + .2, from, to, (x, z, yaw) => {
        const p = placerAt(D, x, z, yaw + (side > 0 ? Math.PI : 0), chunkAt(x, z), plants, ads, yAt(x, z));
        const sign = { kind, limit, variant, direction, road: e.id };
        pushProp({ kind: "sign", sign, x, z, r: trafficSign(p, kind, limit, sign), breaks: true });
      });
    }
  }

  // Then each district's furniture, rule by rule across every road (bus stops and trees first: they need the room).
  const order: FurnitureKind[] = ["busStop", "tree", "bench", "planter", "newsBoxes", "bin", "hydrant", "bollards"];
  let furnitureRun = 0;
  for (const want of order) {
    for (const run of runs) {
      if (furnitureRun++ % 4 === 0) yield 0.52 + 0.36 * furnitureRun / Math.max(1, order.length * runs.length);
      const { e, kind, D } = run;
      if (kind === "highway") continue;
      const kerbW = SIDEWALK[e.cls].kerb, slabW = SIDEWALK[e.cls].slab;
      if (run.s1 - run.s0 < 8) continue;
      (sc.furniture[kind] ?? []).forEach((rule, ri) => {
        if (rule.kind !== want || !rule.roads.includes(e.cls)) return;
        const foot = FOOT[rule.kind];
        // Where across the pavement: most things at the kerb side; benches and news boxes by the buildings; a bus
        // shelter at the back, its roof over the pavement; a tree as far out as its crown needs.
        let out = kerbW + 0.6, scale = 1, kerbClear = kerbW + 0.15;
        if (rule.kind === "bench" || rule.kind === "newsBoxes") { if (slabW < 2.8) return; out = kerbW + slabW - 0.8; }
        if (rule.kind === "busStop") { if (slabW < 3.5) return; out = kerbW + slabW - 1; kerbClear = 0.5; }
        if (rule.kind === "tree") {
          const plant: PlantKind = rule.plant ?? "street", crown = sc.crowns?.[plant] ?? 2;
          // (The crown stays over the pavement: the tree as far back as its crown reaches, leaving the walk behind it --
          // or, where the pavement's too narrow for that, a smaller tree; too narrow even so, none.)
          const most = kerbW + slabW - WALK;
          out = Math.max(kerbW + 1, crown + 0.3);
          if (out > most) { scale = (most - 0.3) / crown; out = most; }
          if (scale < 0.65) return;
          // (fits() measures the disc's edge from the kerb: the crown's reach less the trunk's disc.)
          kerbClear = crown * scale + 0.2 - FOOT.tree.r;
        }
        // Along the road: every `every` metres give or take a fifth. Palms line both sides of an arterial (a boulevard,
        // each side its own phase), other trees alternate sides; anything else takes one side or the other.
        const both = rule.kind === "tree" && e.cls !== "street" && rule.plant === "palm";
        for (const lane of both ? [1, -1] as const : [0] as const) {
          const tag = ri * 3 + (lane > 0 ? 0 : lane < 0 ? 1 : 2);
          for (let s = run.s0 + D.u("phase", tag) * rule.every, n = 0; s <= run.s1; s += rule.every * (0.8 + 0.4 * D.u("gap", tag, n)), n += 1) {
            if (D.u("chance", tag, n) >= rule.chance) continue;
            const side: 1 | -1 = lane !== 0 ? lane : rule.kind === "tree" ? (n % 2 ? 1 : -1) : D.u("side", tag, n) < 0.5 ? 1 : -1;
            put(run, side, s, out, foot.r, foot.gap, false, kerbClear, run.s0, run.s1, (x, z, yaw) => {
              const p = placerAt(D, x, z, yaw - (side * Math.PI) / 2, chunkAt(x, z), plants, ads, yAt(x, z));
              if (rule.kind === "tree") { tree(p, 0, 0, scale, rule.plant ?? "street"); pushProp({ kind: "tree", x, z, r: 0.35 * scale, breaks: false }); return; }
              pushProp({ kind: rule.kind, x, z, r: furniture(p, rule.kind, rule.plant), breaks: rule.kind !== "busStop" });
            });
          }
        }
      });
    }
  }

  // Then the roadside's infrastructure: the highway's furniture, the power lines, utility poles, masts.
  if (sc.infra) {
    yield 0.9;
    const cells = new Map<string, number[]>();
    centres.forEach(([cx, cz], i) => { if (!blockDistrict.has(i)) return; const k = `${Math.floor(cx / 128)},${Math.floor(cz / 128)}`, l = cells.get(k) ?? []; l.push(i); cells.set(k, l); });
    const blockDist = (x: number, z: number): number => {
      let best = Infinity;
      for (let ring = 0; ring < 6 && best > ring * 128 - 128; ring += 1) for (let a = -ring; a <= ring; a += 1) for (let b = -ring; b <= ring; b += 1) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
        for (const i of cells.get(`${Math.floor(x / 128) + a},${Math.floor(z / 128) + b}`) ?? []) { const [cx, cz] = centres[i]!; best = Math.min(best, Math.sqrt((cx - x) * (cx - x) + (cz - z) * (cz - z))); }
      }
      return best;
    };
    const infrastructure = planInfraSteps({
      city, spec: sc.infra, crowns: sc.crowns ?? {}, streets, height, runs, substations: grid.substations ?? [], feeds: grid.feeds ?? [],
      along, spot, fits, roomAt, claim, clear, byDoor, chunkAt, yAt, districtAt, blockDist, props, plants, ads, barriers, signs, note,
    });
    for (const part of infrastructure) yield 0.9 + 0.09 * part;
  }

  return {
    chunks: [...chunks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, c]) => ({ key: `${sc.version}|${city.site.seed}|street${key}`, district: c.district, solids: c.solids })),
    lights, props, plants, ads, barriers, signs,
    parts: props.map((q) => { const p = partOf.get(q); return p ? { chunk: `${sc.version}|${city.site.seed}|street${p.key}`, from: p.from, to: p.to } : null; }),
  };
}
