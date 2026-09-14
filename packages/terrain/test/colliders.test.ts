import { test } from "node:test";
import assert from "node:assert/strict";
import { createCharacter, solidDistance } from "@keel-engine/physics";
import type { Solid } from "@keel-engine/physics";
import { applyBridge, bridgeSpans, buildPathGrid, chunkColliders, collidersNear, createTerrain, regions, terrainColliders } from "../src/index.ts";
import { randomTerrain, rng } from "./helpers.ts";

test("colliders match the terrain: just above the ground is outside every solid, just below is inside one", () => {
  for (const seed of [1, 2, 3, 4]) {
    const t = randomTerrain(seed);
    const { boxes, wedges } = terrainColliders(t, { decks: false });
    const solids: Solid[] = [...boxes, ...wedges];
    const f = rng(seed * 31);
    for (let n = 0; n < 600; n += 1) {
      // (Away from tile borders by a little: a point exactly on a cliff's edge belongs to both levels.)
      const i = Math.floor(f() * t.width), j = Math.floor(f() * t.depth);
      const x = (i + 0.02 + f() * 0.96) * t.tileSize, z = (j + 0.02 + f() * 0.96) * t.tileSize;
      const y = t.heightAt(x, z);
      const above = Math.min(...solids.map((s) => solidDistance([x, y + 0.02, z], s).d));
      const below = Math.min(...solids.map((s) => solidDistance([x, y - 0.02, z], s).d));
      assert.ok(above > 0.005, `seed ${seed}: above the ground at ${x.toFixed(2)},${z.toFixed(2)} (y ${y}) is outside (${above})`);
      assert.ok(below < 0, `seed ${seed}: below the ground at ${x.toFixed(2)},${z.toFixed(2)} is inside (${below})`);
    }
  }
});

test("colliders merge: a chunk is tens of solids, not a tile each", () => {
  const t = randomTerrain(9, 64, 64, { chunk: 32 });
  const all = terrainColliders(t);
  const tiles = t.width * t.depth;
  assert.ok(all.boxes.length < tiles / 4, `${all.boxes.length} boxes for ${tiles} tiles`);
  for (const c of all.chunks) assert.equal(c.version, t.chunkVersion[c.chunk]);
  // collidersNear reuses the chunks it has, and rebuilds an edited one.
  const cache = new Map();
  const a = collidersNear(t, 20, 20, 5, cache);
  assert.ok(a.boxes.length > 0);
  t.setHeight(10, 10, 9);
  const b = collidersNear(t, 20, 20, 5, cache);
  assert.notDeepEqual(a.boxes, b.boxes);
});

test("the character body walks up a ramp and can't climb the cliff beside it; a deck carries it over water", () => {
  const t = randomTerrain(3, 24, 24, { water: false, ramps: 0 });
  // A clean slope: the north half one step up, a ramp in the middle.
  t.batch(() => { for (let j = 0; j < 24; j += 1) for (let i = 0; i < 24; i += 1) { t.setHeight(i, j, j >= 12 ? 1 : 0); t.setType(i, j, "grass"); } });
  t.setRamp(12, 11, 0);
  const { boxes, wedges } = terrainColliders(t);
  const run = (x: number): number => {
    const body = createCharacter({ boxes, wedges, waterY: -10, spawn: [x, 0.05, 16] });
    for (let s = 0; s < 240; s += 1) body.step(1 / 120, { move: [0, 1] });
    return body.pos[2];
  };
  const upRamp = run(12.5 * 2);
  const atCliff = run(5 * 2);
  assert.ok(upRamp > 25, `up the ramp: z ${upRamp.toFixed(2)}`);
  assert.ok(atCliff < 24, `stopped by the cliff: z ${atCliff.toFixed(2)}`);
  // A deck across a pond.
  const w = createTerrain({ width: 20, depth: 8, chunk: 32 });
  w.batch(() => { for (let j = 0; j < 8; j += 1) for (let i = 0; i < 20; i += 1) { w.setHeight(i, j, i >= 8 && i < 12 ? 0 : 2); w.setWater(i, j, i >= 8 && i < 12 ? 1 : null); } });
  const s = bridgeSpans(w, { regions: regions(buildPathGrid(w)).label }).find((x) => x.axis === 1 && x.from[1] === 4)!;
  applyBridge(w, s);
  const cols = chunkColliders(w, 0);
  assert.ok(cols.boxes.some((b) => b.mat === "deck"));
});
