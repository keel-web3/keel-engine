// Backward-compatible pool entry: simulation plus exact byte persistence.
import { createRuntimeParticlePool } from "./pool-runtime.ts";
import { withParticlePersistence } from "./persistence.ts";
import type { ParticlePool, ParticlePoolOptions } from "./pool-types.ts";
export * from "./pool-runtime.ts";
export { poolRecordOf, poolSnapshotOf } from "./pool-codec.ts";
export { withParticlePersistence } from "./persistence.ts";
export type { ParticlePool } from "./pool-types.ts";

export function createParticlePool(options: ParticlePoolOptions = {}): ParticlePool {
  return withParticlePersistence(createRuntimeParticlePool(options));
}
