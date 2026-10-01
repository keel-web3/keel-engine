# Animated voxel assets

`compileAnimatedVoxelStyledAsset` in `src/styled-asset-compiler.ts` converts a native KAP into a declarative `.keelasset` version 4. `importStyledAsset` in the tooling-only runtime regenerates its cube mesh, skin attributes, original node hierarchy and all TRS clips. Uploaded files contain data; no uploaded JavaScript is evaluated.

```ts
const result = await compileAnimatedVoxelStyledAsset({
  packageBytes,
  voxels: 24,
  maxCubes: 12000,
  fill: 'none',
});
const asset = await importStyledAsset(result.assetBytes);
// asset.glb contains the animated voxel reconstruction
// asset.animation reports preserved clip and skin counts
```

The compiler samples every mesh node separately in its rest pose. It transfers the nearest source triangle's barycentric skin influences to each occupied cell, keeps up to four normalized influences, and maps cube corners back into the source skin's bind space. Rigid node animation uses the original owner node. Original inverse-bind and animation accessor values are retained without quantization. Source geometry and image payloads are removed. Each cube is reconstructed with the native `meshData`/`addBox` implementation.

This is a lossy geometric style. Cubes deform with blended skinning and gaps can appear. Color samples are opaque and do not reproduce PBR materials. A transparent or masked source requires `allowOpaqueApproximation: true`. Morph targets, weight animation, more than four source influence slots, unsupported node extensions and singular rest transforms produce explicit errors. They never silently become a still image. Static snapshots remain a separate version-3 option; `createStyledAsset` requires `staticPose: true` to discard clips from an animated source.

The default cube limit is 12,000 and the hard limit is 20,000. Resolution accepts 8–64 cells along the source's longest dimension. Multi-part scenes may hit the cube limit earlier because overlapping independently animated parts remain separate. Original duplicate key times are retained for compatibility with the source player; decreasing or nonfinite times are rejected.

Use the complete `assetBytes` for transfer measurements. `asset.generated.mjs` and `styled-asset-runtime.mjs` are shared code installed once. `makeStyledAssetArchive` includes the complete standalone loader and licenses for offline use. Version-4 voxel replay needs no Draco decoder because source encoded geometry has been replaced.

Validation covers rigid and skeletal clips, translated/scaled parents, LINEAR/STEP/CUBICSPLINE, malformed bindings and hierarchy, deterministic repeat, readable/binary replay and legacy version compatibility. Development examples Fox and Littlest Tokyo are external licensed inputs, not runtime special cases. Actual Three.js 0.180 playback tests compare source and voxel node matrices over 33 times per clip and verify that reconstructed vertices move. Cloud GPU rendering is not available, so this does not claim pixel equality or exact source-surface motion.
