# `@keel-engine/ui`

The engine's generative UI. One call gives a whole themed screen; every part
of it can be pinned or overridden; everything draws as pixel art (palette
ramps, dither, outlines, integer scale, no blur). Module `keel/ui@0.1.0`
(`kind: "runtime"`, needs `keel/core@^0.1` and `keel/codec@^0.1`). Games
reach it as `@keel/game-engine/ui`.

```ts
import { createCanvasPresenter, createUi, generateHud } from "@keel/game-engine/ui";

const hud = generateHud({ seed: race.seed, culture: race.flavour });   // "Machine" -> industrial, ...
const ui = createUi({ theme: hud.theme, width: canvas.width, height: canvas.height }); // x3 at 1080p
ui.load(hud.screen);
ui.on("click", (id) => orders.push(id));                               // "move", "attack", "menu"...
const screen = createCanvasPresenter(overlay, ui);                      // or createGlPresenter(gl, ui)

// every frame:
ui.set("res.mass", { text: `{icon:mass} {tab}${mass}{/}` });
ui.set("cmd.0.4", { cooldown: attackCooldown });
ui.update(dt);
screen.present(ui.render());                                            // a static HUD: nothing to do
```

## Themes from a seed

`generateTheme({ seed, culture, pins })` makes a **theme**, and it is stored
as its **recipe**: `keel/ui/theme@1` plus the seed, the culture and sparse
pins. The record (`UI_THEME`) is 27 bytes unpinned and 42 bytes with five
pins. Everything else is derived, and each decision draws from its own named
stream, so a pin changes only what it pins:

- **Palette:** OKLCH ramps. The surface ramp has six steps: outline, shade,
  panel, raised, highlight, edge. Ink comes in three steps, each lightened
  until it reads on every panel surface. Accent, the semantic good, warn and
  bad ramps, and 1–24 team colours spaced round the wheel with the golden
  angle, the farthest-apart first. Hue drifts along each ramp (cool shadows,
  warm lights). There is a light tone too.
- **Frame style:** corners are flat, bevel, inset, notched, rivets, glow or
  round. Border 1–3 px, bevel, inner line, drop shadow and outer glow. The
  fill is solid, a dither texture (any `@keel-engine/core` screen), a
  dithered gradient or scanlines.
- **Type:** a generated font family and a scale (small, body, title,
  display: 5–16 px cap heights), plus caps for titles.
- **Spacing, icon style, motion:** snappy, bouncy (with overshoot) or none.
- **Cultures:** `industrial`, `organic`, `crystalline`, `arcane`, `brutal`,
  `clean`. Each is a set of ranges, not a fixed look. `cultureOf("Machine")`
  maps the RTS flavours: Machine→industrial, Biotic→organic,
  Crystalline→crystalline, Resonant→arcane, Thermal→brutal, Gravitic→clean.

**Frames** are procedural 9-slices. A small role template (outline, border,
bevel light and shade, inner line, fill, glow, shadow, rivets) is generated
per corner shape and cached. Each state (normal, hover, press, disabled,
active, primary) paints the same roles in its own colours. The fill pattern
lives in *layer* coordinates, so neighbouring panels share one texture. A
`mesh` panel leaves every other fill pixel to the game underneath: that is
translucency by dither, not by alpha.

## Fonts

