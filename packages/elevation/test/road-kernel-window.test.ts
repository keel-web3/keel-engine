import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createGrid } from "../src/grid.ts";
import { gradeCorridor, lockGrid } from "../src/shape.ts";
import type { HeightGrid } from "../src/grid.ts";

const seed = (g: HeightGrid): void => {
  for (let j = 0; j < g.h; j += 1) for (let i = 0; i < g.w; i += 1)
    g.data[j * g.w + i] = Math.sin(i * 0.17) * 3 + Math.cos(j * 0.23) * 2 + (i - j) * 0.013;
};
const digest = (...data: (Float32Array | Float64Array | Uint8Array)[]): string => {
  const h = createHash("sha256");
  for (const a of data) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  return h.digest("hex");
};

test("alternating grids reuse scratch without changing overlaps, first ties, locks or profiles", () => {
  const a = createGrid(-40, -40, 1, 81, 81), b = createGrid(-82, -67, 1, 65, 73);
  seed(a); seed(b);
  const la = lockGrid(a), lb = lockGrid(b);
  const p1 = gradeCorridor(a, [-30, 30, -30, 30], [-14, -14, 14, 14], { half: 3, blend: 5, maxGrade: 0.09, ends: [2, -1], lock: la });
  const p2 = gradeCorridor(b, [-78, -24, -78], [-55, -55, -19], { half: 2, blend: 6, maxGrade: 0.12, lock: lb });
  const p3 = gradeCorridor(a, [0, 0, 0], [-35, 35, -35], { half: 4, blend: 7, maxGrade: 0.07, lock: la });
  const p4 = gradeCorridor(b, [-75, -25, -75, -25], [-39, -39, -39, -39], { half: 3, blend: 4, maxGrade: 0.1, ends: [3, 3], lock: lb });
  assert.equal(digest(a.data, la, b.data, lb, p1.s, p1.y, p2.s, p2.y, p3.s, p3.y, p4.s, p4.y), "382474f30006a54a6d88b7a0291f54cbd64d03607354c233286934ab8efb2174");
});

test("a corridor window above the scratch cap retains the original Map result", () => {
  const g = createGrid(-300, -300, 1, 601, 601); seed(g);
  const lock = lockGrid(g);
  for (let k = -3; k <= 3; k += 1) { const at = (300 + k) * g.w + 300; lock[at] = 1; g.data[at] = 8 + k * 0.1; }
  const p = gradeCorridor(g, [-290, 290], [-290, 290], { half: 2, blend: 2, maxGrade: 0.08, ends: [1, 5], lock });
  assert.equal(digest(g.data, lock, p.s, p.y), "bf2d7b740e3238011f11faef7b98e0b30cde45bd995a84193c78d6b0eefb6163");
});

test("nonfinite reach takes the Map path and retains signed-zero grid bytes", () => {
  const g = createGrid(-3, -3, 1, 7, 7);
  g.data.fill(-0);
  assert.ok(Object.is(g.data[0], -0));
  const p = gradeCorridor(g, [-0, 0, 2], [-0, 0, 0], { half: NaN, blend: 2, maxGrade: 0.1 });
  assert.ok(Object.is(g.data[0], -0));
  assert.equal(digest(g.data, p.s, p.y), "ef50ae13bfbd085d047178d54b6ed3f43e594d1a728a076b318a8705db551bc4");
});
