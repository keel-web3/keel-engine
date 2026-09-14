// Styled objects: one design description, built in any style. The world's
// content -- trees, rocks, houses, bridges -- is written once, as a design
// function over SHAPE choices (what it is: a canopy's form, a roof type, a
// span's length) with LOOK roles (what its parts are: bark, leaf, wall, roof),
// and drawn in whichever style the caller picks (style.ts: pixel, voxel, any
// module's own). What a level places is a record:
//
//   { pack: "packs/foliage", id: "oak", seed, pins, look: { seed, profile, pins }, style, tier, pos, yaw, scale }
//
//   const oak = defineStyledObject({
//     id: "oak", tags: ["tree"], tier: "background",
//     choices: { height: { range: [5, 9] }, canopy: ["round", "tall", "spread"], season: ["spring", "summer", "autumn"] },
//     look: { roles: { bark: { as: "detail", stuff: "wood" }, leaf: { as: "primary" } }, choices: ["season"] },
//     sway: { amp: 0.03, hz: 0.4, bend: 1.6, from: 1.2 },
//     design: (J, v) => ({ solids: [solid.cylinder("bark", [0, 0, 0], 0.3, v.height * 0.5), solid.ball("leaf", ...)], front: null }),
//   });
//   const built = oak.build({ seed: "7", pins: { canopy: "spread" }, style: "voxel" });
//   built.def        an ObjectDef (defineObject): parts in that style, the DESIGN's colliders and sockets
//   built.key        the bake key: pack, id, style and a hash of the geometry (two pins that make the same shape share it)
//
// Every choice draws, pinned or not (a pin never moves another). The design
// is a pure function of its shape values: its own jitter comes from a stream
// seeded by them (and an implicit `variant` choice, 0..variants-1), never by
// the placement's seed -- so a population drawn on a grid of shape values
// reuses a handful of shapes (bake cache hits), and every instance still
// wears its own look.

import { createRoll, deriveSeed, dhypot, stream } from "@keel-engine/core";
import type { Look, LookRoles, Stream, Vec3 } from "@keel-engine/core";
import type { Choice, ContentEntry, Pins } from "@keel-engine/runtime";
import { canonical, collidersOfDesign, drawnIn, hashText } from "./design.ts";
import type { Design, SwaySpec } from "./design.ts";
import { defineObject, placeObject } from "./object.ts";
import type { ObjectDef, ObjectInstance, ObjectPart } from "./object.ts";
import { pixelStyle } from "./pixel.ts";
import { defaultStyles, styleChain } from "./style.ts";
import type { StyleBuilder, StyleParams, StyleRegistry, StyleSetting, StyledPart } from "./style.ts";
import { swayPose } from "./sway.ts";
import { checkWorldRoles, lookRolesOf, slotOf, worldLook } from "./world-look.ts";
import type { WorldProfile, WorldRoles } from "./world-look.ts";

/** The bake's streaming tiers: what loads first (main), what dresses the view (foreground), what fills the distance (background). */
export type Tier = "main" | "foreground" | "background";
export const TIERS: readonly Tier[] = ["main", "foreground", "background"];

export type ChoiceValue = string | number | boolean;
/** The values a build sees: every choice, pinned or drawn. */
export type Values = Readonly<Record<string, ChoiceValue>>;

export interface StyledLook {
  /** World roles -> the slot each paints and what it's made of (world-look.ts). */
  readonly roles: WorldRoles;
  /** Choices applied at draw time (a season, a coat of paint): never part of the shape. */
  readonly choices?: readonly string[] | undefined;
  /** The profiles (seasons, biomes, cultures) that suit it, by id: its pack's. The first is its default. */
  readonly profiles?: readonly string[] | undefined;
}

/** How a placer should treat it: "massive" (grass: thousands, draw shapes on a coarse grid), "many" (trees), "few" (buildings). */
export type Instancing = "massive" | "many" | "few";

