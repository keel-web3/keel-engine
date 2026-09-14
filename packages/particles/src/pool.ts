// The particle pool: a fixed-capacity structure of arrays that never grows,
// where a particle is thrown once and then left alone. Its motion -- drag
// toward the air it's carried by, gravity, a curl -- is a linear equation
// with a closed form, so a particle is its birth state (where, how fast, the
// drift it tends to, when) and anything can say where it is at any time: the
// GPU draws it at the exact frame time (gpu.ts), and the CPU visits it only
// at its events -- its death, the ground (a bounce is a new birth state; a
// stick freezes it; a raindrop dies there), a sub-emit at its rate. The
// ground is found at birth, analytically. So a step costs the births and the
// events, not the live count; the renderer uploads only what changed.
//
//   const pool = createParticlePool({ capacity: 100_000, seed: world.rng("particles"), recipes: PRESETS, host });
//   const h = pool.emit("fire", x, 0, z);                          // a world point
//   pool.emit("footstep-dust", 0, 0, 0, { unit: id });              // follows a unit (the host says where)
//   pool.emit("muzzle-flash", 0, 0, 0, { unit: id, socket: "hand.R" });
//   pool.setView(view); pool.step(1 / 120);                         // the fixed step; the view culls and LODs
//   renderer.draw(view, pool, { ahead });                           // gpu.ts: at the frame's own time
//
// Slots are stable (a particle keeps its slot for life; a free slot is the
// lowest one free), so the GPU copy of a slot is written at birth and never
// again unless it bounces.
//
// Budgets: a global capacity with headroom kept for what matters -- an
// emitter of importance i stops spawning once the pool is `reserve[i]` full
// (ambient first, critical last), importance being the recipe's priority,
// one less far from the view's centre; an emitter off the picture spawns
// nothing; a recipe may cap its own live count. LOD: when a particle would
// be under `minPixels` on screen (zoomed out) or the pool is filling, an
// emitter throws 1/m² of its particles m times bigger -- fewer and bigger,
// the same coverage. Nothing is ever allocated to make room.
//
// Deterministic: every draw is a counter hash of (the pool's seed, the
// emitter's serial, its spawn index, the draw) -- so the same seed, emits and
// views give the same particles, and an emitter's k-th particle is the same
// whatever else was dropped or spawned. (Particles are for the eye: a view
// that culls or LODs changes them, which no game state may read.)

import type { Stream } from "@keel-engine/core";
import { PARTICLE_POOL, decode, encode } from "@keel-engine/codec";
import type { ParticlePoolRecord } from "@keel-engine/codec";
import type { PixelView } from "@keel-engine/bake";
import { sampleCurve } from "./recipe.ts";
import type { EmitterRecipe, ParticleSprite, Span, Vec3In } from "./recipe.ts";
import { PARTICLE_SPRITES } from "./recipe.ts";

/** Samples per life curve in the style table. */
export const CURVE_SAMPLES = 32;
/** Texels per style row: the curves (size, light, alpha), then four of constants. */
export const STYLE_WIDTH = CURVE_SAMPLES + 4;
/** Recipes (and so styles) a pool can hold: a particle names its style in one byte. */
export const MAX_STYLES = 256;
/** A particle with no emitter (a sub-emit's). */
export const NO_EMITTER = 0xffff;
/** A segment that never freezes. */
export const NEVER = 1e9;

const GROUND = { none: 0, bounce: 1, stick: 2, die: 3 } as const;
const MODE = { burst: 0, continuous: 1, trail: 2 } as const;
const SHAPE = { point: 0, sphere: 1, disc: 2, ring: 3, cone: 4, area: 5 } as const;
const TRIG = { death: 0, ground: 1, live: 2 } as const;
const ALIVE = 1;
const GROUNDED = 2;

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

// ---------------------------------------------------------------- hashing

/** A 32-bit integer mix (lowbias32): the pool's only source of randomness, keyed by counters. */
export function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

// Why the code below looks the way it does: V8 boxes a double (allocates a HeapNumber) whenever one crosses
// a call it hasn't inlined, as an argument or a result -- and a step this size runs out of inlining. So the
// hot functions pass only small integers and objects; doubles travel through typed arrays (the F scratch);
// hash keys are 30 bits (small integers to V8) and a draw is an integer, scaled to [0, 1) where it's used.
// And the functions live at module level over one state object, so every pool shares one optimized copy.

/** A 30-bit hash of an integer. */
function h30(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 2;
}
const INV30 = 1 / 1073741824;
/** Draw `d` of key `key`: 0 .. 2^30-1 (times INV30 for [0, 1)). */
const draw = (key: number, d: number): number => h30((key + Math.imul(d, 0x9e3779b9)) | 0);

/** A frame for a unit that only turns: position and rotY(yaw) into `out` (as ParticleHost.locate fills it). */
export function frameFromYaw(x: number, y: number, z: number, yaw: number, out: Float64Array, o = 0): Float64Array {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[o] = x; out[o + 1] = y; out[o + 2] = z;
  out[o + 3] = c; out[o + 4] = 0; out[o + 5] = s;
  out[o + 6] = 0; out[o + 7] = 1; out[o + 8] = 0;
  out[o + 9] = -s; out[o + 10] = 0; out[o + 11] = c;
  return out;
}

/** A point in a located frame (position + 3×3 as the host fills it) -> world, into `out`. */
export function frameToWorld(f: ArrayLike<number>, lx: number, ly: number, lz: number, out: Float64Array | number[], o = 0): void {
  out[o] = f[0]! + f[3]! * lx + f[4]! * ly + f[5]! * lz;
  out[o + 1] = f[1]! + f[6]! * lx + f[7]! * ly + f[8]! * lz;
  out[o + 2] = f[2]! + f[9]! * lx + f[10]! * ly + f[11]! * lz;
}

// ---------------------------------------------------------------- the motion (gpu.ts has its GLSL twin)

// The closed form: drag d toward the drift velocity vinf, gravity g (in vinf.y when d > 0), and the horizontal
// velocity turning at c rad/s -- as a complex number u = vx + i·vz, u' = (-d + i·c)(u - u∞). Inputs at M[i..i+13]:
// p0 (3), v0 (3), vinf (3), d, c, g, τ (segment time), tStop (frozen past it); out at M[o..o+5]: position,
// velocity. (Typed arrays in, typed arrays out: nothing boxed.)
function motionCore(M: Float64Array, i: number, o: number): void {
  const p0x = M[i]!, p0y = M[i + 1]!, p0z = M[i + 2]!, v0x = M[i + 3]!, v0y = M[i + 4]!, v0z = M[i + 5]!, ix = M[i + 6]!, iy = M[i + 7]!, iz = M[i + 8]!;
  const d = M[i + 9]!, c = M[i + 10]!, g = M[i + 11]!, tau = M[i + 12]!, tStop = M[i + 13]!;
  const frozen = tau >= tStop;
  const t = frozen ? tStop : tau;
  // Horizontal: x = p0 + u∞·t + (u0 - u∞)(e^{λt} - 1)/λ, λ = -d + i·c.
  let hx: number, hz: number, ux: number, uz: number;
  if (d === 0 && c === 0) {
    hx = p0x + v0x * t; hz = p0z + v0z * t; ux = v0x; uz = v0z;
  } else {
    const ed = Math.exp(-d * t);
    const er = ed * Math.cos(c * t), ei = ed * Math.sin(c * t);
    const den = d * d + c * c;
    const a = er - 1, b = ei;
    const Ar = (-a * d + b * c) / den, Ai = (-a * c - b * d) / den;
    const wx = v0x - ix, wz = v0z - iz;
    hx = p0x + ix * t + (wx * Ar - wz * Ai);
    hz = p0z + iz * t + (wx * Ai + wz * Ar);
    ux = ix + (wx * er - wz * ei);
    uz = iz + (wx * ei + wz * er);
  }
  // Vertical: toward vinf.y with drag, or plain gravity without.
  let y: number, vy: number;
  if (d > 0) {
    const ed = Math.exp(-d * t);
    y = p0y + iy * t + ((v0y - iy) * (1 - ed)) / d;
    vy = iy + (v0y - iy) * ed;
  } else {
    y = p0y + v0y * t - 0.5 * g * t * t;
    vy = v0y - g * t;
  }
  M[o] = hx; M[o + 1] = y; M[o + 2] = hz;
  if (frozen) { M[o + 3] = 0; M[o + 4] = 0; M[o + 5] = 0; } else { M[o + 3] = ux; M[o + 4] = vy; M[o + 5] = uz; }
}

