// Hybrid records: a population stored as what makes it, not as its units.
// Ten thousand units that are all different cost a recipe (the generator's
// module ids at exact versions, a seed, a count, the options), the look
// re-rolls a unit alone can't know (the exceptions: sparse), pins per unit
// and layer, and explicit parts (codec documents: a builder VOXELS body, an
// OBJECT in a socket) -- all in @keel-engine/codec's HYBRID_POPULATION.
//
//   const gen = { modules: ["games/mine@1.0.0", "packs/humans@1.0.0", ...], cast: () => ({ entities, attributes }) };
//   const pop = populate(generatorOptions(gen, seed, 10000));
//   const rec = recordOf(pop, pins, explicit);    // the record (the batch re-runs if pins or parts changed)
//   const bytes = recordBytes(rec);                // what's stored (JSON: toJSON(HYBRID_POPULATION, rec), the readable view)
//   populationOf(bytes, { generators: [gen] })     // the same units as the batch, no look pool
//   unitOf(bytes, 4711, { generators: [gen] })     // one of them, alone
//
// A record names its generator; populationOf finds it among the generators
// given (or registered: registerGenerator) and refuses one at another version
// -- a pack's code is part of what its units are. Explicit parts are read
// back by part readers, matched by their document's schema: bake reads an
// OBJECT worn in a socket itself; the builder gives a reader for its VOXELS
// bodies (voxelBodyReader).

import { HYBRID_POPULATION, OBJECT, decode, encode, readHeader, shortId } from "@keel-engine/codec";
import type { HybridRecord, ObjectRecord, Type, UnitPinsRecord } from "@keel-engine/codec";
import type { AttributeShape, Role } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import type { AttributeDef, Pins } from "@keel-engine/runtime";
import { populate, populateShapes, populationUnit } from "./population.ts";
import type { ExplicitBody, ExplicitWear, LoneUnit, PopAnim, PopExceptions, Population, PopulationOptions, PopulationShapes, UnitExplicit, UnitPins } from "./population.ts";

/** A population's cast and options, but for what a record says (seed, count, pins, parts, re-rolls). */
export type CastOptions = Omit<PopulationOptions, "seed" | "count" | "pins" | "explicit" | "exceptions" | "recipe">;

/** What a record's recipe names: the module that makes the cast, and every pack it draws from -- "id@version", exact. */
export interface PopulationGenerator {
  /** "id@version" each; the first is the generator itself (a record is matched to it by that), the rest the packs it draws from. */
  readonly modules: readonly string[];
  /** Its cast (by name, when it has more than one). */
  cast(name?: string): CastOptions;
}

/** Reads an explicit part's document back: matched by the schema its header names. */
export interface PartReader {
  readonly schema: Type<unknown>;
  /** A body (a unit's body layer). */
  body?(doc: Uint8Array): ExplicitBody;
  /** A thing worn in a socket (a unit's wear layer, in that socket). */
  wear?(doc: Uint8Array, slot: string): ExplicitWear;
}

export interface HybridEnv {
  readonly generators?: readonly PopulationGenerator[];
  readonly parts?: readonly PartReader[];
}

// ---------------------------------------------------------------- registries (a game module registers its generator at load)

const generators: PopulationGenerator[] = [];
const readers: PartReader[] = [];
/** A generator populationOf finds by itself (a game's module registers its own at load). */
export function registerGenerator(g: PopulationGenerator): void { if (!generators.includes(g)) generators.push(g); }
/** A part reader populationOf uses by itself (the builder's voxel bodies, say). */
export function registerPartReader(r: PartReader): void { if (!readers.includes(r)) readers.push(r); }

/** A generator's population options: its cast, a seed and a count (and pins, explicit parts), with its recipe. */
export function generatorOptions(gen: PopulationGenerator, seed: string, count: number, { cast, pins, explicit }: { readonly cast?: string; readonly pins?: ReadonlyMap<number, UnitPins>; readonly explicit?: ReadonlyMap<number, UnitExplicit> } = {}): PopulationOptions {
  return {
    ...gen.cast(cast), seed, count,
    ...(pins ? { pins } : {}), ...(explicit ? { explicit } : {}),
    recipe: { modules: [...gen.modules], ...(cast !== undefined ? { cast } : {}) },
  };
}

// ---------------------------------------------------------------- OBJECT parts: worn as they are

// (A part's role, as a wearable's look knows it: any other name wears primary.)
const WEAR_ROLES = new Set<string>(["fur", "furAlt", "cloth", "clothAlt", "accent", "dark", "blush", "hair", "skin", "eye", "primary", "secondary", "trim", "detail", "glow", "metal"]);
const roleOf = (r: string | undefined): Role => (r !== undefined && WEAR_ROLES.has(r) ? (r as Role) : "primary");

