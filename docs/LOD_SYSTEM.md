# KEEL Engine — level of detail for generated worlds (`keel/lod`)

Status: design brief, 2026-09-18. Nothing here is implemented yet. First
customer: REDLINE's generated city (`keel-games/redline/game/src/citymode.ts`,
`game.ts`). Line references are to the tree as of this date. `packages/bake`,
`packages/city`, `packs/buildings` and `citymode.ts` are being edited in
parallel, so line numbers may have moved slightly.

The request, in the user's words: really tall buildings get clipped. Build a
smart mesh layer that picks what to show from the camera angle. Add a bigger
single mesh where the tops are. Draw anything far away or out of the way at a
lower scale, and save memory by making that one mesh of a less detailed
version of the same object. Everything is generated, so the algorithm must be
good, fast and optimised. The UI still needs a loader, and the loader can help
with this.

The short answer:

1. The "clipping" is three separate bugs with three causes (section 1). Two are
   fixed by one change: a **far pass** that draws the whole city at its coarse
   level, beyond the near pass's far plane. That far pass is the "bigger solo
   mesh where the tops are".
2. The city generator already makes **nested** levels of detail. Every solid
   carries `lod` 0/1/2, and a coarser level is an exact subset of a finer one
   (`architecture/src/world.ts:16`). If a block's triangles are sorted coarse
   to fine, **each LOD is a prefix of one index buffer**. The chain costs no
   extra memory, a switch between levels is an index count, and a cross-fade
   only dissolves the delta between two levels. That is the core of the design.
3. Pick the level by **screen-space error** measured from the eye's radial
   distance, so turning the camera never changes a level. Weight the error by
   **view angle**: rooftop kit is invisible from below the roofline, and wall
   signs are nearly invisible from straight above. Keep a hysteresis band and
   a short dwell time, and fade with the bayer screen the mesh pass already has
   (`mesh.ts:393`).
4. The loader is the same work queue the streamer uses, run with the frame
   budget's loading slice (`bake/src/budget.ts`: `loading: 40` ms). The first
   frame waits only for the whole-city coarse level plus full detail round the
   grid. The rest streams in during play.

---

## 1. Diagnosis: what "tall buildings clip" is in the current code

### 1.1 What is drawn today

- `citymode.ts:157 cityBuildings` gives each block **one** world:
  `blockWorld(b.plans, 0, 0)`. **LOD 0 is always used, everywhere.** Each block
  also gets its street layer (`blockWorld(b.plans, 0, 1)`), and the street kit
  comes in 200 m chunks (`:171`).
- `game.ts:343-347` uploads every block as a mesh with `IDENTITY` (the
  positions are world space) and appends it to `cityDraws`. `game.ts:611`
  pushes **every** city draw every frame. Nothing is streamed, no level is
  selected, and nothing is released until the next `prepare`.
- The mesh pass culls each draw by its whole-mesh box (`draw-mesh.ts:332`,
  `cull.ts:54`). That box is a whole block (median extent 146 m, max 180 m).
- The same set is drawn again from the sun (`draw-mesh.ts:354` fits the shadow
  box round **every visible draw**).

Measured with a scratch script over `generateCity` → `planCity`/`planStreets`
→ `blockWorld` → `lookMesh`, on seed `downtown-7` (other seeds agree within
about 20%):

| | blocks | buildings | tris LOD0 | tris LOD1 | tris LOD2 | tallest |
|---|---|---|---|---|---|---|
| buildings (layer 0) | 30 | 231 | 29,374 | ~20k | ~6.2k | 268 m (9 > 100 m) |
| street layer (layer 1 + street chunks) | 30 + 49 | — | 72–80k | 54.6k | 1.2k | — |

Other costs: the city is 1.35 km square. It takes about 100 ms to generate,
55 ms to plan and about 30 ms to mesh at LOD0. The vertex format is 52 bytes a
vertex (positions, normals, attrs x4, bodies, all f32) with **u32** indices.
That comes to roughly 2.5 MB for the buildings and 8.4 MB for the street layer.
The street furniture, not the towers, is most of the triangles. The biggest
single allocation is the **ground field** (`citymode.ts:101 cityField`): about
1446 x 1435 RGBA32F texels, around **33 MB** on the CPU and the same again on
the GPU.

### 1.2 Bug A: the chase and cockpit cameras can never show a tower's top

The car cameras project with `projectionOf(shot, W, H, SIGHT * 2)`
(`game.ts:600`, `SIGHT = 220` at `:56`). Under perspective, that `far` is
both the depth contract's range and the **hardware far plane**
(`project.ts:111`: `fz/fw` are built from `far`). The frustum's far plane
comes from the same matrix (`cull.ts:36`). Two facts combine:

- **The vertical FOV hides the top when a tower is near.** The chase eye is
  about 2.7 m up and tilted about 14° down (`camera/src/car.ts:109-110`). With
  `fov` 1.05 to 1.35 rad (`car.ts:88`), the top edge of the picture is 16° to
  24° above level. At 100 m that shows up to about 31 m of height. At 400 m it
  shows about 118 m. A 268 m tower only fits in the frame beyond about 800 m.
- **The far plane cuts it when it is far.** Anything more than 440 m of
  *forward distance* away is clipped by the hardware and culled by the frustum.
  The far plane is a **plane**, not a sphere. A tower 460 m away on the view
  axis is gone, but the same tower at 30° off-axis has a forward distance of
  398 m and is drawn. Turning the car sweeps the cut across the skyline, and as
  the speed FOV widens, towers pop in and out at the picture's edges.

So no distance exists where a tall tower is shown whole. That is the user's
"clipping via FOV". There is a second, quieter limit: the depth contract
(`project.ts:120-122`, and `vScene` at `mesh.ts:340`) saturates at `far / 2`
= 220 m. Everything between 220 and 440 m writes depth 1.0, so particles and
volumes composited with `contract: true` sort in front of it regardless of
distance. The comment at `game.ts:598` notes this for cars.

