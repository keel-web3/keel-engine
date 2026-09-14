// The level: terrain and LAYERS of placed things, with the settings (and
// their locks) that made it -- as a live object the editor and the game work
// on (Level), and as a plain, versioned document (LevelDocument) that a
// codec schema packs (schema.ts).
//
//   things     objects by pack + object id + pins + look (buildings, bridges,
//              props): their STYLE (pixel | voxel | custom) is a setting --
//              the level's, a region's, a tag's, the thing's own; locks hold
//   scatter    foliage regions: rules and a seed, expanded at load (a forest
//              is a few hundred bytes, not ten thousand placements)
//   roads      tile paths (painted into the terrain; kept for the editor)
//   water      seas, lakes, rivers (the terrain holds the water; these name it)
//   spawns     one per player: the main base, its natural
//   resources  mass nodes and the advanced sites (keel-rts RTS.md 3)
//   markers    named points for scripts (a relic, a camera start)
//   regions    rectangles for triggers and rules (enter, no-build, no-walk)
//
// Every thing is placed by content reference; nothing here knows how a tree
// or a house is built (content.ts: the resolver the content packs provide).

import { createSettings } from "@keel-engine/world";
import type { SettingValue, Settings, SettingsJSON, Thing as SettingsThing } from "@keel-engine/world";
import { FLAG, WATER_NONE, buildPathGrid, createTerrain, terrainTypes } from "@keel-engine/terrain";
import type { MoveClass, PathGrid, PathOptions, Terrain } from "@keel-engine/terrain";

export const LEVEL_FORMAT = "keel-level";
export const LEVEL_VERSION = 1;

export type Style = "pixel" | "voxel" | "custom";
export const STYLES: readonly Style[] = ["pixel", "voxel", "custom"];
/** Where a thing loads: the streaming loader's tiers, or baked into the ground's own layers (per-texel depth: bridges, buildings). */
export type LoadTier = "main" | "foreground" | "background" | "ground";
export type ThingLayer = "objects" | "buildings" | "bridges" | "props" | (string & {});

export type V3 = readonly [number, number, number];
export type Tile = readonly [number, number];
export type Rect = readonly [number, number, number, number];

/** A placed thing: which content, how it's pinned and dressed, where. */
export interface Thing {
  readonly id: string;
  readonly layer: ThingLayer;
  /** The content pack ("packs/buildings") and the object in it ("house"). */
  readonly pack: string;
  readonly object: string;
  /** The object's pinned choices (its shape). */
  readonly pins: Readonly<Record<string, SettingValue>>;
  /** Its look (colours, pattern: painted, never baked), or null for the content's own. */
  readonly look: SettingValue | null;
  readonly tier: LoadTier;
  readonly pos: V3;
  readonly yaw: number;
  readonly scale: number;
  readonly tags: readonly string[];
  /** Tiles it stands on and blocks [i0, j0, i1, j1) (null: it blocks nothing). */
  readonly footprint: Rect | null;
}

export interface ScatterRule {
  readonly pack: string;
  readonly object: string;
  readonly pins?: Readonly<Record<string, SettingValue>>;
  /** Terrain types it grows on. */
  readonly on: readonly string[];
  /** Relative weight among the rules that can grow at a point. */
  readonly weight: number;
  /** Metres to the nearest other thing of any rule (its Poisson radius). */
  readonly spacing: number;
  /** Scale range. */
  readonly scale: readonly [number, number];
  /** 0: even; 1: in clumps (forests), by a noise field. */
  readonly clump?: number;
  /** Only within this many tiles of water (reeds), or at least this many from it (negative). */
  readonly water?: number;
  readonly tags?: readonly string[];
}

export interface ScatterRegion {
  readonly id: string;
  readonly rect: Rect;
  readonly rules: readonly ScatterRule[];
  /** 0..2: how much of what the rules allow grows. */
  readonly density: number;
  /** Tiles kept clear round roads, things and spawns. */
  readonly clear: number;
}

export interface Road { readonly id: string; readonly kind: "road" | "path"; readonly path: readonly Tile[] }
export interface WaterFeature { readonly id: string; readonly kind: "sea" | "lake" | "river"; readonly level: number; readonly at: Tile | null; readonly path: readonly Tile[] | null }
export interface Spawn { readonly id: string; readonly player: number; readonly team: number; readonly at: Tile; readonly natural: Tile | null }
export interface Marker { readonly id: string; readonly kind: string; readonly pos: V3; readonly tags: readonly string[]; readonly data: SettingValue | null }
export interface Region { readonly id: string; readonly kind: "trigger" | "area" | "nobuild" | "nowalk" | (string & {}); readonly rect: Rect; readonly tags: readonly string[]; readonly script: string | null }
export type ResourceKind = "mass" | "crystal" | "flux" | "fertile" | "wreck";
export interface Resource { readonly id: string; readonly kind: ResourceKind; readonly at: Tile; readonly amount: number; readonly owner: number | null }

