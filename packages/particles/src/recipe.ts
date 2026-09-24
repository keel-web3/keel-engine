// Emitter recipes: what an effect is, as data. A recipe says how an emitter
// throws (a burst, a steady rate, a trail laid per metre moved), from what
// shape (a point, a sphere, a ring, a cone, an area), and how each particle
// then lives: its life, its size and lightness and dither density along
// curves, the ramp it wears, gravity, drag, wind, what the ground does to it,
// and what it throws in turn (a spark that dies into a wisp of smoke).
//
// Sizes are metres in the world; the drawing turns them into pixels through
// the view's pixels per metre, so a recipe reads the same at any resolution.
// Particles are palette entries: lightness walks a ramp, fade is dither
// density, never a blended smear.

/** [low, high]: a value drawn evenly between them. */
export type Span = readonly [number, number];

/** A curve over a particle's life: keys evenly spaced from birth (first) to death (last), linear between. */
export type Curve = readonly number[];

/** The little baked shapes a particle can wear (dot: a round speck, the default). */
export type ParticleSprite = "dot" | "spark" | "puff" | "flame" | "drop" | "leaf";
export const PARTICLE_SPRITES: readonly ParticleSprite[] = ["dot", "spark", "puff", "flame", "drop", "leaf"];

/** What the ground (y = 0) does to a particle: nothing, bounce, stick (and lie there fading), or kill it. */
export type GroundMode = "none" | "bounce" | "stick" | "die";
export const GROUND_MODES: readonly GroundMode[] = ["none", "bounce", "stick", "die"];

/** When a sub-emit fires: as the particle dies, when it first touches the ground, or at a rate while it lives. */
export type SubTrigger = "death" | "ground" | "live";

export type Vec3In = readonly [number, number, number];

/** A particle throwing particles of its own (pooled: straight into the pool, no emitter). */
export interface SubEmit {
  readonly on: SubTrigger;
  /** The recipe thrown (its shape, speed and particle; a name in the pool, or inline). */
  readonly emit: string | EmitterRecipe;
  /** How many per trigger (death / ground; default [1, 1]). */
  readonly count?: Span;
  /** "live": how many a second. */
  readonly rate?: number;
  /** The chance a trigger throws at all (default 1). */
  readonly chance?: number;
  /** How much of the particle's velocity the thrown ones keep (default 0.3). */
  readonly inherit?: number;
}

/** How one particle lives. */
export interface ParticleLook {
  /** Seconds. */
  readonly life: Span;
  /** Diameter in metres (drawn to pixels by the view's pixels per metre; never under one pixel). */
  readonly size: Span;
  /** Size multiplier over the life (default [1]). */
  readonly sizeCurve?: Curve;
  /** Lightness along the ramp, 0 (its darkest) to 1 (its lightest). */
  readonly light: Span;
  /** Lightness multiplier over the life (default [1]). */
  readonly lightCurve?: Curve;
  /** Dither density over the life: 1 solid, 0 gone (default [1]). The fade is a screen, never a blend. */
  readonly alpha?: Curve;
  /** The palette ramp it wears (a name the renderer's palette knows). */
  readonly ramp: string;
  /** Its shape (default "dot": a speck, round once it's three pixels or more). */
  readonly sprite?: ParticleSprite;
  /** Ball shading 0..1: how much darker its lower-right is (a puff reads as a puff). */
  readonly shade?: number;
  /** Draw it stretched along its velocity: seconds of travel shown (rain, sparks). */
  readonly streak?: number;
  /**
   * A soft rim 0..1: the dither thins over this fraction of the radius toward the edge, so a round particle
   * reads as a puff rather than a hard disc (default 0; 0.5 for "puff", which is always drawn round).
   */
  readonly soft?: number;
  /** Downward pull, m/s² (default 0; negative floats up). */
  readonly gravity?: number;
  /** How fast it slows toward the air's speed, per second (exponential; default 0). */
  readonly drag?: number;
  /** How much of the wind the air carries it with (0..1, default 0). */
  readonly wind?: number;
  /** Turns its horizontal heading at this many radians a second (a swirl; default 0). */
  readonly curl?: number;
  /**
   * Curl noise: metres a divergence-free flow field carries it off its path, at most (default 0: none). Smoke,
   * embers, snow, motes -- anything the air carries -- eddy together instead of each wobbling on its own. A
   * particle that meets the ground is carried less the lower it gets, so it still lands where it lands.
   */
  readonly turbulence?: number;
  /** Curl noise: metres across one of its eddies (default 2). */
  readonly turbulenceScale?: number;
  readonly ground?: GroundMode;
  /** Bounce: how much speed it keeps off the ground (default 0.4). */
  readonly bounce?: number;
  /** Bounce: how much sideways speed it keeps (default 0.7). */
  readonly friction?: number;
  /** Metres toward the camera it draws (a muzzle flash over its own gun; default 0). */
  readonly depthBias?: number;
  /** Up to two sub-emits. */
  readonly sub?: readonly SubEmit[];
}

