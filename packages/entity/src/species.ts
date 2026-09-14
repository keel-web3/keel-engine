// The species catalogue: a seed (and whatever the caller pins) -> an entity
// spec. A person, an ANTHRO animal (an animal's head, ears, tail and snout on
// a person's body -- the WALLRUN runner), or a real ANIMAL on four legs.
// Ported from the proof of concept's src/entity/species.js; the equality test
// proves every spec identical.
//
//   const spec = entityOf("7", { kind: "anthro" });                  // all from the seed
//   const cat = entityOf("7", { kind: "anthro", pins: { species: "cat" } });
//
// Every choice draws from its OWN stream (choiceStream(seed, name)), so
// pinning one never moves another: pin the pack and the species, the height,
// the jacket stay put. A choice may READ another (a hood needs a top to hang
// off; ears come in the species' shapes) -- CHOICES lists what each one reads,
// and only those can change when you pin something.
//
// Proportions are multipliers around 1 (height, head, legs, arms, girth), so
// pinning the species keeps a tall seed tall. The world size comes from the
// kind and species (and `size`, when the caller needs an exact height).

import { createRoll, deriveSeed, dsin, stream } from "@keel-engine/core";
import type { Stream, Vec3, Weighted } from "@keel-engine/core";
import { humanoidRig, quadrupedRig } from "./rig.ts";
import type { HumanoidBody, HumanoidRig, QuadrupedBody, QuadrupedRig } from "./rig.ts";

// ---------------------------------------------------------------- the catalogue

export type Kind = "humanoid" | "anthro" | "animal";
export const KINDS: readonly Kind[] = ["humanoid", "anthro", "animal"];

export type Species = "human" | "cat" | "fox" | "bunny" | "rabbit" | "bear" | "mouse" | "frog" | "dog" | "deer";

/** Who can be what, and how often. */
export const SPECIES: Readonly<Record<Kind, Weighted<Species>>> = {
  humanoid: [["human", 1]],
  anthro: [["cat", 4], ["fox", 3], ["bunny", 3], ["bear", 2], ["mouse", 2], ["frog", 1], ["dog", 2]],
  animal: [["cat", 3], ["dog", 3], ["fox", 2], ["bear", 1], ["rabbit", 2], ["mouse", 1], ["deer", 2]],
};
// (A bunny is a rabbit on four legs, and back.)
const ALIAS: Partial<Record<Kind, Partial<Record<string, Species>>>> = { anthro: { rabbit: "bunny" }, animal: { bunny: "rabbit" } };

export type EarShape = "none" | "point" | "tuft" | "tall" | "long" | "lop" | "round" | "big" | "flop" | "side";
export type TailShape = "none" | "long" | "bushy" | "puff" | "stub" | "thin";
export type Coat = "plain" | "socks" | "muzzle" | "tipped";
export type Hair = "none" | "short" | "long" | "bun" | "spiky" | "pony";
export type Top = "jacket" | "hoodie" | "tee" | "vest" | "none";
export type Pants = "long" | "shorts" | "none";
export type Shoes = "sneakers" | "boots" | "bare";
export type PackStyle = "round" | "tall" | "small" | "none";
export type Accessory = "none" | "scarf" | "cap" | "goggles" | "headband" | "collar";
/** An OKLCH colour: [L, C, hue]. */
export type Oklch = readonly [number, number, number];

/** What a species looks like, whatever body it's on. */
export interface Look {
  /** The shapes its ears come in (repeats weight the pick). */
  readonly ears: readonly EarShape[];
  /** Snout length, in head radii. */
  readonly snout: number;
  /** [shape, length]: length in heights for anthro, shoulder heights on four legs. */
  readonly tail: readonly [TailShape, number];
  readonly coats: Weighted<Coat>;
  readonly fur: readonly Oklch[];
  /** The lightness of its alternate fur (muzzle, socks, tail tip). */
  readonly alt: number;
}

