# `@keel-engine/entity`

Things that move: people, anthro animals (an animal's head, ears, tail and
snout on a person's body -- the WALLRUN runner) and animals on four legs. A
seed makes a **spec**; the spec's **rig** is posed by **clips** (or an
**animator** driven by a physics body); a **skin** turns the posed skeleton
into capsules for the renderer; **fronts** say which way the thing faces. And
the engine's standard **body contracts** -- `body/humanoid@1.0.0` and
`body/quadruped@1.0.0` -- with their **sockets**, the catalogue's species as
runtime entities packs can list, and **attribute fitting**.

Module `keel/entity@0.1.0` (`kind: "runtime"`, needs `keel/runtime@^0.1`,
`keel/core@^0.1`, `keel/scene@^0.1`; provides nothing -- see
[Body contracts](#body-contracts)). Deterministic from the seed.

```ts
import { entityOf, animator, posed, skinOf, frontOfEntity, socketsOf, placeAttribute, speciesEntity } from "@keel-engine/entity";
import type { EntitySpec, Skeleton, Capsule, EntitySocket, AnimatorBody } from "@keel-engine/entity";
```

A TypeScript port of the proof of concept's `src/entity` (names unchanged),
proven identical by `test/poc-equality.test.ts`. The body contracts, sockets,
species-as-entities, attribute fitting and `animator.save()/load()` are the
engine's additions.

| Module | What |
| --- | --- |
| `species.ts` | `entityOf(seed, { kind, species, pins, size })` -> spec; the catalogue (`SPECIES`, `CHOICES`, `LOOK`, `QUAD`, `EARS`) |
| `rig.ts` | bone trees (`humanoidRig`, `quadrupedRig`), `poseSkeleton` (FK + two-bone IK), rotation helpers, `restJoints` |
| `clips.ts` | procedural clips (`HUMANOID_CLIPS`, `QUADRUPED_CLIPS`), `GAITS`, `gaitAt`, `blendPoses`, `posed` |
| `animator.ts` | `animator(spec)`: clips blended from a physics body; `save()` / `load()` |
| `skin.ts` | `skinOf(spec, skeleton, materials)` -> `[{ a, b, r, mat, part, role }]` (at most 28) |
| `front.ts` | `frontOfEntity(spec \| skeleton \| capsules, { yaw })`, `featurePoints(capsules)` |
| `bodies.ts` | `HUMANOID_BODY`, `QUADRUPED_BODY` (the contracts), `socketsOf(spec)`, `contractOf`, `missingSockets` |
| `define.ts` | `speciesEntity(kind, species)` / `speciesEntities(kind?)` -> runtime `EntityDef`s |
| `fit.ts` | `placeAttribute(skeleton, socket, shape)`, `socketFrame`, `wear(attributeDef, spec, S)`, `fittedParts` |

## The frame (read this first)

One convention for everything (`@keel-engine/core` frame):

```
own frame:  +z FRONT (face, eyes, nose, toes)   +x RIGHT (its own right hand)   +y UP
yaw:        front(yaw) = [sin yaw, 0, cos yaw]   right(yaw) = [cos yaw, 0, -sin yaw]
            yaw = atan2(dx, dz): "facing along (dx, dz)"; yaw 0 faces +z
```

- Every rest offset in a rig is written in the entity's own frame, so `[0, 0, 1]`
  is ahead and `[1, 0, 0]` is its right. **L is its own left (-x), R its right (+x).**
  Every bone's rest frame is the own frame -- so is every socket's.
- A physics body's `facing` IS the yaw (physics sets `facing = atan2(vel.x, vel.z)`),
  so the entity runs where it's going with no conversion.
- Seen from behind, its right hand is on the screen's right; from the front, on the left.
- Pose rotation signs (right-handed about the bone's own axis): `rx > 0` tips an
  upright bone forward, swings a hanging bone back, tips a forward bone down
  (and so LIFTS one pointing back, like a tail); `ry > 0` turns toward its right,
  like a yaw; `rz > 0` swings a hanging bone toward its right.

Fronts are tested, not assumed: `test/entity.test.ts` checks 200 seeds x 3
kinds x 16 yaws that eyes, nose and toes are on `frontOf(yaw)`'s side of the
body and the right hand on `rightOf(yaw)`'s, and that `frontOfEntity` reads the
same front back off the capsules. Every clip is checked the same way at 4 yaws.

## Make a character from a seed

```ts
const spec = entityOf("42", { kind: "anthro" });     // "humanoid" | "anthro" | "animal"
spec.species;       // "fox"
spec.plan;          // "humanoid" (two legs) | "quadruped" -- narrows spec.body and spec.rig
spec.body;          // HumanoidBody (H, hipH, headR, torsoR, thigh, shin, ...) | QuadrupedBody (shoulderH, bodyLen, bodyR, ...)
spec.features;      // ears { shape, len, w, spread }, snout, tail { shape, len }, eyes, coat, hair, antlers
spec.outfit;        // top, hood, pants, shoes, pack, accessory
spec.colours;       // OKLCH [L, C, hue] suggestions per role: fur furAlt cloth clothAlt accent hair dark blush
spec.choices;       // every choice made (the seed's, or pinned): ChoiceValues
spec.front;         // { dir: [0,0,1], right: [1,0,0], up: [0,1,0] } -- the declared front
```

Sizes: a person is about 1.7 tall, an anthro about 1 (the runner), an animal
its species' shoulder height (cat 0.25, dog 0.5, deer 0.95 ...). `size` sets it
exactly: total height on two legs, shoulder height on four.

### Pin choices (the lock idea)

Any choice can be pinned; unpinned ones come from the seed. Each choice draws
from its **own** stream (`choiceStream(seed, name)`), so pinning one never
reshuffles another. A choice may *read* another (a hood needs a jacket or
hoodie; ears come in the species' shapes) -- `CHOICES[i].reads`, and
`readsOf(name)` for the full list -- and only those can change when you pin.
`optionsOf(name, choices)` lists what a choice accepts given what it reads.

```ts
entityOf("42", { kind: "anthro", species: "cat", pins: { top: "jacket", pack: "round", hood: false } });
entityOf("42", { kind: "animal", species: "bunny" });  // "bunny"/"rabbit" work on either body
```

Choices: `kind species height head legs arms girth ears earSize snout tail eyes
coat hair top hood pants shoes pack accessory antlers stride furColour
outfitColour hairColour`. Numeric proportions are multipliers around 1 (each
carries its `range`), so a tall seed stays tall when you pin its species.
Unknown names throw a `TypeError`; values outside the options (a frog on four
legs) a `RangeError`.

| kind | species |
| --- | --- |
| humanoid | human |
| anthro | cat fox bunny bear mouse frog dog |
| animal | cat dog fox bear rabbit mouse deer |

## Drive it from a physics body

```ts
const anim = animator(spec);                 // { fade } optional (seconds, default 0.14)
// every physics step:
anim.step(dt, body);                         // body: { pos, vel, facing, mode, wall, wallGap? } (AnimatorBody)
const capsules = anim.capsules({ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9 });
```

- `body.pos` is the point between the feet (the physics body's bottom), `facing`
  its yaw, `mode` one of `ground air wall grind skim sink`.
- `body.wall` is the wall's normal (from the wall to the body); the runner tilts
  off it, feet toward the wall, head away, whichever side it's on. `body.wallGap`
  (optional) is how far `pos` is from the wall -- give it and the feet go onto it.
- The gait phase runs on **distance travelled** (from `pos` between steps, or
  `anim.step(dt, body, { dist })`), so a planted foot stays exactly where it was
  put in the world: no stance foot moves more than 1e-6 of a leg in steady walks,
  runs, trots and gallops.
- What it plays: two legs -- `idle turn walk run jump fall land wallRun grind
  skim`; four legs -- `idle walk trot gallop leap`. Walk-into-run (and walk-trot-
  gallop) is ONE gait whose duty, stride and footfall timing slide with speed.
  Mode changes crossfade (per-clip fade lengths, `FADES`).
- `anim.hold("sit", { seat: 0 })` plays a clip whatever the body does, until `anim.release()`.
- `anim.state` -> `{ clip, phase, time, dist, layers }`; `anim.pose`; `anim.skeleton(place?)`.

### Save and restore

```ts
const saved = anim.save();                   // AnimatorSave: plain data, JSON-safe (schema "keel-entity-animator@1")
const again = animator(spec).load(saved);    // carries on exactly where it was
```

A save holds everything the animator carries between steps -- layers and their
weights mid-crossfade, the gait phase, distance, time since landing, turn rate,
the eased gait speed, the held clip, the last pose and where it stood -- so the
restored animator's next frame is bit-identical to the one the saved animator
would have made (tested through JSON over 108 saves x 150 frames). `load()`
checks the plan (a humanoid save can't drive a quadruped) and every clip name;
`saved.entity` names the seed, kind and species it came from. (JSON carries
`-0` as `0`: the save is made through JSON, so a restored animator and the
original agree from the save on.)

## One clip at one moment (sheets, thumbnails, tests)

```ts
const skel = posed(spec, "run", { phase: 0.2, t: 1.5, yaw: 0.6, pos: [0, 0, 0], params: { speed: 8 } });
const caps = skinOf(spec, skel);
```

Clip params (`ClipParams`): `speed`, `wall` (+1 wall on its left, -1 on its
right), `wallGap`, `turn` (rad/s, + to its right), `seat` (sit: a height, or 0
for the floor; default `seatOf(spec)`), and `landT` (seconds since landing,
0..`LAND_TIME`).

| two legs | four legs |
| --- | --- |
| `idle` breathing, looking about | `idle` breathing, tail sway, looking about |
| `walk` `run` `move` (walk->run by speed) | `walk` `trot` `gallop` `bound` `move` (by speed) |
| `jump` knee tucked, arms up; `fall` legs reaching, arms out | `leap` fores ahead, hinds stretched |
| `land` squash on planted feet, springing back | `sit` haunches down, fores straight, tail round |
| `wallRun` (alias `wallrun`) the run tilted off the wall; `grind` crouched, arms out; `skim` low, arms back | `lie` belly down, paws ahead |
| `sit` (chair or floor), `turn` stepping on the spot | |

Footfalls (`GAITS`): walk HL FL HR FR (lateral sequence); trot diagonal pairs;
transverse gallop HL HR FL FR; bound hinds together, then fores (rabbits and
mice use it for both trot and gallop).

## Capsules and parts

`skinOf(spec, skeleton, materials)` -> `Capsule[]` (`{ a, b, r, mat, part, role }`),
world space, at most 28 (the least important -- inner ears first -- go when a
look runs over).

- **part** names the feature: `head eye.L eye.R nose snout ear.L ear.R hand.R
  foot.L hips chest pack hood tail tail.tip ...` (four legs: `body chest neck
  paw.FL upper.HR lower.FR antler.L collar ...`). A `foot.*`/`paw.*` capsule
  runs heel (`a`) to toe (`b`). A ball is a capsule with `a === b`.
- **role** (`Role`) is what the material plays: `fur furAlt cloth clothAlt
  accent dark blush hair` (the skin's), and `skin eye primary secondary trim
  detail glow metal` (what wearables name; core's `LOOK_ROLES` is the same
  list, and a look fills every one). The caller's table maps roles to material
  numbers; a missing role falls back (`furAlt -> fur`, `clothAlt -> dark`,
  `hair -> dark`, `accent -> cloth`, `blush -> fur`, `cloth -> fur`; `primary ->
  cloth`, `secondary -> clothAlt`, `trim -> accent`, `detail -> dark`, `glow ->
  accent`, `metal -> dark`, `skin -> fur`, `eye -> dark`). The default table is
  WALLRUN's: `{ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9 }`.
- `featurePoints(caps)` -> `{ part: centre, "toe.L", "heel.L", face, centre }`;
  `lowestY(caps)`, `partsOf(caps, "eye.")`.

## Fronts

```ts
frontOfEntity(spec);                  // declared: { yaw: 0, dir: [0,0,1], confidence: 1, why }
frontOfEntity(skeleton);              // declared: the skeleton's heading
frontOfEntity(capsules, { yaw });     // SEEN, from the parts, checked against the yaw you meant
// -> EntityFront { yaw, dir, confidence, why, cues, agrees?, error? }
```

The seen front weighs five cues: the face (eyes, nose, snout) ahead of the
body, the face on the front of the head, the eyes' left-to-right (front = right
x up), toes ahead of heels, the right hand on the right. A model turned
backwards reads ~180 degrees off; a mirrored one splits the cues and says so.
(`@keel-engine/scene`'s `detectFront` reads fronts off any assembly of parts;
this one knows an entity's anatomy.)

## Body contracts

A body contract is what everything bound to a body by interface may rely on:
an AI (`ai/herd` needs `"contract:body/quadruped@^1"`), an attribute (a beanie
targets `"body/humanoid@^1"`), a game. This package **defines** the engine's
two standard ones and **provides neither**: the pack whose entities keep a
contract lists it in its manifest's `provides`. (If `keel/entity` provided
them, a game needing `contract:body/quadruped@^1` would resolve with no
quadrupeds loaded at all.)

| contract | plan | who | `range` for targets |
| --- | --- | --- | --- |
| `body/humanoid@1.0.0` (`HUMANOID_BODY`) | humanoid | people, anthro animals | `body/humanoid@^1` |
| `body/quadruped@1.0.0` (`QUADRUPED_BODY`) | quadruped | animals on four legs | `body/quadruped@^1` |

Each `BodyContract` promises its **bones** (every entity of it has them, so an
AI can read them off a posed skeleton), its IK **chains**, the **clips** its
entities play, and its **sockets**. A minor version may add sockets, bones or
clips; removing or moving one is a major version.

### Sockets

A socket is where an attribute attaches: the **bone** it rides, an origin
**at** a point in that bone's frame, a **size** `[width x, height y, depth z]`
from the rig's proportions, and **out**, the way attachments grow. **Every
socket's frame is its bone's frame, and every bone's rest frame is the own
frame** -- so at rest every socket's frame is `+z front, +x right, +y up`, and
an attribute built in it has its front on the entity's front on any socket.
`socketsOf(spec)` returns `EntitySocket`s -- the runtime `Socket` (`pos` at
rest in the own frame, `yaw: 0`, `size`) plus `bone`, `at`, `out`, `part`
(the skin part it's on) and `sits`:

- `surface` -- the origin is ON the skin; `out` is the skin's outward normal (a hat on the crown, a pack on the back);
- `around` -- the origin is on the part's axis, inside it; attachments wrap it (a collar, a belt, a shoe, a grip).

**`body/humanoid@1.0.0`** (`headR`, `torsoR`, `torso`, `armR`, `footR`, `footLen` from `spec.body`)

| socket | bone | sits | out | where / what | size |
| --- | --- | --- | --- | --- | --- |
| `head` | head | surface | +y | the crown, top of the head ball (hats, helmets, halos) | `[2 headR, headR, 2 headR]` |
| `face` | head | surface | +z | front of the head at eye height (glasses, masks) | `[1.8 headR, 0.9 headR, 0.6 headR]` |
| `neck` | neck | around | +z | where head meets body: a person's neck capsule, an anthro's chest top (collars, scarves) | `[2n, n, 2n]`; n = 1.25 armR (person), 0.94 torsoR (anthro) |
| `chest` | chest | surface | +z | front of the chest (badges, bibs) | `[2 torsoR, 0.5 torso, torsoR]` |
| `back` | chest | surface | -z | between the shoulder blades (backpacks, capes, wings) | `[2 torsoR, 0.6 torso, 1.5 torsoR]` |
| `waist` | hips | around | +z | round the hips (belts, holsters) | `[2h, 0.25 torso, 2h]`; h the hips' radius |
| `hand.L` `hand.R` | hand.* | around | -y | the palm's centre; a held thing's grip along x, pointing +z | `[2g, 2g, 2g]`; g the hand ball's radius |
| `foot.L` `foot.R` | foot.* | around | -y | mid-foot, heel to toe along +z (shoes) | `[2 footR, 2 footR, 0.96 footLen + 2 footR]` |
| `tail` (with a tail) | tail1 (puff/stub: tail0) | around | down the tail | its middle joint (bows, rings) | `[2t, 2t, s]`; t its radius, s its segment |

**`body/quadruped@1.0.0`** (`headR`, `bodyR`, `bodyLen`, `pawR`, `pawLen` from `spec.body`)

| socket | bone | sits | out | where / what | size |
| --- | --- | --- | --- | --- | --- |
| `head` | head | surface | +y | the crown (hats, flowers) | `[2 headR, headR, 2 headR]` |
| `face` | head | surface | +z | front of the head at eye height, above the snout (glasses, masks) | `[1.8 headR, 0.9 headR, 0.6 headR]` |
| `neck` | neck | around | +z | halfway up the neck (collars, bells) | `[2n, n, 2n]`; n = min(0.55 bodyR, 0.75 headR) |
| `chest` | chest | surface | +z | front of the chest ball, between the fore legs (bibs, harness fronts) | `[1.6 bodyR, 1.4 bodyR, 0.6 bodyR]` |
| `back` | chest (reaching back half a body) | surface | +y | top of the back, mid-body (saddles, packs, riders) | `[1.8 bodyR, bodyR, 0.6 bodyLen]` |
| `paw.FL` `paw.FR` `paw.HL` `paw.HR` | paw.* | around | -y | mid-paw, heel to toe along +z (boots, anklets) | `[2 pawR, 2 pawR, pawLen + 1.3 pawR]` |
| `tail` (with a tail) | tail1 (puff/stub: tail0) | around | down the tail | its middle joint | `[2t, 2t, s]` |

Sizes and positions are linear in the body's size: twice the entity, twice
every socket (tested), and a bear's head socket is bigger than a mouse's. (The
quadruped's back rides the chest, not the spine: a gait flexes the spine one
way and pelvis and chest half back, so the chest stays level and its reach back
lands on the straight body capsule's middle -- a socket on the spine sank into
the body by up to half its radius in a bound.)

### Species as runtime entities

```ts
const cat = speciesEntity("animal", "cat");   // EntityDef<EntitySpec>: id "cat", body "body/quadruped@1.0.0"
speciesEntity("anthro", "cat").id;             // "anthro-cat"
export const pack = definePack({ entities: speciesEntities("animal"), attributes: [...] });
// manifest: provides: [QUADRUPED_BODY.ref], contents: contentsOf(pack)
```

`choices` lists every choice but kind, species and the colours (`{ range }` for
numbers; the species' own ear shapes and coats). `build(S, pins)` draws the
entity's seed from `S` (four 16-bit draws, `seedFromStream`) -- or takes
`pins.seed` when a token names one -- then calls `entityOf`, so pins never
reshuffle the rest; `pins.size` sets the world size. `sockets` is `socketsOf`.

Shape and look (runtime's groups; `groupsFor(kind, choices)`): `top`, `pants`,
`shoes` and `coat` (`LOOK_CHOICES`; on four legs only `coat`) are look choices
-- they only move roles between parts, never capsules -- and the rest are shape
choices. `look.roles` (`rolesFor(kind)`) is what a look fills, the leading role
first: a person's cloth, an anthro's cloth then fur, an animal's fur.

## Fitting attributes

An attribute's design is built in its socket's frame, sized to `socket.size`,
as an `AttributeShape` (`{ capsules?: [{ a, b, r, part?, role? }], boxes?: [{ c, h, yaw?, part?, role? }] }`).
`placeAttribute` puts it on a posed skeleton through the socket's bone, so it
follows the head through a run, the back through a leap:

```ts
const head = socketsOf(spec)["head"]!;
const hat = { capsules: [{ a: [0, 0, 0], b: [0, head.size[1] * 0.8, 0], r: head.size[0] * 0.36 }] };
const fitted = placeAttribute(anim.skeleton(), head, hat, { materials });   // { socket, capsules, boxes }
renderer.setWorld({ capsules: [...anim.capsules(materials), ...fitted.capsules] });

// A runtime attribute (defineAttribute with an AttributeShape design): fits() says whether, wear() builds it to the socket.
if (fits({ def: beanie, pack: clothPack }, { def: cat, pack: animalPack }).ok) {
  const worn = wear(beanie, spec, S, pins);              // { slot, socket, design }
  placeAttribute(skeleton, worn.socket, worn.design);    // each frame
}
```

Fitted capsules are skin capsules (`part`, `role`, `mat`); fitted boxes carry
their full turn `m` (the bone's) and `yaw` (its heading, for consumers whose
boxes only turn about y). `socketFrame(skel, socket)` -> `{ p, m }`,
`socketToWorld` / `worldToSocket` (what a hit on a hat means to the hat), and
`fittedParts(fitted)` makes scene parts (SDF + bounds) for bounds, rays and
contact. Fitted pieces add to the skin's 28-capsule budget: keep attributes lean.

## Actions (engine: actions.ts)

What a unit does on the spot when told to -- `attack` (two legs: a wind-up over the right shoulder, a strike down and
across in FRONT of the body, the recovery; four legs: a crouch, a lunge with the head out) and `use` (a reach; a sniff).
The proof of concept's clip tables are untouched (its equality test walks them): actions live beside them.

```ts
import { clipOf, actionPose, ACTION_PERIOD } from "@keel-engine/entity";
clipOf(spec, "attack");                        // gaits and idles first (clipsFor), then actions; undefined if neither
actionPose(spec, "attack", phase);             // a pose at a phase 0..1 of its ACTION_PERIOD (attack 0.62 s)
blendPoses([[anim.pose, 1 - w], [actionPose(spec, "attack", p), w]]);   // over whatever the animator plays
```

Each is built on the idle pose, so the breathing carries on and the feet stay planted. keel/bake bakes it with a
population's bodies (`clipsFor: ACTION_BAKE_CLIPS`); the level demo plays it on the sprites (sparring) and over the
animator on a possessed unit. Tested (`test/actions.test.ts`): 40 seeds x 3 kinds -- never in the ground, the strike
moves the body, a two-legged strike raises the hand then lands in front and below, a lunge reaches forward.

## Adding a species

1. `species.ts`: add it to `SPECIES[kind]` with a weight, and a `LOOK` entry
   (ear shapes from `EARS`, snout, tail `[shape, length]`, coats, fur colours).
   For four legs add a `QUAD` entry; for anthro an `ANTHRO_H` height. (The
   proof of concept must get the same entry, or the equality test will say so.)
2. New ear shape: add it to `EARS` and its lean to `ears()` in `skin.ts`.
3. Run `node --test packages/entity/test/*.test.ts`: the front, ground, length,
   capsule-count, gait and socket tests sweep every species automatically.

## Adding a clip

A clip is a pure function `(spec, t, phase, params) -> ClipPose` in
`HUMANOID_CLIPS` or `QUADRUPED_CLIPS` (start from `blankPose()` or another
clip). IK targets are in the ROOT frame, so a planted foot is `[x, ankleH, z]`;
`root.off` moves the top bone, `root.shift` everything. Chains: two legs
`leg.L leg.R arm.L arm.R`; four legs `leg.FL leg.FR leg.HL leg.HR`. A moving
clip sets `cycle`; use `footCycle(q, duty, s, lift)` for feet. Wire it into
the animator's `pick()` if a body mode should play it; otherwise it's reachable
by `anim.hold(name)` and `posed(spec, name)`. A clip every entity of a body
plays belongs in its contract's `clips` (a minor version).

## Tests

`node --test packages/entity/test/*.test.ts` (34 tests, about 3 s in parallel):

- `poc-equality.test.ts` -- everything against the proof of concept's JS,
  deepStrictEqual (numbers by `Object.is`): 1,901 specs (300 seeds x 3 kinds
  and drawn kind, 400 random pin sets with sizes, every species x 20 seeds),
  errors word for word, the catalogue; 16,000 rotation / IK cases; 12,600
  posed skeletons, skins, feature points and 13,860 fronts over every clip of
  108 entities at 10 phases each; 864 raw clip poses, 2,592 blends, 2,793
  gait cases; 7,920 animator frames (state, pose, skeleton, capsules) driven
  by scripted bodies through every mode, holds, turns, teleports and `dist`.
  Skipped (not failed) if the proof of concept isn't at `../keel-pixel-engine`
  (or `KEEL_POC`).
- `entity.test.ts`, `entity-clips.test.ts` -- the proof of concept's own 17 tests, ported.
- `bodies.test.ts` -- contracts (bones, chains, clips), sockets for 200 seeds x
  3 kinds on the right bone and part, in the own frame, posed at any yaw,
  scaling with the body; species as runtime entities, packs and `fits()`.
- `fit.test.ts` -- a hat and a backpack on every kind through run, jump, fall,
  sit, wall run, grind, gallop, leap and lie, and through an animator; size tracks the socket.
- `animator-save.test.ts` -- save / JSON / load, bit-identical continuation.
