// Damage states: stage thresholds and hysteresis, repair reversing them, deaths, a unit's trail riding the
// host, determinism, bounded emitters with 400 entities flapping, the view's culling, and no allocation in the
// steady state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "node:inspector/promises";
import { DAMAGE_STAGES, MAX_DAMAGE_EMITTERS, PRESETS, createDamageStates, createParticlePool, frameFromYaw } from "../src/index.ts";
import type { DamageMaterial, DamageState, DamageStates, ParticleHost, ParticlePool } from "../src/index.ts";

const dt = 1 / 30;
type Mut = { -readonly [K in keyof DamageState]: DamageState[K] };
interface SampleNode { callFrame: { url: string; functionName: string }; selfSize: number; children: SampleNode[] }
const live = (pool: ParticlePool): number[] => { const out: number[] = []; pool.liveSlots(out); return out; };
/** Live particles by recipe name. */
const byName = (pool: ParticlePool): Map<string, number> => {
  const m = new Map<string, number>();
  for (const s of live(pool)) { const n = pool.recipeNames[pool.slots.style[s]!]!; m.set(n, (m.get(n) ?? 0) + 1); }
  return m;
};
const has = (pool: ParticlePool, prefix: string) => [...byName(pool).keys()].some((n) => n === prefix || n.startsWith(`${prefix}#`));
const run = (pool: ParticlePool, seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += dt) { each?.(); pool.step(dt); } };
const building = (hp01: number, material: DamageMaterial = "metal", size = 6): Mut => ({ x: 0, y: 0, z: 0, hp01, material, kind: "building", size });

test("the thresholds are exported, and the pool must have the recipes", () => {
  assert.deepEqual({ ...DAMAGE_STAGES }, { light: 0.66, heavy: 0.33, band: 0.04, settle: 0.5 });
  assert.ok(Object.isFrozen(DAMAGE_STAGES));
  assert.throws(() => createDamageStates(createParticlePool({ capacity: 10, recipes: {} })), /smoke-light.*PRESETS/);
  assert.throws(() => createDamageStates(createParticlePool({ capacity: 10, recipes: PRESETS }), { stages: { light: 0.2, heavy: 0.5 } }), /heavy < light/);
});

test("building stages: worse at the threshold, better only past the band once settled; emitters by stage and size", () => {
  const pool = createParticlePool({ capacity: 20000, seed: 1, recipes: PRESETS });
  const d = createDamageStates(pool);
  const s = building(1);
  d.set(1, s);
  assert.equal(d.stageOf(1), 0);
  assert.equal(d.stageOf(2), -1, "not tracked");
  assert.equal(d.stats.emitters, 0, "clean: nothing");
  s.hp01 = 0.65; d.set(1, s);
  assert.equal(d.stageOf(1), 1);
  assert.equal(d.stats.emitters, 6, "a 6 m building, lightly hurt: three smoke threads, two shorting points, debris");
  run(pool, 1, () => d.set(1, s));
  s.hp01 = 0.68; d.set(1, s);
  assert.equal(d.stageOf(1), 1, "inside the band: no flicker back");
  s.hp01 = 0.72; d.set(1, s);
  assert.equal(d.stageOf(1), 0, "past the band: clean");
  assert.equal(d.stats.emitters, 0);
  s.hp01 = 0.2; d.set(1, s);
  assert.equal(d.stageOf(1), 2, "straight to heavy");
  assert.equal(d.stats.emitters, MAX_DAMAGE_EMITTERS, "five fires, two smoke columns, debris");
  s.hp01 = 0.9; d.set(1, s);
  assert.equal(d.stageOf(1), 2, "not settled yet: repair waits");
  run(pool, 0.6);
  s.hp01 = 0.35; d.set(1, s);
  assert.equal(d.stageOf(1), 2, "just past heavy, inside the band");
  s.hp01 = 0.4; d.set(1, s);
  assert.equal(d.stageOf(1), 1);
  assert.deepEqual([d.stats.entities, d.stats.clean, d.stats.light, d.stats.heavy], [1, 0, 1, 0]);
  // Smaller buildings, fewer points -- but never fewer than three fires.
  const small = building(0.2, "metal", 2);
  d.set(2, small);
  assert.equal(d.stats.emitters, 6 + 5, "a 2 m building on fire: three fires, one column, debris");
  // Organic buildings bleed in bursts instead of shorting and shedding debris.
  const hive = building(0.5, "organic", 4);
  d.set(3, hive);
  assert.equal(d.stats.emitters, 6 + 5 + 3, "three smoke threads");
  run(pool, 4, () => { d.set(1, s); d.set(2, small); d.set(3, hive); });
  assert.ok(d.stats.bursts > 0 && has(pool, "bleed-drip"), "the hive drips");
  assert.deepEqual([d.stats.entities, d.stats.clean, d.stats.light, d.stats.heavy], [3, 0, 2, 1]);
});

