// Entities, attributes and packs -- one typed definition each, one file each
// in a pack's source, so a character or a hat can be read in code and viewed
// in the editor.
//
// An ENTITY provides a body contract ("body/quadruped@1.0.0") and sockets;
// an ATTRIBUTE says which bodies it fits and which packs' entities it may go
// on; `fits()` decides, by these rules:
//
//   1. the entity's body contract must satisfy one of the attribute's targets;
//   2. a target may name packs -- then the entity's pack must be one of them
//      (and, unless it's the attribute's own pack, must itself agree: rule 3's
//      handshake still applies -- naming a pack doesn't make it say yes);
//   3. otherwise the entity must be from the attribute's own pack, or the two
//      packs must BOTH declare each other compatible (an entity pack can open
//      itself to every wearable with compatible: ["*"]).
//
// So a hat made for this pack's dog doesn't land on another pack's dog just
// because both are quadrupeds -- unless the packs agree to it.

import type { ModuleManifest } from "./manifest.ts";
import { satisfies, splitRef } from "./semver.ts";

/** The seeded stream builders draw from (core's streams satisfy it). */
export interface Stream {
  f(): number;
  between(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
}

/** A choice an entity or attribute makes: a list to pick from, or a numeric range. */
export type Choice = readonly (string | number | boolean)[] | readonly [number, number] | { readonly range: readonly [number, number] };
export type Pins = Readonly<Record<string, unknown>>;

/** Where something attaches on a body, in the body's own frame (+z front, +x right, +y up). */
export interface Socket {
  readonly pos: readonly [number, number, number];
  /** Which way the socket faces (its +z), as a yaw in the body's frame. */
  readonly yaw?: number;
  /** How big what sits there may be: [width, height, depth] in metres. */
  readonly size: readonly [number, number, number];
}

// ---- Shape and look
//
// A thing's choices are of two kinds. SHAPE choices change its geometry (a
// hat's brim, a flag's length, a dog's ears): what it looks like as a solid,
// so they are what a bake is cached by. LOOK choices are applied when it's
// drawn (which colour profile each role wears, a pattern, a finish; which
// parts a jacket covers): they cost nothing to change -- one baked shape
// serves every look. `shape` and `look.choices` name which of `choices` are
// which; `build` reads only shape choices (a look pin never moves a shape).
// A def without them is all shape, as before.
//
// Every part a build makes carries a ROLE (primary, secondary, trim, accent,
// detail, glow, metal, fur, skin, cloth, dark...): not a colour -- the look
// gives each role its ramp, pattern and finish when it's drawn.

/** What a role is made of and what it may wear (the look module's vocabulary: see core's look.ts). */
export interface RoleSpec {
  /** Its stuff: "cloth", "knit", "leather", "metal", "wood", "bone", "skin", "fur", "hair", "dark", "glow", "paint"... (picks its colours and finish). */
  readonly stuff?: string;
  /** Patterns it may wear ("none", "stripes", "bands", "spots", "checks", "camo", "gradient", "trim"); default: by its stuff. */
  readonly patterns?: readonly string[];
  /** Finishes it may take ("matte", "cloth", "leather", "metal", "glow"); default: by its stuff. */
  readonly finishes?: readonly string[];
  /** Wear another role's colour, a shade off (a pocket the colour of its pack). */
  readonly like?: string;
}

/** What a look fills in: the roles its parts carry (in order of how much of it they cover), and its look-only choices. */
export interface LookDef {
  readonly roles: Readonly<Record<string, RoleSpec>>;
  /** Which of `choices` are applied at draw time, not built (a jacket's coverage, a coat's markings). */
  readonly choices?: readonly string[];
}

export interface EntityDef<Design = unknown> {
  readonly type: "entity";
  readonly id: string;
  /** The body contract it provides: "body/quadruped@1.0.0", "body/humanoid@1.0.0". */
  readonly body: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly choices?: Readonly<Record<string, Choice>>;
  /** Which of `choices` change its geometry (default: every one not in look.choices). */
  readonly shape?: readonly string[];
  /** Its look: the roles its parts carry, and its draw-time choices. */
  readonly look?: LookDef;
  /** Build a design from a stream and pins (every choice draws, pinned or not, so pins never reshuffle the rest). */
  readonly build: (S: Stream, pins: Pins) => Design;
  /** Its sockets, from its design (a bigger dog has a bigger head socket). */
  readonly sockets: (design: Design) => Readonly<Record<string, Socket>>;
}

export interface AttributeTarget {
  /** A body contract range: "body/quadruped@^1". */
  readonly body: string;
  /** Only entities from these packs ("packs/animals@^1"). Without it: rule 3 of fits(). */
  readonly packs?: readonly string[];
  /** Only these entity ids (within the allowed packs). */
  readonly entities?: readonly string[];
}

export interface AttributeDef<Design = unknown> {
  readonly type: "attribute";
  readonly id: string;
  /** The socket it sits in: "head", "back", "hand.R", "neck"... */
  readonly slot: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly targets: readonly AttributeTarget[];
  readonly choices?: Readonly<Record<string, Choice>>;
  /** Which of `choices` change its geometry (default: every one not in look.choices). */
  readonly shape?: readonly string[];
  /** Its look: the roles its parts carry, and its draw-time choices. */
  readonly look?: LookDef;
  /**
   * How it's drawn on a baked entity: "own" (default) -- a rigid thing baked once per shape and socket size,
   * drawn as its own sprite layer at the socket; "body" -- baked into the wearer's frames (it bends with them: boots).
   */
  readonly layer?: "own" | "body";
  /** Build it to the socket it lands on: the same design, sized to a mouse's head or a bear's. */
  readonly build: (S: Stream, fit: Socket, pins: Pins) => Design;
}

type WithChoices = Pick<EntityDef, "id" | "choices" | "shape" | "look">;

/** The names of a def's shape choices (every choice not a look choice, unless `shape` lists them). */
export function shapeChoiceNames(def: WithChoices): string[] {
  const look = new Set(def.look?.choices ?? []);
  return def.shape ? [...def.shape] : Object.keys(def.choices ?? {}).filter((k) => !look.has(k));
}
/** The names of a def's look choices. */
export const lookChoiceNames = (def: WithChoices): string[] => [...(def.look?.choices ?? [])];

/** Pins split in two: those that change the shape (pass these to build), and look pins (the rest: roles, profile, look choices). */
export function splitPins(def: WithChoices, pins: Pins): { shape: Record<string, unknown>; look: Record<string, unknown> } {
  const look = new Set(lookChoiceNames(def));
  const shape: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pins)) (look.has(k) || k.includes(".") || k === "profile" || k === "team" ? rest : shape)[k] = v;
  return { shape, look: rest };
}

