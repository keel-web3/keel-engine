# Engine targets and native graphics

The engine can show the same world through an original, 8-bit, 16-bit,
32-bit or 64-bit art profile. It also has Game Boy, Game Boy Color and
ModRetro Chromatic targets. A profile changes the renderer's pixel dimensions,
palette limits, channel precision and default dither screen. Geometry, game
state, camera and input stay in the game's existing systems.

The era names are adjustable visual conventions, not CPU emulation or video
bitrate. They do not mean an arbitrary TypeScript game can run on a console.

| Choice | Default pixels | Unique palette colors | Color precision | Native graphics |
| --- | --- | --- | --- | --- |
| Original | Game's authored size | Engine limit, 65,536 | RGB888 | — |
| 8-bit style | 256 × 240 | 16 | RGB888 | — |
| 16-bit style | 320 × 240 | 256 | RGB555 | — |
| 32-bit style | 512 × 384 | 32,768 | RGB555 | — |
| 64-bit style | 640 × 480 | 65,536 | RGB888 | — |
| Game Boy | 160 × 144 | 4 grayscale | Four shades | 2bpp tiles, map |
| Game Boy Color / Chromatic | 160 × 144 | 32 background colors | RGB555 | 2bpp tiles, map, attributes, palettes |

The style choices are intentionally generic; 16/32/64-bit machines varied in
their resolutions, palettes and rendering capabilities. These presets do not
claim NES, SNES, PlayStation or Nintendo 64 compatibility. Chromatic accepts
Game Boy and Game Boy Color cartridges and has a 160 × 144 display:
[ModRetro compatibility](https://support.modretro.com/en_us/welcome-to-chromatic-know-your-chromatic-SJS5feAZg).

## Switch an engine view

```ts
import { createPixelRenderer } from "@keel-engine/render";

const px = createPixelRenderer(canvas, { width: 320, height: 240 });
// Set the game's existing palette, materials, world, style and effects as usual.
px.setProfile(8);                // also accepts "8-bit"
px.setProfile(16);
px.setProfile(32);
px.setProfile(64);
px.setProfile("chromatic");
px.setProfile("native");         // restores authored size, palette and style

// Or select a profile on creation:
const handheld = createPixelRenderer(otherCanvas, { profile: "game-boy" });
```

Every switch derives from the authored palette, so repeated switches do not
accumulate color loss. Palette indices, ramp positions and names remain valid;
multiple entries may map to the same limited color. New `setPalette()` calls
also honor the selected profile. No profile is applied until requested, so
existing games keep their default render path.

`setTarget(width, height)` still allows custom sizes for original and style
profiles. A hardware preview enforces 160 × 144. Explicit `setStyle()` calls
can override the default dither; profiles leave the game's effects list intact.
The current profile is available through `px.profile`, and pure profile data
through `targetProfile()` / `TARGET_PROFILES` in `@keel-engine/core`.

This API applies to `createPixelRenderer` (including its raster hook). Other
renderers, such as the baked sprite renderer, can consume the shared profile
data and `adaptTargetPalette()`; their game integration is separate. It does
not automatically alter an editor, REDLINE's controls or every game renderer.

The hardware renderer view is a resolution and palette preview. Exact
per-tile palette allocation and tile-budget checks happen during native asset
export. The interactive preview shows both views side by side.

## Export native background graphics

```ts
import { exportGameBoyBackground, flipRows, gameBoyFiles } from "@keel-engine/capture";

const asset = exportGameBoyBackground({
  width: px.width,
  height: px.height,
  rgba: flipRows(px.read(), px.width, px.height), // WebGL reads bottom first
}, { target: "chromatic" });

const files = gameBoyFiles(asset, "my_scene");
// my_scene.c: all arrays together
// my_scene.tiles0.2bpp and, when needed, my_scene.tiles1.2bpp
// my_scene.tilemap, my_scene.attrmap, my_scene.pal
// asset.preview: exact output decoded into top-first RGBA
```

Any renderer or image pipeline can supply top-first RGBA, not just the pixel
renderer. The default conversion fits the source into 160 × 144 without
changing its aspect ratio, using nearest-neighbor scaling and white padding.
Use `fit: "stretch"` explicitly to fill the whole screen. Transparent pixels
are composited onto `background` (default white): these are opaque backgrounds,
not sprite sheets with sprite transparency. Custom output dimensions must be
multiples of 8 and at most 256 × 256.

The compiler deterministically selects at most four colors per 8 × 8 tile
and eight background palettes for color targets, and reports changed pixels.
Game Boy uses a single four-shade palette. It deduplicates tile patterns and
throws if the result needs more than 256 unique DMG tiles or 512 CGB tiles in
the selected unsigned addressing mode. It never drops or wraps tiles to force
an invalid asset to fit. Large images may need smaller sections or simpler art.

Native tile data has two bytes per row: low and high color-index bitplanes,
left pixel in bit 7. The CGB attribute's bits 0–2 select a palette; bit 3 selects
the tile-data bank. Palette words are little-endian RGB555. Formats and limits:
[tile data](https://gbdev.io/pandocs/Tile_Data.html),
[tile maps](https://gbdev.io/pandocs/Tile_Maps.html),
[palettes](https://gbdev.io/pandocs/Palettes.html).

For GBDK, load tile data at index 0 in each indicated VRAM bank with
`set_bkg_data`; keep LCDC bit 4 set (unsigned tile numbering). Load CGB palettes
with `set_bkg_palette`, write attributes with `set_bkg_tiles` while `VBK_REG=1`,
then write the tilemap with `VBK_REG=0`. The compact maps have `mapWidth` columns;
use `set_bkg_tiles`, which handles the hardware map's 32-column stride. For
Game Boy, set `BGP_REG` to the returned `dmgPalette` (0xe4). Write VRAM with the
display disabled or through safe library routines. Assets using both banks
occupy those tile slots; a game must reserve space for its other graphics.

These files are real native graphics assets. Porting game logic, sprites,
physics, audio, controls and memory use, compiling a playable ROM, emulator
playtesting and physical cartridge testing remain separate work. The engine's
browser runtime and on-chain modules cannot execute directly on a Game Boy CPU.

## Try the local preview

From this repository:

```sh
node packages/render/tools/targets-build.mjs
python3 -m http.server 4316 --bind 127.0.0.1
```

Open http://localhost:4316/packages/render/tools/targets.html. Choose a view
profile and an export target. Download the C file or individual native files.
The same engine scene, camera and time are used across every view. The build
uses this checkout explicitly even if root dependencies point at a pinned release.

Verification:

```sh
node --test packages/core/test/targets.test.ts packages/render/test/targets.test.ts packages/capture/test/gameboy.test.ts
node node_modules/typescript/bin/tsc -p packages/render/tools/targets-tsconfig.json
```

Tests include byte-level 2bpp fixtures, all RGB555 words, repeated profile
switches, palette budgets, tile deduplication, second-bank addressing and tile
overflow refusal. Browser verification and native graphics conversion do not
by themselves prove a playable ROM or physical Chromatic behavior.
