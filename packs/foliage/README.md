# `packs/foliage` (`@keel-engine/foliage`)

Trees, bushes, ground cover, rocks, logs and crystals as **styled objects**
(`@keel-engine/object`, "Styles"): one design each, drawn in the **pixel**
style (the engine's primitives) or the **voxel** style (`@keel-engine/builder`)
or any module's own, with the design's colliders and sockets in every style.
Module `packs/foliage@1.0.0` (`kind: "pack"`), needs only `keel/object@^0.1`,
provides `objects/foliage@1.0.0`; its manifest's `contents.objects` lists every
asset with a `tier:background` tag (and `massive` for ground cover).

One file per asset in `src/objects/`; `src/kit.ts` holds the world roles every
asset draws from (each paints its own slot, so a season recolours all of them
at once), wind presets and the pieces trees are made of (a tapering, leaning
`trunk`, `branch`, a `canopy` of blobs, `scatter`); `src/profiles.ts` the
seasons and biomes.

| id | shape choices | world roles | tier |
| --- | --- | --- | --- |
| `oak` | height 5..9, crown round/wide/tall, fork low/high, limbs 2/3/4, lean 0..0.25, acorns, moss | leaf, bark, fruit, moss | background |
| `pine` | height 6..12, tiers 3..6, form classic/narrow/sparse, lean 0..0.12 | needle, bark, leaf (the tip: snow in winter) | background |
| `birch` | height 6..10, trunks 1/2/3, crown oval/drooping, lean | leaf, paperbark (banded), dark | background |
| `palm` | height 5..10, curve 0.05..0.5, fronds 5..8, coconuts | leaf, bark, fruit | background |
| `dead-tree` | height 4..8, branches 2..5, snag, lean 0..0.35 | bark, dark, moss | background |
| `mushroom` (giant, fungal) | height 1.2..6, cap dome/flat/bell/cone, stems 1..3, spots, glowing gills | cap, stem, spot, glow | background |
| `alien-tree` | height 3..7, form bulb/coral/spire, arms 3..6 | bark, leaf, glow | background |
| `bush` | size 0.6..1.8, form round/wide/tall, bloom none/berries/blossom | leaf, blossom, fruit, bark | background |
| `grass` (massive) | height 0.15..0.55, blades 5/7/9, spread tight/fan, seeds | leaf, blossom | background |
| `flowers` (massive) | height 0.2..0.6, kind daisy/tulip/bell/wild, count 1/3/5 | leaf, blossom, fruit | background |
| `reeds` (massive) | height 0.6..1.8, stalks 4/6/8, cattails | leaf, fruit, blossom | background |
| `cactus` | height 0.6..4, form saguaro/barrel/prickly, arms 0..3, flower | leaf, blossom, fruit | background |
| `rock` (and boulders) | size 0.4..3, form round/flat/jagged/stack, moss none/top/patchy, crystal vein | stone, moss, crystal | background |
| `log` | length 1.5..5, radius 0.18..0.5, hollow, fungus, moss | bark, wood, moss, cap, dark | background |
| `stump` | height 0.3..1, radius 0.25..0.6, roots 3..5, mushrooms, moss | bark, wood, cap, stem, moss | background |
| `crystal` | height 0.5..3, form cluster/spire/geode, count 3/5/7, glow | crystal, stone, glow | background |

Every asset also has the implicit `variant` choice (its own jitter, 4..8
variants), and some a look choice `season` (spring / summer / autumn / winter:
the name of a profile -- a placement's look wears it unless it names another).

**Seasons and biomes are look profiles** (`src/profiles.ts`): summer, spring,
autumn, winter, dry (savanna), desert, tropical, alien, fungal, ash, ice. Each
gives per world role the OKLCH ranges its colour is drawn from; they cost
nothing to change (looks are painted by the sprite shader, never baked): one
oak shape wears all eleven (`out/world-foliage-seasons.png`).

**Wind.** Trees, bushes and ground cover carry a `SwaySpec` (amp as a share of
height, hz, bend, a stiff foot); rocks, logs, stumps, cacti, crystals and dead
trees none. The cheap good-looking option -- the default -- is the sprite
shader shifting each texel row of the one baked sprite by whole pixels
(`swayShift`, phase from the instance's ground position so gusts roll across a
meadow): zero extra bakes, pixel-true. Until the bake's sprite shader has it,
`bakeDesignOf(built, { swayFrames: 4 })` bakes a 4-frame sway clip
(`out/world-wind.png` shows both).

**Massive instancing.** grass, flowers and reeds are `instancing: "massive"`,
`billboard` (one baked direction), no colliders, four variants and a coarse
choice grid: a thousand tufts drawn with `shapeGrid(def, S, { steps: 2 })` make
at most `shapeCount` shapes (tested <= 96; a meadow is a few dozen sprites),
each tuft its own look.

Voxel style: each design has a voxel hint where its size alone would be wrong
(grass and flowers: a few cm), and the voxel style keeps thin blades, cone tips
and wedge feet within half a voxel.

## Codec

`@keel-engine/foliage/codec` (not in the KEEL module; the editor, level saves
and agents import it): `pinsSchemaOf(def)` -- an asset's pins as a struct of its
choices (lists as enums, ranges on a grid of a thousandth, exact values kept) --
`FOLIAGE_PINS`, and `CONTENT_RECORD` (`keel/object/content`): a placement record
(pack, id, seed, pins, look, style, tier, pos, yaw, scale). Round-trips tested in
packs/buildings/test/codec.test.ts (~25 B a pin set, ~65 B a record as its own
document).

## Sizes

`packs/foliage`: 35.6 KB minified, **10.7 KB gzip** (KEEL's stored form: one
slug), 56 KB readable. Its page closure (keel/runtime, core, scene, physics,
object, the pack): 171 KB minified. With keel/builder on the page, voxel.

## Tests

`node --test packs/foliage/test/*.test.ts` -- every kind in both styles over 50
seeds: identical colliders and sockets, footprints within a voxel (plus 8% of
its size for the pixel style's spheres standing in for flattened balls; the
measured worst is 1.6 voxels, a cactus), inside the renderer's budgets (256
boxes, 256 capsules, 128 wedges), every part on a declared role and every role
used, designs standing on y = 0; massive kinds few shapes, no colliders, one
direction; wind; profiles' ranges; placing with a season and a locked voxel
setting; determinism. `bundle.test.ts`: the module reaches only keel/object,
starts on a page and builds every asset (a voxel request on a page without the
builder draws pixel), and with keel/builder on the page draws voxels.

The sheets: `node packs/buildings/tools/build.mjs`, then
http://localhost:4300/packs/buildings/tools/showcase.html (`out/world-*.png`).
