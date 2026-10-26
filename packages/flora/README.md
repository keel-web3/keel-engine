# `@keel-engine/flora`

Foliage drawn by `keel/lit`: pixel-art sprites crossed into X and star cards,
or grown as real 3D blades, instanced by the thousand. Module
`keel/flora@0.1.0` (`kind: "runtime"`, needs `keel/lit`).

```ts
import { createFloraField, paintFoliageAtlas, scatter, pickWeighted } from "@keel-engine/flora";

const atlas = paintFoliageAtlas({ seed: 3, variants: 4 });
const plants = scatter({ bounds: [0, 0, 16, 16], spacing: 0.3, seed: 2, density: (x, z) => (surface.materialAt(x, z) === "grass" ? 0.8 : 0) })
  .map((p) => ({ x: p.x, y: 0, z: p.z, kind: pickWeighted({ grass: 10, daisy: 1, clover: 2 }, p.roll), variant: Math.floor(p.roll2 * 4), scale: 0.5, yaw: p.roll2 * 6.28, tint: "#5e9a42", bloom: "#f4f1ea" }));
const field = createFloraField({ atlas, style: "cards", planes: 2, normals: "ground" }, plants);
stage.add(field.root);
// each frame
field.setTime(t);
field.setWind(0.4, windDirection);
field.setPushers([{ x: player.x, z: player.z, radius: 0.8 }]);
```

## Cards and blades

`crossCards(planes)` stands 1..4 upright sprite planes through the root, turned
evenly round it: 2 make an X, 3 a star, so the clump reads round from every
side; 1 is a billboard that turns to face the camera. `bladeClump()` is real
geometry, tapering blades arcing out and over, for the near ground where a
card's edge would show. `style: "both"` draws blades near the eye and cards
past `lod.near`, crossfading by an ordered dither over `lod.band`.

## Lit as the ground

The trick that makes crossed cards look 3D in pixel art is the normal.
`normals: "ground"` (the default) lights every pixel of a plant as the ground
under it is lit, so a field of cards shades as one surface with the terrain
instead of as a thicket of flat planes catching the sun at random angles.
`"volume"` lights a plant as a rounded clump; `"card"` as its own flat planes.
The root darkens (`root.shade`, up to `root.height` of the plant) so plants
sink into the ground they stand on.

## Sprites

`paintFoliageAtlas({ kinds, variants, cell, seed })` paints grass tufts, tall
grass, clover, daisies, tulips, bells, wildflowers, ferns, sprouts, reeds and
mushrooms from a seed. A sprite holds no colours: red is the shade step (dark
to lit), green the part (leaf, stem, blossom, the flower's eye), so each plant
is coloured by its own `tint` and `bloom` and one atlas serves every season.

## Wind and pushers

Wind bends every plant downwind with gusts that roll across the field, plus a
quick flick in the tips; `setWind(strength, direction)` and `setTime`. Up to
four pushers (`setPushers`) part the plants round them and press them down.
`setGrow` squashes the whole field toward the ground (snow, mowing).

## Scatter

`scatter({ bounds, spacing, seed, jitter, density, limit })` is a jittered grid:
even without rows, the same seed always plants the same spots, each with two
rolls of its own for the caller's choices. `pickWeighted` turns a roll into a
kind.
