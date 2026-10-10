# Generated shader LOD

The live baker can prepare an analytic capsule tier directly from the same `BakeWorld` recipe as the full and polygon LOD meshes. KEEL prepares this representation automatically for eligible generated recipes, and its default camera policy selects only sufficiently dense adjacent runs. REDLINE opts out of analytic preparation/upload by default based on full-scene regressions; it independently enables the measured polygon shadow LOD path. It does not change generation seeds, accepted world frames, physics, entity identity, damage or UI.

```ts
import { prepareShaderMeshDetail } from '@keel-engine/bake';
const detail = prepareShaderMeshDetail(recipe.key, () => recipe.world(), holdMesh, 0.01);
renderer.drawMeshes(view, [{ ...detail, matrix, look }], { shaderLod: true });
```

`holdMesh` is the application's existing cache/refcount callback. The key identifies the exact geometry/pose, tessellation and paint bounds. Hold and release `detail.mesh`, `detail.lod.mesh` and `detail.lod.shader.mesh` together. Generation callbacks run only when the corresponding cache entry misses; do not generate replacement geometry in the frame loop.

## Automatic ownership

`lookMesh(world)` and `lookMeshSteps(world)` keep their original polygon buffers exactly and attach a worker-safe `shaderDetail` when the recipe qualifies. `layeredMesh` prepares from all runs and preserves the original run-order part IDs; range draws still use polygons. This reaches any procedural generator using these mesh APIs, without game-specific asset lists or separate refcount keys.

The renderer uploads one candidate for each held mesh key, shares it across all instances/looks, and releases its buffers when that key is replaced or removed. No recipe generation runs during camera selection. Geometry keys must still identify geometry accurately; differently generated wheels keep their unique detail instead of being forced onto one generic wheel. Repeated geometry already shares the existing cache.

Automatic preparation requires more than 75% triangle savings against the canonical mesh. Templates with at most 48 theoretical triangles per capsule are excluded: the low-poly bird fixture did not improve GPU time despite reducing triangles. Recipes dominated by inexpensive boxes retain polygons. Explicit `prepareShaderMeshDetail` remains available for a measured custom tier and uses the existing 25% selection threshold against the available polygon LOD.

Disable automatic preparation with `lookMesh(world, { shaderLod: false })`, or selection with `MeshStyle.shaderLod = false`. Preparation adds CPU work and buffers once; CPU submission is the per-frame JavaScript/WebGL work of issuing draws, uniforms and state changes. The latter is measured separately from GPU elapsed time. Identical capsule paint bounds avoid redundant per-draw uniform uploads, and transform validation avoids temporary array allocations.

## Automatic conversion and selection

The recipe compiler recognizes positive-radius finite capsules, including spheres. Eligible capsules become an oriented eight-vertex, twelve-triangle bounding prism. The fragment shader intersects the original capsule analytically (cylinder and end spheres), discards empty prism pixels and writes the actual surface depth, normal, material slot, part ID, surface coordinate and full-object paint coordinate. It has no raymarch loop and requires no downloaded image or texture atlas.

The compiler retains boxes, wedges and capsules whose analytic surface could deviate from the reference polygons by more than the requested local tolerance. `capsuleSurfaceError` bounds the reference tessellation's two circle sagittas; eligibility additionally reserves the Float32 endpoint, radius and reference-vertex rounding error, including recipes far from the origin. Selection additionally reserves Float32 model-input and world-transform rounding, so a small object translated to large world coordinates falls back when precision consumes the pixel budget. This is a geometric error bound; palette/UV/shading differences still need image review.

The renderer selects a resident analytic candidate only when all of these hold:

- `MeshStyle.shaderLod !== false`, and `lod !== false`. Default/`"auto"` selection additionally requires at least 4,096 available polygon triangles per draw and eight consecutive eligible draws to amortize program switches; explicit `true` is a measured override.
- It saves at least 25% of submitted triangles versus the polygon tier available in this view (or the full mesh).
- Conservative projected geometric error is below 0.25 picture pixels, including perspective depth, screen edges and model scale.
- A conservative projected object-size estimate is at most 24 picture pixels, limiting per-fragment work and visible shading changes.
- The transform is a finite, non-reflected similarity transform within the analytic solver's Float32 range (a transformed bounding diameter of 0.1 mm to 100 km). Float32-zero/subnormal radii retain polygons. Ranges, per-part poses, non-uniform scale, shear and near-plane crossings retain the existing representation.

Each camera selects independently. Missing candidates and a driver/compiler rejection fall back to the resident polygon/full mesh. The optional program compiles once when an eligible candidate is uploaded during preparation; a rejected program is not retried every frame. Its separate depth-writing program preserves the ordinary mesh program's early-depth opportunities. This moves compilation into the loader/preparation path. Driver first-use pipeline work is still a cold cost and remains a rollout gate.

