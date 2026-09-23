// The roadside's infrastructure, as a city's engineers put it up after the
// kerbs and the lamps: on the ring highway a sign gantry on each long stretch
// (its boards naming the exit ahead by the district it leads into), a speed sign
// past every junction, the odd traffic camera, sound walls where it passes the
// districts that asked for them, billboards on monopoles out on the verges, and
// guard rails round the outside of its tighter bends; out past it the
// high-voltage line on its lattice pylons (the whole ring or a sector of it, by
// the city's seed, and perhaps a second line off it out to the city's edge -- or
// in along the arterials to a substation, if the city has any); wooden utility
// poles and their wires along the side streets of the districts that have them;
// and a radio mast or two on the high ground. Nothing stands in a carriageway,
// a junction's box, a crossing or a sight line, on a lot or a landmark's ground,
// or on anything already standing. All of it a function of the city's seed.
//
// There is no median: the highway's two lanes each way meet at a painted centre
// line with no gap, and the street race (sprint@4) takes the oncoming side to
// pass -- a barrier down the middle would stand in its way. An arterial's lanes
// fill its whole width too, so its variety is its districts' dressing instead.

import { SIDEWALK, drawsFor } from "@keel-engine/city";
import type { City, CityHeight, District, DistrictKind, Obb, Streets } from "@keel-engine/city";
import { datan2, dcos, dhypot, dsin } from "@keel-engine/core";
import type { RoadEdge } from "@keel-engine/road";
import { placerAt } from "../frame.ts";
import type { Placer } from "../frame.ts";
import type { AdSlotSpec, InfraSpec, PlantKind, PlantSpot, PropKind, PropSpot, Solid, StreetSign } from "../types.ts";
import { billboard, gantry, hookAt, pylon, radioMast, railRun, steelPole, trafficCamera, utilityPole, wallPanel, wire } from "./roadside.ts";
import type { Hook } from "./roadside.ts";

type Draws = ReturnType<typeof drawsFor>;

/** What planStreets hands over: the city, its streets and what's already standing, and where things go. */
export interface InfraContext {
  readonly city: City;
  readonly spec: InfraSpec;
  /** The widest each kind of plant is drawn (m, at scale 1): what keeps ground cover's spread off the road. */
  readonly crowns: Readonly<Partial<Record<PlantKind, number>>>;
  readonly streets: Streets;
  readonly height: CityHeight | undefined;
  readonly runs: readonly { readonly e: RoadEdge; readonly kind: DistrictKind | "highway"; readonly s0: number; readonly s1: number; readonly D: Draws }[];
  readonly substations: readonly { readonly x: number; readonly z: number }[];
  /** Where power lines come in from the land round the city (their last pylons, or a substation at its edge). */
  readonly feeds: readonly { readonly x: number; readonly z: number }[];
  along(e: RoadEdge, s: number): { x: number; z: number; yaw: number };
  spot(e: RoadEdge, side: 1 | -1, s: number, out: number): { x: number; z: number; yaw: number };
  fits(e: RoadEdge, x: number, z: number, r: number, post: boolean, kerbClear: number): boolean;
  roomAt(x: number, z: number, r: number, gap: number): boolean;
  claim(x: number, z: number, r: number, gap: number): void;
  /** Whether a disc touches nothing standing (their footprints only, no gaps: a rail runs past a lamp's foot). */
  clear(x: number, z: number, r: number): boolean;
  byDoor(x: number, z: number, r: number): boolean;
  chunkAt(x: number, z: number): Solid[];
  yAt(x: number, z: number): number;
  districtAt(x: number, z: number): District;
  /** Metres from a point to the nearest block's middle (how far into the city it is). */
  blockDist(x: number, z: number): number;
  readonly props: PropSpot[];
  /** Note a prop just pushed (its solids since its piece was started in its chunk: planStreets' parts). */
  note?(q: PropSpot): void;
  readonly plants: PlantSpot[];
  readonly ads: AdSlotSpec[];
  readonly barriers: Obb[];
  readonly signs: StreetSign[];
}

/** What a district is called on a highway's exit sign. */
const EXIT_NAME: Readonly<Record<DistrictKind, string>> = {
  core: "DOWNTOWN", midtown: "MIDTOWN", oldtown: "OLD TOWN", industrial: "INDUSTRIAL DIST", docks: "THE DOCKS", strip: "THE STRIP", suburb: "SUBURBS",
};
/** Carriageway clearance (m, past the kerb) the highway's pieces keep. */
const RAIL_OUT = 0.8, SIGN_OUT = 2.9, WALL_OUT = 4.2, BILLBOARD_OUT = 11;

