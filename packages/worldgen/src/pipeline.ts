// Generator PIPELINES: a world or a level is a list of STAGES, each a
// KEEL-module-friendly unit -- `use` names it ("overworld@1", "dungeon@1"),
// it has its own seed (derived from the recipe's and its id unless given),
// its params, and a MASK saying where it applies -- stored as a RECIPE (a
// plain document; schema.ts packs it). Stages run in order, each writing over
// what came before inside its mask, so one map mixes generators:
//
//   overworld@1       the Minecraft-style world (overworld.ts) -- local: in an
//                     infinite world it runs per chunk
//   biome@1           re-skin a region to a biome, keeping its shape -- local
//   dungeon@1         a Diablo-style dungeon in the mask's bounds
//   cave@1            a cellular-automaton cave region carved into the ground
//   town@1            a WFC town: roads, lots with houses, gardens
//   level@1           keel/level's templates (valley, island...) as a stage
//   foliage@1         foliage density for scatter (recorded in the map)
//
// Masks: all, rect, circle (feathered by noise), noise (a threshold on a
// field), biome, height, and not / and / or of those.
//
// PINS override every stage: after each one, a pinned tile is put back (its
// height, type, water, biome, flags) -- the hand-placed wins. LOCKS reach
// every stage's rolled params through keel/world's settings (the level's
// chooser): a param given as { int: [a, b] }, { between: [a, b] } or
// { pick: [...] } is rolled on its own stream and can be locked as
// "id:<stage id>/<param>=<value>".
//
// Everything is deterministic from the seed and the recipe: runPipeline()
// twice gives the same tiles byte for byte; an infinite world's chunk is the
// same whichever order the chunks are asked for (test/pipeline.test.ts).

import { datan2, dhypot } from "@keel-engine/core";
import { FLAG, WATER_NONE, terrainTypes } from "@keel-engine/terrain";
import type { TerrainTable } from "@keel-engine/terrain";
import { createSettings, parseLocks } from "@keel-engine/world";
import type { SettingValue, Settings } from "@keel-engine/world";
import { chooser, generateLevel } from "@keel-engine/level";
import type { Chooser } from "@keel-engine/level";
import { DEFAULT_ACTS, DEFAULT_BIOMES, createBiomeTable } from "./biomes.ts";
import type { ActDef, BiomeDef, BiomeTable } from "./biomes.ts";
import { ROOM_TEMPLATES, THEMES, dungeonLayers, generateDungeon, wrapYaw } from "./dungeon.ts";
import type { DungeonAlgorithm, Room, RoomTemplate } from "./dungeon.ts";
import { blit, createMap } from "./map.ts";
import type { TileLayers, WorldMap, WorldThing } from "./map.ts";
import { fbm, hash01, seedOf } from "./noise.ts";
import { createOverworld } from "./overworld.ts";
import type { Overworld, OverworldParams } from "./overworld.ts";
import { wfcTown } from "./wfc.ts";
import { reskin } from "./swap.ts";

export const RECIPE_FORMAT = "keel-worldgen";
export const RECIPE_VERSION = 1;

/** A param: a value, or a roll the settings can lock. */
export type ParamValue = SettingValue | { readonly int: readonly [number, number] } | { readonly between: readonly [number, number] } | { readonly pick: readonly SettingValue[] };

export type MaskSpec =
  | { readonly kind: "all" }
  | { readonly kind: "rect"; readonly rect: readonly [number, number, number, number]; readonly feather?: number }
  | { readonly kind: "circle"; readonly at: readonly [number, number]; readonly r: number; readonly feather?: number }
  | { readonly kind: "noise"; readonly freq: number; readonly threshold: number; readonly seed?: string }
  | { readonly kind: "biome"; readonly biomes: readonly string[] }
  | { readonly kind: "height"; readonly min?: number; readonly max?: number }
  | { readonly kind: "not"; readonly mask: MaskSpec }
  | { readonly kind: "and" | "or"; readonly masks: readonly MaskSpec[] };

export interface StageSpec {
  readonly id: string;
  /** "<stage>@<major>" ("overworld@1"). */
  readonly use: string;
  readonly seed?: string;
  readonly params?: Readonly<Record<string, ParamValue>>;
  readonly mask?: MaskSpec;
}

/** A hand-placed override: tiles [i0, j0, i1, j1) that keep what the pin says, whatever the stages do. */
export interface PinSpec {
  readonly rect: readonly [number, number, number, number];
  readonly height?: number;
  readonly type?: string;
  /** A water level, or null for dry. */
  readonly water?: number | null;
  readonly biome?: string;
}

