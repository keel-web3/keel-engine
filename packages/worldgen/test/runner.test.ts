// keel/worldgen's runner layout: the same seed makes the same run; its legs
// join corner to corner and never touch another (a margin of wall between);
// every leg's cells are open; halls widen where they say; forks leave a stub;
// and the result dresses and builds like any other dungeon.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CELL, buildDungeonScene, dressDungeon, generateRunner } from "../src/index.ts";

const STEP = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

test("the same seed, the same run; another seed, another", () => {
  const a = generateRunner("run-1", { legs: 12 });
  assert.deepEqual(generateRunner("run-1", { legs: 12 }).legs, a.legs);
  assert.deepEqual([...generateRunner("run-1", { legs: 12 }).dungeon.cells], [...a.dungeon.cells]);
  assert.notDeepEqual(generateRunner("run-2", { legs: 12 }).legs, a.legs);
});

test("legs are open end to end, turn at their corners, and the route is long", () => {
  for (let n = 0; n < 60; n += 1) {
    const r = generateRunner(`seed-${n}`, { legs: 12, length: [12, 20], halls: 0.5, hallReach: 5 });
    const D = r.dungeon;
    assert.ok(r.legs.length >= 6, `seed ${n}: only ${r.legs.length} legs`);
    for (const [k, L] of r.legs.entries()) {
      const [dx, dz] = STEP[L.heading]!;
      for (let t = 0; t <= L.length; t += 1) {
        const i = L.from[0] + dx * t, j = L.from[1] + dz * t;
        assert.notEqual(D.cells[j * D.w + i], CELL.WALL, `seed ${n} leg ${k}: a wall at step ${t}`);
      }
      if (k < r.legs.length - 1 && L.turn !== "split") assert.notEqual(r.legs[k + 1]!.heading, L.heading, "a corner turns");
      if (L.hall >= 0) assert.ok(L.hallSpan[1] > L.hallSpan[0] && L.hallReach > 0);
    }
    assert.equal(r.legs[r.legs.length - 1]!.turn, "end");
  }
});

test("the route never comes back near itself: no open cell of one leg touches another's but at its corner", () => {
  const r = generateRunner("margin", { legs: 14 });
  const D = r.dungeon;
  const owner = new Int16Array(D.w * D.d).fill(-1);
  r.legs.forEach((L, k) => {
    const [dx, dz] = STEP[L.heading]!;
    const [px, pz] = STEP[(L.heading + 1) & 3]!;
    for (let t = 0; t <= L.length; t += 1) for (let s = 0; s < r.width; s += 1) {
      const c = (L.from[1] + dz * t + pz * s) * D.w + (L.from[0] + dx * t + px * s);
      if (owner[c]! < 0) owner[c] = k;
    }
  });
  for (let j = 1; j < D.d - 1; j += 1) for (let i = 1; i < D.w - 1; i += 1) {
    const a = owner[j * D.w + i]!;
    if (a < 0) continue;
    for (const step of STEP) { const [dx, dz] = step; const b = owner[(j + dz) * D.w + i + dx]!; if (b >= 0) assert.ok(Math.abs(a - b) <= 1, `legs ${a} and ${b} touch at ${i},${j}`); }
  }
});

test("a run dresses and builds like any dungeon", () => {
  const r = generateRunner("dress", { legs: 10, halls: 0.6, hallReach: 4 });
  const S = dressDungeon(r.dungeon, "crypt", { seed: "dress" });
  const scene = buildDungeonScene(S);
  assert.ok(scene.count > 100, "walls and floors to draw");
  assert.ok(S.lights.length > 0, "torches");
});

test("a runner built with every face (a perspective camera's): more wall faces, the same floors", () => {
  const r = generateRunner("faces", { legs: 6 });
  const S = dressDungeon(r.dungeon, "crypt", { seed: "faces" });
  const one = buildDungeonScene(S), all = buildDungeonScene(S, { allFaces: true });
  assert.ok(all.count > one.count * 1.08, `${all.count} quads vs ${one.count}`);
});

test("splits: a room where the way parts round a block, both ways open, meeting again where the way goes on", () => {
  let splits = 0;
  for (let n = 0; n < 40; n += 1) {
    const r = generateRunner(`split-${n}`, { legs: 8, length: [22, 36], width: 2, halls: 0, hallReach: 1, loops: 0.6, size: [170, 170] });
    const D = r.dungeon;
    const open = (L: { from: readonly number[]; heading: number; length: number }, what: string): void => {
      const [dx, dz] = STEP[L.heading]!;
      for (let t = 0; t <= L.length; t += 1) assert.notEqual(D.cells[(L.from[1]! + dz * t) * D.w + L.from[0]! + dx * t], CELL.WALL, `${what}: a wall at step ${t}`);
    };
    r.legs.forEach((L, k) => {
      if (L.turn !== "split") return;
      splits += 1;
      assert.ok(L.split && L.split.left.length === 3 && L.split.right.length === 3);
      for (const side of ["left", "right"] as const) L.split![side].forEach((b, q) => open(b, `seed ${n} leg ${k} ${side} ${q}`));
      const next = r.legs[k + 1]!;
      assert.equal(next.heading, L.heading, "the way goes on as it came");
      const lastL = L.split!.left[2]!, lastR = L.split!.right[2]!;
      assert.ok(Math.abs(lastL.to[0] - lastR.to[0]) + Math.abs(lastL.to[1] - lastR.to[1]) <= 2 * (r.width - 1) + 2, "both ways come back together");
    });
  }
  assert.ok(splits > 10, `splits made: ${splits}`);
});
