import { HEIGHT_STEPS, SPRITE_DEPTH_GLSL } from "@keel-engine/bake";
import { RAMP_LENGTH } from "./crawl-themes.ts";
import { COMMON, ROWS_GLSL, SHADE, VIEW_UNIFORMS } from "./dungeon-gl-world-shaders.ts";

// ---------------------------------------------------------------- lit sprites

interface SpriteLookLayout {
  readonly looksPerRow: number;
  readonly lookTexels: number;
  readonly paintsPerRow: number;
  readonly paletteRow: number;
}

export function spriteShaders(L: SpriteLookLayout): { vs: string; fs: string } {
  const vs = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in vec4 aRect;
layout(location=3) in vec2 aAnchor;
layout(location=4) in vec4 aExtra;            // page, look, flags, scale
layout(location=5) in float aFade;
${VIEW_UNIFORMS}
out vec3 vUv;
out vec2 vOff;                                 // metres right of its anchor, and up
flat out int vLook;
flat out vec3 vAnchor;
flat out float vFlags;
flat out float vFade;
flat out vec4 vDS;                             // depth sprites: the anchor's depth (m), its metres up the picture, its rect's height (texels), scale
flat out int vId;
void main() {
  vec3 d = aPos - uCenter;
  if (uPersp > 0.5) {
    // Perspective: the card stands at its anchor, scaled by its distance (its bake's density against the pixels a
    // metre is there), at the anchor's depth pulled a little toward the eye (so it stands clear of the floor).
    float z = perspZ(aPos);
    if (z < uClip.x) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float pk = perspK(aPos);
    vec2 an = floor(perspPx(aPos) + 0.5);
    float sc = aExtra.w * pk / uK;
    vec2 pp = an - floor(aAnchor * sc + 0.5) + aCorner * max(vec2(1.0), floor(aRect.zw * sc + 0.5));
    gl_Position = vec4(pp.x / uSize.x * 2.0 - 1.0, 1.0 - pp.y / uSize.y * 2.0, perspDepth(z - 0.35 * aExtra.w), 1.0);
    vUv = vec3(aRect.xy + aCorner * aRect.zw, aExtra.x);
    vOff = vec2((pp.x - an.x) / pk, (an.y - pp.y) / pk);
    vLook = int(floor(aExtra.y + 0.5));
    vAnchor = aPos; vFlags = aExtra.z; vFade = aFade;
    vDS = vec4(z, 0.0, aRect.w, aExtra.w);
    vId = gl_InstanceID;
    return;
  }
  vec2 anchor = floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  float s = aExtra.w;
  vec2 px = anchor - floor(aAnchor * s + 0.5) + aCorner * floor(aRect.zw * s + 0.5);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  // A card standing at its anchor: a texel h metres up is h * (-sin pitch) nearer along forward.
  float h = (anchor.y - px.y) / (uK * uUp.y);
  float depth = clamp(0.5 + (dot(d, uForward) + h * uForward.y) / uDepthRange, 0.0, 1.0);
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vUv = vec3(aRect.xy + aCorner * aRect.zw, aExtra.x);
  vOff = vec2((px.x - anchor.x) / uK, h);
  vLook = int(floor(aExtra.y + 0.5));
  vAnchor = aPos; vFlags = aExtra.z; vFade = aFade;
  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);
  vId = gl_InstanceID;
}`;
  const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp usampler2D;
uniform sampler2DArray uPages;
uniform highp usampler2D uLooks;
uniform highp usampler2D uPaints;
uniform sampler2D uLookPal;
uniform vec3 uRight; uniform vec3 uForward;
uniform float uTime;
uniform vec2 uFocus; uniform vec2 uHead; uniform vec2 uLat; uniform vec3 uCutE; uniform float uCutMode; uniform float uStub;
uniform vec4 uSil;                              // a silhouette pass: its colour, on
uniform highp sampler2DArray uHeights;          // depth sprites: a height per texel (keel/bake indexed.ts: two bytes)
uniform int uHeightOn;
uniform int uIds;                               // checks: every pixel its sprite's index + 1
uniform int uIdBase;
uniform float uK; uniform vec2 uSize; uniform float uDepthRange; uniform vec3 uUp;
${SHADE}
in vec3 vUv;
in vec2 vOff;
flat in int vLook;
flat in vec3 vAnchor;
flat in float vFlags;
flat in float vFade;
flat in vec4 vDS;
flat in int vId;
out vec4 outColor;
${COMMON}
${SPRITE_DEPTH_GLSL}
vec4 idColour() { int id = vId + uIdBase + 1; return vec4(float(id & 255) / 255.0, float((id >> 8) & 255) / 255.0, float((id >> 16) & 255) / 255.0, 1.0); }
vec4 lpal(int i) { return texelFetch(uLookPal, ivec2(i % ${L.paletteRow}, i / ${L.paletteRow}), 0); }
uint paintOf(int look, int slot) { uvec4 t = texelFetch(uLooks, ivec2((look % ${L.looksPerRow}) * ${L.lookTexels} + slot / 4, look / ${L.looksPerRow}), 0); int k = slot & 3; return k == 0 ? t.x : k == 1 ? t.y : k == 2 ? t.z : t.w; }
uvec4 paintTexel(uint p, int k) { int i = int(p); return texelFetch(uPaints, ivec2((i % ${L.paintsPerRow}) * 2 + k, i / ${L.paintsPerRow}), 0); }
float finish(int f, float s) { if (f == 1) return 0.08 + 0.9 * s; if (f == 2) return pow(max(s, 0.0), 0.9); if (f == 3) return clamp((s - 0.42) * 1.9 + 0.5, 0.0, 1.0); if (f == 4) return 0.45 + 0.6 * s; return s; }
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
  ivec2 fc = ivec2(gl_FragCoord.xy);
  float dth = bayer4(fc) - 0.5;
  if (vFade > 0.0 && bayer4(fc) < vFade) discard;
  vec4 c = texelFetch(uPages, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0);
  // Depth: the point this texel shows (its baked height: metres above the anchor), or the card's without one.
  float hy = vOff.y;
  float z = gl_FragCoord.z;
  if (uHeightOn == 1) {
    vec2 hb = texelFetch(uHeights, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0).rg * 255.0;
    float hv = floor(hb.r + 0.5) * 256.0 + floor(hb.g + 0.5);
    if (hv > 0.5) {
      hy = (hv - 1.0) / ${HEIGHT_STEPS.toFixed(1)} * vDS.w / uK;
      float fragB = (gl_FragCoord.y - uSize.y * 0.5) / uK;
      // (A tie with the floor under it goes to the thing: 2 mm.)
      z = clamp(0.5 + (spriteTexelDepth(vDS.x, vDS.y, fragB, hy, uUp.y, -uForward.y, 1.0) - 0.002) / uDepthRange, 0.0, 1.0);
    }
  }
  gl_FragDepth = z;
  // (A prop on a wall the cutaway sinks goes down with it -- by the height of each texel, as the wall's own top.)
  if (uCutMode > 0.5 && mod(floor(vFlags / 4.0), 2.0) > 0.5) {
    vec2 d = vAnchor.xz - uFocus;
    vec2 e = vec2(dot(d, uLat) / uCutE.x, (dot(d, uHead) + uCutE.y) / uCutE.z);
    bool stands = mod(floor(vFlags / 16.0), 2.0) > 0.5;
    // (Sunk to a stub, a front wall keeps nothing that hung on it -- a stump of a banner reads as a black box; what
    // stands on the floor against it is cut where the stub is.)
    if (uCutMode < 1.5) { if (!stands || hy > uStub) discard; }
    else {
      float cut = 1.0 - smoothstep(0.72, 1.0, length(e));
      if (cut > 0.0 && hy > uStub + (1.0 - cut) * 3.2 + (bayer4(fc) - 0.5) * 0.25) discard;
    }
  }
  if (uSil.a > 0.5) {
    // (Behind a wall: every other pixel of him in one pale colour, his outline solid.)
    bool on = vLook < 0 ? c.a >= 0.5 : (int(c.r * 255.0 + 0.5) & 63) != 0;
    // (Depth sprites: the floor he stands on never hides him, so only walls and what's before him call this. A card
    // without heights: not his feet -- the floor hid their soles, and that's no wall.)
    if (!on || (uHeightOn == 0 && vOff.y < 0.35)) discard;
    bool rim = vLook >= 0 && (int(c.r * 255.0 + 0.5) & 128) != 0;
    if (!rim && ((fc.x + fc.y) & 1) == 0) discard;
    outColor = vec4(uSil.rgb * (rim ? 1.0 : 0.8), 1.0);
    return;
  }
  // The light where the texel stands: along the card, a step toward the camera (off the wall it's against).
  vec3 at = vAnchor + uRight * vOff.x;
  vec2 lp = at.xz - normalize(uForward.xz) * 0.3;
  // (The brighter of the two: a prop on a back wall reads the room before it, one on the room's front row -- its
  // step toward the camera inside the front wall -- the ground it stands on.)
  vec3 La = lightAt(lp), Lb = lightAt(at.xz);
  vec3 Lc = max(La.r + La.g + La.b, Lb.r + Lb.g + Lb.b) == La.r + La.g + La.b ? La : Lb;
  Lc *= 0.85 + 0.2 * clamp(vOff.y / 2.0, 0.0, 1.0);
  bool unlit = mod(vFlags, 2.0) > 0.5;
  float vis = mod(floor(vFlags / 2.0), 2.0) > 0.5 ? 1.0 : max(fogAt(lp), fogAt(at.xz));
  if (vLook < 0) {
    if (c.a < 0.5) discard;
    if (uIds == 1) { outColor = idColour(); return; }
    float lum = max(Lc.r, max(Lc.g, Lc.b));
    outColor = vec4(c.rgb * (unlit ? vec3(1.0) : Lc / max(lum, 1e-4) * min(lum, 1.6)) * vis, 1.0);
    return;
  }
  int r = int(c.r * 255.0 + 0.5);
  int s = r & 63;
  if (s == 0) discard;
  int slot = s - 1;
  bool edge = (r & 128) != 0;
  uint p = paintOf(vLook, slot);
  if (p == 0u) discard;
  uvec4 A = paintTexel(p - 1u, 0);
  uvec4 B = paintTexel(p - 1u, 1);
  int base = int(A.x);
  int len = max(int(A.y & 255u), 1);
  int fin = int(A.y >> 8u);
  float t = finish(fin, c.g);
  int kind = int(A.z & 15u);
  float x = t * float(len - 1);
  if (kind == 6) x += (0.5 - c.a) * 2.0 * float(int(A.w) - 8);
  else if (kind > 0 && marks(kind, c.ba, float((A.z >> 4u) & 15u), float((A.z >> 8u) & 15u), float((A.z >> 12u) & 15u) / 8.0) > 0.5) {
    if (B.y > 0u) { base = int(B.x); len = max(int(B.y), 1); x = t * float(len - 1); }
    else x += float(int(A.w) - 8);
  }
  // Lit: the shade walked down its own ramp by the light (glowing finishes and unlit sprites keep theirs).
  bool glow = fin == 4 || unlit;
  float lum = max(Lc.r, max(Lc.g, Lc.b));
  vec3 tint = glow ? vec3(1.0) : mix(vec3(1.0), Lc / max(lum, 1e-4), 0.6);
  if (!glow) x = (x + 0.6) * min(lum * 1.08, 1.45) * vis - 0.6;
  // (A glow is seen from afar in what he has explored -- dimmer -- and not at all where he's never been.)
  else { if (vis < 0.04) discard; x *= mix(0.5, 1.0, vis); }
  x += dth * 0.2;
  // (The hero: a hair brighter than the room, his outline inked -- he never melts into the floor.)
  bool hero = mod(floor(vFlags / 8.0), 2.0) > 0.5;
  if (hero && !glow) x = max(x, (x + 0.6) * 0.6 + 1.1);
  int idx = clamp(int(floor(x + 0.5)), 0, len - 1);
  if (edge) idx = hero ? 0 : max(0, idx - 1);
  vec3 col = lpal(base + idx).rgb * tint;
  if (hero && edge) col *= 0.35;
  if (!glow && lum * vis < 0.16) col *= 0.55 + lum * vis * 2.8;
  outColor = uIds == 1 ? idColour() : vec4(col * clamp(vis * 3.5, 0.0, 1.0), 1.0);
}`;
  return { vs, fs };
}