// What a species looks like, whatever body it's on. Lengths are in head radii.
export const LOOK: Readonly<Record<Species, Look>> = {
  human: { ears: ["none"], snout: 0.08, tail: ["none", 0], coats: [["plain", 1]], fur: [[0.82, 0.05, 60], [0.72, 0.07, 55], [0.6, 0.08, 50], [0.45, 0.06, 45], [0.35, 0.05, 40]], alt: 0.05 },
  cat: { ears: ["point", "point", "tuft"], snout: 0.18, tail: ["long", 0.38], coats: [["plain", 3], ["socks", 2], ["muzzle", 2], ["tipped", 1]], fur: [[0.93, 0.01, 80], [0.72, 0.12, 60], [0.6, 0.02, 250], [0.3, 0.02, 280], [0.8, 0.05, 75]], alt: 0.95 },
  fox: { ears: ["tall"], snout: 0.62, tail: ["bushy", 0.42], coats: [["tipped", 3], ["muzzle", 2], ["socks", 2]], fur: [[0.66, 0.15, 50], [0.72, 0.13, 60], [0.55, 0.14, 40], [0.85, 0.02, 250]], alt: 0.95 },
  bunny: { ears: ["long", "long", "lop"], snout: 0.18, tail: ["puff", 0.07], coats: [["plain", 3], ["muzzle", 2]], fur: [[0.95, 0.01, 80], [0.8, 0.03, 70], [0.62, 0.04, 60], [0.5, 0.03, 50]], alt: 0.97 },
  rabbit: { ears: ["long", "long", "lop"], snout: 0.22, tail: ["puff", 0.3], coats: [["plain", 3], ["muzzle", 2]], fur: [[0.95, 0.01, 80], [0.8, 0.03, 70], [0.62, 0.04, 60], [0.5, 0.03, 50]], alt: 0.97 },
  bear: { ears: ["round"], snout: 0.5, tail: ["stub", 0.06], coats: [["muzzle", 3], ["plain", 1]], fur: [[0.45, 0.06, 55], [0.35, 0.04, 50], [0.95, 0.01, 90], [0.25, 0.01, 270], [0.6, 0.08, 60]], alt: 0.7 },
  mouse: { ears: ["big"], snout: 0.42, tail: ["thin", 0.5], coats: [["plain", 2], ["muzzle", 1]], fur: [[0.7, 0.01, 260], [0.6, 0.04, 60], [0.9, 0.01, 80]], alt: 0.85 },
  frog: { ears: ["none"], snout: 0, tail: ["none", 0], coats: [["plain", 2], ["muzzle", 1]], fur: [[0.7, 0.15, 140], [0.65, 0.14, 120], [0.72, 0.12, 170]], alt: 0.9 },
  dog: { ears: ["flop", "flop", "point"], snout: 0.55, tail: ["long", 0.25], coats: [["plain", 2], ["muzzle", 2], ["socks", 2]], fur: [[0.7, 0.09, 70], [0.4, 0.06, 55], [0.9, 0.02, 85], [0.25, 0.01, 280], [0.6, 0.1, 60]], alt: 0.92 },
  deer: { ears: ["side"], snout: 0.9, tail: ["stub", 0.15], coats: [["muzzle", 2], ["plain", 1]], fur: [[0.58, 0.09, 55], [0.5, 0.08, 50], [0.65, 0.07, 65]], alt: 0.9 },
};
/** Ear shapes: [length, width, spread] in head radii (how the tip leans is skin.ts's). */
export const EARS: Readonly<Record<EarShape, readonly [number, number, number]>> = {
  none: [0, 0, 0],
  point: [0.62, 0.2, 0.52], tuft: [0.72, 0.18, 0.5], tall: [0.9, 0.24, 0.48], long: [1.55, 0.2, 0.3],
  lop: [1.2, 0.2, 0.7], round: [0.3, 0.3, 0.72], big: [0.5, 0.46, 0.78], flop: [0.75, 0.24, 0.8], side: [0.75, 0.2, 0.9],
};

