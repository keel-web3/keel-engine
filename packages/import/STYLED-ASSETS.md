# Styled assets and compact lossy textures

The tooling entry `@keel-engine/import/styled-asset` imports the converter's
`.keelasset` files. It is deliberately separate from the verified/on-chain
`@keel-engine/import` module entry. This feature does not claim an on-chain
module ID or deployment, and does not add arbitrary glTF support to KEEL's
palette raster renderer.

## Data and replay

`createStyledAsset({packageBytes, style, name?, sourceBounds?, voxel?})` returns
compact binary bytes through KEEL's existing KAP container. The versioned
`KEEL-STYLED-ASSET` v2 envelope embeds native KAP bytes, their SHA-256 digest
and length, pinned dependency versions, and a style. Voxel output uses the
animated v4 envelope described in [ANIMATED-VOXELS.md](ANIMATED-VOXELS.md), or an explicitly selected static v3 snapshot. Versions 1–3 remain importable:

```ts
const style = {
  kind: 'dither', // original | pixel | dither | voxel
  pixelSize: 4,
  toneLevels: 8,
  screen: 'bayer4', // any of KEEL core's 13 screens
};
```

`importStyledAsset(bytes, {dracoDecoder?})` validates the envelope and replays
native KAP with the v6 shared runtime. It returns `glb`, `sourceGlb`, source
`nativeScene`, `style`, `animation`, `sourceBounds`, and `voxelMesh` when relevant.
Legacy v1/v2 voxel envelopes retain their source records; new v3 voxel envelopes
contain only the static reconstruction. Version 4 regenerates voxel geometry with original rig and TRS clips and resampled skin weights. The importer never evaluates an uploaded script, imports a URL from
the file, or executes code stored in the envelope. Dependency versions and
unknown top-level fields fail closed. SHA-256 detects corruption of embedded
native data; it is not an authenticity signature.

The canonical carrier stores `native.data` as a binary byte block, avoiding
base64 expansion. `styledAssetJson(bytes)` optionally emits readable JSON with
base64 KAP for inspection; both carriers are accepted by the same importer.
`isStyledAsset(bytes)` recognizes both forms and distinguishes them from an
ordinary native KAP file. Recognition is not validation; import still validates
the full schema, dependency versions and integrity.

Pixel and dither preserve the reconstructed geometry, skinning, morphs and
animation clips. Their colors are processed live after the host's scene
render, tone mapping and output color conversion. Pixel size determines the
low-resolution render target; output is enlarged with nearest sampling. Dither
uses KEEL core's actual screens through a 192×192 float32 tile with top-left
coordinates. Per-channel quantization is in sRGB, with alpha unassociated for
quantization and reassociated afterward.

Voxel input requires a `keel-static-voxel-style` version-1 recipe with occupied
grid indices, linear RGB colors, origin, size and unit. New exports use
`createVoxelStyledAsset({voxel, style?, name?, sourceBounds?, attribution?})`.
`createStyledAsset` delegates to it for voxel style, carrying the source glTF
asset attribution but discarding its original native KAP.

The v3 envelope stores occupied indices in their existing order, the grid
transform, and an exact Float32 palette or direct color field, whichever has
the smaller serialized recipe. It contains no source mesh, textures, rig or
animation, and requires no Draco decoder. Import regenerates colored cubes
through KEEL `meshData`, `addBox` and `writeGlb`; it does not reuse a saved GLB.
The generated GLB is byte-identical to the existing accepted cube snapshot.
At most 50,000 cubes and 1,000,000 grid cells are accepted. Small fidelity,
warning and optional source-pose metadata survive; unused source cell labels
and other construction metadata are omitted.

Voxel conversion is explicitly static and lossy relative to the original
model. It has zero animation clips and skins. `glb`, `reconstructedGlb`, the
compatibility alias `sourceGlb`, and `nativeScene` now describe only that
static reconstruction. The original model cannot be recovered from the v3
download. Attribution remains in the envelope. Pixel/Dither v2 asset bytes
are unchanged by this shared-runtime upgrade.

Optional `sourceBounds` is `{min:[x,y,z], max:[x,y,z]}` in source-world space.
It is only a static camera hint. It does not assert bounds over all animation
times. The player computes a Three Box3 when an imported model is available.

