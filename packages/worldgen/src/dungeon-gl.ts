// The dungeon on the GPU, in pixel art: a dressed dungeon's scene
// (dungeon-scene.ts) drawn through the engine's pixel view (orthographic,
// pitched, whole-pixel snapped; the sprite renderer's depth convention, so
// keel/particles' particles and keel/bake's sprites share its depth buffer).
//
//   LIGHT      a world-space LIGHT MAP (4 texels a metre) redrawn every frame
//              on the GPU: each light a quad stamped additively from its
//              visibility mask (dungeon-light.ts: walls cast shadows),
//              falloff, colour and FLICKER (a hash of time and its seed --
//              nothing re-baked, nothing sent but the time). The hero's
//              light moves; its mask is re-cut on the CPU as he walks.
//   SURFACES   floors, walls, caps, pillars, lintels, doors, stairs as
//              instanced quads; every texel's pattern (ashlar, rock, basalt
//              with molten seams, broken brick; flagstones, earth, rugs,
//              grates, puddles, moss, cracks, stains, lava) is computed from
//              its world position and turned into a PALETTE entry: its ramp
//              (the act's, crawl-themes.ts), a shade walked down the ramp by
//              the light, a screen-anchored Bayer dither between entries, the
//              light's colour over it. Emissive texels (lava, seams, sigils)
//              ignore the light.
//   CUTAWAY    wall columns between the camera and the hero sink to stubs in
//              the vertex shader (their caps come down with them; the faces
//              between columns open to keep them solid) -- or dissolve
//              ("dither"), or stay ("off").
//   FOG        per cell: in sight, remembered (dimmed), never seen (black),
//              sampled soft and dithered at its edges.
//   SPRITES    indexed sprites (keel/bake's LayerInstances layout, its look
//              tables) lit per texel from the light map. DEPTH SPRITES
//              (keel/bake depth.ts): each texel at the depth of the point it
//              shows, from its baked height -- the floor never hides what
//              stands on it, a wall hides exactly the part of a prop behind
//              it. A sprite baked without heights stands as a card at its
//              anchor, as before.
//   LAYERS     (docs/ARCHITECTURE.md "Occlusion and layers") the abyss; the
//              surfaces (floors at the floor plane, walls and caps as their
//              cutaway state leaves them: stub moves the geometry, dither
//              drops fragments -- depth goes with the colour, never ghost
//              depth); contact shadows and the hero's ring (floor decals:
//              depth-tested, never written, never over a thing); sprites
//              (depth-tested, written); the hero's silhouette where walls
//              hide him (the one overlay drawn through walls); flames (tested,
//              not written). Fog is a colour pass inside each shader, never
//              depth.
//   FLAMES     procedural pixel flames (torch, brazier, candle, magic) and
//              moon shafts, flickering with their lights.
//   ABYSS      the void below: rubble far down, drifting mist, a forge's
//              molten glow, depth-shaded.

import { HEIGHT_STEPS, SPRITE_DEPTH_GLSL, applyLayer } from "@keel-engine/bake";
import { CRAWL_RAMPS, RAMP_LENGTH, crawlPalette } from "./crawl-themes.ts";
import type { CrawlTheme } from "./crawl-themes.ts";
import type { DungeonDressing } from "./dungeon-dress.ts";
import { MASK_PER_METRE, lightMask } from "./dungeon-light.ts";
import { MAT, QUAD, QUAD_FLOATS } from "./dungeon-scene.ts";
import type { DungeonScene } from "./dungeon-scene.ts";

/** The view, as keel/bake's PixelView has it (structurally). */
export interface DungeonDrawView {
  readonly center: readonly [number, number, number];
  readonly pixelsPerMetre: number;
  readonly width: number;
  readonly height: number;
  readonly axes: { readonly right: readonly [number, number, number]; readonly up: readonly [number, number, number]; readonly forward: readonly [number, number, number] };
}
/** keel/bake's look-table layout constants (its SLOTS, LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW). */
export interface LookLayout { readonly slots: number; readonly looksPerRow: number; readonly lookTexels: number; readonly paintsPerRow: number; readonly paletteRow: number }
/**
 * Sprites: keel/bake's LayerInstances floats (x y z, u0 v0 w h, ax ay, page, look, flags, scale, dissolve). Flags: 1
 * unlit (glows), 2 unfogged, 4 cut with the walls (a prop on a wall the cutaway sinks: hung on it, it goes with the
 * wall; with 16 too it stands on the floor against it, and is cut at the stub as the wall is), 8 the hero (inked
 * outline, lifted).
 */
export const LIT_SPRITE_FLOATS = 14;