export interface StyledObjectSpec {
  readonly id: string;
  readonly title?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly choices?: Readonly<Record<string, Choice>> | undefined;
  /** Which choices change its geometry (default: every one that isn't a look choice). */
  readonly shape?: readonly string[] | undefined;
  readonly look: StyledLook;
  /** Default "main". */
  readonly tier?: Tier | undefined;
  /** How many shape variants its own jitter has (the implicit `variant` choice; default 8). */
  readonly variants?: number | undefined;
  readonly instancing?: Instancing | undefined;
  /** Bake one direction (it looks the same from every side, or a fixed camera never turns it). */
  readonly billboard?: boolean | undefined;
  /** Its wind (the design may override). */
  readonly sway?: SwaySpec | null | undefined;
  /** The style it's drawn in when nobody says (default "pixel"), and what to fall back to before pixel. */
  readonly defaultStyle?: string | undefined;
  readonly fallback?: string | undefined;
  /** Its own builders for some styles (it knows better than the generic ones). */
  readonly styles?: Readonly<Record<string, StyleBuilder>> | undefined;
  /** The design: a pure function of its shape values (J: a stream seeded by them, for jitter). */
  design(J: Stream, v: Values): Design;
}

export interface BuildOptions {
  /** The placement's seed: draws the choices not pinned. */
  readonly seed?: string | number | undefined;
  readonly pins?: Pins | undefined;
  /** The style asked for (a locked setting overrides it). */
  readonly style?: string | undefined;
  readonly setting?: StyleSetting | undefined;
  readonly registry?: StyleRegistry | undefined;
  /** The style's knobs (voxel unit, detail): part of the key. */
  readonly params?: StyleParams | undefined;
}

export interface StyledMeta {
  readonly styled: {
    readonly pack: string | null;
    readonly id: string;
    readonly style: string;
    readonly wanted: string;
    readonly fellBack: boolean;
    readonly why: string;
    readonly key: string;
    readonly shape: Values;
    readonly tier: Tier;
  };
  readonly [k: string]: unknown;
}

export interface BuiltObject {
  readonly pack: string | null;
  readonly id: string;
  /** The style it's drawn in, what was wanted, and whether (and why) it fell back. */
  readonly style: string;
  readonly wanted: string;
  readonly fellBack: boolean;
  readonly why: string;
  /** The bake key: pack/id@style~geometry hash. Equal keys, identical parts. */
  readonly key: string;
  /** Its shape values (what the design saw) and every value (look choices too). */
  readonly shape: Values;
  readonly values: Values;
  readonly def: ObjectDef<StyledMeta>;
  readonly design: Design;
  readonly roles: WorldRoles;
  readonly sway: SwaySpec | null;
  readonly tier: Tier;
  /** Bake one direction. */
  readonly billboard: boolean;
  readonly stats: Readonly<Record<string, number>>;
  /** The style's own intermediate (a VoxelModel). */
  readonly model?: unknown;
}

export interface StyledObjectDef {
  readonly type: "styled-object";
  readonly id: string;
  /** The pack it's in (set by defineContentPack). */
  readonly pack: string | null;
  readonly title?: string | undefined;
  readonly tags: readonly string[];
  /** Every choice, the implicit `variant` included. */
  readonly choices: Readonly<Record<string, Choice>>;
  readonly shape: readonly string[];
  readonly look: StyledLook;
  readonly tier: Tier;
  readonly instancing: Instancing;
  readonly billboard: boolean;
  readonly sway: SwaySpec | null;
  readonly defaultStyle: string;
  readonly spec: StyledObjectSpec;
  /** Its choices drawn (pins win): every value. */
  values(seed?: string | number, pins?: Pins): Values;
  /** The design for these shape values. */
  designOf(shape: Values): Design;
  build(options?: BuildOptions): BuiltObject;
  /** Its world roles as core's look roles (by slot): for lookOf and the bake's paintRoles. */
  lookRoles(): LookRoles;
}

const ASSET_ID = /^[a-z0-9][a-z0-9-]*$/;

function isRange(c: Choice): c is { readonly range: readonly [number, number] } {
  return !Array.isArray(c) && typeof c === "object" && c !== null && "range" in c;
}

