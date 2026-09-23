import type { Stream } from "@keel-engine/core";
import type { PixelView } from "@keel-engine/bake";
import type { EmitterRecipe, Vec3In } from "./recipe.ts";

/** Where attached emitters are: the game's world, asked once a step for each. */
export interface ParticleHost {
  /**
   * Where `unit` is (or its `socket`, when one is named): fill `out` with its position (0..2) and its frame
   * (3..11: a row-major 3×3, local -> world; for a unit that only turns, `frameFromYaw`). False when it's gone:
   * the emitter stops (its particles live on).
   */
  locate(unit: number, socket: string | null, out: Float64Array): boolean;
}

export interface ParticlePoolOptions {
  /** Live particles at most (default 65536). */
  readonly capacity?: number;
  /** Emitters at most (default 4096; up to 65535). */
  readonly emitters?: number;
  /** The seed: a number, or a seeded stream (core's Stream) to draw one from. */
  readonly seed?: number | Pick<Stream, "f">;
  /** Recipes by name (default: none -- pass PRESETS, or define() them). */
  readonly recipes?: Readonly<Record<string, EmitterRecipe>>;
  readonly host?: ParticleHost;
  /** Fill fractions at which importance 0, 1, 2, 3 stop spawning (default [0.55, 0.8, 0.95, 1]). */
  readonly reserve?: readonly [number, number, number, number];
  /** LOD: the fewest pixels a particle should span before it's thinned and grown (default 1.5; 0: off). */
  readonly minPixels?: number;
  /** LOD: the most a particle grows (and 1/m² thins; default 4). */
  readonly maxLod?: number;
  /** LOD under pressure: thin (and grow) as the pool fills toward an importance's reserve (default true). */
  readonly pressure?: boolean;
}

/** What emit takes beyond the recipe and the point. */
export interface ParticleEmitOptions {
  /** Follow this unit (the host locates it each step; the point is ignored). */
  readonly unit?: number;
  /** ...at this socket of it ("hand.R": a torch, a gun). */
  readonly socket?: string;
  /** The anchor's heading for a world point (frame convention: 0 faces +z). */
  readonly yaw?: number;
  /** A cone's axis instead of the recipe's (in the anchor's frame). */
  readonly dir?: Vec3In;
  /** A velocity every particle starts with (world, m/s: a shot's recoil, a moving vehicle not told to the host). */
  readonly velocity?: Vec3In;
  /** Overrides the recipe's priority. */
  readonly priority?: 0 | 1 | 2 | 3;
  /** Scales size, speed and spread (a bigger explosion; default 1). */
  readonly scale?: number;
  /** A burst's count instead of the recipe's draw. */
  readonly count?: number;
  /** Seconds a continuous or trail emitter runs, instead of the recipe's. */
  readonly duration?: number;
}

/** Counters since the pool was made (or resetStats): what was spawned, and why the rest wasn't. */
export interface ParticleStats {
  spawned: number;
  /** Sub-emitted (of spawned). */
  sub: number;
  died: number;
  /** Bounces (a new birth state each). */
  bounced: number;
  /** Not spawned: the emitter was off the picture. */
  culled: number;
  /** Not spawned: thinned by LOD (the rest grew to cover). */
  lod: number;
  /** Not spawned: the pool past the reserve for its importance. */
  budget: number;
  /** Not spawned: the emitter at its own budget. */
  emitterBudget: number;
  /** emit() found no free emitter slot. */
  noEmitter: number;
  /** Typed arrays the pool has made (all at creation: it never grows). */
  growths: number;
}

/** A pool as data (typed-array copies of the live slots; load() also takes plain number arrays, e.g. after JSON). */
export interface ParticlePoolSnapshot {
  readonly format: "keel-particles-pool@2";
  readonly recipes: readonly string[];
  readonly key: number;
  readonly time: number;
  readonly tick: number;
  readonly serial: number;
  readonly wind: readonly number[];
  /** The live slots' indices, and each per-slot array for just those slots (in that order). */
  readonly slots: ArrayLike<number>;
  readonly particles: Readonly<Record<string, ArrayLike<number>>>;
  readonly emitters: Readonly<Record<string, ArrayLike<number>>>;
  /** Each emitter slot's socket name. */
  readonly sockets: readonly (string | null)[];
}

