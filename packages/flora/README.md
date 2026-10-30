# `@keel-engine/flora`

Foliage drawn by `keel/lit`: pixel-art sprites crossed into X and star cards,
real 3D blades, a catalogue of 3D plants, stones and logs,
climbing vines and depth-layered ground, instanced by the thousand and all
moved by one spring field. Module
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

## Real plants

`PLANTS` holds over ninety kinds: bushes, flowers, grasses, forest
floor and jungle, desert, wetland, fungi, stones and logs, and things that hang.
Each is a recipe over a few growth habits, so a new one is a line of numbers;
`definePlant` adds your own, on a `PlantBuilder` (`tube`, `leaf`, `lump`,
`finish`) when no habit fits. Every kind is one unit tall, so a placement's
`size` is its height. (Trees are keel tree-growth's, not these.)

Each plant has three levels of detail, chosen by how big it is and how far off:
call `setView` every frame and only what is close costs what close costs, with
an ordered dither crossing each border. The near shape is built the first time
anything comes near. Past the last border a plant is not drawn at all.

```ts
const motion = createFloraMotion({ bounds: [-24, -24, 24, 24] });
const plants = createPlantField({ motion }, [{ kind: "hydrangea", x: 1, y: 0, z: 2, size: 1, tint: "#4f7f3a", bloom: "#8a9ae0" }]);
stage.add(plants.root);
// each frame
motion.setTime(t); motion.setWind(0.4, direction); motion.setBodies([{ x, z, radius: 1 }]); motion.step(dt);
// a landing, a blast, a thrown stone
motion.impact({ x, z, radius: 3, strength: 1.5 });
```

## The motion field

`createFloraMotion` is one grid of damped springs over the ground, stepped at a
fixed 60 Hz and sampled as a texture, so cost does not grow with the plants or
the bodies. Bodies hold plants aside and flatten them; they spring back and
wobble when released, trodden ground takes seconds to rise, and neighbouring
cells pull on each other, so an impact runs out as a ring. Pass it to a
`createFloraField` (`motion`), `createPlantField`, `createVineField` and
`createGroundShells`, and all of them move together. Deterministic.

## Vines

`crawl(surface, { start, toward })` walks a path over anything that gives a
signed distance (a boulder, a wall, a trunk); `createVineField` makes paths into
stems, leaves and loose tendrils, and `setReach` grows them along their length.
Kinds that hang (`liana`, `spanish-moss`, `wisteria`, `aerial-roots`,
`ivy-curtain`) are placed at their anchor and fall from it.

## Ground shells

`createGroundShells` redraws a surface in stacked layers, each texel kept only
as high as a height function reaches: `fuzz`, `moss`, `pebbles`, `cracks`,
`ripples`, `mounds`, `strata`, `litter`, one look per material. It reads as real
relief with no geometry of its own, sways with the wind and flattens underfoot.
