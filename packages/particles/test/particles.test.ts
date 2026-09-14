// Particles: recipes, the pool, the step, what the renderer is handed, and
// snapshots (save/load as plain data, the recipe by name).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, stream } from "@keel-engine/core";
import { RECIPES, baseRecipes, createParticles } from "../src/particles.ts";
import type { Recipe } from "../src/particles.ts";

const S = (slot = 1) => stream(createRoll("0xabc"), slot);

test("the engine's recipes: dust, spark, splash, mote -- and a fresh copy to add to", () => {
  assert.deepEqual(Object.keys(RECIPES), ["dust", "spark", "splash", "mote"]);
  assert.ok(Object.isFrozen(RECIPES));
  const mine = baseRecipes();
  mine["ember"] = { ...RECIPES["spark"]!, ramp: "glow" };
  assert.equal(Object.hasOwn(RECIPES, "ember"), false, "the engine's table is untouched");
});

test("emit draws from the stream it's given, up to the pool's max; unknown kinds throw", () => {
  const ps = createParticles(10);
  ps.emit("dust", [0, 1, 0], { count: 6, S: S() });
  assert.equal(ps.count, 6);
  ps.emit("spark", [0, 1, 0], { count: 20, S: S(2) });
  assert.equal(ps.count, 10, "never past max");
  assert.throws(() => ps.emit("glitter", [0, 0, 0], { S: S() }), /No particle recipe "glitter"/);
  assert.throws(() => createParticles().emit("dust", [0, 0, 0]), /needs a stream/);
  const withStream = createParticles(50, { stream: () => S(3) });
  withStream.emit("mote", [1, 2, 3]);
  assert.equal(withStream.count, 4, "count defaults to 4, S to the pool's stream");
});

test("the same seed plays the same: two pools, one stream each from the same seed, step for step", () => {
  const a = createParticles(200);
  const b = createParticles(200);
  const sa = S(4);
  const sb = S(4);
  for (let f = 0; f < 120; f += 1) {
    if (f % 7 === 0) { a.emit("splash", [f * 0.1, 0, 0], { count: 5, S: sa, vel: [0, 1, 0] }); b.emit("splash", [f * 0.1, 0, 0], { count: 5, S: sb, vel: [0, 1, 0] }); }
    a.step(1 / 60); b.step(1 / 60);
    assert.deepEqual(a.list(), b.list());
  }
});

test("particles fall, slow, fade and die; list() is what the renderer draws", () => {
  const ps = createParticles();
  ps.emit("spark", [0, 5, 0], { count: 8, S: S(5), ramp: "neon" });
  const before = ps.list();
  assert.ok(before.every((q) => q.ramp === "neon" && q.light > 0 && q.size > 0));
  for (let i = 0; i < 10; i += 1) ps.step(1 / 60);
  const after = ps.list();
  assert.ok(after.every((q, i) => q.light <= before[i]!.light), "dimming as they go");
  assert.equal(ps.list(2)[0]!.size, after[0]!.size * 2, "sizeScale from the target rules");
  for (let i = 0; i < 60; i += 1) ps.step(1 / 60);
  assert.equal(ps.count, 0, "sparks live under 0.4 s");
});

test("save / load: plain data (the recipe by name), copies both ways, and the run carries on identically", () => {
  const ps = createParticles(300);
  const s = S(6);
  for (let f = 0; f < 30; f += 1) { if (f % 3 === 0) ps.emit("dust", [0, 0, f], { count: 3, S: s }); ps.step(1 / 30); }
  const snap = ps.save();
  assert.ok(snap.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, "survives JSON");
  assert.ok(snap.every((q) => q.kind === "dust" && !("R" in q)));
  // (A copy: stepping the pool doesn't touch the snapshot.)
  const frozen = JSON.stringify(snap);
  ps.step(1 / 30);
  assert.equal(JSON.stringify(snap), frozen);
  const other = createParticles(300);
  other.load(JSON.parse(frozen) as typeof snap);
  ps.load(JSON.parse(frozen) as typeof snap);
  for (let f = 0; f < 40; f += 1) { ps.step(1 / 30); other.step(1 / 30); assert.deepEqual(ps.list(), other.list()); }
  assert.throws(() => other.load([{ ...snap[0]!, kind: "confetti" }]), /No particle recipe "confetti"/);
  ps.clear();
  assert.equal(ps.count, 0);
});

test("a project's own recipes", () => {
  const ember: Recipe = { life: [1, 1], speed: [0, 0], up: [1, 1], gravity: 0, drag: 0, size: [1, 1], light: [1, 1], fade: 1, ramp: "glow" };
  const ps = createParticles(10, { recipes: { ...baseRecipes(), ember } });
  ps.emit("ember", [0, 0, 0], { count: 1, S: S(7) });
  ps.step(0.5);
  const [q] = ps.list();
  assert.ok(q);
  assert.deepEqual(q.p.map((x) => +x.toFixed(9)), [0, 0.5, 0]);
  assert.equal(q.light, 0.5);
  ps.recipes["late"] = ember;
  ps.emit("late", [0, 0, 0], { count: 1, S: S(8) });
  assert.equal(ps.count, 2, "recipes added later work");
});
