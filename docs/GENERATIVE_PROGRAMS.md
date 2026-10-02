# Seeded generative programs (editor tooling)

`@keel-engine/builder/generative` interprets a small JSON language as native
builder operations. It is **not** a JavaScript sandbox. It cannot evaluate
source code, loop, import modules, access a file or URL, load an arbitrary pack,
or operate on an existing editor session. Every run creates a fresh session
with an empty attribute registry. The selected source, theme, and visual style
belong to the editor's prompting/preview metadata, not this geometry runtime.

The tooling-only subpath deliberately does not change the catalogue-pinned
`@keel-engine/builder` root entry, module manifest, or shipped bytes. It is not
implicitly provided by the on-chain `keel/builder` module. Hosts must explicitly
bundle/install this tooling entry and verify `GENERATIVE_RUNTIME_VERSION`.

## Author a program

```json
{
  "format": "keel-generative-program@1",
  "id": "forest-fox",
  "title": "Forest fox",
  "ops": [
    {
      "op": "character",
      "kind": "anthro",
      "species": "fox",
      "seed": { "$seed": true },
      "size": { "$range": [0.9, 1.2], "key": "height" }
    },
    { "op": "proportion", "name": "headR", "scale": { "$range": [1, 1.3], "key": "head" } },
    {
      "op": "part", "id": "crest", "shape": "capsule", "on": "head",
      "a": [0, 0.2, 0], "b": [0, { "$range": [0.5, 0.9], "key": "crest" }, 0],
      "r": 0.12, "role": "accent"
    },
    { "op": "target", "as": "entity", "id": "forest-fox" }
  ]
}
```

This makes an authored family of native capsule characters with varying
proportions, crests, and native catalogue traits. It does not replay a converted
source mesh. Primitive objects instead start with `new`, followed by `set`,
`box`, `sphere`, `line`, `group`, `origin`, `unit`, or `look`. Capsule characters
allow `pin`, `proportion`, and `part` (capsule, box, wedge). Optional `target`
must be last and match `object` or `entity`. No later reset is allowed.

Use `generativeProgramReference()` for a JSON prompt contract generated from
the supported native op table, full limits, species, choices, proportions,
bone/socket names, and a buildable example. The table's descriptions are the
native builder descriptions; this subpath's narrower rules take precedence.

### Seeded scalar expressions

- `{ "$range": [min, max], "key": "label" }`: bounded native floating draw
- `{ "$range": [min, max], "integer": true }`: inclusive integer draw;
  integer coordinates require `integer:true` and whole-number endpoints
- `{ "$pick": ["primary", "accent"], "key": "material" }`: choose one of
  1–32 literal scalars (no nested expressions, vectors, or operations)
- `{ "$seed": true }`: the derived native character seed, allowed only in
  `character.seed`; omission uses the same default

Expressions replace scalar fields or individual vector components. Kind,
shape, IDs, choice/proportion names, attachment sites, and target kind are
literal. Native `createRoll`, `deriveSeed`, and `stream` drive all randomness.
Each named key has its own stream. The same key uses the same draw and correlates
choices; unrelated operations cannot shift it. Unkeyed expressions use their
field path, so inserting/reordering operations can change unkeyed choices.

Character colour pins accept OKLCH vectors (`furColour`, `hairColour`) or
`outfitColour: { cloth, clothAlt, accent }`. Voxel `look` does not apply to
characters. Species-dependent ears/coat choices must be valid for every
possible species. Proportion edits replace a named rule on the base body;
repeating a scale does not compound it.

## APIs

```ts
import {
  GENERATIVE_RUNTIME_VERSION, validateGenerativeProgram,
  resolveGenerativeProgram, runGenerativeProgram, buildGenerativeProgram,
  serializeGenerativeRecipe, parseGenerativeRecipe,
} from "@keel-engine/builder/generative";

const validation = validateGenerativeProgram(program); // object or JSON string
const resolved = resolveGenerativeProgram(program, "my seed");
const result = buildGenerativeProgram(program, "my seed");
if (result.ok) {
  result.runtime; // keel-generative-runtime@1.0.0
  result.program; // validated, independently copied template
  result.seed; result.ops; result.budget;
  result.session; // fresh native builder session
  result.built.design?.pose("idle", 0); // native boxes and capsules
  result.built.design?.palette;
  // result.built.code is export text only; this runtime never executes it.
}
const saved = serializeGenerativeRecipe(program, "my seed");
const restored = parseGenerativeRecipe(saved);
```

Validation returns `{ok:true,runtime,program,budget}` or
`{ok:false,errors:[{path,message}]}`. Resolution adds `seed` and concrete `ops`.
Run adds `session`; build also adds the normal native `Built` result. Failures
never return a partially mutated session. These functions revalidate their
input, even if the caller previously validated it. No accepted-object branding
or trust-by-reference lets later mutations bypass validation.

`serializeGenerativeRecipe` throws `TypeError` for invalid input. The saved
recipe includes format `keel-generative-recipe@1`, the exact accepted program,
the user-facing seed, and `runtime: "keel-generative-runtime@1.0.0"`.
`parseGenerativeRecipe` rejects a missing/different runtime version. Retain the
program and seed rather than only a resolved mesh: rerolling needs the recipe.
Reproducibility is scoped to **program + seed + runtime version**. Runtime
interpretation, default, or native-output changes must bump the version. The
golden test pins both resolved choices and native character geometry.

## Pre-execution budgets

All scalar alternatives and range endpoints are type/domain checked before any
builder operation runs. Geometric interval bounds conservatively account for
every seed, including independent coordinate choices and sparse distant parts.

- 128 KiB program JSON, 16,384 nodes, 12 levels, 256-character strings, 128 ops
  including the implicit final target if one is omitted
- At most 32 pick alternatives, 32 roles, 16 group ops, 64 character part ops
- Voxel coordinates -64..64, including sphere and thick-line expansion
- 131,072 cumulative worst-case voxel visits; groups include lookup work
- 262,144 cells in the worst-case dense bounding volume, even for sparse input
- Voxel unit 0.001..0.25 m; sphere radius 0.1..32 and axis scales 0.1..4;
  thick-line radius 0..8
- Character size 0.05..4 m, proportion value 0.001..4 or scale 0.25..2
- Character part coordinates -4..4, radius/half-extents 0.001..2;
  wedge `lo` 0..0.98 and yaw ±6.283186
- OKLCH lightness 0..1, chroma 0..0.37, hue 0..360

JSON is copied through own data-property descriptors before interpretation;
getters, custom prototypes, hooks/functions, cycles, sparse arrays, nonfinite
numbers, unsupported fields, and prototype-polluting keys are rejected. There
is also a single-line/control-character guard on titles, because native pack
exports include them in a line comment as well as an escaped string. There
are no time-based randomness/work limits. Treat the entry as a bounded data
interpreter, not as a mechanism for running untrusted JavaScript objects/proxies.

The host still owns response-byte limits before JSON parsing, request timeouts,
worker termination, preview rendering limits, cancellation, and user approval
before accepting a new asset. This API does not replace the selected source or
publish/register the result. Native motion clips exist on character builds;
untrusted animation/auto-rig/registry operations are intentionally outside v1.
