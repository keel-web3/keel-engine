# `@keel-engine/terrain`

Tile terrain: a chunked grid of integer heights, terrain types and flags;
auto-tiling by a rules table; cliffs, ramps, water and bridge spans; merged
colliders for the character body; walkability, flow fields and HPA* for
thousands of units; and the GROUND baked per chunk into palette-true,
depth-carrying layers drawn under the units at 120 fps. Module
`keel/terrain@0.1.0` (`kind: "runtime"`, needs `keel/core`, `keel/physics`,
`keel/bake`).

```ts
import { createTerrain, autoTile, buildPathGrid, flowField, createGroundBaker, createGroundRenderer } from "@keel-engine/terrain";
```

| file | what |
| --- | --- |
| `types.ts` | `TERRAIN_TYPES` (grass dirt sand rock snow crystal lava ash mud road path ice sandstone: priority, path cost, buildable, OKLCH ramp, face type, texture, glow, cycle), `terrainTypes(specs)`, `FLAG` (RAMP BRIDGE BLOCKED NOBUILD RIVER), dir4/dir8 tables |
| `grid.ts` | `createTerrain({ width, depth, tileSize=2, stepHeight=1, chunk=32 })`: SoA `height` (Int16 steps) `type` `flags` `dir` `water` `deck`; setters that version chunks and emit change events (`batch`, `onChange`, `takeDirty`); `heightAt`, `surfaceAt`, `read`/`write` patches (undo), `hashTiles` |
| `cliffs.ts` | the one rule: `cornerLevels` / `edgeLevels` -- two tiles meet when their tops agree along the shared edge, else a `cliffFace` stands there; `canRamp`, `rampSites`, `layRamp` |
| `autotile.ts` | `AUTOTILE_RULES` (overlay, shore, foam, deep, cliff, road, path), `autoTile(t, { rules, rect })` -> per rule and tile the 8-bit mask, `BLOB47` / `blobIndex` (Wang blob set), `cardinalIndex` (16) |
| `water.ts` | `floodWater` (a basin to a level), `carveRiver` (never rising downstream), `waterBodies`, `waterClass` (dry / shallow / deep) |
| `bridges.ts` | `bridgeSpans(t, { maxSpan, prefer, regions })` -> suggestions (straight, both ends one level, nothing higher under the deck; scored: joins regions, preferred ends, short), `applyBridge` (deck tiles walk along the span), `bridgePlacement` (pos, yaw, length for the content's bridge object) |
| `colliders.ts` | `chunkColliders` / `terrainColliders` / `collidersNear`: columns merged greedily, a wedge per ramp run (`RAMP_YAW`), deck slabs -- `createCharacter({ boxes, wedges })` |
| `pathing.ts` | `buildPathGrid(t, { moveClass, blocked, costs })` -> `cost` + dir8 `links` (move classes ground / large / hover / amphibious), `regions`, `clearance` |
| `flowfield.ts` | `flowField(grid, goals, { into, within, maxDist })` (Dial's bucket queue, typed arrays kept between calls), `followField`, `steer` (a blended heading), `createFlowCache` (LRU) |
| `hpa.ts` | `buildSectors(grid, { size: 16, spacing: 5 })`: portals per border run, intra-sector costs, `route(from, to)` (A*), `corridor(route, pad)` -> a flow field's `within` |
| `palette.ts` | `groundPalette(types, { biome, water, materials })`: a hue-shifted ramp per type and material, cycling ramps (`water.shallow`, `water.deep`, `foam`, `lava.flow`) |
| `ground.ts` | the ground rasteriser: `chunkBakeJob` (sliced) / `bakeChunk`, `GroundStyle` (pixel / voxel / custom painter), `GroundExtra` (boxes and wedges baked in: bridges, buildings), `composeGround` (CPU compose), `viewAxes`, `globalPixel`, `groundDepth`, `spritePosition` (with a footprint: its base's front edge's depth), `footprintToward` |
| `ground-bake.ts` | `groundKey`, `groundJob`, `chunksIn`, `groundPriority`, `tierPriority` / `TIERS` (bake's `BakeTier`), `groundRectFor`, `createGroundBaker` (plan, bake slices, stand-in scales, cache) |
| `ground-gl.ts` | `createGroundRenderer(gl)`: chunk layers as quads, palette lookup, palette cycling, per-texel `gl_FragDepth` (a stand-in drawn bigger than baked: one shared pixel-to-texel mapping, no seams, half a texel row of depth slack) |
| `ground-gpu-data.ts` | the GPU ground's CPU side: `gpuChunkData` (a chunk's faces as triangles: tops, cliff faces, water, falls, decks, extras) and `gpuTileData` (its tiles packed into one RGBA32UI texture: types, levels, auto-tile masks, contact shade, variants, biome corners) |
| `ground-gpu-glsl.ts` | the ground baker's and the surface's pixel model ported to GLSL (the same integer hash and noise): pass 1 + resolve for the overview, one pass into keel/render's raster hook for perspective |
| `ground-gpu.ts` | `createGpuGround(gl, { palette })` (`setChunk`, `updateTiles`, `setPalette`, `draw(view, { artScale })`, `drawPerspective(cam)`, `setShadows`), `createGpuTerrain(gpu, { terrain, surface, extras })` (a finite map's chunks: visible ones always uploaded, `preload()`) |
| `surface.ts` | the SURFACE (tileset tricks): `groundSurface({ biomes, biome, light, blend, macro, ao })`, `createSurfaceShader`, `surfacePalette` / `seasonPalette` / `SEASONS`, `tileVariant`, `DECAL_KINDS`, `hashBiome` |
| `tileset.ts` | a creator's own tileset: `importTileset(image, rules)` (blob-47, Wang-16, RPG Maker A2), `tilesetPalette`, `tilesetPainter`, `tilesetStyle`, `wangIndex`, `a2Quarter` |

## Tiles, cliffs, ramps

A tile's top has four corners; a flat tile has its height at all four, a
ramp at height h rising toward dir d has h at its foot edge and h + 1 at the
edge toward d. Comparing two neighbours' corner levels along their shared
edge is the whole rule: equal at both ends, they join (flat-flat, a ramp's
foot or top, two ramps side by side); one higher, a cliff face stands there
(a trapezoid under a ramp's side). Walkability, the cliff faces the baker
draws and the colliders all come from it (`test/walk.test.ts`: a cliff
blocks, a ramp joins its two levels only at its foot and top, side-by-side
ramps join, no diagonal past a cliff; `test/colliders.test.ts`: 2,400 random
points just above the ground are outside every solid and just below inside
one, and the physics body walks up a ramp and is stopped by the cliff beside it).

Water is a layer, not a type: a surface level over a bed. One step deep is
shallow (the ground classes ford it at cost 5), two or more deep (hover and
amphibious only). Bridges: `bridgeSpans` suggests, `applyBridge` marks the
deck (walkable along the span only), the level places the content's bridge
object on `bridgePlacement(span)`.

## Auto-tiling

Rules are data: `{ name, shape: "blob47" | "cardinal16", self, other }` with
`self` a class (`any land water shallow deep` or type names) and `other` a
relation (`overlay water land shallow deep higher lower same` or type names).
`autoTile` gives per rule and tile the raw 8-bit neighbour mask and its
variant index (`blobIndex`: corner bits count only with both edges beside
them, 47 variants; `cardinalIndex`: 16), plus the overlay TYPE (the
highest-priority neighbour at the tile's level). A tileset renderer picks
sprites by `(rule, index, variant)`; the ground baker paints the same answers
analytically (a noisy fringe of the overlay type along each masked edge and
corner, wet sand along shores, foam on the water side, a darker kerb where a
road's cardinal mask has no road). `test/autotile.test.ts`.

## The surface: how materials meet (tileset tricks, done by the baker)

Give a bake (`chunkBakeJob`, `createGroundBaker`) a `surface` and its tops
are painted the way a pixel artist tiles ground -- analytically, per texel,
anchored to the world, palette-true, cached per chunk:

- **Corner blending (Wang corners, N materials).** A texel weighs the four
  tiles round its corner bilinearly; up to four materials meet at a corner
  and every pair has a transition without a rule table listing them
  (`test/surface.test.ts`: all 240 ordered pairs of 16 land materials).
- **Precedence.** The higher priority (types.ts) reaches over the lower (grass
  over dirt over sand); a rim darkens the lower side and lights the higher's
  lip. Crisp materials (cobbled road) keep a straight kerb and WEAR their
  neighbours (a band of path along a road). Across a cliff nothing blends.
- **Jittered, warped, dithered.** Each material has an edge character (tufty
  grass, smooth sand, blocky stone, soft snow); the tile lattice is domain-
  warped so borders wander off the grid; the last pixel is an ordered-Bayer
  mix of both.
- **Biomes.** A per-tile biome map picks each material's ramp
  (`<type>@<biome>`); biome borders are a wide ordered-dither gradient over
  four tiles (corner shares of a 4 x 4 neighbourhood), ragged by noise.
- **Macro variation** (brightness and a "lush" second ramp over tens of
  metres), **variants** (per tile, weighted, never the same as the tile west
  or south of it: exact for even odds), **decals** on a grid of global pixels
  (grass tufts, flowers in grass with the biome's petal hues, pebbles,
  cracks, fallen leaves, bones), **AO** at the foot of any higher neighbour,
  **height shading**, and a **light** layer (dungeon torchlight: faces and
  tops darkened smoothly between tiles' light values).

`surfacePalette(types, biomes, { season })` lays out every ramp (a type per
biome and its lush variant, petals, decals) by the types and the biome
COUNT only: its key is the layout's, and `seasonPalette` gives another
season's colours for the same indices -- a season swap is `setPalette()`,
nothing rebakes. The baker's key adds `surface.key` and a hash of the biome
and light maps round each chunk (`surfaceChunkKey`): a paint rebakes only the
chunks it reaches.

**Materials added** (appended to `TERRAIN_TYPES`, so every existing id is
unchanged): `flagstone`, `gravel`, `moss`, `clay`, `litter` (forest floor),
`brick` (walls, cost 0), `creep` (a race's spreading ground), each with its
texture.

**World chunks** (`origin`, `rect` on `ChunkBakeInput`): a chunk of an
infinite world is baked from its own small terrain (the chunk and a 2-tile
apron) at its world tile, and lands on exactly the pixels one big terrain's
chunk would (`test/surface.test.ts`: 36,352 texels compared, 0 differ).

## Tilesets

`importTileset(rgbaImage, { id, layout, tile, materials: [{ type, at }] })`
cuts a creator's atlas in the layouts artists draw: **blob47** (47 tiles, 8
a row, BLOB47 order), **wang16** (4 x 4 corner tiles: NE 1, SE 2, SW 4, NW 8),
**rpgmaker-a2** (the 2 x 3 autotile block of quarter tiles, composed into the
47 blob tiles quarter by quarter: outer corners, edges, inner corners,
centre). Its colours become one ramp (`tilesetPalette`), so it stays
palette-true; `tilesetStyle(ts, terrain)` is a custom ground style whose
painter answers a tileset material's top texels with the tile its
same-type neighbours pick -- the same baker, chunks, depth, water and cliffs.
The rules pack with keel/worldgen's `keel/worldgen/tileset` schema.

## Walking: grids, flow fields, HPA*

`buildPathGrid` -> per tile `cost` (0 blocked) and dir8 `links`. `flowField`
is Dijkstra by Dial's bucket queue (costs 5 orthogonal x tile cost, 7
diagonal): the integration and a direction per tile; thousands of units read
their tile's step, or `steer()` for a heading blended across the four nearest
tiles. `buildSectors` is HPA* over 16 x 16 sectors: a route's sectors are the
corridor a field runs in (`within`).

## The GPU ground (any scale)

`createGpuGround` paints the ground in a fragment shader at whatever scale the view is at: each chunk uploads its
mesh and a small tile texture once (~1.5 ms a 32 x 32 chunk, ~0.35 MB), and every frame draws the surface -- corner
blending with precedence, jittered, warped and dithered borders, biome gradients, macro tint, variants (their borders
wander and dither like a material's), decals, contact shade, the light layer, cliff faces, water with palette cycling
and foam -- palette-true, on the global pixel grid, the same picture the CPU bake makes.

```ts
const gpu = createGpuGround(gl, { palette, seed: 1 });
const ground = createGpuTerrain(gpu, { terrain, auto, surface, extras, extrasKey, seed: 1 });
ground.preload();                                   // a finite map: every chunk now, no upload ever again
each frame: gpu.draw(view, { time, clear, keys: ground.plan(view), artScale: 48 });   // then sprites.drawLayers(view, units, { clear: null })
a paint (biome swap, creep): ground.touch(chunks)   // tiles only; a season: gpu.setPalette(seasonPalette(...))
```

- **Parity** with the CPU bake (`packages/worldgen/tools/ground-parity.html`: three scenes -- an infinite world's
  chunks, a mixed map with a town and a lit crypt, the classic look with houses -- at 4, 8, 16, 32 px/m): 0.005 to
  0.32 % of pixels differ, a float-vs-double threshold landing the other side (a row of a biome gradient) or the
  outline at the picture's edge; `artScale` at 64 / 91 / 128 against the CPU's 32 px/m bake in 2x2 / 3x3 / 4x4
  blocks: 0 to 0.07 %.
- **`artScale`**: the art's largest scale. Unset, the ground is painted at the view's own scale (an art pixel a
  picture pixel); set (the level demo uses 48, its props' bake cap), closer than that each art pixel is a whole
  n x n block (n = ceil(k / artScale)) on the global grid -- one pixel size for the ground and what stands on it.
- **Cost** (M4 Max, Chrome, a loaded machine): 1.1 to 1.4 ms a 1920 x 1080 frame at every scale from 2 to 128 px/m
  (the CPU bake: 17 / 53 / 156 ms a chunk at 4 / 8 / 16 px/m, 0.4 to 1.8 s at 32, 6 s at 64, capped there and blown
  up past it). All 16 chunks of a 128 x 128 map: 5.6 MB. A biome swap re-packs 2-4 chunks' tiles (1-3 ms each in
  Node); a season is a palette upload (0.2 ms).
- **Perspective**: `drawPerspective(ctx)` from keel/render's raster hook (`raster: { draw }`): the art's pixels are
  texels in texture space (world x/z on tops, along-the-face and up on walls) at 32 a metre, a power of two coarser
  far off and finer close in; a depth pre-pass so only the nearest ground is shaded; DIRECT_MAT palette indices;
  blob shadows (`setShadows`) and a lit lip on cliff edges.
- The CPU bake stays: the reference, the voxel and custom styles' path, and a fallback.

## Zooming fast, and sprites on the ground (both by design)

- **The ground is never missing.** The GPU ground uploads every visible chunk the frame it's needed (`createGpuTerrain.upload`:
  the budget only limits the prefetch ring; `preload()` at load for a finite map) and draws each frame in that frame's
  own view -- scale and pitch -- so a wheel spun through every rung, or a pitch change, never shows a hole. The CPU
  bake: `createGroundBaker({ floor: 2 })` + `bakeFloor(view)` per pitch at load bakes every chunk at 2 px/m (the
  stand-in of last resort, never dropped), and a chunk's last complete layer is kept as its stand-in until its new scale
  lands. Plan it with the SHOWN picture at the bake's scale (`width x bakeK / shownK`): zooming in, the target rung is
  finer than the k on screen.
- **Sprites are depth-tested in the ground's own projection** (the sprite renderer's formula, the frame's view), and a
  sprite's depth is its FOOTPRINT's front edge: `spritePosition(axes, p, out, footprint)` (`footprintToward(axes, hx,
  hz, yaw)` for a rectangle). A sprite is one depth; at its middle, the front half of a wide base -- a building's walls
  -- sank into the ground in front of the middle. Checked (`tools/ground-checks.html`): box buildings on flat ground at
  4 to 128 px/m, both pitches: 0 pixels hidden with the footprint (the middle's: 15-89 %), over the GPU ground, the
  CPU's own scale and its 2 px/m stand-ins alike; a fast sweep 128 -> 2 -> 128 px/m in 40 frames with the pitch bucket
  switching: the GPU ground 100 % every frame, two CPU bakers as games had them 0 %, with the floor 99.2 % minimum.

## The ground at 120 fps

Each chunk's ground is rasterised ONCE into a static layer from the game's
pixel view (orthographic, its yaw and pitch, a pixel scale) and drawn every
frame as a textured quad under the sprites.

- **Why not the raymarcher.** `@keel-engine/render`'s bake camera is a
  perspective stand-in -- fine for a 2 m character, off by tens of per cent
  across a 64 m chunk, so neighbouring chunks wouldn't meet -- and a scene
  holds 256 boxes / 128 wedges. The ground is a heightfield of boxes and wedges
  seen from one fixed direction, which rasterises exactly: every top, camera-
  facing cliff face, water surface and waterfall is a flat polygon; a texel
  is the ray through its pixel meeting the nearest. The pixel model is the
  renderer's: a material's ramp, light from the face's normal (the sun
  camera-relative, from the upper left), a texture, a Bayer screen between
  entries, the outline `outline` entries darker where the texel behind is
  more than `gap` further, a lit lip on cliff tops, shade east of cliffs.
  Palette-true: texels are palette INDICES.
- **Pixels are global.** Texel (gx, gy) is `P . right x k`, `-P . up x k` for
  every chunk: chunks meet without a seam (`test/ground.test.ts` composes a
  whole map: no empty pixel inside it), the dither screen is anchored to the
  world, and a layer lands by a whole-pixel offset. (The demo snaps the camera
  centre to the grid along the view's forward, so sprites land on the same pixels.)
- **Depth at cliffs -- the decision: per-texel ground-plane depth** (not
  height bands). A texel stores the depth of the point it shows along the
  view's heading with height ignored (`groundDepth = (x sin yaw + z cos yaw) cos pitch`).
  Along any pixel's ray a heightfield only gets further by that measure, and a
  standing sprite belongs at its ground point's -- so one number per texel
  orders ground against ground AND ground against units: a unit behind a
  cliff's top edge is hidden, a unit in front of a cliff face stands before it,
  whatever the heights, and a unit on a plateau is not hidden by the plateau's
  own far edge. Sprites get the same rule by `spritePosition()` (their position
  moved along the view's forward by height x sin pitch: the same pixel, that
  depth), and the ground shader writes each texel's depth by the sprite
  renderer's own formula (`0.5 + (P - centre) . forward / range`,
  `range = max(W, H) / k x 4`), so `drawLayers(view, units, { clear: null })`
  after `ground.draw()` depth-tests per texel. Height bands would need a layer
  per level per chunk and still get a unit between two bands wrong.
- **Texels**: 4 bytes -- palette index + 1 (u16; 0 empty) and the depth (u16,
  chunk-relative, `depthStepOf(t)` metres a step).
- **Styles** (`GroundStyle`, part of the key): `pixel` (dithered ramps,
  textures per type); `voxel` (tops and faces quantised to `voxels` cells a
  tile, a shade per cell, cell edges drawn, no screen); `custom` (a
  `paint(texel)` returning a ramp and a position, `id` names it in keys).
- **Water** cycles in the shader: water, foam, waterfalls and lava are written
  as phases on their cycling ramps (a wave field) and the ground shader rotates
  those entries with time -- no rebake (two of the demo's frames half a second
  apart, same view, differ in 2,282 pixels: the river's water and foam).
- **Extras**: boxes and wedges baked into a chunk (`GroundExtra`: bridges'
  decks and rails, buildings with wedge roofs) get the ground's per-texel depth
  -- a long bridge or a house is never a single flat sprite a unit pops through.
- **The bake, the cache, the queue.** `groundKey` =
  `ground|terrain|chunk|hash of the chunk and 2 tiles round|k|pitch|yaw|style|palette|extras`:
  an edit changes the keys of the chunks it reaches and no others
  (`test/ground.test.ts`). `createGroundBaker` plans a view (`groundRectFor`
  widens it by the terrain's height range), enqueues the missing layers on
  `@keel-engine/bake`'s bake queue as the **background** tier (visible chunks by
  nearness first, then a prefetch ring), bakes a slice a frame (a job steps
  faces, then rows: `chunkBakeJob(...).step(ms)`), stores layers in bake's
  sprite cache (a layer is a `BakedSprite`: its anchor is the world origin's
  pixel, so `cache.save()` round-trips), and while a scale bakes the nearest
  baked scale stands in, drawn scaled.

## Measured (this Mac, 2026-09-13; node 22 for CPU work, Chrome in the app's Browser pane for frames)

| what | size | time |
| --- | --- | --- |
| flow field (Dial) | 256 x 256, one goal, 65,207 tiles reached | **4.3 ms median** (4.1 best); 5.8 ms on a generated 8-player map |
| path grid build | 256 x 256 | 11-19 ms |
| HPA* sectors build | 256 x 256, 16-tile sectors | 51 ms, 2,452 portal nodes; a route 1.2 ms; worst route / best 1.21 over 90 random pairs |
| 2,000 units reading `steer()` | | 1.0 ms |
| colliders | 256 x 256 generated | 3,879 boxes + 614 wedges (from 65,536 tiles) in 14 ms |
| ground chunk bake, 32 x 32 tiles | 4 / 8 / 16 px/m | 16 / 26 / 100 ms (voxel 32 ms at 8 px/m); sliced across frames |
| frame, 1920 x 1080, 8 px/m, 16 chunk layers + 5,527 trees + 5,000 units | | **4.0 ms median / 5.2 p95** (GPU finished); 120 fps |
| same with 20,000 units (24,426 sprites drawn) | | 4.6 / 7.2 ms; the 20 Hz sim step 2.6 ms |
| 4 px/m, 20,000 units + all 6,548 plants | | 4.5 / 7.5 ms |
| ground chunk bake with the SURFACE, 32 x 32 (2026-09-14) | 4 / 8 px/m | 22 / 78 ms (classic 12 / 28 on the same loaded run); sliced |

Tests: `node --test packages/terrain/test/*.test.ts` (the surface: every
material pair's transition, four at a corner, road wear, no blending across
cliffs, variants, palette-true and pixel-exact world chunks, seasons' shared
layout, the light layer, tilesets in all three layouts, a biome paint
rebaking only its chunks; auto-tiling, walk
rules, bridges, rivers, clearance, colliders vs the physics body, flow field
vs brute Dijkstra + following it costs exactly its integration, HPA*, the
flow cache, palette-true bakes, seamless chunks, depth at cliffs, sliced =
one-shot bakes, style keys, bake keys and priorities, the baker).

## Integration

- **Bake / streaming loader**: `GroundJob` is a `SpriteJob` with
  `tier: "background"` (bake's `BakeTier`); the ground uses bake's
  `createBakeQueue` and `createSpriteCache`, and the demo takes
  `createFrameBudget()`'s slice. The sprite stream (`createSpriteStream`)
  orders sprite slots; chunk layers are not slots -- a later hook
  (`stream.external(tier, key, cost)`?) could let one scheduler order both.
- **Depth formula**: `ground-gl.ts` copies `sprites.ts`'s `uDepthRange`
  (`max(W, H) / k * 4`); if bake exported it (or accepted a depth base), the
  two couldn't drift.
- **Workers**: `chunkBakeJob` is pure typed-array work -- ready for bake's
  worker pool (`createBakeWorkers`) once it accepts non-raymarch jobs.
- **Physics**: one `waterY` per body; lakes at other levels are drawn and
  walked (pathing) but a character only skims the level it was given.