/** A four-legged body, in shoulder heights (sh itself in world units). */
export interface QuadLook {
  readonly sh: number; readonly len: number; readonly head: number; readonly girth: number; readonly neck: number; readonly rise: number;
  readonly hind: number; readonly snout: number; readonly paw: number; readonly tailRise: number; readonly leg: number;
}
// Four-legged bodies, in shoulder heights: shoulder height (world), body length, head radius,
// body radius, neck, neck rise, hips over shoulders, snout (head radii), paw length, tail rise.
export const QUAD: Readonly<Partial<Record<Species, QuadLook>>> = {
  cat: { sh: 0.25, len: 1.45, head: 0.3, girth: 0.3, neck: 0.45, rise: 0.75, hind: 1.02, snout: 0.3, paw: 0.26, tailRise: 0.45, leg: 0.075 },
  dog: { sh: 0.5, len: 1.25, head: 0.25, girth: 0.28, neck: 0.5, rise: 0.8, hind: 0.98, snout: 0.85, paw: 0.2, tailRise: 0.6, leg: 0.07 },
  fox: { sh: 0.35, len: 1.4, head: 0.26, girth: 0.25, neck: 0.5, rise: 0.65, hind: 1, snout: 0.95, paw: 0.2, tailRise: 0.15, leg: 0.06 },
  bear: { sh: 0.85, len: 1.45, head: 0.28, girth: 0.42, neck: 0.38, rise: 0.25, hind: 1.02, snout: 0.7, paw: 0.24, tailRise: 0.3, leg: 0.11 },
  rabbit: { sh: 0.15, len: 1.45, head: 0.5, girth: 0.5, neck: 0.3, rise: 0.9, hind: 1.12, snout: 0.35, paw: 0.55, tailRise: 0.6, leg: 0.1 },
  mouse: { sh: 0.05, len: 1.8, head: 0.55, girth: 0.5, neck: 0.25, rise: 0.45, hind: 1.05, snout: 0.7, paw: 0.35, tailRise: 0.15, leg: 0.1 },
  deer: { sh: 0.95, len: 1.05, head: 0.17, girth: 0.22, neck: 0.8, rise: 1.05, hind: 1.05, snout: 1.1, paw: 0.14, tailRise: 0.8, leg: 0.045 },
};
// Anthro heights (world units: the WALLRUN runner is about 1).
export const ANTHRO_H: Readonly<Partial<Record<Species, number>>> = { cat: 1, fox: 1.05, bunny: 0.95, bear: 1.12, mouse: 0.86, frog: 0.86, dog: 1.04 };

const between = (u: number, a: number, b: number): number => a + (b - a) * u;
const isOutfitted = (kind: Kind): boolean => kind !== "animal";

// ---------------------------------------------------------------- choices

export interface OutfitColour {
  readonly cloth: Oklch;
  readonly clothAlt: Oklch;
  readonly accent: Oklch;
}

/** Every choice an entity makes, by name. */
export interface ChoiceValues {
  kind: Kind;
  species: Species;
  height: number;
  head: number;
  legs: number;
  arms: number;
  girth: number;
  ears: EarShape;
  earSize: number;
  snout: number;
  tail: number;
  eyes: number;
  coat: Coat;
  hair: Hair;
  top: Top;
  hood: boolean;
  pants: Pants;
  shoes: Shoes;
  pack: PackStyle;
  accessory: Accessory;
  antlers: boolean;
  stride: number;
  furColour: Oklch;
  outfitColour: OutfitColour;
  hairColour: Oklch;
}
export type ChoiceName = keyof ChoiceValues;
export type EntityPins = { readonly [K in ChoiceName]?: ChoiceValues[K] };

/**
 * One choice: what it reads, the values it may take (a list, a list that
 * depends on what it reads, or a numeric range), and how it picks. `pick`
 * runs in CHOICES order, so every choice before it has been made.
 */
