// Themes: the same seed gives the same bytes and the same pixels; 1,000 seeds
// give 1,000 different themes (measured); every generated theme's text reads
// on its panels (WCAG contrast); pins pin only what they pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CULTURES, contrast, createUi, cultureOf, decodeTheme, encodeTheme, generateHud, generateTheme, hashBitmap, labDistance, themeFeatures, themeOf,
} from "../src/index.ts";
import type { Theme } from "../src/index.ts";

const strip = (t: Theme) => JSON.stringify({ ...t, recipe: undefined });

test("determinism: the same seed and culture give identical theme bytes, theme and HUD pixels (layer and atlas)", () => {
  for (const culture of CULTURES) {
    const a = generateTheme({ seed: "race-42", culture }), b = generateTheme({ seed: "race-42", culture });
    assert.deepEqual(encodeTheme(a), encodeTheme(b));
    assert.equal(strip(a), strip(b));
  }
  const draw = () => {
    const hud = generateHud({ seed: 99, culture: "arcane" });
    const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
    ui.load(hud.screen);
    ui.render();
    return [hashBitmap(ui.layer), hashBitmap(ui.atlas.page)];
  };
  assert.deepEqual(draw(), draw(), "same layer and atlas pixels");
});

test("a theme is a tiny codec record: its recipe round-trips to the same theme", () => {
  const t = generateTheme({ seed: 123456, culture: "crystalline", pins: { accentHue: 300, corner: "notched", font: { serif: "slab" }, teamHues: [10, 200] } });
  const bytes = encodeTheme(t);
  assert.ok(bytes.length < 64, `${bytes.length} bytes`);
  const back = decodeTheme(bytes);
  assert.equal(strip(back), strip(t));
  assert.equal(back.key, t.key);
  const plain = encodeTheme(generateTheme({ seed: 7, culture: "clean" }));
  // (Most of which is the generator's id, "keel/ui/theme@1", as text.)
  assert.ok(plain.length <= 32, `an unpinned theme is ${plain.length} bytes`);
  console.log(`theme record: ${plain.length} bytes unpinned, ${bytes.length} with five pins`);
});

test("distinctness: 1,000 seeds per culture -- signatures unique, nearest neighbours apart", () => {
  const report: string[] = [];
  for (const culture of CULTURES) {
    const themes = Array.from({ length: 1000 }, (_, i) => generateTheme({ seed: i, culture }));
    // A signature: surface and accent hue in 10° buckets, corner, border, fill, screen, font width/x-height/round/serif, motion, body size.
    const sig = (t: Theme) => [Math.floor(t.palette.hues.surface / 10), Math.floor(t.palette.hues.accent / 10), t.frame.corner, t.frame.border, t.frame.fill, t.frame.screen,
      t.frame.bevel, t.frame.inner, t.frame.shadow, t.frame.rivets, t.frame.radius, Math.round(t.type.font.width * 20), Math.round(t.type.font.xHeight * 20), t.type.font.round, t.type.font.serif,
      Math.round(t.type.font.stroke * 50), t.motion.kind, t.type.body, t.type.caps, t.palette.tone].join("|");
    const unique = new Set(themes.map(sig)).size;
    // Continuous: the nearest other theme, in feature space plus the panel and accent colours' OKLab distance.
    const feats = themes.map(themeFeatures);
    let minNN = Infinity, sumNN = 0;
    for (let i = 0; i < themes.length; i += 1) {
      let nn = Infinity;
      for (let j = 0; j < themes.length; j += 1) {
        if (i === j) continue;
        let d = 0;
        for (let k = 0; k < feats[i]!.length; k += 1) d += (feats[i]![k]! - feats[j]![k]!) ** 2;
        if (d < nn) nn = d;
      }
      const s = Math.sqrt(nn);
      minNN = Math.min(minNN, s); sumNN += s;
    }
    const colourPairs = themes.slice(0, 200).map((t, i) => labDistance(t.palette.surface[2]!, themes[(i + 1) % 200]!.palette.surface[2]!) + labDistance(t.palette.accent[2]!, themes[(i + 1) % 200]!.palette.accent[2]!));
    report.push(`${culture}: ${unique}/1000 unique signatures, nearest-neighbour distance min ${minNN.toFixed(3)} mean ${(sumNN / 1000).toFixed(3)}, neighbour colour ΔE(OKLab) mean ${(colourPairs.reduce((a, b) => a + b, 0) / 200).toFixed(3)}`);
    assert.ok(unique >= 990, `${culture}: ${unique} unique signatures`);
    assert.ok(minNN > 0, `${culture}: two themes identical in feature space`);
  }
  console.log(report.join("\n"));
});

test("contrast: text reads on every panel surface in 6,000 generated themes (ink ≥ 4.5:1, dim ≥ 4.5:1, primary labels ≥ 3:1)", () => {
  let worstInk = 21, worstDim = 21, worstAccent = 21;
  for (const culture of CULTURES) for (let i = 0; i < 1000; i += 1) {
    const t = generateTheme({ seed: i * 7919, culture });
    const s = t.palette.surface;
    for (const bg of [s[1]!, s[2]!, s[3]!]) {
      worstInk = Math.min(worstInk, contrast(t.palette.ink[1]!, bg));
      worstDim = Math.min(worstDim, contrast(t.palette.ink[0]!, bg));
    }
    worstAccent = Math.min(worstAccent, contrast(t.palette.onAccent, t.palette.accent[1]!));
  }
  console.log(`worst ink ${worstInk.toFixed(2)}:1, worst dim ${worstDim.toFixed(2)}:1, worst primary-button label ${worstAccent.toFixed(2)}:1`);
  assert.ok(worstInk >= 4.5, `ink ${worstInk}`);
  assert.ok(worstDim >= 4.5, `dim ${worstDim}`);
  assert.ok(worstAccent >= 3, `label on accent ${worstAccent}`);
});

test("pins change what they pin and nothing else; flavours map to cultures", () => {
  const base = generateTheme({ seed: 5, culture: "industrial" });
  const pinned = generateTheme({ seed: 5, culture: "industrial", pins: { corner: "glow" } });
  assert.equal(pinned.frame.corner, "glow");
  assert.equal(pinned.palette.hues.surface, base.palette.hues.surface);
  assert.deepEqual(pinned.type, base.type);
  assert.equal(pinned.motion.kind, base.motion.kind);
  const hue = generateTheme({ seed: 5, culture: "industrial", pins: { hue: 120 } });
  assert.equal(hue.palette.hues.surface, 120);
  assert.deepEqual(hue.frame, base.frame);
  assert.equal(cultureOf("Machine"), "industrial");
  assert.equal(cultureOf("biotic"), "organic");
  assert.equal(cultureOf("Resonant"), "arcane");
  assert.throws(() => themeOf({ generator: "keel/ui/theme@1", seed: "1", culture: "nope" as never, pins: {} }), /isn't a culture/);
});
