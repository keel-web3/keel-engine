# Building optimized games with KEEL

Read this when choosing a game's renderer, procedural asset pipeline, streaming or performance work. Optimize the canonical game and its generated objects. Geometry, entity identity, physical bodies and required visible content remain authoritative; a presentation budget never licenses deletion or replacement of valid actors. Keep the requested design and controls.

## Start with the bottleneck and target

Record the hardware/browser, viewport, camera, seeds, visible population and exact source/build hash. Measure preparation separately from the live loop. Record CPU submission, GPU elapsed time, frame median/p95, long tasks, geometry bytes, target bytes and draw submissions. A triangle decrease is an explanation of workload, not proof of FPS. CPU submission is JavaScript/WebGL work every frame; baking is load/cache-miss work. Frame cadence can be capped by refresh rate or dominated by simulation, fill work or another pass even when one mesh pass gets faster.

Use at least five alternating matched rounds after shader/pipeline warmup. Keep readback, screenshots, generation, DOM formatting and `gl.finish()` outside measured live frames. Reject disjoint GPU samples, baseline drift, missing content and compiler/GL errors. Record cold preparation and first-use separately. Compare normal gameplay with identical seeds, accepted inputs, camera and content, including close view, distance, zoom, landscape, portrait, shadows and effects. Test the actual intended device; a desktop portrait viewport is useful but is not phone proof. Check host load before heavy runs and use an authorized alternate machine when overloaded.

## Choose the representation deliberately

| Workload | Existing KEEL path | Selection and proof |
|---|---|---|
| Many units sharing shapes but differing colors/equipment | Indexed sprite baking, `createLookTable`, `LayerInstances`, `drawLayers` | Bake shape once; vary looks/layers. Sprite submissions are instanced. Preserve clip/direction/scale identity. |
| Live 3D procedural objects with dense rounded detail | `lookMesh` automatic analytic capsule detail | Original mesh is retained. Pixel-error, footprint, triangle-cost and transform guards select a shader candidate. Check images and GPU time. See [shader LOD](SHADER_LOD.md). |
| Close 3D objects or cheap low-poly boxes/wedges | Ordinary meshes, optionally `prepareMeshDetail` | Existing polygons often beat analytic fragment work. Quarter-pixel LOD error uses the actual camera, including zoom/aspect ratio. |
| Grass, reeds, bushes and crowns | `cardsMesh` and crossed-card procedural cutouts; indexed foliage where appropriate | The shadow pass shares the cutout. Check silhouette, distance, seasons and occlusion. More fragment work can outweigh fewer triangles. |
| Layered buildings and scenery | `layeredMesh`, `coarseLayerMesh`, `prefixMesh`, `@keel-engine/lod` | Generator supplies meaningful detail runs and geometric errors. Shared paint bounds keep facade/stripe coordinates aligned. Ranges and dithered transitions preserve level identity. |
| Repeated rigid geometry with differing transforms/looks | Shared mesh keys or `createMeshPool`; optional `MeshStyle.meshInstances` | Pool once. Instancing only joins compatible adjacent submissions, preserving order, IDs and seams. It never forces distinct generated geometry onto a generic prototype. Benchmark before enabling it for a scene. |
| Large worlds and expensive generation | Work-unit queues, `lookMeshSteps`, `layeredMeshSteps`, `createMeshWorker`, spatial grids and LOD streaming | Prepare off the frame loop, predict demand, keep required near content ready and reuse geometry. Bounded work is deterministic; render honest readiness while loading. Transfer buffers from workers. |
| Shadow geometry | `MeshStyle.shadowLod` and resident polygon LOD | Independently bounds displacement in the light map to a quarter texel and depth error to one tenth of the minimum receiver bias. Uses original bounds/caster membership; ranges/poses keep originals. Benchmark images and full-scene GPU time. |
| Invisible geometry and offscreen shadow casters | Frustum/range bounds and the renderer's independent shadow-view culling | Camera visibility and shadow visibility differ. Test occlusion and off-camera upstream casters. Posed bounds must use the current pose. |
| GPU cost dominated by effects | Bounded/cached bloom, existing reflection controls/masks, cached target workspaces | Profile the actual pass. Preserve appearance; choose tighter bounds/caches or measured equivalent algorithms. Dropping lights/effects is not an equivalent optimization. |
| Repeated procedural pixel work | Shared deterministic generated textures/atlases and look/material tables | Generate reusable data once rather than synthesizing it every fragment. Preserve seed, mapping, material and filtered-distance behavior. |
| Excess runtime download/parse cost | Feature imports and byte-budget profiles | Use narrow runtime entry points (`bake/mesh-pool`, `bake/mesh-detail`, `bake/shader-detail` for these preparation helpers), exclude authoring tools and verify compressed bytes plus actual exported APIs. See [modular builds](MODULAR_BUILDS.md). |

