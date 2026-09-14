# `@keel-engine/builder`

Build things block by block, the way a voxel builder does -- or ask an agent to --
and get the engine's own things back. Module `keel/builder@0.1.0` (`kind:
"runtime"`, needs `keel/core`, `keel/runtime`, `keel/scene`, `keel/object`,
`keel/entity`). The editor UI lives in the KEEL desktop app
(`keel-sdk/apps/desktop`); this is its engine.

> "the user really doesn't do much -- the system is designed to let you create
> generative characters and sprites; an editor that kinda even works like a
> block builder that then converts, or easily lets you skeleton or animate
> objects, or just ask agents to do it for you."

It makes both kinds of asset through one op list, by hand or by an agent, and
the user watches it draw as the ops stream in: **voxel builds** (objects,
attributes, rigged voxel creatures) and **character designs** -- the
generative capsule-and-rig characters the games use (a body contract and
species, pinned choices, proportions, extra parts, worn attributes).

```ts
import { createVoxels, createEditor, generate, autoRig, objectFromVoxels, attributeFromVoxels, entityFromVoxels, runOps, streamOps, livePreview, buildSession } from "@keel-engine/builder";
```

| Module | What |
| --- | --- |
| `voxels.ts` | the sparse model: 16³ chunks of palette indices, the palette is ROLES (`primary secondary trim accent skin dark glow`, or your own), named groups (regions) |
| `edit.ts` | brush ops (`set box fill sphere line mirror erase recolour`), symmetry (`x z xz radial4`), undo/redo as compact diffs, a replayable op log |
| `codec.ts` / `store.ts` | the storage seam (`store.ts`): voxels, op lists and asset data as `@keel-engine/codec` documents (voxel text `KC1:`); `codec.ts` is the old KV1 reader (run-length, byte-aligned), still loaded |
| `mesh.ts` | greedy box merging per label (role, group+role, bone+role); exact union, never overlapping; "best" of six axis orders |
| `convert.ts` | parts (boxes, or capsules when smoothed), objects (colliders, top sockets, detected front), attributes built in a socket's frame |
| `rig.ts` | auto-rig: humanoid or quadruped from the shape, the engine's bones placed in the voxels, every voxel bound, a real `EntitySpec`; overrides |
| `entity.ts` | a voxel creature as a runtime `defineEntity` on its body contract |
| `animate.ts` | object motions on groups -- hinge, pivot, spin, sway, bob, wave, flicker -- in clips |
| `design.ts` | bake designs: the baker's `DesignSpec` + `BakeSource` (`pose(clip, frame)`) for creatures (with worn attributes) and objects |
| `variation.ts` | generative bases: region scales, optional groups, picks, size -- per seed, pins win, each rule its own stream |
| `generate.ts` | seeded critters (4 legs or 2), crates, banners, trees, lamps, windmills |
| `export.ts` | a built thing as one pack-ready TypeScript file |
| `ops.ts` | the agent op list: `OPS` table, `validateOps`, `applyOp` / `streamOps` (one op, one change event), atomic `runOps`, undo per op, `buildSession` (and `attachedAttributes`, `bodyOf`, `attachmentModel` for worn groups), `opsOf`, `opReference`, `opSchema` |
| `character.ts` | capsule-and-rig character designs (the kind the games use): kind and species, pins, proportions, parts on bones and sockets, worn attributes |
| `live.ts` | the live preview: updated from each op's change event, re-meshing only the chunks a stroke touches |
| `look.ts` | the default look: a ramp and material per role (`glow` emissive, `glow-dim` its unlit twin) |

## The model

A voxel `(x, y, z)` fills `[x, x+1] × [y, y+1] × [z, z+1]` in voxel units, `+y`
up, `+z` the thing's front, `+x` its right (the core frame). `unit` is metres
per voxel; the pivot is `origin`, or the middle of the base -- so everything
converted stands on `y = 0` facing `+z`. Cells hold a role, never a colour:
looks (ramps + materials) come later, and recolouring is a look, not an edit.
Coordinates run -2048..2047; at most 255 roles. Groups are named boxes of
voxels (`door`, `flag`, `legs`); a voxel belongs to the first group holding it.
Group names name parts, so front detection reads `door`, `face`, `screen`...

```ts
const ed = createEditor(createVoxels({ unit: 1 / 16 }), { symmetry: { mode: "x" } });
ed.box([0, 0, -2], [3, 11, 1], "secondary");    // both legs (mirrored)
ed.sphere([0, 28, 0], 4, "skin");
ed.undo(); ed.redo(); ed.log();                  // the log replays: replayOps(ed.log())
```

Symmetry planes are voxel coordinates: `center: [0, 0]` puts the x plane
between -1 and 0 (voxel `x` meets `-1 - x`); `0.5` puts it through voxel 0.

## Sizes and box counts (the tests print these)

| model | voxels | dense box | KV1 bytes | gzip | text | row runs | greedy boxes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| blockPerson (block-builder proportions) | 1,664 | 4,096 | 595 | 130 | 798 | 188 | 17 (98x) |
| dog (neck, tail) | 642 | 2,622 | 345 | 157 | 464 | 172 | 25 (26x) |
| top hat | 656 | 1,296 | 353 | 91 | 475 | 76 | 4 |
| flag | 117 | 273 | 142 | 93 | 194 | 29 | 4 |
| doorway | 505 | 780 | 105 | 93 | 144 | 49 | 3 |
| crate | 580 | 624 | 248 | 127 | 335 | 162 | 24 |
| banner | 165 | 1,296 | 250 | 157 | 338 | 56 | 27 |
| tree | 232 | 832 | 234 | 158 | 316 | 49 | 24 |
| lamp | 144 | 384 | 276 | 109 | 372 | 66 | 11 |
| windmill | 876 | 5,742 | 696 | 180 | 932 | 154 | 10 (88x) |
| critter, 4 legs | 784 | 3,072 | 480 | 226 | 644 | 159 | 35 |
| critter, 2 legs | 352 | 900 | 584 | 187 | 783 | 128 | 20 |

A model costs a few hundred bytes (100-230 gzip'd, as KEEL stores leaves), so
a pack of dozens of voxel assets is a few KB. The module itself is 119 KB
minified, 44 KB gzip'd (two KeelHold slugs); a game that only loads voxel
packs needs a fraction of it -- see below.

## Convert

```ts
objectFromVoxels(model, { key, front: "detect", colliders: "merged", tops: 4, smooth, sockets, rest, meta })
attributeFromVoxels(model, { id, slot, targets, fit: "width", fill: 1, anchor: "auto", offset, smooth, roles, variation })
entityFromVoxels(model, { id, rig: { plan, joints, assign, sockets, limbs }, variation })
partsFromVoxels(model, { smooth })   renderSolids(model, look, { pos, yaw, smooth })
```

- **Objects**: box parts named by group (else role) with `mat` = role;
  colliders from the occupancy merged whatever the roles (a crate: 24 parts, 2
  colliders); `top`, `top.1`... sockets on every free box top; the front from
  `detectFront` (a door, a face, sails), snapped to the grid's four sides when
  confident, else none -- or declared and checked. `meta.builder` keeps counts,
  roles, groups, what front detection said, and any animation/variation.
- **Attributes**: built in the socket's frame and sized to it (`fit` width /
  height / depth / contain / stretch, times `fill`), so the same hat sits on a
  mouse's head and a bear's. `anchor: "auto"` reads the socket: out `+y` (a
  head) puts the model's bottom on it, out `-z` (a back) its front face, an
  `around` socket (neck, feet) centres it. The design is an `AttributeShape`
  (boxes and capsules, builder roles played as entity roles: primary→cloth,
  secondary→clothAlt, trim→furAlt, accent→accent, skin→fur, dark→dark,
  glow→blush), so `wear()` / `placeAttribute()` / the baker take it as any
  `packs/cloth` attribute; runtime `fits()` decides where it may go.
- **Smoothing**: long boxes (at least 2.5× their thickness, a square-ish
  section) become capsules -- poles, limbs, sails; `round` rounds SDF boxes.

## The voxel style (style/voxel@1.0.0)

`src/style.ts`: the builder is where styled objects (see `@keel-engine/object`,
"Styles") come out blocky. `voxelStyle.build(design, params)` rasterises a
design's solids, in order, into a `VoxelModel` (`designVoxels`: a cell is its
solid's role when its centre is inside; a thin solid, a cone or a wedge keeps
cells within half a voxel, so a grass blade, a spire's tip or a ramp's foot
survives), then greedy boxes by group and role (`voxelParts`). The unit is
`params.unit`, else the design's `voxel.unit` hint, else its largest size /
`params.resolution` (20), on a 5 mm grid; past `VOXEL_BOX_LIMIT` (256, the
renderer's boxes a scene) it grows a quarter at a time (up to seven times),
then declines -- and the chain draws pixel. The result carries the model
(`built.model`): open it in the editor. The design's colliders and sockets are
kept, so voxel plays as pixel does. The module's manifest provides
`style/voxel@1.0.0`, and `index.ts` registers the style with keel/object's
page registry when it loads. Tests: `test/style.test.ts`.

## Rig (auto, then by hand)

`autoRig(model, edits)` reads the shape (all in voxels):

- **legs**: layer by layer from the ground, the columns that stand apart
  (2D components connected to the ground -- a hand hanging free isn't a leg),
  tracked up to where they merge (the crotch, the belly). Two side by side:
  two legs; a front pair and a hind pair: four; pairs standing joined are split
  down their middles.
- **plan**: scored from the leg columns, then proportions (tall or long, the
  columns spread along the body), with the reasons (`analysis.why`).
- **humanoid**: the head is the run of top layers of one width and area (under
  ears or a crest); narrower layers under it the neck; the arms the columns
  beside the torso (gap-separated where they are, else outside the torso's
  narrowest layer or the legs' edges) -- shoulder at their top, hand at the
  bottom; arms held out (a T-pose) are found too. Legs that touch all the way
  down (block-builder) are split at the middle up to where the hands hang.
- **quadruped**: the body between the leg pairs; ahead of where its section
  changes (and above its back at the front) the neck and head, split where the
  section narrows; behind, the tail.
- **joints**: the engine's own bones (`humanoidRig` / `quadrupedRig`), every
  detected joint moved to where the voxels put it, and the proportions the
  clips read (`hipW`, `ankleH`, `bodyLen`, `w`, ...) agreeing with them so IK
  plants the feet under the legs.
- **binding**: each voxel to the nearest bone segment among its region's
  bones, then a pass toward what most of its neighbours hold. Skin: greedy
  boxes per bone and role in each bone's frame; limb bones as one capsule each
  where they're long for their thickness (`limbs: "auto"`; `"capsule"`,
  `"rigid"` to force) -- the renderer turns boxes about y only.
- **the spec**: a real `EntitySpec` (plus `spec.voxel`: skin, sockets,
  analysis), so `posed`, `animator`, `socketsOf`, `wear` and `missingSockets`
  all work; `poseVoxels(rig, skeleton, look)` gives the renderer's solids.

Overrides are plain data (they travel in exported code): `moveJoint(rig, bone,
[x, y, z])`, `reassign(rig, { from, to }, bone)`, `markSocket(rig, name, { bone,
at, size, out })`, or `autoRig(model, { plan, joints, assign, sockets, limbs })`.

**Accuracy** (the tests): 60 generated critters of each body -- plan right
60/60 and 60/60; joint error against where the generator put them: mean 0.00
voxels (quadrupeds), 0.20 (bipeds), worst 2.0 (a biped's neck). 96/96 seeded
variants (longer/shorter legs, bigger heads, tails gone) read as their body.
Hand-built: a block-builder person with touching legs (hips, thighs, shoulders,
neck within a voxel; head socket on the crown), a dog with a neck and tail,
a knight in a T-pose. The engine's animator drives all of them through idle,
walk, run / trot / gallop with no NaN and the feet on the ground, and every
clip of both contracts poses the voxel skin. (The generator and the analysis
agree on what a joint is -- "the body's middle over the leg pair" -- so the
generated numbers measure the heuristics against their own convention; the
hand-built ones are the honest check.)

## Animate objects

```ts
const rig = objectRig(model, { clips: { idle: { period: 2, frames: 8, motions: [{ kind: "wave", group: "cloth", hz: 0.5, amp: 1.4 }] } }, parents: { sails: "cap" } });
rig.pose("idle", 3, look)    // { boxes, capsules } -- the baker's pose(clip, frame)
```

| motion | fields | what |
| --- | --- | --- |
| `hinge` | `axis pivot from to hz phase` | swings between two angles and back (a door, a gate, a lid) |
| `pivot` | `axis pivot angle` | turns once over a non-looping clip (a door opening) |
| `spin` | `axis pivot hz phase` | turns round (a windmill, a fan) |
| `sway` | `axis pivot amp hz phase` | rocks (a tree, a hanging sign) |
| `bob` | `axis amp hz phase` | moves back and forth (a buoy) |
| `wave` | `along dir amp hz wavelength pin` | a travelling wave down the group, from the pinned end (a flag, a cape) |
| `flicker` | `rate duty seed` | the group's glow cells go dim on a seeded pattern (a lamp, a torch) |

Angles are radians, distances voxels, pivots voxel coordinates (default: the
group's base). A group turned about y stays boxes (yawed); turned far about x
or z (a sail, not a tree's small sway) its long boxes become capsules and the
rest cells whose centres turn -- the same kind of solid in every frame.

## Bake

`creatureDesign(rig | spec, { pack, clips, colours | look, attributes })` and
`objectDesign(model, { animation, colours | look, smooth })` return the baker's
`DesignSpec & BakeSource`: `key` (pack, name, worn attributes, a content hash
and a look hash), `clips` (the body's defaults: humanoid idle/walk/run,
quadruped idle/walk/trot/gallop; an object's own; a still object one "idle"
frame), `height`, `radius`, `palette`, `materials`, `pose(clip, frame)`,
`clip(name)` -> `{ frames, cycle, speed, period }` -- the same pose function
shape as `@keel-engine/bake`'s `entityDesign`, so `planBake` / `bakeSprites`
take them directly.

A voxel creature can also be a population's EXPLICIT BODY (bake's hybrid
records): `voxelBody(model | its stored bytes, { rig })` -> `{ spec, skin(skel),
sockets, doc }` -- auto-rigged, its skin posed through the rig's bones, each
piece by its bone (bake reads "forearm.L" as the forearm slot) and its role as
an entity role (`ENTITY_ROLE_OF`: primary is cloth, skin is fur), so a
population's looks paint it, its drawn wearables are built to its own sockets,
and it walks with the rest. `voxelBodyReader()` reads its `VOXELS` document back
out of a hybrid record (`populationOf(record, { parts: [voxelBodyReader()] })`).

## Generative bases

```ts
const rules = { scale: { legs: { region: "legs", y: [0.8, 1.35], anchor: "top" }, head: { region: "head", uniform: [0.85, 1.2] } }, optional: { tail: 0.75 }, pick: { hat: ["cap", "crown", "none"] }, size: [0.85, 1.2] };
applyVariation(model, rules, S, pins)  // { model, picked }
variantsOf(model, rules, 12)           // the same twelve every time
generate("critter", "7")               // { model, rules, animation?, colours, truth, target }
```

Each rule draws from its own stream (derived from one draw of `S` by the
rule's name): adding a rule or pinning one never moves another. `size` scales
the voxel unit (the voxels don't move). Roles never change: a variant's colour
is its look. `variationChoices(rules)` is what `defineAttribute` /
`defineEntity` list as choices.

## Code output

`exportPackFile(asset, { imports: "engine" | "sdk" })` -- one file, one thing:

```ts
// cap: an attribute for the "head" socket, built with the KEEL builder -- 460 voxels (primary, trim),
// 57 bytes as data. The voxels are role-indexed and run-length encoded (loadVoxels); they
// convert when this module loads.
import { defineAttribute } from "@keel-engine/runtime";
import { loadVoxels, voxelAttribute } from "@keel-engine/builder";

