// The level's edit op list: editing as plain JSON a person's tools or an
// agent can emit, check and run -- "raise these tiles", "a ramp here", "a
// lake at level 2", "a road from here to there", "a house at ...", "lock the
// biome". As the builder's ops (@keel-engine/builder): applyLevelOp /
// streamLevelOps apply one at a time, each returning a small CHANGE EVENT
// (what changed: the chunks, the ids) a live editor redraws from -- the
// terrain's chunks rebake, the rest stays -- and each is undoable on its own;
// runLevelOps is atomic (an op failing leaves the level as it was).
//
//   const r = runLevelOps(level, [
//     { op: "height", rect: [10, 10, 20, 16], add: 1 },
//     { op: "ramp", at: [15, 9], dir: 0, width: 2 },
//     { op: "place", id: "tower-1", pack: "packs/buildings", object: "tower", pos: [31, 3, 25], tier: "ground" },
//     { op: "style", scope: "id:tower-1", style: "voxel", lock: true },
//   ]);
//
// LEVEL_OPS is the one table every op is checked against (and what
// levelOpReference() hands an agent).

import { FLAG, applyBridge, bridgeSpans, canRamp, floodWater, layRamp, regions } from "@keel-engine/terrain";
import type { TilePatch } from "@keel-engine/terrain";
import type { SettingValue, SettingsJSON } from "@keel-engine/world";
import { STYLES } from "./document.ts";
import type { Level, LevelChange, LoadTier, Marker, Region, Resource, ResourceKind, Road, ScatterRegion, Spawn, Thing } from "./document.ts";
import { dhypot } from "@keel-engine/core";

type FieldType = "tile" | "rect" | "int" | "num" | "pos" | "string" | "id" | "bool" | "tiles" | "any" | "object" | "strings" | readonly string[];
interface Field { readonly type: FieldType; readonly required?: boolean; readonly doc: string }
interface OpSpec { readonly doc: string; readonly fields: Readonly<Record<string, Field>>; readonly example: Record<string, unknown> }

const TIERS: readonly LoadTier[] = ["main", "foreground", "background", "ground"];
const KINDS: readonly ResourceKind[] = ["mass", "crystal", "flux", "fertile", "wreck"];