export function planInfra(c: InfraContext): void {
  const { city, spec, streets } = c, g = city.graph, seed = city.site.seed;
  const place = (D: Draws, x: number, z: number, yaw: number): Placer => placerAt(D, x, z, yaw, c.chunkAt(x, z), c.plants, c.ads, c.yAt(x, z));
  const prop = (kind: PropKind, x: number, z: number, r: number, breaks: boolean): void => { const q: PropSpot = { kind, x, z, r, breaks }; c.props.push(q); c.note?.(q); };

  // ---- the ground nothing goes on: every lot (a disc's reach into its box) and every landmark's.
  const LC = 64, lotHash = new Map<string, Obb[]>();
  const obbs: Obb[] = [...city.lots.map((l) => l.obb), ...city.landmarks.map((l) => ({ ...l.obb, hw: l.obb.hw + 8, hd: l.obb.hd + 8 }))];
  for (const o of obbs) {
    const r = dhypot(o.hw, o.hd);
    for (let cx = Math.floor((o.x - r) / LC); cx <= Math.floor((o.x + r) / LC); cx += 1) for (let cz = Math.floor((o.z - r) / LC); cz <= Math.floor((o.z + r) / LC); cz += 1) {
      const k = `${cx},${cz}`, l = lotHash.get(k) ?? [];
      l.push(o); lotHash.set(k, l);
    }
  }
  const onLot = (x: number, z: number, r: number): boolean => {
    for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) for (const o of lotHash.get(`${Math.floor(x / LC) + a},${Math.floor(z / LC) + b}`) ?? []) {
      const dx = x - o.x, dz = z - o.z, cy = dcos(o.yaw), sy = dsin(o.yaw);
      const u = Math.abs(dx * cy - dz * sy) - o.hw, v = Math.abs(dx * sy + dz * cy) - o.hd;
      if (dhypot(Math.max(0, u), Math.max(0, v)) < r) return true;
    }
    return false;
  };
  /** Clear of every road by `clear` m past its pavement (a disc of radius r), off every lot. */
  const open = (x: number, z: number, r: number, clear: number): boolean => {
    const at = streets.at(x, z);
    if (at && at.kerb - r < at.kerbW + at.slabW + clear) return false;
    return !onLot(x, z, r + 1);
  };

  // ---- the ring: its highways joined end to end, and which side of it is outside.
  const hw = g.edges.filter((e) => e.cls === "highway");
  const degree = new Map<number, number>();
  for (const e of hw) for (const n of [e.a, e.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const ring = hw.filter((e) => e.a !== e.b && degree.get(e.a)! >= 2 && degree.get(e.b)! >= 2);
  const ringIds = new Set(ring.map((e) => e.id));
  /** Which side of a highway is away from the city's middle, at arc length s. */
  const outside = (e: RoadEdge, s: number): 1 | -1 => { const q = c.along(e, s); return dcos(q.yaw) * q.x - dsin(q.yaw) * q.z >= 0 ? 1 : -1; };
  const highwayRuns = c.runs.filter((r) => r.e.cls === "highway");
  const kerbHw = SIDEWALK.highway.kerb;

  /** What an exit off the ring at a junction leads to: the district at the far end of the road off it. */
  const exitName = (node: number): string => {
    const i = g.nodes.findIndex((n) => n.id === node);
    for (const id of g.at[i] ?? []) {
      const e = g.edges[id]!;
      if (ringIds.has(e.id)) continue;
      if (e.cls === "highway") return "CITY LIMITS";
      const far = g.nodes.find((n) => n.id === (e.a === node ? e.b : e.a))!;
      return EXIT_NAME[c.districtAt(far.x, far.z).kind];
    }
    return "CITY LIMITS";
  };
  const exitNumber = new Map<number, number>();
  // (Exits numbered round the ring from its first junction.)
  {
    const from = new Map(ring.map((e) => [e.a, e]));
    let e = ring[0], n = 1;
    while (e && !exitNumber.has(e.a)) { exitNumber.set(e.a, n); n += 1; e = from.get(e.b); }
  }

  const H = spec.highway;
  if (H) {
    // ---- sign gantries: one mid-way along each long ring stretch, its boards naming the exits ahead either way.
    for (const run of highwayRuns) {
      const { e, D } = run, L = e.path.length - 1;
      if (!ringIds.has(e.id) || L < H.gantryMin) continue;
      const reach = e.half + kerbHw + 1.4;
      for (const nudge of [0, 12, -12, 24, -24, 36, -36]) {
        const s = L / 2 + nudge, q = c.along(e, s);
        const legs = ([1, -1] as const).map((side) => c.spot(e, side, s, kerbHw + 1.4));
        if (!legs.every((p) => c.fits(e, p.x, p.z, 0.4, false, kerbHw + 0.4) && c.roomAt(p.x, p.z, 0.4, 3))) continue;
        const p = place(D, q.x, q.z, q.yaw), { boards } = gantry(p, reach, e.half);
        for (const b of boards) {
          const node = b.facing < 0 ? e.b : e.a, [x, y, z] = hookAt(p, [b.x, b.y, b.z]), yaw = q.yaw + (b.facing < 0 ? Math.PI : 0);
          c.signs.push({ id: `${x.toFixed(1)},${z.toFixed(1)}:exit`, text: `EXIT ${exitNumber.get(node) ?? 0}  ${exitName(node)}`, size: [b.w, b.h], pos: [x, y, z], normal: [dsin(yaw), dcos(yaw)] });
        }
        for (const l of legs) { prop("gantry", l.x, l.z, 0.35, false); c.claim(l.x, l.z, 0.4, 3); }
        break;
      }
    }
    // ---- cameras on some highway stretches (road signs are placed by planStreets).
    for (const run of highwayRuns) {
      const { e, D } = run, L = e.path.length - 1;
      if (L < 120) continue;
      if (D.u("camera") < H.cameras) {
        const side: 1 | -1 = D.u("cameraSide") < 0.5 ? 1 : -1;
        for (const nudge of [0, 10, -10, 20, -20]) {
          const s = L * 0.35 + nudge, p = c.spot(e, side, s, kerbHw + SIGN_OUT);
          if (!c.fits(e, p.x, p.z, 0.3, false, kerbHw + 1) || !c.roomAt(p.x, p.z, 0.3, 2) || onLot(p.x, p.z, 0.5)) continue;
          // (Its arm out toward the road (+x), the housing looking back at the traffic coming up that side.)
          prop("camera", p.x, p.z, trafficCamera(place(D, p.x, p.z, p.yaw + (side > 0 ? Math.PI : 0))), false);
          c.claim(p.x, p.z, 0.3, 2);
          break;
        }
      }
    }
    // ---- sound walls: along the highway where the districts behind it are ones that asked for them.
    for (const run of highwayRuns) {
      const { e, D } = run, L = e.path.length - 1, STEP = 8;
      for (const side of [1, -1] as const) {
        const segs: { a: { x: number; z: number }; b: { x: number; z: number } }[][] = [[]];
        for (let s = 4; s + STEP <= L - 4; s += STEP) {
          const mid = c.spot(e, side, s + STEP / 2, 60);
          const wants = H.soundWalls.includes(c.districtAt(mid.x, mid.z).kind) && c.blockDist(mid.x, mid.z) < 320 && (!ringIds.has(e.id) || side !== outside(e, s));
          const a = c.spot(e, side, s, kerbHw + WALL_OUT), b = c.spot(e, side, s + STEP, kerbHw + WALL_OUT), m = c.spot(e, side, s + STEP / 2, kerbHw + WALL_OUT);
          const ok = wants && [a, m, b].every((p) => c.fits(e, p.x, p.z, 0.3, false, kerbHw + 3) && c.roomAt(p.x, p.z, 0.3, 0.2) && !onLot(p.x, p.z, 0.6));
          if (ok) segs[segs.length - 1]!.push({ a, b }); else if (segs[segs.length - 1]!.length) segs.push([]);
        }
        // (A wall worth building runs 40 m or more: no stubs.)
        for (const stretch of segs) {
          if (stretch.length < 5) continue;
          for (const { a, b } of stretch) {
            const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, len = dhypot(b.x - a.x, b.z - a.z), yaw = datan2(b.x - a.x, b.z - a.z);
            // (+x toward the road: the H-piles on the road's face.)
            wallPanel(place(D, x, z, side > 0 ? yaw + Math.PI : yaw), len + 0.1, H.wallHeight);
            c.barriers.push({ x, z, hw: 0.16, hd: len / 2, yaw });
            c.claim(x, z, len / 2, 0);
          }
        }
      }
    }
    // ---- billboards: on monopoles out on the verges, every few hundred metres, a side by the seed.
    for (const run of highwayRuns) {
      const { e, D } = run, L = e.path.length - 1, [lo, hi] = H.billboards;
      for (let s = 60 + D.u("bbPhase") * lo * 0.5, n = 0; s < L - 60; s += lo + (hi - lo) * D.u("bbGap", n), n += 1) {
        const side: 1 | -1 = D.u("bbSide", n) < 0.62 ? outside(e, s) : (-outside(e, s) as 1 | -1);
        for (const nudge of [0, 15, -15, 30]) {
          const p = c.spot(e, side, s + nudge, kerbHw + BILLBOARD_OUT);
          if (!c.fits(e, p.x, p.z, 5, false, kerbHw + 4) || !open(p.x, p.z, 7, 1) || !c.roomAt(p.x, p.z, 7, 3)) continue;
          const id = `${p.x.toFixed(1)},${p.z.toFixed(1)}:billboard`;
          prop("billboard", p.x, p.z, billboard(place(D, p.x, p.z, p.yaw - (side * Math.PI) / 2), id, 9 + 3 * D.u("bbPole", n), 12, 4), false);
          c.claim(p.x, p.z, 7, 3);
          break;
        }
      }
    }
  }

  // ---- the high-voltage line.
  const P = spec.power;
  if (P && ring.length) {
    const D = drawsFor(seed, "infra|power");
    // The ring as one line of samples, round the way.
    const pts: { x: number; z: number; yaw: number; e: RoadEdge; s: number }[] = [];
    {
      const from = new Map(ring.map((e) => [e.a, e]));
      let e: RoadEdge | undefined = ring[0];
      const seen = new Set<number>();
      while (e && !seen.has(e.id)) {
        seen.add(e.id);
        for (let s = 0; s < e.path.length - 1; s += 1) pts.push({ ...c.along(e, s), e, s });
        e = from.get(e.b);
      }
    }
    const Lr = pts.length, out = kerbHw + P.offset;
    interface Tower { x: number; z: number; p: Placer; hooks: Hook[] }
    const towerAt = (x: number, z: number, yaw: number, r: number): boolean => open(x, z, r, 4) && c.roomAt(x, z, r, 4) && [-1, 1].every((f) => open(x + dcos(yaw) * f * P.height * 0.23, z - dsin(yaw) * f * P.height * 0.23, 0.5, 0.5));
    const raise = (x: number, z: number, yaw: number): Tower => {
      const p = place(D, x, z, yaw), t = pylon(p, P.height);
      prop("pylon", x, z, t.r, false);
      c.claim(x, z, t.r, 4);
      return { x, z, p, hooks: t.hooks };
    };
    /** Each of a's hooks and the nearest free one of b's (world): the conductors between two towers. */
    const pairs = (a: Tower, b: Tower): [Hook, Hook][] => {
      const bs = b.hooks.map((h) => hookAt(b.p, h)), used = new Set<number>(), out: [Hook, Hook][] = [];
      for (const h of a.hooks) {
        const ha = hookAt(a.p, h);
        let best = -1, bd = Infinity;
        bs.forEach((q, i) => { const d = (q[0] - ha[0]) ** 2 + (q[1] - ha[1]) ** 2 + (q[2] - ha[2]) ** 2; if (!used.has(i) && d < bd) { bd = d; best = i; } });
        if (best < 0) continue;
        used.add(best);
        out.push([ha, bs[best]!]);
      }
      return out;
    };
    /** Whether a span's conductors, sagging, clear everything under them (the ground, an embankment, a raised road). */
    const spanClears = (a: Tower, b: Tower): boolean => {
      const sag = dhypot(b.x - a.x, b.z - a.z) * P.sag;
      return pairs(a, b).every(([ha, hb]) => sagClears(c, ha, hb, sag, 7, 5));
    };
    /** Conductors between two towers, sagging a share of the span -- if they clear what's under them (else the line breaks). */
    const string = (a: Tower, b: Tower, lod: 0 | 1): void => {
      if (!spanClears(a, b)) return;
      const span = dhypot(b.x - a.x, b.z - a.z), wp = placerAt(D, 0, 0, 0, c.chunkAt((a.x + b.x) / 2, (a.z + b.z) / 2));
      for (const [ha, hb] of pairs(a, b)) wire(wp, lod, ha, hb, span * P.sag, 3, 0.045);
    };
    /** A tower as it would stand at a point (its hooks), nothing put down. */
    const trial = (x: number, z: number, yaw: number): Tower => {
      const p = placerAt(D, x, z, yaw, [], [], [], c.yAt(x, z));
      return { x, z, p, hooks: pylon(p, P.height).hooks };
    };
    // Round the ring (or a sector of it), a pylon every span, nudged along to find its ground.
    const whole = D.u("whole") < P.whole, start = Math.floor(D.u("start") * Lr), length = whole ? Lr : Lr * (0.4 + 0.35 * D.u("sector"));
    const line: (Tower | null)[] = [];
    let last = -Infinity;
    for (let t = 0, k = 0; t < length - (whole ? P.spacing[0] * 0.6 : 0); t += P.spacing[0] + (P.spacing[1] - P.spacing[0]) * D.u("span", k), k += 1) {
      // (Of the spots that fit, the first whose span back to the last pylon clears the ground under it -- a road's
      // embankment, a raised deck -- or, if none does, the first that fits: the line breaks there.)
      let pick: { x: number; z: number; yaw: number; at: number } | null = null;
      const before = line[line.length - 1];
      for (const nudge of [0, 6, -6, 12, -12, 18, -18]) {
        const at = Math.round(t + nudge);
        if (at <= last + P.spacing[0] * 0.6) continue;
        const q = pts[(((start + at) % Lr) + Lr) % Lr]!, side = outside(q.e, q.s), p = c.spot(q.e, side, q.s, out);
        if (!towerAt(p.x, p.z, q.yaw, P.height * 0.1 + 0.3)) continue;
        const cand = { x: p.x, z: p.z, yaw: q.yaw, at };
        if (!before || spanClears(before, trial(p.x, p.z, q.yaw))) { pick = cand; break; }
        pick ??= cand;
      }
      if (pick) last = pick.at;
      line.push(pick ? raise(pick.x, pick.z, pick.yaw) : null);
    }
    const spanMax = P.spacing[1] * 1.8;
    const linked = (a: Tower | null | undefined, b: Tower | null | undefined): boolean => !!a && !!b && dhypot(a.x - b.x, a.z - b.z) < spanMax;
    for (let i = 0; i + 1 < line.length; i += 1) if (linked(line[i], line[i + 1])) string(line[i]!, line[i + 1]!, 1);
    if (whole && linked(line[line.length - 1], line[0])) string(line[line.length - 1]!, line[0]!, 1);

    const standing = line.filter((t): t is Tower => !!t);
    // A second line off the ring, out to the city's edge: toward where a line comes in from the land round it (the
    // nearest feed), or -- with none -- straight out from a pylon the seed picks. It stops where the city's ground does.
    if (standing.length > 3 && (c.feeds.length || D.u("radial") < P.radial)) {
      const feed = [...c.feeds].sort((a, b) => dhypot(a.x, a.z) - dhypot(b.x, b.z) || a.x - b.x)[0];
      const from = feed
        ? standing.reduce((b, t) => (dhypot(t.x - feed.x, t.z - feed.z) < dhypot(b.x - feed.x, b.z - feed.z) ? t : b))
        : standing[1 + Math.floor(D.u("radialAt") * (standing.length - 2))]!;
      const tx = feed ? feed.x - from.x : from.x, tz = feed ? feed.z - from.z : from.z, d = dhypot(tx, tz) || 1;
      const ux = tx / d, uz = tz / d, yaw = datan2(ux, uz), [bx0, bz0, bx1, bz1] = g.bounds, edge = Math.max(-bx0, bx1, -bz0, bz1) + 70;
      let prev: Tower = from;
      for (let k = 1; k < 20; k += 1) {
        const r = k * (P.spacing[0] + 4), x = from.x + ux * r, z = from.z + uz * r;
        if (Math.max(Math.abs(x), Math.abs(z)) > edge || (feed && r > d)) break;
        if (!towerAt(x, z, yaw, P.height * 0.1 + 0.3)) continue;
        const t = raise(x, z, yaw);
        if (dhypot(t.x - prev.x, t.z - prev.z) < spanMax) string(prev, t, 1);
        prev = t;
      }
    }
    // And in to the nearest substation, if the city has any: along the arterials on steel poles.
    if (c.substations.length && standing.length) feed(c, D, standing, string, P.height * 0.75);
  }

  // ---- utility poles along the districts' side streets, wires pole to pole.
  const U = spec.poles;
  if (U) {
    for (const run of c.runs) {
      const { e, kind, D } = run;
      if (kind === "highway" || !U.districts.includes(kind) || !U.roads.includes(e.cls) || run.s1 - run.s0 < U.every) continue;
      const sw = SIDEWALK[e.cls], out = sw.kerb + sw.slab - 0.45, side: 1 | -1 = D.u("poleSide") < 0.5 ? 1 : -1;
      type Pole = { x: number; z: number; p: Placer; hooks: Hook[] };
      let prev: Pole | null = null;
      for (let s = run.s0 + D.u("polePhase") * U.every * 0.5, n = 0; s <= run.s1; s += U.every * (0.9 + 0.2 * D.u("poleGap", n)), n += 1) {
        let placed = null as Pole | null;
        for (const nudge of [0, 1.5, -1.5, 3, -3]) {
          const t = s + nudge;
          if (t < run.s0 || t > run.s1) continue;
          const p = c.spot(e, side, t, out);
          if (!c.fits(e, p.x, p.z, 0.2, false, sw.kerb + 0.3) || !c.roomAt(p.x, p.z, 0.2, 1.5) || c.byDoor(p.x, p.z, 0.2)) continue;
          const pl = place(D, p.x, p.z, p.yaw - (side * Math.PI) / 2), u = utilityPole(pl, U.height, D.u("can", n) < U.transformer);
          prop("pole", p.x, p.z, u.r, false);
          c.claim(p.x, p.z, 0.2, 1.5);
          placed = { x: p.x, z: p.z, p: pl, hooks: u.hooks };
          break;
        }
        if (placed && prev && dhypot(placed.x - prev.x, placed.z - prev.z) < U.every * 1.7) {
          // (The wires stay over the pavement: a span whose middle would hang over a lot or the road is left out.)
          const mx = (placed.x + prev.x) / 2, mz = (placed.z + prev.z) / 2, at = streets.at(mx, mz);
          const span = dhypot(placed.x - prev.x, placed.z - prev.z), ends = prev.hooks.map((h, i) => [hookAt(prev!.p, h), hookAt(placed!.p, placed!.hooks[i]!)] as const);
          if (at && at.kerb > sw.kerb && at.kerb < sw.kerb + sw.slab && !onLot(mx, mz, 0.2) && ends.every(([a, b]) => sagClears(c, a, b, span * 0.025, 5.5, 4))) {
            const wp = placerAt(D, 0, 0, 0, c.chunkAt(mx, mz));
            for (const [a, b] of ends) wire(wp, 0, a, b, span * 0.025, 2, 0.03);
          }
        }
        prev = placed;
      }
    }
  }

  // ---- guard rails: round the outside of the highway's tighter bends (last: they fit round everything else).
  if (H) {
    for (const run of highwayRuns) {
      const { e, D } = run, L = e.path.length - 1, SEG = 4;
      const bent: (1 | -1 | 0)[] = [];
      for (let s = 0; s <= L; s += 1) {
        const i0 = Math.max(0, s - 6), i1 = Math.min(L, s + 6);
        let dy = e.path.yaw[i1]! - e.path.yaw[i0]!;
        dy = datan2(dsin(dy), dcos(dy));
        const k = i1 > i0 ? dy / (i1 - i0) : 0;
        // (Heading turning clockwise -- yaw rising -- bends toward the road's right: the outside is its left.)
        bent.push(Math.abs(k) > H.railCurve ? (k > 0 ? -1 : 1) : 0);
      }
      for (let s = 6; s + SEG <= L - 6; s += SEG) {
        const side = bent[s]!;
        if (!side || bent[s + SEG] !== side) continue;
        const a = c.spot(e, side, s, kerbHw + RAIL_OUT), b = c.spot(e, side, s + SEG, kerbHw + RAIL_OUT);
        const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
        const clearOf = (p: { x: number; z: number }): boolean => {
          const at = streets.at(p.x, p.z);
          // (Past a junction's mouth on the side no road leaves from, a rail runs on: the kerb returns, rounded in, keep it
          // out of the mouth of any road that does.)
          return (!at || (at.cls === "highway" && at.kerb >= kerbHw + 0.4) || at.kerb >= 3) && c.clear(p.x, p.z, 0.15);
        };
        if (![a, b, { x, z }].every(clearOf)) continue;
        const len = dhypot(b.x - a.x, b.z - a.z), yaw = datan2(b.x - a.x, b.z - a.z);
        // (+x toward the road.)
        railRun(place(D, x, z, side > 0 ? yaw + Math.PI : yaw), len);
        c.barriers.push({ x, z, hw: 0.12, hd: len / 2, yaw });
      }
    }
  }

  // ---- radio masts on the high ground: open land, off every road, lot and landmark, the highest few, well apart.
  const M = spec.masts;
  if (M) {
    const D = drawsFor(seed, "infra|masts"), want = M.count[0] + Math.floor((M.count[1] - M.count[0] + 1) * D.u("count"));
    const [x0, z0, x1, z1] = g.bounds, cands: { x: number; z: number; y: number }[] = [];
    for (let z = z0 + 30; z < z1 - 30; z += 24) for (let x = x0 + 30; x < x1 - 30; x += 24) {
      const jx = x + (D.u("mx", Math.round(x), Math.round(z)) - 0.5) * 12, jz = z + (D.u("mz", Math.round(x), Math.round(z)) - 0.5) * 12;
      if (dhypot(jx, jz) > city.site.size / 2 - 20 || !open(jx, jz, 4, 6) || !c.roomAt(jx, jz, 4, 4)) continue;
      // (Flat ground has no high point: a seeded one then.)
      cands.push({ x: jx, z: jz, y: c.height ? c.yAt(jx, jz) + D.u("tie", Math.round(jx), Math.round(jz)) * 0.01 : D.u("tie", Math.round(jx), Math.round(jz)) });
    }
    cands.sort((a, b) => b.y - a.y || a.x - b.x || a.z - b.z);
    const chosen: { x: number; z: number }[] = [];
    for (const q of cands) {
      if (chosen.length >= want) break;
      if (chosen.some((o) => dhypot(o.x - q.x, o.z - q.z) < 350)) continue;
      const Hm = M.height[0] + (M.height[1] - M.height[0]) * D.u("h", chosen.length);
      prop("mast", q.x, q.z, radioMast(place(D, q.x, q.z, D.u("yaw", chosen.length) * Math.PI * 2), Hm), false);
      c.claim(q.x, q.z, 3, 4);
      chosen.push(q);
    }
  }

  if (spec.cover) groundCover(c, onLot);
}

/**
 * Ground cover, so nothing stands on bare earth: clumps of grass, flowers and bushes round the feet of what stands on
 * the verges (poles, pylons, masts, billboards, the highway's signs, cameras, gantry legs and lamp masts), along the
 * backs of its walls and rails, tufts along the pavements' back edges, scrub down the highway's shoulders, and planting
 * in the gaps between a block's lots -- lush in the districts that tend it, scrappy weeds where nobody does, next to
 * none downtown. Every plant's spread stays off the carriageway and the pavement's walk, off crossings, off lots, and
 * (anything taller than grass) out of the junctions' sight lines.
 */
function groundCover(c: InfraContext, onLot: (x: number, z: number, r: number) => boolean): void {
  const { city, streets } = c, spec = c.spec.cover!, crowns = c.crowns, D = drawsFor(city.site.seed, "infra|cover");
  const density = (x: number, z: number, highway = false): number => (highway ? spec.density.highway ?? 0 : spec.density[c.districtAt(x, z).kind] ?? 0);
  const lush = (x: number, z: number): boolean => spec.lush.includes(c.districtAt(x, z).kind);
  // (A plant a 3 m hash cell: no two clumps drawn on top of each other.)
  const taken = new Set<string>();
  let n = 0;
  const plant = (kind: PlantKind, x: number, z: number, scale: number): boolean => {
    const r = (crowns[kind] ?? 1) * scale, at = streets.at(x, z), low = kind === "grass" || kind === "flowers";
    const cell = `${Math.floor(x / 1.5)},${Math.floor(z / 1.5)}`;
    if (taken.has(cell)) return false;
    if (at) {
      // (Off the carriageway and the walk: grass may reach the pavement's back half-metre, a bush stays behind it.)
      if (at.kerb - r < at.kerbW + at.slabW - (low ? 0.5 : 0) || at.crossing || at.nearCrossing) return false;
      if (!low && at.kerb - r < at.kerbW + at.slabW + 1.5 && (at.sight || at.box)) return false;
    }
    if (onLot(x, z, low ? r * 0.3 : r * 0.7) || !c.clear(x, z, low ? 0 : r * 0.5)) return false;
    taken.add(cell);
    c.plants.push({ kind, x, y: c.yAt(x, z), z, scale, seed: Math.floor(D.u("seed", n) * 1e6) });
    n += 1;
    return true;
  };
  /** A clump round a point: `k` plants within `reach` m, lush or scrappy. */
  const clump = (x: number, z: number, reach: number, k: number, rich: boolean, tag: number): void => {
    for (let i = 0; i < k; i += 1) {
      const a = D.u("ca", tag, i) * Math.PI * 2, d = reach * (0.35 + 0.65 * D.u("cd", tag, i)), roll = D.u("ck", tag, i);
      const kind: PlantKind = rich ? (roll < 0.35 ? "bush" : roll < 0.6 ? "flowers" : "grass") : roll < 0.15 ? "bush" : "grass";
      plant(kind, x + dsin(a) * d, z + dcos(a) * d, kind === "bush" ? 0.55 + 0.35 * D.u("cs", tag, i) : 0.7 + 0.6 * D.u("cs", tag, i));
    }
  };
  let tag = 0;
  // ---- round the feet of what stands on the verges.
  const FEET: Partial<Record<PropKind, number>> = { pole: 1.2, pylon: 4.5, mast: 3.5, billboard: 1.6, sign: 0.9, camera: 1, gantry: 1.2, lamp: 1 };
  for (const p of [...c.props]) {
    const reach = FEET[p.kind];
    if (reach === undefined) continue;
    const at = streets.at(p.x, p.z), hw = !at || at.cls === "highway";
    if (p.kind === "lamp" && !hw) continue;
    const dn = density(p.x, p.z, hw && p.kind !== "pole"), k = Math.round((p.kind === "pylon" && p.r > 1 ? 7 : 3) * Math.min(1, dn + 0.35));
    if (dn > 0) clump(p.x, p.z, p.kind === "pylon" && p.r < 1 ? 1.2 : reach + p.r * 0.5, k, !hw && lush(p.x, p.z), tag);
    tag += 1;
  }
  // ---- along the backs of the highway's walls and rails.
  for (const b of c.barriers) {
    const fx = dsin(b.yaw), fz = dcos(b.yaw);
    // (The back: whichever side is further from the road.)
    const side = [1, -1].map((s) => { const at = streets.at(b.x + fz * s * 1.5, b.z - fx * s * 1.5); return at ? at.kerb : Infinity; });
    const s = side[0]! >= side[1]! ? 1 : -1, dn = density(b.x, b.z, true);
    for (let t = -b.hd; t <= b.hd; t += 2.5) {
      if (D.u("bar", tag, Math.round(t * 4)) >= dn * 0.8) continue;
      const off = b.hw + 0.5 + D.u("barOff", tag, Math.round(t * 4)) * 1.2;
      plant(D.u("barK", tag, Math.round(t * 4)) < 0.3 ? "bush" : "grass", b.x + fx * t + fz * s * off, b.z + fz * t - fx * s * off, 0.6 + 0.4 * D.u("barS", tag, Math.round(t * 4)));
    }
    tag += 1;
  }
  // ---- along every road: tufts at the pavement's back edge; scrub down a highway's shoulders.
  for (const run of c.runs) {
    const { e } = run, L = e.path.length - 1, hw = e.cls === "highway", sw = SIDEWALK[e.cls];
    const step = hw ? 9 : 14;
    for (let s = run.s0 + 2, i = 0; s < run.s1 - 2; s += step, i += 1) for (const side of [1, -1] as const) {
      const q = c.spot(e, side, s, 0), dn = density(q.x, q.z, hw);
      if (D.u("edge", e.id * 2 + (side > 0 ? 0 : 1), i) >= dn * (hw ? 0.9 : 0.55)) continue;
      const out = hw ? sw.kerb + 3 + D.u("edgeOut", e.id, i) * 9 : sw.kerb + sw.slab + 0.1 + D.u("edgeOut", e.id, i) * 0.3;
      const p = c.spot(e, side, s + D.u("edgeS", e.id, i) * step * 0.6, out), roll = D.u("edgeK", e.id * 2 + (side > 0 ? 0 : 1), i);
      const rich = !hw && lush(p.x, p.z);
      const kind: PlantKind = hw ? (roll < 0.3 ? "bush" : "grass") : rich ? (roll < 0.25 ? "hedge" : roll < 0.55 ? "flowers" : "grass") : roll < 0.12 ? "flowers" : "grass";
      plant(kind, p.x, p.z, kind === "hedge" ? 0.5 : kind === "bush" ? 0.6 + 0.4 * D.u("edgeSc", e.id, i) : 0.7 + 0.5 * D.u("edgeSc", e.id, i));
      if (hw && L > 0 && roll < 0.3) clump(p.x, p.z, 2, 2, false, 100000 + e.id * 1000 + i);
    }
  }
  // ---- the gaps between a block's lots.
  for (const b of city.blocks) {
    const q = b.corners, xs = q.map((p) => p[0]), zs = q.map((p) => p[1]);
    const inside = (x: number, z: number): boolean => {
      let pos = 0, neg = 0;
      for (let i = 0; i < 4; i += 1) { const [ax, az] = q[i]!, [bx, bz] = q[(i + 1) % 4]!, k = (bx - ax) * (z - az) - (bz - az) * (x - ax); if (k >= 0) pos += 1; if (k <= 0) neg += 1; }
      return pos === 4 || neg === 4;
    };
    for (let z = Math.min(...zs) + 3, j = 0; z < Math.max(...zs); z += 7, j += 1) for (let x = Math.min(...xs) + 3, i = 0; x < Math.max(...xs); x += 7, i += 1) {
      const jx = x + (D.u("gx", b.id * 97 + i, j) - 0.5) * 5, jz = z + (D.u("gz", b.id * 97 + i, j) - 0.5) * 5;
      if (!inside(jx, jz)) continue;
      const dn = density(jx, jz), roll = D.u("gk", b.id * 97 + i, j);
      if (D.u("gap", b.id * 97 + i, j) >= dn * 0.5) continue;
      const rich = lush(jx, jz);
      const kind: PlantKind = rich ? (roll < 0.3 ? "bush" : roll < 0.45 ? "hedge" : roll < 0.65 ? "flowers" : "grass") : roll < 0.2 ? "bush" : "grass";
      plant(kind, jx, jz, kind === "hedge" ? 0.6 : kind === "bush" ? 0.7 + 0.4 * D.u("gs", b.id, i * 131 + j) : 0.8 + 0.5 * D.u("gs", b.id, i * 131 + j));
    }
  }
}

/**
 * Whether a wire from a to b (world), sagging `sag` m at its middle, keeps `overRoad` m above any carriageway it
 * crosses and `overGround` m above the ground everywhere else -- sampled every couple of metres along it.
 */
function sagClears(c: InfraContext, a: Hook, b: Hook, sag: number, overRoad: number, overGround: number): boolean {
  const n = Math.max(4, Math.ceil(dhypot(b[0] - a[0], b[2] - a[2]) / 2));
  for (let k = 0; k <= n; k += 1) {
    const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t);
    const at = c.streets.at(x, z), need = at && at.kerb < 0.5 ? overRoad : overGround;
    if (y - c.yAt(x, z) < need) return false;
  }
  return true;
}