/** Draw every choice in order (pins win, checked); ranges uniformly, lists by pick. */
export function drawChoices(owner: string, choices: Readonly<Record<string, Choice>>, S: Stream, pins: Pins = {}): Record<string, ChoiceValue> {
  const out: Record<string, ChoiceValue> = {};
  for (const [name, c] of Object.entries(choices)) {
    const pin = pins[name];
    if (isRange(c)) {
      const [lo, hi] = c.range;
      const drawn = S.between(lo, hi);
      if (pin === undefined) { out[name] = drawn; continue; }
      if (typeof pin !== "number" || !(pin >= lo - 1e-9 && pin <= hi + 1e-9)) throw new RangeError(`${owner}: ${name} = ${JSON.stringify(pin)} is outside ${lo}..${hi}.`);
      out[name] = pin;
    } else {
      const list = c as readonly ChoiceValue[];
      const drawn = S.pick(list);
      if (pin === undefined) { out[name] = drawn; continue; }
      if (!list.includes(pin as ChoiceValue)) throw new RangeError(`${owner}: ${name} = ${JSON.stringify(pin)} is not one of ${JSON.stringify(list)}.`);
      out[name] = pin as ChoiceValue;
    }
  }
  return out;
}

/** A choice's values on a grid: a list as it is, a range as `steps` evenly spaced values (rounded to 1/1000). */
export function gridOf(c: Choice, steps = 3): readonly ChoiceValue[] {
  if (!isRange(c)) return c as readonly ChoiceValue[];
  const [lo, hi] = c.range;
  if (steps <= 1) return [Math.round(((lo + hi) / 2) * 1000) / 1000];
  return Array.from({ length: steps }, (_, i) => Math.round((lo + ((hi - lo) * i) / (steps - 1)) * 1000) / 1000);
}

/** Shape pins on a grid (a population's: a few shapes, many looks). Given pins win. */
export function shapeGrid(def: Pick<StyledObjectDef, "choices" | "shape">, S: Stream, { steps = 3, pins = {} }: { steps?: number; pins?: Pins } = {}): Record<string, ChoiceValue> {
  const out: Record<string, ChoiceValue> = {};
  for (const name of def.shape) {
    const c = def.choices[name];
    if (!c) continue;
    const drawn = S.pick(gridOf(c, steps));
    out[name] = (pins[name] as ChoiceValue | undefined) ?? drawn;
  }
  return out;
}

/** How many shapes a grid of `steps` can make (what a massive population bakes at most, per style). */
export function shapeCount(def: Pick<StyledObjectDef, "choices" | "shape">, steps = 3): number {
  return def.shape.reduce((n, name) => n * (def.choices[name] ? gridOf(def.choices[name]!, steps).length : 1), 1);
}

const PARTS_OK = (p: StyledPart): boolean => "box" in p || "capsule" in p || "wedge" in p || ("c" in p && "h" in p) || ("a" in p && "b" in p);

function checkParts(owner: string, style: string, roles: WorldRoles, parts: readonly StyledPart[]): void {
  if (!parts.length) throw new RangeError(`${owner}: style ${style} made no parts.`);
  for (const p of parts) {
    if (!roles[p.role]) throw new RangeError(`${owner}: style ${style} made a part with role "${p.role}", which the look hasn't got (${Object.keys(roles).join(", ")}).`);
    if (!PARTS_OK(p)) throw new TypeError(`${owner}: style ${style} made part ${p.name}, which isn't a box, wedge or capsule (the renderer and the bake draw those).`);
  }
}

// (The geometry as text, for the key: every part's solid and role.)
function geometryText(parts: readonly ObjectPart[]): string {
  return parts.map((p) => {
    const role = (p as { role?: string }).role ?? p.mat;
    if (p.wedge) return `w${role}:${canonical(p.wedge)}`;
    if (p.prim) return `${p.prim.type[0]}${role}:${canonical(p.prim)}`;
    return `s${role}:${canonical(p.bounds)}`;
  }).join("|");
}

