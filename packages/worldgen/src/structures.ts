// Structures in an infinite world: villages, ruins, dungeon entrances --
// placed Minecraft's way. Each kind has a SPACING (a grid of cells that many
// tiles across) and a SEPARATION (the margin no two may come closer than):
// each cell holds at most one, at a hashed spot inside the cell's first
// (spacing - separation) tiles, so every chunk that asks finds the same
// structures without ever seeing the others' chunks. A candidate stands if
// the ground under it will take it (its biome, dry land, not too steep);
// then it flattens its ground (a level disc and a graded apron, a step a
// ring) and stamps its tiles and things -- all a pure function of its own
// seed and place.

import { FLAG, WATER_NONE } from "@keel-engine/terrain";
import type { TerrainTable } from "@keel-engine/terrain";
import type { BiomeTable } from "./biomes.ts";
import type { TileLayers, WorldThing } from "./map.ts";
import { hash01, rng, seedOf } from "./noise.ts";
import type { Rng } from "./noise.ts";

/** What a structure's builder returns: tiles (relative to its centre and level) and things. */
export interface StructurePlan {
  /** Tiles to paint: offset from the centre, a height relative to the level (default 0), a type, flags. */
  readonly tiles: ReadonlyArray<{ readonly di: number; readonly dj: number; readonly dh?: number; readonly type?: string; readonly flags?: number; readonly light?: number }>;
  /** Things: offset from the centre in tiles (fractions allowed), height relative to the level. */
  readonly things: ReadonlyArray<Omit<WorldThing, "id" | "pos" | "footprint"> & { readonly at: readonly [number, number]; readonly dh?: number; readonly foot?: readonly [number, number, number, number] | null }>;
}

export interface StructureContext {
  readonly rng: Rng;
  readonly seed: number;
  readonly level: number;
  readonly biome: string;
  readonly radius: number;
}

export interface StructureDef {
  readonly id: string;
  /** Grid cell size and minimum gap (tiles). */
  readonly spacing: number;
  readonly separation: number;
  /** Its flat disc's radius (tiles); the apron grades beyond it. */
  readonly radius: number;
  /** A salt so two kinds' grids don't line up. */
  readonly salt: number;
  /** Biomes it may stand in (ids); null: any land biome. */
  readonly biomes?: readonly string[] | null;
  /** How far the ground may rise or fall under it before it's refused (steps). */
  readonly maxRelief?: number;
  /** Of the cells, how many try (default 1). */
  readonly chance?: number;
  build(ctx: StructureContext): StructurePlan;
}

export interface PlacedStructure {
  readonly def: StructureDef;
  readonly id: string;
  readonly ci: number;
  readonly cj: number;
  readonly level: number;
  readonly biome: string;
  readonly seed: number;
  readonly plan: StructurePlan;
  /** Everything it touches (the apron too), world tiles [i0, j0, i1, j1). */
  readonly rect: readonly [number, number, number, number];
  readonly things: readonly WorldThing[];
}

const APRON = 4;
const TS = 2; // (world metres a tile: things' positions)

const houses = ["cottage", "cottage", "hall", "workshop", "shop", "tower"];

