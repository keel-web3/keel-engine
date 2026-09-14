# packs/creatures

Body plans a roster reads apart by. Each creature rides one of keel/entity's
rigs (so it animates with the rig's idle, gaits and attack for free) but draws
its **own** geometry — capsules and boxes by part and role — over the posed
skeleton: bake's explicit-skin path, the one a voxel hero uses.

```ts
import { creatureOf } from "@keel-engine/creatures";           // (the SDK: @keel/game-engine/creatures)
import { bodyShape, withFall } from "@keel-engine/bake";

const c = creatureOf("0x1234", "crawler", { size: 1.4, pins: { legs: 8 } });
const body = withFall(bodyShape(c.spec, { pack: "packs/creatures", clips, wear, skin: (s) => c.skin(s), sockets: c.sockets }),
                      { way: c.spec.plan === "quadruped" ? "side" : "forward" });
```

`size` is the height class in metres (0.8 .. 7); everything is built in
proportion to it (twice the size is exactly twice the creature). `c.height` is
its standing top at idle. Every choice draws from its own stream off the seed,
so a pin never moves another; `c.pins` holds them all, resolved.

## The plans

| plan | rig | what it is | choices |
|---|---|---|---|
| **crawler** | quadruped | an arthropod, low and wide: a broad thorax under a carapace with a team rim, a short banded abdomen on the rig's tail, 6 or 8 legs arching out | `legs` 6 8 · `head` mandibles pincers tusks · `carapace` smooth ridged spiked · `load` none sac turret pod · `horn` none single triple · `bulk` 0.88–1.12 · `span` 0.9–1.2 |
| **walker** | quadruped | a four-legged war machine: a wide hull (box, stepped wedge, dome) on legs set out past its sides, a cockpit in front, a team chevron on the roof | `hull` box wedge dome · `head` visor turret lamp · `legs` thick thin · `weapon` cannon twin mortar launcher none · `armour` none skirts plates · `bulk` 0.9–1.12 |
| **strider** | humanoid | a two-legged walker, tall on bird legs (knees bent back), top-heavy: a hull where a chest would be, a sensor head on it, weapons out on its sides | `hull` pod box keel · `head` lens twin dish · `weapon` guns barrel blades · `feet` talon pad · `legs` 0.95–1.1 |
| **floater** | humanoid | hovers (nothing touches the ground): a bell, robe or lantern body whose dome is its head, a crown, 3–8 tentacles trailing | `body` bell robe lantern · `tentacles` 3–8 · `crown` none ring spikes orbs · `eyes` single cluster · `trail` 0.85–1.2 |
| **flyer** | quadruped | a flying body: wings spread wide, a body, a head, a tail; claws tucked | `wings` bat bird insect blade ring · `body` sleek stout · `tail` long fan none · `head` beak crest fangs (a craft — blade or ring wings — has a canopy instead) · `span` 0.9–1.2 |
| **rider** | quadruped | a mount (keel/entity's own animal, renamed and recoloured) with a small seated rider | `mount` deer bear dog cat fox · `helm` helm hood crest horns · `held` lance banner rifle staff none · `saddle` saddle caparison barding · `rider` 0.9–1.1 |
| **serpent** | quadruped (legs never drawn) | a legless body on the ground, its front raised; coiled in a ring when it stands, an S when it moves | `raise` 0–1 · `hood` none flared crest · `spines` none ridge spikes · `head` viper horned blunt · `girth` 0.85–1.2 |

How each moves with its rig:

- **crawler** — feet follow the rig's paws, set out wide. The rig's diagonals
  (FL+HR, FR+HL) make the tripods: front legs keep their own paws, middle legs
  take the diagonal pair's average, hind legs cross over — a true tripod
  (L1 R2 L3 / R1 L2 R3) under the rig's trot, a ripple under its walk. The
  abdomen sways a third as far as the rig's tail.
- **walker / strider** — the rig's legs stomp; a strider's knee is the rig's
  mirrored back off the hip–ankle line; its weapon pods pitch with a third of
  the rig's arm swing (they recoil, never windmill).
- **floater** — lifted `FLOATER_LIFT` (0.25) of its size; bobs with the rig's
  hips, magnified; each tentacle sways with one of the rig's thighs or upper
  arms and streams back while moving. Tips stay at least 0.16 of the size
  clear of the ground (0.1 at the lowest bob). **The lift is already in its
  geometry — don't lift it again.**
- **flyer** — wings flap with the upper fore-left bone's swing (walk beats
  them, attack sweeps them), glide on the rig's breathing at idle; the
  downstroke stops just under level so nothing dips below its origin. Its body
  sits at its own origin: **the game draws it at altitude.** Craft wings bank,
  they don't beat.
- **rider** — the rider is built in the mount's chest frame (it rides every
  step); the attack's lunge drives its thrust.
