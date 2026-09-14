// Raster mode (engine; not in the proof of concept): solids and meshes drawn
// as triangles into pass 1's own buffers -- lightness, ramp, material, id;
// glow, facing; depth as the ray's length over FAR -- so the pixel pass turns
// them into pixel art exactly as it does the raymarched world: palette ramps,
// the dither screen, the outline against what's behind, the fog, every fx.
//
// Why: the raymarcher holds 256 boxes, 128 wedges and 256 capsules and marches
// all of them for every pixel -- a runner's course, a character, a room. A
// world seen from the ground (a first-person view of a level, a chase camera
// over it) has thousands of things near enough to be solid. Rasterised, a
// capsule is ~100 triangles and ten thousand of them are one instanced draw;
// a terrain chunk is one static mesh.
//
//   px.setMesh("chunk:3", { positions, normals, looks });           // static: uploaded once
//   const solids = new RasterSolids(4096);
//   solids.capsule(a, b, r, mat, { id: 7 }); solids.box(c, h, yaw, mat); solids.wedge(c, h, yaw, lo, mat);
//   px.render({ eye, target, fov, raster: { solids, meshes: ["chunk:3"] }, depthOut: true });
//
// Lighting is WORLD_FS's (sun, sky light, the water's glow on what stands in
// it, the checker pattern, the fog), less the raymarched soft shadow; two more
// patterns for a ground seen close (material pattern 2: grain, 3: strata) and a
// rippling water surface (material 4). A
// solid's `fade` (0..1) dissolves it through a 4x4 Bayer screen anchored to
// the picture -- a thing switching between a sprite and its solid cross-fades
// with no alpha: the sprite keeps the pixels the solid gives up
// (keel/bake's drawBillboards fades the other way).
//
// Everything here compiles the first time a frame asks for it: a renderer
// that never rasterises makes the proof of concept's GL calls, call for call.

import { FAR, PIXEL_FS, WATER_MAT } from "./shaders.ts";

/** Floats per raster instance: four vec4s (see RasterSolids). */
export const RASTER_FLOATS = 16;

/** One kind of instanced solid, in a growable typed array. */
export class RasterBuffer {
  data: Float32Array;
  count = 0;
  constructor(capacity = 256) { this.data = new Float32Array(Math.max(1, capacity) * RASTER_FLOATS); }
  get capacity(): number { return this.data.length / RASTER_FLOATS; }
  /** The next instance's offset (growing the array when full). */
  next(): number {
    if (this.count >= this.capacity) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    return (this.count++) * RASTER_FLOATS;
  }
  clear(): void { this.count = 0; }
  /** Copy whole instances in (a static thing's solids, made once): returns the first one's offset. */
  append(block: Float32Array, count = block.length / RASTER_FLOATS): number {
    const at = this.count * RASTER_FLOATS;
    const need = at + count * RASTER_FLOATS;
    if (need > this.data.length) { let n = this.data.length; while (n < need) n *= 2; const d = new Float32Array(n); d.set(this.data.subarray(0, at)); this.data = d; }
    this.data.set(count * RASTER_FLOATS === block.length ? block : block.subarray(0, count * RASTER_FLOATS), at);
    this.count += count;
    return at;
  }
  /** The instances so far, as one block (to keep and append later). */
  snapshot(): Float32Array { return this.data.slice(0, this.count * RASTER_FLOATS); }
}

/** How a solid is painted beyond its material. */
export interface RasterLook {
  /** A ramp to wear instead of the material's (its index in the palette's ramp order; -1 or absent: the material's). */
  readonly ramp?: number | undefined;
  /** Lightness scale on top of the material's (default 1). */
  readonly light?: number | undefined;
  /** Which thing it is, for the outline (0..249: two solids with different ids get an edge between them). */
  readonly id?: number | undefined;
  /** How much of it is drawn, 0..1 (default 1): a dithered dissolve. */
  readonly fade?: number | undefined;
  /** Added lightness (and the glow fx's emissive), 0..1. */
  readonly glow?: number | undefined;
}

/**
 * Instanced solids for a raster frame. Layout per instance (RASTER_FLOATS):
 *   box      [cx, cy, cz, mat,  hx, hy, hz, yaw,  0,  ramp, light, id,  fade, glow, 0, 0]
 *   wedge    [cx, cy, cz, mat,  hx, hy, hz, yaw,  lo, ramp, light, id,  fade, glow, 0, 0]
 *   capsule  [ax, ay, az, mat,  bx, by, bz, r,    0,  ramp, light, id,  fade, glow, 0, 0]
 * Write straight into `boxes.data` etc. for speed; the helpers below are the readable way.
 */