## Actual styled texture conversion

Use `@keel-engine/import/styled-asset-compiler` for the lossy data transformation:

```ts
const result = await compileStyledAsset({
  packageBytes: native.packageBytes,
  style: { kind: 'dither', pixelSize: 4, toneLevels: 8, screen: 'bayer4' },
  texture: { maxDimension: 256, paletteSize: 32 },
});
// These exact bytes carry the smaller styled model and are accepted by the
// same safe platform importer. No original selected color texture is retained.
const imported = await importStyledAsset(result.assetBytes);
```

This is always **stylized lossy conversion**, regardless of the native input's
compression mode. It replaces eligible base-color/emissive maps with an inferred
palette and packed indices or palette-pair/mix fields. The shared decoder
regenerates KEEL screen dithering when that representation is smaller than the
materialized index field. Selection compares serialized recipe bytes; compare
the entire downloaded `.keelasset` with the original using the same Brotli
encoder to judge the final transfer cost. Shared compiler/runtime cost is paid
once. No universal size win is promised.

Settings are 128/256/512 maximum texture edge and 8/16/32/64 requested colors.
Palette fitting and ties are deterministic. The chosen sampler becomes nearest
for changed color textures; existing wrap settings and other maps' samplers stay
intact. Normal, linear, mixed-use and unfamiliar material slots are retained,
with a reason in the report. Unknown PNG profiles/JPEG ICC metadata are skipped
conservatively. Geometry, skinning, morph and animation arrays are checked byte
for byte against the native input. Scene records outside the declared texture
sampling change are checked as well.

Center-nearest resize can lose thin alpha features. Alpha is exact only at the
resized texels; the report measures alpha changes and half-alpha coverage at the
original resolution. Palette error, nearest filtering and dithering are visible
style changes, not a no-visible-change claim.

The v2 `conversion` record states whether palette textures are present.
`reconstructedGlb` and the compatibility alias `sourceGlb` both contain the
**styled reconstruction**, not the original superseded textures. The download
cannot recover those discarded color images. `createStyledAsset` remains the
low-level envelope function and does not itself optimize textures.

## Host consumer

```ts
import { importStyledAsset, createStyledAssetPlayer }
  from '@keel-engine/import/styled-asset';

const asset = await importStyledAsset(bytes);
const player = await createStyledAssetPlayer({ THREE, GLTFLoader, renderer, asset });
player.play(0);
player.render(camera, { width: 800, height: 600, time: 0.5 });
```

The host supplies Three.js 0.180.0, its GLTFLoader, and a renderer. They are not
bundled into the engine import module. The trusted player parses the rebuilt
GLB, constructs the real scene, creates an AnimationMixer, and applies the
saved style on every draw. Three owns the full glTF material/skinning path;
KEEL owns native reconstruction, recipe validation, and screen maps.

The result exposes `scene`, `model`, `clips`, `mixer`, `bounds`, `play`, `seek`,
`setStyle`, `render`, and `dispose`. With no `scene` argument it creates a scene
with neutral hemisphere/directional lights. Pass the host's scene to retain its
lighting. The host may transform `model` for framing. `setStyle` permits changing
original/pixel/dither settings. A change into or out of voxel topology requires
a new import. `dispose` removes the model and releases its owned materials,
textures, geometry, render targets and animation mixer; the host renderer stays
owned by the host.

`makeStyledAssetArchive(bytes, {runtime, licenses, dracoFiles?})` packages an
adjacent-data fixed loader. Keep `asset.generated.mjs`, `asset.keelasset` and
`styled-asset-runtime.mjs` together. `build()` reconstructs data; `createPlayer`
creates the trusted host consumer. Include the supplied pinned Draco files for
KAP assets that need shared Draco replay. Three remains a pinned host dependency.

## Verification

```sh
node --test packages/import/test/styled-asset.test.ts
node tools/build-styled-asset.mjs styled-asset-dist
node tools/check-styled-player.mjs /path/to/three styled-player-check
```

The player check uses the real Three/GLTFLoader/AnimationMixer with a renderer
spy: it verifies scene loading, animated bone samples, render targets and style
uniforms. It does not verify GPU pixel output. The unit tests also check all 13
screen thresholds, malformed data rejection and independent voxel rebuilding.