- **Generated** (`generateFont(params, size)`): every glyph is a few strokes
  on named lines (baseline, x-height, cap, ascender, descender, middles),
  drawn one pixel wide between whole-pixel points. That makes it pixel art
  at every size, never a scaled outline. Soft corners are cut by the
  family's roundness, and `^` corners are always cut (so D never draws as
  O, even in a square font). Parameters: width, x-height, descender,
  roundness, stroke weight, serifs (none, slab, foot), slant, tracking, the
  zero (plain, dot, slash), ascenders above the cap, which corners are soft
  (all, top, bottom), and wide capitals. Coverage: ASCII 32–126 plus
  `… • × ÷ ° ← ↑ → ↓ ▲ ▼ ◀ ▶ ■ □ ✓ ♥ ★`, at 5–16 px (it works up to 32).
  Figures are tabular. The letters that get confused are drawn apart: `t`
  has a crossbar right through its stem at the x-height, a top well under
  `l`'s ascender (half the room to the cap, at least a row) and a foot
  always cut to the right, square families too; `l` is a plain stem (no
  serifs, never an `I`); `G` is open at the top right, its right side rises
  to the middle and a bar comes in from it without reaching the left side
  (no `B`-like join), and it is wide enough for that gap at any weight; `+`
  is at least 5 wide with arms shorter than `t`'s stem and off the cap line
  (a slab serif never makes it a `T`); `f`'s crossbar is shorter on the
  right. Figures are at least 5 px wide (tabular), so `8` is two stacked
  loops, the upper one narrower, pinched at the waist (never a flat-sided
  `B`); `0` an oval inset in its cell (never an `O` or a `D`; its dot or
  slash only where the oval has room for it); `5` a flat top over a bigger
  bowl than an `S`'s; `1` a long flag over a foot. `B`, `D`, `O`, `S` (and
  `I` in a narrow family) are at least 5 wide too. In every culture's family,
  over 8 seeds (the pairs hold over 60) and at 5, 6, 7, 8 and 12 px, `t/l`,
  `G/B`, `G/C`, `G/6`, `t/f`, `t/+`, `8/B`, `0/O`, `0/D`, `5/S`, `1/l`,
  `1/I`, `I/l`, `8/0`, `6/9`, `3/E`, `3/B`, `3/S` and `3/8` differ by at
  least 4 pixels both as drawn and at their closest shift
  (`test/j2.test.ts`). `3`'s bowls open to the left (cut corners on the
  right, a short tongue, no left stroke): never a mirrored `E`. A serif
  family's advance counts its serif pad once, not twice, so slab and foot
  families aren't over-tracked; organic text advances at most 1.27x its
  letters' width (it was up to 1.66x).
- **Imported TrueType and WOFF 1.0, parsed here** (`loadFont(bytes, size)`):
  cmap formats 4 and 12, simple and composite glyf, kern format 0, OS/2
  heights, and a small built-in inflate for WOFF. The hinting pass is made
  for pixel art. The scale puts the cap height at exactly `size` px, and
  vertical positions are mapped piecewise so the baseline, x-height and cap
  line land on pixel edges. Coverage then goes through a 0.5 threshold with
  dropout control (a short run with no pixel on keeps its strongest pixel;
  a long one is the soft side of a stroke, left alone).
- **OTF (CFF) and WOFF2 go through the browser** (`loadBrowserFont(bytes |
  "local('Georgia')", size)`): FontFace, then a canvas, then the same
  threshold and dropout pass. The parser here doesn't read CFF charstrings
  or Brotli. `parseFont` says so and points to this path.
- **BMFont / AngelCode** (text and XML formats, `bmFont(parseBmFont(fnt),
  [decodePng(page)])`) and **image grids** (`gridFont(sheet, { cellW,
  cellH, chars })`, trimmed to proportional).
- **Stored** as `keel/ui/font@1`: glyph bitmaps as packed bits (codec
  `planes(1)`) with metrics and kerning. An 8 px font is 1,239 bytes. A
  generated font can be stored as its recipe instead, `keel/ui/font-recipe@1`,
  in under 40 bytes.
- **Glyph atlas:** the same approach as bake's sprite cache. Sprites are
  keyed by content (a font's content hash plus the code point; an icon's
  name, size, tone and theme key), made once, and shelf-packed into one
  page. `takeDirty()` reports the region a texture upload needs.
- **Layout** (`layoutText`): greedy wrap at spaces, with a word longer than
  the line broken between letters. Align left, centre or right, an
  ellipsis on the cut line, `maxLines`, kerning, tabular figures, and rich
  runs: `"{icon:mass} {good}+25{/} {#ff0}hot{/} {tab}0123{/}"`.

## Icons

