import { defineManifest } from "@keel-engine/runtime";
import { schemaEntry } from "@keel-engine/codec";
import { BIOME_TABLE, ROOM_TEMPLATES_SCHEMA, TILESET_RULES, WORLD_RECIPE } from "./schema.ts";

// (The dungeon renderer draws keel/bake's depth sprites -- its one occlusion model. Terrain types, the ground surface and tilesets are keel/terrain's; levels and their locks keel/level's and
// keel/world's; recipes and biome tables pack through keel/codec -- its four schemas are declared here, bytes
// embedded, so a tool resolves a recipe, a biome table, a tileset or a room list from the manifest alone.)
export const manifest = defineManifest({
  id: "keel/worldgen",
  version: "0.1.1",
  kind: "runtime",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/bake@^0.1", "keel/codec@^0.1", "keel/terrain@^0.1", "keel/world@^0.1", "keel/level@^0.1"],
  provides: ["worldgen/stage/overworld@1.0.0", "worldgen/stage/biome@1.0.0", "worldgen/stage/dungeon@1.0.0", "worldgen/stage/cave@1.0.0", "worldgen/stage/town@1.0.0", "worldgen/stage/level@1.0.0", "worldgen/stage/foliage@1.0.0"],
  contents: { schemas: [WORLD_RECIPE, BIOME_TABLE, TILESET_RULES, ROOM_TEMPLATES_SCHEMA].map((s) => schemaEntry(s)) },
  title: "KEEL Engine world generation",
  description: "Climate biomes (data; packs add their own), biome swapping (re-skin, seasons, runtime spread), the infinite chunked overworld (rivers, lakes, structures, ores, caves), action-RPG dungeons (BSP, room grammar, cellular caves, drunkard walks, wave function collapse) dressed as action-RPG floors (acts, room kinds, props, lights, doors, stairs) and drawn in pixel art (walls with height, a flickering light map, the cutaway, fog of war), foliage scatter, and composable generator pipelines stored as codec recipes.",
});