/** The terrain as plain arrays. */
export interface TerrainRecord {
  readonly width: number;
  readonly depth: number;
  readonly tileSize: number;
  readonly stepHeight: number;
  readonly chunk: number;
  /** Type names in id order (a reader maps them onto its own table). */
  readonly types: readonly string[];
  readonly height: readonly number[];
  readonly type: readonly number[];
  readonly flags: readonly number[];
  readonly dir: readonly number[];
  readonly water: readonly number[];
  readonly deck: readonly number[];
}

export interface LevelDocument {
  readonly format: typeof LEVEL_FORMAT;
  readonly version: typeof LEVEL_VERSION;
  readonly id: string;
  readonly name: string;
  readonly seed: string;
  readonly terrain: TerrainRecord;
  readonly settings: SettingsJSON;
  readonly things: readonly Thing[];
  readonly scatter: readonly ScatterRegion[];
  readonly roads: readonly Road[];
  readonly water: readonly WaterFeature[];
  readonly spawns: readonly Spawn[];
  readonly markers: readonly Marker[];
  readonly regions: readonly Region[];
  readonly resources: readonly Resource[];
  readonly meta: Readonly<Record<string, SettingValue>>;
}

/** What a resolver is asked for: a content reference, its style resolved, its seed. */
export interface ContentRef {
  readonly pack: string;
  readonly object: string;
  readonly pins: Readonly<Record<string, SettingValue>>;
  readonly look: SettingValue | null;
  readonly style: Style;
  /** The thing's own seed (the level's seed and its id): generative content varies by it. */
  readonly seed: string;
}

export interface LevelChange {
  /** What changed: the terrain (and which chunks), things, scatter, settings... */
  readonly kind: "terrain" | "things" | "scatter" | "roads" | "water" | "spawns" | "markers" | "regions" | "resources" | "settings" | "all";
  readonly chunks: readonly number[];
  readonly ids: readonly string[];
}

export interface Level {
  readonly id: string;
  name: string;
  readonly seed: string;
  readonly terrain: Terrain;
  readonly settings: Settings;
  readonly things: Map<string, Thing>;
  scatter: ScatterRegion[];
  roads: Road[];
  water: WaterFeature[];
  spawns: Spawn[];
  markers: Marker[];
  regions: Region[];
  resources: Resource[];
  meta: Record<string, SettingValue>;
  /** Bumped on every change. */
  readonly version: number;
  /** Tell listeners (ops do this; direct edits may too). */
  changed(change: LevelChange): void;
  onChange(fn: (c: LevelChange) => void): () => void;
  /** How a thing (or a region, or the level) is drawn: the "style" setting through its tags and id. */
  styleOf(thing?: Thing | Region | null): Style;
  /** The settings view of a thing: its id and tags (its layer, pack:, object:, the regions it's in). */
  settingsThing(thing: Thing): SettingsThing;
  /** A thing's content reference. */
  refOf(thing: Thing): ContentRef;
  /** Tiles nothing walks on: BLOCKED flags, things' footprints, no-walk regions. */
  blocked(): Uint8Array;
  pathGrid(moveClass?: MoveClass, opts?: Omit<PathOptions, "moveClass" | "blocked">): PathGrid;
  toDocument(): LevelDocument;
}

export interface LevelSpec {
  readonly id?: string;
  readonly name?: string;
  readonly seed?: string;
  readonly width: number;
  readonly depth: number;
  readonly tileSize?: number;
  readonly stepHeight?: number;
  readonly chunk?: number;
  readonly settings?: Settings;
}

/** An empty level. */
export function createLevel(spec: LevelSpec): Level {
  const id = spec.id ?? "level";
  const terrain = createTerrain({ width: spec.width, depth: spec.depth, tileSize: spec.tileSize ?? 2, stepHeight: spec.stepHeight ?? 1, chunk: spec.chunk ?? 32, id });
  return build(id, spec.name ?? id, spec.seed ?? "1", terrain, spec.settings ?? createSettings());
}