const MEMO = 512;

function makeDef(spec: StyledObjectSpec, pack: string | null): StyledObjectDef {
  const owner = pack ? `${pack}/${spec.id}` : spec.id;
  const variants = Math.max(1, Math.round(spec.variants ?? 8));
  const choices: Record<string, Choice> = { ...(spec.choices ?? {}) };
  if (!choices["variant"]) choices["variant"] = Array.from({ length: variants }, (_, i) => i);
  const lookChoices = new Set(spec.look.choices ?? []);
  for (const n of lookChoices) if (!choices[n]) throw new TypeError(`${owner}: look choice "${n}" isn't in its choices.`);
  const shape = spec.shape ? [...spec.shape, ...(spec.shape.includes("variant") ? [] : ["variant"])] : Object.keys(choices).filter((k) => !lookChoices.has(k));
  for (const n of shape) {
    if (!choices[n]) throw new TypeError(`${owner}: shape choice "${n}" isn't in its choices.`);
    if (lookChoices.has(n)) throw new TypeError(`${owner}: "${n}" can't be shape and look both.`);
  }
  checkWorldRoles(owner, spec.look.roles);
  const tier = spec.tier ?? "main";
  if (!TIERS.includes(tier)) throw new RangeError(`${owner}: tier is ${TIERS.join(", ")}.`);
  const designs = new Map<string, Design>();
  const built = new Map<string, BuiltObject>();
  const remember = <T>(m: Map<string, T>, k: string, v: T): T => { if (m.size >= MEMO) m.delete(m.keys().next().value!); m.set(k, v); return v; };

  const values = (seed: string | number = 0, pins: Pins = {}): Values =>
    drawChoices(owner, choices, stream(createRoll(deriveSeed(String(seed), `styled:${spec.id}`)), 0), pins);

  const designOf = (shapeValues: Values): Design => {
    const k = canonical(shapeValues);
    const have = designs.get(k);
    if (have) return have;
    const J = stream(createRoll(deriveSeed(`styled:${spec.id}`, k)), 1);
    const d = spec.design(J, shapeValues);
    if (!d || !Array.isArray(d.solids) || !d.solids.length) throw new TypeError(`${owner}: its design made no solids.`);
    for (const s of d.solids) if (!spec.look.roles[s.role]) throw new RangeError(`${owner}: a ${s.kind} has role "${s.role}", which the look hasn't got (${Object.keys(spec.look.roles).join(", ")}).`);
    return remember(designs, k, d);
  };

  const def: StyledObjectDef = {
    type: "styled-object",
    id: spec.id,
    pack,
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    tags: [...(spec.tags ?? [])],
    choices,
    shape,
    look: spec.look,
    tier,
    instancing: spec.instancing ?? "few",
    billboard: spec.billboard ?? false,
    sway: spec.sway ?? null,
    defaultStyle: spec.defaultStyle ?? "pixel",
    spec,
    values,
    designOf,
    lookRoles: () => lookRolesOf(spec.look.roles),
    build({ seed = 0, pins = {}, style, setting, registry = defaultStyles, params }: BuildOptions = {}): BuiltObject {
      const all = values(seed, pins);
      const sv: Record<string, ChoiceValue> = {};
      for (const n of shape) sv[n] = all[n]!;
      const design = designOf(sv);
      const chain = styleChain({ requested: style, setting, own: spec.styles, assetDefault: spec.defaultStyle, assetFallback: spec.fallback, registry });
      // (The setting's knobs are for the setting's style; the caller's win.)
      const knobsFor = (name: string): StyleParams => ({ ...(setting && setting.style === name ? setting.params ?? {} : {}), ...(params ?? {}) });
      const memoKey = `${canonical(sv)}|${chain.wanted}${chain.note}|${chain.candidates.map((c) => c.name).join(">")}|${canonical(params ?? {})}|${canonical(setting?.params ?? {})}`;
      const have = built.get(memoKey);
      if (have) return { ...have, values: all };

      let used: { name: string; parts: readonly StyledPart[]; stats: Readonly<Record<string, number>>; model?: unknown } | null = null;
      const declined: string[] = [];
      for (const c of chain.candidates) {
        const r = c.build(design, knobsFor(c.name));
        if (!r) { declined.push(c.name); continue; }
        checkParts(owner, c.name, spec.look.roles, r.parts);
        used = { name: c.name, parts: r.parts, stats: r.stats ?? {}, ...(r.model !== undefined ? { model: r.model } : {}) };
        break;
      }
      if (!used) throw new Error(`${owner}: no style drew it (${declined.join(", ")} declined).`);

      // The design's colliders and sockets -- one set, whatever the style: sockets (the auto top and view too)
      // are worked out once on the pixel parts and handed to every style's definition.
      const colliders = collidersOfDesign(design);
      const common = {
        key: spec.id,
        colliders,
        ...(design.front !== undefined ? { front: design.front } : {}),
        ...(design.show !== undefined ? { show: design.show } : {}),
        rest: design.rest ?? "base",
        rails: design.rails ?? [],
      };
      const pixelParts = used.name === "pixel" ? used.parts : (pixelStyle.build(design, {})?.parts ?? []);
      const ref = defineObject({ ...common, parts: pixelParts, sockets: design.sockets ?? {} });
      const sway = design.sway === undefined ? spec.sway ?? null : design.sway;
      const fellBack = used.name !== chain.wanted;
      const why = fellBack
        ? `${chain.wanted} ${declined.includes(chain.wanted) ? "declined this design" : "isn't available (nothing provides style/" + chain.wanted + ")"}; drawn in ${used.name}${chain.note}`
        : `${used.name}${chain.note}`;
      const tags = [...new Set([...(spec.tags ?? []), ...(design.tags ?? []), `tier:${tier}`, `style:${used.name}`])];
      const draft = used.name === "pixel" ? ref : defineObject({ ...common, parts: used.parts, sockets: ref.sockets });
      const key = `obj:${pack ?? "-"}/${spec.id}@${used.name}~${hashText(geometryText(draft.parts))}`;
      const meta: StyledMeta = {
        ...(design.meta ?? {}),
        styled: { pack, id: spec.id, style: used.name, wanted: chain.wanted, fellBack, why, key, shape: sv, tier },
      };
      // (Exactly the reference's sockets: defineObject would add an auto top of its own where the pixel parts had none.)
      const final: ObjectDef<StyledMeta> = { ...defineObject<StyledMeta>({ ...common, parts: draft.parts, sockets: ref.sockets, tags, meta }), sockets: ref.sockets };
      const out: BuiltObject = {
        pack, id: spec.id, style: used.name, wanted: chain.wanted, fellBack, why, key, shape: sv, values: all,
        def: final, design, roles: spec.look.roles, sway, tier, billboard: spec.billboard ?? false,
        stats: { ...used.stats, parts: final.parts.length, colliders: final.colliders.length },
        ...(used.model !== undefined ? { model: used.model } : {}),
      };
      return remember(built, memoKey, out);
    },
  };
  return Object.freeze(def);
}

