# `@keel-engine/object`

Things that don't move — props and level pieces: definitions in their own
frame, placement, colliders, rails, sockets, settling, baking for physics and
the renderer, and a seeded catalogue. Module `keel/object@0.1.0`
(`kind: "runtime"`, needs `keel/core@^0.1`, `keel/scene@^0.1`,
`keel/physics@^0.1`).

```ts
import { defineObject, placeObject, settle, bakeForPhysics, buildPiece } from "@keel-engine/object";
import type { ObjectDef, ObjectInstance, Socket, Collider, PieceKey } from "@keel-engine/object";
```

A TypeScript port of the proof of concept's `src/object/object.js` and
`catalogue.js`. Its `prims.js` lives in `@keel-engine/scene` (front detection
needs it) and is **re-exported** here (`boxPart`, `capsulePart`, `toPart`,
`boxBounds`, `overTop`, ...), not ported twice. Proven identical:

- `test/poc-equality.test.ts` — every catalogue piece × 80 seeds with sizes
  given and drawn (definitions, streams left in step, three placements each:
  colliders, rails, sockets, footprints, bounds, `onSocket`, `yawToShow`,
  both bakes); 300 random hand-made objects (boxes, slanted capsules, SDF parts,
  given colliders, sockets in every spelling, fronts, rests) with their front
  detection; settling and `restsOn` over 120 random stacks; and WALLRUN's
  course built from this catalogue for 100 seeds, box for box against the
  proof of concept's `projects/wallrun/level.js`.
- `test/object.test.ts` — the proof of concept's `tests/object.test.mjs`, ported
  (`test/wallrun-level.ts` is WALLRUN's level on this catalogue), plus the fix.

## The fix

`movedObject` — and so `settle` — keeps the instance's own tags. The proof of
concept rebuilt the instance from its definition's tags alone, so a crate
placed with `tags: ["loot"]` lost them when it settled. An instance with no
tags of its own moves exactly as before (the equality tests hold it); give
`tags` in the patch to replace them.

## Define, place

```ts
const desk = defineObject({
  key: "desk", front: "+z", tags: ["prop"],
  parts: [
    { box: { c: [0, 0.72, 0], h: [0.6, 0.03, 0.35] }, name: "top", mat: "wood" },
    { capsule: { a: [-0.5, 0.75, -0.2], b: [-0.5, 1.2, -0.2], r: 0.02 }, name: "pole", mat: "metal" },
    { box: { c: [0.1, 0.6, 0.36], h: [0.3, 0.05, 0.01] }, name: "drawer", collide: false },
  ],
  sockets: { seat: { kind: "seat", pos: [0, 0.45, 0.6], yaw: Math.PI } },
});
const d = placeObject(desk, { pos: [4, 0, -3], yaw: Math.PI / 2, tags: ["office"] });
```

| Type | What |
| --- | --- |
| `ObjectSpec<M>` / `ObjectDef<M>` | what `defineObject` takes / makes: `kind, key, parts, front, show, tags, colliders, sockets, rest, rails, bounds, meta: M` |
| `ObjectInstance<M>` | a scene `Entity<ObjectPart>` plus `def` and `key` |
| `ObjectPart` | a scene part (`sdf`, `bounds`), maybe its `prim`, `collide` (`false` / `"bounds"`), `render` |
| `Collider` / `WorldBox` | `{ c, h, yaw, mat, part?, approx?, capsule? }` own-frame / `{ c, h, yaw, mat }` in the world |
| `SocketSpec` / `Socket` / `WorldSocket` | given / own frame `{ name, kind, pos, yaw, extent?, normal?, meta?, auto? }` / in the world (+ `dir`) |
| `SocketKind` | `top seat grab view anchor hang spawn` or your own |
| `RestMode` | `"base"` (stands on its lowest point), `"hang"`, `"float"` |
| `Support` / `SettleResult` | an instance, a box `{ c, h, yaw }`, a number or `{ y }` / `{ instance, gap, support, cover, rests }` |
| `RendererBake` / `PhysicsBake` | `{ boxes, capsules, skipped }` / `{ boxes, rails }` |

| Export | What |
| --- | --- |
| `defineObject(spec)` | parts (any `PartLike`), colliders from them (a capsule: a box along it; slanted, its AABB flagged `approx`), a free `top` and a `view` socket added |
| `placeObject(def, { pos, yaw, scale, id, tags })` / `movedObject(inst, patch)` | an instance / a copy moved (own tags kept) |
| `worldAabb`, `localAabb`, `footprint` | bounds; the turned footprint `{ corners, rect }` |
| `worldColliders`, `colliderToWorld`, `worldRails` | into the world (the instance's yaw adds to each box's) |
| `socketOf`, `worldSockets`, `socketsOfKind`, `onSocket` | sockets in the world; "can I put this here" |
| `topsOf(parts)`, `collidersFromParts(parts)`, `bottomOf(def)` | box tops nothing sits on; colliders; the lowest point (cached) |
| `frontOfObject(thing)`, `yawToShow(def, pos, eye)` | declared-and-checked front; the yaw that shows a viewer the front (or `show` side) |
| `settle(inst, supports, { stepUp, maxDrop, minCover })`, `restsOn(inst, support)` | nothing floats |
| `bakeForRenderer(instances, { mats, bounds })`, `bakeForPhysics(instances, { mats })` | what `setWorld` and `createCharacter` take |

## The catalogue

```ts
const wall = buildPiece("wall", seed, { length: 16, h: 10, sink: 1.5 });   // seed: bytes32 hex
wall.meta.length;                                                          // typed: PieceMetas["wall"]
const S = pieceStream(seed);
const pad = buildPieceFrom("pad", S, { w: 6, d: 6 });
registerCatalogue(registry);                                               // the realm "Objects"
```

`PieceKey`: `pillar wall pad ramp stairs rail arch tunnel crate bench sign lampPost`.
`PieceContexts[K]` types each piece's sizes, `PieceMetas[K]` what it keeps.
Sizes given override the draws, but every draw still happens, so a size never
moves a later roll. Every piece faces +z (checked by the tests against its
parts). The catalogue's ramp is still slabs (kept identical to the proof of
concept); a wedge ramp is one part now -- see below, and packs/buildings' `ramp`.

