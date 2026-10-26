# `@keel-engine/lit`

The full-colour lit renderer (WebGL2). Meshes and instances lit by a sun, a
moon and the sky, with physically based and toon surfaces, soft shadows, fog,
render targets and custom shaders. Module `keel/lit@0.1.0` (`kind: "runtime"`).

`keel/render` is the pixel-art path: palette ramps, dither screens, outlines,
everything palette-true. `keel/lit` is the other path: full colour, for
pieces whose look is lit 3D (the Cherry Blossom grove first), with any pixel
treatment done as a post pass the piece owns.

## Parity

`keel/lit` reproduces the shading and geometry of Three.js r180 (MIT, see
`NOTICE`) for the parts a piece uses, so a piece moved onto it draws the same
pixels. Ported code keeps r180's arithmetic exactly:

- **The same operations in the same order.** Matrix products, normal
  matrices, quaternion and Euler conversions, colour space conversions and
  geometry generators are ported line for line. No "simplified" maths: a
  reordered sum moves a vertex by an ulp and a shadow edge by a pixel.
- **The same float storage.** Attributes, uniforms and instance buffers are
  `Float32Array` where r180's are, filled in r180's order.
- **The same GLSL.** Shader chunks are r180's text. A program is assembled
  from the same chunks in the same order with the same defines, so the GPU
  compiles the same code.
- **The same GL state, in the same order.** Draw order (opaque front to back,
  transparent back to front, by r180's sort keys), blending, depth and face
  culling match.

Tests hold the port to recorded r180 outputs (`test/fixtures/*.json`, made
from r180 itself; the generator lives outside this repo so Three is never a
dependency here). The grove's parity harness compares whole frames.

## Names

KEEL's own names. Plain maths names stay as they are everywhere.

| r180 | `keel/lit` |
| --- | --- |
| `Vector2`, `Vector3`, `Vector4`, `Matrix3`, `Matrix4`, `Quaternion`, `Euler`, `Color`, `Box3`, `Sphere`, `Plane`, `Frustum` | the same (maths) |
| `MathUtils` | `mathUtils` |
| `EventDispatcher` | `Emitter` |
| `Object3D` | `Node` |
| `Group` | `Group` |
| `Scene` | `Stage` (`.fog`, `.background`) |
| `Mesh` | `Mesh` |
| `InstancedMesh` | `Instances` (`.setMatrixAt`, `.setColorAt`, `.instanceMatrix`, `.instanceColor`) |
| `Sprite` | `Billboard` |
| `BufferGeometry` | `Geometry` |
| `BufferAttribute`, `Float32BufferAttribute` | `Attribute` (`new Attribute(new Float32Array(...), size)`) |
| `InstancedBufferAttribute` | `InstanceAttribute` |
| `BoxGeometry`, `CylinderGeometry`, `ConeGeometry`, `SphereGeometry`, `IcosahedronGeometry`, `OctahedronGeometry`, `DodecahedronGeometry`, `TetrahedronGeometry`, `PlaneGeometry`, `RingGeometry`, `TorusGeometry`, `TubeGeometry`, `LatheGeometry`, `ExtrudeGeometry` | `box()`, `cylinder()`, `cone()`, `sphere()`, `icosahedron()`, `octahedron()`, `dodecahedron()`, `tetrahedron()`, `plane()`, `ring()`, `torus()`, `tube()`, `lathe()`, `extrude()`: functions returning a `Geometry`, r180's parameters in r180's order |
| `Shape`, `CatmullRomCurve3` | `Shape`, `CatmullRomCurve3` |
| `MeshStandardMaterial` | `LitMaterial` |
| `MeshToonMaterial` | `ToonMaterial` |
| `MeshBasicMaterial` | `FlatMaterial` |
| `SpriteMaterial` | `BillboardMaterial` |
| `ShaderMaterial` | `CustomMaterial` |
| `onBeforeCompile(shader)` | `onCompile(shader)` (the same `shader.vertexShader` / `fragmentShader` / `uniforms` to edit) |
| `DirectionalLight` | `SunLight` (`.shadow`) |
| `HemisphereLight` | `SkyLight` |
| `AmbientLight` | `AmbientLight` |
| `PerspectiveCamera`, `OrthographicCamera` | `PerspectiveCamera`, `OrthoCamera` |
| `Fog` | `Fog` |
| `Texture`, `DataTexture`, `CanvasTexture`, `DepthTexture` | the same |
| `WebGLRenderTarget` | `RenderTarget` |
| `WebGLRenderer` | `createLitRenderer(canvas, options)` |

Constants are typed strings: `side: "front" | "back" | "both"`, `blending:
"normal" | "add" | "none"`, texture `filter: "nearest" | "linear"`, `wrap:
"clamp" | "repeat"`, `type: "u8" | "half" | "float"`, `format: "rgba" |
"red"`, `colorSpace: "srgb" | "linear" | ""`, renderer `shadows: "pcf-soft"`,
`toneMapping: "none"`.

## Layout

| File | What |
| --- | --- |
| `src/math/*.ts` | vectors, matrices, quaternion, Euler, colour (and colour management), boxes, spheres, planes, frustum, `mathUtils` |
| `src/core/*.ts` | `Emitter`, `Node`, `Geometry`, `Attribute`, `InstanceAttribute` |
| `src/geometry/*.ts` | the generators, shapes, curves, triangulation |
| `src/scene/*.ts` | `Stage`, `Group`, `Mesh`, `Instances`, `Billboard`, cameras, lights and their shadows, `Fog` |
| `src/material/*.ts` | the materials |
| `src/texture/*.ts` | textures and `RenderTarget` |
| `src/shader/*.ts` | the GLSL: chunks, libraries, uniforms |
| `src/gl/*.ts` | the renderer: programs, uniforms, state, buffers, textures, render lists, lights, shadow maps |
| `src/index.ts` | the public API |
