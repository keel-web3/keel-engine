# `@keel-engine/biome`

Any biome on Earth as data. Module `keel/biome@0.1.0` (`kind: "runtime"`, needs
`keel/lit`, `keel/tiles`, `keel/flora`).

```ts
import { createBiome, biomeForClimate } from "@keel-engine/biome";

const biome = createBiome("swamp", { size: 48, seed: 7 });
stage.add(biome.root);
// each frame
biome.update({ time: t, dt, bodies: [{ x, z, radius: 1 }] });
// when something lands
biome.impact({ x, z, radius: 3, strength: 1.5 });
biome.heightAt(x, z); // the ground, for feet and cameras
```

`BIOMES` holds thirty: rainforest, monsoon forest, mangrove, cypress swamp, peat
bog, salt marsh, temperate forest and rainforest, taiga, tundra, alpine meadow,
high mountains, ice sheet, prairie, plains, steppe, savanna, Mediterranean
scrub, fynbos, moor, Sonoran desert, sand sea, badlands, salt flat, beach, coastal
dunes, volcanic field, karst, oasis and bamboo grove. `biomeForClimate(celsius,
rainMm)` finds the nearest. `defineBiome` adds your own; a biome is plain data:

| field | says |
| --- | --- |
| `relief` | how the land lies: `plain`, `hills`, `ridges`, `dunes`, `hummocks`, `terraces`, `crags` |
| `ground` | up to 8 layers painted by height, slope, height over the water and blotches, each with its tile look and 3D shell |
| `plants` | what grows, how thick, on which ground, in stands, in or on the water, or hanging from what is tall |
| `cover`, `vines`, `trees`, `water` | sprite ground cover, vines over rocks, trees, a waterline |
| `light`, `wind` | sun, sky, fog and the usual wind |

Trees are the real thing: `biome.trees` gives each one's species and place, for
`keel tree-growth` to grow and tree-render's `createForest` to draw, with its
own LOD and impostors.

Pass the eye to `update({ view: [x, y, z] })` each frame and everything sets its
own detail: the same stage works as a far background and as ground to walk on.
A planter or other small plot uses `createBiomePlot`: pass `soil` (`PLANTER_SOILS`
names it for each grove planter) and it grows what that ground can hold, mostly
grass and small things, never more than two bushes.

`thick` thins the plants for a background; `detail` and `reach` set how rich they
are and how far out that lasts.

`keel/worldgen` has biomes of its own for tile-grid games (climate noise over
an infinite overworld, foliage from packs). This module is the close-up: one
stage of real plants and ground.
