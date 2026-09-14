// Themes, fonts and screens to codec bytes and back. JSON is the readable
// view (toJSON/fromJSON on the same schemas); these bytes are what's stored.

import { decode, encode } from "@keel-engine/codec";
import { makeFont } from "./font.ts";
import type { PixelFont } from "./font.ts";
import { GENERATED_CODES, generateFont } from "./genfont.ts";
import type { FontParams } from "./genfont.ts";
import { THEME_GENERATOR, themeOf } from "./theme.ts";
import type { Theme, ThemePins, ThemeRecipe } from "./theme.ts";
import { UI_FONT, UI_FONT_RECIPE, UI_SCREEN, UI_THEME } from "./schemas.ts";
import type { FontRecord, ThemeRecord } from "./schemas.ts";
import type { ScreenDoc } from "./doc.ts";

// (Pins without their undefined fields: the codec's optional fields are absent, never undefined.)
const clean = <T extends object>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

export const themeRecordOf = (r: ThemeRecipe): ThemeRecord => clean({ generator: r.generator, seed: r.seed, culture: r.culture, pins: r.pins }) as ThemeRecord;
export const recipeOfRecord = (rec: ThemeRecord): ThemeRecipe => ({ generator: THEME_GENERATOR, seed: rec.seed, culture: rec.culture, pins: rec.pins as ThemePins });

/** A theme (its recipe) as bytes. */
export const encodeTheme = (t: Theme | ThemeRecipe): Uint8Array => encode(UI_THEME, themeRecordOf("recipe" in t ? t.recipe : t));
/** Bytes back to the theme they name. */
export const decodeTheme = (bytes: Uint8Array): Theme => themeOf(recipeOfRecord(decode(UI_THEME, bytes)));

export function fontRecordOf(f: PixelFont): FontRecord {
  const glyphs = [...f.glyphs.values()].sort((a, b) => a.code - b.code).map((g) => ({ code: g.code, w: g.w, h: g.h, ox: g.ox, oy: g.oy, adv: g.adv, bits: Array.from(g.bits) }));
  const kern = [...f.kern.entries()].sort(([a], [b]) => a - b).map(([k, dx]) => [Math.floor(k / 0x200000), k % 0x200000, dx] as const);
  return { name: f.name, size: f.size, ascent: f.ascent, descent: f.descent, lineHeight: f.lineHeight, source: f.source, glyphs, kern };
}
export function fontOfRecord(r: FontRecord): PixelFont {
  return makeFont({
    name: r.name, size: r.size, ascent: r.ascent, descent: r.descent, lineHeight: r.lineHeight, source: r.source as PixelFont["source"],
    glyphs: r.glyphs.map((g) => ({ code: g.code, w: g.w, h: g.h, ox: g.ox, oy: g.oy, adv: g.adv, bits: Uint8Array.from(g.bits) })),
    kern: r.kern.map(([a, b, dx]) => [a, b, dx] as const),
  });
}
/** A pixel font as bytes (glyph bitmaps as packed bits). */
export const encodeFont = (f: PixelFont): Uint8Array => encode(UI_FONT, fontRecordOf(f));
export const decodeFont = (bytes: Uint8Array): PixelFont => fontOfRecord(decode(UI_FONT, bytes));

/** A generated font as its recipe: a few bytes instead of its bitmaps. */
export const encodeFontRecipe = (params: FontParams, sizes: readonly number[]): Uint8Array =>
  encode(UI_FONT_RECIPE, { generator: "keel/ui/font@1", params: clean(params), sizes: [...sizes] });
export function decodeFontRecipe(bytes: Uint8Array): PixelFont[] {
  const r = decode(UI_FONT_RECIPE, bytes);
  return r.sizes.map((s) => generateFont(r.params as FontParams, s));
}

export const encodeScreen = (doc: ScreenDoc): Uint8Array => encode(UI_SCREEN, clean(doc) as never);
export const decodeScreen = (bytes: Uint8Array): ScreenDoc => decode(UI_SCREEN, bytes) as unknown as ScreenDoc;

export { GENERATED_CODES };