WASM/native code is an option for a measured CPU bottleneck; it is not an automatic upgrade. Include transfers, conversion, memory growth, compatibility and the full frame in the comparison. Do not confuse a standalone kernel benchmark with a shipped game speedup.

## Share geometry, preserve unique detail

A geometry key includes generator/recipe version, seed/pins that change solids, rest pose, tessellation and paint-space bounds. Paint/appearance belongs in the look table and draw record. Equal geometry keys share buffers across positions and looks. Different wheels keep their generated tread/rim/axle geometry. Reuse real generator modules or exact subparts when their recipe actually matches; do not erase unique parts merely to improve a draw count.

```ts
import { createMeshPool, lookMesh, meshDetailReport, meshMatrix } from '@keel-engine/bake/runtime';

const pool = createMeshPool((key, mesh) => renderer.setMesh(key, mesh));
const key = pool.acquire(design.key, () => lookMesh(design.pose('still', 0)));
// Each owner acquires its own reference; a cache hit never regenerates the recipe.
const sameGeometry = pool.acquire(design.key, () => lookMesh(design.pose('still', 0)));
renderer.drawMeshes(view, [
  { mesh: key, matrix: meshMatrix({ x: 0, z: 80 }), look: redLook },
  { mesh: sameGeometry, matrix: meshMatrix({ x: 2, z: 80 }), look: blueLook },
]);
pool.release(key);
pool.release(sameGeometry); // Final release also deletes this geometry's automatic shader buffers.
```

Use `meshDetailReport(mesh)` during preparation to inspect canonical/candidate triangles, vertices, bytes, error and eligible capsule count. These are preparation buffer sizes; GPU timing decides whether a candidate helps. The pool reports `preparedGeometryBytes` without retaining source arrays or claiming a live JavaScript heap measurement. `renderer.meshStats` exposes `meshBytes`, `instanceBytes`, logical `drawn`, camera geometry `submissions`, `instanced`, `triangles`, `shaderReduced`, `shadowReduced`, shadow triangles and target workspace bytes/pixels. These submission counters cover the G-buffer geometry pass; shadow and fullscreen/effect work must be profiled separately. Candidates add residency while preserving the reference. Release every acquisition, including duplicate keys; deduplicating releases leaks references.

## Defaults and overrides

Automatic capsule preparation is enabled for eligible recipes. Default selection (absent or `shaderLod: "auto"`) requires at least 4,096 triangles in the currently available polygon representation and runs of at least eight adjacent eligible camera draws to amortize program changes. The small spinner fixture saved little GPU time while increasing CPU submission; inexpensive polygons retain their existing path by default. Short mixed runs keep polygon LOD; `shaderLod: true` explicitly forces geometrically eligible detail and requires scene measurements. Crowded REDLINE testing found that forcing four shader wheels between ordinary car bodies could slow the full frame despite wheel-only savings. Low-resolution templates and mixtures dominated by cheap polygons are excluded. A scene/target can also set `createSpriteRenderer(canvas, { width, height, shaderLod: false })` to suppress automatic analytic uploads and programs. REDLINE defaults its generator and renderer target policy off because its crowded full scenes regressed; explicit development experiments remain available. Disable preparation through `lookMesh(world, { shaderLod: false })`; disable camera selection through `MeshStyle.shaderLod = false`. Disable camera mesh detail selection with `lod: false`; independent shadow selection uses `shadowLod`. Per-part deformations, unsupported transforms and ranges retain the existing representation unless the exact path explicitly supports them. Shader compiler failure falls back and is not retried per frame.