export interface DungeonDrawOptions {
  readonly time: number;
  /** The hero (world x, z): the cutaway's focus and the light he carries. */
  readonly focus?: readonly [number, number] | null;
  readonly cutaway?: "stub" | "dither" | "off";
  /** Fog of war on (else everything as if in sight). */
  readonly fog?: boolean;
  /** Lights on (else the ambient alone). */
  readonly lights?: boolean;
  /** The hero's light on. */
  readonly heroLight?: boolean;
  /** Door leaves' angles (radians, 0 shut .. pi/2 open), by door. */
  readonly doors?: Float32Array | null;
  readonly sprites?: { readonly data: Float32Array; readonly count: number } | null;
  /** Contact shadows on the floor: x, z, radius (m) each -- under the characters and the big props. */
  readonly shadows?: { readonly data: Float32Array; readonly count: number } | null;
  /** The hero's ring at his feet (world x, z), or none. */
  readonly ring?: readonly [number, number] | null;
  /** A sprite (its index in the sprites) seen through walls as a silhouette where they hide it: the hero. */
  readonly silhouette?: number;
  /** Light scale (1 as the theme says). */
  readonly exposure?: number;
  /** Depth sprites (keel/bake depth.ts): texels at the depth of what they show (default on when the pages carry heights). */
  readonly heights?: boolean;
  /**
   * Checks (tools/occlusion-check): `ids` draws every sprite pixel as its index + 1 (24 bits over RGB; surfaces 0,
   * no abyss, shadows, flames); `surfaceDepth` draws the surfaces alone, each pixel its depth (24 bits over RGB, the
   * clear 0); `depthTest: false` draws the sprites over everything (the no-depth reference).
   */
  readonly debug?: { readonly ids?: boolean; readonly surfaceDepth?: boolean; readonly depthTest?: boolean };
}

export interface DungeonRenderer {
  setScene(scene: DungeonScene, dressing: DungeonDressing): void;
  setTheme(theme: CrawlTheme): void;
  /** Move a light (a prop's flame found after building it); re-cuts its mask. Call before draw; cheap for a few. */
  moveLight(index: number, x: number, y: number, z: number): void;
  /** The atlas pages (keel/bake's), with their height planes for depth sprites. */
  setPages(pages: ReadonlyArray<{ readonly width: number; readonly height: number; readonly rgba: Uint8Array; readonly heights?: Uint8Array | undefined }>): void;
  setLooks(t: { readonly palette: { readonly width: number; readonly height: number; readonly rgba: Uint8Array }; readonly paints: { readonly width: number; readonly height: number; readonly data: Uint32Array }; readonly looks: { readonly width: number; readonly height: number; readonly data: Uint32Array } }): void;
  /** The fog (a byte a cell, 0..255), or null: all in sight. */
  setFog(fog: Uint8Array | null): void;
  /** Where the hero is (world x, z): his light's mask is re-cut when he's moved a quarter metre. */
  setHero(x: number, z: number): void;
  draw(view: DungeonDrawView, opts: DungeonDrawOptions): void;
  readonly stats: { quads: number; lights: number; flames: number; sprites: number; heroMasks: number; lightmap: string; heightBytes: number };
  readonly gl: WebGL2RenderingContext;
}

// ---------------------------------------------------------------- shared GLSL

const ROW = Object.fromEntries(CRAWL_RAMPS.map((n, i) => [n, i])) as Record<(typeof CRAWL_RAMPS)[number], number>;
const ROWS_GLSL = CRAWL_RAMPS.map((n, i) => `#define R_${n.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()} ${i}`).join("\n");
const MATS_GLSL = Object.entries(MAT).map(([k, v]) => `#define M_${k} ${v}`).join("\n");

const COMMON = `
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

const VIEW_UNIFORMS = `uniform vec3 uCenter, uRight, uUp, uForward; uniform float uK; uniform vec2 uSize; uniform float uDepthRange;
vec4 project(vec3 p) {
  vec3 d = p - uCenter;
  vec2 px = vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK);
  float depth = clamp(0.5 + dot(d, uForward) / uDepthRange, 0.0, 1.0);
  return vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, depth * 2.0 - 1.0, 1.0);
}`;

// Lighting + fog + palette, shared by surfaces and sprites.
const SHADE = `
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

const LIGHT_VS = `#version 300 es
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
const LIGHT_FS = `#version 300 es
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

const WORLD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aP;
layout(location=2) in vec3 aU;
layout(location=3) in vec3 aV;
layout(location=4) in vec3 aM;     // material, seed, bits + 256 kind
layout(location=5) in vec4 aC;     // column x z, neighbour column x z
${VIEW_UNIFORMS}
uniform vec2 uFocus; uniform vec2 uHead; uniform vec2 uLat;
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
  // (An ellipse in front of the hero: across the view 6.5 m either side, along it from just behind him to 7 m before.)
  vec2 e = vec2(dot(d, uLat) / 6.5, (dot(d, uHead) + 3.3) / 3.8);
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

