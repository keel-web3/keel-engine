import { test } from "node:test";
import assert from "node:assert/strict";
import { createParticlePool } from "../src/pool.ts";
import { createRuntimeParticlePool, PRESETS, frameFromYaw, createDamageStates } from "../src/runtime.ts";
import { withParticlePersistence } from "../src/persistence.ts";
import type { ParticlePool, RuntimeParticlePool } from "../src/pool-types.ts";

test("runtime pool and broad pool share all seeded simulation and snapshot behavior", () => {
  const names = Object.keys(PRESETS);
  for (const seed of [0, 1, 7, 42, 0xffffffff]) {
    let clock = 0;
    const host = { locate(unit: number, socket: string | null, out: Float64Array) {
      frameFromYaw(clock + unit * 0.7, socket ? 1 : 0, unit * 0.3, clock * 0.01, out); return true;
    } };
    const options = { capacity: 2048, emitters: 128, seed, recipes: PRESETS, host };
    const broad: ParticlePool = createParticlePool(options), runtime: RuntimeParticlePool = createRuntimeParticlePool(options);
    assert.ok(!("saveBytes" in runtime) && !("loadBytes" in runtime));
    assert.deepEqual(Object.keys(runtime).sort(), Object.keys(broad).filter(k => k !== "saveBytes" && k !== "loadBytes").sort());
    for (let step = 0; step < names.length * 3; step++) {
      clock = step;
      const emit = step % 9 === 0 ? { unit: step % 4, socket: "hand.R" } : { duration: 0.3, scale: 0.5 + step % 3 };
      for (const pool of [broad, runtime]) { pool.emit(names[step % names.length]!, step % 5, 1, step % 7, emit); pool.step(1 / 120); }
      if (step % 30 === 0) { assert.deepEqual(runtime.save(), broad.save()); assert.deepEqual(runtime.list(), broad.list()); }
    }
    assert.deepEqual(runtime.save(), broad.save());
    const loaded = createRuntimeParticlePool(options); loaded.load(broad.save());
    for (let step = 0; step < 60; step++) { broad.step(1 / 120); loaded.step(1 / 120); }
    assert.deepEqual(loaded.save(), broad.save());
    assert.throws(() => createRuntimeParticlePool({ ...options, seed: seed + 1 }).load(runtime.save()), /another seed/);
  }
});

test("byte persistence is an opt-in adapter preserving object identity, live getters and exact bytes", () => {
  const options = { capacity: 1024, emitters: 32, seed: 7, recipes: PRESETS };
  const runtime = createRuntimeParticlePool(options), broad = createParticlePool(options);
  for (const pool of [runtime, broad]) { pool.emit("explosion", 0, 1, 0); pool.step(1 / 120); }
  const slots = runtime.slots, stats = runtime.stats;
  const adapted: ParticlePool = withParticlePersistence(runtime);
  assert.equal(adapted, runtime); assert.equal(adapted.slots, slots); assert.equal(adapted.stats, stats);
  assert.deepEqual(adapted.saveBytes(), broad.saveBytes());
  adapted.clear(); assert.equal(adapted.count, 0);
  adapted.loadBytes(broad.saveBytes()); assert.deepEqual(adapted.save(), broad.save());
  assert.throws(() => adapted.loadBytes(new Uint8Array([1, 2, 3])), /aren't a particle pool snapshot/);
  const damage = createDamageStates(createRuntimeParticlePool({ ...options, recipes: PRESETS }));
  damage.set(1, { x: 0, y: 0, z: 0, hp01: 0.2, material: "metal", kind: "building", size: 6 });
});
