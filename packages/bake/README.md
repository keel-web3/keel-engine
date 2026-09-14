# @keel-engine/bake

Design once, draw fast. Building a thing's model and posing it is expensive;
drawing a sprite isn't. So a game bakes every design it uses — each entity
variant (with its attributes), object and prop — into sprite atlases at load,
from N directions for each clip's frames, at the game's pixel scale; frames
then only draw sprites. Module `keel/bake@0.1.0` (`kind: "runtime"`, needs `keel/runtime@^0.1`, `keel/core@^0.1`,
`keel/entity@^0.1`, `keel/codec@^0.1`; the pixel renderer is handed in, so it needs no `keel/render`).

Two ways to bake: **colours baked in** (`renderSprites`: a design's palette through the full pixel pipeline — props,
anything drawn one way) and **indexed** (`renderIndexedSprites`: SHAPES baked once as slots, shades and surface
coordinates, painted by any number of LOOKS at draw time, wearables as their own layers — see
[Shapes, looks and layers](#shapes-looks-and-layers-the-smart-cache), what `examples/army` draws ten thousand
different characters with).

| part | what it does |
| --- | --- |
| `planBake(designs, { directions, pixelsPerMetre, pitch, style })` | every sprite to make, keyed by everything that changes its pixels — two units of one design share sprites, and a second load of the same army at the same scale bakes nothing |
| `packAtlas(rects, { size, pad, pow2 })` | skyline packing into pages; deterministic (same sprites, same atlas); opens pages as they fill |
| `pixelView({ center, yaw, pitch, pixelsPerMetre, width, height })` | the orthographic pixel camera: `project`, `ground` (picking), `groundRect` (culling). A real pixel scale — pixels per metre — so sprites land texel for pixel at any picture size |
| `createSpriteRenderer(canvas, { width, height, capacity })` | every visible sprite in **one instanced draw** from a texture array; quads snapped to whole pixels; depth from position, so no CPU sorting; `SpriteInstances.push(..., layer, flags, scale)` -- a per-instance scale draws a bake made at another pixel scale at its right size |
| `createGrid({ cell, capacity })` | a spatial hash on the ground plane in typed arrays: `set` (move), `near`, `rect`, `nearest` — culling, picking, separation, target search |
| `directionFor(yaw, cameraYaw, n)` | which baked direction shows a thing facing `yaw` (0 = its front toward the camera) |
| `bakeSprites(renderer, jobs, designs, options)` | every job drawn through the pixel renderer (`createPixelRenderer` on an offscreen canvas), trimmed, anchored and packed: `{ pages, sprites: Map<job key, { page, x, y, w, h, ax, ay }>, baked, stats }` |
| `renderSprites(...)` / `atlasOf(sprites, pack)` | the two halves: draw + trim (no packing), and pack (sorted by key: the same sprites make the same atlas, whatever order they were baked in) |
| `entityDesign(spec, { pack, clips, materials, palette, attributes })` | an entity (and what it wears, through `wear` + `placeAttribute`) as a design: a `DesignSpec` keyed by pack, kind, species, seed + a hash of the spec, what it wears (ids + pins), the clips' frames and the look; `pose(clip, frame)` -> its capsules and boxes at the origin facing +z; `clip(name)` -> `{ frames, cycle, speed, period }` |
| `frameOf(clip, dist, time)` | the frame a clip shows: by distance for a moving clip (feet stay planted), by time on the spot |
| `createSpriteCache()` | baked sprites by job key: `missing(jobs)`, `add`, `drop`, `atlas(keys)`, `save()` -> `{ format, pages, table }`, `load(saved)`; `encodeBake` / `decodeBake` make that one byte array |

| `renderIndexedSprites(renderer, jobs, shapes)` / `bakeIndexed` | the indexed bake: each texel `(slot, shade, u, v)` + edge and behind flags, no colours (`encodeTexel` / `decodeTexel`, `trimIndexed`) |
| `bodyShape(spec, { pack, clips, wear })` | an entity's body as a shape: keyed by its geometry over every baked frame (never its colours or its outfit's coverage); slots by part; `slotRoles(coverage)`; `records(directions, pitch)` -- where each socket lands per clip, frame and direction |
| `socketClass(socket, plan)` / `attributeShape(def, cls, pins)` | a rigid wearable built to a socket CLASS (its size on a 20% ladder, axes rounded): baked once per class and direction, whoever wears it |
| `createLookTable()` / `paintSlots` / `paintRoles` | every look a scene draws: ramps and paints shared by value, looks by paint; the textures the layer shader reads |
| `SpriteRenderer.setLooks` / `drawLayers(view, LayerInstances, style)` | indexed sprites through their looks (plain RGBA ones alongside, look −1), one instanced draw |
| `SpriteRenderer.drawSway(view, SwayInstances, { time, wind, speed, gust, benders })` / `packSway` / `swayShiftPacked` | WIND in the sprite shader (`sway.ts`): drawLayers plus a packed sway (amplitude px, where the bend starts, its curve, hz: 24 bits in one float) and a lean per instance; each texel ROW shifted by whole pixels (pixel-true, no smear, no bake per pose), the phase from the ground position, GUST waves rolling across the map along the wind, up to 8 BENDERS (units walking through) pushing what's near them; `swayShiftPacked` is the CPU reference, tested against keel/object's `swayShift`. Measured (worlds example, 1920 x 1080, 68,808 swaying sprites): 2.2 ms a frame GPU-finished, 2.0 with the wind off -- sway costs ~0.2 ms |
| `populate({ seed, count, entities, attributes, pins, explicit, exceptions })` / `bakeCost(pop)` | thousands of characters, every one different, from a few shapes -- each unit derivable alone, layer by layer (see [Hybrid records](#hybrid-records-storing-a-population)); what baking them costs, layered vs combined vs one design a unit |
| `createBakeQueue()` | jobs waiting to be baked: enqueue with a priority, `prioritise(design, n)` each frame, `take(n)` a slice -- the most wanted first, a design's jobs together (the simple queue; `createSpriteStream` is the loader games use) |
| `createSpriteStream({ designs, ladder, ... })` | the streaming loader: every (design, clip, frame, direction) at every zoom level, re-ordered every frame from what the game draws, a live atlas, stand-ins, eviction -- see [Streaming](#streaming-the-smart-loader) |
| `createBakeWorkers({ entry, payload })` / `serveBakes({ renderer, sources })` | baking in a Web Worker, started from the game's own code (a KEEL document's module scripts, or the game's ES module) |
| `createFrameBudget()` / `createShelfAtlas()` / `bakeSlice()` | the spare time of a frame; a live atlas (sprites placed and freed one at a time); a slice of mixed indexed and plain jobs |
| `populateShapes(options)` / `dressPopulation(shapes)` | a population's shapes and who wears what (fast: what the scene scan and the bake need), then its looks -- together exactly `populate()`; given the options' exceptions, the looks come without a pool |
| `populationUnit(options, i)` / `unitFrame(clip, anim, dist, time)` | one unit alone (the batch's unit i, with the exceptions); the frame a unit shows by its own stride, idle style and phase |
| `recordOf(pop, pins, explicit)` / `populationOf(record)` / `unitOf(record, i)` / `shapesOf` / `recordPrefix` | a population as a hybrid record (the codec's `HYBRID_POPULATION`: recipe + re-rolls + pins + explicit parts) and back -- all of it, its shapes, one unit, its first n |
| `bodyShape(spec, { skin, sockets })` | an explicit body (a builder voxel hero): its own skin posed through the rig, slotted by part, its own sockets |

Why orthographic: perspective scales sprites with distance and smears the
pixel grid; pixel-art strategy games look down orthographically, and every
sprite then keeps its exact pixels.

## The bake

```ts
const px = createPixelRenderer(new OffscreenCanvas(64, 64));          // the baker's own renderer
const fox = entityDesign(entityOf("42", { kind: "anthro" }), { attributes: [hat, { def: pack, pins: { big: true } }] });
const plan = planBake([fox, ...more], { directions: 8, pixelsPerMetre: 24, pitch: 0.6, style: bakeStyleKey({ style }) });
const cache = createSpriteCache();
cache.add(renderSprites(px, cache.missing(plan.sprites), new Map([[fox.key, fox], ...]), { style }).baked);
sprites.setPages(cache.atlas(plan.sprites.map((j) => j.key)).pages);
```

- **Clips** (default): two legs `idle 6, walk 8, run 8`; four legs `idle 6, walk 8, trot 8, gallop 8` frames a cycle. A
  moving clip's frames are phases of one cycle (`cycle` metres long, played by distance); `idle` is one breath.
- **The camera.** The pixel view is orthographic; the raymarcher is perspective. Until it has an orthographic mode,
  each sprite is drawn from far away (`bakeDistance(k)`: where the march's hit tolerance, 0.0015 × distance, is about
  a pixel; 6–90 m) through a lens whose picture plane through the design's origin has exactly `k` pixels a metre --
  the ground point lands on the pixel it would orthographically; the rest is off by depth / distance (a few per cent
  on the nearest limb). The tolerance would fatten every silhouette by that much, so the baker thins every solid by
  it (`thinned`). Directions orbit the camera, and the light turns with it (`sun` is camera-relative): every sprite
  is lit from the same side of the screen.
- **The mask is exact.** The sky (material 5) and the water (4, sunk out of sight) wear a one-entry ramp of a key
  colour that's in no other ramp (`keyColourFor`), fog is pushed past the far limit: every pixel is a palette entry,
  so a pixel is background exactly when it's the key. Sprites are palette entries only (checked: 0 off-palette
  pixels over 14,400 sprites); the outline stays.
- **The anchor** is the ground point under the design's origin, in sprite pixels: a pixel corner (the picture is an
  even number of pixels wide), carried through trimming. The sprite renderer snaps it to the nearest whole pixel.
- **No stall per sprite.** Each render is copied on the GPU into a staging texture (2048² by default); it's read back
  once when it fills. The renderer is the baker's while it bakes (target, palette, materials, style, fx, world).
- **Keys** carry everything that changes pixels: the design key, clip, frame, direction, pixels per metre, pitch,
  and the plan's `style` (`bakeStyleKey(options)` names the bake options that matter).
- **Progressive**: bake in chunks (`cache.missing(jobs).slice(0, n)`) a few ms a frame, the designs most on screen
  first; a design is drawn at another scale's bake (sprites' per-instance `scale`) until its own is done
  (`examples/army` does exactly this).

### Measured bake (tools/bake-bench.html, 2026-09-13, this Mac, Chrome in the app's Browser pane)

24 designs (people, anthro animals, animals; each wearing one or two things), 8 directions, 20–30 frames each:

| scale | sprites | sprite height | bake | per sprite | per design |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16 px/m | 4,800 | ~19 px | 0.92 s | 0.19 ms | 38 ms |
| 24 px/m | 4,800 | ~28 px | 1.13 s | 0.24 ms | 47 ms |
| 32 px/m | 4,800 | ~37 px | 1.34 s | 0.28 ms | 56 ms |
| 75 px/m (4 designs) | 768 | ~93 px | 0.36 s | 0.47 ms | 91 ms |
| 150 px/m (2 designs) | 416 | ~162 px | 0.32 s | 0.77 ms | 160 ms |
| 88 px/m, people (loaded Mac) | 352 | ~149 px | 0.38 s | 1.08 ms | 189 ms |
| 176 px/m, people (loaded Mac) | 352 | ~304 px | 0.71 s | 2.01 ms | 354 ms |

The shaders compile in ~60 ms (the first sprite). Small sprites cost the renderer's per-frame overhead (~0.2 ms,
posing is 0.02 ms); big ones the read-back and trim (a person 300 px tall keeps ~38% of its picture). Build with
`node packages/bake/tools/build.mjs`; open `packages/bake/tools/bake-bench.html` on the dev server
(`out/bake-sheet.png` is the sheet it saves: every design walking, 8 directions, anchors marked).

## Shapes, looks and layers (the smart cache)

A character is two things: its SHAPE (what it is as a solid: a body's
proportions, ears and hair; a hat's crown and brim; a flag's pole and cloth)
and its LOOK (what each part wears: a colour profile per role, a pattern, a
finish; which parts a jacket covers). Only shapes are baked. Looks are painted
by the sprite shader — so one baked body serves every colourway, coat and
outfit, and a new look costs a row of texels, never a bake.

```ts
const pop = populate({ seed, count: 10000, entities: [{ def: human, pack: "packs/humans" }, ...], attributes: [{ def: beanie }, ...] });
// Bake the shapes (bodies: every clip frame x direction; wearables: every direction), indexed.
const plan = planBake([...pop.bodies, ...pop.attributes], { directions: 8, pixelsPerMetre: 24, style: "indexed" });
cache.add(renderIndexedSprites(px, cache.missing(plan.sprites), new Map([...pop.bodies, ...pop.attributes].map((d) => [d.key, d]))).baked);
// Every unit's looks into the table, once.
const table = createLookTable();
const bodyLook = table.add(paintSlots(u.look, pop.bodies[u.body].slotRoles(u.coverage), u.wornLook, WORN_SLOT));
const hatLook = table.add(paintRoles(u.wears[0].look));
sprites.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: table.texture() });
// A frame: the body, then each wearable on its socket for the frame shown (records), a hair in front or behind.
layers.push(x, 0, z, ...bodyRect, ...bodyAnchor, page, bodyLook, 0, k / bakedAt);
layers.push(x, 0, z, ...hatRect, hat.ax - right * kHat, hat.ay - lift * cos(pitch) * kHat + up * kHat, page, hatLook, 0.05, k / kHat);
sprites.drawLayers(view, layers, { screen: 4, dither: 0.9, outline: 3 });
```

- **Indexed texels** (`indexed.ts`). The baker draws through keel/render's bake mode (`renderIndexed`): pass 1 as
  ever plus each hit's surface coordinate; pass 2 writes, per pixel, the material (= the slot: `SLOT_MAT + slot`), an
  outline edge (the pixel pass's own test), whether it's behind the design's split point, the shade and the
  coordinate. Trimmed to `r = slot+1 | behind<<6 | edge<<7, g = shade, b = u, a = v`. Sizes are rounded to 16 px so a
  slice of small sprites shares the renderer's targets.
- **Patterns ride the part.** The coordinate is the part's own -- round a capsule and along it, across a box's face --
  so stripes stay on a sleeve through a walk cycle (not sliding across the sprite, as sprite-space patterns would);
  they restart at each part's edge. 8 bits a way: 32 texel steps per pattern repeat at the 8 repeats we allow.
- **The layer shader** (`sprites.ts` `drawLayers`): texel → the instance's look → the slot's PAINT (ramp base and
  length, finish, pattern, ink ramp) → the finish bends the shade onto the ramp (matte, cloth softer, leather, metal
  hard with a glint at the top, glow lifted) → the pattern (stripes at an angle, bands, spots, checks, camo, trim
  edges; a gradient leans the part along its ramp) moves it onto the ink's ramp or along its own → a Bayer screen
  anchored to the screen breaks the step between two entries → an edge texel goes `outline` entries darker.
  Every pixel is a palette entry. Plain RGBA sprites draw in the same call (look −1).
- **Bodies** (`shapes.ts` `bodyShape`): slots by part (`BODY_SLOTS`: head, snout, ... forearm, hand, thigh, ... paw,
  and four worn slots for what's baked into it). Which role each slot wears is the look's: `slotRoles({ top, pants,
  shoes, coat })` skins the same body in that coverage and reads the roles back -- a tee's forearms are bare, a
  jacket's are cloth. Keyed by the geometry of every frame it bakes: seeds, colours and coverage don't move it.
- **Wearables as layers.** A rigid attribute (`layer: "own"`, the default) is built to a SOCKET CLASS and baked alone,
  lifted clear of the ground anchor, once per class and direction. A body's `records(directions, pitch)` say where
  each socket lands on every clip frame and direction (screen metres right and up of the anchor; the socket's tilt;
  a front/behind flag for consumers without per-texel depth). The wearable is drawn with its socket texel on that
  point. Its texels carry a BEHIND flag (the attribute's split point is its socket origin): the layer shader writes
  those a hair behind its body's depth and the rest a hair in front -- so a scarf's back half goes behind the neck,
  a hood's shell behind the head, a pack behind the back from the front and over it from behind, from one sprite
  per direction. (The spec's per-record front/behind was tried first: a scarf drawn whole in front covered the
  chin; hence the per-texel split.)
- **What bends** (`layer: "body"`: boots) is baked into the body, filling its worn slots; the worn thing's look
  paints them (`paintSlots(look, roles, wornLook, WORN_SLOT)`).
- **Rigid means rigid** (v1): a wearable rides its socket's position through every frame but not its bone's roll --
  a hat stays upright through a nod, a pack through a gallop's pitch. The tilt is recorded per frame for a later
  tilt bucket (bake a wearable at ±15° and pick by the record).
- **Cost** (`bakeCost`): `Σ bodies × frames × directions + Σ wearable shapes × directions`, against the product
  (every distinct body + worn-shapes combination baked whole) and one design a unit.
- **The look table** (`looks.ts`): `palette` (RGBA8, every ramp once), `paints` (RGBA32UI, per paint: ramp base +
  length + finish + pattern bits + shift; ink ramp), `looks` (RGBA32UI: per look 32 paint indices). Ten thousand
  units' looks: ~30,000 looks, ~74,000 ramps, 370,000 colours -- every index is 32-bit for that reason.
- **Populations** (`population.ts`): per entity a few body shapes (shape choices on a grid: runtime's `pickShape`),
  per unit one of them, a coverage, a look kept at least `threshold` (OKLab ΔE 0.08) from every unit of its kind
  in that coverage (core's `createLookPool`: re-rolls), 1–3 wearables in shape `variants` (6 each by default,
  drawn once for the population) with looks of their own, and an animation variation (gait speed, stride, idle
  style and phase). Each of a unit's LAYERS draws from its own stream, so any unit is derivable alone and a pin on
  one layer never moves another -- see [Hybrid records](#hybrid-records-storing-a-population). Deterministic; a
  population's first units are the same whatever its size.
- **The stream** (`stream.ts`): the army streams its shapes per sprite -- what's on screen first, the rest while it
  plays, in a bake worker -- see [Streaming](#streaming-the-smart-loader). (The simpler design-at-a-time queue,
  `queue.ts`, is still there.)

### Measured (examples/army, 2026-09-13, this Mac, Chrome in the app's Browser pane, other agents' work running)

The population: 10,000 units from 14 characters -- **16 body shapes, 666 wearable shapes** (13 wearables x 6 variants
x the socket classes they're worn in), **29,919 distinct looks**, every unit's signature distinct, the closest two of
one kind in one coverage 0.080 apart (1,023 re-rolls, 0 failures), generated in 0.65 s (up to 2.2 s on a loaded Mac).
(Since the per-unit layers, and with its voxel hero: 17 body shapes, 668 wearable shapes, 30,130 looks, 950 re-rolls;
read from its stored record -- no look pools -- in 0.35 s. The bake and draw numbers below are from before.)

| bake, per scale | sprites | time | per sprite |
| --- | ---: | ---: | ---: |
| before: 16 designs, colours and attributes baked in (the old army) | 3,206 | 0.7–1.1 s | 0.25–0.3 ms |
| indexed bodies (16 shapes) at 24 / 8 px/m | 3,200 | 0.99 / 0.89 s | 0.31 / 0.28 ms |
| indexed wearables (666 shapes) at 24 / 8 px/m | 5,328 | 0.58 / 1.10 s | 0.11 / 0.21 ms |
| the whole army at 24 / 16 / 8 px/m | 8,528 | 1.6 / 1.75 / 1.4 s | ~0.19 ms |
| the same 10,000 characters, colours baked in: every distinct body + wear combination | 1,478,656 | ≈ 6–7 min | |
| ... one design a unit (the old way to make them all differ) | 2,007,552 | ≈ 9 min | |

So a bake now costs a little more than the old 16-design army's (8.5k sprites, not 3.2k: the wearables) and makes
10,000 different characters instead of 16 -- 170x cheaper than baking those characters combined. `variants` is the
knob: 3 variants a wearable halve the wearable sprites (3,000).

| draw, 1920×1080, 10,000 units | in view | layers | frame, GPU finished (median / p95) | live |
| --- | ---: | ---: | ---: | ---: |
| before (old army), 8 px/m | 4,876 | 6,698 sprites | 1.5 / 3.6 ms | 120 fps |
| before (old army), 4 px/m | 10,000 | 13,759 sprites | 2.4 / 4.5 ms | 120 fps |
| looks + layers, 8 px/m | 5,180 | 17,442 | 2.5 / 5.5 ms | 120 fps |
| looks + layers, 4 px/m (the whole army) | 10,000 | 33,678 | 3.8 / 6.2 ms | 120 fps |

(CPU filling the layer instances: 1.5 ms at 17k layers, 2.7 ms at 34k; a frame's budget at 120 fps is 8.3 ms.)

## Hybrid records: storing a population

> "we store the recipe code and then build it by indexing or seed? also 10k units are all unique. There should be a
> way to do hybrid -- like the main object is stored like this, but the seeded attributes, animations, etc."

A population isn't stored as its units. It's stored as what makes them -- a **hybrid record** (`hybrid.ts`, in the bit
codec's `HYBRID_POPULATION`; JSON only as the readable view, `toJSON(HYBRID_POPULATION, record)`):

| part | what | how big (10,000 units) |
| --- | --- | ---: |
| recipe | the generator's module ids at exact versions (the module that makes the cast, then every pack it draws from), the seed, the count, the options | ~120 B |
| exceptions | per unit that needed one: which look candidate each of its looks took (see below) | ~1,140 units, ~1.9 KB |
| pins | per unit, per LAYER: body (entity, body shape, coverage), wear (the whole list, variants), look (core's look pins), each worn thing's look, animation | ~7 B a pinned unit |
| parts | explicit parts as codec documents (a builder `VOXELS` body, an `OBJECT` worn in a socket; imported models later), and which unit's layer each replaces | a voxel hero ~250 B |

```ts
const gen: PopulationGenerator = { modules: ["games/mine@1.0.0", "packs/humans@1.0.0", ...], cast: () => ({ entities, attributes, shapes: 1 }) };
const pop = populate(generatorOptions(gen, seed, 10000, { pins, explicit: new Map([[0, { body: voxelBody(model) }]]) }));
const bytes = recordBytes(recordOf(pop));          // 2-3 KB
populationOf(bytes, { generators: [gen], parts: [voxelBodyReader()] });   // the batch's population, no look pool
unitOf(bytes, 4711, { generators: [gen], parts: [voxelBodyReader()] });   // its unit 4711, alone
recordPrefix(readRecord(bytes), 2000);             // the record of its first 2,000 (every smaller army)
```

**Per-unit derivation.** Everything a population draws for all its units -- body shapes per entity, each attribute's
shape variants, who may wear what -- comes from the options alone (the CAST, never the units). Then unit i is four
layers, each from its own stream off (seed, i, layer): **body** (the entity by weight, one of its body shapes, the
coverage), **wear** (how many, which, which variant), **look** (its look and each worn thing's, seeds
`<seed>/unit/<i>` and `.../<attribute>`), **anim** (speed 0.88-1.12, stride 0.9-1.1, one of four idle styles, a phase;
always four draws). The body, wear and anim streams are slots of one roll per 65,536 units (core's `roll.sub`: a
private sequence each, no per-unit seed to hash -- 30,000 streams in ~9 ms). So a pin replaces what its layer drew and
nothing else moves: an animation pin leaves the unit's body, wears and look alone; a body pin leaves the wear stream's
draws and the moves (tested: every other unit keeps its shapes, wears and moves).

**Uniqueness without the batch.** The one thing a unit alone can't know is whether its first look came too close to
an earlier unit's -- the look pools keep two units of a kind in one coverage at least 0.08 apart, re-rolling
(`deriveSeed(seed, "reroll/n")`). core's pool now says which candidate each draw took (`lastTry`); the batch records
every n > 0 as an EXCEPTION. Given the exceptions, no pool runs: unit i's look is `candidateLook(seed, exceptions[i] ??
0)`, the batch's exactly -- the whole population, or any unit alone. A re-roll only looks back (the pool holds earlier
units), so a population's first n units and their exceptions are the smaller population's own: one stored record
serves every size below its own (`recordPrefix`).

**Explicit parts.** An explicit body (`ExplicitBody`: a spec, its own skin on a posed skeleton, its sockets, the
document it came from) takes its unit's body layer; the builder's `voxelBody(model)` makes one from a voxel model
(auto-rigged; its boxes by bone and entity role), `voxelBodyReader()` reads its `VOXELS` document back. The unit
keeps its drawn entity (pin one: `{ body: { entity: "human" } }`) and look, its wear layer builds each thing to the
explicit body's own sockets (its contract decides what fits), its body shape poses the voxels through every clip --
it walks with the rest. An explicit wear (`OBJECT_PART` reads an `OBJECT` document as a thing worn in a socket) takes
its socket from whatever was drawn there. `populationOf` matches a part's reader by its document's schema, and
refuses a generator at another version than the record names (a pack's code is part of what its units are).

Tests (`test/hybrid.test.ts`, on the army's 10,000 units in `test/cast.ts`): the record regenerates the batch exactly
(every unit's signature and animation); **each of the 10,000 alone** equals the batch's; all distinct, the closest
two of a kind 0.080 apart, 0 failures; pins per layer; the voxel hero (its entity and moves drawn, wearables on its own
sockets, its walk bobs the head socket, its look paints its slots) through a record with the builder's reader; prefixes;
versions refused; the JSON view back to the same bytes; sizes.

| 10,000 units (measured 2026-09-13) | codec | codec+gz | JSON view | JSON+gz |
| --- | ---: | ---: | ---: | ---: |
| recipe + re-rolls | 2.0 KB | 1.9 KB | 41 KB | 4.2 KB |
| + 1% pinned (100 units, every layer) | 2.7 KB | 2.4 KB | 47 KB | 4.8 KB |
| + 1% pinned + a voxel hero body | 2.9 KB | 2.6 KB | 47 KB | 5.1 KB |
| the whole POPULATION record (every unit's look and wears) | 1,022 KB | 976 KB | 24,404 KB | 1,807 KB |

The pinned record with its hero is an eighth of KEEL's 23 KB slug. examples/army (in the KEEL SDK) stores seed 1's
20,000 units this way (6.4 KB, one voxel hero) and reads every army size from it. Time (this Mac, Node 22): the batch
(pools) 0.48 s, the population from its record 0.29 s (no pools), all 10,000 units one by one 0.25 s.

**Cache keys.** Bake keeps look signatures (core's strings) as its keys, not canonical LOOK bytes: keying 30,000 looks
by `encodeRaw(LOOK, ...)` took 54-63 ms against 21-22 ms for the signature (which `lookOf` has already made), and Map
lookups were no faster (31-byte keys against 119-character ones).

## Streaming: the smart loader

A game hands the stream its designs and its zoom ladder, and marks what it draws; the stream decides what to bake,
when, where it goes, and what to draw meanwhile. Nothing for a creator to tune.

```ts
const stream = createSpriteStream({ designs: [{ spec, tier?, weight?, hints? }, ...], ladder: [4, 6, 8, 12, 16, 24, 32, 48, 64],
  directions: 8, pitch, onPages: (n, size) => sprites.reservePages(n, size), onWrite: (r, rgba) => sprites.writeSprite(r.page, r.x, r.y, r.w, r.h, rgba) });
const workers = createBakeWorkers({ entry: { module: "examples/army", run: "bakeWorker", url: import.meta.url }, payload: { seed, count } });
stream.setScale(k, now);                         // the view's scale (the one place a zoom goes)
// each frame:
stream.begin(now);                               // re-resolves the lookup if anything arrived
//   draw: slot = stream.clipBase(design, clip) + frame * dirs + dir;  stream.seen[slot] = stream.stamp;
//         const o = slot * STREAM_LUT; stream.lut[o..o+8] = atlas rect, anchor, page, the scale it's from (0: skip), the frame it shows
stream.update(now);                              // re-order from this frame's marks
workers.send(stream.take(n)); ... stream.put(job, sprite);   // or bakeSlice() on this thread in the frame's spare time
```

- **Slots and the scene scan.** Every sprite a design can show is a slot (design, clip, frame, direction); the game
  writes the frame's stamp at each slot it draws (one typed-array write a layer) and, every few frames, at the slots
  of units just outside the view -- widened toward where the camera is moving (`near`). At load one pass over the
  opening view marks exactly what it shows: those are baked first.
- **The order**, rebuilt every frame (a counting sort over the missing slots at the target scale and one step either
  side, ~0.1-0.25 ms for the army's 8.5k slots x 3 scales): visible now (mains, then foreground, then background);
  the preload set and every sprite of a MAIN design; mains one zoom step in and out; then (a) the visible units' other
  frames of their clip, (b) their other directions, (c) units just outside the view, (d) the clips likely next (a
  clip's neighbours in its design's list: idle, walk, run), (e) the neighbouring zoom levels for what's on screen,
  (f) everything else at this scale, least recently seen last, (g) the rest of the neighbouring levels while memory
  allows. Background runs a step and a half behind foreground at each signal; a design's `weight` (0..1) orders it
  within its tier.
- **Tiers** (`main` / `foreground` / `background`): a design's own field, a world setting (`bake.tier`,
  `bake.weight` through `@keel-engine/world`'s `Settings` -- per scene, tag or id; a locked setting beats the design),
  or inferred (`inferTier`): a player's or one-of-a-kind unit is main; props, ambient scenery and anything that stands
  still (one frame, the same from every side) background; the rest foreground. Mains are pre-cached completely (every
  clip, frame, direction, at the scale and its neighbours) ahead of everything but what's visible; eviction takes
  background first and mains last.
- **Debounced zoom.** A new scale is baked only once the view has held it for `dwell` (90 ms): wheel through five
  levels and the three passed through are never baked; the old target keeps baking meanwhile, and since its
  neighbours are prefetched, a one-step zoom usually finds its sprites already there.
- **Stand-ins, never boxes.** Until a sprite is baked the lookup holds the nearest frame of the same clip and direction
  at the view's scale (crisp, a moment's hitch in the animation), else the same sprite at the nearest LARGER scale
  drawn smaller (sampled at the right texel), else a smaller scale blown up no more than `upscale` (2 by default; the
  army's wearables 1.5: a hat blown up 4x is a box) -- else nothing: the unit is drawn without that wearable, or not at
  all that frame. The lookup carries the frame a stand-in shows, so what's worn sits on that frame's sockets.
- **Live atlas and memory.** A baked sprite goes straight into a shelf atlas (`createShelfAtlas`: rows by 8 px height
  class, freed spans reused) and up to the GPU (`SpriteRenderer.reservePages` grows the page array on the GPU,
  `writeSprite` puts one sprite) -- nothing is ever repacked. `memory` (default 256 MB of texture) bounds it; when
  full, whole (scale, design) groups go, background first, mains last, least recently drawn first, never anything
  drawn in the last two frames; low-priority prefetch never evicts what the view or target holds.
- **The budget** (`createFrameBudget`): the game reports its own frame work; the bake and its uploads get what's left
  of 8.3 ms (smoothed cost that rises at once and falls slowly, minus a 1.2 ms margin), between 0.75 and 6 ms;
  nothing while the page is hidden; 40 ms slices while a loading screen is up.
- **Workers** (`createBakeWorkers`, `serveBakes`): the game's own code started again in a worker -- in a KEEL
  document, every engine module's `<script>` from the page (the shell leaves them there; its loader is skipped), then
  `KEEL_ENGINE.start()` and the game module's worker entry; on a plain page, a module worker importing the game's
  module. The worker makes its GL context on its first line (a worker's context -- and on a plain page its import --
  need the page's main thread, which a population keeps busy: `workers.booted` says when the page can get on), builds
  the designs from the seed (`populateShapes`: the same keys, ~70 ms), compiles only the bake programs
  (`createPixelRenderer(canvas, { bakeOnly: true })`), and bakes batches, their texels in one transferred buffer a
  batch. **One worker by default**: baking is GPU-bound, and two worker contexts on one GPU were slower than one
  (opening view 730 ms vs 285 ms). Where workers can't start, the main thread bakes in budgeted slices.
- **Preload** (`stream.preload(spec)` after the scene scan): what the game needs before play -- by default the opening
  view exactly and its clips complete, every MAIN design complete, every design's first frame of each clip in every
  direction (so every body and every wearable per socket class is there in every direction), at the starting scale;
  `{ full, designs: "all" | "visible", frames: "first" | "all", clips, scales: "start" | "neighbours", visibleClips }`.
  `stream.preloading` is `{ done, total }` for a loading screen.

### Measured: the streaming loader (examples/army, 2026-09-13, this Mac, Chrome in the app's Browser pane, other agents' work running)

10,000 units, k = 24 px/m. "Crisp" = every layer on screen (bodies, wearables, props) at the view's scale -- every
visible unit fully dressed. Before = the army as it was (whole designs baked per scale by the queue, 5 ms a frame on
the main thread, the atlas repacked and re-uploaded as each design completed). Zooms are `setScale` steps 40 ms apart
after 2-2.5 s of play; times are from the last step (in brackets: from the first).

| 1920 x 1080 | before | after (1 worker) | after (main thread only) |
| --- | ---: | ---: | ---: |
| load -> every visible unit dressed and crisp (play starts) | 8,237 ms | 1,570-1,640 ms | 1,980 ms |
| ... opening view baked (1,621 sprites: 462 body frames, 1,153 wearable x direction, 6 props) | | 720-790 ms | 1,005 ms |
| zoom in one step 24 -> 32 | 8,566 ms | 8-66 ms (one 244) | 516 ms |
| zoom back 32 -> 24 | 18 ms | 1-8 ms | 15 ms |
| zoom out one step 24 -> 16 | 9,890 ms | 4-8 ms | 10 ms |
| zoom in three steps 16 -> 48 | 14,363 ms | 161-313 ms (243-397) | 667 ms (778) |
| zoom out five steps 48 -> 8 | 24,334 ms | 1,161-1,217 ms (1,324-1,381) | 3,354 ms (3,520) |
| frame gaps while streaming (median / p95 / max) | 44 fps while baking | 8.3 / 9.2-10.1 / 32-41 ms | 8.3 / 9.6 / 14 ms |

| 480 x 270 | before | after (1 worker) | after (main thread only) |
| --- | ---: | ---: | ---: |
| load -> dressed and crisp | 4,651 ms | 1,227 ms (opening view 654 ms) | 2,427 ms |
| zoom in one step 24 -> 32 | 4,421 ms | 6 ms | 297 ms |
| zoom back 32 -> 24 | 15 ms | 6 ms | 7 ms |
| zoom out one step 24 -> 16 | 4,358 ms | 4 ms | 237 ms |
| zoom in three steps 16 -> 48 | 8,306 ms | 203 ms (285) | 517 ms (659) |
| zoom out five steps 48 -> 8 | 94,968 ms (loaded Mac) | 623 ms (792) | 1,209 ms (1,409) |

Where the load goes (1920 x 1080, 1 worker): the shapes and who wears what 65-85 ms, the scene scan at ~135 ms and
the opening view's jobs in the worker then; the page paints 10,000 units' looks (~560 ms, core's look pools --
the floor for "dressed": no unit can be drawn before its look); the preload's 8,246 sprites are done by ~1.6 s. The
worker is ready ~100 ms after it starts; its first context used to take ~650 ms while the page built its population
(the context needs the main thread) -- now made on the worker's first line, before the page's heavy work. In bulk a
body frame bakes in 0.24 ms (a third of it the GPU read-back) and a wearable in 0.06 ms; the stream's per-frame
re-order costs 0.1-0.26 ms; uploads ~1.2 us a sprite. A jump 24 -> 64 px/m takes ~1.8 s to be crisp (big sprites,
~1-2 ms each): bodies show from 32 drawn 2x meanwhile, wearables wait (no box).

KEEL document (`node packages/keel/src/cli.ts document examples/army --project examples/army --out out`, 10
modules, 251.6 KB): the bake worker starts from the page's module scripts (mode `keel`), is ready ~420-530 ms after
spawn in the sandboxed iframe, and bakes the preload.

### For deep zoom and perspective views (keel/view, 2026-09-14)

Additive -- a game that doesn't ask gets exactly what it had:

- **Incremental lookup.** A bake or an eviction re-resolves only the GROUPS it touched (a slot's stand-in always comes
  from its own group: the same clip and direction at some scale), not every slot. The lookup is the same as a full
  resolve -- `test/stream-view.test.ts` checks it after every round of random bakes, cancels, evictions and zooms -- and
  on the level demo's 17,000-slot, 14-rung stream the per-frame `begin()` fell from ~9 ms while baking to well under 1.
- **`maxScale`** on a `StreamDesign`: it's never baked past that scale; closer, its top bake stands in however far it's
  blown up (queued at that scale, ranked as the target's, counted as present). Trees and props at 48 px/m in a zoom to
  128: a big tree at 128 px/m is 1,000+ px tall -- slow to bake, and a shelf row most pages can't give.
- **Per-design `upscale`** (already there) is how bodies stand in from up to 3x smaller while a close zoom's frames
  bake: chunky for a moment, never missing.
- **Actions in a population**: `clipsFor: ACTION_BAKE_CLIPS` (a `PopulationOptions` field: clips by body plan) bakes
  every body's gaits plus keel/entity's `attack` (8 frames, played by time: `clip("attack").period` = 0.62 s).
  `bodyShape` looks clips up through keel/entity's `clipOf` (gaits and idles, then actions).
- **`BodyShape.skeleton(clip, frame)`**: the posed skeleton, for a live 3D view to put what's worn on its sockets
  (`placeAttribute(skel, body.sockets[a.socket], a.design)`).
- **`SpriteRenderer.drawBillboards(camera, layers, style)`**: the layer draw through a perspective camera -- each
  anchor projected and snapped to a whole pixel, the sprite at its instance's scale (the caller picks the bake nearest
  the size it shows at), depth by distance over `far` (keel/render's convention: `render({ depthOut })` hides it behind
  hills and houses), the spare float a **dissolve** (the complement of a raster solid's fade). Its own program,
  compiled the first time; `drawLayers` is untouched.

## Portraits, stages and per-instance effects (2026-09-14, for keel-rts)

Additive -- nothing existing changed its pixels.

**Portraits** (`portrait.ts`): a unit's or building's OWN design close up, as an animated pixel-art avatar (a classic
strategy console's comm screen). `portraitPlan(subject)` lists the SpriteJobs a subject needs -- a unit: three views
(a glance each way: 16-direction yaws 1, 15, 2; a quadruped 2, 1, 3) x two idle breaths at a low 0.2 rad pitch and a
scale where its head (`headOf(body)`: its head, snout, eye, nose and brow capsules, measured across and up) fills 36%
of the frame; a building: its still (and its `withStages` frames) at 0.55 rad, fitted -- keyed `portrait|...` so they
ride any bake path (`bakeSlice`, a bake worker). `createPortraits(table, { w, h })` takes the sprites (`offer`),
frames each view on the head's texels (what's worn above it kept within half a head), paints it through the SAME look
the world draws it in (`paintIndexed`: the layer shader's finish, pattern, 4x4 screen and outline on the CPU --
palette-true), and keeps per view: the painted breaths, the eyes-closed frames (the EYE slot's pixels in the lid's
colour, a lash on the lowest row; an eye under 4 px drawn 2x2 with a glint so it reads), the mouth (on the snout's
lower edge, else under the eyes), a covered head's visor (worn trim / glow), lights (glow-finished pixels), metal,
vents (a building's highest points). `drawPortrait(sheet, state, out)` composes a frame (0xAABBGGRR words) from
`{ t, seed, talk, talkFor, hp01, flash, team, working, stage }`: a team-tinted screen with scanline glass; a blink every
2.5-5 s, a glance every 4-7 s; syllables while it talks (mouth open/closed, or the visor flickering); speckle, torn rows
and a rolling bar as it's hurt; a white flash on a hit; a building's lights pulsing (chasing while it works), a glint
sweeping its metal, smoke from its vents, sparks while it works or rises, cracks under 66% and fire under 33%; a
hero's gold frame and star. Bake once per design, paint once per (design, look), a frame ~0.07 ms.
`portraitDistance(a, b, masks, { shift })` measures how different two portraits are (colour over the figures'
union, and 1 - IoU of the figures; `shift` makes it tolerant of a few pixels' bob).

**Stages** (`stages.ts`): new clips from a design's own solids, under a new key, everything else inherited (a
BodyShape keeps `clip()`, `records()`, `slotRoles()`): `withFall(body, { frames, way })` -- its idle pose tipping onto
its face (or a quadruped onto its side), eased, lifted clear of the ground: a death, then the corpse or wreck;
`withStages(building, { mechanic, scaffold, accent })` -- a "stage" clip: the bare footprint, then the solids cut at 30% / 58% / 84% of the
height on a footprint slab, dressed by the build mechanic: scaffold poles, rails and a brace; a cocoon of lobes that
swells then splits open; a warp ring of pylons. `cutWorld`, `worldBounds`, `worldFloor` are the helpers.

**Per-instance effects** (`fx.ts`, `SpriteRenderer.drawLayersFx`): the layer instance's spare float is
`packFx(flash, dissolve)` -- a flash lifts each texel `ceil(flash x len)` steps up its own ramp (its lightest past 0.7;
the outline stays dark), a dissolve drops that share of texels on the 4x4 screen. One instanced draw, every pixel a
palette entry; 0 draws exactly as `drawLayers`. `fxIndex` / `fxDropped` are the shader's rules as code.

Tests: `test/portrait.test.ts` (8), on bodies baked by a software ray-caster (`test/soft-raster.ts`: the same indexed
bytes as the GPU's bake mode): the fall (never through the ground, lower each frame, flat at the end, methods
inherited), the stages (rising, each distinct, a slab, dressed per mechanic), fx packing and rules, plans, the
cache (nothing baked or painted twice), determinism (frame for frame), animation (a blink closes only the eyes, talk
moves the mouth, hurt adds noise, a hit flashes, buildings work, crack and burn, a stage is its own picture, a hero's
frame), distinctness over 3 body kinds x 2 seeds + 2 buildings (closest pair 0.24, mean 0.52; shift-tolerant 0.20),
and cost (a sheet 0.4-0.5 ms to paint, a frame 0.07 ms).

## Measured (tools/bench.html, 2026-09-13, this Mac, Chrome in the app's Browser pane)

N units wander a 512 m map; every frame moves all of them, re-grids them,
culls to the view, fills instances and draws (GPU finished):

| units | picture | view width | visible | frame |
| ---: | --- | ---: | ---: | ---: |
| 4,000 | 1920×1080 | 400 m | 3,419 | 0.28 ms |
| 10,000 | 1920×1080 | 400 m | 8,536 | 0.67 ms |
| 20,000 | 1920×1080 | 400 m | 17,124 | 1.37 ms (~730 fps) |
| 20,000 | 480×270 | 30 m | 126 | 0.86 ms |

The 120 fps budget is 8.3 ms a frame: drawing and culling tens of thousands of
sprites leaves most of it for the game. Re-run: `node packages/bake/tools/build.mjs` and open `packages/bake/tools/bench.html` on the dev server.

With baked entities (`examples/army`: 16 designs + 6 props, 1920×1080, every frame simulated, culled, filled and
drawn, GPU finished): 10,000 units at 8 px/m (6,700 sprites in view) 1.9 ms median / 5.7 ms worst; at 4 px/m (the
whole army, 13,759 sprites) 1.9 ms median / 3.8 ms worst; 120 fps (the display's rate) held live.
