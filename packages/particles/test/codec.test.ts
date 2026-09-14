// Both pools as codec bytes: a mid-run save goes to bytes and back into a
// fresh pool, which plays on identically; the bytes are smaller than the
// JSON; another document's bytes are refused, saying why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, stream } from "@keel-engine/core";
import { PARTICLES, PARTICLE_POOL, encode, readHeader, shortId } from "@keel-engine/codec";
import { PRESETS, createParticlePool, createParticles, frameFromYaw, poolRecordOf } from "../src/index.ts";
import type { ParticleHost, ParticlePool } from "../src/index.ts";

const dt = 1 / 120;
const steps = (pool: ParticlePool, n: number, each?: (s: number) => void) => { for (let s = 0; s < n; s += 1) { each?.(s); pool.step(dt); } };
const live = (pool: ParticlePool): number[] => { const out: number[] = []; pool.liveSlots(out); return out; };
/** Where each live particle is now, its velocity, style, random byte and scale (as the save / load test compares). */
const rows = (pool: ParticlePool) => {
  const o = [0, 0, 0, 0, 0, 0];
  return live(pool).map((s) => { pool.sample(s, o); return [...o, pool.slots.style[s], pool.slots.rnd[s], pool.slots.lod[s]].join(","); }).sort();
};

test("the pool as bytes: a mid-run snapshot, loaded into a fresh pool, plays on identically; smaller than its JSON; Infinity kept", () => {
  let x = 0;
  const host: ParticleHost = { locate: (u, _s, out) => { frameFromYaw(u * 2 + x, 0, u, u * 0.1, out); return true; } };
  const make = () => createParticlePool({ capacity: 20000, emitters: 256, seed: 11, recipes: PRESETS, host });
  const a = make();
  for (let u = 0; u < 30; u += 1) a.emit("footstep-dust", 0, 0, 0, { unit: u });
  const script = (p: ParticlePool, s: number) => { if (s % 25 === 0) p.emit(s % 50 ? "explosion" : "spark-shower", s % 17, 0, s % 13, { duration: 1 }); };
  steps(a, 150, (s) => { x = s * 0.02; script(a, s); });
  const bytes = a.saveBytes();
  assert.equal(readHeader(bytes).id, shortId(PARTICLE_POOL), "a keel/particles/pool document");
  const json = JSON.stringify(a.save(), (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as Float64Array) : v));
  assert.ok(bytes.length < json.length, `${bytes.length} bytes vs ${json.length} of JSON`);
  // (Infinity -- an event that won't come -- is in there, and JSON would have made it null.)
  assert.ok(Object.values(poolRecordOf(a.save()).particles).some((arr) => arr.includes(Infinity)));

  const b = make();
  b.loadBytes(bytes);
  assert.equal(b.count, a.count);
  assert.equal(b.highWater, a.highWater);
  assert.deepEqual(rows(b), rows(a));
  assert.deepEqual(poolRecordOf(b.save()), poolRecordOf(a.save()), "the same snapshot, every number");
  const x0 = x;
  steps(a, 200, (s) => { x = x0 + s * 0.02; script(a, s + 150); });
  steps(b, 200, (s) => { x = x0 + s * 0.02; script(b, s + 150); });
  assert.deepEqual(rows(b), rows(a), "the same particles 200 steps on");
  assert.deepEqual(live(b), live(a), "in the same slots");
  assert.equal(b.emitters, a.emitters);
  assert.deepEqual(b.saveBytes(), a.saveBytes(), "and the same bytes");
  // (The pool's own checks still apply: another seed's pool refuses it.)
  assert.throws(() => createParticlePool({ capacity: 20000, emitters: 256, seed: 12, recipes: PRESETS }).loadBytes(bytes), /another seed/);
});

test("the pool refuses bytes that aren't a pool snapshot, saying so", () => {
  const pool = createParticlePool({ capacity: 100, emitters: 8, seed: 1, recipes: PRESETS });
  const other = encode(PARTICLES, []);
  assert.throws(() => pool.loadBytes(other), (e: unknown) => e instanceof TypeError && /aren't a particle pool snapshot \(keel\/particles\/pool\)/.test(e.message) && e.message.includes(shortId(PARTICLES)));
  assert.throws(() => pool.loadBytes(new Uint8Array([1, 2, 3])), /aren't a particle pool snapshot/);
  assert.throws(() => pool.loadBytes(pool.saveBytes().subarray(0, 12)), /aren't a particle pool snapshot/);
});

test("the ported pool as bytes: loaded into another, it runs on identically; smaller than its JSON; other bytes refused", () => {
  const S = stream(createRoll("0xfeed"), 6);
  const ps = createParticles(300);
  for (let f = 0; f < 30; f += 1) { if (f % 3 === 0) ps.emit(f % 2 ? "dust" : "spark", [0, 0, f], { count: 3, S }); ps.step(1 / 30); }
  const bytes = ps.saveBytes();
  assert.ok(ps.count > 0);
  assert.ok(bytes.length < JSON.stringify(ps.save()).length, `${bytes.length} bytes vs ${JSON.stringify(ps.save()).length} of JSON`);
  const other = createParticles(300);
  other.loadBytes(bytes);
  assert.deepEqual(other.save(), ps.save());
  for (let f = 0; f < 40; f += 1) { ps.step(1 / 30); other.step(1 / 30); assert.deepEqual(other.list(), ps.list()); }
  assert.throws(() => other.loadBytes(encode(PARTICLE_POOL, poolRecordOf(createParticlePool({ capacity: 8, emitters: 2, seed: 1 }).save()))), /aren't a particle save \(keel\/particles\/save\)/);
});