export type EmitMode = "burst" | "continuous" | "trail";
export type EmitShape = "point" | "sphere" | "disc" | "ring" | "cone" | "area";
export const EMIT_MODES: readonly EmitMode[] = ["burst", "continuous", "trail"];
export const EMIT_SHAPES: readonly EmitShape[] = ["point", "sphere", "disc", "ring", "cone", "area"];

/** An effect: how its emitter throws, and the particle it throws. */
export interface EmitterRecipe {
  /** burst: `count` at once (after `delay`); continuous: `rate` a second for `duration`; trail: `perMetre` along its path. */
  readonly mode: EmitMode;
  readonly count?: Span;
  readonly rate?: number;
  /** area + continuous: particles a second per square metre (the rate follows the area: weather over any view). */
  readonly density?: number;
  readonly perMetre?: number;
  /** Seconds a continuous or trail emitter runs (default Infinity: until stopped or its unit is gone). */
  readonly duration?: number;
  /** Seconds before a burst fires. */
  readonly delay?: number;
  /**
   * point: from the spot, a random heading (speed sideways, `up` upward); sphere: any direction, from within
   * `radius`; disc: a random heading, from within `radius` on the ground plane; ring: outward from a circle of
   * `radius`; cone: within `angle` of `dir`; area: from a box of half-extents `area` (or the whole view).
   */
  readonly shape: EmitShape;
  readonly radius?: number;
  /** Half-extents [x, y, z] in metres, or "view": the ground the picture shows (weather). */
  readonly area?: Vec3In | "view";
  /** Cone: the axis in the anchor's frame (default up; [0, 0, 1] is where a unit or a socket faces). */
  readonly dir?: Vec3In;
  /** Cone: half-angle in radians. */
  readonly angle?: number;
  /** Speed along the shape's direction, m/s. */
  readonly speed: Span;
  /** Extra upward speed, m/s (default [0, 0]). */
  readonly up?: Span;
  /** A velocity every particle starts with (m/s, world; rain falling). */
  readonly velocity?: Vec3In;
  /** How much of the emitter's own velocity they keep (0..1, default 0). */
  readonly inherit?: number;
  /** Where it throws from, in the anchor's frame (metres; a torch's flame above the hand). */
  readonly offset?: Vec3In;
  /** 0 ambient (weather, motes), 1 common (dust, smoke), 2 important (fire, explosions), 3 critical (reads as gameplay). */
  readonly priority?: 0 | 1 | 2 | 3;
  /** Live particles one emitter may have (default: no limit but the pool's). */
  readonly budget?: number;
  /** Metres its particles travel from it (culling pads the view by this; default 4). */
  readonly reach?: number;
  /** Other recipes started with it, at the same anchor (an explosion: flash + debris + smoke). */
  readonly also?: readonly (string | EmitterRecipe)[];
  readonly particle: ParticleLook;
}

/** A recipe as data, checked (throws on a bad one). */
export function defineParticleRecipe<R extends EmitterRecipe>(recipe: R): R {
  const problems = recipeProblems(recipe);
  if (problems.length) throw new RangeError(`Bad particle recipe: ${problems.join("; ")}`);
  return recipe;
}

const spanOk = (s: Span | undefined, min = -Infinity): boolean => s === undefined || (s.length === 2 && s.every(Number.isFinite) && s[0] <= s[1] && s[0] >= min);
const curveOk = (c: Curve | undefined, max = Infinity): boolean => c === undefined || (c.length >= 1 && c.length <= 32 && c.every((v) => Number.isFinite(v) && v >= 0 && v <= max));

