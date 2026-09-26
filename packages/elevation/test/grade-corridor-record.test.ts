import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createGrid, gradeCorridor, lockGrid } from "../src/index.ts";
import type { HeightGrid } from "../src/index.ts";

const ground = (): HeightGrid => {
  const g = createGrid(-24, -24, 1, 49, 49);
  for (let j = 0; j < g.h; j += 1) for (let i = 0; i < g.w; i += 1)
    g.data[j * g.w + i] = Math.sin(i * 0.37) * 4 + Math.cos(j * 0.29) * 3 + (i - j) * 0.07;
  return g;
};

/** SHA-256 over the exact original grid, optional lock, and returned profile bytes, in that order. */
const digest = (g: HeightGrid, lock: Uint8Array | null, s: Float64Array, y: Float64Array): string => {
  const hash = createHash("sha256");
  for (const data of [g.data, lock, s, y]) if (data) hash.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return hash.digest("hex");
};

test("revisited corridor cells retain exact original nearest-segment geometry and pinned ends", () => {
  const g = ground();
  const { s, y } = gradeCorridor(g, [-18, 18, -18, 18], [-9, -9, 9, 9],
    { half: 3, blend: 5, maxGrade: 0.09, ends: [4, -3], endFlat: [2, 2] });
  assert.equal(s.length, 114);
  assert.equal(y[0], 4);
  assert.equal(y[y.length - 1], -3);
  assert.equal(digest(g, null, s, y), "39e9c4f8ee363f2716f220e538800de4f4d2befd994155b8dc99e71b82be1139");
});

test("exact retrace keeps the first equal-distance segment", () => {
  const g = ground();
  const { s, y } = gradeCorridor(g, [-17, 17, -17, 17], [0, 0, 0, 0],
    { half: 2, blend: 4, maxGrade: 0.12, ends: [1, 1] });
  assert.equal(s.length, 103);
  assert.equal(digest(g, null, s, y), "3bc45d4b00868ebe8679e59b723b4c1f3e0810e91fcd2cd6f0e937c23754a4d8");
});

test("overlapping corridor preserves old locks and adds its own flat cells", () => {
  const g = ground(), lock = lockGrid(g);
  for (let i = 15; i <= 33; i += 1) { const k = 24 * g.w + i; lock[k] = 1; g.data[k] = 5 + (i - 24) * 0.05; }
  const protectedHeights = g.data.slice(24 * g.w + 15, 24 * g.w + 34);
  const { s, y } = gradeCorridor(g, [-20, 20, -20], [-15, 15, 20],
    { half: 3, blend: 5, maxGrade: 0.08, ends: [2, 7], endFlat: [1, 1], lock });
  assert.deepEqual(g.data.slice(24 * g.w + 15, 24 * g.w + 34), protectedHeights);
  assert.equal(lock.reduce((sum, value) => sum + value, 0), 572);
  assert.equal(s.length, 92);
  assert.equal(digest(g, lock, s, y), "ed0bb9e9e789fc9489d47849addb4376fb66048008146098acc89b47599500bc");
});
