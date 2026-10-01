# Raster sprites from imported models

This tooling-only mode bakes a selected glTF clip or rest pose into actual fixed-resolution RGBA frames. It discards the original 3D geometry, textures, rig, arbitrary camera and relighting. The output is an explicitly lossy `.keelasset` version 5, not a preview-only pixelation effect.

Use `compileRasterSourceAsset` from `@keel-engine/import/styled-asset-compiler` for new uploads. It accepts the normalizer's `files`, `entry` and optional `dracoDecoder`, plus:

- `resolution`: 32, 64, 128 or 256 pixels per square frame
- `paletteSize`: 8, 16, 32 or 64 global colors
- `clipIndex`: the source clip index, or `null` for the rest pose
- `fps`: target samples per second, 1–24; integral frame count preserves the source clip duration, and the report states the effective FPS
- `directions`: 1, 4 or 8 evenly spaced views
- `kind`: `pixel` or `dither`; `screen`: a real KEEL core screen ID
- Optional `azimuth`, `elevation`, `shading` (`unlit`/`diffuse`), `name`, and `onProgress`

`compileRasterStyledAsset` provides the same output starting from an already prepared native `packageBytes`. New raster uploads should avoid an unnecessary intermediate 3D compression pass.

The portable CPU renderer reuses the validated glTF normalizer, source geometry-pose evaluator and texture-transform handling. It draws triangle base/emissive color, vertex color and optional flat diffuse light with core glTF alpha rules. It supports node, skeletal and position-morph animation. Normal maps, full PBR, shadows, reflections and material animation are not reproduced. Transparent triangles use deterministic centroid sorting, so intersecting transparent surfaces can differ from a GPU. This is a named CPU rendering contract, not a claim of GPU parity.

One camera bound covers all sampled poses. Shared palettes avoid independently fitted color changes between frames. Real KEEL screens are applied at fixed stored texel coordinates. Alpha is exact relative to the rendered input frames; RGB palette reduction is measured. The codec compares complete serialized candidates: raw quantized RGBA, packed palette indices, changed rectangles with repeat/fill operations, and shared 8×8 tiles. It chooses the smallest complete KAP recipe under that bounded cost measure, with no global-minimum claim.

`importStyledAsset` returns `raster.frames`, dimensions, clip/view metadata and the saved style. Its `glb` is only a static first-frame card. Full animation lives in the version-5 asset and trusted runtime. `createRasterCanvasPlayer({canvas, asset})` draws the actual decoded pixels with `render({time, delta, direction})`, `seek`, `setDirection`, `play` and `dispose`. `createStyledAssetPlayer` also supports the raster asset through an unlit nearest-filtered Three.js sprite, with animation controls and disposal. The host installs this shared runtime once.

The compiler limits total frames to 256, decoded raster pixels to 16,777,216, posed-vertex work to 24 million, and instanced triangle/fragment work before expensive drawing. Oversized requests fail with an instruction to lower resolution, FPS or views. Files contain no executable uploads and no original model fallback. Existing version-1 through version-4 assets remain supported.

Measure the entire `.keelasset` with the same compressor as the source. Shared loader/runtime and licenses are a separate one-time cost. A sprite with one selected clip/view is not semantically equivalent to the source 3D model; size figures must state those settings.
