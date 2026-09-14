import { test } from "node:test";
import assert from "node:assert/strict";
import { DX8, DZ8, GOAL, NONE, UNREACHED, buildPathGrid, buildSectors, createFlowCache, createTerrain, flowField, followField, pathGridOf, regions, steer } from "../src/index.ts";
import type { PathGrid } from "../src/index.ts";
import { randomTerrain, rng } from "./helpers.ts";

// A plain Dijkstra (binary-heap-free: O(n^2) on small grids) toward the goals, with the field's costs.
function brute(g: PathGrid, goals: number[]): Float64Array {
  const n = g.width * g.depth;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  for (const k of goals) dist[k] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let k = 0; k < n; k += 1) if (!done[k] && dist[k]! < best) { best = dist[k]!; u = k; }
    if (u < 0) break;
    done[u] = 1;
    const ui = u % g.width, uj = (u - ui) / g.width;
    for (let d = 0; d < 8; d += 1) {
      if (!(g.links[u]! & (1 << d))) continue;
      const v = (uj + DZ8[d]!) * g.width + ui + DX8[d]!;
      // (The field spreads from the goal: stepping v -> u costs u's cost... from u's side, entering u.)
      const c = dist[u]! + (d & 1 ? 7 : 5) * g.cost[u]!;
      if (c < dist[v]!) dist[v] = c;
    }
  }
  return dist;
}

test("the flow field's integration is the true cheapest cost, and following it gets there for exactly that", () => {
  for (const seed of [1, 2, 3, 7]) {
    const t = randomTerrain(seed, 32, 28, { chunk: 16 });
    const g = buildPathGrid(t, { moveClass: seed === 7 ? "hover" : "ground" });
    const f0 = rng(seed);
    const goals: number[] = [];
    while (goals.length < 1 + (seed % 3)) { const k = Math.floor(f0() * g.cost.length); if (g.cost[k]) goals.push(k); }
    const f = flowField(g, goals);
    const want = brute(g, goals);
    for (let k = 0; k < g.cost.length; k += 1) {
      if (want[k] === Infinity) { assert.equal(f.dist[k], UNREACHED); assert.equal(f.dir[k], NONE); continue; }
      assert.equal(f.dist[k], want[k], `seed ${seed}, tile ${k}`);
      if (want[k] === 0) { assert.equal(f.dir[k], GOAL); continue; }
      // Following the directions: each step costs what the field says, and ends on a goal.
      const i = k % g.width, j = (k - i) / g.width;
      const path = followField(f, i, j);
      let cost = 0;
      for (let s = 1; s < path.length; s += 1) {
        const [a, b] = path[s - 1]!, [c, d] = path[s]!;
        const diag = a !== c && b !== d;
        cost += (diag ? 7 : 5) * g.cost[d * g.width + c]!;
      }
      const end = path[path.length - 1]!;
      assert.ok(goals.includes(end[1] * g.width + end[0]));
      assert.equal(cost, want[k]);
    }
  }
});

test("a flow field over 256 x 256 takes milliseconds (the 24-player map)", () => {
  const t = randomTerrain(42, 256, 256, { chunk: 32, ramps: 200 });
  const g = buildPathGrid(t);
  const r = regions(g);
  const big = r.sizes.indexOf(Math.max(...r.sizes));
  const goal = r.label.indexOf(big);
  const into = flowField(g, [goal]);
  const times: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    const t0 = performance.now();
    flowField(g, [goal], { into });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1]!;
  const t1 = performance.now();
  buildPathGrid(t);
  const gridMs = performance.now() - t1;
  console.log(`# flow field 256x256: median ${median.toFixed(2)} ms, best ${times[0]!.toFixed(2)} ms; ${into.reached} tiles reached; path grid build ${gridMs.toFixed(1)} ms`);
  if (process.env["KEEL_PERF"] === "1") assert.ok(median < 40, `a field in ${median.toFixed(1)} ms`);
  // 2,000 units reading their heading off it: nothing more than a lookup each.
  const t2 = performance.now();
  const out: [number, number] = [0, 0];
  const f = rng(9);
  let s = 0;
  for (let u = 0; u < 2000; u += 1) { steer(into, f() * 512, f() * 512, 2, out); s += out[0]; }
  const steerMs = performance.now() - t2;
  console.log(`# 2,000 units steering: ${steerMs.toFixed(2)} ms (${s.toFixed(1)})`);
});

test("steer: a heading down the field; nothing at the goal", () => {
  const t = createTerrain({ width: 20, depth: 20, chunk: 16 });
  const g = buildPathGrid(t);
  const f = flowField(g, [[15, 10]]);
  const [dx, dz] = steer(f, 5 * 2 + 1, 10 * 2 + 1, 2);
  assert.ok(dx > 0.9 && Math.abs(dz) < 0.3, `heading ${dx}, ${dz}`);
  assert.deepEqual(steer(f, 15 * 2 + 1, 10 * 2 + 1, 2), [0, 0]);
});

test("HPA*: routes exist exactly when the goal is reachable, and cost within a little of the best", () => {
  let worst = 1;
  for (const seed of [3, 5, 8]) {
    const t = randomTerrain(seed, 96, 80, { chunk: 32, ramps: 30 });
    const g = buildPathGrid(t);
    const hpa = buildSectors(g, { size: 16 });
    const r = regions(g);
    const f0 = rng(seed + 100);
    for (let n = 0; n < 30; n += 1) {
      let a = -1, b = -1;
      while (a < 0 || !g.cost[a]) a = Math.floor(f0() * g.cost.length);
      while (b < 0 || !g.cost[b]) b = Math.floor(f0() * g.cost.length);
      const from: [number, number] = [a % g.width, Math.floor(a / g.width)], to: [number, number] = [b % g.width, Math.floor(b / g.width)];
      const route = hpa.route(from, to);
      const reachable = r.label[a] === r.label[b];
      assert.equal(route !== null, reachable, `seed ${seed}: ${from} -> ${to}`);
      if (!route) continue;
      // The best cost from a to b: a field toward b, read at a.
      const best = flowField(g, [b]).dist[a]!;
      assert.ok(route.cost >= best - 1e-9, "never cheaper than the best");
      worst = Math.max(worst, route.cost / Math.max(1, best));
      // The corridor holds a way through: a field inside it reaches the start.
      const within = hpa.corridor(route, 0);
      const inside = flowField(g, [b], { within });
      assert.notEqual(inside.dist[a], UNREACHED, "the corridor connects");
    }
  }
  console.log(`# HPA* worst route / best: ${worst.toFixed(3)}`);
  assert.ok(worst < 1.35);
});

test("the flow cache keeps the most recent fields and reuses the oldest's arrays", () => {
  const g = pathGridOf(4, 4, new Uint8Array(16).fill(1), new Uint8Array(16));
  const cache = createFlowCache({ capacity: 2 });
  const a = cache.get("a", (into) => flowField(g, [0], into ? { into } : {}));
  cache.get("b", (into) => flowField(g, [1], into ? { into } : {}));
  assert.equal(cache.get("a", () => { throw new Error("hit"); }), a);
  const c = cache.get("c", (into) => { assert.ok(into, "the oldest (b) hands its arrays over"); return flowField(g, [2], { into }); });
  assert.ok(c);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.hits, 1);
  assert.equal(cache.misses, 3);
});
