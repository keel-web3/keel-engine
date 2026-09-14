import { test } from "node:test";
import assert from "node:assert/strict";
import { terrainTypes } from "@keel-engine/terrain";
import { CELL, DUNGEON_ALGORITHMS, DUNGEON_TILES, THEMES, checkDungeon, dungeonLayers, edgeTiles, generateDungeon, overlappingModel, solveWfc, tiledModel, wfcTown } from "../src/index.ts";

test("dungeons: 1,000 seeds of every generator pass the fairness gate (connected, exit behind the locked door, key before it)", () => {
  const report: string[] = [];
  for (const algorithm of DUNGEON_ALGORITHMS) {
    let pass = 0, rerolls = 0, ms = 0, path = 0;
    const fails: string[] = [];
    const t0 = performance.now();
    for (let s = 0; s < 1000; s += 1) {
      const D = generateDungeon(`gate-${s}`, 48, 36, { algorithm, budget: 60 });
      const c = checkDungeon(D, { minPath: 10 });
      if (c.pass) { pass += 1; path += c.startToExit; } else if (fails.length < 3) fails.push(`gate-${s}: ${c.problems.join("; ")}`);
      rerolls += D.stats["attempt"] ?? 0;
    }
    ms = performance.now() - t0;
    report.push(`${algorithm} ${pass}/1000 (${rerolls} rerolls, ${(ms / 1000).toFixed(2)} ms each, start->exit ${(path / Math.max(1, pass)).toFixed(0)} steps)`);
    assert.equal(pass, 1000, `${algorithm}: ${fails.join(" | ")}`);
  }
  console.log(`# dungeons 48 x 36: ${report.join("; ")}`);
});

test("dungeons: deterministic; the rooms grammar places start, key, boss and exit rooms; themes dress it", () => {
  for (const algorithm of DUNGEON_ALGORITHMS) {
    const a = generateDungeon("same", 56, 40, { algorithm }), b = generateDungeon("same", 56, 40, { algorithm });
    assert.deepEqual([...a.cells], [...b.cells], algorithm);
    assert.deepEqual([a.start, a.exit, a.key, a.boss], [b.start, b.exit, b.key, b.boss]);
  }
  const D = generateDungeon("grammar", 64, 48, { algorithm: "rooms", rooms: 10 });
  const kinds = D.rooms.map((r) => r.kind);
  for (const k of ["start", "key", "boss", "exit"] as const) assert.ok(kinds.includes(k), `a ${k} room`);
  assert.ok(D.cells.includes(CELL.LOCKED), "a locked door");
  assert.ok(D.lights.length > 3, "torches");
  const types = terrainTypes();
  const { layers, things } = dungeonLayers(D, types, { i0: 100, j0: -20, level: 2, theme: THEMES["crypt"]! });
  assert.equal(layers.i0, 100);
  // Walls stand up, floors are the theme's, torches light pools over the ambient.
  const wall = D.cells.indexOf(CELL.WALL), floor = D.cells.indexOf(CELL.FLOOR);
  assert.equal(layers.height[wall], 2 + THEMES["crypt"]!.wallHeight);
  assert.equal(layers.type[floor], types.id("flagstone"));
  const lit = D.lights[0]!;
  assert.ok(layers.light[lit[1] * D.w + lit[0]]! > 200 && Math.min(...layers.light) <= THEMES["crypt"]!.ambient + 1);
  for (const k of ["start", "exit", "key", "boss"]) assert.ok(things.some((t) => t.kind === k), k);
});

