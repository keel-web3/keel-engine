// The catalogue's species as runtime entities: defineEntity definitions a pack
// can list, each providing its standard body contract, with its choices, a
// build from a stream and pins, and its sockets.
//
//   const cat = speciesEntity("animal", "cat");          // id "cat", body "body/quadruped@1.0.0"
//   export const pack = definePack({ entities: speciesEntities("animal"), attributes: [...] });
//
// build(S, pins): the entity's seed comes from S (four 16-bit draws), or from
// pins.seed when a token names one -- and then every choice draws from its own
// stream off that seed, exactly as entityOf does, so pins never reshuffle the
// rest. pins.size sets the world size (height on two legs, shoulder height on
// four); every other pin is a choice from CHOICES.

import { defineEntity } from "@keel-engine/runtime";
import type { Choice, EntityDef, LookDef, Pins, RoleSpec, Stream } from "@keel-engine/runtime";
import { contractOf, socketsOf } from "./bodies.ts";
import { CHOICES, SPECIES, entityOf } from "./species.ts";
import type { ChoiceValues, EntityPins, EntitySpec, Kind, Species } from "./species.ts";

export interface SpeciesEntityOptions {
  /** Default: the species on four legs ("cat"), "anthro-" + it on two ("anthro-cat"), a person "human". */
  readonly id?: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  /** Its world size unless pins.size says otherwise (default: the species'). */
  readonly size?: number;
}

/** The id speciesEntity gives a species of a kind. */
export const speciesId = (kind: Kind, species: Species): string => (kind === "anthro" ? `anthro-${species}` : species);

/** A seed from a stream: four 16-bit draws, as hex. */
export function seedFromStream(S: Pick<Stream, "f">): string {
  let hex = "0x";
  for (let i = 0; i < 4; i += 1) hex += Math.floor(S.f() * 65536).toString(16).padStart(4, "0");
  return hex;
}

/** The choices an entity of this kind and species offers, as the editor lists them (the kind and species are its own). */
export function choicesFor(kind: Kind, species: Species): Record<string, Choice> {
  const made = { kind, species } as ChoiceValues;
  const out: Record<string, Choice> = {};
  for (const ch of CHOICES) {
    if (ch.name === "kind" || ch.name === "species") continue;
    if (ch.range) { out[ch.name] = { range: ch.range }; continue; }
    const opts = ch.optionsOf ? ch.optionsOf(made) : ch.options;
    // (Colours are drawn from the species' tables; they're pinnable, but not listed as a choice.)
    if (opts) out[ch.name] = opts as readonly (string | number | boolean)[];
  }
  return out;
}

// The choices that only move roles between parts -- which parts a top, trousers or shoes cover, where a coat's
// markings go -- never geometry: a look's, applied at draw time (one baked body wears them all).
export const LOOK_CHOICES: readonly string[] = ["top", "pants", "shoes", "coat"];

/**
 * The roles a character's parts carry, in order of how much of it they cover (the first leads its look's
 * harmony): a person is mostly clothes and skin, an anthro clothes and fur, an animal its fur.
 */
export function rolesFor(kind: Kind): Readonly<Record<string, RoleSpec>> {
  if (kind === "humanoid") return { cloth: { stuff: "cloth" }, clothAlt: { stuff: "cloth" }, fur: { stuff: "skin" }, hair: { stuff: "hair" }, accent: { stuff: "paint" }, furAlt: { stuff: "skin" }, dark: { stuff: "dark" }, blush: { stuff: "blush" } };
  if (kind === "anthro") return { cloth: { stuff: "cloth" }, fur: { stuff: "fur" }, clothAlt: { stuff: "cloth" }, furAlt: { stuff: "fur" }, accent: { stuff: "paint" }, hair: { stuff: "hair" }, dark: { stuff: "dark" }, blush: { stuff: "blush" } };
  return { fur: { stuff: "fur" }, furAlt: { stuff: "fur" }, accent: { stuff: "leather" }, dark: { stuff: "dark" }, blush: { stuff: "blush" } };
}

/** Shape and look groups for a set of choices: the look choices among them, and the rest. */
export function groupsFor(kind: Kind, choices: Readonly<Record<string, Choice>>): { shape: string[]; look: LookDef } {
  // (Four legs wear no outfit: only a coat's markings move there.)
  const looks = kind === "animal" ? ["coat"] : LOOK_CHOICES;
  const names = Object.keys(choices);
  return { shape: names.filter((n) => !LOOK_CHOICES.includes(n)), look: { roles: rolesFor(kind), choices: names.filter((n) => looks.includes(n)) } };
}

/** One species of one kind as a runtime entity. */
export function speciesEntity(kind: Kind, species: Species, opts: SpeciesEntityOptions = {}): EntityDef<EntitySpec> {
  if (!SPECIES[kind].some(([s]) => s === species)) throw new RangeError(`No ${kind} ${species} (${SPECIES[kind].map(([s]) => s).join(", ")}).`);
  const plan = kind === "animal" ? "quadruped" : "humanoid";
  return defineEntity<EntitySpec>({
    id: opts.id ?? speciesId(kind, species),
    body: contractOf({ plan }).ref,
    title: opts.title ?? (kind === "anthro" ? `${species} (anthro)` : species),
    tags: opts.tags ?? [kind, species],
    choices: choicesFor(kind, species),
    ...groupsFor(kind, choicesFor(kind, species)),
    build(S: Stream, pins: Pins): EntitySpec {
      const { seed, size, kind: k, species: sp, ...rest } = pins as Record<string, unknown>;
      if (k !== undefined && k !== kind) throw new RangeError(`${species}: the kind is ${kind} (pinned ${String(k)}).`);
      if (sp !== undefined && sp !== species) throw new RangeError(`This entity is a ${species} (pinned ${String(sp)}).`);
      const s = seed !== undefined ? String(seed) : seedFromStream(S);
      const sz = typeof size === "number" ? size : opts.size;
      return entityOf(s, { kind, species, pins: rest as EntityPins, size: sz });
    },
    sockets: socketsOf,
  });
}

/** Every species of a kind (or of every kind) as runtime entities. */
export function speciesEntities(kind?: Kind): EntityDef<EntitySpec>[] {
  const kinds: readonly Kind[] = kind ? [kind] : ["humanoid", "anthro", "animal"];
  return kinds.flatMap((k) => SPECIES[k].map(([s]) => speciesEntity(k, s)));
}
