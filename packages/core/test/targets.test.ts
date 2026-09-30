import { test } from "node:test";
import assert from "node:assert/strict";
import { TARGET_PROFILES, targetProfile, adaptTargetPalette, reduceColours, rgb555, fromRgb555 } from "../src/targets.ts";

test("era choices and hardware targets are separate, immutable profiles", () => {
  for (const bits of [8, 16, 32, 64] as const) {
    assert.equal(targetProfile(bits), TARGET_PROFILES[`${bits}-bit`]);
    assert.equal(targetProfile(bits).kind, "style");
  }
  assert.equal(targetProfile("chromatic").hardware, "game-boy-color");
  assert.deepEqual([targetProfile("chromatic").width, targetProfile("chromatic").height], [160, 144]);
  assert.ok(Object.isFrozen(TARGET_PROFILES));
  assert.ok(Object.isFrozen(targetProfile(8)));
  assert.throws(() => targetProfile("128-bit" as never), /Unknown target/);
});

test("target palettes bound unique colours, keep index positions and leave the source intact", () => {
  const colours = Array.from({ length: 1000 }, (_, i): [number, number, number] => [i % 256, (i * 23) % 256, (i * 71) % 256]);
  const before = structuredClone(colours);
  for (const target of [8, 16, 32, 64, "game-boy", "chromatic"] as const) {
    const out = adaptTargetPalette(colours, target);
    assert.equal(out.length, colours.length);
    assert.ok(new Set(out.map(String)).size <= targetProfile(target).paletteLimit);
    assert.deepEqual(out, adaptTargetPalette(colours, target));
    if (target === "game-boy") for (const [r, g, b] of out) { assert.equal(r, g); assert.equal(g, b); assert.ok([0, 85, 170, 255].includes(r)); }
    if (target === "chromatic" || target === 16 || target === 32) for (const c of out) assert.deepEqual(fromRgb555(rgb555(c)), c);
  }
  assert.deepEqual(colours, before);
  assert.deepEqual(adaptTargetPalette(colours, "native"), colours);
});

test("RGB555 has the native little-endian channel order and round-trips every word", () => {
  assert.equal(rgb555([255, 0, 0]), 0x001f);
  assert.equal(rgb555([0, 255, 0]), 0x03e0);
  assert.equal(rgb555([0, 0, 255]), 0x7c00);
  for (let i = 0; i < 32768; i += 1) assert.equal(rgb555(fromRgb555(i)), i);
});

test("palette reduction is deterministic, bounded and uses source colours", () => {
  const input: [number, number, number][] = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 0, 255], [0, 255, 0]];
  const out = reduceColours(input, 3);
  assert.equal(out.length, 3);
  for (const c of out) assert.ok(input.some((s) => String(s) === String(c)));
  assert.deepEqual(out, reduceColours([...input].reverse(), 3));
  assert.deepEqual(reduceColours([], 4), []);
  assert.throws(() => reduceColours(input, 0), RangeError);
});
