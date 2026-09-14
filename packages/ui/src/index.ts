// @keel-engine/ui: the engine's generative UI. Themes from a seed and a culture
// (OKLCH ramps, procedural 9-slice frames, dither textures, a type scale, a
// generated font family, spacing, icons, motion), fonts (generated, or
// imported from TTF/WOFF, BMFont and image grids, rasterised crisp), generative
// icons from a shape grammar (or imported PNG/SVG, palette-snapped),
// retained-mode widgets drawn palette-true into one pixel layer with
// dirty-rectangle redraws, layout documents stored through the codec, and
// generated HUDs, menus and loading screens -- one call each.

export { CLEAR, alphaOf, contrast, fromHex, fromOklch, fromRgb, labDistance, luminance, nearest, oklab, rgba, rgbOf, toHex } from "./color.ts";
export type { Rgba } from "./color.ts";
export { blit, blitMask, bytesOf, clipOf, createBitmap, crop, fillRect, fillTile, fullClip, hashBitmap, intersect, line, plot, strokeRect } from "./bitmap.ts";
export type { Bitmap, Clip, Rect } from "./bitmap.ts";
export { crisp, cubicTo, ellipse, quadTo, rasterize } from "./raster.ts";
export type { Contour, RasterOptions } from "./raster.ts";

export {
  CORNERS, CULTURES, CULTURE_SPECS, FILLS, FLAVOUR_CULTURE, ICON_STYLES, MOTIONS, THEME_GENERATOR, TONES, cultureOf, ease, generateTheme, ramp, recipeKey, themeFeatures, themeOf,
} from "./theme.ts";
export type { Corner, Culture, Fill, FrameStyle, IconStyle, IconTheme, Motion, MotionKind, Ramp, Spacing, Theme, ThemeOptions, ThemePalette, ThemePins, ThemeRecipe, Tone, TypeScale } from "./theme.ts";
export { FRAME_KINDS, FRAME_STATES, ROLE, drawFrame, frameColours, frameShape, frameTemplate, screenTile } from "./frames.ts";
export type { FrameColours, FrameDraw, FrameKind, FrameShape, FrameState, FrameTemplate } from "./frames.ts";

export { digitAdvance, glyphFromBitmap, glyphOf, kernKey, makeFont, measure, trimGlyph } from "./font.ts";
export type { FontInput, FontSource, Glyph, PixelFont } from "./font.ts";
export { DEFAULT_FONT, DEFAULT_FONT_RANGES, GENERATED_CODES, GLYPHS, SERIFS, SOFTS, ZEROS, fontParamsFromSeed, fontParamsKey, fontParamsOf, generateFont } from "./genfont.ts";
export type { FontParams, FontRanges, Serif, SoftCorners, ZeroStyle } from "./genfont.ts";
export { drawText, glyphSprite, layoutText, parseRich } from "./text.ts";
export type { DrawTextOptions, LayoutOptions, PlacedItem, TextLayout, TextRun } from "./text.ts";
export { createAtlas } from "./atlas.ts";
export type { AtlasSprite, AtlasStats, UiAtlas } from "./atlas.ts";

export { ICON_NAMES, ICON_RECIPES, iconBitmap, iconMask, rampOf, shadeIcon } from "./icons.ts";
export type { IconOptions } from "./icons.ts";

export { ANCHORS, PAINT_ONLY, UiNode, WIDGETS, stateOf } from "./node.ts";
export type { Align, Anchor, FontRole, Justify, NodeProps, Size, WidgetType } from "./node.ts";
export { arrange, frameOf, measure as measureNode, padOf } from "./layout.ts";
export type { LayoutContext } from "./layout.ts";
export { Ui, createUi, keyName, mergeRects, uiScaleFor } from "./ui.ts";
export type { MinimapPoint, Navigation, PadState, PointerOptions, SafeArea, UiEvent, UiListener, UiOptions, UiStats } from "./ui.ts";
export { WIRE_LEVELS, isLevelIcon, paintLevels, wireframeOf } from "./wireframe.ts";
export type { LevelIcon, Silhouette, WireframeOptions } from "./wireframe.ts";
export { CURSOR_KINDS, generateCursor } from "./cursors.ts";
export type { Cursor, CursorKind, CursorOptions } from "./cursors.ts";
export { buildNode, docOf, findDoc, overrideDoc, walkDoc } from "./doc.ts";
export type { NodeDoc, ScreenDoc } from "./doc.ts";
export { generateHud, generateLoading, generateMenu } from "./generate.ts";
export type { CommandButton, Generated, GenerateOptions, HudLayout, HudOptions, HudSlots, LoadingOptions, MenuButton, MenuItem, MenuOptions, ResourceSlot } from "./generate.ts";

export { FONT_PARAMS, GLYPH, THEME_PINS, UI_FONT, UI_FONT_RECIPE, UI_NODE, UI_SCREEN, UI_THEME } from "./schemas.ts";
export type { FontRecord, ThemeRecord } from "./schemas.ts";
export { decodeFont, decodeFontRecipe, decodeScreen, decodeTheme, encodeFont, encodeFontRecipe, encodeScreen, encodeTheme, fontOfRecord, fontRecordOf, recipeOfRecord, themeRecordOf } from "./records.ts";

// Import: fonts (TTF/WOFF parsed here; OTF/CFF and WOFF2 through the browser), BMFont, image grids; icons from PNG/SVG.
export { deflateStored, inflate, inflateRaw } from "./import/inflate.ts";
export { decodePng, encodePng } from "./import/png.ts";
export { loadFont, parseFont, rasteriseFont, sfntTables } from "./import/ttf.ts";
export type { RasteriseOptions, SfntFont } from "./import/ttf.ts";
export { bmFont, gridFont, parseBmFont } from "./import/bitmapfonts.ts";
export type { BmChar, BmFontDesc, GridFontOptions } from "./import/bitmapfonts.ts";
export { iconFromImage, iconFromSvg, parseSvg, svgPath, themeColours } from "./import/icons.ts";
export type { IconImport } from "./import/icons.ts";
export { loadBrowserFont } from "./import/browser.ts";
export type { BrowserFontOptions } from "./import/browser.ts";

// Presenting the layer: a 2D canvas over the game's, or the game's own WebGL2 context.
export { createCanvasPresenter, createGlPresenter } from "./present.ts";
export type { GlPresenter, Presenter } from "./present.ts";
