import { test } from "node:test";
import assert from "node:assert/strict";
import { lookMesh } from "../src/index.ts";
import { cleanTriangles } from "../src/clean-triangles.ts";
test("cleanup preserves visible triangle order, zero-copy clean inputs, and independent animation parts", () => {
  const p = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]),
    a = new Float32Array(16),
    indices = new Uint32Array([0, 2, 3, 0, 1, 2, 1, 2, 3, 0, 0, 1]);
  assert.deepEqual(
    cleanTriangles(p, indices, a),
    new Uint32Array([0, 2, 3, 1, 2, 3]),
  );
  assert.deepEqual(
    indices,
    new Uint32Array([0, 2, 3, 0, 1, 2, 1, 2, 3, 0, 0, 1]),
  );
  a[7] = 1;
  assert.deepEqual(
    cleanTriangles(p, indices, a),
    new Uint32Array([0, 2, 3, 0, 1, 2, 1, 2, 3]),
  );
  const clean = new Uint32Array([0, 2, 3]);
  assert.equal(cleanTriangles(p, clean, a), clean);
  const empty = new Uint32Array();
  assert.equal(cleanTriangles(p, empty, a), empty);
});
test("shared cleanup covers capsule resolutions, zero radius, coincident ends, offsets and body-space bounds", () => {
  for (const around of [4, 6, 12, 17])
    for (const rings of [1, 3, 5])
      for (const radius of [0, 0.0001, 0.02, 0.43])
        for (const offset of [0, 1e6])
          for (const length of [0, 0.01, 2]) {
            const m = lookMesh(
              {
                capsules: [
                  {
                    a: [offset, 2, 0],
                    b: [offset + length, 2, 0],
                    r: radius,
                    mat: 3,
                  },
                ],
              },
              { around, rings },
            );
            const original = structuredClone(m),
              result = cleanTriangles(m.positions, m.indices, m.attrs);
            assert.equal(result.length % 3, 0);
            assert.ok(result.length <= m.indices.length);
            assert.deepEqual(m, original);
            assert.equal(cleanTriangles(m.positions, result, m.attrs), result);
          }
});
