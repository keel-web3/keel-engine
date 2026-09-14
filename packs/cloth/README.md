# `packs/cloth` (`@keel-engine/cloth`)

Wearables only, one file each, built to the standard body sockets. Module
`packs/cloth@1.0.0` (`kind: "pack"`), needs only `keel/runtime@^0.1` (a
design is capsules and boxes in the socket's frame -- keel/entity's
`AttributeShape`, imported as a type -- and the socket is handed to
`build`); **provides** `attributes/wearable@1.0.0`; **compatible**
`["packs/humans@^1", "packs/animals@^1"]`.

Every attribute has SHAPE choices (what it's baked as: the bake caches by them)
and LOOK roles (what a look paints on its parts at draw time: `look.roles`,
runtime's `RoleSpec` -- the stuff each part is made of, and the patterns and
finishes it may take). Its parts carry roles, never colours. Stripes, knit
ribs, checks, leather-or-canvas, shaded or glowing lenses are looks, not
shapes -- they cost nothing to change.

| file | attribute | slot | fits | shape choices | look roles |
| --- | --- | --- | --- | --- | --- |
| `beanie.ts` | `beanie` | head | humans, animals | pompom none/small/big, fold none/low/high, crown snug/tall, slouch 0..1 | primary (knit: bands, stripes, checks), secondary (the fold), trim (the pompom) |
| `cap.ts` | `cap` | head | humans, animals | brim short/long/flat, turn front/side/back, crown low/high, button, reach | primary (cloth: trim, stripes, checks, camo), secondary (the peak), trim (the button) |
| `top-hat.ts` | `top-hat` | head | humans, animals | height 0.9..1.6, brim narrow/wide/curled, crown straight/tapered, band none/thin/wide | primary (felt), secondary (the band), trim (curls) |
| `hood.ts` | `hood` | head | humans | ears none/cat/bear, point, drape | primary (cloth), secondary (the ears) |
| `horned-helmet.ts` | `horned-helmet` | head | humans, animals | horns short/long/curled, dome round/pointed/flat, nasal, crest none/ridge/plume | primary (metal), secondary (bone horns), trim (metal rim, nasal, ridge), accent (the plume) |
| `backpack-round.ts` | `backpack-round` | back | humans, animals | pocket none/front/sides, straps thin/wide, roll, fill | primary (cloth or leather), secondary (pockets, like primary), detail (leather straps), trim (the roll) |
| `backpack-tall.ts` | `backpack-tall` | back | humans, animals | bedroll none/top/bottom, pockets 0/1/2, lid flat/domed, frame | primary, secondary (like primary), trim (the bedroll), metal (the frame) |
| `flag.ts` | `flag` | back | humans, animals | pole short/tall/towering, cloth banner/pennant/swallowtail/square, finial ball/spike/none, canton, length | primary (the field: stripes, bands, checks, trim), secondary (the canton), detail (a wooden pole), metal (the finial) |
| `cape.ts` | `cape` | back | humans, animals | length short/long/trailing, hem straight/tattered/trimmed, collar none/high/mantle | primary (trim, stripes, checks, gradient), secondary (collar, mantle), trim (the hem) |
| `scarf.ts` | `scarf` | neck | humans, animals | tails 0/1/2, knit thin/chunky, tassels, length | primary (knit: bands, stripes, checks), secondary (knot, tassels) |
| `glasses.ts` | `glasses` | face | humans, animals | frame round/square/aviator/cat-eye/visor, size | detail (the frame: metal or matte), secondary (the lenses: glow, metal or matte) |
| `boots.ts` | `boots-l`, `boots-r` | foot.L, foot.R | humans | shaft ankle/mid/tall, cuff none/fold/fur, sole flat/thick, laces | primary (leather), secondary (the cuff), dark (the sole), trim (laces) |

Boots bend with the foot through every step, so they're `layer: "body"`: baked into the wearer's body (its worn
slots). Everything else is rigid (`layer: "own"`, the default): baked once per shape and socket class, drawn as its
own layer on the socket (see `@keel-engine/bake`). The flag's cloth streams back and to the right, 112.5° -- half-way
between two of the eight baked directions, so none sees it edge-on; the cape on four legs is a caparison.

"humans" = target `{ body: "body/humanoid@^1", packs: ["packs/humans@^1"] }`;
"animals" = `{ body: "body/quadruped@^1", packs: ["packs/animals@^1"] }`
(`src/kit.ts`). Every build draws every choice whether pinned or not (so a pin
never moves the rest), checks pins, and sizes every piece from `socket.size`
(twice the socket, twice the design -- tested). Surface sockets grow along
the socket's `out`: the backpacks stand off a person's back (out -z) and lie
along an animal's (out +y) from one design (`standOff`); the scarf's ring is
square to the neck's axis. Boots are a pair: an attribute sits in one socket,
so it's two attributes from one design (give both the same stream and pins).

## Compatibility

Targets name the packs (as the architecture's example), and the three
manifests name each other: cloth lists humans and animals; they list cloth.
A dog from any other pack -- same body contract -- gets no cloth hat, whether
or not that pack lists cloth (tested). Note: under runtime's `fits()` today, a
target that names packs is decided by rule 2 alone (the entity's pack being
named), without the entity pack's own `compatible`; see the needed change in
the handover.

## Tests

`node --test packs/cloth/test/*.test.ts` -- the `fits()` matrix over all 13
attributes x 15 entities equals what the declarations say (counts: hats,
backpacks, flag, cape, scarf, glasses 15 each; hood and each boot 8); a hat fits
packs/animals' dog but not a stranger's dog, nor a dog from a pack that lists
cloth one-sidedly; every attribute builds on every entity it fits x 20 seeds
(<= 10 parts, inside 1.75x the socket's largest size -- the flag 5.5x, the cape
3x: they reach past their carrier by design -- standing out along a surface
socket's `out`, finite on a posed skeleton); linear in socket size; pins; boots
pair; at least three shape variants each, and every part carries one of the
roles its look names; the bundle reaches only `keel/runtime`.
