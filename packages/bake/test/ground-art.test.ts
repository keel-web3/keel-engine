import assert from "node:assert/strict";
import test from "node:test";
import { groundArtPixels, GROUND_ART_SIZE, GROUND_ART_LAYERS } from "../src/ground-art.ts";

test("native ground art has a fixed budget, deterministic cover and distinct drawn materials", () => {
  const pixels = groundArtPixels(), size = GROUND_ART_SIZE ** 2;
  assert.equal(pixels.byteLength, 524288);
  assert.equal(pixels.byteLength, size * GROUND_ART_LAYERS * 2);
  assert.deepEqual(pixels, groundArtPixels());
  const cover: number[] = [];
  for (let layer = 0; layer < GROUND_ART_LAYERS; layer++) {
    const tones = new Set<number>(); let plants = 0, connected = 0;
    for (let y = 0; y < GROUND_ART_SIZE; y++) for (let x = 0; x < GROUND_ART_SIZE; x++) {
      const i = (layer * size + y * GROUND_ART_SIZE + x) * 2;
      tones.add(pixels[i]!); plants += pixels[i + 1]! / 255;
      if (pixels[i]! > 135 && pixels[(layer * size + y * GROUND_ART_SIZE + (x + 1) % GROUND_ART_SIZE) * 2]! > 135) connected++;
    }
    assert.ok(tones.size >= 10, "shapes include shadows, faces and lit edges");
    assert.ok(connected > 100, "highlights are connected drawn shapes, not independent speckles");
    cover.push(plants / size);
  }
  assert.ok(cover[0]! > .97, "maintained turf remains covered");
  assert.ok(cover[1]! < .96 && cover[1]! > .7, "rough turf has small exposed soil seams");
  assert.equal(cover[2], 0); assert.equal(cover[3], 0);
  assert.notDeepEqual(pixels.slice(size * 4, size * 6), pixels.slice(size * 6));
});