/** The values a choice may take for a cache-friendly pick: a list as it is; a range as `steps` evenly spaced values. */
export function choiceSteps(choice: Choice, steps = 3): readonly (string | number | boolean)[] {
  // (A range is { range: [lo, hi] }; an array is always a list of options.)
  if (Array.isArray(choice)) return choice as readonly (string | number | boolean)[];
  const range = (choice as { readonly range: readonly [number, number] }).range;
  const [lo, hi] = range;
  if (steps <= 1) return [(lo + hi) / 2];
  // (Rounded to 1/1000: a pin that round-trips through JSON stays the same key.)
  return Array.from({ length: steps }, (_, i) => Math.round((lo + ((hi - lo) * i) / (steps - 1)) * 1000) / 1000);
}

/**
 * Shape pins drawn from a stream on a grid -- each list choice one of its options, each range one of `steps`
 * values -- so a population reuses a few shapes (a cache hit) instead of making a new one per seed. Given pins win.
 */
export function pickShape(def: WithChoices, S: Stream, { steps = 3, pins = {} }: { steps?: number; pins?: Pins } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of shapeChoiceNames(def)) {
    const c = def.choices?.[name];
    if (!c) continue;
    const drawn = S.pick(choiceSteps(c, steps));
    out[name] = pins[name] !== undefined ? pins[name] : drawn;
  }
  return out;
}

/** Look choices drawn from a stream (each one draws, pinned or not, so a pin never moves another). */
export function pickLook(def: WithChoices, S: Stream, pins: Pins = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of lookChoiceNames(def)) {
    const c = def.choices?.[name];
    if (!c) continue;
    const drawn = S.pick(choiceSteps(c, 3));
    out[name] = pins[name] !== undefined ? pins[name] : drawn;
  }
  return out;
}

function checkGroups(kind: string, def: WithChoices): void {
  const names = new Set(Object.keys(def.choices ?? {}));
  const look = def.look?.choices ?? [];
  for (const n of [...(def.shape ?? []), ...look]) if (!names.has(n)) throw new TypeError(`${kind} ${def.id}: "${n}" is in a shape/look group but not in its choices.`);
  const both = (def.shape ?? []).filter((n) => look.includes(n));
  if (both.length) throw new TypeError(`${kind} ${def.id}: ${both.join(", ")} can't be shape and look both.`);
  for (const [role, spec] of Object.entries(def.look?.roles ?? {})) if (spec.like !== undefined && !def.look?.roles[spec.like]) throw new TypeError(`${kind} ${def.id}: role ${role} is like "${spec.like}", which it hasn't got.`);
}

// (A pack holds entities and attributes of many design shapes: collections take them erased.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEntityDef = EntityDef<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAttributeDef = AttributeDef<any>;