const VOXELS = loadVoxels("KV1:S1YBBMgBAgR0cmltB3ByaW1hcnkJAA8KBBABCQAdAQkAHQEJAB0CjwMBCQAdAQkAHQEJAB0DY2Fw");

export default defineAttribute({
  id: "cap",
  slot: "head",
  tags: ["voxel"],
  targets: [{ body: "body/humanoid@^1" }],
  choices: { size: { range: [0.8, 1.2] } },
  build: voxelAttribute(VOXELS, { fit: "width", variation: { size: [0.8, 1.2] } }),
});
```

Entities export as `defineEntity({ id, body, choices, build: voxelEntity(VOXELS,
{ rig, variation }), sockets: voxelSockets })`, objects as
`objectFromVoxels(VOXELS, { key, front, tags, meta: { animation, variation } })`.
The tests typecheck every exported kind under the repo's strict settings and
import them back: the same object, the same attribute build, the same rigged skin.

## The storage seam

Everything stored goes through `store.ts`: `storeVoxels` / `loadVoxels`
(bytes or text), `storeVoxelsText`, `storeOps` / `loadOps`, `storeData` /
`loadData`. Each is a document of the engine's bit codec (`@keel-engine/codec`):
header `0xB1` and the schema's short id, then the bits.

| stored | schema | notes |
| --- | --- | --- |
| voxels | `keel/builder/voxels@1` (`VOXELS`) | roles in use (first-use order), unit exactly, pivot, box, cells LZ-coded, groups; text is `"KC1:"` + base64url |
| op lists | `keel/builder/ops@1` (`opListSchema(OPS)`) | a union by `op`, built from `OPS` so the two never drift; an unknown op or field throws naming it |
| asset data | `keel/builder/data@1` (a `dyn`) | any JSON-like value; `-0` and nesting kept |

Old data still loads, told apart by its first byte: `0xB1` a codec document,
`"KV"` 1 the old KV1 voxels (`codec.ts`, also as `"KV1:"` text), `"J"` 1 the old
JSON op lists and data. Exported pack code calls `loadVoxels`, which reads every
format it knows. Over the 26 test models the documents are 41% of KV1's bytes
(3.9 KB against 9.5 KB) and their text 42% of KV1's characters; gzip'd as the
text a pack file embeds, 7-10% smaller than KV1's. (The bytes are already
bit-packed, so gzip barely shrinks a lone document.) JSON stays the authoring
and debugging view (the op list agents emit, the literals in exported code).

## Streaming: one op, one change event

```ts
const session = createSession(undefined, { attributes: [beanie, voxelHat] });   // what characters may wear
const live = livePreview(session);
for (const r of streamOps(agentOps, session)) {       // or applyOp(session, op) as each op arrives
  if (!r.ok) { show(r.error.message); break; }
  live.apply(r.event);                                  // no rebuild: the chunks the op touched
  draw(live.solids());                                  // { solids: { boxes, capsules }, look }
}
applyOp(session, { op: "undo" });                       // takes back the last op, whatever it was
```

Every applied op joins the session's history and returns a `ChangeEvent`:
`{ seq, op, kind, did, rebuild, name?, action?, cells?, region?, added?, removed?, recoloured?, of? }`.

| kind | from | carries |
| --- | --- | --- |
| `voxels` | brush ops | `cells` (the changed cells' `[x, y, z]` and the palette index each holds now, with the palette), `region`, `added` / `removed` / `recoloured`; `rebuild: "none"` |
| `model` | `new`, `generate`, `unit`, `origin` | `rebuild: "all"` |
| `group` | `group`, `ungroup`, `merge` | `name`, `action`; a region added to a group carries its `region` and `rebuild: "none"` (the preview re-meshes only the chunks under it) |
| `attach` | `attach`, `detach` | `name` (the group), `action` add / edit (moved to another socket) / remove |
| `rig` | `rig`, `joint`, `assign`, `socket` | `name` (bone or socket), `rebuild: "skin"` |
| `animation`, `variation`, `look`, `target` | their ops | `name`; nothing to redraw |
| `character` | `character`, `pin`, `unpin` | `name` (the choice), `action` |
| `proportion` | `proportion` | `name`, `did: "headR 0.19 -> 0.23 m"` |
| `part` | `part`, `unpart` | `name` (part id), `action` add / edit / remove |
| `wear` | `wear`, `unwear` | `name` (attribute id), `action` |
| `undo`, `redo` | `undo`, `redo` | `of` (the kind undone), and for voxels the cells as they are now |

Replaying only the events' cells rebuilds a model exactly (tested), so a
preview never needs the ops themselves. `livePreview` keeps greedy boxes per
16³ chunk and re-meshes only the chunks an event's cells touch (a 2x2 stroke
on an 80-wide wall: one chunk); a character is re-skinned (it's a few dozen
capsules). `runOps` stays atomic (a failing op takes back what the run did);
a new op drops the redo branch. `opsOf(model)` turns any model into box and
group ops (a replay "draws" it, biggest boxes first).

## Worn groups (attach)

A group can be WORN instead of being body: `attach` marks it for a socket
(`head`, `back`, `hand.R`, `neck`, ...), `detach` puts it back, and `attach`
again moves it. `bodyOf(session)` is the model without its attached groups --
what `rig`, `joint`, `assign` and the entity or object see -- and
`buildSession` turns each attached group into an attribute
(`attributeFromVoxels` on the group's own cells, with the attachment's `fit`,
`fill`, `anchor`, `offset`; targets: the attachment's `bodies`, else the rig's
contract), with its own pack file (`built.attributes[i].code`); the entity's
bake design wears them. `@keel-engine/import` emits these ops for the worn
things it finds in a 3D file (a helmet on `head`, a sword on `hand.R`), sized
so they land where they were on their own body and scale with any other's
socket. `merge` joins groups (a blade and its hilt into a sword).

```json
[
  { "op": "attach", "group": "helmet", "socket": "head", "fill": 1.375, "anchor": "bottom", "offset": [0, -1.15, 0] },
  { "op": "rig", "as": "humanoid", "joints": { "hips": [0, 32.4, 0], "head": [0, 54.6, 0] } },
  { "op": "attach", "group": "shield", "socket": "back" },
  { "op": "detach", "group": "cape" }
]
```

`rig` takes `joints` (bone -> voxel coordinates) to place a skeleton at once --
an imported one. A session's editor keeps 8192 brush entries, and its undo
counts entries by a serial rather than the list's length, so an op list of a
thousand boxes (an imported model) stays undoable op by op and every brush op
streams its cells, however long the history.

## Characters (capsules and rigs, no voxels)

```json
[
  { "op": "character", "kind": "anthro", "species": "fox", "seed": "7" },
  { "op": "pin", "choice": "top", "value": "hoodie" },
  { "op": "proportion", "name": "headR", "scale": 1.2 },
  { "op": "part", "id": "horn.L", "shape": "capsule", "on": "head", "a": [-0.22, -0.1, 0.05], "b": [-0.4, 0.7, -0.1], "r": 0.09, "role": "dark" },
  { "op": "part", "id": "fin", "shape": "wedge", "on": "back", "c": [0, 0.15, -0.45], "h": [0.08, 0.45, 0.5], "lo": 0.05, "role": "accent" },
  { "op": "wear", "attribute": "top-hat" },
  { "op": "target", "as": "entity", "id": "horned-fox" }
]
```

- `character` picks the kind (humanoid / anthro: `body/humanoid@1.0.0`;
  animal: `body/quadruped@1.0.0`), species, seed and size -- keel/entity's
  catalogue (`entityOf`), so every unpinned choice still comes from the seed.
- `pin` / `unpin` any catalogue choice (`ears tail snout top hood pants shoes
  pack accessory coat antlers height head legs ...`); the catalogue checks the
  value and says what it accepts.
- `proportion` sets or scales a rig number (`headR hipH torso thigh upperArm
  tailLen ...`; four legs: `bodyLen neckLen shoulderH legR pawLen ...`); the
  rig is rebuilt from them (two legs keep adding up: the torso is what's left).
- `part` adds or (same id) edits a capsule, box or wedge on a bone or socket,
  with a role (the character's own: fur, furAlt, cloth, clothAlt, accent, dark,
  blush, hair -- or a builder role, played as one). On a socket the numbers are
  shares of its size, so a horn fits a mouse's head and a bear's.
- `wear` puts on an attribute from the session's registry (the host's packs,
  voxel attributes built here), built to its socket.

`buildSession` returns `character` (a runtime `defineEntity` via
`characterEntity`, sockets from its rig), `spec`, a bake `design`
(`characterBakeDesign`: the body's clips, the skin plus parts plus what it
wears) and `code`:

```ts
import { characterEntity } from "@keel-engine/builder";

