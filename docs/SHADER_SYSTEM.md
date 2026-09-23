# KEEL Engine — the shader system (`keel/shader`)

Design brief, 2026-09-18. No source is changed by this document. It covers the
GLSL the engine and its first customer (REDLINE, `keel-games/redline`) have
today, what's duplicated and what hurts, and a design for a shared shader
system: a chunk format, a standard library, lights and materials on top of it,
how it fits the passes that exist now, and a migration plan whose first phase
is small enough to land in one go.

The rules of the engine stay as they are: WebGL2 and GLSL ES 3.00; the
simulation is deterministic and **rendering is presentation only** (nothing a
shader computes is ever read back into the sim); pixel art is the model
(palette ramps, dither screens, outlines, no alpha blending in the picture);
every package is a KEEL verified module, so its bytes, its vectors and its
catalog digest all move when its shader text moves.

---

## 1. What exists

### 1.1 Every GLSL program, by package

About 37 programs across 8 packages and the game. "Compile" names the helper
that builds it. Every package has its own.

| package / file | program(s) | stage inputs (main uniforms, attributes) | compile | notes |
| --- | --- | --- | --- | --- |
| **render** `shaders.ts` | `WORLD_FS` (+`FULLSCREEN_VS`) | `uRes uEye uFwd uRight uUp uTan uTime uBoxes/uWedges/uCaps`, UBOs `Boxes Wedges Capsules` (std140), `uMats` tex, `uSun uWaterY uFogNear uFogFar`; MRT `outData` (L, ramp, mat, id), `outData2` (glow, facing) | `pixel-renderer.ts program()` | raymarch pass 1. Has SDFs (`sdBox sdCap sdWedge`), sin-hash `hash/vnoise/fbm`, `tiles`, sun+shadow march, linear fog to 0.12. **Frozen: equal to the proof of concept character for character** (`test/poc-equality.test.ts`) |
| render `shaders.ts` | `POINTS_VS/FS` | `aPos aLook`; camera basis | same | particles as points into pass 1 |
| render `shaders.ts` | `PIXEL_FS` | `uData uData2 uDepth uPalette uRamps uScreenTex uScreen uDither uOutline uFog uGlow uVig uScan uCrt uRim uFlash uGrade uCycle …` | same | pass 2: ramp lookup, Bayer 2/4/8 + screen texture, outline, glow halo (golden-angle taps), rim, fog ramp, vignette, scanlines, CRT, palette cycling. Frozen too |
| render `raster.ts` | `RASTER_VS/FS`, `DEPTH_OUT_FS`, `DIRECT_PIXEL_FS` | instanced solids `aI0..aI3`; `uMats uEye uSun uFog*`; `DIRECT_PIXEL_FS` = `PIXEL_FS` + 4 `.replace()` edits guarded by a `throw` | same | RASTER_FS repeats `bayer4`, sin-hash `hash/vnoise`, `tiles`, adds `grain` and `strata`, same sun/fog formula as WORLD_FS |
| render `indexed.ts` | `BAKE_WORLD_FS`, `INDEX_FS`, `HEIGHT_FS`, `DEPTH_FS` | `BAKE_WORLD_FS` = `WORLD_FS` + 5 find/replace edits; `HEIGHT_FS` = `WORLD_FS.slice(0, "void main")` + its own main | same | bake time only |
| render `sky.ts` | sky | `uEye uFwd uRight uUp uTan uAspect uTime uCover uZenith uHorizon uDeck uTexel uWind uRamp uSeed` | its own `sh()` | integer `hashU` (core's), its own `vnoise/fbm`; writes `DIRECT_MAT` |
| **bake** `sprites.ts` | sprite `VS/FS`, `LAYER_VS`, `BILLBOARD_VS/FS`, `SWAY_FS`, `FX_VS/FS` | view basis `uCenter uRight uUp uForward uK uSize uDepthRange`; instanced layer data | its own `compile` + `link` (passed to the mesh pass as `deps.link`) | BILLBOARD/FX/SWAY are `LAYER_FS`/`LAYER_VS` with `.replace()` edits, each guarded by a `throw` |
| bake `paint-shader.ts` | `LAYER_FS` | `uPages uLooks uPaints uPalette uPlaces uDecals uScreen uDither uOutline uHeights uDS uK uSize uDepthRange uIds` | (by sprites) | the look painter: 13 screens (`screenAt` ids 1..13), `bayer`, sin-hash `hash12/vnoise`, patterns, decals, sheens, outline. Imports `SPRITE_DEPTH_GLSL` (depth.ts): the one existing "chunk" with a CPU twin |
| bake `mesh.ts` | `MESH_VS`, `MESH_GFS`, `MESH_SHADOW_FS` | `uModel uParts uPosed` view basis, `uProj uPersp uShadowMat`; lights as **uniform arrays** `uLightPos[16] uLightDir[16] uLightI[16] uLightTint[16] uLightOwner[16]`, `uSlotGlow[32]` | (deps.link) | G-buffer: `gA` (slot, L, uv), `gB` uvec4 (look, draw/part, scene depth, view depth), `gC` ivec4 (anchor, tint ramp + chunk, tint strength), `gD` (octahedral normal, body uv). The only point/spot light loop in the engine |
| bake `draw-mesh.ts` | `MESH_FS` (paint), `FULLSCREEN_VS` | `LAYER_FS` + 9 find/replace edits; adds `uGA..uGD uGap uMirrorAxes uMirrorK uTints[24] uChunkMax` | deps.link | reflections (48-step march in the picture), tint ramps from coloured lights |
| bake `bloom.ts` | `BLOOM_VS/FS` | `uGA uGB` (G-buffer), `uBloom` (per draw x slot table), `uReach uRows` | deps.link | premultiplied: lamp core replaces, halo is added, tail dithered. Only meshes can bloom |
| bake `volumes.ts` | `VOLUME_VS/FS` | `aCorner aPos aKind aRamp`; view basis, `uProj uPersp uTanH`; `uPalette uPaletteRow uSun uTime uDensity uScreen uSteps` | its own link | smoke / fire / dust / energy / glow puffs marched through `hash13` value noise, 2-octave fbm; lit **by the sun only**; dithered cover; writes the ground/view depth |
| **particles** `gpu.ts` | `PARTICLE_VS/FS`, `SCATTER_VS/FS` | `uT0..uT3` state textures, `uStyles`, view basis + `uPersp uEye uTan uClip uContract`; `uPalette` (256 a row), `uSprites` | its own `compile` | closed-form motion in the VS (`MOTION_GLSL`, CPU twin `pool.ts motionAt`); unlit; fade is Bayer density |
| **terrain** `ground-gpu-glsl.ts` | `GPU_VS`, `GPU_FS_ORTHO`, `GPU_FS_RESOLVE`, `GPU_FS_PERSP` | tile data `uTiles uTable uRamps`, ~40 scalar knobs | `ground-gpu.ts` own `compile/link` | 700 lines, a line-for-line port of the CPU ground baker: core's integer `hashU`, `vnoise2`, `fbm2` exactly (parity measured) |
| terrain `ground-gl.ts` | chunk-layer quads | view basis, palette, cycle ramps | its own | |
| **worldgen** `dungeon-gl.ts` | `LIGHT_VS/FS`, `WORLD_VS/FS`, `ABYSS`, lit sprites, `FLAME`, `SHADOW` | shares `COMMON`, `VIEW_UNIFORMS` (a `project()` for ortho and perspective), `SHADE` (palette row, light map, fog, `litEntry`) through `${}` splices | its own | the engine's other proto-chunk system; a **world-space light map** stamped additively per frame, flickering. `hash12/hash11` (0.1031 family), its own `vnoise/fbm/bayer4` |
| **ui** `present.ts` | one textured quad | `size view layer` | its own | deliberately independent of render/bake; stays that way |
| **REDLINE** `game/src/ground.ts` | ground `VS/FS` | view basis + `uOrigin uPersp uTanH`, `uField` (road SDF field RGBA32F), `uTrack uStart uFieldInfo`, `uRamp[64]` (vec3 **colours**), per-car arrays `uCar uCarB uGlow uLampCol uTailCol uLampAt uTailSpan` [16], `uLamp[48]`, `uMarks uMarksInfo` | its own `compile` | the whole circuit in one fullscreen pass: materials from the field, mowing, gravel traps, kerbs, lines, start grid, city streets, studio floor, skid marks and light trails, contact shadows, underglow ovals, headlight beams, tail-light fans, lamps, a sky gradient for the chase cam. Outputs **raw RGB**, not palette entries |

REDLINE's `guide.ts` and `citymode.ts` have no GLSL: the arrow, the barriers,
the buildings' shop fronts and neon signs are mesh paints with the `glow`
finish plus `MeshDraw.bloom` rows.

### 1.2 How passes are ordered today

**REDLINE frame** (`game.ts` `frame()`, all into the canvas's default framebuffer, 320×180-ish, CSS-scaled):

1. `ground.draw` — clears colour+depth, fullscreen triangle, `depthFunc(ALWAYS)`, writes the ground-plane depth contract.
2. `sr.drawMeshes(cars + city + arrow)` — inside: sun shadow pass (own FBO) → G-buffer pass (own FBO: 4 MRT + renderbuffer depth) → paint pass (fullscreen `MESH_FS` into the bound framebuffer, depth tested) → bloom pass (fullscreen, blended ONE / ONE_MINUS_SRC_ALPHA, no depth).
3. `sr.drawMeshes(glass)` — the same four passes again.
4. `sr.drawVolumes(smoke+dust)`, then `sr.drawVolumes(fire)` — depth tested, `discard`-dithered.
5. `parts.draw(pool)` — the engine particle pool.
6. HUD (canvas presenter).

There's no scene render target, so nothing after step 1 can **sample** the
scene's depth (no soft particles) or its emissive light (no reflections, no
bloom from non-mesh things). The mesh pass reads `FRAMEBUFFER_BINDING` with
`getParameter` every draw to restore the caller's framebuffer, which is a
synchronous query.

**keel/render pixel renderer**: pass 1 (raymarch or raster + hooks such as the
terrain's perspective ground and the sky, into 2 MRT + depth texture) → pass 2
(`PIXEL_FS` fx to the canvas) → optional `DEPTH_OUT_FS`. This is a G-buffer of
*palette indices*: lightness, ramp, material, id.

**Dungeon**: light map (world space, additive) → surfaces → decals → sprites → flames → silhouettes → fog.

### 1.3 What's duplicated

| thing | copies | where |
| --- | --- | --- |
| Bayer 4×4 table (GLSL) | 11 | PIXEL_FS, RASTER_FS, LAYER_FS, MESH_GFS, bloom, volumes, particles, terrain ×2, dungeon, REDLINE ground (plus 2 CPU copies: bake `fx.ts`, `portrait.ts`) |
| sin-hash `fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)` | 4 | WORLD_FS, RASTER_FS, LAYER_FS (`hash12`), REDLINE ground. Its low bits depend on the GPU's `sin`, so it differs across GPUs |
| "0.1031" hashes (`hash11/12/13`) | 2 | volumes, dungeon |
| integer `hashU` (core `math.ts`, exact) | 2 | terrain, sky |
| value noise `vnoise` | 7 variants | vec2 sin-hash (3), vec2 int-hash + seed (2), vec3 `hash13` (1), REDLINE `noise` |
| fbm | 5 variants | 5 octaves halving (WORLD_FS); 0.55/0.3/0.15 with 2.07 lacunarity (sky) and 2.03 (dungeon); 0.65/0.35 3D (volumes); normalised `fbm2` (terrain) |
| interleaved gradient noise screen | 2 | LAYER_FS id 9, REDLINE screen id 1 (core `dither.ts` has it as `ign`) |
| dither screen **numbering** | 4 schemes | render `uScreen` (0 none, 2/4/8 Bayer, −1 texture); bake paints (1 none, 2–4 Bayer, 5 chunky … 13); volumes (0→4, 2, 4, 8); REDLINE (0 bayer4, 1 ign, 2 checker, 3 chunky) |
| palette fetch `pal(i)` | 5 row widths | render 1024, bake `PALETTE_ROW`, particles 256 (`ci & 255, ci >> 8`), volumes uniform `uPaletteRow`, dungeon one ramp per row; REDLINE has no palette at all (`uRamp[64]` of colours built with oklch in TS) |
| ramp quantisation (L → entry, screen breaks the step) | 7 | PIXEL_FS, LAYER_FS, volumes, particles (floor + `fract > bayer` instead), terrain resolve, dungeon `litEntry`, REDLINE `ramp()` |
| view projection + depth contract | 7 | sprites `LAYER_VS`, `MESH_VS`, `VOLUME_VS`, `PARTICLE_VS`, dungeon `VIEW_UNIFORMS.project`, terrain `GPU_VS`, REDLINE ground (inverse: pixel → ground point). Each redeclares `uCenter uRight uUp uForward uK uSize uDepthRange`, and perspective is spelled five ways: `uPersp` int or float, `uTanH` or `uTan`, `uProj` matrix, `uClip` near/far, `uContract` |
| fullscreen triangle VS | 6 | render (vertex buffer), draw-mesh, bloom (`gl_VertexID`), terrain, sky (buffer), REDLINE (`gl_VertexID`, another formula) |
| sun term `0.16 + 0.1 n.y + 0.5 diff` | 3 | WORLD_FS, RASTER_FS, MESH_GFS (as `uFx.w + …`) |
| point / spot / lamp light | 4 models | mesh uniform arrays (16, tints, owners); REDLINE's own beams, tail fans, underglow ovals and 48 radial lamps; dungeon light map; volumes and particles: none |
| fog | 3 | WORLD/RASTER (mix to 0.12), PIXEL_FS (fog ramp by screen), dungeon `fogAt`; none for meshes, volumes, particles or REDLINE's ground |
| shader compile/link helpers | 9 | render `program()`, sky, sprites, particles, terrain ×2, dungeon, ui, REDLINE — each with its own error text and no source mapping |
| derived programs by string surgery | 8 | `DIRECT_PIXEL_FS`, `BAKE_WORLD_FS`, `HEIGHT_FS`, `MESH_FS`, `BILLBOARD_FS`, `SWAY_FS`, `FX_VS`, `FX_FS` |

There's no tone mapping anywhere, by design: the ramp *is* the tone curve.
Lightness picks an entry and emission climbs the ramp. The two places that add
**colour** (bloom's halo, REDLINE's tail fans `col += tint * lvl * 0.55`) can
clip past 1, and nothing handles that.

### 1.4 Pain points

1. **No shared vocabulary.** Every program re-derives hashing, noise, dither,
   palette fetch, ramp quantisation and the view contract. A fix to one never
   reaches the others. Worse, the copies *disagree*: four screen numberings
   and five palette row widths, so "use screen 3" means four different things.
2. **String surgery as a variant system.** Eight programs are made by
   `.replace()` on another program's text, each with a `throw` if its anchor
   text moved. Editing `LAYER_FS` can break four derived programs, and you only
   find out at module load.
3. **Uniform budget cliffs.** REDLINE's ground declares `uRamp[64]` (vec3) +
   seven `[16]` car arrays + `uLamp[48]`: those arrays alone are 224 vectors,
   which is the WebGL2 fragment baseline (`MAX_FRAGMENT_UNIFORM_VECTORS` ≥ 224),
   and with the scalars it's ~236. It runs because desktop GPUs report 1024.
   `MESH_GFS` spends 80 vectors on 80 floats (`uLightI/Tint/Owner[16]`,
   `uSlotGlow[32]`: each float array element takes a whole vector).
4. **Lights are described twice by the game.** `game.ts` builds a `GroundCar`
   (lamp spots, tail span, lamp and tail colours, underglow, braking) for the
   ground shader, and separately a `MeshLight[]` list (headlight spot, brake
   wash, neon point, nitro point) for the meshes. The two sets can drift apart,
   and neither reaches smoke, dust, sparks or flames: a car driving through
   its own tyre smoke at night doesn't light it red or purple.
5. **No scene target, no emissive buffer.** Nothing but meshes can bloom (the
   bloom table is keyed by mesh draw × slot), nothing can sample depth (no soft
   particles), and nothing can sample light (no wet reflections).
6. **REDLINE's ground isn't palette-true.** It outputs RGB from an oklch table
   and blends light as colour. The rest of the picture is palette entries.
7. **The surface a wheel is on is decided twice.** The ground *shader* decides
   tarmac / kerb / gravel trap / grass / verge from the road field (with
   curvature rules), while the race (`race.ts`) decides grip from
   `r.offTrack` or a separate `surfaceAt` thresholding the city field. The
   gravel trap you see can be grass to the physics. `keel/vehicle` already has
   the right table (`surface.ts` `SURFACES`: grip, trip, `kick`, colour, drag),
   but nothing on the rendering side reads it.
8. **Two particle systems in the game.** The engine pool (seeded, GPU
   closed-form motion, recipes, budgets) and a hand-written `puffs[]` for
   volumes (`Math.random`, `splice`, cap of 820, re-pushed into
   `VolumeInstances` every frame). Tyre smoke is a volume while dirt is a pool
   particle, so the same event goes through two paths.
9. **Texture units are hard-coded.** Bake uses 1–15, bloom 7/8/15, particles 1–7,
   REDLINE 9/10. It works only because every pass rebinds everything, and any
   pass that wanted to keep a binding across draws would collide.
10. **Errors are opaque.** `throw new Error(gl.getShaderInfoLog(s))` gives a
    line number in a program of 300 lines stitched from template strings,
    with no name for the piece the line came from.
11. **Compiles are synchronous and unplanned.** Programs compile lazily on first
    use (volumes, bloom, bake mode, raster mode) and can hitch mid-race.
    `KHR_parallel_shader_compile` isn't used. Late *meshes* are already counted
    (`lateMeshes`), but late *programs* aren't.

### 1.5 Constraints the design has to keep

- **keel/render's POC shaders stay frozen** while the proof of concept is the
  reference: `WORLD_FS`, `POINTS_*`, `PIXEL_FS` must equal
  `keel-pixel-engine/src/gpu/shaders.js` character for character, and the
  renderer must make the same GL calls in the same order (a recording
  stand-in checks this). The shader system can't touch them, or render's
  `program()`, until that reference is retired (phase 5).
- **Shader text is module bytes.** Moving GLSL changes a package's shipped
  bytes, so its `vectors.mjs` must be re-pinned and its catalog digest changes
  (as "Vectors: re-pin keel/bake and keel/render for the depth sprites" did).
  Each migration step is one re-pin per package, not a trickle.
- **Onchain size.** KEEL holds ≤23 KB slugs, gzip per leaf. Moving the
  duplicated GLSL into one shared module is a net win: `bayer`, the hashes and
  the view contract stop being stored ~10 times over. `keel/shader` itself
  should stay one slug: target ≤40 KB of source, ≤12 KB gzipped.
- **Deterministic sim, presentation-only GPU.** Shaders never feed the sim.
  Where a CPU decision must match what's drawn (the surface under a wheel,
  picking), the CPU owns the decision and the shader *reads* it, or the chunk
  has a CPU twin with parity vectors (the precedents are `MOTION_GLSL` ↔
  `pool.ts motionAt`, `SPRITE_DEPTH_GLSL` ↔ `depth.ts`, terrain ↔ `ground.ts`).
- **WebGL2 baseline** (what we can count on): 224 fragment / 256 vertex
  uniform vectors, 16 KB uniform blocks, 12 blocks per stage, 24 binding
  points, 16 texture units per stage, 4 draw buffers. Float render targets need
  `EXT_color_buffer_float`, which is common but not guaranteed (particles
  already carry a CPU fallback).
- **The sandbox:** no network (`connect-src 'none'`), no storage. So video
  billboards come from bytes in the document or from procedural programs.

---

## 2. Goals and non-goals

**Goals**
- One place for the GLSL vocabulary (hash, noise, SDF, dither, palette/ramp,
  view/depth contract, lights, fog, emissive), each piece written once, typed,
  tested, and with a CPU twin where the CPU has to agree.
- Programs composed from declared pieces: dependencies resolved, uniforms and
  blocks declared once, variants by `#define` instead of string surgery, a
  cache, errors that name the chunk and its line, hot reload while developing.
- Per-frame data in uniform blocks: camera, time, sun, lights, surfaces.
- One light list per frame that every receiver reads (ground, meshes,
  volumes, particles).
- Surface-aware effects: the physics' surface id drives both the ground's
  material and what the wheel throws up.
- REDLINE's effect list (tyre smoke, dust/sand/dirt by surface, brake glow,
  nitrous, neon underglow, ground light pools, wet roads, LED billboards)
  built as shader materials on this system, not as more one-off code in
  `ground.ts` and `game.ts`.