export interface WorldRecipe {
  readonly format: typeof RECIPE_FORMAT;
  readonly version: typeof RECIPE_VERSION;
  readonly seed: string;
  /** Tiles; 0 x 0: infinite (chunks on demand). */
  readonly width: number;
  readonly depth: number;
  readonly chunk?: number;
  readonly tileSize?: number;
  readonly stepHeight?: number;
  /** An act: its biomes only, its dungeon theme. */
  readonly act?: string | null;
  readonly stages: readonly StageSpec[];
  readonly pins?: readonly PinSpec[];
  /** Lock text for the stages' rolled params ("id:dungeon/rooms=12"). */
  readonly locks?: string;
}

/** A recipe with its defaults filled in. */
export function defineRecipe(r: Omit<WorldRecipe, "format" | "version"> & Partial<Pick<WorldRecipe, "format" | "version">>): WorldRecipe {
  if (!r.stages.length) throw new RangeError("A recipe needs at least one stage.");
  const ids = new Set<string>();
  for (const s of r.stages) {
    if (ids.has(s.id)) throw new RangeError(`Two stages called "${s.id}".`);
    ids.add(s.id);
    if (!/^[a-z0-9-]+@\d+$/.test(s.use)) throw new RangeError(`Stage ${s.id}: "use" is "<stage>@<major>" (got "${s.use}").`);
  }
  return { format: RECIPE_FORMAT, version: RECIPE_VERSION, chunk: 32, tileSize: 2, stepHeight: 1, act: null, pins: [], locks: "", ...r };
}

// ---------------------------------------------------------------- stages

export interface StageContext {
  readonly recipe: WorldRecipe;
  readonly stage: StageSpec;
  /** The stage's own seed. */
  readonly seed: string;
  readonly map: WorldMap;
  readonly table: BiomeTable;
  readonly types: TerrainTable;
  readonly act: ActDef | null;
  /** Is world tile (i, j) in the stage's mask? */
  mask(i: number, j: number): boolean;
  /** The mask's bounds (world tiles) clipped to the map. */
  readonly bounds: readonly [number, number, number, number];
  /** A param: its value, rolled through the settings (lockable) when it's a roll. */
  param<T extends SettingValue>(name: string, fallback: T): T;
  /** The world's overworld (the first overworld stage's, or a default one): base heights for stages that sit on the ground. */
  overworld(): Overworld;
  /** The room templates a dungeon stage may draw from: the engine's, then those the pipeline was given (packs' own). */
  readonly templates: readonly RoomTemplate[];
}

export interface StageDef {
  readonly id: string;
  readonly version: string;
  /** Can it run a chunk at a time (a pure function of the tile)? Region stages need their whole mask. */
  readonly local: boolean;
  readonly describe: string;
  run(ctx: StageContext): void;
}

const registry = new Map<string, StageDef>();
/** Add a stage kind (a pack's own, under contract "worldgen/stage/<id>@1"). */
export function defineStage(def: StageDef): StageDef {
  const key = `${def.id}@${def.version.split(".")[0]}`;
  if (registry.has(key)) throw new RangeError(`Stage ${key} is defined twice.`);
  registry.set(key, def);
  return def;
}
export const stageOf = (use: string): StageDef | undefined => registry.get(use);
export const stageKinds = (): string[] => [...registry.keys()].sort();

// ---------------------------------------------------------------- masks

/** A mask as a function of the world tile. */
export function maskFn(m: MaskSpec | undefined, seed: string, L: TileLayers, table: BiomeTable): (i: number, j: number) => boolean {
  if (!m || m.kind === "all") return () => true;
  switch (m.kind) {
    case "rect": {
      const [a, b, c, d] = m.rect, f = m.feather ?? 0, s = seedOf(seed, "feather");
      return (i, j) => {
        if (i < a || j < b || i >= c || j >= d) return false;
        if (!f) return true;
        const e = Math.min(i - a, j - b, c - 1 - i, d - 1 - j);
        return e >= f || hash01(i, j, s) * f < e + fbm({ freq: 0.15, octaves: 2 }, i, j, s + 1) * f * 0.6;
      };
    }
    case "circle": {
      const f = m.feather ?? 0, s = seedOf(seed, "feather");
      return (i, j) => {
        const q = dhypot(i + 0.5 - m.at[0], j + 0.5 - m.at[1]);
        return q < m.r + (f ? (fbm({ freq: 0.12, octaves: 2 }, i, j, s) - 0.5) * 2 * f : 0);
      };
    }
    case "noise": { const s = seedOf(m.seed ?? seed, "mask"); return (i, j) => fbm({ freq: m.freq, octaves: 3 }, i, j, s) > m.threshold; }
    case "biome": {
      const ids = new Set(m.biomes.filter((b) => table.has(b)).map((b) => table.index(b)));
      return (i, j) => { const k = (j - L.j0) * L.w + (i - L.i0); return k >= 0 && k < L.w * L.d && ids.has(L.biome[k]!); };
    }
    case "height": return (i, j) => { const k = (j - L.j0) * L.w + (i - L.i0); if (k < 0 || k >= L.w * L.d) return false; const h = L.height[k]!; return h >= (m.min ?? -Infinity) && h <= (m.max ?? Infinity); };
    case "not": { const f = maskFn(m.mask, seed, L, table); return (i, j) => !f(i, j); }
    case "and": { const fs = m.masks.map((x) => maskFn(x, seed, L, table)); return (i, j) => fs.every((f) => f(i, j)); }
    default: { const fs = (m as { masks: readonly MaskSpec[] }).masks.map((x) => maskFn(x, seed, L, table)); return (i, j) => fs.some((f) => f(i, j)); }
  }
}