- **serpent** — the rig's tail swing gives the S its phase; the rig's neck and
  head do the looking and striking (a strike at the ground stops on it).

## Sockets

Every creature has `head`, `crown` and `back`, and `mount` and/or `hand.R`
(walker, strider and rider have both; the others `mount`). Most have `face`;
the crawler has `tail`. They're on the rig's bones, so they follow every pose.
Pass `c.sockets` to `bodyShape`. The pack's entities (`pack`) name their rig's
body contract and report its sockets with these over them; the pack's manifest
provides its own contract, `creatures/plans@1.0.0`, not the body contracts (an
animal AI bound by `contract:body/quadruped` shouldn't pick up a crawler), and
declares no other pack's wearables compatible.

## Roles and part names

Part names are keel/entity's: bake's `slotOfPart` reads a part up to its first
dot, so `"upper.M1L"` is the legUpper slot, `"collar.band2"` the collar slot,
`"tail.tip"` tailTip. In an explicit skin **each slot wears one role** (the
first piece in it says), so each plan maps whole part groups to roles
(`c.roles`) and its pen refuses a part with no role. No piece falls to the
`accessory` default unless its group is `accessory`.

Roles, for the game's look to paint:

- `fur` — the main body, hull, chitin
- `furAlt` — carapace, plates, a second hull colour, bellies
- `accent` — **the team colour**: bands, stripes, chevrons, rims, banners, a
  rider's tunic and saddle cloth. Always shaped (never one flat slab) and
  8–30% of what the game's camera sees (12 px/m, 55° pitch, facing it).
- `dark` — legs, joints, mandibles, barrels
- `eye` — eyes, lamps, visors, a lantern's core (a glow in the game's look)
- rider only: `cloth`, `clothAlt` (the rider's clothes), `skin` (its face and hands)

Where the roles go per plan: a walker's cockpit is `furAlt` on a `fur` hull, a
strider's head `fur` on a `furAlt` hull, a floater's dome `furAlt` over a `fur`
body — so even in one race's look the heads read apart.

## The portrait rule

bake's `headOf` frames a unit's portrait on its head core — the `head`,
`snout`, `nose`, `eye` and `brow` slots — **measured from capsules only**. So:

- every creature has head-core capsules (box heads — the walker's — hold a
  capsule of their own slot inside them);
- every head has something in the `eye` slot, so the portrait blinks;
- on a **rider only the rider's head uses those names**: the mount's head,
  snout, nose and eyes are renamed (`body.head`, `body.snout`, `foot.nose`,
  `foot.eye.L`...), so the portrait frames the rider, not the beast.

## Measured (tests: `node --test packs/creatures/test/*.test.ts`)

At the game's view (softMask, 12 px/m, 55°, idle frame 0, facing the camera):
pairwise silhouette IoU, feet aligned and centred, every seed of one plan
against every seed of another, at most ~0.55 (limit 0.60); a plan at 1.2 m
against 2.4 m at most ~0.24 (limit 0.45); team colour 9–26%; portrait
distance between plans (one race's look for all) at least ~0.30 (limit 0.25);
a pose and skin ~0.03 ms a frame, at most ~71 capsules and 16 boxes.

`tools/preview.ts` prints a creature's sprite as text by role
(`node packs/creatures/tools/preview.ts crawler 7 size=1.6 k=12 dir=0 legs=8`);
`tools/measure.ts` prints the roster's numbers.
