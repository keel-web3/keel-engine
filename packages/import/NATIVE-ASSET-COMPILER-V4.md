# Deterministic native asset compiler v0.4

The native importer converts GLB/glTF geometry, materials, rigs, clips and morphs into executable KEEL surface operations and explicit residual data. Version 0.4 adds a bounded encoding search, exact source quantization rules, exact index-sequence compression, and separate lossy triangle and texture controls. It does not call an AI or select code by asset name.

## Run

Install the repository dependencies with the pinned pnpm version. The normal repository setup keeps keel-sdk beside keel-engine; see the root README.

```sh
npm run compile:native-asset -- model.glb output
npm run compile:native-asset -- model.glb output --mode bounded-lossy --target-ratio 0.5 --geometry-error 0.01 --texture-size 1024 --texture-quality 85
node tools/build-native-v4.mjs browser-compiler
```

For external glTF resources use `--root directory` and repeated `--dependency file` options. The CLI executes the generated program and verifies that its GLB matches the compiler's output. No repository push, chain publication or rendering deployment occurs during conversion.

Use `@keel-engine/import/native-asset-compiler` (current v4) or the explicit `native-asset-compiler-v4` subpath. The v2 and v3 subpaths remain available for existing experiments. Import tools are deliberately separate from the on-chain runtime barrel: that verified-module recipe rejects dependency paths outside its module source root.

```ts
const result = await compileAsset({
  files: [{name: 'model.glb', data: bytes}],
  entry: 'model.glb',
  mode: 'bounded-lossy',
  dracoDecoder, // supplied official draco3dgltf 1.5.7 module when required
  geometry: {targetRatio: 0.5, maxError: 0.01, samplesPerClip: 5, maxSurfaceSamples: 2048},
  textures: {maxDimension: 1024, quality: 85},
});
```

Lossless is the default. Bounded-lossy requires explicit geometry and/or texture settings through the API; omitted passes do not run. The CLI supplies the documented defaults for both passes when bounded-lossy is selected. Progress reports name the active phase. Diagnostic timings are separate from deterministic asset bytes.

The result contains `packageBytes`, `program`, `manifest`, `preview`, `nativeScene`, and `timings`. Keep `asset.generated.mjs`, `asset-data.kap`, and `asset-decoder.mjs` together. `await build()` reconstructs native MeshData plus complete scene records and an exported GLB. `makeNativeArchive(result,{decoder,licenses})` creates the complete deterministic runnable ZIP used for size comparisons.

## Lossless reconstruction

Every decoded accessor byte, vertex/index ordering, clip sample, skin weight, inverse bind and normalized scene record stays exact. Eligible PNG encoding may change while every RGBA byte and supported color metadata remains exact. Source container layout is not preserved. Draco's decoded values are the reference; source quantization is not undone.

Candidate operations include exact affine/grid coordinates, screened coordinate reuse/reflection, ordered planar contour fills and strips, and a residual fallback. Fixed-size sample screens select at most one additional buffer transform for full compression. A sample estimate cannot authorize a replacement: actual encoded cost must beat the fixed residual candidate.

For Draco inputs, source quantization parameters can become explicit integer/affine rules. Every reconstructed Float32 word is checked before selecting one. Octahedral normal rules are likewise checked exactly. Index sequence encoding preserves every index slot, unlike triangle codecs that can rotate corners. The complete meshoptimizer decoder/WASM is counted when shipped.

This is a hybrid constructive representation. Explicit residual coordinates, topology, attributes and images remain wherever inferred operations do not win. There is no claim of globally minimal code or universal compression improvement.

## Lossy geometry

`targetRatio` is a requested triangle fraction, not a guarantee. The meshoptimizer existing-vertex simplifier protects borders, material/attribute seams and degenerate triangles. Every retained vertex copies all its source attributes and morph deltas exactly. Shared accessors are isolated before remapping; animation, skeleton and material records remain unchanged.

Candidates are tested with deterministic bidirectional surface correspondences in the rest pose and finitely sampled clip poses. `maxError` is relative to each evaluated primitive's bounding-box diagonal; `maxAbsoluteError` can add a stricter absolute cap. Reports identify retained primitives and the reasons a requested reduction was unavailable. These checks are not continuous-animation, all-surface, silhouette or pixel guarantees.

No camera-dependent occlusion, hidden-component deletion or interior-face removal is assumed safe. Geometry that is invisible from one view can be visible from another view or pose. Lossless mode never removes triangles or unused source accessors.

## Lossy textures

The longest edge is bounded by `maxDimension`; `quality` sets JPEG quality. Color maps filter in linear light, linear PBR maps filter linearly, and normal maps are renormalized and checked after material normal scale. Alpha error and alpha-mask coverage are gated. All UV, sampler and material fields remain unchanged. Shared mixed-use images and unsupported metadata remain exact.

Pinned pure JavaScript codecs make emitted bytes deterministic. At most two candidates are considered per image. Candidates that cannot beat the current byte size are rejected before expensive full-resolution error evaluation. Selected candidates are decoded and reconstructed at every original source texel center; RGBA, alpha, normal angle and mask-coverage errors are reported. Texture byte reduction and pixel-dimension reduction are separate metrics.

## Runtime, packaging and verification

The encoder bundle needs import-time mesh simplification, JPEG/PNG codecs and Buffer compatibility. These are excluded from the generated replay runtime. `tools/build-native-v4.mjs` emits all applicable compiler notices and the four runtime licenses; the complete runnable archive counts program, data, decoder, manifest, README and licenses once.

The original-retention option belongs to v3. V4 returns the actual native reconstruction, even when it is larger, so a retained original cannot be mistaken for a compression win. Compare the complete native archive and the same-content original with the same outer compression. Raw binary size, compressed whole-archive size, generated GLB size and amortized shared-runtime size are different measurements.

Focused tests cover typed bit patterns, deterministic Node/browser-target bundles, exact indices, topology order, alpha and material-aware texture handling, morph/skin aliases, sampled deformations, sparse/accessor cases, large payloads and corruption/allocation bounds. The independent audit compares actual source and candidate arrays/pixels plus generated-program replay. A new external held-out model must be chosen after implementation/settings freeze. Browser-target execution in a sandbox is not a GPU-render parity test.