export interface ChoiceDef<K extends ChoiceName = ChoiceName> {
  readonly name: K;
  readonly reads: readonly ChoiceName[];
  readonly options?: readonly ChoiceValues[K][];
  readonly optionsOf?: (c: Readonly<ChoiceValues>) => readonly ChoiceValues[K][];
  /** A numeric choice's range (the engine's addition: the editor shows it; picking doesn't read it). */
  readonly range?: readonly [number, number];
  readonly pick: (S: Stream, c: Readonly<ChoiceValues>) => ChoiceValues[K];
}
type AnyChoice = { [K in ChoiceName]: ChoiceDef<K> }[ChoiceName];
const choice = <K extends ChoiceName>(def: ChoiceDef<K>): ChoiceDef<K> => def;
const ranged = <K extends ChoiceName>(name: K, lo: number, hi: number): ChoiceDef<K> =>
  ({ name, reads: [], range: [lo, hi], pick: (S) => between(S.f(), lo, hi) as ChoiceValues[K] });

/** The choices, in order. `S` is the choice's own seeded stream; `c` the choices made so far. */
export const CHOICES: readonly AnyChoice[] = [
  choice({ name: "kind", reads: [], options: KINDS, pick: (S) => S.weighted<Kind>([["humanoid", 2], ["anthro", 3], ["animal", 2]]) }),
  choice({ name: "species", reads: ["kind"], optionsOf: (c) => SPECIES[c.kind].map(([s]) => s), pick: (S, c) => S.weighted(SPECIES[c.kind]) }),
  ranged("height", 0.9, 1.1),
  ranged("head", 0.88, 1.12),
  ranged("legs", 0.92, 1.08),
  ranged("arms", 0.92, 1.08),
  ranged("girth", 0.85, 1.15),
  choice({ name: "ears", reads: ["species"], optionsOf: (c) => [...new Set(LOOK[c.species].ears)], pick: (S, c) => S.pick(LOOK[c.species].ears) }),
  ranged("earSize", 0.85, 1.15),
  ranged("snout", 0.85, 1.2),
  ranged("tail", 0.8, 1.2),
  ranged("eyes", 0.85, 1.2),
  choice({ name: "coat", reads: ["species"], optionsOf: (c) => LOOK[c.species].coats.map(([v]) => v), pick: (S, c) => S.weighted(LOOK[c.species].coats) }),
  choice({ name: "hair", reads: ["species"], options: ["none", "short", "long", "bun", "spiky", "pony"], pick: (S, c) => (c.species === "human" ? S.weighted<Hair>([["short", 4], ["long", 2], ["bun", 2], ["spiky", 2], ["pony", 2], ["none", 1]]) : "none") }),
  choice({ name: "top", reads: ["kind"], options: ["jacket", "hoodie", "tee", "vest", "none"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted<Top>([["jacket", 4], ["hoodie", 3], ["tee", 2], ["vest", 1]]) : "none") }),
  choice({ name: "hood", reads: ["species", "top"], options: [true, false], pick: (S, c) => (c.species !== "frog" && (c.top === "jacket" || c.top === "hoodie") ? S.chance(c.top === "hoodie" ? 0.6 : 0.35) : false) }),
  choice({ name: "pants", reads: ["kind"], options: ["long", "shorts", "none"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted<Pants>(c.kind === "humanoid" ? [["long", 3], ["shorts", 1]] : [["none", 3], ["long", 2], ["shorts", 2]]) : "none") }),
  choice({ name: "shoes", reads: ["kind", "species"], options: ["sneakers", "boots", "bare"], pick: (S, c) => (!isOutfitted(c.kind) || c.species === "frog" ? "bare" : S.weighted<Shoes>([["sneakers", 4], ["boots", 2], ["bare", c.kind === "anthro" ? 1 : 0.2]])) }),
  choice({ name: "pack", reads: ["kind"], options: ["round", "tall", "small", "none"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted<PackStyle>([["round", 4], ["tall", 2], ["small", 2], ["none", 2]]) : "none") }),
  choice({ name: "accessory", reads: ["kind", "species"], options: ["none", "scarf", "cap", "goggles", "headband", "collar"], pick: (S, c) => (isOutfitted(c.kind) ? S.weighted<Accessory>([["none", 5], ["scarf", 2], ["cap", 2], ["goggles", 1], ["headband", 1]]) : c.species === "cat" || c.species === "dog" ? S.weighted<Accessory>([["none", 1], ["collar", 1]]) : "none") }),
  choice({ name: "antlers", reads: ["kind", "species"], options: [true, false], pick: (S, c) => c.kind === "animal" && c.species === "deer" && S.chance(0.55) }),
  ranged("stride", 0.9, 1.1),
  choice({ name: "furColour", reads: ["species"], pick: (S, c) => S.pick(LOOK[c.species].fur) }),
  choice({ name: "outfitColour", reads: [], pick: (S) => { const h = S.pick([165, 180, 200, 140, 25, 300, 260, 45, 350]); return { cloth: [0.55, 0.12, h], clothAlt: [0.35, 0.04, h + 120], accent: [0.52, 0.12, (h + S.pick([150, 180, 200])) % 360] }; } }),
  choice({ name: "hairColour", reads: [], pick: (S) => S.pick<Oklch>([[0.25, 0.03, 50], [0.4, 0.07, 55], [0.72, 0.1, 85], [0.55, 0.14, 40], [0.2, 0.01, 280], [0.85, 0.02, 90]]) }),
];
const BY_NAME = Object.fromEntries(CHOICES.map((c) => [c.name, c])) as { readonly [K in ChoiceName]: ChoiceDef<K> };
const isChoice = (name: string): name is ChoiceName => Object.hasOwn(BY_NAME, name);

