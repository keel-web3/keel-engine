# `@keel-engine/import`

3D models into the engine's own things. Module `keel/import@0.1.0` (`kind:
"runtime"`, needs `keel/core`, `keel/runtime`, `keel/entity`, `keel/object`,
`keel/builder`). The editor (the KEEL desktop app) offers it by hand and
through the assistant; the result draws live as its op list streams in.

> "a way to take in 3D objects and convert them into voxel or into the pixel
> art generative ones ... where it even tries to figure out boundaries once it
> creates it in our system and separate the attributes."

```ts
import { importModel, replayImport } from "@keel-engine/import";
const r = importModel(bytes, { name: "knight", voxels: 64 });
r.proposal;     // the part graph, body / worn split, sockets, confidences -- plain JSON
r.ops;          // the builder op list that replays it (streamOps draws it live)
r.model;        // (a) voxels: a builder VoxelModel, groups = parts
r.attributes;   //     each worn part as a runtime attribute sized to its socket
r.fitted;       // (b) primitives per part; a creature's fitted skin on its rig
r.generative;   //     a generative base (clean voxels + variation rules) and the builder's entity / object
r.object;       // (c) a prop as an object: colliders, a front, top sockets
```

**Why its own package, not a module inside the builder.** Import is
editor-time work -- four parsers, an inflater, a voxeliser, clustering,
segmentation -- that no game ships, and it only ever *produces builder data*
(a `VoxelModel` and an op list). So it depends on the builder and never the
other way round: the builder's KEEL module stays the size it was (the builder
README already asks for its editor half to be split out), and a game that
loads voxel packs never loads a glTF parser. What the builder needed to take
an import -- worn groups (`attach` / `detach`), `merge`, `rig` with joints --
went into the builder as general ops, useful for hand-built models too.

## The pipeline

| stage | module | what |
| --- | --- | --- |
| parse | `gltf.ts` `obj.ts` `stl.ts` `vox.ts` `png.ts` | glTF 2.0 JSON / GLB (meshes, primitives incl. strips and fans, the node hierarchy with TRS or matrices, materials: base colour factor, base colour texture + uv set, emissive, metallic; samplers; vertex colours; skins: joints, inverse bind matrices, JOINTS_0 / WEIGHTS_0; sparse accessors; quantized attributes); OBJ + MTL (o/g, usemtl, Kd, map_Kd, `v x y z r g b`, negative indices, polygons fanned); STL binary (told apart by size, VisCAM facet colours) and ASCII; MagicaVoxel .vox 150/200 (SIZE/XYZI, RGBA or the default palette, nTRN/nGRP/nSHP placement with rotations, hidden models). PNG decoded here (an inflater and every filter); JPEG and interlaced PNG through a host `decodeImage`. Formats are told from the bytes. |
| frame | `math.ts` `scene.ts` | every format into the engine frame (+y up, +z front, +x the thing's right hand): glTF/OBJ are right-handed +y up facing +z, STL/.vox +z up facing -y; right-handed sources are mirrored so a left hand stays left. Skinned meshes are posed through their joints as glTF draws them. |
| voxelise | `voxelize.ts` | per node: surface cells by the exact triangle-box overlap test, then solid by flooding the outside (default) or by 3-axis parity; a "thin" skin drops cells the surface only grazes where they look outside. Overlapping nodes: a surface beats an interior, then the nearer triangle -- so a helmet stays a helmet over the head and a grip inside a hand stays the sword's. Every cell keeps node, mesh, material, colour (base colour x texture at the nearest point's uv x vertex colour) and dominant skin joint + weight; interior cells take their surface source's. Resolution: `voxels` along the longest side (default 48), `tall`, or `unit` metres; `height` sizes it first. |
| segment | `segment.ts` | nodes -> pieces (cells within two of each other are one piece: a blade, guard and grip thinner than a cell stay one sword; boots a hand apart are two) -> material regions (only in a mesh holding nearly everything -- a single-mesh export; small regions folded into their neighbour) -> the part graph: parts (cells, bounds, source, materials, joint, cues, confidence) and edges (shared faces, which cues make it a boundary, how sure). Later: body regions, narrowing cuts. |
| read | `pipeline.ts` `skeleton.ts` | a creature? A skin whose joint names read as two or four legs (`mapSkeleton`: Mixamo, Unity/VRM, Blender, Unreal, Biped dialects, sides and front/hind read off, gaps filled from the chain); else the body's shape as the builder's `analyseShape` reads it, standing on feet (two pieces on the ground, or one compact -- not a plinth or a frame's outline). |
| split | `body.ts` | every part scored against the core body: its own mesh, not touching, wrapping the body beside it (rays from the body meet it on many sides), a name that says worn (helmet, cape, sword, collar, belt, boots...) or body, hidden inside, too big, skinned to a region the core lacks (a separate head mesh IS the head). Worn parts -> a socket each: nearest cell and middle against every socket the rig gives the body, a ring round an "around" socket, behind the back, over the crown, the skin bone, the name; the margin over the runner-up is the socket's confidence. A region of the body's own mesh that wraps nothing is a mark (eyes, a nose) and stays body. |
| rig | builder `autoRig` | the body alone (worn things out), on the contract's bones -- the skin's joints placed where the source skeleton has them (`rig` with `joints`), else read from the shape. Body cells split into regions (head, torso, arm.L...) by skin weight, else by the rig's binding. |
| roles | `roles.ts` `color.ts` | weighted k-means in OKLab over surface colours (a flat material is one heavy sample), k by error, plus a role for any small colour far from its centre and for any two flat materials plainly different yet sharing one; farthest-first seeding, no randomness. Named: glow (emissive), dark, skin (a skin or fur tone on a creature's exposed body), primary, secondary, trim (pale / grey), accent (chromatic), `<role>-2` beyond seven. The source colours stay as a look preset (`look` ops). |
| fit | `fit.ts` | per part the simplest good primitive by IoU of rasterised cells: a capsule (principal axis, or a limb bone's segment, bulk-preserving radius), a box turned about y to the horizontal principal axis, a wedge (the renderer's ramp) across any of its sides, else the builder's greedy boxes; a significant second role gets its own. A creature's skin is fitted per bone on its rig (`fittedSkin`: a `VoxelSkin` `poseVoxels` and the animator take). |
| outputs | `pipeline.ts` | (a) the `VoxelModel` (groups = parts, exact greedy-box regions), the body, each worn part as `attributeFromVoxels` built width-fit at a `fill` and `offset` computed so that on its own body it lands exactly on its voxels and on any other it scales with the socket; (b) the fitted spec, and a generative base -- the primitives rasterised back into clean voxels with variation rules (head, torso, legs, an optional tail, size; a prop's small parts optional) -- as the builder's `entityFromVoxels` / `defineObject` and its own op list; (c) `objectFromVoxels` for props, the front from a lock/handle/door on one side or the builder's detection, top sockets, and a hinge proposed for a lid. |
| proposal + ops | `pipeline.ts` | `ImportProposal` (`keel-import@1`): source, grid, kind, creature (plan, source, confidence, why, bones mapped, missing sockets), roles, the source look, parts with cues / why / fit, edges, attributes (slot, fill, anchor, offset, targets, pack, confidence, reasons), object, generative. `ops`: `new`, box by box (biggest first per layer), `group` per part, `look` per role, `attach` per worn part, `rig` (+ joints), `animate` (a lid's hinge), `target`. `replayImport(ops)` rebuilds it. |

### Adjusting it: ops

The import is its op list, so a person or an agent adjusts it with the
builder's ops (and undoes each): `merge` parts (`{"op":"merge","groups":["leg.L","leg.R"],"into":"legs"}`),
move a worn thing to another socket (`attach` again), mark one as body
(`detach`), change a part's role (`recolour` with `group`), move a joint
(`joint`), re-anchor or resize a worn thing (`attach` with `fill` / `offset` /
`anchor`). `buildSession` then returns the entity or object, the attributes
(each with its pack file) and a bake design that wears them.

## Accuracy on the samples

The samples are written in code (`samples.ts`; nothing downloaded) and carry
their truth; the tests hold every row.

| sample | file bytes | grid | voxels | KV1 bytes | reads as | parts | worn -> socket (part / socket confidence %) | fit prims / IoU | ops / JSON / gzip | proposal JSON | ms* |
| --- | ---: | --- | ---: | ---: | --- | ---: | --- | --- | --- | ---: | ---: |
| knight (GLB, skinned) | 199,172 | 33x64x41 | 6,430 | 7,675 | creature (humanoid, skin) | 11 | cape->back 94/63, helmet->head 99/62, shield->hand.L 94/98, belt->waist 99/83, sword->hand.R 93/95 | 61 / 0.84 | 954 / 62 KB / 7.1 KB | 9,520 | 330 |
| knight, no names, no skin | 111,336 | 33x64x41 | 6,430 | 6,848 | creature (humanoid, shape) | 11 | backpiece->back 52/57, headwear->head 74/55, held-left->hand.L 52/95, beltwear->waist 57/80, held-right->hand.R 51/89 | 58 / 0.83 | 813 / 53 KB / 6.0 KB | 8,072 | 191 |
| dog (GLB, no skin) | 43,164 | 12x39x48 | 5,618 | 5,062 | creature (quadruped, shape) | 8 | collar->neck 99/74 | 50 / 0.79 | 735 / 45 KB / 4.9 KB | 6,065 | 185 |
| chest (GLB, PNG texture) | 19,564 | 40x30x28 | 29,906 | 6,873 | object: base, lid, lock; front +z from the lock; a hinge on the lid | 3 | -- | 8 / 0.93 | 809 / 52 KB / 5.5 KB | 2,259 | 577 |
| crate (OBJ + MTL) | 13,780 | 32x32x32 | 10,880 | 4,675 | object: frame, panels (four posts on a frame are not legs) | 2 | -- | 11 / 0.79 | 78 / 5 KB / 0.6 KB | 1,664 | 301 |
| statue (binary STL, mm, +z up) | 171,684 | 21x56x21 | 6,222 | 2,524 | object: plinth + a humanoid figure, cut where the section narrows, split by region | 7 | -- | 12 / 0.88 | 217 / 14 KB / 1.4 KB | 4,167 | 138 |
| robot (.vox, two models) | 6,352 | 16x27x7 | 1,185 | 1,030 | creature (humanoid, shape) | 7 | antenna->head 86/100 | 30 / 0.95 | 42 / 2.6 KB / 0.6 KB | 5,323 | 25 |

\* one import on a loaded machine (load average ~28 while this ran); the
tests run every sample in ~11 s wall.

- **Attributes land where they were**: each worn part, built to its socket on
  its own body at rest, covers exactly its own voxels (IoU > 0.999, every
  knight and dog attribute). On other bodies -- the catalogue's human, an
  anthro bear and mouse; a cat and a bear on four legs -- width / socket width
  is the same `fill` on every head and neck, and the offset the same share of
  the socket. `fits()` lets them on only where the body contract matches and
  the packs agree.
- **Replay**: `replayImport(r.ops)` rebuilds the same voxels and groups, the
  same attachments, attributes that build identical designs, the same rig
  bones and sockets, the same object (knight, dog, chest, robot tested); the
  dog's 735 ops stream through `streamOps` into `livePreview` ending where a
  fresh preview would.
- **Voxels vs analytic shapes**: a cube is exact (every cell, a one-cell
  shell); a ball's volume lies between its interior and its skin and within 4%
  of the ball grown by half a cell (the thin skin), 1-1.5 surface cells per
  cell of area, flood and parity fills identical on closed meshes; a closed
  helmet shell stays hollow, an open sheet a sheet.
- **Roles** are stable: 2% sRGB noise moves under 2% of cells' roles across
  seeds, shuffling cells moves none, the same input gives the same roles.

## Sizes

`keel/import`: 112,793 bytes minified, 46,235 gzip'd (the bundle test prints
it) -- editor-time only; nothing a game loads. The op lists run 5-7 KB gzip'd
for a character; the proposal is a few KB of JSON.

## The test page

`node packages/import/tools/build.mjs`, then
http://localhost:4300/packages/import/tools/import.html (the dev server:
`node scripts/serve.mjs`). Every sample through the pipeline at 128 and 256
px: the source mesh (a z-buffered raster, textures sampled), its voxels in the
source colours, the parts, the body / worn split, the fitted asset through the
engine's pixel renderer; the fitted knight, dog and robot walking on the
engine's animator wearing what they came with; the knight's helmet, shield,
cape and sword on the engine's own person, fox and bear and the dog's collar
on a cat (built to their sockets, dressed by their looks); and the knight's
op list replayed live through `streamOps`. It saves
`out/import-pipeline-128.png`, `out/import-pipeline-256.png`,
`out/import-walk-256.png`, `out/import-worn-256.png`, `out/import-live-256.png`.

## Tests

`node --test packages/import/test/*.test.ts` (33 tests):

- `parsers.test.ts` -- glTF as GLB and as JSON with an inline buffer (meshes,
  the hierarchy's world positions, materials, texture, skin and inverse binds,
  strips, fans, a sparse accessor), OBJ + MTL, STL binary (colours, a "solid"
  header) and ASCII, .vox (scene graph placement, palette, default palette),
  PNG through a real deflater (every filter) and our encoder; broken files of
  each kind say where.
- `voxelize.test.ts` -- the analytic shapes above; hollow shells, sheets,
  `fill: "none"`; overlapping nodes owning their cells and carrying their
  joints; texture colours; sizes, the cell guard, .vox; determinism.
- `roles.test.ts` -- one role per flat material with names (dark, skin,
  primary, trim, accent), the look preset, stability, k by error, glow.
- `import.test.ts` -- every sample reads as its truth; the knight's five
  worn things named and skinned, and with no names and no skin; the dog's
  collar and folded marks; the props; skeleton dialects; determinism.
- `attributes.test.ts` -- landing on their own voxels, scaling on other
  bodies (and riding a run), `fits()`.
- `replay.test.ts` -- replay equality, the live stream, adjusting with ops
  (and undoing each).
- `fit.test.ts` -- box, capsule, wedge, boxes chosen right; fitted skins
  walking on the animator with their feet down; the generative base varying by
  seed, building and exporting through the builder.
- `bundle.test.ts` -- the KEEL module reaches only what it needs and imports
  a GLB on a page.

## Dependencies

None new: the parsers, the inflater, PNG and every writer are here. The
package's `node_modules/@keel-engine/*` links are the workspace's (as pnpm
makes them); `pnpm install` records `packages/import` in the lockfile.

## Limits

- Draco / meshopt-compressed glTF, KTX2 / WebP / JPEG textures (without a
  host `decodeImage`), morph targets and animations are not read; FBX, USD
  and PLY are not formats here (convert to glTF).
- Worn-thing detection is strongest with separate meshes or a skin; a
  single-mesh model only finds worn things that have their own material and
  wrap the body (a collar, a belt) -- a hat modelled into the head's mesh in
  the head's material is body. Without names or skin the confidences sit near
  the threshold (50-75%): the proposal says so, and ops fix it.
- Bodies are the engine's two contracts; birds, snakes and many legs need
  their contracts first. A block-builder figure whose feet touch reads as a
  prop unless `as: "creature"`.
- The thin skin keeps cells within half a cell of the surface: models read
  about half a cell fatter all round (a ball grows by u/2); `surface:
  "conservative"` is fatter still.
- Primitive fits lose small marks (eyes, a chest panel) and hollow shapes
  (a helmet's dome) fit badly -- worn things stay voxels; bent limbs fit per
  bone on a rig but per region elsewhere.
- The builder renders boxes turned about y only, so a fitted creature's boxes
  keep upright as their bones pitch (limbs are capsules).
- Region-level variation of arms can't be tied left to right (each rule draws
  its own stream); the generative base varies head, torso, legs, tail, size.

## For the desktop UI

- An import panel: drop a file (or pick from the host's files), a resolution
  slider (voxels / unit / height) that re-runs `importModel`, and the four
  views side by side (source, voxels, parts, split) -- the page's CPU
  renderers or the engine's.
- The proposal as a list: parts with their kind, socket, confidence and "why";
  low-confidence rows flagged; clicking a part selects its group; a socket
  dropdown per worn part (`attach`), "make body" (`detach`), merge by
  multi-select (`merge`), a role picker per part (`recolour` in the group).
- The op list streamed into the builder session with `streamOps` +
  `livePreview` (the model draws as it arrives), the assistant fed
  `r.proposal` and the builder's `opSchema` to propose edits.
- Previews of each worn thing on the pack's other bodies (`wear` on their
  specs), the fitted asset walking, the generative variants strip, and the
  pack files (`buildSession(...).code` and each attribute's `code`) to save.
