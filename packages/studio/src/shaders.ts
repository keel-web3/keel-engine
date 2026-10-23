// The studio renderer's GLSL (WebGL2, GLSL ES 3.00). Lighting is image based: a prefiltered cube of the procedural
// studio (split-sum GGX, Karis' analytic environment BRDF), Schlick Fresnel, specular occlusion from the baked AO,
// and Khronos' PBR Neutral tone map so a shell's colour stays the colour it was given.

import { STUDIO, type Studio, studioGlsl } from "./env.ts";

/** Range of the RGBM encoding the environment cube is stored in (RGBA8: renderable and filterable everywhere). */
export const RGBM_RANGE = 16;

export const ATTR = { position: 0, normal: 1, uv: 2, ao: 3 } as const;

export const MAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aAo;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vObj;
out vec2 vUv;
out float vAo;
out vec3 vObjN;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vObj = aPos;
  vObjN = aNor;
  vNormal = uNormalMat * aNor;
  vUv = aUv;
  vAo = aAo;
  gl_Position = uViewProj * w;
}`;

/** Shared fragment code: tone map, sRGB, the environment, the BRDF, the cotangent frame. */
const COMMON = `
precision highp float;
precision highp sampler2D;
uniform samplerCube uEnv;
uniform float uEnvLod;
uniform float uExposure;
uniform vec3 uEye;
uniform mat4 uProjectedMatrix;
uniform vec3 uProjectedDirection;
uniform vec3 uProjectedColour;
uniform float uProjectedStrength;
uniform sampler2D uProjectedMask;
vec3 projectedLight(vec3 world, vec3 normal) {
  if(uProjectedStrength<=0.0)return vec3(0.0);
  vec4 p=uProjectedMatrix*vec4(world,1.0);
  if(p.w<=0.0)return vec3(0.0);
  vec3 q=p.xyz/p.w;
  if(any(greaterThan(abs(q),vec3(1.0))))return vec3(0.0);
  float mask=texture(uProjectedMask,q.xy*.5+.5).r;
  return uProjectedColour*(uProjectedStrength*mask*max(0.0,dot(normal,normalize(-uProjectedDirection))));
}


vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

// Khronos PBR Neutral: colours below ~0.76 pass through untouched; highlights roll off and desaturate.
vec3 neutral(vec3 color) {
  const float start = 0.76;
  const float desat = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < start) return color;
  const float d = 1.0 - start;
  float newPeak = 1.0 - d * d / (peak + d - start);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 envAt(vec3 d, float lod) { vec4 t = textureLod(uEnv, d, lod); return t.rgb * t.a * ${RGBM_RANGE.toFixed(1)}; }

// Karis' analytic fit of the split-sum environment BRDF.
vec2 envBrdf(float NoV, float r) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 rr = r * c0 + c1;
  float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y;
  return vec2(-1.04, 1.04) * a004 + rr.zw;
}

mat3 cotangent(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
  return mat3(T * invmax, B * invmax, N);
}

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}