/** A mask's bounds (world tiles) inside a rectangle. */
export function maskBounds(m: MaskSpec | undefined, within: readonly [number, number, number, number]): [number, number, number, number] {
  const clip = (r: readonly [number, number, number, number]): [number, number, number, number] => [Math.max(within[0], r[0]), Math.max(within[1], r[1]), Math.min(within[2], r[2]), Math.min(within[3], r[3])];
  if (!m) return [...within];
  if (m.kind === "rect") return clip(m.rect);
  if (m.kind === "circle") { const r = m.r + (m.feather ?? 0) + 1; return clip([Math.floor(m.at[0] - r), Math.floor(m.at[1] - r), Math.ceil(m.at[0] + r), Math.ceil(m.at[1] + r)]); }
  if (m.kind === "and") return m.masks.reduce<[number, number, number, number]>((acc, x) => { const b = maskBounds(x, within); return [Math.max(acc[0], b[0]), Math.max(acc[1], b[1]), Math.min(acc[2], b[2]), Math.min(acc[3], b[3])]; }, [...within]);
  return [...within];
}

// ---------------------------------------------------------------- running

export interface PipelineOptions {
  /** Biomes (default the engine's; packs' appended). */
  readonly biomes?: readonly BiomeDef[];
  readonly acts?: readonly ActDef[];
  readonly types?: TerrainTable;
  /** Settings to read locks from (else the recipe's lock text). */
  readonly settings?: Settings;
  /** Room templates for dungeon stages (packs' own). */
  readonly templates?: readonly RoomTemplate[];
}

interface Shared { table: BiomeTable; types: TerrainTable; acts: readonly ActDef[]; settings: Settings; choose: Chooser; templates: readonly RoomTemplate[] | undefined; overworlds: Map<string, Overworld> }

/** The engine's room templates, then the given ones (a given template replaces the engine's of the same id). */
function templatePool(given: readonly RoomTemplate[] | undefined): readonly RoomTemplate[] {
  if (!given?.length) return ROOM_TEMPLATES;
  const ids = new Set(given.map((t) => t.id));
  return [...ROOM_TEMPLATES.filter((t) => !ids.has(t.id)), ...given];
}

/**
 * The templates a recipe's `templates` param picks from the pool: null (all of them), "engine" (the engine's own), an id
 * or "prefix*", or a list of those. Any role the pick can't play (start, boss, exit, key, room) is played by the
 * engine's own templates for it, so the grammar always has what it needs.
 */
export function chooseTemplates(pool: readonly RoomTemplate[], pick: SettingValue): readonly RoomTemplate[] {
  if (pick === null || pick === undefined || pick === "all") return pool;
  if (pick === "engine") return ROOM_TEMPLATES;
  const names = (Array.isArray(pick) ? pick : [pick]).map(String);
  const match = (id: string): boolean => names.some((n) => (n.endsWith("*") ? id.startsWith(n.slice(0, -1)) : id === n));
  const chosen = pool.filter((t) => match(t.id));
  const roles: Room["kind"][] = ["start", "room", "key", "boss", "exit"];
  for (const role of roles) if (!chosen.some((t) => t.roles.includes(role))) chosen.push(...ROOM_TEMPLATES.filter((t) => t.roles.includes(role) && !chosen.includes(t)));
  return chosen;
}

function sharedOf(recipe: WorldRecipe, opts: PipelineOptions): Shared {
  const settings = opts.settings ?? createSettings();
  if (!opts.settings && recipe.locks) for (const l of parseLocks(recipe.locks)) (l.lock ? settings.lock(l.scope, l.key, l.value) : settings.set(l.scope, l.key, l.value));
  return { table: createBiomeTable(opts.biomes ?? DEFAULT_BIOMES), types: opts.types ?? terrainTypes(), acts: opts.acts ?? DEFAULT_ACTS, settings, choose: chooser(recipe.seed, settings), templates: opts.templates, overworlds: new Map() };
}

