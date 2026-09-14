// A population: thousands of characters, every one different, from a seed --
// and a bake that costs a few dozen shapes. The generator makes a handful of
// BODY SHAPES per entity (shape choices on a grid: pickShape), gives every
// unit one of them, a coverage (which parts its outfit covers), a LOOK kept
// clear of every other unit of its kind in that coverage (createLookPool), and a few
// attributes, each an ATTRIBUTE SHAPE (built to its body's socket class, shape
// choices on the grid) wearing a look of its own. Shapes are shared -- that's
// the cache -- looks are not.
//
//   const pop = populate({ seed, count: 10000, entities: [...], attributes: [...] });
//   pop.bodies / pop.attributes   the shapes to bake (planBake them; renderIndexedSprites)
//   pop.units[i]                  { body, coverage, look, wears: [{ shape, look }], anim, signature }
//
// Every unit is derivable ALONE from (the cast, the seed, i): it's made of
// LAYERS, each drawn from its own stream off (seed, i, layer) --
//
//   body   entity (by weight), one of its body shapes, its coverage
//   wear   how many things, which, in which shape variant
//   look   its look and each worn thing's (seeds "<seed>/unit/<i>", ".../<attribute>")
//   anim   its gait speed and stride, its idle style and phase
//
// -- so a pin on one layer (options.pins) never reshuffles another, and an
// explicit part (options.explicit: a hand-built body, a thing in a socket)
// replaces its layer and leaves the rest drawn. The one thing a unit alone
// can't know is whether its look came too close to an earlier unit's: the
// batch keeps looks apart (look pools, re-rolling) and records which
// candidate each re-rolled look took -- the EXCEPTIONS, sparse (about one
// unit in nine at 10,000). Given them (options.exceptions), no pool runs:
// unit i's look is candidate #(exceptions ?? 0), and populationUnit(options,
// i) is the batch's unit i on its own. bake's hybrid.ts stores exactly that.
//
// Deterministic from the seed and the lists' order; a population's first
// units are the same whatever its size.

import { candidateLook, createLookPool, createRoll, deriveSeed, lookOf, stream } from "@keel-engine/core";
import type { Look, LookOptions, LookPool, LookRoles, Roll, Stream } from "@keel-engine/core";
import { contractOf } from "@keel-engine/entity";
import type { AttributeShape, EntitySocket, EntitySpec, Skeleton } from "@keel-engine/entity";
import { pickLook, pickShape, satisfies, splitRef } from "@keel-engine/runtime";
import type { AnyAttributeDef, AttributeDef, EntityDef, Pins } from "@keel-engine/runtime";
import { attributeShape, bodyShape, socketClass } from "./shapes.ts";
import type { AttributeShapeDesign, BodyShape, BodyWear, ExplicitSkin } from "./shapes.ts";
import type { ClipSpec } from "./plan.ts";
import type { ClipInfo } from "./entity-design.ts";

/** Something baked into a body shape now and then (boots: both feet from one design). */
export interface CastWear { readonly defs: readonly AttributeDef<AttributeShape>[]; readonly chance: number }

export interface CastEntity {
  readonly def: EntityDef<EntitySpec>;
  /** Its pack's id (part of its shapes' keys). */
  readonly pack: string;
  /** How often it's drawn (default 1). */
  readonly weight?: number;
  /** Body shapes it gets (default: the population's `shapes`). */
  readonly shapes?: number;
  /** Shape pins every body of it keeps (pack: "none" -- the packs come as attributes). */
  readonly pins?: Pins;
  /** Things baked into some of its bodies. */
  readonly wear?: readonly CastWear[];
}
export interface CastAttribute { readonly def: AttributeDef<AttributeShape>; readonly weight?: number }

// ---------------------------------------------------------------- pins, explicit parts, exceptions

/** A unit's animation variation: its own layer. */
export interface PopAnim {
  /** Its gait speeds' factor (0.88..1.12, in hundredths). */
  readonly speed: number;
  /** Its stride's factor (0.9..1.1): a longer stride plays a cycle over more ground. */
  readonly stride: number;
  /** Its idle style: an index into IDLE_STYLES. */
  readonly idle: number;
  /** Where in its idle it starts, 0..1 in 64ths (so idle units don't breathe in step). */
  readonly phase: number;
}
/** Idle styles, and how each breathes: its idle's period, as a factor of the clip's. */
export const IDLE_STYLES = ["calm", "restless", "sleepy", "alert"] as const;
export const IDLE_PERIOD = [1, 0.72, 1.45, 0.88] as const;