### 1.3 Bug B: the top-down view saturates depth on tall towers, and their faces show inside out

The spectator view passes a `PixelView`. The mesh pass turns it into an
orthographic projection with `far = max(W, H) / k * 4`
(`draw-mesh.ts:326`, and the ground does the same at `ground.ts:419`). With
the default `span = 320 / 16 = 20 m`, `far` is **80 m**. The orthographic
depth covers `fd ∈ [-far/2, +far/2]` about the view's centre
(`project.ts:101`). Under `PITCH = 0.62` rad (`game.ts:45`), a point `h`
metres up is `0.58·h` nearer along `forward`. So above about **55–69 m**
(depending on where it sits on screen) its depth is **below 0**.

The orthographic vertex path clamps rather than clips
(`mesh.ts:345: clamp(0.5 + fd / uDepthRange, 0, 1)`). Nothing is cut away,
but every fragment above that height writes the **same** depth, 0. Back faces
are not culled (`draw-mesh.ts: gl.disable(gl.CULL_FACE)`) and the depth test
is `LEQUAL`, so the **last face drawn wins**. `boxMesh` emits −y after +y and
−z after +z (`mesh.ts:89-97`), which means the underside and rear wall of a
tower's upper mass paint over its roof and front. Two towers overlapping on
screen also sort by draw order, not by distance. The result looks like the top
has been sliced open. Zooming in makes it worse: at `span = W / 96`
(`game.ts:416`, about 7.8 m at 420 px), towers over **21–27 m** break.

### 1.4 Not bugs (checked)

- **Culling by bounding box is correct.** `visible()` tests all eight corners
  of the box, and the box includes the top (`setMesh` computes it from every
  position, `draw-mesh.ts:307-308`). A tall building is never culled because
  its base is off-screen. At block granularity the test is *too
  conservative*: one visible tower keeps its whole 150 m block.
- **The near plane (0.05 m)** is fine for buildings. The chase camera has no
  collision, though, so a corner swing that puts the eye inside a wall shows
  the building from inside. That belongs to `keel/camera` and is listed in
  phase 4.

### 1.5 The fixes, in one paragraph

**Bug A:** split the scene into a **near pass** (as today, with `far` = 440 m
and the contract valid to 220 m) and a **far pass**. The far pass draws the
whole city at LOD2 through its own projection, with `near ≈ split − overlap`
and `far ≈` the city's diagonal (2–3 km). It is drawn first and writes
contract depth 1.0. The masses at LOD2 are the *same boxes* as at LOD0 (see
2.1), so the seam at the split plane cannot be seen. **Bug B:** give the
orthographic view a depth range that covers the scene's height:
`range = max(4·span, 2·(topY·sin(pitch) + span·cot(pitch)) + margin)`. Build
the `Projection` once a frame and hand the *same* one to `ground.draw` and
`drawMeshes`. Both already accept a `Projection` (`"clip" in view`), so this
needs no engine change.

---

## 2. The LOD design

### 2.1 The chain: generated, nested, prefix-ordered

