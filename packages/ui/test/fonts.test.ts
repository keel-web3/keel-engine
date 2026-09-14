// Fonts: the generated family covers ASCII and the UI's symbols at 5..16 px,
// deterministically; fonts round-trip through the codec; text layout wraps,
// aligns, cuts and sets figures tabular; BMFont, image-grid, TTF and WOFF
// imports read crisp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_FONT, GENERATED_CODES, bmFont, createBitmap, decodeFont, decodeFontRecipe, decodePng, encodeFont, encodeFontRecipe, fontParamsFromSeed, generateFont, glyphOf,
  gridFont, kernKey, layoutText, loadFont, measure, parseBmFont, parseFont, parseRich, trimGlyph,
} from "../src/index.ts";
import type { PixelFont } from "../src/index.ts";
import { KERN_AV, buildTtf } from "./ttf-builder.ts";
import { buildWoff } from "./woff-builder.ts";

const fixture = (f: string) => new URL(`./fixtures/${f}`, import.meta.url);
const bitsOf = (f: PixelFont, code: number) => { const g = trimGlyph(glyphOf(f, code)!); return `${g.w}x${g.h}@${g.ox},${g.oy}:${g.bits.join("")}`; };

test("generated font: every printable ASCII character and the UI symbols, 5..16 px, deterministic, distinct families", () => {
  const ascii = Array.from({ length: 95 }, (_, i) => 32 + i);
  for (const c of ascii) assert.ok(GENERATED_CODES.includes(c), `covers ${String.fromCharCode(c)}`);
  for (const size of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    const f = generateFont(DEFAULT_FONT, size);
    assert.equal(f.size, size);
    for (const c of ascii) {
      const g = f.glyphs.get(c)!;
      assert.ok(g, `${size}px has ${String.fromCharCode(c)}`);
      if (c !== 32) assert.ok(g.bits.some(Boolean), `${size}px ${String.fromCharCode(c)} has ink`);
    }
    // Capitals are exactly the cap height; figures are tabular (one advance).
    const H = trimGlyph(f.glyphs.get(72)!);
    assert.equal(H.h, size, `${size}px H is ${H.h} tall`);
    assert.equal(new Set(Array.from({ length: 10 }, (_, d) => f.glyphs.get(48 + d)!.adv)).size, 1, "figures share an advance");
    // Distinct glyphs: letters and figures don't draw alike -- in the default family, a square one and a round one.
    for (const p of [DEFAULT_FONT, { ...DEFAULT_FONT, round: 0 }, { ...DEFAULT_FONT, round: 3, serif: "slab" as const }]) {
      const g = size === 8 ? generateFont(p, size) : f;
      const codes = [...Array.from({ length: 26 }, (_, i) => 65 + i), ...Array.from({ length: 26 }, (_, i) => 97 + i), ...Array.from({ length: 10 }, (_, i) => 48 + i)];
      const drawn = new Set(codes.map((c) => bitsOf(g, c)));
      assert.ok(drawn.size >= codes.length - (size <= 6 ? 4 : 1), `${size}px round ${p.round}: ${drawn.size} distinct of ${codes.length}`);
      const O = bitsOf(g, 79).split(":")[1], D = bitsOf(g, 68).split(":")[1], zero = bitsOf(g, 48).split(":")[1];
      assert.ok(O !== D && (size <= 6 || O !== zero), `${size}px round ${p.round}: O, D and 0 differ`);
    }
  }
  assert.equal(generateFont(DEFAULT_FONT, 8).key, generateFont(DEFAULT_FONT, 8).key);
  // Families: how many of 100 seeds draw a different font, by its pixels. (A family's parameters are
  // continuous, but at 8 px a width or x-height only has a few whole-pixel outcomes: nearby parameter sets
  // draw the same font. The theme adds colour and frames on top -- themes are ~99.5% distinct, theme.test.ts.)
  const distinct = (size: number) => new Set(Array.from({ length: 100 }, (_, i) => generateFont(fontParamsFromSeed(i), size).key)).size;
  const [d8, d12] = [distinct(8), distinct(12)];
  console.log(`100 seeds: ${d8} different 8px fonts, ${d12} different 12px fonts`);
  assert.ok(d8 >= 60 && d12 >= 70, `${d8} at 8px, ${d12} at 12px`);
});

