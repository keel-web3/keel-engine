# `packs/animals` (`@keel-engine/animals`)

The catalogue's seven four-legged species as entities, one file each, and two
attributes only they wear. Module `packs/animals@1.0.0` (`kind: "pack"`),
needs `keel/runtime@^0.1` and `keel/entity@^0.1`; **provides**
`body/quadruped@1.0.0` and `attributes/wearable@1.0.0`; **compatible**
`["packs/cloth@^1"]`.

| file | entity | surfaced choices (options are the catalogue's for the species) | `size` pin (shoulder height, m) |
| --- | --- | --- | --- |
| `src/entities/dog.ts` | `dog` | coat, ears (flop/point), earSize, tail, snout, head, legs, girth, height, eyes, stride | 0.35..0.7 |
| `src/entities/cat.ts` | `cat` | coat, ears (point/tuft), earSize, tail, head, legs, girth, height, eyes, stride | 0.2..0.32 |
| `src/entities/fox.ts` | `fox` | coat, earSize, tail, snout, head, legs, girth, height, eyes, stride | 0.28..0.42 |
| `src/entities/bear.ts` | `bear` | coat, earSize, snout, head, legs, girth, height, eyes, stride | 0.7..1.1 |
| `src/entities/rabbit.ts` | `rabbit` | coat, ears (long/lop), earSize, tail, head, legs, girth, height, eyes | 0.12..0.2 |
| `src/entities/mouse.ts` | `mouse` | coat, earSize, tail, snout, head, girth, height, eyes | 0.04..0.07 |
| `src/entities/deer.ts` | `deer` | antlers, coat, earSize, snout, head, legs, girth, height, eyes, stride | 0.8..1.1 |

Each is `speciesEntity("animal", species)` (keel/entity) wrapped by
`src/species.ts`'s `animal()`: the catalogue's build and sockets, but only the
choices that matter for that animal are listed -- and only those pin (plus
`seed`, `size` and `furColour`); anything else throws (a dog has no
trousers). Unpinned, the size is the species' own. Tags: `herd` marks the
herding kinds (dog, deer); `pet`/`wild` for browsing.

| file | attribute | slot | targets | shape choices | look roles |
| --- | --- | --- | --- | --- | --- |
| `src/attributes/collar.ts` | `collar` | neck | `body/quadruped@^1` from `packs/animals@^1` | charm bell/tag/spikes/none, band thin/wide, studs, snug | primary (leather: checks, stripes, trim), metal (the charm, spikes), detail (studs) |
| `src/attributes/saddlebag.ts` | `saddlebag` | back | `body/quadruped@^1` from `packs/animals@^1` | bags small/big/double, flap, buckles, fill | primary (canvas or leather: the finish), secondary (flaps), detail (the strap), metal (buckles) |

Canvas-or-leather used to be a shape choice; it's the primary role's finish now (a look: free to change).

## Shape and look

Each animal's choices are split (keel/entity's `groupsFor`): its coat -- where the
alternate fur goes (muzzle, socks, tipped) -- is a LOOK choice, painted at draw
time on one baked body; ears, tail, snout, build and the rest are SHAPE choices.
Its look roles, in order: `fur`, `furAlt`, `accent` (a collar's leather), `dark`,
`blush` -- a look draws natural furs most of the time and the profile's colours
(and spots, stripes, gradients) the rest.

Both are `AttributeShape`s built in the socket's frame (keel/entity's
fitting convention), sized from `socket.size`; the collar's ring is square to
the neck's axis (`src/kit.ts` `axisOf`: the neck socket sits halfway up its
bone, so its `at` points along it).

## Compatibility

`compatible: ["packs/cloth@^1"]`, not `"*"`. The owner's rule is "a dog from
another pack doesn't get this pack's wearables unless both packs agree" --
and the same handshake guards these animals. With `"*"` any wearables pack
that lists `packs/animals` would get on without this pack ever naming it; a
listed pack is a decision someone made. Opening the animals to everyone is a
one-word change (and a minor version) when the owner wants it. The collar
and saddlebags name `packs/animals@^1` in their targets, so they stay off
every other pack's quadrupeds whatever those packs declare.

## Tests

`node --test packs/animals/test/*.test.ts` -- 100 seeds per animal on
`body/quadruped@1.0.0` with every required socket; every surfaced option pins,
size pins in range, foreign pins throw; manifest contents; collar and
saddlebags fit this pack's animals and not a foreign pack's dog (even one with
`compatible: ["*"]`), build on every animal x 20 seeds inside 1.75x the
socket's largest size, ride a posed skeleton; the bundle reaches only
`keel/runtime` and `keel/entity` and starts on a page.
