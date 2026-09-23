// The paint shader: how one indexed texel becomes one palette entry. Shared by
// everything that paints through a look table -- the layer draws (sprites.ts),
// the sway and fx variants, and the live mesh pass (draw-mesh.ts), which feeds
// it a G-buffer instead of a sprite's texels. One shader, so a car, a tree and
// a wall are painted by the same rules whichever path drew them.

import { HEIGHT_STEPS, SLOTS } from "./indexed.ts";
import { LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW, PLACES_PER_ROW } from "./looks.ts";
import { SPRITE_DEPTH_GLSL } from "./depth.ts";

const SLOTS_GLSL = String(SLOTS);
const LOOKS_PER_ROW_GLSL = String(LOOKS_PER_ROW);
const LOOK_TEXELS_GLSL = String(LOOK_TEXELS);
const PAINTS_PER_ROW_GLSL = String(PAINTS_PER_ROW);
const PALETTE_ROW_GLSL = String(PALETTE_ROW);

// Per texel: the slot's ramp from the instance's look, the finish bending the shade onto it, the pattern (on the
// part's own surface coordinate) moving it onto the ink's ramp or along its own, the screen breaking the step
// between two entries, the outline a few entries darker. Every pixel a palette entry.
export const LAYER_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp usampler2D;
uniform sampler2DArray uPages;
uniform highp usampler2D uLooks;   // per look ${SLOTS_GLSL} paint indices + 1, four a texel, ${LOOKS_PER_ROW_GLSL} looks a row
uniform highp usampler2D uPaints;  // per paint 2 texels, ${PAINTS_PER_ROW_GLSL} paints a row
uniform sampler2D uPalette;        // colours, ${PALETTE_ROW_GLSL} a row
uniform highp usampler2D uPlaces;  // decal placements, 4 texels each, ${String(PLACES_PER_ROW)} a row
uniform sampler2D uDecals;         // the decals' texels: ink, tone, lit
uniform int uScreen;
uniform float uDither;
uniform int uOutline;
uniform int uDitherAnchor;         // 0: dither screens anchored to the picture; 1: to each sprite's anchor (a moving thing's pattern moves with it)
flat in vec2 vAnchor;
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
// A paint's own screen (looks.ts PAINT_SCREENS: 1 none, 2..4 Bayer, then core's SCREENS as the shader can draw them).
float tri1(float v) { return 1.0 - abs(2.0 * fract(v) - 1.0); }
float screenAt(ivec2 p, int id) {
  float x = float(p.x), y = float(p.y);
  if (id == 1) return 0.5;
  if (id == 2) return bayer(p, 2);
  if (id == 3) return bayer(p, 4);
  if (id == 4) return bayer(p, 8);
  if (id == 5) return bayer(p >> 1, 4);
  if (id == 6) return tri1(y / 3.0 + 0.5) * 0.9 + (bayer(p, 2) - 0.125) * 0.1;
  if (id == 7) { int d[4] = int[4](3, 1, 0, 2); return (float(d[(p.x + p.y) & 3]) + bayer(p, 4)) / 4.0; }
  if (id == 8) return (tri1((x + y) / 4.0) + tri1((x - y) / 4.0)) * 0.5;
  if (id == 9) return fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));
  if (id == 10) return ((p.x + p.y) & 1) == 1 ? 0.3 : 0.7;
  if (id == 11) return ((((p.x >> 1) + (p.y >> 1)) & 1) == 1 ? tri1(x / 4.0) : tri1(y / 4.0)) * 0.94 + 0.03;
  if (id == 12) { float u = (x + y) / 6.0, v = (x - y) / 6.0; return clamp((2.0 - cos(6.2831853 * u) - cos(6.2831853 * v)) / 4.0, 0.0, 1.0) * 0.85 + bayer(p, 4) * 0.15; }
  if (id == 13) return (cos((x + y) / 6.0 * 3.1415927) * cos((x - y) / 6.0 * 3.1415927) + 1.0) * 0.5;
  return uScreen == 0 ? 0.5 : bayer(p, uScreen);
}
vec4 pal(int i) { return texelFetch(uPalette, ivec2(i % ${PALETTE_ROW_GLSL}, i / ${PALETTE_ROW_GLSL}), 0); }
uint paintOf(int look, int slot) { uvec4 t = texelFetch(uLooks, ivec2((look % ${LOOKS_PER_ROW_GLSL}) * ${LOOK_TEXELS_GLSL} + slot / 4, look / ${LOOKS_PER_ROW_GLSL}), 0); int k = slot & 3; return k == 0 ? t.x : k == 1 ? t.y : k == 2 ? t.z : t.w; }
uvec4 placeTexel(int i, int k) { return texelFetch(uPlaces, ivec2((i % ${String(PLACES_PER_ROW)}) * 4 + k, i / ${String(PLACES_PER_ROW)}), 0); }
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
// "windows" (on a facade grid's packed bytes: mesh.ts): 0 wall, 1 a dark pane, 2 a lit one. The window's type is the
// pattern's angle (0 punched, 1 tall, 2 ribbon, 3 curtain wall, 4 arched, 5 boarded), its fill the width, the lit
// share the freq -- each cell lit or not by its own draw, so no two buildings in one look light alike.
int windowAt(vec2 bytes, int type, float fill, float share, out float r) {
  int bu = int(bytes.x * 255.0 + 0.5), bv = int(bytes.y * 255.0 + 0.5);
  vec2 f = (vec2(float(bu >> 4), float(bv >> 4)) + 0.5) / 16.0;
  r = float((bu & 15) * 16 + (bv & 15)) / 255.0;
  float hw = 0.5 * fill;
  bool pane;
  if (type == 1) pane = abs(f.x - 0.5) < hw * 0.8 && f.y > 0.12 && f.y < 0.9;
  else if (type == 2) pane = f.y > 0.34 && f.y < 0.34 + 0.6 * fill;
  else if (type == 3) pane = abs(f.x - 0.5) < 0.5 - 0.35 * (1.0 - fill) && f.y > 0.08 + 0.2 * (1.0 - fill) && f.y < 0.97;
  else if (type == 4) { vec2 d = (f - vec2(0.5, 0.62)) / vec2(max(hw * 0.8, 0.05), max(hw, 0.05)); pane = f.y > 0.1 && (f.y < 0.62 ? abs(f.x - 0.5) < hw * 0.8 : dot(d, d) < 1.0); }
  else pane = abs(f.x - 0.5) < hw && f.y > 0.24 && f.y < 0.24 + 0.66 * fill;
  if (!pane) return 0;
  return type != 5 && r < share ? 2 : 1;
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
  else if (kind == 8) {
    float wr, wallLift = 0.0;
    int w = windowAt(c.ba, int((A.z >> 8u) & 15u), float((A.z >> 12u) & 15u) / 15.0, float((A.z >> 4u) & 15u) / 15.0, wr);
    // (Lit: the ink's ramp, bright whatever the light -- warm or cool by the cell. Dark: the wall's own darkest glass,
    // a touch lighter at the top of the pane. Boarded: the ink's ramp at the wall's shade -- plywood.)
    if (w == 2 && B.y > 0u) { base = int(B.x); len = max(int(B.y), 1); x = (0.5 + 0.5 * fract(wr * 13.0)) * float(len - 1); }
    else if (w >= 1 && int((A.z >> 8u) & 15u) == 5 && B.y > 0u) { base = int(B.x); len = max(int(B.y), 1); x = t * float(len - 1); }
    else if (w >= 1) x = min(x - 1.0, 0.3 * float(len - 1));
    else x += wallLift;
  }
  else if (kind > 0 && marks(kind, c.ba, float((A.z >> 4u) & 15u), float((A.z >> 8u) & 15u), float((A.z >> 12u) & 15u) / 8.0) > 0.5) {
    if (B.y > 0u) { base = int(B.x); len = max(int(B.y), 1); x = t * float(len - 1); }
    else x += float(int(A.w) - 8);
  }
  // (Where the dither screens are read: the picture's pixel, or the sprite's own -- its anchor subtracted, y flipped to match.)
  ivec2 dp = uDitherAnchor == 1 ? ivec2(int(gl_FragCoord.x) - int(vAnchor.x), int(gl_FragCoord.y) + int(vAnchor.y)) : ivec2(gl_FragCoord.xy);
  // A decal stamped on the part (looks.ts): its texel at this surface coordinate, if the rect holds it -- an ink's ramp, lit by the part's shade.
  int place = int(B.w >> 4u) - 1;
  if (place >= 0) {
    uvec4 P0 = placeTexel(place, 0), P1 = placeTexel(place, 1), P2 = placeTexel(place, 2), P3 = placeTexel(place, 3);
    vec2 suv = c.ba;
    if ((P3.x & 1u) != 0u) suv.x = 1.0 - suv.x;
    if ((P3.x & 2u) != 0u) suv.y = 1.0 - suv.y;
    vec2 lo = vec2(P1.xy) / 65535.0, hi = vec2(P1.zw) / 65535.0;
    vec2 dd = (suv - lo) / max(hi - lo, vec2(1e-4));
    if (dd.x >= 0.0 && dd.y >= 0.0 && dd.x < 1.0 && dd.y < 1.0) {
      vec4 dt = texelFetch(uDecals, ivec2(P0.xy) + ivec2(floor(vec2(dd.x, 1.0 - dd.y) * vec2(P0.zw))), 0);
      int ink = int(dt.r * 255.0 + 0.5);
      if (ink >= 1 && ink <= 4) {
        base = int(ink == 1 ? P2.x : ink == 2 ? P2.y : ink == 3 ? P2.z : P2.w);
        len = max(int(A.y & 255u), 1);
        x = mix(0.6, t, dt.b) * float(len - 1) + (dt.g * 255.0 - 128.0) / 16.0;
      }
    }
  }
  // Its clear coat: a horizon across a side panel, the sky on a top one, a streak across glass.
  int sheen = int((B.w >> 1u) & 7u);
  if (sheen == 1) {
    float hz = 0.5 + 0.06 * sin(c.b * 9.42);
    x += c.a > hz ? 0.3 : -0.35;
    if (abs(c.a - hz) < 0.03) x -= 0.9;
  } else if (sheen == 2) x += 0.25 * (c.a - 0.35);
  else if (sheen == 3) {
    // (Glass: a clean tint, lighter toward its top, and one crisp diagonal reflection band.)
    float st = fract((c.b * 0.6 + c.a) * 0.9);
    x += 0.8 * (c.a - 0.5);
    if (st > 0.3 && st < 0.42) x += 1.6;
  }
  // (The paint's own screen and reach, or the draw call's.)
  int scr = int(B.z & 255u);
  uint reach = (B.z >> 8u) & 255u;
  float th = scr == 0 ? (uScreen == 0 ? 0.0 : bayer(dp, uScreen) - 0.5) : screenAt(dp, scr) - 0.5;
  x += th * (reach > 0u ? float(reach - 1u) / 32.0 : uDither);
  int idx = clamp(int(floor(x + 0.5)), 0, len - 1);
  if (edge) idx = max(0, idx - uOutline);
  outColor = uIds == 1 ? idColour() : vec4(pal(base + idx).rgb, 1.0);
}`;
