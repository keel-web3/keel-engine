import { test } from "node:test";
import assert from "node:assert/strict";
import { createPixelRenderer } from "../src/index.ts";
import type { RenderCanvas } from "../src/index.ts";
import { standIn } from "./gl-stand-in.ts";

test("switching profiles derives each palette from the source and restores the original", () => {
  const { canvas, calls } = standIn();
  const px = createPixelRenderer(canvas as unknown as RenderCanvas, { width: 192, height: 108 });
  const colours = Array.from({ length: 64 }, (_, i): [number, number, number] => [i * 4, i * 3, 255 - i * 4]);
  px.setPalette(colours, { sky: [0, 32], stone: [32, 32] });
  px.setStyle({ screen: "stipple", dither: 0.6 });
  px.setMaterials([{ ramp: "stone" }]);
  px.setWorld({ boxes: [{ c: [0, 1, 0], h: [1, 1, 1] }] });
  px.setFx([{ name: "scanlines" }]);
  const worldCalls = () => calls.filter(([name, args]) => name === "bufferSubData" && args[0] === "UNIFORM_BUFFER").length;
  const beforeWorldCalls = worldCalls();
  px.setProfile(8);
  assert.deepEqual([px.width, px.height], [256, 240]);
  assert.ok(new Set(px.palette.map(String)).size <= 16);
  assert.equal(px.ramp("stone"), 1);
  px.setProfile("chromatic");
  assert.deepEqual([px.width, px.height], [160, 144]);
  assert.throws(() => px.setTarget(320, 240), /requires 160/);
  const chromaticPalette = structuredClone(px.palette);
  px.setProfile(16);
  px.setProfile("chromatic");
  assert.deepEqual(px.palette, chromaticPalette, "switching never compounds quantization");
  assert.equal(worldCalls(), beforeWorldCalls, "the shared world is untouched");
  px.setProfile("native");
  assert.deepEqual([px.width, px.height], [192, 108]);
  assert.deepEqual(px.palette, colours);
  const drawAt = calls.length;
  px.render({ eye: [0, 2, -5], target: [0, 0, 0] });
  assert.ok(calls.slice(drawAt).some(([name, args]) => name === "uniform1f" && String(args[0]).endsWith(":uDither") && args[1] === 0.6));
  const count = calls.length;
  assert.throws(() => px.setProfile("bad" as never), /Unknown target/);
  assert.equal(px.profile.id, "native");
  assert.equal(calls.length, count, "invalid target does not mutate GL state");
});

test("constructor profiles and new authored palettes also use the target constraints", () => {
  const { canvas } = standIn();
  const px = createPixelRenderer(canvas as unknown as RenderCanvas, { profile: "game-boy" });
  assert.deepEqual([px.width, px.height], [160, 144]);
  px.setPalette([[127, 22, 234], [255, 12, 12]], { body: [0, 2] });
  for (const [r, g, b] of px.palette) { assert.equal(r, g); assert.equal(g, b); }
  px.setProfile("native");
  assert.deepEqual(px.palette, [[127, 22, 234], [255, 12, 12]]);
});