const MOTION = new Float64Array(20);
/**
 * The pool's motion in closed form (gpu.ts has the GLSL twin): from p0 with velocity v0, drag d toward the
 * drift velocity vinf (gravity folded into vinf.y when d > 0; plain gravity g when d is 0), the horizontal
 * velocity turning at c rad/s; at segment time τ, frozen past tStop. Position into out[o..o+2], velocity
 * into out[o+3..o+5].
 */
export function motionAt(
  p0: ArrayLike<number>, v0: ArrayLike<number>, vinf: ArrayLike<number>, d: number, c: number, g: number, tau: number, tStop: number, out: Float64Array | number[], o = 0,
): void {
  for (let k = 0; k < 3; k += 1) { MOTION[k] = p0[k]!; MOTION[3 + k] = v0[k]!; MOTION[6 + k] = vinf[k]!; }
  MOTION[9] = d; MOTION[10] = c; MOTION[11] = g; MOTION[12] = tau; MOTION[13] = tStop;
  motionCore(MOTION, 0, 14);
  for (let k = 0; k < 6; k += 1) out[o + k] = MOTION[14 + k]!;
}

// ---------------------------------------------------------------- compiled recipes

interface Compiled {
  readonly name: string;
  readonly index: number;
  readonly src: EmitterRecipe;
  mode: number; shape: number;
  count0: number; count1: number; rate: number; density: number; perMetre: number; duration: number; delay: number;
  radius: number; areaView: boolean; ax: number; ay: number; az: number;
  dx: number; dy: number; dz: number; oneMinusCos: number;
  speed0: number; speed1: number; up0: number; up1: number; vx: number; vy: number; vz: number; inherit: number;
  ox: number; oy: number; oz: number; priority: number; budget: number; reach: number;
  also: number[];
  alsoRefs: readonly (string | EmitterRecipe)[];
  life0: number; life1: number; meanSize: number;
}

const span = (s: Span | undefined, d: number): [number, number] => (s ? [s[0], s[1]] : [d, d]);

// F (doubles between functions):
//   0..2 a spawn's centre, 3..5 the velocity it inherits, 6..7 an area's half-extents, 8..10 a cone's axis,
//   11 LOD, 12 the emit's scale, 13 dt, 14 minPixels, 15 maxLod, 16 now, 17 a spawn's birth time,
//   18 a sample's time, 20..25 a sample's position and velocity, 26 a ground hit (segment time; NEVER: none), 27..29 its scratch,
//   32..45 motion's inputs (see motionCore).
const F_SIZE = 48;

/** Everything a pool is: typed arrays, a few counters, the recipes. */
class PoolState {
  readonly N: number;
  readonly E: number;
  readonly stats: ParticleStats;
  // Particles, by slot.
  readonly p0: Float64Array;
  readonly v0: Float64Array;
  readonly vinf: Float64Array;
  readonly tSeg: Float64Array;
  readonly tStop: Float64Array;
  readonly tBirth: Float64Array;
  readonly life: Float64Array;
  readonly tGround: Float64Array; // absolute time of its next ground event (Infinity: none)
  readonly tLive: Float64Array; // absolute time of its next live sub-emit (Infinity: none)
  readonly tEvent: Float64Array; // the soonest of its death, ground and live events (Infinity: a free slot)
  readonly style: Uint8Array;
  readonly rnd: Uint8Array;
  readonly lod: Uint8Array;
  readonly pseed: Uint32Array;
  readonly owner: Uint16Array;
  readonly flags: Uint8Array;
  readonly liveN: Uint16Array; // live sub-emits so far (keys the next one)
  count = 0;
  highWater = 0;
  readonly heap: Int32Array; // free slots, a min-heap: the lowest free slot comes out first
  heapSize: number;
  readonly changed: Uint8Array;
  readonly changes: Int32Array;
  changeCount = 0;
  allChanged = true;
  // Emitters: slots, a free stack, the running list.
  readonly eState: Uint8Array; // 0 free, 1 running, 2 draining (waiting for its particles to die)
  readonly eGen: Uint16Array;
  readonly eRecipe: Int32Array;
  readonly eUnit: Int32Array;
  readonly eSocket: (string | null)[];
  readonly eP: Float64Array;
  readonly ePrev: Float64Array;
  readonly eV: Float64Array;
  readonly eBaseV: Float64Array;
  readonly eF: Float64Array; // the located frame: position + 3×3
  readonly eDir: Float64Array;
  readonly eHasDir: Uint8Array;
  readonly eAge: Float64Array;
  readonly eDur: Float64Array; // (-1: until stopped)
  readonly eAcc: Float64Array;
  readonly eLodAcc: Float64Array;
  readonly eSpawn: Float64Array;
  readonly eKey: Uint32Array;
  readonly ePri: Uint8Array;
  readonly eScale: Float32Array;
  readonly eCount: Int32Array;
  readonly eLive: Int32Array;
  readonly eFresh: Uint8Array;
  readonly eFired: Uint8Array;
  readonly active: Int32Array;
  readonly activeAt: Int32Array;
  readonly free: Int32Array;
  activeCount = 0;
  freeTop: number;
  serial = 0;
  tick = 0;
  readonly key0: number;
  readonly wind: Float64Array;
  readonly scratch: Float64Array;
  readonly F: Float64Array;
  // The view: 0..3 its ground rectangle (x0, z0, x1, z1), 4..5 its centre, 6 "far" squared, 7 pixels per metre.
  readonly V: Float64Array;
  hasView = false;
  readonly limit: Int32Array; // live particles past which importance 0..3 stop spawning
  readonly usePressure: boolean;
  readonly host: ParticleHost | null;
  // Styles (one per recipe): the renderer's table and what the step reads.
  readonly styleData: Float32Array;
  readonly styleRamps: string[] = [];
  readonly sGrav: Float64Array;
  readonly sDrag: Float64Array;
  readonly sWind: Float64Array;
  readonly sCurl: Float64Array;
  readonly sGround: Uint8Array;
  readonly sBounce: Float64Array;
  readonly sFric: Float64Array;
  readonly sSub: Int32Array; // per trigger (death, ground, live): the recipe thrown, or -1
  readonly sSubC0: Float64Array;
  readonly sSubC1: Float64Array;
  readonly sSubRate: Float64Array;
  readonly sSubChance: Float64Array;
  readonly sSubInherit: Float64Array;
  readonly sSubRefs: (string | EmitterRecipe | null)[];
  readonly recipes: Compiled[] = [];
  readonly byName = new Map<string, number>();
  readonly names: string[] = [];
  readonly styles: { version: number; count: number; data: Float32Array; ramps: readonly string[] } = { version: 0, count: 0, data: new Float32Array(0), ramps: [] };
  readonly slots: ParticleSlots;