/** Every choice a choice reads, all the way down (pinning any of them may change it). */
export function readsOf(name: ChoiceName): Set<ChoiceName> {
  const out = new Set<ChoiceName>();
  const walk = (n: ChoiceName): void => { for (const r of BY_NAME[n].reads) if (!out.has(r)) { out.add(r); walk(r); } };
  walk(name);
  return out;
}

/** The values a choice accepts given the choices it reads (undefined: a free number or a colour). */
export function optionsOf<K extends ChoiceName>(name: K, made: Readonly<ChoiceValues>): readonly ChoiceValues[K][] | undefined {
  const ch: ChoiceDef<K> = BY_NAME[name];
  return ch.optionsOf ? ch.optionsOf(made) : ch.options;
}

/**
 * The choice's own stream: one seed, one label per choice. (Derived twice: once
 * for the entity, once for the choice -- neighbouring seeds like "1", "2", "3"
 * otherwise start their first draws close together.)
 */
export const choiceStream = (seed: unknown, name: string): Stream => stream(createRoll(deriveSeed(deriveSeed(String(seed), "entity"), name)), 0);

// ---------------------------------------------------------------- specs

export interface Ears {
  readonly shape: EarShape;
  readonly len: number;
  readonly w: number;
  readonly spread: number;
}
export interface Features {
  readonly ears: Ears;
  readonly snout: number;
  readonly tail: { readonly shape: TailShape; readonly len: number };
  readonly eyes: { readonly r: number; readonly spread: number };
  readonly coat: Coat;
  readonly hair: Hair;
  readonly antlers: boolean;
  readonly frogEyes: boolean;
}
export interface Outfit {
  readonly top: Top;
  readonly hood: boolean;
  readonly pants: Pants;
  readonly shoes: Shoes;
  readonly pack: PackStyle;
  readonly accessory: Accessory;
}
/** OKLCH suggestions per material role. */
export interface Colours extends OutfitColour {
  readonly fur: Oklch;
  readonly furAlt: Oklch;
  readonly hair: Oklch;
  readonly dark: Oklch;
  readonly blush: Oklch;
}
/** The declared front: own +z, right hand +x (the core frame). front.ts checks it against the features. */
export interface DeclaredFront {
  readonly dir: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

interface SpecCommon {
  readonly seed: string;
  readonly kind: Kind;
  readonly species: Species;
  readonly choices: ChoiceValues;
  /** The names pinned (sorted). */
  readonly pinned: string[];
  readonly features: Features;
  readonly outfit: Outfit;
  readonly colours: Colours;
  readonly front: DeclaredFront;
}
export interface HumanoidSpec extends SpecCommon {
  readonly plan: "humanoid";
  readonly body: HumanoidBody;
  readonly rig: HumanoidRig;
}
export interface QuadrupedSpec extends SpecCommon {
  readonly plan: "quadruped";
  readonly body: QuadrupedBody;
  readonly rig: QuadrupedRig;
}
/** What a seed makes: a spec on two legs or four. */
export type EntitySpec = HumanoidSpec | QuadrupedSpec;

export interface EntityOptions {
  /** A pin for the kind (drawn from the seed when absent). */
  readonly kind?: Kind | undefined;
  /** A pin for the species ("cat", "fox", ...; "bunny"/"rabbit" either way). */
  readonly species?: Species | undefined;
  /** Any choice in CHOICES, locked. */
  readonly pins?: EntityPins | undefined;
  /** World size: total height on two legs, shoulder height on four (default: the species'). */
  readonly size?: number | undefined;
}

/** entityOf(seed, { kind, species, pins, size }) -> spec */
export function entityOf(seed: unknown, { kind, species, pins = {}, size }: EntityOptions = {}): EntitySpec {
  const locked: Record<string, unknown> = { ...pins };
  if (kind !== undefined) locked["kind"] = kind;
  if (species !== undefined) locked["species"] = species;
  for (const name of Object.keys(locked)) if (!isChoice(name)) throw new TypeError(`No entity choice called "${name}" (choices: ${CHOICES.map((c) => c.name).join(", ")}).`);
  // (Filled in CHOICES order: each pick sees every choice before it.)
  const c = {} as ChoiceValues;
  const made = c as unknown as Record<ChoiceName, unknown>;
  for (const ch of CHOICES) {
    if (locked[ch.name] !== undefined) {
      let v = locked[ch.name];
      if (ch.name === "species") v = ALIAS[c.kind]?.[v as string] ?? v;
      const opts = (ch.optionsOf ? ch.optionsOf(c) : ch.options) as readonly unknown[] | undefined;
      if (opts && !opts.includes(v)) throw new RangeError(`Entity choice ${ch.name} = ${JSON.stringify(v)} is not one of ${JSON.stringify(opts)}${ch.optionsOf ? ` (for ${ch.reads.map((r) => `${r} ${String(made[r])}`).join(", ")})` : ""}.`);
      made[ch.name] = v;
    } else {
      made[ch.name] = ch.pick(choiceStream(seed, ch.name), c);
    }
  }
  const features = (body: HumanoidBody | QuadrupedBody): Features => featuresOf(c, body);
  const outfit: Outfit = { top: c.top, hood: c.hood, pants: c.pants, shoes: c.shoes, pack: c.pack, accessory: c.accessory };
  const colours: Colours = { fur: c.furColour, furAlt: [LOOK[c.species].alt, 0.02, c.furColour[2]], ...c.outfitColour, hair: c.hairColour, dark: [0.18, 0.02, 280], blush: [0.72, 0.1, 15] };
  const common = { seed: String(seed), kind: c.kind, species: c.species } as const;
  const rest = { choices: c, pinned: Object.keys(locked).sort() } as const;
  // (The declared front: own +z, right hand +x -- the core frame. front.ts checks it against the features.)
  const front: DeclaredFront = { dir: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] };
  if (c.kind === "animal") {
    const body = quadrupedBody(c, size);
    const f = features(body);
    const rig = quadrupedRig(body);
    return { ...common, plan: rig.plan, ...rest, body, features: f, outfit, colours, front, rig };
  }
  const body = humanoidBody(c, size);
  const f = features(body);
  const rig = humanoidRig(body);
  return { ...common, plan: rig.plan, ...rest, body, features: f, outfit, colours, front, rig };
}