function contextFor(recipe: WorldRecipe, stage: StageSpec, map: WorldMap, sh: Shared, bounds: readonly [number, number, number, number]): StageContext {
  const seed = stage.seed ?? `${recipe.seed}/${stage.id}`;
  const act = recipe.act ? sh.acts.find((a) => a.id === recipe.act) ?? null : null;
  const thing = { id: stage.id, tags: ["stage", `use:${stage.use}`] };
  const mask = maskFn(stage.mask, seed, map, sh.table);
  const ctx: StageContext = {
    recipe, stage, seed, map, table: sh.table, types: sh.types, act, mask, bounds: maskBounds(stage.mask, bounds),
    param<T extends SettingValue>(name: string, fallback: T): T {
      const v = stage.params?.[name];
      if (v === undefined) return sh.choose.propose(name, fallback, thing) as T;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o["int"])) return sh.choose.int(name, o["int"][0] as number, o["int"][1] as number, thing) as unknown as T;
        if (Array.isArray(o["between"])) return sh.choose.between(name, o["between"][0] as number, o["between"][1] as number, thing) as unknown as T;
        if (Array.isArray(o["pick"])) return sh.choose.choose(name, o["pick"] as SettingValue[], { thing }) as unknown as T;
      }
      return sh.choose.propose(name, v as SettingValue, thing) as T;
    },
    templates: templatePool(sh.templates),
    overworld() {
      const first = recipe.stages.find((s) => s.use === "overworld@1");
      const key = first ? first.id : "(default)";
      let ow = sh.overworlds.get(key);
      if (!ow) {
        const p = (first?.params ?? {}) as Record<string, SettingValue>;
        ow = createOverworld(first?.seed ?? `${recipe.seed}/${first?.id ?? "overworld"}`, { table: sh.table, types: sh.types, params: overworldParams(p, act) });
        sh.overworlds.set(key, ow);
      }
      return ow;
    },
  };
  return ctx;
}

const overworldParams = (p: Readonly<Record<string, SettingValue>>, act: ActDef | null): OverworldParams => ({
  ...(typeof p["scale"] === "number" ? { scale: p["scale"] } : {}), ...(typeof p["land"] === "number" ? { land: p["land"] } : {}),
  ...(typeof p["relief"] === "number" ? { relief: p["relief"] } : {}), ...(typeof p["rivers"] === "number" ? { rivers: p["rivers"] } : {}),
  ...(typeof p["lakes"] === "number" ? { lakes: p["lakes"] } : {}), ...(typeof p["structures"] === "boolean" ? { structures: p["structures"] } : {}),
  ...(typeof p["caves"] === "boolean" ? { caves: p["caves"] } : {}), ...(typeof p["ores"] === "boolean" ? { ores: p["ores"] } : {}),
  ...(typeof p["only"] === "string" ? { only: p["only"] } : {}),
  biomes: Array.isArray(p["biomes"]) ? (p["biomes"] as string[]) : act ? act.biomes : null,
});

/** Pins: what each says, written back over a map's tiles. */
function applyPins(recipe: WorldRecipe, map: WorldMap, sh: Shared): void {
  for (const pin of recipe.pins ?? []) {
    const [a, b, c, d] = pin.rect;
    for (let j = Math.max(b, map.j0); j < Math.min(d, map.j0 + map.d); j += 1) for (let i = Math.max(a, map.i0); i < Math.min(c, map.i0 + map.w); i += 1) {
      const k = (j - map.j0) * map.w + (i - map.i0);
      if (pin.height !== undefined) { map.height[k] = pin.height; map.flags[k] = map.flags[k]! & ~FLAG.RAMP; }
      if (pin.type && sh.types.has(pin.type)) map.type[k] = sh.types.id(pin.type);
      if (pin.water !== undefined) map.water[k] = pin.water === null ? WATER_NONE : pin.water;
      if (pin.biome && sh.table.has(pin.biome)) map.biome[k] = sh.table.index(pin.biome);
      map.zone[k] = 250;
    }
  }
}

/** Run a finite recipe: a map of width x depth tiles. */
export function runPipeline(recipe: WorldRecipe, opts: PipelineOptions = {}): WorldMap {
  if (!recipe.width || !recipe.depth) throw new RangeError("An infinite recipe (0 x 0) streams chunks: createWorldStream().");
  return runRect(recipe, { i0: 0, j0: 0, w: recipe.width, d: recipe.depth, sh: sharedOf(recipe, opts), localOnly: false });
}

interface RectRun {
  i0: number;
  j0: number;
  w: number;
  d: number;
  sh: Shared;
  localOnly: boolean;
  regionCache?: Map<string, WorldMap>;
}

