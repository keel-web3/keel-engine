# `@keel-engine/worldgen`

World generation for pixel-art games: climate BIOMES as data (packs add
their own), biome SWAPPING (re-skin a region keeping its shape, seasons,
runtime spread), the infinite Minecraft-style OVERWORLD, Diablo-style
DUNGEONS by five generators with a fairness gate, chunk-independent FOLIAGE
scatter, and composable generator PIPELINES stored as codec recipes. Module
`keel/worldgen@0.1.0` (`kind: "runtime"`, needs `keel/runtime`, `keel/core`,
`keel/codec`, `keel/terrain`, `keel/world`, `keel/level`; provides the
contracts `worldgen/stage/<id>@1.0.0` for its seven stage kinds).

```ts
import { createWorldStream, createWorldBaker, defineRecipe, runPipeline, generateDungeon, scatterIn, worldSurface } from "@keel-engine/worldgen";

const recipe = defineRecipe({ seed: "w1", width: 0, depth: 0, stages: [{ id: "ground", use: "overworld@1" }] });
const world = createWorldStream(recipe);          // infinite: world.chunk(cx, cz) -- the same tiles in any order
const ground = createWorldBaker({ stream: world }); // plan(view) / bake(ms) / layers() -> ground-gl, paint() for swaps
const map = runPipeline(defineRecipe({ seed: "m", width: 192, depth: 144, stages: [/* overworld, cave, town, dungeon, level... */] }));
```

## Why a package of its own

Terrain is the grid and how it's drawn; level is a document with RTS rules.
World generation needs both, plus climate, biomes, dungeons, WFC and
recipes -- and keel/level's templates as one of its stages -- so it sits
above them: `worldgen -> level -> terrain`. keel/level knows nothing of it
(its `generateLevel({ world })` takes the small `LevelWorld` interface, which
`levelWorld(recipe)` implements), and terrain only gained additive pieces
(the surface, tilesets, a bake origin), so neither depends on worldgen.

| file | what |
| --- | --- |
| `noise.ts` | `seedOf` (text -> 32-bit seed), integer-lattice value and simplex noise, `fbm` (ridged too), `noiseField` with domain warp, `rng` |
| `biomes.ts` | `BiomeDef` (a climate point, heights it may stand at, relief, ground weights, bed/shore/steep/snowline, forest cover, foliage rules by layer, the surface look, water, rivers, lakes, ambient particles and sounds, music), `DEFAULT_BIOMES` (28: oceans, beach, stony shore, river, plains, forests, swamp, jungle, savanna, desert, badlands, taiga, cold steppe, tundra, mountains, alpine, peaks, volcanic, alien, corruption, and four underground looks), `DEFAULT_ACTS`, `createBiomeTable` (nearest in climate space) |
| `overworld.ts` | `createOverworld(seed, { params })`: `column(i, j)` (pure) and `block(i0, j0, w, d)` (pure over a margin): climate, height, rivers, lakes, biomes and transitions, materials, structures, ore, caves, mode smoothing, steep faces, ramps |
| `structures.ts` | `STRUCTURES` (village, ruin, dungeon entrance), spacing/separation placement, validation, flatten + stamp |
| `dungeon.ts` | `generateDungeon(seed, w, d, { algorithm })` (rooms, bsp, cave, drunkard, wfc), `checkDungeon` (the gate), `ROOM_TEMPLATES`, `THEMES` (crypt, tomb, ice, hell), `dungeonLayers` (walls as cliffs, torchlight baked into the light layer, things) |
| `wfc.ts` | `solveWfc` (constraints, backtracking, a step budget -- never a clock), `tiledModel`, `edgeTiles`, `overlappingModel`, `wfcDungeonCells`, `wfcTown` |
| `scatter.ts` | `scatterIn(layers, rect, opts)`: blue noise per layer, the forest field, groves, moisture, slope, exclusion; `drawLayersFor(k)` |
| `swap.ts` | `reskin`, `seasonPaletteFor`, `foliageProfile`, `createBiomePainter` (paint, spread) |
| `pipeline.ts` | `defineRecipe`, `runPipeline`, `createWorldStream`, `defineStage`, masks, pins, locks; the stages `overworld@1 biome@1 dungeon@1 cave@1 town@1 level@1 foliage@1` |
| `map.ts` | `TileLayers` / `WorldMap` (height type water flags dir + biome light under ore zone; things, regions), `toTerrain`, `writeTerrain`, `blit`, `hashLayers` |
| `world-baker.ts` | `createWorldBaker`: an infinite world's ground streamed and baked chunk by chunk, `paint()` for runtime swaps |
| `level.ts` | `levelWorld(recipe)`, `generateWorldLevel(recipe, { players })`, `worldSurface(layers)`, `interiorRecipe(entrance)` |
| `packs.ts` | `defineWorldPack` (biomes, tilesets, rooms, acts as contracts), `worldPackManifest`, `worldOptions(packs)` |
| `schema.ts` | codec schemas `keel/worldgen/biomes`, `keel/worldgen/recipe`, `keel/worldgen/tileset`, `keel/worldgen/rooms` |
| `schemas.ts` | the four schemas as one list; the manifest declares them under `contents.schemas` |
| `crawl-themes.ts` | the action-RPG dungeon's ACTS as themes: `CRAWL_THEMES` (crypt, cave, forge, ruin: palette ramps, ambient, remembered-fog level, light kinds with colour/radius/flicker, hero light, wall heights, moss, cracks, liquid, ambient particles, room programs), `CRAWL_RAMPS`, `crawlRamp`, `crawlPalette`, `CRAWL_ROOM_KINDS` |
| `dungeon-dress.ts` | `dressDungeon(dungeon, act, { seed, rules, density })`: room kinds, floors, decor, props by `DUNGEON_PROP_RULES`, lights, doors, stairs, chasms and bridges |
| `dungeon-scene.ts` | `buildDungeonScene(dressing)`: walls with height on a half-metre grid, caps, pillars, arches, lintels, doors, stairs, bridges as quads; the walk grid (`walkableAt`) |
| `dungeon-light.ts` | `lightMask` (what a light can see), `createFog` (fog of war: unexplored, remembered, in view) |
| `dungeon-gl.ts` | `createDungeonRenderer(gl, { looks })`: the WebGL2 renderer for the crawl (details below) |

