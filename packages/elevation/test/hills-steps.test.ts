import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createGrid } from "../src/grid.ts";
import { addHills, addHillsSteps } from "../src/shape.ts";

const digest = (data: Float32Array): string => createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
const grid = () => createGrid(-13, 17, 2, 19, 11, 1.25);
const options = { scale: 83, octaves: 3 } as const;

test("synchronous hills preserve the frozen pre-slicing data for both amplitude forms", () => {
  assert.equal(digest(addHills(grid(), "slice-golden", { ...options, amplitude: 7.5 }).data),
    "6d6b681edc11359cb36ed5167f6f91a4f4d271e4a3ae46a9169eb4c7744592e3");
  assert.equal(digest(addHills(grid(), "slice-golden", { ...options, amplitude: (x, z) => 3 + x * 0.02 - z * 0.03 }).data),
    "876587c6e252f1b7efde752750780c9a68a77ca4ba25f50ab4df6833200823a1");
});

test("each advance writes at most its declared number of cells in original row-major callback order", () => {
  const g = createGrid(-3, 9, 2, 7, 4, 1.25), called: [number, number][] = [];
  const steps = addHillsSteps(g, "slices", { amplitude: (x, z) => { called.push([x, z]); return 4; } }, 5);
  const progress: number[] = [];
  for (;;) {
    const before = called.length, next = steps.next();
    if (next.done) { assert.equal(next.value, g); assert.equal(called.length - before, 3); break; }
    progress.push(next.value);
    assert.equal(called.length - before, 5);
  }
  assert.deepEqual(progress, [5, 10, 15, 20, 25].map((n) => n / 28));
  assert.deepEqual(called, Array.from({ length: 28 }, (_, k) => [-3 + (k % 7) * 2, 9 + Math.floor(k / 7) * 2]));
  assert.deepEqual(g.data, addHills(createGrid(-3, 9, 2, 7, 4, 1.25), "slices", { amplitude: 4 }).data);
});

test("batch size does not change output or add a duplicate terminal progress yield", () => {
  for (const maxCells of [1, 7, 19, 209, 8192]) {
    const g = grid(), steps = addHillsSteps(g, "slice-golden", { ...options, amplitude: 7.5 }, maxCells);
    const yields: number[] = [];
    for (;;) { const r = steps.next(); if (r.done) break; yields.push(r.value); }
    assert.equal(digest(g.data), "6d6b681edc11359cb36ed5167f6f91a4f4d271e4a3ae46a9169eb4c7744592e3");
    assert.equal(yields.length, Math.floor((g.w * g.h - 1) / maxCells));
    assert.ok(yields.every((v) => v > 0 && v < 1));
  }
  assert.throws(() => addHillsSteps(grid(), "bad", { amplitude: 1 }, 0).next(), RangeError);
});