function runRect(recipe: WorldRecipe, { i0, j0, w, d, sh, localOnly, regionCache }: RectRun): WorldMap {
  const map = createMap({ seed: recipe.seed, width: w, depth: d, i0, j0, types: sh.types, tileSize: recipe.tileSize ?? 2, stepHeight: recipe.stepHeight ?? 1 });
  const bounds: [number, number, number, number] = recipe.width ? [0, 0, recipe.width, recipe.depth] : [i0, j0, i0 + w, j0 + d];
  recipe.stages.forEach((stage, index) => {
    const def = registry.get(stage.use);
    if (!def) throw new RangeError(`Stage ${stage.id}: no stage kind "${stage.use}" (${stageKinds().join(", ")}).`);
    if (localOnly && !def.local) {
      // (A region stage in an infinite world: run once over its mask's bounds, cached, and blitted into the chunk.)
      const mb = maskBounds(stage.mask, [-1e7, -1e7, 1e7, 1e7]);
      if (mb[2] - mb[0] > 4096 || mb[3] - mb[1] > 4096) throw new RangeError(`Stage ${stage.id} (${stage.use}) isn't local: in an infinite world it needs a bounded mask (rect or circle).`);
      if (mb[2] <= i0 || mb[3] <= j0 || mb[0] >= i0 + w || mb[1] >= j0 + d) return;
      const key = `${stage.id}`;
      let region = regionCache?.get(key);
      if (!region) {
        const sub: WorldRecipe = { ...recipe, width: 0, depth: 0, stages: recipe.stages.slice(0, index + 1), pins: [] };
        region = runRect(sub, { i0: mb[0], j0: mb[1], w: mb[2] - mb[0], d: mb[3] - mb[1], sh: { ...sh, overworlds: sh.overworlds }, localOnly: false });
        regionCache?.set(key, region);
      }
      const zone = index + 1;
      blit(region, map, (k) => region!.zone[k] === zone || region!.zone[k]! >= 200);
      for (const th of region.things) { const ti = Math.floor(th.pos[0] / map.tileSize), tj = Math.floor(th.pos[2] / map.tileSize); if (ti >= i0 && tj >= j0 && ti < i0 + w && tj < j0 + d && !map.things.some((x) => x.id === th.id)) map.things.push(th); }
      applyPins(recipe, map, sh);
      return;
    }
    const ctx = contextFor(recipe, stage, map, sh, bounds);
    def.run(ctx);
    applyPins(recipe, map, sh);
  });
  return map;
}

// ---------------------------------------------------------------- infinite worlds

export interface WorldChunk {
  readonly cx: number;
  readonly cz: number;
  /** The chunk and an apron round it (world tiles [cx * C - apron, ...)). */
  readonly layers: TileLayers;
  readonly things: readonly WorldThing[];
}

export interface WorldStream {
  readonly recipe: WorldRecipe;
  readonly table: BiomeTable;
  readonly types: TerrainTable;
  readonly chunkSize: number;
  /** A chunk with an apron (default 2: what the ground baker reads round it). The same tiles whatever order chunks are asked in. */
  chunk(cx: number, cz: number, apron?: number): WorldChunk;
  /** Any rectangle of world tiles (margins for scatter). */
  block(i0: number, j0: number, w: number, d: number): WorldMap;
  readonly overworld: Overworld | null;
}

/** An infinite world: chunks on demand. Local stages run per chunk; bounded region stages run once and are cut into the chunks they reach. */
export function createWorldStream(recipe: WorldRecipe, opts: PipelineOptions = {}): WorldStream {
  const sh = sharedOf(recipe, opts);
  const C = recipe.chunk ?? 32;
  const regionCache = new Map<string, WorldMap>();
  const first = recipe.stages.find((s) => s.use === "overworld@1");
  const ow = first ? contextFor(recipe, first, createMap({ seed: recipe.seed, width: 1, depth: 1, types: sh.types }), sh, [0, 0, 1, 1]).overworld() : null;
  const block = (i0: number, j0: number, w: number, d: number): WorldMap => runRect({ ...recipe, width: 0, depth: 0 }, { i0, j0, w, d, sh, localOnly: true, regionCache });
  return {
    recipe, table: sh.table, types: sh.types, chunkSize: C, overworld: ow,
    block,
    chunk(cx, cz, apron = 2) {
      const map = block(cx * C - apron, cz * C - apron, C + 2 * apron, C + 2 * apron);
      // (Things belong to the chunk they stand in: each is in exactly one.)
      const own = map.things.filter((th) => { const ti = Math.floor(th.pos[0] / map.tileSize), tj = Math.floor(th.pos[2] / map.tileSize); return ti >= cx * C && tj >= cz * C && ti < (cx + 1) * C && tj < (cz + 1) * C; });
      return { cx, cz, layers: map, things: own };
    },
  };
}