/** A styled object: one design, built in any style (see the top). */
export function defineStyledObject(spec: StyledObjectSpec): StyledObjectDef {
  if (!ASSET_ID.test(spec.id)) throw new TypeError(`Object id "${spec.id}": lower-case letters, digits and dashes.`);
  if (typeof spec.design !== "function") throw new TypeError(`Object ${spec.id}: design(J, values) is missing.`);
  return makeDef(spec, null);
}

// ---------------------------------------------------------------- looks

/** A look for a built thing (or a def): its world roles drawn from a seed in a profile. */
export function lookFor(def: Pick<StyledObjectDef, "look"> | Pick<BuiltObject, "roles">, seed: string, options: { profile?: WorldProfile; pins?: Pins } = {}): Look {
  const roles = "roles" in def ? def.roles : def.look.roles;
  return worldLook(roles, seed, options);
}

// ---------------------------------------------------------------- the bake

/** A built thing as the bake's design (@keel-engine/bake's DesignSpec + IndexedSource, structurally). */
export interface StyledBakeDesign {
  readonly key: string;
  readonly clips: ReadonlyArray<{ readonly name: string; readonly frames: number; readonly loop?: boolean }>;
  readonly height: number;
  readonly radius: number;
  readonly symmetric?: boolean;
  /** Core's look roles by slot, for the bake's paintRoles. */
  readonly roles: LookRoles;
  readonly tier: Tier;
  pose(clip: string, frame: number): {
    boxes: Array<{ c: Vec3; h: Vec3; yaw: number; mat: number }>;
    wedges: Array<{ c: Vec3; h: Vec3; yaw: number; lo: number; mat: number; kind: "wedge" }>;
    capsules: Array<{ a: Vec3; b: Vec3; r: number; mat: number }>;
  };
}