// Two legs: a person (about 1.7 tall, a seventh of it head) or an anthro animal
// (about 1, nearly two fifths of it head -- the runner's chibi build).
function humanoidBody(c: ChoiceValues, size: number | undefined): HumanoidBody {
  const human = c.kind === "humanoid";
  const H = size ?? (human ? 1.7 : ANTHRO_H[c.species] ?? 1) * c.height;
  const headR = (H * (human ? 0.135 : 0.38) * c.head) / 2;
  const hipH = H * (human ? 0.5 : 0.3) * c.legs;
  const neck = H * (human ? 0.035 : 0.012);
  const torso = H - hipH - neck - headR * 2;
  const footR = H * (human ? 0.028 : 0.045);
  const ankleH = Math.max(footR * 1.25, hipH * 0.08);
  const reach = hipH - ankleH;
  const torsoR = H * (human ? 0.085 : 0.14) * c.girth;
  const tail = LOOK[c.species].tail;
  return {
    H, hipH, ankleH, footR, neck, torso, headR, torsoR,
    thigh: reach * 0.5, shin: reach * 0.5,
    footLen: H * (human ? 0.13 : 0.13),
    hipW: human ? H * 0.055 * Math.sqrt(c.girth) : torsoR * 0.52,
    shoulderW: human ? H * 0.115 * Math.sqrt(c.girth) : torsoR * 0.95,
    upperArm: H * (human ? 0.17 : 0.11) * c.arms,
    forearm: H * (human ? 0.145 : 0.095) * c.arms,
    handLen: H * (human ? 0.055 : 0.04),
    legR: H * (human ? 0.034 : 0.052) * Math.sqrt(c.girth),
    armR: H * (human ? 0.028 : 0.038) * Math.sqrt(c.girth),
    tailLen: tail[0] === "none" ? 0 : H * tail[1] * c.tail,
    stride: c.stride,
  };
}

