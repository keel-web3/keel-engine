// Public contracts for the world runtime. Types are separated from its implementation.

import type { RGB, Seed, Vec3, Vec3Like } from "@keel-engine/core";
import type { BodyEvent, BodyMode, Character, Rail, Tuning } from "@keel-engine/physics";
import type { Animator, AnimatorBody, AnimatorSave, Capsule, EntityPins, EntitySpec, Kind, MaterialTable, Species } from "@keel-engine/entity";
import type { Camera, CameraMode, CameraOptions, CameraState, CameraWorld, Subject, View } from "@keel-engine/camera";
import type { AttachOptions, EventTargetLike, Input, InputOptions } from "@keel-engine/input";
import type { ParticleState, ParticleView, Particles, Recipes } from "@keel-engine/particles";
import type { ObjectDef, ObjectInstance, PieceContexts, PieceDef, PieceKey, Support, WorldBox } from "@keel-engine/object";
import type { Settings, SettingsJSON, Thing } from "./settings.ts";
import type { Explanation, LayerValues, Refusal, SetOptions, SettingValue, WriteResult } from "./config.ts";
import type { ResolvedRules, RuleName, TargetRules } from "./rules.ts";
import type { NamedStream } from "./streams.ts";
import type { RenderBudget } from "./world.ts";

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
