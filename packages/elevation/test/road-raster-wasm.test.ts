import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoadRasterAccelerator } from "../src/road-raster-wasm.ts";
import type { HeightGrid } from "../src/grid.ts";

const grid = { x0: -10, z0: -10, cell: 1, w: 21, h: 21, data: new Float32Array(21 * 21) } satisfies HeightGrid;
const args = [grid, [-5, 5, -5], [-2, -2, -2], [2, 12, 80], 3, 0, 0, 21, 21] as const;

function records(r: NonNullable<ReturnType<ReturnType<typeof createRoadRasterAccelerator>["borrow"]>>) {
  const out: number[] = [];
  for (let p = 0; p < r.count; p += 1) {
    const at = r.local[p]!;
    out.push(r.global[p]!, r.d[at]!, r.y[at]!);
  }
  return out;
}

test("portable raster keeps exact ordered records and releases for another window", () => {
  const accelerator = createRoadRasterAccelerator();
  const first = accelerator.borrow(...args);
  assert.ok(first);
  const before = records(first);
  assert.equal(accelerator.borrow(...args), null, "nested borrow must not reuse live scratch");
  first.release();
  first.release();
  const second = accelerator.borrow(grid, [-2, 3], [0, 0], [1, 4], 7, 0, 0, 21, 21);
  assert.ok(second);
  second.release();
  const third = accelerator.borrow(...args);
  assert.ok(third);
  assert.deepEqual(records(third), before);
  third.release();
  assert.equal(accelerator.snapshot().wasmCalls, 3);
  assert.equal(accelerator.snapshot().busy, false);
});

test("unavailable module selects JS without attempting initialization", () => {
  const accelerator = createRoadRasterAccelerator(null);
  assert.equal(accelerator.borrow(...args), null);
  assert.deepEqual(accelerator.snapshot(), { available: false, disabled: false, initialized: false,
    busy: false, attempts: 0, wasmCalls: 0, failures: 0, linearBytes: 0 });
});

test("compilation, growth, kernel and count failures disable the accelerator once", () => {
  let builds = 0;
  const compilation = createRoadRasterAccelerator(() => { builds += 1; throw Error("CSP blocked WASM"); });
  assert.equal(compilation.borrow(...args), null);
  assert.equal(compilation.borrow(...args), null);
  assert.equal(builds, 1);
  assert.equal(compilation.snapshot().failures, 1);

  let grows = 0;
  const growth = createRoadRasterAccelerator(() => ({
    memory: { buffer: new ArrayBuffer(65536), grow() { grows += 1; throw Error("grow failed"); } },
    raster: () => 0,
  }));
  const bigGrid = { ...grid, w: 101, h: 101, data: new Float32Array(101 * 101) };
  assert.equal(growth.borrow(bigGrid, [-5, 5], [-2, -2], [2, 12], 3, 0, 0, 101, 101), null);
  assert.equal(growth.borrow(...args), null);
  assert.equal(grows, 1);
  assert.equal(growth.snapshot().disabled, true);

  for (const raster of [() => { throw Error("trap"); }, () => 22 * 22]) {
    const failed = createRoadRasterAccelerator(() => ({
      memory: new WebAssembly.Memory({ initial: 1 }), raster,
    }));
    assert.equal(failed.borrow(...args), null);
    assert.equal(failed.borrow(...args), null);
    assert.equal(failed.snapshot().failures, 1);
    assert.equal(failed.snapshot().busy, false);
  }
});

test("invalid and over-budget inputs leave the optional module untouched", () => {
  let builds = 0;
  const accelerator = createRoadRasterAccelerator(() => { builds += 1; throw Error("unexpected init"); });
  assert.equal(accelerator.borrow(grid, [0, NaN], [0, 0], [1, 2], 1, 0, 0, 21, 21), null);
  assert.equal(accelerator.borrow(grid, [0, 1], [0, 0], [1, 2], Infinity, 0, 0, 21, 21), null);
  assert.equal(accelerator.borrow(grid, [0, 1], [0, 0], [1, 2], 1, 0, 0, 1024, 1024), null);
  assert.equal(accelerator.borrow(grid, [-5, 5], [-2, -2], [2, 12], 3, 8, 8, 4, 4), null,
    "a caller window smaller than the all-point raster must fall back");
  assert.equal(accelerator.borrow(grid, [0, 1], [0, 0], [0, Number.MAX_VALUE / 2], 1, 0, 0, 21, 21), null);
  assert.equal(builds, 0);
});

test("bounded profile extremes, layout changes and large global indices retain f64 records", () => {
  const accelerator = createRoadRasterAccelerator();
  const profile = [Number.MAX_VALUE / 4, -Number.MAX_VALUE / 4];
  const extreme = accelerator.borrow(grid, [0, 1], [0, 0], profile, 1, 0, 0, 21, 21);
  assert.ok(extreme);
  for (let p = 0; p < extreme.count; p += 1) assert.ok(Number.isFinite(extreme.y[extreme.local[p]!]));
  extreme.release();

  const narrow = accelerator.borrow(grid, [0, 1], [0, 0], [1, 2], 1, 8, 8, 6, 5);
  assert.ok(narrow);
  const narrowRecords = records(narrow);
  narrow.release();
  const wide = accelerator.borrow(grid, [0, 1], [0, 0], [1, 2], 1, 0, 0, 21, 21);
  assert.ok(wide);
  assert.deepEqual(records(wide), narrowRecords);
  wide.release();

  const largeGrid = { ...grid, x0: 0, z0: 0, w: 1_500_000_000, h: 3 };
  const large = accelerator.borrow(largeGrid, [2, 4], [2, 2], [7, 9], 1, 1, 1, 5, 2);
  assert.ok(large);
  assert.ok(records(large).filter((_, i) => i % 3 === 0).some((k) => k > 0x7fffffff));
  large.release();
});