export interface PackDef {
  readonly entities: readonly AnyEntityDef[];
  readonly attributes: readonly AnyAttributeDef[];
}

const ASSET_ID = /^[a-z0-9][a-z0-9-]*$/;

export function defineEntity<D>(def: Omit<EntityDef<D>, "type">): EntityDef<D> {
  if (!ASSET_ID.test(def.id)) throw new TypeError(`Entity id "${def.id}": lower-case letters, digits and dashes.`);
  const { name, range } = splitRef(def.body);
  if (!name.startsWith("body/") || range.split(".").length !== 3) throw new TypeError(`Entity ${def.id}: body must be an exact contract, "body/quadruped@1.0.0" (got "${def.body}").`);
  checkGroups("Entity", def);
  return Object.freeze({ type: "entity", ...def });
}

export function defineAttribute<D>(def: Omit<AttributeDef<D>, "type">): AttributeDef<D> {
  if (!ASSET_ID.test(def.id)) throw new TypeError(`Attribute id "${def.id}": lower-case letters, digits and dashes.`);
  if (!def.targets.length) throw new TypeError(`Attribute ${def.id}: say which bodies it fits (targets).`);
  for (const t of def.targets) if (!splitRef(t.body).name.startsWith("body/")) throw new TypeError(`Attribute ${def.id}: target body "${t.body}" must be a body contract.`);
  checkGroups("Attribute", def);
  return Object.freeze({ type: "attribute", ...def });
}

/** A pack's assets, checked for duplicate ids. */
export function definePack(def: PackDef): PackDef {
  const seen = new Set<string>();
  for (const a of [...def.entities, ...def.attributes]) {
    const key = `${a.type}:${a.id}`;
    if (seen.has(key)) throw new TypeError(`The pack has two ${a.type === "entity" ? "entities" : "attributes"} called ${a.id}.`);
    seen.add(key);
  }
  return Object.freeze({ entities: Object.freeze([...def.entities]), attributes: Object.freeze([...def.attributes]) });
}

/** The table of contents a pack's manifest carries (so tools read it without running the pack). */
export function contentsOf(pack: PackDef) {
  return {
    entities: pack.entities.map((e) => ({ id: e.id, body: e.body, ...(e.tags ? { tags: e.tags } : {}) })),
    attributes: pack.attributes.map((a) => ({ id: a.id, slot: a.slot, ...(a.tags ? { tags: a.tags } : {}) })),
  };
}

/** Where a thing comes from: its pack's manifest. */
export interface Placed<T> { readonly def: T; readonly pack: ModuleManifest }

export interface FitResult { readonly ok: boolean; readonly why: string }

const lists = (list: readonly string[], m: ModuleManifest) => list.some((ref) => ref === "*" || (() => { const { name, range } = splitRef(ref); return name === m.id && satisfies(m.version, range); })());

/** May this attribute go on this entity? (See the rules at the top.) */
export function fits(attribute: Placed<AnyAttributeDef>, entity: Placed<AnyEntityDef>): FitResult {
  const body = splitRef(entity.def.body);
  const sameBody = attribute.def.targets.filter((t) => { const r = splitRef(t.body); return r.name === body.name && satisfies(body.range, r.range); });
  if (!sameBody.length) return { ok: false, why: `${attribute.def.id} fits ${attribute.def.targets.map((t) => t.body).join(", ")}; ${entity.def.id} is ${entity.def.body}.` };
  for (const t of sameBody) {
    if (t.entities && !t.entities.includes(entity.def.id)) continue;
    if (t.packs && !lists(t.packs.filter((p) => p !== "*"), entity.pack)) continue;
    if (attribute.pack.id === entity.pack.id) return { ok: true, why: `both from ${entity.pack.id}.` };
    // (Naming a pack in a target narrows where it may go; the entity's pack still has to agree.)
    if (t.packs && lists(entity.pack.compatible, attribute.pack)) return { ok: true, why: `${attribute.def.id} names ${entity.pack.id}, and ${entity.pack.id} declares ${attribute.pack.id} compatible.` };
    if (t.packs) return { ok: false, why: `${attribute.def.id} names ${entity.pack.id}, but ${entity.pack.id} hasn't declared ${attribute.pack.id} compatible.` };
    const theirs = lists(attribute.pack.compatible, entity.pack);
    const ours = lists(entity.pack.compatible, attribute.pack);
    if (theirs && ours) return { ok: true, why: `${attribute.pack.id} and ${entity.pack.id} declare each other compatible.` };
    return { ok: false, why: theirs ? `${entity.pack.id} hasn't declared ${attribute.pack.id} compatible.` : `${attribute.pack.id} hasn't declared ${entity.pack.id} compatible.` };
  }
  return { ok: false, why: `${attribute.def.id}'s targets for ${body.name} don't include ${entity.pack.id}/${entity.def.id}.` };
}