// Image-based light for a surface: diffuse from the most blurred level, specular from the level its roughness picks.
vec3 shade(vec3 base, float metal, float rough, vec3 N, vec3 V, float ao, out vec3 specOut) {
  float NoV = clamp(abs(dot(N, V)), 1e-4, 1.0);
  vec3 R = reflect(-V, N);
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec2 ab = envBrdf(NoV, rough);
  vec3 pre = envAt(R, rough * uEnvLod);
  vec3 irr = envAt(N, uEnvLod);
  float specAo = clamp(pow(NoV + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0);
  specOut = pre * (F0 * ab.x + ab.y) * specAo;
  vec3 kd = (1.0 - metal) * (1.0 - (F0 * ab.x + ab.y));
  return base * kd * irr * ao * 1.15;
}
`;

/** The standard material: metal or dielectric, optional print masks (three inks), a height-baked normal map with its
 *  own occlusion, bead-blast grain, emissive. SPECULAR AA widens roughness where the normal turns within a pixel. */
export const STANDARD_FS = `#version 300 es
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
in vec2 vUv;
in float vAo;
uniform vec3 uBase;
uniform float uMetal;
uniform float uRough;
uniform vec3 uEmissive;
uniform vec2 uGrain;          // scale (per unit), amount
uniform int uUseMasks;
uniform sampler2D uMasks;     // r, g, b: inks 0, 1, 2
uniform vec4 uInk0;           // rgb (linear), roughness
uniform vec4 uInk1;
uniform vec4 uInk2;
uniform vec3 uInkMetal;       // how metallic each ink is (foil)
uniform int uUseNormal;
uniform sampler2D uNormalMap; // rg normal, b occlusion
uniform float uNormalScale;
uniform float uAoMap;         // how much of the map's occlusion applies
uniform float uAoFloor;       // the darkest the baked vertex AO may make a surface
uniform float uOpacity;
uniform int uUseMap;
uniform sampler2D uMap;       // albedo (sRGB) over the base where its alpha is
uniform vec4 uEdge;           // x roughness on the front chamfer (0 off), y lift toward white, z min object z, w spare
in vec3 vObjN;
out vec4 outColor;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vWorld);
  vec3 base = uBase;
  float metal = uMetal, rough = uRough;
  if (uUseMap == 1) { vec4 a = texture(uMap, vUv); base = mix(base, srgbToLinear(a.rgb), a.a); }
  if (uEdge.x > 0.0) {
    // A diamond-cut chamfer: the front edge's facet, polished and a shade brighter than the blasted face.
    float nz = abs(normalize(vObjN).z);
    float e = smoothstep(0.985, 0.94, nz) * smoothstep(0.2, 0.42, nz) * step(uEdge.z, vObj.z);
    rough = mix(rough, uEdge.x, e);
    base = mix(base, mix(base, vec3(1.0), uEdge.y), e);
  }
  float ao = mix(uAoFloor, 1.0, vAo);
  if (uUseNormal == 1) {
    vec4 nm = texture(uNormalMap, vUv);
    vec3 tn = vec3((nm.rg * 2.0 - 1.0) * uNormalScale, 1.0);
    N = normalize(cotangent(N, vWorld, vUv) * normalize(tn));
    ao *= mix(1.0, nm.b, uAoMap);
  }
#ifndef LOW
  if (uGrain.y > 0.0) {
    vec3 q = vObj * uGrain.x;
    float g = vnoise(q) - 0.5, g2 = vnoise(q * 2.7 + 7.1) - 0.5;
    float fade = 1.0 - clamp(length(fwidth(q)) * 0.35, 0.0, 1.0);
    rough = clamp(rough + (g * 0.10 + g2 * 0.05) * uGrain.y, 0.02, 1.0);
    N = normalize(N + vec3(g, g2, vnoise(q.zxy + 3.3) - 0.5) * 0.06 * uGrain.y * fade);
  }
  // Specular anti-aliasing (Kaplanyan/Tokuyoshi): roughness covers the normal's change across the pixel.
  vec3 dn = fwidth(N);
  float variance = 0.25 * dot(dn, dn);
  rough = sqrt(clamp(rough * rough + min(2.0 * variance, 0.18), 0.0, 1.0));
