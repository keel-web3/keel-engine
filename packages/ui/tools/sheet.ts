// A quick glyph sheet in Node: node packages/ui/tools/sheet.ts out.png [paramsJSON]
import { writeFileSync } from "node:fs";
import { createBitmap, fillRect, blitMask } from "../src/bitmap.ts";
import type { Bitmap } from "../src/bitmap.ts";
import { rgba } from "../src/color.ts";
import { generateFont, DEFAULT_FONT } from "../src/genfont.ts";
import { glyphOf, kernKey } from "../src/font.ts";
import type { PixelFont } from "../src/font.ts";
import { encodePng } from "../src/import/png.ts";

const out = process.argv[2] ?? "sheet.png";
const params = { ...DEFAULT_FONT, ...(process.argv[3] ? JSON.parse(process.argv[3]) : {}) };
const W = 640, H = 420;
const b = createBitmap(W, H);
fillRect(b, 0, 0, W, H, rgba(20, 22, 30));
const ink = rgba(230, 232, 240);
function text(font: PixelFont, s: string, x: number, y: number, bm: Bitmap) {
  let pen = x; let prev = -1;
  for (const ch of s) {
    const code = ch.codePointAt(0)!; const g = glyphOf(font, code)!;
    if (prev >= 0) pen += font.kern.get(kernKey(prev, code)) ?? 0;
    const gb = { w: g.w, h: g.h, px: Uint32Array.from(g.bits) };
    blitMask(bm, gb, 0, 0, g.w, g.h, pen + g.ox, y + g.oy, ink);
    pen += g.adv; prev = code;
  }
}
let y = 4;
for (const size of [5, 6, 7, 8, 9, 10, 12, 14, 16]) {
  const f = generateFont(params, size);
  y += f.ascent;
  text(f, "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789", 4, y, b);
  y += f.descent + 2 + f.ascent;
  text(f, "abcdefghijklmnopqrstuvwxyz !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ …•×÷°←→↑↓▲▼◀▶■□✓♥★", 4, y, b);
  y += f.descent + 4;
}
writeFileSync(out, encodePng(b, 2));
