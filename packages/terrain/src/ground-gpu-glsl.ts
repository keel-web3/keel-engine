// The GPU ground's shaders: the ground baker's pixel model (ground.ts) and the
// surface's (surface.ts), ported line for line to GLSL so a fragment is
// painted exactly as the CPU paints a texel -- the same integer hash, the same
// noise, the same corner blending, precedence, jitter, dithered borders,
// biome gradients, macro tint, variants, decals, contact shade, light layer,
// cliff faces and cycling water -- but at whatever scale the view is at.
//
//   ORTHO     pass 1 rasterises the chunks' faces from the pixel view and
//             writes, per pixel, the ramp and the (unquantised) position on
//             it, the face's kind and tile, and its ray depth; pass 2 does
//             what needs the neighbours -- the outline where the pixel behind
//             is far behind, the lit lip over a cliff face -- then the Bayer
//             screen, the palette index, the palette's cycling, the colour,
//             and the sprite renderer's depth. Palette-true: an index, then
//             its colour.
//   PERSP     one pass into keel/render's pass-1 buffers (its raster hook):
//             the art's pixels are TEXELS on the surface -- the world point
//             snapped to a texel grid in texture space (world x/z on tops,
//             along-the-face and y on walls), coarser by whole powers of two
//             where a texel would be under a pixel -- so the pixel grid holds
//             in 3D; the result goes out as a direct palette index (DIRECT_MAT),
//             and render's pixel pass adds its outline and fog.
//
// Precision: the CPU works in doubles, the GPU in floats; a noise field's
// threshold can land either side for a pixel here and there (measured by the
// parity tool, docs in the README).

import { DECAL_KINDS } from "./surface.ts";

// Decal shapes (surface.ts SHAPES) as a role grid: per kind, per shape, rx -1..2 x ry -1..1 (12 cells).
const SHAPES: ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>> = [
  [[[0, 0, 2], [0, -1, 1], [-1, 0, 2]], [[0, 0, 2], [0, -1, 1], [1, -1, 1], [-1, 0, 2]], [[0, 0, 1], [0, -1, 1], [1, 0, 2]]],
  [[[0, 0, 1], [0, 1, 3]], [[0, 0, 1], [-1, 0, 2], [1, 0, 2], [0, -1, 2], [0, 1, 2]], [[0, 0, 2], [1, -1, 2], [0, 1, 3]]],
  [[[0, 0, 1], [1, 0, 2]], [[0, 0, 1], [0, 1, 2], [1, 1, 2]], [[0, 0, 2]]],
  [[]],
  [[[0, 0, 1]], [[0, 0, 1], [1, 0, 2]], [[0, 0, 2], [-1, 1, 1]]],
  [[[0, 0, 1], [1, 0, 1], [2, -1, 1], [-1, 1, 1]], [[0, 0, 1], [0, -1, 2], [1, 1, 1]]],
];
if (SHAPES.length !== DECAL_KINDS.length) throw new Error("Decal shapes out of step with DECAL_KINDS.");
const shapeGrid = (): string => {
  const cells: number[] = [];
  for (const shapes of SHAPES) for (let s = 0; s < 3; s += 1) {
    const g = new Array<number>(12).fill(0);
    for (const [dx, dy, role] of shapes[s] ?? []) g[(dy + 1) * 4 + dx + 1] = role;
    cells.push(...g);
  }
  return `const int DSHAPE[${cells.length}] = int[${cells.length}](${cells.join(", ")});\nconst int DSHAPES[6] = int[6](${SHAPES.map((s) => s.length).join(", ")});`;
};

export const GPU_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in uvec2 aInfo;
uniform int uPersp;
// ortho: the chunk anchor's picture pixel (x right, y down) and the view's axes x k
uniform vec2 uBase;
uniform vec3 uRk, uUk;
uniform vec2 uPicture;
uniform vec3 uFwd;
uniform float uTdBase;       // (anchor - centre) . forward
// persp: the anchor relative to the eye, the camera
uniform vec3 uRel, uEyeF, uEyeR, uEyeU;
uniform float uTan, uAspect;
out vec3 vLocal;
out float vTd;
flat out vec3 vNorm;
flat out uvec2 vInfo;
void main() {
  vLocal = aPos; vNorm = aNorm; vInfo = aInfo;
  if (uPersp == 0) {
    vec2 px = uBase + vec2(dot(aPos, uRk), -dot(aPos, uUk));
    vTd = uTdBase + dot(aPos, uFwd);
    gl_Position = vec4(px.x / uPicture.x * 2.0 - 1.0, 1.0 - px.y / uPicture.y * 2.0, clamp(vTd / 8192.0, -1.0, 1.0), 1.0);
  } else {
    vec3 e = uRel + aPos;
    float z = dot(e, uEyeF);
    vTd = z;
    const float NEAR = 0.05, FARZ = 210.0;
    gl_Position = vec4(dot(e, uEyeR) / (uTan * uAspect), dot(e, uEyeU) / uTan, z * (FARZ + NEAR) / (FARZ - NEAR) - 2.0 * FARZ * NEAR / (FARZ - NEAR), z);
  }
}`;

/** The shading, shared by both passes' programs (PERSP defined for the perspective one). */
const SHADE = `
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp isampler2D;
uniform usampler2D uTiles;
uniform sampler2D uTable;    // per type: rows 0-2 traits; then per biome two rows of decal densities
uniform isampler2D uRamps;   // per type x biome: base, len, lush base, lush len; then classic, petals, named, extras rows
uniform int uNT, uNB, uRowClassic, uRowPetal, uRowNamed, uRowMat;
uniform int uSurface, uBiomeOn, uLightOn, uDecals, uNVar, uSdG, uSdS;
uniform float uJitter, uPrecedence, uDitherPx, uWarp, uRim, uBJitter, uBDitherPx, uMacroF, uMacroAmt, uLush, uAoS, uAoR, uHShade;
uniform float uTs, uSh;
uniform vec3 uAnchor;        // world metres of the chunk's corner
uniform ivec2 uData0;        // terrain tile at texel (0, 0)
uniform ivec2 uOrigin;       // world tile of the terrain's (0, 0)
uniform ivec2 uSize;         // the terrain's tiles
uniform int uDD;             // rows a block
uniform vec3 uSun;
uniform int uLava;           // lava's type id (-1 none)
${shapeGrid()}