/** Choices fixed by hand on one unit, per layer (anything left out is drawn). */
export interface UnitPins {
  /** Body: which entity (its id), which of its body shapes (an index into that entity's), coverage choices. */
  readonly body?: { readonly entity?: string; readonly body?: number; readonly coverage?: Pins };
  /** Wear: the whole list (empty: nothing), each an attribute id and its shape variant (default: drawn on the unit's own). */
  readonly wear?: readonly { readonly attribute: string; readonly variant?: number }[];
  /** Pins on its body's look (core's lookOf pins). */
  readonly look?: Pins;
  /** Pins on the looks of what it wears, by attribute id. */
  readonly wearLooks?: Readonly<Record<string, Pins>>;
  readonly anim?: Partial<PopAnim>;
}

/**
 * A hand-built body (a builder voxel model, rigged): its spec (proportions, rig, plan), its own skin on a posed
 * skeleton and its sockets. `doc` is the codec document it was read from, when it's to be stored.
 */
export interface ExplicitBody {
  readonly spec: EntitySpec;
  readonly skin: (skel: Skeleton) => ExplicitSkin;
  readonly sockets?: Readonly<Record<string, EntitySocket>>;
  readonly doc?: Uint8Array;
}
/** A hand-built thing worn in a socket (an OBJECT, a voxel attribute): replaces whatever the unit drew for that socket. */
export interface ExplicitWear {
  readonly def: AttributeDef<AttributeShape>;
  readonly doc?: Uint8Array;
}
/** Explicit parts on one unit: its body, and things in sockets. */
export interface UnitExplicit {
  readonly body?: ExplicitBody;
  readonly wears?: readonly ExplicitWear[];
}

/** Which candidate each re-rolled look took (see the top): by unit, its body look's; by unit and attribute id, its wears'. */
export interface PopExceptions {
  readonly look: ReadonlyMap<number, number>;
  readonly wears: ReadonlyMap<number, ReadonlyMap<string, number>>;
}

export interface PopulationOptions {
  readonly seed: string;
  readonly count: number;
  readonly entities: readonly CastEntity[];
  readonly attributes?: readonly CastAttribute[];
  /** Body shapes per entity (default 3). */
  readonly shapes?: number;
  /** Attributes a unit wears, [least, most] (default [1, 3]; one per socket). */
  readonly wear?: readonly [number, number];
  /** Look distance kept between two units of one entity in one coverage (default 0.08), and two looks of one attribute shape (default 0.03). */
  readonly threshold?: number;
  readonly attributeThreshold?: number;
  /** Values an attribute's ranged shape choice takes (default 3: low, middle, high). */
  readonly steps?: number;
  /**
   * Shape variants each attribute comes in across the population (default 6): a unit wears one of them. Fewer
   * variants, fewer shapes to bake (each is baked once per socket class it's worn in); its looks still differ.
   */
  readonly variants?: number;
  /** May this attribute go on this entity? (default: its targets' body contracts; pass runtime's fits() for packs too). */
  readonly fits?: (attribute: AnyAttributeDef, entity: EntityDef<EntitySpec>) => boolean;
  /** Look options every unit's look shares (a team's hue...). */
  readonly look?: LookOptions;
  readonly clips?: readonly ClipSpec[];
  /** Clips by body plan, when `clips` isn't given (a cast of people and animals wanting actions: ACTION_BAKE_CLIPS). */
  readonly clipsFor?: (plan: EntitySpec["plan"]) => readonly ClipSpec[];
  /** Pins by unit (see UnitPins). */
  readonly pins?: ReadonlyMap<number, UnitPins>;
  /** Explicit parts by unit (see UnitExplicit). */
  readonly explicit?: ReadonlyMap<number, UnitExplicit>;
  /** The looks' re-rolls, from an earlier batch: given, no look pool runs (see the top). */
  readonly exceptions?: PopExceptions;
  /** Where the cast came from, for storing it as a recipe (hybrid.ts): its generator's module ids at exact versions, and which cast. */
  readonly recipe?: { readonly modules: readonly string[]; readonly cast?: string };
}

export interface PopWear { readonly shape: number; readonly look: Look }
export interface PopUnit {
  /** Index into the population's entities, bodies. */
  readonly entity: number;
  readonly body: number;
  /** Its look choices (coverage: top, pants, shoes, coat...). */
  readonly coverage: Readonly<Record<string, unknown>>;
  readonly look: Look;
  /** The look of what's baked into its body (boots), if anything is. */
  readonly wornLook: Look | null;
  readonly wears: readonly PopWear[];
  readonly anim: PopAnim;
  /** Everything that makes it itself: its body's key, its coverage, its look, each worn shape's key and look. */
  readonly signature: string;
}

