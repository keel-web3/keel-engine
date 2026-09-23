import { PARTICLE_POOL, decode } from "@keel-engine/codec";
import type { ParticlePoolRecord } from "@keel-engine/codec";
import type { ParticlePoolSnapshot } from "./pool-types.ts";

// ---------------------------------------------------------------- the pool as bytes

/** A snapshot as the codec's record: its typed arrays as plain number arrays (the codec keeps each element exact). */
function poolRecordOf(s: ParticlePoolSnapshot): ParticlePoolRecord {
  const plain = (r: Readonly<Record<string, ArrayLike<number>>>): Record<string, number[]> => Object.fromEntries(Object.entries(r).map(([k, a]) => [k, Array.from(a)]));
  return {
    format: s.format, recipes: [...s.recipes], key: s.key, time: s.time, tick: s.tick, serial: s.serial, wind: [...s.wind],
    slots: Array.from(s.slots), particles: plain(s.particles), emitters: plain(s.emitters), sockets: [...s.sockets],
  };
}

/** Codec bytes back to a snapshot load() takes (plain arrays). Bytes that aren't a pool snapshot are a TypeError saying why. */
function poolSnapshotOf(bytes: Uint8Array): ParticlePoolSnapshot {
  let r: ParticlePoolRecord;
  try {
    r = decode(PARTICLE_POOL, bytes);
  } catch (e) {
    throw new TypeError(`These bytes aren't a particle pool snapshot (keel/particles/pool): ${(e as Error).message}`, { cause: e });
  }
  return { ...r, format: r.format as ParticlePoolSnapshot["format"] };
}



export { poolRecordOf, poolSnapshotOf };