## Biomes and climate (the Minecraft way)

Five fields, each warped simplex fbm: **temperature** (falling with height:
a lapse, so a forest climbs into alpine meadow and peaks), **humidity**,
**continentalness** (sea, shelf, coast, inland), **erosion** (flat to
mountainous), **weirdness** (peaks and valleys, and the rare biomes). Height
comes from continentalness x erosion x peaks-and-valleys plus hills, each
scaled by the climate's two nearest biomes' `relief`, blended by how close
the call is -- so a biome shapes its own ground and borders are smooth.
Heights are whole steps: terraces and cliffs, with two passes of mode
smoothing (no one-tile bumps) and ramps (the best candidate in a 7-tile
radius takes it, two wide).

A land biome is the NEAREST point in (temperature, humidity, erosion,
weirdness) among those allowed at that height (Whittaker's diagram as data;
an act narrows the list). Transitions are rules on the same fields: a
BEACH where land meets sea low (a STONY SHORE on mountainous or cold
coasts), RIVER banks, the treeline by lapse and `height` limits. Corruption
and the underground biomes are never picked by climate: swaps and dungeons
wear them.

RIVERS are the middle contour of a warped field (winding, never ending in
the middle of nowhere); their water level follows the land's slow shape (no
hills), so reaches are long and flat with the odd waterfall, and the ground
falls toward them (valleys). LAKES sit in a cell grid, their level the lowest
ground on their rim. STRUCTURES use Minecraft's spacing/separation grid
(villages 180/70, ruins 120/36, entrances 100/30), are validated by the
ground (biome, dry, relief), flattened with graded aprons and stamped:
villages with a plaza, lanes, houses on lots facing them, gardens and fields;
ruins of broken brick; dungeon ENTRANCES whose `data.seed` is what
`interiorRecipe()` turns into the dungeon below. ORE veins (ridged noise in
rock: mass, crystal, flux; crystal shows at the surface), and an underground
CAVE layer (a cellular automaton over hashed noise) per tile.

## Swapping biomes

- **Re-skin** (`reskin`, stage `biome@1`): heights and water stay; each tile
  takes the new biome's ground partition, its bed, its steep type; its
  biome index (ramps, decals, foliage rules). Paving stays.