/**
 * A built thing for the bake: every part on its role's slot (world-look.ts slotOf), keyed by the built key. One
 * "still" frame; with `swayFrames`, a looping "sway" clip of that many bent frames too (sway.ts: the baked-frames
 * path). The indexed bake paints its looks at draw time.
 */
export function bakeDesignOf(built: BuiltObject, { swayFrames = 0 }: { swayFrames?: number } = {}): StyledBakeDesign {
  const parts = built.def.parts.filter((p) => p.render !== false);
  const b = built.def.bounds;
  const height = Math.max(0.01, b[4]);
  const radius = Math.max(0.01, dhypot(Math.max(Math.abs(b[0]), Math.abs(b[3])), Math.max(Math.abs(b[2]), Math.abs(b[5]))));
  const slot = (p: ObjectPart): number => slotOf(built.roles, (p as { role?: string }).role ?? String(p.mat));
  const poseOf = (frame: number | null): ReturnType<StyledBakeDesign["pose"]> => {
    const out: ReturnType<StyledBakeDesign["pose"]> = { boxes: [], wedges: [], capsules: [] };
    const posed = frame !== null && built.sway ? swayPose(parts, height, built.sway, frame, swayFrames) : parts.map((part) => ({ part, box: undefined, capsule: undefined, wedge: undefined }));
    for (const x of posed) {
      const mat = slot(x.part);
      const w = x.wedge ?? x.part.wedge;
      if (w) { out.wedges.push({ c: [...w.c], h: [...w.h], yaw: w.yaw, lo: w.lo, mat, kind: "wedge" }); continue; }
      const prim = x.part.prim;
      const bx = x.box ?? (prim?.type === "box" ? prim : undefined);
      const cp = x.capsule ?? (prim?.type === "capsule" ? prim : undefined);
      if (bx) out.boxes.push({ c: [...bx.c], h: [...bx.h], yaw: bx.yaw, mat });
      else if (cp) out.capsules.push({ a: [...cp.a], b: [...cp.b], r: cp.r, mat });
    }
    return out;
  };
  const still = poseOf(null);
  const clips = [{ name: "still", frames: 1 }, ...(swayFrames > 0 && built.sway ? [{ name: "sway", frames: swayFrames, loop: true }] : [])];
  return {
    key: swayFrames > 0 && built.sway ? `${built.key}|sway${swayFrames}` : built.key,
    clips, height, radius, roles: lookRolesOf(built.roles), tier: built.tier,
    ...(built.billboard ? { symmetric: true } : {}),
    pose: (clip, frame) => (clip === "sway" ? poseOf(frame) : still),
  };
}

// ---------------------------------------------------------------- packs of content and placing them

/** A pack of styled objects and the profiles they wear. */
export interface ContentPack {
  readonly id: string;
  readonly version: string;
  readonly objects: readonly StyledObjectDef[];
  readonly profiles: readonly WorldProfile[];
  get(id: string): StyledObjectDef | undefined;
  profile(id: string): WorldProfile | undefined;
  /** The manifest's table of contents (objects: id + tags, a tier:<tier> tag among them). */
  contents(): { objects: ContentEntry[] };
}

