// Junctions as they're built: where roads meet, the kerbs don't stop dead at a
// square corner -- each corner between two roads is a KERB RETURN, an arc of a
// radius by the smaller road's class (a street turning off an arterial ~6 m,
// two arterials ~8 m), tangent to both kerbs, the pavement wrapping round it.
// Inside the returns is the junction's box: open tarmac, no lane markings. Each
// road into it has, just outside its box, a zebra across it (dropped kerbs at
// its ends) and a stop line across the lanes coming in; behind that, its sight
// line -- nothing taller than a post stands on its pavements there.
//
// `streetsOf` reads the whole network this way at any point: the road field's
// nearest road (keel/road), and the distance to the kerb with the returns
// rounded in -- one continuous surface for the ground's paint, the tyres, the
// placement of everything on the pavements, and the audits.

import { datan2 } from "@keel-engine/core";
import { roadField } from "@keel-engine/road";
import type { RoadAt, RoadClass, RoadEdge, RoadField, RoadGraph } from "@keel-engine/road";
import { SIDEWALK } from "./sidewalks.ts";

/** A corner's kerb-return radius (m), by the smaller of its two roads. */
export const KERB_RETURN: Readonly<Record<RoadClass, number>> = { highway: 12, arterial: 8, street: 6, alley: 3, ramp: 10, freeway: 14 };
/** A zebra's width along its road (m), the gap from the box to it, and the stop line's distance behind it and width. */
export const CROSSING_WIDTH = 3, CROSSING_GAP = 0.5, STOP_GAP = 1.2, STOP_WIDTH = 0.45;
/** How far past its stop line a road's sight line runs (m): nothing but posts on its pavements that close to the junction. */
export const SIGHT = 9;

const SIZE: Readonly<Record<RoadClass, number>> = { alley: 0, street: 1, arterial: 2, highway: 3, ramp: 3, freeway: 4 };

export interface JunctionArm {
  readonly edge: number;
  /** The edge starts at this junction (its path runs away from it); else it ends here. */
  readonly atStart: boolean;
  readonly cls: RoadClass;
  readonly half: number;
  /** Unit direction away from the junction (from its first ~12 m). */
  readonly dx: number;
  readonly dz: number;
  /** Which straight-through road it's part of (the arm across the junction from it shares its group). */
  readonly group: number;
  /** Metres from the junction along it where the kerb returns end: inside, the box (no lane markings). */
  readonly box: number;
  /** Its zebra (m from the junction, from and to), or null. */
  readonly crossing: readonly [number, number] | null;
  /** Its stop line (m from the junction, the near edge), or null (a highway: it has the right of way). */
  readonly stop: number | null;
  /** Metres from the junction its sight line reaches: nothing taller than a post on its pavements inside. */
  readonly sight: number;
}

export interface JunctionCorner {
  /** The two arms either side of it (indices into the junction's arms, a then b round the way) and its radius (m). */
  readonly a: number;
  readonly b: number;
  readonly r: number;
}

export interface Junction {
  readonly node: number;
  readonly x: number;
  readonly z: number;
  readonly arms: readonly JunctionArm[];
  readonly corners: readonly JunctionCorner[];
  /** How far from its node the junction's level surface must reach (m): its box, crossings and corner pavements. */
  readonly reach: number;
}

/** A road's first `n` metres from a junction as a polyline (x, z pairs), running away from it. */
function armLine(e: RoadEdge, atStart: boolean, n = 60): Float64Array {
  const p = e.path, L = p.length, m = Math.min(L, n + 1), out = new Float64Array(m * 2);
  for (let k = 0; k < m; k += 1) { const i = atStart ? k : L - 1 - k; out[k * 2] = p.x[i]!; out[k * 2 + 1] = p.z[i]!; }
  return out;
}

/** Distance from a point to a polyline. */
function lineDist(line: Float64Array, x: number, z: number): number {
  let best = Infinity;
  for (let k = 2; k < line.length; k += 2) {
    const ax = line[k - 2]!, az = line[k - 1]!, ex = line[k]! - ax, ez = line[k + 1]! - az, e2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / e2)), qx = x - ax - ex * t, qz = z - az - ez * t;
    const d = qx * qx + qz * qz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** A junction's geometry for fast point queries: each arm's line, the groups' kerb distance and the corner fillets. */
interface Shape {
  readonly j: Junction;
  readonly lines: readonly Float64Array[];
  /** Distance from a group's kerb (the nearest of its arms' carriageway edges; negative on it). */
  group(g: number, x: number, z: number): number;
  /** The kerb distance with this junction's returns rounded in (Infinity outside its corners). */
  fillet(x: number, z: number): number;
}

