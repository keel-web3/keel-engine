# `packs/buildings` (`@keel-engine/buildings`)

A **modular building generator** and its variants, **bridges**, **ramps,
stairs and cliff steps**, **walls, fences and gates** that follow a path,
**path pieces** and a **dock** -- styled objects (`@keel-engine/object`,
"Styles"): one design each, drawn in pixel, voxel or any module's style, with
the design's colliders, sockets and front in every style. Module
`packs/buildings@1.0.0` (`kind: "pack"`), needs only `keel/object@^0.1`,
provides `objects/buildings@1.0.0`.

## The generator (`src/generator.ts`)

`buildingDesign(J, params)` -- every building variant is this with its own
choices (`src/building-object.ts` maps a variant's values onto the params):

| param | values |
| --- | --- |
| footprint | `rect`, `L` (a wing back from the right end), `T` (a wing back from the middle), `round` (an octagon) |
| size | width x depth, floors x floor height |
| walls | a stone plinth, the wall mass, floor bands, a frame: `timber` posts and beams, sci-fi `panels`, or none |
| roof | `gable` (ridge along each wing's long side, wall-coloured gable ends), `hip` (stepped: the renderer's solids add, never cut), `flat` (a parapet; its top a socket), `dome`, `spire` (square: stepped pyramid; round: octagon), `vault` (a sci-fi capsule with hoops), `saucer`, `shell` |
| door | `single`, `double`, `barn`, `arch`, `airlock`, `none` -- on the main wing's +z face, a step, maybe a porch; `doorAt` slides it along the front |
| windows | `few`, `many`, `band`, `porthole`, `none` -- along every outer face per floor, never where two wings meet or over the door; shutters; thinned evenly to a budget (a design must fit the renderer's 256 boxes) |
| extras | chimneys, a balcony, an awning and a sign board (shops), antennas with beacons, vents, smokestacks |

Sockets: `door` (the threshold, facing out), `entrance` (a spawn point in front
of it -- tested clear of every collider), `sign`, `roof` (a flat roof's top),
`chimney0..` / `stack0..` (smoke), `balcony`, `antenna`. Colliders: the wall
masses, roofs, chimneys; details never. `meta.building`: footprint (wings or a
radius), floors, height, `walkable: false` (v1 interiors are solid),
`entrances`. The front is declared +z and a part named `door` is on it: front
detection agrees (tested).

## Contents

| id | what | shape choices |
| --- | --- | --- |
| `building` | the generator itself, every parameter a choice (for the editor's building tool and agents) | all of the above |
| `cottage` | 1-2 floors, rect or L, gable or hip, timber frame, chimney, shutters, porch or balcony | footprint, width, depth, floors, roof, pitch, frame, chimneys, porch, shutters, doorAt |
| `tower` | 3-5 floors, round or square, spire / flat lookout / hip, arch door | footprint, width, floors, roof, pitch |
| `hall` | long and high, rect or T, double door, many windows, porch, two chimneys | footprint, width, depth, floors, roof, pitch, frame |
| `workshop` | barn door, tall floor, gable or flat, stack or chimney, vents | footprint, width, depth, floors, roof, pitch, stacks, chimneys |
| `shop` | awning, sign board (a socket for the shop's own sign), living over the shop | width, depth, floors, roof, pitch |
| `hab` | sci-fi module: vault roof with hoops, portholes or a lit band, airlock, antennas | footprint, width, depth, windows, antennas |
| `dome` | sci-fi: round base, dome or saucer, lit band, airlock | width, floors, roof, antennas |
| `pylon` | gravitic mast: stacked blocks, fins, a crystal or orb core, floating rings | height, base, core, rings, fins |
| `hive` | biotic: heaped chambers, openings, glowing pods, spines or a spore bulb | size, chambers, crown, pods |
| `factory` | machine: flat roofs, smokestacks, roller door, band windows | footprint, width, depth, floors, stacks |
| `bridge` | a span generator along z: `beam` (stringers, piers, handrails), `arch` (stone, humped, stepped spandrels, parapets), `rope` (sagging planks on ropes), `plank` | length 3..30, width, rise -3..3, kind, supports, depth |
| `ramp` | one wedge you walk up; curbs, rails or none | width, length, height, sides, build |
| `stairs` | steps to see, one wedge to walk; walls, rails or open | width, steps, rise, tread, sides, build |
| `cliff-steps` | a stair cut into a cliff: straight, a landing, or a dogleg; rock cheeks, the cliff behind | height, width, form |
| `wall` | a segment along x: stone, brick, log palisade, sci-fi panels; crenels; a thick one's top is a walkway | length, height, thick, kind, crenels |
| `fence` | a segment along x: picket, rail, wattle, glowing wire | length, height, kind |
| `gate` | wooden (leaves swung open), arch (towers, portcullis), sci-fi (a force field); `entry` / `exit` sockets | width, height, kind |
| `path-stones` | stepping stones, flagstones, a boardwalk (the terrain does surfaces; this is geometry on them) | length, width, kind |
| `dock` | planks on piles out over water, bollards (`moorLeft`, `moorRight`), a ladder | length, width, depth, ladder |

World roles (`src/kit.ts`, each on its own slot): wall, roof, trim, wood,
stone, glass, door, metal, glow, cloth, sign, rope, plank, organic, dark.
Every generator variant carries all twelve it may paint. **Cultures are look
profiles** (`src/profiles.ts`): village, stone, desert (adobe), nordic, scifi,
machine, biotic -- one baked cottage wears all of them
(`out/world-buildings-cultures.png`).

## Placing the two-ended pieces (`src/paths.ts`)

- **Bridges run along z**: `endA` at local +z on y = 0, `endB` at -z, `rise`
  higher. `bridgeFor(a, b, { kind, width })` returns the `ContentRecord`
  (pins `length`, `rise`; pivot at a's height under the middle; yaw so endA is
  on a) -- what the terrain's bridge spans hand over. Tested: 60 spans, any
  direction and rise, both end sockets within 2 mm of the span's ends (the
  length and rise are pinned to the millimetre), and the deck collides under
  each end. Lengths past 3..30 m or rises past 3 m throw. Bridges and docks
  `rest: "hang"`: placed by their ends, never settled; their piers reach below
  y = 0.
- **Walls, fences and path stones run along x** (`endA` at -x, `endB` at +x).
  `alongPath(points, { id, maxSegment, gates, pins, gatePins, seed })` splits
  each leg into equal segments and returns records that meet end to end; a
  segment named in `gates` becomes a gate sized to fill it post to post
  (`gateSpan`, `gateWidthFor`), or -- longer than a 6 m gate -- the gate in the
  middle and a piece of the run either side. The whole run shares one look seed.
- Ramps, stairs and cliff steps rise from their foot at +z (`foot` socket) to
  `top` at -z; the colliders are wedges (stairs: one along the nosings), so a
  body walks up them (tested, with physics' `createCharacter`).

## Codec

`@keel-engine/buildings/codec` (not in the KEEL module): `BUILDING_PINS`
(every asset's pins as a typed struct; `building`'s is the generator's whole
parameter set) and `CONTENT_RECORD` / `pinsSchemaOf` from
`@keel-engine/foliage/codec`. Tested: 360 pin sets round-trip to the same
built key (~25 B each), a village's records to the same things in the same
places (~65 B each).

## Sizes

`packs/buildings`: 50.2 KB minified, **15.6 KB gzip** (one KeelHold slug),
80 KB readable; its page closure (runtime, core, scene, physics, object, the
pack) 185 KB minified.

## Showcase

`node packs/buildings/tools/build.mjs`, then
http://localhost:4300/packs/buildings/tools/showcase.html (`?only=foliage,
buildings,wind,bridge,village`; `?save=0` not to write): every foliage kind and
building piece in both styles at 128 and 256 px, seasons and cultures, the
wind strip, four bridges over a river placed by `bridgeFor`, a village (pixel,
and the same records under a locked voxel setting) and an RTS colony, all
placed as `ContentRecord`s through `placeContent`. Scenes too big for one
raymarch (256 boxes) are composited: the world alone, then each thing over it
far to near. Sheets: `out/world-foliage-{128,256,seasons}.png`,
`out/world-buildings-{128,256,cultures}.png`, `out/world-wind.png`,
`out/world-bridge.png`, `out/world-village-{pixel,voxel}.png`,
`out/world-colony.png`.

## Tests

`node --test packs/buildings/test/*.test.ts` -- every object in both styles
over 50 seeds (same colliders and sockets, footprints within a voxel plus 5%
of its size for finials and antennas, the renderer's budgets, roles known,
designs on y = 0 but for bridges and docks); fronts, doors and entrances;
bridges' ends; paths; walking up ramps, stairs and cliff steps; placement and
cultures; the codec; the bundle (reaches only keel/object; builds on a page;
voxel with keel/builder loaded).
