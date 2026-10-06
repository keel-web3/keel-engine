# Modular game builds

Choose engine features by their public entry points and named exports. A game
that needs seed arithmetic does not need a palette, GIF encoder, particle GPU
renderer or model importer. New tools must live behind an optional entry point.
Retain the broad package API for compatibility and intentional full-module use.
Do not mark whole packages as side-effect-free: the builder's legacy entry
registers its voxel style, and module setup registers schemas.

```ts
import { createRoll, normalizeSeed } from '@keel-engine/core/rng';
import { decodeRetroClipFrame } from '@keel-engine/codec/retro';
import { lookMesh } from '@keel-engine/bake/mesh';
import { loadPrimitiveModel } from '@keel-engine/builder/primitive-runtime';
import { createIndexedRenderer } from '@keel-engine/render/baker';
import { createCarAudio } from '@keel-engine/audio/car-runtime';
import { createUi } from '@keel-engine/ui/runtime';
```

The SDK mirrors these as `@keel/game-engine/core/rng`, `codec/retro`, etc. Run
`node packages/game-engine/scripts/link-engine-features.mjs` in the SDK to add
facades without rewriting existing files. Normal SDK engine linking also
generates these facades. KEEL dependency resolution maps exported feature paths
to their owning module, so existing module needs and API identities remain valid.

## Selected artifacts and size guards

```sh
node tools/build-features.mjs tools/profiles/seed-runtime.json out/seed-runtime
node --test packages/keel/test/features.test.ts
```

Profiles list exact named exports, gzip/Brotli budgets and forbidden source inputs.
The build checks actual runtime exports, then tree-shakes the real sources. It
fails before writing if an export is absent, dependencies include a forbidden
file, aliases collide or the compressed script exceeds its budget. The report
records surviving source files, selected APIs, raw/gzip/Brotli bytes and a SHA-256.
The CLI writes `.js`, `.js.gz`, `.js.br` and the report. Both compressed outputs
must reconstruct the exact JavaScript. Brotli uses quality 11 and window 22;
gzip uses level 9. These host compression settings do not run during gameplay.
Adding unused engine features therefore does not put them into this artifact.
Dependencies genuinely used by a selected feature are included and reported.

Local measurements on 2026-10-01, esbuild 0.25.9:

| Profile | Raw JS | Gzip | Brotli | What is included |
| --- | ---: | ---: | ---: | --- |
| seed-runtime | 2,236 | 1,173 | 1,063 | normalizeSeed, createRoll, stream, deriveSeed |
| retro-decoder | 2,550 | 1,179 | 1,086 | frame, clip and independently cached phase decoders |
| mesh-runtime | 20,955 | 9,218 | 8,316 | meshing, bounds and transforms; no renderer |
| primitive-model-runtime | 61,613 | 23,136 | 20,629 | legacy voxels and bounded repeated boxes; no generators/editor |
| indexed-baker | 25,603 | 9,726 | 8,894 | solid-to-index and height baking |
| full pixel renderer | 66,645 | 27,467 | 24,573 | createPixelRenderer with color, raster and FX support |

One `normalizeSeed` export from the narrow RNG path is 521 gzip bytes; the same
export through the broad core entry is 8,243 bytes because that entry reaches
initialization in unrelated dither code. Tests retain deterministic outputs and
enforce exclusion and size limits. This is a measured example, not a promise
that every entry shrinks by the same percentage.

These are browser artifacts. Native GB/GBC games use compiled C and tile data;
the TypeScript feature tool does not compile JavaScript into a Game Boy ROM.
Local feature artifacts do not carry chain receipts. A published feature
resource still needs the canonical verification shell, a pinned source build,
selected-chain receipts and read-back. The existing full verified module path
continues to export the complete module API; use a selected resource build when
the objective is a minimal game-specific artifact.

## Rendering and runtime boundaries

`render/baker` exports `createIndexedRenderer` for sprite baking. The full
renderer and this backend share their indexed drawing pass, shader program
linking and solid uploader. The smaller backend omits realtime color rendering,
FX, raster and target-profile setup. It supports indexed pixels, height pixels,
materials, world updates and target resizing. It omits the unused depth-readback
shader and retains targets when dimensions are unchanged. The full renderer
keeps its depth program and existing draw/readback order. The baking worker rejects color
jobs when a backend lacks a color renderer. Its profile forbids the omitted
implementations and caps gzip at 13,000 bytes and Brotli at 12,000 bytes.