test("at a glance: a burning building's fires spread over its roof, and its smoke column climbs well above it", () => {
  const pool = createParticlePool({ capacity: 30000, seed: 8, recipes: PRESETS });
  const d = createDamageStates(pool);
  const s = building(0.2, "metal", 6);
  s.x = 10; s.z = 10;
  run(pool, 4, () => d.set(1, s));
  const fire = pool.recipeId("fire-damage"), column = pool.recipeId("smoke-heavy");
  const o = [0, 0, 0, 0, 0, 0];
  const origins = new Set<string>();
  let top = 0;
  for (const q of live(pool)) {
    if (pool.slots.style[q] === fire) origins.add(`${Math.round(pool.slots.p0[q * 3]!)},${Math.round(pool.slots.p0[q * 3 + 2]!)}`);
    if (pool.slots.style[q] === column) { pool.sample(q, o); top = Math.max(top, o[1]!); }
  }
  assert.ok(origins.size >= 4, `flames from all over the roof (${origins.size} metre cells)`);
  assert.ok(top > 3 + 4, `the column climbs over 4 m above the 3 m roof (${top.toFixed(1)} m)`);
  // Lightly damaged: sparks shorting from it, readable.
  const p2 = createParticlePool({ capacity: 30000, seed: 8, recipes: PRESETS });
  const d2 = createDamageStates(p2);
  let sparks = 0;
  run(p2, 4, () => { d2.set(1, building(0.5, "metal", 4)); sparks = Math.max(sparks, byName(p2).get("damage-sparks#sub0") ?? 0); });
  assert.ok(sparks >= 4, `a shower of sparks at a time (${sparks})`);
});

test("repair reverses: the fire goes out and light smoke takes over; full repair stops everything", () => {
  const pool = createParticlePool({ capacity: 20000, seed: 2, recipes: PRESETS });
  const d = createDamageStates(pool);
  const s = building(0.2);
  run(pool, 2, () => d.set(7, s));
  const burning = byName(pool);
  assert.ok((burning.get("fire-damage") ?? 0) > 0 && (burning.get("smoke-heavy") ?? 0) > 0, "heavy: fire and thick smoke");
  s.hp01 = 0.5;
  run(pool, 3, () => d.set(7, s));
  assert.equal(d.stageOf(7), 1);
  const after = byName(pool);
  assert.equal(after.get("fire-damage") ?? 0, 0, "the fire's out (its flames live under a second)");
  assert.ok((after.get("smoke-light") ?? 0) > 0, "light smoke now");
  s.hp01 = 1;
  run(pool, 1, () => d.set(7, s));
  assert.equal(d.stageOf(7), 0);
  assert.equal(d.stats.emitters, 0);
  run(pool, 5, () => d.set(7, s));
  assert.equal(pool.emitters, 0, "every emitter drained and freed");
  assert.equal(pool.count, 0);
});

