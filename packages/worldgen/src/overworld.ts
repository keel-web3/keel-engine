// The OVERWORLD, Minecraft-style: infinite, generated on demand a block of
// tiles at a time, the same tiles whichever block asks and in whatever order
// (test/overworld.test.ts: two chunks generated either way round, and inside
// one big block, agree tile for tile).
//
// How a tile is made, all pure functions of (seed, i, j):
//
//   climate      temperature, humidity, continentalness, erosion, weirdness:
//                warped simplex fbm (climate.ts's scales); temperature falls
//                with height (a lapse), so forests turn to alpine to peaks
//   height       continentalness shapes the land (deep sea, shelf, coast,
//                inland rise), erosion x "peaks and valleys" (from
//                weirdness) raises mountains, detail noise makes hills, each
//                scaled by the climate's nearest biomes' relief (blended);
//                whole steps -- terraces with cliffs, the pixel-art look
//   rivers       the zero contour of a warped field: winding channels that
//                never end in the middle of nowhere, carved a step (two in
//                the middle) under their banks; crossing a terrace, a
//                waterfall
//   lakes        a cell grid (Worley-style): a cell may hold a lake, its
//                level the lowest ground round its rim
//   biome        the nearest land biome to the climate at that height (only
//                an act's, if the world is in one); oceans under the sea;
//                beaches, stony shores and river banks as transitions
//   materials    the biome's ground weights by a noise partition (patches);
//                steep ground its steep type; above the snowline, snow
//   structures   placed on a spacing/separation grid per kind (villages,
//                ruins, dungeon entrances), validated by the ground under
//                them, flattened with graded aprons, stamped
//   ore, caves   veins by ridged noise in rock; an underground layer of
//                cellular-automaton caves
//
// then, over the block and a margin (still pure: the margin is generated
// too), what needs neighbours: steep faces, ramps up the terraces (the best
// candidate in a radius), the cave automaton's steps.

import { FLAG, WATER_NONE, terrainTypes } from "@keel-engine/terrain";
import type { TerrainTable } from "@keel-engine/terrain";
import { DEFAULT_BIOMES, createBiomeTable } from "./biomes.ts";
import type { BiomeDef, BiomeTable, Climate } from "./biomes.ts";
import { createLayers } from "./map.ts";
import type { TileLayers, WorldThing } from "./map.ts";
import { fbm, hash01, noiseField, seedOf } from "./noise.ts";
import { STRUCTURES, structuresIn, stampStructure } from "./structures.ts";
import type { PlacedStructure, StructureDef } from "./structures.ts";

export interface OverworldParams {
  /** Climate feature size (1: continents a few thousand tiles across). */
  readonly scale?: number;
  /** Shifts continentalness: + more land, - more sea (default 0.05). */
  readonly land?: number;
  /** Mountains' height scale (default 1). */
  readonly relief?: number;
  /** River density and width scale (default 1; 0 none). */
  readonly rivers?: number;
  /** Lake chance scale (default 1; 0 none). */
  readonly lakes?: number;
  readonly structures?: boolean;
  readonly caves?: boolean;
  readonly ores?: boolean;
  readonly ramps?: boolean;
  /** Only these biomes (an act's). */
  readonly biomes?: readonly string[] | null;
  /** Force one biome everywhere on land (a re-skin keeps the shape; this changes the choice). */
  readonly only?: string | null;
}

export interface Column {
  readonly climate: Climate;
  /** Float height in steps before rivers, lakes, structures. */
  readonly raw: number;
  readonly height: number;
  readonly water: number;
  readonly biome: number;
  readonly type: number;
  readonly river: number;
  /** 0..1: how deep inside its biome (1) or on a border (0). */
  readonly edge: number;
}