- **Seasons** (`seasonPaletteFor`): terrain's `seasonPalette` over the
  table's looks -- the same layout, other colours (a palette's key is its
  layout's, so a bake doesn't move); foliage wears `foliageProfile(biome,
  season)` (a look). Nothing rebakes.
- **At runtime** (`createBiomePainter` on a live terrain; `WorldBaker.paint`
  in an infinite world): paint tiles, or `spread()` a ragged front a step at a
  time -- corruption, an RTS race's creep. Only the chunks a paint reaches
  rebake (the ground baker's key hashes tiles and the biome map per chunk).

## Dungeons

`rooms` stitches prefab ROOM TEMPLATES (text: walls, floors, door anchors,
torches, pillars, pools, pits, chests, the boss's, key's, start's and exit's
spots) by a GRAPH GRAMMAR: start -> a main path of rooms -> a key room on a
branch before the end -> a LOCKED door -> the boss arena -> the exit, side
rooms on branches; corridors keep a one-cell margin so nothing joins by
accident. `bsp`, `cave` (the 4-5 automaton), `drunkard` and `wfc` (macro
tiles: rooms, corridors, bends, tees, doorways, pillars) make the cells;
then every region is joined (0-1 BFS tunnels), the exit goes in the room (or
pocket) farthest from the start, the pocket is SEALED but for one locked
door, cut-off parts are tunnelled back around it, the key goes as far from
the start as it can without the door. `checkDungeon` is the gate (everything
reachable, the exit and boss only through the door, the key before it, the
way long enough); `generateDungeon` rerolls on the next stream until it passes.
THEMES per act dress it: floor, corridor, wall, cave, liquid (water or lava),
a light layer (torch pools over an ambient; wall tops dark), props.
Templates may carry FURNITURE letters (`TEMPLATE_PROPS`: b bookshelf, s
sarcophagus, a altar, t table, w weapon rack, c cage, u urn, x crate, y
barrel, h throne, i statue, z brazier, l candles, q bones, k skull pile, n
banner, m chains, g tombstone, f anvil, v crystals); they become props
(`packs/dungeon` things) where the template lands. Prop yaws are wrapped to
[-pi, pi] at the source (`wrapYaw`), which the level codec requires.

## The dungeon crawl (an action-RPG floor in pixel art)

The same generators, drawn close (16-48 px/m, 2:1 isometric) as a floor you
walk through:

1. **Dress** (`dressDungeon`): each room gets a KIND from its template's
   role and name, or its size and shape (entry, hall, crypt, library,
   armoury, prison, storage, throne, chapel, well, garden, cavern, forge,
   shaft, vault). Lanes -- the shortest walks between a room's openings --
   are kept clear, and a prop only goes where a ring check says it cuts
   nothing off. A room's program then places props by rule (against a wall,
   in a corner, clustered, centred, flat as a decal) from
   `DUNGEON_PROP_RULES`, the act's density and the kind: bookshelves line a
   library, sarcophagi and candles a crypt, furnaces, anvils, ore carts and a
   molten pool a forge, crystals and mushrooms a cavern. Floors vary
   (flagstones, cracked, mossy, puddles, grates, rugs); chasms get bridges.
   Torches go on back walls only (the camera side stays readable); corridors
   get one every so often.
2. **Scene** (`buildDungeonScene`): walls 2-3 m tall on a half-metre grid,
   hugging open ground; caps with a rim on open edges; cave walls bulge and
   break up; pillars are octagons; doorways have jambs, lintels with an arch
   cut and doors that swing; stairs down drop (shallow enough to read at
   30 degrees), stairs up climb into a dark arch. Walls between the camera
   and the floor are marked as FRONT walls. Everything is quads (16 floats).
3. **Light** (`lightMask`, `createFog`): each light sees through a
   visibility mask (2 texels/m) computed once on the CPU; the fog of war
   keeps what the hero has seen (remembered, dimmed) and what he sees now.
