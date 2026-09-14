// The sprite renderer: every visible sprite in one instanced draw. Baked
// sprites live in a texture array (one layer per atlas page); each instance
// is a world position, an atlas rectangle, its anchor and a layer; the vertex
// shader projects the position through the pixel view and snaps the quad to
// whole pixels, so sprites land texel for pixel; depth comes from the
// position (nearer the camera draws over), so there is no sorting on the CPU.
// Draw at the target resolution into the canvas; the page scales it up
// nearest-neighbour.
//
// drawLayers() is the same draw for INDEXED sprites (indexed.ts): each
// instance names a look (looks.ts), and the fragment shader turns a texel's
// slot, shade and surface coordinate into a palette entry through it -- the
// finish, the pattern, a screen-anchored dither, the outline. One baked shape,
// any number of looks, still one instanced draw (plain RGBA sprites ride
// along with look -1). An instance's depth bias puts an attribute a hair in
// front of its own body, or behind it.
//
//   const sr = createSpriteRenderer(canvas, { width, height, capacity: 8192 });
//   sr.setPages(pages);                    // [{ width, height, rgba }] -- the baked atlas
//   sr.draw(view, instances, count);       // instances: a SpriteInstances buffer you fill each frame

import type { PixelView } from "./view.ts";
import { HEIGHT_STEPS, SLOTS } from "./indexed.ts";
import { LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW } from "./looks.ts";
import { SWAY_INSTANCE_FLOATS, SWAY_VS, swayFragment } from "./sway.ts";
import { SPRITE_DEPTH_GLSL, depthKappa } from "./depth.ts";
import type { DepthAxis } from "./depth.ts";
import type { SwayInstances, WindStyle } from "./sway.ts";

const SLOTS_GLSL = String(SLOTS);
const LOOKS_PER_ROW_GLSL = String(LOOKS_PER_ROW);
const LOOK_TEXELS_GLSL = String(LOOK_TEXELS);
const PAINTS_PER_ROW_GLSL = String(PAINTS_PER_ROW);
const PALETTE_ROW_GLSL = String(PALETTE_ROW);

/** Floats per instance: x, y, z, u0, v0, w, h (atlas pixels), ax, ay (anchor, pixels from the sprite's top-left), layer, flags, scale. */
export const INSTANCE_FLOATS = 12;

export class SpriteInstances {
  readonly capacity: number;
  readonly data: Float32Array;
  count = 0;
  constructor(capacity: number) { this.capacity = capacity; this.data = new Float32Array(capacity * INSTANCE_FLOATS); }
  /**
   * Add one: world position, atlas rect, anchor, page layer. `scale` draws it bigger or smaller (texels
   * per picture pixel; 1 is texel for pixel -- a bake made at another scale shows at its right size
   * while the new one bakes). Returns false when full.
   */
  push(x: number, y: number, z: number, u0: number, v0: number, w: number, h: number, ax: number, ay: number, layer: number, flags = 0, scale = 1): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count * INSTANCE_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u0; d[o + 4] = v0; d[o + 5] = w; d[o + 6] = h; d[o + 7] = ax; d[o + 8] = ay; d[o + 9] = layer; d[o + 10] = flags; d[o + 11] = scale;
    this.count += 1;
    return true;
  }
  clear(): void { this.count = 0; }
}

/**
 * Floats per LAYER instance (drawLayers): x, y, z, u0, v0, w, h, ax, ay, layer, look, bias, scale, spare. `look` is
 * the look table's index for an indexed sprite (-1: the texels are plain RGBA, as draw() takes them); `bias` is how
 * far (metres) its texels sit from its position's depth: those behind its split point that far behind, the rest that
 * far in front -- an attribute on its own body (0 for a body).
 */
export const LAYER_INSTANCE_FLOATS = 14;

export class LayerInstances {
  readonly capacity: number;
  readonly data: Float32Array;
  count = 0;
  constructor(capacity: number) { this.capacity = capacity; this.data = new Float32Array(capacity * LAYER_INSTANCE_FLOATS); }
  /** Add one: world position, atlas rect, anchor, page layer, look (-1 plain), depth bias (m, see above), scale. Returns false when full. */
  push(x: number, y: number, z: number, u0: number, v0: number, w: number, h: number, ax: number, ay: number, layer: number, look: number, bias = 0, scale = 1): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count * LAYER_INSTANCE_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u0; d[o + 4] = v0; d[o + 5] = w; d[o + 6] = h; d[o + 7] = ax; d[o + 8] = ay; d[o + 9] = layer; d[o + 10] = look; d[o + 11] = bias; d[o + 12] = scale; d[o + 13] = 0;
    this.count += 1;
    return true;
  }
  clear(): void { this.count = 0; }
}

