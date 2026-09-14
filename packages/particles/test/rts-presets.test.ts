// The RTS presets: impacts per damage class, the tracer (both ways of driving it), construction, damage
// states and deaths -- each valid, palette-driven, and throwing particles on a pool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CURVE_SAMPLES, PARTICLE_RAMPS, PRESETS, STYLE_WIDTH, createParticlePool, frameFromYaw, recipeProblems } from "../src/index.ts";
import type { ParticleHost, ParticlePool } from "../src/index.ts";

const dt = 1 / 60;
const RTS = [
  "impact-kinetic", "impact-piercing", "impact-blast", "impact-energy", "impact-acid", "impact-siege", "impact-flesh", "tracer",
  "build-sparks", "build-motes", "build-glow", "warp-ring", "finish-flash",
  "smoke-light", "smoke-heavy", "fire-damage", "debris-bits", "rubble-dust", "metal-sparks", "bleed-drip", "crystal-chips", "smoke-trail",
  "death-collapse", "death-burst", "death-dissolve",
  "tracer-kinetic", "tracer-piercing", "tracer-energy", "tracer-acid", "tracer-blast", "tracer-siege", "damage-sparks",
];
const live = (pool: ParticlePool): number[] => { const out: number[] = []; pool.liveSlots(out); return out; };
const styleNames = (pool: ParticlePool) => new Set(live(pool).map((s) => pool.recipeNames[pool.slots.style[s]!]!));

test("every RTS preset is in PRESETS, valid, and wears ramps the palette has", () => {
  const names = Object.keys(PRESETS);
  for (const n of RTS) {
    assert.ok(names.includes(n), n);
    assert.deepEqual(recipeProblems(PRESETS[n]!), [], n);
  }
  for (const r of ["energy", "acid", "crystal", "metal", "spore"]) assert.ok(Object.hasOwn(PARTICLE_RAMPS, r), r);
  const pool = createParticlePool({ capacity: 1000, recipes: PRESETS });
  assert.ok(pool.styles.count < 256, `${pool.styles.count} styles, inline ones included (a pool holds 256)`);
  for (let s = 0; s < pool.styles.count; s += 1) assert.ok(Object.hasOwn(PARTICLE_RAMPS, pool.styles.ramps[s]!), `${pool.recipeNames[s]} wears "${pool.styles.ramps[s]}"`);
});

test("every RTS preset throws particles, and they stay finite", () => {
  let x = 0;
  const host: ParticleHost = { locate: (_u, _s, out) => { frameFromYaw(x, 0, 0, 0, out); return true; } };
  for (const n of RTS) {
    const pool = createParticlePool({ capacity: 4000, emitters: 64, seed: 3, recipes: PRESETS, host });
    pool.setViewRect(-20, -20, 20, 20, 24);
    x = 0;
    // (A trail needs its anchor moving; the rest sit at a point, a little up so the ground ones fall to it.)
    if (n === "smoke-trail") pool.emit(n, 0, 0, 0, { unit: 1 }); else pool.emit(n, 0, 0.5, 0, n.startsWith("tracer") ? { velocity: [20, 0, 0] } : {});
    let peak = 0;
    for (let s = 0; s < 90; s += 1) { x += 3 * dt; pool.step(dt); peak = Math.max(peak, pool.count); }
    assert.ok(pool.stats.spawned > 0 && peak > 0, `${n} spawned ${pool.stats.spawned}`);
    const o = [0, 0, 0, 0, 0, 0];
    for (const s of live(pool)) { pool.sample(s, o); assert.ok(o.every(Number.isFinite), `${n}: ${o}`); }
  }
});

test("impacts: each class has its own look -- the siege blast is the biggest, acid sticks, energy rings out", () => {
  const spawned = (n: string) => {
    const pool = createParticlePool({ capacity: 4000, seed: 5, recipes: PRESETS });
    pool.emit(n, 0, 0.5, 0);
    for (let s = 0; s < 12; s += 1) pool.step(dt);
    return { pool, n: pool.stats.spawned, styles: styleNames(pool) };
  };
  const kinetic = spawned("impact-kinetic"), siege = spawned("impact-siege"), blast = spawned("impact-blast");
  assert.ok(kinetic.n < blast.n && blast.n < siege.n, `kinetic ${kinetic.n} < blast ${blast.n} < siege ${siege.n}`);
  // Acid: its splash lies on the ground after a second.
  const acid = createParticlePool({ capacity: 2000, seed: 5, recipes: PRESETS });
  acid.emit("impact-acid", 0, 0.5, 0);
  for (let s = 0; s < 70; s += 1) acid.step(dt);
  const o = [0, 0, 0, 0, 0, 0];
  const splash = acid.recipeId("impact-acid");
  const lying = live(acid).filter((s) => acid.slots.style[s] === splash);
  assert.ok(lying.length > 0);
  for (const s of lying) { acid.sample(s, o); assert.ok(Math.abs(o[1]!) < 1e-4, "stuck on the ground"); }
  // Energy: its ring goes out level, at the ring's speed, and stops (drag).
  const energy = createParticlePool({ capacity: 2000, seed: 5, recipes: PRESETS });
  energy.emit("impact-energy", 0, 1, 0);
  energy.step(dt);
  const ring = energy.recipeId("impact-energy#also0");
  const born = live(energy).filter((s) => energy.slots.style[s] === ring);
  assert.ok(born.length >= 10);
  for (const s of born) { energy.sample(s, o); assert.ok(Math.abs(o[4]!) < 1e-9 && Math.hypot(o[3]!, o[5]!) > 1, "outward, level"); }
});