**Non-goals**
- A node graph editor, a shading language, or WebGPU. (The chunk format is
  deliberately plain GLSL, so a WGSL backend could come later.)
- A PBR pipeline, HDR or filmic tone mapping. Light moves pixels along palette
  ramps, and the only "HDR" is emissive strength feeding bloom.
- Porting keel/render's frozen POC shaders before phase 5.
- Taking over the UI presenter. `keel/ui` stays free of GL dependencies, as its
  own header says.

---

## 3. `keel/shader`: the module format

### 3.1 Package

```
packages/shader/
  package.json            @keel-engine/shader
  src/module.ts           defineManifest({ id: "keel/shader", version: "0.1.0", kind: "runtime", needs: ["keel/core@^0.1"] })
  src/index.ts            defineChunk, defineBlock, defineProgram, createShaderRegistry, the library
  src/compose.ts          dependency resolution, #include, dedupe, line map
  src/registry.ts         compile, link, cache, async, errors, hot reload hooks
  src/blocks.ts           std140 layout and typed writers
  src/lib/*.ts            the standard chunk library (section 4)
  src/lights.ts           SceneLights: the per-frame light list and its UBO writer
  test/*.test.ts          composition, std140 offsets, CPU twins vs vectors, a GL stand-in
```

It needs only `keel/core`, for the CPU twins (`hash2`, `vnoise2`, `fbm2`, the
dither screens, oklch). The view types are structural (`ViewLike`, below), the
same way `keel/particles` takes bake's `PixelView` as a type only, so
`keel/shader` never loads bake. `keel/bake`, `keel/particles`, `keel/terrain`,
`keel/worldgen` and games then list `keel/shader@^0.1` in `needs`.

