// The world runtime: everything a game used to wire by hand -- entities that
// move (an entity spec, a physics body, an animator), objects that don't
// (object instances), rails, water, a camera, input, particles -- held in
// one place and stepped by SYSTEMS in a fixed order on a fixed step:
//
//   input (0) -> control (100) -> physics (200) -> animation (300)
//             -> particles (400) -> camera (500) -> custom (600 unless told)
//
// Settings are layered and lockable (./settings.ts): engine -> project ->
// scene -> seed -> tag -> id -> runtime, and a lock at any scope beats
// everything after it -- the palette for a scene, one bench's material,
// gravity, the camera mode, a species.
//
// Rendering is separate. world.frame() returns what a renderer takes (boxes,
// capsules, particles, view, palette, materials, style) as plain data, so the
// simulation runs headless in Node; world.draw(renderer) hands it to
// @keel-engine/render's pixel renderer.
//
//   const world = createWorld({ seed: "7", width: 128, height: 128, config: { project: {...} }, materials, palettes });
//   world.generate((g) => { g.place("bench", { id: "bench-1", pos: [0, 5, 0], on: "auto" }); g.spawn({ id: "cat-1", kind: "animal" }); });
//   world.system("spin", { order: 650, step(w, dt) { ... } });
//   world.simulate(10); const snap = world.snapshot(); world.restore(snap);
//   world.draw(renderer);   // in a browser
//
// Ported from the proof of concept's src/world/world.js. What differs, on
// purpose (README "Differences"): the camera, the animators and the particles
// are the engine's own (their save()/load() make a restore exact -- poses,
// blends, the fov kick and all); the camera's subject is an entity's real
// height (the camera package's small-subject fix replaces the world's 0.6 m
// floor); snapshots are v2 (a camera's and each animator's saved state).

import type { RGB, Seed, Vec3, Vec3Like } from "@keel-engine/core";
import { boxDistance, createCharacter } from "@keel-engine/physics";
import type { BodyEvent, BodyMode, Character, Rail, Tuning } from "@keel-engine/physics";
import { animator, entityOf, posed, skinOf } from "@keel-engine/entity";
import type { Animator, AnimatorBody, AnimatorSave, Capsule, EntityPins, EntitySpec, Kind, MaterialTable, Species } from "@keel-engine/entity";
import { clearance, createCamera, fillForTarget, frameView, sphereCast, subjectOf } from "@keel-engine/camera";
import type { Camera, CameraMode, CameraOptions, CameraState, CameraWorld, Subject, View } from "@keel-engine/camera";
import { createInput } from "@keel-engine/input";
import type { AttachOptions, EventTargetLike, Input, InputOptions } from "@keel-engine/input";
import { baseRecipes, createParticles } from "@keel-engine/particles";
import type { ParticleState, ParticleView, Particles, Recipes } from "@keel-engine/particles";
import { buildPieceFrom, PIECE_KEYS, placeObject, settle, worldAabb, worldColliders, worldRails } from "@keel-engine/object";
import type { ObjectDef, ObjectInstance, PieceContexts, PieceDef, PieceKey, Support, WorldBox } from "@keel-engine/object";
import { rampForTarget } from "@keel-engine/core";
import { WORLD_SNAPSHOT, decode, encode } from "@keel-engine/codec";
import { createSettings, parseLocks } from "./settings.ts";
import type { Settings, SettingsJSON, Thing } from "./settings.ts";
import type { Explanation, LayerValues, Refusal, SetOptions, SettingValue, WriteResult } from "./config.ts";
import { ENGINE_DEFAULTS } from "./defaults.ts";
import { RULE_KEYS, resolveRules, targetRules as defaultRules } from "./rules.ts";
import type { ResolvedRules, RuleName, TargetRules } from "./rules.ts";
import { namedStream, worldSeed } from "./streams.ts";
import type { NamedStream } from "./streams.ts";

/**
 * What the GPU renderer holds (@keel-engine/render MAX_BOXES, MAX_CAPS,
 * MAX_RAMPS, MAX_MATERIALS -- test/world.test.ts checks they agree). Kept here
 * so the simulation never needs the renderer; createWorld({ budget }) overrides.
 */
export const RENDER_BUDGET = Object.freeze({ boxes: 256, capsules: 256, ramps: 256, materials: 255 });
export type RenderBudget = { readonly [K in keyof typeof RENDER_BUDGET]: number };
/** The renderer's own fx passes by name (@keel-engine/render FX_NAMES; test/world.test.ts checks they agree). */
export const RENDER_FX_NAMES: readonly string[] = Object.freeze(["glow", "outline", "dither", "grade", "rim", "fog", "vignette", "scanlines", "crt", "cycle", "flash"]);

export const SYSTEM_ORDER = Object.freeze({ input: 0, control: 100, physics: 200, animation: 300, particles: 400, camera: 500, custom: 600 });

// ------------------------------------------------------------------ types

/** A renderer material slot (4 is the water and 5 the sky, by the GPU shader's contract), by name. */
export interface WorldMaterial {
  readonly name: string;
  readonly ramp: string;
  readonly light?: number | undefined;
  readonly pattern?: number | undefined;
  readonly glow?: number | undefined;
  readonly [extra: string]: unknown;
}
/** A slot as the renderer takes it (the name dropped). */
export type FrameMaterial = Omit<WorldMaterial, "name"> & { readonly ramp: string };

/** A palette by name: its ramps (dark to light) from the world and the target's rules. */
export type PaletteFn = (world: World, rules: ResolvedRules) => { readonly ramps: Readonly<Record<string, readonly (RGB | readonly number[])[]>> };

/** An entity's intent for a step: where to move ([x, z], length <= 1), jump (a press), hold. */
export interface EntityIntent {
  readonly move: readonly [number, number];
  readonly jump: boolean;
  readonly hold: boolean;
}
/** The input system's intent for a step (an @keel-engine/input sample, or a driver's). */
export interface WorldIntent extends EntityIntent {
  /** The move before the view turned it (an input sample's; absent before the first step). */
  readonly axes?: readonly [number, number];
  readonly look: readonly [number, number];
  readonly sprint?: boolean;
  readonly driver: string;
  readonly player: boolean;
}
/** A brain: the world, its entity, the step -> an intent (or nothing: idle). */
export type Brain = (world: World, ent: WorldEntity, dt: number) => Partial<EntityIntent> | null | undefined | void;
/** A driver: replaces the input device (tests, replays, bots). */
export type DriveFn = (world: World, dt: number) => Partial<WorldIntent>;

/** A clip an entity holds whatever its body does (sit, lie). */
export interface Hold {
  readonly clip: string;
  readonly params?: Readonly<Record<string, number>> | undefined;
}
/** A body without physics: moved by its intent, through everything. */
export interface FreeBody {
  pos: Vec3;
  vel: Vec3;
  facing: number;
  mode: BodyMode;
  events: BodyEvent[];
}
export type WorldBody = Character | FreeBody;
/** How an entity was made (its snapshot rebuilds it from this). */
export interface EntityMake {
  readonly seed: string;
  readonly kind: Kind;
  species?: Species;
  pins?: EntityPins;
  size?: number;
}
export interface WorldEntity {
  readonly kind: "entity";
  readonly id: string;
  readonly tags: string[];
  readonly make: EntityMake;
  readonly spec: EntitySpec;
  readonly anim: Animator;
  /** Role -> material name (fur, furAlt, cloth, clothAlt, accent, dark, blush, hair). */
  materials: Record<string, string>;
  brain: string | null;
  /** Its brain's memory (plain JSON; saved by snapshots). */
  mind: Record<string, unknown>;
  intent: EntityIntent;
  hold: Hold | null;
  /** Its physics skipped (sat on a bench). */
  frozen: boolean;
  readonly hasBody: boolean;
  readonly tuning: Partial<Tuning>;
  body: WorldBody;
  bodyKey: string;
  heldKey?: string;
  readonly size: { readonly height: number; readonly radius: number };
}
export type WorldObject = ObjectInstance<object>;

/** A system: stepped each fixed step in `order`; its state in world.state (or save/load). */
export interface SystemDef {
  readonly order?: number;
  step(world: World, dt: number): void;
  readonly enabled?: boolean;
  save?(world: World): unknown;
  load?(world: World, data: unknown): void;
}
export interface SystemInfo {
  readonly name: string;
  readonly order: number;
  readonly enabled: boolean;
}
interface SystemEntry {
  readonly name: string;
  readonly order: number;
  readonly step: (world: World, dt: number) => void;
  readonly enabled: boolean;
  readonly save: ((world: World) => unknown) | undefined;
  readonly load: ((world: World, data: unknown) => void) | undefined;
  readonly at: number;
}

