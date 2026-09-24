// The city's ground as one continuous surface, shaped with keel/elevation:
// rolling hills whose height is the district's (the old town and the docks
// near flat, midtown and the suburbs rolling, one district an overlook) plus
// the edge traits past the core (mountains climb, the sea drops); then every
// road graded along its line (highways and arterials first, then the streets
// that meet them), flat across its carriageway and pavements, each end pinned
// to its junction's height; the junctions levelled; each block's ground a
// terrace graded to the pavements round it (terraces.ts). All a pure function of
// the city.

import { dcos, dsin } from "@keel-engine/core";
import { addHills, cellX, cellZ, elevationOf, gradeCorridor, gridOver, levelDisc, levelRect, lockGrid, rangeUnder } from "@keel-engine/elevation";
import type { Elevation, HeightGrid } from "@keel-engine/elevation";
import { locate, roadField } from "@keel-engine/road";
import type { RoadClass } from "@keel-engine/road";
import { blockCentre } from "./districts.ts";
import { junctionsOf } from "./junctions.ts";
import { junctionRadius, sidewalkReach } from "./sidewalks.ts";
import { drawsFor } from "./site.ts";
import { SEA_LEVEL, groundAt } from "./terrain.ts";
import { layTerrace, terraceOf } from "./terraces.ts";
import type { Terrace } from "./terraces.ts";
import type { City, DistrictKind, Lot } from "./types.ts";

export interface CityHeight {
  /** Ground height (m) at a world point: roads, pavements, pads and the terrain between -- one continuous surface. */
  heightAt(x: number, z: number): number;
  /** The same surface baked for the GPU: heights (m) on a regular grid, row-major, x fastest; cell size in m. */
  readonly grid: HeightGrid;
  /** The surface as keel/elevation reads it (normals, range, raycasts, the GPU upload). */
  readonly elevation: Elevation;
  /** The land as it lies, before roads and pads (what a building's plinth steps down to). */
  natural(x: number, z: number): number;
  /**
   * A lot's pad: the ground at its middle. Its block is a terrace graded to the pavements round it (terraces.ts), so
   * the lot is level across near its road and follows the road's grade along it: a building's floor is set by its
   * door (the pavement's height there: pavementAt), not by this.
   */
  pad(lot: Lot): number;
  /**
   * The pavement's height abreast of a point: its road's graded height where the point stands beside it (what a door
   * opens onto) -- on the road given (an edge id: the one a building faces), or else the nearest.
   */
  pavementAt(x: number, z: number, edge?: number): number;
  /** A road's height along it (m, at arc length s): what its whole width stands at. */
  roadAt(edge: number, s: number): number;
  /**
   * The lowest and highest ground under an oriented box (centre, half extents, yaw): exact for the surface as drawn.
   * A building's plinth goes down past the lowest (keel/architecture foundations); where the highest is over its floor,
   * it's set into the slope.
   */
  under(x: number, z: number, hw: number, hd: number, yaw: number): [number, number];
}

/** The steepest a road of each class may climb (rise over run). */
export const MAX_GRADE: Readonly<Record<RoadClass, number>> = { highway: 0.05, arterial: 0.06, street: 0.08, alley: 0.1, ramp: 0.06, freeway: 0.045 };
/**
 * How far each district's hills rise and fall (m, either way), over hills ~HILL_SCALE m crest to crest: gentle, the
 * way a city's ground reads from a car -- the suburbs roll, downtown and the waterfront lie near flat.
 */
const RELIEF: Readonly<Record<DistrictKind, number>> = { core: 0.8, midtown: 3, oldtown: 0.6, industrial: 0.8, docks: 0.3, strip: 1.8, suburb: 4.5 };
const HILL_SCALE = 760;
/** The overlook: one hilly district lifted this high (m) as a whole, its hills this big. */
const OVERLOOK_LIFT = 7, OVERLOOK_RELIEF = 5;
/** The kerb's height over its road (a renderer's step; the surface itself is flat across road and pavement). */
export const KERB_STEP = 0.15;
/** Metres a road's embankment, a junction and a pad blend into the land over. */
const ROAD_BLEND = 12, JUNCTION_BLEND = 8, PAD_BLEND = 4, PAD_MARGIN = 1;
/** The order roads are graded in: the big ones first, so the smaller meet them. */
const RANK: Readonly<Record<RoadClass, number>> = { highway: 0, arterial: 1, street: 2, alley: 3, ramp: 1, freeway: 0 };