Surface materials and kicks (section 6) live in a pack, `packs/surfaces`, not
in `keel/shader` or `keel/vehicle`. The shader system stays generic, and the
physics package stays free of GLSL.

### 3.2 Chunks

A chunk is a piece of GLSL plus what it declares and what it needs. Its
dependencies are **values**, not strings, so the bundler and the KEEL linker
see them and unused chunks tree-shake away.

```ts
export type GlslType = "float" | "vec2" | "vec3" | "vec4" | "int" | "ivec2" | "ivec3" | "ivec4" | "uint" | "uvec4"
  | "mat3" | "mat4" | "bool";
export type SamplerType = "sampler2D" | "usampler2D" | "isampler2D" | "sampler2DArray" | "sampler3D";

export interface ChunkSpec {
  /** Namespaced and stable: "noise/value", "light/fan", "redline/ground-materials". */
  readonly id: string;
  /** Which stages may include it (default both). */
  readonly stage?: "vertex" | "fragment" | "both";
  /** Chunks this one calls. Order doesn't matter: the composer sorts them. */
  readonly deps?: readonly Chunk[];
  /** Uniform blocks it reads (section 3.3). */
  readonly blocks?: readonly Block[];
  /** Plain uniforms it reads, declared ONCE by the composer (a clash of types is an error). */
  readonly uniforms?: Readonly<Record<string, GlslType | `${GlslType}[${number}]`>>;
  readonly samplers?: Readonly<Record<string, SamplerType>>;
  /** Varyings it writes (vertex) or reads (fragment); the composer pairs them across stages. */
  readonly varyings?: Readonly<Record<string, { type: GlslType; flat?: boolean }>>;
  /** #defines it reads, with their defaults (a program's own defines override). */
  readonly defines?: Readonly<Record<string, number | boolean>>;
  /** Top-level functions and consts it defines: checked for clashes across chunks at compose time. */
  readonly provides: readonly string[];
  /** The GLSL: functions and consts only -- no #version, no precision, no main, no declarations the fields above make. */
  readonly glsl: string;
  /** Optional: the TypeScript twin a parity test holds it to (name -> function). */
  readonly twin?: Readonly<Record<string, (...args: number[]) => number>>;
}
export interface Chunk extends ChunkSpec { readonly hash: number }   // FNV-1a of id + glsl + deps' hashes

export function defineChunk(spec: ChunkSpec): Chunk;
```

An example, core's exact hash. It's the same function the terrain and the sky
already carry, now written once, with its CPU twin:

```ts
import { hash2 } from "@keel-engine/core";

export const hashU32 = defineChunk({
  id: "hash/u32",
  provides: ["hashU", "hash2i", "hash3i"],
  glsl: /* glsl */ `
// core's hash (packages/core math.ts), exactly: integer ops only, so every GPU agrees with the CPU.
uint hashU(int x, int y, int s) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u) ^ (uint(s) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu; h ^= h >> 13u; h *= 0xc2b2ae35u; h ^= h >> 16u;
  return h;
}
// (The top 24 bits: exact in a float, never rounded up to 1.)
float hash2i(int x, int y, int s) { return float(hashU(x, y, s) >> 8u) * (1.0 / 16777216.0); }
float hash3i(int x, int y, int z, int s) { return hash2i(x, y ^ int(hashU(z, s, 0x51ed) >> 1u), s); }`,
  twin: { hash2i: (x, y, s) => hash2(x, y, s) },
});
```

**`#include`.** You can also write `#include "noise/value"` inside a chunk's or
a program's GLSL. The composer resolves it against the chunks in `deps` (and
the registry's library) and treats it as a dependency, so there's one
mechanism with two spellings. An `#include` that names no known chunk is an
error at compose time, not at GL compile.

**Naming.** GLSL has no namespaces. Library chunks use short, specific names
(`hash2i`, `vnoise2i`, `rampEntry`, `lightFan`). `provides` lets the composer
report two chunks defining `vnoise` before GL does, and name both chunks.
Legacy names (`hash`, `vnoise`, `bayer4`) are kept only in `legacy/*` chunks
used by ports that must stay pixel-identical (section 8).

### 3.3 Uniform blocks

One declaration makes both the GLSL block and a typed TypeScript writer with
std140 offsets computed once. That removes the hand-kept "[centre, mat][half,
yaw]" comments and the float-array waste.

```ts
export interface BlockSpec<F extends Record<string, BlockField>> {
  readonly name: string;            // GLSL block name, e.g. "KView"
  readonly binding: number;         // fixed binding point (section 7.2)
  readonly fields: F;               // ordered
}
export type BlockField = GlslType | { type: GlslType; count: number } | { struct: Record<string, GlslType>; count: number };

export interface Block<F = Record<string, BlockField>> {
  readonly spec: BlockSpec<F & Record<string, BlockField>>;
  readonly size: number;                      // bytes, std140
  readonly glsl: string;                      // "layout(std140) uniform KView { ... };"
  /** A CPU image of the block and setters at the right offsets. */
  create(): BlockData<F>;
}
export interface BlockData<F> {
  readonly f32: Float32Array; readonly i32: Int32Array; readonly u32: Uint32Array;
  set<K extends keyof F>(field: K, value: number | ArrayLike<number>, index?: number): void;
  /** Upload to its own UBO (created on first use) and bind it at the block's binding point. */
  upload(gl: WebGL2RenderingContext): void;
}
export function defineBlock<F extends Record<string, BlockField>>(spec: BlockSpec<F>): Block<F>;
```

Programs don't call `getUniformBlockIndex` and `uniformBlockBinding` by hand.
The registry does it at link time for every block a program's chunks declare.

### 3.4 Programs and variants

```ts
export interface ProgramSpec {
  readonly name: string;                              // "redline/ground", "bake/mesh-gbuffer"
  readonly vertex: StageSpec;
  readonly fragment: StageSpec;
  /** Defines and their allowed values: the variant space. A value outside it is an error, not a new compile. */
  readonly variants?: Readonly<Record<string, readonly (number | boolean)[]>>;
  /** Fragment outputs by location (the frame graph checks them against the target it draws into). */
  readonly outputs?: Readonly<Record<string, { location: number; type: "vec4" | "uvec4" | "ivec4" }>>;
  /** Vertex attributes by location. */
  readonly attributes?: Readonly<Record<string, { location: number; type: GlslType }>>;
}
export interface StageSpec {
  readonly chunks: readonly Chunk[];
  /** The stage's own declarations and main(); may #include. */
  readonly main: string;
  readonly precision?: "highp" | "mediump";           // default highp float + int, highp samplers
}
export function defineProgram(spec: ProgramSpec): ProgramDef;
```

Variants replace string surgery. `BILLBOARD_FS`, `FX_FS` and `SWAY_FS` become
one `bake/layer` program with `variants: { FADE: [0, 1], FX: [0, 1], SWAY: [0, 1] }`,
and the differences go in `#if` blocks inside the chunk. `DIRECT_PIXEL_FS`
becomes `PIXEL` with `DIRECT_MAT: [0, 1]` (phase 5). Uniform branches
(`if (uPersp == 1)`) stay where they're cheap and the value changes per frame.
Defines are for what changes per scene or per style (`PERSP`, `MAX_LIGHTS`,
`VOLUME_STEPS`, `WET`, `SOFT`).

### 3.5 Composition

`compose(def, defines)` produces one source string per stage:

1. Header: `#version 300 es`, precision lines, then the program's resolved
   `#define`s (the chunk defaults, overridden by the program, overridden by
   the call), sorted by name so the source is stable.
2. Walk `chunks` and `#include`s depth first and topologically sort them.
   A cycle is an error that names the cycle.