/** A look table's three textures (looks.ts): the palette (RGBA8), the paints and the looks (RGBA32UI). */
export interface LookTextures {
  readonly palette: { readonly width: number; readonly height: number; readonly rgba: Uint8Array };
  readonly paints: { readonly width: number; readonly height: number; readonly data: Uint32Array };
  readonly looks: { readonly width: number; readonly height: number; readonly data: Uint32Array };
}
/** How drawLayers turns indexed texels into pixels. */
export interface LayerStyle {
  /** The dither screen: 0 none, 2, 4 or 8 (Bayer), anchored to the screen (default 4). */
  readonly screen?: number;
  /** How far the screen reaches between two entries (default 0.9). */
  readonly dither?: number;
  /** Entries darker on an outline edge (default 3, the pixel pass's classic). */
  readonly outline?: number;
  /** Clear to this colour first (RGB 0..1; null keeps what's drawn, depth included). */
  readonly clear?: readonly [number, number, number] | null;
  /**
   * Depth sprites (depth.ts): each texel at the depth of the point it shows, from the pages' heights (default on when
   * the pages carry them; texels without a height keep their anchor's depth, as before).
   */
  readonly heights?: boolean;
  /** Which depth the scene writes (depth.ts): "ground" (keel/terrain's; sprites placed by spritePosition -- default) or "view". */
  readonly depth?: DepthAxis;
  /** Depth sprites: metres a texel wins a tie with what's under it by (default 5 mm: over the CPU ground's depth steps). */
  readonly tie?: number;
  /**
   * An ID picture instead of colours (picking, the occlusion checks): every pixel its instance's index + 1 + `idBase`,
   * 24 bits over RGB (depth as ever).
   */
  readonly ids?: boolean;
  readonly idBase?: number;
}