  constructor(N: number, E: number, o: ParticlePoolOptions) {
    this.N = N;
    this.E = E;
    const stats: ParticleStats = { spawned: 0, sub: 0, died: 0, bounced: 0, culled: 0, lod: 0, budget: 0, emitterBudget: 0, noEmitter: 0, growths: 0 };
    this.stats = stats;
    // (Every typed array the pool will ever have, counted: the tests hold this still.)
    const T = <A>(a: A): A => { stats.growths += 1; return a; };
    this.p0 = T(new Float64Array(N * 3));
    this.v0 = T(new Float64Array(N * 3));
    this.vinf = T(new Float64Array(N * 3));
    this.tSeg = T(new Float64Array(N));
    this.tStop = T(new Float64Array(N));
    this.tBirth = T(new Float64Array(N));
    this.life = T(new Float64Array(N));
    this.tGround = T(new Float64Array(N).fill(Infinity));
    this.tLive = T(new Float64Array(N).fill(Infinity));
    this.tEvent = T(new Float64Array(N).fill(Infinity));
    this.style = T(new Uint8Array(N));
    this.rnd = T(new Uint8Array(N));
    this.lod = T(new Uint8Array(N));
    this.pseed = T(new Uint32Array(N));
    this.owner = T(new Uint16Array(N));
    this.flags = T(new Uint8Array(N));
    this.liveN = T(new Uint16Array(N));
    this.heap = T(new Int32Array(N));
    for (let i = 0; i < N; i += 1) this.heap[i] = i; // (ascending: already a min-heap)
    this.heapSize = N;
    this.changed = T(new Uint8Array(N));
    this.changes = T(new Int32Array(N));
    this.eState = T(new Uint8Array(E));
    this.eGen = T(new Uint16Array(E));
    this.eRecipe = T(new Int32Array(E));
    this.eUnit = T(new Int32Array(E));
    this.eSocket = new Array<string | null>(E).fill(null);
    this.eP = T(new Float64Array(E * 3));
    this.ePrev = T(new Float64Array(E * 3));
    this.eV = T(new Float64Array(E * 3));
    this.eBaseV = T(new Float64Array(E * 3));
    this.eF = T(new Float64Array(E * 12));
    this.eDir = T(new Float64Array(E * 3));
    this.eHasDir = T(new Uint8Array(E));
    this.eAge = T(new Float64Array(E));
    this.eDur = T(new Float64Array(E));
    this.eAcc = T(new Float64Array(E));
    this.eLodAcc = T(new Float64Array(E));
    this.eSpawn = T(new Float64Array(E));
    this.eKey = T(new Uint32Array(E));
    this.ePri = T(new Uint8Array(E));
    this.eScale = T(new Float32Array(E));
    this.eCount = T(new Int32Array(E));
    this.eLive = T(new Int32Array(E));
    this.eFresh = T(new Uint8Array(E));
    this.eFired = T(new Uint8Array(E));
    this.active = T(new Int32Array(E));
    this.activeAt = T(new Int32Array(E));
    this.free = T(new Int32Array(E));
    for (let i = 0; i < E; i += 1) this.free[i] = E - 1 - i; // (slot 0 comes off first)
    this.freeTop = E;
    const seed = o.seed ?? 1;
    this.key0 = typeof seed === "number" ? h30((seed >>> 0) ^ 0x5eed) : (((Math.floor(seed.f() * 65536) << 14) ^ Math.floor(seed.f() * 65536)) & 0x3fffffff);
    this.wind = T(new Float64Array(3));
    this.scratch = T(new Float64Array(12));
    this.F = T(new Float64Array(F_SIZE));
    this.F[14] = o.minPixels ?? 1.5;
    this.F[15] = o.maxLod ?? 4;
    this.V = T(new Float64Array(8));
    const reserve = o.reserve ?? [0.55, 0.8, 0.95, 1];
    this.limit = T(new Int32Array(4));
    for (let q = 0; q < 4; q += 1) this.limit[q] = Math.floor(N * reserve[q]!);
    this.usePressure = o.pressure ?? true;
    this.host = o.host ?? null;
    this.styleData = T(new Float32Array(MAX_STYLES * STYLE_WIDTH * 4));
    this.styles.data = this.styleData;
    this.styles.ramps = this.styleRamps;
    this.sGrav = T(new Float64Array(MAX_STYLES));
    this.sDrag = T(new Float64Array(MAX_STYLES));
    this.sWind = T(new Float64Array(MAX_STYLES));
    this.sCurl = T(new Float64Array(MAX_STYLES));
    this.sGround = T(new Uint8Array(MAX_STYLES));
    this.sBounce = T(new Float64Array(MAX_STYLES));
    this.sFric = T(new Float64Array(MAX_STYLES));
    this.sSub = T(new Int32Array(MAX_STYLES * 3).fill(-1));
    this.sSubC0 = T(new Float64Array(MAX_STYLES * 3));
    this.sSubC1 = T(new Float64Array(MAX_STYLES * 3));
    this.sSubRate = T(new Float64Array(MAX_STYLES * 3));
    this.sSubChance = T(new Float64Array(MAX_STYLES * 3));
    this.sSubInherit = T(new Float64Array(MAX_STYLES * 3));
    this.sSubRefs = new Array<string | EmitterRecipe | null>(MAX_STYLES * 3).fill(null);
    this.slots = { p0: this.p0, v0: this.v0, vinf: this.vinf, tSeg: this.tSeg, tStop: this.tStop, tBirth: this.tBirth, life: this.life, style: this.style, rnd: this.rnd, lod: this.lod, owner: this.owner };
  }
}

// ---------------------------------------------------------------- recipes -> styles

function writeStyle(S: PoolState, c: Compiled) {
  const p = c.src.particle;
  const s = c.index;
  const d = S.styleData;
  const row = s * STYLE_WIDTH * 4;
  for (let k = 0; k < CURVE_SAMPLES; k += 1) {
    const t = k / (CURVE_SAMPLES - 1);
    d[row + k * 4] = sampleCurve(p.sizeCurve, t);
    d[row + k * 4 + 1] = sampleCurve(p.lightCurve, t);
    d[row + k * 4 + 2] = Math.min(1, sampleCurve(p.alpha, t));
    d[row + k * 4 + 3] = 0;
  }
  const o = row + CURVE_SAMPLES * 4;
  d.set([p.size[0], p.size[1], p.light[0], p.light[1]], o);
  d.set([0, 0, PARTICLE_SPRITES.indexOf(p.sprite ?? "dot"), p.shade ?? 0], o + 4);
  d.set([p.streak ?? 0, p.depthBias ?? 0, p.soft ?? (p.sprite === "puff" ? 0.5 : 0), 0], o + 8);
  d.set([p.drag ?? 0, p.curl ?? 0, p.gravity ?? 0, 0], o + 12);
  S.styleRamps[s] = p.ramp;
  S.sGrav[s] = p.gravity ?? 0;
  S.sDrag[s] = p.drag ?? 0;
  S.sWind[s] = p.wind ?? 0;
  S.sCurl[s] = p.curl ?? 0;
  S.sGround[s] = GROUND[p.ground ?? "none"];
  S.sBounce[s] = p.bounce ?? 0.4;
  S.sFric[s] = p.friction ?? 0.7;
  for (const sub of p.sub ?? []) {
    const j = s * 3 + TRIG[sub.on];
    if (S.sSubRefs[j]) throw new RangeError(`Recipe "${c.name}": two sub-emits on "${sub.on}".`);
    S.sSubRefs[j] = sub.emit;
    S.sSubC0[j] = sub.count?.[0] ?? 1;
    S.sSubC1[j] = sub.count?.[1] ?? sub.count?.[0] ?? 1;
    S.sSubRate[j] = sub.rate ?? 0;
    S.sSubChance[j] = sub.chance ?? 1;
    S.sSubInherit[j] = sub.inherit ?? 0.3;
  }
}

function compile(S: PoolState, name: string, r: EmitterRecipe): number {
  if (S.byName.has(name)) throw new RangeError(`A particle recipe "${name}" is already defined.`);
  if (S.recipes.length >= MAX_STYLES) throw new RangeError(`At most ${MAX_STYLES} particle recipes (inline ones included).`);
  const index = S.recipes.length;
  const p = r.particle;
  const [dx, dy, dz] = r.dir ?? [0, 1, 0];
  const dl = Math.hypot(dx, dy, dz) || 1;
  const area = r.area === "view" ? [0, 0, 0] : r.area ?? [0, 0, 0];
  const sizeMax = Math.max(...(p.sizeCurve ?? [1]));
  const c: Compiled = {
    name, index, src: r,
    mode: MODE[r.mode], shape: SHAPE[r.shape],
    count0: r.count?.[0] ?? 0, count1: r.count?.[1] ?? 0, rate: r.rate ?? 0, density: r.density ?? 0, perMetre: r.perMetre ?? 0,
    duration: r.duration ?? (r.mode === "burst" ? 0 : Infinity), delay: r.delay ?? 0,
    radius: r.radius ?? 0, areaView: r.area === "view", ax: area[0]!, ay: area[1]!, az: area[2]!,
    dx: dx / dl, dy: dy / dl, dz: dz / dl, oneMinusCos: 1 - Math.cos(r.angle ?? 0),
    speed0: r.speed[0], speed1: r.speed[1], up0: span(r.up, 0)[0], up1: span(r.up, 0)[1],
    vx: r.velocity?.[0] ?? 0, vy: r.velocity?.[1] ?? 0, vz: r.velocity?.[2] ?? 0, inherit: r.inherit ?? 0,
    ox: r.offset?.[0] ?? 0, oy: r.offset?.[1] ?? 0, oz: r.offset?.[2] ?? 0,
    priority: r.priority ?? 1, budget: r.budget ?? 0, reach: r.reach ?? 4,
    also: [], alsoRefs: r.also ?? [],
    life0: p.life[0], life1: p.life[1], meanSize: ((p.size[0] + p.size[1]) / 2) * sizeMax,
  };
  S.recipes.push(c);
  S.byName.set(name, index);
  S.names.push(name);
  writeStyle(S, c);
  // (Inline children are recipes of their own, named after their parent.)
  c.alsoRefs.forEach((a, i) => { if (typeof a === "object") compile(S, `${name}#also${i}`, a); });
  (p.sub ?? []).forEach((s, i) => { if (typeof s.emit === "object") compile(S, `${name}#sub${i}`, s.emit); });
  S.styles.count = S.recipes.length;
  S.styles.version += 1;
  return index;
}