#endif
  if (uUseMasks == 1) {
    vec4 m = texture(uMasks, vUv, -0.6); // (a sharper mip: printed strokes are thin)
    // (Coverage is blended in sRGB, as the print was drawn: blended in linear light, dark ink on a light shell
    // loses its anti-aliased edges and thin strokes vanish under minification.)
    vec3 b = linearToSrgb(base);
    b = mix(b, linearToSrgb(uInk0.rgb), m.r); metal = mix(metal, uInkMetal.r, m.r); rough = mix(rough, uInk0.a, m.r);
    b = mix(b, linearToSrgb(uInk1.rgb), m.g); metal = mix(metal, uInkMetal.g, m.g); rough = mix(rough, uInk1.a, m.g);
    b = mix(b, linearToSrgb(uInk2.rgb), m.b); metal = mix(metal, uInkMetal.b, m.b); rough = mix(rough, uInk2.a, m.b);
    base = srgbToLinear(b);
  }
  vec3 spec;
  vec3 diff = shade(base, metal, max(rough, 0.03), N, V, ao, spec);
  vec3 c = (diff + spec + base * projectedLight(vWorld,N)) * uExposure + uEmissive;
  outColor = vec4(linearToSrgb(neutral(c)), uOpacity);
}`;

/** Cover glass over a screen: black ink printed on its back (with any lettering), a window onto the screen, and the
 *  glass's own reflection over all of it. The screen is sampled pixel-exact (sharp bilinear: nearest inside a texel,
 *  a one-pixel blend across its edge), so at an integer scale it is nearest and at an angle it doesn't shimmer. */
export const GLASS_FS = `#version 300 es
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
in vec2 vUv;
in float vAo;
uniform sampler2D uPrint;     // rgb print colour (sRGB), a coverage (1 = inked)
uniform sampler2D uScreen;
uniform int uHasScreen;
uniform vec4 uScreenRect;     // the screen's u0, v0, u1, v1 in the glass's uv (v down, as images are)
uniform vec2 uScreenTexels;
uniform float uScreenGain;    // the backlight
uniform float uRough;
uniform vec3 uLcdBlack;       // an unlit LCD (linear)
out vec4 outColor;
vec3 screenAt(vec2 uv) {
  vec2 px = uv * uScreenTexels;
  vec2 fw = max(fwidth(px), vec2(1e-4));
  vec2 f = fract(px), i = floor(px);
  vec2 t = clamp((f - 0.5) / fw + 0.5, 0.0, 1.0);
  vec2 s = (i + t) / uScreenTexels;
  return texture(uScreen, s).rgb;
}
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  vec4 pr = texture(uPrint, vUv);
  vec2 su = (vUv - uScreenRect.xy) / (uScreenRect.zw - uScreenRect.xy);
  vec3 under = uLcdBlack;
  if (uHasScreen == 1 && su.x >= 0.0 && su.y >= 0.0 && su.x <= 1.0 && su.y <= 1.0) {
    vec3 s = srgbToLinear(screenAt(su));
    under = s * uScreenGain + uLcdBlack;
  }
  // Ink seen through glass: lit like satin paint.
  vec3 inkBase = srgbToLinear(pr.rgb);
  vec3 inkSpec;
  vec3 ink = shade(inkBase, 0.0, 0.55, N, V, 1.0, inkSpec) * uExposure;
  under = mix(under, ink, pr.a);
  float NoV = clamp(dot(N, V), 1e-4, 1.0);
  vec2 ab = envBrdf(NoV, uRough);
  vec3 R = reflect(-V, N);
  vec3 refl = envAt(R, uRough * uEnvLod) * (0.04 * ab.x + ab.y) * uExposure;
  float F = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
  vec3 c = under * (1.0 - F) + refl;
  outColor = vec4(linearToSrgb(neutral(c)), 1.0);
}`;

/** The emissive part of the screen alone (the bloom's source): same sampling, no glass, no ink. */
export const EMISSIVE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
in float vAo;
uniform sampler2D uPrint;
uniform sampler2D uScreen;
uniform vec4 uScreenRect;
uniform float uScreenGain;
out vec4 outColor;
void main() {
  vec2 su = (vUv - uScreenRect.xy) / (uScreenRect.zw - uScreenRect.xy);
  float inside = step(0.0, su.x) * step(0.0, su.y) * step(su.x, 1.0) * step(su.y, 1.0);
  vec3 s = texture(uScreen, su).rgb;
  float cover = texture(uPrint, vUv).a;
  outColor = vec4(s * s * inside * (1.0 - cover) * uScreenGain, 1.0);
}`;

/** Clear tinted plastic. Behind it: the picture so far (solo: refracted by the surface normal) or, for the grid, a
 *  baked impostor of the parts inside, ray-marched as a height field so it shifts with the view. Its own tint grows
 *  with the path through the wall; Fresnel reflects the studio at grazing angles; printed inks sit on top, opaque. */