const WORLD_FS = `#version 300 es
precision highp float;
precision highp int;
${ROWS_GLSL}
${MATS_GLSL}
uniform float uTime;
uniform ivec4 uStyle;              // wall, floor, corridor, stain row
uniform vec3 uAbyssFog;
uniform vec3 uCam;                 // the camera's direction (forward)
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
  if (dot(n, uCam) > 0.0) n = -n;
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
  vec2 toCam = -normalize(uCam.xz);
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

const ABYSS_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
out vec2 vPx;
uniform vec2 uSize;
void main() { vPx = vec2(aCorner.x, 1.0 - aCorner.y) * uSize; gl_Position = vec4(aCorner * 2.0 - 1.0, 0.9999, 1.0); }`;
const ABYSS_FS = `#version 300 es
precision highp float;
${ROWS_GLSL}
uniform vec3 uCenter, uRight, uUp, uForward; uniform float uK; uniform vec2 uSize;
uniform float uDepth; uniform vec3 uFogC; uniform vec3 uGlow; uniform float uGlowOn; uniform float uMist; uniform float uTime;
uniform sampler2D uPal;
in vec2 vPx;
out vec4 outColor;
${COMMON}
vec3 palRow(int row, float x) { int i = clamp(int(floor(x + 0.5)), 0, ${RAMP_LENGTH - 1}); return texelFetch(uPal, ivec2(i, row), 0).rgb; }
void main() {
  vec2 px = floor(vPx) + 0.5;
  vec3 o = uCenter + uRight * ((px.x - uSize.x * 0.5) / uK) + uUp * ((uSize.y * 0.5 - px.y) / uK);
  float t = (-uDepth - o.y) / uForward.y;
  vec3 p = o + uForward * t;
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

// ---------------------------------------------------------------- lit sprites

function spriteShaders(L: LookLayout): { vs: string; fs: string } {
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
uniform vec2 uFocus; uniform vec2 uHead; uniform vec2 uLat; uniform float uCutMode; uniform float uStub;
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
    vec2 e = vec2(dot(d, uLat) / 6.5, (dot(d, uHead) + 3.3) / 3.8);
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

const FLAME_VS = `#version 300 es
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
  vec2 anchor = floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  vec2 sz = floor(m * vec2(uK, uK * (shaft ? uUp.y : 1.0)) + 0.5);
  sz = max(sz, vec2(3.0, 4.0));
  vec2 px = anchor + vec2((aCorner.x - 0.5) * sz.x, -aCorner.y * sz.y + (shaft ? 0.0 : sz.y * 0.18));
  px = floor(px + 0.5);
  float depth = clamp(0.5 + (dot(d, uForward) - 0.35) / uDepthRange, 0.0, 1.0);
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, depth * 2.0 - 1.0, 1.0);
  vUv = vec2(aCorner.x, aCorner.y) * sz;
  vB = aB; vSize = sz.y; vFogXZ = aA.xz;
}`;
const FLAME_FS = `#version 300 es
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

const SHADOW_VS = `#version 300 es
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
const SHADOW_FS = `#version 300 es
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

// ---------------------------------------------------------------- the renderer

const LIGHT_FLOATS = 20;
const FLAME_FLOATS = 8;
const LIGHTMAP_PER_METRE = 4;