function link(S: PoolState, c: Compiled) {
  const ref = (a: string | EmitterRecipe, what: string, inline: string): number => {
    const n = typeof a === "string" ? a : inline;
    const i = S.byName.get(n);
    if (i === undefined) throw new RangeError(`Recipe "${c.name}" ${what} "${n}", which isn't defined.`);
    return i;
  };
  c.also = c.alsoRefs.map((a, i) => ref(a, "starts", `${c.name}#also${i}`));
  (c.src.particle.sub ?? []).forEach((s, i) => { S.sSub[c.index * 3 + TRIG[s.on]] = ref(s.emit, "throws", `${c.name}#sub${i}`); });
}

function defineAll(S: PoolState, recipes: Readonly<Record<string, EmitterRecipe>>): number {
  const first = S.recipes.length;
  let index = -1;
  for (const [name, r] of Object.entries(recipes)) { const i = compile(S, name, r); if (index < 0) index = i; }
  for (let i = first; i < S.recipes.length; i += 1) link(S, S.recipes[i]!);
  return index;
}

// ---------------------------------------------------------------- slots

function logChange(S: PoolState, i: number) {
  if (S.changed[i] === 0) { S.changed[i] = 1; S.changes[S.changeCount] = i; S.changeCount += 1; }
}

function takeSlot(S: PoolState): number {
  const h = S.heap;
  const top = h[0]!;
  S.heapSize -= 1;
  const n = S.heapSize;
  if (n > 0) {
    // (Sift the last one down from the root.)
    const x = h[n]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= n) break;
      const r = l + 1;
      const m = r < n && h[r]! < h[l]! ? r : l;
      if (h[m]! >= x) break;
      h[i] = h[m]!;
      i = m;
    }
    h[i] = x;
  }
  if (top + 1 > S.highWater) S.highWater = top + 1;
  return top;
}

function freeSlot(S: PoolState, s: number) {
  const em = S.owner[s]!;
  if (em !== NO_EMITTER) S.eLive[em] = S.eLive[em]! - 1;
  S.flags[s] = 0;
  S.life[s] = 0;
  S.tEvent[s] = Infinity; S.tGround[s] = Infinity; S.tLive[s] = Infinity;
  S.count -= 1;
  S.stats.died += 1;
  // (Sift up.)
  const h = S.heap;
  let i = S.heapSize;
  S.heapSize += 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p]! <= s) break;
    h[i] = h[p]!;
    i = p;
  }
  h[i] = s;
  if (s === S.highWater - 1) { let w = s; while (w > 0 && (S.flags[w - 1]! & ALIVE) === 0) w -= 1; S.highWater = w; }
}

// A slot's position and velocity at time F[18], into F[20..25].
function sampleSlot(S: PoolState, i: number) {
  const s = S.style[i]!;
  const o = i * 3;
  const F = S.F, p0 = S.p0, v0 = S.v0, vi = S.vinf;
  F[32] = p0[o]!; F[33] = p0[o + 1]!; F[34] = p0[o + 2]!;
  F[35] = v0[o]!; F[36] = v0[o + 1]!; F[37] = v0[o + 2]!;
  F[38] = vi[o]!; F[39] = vi[o + 1]!; F[40] = vi[o + 2]!;
  F[41] = S.sDrag[s]!; F[42] = S.sCurl[s]!; F[43] = S.sGrav[s]!; F[44] = F[18]! - S.tSeg[i]!; F[45] = S.tStop[i]!;
  motionCore(F, 32, 20);
}

// The first segment time at which slot i's height reaches 0 (before its life runs out), into F[26] (NEVER: none).
function groundHit(S: PoolState, i: number) {
  const F = S.F;
  const s = S.style[i]!;
  const o = i * 3;
  const y0 = S.p0[o + 1]!, vy0 = S.v0[o + 1]!, iy = S.vinf[o + 1]!;
  const d = S.sDrag[s]!, g = S.sGrav[s]!;
  const T = S.tBirth[i]! + S.life[i]! - S.tSeg[i]!;
  F[26] = NEVER;
  if (T <= 0) return;
  if (y0 <= 0 && vy0 <= 0) { F[26] = 0; return; }
  if (d === 0) {
    // y = y0 + vy0 τ - g τ²/2: its smallest positive root.
    const a = -0.5 * g;
    F[29] = NEVER;
    if (a === 0) { if (vy0 < 0) F[29] = -y0 / vy0; } else {
      const disc = vy0 * vy0 - 4 * a * y0;
      if (disc >= 0) {
        const q = Math.sqrt(disc);
        const r1 = (-vy0 - q) / (2 * a), r2 = (-vy0 + q) / (2 * a);
        const lo = r1 < r2 ? r1 : r2, hi = r1 < r2 ? r2 : r1;
        if (lo > 1e-9) F[29] = lo; else if (hi > 1e-9) F[29] = hi;
      }
    }
    if (F[29]! <= T) F[26] = F[29]!;
    return;
  }
  // y = y0 + iy τ + B(1 - e^{-dτ}), B = (vy0 - iy)/d: concave when B > 0 (a peak, then down), convex when B < 0.
  // (Bisection between a point above the ground and one at or below it.)
  // (The bracket lives in F[27] (lo) and F[28] (hi), not in locals, and no conditional mixes a small-integer constant
  // with a double: V8 can keep such a value boxed, and this path would allocate on every ground hit.)
  const B = (vy0 - iy) / d;
  F[27] = 0; F[28] = T;
  if (B > 0) {
    if (iy >= 0) return; // (it never comes down)
    if (vy0 > 0) F[27] = Math.log((vy0 - iy) / -iy) / d;
    if (F[27]! >= T || y0 + iy * T + B * (1 - Math.exp(-d * T)) > 0) return;
  } else {
    // (Convex: falling slower and slower, maybe turning up: the lowest point is where vy = 0, or the end.)
    if (vy0 >= 0) return;
    if (iy > 0) { const tm = Math.log((vy0 - iy) / -iy) / d; if (tm < T) F[28] = tm; }
    if (y0 + iy * F[28]! + B * (1 - Math.exp(-d * F[28]!)) > 0) return;
  }
  for (let k = 0; k < 40 && F[28]! - F[27]! > 1e-6; k += 1) {
    const m: number = (F[27]! + F[28]!) * 0.5;
    if (y0 + iy * m + B * (1 - Math.exp(-d * m)) > 0) F[27] = m; else F[28] = m;
  }
  F[26] = F[28]!;
}

// The soonest of slot i's events.
function schedule(S: PoolState, i: number) {
  const tDeath = S.tBirth[i]! + S.life[i]!;
  const g = S.tGround[i]!, l = S.tLive[i]!;
  let t = tDeath;
  if (g < t) t = g;
  if (l < t) t = l;
  S.tEvent[i] = t;
}

// Slot i's segment starts at F[17] from its current p0/v0: the drift velocity it tends to (with the wind now),
// its ground event, its events.
function startSegment(S: PoolState, i: number) {
  const F = S.F;
  const s = S.style[i]!;
  const o = i * 3;
  S.tSeg[i] = F[17]!;
  const d = S.sDrag[s]!, c = S.sCurl[s]!, g = S.sGrav[s]!, wr = S.sWind[s]!;
  if (d > 0) {
    const wx = S.wind[0]! * wr, wy = S.wind[1]! * wr, wz = S.wind[2]! * wr;
    const k = d / (d * d + c * c);
    S.vinf[o] = k * (wx * d - wz * c);
    S.vinf[o + 1] = wy - g / d;
    S.vinf[o + 2] = k * (wx * c + wz * d);
  } else { S.vinf[o] = 0; S.vinf[o + 1] = 0; S.vinf[o + 2] = 0; }
  S.tGround[i] = Infinity;
  const mode = S.sGround[s]!;
  if (mode !== 0 && S.tStop[i]! >= NEVER) {
    groundHit(S, i);
    if (F[26]! < NEVER) {
      const hit = F[26]!;
      if (mode === 2) S.tStop[i] = hit; // (stick: it freezes where it lands)
      else if (mode === 3) S.life[i] = S.tSeg[i]! + hit - S.tBirth[i]!; // (die: its life ends there)
      // (An event when something happens there: a bounce, a death with a sub-emit, a first touch with one.)
      if (mode === 1 || ((S.flags[i]! & GROUNDED) === 0 && S.sSub[s * 3 + 1]! >= 0)) S.tGround[i] = S.tSeg[i]! + hit;
    }
  }
  schedule(S, i);
  logChange(S, i);
}

// ---------------------------------------------------------------- the step

