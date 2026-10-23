import assert from "node:assert/strict";
import test from "node:test";
import { ditherRgba } from "../src/styles.ts";
import { createDefaultPinballBiome, ReactiveFoliage } from "../src/themes.ts";
import type { PinballViewBiome, PinballViewSnapshot } from "../src/types.ts";

test("Bayer dithering is colored quantization with a stable pattern and untouched alpha", () => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) pixels.set([120, 200, 60, 127], i * 4);
  const copy = pixels.slice();
  ditherRgba(pixels, 4, 4); ditherRgba(copy, 4, 4);
  assert.deepEqual(pixels, copy);
  assert.ok(new Set(Array.from({ length: 16 }, (_, i) => pixels[i * 4])).size > 1);
  for (let i = 0; i < 16; i++) {
    assert.equal(pixels[i * 4 + 3], 127);
    for (let channel = 0; channel < 3; channel++) assert.equal(pixels[i * 4 + channel]! % 51, 0);
    assert.notEqual(pixels[i * 4], pixels[i * 4 + 1]);
  }
});

test("cosmetic seed generates deterministic bounded, distinct biome grammars", () => {
  const signatures = new Set<string>();
  for (const theme of ["nightshift", "cyberpunk", "vaporwave", "gold", "nature"] as const) {
    const a = createDefaultPinballBiome(theme, 42, 600, 1000, "high");
    assert.deepEqual(a, createDefaultPinballBiome(theme, 42, 600, 1000, "high"));
    assert.ok(a.ornaments.length <= 64);
    signatures.add(a.ornaments.map(item => item.kind).join(","));
  }
  assert.equal(signatures.size, 5);
});

test("leaf springs react to nearby canonical motion, recover, and never alter physics", () => {
  const biome: PinballViewBiome = Object.freeze({ schema: "keel-pinball-biome@1", theme: "nature", seed: 0, ornaments: Object.freeze([Object.freeze({ id: "leaf", kind: "leaf", x: 80, y: 200, size: 20, rotation: 0, phase: 0 })]) });
  const snapshot: PinballViewSnapshot = Object.freeze({ tick: 1, balls: Object.freeze([Object.freeze({ id: "ball", x: 74, y: 200, vx: 17, radius: 9, active: true })]), flippers: Object.freeze([]) });
  const foliage = new ReactiveFoliage(biome, "high");
  for (let i = 0; i < 100; i++) foliage.advance(snapshot, i * 16, 16, false);
  assert.ok(Math.abs(foliage.leaves[0]!.angle) > 0.3);
  assert.ok(Math.abs(foliage.leaves[0]!.x) > 1);
  for (let i = 0; i < 200; i++) foliage.advance({ ...snapshot, balls: [] }, 1600 + i * 16, 16, false);
  assert.ok(Math.abs(foliage.leaves[0]!.angle) < 0.08);
  assert.ok(Math.abs(foliage.leaves[0]!.x) < 0.1);
  assert.equal(snapshot.balls[0]!.x, 74);
  foliage.reset(); foliage.advance(snapshot, 1000, 50, true);
  assert.equal(foliage.leaves[0]!.angle, 0);
  assert.equal(foliage.leaves[0]!.x, 0);
});