// ---------------------------------------------------------------- the engine's stages

const num = (v: SettingValue, d: number): number => (typeof v === "number" ? v : d);

defineStage({
  id: "overworld", version: "1.0.0", local: true, describe: "The infinite chunked overworld: climate biomes, heights, rivers, lakes, structures, ores, caves.",
  run(ctx) {
    const ow = ctx.overworld();
    const m = ctx.map;
    const B = ow.block(m.i0, m.j0, m.w, m.d);
    const zone = ctx.recipe.stages.indexOf(ctx.stage) + 1;
    for (let k = 0; k < m.w * m.d; k += 1) {
      const i = m.i0 + (k % m.w), j = m.j0 + Math.floor(k / m.w);
      if (!ctx.mask(i, j)) continue;
      m.height[k] = B.height[k]!; m.type[k] = B.type[k]!; m.water[k] = B.water[k]!; m.flags[k] = B.flags[k]!; m.dir[k] = B.dir[k]!;
      m.biome[k] = B.biome[k]!; m.under[k] = B.under[k]!; m.ore[k] = B.ore[k]!; m.light[k] = 255; m.zone[k] = B.zone[k]! >= 200 ? B.zone[k]! : zone;
    }
    for (const th of ow.thingsIn(m.i0, m.j0, m.i0 + m.w, m.j0 + m.d)) { const ti = Math.floor(th.pos[0] / m.tileSize), tj = Math.floor(th.pos[2] / m.tileSize); if (ctx.mask(ti, tj)) m.things.push(th); }
  },
});

defineStage({
  id: "biome", version: "1.0.0", local: true, describe: "Re-skin a region to a biome, keeping its shape (heights, water): materials, palette and foliage follow.",
  run(ctx) {
    const to = ctx.param<string>("biome", "desert");
    if (!ctx.table.has(to)) throw new RangeError(`Stage ${ctx.stage.id}: no biome "${to}".`);
    reskin(ctx.map, ctx.table, ctx.types, to, (i, j) => ctx.mask(i, j), { seed: ctx.seed, keepPaved: true });
  },
});

defineStage({
  id: "dungeon", version: "1.0.0", local: false, describe: "An action-RPG dungeon in the mask's bounds: BSP, stitched rooms, caves, drunkard walks or WFC; the act's theme.",
  run(ctx) {
    const [a, b, c, d] = ctx.bounds;
    const w = c - a, h = d - b;
    if (w < 12 || h < 12) throw new RangeError(`Stage ${ctx.stage.id}: a dungeon needs at least 12 x 12 tiles.`);
    const algorithm = ctx.param<string>("algorithm", "rooms") as DungeonAlgorithm;
    const rooms = num(ctx.param("rooms", 10), 10);
    const theme = THEMES[ctx.param<string>("theme", ctx.act?.theme ?? "crypt")] ?? THEMES["crypt"]!;
    const level = num(ctx.param("level", 0), 0);
    // (The room templates: every one the pipeline knows, or those the recipe names -- ids, or "prefix*" -- the engine's
    // standing in for any role the named ones can't play.)
    const chosen = chooseTemplates(ctx.templates, ctx.param<SettingValue>("templates", null));
    const D = generateDungeon(ctx.seed, w, h, { algorithm, rooms, ...(chosen !== ROOM_TEMPLATES ? { templates: chosen } : {}) });
    const biome = ctx.table.has(theme.biome) ? ctx.table.index(theme.biome) : 0;
    const { layers, things } = dungeonLayers(D, ctx.types, { i0: a, j0: b, level, theme, biome, tileSize: ctx.map.tileSize });
    const zone = ctx.recipe.stages.indexOf(ctx.stage) + 1;
    layers.zone.fill(zone);
    blit(layers, ctx.map, (k) => ctx.mask(a + (k % w), b + Math.floor(k / w)));
    for (const th of things) ctx.map.things.push({ ...th, id: `${ctx.stage.id}:${th.id}` });
    ctx.map.meta[`${ctx.stage.id}.algorithm`] = D.algorithm;
    ctx.map.meta[`${ctx.stage.id}.rooms`] = D.rooms.map((r) => r.template ?? "").filter(Boolean).join(",");
    ctx.map.regions.push({ id: ctx.stage.id, kind: "dungeon", rect: [a, b, c, d], tags: [D.algorithm, theme.id] });
  },
});

