import { test } from "node:test";
import assert from "node:assert/strict";
import { BIG, CHARSET, SMALL, STYLE, checkDoc, decodeDecal, encodeDecal, fromGlyphs, imageTexels, rasterize, textDecal, toGlyphs, type DecalDoc } from "../src/index.ts";

const INKS = [{ light: 0.95, chroma: 0.02, hue: 90 }, { light: 0.2, chroma: 0.1, hue: 20 }, { light: 0.6, chroma: 0.25, hue: 30 }];

test("the alphabet: 64 codes, two complete fonts", () => {
  assert.equal([...CHARSET].length, 64);
  assert.equal(BIG.length, 64); assert.equal(SMALL.length, 64);
  assert.ok(BIG.every((g) => g.length === 7 && g.every((r) => r >= 0 && r < 32)));
  assert.ok(SMALL.every((g) => g.length === 5 && g.every((r) => r >= 0 && r < 8)));
  // Every printable glyph draws something (space and the line break don't).
  BIG.forEach((g, i) => { if (i !== 0 && i !== 63) assert.ok(g.some((r) => r), `big ${i} ${CHARSET[i]}`); });
  SMALL.forEach((g, i) => { if (i !== 0 && i !== 63) assert.ok(g.some((r) => r), `small ${i} ${CHARSET[i]}`); });
});

test("typed text converts into our alphabet", () => {
  const c = toGlyphs("Café Racer — “Nitro” ♡ 100% 🚀\nJosé's");
  assert.equal(c.text, "CAFE RACER - \"NITRO\" ♥ 100% \nJOSE'S");
  assert.deepEqual(c.dropped, ["\u{1F680}"]);
  assert.equal(fromGlyphs(toGlyphs("abc xyz 0-9").glyphs), "ABC XYZ 0-9");
});

test("docs round-trip, and invalid ones are refused like the contract refuses them", () => {
  const t = textDecal("HASHERS\nFUEL CO", { inks: INKS, style: STYLE.plate | STYLE.outline });
  assert.deepEqual(decodeDecal(t.bytes), { ...t.doc, inks: decodeDecal(t.bytes).inks });
  const img: DecalDoc = { kind: "image", inks: INKS.slice(0, 2), width: 5, height: 3, texels: Uint8Array.from([0, 1, 2, 1, 0, 1, 1, 1, 1, 1, 2, 0, 0, 0, 2]) };
  const b = encodeDecal(img);
  assert.equal(b.length, 4 + 1 + 1 + 1 + 6 + 2 + 8);
  assert.deepEqual(Array.from((decodeDecal(b) as { texels: Uint8Array }).texels), Array.from(img.texels));
  assert.match(checkDoc({ ...img, texels: img.texels.map((x) => (x === 2 ? 3 : x)) })!, /ink/);
  assert.match(checkDoc({ kind: "text", inks: INKS, font: 0, style: 0, glyphs: new Array(25).fill(1) })!, /24/);
  assert.match(checkDoc({ kind: "text", inks: INKS, font: 0, style: 0, glyphs: [1, 63, 1, 63, 1, 63, 1, 63, 1] })!, /lines/);
  const bad = b.slice(); bad[4] = 2; assert.throws(() => decodeDecal(bad), /version/);
  assert.throws(() => decodeDecal(b.slice(0, b.length - 1)));
});

test("rasterize: text in the font with plate and outline; images as they are", () => {
  const t = rasterize(textDecal("HI", { inks: INKS, style: STYLE.plate | STYLE.outline }).doc);
  assert.equal(t.width, 11 + 4); assert.equal(t.height, 7 + 4);
  const inkAt = (x: number, y: number): number => t.texels[(y * t.width + x) * 4]!;
  assert.equal(inkAt(2, 2), 1);          // H's top-left stroke
  assert.equal(inkAt(0, 0), 3);          // the plate
  assert.equal(inkAt(2, 1), 2);          // outline above the H
  const small = rasterize(textDecal("OK", { inks: INKS.slice(0, 1), font: 1 }).doc, { scale: 2 });
  assert.equal(small.height, 10);
  const px = imageTexels(Uint8Array.from([255, 255, 255, 255, 40, 10, 10, 255, 0, 0, 0, 0, 250, 250, 245, 255]), 2, 2, INKS.slice(0, 2));
  assert.deepEqual(Array.from(px.texels), [1, 2, 0, 1]);
});
