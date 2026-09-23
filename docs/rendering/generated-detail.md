# Generated detail: one seeded object, multiple representations

Generate the object's identity and shape once. Prepare cheaper representations from that same result. Choose what to draw from its projected size in the actual viewport; never reroll a seed or regenerate geometry while deciding detail.

| Object | Existing mechanism | What stays shared |
| --- | --- | --- |
| Curved rigid meshes, including wheels | `prepareMeshDetail` prepares full and tolerance-based capsule meshes; `MeshDraw.lod` selects per view | Material slots, part IDs, surface UV convention and full-object paint bounds |
| Buildings and ornaments | `layeredMesh` stores coarse solids first, with finer additions as index prefixes; `keel/lod` selects/fades ranges | One geometry allocation and one material assignment |
| Indexed sprites, including vegetation | `planBake` and `SpriteCache` key scale, direction, frame and style; `SpriteStream` supports a scale ladder, player priority, memory limits and queued preparation | Seeded design and indexed material interpretation |

REDLINE now uses the first mechanism for wheels in both race and website paths. The focused race car and website hero explicitly keep full geometry. Other wheels may switch only below a quarter-picture-pixel projected error. The full and reduced meshes are prepared and reference-counted together. The optional renderer `lod: false` flag supplies a full-geometry reference for benchmarks. Showroom close-ups naturally retain full detail.

The renderer computes a conservative perspective displacement using the nearest depth of the transformed bounding box, viewport height, vertical FOV and off-axis displacement. This includes non-uniform scale and shear. Orthographic error depends on its pixel scale. Every mirror evaluates its own view; there is no shared camera-history state. Near-plane crossings, index-range draws, per-part poses, missing replacements and non-finite error retain full geometry. A full-detail draw simply omits `lod`.

```ts
const detail = prepareMeshDetail(
  geometryKey,                    // include generator revision, geometry, pose, resolution and paint-space bounds
  () => design.pose("still", 0),
  holdMesh,                       // owner caches/refcounts; calls the factory only on a miss
  0.01,                           // local metres: capsule tessellation tolerance
);
// Hold and release BOTH detail.mesh and detail.lod.mesh.
draws.push({ ...detail, matrix, look });
```

The automatic approximation reduces capsule tessellation; it does not know which doors, text, signs or silhouette parts an artist considers important. Boxes and wedges remain intact. Use semantic detail groups through `layeredMesh` when omitting decoration is appropriate. Avoid generating duplicate coarse box-only meshes that save no work. Keep the same material lookup across levels; colour or decal changes should not recreate geometry.

REDLINE vegetation already has an 8/16/32/64 pixels-per-metre indexed sprite ladder with size limits. Its smallest sufficiently sharp available sprite is selected per tree. Keep that mechanism; use `SpriteStream` and `createStreamPump` when preparation needs to continue during play. A time budget is soft if one raster job exceeds it: break jobs down or measure a worker before claiming hitch-free preparation.

Bake view-independent ambient/contact terms separately from dynamic lighting. A bake cache identity must include generator/geometry revision and bake settings; geometry edits invalidate affected objects or tiles. Sun direction, headlights, brakes and weather stay live unless a measured far representation explicitly accounts for their changes. No fixed-lighting bitmap should silently replace a live near object.

For each new adapter, record generation time, extra resident bytes, submitted triangles/draws, GPU elapsed time and image differences. Test a hero close-up, a crowded scene, portrait resolution and a second camera. Lower triangle counts alone are not proof of faster frames. Preserve frozen source inputs and reject experiments that regress or remain inconclusive.