// LOD for a recipe at an importance: m >= 1 (keep 1/m², grow m), into F[11].
function lodFor(S: PoolState, c: Compiled, imp: number): void {
  const F = S.F;
  let m = 1;
  if (S.hasView && F[14]! > 0) { const px = c.meanSize * S.V[7]!; if (px < F[14]!) m = F[14]! / Math.max(px, 1e-6); }
  if (S.usePressure && imp < 3) {
    const r = S.count / S.limit[imp]!;
    if (r > 0.5) m *= 1 + (r - 0.5) * 2;
  }
  F[11] = m > F[15]! ? F[15]! : m;
}

// How important is an emit of recipe c at F[0], F[2] (scaled by F[12]) -- and -1 when it's off the picture
// (padded by the recipe's reach). The point is read from F so no double crosses the call.
function importance(S: PoolState, pri: number, c: Compiled): number {
  if (!S.hasView) return pri;
  const V = S.V;
  const x = S.F[0]!, z = S.F[2]!;
  const pad = c.reach * S.F[12]!;
  if (!c.areaView && (x < V[0]! - pad || x > V[2]! + pad || z < V[1]! - pad || z > V[3]! + pad)) return -1;
  if (pri === 0) return 0;
  const dx = x - V[4]!, dz = z - V[5]!;
  return dx * dx + dz * dz > V[6]! ? pri - 1 : pri;
}

// One particle of recipe c for emitter em, hash key `key`, born at F[17]; the rest in F.
function spawn(S: PoolState, c: Compiled, em: number, key: number) {
  const F = S.F;
  const cx = F[0]!, cy = F[1]!, cz = F[2]!, hx = F[6]!, hz = F[7]!, m = F[11]!, sc = F[12]!;
  const i = takeSlot(S);
  S.count += 1;
  const sp = (c.speed0 + (c.speed1 - c.speed0) * draw(key, 1) * INV30) * sc;
  const up = c.up0 + (c.up1 - c.up0) * draw(key, 2) * INV30;
  let px = cx, py = cy, pz = cz, vx = 0, vy = 0, vz = 0;
  const a = draw(key, 0) * INV30 * Math.PI * 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  switch (c.shape) {
    case 0: // point: a random heading, sideways
      vx = ca * sp; vz = sa * sp;
      break;
    case 1: { // sphere: any direction, from within the radius
      const u = draw(key, 5) * INV30 * 2 - 1;
      const rr = Math.sqrt(1 - u * u);
      vx = rr * ca * sp; vy = u * sp; vz = rr * sa * sp;
      const d = c.radius * sc * Math.cbrt(draw(key, 6) * INV30);
      px += rr * ca * d; py += u * d; pz += rr * sa * d;
      break;
    }
    case 2: { // disc: from within the radius on the ground plane, a random heading
      const d = c.radius * sc * Math.sqrt(draw(key, 6) * INV30);
      const b = draw(key, 7) * INV30 * Math.PI * 2;
      px += Math.cos(b) * d; pz += Math.sin(b) * d;
      vx = ca * sp; vz = sa * sp;
      break;
    }
    case 3: // ring: outward from a circle
      px += ca * c.radius * sc; pz += sa * c.radius * sc;
      vx = ca * sp; vz = sa * sp;
      break;
    case 4: { // cone: within the angle of its axis (turned by the frame)
      const adx = F[8]!, ady = F[9]!, adz = F[10]!;
      const ct = 1 - draw(key, 5) * INV30 * c.oneMinusCos;
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      // (Two axes square to the cone's: any pair will do.)
      let bx: number, by: number, bz: number;
      if (Math.abs(ady) < 0.9) { bx = adz; by = 0; bz = -adx; } else { bx = 0; by = -adz; bz = ady; }
      const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      bx /= bl; by /= bl; bz /= bl;
      const qx = ady * bz - adz * by, qy = adz * bx - adx * bz, qz = adx * by - ady * bx;
      vx = (adx * ct + (bx * ca + qx * sa) * st) * sp;
      vy = (ady * ct + (by * ca + qy * sa) * st) * sp;
      vz = (adz * ct + (bz * ca + qz * sa) * st) * sp;
      break;
    }
    default: // area: anywhere in the box (half-extents hx, ay, hz), a random heading
      px += (draw(key, 5) * INV30 * 2 - 1) * hx;
      py += (draw(key, 6) * INV30 * 2 - 1) * c.ay * sc;
      pz += (draw(key, 7) * INV30 * 2 - 1) * hz;
      vx = ca * sp; vz = sa * sp;
  }
  const o3 = i * 3;
  S.p0[o3] = px; S.p0[o3 + 1] = py; S.p0[o3 + 2] = pz;
  S.v0[o3] = vx + c.vx + F[3]!; S.v0[o3 + 1] = vy + up + c.vy + F[4]!; S.v0[o3 + 2] = vz + c.vz + F[5]!;
  S.tBirth[i] = F[17]!;
  S.life[i] = c.life0 + (c.life1 - c.life0) * draw(key, 3) * INV30;
  S.tStop[i] = NEVER;
  S.style[i] = c.index;
  S.rnd[i] = draw(key, 4) & 255;
  const lq = Math.round(16 * m * sc);
  S.lod[i] = lq < 1 ? 1 : lq > 255 ? 255 : lq;
  S.pseed[i] = key;
  S.owner[i] = em;
  S.flags[i] = ALIVE;
  S.liveN[i] = 0;
  const jl = c.index * 3 + 2;
  S.tLive[i] = S.sSub[jl]! >= 0 ? F[17]! + (0.5 + draw(key, 16) * INV30) / S.sSubRate[jl]! : Infinity;
  if (em !== NO_EMITTER) S.eLive[em] = S.eLive[em]! + 1;
  S.stats.spawned += 1;
  startSegment(S, i);
}

// Particle i throws what its style's trigger j names, n of them, at time F[18] (its position and velocity there
// in F[20..25]): straight into the pool, no emitter, born then.
function subEmit(S: PoolState, i: number, j: number, n: number, salt: number) {
  const c = S.recipes[S.sSub[j]!]!;
  const F = S.F;
  F[0] = F[20]! + c.ox; F[1] = F[21]! + c.oy; F[2] = F[22]! + c.oz; F[12] = 1;
  const imp = importance(S, c.priority, c);
  if (imp < 0) { S.stats.culled += n; return; }
  const lim = S.limit[imp]!;
  lodFor(S, c, imp);
  const keep = (1 / (F[11]! * F[11]!)) * 1073741824;
  const k = S.sSubInherit[j]!;
  F[3] = F[23]! * k; F[4] = F[24]! * k; F[5] = F[25]! * k;
  F[6] = c.ax; F[7] = c.az; F[8] = c.dx; F[9] = c.dy; F[10] = c.dz;
  F[17] = F[18]!;
  const base = h30((S.pseed[i]! ^ salt) | 0);
  for (let q = 0; q < n; q += 1) {
    const key = h30((base + Math.imul(q + 1, 0x9e3779b9)) | 0);
    if (draw(key, 9) >= keep) { S.stats.lod += 1; continue; }
    if (S.count >= lim) { S.stats.budget += 1; continue; }
    spawn(S, c, NO_EMITTER, key);
    S.stats.sub += 1;
  }
}

// How many a trigger throws: its count span, drawn from the particle's key.
function subCount(S: PoolState, i: number, j: number, d: number): number {
  const c0 = S.sSubC0[j]!;
  return Math.round(c0 + (S.sSubC1[j]! - c0) * draw(S.pseed[i]!, d) * INV30);
}

