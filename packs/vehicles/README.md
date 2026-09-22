# packs/vehicles

Cars, generated. A seed becomes a body (archetype, proportions, parts), a
stance, lights, bumpers, a plate, a drivetrain and a set of physics — and, the
part this README is about, a LOOK: what every panel wears.

This pack is the engine's fullest worked example of the colour contract in
`docs/CONVENTIONS.md` ("Colour is a slot, never a texture coordinate") and
`@keel-engine/bake`'s README ("Shapes, looks and layers"). If you are writing a
generator and want to see the whole chain in one place, read it here.

```ts
// (the SDK: @keel/game-engine/vehicles)
import { generateCar, bodyPaint, wheelPaint, carDecals } from "@keel-engine/vehicles";
import { createLookTable } from "@keel-engine/bake";

const car = generateCar("0x1234");
const table = createLookTable();
const decals = carDecals(car, { pitch, texelsPerMetre: 72 });   // where each decal lands, in panel coordinates
const body = table.add(bodyPaint(car, { decals }));             // the instance's look index
const wheel = table.add(wheelPaint(car));
```

## The chain, end to end

1. **Name the part.** `slots.ts` `BODY_SLOT` gives every panel and material its
   slot — `paint`, `alt`, `glass`, `trim`, `carbon`, `grille`, `neon`, then the
   panels themselves: `hood`, `trunk`, `doorL`, `doorR`, `fenderFL`, `quarterR`,
   `bumperF`, `wing`, `plate`… `WHEEL_SLOT` does the same for a wheel (`tyre`,
   `tread`, `rim`, `hub`, `caliper`, `barrel`, `wall`, `spinner`).
2. **Build solids with that slot as `mat`** (`solids.ts`, `shapes.ts`). This is
   the only place colour is decided. Nothing downstream sees an RGB.
3. **Paint the slots** (`paint.ts`). `bodyPaint`/`wheelPaint` return a
   `LayerPaint`: per slot a ramp (OKLCH hue, chroma, lightness, span), a finish
   that bends the shade onto it, a livery pattern, its own dither screen, a clear
   coat's sheen and a decal. **Every panel is painted on its own** — which is how
   a door off another car, a bonnet in primer, quarters rusting through and a
   sun-faded roof all come out of one look.
4. **Place decals in panel coordinates** (`decals.ts`). A decal is inks and tones
   with its alpha already dithered, stamped at a rect of a panel's own surface
   coordinate (`panelFace`), so it rides the door through every direction and
   every zoom, lit by the door's shade. Where it goes is SCORED — how much of the
   panel the camera sees, how the ink stands off the paint under it, how calm the
   panel is — and the best free panel (or left-right pair) wins.
5. **Draw.** The same look table feeds the live mesh path (`lookMesh` →
   `drawMeshes`) and every baked rung (`planBake` → `drawLayers`). One shape, any
   number of looks.

## Why it is worth the discipline

- A new livery is a row of texels, not a bake. Ten thousand cars in ten thousand
  paint jobs bake the same handful of shapes.
- Stripes and sponsor marks stay put on a panel through a whole animation and a
  deep zoom, because the coordinate is the panel's, not the sprite's.
- No atlas, no mip chain, no filtering — the pixels are exact at any scale, and a
  car can be inspected up close without a second asset.
- Lights are slots too (`lights.ts`), so `uSlotGlow` turns a brake lamp on
  without touching geometry or a texture.

## The rest of the pack

`car.ts` the generated car and its panels · `traits.ts` what a seed rolls ·
`stance.ts` ride height and camber · `bumpers.ts`, `semi.ts`, `plate.ts` parts ·
`drive.ts`, `physics.ts` how it moves · `metadata.ts` the token's attributes.

**BODY_STYLES and ARCHETYPES are consensus-coupled** — they are read by proving
code, so they are not to be reordered or edited. Non-mintable bodies belong in
`SPECIAL_STYLES`.
