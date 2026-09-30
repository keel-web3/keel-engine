# Deterministic native asset compiler v0.3

Deterministic asset import tooling. It emits executable KEEL native surface operations plus explicit exact residual attributes/images. Arbitrary models are not guaranteed to become smaller. No AI or model-name-specific rules run during conversion. The selected passes, version, settings, source error, and content validation travel in the manifest.

## Use

With the repository dependencies installed and Node 24:

```sh
node tools/compile-native-v3.mjs model.glb output
node tools/compile-native-v3.mjs model.glb output --mode bounded-lossy --max-relative-error 0.0002
node tools/compile-native-v3.mjs model.glb output --prefer-smaller
node tools/compile-native-v3.mjs models/model.gltf output --root . --dependency models/model.bin --dependency textures/base.png
```

The CLI checks standalone generated-program replay. Import `compileAsset`, `decodePackage`, and `makeNativeArchive` from `@keel-engine/import/native-asset-compiler-v3`, or the equivalent source module. These explicit tooling subpaths are separate from the on-chain runtime barrel, whose verified-module recipe cannot bundle npm dependencies outside its source root. `tools/build-native-v3.mjs` emits a browser ESM compiler and tree-shaken native replay decoder. Draco 1.5.7 is an import-time dependency supplied by the host, not needed to execute generated native code.

`compileAsset` takes `{files:[{name,data:Uint8Array}],entry,mode,dracoDecoder?,maxRelativeError?,maxAbsoluteError?,onProgress?}`. Relative error is multiplied by each base POSITION accessor's bounding-box diagonal; if both caps are present, the stricter cap applies. Only base positions may change in bounded mode. Normals, tangents, UVs, vertex colors, skin weights, joints, inverse binds, all animation samples, morph deltas, and scene metadata remain exact.

The default result contains `{packageBytes,program,manifest,preview,nativeScene}`. A generated program loads `asset-data.kap` beside it and calls `asset-decoder.mjs`; `await build()` returns native MeshData, full scene records, typed accessors, images, and a generated GLB. All three files count toward representation cost. `makeNativeArchive(result,{decoder,licenses})` is the authoritative complete deterministic download assembly and includes manifest, README, and all required licenses.

## Modes and selection

- Lossless means identical decoded typed accessor values/bit patterns and image RGBA/color metadata. Source GLB/glTF container layout and eligible PNG encoding bytes may change. Draco-decoded values are the source reference; this does not undo source quantization.
- Bounded loss applies only to base POSITION. Every changed vertex is measured after Float32 reconstruction against its original mesh-space position. This does not by itself bound transformed world-space, screen-space, or continuous animation error. An optional host `validateWorldError` hook may impose a sampled world-space cap; the manifest explicitly records this finite-sampling scope.
- `selection:'prefer-smaller'` additionally requires the actual `decoderBytes` and `licenses`. It compares zlib level 9 of the complete runnable native ZIP against the original single input file. If native is no smaller, the result is explicitly `original-preserved`, has `program:null`, retains original bytes, and exposes the native candidate separately for inspection. This is not a claim that the original data became procedural code. Multi-file no-growth selection is not inferred from unrelated folder files.
- PNG palette/blend rules preserve all decoded RGBA, including RGB under alpha zero. Unsupported color profiles, metadata/sample formats, and JPEG remain original image bytes. Texture reconstruction uses the engine PNG writer; the generated PNG may be larger before compression.

Required archive license names are `LICENSE-KEEL.txt`, `LICENSE-fflate.txt`, and `LICENSE-Draco-Apache-2.0.txt`. The Draco-derived octahedral reconstruction includes Apache-2.0 attribution. The generic native decoder includes every supported pass; shared-engine amortization is a separate metric, not a cold standalone saving.

## Supported pipeline

GLB/glTF 2.0 with supplied local resources and data URIs; sparse/interleaved accessors; primitive modes 0–6; multiple materials/meshes; custom typed attributes; skinning; all animation clips and glTF interpolation metadata; morph targets; and injected official Draco decoding. Unsupported extensions, unsafe/missing resources, unknown GLB chunks, unsupported Draco topology, and budgets fail explicitly. Conversion constructs real native surface objects, preserving extended attributes/materials/rig/morph/animation in scene records and the generated GLB.

Surface passes infer exact affine/grid/mirror coordinates and ordered contour/strip/mirror topology, with residual fallback. Exact attribute passes infer integer/rational Float32 lattices or octahedral normals and retain original-word patches when needed. Image rules infer palettes/blended rows. Fixed candidate ordering and measured costs determine selection. There is no global minimum guarantee.

The binary transport validates lengths, offsets, checksums, paths, and nesting. Replay preflights unique override targets, descriptor agreement, and a conservative aggregate 256 MiB decoded/intermediate budget before inflating. This is a logical allocation budget, not a promise about total JavaScript VM or renderer memory. Large inline buffers use linear validation rather than recursive regular expressions.

## Verification and costs

Run `node --test packages/import/test/*v3.test.ts`. The implementation is also checked against independent official glTF/Draco arrays and PNG pixel decoding. Repeated and fresh-process Node/browser-target ESM executions must match output bytes. Running a browser-target module in Node is not a GPU/browser-render verification.

Full native closure can remain larger than an already Draco/JPEG-compressed original, even when individual codec passes improve. Compare identical content and the same outer codec. Raw binary payload, generated GLB, full runnable closure, import-time decoder, and already-shared runtime sizes are different measurements and must not be silently substituted.
