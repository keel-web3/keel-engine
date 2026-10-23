// Depth-and-material dithering: roles by rule, varied by seed, set by overrides,
// and a quantizer that is the core quantizer exactly when a role is a plain screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPTH_BANDS, DEPTH_STYLES, MATERIAL_FAMILIES, createDepthQuantizer, familyOfMaterial, planDepthDither } from "../src/depth-dither.ts";
import { SCREENS, SCREEN_IDS } from "../src/dither.ts";
import { createQuantizer, lumsOf, makeBuf, rampsOf } from "../src/quantize.ts";
import { buildPalette, makePalette } from "../src/palette.ts";
import { createRoll, stream } from "../src/rng.ts";

const every = (plan: ReturnType<typeof planDepthDither>) => {
  for (const band of DEPTH_BANDS) for (const family of MATERIAL_FAMILIES) for (const side of ["lit", "shade", "edge"] as const) plan.index({ band, family, side });
  return plan.describe();
};

test("a plan is a pure function of its spec, whatever order its roles are asked for in", () => {
  const a = planDepthDither({ seed: "scene-1" });
  const b = planDepthDither({ seed: "scene-1" });
  b.index({ band: "far", family: "fog", side: "shade" });
  b.index({ band: "near", family: "metal", side: "edge" });
  assert.deepEqual(every(a), every(b));
});

test("roles follow their rules: far is fine and in flat fills, metal a step more, shade denser (or hatched on request), edge solid", () => {
  for (const seed of ["a", "b", "c", "d", "e", "f"]) {
    const p = planDepthDither({ seed, steps: { near: 7, mid: 6 } });
    const far = p.table[p.index({ band: "far", family: "sky" })]!;
    assert.ok(["bayer8", "stipple", "ign"].includes(far.id), far.id);
    assert.ok(far.flat > 0 && far.contrast === 1); // (far: calm flat fills, its tones as lit)
    assert.equal(far.steps, 5);
    const metal = p.table[p.index({ band: "near", family: "metal" })]!;
    assert.equal(metal.steps, 8);
    const lit = p.table[p.index({ band: "near", family: "wood" })]!;
    const shade = p.table[p.index({ band: "near", family: "wood", side: "shade" })]!;
    assert.equal(lit.id, shade.id); // (shade: the same pattern, denser -- no seam)
    assert.ok(shade.gamma > lit.gamma);
    const h = planDepthDither({ seed, shade: "hatch" });
    assert.notEqual(h.table[h.index({ band: "near", family: "wood" })]!.id, h.table[h.index({ band: "near", family: "wood", side: "shade" })]!.id);
    assert.equal(p.table[p.index({ band: "near", family: "cloth", side: "edge" })]!.solid, true);
    assert.equal(p.table[p.index({ band: "mid", family: "cloth", side: "edge" })]!.solid, false);
    for (const r of p.table) assert.ok(SCREENS[r.id], r.id);
  }
});

test("smooth things (plastic, ceramic, porcelain) never grain: an ordered screen on every band and seed, and a shade side as lit", () => {
  for (const m of ["plastic", "ceramic", "porcelain", "blackplastic"]) assert.equal(familyOfMaterial(m), "smooth", m);
  assert.equal(familyOfMaterial("rubber"), "organic");
  assert.equal(familyOfMaterial("marble"), "stone");
  for (let s = 0; s < 40; s += 1) {
    const p = planDepthDither({ seed: s });
    for (const band of DEPTH_BANDS) for (const side of ["lit", "shade", "edge"] as const) {
      const r = p.table[p.index({ band, family: "smooth", side })]!;
      assert.ok(["bayer8", "bayer4"].includes(r.id), `${band} ${side}: ${r.id}`);
    }
    const lit = p.table[p.index({ band: "near", family: "smooth" })]!;
    const shade = p.table[p.index({ band: "near", family: "smooth", side: "shade" })]!;
    assert.equal(shade.id, lit.id);
    assert.equal(shade.gamma, lit.gamma);
  }
});

test("a wall (mid stone, the room's biggest surface) is ordered, never halftone or blue noise", () => {
  for (let s = 0; s < 60; s += 1) {
    const p = planDepthDither({ seed: s });
    for (const side of ["lit", "shade"] as const) {
      const r = p.table[p.index({ band: "mid", family: "stone", side })]!;
      assert.ok(["bayer4", "bayer8"].includes(r.id), `seed ${s} ${side}: ${r.id}`);
    }
  }
});

