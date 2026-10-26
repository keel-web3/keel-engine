// The rulebook reads a sheet right, an exemplar keeps it, its seeds pass the
// gauntlet, and the bytes are the same everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BLOCK_RULES,
  SHEET_RULES,
  analyzeMaterialSheet,
  checkExemplar,
  decodeMaterialExemplar,
  distillMaterial,
  encodeMaterialExemplar,
  paintMaterialAtlas,
  planMaterial,
  resampleArea,
  resampleNearest,
  scoreMaterial,
} from "../src/index.ts";
import type { BlockEvidence, MaterialExemplar, Raster } from "../src/index.ts";

const NAMES = ["bark", "foliage", "autumn", "snow"];
const art = paintMaterialAtlas({ size: 384, pixels: 16, seed: 7 }).art;
// Pixel art scaled up 4x, and the same art painted (smoothed and resized off the grid).
const pixelSheet = resampleNearest(art, 384, 384);
const paintedSheet = resampleArea(resampleNearest(art, 768, 768), 400, 400);
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function distil(sheet: Raster): { exemplar: MaterialExemplar; analysis: ReturnType<typeof analyzeMaterialSheet>; distilled: ReturnType<typeof distillMaterial> } {
  const analysis = analyzeMaterialSheet(sheet);
  const distilled = distillMaterial(sheet, { names: NAMES, blocks: analysis.blocks, columns: analysis.columns, plan: analysis.plan });
  return { exemplar: distilled.exemplar, analysis, distilled };
}
const pixel = distil(pixelSheet);
const painted = distil(paintedSheet);

test("pixel art scaled up is read at its own resolution and kept exactly", () => {
  const { analysis, distilled, exemplar } = pixel;
  assert.equal(analysis.rule, "pixel-art-source");
  assert.deepEqual(analysis.blocks, { x: 2, y: 2 });
  assert.equal(analysis.columns, 6);
  assert.equal(analysis.plan.pixels, 16);
  assert.equal(analysis.plan.sample, "mode");
  for (const family of exemplar.families) {
    assert.equal(family.finish, undefined, "the artist's pixels need no finish");
    assert.deepEqual(family.layers.map((l) => l.kind), ["palette"], "no light layer");
  }
  assert.equal(distilled.fidelity.pass, true, JSON.stringify(distilled.fidelity.families.filter((f) => !f.pass)));
});

test("a painted sheet is split into albedo and light and finished as pixel art", () => {
  const { analysis, exemplar } = painted;
  assert.equal(analysis.rule, "painted-source");
  assert.equal(analysis.plan.sample, "mean");
  assert.ok(analysis.plan.pixels <= Math.floor(analysis.evidence.cellTexels / 1.5));
  for (const [b, block] of analysis.blockAnalyses.entries()) {
    assert.ok(block.rules.includes("separable-light"), `block ${b} fired ${block.rules}`);
    assert.ok(block.rules.includes("framed-cells") || block.rules.includes("open-texture") || block.rules.includes("staggered-plates"));
  }
  for (const family of exemplar.families) {
    assert.deepEqual(family.layers.map((l) => l.name), ["albedo", "light"]);
    assert.deepEqual(family.compose, [{ layer: "albedo", blend: "base" }, { layer: "light", blend: "multiply" }]);
    assert.equal(family.finish?.dither, "bayer4");
  }
  assert.ok(analysis.blockAnalyses[0]!.looksLike.includes("bark"));
  assert.ok(analysis.blockAnalyses[3]!.looksLike.includes("snow"));
});

test("every seed passes the gauntlet against the sheet", () => {
  for (const [sheet, { exemplar }] of [[pixelSheet, pixel], [paintedSheet, painted]] as const) {
    const layout = { blocks: exemplar.blocks, columns: exemplar.columns, pixels: exemplar.pixels, families: NAMES };
    for (const seed of [1, 2, 3]) {
      const score = scoreMaterial(sheet, paintMaterialAtlas({ exemplar, seed }).art, layout);
      assert.equal(score.pass, true, `seed ${seed}: ${JSON.stringify(score.families.filter((f) => !f.pass))}`);
    }
  }
});

test("variance 0 rebuilds the exemplar; seeds differ from it and from each other", () => {
  const { exemplar } = painted;
  const zero = paintMaterialAtlas({ exemplar, variance: 0 }), again = paintMaterialAtlas({ exemplar, variance: 0, seed: 9 });
  assert.equal(sha(zero.rgba), sha(again.rgba), "no moves at variance 0, whatever the seed");
  const one = paintMaterialAtlas({ exemplar, seed: 1 }), two = paintMaterialAtlas({ exemplar, seed: 2 });
  assert.notEqual(sha(one.rgba), sha(zero.rgba));
  assert.notEqual(sha(one.rgba), sha(two.rgba));
  assert.equal(sha(one.rgba), sha(paintMaterialAtlas({ exemplar, seed: 1 }).rgba), "a seed is the same every time");
});