4. **Draw** (`createDungeonRenderer`): a world-space LIGHT MAP (4 texels/m,
   RGBA16F where it can) redrawn every frame from additive light quads, so
   flicker, a moving hero light and doors cost no re-bake; surfaces are
   procedural materials mapped to the act's PALETTE RAMPS, light walking the
   ramp (a reduced Bayer dither, a light tint), so every pixel is a palette
   colour; the CUTAWAY (`"stub"`: front walls and walls near the hero sink to
   a 0.7 m stub; `"dither"`; `"off"`); the fog per cell; LIT SPRITES (keel's
   baked indexed sprites and look tables, 14 floats each, flags unlit /
   unfogged / cut with walls, standing / hero) as DEPTH SPRITES -- each texel at the
   depth of the point it shows (keel/bake depth.ts; a card at its anchor
   without heights); procedural
   FLAMES; banded CONTACT SHADOWS; the hero's ring and an x-ray silhouette
   when a wall hides him; the abyss under chasms. keel/particles adds embers,
   smoke and each act's motes.

Four acts, each its own palette, tiles, props (their look profiles live in
`packs/dungeon`), lights and particles: **crypt** (cold blue stone, warm
torches, bone and candles), **cave** (rough brown rock, cyan crystals and
fungus, no torches), **forge** (black basalt, bronze, lava cracks and molten
pools, embers), **ruin** (weathered sandstone, moss, roots, green motes).

### Occlusion in the crawl

The crawl draws by the engine's one model (docs/ARCHITECTURE.md "Occlusion and
layers"). Before it, a sprite stood as a vertical CARD at its anchor: every
texel below the anchor's picture row lay under the floor, so the floor hid it --
the front half of every sarcophagus, table and chest (the ones with the lid off
lost the lid lying beside them), and a unit's front foot in every stride. Depth
sprites fix both by construction. A prop against a front wall the cutaway sinks:
hung on it (torch, banner, chains, roots, cobweb: flag 4) it goes with the wall;
standing before it (bookshelf, weapon rack, statue, furnace: flags 4 + 16) it's
cut at the stub by each texel's height -- it used to vanish whole.

`tools/occlusion-check.html` (`node packages/worldgen/tools/build.mjs`) is the
gate: see the table under Measured.

## Pipelines

A recipe is `{ seed, width, depth (0 x 0: infinite), act, stages, pins, locks }`.
A stage is `{ id, use: "<kind>@<major>", seed?, params, mask? }`; params may be
rolls (`{ int: [a, b] }`, `{ between }`, `{ pick }`) that keel/world's settings
LOCK (`"id:crypt/algorithm=bsp"`, only that changes). Masks: all, rect
(feathered), circle (feathered), noise, biome, height, not/and/or. PINS (tile
rectangles with height/type/water/biome) are written back after every stage:
the hand-placed wins. Local stages (`overworld`, `biome`, `foliage`) run per
chunk in an infinite world; region stages (`dungeon`, `cave`, `town`,
`level`) run once over their bounded mask and are cut into the chunks they
reach. A pack adds a stage kind with `defineStage` (contract
`worldgen/stage/<id>@1`).

`dungeon@1` takes a `templates` param choosing from the pipeline's pool
(`PipelineOptions.templates`, or a world pack's `rooms`, plus the engine's
own): `"all"` (the default), `"engine"`, an id, a prefix (`"dungeon-*"`: all
of `packs/dungeon`'s rooms) or a list; engine templates stand in for any role
the chosen ones can't play (`chooseTemplates`). `level@1` carries the
sub-level's spawns, resources and markers through as things (kinds `spawn`,
`resource`, `marker`, with their data), yaws wrapped.

## Foliage

`scatterIn(layers, rect, { seed, table, types, density, exclude, biomeOf })`:
per layer (canopy 3.4 m, understory 2.3, shrub 1.6, grass 0.62, flower 0.9,
rock 3) one jittered candidate per cell with a hashed priority, kept when no
candidate within the spacing outranks it -- blue noise that needs only the
neighbouring cells' hashes, so chunks agree. The biome's rules then weigh
each candidate by the FOREST FIELD (low-frequency noise against the biome's
cover: clearings, edges, cores -- big old trees in the core, shrubs crowding
the edge), GROVES (a slow field per species), moisture (reeds by water),
slope (no trees on cliff edges), and EXCLUSION (paving, water, ramps,
bridges, blocked tiles, structures, dark dungeon floor, a callback for
spawns and resources). A canopy trunk keeps the lower layers a metre and a
half off. `drawLayersFor(k)` fades the small layers out as the view pulls
back -- the ground's decals (tufts, flowers) carry them there.

