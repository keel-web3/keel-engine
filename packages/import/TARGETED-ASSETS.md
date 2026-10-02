# Targeted conversion and shared runtime 7

These tooling APIs power the converter's Real 3D and Baked 2D outputs. They are
exported from `@keel-engine/import/styled-asset-compiler`; reconstruction and
players are exported from `@keel-engine/import/styled-asset`. They do not claim a
verified on-chain module or deployment.

## One-time conversion

- `compileForceTargetSourceAsset({files, entry, targetTriangles, ...})` applies a
  global **stored triangle** budget before optional Pixel/Dither conversion.
  Meshoptimizer reduction is followed by deterministic spatial pruning when
  necessary. Appearance may change arbitrarily. Retained vertex records and
  source animation samplers are preserved; an empty morph mesh can use a masked
  POINTS carrier to preserve its animation bindings. Instanced rendered triangle
  counts can exceed the stored count. Inspect `report.geometry` for requested
  and achieved counts, primitive results and warnings.
- `compilePixelModelSourceAsset` remains a genuine 3D path. Its optional
  `geometry: {policy: 'force-target', targetTriangles}` composes with palette
  textures; it is not a camera bake. Styled texture maximum dimension accepts
  integers 1 through 512. Palette size is 8, 16, 32 or 64. Ineligible normal,
  linear or unknown image uses are retained with reasons.
- `compileRasterSourceAsset` accepts exact positive integer `width` and
  `height`, including 1×1 and rectangular output. A pair overrides legacy square
  `resolution`. Original, Pixel and Dither styles use the chosen dimensions.
  The result retains the selected sampled clip/views, not the original 3D model.
- `compileAnimatedVoxelStyledAsset` accepts `budgetPolicy`, `voxels`,
  `maxCubes` and `memoryBudgetBytes`. Explicit `force-target` permits adaptive
  grid reduction and spatial selection to satisfy the cube budget. The default
  API policy remains `preserve-quality`, which never silently lowers a grid.
  `report.budget` records requested/achieved grid and cubes, memory estimates,
  and removed weight channels or empty clips. Transparency approximation still
  requires explicit opt-in. Morph displacement and skinning on retained cubes
  are approximations, not visual-preservation claims.

Raster preflight functions report frame/view counts, pixel work, memory
estimates and suggested adjustments. Conversion samples one pose at a time,
reuses repeated frames and encodes bounded chunks. `signal` cancellation and
progress callbacks are supported. Voxel work similarly uses sparse, bounded
selection. Compilation and codec selection happen once; shared replay does not
repeat this optimization search.

## Compatibility and host integration

The `.keelasset` envelope remains versioned. Existing raster v1 recipes retain
their runtime-5 dependencies. Chunked raster, Original raster and expanded
dimensions declare `runtime: 'keel-styled-asset-7.0.0'` and
`rasterCodec: 'keel-sprite-frames-v2'`. Expanded voxel recipes also declare
runtime 7 where older replay limits would reject them. Legacy v1–v5 envelopes
remain importable; morph voxel recipes retain their runtime-6 dependency.
Older installed runtimes must reject unsupported dependencies rather than show
a static first-frame card as if animation had loaded.

Install/build the trusted runtime once with `tools/build-styled-asset.mjs`.
Import the entire downloaded bytes with `importStyledAsset`. For chunked raster
output, `imported.raster.frames` is empty and `getFrame(index)` supplies a lazy,
bounded decoded chunk. Use `createRasterCanvasPlayer` or the trusted Three
player rather than assuming all frames are materialized. `rehydrateRasterAsset`
restores that lazy accessor after a trusted Worker structured clone: it validates
the envelope and full chunk directory, then validates each chunk's pixels on
first access. Normal `importStyledAsset` remains strict/eager validation.

SDK draft PR #10 forwards the compact package and reimports it in the preview,
which is compatible with the chunked path. An older SDK that forwards only the
first-frame GLB cannot play these files. Installing the engine runtime and the
SDK bridge are separate release steps; a hosted converter release does not
update an installed desktop platform.

## Size accounting and resource limits

Compare complete per-asset `.keelasset` bytes with the original using the same
codec/settings, including all recipe data, images, rig, selected animation and
metadata. Generic loader, decoder and required licenses are shared costs paid
once. Reducing triangles or pixels does not guarantee proportional byte savings;
other retained data and format overhead may dominate.

There is no fixed 256-frame or 16-million-total-clip-pixel ceiling. Physical and
format bounds remain: a configurable default 256 MiB working-memory budget,
65,535-pixel axes, 16,777,216 pixels per frame record, JavaScript addressing and
the outer binary container's 512 MiB limit. Disk spill and spatial frame tiling
are not implemented. Resource failures carry estimates and adjustments; callers
should preserve the previous completed result and allow retry or cancellation.

## Validation for this release

Focused tests cover 1×1, 2×2 and rectangular rasters; Original/Pixel/Dither hard
triangle targets; sparse cube budgets; malformed chunk data; repeat/archive
identity; lazy player seeking; and resource/cancellation behavior. Full engine
TypeScript passes. The full suite reports 1,484 passed, 76 skipped and two
failures: the pre-existing advertising catalog digest mismatch, and an unchanged
particle allocation assertion that passes when rerun alone. No converter test
failed. The aggregate suite is not green, so this remains a draft release until
the catalog/CI gates are reconciled.
