# `@keel-engine/tiles`

Tile surfaces drawn by `keel/lit`. A grid holds one material per cell; each
material finds its edge with its own tile system, and one shader draws them
all in one pass, snapped to a pixel-art texel grid. Module `keel/tiles@0.1.0`
(`kind: "runtime"`, needs `keel/lit`).

```ts
import { createTileGrid, createTileSurface, paintTileAtlas, importTileAtlas } from "@keel-engine/tiles";

const grid = createTileGrid({ width: 16, depth: 16, materials: ["water", "sand", "dirt", "grass", "path"], fill: "grass" });
grid.paint("water", (x, z) => Math.hypot(x - 3, z - 12) < 3);
const surface = createTileSurface(grid, {
  texels: 16,
  materials: {
    water: { ramp: ["#2c5e86", "#3d7aa8", "#5d9cc6", "#bfe3f2"], pattern: "ripple" },
    sand: { ramp: ["#b89a62", "#d2b77c", "#e4cf98", "#f3e6bd"], pattern: "stripes" },
    dirt: { ramp: ["#4e3424", "#6b4a32", "#86603f", "#a07a52"], pattern: "speckle" },
    grass: { ramp: ["#2f5d2a", "#447a34", "#5d9a3e", "#7fbf4f"], pattern: "tufts" },
    path: { ramp: ["#4c4a4a", "#7a7570", "#9a948c", "#c2bbb0"], pattern: "cobble", system: "blob47", atlas: paintTileAtlas("blob47") },
  },
});
stage.add(surface.mesh);
```

## Layers

Materials are ordered from the base up, and a higher material counts as every
lower one: grass's edge runs over the dirt, the dirt's over the sand. That
membership is what every system reads, so materials of different systems
stack cleanly. The base material is never cut; it is what shows where nothing
above covers.

## The systems

| system | tiles | how a cell picks its tile |
| --- | --- | --- |
| `blend` | none | A field between cell centres, roughened by noise and cut at the texel grid: organic edges with no art. A lit rim on the edge facing north, a dark lip on the edge facing away, a drop shadow on the material beneath |
| `blob47` | 47 | The 8 neighbours, corners counting only where both edges beside them are in (the Wang blob set; the same order as `keel/terrain`'s `BLOB47`) |
| `wang16` | 16 | Corners: NE 1, SE 2, SW 4, NW 8, a corner in when its two edges and diagonal are |
| `cardinal16` | 16 | Edges: N 1, E 2, S 4, W 8 (roads, fences, rivers) |
| `dual16` | 16 | The dual grid: tiles half a cell off, their corners on four cell centres (NE 1, SE 2, SW 4, NW 8) |

Neighbours run clockwise from north (+z): N 0, NE 1, E 2, SE 3, S 4, SW 5, W 6,
NW 7. `grid.tile(system, x, z, layer)` gives the same index on the CPU.

## Atlases

`paintTileAtlas(system, { tile, seed, rough, grow, round, rim, shadow })`
paints every tile of a system as pixel art: the shape only, plus shade steps
(lit rim, dark lip, drop shadow), so one atlas serves any material's ramp and
any season. Painted edges wander with noise that repeats every tile, so any
two tiles that share an edge meet texel for texel.

`importTileAtlas(image, { layout, tile, at, variants, order })` cuts an
artist's sheet (RGBA): `blob47` (8 to a row), `wang16`, `cardinal16`,
`dual16` (4 x 4, or any order via `order`), or an RPG Maker `rpgmaker-a2`
block, composed into the 47 blob tiles quarter by quarter. Imported tiles are
drawn in their own colours; `variants` blocks to the right are picked per cell
by a hash.

## Patterns

`flat`, `noise`, `speckle`, `cobble`, `ripple` (animated by `setTime`),
`tufts` and `stripes`, each dithered onto the material's four-colour ramp.
`setRamp` recolours a material live (seasons, wetness, death).

## The surface

`createTileSurface(grid, { materials, cell, origin, texels, height, clip })`:
one mesh, flat or on a height per grid vertex; `clip(x, z)` keeps only the
texels it accepts (a round plot, a coastline). `update()` uploads the grid
after `set` or `paint` (cheap to call every frame). `materialAt`, `cellAt` and
`covers` answer where things may grow or stand.