## Measured (this Mac, 2026-09-14; node 22 under load from other agents for CPU work, Chrome in the app's Browser pane for frames)

| what | size | time |
| --- | --- | --- |
| overworld chunk | 32 x 32 + 2-tile apron (a 10-tile margin generated) | **5.6 ms** (node); 5.8 ms in Chrome over 157 chunks |
| pipeline chunk (overworld stage) | 32 x 32 + apron | 6.9 ms |
| scatter | a 64 x 64 m chunk (all layers) | 403-990 plants in 16 ms |
| dungeons (48 x 36, rerolls included) | 1,000 seeds each | rooms 4.5 ms, bsp 0.42, cave 0.92, drunkard 0.50, wfc 1.5 |
| mixed map (192 x 144: overworld, level valley, CA cave, WFC town, dungeon, re-skin, pin) | | 168-985 ms |
| ground chunk bake, 32 x 32 | 4 / 8 px/m | classic 12 / 28 ms; with the surface 22 / 78 ms (sliced across frames) |
| rebake after a swap | creep, 53 tiles | 1 of 16 chunks rebaked, 20 ms |
| paint a 550-tile ragged disc (infinite world) | | 2 ms, then the touched chunks rebake sliced |
| frame 1920 x 1080 at 3 px/m, 68,808 swaying sprites + 121 ground layers | GPU finished | **2.2 ms median, 3.4 p95**; wind off 2.0 ms (sway costs ~0.2 ms); ground alone 0.9 ms |
| same, 54-66k sprites (another run) | | 1.0-1.4 ms median |
| recipe | the mixed map | **200 bytes** packed (its 16,128 tiles never stored) |
| biome table | 28 biomes | 2,301 bytes packed |
| dungeon crawl frame, 1920 x 1080 native, cutaway on, all revealed: bsp 96 x 72 at density 1.6 -- 1,223 props, 323 lights (311 flames flickering), 30 mobs, 48,686 quads, ~300 particles (Apple M4 Max, Chrome) | 24 / 32 / 48 px/m, GPU finished | **0.8-1.6 ms median, 0.9-2.6 p95** over two runs (max 2.9) -- 120 fps needs 8.3; the CPU step under 0.1 ms |
| crawl floor: generate + dress + scene | 64 x 48 | ~90-320 ms; baking its ~1,000 sprites 280-330 ms (once per zoom level) |
| the same crawl frame with depth sprites (2026-09-14, bsp 96 x 72 at density 1.6: 1,144 props, 332 lights, 30 mobs, 46,584 quads, 1920 x 1080) | 24 / 32 / 48 px/m, GPU finished | **1.0 / 1.0-1.2 / 0.9-1.6 ms median, p95 <= 1.9** (the committed renderer, same scene: 1.1 / 1.0 / 0.9, p95 <= 1.6); heights off in the new renderer 1.0 / 0.9 / 0.9 |
| baking the crawl's 1,211 sprites with heights | 16 / 32 / 48 px/m | 508 / 661 / 893 ms (without: 359 / 517 / 695: +28-41 %, once per zoom level); height planes 0.9 / 3.4 / 7.8 MB (two bytes a texel: half the colour pages') |

### The occlusion gate (`tools/occlusion-check.html`, 2026-09-14)

False-hidden / false-visible sprite pixels, card depth (before) -> depth sprites (after); the pass mark 0.1 % each.

| scene | judged pixels | before | after |
| --- | --- | --- | --- |
| dungeon (crypt), every state: cutaway stub / dither / off x fog visible / explored x doors shut / open; 16 24 32 48 px/m x 30 deg and 0.7 rad; 3 rooms each; the dressing and 28 more props and walking bodies against walls and doors | 2,669,732 | 23.7 % / 1.22 % | **0.009 % / 0.0001 %** |
| per state (stub, dither, off) | | 22.7 / 24.4 / 24.6 % false-hidden | 0.010 / 0.008 / 0.009 % |
| per place: dressing / back wall / front wall / door | | 28.8 / 21.2 / 12.3 / 18.4 % | 0.011 / 0.009 / 0.004 / 0.000 % |
| the four acts at 24 px/m (crypt, cave, forge, ruin) | 167-215 k each | 17.4-21.7 % / 0.8-3.1 % | 0.000-0.007 % / 0.000 % |
| terrain, GPU ground: cliff tops and feet, ramps, flats; 4 zooms x 2 pitches x 2 yaws | 441,936 | 16.2 % / 0.37 % | **0.005 % / 0.000 %** |
| terrain, CPU ground (16, 24 px/m, 2 pitches) | 49,899 | 16.8 % / 1.8 % | 0.004 % / 0.014 % |
| walk: every body across the floor kinds (room, corridor, rug, puddle, moss, doorway), 8 stride frames | 9,548 foot texels (under 12 cm) over 736 frames | 3,547 hidden (35-39 %; worst frame 100 %) | **1 hidden** (cave) |

