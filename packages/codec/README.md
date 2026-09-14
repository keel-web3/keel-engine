# `@keel-engine/codec`

The bit codec: the packed form every engine object, look, world, particle
save, sound and script is written in. Module `keel/codec@0.1.0`
(`kind: "runtime"`, phase `data`, weight -31000: right after the registry, so a
pack's data module can decode its contents before anything reads them). It
needs no other engine part.

> "the data to write the objects and scripts needs to be a bit codec system,
> not JSON (you can do JSON, but we need a super packed way, and the editor
> should understand it)."

So: a typed schema DSL; a canonical, bit-packed encoding with errors that name
the field; schemas that are themselves data (a document carries its schema or
names it by hash); a registry; a lossless JSON view for authoring; and
`explainBits`, the field-by-field bit map the KEEL desktop editor's inspector
draws. Plus the engine's own schemas and a Solidity decoder generator.

```ts
import { t, encode, decode, toJSON, explainBits, schemaId } from "@keel-engine/codec";
import type { Infer } from "@keel-engine/codec";

const Crate = t.named("packs/props/crate", t.struct({
  key: t.ref("keys"),                          // a string, deduped through a table
  size: t.fixed(0, 64, 0.001),                 // 0..64 m to the millimetre: 16 bits
  kind: t.enum(["level", "prop"]),             // 1 bit
  tags: t.array(t.ref("tags"), { max: 15 }),   // a 4-bit length
  glow: t.withDefault(t.bool(), false),        // 1 bit when it's the default
  note: t.optional(t.string()),                // 1 presence bit
}));
type Crate = Infer<typeof Crate>;              // decode() returns this type

const doc = encode(Crate, { key: "crate", size: 1.5, kind: "prop", tags: ["solid", "movable", "solid"], glow: false });
// 29 bytes (JSON: 88): 0xB1 + schema id (5), text length (1), 6 bytes of bits, "cratesolidmovable"
decode(Crate, doc);                            // the value, typed
toJSON(Crate, value);  fromJSON(Crate, json);  // the authoring form, lossless
explainBits(doc);                              // every field's bits, for the inspector
```

## The DSL

Every node is a small frozen record (`{ kind: "uint", bits: 8 }`); the field
order you write is the order it is encoded in, and part of its hash. `t.*` is
the whole DSL as one object; each is also exported by name (`enumOf` for
`t.enum`).

| type | bits | TS value | notes |
| --- | --- | --- | --- |
| `uint(bits)` | exactly `bits` (1..53) | `number` | |
| `int(bits)` | exactly `bits` (2..53) | `number` | zigzag: -1 is 1, 1 is 2 |
| `bool()` | 1 | `boolean` | |
| `fixed(min, max, step, { off, k, delta })` | ⌈log2((max-min)/step+1)⌉ | `number` | the whole multiples of `step` in [min, max]; decimal steps decode as exact decimals (3.14, never 3.1400000000000006), power-of-two fractions of pi exactly. `off: "round"` (default) rounds, `"strict"` throws off the grid, `"exact"` spends 1 flag bit and keeps any number whole (a float64) -- authored decimals small, drawn doubles lossless. `k`: Exp-Golomb of order k instead of the width (small values small). `delta: true` (with k): the difference from this field's last value in the document, 1 bit when it's the same |
| `float16()` `float32()` `float64()` | 16 / 32 / 64 | `number` | refuses a number that isn't exactly one |
| `num()` | 2 + ... | `number` | any number, lossless: an integer (zigzag Exp-Golomb), a short decimal (up to 8 places, as digits + places), a float32 when exact, else a float64 |
| `varuint({ k, group })` `varint(...)` | variable | `number` | Exp-Golomb of order k (default 0: 0 in 1 bit, 1..2 in 3, 3..6 in 5, 1000 in 19), or LEB-style groups of `group` bits + a more-bit. Exp-Golomb wins in a bit stream; groups suit numbers you'll read by eye in a hex dump |
| `biguint(bits)` | exactly `bits` (1..256) | `bigint` | a bytes32 seed is `biguint(256)` |
| `enum(values, { capacity, open, other })` | ⌈log2 n⌉ | the values' union | `capacity`: room for values appended later (the width is ⌈log2 capacity⌉); `open`: a varuint index; `other`: one more code for any string not in the list, written out |
| `string({ max, packHex })` | length + bytes | `string` | UTF-8; the bytes go to the text section; `packHex`: a flag bit, and "0x" + hex pairs go as bytes |
| `ref(table, { packHex })` | ⌈log2(n+1)⌉ | `string` | through a shared, named string table: the first time in full, then its index. The default table `"str"` is shared with `dyn()`'s strings |
| `bytes({ length })` `hex({ bytes })` | length + bytes | `Uint8Array` / `"0x.."` | |
| `const(value)` | 0 | the value | |
| `dyn()` | 3 tag bits + ... | `Json` | any JSON-like value, self-described: integers as varints, fractional numbers as `num()` does (and a number seen before in the document as its index), strings and keys through the table, an object shaped like an earlier one (the same keys in order) as that shape's index then its values. -0, NaN and the infinities survive |
| `array(of, { length, max })` | length + items | `readonly T[]` | a varuint length, exactly `length` items, or a length in ⌈log2(max+1)⌉ bits |
| `optional(of)` | 1 + ... | `T \| undefined` | in a struct: the field may be left out |
| `nullable(of)` | 1 + ... | `T \| null` | |
| `withDefault(of, value)` | 1 (+ the value) | `T` | 1 bit when it is the default (an absent field counts as it) |
| `struct(fields, { open })` | the fields | `{ ... }` | `open: true` makes room to grow: a count of extension groups (1 bit while there are none) |
| `extend(struct, fields)` | | | the next version: a group of new fields, each `optional` or `withDefault` |
| `tuple([...])` | the items | `readonly [...]` | |
| `union(tag, { name: struct }, { capacity })` | ⌈log2 n⌉ + the variant | tagged union | `{ type: "box", c, h } \| { type: "capsule", a, b, r }` |
| `alt([...])` | ⌈log2 n⌉ + ... | the union | told apart by what the value is (a number, a string, an array...): a material that is a name or an index |
| `map(key, value, { order })` | count + pairs | `Record<string, V>` | `"sorted"` (canonical, default) or `"kept"` (for maps whose order means something: a look's roles) |
| `delta(of, { k })` | first + differences | `readonly number[]` | sorted ids, a polyline, a timeline |
| `runs(of)` | length + (value, run-1) | `readonly T[]` | runs of equal values |
| `lz(of, { min })` | LZ77 over items | `readonly T[]` | literals and copies from some distance back: a run is a copy from 1 back, a voxel row like the row before a copy from a row back. Greedy, longest match, nearest first: canonical |
| `planes(bits)` | length + bit planes | `readonly number[]` | small numbers, top bit of every value first |
| `named(name, of, { version, doc })` | 0 | | a name for the editor and the registry (the doc isn't hashed) |
| `recursive<T>((self) => ...)` | | `T` | a type that contains itself: a block holding blocks |

Integers don't keep -0 (it is 0); every type that holds floats does.

## The body, and what "canonical" means

A body (`encodeRaw`) is: the text section's length (LEB128, one byte when
under 128), the bits (MSB first: bit 0 is the top bit of the first byte),
zero padding to a byte, then the text section -- every string's UTF-8 in the
order written. The bits stay packed; the text stays text, so gzip (which KEEL
runs on every leaf) Huffman-codes it.

Canonical: a value has exactly one encoding, and the decoder refuses any other.
Maps are sorted (unless `kept`), runs maximal, a table string or a repeated
number is always its index once seen, an object shaped like an earlier one is
always that shape, a number takes its smallest kind, trailing empty extension
groups are left off, padding is zero, nothing follows. Equal values are equal
bytes, so bytes can be hashed and compared. (Deep-equal, with object key order
free except in `kept` maps and `dyn()`, where JSON's own order is kept.)

Errors say where and why, when encoding and decoding:

```
parts[0].shape.type(box).h[1]: 7 is above fixed(0, 5, 0.001)'s max 5.
kind: "thing" is not one of ["level","prop"].
Unknown field "colour" (the fields are key, parts, kind).
parts[0].c[1]: The data ends early: wanted 15 more bits, 14 left. (at bit 34)
```

## Documents, schema ids, the registry

A schema encodes to bytes through the schema-schema (`SCHEMA_SCHEMA`, itself
written in the DSL); its id is the SHA-256 of those bytes with docs blanked.

```
header "id"    0xB1 · the id's first 4 bytes · body        encode(schema, value)          (the default)
header "self"  0xB2 · LEB128 length · the schema · body    encode(schema, value, { header: "self" })
header "none"  the body                                    encodeRaw(schema, value)
```

`decode(schema, bytes)` checks the header names this schema; when it names
another (a newer or older version) that the registry knows, or the document
carries, it reads it if the evolution rules allow and says why not otherwise.
`readDocument(bytes)` needs no schema: a tool with no code for the data decodes
it from the header alone. `registerSchema(schema)` / `registerSchema("name@1",
schema)` / `lookupSchema(id | short | "name@1")` use `defaultRegistry`;
`createRegistry()` makes others.

A module declares the schemas its data uses in its manifest, with the schema's
own bytes embedded (base64url) so the editor can read its documents without
running it:

```ts
defineManifest({ id: "packs/tiles", version: "1.0.0", kind: "pack", contents: { schemas: [schemaEntry(TILE)] } });
registerEntries(manifest.contents.schemas, registry);   // checked against each hash
```

The KEEL build does the listing for you: every named schema a package's
`src/schemas.ts` exports lands in its manifest's `contents.schemas`, bytes
embedded. On a page, `keel/codec`'s `setup(ctx)` (called once by the KEEL
bundle, in the data phase) registers the engine's schemas and every defined
module's embedded ones into `defaultRegistry` (from `ctx.modules()`, before
they start); again only picks up modules it hasn't seen. Entries without
their bytes wait in `pendingSchemas()` until their module registers them; bad
ones (bytes that don't match the hash) are in `schemaLoadReport().problems`.

Tables (`createTables()`) can be shared across documents: encode a pack's
documents in order with one, decode them in order with another made from the
same start, and every string is written once for the pack.

## Evolution

- An **open** struct (`struct({...}, { open: true })` from its first version)
  grows with `extend(v1, { newField: optional(...) | withDefault(...) })`. Each
  extension group carries its bit length and its text length: an **old reader
  skips** groups it doesn't know; a **new reader fills in** the fields of groups
  old data lacks (their defaults, or absent). A v2 writer with nothing new to say
  writes exactly what v1 wrote.
- An **enum or union grows at the end** within its `capacity` (declare it up
  front: the width is ⌈log2 capacity⌉). A reader meeting a value it doesn't know
  fails at that field, saying so ("data from a newer schema?").
- Names, versions and docs change freely.
- Everything else must match exactly: widths, grids, Golomb parameters, table
  names, field order, defaults. `compatibility(writer, reader)` checks it and
  lists the problems by path, and warnings (a grown enum).

## The JSON view

`toJSON(schema, value)` / `fromJSON(schema, json)`: the authoring and debugging
form, lossless both ways (`fromJSON(toJSON(v))` encodes to the same bytes;
tested on 10,000 random schemas). Enums are their names, `fixed()` values the
decimals they stand for, bytes and big numbers `"0x"` hex, and the numbers JSON
can't spell are `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"` (in `dyn()`, where
any string is a value, `{ "$float": "NaN" }`). An optional left out is left out
of its struct (`{ "$none": true }` anywhere else). `{ omitDefaults: true }`
leaves defaulted fields out; `fromJSON` fills them in and checks everything.

## explainBits and the editor

```ts
const x = explainBits(bytes, { schema?, registry?, raw? });
x.schema      { id, short, name, version }
x.header      the header's bytes as a node (null for a body)
x.root        the value's tree: BitNode { label, path, kind, type, role, bit, bits, value?, note?, children? }
x.textBit     where the text section starts
x.spans       every leaf range, in bit order: they tile the buffer (tested)
nodeAtBit(x, bit)   the nodes covering a bit, outermost first
costs(x)            bits per field path, array indices folded ("parts[].shape.type(box).c": 33062)
```

`bit` is from the start of the whole buffer (header included), so the hex
view's selection and the tree's are the same numbers. `role` says how to colour
a range: `value` (a field's own bits), `overhead` (a length, a presence bit, a
union tag, a table index, a repeat), `text` (a string's bytes, in the text
section), `header`, `padding`; `container` nodes group their children. `type`
is a short description (`fixed(0..64 step 0.001) 16b`, `ref(tags)`, `union by
type (box|capsule|wedge)`), `note` the meaning of odd bits ("new: table tags
#3", "the default", "shaped like object #2: 14 keys", "7 bytes in the text
section"), `value` the field's JSON view.

The inspector: a tree on the left (labels, types, values, `bits` as a size
column), the hex/bit grid on the right painted by `spans` (one colour per role,
the selected node's range outlined), hovering the grid calls `nodeAtBit` to
light the tree, hovering the tree lights its range (a string lights its length
in the bits and its bytes in the text section), and `costs` as a "what's big"
bar list. The schema comes from the document itself or from the registry the
editor fills from every loaded module's `contents.schemas` -- so it can open
any document a pack wrote. `toJSON` gives the editable form; `fromJSON` +
`encode` saves it back, refusing (with the field path) anything invalid.

## Engine schemas

The codec holds the engine-level schemas itself, in `src/schemas/`, written
against structural types (no imports of object, world, audio...): the codec
stays at the bottom of the graph, so any package can import its own schema from
here without a cycle, and one place defines the stored formats. Pack- and
game-specific schemas belong in their own packages (importing the codec) and
are declared in their manifests. Each comes with converters from and to the
owning package's shapes.

| schema | what | fidelity |
| --- | --- | --- |
| `OBJECT` `keel/object` | an object definition as the spec `defineObject` takes: parts as box / capsule / wedge prims, names, materials, roles, flags; sockets, rails, tags, rest, meta; colliders when given by hand. `objectRecordOf(def)`, `objectSpecOf(record)` | millimetres, 65536ths of a turn; part coordinates Golomb + delta coded |
| `PLACED` `keel/object/placed` | placed objects: definitions once each, instances by index with position, yaw, scale, own tags (a level, a WALLRUN course). `placedRecordOf(instances)` | as above |
| `LOOK` `keel/look` | core's `lookOf`: profile, base hue, each role's ramp, finish, pattern -- on core's own quantised grids (`strict`: off-grid would throw). `lookRecordOf`, `lookOfRecord(r, lookSignature)` | exact, signature and all |
| `ENTITY_MAKE` `keel/entity/make` | an entity's seed and every species choice, typed (`ENTITY_PINS`) | exact |
| `ATTRIBUTE_PIN` `keel/attribute/pin` | pack + attribute + seed + pins (+ its look): what a wearable token names | exact |
| `POPULATION` `keel/population` | a cast and its units (bake's `populate`): body and wearable shapes by key, each unit's coverage, look, worn look and wears. `populationRecordOf` | exact |
| `HYBRID_POPULATION` `keel/population/hybrid` | a population as what makes it: the recipe (generator module ids at exact versions, seed, count, options), each re-rolled unit's look candidates (sparse), pins per unit and layer (body, wear, look, worn looks, animation), explicit parts as nested documents (`VOXELS`, `OBJECT`) and the layers they replace. bake's `recordOf` / `populationOf` / `unitOf` | exact: regenerates the batch's units (tested on 10,000, each alone) |
| `SETTINGS` `WORLD_SNAPSHOT` `keel/world/...` | settings scopes with their values and locks; `world.snapshot()` v2, typed where the world types it and `dyn()` where it keeps free JSON | exact: a fresh world restored from the codec runs on identically (tested) |
| `PARTICLES` `PARTICLE_POOL` `keel/particles/...` | the proof-of-concept pool's `save()`; the smart pool's snapshot (format @2) with emitter slots as runs | exact: loaded into a fresh pool, it steps the same (tested) |
| `BLOCKS` `BYTECODE` `keel/script/...` | the Scratch-like blocks (see below) | exact |
| `MUSIC_RECIPE` `keel/audio/recipe` | seed + mood (bands as preset + corner) or seed + `moodFor` spec, + pins. `recipeOfMood(mood, seed, { bands, kits })`, `moodOfRecipe` | the plan, exactly (scoreOf) |
| `SONG` `keel/audio/song` | a plan itself: bars as sections of chords (a scale degree, a secondary dominant, the borrowed iv, or spelled out), the tune's rhythm delta-coded, drum voices as 16-step masks, instruments as enums, mix and make in exact fixed point. `songOf(plan)`, `planOfSong(song)` | JSON-equal plan |
| `SFX_SETTINGS` `keel/audio/sfx` | seed, style (a preset, or fields over one), volume, `bodySfx`'s surface and event mapping, per-sound gain/pitch/pan/jitter | exact |
| `VOXELS` `keel/builder/voxels`, `opListSchema(OPS)` | the builder's voxel model (cells LZ-coded over the box) and its op lists, the op schema made from the builder's own OPS table | exact |

### Scripts: blocks and bytecode

`BLOCKS` is the tree the editor saves: handlers (`start`, `tick`, `message`,
`touch`, `key`, `timer`, `hit`, `near`, or any name) of statements (`set`,
`change`, `if`/`else`, `repeat`, `while`, `wait`, `do` an action, `send` a
message, `stop`) over typed expressions (numbers, flags, text, variables,
arithmetic, comparisons, logic, `not`, `random`, `sense`). Actions and senses
are names the game answers, so the op set stays small.

`BYTECODE` is the same program for a stack machine: 34 ops in 6 bits, typed
immediates (a number as `num()`, a name through the table, a variable's index,
a branch's length). Control flow is structured -- `if n`, `ifelse n` + `else n`,
`repeat n`, `while c n` -- so `decompileScript(compileScript(tree))` is the tree
(tested on 2,000 random scripts) and the editor can always show blocks.
`createScriptVM(bytecode, host)` runs it deterministically: `fire(event, arg)`,
`step(dt, budget)` (a fixed op budget per thread per step; waits in simulation
seconds; `random()` from the host's seeded stream); it matches a tree-walking
reference action for action (tested).

## Precision

Objects are stored to the millimetre and 1/65536 of a turn: a record is the
design, not the last bit of a double (rebuilt pieces match to half a
millimetre; tested on every catalogue piece). Everything that must go on
exactly -- snapshots, particle state, looks, pins, plans -- is lossless.
`fixed(..., { off: "exact" })` is the middle way: authored decimals in a few
bits, anything else kept whole.

## Sizes

`node packages/codec/tools/measure.ts` (real engine data; the codec documents
include their 5-byte header; gzip level 9, as KEEL gzips each leaf):

| data | what | JSON | JSON+gz | codec | codec+gz | codec+gz / JSON+gz | fidelity |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| object catalogue | 300 pieces (12 kinds × 25 seeds) | 503 KB | 51 KB | 32 KB | 26 KB | 50.4% | to the mm |
|  | ... against JSON rounded to the mm | 373 KB | 30 KB | 32 KB | 26 KB | 85.9% | to the mm |
| WALLRUN course | 33 instances, 33 definitions | 26 KB | 4.2 KB | 3.0 KB | 2.6 KB | 62.8% | to the mm |
|  | ... against JSON rounded to the mm | 21 KB | 2.9 KB | 3.0 KB | 2.6 KB | 91.5% | to the mm |
| garden world snapshot | 3 entities, 48 particles, 10.2 s in | 21 KB | 6.9 KB | 6.7 KB | 5.7 KB | 82.4% | exact |
| garden particles (save) | 48 live particles | 12 KB | 4.1 KB | 3.8 KB | 3.3 KB | 80.3% | exact |
| particle pool snapshot | 1515 particles, 256 emitter slots | 372 KB | 102 KB | 160 KB | 95 KB | 93.6% | exact (JSON isn't: Infinity becomes null) |
| army population (pack + looks) | 10,000 units, 16 bodies, 721 wearable shapes | 23,886 KB | 1,763 KB | 1,003 KB | 956 KB | 54.2% | exact |
| army population as a hybrid record | the same 10,000: recipe + the re-rolled units' candidates | 23,968 KB | 1,766 KB | 2.5 KB | 2.3 KB | 0.1% | exact (regenerated) |
| script: blocks | a guard (4 handlers, 7 vars) | 4.5 KB | 809 B | 378 B | 384 B | 47.5% | exact |
| script: bytecode | the same, 138 ops | 4.5 KB | 809 B | 414 B | 424 B | 52.4% | exact |
| NOCTURNES music: 1 plan as recipe | token 1 | 3.5 KB | 1008 B | 84 B | 107 B | 10.6% | the plan, exactly |
| NOCTURNES music: 1 plan as song | token 1 | 3.5 KB | 1008 B | 290 B | 313 B | 31.1% | the plan, JSON-equal |
| NOCTURNES music: 100 recipes | tokens 1..100, one document | 386 KB | 41 KB | 6.0 KB | 5.4 KB | 13.2% | the plans, exactly |
| NOCTURNES music: 100 songs | tokens 1..100, one document | 386 KB | 41 KB | 27 KB | 22 KB | 54.2% | the plans, JSON-equal |
| WALLRUN music: 50 recipes | moodFor spec + seed | 190 KB | 17 KB | 1006 B | 572 B | 3.2% | the plans, exactly |
| WALLRUN music: 50 songs | | 190 KB | 17 KB | 12 KB | 9.7 KB | 56.4% | the plans, JSON-equal |
| WALLRUN sfx settings | seed, style, body mapping, per-sound tuning | 514 B | 283 B | 151 B | 155 B | 54.8% | exact |
| builder voxel models | 18 generated (6 kinds × 3 seeds) | 73 KB | 2.0 KB | 2.2 KB | 1.9 KB | 96.4% | exact |
|  | ... the builder's own KV1 bytes | 7.0 KB | 2.8 KB | 2.2 KB | 1.9 KB | 67.8% | |
| builder op list | 36 ops (every op's example) | 1.8 KB | 769 B | 338 B | 345 B | 44.9% | exact |

What moves the numbers: Golomb + delta coding for geometry (a stair's next
step, the same half-width again in 1 bit); the text section (strings stay text
for gzip); tables for strings, repeated numbers and object shapes in `dyn()`;
and, most of all, storing the recipe instead of what it makes -- a music recipe
is 1-3% of its plan's gzipped JSON, and ten thousand all-different units are
2-3 KB as a hybrid record (the recipe, the look re-rolls a unit alone can't
know, pins, explicit parts) against a megabyte as units. Courses and
catalogues are regenerable from seeds too: store the recipe, keep these records
for what was edited or pinned by hand.

Speed (M-series laptop, Node 22): the bit stream writes and reads ~300 MB/s;
engine documents encode at 15-20 MB/s of codec output and decode at 7-15 MB/s --
that is 250-460 MB/s of the JSON they replace; the 10,000-unit population
(1 MB) encodes in ~53 ms and decodes in ~68 ms, JSON.stringify/parse of its
24 MB take 53/85 ms. `test/speed.test.ts` reports it.

## Who stores through it (the integration)

Every engine package that stores data now writes it through the codec; JSON is
the readable view (`toJSON`) and what old data was. Each package's own README
has the details and sizes.

| package | stores | through | old data |
| --- | --- | --- | --- |
| `@keel-engine/builder` | voxel models (`storeVoxels` / `loadVoxels`; text `"KC1:"` + base64url, what exported pack code embeds), op lists (`storeOps` / `loadOps`), asset data (`storeData` / `loadData`) | `VOXELS`, `opListSchema(OPS)`, `named("keel/builder/data", dyn())` | KV1 bytes and `"KV1:"` text, `J1` JSON still load (told apart by the first byte / prefix) |
| `@keel-engine/particles` | the smart pool (`pool.saveBytes()` / `loadBytes()`), the proof-of-concept pool (`saveBytes` / `loadBytes`) | `PARTICLE_POOL`, `PARTICLES` | `save()` / `load()` as before |
| `@keel-engine/world` | snapshots (`world.snapshotBytes()` / `restoreBytes()`): restore exact, as the JSON path | `WORLD_SNAPSHOT` | `snapshot()` / `restore()` as before |
| `@keel-engine/audio` | music (`musicRecipe`, `storeMusic(recipe or plan)`, `loadMusic(bytes)` tells a recipe from a song by the header), sfx settings (`createSfx(t, { settings })`, `bodySfx(sfx, { settings, materialOf })`: gain, rate, pan, jitter per sound; surfaces by material; events) | `MUSIC_RECIPE`, `SONG`, `SFX_SETTINGS` | plans and options as before |
| `@keel-engine/bake` | populations as hybrid records (`recordOf` / `recordBytes` / `populationOf` / `unitOf` / `recordPrefix`) | `HYBRID_POPULATION` (+ `VOXELS`, `OBJECT` parts) | `POPULATION` for a population written out whole |
| `@keel-engine/runtime` | -- | `ModuleContext.modules()`: every defined module's manifest, so `keel/codec`'s `setup(ctx)` registers their `contents.schemas` at load | |
| `@keel-engine/keel` | -- | the build attaches `schemaEntry` for every named schema a package's `src/schemas.ts` exports (and a module may read another's manifest, `<package>/module`, as data) | |

Bake's cache keys stay strings: keying looks by canonical `LOOK` bytes was
measured and lost (54-63 ms against 21-22 ms for 30,000 looks; core's
signature is already made).

## Solidity

`solidityDecoder(schema, { name })` writes a library for the fixed-layout
subset -- structs, tuples and fixed-length arrays of `uint`, `int`, `bool`,
`enum` (a Solidity enum when the values are identifiers) and width-coded
`fixed()` (as its step count) -- with `decode(bytes)` for bodies and
`decodeDocument(bytes)` for "id" documents (it checks the schema id). Every
offset is known at generation, so it is straight-line code: one `mload` and two
shifts a field. Anything without a fixed offset (strings, arrays of any length,
optional fields, Golomb-coded numbers) is refused, naming the field.
`node packages/codec/tools/solidity-check.ts` generates one, encodes values and
runs `forge test --offline` on it (5 passing, ~11.5k gas a 10-field decode).

## Tests

`node --test packages/codec/test/*.test.ts` (42 tests, ~3 s):

- `codec.test.ts` -- the bit stream at every alignment; **10,000 random
  schemas × values**: exact round-trip, canonical bytes, the schema through its
  own bytes (same id, same encoding), the JSON view through text, explainBits
  tiling every tenth; canonical key/map order and defaults; decoders refusing
  non-canonical data; exact widths; decimals; shared tables; LZ; error messages
  (paths, reasons, bit offsets); headers, registry, self-describing documents;
  manifests; the Solidity generator.
- `evolve.test.ts` -- old reader / new data and new reader / old data through
  three versions (nested, with strings), enum and union growth, every
  incompatibility caught by path, decode across versions through the registry,
  explainBits over groups, unknown groups and the text section.
- `schemas.test.ts` -- every catalogue piece rebuilt through `defineObject` to
  the millimetre, WALLRUN courses baking the same physics boxes, 3,000 looks
  exactly, entity makes, a 400-unit population (bake's army fixture), world snapshots restored into a
  fresh world that runs on identically, a particle pool that steps the same,
  2,000 random scripts through bytecode and back, the VM against a tree
  reference, the engine schemas through a registry.
- `audio-schemas.test.ts` -- audio's vocabulary, game-mood and band recipes
  with pins, 120 NOCTURNES tokens (with pins; skipped when
  `../keel-nocturnes` isn't there), songs JSON-equal (generated and edited
  by hand), sfx settings.
- `load.test.ts` -- `setup(ctx)` registering the engine's schemas and every
  module's embedded `contents.schemas` (idempotent; pending and bad entries).
- `speed.test.ts` -- MB/s, reported.

The hybrid records' own tests are bake's (`packages/bake/test/hybrid.test.ts`):
they need the generator and the packs.

## Dependencies

`dependencies`: `@keel-engine/runtime` (the manifest). `devDependencies`
(tests and tools): `@keel-engine/core`, `object`, `world`, `entity`,
`particles`, `audio`; the tools and tests also import other packages' test
fixtures by path (WALLRUN's course, the world's garden, the army's cast in
bake's `test/cast.ts`, and bake's `recordOf` for the size table).