export const CLEAR_FS = `#version 300 es
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
in vec2 vUv;
in float vAo;
uniform sampler2D uScene;
uniform vec2 uViewport;
uniform vec3 uTint;           // transmittance through one unit of wall (linear)
uniform float uThickness;
uniform float uRough;
uniform float uRefract;
uniform float uHaze;
uniform int uUseMasks;
uniform sampler2D uMasks;
uniform vec4 uInk0;
uniform vec4 uInk1;
uniform vec4 uInk2;
uniform int uUseNormal;
uniform sampler2D uNormalMap;
uniform float uNormalScale;
uniform int uImpostor;
uniform sampler2D uImpColour; // rgb pre-lit (sRGB), a coverage
uniform sampler2D uImpDepth;  // r: 0 at the near plane .. 1 at the far
uniform vec4 uImpRect;        // object x0, y0, x1, y1
uniform vec2 uImpZ;           // object z near (front), far (back)
uniform vec3 uEyeObj;
uniform vec3 uBehind;         // what the impostor shows where nothing is (sRGB)
uniform mat4 uViewMat;
out vec4 outColor;

vec3 impostor(vec3 p, vec3 d) {
  // March the height field from the surface inward.
  float span = uImpZ.x - uImpZ.y;
  float tEnd = d.z < -1e-3 ? (uImpZ.y - p.z) / d.z : span * 2.0;
  float t0 = d.z < -1e-3 ? max(0.0, (uImpZ.x - p.z) / d.z) : 0.0;
  const int STEPS = 20;
  float dt = max(tEnd - t0, 1e-3) / float(STEPS);
  float t = t0;
  for (int i = 0; i < STEPS; i++) {
    vec3 q = p + d * t;
    vec2 uv = (q.xy - uImpRect.xy) / (uImpRect.zw - uImpRect.xy);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { t += dt; continue; }
    float h = texture(uImpDepth, uv).r;
    float surf = mix(uImpZ.x, uImpZ.y, h);
    if (q.z <= surf + 1e-4) {
      // (One bisection step back toward the crossing.)
      vec3 q2 = p + d * (t - dt * 0.5);
      vec2 uv2 = (q2.xy - uImpRect.xy) / (uImpRect.zw - uImpRect.xy);
      if (q2.z <= mix(uImpZ.x, uImpZ.y, texture(uImpDepth, uv2).r)) uv = uv2;
      vec4 c = texture(uImpColour, uv);
      return mix(uBehind, c.rgb, c.a);
    }
    t += dt;
  }
  return uBehind;
}

void main() {
  vec3 N = normalize(vNormal);
  bool front = gl_FrontFacing;
  if (!front) N = -N;
  vec3 V = normalize(uEye - vWorld);
  if (uUseNormal == 1) {
    vec4 nm = texture(uNormalMap, vUv);
    vec3 tn = vec3((nm.rg * 2.0 - 1.0) * uNormalScale, 1.0);
    N = normalize(cotangent(N, vWorld, vUv) * normalize(tn));
  }
  float NoV = clamp(abs(dot(N, V)), 1e-4, 1.0);
  vec3 behind;
  if (uImpostor == 1) {
    vec3 d = normalize(vObj - uEyeObj);
    behind = srgbToLinear(impostor(vObj, d));
  } else {
    vec3 nv = (uViewMat * vec4(N, 0.0)).xyz;
    vec2 suv = gl_FragCoord.xy / uViewport + nv.xy * uRefract * (1.0 - NoV * 0.6);
    behind = srgbToLinear(texture(uScene, clamp(suv, vec2(0.001), vec2(0.999))).rgb);
  }
  vec3 T = pow(uTint, vec3(uThickness / max(NoV, 0.22)));
  vec2 ab = envBrdf(NoV, uRough);
  vec3 R = reflect(-V, N);
  float F = 0.045 + 0.955 * pow(1.0 - NoV, 5.0);
  vec3 refl = envAt(R, uRough * uEnvLod) * (0.045 * ab.x + ab.y);
  vec3 haze = uTint * envAt(N, uEnvLod) * uHaze;
  vec3 c = behind * T * (1.0 - F) + neutral((refl + haze) * uExposure);
  if (uUseMasks == 1) {
    vec4 m = texture(uMasks, vUv);
    float cover = max(max(m.r, m.g), m.b);
    if (cover > 0.0) {
      vec3 inkBase = uInk0.rgb * m.r + uInk1.rgb * m.g + uInk2.rgb * m.b;
      inkBase /= max(cover, 1e-3);
      vec3 sp;
      vec3 ink = shade(inkBase, 0.0, 0.45, N, V, 1.0, sp);
      c = mix(c, neutral((ink + sp) * uExposure), cover);
    }
  }
  outColor = vec4(linearToSrgb(c), 1.0);
}`;