/** A unit before its looks: its entity, its body, its coverage, what it wears (in the order it was picked), how it moves. */
export interface PopUnitShape {
  readonly entity: number;
  readonly body: number;
  readonly coverage: Readonly<Record<string, unknown>>;
  /** Each worn shape, and the index of its attribute in the population's attributes list (the options' own, then explicit ones). */
  readonly wears: ReadonlyArray<{ readonly shape: number; readonly attribute: number }>;
  readonly anim: PopAnim;
}

/**
 * A population's shapes -- every body and attribute shape, and every unit's -- before any look is drawn: what the
 * scene (where everyone is, what they wear) and the bake need, in a fraction of the time (the look pools are most of
 * a population's cost). dressPopulation() draws the looks; the two together are exactly populate().
 */
export interface PopulationShapes {
  readonly options: PopulationOptions;
  readonly entities: readonly CastEntity[];
  readonly bodies: readonly BodyShape[];
  readonly bodyEntity: readonly number[];
  readonly attributes: readonly AttributeShapeDesign[];
  readonly units: readonly PopUnitShape[];
  readonly ms: number;
}

export interface Population {
  readonly options: PopulationOptions;
  readonly entities: readonly CastEntity[];
  readonly bodies: readonly BodyShape[];
  /** Which entity each body is of. */
  readonly bodyEntity: readonly number[];
  readonly attributes: readonly AttributeShapeDesign[];
  readonly units: readonly PopUnit[];
  /** Which candidate each re-rolled look took: what a unit alone can't know (hybrid.ts stores them). */
  readonly exceptions: PopExceptions;
  readonly stats: {
    readonly bodies: number;
    readonly attributeShapes: number;
    readonly looks: number;
    /** Body looks re-rolled to keep clear of their kind, and any that couldn't be (took the farthest found). */
    readonly rerolls: number;
    readonly failures: number;
    /** The same for attribute looks (a hat's look near another hat's only lowers variety; the unit's own look decides). */
    readonly attributeRerolls: number;
    readonly attributeFailures: number;
    readonly ms: number;
  };
}

function contractFits(attr: AnyAttributeDef, body: string): boolean {
  const b = splitRef(body);
  return attr.targets.some((t) => { const r = splitRef(t.body); return r.name === b.name && satisfies(b.range, r.range); });
}
const bodyFits = (attr: AnyAttributeDef, entity: EntityDef<EntitySpec>): boolean => contractFits(attr, entity.body);

const now = (): number => (globalThis.performance ? performance.now() : Date.now());
const sorted = (o: Readonly<Record<string, unknown>>): string => Object.keys(o).sort().map((k) => `${k}=${String(o[k])}`).join("&");
const hundredths = (v: number): number => Math.round(v * 100) / 100;

// (Every unit's layers hang off one roll per 65,536 units, each (unit, layer) a slot of its own: a private
// sequence 4096 draws long -- no per-unit seed to hash, which a population does tens of thousands of times.)
const LAYER_SLOT = { body: 0, wear: 1, anim: 2 } as const;
const BLOCK = 65536;
const rolls = new Map<string, Roll>();
/** A unit's layer's own stream: (seed, unit, layer) -- "body", "wear", "anim"; any other name is its own seed ("wear/beanie"). */
export function layerStream(seed: string, unit: number, layer: string): Stream {
  const slot = (LAYER_SLOT as Readonly<Record<string, number>>)[layer];
  if (slot === undefined) return stream(createRoll(deriveSeed(seed, `population/unit/${unit}/${layer}`)), 0);
  const block = Math.floor(unit / BLOCK);
  const key = `${seed}|${block}`;
  let roll = rolls.get(key);
  if (!roll) {
    if (rolls.size >= 16) rolls.clear();
    roll = createRoll(deriveSeed(seed, `population/units/${block}`));
    rolls.set(key, roll);
  }
  return stream(roll, (unit % BLOCK) * 4 + slot);
}

/** The frame a unit shows of a clip: a moving clip by distance over its own stride, idle by time in its own style and phase (bake's frameOf, varied). */
export function unitFrame(info: ClipInfo, anim: PopAnim, dist: number, time: number): number {
  let u: number;
  if (info.cycle > 0) u = dist / (info.cycle * anim.stride);
  else { const period = info.period * (IDLE_PERIOD[anim.idle] ?? 1); u = time / period + anim.phase; }
  const f = Math.floor((u - Math.floor(u)) * info.frames);
  return f >= info.frames ? info.frames - 1 : f;
}

// ---------------------------------------------------------------- the cast: everything but the units