export default characterEntity({
  id: "finned-fox",
  kind: "anthro",
  species: "fox",
  seed: "7",
  pins: { ears: "tall" },
  body: { headR: { scale: 1.2 } },
  parts: [{ id: "fin", shape: "wedge", on: "back", role: "accent", c: [0, 0.2, -0.3], h: [0.08, 0.3, 0.3], lo: 0.1 }],
});
```

## The agent op list

JSON ops an assistant emits; `validateOps(ops)` checks shape with errors that
name the op, the field and the fix (`ops[3] (animate): no group "lidd" -- did
you mean "lid"?`); `runOps(ops, session)` is atomic (an op failing leaves the
session as it was) and reports what each op did; `buildSession(session)`
returns `{ kind, object | attribute | entity, rig, design, code, stats }`.
`opSchema()` is a JSON schema (one `oneOf` branch per op) for tool
definitions; `opReference()` renders this table.

```json
[
  { "op": "generate", "kind": "banner", "seed": "4" },
  { "op": "animate", "group": "cloth", "motion": "wave", "hz": 0.5 },
  { "op": "target", "as": "object", "id": "war-banner" }
]
```

| op | what | fields (? optional) | example |
| --- | --- | --- | --- |
| `new` | Start an empty model. | `name`? `unit`? | `{"op":"new","name":"hat","unit":0.05}` |
| `set` | One voxel (role null empties it). | `at` `role` | `{"op":"set","at":[0,4,2],"role":"dark"}` |
| `box` | A solid (or hollow) box, both corners included. | `from` `to` `role` `hollow`? | `{"op":"box","from":[-2,0,-2],"to":[1,3,1],"role":"primary"}` |
| `fill` | Like box, but only over cells that are `only` (a role, or null for empty ones). | `from` `to` `role` `only`? | `{"op":"fill","from":[-4,0,-4],"to":[3,0,3],"role":"trim","only":null}` |
| `sphere` | A ball (an ellipsoid with `scale`): cells whose centres are inside. | `center` `radius` `role` `scale`? | `{"op":"sphere","center":[0,6,0],"radius":2.5,"role":"skin"}` |
| `line` | A line of cells, thickened by `radius`. | `from` `to` `role` `radius`? | `{"op":"line","from":[0,5,-3],"to":[0,8,-7],"role":"secondary"}` |
| `mirror` | Copy one side onto the other across a plane. | `axis` `center`? `keep`? | `{"op":"mirror","axis":"x"}` |
| `erase` | Empty a region (or everything). | `from`? `to`? | `{"op":"erase","from":[0,0,0],"to":[3,3,3]}` |
| `recolour` | Give every cell of one role another (only in a group, optionally). | `from` `to` `group`? | `{"op":"recolour","from":"primary","to":"secondary","group":"legs"}` |
| `symmetry` | Mirror every following brush op. | `mode` `center`? | `{"op":"symmetry","mode":"x"}` |
| `undo` | Take back the last op (any op: a box, a joint, a part, a pin). | `steps`? | `{"op":"undo"}` |
| `redo` | Apply again what undo took back. | `steps`? | `{"op":"redo"}` |
| `unit` | Metres per voxel. | `metres` | `{"op":"unit","metres":0.05}` |
| `origin` | The pivot (voxel coordinates), or "auto": the middle of the base. | `at`? | `{"op":"origin","at":[0,0,0]}` |
| `group` | Name a region (add to it; `replace` starts it over). Groups name parts, carry animation and variation. | `name` `from` `to` `replace`? | `{"op":"group","name":"flag","from":[1,12,0],"to":[10,18,0]}` |
| `ungroup` | Forget a group (its voxels stay). | `name` | `{"op":"ungroup","name":"flag"}` |
| `merge` | Merge groups into one (the first, or `into`): their regions join it and the rest are forgotten (their voxels stay). An attachment on the kept group stays. | `groups` `into`? | `{"op":"merge","groups":["blade","hilt"],"into":"sword"}` |
| `attach` | Mark a group as an attribute worn in a socket: it leaves the body (the rig and the entity don't see it) and builds as an attribute sized to that socket. Again on the same group moves it to another socket. | `group` `socket` `id`? `fit`? `fill`? `anchor`? `offset`? `bodies`? | `{"op":"attach","group":"helmet","socket":"head","fill":1.1,"anchor":"bottom","offset":[0,-0.9,0]}` |
| `detach` | Put an attached group back in the body (mark it as body). | `group` | `{"op":"detach","group":"cape"}` |
| `generate` | Replace the model with a seeded one (with its groups, animation, variation and look). | `kind` `seed` `plan`? | `{"op":"generate","kind":"critter","seed":"7","plan":"quadruped"}` |
| `rig` | Rig it as a creature: auto (read from the shape), humanoid or quadruped. Attached groups stay out of it. | `as`? `limbs`? `joints`? | `{"op":"rig","as":"quadruped"}` |
| `joint` | Move a rig joint (voxel coordinates). | `bone` `at` | `{"op":"joint","bone":"neck","at":[0,14,2]}` |
| `assign` | Give a region's voxels to a bone. | `bone` `from` `to` | `{"op":"assign","bone":"head","from":[-2,12,3],"to":[1,15,6]}` |
| `socket` | Mark a socket on a bone (voxel coordinates, size in voxels). | `name` `bone` `at` `size`? `out`? | `{"op":"socket","name":"saddle","bone":"spine","at":[0,9,0],"size":[6,2,6]}` |
| `animate` | A motion on a group, in a clip (default "idle"; its period follows hz unless given). | `group` `motion` `clip`? `hz`? `amp`? `axis`? `pivot`? `from`? `to`? `angle`? `along`? `dir`? `wavelength`? `pin`? `rate`? `duty`? `frames`? `period`? `parent`? | `{"op":"animate","group":"flag","motion":"wave","hz":0.5}` |
| `vary` | A variation rule: scale a group, make it optional, pick one of several, or vary the size. | `name`? `group`? `scale`? `x`? `y`? `z`? `anchor`? `optional`? `pick`? `size`? | `{"op":"vary","group":"legs","y":[0.8,1.3],"anchor":"top"}` |
| `look` | Suggest a role's colour (OKLCH [L 0..1, C 0..0.37, hue degrees]); looks can replace it. | `role` `colour` | `{"op":"look","role":"primary","colour":[0.6,0.15,30]}` |
| `character` | Design a capsule-and-rig character (the kind the games use) instead of voxels: its kind picks the body contract. | `kind` `species`? `seed`? `size`? `id`? | `{"op":"character","kind":"anthro","species":"fox","seed":"7"}` |
| `pin` | Pin one of the catalogue's choices (ears, tail, snout, top, hood, pants, shoes, pack, accessory, coat, height, head, legs...). | `choice` `value` | `{"op":"pin","choice":"ears","value":"tall"}` |
| `unpin` | Let a choice come from the seed again. | `choice` | `{"op":"unpin","choice":"ears"}` |
| `proportion` | Set a rig proportion (headR, hipH, torso, thigh, upperArm... ; bodyLen, neckLen, shoulderH... on four legs): metres, or a scale. | `name` `value`? `scale`? | `{"op":"proportion","name":"headR","scale":1.25}` |
| `part` | Add (or, by id, edit) a capsule, box or wedge on a bone or socket of the character, with a role. On a socket its numbers are shares of the socket's size. | `id` `shape` `on` `role` `units`? `a`? `b`? `r`? `c`? `h`? `yaw`? `lo`? | `{"op":"part","id":"horn.L","shape":"capsule","on":"head","a":[-0.2,0,0.1],"b":[-0.35,0.7,0],"r":0.08,"role":"furAlt"}` |
| `unpart` | Remove a part. | `id` | `{"op":"unpart","id":"horn.L"}` |
| `wear` | Wear an attribute from the session's registry (built to its socket; pins pick its variant). | `attribute` `pins`? | `{"op":"wear","attribute":"beanie","pins":{"pompom":true}}` |
| `unwear` | Take an attribute off. | `attribute` | `{"op":"unwear","attribute":"beanie"}` |
| `target` | What it becomes: an object, an attribute (for a socket) or an entity (rigged, or a character). | `as` `id`? `title`? `tags`? `slot`? `bodies`? `fit`? `fill`? `anchor`? `front`? `smooth`? | `{"op":"target","as":"attribute","id":"war-flag","slot":"back","fit":"height","anchor":"bottom"}` |

## The test page

`node packages/builder/tools/build.mjs`, then
http://localhost:4300/packages/builder/tools/builder.html (the dev server:
`node scripts/serve.mjs`). It draws generated and hand-built models (and a hut
built by an op list) through the pixel renderer at 128 and 256 px, a rigged
voxel critter, a dog (capsule limbs), a biped and a block-builder person (rigid
limbs) walking on the engine's animator, and a banner waving, a windmill
turning, a lamp flickering -- and, first, **watching it draw**: an op list
replayed a couple of ops a frame through `streamOps` and `livePreview` (a voxel
critter box by box, then a fox character: pins, proportions, horns, a fin, a
hat). It saves `out/builder-objects-128.png`, `out/builder-objects-256.png`,
`out/builder-walk-256.png`, `out/builder-motion-128.png`,
`out/builder-live-voxels.png`, `out/builder-live-character.png` (filmstrips of
the replays).

## Tests

`node --test packages/builder/test/*.test.ts` (59 tests):

- `voxels.test.ts` -- cells, chunks, bounds; every brush op; symmetry; undo /
  redo exact and the log replaying; serialisation round-trips (bytes, text) with
  sizes; greedy boxes exact (union = voxels, no overlap, labels kept) on the
  samples and 20 random clouds, and never worse than any single axis order.
- `convert.test.ts` -- objects (colliders, tops, settle, both bakes), fronts
  (a door, turned round, declared), smoothing, attributes sized to a mouse's and
  a bear's head and riding a run, anchors from the socket, `fits()` across
  packs, variation pins, entities keeping their contract.
- `rig.test.ts` -- the accuracy numbers above; binding; the animator; every
  clip; overrides and forced plans.
- `animate.test.ts` -- flag, door (hinge and pivot), windmill, lamp, tree;
  animation checks; bake designs (with a worn voxel hat); generators and
  variants deterministic, pinnable, each rule its own stream.
- `ops.test.ts` -- validation messages, atomic runs, three end-to-end op lists,
  the reference and schema, exported files (object, attribute, voxel entity,
  character) typechecked and round-tripped, the storage seam.
- `live.test.ts` -- change events (replaying their cells rebuilds the model),
  undo / redo per op of every kind, the live preview re-meshing one chunk for a
  stroke and matching a fresh one, characters through ops (pins, proportions,
  capsule / box / wedge parts, a worn voxel hat, the contract's sockets, a bake
  design), their error messages, `opsOf` round trips.
- `attach.test.ts` -- merge / attach / detach (validated, suggested, undoable,
  moved between sockets), the body leaving attached groups out (the rig is the
  plain body's), attributes built from them and worn by the bake design and by
  a catalogue human, a group op re-meshing only the chunks under its region.
- `bundle.test.ts` -- the KEEL module reaches only what it needs and generates,
  rigs and decodes on a page.
- `store.test.ts` -- the storage seam through the codec: every generator's models,
  the hand-built ones, text, old KV1 and J1 data, op lists and asset data.
- `body.test.ts` -- a voxel model as an explicit body: skin by bone and entity
  role, its sockets, the same body from its document.

## Limits and what's next

- The renderer turns boxes about y only, so a rigid limb that pitches keeps its
  boxes upright (its centre follows the bone); `limbs: "capsule"` swings them
  smoothly. A box with a full turn in `@keel-engine/render` would draw rigid
  voxel limbs and turned groups exactly.
- Legs that touch all the way down show no crotch: it's guessed from where the
  hands hang (else a third of the height). Move `hips` to correct it.
- A torso wider than its hips with arms attached all the way down reads its
  outer columns as arms; `reassign` fixes it.
- Only the engine's two body contracts (humanoid, quadruped) are rigged to;
  snakes, birds and many-legged things need their contracts first.
- Split the module: a game loading voxel packs needs `voxels`, `store`/`codec`,
  `mesh`, `convert`, `rig`, `entity`, `animate` and `character` (what a pack
  file's `build()` calls); the op list, generators, export, live preview and
  designs are the editor's (a `keel/builder-kit` module).
- For the desktop UI: the brush tools and the 3D voxel grid view, a region /
  group picker, the rig overlay (`regionsOf`, `analysis.joints`, drag a joint ->
  `joint` op), the socket and part gizmos, a timeline for object clips, the
  variant strip (`variantsOf`), the chat panel wired to `opSchema` /
  `validateOps` / `streamOps` with the change events driving `livePreview`,
  and history as the session's ops (undo per op).
