// Worldgen's stored forms, as bit-codec schemas (the KEEL build lists every
// named schema this file exports in keel/worldgen's manifest, bytes embedded;
// module.ts declares the same entries itself, so a tool reading the manifest
// resolves them without running anything):
//
//   keel/worldgen/recipe    a generator pipeline (WorldRecipe)
//   keel/worldgen/biomes    a biome table (BiomeDef[])
//   keel/worldgen/tileset   an imported tileset's rules
//   keel/worldgen/rooms     room templates for the stitched dungeon
export { BIOME_TABLE, ROOM_TEMPLATES_SCHEMA, TILESET_RULES, WORLD_RECIPE } from "./schema.ts";