function quadLook(species: Species): QuadLook {
  const q = QUAD[species];
  // (entityOf's options check keeps every other species off four legs.)
  if (!q) throw new RangeError(`No four-legged body for ${species}.`);
  return q;
}

function quadrupedBody(c: ChoiceValues, size: number | undefined): QuadrupedBody {
  const q = quadLook(c.species);
  const sh = size ?? q.sh * c.height * c.legs;
  const hipH = sh * q.hind;
  const legR = sh * q.leg * Math.sqrt(c.girth);
  const ankleH = Math.max(sh * 0.085, legR * 1.05); // (a thick leg's end stays off the ground)
  const bodyR = sh * q.girth * c.girth;
  const tail = LOOK[c.species].tail;
  return {
    shoulderH: sh, hipH, ankleH, bodyR, legR,
    H: sh + bodyR + sh * q.neck * dsin(q.rise) + sh * q.head * c.head * 2,
    bodyLen: sh * q.len / c.legs,
    neckLen: sh * q.neck,
    neckRise: q.rise,
    headR: sh * q.head * c.head,
    w: bodyR * 0.62,
    upperF: (sh - ankleH) * 0.5, lowerF: (sh - ankleH) * 0.5,
    upperH: (hipH - ankleH) * 0.5, lowerH: (hipH - ankleH) * 0.5,
    pawR: legR * 1.2,
    pawLen: sh * q.paw,
    snoutLen: q.snout,
    tailLen: tail[0] === "none" ? 0 : sh * tail[1] * 3 * c.tail,
    tailRise: q.tailRise,
    stride: c.stride,
  };
}

function featuresOf(c: ChoiceValues, body: HumanoidBody | QuadrupedBody): Features {
  const [len, w, spread] = EARS[c.ears];
  const tail = LOOK[c.species].tail;
  const quad = c.kind === "animal";
  return {
    ears: { shape: c.ears, len: len * c.earSize, w: w * Math.sqrt(c.earSize), spread },
    snout: (quad ? quadLook(c.species).snout : LOOK[c.species].snout) * c.snout,
    tail: { shape: tail[0], len: body.tailLen },
    eyes: { r: (c.kind === "humanoid" ? 0.1 : quad ? 0.16 : 0.14) * c.eyes, spread: c.species === "frog" ? 0.5 : c.kind === "humanoid" ? 0.36 : 0.4 },
    coat: c.coat,
    hair: c.hair,
    antlers: c.antlers,
    frogEyes: c.species === "frog",
  };
}