export class RasterSolids {
  readonly boxes: RasterBuffer;
  readonly wedges: RasterBuffer;
  readonly capsules: RasterBuffer;
  constructor(capacity = 1024) { this.boxes = new RasterBuffer(capacity); this.wedges = new RasterBuffer(capacity >> 2); this.capsules = new RasterBuffer(capacity); }
  clear(): void { this.boxes.clear(); this.wedges.clear(); this.capsules.clear(); }
  get count(): number { return this.boxes.count + this.wedges.count + this.capsules.count; }
  box(c: ArrayLike<number>, h: ArrayLike<number>, yaw: number, mat: number, look: RasterLook = {}): void { put(this.boxes, c, h, yaw, mat, 0, look); }
  wedge(c: ArrayLike<number>, h: ArrayLike<number>, yaw: number, lo: number, mat: number, look: RasterLook = {}): void { put(this.wedges, c, h, yaw, mat, Math.max(0, Math.min(0.98, lo)), look); }
  capsule(a: ArrayLike<number>, b: ArrayLike<number>, r: number, mat: number, look: RasterLook = {}): void { put(this.capsules, a, b, r, mat, 0, look); }
}

function put(buf: RasterBuffer, p: ArrayLike<number>, q: ArrayLike<number>, w: number, mat: number, lo: number, look: RasterLook): void {
  const o = buf.next();
  const d = buf.data;
  d[o] = p[0]!; d[o + 1] = p[1]!; d[o + 2] = p[2]!; d[o + 3] = mat;
  d[o + 4] = q[0]!; d[o + 5] = q[1]!; d[o + 6] = q[2]!; d[o + 7] = w;
  d[o + 8] = lo; d[o + 9] = look.ramp ?? -1; d[o + 10] = look.light ?? 1; d[o + 11] = look.id ?? 0;
  d[o + 12] = look.fade ?? 1; d[o + 13] = look.glow ?? 0; d[o + 14] = 0; d[o + 15] = 0;
}

/**
 * A static mesh (a terrain chunk): triangles, a normal per vertex, and per vertex its look -- material, ramp
 * override (-1: the material's), a lightness offset (shade, added), and an id for the outline. `indices` optional.
 */
export interface RasterMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** [mat, ramp, shade, id] per vertex. */
  readonly looks: Float32Array;
  readonly indices?: Uint32Array | undefined;
}

/**
 * What a raster hook is given: the context (pass 1's framebuffer bound, both colour attachments drawn, depth test on,
 * the viewport the target's), the camera, and the depth convention (gl_FragDepth = distance / far). It writes pass 1's
 * buffers as RASTER_FS does -- or a palette index straight (DIRECT_MAT) -- and leaves the framebuffer, viewport and
 * draw buffers as it found them.
 */
export interface RasterContext {
  readonly gl: WebGL2RenderingContext;
  readonly eye: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  /** tan(fov / 2). */
  readonly tan: number;
  readonly width: number;
  readonly height: number;
  /** Depth is distance / far. */
  readonly far: number;
  readonly time: number;
  readonly sun: readonly [number, number, number];
}

/**
 * Engine: a pixel whose pass-1 material is DIRECT_MAT carries a palette INDEX, not a lightness on a ramp -- so a
 * program that does its own ramps and dithering (keel/terrain's GPU ground, in texture space) goes through the pixel
 * pass's outline and fog untouched. Encoding: data = (index & 255, index >> 8, DIRECT_MAT, id) / 255; data2 = (glow,
 * facing, the position on its ramp 0..1 (what the fog mixes from), pos | min(len, 15) << 4) / 255 -- data2.a > 0 marks it.
 */
export const DIRECT_MAT = 254;

/** What a frame rasterises: instanced solids, and static meshes by the keys setMesh gave them. */
export interface RasterFrame {
  readonly solids?: RasterSolids | undefined;
  readonly meshes?: readonly string[] | undefined;
  /** Engine: drawn after the meshes and solids into the same buffers (keel/terrain's GPU ground, a sky): see RasterContext. */
  readonly draw?: ((ctx: RasterContext) => void) | undefined;
  /**
   * Engine: false skips the raymarched world and sky -- pass 1 starts as sky at depth 1 and the raster (and a hook, a
   * sky pass) paints it. For a world that is all raster (a terrain seen from the ground): the full-screen march is
   * most of a big picture's cost. Default true (the proof of concept's pass).
   */
  readonly world?: boolean | undefined;
  /**
   * The level the water's glow rises from on what's rasterised (default: render's waterY). A world whose water is its
   * own meshes (a terrain's rivers) turns the raymarched plane off -- render({ waterY: -1e4 }) -- and keeps the glow here.
   */
  readonly waterY?: number | undefined;
}