defineStage({
  id: "cave", version: "1.0.0", local: false, describe: "A cellular-automaton cave region carved into the ground: rock walls up, floors at the region's ground level, pools.",
  run(ctx) {
    const [a, b, c, d] = ctx.bounds;
    const w = c - a, h = d - b;
    const D = generateDungeon(ctx.seed, w, h, { algorithm: "cave", boss: false, fill: num(ctx.param("fill", 0.46), 0.46) });
    const m = ctx.map;
    // (The floor sits at the ground's lowest dry level in the region; walls rise from it.)
    let lo = Infinity;
    for (let j = b; j < d; j += 1) for (let i = a; i < c; i += 1) { const k = (j - m.j0) * m.w + (i - m.i0); if (ctx.mask(i, j) && (m.water[k] === WATER_NONE || m.water[k]! <= m.height[k]!)) lo = Math.min(lo, m.height[k]!); }
    const level = Number.isFinite(lo) ? lo : 0;
    const theme = { ...THEMES[ctx.param<string>("theme", "crypt")] ?? THEMES["crypt"]!, cave: ctx.param<string>("floor", "gravel"), wall: ctx.param<string>("wall", "rock"), ambient: num(ctx.param("ambient", 255), 255) };
    const biome = ctx.table.has(ctx.param<string>("biome", "mountains")) ? ctx.table.index(ctx.param<string>("biome", "mountains")) : 0;
    const { layers, things } = dungeonLayers(D, ctx.types, { i0: a, j0: b, level, theme, biome, tileSize: m.tileSize });
    const zone = ctx.recipe.stages.indexOf(ctx.stage) + 1;
    layers.zone.fill(zone);
    blit(layers, m, (k) => ctx.mask(a + (k % w), b + Math.floor(k / w)));
    for (const th of things) if (th.kind === "prop") m.things.push({ ...th, id: `${ctx.stage.id}:${th.id}` });
  },
});

defineStage({
  id: "town", version: "1.0.0", local: false, describe: "A wave-function-collapse town: a road net, lots with houses facing the roads, gardens; its ground flattened to the region's middle.",
  run(ctx) {
    const [a, b, c, d] = ctx.bounds;
    const w = c - a, h = d - b;
    const m = ctx.map;
    // (A step budget, never a clock: the same seed makes the same town on any machine. 0: the solver's default.)
    const steps = num(ctx.param("steps", 0), 0);
    const { plan } = wfcTown(ctx.seed, w, h, steps > 0 ? steps : undefined);
    const mid = (Math.floor((b + d) / 2) - m.j0) * m.w + Math.floor((a + c) / 2) - m.i0;
    const level = Math.max(1, m.height[mid] ?? 1);
    const road = ctx.types.id(ctx.param<string>("road", "path")), lot = ctx.types.id("dirt"), garden = ctx.types.id("moss");
    const zone = ctx.recipe.stages.indexOf(ctx.stage) + 1;
    const houses = ["cottage", "cottage", "shop", "hall", "workshop", "tower"];
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const i = a + x, j = b + y;
      if (!ctx.mask(i, j)) continue;
      const k = (j - m.j0) * m.w + (i - m.i0);
      const ch = plan[y]![x]!;
      m.height[k] = level; m.water[k] = WATER_NONE; m.flags[k] = m.flags[k]! & ~(FLAG.RAMP | FLAG.RIVER); m.zone[k] = 210;
      if (ch === "r") m.type[k] = road;
      else if (ch === "f") m.type[k] = garden;
      else if (ch === "h") {
        m.type[k] = lot;
        // (A house on its lot, facing the road beside it.)
        const DXF = [0, 1, 0, -1], DZF = [1, 0, -1, 0];
        const face = DXF.findIndex((dx, q) => plan[y + DZF[q]!]?.[x + dx] === "r");
        const yaw = face >= 0 ? datan2(DXF[face]!, DZF[face]!) : 0;
        m.things.push({ id: `${ctx.stage.id}:house-${x}-${y}`, kind: "building", pack: "packs/buildings", object: houses[Math.floor(hash01(i, j, 3) * houses.length)]!, pos: [(i + 0.5) * m.tileSize, level, (j + 0.5) * m.tileSize], yaw, scale: 1, footprint: [i, j, i + 1, j + 1], tags: ["house", "town"] });
        m.flags[k] = m.flags[k]! | FLAG.BLOCKED;
      }
    }
    // A graded apron round the town (a step a ring) so the ground meets it.
    for (let ring = 1; ring <= 4; ring += 1) for (let j = b - ring; j < d + ring; j += 1) for (let i = a - ring; i < c + ring; i += 1) {
      if (i >= a && i < c && j >= b && j < d) continue;
      if (Math.max(a - i, i - c + 1, b - j, j - d + 1) !== ring) continue;
      const k = (j - m.j0) * m.w + (i - m.i0);
      if (i < m.i0 || j < m.j0 || i >= m.i0 + m.w || j >= m.j0 + m.d) continue;
      m.height[k] = Math.max(level - ring, Math.min(level + ring, m.height[k]!));
      if (m.water[k] !== WATER_NONE && m.water[k]! <= m.height[k]!) m.water[k] = WATER_NONE;
      m.flags[k] = m.flags[k]! & ~FLAG.RAMP;
    }
    m.regions.push({ id: ctx.stage.id, kind: "town", rect: [a, b, c, d], tags: ["wfc"] });
    void zone;
  },
});

