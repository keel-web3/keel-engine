// Particle renderer shader sources. Kept separate from the GL setup so the programs stay easy to review.

import { CURVE_SAMPLES } from "./pool.ts";
import { SPRITE_CELL } from "./palette.ts";
import { PARTICLE_SPRITES } from "./recipe.ts";

const PUFF = PARTICLE_SPRITES.indexOf("puff");

/** Slots a row of the state textures holds. */
export const STATE_WIDTH = 1024;

/** The pool's closed-form motion (pool.ts motionCore), in GLSL. */
export const MOTION_GLSL = `
void motion(vec3 p0, vec3 v0, vec3 vi, float d, float c, float g, float tau, float tStop, out vec3 p, out vec3 v) {
  bool frozen = tau >= tStop;
  float t = frozen ? tStop : tau;
  vec2 h, u;
  if (d == 0.0 && c == 0.0) { h = p0.xz + v0.xz * t; u = v0.xz; }
  else {
    float ed = exp(-d * t);
    vec2 E = ed * vec2(cos(c * t), sin(c * t));
    float a = E.x - 1.0, b = E.y;
    vec2 A = vec2(-a * d + b * c, -a * c - b * d) / (d * d + c * c);
    vec2 w = v0.xz - vi.xz;
    h = p0.xz + vi.xz * t + vec2(w.x * A.x - w.y * A.y, w.x * A.y + w.y * A.x);
    u = vi.xz + vec2(w.x * E.x - w.y * E.y, w.x * E.y + w.y * E.x);
  }
  float y, vy;
  if (d > 0.0) { float ed = exp(-d * t); y = p0.y + vi.y * t + (v0.y - vi.y) * (1.0 - ed) / d; vy = vi.y + (v0.y - vi.y) * ed; }
  else { y = p0.y + v0.y * t - 0.5 * g * t * t; vy = v0.y - g * t; }
  p = vec3(h.x, y, h.y);
  v = frozen ? vec3(0.0) : vec3(u.x, vy, u.y);
}`;

