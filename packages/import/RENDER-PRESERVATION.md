# Experimental render-input preservation

The `./visual-asset-compiler` subpath adds `mode: 'visual-preservation'` without changing the frozen v4 default compiler. It is an experimental additional mode, not a claim that the below-original-size objective is solved.

The pass welds vertices only when every supplied per-corner attribute byte is equal, including UVs, normals, tangent handedness, colors, all joint/weight sets and all morph target streams. It preserves ordered triangles, primitive/material order, skin/animation records and images. Shared accessor users retain independent original storage. Narrower exact index types and a smaller replay runtime are separate candidates. Complete runnable ZIPs, including the chosen decoder and all licenses, are compared with deterministic zlib level9; candidate search is bounded to unchanged/welded geometry and full/core runtime.

```ts
import {compileAsset, makeNativeArchive} from '@keel-engine/import/visual-asset-compiler';
const support = {decoder, coreDecoder, licenses}; // exact distributed bytes
const result = await compileAsset({files, entry, mode:'visual-preservation', support, dracoDecoder});
const zip = makeNativeArchive(result, support);
```

`node tools/build-native-visual.mjs output` bundles the portable compiler, full decoder, optional core decoder and notices. The core decoder rejects packages requiring the meshoptimizer index decoder. `result.runtimeVariant` selects `asset-decoder-core.mjs` or `asset-decoder.mjs`; the archive helper installs the selected bytes as `asset-decoder.mjs`. `result.selection` records complete-archive costs and is diagnostic, not part of deterministic package bytes. No source-name or asset-specific branches are used.

## Rendering contract

The preservation argument applies to standard glTF vertex computation and a renderer that bases bounds on position extrema and submits/sorts the same draws. Corresponding vertex computations receive exactly the same attribute bytes, morph targets and uniforms, so the ordered triangle interpolation inputs remain equal. Vertex IDs, accessor IDs, raw buffer layout, picking identifiers, transform feedback, arbitrary topology-generated data and external application observers are outside this contract. A renderer averaging stored vertices for bounds can observe multiplicity; this mode does not promise compatibility with such custom behavior.

Opaque extensions and extras are retained, except string-only asset attribution fields `author`, `license`, `source`, `title`, `copyright`. Draws with unused vertices are retained to avoid changing bounds or transparency sorting. Normal-mapped draws without explicit tangents are retained because generated tangent behavior can depend on connectivity. Absent normals must use standard flat glTF normals. No triangles, hidden surfaces, interior parts, shadows, alpha layers, materials or animation channels are removed. Such removal needs its own visibility and shading proof.

## Evidence and remaining gap

The known Fox/Tokyo reconstructions passed exact ordered corner/pose checks and 56 finite CPU frames: 1,433,600 tested pixels with zero color, depth or coverage differences. The CPU renderer covers base-color texturing, alpha, depth and face culling. It is not a full PBR/GPU or all-camera/continuous-time conformance test. The available cloud browser reports a disabled WebGL context.

Complete Brotli11 sizes (one stream over the actual runnable archive, source identically compressed):

| Asset | Source | Experimental mode |
|---|---:|---:|
| Fox, all 3 clips |72,937 B|84,380 B|
| Littlest Tokyo |3,526,281 B|3,936,032 B|

Both remain larger than source. Fox welds 1,728→434 stored vertices, Tokyo 193,125→184,713, with all original triangles retained. Geometry candidate selection plus validation took about 3.74s/27.19s on the shared test machine; portable repeat testing under concurrent work was slower. These timings include candidate comparison, exclude download and host process startup, and are not guarantees.

Existing inference tests exact affine grids, repeated/mirrored coordinates, source-order triangle strips and planar contour fans. It keeps those operations only when their actual encoded cost wins. Arbitrary coplanar region retriangulation is not implemented: changing corner order or diagonal can change normal/UV/weight interpolation, and welding does not prove those fields affine. Interior removal is not justified by a few screenshots. The next larger opportunity is topology-conditioned attribute prediction or a field-preserving planar patch compiler; it should be chosen from component profiling, not assumed to beat the already-Draco source.
