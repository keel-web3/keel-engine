// The engine's own schemas: objects and placements, looks and pins and
// populations, world settings and snapshots, particle saves, script blocks
// and bytecode, music recipes and songs and sfx settings, the builder's voxels
// and op lists, hybrid population records. See README "Engine schemas" for
// why they live here.

export { coord, dhalf3, dir3, dvec3, half3, id, local, localDelta, lvec3, oklch, seedAny, seedText, signed, size, sizeDelta, unit, vec3, yaw } from "./common.ts";
export { OBJECT, OBJECT_COLLIDER, OBJECT_PART, OBJECT_SOCKET, PLACED, mm, objectRecordOf, objectSpecOf, placedRecordOf } from "./object.ts";
export type { InstanceLike, ObjectDefLike, ObjectRecord, PlacedRecord } from "./object.ts";
export {
  ATTRIBUTE_PIN, ENTITY_MAKE, ENTITY_PINS, FINISHES, LOOK, LOOK_ROLES, PATTERNS, PINS, PIN_ANY, POPULATION, PROFILES, ROLE_LOOK,
  lookOfRecord, lookRecordOf, populationRecordOf,
} from "./look.ts";
export type { LookLike, LookRecord, PopulationLike, PopulationRecord } from "./look.ts";
export { SETTINGS, SETTINGS_LAYER, WORLD_SNAPSHOT } from "./world.ts";
export type { WorldSnapshotRecord } from "./world.ts";
export { PARTICLES, PARTICLE_POOL, PARTICLE_STATE } from "./particles.ts";
export type { ParticlePoolRecord } from "./particles.ts";
export { ARITH, BLOCKS, BYTECODE, COMPARE, EVENTS, EXPR, INSTR, LOGIC, OPS, STMT, compileScript, createScriptVM, decompileScript } from "./script.ts";
export type { Blocks, Bytecode, Expr, Handler, Instr, OpName, Script, ScriptHost, ScriptVM, Stmt } from "./script.ts";
export {
  BAND_INPUT, MOOD, MOOD_SPEC, MUSIC_PINS, MUSIC_RECIPE, SFX_SETTINGS, SFX_STYLE, SONG, diatonic, moodOfRecipe, planOfSong, recipeOfMood, songOf,
  BACKBEATS, BASS_NAMES, BASS_STYLES, COMPS, KEYS_NAMES, KIT_NAMES, LEAD_NAMES, LOOP_NAMES, MODE_NAMES, MODE_STEPS, ROOM_KINDS, SECTIONS, SFX_NAMES, SPREADS,
  STYLE_NAMES, SURFACES, WEATHER_KINDS,
} from "./audio.ts";
export type { BandTables, MusicRecipe, SfxSettings, Song } from "./audio.ts";
export { VOXELS, opListSchema, voxelRecordOf } from "./voxel.ts";
export { HYBRID_POPULATION, POPULATION_RECIPE, UNIT_ANIM, UNIT_EXCEPTION, UNIT_PART, UNIT_PINS } from "./hybrid.ts";
export type { HybridRecord, UnitExceptionRecord, UnitPinsRecord } from "./hybrid.ts";
export type { OpFieldType, OpTable, VoxelModelLike, VoxelRecord } from "./voxel.ts";

import type { Registry } from "../document.ts";
import { OBJECT, PLACED } from "./object.ts";
import { ATTRIBUTE_PIN, ENTITY_MAKE, LOOK, POPULATION } from "./look.ts";
import { SETTINGS, WORLD_SNAPSHOT } from "./world.ts";
import { PARTICLES, PARTICLE_POOL } from "./particles.ts";
import { BLOCKS, BYTECODE } from "./script.ts";
import { MUSIC_RECIPE, SFX_SETTINGS, SONG } from "./audio.ts";
import { VOXELS } from "./voxel.ts";
import { HYBRID_POPULATION } from "./hybrid.ts";
import { SCHEMA_SCHEMA } from "../canonical.ts";

/** Every engine schema, by its name. */
export const ENGINE_SCHEMAS = {
  "keel/codec/schema": SCHEMA_SCHEMA,
  "keel/object": OBJECT, "keel/object/placed": PLACED,
  "keel/look": LOOK, "keel/entity/make": ENTITY_MAKE, "keel/attribute/pin": ATTRIBUTE_PIN, "keel/population": POPULATION, "keel/population/hybrid": HYBRID_POPULATION,
  "keel/world/settings": SETTINGS, "keel/world/snapshot": WORLD_SNAPSHOT,
  "keel/particles/save": PARTICLES, "keel/particles/pool": PARTICLE_POOL,
  "keel/script/blocks": BLOCKS, "keel/script/bytecode": BYTECODE,
  "keel/audio/recipe": MUSIC_RECIPE, "keel/audio/song": SONG, "keel/audio/sfx": SFX_SETTINGS,
  "keel/builder/voxels": VOXELS,
} as const;

/** Register every engine schema (by id and by name@version) into a registry. */
export function registerEngineSchemas(registry: Registry): string[] {
  return Object.values(ENGINE_SCHEMAS).map((s) => registry.register(s));
}