/** The floor: the background, darkened by the contact shadow. */
export const FLOOR_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec4 uRect;   // x0, z0, x1, z1
uniform float uY;
out vec2 vUv;
void main() {
  vUv = aPos.xy;
  vec3 w = vec3(mix(uRect.x, uRect.z, aPos.x), uY, mix(uRect.y, uRect.w, aPos.y));
  gl_Position = uViewProj * vec4(w, 1.0);
}`;
export const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uShadow;
uniform vec3 uBackground;   // sRGB
uniform float uOpacity;
out vec4 outColor;
void main() {
  float s = texture(uShadow, vUv).r;
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.12, min(e.x, e.y));
  float k = clamp(s * uOpacity * edge, 0.0, 0.95);
  outColor = vec4(uBackground * (1.0 - k), 1.0);
}`;

/** Shadow casters seen from below: darkness falls off with height above the floor (nearest wins: blend MAX). */
export const CASTER_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
in vec2 vUv;
in float vAo;
uniform float uFloorY;
uniform float uFalloff;
out vec4 outColor;
void main() {
  float h = max(vWorld.y - uFloorY, 0.0) / uFalloff;
  float k = 1.0 - clamp(h, 0.0, 1.0);
  outColor = vec4(k * k, 0.0, 0.0, 1.0);
}`;

export const FULLSCREEN_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() { vec2 p = P[gl_VertexID]; vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

/** A separable 9-tap gaussian (linear-sampling offsets). */
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform vec2 uScale;     // the part of the texture this pass covers (a frame uses the targets' corner)
out vec4 outColor;
void main() {
  vec2 uv = vUv * uScale;
  vec4 c = texture(uSrc, uv) * 0.2270270270;
  c += texture(uSrc, uv + uStep * 1.3846153846) * 0.3162162162;
  c += texture(uSrc, uv - uStep * 1.3846153846) * 0.3162162162;
  c += texture(uSrc, uv + uStep * 3.2307692308) * 0.0702702703;
  c += texture(uSrc, uv - uStep * 3.2307692308) * 0.0702702703;
  outColor = c;
}`;

/** The picture, the bloom over it, and a whisper of triangular noise so dark gradients don't band in 8 bits. */
export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform vec2 uScale;     // the scene's part of its (possibly larger) texture
uniform vec2 uBloomScale; // the bloom's part of its texture
out vec4 outColor;
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec2 uv = vUv * uScale;
  vec3 c = texture(uScene, uv).rgb;
  if (uBloomStrength > 0.0) {
    vec3 b = texture(uBloom, vUv * uBloomScale).rgb;
    c = 1.0 - (1.0 - c) * (1.0 - min(b * uBloomStrength, 1.0));
  }
  float n = h12(gl_FragCoord.xy) + h12(gl_FragCoord.xy + 17.17) - 1.0;
  outColor = vec4(c + n / 255.0, 1.0);
}`;

/** A height field (r) to its normal (rg), occlusion (b) and height (a): central differences and an eight-direction
 *  horizon search, so a well round a key shades and a printed line stays flat. */
export const HEIGHT_BAKE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uDepth;     // height 1 in texels (how deep white is)
uniform float uAoRadius;  // texels
uniform float uAoStrength;
out vec4 outColor;
float H(vec2 uv) { return texture(uHeight, uv).r; }
void main() {
  float h = H(vUv);
  float l = H(vUv - vec2(uTexel.x, 0.0)), r = H(vUv + vec2(uTexel.x, 0.0));
  float d = H(vUv - vec2(0.0, uTexel.y)), u = H(vUv + vec2(0.0, uTexel.y));
  vec3 n = normalize(vec3((l - r) * uDepth * 0.5, (d - u) * uDepth * 0.5, 1.0));
  float occ = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.78539816 + 0.3926991;
    vec2 dir = vec2(cos(a), sin(a));
    float best = 0.0;
    for (int s = 1; s <= 6; s++) {
      float dist = uAoRadius * float(s) / 6.0;
      float dh = (H(vUv + dir * dist * uTexel) - h) * uDepth;
      best = max(best, dh / dist);
    }
    occ += best / sqrt(1.0 + best * best);
  }
  float ao = clamp(1.0 - occ / 8.0 * uAoStrength, 0.0, 1.0);
  outColor = vec4(n.xy * 0.5 + 0.5, ao, h);
}`;