## Wedges

A part may be a wedge -- physics' and the renderer's ramp solid: a box turned
about y whose top slopes from `lo` x its height at local +z to its full height
at -z. `{ wedge: { c, h, yaw, lo }, name, mat }` in `defineObject`'s parts
(`wedgePart` makes one): its SDF is physics' `wedgeDistance`, it collides as a
wedge (`Collider.kind: "wedge"`, `lo`), `worldColliders` / `bakeForPhysics` /
`bakeForRenderer` hand it on as a box with `kind: "wedge"` (what
`createCharacter` and `setWorld` read), `topsOf` skips it, and `settle` doesn't
rest things on its slope. The part keeps `wedge` (what the codec's object
records read). Tested: a body walks up one.

## Styles: one design, drawn any way

Everything the world is dressed with -- trees, rocks, houses, bridges -- is
written once as a DESIGN and drawn in whichever STYLE the game picks.

```ts
const oak = defineStyledObject({
  id: "oak", tier: "background", tags: ["tree"],
  choices: { height: { range: [5, 9] }, crown: ["round", "wide"], season: ["summer", "autumn"] },
  look: { roles: { leaf: { as: "primary" }, bark: { as: "detail", stuff: "wood" } }, choices: ["season"], profiles: ["summer", "autumn"] },
  sway: { amp: 0.035, hz: 0.35, bend: 1.8, from: 1.2 },
  design: (J, v) => ({ solids: [solid.cylinder("bark", [0, 0, 0], 0.3, 4), solid.ball("leaf", [0, 5, 0], [2, 1.5, 2], { collide: false })], front: null }),
});
const built = oak.build({ seed: 7, pins: { crown: "wide" }, style: "voxel" });   // built.def: an ObjectDef
built.key       // "obj:packs/foliage/oak@voxel~<geometry hash>" -- the bake key, style included
built.why       // "voxel", or "voxel isn't available (nothing provides style/voxel); drawn in pixel"
```

**A design** (`design.ts`) is solids with ROLES -- `box`, `wedge`, `capsule`,
`ball` (an ellipsoid blob), `cone` (upright, a top radius; `sides` star / 8 /
4), `cylinder` -- each with an optional group, a collide flag and the styles
that draw it; plus the thing's colliders (default: from the solids), sockets,
front, rest, rails, wind (`SwaySpec`) and a voxel hint. `solid.box(role, c, h)`
and friends write them in a line.

**The contract** (`style.ts`): a style is `{ name, contract: "style/<name>@x.y.z",
fallback?, build(design, params) -> { parts, stats?, model? } | null }` -- parts
are box / wedge / capsule part-likes, each carrying one of the design's roles
(checked: the renderer and the bake draw those solids; a role the look hasn't
got throws). Null declines the design. Any module adds a style by providing the
contract in its manifest and registering it (`registerStyle`, or its own
`createStyleRegistry`). Two ship: **pixel** (`pixel.ts`, always there: the
engine's primitives -- a ball a sphere, a capsule or a cloud of spheres; a cone
stacked slabs, a star by default; a cylinder a capsule or a true octagon of four
bars) and **voxel** (in `@keel-engine/builder`: the same solids rasterised into
a real `VoxelModel`, greedy-merged into boxes -- registered when keel/builder
loads).

**Colliders and sockets are the design's, whatever the style**: every style's
parts go through one `defineObject` with the design's colliders and the
sockets worked out once on the pixel parts -- so a voxel world plays exactly as
the pixel one (tested: identical colliders and sockets, footprints within a
voxel, over every pack asset x 50 seeds).