/** Every op: what it does, its fields, an example. */
export const LEVEL_OPS: Readonly<Record<string, OpSpec>> = {
  height: { doc: "Set or raise the tiles of a rectangle [i0, j0, i1, j1) (whole steps).", fields: { rect: { type: "rect", required: true, doc: "tiles [i0, j0, i1, j1)" }, set: { type: "int", doc: "the level to set" }, add: { type: "int", doc: "steps to add" } }, example: { op: "height", rect: [10, 10, 20, 16], add: 1 } },
  paint: { doc: "Paint a terrain type over a rectangle, or a round brush.", fields: { type: { type: "string", required: true, doc: "grass, dirt, sand, rock, snow, crystal, lava, ash, mud, road, path, ice, sandstone" }, rect: { type: "rect", doc: "tiles [i0, j0, i1, j1)" }, at: { type: "tile", doc: "a brush's middle" }, radius: { type: "num", doc: "a brush's radius (tiles)" } }, example: { op: "paint", type: "sand", at: [30, 22], radius: 3 } },
  ramp: { doc: "A ramp rising toward dir (0 n, 1 e, 2 s, 3 w), width tiles wide.", fields: { at: { type: "tile", required: true, doc: "the low tile" }, dir: { type: "int", required: true, doc: "0..3" }, width: { type: "int", doc: "tiles across (default 1)" } }, example: { op: "ramp", at: [15, 9], dir: 0, width: 2 } },
  unramp: { doc: "Take a tile's ramp off.", fields: { at: { type: "tile", required: true, doc: "the tile" } }, example: { op: "unramp", at: [15, 9] } },
  water: { doc: "Fill the basin at a tile to a level (a lake).", fields: { at: { type: "tile", required: true, doc: "a tile in the basin" }, level: { type: "int", required: true, doc: "the water's level" }, max: { type: "int", doc: "the most tiles it may take (default 4096)" } }, example: { op: "water", at: [40, 30], level: 2 } },
  drain: { doc: "Take the water off a rectangle.", fields: { rect: { type: "rect", required: true, doc: "tiles" } }, example: { op: "drain", rect: [36, 26, 44, 34] } },
  road: { doc: "Paint a road (or a path) along tiles.", fields: { id: { type: "id", doc: "its name (default road-N)" }, path: { type: "tiles", required: true, doc: "[[i, j], ...]" }, kind: { type: ["road", "path"], doc: "road (default) or path" } }, example: { op: "road", path: [[2, 5], [3, 5], [4, 5]] } },
  bridge: { doc: "A bridge across the span from one bank tile to another (in a straight line, both at one level).", fields: { from: { type: "tile", required: true, doc: "a bank" }, to: { type: "tile", required: true, doc: "the other bank" }, id: { type: "id", doc: "the bridge's thing id" } }, example: { op: "bridge", from: [20, 14], to: [20, 19] } },
  place: { doc: "Place a thing by content reference.", fields: { id: { type: "id", doc: "its id (default: object-N)" }, pack: { type: "string", required: true, doc: "packs/buildings, packs/foliage, keel/object ..." }, object: { type: "string", required: true, doc: "the object id in the pack" }, pos: { type: "pos", required: true, doc: "[x, y, z] metres (y: the ground's height when left out? give it)" }, yaw: { type: "num", doc: "radians" }, scale: { type: "num", doc: "default 1" }, pins: { type: "object", doc: "the object's pinned choices" }, look: { type: "any", doc: "its look" }, tier: { type: TIERS, doc: "main, foreground, background, ground (baked into the ground layer)" }, layer: { type: "string", doc: "objects, buildings, bridges, props" }, tags: { type: "strings", doc: "tags" }, footprint: { type: "rect", doc: "tiles it blocks" } }, example: { op: "place", id: "tower-1", pack: "packs/buildings", object: "tower", pos: [31, 3, 25], tier: "ground" } },
  move: { doc: "Move, turn or scale a thing.", fields: { id: { type: "id", required: true, doc: "the thing" }, pos: { type: "pos", doc: "[x, y, z]" }, yaw: { type: "num", doc: "radians" }, scale: { type: "num", doc: "scale" } }, example: { op: "move", id: "tower-1", yaw: 1.57 } },
  remove: { doc: "Remove a thing (or a spawn, marker, region, resource, scatter region, road) by id.", fields: { id: { type: "id", required: true, doc: "its id" } }, example: { op: "remove", id: "tower-1" } },
  scatter: { doc: "Add or replace a foliage region.", fields: { id: { type: "id", required: true, doc: "its id" }, rect: { type: "rect", required: true, doc: "tiles" }, rules: { type: "any", required: true, doc: "[{ pack, object, on, weight, spacing, scale, clump?, water? }]" }, density: { type: "num", doc: "0..2 (default 1)" }, clear: { type: "int", doc: "tiles kept clear round roads and things (default 1)" } }, example: { op: "scatter", id: "grove", rect: [0, 0, 20, 20], rules: [{ pack: "packs/foliage", object: "tree", on: ["grass"], weight: 1, spacing: 2.5, scale: [0.9, 1.2] }] } },
  spawn: { doc: "A player's spawn (their main base) and natural.", fields: { player: { type: "int", required: true, doc: "0.." }, at: { type: "tile", required: true, doc: "the main" }, natural: { type: "tile", doc: "the natural expansion" }, team: { type: "int", doc: "default: the player" } }, example: { op: "spawn", player: 0, at: [12, 12] } },
  resource: { doc: "A resource node or site.", fields: { id: { type: "id", doc: "its id" }, kind: { type: KINDS, required: true, doc: KINDS.join(", ") }, at: { type: "tile", required: true, doc: "the tile" }, amount: { type: "num", doc: "default 1500" }, owner: { type: "int", doc: "a player, or none" } }, example: { op: "resource", kind: "mass", at: [16, 12] } },
  marker: { doc: "A named point for scripts.", fields: { id: { type: "id", required: true, doc: "its id" }, kind: { type: "string", required: true, doc: "what it's for" }, pos: { type: "pos", required: true, doc: "[x, y, z]" }, tags: { type: "strings", doc: "tags" }, data: { type: "any", doc: "anything" } }, example: { op: "marker", id: "relic", kind: "relic", pos: [64, 3, 64] } },
  region: { doc: "A rectangle for triggers and rules.", fields: { id: { type: "id", required: true, doc: "its id" }, kind: { type: "string", required: true, doc: "trigger, area, nobuild, nowalk ..." }, rect: { type: "rect", required: true, doc: "tiles" }, tags: { type: "strings", doc: "tags" }, script: { type: "string", doc: "a script to run" } }, example: { op: "region", id: "ambush", kind: "trigger", rect: [30, 30, 36, 36] } },
  set: { doc: "Write a setting (refused under a lock).", fields: { scope: { type: "string", required: true, doc: "engine, project, scene, runtime, tag:<t>, id:<id>" }, key: { type: "string", required: true, doc: "the key" }, value: { type: "any", required: true, doc: "its value" } }, example: { op: "set", scope: "scene", key: "level.biome", value: "desert" } },
  lock: { doc: "Lock a setting (generation keeps it; nothing under it can change it).", fields: { scope: { type: "string", required: true, doc: "a scope" }, key: { type: "string", required: true, doc: "the key" }, value: { type: "any", doc: "its value (default: what it is now)" } }, example: { op: "lock", scope: "id:lake-0", key: "radius", value: 6 } },
  unlock: { doc: "Unlock a setting.", fields: { scope: { type: "string", required: true, doc: "a scope" }, key: { type: "string", required: true, doc: "the key" } }, example: { op: "unlock", scope: "id:lake-0", key: "radius" } },
  style: { doc: "How the level, a region's things, a tag's or one thing is drawn: pixel, voxel or custom.", fields: { style: { type: STYLES, required: true, doc: "pixel, voxel, custom" }, scope: { type: "string", doc: "scene (default), tag:<t>, id:<thing>, tag:region:<id>" }, lock: { type: "bool", doc: "lock it" } }, example: { op: "style", scope: "tag:buildings", style: "voxel" } },
  undo: { doc: "Take back the last op.", fields: { steps: { type: "int", doc: "how many (default 1)" } }, example: { op: "undo" } },
  redo: { doc: "Apply again what undo took back.", fields: { steps: { type: "int", doc: "how many (default 1)" } }, example: { op: "redo" } },
};

