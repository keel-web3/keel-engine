// Looks and pins as data: a look (core's lookOf output: a profile, a base
// hue, each role's ramp, finish and pattern -- all on core's quantised grids,
// so they pack exactly), an entity's make (its seed and pins: what a token
// names), an attribute's pins, and a whole population (a pack's cast and
// thousands of units, each a body, a coverage, a look and what it wears).
//
// A look's `signature` is derived (core's lookSignature): records leave it
// out; lookOfRecord(record, lookSignature) puts it back.

import { alt, array, bool, dyn, enumOf, fixed, map, named, nullable, num, optional, ref, struct, uint, varuint, withDefault } from "../schema.ts";
import type { Infer, Json } from "../schema.ts";
import { oklch, seedText } from "./common.ts";

/** core's LOOK_ROLES, PROFILES, PATTERNS, FINISHES (test/schemas.test.ts checks they still match). */
export const LOOK_ROLES = ["skin", "fur", "furAlt", "hair", "cloth", "clothAlt", "accent", "dark", "blush", "eye", "primary", "secondary", "trim", "detail", "glow", "metal"] as const;
export const PROFILES = ["analogous", "complementary", "triad", "team", "earthy", "neon", "pastel", "metallic"] as const;
export const PATTERNS = ["none", "stripes", "bands", "spots", "checks", "camo", "gradient", "trim", "windows"] as const;
export const FINISHES = ["matte", "cloth", "leather", "metal", "glow"] as const;

const role = enumOf(LOOK_ROLES, { capacity: 32 });

/** One role's look: hue in 5° steps, chroma, lightness and span in hundredths (core quantises them so). */
export const ROLE_LOOK = struct({
  role,
  hue: fixed(0, 355, 5, { off: "strict" }),
  chroma: fixed(0, 0.32, 0.01, { off: "strict" }),
  light: fixed(0.08, 0.96, 0.02, { off: "strict" }),
  span: fixed(0.2, 0.8, 0.02, { off: "strict" }),
  finish: enumOf(FINISHES, { capacity: 8 }),
  pattern: struct({
    kind: enumOf(PATTERNS, { capacity: 16 }),
    freq: uint(4),
    angle: uint(3),
    width: uint(3),
    shift: fixed(-3, 3, 1, { off: "strict" }),
    ink: nullable(role),
  }),
});

/** A look: its profile, base hue and roles in their order (the first leads). */
export const LOOK = named("keel/look", struct({
  profile: enumOf(PROFILES, { capacity: 16 }),
  hue: fixed(0, 355, 5, { off: "strict" }),
  roles: array(ROLE_LOOK, { max: 31 }),
}), { doc: "A look: what each role wears (core's lookOf, without its derived signature)." });
export type LookRecord = Infer<typeof LOOK>;

/** What lookRecordOf reads (core's Look, structurally). */
export interface LookLike {
  readonly profile: string;
  readonly hue: number;
  readonly roles: Readonly<Record<string, { readonly hue: number; readonly chroma: number; readonly light: number; readonly span: number; readonly finish: string; readonly pattern: { readonly kind: string; readonly freq: number; readonly angle: number; readonly width: number; readonly shift: number; readonly ink: string | null } } | undefined>>;
  readonly order: readonly string[];
}
export function lookRecordOf(look: LookLike): LookRecord {
  return {
    profile: look.profile as LookRecord["profile"],
    hue: look.hue,
    roles: look.order.map((r) => {
      const x = look.roles[r]!;
      return { role: r as (typeof LOOK_ROLES)[number], hue: x.hue, chroma: x.chroma, light: x.light, span: x.span, finish: x.finish as (typeof FINISHES)[number], pattern: { ...x.pattern, kind: x.pattern.kind as (typeof PATTERNS)[number], ink: x.pattern.ink as (typeof LOOK_ROLES)[number] | null } };
    }),
  };
}
/** A record back to a look (core's shape; pass core's lookSignature to fill in its signature). */
export function lookOfRecord<L = LookLike & { readonly signature: string }>(r: LookRecord, signature?: (look: LookLike) => string): L {
  const roles: Record<string, unknown> = {};
  for (const x of r.roles) { const { role: name, ...rest } = x; roles[name] = { ...rest, pattern: { ...rest.pattern } }; }
  const look = { profile: r.profile, hue: r.hue, roles, order: r.roles.map((x) => x.role) } as unknown as LookLike;
  return { ...look, signature: signature ? signature(look) : "" } as L;
}

// ---------------------------------------------------------------- pins

/** A pin's value: a name, a flag or a number (lossless). */
const PinValue = alt([ref("values"), bool(), num()]);
/** Pins by name ("ears": "tall", "height": 1.05, "cloth.hue": 200). */
export const PINS = map(ref("pins"), PinValue);