// ---- core's hash and noise (packages/core math.ts), exactly
uint hashU(int x, int y, int s) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u) ^ (uint(s) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}
// (The top 24 bits: exact in a float, never rounded up to 1.)
float hash2(int x, int y, int s) { return float(hashU(x, y, s) >> 8u) * (1.0 / 16777216.0); }
float fade(float t) { return t * t * (3.0 - 2.0 * t); }
float vnoise2(float x, float y, int s) {
  float xf = floor(x), yf = floor(y);
  int xi = int(xf), yi = int(yf);
  float u = fade(x - xf), v = fade(y - yf);
  float a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return mix(mix(a, b, u), mix(c, d, u), v);
}
float fbm2(float x, float y, int s, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 4; o++) {
    if (o >= octaves) break;
    sum += amp * vnoise2(x, y, s + o * 31);
    norm += amp;
    x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; amp *= 0.5;
  }
  return sum / norm;
}
int ifloor(float v) { return int(floor(v)); }
int floorDiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }
uint mulhi(uint a, uint b) {
  uint al = a & 0xffffu, ah = a >> 16u, bl = b & 0xffffu, bh = b >> 16u;
  uint ll = al * bl, lh = al * bh, hl = ah * bl, hh = ah * bh;
  uint mid = (ll >> 16u) + (lh & 0xffffu) + (hl & 0xffffu);
  return hh + (lh >> 16u) + (hl >> 16u) + (mid >> 16u);
}
float bayer4(int gx, int gy) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(gy & 3) * 4 + (gx & 3)]) + 0.5) / 16.0; }
float bayerN(int gx, int gy, int n) {
  if (n == 0) return 0.5;
  if (n == 2) { int m[4] = int[4](0, 2, 3, 1); return (float(m[(gy & 1) * 2 + (gx & 1)]) + 0.5) / 4.0; }
  int m4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  if (n == 4) return (float(m4[(gy & 3) * 4 + (gx & 3)]) + 0.5) / 16.0;
  int a = m4[(gy & 3) * 4 + (gx & 3)], b = m4[((gy >> 2) & 1) * 4 + ((gx >> 2) & 1)];
  return (float(a * 4 + (b & 3)) + 0.5) / 64.0;
}

// ---- the tables
vec4 trait(int ty, int row) { return texelFetch(uTable, ivec2(ty, row), 0); }
float prioOf(int ty) { return trait(ty, 0).x; }
bool crispOf(int ty) { return trait(ty, 1).y > 0.5; }
int wearOf(int ty) { return int(trait(ty, 1).z + 0.5); }
ivec4 rampRow(int x, int row) { return texelFetch(uRamps, ivec2(x, row), 0); }
ivec2 rampTB(int b, int ty, int lushV) { ivec4 r = rampRow(ty, b); return lushV == 1 ? r.zw : r.xy; }
ivec2 named(int n) { return rampRow(n, uRowNamed).xy; }

// ---- tiles (terrain-local i, j)
bool insideT(int i, int j) { return i >= 0 && j >= 0 && i < uSize.x && j < uSize.y; }
uvec4 tA(int i, int j) { return texelFetch(uTiles, ivec2(i - uData0.x, j - uData0.y), 0); }
uvec4 tB(int i, int j) { return texelFetch(uTiles, ivec2(i - uData0.x, j - uData0.y + uDD), 0); }
uvec4 tC(int i, int j) { return texelFetch(uTiles, ivec2(i - uData0.x, j - uData0.y + 2 * uDD), 0); }
int typeOf(uvec4 a) { return int(a.x & 255u); }
int flagsOf(uvec4 a) { return int((a.x >> 8u) & 255u); }
int heightOf(uvec4 a) { return int(a.y & 0xffffu) - 32768; }
int topOfA(uvec4 a) { return int(a.y >> 16u) - 32768; }