3. Declarations, deduplicated: blocks (each once), uniforms (once each;
   same name with different types is an error that names both chunks),
   samplers, varyings (vertex `out` must match fragment `in`, including
   `flat`), attributes and outputs with explicit `layout(location = n)`.
4. The chunks' GLSL in sorted order, then `main`.
5. A **line map**: for each output line, `{ chunk: id, line: localLine }`.

Composition is plain string work in TypeScript. It's deterministic and needs
no GL, so it's tested under `node:test` like everything else, and a
snapshot of each program's composed text is what a package's vectors pin.

### 3.6 Registry and cache

```ts
export interface ShaderRegistry {
  readonly gl: WebGL2RenderingContext;
  /** The compiled program for these defines: cached by (program name, sorted defines, chunk hashes). */
  get(def: ProgramDef, defines?: Readonly<Record<string, number | boolean>>): ProgramHandle;
  /** Start compiling now (KHR_parallel_shader_compile when present); the promise resolves when it's linked. */
  prewarm(list: readonly (readonly [ProgramDef, Record<string, number | boolean>?])[]): Promise<void>;
  /** Link raw sources through the same error path (the adapter for code not yet on chunks: MeshPassDeps.link). */
  link(vs: string, fs: string, what: string): WebGLProgram;
  /** Dev: replace a chunk's GLSL; every program that includes it relinks on its next get(). */
  update(chunkId: string, glsl: string): readonly string[];   // the program names affected
  readonly stats: { readonly programs: number; readonly compiles: number; readonly lateCompiles: number; readonly compileMs: number };
  /** Called with every compile/link failure (default: throws a ShaderError). */
  onError?: (e: ShaderError) => void;
}
export interface ProgramHandle {
  readonly program: WebGLProgram;
  readonly name: string;
  use(): void;
  /** Typed uniform setters, from the program's declared uniforms (inactive ones are no-ops). */
  readonly u: UniformSetters;
  /** Bind a texture to the sampler by name: the registry's unit allocator picks the unit (section 3.7). */
  tex(sampler: string, texture: WebGLTexture | null, target?: GLenum): void;
}
export function createShaderRegistry(gl: WebGL2RenderingContext, opts?: { dev?: boolean; library?: readonly Chunk[] }): ShaderRegistry;
```

- **Cache key:** `name | DEFINE=value … | combined chunk hash` (FNV-1a, 32 bit;
  not a sha256: a key per frame lookup, not a digest). Shaders compile once
  per context. The key includes the chunk hash, so hot reload invalidates
  exactly the dependants.
- **Async compile:** with `KHR_parallel_shader_compile`, `prewarm` issues
  every compile, then polls `COMPLETION_STATUS_KHR` from a rAF loop, and
  `get()` of a program still compiling waits on it. A scene declares its
  program list when it's prepared (REDLINE's `prepare()` already does this
  for meshes), and `stats.lateCompiles` counts any program first requested
  after `prewarm`, so "did it hitch?" has a number.
- **One registry per GL context**, shared by bake, particles, the game and
  the frame graph. `createSpriteRenderer` accepts `{ shaders }` or makes its
  own. `MeshPassDeps.link` and `createBloomPass(gl, link)` already take a
  `link` function, so the registry drops straight in.

### 3.7 Samplers and texture units

The registry keeps a small unit allocator per program. Each declared sampler
gets a fixed unit at link time (in declaration order, from unit 1; unit 0 is
left as the "scratch" unit that `texImage2D` uploads use). `handle.tex(name, t)`
binds to that unit. No more literal `gl.TEXTURE9`. The frame graph's shared
textures (scene depth copy, emissive, light map, palette) get **reserved
units at the top** (12–15), so a pass never has to rebind them between draws.

### 3.8 Errors with source mapping

WebGL info logs read `ERROR: 0:<line>: <message>` (ANGLE and Mesa both do
this). `ShaderError` parses every such line, maps it through the line map, and
reports:

```
Shader "redline/ground" (fragment, defines PERSP=1 WET=0) failed:
  light/fan:14  'spanHalf' : undeclared identifier
      float w = max(0.0, abs(rel.x) - spanHalf) / (0.3 + back * 0.5);
  included by: redline/ground-lights <- redline/ground (main)
```

It also keeps the composed source (`e.source`) and the map (`e.lines`), so a
dev overlay can show the whole thing. Link errors (varying mismatch, too many
uniforms) get the same treatment, plus a **budget pre-check**: before GL
sees it, the composer counts uniform vectors under the GLSL ES packing rules
and warns past 224 fragment / 256 vertex, which is how item 3 in 1.4 would
have been caught.

### 3.9 Hot reload while developing