/** The engine's structures. */
export const STRUCTURES: readonly StructureDef[] = [
  {
    id: "village", spacing: 180, separation: 70, radius: 13, salt: 11, maxRelief: 3, chance: 0.85,
    biomes: ["plains", "savanna", "desert", "taiga", "forest", "birch-forest", "tundra", "jungle"],
    build({ rng: R, biome }) {
      const tiles: Array<{ di: number; dj: number; dh?: number; type?: string; flags?: number }> = [];
      const things: Array<StructurePlan["things"][number]> = [];
      const pave = biome === "desert" ? "sandstone" : "flagstone", lane = biome === "desert" || biome === "savanna" ? "clay" : "path";
      const set = (di: number, dj: number, type: string): void => { tiles.push({ di, dj, type }); };
      // The plaza and its well.
      for (let dj = -3; dj <= 3; dj += 1) for (let di = -3; di <= 3; di += 1) if (Math.hypot(di, dj) < 2.8) set(di, dj, pave);
      things.push({ kind: "prop", pack: "packs/buildings", object: "path-stones", at: [0.5, 0.5], yaw: 0, scale: 1, tags: ["well"] });
      things.push({ kind: "light", at: [2.5, 2.5], yaw: 0, scale: 1, tags: ["lantern"] }, { kind: "light", at: [-1.5, -1.5], yaw: 0, scale: 1, tags: ["lantern"] });
      // Lanes out to the edge, wandering a little; lots beside them.
      const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0];
      let n = 0;
      for (let d = 0; d < 4; d += 1) {
        if (d > 1 && R.chance(0.25)) continue;
        let side = 0;
        const len = R.int(9, 12);
        for (let s = 3; s <= len; s += 1) {
          if (s > 5 && R.chance(0.18)) side = Math.max(-1, Math.min(1, side + (R.chance(0.5) ? 1 : -1)));
          const ax = DZ[d]!, az = DX[d]!;
          const ci = DX[d]! * s + ax * side, cj = DZ[d]! * s + az * side;
          set(ci, cj, lane);
          if (s < 6) set(ci + ax, cj + az, lane);
        }
        // Lots: a house every few tiles along the lane, alternate sides, facing it.
        for (let s = 5; s <= len - 1; s += R.int(3, 4)) {
          if (!R.chance(0.78)) continue;
          const sideSign = (n & 1) ? 1 : -1;
          const ax = DZ[d]! * sideSign, az = DX[d]! * sideSign;
          const hi = DX[d]! * s + ax * 3, hj = DZ[d]! * s + az * 3;
          const object = R.pick(houses);
          const yaw = Math.atan2(-ax, -az);
          things.push({ kind: "building", pack: "packs/buildings", object, at: [hi + 0.5, hj + 0.5], yaw, scale: 1, tags: ["house", "village"], foot: [hi - 1, hj - 1, hi + 2, hj + 2] });
          for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) tiles.push({ di: hi + di, dj: hj + dj, type: "dirt", flags: FLAG.BLOCKED | FLAG.NOBUILD });
          // (A garden plot behind some.)
          if (R.chance(0.45)) for (let q = 0; q < 3; q += 1) for (let p = -1; p <= 1; p += 1) set(hi + ax * (2 + q) + az * p, hj + az * (2 + q) + ax * p, q & 1 ? "moss" : "dirt");
          n += 1;
        }
      }
      // A field or two at the edge: furrows (dirt and green rows).
      for (let f = 0; f < R.int(1, 2); f += 1) {
        const ang = R.between(0, Math.PI * 2), fi = Math.round(Math.cos(ang) * 9), fj = Math.round(Math.sin(ang) * 9);
        for (let dj = -2; dj <= 2; dj += 1) for (let di = -3; di <= 3; di += 1) set(fi + di, fj + dj, (dj & 1) ? "moss" : "dirt");
      }
      return { tiles, things };
    },
  },
  {
    id: "ruin", spacing: 120, separation: 36, radius: 6, salt: 23, maxRelief: 3, chance: 0.9, biomes: null,
    build({ rng: R, biome }) {
      const tiles: Array<{ di: number; dj: number; dh?: number; type?: string; flags?: number }> = [];
      const things: Array<StructurePlan["things"][number]> = [];
      const floor = biome === "desert" || biome === "badlands" ? "sandstone" : "flagstone";
      const hw = R.int(3, 4), hd = R.int(2, 3);
      for (let dj = -hd; dj <= hd; dj += 1) for (let di = -hw; di <= hw; di += 1) {
        const rim = Math.abs(di) === hw || Math.abs(dj) === hd;
        if (rim) {
          const h = R.f();
          if (h < 0.34) tiles.push({ di, dj, type: floor });
          else tiles.push({ di, dj, dh: h > 0.85 ? 2 : 1, type: "brick" });
        } else tiles.push({ di, dj, type: R.chance(0.22) ? "moss" : floor });
      }
      for (let q = 0; q < R.int(2, 4); q += 1) things.push({ kind: "prop", pack: "packs/foliage", object: R.chance(0.2) ? "crystal" : "rock", at: [R.between(-hw + 1, hw - 1), R.between(-hd + 1, hd - 1)], yaw: R.between(0, 6.28), scale: R.between(0.4, 0.8), tags: ["rubble"] });
      things.push({ kind: "marker", at: [0.5, 0.5], yaw: 0, scale: 1, tags: ["ruin", "loot"] });
      return { tiles, things };
    },
  },
  {
    id: "entrance", spacing: 100, separation: 30, radius: 4, salt: 37, maxRelief: 2, chance: 0.8, biomes: null,
    build({ rng: R, seed }) {
      const tiles: Array<{ di: number; dj: number; dh?: number; type?: string; flags?: number }> = [];
      for (let dj = -3; dj <= 3; dj += 1) for (let di = -3; di <= 3; di += 1) {
        const r = Math.hypot(di + 0.5, dj + 0.5);
        if (r > 3.3) continue;
        const pit = di >= -1 && di <= 0 && dj >= -1 && dj <= 0;
        const rim = !pit && Math.max(Math.abs(di + 0.5), Math.abs(dj + 0.5)) <= 2 && dj !== -2;
        if (pit) tiles.push({ di, dj, dh: -4, type: "brick", flags: FLAG.BLOCKED });
        else if (rim) tiles.push({ di, dj, dh: 1, type: "brick" });
        else tiles.push({ di, dj, type: R.chance(0.2) ? "moss" : "flagstone" });
      }
      return {
        tiles,
        things: [
          { kind: "entrance", at: [0, 0], dh: 0, yaw: 0, scale: 1, tags: ["dungeon"], data: { seed: `${seed >>> 0}`, rooms: R.int(8, 14) } },
          { kind: "light", at: [-2.5, -2.5], yaw: 0, scale: 1, tags: ["torch"] }, { kind: "light", at: [2.5, -2.5], yaw: 0, scale: 1, tags: ["torch"] },
        ],
      };
    },
  },
];