export function cityHeight(city: City, cell = 2): CityHeight {
  const steps = cityHeightSteps(city, cell);
  for (;;) { const r = steps.next(); if (r.done) return r.value; }
}

/**
 * cityHeight a stretch at a time, for a caller that must keep a frame going while a whole city's land is made: it
 * yields how far through it is (0..1) -- between the land's rows, the roads it grades, the lots it levels -- and
 * returns the height. Drained in one go it is cityHeight, to the bit.
 */
export function* cityHeightSteps(city: City, cell = 2): Generator<number, CityHeight, void> {
  const g = city.graph, site = city.site, D = drawsFor(site.seed, "height");
  // ---- the land: hills as high as their district's relief (a soft map over the blocks), one district an overlook.
  const centres = city.blocks.map(blockCentre);
  const kindOf = new Map<number, DistrictKind>();
  for (const l of city.lots) kindOf.set(l.block, city.districts[l.district]!.kind);
  const hills = city.districts.filter((d) => d.kind === "suburb" || d.kind === "midtown");
  const over = new Set(hills.length ? hills[Math.floor(D.u("overlook") * hills.length)]!.blocks : []);
  /** Per point: the district's relief and the overlook's lift, weighted over the nearest blocks (inverse distance). */
  const character = (x: number, z: number): [number, number] => {
    let sw = 0, sa = 0, sl = 0;
    centres.forEach(([cx, cz], b) => {
      const k = kindOf.get(b);
      if (!k) return;
      const w = 1 / ((cx - x) * (cx - x) + (cz - z) * (cz - z) + 2500);
      sw += w; sa += w * (over.has(b) ? OVERLOOK_RELIEF : RELIEF[k]); sl += w * (over.has(b) ? OVERLOOK_LIFT : 0);
    });
    return sw ? [sa / sw, sl / sw] : [6, 0];
  };
  const [bx0, bz0, bx1, bz1] = g.bounds, margin = 80;
  const land = gridOver(Math.floor(bx0 - margin), Math.floor(bz0 - margin), bx1 - bx0 + 2 * margin, bz1 - bz0 + 2 * margin, cell);
  // (The relief map is smooth, so it's read off a coarse copy: a few thousand points, not the whole grid's worth.)
  const coarse = gridOver(land.x0, land.z0, land.w * cell, land.h * cell, 24), lift = new Float32Array(coarse.w * coarse.h);
  for (let j = 0; j < coarse.h; j += 1) { for (let i = 0; i < coarse.w; i += 1) { const [a, l] = character(cellX(coarse, i), cellZ(coarse, j)); coarse.data[j * coarse.w + i] = a; lift[j * coarse.w + i] = l; } if (j % 8 === 7) yield 0.1 * (j / coarse.h); }
  yield 0.1;
  const liftGrid: HeightGrid = { ...coarse, data: lift };
  const reliefAt = elevationOf(coarse), liftAt = elevationOf(liftGrid);
  addHills(land, `${site.seed}|city-hills`, { amplitude: reliefAt.heightAt, scale: HILL_SCALE, octaves: 2 });
  yield 0.25;
  for (let j = 0; j < land.h; j += 1) {
    for (let i = 0; i < land.w; i += 1) {
      const x = cellX(land, i), z = cellZ(land, j);
      land.data[j * land.w + i] = land.data[j * land.w + i]! + liftAt.heightAt(x, z) + groundAt(site, x, z).height;
    }
    if (j % 16 === 15) yield 0.25 + 0.25 * (j / land.h);
  }
  yield 0.5;
  // ---- bridges: a deck raised along each over the water -- to BRIDGE_CLEAR over the sea at most, climbing to it at its
  // grade from whichever end stands on land -- so the land it grades over is the deck's, and its junctions at sea are.
  const decks = raiseBridges(city, land);
  const natural = elevationOf({ ...land, data: Float32Array.from(land.data) });
  yield 0.55;

  // ---- junction heights: the land round each, then reconciled so no road between two must climb past its grade.
  const nodeIndex = new Map(g.nodes.map((n, i) => [n.id, i]));
  /** How far out from a junction its level pad reaches (0 at a road's dead end or bend of one). */
  const reach = new Map(junctionsOf(g).map((j) => [j.node, j.reach]));
  const padOf = (id: number): number => reach.get(id) ?? (g.at[nodeIndex.get(id)!]!.length >= 2 ? junctionRadius(g, id) + 1 : 0);
  const nodeH = g.nodes.map((n) => natural.heightAt(n.x, n.z));
  for (let it = 0; it < 60; it += 1) {
    let moved = false;
    for (const e of g.edges) {
      if (e.a === e.b) continue;
      // (The climb has the road's length less the junction pads it's level across at each end.)
      const a = nodeIndex.get(e.a)!, b = nodeIndex.get(e.b)!, flats = padOf(e.a) + padOf(e.b);
      const room = MAX_GRADE[e.cls] * 0.85 * Math.max(1, e.path.length - 1 - flats);
      const d = nodeH[b]! - nodeH[a]!;
      if (Math.abs(d) <= room) continue;
      const fix = ((Math.abs(d) - room) / 2) * Math.sign(d);
      nodeH[a] = nodeH[a]! + fix; nodeH[b] = nodeH[b]! - fix; moved = true;
    }
    if (!moved) break;
  }

  // ---- junctions first, level at their heights -- and locked, with every flat surface after them, so what's shaped later
  // blends round what came before instead of cutting across it (a street's embankment never digs into its arterial).
  const lock = lockGrid(land);
  g.nodes.forEach((n, i) => { if (g.at[i]!.length >= 2) levelDisc(land, n.x, n.z, padOf(n.id), { height: nodeH[i]!, blend: JUNCTION_BLEND, lock }); });
  yield 0.6;
  // ---- roads, big first: graded along their line, flat over their carriageway and pavements, ends at their junctions.
  const profiles: { s: Float64Array; y: Float64Array }[] = new Array(g.edges.length);
  const order = [...g.edges].sort((p, q) => RANK[p.cls] - RANK[q.cls] || p.id - q.id);
  let graded = 0;
  for (const e of order) {
    const ends: [number | undefined, number | undefined] = [nodeH[nodeIndex.get(e.a)!], nodeH[nodeIndex.get(e.b)!]];
    // (Level across each junction's pad it leaves or meets -- the pad's radius -- so the road and the pad meet flush.)
    const endFlat: [number, number] = [padOf(e.a), padOf(e.b)];
    profiles[e.id] = gradeCorridor(land, e.path.x, e.path.z, { half: sidewalkReach(e.cls, e.half), blend: e.bridge ? BRIDGE_BLEND : ROAD_BLEND, maxGrade: MAX_GRADE[e.cls], smoothing: 40, ends: e.path.closed ? [ends[0], ends[0]] : ends, endFlat, lock });
    yield 0.6 + 0.25 * (++graded / order.length);
  }
  const roadAt = (edge: number, s: number): number => {
    const { s: ss, y } = profiles[edge]!;
    if (s <= ss[0]!) return y[0]!;
    if (s >= ss[ss.length - 1]!) return y[y.length - 1]!;
    let lo = 0, hi = ss.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ss[m]! <= s) lo = m; else hi = m; }
    const t = (s - ss[lo]!) / (ss[hi]! - ss[lo]! || 1);
    return y[lo]! + (y[hi]! - y[lo]!) * t;
  };
  // ---- the blocks: each one's ground a terrace graded to the pavements round it (terraces.ts) -- flush with every
  // pavement's back edge, following each road's grade along its frontage, level across near it and easing to the next
  // road's level across the middle of the block. (A landmark's block is its own ground: left as the land lies.)
  const field = roadField(g), roads = { graph: g, field, roadAt }, terraces = new Map<number, Terrace>();
  const claimed = new Set(city.landmarks.map((l) => l.block));
  let laid = 0;
  for (const block of city.blocks) {
    if (++laid % 8 === 0) yield 0.85 + 0.14 * (laid / city.blocks.length);
    if (claimed.has(block.id)) continue;
    const t = terraceOf(roads, block);
    if (t && layTerrace(land, lock, block, t) > 0) terraces.set(block.id, t);
  }
  // (A lot whose block had no terrace -- its sides not found -- is levelled the old way: a pad at its nearest road's height.)
  const pads = new Map<string, number>();
  for (const lot of city.lots) {
    const t = terraces.get(lot.block), { x, z, hw, hd, yaw } = lot.obb;
    if (t) { pads.set(lot.key, t.at(x, z)); continue; }
    const at = field.at(x, z), want = at ? roadAt(at.edge, at.s) : natural.heightAt(x, z);
    pads.set(lot.key, levelRect(land, x, z, hw * 2 + 2 * PAD_MARGIN, hd * 2 + 2 * PAD_MARGIN, yaw, { height: want, blend: PAD_BLEND, lock }));
  }
  // (The ground's ray march steps by the steepest slope anywhere: a bridge deck's flanks are cliffs, and counted they'd
  // shrink every ray's steps till it ran out of them short of the far ground. They're walls in front of a deck tens of
  // metres wide -- a ray at the land's own pace still can't miss the deck -- so the slope is the land's without them.)
  const elevation = withoutDecks(elevationOf(land), land, decks);
  return {
    heightAt: elevation.heightAt, grid: land, elevation, natural: natural.heightAt, roadAt,
    under: (x, z, hw, hd, yaw) => rangeUnder(land, x, z, hw, hd, dcos(yaw), dsin(yaw)),
    pad: (lot) => pads.get(lot.key) ?? elevation.heightAt(lot.obb.x, lot.obb.z),
    pavementAt: (x, z, edge) => {
      // (On a road asked for by name -- the one a building faces -- or else the nearest.)
      const e = edge === undefined ? undefined : g.edges[edge];
      if (e) return roadAt(e.id, locate(e.path, x, z).s);
      const at = field.at(x, z);
      return at ? roadAt(at.edge, at.s) : elevation.heightAt(x, z);
    },
  };
}

