// The roads: a grid of arterials across the core -- turned, jittered and
// gently bent so it never reads as graph paper -- a ring highway round it, the
// grid's ends run out to meet the ring, and a street across most blocks,
// joining the arterials at T-junctions. Every road is held to its class's width
// by keel/road; an arterial is always wide enough to race four abreast.
//
// The lattice is kept in grid coordinates (i, j), so a block knows its four
// corners and a street knows which arterial it joins.

import { datan2, dcos, dsin } from "@keel-engine/core";
import { ROAD_CLASS, pathThrough, roadGraph, withShape } from "@keel-engine/road";
import type { EdgeSpec, Path, RoadGraph, RoadNode } from "@keel-engine/road";
import { sidewalkReach } from "./sidewalks.ts";
import { groundAt } from "./terrain.ts";
import { drawsFor, gatesOf } from "./site.ts";
import type { CityOptions, CitySite } from "./types.ts";

const TAU = Math.PI * 2;

/** A lattice cell's street, if it has one: which way it runs, and the junctions at its ends. */
export interface CellStreet { readonly along: "i" | "j"; readonly from: number; readonly to: number }

/** The road network, and the lattice it was laid from (what blocks are cut from). */
export interface Network {
  readonly graph: RoadGraph;
  /** Lattice node ids by "i,j". */
  readonly lattice: ReadonlyMap<string, number>;
  /** Per lattice edge "i,j,d" (d: 0 toward +i, 1 toward +j), its middle junction if a street meets it. */
  readonly mids: ReadonlyMap<string, number>;
  /** Per cell "i,j" with four corners, its street (or null). */
  readonly streets: ReadonlyMap<string, CellStreet | null>;
  /** Per CityOptions.links entry, the node its freeway ends at (-1: none could be laid). */
  readonly portals: readonly number[];
}

const key = (...n: number[]): string => n.join(",");

/** Split a sampled path at sample k into two open paths sharing that sample. */
function splitAt(p: Path, k: number): [Path, Path] {
  return [withShape(p.x.slice(0, k + 1), p.z.slice(0, k + 1), false), withShape(p.x.slice(k), p.z.slice(k), false)];
}

/** A spoke out to the ring: from a lattice junction or a gate to `end` on it (or a link's, which has no road of its own). */
interface Spoke {
  readonly node: number;
  /** A link's (CityOptions.links index): only a junction on the ring at its bearing, for its freeway to leave from. */
  readonly link?: number;
  readonly angle: number;
  readonly end: [number, number];
  /** A grid spoke's control points (see spokeLine); a gate's road has none. */
  readonly line?: { xs: number[]; zs: number[] };
}

/** How far apart two spokes' centre lines stay (m): both arterials' sidewalks, and a margin. */
const SPOKE_CLEAR = 2 * sidewalkReach("arterial", ROAD_CLASS.arterial.minHalf) + 6;
/** Metres out from a shared corner junction two spokes may run side by side (they leave it square to each other). */
const SHARED_MOUTH = 44;
/** Metres a T on a spoke keeps from either end of it, from another T on it, and from the start of the spoke meeting it. */
const TEE_ROOM = 60;

/** A path's sample nearest a point. */
function nearestSample(p: Path, x: number, z: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < p.length; i += 1) { const e = (p.x[i]! - x) ** 2 + (p.z[i]! - z) ** 2; if (e < bd) { bd = e; best = i; } }
  return best;
}

/** The tightest a grid spoke turns to meet the ring (m, its radius): a sweeper, not a corner. */
const SPOKE_TURN = 160;

/**
 * A grid spoke: out of its junction along the grid (`dir`), then -- just soon enough -- turning at SPOKE_TURN to meet the
 * ring (its radius on each bearing) square on. Its line's control points, the last on the ring.
 */