/** Structures whose ground reaches into [i0, i1) x [j0, j1), each validated against the ground (a column sampler). */
export function structuresIn(
  defs: readonly StructureDef[], seed: string, i0: number, j0: number, i1: number, j1: number,
  column: (i: number, j: number) => { readonly height: number; readonly water: number; readonly biome: number; readonly raw: number },
  table: BiomeTable, allowed: ReadonlySet<number> | null,
): PlacedStructure[] {
  const out: PlacedStructure[] = [];
  for (const def of defs) {
    const reach = def.radius + APRON + 1;
    const a0 = Math.floor((i0 - reach) / def.spacing), a1 = Math.floor((i1 + reach) / def.spacing);
    const b0 = Math.floor((j0 - reach) / def.spacing), b1 = Math.floor((j1 + reach) / def.spacing);
    const salt = seedOf(seed, `structure:${def.id}:${def.salt}`);
    for (let b = b0; b <= b1; b += 1) for (let a = a0; a <= a1; a += 1) {
      if (hash01(a, b, salt) >= (def.chance ?? 1)) continue;
      const room = def.spacing - def.separation;
      const ci = a * def.spacing + Math.floor(hash01(a, b, salt + 1) * room), cj = b * def.spacing + Math.floor(hash01(a, b, salt + 2) * room);
      if (ci + reach < i0 || ci - reach >= i1 || cj + reach < j0 || cj - reach >= j1) continue;
      const placed = placeAt(def, seed, salt, a, b, ci, cj, column, table, allowed);
      if (placed) out.push(placed);
    }
  }
  return out;
}

const cache = new Map<string, PlacedStructure | null>();