/** What's wrong with a recipe (empty: nothing). Inline sub-recipes and `also` are checked too. */
export function recipeProblems(r: EmitterRecipe, path = "recipe"): string[] {
  const out: string[] = [];
  const bad = (what: string) => out.push(`${path}: ${what}`);
  if (!EMIT_MODES.includes(r.mode)) bad(`mode "${r.mode}"`);
  if (!EMIT_SHAPES.includes(r.shape)) bad(`shape "${r.shape}"`);
  if (r.mode === "burst" && !r.count) bad("a burst needs a count");
  if (r.mode === "continuous" && !(r.rate! > 0) && !(r.density! > 0)) bad("a continuous emitter needs a rate (or an area's density)");
  if (r.mode === "trail" && !(r.perMetre! > 0)) bad("a trail needs perMetre");
  if (r.density !== undefined && r.shape !== "area") bad("density is for area shapes");
  if (!spanOk(r.count, 0) || !spanOk(r.speed) || !spanOk(r.up)) bad("count / speed / up must be [low, high]");
  if (r.shape === "cone" && !(r.angle! >= 0)) bad("a cone needs an angle");
  if (r.shape === "area" && r.area === undefined) bad("an area needs its half-extents (or \"view\")");
  if (r.priority !== undefined && ![0, 1, 2, 3].includes(r.priority)) bad("priority is 0..3");
  const p = r.particle;
  if (!p) bad("no particle");
  else {
    if (!spanOk(p.life, 0) || !(p.life[1] > 0)) bad("particle.life must be positive seconds");
    if (!spanOk(p.size, 0) || !(p.size[1] > 0)) bad("particle.size must be positive metres");
    if (!spanOk(p.light, 0) || p.light[1] > 1) bad("particle.light is within 0..1");
    if (!curveOk(p.sizeCurve) || !curveOk(p.lightCurve) || !curveOk(p.alpha, 1)) bad("curves are 1..32 keys, >= 0 (alpha <= 1)");
    if (p.soft !== undefined && !(p.soft >= 0 && p.soft <= 1)) bad("particle.soft is within 0..1");
    if (p.turbulence !== undefined && !(p.turbulence >= 0 && p.turbulence < Infinity)) bad("particle.turbulence is metres, >= 0");
    if (p.turbulenceScale !== undefined && !(p.turbulenceScale > 0 && p.turbulenceScale < Infinity)) bad("particle.turbulenceScale is positive metres");
    if (typeof p.ramp !== "string" || !p.ramp) bad("particle.ramp must name a ramp");
    if (p.sprite !== undefined && !PARTICLE_SPRITES.includes(p.sprite)) bad(`sprite "${p.sprite}"`);
    if (p.ground !== undefined && !GROUND_MODES.includes(p.ground)) bad(`ground "${p.ground}"`);
    if ((p.sub?.length ?? 0) > 2) bad("at most two sub-emits");
    p.sub?.forEach((s, i) => {
      if (!["death", "ground", "live"].includes(s.on)) bad(`sub[${i}].on "${s.on}"`);
      if (s.on === "live" && !(s.rate! > 0)) bad(`sub[${i}]: "live" needs a rate`);
      if (s.on === "ground" && (p.ground ?? "none") === "none") bad(`sub[${i}]: "ground" on a particle that ignores the ground`);
      if (typeof s.emit === "object") out.push(...recipeProblems(s.emit, `${path}.sub[${i}]`));
    });
  }
  r.also?.forEach((a, i) => { if (typeof a === "object") out.push(...recipeProblems(a, `${path}.also[${i}]`)); });
  return out;
}

/** A curve at t (0..1): its keys evenly spaced, linear between. */
export function sampleCurve(c: Curve | undefined, t: number): number {
  if (!c || c.length === 0) return 1;
  if (c.length === 1) return c[0]!;
  const x = Math.min(Math.max(t, 0), 1) * (c.length - 1);
  const i = Math.min(Math.floor(x), c.length - 2);
  return c[i]! + (c[i + 1]! - c[i]!) * (x - i);
}
