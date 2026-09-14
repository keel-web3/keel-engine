import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOTILE_RULES, BLOB47, autoTile, blobIndex, cardinalIndex, createTerrain, reduceBlob } from "../src/index.ts";
import { randomTerrain } from "./helpers.ts";

test("the blob set has 47 variants, and a corner counts only with both edges beside it", () => {
  assert.equal(BLOB47.length, 47);
  assert.equal(blobIndex(0), 0);
  assert.equal(blobIndex(255), 46);
  // A lone corner (NE) is no different from nothing.
  assert.equal(reduceBlob(0b10), 0);
  assert.equal(blobIndex(0b10), blobIndex(0));
  // NE with N and E: kept.
  assert.equal(reduceBlob(0b111), 0b111);
  // Every raw mask maps into the set, and every variant is reached.
  const seen = new Set<number>();
  for (let m = 0; m < 256; m += 1) { const i = blobIndex(m); assert.ok(i >= 0 && i < 47); seen.add(i); }
  assert.equal(seen.size, 47);
  // Rotating a mask by 90 degrees (two dir8 steps) rotates its reduced form the same way.
  const rot = (m: number): number => ((m << 2) | (m >>> 6)) & 255;
  for (let m = 0; m < 256; m += 1) assert.equal(reduceBlob(rot(m)), rot(reduceBlob(m)));
  assert.deepEqual([0, 1, 4, 5, 16, 64, 85].map(cardinalIndex), [0, 1, 2, 3, 4, 8, 15]);
});

test("shores, foam and deep edges fall where land meets water", () => {
  const t = createTerrain({ width: 12, depth: 10, chunk: 8, fill: "sand", level: 2 });
  // A pond: 4 x 3 tiles, shallow round a deep middle.
  for (let j = 3; j < 6; j += 1) for (let i = 4; i < 8; i += 1) { t.setHeight(i, j, 1); t.setWater(i, j, 2); }
  t.setHeight(5, 4, 0); t.setHeight(6, 4, 0);
  const a = autoTile(t);
  // Every land tile touching the pond (8 ways) has a shore mask; every other land tile none.
  for (let j = 0; j < 10; j += 1) for (let i = 0; i < 12; i += 1) {
    const wet = t.waterDepth(i, j) > 0;
    const shore = a.at(i, j, "shore");
    let touches = false;
    for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) if ((di || dj) && t.inside(i + di, j + dj) && t.waterDepth(i + di, j + dj) > 0) touches = true;
    if (wet) { assert.equal(shore.applies, false); assert.equal(a.at(i, j, "foam").applies, true); }
    else assert.equal(shore.mask !== 0, touches, `shore at ${i},${j}`);
  }
  // The pond's edge tiles have foam toward the land; the middle ones don't touch land.
  assert.notEqual(a.at(4, 3, "foam").mask, 0);
  assert.equal(a.at(5, 4, "foam").mask, 0);
  // The deep tiles see shallow round them.
  assert.equal(a.at(5, 4, "deep").applies, true);
  assert.notEqual(a.at(5, 4, "deep").mask, 0);
  assert.equal(a.at(4, 4, "deep").applies, false);
});

test("the overlay is the highest-priority neighbour at the tile's level, and only its tiles are in the mask", () => {
  const t = createTerrain({ width: 5, depth: 5, chunk: 8, fill: "dirt" });
  t.setType(2, 3, "grass"); // (north of the middle)
  t.setType(3, 2, "rock"); // (east: rock outranks grass)
  const a = autoTile(t);
  const mid = t.index(2, 2);
  assert.equal(a.overlay[mid], t.types.id("rock"));
  assert.equal(a.at(2, 2, "overlay").mask, 1 << 2); // (east only)
  // A higher tile doesn't overlay across the cliff.
  t.setHeight(3, 2, 1);
  const b = autoTile(t);
  assert.equal(b.overlay[mid], t.types.id("grass"));
  assert.equal(b.at(2, 2, "overlay").mask, 1 << 0);
  // Grass itself (outranked by nothing round it at its level) has no overlay.
  assert.equal(b.overlay[t.index(2, 3)], 255);
});

test("roads join by cardinal masks, bridges count as road, paths join roads", () => {
  const t = createTerrain({ width: 7, depth: 5, chunk: 8, fill: "grass" });
  for (let i = 1; i < 6; i += 1) t.setType(i, 2, "road");
  t.setType(3, 3, "path"); t.setType(3, 4, "path");
  t.setHeight(5, 2, 0);
  const a = autoTile(t);
  assert.equal(a.at(1, 2, "road").index, cardinalIndex(1 << 2)); // (east only)
  assert.equal(a.at(3, 2, "road").index, cardinalIndex((1 << 2) | (1 << 6)));
  assert.equal(a.at(3, 3, "path").index, cardinalIndex((1 << 0) | (1 << 4))); // (the path north to its kin, south to the road)
  // A deck tile beside a road counts as road.
  t.setType(6, 2, "grass"); t.setDeck(6, 2, 0, 1);
  const b = autoTile(t);
  assert.notEqual(b.at(5, 2, "road").mask & (1 << 2), 0);
});

test("auto-tiling a rectangle equals auto-tiling everything, there", () => {
  const t = randomTerrain(11);
  const all = autoTile(t);
  const part = autoTile(t, { rect: [8, 6, 30, 25] });
  for (let r = 0; r < AUTOTILE_RULES.length; r += 1) for (let j = 6; j < 25; j += 1) for (let i = 8; i < 30; i += 1) {
    assert.equal(part.masks[r]![t.index(i, j)], all.masks[r]![t.index(i, j)]);
  }
  // A custom table: rules are data.
  const own = autoTile(t, { rules: [{ name: "snowline", shape: "blob47", self: ["grass"], other: ["snow"] }] });
  assert.equal(own.rules.length, 1);
  assert.equal(own.rule("snowline"), 0);
});