// Slot i's soonest event is due (at tEvent <= now): a live sub-emit, the ground, or its death.
function event(S: PoolState, i: number) {
  const F = S.F;
  const s = S.style[i]!;
  const t = S.tEvent[i]!;
  const tDeath = S.tBirth[i]! + S.life[i]!;
  F[18] = t;
  if (S.tGround[i]! === t) {
    // The ground: its first touch's sub-emit; then a bounce (a new segment), or nothing more (a stick froze
    // there already; a die's life ends there).
    sampleSlot(S, i);
    S.tGround[i] = Infinity;
    const j = s * 3 + 1;
    if ((S.flags[i]! & GROUNDED) === 0) {
      S.flags[i] = S.flags[i]! | GROUNDED;
      F[21] = 0;
      if (S.sSub[j]! >= 0 && draw(S.pseed[i]!, 13) * INV30 < S.sSubChance[j]!) { subEmit(S, i, j, subCount(S, i, j, 14), 0x96d); sampleSlot(S, i); }
    }
    if (S.sGround[s] === 1 && t < tDeath) {
      const o = i * 3;
      const vy = -F[24]! * S.sBounce[s]!;
      S.p0[o] = F[20]!; S.p0[o + 1] = 0; S.p0[o + 2] = F[22]!;
      // (Bounced out -- too slow to leave the ground again: it lies there.)
      if (vy < S.sGrav[s]! * S.F[13]! * 4) { S.v0[o] = 0; S.v0[o + 1] = 0; S.v0[o + 2] = 0; S.tStop[i] = 0; } else {
        const fr = S.sFric[s]!;
        S.v0[o] = F[23]! * fr; S.v0[o + 1] = vy; S.v0[o + 2] = F[25]! * fr;
      }
      S.stats.bounced += 1;
      F[17] = t;
      startSegment(S, i);
      return;
    }
    schedule(S, i);
    return;
  }
  if (S.tLive[i]! === t && t < tDeath) {
    // A live sub-emit, and when the next one is.
    sampleSlot(S, i);
    const j = s * 3 + 2;
    const n = S.liveN[i]! + 1;
    S.liveN[i] = n & 0xffff;
    subEmit(S, i, j, 1, 0x11fe + n);
    S.tLive[i] = t + (0.5 + draw(S.pseed[i]!, 16 + n) * INV30) / S.sSubRate[j]!;
    schedule(S, i);
    return;
  }
  // Its death, and what it throws as it dies.
  const jd = s * 3;
  if (S.sSub[jd]! >= 0 && draw(S.pseed[i]!, 11) * INV30 < S.sSubChance[jd]!) {
    F[18] = tDeath;
    sampleSlot(S, i);
    subEmit(S, i, jd, subCount(S, i, jd, 12), 0x0d1e);
  }
  freeSlot(S, i);
}

function freeEmitter(S: PoolState, e: number) {
  S.eState[e] = 0;
  S.eGen[e] = (S.eGen[e]! + 1) & 0x7fff;
  S.eSocket[e] = null;
  const at = S.activeAt[e]!;
  const last = S.active[S.activeCount - 1]!;
  S.active[at] = last;
  S.activeAt[last] = at;
  S.activeCount -= 1;
  S.free[S.freeTop] = e;
  S.freeTop += 1;
}

function startEmitter(S: PoolState, ri: number, x: number, y: number, z: number, o: ParticleEmitOptions | undefined): number {
  if (S.freeTop === 0) { S.stats.noEmitter += 1; return -1; }
  S.freeTop -= 1;
  const e = S.free[S.freeTop]!;
  const c = S.recipes[ri]!;
  S.eState[e] = 1;
  S.eRecipe[e] = ri;
  const unit = o?.unit;
  if (unit !== undefined && !S.host) throw new TypeError("Emitting on a unit needs the pool's host (createParticlePool({ host })).");
  S.eUnit[e] = unit ?? -1;
  S.eSocket[e] = o?.socket ?? null;
  // (Its frame: rotY(yaw) at the point -- written here, not by frameFromYaw: a call passing doubles allocates.)
  const f = S.eF, fo = e * 12, yaw = o?.yaw ?? 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
  f[fo] = x; f[fo + 1] = y; f[fo + 2] = z;
  f[fo + 3] = cy; f[fo + 4] = 0; f[fo + 5] = sy; f[fo + 6] = 0; f[fo + 7] = 1; f[fo + 8] = 0; f[fo + 9] = -sy; f[fo + 10] = 0; f[fo + 11] = cy;
  const e3 = e * 3;
  S.eP[e3] = x; S.eP[e3 + 1] = y; S.eP[e3 + 2] = z;
  S.ePrev[e3] = x; S.ePrev[e3 + 1] = y; S.ePrev[e3 + 2] = z;
  S.eV[e3] = 0; S.eV[e3 + 1] = 0; S.eV[e3 + 2] = 0;
  const bv = o?.velocity;
  S.eBaseV[e3] = bv?.[0] ?? 0; S.eBaseV[e3 + 1] = bv?.[1] ?? 0; S.eBaseV[e3 + 2] = bv?.[2] ?? 0;
  const d = o?.dir;
  S.eHasDir[e] = d ? 1 : 0;
  if (d) { const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1; S.eDir[e3] = d[0] / l; S.eDir[e3 + 1] = d[1] / l; S.eDir[e3 + 2] = d[2] / l; }
  S.eAge[e] = 0;
  const dur = o?.duration ?? c.duration;
  S.eDur[e] = dur === Infinity ? -1 : dur; // (-1: until stopped -- and a snapshot of it survives JSON)
  S.eAcc[e] = 0;
  S.eLodAcc[e] = 0.5;
  S.eSpawn[e] = 0;
  S.eKey[e] = h30((S.key0 + Math.imul(S.serial + 1, 0x85ebca77)) | 0);
  S.serial += 1;
  S.ePri[e] = o?.priority ?? c.priority;
  S.eScale[e] = o?.scale ?? 1;
  S.eCount[e] = o?.count ?? -1;
  S.eLive[e] = 0;
  S.eFresh[e] = 1;
  S.eFired[e] = 0;
  S.activeAt[e] = S.activeCount;
  S.active[S.activeCount] = e;
  S.activeCount += 1;
  return e;
}

function stepEmitter(S: PoolState, e: number) {
  const F = S.F, V = S.V, eF = S.eF, eP = S.eP;
  const c = S.recipes[S.eRecipe[e]!]!;
  const dt = F[13]!;
  const e3 = e * 3;
  const fo = e * 12;
  S.eAge[e] = S.eAge[e]! + dt;
  // Where it is: on its unit (the host), over the view (weather), or where it was put.
  if (S.eUnit[e]! >= 0) {
    const sc = S.scratch;
    if (!S.host!.locate(S.eUnit[e]!, S.eSocket[e]!, sc)) { S.eState[e] = 2; return; }
    for (let k = 0; k < 12; k += 1) eF[fo + k] = sc[k]!;
  } else if (c.areaView && S.hasView) {
    eF[fo] = V[4]!; eF[fo + 2] = V[5]!;
  }
  // The offset in its frame; its velocity from where it was a step ago.
  const sc = S.eScale[e]!;
  const lx = c.ox * sc, ly = c.oy * sc, lz = c.oz * sc;
  const x = eF[fo]! + eF[fo + 3]! * lx + eF[fo + 4]! * ly + eF[fo + 5]! * lz;
  const y = eF[fo + 1]! + eF[fo + 6]! * lx + eF[fo + 7]! * ly + eF[fo + 8]! * lz;
  const z = eF[fo + 2]! + eF[fo + 9]! * lx + eF[fo + 10]! * ly + eF[fo + 11]! * lz;
  const fresh = S.eFresh[e] === 1;
  const qx = fresh ? x : eP[e3]!, qy = fresh ? y : eP[e3 + 1]!, qz = fresh ? z : eP[e3 + 2]!;
  S.ePrev[e3] = qx; S.ePrev[e3 + 1] = qy; S.ePrev[e3 + 2] = qz;
  eP[e3] = x; eP[e3 + 1] = y; eP[e3 + 2] = z;
  const eV = S.eV;
  eV[e3] = (x - qx) / dt; eV[e3 + 1] = (y - qy) / dt; eV[e3 + 2] = (z - qz) / dt;
  S.eFresh[e] = 0;
  let hx = c.ax * sc, hz = c.az * sc;
  // (Weather covers the view, padded by its height: a drop high over ground just past the edge shows inside it.)
  if (c.areaView) { const pad = 2 + Math.abs(c.oy) * 1.5; hx = (S.hasView ? (V[2]! - V[0]!) / 2 : 16) + pad; hz = (S.hasView ? (V[3]! - V[1]!) / 2 : 16) + pad; }

  // How many this step.
  let n = 0;
  if (c.mode === 0) {
    if (S.eFired[e] === 0 && S.eAge[e]! >= c.delay) {
      S.eFired[e] = 1;
      n = S.eCount[e]! >= 0 ? S.eCount[e]! : Math.round(c.count0 + (c.count1 - c.count0) * draw(S.eKey[e]!, 0x7fff) * INV30);
      S.eState[e] = 2;
    }
  } else if (S.eDur[e]! >= 0 && S.eAge[e]! > S.eDur[e]!) {
    S.eState[e] = 2;
    return;
  } else {
    const per = c.mode === 1 ? (c.density > 0 ? c.density * 4 * hx * hz : c.rate) * dt : Math.sqrt((x - qx) * (x - qx) + (y - qy) * (y - qy) + (z - qz) * (z - qz)) * c.perMetre;
    const acc = S.eAcc[e]! + per;
    n = Math.floor(acc);
    S.eAcc[e] = acc - n;
  }
  if (n <= 0) return;

  F[0] = x; F[2] = z; F[12] = sc;
  const imp = importance(S, S.ePri[e]!, c);
  if (imp < 0) { S.eSpawn[e] = S.eSpawn[e]! + n; S.stats.culled += n; return; }
  const lim = S.limit[imp]!;
  lodFor(S, c, imp);
  const keep = 1 / (F[11]! * F[11]!);
  const budget = c.budget;
  const k = c.inherit;
  const eBaseV = S.eBaseV;
  F[3] = eV[e3]! * k + eBaseV[e3]!; F[4] = eV[e3 + 1]! * k + eBaseV[e3 + 1]!; F[5] = eV[e3 + 2]! * k + eBaseV[e3 + 2]!;
  F[6] = hx; F[7] = hz;
  // The cone's axis in the world: the emit's or the recipe's, turned by the frame.
  const hd = S.eHasDir[e] === 1;
  const ldx = hd ? S.eDir[e3]! : c.dx, ldy = hd ? S.eDir[e3 + 1]! : c.dy, ldz = hd ? S.eDir[e3 + 2]! : c.dz;
  F[8] = eF[fo + 3]! * ldx + eF[fo + 4]! * ldy + eF[fo + 5]! * ldz;
  F[9] = eF[fo + 6]! * ldx + eF[fo + 7]! * ldy + eF[fo + 8]! * ldz;
  F[10] = eF[fo + 9]! * ldx + eF[fo + 10]! * ldy + eF[fo + 11]! * ldz;
  // (A burst is born now; a stream's particles are born spread over the step, and along the path it moved.)
  const spread = c.mode !== 0;
  const now = F[16]!;
  const ekey = S.eKey[e]!;
  for (let j = 0; j < n; j += 1) {
    const idx = S.eSpawn[e]!;
    S.eSpawn[e] = idx + 1;
    const acc = S.eLodAcc[e]! + keep;
    if (acc < 1) { S.eLodAcc[e] = acc; S.stats.lod += 1; continue; }
    S.eLodAcc[e] = acc - 1;
    if (budget > 0 && S.eLive[e]! >= budget) { S.stats.emitterBudget += 1; continue; }
    if (S.count >= lim) { S.stats.budget += 1; continue; }
    const t = spread ? (j + 0.5) / n : 1;
    F[0] = qx + (x - qx) * t; F[1] = qy + (y - qy) * t; F[2] = qz + (z - qz) * t;
    F[17] = now - dt * (1 - t);
    spawn(S, c, e, h30((ekey + Math.imul(idx + 1, 0x9e3779b9)) | 0));
  }
}

