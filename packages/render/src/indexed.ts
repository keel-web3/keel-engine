// The renderer's bake-mode programs: what the baker reads instead of colours.
// (Separate from shaders.ts, whose strings are the proof of concept's
// character for character; nothing here runs unless a bake asks for it, so a
// normal frame's GL calls are the same as ever.)
//
//   BAKE_WORLD_FS  pass 1 as WORLD_FS, plus where on its part each pixel is: a
//                  surface coordinate (u, v) in data2's free .zw -- round and
//                  along a capsule, over a box's face -- so a pattern painted
//                  at draw time sits on the part and moves with it, frame to
//                  frame, instead of sliding across the sprite.
//                  With uSplit on (a point, w = 1), each hit also says whether
//                  it's behind that point, seen from the camera (pass 1's ramp
//                  channel carries it in bake mode: 1 behind, 0 in front) -- a
//                  scarf's back half, a hood's shell behind the head.
//   INDEX_FS       pass 2 for a bake: no palette -- each pixel as RGBA8
//                    r = 128 (covered) + 64 (an outline edge: the same test as
//                        the pixel pass's outline) + 32 (behind the split
//                        point) + the material (0..31)
//                    g = the shade (pass 1's lightness)
//                    b, a = the surface coordinate
//                  and 0 where there's nothing (the sky, the water, particles).
//   DEPTH_FS       the depth buffer packed into RGBA8 (24 bits), for readData().

import { WORLD_FS } from "./shaders.ts";

// (Each edit names the exact text it replaces: if WORLD_FS ever changes under it, building the program throws
// instead of quietly drawing without coordinates -- and test/indexed.test.ts says so first.)
function edit(src: string, find: string, replace: string): string {
  if (!src.includes(find)) throw new Error(`BAKE_WORLD_FS: WORLD_FS no longer contains ${JSON.stringify(find.slice(0, 60))}`);
  return src.replace(find, replace);
}

const SURFACE_UV = `// Where on its part a point is, 0..1 each way: a capsule's (round it, along it -- caps included); a ball's
// (longitude round y, latitude up it); a box's or a wedge's (across the face it's on).
vec2 surfaceUv(vec3 p, int k) {
  if (k >= 100 && k < 200) {
    int i = k - 100;
    vec4 A = uCap[2 * i]; vec4 B = uCap[2 * i + 1];
    vec3 ba = B.xyz - A.xyz;
    vec3 pa = p - A.xyz;
    float L2 = dot(ba, ba);
    if (L2 < 1e-8) { vec3 d = normalize(pa + vec3(0.0, 0.0, 1e-6)); return vec2(atan(d.x, d.z) / 6.2831853 + 0.5, d.y * 0.5 + 0.5); }
    float len = sqrt(L2);
    vec3 ax = ba / len;
    float h = dot(pa, ax);
    vec3 rad = pa - ax * clamp(h, 0.0, len);
    vec3 e1 = normalize(abs(ax.y) < 0.9 ? cross(ax, vec3(0.0, 1.0, 0.0)) : cross(ax, vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(ax, e1);
    return vec2(atan(dot(rad, e2), dot(rad, e1)) / 6.2831853 + 0.5, clamp((h + A.w) / (len + 2.0 * A.w), 0.0, 1.0));
  }
  vec4 A; vec4 B;
  if (k < 100) { A = uBox[2 * k]; B = uBox[2 * k + 1]; } else { A = uWedge[3 * (k - 200)]; B = uWedge[3 * (k - 200) + 1]; }
  vec3 q = p - A.xyz;
  float c = cos(B.w), s = sin(B.w);
  q.xz = mat2(c, s, -s, c) * q.xz;
  vec3 r = q / max(B.xyz, vec3(1e-4));
  vec3 a = abs(r);
  vec2 f = a.x >= a.y && a.x >= a.z ? r.zy : a.y >= a.z ? r.xz : r.xy;
  return clamp(f * 0.5 + 0.5, 0.0, 1.0);
}

void main() {`;