/** An event on the world's bus: its type, when, and its payload. */
export interface WorldEvent {
  readonly type: string;
  readonly time: number;
  readonly step: number;
  readonly id?: string;
  readonly at?: Vec3;
  readonly [field: string]: unknown;
}
export type WorldListener = (e: WorldEvent, world: World) => void;

/** A pass in the fx list: a name and its params. */
export interface FxPassEntry {
  readonly name: string;
  readonly [param: string]: unknown;
}
/** A world fx pass: `frame` changes the renderer's inputs; `draw` runs after it draws. */
export interface FxPass {
  frame?(f: Frame, world: World, params: FxPassEntry): Frame | null | undefined | void;
  draw?(renderer: RendererLike, f: Frame, world: World): void;
}

export interface FrameBox { c: Vec3; h: Vec3; yaw: number; mat: number; id: string }
export interface FrameCapsule { a: Vec3; b: Vec3; r: number; mat: number; id: string; part?: string; role?: string }
export interface FrameView extends View {
  time: number;
  sun: Vec3;
  waterY: number;
  fogNear: number;
  fogFar: number;
}
export interface FramePalette {
  readonly name: string | undefined;
  readonly colours: (RGB | readonly number[])[];
  readonly ramps: Record<string, [number, number]>;
  readonly key: string;
}
/** What a renderer takes, as plain data. */
export interface Frame {
  boxes: FrameBox[];
  capsules: FrameCapsule[];
  particles: ParticleView[];
  view: FrameView;
  palette: FramePalette;
  materials: FrameMaterial[];
  style: { screen: number; dither: number; outline: number };
  /** Every pass's name, in order. */
  fx: string[];
  /** The renderer's own passes (its setFx list). */
  passes: FxPassEntry[];
  target: { width: number; height: number };
  rules: ResolvedRules;
  stats: { boxes: number; capsules: number; dropped: { boxes: number; entities: string[] } };
}

/** Anything draw() can hand a frame to: @keel-engine/render's PixelRenderer is one. */
export interface RendererLike {
  readonly width: number;
  readonly height: number;
  setTarget(width: number, height: number): void;
  setPalette(colours: readonly (RGB | readonly number[])[], ramps: Readonly<Record<string, readonly [number, number]>>): void;
  setMaterials(list: readonly FrameMaterial[]): void;
  setStyle(style: { screen: number; dither: number; outline: number }): void;
  setWorld(world: { boxes: readonly FrameBox[]; capsules: readonly FrameCapsule[] }): unknown;
  render(options: FrameView & { particles: readonly ParticleView[] }): void;
  /** The renderer's own passes (its fx names and params; typed by the renderer, handed f.passes as they are). */
  setFx?(list: never): void;
}

/** A thing's explanation, with the target rule behind an "auto" key. */
export interface WorldExplanation extends Explanation {
  effective?: unknown;
  rule?: string;
}

/** Where a generated object came to rest. */
export interface Rest {
  readonly support: string | number | null;
  readonly rests: boolean;
  readonly gap: number | null;
}

/** createWorld's config: flat maps of settings per scope; `locks` applied last. */
export interface WorldConfig {
  readonly engine?: LayerValues;
  readonly project?: LayerValues;
  readonly scene?: LayerValues;
  readonly runtime?: LayerValues;
  /** "scope/key=value;..." (parseLocks). */
  readonly locks?: string;
  readonly [scope: `tag:${string}` | `id:${string}`]: LayerValues;
}

export interface WorldOptions {
  /** Anything (hex bytes32 kept; other text derived). */
  readonly seed?: string | number;
  /** The target size (32x32 ... 256x256 or any W x H). */
  readonly width?: number;
  readonly height?: number;
  /** The fixed simulation step (1/120 s). */
  readonly step?: number;
  readonly config?: WorldConfig | string;
  /** The renderer's slots, by index (the GPU shader reads 4 as water and 5 as sky). */
  readonly materials?: readonly WorldMaterial[];
  readonly palettes?: Readonly<Record<string, PaletteFn>>;
  /** (w, h) -> target rules (default: targetRules). */
  readonly rules?: (width: number, height: number) => TargetRules;
  /** createInput options, or an input to use. */
  readonly input?: InputOptions | Input | undefined;
  /** createCamera options (mode, orbit/chase/frame rig options ...). */
  readonly camera?: CameraOptions;
  readonly particles?: { readonly recipes?: Recipes };
  readonly budget?: Partial<RenderBudget>;
}

export interface SpawnOptions {
  readonly id: string;
  readonly kind?: Kind;
  readonly tags?: readonly string[];
  /** Its own seed (default: `${world hex seed}|entity:${id}`). */
  readonly seed?: string;
  /** The caller's pin (a lock or a tag's / id's setting still wins). */
  readonly species?: Species;
  readonly pins?: EntityPins;
  readonly size?: number;
  readonly pos?: Vec3Like;
  readonly yaw?: number;
  /** A world.brain name: what drives it when the player isn't. */
  readonly brain?: string | null;
  /** Role -> material name. */
  readonly materials?: Readonly<Record<string, string>>;
  /** false: no physics (moved by its intent, through nothing). */
  readonly body?: boolean;
  readonly tuning?: Partial<Tuning>;
  readonly mind?: Readonly<Record<string, unknown>>;
  /** The input drives it. */
  readonly player?: boolean;
}

export interface PlaceOptions {
  readonly id: string;
  readonly pos?: Vec3Like;
  readonly yaw?: number;
  readonly scale?: number;
  readonly tags?: readonly string[];
}
export interface GenPlaceOptions<K extends PieceKey = PieceKey> extends PlaceOptions {
  /** A catalogue piece's sizes (when placing by key). */
  readonly ctx?: PieceContexts[K];
  /** Settle it: "auto" (onto whatever is placed and the ground), or a list of supports. */
  readonly on?: "auto" | readonly Support[] | null;
}
export interface FitsOptions {
  readonly pos?: Vec3Like;
  readonly yaw?: number;
  readonly scale?: number;
  readonly margin?: number;
  readonly ignore?: readonly string[];
  readonly flat?: boolean;
}
export interface ChoiceOptions<T> {
  readonly thing?: Thing | null;
  readonly weights?: readonly number[] | null;
  /** (Only to name the option type.) */
  readonly of?: T;
}

/** The generator's toolkit: lockable choices, streams, pieces, placing and settling. */
export interface Gen {
  readonly seed: Seed;
  readonly world: World;
  /** A raw stream for layout draws nothing locks (its own name, its own numbers). */
  stream(label: string): NamedStream;
  /** A lockable choice among options (weights optional): the seed's pick unless a setting says otherwise. */
  choose<T extends SettingValue>(key: string, options: readonly T[], opts?: { readonly thing?: Thing | null; readonly weights?: readonly number[] | null }): T;
  int(key: string, a: number, b: number, opts?: { readonly thing?: Thing | null }): number;
  between(key: string, a: number, b: number, opts?: { readonly thing?: Thing | null }): number;
  chance(key: string, p: number, opts?: { readonly thing?: Thing | null }): boolean;
  /** A catalogue piece for a thing: its own stream, sizes from ctx, then the thing's "piece.<size>" settings. */
  piece<K extends PieceKey>(key: K, opts: { readonly id: string; readonly ctx?: PieceContexts[K]; readonly tags?: readonly string[] }): PieceDef<K>;
  /** Place a definition (or a catalogue key) and, with `on`, settle it onto its supports. */
  place<M extends object>(def: ObjectDef<M>, opts: GenPlaceOptions): ObjectInstance<M>;
  place<K extends PieceKey>(key: K, opts: GenPlaceOptions<K>): ObjectInstance<PieceDef<K>["meta"]>;
  /** Would a definition fit at pos/yaw? AABB against every placed object (floors and `ignore` aside). */
  fits(def: ObjectDef<object>, opts?: FitsOptions): boolean;
  spawn(o: SpawnOptions): WorldEntity;
  /** Note something the generator couldn't do: world.warnings. */
  warn(msg: string): void;
}
export type GeneratorFn = (g: Gen, world: World) => void;
export type Generator = GeneratorFn | { readonly name?: string; readonly build: GeneratorFn };