test("destroyed: a building explodes and leaves rubble; a unit dies by its material; gone just stops", () => {
  const pool = createParticlePool({ capacity: 30000, seed: 3, recipes: PRESETS });
  const d = createDamageStates(pool);
  d.set(1, building(0.1));
  d.remove(1, "destroyed");
  assert.equal(d.stageOf(1), -1);
  assert.equal(d.stats.emitters, 0);
  run(pool, 0.2);
  for (const n of ["explosion", "rubble-dust"]) assert.ok(has(pool, n), n);
  assert.equal(has(pool, "fire-damage"), false, "its fires stopped with it");
  const deaths: [DamageMaterial, string][] = [["metal", "death-collapse"], ["organic", "death-burst"], ["crystal", "death-dissolve"], ["stone", "death-collapse"]];
  for (const [material, preset] of deaths) {
    const p = createParticlePool({ capacity: 5000, seed: 3, recipes: PRESETS });
    const u = createDamageStates(p);
    u.set(9, { x: 2, y: 0, z: 2, hp01: 0.5, material, kind: "unit", size: 0.5 });
    u.remove(9, "destroyed");
    run(p, 0.1);
    assert.ok(has(p, preset), `${material} -> ${preset}`);
    assert.equal(u.stats.deaths, 1);
  }
  const quiet = createParticlePool({ capacity: 5000, seed: 3, recipes: PRESETS });
  const q = createDamageStates(quiet);
  q.set(4, building(0.1));
  q.remove(4, "gone");
  q.remove(4, "destroyed"); // (already gone: nothing)
  run(quiet, 0.5);
  assert.equal(quiet.stats.spawned, 0, "stopped before it threw anything");
  assert.equal(q.stats.deaths, 0);
  assert.equal(q.stats.entities, 0);
});

test("a heavily damaged machine unit trails smoke that follows it through the host; bursts by material", () => {
  let ux = 0;
  const host: ParticleHost = { locate: (_u, _s, out) => { frameFromYaw(ux, 0, 5, 0, out); return true; } };
  const pool = createParticlePool({ capacity: 20000, seed: 4, recipes: PRESETS, host });
  const d = createDamageStates(pool);
  const s: Mut = { x: 0, y: 0, z: 5, hp01: 0.2, material: "metal", kind: "unit", size: 0.5, unit: 11 };
  let sparked = false;
  const trail = pool.recipeId("smoke-trail");
  const born = new Set<number>();
  let peak = 0;
  run(pool, 4, () => {
    ux += 4 * dt; s.x = ux; d.set(11, s); sparked ||= has(pool, "metal-sparks");
    const now = live(pool).filter((q) => pool.slots.style[q] === trail);
    peak = Math.max(peak, now.length);
    for (const q of now) born.add(pool.slots.p0[q * 3]!);
  });
  const xs = [...born];
  assert.ok(xs.length > 15, `${xs.length} puffs laid`);
  assert.ok(peak <= 10, `a thin trail: at most ${peak} puffs at once`);
  assert.ok(Math.min(...xs) < 2 && Math.max(...xs) > ux - 1.5, `laid along the whole path it drove (${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}, now at ${ux.toFixed(1)})`);
  assert.ok(live(pool).filter((q) => pool.slots.style[q] === trail).every((q) => Math.abs(pool.slots.p0[q * 3 + 2]! - 5) < 1 && pool.slots.p0[q * 3]! > ux - 5), "on its line, and only just behind it");
  assert.ok(d.stats.bursts >= 2 && sparked, "and it sparks");
  // No host anchor: the trail is a world point, moved to x, y, z each set().
  const p2 = createParticlePool({ capacity: 20000, seed: 4, recipes: PRESETS });
  const d2 = createDamageStates(p2);
  const s2: Mut = { x: 0, y: 0, z: 0, hp01: 0.2, material: "stone", kind: "unit", size: 0.5 };
  const born2 = new Set<number>();
  run(p2, 3, () => { s2.x += 4 * dt; d2.set(1, s2); for (const q of live(p2)) if (p2.slots.style[q] === p2.recipeId("smoke-trail")) born2.add(p2.slots.p0[q * 3]!); });
  const xs2 = [...born2];
  assert.ok(xs2.length > 10 && Math.max(...xs2) - Math.min(...xs2) > 8, "follows the moved point");
  // Organic and crystal units don't smoke: they drip and chip, faster when badly hurt.
  const p3 = createParticlePool({ capacity: 20000, seed: 4, recipes: PRESETS });
  const d3 = createDamageStates(p3);
  const light: Mut = { x: 0, y: 0, z: 0, hp01: 0.5, material: "organic", kind: "unit", size: 0.5 };
  const heavy: Mut = { x: 3, y: 0, z: 0, hp01: 0.1, material: "crystal", kind: "unit", size: 0.5 };
  let dripped = false, chipped = false;
  run(p3, 12, () => { d3.set(1, light); d3.set(2, heavy); dripped ||= has(p3, "bleed-drip"); chipped ||= has(p3, "crystal-chips"); });
  assert.equal(d3.stats.emitters, 0, "no continuous emitters on them");
  assert.ok(dripped && chipped);
  assert.ok(d3.stats.bursts >= 4 + 6 && d3.stats.bursts <= 9 + 17, `~every 1.5-3 s, twice as often heavy (${d3.stats.bursts} in 12 s)`);
});