/** What every unit draws from, made once from the options (never from the units): bodies, variants, who may wear what. */
interface Cast {
  readonly options: PopulationOptions;
  readonly entities: readonly CastEntity[];
  /** The options' attributes, then each explicit wear's (never drawn: only worn where they're explicit). */
  readonly attributes: readonly CastAttribute[];
  readonly bodies: readonly BodyShape[];
  readonly bodyEntity: readonly number[];
  readonly bodiesOf: readonly (readonly number[])[];
  /** Per body: the attributes that may go on it (fit its entity, or an explicit body's contract, and have their socket). */
  bagOf(body: number): readonly (readonly [CastAttribute, number])[];
  readonly totalW: number;
  readonly explicitBody: ReadonlyMap<number, number>;
  readonly explicitWears: ReadonlyMap<number, readonly number[]>;
  variantsOf(attribute: string): readonly Pins[];
  entityIndex(id: string): number;
  attributeIndex(id: string): number;
  /** An attribute shape by (attribute, shape pins, the body's socket class): the same design for the same three. */
  shapeOf(attribute: number, pins: Pins, body: number): AttributeShapeDesign | null;
}

const casts = new WeakMap<PopulationOptions, Cast>();
function castOf(options: PopulationOptions): Cast {
  const had = casts.get(options);
  if (had) return had;
  const { seed, entities, attributes: attrs = [], shapes = 3, steps = 3, variants = 6, fits = bodyFits } = options;
  const clipsOf = (plan: EntitySpec["plan"]): { clips?: readonly ClipSpec[] } => (options.clips ? { clips: options.clips } : options.clipsFor ? { clips: options.clipsFor(plan) } : {});

  // Body shapes: a few per entity, shape choices on the grid (dupes fold into one shape).
  const bodies: BodyShape[] = [];
  const bodyEntity: number[] = [];
  const bodyIndex = new Map<string, number>();
  const bodiesOf: number[][] = entities.map(() => []);
  entities.forEach((e, ei) => {
    const n = e.shapes ?? shapes;
    for (let v = 0; v < n * 3 && bodiesOf[ei]!.length < n; v += 1) {
      const BS = stream(createRoll(deriveSeed(seed, `population/body/${e.def.id}/${v}`)), 0);
      const pins = { ...pickShape(e.def, BS, { steps: 3, pins: e.pins ?? {} }), ...(e.pins ?? {}) };
      const spec = e.def.build(BS, pins);
      const worn: BodyWear[] = [];
      for (const w of e.wear ?? []) if (BS.chance(w.chance) && w.defs[0]) { const p = pickShape(w.defs[0], BS, { steps }); for (const def of w.defs) worn.push({ def, pins: p }); }
      const shape = bodyShape(spec, { pack: e.pack, wear: worn, ...clipsOf(spec.plan) });
      let at = bodyIndex.get(shape.key);
      if (at === undefined) { at = bodies.length; bodies.push(shape); bodyEntity.push(ei); bodyIndex.set(shape.key, at); bodiesOf[ei]!.push(at); }
    }
  });

  const entityAt = new Map(entities.map((e, i) => [e.def.id, i]));
  const entityIndex = (id: string): number => {
    const i = entityAt.get(id);
    if (i === undefined) throw new RangeError(`A pin names entity "${id}"; the cast has ${entities.map((e) => e.def.id).join(", ")}.`);
    return i;
  };
  const totalW = entities.reduce((n, e) => n + (e.weight ?? 1), 0);

  // Explicit parts: each explicit body is a body of its own (its unit's entity, drawn or pinned), each explicit wear an attribute of its own.
  const attributes: CastAttribute[] = [...attrs];
  const explicitBody = new Map<number, number>();
  const explicitWears = new Map<number, number[]>();
  const explicitContract = new Map<number, string>();
  for (const [unit, ex] of [...(options.explicit ?? new Map<number, UnitExplicit>())].sort((a, b) => a[0] - b[0])) {
    if (!(Number.isInteger(unit) && unit >= 0 && unit < options.count)) throw new RangeError(`An explicit part is on unit ${unit}; the population has ${options.count}.`);
    if (ex.body) {
      const ei = drawEntity(layerStream(seed, unit, "body"), entities, totalW, options.pins?.get(unit), entityIndex).entity;
      const shape = bodyShape(ex.body.spec, { pack: "explicit", skin: ex.body.skin, ...(ex.body.sockets ? { sockets: ex.body.sockets } : {}), ...clipsOf(ex.body.spec.plan) });
      explicitBody.set(unit, bodies.length);
      explicitContract.set(bodies.length, contractOf({ plan: ex.body.spec.plan }).ref);
      bodies.push(shape);
      bodyEntity.push(ei);
    }
    if (ex.wears?.length) explicitWears.set(unit, ex.wears.map((w) => { attributes.push({ def: w.def, weight: 0 }); return attributes.length - 1; }));
  }
  const attributeAt = new Map<string, number>();
  attrs.forEach((a, i) => { if (!attributeAt.has(a.def.id)) attributeAt.set(a.def.id, i); });
  const attributeIndex = (id: string): number => {
    const i = attributeAt.get(id);
    if (i === undefined) throw new RangeError(`A pin names attribute "${id}"; the cast has ${attrs.map((a) => a.def.id).join(", ")}.`);
    return i;
  };

  // Each attribute's variants: shape pins on the grid, drawn once for the population (dupes fold).
  const variantsAt = new Map<string, Pins[]>();
  for (const a of attrs) {
    const VS = stream(createRoll(deriveSeed(seed, `population/variants/${a.def.id}`)), 0);
    const seen = new Map<string, Pins>();
    for (let v = 0; v < variants * 4 && seen.size < variants; v += 1) { const p = pickShape(a.def, VS, { steps }); seen.set(sorted(p), p); }
    variantsAt.set(a.def.id, [...seen.values()]);
  }

  const eligible = entities.map((e) => attrs.map((a, ai) => [a, ai] as const).filter(([a]) => fits(a.def, e.def)));
  const bags = new Map<number, (readonly [CastAttribute, number])[]>();
  const shapes2 = new Map<string, AttributeShapeDesign | null>();
  const cast: Cast = {
    options, entities, attributes, bodies, bodyEntity, bodiesOf, totalW, explicitBody, explicitWears, entityIndex, attributeIndex,
    variantsOf: (id) => variantsAt.get(id) ?? [{}],
    bagOf(bi) {
      let bag = bags.get(bi);
      if (!bag) {
        const body = bodies[bi]!;
        const contract = explicitContract.get(bi);
        const list = contract ? attrs.map((a, ai) => [a, ai] as const).filter(([a]) => contractFits(a.def, contract)) : eligible[bodyEntity[bi]!]!;
        bag = list.filter(([a]) => body.sockets[a.def.slot]);
        bags.set(bi, bag);
      }
      return bag;
    },
    shapeOf(ai, pins, bi) {
      const def = attributes[ai]!.def;
      const body = bodies[bi]!;
      const socket = body.sockets[def.slot];
      if (!socket) return null;
      const cls = socketClass(socket, body.spec.plan);
      const memo = `${ai < attrs.length ? def.id : `#${ai}`}|${sorted(pins)}|${cls.key}`;
      let s = shapes2.get(memo);
      if (s === undefined) { s = attributeShape(def, cls, pins); shapes2.set(memo, s); }
      return s;
    },
  };
  casts.set(options, cast);
  return cast;
}

