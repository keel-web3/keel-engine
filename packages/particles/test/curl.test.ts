// Curl noise: the field is divergence-free (it swirls, never bunches or spreads), bounded, flows in time without
// a seam at its period; and a recipe's turbulence carries its particles off their closed-form path -- not at
// birth, not on the ground -- where a recipe without it stays on the path to the bit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOW_PERIOD, curlNoise } from "@keel-engine/core";
import { createParticlePool, defineParticleRecipe, motionAt, recipeProblems } from "../src/index.ts";
import type { EmitterRecipe } from "../src/index.ts";

const at = (x: number, y: number, z: number, t = 0) => { const o = [0, 0, 0]; curlNoise(x, y, z, t, o); return o; };

test("the curl field is divergence-free, bounded and not zero", () => {
  const e = 1e-4;
  let big = 0, worst = 0;
  for (let k = 0; k < 400; k += 1) {
    const x = Math.sin(k * 12.9898) * 50, y = Math.sin(k * 78.233) * 50, z = Math.sin(k * 37.719) * 50, t = k * 3.7;
    const v = at(x, y, z, t);
    big = Math.max(big, Math.hypot(v[0]!, v[1]!, v[2]!));
    for (const c of v) assert.ok(Math.abs(c) < 3, `component ${c} at ${k}`);
    const div = (at(x + e, y, z, t)[0]! - at(x - e, y, z, t)[0]! + at(x, y + e, z, t)[1]! - at(x, y - e, z, t)[1]! + at(x, y, z + e, t)[2]! - at(x, y, z - e, t)[2]!) / (2 * e);
    // (Against the field's own rate of change: its derivatives run to a few units.)
    worst = Math.max(worst, Math.abs(div));
  }
  assert.ok(worst < 1e-3, `divergence up to ${worst}`);
  assert.ok(big > 0.3, `the field is too weak (${big})`);
});

test("the field flows with time and comes round at its period", () => {
  const a = at(1.3, 2.1, -0.7, 10), b = at(1.3, 2.1, -0.7, 10 + FLOW_PERIOD), c = at(1.3, 2.1, -0.7, 12);
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(a[k]! - b[k]!) < 1e-6);
  assert.ok(Math.hypot(a[0]! - c[0]!, a[1]! - c[1]!, a[2]! - c[2]!) > 1e-3, "two seconds on, the field hasn't moved");
});

const drift = (turbulence?: number, ground?: "stick"): EmitterRecipe => defineParticleRecipe({
  mode: "burst", count: [40, 40], shape: "sphere", speed: [0.5, 1], up: [0.2, 0.4], priority: 3,
  particle: { life: [4, 4], size: [0.2, 0.2], light: [0.5, 0.5], ramp: "smoke", drag: 0.8, gravity: ground ? 2 : -0.3, ...(turbulence ? { turbulence } : {}), ...(ground ? { ground } : {}) },
});

test("turbulence carries particles off their path; without it they stay on it to the bit", () => {
  for (const [name, turb] of [["calm", undefined], ["eddy", 0.8]] as const) {
    const pool = createParticlePool({ capacity: 200, seed: 3, recipes: { r: drift(turb) } });
    pool.emit("r", 0, 3, 0);
    for (let s = 0; s < 240; s += 1) pool.step(1 / 120);
    const S = pool.slots, o = [0, 0, 0, 0, 0, 0], m = [0, 0, 0, 0, 0, 0];
    const slots: number[] = [];
    pool.liveSlots(slots);
    assert.equal(slots.length, 40);
    let off = 0;
    for (const i of slots) {
      pool.sample(i, o);
      const q = i * 3;
      motionAt([S.p0[q]!, S.p0[q + 1]!, S.p0[q + 2]!], [S.v0[q]!, S.v0[q + 1]!, S.v0[q + 2]!], [S.vinf[q]!, S.vinf[q + 1]!, S.vinf[q + 2]!], 0.8, 0, -0.3, pool.time - S.tSeg[i]!, S.tStop[i]!, m);
      off = Math.max(off, Math.hypot(o[0]! - m[0]!, o[1]! - m[1]!, o[2]! - m[2]!));
      // (At birth, nowhere off it.)
      pool.sample(i, o, 0, S.tBirth[i]!);
      motionAt([S.p0[q]!, S.p0[q + 1]!, S.p0[q + 2]!], [S.v0[q]!, S.v0[q + 1]!, S.v0[q + 2]!], [S.vinf[q]!, S.vinf[q + 1]!, S.vinf[q + 2]!], 0.8, 0, -0.3, S.tBirth[i]! - S.tSeg[i]!, S.tStop[i]!, m);
      assert.ok(Math.hypot(o[0]! - m[0]!, o[1]! - m[1]!, o[2]! - m[2]!) < 1e-9);
    }
    if (name === "calm") assert.equal(off, 0);
    else { assert.ok(off > 0.05, `turbulence moved nothing (${off})`); assert.ok(off < 0.8 * 3, `further than turbulence allows (${off})`); }
    // The renderer's table carries it: texel 35's w (drag, curl, gravity, turbulence).
    assert.equal(pool.styles.data[35 * 4 + 3], Math.fround(turb ?? 0));
  }
});

test("a particle that meets the ground isn't carried on the ground, and a bad turbulence is refused", () => {
  const pool = createParticlePool({ capacity: 200, seed: 5, recipes: { r: drift(1, "stick") } });
  pool.emit("r", 0, 0.5, 0);
  for (let s = 0; s < 360; s += 1) pool.step(1 / 120);
  const S = pool.slots, o = [0, 0, 0, 0, 0, 0], m = [0, 0, 0, 0, 0, 0];
  const slots: number[] = [];
  pool.liveSlots(slots);
  let landed = 0;
  for (const i of slots) {
    if (S.tStop[i]! >= 1e8) continue;
    // (Landed: exactly where its closed-form path put it down -- the flow doesn't carry it along the ground.)
    pool.sample(i, o);
    const q = i * 3;
    motionAt([S.p0[q]!, S.p0[q + 1]!, S.p0[q + 2]!], [S.v0[q]!, S.v0[q + 1]!, S.v0[q + 2]!], [S.vinf[q]!, S.vinf[q + 1]!, S.vinf[q + 2]!], 0.8, 0, 2, pool.time - S.tSeg[i]!, S.tStop[i]!, m);
    assert.deepEqual(o.slice(0, 3), m.slice(0, 3));
    landed += 1;
  }
  assert.ok(landed > 0, "nothing landed");
  assert.ok(pool.styles.data[35 * 4 + 3]! < 0, "a grounded recipe's turbulence fades toward the ground");
  const base = drift();
  assert.equal(recipeProblems({ ...base, particle: { ...base.particle, turbulence: -1 } }).length, 1);
  assert.equal(recipeProblems({ ...base, particle: { ...base.particle, turbulenceScale: 0 } }).length, 1);
});
