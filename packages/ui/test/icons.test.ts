// Icons: every name in the grammar draws at 12, 16 and 20 px, deterministic,
// themed, with seeded variants; PNG and SVG imports come in crisp and
// palette-snapped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_NAMES, ICON_RECIPES, createBitmap, decodePng, encodePng, generateTheme, hashBitmap, iconBitmap, iconFromImage, iconFromSvg, iconMask, rgba, svgPath, themeColours } from "../src/index.ts";

test("every icon name draws at 12/16/20 px: ink inside an outline, deterministic", () => {
  const theme = generateTheme({ seed: 3, culture: "industrial" });
  assert.ok(ICON_NAMES.length >= 40, `${ICON_NAMES.length} names`);
  for (const name of ICON_NAMES) for (const size of [12, 16, 20]) {
    const b = iconBitmap(name, size, theme);
    assert.equal(b.w, size);
    const ink = b.px.filter((c) => c !== 0 && c !== theme.palette.outline).length;
    assert.ok(ink >= size, `${name}@${size}: ${ink} ink pixels`);
    assert.ok(b.px.includes(theme.palette.outline), `${name}@${size} has its outline`);
    assert.equal(hashBitmap(iconBitmap(name, size, theme)), hashBitmap(b), "deterministic");
  }
});

test("names with variants draw differently across seeds; styles differ; distinct names draw distinct shapes", () => {
  let varied = 0;
  for (const [name, r] of Object.entries(ICON_RECIPES)) {
    if (r.variants.length < 2) continue;
    const shapes = new Set(Array.from({ length: 12 }, (_, s) => iconMask(name, 16, s).join("")));
    if (shapes.size > 1) varied += 1;
  }
  assert.ok(varied >= 15, `${varied} names vary with the seed`);
  const masks = new Set(ICON_NAMES.map((n) => iconMask(n, 16, 0).join("")));
  assert.ok(masks.size >= ICON_NAMES.length - 3, `${masks.size} distinct shapes for ${ICON_NAMES.length} names`);
  const t = generateTheme({ seed: 3, culture: "clean" });
  const styles = new Set((["solid", "outline", "duotone"] as const).map((style) => hashBitmap(iconBitmap("attack", 16, t, { style, variant: 0 }))));
  assert.equal(styles.size, 3);
});

test("SVG import: shapes, fills and transforms drawn crisp and snapped to the theme", () => {
  const theme = generateTheme({ seed: 9, culture: "arcane" });
  const palette = themeColours(theme);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <rect x="2" y="2" width="20" height="20" fill="#223"/>
    <g transform="translate(12,12)"><circle cx="0" cy="0" r="6" fill="#e33"/></g>
    <path d="M4 20 L12 14 L20 20 Z" fill="rgb(40,200,90)"/>
  </svg>`;
  const b = iconFromSvg(svg, 16, { palette });
  assert.equal(b.w, 16);
  for (const c of b.px) assert.ok(c === 0 || palette.includes(c), "every pixel a palette colour");
  const centre = b.px[8 * 16 + 8]!, corner = b.px[3 * 16 + 3]!, bottom = b.px[12 * 16 + 8]!;
  assert.notEqual(centre, corner, "the circle is drawn over the square");
  assert.notEqual(bottom, corner, "the path's triangle too");
  assert.equal(b.px[0], 0, "outside the rect is empty");
  const withOutline = iconFromSvg(svg, 16, { palette, outline: theme.palette.outline });
  assert.equal(withOutline.w, 18);
  assert.deepEqual(svgPath("M0 0 H10 V10 H0 Z")[0], [0, 0, 10, 0, 10, 10, 0, 10], "H/V/Z path");
  assert.ok(svgPath("M0 0 C 5 0 10 5 10 10 S 5 20 0 10 Q 0 5 0 0 z")[0]!.length > 12, "curves flatten");
});

test("PNG import: a big picture boxed down to the icon size, alpha cut, snapped", () => {
  const big = createBitmap(64, 64);
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) if ((x - 32) ** 2 + (y - 32) ** 2 < 26 ** 2) big.px[y * 64 + x] = rgba(200 + (x & 7), 40, 40);
  const png = decodePng(encodePng(big));
  assert.deepEqual(png.px, big.px, "PNG round trip");
  const palette = [rgba(210, 45, 45), rgba(20, 20, 20), rgba(240, 240, 240)];
  const b = iconFromImage(png, 16, { palette });
  assert.equal(b.px[8 * 16 + 8], palette[0]);
  assert.equal(b.px[0], 0);
  const n = b.px.filter((c) => c !== 0).length;
  assert.ok(n > 120 && n < 256, `${n} pixels of disc`);
});
