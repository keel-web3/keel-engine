# `@keel-engine/level`

Levels: a versioned document of terrain and LAYERS of placed things, seeded
generation where every choice is a lockable setting, fairness for N-player
maps, and an edit op list that streams change events. Module
`keel/level@0.1.0` (`kind: "runtime"`, needs `keel/core`, `keel/object`,
`keel/world` (settings, streams), `keel/codec`, `keel/terrain`).

```ts
import { generateLevel, fairness, levelInstances, placeholderContent, runLevelOps, encodeLevel, decodeLevel, levelOf } from "@keel-engine/level";

const { level } = generateLevel({ seed: "7", width: 128, depth: 128, players: 2, settings: "scene/level.biome=desert;id:lake-0/radius=6" });
fairness(level).pass;                                   // per-player metrics, spreads within 5%
const inst = levelInstances(level, content);            // things + plants resolved: sprites, and ground-baked solids per chunk
runLevelOps(level, [{ op: "ramp", at: [15, 9], dir: 0, width: 2 }, { op: "style", scope: "tag:buildings", style: "voxel" }]);
const bytes = encodeLevel(level.toDocument());          // levelOf(decodeLevel(bytes)) is the same level
```

| file | what |
| --- | --- |
| `document.ts` | `LevelDocument` (format `keel-level`, version 1): terrain (tile arrays), `settings` (the world's `SettingsJSON`: every scope and lock), `things`, `scatter`, `roads`, `water`, `spawns`, `markers`, `regions`, `resources`, `meta`; `createLevel`, `levelOf`, the live `Level` (`styleOf`, `refOf`, `settingsThing`, `blocked`, `pathGrid`, `toDocument`, change events) |
| `content.ts` | `ContentResolver` (`resolve(ref) -> ObjectDef`), `chainContent`, `CONTENT_IDS`, `placeholderContent()` (both styles), `groundSolids(def, pos, yaw)` |
| `biomes.ts` | `BIOMES` (temperate desert tundra volcanic alien): types by height, palette tint, flora and undergrowth rules |
| `generate.ts` | `generateLevel`, `generateFair` (reroll by attempt until fair), `chooser` (lockable choices on their own streams) |
| `fairness.ts` | `symmetricPositions`, `canonical` (a point folded into the symmetry's wedge), `fairness(level)` |
| `scatter.ts` | `poissonDisk` (Bridson), `expandScatter` / `expandAll` (rules x biome x clumps x spacing), `clearMask`, `bulkStream` |
| `roads.ts` | `roadPath` (4-way A*: cliffs are walls, ramps climb, straight water crossings a bridge can take), `roadNetwork` (MST + loops) |
| `ops.ts` | `LEVEL_OPS`, `validateLevelOps`, `applyLevelOp`, `streamLevelOps`, `runLevelOps` (atomic), undo / redo, `levelOpReference` |
| `schema.ts` | `LEVEL` (codec schema `keel/level`), `encodeLevel`, `decodeLevel` |
| `instances.ts` | `levelInstances(level, content)` -> sprites, ground extras per chunk + keys; `groundExtrasOf` for the ground baker |

## Things, by content reference

A `Thing` is `{ id, layer, pack, object, pins, look, tier, pos, yaw, scale, tags, footprint }`.
Nothing in the level knows how a house is built: `level.refOf(thing)` is
`{ pack, object, pins, look, style, seed }` and a **resolver** (the content
packs' -- `packs/foliage`, `packs/buildings` with their style builders) turns
it into an `ObjectDef`. `placeholderContent()` stands in until they land
(trees, pines, palms, bushes, flowers, reeds, cacti, rocks, crystals, houses,
cottages, towers, barns, shrines, huts, bridges; each in pixel and voxel), and
`chainContent(packs, placeholderContent())` is how both coexist.

**Style** (`pixel | voxel | custom`) is a SETTING, key `style`, resolved
through the thing's settings view: its id, and tags `[layer, pack:<p>,
object:<o>, region:<r>..., ...tags]` -- so the level (`scene/style=voxel`),
a region (`tag:region:old-town/style=voxel`), a kind (`tag:buildings`), one
thing (`id:tower-1`) can each set it, and a lock anywhere holds. Plants
resolve as `{ id: "<region>#", tags: [foliage, scatter:<region>, pack:, object:] }`.

**Tier**: `main | foreground | background` are the streaming loader's
(@keel-engine/bake `BakeTier`); `ground` means baked into the terrain's chunk
layers (per-texel depth: bridges and buildings), through `groundSolids`
(a definition's `meta.ground` list, wedges allowed, else its box parts).

## Generation through settings

Every choice goes `stream -> settings.propose(key, rolled, thing)`, each
choice on its own stream `choose:<thing>:<key>` (the world's convention), so a
lock anywhere wins, a choice draws whether locked or not, and locking one
never reshuffles another; the same seed and locks build the same level byte
for byte (`test/level.test.ts`).

| key | values |
| --- | --- |
| `level.template` | island, valley, highlands, archipelago |
| `level.biome` | temperate, desert, tundra, volcanic, alien |
| `level.symmetry` | none, mirror, rot2, rot4, wedges (by player count) |
| `level.relief`, `level.sea`, `level.baseRadius` | steps, sea level, where bases sit |
| `level.rivers`, `level.lakes`, `level.towns`, `level.foliage` | counts and density |
| `lake-<n>`: `at`, `radius`, `x`, `z` · `river-<n>`: `on` · `town-<n>`: `at`, `houses` · `building-<n>`: `object`, `yaw` · `flora` / `undergrowth`: `density` | per thing |
| `style` | never rolled: pixel unless a setting says otherwise |

The steps: height (a template over fbm noise, evaluated at each tile's
`canonical()` point so every player's wedge is the same field), mode
smoothing, types by biome and height (moisture picks between the two low
types), the sea, bases flattened with graded aprons (a step a ring, so a ramp
always fits), lakes, rivers (Dijkstra downhill, carved never rising),
**ramps** joining every plateau the ground can't reach (Kruskal over ramp
sites in a shuffled order; a few spares for loops), resources per base (8
mass + crystal, flux, fertile, wreck; the natural 6 mass; the middle's),
towns, **roads** (A*, water crossings straight) and a **bridge** where each
crosses water, houses on lots beside the roads, foliage regions, trigger
regions per base and the middle, markers.

**Exact symmetries** (mirror or rot2 for 2 players, rot4 for 4 on a square
map) build player 0's half and copy it: spawns, ramps (a ramp goes in with its
images or not at all), resources, roads -- so the fairness spreads measure 0.
Wedges (other N) copy by rotation and rounding (near, not exact) and are
measured; `generateFair` rerolls (the next attempt's streams) until the gate
passes or the tries run out, keeping the fairest.

## Fairness (keel-rts RTS.md 6.1)

`fairness(level)` per player: path distance to its natural, to the nearest
enemy main, to the middle (the 2 x 2 tiles round the centre), the narrowest
opening on the way out (clearance), resources within 20 tiles of walking, the
main's height; each metric's spread `(max - min) / mean`, pass when all are
within 5% and every main reaches every other. Measured: 2-player mirror/rot2
maps and 4-player rot4 maps pass with spreads of 0-3%; N-wedge maps need the
reroll (a 3-player 112 x 112 map: best of 4 attempts).

## Edit ops

Plain JSON an editor or an agent emits: `height paint ramp unramp water
drain road bridge place move remove scatter spawn resource marker region set
lock unlock style undo redo`. Each is validated against `LEVEL_OPS` (field
types, required fields, unknown fields), applied with a change event `{ kind,
chunks, ids }` (the ground rebakes exactly those chunks), undoable (a
snapshot of the tiles, things and lists it touches); `runLevelOps` is atomic.

## The document and the codec

`toDocument()` / `levelOf(doc)` (JSON-safe), `encodeLevel` / `decodeLevel`
through the codec schema `keel/level` (tile arrays as runs, names through
tables, positions to the millimetre, settings as `keel/world/settings`): a
96 x 64 generated level is **4.9 KB** packed (125 KB as JSON); a 256 x 256
8-player map 30 KB. Plants aren't stored: a region is its rules and the
level's seed, and `expandAll` grows the same plants every time.

## Measured (node 22, this Mac)

| what | time |
| --- | --- |
| generate 128 x 128 (valley, towns) | 75 ms |
| generate 256 x 256, 8 players | 330 ms (height 74, ramps 115, roads 126) |
| scatter 256 x 256 (107k Poisson candidates) | 0.37 s |
| fairness, 8 players on 256 x 256 | 48 ms |

## Integration

- **Content packs**: resolve `{ pack, object, pins, look, style, seed }`; list
  a pack's objects (`list(pack)`, the generator picks houses from it). Ids the
  generator asks for are `CONTENT_IDS` (one table to re-point). A building's
  definition may carry `meta.ground` (the solids to bake, wedges for roofs) and
  `meta.footprint`.
- **Codec**: `LEVEL` should join `ENGINE_SCHEMAS` in `packages/codec/src/schemas/index.ts`
  (the codec agent's file) so `readDocument` finds it by name.
- **Editor / agents**: `LEVEL_OPS` + `levelOpReference()`; change events name
  chunks and ids; `level.settings.explain(key, thing)` says who set or locked a choice.
- **World generation** (keel/worldgen): `generateLevel({ world })` takes a
  `LevelWorld` -- `{ key, fill(terrain), typeAt?, finish?(level) }` -- in place of
  the template's height and types; everything after (bases, lakes, rivers,
  ramps joining plateaus, resources, roads, towns, foliage) runs over its
  ground as ever, and `meta.world` names it. keel/worldgen's
  `levelWorld(recipe)` implements it (a generator pipeline: climate biomes,
  dungeons, WFC towns, and this package's own templates as a stage); the
  level knows only the interface, so it doesn't depend on worldgen.
