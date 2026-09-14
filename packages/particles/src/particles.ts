// Particles -- ported from the proof of concept's src/particles/particles.js
// (and src/world/particles.js, its snapshot-able twin): a pool of points in
// the world, each with a lightness and a palette ramp, drawn by the pixel
// renderer in the same palette as everything else. Emitters are small recipes
// -- a puff of dust, a spray of sparks, a splash, motes hanging in the air --
// and every one takes a seeded stream, so a scene that plays itself plays the
// same each time.
//
//   const ps = createParticles(600);
//   ps.emit("dust", at, { count: 6, S, vel });
//   ps.step(dt); renderer.render({ ..., particles: ps.list() });
//   const snap = ps.save(); ... ps.load(snap);   // plain data: the recipe by name, not the object
//
// The pool is plain data (a particle names its recipe), so a snapshot is a
// copy of it and load() puts it back; the draws, the step and list() are the
// proof of concept's, in the same order, to the bit.

import type { Stream, Vec3, Vec3Like } from "@keel-engine/core";
import { PARTICLES, decode, encode } from "@keel-engine/codec";

/** [low, high]: a value drawn evenly between them. */
export type Span = readonly [number, number];

/** How a kind of particle is thrown, moves and fades. */
export interface Recipe {
  /** Seconds it lives. */
  readonly life: Span;
  /** Sideways speed (a random heading about y), times the emit's spread. */
  readonly speed: Span;
  /** Upward speed. */
  readonly up: Span;
  /** Downward pull (units/s²); 0 hangs. */
  readonly gravity: number;
  /** How fast it slows (per second, exponential). */
  readonly drag: number;
  readonly size: Span;
  readonly light: Span;
  /** How much of its lightness it has lost by the end of its life (0..1). */
  readonly fade: number;
  /** The palette ramp it's drawn on (a name setPalette knows). */
  readonly ramp: string;
}
export type Recipes = Record<string, Recipe>;

/** One live particle: plain data (the recipe by name), what save() copies and load() takes. */
export interface ParticleState {
  kind: string;
  p: Vec3;
  v: Vec3;
  age: number;
  life: number;
  size: number;
  light: number;
  ramp: string;
}

/** What the renderer draws (@keel-engine/render's RenderParticle). */
export interface ParticleView {
  p: Vec3;
  size: number;
  ramp: string;
  light: number;
}

/** What emit draws from: a seeded float stream (core's Stream, or anything with f()). */
export type ParticleStream = Pick<Stream, "f">;

export interface EmitOptions {
  /** How many (default 4; never past the pool's max). */
  readonly count?: number | undefined;
  /** The stream to draw from (default: createParticles' `stream()`). */
  readonly S?: ParticleStream | undefined;
  /** The thrower's velocity, added to every particle's. */
  readonly vel?: Vec3Like | undefined;
  /** Scales the sideways speed. */
  readonly spread?: number | undefined;
  /** Overrides the recipe's ramp. */
  readonly ramp?: string | undefined;
}

export interface ParticlesOptions {
  /** Recipes by name (default: the engine's dust, spark, splash and mote; add a project's own). */
  readonly recipes?: Recipes | undefined;
  /** Where emit draws from when it isn't handed a stream (the world's "particles" stream). */
  readonly stream?: (() => ParticleStream) | undefined;
}

export interface Particles {
  /** Recipes by name; add to it to add a kind. */
  readonly recipes: Recipes;
  /** The pool's size (emits past it are dropped). */
  max: number;
  readonly count: number;
  /** Emit `count` of a recipe at a point, with an extra velocity (the thing that threw them). */
  emit(kind: string, at: Vec3Like, options?: EmitOptions): void;
  step(dt: number): void;
  /** What the renderer draws: each one dimming as it goes; `sizeScale` from the target rules. */
  list(sizeScale?: number): ParticleView[];
  clear(): void;
  /** The pool as plain data (copies). */
  save(): ParticleState[];
  /** Put a saved pool back (copies; every kind must be a recipe this pool knows). */
  load(list: readonly ParticleState[]): void;
  /** save() as codec bytes (keel/particles/save): the recipe by name, every number exact. */
  saveBytes(): Uint8Array;
  /** Put saveBytes() back (bytes of another kind are a TypeError saying why). */
  loadBytes(bytes: Uint8Array): void;
}

