import assert from "node:assert/strict";
import { test } from "node:test";
import { FLAT_ELEVATION, addHills, createGrid, elevationOf, gradeCorridor, gridOver, levelDisc, levelRect, lockGrid, raycast, sample } from "../src/index.ts";

const hills = (seed = "test", amp = 20) => addHills(gridOver(-400, -400, 800, 800, 2), seed, { amplitude: amp, scale: 250 });

test("grid: bilinear between cells, the edge carried on past it", () => {
  const g = createGrid(0, 0, 2, 3, 3);
  g.data.set([0, 2, 4, 0, 2, 4, 0, 2, 4]);
  assert.equal(sample(g, 1, 1), 1);
  assert.equal(sample(g, 3, 4), 3);
  assert.equal(sample(g, -50, 0), 0);
  assert.equal(sample(g, 99, 0), 4);
  const e = elevationOf(g);
  assert.deepEqual([e.min, e.max, e.slope], [0, 4, 1]);
  const n = e.normalAt(2, 2);
  assert.ok(n[0] < 0 && n[1] > 0.6 && Math.abs(n[2]) < 1e-9, `the ground rises toward +x: ${n}`);
  assert.equal(FLAT_ELEVATION.heightAt(123, -45), 0);
});

test("hills: the same seed the same ground, a different seed different ground, about the amplitude asked", () => {
  const a = hills("a"), b = hills("a"), c = hills("b");
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
  const e = elevationOf(a);
  assert.ok(e.max - e.min > 8 && e.max - e.min < 40, `range ${e.min}..${e.max}`);
  // A place-dependent amplitude: flat where it says 0.
  const g = addHills(gridOver(-100, -100, 200, 200, 2), "p", { amplitude: (x) => (x < 0 ? 0 : 20) });
  assert.equal(sample(g, -50, 10), 0);
});

test("corridor: a road over hills never climbs steeper than its grade, is flat across, and blends into the land", () => {
  const g = hills("road", 30);
  const xs = [-300, -100, 100, 300], zs = [-50, 40, -30, 60];
  const { s, y } = gradeCorridor(g, xs, zs, { half: 6, blend: 12, maxGrade: 0.08 });
  for (let n = 1; n < s.length; n += 1) assert.ok(Math.abs(y[n]! - y[n - 1]!) <= 0.08 * (s[n]! - s[n - 1]!) + 1e-9, `grade at ${s[n]}`);
  // Across the road (a metre either side of its line) the ground is the road's height.
  const mx = 0, mz = 40 + ((-30 - 40) * (100 - 0)) / 200, across = sample(g, mx, mz + 1) - sample(g, mx, mz - 1);
  assert.ok(Math.abs(across) < 0.3, `camber ${across}`);
  // The grid's own steps stay gentle everywhere (the blend makes an embankment, not a cliff).
  assert.ok(elevationOf(g).slope < 1.2, `steepest ${elevationOf(g).slope}`);
  // Pinned ends are met exactly.
  const p = gradeCorridor(hills("pin"), [0, 200], [0, 0], { half: 4, blend: 6, maxGrade: 0.1, ends: [5, 9] });
  assert.equal(p.y[0], 5);
  assert.equal(p.y[p.y.length - 1], 9);
  // ...and the grade still holds right up to a pinned end (no step where the line meets it).
  for (let n = 1; n < p.s.length; n += 1) assert.ok(Math.abs(p.y[n]! - p.y[n - 1]!) <= 0.1 * (p.s[n]! - p.s[n - 1]!) + 1e-9, `pinned grade at ${p.s[n]}`);
});

test("levelling: a junction disc and a rotated building pad are flat, and say the height they were set to", () => {
  const g = hills("pad");
  const h = levelDisc(g, 20, 20, 10, { blend: 8 });
  for (const [x, z] of [[20, 20], [27, 20], [20, 13]] as const) assert.ok(Math.abs(sample(g, x, z) - h) < 1e-4);
  const p = levelRect(g, -120, 60, 30, 18, 0.6, { blend: 6, height: 7.5 });
  assert.equal(p, 7.5);
  for (const [lx, lz] of [[0, 0], [13, 7], [-13, -7]] as const) {
    const c = Math.cos(0.6), sn = Math.sin(0.6), x = -120 + lx * c + lz * sn, z = 60 - lx * sn + lz * c;
    assert.ok(Math.abs(sample(g, x, z) - 7.5) < 1e-3, `pad at ${lx},${lz}: ${sample(g, x, z)}`);
  }
});

test("raycast: a ray from above lands on the ground where the height says, and one pointed at the sky misses", () => {
  const e = elevationOf(hills("ray", 25));
  const ox = -30, oz = 10, oy = 80, l = Math.sqrt(0.3 * 0.3 + 1 + 0.2 * 0.2), dx = 0.3 / l, dy = -1 / l, dz = 0.2 / l;
  const t = raycast(e, ox, oy, oz, dx, dy, dz, 500);
  assert.ok(t > 0);
  const x = ox + dx * t, z = oz + dz * t;
  assert.ok(Math.abs(oy + dy * t - e.heightAt(x, z)) < 1e-3, "on the ground");
  assert.equal(raycast(e, 0, 80, 0, 0, 1, 0, 500), -1);
  // A grazing ray along the ground is still caught (the slope bound never steps through a hill).
  const y0 = e.heightAt(-300, 0) + 1.5, g = raycast(e, -300, y0, 0, 1, -0.002, 0, 700);
  assert.ok(g > 0, "a hill rises across its path");
  assert.ok(Math.abs(y0 - 0.002 * g - e.heightAt(-300 + g, 0)) < 1e-3, "and it lands on it, not inside it");
});

test("locking: a street graded after an arterial blends round it -- never cuts into its width", () => {
  const g = hills("lock", 25), lock = lockGrid(g);
  const main = gradeCorridor(g, [-300, 300], [0, 0], { half: 8, blend: 10, maxGrade: 0.08, lock });
  const before = Array.from({ length: 21 }, (_, k) => sample(g, -100 + k * 10, 0));
  // A street crossing near it, its embankment reaching over the arterial.
  gradeCorridor(g, [-60, -60], [-200, 200], { half: 5, blend: 12, maxGrade: 0.12, lock });
  levelRect(g, 40, 20, 30, 20, 0, { blend: 6, height: 30, lock });
  const after = Array.from({ length: 21 }, (_, k) => sample(g, -100 + k * 10, 0));
  for (let k = 0; k < after.length; k += 1) assert.ok(Math.abs(after[k]! - before[k]!) < 1e-6, `arterial at x=${-100 + k * 10} moved ${after[k]! - before[k]!}`);
  assert.ok(main.y.length > 0);
});