function spokeLine(from: RoadNode, dir: readonly [number, number], radiusAt: (a: number) => number): { xs: number[]; zs: number[] } {
  let x = from.x, z = from.z, hx = dir[0], hz = dir[1];
  const xs = [x], zs = [z];
  for (let t = 1; t < 4000; t += 1) {
    const r = Math.sqrt(x * x + z * z), R = radiusAt(datan2(x, z));
    if (r >= R) break;
    // (The turn from its heading to straight out, and whether what's left of the way out is only just enough for it.)
    const ox = x / r, oz = z / r, phi = datan2(hx * oz - hz * ox, hx * ox + hz * oz);
    if (R - r <= SPOKE_TURN * Math.abs(phi) + 1) {
      const a = Math.max(-1 / SPOKE_TURN, Math.min(1 / SPOKE_TURN, phi)), c = dcos(a), sn = dsin(a);
      [hx, hz] = [hx * c - hz * sn, hx * sn + hz * c];
    }
    x += hx; z += hz;
    if (t % 20 === 0) { xs.push(x); zs.push(z); }
  }
  // (The last control point is where it meets the ring; one a few metres short of it would kink the curve.)
  if ((xs[xs.length - 1]! - x) ** 2 + (zs[zs.length - 1]! - z) ** 2 < 100) { xs.pop(); zs.pop(); }
  xs.push(x); zs.push(z);
  return { xs, zs };
}

/** A spoke's line through its control points, its last moved to `to` (the ring junction, where the ring put it). */
const spokePath = (line: { xs: number[]; zs: number[] }, to: RoadNode): Path =>
  pathThrough([...line.xs.slice(0, -1), to.x], [...line.zs.slice(0, -1), to.z]);