test("the tracer, both ways: a per-tick spot emit streams the shot's next stretch; a trail on a moving anchor lags behind it", () => {
  // Per tick at the projectile, with its velocity: specks born over 0.1 s at the spot, flying on at 30 m/s.
  const pool = createParticlePool({ capacity: 2000, seed: 1, recipes: PRESETS });
  pool.emit("tracer", 0, 1, 0, { velocity: [30, 0, 0] });
  const o = [0, 0, 0, 0, 0, 0];
  const xs: number[] = [];
  for (let s = 0; s < 3; s += 1) pool.step(1 / 30); // (a game's frame steps; 0.1 s in all)
  for (const s of live(pool)) { pool.sample(s, o); xs.push(o[0]!); assert.ok(Math.abs(o[3]! - 30) < 0.25, "at the shot's speed (a little scatter)"); }
  assert.ok(xs.length >= 3, `${xs.length} specks`);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1, "strung along the path, not in a heap");
  // One big frame step still throws (duration 0.1 s is the game's dt cap).
  const hitch = createParticlePool({ capacity: 2000, seed: 1, recipes: PRESETS });
  hitch.emit("tracer", 0, 1, 0, { velocity: [30, 0, 0] });
  hitch.step(0.1);
  assert.ok(hitch.stats.spawned > 0);
  // As a trail on an anchor moving at 30 m/s: specks along its path, slower than it (a tail).
  let x = 0;
  const host: ParticleHost = { locate: (_u, _s, out) => { frameFromYaw(x, 1, 0, 0, out); return true; } };
  const trail = createParticlePool({ capacity: 2000, seed: 1, recipes: PRESETS, host });
  const h = trail.emit("tracer", 0, 0, 0, { unit: 7, duration: Infinity });
  for (let s = 0; s < 60; s += 1) { x += 30 / 120; trail.step(1 / 120); }
  assert.ok(trail.alive(h), "runs until stopped");
  const behind = live(trail);
  assert.ok(behind.length > 0);
  for (const s of behind) { trail.sample(s, o); assert.ok(o[0]! <= x + 1e-6 && o[0]! > x - 3, `near the head, behind it (${o[0]} vs ${x})`); assert.ok(o[3]! < 30 && o[3]! > 10, "slower than the shot"); }
  trail.stop(h);
  for (let s = 0; s < 30; s += 1) trail.step(1 / 120);
  assert.equal(trail.count, 0);
});

test("per-class tracers: each class looks its own (ramp and size), all driven the same two ways", () => {
  const classes = ["tracer-kinetic", "tracer-piercing", "tracer-energy", "tracer-acid", "tracer-blast", "tracer-siege"];
  const looks = new Set(classes.map((n) => `${PRESETS[n]!.particle.ramp}/${PRESETS[n]!.particle.size.join("-")}`));
  assert.equal(looks.size, classes.length, "all distinct");
  assert.equal(PRESETS["tracer-kinetic"], PRESETS["tracer"]);
  let x = 0;
  const host: ParticleHost = { locate: (_u, _s, out) => { frameFromYaw(x, 1, 0, 0, out); return true; } };
  for (const n of classes) {
    const pool = createParticlePool({ capacity: 4000, seed: 2, recipes: PRESETS, host });
    pool.emit(n, 0, 1, 0, { velocity: [25, 0, 0] });
    for (let s = 0; s < 6; s += 1) pool.step(1 / 60);
    assert.ok(pool.count > 0, `${n} per tick`);
    x = 0;
    const h = pool.emit(n, 0, 0, 0, { unit: 1, duration: Infinity });
    for (let s = 0; s < 60; s += 1) { x += 25 / 60; pool.step(1 / 60); }
    assert.ok(pool.alive(h), `${n} anchored runs until stopped`);
    pool.stop(h);
    for (let s = 0; s < 150; s += 1) pool.step(1 / 60);
    assert.equal(pool.emitters, 0, `${n}: stopping its handle stops it all (no companion left running)`);
  }
});

test("soft puffs: a puff wears a soft rim by default, a recipe can set its own, and it's checked", () => {
  const pool = createParticlePool({ capacity: 100, recipes: PRESETS });
  const soft = (name: string) => pool.styles.data[(pool.recipeId(name) * STYLE_WIDTH + CURVE_SAMPLES + 2) * 4 + 2];
  assert.ok(Math.abs(soft("smoke-light")! - 0.35) < 1e-6, "its own");
  assert.equal(soft("impact-blast#also1"), 0.5, "a puff with no soft of its own: 0.5");
  assert.ok(Math.abs(soft("smoke-trail")! - 0.45) < 1e-6);
  assert.equal(soft("impact-kinetic"), 0, "a spark: hard");
  assert.deepEqual(recipeProblems({ ...PRESETS["smoke-light"]!, particle: { ...PRESETS["smoke-light"]!.particle, soft: 2 } }), ["recipe: particle.soft is within 0..1"]);
});
