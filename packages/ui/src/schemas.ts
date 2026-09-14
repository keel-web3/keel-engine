// The UI's stored forms, as bit-codec schemas (the KEEL build lists every
// named schema this file exports in keel/ui's manifest, bytes embedded, and
// keel/codec's setup registers them on the page):
//
//   keel/ui/theme        a theme's RECIPE: generator, seed, culture, sparse pins (a few bytes)
//   keel/ui/font         a pixel font: metrics, glyph bitmaps as packed bits, kerning
//   keel/ui/font-recipe  a generated font as its recipe: the family's parameters and sizes
//   keel/ui/screen       a layout document: the node tree, its ids/tones/icons through shared tables

import { SCREEN_IDS } from "@keel-engine/core";
import { alt, array, bool, enumOf, extend, fixed, named, num, optional, planes, recursive, ref, seedText, string, struct, tuple, uint, varint, varuint } from "@keel-engine/codec";
import type { Infer, Type } from "@keel-engine/codec";
import { FRAME_KINDS } from "./frames.ts";
import { SERIFS, SOFTS, ZEROS } from "./genfont.ts";
import { ANCHORS, WIDGETS } from "./node.ts";
import { CORNERS, CULTURES, FILLS, ICON_STYLES, MOTIONS, TONES } from "./theme.ts";
import type { NodeDoc } from "./doc.ts";

const hue = fixed(0, 360, 0.01, { off: "exact" });
const share = fixed(0, 1, 0.01, { off: "exact" });

/** A font family's parameters (genfont.ts FontParams). */
export const FONT_PARAMS = struct({
  width: share, xHeight: share, descender: share, round: uint(2), stroke: fixed(0, 0.5, 0.01, { off: "exact" }),
  serif: enumOf(SERIFS, { capacity: 8 }), slant: uint(1), tracking: uint(2), zero: enumOf(ZEROS, { capacity: 4 }), ascend: uint(1),
  soft: enumOf(SOFTS, { capacity: 4 }), capWidth: uint(2),
});
const FONT_PINS = struct({
  width: optional(share), xHeight: optional(share), descender: optional(share), round: optional(uint(2)), stroke: optional(fixed(0, 0.5, 0.01, { off: "exact" })),
  serif: optional(enumOf(SERIFS, { capacity: 8 })), slant: optional(uint(1)), tracking: optional(uint(2)), zero: optional(enumOf(ZEROS, { capacity: 4 })), ascend: optional(uint(1)),
  soft: optional(enumOf(SOFTS, { capacity: 4 })), capWidth: optional(uint(2)),
});

export const THEME_PINS = struct({
  tone: optional(enumOf(TONES, { capacity: 4 })),
  hue: optional(hue),
  accentHue: optional(hue),
  chroma: optional(fixed(0, 0.5, 0.001, { off: "exact" })),
  corner: optional(enumOf(CORNERS, { capacity: 16 })),
  radius: optional(uint(3)),
  border: optional(uint(2)),
  bevel: optional(uint(2)),
  fill: optional(enumOf(FILLS, { capacity: 8 })),
  screen: optional(enumOf(SCREEN_IDS, { capacity: 32 })),
  shadow: optional(uint(2)),
  glow: optional(uint(2)),
  motion: optional(enumOf(MOTIONS, { capacity: 8 })),
  body: optional(uint(5)),
  caps: optional(bool()),
  font: optional(FONT_PINS),
  icon: optional(enumOf(ICON_STYLES, { capacity: 8 })),
  unit: optional(uint(4)),
  teams: optional(uint(5)),
  teamHues: optional(array(hue, { max: 24 })),
}, { open: true });

/** A theme: its recipe. The theme itself is derived (theme.ts themeOf). */
export const UI_THEME = named("keel/ui/theme", struct({
  generator: ref("modules"),
  seed: seedText,
  culture: enumOf(CULTURES, { capacity: 16 }),
  pins: THEME_PINS,
}, { open: true }), { doc: "A UI theme as its recipe: generator@version, seed, culture and sparse pins." });
export type ThemeRecord = Infer<typeof UI_THEME>;

/** One glyph: its code point (each from the last: sorted fonts are small), box, placement, advance, bits. */
export const GLYPH = struct({
  code: fixed(0, 0x10ffff, 1, { k: 2, delta: true }),
  w: uint(6),
  h: uint(6),
  ox: varint(),
  oy: varint(),
  adv: uint(7),
  bits: planes(1),
});