/** After the picture, pass 1's depth into the canvas's own depth buffer (depth x scale + bias): so later draws -- billboards -- are hidden by what's in front. */
export interface DepthOut {
  readonly scale?: number | undefined;
  readonly bias?: number | undefined;
}

// ---------------------------------------------------------------- templates

/** A template: positions, normals (3 floats each), triangle indices. */
export interface RasterTemplate { readonly verts: Float32Array; readonly norms: Float32Array; readonly index: Uint16Array }

/** A unit box (-1..1), a face at a time (flat normals): 24 vertices, 36 indices. Its wedge is the same box, its +z top edge lowered in the shader. */
export function boxTemplate(): RasterTemplate {
  const faces: Array<[number[], number[], number[]]> = [
    // normal, u axis, v axis (u x v = normal: counter-clockwise from outside)
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const verts: number[] = [], norms: number[] = [], index: number[] = [];
  faces.forEach(([n, u, v], f) => {
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      verts.push(n[0]! + u[0]! * a + v[0]! * b, n[1]! + u[1]! * a + v[1]! * b, n[2]! + u[2]! * a + v[2]! * b);
      norms.push(n[0]!, n[1]!, n[2]!);
    }
    index.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return { verts: Float32Array.from(verts), norms: Float32Array.from(norms), index: Uint16Array.from(index) };
}

/**
 * A unit capsule: `around` segments round, `rings` rings per hemisphere. Each vertex is
 * (cos theta, sin theta, sin phi) with (cos phi, end, 0): the shader puts it on the hemisphere of end a (0) or
 * b (1), phi from the pole (-pi/2 toward its own end) to the equator; the two equators make the cylinder.
 */
export function capsuleTemplate(around = 10, rings = 3): RasterTemplate {
  const verts: number[] = [], norms: number[] = [], index: number[] = [];
  const row = around + 1;
  // Rows from a's pole to a's equator, then b's equator to b's pole.
  const rows: Array<[number, number]> = [];
  for (let k = 0; k <= rings; k += 1) rows.push([-Math.PI / 2 + (k / rings) * (Math.PI / 2), 0]);
  for (let k = 0; k <= rings; k += 1) rows.push([(k / rings) * (Math.PI / 2), 1]);
  for (const [phi, end] of rows) for (let i = 0; i <= around; i += 1) {
    const th = (i / around) * Math.PI * 2;
    verts.push(Math.cos(th), Math.sin(th), Math.sin(phi));
    norms.push(Math.cos(phi), end, 0);
  }
  for (let r = 0; r < rows.length - 1; r += 1) for (let i = 0; i < around; i += 1) {
    const a = r * row + i, b = a + 1, c = a + row, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  return { verts: Float32Array.from(verts), norms: Float32Array.from(norms), index: Uint16Array.from(index) };
}

// ---------------------------------------------------------------- shaders

const FARS = FAR.toFixed(1);

/** Kinds (uKind): 0 a static mesh, 1 boxes, 2 wedges, 3 capsules. */
export const RASTER_VS = `#version 300 es
layout(location=0) in vec3 aVert;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec4 aI0;
layout(location=3) in vec4 aI1;
layout(location=4) in vec4 aI2;
layout(location=5) in vec4 aI3;
uniform int uKind;
uniform vec3 uEye, uFwd, uRight, uUp;
uniform float uTan, uAspect;
out vec3 vPos;
out vec3 vNorm;
flat out vec4 vLook;   // material, ramp (-1: the material's), light scale, id
flat out vec4 vFx;     // fade, glow, 0, 0
out float vShade;      // a mesh vertex's lightness offset
// (Own frame -> world, the inverse of WORLD_FS's world -> box turn: x = c x' + s z', z = -s x' + c z'.)
vec3 turn(vec3 q, float yaw) { float c = cos(yaw), s = sin(yaw); return vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z); }
void main() {
  vec3 p; vec3 n;
  vShade = 0.0;
  if (uKind == 0) {
    p = aVert; n = aNorm;
    vLook = vec4(aI0.x, aI0.y, 1.0, aI0.w); vFx = vec4(1.0, 0.0, 0.0, 0.0); vShade = aI0.z;
  } else if (uKind == 3) {
    vec3 a = aI0.xyz, b = aI1.xyz;
    float r = aI1.w;
    vec3 ax = b - a;
    float L = length(ax);
    ax = L > 1e-6 ? ax / L : vec3(0.0, 1.0, 0.0);
    vec3 u = normalize(abs(ax.y) < 0.9 ? cross(ax, vec3(0.0, 1.0, 0.0)) : cross(ax, vec3(1.0, 0.0, 0.0)));
    vec3 v = cross(ax, u);
    float sp = aVert.z, cp = aNorm.x;
    bool atB = aNorm.y > 0.5;
    // (phi runs from a's pole -- back along the axis, sin phi = -1 -- through the two equators to b's.)
    vec3 d = cp * (aVert.x * u + aVert.y * v) + sp * ax;
    p = (atB ? b : a) + r * d;
    n = d;
    vLook = vec4(aI0.w, aI2.y, aI2.z, aI2.w); vFx = aI3;
  } else {
    vec3 h = aI1.xyz;
    vec3 q = aVert;
    vec3 nq = aNorm;
    if (uKind == 2) {
      float lo = aI2.x;
      // (The +z edge of the top comes down to the foot: lo x its height.)
      if (q.y > 0.5 && q.z > 0.5) q.y = -1.0 + 2.0 * lo;
      if (nq.y > 0.5) nq = normalize(vec3(0.0, 2.0 * h.z, 2.0 * h.y * (1.0 - lo)));
    }
    p = aI0.xyz + turn(q * h, aI1.w);
    n = turn(uKind == 2 ? nq : aNorm, aI1.w);
    vLook = vec4(aI0.w, aI2.y, aI2.z, aI2.w); vFx = aI3;
  }
  vPos = p; vNorm = n;
  vec3 e = p - uEye;
  float z = dot(e, uFwd);
  const float NEAR = 0.05, FARZ = ${FARS} * 1.5;
  gl_Position = vec4(dot(e, uRight) / (uTan * uAspect), dot(e, uUp) / uTan, z * (FARZ + NEAR) / (FARZ - NEAR) - 2.0 * FARZ * NEAR / (FARZ - NEAR), z);
}`;

export const RASTER_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uMats;
uniform vec3 uEye, uSun;
uniform float uWaterY, uFogNear, uFogFar, uTan, uTime;
uniform vec2 uRes;
in vec3 vPos;
in vec3 vNorm;
flat in vec4 vLook;
flat in vec4 vFx;
in float vShade;
layout(location = 0) out vec4 outData;
layout(location = 1) out vec4 outData2;
float bayer4(ivec2 p) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
vec4 matOf(int i) { return texelFetch(uMats, ivec2(i, 0), 0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
// (Engine patterns past the checker: 2 grain -- a ground's speckle, blades and pebbles at a pixel or two -- and 3
// strata -- a cliff's bands. Both fade out where a cell would be under a pixel, as the checker does.)
float grain(vec3 p, vec3 n, float px) {
  vec2 uv = abs(n.y) > 0.6 ? p.xz : abs(n.x) > abs(n.z) ? p.zy : p.xy;
  float fine = hash(floor(uv * 7.0)) - 0.5, coarse = vnoise(uv * 0.9) - 0.5;
  return (fine * 0.12 * smoothstep(1.2, 3.0, px / 7.0) + coarse * 0.14);
}
float strata(vec3 p, float px) { return (vnoise(vec2(p.x * 0.7 + p.z * 0.7, p.y * 3.1)) - 0.5) * 0.2 + (hash(floor(vec2(p.x + p.z, p.y) * 5.0)) - 0.5) * 0.07 * smoothstep(1.2, 3.0, px / 5.0); }
float tiles(vec3 p, vec3 n) {
  vec2 uv = abs(n.y) > 0.6 ? p.xz : abs(n.x) > abs(n.z) ? p.zy : p.xy;
  vec2 f = fract(uv);
  float joint = step(0.95, max(f.x, f.y)) * 0.06;
  float chk = mod(floor(uv.x) + floor(uv.y), 2.0);
  return 0.16 * chk - 0.08 - joint;
}
void main() {
  // (A dissolve: the solid keeps the screen's lower thresholds, a sprite fading in keeps the rest.)
  if (vFx.x < 0.999 && bayer4(ivec2(gl_FragCoord.xy)) >= vFx.x) discard;
  vec3 n = normalize(vNorm);
  vec3 e = vPos - uEye;
  float dist = length(e);
  vec3 rd = e / max(dist, 1e-6);
  if (dot(n, rd) > 0.0) n = -n; // (a face seen from behind: light it as its front)
  int mi = int(vLook.x + 0.5);
  vec4 mr = matOf(mi);
  float ramp = vLook.y >= 0.0 ? vLook.y : mr.x;
  float L;
  float tilePx = uRes.y / max(dist * 2.0 * uTan, 1e-3); // (picture pixels a metre here)
  if (mi == ${WATER_MAT}) {
    // (Water as a surface: dark and deep, rippled, brighter toward the eye's grazing angle, a glint here and there.)
    float ripple = vnoise(vPos.xz * 1.3 + vec2(uTime * 0.35, uTime * 0.22)) * vnoise(vPos.xz * 0.6 - vec2(uTime * 0.1, 0.0));
    float glint = step(0.8, vnoise(vPos.xz * 4.0 + uTime * 0.7)) * 0.25 * clamp(1.0 - dist / 40.0, 0.0, 1.0);
    L = 0.14 + 0.22 * ripple + 0.2 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 3.0) + glint + vShade;
  } else {
    float diff = max(dot(n, uSun), 0.0);
    float wglow = clamp(1.0 - (vPos.y - uWaterY) / 1.6, 0.0, 1.0) * max(0.0, -n.y * 0.2 + 0.8) * 0.35;
    L = (0.16 + 0.1 * n.y + 0.5 * diff) * mr.y * vLook.z + wglow + mr.w + vFx.y + vShade;
    float patternK = smoothstep(2.5, 7.0, tilePx) * (0.35 + 0.65 * smoothstep(28.0, 96.0, uRes.y));
    if (mr.z > 0.5 && mr.z < 1.5) L += tiles(vPos, n) * patternK;
    else if (mr.z > 1.5 && mr.z < 2.5) L += grain(vPos, n, tilePx);
    else if (mr.z > 2.5 && mr.z < 3.5) L += strata(vPos, tilePx);
  }
  L = mix(L, 0.12, clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0));
  outData = vec4(clamp(L, 0.0, 1.0), ramp / 255.0, float(mi) / 255.0, mod(vLook.w, 250.0) / 255.0);
  outData2 = vec4(clamp(mr.w + vFx.y, 0.0, 1.0), clamp(dot(n, -rd), 0.0, 1.0), 0.0, 0.0);
  gl_FragDepth = clamp(dist / ${FARS}, 0.0, 1.0);
}`;

/** Pass 1's depth into the bound framebuffer's depth buffer, colour untouched (colorMask off). */
export const DEPTH_OUT_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDepth;
uniform vec2 uMap; // scale, bias
out vec4 outColor;
void main() {
  gl_FragDepth = clamp(texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r * uMap.x + uMap.y, 0.0, 1.0);
  outColor = vec4(0.0);
}`;

/**
 * Pass 2 for a frame with a raster hook: PIXEL_FS, plus DIRECT_MAT pixels (a palette index straight; the fog still
 * takes them to its ramp, the outline still darkens them along their own ramp). Compiled only when a frame has a hook:
 * a renderer that never uses one runs PIXEL_FS, the proof of concept's, call for call.
 */
export const DIRECT_PIXEL_FS = PIXEL_FS
  .replace("  float L = d.r;\n", `  float L = d.r;
  // (Engine, DIRECT_MAT: a palette index straight -- its ramp's base, length and place ride along for the outline and fog.)
  int directBase = -1, directLen = 1, directPos = 0;
  if (mat == ${DIRECT_MAT} && d2.a > 0.0) {
    int pl = int(d2.a * 255.0 + 0.5);
    directPos = pl & 15;
    directLen = max(1, pl >> 4);
    directBase = int(d.r * 255.0 + 0.5) + int(d.g * 255.0 + 0.5) * 256 - directPos;
    L = d2.b;
  }
`)
  .replace("  if (uGrade.x > 0.5) { float g", "  if (uGrade.x > 0.5 && directBase < 0) { float g")
  .replace("    if (f > s) { ramp = int(uFogLook.x); L = mix(L, uFogLook.y, f); }\n  }\n  vec4 R = rampOf(ramp);", "    if (f > s) { ramp = int(uFogLook.x); L = mix(L, uFogLook.y, f); directBase = -1; }\n  }\n  vec4 R = directBase >= 0 ? vec4(float(directBase), float(directLen), 0.0, 0.0) : rampOf(ramp);")
  .replace("  float x = L * top;\n", "  float x = directBase >= 0 ? float(directPos) : L * top;\n");
if (!DIRECT_PIXEL_FS.includes("directBase = -1; }") || !DIRECT_PIXEL_FS.includes("float(directPos) : L * top") || !DIRECT_PIXEL_FS.includes("directBase < 0) { float g") || !DIRECT_PIXEL_FS.includes("directPos = pl & 15")) throw new Error("DIRECT_PIXEL_FS: PIXEL_FS changed under its edits.");