/** The body layer's first draws: the entity by weight (or pinned), and the draw that picks its body. */
function drawEntity(B: Stream, entities: readonly CastEntity[], totalW: number, pins: UnitPins | undefined, entityIndex: (id: string) => number): { entity: number; pick: number } {
  let ticket = B.f() * totalW;
  let ei = 0;
  for (; ei < entities.length - 1; ei += 1) { ticket -= entities[ei]!.weight ?? 1; if (ticket < 0) break; }
  const pick = B.f();
  return { entity: pins?.body?.entity !== undefined ? entityIndex(pins.body.entity) : ei, pick };
}

// ---------------------------------------------------------------- one unit, layer by layer

interface UnitDraft {
  readonly entity: number;
  readonly body: number;
  readonly coverage: Record<string, unknown>;
  readonly wears: { readonly attribute: number; readonly design: AttributeShapeDesign }[];
  readonly anim: PopAnim;
}

function draftOf(cast: Cast, i: number): UnitDraft {
  const { seed, wear = [1, 3] } = cast.options;
  const pins = cast.options.pins?.get(i);
  // Body: its entity, one of its bodies (or its explicit body), its coverage.
  const B = layerStream(seed, i, "body");
  const { entity: ei, pick } = drawEntity(B, cast.entities, cast.totalW, pins, cast.entityIndex);
  let bi = cast.explicitBody.get(i);
  if (bi === undefined) {
    const own = cast.bodiesOf[ei]!;
    const want = pins?.body?.body;
    if (want !== undefined && !(Number.isInteger(want) && want >= 0 && want < own.length)) throw new RangeError(`Unit ${i}: body ${want} pinned; ${cast.entities[ei]!.def.id} has ${own.length}.`);
    bi = own[want ?? Math.floor(pick * own.length)]!;
  }
  const body = cast.bodies[bi]!;
  const drawn = pickLook(cast.entities[ei]!.def, B);
  const coverage = body.coverageOf(pins?.body?.coverage ? { ...drawn, ...pins.body.coverage } : drawn);

  // Wear: up to `wear` things, one per socket, the socket present on its body -- or the pinned list.
  const wears: { attribute: number; design: AttributeShapeDesign }[] = [];
  if (pins?.wear) {
    const taken = new Set<string>();
    for (const w of pins.wear) {
      const ai = cast.attributeIndex(w.attribute);
      const def = cast.attributes[ai]!.def;
      if (!body.sockets[def.slot]) throw new RangeError(`Unit ${i}: ${def.id} is pinned, and its body has no "${def.slot}" socket.`);
      if (taken.has(def.slot)) throw new RangeError(`Unit ${i}: two pinned things in "${def.slot}".`);
      taken.add(def.slot);
      const vs = cast.variantsOf(def.id);
      const v = w.variant ?? Math.floor(layerStream(seed, i, `wear/${def.id}`).f() * vs.length);
      const p = vs[v];
      if (!p) throw new RangeError(`Unit ${i}: ${def.id} variant ${v} pinned; it has ${vs.length}.`);
      const design = cast.shapeOf(ai, p, bi);
      if (design) wears.push({ attribute: ai, design });
    }
  } else {
    const W = layerStream(seed, i, "wear");
    const want = wear[0] + Math.floor(W.f() * (wear[1] - wear[0] + 1));
    const bag = cast.bagOf(bi).slice();
    const taken = new Set<string>();
    for (let k = 0; k < want && bag.length; k += 1) {
      const w = bag.reduce((n, [a]) => n + (a.weight ?? 1), 0);
      let t = W.f() * w;
      let j = 0;
      for (; j < bag.length - 1; j += 1) { t -= bag[j]![0].weight ?? 1; if (t < 0) break; }
      const [a, ai] = bag.splice(j, 1)[0]!;
      if (taken.has(a.def.slot)) { k -= 1; continue; }
      taken.add(a.def.slot);
      const vs = cast.variantsOf(a.def.id);
      const design = cast.shapeOf(ai, vs[Math.floor(W.f() * vs.length)]!, bi);
      if (design) wears.push({ attribute: ai, design });
    }
  }
  // Explicit wears take their sockets (whatever was drawn there goes).
  for (const ai of cast.explicitWears.get(i) ?? []) {
    const def = cast.attributes[ai]!.def;
    const design = cast.shapeOf(ai, {}, bi);
    if (!design) throw new RangeError(`Unit ${i}: an explicit part sits in "${def.slot}", and its body has no such socket.`);
    const at = wears.findIndex((w) => cast.attributes[w.attribute]!.def.slot === def.slot);
    if (at >= 0) wears.splice(at, 1);
    wears.push({ attribute: ai, design });
  }

  // Anim: four draws, always (a pin never moves the others).
  const A = layerStream(seed, i, "anim");
  const d0 = A.f(), d1 = A.f(), d2 = A.f(), d3 = A.f();
  const ap = pins?.anim;
  const anim: PopAnim = {
    speed: ap?.speed ?? hundredths(0.88 + d0 * 0.24),
    stride: ap?.stride ?? hundredths(0.9 + d1 * 0.2),
    idle: ap?.idle ?? Math.floor(d2 * IDLE_STYLES.length),
    phase: ap?.phase ?? Math.floor(d3 * 64) / 64,
  };
  return { entity: ei, body: bi, coverage, wears, anim };
}