export type LevelOp = { readonly op: string; readonly [field: string]: unknown };
export interface LevelOpError { readonly index: number; readonly op: string; readonly field?: string; readonly message: string }
export type LevelOpResult = { readonly ok: true; readonly event: LevelChange & { readonly op: string; readonly index: number } } | { readonly ok: false; readonly error: LevelOpError };

const isTile = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger);
const isRect = (v: unknown): v is [number, number, number, number] => Array.isArray(v) && v.length === 4 && v.every(Number.isInteger) && v[2] > v[0] && v[3] > v[1];
const isPos = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
function checkField(t: FieldType, v: unknown): string | null {
  if (Array.isArray(t)) return (t as readonly string[]).includes(v as string) ? null : `one of ${t.join(", ")}`;
  switch (t) {
    case "tile": return isTile(v) ? null : "[i, j] whole numbers";
    case "rect": return isRect(v) ? null : "[i0, j0, i1, j1] whole numbers, i1 > i0, j1 > j0";
    case "int": return Number.isInteger(v) ? null : "a whole number";
    case "num": return Number.isFinite(v) ? null : "a number";
    case "pos": return isPos(v) ? null : "[x, y, z] numbers";
    case "string": case "id": return typeof v === "string" && v.length > 0 ? null : "a string";
    case "bool": return typeof v === "boolean" ? null : "true or false";
    case "tiles": return Array.isArray(v) && v.length > 0 && v.every(isTile) ? null : "[[i, j], ...]";
    case "strings": return Array.isArray(v) && v.every((x) => typeof x === "string") ? null : "strings";
    case "object": return v && typeof v === "object" && !Array.isArray(v) ? null : "an object";
    default: return null;
  }
}

/** Check ops without running them: every error, with its op's index and field. */
export function validateLevelOps(ops: unknown): { ok: boolean; errors: LevelOpError[] } {
  const errors: LevelOpError[] = [];
  if (!Array.isArray(ops)) return { ok: false, errors: [{ index: -1, op: "", message: "ops must be an array" }] };
  ops.forEach((o, index) => {
    const op = (o as LevelOp | null)?.op;
    const spec = typeof op === "string" ? LEVEL_OPS[op] : undefined;
    if (!spec) { errors.push({ index, op: String(op), message: `unknown op (ops: ${Object.keys(LEVEL_OPS).join(", ")})` }); return; }
    for (const [name, f] of Object.entries(spec.fields)) {
      const v = (o as Record<string, unknown>)[name];
      if (v === undefined) { if (f.required) errors.push({ index, op: op!, field: name, message: `${name} is required: ${f.doc}` }); continue; }
      const why = checkField(f.type, v);
      if (why) errors.push({ index, op: op!, field: name, message: `${name} must be ${why}` });
    }
    for (const name of Object.keys(o as object)) if (name !== "op" && !(name in spec.fields)) errors.push({ index, op: op!, field: name, message: `${name} isn't a field of ${op}` });
  });
  return { ok: !errors.length, errors };
}

