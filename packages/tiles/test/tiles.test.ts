// The tile systems agree with keel/terrain's masks, the grid's membership
// layers materials, painted atlases tile seamlessly, and sheets cut right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BLOB47 as TERRAIN_BLOB47, blobIndex as terrainBlob, cardinalIndex as terrainCardinal } from "../../terrain/src/autotile.ts";
import { a2Quarter as terrainA2, wangIndex as terrainWang } from "../../terrain/src/tileset.ts";
import { BLOB47, SYSTEM_TILES, a2Quarter, blobIndex, cardinalIndex, createTileGrid, dualIndex, importTileAtlas, paintTileAtlas, tileNeighbourhood, wangIndex } from "../src/index.ts";
import type { AtlasSystem, TileAtlas } from "../src/index.ts";

test("blob47, wang16 and cardinal16 match keel/terrain for every mask", () => {
  assert.deepEqual(BLOB47, TERRAIN_BLOB47);
  assert.equal(BLOB47.length, 47);
  for (let m = 0; m < 256; m += 1) {
    assert.equal(blobIndex(m), terrainBlob(m));
    assert.equal(cardinalIndex(m), terrainCardinal(m));
    assert.equal(wangIndex(m), terrainWang(m));
  }
});

test("the A2 quarter pieces are keel/terrain's", () => {
  for (let q = 0; q < 4; q += 1) for (let k = 0; k < 8; k += 1) assert.deepEqual(a2Quarter(q, (k & 1) !== 0, (k & 2) !== 0, (k & 4) !== 0), terrainA2(q, (k & 1) !== 0, (k & 2) !== 0, (k & 4) !== 0));
});

test("a higher material counts as every lower one; tiles read the layer", () => {
  const g = createTileGrid({ width: 5, depth: 5, materials: ["sand", "dirt", "grass"] });
  g.set(2, 2, "grass");
  g.set(2, 3, "dirt");
  assert.equal(g.has(2, 2, 1), true, "grass is over dirt");
  assert.equal(g.has(2, 3, 2), false, "dirt is not grass");
  // Dirt's mask round (2,2): only north (the dirt) and the grass cell itself are dirt-or-above.
  assert.equal(g.mask(2, 2, 1), 1);
  assert.equal(g.tile("cardinal16", 2, 2, 1), 1);
  assert.equal(g.tile("blob47", 2, 2, 2), 0, "a lone grass cell is the island tile");
  // Off the grid reads the edge cell, so a filled grid is all centre tiles.
  g.fill("grass");
  assert.equal(g.tile("blob47", 0, 0, 2), 46);
  assert.equal(g.tile("dual16", 0, 0, 2), 15);
  assert.equal(dualIndex(true, false, false, false), 1);
  const v = g.version;
  g.set(1, 1, "grass");
  assert.equal(g.version, v, "an unchanged cell bumps nothing");
});

test("a tile's neighbourhood gives back its own index", () => {
  for (const system of ["blob47", "wang16", "cardinal16"] as const) {
    for (let i = 0; i < SYSTEM_TILES[system].count; i += 1) {
      const nb = tileNeighbourhood(system, i);
      assert.equal(nb[4], true);
      const g = createTileGrid({ width: 3, depth: 3, materials: ["off", "on"] });
      nb.forEach((on, k) => { if (on) g.set(k % 3, 2 - Math.floor(k / 3), "on"); });
      // (Outside the 3 x 3 the grid repeats its edge, which never changes the centre's mask.)
      assert.equal(g.tile(system, 1, 1, 1), i, `${system} ${String(i)}`);
    }
  }
});

function texel(a: TileAtlas, index: number, x: number, y: number): number {
  const ox = (index % a.cols) * a.tile, oy = Math.floor(index / a.cols) * a.tile;
  return a.rgba[((oy + y) * a.width + ox + x) * 4 + 3]!;
}

test("painted atlases meet texel for texel wherever two tiles share an edge", () => {
  for (const system of ["blob47", "wang16", "cardinal16", "dual16"] as AtlasSystem[]) {
    const a = paintTileAtlas(system, { tile: 12, seed: 7 });
    assert.equal(a.width, SYSTEM_TILES[system].cols * 12);
    const count = SYSTEM_TILES[system].count;
    // The full tile is all in; the empty one (where a system has it) all out.
    const full = system === "blob47" ? 46 : 15;
    for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) assert.equal(texel(a, full, x, y), 255);
    // Any tile whose east side is fully in matches a full tile's west column there, and so on.
    for (let i = 0; i < count; i += 1) {
      const nb = tileNeighbourhood(system, i);
      if (system !== "dual16" && nb[3] && nb[5] && nb[2] && nb[8]) {
        for (let y = 0; y < 12; y += 1) assert.equal(texel(a, i, 11, y), 255, `${system} ${String(i)} east column`);
      }
    }
  }
});

test("painting is deterministic per seed", () => {
  const digest = (a: TileAtlas): string => createHash("sha256").update(a.rgba).digest("hex");
  assert.equal(digest(paintTileAtlas("blob47", { seed: 3 })), digest(paintTileAtlas("blob47", { seed: 3 })));
  assert.notEqual(digest(paintTileAtlas("blob47", { seed: 3 })), digest(paintTileAtlas("blob47", { seed: 4 })));
});

test("sheets cut in index order, by a custom order, and A2 blocks compose 47 tiles", () => {
  const T = 4;
  const sheet = (cols: number, rows: number): { width: number; height: number; rgba: Uint8Array } => {
    const width = cols * T, height = rows * T, rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      rgba[o] = Math.floor(x / T) + Math.floor(y / T) * cols; rgba[o + 3] = 255;
    }
    return { width, height, rgba };
  };
  const w = importTileAtlas(sheet(4, 4), { layout: "wang16", tile: T });
  assert.equal(w.rgba[(T * w.width + 0) * 4], 4, "tile 4 starts row 1");
  const reversed = importTileAtlas(sheet(4, 4), { layout: "wang16", tile: T, order: Array.from({ length: 16 }, (_, i) => 15 - i) });
  assert.equal(reversed.rgba[0], 15);
  const a2 = importTileAtlas(sheet(2, 3), { layout: "rpgmaker-a2", tile: T });
  assert.equal(a2.system, "blob47");
  assert.equal(a2.width, 8 * T);
  assert.equal(a2.height, 6 * T);
  assert.throws(() => importTileAtlas(sheet(1, 1), { layout: "blob47", tile: T }), /too small/u);
});