/** A world as plain JSON: everything the simulation needs to go on exactly. */
export interface WorldSnapshot {
  readonly v: 2;
  readonly seed: string;
  readonly steps: number;
  readonly time: number;
  readonly target: readonly [number, number];
  readonly settings: SettingsJSON;
  readonly layout: string;
  readonly state: Record<string, unknown>;
  readonly rngs: Record<string, number>;
  readonly intent: WorldIntent;
  readonly input: { readonly driver: string | null; readonly idleFor: number };
  readonly player: string | null;
  readonly focus: string | null;
  readonly entities: readonly EntitySnapshot[];
  readonly particles: readonly ParticleState[];
  readonly camera: CameraState;
  readonly systems: Record<string, unknown>;
}
export interface EntitySnapshot {
  readonly id: string;
  readonly tags: readonly string[];
  readonly make: EntityMake;
  readonly materials: Record<string, string>;
  readonly brain: string | null;
  readonly mind: Record<string, unknown>;
  readonly intent: EntityIntent;
  readonly hold: Hold | null;
  readonly frozen: boolean;
  readonly hasBody: boolean;
  readonly tuning: Partial<Tuning>;
  readonly body: Record<string, unknown>;
  readonly heldKey?: string;
  readonly anim: AnimatorSave;
}

export interface World {
  readonly seed: string;
  readonly hexSeed: Seed;
  readonly dt: number;
  time: number;
  steps: number;
  width: number;
  height: number;
  readonly settings: Settings;
  readonly entities: Map<string, WorldEntity>;
  readonly objects: Map<string, WorldObject>;
  /** The physics rails (the objects' and extraRails). */
  readonly rails: Rail[];
  /** The physics boxes (one array for the whole run, refilled in place). */
  readonly boxes: (WorldBox & { mat: number; id: string })[];
  readonly materials: readonly WorldMaterial[];
  readonly palettes: Readonly<Record<string, PaletteFn>>;
  readonly input: Input;
  /** Plain data a system keeps between steps (saved by snapshot). */
  state: Record<string, unknown>;
  /** This step's intents from the input system. */
  intent: WorldIntent;
  /** The entity the input drives (while a player drives) and the camera follows. */
  player: string | null;
  focus: string | null;
  generator: Generator | null;
  readonly warnings: string[];
  /** Where each generated object came to rest. */
  rests: Record<string, Rest>;
  readonly camera: Camera;
  readonly particles: Particles;
  /** Changes whenever the solids do. */
  readonly boxesVersion: string;
  /** The target rules for this size, with the settings' overrides. */
  readonly rules: ResolvedRules;
  extraRails: Vec3[][];

  get(key: string, thing?: Thing | null, fallback?: SettingValue): SettingValue | undefined;
  set(scope: string, key: string, value: SettingValue, opts?: SetOptions): WriteResult;
  lock(scope: string, key: string, value?: SettingValue, opts?: SetOptions): WriteResult;
  unlock(scope: string, key: string): WriteResult;
  unset(scope: string, key: string, opts?: SetOptions): WriteResult;
  /** Who set `key` and who locked it (for a thing or the world), and what the target rules made of "auto". */
  explain(key: string, thing?: Thing | null): WorldExplanation;
  /** Apply "scope/key=value;..." locks; returns the refusals. */
  applyLocks(text: string): Refusal[];
  setTarget(width: number, height?: number): World;
  /** A seeded stream by name that snapshots save. */
  rng(name: string): NamedStream;
  on(type: string, fn: WorldListener): () => void;
  off(type: string, fn: WorldListener): void;
  emit(type: string, data?: Readonly<Record<string, unknown>>): WorldEvent;
  system(name: string): SystemInfo & SystemDef | null;
  system(name: string, def: SystemDef): World;
  removeSystem(name: string): boolean;
  enabled(name: string): boolean;
  enable(name: string, on?: boolean, scope?: string): WriteResult;
  systems(): SystemInfo[];
  brain(name: string, fn: Brain): World;
  fx(name: string, pass: FxPass | NonNullable<FxPass["frame"]>): World;
  drive(fn: DriveFn | null): World;
  record(on?: true): World;
  record(on: false): WorldIntent[] | null;
  replay(list: readonly WorldIntent[]): World;
  place(def: ObjectDef<object>, opts: PlaceOptions): WorldObject;
  replaceObject(inst: WorldObject): WorldObject;
  remove(id: string): void;
  addRail(line: readonly Vec3Like[]): void;
  syncSolids(): void;
  mat(name: string | number): number;
  spawn(o: SpawnOptions): WorldEntity;
  teleport(id: string, pos: Vec3Like, yaw?: number): void;
  subjectFor(ent: WorldEntity, withBounds?: boolean): Subject;
  step(dt?: number): number;
  simulate(sec: number): World;
  generate(generator: Generator): World;
  touchPalette(): void;
  frame(): Frame;
  fxList(): FxPassEntry[];
  draw(renderer: RendererLike): Frame;
  attach(target?: EventTargetLike, opts?: AttachOptions): () => void;
  layout(): string;
  snapshot(): WorldSnapshot;
  restore(snap: WorldSnapshot | string): World;
  /** snapshot() as codec bytes (keel/world/snapshot): the same snapshot, exactly, in under half its JSON. */
  snapshotBytes(): Uint8Array;
  /** restore() from snapshotBytes() (bytes of another kind are a TypeError saying why). */
  restoreBytes(bytes: Uint8Array): World;
}

// ------------------------------------------------------------------ helpers

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const IDLE: EntityIntent = Object.freeze({ move: [0, 0] as const, jump: false, hold: false });
// (FNV-1a over a string: a short digest for layouts and snapshots.)
const digest = (text: string): string => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, "0"); };
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const isCharacter = (b: WorldBody): b is Character => typeof (b as Partial<Character>).step === "function";

// The body fields a snapshot keeps (everything the body carries but its step and events).
const bodyFields = (b: WorldBody): Record<string, unknown> =>
  Object.fromEntries(Object.entries(b).filter(([k, v]) => k !== "events" && typeof v !== "function").map(([k, v]) => [k, clone(v)]));

/** The physics tuning an entity gets unless it brings its own: four legs walk and trot, and never wall-run or grind. */
export function tuningFor(spec: EntitySpec): Partial<Tuning> {
  if (spec.plan !== "quadruped") return {};
  const sh = spec.body.shoulderH;
  return { runSpeed: Math.min(7, Math.max(1.6, sh * 9)), runAccel: 20, jump: 0, wallMin: 1e9, railSnap: -1, radius: Math.min(0.32, Math.max(0.1, spec.body.bodyR * 1.3)) };
}

// ------------------------------------------------------------------ the world