/** A deck's height over the sea at its highest (m, above the sea's level), and what its sides blend over (m: a deck, not an embankment). */
const BRIDGE_CLEAR = 16, BRIDGE_BLEND = 1.5;
/** How far past a deck's edge its raised ground still steepens the land -- its flank, and the grading of the roads that meet it (m). */
const DECK_SHADOW = 16;

/**
 * An Elevation whose slope -- the bound the ground's ray march steps by -- is the land's typical steepest, not its one
 * cliff: the cells a bridge deck was raised over (and the cuts and flanks beside them) are left out, and of the rest the
 * steepest 0.5% too (a coastal embankment's lip, a retaining wall's edge). Those are narrow; the ground behind them is
 * broad; a ray at the land's own pace can't step clean over what it's aiming at. Never under 1 (a 45-degree bank).
 */
function withoutDecks(e: Elevation, g: HeightGrid, decks: Uint8Array): Elevation {
  const s: number[] = [];
  const near = (i: number, j: number): boolean => {
    for (let dj = -2; dj <= 2; dj += 1) for (let di = -2; di <= 2; di += 1) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < g.w && b < g.h && decks[b * g.w + a]) return true;
    }
    return false;
  };
  for (let j = 0; j < g.h; j += 1) for (let i = 0; i < g.w; i += 1) {
    const k = j * g.w + i, v = g.data[k]!;
    let m = 0;
    if (i + 1 < g.w) m = Math.max(m, Math.abs(g.data[k + 1]! - v) / g.cell);
    if (j + 1 < g.h) m = Math.max(m, Math.abs(g.data[k + g.w]! - v) / g.cell);
    // (Only the steep ones are ever the answer: keep those, cheaply.)
    if (m > 0.5 && !near(i, j)) s.push(m);
  }
  if (!s.length) return { ...e, slope: Math.min(e.slope, 1) };
  s.sort((a, b) => a - b);
  const land = g.w * g.h, drop = Math.floor(land * 0.005), kept = s.length - 1 - drop;
  return { ...e, slope: Math.min(e.slope, Math.max(1, kept >= 0 ? s[kept]! : 1)) };
}