export function createDungeonRenderer(gl: WebGL2RenderingContext, { looks, capacity = 1 << 14 }: { readonly looks: LookLayout; readonly capacity?: number }): DungeonRenderer {
  const compile = (type: number, src: string, what: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Dungeon ${what} shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const link = (vs: string, fs: string, what: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, what));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, what));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Dungeon ${what} program: ${gl.getProgramInfoLog(p)}`);
    const cache = new Map<string, WebGLUniformLocation | null>();
    const u = (name: string) => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name)); return cache.get(name)!; };
    return { p, u };
  };
  const sp = spriteShaders(looks);
  const P = { light: link(LIGHT_VS, LIGHT_FS, "light"), world: link(WORLD_VS, WORLD_FS, "surface"), abyss: link(ABYSS_VS, ABYSS_FS, "abyss"), sprite: link(sp.vs, sp.fs, "sprite"), flame: link(FLAME_VS, FLAME_FS, "flame"), shadow: link(SHADOW_VS, SHADOW_FS, "shadow") };

  const corners = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vaoFor = (buf: WebGLBuffer, stride: number, attribs: ReadonlyArray<readonly [number, number, number]>) => {
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [loc, size, off] of attribs) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    return v;
  };
  const QA = [[1, 3, 0], [2, 3, 3], [3, 3, 6], [4, 3, 9], [5, 4, 12]] as const;
  const quadBuf = gl.createBuffer()!, doorBuf = gl.createBuffer()!, lightBuf = gl.createBuffer()!, spriteBuf = gl.createBuffer()!, flameBuf = gl.createBuffer()!, shadowBuf = gl.createBuffer()!, silBuf = gl.createBuffer()!;
  const quadVao = vaoFor(quadBuf, QUAD_FLOATS, QA), doorVao = vaoFor(doorBuf, QUAD_FLOATS, QA);
  const lightVao = vaoFor(lightBuf, LIGHT_FLOATS, [[1, 4, 0], [2, 4, 4], [3, 4, 8], [4, 4, 12], [5, 2, 16]]);
  const spriteVao = vaoFor(spriteBuf, LIT_SPRITE_FLOATS, [[1, 3, 0], [2, 4, 3], [3, 2, 7], [4, 4, 9], [5, 1, 13]]);
  const flameVao = vaoFor(flameBuf, FLAME_FLOATS, [[1, 4, 0], [2, 4, 4]]);
  const shadowVao = vaoFor(shadowBuf, 3, [[1, 3, 0]]);
  const silVao = vaoFor(silBuf, LIT_SPRITE_FLOATS, [[1, 3, 0], [2, 4, 3], [3, 2, 7], [4, 4, 9], [5, 1, 13]]);
  gl.bindBuffer(gl.ARRAY_BUFFER, silBuf);
  gl.bufferData(gl.ARRAY_BUFFER, LIT_SPRITE_FLOATS * 4, gl.DYNAMIC_DRAW);
  const abyssVao = gl.createVertexArray()!;
  gl.bindVertexArray(abyssVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let spriteCap = 0;

  const tex2d = (filter: number) => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const palTex = tex2d(gl.NEAREST), fogTex = tex2d(gl.LINEAR), maskTex = tex2d(gl.LINEAR), lightTex = tex2d(gl.LINEAR), decorTex = tex2d(gl.LINEAR), aoTex = tex2d(gl.LINEAR), liquidTex = tex2d(gl.LINEAR);
  let lookPal: WebGLTexture | null = null, looksTex: WebGLTexture | null = null, paintsTex: WebGLTexture | null = null, pages: WebGLTexture | null = null, heights: WebGLTexture | null = null;
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  const lightFbo = gl.createFramebuffer()!;
  let lightW = 0, lightH = 0;

  // Scene state.
  let scene: DungeonScene | null = null, dress: DungeonDressing | null = null, theme: CrawlTheme | null = null;
  let quadCount = 0;
  let lightData = new Float32Array(0), lightCount = 0, heroSlot = -1;
  const MASK_ATLAS = 2048;
  let shelfX = 0, shelfY = 0, shelfH = 0;
  let heroMaskAt: [number, number] = [0, 0], heroMaskSize = 0, heroLast: [number, number] = [-1e9, -1e9], heroMasks = 0;
  let flameData = new Float32Array(0), flameCount = 0;
  let fogOn = false;
  const doorData = new Float32Array(QUAD_FLOATS * 64 * 4);

  const allocMask = (size: number): [number, number] => {
    if (shelfX + size > MASK_ATLAS) { shelfX = 0; shelfY += shelfH + 1; shelfH = 0; }
    if (shelfY + size > MASK_ATLAS) throw new RangeError("Light masks overflow their atlas.");
    const at: [number, number] = [shelfX, shelfY];
    shelfX += size + 1; shelfH = Math.max(shelfH, size);
    return at;
  };
  const writeMask = (at: readonly [number, number], size: number, data: Uint8Array) => {
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, at[0], at[1], size, size, gl.RED, gl.UNSIGNED_BYTE, data.subarray(0, size * size));
  };
  const setLight = (i: number, L: { x: number; y: number; z: number; radius: number; colour: readonly [number, number, number]; strength: number; flicker: number; speed: number; seed: number }, kind: number, at: readonly [number, number], mask: { size: number; x0: number; z0: number }, on = 1) => {
    const o = i * LIGHT_FLOATS;
    lightData.set([L.x, L.y, L.z, L.radius, L.colour[0], L.colour[1], L.colour[2], L.strength, L.flicker, L.speed, L.seed, kind, mask.x0, mask.z0, at[0], at[1], mask.size, on, 0, 0], o);
  };
  const KINDS = ["torch", "sconce", "brazier", "candle", "crystal", "fungus", "lava", "shaft", "hero", "key", "sigil"];

  const api: DungeonRenderer = {
    gl,
    stats: { quads: 0, lights: 0, flames: 0, sprites: 0, heroMasks: 0, lightmap: "", heightBytes: 0 },
    setTheme(t) {
      theme = t;
      const pal = crawlPalette(t);
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pal.width, pal.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pal.rgba);
    },
    setScene(s, S) {
      scene = s; dress = S;
      api.setTheme(S.theme);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.quads, gl.STATIC_DRAW);
      quadCount = s.count;
      // The light map covers the dungeon.
      lightW = Math.ceil(s.w * s.tile * LIGHTMAP_PER_METRE); lightH = Math.ceil(s.d * s.tile * LIGHTMAP_PER_METRE);
      gl.bindTexture(gl.TEXTURE_2D, lightTex);
      if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, lightW, lightH, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lightW, lightH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      api.stats.lightmap = `${lightW}x${lightH} ${floatOk ? "RGBA16F" : "RGBA8"}`;
      // Masks: every light's, then the hero's slot.
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK_ATLAS, MASK_ATLAS, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      shelfX = 0; shelfY = 0; shelfH = 0;
      lightCount = S.lights.length + 1;
      lightData = new Float32Array(lightCount * LIGHT_FLOATS);
      S.lights.forEach((L, i) => {
        const m = lightMask(s, L.x, L.z, L.radius);
        const at = allocMask(m.size);
        writeMask(at, m.size, m.data);
        setLight(i, L, KINDS.indexOf(L.kind), at, m);
      });
      heroSlot = S.lights.length;
      const hr = S.theme.lights.hero.radius;
      heroMaskSize = Math.ceil(hr * 2 * MASK_PER_METRE) + 2;
      heroMaskAt = allocMask(heroMaskSize);
      heroLast = [-1e9, -1e9];
      setLight(heroSlot, { x: 0, y: 1.6, z: 0, ...S.theme.lights.hero, seed: 0.5 }, KINDS.indexOf("hero"), heroMaskAt, { size: heroMaskSize, x0: 0, z0: 0 }, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
      gl.bufferData(gl.ARRAY_BUFFER, lightData, gl.DYNAMIC_DRAW);
      // Flames and shafts.
      // (A moon shaft shows where its light comes from: a faint beam down through the broken roof.)
      const shafts = S.lights.filter((L) => L.kind === "shaft");
      flameCount = s.flames.length + shafts.length;
      flameData = new Float32Array(Math.max(1, flameCount) * FLAME_FLOATS);
      s.flames.forEach((f, i) => { const L = S.lights[f.light]!; flameData.set([f.x, f.y, f.z, f.size, f.kind, f.seed, L.flicker, L.speed], i * FLAME_FLOATS); });
      shafts.forEach((L, i) => flameData.set([L.x, 0, L.z, 1, 4, L.seed, 0, 0], (s.flames.length + i) * FLAME_FLOATS));
      gl.bindBuffer(gl.ARRAY_BUFFER, flameBuf);
      gl.bufferData(gl.ARRAY_BUFFER, flameData, gl.DYNAMIC_DRAW);
      // Decor masks per cell (blended by the sampler), contact shade per half metre.
      {
        const N = s.w * s.d, dec = new Uint8Array(N * 4);
        for (let q = 0; q < N; q += 1) { const b2 = S.decor[q]!; dec[q * 4] = b2 & 2 ? 255 : 0; dec[q * 4 + 1] = b2 & 4 ? 255 : 0; dec[q * 4 + 2] = b2 & 16 ? 255 : 0; dec[q * 4 + 3] = b2 & 32 ? 255 : 0; }
        gl.bindTexture(gl.TEXTURE_2D, decorTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, s.w, s.d, 0, gl.RGBA, gl.UNSIGNED_BYTE, dec);
        const liq = new Uint8Array(N);
        for (let q = 0; q < N; q += 1) liq[q] = S.floor[q] === 3 || S.floor[q] === 4 ? 255 : 0;
        gl.bindTexture(gl.TEXTURE_2D, liquidTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.w, s.d, 0, gl.RED, gl.UNSIGNED_BYTE, liq);
        const ao = new Uint8Array(s.fw * s.fd);
        for (let fz = 0; fz < s.fd; fz += 1) for (let fx = 0; fx < s.fw; fx += 1) {
          let n2 = 0, t = 0;
          for (let dz = -2; dz <= 2; dz += 1) for (let dx = -2; dx <= 2; dx += 1) { const x = fx + dx, z = fz + dz; const wgt = 3 - Math.max(Math.abs(dx), Math.abs(dz)); t += wgt; if (x < 0 || z < 0 || x >= s.fw || z >= s.fd || s.fine[z * s.fw + x] === 2 || s.fine[z * s.fw + x] === 5) n2 += wgt; }
          ao[fz * s.fw + fx] = Math.min(255, Math.round((n2 / t) * 2 * 255));
        }
        gl.bindTexture(gl.TEXTURE_2D, aoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.fw, s.fd, 0, gl.RED, gl.UNSIGNED_BYTE, ao);
      }
      // Fog: all in sight until told otherwise.
      gl.bindTexture(gl.TEXTURE_2D, fogTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.w, s.d, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(s.w * s.d).fill(255));
      fogOn = false;
      api.stats.quads = quadCount; api.stats.lights = S.lights.length; api.stats.flames = flameCount;
    },
    moveLight(index, x, y, z) {
      if (!scene || !dress) return;
      const L = dress.lights[index];
      if (!L) return;
      L.x = x; L.y = y; L.z = z;
      const o = index * LIGHT_FLOATS;
      const m = lightMask(scene, x, z, L.radius);
      const at: [number, number] = [lightData[o + 14]!, lightData[o + 15]!];
      if (m.size > lightData[o + 16]!) return; // (a bigger mask than its slot: keep the old one)
      writeMask(at, m.size, m.data);
      lightData[o] = x; lightData[o + 1] = y; lightData[o + 2] = z; lightData[o + 12] = m.x0; lightData[o + 13] = m.z0; lightData[o + 16] = m.size;
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, lightData, o, LIGHT_FLOATS);
      // (Its flame too.)
      for (let f = 0; f < (scene.flames.length); f += 1) if (scene.flames[f]!.light === index) { flameData[f * FLAME_FLOATS] = x; flameData[f * FLAME_FLOATS + 1] = y; flameData[f * FLAME_FLOATS + 2] = z; gl.bindBuffer(gl.ARRAY_BUFFER, flameBuf); gl.bufferSubData(gl.ARRAY_BUFFER, f * FLAME_FLOATS * 4, flameData, f * FLAME_FLOATS, FLAME_FLOATS); }
    },
    setPages(list) {
      if (!list.length) return;
      const w = Math.max(...list.map((p) => p.width)), h = Math.max(...list.map((p) => p.height));
      if (pages) gl.deleteTexture(pages);
      pages = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, pages);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, list.length);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      list.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.rgba));
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      // (Depth sprites: the height planes, an RG8 array beside the pages.)
      if (heights) { gl.deleteTexture(heights); heights = null; }
      api.stats.heightBytes = 0;
      if (list.some((p) => p.heights)) {
        heights = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, heights);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, w, h, list.length);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        list.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RG, gl.UNSIGNED_BYTE, p.heights ?? new Uint8Array(p.width * p.height * 2)));
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        api.stats.heightBytes = w * h * list.length * 2;
      }
    },
    setLooks({ palette, paints, looks: lk }) {
      const up = (old: WebGLTexture | null, t: { width: number; height: number; data: Uint32Array }) => { if (old) gl.deleteTexture(old); const x = tex2d(gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, t.width, t.height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, t.data); return x; };
      if (lookPal) gl.deleteTexture(lookPal);
      lookPal = tex2d(gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, palette.width, palette.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette.rgba);
      looksTex = up(looksTex, lk); paintsTex = up(paintsTex, paints);
    },
    setFog(fog) {
      if (!scene) return;
      fogOn = !!fog;
      if (!fog) return;
      gl.bindTexture(gl.TEXTURE_2D, fogTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, scene.w, scene.d, gl.RED, gl.UNSIGNED_BYTE, fog);
    },
    setHero(x, z) {
      if (!scene || heroSlot < 0) return;
      const o = heroSlot * LIGHT_FLOATS;
      lightData[o] = x; lightData[o + 2] = z; lightData[o + 17] = 1;
      if (Math.hypot(x - heroLast[0], z - heroLast[1]) >= 0.25) {
        const m = lightMask(scene, x, z, lightData[o + 3]!);
        writeMask(heroMaskAt, m.size, m.data);
        lightData[o + 12] = m.x0; lightData[o + 13] = m.z0; lightData[o + 16] = m.size;
        heroLast = [x, z]; heroMasks += 1; api.stats.heroMasks = heroMasks;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, lightData, o, LIGHT_FLOATS);
    },
    draw(view, opts) {
      if (!scene || !dress || !theme) return;
      const s = scene, th = theme;
      const { time } = opts;
      const surfaceDepth = !!opts.debug?.surfaceDepth;
      const ids = !!opts.debug?.ids || surfaceDepth;
      const W = view.width, H = view.height, k = view.pixelsPerMetre;
      const ax = view.axes;
      const range = (Math.max(W, H) / k) * 4;
      const tile = s.tile;
      // (The hero's light: on or off.)
      if (heroSlot >= 0) { const on = opts.heroLight !== false && opts.focus ? 1 : 0; const o = heroSlot * LIGHT_FLOATS + 17; if (lightData[o] !== on) { lightData[o] = on; gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf); gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, lightData, o, 1); } }
      // 1. The light map.
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFbo);
      gl.viewport(0, 0, lightW, lightH);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (opts.lights !== false) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(P.light.p);
        gl.uniform4f(P.light.u("uMap"), 0, 0, lightW / LIGHTMAP_PER_METRE, lightH / LIGHTMAP_PER_METRE);
        gl.uniform2f(P.light.u("uMaskInv"), 1 / MASK_ATLAS, 1 / MASK_ATLAS);
        gl.uniform1f(P.light.u("uTime"), time);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(P.light.u("uMasks"), 0);
        gl.bindVertexArray(lightVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lightCount);
        gl.disable(gl.BLEND);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // 2. The picture: the abyss, then everything depth-tested.
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      if (ids) gl.clearColor(0, 0, 0, 1); else gl.clearColor(th.abyss.fog[0], th.abyss.fog[1], th.abyss.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const view3 = (u: (n: string) => WebGLUniformLocation | null) => {
        gl.uniform3f(u("uCenter"), view.center[0], view.center[1], view.center[2]);
        gl.uniform3f(u("uRight"), ax.right[0], ax.right[1], ax.right[2]);
        gl.uniform3f(u("uUp"), ax.up[0], ax.up[1], ax.up[2]);
        gl.uniform3f(u("uForward"), ax.forward[0], ax.forward[1], ax.forward[2]);
        gl.uniform1f(u("uK"), k);
        gl.uniform2f(u("uSize"), W, H);
        gl.uniform1f(u("uDepthRange"), range);
      };
      const shadeUniforms = (u: (n: string) => WebGLUniformLocation | null) => {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u("uPal"), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lightTex); gl.uniform1i(u("uLight"), 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, fogTex); gl.uniform1i(u("uFog"), 2);
        gl.uniform4f(u("uLightRect"), 0, 0, LIGHTMAP_PER_METRE / lightW, LIGHTMAP_PER_METRE / lightH);
        gl.uniform1f(u("uLightScale"), (opts.exposure ?? 1) * (floatOk ? 1 : 2));
        gl.uniform2f(u("uFogScale"), 1 / (s.w * tile), 1 / (s.d * tile));
        gl.uniform1f(u("uFogOn"), opts.fog !== false && fogOn ? 1 : 0);
        gl.uniform3f(u("uAmbient"), th.ambient[0], th.ambient[1], th.ambient[2]);
        gl.uniform1f(u("uRemembered"), th.remembered);
        gl.uniform1f(u("uLightsOn"), opts.lights !== false ? 1 : 0);
        gl.uniform1f(u("uTime"), time);
      };
      // The abyss.
      gl.depthMask(false);
      gl.useProgram(P.abyss.p);
      if (!ids) {
        const u = P.abyss.u;
        view3(u);
        gl.uniform1f(u("uDepth"), s.abyss);
        gl.uniform3f(u("uFogC"), th.abyss.fog[0], th.abyss.fog[1], th.abyss.fog[2]);
        gl.uniform3f(u("uGlow"), ...(th.abyss.glow ?? [0, 0, 0]) as [number, number, number]);
        gl.uniform1f(u("uGlowOn"), th.abyss.glow ? 1 : 0);
        gl.uniform1f(u("uMist"), th.abyss.mist);
        gl.uniform1f(u("uTime"), time);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u("uPal"), 0);
        gl.bindVertexArray(abyssVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      applyLayer(gl, "ground"); // (floors, then the walls and doors: "objects", the same rule)
      // Surfaces.
      const focus = opts.focus ?? null;
      const cutMode = !focus || opts.cutaway === "off" ? 0 : opts.cutaway === "dither" ? 2 : 1;
      gl.useProgram(P.world.p);
      {
        const u = P.world.u;
        view3(u);
        shadeUniforms(u);
        const hx = ax.forward[0], hz = ax.forward[2], hl = Math.hypot(hx, hz) || 1;
        gl.uniform2f(u("uFocus"), focus ? focus[0] : 0, focus ? focus[1] : 0);
        gl.uniform2f(u("uHead"), hx / hl, hz / hl);
        gl.uniform2f(u("uLat"), ax.right[0], ax.right[2]);
        gl.uniform1f(u("uCutMode"), cutMode);
        gl.uniform1f(u("uStub"), 0.7);
        gl.uniform1f(u("uFront"), cutMode === 1 ? 1 : 0);
        gl.uniform4i(u("uStyle"), th.wall.style, th.floor.style, th.floor.corridor, th.id === "cave" ? ROW.moss : th.id === "forge" ? ROW.lava : ROW.rug);
        gl.uniform3f(u("uAbyssFog"), th.abyss.fog[0], th.abyss.fog[1], th.abyss.fog[2]);
        gl.uniform3f(u("uCam"), ax.forward[0], ax.forward[1], ax.forward[2]);
        gl.uniform4f(u("uDoorGlow"), 0, 0, 0, th.decor.niches);
        gl.uniform1f(u("uTile"), tile);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, decorTex); gl.uniform1i(u("uDecor"), 3);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, liquidTex); gl.uniform1i(u("uLiquid"), 5);
        gl.uniform1f(u("uLava"), th.liquid === "lava" ? 1 : 0);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, aoTex); gl.uniform1i(u("uAo"), 4);
        gl.uniform2f(u("uAoScale"), 1 / (s.w * tile), 1 / (s.d * tile));
        gl.uniform1f(u("uIds"), surfaceDepth ? 2 : ids ? 1 : 0);
        gl.bindVertexArray(quadVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, quadCount);
        // Doors: their leaves, turned by their angles.
        const nd = buildDoors(s, dress, opts.doors ?? null, doorData);
        if (nd) {
          gl.bindBuffer(gl.ARRAY_BUFFER, doorBuf);
          gl.bufferData(gl.ARRAY_BUFFER, doorData.subarray(0, nd * QUAD_FLOATS), gl.DYNAMIC_DRAW);
          gl.bindVertexArray(doorVao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nd);
        }
      }
      // Contact shadows: under the characters and the big props, dithered, multiplied onto the floor.
      const sh = opts.shadows;
      if (sh && sh.count && !ids) {
        gl.useProgram(P.shadow.p);
        view3(P.shadow.u);
        applyLayer(gl, "decals");
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
        gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sh.data.subarray(0, sh.count * 3), gl.DYNAMIC_DRAW);
        gl.uniform1f(P.shadow.u("uRing"), 0);
        gl.bindVertexArray(shadowVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sh.count);
        gl.disable(gl.BLEND);
        // The hero's ring (the first shadow's slot, redrawn).
        if (opts.ring) {
          gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([opts.ring[0], opts.ring[1], 0.62]));
          gl.uniform1f(P.shadow.u("uRing"), 1);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        }
        applyLayer(gl, "objects");
      }
      // Sprites.
      const spr = opts.sprites;
      api.stats.sprites = spr?.count ?? 0;
      if (spr && spr.count && pages && lookPal && looksTex && paintsTex && !surfaceDepth) {
        gl.useProgram(P.sprite.p);
        const u = P.sprite.u;
        view3(u);
        shadeUniforms(u);
        const hx2 = ax.forward[0], hz2 = ax.forward[2], hl2 = Math.hypot(hx2, hz2) || 1;
        gl.uniform2f(u("uFocus"), focus ? focus[0] : 0, focus ? focus[1] : 0);
        gl.uniform2f(u("uHead"), hx2 / hl2, hz2 / hl2);
        gl.uniform2f(u("uLat"), ax.right[0], ax.right[2]);
        gl.uniform1f(u("uCutMode"), cutMode);
        gl.uniform1f(u("uStub"), 0.7);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, pages); gl.uniform1i(u("uPages"), 3);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, lookPal); gl.uniform1i(u("uLookPal"), 4);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, looksTex); gl.uniform1i(u("uLooks"), 5);
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, paintsTex); gl.uniform1i(u("uPaints"), 6);
        const hOn = !!heights && opts.heights !== false;
        gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D_ARRAY, hOn ? heights : null); gl.uniform1i(u("uHeights"), 7);
        gl.uniform1i(u("uHeightOn"), hOn ? 1 : 0);
        gl.uniform1i(u("uIds"), ids ? 1 : 0);
        gl.uniform1i(u("uIdBase"), 0);
        applyLayer(gl, "objects");
        if (opts.debug?.depthTest === false) gl.depthFunc(gl.ALWAYS);
        gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
        if (spr.count > spriteCap) { spriteCap = Math.max(capacity, spr.count); gl.bufferData(gl.ARRAY_BUFFER, spriteCap * LIT_SPRITE_FLOATS * 4, gl.DYNAMIC_DRAW); }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, spr.data, 0, spr.count * LIT_SPRITE_FLOATS);
        gl.uniform4f(u("uSil"), 0, 0, 0, 0);
        gl.bindVertexArray(spriteVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, spr.count);
        applyLayer(gl, "objects");
        // The hero where a wall hides him: a pale silhouette through it.
        const si = opts.silhouette ?? -1;
        if (si >= 0 && si < spr.count && !ids) {
          gl.bindBuffer(gl.ARRAY_BUFFER, silBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, spr.data, si * LIT_SPRITE_FLOATS, LIT_SPRITE_FLOATS);
          gl.uniform4f(u("uSil"), 0.62, 0.72, 0.95, 1);
          applyLayer(gl, "through");
          gl.bindVertexArray(silVao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
          applyLayer(gl, "objects");
          gl.uniform4f(u("uSil"), 0, 0, 0, 0);
        }
      }
      // Flames and shafts (no depth written: a flame never hides what's behind its glow).
      if (flameCount && opts.lights !== false && !ids) {
        applyLayer(gl, "translucent");
        gl.useProgram(P.flame.p);
        const u = P.flame.u;
        view3(u);
        gl.uniform1f(u("uTime"), time);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u("uPal"), 0);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, fogTex); gl.uniform1i(u("uFog"), 2);
        gl.uniform2f(u("uFogScale"), 1 / (s.w * tile), 1 / (s.d * tile));
        gl.uniform1f(u("uFogOn"), opts.fog !== false && fogOn ? 1 : 0);
        gl.uniform1f(u("uRemembered"), th.remembered);
        gl.bindVertexArray(flameVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, flameCount);
        applyLayer(gl, "objects");
      }
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
  };
  return api;
}

/** The door leaves as quads for this frame (double doors hinged at their jambs, swinging away from the camera). */
function buildDoors(s: DungeonScene, S: DungeonDressing, angles: Float32Array | null, out: Float32Array): number {
  let n = 0;
  const cap = Math.floor(out.length / QUAD_FLOATS);
  // (A leaf is a column's face: the cutaway takes it down to a stub with its lintel when it stands between the camera and the hero.)
  let cx = 0, cz = 0, fr = 0;
  const push = (px: number, py: number, pz: number, ux: number, uz: number, h: number, mat: number, seed: number, bits: number) => {
    if (n >= cap) return;
    out.set([px, py, pz, ux, 0, uz, 0, h, 0, mat, seed, bits + fr + 256 * QUAD.FACE, cx, cz, 1e9, 1e9], n * QUAD_FLOATS);
    n += 1;
  };
  s.doors.forEach((dr, i) => {
    const th = angles ? angles[i] ?? 0 : 0;
    const jamb = S.doors[i]!.jambs ? 0.22 : 0.05;
    const lw = (s.tile - jamb * 2) / 2;
    const c = Math.cos(th) * lw, sn = Math.sin(th) * lw;
    const mat = dr.locked ? MAT.LOCKED : MAT.DOOR;
    cx = dr.x0 + s.tile / 2; cz = dr.z0 + s.tile / 2; fr = dr.front ? 32 : 0;
    if (dr.axis === 1) {
      const z = dr.z0 + dr.at;
      push(dr.x0 + jamb, 0, z, c, sn, 2, mat, i, 0);
      push(dr.x0 + s.tile - jamb, 0, z, -c, sn, 2, mat, i, 1);
    } else {
      const x = dr.x0 + dr.at;
      push(x, 0, dr.z0 + jamb, sn, c, 2, mat, i, 0);
      push(x, 0, dr.z0 + s.tile - jamb, sn, -c, 2, mat, i, 1);
    }
  });
  return n;
}
