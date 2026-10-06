import test from "node:test";
import assert from "node:assert/strict";
import { pathPolyline } from "../src/polyline.ts";

test("map sampling preserves explicit endpoints, closure and float rounding", () => {
  const path = { x: Float64Array.from([0, 1/3, 2, 3, 4, 5, 6]), z: [0, 1, 2, 3, 4, 5, 6], length: 7 };
  assert.deepEqual(pathPolyline(path, 3), Float32Array.from([0,0,3,3,6,6,6,6]));
  assert.deepEqual(pathPolyline({ ...path, closed: true }, 3), Float32Array.from([0,0,3,3,6,6,0,0]));
  assert.deepEqual(pathPolyline(path, 1)[2], Math.fround(1/3));
  assert.deepEqual(pathPolyline({ x: [-0], z: [Infinity], length: 1 }), Float32Array.from([-0, Infinity, -0, Infinity]));
});

test("empty paths are empty and invalid strides fail without hanging", () => {
  assert.equal(pathPolyline({ x: [], z: [], length: 0 }).length, 0);
  for (const step of [0, -1, .5, NaN, Infinity]) assert.throws(() => pathPolyline({ x: [0], z: [0], length: 1 }, step), RangeError);
  assert.throws(() => pathPolyline({ x: [0], z: [], length: 1 }), RangeError);
});