`audio/car-runtime` keeps car synthesis and playback without unrelated battle
and SFX serialization. `ui/runtime` retains the existing drawing, layout,
controls and state APIs; `ui/records`, `ui/schemas` and `ui/import` provide
optional serialization and authoring. The broad entries retain their complete
APIs. `codec/hash`, `codec/runtime` and `codec/schemas/*` avoid registering every
schema when a caller only needs hashing or a specific format. Internal runtime
imports now choose their actual schema families.

`keel/compact-shaders` is a host tool used by the feature builder and REDLINE.
It compacts literal GLSL whitespace and comments without renaming identifiers
or changing token order. It preserves preprocessor lines, opaque interpolated
expressions and exact substring patches/assertions used to derive shader
variants. Shaders depending on `__LINE__` or `__FILE__` retain their source.
The shader source files stay readable; this pass changes compiled artifacts.

`codec/byte-columns` separates fixed-stride byte planes and applies reversible
modulo-256 deltas before general compression. It preserves Float32 bits, signed
zero and all index values. The enclosing asset schema supplies the stride and
length. REDLINE applies it to prepared fallback head buffers at build time;
its runtime restores the original buffers before creating meshes. An optional
signed-delta mode zigzags small negative byte differences before compression;
the legacy unsigned default remains byte-identical. The enclosing asset marks
which mode to decode.

Brotli bytes are a storage option for browser/onchain resources. Include the
decoder, glue and shell in a cold cost comparison, or identify the exact
reusable decoder resource. Native GB/GBC tile packets retain the bounded C
decoder described below; the browser Brotli sidecar is not a native ROM decoder.

## Construction and model conversion

`builder/construction` selects the smallest complete representation among the
existing voxel codec, source-derived repeated boxes, and a pinned generator
seed plus sparse edits. Unmodified examples are 44 bytes including the
checksum. A 36-model sample changes from 5,695 to 1,560 bytes (72.6% smaller)
and reconstructs the same voxels, metadata and groups. Changed models can keep
their edits; irregular models retain the old codec when it is smaller.

`storeModel` / `storeModelText` write the selected representation. `loadModel`
supports all choices and legacy KV1/KC1 bytes/text. The exported pack generator
uses this selection automatically. `loadPrimitiveModel` supports raw voxels and
box programs and refuses generator records; a game can omit all six generators
when it does not need them. Replay checks work limits, coordinates, generator
revision, pinned baseline and final reconstruction checksum. It never evaluates
uploaded JavaScript.

Voxel storage no longer imports the editor's op catalogue: `builder/storage`
provides the legacy loader separately. A local `loadVoxels` selection is 21,739
gzip bytes and the full construction loader is approximately 31KB. Include this
decoder increment in storage decisions: a small asset set may be cheaper as
raw voxels; a large collection can amortize a reused generator/decoder. The
primitive-only path avoids that generator increment.

`codec/procedural-buffer` shares the converter's exact Float32 run format with
other generators. It infers repeated or affine rows from the source bytes,
preserves literal exceptions, signed zero and NaN payloads, and accepts affine
reconstruction only when IEEE-754 bits match. Existing native asset payload
selection, geometry/texture passes and bounded inflation remain in place.

## Preparation algorithms and exact output

The synchronous and yielding mesh builders share typed-buffer finalization.
Face/capsule emitters reuse local position and normal scratch arrays that the
builder copies immediately; no shared scratch or additional cache is introduced.
The old and new paths matched 2,196 complete comparisons (838,901,176 bytes),
including bounds, UVs, material/part IDs, triangle order and yield points.
Host bounds preparation improved 11–20% across vehicle/building/entity corpora.
Full mesh timing was mixed and is not an overall frame-rate claim.

Procedural Float32 inference reuses scratch rows for rejected affine probes and
copies only accepted steps. Repeated-row decoding seeds one row and doubles
already copied extents with `copyWithin`. At approximately 256 KiB, a local
paired host benchmark measured 4.6–8.6x faster random inference and 8–40x faster
repeat decoding. Encoded bytes and validation are unchanged, including NaN
payloads and signed zero. Already affine inference was 0.012–0.069ms slower;
the isolated procedural decoder grows 45 gzip bytes.

