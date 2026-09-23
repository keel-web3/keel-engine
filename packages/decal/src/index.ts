// @keel-engine/decal: pictures and words people put on things, stored on-chain. The KEEL alphabet
// (64 glyph codes, a 5x7 and a 3x5 font; typed text converted into it), the KDCL doc a registry
// contract validates (a four-ink pixel image, or styled text, each with its own inks), and the
// rasterizer to bake decal texels -- so a registered decal goes on a panel like a generated one.

export { BIG, CHARSET, FONTS, LINE_BREAK, SMALL, fromGlyphs, toGlyphs } from "./alphabet.ts";
export type { Converted } from "./alphabet.ts";
export { MAX_GLYPHS, MAX_H, MAX_LINE, MAX_LINES, MAX_W, STYLE, checkDoc, decodeDecal, encodeDecal, splitLines, textDecal } from "./doc.ts";
export type { DecalDoc, Ink } from "./doc.ts";
export { imageTexels, rasterize } from "./raster.ts";
export type { DecalTexels } from "./raster.ts";
