// Sprites paint the same from the same seed and stay inside their cells,
// cards and blades carry the sway weights, and scatter is even and seeded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FLORA_KINDS, bladeClump, crossCards, paintFoliageAtlas, pickWeighted, scatter, spriteCell } from "../src/index.ts";

test("every kind paints something, rooted at the ground line, deterministically", () => {
  const a = paintFoliageAtlas({ seed: 5, variants: 3 });
  const b = paintFoliageAtlas({ seed: 5, variants: 3 });
  assert.equal(createHash("sha256").update(a.rgba).digest("hex"), createHash("sha256").update(b.rgba).digest("hex"));
  assert.notEqual(createHash("sha256").update(a.rgba).digest("hex"), createHash("sha256").update(paintFoliageAtlas({ seed: 6, variants: 3 }).rgba).digest("hex"));
  const [w, h] = a.cell;
  for (const kind of FLORA_KINDS) {
    for (let v = 0; v < 3; v += 1) {
      const cell = spriteCell(a, kind, v);
      const ox = (cell % a.cols) * w, oy = Math.floor(cell / a.cols) * h;
      let drawn = 0, ground = 0;
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const o = ((oy + y) * a.width + ox + x) * 4;
        if (a.rgba[o + 3] === 255) { drawn += 1; if (y <= 1) ground += 1; }
        if (a.rgba[o + 3] === 0) assert.equal(a.rgba[o], 0);
      }
      assert.ok(drawn > 6, `${kind} ${String(v)} draws`);
      assert.ok(ground > 0, `${kind} ${String(v)} touches the ground`);
    }
  }
  assert.equal(spriteCell(a, "grass", 4), spriteCell(a, "grass", 1), "variants wrap");
  assert.throws(() => paintFoliageAtlas({ kinds: ["moss" as never] }), /Unknown/u);
});

test("crossed cards: planes through the root, sway 0 there and 1 at the tip", () => {
  for (const planes of [1, 2, 3, 4] as const) {
    const g = crossCards(planes, { rows: 2 });
    const card = g.attributes.aCard!.array as Float32Array;
    const pos = g.attributes.position!.array as Float32Array;
    assert.equal(pos.length / 3, planes * 3 * 2);
    for (let i = 0; i < pos.length / 3; i += 1) {
      assert.ok(Math.abs(card[i * 3 + 2]! - card[i * 3 + 1]! ** 2) < 1e-6);
      if (card[i * 3 + 1] === 0) assert.equal(pos[i * 3 + 1], 0);
    }
  }
  const blades = bladeClump({ blades: 5, segments: 2 });
  assert.equal(blades.attributes.position!.count, 5 * 3 * 2);
});

test("scatter is seeded, even, thinned by density and capped", () => {
  const spec = { bounds: [0, 0, 10, 10] as const, spacing: 1, seed: 9 };
  const a = scatter(spec);
  assert.deepEqual(a, scatter(spec));
  assert.equal(a.length, 100);
  for (const p of a) assert.ok(p.x >= 0 && p.x <= 10 && p.z >= 0 && p.z <= 10);
  const half = scatter({ ...spec, density: (x) => (x < 5 ? 1 : 0) });
  assert.ok(half.every((p) => p.x < 5.5));
  assert.equal(scatter({ ...spec, limit: 7 }).length, 7);
  assert.equal(pickWeighted({ a: 1, b: 3 }, 0.1), "a");
  assert.equal(pickWeighted({ a: 1, b: 3 }, 0.9), "b");
  assert.equal(pickWeighted({}, 0.5), null);
});