function placeAt(def: StructureDef, seed: string, salt: number, a: number, b: number, ci: number, cj: number, column: (i: number, j: number) => { readonly height: number; readonly water: number; readonly biome: number; readonly raw: number }, table: BiomeTable, allowed: ReadonlySet<number> | null): PlacedStructure | null {
  const key = `${seed}|${def.id}|${a}|${b}|${allowed ? [...allowed].join(",") : ""}|${table.list.length}`;
  if (cache.has(key)) return cache.get(key)!;
  const c = column(ci, cj);
  let ok = c.height >= 1 && (c.water === WATER_NONE || c.water <= c.height);
  const biome = table.list[c.biome]!;
  if (ok && (biome.kind ?? "land") !== "land") ok = false;
  if (ok && def.biomes && !def.biomes.includes(biome.id)) ok = false;
  if (ok) {
    // (The ground round it: dry, and within its relief.)
    let lo = c.height, hi = c.height;
    for (let q = 0; q < 12 && ok; q += 1) {
      const ang = (q / 12) * Math.PI * 2;
      const s = column(Math.round(ci + Math.cos(ang) * def.radius), Math.round(cj + Math.sin(ang) * def.radius));
      if (s.water !== WATER_NONE && s.water > s.height) ok = false;
      lo = Math.min(lo, s.height); hi = Math.max(hi, s.height);
    }
    if (hi - lo > (def.maxRelief ?? 3)) ok = false;
  }
  let out: PlacedStructure | null = null;
  if (ok) {
    const sd = seedOf(seed, `structure:${def.id}:${a}:${b}`);
    const plan = def.build({ rng: rng(sd), seed: sd, level: c.height, biome: biome.id, radius: def.radius });
    const id = `${def.id}@${a},${b}`;
    const things: WorldThing[] = plan.things.map((th, n) => {
      const { at, dh, foot, ...rest } = th;
      return {
        ...rest, id: `${id}#${n}`,
        pos: [(ci + at[0]) * TS, (c.height + (dh ?? 0)) * 1, (cj + at[1]) * TS] as const,
        footprint: foot ? [ci + foot[0], cj + foot[1], ci + foot[2], cj + foot[3]] as const : null,
        data: { ...(rest.data ?? {}), structure: id },
      };
    });
    const R = def.radius + APRON;
    out = { def, id, ci, cj, level: c.height, biome: biome.id, seed: sd, plan, rect: [ci - R - 1, cj - R - 1, ci + R + 2, cj + R + 2], things };
  }
  if (cache.size > 8192) cache.clear();
  cache.set(key, out);
  return out;
}

/** Flatten a structure's ground and stamp its tiles into layers (where they overlap). */
export function stampStructure(st: PlacedStructure, L: TileLayers, T: TerrainTable, _table: BiomeTable): void {
  const { ci, cj, level, def } = st;
  const R = def.radius;
  const inL = (i: number, j: number): number => (i >= L.i0 && j >= L.j0 && i < L.i0 + L.w && j < L.j0 + L.d ? (j - L.j0) * L.w + (i - L.i0) : -1);
  for (let j = cj - R - APRON; j <= cj + R + APRON; j += 1) for (let i = ci - R - APRON; i <= ci + R + APRON; i += 1) {
    const k = inL(i, j);
    if (k < 0) continue;
    const d = Math.max(0, Math.ceil(Math.hypot(i + 0.5 - (ci + 0.5), j + 0.5 - (cj + 0.5)) - 0.5) - R);
    if (d > APRON) continue;
    const h = L.height[k]!;
    const nh = d === 0 ? level : Math.max(level - d, Math.min(level + d, h));
    if (nh !== h || d === 0) {
      L.height[k] = nh;
      L.flags[k] = L.flags[k]! & ~(FLAG.RAMP | FLAG.RIVER);
      if (L.water[k] !== WATER_NONE && L.water[k]! <= nh + (d === 0 ? 99 : 0)) L.water[k] = WATER_NONE;
    }
    if (d === 0) L.zone[k] = 255;
  }
  for (const tile of st.plan.tiles) {
    const k = inL(ci + tile.di, cj + tile.dj);
    if (k < 0) continue;
    L.height[k] = level + (tile.dh ?? 0);
    if (tile.type && T.has(tile.type)) L.type[k] = T.id(tile.type);
    if (tile.flags) L.flags[k] = L.flags[k]! | tile.flags;
    L.water[k] = WATER_NONE;
    L.zone[k] = 255;
  }
}