function shapeOf(j: Omit<Junction, "arms" | "corners" | "reach">, arms: Omit<JunctionArm, "box" | "crossing" | "stop" | "sight">[], corners: JunctionCorner[], g: RoadGraph): Shape {
  const lines = arms.map((a) => armLine(g.edges[a.edge]!, a.atStart));
  const group = (gi: number, x: number, z: number): number => {
    let d = Infinity;
    arms.forEach((a, i) => { if (a.group === gi) d = Math.min(d, lineDist(lines[i]!, x, z) - a.half); });
    return d;
  };
  const fillet = (x: number, z: number): number => {
    const px = x - j.x, pz = z - j.z;
    let best = Infinity;
    for (const c of corners) {
      const A = arms[c.a]!, B = arms[c.b]!;
      // (In the corner's sector: between arm a and arm b, going round the way (angles rising: each cross <= 0).)
      if (A.dx * pz - A.dz * px > 0 || px * B.dz - pz * B.dx > 0) continue;
      const a = group(A.group, x, z), b = group(B.group, x, z), r = c.r;
      const f = a < r && b < r ? r - Math.sqrt((r - a) * (r - a) + (r - b) * (r - b)) : Math.min(a, b);
      if (f < best) best = f;
    }
    return best;
  };
  return { j: j as Junction, lines, group, fillet };
}

const cache = new WeakMap<RoadGraph, { list: Junction[]; shapes: Shape[] }>();

function build(g: RoadGraph): { list: Junction[]; shapes: Shape[] } {
  const hit = cache.get(g);
  if (hit) return hit;
  const list: Junction[] = [], shapes: Shape[] = [];
  g.nodes.forEach((n, ni) => {
    const ids = g.at[ni]!;
    const ends: { e: RoadEdge; atStart: boolean }[] = [];
    for (const id of ids) {
      const e = g.edges[id]!;
      if (e.a === e.b) { if (e.a === n.id) ends.push({ e, atStart: true }, { e, atStart: false }); continue; }
      ends.push({ e, atStart: e.a === n.id });
    }
    if (ends.length < 3) return;
    // Each arm's heading away from the junction, sorted round the way.
    const raw = ends.map(({ e, atStart }) => {
      const p = e.path, L = p.length, k = Math.min(L - 1, 12), i = atStart ? k : L - 1 - k;
      const dx = p.x[i]! - n.x, dz = p.z[i]! - n.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
      return { edge: e.id, atStart, cls: e.cls, half: e.half, dx: dx / l, dz: dz / l, group: -1, angle: datan2(dx, dz) };
    }).sort((p, q) => p.angle - q.angle || p.edge - q.edge);
    // Straight-through roads: the pairs pointing most nearly opposite ways (within ~35 degrees), best first.
    const pairs: [number, number, number][] = [];
    for (let a = 0; a < raw.length; a += 1) for (let b = a + 1; b < raw.length; b += 1) {
      const dot = raw[a]!.dx * raw[b]!.dx + raw[a]!.dz * raw[b]!.dz;
      if (dot < -0.82) pairs.push([dot, a, b]);
    }
    pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    let groups = 0;
    for (const [, a, b] of pairs) if (raw[a]!.group < 0 && raw[b]!.group < 0) { raw[a]!.group = groups; raw[b]!.group = groups; groups += 1; }
    for (const a of raw) if (a.group < 0) { a.group = groups; groups += 1; }
    // The corners: between each arm and the next round the way, unless they're one road going straight on.
    const corners: JunctionCorner[] = [];
    raw.forEach((A, i) => {
      const bi = (i + 1) % raw.length, B = raw[bi]!;
      if (A.group === B.group || bi === i) return;
      // (Round the way from a to b -- angles rising -- an open corner turns through less than ~170 degrees.)
      const gap = (B.angle - A.angle + Math.PI * 4) % (Math.PI * 2);
      if (gap <= 0.05 || gap > 2.97) return;
      const small = SIZE[A.cls] < SIZE[B.cls] ? A.cls : B.cls, sin = Math.abs(A.dx * B.dz - A.dz * B.dx);
      // (A sharp corner takes a tighter return: the arc would otherwise run a long way down both roads.)
      corners.push({ a: i, b: bi, r: KERB_RETURN[small] * Math.max(0.5, Math.min(1, gap > Math.PI / 2 ? 1 : sin)) });
    });
    const base = { node: n.id, x: n.x, z: n.z };
    const shape = shapeOf(base, raw, corners, g);
    // Each arm's box: out along it until both its kerbs are clear of the returns and of every other road.
    const highway = raw.some((a) => a.cls === "highway");
    const arms: JunctionArm[] = raw.map((A, i) => {
      const line = shape.lines[i]!, L = line.length / 2 - 1;
      let box = 0;
      for (let s = 0; s <= L; s += 0.5) {
        const k = Math.min(L - 1, Math.floor(s)), t = s - k;
        const x0 = line[k * 2]!, z0 = line[k * 2 + 1]!, x1 = line[k * 2 + 2]!, z1 = line[k * 2 + 3]!;
        const ex = x1 - x0, ez = z1 - z0, el = Math.sqrt(ex * ex + ez * ez) || 1, nx = ez / el, nz = -ex / el;
        const cx = x0 + ex * t, cz = z0 + ez * t;
        let clear = true;
        for (const side of [-1, 1]) {
          const kx = cx + nx * side * (A.half + 0.05), kz = cz + nz * side * (A.half + 0.05);
          if (shape.fillet(kx, kz) < 0) clear = false;
          for (let o = 0; o < groups && clear; o += 1) if (o !== A.group && shape.group(o, kx, kz) < 0.5) clear = false;
        }
        if (clear) { box = s; break; }
        box = s + 0.5;
      }
      // (Never shallower than the widest road's half and a margin -- keel/road's junction -- so a crossing never
      // lands in the road it crosses at a skewed T, and the two arms of a through road square up.)
      box = Math.max(box, Math.ceil((Math.max(...raw.map((a) => a.half)) + 1.5 - CROSSING_GAP) * 2) / 2);
      const crosses = !highway && A.cls !== "highway";
      const crossing: readonly [number, number] | null = crosses ? [box + CROSSING_GAP, box + CROSSING_GAP + CROSSING_WIDTH] : null;
      const stop = A.cls === "highway" ? null : (crossing ? crossing[1] : box) + STOP_GAP;
      const sight = (stop ?? box) + SIGHT;
      return { edge: A.edge, atStart: A.atStart, cls: A.cls, half: A.half, dx: A.dx, dz: A.dz, group: A.group, box, crossing, stop, sight };
    });
    const reach = Math.max(...arms.map((a) => Math.max(a.box, a.crossing ? a.crossing[1] : 0))) + 1;
    const j: Junction = { ...base, arms, corners, reach };
    list.push(j);
    shapes.push({ ...shape, j });
  });
  const out = { list, shapes };
  cache.set(g, out);
  return out;
}