function stepPool(S: PoolState) {
  S.tick += 1;
  const F = S.F;
  F[16] = F[16]! + F[13]!;
  const now = F[16]!;
  // The particles' events due by now, slot by slot (a slot's soonest event can come round again in one step: a
  // fast live sub-emit). Nothing else about a particle needs a visit.
  const tEvent = S.tEvent;
  for (let i = 0; i < S.highWater; i += 1) {
    while (tEvent[i]! <= now) event(S, i);
  }
  // The emitters: follow, throw, drain, free.
  for (let a = 0; a < S.activeCount;) {
    const e = S.active[a]!;
    if (S.eState[e] === 1) stepEmitter(S, e);
    if (S.eState[e] === 2 && S.eLive[e] === 0) { freeEmitter(S, e); continue; }
    a += 1;
  }
}

function setViewRect(S: PoolState, x0: number, z0: number, x1: number, z1: number, k: number) {
  const V = S.V;
  S.hasView = true;
  V[0] = Math.min(x0, x1); V[2] = Math.max(x0, x1); V[1] = Math.min(z0, z1); V[3] = Math.max(z0, z1);
  V[4] = (V[0] + V[2]) / 2; V[5] = (V[1] + V[3]) / 2;
  // ("Far": past 60% of the way from the centre to a corner.)
  const w = V[2] - V[0], d = V[3] - V[1];
  V[6] = 0.09 * (w * w + d * d);
  V[7] = k;
}

// ---------------------------------------------------------------- the pool as bytes

/** A snapshot as the codec's record: its typed arrays as plain number arrays (the codec keeps each element exact). */
export function poolRecordOf(s: ParticlePoolSnapshot): ParticlePoolRecord {
  const plain = (r: Readonly<Record<string, ArrayLike<number>>>): Record<string, number[]> => Object.fromEntries(Object.entries(r).map(([k, a]) => [k, Array.from(a)]));
  return {
    format: s.format, recipes: [...s.recipes], key: s.key, time: s.time, tick: s.tick, serial: s.serial, wind: [...s.wind],
    slots: Array.from(s.slots), particles: plain(s.particles), emitters: plain(s.emitters), sockets: [...s.sockets],
  };
}

/** Codec bytes back to a snapshot load() takes (plain arrays). Bytes that aren't a pool snapshot are a TypeError saying why. */
export function poolSnapshotOf(bytes: Uint8Array): ParticlePoolSnapshot {
  let r: ParticlePoolRecord;
  try {
    r = decode(PARTICLE_POOL, bytes);
  } catch (e) {
    throw new TypeError(`These bytes aren't a particle pool snapshot (keel/particles/pool): ${(e as Error).message}`, { cause: e });
  }
  return { ...r, format: r.format as ParticlePoolSnapshot["format"] };
}

// ---------------------------------------------------------------- the pool

// (What save() copies and load() puts back, per slot: name -> [array, floats per slot].)
const SLOT_ARRAYS = ["p0", "v0", "vinf", "tSeg", "tStop", "tBirth", "life", "tGround", "tLive", "tEvent", "style", "rnd", "lod", "pseed", "owner", "flags", "liveN"] as const;
const EMITTER_ARRAYS = [
  "eState", "eGen", "eRecipe", "eUnit", "eP", "ePrev", "eV", "eBaseV", "eF", "eDir", "eHasDir", "eAge", "eDur", "eAcc", "eLodAcc", "eSpawn", "eKey", "ePri", "eScale", "eCount",
  "eLive", "eFresh", "eFired",
] as const;
type SlotArray = Float64Array | Uint8Array | Uint16Array | Uint32Array;

