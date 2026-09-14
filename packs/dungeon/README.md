# `packs/dungeon` (`@keel-engine/dungeon`)

An action-RPG dungeon's dressing as **styled objects** (`@keel-engine/object`):
one design each, drawn in the **pixel** style (the default) or any other, with
colliders and sockets in every style. Module `packs/dungeon@1.0.0` (`kind:
"pack"`), needs only `keel/object@^0.1`, provides `objects/dungeon@1.0.0`.
keel/worldgen's dungeon crawl (`dressDungeon`) places them; a game reads their
flags.

`src/kit.ts` holds the 16 world roles every asset paints from (stone, wood,
metal, gold, cloth, bone, paper, leather, wax, ichor, moss, web, accent,
cushion, glow, dark) and the shared pieces (bands, skulls, bones, candles,
planks, chains); `src/profiles.ts` the ACTS as look profiles; `src/props.ts`
how each prop is placed; `src/rooms.ts` room templates.

| id | shape choices | roles |
| --- | --- | --- |
| `torch` (light) | form bracket / sconce / cage | wood, metal, glow, dark |
| `brazier` (light) | height 0.8..1.25, form tripod / bowl / pillar | metal, stone, glow, dark |
| `candelabra` (light) | form stand / cluster, count 3 / 5 | gold, metal, wax, glow |
| `crystals` (light) | height 0.5..1.2, count 4 / 5 / 7 | accent, glow, stone |
| `mushrooms` (light) | count 3 / 5 / 7, height 0.2..0.6 | accent, bone, glow |
| `barrel` (destructible) | height, hoops 2 / 3, lid / open, lying | wood, metal, dark |
| `crate` (destructible) | size, stack 1..3, framed / slatted | wood, metal |
| `urn` (destructible) | height, round / amphora / jar / broken, lid | stone, gold, accent |
| `chest` (openable) | small / large, closed / open, wood / iron | wood, metal, gold, glow |
| `bones` (decal) | count 3 / 5 / 8, skull, ribs, spread | bone, dark |
| `skull-pile` | count 4 / 7 / 10, size, heap / pyramid | bone, dark |
| `stain` (decal) | size, pool / splatter / trail | ichor |
| `rubble` | size, heap / blocks / column, moss | stone, moss, dark |
| `cobweb` | size, corner / sheet / hanging, spider | web, dark |
| `chains` | strands 1..3, length, shackles | metal, dark |
| `banner` | width, length, flat / notched / pointed tail, device none / disc / bar / skull | cloth, accent, gold, wood |
| `roots` | strands, width, leaves | wood, moss |
| `bookshelf` | width, shelves 3..5, full / sparse / ruined | wood, leather, paper, cloth, gold |
| `table` (candle light) | long / square / round, clutter books / feast / alchemy / candles / none, stools | wood, paper, wax, metal, ... |
| `weapon-rack` | width, swords / spears / axes / mixed, shield | wood, metal, leather, cloth |
| `cage` | floor / hanging, size, inside none / bones / skull | metal, bone, dark |
| `altar` (candle light) | block / pedestal / sacrificial, candles 0 / 2 / 4, runner, width | stone, cloth, gold, wax, ichor |
| `sarcophagus` | length, lid closed / ajar / open, carving effigy / plain / cross | stone, gold, bone, dark |
| `tombstone` | round / cross / broken, height, moss | stone, moss |
| `throne` | stone / bone / iron, crown spikes / skulls / arch | stone, metal, gold, cushion, bone |
| `statue` | knight / idol / obelisk, broken, moss | stone, gold, moss |
| `stalagmite` | height, count 1..3, wet | stone, moss |
| `anvil` | stump | metal, wood, glow |
| `furnace` (brazier light) | width, bellows, hood | stone, metal, glow, leather |
| `ore-cart` (destructible) | ore / glowing / empty | wood, metal, stone, glow |
| `key` (light) | on a plinth / cushion | gold, stone, cushion, glow |

Light sources carry `meta.flames` (where the renderer puts its flames).

**A hero's gear** (exported from the pack's one entry, like everything in a
verified module; runtime attributes, so the pack needs keel/runtime too): `sword` (hand.R:
long / broad / short blade, cross or curled guard) and `shield` (hand.L:
round / kite / heater, a boss) for two-legged bodies -- the crawl's hero wears
them baked into his body (a population's `CastEntity.wear`), with packs/cloth's
hood and cape. The manifest lists them under `contents.attributes` and
provides `attributes/dungeon-gear@1.0.0`.

**Acts are look profiles** (`src/profiles.ts`): `crypt` (cold blue-grey
stone, dark oak, tarnished brass, ivory bone, crimson and violet cloth),
`cave` (brown rock, rotten wood, rusted iron, green slime, cyan crystal),
`forge` (black basalt, charred wood, black iron, brass, blood-red cloth,
molten glow), `ruin` (weathered sandstone, grey-green wood, verdigris, faded
teal cloth, moss). One bake serves every act: a room changes act with its
look table.

**Placement** (`PROPS`, `propInfo(id)`): per prop its footprint radius,
where it goes (`wall`, `corner`, `floor`, `centre`, `decal`), whether it
blocks the path grid, is `destructible` or `openable`, and the light it
gives (torch, sconce, brazier, candle, crystal, fungus, key).

**Room templates** (`ROOMS`, keel/worldgen's `RoomTemplate` shape):
`dungeon-entry-hall` (start), `dungeon-stairwell` (exit), `dungeon-library`,
`dungeon-crypt-hall`, `dungeon-armoury`, `dungeon-prison`,
`dungeon-storeroom`, `dungeon-chapel` (key), `dungeon-cistern`,
`dungeon-colonnade`, `dungeon-throne-hall` (boss) -- furnished with
worldgen's furniture letters. Use them with
`runPipeline(recipe, { templates: ROOMS })` and the dungeon stage's
`templates: "dungeon-*"`.

Tests (`node --test packs/dungeon/test/*.test.ts`): the manifest; 40 seeds of
every asset built in pixel style within budgets, roles used, standing on the
ground; the acts painting differently, voxel builds; flames, openable and
`PROPS` covering every asset; room templates stitched by worldgen; the bundle.