/** Every junction of a network (three or more road ends at a node), its arms, kerb returns and markings. */
export function junctionsOf(g: RoadGraph): readonly Junction[] {
  return build(g).list;
}

/** What the streets are at a point: the road field's nearest road, and where it stands against the kerbs and junctions. */
export interface StreetAt extends RoadAt {
  readonly cls: RoadClass;
  /** Distance from the carriageway's edge (m): negative on the tarmac -- the kerb returns rounded in, continuous everywhere. */
  readonly kerb: number;
  /** The nearest road's kerb and pavement widths (keel/city SIDEWALK). */
  readonly kerbW: number;
  readonly slabW: number;
  /** Inside a junction's box or its corners' returns (open tarmac: no lane markings). */
  readonly box: boolean;
  /** On a zebra's band (across the road and its dropped kerbs). */
  readonly crossing: boolean;
  /** Within a couple of metres of a crossing's band (its dropped kerbs and landings): nothing stands here. */
  readonly nearCrossing: boolean;
  /** On a stop line's band (across the lanes coming in, on the tarmac). */
  readonly stop: boolean;
  /** Inside a junction's sight line (see SIGHT). */
  readonly sight: boolean;
  /** The junction this point's road meets nearest (its node), or -1; and that end's arm (its box, crossing, stop line). */
  readonly node: number;
  readonly arm: JunctionArm | null;
  /** Metres to that junction along the road (Infinity if none). */
  readonly toJunction: number;
}

export interface Streets {
  readonly graph: RoadGraph;
  readonly field: RoadField;
  readonly junctions: readonly Junction[];
  /** The streets at a point, or null past the road field's reach. */
  at(x: number, z: number): StreetAt | null;
  /** The same, from the road field's answer there (a rasteriser that has it already: keel/road fieldWindow). */
  describe(x: number, z: number, at: RoadAt): StreetAt;
  /** The nearest junction along an edge, without querying kerbs or constructing a full street sample. */
  junctionAt(edge: number, along: number): { arm: JunctionArm | null; node: number; toJunction: number };
  /** Just the kerb distance with the returns rounded in, given the road field's answer there (for rasterising). */
  kerbAt(x: number, z: number, at: RoadAt | null): number;
}

const streetsCache = new WeakMap<RoadGraph, Streets>();

