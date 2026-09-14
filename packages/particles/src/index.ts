// @keel-engine/particles: pooled, seeded particle emitters -- drawn on palette
// ramps like everything else. The proof of concept's pool (createParticles:
// src/particles, with src/world/particles.js' save and load), and the smart
// pool the engine draws with: fixed capacity, budgets and priorities, LOD,
// recipes as data, sub-emitters, sockets, and one instanced draw on the
// sprite path.

export { RECIPES, baseRecipes, createParticles } from "./particles.ts";
export type { EmitOptions, ParticleState, ParticleStream, ParticleView, Particles, ParticlesOptions, Recipe, Recipes, Span } from "./particles.ts";

export { EMIT_MODES, EMIT_SHAPES, GROUND_MODES, PARTICLE_SPRITES, defineParticleRecipe, recipeProblems, sampleCurve } from "./recipe.ts";
export type { Curve, EmitMode, EmitShape, EmitterRecipe, GroundMode, ParticleLook, ParticleSprite, SubEmit, SubTrigger, Vec3In } from "./recipe.ts";

export { CURVE_SAMPLES, MAX_STYLES, NEVER, NO_EMITTER, STYLE_WIDTH, createParticlePool, frameFromYaw, frameToWorld, mix32, motionAt, poolRecordOf, poolSnapshotOf, spriteIndex } from "./pool.ts";
export type {
  ParticleEmitOptions, ParticleHost, ParticlePool, ParticlePoolOptions, ParticlePoolSnapshot, ParticleSlots, ParticleStats, ParticleStyles, PoolParticleView,
} from "./pool.ts";

export { MOTION_GLSL, PARTICLE_FS, PARTICLE_VS, STATE_WIDTH, createParticleRenderer } from "./gpu.ts";
export type { ParticleDrawOptions, ParticleRenderer, ParticleRendererOptions } from "./gpu.ts";

export { PARTICLE_RAMPS, SPRITE_CELL, particlePalette, particleSpriteAtlas } from "./palette.ts";
export type { ParticleRampSpec } from "./palette.ts";

export { PRESETS } from "./presets/index.ts";

export { DAMAGE_EFFECTS, DAMAGE_STAGES, MAX_DAMAGE_EMITTERS, createDamageStates } from "./damage.ts";
export type { DamageEffects, DamageKind, DamageStageThresholds, DamageMaterial, DamageState, DamageStates, DamageStatesOptions, DamageStats } from "./damage.ts";
