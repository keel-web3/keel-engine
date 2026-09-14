// Worldgen and keel/level: a recipe as a level's ground, and a map as a level.
//
//   levelWorld(recipe)          what generateLevel({ world }) runs in place of
//                               its template: the pipeline fills the terrain;
//                               bases, ramps, roads, towns run over it as ever
//   generateWorldLevel(recipe)  a Level straight from a recipe (no players:
//                               an adventure map, a dungeon floor): terrain,
//                               things, regions, markers, and the recipe in
//                               meta so the biome and light layers (not the
//                               level's own) regenerate from it
//   worldSurface(map)           the ground surface and palette a map draws with
//                               (its biomes' ramps, its biome and light layers)

import { groundSurface, surfacePalette, terrainTypes } from "@keel-engine/terrain";
import type { GroundPalette, GroundPaletteOptions, GroundSurface, Terrain } from "@keel-engine/terrain";
import { createLevel, generateLevel } from "@keel-engine/level";
import type { GenerateOptions, Level, LevelWorld, Thing } from "@keel-engine/level";
import type { BiomeTable } from "./biomes.ts";
import type { TileLayers, WorldMap } from "./map.ts";
import { writeTerrain } from "./map.ts";
import { hash01 } from "./noise.ts";
import { encodeRecipe } from "./schema.ts";
import { createBiomeTable } from "./biomes.ts";
import { wrapYaw } from "./dungeon.ts";
import { FLAG, regions } from "@keel-engine/terrain";
import type { ResourceKind } from "@keel-engine/level";

const RESOURCE_KINDS: readonly ResourceKind[] = ["mass", "crystal", "flux", "fertile", "wreck"];
import { runPipeline } from "./pipeline.ts";
import type { PipelineOptions, WorldRecipe } from "./pipeline.ts";

const toBase64 = (b: Uint8Array): string => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };

/** A recipe as a level's world generator. The map it made is kept (`last`) for the surface. */
export function levelWorld(recipe: WorldRecipe, opts: PipelineOptions = {}): LevelWorld & { last: WorldMap | null } {
  const lw: LevelWorld & { last: WorldMap | null } = {
    key: `worldgen:${recipe.seed}:${recipe.stages.map((s) => s.use).join("+")}`,
    last: null,
    fill(t: Terrain) {
      const map = runPipeline({ ...recipe, width: t.width, depth: t.depth }, opts);
      lw.last = map;
      writeTerrain(map, t);
    },
    typeAt(i, j) {
      const m = lw.last;
      if (!m || i < 0 || j < 0 || i >= m.w || j >= m.d) return null;
      return m.types.get(m.type[j * m.w + i]!).name;
    },
    finish(level) {
      const m = lw.last;
      if (!m) return;
      level.meta = { ...level.meta, recipe: toBase64(encodeRecipe({ ...recipe, width: level.terrain.width, depth: level.terrain.depth })) };
      addThings(level, m);
    },
  };
  return lw;
}

// A map's things as the level's (buildings and bridges on the ground tier; plants and props as sprites; spawns and
// resources -- a level@1 stage's -- as the level's own; the rest as markers). Yaws wrapped into the codec's [-pi, pi].
function addThings(level: Level, m: WorldMap): void {
  const t = level.terrain;
  for (const th of m.things) {
    if (!th.pack || !th.object) {
      const [i, j] = t.tileAt(th.pos[0], th.pos[2]);
      const d = th.data ?? {};
      if (th.kind === "spawn" && t.inside(i, j) && typeof d["player"] === "number") {
        const ni = d["naturalI"], nj = d["naturalJ"];
        level.spawns.push({ id: th.id, player: d["player"], team: typeof d["team"] === "number" ? d["team"] : d["player"], at: [i, j], natural: typeof ni === "number" && typeof nj === "number" ? [ni, nj] : null });
        continue;
      }
      if (th.kind === "resource" && t.inside(i, j) && typeof d["resource"] === "string" && RESOURCE_KINDS.includes(d["resource"] as ResourceKind)) {
        level.resources.push({ id: th.id, kind: d["resource"] as ResourceKind, at: [i, j], amount: typeof d["amount"] === "number" ? d["amount"] : 1500, owner: typeof d["owner"] === "number" ? d["owner"] : null });
        continue;
      }
      const kind = th.kind === "marker" && typeof d["marker"] === "string" ? d["marker"] : th.kind;
      const { marker: _m, value, ...rest } = d as Record<string, string | number | boolean>;
      level.markers.push({ id: th.id, kind, pos: th.pos, tags: [...th.tags], data: th.kind === "marker" ? (value !== undefined ? value : null) : th.data ? { ...rest, ...(value !== undefined ? { value } : {}) } : null });
      continue;
    }
    const [i, j] = t.tileAt(th.pos[0], th.pos[2]);
    if (!t.inside(i, j)) continue;
    const thing: Thing = {
      id: th.id, layer: th.kind === "building" ? "buildings" : th.kind === "bridge" ? "bridges" : "props", pack: th.pack, object: th.object,
      pins: {}, look: null, tier: th.kind === "building" || th.kind === "bridge" ? "ground" : "background", pos: th.pos, yaw: wrapYaw(th.yaw), scale: th.scale, tags: [...th.tags],
      footprint: th.footprint ? [th.footprint[0], th.footprint[1], th.footprint[2], th.footprint[3]] : null,
    };
    level.things.set(thing.id, thing);
  }
  for (const r of m.regions) level.regions.push({ id: r.id, kind: "area", rect: r.rect, tags: [r.kind, ...r.tags], script: null });
}