/** The streets of a network, read at any point (made once a graph). */
export function streetsOf(g: RoadGraph): Streets {
  let s = streetsCache.get(g);
  if (s) return s;
  const { list, shapes } = build(g), field = roadField(g);
  // (Junctions by 64 m cell, each in every cell its reach touches.)
  const grid = new Map<string, number[]>(), CELL = 64;
  shapes.forEach((sh, i) => {
    const r = sh.j.reach + 12;
    for (let cx = Math.floor((sh.j.x - r) / CELL); cx <= Math.floor((sh.j.x + r) / CELL); cx += 1) for (let cz = Math.floor((sh.j.z - r) / CELL); cz <= Math.floor((sh.j.z + r) / CELL); cz += 1) {
      const k = `${cx},${cz}`, l = grid.get(k) ?? [];
      l.push(i); grid.set(k, l);
    }
  });
  const near = (x: number, z: number): readonly number[] => grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
  // Per edge, its arm at its start and at its end (if either meets a junction).
  const armsOf = new Map<number, { start?: JunctionArm; end?: JunctionArm; sNode?: number; eNode?: number }>();
  for (const j of list) for (const a of j.arms) {
    const m = armsOf.get(a.edge) ?? {};
    if (a.atStart) { m.start = a; m.sNode = j.node; } else { m.end = a; m.eNode = j.node; }
    armsOf.set(a.edge, m);
  }
  const kerbAt = (x: number, z: number, at: RoadAt | null): number => {
    let k = at ? Math.abs(at.d) - Math.abs(at.half) : Infinity;
    for (const i of near(x, z)) {
      const sh = shapes[i]!, dx = x - sh.j.x, dz = z - sh.j.z, r = sh.j.reach + 12;
      if (dx * dx + dz * dz > r * r) continue;
      k = Math.min(k, sh.fillet(x, z));
    }
    return k;
  };
  const junctionAt = (edge: number, along: number): { arm: JunctionArm | null; node: number; toJunction: number } => {
    const m = armsOf.get(edge), fromEnd = g.edges[edge]!.path.length - 1 - along;
    const arm = m?.start && (!m.end || along <= fromEnd) ? m.start : m?.end;
    return { arm: arm ?? null, node: arm ? (arm.atStart ? m!.sNode! : m!.eNode!) : -1, toJunction: arm ? (arm.atStart ? along : fromEnd) : Infinity };
  };
  s = {
    graph: g, field, junctions: list, kerbAt, junctionAt,
    at(x, z) {
      const at = field.at(x, z);
      return at ? s!.describe(x, z, at) : null;
    },
    describe(x, z, at) {
      const e = g.edges[at.edge]!, sw = SIDEWALK[e.cls], kerb = kerbAt(x, z, at);
      // (Which end's junction this point is measured from: the nearer one along the road.)
      const { arm, node, toJunction: along } = junctionAt(at.edge, at.s);
      const ad = Math.abs(at.d), onRoad = kerb < 0;
      const filleted = kerb < ad - Math.abs(at.half) - 1e-6;
      const box = !!arm && (along < arm.box || (filleted && onRoad));
      const crossing = !!arm?.crossing && along >= arm.crossing[0] && along <= arm.crossing[1] && kerb < sw.kerb + sw.slab;
      const nearCrossing = !!arm?.crossing && along >= arm.crossing[0] - 2 && along <= arm.crossing[1] + 2;
      // (The stop line is across the lanes coming in: traffic keeps right, so at a road's start that's its left side.)
      const incoming = arm ? (arm.atStart ? at.d < 0 : at.d > 0) : false;
      const stop = !!arm && arm.stop !== null && onRoad && incoming && along >= arm.stop && along <= arm.stop + STOP_WIDTH;
      const sight = !!arm && along < arm.sight;
      return { ...at, cls: e.cls, kerb, kerbW: sw.kerb, slabW: sw.slab, box, crossing, nearCrossing, stop, sight, node, arm: arm ?? null, toJunction: along };
    },
  };
  streetsCache.set(g, s);
  return s;
}

/** A zebra crossing: which road, at which end (its node), and the band along it (m from that end). */
export interface Crossing {
  readonly edge: number;
  readonly node: number;
  /** From the edge's start (its node a) or its end (node b). */
  readonly atStart: boolean;
  readonly from: number;
  readonly to: number;
}

/** The crossings: across every road into a junction (none where a highway meets it), just outside its box. */
export function crossingsOf(g: RoadGraph): Crossing[] {
  const out: Crossing[] = [];
  for (const j of junctionsOf(g)) for (const a of j.arms) {
    if (!a.crossing) continue;
    // (A road too short for its crossings at both ends and a gap between keeps none.)
    if (g.edges[a.edge]!.path.length - 1 < a.crossing[1] * 2 + 6) continue;
    out.push({ edge: a.edge, node: j.node, atStart: a.atStart, from: a.crossing[0], to: a.crossing[1] });
  }
  return out;
}