export function defineContentPack({ id, version, objects, profiles = [] }: { id: string; version: string; objects: readonly StyledObjectDef[]; profiles?: readonly WorldProfile[] }): ContentPack {
  const bound = objects.map((o) => makeDef(o.spec, id));
  const seen = new Set<string>();
  for (const o of bound) { if (seen.has(o.id)) throw new TypeError(`${id} has two objects called ${o.id}.`); seen.add(o.id); }
  const prof = new Map(profiles.map((p) => [p.id, p] as const));
  for (const o of bound) for (const p of o.look.profiles ?? []) if (!prof.has(p)) throw new RangeError(`${id}/${o.id}: profile "${p}" isn't in the pack.`);
  return Object.freeze({
    id, version, objects: Object.freeze(bound), profiles: Object.freeze([...profiles]),
    get: (x: string) => bound.find((o) => o.id === x),
    profile: (x: string) => prof.get(x),
    contents: () => ({ objects: bound.map((o) => ({ id: o.id, tags: [...o.tags, `tier:${o.tier}`, ...(o.instancing === "massive" ? ["massive"] : [])] })) }),
  });
}

/** What a level places: a thing from a pack, its pins, look, style and tier, and where. */
export interface ContentRecord {
  readonly pack: string;
  readonly id: string;
  readonly seed?: string | number | undefined;
  readonly pins?: Pins | undefined;
  readonly look?: { readonly seed?: string | undefined; readonly profile?: string | undefined; readonly pins?: Pins | undefined } | undefined;
  readonly style?: string | undefined;
  /** Default: the asset's. */
  readonly tier?: Tier | undefined;
  readonly pos?: readonly [number, number, number] | undefined;
  readonly yaw?: number | undefined;
  readonly scale?: number | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface PlacedContent {
  readonly record: ContentRecord;
  readonly built: BuiltObject;
  readonly instance: ObjectInstance<StyledMeta>;
  readonly look: Look;
  readonly tier: Tier;
}

/**
 * Place a record: find its asset in the packs, build it (the setting may lock the style), place it, and draw its
 * look (the record's look seed, else its seed; its profile, else the asset's first).
 */
export function placeContent(packs: readonly ContentPack[], record: ContentRecord, { setting, registry, params }: { setting?: StyleSetting; registry?: StyleRegistry; params?: StyleParams } = {}): PlacedContent {
  const pack = packs.find((p) => p.id === record.pack);
  if (!pack) throw new RangeError(`No pack ${record.pack} (have ${packs.map((p) => p.id).join(", ") || "none"}).`);
  const def = pack.get(record.id);
  if (!def) throw new RangeError(`${record.pack} has no ${record.id}.`);
  const built = def.build({ seed: record.seed ?? 0, pins: record.pins ?? {}, style: record.style, setting, registry, params });
  const tier = record.tier ?? def.tier;
  const instance = placeObject(built.def, { pos: record.pos ?? [0, 0, 0], yaw: record.yaw ?? 0, scale: record.scale ?? 1, tags: [...(record.tags ?? []), ...(tier !== def.tier ? [`tier:${tier}`] : [])] });
  // (A look choice whose value names one of the pack's profiles -- a season -- picks it, unless the record names one.)
  const chosen = (def.look.choices ?? []).map((n) => built.values[n]).find((v): v is string => typeof v === "string" && pack.profile(v) !== undefined);
  const profileId = record.look?.profile ?? chosen ?? def.look.profiles?.[0];
  const profile = profileId ? pack.profile(profileId) : undefined;
  if (profileId && !profile) throw new RangeError(`${record.pack} has no profile ${profileId}.`);
  const look = lookFor(def, String(record.look?.seed ?? record.seed ?? 0), { ...(profile ? { profile } : {}), pins: record.look?.pins ?? {} });
  return { record, built, instance, look, tier };
}

/** Which styles a built thing's parts come in, for tests and tools: does every solid a style draws have parts? */
export const solidsDrawn = (design: Design, style: string): number => design.solids.filter((s) => drawnIn(s, style)).length;