/** Where a unit's looks come from: the batch's pools (and what they record), or the exceptions (no pool). */
interface LookSource {
  body(i: number, seed: string, roles: LookRoles, options: LookOptions, group: string): Look;
  wear(i: number, attribute: string, seed: string, roles: LookRoles, options: LookOptions, group: string): Look;
}

function poolSource(threshold: number, attributeThreshold: number): LookSource & { bodyPool: LookPool; attrPool: LookPool; exceptions: PopExceptions } {
  const bodyPool = createLookPool({ threshold });
  const attrPool = createLookPool({ threshold: attributeThreshold, tries: 8 });
  const look = new Map<number, number>();
  const wears = new Map<number, Map<string, number>>();
  return {
    bodyPool, attrPool, exceptions: { look, wears },
    body(i, seed, roles, o, group) { const l = bodyPool.draw(seed, roles, o, group); if (bodyPool.lastTry) look.set(i, bodyPool.lastTry); return l; },
    wear(i, id, seed, roles, o, group) {
      const l = attrPool.draw(seed, roles, o, group);
      if (attrPool.lastTry) (wears.get(i) ?? wears.set(i, new Map()).get(i)!).set(id, attrPool.lastTry);
      return l;
    },
  };
}
function exceptionSource(ex: PopExceptions): LookSource {
  return {
    body: (i, seed, roles, o) => candidateLook(seed, ex.look.get(i) ?? 0, roles, o),
    wear: (i, id, seed, roles, o) => candidateLook(seed, ex.wears.get(i)?.get(id) ?? 0, roles, o),
  };
}

