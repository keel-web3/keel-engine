import { test } from "node:test";
import assert from "node:assert/strict";
import { lookMesh, meshBounds, worldsBounds } from "../src/mesh.ts";
import type { BakeWorld } from "../src/bake.ts";

test("bounds-only generation exactly matches Float32 mesh bounds at every tessellation", () => {
  for (const around of [4, 6, 12, 17]) for (const rings of [1, 3, 5]) for (const yaw of [0, .71, -2.3]) {
    const worlds: BakeWorld[] = [
      { boxes: [{ c: [2, 1, -3], h: [1, 4, 2], yaw, grid: [3, 3.5] }], wedges: [{ c: [-3, .1, 2], h: [.8, 1, 3], lo: .2, yaw }] },
      { capsules: [{ a: [-1, 2, 3], b: [4, 1, -2], r: .43 }, { a: [2, 2, 2], b: [2, 2, 2], r: .7 }] },
    ];
    const reference = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const w of worlds) {
      const b = meshBounds(lookMesh(w, { around, rings }).positions);
      for (let a = 0; a < 3; a++) { reference[a] = Math.min(reference[a]!, b[a]!); reference[a + 3] = Math.max(reference[a + 3]!, b[a + 3]!); }
    }
    assert.deepEqual(worldsBounds(worlds, { around, rings }), reference);
  }
  assert.deepEqual(worldsBounds([]), [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
});