function build(id: string, name: string, seed: string, terrain: Terrain, settings: Settings): Level {
  const listeners = new Set<(c: LevelChange) => void>();
  let version = 0;
  const L: Level = {
    id, name, seed, terrain, settings,
    things: new Map(),
    scatter: [], roads: [], water: [], spawns: [], markers: [], regions: [], resources: [], meta: {},
    get version() { return version; },
    changed(c) { version += 1; for (const fn of listeners) fn(c); },
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    settingsThing(thing) {
      const [i, j] = terrain.tileAt(thing.pos[0], thing.pos[2]);
      const inRegions = L.regions.filter((r) => i >= r.rect[0] && j >= r.rect[1] && i < r.rect[2] && j < r.rect[3]).map((r) => `region:${r.id}`);
      return { id: thing.id, tags: [thing.layer, `pack:${thing.pack}`, `object:${thing.object}`, ...inRegions, ...thing.tags] };
    },
    styleOf(thing = null) {
      const v = thing === null ? settings.get("style") : "pack" in thing ? settings.get("style", L.settingsThing(thing)) : settings.get("style", { id: thing.id, tags: [`region:${thing.id}`, ...thing.tags] });
      return typeof v === "string" && (STYLES as readonly string[]).includes(v) ? (v as Style) : "pixel";
    },
    refOf: (thing) => ({ pack: thing.pack, object: thing.object, pins: thing.pins, look: thing.look, style: L.styleOf(thing), seed: `${seed}:${thing.id}` }),
    blocked() {
      const b = new Uint8Array(terrain.width * terrain.depth);
      for (let k = 0; k < b.length; k += 1) if (terrain.flags[k]! & FLAG.BLOCKED) b[k] = 1;
      const mark = (r: Rect): void => { for (let j = Math.max(0, r[1]); j < Math.min(terrain.depth, r[3]); j += 1) for (let i = Math.max(0, r[0]); i < Math.min(terrain.width, r[2]); i += 1) b[j * terrain.width + i] = 1; };
      for (const t of L.things.values()) if (t.footprint) mark(t.footprint);
      for (const r of L.regions) if (r.kind === "nowalk") mark(r.rect);
      return b;
    },
    pathGrid: (moveClass = "ground", opts = {}) => buildPathGrid(terrain, { ...opts, moveClass, blocked: L.blocked() }),
    toDocument() {
      const t = terrain;
      return {
        format: LEVEL_FORMAT, version: LEVEL_VERSION, id, name: L.name, seed,
        terrain: {
          width: t.width, depth: t.depth, tileSize: t.tileSize, stepHeight: t.stepHeight, chunk: t.chunk, types: t.types.list.map((x) => x.name),
          height: Array.from(t.height), type: Array.from(t.type), flags: Array.from(t.flags), dir: Array.from(t.dir), water: Array.from(t.water), deck: Array.from(t.deck),
        },
        settings: settings.toJSON(),
        things: [...L.things.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        scatter: L.scatter.slice(), roads: L.roads.slice(), water: L.water.slice(), spawns: L.spawns.slice(), markers: L.markers.slice(), regions: L.regions.slice(), resources: L.resources.slice(),
        meta: { ...L.meta },
      };
    },
  };
  return L;
}

/** A level from its document. Terrain types are matched by name onto the engine's table (an unknown name throws). */
export function levelOf(doc: LevelDocument): Level {
  if (doc.format !== LEVEL_FORMAT) throw new TypeError(`Not a level: format "${String(doc.format)}".`);
  if (doc.version !== LEVEL_VERSION) throw new RangeError(`Level version ${doc.version}: this reads ${LEVEL_VERSION}.`);
  const r = doc.terrain;
  const types = terrainTypes();
  const terrain = createTerrain({ width: r.width, depth: r.depth, tileSize: r.tileSize, stepHeight: r.stepHeight, chunk: r.chunk, types, id: doc.id });
  const map = r.types.map((n) => types.id(n));
  const n = r.width * r.depth;
  for (const [name, arr] of [["height", r.height], ["type", r.type], ["flags", r.flags], ["dir", r.dir], ["water", r.water], ["deck", r.deck]] as const) if (arr.length !== n) throw new RangeError(`Level terrain ${name}: ${arr.length} tiles, want ${n}.`);
  for (let k = 0; k < n; k += 1) {
    terrain.height[k] = r.height[k]!; terrain.type[k] = map[r.type[k]!]!; terrain.flags[k] = r.flags[k]!; terrain.dir[k] = r.dir[k]!;
    terrain.water[k] = r.water[k]!; terrain.deck[k] = r.deck[k]!;
  }
  const settings = createSettings();
  settings.load(doc.settings);
  const L = build(doc.id, doc.name, doc.seed, terrain, settings);
  for (const t of doc.things) L.things.set(t.id, t);
  L.scatter = doc.scatter.slice(); L.roads = doc.roads.slice(); L.water = doc.water.slice(); L.spawns = doc.spawns.slice(); L.markers = doc.markers.slice(); L.regions = doc.regions.slice(); L.resources = doc.resources.slice();
  L.meta = { ...doc.meta };
  return L;
}

export { WATER_NONE };