// A 400-entity battle: buildings and units of every material, hp flapping across both thresholds.
function battle(steps: number, onStep?: (step: number, pool: ParticlePool, damage: DamageStates) => void) {
  const units = new Float64Array(400);
  const host: ParticleHost = { locate: (u, _s, out) => { frameFromYaw(units[u]!, 0, (u % 20) * 3, 0, out); return true; } };
  const pool = createParticlePool({ capacity: 40000, emitters: 8192, seed: 21, recipes: PRESETS, host });
  pool.setViewRect(-10, -10, 90, 70, 12);
  const d = createDamageStates(pool, { capacity: 512, seed: 5 });
  const mats: DamageMaterial[] = ["metal", "organic", "crystal", "stone"];
  const s: Mut = { x: 0, y: 0, z: 0, hp01: 1, material: "metal", kind: "unit", size: 0.5 };
  for (let step = 0; step < steps; step += 1) {
    for (let id = 0; id < 400; id += 1) {
      const isUnit = id >= 200;
      if (isUnit) units[id] = ((units[id]! + 0.05 + (id % 7) * 0.01) % 80);
      s.kind = isUnit ? "unit" : "building";
      s.material = mats[id % 4]!;
      s.size = isUnit ? 0.3 + (id % 5) * 0.2 : 2 + (id % 5);
      s.x = isUnit ? units[id]! : (id % 20) * 4;
      s.z = (id % 20) * 3;
      s.y = 0;
      s.hp01 = 0.5 + 0.55 * Math.sin(step * 0.05 + id * 0.7);
      if (isUnit) s.unit = id; else delete s.unit;
      d.set(id, s);
    }
    pool.step(dt);
    onStep?.(step, pool, d);
  }
  return { pool, d };
}

test("bounded: 400 entities flapping hp for 2000 ticks -- emitters held never pass 6 each, and the pool's don't grow", () => {
  let maxEarly = 0, maxLate = 0, maxHeld = 0;
  const { pool, d } = battle(2000, (step, p, dm) => {
    if (step < 1000) maxEarly = Math.max(maxEarly, p.emitters); else maxLate = Math.max(maxLate, p.emitters);
    maxHeld = Math.max(maxHeld, dm.stats.emitters);
  });
  assert.ok(maxEarly > 200, `a busy battle (${maxEarly} emitters)`);
  assert.ok(maxLate <= maxEarly * 1.2 + 50, `no growth: ${maxEarly} in the first 1000 ticks, ${maxLate} in the next`);
  assert.ok(maxHeld > 100 && maxHeld <= 400 * MAX_DAMAGE_EMITTERS, `emitters held peaked at ${maxHeld}`);
  assert.equal(pool.stats.noEmitter, 0, "the pool never ran out of emitter slots");
  assert.equal(d.stats.entities, 400);
  assert.equal(d.stats.clean + d.stats.light + d.stats.heavy, 400);
  assert.ok(d.stats.light > 0 && d.stats.heavy > 0);
  for (let id = 0; id < 400; id += 1) d.remove(id, id % 3 ? "gone" : "destroyed");
  assert.equal(d.stats.emitters, 0);
  assert.equal(d.stats.entities, 0);
  for (let s = 0; s < 300; s += 1) pool.step(dt);
  assert.equal(pool.emitters, 0, "every emitter drained and freed");
});

