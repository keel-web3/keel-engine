// Opt-in codec persistence. Snapshot save/load remain part of the runtime pool.
import { encode } from "@keel-engine/codec/runtime";
import { PARTICLE_POOL } from "@keel-engine/codec/schemas/particles";
import { poolRecordOf, poolSnapshotOf } from "./pool-codec.ts";
import type { ParticlePool, RuntimeParticlePool } from "./pool-types.ts";
export { poolRecordOf, poolSnapshotOf } from "./pool-codec.ts";

/** Extend the same pool object with exact byte persistence; live getters and slot buffers are retained. */
export function withParticlePersistence<T extends RuntimeParticlePool>(pool: T): T & ParticlePool {
  return Object.assign(pool, {
    saveBytes() { return encode(PARTICLE_POOL, poolRecordOf(pool.save())); },
    loadBytes(bytes: Uint8Array) { pool.load(poolSnapshotOf(bytes)); },
  });
}