export const PARTICLE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;           // 0..1 quad corner
uniform highp sampler2D uT0;                  // per slot: p0, segment start
uniform highp sampler2D uT1;                  // v0, life
uniform highp sampler2D uT2;                  // drift velocity, freeze (segment time)
uniform highp sampler2D uT3;                  // style, random byte, size scale x16, birth
uniform float uNow;                           // the frame's time (from the renderer's time base)
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK;                             // pixels per metre
uniform vec2 uSize;                           // picture size in pixels
uniform float uDepthRange;                    // metres of depth mapped to 0..1 (the sprite renderer's)
uniform float uPersp; uniform vec3 uEye; uniform float uTan; uniform vec2 uClip;   // a perspective view: on, eye, tan(fov/2), near far
uniform float uContract;   // 1: perspective depth by keel/bake's contract (project.ts) instead of near..far
uniform highp sampler2D uStyles;              // per style: ${CURVE_SAMPLES} curve texels, then constants
flat out vec4 vLook;                          // ramp base, ramp length, lightness, alpha
flat out vec4 vShape;                         // quad length (px), sprite, sprite scale, shade
flat out float vStreak;
flat out float vSoft;                         // the rim over which a round particle's dither thins (0..1 of its radius)
out vec2 vLocal;                              // pixels within the quad
${MOTION_GLSL}
void main() {
  ivec2 tc = ivec2(gl_InstanceID & ${STATE_WIDTH - 1}, gl_InstanceID >> ${Math.log2(STATE_WIDTH)});
  vec4 s0 = texelFetch(uT0, tc, 0), s1 = texelFetch(uT1, tc, 0), s2 = texelFetch(uT2, tc, 0), s3 = texelFetch(uT3, tc, 0);
  float age = uNow - s3.w;
  float life = s1.w;
  if (life <= 0.0 || age < 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int st = int(s3.x + 0.5);
  float x = age / life * ${(CURVE_SAMPLES - 1).toFixed(1)};
  int i0 = int(x);
  int i1 = min(i0 + 1, ${CURVE_SAMPLES - 1});
  vec4 cur = mix(texelFetch(uStyles, ivec2(i0, st), 0), texelFetch(uStyles, ivec2(i1, st), 0), x - float(i0));
  if (cur.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 k0 = texelFetch(uStyles, ivec2(${CURVE_SAMPLES}, st), 0);
  vec4 k1 = texelFetch(uStyles, ivec2(${CURVE_SAMPLES + 1}, st), 0);
  vec4 k2 = texelFetch(uStyles, ivec2(${CURVE_SAMPLES + 2}, st), 0);
  vec4 k3 = texelFetch(uStyles, ivec2(${CURVE_SAMPLES + 3}, st), 0);
  vec3 p, vel;
  motion(s0.xyz, s1.xyz, s2.xyz, k3.x, k3.y, k3.z, uNow - s0.w, s2.w, p, vel);
  uint rb = uint(s3.y + 0.5);
  float r1 = float(rb) / 255.0;
  float r2 = float((rb * 151u + 71u) & 255u) / 255.0;
  // (Perspective: a particle's pixels a metre are its distance's -- and one behind the eye isn't drawn.)
  float pz = dot(p - uEye, uForward);
  if (uPersp > 0.5 && pz < uClip.x) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float K = uPersp > 0.5 ? uSize.y * 0.5 / (pz * uTan) : uK;
  float px = max(1.0, floor(mix(k0.x, k0.y, r1) * cur.x * s3.z / 16.0 * K + 0.5));
  vLook = vec4(k1.x, k1.y, clamp(mix(k0.z, k0.w, r2) * cur.y, 0.0, 1.0), cur.z);
  vec3 d = p - uCenter;
  vec2 sp = vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK);
  if (uPersp > 0.5) { vec3 e = p - uEye; sp = vec2(uSize.x * 0.5 + dot(e, uRight) * K, uSize.y * 0.5 - dot(e, uUp) * K); }
  float sprite = k1.z;
  float scale = 1.0;
  float w = px;
  vSoft = k2.z;
  // (A puff is drawn round at every size -- a pixel-art disc with a soft, dithered rim -- never its 8x8 mask
  // scaled up: past 8 px that turns into a block of square texels.)
  if (abs(sprite - ${PUFF.toFixed(1)}) < 0.5) sprite = 0.0;
  // (A sprite needs room to read: from 4 px it's drawn at a whole-number scale of its 8 texels; smaller, a speck.)
  if (sprite > 0.5 && px >= 4.0) { scale = max(1.0, floor(px / ${SPRITE_CELL.toFixed(1)} + 0.5)); w = ${SPRITE_CELL.toFixed(1)} * scale; } else sprite = 0.0;
  vec2 vs = vec2(dot(vel, uRight), -dot(vel, uUp)) * K * k2.x;
  float len = length(vs);
  vec2 pix;
  if (len > w) {
    // A streak: from its head (the particle) back along its screen velocity, w pixels wide.
    vec2 ax = vs / len;
    vec2 side = vec2(-ax.y, ax.x);
    vec2 head = floor(sp) + 0.5;
    pix = head - ax * len * (1.0 - aCorner.x) + side * (aCorner.y - 0.5) * w;
    vLocal = vec2(aCorner.x * len, aCorner.y * w);
    vStreak = 1.0;
    vShape = vec4(len, 0.0, 1.0, 0.0);
  } else {
    vec2 tl = floor(sp - w * 0.5 + 0.5);
    pix = tl + aCorner * w;
    vLocal = aCorner * w;
    vStreak = 0.0;
    vShape = vec4(w, sprite, scale, k1.w);
  }
  vec2 ndc = vec2(pix.x / uSize.x * 2.0 - 1.0, 1.0 - pix.y / uSize.y * 2.0);
  // Depth from the ground point under it, as a sprite's from its anchor (nearer the camera: smaller).
  vec3 g = vec3(p.x, 0.0, p.z) - uCenter;
  float depth = clamp(0.5 + (dot(g, uForward) - k2.y) / uDepthRange, 0.0, 1.0);
  // (Perspective: the dungeon renderer's near..far mapping -- or, asked for, keel/bake's one depth contract (project.ts):
  // linear forward distance from the eye over the range, 0.5 at the eye, the same as the meshes and the ground write.)
  float zc = uPersp > 0.5
    ? (uContract > 0.5 ? clamp(0.5 + (pz - k2.y) / uClip.y, 0.0, 1.0) * 2.0 - 1.0 : clamp(2.0 * (pz - k2.y - uClip.x) / (uClip.y - uClip.x) - 1.0, -1.0, 1.0))
    : depth * 2.0 - 1.0;
  gl_Position = vec4(ndc, zc, 1.0);
}`;

export const PARTICLE_FS = `#version 300 es
precision highp float;
uniform highp sampler2D uPalette;             // colours, 256 to a row
uniform highp sampler2D uSprites;             // lightness masks, ${SPRITE_CELL} px cells in a row
flat in vec4 vLook;
flat in vec4 vShape;
flat in float vStreak;
flat in float vSoft;
in vec2 vLocal;
out vec4 outColor;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float bayer(ivec2 p) { return (BAYER[(p.x & 3) + (p.y & 3) * 4] + 0.5) / 16.0; }
void main() {
  ivec2 fp = ivec2(gl_FragCoord.xy);          // (the screen is anchored to the picture: a moving puff doesn't drag its dither)
  float light = vLook.z;
  float alpha = vLook.w;
  vec2 q = floor(vLocal);
  float w = vShape.x;
  if (vStreak > 0.5) {
    alpha *= 0.3 + 0.7 * (vLocal.x / w);      // (the tail thins toward where it was)
    light *= 0.75 + 0.25 * (vLocal.x / w);
  } else if (vShape.y > 0.5) {
    ivec2 t = ivec2(q / vShape.z);
    float m = texelFetch(uSprites, ivec2(int(vShape.y + 0.5) * ${SPRITE_CELL} + t.x, t.y), 0).r;
    if (m <= 0.0) discard;
    light *= m;
  } else if (w >= 3.0) {
    vec2 c = q + 0.5 - w * 0.5;
    float r = w * 0.5;
    float d2 = dot(c, c);
    if (d2 > r * r - r * 0.3) discard; // (a pixel-art disc: 3 px is a plus, 4 a rounded square)
    light = clamp(light - vShape.w * 0.3 * (dot(c / r, vec2(0.7071)) + 0.35), 0.0, 1.0);
    if (vSoft > 0.0) alpha *= clamp((1.0 - sqrt(d2) / r) / vSoft, 0.0, 1.0); // (the rim thins: a puff, not a coin)
  }
  if (alpha < 1.0 && alpha <= bayer(fp)) discard;
  float n = vLook.y;
  float f = clamp(light, 0.0, 1.0) * (n - 1.0);
  float idx = min(floor(f) + (fract(f) > bayer(fp + ivec2(2, 1)) ? 1.0 : 0.0), n - 1.0);
  int ci = int(vLook.x + idx + 0.5);
  outColor = vec4(texelFetch(uPalette, ivec2(ci & 255, ci >> 8), 0).rgb, 1.0);
}`;

// The scatter: a point per changed slot, onto its texel of the four state textures.
export const SCATTER_VS = `#version 300 es
layout(location=0) in float aSlot;
layout(location=1) in vec4 aT0;
layout(location=2) in vec4 aT1;
layout(location=3) in vec4 aT2;
layout(location=4) in vec4 aT3;
uniform vec2 uState;                          // the state textures' size
flat out vec4 v0, v1, v2, v3;
void main() {
  int s = int(aSlot + 0.5);
  vec2 texel = vec2(float(s & ${STATE_WIDTH - 1}), float(s >> ${Math.log2(STATE_WIDTH)})) + 0.5;
  gl_Position = vec4(texel / uState * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  v0 = aT0; v1 = aT1; v2 = aT2; v3 = aT3;
}`;

export const SCATTER_FS = `#version 300 es
precision highp float;
flat in vec4 v0, v1, v2, v3;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
layout(location=3) out vec4 o3;
void main() { o0 = v0; o1 = v1; o2 = v2; o3 = v3; }`;