test("deterministic: the same battle twice gives the same pool, particle for particle", () => {
  const a = battle(300);
  const b = battle(300);
  assert.deepEqual(a.d.stats, b.d.stats);
  assert.deepEqual(a.pool.save(), b.pool.save());
  assert.ok(a.pool.count > 100);
});

test("culling: damaged things off the picture throw nothing -- the pool's culling, respected", () => {
  const pool = createParticlePool({ capacity: 20000, seed: 6, recipes: PRESETS });
  pool.setViewRect(0, 0, 40, 30, 16);
  const d = createDamageStates(pool);
  const far = building(0.1);
  far.x = 500; far.z = 500;
  const farUnit: Mut = { x: -400, y: 0, z: 10, hp01: 0.1, material: "metal", kind: "unit", size: 0.5 };
  run(pool, 3, () => { farUnit.x += 0.1; d.set(1, far); d.set(2, farUnit); });
  d.remove(1, "destroyed");
  d.remove(2, "destroyed");
  run(pool, 1);
  assert.equal(pool.stats.spawned, 0, "nothing spawned");
  assert.ok(pool.stats.culled > 0, "the pool culled them");
  // One in the picture beside them: it smokes, and nothing is born far outside the view.
  const near = building(0.1);
  near.x = 20; near.z = 15;
  d.set(3, near);
  d.set(1, far);
  run(pool, 3, () => { d.set(3, near); d.set(1, far); });
  assert.ok(pool.count > 0);
  const o = [0, 0, 0, 0, 0, 0];
  for (const q of live(pool)) { pool.sample(q, o, 0, pool.slots.tBirth[q]); assert.ok(o[0]! > -20 && o[0]! < 60 && o[2]! > -20 && o[2]! < 50, `born at ${o[0]}, ${o[2]}`); }
});

test("the steady state allocates nothing in damage.ts: 400 entities updated every tick", async () => {
  const { d } = battle(600); // (warm-up: the JIT, every path)
  const s: Mut = { x: 0, y: 0, z: 0, hp01: 0.5, material: "metal", kind: "unit", size: 0.5 };
  const tick = (step: number) => {
    for (let id = 0; id < 400; id += 1) {
      s.kind = id < 200 ? "building" : "unit";
      s.material = id % 2 ? "metal" : "stone";
      s.size = id < 200 ? 4 : 0.5;
      s.x = (id % 20) * 4 + (id >= 200 ? (step % 100) * 0.05 : 0);
      s.z = (id % 20) * 3;
      s.hp01 = 0.2 + (id % 3) * 0.3;
      if (id >= 200) s.unit = id; else delete s.unit;
      d.set(id, s);
    }
  };
  for (let k = 0; k < 400; k += 1) tick(k);
  const session = new Session();
  session.connect();
  let bytes = 0;
  let found: [string, number][] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await session.post("HeapProfiler.startSampling", { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    for (let k = 0; k < 1000; k += 1) tick(k);
    const { profile } = (await session.post("HeapProfiler.stopSampling")) as { profile: { head: SampleNode } };
    const sites = new Map<string, number>();
    const walk = (n: SampleNode) => { if (n.callFrame.url.endsWith("/particles/src/damage.ts")) sites.set(n.callFrame.functionName, (sites.get(n.callFrame.functionName) ?? 0) + n.selfSize); n.children.forEach(walk); };
    walk(profile.head);
    found = [...sites];
    bytes = found.reduce((a, [, b]) => a + b, 0);
    if (bytes === 0) break;
  }
  session.disconnect();
  assert.ok(bytes / 1000 < 64, `damage.ts allocated ${bytes} bytes (sampled) over 1000 ticks of 400 set()s: ${JSON.stringify(found)}`);
});
