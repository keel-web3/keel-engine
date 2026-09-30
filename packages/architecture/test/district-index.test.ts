import assert from "node:assert/strict";
import { test } from "node:test";
import { districtBlockIndex } from "../src/street/district-index.ts";

const original = (centres: readonly (readonly [number, number])[], eligible: ReadonlyMap<number, number>, x: number, z: number): number => {
  let best = 0, d2 = Infinity;
  centres.forEach(([cx, cz], i) => {
    const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
    if (d < d2 && eligible.has(i)) { d2 = d; best = i; }
  });
  return best;
};

test("nearest district block preserves filtering, first-index ties and fallback", () => {
  const centres: [number, number][] = [[-2, 0], [2, 0], [2, 0], [0, 3], [-2, 0], [NaN, 5], [Infinity, 0]];
  const eligible = new Map([[1, 9], [2, 7], [3, 5], [4, 4], [5, 3], [6, 2]]);
  const nearest = districtBlockIndex(centres, eligible);
  for (const [x, z] of [[0, 0], [2, 0], [-2, 0], [0, -9], [0, 10], [-50, -50], [Infinity, 0], [NaN, 1]] as const)
    assert.equal(nearest(x, z), original(centres, eligible, x, z), `${x},${z}`);
  assert.equal(nearest(2, 0), 1, "the first of duplicate eligible centres wins");
  assert.equal(districtBlockIndex(centres, new Map())(2, 0), 0, "no eligible block uses the original index-zero fallback");
});

test("balanced lookup matches original traversal across negative coordinates and query orders", () => {
  let state = 0x13579bdf;
  const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const centres: [number, number][] = Array.from({ length: 305 }, () => [Math.floor(random() * 2001) - 1000, Math.floor(random() * 2001) - 1000]);
  centres[78] = centres[31]!;
  const eligible = new Map<number, number>();
  for (let i = 0; i < centres.length; i += 1) if (i % 9 !== 0) eligible.set(i, i % 7);
  const nearest = districtBlockIndex(centres, eligible);
  const queries: [number, number][] = Array.from({ length: 1200 }, () => [random() * 2400 - 1200, random() * 2400 - 1200]);
  queries.push([0, 0], [centres[31]![0], centres[31]![1]], [-1200, 1200]);
  for (const [x, z] of queries) assert.equal(nearest(x, z), original(centres, eligible, x, z), `${x},${z}`);
  for (const [x, z] of [...queries].reverse()) assert.equal(nearest(x, z), original(centres, eligible, x, z), `reverse ${x},${z}`);
});

test("the 32/33 centre boundary preserves far-branch ties and finite overflow fallback", () => {
  const centres: [number, number][] = Array.from({ length: 33 }, (_, i) => [100 + i, i % 3]);
  centres[0] = [-1, 0]; centres[32] = [1, 0];
  const eligible = new Map(centres.map((_, i) => [i, i]));
  for (const count of [32, 33]) {
    const points = centres.slice(0, count), nearest = districtBlockIndex(points, eligible);
    for (const [x, z] of [[0, 0], [1e308, -1e308], [-1e308, 1e308], [0, 1e308], [130, -2]] as const)
      assert.equal(nearest(x, z), original(points, eligible, x, z), `${count} points at ${x},${z}`);
  }
  assert.equal(districtBlockIndex(centres, eligible)(0, 0), 0, "equal distances on opposite sides retain the first index");
  const farBranch: [number, number][] = [[0, 0], [2, 0], [0, 100]];
  for (let i = 0; i < 15; i += 1) farBranch.push([-100 - i, 100]);
  for (let i = 0; i < 15; i += 1) farBranch.push([100 + i, 100]);
  const allEligible = new Map(farBranch.map((_, i) => [i, i]));
  assert.equal(original(farBranch, allEligible, 1, 0), 0);
  assert.equal(districtBlockIndex(farBranch, allEligible)(1, 0), 0, "equal-distance candidate across the root far branch retains the first index");
  const nonfinite: [number, number][] = Array.from({ length: 33 }, () => [Infinity, NaN]);
  assert.equal(districtBlockIndex(nonfinite, eligible)(0, 0), 0, "no finite candidates retain the fallback");
});
