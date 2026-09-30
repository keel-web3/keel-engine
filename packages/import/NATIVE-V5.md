# Preserve rendered inputs with shared modules

v5 adds two deterministic, source-driven modes. The original upload is never
modified. There are no model names, special fixture parameters, AI calls, or
preconverted outputs in the compiler.

- `visual-preservation` is the default. For fixed standard glTF 2.0 materials,
  remove tangent inputs only when no normal map consumes them, and texture
  coordinate sets only when no material texture reads them. Unknown extensions,
  custom shader attributes, opaque metadata and matching morph targets are
  conservative skips. Full-record welding preserves ordered triangle corners.
- `lossless` retains every decoded source accessor value and its order. An
  already compressed Draco primitive can remain an explicit source codec instead
  of becoming a larger native residual. Its shared decoder is a one-time runtime
  dependency, listed in the manifest and included in standalone downloads.

Both modes keep triangle count, material definitions, rig hierarchy, skin weights,
animation, morph data and all consumed rendering inputs. Eligible PNG recipes
preserve decoded RGBA and color/transparency metadata. The scanline candidate
preserves its entire filtered sample stream and non-IDAT chunks; only inner PNG
compression changes. The existing palette candidate may change palette storage
while preserving decoded colors. JPEGs and unsupported profiles/formats retain
their original bytes. Nothing is resized or approximately quantized.

The appearance contract excludes a future material edit, custom shader hooks,
applications observing vertex/accessor IDs, and external code interpreting opaque
metadata. It is an algebraic consumed-input contract. Finite CPU comparisons do
not establish every GPU implementation's rendering behavior. Hidden surfaces
are never removed merely because sampled cameras do not see them.

## Use

```
node tools/compile-native-v5.mjs model.glb output --mode visual-preservation
node tools/compile-native-v5.mjs model.glb output-exact --mode lossless
```

For external glTF resources, add `--root directory --dependency file` for every
local dependency. The browser API exports `compileAsset`, `decodePackage` and
`makeNativeArchive` through `@keel-engine/import/native-asset-compiler-v5`.
Supply `costCodec: {id, compress}` using a pinned Brotli implementation at quality
11 to select exact PNG candidates. The encoder identity is recorded; different
implementations can produce slightly different costs. Without that capability,
the existing image representation is retained.

`decodePackage(bytes, {dracoDecoder})` accepts a reusable decoder injected by the
host. Standalone replay lazily loads adjacent `draco-factory.mjs` and
`draco_decoder_gltf.wasm` when required. The WASM is pinned and its hash verified.
All asset-specific instructions are in `asset-data.kap`. The generic generated
loader, native decoder, optional Draco code/WASM, and licenses are shared once.
The source storage-layout audit is not needed to render and is omitted from KAP;
required source scene metadata and attribution remain.

## Measured development fixtures

The following is one Brotli stream over each complete per-asset payload. Both
sides use Node Brotli 1.2.0, quality 11, window 22. Shared modules are separate.

| Asset | Original | Exact decoded data | Preserve appearance |
|---|---:|---:|---:|
| Fox, all three clips | 72,937 B | 66,084 B | 59,720 B |
| Littlest Tokyo | 3,526,281 B | 3,484,322 B | 3,097,952 B |

Tokyo appearance mode removes 71 unused tangent accessors. It retains 141,802
triangles, all clips and original image dimensions. On the recorded development
run its first conversion took 17.6 seconds, including about 8 seconds of image
candidate costing; whole-asset Brotli took another 27.1 seconds. Timings vary by
machine and are separated from replay and transport accounting. Same source,
settings and pinned implementation reproduce the asset bytes. These fixture
results are not a guarantee that every input compresses smaller.