// ---------------------------------------------------------------- history

interface Snapshot {
  terrain: TilePatch | null;
  things: Map<string, Thing | undefined>;
  lists: Partial<Pick<Level, "scatter" | "roads" | "water" | "spawns" | "markers" | "regions" | "resources">>;
  settings: SettingsJSON | null;
}
interface Entry { op: LevelOp; before: Snapshot; after: Snapshot | null; event: LevelChange }
const HISTORY = new WeakMap<Level, { done: Entry[]; undone: Entry[] }>();
const historyOf = (level: Level): { done: Entry[]; undone: Entry[] } => { let h = HISTORY.get(level); if (!h) { h = { done: [], undone: [] }; HISTORY.set(level, h); } return h; };

const LISTS = ["scatter", "roads", "water", "spawns", "markers", "regions", "resources"] as const;
function snapshot(level: Level, rect: readonly [number, number, number, number] | null, ids: readonly string[], lists: readonly (typeof LISTS)[number][], settings: boolean): Snapshot {
  const t = level.terrain;
  let terrain: TilePatch | null = null;
  if (rect) {
    const i0 = Math.max(0, rect[0]), j0 = Math.max(0, rect[1]), i1 = Math.min(t.width, rect[2]), j1 = Math.min(t.depth, rect[3]);
    if (i1 > i0 && j1 > j0) terrain = t.read(i0, j0, i1 - i0, j1 - j0);
  }
  const things = new Map<string, Thing | undefined>(ids.map((id) => [id, level.things.get(id)]));
  const l: Snapshot["lists"] = {};
  for (const name of lists) (l as Record<string, unknown>)[name] = level[name].slice();
  return { terrain, things, lists: l, settings: settings ? level.settings.toJSON() : null };
}
function restore(level: Level, s: Snapshot): void {
  if (s.terrain) level.terrain.write(s.terrain);
  for (const [id, th] of s.things) { if (th) level.things.set(id, th); else level.things.delete(id); }
  for (const [name, list] of Object.entries(s.lists)) (level as unknown as Record<string, unknown>)[name] = (list as unknown[]).slice();
  if (s.settings) level.settings.load(s.settings);
}

// ---------------------------------------------------------------- applying

const fail = (index: number, op: string, message: string, field?: string): LevelOpResult => ({ ok: false, error: { index, op, message, ...(field ? { field } : {}) } });