test("the exemplar round-trips its bytes and carries no locator", () => {
  for (const { exemplar } of [pixel, painted]) {
    const bytes = encodeMaterialExemplar(exemplar);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "KMX2");
    const back = decodeMaterialExemplar(bytes);
    assert.equal(sha(encodeMaterialExemplar(back)), sha(bytes));
    assert.equal(sha(paintMaterialAtlas({ exemplar: back, seed: 3 }).rgba), sha(paintMaterialAtlas({ exemplar, seed: 3 }).rgba));
    const text = new TextDecoder("latin1").decode(bytes);
    assert.doesNotMatch(text, /https?:|ipfs:|ar:\/\/|web3:\/\/|keel-onchain:/);
  }
});

test("a broken exemplar is refused", () => {
  const { exemplar } = painted;
  const family = exemplar.families[0]!;
  assert.throws(() => checkExemplar({ ...exemplar, families: [{ ...family, compose: [{ layer: "light", blend: "multiply" }] }] }));
  assert.throws(() => checkExemplar({ ...exemplar, families: [{ ...family, recipe: [{ layer: "cells", layers: ["nope"] }] }] }));
  assert.throws(() => decodeMaterialExemplar(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
});

test("block edges a neighbour bled into are mended before cells move", () => {
  // A green block whose bottom texel row is the white of the block below.
  const w = 192, sheet: Raster = { width: w, height: w * 2, rgba: new Uint8Array(w * w * 2 * 4) };
  for (let y = 0; y < w * 2; y += 1) for (let x = 0; x < w; x += 1) {
    const top = y < w - 1, o = (y * w + x) * 4, rim = x % 32 < 2 || y % 32 < 2;
    sheet.rgba.set(top ? (rim ? [20, 40, 15] : [60 + (x % 7) * 6, 120 + (y % 5) * 8, 40]) : rim ? [150, 160, 180] : [235, 238, 245], o);
    sheet.rgba[o + 3] = 255;
  }
  const analysis = analyzeMaterialSheet(sheet, { blocks: { x: 1, y: 2 }, columns: 6 });
  const { exemplar } = distillMaterial(sheet, { names: ["leaves", "snow"], blocks: analysis.blocks, columns: 6, plan: analysis.plan });
  const atlas = paintMaterialAtlas({ exemplar, seed: 4 }).art, side = exemplar.columns * exemplar.pixels;
  for (let i = 0; i < side * side; i += 1) assert.ok(atlas.rgba[i * 4 + 2]! < 140, `a white texel at ${i % side},${Math.floor(i / side)}`);
});

test("the rulebook decides from evidence and says why", () => {
  const block = (e: Partial<BlockEvidence>): BlockEvidence => ({ staggeredGaps: 0, gaps: 0, rowLightRange: 0, hueSplit: 0, rimContrast: 0, lightStrength: 0, ...e });
  const sheet = { transparent: false, knee: undefined, cellTexels: 40 };
  const { plan, fired } = planMaterial(sheet, [
    block({ gaps: 12, staggeredGaps: 0.9, rowLightRange: 0.4, lightStrength: 0.2 }),
    block({ rimContrast: 0.5, hueSplit: 20, lightStrength: 0.2 }),
    block({ rimContrast: 0.1 }),
  ]);
  assert.equal(fired.sheet, "painted-source");
  assert.equal(plan.pixels, 24);
  assert.deepEqual(fired.blocks, [["separable-light", "staggered-plates", "banded-light"], ["separable-light", "framed-cells", "two-hues"], ["open-texture"]]);
  assert.deepEqual(plan.families[0]!.recipe, [{ layer: "strips", band: 1 }]);
  assert.ok(plan.families[1]!.albedoColours.every((c) => c >= 32), "two hues keep a ramp each");
  assert.deepEqual(plan.families[1]!.recipe, [{ layer: "cells", band: 1 }, { layer: "lean", share: 0.2, target: "albedo" }]);
  assert.deepEqual(plan.families[2]!.recipe.map((s) => s.layer), ["cells", "quilt"]);
  assert.equal(planMaterial({ ...sheet, transparent: true }, []).fired.sheet, "sprite-sheet");
  assert.equal(planMaterial({ ...sheet, knee: 16 }, []).plan.sample, "mode");
  for (const rule of [...SHEET_RULES, ...BLOCK_RULES]) for (const k of ["id", "when", "then", "why"] as const) assert.ok(rule[k].length > 3, `${rule.id} ${k}`);
  assert.equal(new Set([...SHEET_RULES, ...BLOCK_RULES].map((r) => r.id)).size, SHEET_RULES.length + BLOCK_RULES.length);
});

test("no exemplar: the procedural atlas is still painted by seed", () => {
  const a = paintMaterialAtlas({ seed: 5 }), b = paintMaterialAtlas({ seed: 5 });
  assert.equal(sha(a.rgba), sha(b.rgba));
  assert.deepEqual(a.families, NAMES);
});
