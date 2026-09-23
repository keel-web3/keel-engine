// Level of detail: the error from true distance (turning never changes a level),
// the view-angle term, prefix ranges that never draw an index twice, hysteresis,
// dwell and fades, the triangle budget, tiles and the work queue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boxDistance, coarsestUnder, createLodSelector, createWorkQueue, facingVisibility, gridTiles, pixelError, rangesOf } from "../src/index.ts";
import type { LodNode, LodView, Vec3 } from "../src/index.ts";

const persp = (origin: Vec3, forward: Vec3 = [0, 0, 1]): LodView => ({ kind: "persp", origin, forward, k: 0, tanHalfFov: 0.6, height: 420 });
const node = (x: number, z: number, over: Partial<LodNode> = {}): LodNode => ({
  key: `n${x},${z}`, lo: [x - 5, 0, z - 5], hi: [x + 5, 40, z + 5], levels: [3000, 1200, 300],
  steps: [{ terms: [{ error: 1 }] }, { terms: [{ error: 8 }] }], ...over,
});

test("lod: distance is radial to the nearest point of the box, 0 inside", () => {
  assert.equal(boxDistance([0, 0, 0], [-1, -1, -1], [1, 1, 1]), 0);
  assert.equal(boxDistance([0, 0, -10], [-1, -1, -1], [1, 1, 1]), 9);
  assert.ok(Math.abs(boxDistance([4, 5, 0], [-1, -1, -1], [1, 1, 1]) - 5) < 1e-12);
});

test("lod: turning the camera never changes the error -- only moving does", () => {
  const n = node(0, 100);
  const s = n.steps[1]!;
  const a = pixelError(persp([0, 2, 0], [0, 0, 1]), n, s), b = pixelError(persp([0, 2, 0], [1, 0, 0]), n, s), c = pixelError(persp([0, 2, 0], [0, 0, -1]), n, s);
  assert.equal(a, b); assert.equal(a, c);
  assert.ok(pixelError(persp([0, 2, -100]), n, s) < a / 1.9);
  // (8 m at 95 m, 420 px tall, tan 0.6: 8 * 420 / (2 * 95 * 0.6).)
  assert.ok(Math.abs(a - (8 * 420) / (2 * 95 * 0.6)) < 1e-9);
  const ortho: LodView = { kind: "ortho", origin: [0, 0, 0], forward: [0, -0.58, 0.81], k: 20, tanHalfFov: 0, height: 420 };
  assert.equal(pixelError(ortho, n, s), 160);
});

test("lod: rooftop kit is invisible from under the parapet, a wall sign thins from above", () => {
  assert.equal(facingVisibility("roof", 0.3, 2, 60), 0);
  assert.equal(facingVisibility("roof", 0.5, 80, 60), 0.5);
  assert.equal(facingVisibility("wall", 0, 2), 1);
  assert.equal(facingVisibility("wall", 1, 200), 0.2);
  assert.equal(facingVisibility("free", 1, 200), 1);
  const roofy = node(0, 30, { steps: [{ terms: [{ error: 3, facing: "roof", roofY: 40 }] }, { terms: [{ error: 8 }] }] });
  assert.equal(pixelError(persp([0, 2, 0]), roofy, roofy.steps[0]!), 0);
  assert.ok(pixelError(persp([0, 90, 0]), roofy, roofy.steps[0]!) > 0);
});

test("lod: nested prefixes -- a level is a count, a fade draws only the delta", () => {
  const n = node(0, 0);
  assert.deepEqual(rangesOf({ level: 1 }, n), [{ offset: 0, count: 1200, fade: 1 }]);
  assert.deepEqual(rangesOf({ level: 1, fading: { to: 0, t: 0.25 } }, n), [{ offset: 0, count: 1200, fade: 1 }, { offset: 1200, count: 1800, fade: 0.25 }]);
  assert.deepEqual(rangesOf({ level: 0, fading: { to: 2, t: 0.5 } }, n), [{ offset: 0, count: 300, fade: 1 }, { offset: 300, count: 2700, fade: 0.5 }]);
  assert.deepEqual(rangesOf({ level: 1, fading: { to: 0, t: 0 } }, n), [{ offset: 0, count: 1200, fade: 1 }]);
  assert.equal(coarsestUnder([0.5, 3], 1), 1);
  assert.equal(coarsestUnder([2, 0.1], 1), 0);
});