test("codec: a font round-trips as packed bits; a generated one also as its recipe", () => {
  for (const size of [5, 8, 12, 16]) {
    const f = generateFont(fontParamsFromSeed("round-trip"), size);
    const bytes = encodeFont(f);
    const back = decodeFont(bytes);
    assert.equal(back.key.split(":").pop(), f.key.split(":").pop(), "same content hash");
    for (const c of GENERATED_CODES) assert.equal(bitsOf(back, c), bitsOf(f, c));
    const bitsTotal = [...f.glyphs.values()].reduce((s, g) => s + g.bits.length, 0);
    assert.ok(bytes.length < bitsTotal / 8 + f.glyphs.size * 8 + 64, `${size}px: ${bytes.length} bytes for ${bitsTotal} glyph bits`);
    if (size === 8) console.log(`8px font: ${bytes.length} bytes (${f.glyphs.size} glyphs, ${bitsTotal} bits)`);
  }
  const recipe = encodeFontRecipe(DEFAULT_FONT, [5, 7, 12]);
  assert.ok(recipe.length < 40, `recipe ${recipe.length} bytes`);
  const fonts = decodeFontRecipe(recipe);
  assert.deepEqual(fonts.map((f) => f.key), [5, 7, 12].map((s) => generateFont(DEFAULT_FONT, s).key));
});

test("layout: wraps at spaces, breaks long words, aligns, cuts with an ellipsis, tabular figures, rich runs and icons", () => {
  const font = generateFont(DEFAULT_FONT, 7);
  const t = layoutText("The quick brown fox jumps over the lazy dog", { font, width: 60 });
  assert.ok(t.lines > 1);
  assert.ok(t.w <= 60, `widest line ${t.w}`);
  for (const it of t.items) assert.ok(it.x + it.w <= 60, "every glyph inside the width");
  // A word longer than the line breaks between letters.
  const long = layoutText("Supercalifragilistic", { font, width: 30 });
  assert.ok(long.lines >= 3 && long.items.every((i) => i.x + i.w <= 30));
  // Ellipsis.
  const cut = layoutText("A very long unit name indeed", { font, width: 50, maxLines: 1 });
  assert.equal(cut.lines, 1);
  assert.ok(cut.truncated);
  assert.equal(cut.items[cut.items.length - 1]!.code, 0x2026);
  assert.ok(cut.w <= 50);
  // Alignment: centred and right-aligned lines end where they should.
  const r = layoutText("ab", { font, width: 40, align: "right" });
  const last = r.items[r.items.length - 1]!;
  assert.equal(last.x + font.glyphs.get(98)!.adv, 40);
  const c = layoutText("ab", { font, width: 40, align: "center" });
  assert.equal(c.items[0]!.x, Math.floor((40 - measure(font, "ab")) / 2));
  // Tabular figures: "1111" and "8888" are the same width.
  assert.equal(layoutText("1111", { font, tabular: true }).w, layoutText("8888", { font, tabular: true }).w);
  // Rich runs: tones and inline icons.
  const rich = layoutText(parseRich("Mass {icon:mass} {good}+25{/} {#ff0000}hot{/}"), { font });
  assert.equal(rich.items.filter((i) => i.icon === "mass").length, 1);
  assert.ok(rich.items.some((i) => i.tone === "good"));
  assert.ok(rich.items.some((i) => i.color !== undefined));
  assert.deepEqual(parseRich("a{{b"), [{ text: "a{b" }]);
  // Newlines.
  assert.equal(layoutText("one\ntwo\nthree", { font }).lines, 3);
});

test("BMFont import: the text fixture (and its XML form) gives back the glyphs it was made from", () => {
  const desc = parseBmFont(readFileSync(fixture("keel5.fnt"), "utf8"));
  const page = decodePng(readFileSync(fixture("keel5.png")));
  assert.equal(page.w, 64);
  const f = bmFont(desc, [page]);
  const ref = generateFont(DEFAULT_FONT, 5);
  assert.equal(f.size, 5);
  for (let c = 33; c < 127; c += 1) assert.equal(bitsOf(f, c), bitsOf(ref, c), `glyph ${String.fromCharCode(c)}`);
  assert.equal(f.kern.get(kernKey(65, 86)), -1);
  assert.equal(measure(f, "AV"), measure(ref, "AV") - 1);
  // The XML form of the same description.
  const xml = `<?xml version="1.0"?><font><info face="keel5" size="5"/><common lineHeight="${desc.lineHeight}" base="${desc.base}"/><pages><page id="0" file="keel5.png"/></pages><chars>${desc.chars
    .map((ch) => `<char id="${ch.id}" x="${ch.x}" y="${ch.y}" width="${ch.width}" height="${ch.height}" xoffset="${ch.xoffset}" yoffset="${ch.yoffset}" xadvance="${ch.xadvance}" page="0"/>`).join("")}</chars></font>`;
  const fx = bmFont(parseBmFont(xml), [page]);
  for (let c = 33; c < 127; c += 1) assert.equal(bitsOf(fx, c), bitsOf(f, c));
});

