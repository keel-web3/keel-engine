// The BMFont fixture (test/fixtures/keel5.fnt + keel5.png) is the default generated family at 5 px, written as an
// AngelCode text description and a 64x64 page. The import test reads it back and compares it glyph by glyph with
// generateFont(DEFAULT_FONT, 5), so whenever a glyph recipe changes, run this again:
//
//   node packages/ui/tools/keel5-fixture.ts
import { writeFileSync } from "node:fs";
import { createBitmap } from "../src/bitmap.ts";
import { rgba } from "../src/color.ts";
import { DEFAULT_FONT, generateFont } from "../src/genfont.ts";
import { encodePng } from "../src/import/png.ts";

const f = generateFont(DEFAULT_FONT, 5);
const page = createBitmap(64, 64);
const ink = rgba(255, 255, 255);
const lines: string[] = [];
let x = 0, y = 0;
const ROW = f.ascent + f.descent + 1;
for (let code = 32; code < 127; code += 1) {
  const g = f.glyphs.get(code)!;
  if (g.w > 0 && x + g.w > 64) { x = 0; y += ROW; }
  const at = g.w > 0 ? x : 0, top = g.w > 0 ? y : 0;
  for (let yy = 0; yy < g.h; yy += 1) for (let xx = 0; xx < g.w; xx += 1) if (g.bits[yy * g.w + xx]) page.px[(top + yy) * 64 + at + xx] = ink;
  lines.push(`char id=${code} x=${at} y=${top} width=${g.w} height=${g.h} xoffset=${g.ox} yoffset=${g.oy + f.ascent} xadvance=${g.adv} page=0 chnl=15`);
  if (g.w > 0) x += g.w + 1;
}
const fnt = [
  `info face="keel5" size=5 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=1,1`,
  `common lineHeight=${f.lineHeight} base=${f.ascent} scaleW=64 scaleH=64 pages=1 packed=0`,
  `page id=0 file="keel5.png"`,
  `chars count=${lines.length}`,
  ...lines,
  "kernings count=2",
  "kerning first=65 second=86 amount=-1",
  "kerning first=86 second=65 amount=-1",
  "",
].join("\n");
const dir = new URL("../test/fixtures/", import.meta.url);
writeFileSync(new URL("keel5.fnt", dir), fnt);
writeFileSync(new URL("keel5.png", dir), encodePng(page));
console.log(`keel5: ${lines.length} chars, rows of ${ROW} px`);