/** The style table the renderer uploads: per style a row of STYLE_WIDTH RGBA texels. */
export interface ParticleStyles {
  /** Bumps whenever a recipe is defined. */
  readonly version: number;
  readonly count: number;
  /**
   * MAX_STYLES × STYLE_WIDTH × 4 floats: texels 0..31 (size, light, alpha, 0) over the life; 32 (size lo, size
   * hi, light lo, light hi); 33 (0, 0, sprite, shade) -- the renderer fills in the ramp; 34 (streak, depth bias,
   * soft rim, 0); 35 (drag, curl, gravity, 0).
   */
  readonly data: Float32Array;
  /** Each style's ramp name. */
  readonly ramps: readonly string[];
}

/**
 * Every slot's birth state -- what the renderer copies to the GPU (its vertex shader evaluates it). A segment is the
 * motion since the last birth or bounce: at segment time τ = t - tSeg (frozen past tStop) it's at
 * motion(p0, v0, vinf, style, τ); its life curves run on age = t - tBirth, over `life` seconds.
 */
export interface ParticleSlots {
  readonly p0: Float64Array;
  readonly v0: Float64Array;
  /** The velocity its drag tends to (the air's, with gravity): x, y, z. */
  readonly vinf: Float64Array;
  readonly tSeg: Float64Array;
  readonly tStop: Float64Array;
  readonly tBirth: Float64Array;
  /** Seconds it lives (0: a free slot). */
  readonly life: Float64Array;
  readonly style: Uint8Array;
  /** A random byte (its size and lightness within the style's spans). */
  readonly rnd: Uint8Array;
  /** Size scale ×16 (LOD and the emit's scale). */
  readonly lod: Uint8Array;
  readonly owner: Uint16Array;
}

/** What the pixel (raymarch) renderer draws: @keel-engine/render's RenderParticle. */
export interface PoolParticleView {
  p: [number, number, number];
  size: number;
  ramp: string;
  light: number;
}

export interface ParticlePool {
  readonly capacity: number;
  readonly emitterCapacity: number;
  /** Live particles. */
  readonly count: number;
  /** Slots in use are all below this (the renderer draws this many). */
  readonly highWater: number;
  /** Live emitters (running or draining). */
  readonly emitters: number;
  /** Seconds simulated (the sum of every step's dt). */
  readonly time: number;
  /** Every slot's birth state (read-only: the renderer's source). */
  readonly slots: ParticleSlots;
  readonly styles: ParticleStyles;
  readonly stats: ParticleStats;
  /** The wind (m/s, world); a particle drifts with `wind` of it -- the wind when it was thrown (or last bounced). */
  readonly wind: Float64Array;
  /** Add a recipe (setup time: it allocates). Returns its index. */
  define(name: string, recipe: EmitterRecipe): number;
  /** A recipe's index by name (-1 if none). */
  recipeId(name: string): number;
  /** The recipe names in index order. */
  readonly recipeNames: readonly string[];
  /** Start an effect at (x, y, z) -- or on a unit / socket. Returns a handle, or -1 when no emitter slot is free. */
  emit(recipe: string | number, x: number, y: number, z: number, options?: ParticleEmitOptions): number;
  /** Move a world-point emitter (and turn it). */
  move(handle: number, x: number, y: number, z: number, yaw?: number): void;
  /** Stop an emitter spawning (its particles live on). */
  stop(handle: number): void;
  /** Is this handle's emitter still running? */
  alive(handle: number): boolean;
  /** Cull and LOD by this view from the next step (null: everything on, full detail). */
  setView(view: Pick<PixelView, "center" | "axes" | "pixelsPerMetre" | "width" | "height"> | null): void;
  /** The same by a ground rectangle and a pixel scale. */
  setViewRect(x0: number, z0: number, x1: number, z1: number, pixelsPerMetre: number): void;
  step(dt: number): void;
  clear(): void;
  save(): ParticlePoolSnapshot;
  load(snapshot: ParticlePoolSnapshot): void;
  /** save() as codec bytes (keel/particles/pool): every number exact, Infinity included. */
  saveBytes(): Uint8Array;
  /** Put saveBytes() back (another document, or another pool's, is refused as load() refuses). */
  loadBytes(bytes: Uint8Array): void;
  resetStats(): void;
  /** Is this slot a live particle? */
  isLive(slot: number): boolean;
  /** The live slots, ascending, into `out` (from 0); returns how many. */
  liveSlots(out: Int32Array | number[]): number;
  /** Where a slot's particle is at time `at` (default: now), into out[o..o+2]; its velocity into out[o+3..o+5]. */
  sample(slot: number, out: Float64Array | number[], o?: number, at?: number): void;
  /** Slots whose birth state changed since the last call (births, bounces), into `out`; -1: all of them (a load or clear). */
  takeChanges(out: Int32Array): number;
  /** The live particles for the pixel renderer (it allocates: hero shots, previews). */
  list(sizeScale?: number): PoolParticleView[];
}