/** Depth of occluders along one direction (the AO bake). */
export const DEPTH_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
in vec2 vUv;
in float vAo;
out vec4 outColor;
void main() {
  // (24 bits of depth packed in rgb: an 8-bit channel alone is too coarse to tell a key from the face under it.)
  float z = gl_FragCoord.z * 16777215.0;
  vec3 b = vec3(floor(z / 65536.0), mod(floor(z / 256.0), 256.0), mod(z, 256.0));
  outColor = vec4(b / 255.0, 1.0);
}`;

/** One point per vertex: is it seen from this direction? (Positions and normals fetched by vertex id.) */
export const AO_POINTS_VS = `#version 300 es
uniform highp sampler2D uPositions;
uniform highp sampler2D uNormals;
uniform highp sampler2D uDepthMap;
uniform mat4 uDirViewProj;
uniform vec3 uDir;
uniform int uWidth;
uniform float uBias;
out float vSeen;
out float vFacing;
void main() {
  ivec2 at = ivec2(gl_VertexID % uWidth, gl_VertexID / uWidth);
  vec3 p = texelFetch(uPositions, at, 0).xyz;
  vec3 n = texelFetch(uNormals, at, 0).xyz;
  vFacing = max(dot(n, uDir), 0.0);
  vec4 c = uDirViewProj * vec4(p + n * uBias, 1.0);
  vec3 ndc = c.xyz / c.w;
  vec3 b = texture(uDepthMap, ndc.xy * 0.5 + 0.5).rgb * 255.0;
  float stored = dot(floor(b + 0.5), vec3(65536.0, 256.0, 1.0)) / 16777215.0;
  float mine = ndc.z * 0.5 + 0.5;
  vSeen = mine <= stored + 0.0015 ? 1.0 : 0.0;
  vec2 cell = (vec2(at) + 0.5) / vec2(textureSize(uPositions, 0));
  gl_Position = vec4(cell * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;
export const AO_POINTS_FS = `#version 300 es
precision highp float;
in float vSeen;
in float vFacing;
out vec4 outColor;
void main() { outColor = vec4(vSeen * vFacing, vFacing, 0.0, 1.0); }`;

/** One face of one mip of the prefiltered studio: GGX importance samples of the analytic environment (N = V = R). */
export function prefilterFs(s: Studio = STUDIO, samples = 384): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
uniform int uFace;
uniform float uRough;
out vec4 outColor;
${studioGlsl(s)}
vec3 faceDir(int f, vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;
  if (f == 0) return vec3(1.0, -p.y, -p.x);
  if (f == 1) return vec3(-1.0, -p.y, p.x);
  if (f == 2) return vec3(p.x, 1.0, p.y);
  if (f == 3) return vec3(p.x, -1.0, -p.y);
  if (f == 4) return vec3(p.x, -p.y, 1.0);
  return vec3(-p.x, -p.y, -1.0);
}
vec2 hammersley(uint i, uint n) {
  uint b = i;
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2(float(i) / float(n), float(b) * 2.3283064365386963e-10);
}
void main() {
  vec3 N = normalize(faceDir(uFace, vUv));
  vec3 c;
  if (uRough < 0.01) c = studio(N);
  else {
    vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, N)), B = cross(N, T);
    float a = uRough * uRough;
    vec3 acc = vec3(0.0);
    float w = 0.0;
    const uint COUNT = ${samples}u;
    for (uint i = 0u; i < COUNT; i++) {
      vec2 xi = hammersley(i, COUNT);
      float phi = 6.2831853 * xi.x;
      float ct = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
      float st = sqrt(1.0 - ct * ct);
      vec3 H = T * (st * cos(phi)) + B * (st * sin(phi)) + N * ct;
      vec3 L = 2.0 * dot(N, H) * H - N;
      float NoL = dot(N, L);
      if (NoL > 0.0) { acc += studio(L) * NoL; w += NoL; }
    }
    c = acc / max(w, 1e-4);
  }
  float m = clamp(max(max(c.r, c.g), max(c.b, 1e-6)) / ${RGBM_RANGE.toFixed(1)}, 0.0, 1.0);
  m = ceil(m * 255.0) / 255.0;
  outColor = vec4(c / (m * ${RGBM_RANGE.toFixed(1)}), m);
}`;
}

/** The impostor's depth: 0 at the near plane, 1 at the far (where nothing was drawn it stays cleared at 1). */
export const IMPOSTOR_DEPTH_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
in vec2 vUv;
in float vAo;
out vec4 outColor;
void main() { outColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }`;
