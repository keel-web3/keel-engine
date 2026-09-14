// Worldgen's documents, packed by keel/codec:
//
//   keel/worldgen/biomes    a biome table (BiomeDef[]): what a pack ships
//   keel/worldgen/recipe    a generator pipeline (WorldRecipe): the seed, the
//                           stages with their params and masks (a recursive
//                           union), pins and locks -- a world is this, a few
//                           hundred bytes, never its tiles
//   keel/worldgen/tileset   an imported tileset's rules (terrain's
//                           TilesetRules): layout, tile size, materials
//   keel/worldgen/rooms     room templates for the stitched dungeon
//
// encode*/decode* round-trip exactly (test/schema.test.ts).

import { array, decode, dyn, encode, enumOf, int, map, named, nullable, num, optional, recursive, ref, string, struct, tuple, uint, union } from "@keel-engine/codec";
import type { Type } from "@keel-engine/codec";
import type { TilesetRules } from "@keel-engine/terrain";
import { FOLIAGE_LAYERS } from "./biomes.ts";
import type { BiomeDef } from "./biomes.ts";
import type { RoomTemplate } from "./dungeon.ts";
import type { MaskSpec, WorldRecipe } from "./pipeline.ts";

const rect = tuple([int(24), int(24), int(24), int(24)]);

const FOLIAGE_RULE = struct({
  layer: enumOf(FOLIAGE_LAYERS),
  object: ref("objects"),
  pack: optional(ref("packs")),
  weight: num(),
  density: num(),
  on: optional(array(ref("types"))),
  scale: optional(tuple([num(), num()])),
  grove: optional(num()),
  where: optional(enumOf(["core", "edge", "open", "any"])),
  water: optional(num()),
  pins: optional(map(ref("pins"), dyn())),
}, { open: true });

const BIOME = struct({
  id: ref("biomes"),
  kind: optional(enumOf(["land", "ocean", "beach", "shore", "river", "underground"], { capacity: 16 })),
  climate: struct({ temperature: num(), humidity: num(), erosion: optional(num()), weirdness: optional(num()) }),
  height: optional(struct({ min: optional(int(12)), max: optional(int(12)) })),
  relief: optional(struct({ base: optional(num()), amp: optional(num()), mountains: optional(num()) })),
  ground: array(struct({ type: ref("types"), weight: num() })),
  bed: optional(ref("types")),
  shore: optional(ref("types")),
  steep: optional(ref("types")),
  snowline: optional(int(12)),
  forest: optional(num()),
  foliage: array(FOLIAGE_RULE),
  surface: optional(dyn()),
  water: optional(struct({ hue: optional(num()), chroma: optional(num()) })),
  rivers: optional(num()),
  lakes: optional(num()),
  ambient: optional(struct({ particles: optional(array(ref("fx"))), sound: optional(array(ref("sounds"))) })),
  music: optional(ref("music")),
  tags: optional(array(ref("tags"))),
}, { open: true });

/** A biome table. */
export const BIOME_TABLE = named("keel/worldgen/biomes", struct({ biomes: array(BIOME) }), { doc: "Biomes: a point in climate space each, ground materials, relief, foliage rules, the ground palette's look, water, ambient hooks and music." });

const MASK: Type<MaskSpec> = recursive<MaskSpec>((self) => union("kind", {
  all: struct({}),
  rect: struct({ rect, feather: optional(num()) }),
  circle: struct({ at: tuple([int(24), int(24)]), r: num(), feather: optional(num()) }),
  noise: struct({ freq: num(), threshold: num(), seed: optional(string()) }),
  biome: struct({ biomes: array(ref("biomes")) }),
  height: struct({ min: optional(int(12)), max: optional(int(12)) }),
  not: struct({ mask: self }),
  and: struct({ masks: array(self) }),
  or: struct({ masks: array(self) }),
}) as unknown as Type<MaskSpec>);

/** A generator pipeline. */
export const WORLD_RECIPE = named("keel/worldgen/recipe", struct({
  format: enumOf(["keel-worldgen"]),
  version: uint(8),
  seed: string({ packHex: true }),
  width: uint(24),
  depth: uint(24),
  chunk: optional(uint(9)),
  tileSize: optional(num()),
  stepHeight: optional(num()),
  act: optional(nullable(ref("acts"))),
  stages: array(struct({ id: ref("ids"), use: ref("stages"), seed: optional(string()), params: optional(map(ref("params"), dyn())), mask: optional(MASK) })),
  pins: optional(array(struct({ rect, height: optional(int(16)), type: optional(ref("types")), water: optional(nullable(int(16))), biome: optional(ref("biomes")) }))),
  locks: optional(string()),
}, { open: true }), { doc: "A world or level as a pipeline of generator stages: seed, stages (use, seed, params, mask), pins that override every stage, lock text for the stages' rolled params." });

/** An imported tileset's rules. */
export const TILESET_RULES = named("keel/worldgen/tileset", struct({
  id: ref("ids"),
  layout: enumOf(["blob47", "wang16", "rpgmaker-a2"]),
  tile: uint(10),
  materials: array(struct({ type: ref("types"), at: tuple([uint(12), uint(12)]), over: optional(ref("types")), variants: optional(uint(4)) })),
}, { open: true }), { doc: "A tileset atlas's rules: its layout (blob-47, Wang-16 corners, RPG Maker A2 autotiles), tile size in pixels, and where each material's block starts (in tiles)." });

/** Room templates. */
export const ROOM_TEMPLATES_SCHEMA = named("keel/worldgen/rooms", struct({ rooms: array(struct({ id: ref("ids"), roles: array(enumOf(["start", "room", "key", "boss", "exit", "treasure", "cave"])), rows: array(string()), weight: optional(num()) })) }), { doc: "Prefab dungeon rooms as rows of characters (# wall, . floor, D door anchor, T torch, C chest, P pillar, ~ water, o pit, r rubble, B K S E the boss, key, start and exit)." });

export const encodeBiomes = (biomes: readonly BiomeDef[]): Uint8Array => encode(BIOME_TABLE, { biomes } as never, { header: "id" });
export const decodeBiomes = (bytes: Uint8Array): BiomeDef[] => (decode(BIOME_TABLE, bytes) as unknown as { biomes: BiomeDef[] }).biomes;
export const encodeRecipe = (recipe: WorldRecipe): Uint8Array => encode(WORLD_RECIPE, recipe as never, { header: "id" });
export const decodeRecipe = (bytes: Uint8Array): WorldRecipe => decode(WORLD_RECIPE, bytes) as unknown as WorldRecipe;
export const encodeTileset = (rules: TilesetRules): Uint8Array => encode(TILESET_RULES, rules as never, { header: "id" });
export const decodeTileset = (bytes: Uint8Array): TilesetRules => decode(TILESET_RULES, bytes) as unknown as TilesetRules;
export const encodeRooms = (rooms: readonly RoomTemplate[]): Uint8Array => encode(ROOM_TEMPLATES_SCHEMA, { rooms } as never, { header: "id" });
export const decodeRooms = (bytes: Uint8Array): RoomTemplate[] => (decode(ROOM_TEMPLATES_SCHEMA, bytes) as unknown as { rooms: RoomTemplate[] }).rooms;
