import { CRAWL_RAMPS, RAMP_LENGTH } from "./crawl-themes.ts";
import { MASK_PER_METRE } from "./dungeon-light.ts";
import { MAT, QUAD } from "./dungeon-scene.ts";

// ---------------------------------------------------------------- shared GLSL

export const ROW = Object.fromEntries(CRAWL_RAMPS.map((n, i) => [n, i])) as Record<(typeof CRAWL_RAMPS)[number], number>;
export const ROWS_GLSL = CRAWL_RAMPS.map((n, i) => `#define R_${n.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()} ${i}`).join("\n");
export const MATS_GLSL = Object.entries(MAT).map(([k, v]) => `#define M_${k} ${v}`).join("\n");

export const COMMON = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.3) * 0.15; }
float bayer4(ivec2 p) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
// A light's flicker: two hashed noises of time (fast flutter over a slow breath).
float flick(float seed, float speed, float amount, float t) {
  float a = vnoise(vec2(t * speed, seed * 97.0)) - 0.5;
  float b = vnoise(vec2(t * speed * 0.23 + 11.0, seed * 31.0)) - 0.5;
  return 1.0 + amount * (a * 1.3 + b * 0.9);
}`;

export const VIEW_UNIFORMS = `uniform vec3 uCenter, uRight, uUp, uForward; uniform float uK; uniform vec2 uSize; uniform float uDepthRange;
uniform float uPersp; uniform vec3 uEye; uniform float uTan; uniform vec2 uClip;   // perspective: on, the eye, tan(fov/2), near far
vec4 project(vec3 p) {
  if (uPersp > 0.5) {
    // (Depth linear in distance along forward, like the orthographic one: sprites and surfaces compare the same way.)
    vec3 e = p - uEye;
    float z = dot(e, uForward);
    return vec4(dot(e, uRight) / (uTan * uSize.x / uSize.y), dot(e, uUp) / uTan, (2.0 * (z - uClip.x) / (uClip.y - uClip.x) - 1.0) * z, z);
  }
  vec3 d = p - uCenter;
  vec2 px = vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK);
  float depth = clamp(0.5 + dot(d, uForward) / uDepthRange, 0.0, 1.0);
  return vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, depth * 2.0 - 1.0, 1.0);
}
// (Perspective: where a point lands in pixels, how far along forward it is, and how many pixels a metre is there.)
vec2 perspPx(vec3 p) { vec4 c = project(p); float w = max(c.w, 0.05); return vec2((c.x / w * 0.5 + 0.5) * uSize.x, (0.5 - c.y / w * 0.5) * uSize.y); }
float perspZ(vec3 p) { return dot(p - uEye, uForward); }
float perspK(vec3 p) { return uSize.y * 0.5 / (max(perspZ(p), 0.05) * uTan); }
float perspDepth(float z) { return clamp(2.0 * (z - uClip.x) / (uClip.y - uClip.x) - 1.0, -1.0, 1.0); }`;

// Lighting + fog + palette, shared by surfaces and sprites.
export const SHADE = `
uniform sampler2D uPal;          // ${RAMP_LENGTH} x rows
uniform sampler2D uLight;        // the light map
uniform vec4 uLightRect;         // origin x z, 1 / size x z (metres)
uniform float uLightScale;
uniform sampler2D uFog;          // a byte a cell
uniform vec2 uFogScale;          // 1 / (cells * tile)
uniform float uFogOn;
uniform vec3 uAmbient;
uniform float uRemembered;
uniform float uLightsOn;
vec3 palRow(int row, float x) { int i = clamp(int(floor(x + 0.5)), 0, ${RAMP_LENGTH - 1}); return texelFetch(uPal, ivec2(i, row), 0).rgb; }
vec3 lightAt(vec2 xz) { return uAmbient + (uLightsOn > 0.5 ? texture(uLight, (xz - uLightRect.xy) * uLightRect.zw).rgb * uLightScale : vec3(0.0)); }
float fogAt(vec2 xz) {
  if (uFogOn < 0.5) return 1.0;
  float f = texture(uFog, xz * uFogScale).r;
  return f < 0.43 ? mix(0.07, uRemembered, f / 0.43) : mix(uRemembered, 1.0, (f - 0.43) / 0.57);
}
// A shade (0..1 of the ramp) under a light, through the fog, dithered to a palette entry, the light's colour over it.
vec3 litEntry(int row, float t, float emit, vec3 L, float vis, float dth) {
  float lum = max(L.r, max(L.g, L.b));
  vec3 tint = L / max(lum, 1e-4);
  float lv = mix(min(lum, 1.7), 1.0, emit) * vis;
  float x = t * lv * float(${RAMP_LENGTH - 1});
  x += dth * 0.55 * clamp(x - 0.6, 0.0, 1.0);
  vec3 c = palRow(row, x);
  c *= mix(mix(vec3(1.0), tint, 0.85), vec3(1.0), emit);
  return c * clamp(vis * 3.5, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- the light map pass

export const LIGHT_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aA;     // x y z radius
layout(location=2) in vec4 aB;     // r g b strength
layout(location=3) in vec4 aC;     // flicker speed seed kind
layout(location=4) in vec4 aD;     // mask x0 z0 u0 v0 (texels)
layout(location=5) in vec2 aE;     // mask size (texels), on
uniform vec4 uMap;                 // origin x z, size x z (metres)
out vec2 vXZ;
flat out vec4 vA; flat out vec4 vB; flat out vec4 vC; flat out vec4 vD; flat out float vSize;
void main() {
  float size = aE.x / ${MASK_PER_METRE}.0;
  vec2 xz = aD.xy + aCorner * size;
  vXZ = xz; vA = aA; vB = aB; vC = aC; vD = aD; vSize = aE.x;
  if (aE.y < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 uv = (xz - uMap.xy) / uMap.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
export const LIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uMasks;
uniform vec2 uMaskInv;             // 1 / atlas size
uniform float uTime;
in vec2 vXZ;
flat in vec4 vA; flat in vec4 vB; flat in vec4 vC; flat in vec4 vD; flat in float vSize;
out vec4 outColor;
${COMMON}
void main() {
  float f = flick(vC.z, vC.y, vC.x, uTime);
  // (The flame sways: the pool's middle wanders a few centimetres.)
  vec2 c = vA.xz + vec2(vnoise(vec2(uTime * vC.y * 0.5, vC.z * 13.0)) - 0.5, vnoise(vec2(uTime * vC.y * 0.5 + 5.0, vC.z * 7.0)) - 0.5) * 0.08 * vC.x;
  float d = length(vXZ - c) / (vA.w * (0.96 + 0.04 * f));
  if (d >= 1.0) discard;
  float fall = (1.0 - d * d); fall *= fall;
  float core = 1.0 - d; core *= core; core *= core;
  fall += core * core * 0.6;
  vec2 mt = vD.zw + clamp((vXZ - vD.xy) * ${MASK_PER_METRE}.0, vec2(0.5), vec2(vSize - 0.5));
  float m = texture(uMasks, mt * uMaskInv).r;
  outColor = vec4(vB.rgb * vB.a * fall * m * f, 1.0);
}`;

// ---------------------------------------------------------------- surfaces

export const WORLD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aP;
layout(location=2) in vec3 aU;
layout(location=3) in vec3 aV;
layout(location=4) in vec3 aM;     // material, seed, bits + 256 kind
layout(location=5) in vec4 aC;     // column x z, neighbour column x z
${VIEW_UNIFORMS}
uniform vec2 uFocus; uniform vec2 uHead; uniform vec2 uLat;
uniform vec3 uCutE;              // the cutaway's ellipse: across (half), its centre toward the camera, its reach along
uniform float uCutMode;            // 0 off, 1 stub, 2 dither
uniform float uStub;
uniform float uFront;              // front walls (bit 32; a neighbour's, bit 64) kept low everywhere: 1, or 0
out vec3 vPos;
out vec2 vFace;                    // along the face (m, world-anchored), and its height (m)
out vec2 vLocal;                   // from the quad's corner: along it, up it (m)
flat out vec2 vSpan;               // the quad's bottom and (uncut) top
flat out vec3 vN;
flat out ivec4 vMat;               // material, seed, bits, kind
flat out vec4 vC;
out float vCut;
uniform sampler2D uFog;            // (the fog, as the surfaces read it)
uniform vec2 uFogScale;
uniform float uFogOn;
float cutAt(vec2 c) {
  if (uCutMode < 0.5 || c.x > 1e8) return 0.0;
  vec2 d = c - uFocus;
  // (An ellipse in front of the hero: by default across the view 6.5 m either side, along it from just behind him to 7 m before.)
  vec2 e = vec2(dot(d, uLat) / uCutE.x, (dot(d, uHead) + uCutE.y) / uCutE.z);
  float cut = 1.0 - smoothstep(0.72, 1.0, length(e));
  // (Kept low too: a wall whose near side is ground he has never seen -- the back wall of some unexplored corridor
  // -- never stands as a black slab between the camera and the rooms he knows.)
  if (uFogOn > 0.5 && uCutMode < 1.5) {
    float f = textureLod(uFog, (c - uHead * 0.9) * uFogScale, 0.0).r;
    if (f < 0.2) cut = max(cut, 1.0 - smoothstep(14.0, 18.0, length(d)));
  }
  return cut;
}
float cutH(float y, float c) { return y > uStub ? mix(y, uStub, c) : y; }
void main() {
  int code = int(aM.z + 0.5);
  int kind = code / 256;
  int bits = code - kind * 256;
  vec3 p;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float cut = 0.0;
  bool stub = uCutMode > 0.5 && uCutMode < 1.5;
  float frontCut = (bits & 32) != 0 ? uFront : 0.0;
  if (kind == ${QUAD.CAP}) {
    cut = max(cutAt(aC.xy), frontCut);
    p = aP + aU * aCorner.x + aV * aCorner.y;
    if (stub) p.y = cutH(aP.y, cut);
  } else if (kind == ${QUAD.FACE} || kind == ${QUAD.INNER}) {
    cut = max(cutAt(aC.xy), frontCut);
    float top = aP.y + aV.y, bot = aP.y;
    if (stub) { top = cutH(top, cut); if (kind == ${QUAD.INNER}) bot = cutH(bot, max(cutAt(aC.zw), (bits & 64) != 0 ? uFront : 0.0)); }
    if (top <= bot + 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    p = aP + aU * aCorner.x;
    p.y = mix(bot, top, aCorner.y);
    n = normalize(cross(vec3(0.0, 1.0, 0.0), aU));
  } else {
    p = aP + aU * aCorner.x + aV * aCorner.y;
    n = normalize(cross(aV, aU));
  }
  vPos = p;
  vec3 un = normalize(aU);
  vFace = vec2(dot(p, un), p.y);
  vLocal = vec2(dot(p - aP, un), p.y - aP.y);
  vSpan = vec2(aP.y, aP.y + aV.y);
  vN = n;
  vMat = ivec4(int(aM.x + 0.5), int(aM.y + 0.5), bits, kind);
  vC = aC;
  vCut = stub ? 0.0 : cut;
  gl_Position = project(p);
}`;

export const WORLD_FS = `#version 300 es
precision highp float;
precision highp int;
${ROWS_GLSL}
${MATS_GLSL}
uniform float uTime;
uniform ivec4 uStyle;              // wall, floor, corridor, stain row
uniform vec3 uAbyssFog;
uniform vec3 uCam;                 // the camera's direction (forward)
uniform float uPersp; uniform vec3 uEye;   // perspective: the camera's direction is from the eye to each point
uniform vec4 uDoorGlow;            // (unused .xyz) , niches share
uniform float uTile;
uniform sampler2D uDecor;          // per cell, blended: moss, puddle, stain, lava crack
uniform sampler2D uLiquid;         // per cell, blended: pool or lava (its shore wanders across the cell edges)
uniform float uLava;
uniform sampler2D uAo;             // per half metre: how shut in by walls (contact shade)
uniform vec2 uAoScale;
uniform float uIds;                // checks: 1 surfaces draw as 0, 2 as their depth (24 bits over RGB; see DungeonDrawOptions.debug)
${SHADE}
in vec3 vPos;
in vec2 vFace;
in vec2 vLocal;
flat in vec2 vSpan;
flat in vec3 vN;
flat in ivec4 vMat;
flat in vec4 vC;
in float vCut;
out vec4 outColor;
${COMMON}
// (What a surface writes: its colour, or for the checks 0 or its depth -- see DungeonDrawOptions.debug.)
vec4 surfaceOut(vec3 c) {
  if (uIds > 1.5) { uint v = uint(clamp(gl_FragCoord.z, 0.0, 1.0) * 16777215.0 + 0.5); return vec4(float(v >> 16u) / 255.0, float((v >> 8u) & 255u) / 255.0, float(v & 255u) / 255.0, 1.0); }
  return uIds > 0.5 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(c, 1.0);
}
struct Surf { int row; float t; float emit; };
Surf S(int row, float t) { return Surf(row, clamp(t, 0.0, 1.0), 0.0); }
Surf E(int row, float t) { return Surf(row, clamp(t, 0.0, 1.0), 1.0); }

// Stones in courses: (course index, stone index, local position 0..1, edge distance in metres).
struct Stone { vec2 id; vec2 f; float edge; vec2 e4; };
Stone course(vec2 p, float h, float lenBase, float jitter, float seed) {
  float row = floor(p.y / h);
  float fy = fract(p.y / h);
  float off = hash11(row * 1.7 + seed) * lenBase;
  float q = p.x + off;
  // (Stone lengths wander: boundaries every lenBase, each nudged.)
  float k = floor(q / lenBase);
  float b0 = (k + (hash11(k * 3.1 + row * 7.7 + seed) - 0.5) * jitter) * lenBase;
  float b1 = (k + 1.0 + (hash11((k + 1.0) * 3.1 + row * 7.7 + seed) - 0.5) * jitter) * lenBase;
  if (q < b0) { k -= 1.0; b1 = b0; b0 = (k + (hash11(k * 3.1 + row * 7.7 + seed) - 0.5) * jitter) * lenBase; }
  else if (q >= b1) { k += 1.0; b0 = b1; b1 = (k + 1.0 + (hash11((k + 1.0) * 3.1 + row * 7.7 + seed) - 0.5) * jitter) * lenBase; }
  vec2 f = vec2((q - b0) / max(b1 - b0, 1e-3), fy);
  vec4 e = vec4((q - b0), (b1 - q), fy * h, (1.0 - fy) * h);   // left right bottom top
  return Stone(vec2(k, row), f, min(min(e.x, e.y), min(e.z, e.w)), vec2(min(e.x, e.y), min(e.z, e.w)));
}
// A dressed stone's shade: its own tone, a bevel (the edge toward the light pale, the far one dark), a speckle.
float stoneShade(Stone s, vec2 p, float base, float spread, float bevel, vec4 e4) {
  float t = base + (hash12(s.id + 0.37) - 0.5) * spread;
  t += vnoise(p * 17.0) * 0.1 - 0.05;
  if (e4.w < bevel) t += 0.12; else if (e4.z < bevel) t -= 0.14;
  if (e4.x < bevel * 0.7) t += 0.05; else if (e4.y < bevel * 0.7) t -= 0.06;
  return t;
}
vec4 edges4(Stone s) { return vec4(s.f.x, 1.0 - s.f.x, s.f.y, 1.0 - s.f.y); }

// ------------------------------------------------ floors
// Rock: Voronoi facets (x: distance to the nearest border, yz: the facet's id).
vec3 vor(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y += 1) for (int x = -1; x <= 1; x += 1) {
    vec2 g = vec2(float(x), float(y));
    vec2 r = g + vec2(hash12(i + g), hash12(i + g + 17.3)) * 0.85 + 0.075 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d2) - sqrt(d1), id);
}
// A facet's shade: its own tone, lit along its upper border, shaded along its lower one, crevices dark.
float rockShade(vec2 q, float up) {
  vec3 v = vor(q);
  if (v.x < 0.07) return 0.07;
  float t = 0.3 + hash12(v.yz) * 0.22;
  if (vor(q + vec2(0.0, up)).yz != v.yz) t += 0.16;
  else if (vor(q - vec2(0.0, up)).yz != v.yz) t -= 0.12;
  return t;
}
// A crack: one unbroken pixel-wide line (its width from the screen, so it never falls apart into dots), its lip on
// the far side catching the light.
Surf crack(Surf o, vec2 p, int seed) {
  // (Only stretches of the contour -- where a second, slower field says so -- so a crack runs and stops, never loops.)
  float n = vnoise(p * 2.2 + float(seed) * 0.13) - 0.5;
  float w = max(fwidth(n), 1e-4);
  if (vnoise(p * 0.9 + float(seed) * 0.37 + 11.0) < 0.55) return o;
  if (abs(n) < w * 0.5) return S(o.row, max(o.t - 0.3, 0.08));
  if (n > 0.0 && n < w * 1.5) o.t += 0.08;
  return o;
}
// Big flagstones: each cell split its own way (four squares, two slabs either way, one great slab, an L), the splits
// a little off true; mortar, bevels toward the light, chipped corners; a crypt's great slabs carved as tomb lids.
Surf floorSlabs(vec2 p, int style, int bits, int seed) {
  vec2 cid = floor(p / uTile);
  vec2 c = p - cid * uTile;
  float hv = hash12(cid * 1.37 + 0.5);
  bool swap = hash12(cid + 7.1) > 0.5;
  if (swap) c = c.yx;
  float sx = uTile * 0.5 + (hash12(cid + 2.3) - 0.5) * 0.3, sy = uTile * 0.5 + (hash12(cid + 3.9) - 0.5) * 0.3;
  vec2 lo = vec2(0.0), hi = vec2(uTile);
  int v = int(hv * 6.0);
  if (v == 0 || v == 5) { lo = vec2(c.x < sx ? 0.0 : sx, c.y < sy ? 0.0 : sy); hi = vec2(c.x < sx ? sx : uTile, c.y < sy ? sy : uTile); }
  else if (v == 1) { lo = vec2(0.0, c.y < sy ? 0.0 : sy); hi = vec2(uTile, c.y < sy ? sy : uTile); }
  else if (v == 2) { lo = vec2(c.x < sx ? 0.0 : sx, 0.0); hi = vec2(c.x < sx ? sx : uTile, uTile); }
  else if (v == 4) { if (c.y < sy) { lo = vec2(0.0); hi = vec2(uTile, sy); } else { lo = vec2(c.x < sx ? 0.0 : sx, sy); hi = vec2(c.x < sx ? sx : uTile, uTile); } }
  vec4 e = vec4(c.x - lo.x, hi.x - c.x, c.y - lo.y, hi.y - c.y);
  if (swap) e = e.zwxy;
  float edge = min(min(e.x, e.y), min(e.z, e.w));
  vec2 sid = cid * 4.0 + lo;
  float q = hash12(sid + 4.1);
  if (edge < 0.03) return S(R_FLOOR, 0.3 + vnoise(p * 9.0) * 0.08);
  float t = 0.5 + (q - 0.5) * 0.12 + (fbm(p * 0.35) - 0.5) * 0.16 + vnoise(p * 17.0) * 0.09 - 0.045;
  // (The bevel: north and east edges catch the light, south and west fall in shade.)
  if (e.w < 0.07) t += 0.1; else if (e.z < 0.06) t -= 0.12;
  if (e.y < 0.06) t += 0.05; else if (e.x < 0.05) t -= 0.06;
  // (Chipped corners, pitted wear.)
  if (min(e.x, e.y) < 0.16 && min(e.z, e.w) < 0.16 && vnoise(p * 11.0) > 0.55) t -= 0.14;
  if (vnoise(p * 9.0 + q * 7.0) > 0.8) t -= 0.07;
  Surf o = S(q > 0.86 ? R_FLOOR_ALT : R_FLOOR, t);
  // A great slab in a crypt: a carved lid (a border, a cross or a rune).
  if (v == 3 && style == 0 && hash12(cid + 9.7) > 0.45) {
    vec2 m = abs(p - (cid + 0.5) * uTile);
    bool border = abs(max(m.x, m.y) - 0.72) < 0.025;
    bool cross = (m.x < 0.035 && m.y < 0.55) || (abs(p.y - (cid.y + 0.5) * uTile - 0.18) < 0.035 && m.x < 0.3);
    if (border || cross) o = S(R_FLOOR, 0.2);
  }
  if ((bits & 128) != 0 || style == 3) {
    if (hash12(sid + 9.3) < ((bits & 128) != 0 ? 0.4 : 0.07)) {
      o = S(R_DIRT, 0.32 + vnoise(p * 11.0) * 0.2);
      if (vnoise(p * 7.0 + 3.0) > 0.7) o = S(R_FLOOR, 0.3);
      if (style == 3 && vnoise(p * 5.0) > 0.55) o = S(R_IVY, 0.32 + vnoise(p * 23.0) * 0.3);
    }
  }
  if ((bits & 1) != 0 && hash12(sid + 2.2) < 0.6) o = crack(o, p, seed);
  if ((bits & 2) != 0 && edge < 0.07 && vnoise(p * 3.0 + 1.0) > 0.45) o = S(R_MOSS, 0.26 + vnoise(p * 19.0) * 0.2);
  return o;
}
Surf floorFlag(vec2 p, int style, int bits, int seed, bool corridor) {
  float h = corridor ? 0.34 : (style == 2 ? 1.0 : 0.667);
  float L = corridor ? 0.42 : (style == 2 ? 1.0 : 0.8);
  Stone s = course(p, h, L, style == 2 ? 0.05 : 0.5, corridor ? 3.0 : 0.0);
  float mortar = style == 2 ? 0.025 : 0.035;
  vec2 lr = vec2(s.f.x * 0.0, 0.0);
  float eL = s.e4.x, eB = s.e4.y;
  Surf o;
  if (s.edge < mortar) o = S(R_FLOOR, 0.26 + vnoise(p * 9.0) * 0.06);
  else {
    vec4 e4 = vec4(0.0);
    float q = hash12(s.id + 4.1);
    float base = style == 2 ? 0.34 : 0.52;
    float t = base + (q - 0.5) * 0.12 + (fbm(p * 0.35) - 0.5) * 0.18 + vnoise(p * 17.0) * 0.1 - 0.05;
    if (hash12(s.id + 6.6) > 0.9) t -= 0.08;   // (a sunk, darker stone now and then)
    // (Bevel: the stone's north edge catches the light, its south edge falls in shade.)
    float fy = fract(p.y / h) * h;
    if (h - fy < 0.07) t += 0.1; else if (fy < 0.06) t -= 0.13;
    o = S(q > 0.86 ? R_FLOOR_ALT : R_FLOOR, t);
    // (Wear: grit in a stone's pits.)
    if (vnoise(p * 9.0 + q * 7.0) > 0.78) o.t -= 0.08;
    if (style == 2) { o.t -= vnoise(p * 3.0) * 0.12; }
    // Broken paving: a stone gone, earth and grit in its place.
    if (((bits & 128) != 0 || style == 3) && hash12(s.id + 9.3) < ((bits & 128) != 0 ? 0.45 : 0.12)) {
      o = S(R_DIRT, 0.34 + vnoise(p * 11.0) * 0.2);
      if (vnoise(p * 7.0 + 3.0) > 0.72) o = S(R_FLOOR, 0.32);
      if (style == 3 && vnoise(p * 5.0) > 0.6) o = S(R_IVY, 0.35 + vnoise(p * 23.0) * 0.3);
    }
    // Cracked: a jagged line across it.
    if ((bits & 1) != 0 && hash12(s.id + 2.2) < 0.55) o = crack(o, p, seed);
  }
  // Moss creeps into the joints first (the patches are decor's).
  if ((bits & 2) != 0 && s.edge < mortar * 1.6 && vnoise(p * 3.0 + 1.0) > 0.45) o = S(R_MOSS, 0.26 + vnoise(p * 19.0) * 0.2);
  return o;
}
Surf floorEarth(vec2 p, int bits, int seed) {
  float t = 0.42 + fbm(p * 0.9) * 0.14 - 0.07;
  Surf o = S(R_DIRT, t + vnoise(p * 21.0) * 0.07);
  // Flat rock breaking through the earth in plates, lit on their north edges; pebbles with their shadow to the south.
  float r = vnoise(p * 0.7 + 5.0);
  // (Rock under the earth: its bumps shaded as if lit from the north -- a slope, not a pattern.)
  float hN = fbm(p * 0.5 + vec2(0.0, 0.1)), h0 = fbm(p * 0.5);
  o.t += (hN - h0) * 0.9 + (fbm(p * 0.15) - 0.5) * 0.14;
  if (r > 0.7) { vec3 v = vor(p * 0.9); o = S(R_FLOOR, 0.36 + hash12(v.yz) * 0.1 + (hN - h0) * 2.0 + vnoise(p * 13.0) * 0.08 - (v.x < 0.05 ? 0.12 : 0.0)); }
  vec2 g = floor(p * 4.0), f = fract(p * 4.0) - 0.5;
  float hsh = hash12(g + float(seed) * 0.01);
  if (hsh > 0.84) { float d = length(f + (vec2(hash12(g + 1.3), hash12(g + 2.7)) - 0.5) * 0.4); if (d < 0.22) o = S(R_FLOOR, f.y > 0.05 ? 0.62 : 0.5); else if (d < 0.3 && f.y < 0.0) o.t -= 0.1; }
  return o;
}
Surf floorOf(vec2 p, int mat, int bits, int seed) {
  int style = mat == M_CORRIDOR ? uStyle.z : mat == M_CAVE ? 1 : uStyle.y;
  if (style == 1) return floorEarth(p, bits, seed);
  if ((style == 0 || style == 3) && mat != M_CORRIDOR) return floorSlabs(p, style, bits, seed);
  return floorFlag(p, style, bits, seed, mat == M_CORRIDOR);
}
// Decor over any floor: puddles, grates, stains, lava cracks, the sigil.
Surf decor(Surf o, vec2 p, vec2 cell, int bits, int seed) {
  vec2 c = cell - 0.5 * uTile;            // (from the cell's middle, metres)
  if ((bits & 8) != 0 && abs(c.x) < 0.62 && abs(c.y) < 0.62) {
    bool bar = abs(fract((c.x + 0.62) / 0.2) - 0.5) > 0.3 || abs(fract((c.y + 0.62) / 0.2) - 0.5) > 0.3;
    bool rim = abs(c.x) > 0.54 || abs(c.y) > 0.54;
    o = S(rim || bar ? R_IRON : R_ABYSS, rim ? (c.y > 0.5 ? 0.62 : 0.42) : bar ? 0.36 : 0.08);
  }
  // (Masks from the decor texture, blended across cells: a puddle or a patch of moss has no square edge.)
  vec4 dm = texture(uDecor, p * uFogScale);
  if (dm.r > 0.05) { float m = vnoise(p * 2.2 + 3.7) * 0.75 + dm.r * 0.55; if (m > 0.86) o = S(R_MOSS, 0.28 + vnoise(p * 19.0) * 0.26 + (m - 0.86)); }
  if (dm.g > 0.05) {
    float b = vnoise(p * 0.9 + 1.3) * 0.7 + dm.g * 0.5;
    if (b > 0.84) {
      float rip = vnoise(p * 3.0 + vec2(uTime * 0.25, -uTime * 0.18));
      o = S(R_WATER, 0.2 + rip * 0.16 + (b < 0.87 ? 0.12 : 0.0));
      if (abs(fract(rip * 3.0 + uTime * 0.1) - 0.5) < 0.04) o.t += 0.28;
    }
  }
  if (dm.b > 0.05) { float b = vnoise(p * 1.6 + 9.0) * 0.7 + dm.b * 0.45; if (b > 0.88) o = S(uStyle.w, 0.16 + (b - 0.88) * 1.2); }
  if (dm.a > 0.05) {
    // (The crust broken into plates, molten rock showing between them: a white-hot core, an orange rim, scorched
    // stone either side -- wider where the field is strong, closing up at its edge.)
    float cr = vor(p * 1.25 + 0.3).x * 0.55;
    float wdt = 0.045 * smoothstep(0.15, 0.7, dm.a);
    float pulse = 0.5 + 0.12 * sin(uTime * 1.7 + p.x * 2.0 + p.y);
    if (cr < wdt * 0.45) o = E(R_LAVA, pulse + 0.3);
    else if (cr < wdt) o = E(R_LAVA, pulse - 0.15);
    else if (cr < wdt * 2.5) { o = E(R_LAVA, 0.12 + (1.0 - (cr - wdt) / (wdt * 1.5)) * 0.14); }
    else if (cr < wdt * 4.0) o.t *= 0.7;
  }
  if ((bits & 64) != 0) {
    float r = length(c);
    float a = atan(c.y, c.x);
    bool ring = abs(r - 0.82) < 0.05 || abs(r - 0.6) < 0.03;
    bool spoke = r < 0.82 && r > 0.2 && abs(fract(a / 6.2832 * 5.0) - 0.5) < 0.03 / max(r, 0.2) * 1.4;
    bool rune = r > 0.62 && r < 0.8 && hash12(vec2(floor(a * 3.0), 3.0)) > 0.5 && abs(fract(a * 3.0) - 0.5) < 0.2;
    if (ring || spoke || rune) o = E(R_GLOW, 0.55 + 0.35 * sin(uTime * 2.3));
  }
  return o;
}
// A rug: a border band with a gilt line, a patterned field; a runner is striped.
Surf rug(Surf o, vec2 cell, vec4 rugC, int style) {
  vec2 local = vec2(mod(rugC.z, 64.0), mod(rugC.w, 64.0)) * uTile + cell;
  vec2 size = vec2(floor(rugC.z / 64.0), floor(rugC.w / 64.0)) * uTile;
  vec2 in2 = local - vec2(0.18);
  vec2 sz = size - vec2(0.36);
  if (in2.x < 0.0 || in2.y < 0.0 || in2.x > sz.x || in2.y > sz.y) return o;
  float e = min(min(in2.x, in2.y), min(sz.x - in2.x, sz.y - in2.y));
  if (e < 0.05) return S(R_RUG, 0.18);
  if (e < 0.3) { bool gilt = abs(e - 0.17) < 0.03; return S(gilt ? R_RUG_ALT : R_RUG, gilt ? 0.72 : 0.42 + (fract((in2.x + in2.y) * 2.5) < 0.5 ? 0.06 : -0.04)); }
  vec2 q = in2 - 0.3;
  if (style == 3) return S(R_RUG, abs(fract(q.x * 1.5) - 0.5) < 0.12 ? 0.58 : 0.4);
  vec2 dm = abs(fract(q * vec2(1.0, 1.0) * 1.1) - 0.5);
  float dd = dm.x + dm.y;
  if (dd < 0.18) return S(R_RUG_ALT, 0.62);
  if (abs(dd - 0.3) < 0.035) return S(R_RUG_ALT, 0.46);
  return S(R_RUG, style == 2 ? 0.46 : 0.38 + vnoise(q * 9.0) * 0.06);
}

// ------------------------------------------------ walls
Surf wallFace(vec2 f, vec3 pos, int seed, int dir, float H, bool outer) {
  float s = f.x, y = f.y;
  int style = uStyle.x;
  if (y < 0.0) {
    // Foundations under the floor, rough, falling into the dark.
    Stone st = course(vec2(s, y), 0.55, 1.1, 0.6, 5.0);
    return S(R_WALL_ALT, st.edge < 0.05 ? 0.1 : 0.3 + (hash12(st.id) - 0.5) * 0.2 + vnoise(vec2(s, y) * 9.0) * 0.1);
  }
  if (style == 1) {
    // Raw rock: facets lit along their tops, crevices between, a vein of the other stone now and then.
    // (Big facets, lit along their tops; a crevice only here and there between them; strata streaking across --
    // a rock mass, not fieldstone laid in mortar.)
    vec2 q = vec2(s * 1.05, y * 1.5);
    vec3 v = vor(q);
    float id = hash12(v.yz);
    float t = 0.3 + id * 0.18;
    if (vor(q + vec2(0.0, 0.14)).yz != v.yz) t += 0.15; else if (vor(q - vec2(0.0, 0.14)).yz != v.yz) t -= 0.11;
    if (v.x < 0.045 && hash12(v.yz + 3.1) > 0.55) t = 0.1;
    t += (fbm(vec2(s * 0.5, y * 3.2)) - 0.5) * 0.16 + vnoise(vec2(s, y) * 23.0) * 0.06;
    Surf o = S(R_WALL, t);
    if (y < 0.5 && vnoise(vec2(s * 2.0, y * 4.0)) > 0.55 - (0.5 - y)) o = S(R_MOSS, 0.28 + vnoise(vec2(s, y) * 17.0) * 0.25);
    if (y > H - 0.12) o.t += 0.12;
    return o;
  }
  bool brick = style == 3;
  float ch = brick ? 0.16 : (style == 2 ? 0.5 : 0.35), cl = brick ? 0.34 : (style == 2 ? 0.6 : 0.7);
  float by = y;
  Surf o;
  // Plinth and cornice (ashlar and basalt).
  if (!brick && y < 0.42) {
    Stone st = course(vec2(s, y), 0.42, 0.9, 0.3, 11.0);
    o = S(R_TRIM, st.edge < 0.03 ? 0.12 : 0.36 + (hash12(st.id) - 0.5) * 0.12 + (0.42 - y < 0.05 ? 0.2 : 0.0) + vnoise(vec2(s, y) * 15.0) * 0.08);
    return o;
  }
  if (!brick && y > H - 0.16 && style == 0) return S(R_TRIM, (H - y < 0.04 ? 0.62 : 0.44) + vnoise(vec2(s, y) * 13.0) * 0.08);
  Stone st = course(vec2(s, by), ch, cl, brick ? 0.3 : 0.35, float(dir) * 3.0);
  float mortar = brick ? 0.022 : 0.03;
  if (st.edge < mortar) {
    // (Basalt: most joints dark; a vein of them molten, breathing.)
    float vein = vnoise(vec2(s * 0.35, y * 0.5) + float(dir) * 5.0);
    // (Half their own light, half the room's: in the dark they smoulder, never a red wireframe across the black.)
    if (style == 2 && !outer && vein > 0.84 && y < H * 0.6) { float pulse = 0.3 + 0.12 * sin(uTime * 1.3 + s * 0.8 + y * 2.0); return Surf(R_LAVA, clamp(pulse + (vein - 0.84) * 2.5, 0.0, 1.0), 0.5); }
    o = S(R_WALL, 0.1);
  } else {
    float fy = fract(by / ch) * ch;
    float t = (brick ? 0.46 : style == 2 ? 0.3 : 0.5) + (hash12(st.id + 0.37) - 0.5) * 0.22 + vnoise(vec2(s, y) * 19.0) * 0.1 - 0.05;
    if (ch - fy < 0.05) t += 0.12; else if (fy < 0.045) t -= 0.14;
    float fx = st.f.x;
    if (fx < 0.06) t += 0.04; else if (fx > 0.94) t -= 0.05;
    // (Chipped corners; the odd darker block.)
    if (min(fx, 1.0 - fx) < 0.12 && vnoise(vec2(s, y) * 9.0) > 0.7) t -= 0.12;
    o = S(hash12(st.id + 7.7) > 0.78 ? R_WALL_ALT : R_WALL, t);
    if (style == 2) o.t -= y / H * 0.12;
    // A ruin's brick: some gone, holes left.
    if (brick && hash12(st.id + 3.3) < 0.07) o = S(R_ABYSS, 0.14);
  }
  // Crypt niches: a recess, arched, a skull or two in it.
  if (style == 0 && !outer && uDoorGlow.w > 0.0) {
    float cell = floor(s / 1.6);
    if (hash11(cell * 5.3 + float(dir) * 1.9) < uDoorGlow.w && y > 0.75 && y < 1.95) {
      float lx = s - (cell + 0.5) * 1.6;
      float top = 1.6 + sqrt(max(0.0, 0.1 - lx * lx)) * 1.1;
      if (abs(lx) < 0.38 && y < top) {
        if (abs(lx) > 0.33 || y < 0.8 || y > top - 0.05) return S(R_TRIM, 0.5);
        o = S(R_ABYSS, 0.1 + (1.95 - y) * 0.08);
        // (What's in a niche: one skull, two, three, or a heap of bones -- never the same twice along a wall.)
        float what = hash11(cell * 7.7 + float(dir));
        int count = what < 0.3 ? 1 : what < 0.7 ? 2 : 3;
        if (what > 0.88 && y < 1.02 && vnoise(vec2(lx, y) * 30.0) > 0.45) return S(R_BONE, 0.45 + vnoise(vec2(lx, y) * 40.0) * 0.3);
        for (int k = 0; k < 3; k += 1) {
          if (k >= count) break;
          vec2 sc = vec2((count == 1 ? 0.0 : count == 2 ? (k == 0 ? -0.14 : 0.13) : (float(k) - 1.0) * 0.17) + (hash11(cell + float(k)) - 0.5) * 0.05, 0.92 + (k == 1 && count == 3 ? 0.2 : 0.0) + hash11(cell * 3.1 + float(k)) * 0.04);
          vec2 d = vec2(lx, y) - sc;
          if (length(d * vec2(1.0, 0.9)) < 0.1) { o = S(R_BONE, 0.62 + d.y * 2.0); if (length(d - vec2(-0.035, 0.01)) < 0.022 || length(d - vec2(0.035, 0.01)) < 0.022) o = S(R_ABYSS, 0.05); }
        }
        return o;
      }
    }
  }
  // Ivy from the top down (ruins), moss at the foot.
  if (brick) {
    float iv = vnoise(vec2(s * 1.4, 0.0) + float(seed) * 0.02) * 1.6 - (H - y) * 0.55;
    if (iv > 0.25 && vnoise(vec2(s, y) * 6.0) > 0.35) o = S(R_IVY, 0.3 + vnoise(vec2(s, y) * 14.0) * 0.4 + (fract(vnoise(vec2(s, y) * 6.0) * 5.0) < 0.3 ? 0.15 : 0.0));
    if (y < 0.3 && vnoise(vec2(s * 3.0, y * 5.0)) > 0.5) o = S(R_MOSS, 0.3 + vnoise(vec2(s, y) * 17.0) * 0.3);
  }
  // Iron plates on the forge's walls now and then.
  if (style == 2 && hash11(floor(s / 2.0) * 3.7) < 0.15 && y > 0.6 && y < 2.2) {
    float lx = fract(s / 2.0) * 2.0 - 1.0;
    if (abs(lx) < 0.45) { o = S(R_IRON, 0.36 + (y > 2.1 ? 0.2 : 0.0) + vnoise(vec2(s, y) * 11.0) * 0.1); if (abs(abs(lx) - 0.38) < 0.03 && fract(y * 3.0) < 0.2) o = S(R_IRON, 0.7); }
  }
  return o;
}
Surf capOf(vec2 p, int seed, int bits) {
  int style = uStyle.x;
  // (A wall's top: its rim toward the camera -- the edges the scene marked open -- catches the light, a dressed edge.)
  vec2 cell = fract(p / 0.5);
  if (style != 1 && (((bits & 1) != 0 && cell.x < 0.16) || ((bits & 2) != 0 && cell.y < 0.16))) return S(R_TRIM, ((bits & 32) != 0 ? 0.7 : 0.56) + vnoise(p * 21.0) * 0.06);
  if (style == 1) return S(R_CAP, rockShade(p * 1.8, 0.15) + 0.08);
  Stone st = course(p, 0.5, 0.5, 0.0, 17.0);
  float t = 0.4 + (hash12(st.id) - 0.5) * 0.14 + vnoise(p * 15.0) * 0.08;
  if (st.edge < 0.03) t = 0.14;
  Surf o = S(R_CAP, t);
  if (style == 3 && vnoise(p * 2.5 + float(seed) * 0.01) > 0.5) o = S(R_IVY, 0.25 + vnoise(p * 17.0) * 0.35);
  return o;
}
Surf lintel(vec2 f, vec3 pos, int dir) {
  // The door cell's middle along the face, the arch's spring, its ring of voussoirs.
  float mid = (dir == 3 ? floor(pos.x / uTile) : floor(pos.z / uTile)) * uTile + uTile * 0.5;
  float lx = dir == 3 ? pos.x - mid : -(pos.z - mid);
  float y = f.y;
  float R = 0.78, spring = 1.55;
  vec2 d = vec2(lx, max(y - spring, 0.0));
  float r = y < spring ? abs(lx) : length(d);
  if (abs(lx) < R && y < spring + sqrt(max(0.0, R * R - lx * lx))) discard;
  if (r < R + 0.3 && y > spring - 0.1) {
    float a = atan(d.y, lx);
    float seg = floor(a / 3.14159 * 9.0);
    bool joint = abs(fract(a / 3.14159 * 9.0) - 0.5) > 0.44 || abs(r - R - 0.3) < 0.03;
    if (seg == 4.0 && y > spring + R) return S(R_GOLD, 0.55);
    return S(R_TRIM, joint ? 0.14 : 0.52 + (hash11(seg) - 0.5) * 0.12 + (r > R + 0.24 ? 0.1 : 0.0));
  }
  return wallFace(vec2(f.x, y), pos, 0, dir, vSpan.y, true);
}
Surf pillar(vec3 pos, vec2 f, int bits) {
  float facet = float(bits - 8);
  float y = f.y;
  // (Facets lit by their turn toward the light; flutes cut into each.)
  float light = 0.46 + 0.14 * cos(facet * 0.785 - 2.3);
  float flute = abs(fract(f.x * 4.2) - 0.5);
  float t = light + (flute < 0.1 ? -0.14 : 0.0) + vnoise(vec2(f.x * 7.0, y * 9.0)) * 0.08;
  if (abs(y - 0.5) < 0.04 || abs(y - 2.1) < 0.04) t += 0.12;
  return S(R_TRIM, t);
}
Surf trimOf(vec2 f, vec3 n) {
  Stone st = course(f, 0.32, 0.5, 0.2, 23.0);
  float t = 0.44 + (hash12(st.id) - 0.5) * 0.12 + vnoise(f * 15.0) * 0.08 + (n.y > 0.5 ? 0.12 : 0.0);
  return S(R_TRIM, st.edge < 0.02 ? 0.16 : t);
}
Surf doorOf(vec2 f, int seed, int bits, bool locked) {
  float s = f.x, y = f.y, lw = uTile * 0.5 - 0.22;
  if (y > 2.0) discard;
  if (locked) {
    Surf o = S(R_IRON, 0.3 + vnoise(vec2(s, y) * 11.0) * 0.1);
    if (abs(fract(s * 2.0) - 0.5) > 0.46 || abs(fract(y * 2.0) - 0.5) > 0.46) o = S(R_IRON, 0.18);
    if (fract(s * 4.0) < 0.2 && fract(y * 4.0) < 0.2) o = S(R_IRON, 0.7);
    // The seal: a glowing ring and rune where the leaves meet.
    vec2 c = vec2(s - lw, y - 1.15);
    float r = length(c);
    if (abs(r - 0.28) < 0.04 || (r < 0.2 && abs(c.x) < 0.03) || (r < 0.2 && abs(c.y - c.x * 0.5) < 0.03)) o = E(R_GLOW, 0.6 + 0.3 * sin(uTime * 3.0));
    // Chains across.
    if (abs((lw - s) - abs(y - 1.0) * 0.7) < 0.05 && r > 0.33) o = S(R_IRON, fract((s + y) * 6.0) < 0.5 ? 0.62 : 0.4);
    return o;
  }
  float pl = floor(s / 0.19);
  Surf o = S(R_WOOD, 0.42 + (hash11(pl + float(seed)) - 0.5) * 0.14 + (vnoise(vec2(s * 30.0, y * 1.5)) - 0.5) * 0.14);
  if (fract(s / 0.19) < 0.08) o = S(R_WOOD, 0.14);
  if (abs(y - 0.4) < 0.06 || abs(y - 1.6) < 0.06) { o = S(R_IRON, 0.45 + (abs(y - 0.4) < 0.02 || abs(y - 1.6) < 0.02 ? 0.1 : 0.0)); if (fract(s / 0.19) > 0.4 && fract(s / 0.19) < 0.6) o = S(R_IRON, 0.72); }
  if (y > 1.9) o.t += 0.1;
  return o;
}

void main() {
  int mat = vMat.x, seed = vMat.y, bits = vMat.z, kind = vMat.w;
  // Dissolve (the dither cutaway).
  ivec2 fc = ivec2(gl_FragCoord.xy);
  float dth = bayer4(fc) - 0.5;
  if (vCut > 0.0 && bayer4(fc) < vCut * 0.9) discard;
  vec3 n = vN;
  vec3 cam = uPersp > 0.5 ? normalize(vPos - uEye) : uCam;
  if (dot(n, cam) > 0.0) n = -n;
  vec3 pos = vPos;
  vec2 cell = vec2(mod(pos.x, uTile), mod(pos.z, uTile));
  Surf o;
  bool face = kind == ${QUAD.FACE} || kind == ${QUAD.INNER};
  if (mat <= M_CAVE) {
    o = floorOf(pos.xz, mat, bits, seed); if (seed >= 256) o = rug(o, cell, vC, seed / 256 - 1); o = decor(o, pos.xz, cell, bits, seed);
    // (A pool's shallows lap over the floor beside it; lava's crust glows at its edge.)
    float wl = texture(uLiquid, pos.xz * uFogScale).r;
    if (wl > 0.04) { wl += (vnoise(pos.xz * 1.7) - 0.5) * 0.55; if (wl > 0.62) { if (uLava > 0.5) o = E(R_LAVA, 0.3 + (wl - 0.62) * 1.5); else o = S(R_WATER, 0.2 + vnoise(pos.xz * 2.4 + uTime * 0.2) * 0.14); } else if (wl > 0.5) o.t *= 0.72; }
  }
  else if (mat == M_WALL) o = wallFace(vFace, pos, seed, bits & 15, vSpan.y, kind != ${QUAD.FACE} || vSpan.x < -0.01 || (bits & 16) != 0);
  else if (mat == M_CAP) o = capOf(pos.xz, seed, bits);
  else if (mat == M_LINTEL) o = lintel(vFace, pos, bits & 15);
  else if (mat == M_PILLAR) o = pillar(pos, vFace, bits);
  else if (mat == M_TRIM) o = trimOf(face ? vFace : pos.xz, n);
  else if (mat == M_DOOR || mat == M_LOCKED) o = doorOf(vLocal, seed, bits & 15, mat == M_LOCKED);
  else if (mat == M_STAIR) { vec2 q = n.y > 0.5 ? pos.xz : vFace; o = S(R_FLOOR, (n.y > 0.5 ? 0.58 : 0.32) + vnoise(q * 13.0) * 0.1 + (hash11(float(seed)) - 0.5) * 0.08); }
  else if (mat == M_DROP) o = S(R_WALL_ALT, 0.28 + fbm(vFace * vec2(1.2, 2.5)) * 0.3);
  else if (mat == M_OPENING) {
    // The way on up: a dark arch, a lighter rim of dressed stone.
    float u = vLocal.x - (uTile - 0.5) * 0.5, y = vLocal.y;
    float top = 1.0 + sqrt(max(0.0, 0.55 - u * u)) * 0.6;
    if (abs(u) > 0.74 || y > top) discard;
    bool rim = abs(u) > 0.62 || y > top - 0.1;
    outColor = surfaceOut(rim ? palRow(R_TRIM, 3.0) : palRow(R_ABYSS, 0.0) * 0.5);
    return;
  }
  else if (mat == M_BRIDGE) {
    float a = bits == 1 ? pos.x : pos.z, b = bits == 1 ? pos.z : pos.x;
    float pl = floor(a / 0.28);
    if (fract(a / 0.28) < 0.1) discard;
    o = S(R_WOOD, 0.42 + (hash11(pl) - 0.5) * 0.18 + (vnoise(vec2(a * 3.0, b * 20.0)) - 0.5) * 0.12);
    float e = fract(b / uTile) * uTile;
    if (e < 0.18 || e > uTile - 0.18) o = S(R_WOOD, e < 0.18 ? 0.3 : 0.55);
  }
  else if (mat == M_BEAM) o = S(R_WOOD, 0.26 + vnoise(vFace * vec2(20.0, 2.0)) * 0.1);
  else if (mat == M_BEDROCK) {
    // Bedrock: broken rock and rubble, darker the further from the rooms (the contact field).
    float ao2 = texture(uAo, pos.xz * uAoScale).r;
    o = S(R_CAP, 0.2 + rockShade(pos.xz * 1.4, 0.18) * 0.3 + vnoise(pos.xz * 17.0) * 0.04 - (1.0 - ao2) * 0.1);
  }
  else if (mat == M_WATER) {
    // Deep in the middle, shallow at the shore; slow ripples; the lights' glints on it.
    float field = texture(uLiquid, pos.xz * uFogScale).r;
    float rip = vnoise(pos.xz * 2.2 + vec2(uTime * 0.25, uTime * 0.17)) * 0.6 + vnoise(pos.xz * 4.6 - uTime * 0.2) * 0.4;
    o = S(R_WATER, 0.32 - smoothstep(0.6, 1.0, field) * 0.2 + rip * 0.14);
    vec3 Lw = lightAt(pos.xz);
    float glow = max(Lw.r, max(Lw.g, Lw.b)) - max(uAmbient.r, max(uAmbient.g, uAmbient.b));
    if (glow > 0.4 && abs(fract(rip * 3.0 + pos.x * 0.3) - 0.5) < 0.025 * glow) o.t += 0.4;
    // (The shore: where the pool's field thins, wet stones and mud instead of a straight cell edge.)
    float wl = texture(uLiquid, pos.xz * uFogScale).r + (vnoise(pos.xz * 1.7) - 0.5) * 0.55;
    if (wl < 0.6) o = S(wl < 0.52 ? R_DIRT : R_WATER, wl < 0.52 ? 0.18 + vnoise(pos.xz * 13.0) * 0.14 : 0.62);
  } else if (mat == M_LAVA) {
    // Molten rock: a white-hot yellow core under drifting plates of cooling crust, the cracks between them bright.
    vec2 q = pos.xz * 2.4 + vec2(uTime * 0.14, uTime * 0.06);
    vec3 v = vor(q);
    float heat = fbm(pos.xz * 0.8 + vec2(uTime * 0.06, -uTime * 0.035));
    float plate = hash12(v.yz);
    float glow = 0.7 + heat * 0.3 + 0.05 * sin(uTime * 2.3 + plate * 6.283);
    // (Crust: black basalt lit by what's under it, its rim red-hot; the melt orange to yellow, never white.)
    if (plate > 0.56 && v.x > 0.07 + (1.0 - heat) * 0.05) {
      if (v.x < 0.11) o = E(R_LAVA, 0.28);
      else o = Surf(R_WALL, 0.16 + (plate - 0.56) * 0.3 + vnoise(pos.xz * 9.0) * 0.08, 0.0);
    } else o = E(R_LAVA, glow * 0.78 + (v.x < 0.04 ? 0.1 : 0.0));
    // (Its shore: cooled black rock creeping in from the edge, glowing seams in it.)
    float wl = texture(uLiquid, pos.xz * uFogScale).r + (vnoise(pos.xz * 1.7) - 0.5) * 0.3;
    if (wl < 0.44) { float seam = vor(pos.xz * 2.2).x; if (seam < 0.06) o = E(R_LAVA, 0.45); else o = S(R_FLOOR, 0.14 + vnoise(pos.xz * 11.0) * 0.1); }
    else if (wl < 0.52) o = E(R_LAVA, 0.72);
  } else o = S(R_WALL, 0.5);

  // The light: the ground in front of a face (not inside the wall), the ground under anything flat.
  // (The light: the ground in front of a face; for a wall's top and a face the cutaway opened, the ground a metre
  // toward the camera from it -- a wall's top catches the room's light along its rim.)
  vec2 toCam = -normalize(abs(cam.x) + abs(cam.z) > 1e-4 ? cam.xz : uCam.xz + vec2(1e-4));
  vec2 lp = pos.xz + (kind == ${QUAD.INNER} ? toCam * 1.2 : mat == M_CAP ? toCam * 0.9 : (face || (abs(n.y) < 0.5) ? n.xz * 0.35 : vec2(0.0)));
  vec3 L = lightAt(lp);
  // (Contact shade: the floor darkens toward a wall's foot, a wall toward its own.)
  float ao = texture(uAo, lp * uAoScale).r;
  if (n.y > 0.5 && mat != M_CAP && pos.y < 0.1 && pos.y > -0.4) L *= 1.0 - ao * 0.55;
  else if (face && pos.y < 0.7 && pos.y >= 0.0) L *= 1.0 - (0.7 - pos.y) * 0.45;
  // (Faces dim toward their foot and far below the floor; tops of walls see less of the room's light.)
  if (face && pos.y >= 0.0) L *= 0.8 + 0.25 * clamp(pos.y / 2.2, 0.0, 1.0);
  // (A wall's top takes the brighter of the light before it and behind it: a stub's top shows the room's light.)
  if (mat == M_CAP) L = mix(uAmbient, max(L, lightAt(pos.xz - toCam * ((bits & 32) != 0 ? 1.6 : 0.9))), 0.75);
  if (mat == M_CAP && (bits & 32) != 0) L = max(L, uAmbient * 2.6);
  // (A wall's back, toward the bedrock: half the light of the room behind it, so a front stub never reads as void.)
  if (mat == M_WALL && (bits & 16) != 0) L = max(L, lightAt(pos.xz - n.xz * 1.3) * 0.55);
  if (mat == M_BEDROCK) L = mix(uAmbient * 0.8, L, 0.35);
  // (Below the floor the dark closes in -- slowly down a stair, fast down a wall into the abyss.)
  float below = pos.y < -0.35 ? clamp(1.0 + (pos.y + 0.35) / (mat == M_STAIR ? 4.5 : 2.2), 0.0, 1.0) : 1.0;
  float vis = fogAt(lp);
  if (uFogOn > 0.5) vis = floor(vis * 7.0 + bayer4(fc) * 0.99) / 7.0;
  vec3 c = litEntry(o.row, o.t, o.emit, L * (0.2 + 0.8 * below), vis, dth);
  if (below < 1.0) c = mix(uAbyssFog, c, below * below);

  outColor = surfaceOut(c);
}`;

// ---------------------------------------------------------------- the abyss (a full-screen pass, drawn first)

export const ABYSS_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
out vec2 vPx;
uniform vec2 uSize;
void main() { vPx = vec2(aCorner.x, 1.0 - aCorner.y) * uSize; gl_Position = vec4(aCorner * 2.0 - 1.0, 0.9999, 1.0); }`;
export const ABYSS_FS = `#version 300 es
precision highp float;
${ROWS_GLSL}
uniform vec3 uCenter, uRight, uUp, uForward; uniform float uK; uniform vec2 uSize;
uniform float uPersp; uniform vec3 uEye; uniform float uTan;
uniform float uDepth; uniform vec3 uFogC; uniform vec3 uGlow; uniform float uGlowOn; uniform float uMist; uniform float uTime;
uniform sampler2D uPal;
in vec2 vPx;
out vec4 outColor;
${COMMON}
vec3 palRow(int row, float x) { int i = clamp(int(floor(x + 0.5)), 0, ${RAMP_LENGTH - 1}); return texelFetch(uPal, ivec2(i, row), 0).rgb; }
void main() {
  vec2 px = floor(vPx) + 0.5;
  vec3 o, ray;
  if (uPersp > 0.5) {
    // (A ray from the eye through the pixel, down to the rubble; a pixel looking above the horizon sees only fog.)
    vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
    o = uEye;
    ray = normalize(uForward + uRight * ndc.x * uTan * uSize.x / uSize.y + uUp * ndc.y * uTan);
  } else {
    o = uCenter + uRight * ((px.x - uSize.x * 0.5) / uK) + uUp * ((uSize.y * 0.5 - px.y) / uK);
    ray = uForward;
  }
  if (ray.y > -1e-3) { outColor = vec4(uFogC, 1.0); return; }
  float t = (-uDepth - o.y) / ray.y;
  vec3 p = o + ray * t;
  float dth = bayer4(ivec2(gl_FragCoord.xy)) - 0.5;
  // Rubble far down: blocks and boulders, lit by nothing but the mist.
  float n = fbm(p.xz * 0.55);
  float rocks = vnoise(p.xz * 1.6);
  float s = 0.25 + n * 0.5 + (rocks > 0.62 ? 0.25 : 0.0) - (rocks > 0.58 && rocks < 0.62 ? 0.2 : 0.0);
  float mist = fbm(p.xz * 0.12 + vec2(uTime * 0.02, uTime * 0.013)) * uMist;
  vec3 c = palRow(R_ABYSS, s * 2.5 + mist * 3.0 + dth * 0.5);
  if (uGlowOn > 0.5) {
    float river = abs(fbm(p.xz * 0.07 + 3.0) - 0.5);
    float g = smoothstep(0.08, 0.0, river) * (0.6 + 0.4 * sin(uTime * 0.8 + p.x * 0.2));
    c = mix(c, palRow(R_LAVA, 3.0 + g * 5.0 + dth), clamp(g * 1.4, 0.0, 1.0) * 0.8);
  }
  c = mix(uFogC, c, 0.7 + mist * 0.3);
  outColor = vec4(c, 1.0);
}`;