Instancing is an independent choice from analytic LOD: one reduces submissions, the other reduces geometry. `renderer.prepareMeshInstances()` compiles its optional programs and allocates bounded storage during loading; ordinary games pay none of this setup cost. Then `meshInstances: true` requests the compatible adjacent-run path. It preserves per-instance looks, transforms, anchors, logical IDs and seam IDs; ranges/poses and differing live emission, ownership, fade/wipe/weather state split runs. It does not sort across intervening geometry. The current implementation batches runs of at least four with bounded instance storage, and independently retains original shadow submissions. Require measured CPU/GPU benefit and image parity before adopting it for a target scene. A large polygon stress batch and the crowded REDLINE street regressed on ANGLE/Metal; batching remains off in REDLINE. Sharing geometry and reusing vertex bindings still apply without batching.

Shadow LOD is independent of camera and shader selection. `shadowLod: true` may use an already resident polygon tier; it allocates no new geometry and never puts analytic capsule proxies in the shadow pass. Its orthographic light-map error budget includes Float32 rounding. Close, posed, ranged, invalid and unprofitable replacements retain original casters. REDLINE enables this path after the actual 16-car game entry, in both orientations, showed identical matched images and about 5.8-6.0% less paired GPU time. The earlier street fixture omitted region draws because it passed a mesh object instead of its key; its historical timings do not establish complete-world performance. The diagnostic now submits the correct region keys. Test each target rather than copying this choice blindly.

Keep diagnostics/experiments outside production UI. A game should use proven defaults and sensible fallback behavior; creators need not learn shader internals to receive automatic detail. Agents need the reports and benchmark commands to make informed decisions.

## Delivery checks

1. Implement through public engine/generator APIs and stable recipe keys. Test deterministic geometry/paint/part identity, cache hits, lifecycle, compiler fallback and complete resource cleanup.
2. Compare baseline/candidate exact images for equivalent paths; for analytic detail also review projected silhouette/error and material differences. Preserve shadows, picking/IDs, occlusion and transitions.
3. Measure the full representative scene, both orientations, warm and cold costs, at several seeds and densities. Explain any memory or preparation tradeoff. Keep only changes whose CPU/GPU/frame evidence supports their intended use.
4. Run the game's shared-world and physical actor invariants when changing renderer/world integration. Rebuild the exact current source, smoke the actual candidate artifact, and verify the served artifact when releasing. Do not deploy a stale bundle over newer authority code.
5. Report source implementation, local artifact/runtime proof, live deployment and device acceptance separately. Do not declare an unrun gate passed.

REDLINE's focused GPU/image diagnostic is `node redline/game/tools/shader-lod-check.mjs --out=/absolute/path`; `--images-only` disables timing loops for correctness-only work. Its full generated street diagnostic is `node redline/game/tools/shader-lod-street-check.mjs --out=/absolute/path`. The actual game-entry/loop diagnostic is `node redline/game/tools/shader-lod-game-check.mjs --out=/absolute/path`; it distinguishes a live smoke/cadence sample from matched comparisons with simulation frozen. Its generated street-scene harness lives under `redline/game/tools/performance/`; use this to include ground, city/region, cars, shadows, lights, foliage, bloom and reflections instead of extrapolating wheel-only results. KEEL feature-build profiles live in `tools/profiles/`. Engine tests run directly with Node 22.18+.

The `mesh-optimization-runtime` byte-budget profile selects geometry, pooling, reporting and explicit shader preparation without the renderer, audio, importers or sprite/image exporters. The `bake-runtime` profile includes the public optimization APIs for complete live renderer builds. Its explicit budgets are 74,000 gzip and 61,000 Brotli bytes to account for the added analytic shader, pooling and batching code; report the measured increase against the previous source rather than implying those bytes are free. Do not raise a budget to conceal an accidental dependency.