test("lod: a new node takes its level at once; moving away coarsens after the dwell, through a fade", () => {
  const sel = createLodSelector({ tau: 2, dwell: 0.3, fade: 0.25 });
  const n = node(0, 100);
  // (step 0 is 1 m: at 95 m it's 1 * 420 / (2 * 95 * 0.6) = 3.7 px, so level 0.)
  assert.equal(sel.select(persp([0, 2, 0]), [n], 1 / 60)[0]!.level, 0);
  // Far enough that 1 m is under tau / band but 8 m isn't: level 1, reached through a fade of the L0 delta.
  const far = persp([0, 2, -200]);
  const seen: { level: number; t: number | undefined }[] = [];
  for (let i = 0; i < 60; i += 1) { const p = sel.select(far, [n], 1 / 60)[0]!; seen.push({ level: p.level, t: p.fading?.t }); }
  const fadingFrames = seen.filter((s) => s.t !== undefined);
  assert.ok(fadingFrames.length >= 10 && fadingFrames.length <= 20, `${fadingFrames.length} frames of fade`);
  // (Coarsening: what's drawn of the delta falls.)
  for (let i = 1; i < fadingFrames.length; i += 1) assert.ok(fadingFrames[i]!.t! <= fadingFrames[i - 1]!.t!);
  assert.equal(seen.at(-1)!.level, 1);
  assert.equal(seen.at(-1)!.t, undefined);
});

test("lod: hysteresis -- a camera sitting on a boundary never flickers", () => {
  const sel = createLodSelector({ tau: 2, band: 1.4, dwell: 0, fade: 0 });
  const n = node(0, 0);
  // (Where step 0's error is exactly tau: 1 * 420 / (2 * d * 0.6) = 2 -> d = 175.)
  // (and coarsening wants it under tau / 1.4: d = 245. Between the two a node keeps whichever level it came with.)
  for (const [from, want] of [[100, 0], [300, 1]] as const) {
    sel.reset();
    sel.select(persp([0, 2, -from - 5]), [n], 1 / 60);
    const levels = new Set<number>();
    for (let i = 0; i < 200; i += 1) levels.add(sel.select(persp([0, 2, -5 - 210 + ((i % 7) - 3) * 10]), [n], 1 / 60)[0]!.level);
    assert.deepEqual([...levels], [want]);
  }
});

test("lod: missing detail refines at once, past the dwell, fading in", () => {
  const sel = createLodSelector({ tau: 2, dwell: 10, fade: 0.25 });
  const n = node(0, 0);
  sel.select(persp([0, 2, -2000]), [n], 1 / 60);
  const p = sel.select(persp([0, 2, -10]), [n], 1 / 60)[0]!;
  assert.equal(p.level, 2);
  assert.equal(p.fading?.to, 0);
  assert.ok((p.fading?.t ?? 0) > 0 && (p.fading?.t ?? 0) < 0.2);
  let last = p;
  for (let i = 0; i < 30; i += 1) last = sel.select(persp([0, 2, -10]), [n], 1 / 60)[0]!;
  assert.equal(last.level, 0);
  assert.equal(last.fading, undefined);
});

test("lod: over the triangle budget the farthest go coarser first", () => {
  const sel = createLodSelector({ tau: 0.01, triangles: 1100 });
  const near = node(0, 20), far = node(0, 400);
  const picks = sel.select(persp([0, 2, 0]), [near, far], 1 / 60);
  assert.ok(sel.triangles <= 1100, `${sel.triangles}`);
  const [pn, pf] = picks;
  assert.equal(pn!.level, 0);
  assert.equal(pf!.level, 2);
});

test("lod: tiles gather boxes by the cell their middle stands in", () => {
  const items = [0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => ({ lo: [i * 100, 0, j * 100] as Vec3, hi: [i * 100 + 10, 50 + i, j * 100 + 10] as Vec3 })));
  const tiles = gridTiles(items, 2);
  assert.equal(tiles.length, 4);
  assert.deepEqual(tiles.map((t) => t.members.length), [4, 4, 4, 4]);
  assert.deepEqual(tiles[0]!.members, [0, 1, 4, 5]);
  assert.deepEqual(tiles[3]!.hi, [310, 53, 310]);
  assert.deepEqual(gridTiles([], 4), []);
});

test("lod: the work queue runs coarse stages first, nearest first, by work units, and reports real progress", () => {
  const ran: string[] = [];
  const q = createWorkQueue({ blocking: 1, labels: ["city", "skyline", "rest"] });
  const job = (key: string, stage: number, cost: number, priority = 0) => ({ key, stage, cost, priority, run: () => { ran.push(key); } });
  q.add(job("rest-a", 2, 50)); q.add(job("sky-far", 1, 10, -900)); q.add(job("sky-near", 1, 10, -100)); q.add(job("city", 0, 20));
  q.add(job("city", 0, 20));
  assert.equal(q.label, "city");
  assert.equal(q.progress, 0);
  assert.equal(q.run(25), 20);
  assert.deepEqual(ran, ["city"]);
  assert.ok(Math.abs(q.progress - 0.5) < 1e-12);
  assert.equal(q.ready, false);
  q.run(20);
  assert.deepEqual(ran, ["city", "sky-near", "sky-far"]);
  assert.equal(q.progress, 1);
  assert.equal(q.ready, true);
  assert.equal(q.label, "rest");
  assert.equal(q.run(1), 50);
  assert.equal(q.pending, 0);
  assert.equal(q.stage, -1);
});