**Choosing** (`styleChain` / `resolveStyle`): the placement asks for a style;
a `styleSetting(style, { locked })` is the game's (a locked one overrides every
placement); the asset has a default (pixel) and may carry its own builder per
style (`styles: { voxel: myBuilder }`, which wins over the registry's). The
FALLBACK: wanted -> its own builder or the registry's style -> if missing or it
declines: the style's declared `fallback` -> the asset's `fallback` -> `pixel`,
which is always there and draws everything. `built.fellBack` and `built.why`
say what happened.

**Shape vs look**: `choices` split into SHAPE (what `design` sees; the key)
and LOOK (`look.choices`: applied at draw time). Every choice draws whether
pinned or not; pins are checked; an implicit `variant` choice (0..variants-1)
seeds the design's own jitter stream (`J`), so the shape is a pure function of
its shape values -- a population drawn on a grid (`shapeGrid(def, S, { steps })`,
`shapeCount`) reuses a handful of shapes, every instance with its own look.
Builds are memoised per shape, style and params.

**World looks** (`world-look.ts`): parts carry WORLD roles (bark, leaf, wall,
roof); each paints a core LOOK_ROLES slot (`as`) -- distinct within an asset --
and says what it's made of (stuff, patterns, finishes). A PROFILE
(`defineProfile`: a season, a biome, a building culture) gives, per world role,
the hue / chroma / lightness ranges (and finish, pattern) its colour is drawn
from; `worldLook(roles, seed, { profile, pins })` returns a core `Look` (the
bake's `paintRoles` takes it) -- one baked shape wears every season. Pins by
world role (`"leaf.hue"`) or slot. `rendererLook` turns a look into the pixel
renderer's palette and materials (4 and 5 left to water and sky) for drawing
directly.

**Wind** (`sway.ts`): the default is the sprite shader shifting a baked
sprite's texel rows by whole pixels (`swayShift` is its reference; `phaseAt`
the per-instance phase: a gust travelling across a field) -- zero extra bakes,
any number of instances, still pixel art. Where that isn't available (today's
bake, hero shots) `bakeDesignOf(built, { swayFrames: 4 })` adds a baked "sway"
clip whose frames bend the parts (`swayPose`). See "What the bake needs".

**Tiers**: `tier: "main" | "foreground" | "background"` on every asset (and
overridable per record) for the streaming loader.

**For the bake**: `bakeDesignOf(built)` is a `DesignSpec & IndexedSource`
(structurally): `key` (with the style), clips, height, radius, `symmetric` for
billboards, `roles` (core look roles by slot) and `pose()` with every solid on
its role's slot.

**Packs and levels**: `defineContentPack({ id, version, objects, profiles })`
binds objects to their pack (keys carry it), checks profile names, and gives the
manifest's `contents()` (objects with `tier:<t>` tags). A level stores
`ContentRecord`s -- `{ pack, id, seed, pins, look: { seed, profile, pins }, style,
tier, pos, yaw, scale }` -- and `placeContent(packs, record, { setting })` builds,
places and looks it (a look choice whose value names a profile -- a season --
picks it). The codec schema for records and per-asset pins is in
`@keel-engine/foliage/codec` (`CONTENT_RECORD`, `pinsSchemaOf`).

| Export | What |
| --- | --- |
| `solid`, `solidBounds`, `solidSdf`, `designBounds`, `collidersOfDesign`, `thicknessOf`, `drawnIn` | designs |
| `ObjectStyle`, `checkStyle`, `createStyleRegistry`, `defaultStyles`, `registerStyle`, `styleSetting`, `styleChain`, `resolveStyle` | the contract, registries, the setting, the chain |
| `pixelStyle`, `pixelParts`, `ballPrims`, `conePrims`, `cylinderPrims` | the pixel style |
| `defineStyledObject`, `drawChoices`, `gridOf`, `shapeGrid`, `shapeCount` | styled objects |
| `defineContentPack`, `placeContent`, `lookFor`, `bakeDesignOf`, `TIERS` | packs, placing, looks, the bake |
| `checkWorldRoles`, `lookRolesOf`, `slotOf`, `defineProfile`, `worldLook`, `rendererLook` | world looks and profiles |
| `swaySignal`, `swayWeight`, `swayShift`, `phaseAt`, `swayPose` | wind |
| `wedgePart`, `isWedgeLike`, `wedgeFromLike` | wedge parts |

Size: keel/object is 39.6 KB minified / 14.7 KB gzip with all of this (17.8 /
6.8 before): the style contract, the pixel style and styled objects are about 8
KB of KEEL storage. If a game that only places catalogue pieces should not
carry it, it splits cleanly into its own module (`keel/style`, needing
keel/object) -- nothing else would change.

Tests: `node --test packages/object/test/*.test.ts` (style.test.ts: wedges and a
body walking up one; the pixel primitives (the four-bar octagon checked against
the true octagon); the contract and registry; the fallback chain, a locked
setting, a style that declines, an asset's own builder; pins, shape vs look
keys, determinism, few shapes on a grid; world roles, profile ranges, pins;
wind; the bake design; packs and placing).