export function layRoads(site: CitySite, options: CityOptions = {}): Network {
  const D = drawsFor(site.seed, "roads");
  const s = site.spacing, cy = dcos(site.yaw), sy = dsin(site.yaw);
  // (Grid frame to world: +i along the grid's right, +j along its forward, both turned by the site's yaw.)
  const world = (gx: number, gz: number): [number, number] => [gx * cy + gz * sy, -gx * sy + gz * cy];
  const nodes: RoadNode[] = [];
  const addNode = (x: number, z: number): number => { nodes.push({ id: nodes.length, x, z }); return nodes.length - 1; };

  // ---- the lattice: grid points inside the core, each nudged.
  const n = Math.ceil(site.core / s);
  const lattice = new Map<string, number>();
  const pos = new Map<string, [number, number]>();
  for (let j = -n; j <= n; j += 1) for (let i = -n; i <= n; i += 1) {
    const [x, z] = world(i * s + D.flat("jx", i, j) * s * 0.14, j * s + D.flat("jz", i, j) * s * 0.14);
    if (Math.sqrt(x * x + z * z) > site.core - 30) continue;
    pos.set(key(i, j), [x, z]);
  }
  // (Only points joined to at least one neighbour: a lone corner isn't a junction.)
  const has = (i: number, j: number): boolean => pos.has(key(i, j));
  for (let j = -n; j <= n; j += 1) for (let i = -n; i <= n; i += 1) {
    if (!has(i, j) || !(has(i + 1, j) || has(i - 1, j) || has(i, j + 1) || has(i, j - 1))) continue;
    const [x, z] = pos.get(key(i, j))!;
    lattice.set(key(i, j), addNode(x, z));
  }
  const nodeAt = (i: number, j: number): RoadNode | undefined => { const id = lattice.get(key(i, j)); return id === undefined ? undefined : nodes[id]; };

  // ---- streets: most cells get one, running one way or the other, meeting its two sides' arterials at their middles.
  const streets = new Map<string, CellStreet | null>();
  const wantMid = new Set<string>();
  for (let j = -n; j < n; j += 1) for (let i = -n; i < n; i += 1) {
    if (!nodeAt(i, j) || !nodeAt(i + 1, j) || !nodeAt(i + 1, j + 1) || !nodeAt(i, j + 1)) continue;
    if (D.u("street", i, j) > 0.78) { streets.set(key(i, j), null); continue; }
    const along = D.u("streetAlong", i, j) < 0.5 ? "i" : "j";
    // (Along j: from the middle of the cell's bottom arterial to the middle of its top one; along i, left to right.)
    const ends = along === "j" ? [key(i, j, 0), key(i, j + 1, 0)] : [key(i, j, 1), key(i + 1, j, 1)];
    for (const e of ends) wantMid.add(e);
    streets.set(key(i, j), { along, from: -1, to: -1 });
  }

  // ---- arterials: every lattice neighbour pair, bent a little through its middle; split there where a street meets it.
  const specs: EdgeSpec[] = [];
  const mids = new Map<string, number>();
  for (let j = -n; j <= n; j += 1) for (let i = -n; i <= n; i += 1) for (const d of [0, 1] as const) {
    const a = nodeAt(i, j), b = d === 0 ? nodeAt(i + 1, j) : nodeAt(i, j + 1);
    if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz);
    const bend = D.flat("bend", i * 2 + d, j) * s * 0.05;
    const mx = (a.x + b.x) / 2 + (dz / len) * bend, mz = (a.z + b.z) / 2 - (dx / len) * bend;
    const path = pathThrough([a.x, mx, b.x], [a.z, mz, b.z]);
    const k = key(i, j, d);
    if (!wantMid.has(k)) { specs.push({ a: a.id, b: b.id, cls: "arterial", path }); continue; }
    // (The junction sits exactly on a sample, so both halves meet at it.)
    let best = 0, bd = Infinity;
    for (let q = 0; q < path.length; q += 1) { const e = (path.x[q]! - mx) ** 2 + (path.z[q]! - mz) ** 2; if (e < bd) { bd = e; best = q; } }
    const m = addNode(path.x[best]!, path.z[best]!);
    mids.set(k, m);
    const [p1, p2] = splitAt(path, best);
    specs.push({ a: a.id, b: m, cls: "arterial", path: p1 }, { a: m, b: b.id, cls: "arterial", path: p2 });
  }
  // The streets themselves, now their junctions exist.
  for (const [ck, st] of streets) {
    if (!st) continue;
    const [i, j] = ck.split(",").map(Number) as [number, number];
    const ends = st.along === "j" ? [key(i, j, 0), key(i, j + 1, 0)] : [key(i, j, 1), key(i + 1, j, 1)];
    const from = mids.get(ends[0]!)!, to = mids.get(ends[1]!)!;
    const a = nodes[from]!, b = nodes[to]!;
    const wob = D.flat("streetBend", i, j) * s * 0.06;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz);
    const mx = (a.x + b.x) / 2 + (dz / len) * wob, mz = (a.z + b.z) / 2 - (dx / len) * wob;
    specs.push({ a: from, b: to, cls: "street", path: pathThrough([a.x, mx, b.x], [a.z, mz, b.z]) });
    streets.set(ck, { along: st.along, from, to });
  }

  // ---- the ring: a highway round the core, met by the grid's rows and columns run out to it.
  const R = ringRadius(site);
  const radiusAt = (a: number): number => R * (1 + 0.035 * dsin(a * 3 + D.u("ring1") * 6.28) + 0.02 * dsin(a * 5 + D.u("ring2") * 6.28));
  const spokes: Spoke[] = [];
  const out = (from: RoadNode, dirX: number, dirZ: number): void => {
    // (March out along the grid's own direction, turning in to meet the ring square on.)
    const line = spokeLine(from, [dirX, dirZ], radiusAt), ex = line.xs[line.xs.length - 1]!, ez = line.zs[line.zs.length - 1]!;
    spokes.push({ node: from.id, angle: datan2(ex, ez), end: [ex, ez], line });
  };
  const [rx, rz] = world(1, 0), [fx, fz] = world(0, 1);
  for (let j = -n; j <= n; j += 1) {
    const row = [...Array(2 * n + 1).keys()].map((q) => q - n).filter((i) => nodeAt(i, j));
    if (row.length < 2) continue;
    out(nodeAt(row[0]!, j)!, -rx, -rz);
    out(nodeAt(row[row.length - 1]!, j)!, rx, rz);
  }
  for (let i = -n; i <= n; i += 1) {
    const col = [...Array(2 * n + 1).keys()].map((q) => q - n).filter((j) => nodeAt(i, j));
    if (col.length < 2) continue;
    out(nodeAt(i, col[0]!)!, -fx, -fz);
    out(nodeAt(i, col[col.length - 1]!)!, fx, fz);
  }
  // The gates: roads out to the neighbouring cities, from the border in to the ring -- they're kept whatever else is
  // near them (a gate is a promise to the city next door).
  const gates = site.cell ? gatesOf(site.cell, site.size) : [];
  const gateSpokes = gates.map((g) => {
    const a = datan2(g.x, g.z), r = radiusAt(a);
    return { node: addNode(g.x, g.z), angle: a, end: [dsin(a) * r, dcos(a) * r] as [number, number] };
  });
  // (Spokes too close round the ring merge: two junctions a few metres apart are one bad junction.)
  const gap = (a: number, b: number): number => { const d = Math.abs(a - b) % (Math.PI * 2); return Math.min(d, Math.PI * 2 - d); };
  const kept: Spoke[] = [];
  for (const sp of gateSpokes) if (kept.every((k) => gap(k.angle, sp.angle) > 0.1)) kept.push(sp);
  // (A link to another place is a promise too: a junction on the ring right on its bearing, its freeway's way out.)
  (site.cell ? [] : options.links ?? []).forEach((l, k) => {
    const r = radiusAt(l.bearing), sp: Spoke = { node: -1, link: k, angle: datan2(dsin(l.bearing), dcos(l.bearing)), end: [dsin(l.bearing) * r, dcos(l.bearing) * r] };
    if (kept.every((q) => gap(q.angle, sp.angle) > 0.1)) kept.push(sp);
  });
  spokes.sort((p, q) => p.angle - q.angle || p.node - q.node);
  for (const sp of spokes) if (kept.every((k) => gap(k.angle, sp.angle) > 0.14)) kept.push(sp);
  // A grid spoke leaves its junction along the grid and bends to meet the ring square on (a shallow mouth there would be
  // two roads' pavements sharing ground for tens of metres). Where the grid's rows and columns run out across a corner
  // they'd cross with no junction: the shorter ones are laid first, and a later one that runs into one ends at it -- a T
  // junction, square on -- or, if it can't meet it cleanly (a glancing pass, too near an end or another T), isn't laid.
  const lines = kept.map((sp) => (sp.line ? pathThrough(sp.line.xs, sp.line.zs) : null));
  const tees = new Map<number, { k: number; node: number }[]>();
  const stub = new Map<number, number>();
  const laid: number[] = [];
  const grid = kept.map((_, q) => q).filter((q) => lines[q]).sort((p, q) => lines[p]!.length - lines[q]!.length || kept[p]!.node - kept[q]!.node);
  for (const q of grid) {
    const p = lines[q]!, from = nodes[kept[q]!.node]!;
    let hit: { h: number; s: number; k: number; d: number } | null = null;
    for (let s = 0; s < p.length && !hit; s += 2) {
      for (const h of laid) {
        const other = lines[h]!, shared = kept[h]!.node === kept[q]!.node;
        const k = nearestSample(other, p.x[s]!, p.z[s]!), d = Math.sqrt((other.x[k]! - p.x[s]!) ** 2 + (other.z[k]! - p.z[s]!) ** 2);
        // (Two spokes leaving one corner junction are side by side at first: that's their junction, not an overlap.)
        if (shared && s < SHARED_MOUTH && k < SHARED_MOUTH) continue;
        if (d < SPOKE_CLEAR) { hit = { h, s, k, d }; break; }
      }
    }
    if (!hit) { laid.push(q); continue; }
    // (Where it runs into the one it met: the nearest pass from here on.)
    const other = lines[hit.h]!;
    let best = { s: hit.s, k: hit.k, d: hit.d };
    for (let s = hit.s; s < p.length; s += 1) {
      const k = nearestSample(other, p.x[s]!, p.z[s]!), d = Math.sqrt((other.x[k]! - p.x[s]!) ** 2 + (other.z[k]! - p.z[s]!) ** 2);
      if (d < best.d) best = { s, k, d };
    }
    const host = tees.get(hit.h) ?? [];
    const square = Math.abs(dcos(p.yaw[best.s]! - other.yaw[best.k]!)) < 0.5;
    const clean = best.d < 2 && square && !stub.has(hit.h) && best.s > TEE_ROOM && best.k > TEE_ROOM && other.length - best.k > TEE_ROOM && host.every((t) => Math.abs(t.k - best.k) > TEE_ROOM);
    if (!clean) continue;
    const node = addNode(other.x[best.k]!, other.z[best.k]!);
    host.push({ k: best.k, node });
    tees.set(hit.h, host);
    stub.set(q, node);
    // (Its stub runs straight in: from its junction to the T.)
    lines[q] = pathThrough([from.x, nodes[node]!.x], [from.z, nodes[node]!.z]);
    laid.push(q);
  }
  // What reaches the ring: every gate and link, and every grid spoke laid whole.
  const full = kept.map((sp, q) => ({ sp, q })).filter(({ sp, q }) => !sp.line || (laid.includes(q) && !stub.has(q)));
  full.sort((p, q) => p.sp.angle - q.sp.angle || p.sp.node - q.sp.node);
  const ringNodes = full.map(({ sp }) => addNode(sp.end[0], sp.end[1]));
  // The ring itself: ONE smooth closed curve through every junction round it (so it has no kinks where roads join),
  // cut at those junctions into the highways between them.
  const xs: number[] = [], zs: number[] = [];
  full.forEach(({ sp }, q) => {
    const nx = full[(q + 1) % full.length]!.sp;
    let a1 = nx.angle;
    if (a1 <= sp.angle) a1 += Math.PI * 2;
    const steps = Math.max(2, Math.ceil(((a1 - sp.angle) * R) / 40));
    for (let k = 0; k < steps; k += 1) {
      const a = sp.angle + ((a1 - sp.angle) * k) / steps;
      if (k === 0) { xs.push(nodes[ringNodes[q]!]!.x); zs.push(nodes[ringNodes[q]!]!.z); } else { xs.push(dsin(a) * radiusAt(a)); zs.push(dcos(a) * radiusAt(a)); }
    }
  });
  const loop = pathThrough(xs, zs, { closed: true });
  // (Each ring junction moves onto the loop's nearest sample, so the spokes and the ring meet exactly.)
  const at = ringNodes.map((id) => {
    const best = nearestSample(loop, nodes[id]!.x, nodes[id]!.z);
    nodes[id] = { id, x: loop.x[best]!, z: loop.z[best]! };
    return best;
  });
  at.forEach((from, q) => {
    const to = at[(q + 1) % at.length]!, L = loop.length, span = (to - from + L) % L || L;
    const px = new Float64Array(span + 1), pz = new Float64Array(span + 1);
    for (let k = 0; k <= span; k += 1) { px[k] = loop.x[(from + k) % L]!; pz[k] = loop.z[(from + k) % L]!; }
    specs.push({ a: ringNodes[q]!, b: ringNodes[(q + 1) % at.length]!, cls: "highway", path: withShape(px, pz, false) });
  });
  full.forEach(({ sp, q: kq }, q) => {
    if (sp.link !== undefined) return;
    const from = nodes[sp.node]!, to = nodes[ringNodes[q]!]!;
    if ((to.x - from.x) ** 2 + (to.z - from.z) ** 2 <= 9) return;
    // (A gate road runs in square to its border for its last stretch, so the neighbour's road meets it head on.)
    if (!sp.line) {
      const nx = Math.abs(from.x) >= Math.abs(from.z) ? -Math.sign(from.x) : 0, nz = nx === 0 ? -Math.sign(from.z) : 0;
      specs.push({ a: sp.node, b: ringNodes[q]!, cls: "highway", path: pathThrough([from.x, from.x + nx * 40, to.x], [from.z, from.z + nz * 40, to.z]) });
      return;
    }
    // (A grid spoke, cut at every T on it into the arterials between.)
    const line = spokePath(sp.line!, to);
    let prev = 0, prevNode = sp.node;
    for (const t of [...(tees.get(kq) ?? [])].sort((p, r) => p.k - r.k)) {
      nodes[t.node] = { id: t.node, x: line.x[t.k]!, z: line.z[t.k]! };
      specs.push({ a: prevNode, b: t.node, cls: "arterial", path: withShape(line.x.slice(prev, t.k + 1), line.z.slice(prev, t.k + 1), false) });
      prev = t.k; prevNode = t.node;
    }
    specs.push({ a: prevNode, b: ringNodes[q]!, cls: "arterial", path: prev ? withShape(line.x.slice(prev), line.z.slice(prev), false) : line });
  });
  // The stubs, now the T's they end at are where their hosts put them.
  for (const [q, node] of stub) {
    const from = nodes[kept[q]!.node]!, to = nodes[node]!;
    specs.push({ a: from.id, b: node, cls: "arterial", path: pathThrough([from.x, to.x], [from.z, to.z]) });
  }

  // ---- the freeway: roads ADDED after all the above, so every road the city had keeps its id (a stored race names its
  // roads by id). A few exits off the ring's spoke junctions, each a freeway connector out to a beltway round the city on
  // its land (never over the sea), slip ramps from each connector onto the beltway both ways, and a spur out past it where
  // the region's freeway carries on to the horizon. A city in a world of cities keeps its gates instead.
  const portals: number[] = (options.links ?? []).map(() => -1);
  if (!site.cell) {
    const linkRing = portals.map((_, k) => { const q = full.findIndex(({ sp }) => sp.link === k); return q < 0 ? -1 : ringNodes[q]!; });
    layFreeway(site, nodes, specs, ringNodes, R, addNode, options, linkRing, portals);
  }

  return { graph: roadGraph(nodes, specs), lattice, mids, streets, portals };
}

