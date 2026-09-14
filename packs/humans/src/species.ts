// One of the catalogue's two-legged characters as this pack's entity: a person
// or an anthro animal (an animal's head, ears, tail and snout on a person's
// body), with the choices that matter for it surfaced -- hair, outfit, ears,
// coat, tail, size... -- and only those pinnable.

import { ANTHRO_H, choicesFor, groupsFor, speciesEntity } from "@keel-engine/entity";
import type { ChoiceName, EntitySpec, Species } from "@keel-engine/entity";
import { defineEntity } from "@keel-engine/runtime";
import type { Choice, EntityDef, Pins } from "@keel-engine/runtime";

export interface CharacterOptions {
  readonly title: string;
  readonly tags?: readonly string[];
  /** The catalogue choices it surfaces (each with the catalogue's options for its species). */
  readonly choices: readonly ChoiceName[];
  /** The world size a pin may set: total height in metres. Unpinned, the species' own (times its height choice). */
  readonly size: readonly [number, number];
}

// (Pins every character takes besides its surfaced choices: a token's seed, and its colours -- not lists.)
const ALWAYS = new Set(["seed", "size", "furColour", "outfitColour", "hairColour"]);
const OUTFIT: readonly ChoiceName[] = ["top", "hood", "pants", "shoes", "pack", "accessory"];
const BUILD: readonly ChoiceName[] = ["height", "head", "legs", "arms", "girth", "stride"];

function character(kind: "humanoid" | "anthro", species: Species, opts: CharacterOptions): EntityDef<EntitySpec> {
  const base = speciesEntity(kind, species, { title: opts.title, tags: opts.tags ?? [kind, species] });
  const all = choicesFor(kind, species);
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
    ...groupsFor(kind, choices),
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

/** A person: hair, outfit and build. */
export const person = (title: string, extra: readonly ChoiceName[] = []): EntityDef<EntitySpec> =>
  character("humanoid", "human", { title, tags: ["humanoid", "human", "person"], choices: ["hair", ...OUTFIT, ...BUILD, "eyes", ...extra], size: [1.5, 1.95] });

/** An anthro animal: the species' ears, coat, tail and snout, an outfit and a build; sized round the species' own height. */
export const anthro = (species: Species, title: string, face: readonly ChoiceName[]): EntityDef<EntitySpec> => {
  const h = ANTHRO_H[species] ?? 1;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return character("anthro", species, { title, tags: ["anthro", species], choices: [...face, "eyes", ...OUTFIT, ...BUILD], size: [r2(h * 0.85), r2(h * 1.15)] });
};