test("seeds vary the picks inside each role; variety 0 always takes the first rule", () => {
  const ids = new Set<string>();
  for (let s = 0; s < 40; s += 1) ids.add(planDepthDither({ seed: s }).table[planDepthDither({ seed: s }).index({ band: "far", family: "sky" })]?.id ?? "");
  const seen = new Set<string>();
  for (let s = 0; s < 40; s += 1) { const p = planDepthDither({ seed: s }); seen.add(p.table[p.index({ band: "near", family: "wood" })]!.id); }
  assert.ok(seen.size >= 2, [...seen].join());
  const z = planDepthDither({ seed: 9, variety: 0 });
  assert.equal(z.table[z.index({ band: "near", family: "wood" })]!.id, "lines");
  void ids;
});

test("overrides apply in order: all, band, family, side, object, part", () => {
  const p = planDepthDither({
    seed: 1,
    overrides: { all: { id: "bayer4" }, bands: { near: { id: "bayer8" } }, families: { glass: { id: "ign" } }, sides: { shade: { id: "hatch" } }, objects: { 3: { id: "halftone" } }, parts: { "3/lid": { id: "checker", steps: 3 } } },
  });
  assert.equal(p.table[p.index({ band: "mid", family: "stone" })]!.id, "bayer4");
  assert.equal(p.table[p.index({ band: "near", family: "stone" })]!.id, "bayer8");
  assert.equal(p.table[p.index({ band: "near", family: "glass" })]!.id, "ign");
  assert.equal(p.table[p.index({ band: "near", family: "glass", side: "shade" })]!.id, "hatch");
  assert.equal(p.table[p.index({ band: "near", family: "glass", object: 3 })]!.id, "halftone");
  const lid = p.table[p.index({ band: "near", family: "glass", object: 3, part: "lid" })]!;
  assert.equal(lid.id, "checker");
  assert.equal(lid.steps, 3);
  // (An object no override names is its family's role: no new entry.)
  const n = p.table.length;
  p.index({ band: "near", family: "glass", object: 4, part: "x" });
  assert.equal(p.table.length, n);
});

test("materials map to families", () => {
  assert.equal(familyOfMaterial("brass"), "metal");
  assert.equal(familyOfMaterial("walnut"), "wood");
  assert.equal(familyOfMaterial("velvet"), "cloth");
  assert.equal(familyOfMaterial("ember"), "glow");
  assert.equal(familyOfMaterial("smoked"), "glass");
  assert.equal(familyOfMaterial("pumpkin"), "organic");
  assert.equal(familyOfMaterial("plastic", { glow: true }), "glow");
  for (const id of SCREEN_IDS) assert.ok(DEPTH_STYLES[id]);
});

test("a plain role quantizes exactly as the core quantizer", () => {
  const W = 24;
  const H = 16;
  const pal = buildPalette(makePalette(stream(createRoll("0x" + "ab".repeat(32)), 2)));
  const ramps = rampsOf(pal);
  const lums = lumsOf(pal.colours);
  const buf = makeBuf(W, H);
  for (let k = 0; k < W * H; k += 1) { buf.L[k] = (k * 37 % 101) / 90; buf.layer[k] = k % 5; buf.accent[k] = k % 7 === 0 ? 1 : k % 11 === 0 ? 2 | (6 << 2) : 0; buf.halo[k] = k % 13 === 0 ? 1 : 0; buf.cyc[k] = k % 17 === 0 ? 1 : 0; }
  const screen = { id: "bayer4" as const, steps: 6, bias: 1 };
  const core = createQuantizer({ width: W, height: H, screens: [screen, screen, screen, screen, screen], ramps, lums })(buf, null, undefined, 0.3);
  const plan = planDepthDither({ seed: 0, aerial: false, overrides: { all: { ...screen, contrast: 1, gamma: 1, phase: [0, 0] } } });
  const role = new Uint8Array(W * H).fill(plan.index({ band: "near", family: "stone" }));
  const mine = createDepthQuantizer({ width: W, height: H, ramps, lums, plan })(buf, null, undefined, 0.3, role);
  assert.deepEqual(Array.from(mine), Array.from(core));
});