defineStage({
  id: "level", version: "1.0.0", local: false, describe: "keel/level's generator (its templates: island, valley, highlands, archipelago) run in the mask's bounds and copied in.",
  run(ctx) {
    const [a, b, c, d] = ctx.bounds;
    const w = c - a, h = d - b;
    const template = ctx.param<string>("template", "valley"), biome = ctx.param<string>("biome", "temperate");
    const { level } = generateLevel({ seed: ctx.seed, width: w, depth: h, players: num(ctx.param("players", 0), 0), chunk: 32, settings: `scene/level.template=${template};scene/level.biome=${biome};scene/level.towns=${num(ctx.param("towns", 1), 1)}` });
    const t = level.terrain, m = ctx.map;
    const zone = ctx.recipe.stages.indexOf(ctx.stage) + 1;
    const wb = ctx.table.has(ctx.param<string>("worldBiome", "plains")) ? ctx.table.index(ctx.param<string>("worldBiome", "plains")) : 0;
    const lift = num(ctx.param("lift", 1), 1);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const i = a + x, j = b + y;
      if (!ctx.mask(i, j)) continue;
      const k = (j - m.j0) * m.w + (i - m.i0), q = y * w + x;
      m.height[k] = t.height[q]! + lift; m.type[k] = m.types.id(t.types.get(t.type[q]!).name); m.water[k] = t.water[q] === WATER_NONE ? WATER_NONE : t.water[q]! + lift;
      m.flags[k] = t.flags[q]!; m.dir[k] = t.dir[q]!; m.biome[k] = wb; m.zone[k] = zone;
    }
    for (const th of level.things.values()) m.things.push({ id: `${ctx.stage.id}:${th.id}`, kind: th.layer === "buildings" ? "building" : th.layer === "bridges" ? "bridge" : "prop", pack: th.pack, object: th.object, pos: [th.pos[0] + a * m.tileSize, th.pos[1] + lift, th.pos[2] + b * m.tileSize], yaw: wrapYaw(th.yaw), scale: th.scale, footprint: th.footprint ? [th.footprint[0] + a, th.footprint[1] + b, th.footprint[2] + a, th.footprint[3] + b] : null, tags: [...th.tags], data: { pins: JSON.stringify(th.pins) } });
    // The sub-level's spawns, resources and markers come with it (as things: a level made from the map turns them back).
    const at = (i: number, j: number): [number, number, number] => { const k = (b + j - m.j0) * m.w + (a + i - m.i0); return [(a + i + 0.5) * m.tileSize, (m.height[k] ?? 0) * m.stepHeight, (b + j + 0.5) * m.tileSize]; };
    for (const sp of level.spawns) m.things.push({ id: `${ctx.stage.id}:${sp.id}`, kind: "spawn", pos: at(sp.at[0], sp.at[1]), yaw: 0, scale: 1, footprint: null, tags: ["spawn"], data: { player: sp.player, team: sp.team, ...(sp.natural ? { naturalI: sp.natural[0] + a, naturalJ: sp.natural[1] + b } : {}) } });
    for (const r of level.resources) m.things.push({ id: `${ctx.stage.id}:${r.id}`, kind: "resource", pos: at(r.at[0], r.at[1]), yaw: 0, scale: 1, footprint: null, tags: ["resource", r.kind], data: { resource: r.kind, amount: r.amount, ...(r.owner !== null ? { owner: r.owner } : {}) } });
    for (const mk of level.markers) m.things.push({ id: `${ctx.stage.id}:${mk.id}`, kind: "marker", pos: [mk.pos[0] + a * m.tileSize, mk.pos[1] + lift, mk.pos[2] + b * m.tileSize], yaw: 0, scale: 1, footprint: null, tags: [mk.kind, ...mk.tags], data: { marker: mk.kind, ...(mk.data !== null && typeof mk.data !== "object" ? { value: mk.data } : mk.data !== null ? { value: JSON.stringify(mk.data) } : {}) } });
    m.meta[`${ctx.stage.id}.template`] = String(level.meta["template"]);
  },
});

defineStage({
  id: "foliage", version: "1.0.0", local: true, describe: "Foliage density for the scatter (recorded in the map's meta).",
  run(ctx) { ctx.map.meta["foliage.density"] = num(ctx.param("density", 1), 1); },
});