`iconBitmap(name, size, theme)` draws from a shape grammar of primitives:
bars, discs, rings, polygons, strokes, stars, gears and arrow heads. The
recipes cover 44 semantic names: attack, move, stop, hold, patrol, build,
upgrade, supply, resource, mass, energy, crystal, flux, biomass, salvage,
gather, repair, cancel, rally, research, train, ability, vision, cloak, scan,
armor, damage, speed, range, health, timer, menu, settings, alert, worker,
load, unload, attack-move, pause, play, close, check, chat and ping.
The theme's seed picks the variant and its small choices (which sword, how
long the blade, which way it faces). A name the grammar doesn't know still
gets a seeded shape. **Families** (`iconfamily.ts`): each culture redraws
the same symbol in its own hand -- industrial a stencil (a chamfered,
gear-notched, bolted plate with the symbol cut through it), organic grown
(bent a little, melted round, knobbed ends like bone), crystalline faceted
(curves cut to facets, a crack, shards in the corners), arcane a seal (a
ring with rune marks, the symbol small inside), brutal heavy (doubled
pixels on a slab, a hard shadow), clean thin (a one-pixel line over a
rule). Drawn on a button (`{ on: face }`, which buttons pass), every
colour of an icon's shape is moved in lightness until it is at least 3:1
off the face, and a one-pixel line is lit, never shaded into it: the worst
command-icon pixel is 3.00:1 in every family (it was 1.00:1).
`iconBitmap` draws in the theme's culture's family unless
`{ family }` says otherwise (`"plain"` is the grammar's own drawing, what
`iconMask` gives by default); under 18 px a family drops its extras
(notches, bolts, shards, the crack) and gives the symbol more room, and
below 10 px every icon is plain. Over the 15 command icons at 16 and 24 px,
the mean IoU of two cultures' shapes is at most 0.45 (0.56 counting the
painted outline; it was 1.0, a recolour), and every family's icons stay
distinct from each other. Each mask is rasterised crisp at its exact size, then
shaded like pixel art (outline outside, highlight top-left, shade
bottom-right, one shine pixel) and painted in the theme's ramps in its style:
solid, outline or duotone.

**Wireframes** (`wireframeOf(silhouette, size, { margin, fill, detail })`):
a game's silhouette (`{ w, h, solid, edges? }`: a sprite's solid texels and
the edges between its parts) as a LEVEL icon -- shadow ring, contour line,
part-edge detail, a sparse dithered body -- fitted by a whole factor (up by
an integer -- at most `maxScale`, so a group's types compare -- or down by
coverage). `ui.registerIcon(name, levelIcon)` paints
it in whatever `tone` a node asks for (`good`/`warn`/`bad`: the selection
grid's health tint), one icon per type.

**Cursors** (`generateCursor(kind, theme, { scale })`): the pointer, the
order cursors (the pointer wearing a grammar icon: move, harvest, place,
blocked), `attack` and `target` crosshairs and the eight `scroll-<dir>`
arrows, drawn crisp and shaded in the theme's ramps, scaled up by a whole
factor (at most 128 px), with the hotspot. A page makes a PNG of the bitmap
(`encodePng`) for CSS `cursor: url(data:...) x y`.

Imports: `iconFromImage(decodePng(bytes), 16, { palette, outline })` and
`iconFromSvg(svgText, 16, { palette })`. The SVG path handles path, rect,
circle, ellipse, polygon and polyline, with fills and translate, scale,
rotate or matrix transforms; arcs are drawn as chords. Both are
palette-snapped in OKLab. Add one with `ui.registerIcon(name, bitmap)`.

## Widgets, layout, input

Retained mode. Widgets are panel, button (hover, press, disabled, active,
primary, a cooldown sweep, a hotkey badge, a count), label, icon, bar
(health tone, segments, a trail, text), grid (command cards), list, tooltip,
minimap frame (with its content or a transparent hole, plus the camera
rectangle), portrait frame, tabs, toast, modal, slider, toggle and spinner.
The loading screen is composed from these.

- **Layout:** anchors for free placement, flex rows and columns (gap, pad,
  align, justify, grow) and grids. Sizes are pixels, `"fit"`, `"fill"` or
  `"40%"`. Everything lands on whole pixels, and the leftovers that don't
  divide go to the first children.
- **Scale:** the UI draws into its own layer, the screen divided by a whole
  UI scale. `uiScaleFor` aims at 640×360, so 1080p is ×3, 1440p ×4 and 4K
  ×6. A safe area is given in device pixels.
- **Input:** `pointerMove/Down/Up` in screen pixels (`pointerDown(x, y,
  { button })`: 0 left, 1 middle, 2 right), then hit-testing, the topmost
  interactive node wins. `overUi(x, y)` tells the game whether a click
  landed on UI. `key(code, down)` handles hotkeys (`"KeyQ"` and `"q"` both
  match `hotkey: "Q"`; a changed or cleared hotkey takes effect at once,
  even when nothing moves), Tab and Shift-Tab, spatial arrow navigation,
  Enter and Space, and Escape (closes a modal, otherwise emits `back`).
  A game that uses those keys itself turns them off with `navigation:
  false` (or `{ tab, arrows, enter }` per key; `ui.navigation` changes it
  later): `key()` then returns false for them, except inside a modal.
  `pad({ up, down, left, right, a, b })` edge-triggers the same. Tooltips
  appear after 0.35 s. Events: `click` (its value says which `button`),
  `change`, `hover`, `modal`, `back`, and `minimap`: `{ x, y, button,
  phase, inside }` -- 0..1 of the minimap's PICTURE (inside its frame,
  clamped), the button, and `down` at the press, `drag` for every move
  while held (anywhere on screen), `up` at the release.