/**
 * The line in to a substation: from the ring junction nearest it, along the arterials (the shortest way by length),
 * on steel poles at the pavement's back edge every ~50 m, strung from the ring's nearest pylon to the pole beside the
 * substation.
 */
function feed(c: InfraContext, D: Draws, towers: readonly { x: number; z: number; p: Placer; hooks: Hook[] }[], string: (a: { x: number; z: number; p: Placer; hooks: Hook[] }, b: { x: number; z: number; p: Placer; hooks: Hook[] }, lod: 0 | 1) => void, height: number): void {
  const g = c.city.graph;
  const sub = [...c.substations].sort((a, b) => dhypot(a.x, a.z) - dhypot(b.x, b.z) || a.x - b.x)[0]!;
  // (Dijkstra over the arterials and the highways' junctions, from the node nearest the substation.)
  const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
  const dist = new Map<number, number>(), via = new Map<number, number>();
  const target = g.nodes.reduce((b, n) => (dhypot(n.x - sub.x, n.z - sub.z) < dhypot(b.x - sub.x, b.z - sub.z) ? n : b));
  dist.set(target.id, 0);
  const open = new Set([target.id]);
  while (open.size) {
    let u = -1, du = Infinity;
    for (const n of open) { const d = dist.get(n)!; if (d < du || (d === du && n < u)) { du = d; u = n; } }
    open.delete(u);
    for (const id of g.at[idx.get(u)!] ?? []) {
      const e = g.edges[id]!;
      if (e.cls !== "arterial") continue;
      const v = e.a === u ? e.b : e.a, nd = du + e.path.length;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); via.set(v, id); open.add(v); }
    }
  }
  // The ring junction the arterials reach nearest it (a node with a highway at it).
  let start = -1, best = Infinity;
  for (const [n, d] of dist) if ((g.at[idx.get(n)!] ?? []).some((id) => g.edges[id]!.cls === "highway") && d < best) { best = d; start = n; }
  if (start < 0) return;
  let prev = [...towers].sort((a, b) => dhypot(a.x - g.nodes[idx.get(start)!]!.x, a.z - g.nodes[idx.get(start)!]!.z) - dhypot(b.x - g.nodes[idx.get(start)!]!.x, b.z - g.nodes[idx.get(start)!]!.z))[0]!;
  if (dhypot(prev.x - g.nodes[idx.get(start)!]!.x, prev.z - g.nodes[idx.get(start)!]!.z) > 160) return;
  const side: 1 | -1 = D.u("feedSide") < 0.5 ? 1 : -1;
  for (let n = start; via.has(n);) {
    const e = g.edges[via.get(n)!]!, fwd = e.a === n, L = e.path.length - 1, sw = SIDEWALK[e.cls];
    const run = c.runs.find((r) => r.e.id === e.id)!;
    // (Poles one side of the way the line goes, every ~50 m, out of the junctions' sight lines.)
    for (let k = 1; k * 50 < L; k += 1) {
      const t = fwd ? k * 50 : L - k * 50;
      if (t < run.s0 || t > run.s1) continue;
      const sd: 1 | -1 = fwd ? side : (-side as 1 | -1), p = c.spot(e, sd, t, sw.kerb + sw.slab - 0.55);
      if (!c.fits(e, p.x, p.z, 0.45, false, sw.kerb + 0.3) || !c.roomAt(p.x, p.z, 0.45, 2) || c.byDoor(p.x, p.z, 0.45)) continue;
      // (Its frame's +x toward the road: the arms hang over the pavement.)
      const pl = placerAt(D, p.x, p.z, sd > 0 ? p.yaw + Math.PI : p.yaw, c.chunkAt(p.x, p.z), c.plants, c.ads, c.yAt(p.x, p.z)), s = steelPole(pl, height);
      c.props.push({ kind: "pylon", x: p.x, z: p.z, r: s.r, breaks: false });
      c.claim(p.x, p.z, 0.45, 2);
      const t2 = { x: p.x, z: p.z, p: pl, hooks: s.hooks };
      if (dhypot(t2.x - prev.x, t2.z - prev.z) < 160) string(prev, t2, 1);
      prev = t2;
    }
    n = fwd ? e.b : e.a;
  }
}