export interface Overworld {
  readonly seed: string;
  readonly table: BiomeTable;
  readonly types: TerrainTable;
  readonly params: Required<Omit<OverworldParams, "biomes" | "only">> & { readonly biomes: readonly string[] | null; readonly only: string | null };
  readonly seaLevel: number;
  climateAt(i: number, j: number): Climate;
  /** One tile, before anything that needs its neighbours. */
  column(i: number, j: number): Column;
  /** A block of tiles [i0, i0 + w) x [j0, j0 + d): the same tiles whatever block asks. */
  block(i0: number, j0: number, w: number, d: number): TileLayers;
  /** Things standing in a rectangle (world tiles): structures' buildings and props, entrances, resources. */
  thingsIn(i0: number, j0: number, i1: number, j1: number): WorldThing[];
  /** Structures reaching into a rectangle. */
  structuresIn(i0: number, j0: number, i1: number, j1: number): PlacedStructure[];
  /** Per tile, 0..255, the biome border factor of the last block (foliage's forest edges read it). */
  readonly structureDefs: readonly StructureDef[];
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// (Climate fbm crowds round the middle: stretched so the extremes of the table are reached.)
const spread = (v: number, k = 1.8): number => clamp((v - 0.5) * 2 * k, -1, 1);

export function createOverworld(seed: string, { params = {}, table = createBiomeTable(DEFAULT_BIOMES), types = terrainTypes(), structures = STRUCTURES }: { readonly params?: OverworldParams; readonly table?: BiomeTable; readonly types?: TerrainTable; readonly structures?: readonly StructureDef[] } = {}): Overworld {
  const P = {
    scale: params.scale ?? 1, land: params.land ?? 0.05, relief: params.relief ?? 1, rivers: params.rivers ?? 1, lakes: params.lakes ?? 1,
    structures: params.structures ?? true, caves: params.caves ?? true, ores: params.ores ?? true, ramps: params.ramps ?? true,
    biomes: params.biomes ?? null, only: params.only ?? null,
  };
  const s = P.scale;
  const S = (label: string): number => seedOf(seed, `overworld:${label}`);
  const cont = noiseField(S("continent"), { freq: 1 / (560 * s), octaves: 4, warp: { freq: 1 / (320 * s), amp: 110 * s } });
  const temp = noiseField(S("temperature"), { freq: 1 / (720 * s), octaves: 3, warp: { freq: 1 / (380 * s), amp: 120 * s } });
  const hum = noiseField(S("humidity"), { freq: 1 / (460 * s), octaves: 3, warp: { freq: 1 / (260 * s), amp: 90 * s } });
  const ero = noiseField(S("erosion"), { freq: 1 / (300 * s), octaves: 3 });
  const weird = noiseField(S("weirdness"), { freq: 1 / (260 * s), octaves: 2, warp: { freq: 1 / (150 * s), amp: 40 * s } });
  const detail = S("detail"), riverS = S("river"), ground = S("ground"), lakeS = S("lake"), oreS = S("ore"), caveS = S("cave"), rampS = S("ramp");
  const riverF = noiseField(riverS, { freq: 1 / (210 * s), octaves: 2, warp: { freq: 1 / (110 * s), amp: 46 * s } });
  const allowed = P.only ? table.allowedFor([P.only]) : table.allowedFor(P.biomes);
  const SEA = 0;
  const T = types;
  const id = (name: string): number => (T.has(name) ? T.id(name) : T.id("grass"));
  // Per biome: its ground as cumulative weights, bed, shore, steep, snowline (resolved to type ids once).
  const groundOf = table.list.map((b) => {
    const total = b.ground.reduce((a, g) => a + g.weight, 0) || 1;
    let acc = 0;
    return b.ground.map((g) => { acc += g.weight / total; return [id(g.type), acc] as const; });
  });
  const bedOf = table.list.map((b) => id(b.bed ?? b.ground[0]?.type ?? "sand"));
  const steepOf = table.list.map((b) => (b.steep ? id(b.steep) : -1));
  const snow = id("snow");
  const oceanFor = (t: number): number => table.ofKind("ocean", t, allowed);
  // (A transition's look from the act's own biomes when it has one; an act without a beach wears its shore, and back.)
  const kindIn = (kind: "beach" | "shore", t: number): number => { const b = table.ofKind(kind, t, allowed); return allowed && !allowed.has(b) ? -1 : b; };
  const beachFor = (t: number): number => { const b = kindIn(t < -0.45 ? "shore" : "beach", t); return b >= 0 ? b : kindIn(t < -0.45 ? "beach" : "shore", t) >= 0 ? kindIn(t < -0.45 ? "beach" : "shore", t) : table.ofKind("beach", t, allowed); };
  const shoreFor = (t: number): number => { const b = kindIn("shore", t); return b >= 0 ? b : beachFor(t); };
  const riverB = table.ofKind("river", 0, allowed);

  const climateAt = (i: number, j: number): Climate => ({
    temperature: spread(temp(i, j)), humidity: spread(hum(i, j)), continentalness: spread(cont(i, j), 1.6) + P.land,
    erosion: spread(ero(i, j)), weirdness: spread(weird(i, j), 2),
  });

  // Height from the climate (float steps), with the climate-nearest biomes' relief blended.
  const reliefOf = (b: BiomeDef): { base: number; amp: number; mountains: number } => ({ base: b.relief?.base ?? 0, amp: b.relief?.amp ?? 1, mountains: b.relief?.mountains ?? 1 });
  const rawHeight = (i: number, j: number, c: Climate): { h: number; near: { first: number; second: number; edge: number }; dv: number; bank: number } => {
    const C = c.continentalness;
    const near = table.nearest(c, null, allowed);
    const r1 = reliefOf(table.list[near.first]!), r2 = reliefOf(table.list[near.second]!);
    const w = 0.5 + 0.5 * near.edge;
    const amp = lerp(r2.amp, r1.amp, w), base = lerp(r2.base, r1.base, w), mtn = lerp(r2.mountains, r1.mountains, w);
    let h: number;
    if (C < -0.38) h = -5 + ((C + 1) / 0.62) * 3;
    else if (C < -0.14) h = lerp(-2, -0.4, (C + 0.38) / 0.24);
    else if (C < 0.02) h = lerp(-0.4, 1.3, (C + 0.14) / 0.16);
    else h = 1.3 + C * 2.2;
    const inland = smooth(0.0, 0.3, C);
    const pv = 1 - Math.abs(3 * Math.abs(c.weirdness) - 2); // (peaks and valleys)
    const e = (c.erosion + 1) / 2;
    const m = Math.max(0, pv * 0.5 + 0.5) ** 1.4 * (1 - e) ** 2 * 10 * P.relief * mtn * inland;
    const hill = (fbm({ freq: 1 / 120, octaves: 3, gain: 0.45 }, i, j, detail) - 0.5) * 2.5 * amp * (0.35 + 0.65 * (1 - e));
    const landMask = C > -0.14 ? smooth(-0.14, 0.06, C) : 0;
    const shape = h;
    h += (m + hill) * landMask + base * inland;
    // River valleys: a river's level follows the land's SLOW shape (no hills, a third of the mountains), so its water
    // steps down rarely -- long flat reaches, now and then a fall -- and near its channel the ground falls toward it.
    const rb = table.list[near.first]!.rivers ?? 1;
    const width = 0.02 * P.rivers * rb * (0.7 + 0.6 * (c.humidity + 1) / 2) * s ** -0.3;
    let dv = 99, bank = 0;
    if (width > 0 && C > -0.12) {
      dv = Math.abs(riverF(i, j) - 0.5) / width;
      bank = Math.max(1, Math.floor(shape + m * 0.3 * landMask + base * inland) + 1);
      if (dv < 5 && h > bank) h = lerp(bank + 0.35, h, smooth(1.1, 5, dv));
    }
    return { h, near, dv, bank };
  };

  // Lakes: a cell may hold one; its level the lowest ground on its rim (computed once per cell).
  const LAKE = Math.round(84 * s);
  const lakeCache = new Map<number, { ci: number; cj: number; r: number; level: number } | null>();
  const lakeOf = (a: number, b: number): { ci: number; cj: number; r: number; level: number } | null => {
    const key = a * 73856093 ^ b * 19349663;
    if (lakeCache.has(key)) return lakeCache.get(key)!;
    let out: { ci: number; cj: number; r: number; level: number } | null = null;
    const ci = Math.floor((a + 0.2 + hash01(a, b, lakeS + 1) * 0.6) * LAKE), cj = Math.floor((b + 0.2 + hash01(a, b, lakeS + 2) * 0.6) * LAKE);
    const c = climateAt(ci, cj);
    const hc = rawHeight(ci, cj, c);
    const bi = table.nearest(c, Math.floor(hc.h), allowed).first;
    const chance = 0.4 * P.lakes * (table.list[bi]!.lakes ?? 1) * (0.5 + 0.5 * (c.humidity + 1) / 2);
    if (hash01(a, b, lakeS + 3) < chance && hc.h >= 1.5 && hc.h < 7) {
      const r = 5 + hash01(a, b, lakeS + 4) * 8;
      let level = Infinity;
      for (let q = 0; q < 14; q += 1) {
        const ang = (q / 14) * Math.PI * 2;
        const x = Math.round(ci + Math.cos(ang) * r * 1.15), z = Math.round(cj + Math.sin(ang) * r * 1.15);
        level = Math.min(level, Math.floor(rawHeight(x, z, climateAt(x, z)).h));
      }
      if (level >= 1) out = { ci, cj, r, level };
    }
    if (lakeCache.size > 4096) lakeCache.clear();
    lakeCache.set(key, out);
    return out;
  };
  const lakeAt = (i: number, j: number): { level: number; depth: number } | null => {
    const a0 = Math.floor(i / LAKE), b0 = Math.floor(j / LAKE);
    for (let b = b0 - 1; b <= b0 + 1; b += 1) for (let a = a0 - 1; a <= a0 + 1; a += 1) {
      const L = lakeOf(a, b);
      if (!L) continue;
      const dx = i - L.ci, dz = j - L.cj;
      const wob = 0.72 + 0.56 * fbm({ freq: 1 / 9, octaves: 2 }, i, j, lakeS + 5);
      const q = Math.hypot(dx, dz) / (L.r * wob);
      if (q < 1) return { level: L.level, depth: q < 0.5 ? 2 : 1 };
    }
    return null;
  };

  const column = (i: number, j: number): Column => {
    const c = climateAt(i, j);
    const { h: raw, near, dv, bank } = rawHeight(i, j, c);
    let height = Math.floor(raw);
    let water = WATER_NONE;
    const lapse = Math.max(0, height - 3) * 0.07;
    const cl: Climate = { ...c, temperature: c.temperature - lapse };
    let biome: number, edge = near.edge;
    let river = 0;
    if (height < SEA) {
      biome = oceanFor(cl.temperature);
      water = SEA;
      edge = 1;
    } else {
      const nb = P.only ? { first: table.index(P.only), second: table.index(P.only), edge: 1 } : table.nearest(cl, height, allowed);
      biome = nb.first; edge = nb.edge;
      // Beaches and shores: land meeting the sea low.
      if (c.continentalness < 0.04 && height <= 1) {
        biome = c.erosion < -0.55 ? shoreFor(cl.temperature) : beachFor(cl.temperature);
        // (A beach is one flat level at the waterline: no stripes of one-step terraces across the sand.)
        height = Math.min(height, 0);
        edge = 1;
      }
      // Rivers: the warped field's middle contour, on land, below the peaks.
      if (dv < 2 && height < 9) river = dv < 1 ? (dv < 0.42 ? 3 : 2) : 1;
      const lake = P.lakes > 0 ? lakeAt(i, j) : null;
      if (lake && height <= lake.level + 1) {
        water = lake.level;
        height = Math.min(height, lake.level - lake.depth);
        river = 0;
      } else if (river >= 2) {
        // (On its reach's own level where the valley brought the ground down to it; else a step under the ground.)
        const w = Math.max(SEA, height >= bank - 1 && height <= bank + 1 ? bank - 1 : height - 1);
        water = w;
        height = w - (river === 3 ? 2 : 1);
        if (riverB >= 0) biome = riverB;
      }
    }
    const bd = table.list[biome]!;
    let type: number;
    if (water !== WATER_NONE && water > height) type = bedOf[biome]!;
    else {
      const g = groundOf[biome]!;
      const n = fbm({ freq: 1 / 15, octaves: 2 }, i, j, ground + biome * 7);
      // (A noise partition: patches, not salt and pepper; stretched so the shares come out near their weights.)
      const x = clamp((n - 0.5) * 2.2 + 0.5, 0, 0.999);
      type = g.length ? g[g.length - 1]![0] : id("grass");
      for (const [ty, acc] of g) if (x < acc) { type = ty; break; }
      if (river === 1 && riverB >= 0) type = hash01(i, j, riverS + 9) < 0.55 ? bedOf[riverB]! : type;
      const line = bd.snowline ?? Math.round(10 - cl.temperature * 5);
      if (height >= line) type = snow;
    }
    return { climate: cl, raw, height, water, biome, type, river, edge };
  };

  const defs = structures;
  const structuresNear = (i0: number, j0: number, i1: number, j1: number): PlacedStructure[] => (P.structures ? structuresIn(defs, seed, i0, j0, i1, j1, (i, j) => column(i, j), table, allowed) : []);

  const block = (bi0: number, bj0: number, bw: number, bd: number): TileLayers => {
    const M = 10; // (margin: ramps look 7 round, steep 1, caves 4)
    const i0 = bi0 - M, j0 = bj0 - M, w = bw + 2 * M, d = bd + 2 * M;
    const L = createLayers(i0, j0, w, d, T);
    const edgeF = new Uint8Array(w * d);
    for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
      const c = column(i0 + i, j0 + j);
      const k = j * w + i;
      L.height[k] = c.height; L.water[k] = c.water; L.type[k] = c.type; L.biome[k] = c.biome;
      if (c.river >= 2) L.flags[k] = FLAG.RIVER;
      edgeF[k] = Math.round(c.edge * 255);
    }
    // Mode smoothing, twice: a dry tile few of its neighbours share takes the commonest level round it -- no
    // one-tile bumps or pits, cleaner contour lines (each pass is exact one tile further in from the margin).
    for (let pass = 0; pass < 2; pass += 1) {
      const H = L.height.slice();
      const wet = (k: number): boolean => L.water[k] !== WATER_NONE;
      for (let j = 1; j < d - 1; j += 1) for (let i = 1; i < w - 1; i += 1) {
        const k = j * w + i;
        if (wet(k)) continue;
        const h = H[k]!;
        let same = 0, up = 0, down = 0;
        for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
          if (!di && !dj) continue;
          const v = H[k + di + dj * w]!;
          if (v === h) same += 1; else if (v > h) up += 1; else down += 1;
        }
        if (same >= 3) continue;
        // (Toward the side most neighbours are on, one step: never across water.)
        let nh = h + (up > down ? 1 : -1);
        let near = false;
        for (let dj = -1; dj <= 1 && !near; dj += 1) for (let di = -1; di <= 1; di += 1) if (wet(k + di + dj * w) && L.water[k + di + dj * w]! >= nh) { near = true; break; }
        if (near) nh = h;
        L.height[k] = nh;
      }
    }
    // Structures: flatten, then stamp (each is a pure function of its own seed and place).
    for (const st of structuresNear(i0, j0, i0 + w, j0 + d)) stampStructure(st, L, T, table);
    // Steep ground wears its biome's steep type (a neighbour two or more steps away).
    const H0 = L.height.slice();
    for (let j = 1; j < d - 1; j += 1) for (let i = 1; i < w - 1; i += 1) {
      const k = j * w + i;
      if (L.water[k] !== WATER_NONE && L.water[k]! > L.height[k]!) continue;
      if (L.zone[k]) continue;
      const st = steepOf[L.biome[k]!]!;
      if (st < 0) continue;
      const h = H0[k]!;
      if (Math.abs(H0[k - 1]! - h) >= 2 || Math.abs(H0[k + 1]! - h) >= 2 || Math.abs(H0[k - w]! - h) >= 2 || Math.abs(H0[k + w]! - h) >= 2) L.type[k] = st;
    }
    // Ore veins (ridged noise) in rock: the surface shows crystal where a crystal vein comes up.
    if (P.ores) {
      const rock = new Set([id("rock"), id("gravel"), id("sandstone"), id("snow"), id("ash")]);
      for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
        const k = j * w + i, wi = i0 + i, wj = j0 + j;
        if (!rock.has(L.type[k]!) || L.water[k] !== WATER_NONE) continue;
        const v = fbm({ freq: 1 / 26, octaves: 2, ridged: true }, wi, wj, oreS);
        if (v < 0.86) continue;
        const kind = 1 + Math.floor(fbm({ freq: 1 / 90, octaves: 1 }, wi, wj, oreS + 1) * 2.999);
        L.ore[k] = kind;
        if (kind === 2 && v > 0.93) L.type[k] = id("crystal");
      }
    }
    // Ramps: where a flat tile's neighbour is one step up and the tile behind is level, the best candidate
    // (by hash) within 7 tiles takes it, with its neighbour across when that fits too (two wide).
    if (P.ramps) {
      const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0];
      const cand = new Int8Array(w * d).fill(-1);
      const pr = new Float32Array(w * d);
      const H = L.height;
      const dry = (k: number): boolean => L.water[k] === WATER_NONE || L.water[k]! <= L.height[k]!;
      for (let j = 1; j < d - 1; j += 1) for (let i = 1; i < w - 1; i += 1) {
        const k = j * w + i;
        if (!dry(k) || L.zone[k]) continue;
        for (let dd = 0; dd < 4; dd += 1) {
          const t = k + DX[dd]! + DZ[dd]! * w, b = k - DX[dd]! - DZ[dd]! * w;
          if (H[t] === H[k]! + 1 && H[b] === H[k] && dry(t) && dry(b) && !L.zone[t]) { cand[k] = dd; pr[k] = hash01(i0 + i, j0 + j, rampS + dd); break; }
        }
      }
      const R = 7;
      const take = new Uint8Array(w * d);
      for (let j = R; j < d - R; j += 1) for (let i = R; i < w - R; i += 1) {
        const k = j * w + i;
        if (cand[k]! < 0) continue;
        let best = true;
        for (let dj = -R; dj <= R && best; dj += 1) for (let di = -R; di <= R; di += 1) { const q = k + di + dj * w; if (q !== k && cand[q]! >= 0 && pr[q]! > pr[k]!) { best = false; break; } }
        if (best) take[k] = 1;
      }
      for (let j = R; j < d - R; j += 1) for (let i = R; i < w - R; i += 1) {
        const k = j * w + i;
        if (!take[k]) continue;
        const dd = cand[k]!;
        L.flags[k] = L.flags[k]! | FLAG.RAMP; L.dir[k] = dd;
        // (Two wide: the neighbour across the rise, if it's a candidate the same way.)
        const ax = DZ[dd]!, az = DX[dd]!;
        for (const sgn of [1, -1]) { const q = k + ax * sgn + az * sgn * w; if (cand[q] === dd) { L.flags[q] = L.flags[q]! | FLAG.RAMP; L.dir[q] = dd; break; } }
      }
    }
    // Caves: the underground layer, a cellular automaton from hashed noise (4 steps of the 4-5 rule).
    if (P.caves) {
      let cur = new Uint8Array(w * d), next = new Uint8Array(w * d);
      for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
        const wi = i0 + i, wj = j0 + j;
        const bias = fbm({ freq: 1 / 60, octaves: 2 }, wi, wj, caveS) - 0.5;
        cur[j * w + i] = hash01(wi, wj, caveS + 1) < 0.46 + bias * 0.5 ? 1 : 0; // (1 = rock)
      }
      for (let step = 0; step < 4; step += 1) {
        for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
          let n = 0;
          for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
            if (!di && !dj) continue;
            const a = i + di, b = j + dj;
            n += a < 0 || b < 0 || a >= w || b >= d ? 1 : cur[b * w + a]!;
          }
          const k = j * w + i;
          next[k] = cur[k] ? (n >= 4 ? 1 : 0) : (n >= 5 ? 1 : 0);
        }
        [cur, next] = [next, cur];
      }
      for (let k = 0; k < w * d; k += 1) L.under[k] = cur[k] ? 0 : L.water[k] !== WATER_NONE ? 2 : 1;
    }
    // The block without its margin.
    const out = createLayers(bi0, bj0, bw, bd, T);
    for (let j = 0; j < bd; j += 1) {
      const a = (j + M) * w + M, b = j * bw;
      out.height.set(L.height.subarray(a, a + bw), b); out.type.set(L.type.subarray(a, a + bw), b); out.water.set(L.water.subarray(a, a + bw), b);
      out.flags.set(L.flags.subarray(a, a + bw), b); out.dir.set(L.dir.subarray(a, a + bw), b); out.biome.set(L.biome.subarray(a, a + bw), b);
      out.light.set(L.light.subarray(a, a + bw), b); out.under.set(L.under.subarray(a, a + bw), b); out.ore.set(L.ore.subarray(a, a + bw), b); out.zone.set(L.zone.subarray(a, a + bw), b);
    }
    return out;
  };

  return {
    seed, table, types: T, params: P, seaLevel: SEA, structureDefs: defs,
    climateAt, column, block,
    structuresIn: structuresNear,
    thingsIn(i0, j0, i1, j1) {
      const out: WorldThing[] = [];
      for (const st of structuresNear(i0, j0, i1, j1)) for (const th of st.things) {
        const ti = Math.floor(th.pos[0] / 2), tj = Math.floor(th.pos[2] / 2);
        if (ti >= i0 && tj >= j0 && ti < i1 && tj < j1) out.push(th);
      }
      return out;
    },
  };
}
