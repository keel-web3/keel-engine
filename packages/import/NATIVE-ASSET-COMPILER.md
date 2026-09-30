> Legacy v0.2 API. See [v0.4](NATIVE-ASSET-COMPILER-V4.md) for the current native compiler.

# Native asset compiler v0.2 (experimental)

The upload compiler now constructs native KEEL `MeshData` surfaces and an extended scene IR. It does not retain a source GLB for playback. Its generated executable reconstructs coordinates/topology, restores all remaining typed accessors and exact image files, and exports a new GLB from those executed results.

```ts
import {compileNativeAsset} from '@keel-engine/import';
// Or import {compileAsset} from '@keel-engine/import/native-asset-compiler-v2'.
const result = await compileNativeAsset({
  files: [{name: 'model.glb', data: bytes}], entry: 'model.glb',
  mode: 'lossless',
  dracoDecoder, // Optional instantiated draco3dgltf 1.5.7 module, only for Draco input.
  onProgress: ({stage, done, total}) => console.log(stage, done, total)
});
```

## Implemented scope

- GLB/glTF 2.0, local resources and data URIs
- Indexed and unindexed geometry, source vertex/corner order retained
- Source-detected exact affine/grid coordinates, mirrored coordinate reuse, contour fills, strips and mirrored topology runs
- Deterministic serialized-cost selection against explicit residual geometry
- All typed attributes, including normals, tangents, UV sets, colors, joints, weights and morph targets
- Full scene hierarchy, source node transforms, materials, samplers, skins, inverse bind matrices and animation channels/keyframes/interpolation
- Draco triangles decoded once at import; no Draco dependency needed for the generated native replay
- Generated `build()` returns `{scene,accessors,images,glb}`; the scene contains real native meshes plus preserved extended attributes and scene records

The base `MeshData` type has fewer fields than glTF. Additional attributes, material features, morph targets and animation records are preserved in the extended scene IR and generated GLB; they are not silently discarded. This does not claim that every existing KEEL renderer implements every retained glTF feature.

## Lossless definition

Every reconstructed accessor byte, image byte and normalized scene record is checked against decoded source data. The new GLB is re-imported and checked again. For Draco, the reference is the original Draco decoder's output, including its existing quantization. Source-declared component types are retained, even when a reference loader would narrow index arrays. Original compressed container bytes and storage offsets may change. Original buffer/view layout metadata is retained in native-scene provenance.

Duplicate nondecreasing source animation times are retained and warned about, rather than sorted or deleted. Unsupported extensions, unknown GLB chunks and Draco triangle strips reject explicitly. Strictly lossy geometry fitting, error-budget controls and automatic rig inference are not implemented. Existing rigs are preserved.

## Determinism and size

No AI, asset-name branches or stored model templates run in conversion. Source bytes, fixed settings and compiler/dependency versions determine the reconstruction recipe and program. Timings are separate diagnostics. Candidate search may be expensive; progress stages are exposed. A smaller result is not guaranteed, particularly for already-compressed assets. Manifest operation counts distinguish constructed coordinates/topology from residual data.

Count the generated program **and** standalone `asset-decoder.mjs` once in runnable download comparisons. Include all licenses/manifest/readme in final delivered ZIP measurements. Shared visualization software is excluded equally from source and output. Import-only Draco JS/WASM cost is separate from replay cost.

## CLI/build

```sh
node tools/compile-native-asset.mjs model.glb output-directory
node tools/compile-native-asset.mjs model.gltf output-directory model.bin texture.png
node tools/build-native-asset-compiler.mjs native-asset-compiler-dist
```

The output includes executable source, standalone decoder, explicit reconstruction recipe, generated GLB, manifest and separate timing diagnostics. Node 22.18+ is required. Dependencies are pinned by the workspace lockfile; decoder data compression uses fflate 0.8.2 and Draco import uses draco3dgltf 1.5.7.