/** Apply one op: a change event, or the error (the level unchanged). */
export function applyLevelOp(level: Level, op: LevelOp, index = historyOf(level).done.length): LevelOpResult {
  const v = validateLevelOps([op]);
  if (!v.ok) { const e = v.errors[0]!; return { ok: false, error: { ...e, index } }; }
  const h = historyOf(level);
  const t = level.terrain;
  const name = op.op;
  if (name === "undo" || name === "redo") {
    const steps = (op["steps"] as number | undefined) ?? 1;
    const from = name === "undo" ? h.done : h.undone, to = name === "undo" ? h.undone : h.done;
    if (from.length < steps) return fail(index, name, `nothing to ${name}`);
    const chunks = new Set<number>(), ids = new Set<string>();
    for (let s = 0; s < steps; s += 1) {
      const e = from.pop()!;
      if (name === "undo") { e.after = e.after ?? snapshotLike(level, e.before); restore(level, e.before); }
      else restore(level, e.after!);
      to.push(e);
      e.event.chunks.forEach((c) => chunks.add(c)); e.event.ids.forEach((i) => ids.add(i));
    }
    const event = { kind: "all" as const, chunks: [...chunks].sort((a, b) => a - b), ids: [...ids], op: name, index };
    level.changed(event);
    return { ok: true, event };
  }
  // What an op touches (for its undo snapshot).
  let rect: [number, number, number, number] | null = null;
  const ids: string[] = [];
  const lists: (typeof LISTS)[number][] = [];
  let settings = false;
  const g = (k: string): unknown => op[k];
  const bounds = (tiles: readonly (readonly [number, number])[], pad = 0): [number, number, number, number] => [Math.min(...tiles.map((x) => x[0])) - pad, Math.min(...tiles.map((x) => x[1])) - pad, Math.max(...tiles.map((x) => x[0])) + 1 + pad, Math.max(...tiles.map((x) => x[1])) + 1 + pad];
  switch (name) {
    case "height": case "drain": rect = g("rect") as [number, number, number, number]; break;
    case "paint": { const r = g("rect") as [number, number, number, number] | undefined, at = g("at") as [number, number] | undefined, rad = Math.ceil((g("radius") as number | undefined) ?? 1); if (!r && !at) return fail(index, name, "paint needs rect or at"); rect = r ?? [at![0] - rad, at![1] - rad, at![0] + rad + 1, at![1] + rad + 1]; break; }
    case "ramp": { const at = g("at") as [number, number], w = (g("width") as number | undefined) ?? 1; rect = [at[0] - w, at[1] - w, at[0] + w + 1, at[1] + w + 1]; break; }
    case "unramp": { const at = g("at") as [number, number]; rect = [at[0], at[1], at[0] + 1, at[1] + 1]; break; }
    case "water": rect = [0, 0, t.width, t.depth]; lists.push("water"); break;
    case "road": { rect = bounds(g("path") as [number, number][]); lists.push("roads"); break; }
    case "bridge": { rect = bounds([g("from") as [number, number], g("to") as [number, number]]); ids.push((g("id") as string | undefined) ?? `bridge-${level.things.size}`); break; }
    case "place": case "move": case "remove": ids.push((g("id") as string | undefined) ?? `${g("object") as string}-${level.things.size}`); lists.push(...LISTS); break;
    case "scatter": lists.push("scatter"); break;
    case "spawn": lists.push("spawns"); break;
    case "resource": lists.push("resources"); break;
    case "marker": lists.push("markers"); break;
    case "region": lists.push("regions"); break;
    case "set": case "lock": case "unlock": case "style": settings = true; break;
    default: break;
  }
  const before = snapshot(level, rect, ids, lists, settings);
  const chunksOf = (r: readonly [number, number, number, number] | null): number[] => {
    if (!r) return [];
    const out = new Set<number>();
    const cs = t.chunk;
    for (let cj = Math.max(0, Math.floor((r[1] - 2) / cs)); cj <= Math.min(t.chunksZ - 1, Math.floor((r[3] + 1) / cs)); cj += 1) for (let ci = Math.max(0, Math.floor((r[0] - 2) / cs)); ci <= Math.min(t.chunksX - 1, Math.floor((r[2] + 1) / cs)); ci += 1) out.add(cj * t.chunksX + ci);
    return [...out].sort((a, b) => a - b);
  };
  let event: LevelChange;
  try {
    event = run(level, op, index, chunksOf, ids);
  } catch (e) {
    restore(level, before);
    return fail(index, name, e instanceof Error ? e.message : String(e));
  }
  h.done.push({ op, before, after: null, event });
  h.undone.length = 0;
  const out = { ...event, op: name, index };
  level.changed(out);
  return { ok: true, event: out };
}

// The state after an op, for redo: the same parts its snapshot took.
function snapshotLike(level: Level, s: Snapshot): Snapshot {
  const rect = s.terrain ? [s.terrain.i0, s.terrain.j0, s.terrain.i0 + s.terrain.w, s.terrain.j0 + s.terrain.d] as const : null;
  return snapshot(level, rect, [...s.things.keys()], Object.keys(s.lists) as (typeof LISTS)[number][], s.settings !== null);
}

