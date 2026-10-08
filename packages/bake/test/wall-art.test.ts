import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { wallArtPixels, WALL_ART_WIDTH, WALL_ART_HEIGHT, WALL_ART_LAYERS } from "../src/wall-art.ts";

test("native wall art is deterministic, bounded, and distinguishes maintenance from rooted growth", () => {
  const a = wallArtPixels(), b = wallArtPixels(), size = WALL_ART_WIDTH * WALL_ART_HEIGHT;
  assert.equal(a.length, size * WALL_ART_LAYERS * 2);
  assert.deepEqual(a, b);
  const coverage: number[] = [];
  for (let layer = 0; layer < WALL_ART_LAYERS; layer++) {
    let leaves = 0, roots = 0; const tones = new Set<number>();
    for (let i = 0; i < size; i++) {
      const offset = (layer * size + i) * 2; tones.add(a[offset]!);
      if (a[offset + 1]) { leaves++; if (i >= size - WALL_ART_WIDTH * 2) roots++; }
    }
    assert.ok(tones.size > 5, "dithered concrete and drawn shapes have real tonal range");
    coverage.push(leaves / size);
    if (layer < 2) assert.equal(leaves, 0, "maintained/cracked walls do not grow random ivy");
    else assert.ok(roots > 5, "climbing plants emerge through the base");
  }
  assert.ok(coverage[2]! > .03 && coverage[2]! < .4);
  assert.ok(coverage[3]! > coverage[2]! * 1.5 && coverage[3]! < .8);
  assert.notEqual(createHash("sha256").update(a.slice(0, size * 2)).digest("hex"), createHash("sha256").update(a.slice(size * 2, size * 4)).digest("hex"));
});