test("image-grid import: a sheet of cells becomes a proportional font", () => {
  const ref = generateFont(DEFAULT_FONT, 7);
  const cellW = 10, cellH = 12, chars = "ABCHIOabco0123";
  const sheet = createBitmap(cellW * 7, cellH * 2);
  [...chars].forEach((ch, i) => {
    const g = ref.glyphs.get(ch.codePointAt(0)!)!;
    const x0 = (i % 7) * cellW + 1, y0 = Math.floor(i / 7) * cellH + 1 + ref.ascent + g.oy;
    for (let y = 0; y < g.h; y += 1) for (let x = 0; x < g.w; x += 1) if (g.bits[y * g.w + x]) sheet.px[(y0 + y) * sheet.w + x0 + x] = 0xffffffff;
  });
  const f = gridFont(sheet, { cellW, cellH, chars });
  assert.equal(f.size, 7);
  for (const ch of chars) {
    const code = ch.codePointAt(0)!;
    const a = trimGlyph(f.glyphs.get(code)!), b = trimGlyph(ref.glyphs.get(code)!);
    assert.equal(a.bits.join(""), b.bits.join(""), `glyph ${ch}`);
    assert.equal(a.oy, b.oy, `${ch} sits on the baseline`);
  }
  assert.ok(f.glyphs.get(73)!.adv < f.glyphs.get(79)!.adv, "proportional: I narrower than O");
});

test("TTF import (a TrueType font built in the test): outlines, curves, a composite, kerning, hinting to whole pixels; the same through WOFF", () => {
  const ttf = buildTtf();
  const sf = parseFont(ttf, "built");
  assert.equal(sf.unitsPerEm, 1000);
  assert.equal(sf.capHeight, 700);
  assert.equal(sf.cmap.get(72), 1);
  for (const size of [5, 7, 9, 12, 16]) {
    const f = loadFont(ttf, size, { name: "built" });
    const H = f.glyphs.get(72)!;
    assert.equal(H.h, size, `${size}px: H is exactly the cap height (${H.h})`);
    assert.equal(H.oy, -size, "and sits on the baseline");
    // H's stems are solid columns, its bar a solid row: crisp, no grey.
    const col = (x: number) => Array.from({ length: H.h }, (_, y) => H.bits[y * H.w + x]).every(Boolean);
    assert.ok(col(0) && col(H.w - 1), `${size}px: H's stems are whole`);
    const O = f.glyphs.get(79)!;
    assert.ok(O.bits.some(Boolean) && !O.bits[0], `${size}px: O is round (its corner is empty)`);
    const eq = f.glyphs.get(61)!;
    assert.ok(eq.bits.some(Boolean), "the composite = has ink");
    const rows = new Set<number>();
    for (let y = 0; y < eq.h; y += 1) if (eq.bits.subarray(y * eq.w, (y + 1) * eq.w).some(Boolean)) rows.add(y);
    assert.ok(rows.size < eq.h, "= is two bars with a gap");
    if (size >= 9) assert.equal(f.kern.get(kernKey(65, 86)), Math.round((KERN_AV * size) / 700), "A V kerned");
  }
  const woff = buildWoff(ttf);
  assert.ok(woff.length < ttf.length);
  const a = loadFont(ttf, 9), b = loadFont(woff, 9);
  for (const c of [72, 79, 108, 45, 61, 65, 86]) assert.equal(bitsOf(b, c), bitsOf(a, c));
  assert.throws(() => parseFont(Uint8Array.from([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0])), /loadBrowserFont/);
});

const SYSTEM_TTF = [
  "/opt/homebrew/Library/Homebrew/vendor/portable-ruby/4.0.5_1/lib/ruby/gems/4.0.0/gems/rdoc-7.0.4/lib/rdoc/generator/template/darkfish/fonts/SourceCodePro-Regular.ttf",
  "/opt/homebrew/Library/Homebrew/vendor/portable-ruby/3.4.8/lib/ruby/3.4.0/rdoc/generator/template/darkfish/fonts/SourceCodePro-Regular.ttf",
].find((p) => existsSync(p));

test("TTF import of an open-licensed font on this machine (Source Code Pro, SIL OFL), if present", { skip: !SYSTEM_TTF && "no Source Code Pro here" }, () => {
  const bytes = readFileSync(SYSTEM_TTF!);
  for (const size of [7, 9, 12]) {
    const f = loadFont(bytes, size);
    assert.equal(f.glyphs.get(72)!.h, size);
    const adv = new Set([..."ABCmw019"].map((c) => f.glyphs.get(c.codePointAt(0)!)!.adv));
    assert.equal(adv.size, 1, "a monospace font stays monospace");
    for (let c = 33; c < 127; c += 1) assert.ok(f.glyphs.get(c)!.bits.some(Boolean), `${size}px ${String.fromCharCode(c)}`);
  }
});