Shadows use the original caster meshes independently of camera LOD. Original meshes and collision bodies remain resident under the existing lifetime owner. Shader candidates do not reduce the full mesh's resident memory. Automatic candidates add buffers owned by their canonical mesh; explicitly prepared candidates add a third cached key. `meshStats.shaderReduced` reports the camera's selected analytic draws, and `meshBytes` includes both additional endpoint buffers.

Do not pass the candidate alone as the canonical/shadow mesh, pose it per part, or merge/prefix it after preparation. Prepare from the combined recipe instead; `mergeMeshes` explicitly rejects analytic candidates because their paint bounds and endpoint payload require the recipe-aware path.

## Suitable generated content

Dense rounded detail (wheel assemblies, small spheres, rounded static props) is the implemented target. Large low-poly building boxes should retain their inexpensive raster geometry; their windows/facades already use shaders. Grass and REDLINE's region crowns already use procedural crossed-card shaders. Unknown triangle meshes, articulated pedestrians, arbitrary SDF conversion and multi-view baked impostors are not implemented by this API.

REDLINE integrates the tier across wheels, campaign/race/scrap rendering and website driving/garage rendering, but leaves preparation/upload off by default after complete street tests found regressions. Its target-policy wrapper forwards unchanged canonical KEEL geometry and suppresses unused candidates. Other KEEL games inherit the automatic path when their complete draw qualifies; each target still requires measurement. Set `globalThis.REDLINE_FLAGS.shaderLod = true` before construction to prepare/upload the experimental tier and force geometrically eligible detail for diagnostics. Remove the flag after preparation to test the automatic run policy. The default REDLINE path retains polygons and incurs no candidate GPU residency. No controls, physics, accepted actor membership or seed identity change.

The source is locally validated. Live deployment, sustained full-world driving and physical-phone acceptance are separate checks; the fixture does not establish those. Arbitrary triangle-only merged meshes do not retain recipe metadata and cannot gain a candidate unless prepared from their combined recipe. Per-part deformations and clipped/prefix ranges remain polygon draws.

## Repeatable GPU/image check

From `keel-games`, run:

```sh
node redline/game/tools/shader-lod-check.mjs --out=/absolute/path/to/evidence
```

The runner bundles a small fixture using KEEL's actual renderer, seeded REDLINE vehicle generator, shared wheel preparation, canonical car bodies/spinners, bird pose recipes and puller frames/wheels. It checks both converted assets and unchanged fallback assets. It writes source/bundle hashes, image comparisons, GPU timer samples (when available), CPU submission samples and renderer identity. The fixture checks near-view equality, far coverage, fog/lights, fades/shadows, portrait, zoom, orthographic, reflected-transform fallback and mixed-program occlusion. It is a focused rendering diagnostic, not a whole-game FPS or physical-phone acceptance test.

## Pooling and submission cost

Use `createMeshPool` to generate and upload shared geometry once while retaining a separate transform and look for each owner. `meshDetailReport` exposes candidate cost during preparation. Call `renderer.prepareMeshInstances()` during loading before opting into `MeshStyle.meshInstances: true`. Ordinary renderers compile no batching programs or instance storage. This independent adjacent-run path preserves unique looks, transforms, anchors and logical/seam IDs, and falls back for incompatible draws or rejected shaders. Its bounded table adds 24 KiB GPU residency plus 24 KiB CPU staging only when prepared. Busy polygon scenes can regress; REDLINE leaves batching off. Measure both CPU submission and GPU time before enabling it for a target scene. See [the agent optimization guide](OPTIMIZED_GAMES.md) for APIs, ownership and the evidence requirements.

The street diagnostic runs the actual procedural city, region, road raster, 24 generated cars, lights, foliage, shadow, bloom and reflection passes across several seeds and camera/viewport profiles:

```sh
node redline/game/tools/shader-lod-street-check.mjs --out=/absolute/path/to/evidence
```

This measures a reproducible complete render scene. It does not by itself establish gameplay simulation FPS, deployed website behavior or physical-phone acceptance.

## Independent shadow polygon LOD

`MeshStyle.shadowLod: true` selects an existing resident polygon LOD using the fitted orthographic light map, independently of the camera. It requires at least 25% triangle savings, less than a quarter shadow texel of displacement and less than one tenth of the minimum receiver depth bias. Bounds include Float32 local/model/world arithmetic. Original mesh bounds still fit the map and select the caster list; analytic proxies, per-part poses and ranges cannot replace original shadow geometry. The default engine style preserves original shadows. REDLINE enables the polygon path based on three seeded full-street diagnostics with zero changed pixels and lower GPU time across all twelve views. This is not a universal perceptual or FPS guarantee; validate each game's shadows and full frame.
