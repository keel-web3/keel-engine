# `@keel-engine/render`

The realtime pixel renderer (WebGL2) and its post fx: a world of boxes, wedges
and capsules (and the water and the sky) drawn at a **target size**, quantized
to a palette, dithered and outlined. Module `keel/render@0.1.0` (`kind:
"runtime"`, needs `keel/core@^0.1`: the frame's `cameraBasis`, the dither
screens).

```ts
import { createPixelRenderer, resolveFx, ALL_FX } from "@keel-engine/render";
import type { PixelRenderer, RenderWorld, Material, FxEntry } from "@keel-engine/render";
```

A TypeScript port of the proof of concept's `src/gpu` and `src/fx`
(`../keel-pixel-engine`), names unchanged, proven identical:

- `test/poc-equality.test.ts` — every limit and every GLSL string, character
  for character; `resolveFx` / `fxUniforms` / `toggleFx` over 6,000 random
  lists and targets (every pass, odd params, duplicates, throws); every screen
  tile byte for byte; and **both renderers driven through 160 random sessions
  on a recording WebGL2 stand-in** (palettes, materials, styles, worlds past
  the limits, fx, targets, frames with particles, with and without the timer
  query): ~139,000 GL calls, identical argument for argument.
- `tools/parity.html` — the pixels, on a real GPU: the proof of concept's fx
  sheet scene through all 20 fx rows at 32 / 64 / 128 / 256 (two times, for
  cycling and water), both renderers, pixel for pixel. Last run: 160 frame
  pairs, 3,481,600 pixels a side, **0 differing, 0 off-palette**. Build with
  `node packages/render/tools/build.mjs`, then open
  http://localhost:4300/packages/render/tools/parity.html (`globalThis.parity.summary`).
  The proof of concept is imported from its own server (localhost:4200) when
  the page may (it sends no CORS headers, so usually it can't), else from a
  bundle of its source (`tools/dist/`, gitignored).
- `test/fx.test.ts`, `test/gpu.test.ts` — the proof of concept's own tests, ported.

| Module | What |
| --- | --- |
| `pixel-renderer.ts` | `createPixelRenderer(canvas, { width, height })`: the world at a target size, quantized, dithered, outlined, fx'd; `paletteRamps(palette)` (engine) |
| `shaders.ts` | the GLSL (`WORLD_FS`, `POINTS_VS` / `POINTS_FS`, `PIXEL_FS`, `FULLSCREEN_VS`) and the limits (`MAX_*`) |
| `fx.ts` | `FX`, `FX_ORDER`, `FX_NAMES`, `resolveFx`, `toggleFx`, `fxUniforms`, `ALL_FX`, `screenTile`, `GRADE_PRESETS` — pure, no GL |
| `raster.ts` | **engine:** raster mode -- `RasterSolids`, `RasterMesh`, the box and capsule templates, `RASTER_VS` / `RASTER_FS`, `DEPTH_OUT_FS` (see [Raster mode](#raster-mode-engine-rasterts)) |
| `indexed.ts` | **engine:** bake mode's programs -- `BAKE_WORLD_FS` (WORLD_FS + surface coordinates + a split point), `INDEX_FS`, `DEPTH_FS`; `readIndexedPixel`, `unpackDepth` |

## The pipeline

1. **World pass** (at the target size): raymarch boxes, wedges and capsules,
   the water plane, the sky; light, shadow, patterns. Writes two buffers:
   `lightness, ramp, material, id` and `glow, facing`. Particles go into the
   same buffers as points, depth-tested.
2. **Pixel pass** (at the target size): each pixel's lightness becomes a
   position on its ramp; **the fx move it** — up or down the ramp, or onto
   another ramp; then the dither screen picks an entry. So every fx comes out
   dithered in palette entries: **palette-true**, always; there is no
   full-colour path (quantizing to palette ramps through a screen is the
   model). The outline and palette cycling act on the chosen entry. The
   canvas is W × H; CSS scales it up (`image-rendering: pixelated`).

## Types

| Type | What |
| --- | --- |
| `RenderBox` | `{ c, h, yaw?, mat?, kind?, lo? }` — a box turned about y (core frame); `kind: "wedge"` makes it a wedge |
| `RenderWedge` | `{ c, h, yaw?, lo?, mat? }` — a ramp: the foot at local +z (`lo` × its height, 0..0.98), full height at −z |
| `RenderCapsule` | `{ a, b, r, mat? }` |
| `RenderWorld` / `WorldCounts` | `{ boxes?, wedges?, capsules? }` / what `setWorld` took: `{ boxes, wedges, capsules, dropped }` |
| `Ramps` / `Colour` | `{ name: [base, length] }` in ramp order / `[r, g, b]` bytes (core's `RGB`, or any indexable) |
| `Material` | `{ ramp, light?, pattern?, glow? }` |
| `RenderStyle` / `StyleInput` | `{ screen, dither, outline }` (screen: 0 / 2 / 4 / 8 or a core `ScreenId` / `"none"`) / the same, each optional (`outline` may be a boolean) |
| `RenderParticle` | `{ p, size?, light?, ramp?, glow? }` (`@keel-engine/particles`' `list()` gives these) |
| `RenderOptions` | `{ eye, target, fov?, time?, sun?, waterY?, fogNear?, fogFar?, particles? }` |
| `RendererLimits` / `RenderCanvas` / `PixelRenderer` | the limits plus the GPU's own / anything with a WebGL2 context / the renderer |
| `FxName` / `FxEntry` / `FxList` | the 11 passes / `{ name, on?, ...params }` (params typed per pass) / a list |
| `FxParams` / `FxResolvedParams` / `FxResolved` | each pass's params as given / as resolved / `{ name, on: true, params }` or `{ name, on: false, params, note }` |
| `FxTarget` / `FxLook` / `FxUniforms` / `PixelUniforms` | a number, `{ width, height }` or `[w, h]` / what `fxUniforms` knows of the palette / its result |
| `RampRef` / `EntryRef` | a ramp by name or index / `{ ramp, index }` (negative from the top) or a raw palette index |

## Renderer API

```ts
const px = createPixelRenderer(canvas, { width: 128, height: 128 });
px.setPalette(colours, ramps);        // [[r,g,b], ...] 0-255; { name: [base, length] } in ramp order
px.setMaterials([{ ramp: "stone", light: 1, pattern: 1 }, ...]);
px.setStyle({ screen: 4, dither: 0.9, outline: 1 });
px.setWorld({ boxes, wedges, capsules });        // returns { boxes, wedges, capsules, dropped }
px.setFx([{ name: "glow" }, { name: "vignette" }]);
px.render({ eye, target, fov, time, sun, waterY, fogNear, fogFar, particles });
px.setTarget(256, 256);                           // re-resolves the fx for the new size

// A core palette straight in:
const pal = buildPalette(makePalette(S));
px.setPalette(pal.colours, paletteRamps(pal));   // { key: [base, len], accent: [...], ... }
```

| Call | Notes |
| --- | --- |
| `setPalette(colours, ramps)` | up to **65,536 colours** (a texture 1024 wide, as many rows as needed) and **256 ramps** of any length (a 64-entry ramp is fine). Throws past the limits. |
| `ramp(name)` | a ramp's index (0 for a name it doesn't know) |
| `palette` | the colours as set (what a palette-true frame's pixels must all be) |
| `setMaterials(list)` | up to **255 materials**: `{ ramp, light = 1, pattern = 0 (1 checker), glow = 0 }`. `glow` adds lightness and marks the material emissive for the glow fx. Material **4 lights the water, 5 the sky**; 255 is the particles'. |
| `setStyle({ screen, dither, outline })` | `screen` 0 / 2 / 4 / 8 (Bayer) or any core screen id (`"stipple"`, `"halftone"`, ...); `dither` 0..1; `outline` on/off (the classic: 3 entries darker against anything 0.56 m behind). |
| `setWorld({ boxes, wedges, capsules })` | past a limit the rest are dropped and counted in `dropped` |
| `setFx(list)` / `toggleFx(name, on)` / `fx` / `fxResolved` | the fx list (below); `fxResolved` is the list as resolved for the current target |
| `render({...})` | `particles: [{ p, size, light, ramp, glow }]` (`glow` 0..1 makes a speck emissive for the glow fx) |
| `read()` / `offPalette(pixels?)` | the frame's RGBA (bottom row first); how many pixels aren't palette entries |
| `limits` / `gpuMs` | the limits below plus the GPU's own; the last GPU frame time where `EXT_disjoint_timer_query_webgl2` exists (unreliable on ANGLE/Metal) |

### Bake mode (engine; indexed.ts)

For `@keel-engine/bake`'s indexed sprites -- a baked shape that any look paints at draw time -- the renderer can say
WHAT each pixel is instead of its colour:

| Call | Notes |
| --- | --- |
| `renderIndexed({ ...render's options, gap?, split? })` | pass 1 through `BAKE_WORLD_FS` (WORLD_FS, plus each hit's surface coordinate in data2's free `.zw`: round and along a capsule, across a box's face; with `split`, whether the hit is behind that point from the camera, in pass 1's ramp channel), then `INDEX_FS` into a framebuffer of its own (returned): per pixel `r = 128 covered + 64 outline edge + 32 behind + material (0..31)`, `g` shade, `b, a` the coordinate; 0 where nothing is. `gap`: the outline's depth gap (m, default 0.56 -- the classic) |
| `readIndexed()` | that picture's bytes (bottom row first); `readIndexedPixel(r, g, b, a)` takes one apart |
| `readData()` | the last frame's pass-1 buffers as they are: `{ width, height, data, data2, depth }` (depth through `DEPTH_FS`, 24 bits) |

The proof of concept's strings in `shaders.ts` are untouched (`BAKE_WORLD_FS` is derived from `WORLD_FS` by exact
text edits that throw if it ever changes under them), and nothing is compiled until a bake asks: a normal frame's
GL calls are the same as ever (`test/poc-equality.test.ts` still compares them with the proof of concept's, call
for call; `test/indexed.test.ts` checks a frame after a bake makes the same calls as one from a renderer that never
baked).

### Raster mode (engine; raster.ts)

The raymarcher holds 256 boxes, 128 wedges and 256 capsules and marches all of them for every pixel: a course, a
character, a room. A world seen from the ground -- a first-person view of a level, a chase camera over it -- has
thousands of things near enough to be solid. Raster mode draws **triangles into pass 1's own buffers** (lightness,
ramp, material, id; glow, facing; depth as the ray's length over FAR), so the pixel pass turns them into pixel art
exactly as it does the raymarched world: palette ramps, the dither screen, the outline, the fog, every fx.

```ts
px.setMesh("terrain:3", { positions, normals, looks });          // static: uploaded once ([mat, ramp, shade, id] per vertex)
const solids = new RasterSolids(8192);                            // instanced, any number
solids.capsule(a, b, r, mat, { ramp, id, fade }); solids.box(c, h, yaw, mat); solids.wedge(c, h, yaw, lo, mat);
px.render({ eye, target, fov, waterY: -1e4, raster: { solids, meshes: ["terrain:3"], waterY: river }, depthOut: true });
sprites.drawBillboards(camera, layers);                           // keel/bake: hidden by what's in front
```

| Call | Notes |
| --- | --- |
| `setMesh(key, mesh \| null)` | a static mesh (a terrain chunk) uploaded once; null removes it. Non-indexed or `indices` (Uint32). |
| `RasterSolids` | boxes, wedges, capsules as 16 floats each (layout in raster.ts); `append(block)` copies whole instances in (a tree's solids made once), `snapshot()` |
| `render({ raster })` | after the world pass and the particles: meshes, then one instanced draw per kind, depth-tested against what's there. `raster.waterY`: the water's glow on what's rasterised (the raymarched plane off with `waterY: -1e4` when the water is meshes) |
| `render({ depthOut })` | after the picture, pass 1's depth into the canvas's depth buffer (x scale + bias; true: as it is) -- so billboards drawn next are hidden by hills and houses |
| `rasterStats` | meshes, triangles, instances drawn last frame; mesh bytes held |

- **Lighting** is WORLD_FS's (the same sun, sky light, material scale, the water's glow, the checker pattern), less the
  raymarched soft shadow -- checked against its text in `test/raster.test.ts`. Two more patterns for a ground seen
  close (material pattern 2 **grain**, 3 **strata**) and a rippling water surface (material 4); a part's **ramp
  override** (a unit's own look, 200 ramps a frame in the level demo), **light**, **glow** and **id** per instance.
- **Fade**: a solid's `fade` (0..1) dissolves it through a 4x4 Bayer screen anchored to the picture; keel/bake's
  billboards dissolve the other way, so a thing switching between its sprite and its solid cross-fades with no alpha.
- **Templates**: a box (24 vertices, flat faces; its wedge is the same box with the +z top edge lowered in the shader)
  and a capsule (8 round x 2 rings a hemisphere: 80 triangles). Clip-space w is the view depth (perspective-correct),
  the depth written is the distance over FAR.
- **Defaults untouched**: raster mode compiles its two programs the first time a frame or a mesh asks. A renderer that
  never rasterises makes the proof of concept's GL calls, call for call (`test/poc-equality.test.ts` unchanged and
  passing), and a frame after a raster frame is argument for argument a plain frame (`test/raster.test.ts`).
- Measured in `examples/level-demo` (a valley seen from a unit's eyes, 480 x 270): ~9,000 instances, ~580,000
  triangles, 8-12 terrain chunks -- render() 0.2-0.4 ms of CPU; the frame's GPU work ~2 ms.

### Limits (a full game shouldn't meet them)

| What | Limit | Where it lives |
| --- | --- | --- |
| colours | 65,536 (1024 × 64 rows; raise `MAX_COLOURS` freely up to the GPU's texture size) | palette texture |
| ramps | 256 (8-bit in the data buffer) | ramp texture, 256 × 2 RGBA32F |
| materials | 255 (+ the particles') | material texture, 256 × 1 RGBA32F |
| boxes / wedges / capsules | 256 / 128 / 256 | three std140 uniform blocks, each ≤ 16 KB (WebGL2's baseline block size) |
| plain uniforms | under 60 vec4 per fragment shader | far inside WebGL2's baseline 224 (`test/gpu.test.ts` checks) |
| fx | one of each pass; flash: 8 materials + an id range | pixel-pass uniforms |
| ids | 250 things tell apart for the outline (boxes `i`, capsules `100 + i`, wedges `200 + i`, mod 250); 253 particles, 254 water, 255 sky | data buffer alpha |

Nothing here assumes a GIF, 32 colours or a 256-entry table. The march's
cost grows with the solids in view: hundreds work but march slower (every
step visits every solid); thousands want culling (a grid or BVH) before the
march — the baker's job, not built yet.

## The fx list

`[{ name, on = true, ...params }]`, applied in `FX_ORDER`:
`crt, grade, fog, glow, rim, flash, vignette, scanlines, dither, outline, cycle`.
A later entry of the same name merges over an earlier one. Unknown names throw.

| Pass | Params (defaults) | What it does (all palette-true) | Target rule |
| --- | --- | --- | --- |
| `crt` | `curve 0.08, border {ramp, index}, minSize 64` | bends the picture (whole pixels moved, none invented); corners to the border entry | off below 64 px |
| `grade` | `preset "day" \| "dusk" \| "night"`, `shift` (entries; presets 0 / −0.6 / −1.4), `map { ramp: gradedRamp }` | colour grading by swapping ramps for their graded twins, then shifting along them | — |
| `fog` | `ramp "sky", near 25, far 90 (m), amount 1, light 0.3` | past `near`, pixels go over to the fog ramp — the screen decides which, so the edge is dithered | — (world units) |
| `glow` | `radius 3 (px at 128), halo 2.5, self 1, threshold 0.2, tint false` | emissive pixels (material `glow` ≥ threshold, or particle `glow`) climb `self` entries; round them a halo climbs `halo` entries of what's there (or, `tint`, wears the glow's ramp) — dithered | radius × side/128, 1..16 px |
| `rim` | `width 1 (px at 128), steps 1.5, dir "sun" \| [x, y]` | a thing's silhouette on the light's side climbs its ramp | width × side/128, 1..4 px |
| `flash` | `amount 0..1, mats [≤ 8], ids [from, to], ramp null` | the struck thing goes up its ramp toward the top (or onto `ramp`) | — |
| `vignette` | `inner 0.55, outer 1.1, steps 2` | corners step down their ramps, dithered | — (fractions) |
| `scanlines` | `period 2 (px at 128), steps 1, minSize 96` | every period, half its rows a step down | off below 96 px; period × side/128 |
| `dither` | `screen "auto" \| family \| id \| "none", amount 0.9` | the screen: `auto` = ordered; families `ordered dot line noise pattern`; any of the 13 core screens | `screenForTarget(W, H, pref)` (core): bayer2 ≤ 48, bayer4 ≤ 128, bayer8 above |
| `outline` | `mode "all" \| "outer" \| "none", steps 3, gap 1.5 (m, outer), color null \| {ramp, index}` | `all`: a thing against anything behind it (the classic); `outer`: only across a depth gap; `color`: one ink instead of darker entries | 1 px at every size (the engine's rule) |
| `cycle` | `ramps { name: { speed, from } }` or `[names]`, `speed 3 (entries/s), from 0.5 (of the ramp)` | palette cycling: a ramp's upper entries turn over — water shimmer, neon | — |

Without a list, the style's screen, dither and outline apply as before —
the proof of concept checked WALLRUN's frames pixel-identical to the renderer
before fx existed.

```ts
// Dusk over water, a lamp glowing, a struck enemy.
px.setFx([
  { name: "grade", preset: "dusk", map: { water: "waterDusk" } },
  { name: "fog", ramp: "sky", near: 20, far: 70 },
  { name: "glow", radius: 3, tint: true },
  { name: "cycle", ramps: { water: { speed: 3, from: 0.5 } } },
  { name: "vignette" }, { name: "scanlines" },
  { name: "flash", amount: hit, mats: [ENEMY_MAT] },
]);
px.toggleFx("scanlines", false);   // (a config lock can hold any pass on or off by name)
```

### `resolveFx(list, target)` (pure)

`target` is a number (square), `{ width, height }` or `[w, h]`; pixel params
are measured against the short side, "at 128 px". Returns
`FxResolved[]` — `[{ name, on, params, note? }]`; a pass the target can't
carry is `on: false` with a `note` (`"below 96 px"`). `fxUniforms(resolved,
{ ramp, rampOf, style, far })` turns that into the pixel pass's uniform values
(`{ u, ramps: { cycle, grade }, screen }`, also pure). The world runtime puts
passes under config locks by name and hands the resolved list to `setFx`.

## Resolution-free rules (audit of every pixel-sized constant)

| Constant | Where | Rule |
| --- | --- | --- |
| particle size | `POINTS_VS` | `size × 6 × H/128 / z`, min 1 px: the same size in the world at any target |
| tile pattern fade | `WORLD_FS` `tilePx`, `patternK` | a tile under ~3 px fades rather than aliasing; small targets quieten every pattern (28 → 96 px) |
| glow halo radius | fx `glow` | scales with the short side; tap count grows with it |
| rim width | fx `rim` | scales (1 px to 191, 2 at 256) |
| scanline period | fx `scanlines` | scales; off below 96 px |
| crt | fx `crt` | curvature is a fraction of the frame; off below 64 px |
| vignette | fx `vignette` | fractions of the frame |
| dither screen | style / fx `dither` | the project picks, or `dither: auto` → `screenForTarget` |
| outline width | `PIXEL_FS` | **1 px at every size — deliberately** (the engine's rule: the outline is the pixel art's line) |
| outline / rim depth gap | `PIXEL_FS` | in metres (0.56 m / `gap`), not pixels: the same edges at every size |
| march epsilon, normal step, shadow steps | `WORLD_FS` | world units (and relative to distance): the geometry is the same at every size; they are not pixel sizes |
| screen tile 192 | `SCREEN_TILE` | a texture's repeat (every core screen divides it), not a picture size; screens anchor bottom-left (GL's origin) |
| minimum target 8 px | `setTarget` | a floor, not a scale |
| default style `screen: 4` | renderer | the one unscaled default: pass a style (or the `dither` fx with `auto`) to fit the target |

## Performance

The proof of concept measured (its `tools/fx-sheet.html`, M-series Mac,
WALLRUN's course of 43 boxes and 43 capsules, round trip = draw + a 1-pixel
read): 128² 3.6–4.3 ms without fx, ≈ +0.5–1.5 ms with `ALL_FX`; 256² 4.1–5.4 ms,
fx within noise. The port makes the same GL calls (above), so the same
numbers hold; the fx cost is the pixel pass — glow's halo taps (≤ 48 per
non-glowing pixel) are the dearest, every other pass a few ALU ops or one
fetch. (The round trip includes the pipeline flush: an upper bound. The timer
query on ANGLE/Metal is not to be trusted.)

## Differences from the proof of concept

None in output. In the types: ramp names are looked up in a `Map` (a ramp
named `constructor` is just a name), and `resolveFx` refuses an inherited
property name as a pass (`"toString"` throws like any typo).


## Raster hooks, direct palette indices, a sky (engine)

- `raster: { draw(ctx) }`: a hook drawn after the meshes and solids into pass 1's own buffers (the framebuffer, both
  colour attachments and depth bound; `ctx` has the camera, the picture's size, FAR and the time) -- keel/terrain's GPU
  ground paints the terrain there. A pixel whose material is `DIRECT_MAT` (254, with `data2.a > 0`) carries a palette
  index straight; pass 2 is then `DIRECT_PIXEL_FS` (PIXEL_FS with that branch -- fog and outline still apply),
  compiled only for frames with a hook, so a renderer that never uses one makes the proof of concept's GL calls.
- `raster: { world: false }`: no raymarched world or sky -- pass 1 starts as sky at depth 1 for the raster to paint (a
  world that is all raster: the full-screen march was most of a 1080p frame).
- `createSkyPass(gl).draw(ctx, { ramp })` (sky.ts): a gradient and flat pixel clouds on a cloud deck (a cloud texel a
  fixed patch of sky: no crawling), only where pass 1 still shows the sky, on the fog's ramp.