/**
 * A level from a recipe. With players, keel/level's own steps (bases,
 * ramps, resources, roads, towns, fairness streams) run over the world's
 * ground (generateLevel with `world`); without, the map becomes the level as
 * it is (a dungeon floor, an adventure map). Either way the map comes back
 * too: its biome and light layers are what the ground surface reads.
 */
export function generateWorldLevel(recipe: WorldRecipe, { players = 0, settings, content, ...opts }: PipelineOptions & Pick<GenerateOptions, "players" | "content"> & { readonly settings?: GenerateOptions["settings"] } = {}): { level: Level; map: WorldMap } {
  if (!recipe.width || !recipe.depth) throw new RangeError("A level is finite: give the recipe a width and depth.");
  if (players > 0) {
    const world = levelWorld(recipe, opts);
    const { level } = generateLevel({ seed: recipe.seed, width: recipe.width, depth: recipe.depth, players, chunk: recipe.chunk ?? 32, world, ...(settings !== undefined ? { settings } : {}), ...(content ? { content } : {}) });
    // (The world's ground can leave a base on a plateau the level's ramps couldn't reach: join them, always.)
    const joined = joinBases(level);
    if (joined) level.meta = { ...level.meta, joined };
    return { level, map: world.last! };
  }
  const map = runPipeline(recipe, opts);
  const level = createLevel({ id: "world", name: `world ${recipe.seed}`, seed: recipe.seed, width: recipe.width, depth: recipe.depth, tileSize: recipe.tileSize ?? 2, stepHeight: recipe.stepHeight ?? 1, chunk: recipe.chunk ?? 32 });
  writeTerrain(map, level.terrain);
  addThings(level, map);
  level.meta = { ...level.meta, recipe: toBase64(encodeRecipe(recipe)), world: recipe.stages.map((s) => s.use).join("+") };
  return { level, map };
}

/**
 * The ground's surface for tile layers: the biome table's looks (a ramp set
 * per biome), the layers' biome and light, and a palette laid out for them
 * (a season's colours: seasonPaletteFor, the same layout).
 */
export function worldSurface(L: TileLayers, table: BiomeTable = createBiomeTable(), { light = true, palette = {} }: { readonly light?: boolean; readonly palette?: GroundPaletteOptions } = {}): { surface: GroundSurface; palette: GroundPalette } {
  const biomes = table.surfaceBiomes();
  let lit = false;
  if (light) for (let k = 0; k < L.w * L.d; k += 1) if (L.light[k] !== 255) { lit = true; break; }
  return {
    surface: groundSurface({ biomes, biome: L.biome, ...(lit ? { light: L.light } : {}) }),
    palette: surfacePalette(terrainTypes(), biomes, palette),
  };
}