/** An object definition (codec's OBJECT) as a thing worn in a socket: its prims, in metres, in the socket's frame. */
export function objectWear(rec: ObjectRecord, slot: string): AttributeDef<AttributeShape> {
  const design: AttributeShape = {
    capsules: rec.parts.flatMap((p) => (p.render !== false && p.shape.type === "capsule" ? [{ a: [...p.shape.a] as const, b: [...p.shape.b] as const, r: p.shape.r, role: roleOf(p.role), ...(p.name ? { part: p.name } : {}) }] : [])),
    boxes: rec.parts.flatMap((p) => (p.render !== false && p.shape.type !== "capsule" ? [{ c: [...p.shape.c] as const, h: [...p.shape.h] as const, yaw: p.shape.yaw, role: roleOf(p.role), ...(p.name ? { part: p.name } : {}) }] : [])),
  };
  const id = `object-${rec.key.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "part"}`;
  return defineAttribute<AttributeShape>({ id, slot, targets: [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1" }], build: () => design });
}
/** bake's own part reader: an OBJECT document worn in a socket. */
export const OBJECT_PART: PartReader = { schema: OBJECT, wear: (doc, slot) => ({ def: objectWear(decode(OBJECT, doc), slot), doc }) };

// ---------------------------------------------------------------- population -> record

const pinValues = (p: Pins | undefined, what: string): Record<string, string | boolean | number> => {
  const out: Record<string, string | boolean | number> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v === undefined) continue;
    if (typeof v !== "string" && typeof v !== "boolean" && typeof v !== "number") throw new TypeError(`${what}: pin ${k} is ${JSON.stringify(v)}; a stored pin is a name, a flag or a number.`);
    out[k] = v;
  }
  return out;
};

function pinsRecord(unit: number, p: UnitPins): UnitPinsRecord {
  const what = `Unit ${unit}`;
  const anim = p.anim ? Object.fromEntries(Object.entries(p.anim).filter(([, v]) => v !== undefined)) as UnitPinsRecord["anim"] : undefined;
  return {
    unit,
    ...(p.body ? { body: { ...(p.body.entity !== undefined ? { entity: p.body.entity } : {}), ...(p.body.body !== undefined ? { body: p.body.body } : {}), coverage: pinValues(p.body.coverage, what) } } : {}),
    ...(p.wear ? { wear: p.wear.map((w) => ({ attribute: w.attribute, ...(w.variant !== undefined ? { variant: w.variant } : {}) })) } : {}),
    ...(p.look ? { look: pinValues(p.look, what) } : {}),
    ...(p.wearLooks ? { wearLooks: Object.fromEntries(Object.entries(p.wearLooks).map(([k, v]) => [k, pinValues(v, what)])) } : {}),
    ...(anim ? { anim } : {}),
  };
}

/**
 * A population as a hybrid record. Pins and explicit parts default to the population's own; given others, the batch
 * runs again with them (the re-rolls are the batch's: a pinned look may crowd another unit's). Every explicit part
 * must carry the document it was read from (`doc`).
 */
export function recordOf(population: Population, pins: ReadonlyMap<number, UnitPins> | undefined = population.options.pins, explicit: ReadonlyMap<number, UnitExplicit> | undefined = population.options.explicit): HybridRecord {
  const o = population.options;
  if (!o.recipe) throw new TypeError("This population carries no recipe (its generator's modules at exact versions): make its options with generatorOptions(), or give options.recipe.");
  let pop = population;
  if (pins !== o.pins || explicit !== o.explicit) {
    const { exceptions: _drop, pins: _p, explicit: _e, ...rest } = o;
    pop = populate({ ...rest, ...(pins ? { pins } : {}), ...(explicit ? { explicit } : {}) });
  }
  const look = o.look ? { ...(o.look.team !== undefined ? { team: o.look.team } : {}), ...(o.look.profile !== undefined ? { profile: o.look.profile } : {}), ...(o.look.pins ? { pins: pinValues(o.look.pins, "The population's look") } : {}) } : undefined;
  const recipe: HybridRecord["recipe"] = {
    modules: [...o.recipe.modules], ...(o.recipe.cast !== undefined ? { cast: o.recipe.cast } : {}),
    seed: o.seed, count: o.count, shapes: o.shapes ?? 3, wear: [o.wear?.[0] ?? 1, o.wear?.[1] ?? 3], threshold: o.threshold ?? 0.08,
    attributeThreshold: o.attributeThreshold ?? 0.03, steps: o.steps ?? 3, variants: o.variants ?? 6, ...(look ? { look } : {}),
  };
  // The re-rolls, by unit.
  const ex = pop.exceptions;
  const units = [...new Set([...ex.look.keys(), ...ex.wears.keys()])].sort((a, b) => a - b);
  const exceptions = units.map((unit) => ({ unit, look: ex.look.get(unit) ?? 0, wears: Object.fromEntries(ex.wears.get(unit) ?? []) }));
  // Explicit parts: each document once.
  const parts: Uint8Array[] = [];
  const partKey = new Map<string, number>();
  const partOf = (doc: Uint8Array | undefined, unit: number): number => {
    if (!doc) throw new TypeError(`Unit ${unit}: an explicit part without its document (doc) can't be stored.`);
    const key = Array.prototype.join.call(doc, ",");
    let at = partKey.get(key);
    if (at === undefined) { at = parts.length; parts.push(doc); partKey.set(key, at); }
    return at;
  };
  const explicitList: HybridRecord["explicit"][number][] = [];
  for (const [unit, e] of [...(explicit ?? [])].sort((a, b) => a[0] - b[0])) {
    if (e.body) explicitList.push({ unit, layer: "body", part: partOf(e.body.doc, unit) });
    for (const w of e.wears ?? []) explicitList.push({ unit, layer: "wear", part: partOf(w.doc, unit), slot: w.def.slot });
  }
  return {
    recipe, exceptions,
    pins: [...(pins ?? [])].sort((a, b) => a[0] - b[0]).map(([unit, p]) => pinsRecord(unit, p)),
    parts, explicit: explicitList,
  };
}

/**
 * The record of a population's first `count` units. A unit's re-rolls only ever look back (the pools hold earlier
 * units), so a smaller population is the larger one's first units exactly: one stored record serves every size up to
 * its own -- its exceptions, pins and parts cut to the units kept.
 */
export function recordPrefix(record: HybridRecord, count: number): HybridRecord {
  if (!(Number.isInteger(count) && count >= 0 && count <= record.recipe.count)) throw new RangeError(`A record of ${record.recipe.count} units has no first ${count}.`);
  if (count === record.recipe.count) return record;
  const explicit = record.explicit.filter((e) => e.unit < count);
  const used = [...new Set(explicit.map((e) => e.part))].sort((a, b) => a - b);
  const at = new Map(used.map((p, i) => [p, i]));
  return {
    recipe: { ...record.recipe, count },
    exceptions: record.exceptions.filter((e) => e.unit < count),
    pins: record.pins.filter((p) => p.unit < count),
    parts: used.map((p) => record.parts[p]!),
    explicit: explicit.map((e) => ({ ...e, part: at.get(e.part)! })),
  };
}

/** A record as stored: its codec document. */
export const recordBytes = (record: HybridRecord): Uint8Array => encode(HYBRID_POPULATION, record);
/** A stored record back. */
export const readRecord = (bytes: Uint8Array): HybridRecord => decode(HYBRID_POPULATION, bytes);

// ---------------------------------------------------------------- record -> population

// (Per record: the envs it was read with -- by what they hold, not by the object: a call site may make a fresh one each time.)
const optionsMemo = new WeakMap<object, { readonly env: HybridEnv; readonly options: PopulationOptions }[]>();
const sameList = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean => (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => x === b![i]);

/** The population options a record stands for (its generator's cast, the record's seed, count, options, pins, parts, re-rolls). Cached per record and env. */
export function optionsOf(record: HybridRecord | Uint8Array, env: HybridEnv = {}): PopulationOptions {
  const memo = optionsMemo.get(record) ?? optionsMemo.set(record, []).get(record)!;
  const had = memo.find((m) => sameList(m.env.generators, env.generators) && sameList(m.env.parts, env.parts));
  if (had) return had.options;
  const r = record instanceof Uint8Array ? readRecord(record) : record;
  const { recipe } = r;
  const pool = [...(env.generators ?? []), ...generators];
  const gen = pool.find((g) => g.modules[0] === recipe.modules[0]);
  if (!gen) throw new RangeError(`No generator for ${recipe.modules[0] ?? "(none)"}: give it (populationOf(record, { generators })) or register it (registerGenerator).`);
  const wanted = recipe.modules.join(", "), have = gen.modules.join(", ");
  if (wanted !== have) throw new RangeError(`This record was made with ${wanted}; the generator is ${have}. Another version's units may differ: regenerate the record with it.`);
  const cast = gen.cast(recipe.cast);
  // Explicit parts, read back by their schemas.
  const partReaders = [...(env.parts ?? []), ...readers, OBJECT_PART];
  const readerOf = (doc: Uint8Array): PartReader => {
    const id = readHeader(doc).id;
    const found = partReaders.find((p) => shortId(p.schema) === id);
    if (!found) throw new RangeError(`An explicit part is written with schema ${id ?? "(no header)"}, and no part reader reads it (the builder's voxelBodyReader reads VOXELS bodies).`);
    return found;
  };
  const explicit = new Map<number, { body?: ExplicitBody; wears: ExplicitWear[] }>();
  for (const e of r.explicit) {
    const doc = r.parts[e.part];
    if (!doc) throw new RangeError(`Unit ${e.unit}: part ${e.part} of ${r.parts.length}.`);
    const reader = readerOf(doc);
    const slot = explicit.get(e.unit) ?? explicit.set(e.unit, { wears: [] }).get(e.unit)!;
    if (e.layer === "body") {
      if (!reader.body) throw new RangeError(`Unit ${e.unit}: its body part's reader reads no bodies.`);
      const b = reader.body(doc);
      slot.body = b.doc ? b : { ...b, doc };
    } else {
      if (!reader.wear || e.slot === undefined) throw new RangeError(`Unit ${e.unit}: a worn part needs a reader that reads worn things, and its socket.`);
      const w = reader.wear(doc, e.slot);
      slot.wears.push(w.doc ? w : { ...w, doc });
    }
  }
  const pins = new Map<number, UnitPins>(r.pins.map((p): [number, UnitPins] => [p.unit, {
    ...(p.body ? { body: { ...(p.body.entity !== undefined ? { entity: p.body.entity } : {}), ...(p.body.body !== undefined ? { body: p.body.body } : {}), ...(Object.keys(p.body.coverage).length ? { coverage: p.body.coverage } : {}) } } : {}),
    ...(p.wear ? { wear: p.wear.map((w) => ({ attribute: w.attribute, ...(w.variant !== undefined ? { variant: w.variant } : {}) })) } : {}),
    ...(p.look ? { look: p.look } : {}),
    ...(p.wearLooks ? { wearLooks: p.wearLooks } : {}),
    ...(p.anim ? { anim: Object.fromEntries(Object.entries(p.anim).filter(([, v]) => v !== undefined)) as Partial<PopAnim> } : {}),
  }]));
  const exceptions: PopExceptions = {
    look: new Map(r.exceptions.filter((e) => e.look > 0).map((e) => [e.unit, e.look])),
    wears: new Map(r.exceptions.filter((e) => Object.keys(e.wears).length).map((e) => [e.unit, new Map(Object.entries(e.wears))])),
  };
  const { look: _castLook, ...castRest } = cast;
  const look = recipe.look ? { ...(recipe.look.team !== undefined ? { team: recipe.look.team } : {}), ...(recipe.look.profile !== undefined ? { profile: recipe.look.profile } : {}), ...(recipe.look.pins ? { pins: recipe.look.pins } : {}) } : undefined;
  const options: PopulationOptions = {
    ...castRest, seed: recipe.seed, count: recipe.count, shapes: recipe.shapes, wear: [recipe.wear[0], recipe.wear[1]], threshold: recipe.threshold,
    attributeThreshold: recipe.attributeThreshold, steps: recipe.steps, variants: recipe.variants, ...(look ? { look } : {}),
    ...(pins.size ? { pins } : {}),
    ...(explicit.size ? { explicit: new Map([...explicit].map(([u, e]): [number, UnitExplicit] => [u, { ...(e.body ? { body: e.body } : {}), ...(e.wears.length ? { wears: e.wears } : {}) }])) } : {}),
    exceptions,
    recipe: { modules: [...recipe.modules], ...(recipe.cast !== undefined ? { cast: recipe.cast } : {}) },
  };
  memo.push({ env: { ...(env.generators ? { generators: [...env.generators] } : {}), ...(env.parts ? { parts: [...env.parts] } : {}) }, options });
  return options;
}

/** Every unit a record stands for: the batch's population, looks from the re-rolls (no pool). */
export const populationOf = (record: HybridRecord | Uint8Array, env?: HybridEnv): Population => populate(optionsOf(record, env));
/** A record's shapes and who wears what, no looks yet (what a scene and a bake need first). */
export const shapesOf = (record: HybridRecord | Uint8Array, env?: HybridEnv): PopulationShapes => populateShapes(optionsOf(record, env));
/** Unit i of a record, alone: equal to the batch's unit i. */
export const unitOf = (record: HybridRecord | Uint8Array, i: number, env?: HybridEnv): LoneUnit => populationUnit(optionsOf(record, env), i);