// ---- the ground's micro textures (ground.ts texture()), by kind
float texture2(int tex, float x, float z, float y) {
  int sd = uSdG;
  if (tex == 0) { float n = vnoise2(x * 0.9, z * 0.9, sd + 1) - 0.5; float b = hash2(ifloor(x * 6.0), ifloor(z * 6.0), sd + 2); return n * 0.3 + (b > 0.93 ? 0.22 : b < 0.07 ? -0.16 : 0.0); }
  if (tex == 1) { float n = fbm2(x * 0.7, z * 0.7, sd + 3, 2) - 0.5; float b = hash2(ifloor(x * 5.0), ifloor(z * 5.0), sd + 4); return n * 0.35 + (b > 0.95 ? 0.18 : 0.0); }
  if (tex == 2) return sin((x * 0.5 + z * 1.3 + vnoise2(x * 0.4, z * 0.4, sd + 5) * 3.0) * 3.0) * 0.06 + (vnoise2(x * 1.5, z * 1.5, sd + 6) - 0.5) * 0.12;
  if (tex == 3) { float n = fbm2(x * 0.6 + y * 0.4, z * 0.6, sd + 7, 2); float c = abs(vnoise2(x * 1.4, z * 1.4 + y, sd + 8) - 0.5); return (n - 0.5) * 0.45 - (c < 0.03 ? 0.25 : 0.0); }
  if (tex == 4) return (vnoise2(x * 0.5, z * 0.5, sd + 9) - 0.5) * 0.12 + 0.06;
  if (tex == 5) { float cxf = floor(x * 1.2), czf = floor(z * 1.2); float hsh = hash2(int(cxf), int(czf), sd + 10); float fx = x * 1.2 - cxf, fz = z * 1.2 - czf; return (hsh - 0.5) * 0.3 + (fx + fz < 0.25 ? 0.2 : 0.0) + (fx > 0.9 || fz > 0.9 ? -0.2 : 0.0); }
  if (tex == 7) return (fbm2(x * 0.8, z * 0.8, sd + 11, 2) - 0.5) * 0.3 + (hash2(ifloor(x * 4.0), ifloor(z * 4.0), sd + 12) > 0.96 ? 0.25 : 0.0);
  if (tex == 8) return (vnoise2(x * 0.6, z * 0.6, sd + 13) - 0.5) * 0.25 + (vnoise2(x * 2.0, z * 2.0, sd + 14) > 0.8 ? 0.15 : 0.0);
  if (tex == 9) {
    float rzf = floor(z * 2.0); int rz = int(rzf); float off = (rz & 1) != 0 ? 0.25 : 0.0; float rxf = floor(x * 2.0 + off);
    float fx = x * 2.0 + off - rxf, fz = z * 2.0 - rzf;
    bool mortar = fx < 0.12 || fz < 0.14;
    return mortar ? -0.3 : (hash2(int(rxf), rz, sd + 15) - 0.5) * 0.3 + (fx < 0.35 && fz < 0.4 ? 0.1 : 0.0);
  }
  if (tex == 10) return (fbm2(x * 0.8, z * 0.8, sd + 16, 2) - 0.5) * 0.3 + (hash2(ifloor(x * 7.0), ifloor(z * 7.0), sd + 17) > 0.94 ? -0.15 : 0.0);
  if (tex == 11) { float c = abs(vnoise2(x * 0.9, z * 0.9, sd + 18) - 0.5); return 0.08 - (c < 0.02 ? 0.3 : 0.0) + (vnoise2(x * 3.0, z * 3.0, sd + 19) - 0.5) * 0.08; }
  if (tex == 13) {
    float rzf = floor(z * 1.1); int rz = int(rzf); float off = hash2(rz, 0, sd + 50) * 0.8; float rxf = floor(x * 1.1 + off);
    float fx = x * 1.1 + off - rxf, fz = z * 1.1 - rzf;
    if (fx < 0.07 || fz < 0.09) return -0.34;
    return (hash2(int(rxf), rz, sd + 51) - 0.5) * 0.24 + (fx < 0.2 || fz < 0.22 ? 0.08 : 0.0) + (vnoise2(x * 3.0, z * 3.0, sd + 52) - 0.5) * 0.08;
  }
  if (tex == 18) {
    float rzf = floor(z * 3.0 + y * 3.0); int rz = int(rzf); float off = (rz & 1) != 0 ? 0.5 : 0.0; float rxf = floor(x * 1.6 + off);
    float fx = x * 1.6 + off - rxf, fz = z * 3.0 + y * 3.0 - rzf;
    return fx < 0.08 || fz < 0.14 ? -0.3 : (hash2(int(rxf), rz, sd + 53) - 0.5) * 0.2;
  }
  if (tex == 14) { float b = hash2(ifloor(x * 9.0), ifloor(z * 9.0), sd + 54); return (b - 0.5) * 0.36 + (fbm2(x * 0.8, z * 0.8, sd + 55, 2) - 0.5) * 0.18; }
  if (tex == 15) { float n = fbm2(x * 1.3, z * 1.3, sd + 56, 2) - 0.5; float b = hash2(ifloor(x * 7.0), ifloor(z * 7.0), sd + 57); return n * 0.4 + (b > 0.92 ? 0.2 : 0.0); }
  if (tex == 16) return (fbm2(x * 0.5, z * 0.5, sd + 58, 2) - 0.5) * 0.22 + (vnoise2(x * 2.2, z * 2.2, sd + 59) - 0.5) * 0.08;
  if (tex == 17) { float n = fbm2(x * 1.1, z * 1.1, sd + 60, 2) - 0.5; float b = hash2(ifloor(x * 5.0), ifloor(z * 5.0), sd + 61); return n * 0.36 + (b > 0.9 ? 0.18 : b < 0.1 ? -0.18 : 0.0); }
  if (tex == 19) { float v = vnoise2(x * 1.4, z * 1.4, sd + 62); float c = abs(v - 0.5); return (v - 0.5) * 0.3 + (c < 0.04 ? 0.28 : 0.0) + (hash2(ifloor(x * 6.0), ifloor(z * 6.0), sd + 63) > 0.95 ? 0.3 : 0.0); }
  return (vnoise2(x, z, sd + 20) - 0.5) * 0.1;
}