// ---------------------------------------------------------------- flames and shafts

export const FLAME_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aA;    // x y z size
layout(location=2) in vec4 aB;    // kind seed flicker speed
${VIEW_UNIFORMS}
out vec2 vUv;
flat out vec4 vB;
flat out float vSize;
flat out vec2 vFogXZ;
void main() {
  float kind = aB.x;
  bool shaft = kind > 3.5;
  vec2 m = shaft ? vec2(2.2, 7.0) : vec2(0.5, 0.9) * aA.w;      // metres wide, tall
  vec3 d = aA.xyz - uCenter;
  bool persp = uPersp > 0.5;
  if (persp && perspZ(aA.xyz) < uClip.x) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float fk = persp ? perspK(aA.xyz) : uK;
  vec2 anchor = persp ? floor(perspPx(aA.xyz) + 0.5) : floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  vec2 sz = floor(m * vec2(fk, fk * (shaft && !persp ? uUp.y : 1.0)) + 0.5);
  sz = max(sz, vec2(3.0, 4.0));
  vec2 px = anchor + vec2((aCorner.x - 0.5) * sz.x, -aCorner.y * sz.y + (shaft ? 0.0 : sz.y * 0.18));
  px = floor(px + 0.5);
  float depth = clamp(0.5 + (dot(d, uForward) - 0.35) / uDepthRange, 0.0, 1.0);
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, persp ? perspDepth(perspZ(aA.xyz) - 0.35) : depth * 2.0 - 1.0, 1.0);
  vUv = vec2(aCorner.x, aCorner.y) * sz;
  vB = aB; vSize = sz.y; vFogXZ = aA.xz;
}`;
export const FLAME_FS = `#version 300 es
precision highp float;
${ROWS_GLSL}
uniform float uTime;
uniform sampler2D uPal;
uniform sampler2D uFog; uniform vec2 uFogScale; uniform float uFogOn; uniform float uRemembered;
in vec2 vUv;
flat in vec4 vB;
flat in float vSize;
flat in vec2 vFogXZ;
out vec4 outColor;
${COMMON}
vec3 palRow(int row, float x) { int i = clamp(int(floor(x + 0.5)), 0, ${RAMP_LENGTH - 1}); return texelFetch(uPal, ivec2(i, row), 0).rgb; }
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  float dth = bayer4(fc) - 0.5;
  float fog = 1.0;
  if (uFogOn > 0.5) { float f = texture(uFog, vFogXZ * uFogScale).r; fog = f < 0.43 ? (f / 0.43) * uRemembered : 1.0; if (fog < 0.05) discard; }
  float kind = vB.x;
  vec2 q = floor(vUv) + 0.5;
  float w = vSize;
  if (kind > 3.5) {
    // A moon shaft: a slanted beam of dithered light and slow motes.
    float u = q.x / max(1.0, w * 0.314) - 0.5;
    float v = q.y / w;
    float edge = abs(u + (v - 0.5) * 0.25);
    float dens = (0.13 - smoothstep(0.24, 0.5, edge) * 0.13) * (0.25 + 0.75 * v) * (1.0 - smoothstep(0.8, 1.0, v));
    float mote = step(0.992, hash12(floor(vec2(q.x, q.y + uTime * 6.0) / 2.0))) * step(edge, 0.4);
    // (Streaks along the beam, dithered by a scattered pattern -- a regular grid of dots reads as a screen, not light.)
    float streak = 0.35 + 0.65 * (0.5 + 0.5 * sin((u * 7.0 + v * 1.5) * 6.283 + uTime * 0.25));
    if (hash12(vec2(fc) + floor(uTime * 4.0) * 0.0) > dens * streak && mote < 0.5) discard;
    outColor = vec4(palRow(R_SHAFT, 4.0 + mote * 4.0 + dth), 1.0);
    return;
  }
  float f = flick(vB.y, vB.w, vB.z, uTime);
  vec2 uv = vec2(q.x / (w * 0.5556), q.y / w);      // (0..1 across, 0..1 up)
  float u = uv.x - 0.5, v = uv.y;
  // A flame: a teardrop licked sideways by noise, taller when it flares.
  float lick = (vnoise(vec2(v * 3.0 - uTime * 6.0, vB.y * 40.0)) - 0.5) * 0.35 * v;
  float h = 0.62 * f;
  float r = (v < 0.2 ? mix(0.22, 0.3, v / 0.2) : 0.3 * pow(max(0.0, 1.0 - (v - 0.2) / max(h - 0.2, 0.05)), 0.9)) * (kind == 2.0 ? 0.8 : 1.0);
  float dx = abs(u - lick);
  float core = 1.0 - dx / max(r, 1e-3);
  float tongue = step(0.72, vnoise(vec2(u * 6.0, v * 4.0 - uTime * 7.0) + vB.y * 13.0)) * step(v, h + 0.18) * step(dx, r + 0.12);
  // (A glow round it: a sparse dither halo.)
  float halo = 1.0 - length(vec2(u * 1.3, (v - 0.3) * 0.9)) * 2.4;
  if (core <= 0.0 && tongue < 0.5) {
    if (halo > 0.0 && bayer4(fc) < halo * 0.35 * fog) { outColor = vec4(palRow(kind == 3.0 ? R_MAGIC : R_FLAME, 2.0 + dth), 1.0); return; }
    discard;
  }
  float heat = clamp(core * 1.3 - v * 0.55 + 0.35, 0.0, 1.0);
  int row = kind == 3.0 ? R_MAGIC : R_FLAME;
  outColor = vec4(palRow(row, heat * 9.0 + dth * 1.2) * (0.6 + 0.4 * fog), 1.0);
}`;

// ---------------------------------------------------------------- contact shadows (a dithered dark ellipse under a thing)

export const SHADOW_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aS;     // x z radius
${VIEW_UNIFORMS}
out vec2 vQ;
void main() {
  vec2 q = aCorner * 2.0 - 1.0;
  vec3 p = vec3(aS.x + q.x * aS.z, 0.015, aS.y + q.y * aS.z);
  vQ = q;
  gl_Position = project(p);
}`;
export const SHADOW_FS = `#version 300 es
precision highp float;
uniform float uRing;
in vec2 vQ;
out vec4 outColor;
${COMMON}
void main() {
  float d = length(vQ);
  if (d > 1.0) discard;
  if (uRing > 0.5) {
    // (The hero's ring: a thin gold circle at his feet, every other pixel.)
    if (d < 0.8 || ((int(gl_FragCoord.x) + int(gl_FragCoord.y)) & 1) == 0) discard;
    outColor = vec4(0.98, 0.82, 0.4, 1.0);
    return;
  }
  // (Two bands, a soft rim and a darker middle: a contact shadow in pixel art, no dither.)
  outColor = vec4(vec3(d < 0.7 ? 0.5 : 0.72), 1.0);
}`;