The research doc (`redline/docs/research/CITY_BUILDINGS.md` §3.8) already
states the rule: **LOD = grammar depth**. A lower level is what the grammar
emits if it stops early. This is procedural LOD in the CGA-shape sense
([Müller et al. 2006](https://dl.acm.org/doi/10.1145/1141911.1141931)):
coarser levels are **regenerated from the recipe**, not decimated. The
generator already tags every solid (`architecture/src/types.ts: Lod`):

| level | contents (today's tags) | who emits it |
|---|---|---|
| 2 | the masses (podium, tower tiers, wings) with their **facade grid** (`addMass`, `grid: true`) | `massing.ts` (15 masses, 4 boxes and 1 capsule at lod 2), `roofs.ts` (3) |
| 1 | crowns, cornices, bands, big signs, LED strips, lamps and signals | `massing.ts` (10), `roofs.ts` (16+3), `signs.ts` (12), street furniture (16) |
| 0 | rooftop kit (HVAC, water towers), small signs, benches, bins, hydrants | `roofs.ts` (7), `signs.ts` (7), street furniture (20) |

Two properties make this cheap and let us skip mesh simplification entirely:

1. **Nesting.** `blockWorld(plans, lod)` keeps the solids with `s.lod >= lod`.
   LOD2 ⊂ LOD1 ⊂ LOD0, as exact boxes. There are no cracks, no T-junctions and
   no popping silhouettes where levels meet. A far-pass mass and a near-pass
   mass are bit-identical boxes.
2. **Windows are not geometry.** The facade grid is resolved per pixel in
   `MESH_GFS` (`mesh.ts:431-446`, `gridUv`). A LOD2 mass keeps its lit
   floors, warmth and night pattern. The "LOD1 = massing + window texture"
   level the brief asks for **already comes free** at LOD2. No texture atlas
   needs baking.

**Prefix layout.** Build each block's mesh in *three* runs, coarse first:
`[lod 2 solids][lod 1 solids][lod 0 solids]`, with the vertices in the same
order. Record the index and vertex counts at each boundary:

```
indices:  |---- L2 ----|------ L1 delta ------|-------- L0 delta --------|
          0           c2                     c1                         c0
draw LOD2 = drawElements(count = c2)
draw LOD1 = drawElements(count = c1)
draw LOD0 = drawElements(count = c0)
fade L1→L0 = draw(count = c1) solid + draw(offset = c1, count = c0 − c1) dithered
drop LOD0 from the GPU = re-upload the first v1 vertices / c1 indices (or regenerate)
```

One buffer holds the whole chain. The chain's memory cost equals LOD0's cost,
where a classic chain would store LOD0 + LOD1 + LOD2 (about +90% here). This
works today with `mergeMeshes([lookMesh(only2), lookMesh(only1), lookMesh(only0)],
{ bounds })` (`mesh.ts:151`), because `lookMesh` alone emits every box before
any capsule and would break the prefix.

**LOD3, the horizon band.** This applies only once a world extends past a few
km (neighbouring city cells, terrain). Render the far pass's LOD2 once into a
360° cylindrical strip from the cell's centre, palette-indexed (R8, for
example 4096 x 160, which is 640 KB). Draw it as a cylinder at the horizon
behind everything. It is the classic skyline card. **No per-building impostors.**
A box building at LOD2 is 24–60 triangles, around 2 KB of vertices, while an
octahedral impostor
([Brucks, shaderbits](https://shaderbits.com/blog/octahedral-impostors)) at
8 x 8 views of 32 px costs 64 KB of texels and resamples the pixel art, which
breaks its outline and palette. Impostors pay off for foliage-like, high-poly
things. They do not pay off for boxes.

### 2.2 HLOD: what gets merged, at what grain

Classic HLOD (Unreal:
[overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/hierarchical-level-of-detail-overview-in-unreal-engine),
[World Partition HLOD](https://dev.epicgames.com/documentation/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine);
Unity: [HLODSystem](https://github.com/Unity-Technologies/HLODSystem)) merges
clusters of meshes into a proxy with atlased textures, so a far cluster is one
draw. The city is partly there already, since a block is one mesh. The
hierarchy adds:

| node | grain | contents | drawn when |
|---|---|---|---|
| **cluster** | one building (a lot) | its index range inside the block buffer (prefix per level) | near ring, via multi-draw (2.6) |
| **block** | one block (today's mesh) | all its lots, prefix-ordered | near pass |
| **tile** | 4 x 4 over the city (~340 m) | the LOD2 of every block in it, merged | far pass (≤ 16 draws) |
| **band** | the city (or cell) | LOD3 horizon strip | past the far pass (multi-cell worlds only) |

A tile holds only the LOD2 prefixes: about 6.2k triangles for the whole city,
roughly 0.3 MB in the compact format of 2.8. It stays resident for the city's
life. The far pass never needs LOD0 or LOD1.

### 2.3 Selection: screen-space error, radial, angle-aware

Every level boundary carries a **geometric error** ε in metres, computed once
when the chain is built. It is the largest extent of any solid that the
coarser level drops (for L1→L2, the biggest crown or sign; for L0→L1, the
biggest rooftop unit or bench). That is the 3D Tiles meaning of
`geometricError`: the world-space size of what is missing
([Cesium forum](https://community.cesium.com/t/understanding-geometric-error/8480)).
Its pixel error ρ follows:

```
perspective:  ρ = ε · H / (2 · d · tanHalfFov)       d = RADIAL distance, eye → nearest point of the node's box
orthographic: ρ = ε · k                              (k = Projection.k, pixels a metre)
```

Choose the **coarsest** level whose ρ < τ. With τ = `chunk` px (1 by
default), anything smaller than a picture pixel is dropped. In the pixel style
that is exactly invisible, because it would be dithered away or would snap to
the neighbouring colour. `Projection` already carries `k`, `tanHalfFov`,
`height` and `origin`, so the selector needs nothing new from the renderer.

Two refinements make the selection smart rather than just distance-based:

**Radial distance, not forward distance.** Distance is measured to the
nearest point of the node's box, so turning the camera never changes a level.
Only moving does. This is the CDLOD argument for LOD as a function of true 3D
distance
([Strugar 2009](https://aggrobird.com/files/cdlod_latest.pdf)). It removes the
rotating pop that the planar far plane causes today.

**The view-angle term (the "smart layer").** Each dropped solid class carries a
*facing* tag: `roof` for things standing on a roof, `wall` for things mounted
on a facade, and `free` for everything else. The error becomes
`ε_eff = ε · vis(tag)`:

| tag | vis | why |
|---|---|---|
| `roof` | 0 if `eye.y < roofY − 0.5`; else `sin(elevation)` | from the street you are below the parapet, so an HVAC unit on a 120 m roof cannot be seen at any distance. Only the top-down view and tall ramps see roofs |
| `wall` | `max(0.2, cos(elevation))` | from straight above, a blade sign is a 0.3 m sliver |
| `free` | 1 | |

`elevation` is the angle between the eye→node ray and the ground plane. For a
typical downtown in the chase view, this drops most of the LOD0 roof kit on
**every** building, including the near ones, and it costs one comparison per
building. The top-down view does the reverse: it keeps roofs and drops small
wall signs. Three camera families come out of one formula:

- **Top-down (ortho, pitch 0.62):** ρ = ε·k is the same everywhere on screen,
  so the whole view shares one level. At the default k of about 37 px/m,
  everything visible is LOD0. The visible area is only about 20 x 11 m to
  140 x 79 m, so this is cheap. The fix that matters here is bug B.
- **Street level (chase, dash, hood):** radial SSE with `roof` vis 0. In
  practice LOD0 applies within about 60–80 m, LOD1 to the split, and the far
  pass beyond it.
- **Cockpit and mirror:** the same, using the viewport's *own* height (the
  mirror is a small window at fov 0.55, so its H is its box, not the screen).
  The mirror skips the far pass.

**Budget clamp.** After selection, if the frame's triangle estimate is over
budget, raise τ for the farthest nodes first (a greedy pass over nodes sorted
by d). The selector always ends within budget. This follows the Nanite idea of
choosing a cut in a hierarchy by error under a budget
([Karis et al., SIGGRAPH 2021](https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf)),
scaled down to three levels and a few hundred nodes.

**Cost.** About 30 blocks, about 230 clusters and 16 tiles make about 300
nodes a frame. Each costs a box distance, a multiply and a compare, which is
microseconds. Nothing here needs a spatial tree yet. A uniform grid over tile
indices covers cities 10x larger.

### 2.4 Hysteresis and dwell

- **A hysteresis band.** Switch coarser only when ρ < τ / 1.4, and finer when
  ρ > τ. For distance this means a ±~17% band round each boundary, so a car
  holding a steady line never flickers a level.
- **Dwell.** A node that has just switched holds for at least 0.3 s, unless ρ
  exceeds 2τ, in which case detail is plainly missing and it refines at once.
- **Refine first, coarsen late.** The switch is asymmetric. When refining, the
  finer delta fades in over the transition. When coarsening, the delta fades
  out after the dwell. Missing detail is the error the eye catches, and extra
  detail is not.

### 2.5 Transitions: a nested dither cross-fade

The mesh pass already has a screen-door fade: `MeshDraw.fade` discards
`bayer4(gl_FragCoord) >= fade` (`mesh.ts:393`). That is Unity's
`LOD_FADE_CROSSFADE` dither mode in pixel form
([Unity manual](https://docs.unity3d.com/6000.2/Documentation/Manual/lod/lod-transitions-lod-group.html)).
Two consequences of the nesting apply:

- **Only the delta fades.** Going from L1 to L0, the L1 prefix stays solid and
  only the range `[c1, c0)` is drawn with `fade = t`. No geometry is drawn
  twice, nothing z-fights, and the masses never shimmer.
- **Complementary screens where needed.** Swapping a block (near pass) for a
  tile (far pass) needs an A/B cross-fade. Add a one-bit `fadeInvert` so B
  discards `bayer4 < 1 − t` exactly where A keeps it. The two screens partition
  the pixels, so there is no double-draw and no gap. With the nested chain this
  case only arises at the near/far split, and there the overlap band can be
  handled by the planes instead (2.7).

The bayer screen has 16 levels. A 0.25 s transition at 60 fps is about 15
frames, one level each. The screen is anchored to `gl_FragCoord` (with
`ditherAnchor: "sprite"` it follows the draw's anchor, `draw-mesh.ts:94`). A
fading rooftop kit reads as the same dither the style already uses for glass
and shadows.

### 2.6 Draw calls: per-building selection inside one block buffer

Near a block, different lots can want different levels. For example, the
tower on the corner you are passing wants LOD0 while the far end of the block
wants LOD1. Clusters sit inside the block's buffer, and each cluster is itself
prefix-ordered (`[its L2][its L1][its L0]` concatenated lot by lot, the block
prefix built from those runs, 2.1). So "draw lot *i* at level *l*" is one
`(offset, count)` pair:

- **With `WEBGL_multi_draw`** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_multi_draw)),
  one `multiDrawElementsWEBGL` draws every lot of a block at its own level.
  That is one call per block. `gl_DrawID` indexes a small per-lot uniform
  array for the fade.
- **Without it**, fall back to whole-block selection: pick the level of the
  block's *nearest* lot. It is conservative and stays at one draw.

**Instancing.** Instancing does not help the city. Every building is unique,
because its recipe is unique. It does help the **street kit**. About 6,000
boxes of lamps, benches, bins and hydrants are copies of a few dozen designs,
and today each is baked into the chunk meshes as unique geometry, which makes
them 70–80k triangles and the biggest item on the mesh list. A second phase
turns street furniture into **instanced designs**: one mesh per kind and
district look, and an instance buffer of (x, z, yaw, scale) per chunk,
selected per instance by distance on the CPU. The memory falls from about
8 MB to kilobytes. That needs a `drawElementsInstanced` path in the mesh pass,
which today issues one `drawElements` per draw with a model uniform
(`draw-mesh.ts:431-443`). It is the single biggest memory win after the
ground field, and it belongs in phase 3.

### 2.7 The tops: a skyline from the street, as a far pass

This is the user's "bigger solo mesh object that can go where the tops are":

```
frame (street-level camera):
  1  ground + sky                           (as today)
  2  FAR PASS   projectionOf(shot, W, H, farRange, focal)
                near = split − overlap, far = city diagonal; draws = tiles (LOD2), shadows off,
                depth written as the contract's 1.0 (everything here is past the contract's reach)
  3  NEAR PASS  projectionOf(shot, W, H, SIGHT * 2) as today, clipped at `split`;
                draws = cars + near blocks at their selected levels + street kit
  4  glass, particles, HUD                  (as today)
```

- **Split.** `split = depthRange / 2` (220 m) is where the contract already
  saturates, so nothing valid is lost. Give the near pass a hardware far plane
  at `split + overlap`. That needs a `clipFar` apart from `depthRange` in
  `projectionOf` (a small, additive `project.ts` change). The far pass starts
  at `split − overlap`. In the overlap (about 10 m) both passes draw the same
  LOD2 boxes, and depth-tested in that order they agree. So a tower that
  straddles the split is one continuous tower.
- **Depth precision.** The far pass gets its own `near` of about 200 m, so a
  24-bit depth over 200 m–3 km resolves about 0.5 m or better. There is no
  need to widen one frustum to 0.05 m–3 km, which would resolve 2–3 m at
  1.5 km with LOD boxes z-fighting. Reverse-Z would help a single frustum, but
  WebGL2 needs `EXT_clip_control` for it
  ([Khronos](https://registry.khronos.org/webgl/extensions/EXT_clip_control/)),
  and the split makes that unnecessary.
- **Pixel style at distance.** The far pass can draw its tiles with
  `chunk: 2`. The existing per-draw pixel size (`MeshDraw.chunk`,
  `draw-mesh.ts:65-75`) gives the distant skyline chunkier pixels, which reads
  as atmospheric distance in pixel art. It can also use `light < 1`, which
  dims toward the sky ramp, as dithered haze. This is the brief's "rendered at
  the lower scale". Note that `chunk` coarsens the *look*, not the
  rasterisation cost. A real fill-rate saving (far pass into a half-size
  G-buffer, upsampled on composite) belongs in phase 4, once the frame graph
  in `SHADER_SYSTEM.md` can own the extra target.
- **Shadows come back.** The sun's box is fitted to the near pass only
  (`sunView`), not to 440 m of city. The same 1024² map then covers about
  4–8x less area, so cars get sharper shadows for free.
- **What the far pass costs.** One more G-buffer clear, a fullscreen paint and
  a bloom pass at pixel-art resolution (for example 747 x 420). That is well
  under a millisecond on a laptop GPU, plus ≤ 16 draws of about 6k triangles
  in total.

### 2.8 Memory

| item | today | plan |
|---|---|---|
| vertex format | 52 B/vertex (pos, normal, attrs, bodies: all f32), u32 indices | **20 B/vertex**: pos f32x3 (12), normal as face id + slot + part packed u8x4 (4), uv f16x2 (4). Bodies are dropped for city meshes (their paints don't use body space; this needs checking against `districtPaint`). **u16 indices** per block (a block is < 65k vertices: the max today is 3.4k triangles) |
| chain storage | one LOD0 mesh a block | the same bytes, holding all three levels (prefix, 2.1) |
| residency | everything, for the race | LOD2 tiles are always resident (~0.3 MB). A block's full buffer is resident while it is inside `residentRadius` (split + 30%). Outside it, truncate to its L1 prefix, and past 2·split drop it (the tiles stand in). Regenerating costs about 1 ms a block (the whole city meshes in about 30 ms), so no CPU copy is kept, only the plans |
| street kit | about 8 MB unique | instanced (2.6): kilobytes |
| ground field | RGBA32F, about 33 MB CPU + 33 MB GPU | RGBA16F (16 MB) or split: signed distance f16, everything else as packed u8 (8–12 MB). Drop the CPU copy after upload (keel/road owns the source) |
| budget | none | a byte budget per device class, taken from the per-pixel rule in MDN's WebGL guidance ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)): budget = pixels × a per-pixel constant. The residency LRU evicts the farthest blocks first. Note that WebGL may keep a CPU shadow of element buffers for bounds checks (same page), which is one more reason for u16 indices |

### 2.9 Budget for a downtown

Measured means the scratch measurement above. Est. means an estimate from the
measurements, to be confirmed by phase 1's stats.

| | resident tris | tris drawn / frame (street cam) | city draws / frame | GPU MB (meshes) | GPU MB (ground) | skyline |
|---|---|---|---|---|---|---|
| **today** (measured, `downtown-7`) | ~105k (all LOD0) | up to ~105k in a 440 m frustum | ~105 (+ same in shadow pass) | ~11 | ~33 | cut at 440 m, planar |
| **phase 1** (far pass + prefix chains) | ~105k + 6k tiles | est. 25–40k (near ≤ 220 m, roof kit dropped from below) + 6k far | est. 20–35 near + ≤ 16 far; shadow pass on near only | ~11 | ~33 | whole city, to ~3 km |
| **phase 2–3** (residency, compact format, instanced kit) | est. 20–35k | est. 20–35k | est. 15–25 + ≤ 16 | est. 1.5–3 | 8–16 | whole city |
| **research-doc target** (400 bldgs, LOD0 median 60 boxes ≈ 290k tris) | est. 60–90k within the resident radius | ≤ 120k (the doc's budget) | ≤ 60 | est. 4–6 | 8–16 | whole city |
| mobile target (S8-class) | ≤ 40k | ≤ 60k, τ = 2 px | ≤ 40 | ≤ 4 | ≤ 8 | tiles with `chunk: 2` |

---

## 3. Engine API sketch

### 3.1 Where it lives

Following `docs/CONVENTIONS.md`, there is one concern per package and one
`src/index.ts`, and `needs` must list every package that is imported:

- **`@keel-engine/lod` (new, `keel/lod`)**: pure and GL-free. It holds chain
  descriptors, SSE selection with hysteresis, the view-angle term, the cluster,
  block and tile hierarchy, and the **generation work queue** with progress.
  It needs `keel/core` only. It reads a view structurally (`LodView`), so
  keel/bake's `Projection` satisfies it without an import. It is
  deterministic: selection is presentation (Math is allowed), but the
  *generated* data (chains, ε, tiles) goes through dmath and is keyed by recipe.
- **`@keel-engine/architecture`** gains `lodChain(plans)`. It returns the
  three worlds (per-level runs) plus ε and the facing tags. It is a pure
  function of the plans, and it tags solids with `facing` where they are
  emitted (`roofs.ts` gives `roof`, `signs.ts` gives `wall`).
- **`@keel-engine/bake`** (the GPU side, which already owns meshes, culling and
  projections):
  - `layeredMesh(worlds, opts)`: a `LookMesh` plus `layers` (prefix counts).
  - `setMesh(key, mesh, { layers })`, and `MeshDraw.level?`, `MeshDraw.range?`,
    `MeshDraw.fadeInvert?`.
  - `projectionOf(..., { clipNear, clipFar })`, splitting the hardware planes
    from the contract's `depthRange`.
  - `orthoDepthRange(view, sceneTop)`, the bug B helper.
  - later, `drawElementsInstanced` and multi-draw paths.
- **`@keel-engine/ui`**: the loader, which is `generateLoading` (already there,
  `ui/src/generate.ts:428`) plus a `bindProgress(ui, queue)` helper.

### 3.2 Types

```ts
// @keel-engine/lod -- src/index.ts

/** What a view must offer (keel/bake's Projection has all of it). */
export interface LodView {
  readonly kind: "ortho" | "persp";
  readonly origin: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly k: number;            // ortho: pixels a metre
  readonly tanHalfFov: number;   // persp
  readonly height: number;       // the viewport's own height (a mirror passes its box)
}

export type Facing = "roof" | "wall" | "free";

/** One boundary in a chain: what the next-coarser level drops, and how big it is. */
export interface LodStep {
  readonly error: number;                 // metres (largest dropped extent)
  readonly facing: Facing;                // of the largest dropped solid (worst case)
  readonly roofY?: number;                // for "roof": the parapet the kit hides behind
}

/** A node of the hierarchy (a lot, a block, a tile): its box and its levels' prefix counts. */
export interface LodNode {
  readonly key: string;                   // recipe key: catalogue version | city seed | block | lot
  readonly lo: readonly [number, number, number];
  readonly hi: readonly [number, number, number];
  readonly levels: readonly number[];     // index count per level, finest first: [c0, c1, c2]
  readonly steps: readonly LodStep[];     // steps[i]: level i -> i + 1
  readonly parent?: string;               // block of a lot, tile of a block
}

export interface LodPolicy {
  readonly tau?: number;                  // pixels (default 1; the draw's chunk multiplies it)
  readonly band?: number;                 // hysteresis ratio (default 1.4)
  readonly dwell?: number;                // seconds (default 0.3)
  readonly fade?: number;                 // seconds (default 0.25)
  readonly triangles?: number;            // frame budget (default Infinity)
}

/** A node's state this frame: its level, and the delta fading in or out. */
export interface LodPick {
  readonly key: string;
  readonly level: number;
  /** When fading: the other level and 0..1 of the delta drawn (dither). */
  readonly fading?: { readonly to: number; readonly t: number };
}

export interface LodSelector {
  /** Choose levels for this frame. `dt` in seconds (presentation time, not sim time). */
  select(view: LodView, nodes: readonly LodNode[], dt: number): readonly LodPick[];
  /** Triangles the last selection draws (before culling). */
  readonly triangles: number;
  reset(): void;
}

export function createLodSelector(policy?: LodPolicy): LodSelector;

/** The pixel error of a step from a view (exported for tests and tools). */
export function pixelError(view: LodView, node: LodNode, step: LodStep): number;
```

```ts
// @keel-engine/architecture -- additions

/** A block's plans as a prefix-ordered chain: per level the solids ONLY that level adds, coarse first. */
export function lodChain(plans: readonly BuildingPlan[], layer?: 0 | 1): {
  readonly runs: readonly [BakeWorld, BakeWorld, BakeWorld];   // [lod 2, +lod 1, +lod 0]
  readonly steps: readonly [LodStep, LodStep];                 // 0->1, 1->2
  readonly lots: readonly { key: string; runs: readonly [BakeWorld, BakeWorld, BakeWorld]; steps: readonly [LodStep, LodStep] }[];
};
```

```ts
// @keel-engine/bake -- additions (sketch)

/** Worlds as one mesh in order, with each run's end: the prefix counts a level draws. */
export function layeredMesh(runs: readonly BakeWorld[], opts?: LookMeshOptions & { compact?: boolean }): LookMesh & {
  readonly layers: readonly { readonly indices: number; readonly vertices: number }[];
};

export interface MeshDraw {
  // ...as today...
  /** Draw only the first `count` indices from `offset` (a level's prefix, or a lot's run). */
  readonly range?: readonly [offset: number, count: number];
  /** The complementary dither (A/B cross-fades): kept where a plain `fade` would discard. */
  readonly fadeInvert?: boolean;
}

export function projectionOf(shot: Shot, width: number, height: number, far?: number, focal?: number,
  clip?: { readonly near?: number; readonly far?: number }): Projection;

/** An orthographic depth range deep enough for the scene's tallest point (bug B). */
export function orthoDepthRange(view: PixelView, sceneTop: number, margin?: number): number;
```

### 3.3 Generator-friendly and deterministic

- **Keyed by recipe.** A chain's key is `catalogue.version | city.seed |
  block | lot`, the same key `planCity` already uses (`architecture/src/city.ts`).
  The same key always gives the same bytes, so a chain can be built on any
  frame, in any order, in a worker or on the main thread, and it comes out
  the same. The selector state (level, dwell, fade) is presentation only and
  is never hashed.
- **Lazy per node.** A block's chain is generated the first time its node
  enters `residentRadius`. A tile's LOD2 merge is generated at load, because
  it is cheap and always needed. The cache is `Map<key, {mesh, layers}>` with
  byte accounting, and eviction regenerates later.
- **Budgets count work, not time,** inside generation (CONVENTIONS: "a budget
  that bounds generation counts steps"). The *scheduler* decides how many
  steps fit in a frame from the frame budget. The generator itself never
  reads a clock.
- **Workers.** `generateCity`, `planCity`, `lodChain` and `layeredMesh` are
  pure TypeScript with no GL, so they can run in a Worker. The typed arrays
  come back as transferables at zero copy
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)).
  Only `setMesh` (`bufferData`) touches the main thread, and it runs from the
  same work queue under the frame budget.

### 3.4 How REDLINE would use it

```ts
// prepare(): the city, once
const chains = blocks.map((b) => ({ b, chain: lodChain(b.plans) }));
for (const { b, chain } of chains) {
  const m = layeredMesh(chain.runs, { compact: true });
  sr.setMesh(b.key, m);                                  // lazily, from the queue, in phase 2
  nodes.push({ key: b.key, ...boxOf(m), levels: countsOf(m.layers), steps: chain.steps });
}
const tiles = mergeTiles(chains, 4);                     // 4 x 4 LOD2 merges
for (const t of tiles) sr.setMesh(t.key, t.mesh);

// raceFrame(): the view, then the two passes
const near = projectionOf(shot, W, H, SIGHT * 2, undefined, { far: SPLIT + 10 });
const far = projectionOf(shot, W, H, SIGHT * 2, undefined, { near: SPLIT - 10, far: 3000 });
const picks = selector.select(near, nodes, dt);
ground.draw(near, gcars, race.time);
sr.drawMeshes(far, tileDraws, { ...style, shadows: false, lights: [] });
sr.drawMeshes(near, [...drawsOf(picks), ...carDraws], style);

// top-down: one projection deep enough for the tallest tower, shared by ground and meshes (bug B)
const top = projectionOf(shotOfView(topView), W, H, orthoDepthRange(topView, city.tallest));
```

---

## 4. The loader

### 4.1 What it waits for (and what it doesn't)

The first frame needs the start grid **correct**, but not the whole city at
full detail. The work queue runs coarse first, near first:

| stage | work | weight (est. from today's timings) | blocks first frame? |
|---|---|---|---|
| 1. city | `generateCity` (road graph, blocks, lots, districts) | 100 | yes |
| 2. road field | `cityField` into the ground texture (the 33 MB item: row bands, 64 rows a step) | 60 | yes |
| 3. plans | `planCity` + `planStreets`, per block | 55 | yes |
| 4. skyline | LOD2 of every block, merged into tiles, uploaded | 15 | yes: the far pass must be whole |
| 5. start ring | full chains of the blocks within `residentRadius` of the grid, uploaded | ~15 | yes |
| 6. cars and looks | today's `prepare` for the cars (look table, meshes) | measured (`meshMs`) | yes |
| 7. the rest | remaining blocks' chains and the street kit, **nearest the route first** | ~20 | **no**: streams during the countdown and the race |

Weights are in **work units** (for example boxes planned or meshed, and rows
of field), and they are known once the plans exist: box counts come from
`plans.solids.length`. Progress is `Σ done / Σ total` over stages 1–6. It
moves steadily and never jumps back, because stage 7 is outside the bar. The
existing `BakeQueue` (`bake/src/queue.ts`) has the shape needed (priorities,
per-design buckets, `take(n)`). The generation queue generalises its job type
from `SpriteJob` to `{ key, stage, cost, run(): void | Promise<void> }`, and
priority is `−distance to route` inside a stage.

### 4.2 Time slicing

- `createFrameBudget()` (`bake/src/budget.ts`) already has a **loading slice**
  (`loading: 40` ms) that keeps the loading screen animating and gives the
  rest to work. During play, the same queue gets `slice()` (0.75–6 ms,
  adaptive).
- Main-thread fallback: run jobs until the slice is spent, then yield with
  `scheduler.yield()` where available
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield),
  [Chrome](https://developer.chrome.com/blog/use-scheduler-yield)), or with a
  `MessageChannel` post as the fallback. A task over 50 ms is a long task
  ([web.dev](https://web.dev/articles/optimize-long-tasks)), and the 40 ms
  slice stays under that.
- The worker path, stages 1, 3, 4 and 7, runs in a Worker. The main thread
  only uploads, uploads are budgeted by bytes per frame (for example ≤ 2 MB),
  and the loading bar counts **uploaded** work, not generated work.
- Determinism: the same seed gives the same bytes whatever the slice sizes,
  because slicing only reorders pure jobs.

### 4.3 The screen

Use `generateLoading` (`ui/src/generate.ts:428`) with REDLINE's HUD theme
recipe (`hud/race-hud.ts:134`: `seed: "redline"`, `culture: "clean"`,
bevelled corners, caps, hue 250 / accent 38). It is the same generated pixel
UI as the race HUD: a segmented `loading.bar`, a `loading.status` line and a
spinner. Each frame, the game calls
`ui.set("loading.bar", { value: q.progress })` and
`ui.set("loading.status", { text: q.stageLabel })`. The labels are in the
game's voice: "Surveying the grid", "Pouring the streets", "Raising the
skyline", "Lighting the district", "Warming the tyres".

The loader can also carry a **preview**, which helps with LOD directly. As
soon as stage 4 lands, draw the far pass of the city behind the loading UI
from a slow orbit camera. That is the skyline at LOD2 (a few thousand
triangles), with the windows already lit by the facade grid. The player sees
the city appear coarse and fill in as the ring streams, using the same
nested-dither fade as in play. When stage 6 ends, the camera eases into the
chase position and the countdown starts. There is no hard cut, and the loader
becomes an intro.

---

## 5. Phased plan

**Phase 1: fix the clipping and move the far city to one cheap layer.** Small,
additive, with no format change.

1. Bug B (game only): in `raceFrame`, build the top-down `Projection` with
   `range = orthoDepthRange(topView, tallest)`. Write the helper inline in the
   game first (the math is in 1.5), and pass the same projection to
   `ground.draw` and `drawMeshes`. `tallest` comes from `BuildingPlan.height`.
2. `project.ts`: an optional `clip: { near, far }` for perspective, apart from
   `far` (the contract). The default is unchanged, so no pixel of an existing
   game moves.
3. `architecture`: `lodChain` (the three runs per block, ε per step). There is
   no facing tag yet.
4. REDLINE: build the **tiles**, 4 x 4 merges of each block's LOD2 run, and
   draw them in a far pass (`clip.near = 210`, `clip.far = 3000`,
   `shadows: false`, `chunk: 2`) before the near pass. Clip the near pass at
   `SPLIT + 10`. Only blocks whose box intersects the near frustum go to the
   near pass, at LOD0 as today.
5. Stats: log the triangles and draws per pass in `game.stats()`, next to
   `bodyStats`. The exit test: from the chase camera on the downtown route,
   the tallest tower is visible whole at 500 m to 1.5 km, and turning the car
   no longer sweeps a cut across the skyline. In the top-down view at every
   zoom, no tower shows an underside or rear wall through its roof.

This fixes both bugs. It removes about 70% of the city triangles from the
shadow pass, and shadows get 4–8x sharper. The far city costs about 6k
triangles and ≤ 16 draws.

**Phase 2: the nested chain and selection.** `layeredMesh` gives prefix
layouts. `@keel-engine/lod` gains the selector (radial SSE, hysteresis,
dwell) and nested fades (`MeshDraw.range`, delta-only dither). Facing tags
come in `roofs.ts` and `signs.ts`, with the view-angle term. The street layer
gets the same chain, which drops its LOD0 kit past about 60 m: 72k → about
55k at LOD1 and about 1.2k at LOD2. Exit test: street-cam triangles ≤ 40k on
`downtown-7`, and no visible pop in a recorded lap (a frame diff of a replay
with LOD on and off, over the whole lap, differs only in dithered fringes).

**Phase 3: memory.** The compact vertex format (20 B, u16 indices), residency
with an LRU byte budget, truncation to the L1 prefix and drop-and-regenerate,
instanced street kit, and a smaller ground field (RGBA16F or packed). The
loader's work queue is `@keel-engine/lod`'s, run in a Worker, with the
loading screen and preview (section 4). Exit test: resident mesh bytes ≤ 3 MB
and ground ≤ 16 MB for the demo city. Time to first frame is below the time
to generate the whole city today.

**Phase 4: scale.** `WEBGL_multi_draw` per-lot levels. Horizon occlusion for
street canyons: a 1D max-height horizon over screen columns, built front to
back from the plans' footprints and heights. Downs, Möller and Séquin report
80–90% of in-frustum objects culled when driving through a city
([I3D 2001](https://dl.acm.org/doi/10.1145/364338.364378)). This fits here
because the occluders (building masses) are known data and the camera is at
street level. GPU Hi-Z
([RasterGrid](https://www.rastergrid.com/blog/2010/10/hierarchical-z-map-based-occlusion-culling/))
is not worth its WebGL2 readback latency at a few hundred nodes. Phase 4 also
adds the LOD3 horizon band for multi-cell worlds, the far pass at half
resolution through the frame graph, and chase-camera collision against block
footprints (the near-plane-in-a-wall case in 1.4). A cluster DAG in the style
of meshoptimizer's `clusterlod.h`
([meshoptimizer](https://meshoptimizer.org/))
is **not** planned. It is for arbitrary dense meshes, and ours are boxes whose
coarse levels are regenerated from the recipe exactly.

---

## 6. Open questions

- **Body space on city paints.** Does any `districtPaint` or `streetPaint`
  slot paint in body space (`B.z & 65536`, `draw-mesh.ts:97`)? If none does,
  the compact format drops `bodies` (12 B/vertex). If some do, keep one byte of
  "which third of the block" instead.
- **The contract at the split.** Everything in the far pass writes depth 1.0.
  Particles beyond 220 m (smoke over a distant tower) will draw in front of
  it. That is today's behaviour, but the far pass makes more of it visible.
  If it matters, give the far pass its own contract segment (`0.99..1.0`).
  That is a `SHADER_SYSTEM.md` view chunk question.
- **Outline across the split.** The near pass outlines its silhouettes against
  the far pass as it does against the sky. This matches today, where
  everything is outlined against empty pixels, but it should be checked on a
  tower that straddles the split.
- **`chunk` on the far pass.** A fat pixel samples its cell's middle
  (`draw-mesh.ts:65-75`), so a thin LED strip on a far crown can fall between
  cells. The far pass is LOD2 only, with no strips, so this is probably fine.
  Confirm it visually.

---

## Sources

- Unreal HLOD: [overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/hierarchical-level-of-detail-overview-in-unreal-engine), [World Partition HLOD](https://dev.epicgames.com/documentation/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine)
- Unity HLOD: [Unity-Technologies/HLODSystem](https://github.com/Unity-Technologies/HLODSystem); LOD cross-fade: [Unity manual](https://docs.unity3d.com/6000.2/Documentation/Manual/lod/lod-transitions-lod-group.html)
- Octahedral impostors: [Ryan Brucks, shaderbits](https://shaderbits.com/blog/octahedral-impostors)
- Nanite: [Karis, Stubbe, Wihlidal, SIGGRAPH 2021](https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf)
- meshoptimizer / clusterlod: [meshoptimizer.org](https://meshoptimizer.org/)
- Procedural buildings (CGA shape): [Müller, Wonka et al. 2006](https://dl.acm.org/doi/10.1145/1141911.1141931)
- Screen-space error / geometric error: [Cesium forum](https://community.cesium.com/t/understanding-geometric-error/8480)
- CDLOD (distance-based LOD, morphing): [Strugar 2009](https://aggrobird.com/files/cdlod_latest.pdf)
- Urban occlusion: [Downs, Möller, Séquin 2001](https://dl.acm.org/doi/10.1145/364338.364378); [Wonka & Schmalstieg 1999](https://onlinelibrary.wiley.com/doi/10.1111/1467-8659.00327)
- Hi-Z occlusion culling: [RasterGrid](https://www.rastergrid.com/blog/2010/10/hierarchical-z-map-based-occlusion-culling/)
- WebGL: [best practices / VRAM budget](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices), [WEBGL_multi_draw](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_multi_draw), [EXT_clip_control](https://registry.khronos.org/webgl/extensions/EXT_clip_control/)
- Loading: [scheduler.yield (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield), [Chrome blog](https://developer.chrome.com/blog/use-scheduler-yield), [long tasks (web.dev)](https://web.dev/articles/optimize-long-tasks), [transferables (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