function run(level: Level, op: LevelOp, _index: number, chunksOf: (r: readonly [number, number, number, number] | null) => number[], ids: readonly string[]): LevelChange {
  const t = level.terrain;
  const g = <T>(k: string): T => op[k] as T;
  const all = (i0: number, j0: number, i1: number, j1: number, fn: (i: number, j: number) => void): void => {
    t.batch(() => { for (let j = Math.max(0, j0); j < Math.min(t.depth, j1); j += 1) for (let i = Math.max(0, i0); i < Math.min(t.width, i1); i += 1) fn(i, j); });
  };
  switch (op.op) {
    case "height": {
      const r = g<[number, number, number, number]>("rect"), set = g<number | undefined>("set"), add = g<number | undefined>("add");
      if (set === undefined && add === undefined) throw new Error("height needs set or add");
      all(r[0], r[1], r[2], r[3], (i, j) => t.setHeight(i, j, set ?? t.height[t.index(i, j)]! + add!));
      return { kind: "terrain", chunks: chunksOf(r), ids: [] };
    }
    case "paint": {
      const type = g<string>("type");
      t.types.id(type);
      const r = g<[number, number, number, number] | undefined>("rect");
      if (r) { all(r[0], r[1], r[2], r[3], (i, j) => t.setType(i, j, type)); return { kind: "terrain", chunks: chunksOf(r), ids: [] }; }
      const at = g<[number, number]>("at"), rad = g<number | undefined>("radius") ?? 1;
      all(at[0] - Math.ceil(rad), at[1] - Math.ceil(rad), at[0] + Math.ceil(rad) + 1, at[1] + Math.ceil(rad) + 1, (i, j) => { if (dhypot(i - at[0], j - at[1]) <= rad) t.setType(i, j, type); });
      return { kind: "terrain", chunks: chunksOf([at[0] - rad, at[1] - rad, at[0] + rad + 1, at[1] + rad + 1]), ids: [] };
    }
    case "ramp": {
      const at = g<[number, number]>("at"), d = g<number>("dir"), w = g<number | undefined>("width") ?? 1;
      if (!canRamp(t, at[0], at[1], d)) throw new Error(`no ramp fits at ${at[0]},${at[1]} rising ${d} (the tile toward it must be one step up, the one behind level)`);
      const made = layRamp(t, at[0], at[1], d, w);
      return { kind: "terrain", chunks: chunksOf([at[0] - w, at[1] - w, at[0] + w + 1, at[1] + w + 1]), ids: made.map(([i, j]) => `tile:${i},${j}`) };
    }
    case "unramp": { const at = g<[number, number]>("at"); t.setRamp(at[0], at[1], null); return { kind: "terrain", chunks: chunksOf([at[0], at[1], at[0] + 1, at[1] + 1]), ids: [] }; }
    case "water": {
      const at = g<[number, number]>("at"), lv = g<number>("level");
      const filled = floodWater(t, at[0], at[1], lv, { max: g<number | undefined>("max") ?? 4096 });
      if (filled === null) throw new Error("the basin leaks past its limit (raise max, or build a rim)");
      if (!filled.length) throw new Error("the tile is at or above that level");
      const id = `lake-${level.water.length}`;
      level.water = [...level.water, { id, kind: "lake", level: lv, at, path: null }];
      const xs = filled.map((f) => f[0]), zs = filled.map((f) => f[1]);
      return { kind: "water", chunks: chunksOf([Math.min(...xs), Math.min(...zs), Math.max(...xs) + 1, Math.max(...zs) + 1]), ids: [id] };
    }
    case "drain": { const r = g<[number, number, number, number]>("rect"); all(r[0], r[1], r[2], r[3], (i, j) => t.setWater(i, j, null)); return { kind: "water", chunks: chunksOf(r), ids: [] }; }
    case "road": {
      const path = g<[number, number][]>("path"), kind = g<"road" | "path" | undefined>("kind") ?? "road";
      for (const [i, j] of path) if (!t.inside(i, j)) throw new Error(`tile ${i},${j} is off the map`);
      t.batch(() => { for (const [i, j] of path) if (t.waterDepth(i, j) === 0 && !t.isBridge(i, j)) t.setType(i, j, kind); });
      const id = g<string | undefined>("id") ?? `road-${level.roads.length}`;
      const road: Road = { id, kind, path };
      level.roads = [...level.roads.filter((r) => r.id !== id), road];
      const xs = path.map((p) => p[0]), zs = path.map((p) => p[1]);
      return { kind: "roads", chunks: chunksOf([Math.min(...xs), Math.min(...zs), Math.max(...xs) + 1, Math.max(...zs) + 1]), ids: [id] };
    }
    case "bridge": {
      const from = g<[number, number]>("from"), to = g<[number, number]>("to");
      const lo = from[0] < to[0] || from[1] < to[1] ? from : to;
      const spans = bridgeSpans(t, { maxSpan: Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])), regions: regions(level.pathGrid()).label });
      const s = spans.find((x) => x.from[0] === lo[0] && x.from[1] === lo[1] && x.to[0] === (lo === from ? to : from)[0] && x.to[1] === (lo === from ? to : from)[1]);
      if (!s) throw new Error(`no bridge fits from ${from} to ${to} (straight, both banks flat at one level, nothing higher between)`);
      applyBridge(t, s);
      const id = ids[0]!;
      const ts = t.tileSize;
      level.things.set(id, { id, layer: "bridges", pack: "packs/buildings", object: "bridge", pins: { length: (s.length + 1) * ts, width: ts }, look: null, tier: "ground", pos: [((s.from[0] + s.to[0]) / 2 + 0.5) * ts, s.level * t.stepHeight, ((s.from[1] + s.to[1]) / 2 + 0.5) * ts], yaw: s.axis === 0 ? 0 : Math.PI / 2, scale: 1, tags: ["bridge"], footprint: null });
      return { kind: "things", chunks: chunksOf([Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(from[0], to[0]) + 1, Math.max(from[1], to[1]) + 1]), ids: [id] };
    }
    case "place": {
      const id = ids[0]!;
      if (level.things.has(id)) throw new Error(`a thing called ${id} is already placed (move it, or remove it first)`);
      const pos = g<[number, number, number]>("pos");
      const th: Thing = {
        id, layer: g<string | undefined>("layer") ?? "objects", pack: g<string>("pack"), object: g<string>("object"), pins: g<Record<string, SettingValue> | undefined>("pins") ?? {},
        look: g<SettingValue | undefined>("look") ?? null, tier: g<LoadTier | undefined>("tier") ?? "foreground", pos, yaw: g<number | undefined>("yaw") ?? 0, scale: g<number | undefined>("scale") ?? 1,
        tags: g<string[] | undefined>("tags") ?? [], footprint: g<[number, number, number, number] | undefined>("footprint") ?? null,
      };
      level.things.set(id, th);
      return { kind: "things", chunks: th.tier === "ground" ? chunksOfThing(level, th, chunksOf) : [], ids: [id] };
    }
    case "move": {
      const id = g<string>("id");
      const th = level.things.get(id);
      if (!th) throw new Error(`no thing ${id}`);
      const next: Thing = { ...th, pos: g<[number, number, number] | undefined>("pos") ?? th.pos, yaw: g<number | undefined>("yaw") ?? th.yaw, scale: g<number | undefined>("scale") ?? th.scale };
      level.things.set(id, next);
      return { kind: "things", chunks: th.tier === "ground" ? [...new Set([...chunksOfThing(level, th, chunksOf), ...chunksOfThing(level, next, chunksOf)])].sort((a, b) => a - b) : [], ids: [id] };
    }
    case "remove": {
      const id = g<string>("id");
      const th = level.things.get(id);
      if (th) {
        level.things.delete(id);
        if (th.layer === "bridges") { const [i, j] = t.tileAt(th.pos[0], th.pos[2]); if (t.isBridge(i, j)) clearDeck(level, i, j); }
        return { kind: "things", chunks: th.tier === "ground" ? chunksOfThing(level, th, chunksOf) : [], ids: [id] };
      }
      for (const name of LISTS) {
        const list = level[name] as ReadonlyArray<{ readonly id: string }>;
        if (list.some((x) => x.id === id)) { (level as unknown as Record<string, unknown>)[name] = list.filter((x) => x.id !== id); return { kind: name === "scatter" ? "scatter" : name, chunks: [], ids: [id] }; }
      }
      throw new Error(`nothing called ${id}`);
    }
    case "scatter": {
      const region: ScatterRegion = { id: g<string>("id"), rect: g<[number, number, number, number]>("rect"), rules: g<ScatterRegion["rules"]>("rules"), density: g<number | undefined>("density") ?? 1, clear: g<number | undefined>("clear") ?? 1 };
      if (!Array.isArray(region.rules) || !region.rules.every((r) => typeof r.pack === "string" && typeof r.object === "string" && Array.isArray(r.on) && r.spacing > 0)) throw new Error("rules: [{ pack, object, on: [types], weight, spacing > 0, scale: [a, b] }]");
      level.scatter = [...level.scatter.filter((r) => r.id !== region.id), region];
      return { kind: "scatter", chunks: [], ids: [region.id] };
    }
    case "spawn": {
      const player = g<number>("player"), at = g<[number, number]>("at");
      const s: Spawn = { id: `spawn-${player}`, player, team: g<number | undefined>("team") ?? player, at, natural: g<[number, number] | undefined>("natural") ?? null };
      level.spawns = [...level.spawns.filter((x) => x.player !== player), s].sort((a, b) => a.player - b.player);
      return { kind: "spawns", chunks: [], ids: [s.id] };
    }
    case "resource": {
      const r: Resource = { id: g<string | undefined>("id") ?? `resource-${level.resources.length}`, kind: g<ResourceKind>("kind"), at: g<[number, number]>("at"), amount: g<number | undefined>("amount") ?? 1500, owner: g<number | undefined>("owner") ?? null };
      level.resources = [...level.resources.filter((x) => x.id !== r.id), r];
      return { kind: "resources", chunks: [], ids: [r.id] };
    }
    case "marker": {
      const m: Marker = { id: g<string>("id"), kind: g<string>("kind"), pos: g<[number, number, number]>("pos"), tags: g<string[] | undefined>("tags") ?? [], data: g<SettingValue | undefined>("data") ?? null };
      level.markers = [...level.markers.filter((x) => x.id !== m.id), m];
      return { kind: "markers", chunks: [], ids: [m.id] };
    }
    case "region": {
      const r: Region = { id: g<string>("id"), kind: g<string>("kind"), rect: g<[number, number, number, number]>("rect"), tags: g<string[] | undefined>("tags") ?? [], script: g<string | undefined>("script") ?? null };
      level.regions = [...level.regions.filter((x) => x.id !== r.id), r];
      return { kind: "regions", chunks: [], ids: [r.id] };
    }
    case "set": case "lock": case "unlock": case "style": {
      const scope = op.op === "style" ? g<string | undefined>("scope") ?? "scene" : g<string>("scope");
      const key = op.op === "style" ? "style" : g<string>("key");
      const w = op.op === "set" ? level.settings.set(scope, key, g<SettingValue>("value"))
        : op.op === "lock" ? level.settings.lock(scope, key, g<SettingValue | undefined>("value"))
          : op.op === "unlock" ? level.settings.unlock(scope, key)
            : g<boolean | undefined>("lock") ? level.settings.lock(scope, key, g<SettingValue>("style")) : level.settings.set(scope, key, g<SettingValue>("style"));
      if (!w.ok) throw new Error(`refused: ${key} is locked at ${(w as { lockedAt: string }).lockedAt}`);
      // (A style can change every ground-baked thing's layer: name them.)
      const touched = key === "style" ? [...level.things.values()].filter((x) => x.tier === "ground").flatMap((x) => chunksOfThing(level, x, chunksOf)) : [];
      return { kind: "settings", chunks: [...new Set(touched)].sort((a, b) => a - b), ids: [`${scope}/${key}`] };
    }
    default: throw new Error(`unknown op ${op.op}`);
  }
}