Dev only, never in the shipped module. `createShaderRegistry(gl, { dev: true })`
exposes `registry.update(id, glsl)`. A tiny dev-side script
(`tools/shader-watch.mjs`, next to REDLINE's `tools/build.mjs`) watches
`src/**/*.glsl.ts` files, extracts the chunk's GLSL on change, and pushes
`{ id, glsl }` over an `EventSource` to `dev.html`. The page calls `update`.
Affected programs relink on their next `get()`. If one fails, the **old
program stays in use**, and the error (mapped as in 3.8) shows in an overlay.
No page reload, no lost race state. Because the sim never reads a shader,
reloading one can't desync anything.

### 3.10 Testing

- **Composition tests** (node): dependency order, dedupe, clash errors, line
  maps, std140 offsets against a hand table, the uniform-vector counter.
- **Twin tests**: in node, each chunk's `twin` is held to core's own function
  (it usually *is* core's function). On a real GPU, `tools/shader-parity.html`
  runs the chunk over the same vectors and compares (terrain's parity tool and
  render's `tools/parity.html` are the precedent). There's no GLSL interpreter
  in node. It isn't worth building one.
- **Recording stand-in:** render's `test/gl-stand-in.ts` already parses
  `uniform` declarations and records calls. Extended to blocks, it runs the
  registry and the frame graph without a GPU.
- **Pixel gates** for ports: the old and new program side by side on the same
  inputs in `tools/shader-parity.html`, with the count of differing pixels as
  the gate (0 for a straight port).

---

## 4. The standard chunk library

Everything below is in `keel/shader`, under `src/lib/`. Signatures are GLSL.
Where a function exists today, the "from" column says which copy becomes the
reference.

### 4.1 Hash and noise: `hash/*`, `noise/*`

The canonical hash is **integer** (core's). It gives the same bits on every
GPU and matches the CPU, which the sin-hash doesn't. The sin-hash and the
0.1031 family survive only as `legacy/*` for pixel-identical ports.

| chunk | provides | from / notes |
| --- | --- | --- |
| `hash/u32` | `uint hashU(int,int,int)`, `float hash2i(int,int,int)`, `float hash3i(int,int,int,int)` | terrain / sky / core `math.ts` (twin: `hash2`) |
| `hash/float` | `float hashf(vec2 p, int seed)`, `vec2 hash22f(vec2,int)`, `float hash31f(vec3,int)` | floor-to-int then `hash/u32`: the float convenience layer |
| `noise/value` | `float vnoise2(vec2 p, int seed)`, `float vnoise3(vec3 p, int seed)` | terrain `vnoise2` (twin: core `vnoise2`) |
| `noise/fbm` | `float fbm2(vec2 p, int seed, int oct)`, `float fbm3(vec3,int,int)`, normalised, lacunarity 2.03, offsets as core | terrain `fbm2` (twin: core `fbm2`) |
| `noise/simplex` | `float snoise2(vec2)`, `float snoise3(vec3)` (Ashima/Gustavson, MIT, attributed in NOTICE) | new: for smoke and flames where value noise looks blocky |
| `noise/curl` | `vec3 curl3(vec3 p, int seed)`: the curl of three offset `snoise3` | new: smoke billow and flame lick inside volumes |
| `noise/cells` | `vec3 voronoi2(vec2 p, int seed)` (distance, id.xy) | dungeon `vor()`: gravel stones, cracks, LED cells |
| `legacy/sin-hash` | `hash`, `hash12`, `vnoise` exactly as WORLD_FS / LAYER_FS / REDLINE | for pixel-identical ports only |
| `legacy/hash-1031` | `hash11`, `hash12`, `hash13` | volumes, dungeon |

### 4.2 Shapes: `sdf/*`

`sdBox`, `sdCap`, `sdWedge` (render's, character for character, so WORLD_FS can
move onto them in phase 5), 2D `sdCircle`, `sdBox2`, `sdOval2`,
`sdSegment2`, `sdRoundRect2`, `sdCone3` (the nitro jet), plus the combinators
`opUnion/opSmoothUnion/opSubtract`. `sdf/project` has `groundOf(p)` helpers.

### 4.3 Dither and screens: `dither/*`

One numbering, **core's `ScreenId`** (`dither.ts`: bayer2, bayer4, bayer8,
chunky, halftone, coarseDot, lines, diagonal, hatch, stipple, ign, checker,
weave), exported as `SCREEN_IDS` consts that both TS and GLSL use. The four
old numberings each get a translation table at their call site until they're
ported.

```glsl
float bayer(ivec2 p, int n);                 // 2, 4, 8 -- the one table
float screenAt(ivec2 p, int screenId);       // every core screen the shader can draw (paint-shader's set)
ivec2 screenAnchor(ivec2 frag, ivec2 anchor);// world- or sprite-anchored dither (REDLINE's uOrigin, bake's uDitherAnchor)
bool  ditherKeep(float coverage, ivec2 p, int screenId); // "alpha" as dither density: the only transparency
```

### 4.4 Palette and ramps: `palette/*`

```glsl
// KPalette (block) carries the palette's row width; the palette texture is on a reserved unit.
vec3  palColour(int index);
// A lightness 0..1 on a ramp (base, len) -> an entry, the screen breaking the step between two (the one quantiser).
int   rampEntry(int base, int len, float L, float threshold, float dither);
vec3  rampColour(int base, int len, float L, ivec2 p, int screenId, float dither);
// Light as the engine does it: climb the ramp (lift, in entries), or swap to a tint ramp at the same shade.
int   rampLit(int base, int len, float L, float lift, ivec2 tintRamp, float tintK, ivec2 p, int screenId);
// Palette cycling (water, neon runs): render PIXEL_FS's rule.
int   rampCycle(int idx, int from, int len, float speed, float time);
```

This fixes the "not palette-true" problem in 1.4: REDLINE's ground builds its
ground ramps into the shared palette (`createLookTable().ramp(...)`, as it
already does for light tints) and uses `rampLit` instead of mixing RGB.

### 4.5 View and depth: `view/*`

The **KView** block (7.2) plus the one implementation of the depth contract
that `project.ts` defines and that seven programs re-derive today:

```glsl
vec4  viewProject(vec3 world);               // clip position: ortho (pixel view) or perspective (clip matrix), by KView.persp
float viewDepth(vec3 world);                 // the contract's linear depth 0..1 (what gl_FragDepth gets)
float groundDepth(vec3 world);               // the ground-plane depth (kappa = cos^2 pitch; depth.ts)
vec3  viewRay(vec2 fragCoord, out vec3 origin); // a pixel's ray: parallel (ortho) or from the eye
bool  groundHit(vec2 fragCoord, out vec3 p); // REDLINE's pixel -> ground point; false above the horizon
float pixelsPerMetreAt(vec3 world);          // k at that distance (perspective sizing of particles and volumes)
float spriteTexelDepth(...);                 // SPRITE_DEPTH_GLSL, moved here unchanged
```

`view/fullscreen` is the one fullscreen triangle VS (`gl_VertexID`, no buffer,
no VAO state beyond an empty one).

### 4.6 Fog and distance: `fog/*`

`float fogAmount(float dist)` (KFrame fog near/far/amount) and
`fogRamp(inout int base, inout int len, inout float L, float f, ivec2 p)`, which
is PIXEL_FS's rule: past the near distance, pixels go over to the fog's ramp,
and the screen decides which. Meshes, volumes, particles and REDLINE's ground
all get fog from this for free. It also gives the synthwave city a proper
distance haze into the horizon glow.

### 4.7 Lights: `light/*`

These read the **KLights** block (7.2). Each light *shape* is one function
that returns `vec2(strength, 0..1 falloff)` for a point. Receivers call
`lightGather`:

```glsl
struct LightHit { float lift; float tintK; int tint; vec3 colour; };
float lightPoint (vec3 p, vec3 n, int i);   // sphere falloff (mesh.ts's (1 - d/r)^2), Lambert-ish wrap
float lightSpot  (vec3 p, vec3 n, int i);   // + cone (mesh.ts's smoothstep)
float lightBeam  (vec2 xz, int i);          // headlight ON THE GROUND: lands ahead of the lamp, widens, fades (REDLINE)
float lightFan   (vec2 xz, int i);          // tail/brake lamp on the ground: from the lens's width, spreading as it falls back (REDLINE uTailSpan)
float lightOval  (vec2 xz, int i);          // underglow: an oval pool under a body, soft edge, optional pulse
float lightTube  (vec3 p, int i);           // a neon tube / light bar: distance to a segment
float lightRect  (vec3 p, vec3 n, int i);   // a sign or a screen as an area light (facing-weighted)
LightHit lightGather(vec3 p, vec3 n, int receiverMask, float owner);   // all of them, strongest tint wins (mesh.ts's rule)
LightHit lightGatherGround(vec2 xz);                                   // the ground's cheaper path: shapes by their ground footprint
vec3 lightMapAt(vec2 xz);                    // the world-space ground light map (section 5.3), when on
```

The shape code for `beam`, `fan` and `oval` is REDLINE's, lifted as-is, so its
tail-light fans keep their look. It just stops being private to one file.

### 4.8 Emissive and bloom: `emit/*`

The convention: every pass that draws into the scene target may write
`layout(location = 1) out vec4 outEmit`, as rgb colour (sRGB 0..1) and a
strength (0..1). `emit(vec3 colour, float strength)` writes it. The chunk
`emit/none` writes zero for programs that don't glow. The generalised bloom
pass reads this target (section 7). A lamp's heart turning white-hot is
`emitCore(colour, depthInLamp)`, taken from `bloom.ts`.

### 4.9 Tone and output: `tone/*`

There's no filmic curve. Two helpers keep additive light pixel art:

```glsl
// Additive light in N stepped levels through the screen (REDLINE's tail-glow rule): a gradient, not a smear.
vec3 addStepped(vec3 base, vec3 light, float amount, int levels, ivec2 p, int screenId);
// Soft clip for additive colour: keeps a hot lamp from clipping to flat white except at its core.
vec3 softClip(vec3 c);
```

### 4.10 Utility

`util/math` (`sat`, `remap`, `tri`, `rot2`), `util/oct` (octahedral normal
pack/unpack from `MESH_GFS`), `util/pack` (the two-byte height and three-byte
depth packers from `indexed.ts`), `util/color` (sRGB↔linear, oklch→sRGB for
procedural LED content only).

---

## 5. Lights: one list a frame

### 5.1 `SceneLights`

The game builds **one** list per frame. Every receiver reads it.

```ts
export type LightKind = "point" | "spot" | "beam" | "fan" | "oval" | "tube" | "rect";
export interface SceneLight {
  readonly kind: LightKind;
  readonly pos: readonly [number, number, number];
  readonly dir?: readonly [number, number, number];       // spot, beam, fan: which way it throws
  readonly radius: number;                                 // reach (m)
  readonly intensity: number;
  readonly colour?: readonly [number, number, number];    // sRGB 0..1 (additive receivers)
  readonly tint?: number;                                   // tint ramp id (1-based; the palette-true receivers)
  /** Shape parameters: spot/beam cone cos; fan lens half width + spread per metre; oval half extents; tube/rect other end or size. */
  readonly shape?: readonly [number, number, number, number];
  readonly owner?: number;                                  // never lights its own draw
  /** Who receives it (default all): ground, meshes, volumes, particles, wet reflections, the light map. */
  readonly receivers?: number;                              // RECEIVE.* bit mask
  readonly anim?: { readonly mode: "pulse" | "flicker" | "chase"; readonly rate: number; readonly depth: number };
  /** Sort key: nearer the camera / more important first; the budget keeps the first N. */
  readonly priority?: number;
}
export const RECEIVE = { ground: 1, mesh: 2, volume: 4, particle: 8, reflect: 16, lightmap: 32 } as const;

export interface SceneLightList {
  clear(): void;
  push(light: SceneLight): boolean;
  /** Sort by priority, keep the analytic budget in the UBO, route the rest to the light map (5.3). */
  commit(gl: WebGL2RenderingContext, budget: LightBudget): { analytic: number; mapped: number; dropped: number };
}
```

REDLINE's two descriptions collapse into this one. A car's head lamps become
two `beam` lights (ground) that also act as `spot` for meshes: the mesh
receiver evaluates a beam as a spot. Its tail lamps become a `fan` (ground)
and a red `spot` (meshes), with `intensity` from braking. Its underglow is an
`oval` at y≈0.12 (ground, meshes' lower body, volumes, reflections). Nitro is
a `point` (everything). Street lamps are `point`s with `receivers: ground |
lightmap`. `MeshStyle.lights` stays as an input and is converted into the
same list, so existing games keep working.

### 5.2 Receivers

| receiver | how it takes light | cost |
| --- | --- | --- |
| ground (REDLINE, terrain later) | `lightGatherGround` per pixel: lift up the ramp + strongest tint ramp; underglow/fan add stepped colour (`addStepped`) where a game wants the glow look | ≤ analytic budget × pixels; at 320×180 and 32 lights, ~1.8 M shape evals |
| meshes (`MESH_GFS`) | today's loop, reading KLights instead of five uniform arrays | unchanged |
| volumes | `lightGather` at the puff's **centre** (and its top) in the vertex shader, passed flat: lift + tint + colour. `VOLUME_LIGHT_PER_STEP` evaluates per march step for hero puffs | 4 vertices × lights, per puff |
| particles | `lightGather` in `PARTICLE_VS` at the particle's position, flat | per particle |
| wet reflections | `reflect`-flagged lights mirrored under the road (6.8) | per wet pixel |

### 5.3 Analytic vs. light map

- **Analytic** (KLights UBO): up to `MAX_LIGHTS` = 32 by default (64 on the
  high tier), 80 bytes each, so 64 lights is 5 KB (a third of one 16 KB block).
  These are the lights that move and matter: headlights, brake fans,
  underglow, nitro, sparks.
- **Ground light map** (from the dungeon's `LIGHT` pass, generalised):
  a camera-centred world-space texture (RGBA16F, or RGBA8 with a ×4 range
  squeeze when float targets aren't there). Each frame, every light with
  `RECEIVE.lightmap` is stamped additively as a quad using the **same shape
  functions**. The ground, volumes and particles sample it with `lightMapAt`.
  This is how a city with thousands of street lamps, shop fronts and neon
  signs lights its roads (today it's the nearest 48, sorted on the CPU every
  frame), and how light pools under lamps get soft edges for free. Budget:
  256² texels at 2 texels/m (128 m square) for the top view, 512² for the chase
  cam (the map follows the camera's look-ahead point).
- Lights past both budgets are dropped by priority, and `commit` reports the
  count to the stats overlay.

---

## 6. Materials and effects

### 6.1 Surface ids: one decision, many readers

```
                   (CPU, deterministic, dmath)                      (GPU, presentation)
 road field / terrain tile ──► surfaceAt(x, z) ──► wheel.surface ──► effects(): SURFACE_FX[id].kick ──► particle pool / volumes
        │                           │  (grip, trip, drag:                                    └──► marks texture (.a = mark kind)
        │                           │   keel/vehicle SURFACES)
        │                           └──► same rules, GLSL twin ────────► ground shader: surface id per pixel ──► GroundMaterial[id]
        └────────────────────────────────── KSurfaces UBO: per id ground ramp, tone, screen, kick colour, wetness
```

- **Ids.** `packs/surfaces` fixes the order: `SURFACE_ID = { tarmac: 0, wet: 1,
  kerb: 2, pavement: 3, gravel: 4, dirt: 5, sand: 6, grass: 7, line: 8,
  verge: 9 }` (≤16). The first eight are `keel/vehicle`'s `SURFACES` keys.
  `line` and `verge` are draw-only (they map to tarmac and grass for physics).
  The id is a small integer, so it fits a texture channel, a UBO index and a
  recipe table.
- **One classifier.** The road rules REDLINE's ground shader applies (inside
  `half` = tarmac, edge band = line, kerb band where `|curv| > 0.012`, gravel
  trap on the outside of `|curv| > 0.022`, verge, grass; the city's pavement
  and kerb bands) move into `packs/surfaces` as **one TypeScript function**
  over a field sample, `classifyRoad(sample, rules): SurfaceId`, with a GLSL
  twin chunk `surface/classify-road` generated from the same rule table
  (thresholds are data, not code) and parity vectors. The physics calls the
  TS version per wheel (through `surfaceGround`'s memo), and the ground shader
  calls the twin. Where a game has an arbitrary map (terrain), the CPU bakes a
  surface-id texture (R8) that both read. Either way, the shader never
  decides something the physics doesn't.
- **Per wheel.** The sim's wheel state carries `surface: SurfaceId` (the
  brief's "each wheel has a surface"). As of this survey, REDLINE's `race.ts`
  still collapses it to a grip scalar and `r.offTrack`, so wiring the id
  through `surfaceGround` is the one sim-side change this design needs.
  Presentation reads it. Nothing flows back.

### 6.2 Ground materials

`GroundMaterial` is data in the KSurfaces UBO, read by a `material/ground`
chunk that returns `{ rampBase, rampLen, L, screen, reach }` for (surface id,
world xz, field sample). The noise terms are REDLINE's, moved to the integer
noise.

| surface | ramp (look table) | tone (per-pixel L) | screen | wet response |
| --- | --- | --- | --- | --- |
| tarmac (dry) | cool grey, 8 entries | 0.5 + 0.18·vnoise(1.3) + aggregate speckle (`hash` at 6/m) − racing-line darkening | ign | darker (−0.12 L), puddles, reflections |
| tarmac (wet) | same ramp, `WET=1` | −0.12 L, contrast ×1.3, puddle mask `fbm2(0.25)` > 1 − wetness | ign | full (6.8) |
| kerb | red + white ramps, 1 m blocks along `s` | 0.55 + band | checker | slight gloss |
| pavement | light concrete | slabs every 2 m with dark joints (REDLINE city) | chunky | puddles in joints |
| line | near-white | flat 0.6 | bayer4 | reflective |
| grass | green, hue drift | 0.5 + 0.2·vnoise + mow bands (7 m diagonals) | bayer4 | darker, no reflection |
| verge | olive | 0.4 + 0.3·vnoise(0.8) | chunky | darker |
| dirt | brown | fbm ruts + `voronoi` clods | bayer4 | mud: darker, glossy puddles |
| sand | tan | ripples: `sin((x·0.5 + z·1.3 + vnoise·3)·3)` (terrain tex 2) | stipple | darker, no reflection |
| gravel | warm grey | `voronoi2` stones at 3/m, per-stone tone | ign | slight |

Skid marks live in the existing marks texture, with channel `.a` becoming
**mark kind** (rubber / rut / torn turf / wet dry-line), written from the
wheel's surface. On tarmac a mark darkens, on dirt and sand it's a darker rut
with a lit lip, on grass it swaps the pixel to dirt, and on wet tarmac it's a
short-lived *drier* line (lighter, no reflection) that fades.

### 6.3 What a wheel throws up

`packs/surfaces` owns `SURFACE_FX: Record<SurfaceId, SurfaceFx>`. The kick
colours come from `keel/vehicle`'s `Surface.colour` through oklch ramps
(`surfaceRamp(colour)`), so a game's own surface (ice, mud) gets a matching
cloud without new art.

```ts
export interface SurfaceFx {
  /** Cloud: a volume look on the particle pool (6.4). */
  readonly cloud?: { recipe: string; kind: "smoke" | "dust"; ramp: RampRef; density: number; lift: number; linger: number };
  /** Debris: pool particles (sprite, ground mode). */
  readonly debris?: { recipe: string; ramp: RampRef };
  /** When it fires: sliding (skid / load), spinning, or simply rolling fast off tarmac. */
  readonly on: { slide: number; spin: number; roll?: number };
  readonly mark: "rubber" | "rut" | "turf" | "dry-line";
}
```

| surface | cloud | debris | fires on | mark |
| --- | --- | --- | --- | --- |
| tarmac / kerb / pavement | **tyre smoke**: white-grey volume, swells ×2.2, rises, lingers 0.7–1.4 s | — | slide > 0.35 or load > 0.72, burnout, launch spin | rubber |
| dirt | **brown dust**: warm volume, low, wide, slow to settle (lift 0.3, linger 1.6 s) | dirt specks (`dot`, gravity 7, `die`) | any slide; rolling > 8 m/s at low density | rut |
| sand | **tan cloud**: bigger, rolls along the ground (lift 0.15, drag 1.2), long linger | grains as short streaks (`streak` 0.05) | rolling > 4 m/s, strong on slide | rut |
| grass | faint green-brown haze (low density) | **clods**: `leaf`/`dot` sprites in the grass ramp *and* a dirt ramp, `bounce` 0.3 | slide, spin | turf |
| gravel | grey-brown dust puff | **stones**: `dot`, `bounce` 0.4, friction 0.7, a clatter sound hook | slide, rolling > 6 m/s | rut |
| wet | mist (thin, cool, fast fading) | **spray**: `drop` streaks off the tyre's back arc, water ramp | rolling > 10 m/s, rooster tail on spin | dry-line |

REDLINE's `effects()` then drops its per-kind branches (`sliding → smoke`,
`offTrack → dirt + dust`) for one loop, where `k` is the surface's effect
table, `SURFACE_FX[w.surface]`:
`if (k.on.slide < slide || …) pool.emit(k.cloud.recipe, …); pool.emit(k.debris.recipe, …)`.

### 6.4 Smoke and dust as volumes on the pool

Volumes become a **render mode of the particle pool**, not a second system:
`ParticleLook.render: "sprite" | "volume"`, with `volume: { kind, density,
steps }`. The pool's closed-form motion, budgets, priorities, wind and seeded
streams apply to smoke too, and REDLINE's `puffs[]` and its `Math.random` go.
The volume program reads the pool's state textures (as `PARTICLE_VS` does)
and marches its ball exactly as `VOLUME_FS` does, plus:

- **Noise:** `noise/curl` displaces the march so smoke *billows*, and the
  density field is `fbm3` from `noise/fbm` (integer, stable) in place of
  `hash13`.
- **Lit by lamps and neon:** `lightGather` at the puff's centre in the VS
  (5.2). Smoke passing through a brake fan goes red, through underglow goes
  the neon's colour, and through a headlight beam goes bright. That's the
  NFS read. On the palette it's the tint ramp at the smoke's own shade,
  dithered in by strength, the same rule meshes use.
- **Soft against the scene:** with the frame graph's depth copy (7.1), each
  march step's depth is compared to the scene depth, and coverage fades over
  `SOFT_RANGE` (0.3 m) before it meets a car or the road. The fade is
  **dither density**, never alpha, so a puff meeting the tarmac thins to a
  stipple instead of a hard line.
- **Self-shadowing, cheap:** a second density sample toward the sun, which
  VOLUME_FS's `dot(q, uSun)` approximates today.
- `VolumeInstances` / `drawVolumes` stay as the direct API. The pool mode
  writes the same instance layout into a buffer on the GPU side.

### 6.5 Neon underglow (NFS style)

- **On the ground:** an `oval` light at y = 0.12 under the chassis, sized to
  the body plus 0.9–1.1 m. Its falloff is `(1 − d²)` with a brighter rim
  just outside the body line (`lightOval` shape param 3 = rim). It's drawn
  palette-true (tint ramp at the tarmac's shade, stepped) plus a thin
  `addStepped` glow. `anim` lets it pulse or chase.
- **On the car:** the same light as a mesh receiver. It lights the sills,
  bumpers and wheels from below (`n.y < 0` faces get it most), which the mesh
  loop already does as a point light.
- **In the air:** volumes and particles get the tint (6.4).
- **On wet roads** it's the strongest reflector (6.8).
- **Emissive:** the tube itself (a mesh slot with the `glow` finish) writes
  `outEmit`, so bloom halos it.

### 6.6 Brake lights, headlights, light pools

- **Brake glow** keeps `MeshDraw.bloom` on the lens slots (the shape-true
  bloom is the right look). Braking also sets the `fan` light's reach
  2.4 → 5.5 m and intensity 0.3 → 1.0 (REDLINE's numbers), which lights the
  road *and* the smoke behind the car.
- **Headlights:** two `beam` lights. On the ground they're REDLINE's cone
  (lands ahead of the lamp, widens, fades by 11 m, two merge into one pool)
  in the lamp's own tint. On meshes they're spots. They're flagged
  `reflect` for wet roads.
- **Street lamps and ground light pools:** `point` lights routed to the light
  map (5.3), with an optional `flicker` anim (the dungeon's `flick()`).

### 6.7 Nitrous flames

Today it's up to five CPU puffs per pipe per step. The proposal is a **jet
volume**: one instanced cone per exhaust tip (`sdCone3` along the tip's
direction, length 0.4–0.9 m flickering), marched like a volume with
`noise/curl` licks along it, a **white-hot core** ramp near the pipe
(REDLINE's `carFlame.core`), the flame ramp through the body, and ragged tips
from `fbm3` thresholding. Nitro adds three to four **shock diamonds**, bright
bands at fixed fractions along the axis, which is the NFS signature. It writes
`outEmit` (it blooms), pushes a `point` light (nitro blue or the car's glow
hue), and keeps a thin smoke trail from the pool. The cost is one cone per pipe
instead of ~20 puffs.

### 6.8 Wet roads

A frame-level `wetness` (0..1, KFrame) plus the per-surface wet response
(6.2). The `material/wet` chunk:

1. **Darken and deepen**: −0.12 L, a steeper ramp walk.
2. **Puddles**: `fbm2(xz · 0.25)` against `1 − wetness`, with the racing line
   drier (lower puddle chance where the field says the line runs).
3. **Light streaks**: for every `reflect` light, mirror its position through
   the road plane and project it with KView. A wet pixel near the image's
   screen column gets a streak that is **long along the screen's vertical and
   narrow across it**, the classic wet-tarmac smear. Its strength falls off
   with distance from the image, is broken by `vnoise2` ripples and quantised
   with `addStepped`. From the top view the streaks are short, because the
   pitch squashes them. From the chase cam they're long.
4. **Emissive reflection (chase cam, high tier):** puddles sample *last
   frame's* emissive target at the pixel mirrored about the reflected base
   line (one frame late, which is fine for presentation), so signs, LED walls
   and brake lamps show up in puddles.
5. Spray and dry lines come from 6.3 and 6.2.

### 6.9 LED and video billboards

A **screen finish** for mesh paints (`looks.ts` finishes gain `"screen"`)
whose paint parameter is a **screen source** layer:

```ts
export type ScreenSource =
  | { kind: "procedural"; program: ProgramDef; fps: number }          // an "LED program": rendered into its layer at LED resolution
  | { kind: "video"; element: HTMLVideoElement }                        // dev / off-chain; on chain the video's bytes ride in the document
  | { kind: "frames"; frames: readonly ImageBitmap[]; fps: number }     // a baked loop
  | { kind: "text"; atlas: string; lines: readonly string[]; speed: number }; // a scrolling ticker from the decal alphabet (keel/decal)
export interface ScreenAtlas {
  add(source: ScreenSource, size: readonly [number, number]): number;  // -> layer id for a paint
  update(time: number): void;                                          // re-renders due layers (rate-limited per source)
}
```

The look, in the mesh paint pass (`material/led` chunk), reads the surface
coordinate from the G-buffer (`gA.zw`), then:

- snaps it to the **LED grid** (cells per metre set on the paint) and samples
  the source at the cell centre (nearest, so no smear);
- applies a **dot mask** (round LEDs with dark gaps, from `sdCircle`), fading
  to a flat colour where a cell is under a pixel, like the paint's patterns;
- quantises to 3 bits per channel, or to a *ramp family* in palette-true
  mode (the synthwave look: each colour snapped to the nearest of the scene's
  neon ramps);
- adds a **refresh roll** (a dim band crawling down at `rate`) and a
  scanline;
- falls off with viewing angle (`facing` from the normal in `gD`, darker and
  bluer off-axis);
- writes `outEmit` with brightness, so a big screen blooms and lights the
  street through a `rect` light (optional, `RECEIVE.lightmap`).

Onchain there's no network, so the default is procedural LED programs
(synthwave grids, a scrolling race ticker, a sponsor logo from the decal
alphabet). Video is supported but its bytes come with the document.

---

## 7. Passes and data

### 7.1 Scene target and frame graph

A small ordered **frame graph** (a list with declared reads and writes, not a
general DAG):

```ts
export interface FramePass {
  readonly name: string;
  readonly reads?: readonly TargetName[];      // sampled textures
  readonly writes: readonly TargetName[];      // attachments (colour / emit / depth)
  readonly depth?: "test" | "test-write" | "always-write" | "none";
  run(ctx: PassContext): void;
}
export type TargetName = "scene.colour" | "scene.emit" | "scene.depth" | "scene.depthCopy" | "lightmap" | "emit.prev" | string;
export interface FrameGraph {
  add(pass: FramePass): void;
  /** Checks every pass: nothing samples what it writes (WebGL2 feedback loops), outputs match attachments. */
  compile(): void;
  run(frame: FrameInputs): void;
  readonly timings: ReadonlyMap<string, number>;   // EXT_disjoint_timer_query_webgl2 when present (pixel-renderer's TimerQuery)
}
export function createFrameGraph(gl: WebGL2RenderingContext, shaders: ShaderRegistry, size: { width: number; height: number }): FrameGraph;
```

The **scene target** is `colour` RGBA8 + `emit` RGBA8 + `depth`
DEPTH_COMPONENT24 texture, at the picture size (e.g. 320×180). The graph sets
`drawBuffers` for each pass from its `writes` (`[COLOR0, NONE]` for a pass
that doesn't emit), so no program has to write an output it doesn't care about
(an unwritten enabled draw buffer is undefined in ES 3.0). It binds
framebuffers itself, which removes draw-mesh's per-draw
`getParameter(FRAMEBUFFER_BINDING)`.

REDLINE's frame on the graph:

```
 frame.begin      write KFrame, KView, KLights, KSurfaces UBOs (once)                      —
 lightmap         stamp RECEIVE.lightmap lights into the world light map                    writes lightmap
 ground           redline/ground (materials, marks, gatherGround, wet)                      writes colour, emit, depth(always)
 mesh.shadow      (bake, unchanged)                                                          own target
 mesh.gbuffer     (bake, lights from KLights)                                                own target
 mesh.paint       (bake) + outEmit from the per-slot bloom row                              writes colour, emit; depth test-write
 glass            (bake, again)                                                              same
 depth.copy       blitFramebuffer DEPTH scene.depth -> scene.depthCopy                        —
 volumes          pool volume mode + jets: soft (reads depthCopy), lit (KLights, lightmap)   writes colour, emit; depth test
 particles        pool sprites: soft, lit                                                     writes colour, emit; depth test
 bloom            generalised: reads scene.emit (+ depthCopy to keep halos off near things) writes colour (additive, dithered tail)
 emit.keep        copy scene.emit -> emit.prev (only when wet reflections are on)             —
 post             optional keel/render-style fx: vignette, scanlines, CRT (chunks, not PIXEL_FS) reads colour
 present          nearest-neighbour blit to the canvas at the integer UI scale                —
 ui               keel/ui presenter (unchanged)
```

Soft particles need the depth copy because WebGL2 treats sampling a texture
that's attached to the bound framebuffer as a feedback loop *even with depth
writes off*. `blitFramebuffer` of `DEPTH_BUFFER_BIT` between two
same-format depth textures is legal and costs almost nothing at 320×180.

The **generalised bloom** keeps bloom.ts's look (the core burns white where
it's deep inside its lamp, a halo added round it, the tail dithered) but reads
per-pixel emission from `scene.emit` instead of the draw×slot table. So the
ground's neon lines, LED walls, nitro jets and sparks bloom exactly like a
brake light. The mesh paint pass writes its bloom row's colour into `emit`,
which keeps the table's authoring model while dropping the second G-buffer
lookup.

### 7.2 Uniform blocks

Binding points are fixed engine-wide, so a UBO bound once per frame serves
every program:

| binding | block | contents (std140) | size |
| --- | --- | --- | --- |
| 0 | `KFrame` | `vec4 time` (t, dt, frame, night 0..1); `vec4 sun` (dir, ambient); `vec4 fog` (near, far, amount, 0); `ivec4 fogRamp` (base, len, screen, 0); `vec4 wind` (x, z, gust, wetness); `ivec4 palette` (row width, default screen, 0, 0) | 96 B |
| 1 | `KView` | `mat4 clip`; `vec4 originK` (origin xyz, k); `vec4 rightRange` (right, depthRange); `vec4 upTan` (up, tanHalfFov); `vec4 fwdPersp` (forward, persp 0/1); `vec4 sizeAnchor` (w, h, anchor px x, y); `vec4 pitch` (cos, sin, kappa, tie) | 160 B |
| 2 | `KLights` | `ivec4 count` (analytic, 0, 0, 0); `Light lights[MAX_LIGHTS]` with `vec4 posR` (pos, radius), `vec4 dirK` (dir, cone cos or spread), `vec4 colourI` (rgb, intensity), `vec4 shape`, `ivec4 meta` (kind, tint, owner, receivers + anim) | 16 + 80·N B (32 → 2.6 KB, 64 → 5.1 KB) |
| 3 | `KSurfaces` | per id (16): `ivec4 ramp` (base, len, screen, markRamp); `vec4 tone` (base, noise amp, noise freq, grain); `vec4 kick` (rgb, 0); `vec4 wet` (darken, puddle, reflect, 0) | 1 KB |
| 4–7 | per-pass blocks | e.g. `KMeshDraw` (the per-draw uniforms the mesh G-buffer sets 12 times a draw), `KGroundCars` (REDLINE's remaining per-car data: shadow boxes, trail colours) | ≤16 KB each |

`KView` is written from either a `PixelView` or a `Projection` by one helper,
`writeView(block, view)`. That's the one place the ortho/perspective split
lives, instead of `uPersp`/`uTanH`/`uContract` in every program.

### 7.3 Budgets, tiers, fallbacks

| knob | low | default | high | notes |
| --- | --- | --- | --- | --- |
| analytic lights | 16 | 32 | 64 | the rest go to the light map, then drop by priority |
| light map | off | 256² @ 2/m | 512² @ 4/m | RGBA8 ×4 squeeze without `EXT_color_buffer_float` |
| volume march steps | 4 | 8 | 12 | `VOLUME_STEPS` define; lamp light per puff vs per step |
| volume count | 300 | 900 | 1500 | pool budget per recipe, as today |
| soft particles/volumes | off | on | on | off skips the depth copy |
| bloom reach (px) | 3 | 5 | 6 | `BLOOM_REACH` is the loop bound |
| wet streaks / emissive reflections | streaks, 8 lights | streaks, 16 | + emissive reflections | |
| LED screens | 1 layer, 8 fps | 4 layers, 15 fps | 8 layers, 30 fps | procedural programs rate-limited |

The tier is picked at start from `MAX_*` limits, `EXT_color_buffer_float`,
`KHR_parallel_shader_compile`, and a one-second timing sample on the graph's
timers. It can drop a step at run time if the frame graph's GPU time sits over
budget (8.3 ms at 120 fps) for two seconds. Everything that changes is a
define or a count, so every tier's variants go in the `prewarm` list up front.

---

## 8. Migration plan

Each phase ends with its packages' vectors re-pinned once, a pixel gate, and
no change to the sim.

### Phase 0: the registry under what exists (no shader text changes)

- Add `packages/shader` with `createShaderRegistry` (`link`, error mapping on
  raw sources, stats, prewarm) and `defineBlock` (not used yet).
- Route bake's `compile/link` (and so the mesh pass and bloom), particles,
  terrain (both), worldgen dungeon and REDLINE through `registry.link`. The
  GLSL is byte-identical, so the pixels are too.
- **Not keel/render** (its GL calls are pinned by the POC equality test).
- Exit: all tests pass, `stats.lateCompiles` shows up in REDLINE's `stats()`,
  and a deliberately broken shader names its file.

### Phase 1: the smallest useful system (the brief's phase 1)

Scope: `defineChunk`, `defineProgram`, `compose` (deps, `#include`, dedupe,
line map, the uniform budget counter), the program cache and hot reload, the
`KFrame`, `KView` and `KLights` blocks, and these chunks: `hash/u32`,
`hash/float`, `noise/value`, `noise/fbm`, `legacy/sin-hash`, `dither/*`,
`palette/*`, `view/*` (with `view/fullscreen`), `light/beam|fan|oval|point|spot`,
`lightGatherGround`, `tone/addStepped`, `emit/none`.

1. **REDLINE ground onto chunks, pixel-identical first.** `game/src/ground.ts`
   becomes `ground.glsl.ts` (program `redline/ground`) using
   `legacy/sin-hash` and REDLINE's own screen numbering through
   `dither/screenAt`'s translation table. The car light arrays (`uCar…uTailSpan`,
   112 vectors) and `uLamp[48]` move to `KLights` (beams, fans and ovals as
   lights) and a `KGroundCars` block for the contact shadows and trail
   colours. `uRamp[64]` stays for now. Gate: **0 differing pixels** against
   the current shader on the parity page, over the four biomes, the city, the
   studio, day and night, top view and chase cam.
2. **Then switch to the library** in a separate commit: integer noise (the
   ground's grain pattern changes, deliberately), core screen ids, and
   palette-true ramps (ground ramps into the look table; `rampLit` replaces
   RGB mixing). Gate: side-by-side review screenshots; the uniform counter
   shows the ground well under 224 vectors.
3. **`game.ts` builds one `SceneLightList`**: head beams, tail fans,
   underglow, nitro and lamps. `GroundCar` shrinks to the shadow box and the
   trail colour. The mesh pass still takes `MeshStyle.lights`, converted from
   the same list by a helper (`meshLightsOf(list)`), so there's one source.
4. **Particles onto chunks.** `PARTICLE_VS/FS` become the program
   `particles/sprite`: `view/*` replaces the hand-rolled perspective
   (`uPersp uEye uTan uClip uContract`), `dither/bayer` and `palette/*`
   replace the local copies, and `MOTION_GLSL` becomes the chunk
   `particles/motion` with its existing CPU twin. Add `lightGather` in the VS
   behind `LIT=1` (default off in phase 1, so the port is pixel-identical at
   `LIT=0`). Gate: 0 differing pixels at `LIT=0` over the preset gallery;
   re-pin keel/particles vectors.
5. Hot reload wired into REDLINE's `tools/dev.html`.

Phase 1 API in one place:

```ts
// @keel-engine/shader
export function createShaderRegistry(gl: WebGL2RenderingContext, opts?: { dev?: boolean }): ShaderRegistry;
export function defineChunk(spec: ChunkSpec): Chunk;
export function defineBlock<F extends Record<string, BlockField>>(spec: BlockSpec<F>): Block<F>;
export function defineProgram(spec: ProgramSpec): ProgramDef;
export function compose(def: ProgramDef, defines?: Record<string, number | boolean>): { vertex: string; fragment: string; lines: LineMap; vectors: { vertex: number; fragment: number } };
export const KFrame: Block; export const KView: Block; export const KLights: Block;
export function writeView(block: BlockData<unknown>, view: ViewLike): void;
export function createSceneLights(capacity?: number): SceneLightList;
export interface ViewLike {   // structural: bake's PixelView or Projection both fit
  readonly width: number; readonly height: number;
  readonly center?: readonly [number, number, number]; readonly pixelsPerMetre?: number;
  readonly axes?: { right: readonly number[]; up: readonly number[]; forward: readonly number[] };
  readonly kind?: "ortho" | "persp"; readonly origin?: readonly number[]; readonly clip?: Float32Array;
  readonly k?: number; readonly depthRange?: number; readonly tanHalfFov?: number;
}
export * as lib from "./lib/index.ts";   // hashU32, valueNoise, fbm, bayer, screens, palette, view, lights, tone, emit, legacy
```

REDLINE's ground, as it would read:

```ts
import { defineProgram, lib, KFrame, KView, KLights } from "@keel/game-engine/shader";
import { groundMaterials, classifyRoadGlsl } from "@keel/game-engine/surfaces";   // phase 2; phase 1 keeps its rules inline

export const GROUND = defineProgram({
  name: "redline/ground",
  vertex: { chunks: [lib.view.fullscreen], main: "void main() { fullscreenTriangle(); }" },
  fragment: {
    chunks: [lib.view.groundHit, lib.view.depth, lib.dither.screens, lib.palette.ramps, lib.light.gatherGround, lib.tone.addStepped, lib.noise.value, redlineField, redlineMarks],
    main: /* glsl */ `
uniform highp sampler2D uField;
uniform vec4 uFieldInfo, uTrack, uStart;
void main() {
  vec3 p;
  if (!groundHit(gl_FragCoord.xy, p)) { outColour = skyGradient(); gl_FragDepth = 1.0; return; }
  gl_FragDepth = groundDepth(p);
  ... // materials from the field, marks, then:
  LightHit h = lightGatherGround(p.xz);
  outColour = vec4(rampColourLit(m, tone, h, screenAnchor(ivec2(gl_FragCoord.xy), kViewAnchor())), 1.0);
  emit(h.colour, h.glowK);
}`,
  },
  variants: { PERSP: [0, 1], WET: [0, 1] },
  outputs: { outColour: { location: 0, type: "vec4" }, outEmit: { location: 1, type: "vec4" } },
});

// per frame
const g = shaders.get(GROUND, { PERSP: view.kind === "persp" ? 1 : 0, WET: wet > 0 ? 1 : 0 });
g.use(); g.tex("uField", fieldTex); g.tex("uMarks", marksTex); g.u.uFieldInfo(info); g.u.uTrack(track);
```

### Phase 2: scene target, surfaces, lit and soft effects

- `createFrameGraph` and the scene target (colour, emit, depth, depth copy),
  plus the present blit. REDLINE moves its frame onto it (7.1).
- `packs/surfaces`: ids, `classifyRoad` + GLSL twin + parity vectors,
  `KSurfaces`, `material/ground`, `SURFACE_FX` with the recipes of 6.3. The
  sim carries `wheel.surface`, and REDLINE's `effects()` reads the table.
- Pool **volume mode** (6.4) with curl/fbm noise, `LIT=1` and `SOFT=1`.
  REDLINE's `puffs[]` goes. Particles get `LIT=1` and `SOFT=1` by default.
- Gate: the effect gallery (each surface × slide/spin/roll, day/night, both
  cameras) reviewed. The frame graph's GPU time at 320×180 stays ≤ 2.5 ms on
  the reference laptop.

### Phase 3: meshes on blocks, generalised bloom, wet, neon, light map

- `MESH_GFS` reads `KLights` (removing 112 vectors of arrays), `KView`
  replaces its view uniforms, and `MESH_FS` + the layer variants
  (`BILLBOARD/FX/SWAY`) become one chunked `bake/layer` program with defines.
  The `.replace()` guards go. keel/bake vectors re-pinned once.
- Bloom reads `scene.emit`. The mesh paint writes emit.
- Wet roads (6.8), underglow as a projected light (6.5), and the ground
  light map (5.3), which REDLINE's city uses for its street lamps and signs.

### Phase 4: screens, jets, the rest of the engine

- LED/video screen finish (6.9), the nitro jet volume (6.7).
- terrain and dungeon onto the library where they're already
  parity-equivalent (terrain's `hashU/vnoise2/fbm2` *are* the library's), the
  dungeon's `VIEW_UNIFORMS/SHADE/LIGHT` onto `view/*`, `palette/*` and the
  light map. The dungeon's flames can share the jet volume.

### Phase 5: keel/render, once the proof of concept is retired

`WORLD_FS`, `RASTER_FS`, `PIXEL_FS` (+ `DIRECT_MAT` as a define),
`BAKE_WORLD_FS`/`HEIGHT_FS` as variants, the sky. Only after the POC stops
being the reference (ARCHITECTURE.md "Phases"), because until then equality
with the POC is the test. The `sdf/*` and `legacy/sin-hash` chunks are written
to match these character for character, so this is a move, not a rewrite.

---

## 9. Risks and open questions

- **Chunk granularity vs. module size.** Too many small chunks cost bytes in
  declarations and hashes. Measure keel/shader's slug in phase 1 and keep the
  library to what two or more programs use (a chunk used once stays in its
  program).
- **Palette-true ground vs. REDLINE's current look.** The oklch RGB ground and
  additive colour light are part of its synthwave feel. `addStepped` keeps
  stepped additive colour available, so the change is a review decision, not
  a forced one.
- **Classifier parity.** A GLSL twin of float thresholds can land either side
  of an edge for a pixel here and there, as terrain's parity notes say. That's
  acceptable for drawing (the physics owns the answer), but the parity tool
  should report it.
- **Presentation randomness.** REDLINE's effects use `Math.random`, which the
  conventions allow for presentation. Moving puffs onto the pool gives seeded
  streams, so a replay also *looks* identical. It's worth doing but not
  required.
- **Sampling limits.** Soft particles plus the light map plus the palette plus
  the state textures is 9 samplers in `PARTICLE_VS/FS`, inside 16, but the
  registry's allocator should fail loudly past the limit.
- **Hot reload scope.** Only chunk GLSL reloads. Changing a block's layout or
  a program's variant space needs a page reload, which the dev overlay should
  say.
- **Owner call:** whether `packs/surfaces` is a pack (the proposal) or part of
  `packs/vehicles`. It serves terrain games too (dirt, sand, grass ground
  materials), which argues for its own pack.