/** An atlas page: RGBA texels, and for depth sprites a height per texel (two bytes each, high then low: indexed.ts). */
export interface AtlasPage { readonly width: number; readonly height: number; readonly rgba: Uint8Array; readonly heights?: Uint8Array | undefined }

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;           // 0..1 quad corner
layout(location=1) in vec3 aPos;              // world position (the sprite's ground anchor)
layout(location=2) in vec4 aRect;             // u0, v0, w, h in atlas pixels
layout(location=3) in vec2 aAnchor;           // anchor in sprite pixels
layout(location=4) in vec3 aLayerFlags;       // page layer, flags, scale
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK;                             // pixels per metre
uniform vec2 uSize;                           // picture size in pixels
uniform float uDepthRange;                    // metres of depth mapped to 0..1
out vec3 vUv;
void main() {
  vec3 d = aPos - uCenter;
  // The anchor's picture pixel, snapped to a whole pixel: sprites never land between pixels.
  vec2 anchor = floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  float s = aLayerFlags.z;
  vec2 px = anchor - floor(aAnchor * s + 0.5) + aCorner * floor(aRect.zw * s + 0.5);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  float depth = clamp(0.5 + dot(d, uForward) / uDepthRange, 0.0, 1.0); // (nearer the camera: smaller forward distance: smaller depth)
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vUv = vec3(aRect.xy + aCorner * aRect.zw, aLayerFlags.x);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uPages;
in vec3 vUv;
out vec4 outColor;
void main() {
  vec4 c = texelFetch(uPages, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0);
  if (c.a < 0.5) discard;                     // (pixel art: a texel is there or it isn't)
  outColor = vec4(c.rgb, 1.0);
}`;

// The layer program: indexed sprites through their looks (plain RGBA sprites alongside, look -1), one draw.
const LAYER_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in vec4 aRect;
layout(location=3) in vec2 aAnchor;
layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK;
uniform vec2 uSize;
uniform float uDepthRange;
out vec3 vUv;
flat out int vLook;
flat out vec2 vDepth;                          // the instance's depth, and its bias (both 0..1 of the depth range)
flat out vec4 vDS;                             // depth sprites: the anchor's depth (m), its metres up the picture, its rect's height (texels), scale
flat out int vId;
void main() {
  vId = gl_InstanceID;
  vec3 d = aPos - uCenter;
  vec2 anchor = floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  float s = aExtra.w;
  vec2 px = anchor - floor(aAnchor * s + 0.5) + aCorner * floor(aRect.zw * s + 0.5);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  float depth = clamp(0.5 + dot(d, uForward) / uDepthRange, 0.0, 1.0);
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vUv = vec3(aRect.xy + aCorner * aRect.zw, aExtra.x);
  vLook = int(floor(aExtra.y + 0.5));
  vDepth = vec2(depth, abs(aExtra.z) / uDepthRange);
  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);
}`;

// Per texel: the slot's ramp from the instance's look, the finish bending the shade onto it, the pattern (on the
// part's own surface coordinate) moving it onto the ink's ramp or along its own, the screen breaking the step
// between two entries, the outline a few entries darker. Every pixel a palette entry.
const LAYER_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp usampler2D;
uniform sampler2DArray uPages;
uniform highp usampler2D uLooks;   // per look ${SLOTS_GLSL} paint indices + 1, four a texel, ${LOOKS_PER_ROW_GLSL} looks a row
uniform highp usampler2D uPaints;  // per paint 2 texels, ${PAINTS_PER_ROW_GLSL} paints a row
uniform sampler2D uPalette;        // colours, ${PALETTE_ROW_GLSL} a row
uniform int uScreen;
uniform float uDither;
uniform int uOutline;
uniform highp sampler2DArray uHeights;  // depth sprites: a height per texel (indexed.ts: two bytes), beside the pages
uniform int uHeightOn;
uniform vec4 uDS;                       // cos pitch, sin pitch, kappa (depth.ts), the tie (m)
uniform float uK;
uniform vec2 uSize;
uniform float uDepthRange;
uniform int uIds;
uniform int uIdBase;
in vec3 vUv;
flat in int vLook;
flat in vec2 vDepth;
flat in vec4 vDS;
flat in int vId;
out vec4 outColor;
vec4 idColour() { int id = vId + uIdBase + 1; return vec4(float(id & 255) / 255.0, float((id >> 8) & 255) / 255.0, float((id >> 16) & 255) / 255.0, 1.0); }
${SPRITE_DEPTH_GLSL}
// The texel's depth (0..1): the point it shows (its height), or its instance's when it has none.
float texelZ(ivec3 at, float fallback) {
  if (uHeightOn == 0) return fallback;
  vec2 hb = texelFetch(uHeights, at, 0).rg * 255.0;
  float v = floor(hb.r + 0.5) * 256.0 + floor(hb.g + 0.5);
  if (v < 0.5) return fallback;
  float y = (v - 1.0) / ${HEIGHT_STEPS.toFixed(1)} * vDS.w / uK;
  float fragB = (gl_FragCoord.y - uSize.y * 0.5) / uK;
  return clamp(0.5 + (spriteTexelDepth(vDS.x, vDS.y, fragB, y, uDS.x, uDS.y, uDS.z) - uDS.w) / uDepthRange, 0.0, 1.0);
}

float bayer(ivec2 p, int n) {
  if (n == 2) { int m[4] = int[4](0, 2, 3, 1); return (float(m[(p.y & 1) * 2 + (p.x & 1)]) + 0.5) / 4.0; }
  if (n == 4) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
  ivec2 q = p & 7;
  int m4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  int a = m4[(q.y & 3) * 4 + (q.x & 3)];
  int b = m4[(q.y >> 2) * 4 + (q.x >> 2)];
  return (float(a * 4 + (b & 3)) + 0.5) / 64.0;
}
vec4 pal(int i) { return texelFetch(uPalette, ivec2(i % ${PALETTE_ROW_GLSL}, i / ${PALETTE_ROW_GLSL}), 0); }
uint paintOf(int look, int slot) { uvec4 t = texelFetch(uLooks, ivec2((look % ${LOOKS_PER_ROW_GLSL}) * ${LOOK_TEXELS_GLSL} + slot / 4, look / ${LOOKS_PER_ROW_GLSL}), 0); int k = slot & 3; return k == 0 ? t.x : k == 1 ? t.y : k == 2 ? t.z : t.w; }
uvec4 paintTexel(uint p, int k) { int i = int(p); return texelFetch(uPaints, ivec2((i % ${PAINTS_PER_ROW_GLSL}) * 2 + k, i / ${PAINTS_PER_ROW_GLSL}), 0); }
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
// matte, cloth (softer), leather, metal (hard, glinting at the top), glow (lifted)
float finish(int f, float s) {
  if (f == 1) return 0.08 + 0.9 * s;
  if (f == 2) return pow(max(s, 0.0), 0.9);
  if (f == 3) return clamp((s - 0.42) * 1.9 + 0.5, 0.0, 1.0);
  if (f == 4) return 0.45 + 0.6 * s;
  return s;
}
// none, stripes, bands, spots, checks, camo, gradient (not a mask), trim
float marks(int kind, vec2 uv, float freq, float ang, float w) {
  if (kind == 1) { float a = ang * 0.3926991; return step(fract(dot(uv, vec2(cos(a), sin(a) * 0.5)) * freq * 2.0), w); }
  if (kind == 2) return step(fract(uv.y * freq), w);
  if (kind == 3) { vec2 g = uv * vec2(freq * 4.0, freq * 2.0); vec2 c = floor(g); vec2 f = fract(g) - 0.5; return hash12(c) > 0.4 && length(f) < w * 0.7 ? 1.0 : 0.0; }
  if (kind == 4) return mod(floor(uv.x * freq * 4.0) + floor(uv.y * freq * 2.0), 2.0);
  if (kind == 5) return step(1.0 - w * 0.9, vnoise(uv * vec2(freq * 4.0 + 3.0, freq * 2.0 + 2.0)));
  if (kind == 7) return uv.y < w * 0.08 || uv.y > 1.0 - w * 0.08 ? 1.0 : 0.0;
  return 0.0;
}
void main() {
  vec4 c = texelFetch(uPages, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0);
  ivec3 hAt = ivec3(ivec2(vUv.xy), int(vUv.z + 0.5));
  if (vLook < 0) { if (c.a < 0.5) discard; outColor = uIds == 1 ? idColour() : vec4(c.rgb, 1.0); gl_FragDepth = texelZ(hAt, vDepth.x); return; }
  int r = int(c.r * 255.0 + 0.5);
  int s = r & 63;
  if (s == 0) discard;
  int slot = s - 1;
  bool edge = (r & 128) != 0;
  // (A texel behind its split point -- the socket -- sits a hair behind the body it's on; the rest a hair in front.)
  gl_FragDepth = clamp(texelZ(hAt, vDepth.x) + ((r & 64) != 0 ? vDepth.y : -vDepth.y), 0.0, 1.0);
  uint p = paintOf(vLook, slot);
  if (p == 0u) discard;                // (nothing painted: a look that doesn't know this slot)
  uvec4 A = paintTexel(p - 1u, 0);
  uvec4 B = paintTexel(p - 1u, 1);
  int base = int(A.x);
  int len = max(int(A.y & 255u), 1);
  float t = finish(int(A.y >> 8u), c.g);
  int kind = int(A.z & 15u);
  float x = t * float(len - 1);
  if (kind == 6) x += (0.5 - c.a) * 2.0 * float(int(A.w) - 8);
  else if (kind > 0 && marks(kind, c.ba, float((A.z >> 4u) & 15u), float((A.z >> 8u) & 15u), float((A.z >> 12u) & 15u) / 8.0) > 0.5) {
    if (B.y > 0u) { base = int(B.x); len = max(int(B.y), 1); x = t * float(len - 1); }
    else x += float(int(A.w) - 8);
  }
  float th = uScreen == 0 ? 0.0 : bayer(ivec2(gl_FragCoord.xy), uScreen) - 0.5;
  x += th * uDither;
  int idx = clamp(int(floor(x + 0.5)), 0, len - 1);
  if (edge) idx = max(0, idx - uOutline);
  outColor = uIds == 1 ? idColour() : vec4(pal(base + idx).rgb, 1.0);
}`;

// Billboards (engine): the same layers seen through a PERSPECTIVE camera -- a unit far off in a first-person or chase
// view. Each anchor is projected (and snapped to a whole pixel); its sprite is drawn at the instance's scale (the
// caller picks the baked scale nearest the size it shows at, so texels stay about a pixel each); its depth is its
// distance over `far` -- keel/render's convention, so what render({ depthOut }) left in the depth buffer hides it. The
// spare float is a dissolve (0..1): texels under that share of a 4x4 screen are dropped -- the pixels a solid fading
// in (keel/render's raster fade) takes.
const BILLBOARD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in vec4 aRect;
layout(location=3) in vec2 aAnchor;
layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale
layout(location=5) in float aFade;            // dissolved share
uniform vec3 uEye, uRight, uUp, uForward;
uniform float uTan, uAspect, uFar, uLift;
uniform vec2 uSize;
out vec3 vUv;
flat out int vLook;
flat out vec2 vDepth;
flat out float vFade;
flat out vec4 vDS;                             // (depth sprites are orthographic: a billboard keeps its distance)
flat out int vId;
void main() {
  vDS = vec4(0.0);
  vId = gl_InstanceID;
  vec3 e = aPos - uEye;
  float z = dot(e, uForward);
  vUv = vec3(aRect.xy + aCorner * aRect.zw, aExtra.x);
  vLook = int(floor(aExtra.y + 0.5));
  vFade = aFade;
  if (z < 0.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vDepth = vec2(1.0, 0.0); return; }
  vec2 ndc0 = vec2(dot(e, uRight) / (z * uTan * uAspect), dot(e, uUp) / (z * uTan));
  vec2 anchor = floor(vec2((ndc0.x * 0.5 + 0.5) * uSize.x, (0.5 - ndc0.y * 0.5) * uSize.y) + 0.5);
  float s = aExtra.w;
  vec2 px = anchor - floor(aAnchor * s + 0.5) + aCorner * floor(aRect.zw * s + 0.5);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  // (The whole sprite at its anchor's distance, pulled toward the eye by uLift: the ground just in front of its feet doesn't cut them off.)
  float depth = clamp((length(e) - uLift) / uFar, 0.0, 1.0);
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vDepth = vec2(depth, abs(aExtra.z) / uFar);
}`;
const BILLBOARD_FS = LAYER_FS
  .replace("flat in vec2 vDepth;", "flat in vec2 vDepth;\nflat in float vFade;")
  .replace("void main() {\n  vec4 c = texelFetch", "void main() {\n  if (vFade > 0.0 && bayer(ivec2(gl_FragCoord.xy), 4) < vFade) discard;\n  vec4 c = texelFetch");
if (BILLBOARD_FS === LAYER_FS || !BILLBOARD_FS.includes("vFade > 0.0")) throw new Error("BILLBOARD_FS: LAYER_FS changed under its edits.");
// Swaying layers (sway.ts): the layer shader with each texel row fetched from a whole-pixel shifted column.
const SWAY_FS = swayFragment(LAYER_FS);
// Layers with per-instance effects (fx.ts): the spare float is a dissolve (whole 16ths) and a flash (the fraction).
const FX_VS = LAYER_VS
  .replace("layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale", "layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale\nlayout(location=5) in float aFx;              // packFx(flash, dissolve)")
  .replace("flat out vec2 vDepth;", "flat out vec2 vDepth;\nflat out float vFx;")
  .replace("  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);\n}", "  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);\n  vFx = aFx;\n}");
const FX_FS = LAYER_FS
  .replace("flat in vec2 vDepth;", "flat in vec2 vDepth;\nflat in float vFx;")
  .replace("void main() {\n  vec4 c = texelFetch", "void main() {\n  float fxD = floor(max(vFx, 0.0)) / 16.0;\n  float fxF = fract(max(vFx, 0.0));\n  if (fxD > 0.0 && bayer(ivec2(gl_FragCoord.xy), 4) < fxD) discard;\n  vec4 c = texelFetch")
  .replace("  if (edge) idx = max(0, idx - uOutline);", "  if (!edge && fxF > 0.0) idx = fxF > 0.7 ? len - 1 : min(len - 1, idx + int(ceil(fxF * float(len))));\n  if (edge) idx = max(0, idx - uOutline);");
if (!FX_VS.includes("vFx = aFx;") || !FX_VS.includes("in float aFx;") || !FX_FS.includes("fxD > 0.0") || !FX_FS.includes("fxF > 0.7")) throw new Error("FX shaders: LAYER_VS / LAYER_FS changed under their edits.");

/** A perspective camera for drawBillboards: keel/render's (its eye, its basis, its vertical fov). */
export interface BillboardCamera {
  readonly eye: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  /** Vertical field of view, radians. */
  readonly fov: number;
}
/** How drawBillboards draws: the layer style, the depth range (keel/render's FAR, 140 m) and how far the depth is pulled toward the eye. */
export interface BillboardStyle extends Omit<LayerStyle, "clear"> {
  readonly far?: number;
  readonly lift?: number;
}

export interface SpriteRenderer {
  setPages(pages: readonly AtlasPage[]): void;
  /**
   * A live atlas (a streaming bake's): at least `count` pages of `size`² -- grown on the GPU, what's on them kept --
   * that writeSprite() fills a sprite at a time. (Replaces pages setPages gave.)
   */
  reservePages(count: number, size: number, options?: { readonly heights?: boolean }): void;
  /** Put one sprite's texels on a reserved page (and its heights: depth sprites, pages reserved with heights). */
  writeSprite(page: number, x: number, y: number, w: number, h: number, rgba: Uint8Array, heights?: Uint8Array): void;
  /** Depth sprites: whether the pages carry heights, and the bytes they take on the GPU (the height planes alone). */
  readonly heightBytes: number;
  /** Layers the page texture has now. */
  readonly pageCount: number;
  setTarget(width: number, height: number): void;
  /** Draw `instances.count` sprites through `view`; clears to `clear` first (RGB 0..1) unless null. */
  draw(view: PixelView, instances: SpriteInstances, clear?: readonly [number, number, number] | null): void;
  /** The look table's textures (a LookTable's palette() and texture()): what drawLayers paints indexed sprites with. */
  setLooks(textures: LookTextures): void;
  /** Draw layer instances (indexed sprites through their looks, plain ones alongside): one instanced draw. */
  drawLayers(view: PixelView, instances: LayerInstances, style?: LayerStyle): void;
  /**
   * Engine: the same layers through a perspective camera (see BILLBOARD_VS): anchors projected, sprites at their
   * instance's scale, depth by distance over `far`, the spare float a dissolve. Never clears: it draws over (and is
   * hidden by) what's there.
   */
  drawBillboards(camera: BillboardCamera, instances: LayerInstances, style?: BillboardStyle): void;
  /**
   * Layers that sway in the wind (sway.ts): drawLayers' instances plus a packed sway and a lean each -- texel rows
   * shifted by whole pixels, gust waves across the map, benders pushing what's near them. One instanced draw.
   */
  drawSway(view: PixelView, instances: SwayInstances, style?: LayerStyle & WindStyle): void;
  /**
   * drawLayers with per-instance effects (fx.ts): each instance's spare float is packFx(flash, dissolve) -- a hit's
   * flash up the ramps, a death's or a warp-in's dissolve. 0 draws exactly as drawLayers. One instanced draw.
   */
  drawLayersFx(view: PixelView, instances: LayerInstances, style?: LayerStyle): void;
  readonly gl: WebGL2RenderingContext;
}

export function createSpriteRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, { width, height, capacity = 8192 }: { width: number; height: number; capacity?: number }): SpriteRenderer {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("WebGL2 isn't available.");
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Sprite shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Sprite program: ${gl.getProgramInfoLog(prog)}`);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const U = { center: u("uCenter"), right: u("uRight"), up: u("uUp"), forward: u("uForward"), k: u("uK"), size: u("uSize"), depth: u("uDepthRange"), pages: u("uPages") };

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
  const stride = INSTANCE_FLOATS * 4;
  const attrib = (loc: number, size: number, offset: number) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    gl.vertexAttribDivisor(loc, 1);
  };
  attrib(1, 3, 0); attrib(2, 4, 3); attrib(3, 2, 7); attrib(4, 3, 9);
  gl.bindVertexArray(null);

  // The layer program and its buffers: built the first time drawLayers or setLooks is called.
  type LayerUniform = "center" | "right" | "up" | "forward" | "k" | "size" | "depth" | "pages" | "looks" | "paints" | "palette" | "screen" | "dither" | "outline" | "heights" | "heightOn" | "ds" | "ids" | "idBase";
  interface Layers { prog: WebGLProgram; u: Record<LayerUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number; palette: WebGLTexture | null; looks: WebGLTexture | null; paints: WebGLTexture | null }
  let layerState: Layers | null = null;
  const layers = (): Layers => {
    if (layerState) return layerState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, LAYER_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, LAYER_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Layer program: ${gl.getProgramInfoLog(p)}`);
    const lu = (name: string) => gl.getUniformLocation(p, name);
    const u = { center: lu("uCenter"), right: lu("uRight"), up: lu("uUp"), forward: lu("uForward"), k: lu("uK"), size: lu("uSize"), depth: lu("uDepthRange"), pages: lu("uPages"), looks: lu("uLooks"), paints: lu("uPaints"), palette: lu("uPalette"), screen: lu("uScreen"), dither: lu("uDither"), outline: lu("uOutline"), heights: lu("uHeights"), heightOn: lu("uHeightOn"), ds: lu("uDS"), ids: lu("uIds"), idBase: lu("uIdBase") };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = LAYER_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9);
    gl.bindVertexArray(null);
    layerState = { prog: p, u, vao: v, inst: b, capacity, palette: null, looks: null, paints: null };
    return layerState;
  };

  // The billboard program: built the first time drawBillboards is called (it shares the layer program's textures).
  type BoardUniform = "eye" | "right" | "up" | "forward" | "tan" | "aspect" | "far" | "lift" | "size" | "pages" | "looks" | "paints" | "palette" | "screen" | "dither" | "outline";
  let boardState: { prog: WebGLProgram; u: Record<BoardUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number } | null = null;
  const boards = () => {
    if (boardState) return boardState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, BILLBOARD_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, BILLBOARD_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Billboard program: ${gl.getProgramInfoLog(p)}`);
    const bu = (name: string) => gl.getUniformLocation(p, name);
    const u = { eye: bu("uEye"), right: bu("uRight"), up: bu("uUp"), forward: bu("uForward"), tan: bu("uTan"), aspect: bu("uAspect"), far: bu("uFar"), lift: bu("uLift"), size: bu("uSize"), pages: bu("uPages"), looks: bu("uLooks"), paints: bu("uPaints"), palette: bu("uPalette"), screen: bu("uScreen"), dither: bu("uDither"), outline: bu("uOutline") };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = LAYER_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9); at(5, 1, 13);
    gl.bindVertexArray(null);
    boardState = { prog: p, u, vao: v, inst: b, capacity };
    return boardState;
  };

  // The sway program: built the first time drawSway is called (it shares the layer program's textures).
  type SwayUniform = "center" | "right" | "up" | "forward" | "k" | "size" | "depth" | "pages" | "looks" | "paints" | "palette" | "screen" | "dither" | "outline" | "time" | "wind" | "bend" | "bendCount" | "heights" | "heightOn" | "ds" | "ids" | "idBase";
  let swayState: { prog: WebGLProgram; u: Record<SwayUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number } | null = null;
  const sways = () => {
    if (swayState) return swayState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, SWAY_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, SWAY_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Sway program: ${gl.getProgramInfoLog(p)}`);
    const su = (name: string) => gl.getUniformLocation(p, name);
    const u = {
      center: su("uCenter"), right: su("uRight"), up: su("uUp"), forward: su("uForward"), k: su("uK"), size: su("uSize"), depth: su("uDepthRange"), pages: su("uPages"), looks: su("uLooks"), paints: su("uPaints"), palette: su("uPalette"),
      screen: su("uScreen"), dither: su("uDither"), outline: su("uOutline"), time: su("uTime"), wind: su("uWind"), bend: su("uBend"), bendCount: su("uBendCount"),
      heights: su("uHeights"), heightOn: su("uHeightOn"), ds: su("uDS"), ids: su("uIds"), idBase: su("uIdBase"),
    };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * SWAY_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = SWAY_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9); at(5, 2, 14);
    gl.bindVertexArray(null);
    swayState = { prog: p, u, vao: v, inst: b, capacity };
    return swayState;
  };

  // The fx program: built the first time drawLayersFx is called (it shares the layer program's textures).
  let fxState: { prog: WebGLProgram; u: Record<LayerUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number } | null = null;
  const fxs = () => {
    if (fxState) return fxState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, FX_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FX_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Fx program: ${gl.getProgramInfoLog(p)}`);
    const fu = (name: string) => gl.getUniformLocation(p, name);
    const u = { center: fu("uCenter"), right: fu("uRight"), up: fu("uUp"), forward: fu("uForward"), k: fu("uK"), size: fu("uSize"), depth: fu("uDepthRange"), pages: fu("uPages"), looks: fu("uLooks"), paints: fu("uPaints"), palette: fu("uPalette"), screen: fu("uScreen"), dither: fu("uDither"), outline: fu("uOutline"), heights: fu("uHeights"), heightOn: fu("uHeightOn"), ds: fu("uDS"), ids: fu("uIds"), idBase: fu("uIdBase") };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = LAYER_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9); at(5, 1, 13);
    gl.bindVertexArray(null);
    fxState = { prog: p, u, vao: v, inst: b, capacity };
    return fxState;
  };

  let tex: WebGLTexture | null = null;
  let texLayers = 0, texSize = 0, live = false;
  // Depth sprites: the pages' height planes, an RG8 array beside the pages (null: no heights -- every draw as before).
  let htex: WebGLTexture | null = null, hW = 0, hH = 0;
  const heightArray = (w: number, h: number, layers: number): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, w, h, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };
  // The depth-sprite uniforms of a layer draw: on when the pages carry heights (and the style doesn't turn them off).
  const depthSprites = (U: { heights: WebGLUniformLocation | null; heightOn: WebGLUniformLocation | null; ds: WebGLUniformLocation | null; ids: WebGLUniformLocation | null; idBase: WebGLUniformLocation | null }, view: PixelView, style: LayerStyle): void => {
    const on = !!htex && style.heights !== false;
    gl.uniform1i(U.ids, style.ids ? 1 : 0); gl.uniform1i(U.idBase, style.idBase ?? 0);
    gl.uniform1i(U.heightOn, on ? 1 : 0);
    const cp = view.axes.up[1], sp = -view.axes.forward[1];
    gl.uniform4f(U.ds, cp, sp, depthKappa(style.depth ?? "ground", cp), style.tie ?? 0.005);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, on ? htex : null); gl.uniform1i(U.heights, 4);
    gl.activeTexture(gl.TEXTURE0);
  };
  let W = width;
  let H = height;
  const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  const api: SpriteRenderer = {
    gl,
    get pageCount() { return texLayers; },
    get heightBytes() { return htex ? hW * hH * texLayers * 2 : 0; },
    reservePages(count, size, options = {}) {
      if (live && tex && texSize === size && texLayers >= count && (!options.heights || htex)) return;
      // (Grow by doubling, up to what the GPU allows: each growth copies the old layers across on the GPU.)
      const layers = Math.min(maxLayers, Math.max(count, live && texSize === size ? texLayers * 2 : count));
      if (layers < count) throw new RangeError(`${count} atlas pages: this GPU allows ${maxLayers}.`);
      const next = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, next);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (tex && live && texSize === size) {
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
        for (let i = 0; i < texLayers; i += 1) {
          gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, i);
          gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 0, 0, size, size);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
      }
      if (options.heights || htex) {
        // (The height planes grow with the pages, copied across the same way.)
        const hn = heightArray(size, size, layers);
        if (htex && hW === size && hH === size) {
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
          for (let i = 0; i < texLayers; i += 1) {
            gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, htex, 0, i);
            gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 0, 0, size, size);
          }
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.deleteFramebuffer(fb);
        }
        if (htex) gl.deleteTexture(htex);
        htex = hn; hW = size; hH = size;
      }
      if (tex) gl.deleteTexture(tex);
      tex = next; texLayers = layers; texSize = size; live = true;
    },
    writeSprite(page, x, y, w, h, rgba, heights) {
      if (!tex || !live) throw new Error("reservePages first.");
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, page, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      if (htex) {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, htex);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, page, w, h, 1, gl.RG, gl.UNSIGNED_BYTE, heights ?? new Uint8Array(w * h * 2));
      }
    },
    setPages(pages) {
      live = false;
      if (!pages.length) throw new Error("No atlas pages.");
      const pw = Math.max(...pages.map((p) => p.width));
      const ph = Math.max(...pages.map((p) => p.height));
      if (tex) gl.deleteTexture(tex);
      tex = gl.createTexture();
      texLayers = pages.length; texSize = Math.max(pw, ph);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, pw, ph, pages.length);
      pages.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.rgba));
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (htex) { gl.deleteTexture(htex); htex = null; }
      if (pages.some((p) => p.heights)) {
        htex = heightArray(pw, ph, pages.length); hW = pw; hH = ph;
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        pages.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RG, gl.UNSIGNED_BYTE, p.heights ?? new Uint8Array(p.width * p.height * 2)));
      }
    },
    setTarget(w, h) { W = w; H = h; canvas.width = w; canvas.height = h; },
    draw(view, instances, clear = [0.05, 0.05, 0.07]) {
      if (!tex) throw new Error("setPages first.");
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } else gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.uniform1i(U.pages, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * INSTANCE_FLOATS);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    setLooks({ palette, paints, looks }) {
      const L = layers();
      gl.activeTexture(gl.TEXTURE1);
      if (L.palette) gl.deleteTexture(L.palette);
      L.palette = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, L.palette);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, palette.width, palette.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const uint = (unit: number, old: WebGLTexture | null, t: { width: number; height: number; data: Uint32Array }): WebGLTexture => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        if (old) gl.deleteTexture(old);
        const tx = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, t.width, t.height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, t.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return tx;
      };
      L.looks = uint(2, L.looks, looks);
      L.paints = uint(3, L.paints, paints);
      gl.activeTexture(gl.TEXTURE0);
    },
    drawLayers(view, instances, style = {}) {
      const { screen = 4, dither = 0.9, outline = 3, clear = [0.05, 0.05, 0.07] } = style;
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(L.prog);
      const U = L.u;
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE0);
      depthSprites(U, view, style);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.inst);
      if (instances.capacity > L.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); L.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * LAYER_INSTANCE_FLOATS);
      gl.bindVertexArray(L.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    drawLayersFx(view, instances, style = {}) {
      const { screen = 4, dither = 0.9, outline = 3, clear = [0.05, 0.05, 0.07] } = style;
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      const F = fxs();
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(F.prog);
      const U = F.u;
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE0);
      depthSprites(U, view, style);
      gl.bindBuffer(gl.ARRAY_BUFFER, F.inst);
      if (instances.capacity > F.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); F.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * LAYER_INSTANCE_FLOATS);
      gl.bindVertexArray(F.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    drawBillboards(camera, instances, { screen = 4, dither = 0.9, outline = 3, far = 140, lift = 0.6 } = {}) {
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      const B = boards();
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.useProgram(B.prog);
      const U = B.u;
      gl.uniform3f(U.eye, camera.eye[0], camera.eye[1], camera.eye[2]);
      gl.uniform3f(U.right, camera.right[0], camera.right[1], camera.right[2]);
      gl.uniform3f(U.up, camera.up[0], camera.up[1], camera.up[2]);
      gl.uniform3f(U.forward, camera.forward[0], camera.forward[1], camera.forward[2]);
      gl.uniform1f(U.tan, Math.tan(camera.fov / 2)); gl.uniform1f(U.aspect, W / H); gl.uniform1f(U.far, far); gl.uniform1f(U.lift, lift);
      gl.uniform2f(U.size, W, H);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindBuffer(gl.ARRAY_BUFFER, B.inst);
      if (instances.capacity > B.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); B.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * LAYER_INSTANCE_FLOATS);
      gl.bindVertexArray(B.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    drawSway(view, instances, style = { time: 0 }) {
      const { screen = 4, dither = 0.9, outline = 3, clear = null, time, wind = 0.6, speed = 3, gust = 0.6, benders = [] } = style;
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      const S = sways();
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(S.prog);
      const U = S.u;
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.uniform1f(U.time, time);
      gl.uniform4f(U.wind, Math.sin(wind), Math.cos(wind), speed, gust);
      const bend = new Float32Array(32);
      benders.slice(0, 8).forEach((b, i) => bend.set(b, i * 4));
      gl.uniform4fv(U.bend, bend); gl.uniform1i(U.bendCount, Math.min(8, benders.length));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE0);
      depthSprites(U, view, style);
      gl.bindBuffer(gl.ARRAY_BUFFER, S.inst);
      if (instances.capacity > S.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * SWAY_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); S.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * SWAY_INSTANCE_FLOATS);
      gl.bindVertexArray(S.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
  };
  api.setTarget(width, height);
  return api;
}