function chunksOfThing(level: Level, th: Thing, chunksOf: (r: readonly [number, number, number, number] | null) => number[]): number[] {
  const t = level.terrain;
  const [i, j] = t.tileAt(th.pos[0], th.pos[2]);
  const r = th.footprint ?? [i - 3, j - 3, i + 4, j + 4];
  return chunksOf(r);
}

// A bridge removed: its deck tiles along its axis, both ways from a tile on it.
function clearDeck(level: Level, i: number, j: number): void {
  const t = level.terrain;
  const axis = t.dir[t.index(i, j)]!;
  const dx = axis === 1 ? 1 : 0, dz = axis === 0 ? 1 : 0;
  t.batch(() => {
    for (const s of [-1, 1]) for (let n = s === 1 ? 0 : 1; ; n += 1) {
      const a = i + dx * n * s, b = j + dz * n * s;
      if (!t.inside(a, b) || !(t.flags[t.index(a, b)]! & FLAG.BRIDGE)) break;
      t.setDeck(a, b, null);
    }
  });
}

/** Apply ops one at a time, yielding each result (a live editor redraws between them). */
export function* streamLevelOps(level: Level, ops: readonly LevelOp[]): Generator<LevelOpResult, void, unknown> {
  for (const op of ops) yield applyLevelOp(level, op);
}

