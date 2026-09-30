import { test } from "node:test";
import assert from "node:assert/strict";
import { exportGameBoyBackground, gameBoyCSource } from "../src/gameboy.ts";

function image(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number, number]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rgba.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, rgba };
}
const gray = [255, 170, 85, 0];

test("DMG export uses real two-plane bytes, deduplicates tiles and preserves top-first rows", () => {
  const source = image(16, 8, (x) => { const c = gray[x % 4]!; return [c, c, c, 255]; });
  const out = exportGameBoyBackground(source, { target: "game-boy", width: 16, height: 8 });
  assert.equal(out.tileCount, 1);
  assert.deepEqual([...out.tiles[0]], Array.from({ length: 8 }, () => [0x55, 0x33]).flat());
  assert.deepEqual([...out.tilemap], [0, 0]);
  assert.deepEqual(out.preview, source.rgba);
  assert.equal(out.dmgPalette, 0xe4);
  assert.equal(out.changedPixels, 0);
});

test("CGB RGB555 bytes, palette attributes and the reconstructed preview agree", () => {
  const source = image(16, 8, (x, y) => x < 8 ? (y < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : (y < 4 ? [0, 0, 255, 255] : [255, 255, 255, 255]));
  const out = exportGameBoyBackground(source, { target: "chromatic", width: 16, height: 8 });
  assert.equal(out.paletteCount, 1, "two two-colour tiles share a four-colour palette");
  assert.equal(out.palettes.length, 8);
  const words = Array.from({ length: 4 }, (_, i) => out.palettes[i * 2]! | out.palettes[i * 2 + 1]! << 8).sort((a, b) => a - b);
  assert.deepEqual(words, [0x001f, 0x03e0, 0x7c00, 0x7fff]);
  assert.deepEqual(out.preview, source.rgba);
  assert.deepEqual([...out.attributes], [0, 0]);
  assert.equal(out.changedPixels, 0);
});

test("conversion fits within eight hardware palettes and four colours in every tile", () => {
  const source = image(160, 144, (x, y) => [x * 17 % 256, y * 29 % 256, (x + y) * 7 % 256, 255]);
  const out = exportGameBoyBackground(source, { target: "game-boy-color" });
  assert.ok(out.paletteCount <= 8);
  assert.ok(out.tileCount <= 512);
  assert.equal(out.tilemap.length, 20 * 18);
  assert.ok(out.changedPixels > 0);
  for (const attr of out.attributes) assert.equal(attr & 0xf0, 0);
  for (let ty = 0; ty < 18; ty += 1) for (let tx = 0; tx < 20; tx += 1) {
    const colours = new Set<string>();
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) { const p = ((ty * 8 + y) * 160 + tx * 8 + x) * 4; colours.add(String(out.preview.subarray(p, p + 3))); }
    assert.ok(colours.size <= 4);
  }
  assert.deepEqual(exportGameBoyBackground(source, { target: "game-boy-color" }), out);
});

test("palette allocation retains a distinct accent among many similar background palettes", () => {
  const source = image(160, 32, (x, y) => {
    if (x >= 152 && y >= 24) return [255, 0, 0, 255];
    const tile = Math.floor(x / 8), c = 64 + tile * 2 + (y % 4) * 8;
    return [c, c + tile % 3 * 8, c + tile % 5 * 8, 255];
  });
  const out = exportGameBoyBackground(source, { target: "chromatic", width: 160, height: 32 });
  const p = (24 * 160 + 152) * 4;
  assert.deepEqual([...out.preview.subarray(p, p + 4)], [255, 0, 0, 255]);
});

test("second VRAM bank is addressed correctly; DMG overflow refuses an invalid export", () => {
  // 300 distinct binary patterns, laid out as 20 x 15 tiles.
  const source = image(160, 120, (x, y) => {
    const tile = Math.floor(y / 8) * 20 + Math.floor(x / 8);
    const bit = (y % 8) * 8 + x % 8;
    const c = bit < 9 && (tile >> bit & 1) ? 0 : 255;
    return [c, c, c, 255];
  });
  const out = exportGameBoyBackground(source, { target: "chromatic", width: 160, height: 120 });
  assert.equal(out.tileCount, 300);
  assert.deepEqual(out.tiles.map((b) => b.length), [256 * 16, 44 * 16]);
  assert.equal(out.tilemap[256], 0);
  assert.equal(out.attributes[256]! & 8, 8);
  assert.deepEqual(out.preview, source.rgba);
  assert.throws(() => exportGameBoyBackground(source, { target: "game-boy", width: 160, height: 120 }), /256 unique tiles/);
  assert.match(gameBoyCSource(out, "scene"), /scene_tiles1\[704\]/);
  assert.throws(() => gameBoyCSource(out, "bad-name"), /identifier/);
});

test("fit preserves aspect, transparent backgrounds flatten explicitly, and bad inputs fail", () => {
  const source = image(8, 8, () => [255, 0, 0, 0]);
  const out = exportGameBoyBackground(source, { target: "game-boy" });
  for (let i = 0; i < out.preview.length; i += 4) assert.deepEqual([...out.preview.subarray(i, i + 4)], [255, 255, 255, 255]);
  assert.throws(() => exportGameBoyBackground(source, { target: "8-bit" as never }), /hardware target/);
  assert.throws(() => exportGameBoyBackground(source, { target: "chromatic", width: 159 }), /multiples of 8/);
  assert.throws(() => exportGameBoyBackground({ width: 8, height: 8, rgba: new Uint8Array(1) }), /RGBA/);
  assert.throws(() => exportGameBoyBackground(source, { width: 264 }), /256/);
});