/** The engine's recipes. */
export const RECIPES: Readonly<Recipes> = Object.freeze({
  // Kicked-up dust: a few soft puffs, out and up, slowing, fading.
  dust: { life: [0.35, 0.7], speed: [0.4, 1.4], up: [0.3, 1.2], gravity: -0.4, drag: 3, size: [0.9, 1.6], light: [0.72, 0.9], fade: 0.5, ramp: "stone" },
  // Sparks off a rail: fast, streaking back, falling.
  spark: { life: [0.15, 0.4], speed: [1, 3.5], up: [0.5, 2.5], gravity: 14, drag: 0.5, size: [0.5, 0.9], light: [0.75, 1], fade: 0.7, ramp: "spark" },
  // Water thrown up by a foot on the surface.
  splash: { life: [0.3, 0.6], speed: [0.5, 2], up: [1.5, 3.5], gravity: 12, drag: 0.8, size: [0.6, 1.1], light: [0.8, 1], fade: 0.4, ramp: "water" },
  // Motes: specks hanging and drifting.
  mote: { life: [2, 4], speed: [0.05, 0.2], up: [-0.05, 0.1], gravity: 0, drag: 0.2, size: [0.5, 0.8], light: [0.6, 0.95], fade: 0.5, ramp: "stone" },
});

/** A fresh copy of the engine's recipes (to add a project's own to). */
export const baseRecipes = (): Recipes => ({ ...RECIPES });

const copy = (q: ParticleState): ParticleState => ({ ...q, p: [q.p[0], q.p[1], q.p[2]], v: [q.v[0], q.v[1], q.v[2]] });

export function createParticles(max = 600, { recipes = baseRecipes(), stream }: ParticlesOptions = {}): Particles {
  let pool: ParticleState[] = [];
  const lerp = (S: ParticleStream, [a, b]: Span): number => a + (b - a) * S.f();
  const recipe = (kind: string): Recipe => {
    const R = Object.hasOwn(recipes, kind) ? recipes[kind] : undefined;
    if (!R) throw new RangeError(`No particle recipe "${kind}" (${Object.keys(recipes).join(", ")}).`);
    return R;
  };
  const ps: Particles = {
    recipes,
    max,
    get count() { return pool.length; },
    emit(kind, at, { count = 4, S = stream?.(), vel = [0, 0, 0], spread = 1, ramp } = {}) {
      const R = recipe(kind);
      if (!S) throw new TypeError("emit needs a stream: pass { S } or createParticles(max, { stream }).");
      for (let i = 0; i < count && pool.length < ps.max; i += 1) {
        const a = S.f() * Math.PI * 2;
        const sp = lerp(S, R.speed) * spread;
        pool.push({
          kind, p: [at[0], at[1], at[2]], v: [vel[0] + Math.cos(a) * sp, vel[1] + lerp(S, R.up), vel[2] + Math.sin(a) * sp],
          age: 0, life: lerp(S, R.life), size: lerp(S, R.size), light: lerp(S, R.light), ramp: ramp ?? R.ramp,
        });
      }
    },
    step(dt) {
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        const q = pool[i]!;
        const R = recipe(q.kind);
        q.age += dt;
        if (q.age >= q.life) { pool.splice(i, 1); continue; }
        const k = Math.exp(-R.drag * dt);
        q.v[0] *= k; q.v[2] *= k;
        q.v[1] = q.v[1] * k - R.gravity * dt;
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      }
    },
    list(sizeScale = 1) {
      return pool.map((q) => ({ p: q.p, size: q.size * sizeScale, ramp: q.ramp, light: q.light * (1 - recipe(q.kind).fade * (q.age / q.life)) }));
    },
    clear() { pool = []; },
    save() { return pool.map(copy); },
    load(list) {
      for (const q of list) recipe(q.kind);
      pool = list.map(copy);
    },
    saveBytes() { return encode(PARTICLES, pool); },
    loadBytes(bytes) {
      let list: readonly ParticleState[];
      try {
        list = decode(PARTICLES, bytes) as readonly ParticleState[];
      } catch (e) {
        throw new TypeError(`These bytes aren't a particle save (keel/particles/save): ${(e as Error).message}`, { cause: e });
      }
      ps.load(list);
    },
  };
  return ps;
}
