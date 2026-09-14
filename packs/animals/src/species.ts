// One of the catalogue's four-legged species as this pack's entity: the
// catalogue's build and sockets (speciesEntity), with the choices that matter
// for it surfaced -- coat, ears, tail, size... -- and only those pinnable.
// (The catalogue lists every choice for every kind; a dog has no trousers.)

import { choicesFor, groupsFor, speciesEntity } from "@keel-engine/entity";
import type { ChoiceName, EntitySpec, Species } from "@keel-engine/entity";
import { defineEntity } from "@keel-engine/runtime";
import type { Choice, EntityDef, Pins } from "@keel-engine/runtime";

export interface AnimalOptions {
  readonly title: string;
  readonly tags?: readonly string[];
  /** The catalogue choices this animal surfaces (each with the catalogue's options for its species). */
  readonly choices: readonly ChoiceName[];
  /** The world size a pin may set: shoulder height, in metres. Unpinned, the species' own (times its height and legs). */
  readonly size: readonly [number, number];
}

// (Pins every entity takes besides its surfaced choices: a token's seed, and the fur colour -- a colour, not a list.)
const ALWAYS = new Set(["seed", "size", "furColour"]);

export function animal(species: Species, opts: AnimalOptions): EntityDef<EntitySpec> {
  const base = speciesEntity("animal", species, { title: opts.title, tags: opts.tags ?? ["animal", species] });
  const all = choicesFor("animal", species);
  const choices: Record<string, Choice> = {};
  for (const name of opts.choices) {
    const c = all[name];
    if (!c) throw new TypeError(`${species}: the catalogue has no choice "${name}".`);
    choices[name] = c;
  }
  choices["size"] = { range: opts.size };
  const [lo, hi] = opts.size;
  return defineEntity<EntitySpec>({
    id: base.id,
    body: base.body,
    title: opts.title,
    ...(base.tags ? { tags: base.tags } : {}),
    choices,
    // (Shape choices change the body a bake is cached by; look choices -- coverage, a coat's markings -- and the
    // roles are painted at draw time: see keel/entity's groupsFor.)
    ...groupsFor("animal", choices),
    build(S, pins: Pins) {
      for (const name of Object.keys(pins)) {
        if (!ALWAYS.has(name) && !Object.hasOwn(choices, name)) throw new TypeError(`${base.id}: "${name}" isn't one of its choices (${Object.keys(choices).join(", ")}).`);
      }
      const size = pins["size"];
      if (size !== undefined && (typeof size !== "number" || !(size >= lo && size <= hi))) throw new RangeError(`${base.id}: size ${String(size)} is outside ${lo}..${hi}.`);
      return base.build(S, pins);
    },
    sockets: base.sockets,
  });
}
