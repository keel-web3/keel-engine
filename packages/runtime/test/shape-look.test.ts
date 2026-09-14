// Shape and look: a def's choices split into what changes its geometry (the
// bake's cache key) and what's painted at draw time; pins split the same way;
// shapes can be picked on a grid so a population reuses them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceSteps, defineAttribute, lookChoiceNames, pickLook, pickShape, shapeChoiceNames, splitPins } from "../src/index.ts";
import type { Stream } from "../src/index.ts";

const S = (seed: number): Stream => {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: <T>(l: readonly T[]) => l[Math.floor(f() * l.length)]!, chance: (p) => f() < p };
};

const hat = defineAttribute({
  id: "hat", slot: "head", targets: [{ body: "body/humanoid@^1" }],
  choices: { brim: ["short", "long"], height: { range: [0.5, 1.5] }, knit: ["plain", "ribbed"] },
  look: { roles: { primary: { stuff: "knit" }, trim: { stuff: "paint", like: "primary" } }, choices: ["knit"] },
  build: () => ({}),
});

test("a def's choices in two groups: shape (default: all but the look's) and look", () => {
  assert.deepEqual(shapeChoiceNames(hat), ["brim", "height"]);
  assert.deepEqual(lookChoiceNames(hat), ["knit"]);
  const plain = defineAttribute({ id: "plain", slot: "head", targets: [{ body: "body/humanoid@^1" }], choices: { a: [1, 2] }, build: () => ({}) });
  assert.deepEqual(shapeChoiceNames(plain), ["a"], "a def without groups is all shape, as before");
  assert.deepEqual(lookChoiceNames(plain), []);
});

test("groups are checked: names must be choices, never both, and a role's `like` must be a role", () => {
  const base = { id: "x", slot: "head", targets: [{ body: "body/humanoid@^1" }], build: () => ({}) };
  assert.throws(() => defineAttribute({ ...base, choices: { a: [1] }, shape: ["b"] }), /not in its choices/);
  assert.throws(() => defineAttribute({ ...base, choices: { a: [1] }, shape: ["a"], look: { roles: {}, choices: ["a"] } }), /shape and look both/);
  assert.throws(() => defineAttribute({ ...base, look: { roles: { trim: { like: "primary" } } } }), /like "primary"/);
});

test("pins split: shape pins go to build, look pins (look choices, roles' fields, the profile) to the look", () => {
  assert.deepEqual(splitPins(hat, { brim: "long", knit: "ribbed", "primary.hue": 200, profile: "neon", team: 30 }), { shape: { brim: "long" }, look: { knit: "ribbed", "primary.hue": 200, profile: "neon", team: 30 } });
});

test("shape picks on a grid: lists as they are, ranges in steps; deterministic; pins win", () => {
  assert.deepEqual(choiceSteps({ range: [0.5, 1.5] }, 3), [0.5, 1, 1.5]);
  assert.deepEqual(choiceSteps(["a", "b"]), ["a", "b"]);
  const picks = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const p = pickShape(hat, S(i));
    assert.deepEqual(Object.keys(p).sort(), ["brim", "height"]);
    assert.ok([0.5, 1, 1.5].includes(p["height"] as number));
    picks.add(JSON.stringify(p));
    assert.deepEqual(pickShape(hat, S(i)), p);
  }
  assert.equal(picks.size, 6, "two brims x three heights: the grid, and only the grid");
  assert.equal(pickShape(hat, S(1), { pins: { brim: "short" } })["brim"], "short");
  assert.ok(["plain", "ribbed"].includes(pickLook(hat, S(3))["knit"] as string));
});
