// A world as data: its settings (every scope's values and locks) and its
// snapshot (world.snapshot(), v2) -- everything the simulation needs to go on
// exactly, so every number is lossless: integers and short decimals in few
// bits, the rest as the float32 or float64 they are. The parts the world
// keeps as free JSON (a system's state, a brain's mind, a body, an
// animator's save, the camera) are dyn(): self-described, keys and strings
// through the document's table, so the thousandth "pos" costs a few bits.

import { array, bool, constant, dyn, map, named, nullable, num, optional, ref, string, struct, tuple, uint, varuint } from "../schema.ts";
import type { Infer } from "../schema.ts";
import { seedText } from "./common.ts";
import { ENTITY_MAKE } from "./look.ts";
import { PARTICLE_STATE } from "./particles.ts";

/** One scope's values: { key: value | { value, lock, note } } (config's LayerValues), in its own order. */
export const SETTINGS_LAYER = map(ref("settings"), dyn(), { order: "kept" });
/** Settings as world.settings.toJSON() writes them: every scope that holds anything. */
export const SETTINGS = named("keel/world/settings", struct({
  scopes: map(ref("scopes"), SETTINGS_LAYER, { order: "kept" }),
}), { doc: "A world's settings: scopes (engine, project, scene, seed, runtime, tag:*, id:*, seed:*), their values and locks." });

const EntitySnapshot = struct({
  id: ref("ids"),
  tags: array(ref("tags")),
  make: ENTITY_MAKE,
  materials: map(ref("roles"), ref("mats"), { order: "kept" }),
  brain: nullable(ref("brains")),
  mind: dyn(),
  intent: dyn(),
  hold: dyn(),
  frozen: bool(),
  hasBody: bool(),
  tuning: dyn(),
  body: dyn(),
  heldKey: optional(ref("clips")),
  anim: dyn(),
}, { open: true });

/** world.snapshot() (v2), exactly. */
export const WORLD_SNAPSHOT = named("keel/world/snapshot", struct({
  v: constant(2),
  seed: seedText,
  steps: varuint({ k: 8 }),
  time: num(),
  target: tuple([uint(16), uint(16)]),
  settings: SETTINGS,
  layout: string(),
  state: dyn(),
  rngs: map(ref("rngs"), varuint({ k: 4 }), { order: "kept" }),
  intent: dyn(),
  input: struct({ driver: nullable(ref("drivers")), idleFor: num() }),
  player: nullable(ref("ids")),
  focus: nullable(ref("ids")),
  entities: array(EntitySnapshot),
  particles: array(PARTICLE_STATE),
  camera: dyn(),
  systems: map(ref("systems"), dyn(), { order: "kept" }),
}, { open: true }), { doc: "A world's snapshot: everything the simulation needs to go on exactly (world.restore takes it back)." });
export type WorldSnapshotRecord = Infer<typeof WORLD_SNAPSHOT>;