Asset-buffer Adler-32 validation batches modulo operations in bounded 5,552-byte
chunks. Length limits, DEFLATE prevalidation and checksum rejection stay intact.
Paired host asset-decode cases improved 1.07–3.31x. These are model conversion,
baking and browser decode measurements, not Game Boy CPU or device FPS results.

Existing spatial algorithms were measured rather than replaced. District KD
queries matched a linear reference across 24,048 cases, including ties and
overflow/nonfinite inputs; large seeded cities reached depth 10 including null
leaves. The tree builds in O(n log² n), with typically sublinear queries and an
O(n) worst case. Builtin rigs have 20–21 bones and depth at most 7; their forward
kinematics remains iterative, with post-IK descendants recursive. Existing
visited-set traversals, bounded hash-grid storage and large-query fallback stay
in place. Custom cyclic or exceptionally deep rigs were not hardened here.

Evidence: `/Users/ravonus/dev/rictus/alchemy/build/optimization-pass3`.

## Game Boy assets

`import/gameboy-compiler` is an optional host compiler. It parses a real model
once, samples its mesh/rig/morph/TRS animation from eight coherent directions,
quantizes to a supplied RGB555 four-slot sprite palette with stable dithering,
and writes native 2bpp tile clips and independently cached motion phases.
Slot zero is transparent. This explicit 32px sprite lowering changes source
fidelity; tile compression after lowering is lossless.

`codec/retro` and `codec/native/keel_retro*.h` provide the matching bounded
host/native decode formats. A clip frame needs at most two reconstruction
buffers (512 tile bytes). The ROM fast path is for validated immutable packets;
received save/cache packets use the validating decoder. Cache eviction belongs
to the game and must preserve progression separately from replaceable artwork.

The optimized encoder searches previous occurrences of the current byte rather
than every distance. Across 18,176 CRUCIBLE frames it produced identical packets;
one local corpus pass changed from 5,446ms to 4,048ms (26% less encode time).
Decoder format, tile pixels and ROM gameplay are unchanged. This is host baking
throughput evidence, not a device FPS improvement or a newly flashed ROM.

## Adding a feature

Keep host converters/editors behind dedicated subpaths. Import the narrow
dependency a feature actually uses; avoid importing its own index barrel.
Declare owning module dependencies, preserve setup/registration behavior, add a
profile with realistic headroom, and run its identity/exclusion/budget checks.
Use compressed total cost including decoding and dependencies when choosing
between literals, repeated primitives and generator recipes.

## Independently revisioned game scripts

`keel/modular-resources` is an optional Node build tool. It turns esbuild's
retained split output into classic-script factory resources with stable logical
identities. Imports are rewritten by their AST before CJS lowering, so an
imported body change does not rename the consumer's generated variables.
Factories register first; one final verified bootstrap starts the game. Cycles
and live getters use the normal CommonJS initialization cache. No uploaded
code is evaluated through `eval` or `Function`, and no runtime network loader
is introduced.

Pass explicit source roots, semantic entry IDs, dependencies, the transform
function, TypeScript parser, and compactor. Unknown source roots, dynamic
imports/requires, external imports, duplicate handles and missing resources
reject. Resource metadata records sources, interfaces, decoded digests and
bytes. `assertModuleRevision` requires identical handles, exports and dependency
interfaces and reports only changed byte streams. A compatibility change
requires an explicit migration; body fixes retain the existing handles.

CSS and HTML stay separate resources. Each resource's payload and stored/decoded
commitments occupy the same canonical SDK slot, so a patch replaces its own
commitments together with its bytes. Compress resources independently and
compare the complete shell, metadata and decoder cost. Many small modules can
cost more than a single archive: update isolation and total size are separate
measurements. This compiler does not publish, authorize edits or prove that a
selected token follows current revisions. That requires the revision-aware
consumer, permanent revision validation policy and selected-chain read-back.

Run `node --test packages/keel/test/modular-resources*.test.mjs` for independent
body updates, cycles, live bindings and rejection cases. These are host build
tests; they do not establish live chain publication.