/** The species catalogue's choices (entity's CHOICES), each typed: what a token pins. */
export const ENTITY_PINS = struct({
  kind: optional(enumOf(["humanoid", "anthro", "animal"])),
  species: optional(enumOf(["human", "cat", "fox", "bunny", "rabbit", "bear", "mouse", "frog", "dog", "deer"], { capacity: 32, other: true })),
  height: optional(fixed(0, 4, 0.001, { off: "exact" })),
  head: optional(fixed(0, 4, 0.001, { off: "exact" })),
  legs: optional(fixed(0, 4, 0.001, { off: "exact" })),
  arms: optional(fixed(0, 4, 0.001, { off: "exact" })),
  girth: optional(fixed(0, 4, 0.001, { off: "exact" })),
  ears: optional(enumOf(["none", "point", "tuft", "tall", "long", "lop", "round", "big", "flop", "side"], { capacity: 16, other: true })),
  earSize: optional(fixed(0, 4, 0.001, { off: "exact" })),
  snout: optional(fixed(0, 4, 0.001, { off: "exact" })),
  tail: optional(fixed(0, 4, 0.001, { off: "exact" })),
  eyes: optional(fixed(0, 4, 0.001, { off: "exact" })),
  coat: optional(enumOf(["plain", "socks", "muzzle", "tipped"], { capacity: 8, other: true })),
  hair: optional(enumOf(["none", "short", "long", "bun", "spiky", "pony"], { capacity: 8, other: true })),
  top: optional(enumOf(["jacket", "hoodie", "tee", "vest", "none"], { capacity: 8, other: true })),
  hood: optional(bool()),
  pants: optional(enumOf(["long", "shorts", "none"], { capacity: 4, other: true })),
  shoes: optional(enumOf(["sneakers", "boots", "bare"], { capacity: 4, other: true })),
  pack: optional(enumOf(["round", "tall", "small", "none"], { capacity: 8, other: true })),
  accessory: optional(enumOf(["none", "scarf", "cap", "goggles", "headband", "collar"], { capacity: 8, other: true })),
  antlers: optional(bool()),
  stride: optional(fixed(0, 4, 0.001, { off: "exact" })),
  furColour: optional(oklch),
  outfitColour: optional(struct({ cloth: oklch, clothAlt: oklch, accent: oklch })),
  hairColour: optional(oklch),
}, { open: true });

/** How an entity is made: its seed and what's pinned (world's EntityMake; what a token names). */
export const ENTITY_MAKE = named("keel/entity/make", struct({
  seed: seedText,
  kind: enumOf(["humanoid", "anthro", "animal"], { capacity: 8 }),
  species: optional(enumOf(["human", "cat", "fox", "bunny", "rabbit", "bear", "mouse", "frog", "dog", "deer"], { capacity: 32, other: true })),
  pins: optional(ENTITY_PINS),
  size: optional(fixed(0, 64, 0.001, { off: "exact" })),
}, { open: true }), { doc: "An entity's seed and pins: everything its spec is rebuilt from." });

/** An attribute worn: which (by pack and id), its shape and look pins, its seed, and its look once drawn. */
export const ATTRIBUTE_PIN = named("keel/attribute/pin", struct({
  pack: ref("packs"),
  attribute: ref("ids"),
  seed: optional(seedText),
  pins: withDefault(PINS, {}),
  look: optional(LOOK),
}, { open: true }), { doc: "An attribute: id + pins + seed (what a wearable token names), and its look." });

// ---------------------------------------------------------------- a population

const Unit = struct({
  entity: varuint({ k: 2 }),
  body: varuint({ k: 3 }),
  /** Its look choices: which parts a top, trousers, shoes, a coat cover. */
  coverage: map(ref("choices"), PinValue),
  look: LOOK,
  wornLook: nullable(LOOK),
  wears: array(struct({ shape: varuint({ k: 4 }), look: LOOK }), { max: 15 }),
});

/** A pack's cast and a population drawn from it (bake's populate(): bodies and attribute shapes by key, units by index). */
export const POPULATION = named("keel/population", struct({
  seed: seedText,
  entities: array(struct({ id: ref("ids"), pack: ref("packs"), weight: withDefault(num(), 1), shapes: optional(uint(6)), pins: withDefault(PINS, {}) })),
  bodies: array(struct({ entity: varuint(), key: ref("keys") })),
  attributes: array(struct({ attribute: ref("ids"), socket: ref("sockets"), key: ref("keys") })),
  units: array(Unit),
}, { open: true }), { doc: "A cast and its units: each a body, a coverage, a look and what it wears." });
export type PopulationRecord = Infer<typeof POPULATION>;

/** What populationRecordOf reads (bake's Population, structurally). */
export interface PopulationLike {
  readonly entities: readonly { readonly def: { readonly id: string }; readonly pack: string; readonly weight?: number; readonly shapes?: number; readonly pins?: Readonly<Record<string, unknown>> }[];
  readonly bodies: readonly { readonly key: string }[];
  readonly bodyEntity: readonly number[];
  readonly attributes: readonly { readonly attribute: string; readonly socket: string; readonly key: string }[];
  readonly units: readonly { readonly entity: number; readonly body: number; readonly coverage: Readonly<Record<string, unknown>>; readonly look: LookLike; readonly wornLook: LookLike | null; readonly wears: readonly { readonly shape: number; readonly look: LookLike }[] }[];
}
export function populationRecordOf(seed: string, p: PopulationLike): PopulationRecord {
  const pins = (o: Readonly<Record<string, unknown>> | undefined): Record<string, string | boolean | number> => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Record<string, string | boolean | number>;
  return {
    seed,
    entities: p.entities.map((e) => ({ id: e.def.id, pack: e.pack, weight: e.weight ?? 1, ...(e.shapes !== undefined ? { shapes: e.shapes } : {}), pins: pins(e.pins) })),
    bodies: p.bodies.map((b, i) => ({ entity: p.bodyEntity[i]!, key: b.key })),
    attributes: p.attributes.map((a) => ({ attribute: a.attribute, socket: a.socket, key: a.key })),
    units: p.units.map((u) => ({
      entity: u.entity, body: u.body, coverage: pins(u.coverage), look: lookRecordOf(u.look),
      wornLook: u.wornLook ? lookRecordOf(u.wornLook) : null, wears: u.wears.map((w) => ({ shape: w.shape, look: lookRecordOf(w.look) })),
    })),
  };
}
/** (dyn's Json, re-exported for pin maps that hold more than names and numbers.) */
export type { Json };
export const PIN_ANY = map(ref("pins"), dyn());