export function createWorld({
  seed = "1", width = 128, height = 128, step = 1 / 120, config = {}, materials = [], palettes = {}, rules = defaultRules, input = {}, camera = {}, particles = {}, budget = RENDER_BUDGET,
}: WorldOptions = {}): World {
  const { boxes: MAX_BOXES, capsules: MAX_CAPS, ramps: MAX_RAMPS, materials: MAX_MATS } = { ...RENDER_BUDGET, ...budget };
  if (materials.length > MAX_MATS) throw new RangeError(`${materials.length} materials: the renderer holds ${MAX_MATS}.`);
  const hexSeed = worldSeed(seed);
  const cfgIn: WorldConfig = typeof config === "string" ? { locks: config } : config;
  const settings = createSettings({
    engine: { ...ENGINE_DEFAULTS, ...(cfgIn.engine ?? {}) },
    project: cfgIn.project ?? {},
    scene: cfgIn.scene ?? {},
    runtime: cfgIn.runtime ?? {},
    scopes: Object.fromEntries(Object.entries(cfgIn).filter(([k]) => /^(tag|id):/.test(k))) as Record<string, LayerValues>,
  });
  // (Typed reads of the engine's own settings.)
  const num = (key: string, thing: Thing | null = null): number => settings.get(key, thing) as number;

  const entities = new Map<string, WorldEntity>();
  const objects = new Map<string, WorldObject>();
  const systems = new Map<string, SystemEntry>();
  const handlers = new Map<string, Set<WorldListener>>();
  const brains = new Map<string, Brain>();
  const fxPasses = new Map<string, FxPass>();
  const rngs = new Map<string, NamedStream>();
  const warned = new Set<string>();
  const boxes: World["boxes"] = []; // (one array for the whole run: bodies and the camera hold it, so it's refilled in place)
  const rails: Rail[] = [];
  let objectsVersion = 0;
  let boxesKey = "";
  let paletteVersion = 0;
  let registration = 0;
  let acc = 0;
  let cam: Camera;
  let camBase: { chase: number; orbit: number };
  let parts: Particles;
  let driver: DriveFn | null = null;
  let log: WorldIntent[] | null = null;

  const inputDev: Input = input && typeof (input as Partial<Input>).sample === "function" ? (input as Input) : createInput({ idle: 8, ...(input as InputOptions) });
  const matIndex = new Map(materials.map((m, i) => [m.name, i]));
  const thingOf = (o: WorldObject | WorldEntity): Thing => ({ id: String(o.id), tags: o.tags });

  const world = {
    seed: String(seed),
    hexSeed,
    dt: step,
    time: 0,
    steps: 0,
    width,
    height,
    settings,
    entities,
    objects,
    rails,
    boxes,
    materials,
    palettes,
    input: inputDev,
    state: {},
    intent: { ...IDLE, look: [0, 0], player: false, driver: "autopilot" },
    player: null,
    focus: null,
    generator: null,
    warnings: [],
    rests: {},
    extraRails: [],
    get camera() { return cam; },
    get particles() { return parts; },
    get boxesVersion() { return boxesKey; },
  } as unknown as World;
  settings.useTags((id) => entities.get(id)?.tags ?? objects.get(id)?.tags ?? []);

  const warn = (msg: string): void => { if (!warned.has(msg)) { warned.add(msg); world.warnings.push(msg); } };

  // ------------------------------------------------------------ settings

  world.get = (key, thing = null, fallback) => settings.get(key, thing, fallback);
  world.set = (scope, key, value, opts = {}) => settings.set(scope, key, value, opts);
  world.lock = (scope, key, value, opts = {}) => settings.lock(scope, key, value, opts);
  world.unlock = (scope, key) => settings.unlock(scope, key);
  world.unset = (scope, key, opts = {}) => settings.unset(scope, key, opts);
  world.explain = (path, thing = null) => {
    const ex: WorldExplanation = settings.explain(path, thing);
    const ruleName = (Object.entries(RULE_KEYS) as [RuleName, string][]).find(([, k]) => k === path)?.[0];
    if (ruleName) {
      const r = world.rules;
      ex.effective = r[ruleName];
      ex.rule = r.from[ruleName] === "auto" ? `auto: targetRules(${world.width}x${world.height}).${ruleName} = ${r[ruleName]}` : `set: ${path}`;
    }
    return ex;
  };
  world.applyLocks = (text) => {
    const out: Refusal[] = [];
    for (const l of parseLocks(text)) {
      const r = l.lock ? settings.lock(l.scope, l.key, l.value) : settings.set(l.scope, l.key, l.value);
      if (!r.ok) out.push(r);
    }
    return out;
  };
  if (cfgIn.locks) world.applyLocks(cfgIn.locks);

  // ------------------------------------------------------------ target rules

  let rulesKey = "";
  let rulesCache: ResolvedRules | null = null;
  Object.defineProperty(world, "rules", {
    get(): ResolvedRules {
      const key = `${world.width}x${world.height}|${settings.version}`;
      if (key !== rulesKey || !rulesCache) { rulesCache = resolveRules(rules(world.width, world.height), (k) => settings.get(k)); rulesKey = key; }
      return rulesCache;
    },
  });
  world.setTarget = (w, h = w) => {
    world.width = Math.max(8, w | 0);
    world.height = Math.max(8, h | 0);
    cam.setTarget(world.width, world.height);
    return world;
  };

  // ------------------------------------------------------------ streams, events

  world.rng = (name) => {
    let S = rngs.get(name);
    if (!S) { S = namedStream(hexSeed, `rng:${name}`); rngs.set(name, S); }
    return S;
  };
  world.on = (type, fn) => {
    let set = handlers.get(type);
    if (!set) { set = new Set(); handlers.set(type, set); }
    set.add(fn);
    return () => { handlers.get(type)?.delete(fn); };
  };
  world.off = (type, fn) => { handlers.get(type)?.delete(fn); };
  // (Events are synchronous, in the step that raised them.)
  world.emit = (type, data = {}) => {
    const ev: WorldEvent = { type, time: world.time, step: world.steps, ...data };
    for (const fn of handlers.get(type) ?? []) fn(ev, world);
    for (const fn of handlers.get("*") ?? []) fn(ev, world);
    return ev;
  };

  // ------------------------------------------------------------ systems

  // (`enabled` is the default -- the setting system.<name>.enabled, when set, wins, and can be locked.)
  world.system = ((name: string, def?: SystemDef): (SystemInfo & SystemDef) | null | World => {
    if (def === undefined) {
      const s = systems.get(name);
      return s ? { name: s.name, order: s.order, step: s.step, enabled: s.enabled, ...(s.save ? { save: s.save } : {}), ...(s.load ? { load: s.load } : {}) } : null;
    }
    if (typeof def.step !== "function") throw new TypeError(`System ${name} needs step(world, dt).`);
    const prev = systems.get(name);
    systems.set(name, { name, order: def.order ?? SYSTEM_ORDER.custom, step: def.step, enabled: def.enabled ?? true, save: def.save, load: def.load, at: prev?.at ?? registration++ });
    return world;
  }) as World["system"];
  world.removeSystem = (name) => systems.delete(name);
  world.enabled = (name) => {
    const v = settings.get(`system.${name}.enabled`);
    return typeof v === "boolean" ? v : Boolean(systems.get(name)?.enabled);
  };
  world.enable = (name, on = true, scope = "runtime") => settings.set(scope, `system.${name}.enabled`, Boolean(on));
  const ordered = (): SystemEntry[] => [...systems.values()].sort((a, b) => a.order - b.order || a.at - b.at);
  world.systems = () => ordered().map((s) => ({ name: s.name, order: s.order, enabled: world.enabled(s.name) }));

  world.brain = (name, fn) => { brains.set(name, fn); return world; };
  // (Names in "render.fx" that aren't the world's go to the renderer's own passes.)
  world.fx = (name, pass) => { fxPasses.set(name, typeof pass === "function" ? { frame: pass } : pass); return world; };
  world.drive = (fn) => { driver = fn; return world; };
  world.record = ((on = true) => { if (on) { log = []; return world; } const out = log; log = null; return out; }) as World["record"];
  world.replay = (list) => { let i = 0; return world.drive(() => list[Math.min(i++, list.length - 1)] ?? IDLE); };

  // ------------------------------------------------------------ objects

  world.place = (def, { id, pos = [0, 0, 0], yaw = 0, scale = 1, tags = [] }) => {
    if (!id) throw new TypeError("world.place needs an id (ids are how settings find things).");
    if (objects.has(id) || entities.has(id)) throw new Error(`Two things are called ${id}.`);
    const inst = placeObject(def, { id, pos, yaw, scale, tags });
    objects.set(id, inst);
    objectsVersion += 1;
    return inst;
  };
  world.replaceObject = (inst) => { objects.set(String(inst.id), inst); objectsVersion += 1; return inst; };
  world.remove = (id) => {
    if (objects.delete(id)) objectsVersion += 1;
    entities.delete(id);
    if (world.player === id) world.player = null;
    if (world.focus === id) world.focus = null;
  };
  world.addRail = (line) => { world.extraRails.push(line.map((p) => [p[0], p[1], p[2]])); objectsVersion += 1; };

  // The physics boxes and rails: every object whose "collide" is on. Refilled in place when anything changes.
  function syncSolids(): void {
    const key = `${objectsVersion}|${settings.version}`;
    if (key === boxesKey) return;
    boxesKey = key;
    boxes.length = 0;
    rails.length = 0;
    for (const inst of objects.values()) {
      if (settings.get("collide", thingOf(inst)) === false) continue;
      for (const b of worldColliders(inst)) boxes.push({ ...b, mat: 0, id: String(inst.id) });
      rails.push(...worldRails(inst));
    }
    rails.push(...world.extraRails);
  }
  world.syncSolids = syncSolids;

  // ------------------------------------------------------------ entities

  // A thing's material name, through its settings: its main material (the first part's), or mat.<name> for any other.
  function matNameFor(thing: Thing, name: string | number, primary: unknown): string | number {
    if (name === primary) { const m = settings.get("material", thing); if (m) return m as string; }
    const alias = settings.get(`mat.${name}`, thing);
    return (alias as string | undefined) ?? name;
  }
  world.mat = (name) => {
    if (typeof name === "number") return name;
    const i = matIndex.get(name);
    if (i === undefined) { warn(`No material "${name}" in the world's table.`); return 0; }
    return i;
  };

  // How tall and wide an entity stands (from its idle pose): the camera's subject.
  function sizeOf(spec: EntitySpec): { height: number; radius: number } {
    const caps = skinOf(spec, posed(spec, "idle"));
    let y1 = 0;
    let r = 0;
    for (const c of caps) {
      y1 = Math.max(y1, c.a[1] + c.r, c.b[1] + c.r);
      r = Math.max(r, Math.hypot(c.a[0], c.a[2]) + c.r, Math.hypot(c.b[0], c.b[2]) + c.r);
    }
    return { height: y1, radius: Math.min(r, y1 * 0.6) };
  }

  const bodyKeyOf = (ent: WorldEntity): string => JSON.stringify([settings.get("system.physics.gravity", ent), settings.get("system.physics.waterY", ent), settings.get("collide", ent) !== false]);
  function makeBody(ent: Omit<WorldEntity, "body">, pos: Vec3Like, yaw: number, keep: Record<string, unknown> | null = null): WorldBody {
    const key = bodyKeyOf(ent as WorldEntity);
    (ent as WorldEntity).bodyKey = key;
    if (!ent.hasBody) {
      return keep ? { ...clone(keep), events: [] } as unknown as FreeBody : { pos: [pos[0], pos[1], pos[2]], vel: [0, 0, 0], facing: yaw, mode: "ground", events: [] };
    }
    const tuning = { ...ent.tuning, gravity: num("system.physics.gravity", ent) };
    const b = createCharacter({ boxes: settings.get("collide", ent) === false ? [] : boxes, rails, waterY: num("system.physics.waterY", ent), spawn: [pos[0], pos[1], pos[2]], tuning });
    b.facing = yaw;
    b.mode = "ground";
    if (keep) for (const [k, v] of Object.entries(keep)) (b as unknown as Record<string, unknown>)[k] = clone(v);
    return b;
  }

  world.spawn = (o) => {
    const { id } = o;
    if (!id) throw new TypeError("world.spawn needs an id.");
    if (objects.has(id) || entities.has(id)) throw new Error(`Two things are called ${id}.`);
    const tags = [...new Set(o.tags ?? [])].sort();
    const thing = { id, tags };
    const make: EntityMake = { seed: o.seed ?? `${hexSeed}|entity:${id}`, kind: o.kind ?? "animal" };
    // The species is a generated choice like any other: the seed's own pick (entityOf's, from the
    // entity's seed) is PROPOSED, so a lock -- or a tag's or the id's own setting -- wins, and
    // explain() shows what the seed would have chosen under it. (o.species is the caller's pin.)
    const natural = o.species ?? entityOf(make.seed, { kind: make.kind }).species;
    const species = settings.propose("species", natural, thing) as Species;
    const pins = { ...(o.pins ?? {}), ...settings.section("pins", thing) } as EntityPins;
    const size = (settings.get("size", thing) as number | null | undefined) ?? o.size;
    make.species = species;
    if (Object.keys(pins).length) make.pins = pins;
    if (size !== undefined && size !== null) make.size = size;
    let spec: EntitySpec;
    try { spec = entityOf(make.seed, make); } catch (e) {
      const ex = settings.explain("species", thing);
      throw new RangeError(`${id}: ${(e as Error).message} (species from ${ex.layer ?? "its seed"}${ex.locked ? `, locked at ${ex.lockedAt}` : ""}).`);
    }
    const partial = {
      kind: "entity" as const, id, tags, make, spec,
      anim: animator(spec),
      materials: { ...(o.materials ?? {}) },
      brain: o.brain ?? null,
      mind: clone({ ...(o.mind ?? {}) }),
      intent: { ...IDLE },
      hold: null,
      frozen: false,
      hasBody: o.body !== false,
      tuning: { ...tuningFor(spec), ...(o.tuning ?? {}) },
      bodyKey: "",
      size: sizeOf(spec),
    };
    const ent = partial as WorldEntity;
    ent.body = makeBody(partial, o.pos ?? [0, 0, 0], o.yaw ?? 0);
    entities.set(id, ent);
    if (o.player) world.player = id;
    world.emit("spawned", { id });
    return ent;
  };

  world.teleport = (id, pos, yaw) => {
    const ent = entities.get(id);
    if (!ent) throw new RangeError(`No entity ${id}.`);
    ent.body.pos = [pos[0], pos[1], pos[2]];
    ent.body.vel = [0, 0, 0];
    if (yaw !== undefined) ent.body.facing = yaw;
  };

  // ------------------------------------------------------------ the default systems

  world.system("input", {
    order: SYSTEM_ORDER.input,
    step(w, dt) {
      const it = driver ? driver(w, dt) : inputDev.sample(dt, cam ? cam.yaw : 0);
      w.intent = { move: [0, 0], axes: [0, 0], look: [0, 0], jump: false, hold: false, sprint: false, driver: "player", player: true, ...it };
      if (log) log.push(clone(w.intent));
    },
  });

  world.system("control", {
    order: SYSTEM_ORDER.control,
    step(w, dt) {
      for (const ent of entities.values()) {
        if (settings.get("static", ent) === true) { ent.intent = { ...IDLE }; continue; }
        if (ent.id === w.player && w.intent.player) {
          // (The player takes over: whatever the brain had it holding -- a seat, a pose -- lets go.)
          if (ent.frozen || ent.hold) { ent.frozen = false; ent.hold = null; ent.mind = {}; w.emit("takeover", { id: ent.id }); }
          ent.intent = { move: w.intent.move, jump: w.intent.jump, hold: w.intent.hold };
        } else if (ent.brain && brains.has(ent.brain)) ent.intent = { ...IDLE, ...(brains.get(ent.brain)!(w, ent, dt) ?? IDLE) };
        else ent.intent = { ...IDLE };
      }
    },
  });

  world.system("physics", {
    order: SYSTEM_ORDER.physics,
    step(w, dt) {
      syncSolids();
      for (const ent of entities.values()) {
        if (ent.frozen || settings.get("static", ent) === true) { ent.body.vel = [0, 0, 0]; continue; }
        if (bodyKeyOf(ent) !== ent.bodyKey) ent.body = makeBody(ent, ent.body.pos, ent.body.facing, bodyFields(ent.body));
        const body = ent.body;
        if (!isCharacter(body)) {
          // (No physics: it goes where its intent says, at its tuning's speed, through everything.)
          const sp = ent.tuning.runSpeed ?? 3;
          body.vel = [ent.intent.move[0] * sp, 0, ent.intent.move[1] * sp];
          body.pos = [body.pos[0] + body.vel[0] * dt, body.pos[1], body.pos[2] + body.vel[2] * dt];
          if (Math.hypot(body.vel[0], body.vel[2]) > 0.05) body.facing = Math.atan2(body.vel[0], body.vel[2]);
          continue;
        }
        body.step(dt, ent.intent);
        for (const e of body.events) w.emit(e.type, { ...e, id: ent.id });
      }
    },
  });

  world.system("animation", {
    order: SYSTEM_ORDER.animation,
    step(_w, dt) {
      for (const ent of entities.values()) {
        const want = ent.hold ? JSON.stringify(ent.hold) : "";
        if (want !== (ent.heldKey ?? "")) {
          if (ent.hold) ent.anim.hold(ent.hold.clip, ent.hold.params ?? {}); else ent.anim.release();
          ent.heldKey = want;
        }
        ent.anim.step(dt, ent.body as AnimatorBody);
      }
    },
  });

  world.system("particles", {
    order: SYSTEM_ORDER.particles,
    step(_w, dt) { parts.max = (settings.get("system.particles.max") as number | undefined) ?? 600; parts.step(dt); },
  });

  world.system("camera", {
    order: SYSTEM_ORDER.camera,
    step(w, dt) {
      const subject = cameraSubject();
      if (!subject) return;
      cam.setMode(cameraMode(), { blend: 0.35 });
      const r = w.rules;
      cam.rigs.chase.opt.distance = camBase.chase * r.arm;
      cam.rigs.orbit.opt.distance = camBase.orbit * r.arm;
      const cw = cameraWorld(subject);
      if (cam.mode === "frame") aimFrame(subject, cw, dt);
      cam.step(dt, subject, cw, w.intent);
      if (r.from.fov !== "auto") cam.fov = r.fov;
    },
  });

  // What the camera must keep out of: the solids -- but not one the subject is
  // IN (sat on a bench: its feet are inside the seat's footprint and the seat
  // rises round it; the camera's arm starts from the subject's middle, and
  // would never leave). A box under its feet (a crate it stands on) stays.
  function cameraWorld(s: Subject): CameraWorld {
    const h = s.height ?? 1.1;
    const inside = boxes.filter((b) => b.c[1] + b.h[1] > s.pos[1] + 0.05 && b.c[1] - b.h[1] < s.pos[1] + h && boxDistance([s.pos[0], b.c[1], s.pos[2]], b).d < 0);
    return inside.length ? { boxes: boxes.filter((b) => !inside.includes(b)) } : { boxes };
  }

  interface CameraCycle { at: number; index: number; showing?: string; aimIn?: number; aimFor?: string | undefined; cutFor?: string | undefined }
  const cycleState = (): CameraCycle => (world.state["camera"] ??= { at: 0, index: 0 }) as CameraCycle;

  // Frame shots show a FRONT -- but a thing facing a hedge from a step away has
  // no room in front of it, and a small one beside a wall has its middle
  // closer to the wall than the camera arm's radius (the rig's own collision
  // would fold the shot into it). So the world aims frame shots itself: every
  // quarter second it tries the three-quarter view on either side, wider,
  // then square on, and takes the first whose eye has room and sees the
  // subject (its middle, top and sides) -- the rig eases there, uncollided.
  function aimFrame(s: Subject, cw: CameraWorld, dt: number): void {
    const st = cycleState();
    st.aimIn = (st.aimIn ?? 0) - dt;
    if (st.aimIn > 0 && st.aimFor === st.showing) return;
    st.aimIn = 0.25;
    st.aimFor = st.showing;
    const rig = cam.rigs.frame;
    const base = Math.abs(camera.frame?.turn ?? 0.45) || 0.45;
    const fill = rig.opt.fill ?? fillForTarget(cam.width, cam.height);
    const b = s.bounds as readonly number[];
    const mid: Vec3 = [(b[0]! + b[3]!) / 2, (b[1]! + b[4]!) / 2, (b[2]! + b[5]!) / 2];
    const marks: Vec3[] = [mid, [mid[0], b[4]!, mid[2]], [b[0]!, mid[1], mid[2]], [b[3]!, mid[1], mid[2]], [mid[0], mid[1], b[2]!], [mid[0], mid[1], b[5]!]];
    const seen = (from: Vec3, to: Vec3): boolean => { const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) || 1; return sphereCast(cw, from, to, 0.02) / d >= 0.97; };
    let best: { t: number; score: number } | null = null;
    for (const t of [rig.turn, base, -base, base * 1.8, -base * 1.8, 0]) {
      const v = frameView(s, { turn: t, elevation: rig.opt.elevation, fov: cam.baseFov, aspect: cam.aspect, fill });
      const room = Math.min(1, clearance(cw, v.eye) / rig.opt.radius);
      const score = (room >= 1 ? 1 : room * 0.5) * (marks.filter((p) => seen(v.eye, p)).length / marks.length);
      if (!best || score > best.score + 0.02) best = { t, score };
      if (score >= 0.99) break;
    }
    // (A new subject or a new side is a cut, not a swing: an eased swing can pass through a hedge.)
    if (best!.t !== rig.turn || st.cutFor !== st.showing) { rig.eye = null; rig.target = null; st.cutFor = st.showing; }
    rig.turn = best!.t;
  }

  function cameraMode(): CameraMode {
    const m = settings.get("system.camera.mode") as CameraMode | null | undefined;
    if (!m || m === "auto") return world.intent.player && world.player ? "orbit" : "chase";
    return m;
  }
  // Who the camera watches: in frame mode, each entity in turn; else the focus, the player, or the first.
  function cameraSubject(): Subject | null {
    const mode = cameraMode();
    let id = world.focus ?? world.player ?? entities.keys().next().value;
    if (mode === "frame") {
      const tag = settings.get("system.camera.frameTag") as string | null | undefined;
      const list = [...entities.values()].filter((e) => !tag || e.tags.includes(tag)).map((e) => e.id).sort();
      if (list.length) {
        const cyc = cycleState();
        cyc.at += world.dt;
        if (cyc.at >= ((settings.get("system.camera.cycle") as number | undefined) ?? 4)) { cyc.at = 0; cyc.index += 1; }
        id = list[cyc.index % list.length]!;
        cyc.showing = id;
      }
    }
    const ent = id === undefined ? undefined : entities.get(id);
    if (!ent) return null;
    return subjectFor(ent, mode === "frame");
  }
  /**
   * The camera's subject for an entity: its body, height, radius -- and, for
   * frame shots, its bounds. (Its real height: the camera starts a small
   * subject's arm clear of the floor itself -- the proof of concept's world
   * held every subject to 0.6 m instead.)
   */
  function subjectFor(ent: WorldEntity, withBounds = false): Subject {
    const b = ent.body;
    const s: { -readonly [K in keyof Subject]: Subject[K] } = subjectOf(isCharacter(b) ? b : { ...b, wall: null }, { height: ent.size.height, radius: ent.size.radius });
    if (withBounds) {
      const caps = ent.anim.capsules(roleTable(ent));
      const bb: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const c of caps) for (const p of [c.a, c.b]) for (let k = 0; k < 3; k += 1) { bb[k] = Math.min(bb[k]!, p[k]! - c.r); bb[k + 3] = Math.max(bb[k + 3]!, p[k]! + c.r); }
      s.bounds = bb;
    }
    return s;
  }
  world.subjectFor = subjectFor;

  function newCamera(): void {
    // (Frame shots are aimed by the world -- aimFrame -- so the rig itself doesn't collide, unless asked.)
    cam = createCamera({ mode: "chase", width: world.width, height: world.height, ...camera, frame: { collide: false, ...(camera.frame ?? {}) } });
    camBase = { chase: cam.rigs.chase.opt.distance, orbit: cam.rigs.orbit.opt.distance };
  }

  function resetRuntime(): void {
    newCamera();
    parts = createParticles((settings.get("system.particles.max") as number | undefined) ?? 600, { recipes: { ...baseRecipes(), ...(particles.recipes ?? {}) }, stream: () => world.rng("particles") });
  }
  resetRuntime();

  // ------------------------------------------------------------ stepping

  function stepOnce(): void {
    for (const s of ordered()) if (world.enabled(s.name)) s.step(world, world.dt);
    world.time += world.dt;
    world.steps += 1;
  }
  // (world.step() runs one fixed step; world.step(dt) adds real time, capped at 0.1 s, and runs as many as fit.)
  world.step = (dt) => {
    if (dt === undefined) { stepOnce(); return 1; }
    acc += Math.min(Math.max(0, dt), 0.1);
    let n = 0;
    while (acc >= world.dt - 1e-12) { stepOnce(); acc -= world.dt; n += 1; }
    return n;
  };
  world.simulate = (sec) => { const n = Math.round(sec / world.dt); for (let i = 0; i < n; i += 1) stepOnce(); return world; };

  // ------------------------------------------------------------ generation

  // (The seed's earlier choices are forgotten first -- locks and every other scope stay -- so the same seed and locks build the same world.)
  world.generate = (generator) => {
    settings.clearSeed();
    entities.clear();
    objects.clear();
    world.extraRails = [];
    objectsVersion += 1;
    rngs.clear();
    world.state = {};
    world.rests = {};
    world.warnings.length = 0;
    warned.clear();
    world.time = 0;
    world.steps = 0;
    world.player = null;
    world.focus = null;
    acc = 0;
    resetRuntime();
    const build = typeof generator === "function" ? generator : generator.build;
    build(makeGen(), world);
    world.generator = generator;
    paletteVersion += 1;
    syncSolids();
    world.emit("generated", { name: typeof generator === "function" ? (generator.name || null) : generator.name ?? null });
    return world;
  };

  function makeGen(): Gen {
    const idOfThing = (thing: Thing | null | undefined): string => (thing == null ? "" : typeof thing === "string" ? thing : thing.id);
    const pickFor = (key: string, thing: Thing | null | undefined): NamedStream => namedStream(hexSeed, `choose:${idOfThing(thing)}:${key}`);
    const piece = <K extends PieceKey>(key: K, { id, ctx, tags = [] }: { readonly id: string; readonly ctx?: PieceContexts[K]; readonly tags?: readonly string[] }): PieceDef<K> => {
      if (!PIECE_KEYS.includes(key)) throw new RangeError(`No piece ${key} (${PIECE_KEYS.join(", ")}).`);
      const thing = { id, tags };
      return buildPieceFrom(key, namedStream(hexSeed, `piece:${id}`), { ...(ctx ?? {}), ...settings.section("piece", thing) } as PieceContexts[K]);
    };
    const g: Gen = {
      seed: hexSeed,
      world,
      stream: (label) => namedStream(hexSeed, `gen:${label}`),
      choose(key, options, { thing = null, weights = null } = {}) {
        const S = pickFor(key, thing);
        const rolled = weights ? S.weighted(options.map((o, i) => [o, weights[i]!] as const)) : S.pick(options);
        return settings.propose(key, rolled, thing) as typeof rolled;
      },
      int: (key, a, b, { thing = null } = {}) => settings.propose(key, pickFor(key, thing).int(a, b), thing) as number,
      between: (key, a, b, { thing = null } = {}) => settings.propose(key, pickFor(key, thing).between(a, b), thing) as number,
      chance: (key, p, { thing = null } = {}) => settings.propose(key, pickFor(key, thing).chance(p), thing) as boolean,
      piece,
      place(defOrKey: ObjectDef<object> | PieceKey, { id, pos = [0, 0, 0], yaw = 0, scale = 1, tags = [], ctx, on = null }: GenPlaceOptions) {
        const def: ObjectDef<object> = typeof defOrKey === "string" ? piece(defOrKey, { id, ...(ctx ? { ctx } : {}), tags }) : defOrKey;
        let inst = world.place(def, { id, pos, yaw, scale, tags });
        if (on) {
          // ("auto": lifted high, then dropped onto the highest thing under it -- or the ground.)
          const supports: readonly Support[] = on === "auto" ? [...[...objects.values()].filter((o) => o.id !== id), 0] : on;
          const r = settle(on === "auto" ? placeObject(def, { id, pos: [pos[0], 1e3, pos[2]], yaw, scale, tags }) : inst, supports);
          // (Placed again where it settled, with the yaw as given: settle's moved copy wraps the wrapped yaw again,
          // which can move it by a bit -- the proof of concept's placements, to the bit.)
          inst = world.replaceObject(placeObject(def, { id, pos: r.instance.transform.pos, yaw, scale, tags }));
          world.rests[id] = { support: r.support, rests: r.rests, gap: r.gap };
        }
        return inst;
      },
      fits(def, { pos = [0, 0, 0] as Vec3Like, yaw = 0, scale = 1, margin = 0.1, ignore = [], flat = false } = {}) {
        const a = worldAabb(placeObject(def, { id: "_probe", pos, yaw, scale }));
        for (const o of objects.values()) {
          if (ignore.includes(String(o.id)) || o.tags.includes("floor") || o.tags.includes("ground")) continue;
          const b = worldAabb(o);
          const ys = flat || (a[1] < b[4] && a[4] > b[1]);
          if (ys && a[0] - margin < b[3] && a[3] + margin > b[0] && a[2] - margin < b[5] && a[5] + margin > b[2]) return false;
        }
        return true;
      },
      spawn: (o) => world.spawn(o),
      warn,
    } as Gen;
    return g;
  }

  // ------------------------------------------------------------ the frame

  const roleTable = (ent: WorldEntity): MaterialTable => {
    const out: Record<string, number> = {};
    for (const [role, name] of Object.entries(ent.materials)) out[role] = world.mat(matNameFor(ent, name, null));
    return out as MaterialTable;
  };

  let bakeKey = "";
  let bakeCache: { boxes: FrameBox[]; capsules: FrameCapsule[] } = { boxes: [], capsules: [] };
  function bakeObjects(): { boxes: FrameBox[]; capsules: FrameCapsule[] } {
    const key = `${objectsVersion}|${settings.version}`;
    if (key === bakeKey) return bakeCache;
    const out: { boxes: FrameBox[]; capsules: FrameCapsule[] } = { boxes: [], capsules: [] };
    for (const inst of objects.values()) {
      const thing = thingOf(inst);
      if (settings.get("show", thing) === false) continue;
      const primary = inst.def.parts[0]?.mat;
      const { pos, yaw, scale } = inst.transform;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const W = (p: Vec3Like): Vec3 => [pos[0] + (p[0] * c + p[2] * s) * scale, pos[1] + p[1] * scale, pos[2] + (-p[0] * s + p[2] * c) * scale];
      const id = String(inst.id);
      for (const p of inst.def.parts) {
        if (p.render === false || !p.prim) continue;
        const mat = world.mat(matNameFor(thing, p.mat ?? 0, primary));
        if (p.prim.type === "box") out.boxes.push({ c: W(p.prim.c), h: p.prim.h.map((v) => v * scale) as Vec3, yaw: yaw + (p.prim.yaw ?? 0), mat, id });
        else out.capsules.push({ a: W(p.prim.a), b: W(p.prim.b), r: p.prim.r * scale, mat, id });
      }
    }
    bakeKey = key;
    bakeCache = out;
    return out;
  }

  let palKey = "";
  let palCache: FramePalette | null = null;
  function paletteFor(r: ResolvedRules): FramePalette {
    let name = settings.get("render.palette") as string | undefined;
    if (!name || !palettes[name]) {
      const first = Object.keys(palettes)[0];
      if (name && name !== "default" && first) warn(`No palette "${name}"; using "${first}".`);
      name = first;
    }
    const key = `${name}|${r.rampLength}|${r.min}|${paletteVersion}`;
    if (key === palKey && palCache) return palCache;
    const colours: (RGB | readonly number[])[] = [];
    const ramps: Record<string, [number, number]> = {};
    const src = name ? palettes[name]!(world, r).ramps : { grey: [[20, 20, 24], [90, 90, 96], [170, 170, 176], [240, 240, 244]] };
    for (const [rname, list] of Object.entries(src)) {
      let kept: readonly (RGB | readonly number[])[] = list;
      if (r.from.rampLength === "auto") kept = rampForTarget(list, r.min);
      else if (Number.isFinite(r.rampLength) && r.rampLength < list.length) {
        const n = Math.max(1, r.rampLength | 0);
        kept = n <= 1 ? [list[list.length - 1]!] : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]!);
      }
      ramps[rname] = [colours.length, kept.length];
      colours.push(...kept);
    }
    if (Object.keys(ramps).length > MAX_RAMPS) warn(`Palette "${name}" has ${Object.keys(ramps).length} ramps; the GPU renderer holds ${MAX_RAMPS}.`);
    palKey = key;
    palCache = { name, colours, ramps, key };
    return palCache;
  }
  world.touchPalette = () => { paletteVersion += 1; };

  // (Capsules are budgeted: the objects' first, then entities nearest the camera, the focus first; one that can't have enough to read is left out.)
  world.frame = () => {
    const r = world.rules;
    const baked = bakeObjects();
    const view = cam.view();
    const outBoxes = baked.boxes.slice(0, MAX_BOXES);
    const capsules = baked.capsules.slice(0, MAX_CAPS);
    const dropped = { boxes: Math.max(0, baked.boxes.length - MAX_BOXES), entities: [] as string[] };
    const focusId = cam.mode === "frame" ? (world.state["camera"] as CameraCycle | undefined)?.showing : world.focus ?? world.player;
    // (The camera in the subject's face hides it -- first person, an arm pulled right in -- but a frame shot is there to show it.)
    const hide = cam.hidesSubject && cam.mode !== "frame";
    const list = [...entities.values()].filter((e) => settings.get("show", e) !== false && !(hide && e.id === focusId));
    const far = (e: WorldEntity): number => (e.id === focusId ? -1 : Math.hypot(e.body.pos[0] - view.eye[0], e.body.pos[1] - view.eye[1], e.body.pos[2] - view.eye[2]));
    list.sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : 1));
    for (let i = 0; i < list.length; i += 1) {
      const ent = list[i]!;
      const left = MAX_CAPS - capsules.length;
      const share = Math.floor(left / (list.length - i));
      const max = Math.min(28, i === 0 ? left : Math.max(share, Math.min(left, 14)));
      if (max < 10) { dropped.entities.push(ent.id); continue; }
      for (const c of ent.anim.capsules(roleTable(ent), { max }) as Capsule[]) capsules.push({ ...c, id: ent.id });
    }
    const passes = fxList();
    const fog = settings.get("render.fog") as [number, number];
    let f: Frame = {
      boxes: outBoxes,
      capsules,
      particles: world.enabled("particles") ? parts.list(r.particleSize) : [],
      view: { ...view, time: world.time, sun: settings.get("render.sun") as Vec3, waterY: num("render.waterY"), fogNear: fog[0], fogFar: fog[1] },
      palette: paletteFor(r),
      materials: materials.map(({ name: _name, ...m }) => m as FrameMaterial),
      style: { screen: r.screen, dither: r.dither, outline: r.outline },
      fx: passes.map((p) => p.name),
      passes: passes.filter((p) => !fxPasses.has(p.name)),
      target: { width: world.width, height: world.height },
      rules: r,
      stats: { boxes: outBoxes.length, capsules: capsules.length, dropped },
    };
    for (const p of passes) {
      const pass = fxPasses.get(p.name);
      if (pass?.frame) f = pass.frame(f, world, p) ?? f;
    }
    return f;
  };

  /**
   * The fx list: "render.fx" (names, or { name, ...params }), then every
   * "fx.<name>" setting over it -- false drops the pass, true adds it, an
   * object adds it with those params. Unknown names warn and are skipped.
   */
  function fxList(): FxPassEntry[] {
    const byName = new Map<string, FxPassEntry>();
    for (const e of (settings.get("render.fx") as readonly (string | FxPassEntry)[] | undefined) ?? []) {
      const entry: FxPassEntry = typeof e === "string" ? { name: e } : { ...e };
      byName.set(entry.name, { ...(byName.get(entry.name) ?? {}), ...entry });
    }
    for (const [name, v] of Object.entries(settings.section("fx"))) {
      if (v === false || v === null) byName.delete(name);
      else if (v === true) byName.set(name, byName.get(name) ?? { name });
      else if (typeof v === "object") byName.set(name, { ...(byName.get(name) ?? {}), ...(v as object), name });
    }
    const out: FxPassEntry[] = [];
    for (const p of byName.values()) {
      if (fxPasses.has(p.name) || RENDER_FX_NAMES.includes(p.name)) out.push(p);
      else warn(`No fx pass "${p.name}" (the world's: ${[...fxPasses.keys()].join(", ") || "none"}; the renderer's: ${RENDER_FX_NAMES.join(", ")}).`);
    }
    return out;
  }
  world.fxList = fxList;

  const drawn = new WeakMap<RendererLike, { palette: string; materials: string; fx: string }>();
  // (Only what changed is set: palette, materials, fx; then style, world and render.)
  world.draw = (renderer) => {
    const f = world.frame();
    const last = drawn.get(renderer);
    const now = { palette: f.palette.key, materials: JSON.stringify(f.materials), fx: JSON.stringify(f.passes) };
    if (renderer.width !== f.target.width || renderer.height !== f.target.height) renderer.setTarget(f.target.width, f.target.height);
    if (last?.palette !== now.palette) renderer.setPalette(f.palette.colours, f.palette.ramps);
    if (last?.palette !== now.palette || last?.materials !== now.materials) renderer.setMaterials(f.materials);
    if (renderer.setFx && last?.fx !== now.fx) (renderer.setFx as (list: readonly FxPassEntry[]) => void).call(renderer, f.passes);
    drawn.set(renderer, now);
    renderer.setStyle(f.style);
    renderer.setWorld({ boxes: f.boxes, capsules: f.capsules });
    renderer.render({ ...f.view, particles: f.particles });
    for (const name of f.fx) fxPasses.get(name)?.draw?.(renderer, f, world);
    return f;
  };
  world.attach = (target = globalThis as unknown as EventTargetLike, opts = {}) => inputDev.attach(target, opts);

  // ------------------------------------------------------------ snapshots

  /** A digest of the objects' ids and placements (what a restore must find to be the same level). */
  world.layout = () => digest([...objects.values()].map((o) => `${o.id}:${o.key}:${o.transform.pos.map(r6).join(",")}:${r6(o.transform.yaw)}:${r6(o.transform.scale)}`).sort().join("|"));

  // Everything the simulation needs to go on exactly as it would have, as plain JSON. Objects are the
  // level: the snapshot carries their layout digest, and restore rebuilds them with the world's generator.
  world.snapshot = () => clone<WorldSnapshot>({
    v: 2,
    seed: world.seed,
    steps: world.steps,
    time: world.time,
    target: [world.width, world.height],
    settings: settings.toJSON(),
    layout: world.layout(),
    state: world.state,
    rngs: Object.fromEntries([...rngs.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, S]) => [k, S.cursor])),
    intent: world.intent,
    input: { driver: inputDev.arbiter?.driver ?? null, idleFor: inputDev.arbiter?.idleFor ?? 0 },
    player: world.player,
    focus: world.focus,
    entities: [...entities.values()].map((e) => ({
      id: e.id, tags: e.tags, make: e.make, materials: e.materials, brain: e.brain, mind: e.mind, intent: e.intent,
      hold: e.hold, frozen: e.frozen, hasBody: e.hasBody, tuning: e.tuning, body: bodyFields(e.body),
      ...(e.heldKey !== undefined ? { heldKey: e.heldKey } : {}), anim: e.anim.save(),
    })),
    particles: parts.save(),
    camera: cam.save(),
    systems: Object.fromEntries(ordered().filter((s) => s.save).map((s) => [s.name, s.save!(world)])),
  });

  world.restore = (snap) => {
    const s = (typeof snap === "string" ? JSON.parse(snap) : snap) as WorldSnapshot;
    if (s.v !== 2) throw new TypeError(`A v${String(s.v)} snapshot: this world restores v2 (the proof of concept's v1 carried no camera or animator state).`);
    if (s.layout !== world.layout()) {
      if (!world.generator) throw new Error("This snapshot is of another level, and the world has no generator to rebuild it with.");
      settings.load(s.settings);
      world.generate(world.generator);
      if (s.layout !== world.layout()) throw new Error("Rebuilt the level from the snapshot's settings, and it still differs.");
    }
    settings.load(s.settings);
    world.setTarget(s.target[0], s.target[1]);
    entities.clear();
    for (const e of s.entities) {
      const spec = entityOf(e.make.seed, e.make);
      const partial = {
        kind: "entity" as const, id: e.id, tags: [...e.tags], make: clone(e.make), spec,
        anim: animator(spec).load(e.anim),
        materials: clone(e.materials), brain: e.brain, mind: clone(e.mind), intent: clone(e.intent), hold: clone(e.hold), frozen: e.frozen,
        hasBody: e.hasBody, tuning: clone(e.tuning), bodyKey: "", size: sizeOf(spec),
        ...(e.heldKey !== undefined ? { heldKey: e.heldKey } : {}),
      };
      const ent = partial as WorldEntity;
      ent.body = makeBody(partial, e.body["pos"] as Vec3, e.body["facing"] as number, e.body);
      ent.body.events.length = 0;
      entities.set(e.id, ent);
    }
    world.steps = s.steps;
    world.time = s.time;
    world.state = clone(s.state);
    rngs.clear();
    for (const [k, cursor] of Object.entries(s.rngs)) rngs.set(k, namedStream(hexSeed, `rng:${k}`, cursor));
    world.intent = clone(s.intent);
    if (inputDev.arbiter && s.input.driver) { inputDev.arbiter.driver = s.input.driver as Input["arbiter"]["driver"]; inputDev.arbiter.idleFor = s.input.idleFor; }
    world.player = s.player;
    world.focus = s.focus;
    acc = 0;
    parts.load(s.particles);
    newCamera();
    cam.load(s.camera);
    // (The entities came back from their makes: a palette that reads their colours is built again.)
    paletteVersion += 1;
    for (const [name, data] of Object.entries(s.systems ?? {})) systems.get(name)?.load?.(world, data);
    syncSolids();
    return world;
  };

  // (The snapshot is plain JSON already, so the codec's record is the snapshot itself.)
  world.snapshotBytes = () => encode(WORLD_SNAPSHOT, world.snapshot() as never);
  world.restoreBytes = (bytes) => {
    let snap: WorldSnapshot;
    try {
      snap = decode(WORLD_SNAPSHOT, bytes) as unknown as WorldSnapshot;
    } catch (e) {
      throw new TypeError(`These bytes aren't a world snapshot (keel/world/snapshot): ${(e as Error).message}`, { cause: e });
    }
    return world.restore(snap);
  };

  return world;
}