- **Labelled buttons with a hotkey** show it as a keycap beside the label
  (the button measures wider), never over the text; icon buttons keep the
  corner badge.
- **Tooltips:** `tooltip: { font, maxW }` sets their type and width (a
  dense console's tips in its own small type). A node with `tipDock: true`
  (the classic console) docks the tooltips of everything inside it just
  above itself, right-aligned to the hovered node: never over the panel.
- **Bars** draw their label with a 1 px outline (`drawText`'s `outline`) in
  whichever of the theme's darkest and lightest colours stands furthest
  from it (`barLabel`: 16.8:1 at worst over 6,000 themes), and their segment
  ticks stop short of it. A button's `hp` (0..1, `null` for none) draws a
  health strip along its bottom, 2 px or more, good over 66%, warn over
  33%, bad under; `iconFill` draws its icon as big as its room allows, and
  `ui.iconSizeOf(id)` says how big that is (what to bake a registered icon
  at). A grid with `reflow` picks its rows from how many children show and
  fills its box with them. A disabled button dithers its
  face first and draws its icon over it in the dim ink.
- **Modal scrim:** a `modal` node (`ui.modal()`, or a game's own modal
  document added to `ui.overlay`) darkens what's under it solidly: every
  drawn UI pixel becomes a darker shade of itself (OKLCH, same hue, about
  half the lightness), so a label under the game menu keeps its exact glyph
  mask, only dimmer; where nothing is drawn (the game shows through) it
  paints one flat, opaque, very dark colour (the deepest surface darkened):
  a blackout behind the menu, no pattern anywhere. `scrim: "dither"` on the
  modal node (or `ui.modal({ scrim: "dither" })`) keeps the old even checker
  over the world instead. No checker ever lands on text.
- **Retained drawing:** `set()` compares values. Cooldowns compare in 64ths,
  and a counter whose content measures the same size doesn't lay anything
  out again. A paint-only change redraws that node's rectangle. Dirty
  rectangles are merged and then redrawn in painter's order, clipped. A
  static frame does nothing and returns `[]`.

**Where it draws, and why not keel/render:** keel/render is the raymarched
pixel renderer and bake draws the sprites. Neither has a compositing hook,
and the UI shouldn't need either loaded. So the UI composes its own
palette-true layer, and a presenter shows it in one of two ways:

- `createCanvasPresenter(canvas, ui)`: a 2D canvas above the game's. Changed
  rectangles go in with `putImageData`, and CSS `image-rendering: pixelated`
  scales it up. A static HUD costs nothing.
- `createGlPresenter(gl, ui)`: into the game's own WebGL2 context, after the
  game's frame. `texSubImage2D` uploads the dirty rectangles, then one quad
  at the UI scale draws the layer. That is one texture and one draw call,
  and it restores the state it touches.

The WebGL2 context is the seam. Any game drawing with GL (keel/render, bake's
sprites, terrain) passes its context in.

## Layout documents

A screen is data (`ScreenDoc`: `{ screen, theme?, root: NodeDoc }`). The
JSON view is what the editor and agents author. `UI_SCREEN`
(`keel/ui/screen@1`) is the stored form: a recursive node, every prop
optional, with ids, tones, icons, keys and actions going through shared
string tables. A generated HUD is 1,620 bytes as codec against 4,716 as
JSON. Props added since (`tipDock`, `trim`, `edge`, `scrim`, `reflow`,
`iconFill`, `hp`) ride in an extension
group of the node struct, so older records still read. Related calls: `buildNode` / `docOf`, `findDoc`, `walkDoc`, and
`overrideDoc(doc, { "cmd.0.4": { icon: "damage" }, minimap: null })`.

## Generated screens

- `generateHud({ seed, culture, width, height, slots, layout, pins, overrides })`
  - **`slots`:** `resources` (a count or a list), `commandCard` (cols,
    rows, buttons; row 1 is move, stop, hold, patrol, attack; the hotkeys
    form the QWERT grid), `minimap` (optionally `{ hole: true }` for a GL
    minimap), `selection` (`{ group }`), `portrait`, `queue`, `clock`,
    `alerts`, `idle`, `menu`.
  - **`layout`:** the seed picks a full-width console or floating islands,
    mirrored or not, a top strip or pills, the button cell size, the gap
    and see-through panels. Each culture leans its own way; pin any of
    them here.
  - **`layout.preset: "classic"`** (or `layout.console: 0.15..0.4`): the
    late-90s strategy console, the same layout for every seed and culture
    (the theme and the console's silhouette change, never where anything
    is). One full-width bottom panel `console` high (default
    25% of the UI height; at 640x360 that's 90 px), and in it: the minimap
    bottom-left (a square the console's inner height), the selection in the
    centre -- `unit` (name, `unit.rank`, health, shield and `unit.energy`
    bars, a `unit.info` line, attack/armour/speed, the `queue.<i>` slots and a `queue.bar`
    progress bar) or `group` (a 2-row grid of `group.<i>` cells; the game
    shows one, hides the other) -- the portrait centre-right, and the
    command card bottom-right with its cells as tall as the console allows.
    The group fills the selection panel whatever its size: `group.cells`
    reflows the cells that show -- one unit one big cell, 2-4 one row, 6 two
    rows of three, 12 two of six (39 x 38 px at 640x360) -- each icon as big
    as its cell (`ui.iconSizeOf("group.<i>")`: 67 px for 1-3 units, 56 for 4,
    30 for 6 or 12), and `group.summary` in the column at the right (small
    type, centred; hide it and the cells widen into it). With 1, 2, 3, 4, 6
    or 12 units, the largest empty rectangle in the panel is at most 12.5% of
    it at 1280x720 through 3840x2160 (it was 52% with 12).
    Menu buttons top-left (`slots.menuButtons`, default Menu/F10; ids
    `menu`, `menu.<id>`), resource pills top-right, the idle-worker button
    and the alert lines just above the console. Paddings and gaps are
    explicit, so two themes' consoles line up to the pixel. The console's
    **silhouette** follows the culture (`silhouette.ts`): four trim nodes,
    `trim.0`..`trim.3`, stand behind its top edge over the minimap, the
    selection, the portrait and the card -- the same rectangles for every
    culture -- and each paints its culture's shape (`trim: "<kind> <rise>
    <foot>"`): organic lobes over the minimap, portrait and card; industrial
    stepped, bolted plates the whole width; crystalline shards and a cut
    crest over the card; one arcane arch; brutal crenellated slabs; a clean
    thin rail held high on posts. The console's own top edge is cut the
    culture's way too (`edge: "<kind> <depth>"`: bites, steps, vees, arcs,
    crenels, flat), showing what's under the cut. Any two cultures' console
    outlines (the band from the highest trim through the console's top 20%,
    plus a ring round each frame) differ in at least 18% of their pixels;
    every hit area stays identical. The idle button and the alert lines
    sit just above the trims. The single readout is name + stats, rank,
    health (+ shield), a two-line `unit.info`, and at the bottom
    `unit.detail` or the queue. The top-left buttons are sized from the UI's
    height, the same in every culture: icons 11 px at 640x360 (never under
    9) with the buttons tall and wide enough for them and the widest
    culture's type.
  - **Ids:** `res.<id>`, `clock`, `menu`, `minimap`, `portrait`,
    `unit.name`, `unit.hp`, `unit.shield`, `unit.armor`, `unit.damage`,
    `unit.speed`, `queue.<i>`, `group.<i>`, `cmd.<row>.<col>`, `alert.<i>`,
    `idle` (classic adds `bottom`, `top`, `menus`, `unit`, `unit.rank`, `unit.info`,
    `unit.energy`, `unit.stats`, `selection`, `queue`, `queue.bar`,
    `group`, `group.cells`, `group.summary`, `trim.0`..`trim.3`).
- `generateMenu({ seed, culture, title, subtitle, items, footer })`: a
  centred panel, a left column or a bottom row, over a backdrop in the
  theme's texture. Ids are `menu.<action>`.
- `generateLoading({ seed, culture, title, tip, status })`: `loading.bar`
  (segmented), `loading.status`, `loading.spinner` and `loading.tip`.

## Measurements

A full RTS HUD: 60 buttons (the command card, queue, a 16-unit group, 22
control-group buttons, idle, menu), bars, labels, a minimap and a portrait,
92 nodes in all. Per frame, `tools/bench.ts` (`node packages/ui/tools/bench.ts`,
Node 22, M-series Mac):

| screen | static frame | animated frame (15 cooldowns, 3 bars, clock and a counter every frame) | full redraw | first frame (fonts, icons, atlas) |
| --- | --- | --- | --- | --- |
| 1920×1080 at ×3 (640×360 layer) | 0.4 µs | 0.29–0.46 ms (9.3k px redrawn) | 1.4–1.7 ms | 44–48 ms |
| 1920×1080 at ×1 | 0.2 µs | 0.46–0.56 ms (35k px) | 2.7–3.0 ms | 16–32 ms |
| 1440×810 at ×3 | 0.2 µs | 0.15 ms (6.2k px) | 0.8 ms | 7 ms |

In the browser (Chrome, the tool page's bench view), 640×360 measured
0.09 ms animated and 0.42 ms for a full redraw. At 120 fps the frame budget
is 8.3 ms, so a static HUD costs nothing and an animated one costs about 1%
of the budget. When run under the whole suite's parallel load, the test
(`test/perf.test.ts`) measures several times these numbers, and its bounds
allow for that.

Other figures from the tests:

- **Themes:** 1,000 seeds per culture give 994–999 unique signatures
  (surface and accent hue in 10° buckets, frame, font and motion choices).
  The feature-space nearest neighbour is always more than 0 away (mean
  0.11–0.17). Neighbouring themes' panel and accent colours are ΔE(OKLab)
  0.09–0.33 apart on average.
- **Contrast** over 6,000 generated themes: worst ink on any panel surface
  5.50:1, worst dim ink 4.60:1 (it was 3.20:1; dim stays dimmer than ink,
  by 0.05-0.13 OKLab lightness), worst primary-button label 5.57:1.
- **Fonts:** 100 seeds draw 68 different 8 px fonts and 78 different 12 px
  ones, counted by their pixels. At small sizes nearby parameter sets draw
  the same font, so themes rather than fonts carry most of the
  distinctness. Every letter and figure is distinct at 7 px and up, square
  and round families alike.
- **Module size:** `keel/ui` is 125 KB, 48.6 KB stored, in a KEEL document
  (`keel-sdk/examples/game-engine/ui-demo`).

## Tools

`tools/ui.html`: build it with `node packages/ui/tools/build.mjs`, serve it
with `node scripts/serve.mjs`, then open
`http://localhost:4300/packages/ui/tools/ui.html`. Adding `?capture` to a
view saves PNGs into `out/ui/`. The views:

- `themes`: the seed strip, 6 cultures × 8 seeds with their palettes.
- `fonts`: the font lab. Generated families by culture, the BMFont fixture,
  a TrueType font built in-page, and browser-rasterised system fonts.
- `hud`: 480×270 at ×k over a stand-in game, live and interactive.
- `hud1080`: 1920×1080 drawn into the game's own WebGL2 context.
- `menu`, `loading`, `bench`.

`tools/bench.ts` is the benchmark. `tools/sheet.ts` writes a glyph sheet
PNG from Node. `tools/j2.ts` (`node packages/ui/tools/j2.ts`) prints the
J2 numbers and writes the evidence sheets into `out/ui/j2/`: the confusable
glyphs per culture at 6, 8 and 12 px, the classic console with a 12-unit
group per culture at 1920x1080's layer, the six silhouettes stacked, the
command icons in every family, the game menu over a HUD with a close-up of
a label under the old checker and the new scrim, and the top-left buttons.
`tools/keel5-fixture.ts` rewrites the BMFont test fixture from the default
family at 5 px: run it after changing a glyph recipe.

## Tests

The tests are `test/*.test.ts` (43 tests):

- **Determinism:** theme bytes, and the layer and atlas pixels.
- **Distinctness** over 1,000 seeds, and **contrast** over 6,000 themes.
- **Pins and codec:** pins stay independent; the theme, font and font
  recipe each round-trip through the codec.
- **Layout:** wrap, align, ellipsis, tabular figures, rich runs; for
  widgets, whole-pixel flex and grid, anchors, and the safe area.
- **Imports:** the BMFont fixture (text and XML), an image grid, a TrueType
  font built in the test (curves, a composite, kerning, hinting) and its
  WOFF wrapping, and Source Code Pro (SIL OFL) when this machine has it.
- **Icons:** icons at three sizes, SVG and PNG import.
- **Input:** hit-testing, hotkeys, focus and gamepad navigation, modals,
  tooltips, and the list, tab, slider and toggle controls.
- **Drawing and screens:** dirty rectangles, the screen document codec with
  overrides, every generated screen in every culture, and the benchmark.
- **The console** (`test/console.test.ts`): a changed hotkey fires at once
  without a layout; the minimap's down/drag/up with the button on its
  picture; claimed navigation keys; the classic preset's proportions and
  pixel-identical layout across 6 cultures x 3 seeds x 4 sizes; wireframes
  and their per-node tints; cursors (every kind, whole-scaled, distinct per
  kind and theme); a labelled button's keycap; docked tooltips and
  readable disabled icons.
- **J2** (`test/j2.test.ts`, measured with `test/j2-metrics.ts`): the
  confusable glyph pairs 4+ pixels apart in every culture's family; the
  group filling the selection panel (largest empty rectangle 18% or less at
  720p..4K); the console silhouette 12%+ apart between any two cultures
  with identical hit areas; command-icon families (mean IoU 0.6 or less
  culture to culture, each family's icons distinct); and a label under a
  modal keeping its exact glyph mask while the open world gets one flat dark
  colour; the top-left buttons' icons 7 px or more, whole, with the same
  rectangles in every culture; small selections (1-12 units) filling the
  panel with icons 55%+ of their cells; the health strip; 3 never a mirrored
  E and organic advance 1.3x or less; icon shapes 3:1 off their cells and
  bar numbers 4.5:1 off their outline.