export function createParticlePool(options: ParticlePoolOptions = {}): ParticlePool {
  const N = options.capacity ?? 65536;
  const E = options.emitters ?? 4096;
  if (!(N > 0 && Number.isInteger(N))) throw new RangeError("A particle pool's capacity is a positive integer.");
  if (!(E > 0 && E < NO_EMITTER && Number.isInteger(E))) throw new RangeError(`Emitters are 1..${NO_EMITTER - 1}.`);
  const S = new PoolState(N, E, options);
  if (options.recipes) defineAll(S, options.recipes);
  const resolve = (recipe: string | number): number => {
    const i = typeof recipe === "number" ? recipe : S.byName.get(recipe);
    if (i === undefined || !(i >= 0 && i < S.recipes.length)) throw new RangeError(`No particle recipe ${JSON.stringify(recipe)}.`);
    return i;
  };
  const slotOf = (handle: number): number => {
    const slot = handle & 0xffff;
    return handle >= 0 && slot < E && S.eState[slot] !== 0 && S.eGen[slot] === handle >>> 16 ? slot : -1;
  };
  const perSlot = (name: (typeof SLOT_ARRAYS)[number]): number => (name === "p0" || name === "v0" || name === "vinf" ? 3 : 1);
  const slotArray = (name: (typeof SLOT_ARRAYS)[number]) => S[name] as SlotArray;

  const pool: ParticlePool = {
    capacity: N,
    emitterCapacity: E,
    get count() { return S.count; },
    get highWater() { return S.highWater; },
    get emitters() { return S.activeCount; },
    get time() { return S.F[16]!; },
    slots: S.slots,
    styles: S.styles,
    stats: S.stats,
    wind: S.wind,
    define: (name, recipe) => defineAll(S, { [name]: recipe }),
    recipeId: (name) => S.byName.get(name) ?? -1,
    recipeNames: S.names,
    emit(recipe, x, y, z, o) {
      const ri = resolve(recipe);
      const e = startEmitter(S, ri, x, y, z, o);
      if (e < 0) return -1;
      const handle = e | (S.eGen[e]! << 16);
      // (Its companions start with it, at the same anchor, each on its own budget.)
      const also = S.recipes[ri]!.also;
      for (let i = 0; i < also.length; i += 1) startEmitter(S, also[i]!, x, y, z, o);
      return handle;
    },
    move(handle, x, y, z, yaw) {
      const e = slotOf(handle);
      if (e < 0) return;
      const fo = e * 12;
      if (yaw === undefined) { S.eF[fo] = x; S.eF[fo + 1] = y; S.eF[fo + 2] = z; } else frameFromYaw(x, y, z, yaw, S.eF, fo);
    },
    stop(handle) { const e = slotOf(handle); if (e >= 0) S.eState[e] = 2; },
    alive: (handle) => { const e = slotOf(handle); return e >= 0 && S.eState[e] === 1; },
    setView(view) {
      if (!view) { S.hasView = false; return; }
      const { center: c, axes: { right: R, up: U, forward: Fw }, pixelsPerMetre: k, width: w, height: h } = view;
      // The picture's corners on the ground (as view.groundRect, without its arrays).
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let q = 0; q < 4; q += 1) {
        const a = ((q & 1 ? w : 0) - w / 2) / k;
        const b = (h / 2 - (q & 2 ? h : 0)) / k;
        const ox = c[0] + R[0] * a + U[0] * b, oy = c[1] + R[1] * a + U[1] * b, oz = c[2] + R[2] * a + U[2] * b;
        const t = Fw[1] === 0 ? 0 : -oy / Fw[1];
        const gx = ox + Fw[0] * t, gz = oz + Fw[2] * t;
        if (gx < x0) x0 = gx;
        if (gx > x1) x1 = gx;
        if (gz < z0) z0 = gz;
        if (gz > z1) z1 = gz;
      }
      setViewRect(S, x0, z0, x1, z1, k);
    },
    setViewRect: (x0, z0, x1, z1, k) => setViewRect(S, x0, z0, x1, z1, k),
    step(dt) {
      if (!(dt > 0)) return;
      S.F[13] = dt;
      stepPool(S);
    },
    clear() {
      for (let i = 0; i < S.highWater; i += 1) if ((S.flags[i]! & ALIVE) !== 0) freeSlot(S, i);
      while (S.activeCount > 0) freeEmitter(S, S.active[S.activeCount - 1]!);
      S.eLive.fill(0);
      S.allChanged = true;
    },
    resetStats() { const g = S.stats.growths; for (const k of Object.keys(S.stats) as (keyof ParticleStats)[]) S.stats[k] = 0; S.stats.growths = g; },
    isLive: (slot) => slot >= 0 && slot < N && (S.flags[slot]! & ALIVE) !== 0,
    liveSlots(out) {
      let n = 0;
      for (let i = 0; i < S.highWater; i += 1) if ((S.flags[i]! & ALIVE) !== 0) { out[n] = i; n += 1; }
      return n;
    },
    sample(slot, out, o = 0, at = S.F[16]!) {
      S.F[18] = at;
      sampleSlot(S, slot);
      for (let k = 0; k < 6; k += 1) out[o + k] = S.F[20 + k]!;
    },
    takeChanges(out) {
      if (S.allChanged) {
        S.allChanged = false;
        for (let k = 0; k < S.changeCount; k += 1) S.changed[S.changes[k]!] = 0;
        S.changeCount = 0;
        return -1;
      }
      const n = S.changeCount;
      for (let k = 0; k < n; k += 1) { const s = S.changes[k]!; out[k] = s; S.changed[s] = 0; }
      S.changeCount = 0;
      return n;
    },
    save() {
      const idx = new Int32Array(S.count);
      let n = 0;
      for (let i = 0; i < S.highWater; i += 1) if ((S.flags[i]! & ALIVE) !== 0) { idx[n] = i; n += 1; }
      const particles: Record<string, ArrayLike<number>> = {};
      for (const name of SLOT_ARRAYS) {
        const a = slotArray(name);
        const k = perSlot(name);
        const out = new (a.constructor as Float64ArrayConstructor)(n * k);
        for (let q = 0; q < n; q += 1) for (let c = 0; c < k; c += 1) out[q * k + c] = a[idx[q]! * k + c]!;
        particles[name] = out;
      }
      const emitters: Record<string, ArrayLike<number>> = {};
      for (const name of EMITTER_ARRAYS) emitters[name] = (S[name] as SlotArray).slice();
      emitters["active"] = S.active.slice(0, S.activeCount);
      emitters["free"] = S.free.slice(0, S.freeTop);
      return {
        format: "keel-particles-pool@2", recipes: [...S.names], key: S.key0, time: S.F[16]!, tick: S.tick, serial: S.serial, wind: [...S.wind],
        slots: idx, particles, emitters, sockets: [...S.eSocket],
      };
    },
    load(s) {
      if (s.format !== "keel-particles-pool@2") throw new TypeError(`Not a particle pool snapshot (${String(s.format)}).`);
      if (s.recipes.length > S.names.length || s.recipes.some((n, i) => n !== S.names[i])) throw new RangeError("The snapshot's recipes aren't this pool's (the same names, in the same order).");
      if (s.slots.length > N) throw new RangeError(`The snapshot has ${s.slots.length} particles; this pool holds ${N}.`);
      if (s.emitters["eState"]?.length !== E) throw new RangeError(`The snapshot has ${s.emitters["eState"]?.length} emitter slots; this pool has ${E}.`);
      if (s.key !== S.key0) throw new RangeError("The snapshot is from a pool with another seed.");
      // Every slot free, then the saved ones put back where they were.
      for (let i = 0; i < N; i += 1) { S.flags[i] = 0; S.life[i] = 0; S.tEvent[i] = Infinity; S.tGround[i] = Infinity; S.tLive[i] = Infinity; }
      const n = s.slots.length;
      let hw = 0;
      for (const name of SLOT_ARRAYS) {
        const a = slotArray(name);
        const k = perSlot(name);
        const from = s.particles[name]!;
        // (JSON turns Infinity -- the time of an event that won't come -- into null.)
        for (let q = 0; q < n; q += 1) for (let c = 0; c < k; c += 1) { const v = from[q * k + c] as number | null; a[s.slots[q]! * k + c] = v ?? Infinity; }
      }
      for (let q = 0; q < n; q += 1) if (s.slots[q]! + 1 > hw) hw = s.slots[q]! + 1;
      S.count = n;
      S.highWater = hw;
      S.heapSize = 0;
      for (let i = 0; i < N; i += 1) if ((S.flags[i]! & ALIVE) === 0) { S.heap[S.heapSize] = i; S.heapSize += 1; } // (ascending: a min-heap)
      S.F[16] = s.time; S.tick = s.tick; S.serial = s.serial;
      S.wind.set(s.wind);
      for (const name of EMITTER_ARRAYS) (S[name] as SlotArray).set(s.emitters[name]!);
      for (let i = 0; i < E; i += 1) S.eSocket[i] = s.sockets[i] ?? null;
      const act = s.emitters["active"]!;
      const fr = s.emitters["free"]!;
      S.activeCount = act.length;
      for (let i = 0; i < S.activeCount; i += 1) { S.active[i] = act[i]!; S.activeAt[act[i]!] = i; }
      S.freeTop = fr.length;
      for (let i = 0; i < S.freeTop; i += 1) S.free[i] = fr[i]!;
      S.allChanged = true;
    },
    saveBytes() { return encode(PARTICLE_POOL, poolRecordOf(pool.save())); },
    loadBytes(bytes) { pool.load(poolSnapshotOf(bytes)); },
    list(sizeScale = 1) {
      const out: PoolParticleView[] = [];
      const d = S.styleData, F = S.F;
      const now = F[16]!;
      for (let i = 0; i < S.highWater; i += 1) {
        if ((S.flags[i]! & ALIVE) === 0) continue;
        const s = S.style[i]!;
        const rb = S.rnd[i]!;
        const t = Math.min(1, (now - S.tBirth[i]!) / S.life[i]!);
        const row = s * STYLE_WIDTH * 4;
        const ci = Math.min(CURVE_SAMPLES - 1, Math.round(t * (CURVE_SAMPLES - 1))) * 4;
        // (No dither on this path: a particle past its fade, by its random byte, isn't listed.)
        if (d[row + ci + 2]! * 255 < ((rb * 37 + 13) & 255)) continue;
        const o = row + CURVE_SAMPLES * 4;
        const r1 = rb / 255;
        const r2 = ((rb * 151 + 71) & 255) / 255;
        const size = (d[o]! + (d[o + 1]! - d[o]!) * r1) * d[row + ci]! * (S.lod[i]! / 16) * sizeScale;
        const light = (d[o + 2]! + (d[o + 3]! - d[o + 2]!) * r2) * d[row + ci + 1]!;
        F[18] = now;
        sampleSlot(S, i);
        out.push({ p: [F[20]!, F[21]!, F[22]!], size, ramp: S.styleRamps[s]!, light: Math.min(1, light) });
      }
      return out;
    },
  };
  return pool;
}

/** A sprite's index in the particle atlas (0: none, a plain speck). */
export const spriteIndex = (s: ParticleSprite): number => PARTICLE_SPRITES.indexOf(s);
