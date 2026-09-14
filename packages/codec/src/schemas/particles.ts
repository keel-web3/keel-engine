// Particles as data: the proof-of-concept pool's save() (a list of live
// particles, each by its recipe's name) and the smart pool's snapshot (typed
// arrays and emitter slots). Lossless: a restore must go on exactly. The
// pool's arrays keep their element types (float32s as float32s, bytes as
// bytes); its emitter slots are mostly empty, so each is run-length coded.

import { array, delta, map, named, nullable, num, ref, runs, struct, tuple, uint, varuint, float64 } from "../schema.ts";
import type { Infer } from "../schema.ts";

/** One live particle (createParticles' save(): plain data, the recipe by name). */
export const PARTICLE_STATE = struct({
  kind: ref("recipes"),
  p: tuple([num(), num(), num()]),
  v: tuple([num(), num(), num()]),
  age: num(),
  life: num(),
  size: num(),
  light: num(),
  ramp: ref("ramps"),
});
export const PARTICLES = named("keel/particles/save", array(PARTICLE_STATE), { doc: "A particle pool's save(): every live particle." });

/**
 * The smart pool's snapshot (createParticlePool().save(), format "keel-particles-pool@2"). Its per-slot arrays
 * are kept by name, every element lossless (a float32 stays a float32's bits); arrays come back as plain
 * arrays (load() takes any ArrayLike). The emitter slots are mostly empty, so each of their arrays is runs.
 */
export const PARTICLE_POOL = named("keel/particles/pool", struct({
  format: ref("formats"),
  recipes: array(ref("recipes")),
  key: uint(32),
  time: num(),
  tick: varuint({ k: 6 }),
  serial: varuint({ k: 6 }),
  wind: array(float64(), { length: 3 }),
  /** The live slots, ascending. */
  slots: delta(varuint()),
  particles: map(ref("fields"), array(num()), { order: "kept" }),
  emitters: map(ref("fields"), runs(num()), { order: "kept" }),
  sockets: runs(nullable(ref("sockets"))),
}, { open: true }), { doc: "The particle pool's snapshot: particles and emitter slots, exactly." });
export type ParticlePoolRecord = Infer<typeof PARTICLE_POOL>;
