// Volumes: smoke, fire, exhaust and nitro drawn as SHADER volumes -- no sprite,
// no texture. Each puff is a ball marched in the fragment shader through
// animated 3D noise, lit by the sun (and its own heat), then cut to the palette
// through a dither screen: pixel art, the same ramps and screens everything else
// wears. A puff swells, drifts, thins and dies by its `age`; fire and nitro
// carry their own light up their ramp, smoke and dust take the sun's.
//
//   const v = new VolumeInstances(512);
//   v.push(x, y, z, radius, VOLUME_KIND.smoke, seed, age, rampBase, rampLen, 1);
//   sr.drawVolumes(view, v, { time, screen: 4 });
//
// They are depth-tested against what's already drawn (the layers' depth), so a
// car in front of a smoke cloud stays in front of it, and one inside it is
// swallowed pixel by pixel.

/** What a volume is made of: how it swells, drifts and takes its light. */
export const VOLUME_KIND = { smoke: 0, fire: 1, dust: 2, energy: 3, glow: 4 } as const;
export type VolumeKind = (typeof VOLUME_KIND)[keyof typeof VOLUME_KIND];

/** Floats per volume: x, y, z, radius, kind, seed, age (0..1), ramp base, ramp length, light. */
export const VOLUME_FLOATS = 10;

export class VolumeInstances {
  readonly capacity: number;
  readonly data: Float32Array;
  count = 0;
  constructor(capacity: number) { this.capacity = capacity; this.data = new Float32Array(capacity * VOLUME_FLOATS); }
  /** Add one. `age` runs 0 (born) to 1 (gone); `light` scales its lightness. Returns false when full. */
  push(x: number, y: number, z: number, radius: number, kind: number, seed: number, age: number, rampBase: number, rampLen: number, light = 1): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count * VOLUME_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = radius; d[o + 4] = kind; d[o + 5] = seed; d[o + 6] = age; d[o + 7] = rampBase; d[o + 8] = rampLen; d[o + 9] = light;
    this.count += 1;
    return true;
  }
  clear(): void { this.count = 0; }
}

/** How drawVolumes draws. */
export interface VolumeStyle {
  /** Seconds (the noise drifts and fire flickers with it). */
  readonly time?: number;
  /** The dither screen: 0 none, 2, 4 or 8 (default 4). */
  readonly screen?: number;
  /** How thin a puff's edge is cut (0..1, default 0.5): higher leaves more of it. */
  readonly density?: number;
  /** Steps marched through a puff (default 8; 4 is cheap and still reads). */
  readonly steps?: number;
  /** The sun, in the world (default over the viewer's left shoulder, as the meshes take it). */
  readonly sun?: readonly [number, number, number];
  /** Which depth it writes: "ground" (default, the layers') or "view". */
  readonly depth?: "ground" | "view";
  /** Metres it wins a tie by (default 5 mm). */
  readonly tie?: number;
}

