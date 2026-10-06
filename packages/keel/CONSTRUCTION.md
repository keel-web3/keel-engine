# Exact construction and model graph planning

These host APIs emit ordinary JavaScript or select existing model packets. They are opt-in build tools; they add no interpreter to the game. Public primitive/generator APIs, standalone `storeModel` output policy, arithmetic precision, RNG streams, and model metadata stay unchanged.

## Primitive source compiler

`@keel-engine/keel/construction-compiler` exports `compilePrimitiveMacros`, `constructionCompilerPlugin`, `VEHICLE_SERVICE_PRIMITIVES`, and `CITY_TREE_PRIMITIVES`.

```ts
constructionCompilerPlugin({
  sources: [
    { fileName: servicePath, primitives: VEHICLE_SERVICE_PRIMITIVES, mode: 'reuse' },
    { fileName: treesPath, primitives: CITY_TREE_PRIMITIVES, mode: 'reuse' },
  ],
  report: (fileName, result) => recordTransform(fileName, result),
});
```

Place the compiler before source plugins that handle the same files. Use absolute file paths. Each source has one fixed mode, so a graph planner can rebuild with different mode profiles and price the entire emitted bundle, including generated helpers. Source-token savings only rank candidates; accept a mode only after full gzip/Brotli measurement and exact target parity. The compiler can increase final compressed size.

Descriptors assert a stable imported/module-const binding or immutable receiver method that is never a getter. `numeric` positions permit reuse only of proved stable primitive expressions. `inlineArrays` permits scalar tuple reconstruction only when the primitive does not observe allocation timing or object identity. Opaque expressions, getter/call evaluation order, original numeric trees, receiver `this`, and arrow return values remain intact. Arbitrary return-expression calls are retained unchanged.

Work is bounded by source bytes, syntax depth, calls, patterns, variants, and helper count. Malformed input, parser stack overflow, unsupported forms, and decoded generated-name collisions retain the exact source. Each plugin load reads current source; its cache holds one result per selected file and compares original content before reuse, including esbuild rebuilds.

## Model converter graph selection

`@keel-engine/builder` exposes `compileVoxelConstructionCandidates(model)`, which enumerates the existing raw voxel, primitive construction, and supported generator-provenance packets. Existing `compileVoxelConstruction` and `storeModel` retain their stable smallest raw-packet selection policy.

`@keel-engine/keel/model-plan` exports `planModelRepresentations` and `MODEL_RUNTIME_DEPENDENCIES`:

```ts
await planModelRepresentations({
  models: [{ id: 'tree', model: tree }, { id: 'critter', model: critter }],
  build: buildTargetGraph,
  objective: 'full',
  maxEvaluations: 32,
});
```

The mandatory target builder returns complete logical resources with identities, bytes, scope (`shared` or `creator`), compression, and `provides` capabilities. Include actual decoder/generator code, selected packet data, metadata, shell/header/license/bootstrap glue, and all target helpers. Bundle resources that are compressed together. Declare shared helpers once; shared generator cost is charged once across models. Custom `dependencies`/`requires` permit a target-specific closure.

The default helper identities are `model:voxels`, `model:construction` (requiring voxels), and `model:generator` (requiring construction). Every model asset and declared helper must appear in the builder's `provides` graph. The builder and custom dependency declarations are trusted target contracts: the planner cannot infer an omitted device decoder or undeclared shell.

The planner snapshots original voxel data, roles, groups, and metadata. Every candidate must replay through `loadModel` to the exact original `storeVoxels` packet before pricing. Packet hashes invalidate the bounded per-plan replay cache on mutation; final replay rejects callbacks that mutate selected packets. Optional target `validate` checks are additional to this mandatory host parity. Unsupported provenance remains on the existing raw/primitive fallback.

`full` counts all supplied resources. `creator` excludes shared resource bytes only when verified shared-engine reuse is available; this API does not register or publish an engine. For a cart or another target, the callback must supply that target's actual runtime/decoder and target replay checks. Host model equivalence alone does not prove browser, GPU, cartridge, or chain acceptance.


## Existing asset compiler CLI

The ordinary GLB/glTF lossless asset route remains the default. It preserves residual mesh bytes; voxel model representations cannot replace those exact source resources.

Use the optional browser model route for existing KC2/KC1/KV1 model packets, or fresh generator provenance:

```sh
node tools/compile-asset.mjs model.kc2 out/models --model-target browser
node tools/compile-asset.mjs tree out/tree --model-target browser --generator tree --seed 42 --compression brotli
node tools/compile-asset.mjs model-a.kc2 out/models model-b.kc2 --model-target browser --compression gzip
```

The browser route invokes `planModelRepresentations` with actual bundled decoder/generator code, embedded packet records and base64 reconstruction glue, target metadata, and the KEEL license. It prices shared runtime once, verifies emitted module reconstruction, and records both legacy packet-selection baseline and chosen full graph costs in `manifest.json`. The generated `model.generated.mjs` exports `build()`, which returns `[id, VoxelModel]` pairs; existing object/entity/pack conversion APIs can consume those models. Input basenames are model IDs and must be unique.

`--compression none` is the default. `gzip`/`brotli` write matching sidecars and price those resources for HTTP Content-Encoding with the browser's native decoder. The manifest lists required source and transport files; `manifest.json` is a diagnostic report that the generated module does not fetch. Uncompressed source copies and compressed sidecars are alternative transport representations, not cumulative runtime dependencies. This target does not claim a self-bootstrapping onchain Brotli decoder or a native Game Boy decoder; those require separate actual target build callbacks. The full objective charges every emitted required resource; the CLI does not assume deployed shared-engine reuse.
