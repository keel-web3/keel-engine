import { test } from "node:test";
import assert from "node:assert/strict";
import { lookMesh, meshBounds, worldsBounds } from "../src/mesh.ts";
import type { BakeWorld } from "../src/bake.ts";

test("capsule tolerance reduces small detail, keeps default geometry, slots and shared body coordinates", () => {
  for (const radius of [.008, .02, .07, .3]) {
    const world: BakeWorld = { capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: radius, mat: 7 }] };
    const full = lookMesh(world), bounds = meshBounds(full.positions), coarse = lookMesh(world, { bounds, chordError: .01 });
    assert.deepEqual(lookMesh(world, { chordError: 0 }), full);
    assert.ok(coarse.indices.length <= full.indices.length);
    if (radius < .1) assert.ok(coarse.indices.length < full.indices.length);
    assert.deepEqual(worldsBounds([world], { chordError: .01 }), meshBounds(coarse.positions));
    // Sample every triangle's interior against the analytic capsule, where both meshes must lie.
    const deviation = (m: typeof full) => {
      let worst = 0;
      for (let i = 0; i < m.indices.length; i += 3) for (const weights of [[1/3, 1/3, 1/3], [.5, .5, 0], [0, .5, .5]]) {
        const p = [0, 1, 2].map(a => weights.reduce((sum, w, j) => sum + w * m.positions[m.indices[i + j]! * 3 + a]!, 0));
        const distance = Math.hypot(p[0]!, p[1]! - Math.max(0, Math.min(1, p[1]!)), p[2]!);
        worst = Math.max(worst, radius - distance);
      }
      return worst;
    };
    assert.ok(deviation(coarse) <= Math.max(.01, deviation(full)) + 1e-6);
    for (let v = 0; v < coarse.positions.length / 3; v++) {
      assert.equal(coarse.attrs[v * 4], 7);
      assert.equal(coarse.attrs[v * 4 + 3], 0);
      for (let a = 0; a < 3; a++) assert.ok(Math.abs(coarse.bodies[v * 3 + a]! - (coarse.positions[v * 3 + a]! - bounds[a]!) / (bounds[a + 3]! - bounds[a]!)) < 1e-6);
    }
  }
});