/** A deterministic pick of what a dungeon entrance leads to: the recipe of its interior (its seed and room count from the entrance). */
export function interiorRecipe(entrance: { readonly id: string; readonly data?: Readonly<Record<string, string | number | boolean>> }, { act = null, size = 72 }: { readonly act?: string | null; readonly size?: number } = {}): WorldRecipe {
  const seed = String(entrance.data?.["seed"] ?? entrance.id);
  const rooms = Number(entrance.data?.["rooms"] ?? 10);
  const algorithms = ["rooms", "bsp", "cave", "wfc", "drunkard"];
  const algorithm = algorithms[Math.floor(hash01(rooms, seed.length, 17) * algorithms.length)]!;
  return { format: "keel-worldgen", version: 1, seed, width: size, depth: Math.round(size * 0.75), chunk: 32, tileSize: 2, stepHeight: 1, act, pins: [], locks: "", stages: [{ id: "dungeon", use: "dungeon@1", params: { algorithm, rooms } }] };
}

/**
 * Every base reaches every other (and the middle): where the ground doesn't, a road is cut from the stranded base to
 * base 0 at the bases' own level -- the cheapest way through the ground already near that level (a Dijkstra over the
 * tiles: climbing, water and blocked tiles cost), three tiles wide, dry, unramped, nothing standing on it. Returns the
 * tiles cut (0: the level was joined already and is untouched).
 */
export function joinBases(level: Level): number {
  const t = level.terrain, W = t.width, D = t.depth, N = W * D;
  const spawns = level.spawns;
  if (spawns.length < 2) return 0;
  const s0 = spawns[0]!;
  const base = t.height[t.index(s0.at[0], s0.at[1])]!;
  const mid: [number, number] = [Math.floor(W / 2), Math.floor(D / 2)];
  const targets: Array<readonly [number, number]> = [...spawns.slice(1).map((s) => s.at), mid];
  let cut = 0;
  const road = t.types.has("path") ? "path" : t.types.get(t.type[t.index(s0.at[0], s0.at[1])]!).name;
  for (let pass = 0; pass < targets.length + 1; pass += 1) {
    const reg = regions(level.pathGrid());
    const home = reg.label[t.index(s0.at[0], s0.at[1])]!;
    const stranded = targets.find(([i, j]) => reg.label[t.index(i, j)] !== home);
    if (!stranded) break;
    // Dijkstra from the stranded tile to base 0's.
    const blocked = level.blocked();
    const cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const start = t.index(stranded[0], stranded[1]), goal = t.index(s0.at[0], s0.at[1]);
    cost[start] = 0;
    const open: number[] = [start];
    const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];
    while (open.length) {
      let bi = 0;
      for (let q = 1; q < open.length; q += 1) if (cost[open[q]!]! < cost[open[bi]!]!) bi = q;
      const k = open[bi]!;
      open[bi] = open[open.length - 1]!; open.pop();
      if (k === goal) break;
      const i = k % W, j = (k - i) / W;
      for (let q = 0; q < 4; q += 1) {
        const a = i + DX[q]!, b = j + DZ[q]!;
        if (a < 1 || b < 1 || a >= W - 1 || b >= D - 1) continue;
        const n = b * W + a;
        const c = cost[k]! + 1 + Math.abs(t.height[n]! - base) * 3 + (t.waterDepth(a, b) > 0 ? 6 : 0) + (blocked[n] ? 4 : 0);
        if (c < cost[n]!) { if (cost[n] === Infinity) open.push(n); cost[n] = c; prev[n] = k; }
      }
    }
    if (prev[goal]! < 0 && goal !== start) break;
    const path: number[] = [];
    for (let k = goal; k >= 0; k = prev[k]!) path.push(k);
    const lane = new Set<number>();
    for (const k of path) { const i = k % W, j = (k - i) / W; for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < W && b < D) lane.add(b * W + a); } }
    t.batch(() => {
      for (const k of lane) {
        const i = k % W, j = (k - i) / W;
        t.setHeight(i, j, base); t.setRamp(i, j, null); t.setWater(i, j, null);
        t.setFlag(i, j, FLAG.BLOCKED | FLAG.RIVER, false);
        if (path.includes(k)) t.setType(i, j, road);
        cut += 1;
      }
    });
    // (Nothing stands in the road.)
    for (const [id, th] of level.things) if (th.footprint && [...lane].some((k) => { const i = k % W, j = (k - i) / W; return i >= th.footprint![0] && i < th.footprint![2] && j >= th.footprint![1] && j < th.footprint![3]; })) level.things.delete(id);
    level.resources = level.resources.filter((r) => !lane.has(t.index(r.at[0], r.at[1])));
  }
  return cut;
}