export const VOLUME_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPos;     // x, y, z, radius
layout(location=2) in vec4 aKind;    // kind, seed, age, ramp base
layout(location=3) in vec2 aRamp;    // ramp length, light
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK, uDepthRange, uTie;
uniform vec2 uSize;
uniform int uGround;
uniform int uPersp;           // 1: through a perspective projection (project.ts): uCenter is the eye
uniform mat4 uProj;
uniform float uTanH;
out vec2 vOff;                        // metres from the puff's centre, across the picture
flat out vec4 vP;                     // centre (xyz), radius
flat out vec4 vK;                     // kind, seed, age, ramp base
flat out vec2 vR;                     // ramp length, light
void main() {
  // (A puff swells as it ages, so the quad it needs grows with it.)
  float grow = 1.0 + aKind.z * (aKind.x < 0.5 ? 1.1 : 0.35);
  float r = aPos.w * grow;
  vec2 off = (aCorner * 2.0 - 1.0) * r;
  vOff = off;
  vP = vec4(aPos.xyz, r);
  vK = aKind; vR = aRamp;
  vec3 d = aPos.xyz - uCenter;
  float fd = dot(d, uForward);
  if (uPersp == 1) {
    // The puff's centre through the camera, its quad sized by the pixels a metre at ITS distance.
    vec4 c = uProj * vec4(aPos.xyz, 1.0);
    if (fd < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float kd = uSize.y * 0.5 / (fd * uTanH);
    gl_Position = c + vec4(off.x * kd * 2.0 / uSize.x * c.w, off.y * kd * 2.0 / uSize.y * c.w, 0.0, 0.0);
    return;
  }
  vec2 px = (vec2(dot(d, uRight), dot(d, uUp)) + off) * uK;
  gl_Position = vec4(px * 2.0 / uSize, clamp(0.5 + fd / uDepthRange, 0.0, 1.0) * 2.0 - 1.0, 1.0);
}`;

export const VOLUME_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPalette;
uniform vec3 uCenter, uRight, uUp, uForward, uSun;
uniform float uK, uDepthRange, uTie, uTime, uDensity;
uniform vec2 uSize;
uniform int uScreen, uSteps, uGround, uPaletteRow;
in vec2 vOff;
flat in vec4 vP;
flat in vec4 vK;
flat in vec2 vR;
out vec4 outColor;
float bayer(ivec2 p, int n) {
  if (n == 2) { int m[4] = int[4](0, 2, 3, 1); return (float(m[(p.y & 1) * 2 + (p.x & 1)]) + 0.5) / 4.0; }
  int m4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  if (n == 4 || n == 0) return (float(m4[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0;
  ivec2 q = p & 7;
  return (float(m4[(q.y & 3) * 4 + (q.x & 3)] * 4 + (m4[(q.y >> 2) * 4 + (q.x >> 2)] & 3)) + 0.5) / 64.0;
}
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
// (Two octaves is enough at these sizes: a third never reaches a pixel.)
float fbm(vec3 p) { return vnoise(p) * 0.65 + vnoise(p * 2.3) * 0.35; }
vec4 pal(int i) { return texelFetch(uPalette, ivec2(i % uPaletteRow, i / uPaletteRow), 0); }
void main() {
  float r = vP.w;
  float h = length(vOff);
  if (h > r) discard;
  int kind = int(vK.x + 0.5);
  float seed = vK.y, age = clamp(vK.z, 0.0, 1.0);
  // The ball the ray crosses: in at the near face, out at the far one.
  float half0 = sqrt(max(r * r - h * h, 0.0));
  vec3 ro = vP.xyz + uRight * vOff.x + uUp * vOff.y - uForward * half0;
  float step = (2.0 * half0) / float(max(uSteps, 2));
  // Smoke and dust climb and shear as they age; fire and nitro are drawn up and eaten from the top.
  vec3 drift = kind == 1 ? vec3(0.0, -2.6, 0.0) : kind == 3 ? vec3(0.0, -3.4, 0.0) : vec3(0.35, -0.8, 0.2);
  float freq = (kind == 1 || kind == 3) ? 3.4 / max(r, 0.05) : 2.1 / max(r, 0.05);
  float dens = 0.0, lit = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + uForward * (step * (float(i) + 0.5));
    vec3 q = p - vP.xyz;
    float rad = length(q) / r;
    if (rad > 1.0) continue;
    // (Its shape: a ball that thins toward the edge -- fire and nitro narrow toward the top as they burn out.)
    float shape = 1.0 - rad * rad;
    if (kind == 1 || kind == 3) shape *= clamp(1.0 - (q.y / r) * 0.8 - age * 0.5, 0.0, 1.0) * 1.4;
    // (A glow -- a lamp's bloom, a neon halo -- is a smooth ball, brightest at its heart: no billowing.)
    float d = kind == 4 ? shape * 0.8 : max(0.0, (fbm(q * freq + drift * uTime * (0.6 + 0.4 * fract(seed)) + seed * 7.13) - 0.42) * 2.1) * shape;
    dens += d;
    // A puff's own light: the sun on the side it comes from (smoke, dust) or its heat at its heart (fire, nitro).
    lit += d * ((kind == 1 || kind == 3 || kind == 4) ? clamp(1.1 - rad * 1.3, 0.0, 1.0) : clamp(0.45 + 0.55 * dot(normalize(q + 1e-4), uSun), 0.0, 1.0));
  }
  if (dens <= 0.0) discard;
  lit /= dens;
  dens *= step * 5.0;
  // It fades as it goes: thinner and (smoke, dust) dimmer; fire and nitro cool up their ramp instead.
  float fade = 1.0 - age;
  dens *= (kind == 1 || kind == 3 || kind == 4) ? fade * fade : fade;
  float cover = clamp(dens * (0.5 + uDensity), 0.0, 1.5);
  // Pixel art has no alpha: a puff's thin parts take a dithered share of the pixels, the thick parts all of them.
  ivec2 fp = ivec2(gl_FragCoord.xy);
  if (cover < bayer(fp, uScreen == 0 ? 4 : uScreen)) discard;
  int len = max(int(vR.x + 0.5), 1);
  float L = clamp(lit * vR.y * ((kind == 1 || kind == 3 || kind == 4) ? 1.0 : 0.35 + 0.65 * min(1.0, dens)), 0.0, 1.0);
  float x = L * float(len - 1) + (bayer(fp, uScreen == 0 ? 4 : uScreen) - 0.5) * 0.9;
  int idx = clamp(int(floor(x + 0.5)), 0, len - 1);
  outColor = vec4(pal(int(vK.w + 0.5) + idx).rgb, 1.0);
  // Its depth: the point the ray meets it at, in the scene's own convention (a car in front of it stays in front).
  vec3 hit = ro;
  vec3 dv = hit - uCenter;
  float cp = max(uUp.y, 1e-4);
  float gd = uGround == 1 ? cp * (hit.x * uForward.x / cp + hit.z * uForward.z / cp) - dot(uCenter, uForward) : dot(dv, uForward);
  gl_FragDepth = clamp(0.5 + (gd - uTie) / uDepthRange, 0.0, 1.0);
}`;