export const UI_FONT = named("keel/ui/font", struct({
  name: string(),
  size: uint(6),
  ascent: uint(7),
  descent: uint(6),
  lineHeight: uint(7),
  source: enumOf(["generated", "ttf", "bmfont", "grid", "browser", "codec"], { capacity: 16 }),
  glyphs: array(GLYPH),
  kern: array(tuple([varuint({ k: 5 }), varuint({ k: 5 }), varint()])),
}, { open: true }), { doc: "A pixel font: metrics, 1-bit glyphs, kerning pairs." });
export type FontRecord = Infer<typeof UI_FONT>;

export const UI_FONT_RECIPE = named("keel/ui/font-recipe", struct({
  generator: ref("modules"),
  params: FONT_PARAMS,
  sizes: array(uint(6), { max: 31 }),
}, { open: true }), { doc: "A generated pixel font as its recipe: the family's parameters and the sizes used." });

const size = alt([varint(), ref("sizes")]);
const u = () => optional(varuint());

/** A layout document's node: every prop optional, children recursive. */
export const UI_NODE: Type<NodeDoc> = recursive<NodeDoc>((self) => extend(struct({
  type: enumOf(WIDGETS, { capacity: 64 }),
  id: optional(ref("ids")),
  anchor: optional(enumOf(ANCHORS, { capacity: 16 })),
  x: optional(varint()),
  y: optional(varint()),
  w: optional(size),
  h: optional(size),
  minW: u(), maxW: u(), minH: u(), maxH: u(),
  dir: optional(enumOf(["free", "row", "col", "grid"], { capacity: 8 })),
  gap: u(), pad: u(),
  align: optional(enumOf(["start", "center", "end", "stretch"], { capacity: 8 })),
  justify: optional(enumOf(["start", "center", "end", "between"], { capacity: 8 })),
  grow: u(), cols: u(), cellH: u(),
  hidden: optional(bool()),
  frame: optional(enumOf([...FRAME_KINDS, "none"], { capacity: 16 })),
  mesh: optional(bool()),
  tone: optional(ref("tones")),
  font: optional(enumOf(["small", "body", "title", "display"], { capacity: 8 })),
  textAlign: optional(enumOf(["left", "center", "right"], { capacity: 4 })),
  wrap: optional(bool()),
  maxLines: u(),
  caps: optional(bool()),
  shadow: optional(bool()),
  text: optional(string()),
  title: optional(string()),
  icon: optional(ref("icons")),
  iconSize: u(),
  value: optional(num()),
  max: optional(num()),
  segments: u(),
  trail: optional(num()),
  hotkey: optional(ref("keys")),
  cooldown: optional(fixed(0, 1, 1 / 64, { off: "exact" })),
  count: u(),
  disabled: optional(bool()),
  active: optional(bool()),
  primary: optional(bool()),
  items: optional(array(string())),
  selected: optional(varint()),
  view: optional(tuple([fixed(0, 1, 1 / 1024, { off: "exact" }), fixed(0, 1, 1 / 1024, { off: "exact" }), fixed(0, 1, 1 / 1024, { off: "exact" }), fixed(0, 1, 1 / 1024, { off: "exact" })])),
  tip: optional(string()),
  focusable: optional(bool()),
  action: optional(ref("actions")),
  hole: optional(bool()),
  children: optional(array(self)),
}, { open: true }), {
  // (Added later, as an extension group: old records read as before.)
  tipDock: optional(bool()),
  trim: optional(string()),
  edge: optional(string()),
  scrim: optional(enumOf(["solid", "dither"], { capacity: 4 })),
  reflow: optional(bool()),
  iconFill: optional(bool()),
  hp: optional(num()),
}) as unknown as Type<NodeDoc>);

export const UI_SCREEN = named("keel/ui/screen", struct({
  screen: string(),
  theme: optional(struct({ generator: ref("modules"), seed: seedText, culture: enumOf(CULTURES, { capacity: 16 }), pins: THEME_PINS }, { open: true })),
  root: UI_NODE,
}, { open: true }), { doc: "A UI screen: its layout tree (and the theme recipe it was made with)." });