const DEFAULT_ROLES: LookRoles = { fur: {}, cloth: {}, clothAlt: {}, accent: {}, dark: {} };
const withPins = (o: LookOptions, pins: Pins | undefined): LookOptions => (pins && Object.keys(pins).length ? { ...o, pins: { ...(o.pins ?? {}), ...pins } } : o);

/** A unit's looks (body, what's baked in, each worn thing's), its wears in socket order, its signature. */
function dressUnit(cast: Cast, i: number, u: UnitDraft, src: LookSource): { look: Look; wornLook: Look | null; wears: { attribute: number; design: AttributeShapeDesign; look: Look }[]; signature: string } {
  const { seed } = cast.options;
  const lookOptions = cast.options.look ?? {};
  const pins = cast.options.pins?.get(i);
  const e = cast.entities[u.entity]!;
  const body = cast.bodies[u.body]!;
  const unitSeed = `${seed}/unit/${i}`;
  const roles: LookRoles = e.def.look?.roles ?? DEFAULT_ROLES;
  // (Kept apart from its own kind in the same coverage: a tee and a jacket already read as two characters.)
  const look = src.body(i, unitSeed, roles, withPins(lookOptions, pins?.look), `${e.def.id}|${sorted(u.coverage)}`);
  const wornLook = body.worn.length ? lookOf(`${unitSeed}/worn`, body.wornRoles, lookOptions) : null;
  const wears = u.wears.map(({ attribute: ai, design }) => {
    const a = cast.attributes[ai]!;
    const aroles: LookRoles = a.def.look?.roles ?? Object.fromEntries(design.roles.map((r) => [r, {}]));
    // (Kept apart from the same hat on others -- the same shape -- by a smaller step: the unit's own look decides who's who.)
    return { attribute: ai, design, look: src.wear(i, a.def.id, `${unitSeed}/${a.def.id}`, aroles, withPins(lookOptions, pins?.wearLooks?.[a.def.id]), design.key) };
  });
  wears.sort((x, y) => (x.design.socket < y.design.socket ? -1 : 1));
  const signature = `${body.key}|${sorted(u.coverage)}|${look.signature}${wornLook ? `+${wornLook.signature}` : ""}|${wears.map((w) => `${w.design.key}:${w.look.signature}`).join(",")}`;
  return { look, wornLook, wears, signature };
}

// ---------------------------------------------------------------- the batch

/** Everyone, as populate() makes them, with every look drawn. Deterministic from the seed and the lists' order. */
export function populate(options: PopulationOptions): Population {
  return dressPopulation(populateShapes(options));
}

// (The drafts behind a PopulationShapes, for dressPopulation: the same objects, no second derivation.)
const drafts = new WeakMap<PopulationShapes, readonly UnitDraft[]>();

/** A population's shapes and its units' shapes, no looks yet (see PopulationShapes). */
export function populateShapes(options: PopulationOptions): PopulationShapes {
  const t0 = now();
  const cast = castOf(options);
  const attrShapes: AttributeShapeDesign[] = [];
  const attrIndex = new Map<AttributeShapeDesign, number>();
  const byKey = new Map<string, number>();
  // (Attribute shapes are numbered as units first wear them; equal keys fold into one.)
  const indexOf = (d: AttributeShapeDesign): number => {
    let at = attrIndex.get(d);
    if (at === undefined) {
      at = byKey.get(d.key);
      if (at === undefined) { at = attrShapes.length; attrShapes.push(d); byKey.set(d.key, at); }
      attrIndex.set(d, at);
    }
    return at;
  };
  const list: UnitDraft[] = [];
  const units: PopUnitShape[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const u = draftOf(cast, i);
    list.push(u);
    units.push({ entity: u.entity, body: u.body, coverage: u.coverage, wears: u.wears.map((w) => ({ shape: indexOf(w.design), attribute: w.attribute })), anim: u.anim });
  }
  const shapes: PopulationShapes = { options, entities: cast.entities, bodies: cast.bodies, bodyEntity: cast.bodyEntity, attributes: attrShapes, units, ms: now() - t0 };
  drafts.set(shapes, list);
  return shapes;
}

/**
 * Draw every unit's looks (in unit order, as populate does): a body look kept clear of its kind in its coverage, a
 * look for what's baked into its body, one for each thing it wears -- through the look pools, recording which
 * candidate each re-rolled look took; or, when the options carry those exceptions, straight from them (no pool: much
 * faster, and the same looks). (Looks draw from their own seeds, never from the shapes' streams.)
 */