Not judged, too close to call (within the tie and a sixteenth-texel height step, or two things touching): 0.4 % of
the dungeon's pixels, 0.3 % of the terrain's.

Coverage over 6,000 x 6,000 tiles (seed "coverage"): ocean 19%, taiga 10%,
warm ocean 9%, forest 9%, frozen ocean 9%, cold steppe 8%, beach 8%, plains
6%, river 6%, savanna 4%, ... down to snowy peaks 0.1%; water 43%.

## Tests

`node --test packages/worldgen/test/*.test.ts` (25): noise; determinism;
chunk independence (two chunks either order and one big block agree tile for
tile, three seeds); biome coverage and acts; the table's nearest and a pack's
biome; structures' spacing and separation; dungeons -- 1,000 seeds of each
generator through the gate, determinism, the grammar's rooms, themes; WFC
(constraints, edges agree, overlapping windows all in the sample, an
impossible set, backtracking on a hard set, the step budget; no map moves when the clock races); towns; the same
recipe byte for byte; mixing, pins and locks; an infinite stream in any
order, region stages cut in, a re-skin keeping its shape, finite = streamed;
scatter chunk independence and spacing and exclusion; codec round trips;
packs as contracts the registry resolves; levels from recipes (players and
not); `level@1`; re-skin; seasons; runtime creep rebaking only its chunks;
bake and scatter measurements. `crawl.test.ts` (12): acts distinct; dressing
fair over five generators x four acts x two seeds; roles to room kinds,
determinism, 50+ lights and 500+ props at density; scene walls hug the floor,
faces, cut columns; light masks and fog; yaws in [-pi, pi] through the level
codec; `dungeon@1` templates; `level@1` spawns/resources/markers; bases
joined over 16 seeds; the manifest's schemas; a GLSL lint.

## Integration

- **keel/level** takes a pipeline: `generateLevel({ world: levelWorld(recipe) })`
  (the level's bases, ramps, roads, towns run over the world's ground) or
  `generateWorldLevel(recipe)`; the recipe goes into `level.meta.recipe`
  (base64 codec bytes), so the biome and light layers regenerate from it.
  With players, `generateWorldLevel` guarantees every base reaches every
  other (`joinBases`: a three-wide road cut at base level along the cheapest
  way where the ground left them apart; `level.meta.joined` counts the cuts;
  tested over 16 seeds with 2 and 4 players).
- **packs/dungeon** (`@keel-engine/dungeon`) is the crawl's content: the
  props as styled objects with a look profile per act, `PROPS` (placement,
  footprint, blocking, destructible, openable, light), room templates
  (`ROOMS`, usable through `dungeon@1`'s `templates`).
- **keel/terrain** draws it: `worldSurface(layers)` is the `GroundSurface`
  and `surfacePalette` a map needs; an infinite world's chunks are baked with
  `origin` + `rect` (`createWorldBaker`).
- **Packs**: `defineWorldPack({ biomes, tilesets, rooms, acts })` provides
  `biome/<id>@1.0.0`, `tileset/<id>@1.0.0`, `rooms/<pack>@1.0.0`,
  `act/<id>@1.0.0`; `worldOptions(packs)` hands the lot to a pipeline.
- **The RTS** (`keel-rts`, `generateArena`): `arena.swapBiome(tiles, biome)`
  can be `createBiomePainter({ terrain, biome, table }).paint(tiles, biome)`
  with the ground baker given `surface: groundSurface({ biomes, biome })` --
  only the chunks it reaches rebake.