// ---- the surface (surface.ts createSurfaceShader)
int mId[4]; float mW[4];
int latI, latJ; float latX, latZ;
float gMargin; int gRunner;
float edgeNoise(int ty, float X, float Z) {
  vec4 t0 = trait(ty, 0);
  float freq = t0.y; int oct = int(t0.z + 0.5); float blocky = t0.w;
  int s = uSdS + ty * 131;
  if (blocky >= 1.0) { float c = 0.5 * freq; return hash2(ifloor(X * c), ifloor(Z * c), s); }
  float n = oct > 1 ? fbm2(X * freq, Z * freq, s, oct) : vnoise2(X * freq, Z * freq, s);
  if (blocky == 0.0) return n;
  float c = freq;
  return n * (1.0 - blocky) + hash2(ifloor(X * c), ifloor(Z * c), s + 7) * blocky;
}
int cornerMats(float X, float Z, int ti, int tj, uvec4 own0) {
  float wf = 0.2 / uTs * 2.0;
  float fx = X / uTs - float(uOrigin.x) - 0.5 + (uWarp > 0.0 ? (vnoise2(X * wf, Z * wf, uSdS + 3) - 0.5) * 2.0 * uWarp : 0.0);
  float fz = Z / uTs - float(uOrigin.y) - 0.5 + (uWarp > 0.0 ? (vnoise2(X * wf + 17.3, Z * wf, uSdS + 4) - 0.5) * 2.0 * uWarp : 0.0);
  float iaf = floor(fx), jaf = floor(fz);
  int ia = int(iaf), ja = int(jaf);
  float ax = fx - iaf, az = fz - jaf;
  latI = ia; latJ = ja; latX = ax; latZ = az;
  int own = typeOf(own0);
  int hk = heightOf(own0), fk = flagsOf(own0);
  int nm = 0;
  for (int q = 0; q < 4; q++) {
    int ii = ia + (q & 1), jj = ja + (q >> 1);
    float w0 = ((q & 1) != 0 ? ax : 1.0 - ax) * ((q >> 1) != 0 ? az : 1.0 - az);
    int ty = own; float wv = 1.0;
    if (insideT(ii, jj) && !(ii == ti && jj == tj)) {
      uvec4 n = tA(ii, jj);
      if (heightOf(n) == hk && ((flagsOf(n) | fk) & 1) == 0) { ty = typeOf(n); if (crispOf(ty)) { ty = wearOf(ty); wv = 1.7; } }
    }
    float w = w0 * wv;
    int m = 0;
    while (m < nm && mId[m] != ty) m++;
    if (m >= nm) { mId[nm] = ty; mW[nm] = w; nm++; } else mW[m] += w;
  }
  return nm;
}
int chooseMaterial(int own, float X, float Z, int gx, int gy, int nm, float band) {
  gMargin = 1e30; gRunner = -1;
  bool cr = crispOf(own);
  if (cr || nm == 1) return nm == 1 && !cr ? mId[0] : own;
  int top = 0;
  for (int m = 1; m < 4; m++) { if (m >= nm) break; if (prioOf(mId[m]) > prioOf(mId[top])) top = m; }
  int topId = mId[top];
  int b1 = -1, b2 = -1; float s1 = -1e30, s2 = -1e30;
  for (int m = 0; m < 4; m++) {
    if (m >= nm) break;
    int id = mId[m];
    float s = mW[m] + uJitter * trait(id, 1).x * (edgeNoise(id, X, Z) - 0.5) + (id == topId ? uPrecedence : 0.0);
    if (s > s1) { b2 = b1; s2 = s1; b1 = m; s1 = s; } else if (s > s2) { b2 = m; s2 = s; }
  }
  gMargin = s1 - s2; gRunner = b2 >= 0 ? mId[b2] : -1;
  if (band > 0.0 && b2 >= 0 && s1 - s2 < band && bayer4(gx, gy) < 0.5 * (1.0 - (s1 - s2) / band)) { gRunner = mId[b1]; return mId[b2]; }
  return mId[b1];
}
int chooseBiome(float X, float Z, int gx, int gy, float bBand) {
  float fx = X / uTs - float(uOrigin.x), fz = Z / uTs - float(uOrigin.y);
  int ia = clamp(ifloor(fx), 0, uSize.x - 1), ja = clamp(ifloor(fz), 0, uSize.y - 1);
  float ax = fx - float(ia), az = fz - float(ja);
  int bId[4]; float bW[4];
  int nb = 0;
  for (int q = 0; q < 4; q++) {
    uvec4 c = tC(ia + (q & 1), ja + (q >> 1));
    float w = ((q & 1) != 0 ? ax : 1.0 - ax) * ((q >> 1) != 0 ? az : 1.0 - az);
    for (int s0 = 0; s0 < 3; s0++) {
      int id = int((c.x >> uint(8 * s0)) & 255u);
      if (id == 255) break;
      int m = 0;
      while (m < nb && bId[m] != id) m++;
      if (m == nb) { if (nb >= 3) continue; bId[m] = id; bW[m] = 0.0; nb++; }
      bW[m] += w * uintBitsToFloat(s0 == 0 ? c.y : s0 == 1 ? c.z : c.w);
    }
  }
  if (nb == 1) return bId[0];
  float th = bayer4(gx, gy) * (1.0 - uBJitter * 0.5) + uBJitter * 0.5 * fbm2(X * 0.35, Z * 0.35, uSdS + 900, 2);
  float acc = 0.0;
  int best = 0;
  for (int m = 1; m < 4; m++) { if (m >= nb) break; if (bW[m] > bW[best]) best = m; }
  for (int m = 0; m < 4; m++) {
    if (m >= nb) break;
    acc += bW[m];
    if (th < acc) return bW[m] < bBand ? bId[best] : bId[m];
  }
  return bId[best];
}
float lightAt(float X, float Z) {
  if (uLightOn == 0) return 1.0;
  float fx = X / uTs - float(uOrigin.x) - 0.5, fz = Z / uTs - float(uOrigin.y) - 0.5;
  float iaf = floor(fx), jaf = floor(fz);
  int ia = int(iaf), ja = int(jaf);
  float ax = fx - iaf, az = fz - jaf;
  #define LT(i, j) (float(tA(clamp(i, 0, uSize.x - 1), clamp(j, 0, uSize.y - 1)).x >> 24u) / 255.0)
  return (LT(ia, ja) * (1.0 - ax) + LT(ia + 1, ja) * ax) * (1.0 - az) + (LT(ia, ja + 1) * (1.0 - ax) + LT(ia + 1, ja + 1) * ax) * az;
}
float aoOf(float e, float up) { return e < uAoR ? (1.0 - e / uAoR) * (1.0 - e / uAoR) * min(1.4, 0.7 + up * 0.3) : 0.0; }
// Decals (surface.ts decalAt): kind (-1 none) and role; hue by out.
int dRole; int dHue;
int decalAt(int gx, int gy, int ty, int b) {
  dRole = 0; dHue = 0;
  vec4 c0 = trait(ty, 3 + 2 * b), c1 = trait(ty, 4 + 2 * b);
  float cum[6] = float[6](c0.x, c0.y, c0.z, c0.w, c1.x, c1.y);
  if (cum[5] <= 0.0) return -1;
  int cx = floorDiv(gx, 6), cy = floorDiv(gy, 6);
  float h = hash2(cx, cy, uSdS + 1300);
  int kind = -1;
  for (int d = 0; d < 6; d++) if (h < cum[d]) { kind = d; break; }
  if (kind < 0) return -1;
  uint hx = hashU(cx, cy, uSdS + 1301);
  int px = cx * 6 + 1 + int(mulhi(hx, 3u)), py = cy * 6 + 1 + int((hx * 997u) >> 30u);
  int rx = gx - px, ry = gy - py;
  if (rx < -1 || rx > 2 || ry < -1 || ry > 1) return -1;
  int shape = int(mulhi(hx * 7919u, uint(DSHAPES[kind])));
  int role = DSHAPE[(kind * 3 + shape) * 12 + (ry + 1) * 4 + rx + 1];
  if (role == 0) return -1;
  dRole = role; dHue = int(mulhi(hx * 104729u, 3u));
  return kind;
}
bool fringe(int mask, float u, float v, float th) {
  if (mask == 0) return false;
  if ((mask & 1) != 0 && 1.0 - v < th) return true;
  if ((mask & 4) != 0 && 1.0 - u < th) return true;
  if ((mask & 16) != 0 && v < th) return true;
  if ((mask & 64) != 0 && u < th) return true;
  if ((mask & 2) != 0 && max(1.0 - u, 1.0 - v) < th) return true;
  if ((mask & 8) != 0 && max(1.0 - u, v) < th) return true;
  if ((mask & 32) != 0 && max(u, v) < th) return true;
  if ((mask & 128) != 0 && max(u, 1.0 - v) < th) return true;
  return false;
}

// What a texel is: its ramp, its position on it (or a cycle phase), flags.
struct Texel { int base; int len; float tv; bool exact; bool cycle; int material; };