/** The ring highway's radius (m) before its wobble: just past the core, inside the slab. */
const ringRadius = (site: CitySite): number => Math.min(site.core + 70, site.size / 2 - 40);

/** How far out the beltway runs past the ring (m), and how far along it a ramp meets it from its exit. */
const BELT_GAP = 230, RAMP_ALONG = 230, RAMP_IN = 110, SPUR = 150;
/** How far a bridge swings out past the beltway's line over the water at its middle (m): the harbour stays inside it. */
const BRIDGE_OUT = 260;
/** A ramp leaves its connector and meets the beltway at this angle (rad), its curve reaching this far (m) out of each. */
const RAMP_ANGLE = (70 * Math.PI) / 180, RAMP_REACH = 70;
/** A freeway's and a ramp's half widths (m): three lanes and a shoulder each way; one lane and its shoulders. */
export const FREEWAY_HALF = 12, RAMP_HALF = 4.4;

/** The beltway's radius on a bearing (m): past the ring by its gap, gently out of round -- the seed's, before a road is laid. */
function beltRadius(site: CitySite, a: number): number {
  const F = drawsFor(site.seed, "freeway");
  return (ringRadius(site) + BELT_GAP + 50 * F.u("beltGap")) * (1 + 0.025 * dsin(2 * a + F.u("beltPhase") * TAU));
}