/** Pass 1 for a bake: WORLD_FS, writing the hit's surface coordinate into data2's .zw (and, split, behind-or-not as its ramp). */
export const BAKE_WORLD_FS = [
  ["void main() {", `uniform vec4 uSplit;      // a point (xyz) the hits are split at, seen from the camera; w 1 on, 0 off\n${SURFACE_UV}`],
  ["float L; float ramp; float id; float depth; float mat; float glow = 0.0; float facing = 1.0;", "float L; float ramp; float id; float depth; float mat; float glow = 0.0; float facing = 1.0; vec2 surf = vec2(0.0);"],
  ["glow = clamp(mr.w, 0.0, 1.0); facing = clamp(dot(n, -rd), 0.0, 1.0);", "glow = clamp(mr.w, 0.0, 1.0); facing = clamp(dot(n, -rd), 0.0, 1.0); surf = surfaceUv(p, int(hit.z + 0.5)); ramp = uSplit.w > 0.5 && dot(p - uSplit.xyz, uFwd) > 0.0 ? 1.0 : 0.0;"],
  ["outData2 = vec4(glow, facing, 0.0, 0.0);", "outData2 = vec4(glow, facing, surf);"],
].reduce((src, [find, replace]) => edit(src, find!, replace!), WORLD_FS);

/** Pass 2 for a bake: material, edge, shade and surface coordinate per pixel (see the top of this file). */
export const INDEX_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uData;
uniform sampler2D uData2;
uniform sampler2D uDepth;
uniform float uGap;         // the outline's depth gap (metres / FAR), as the pixel pass's uOutline.z
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uData, 0);
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 d = texelFetch(uData, px, 0);
  int id = int(d.a * 255.0 + 0.5);
  if (id >= 253) { outColor = vec4(0.0); return; }
  vec4 d2 = texelFetch(uData2, px, 0);
  float z = texelFetch(uDepth, px, 0).r;
  bool edge = false;
  for (int k = 0; k < 4; k++) {
    ivec2 o = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1);
    ivec2 q = clamp(px + o, ivec2(0), size - 1);
    float other = texelFetch(uData, q, 0).a;
    float oz = texelFetch(uDepth, q, 0).r;
    if (abs(other - d.a) > 0.5 / 255.0 && oz > z + uGap) edge = true;
  }
  int mat = min(int(d.b * 255.0 + 0.5), 31);
  bool behind = d.g > 0.5 / 255.0;
  outColor = vec4(float(128 + (edge ? 64 : 0) + (behind ? 32 : 0) + mat) / 255.0, d.r, d2.b, d2.a);
}`;

/** The depth buffer, 24 bits over RGB. */
export const DEPTH_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uDepth;
out vec4 outColor;
void main() {
  float z = texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r;
  uint v = uint(clamp(z, 0.0, 1.0) * 16777215.0 + 0.5);
  outColor = vec4(float(v >> 16u) / 255.0, float((v >> 8u) & 255u) / 255.0, float(v & 255u) / 255.0, 1.0);
}`;

/** The most materials INDEX_FS tells apart (0..31; past that, clamped). */
export const INDEX_MAX_MATERIAL = 31;

/** An INDEX_FS pixel, taken apart. */
export interface IndexedPixel {
  readonly covered: boolean;
  readonly edge: boolean;
  /** Behind the split point (renderIndexed's `split`). */
  readonly behind: boolean;
  readonly material: number;
  readonly shade: number;
  readonly u: number;
  readonly v: number;
}
/** Read one INDEX_FS pixel (r, g, b, a bytes). */
export function readIndexedPixel(r: number, g: number, b: number, a: number): IndexedPixel {
  return { covered: (r & 128) !== 0, edge: (r & 64) !== 0, behind: (r & 32) !== 0, material: r & 31, shade: g, u: b, v: a };
}

/** 24-bit depth bytes (DEPTH_FS) -> depth 0..1. */
export const unpackDepth = (r: number, g: number, b: number): number => ((r << 16) | (g << 8) | b) / 16777215;