test("WFC: simple tiled solves with its constraints; overlapping reproduces the sample's local patterns", () => {
  const model = tiledModel(DUNGEON_TILES);
  const r = solveWfc(model, { width: 16, height: 12, seed: "wfc-1", budget: 500, constrain: (x, y) => (x === 0 && y === 0 ? [0] : null) });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.grid[0], 0, "the pinned cell");
  // Every neighbouring pair agrees on its edge.
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 16; x += 1) {
    const t = DUNGEON_TILES[r.grid[y * 16 + x]!]!;
    if (x < 15) assert.equal(t.edges[1], DUNGEON_TILES[r.grid[y * 16 + x + 1]!]!.edges[3]);
    if (y < 11) assert.equal(t.edges[2], DUNGEON_TILES[r.grid[(y + 1) * 16 + x]!]!.edges[0]);
  }
  // Overlapping: a sample of stripes and blobs; every 3 x 3 window of the output is one of the sample's.
  const sw = 12, sh = 12;
  const sample = new Uint8Array(sw * sh).map((_, k) => ((k % sw) % 4 === 0 || (Math.floor(k / sw) % 5 === 0 && (k % sw) > 3) ? 1 : 0));
  const om = overlappingModel(sample, sw, sh, { N: 3, symmetry: 2 });
  const res = solveWfc(om, { width: 20, height: 20, seed: "wfc-2", budget: 800 });
  assert.equal(res.ok, true, res.reason);
  const out = new Uint8Array(20 * 20).map((_, k) => om.patterns[res.grid[k]!]![0]!);
  const windows = new Set(om.patterns.map((p) => p.join(",")));
  for (let y = 0; y < 18; y += 1) for (let x = 0; x < 18; x += 1) {
    const w: number[] = [];
    for (let dy = 0; dy < 3; dy += 1) for (let dx = 0; dx < 3; dx += 1) w.push(out[(y + dy) * 20 + x + dx]!);
    assert.ok(windows.has(w.join(",")), `window at ${x},${y}`);
  }
});

test("WFC: contradictions are handled -- an impossible set says so, a hard one backtracks, the budget holds", () => {
  // Impossible: a tile that only fits next to a tile that doesn't exist.
  const bad = tiledModel([{ name: "a", weight: 1, edges: ["x", "y", "x", "z"] }]);
  const r1 = solveWfc(bad, { width: 4, height: 4, seed: 1 });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "impossible");
  // Hard: pipes that must close, with the border forced to be empty -- decisions run into dead ends and backtrack.
  const tiles = edgeTiles([
    { name: "empty", rows: ["...", "...", "..."], weight: 1, rotate: false },
    { name: "line", rows: [".#.", ".#.", ".#."], weight: 4 },
    { name: "turn", rows: [".#.", ".##", "..."], weight: 4 },
    { name: "cross", rows: [".#.", "###", ".#."], weight: 0.2, rotate: false },
  ]);
  const hard = tiledModel(tiles);
  let backtracked = 0, solved = 0;
  for (let s = 0; s < 30; s += 1) {
    const r = solveWfc(hard, { width: 10, height: 10, seed: s, budget: 400, constrain: (x, y) => (x === 0 || y === 0 || x === 9 || y === 9 ? [0] : null) });
    if (r.ok) solved += 1;
    backtracked += r.backtracks;
    // (Whatever happened, the grid has a tile everywhere.)
    assert.ok([...r.grid].every((t) => t >= 0));
  }
  assert.ok(solved >= 25, `${solved}/30 solved`);
  assert.ok(backtracked > 0, "some backtracking happened");
  // The budget: a big grid with 1 ms stops on time with a best-effort grid.
  const t0 = performance.now();
  const r3 = solveWfc(tiledModel(DUNGEON_TILES), { width: 120, height: 120, seed: 3, budget: 1 });
  assert.ok(performance.now() - t0 < 150, "stopped near its budget");
  assert.equal(r3.reason, "budget");
  assert.ok([...r3.grid].every((t) => t >= 0));
});

test("WFC towns: roads and lots, the border quiet but for the way in", () => {
  const { plan, result } = wfcTown("town-1", 30, 24);
  assert.equal(result.ok, true, result.reason);
  const all = plan.join("");
  assert.ok(all.includes("r") && all.includes("h"), "roads and houses");
  // A house's lot touches a road (its tile's south edge).
  for (let y = 0; y < plan.length; y += 1) for (let x = 0; x < plan[0]!.length; x += 1) if (plan[y]![x] === "h") {
    const near = [plan[y + 1]?.[x], plan[y - 1]?.[x], plan[y]?.[x + 1], plan[y]?.[x - 1]].includes("r");
    assert.ok(near, `house at ${x},${y} has a road`);
  }
});