/** Raise the land under each bridge to its deck; the cells it raised (1), for withoutDecks. */
function raiseBridges(city: City, land: HeightGrid): Uint8Array {
  const raised = new Uint8Array(land.w * land.h);
  const g = city.graph, site = city.site, top = SEA_LEVEL + BRIDGE_CLEAR;
  const ground = (x: number, z: number): number => {
    const i = Math.max(0, Math.min(land.w - 1, Math.round((x - land.x0) / land.cell))), j = Math.max(0, Math.min(land.h - 1, Math.round((z - land.z0) / land.cell)));
    return land.data[j * land.w + i]!;
  };
  const wet = (x: number, z: number): boolean => ground(x, z) < SEA_LEVEL + 0.5 || groundAt(site, x, z).biome === "ocean";
  for (const e of g.edges) {
    if (!e.bridge) continue;
    const p = e.path, L = p.length, grade = MAX_GRADE[e.cls] * 0.8;
    // (An end on land starts at the land; an end at sea, a junction out on the water, is up at the deck already.)
    const h0 = wet(p.x[0]!, p.z[0]!) ? top : ground(p.x[0]!, p.z[0]!), h1 = wet(p.x[L - 1]!, p.z[L - 1]!) ? top : ground(p.x[L - 1]!, p.z[L - 1]!);
    const reach = e.half + 2.5;
    for (let s = 0; s < L; s += 1) {
      const want = Math.min(top, h0 + s * grade, h1 + (L - 1 - s) * grade);
      const cx = p.x[s]!, cz = p.z[s]!;
      const out = reach + DECK_SHADOW, i0 = Math.max(0, Math.floor((cx - out - land.x0) / land.cell)), i1 = Math.min(land.w - 1, Math.ceil((cx + out - land.x0) / land.cell));
      const j0 = Math.max(0, Math.floor((cz - out - land.z0) / land.cell)), j1 = Math.min(land.h - 1, Math.ceil((cz + out - land.z0) / land.cell));
      for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) {
        const x = land.x0 + i * land.cell, z = land.z0 + j * land.cell;
        const d2 = (x - cx) ** 2 + (z - cz) ** 2;
        if (d2 > (reach + DECK_SHADOW) ** 2) continue;
        const k = j * land.w + i;
        // (The deck's ground, and its cut or its flank beside it: the cells the march's slope leaves out.)
        raised[k] = 1;
        if (d2 <= reach * reach && land.data[k]! < want) land.data[k] = want;
      }
    }
  }
  return raised;
}

const heights = new WeakMap<City, Map<number, CityHeight>>();
/** A city's height, made once a city (and cell size). */
export function heightOf(city: City, cell = 2): CityHeight {
  const steps = heightSteps(city, cell);
  for (;;) { const r = steps.next(); if (r.done) return r.value; }
}

/** heightOf a stretch at a time (cityHeightSteps): kept with the city as heightOf keeps it -- nothing to do once made. */
export function* heightSteps(city: City, cell = 2): Generator<number, CityHeight, void> {
  let m = heights.get(city);
  if (!m) { m = new Map(); heights.set(city, m); }
  let h = m.get(cell);
  // (Should heightOf have made it meanwhile, that one is the city's: one height a city, whoever made it first.)
  if (!h) { const made = yield* cityHeightSteps(city, cell); h = m.get(cell) ?? made; m.set(cell, h); }
  return h;
}