export interface LevelRunResult {
  readonly ok: boolean;
  readonly errors: readonly LevelOpError[];
  readonly events: readonly (LevelChange & { readonly op: string; readonly index: number })[];
}

/** Run ops; atomic by default (the first failure undoes the ones before it). */
export function runLevelOps(level: Level, ops: unknown, { atomic = true }: { readonly atomic?: boolean } = {}): LevelRunResult {
  const v = validateLevelOps(ops);
  if (!v.ok) return { ok: false, errors: v.errors, events: [] };
  const events: Array<LevelChange & { readonly op: string; readonly index: number }> = [];
  const errors: LevelOpError[] = [];
  let applied = 0;
  for (const [n, op] of (ops as LevelOp[]).entries()) {
    const r = applyLevelOp(level, op, n);
    if (r.ok) { events.push(r.event); if (op.op !== "undo" && op.op !== "redo") applied += 1; continue; }
    errors.push(r.error);
    if (atomic) { if (applied) applyLevelOp(level, { op: "undo", steps: applied }); return { ok: false, errors, events: [] }; }
  }
  return { ok: !errors.length, errors, events };
}

/** The op table as text, for an agent's instructions. */
export function levelOpReference(): string {
  return Object.entries(LEVEL_OPS).map(([name, s]) => `${name}: ${s.doc}\n  ${Object.entries(s.fields).map(([f, x]) => `${f}${x.required ? "" : "?"} (${Array.isArray(x.type) ? (x.type as readonly string[]).join("|") : x.type as string}): ${x.doc}`).join("\n  ")}\n  e.g. ${JSON.stringify(s.example)}`).join("\n");
}