/**
 * Where a link on `bearing` leaves the city (m from its middle): the end of its freeway's spur, out past the beltway.
 * A pure function of the site, so a world of places can join two cities' links without building either.
 */
export const portalRadius = (site: CitySite, bearing: number): number => beltRadius(site, bearing) + SPUR;

/** The farthest out any of a city's roads can run (m from its middle): its beltway's widest, and a bridge's swing or a spur past it. */
export function cityReach(site: CitySite): number {
  const F = drawsFor(site.seed, "freeway");
  return (ringRadius(site) + BELT_GAP + 50 * F.u("beltGap")) * 1.025 + Math.max(SPUR, BRIDGE_OUT);
}

function layFreeway(site: CitySite, nodes: RoadNode[], specs: EdgeSpec[], ringNodes: readonly number[], R: number, addNode: (x: number, z: number) => number, options: CityOptions, linkRing: readonly number[], portals: number[]): void {
  const F = drawsFor(site.seed, "freeway");
  const phase = F.u("beltPhase") * TAU;
  const rb = (a: number): number => (R + BELT_GAP + 50 * F.u("beltGap")) * (1 + 0.025 * dsin(2 * a + phase));
  const P = (a: number, r: number): [number, number] => [dsin(a) * r, dcos(a) * r];
  const dryAt = (x: number, z: number): boolean => { const g = groundAt(site, x, z); return g.height > -1 && g.biome !== "ocean" && g.biome !== "river"; };
  const dry = (a: number, r: number): boolean => dryAt(...P(a, r));
  const norm = (a: number): number => ((a % TAU) + TAU) % TAU;
  // The links' exits first (a link's own junction on the ring, on its bearing): a bridge link's way out is over the
  // water, so it needn't be dry. Then the seed's own: spoke junctions on the ring whose way out is dry, well apart.
  const links = options.links ?? [];
  const forced = linkRing.flatMap((id, k) => (id < 0 ? [] : [{ id, a: norm(links[k]!.bearing), link: k }]));
  const cands = ringNodes.filter((id) => !forced.some((f) => f.id === id)).map((id) => ({ id, a: norm(datan2(nodes[id]!.x, nodes[id]!.z)) }))
    .filter((c) => dry(c.a, rb(c.a)) && dry(c.a, rb(c.a) + SPUR) && dry(c.a, R + 40))
    .sort((p, q) => F.u("exit", p.id) - F.u("exit", q.id));
  const want = Math.max(3 + Math.floor(F.u("exits") * 3), forced.length);
  const gap = (a: number, b: number): number => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, TAU - d); };
  const picked: { id: number; a: number; link?: number }[] = [...forced];
  for (const c of cands) if (picked.length < want && picked.every((p) => gap(p.a, c.a) > 0.8)) picked.push(c);
  if (!picked.length) return;
  picked.sort((p, q) => p.a - q.a);
  const n = picked.length;
  // (An arc of the beltway from one exit to the next: only where it's dry all the way and not the long way round.)
  const sweep = (i: number): number => { const a0 = picked[i]!.a, a1 = picked[(i + 1) % n]!.a; return n === 1 ? 0 : norm(a1 - a0) || TAU; };
  const arcOk = picked.map((_, i) => {
    const d = sweep(i);
    if (d <= 0 || d > 2.4) return false;
    for (let t = 0; t <= 1; t += 0.02) { const a = picked[i]!.a + d * t; if (!dry(a, rb(a) - 25) || !dry(a, rb(a) + 25)) return false; }
    return true;
  });
  const arcPath = (a0: number, a1: number): Path => {
    const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) * rb(a0)) / 30)), xs: number[] = [], zs: number[] = [];
    for (let k = 0; k <= steps; k += 1) { const a = a0 + ((a1 - a0) * k) / steps, [x, z] = P(a, rb(a)); xs.push(x); zs.push(z); }
    return pathThrough(xs, zs);
  };
  const bez = (p0: readonly number[], p1: readonly number[], p2: readonly number[], p3: readonly number[]): Path => {
    const xs: number[] = [], zs: number[] = [];
    for (let k = 0; k <= 16; k += 1) {
      const t = k / 16, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      xs.push(b0 * p0[0]! + b1 * p1[0]! + b2 * p2[0]! + b3 * p3[0]!); zs.push(b0 * p0[1]! + b1 * p1[1]! + b2 * p2[1]! + b3 * p3[1]!);
    }
    return pathThrough(xs, zs);
  };
  const free = (a: number, b: number, path: Path): void => { specs.push({ a, b, cls: "freeway", path, half: FREEWAY_HALF }); };
  // Each exit: its junction on the beltway, the ramps' junction on its connector, where the ramps meet the beltway.
  const ex = picked.map((p) => {
    const r = rb(p.a), [jx, jz] = P(p.a, r), [kx, kz] = P(p.a, r - RAMP_IN), da = RAMP_ALONG / r;
    return { ...p, r, J: addNode(jx, jz), K: addNode(kx, kz), da, plus: -1, minus: -1 };
  });
  // The beltway: each dry arc, cut where the ramps meet it (the ramp junctions belong to the arc's two ends).
  ex.forEach((e, i) => {
    if (!arcOk[i]) return;
    const f = ex[(i + 1) % n]!, a0 = e.a, a1 = e.a + sweep(i);
    const [px, pz] = P(a0 + e.da, rb(a0 + e.da)), [qx, qz] = P(a1 - f.da, rb(a1 - f.da));
    e.plus = addNode(px, pz); f.minus = addNode(qx, qz);
    free(e.J, e.plus, arcPath(a0, a0 + e.da));
    free(e.plus, f.minus, arcPath(a0 + e.da, a1 - f.da));
    free(f.minus, f.J, arcPath(a1 - f.da, a1));
  });
  for (const e of ex) {
    const ring = nodes[e.id]!, K = nodes[e.K]!, J = nodes[e.J]!;
    // The connector, from the ring out to the beltway (its ramps' junction partway), and the spur on out past it -- to
    // its link's portal, for a link's exit. Where a link's way out crosses water, that stretch is a deck.
    const deckOver = (p: Path): boolean => e.link !== undefined && links[e.link]!.bridge && [0, 0.5, 1].some((t) => !dryAt(p.x[Math.round((p.length - 1) * t)]!, p.z[Math.round((p.length - 1) * t)]!));
    const lay = (a: number, b: number, path: Path): void => { if (deckOver(path)) specs.push({ a, b, cls: "freeway", path, half: FREEWAY_HALF, bridge: true }); else free(a, b, path); };
    lay(e.id, e.K, pathThrough([ring.x, K.x], [ring.z, K.z]));
    lay(e.K, e.J, pathThrough([K.x, J.x], [K.z, J.z]));
    const [sx, sz] = P(e.a, e.r + SPUR), end = addNode(sx, sz);
    lay(e.J, end, pathThrough([J.x, sx], [J.z, sz]));
    if (e.link !== undefined) portals[e.link] = end;
    // The slip ramps (one way): off the connector onto the beltway heading +, and off the beltway heading - back onto it.
    const out: [number, number] = [dsin(e.a), dcos(e.a)];
    const ramp = (node: number, toward: 1 | -1, onto: boolean): void => {
      const M = nodes[node]!, am = e.a + toward * e.da, tang: [number, number] = [dcos(am) * toward, -dsin(am) * toward];
      const side: [number, number] = [dcos(e.a) * toward, -dsin(e.a) * toward];
      // (A slip road across the corner: it leaves the connector at RAMP_ANGLE to it and meets the beltway at RAMP_ANGLE
      // to it, coming in from the city's side -- never running alongside either on shared ground.)
      const ca = dcos(RAMP_ANGLE), sa = dsin(RAMP_ANGLE), outM: [number, number] = [dsin(am), dcos(am)];
      const d1: [number, number] = [out[0] * ca + side[0] * sa, out[1] * ca + side[1] * sa];
      const d2: [number, number] = [tang[0] * ca + outM[0] * sa, tang[1] * ca + outM[1] * sa];
      const k0 = [K.x, K.z], k1 = [K.x + d1[0] * RAMP_REACH, K.z + d1[1] * RAMP_REACH];
      const m1 = [M.x - d2[0] * RAMP_REACH, M.z - d2[1] * RAMP_REACH];
      // (Onto the beltway: it merges running with the traffic, away from the exit. Off it: it leaves running toward the exit.)
      if (onto) specs.push({ a: e.K, b: node, cls: "ramp", oneWay: true, half: RAMP_HALF, path: bez(k0, k1, m1, [M.x, M.z]) });
      else specs.push({ a: node, b: e.K, cls: "ramp", oneWay: true, half: RAMP_HALF, path: bez([M.x, M.z], m1, k1, k0) });
    };
    if (e.plus >= 0) ramp(e.plus, 1, true);
    if (e.minus >= 0) ramp(e.minus, -1, false);
  }

  // ---- bridges: where the beltway's way round is the sea, it can cross it on a deck -- swinging out over the water
  // (clear of the harbour under it) and back to land at the next exit. Rare: a seed's roll, unless the game asks. A long
  // crossing is two bridges, meeting a connector out from the ring at a sea junction between them.
  const count = options.bridges ?? (F.u("bridge") < 0.18 ? 1 : 0);
  if (count <= 0 || n < 2) return;
  const wetArcs = picked.map((_, i) => i).filter((i) => !arcOk[i] && sweep(i) > 0.4 && sweep(i) <= 3.9).sort((p, q) => sweep(p) - sweep(q) || p - q);
  /** A point of the crossing from exit a0, `d` round: out over the water by BRIDGE_OUT at its middle, square to land at its ends. */
  const over = (a0: number, d: number, t: number): [number, number] => { const a = a0 + d * t, b = dsin(Math.PI * t); return P(a, rb(a) + BRIDGE_OUT * b * b); };
  const span = (a0: number, d: number, t0: number, t1: number): Path => {
    const steps = Math.max(2, Math.ceil((d * (t1 - t0) * (rb(a0) + BRIDGE_OUT)) / 30)), xs: number[] = [], zs: number[] = [];
    for (let k = 0; k <= steps; k += 1) { const [x, z] = over(a0, d, t0 + ((t1 - t0) * k) / steps); xs.push(x); zs.push(z); }
    return pathThrough(xs, zs);
  };
  const deck = (a: number, b: number, path: Path): void => { specs.push({ a, b, cls: "freeway", path, half: FREEWAY_HALF, bridge: true }); };
  let made = 0;
  for (const i of wetArcs) {
    if (made >= count) break;
    const e = ex[i]!, f = ex[(i + 1) % n]!, a0 = e.a, d = sweep(i);
    if (d > 2.2 && count - made >= 2) {
      // (Two bridges: a sea junction at the ring node nearest the crossing's middle, its connector straight out to it.)
      const mid = ringNodes.map((id) => ({ id, a: norm(datan2(nodes[id]!.x, nodes[id]!.z)) })).filter((c) => !picked.some((p) => p.id === c.id))
        .sort((p, q) => gap(p.a, a0 + d / 2) - gap(q.a, a0 + d / 2) || p.id - q.id)[0];
      if (!mid) continue;
      const tm = norm(mid.a - a0) / d;
      if (tm < 0.25 || tm > 0.75) continue;
      const [jx, jz] = over(a0, d, tm), jm = addNode(jx, jz), ring = nodes[mid.id]!;
      deck(e.J, jm, span(a0, d, 0, tm));
      deck(jm, f.J, span(a0, d, tm, 1));
      deck(mid.id, jm, pathThrough([ring.x, jx], [ring.z, jz]));
      made += 2;
    } else {
      deck(e.J, f.J, span(a0, d, 0, 1));
      made += 1;
    }
  }
}