// A face texel at world (X, Y, Z) on terrain tile (ti, tj), global pixel (gx, gy), lit \`light\`; kind, dir, extra material.
// kpx: pixels (texels) a metre -- the dithered bands are a pixel or so wide at any scale.
Texel shade(int kind, int dir, int emat, int ti, int tj, float X, float Y, float Z, int gx, int gy, float light, float kpx) {
  Texel o; o.exact = false; o.cycle = false; o.material = -1;
  int sd = uSdG;
  uvec4 a = tA(ti, tj);
  uvec4 bb = tB(ti, tj);
  int own = typeOf(a);
  float perPx = 1.0 / (uTs * kpx);
  float band = uDitherPx * perPx, bBand = uBDitherPx * perPx, rimW = 1.6 * perPx;
  float u = X / uTs - float(uOrigin.x + ti), v = Z / uTs - float(uOrigin.y + tj);
  if (kind == 1) {
    int ty; float tv; ivec2 r;
    if (uSurface == 1) {
      int nm = cornerMats(X, Z, ti, tj, a);
      ty = chooseMaterial(own, X, Z, gx, gy, nm, band);
      float edgeM = gMargin; int edgeR = gRunner;
      int b = uBiomeOn == 1 ? chooseBiome(X, Z, gx, gy, bBand) : 0;
      // (The variant: the nearest tile centre in the warped lattice, dithered across the midline, a joined tile's only.)
      int vr = 0;
      if (uNVar > 1) {
        float th = (bayer4(gx, gy) - 0.5) * 3.0 * perPx;
        int qi = latI + (latX + th >= 0.5 ? 1 : 0), qj = latJ + (latZ + th >= 0.5 ? 1 : 0);
        int vi = ti, vj = tj;
        if (insideT(qi, qj) && !(qi == ti && qj == tj)) { uvec4 nA = tA(qi, qj); if (heightOf(nA) == heightOf(a) && ((flagsOf(nA) | flagsOf(a)) & 1) == 0) { vi = qi; vj = qj; } }
        vr = int((tB(vi, vj).y >> 8u) & 255u);
      }
      float vx = X + float(vr) * 13.37, vz = Z + float(vr) * 7.91;
      vec4 t1 = trait(ty, 1), t2 = trait(ty, 2);
      tv = 0.12 + light * 0.7 + texture2(int(t2.x + 0.5), vx, vz, Y) + t1.w + (float(vr) - float(uNVar - 1) / 2.0) * 0.012;
      float m1 = vnoise2(X * uMacroF, Z * uMacroF, uSdS + 40) * 0.65 + vnoise2(X * uMacroF * 2.3, Z * uMacroF * 2.3, uSdS + 41) * 0.35;
      tv += (m1 - 0.5) * uMacroAmt * 2.0;
      float m2 = vnoise2(X * uMacroF * 1.6 + 31.0, Z * uMacroF * 1.6, uSdS + 42);
      int lushV = m2 + (bayer4(gx, gy) - 0.5) * 0.1 > 1.0 - uLush ? 1 : 0;
      tv += clamp(float(heightOf(a) - 2) * uHShade, -0.12, 0.12);
      if (uAoS > 0.0) {
        int m = int(bb.x & 255u);
        if (m != 0) {
          float ao = 0.0;
          float jit = (vnoise2(X * 3.1, Z * 3.1, uSdS + 60) - 0.5) * 0.08;
          if ((m & 1) != 0) ao = max(ao, aoOf(1.0 - v + jit, float((bb.x >> 8u) & 255u)));
          if ((m & 2) != 0) ao = max(ao, aoOf(1.0 - u + jit, float((bb.x >> 16u) & 255u)));
          if ((m & 4) != 0) ao = max(ao, aoOf(v + jit, float((bb.x >> 24u) & 255u)));
          if ((m & 8) != 0) ao = max(ao, aoOf(u + jit, float(bb.y & 255u)));
          if ((m & 16) != 0) ao = max(ao, aoOf(max(u, v), 1.0) * 0.8);
          if ((m & 32) != 0) ao = max(ao, aoOf(max(1.0 - u, v), 1.0) * 0.8);
          if ((m & 64) != 0) ao = max(ao, aoOf(max(u, 1.0 - v), 1.0) * 0.8);
          if ((m & 128) != 0) ao = max(ao, aoOf(max(1.0 - u, 1.0 - v), 1.0) * 0.8);
          tv -= ao * uAoS;
        }
      }
      if (uRim > 0.0 && edgeR >= 0 && edgeM < rimW + band) {
        if (prioOf(ty) > prioOf(edgeR)) tv += uRim * 0.7;
        else if (prioOf(ty) < prioOf(edgeR)) tv -= uRim;
      }
      r = rampTB(b, ty, lushV);
      if (uDecals == 1) {
        vec4 dc = trait(ty, 4 + 2 * b);
        float cr = dc.z;
        if (cr > 0.0) {
          float ridge = abs(vnoise2(X * 1.1 + 5.0, Z * 1.1, uSdS + 70) - 0.5);
          if (ridge < 0.012 * cr && vnoise2(X * 0.3, Z * 0.3, uSdS + 71) > 0.45) tv -= 0.32;
        }
        int dk = decalAt(gx, gy, ty, b);
        if (dk >= 0) {
          if (dk == 0) tv += dRole == 1 ? 0.3 : 0.14;
          else if (dk == 2) tv += dRole == 1 ? 0.22 : -0.26;
          else if (dk == 1) {
            if (dRole == 3) tv -= 0.1;
            else { r = rampRow(b * 3 + dHue, uRowPetal).xy; tv = dRole == 1 ? 0.95 : 0.62; o.exact = true; }
          } else if (dk == 4) { r = named(5); tv = dRole == 1 ? 0.7 : 0.4; o.exact = true; }
          else if (dk == 5) { r = named(6); tv = dRole == 1 ? 0.85 : 0.5; o.exact = true; }
        }
      }
      if (uLightOn == 1) { float lt = lightAt(X, Z); tv = tv * (0.25 + 0.75 * lt) - (1.0 - lt) * 0.18; }
      // (ground.ts's lines over the surface: lava flows, wet shores, kerbs; the lip is pass 2's.)
      int texK = int(trait(ty, 2).x + 0.5);
      if (fringe(int(a.z & 255u), u, v, 0.14 + 0.14 * vnoise2(X * 2.3, Z * 2.3, sd + 32))) tv -= 0.16;
      if (texK == 9 || (texK == 10 && own == ty)) {
        int m = texK == 9 ? int(a.z >> 24u) : int(a.w & 255u);
        float kerb = 0.07;
        if (((m & 1) == 0 && 1.0 - v < kerb) || ((m & 4) == 0 && 1.0 - u < kerb) || ((m & 16) == 0 && v < kerb) || ((m & 64) == 0 && u < kerb)) tv -= texK == 9 ? 0.22 : 0.08;
      }
    } else {
      ty = own;
      int ov = int((a.w >> 16u) & 255u);
      if (ov != 255 && int(trait(ov, 2).x + 0.5) != 9) {
        float th = 0.2 + 0.26 * vnoise2(X * 1.7, Z * 1.7, sd + 30);
        if (fringe(int((a.w >> 8u) & 255u), u, v, th)) ty = ov;
      }
      vec4 t1 = trait(ty, 1), t2 = trait(ty, 2);
      tv = 0.12 + light * 0.7 + texture2(int(t2.x + 0.5), X, Z, Y) + t1.w;
      if (fringe(int(a.z & 255u), u, v, 0.12 + 0.12 * vnoise2(X * 2.3, Z * 2.3, sd + 32))) tv -= 0.14;
      int texK = int(t2.x + 0.5);
      if (texK == 9 || texK == 10) {
        int m = texK == 9 ? int(a.z >> 24u) : int(a.w & 255u);
        float kerb = 0.07;
        if (((m & 1) == 0 && 1.0 - v < kerb) || ((m & 4) == 0 && 1.0 - u < kerb) || ((m & 16) == 0 && v < kerb) || ((m & 64) == 0 && u < kerb)) tv -= 0.22;
      }
      r = rampRow(ty, uRowClassic).xy;
    }
    // (A cliff's shadow: ground at the foot of a higher tile to its west.)
    float wl = float((bb.y >> 16u) & 255u);
    if (wl > 0.0 && u < min(0.9, 0.3 * wl) + 0.06 * vnoise2(Z * 3.0, 0.0, sd + 43)) tv -= 0.16;
    o.material = ty;
    if (ty == uLava) {
      float ph = (X * 0.7 + Z * 0.4 + fbm2(X * 0.3, Z * 0.3, sd + 31, 2) * 5.0) * 1.5;
      ivec2 lr = named(4);
      o.base = lr.x; o.len = lr.y; o.tv = ph; o.cycle = true;
      return o;
    }
    o.base = r.x; o.len = r.y; o.tv = tv;
    return o;
  }
  if (kind == 2) {
    int ty = int(trait(own, 2).y + 0.5);
    int texK = int(trait(ty, 2).x + 0.5);
    float step0 = Y / uSh - floor(Y / uSh);
    float tv = 0.02 + light * 0.62 + texture2(texK == 0 ? 1 : texK, X + Z, Y * 1.7, 0.0) * 0.8 - (step0 > 0.9 ? 0.12 : 0.0) + (vnoise2((X + Z) * 3.0, Y * 0.3, sd + 33) - 0.5) * 0.1;
    float topY = float(topOfA(a)) * uSh;
    int b = uSurface == 1 && uBiomeOn == 1 ? chooseBiome(X, Z, gx, gy, bBand) : 0;
    ivec2 r = uSurface == 1 ? rampTB(b, ty, 0) : rampRow(ty, uRowClassic).xy;
    int ownTex = int(trait(own, 2).x + 0.5);
    if (topY - Y < 0.12 + 0.1 * vnoise2(X * 4.0 + Z * 4.0, 0.0, sd + 34) && (ownTex == 0 || ownTex == 15)) {
      tv = 0.3 + light * 0.35;
      r = uSurface == 1 ? rampTB(b, own, 0) : rampRow(own, uRowClassic).xy;
    }
    if (uSurface == 1) { float lt = lightAt(X, Z); if (lt < 1.0) tv = tv * (0.25 + 0.75 * lt) - (1.0 - lt) * 0.18; }
    o.base = r.x; o.len = r.y; o.tv = tv; o.material = ty;
    return o;
  }
  if (kind == 3) {
    int wlv = int(bb.z & 0xffffu) - 32768;
    int depthSteps = wlv - heightOf(a);
    bool deep = depthSteps >= 2;
    if (deep && fringe(int((a.z >> 16u) & 255u), u, v, 0.3 + 0.3 * vnoise2(X, Z, sd + 35))) deep = false;
    ivec2 r = named(deep ? 2 : 1);
    float ph = (X * 0.55 + Z * 0.9 + fbm2(X * 0.35, Z * 0.35, sd + 36, 2) * 6.0) * 1.2;
    if (fringe(int((a.z >> 8u) & 255u), u, v, 0.1 + 0.16 * vnoise2(X * 2.1, Z * 2.1, sd + 37))) { r = named(3); ph = (X + Z) * 2.0 + vnoise2(X * 3.0, Z * 3.0, sd + 38) * 4.0; }
    o.base = r.x; o.len = r.y; o.tv = ph; o.cycle = true;
    return o;
  }
  if (kind == 4) {
    ivec2 r = named(3);
    o.base = r.x; o.len = r.y; o.tv = -Y * 5.0 + vnoise2((X + Z) * 2.0, 0.0, sd + 39) * 6.0; o.cycle = true;
    return o;
  }
  // An extra (a house's wall, a roof, a bridge's deck): its material's ramp and grain.
  ivec4 mr = rampRow(emat, uRowMat);
  float grain = mr.z == 1 ? (vnoise2(X * 0.6 + Z * 8.0, Y * 8.0, sd + 40) - 0.5) * 0.2 + ((X + Z) * 4.0 - floor((X + Z) * 4.0) < 0.08 ? -0.15 : 0.0)
    : mr.z == 2 ? ((Y * 5.0) - floor(Y * 5.0) < 0.2 ? -0.14 : 0.0) + (hash2(ifloor(X * 3.0), ifloor(Y * 5.0), sd + 41) - 0.5) * 0.12
    : (vnoise2(X * 1.3 + Z, Y * 1.3, sd + 42) - 0.5) * 0.15;
  float tv = 0.08 + light * 0.72 + grain;
  if (uSurface == 1) { float lt = lightAt(X, Z); if (lt < 1.0) tv = tv * (0.25 + 0.75 * lt) - (1.0 - lt) * 0.18; }
  o.base = mr.x; o.len = mr.y; o.tv = tv;
  return o;
}
float lightOf(vec3 n) { return 0.3 + 0.7 * max(0.0, dot(n, uSun)); }
`;

/** Pass 1 (ortho): per pixel the texel's ramp, position, kind, tile and ray depth. */
export const GPU_FS_ORTHO = `#version 300 es
${SHADE}
uniform ivec2 uOff;          // global pixel = screen pixel (from the top-left) - uOff
uniform int uRows;           // picture rows
uniform float uK;
uniform vec3 uFwdF;
in vec3 vLocal;
in float vTd;
flat in vec3 vNorm;
flat in uvec2 vInfo;
layout(location = 0) out uvec4 outT;
void main() {
  // (Faces looking away are never seen: the baker drops them.)
  if (dot(vNorm, uFwdF) > -1e-6) discard;
  int kind = int(vInfo.x & 15u), dir = int((vInfo.x >> 4u) & 15u), emat = int(vInfo.x >> 8u);
  int ti = int(vInfo.y & 0xffffu) + uData0.x, tj = int(vInfo.y >> 16u) + uData0.y;
  int gx = int(gl_FragCoord.x) - uOff.x, gy = uRows - 1 - int(gl_FragCoord.y) - uOff.y;
  vec3 P = uAnchor + vLocal;
  Texel t = shade(kind, dir, emat, ti, tj, P.x, P.y, P.z, gx, gy, lightOf(vNorm), uK);
  uint flags = (t.exact ? 1u : 0u) | (t.cycle ? 2u : 0u) | (uint(kind) << 2u);
  outT = uvec4(uint(t.base) | (uint(t.len) << 16u) | (flags << 24u), floatBitsToUint(t.tv), floatBitsToUint(vTd), kind == 5 ? 0xffffffffu : (uint(ti + uOrigin.x) & 0xffffu) | ((uint(tj + uOrigin.y) & 0xffffu) << 16u));
}`;

/** Pass 2 (ortho): neighbours (outline, lip), the screen, the index, cycling, the colour, the sprite depth. */
export const GPU_FS_RESOLVE = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uPass;
uniform sampler2D uPalette;
uniform int uScreen, uOutline;
uniform float uDither, uGap;
// The picture's pixels and the art's: an art pixel is uN x uN picture pixels (1: the art IS the picture's pixels),
// on the global grid -- fine global pixel = picture pixel - uOffF; art pixel = floor(fine / uN); pass 1 holds art
// pixels from uA0, uRowsA rows.
uniform int uN;
uniform ivec2 uOffF, uA0;
uniform int uRowsF, uRowsA;
uniform ivec4 uCycles[8];
uniform int uCycleCount;
uniform float uTime;
uniform float uK, uSp, uCp, uCgy, uDepthC, uRange;
out vec4 outColor;
float bayerN(int gx, int gy, int n) {
  if (n == 0) return 0.5;
  if (n == 2) { int m[4] = int[4](0, 2, 3, 1); return (float(m[(gy & 1) * 2 + (gx & 1)]) + 0.5) / 4.0; }
  int m4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  if (n == 4) return (float(m4[(gy & 3) * 4 + (gx & 3)]) + 0.5) / 16.0;
  int a = m4[(gy & 3) * 4 + (gx & 3)], b = m4[((gy >> 2) & 1) * 4 + ((gx >> 2) & 1)];
  return (float(a * 4 + (b & 3)) + 0.5) / 64.0;
}
int floorDiv(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }
void main() {
  ivec2 sp = ivec2(gl_FragCoord.xy);
  int gx = floorDiv(sp.x - uOffF.x, uN), gy = floorDiv(uRowsF - 1 - sp.y - uOffF.y, uN);
  ivec2 p = ivec2(gx - uA0.x, uRowsA - 1 - (gy - uA0.y));
  ivec2 size = textureSize(uPass, 0);
  if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) discard;
  uvec4 o = texelFetch(uPass, p, 0);
  if (o.x == 0u) discard;
  int base = int(o.x & 0xffffu), len = max(1, int((o.x >> 16u) & 255u));
  uint flags = o.x >> 24u;
  int kind = int((flags >> 2u) & 7u);
  float tv = uintBitsToFloat(o.y), td = uintBitsToFloat(o.z);
  bool edge = false;
  if (uOutline > 0 && kind != 3 && kind != 4) {
    for (int q = 0; q < 4; q++) {
      ivec2 n = p + (q == 0 ? ivec2(1, 0) : q == 1 ? ivec2(-1, 0) : q == 2 ? ivec2(0, -1) : ivec2(0, 1));
      if (n.x < 0 || n.y < 0 || n.x >= size.x || n.y >= size.y) continue;
      uvec4 m = texelFetch(uPass, n, 0);
      if (m.x != 0u && uintBitsToFloat(m.z) - td > uGap) { edge = true; break; }
    }
    // (The top's front lip: the pixel under it on the picture is a cliff face of the same tile.)
    if (kind == 1 && p.y > 0) { uvec4 m = texelFetch(uPass, p - ivec2(0, 1), 0); if (m.x != 0u && int((m.x >> 26u) & 7u) == 2 && m.w == o.w) tv += 0.16; }
  }
  int idx;
  if ((flags & 2u) != 0u) idx = base + ((int(floor(tv)) % len) + len) % len;
  else {
    float x = clamp(tv, 0.0, 1.0) * float(len - 1);
    if (uScreen > 0 && (flags & 1u) == 0u) x += (bayerN(gx, gy, uScreen) - 0.5) * uDither;
    idx = base + clamp(int(floor(x + 0.5)) - (edge ? uOutline : 0), 0, len - 1);
  }
  for (int c = 0; c < 8; c++) {
    if (c >= uCycleCount) break;
    ivec4 cy = uCycles[c];
    if (idx >= cy.x && idx < cy.x + cy.y) { idx = cy.x + (idx - cy.x + int(floor(uTime * float(cy.z) / 1000.0))) % cy.y; break; }
  }
  outColor = vec4(texelFetch(uPalette, ivec2(idx % 1024, idx / 1024), 0).rgb, 1.0);
  // The sprite renderer's depth (keel/bake): 0.5 + (ground-plane depth - centre . forward) / range.
  float oyRel = -(float(gy) + 0.5 - uCgy) / uK;
  float gd = (uSp * oyRel + uCp * td) * uCp;
  gl_FragDepth = clamp(0.5 + (gd + uDepthC) / uRange, 0.0, 1.0);
}`;

