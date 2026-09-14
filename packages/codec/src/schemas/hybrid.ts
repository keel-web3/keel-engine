// A population as a HYBRID record: what's stored for ten thousand units that
// are all different. Not the units -- the RECIPE they come from (the
// generator's module ids at exact versions, a seed, a count and the options),
// and only what the recipe can't say:
//
//   exceptions  which look candidate a unit took when its first one was too
//               close to an earlier unit's (sparse: ~1 unit in 9 at 10,000).
//               With them any unit is derived ALONE: unit i = candidate
//               #(exceptions[i] ?? 0) of each of its looks.
//   pins        per unit, per LAYER (body, wear, look, animation): choices
//               fixed by hand. Each layer draws from its own stream, so a pin
//               on one never moves another.
//   parts       explicit parts, as codec documents (a builder VOXELS body, an
//               OBJECT worn in a socket, imported models later), and which
//               unit's layer each replaces -- a hand-built hero body that
//               still wears seeded wearables fitted to its sockets, and walks.
//
// bake's recordOf / populationOf / unitOf make and read these. Structural
// only: the codec imports no engine package.

import { array, bytes, enumOf, fixed, map, named, optional, ref, struct, tuple, uint, varuint, withDefault } from "../schema.ts";
import type { Infer } from "../schema.ts";
import { seedText } from "./common.ts";
import { PINS, PROFILES } from "./look.ts";

/** A unit's index, each from the last one at its place in the document (sorted lists: small steps). */
const unitIndex = (k: number) => fixed(0, 2 ** 32 - 1, 1, { k, delta: true });
/** A factor in hundredths, anything else kept whole. */
const factor = fixed(0, 4, 0.01, { off: "exact" });
const share = fixed(0, 1, 0.001, { off: "exact" });

/** Where a population comes from: its generator (module ids at exact versions, the first the one that makes the cast), a seed, a count, the options. */
export const POPULATION_RECIPE = struct({
  modules: array(ref("modules"), { max: 63 }),
  /** Which of the generator's casts, when it has several. */
  cast: optional(ref("ids")),
  seed: seedText,
  count: varuint({ k: 10 }),
  shapes: withDefault(uint(6), 3),
  wear: withDefault(tuple([uint(4), uint(4)]), [1, 3]),
  threshold: withDefault(share, 0.08),
  attributeThreshold: withDefault(share, 0.03),
  steps: withDefault(uint(5), 3),
  variants: withDefault(uint(6), 6),
  /** Look options every unit shares (a team's hue, a profile, pins). */
  look: optional(struct({ team: optional(fixed(0, 360, 0.01, { off: "exact" })), profile: optional(enumOf(PROFILES, { capacity: 16 })), pins: optional(PINS) })),
}, { open: true });

/** A unit's animation variation (its own layer): gait speed and stride factors, idle style, idle phase. */
export const UNIT_ANIM = struct({
  speed: optional(factor),
  stride: optional(factor),
  idle: optional(uint(3)),
  phase: optional(fixed(0, 1, 1 / 64, { off: "exact" })),
});

/** Pins on one unit, per layer. */
export const UNIT_PINS = struct({
  unit: unitIndex(5),
  /** Body: which entity (by id), which of its body shapes, coverage choices. */
  body: optional(struct({ entity: optional(ref("ids")), body: optional(varuint()), coverage: withDefault(PINS, {}) })),
  /** Wear: the whole list (an empty list wears nothing), each an attribute and its shape variant. */
  wear: optional(array(struct({ attribute: ref("ids"), variant: optional(varuint()) }), { max: 15 })),
  /** Look pins on its body's look (core's lookOf pins: "profile", "hue", "cloth.hue"...). */
  look: optional(PINS),
  /** The same for what it wears, by attribute id. */
  wearLooks: optional(map(ref("ids"), PINS)),
  anim: optional(UNIT_ANIM),
}, { open: true });

/** Re-rolls: which candidate each of a unit's looks took (0 is left out). */
export const UNIT_EXCEPTION = struct({
  unit: unitIndex(3),
  look: withDefault(varuint(), 0),
  /** By attribute id: the candidate its look took. */
  wears: withDefault(map(ref("ids"), varuint()), {}),
});

/** An explicit part replacing a unit's layer: its body, or what sits in one socket. */
export const UNIT_PART = struct({
  unit: unitIndex(5),
  layer: enumOf(["body", "wear"], { capacity: 8 }),
  /** Index into `parts`. */
  part: varuint(),
  /** A worn part: its socket. */
  slot: optional(ref("sockets")),
});

/** A population as recipe + exceptions + pins + explicit parts (see the top). */
export const HYBRID_POPULATION = named("keel/population/hybrid", struct({
  recipe: POPULATION_RECIPE,
  exceptions: array(UNIT_EXCEPTION),
  pins: array(UNIT_PINS),
  /** Explicit parts: codec documents (their header names their schema). */
  parts: array(bytes()),
  explicit: array(UNIT_PART),
}, { open: true }), { doc: "A population stored as its recipe, its look re-rolls, per-unit pins by layer and explicit parts." });
export type HybridRecord = Infer<typeof HYBRID_POPULATION>;
export type UnitPinsRecord = Infer<typeof UNIT_PINS>;
export type UnitExceptionRecord = Infer<typeof UNIT_EXCEPTION>;