export function dressPopulation(shapes: PopulationShapes): Population {
  const t0 = now();
  const { options, entities, bodies, bodyEntity, attributes: attrShapes } = shapes;
  const cast = castOf(options);
  const { threshold = 0.08, attributeThreshold = 0.03 } = options;
  const pools = options.exceptions ? null : poolSource(threshold, attributeThreshold);
  const src: LookSource = pools ?? exceptionSource(options.exceptions!);
  const list = drafts.get(shapes);
  const index = new Map(attrShapes.map((d, i) => [d.key, i]));
  const units: PopUnit[] = shapes.units.map((s, i) => {
    const u: UnitDraft = list?.[i] ?? { ...s, coverage: { ...s.coverage }, wears: s.wears.map((w) => ({ attribute: w.attribute, design: attrShapes[w.shape]! })) };
    const d = dressUnit(cast, i, u, src);
    return { entity: s.entity, body: s.body, coverage: s.coverage, look: d.look, wornLook: d.wornLook, wears: d.wears.map((w) => ({ shape: index.get(w.design.key)!, look: w.look })), anim: s.anim, signature: d.signature };
  });
  const looks = new Set<string>();
  for (const u of units) { looks.add(u.look.signature); for (const w of u.wears) looks.add(w.look.signature); }
  const exceptions = pools?.exceptions ?? options.exceptions!;
  const rerolls = pools ? pools.bodyPool.rerolls : exceptions.look.size;
  let wearRerolls = 0;
  for (const m of exceptions.wears.values()) wearRerolls += m.size;
  return {
    options, entities, bodies, bodyEntity, attributes: attrShapes, units, exceptions,
    stats: {
      bodies: bodies.length, attributeShapes: attrShapes.length, looks: looks.size, rerolls, failures: pools?.bodyPool.failures ?? 0,
      attributeRerolls: pools ? pools.attrPool.rerolls : wearRerolls, attributeFailures: pools?.attrPool.failures ?? 0, ms: shapes.ms + now() - t0,
    },
  };
}

// ---------------------------------------------------------------- one unit alone

/** A unit on its own: its shapes by design (not by a population's numbering), its looks, its animation. */
export interface LoneUnit {
  readonly index: number;
  readonly entity: number;
  readonly body: BodyShape;
  readonly coverage: Readonly<Record<string, unknown>>;
  readonly look: Look;
  readonly wornLook: Look | null;
  /** What it wears, in socket order: the shape, its attribute's index (the population's attributes list), its look. */
  readonly wears: readonly { readonly shape: AttributeShapeDesign; readonly attribute: number; readonly look: Look }[];
  readonly anim: PopAnim;
  readonly signature: string;
}

/**
 * Unit i of a population, derived alone: the cast once (cached per options object), then only this unit's layers.
 * With the options' exceptions it is exactly the batch's unit i; without them, each look is its first candidate
 * (the batch's too, unless that look was re-rolled).
 */
export function populationUnit(options: PopulationOptions, i: number): LoneUnit {
  if (!(Number.isInteger(i) && i >= 0 && i < options.count)) throw new RangeError(`Unit ${i}: the population has ${options.count}.`);
  const cast = castOf(options);
  const u = draftOf(cast, i);
  const d = dressUnit(cast, i, u, exceptionSource(options.exceptions ?? { look: new Map(), wears: new Map() }));
  return { index: i, entity: u.entity, body: cast.bodies[u.body]!, coverage: u.coverage, look: d.look, wornLook: d.wornLook, wears: d.wears.map((w) => ({ shape: w.design, attribute: w.attribute, look: w.look })), anim: u.anim, signature: d.signature };
}

/**
 * What baking a population costs, in sprites: layered (each body shape's frames x directions, plus each attribute
 * shape's directions) against combined (every distinct body + worn-shapes combination baked whole), and against
 * a bake per unit (every character its own design, colours baked in -- the old way to have them all differ).
 */
export function bakeCost(pop: Population, directions = 8): { layered: number; bodies: number; attributes: number; combined: number; combos: number; perUnit: number } {
  const frames = (b: BodyShape) => b.clips.reduce((n, c) => n + c.frames, 0);
  const bodies = pop.bodies.reduce((n, b) => n + frames(b) * directions, 0);
  const attributes = pop.attributes.length * directions;
  const combos = new Map<string, number>();
  let perUnit = 0;
  for (const u of pop.units) {
    const f = frames(pop.bodies[u.body]!) * directions;
    combos.set(`${u.body}|${u.wears.map((w) => w.shape).join(",")}`, f);
    perUnit += f;
  }
  return { layered: bodies + attributes, bodies, attributes, combined: [...combos.values()].reduce((a, b) => a + b, 0), combos: combos.size, perUnit };
}
