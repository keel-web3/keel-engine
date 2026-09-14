import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBridge, bridgePlacement, bridgeSpans, buildPathGrid, canRamp, carveRiver, clearance, cliffFaces, createTerrain, edgeLevels, layRamp, meets, regions, spanTiles, waterBodies,
} from "../src/index.ts";
import { randomTerrain } from "./helpers.ts";

// dir8 bits: N 0, NE 1, E 2, SE 3, S 4, SW 5, W 6, NW 7.
const N = 1, E = 4, S = 16, W = 64;

test("a cliff blocks; a ramp joins the two levels at its foot and top only", () => {
  const t = createTerrain({ width: 6, depth: 6, chunk: 8 });
  for (let j = 3; j < 6; j += 1) for (let i = 0; i < 6; i += 1) t.setHeight(i, j, 1); // (the north half a step up)
  let g = buildPathGrid(t);
  assert.equal(g.links[t.index(2, 2)]! & N, 0, "a cliff blocks");
  assert.equal(regions(g).count, 2);
  assert.equal(cliffFaces(t).filter((f) => f.dir === 2).length, 6); // (one south-facing face per plateau edge tile)
  // A ramp on (2, 2) rising north.
  assert.equal(canRamp(t, 2, 2, 0), true);
  assert.equal(canRamp(t, 2, 2, 2), false, "it can't rise into lower ground");
  layRamp(t, 2, 2, 0);
  assert.deepEqual(edgeLevels(t, 2, 2, 0), [1, 1]);
  assert.deepEqual(edgeLevels(t, 2, 2, 2), [0, 0]);
  assert.deepEqual(edgeLevels(t, 2, 2, 1), [0, 1]); // (its side slopes)
  g = buildPathGrid(t);
  assert.notEqual(g.links[t.index(2, 2)]! & N, 0, "up the ramp");
  assert.notEqual(g.links[t.index(2, 2)]! & S, 0, "down its foot");
  assert.equal(g.links[t.index(2, 2)]! & E, 0, "not off its side");
  assert.equal(g.links[t.index(2, 2)]! & W, 0);
  assert.equal(g.links[t.index(2, 3)]! & S, S, "the top joins back down");
  assert.equal(regions(g).count, 1);
  // Two ramps side by side join each other across.
  layRamp(t, 3, 2, 0);
  g = buildPathGrid(t);
  assert.ok(meets(t, 2, 2, 1));
  assert.notEqual(g.links[t.index(2, 2)]! & E, 0);
  // No cutting a corner past the cliff: from the foot's west neighbour, no diagonal up onto the plateau.
  assert.equal(g.links[t.index(1, 2)]! & 2, 0);
  // Ramps are what heightAt slopes.
  assert.equal(t.heightAt(2.5 * 2, 2.0 * 2), 0);
  assert.equal(t.heightAt(2.5 * 2, 2.5 * 2), 0.5);
  assert.ok(Math.abs(t.heightAt(2.5 * 2, 2.99 * 2) - 0.99) < 1e-9);
});

test("water: ground fords shallow and not deep; hover crosses both; bridges carry the ground along their axis", () => {
  const t = createTerrain({ width: 9, depth: 5, chunk: 8, fill: "grass", level: 2 });
  // A river running north-south at x = 3..5: shallow at x = 3, deep at 4, shallow at 5.
  for (let j = 0; j < 5; j += 1) { t.setHeight(3, j, 1); t.setHeight(4, j, 0); t.setHeight(5, j, 1); for (const i of [3, 4, 5]) t.setWater(i, j, 2); }
  const ground = buildPathGrid(t);
  assert.equal(ground.passable(3, 2), true);
  assert.equal(ground.passable(4, 2), false);
  assert.equal(ground.cost[t.index(3, 2)], 5);
  assert.notEqual(ground.links[t.index(2, 2)]! & E, 0, "wading in from the bank (water at the bank's level)");
  assert.equal(regions(ground).count, 2);
  const hover = buildPathGrid(t, { moveClass: "hover" });
  assert.equal(hover.passable(4, 2), true);
  assert.equal(regions(hover).count, 1);
  // A bridge across at j = 2.
  const spans = bridgeSpans(t, { maxSpan: 5, regions: regions(ground).label });
  const s = spans.find((x) => x.from[1] === 2 && x.axis === 1)!;
  assert.ok(s, "a span across the river");
  assert.equal(s.length, 3);
  assert.equal(s.over, "water");
  assert.equal(s.joins, true);
  assert.ok(spans[0]!.joins);
  applyBridge(t, s);
  assert.deepEqual(spanTiles(s), [[3, 2], [4, 2], [5, 2]]);
  const g2 = buildPathGrid(t);
  assert.equal(regions(g2).count, 1, "the bridge joins the banks");
  assert.equal(g2.passable(4, 2), true);
  assert.equal(g2.links[t.index(4, 2)]! & (N | S), 0, "no stepping off a deck sideways");
  const p = bridgePlacement(t, s);
  assert.deepEqual(p.pos, [4.5 * 2, 2, 2.5 * 2]);
  assert.equal(p.yaw, Math.PI / 2);
  assert.equal(p.length, (3 + 1) * 2);
});

test("bridge spans: only straight runs between two ends at one level, never over higher ground, best first", () => {
  const t = randomTerrain(5, 48, 40, { water: true });
  const g = buildPathGrid(t);
  const spans = bridgeSpans(t, { maxSpan: 6, regions: regions(g).label });
  assert.ok(spans.length > 0);
  for (const s of spans) {
    assert.ok(s.length >= 1 && s.length <= 6);
    for (const [i, j] of spanTiles(s)) {
      const top = Math.max(...edgeLevels(t, i, j, 0), ...edgeLevels(t, i, j, 2));
      assert.ok(top <= s.level, "nothing under the deck stands above it");
    }
    for (const [i, j] of [s.from, s.to]) assert.equal(Math.max(...edgeLevels(t, i, j, 0), ...edgeLevels(t, i, j, 2)), s.level);
  }
  for (let n = 1; n < spans.length; n += 1) assert.ok(spans[n - 1]!.score >= spans[n]!.score);
});

test("rivers carve downhill: the water never rises downstream", () => {
  const t = createTerrain({ width: 20, depth: 4, chunk: 8, level: 0 });
  for (let i = 0; i < 20; i += 1) for (let j = 0; j < 4; j += 1) t.setHeight(i, j, 6 - Math.floor(i / 4));
  const path = Array.from({ length: 20 }, (_, i) => [i, 1] as [number, number]);
  const levels = carveRiver(t, path, { width: 2, depth: 1 });
  for (let n = 1; n < levels.length; n += 1) assert.ok(levels[n]! <= levels[n - 1]!);
  const bodies = waterBodies(t);
  assert.ok(bodies.length >= 1);
  for (const [i, j] of path) assert.equal(t.waterDepth(i, j), 1);
});

test("clearance: open ground is wide, a wall's neighbour is 1", () => {
  const t = createTerrain({ width: 11, depth: 11, chunk: 8 });
  const g = buildPathGrid(t);
  const c = clearance(g);
  assert.equal(c[t.index(5, 5)], 6); // (the middle of 11 x 11: five tiles to the edge, plus itself)
  assert.equal(c[t.index(0, 5)], 1);
  const large = buildPathGrid(t, { moveClass: "large" });
  assert.equal(large.passable(0, 5), false, "a large unit can't stand against the map's edge");
  assert.equal(large.passable(1, 5), true);
});
