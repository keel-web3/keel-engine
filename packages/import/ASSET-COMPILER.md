# Deterministic asset compiler (experimental)

`@keel-engine/import/asset-compiler` exposes `compileAsset`, `decodePackage`, and `reconstructAsset`. It works in browsers and Node 22.18+ without an AI service. Give it a GLB, or a glTF and all local buffer/image dependencies. Every supplied resource is reconstructed byte-for-byte, including animations, skins, morph data, materials, image files, custom metadata, and opaque compressed extensions. It does not fetch external URLs.

```js
const result = await compileAsset({
  files: [{name: 'scene.glb', data: new Uint8Array(arrayBuffer)}],
  entry: 'scene.glb', mode: 'lossless'
});
const restored = await decodePackage(result.packageBytes);
```

The generated JavaScript program exports `recipe` and `build()`. Distribute it with `asset-decoder.mjs`. The recipe is an explicit list of scene-container segments and buffer-view reconstruction operations. Repeated segments reference one exact shared block. Eligible buffer operations compete against a raw fallback by deterministic encoded cost. They are source-derived; there are no asset-name checks, hidden model templates, network calls, or runtime AI.

This is a **lossless reconstruction foundation**, not the completed high-level generative-model compiler. It does not infer boxes, capsules, silhouette fills, or other semantic primitives. Residual mesh and compressed geometry data remain data and are identified as such. Required extensions remain exact but need a compatible renderer/decoder. Preservation does not imply that KEEL's existing renderer implements every glTF material or extension. Lossy/quality modes are rejected until implemented and validated.

The manifest reports selected operations, features, warnings, entry/resource hashes and decoder dependence. Its `packageBytes` counts the recipe only; include the shared decoder once when comparing a complete runnable download. A size improvement is not guaranteed, especially for already-compressed Draco/JPEG assets. The scene's own filenames and data determine recipes, except a standalone GLB's upload filename is normalized to `asset.glb`. Input-file ordering is canonicalized. Timestamps and execution timings never enter package bytes.

## CLI

```sh
node tools/compile-asset.mjs model.glb output-directory
node tools/compile-asset.mjs model.gltf output-directory model.bin texture.png
```

The CLI writes a reconstruction recipe, executable source, manifest and the exact restored files. A browser ESM bundle and standalone decoder can be built with esbuild from `packages/import/src/asset-compiler.ts`. `fflate` is pinned to 0.8.2.

## Limits and checks

- 256 MiB aggregate uploaded/decoded data and 4096 files
- Local relative URIs and data URIs; missing dependencies, network paths and root escapes reject
- GLB chunk bounds, buffer/accessor/sparse extents and encoded-payload checksums validate
- Exact SHA-256 and byte comparisons run after compilation
- Same input + compiler version + settings yields the same bytes
- Codec tests cover floating-point bit patterns, dictionaries, random inputs and corrupt/oversized streams
- Development regression fixtures use Fox and Littlest Tokyo, including all source animations; holdout validation is separate
