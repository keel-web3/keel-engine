# Native asset compiler v6

`@keel-engine/import/native-asset-compiler` and `compile:native-asset` now use v6.
Versioned v4 and v5 entry points remain available. Exact-data and appearance
modes retain the frozen v5 algorithm and payloads, described in NATIVE-V5.md.

The bounded-lossy path runs the original v4 geometry and texture decisions first.
It then removes unused fixed-material tangent/UV inputs and welds complete
identical corner records. It does not use the rejected pre-simplification variant.
The exact PNG transport pass changes only compression/container storage of the
already approved image samples. No additional triangle or pixel loss is added
by these postpasses. Existing sampled/error-limited v4 losses remain.

For the Tokyo 50% triangle target, 1% sampled geometry limit, and 512/Q65 preset:

| Pinned Brotli encoder | Original | Previous lossy | v6 lossy |
|---|---:|---:|---:|
| Node 1.2.0, quality11/window22 | 3,526,281 B | 1,850,323 B | 1,403,972 B |
| brotli-wasm3.0.1, quality11 | 3,526,891 B | 1,849,921 B | 1,405,776 B |

These are complete per-asset payloads; reusable runtime and licenses are shared
once. The browser-WASM measurement was executed from Node before live integration.
It is not a GPU test. No smaller-size guarantee applies to every possible input.

The accepted postpass preserves all 119,838 triangles and the exact previous v4
geometry/texture reports. Twenty-eight Tokyo and 68 Fox CPU views have identical
RGBA, coverage and depth to that v4 output. Independent checks also preserve
ordered corner bytes, interpolated normals/UVs, skin/morph data and animation.
Those inherited v4 losses do not become visually lossless because their storage
is smaller. The fixed-material restrictions from v5 still apply.

The recorded v6 conversion took 29.7 seconds, including about 6.1 seconds of PNG
candidate costing. Source/asset Brotli comparison took a separate 26.1 seconds.
Omitting `costCodec` retains the existing PNG representation and skips that
optional image-cost work; the lossless render-input postpass still runs.

```
node tools/compile-native-v6.mjs model.glb output --mode bounded-lossy \
  --target-ratio 0.5 --geometry-error 0.01 --texture-size 512 --texture-quality 65
```

The generated loader is shared across all modes. `makeNativeArchive` includes
the complete common decoder, four licenses, and the pinned Draco factory/WASM
only when the selected exact-data asset requires them. Archive size is a
secondary standalone-distribution metric, not the primary per-asset comparison.