/**
 * Perspective: one pass into keel/render's pass-1 buffers. The art's pixels are texels in texture space (tops: world
 * x/z; walls: along the face and y) at `uArt` a metre, coarser by powers of two where a texel would be under a pixel.
 */
export const GPU_FS_PERSP = `#version 300 es
#define PERSP 1
${SHADE}
uniform float uArt;          // texels a metre, near
uniform int uScreenP;
uniform float uDitherP;
uniform vec3 uEyeW;
uniform float uFar, uTime, uPxAtOne;   // picture pixels a metre at 1 m
uniform ivec4 uCyclesP[8];
uniform int uCycleCountP;
uniform highp usampler2D uPre;  // the depth pre-pass: per pixel the nearest ground's distance (float bits)
uniform sampler2D uShadow;   // blob shadows: world x/z -> amount (R), over uShadowRect
uniform vec4 uShadowRect;    // x0, z0, 1/width, 1/depth
uniform float uShadowOn;
in vec3 vLocal;
in float vTd;
flat in vec3 vNorm;
flat in uvec2 vInfo;
layout(location = 0) out vec4 outData;
layout(location = 1) out vec4 outData2;
void main() {
  int kind = int(vInfo.x & 15u), dir = int((vInfo.x >> 4u) & 15u), emat = int(vInfo.x >> 8u);
  int ti = int(vInfo.y & 0xffffu) + uData0.x, tj = int(vInfo.y >> 16u) + uData0.y;
  vec3 P = uAnchor + vLocal;
  vec3 n = vNorm;
  vec3 e = P - uEyeW;
  float dist = length(e);
  // (Hidden by nearer ground -- the pre-pass's -- goes before any shading: one fragment shaded a pixel.)
  if (dist > uintBitsToFloat(texelFetch(uPre, ivec2(gl_FragCoord.xy), 0).r) * 1.00002 + 1e-4) discard;
  // Texture space: tops, water, slopes on world x/z; walls along the face and up.
  bool flat0 = abs(n.y) > 0.5;
  vec3 t1 = flat0 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(-n.z, 0.0, n.x));
  vec2 uv = flat0 ? vec2(P.x, -P.z) : vec2(dot(P, t1), -P.y);
  // (Texels about a picture pixel or two wherever they are: coarser far off, finer close to the eye -- whole powers of
  // two either way, so a coarse texel is four fine ones and the grid holds -- never a smear far away, nor the ground at
  // your feet blown up into giant diamonds.)
  float tpp = uArt * dist / uPxAtOne / max(0.25, abs(dot(n, -e / max(dist, 1e-4))));
  float lod = clamp(ceil(log2(max(tpp, 1e-4)) + 0.6), -1.0, 5.0);
  float art = uArt / exp2(lod);
  vec2 g = floor(uv * art);
  vec2 c = (g + 0.5) / art - uv;
  // The texel's centre on the face's plane.
  vec3 Pc;
  if (flat0) { Pc = vec3(P.x + c.x, 0.0, P.z - c.y); Pc.y = P.y - (n.x * (Pc.x - P.x) + n.z * (Pc.z - P.z)) / n.y; }
  else Pc = P + t1 * c.x + vec3(0.0, -c.y, 0.0);
  int gx = int(g.x), gy = int(g.y);
  Texel t = shade(kind, dir, emat, ti, tj, Pc.x, Pc.y, Pc.z, gx, gy, lightOf(n), art);
  uvec4 a = tA(ti, tj);
  float tv = t.tv;
  // A lit lip along a top's cliff edges; blob shadows under what stands on the ground.
  if (kind == 1 && !t.cycle) {
    uvec4 bb = tB(ti, tj);
    int cl = int((bb.y >> 24u) & 15u);
    float u = Pc.x / uTs - float(uOrigin.x + ti), v = Pc.z / uTs - float(uOrigin.y + tj);
    float lipW = 1.0 / (art * uTs);
    if (((cl & 1) != 0 && 1.0 - v < lipW) || ((cl & 2) != 0 && 1.0 - u < lipW) || ((cl & 4) != 0 && v < lipW) || ((cl & 8) != 0 && u < lipW)) tv += 0.16;
  }
  if (uShadowOn > 0.0 && (kind == 1 || kind == 3)) {
    vec2 sp = (Pc.xz - uShadowRect.xy) * uShadowRect.zw;
    if (sp.x > 0.0 && sp.y > 0.0 && sp.x < 1.0 && sp.y < 1.0) tv -= texture(uShadow, sp).r * 0.34;
  }
  int len = max(1, t.len);
  int pos;
  if (t.cycle) {
    pos = ((int(floor(tv)) % len) + len) % len;
  } else {
    float x = clamp(tv, 0.0, 1.0) * float(len - 1);
    if (uScreenP > 0 && !t.exact) x += (bayerN(gx, gy, uScreenP) - 0.5) * uDitherP;
    pos = clamp(int(floor(x + 0.5)), 0, len - 1);
  }
  int idx = t.base + pos;
  for (int q = 0; q < 8; q++) {
    if (q >= uCycleCountP) break;
    ivec4 cy = uCyclesP[q];
    if (idx >= cy.x && idx < cy.x + cy.y) { idx = cy.x + (idx - cy.x + int(floor(uTime * float(cy.z) / 1000.0))) % cy.y; break; }
  }
  pos = idx - t.base;
  // (Outline ids: the terrain by level, so a cliff's top edge outlines against the ground below; water and extras their own.)
  int lvl = heightOf(a);
  float id = kind == 5 ? 180.0 : kind == 3 || kind == 4 ? 45.0 : float(1 + ((lvl % 40) + 40) % 40);
  outData = vec4(float(idx & 255) / 255.0, float((idx >> 8) & 255) / 255.0, 254.0 / 255.0, id / 255.0);
  outData2 = vec4(0.0, clamp(dot(n, -e / max(dist, 1e-4)), 0.0, 1.0), float(pos) / float(max(1, len - 1)), float(pos | (min(len, 15) << 4)) / 255.0);
  gl_FragDepth = clamp(dist / uFar, 0.0, 1.0);
}`;

/** The perspective depth pre-pass: rasterised depth (early-Z works), each pixel's nearest ground distance out. */
export const GPU_FS_PRE = `#version 300 es
precision highp float;
uniform vec3 uAnchor, uEyeW;
in vec3 vLocal;
in float vTd;
flat in vec3 vNorm;
flat in uvec2 vInfo;
layout(location = 0) out uvec4 outD;
void main() { outD = uvec4(floatBitsToUint(length(uAnchor + vLocal - uEyeW)), 0u, 0u, 0u); }`;
