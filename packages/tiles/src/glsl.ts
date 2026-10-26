// The tile surface's shader, injected into a LitMaterial (lighting, shadows and
// fog stay the renderer's). Every fragment snaps to the texel grid, then walks
// the materials from the top down: the first whose system covers the texel is
// drawn there, shaded by its pattern, its rim and any drop shadow cast by the
// edge of a material above it.

export const MAX_TILE_MATERIALS = 8;

export const TILE_VERTEX_HEAD = /* glsl */ `
uniform vec4 uTileFrame;
varying vec2 vTileP;
`;

export const TILE_VERTEX_BEGIN = /* glsl */ `#include <begin_vertex>
  vTileP = (position.xz - uTileFrame.xy) / uTileFrame.z;`;

export const TILE_FRAGMENT_HEAD = /* glsl */ `
#define TILE_MAX ${String(MAX_TILE_MATERIALS)}
uniform sampler2D uTileCells;
uniform sampler2D uTileMask;
uniform sampler2D uTileLut;
uniform sampler2D uTileAtlas0;
uniform sampler2D uTileAtlas1;
uniform sampler2D uTileAtlas2;
uniform sampler2D uTileAtlas3;
uniform vec4 uTileGrid;
uniform vec4 uTileA[TILE_MAX];
uniform vec4 uTileB[TILE_MAX];
uniform vec4 uTileC[TILE_MAX];
uniform vec3 uTileRamp[TILE_MAX * 4];
uniform int uTileCount;
uniform float uTileMasked;
varying vec2 vTileP;

int tileCell(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uTileGrid.xy) - 1);
  return int(texelFetch(uTileCells, c, 0).r * 255.0 + 0.5);
}
float tileHas(ivec2 c, int layer) { return tileCell(c) >= layer ? 1.0 : 0.0; }
float tileHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tileNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tileHash(i), tileHash(i + vec2(1.0, 0.0)), f.x), mix(tileHash(i + vec2(0.0, 1.0)), tileHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float tileFbm(vec2 p) { return tileNoise(p) * 0.55 + tileNoise(p * 2.13 + 7.1) * 0.3 + tileNoise(p * 4.37 + 3.7) * 0.15; }
float tileBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float m = mod(q.x + q.y * 4.0, 16.0);
  return fract(m * 0.4375 + floor(m * 0.25) * 0.3125);
}
vec4 tileAtlas(int slot, ivec2 px) {
  if (slot == 0) return texelFetch(uTileAtlas0, px, 0);
  if (slot == 1) return texelFetch(uTileAtlas1, px, 0);
  if (slot == 2) return texelFetch(uTileAtlas2, px, 0);
  return texelFetch(uTileAtlas3, px, 0);
}

// The blend system: a field between cell centres, roughened by noise; above 0 is in.
float tileBlendEdge(int layer, vec2 q) {
  vec2 s = q - 0.5;
  ivec2 c = ivec2(floor(s));
  vec2 f = fract(s);
  f = f * f * (3.0 - 2.0 * f);
  float field = mix(mix(tileHas(c, layer), tileHas(c + ivec2(1, 0), layer), f.x), mix(tileHas(c + ivec2(0, 1), layer), tileHas(c + ivec2(1, 1), layer), f.x), f.y);
  return field + (tileFbm(q * 1.9 + float(layer) * 17.3) - 0.5) * 2.0 * uTileA[layer].w - 0.5;
}

// One layer at texel q: covered or not, its shade step (-1, 0, +1), whether
// its edge throws shadow here, and (colour atlases) the texel's own colour.
bool tileCover(int layer, vec2 q, out float shade, out float shadow, out vec4 own) {
  shade = 0.0; shadow = 0.0; own = vec4(0.0);
  int system = int(uTileA[layer].x);
  float px = 1.0 / uTileGrid.z;
  if (system == 0) {
    bool inside = tileBlendEdge(layer, q) > 0.0;
    if (inside && uTileB[layer].x > 0.0) {
      if (tileBlendEdge(layer, q + vec2(0.0, px)) <= 0.0) shade = 1.0;
      else if (tileBlendEdge(layer, q - vec2(0.0, px)) <= 0.0) shade = -1.0;
    }
    if (!inside) {
      for (int d = 1; d <= 3; d++) {
        if (float(d) > uTileB[layer].y) break;
        if (tileBlendEdge(layer, q + vec2(0.0, px * float(d))) > 0.0) { shadow = 1.0; break; }
      }
    }
    return inside;
  }
  ivec2 c = ivec2(floor(q));
  vec2 f = fract(q);
  int index = 0;
  if (system == 4) {
    vec2 s = q - 0.5;
    ivec2 d = ivec2(floor(s));
    f = fract(s);
    c = d;
    index = (tileHas(d + ivec2(1, 1), layer) > 0.5 ? 1 : 0) | (tileHas(d + ivec2(1, 0), layer) > 0.5 ? 2 : 0) | (tileHas(d, layer) > 0.5 ? 4 : 0) | (tileHas(d + ivec2(0, 1), layer) > 0.5 ? 8 : 0);
  } else {
    if (tileHas(c, layer) < 0.5) return false;
    int m = 0;
    if (tileHas(c + ivec2(0, 1), layer) > 0.5) m |= 1;
    if (tileHas(c + ivec2(1, 1), layer) > 0.5) m |= 2;
    if (tileHas(c + ivec2(1, 0), layer) > 0.5) m |= 4;
    if (tileHas(c + ivec2(1, -1), layer) > 0.5) m |= 8;
    if (tileHas(c + ivec2(0, -1), layer) > 0.5) m |= 16;
    if (tileHas(c + ivec2(-1, -1), layer) > 0.5) m |= 32;
    if (tileHas(c + ivec2(-1, 0), layer) > 0.5) m |= 64;
    if (tileHas(c + ivec2(-1, 1), layer) > 0.5) m |= 128;
    if (system == 1) index = int(texelFetch(uTileLut, ivec2(m, 0), 0).r * 255.0 + 0.5);
    else if (system == 2) {
      bool n = (m & 1) != 0, ne = (m & 2) != 0, e = (m & 4) != 0, se = (m & 8) != 0, s = (m & 16) != 0, sw = (m & 32) != 0, w = (m & 64) != 0, nw = (m & 128) != 0;
      index = (n && ne && e ? 1 : 0) | (e && se && s ? 2 : 0) | (s && sw && w ? 4 : 0) | (w && nw && n ? 8 : 0);
    } else index = (m & 1) | ((m >> 1) & 2) | ((m >> 2) & 4) | ((m >> 3) & 8);
  }
  int tile = int(uTileC[layer].x), cols = int(uTileC[layer].y), rows = int(uTileC[layer].z);
  int variant = int(floor(tileHash(vec2(c) + 0.37) * uTileC[layer].w));
  ivec2 texel = ivec2(min(int(f.x * float(tile)), tile - 1), min(int((1.0 - f.y) * float(tile)), tile - 1));
  vec4 a = tileAtlas(int(uTileB[layer].z), ivec2((index % cols) * tile, (index / cols + variant * rows) * tile) + texel);
  bool inside = a.a > 0.5;
  if (uTileB[layer].w > 0.5) { own = a; return inside; }
  if (inside) shade = a.r > 0.75 ? 1.0 : a.r < 0.25 ? -1.0 : 0.0;
  else if (a.r < 0.25 && uTileB[layer].y > 0.0) shadow = 1.0;
  return inside;
}

// A material's pattern at texel q, 0 (dark) to 1 (light).
float tilePattern(int layer, vec2 q) {
  int pattern = int(uTileA[layer].y);
  float scale = uTileA[layer].z;
  vec2 p = q * scale;
  if (pattern == 1) return tileFbm(p);
  if (pattern == 2) { float h = tileHash(floor(q * uTileGrid.z)); return h > 0.9 ? 0.95 : h < 0.08 ? 0.15 : 0.55; }
  if (pattern == 3) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(tileHash(i + g), tileHash(i + g + 19.7)) * 0.8 + 0.1;
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
    }
    return d2 - d1 < 0.1 ? 0.02 : 0.42 + 0.45 * tileHash(id);
  }
  if (pattern == 4) {
    float wave = sin((p.x + p.y * 0.35) * 6.2832 + uTileGrid.w * 1.4 + tileFbm(p * 0.7) * 4.0);
    float glint = step(0.985, tileHash(floor(q * uTileGrid.z) + floor(uTileGrid.w * 2.0)));
    return clamp(0.45 + 0.35 * wave + glint, 0.0, 1.0);
  }
  if (pattern == 5) {
    vec2 cell = floor(q * uTileGrid.z * vec2(1.0, 0.5));
    return clamp(tileFbm(p) * 0.6 + 0.45 * step(0.72, tileHash(cell)) - 0.15 * step(tileHash(cell + 3.3), 0.12), 0.0, 1.0);
  }
  if (pattern == 6) return 0.5 + 0.5 * sin(p.x * 6.2832 + tileFbm(p * 0.5) * 5.0);
  return 0.6;
}

vec3 tileAlbedo() {
  vec2 q = (floor(vTileP * uTileGrid.z) + 0.5) / uTileGrid.z;
  if (uTileMasked > 0.5 && texelFetch(uTileMask, clamp(ivec2(floor(vTileP * uTileGrid.z)), ivec2(0), ivec2(uTileGrid.xy * uTileGrid.z) - 1), 0).r < 0.5) discard;
  int top = 0;
  float shade = 0.0, shadow = 0.0, s, sh;
  vec4 own = vec4(0.0), o;
  for (int layer = TILE_MAX - 1; layer >= 1; layer--) {
    if (layer >= uTileCount) continue;
    if (tileCover(layer, q, s, sh, o)) { top = layer; shade = s; own = o; break; }
    shadow = max(shadow, sh);
  }
  if (uTileB[top].w > 0.5 && top > 0) return own.rgb;
  float t = tilePattern(top, q);
  float dither = (tileBayer(q * uTileGrid.z) - 0.5) * 0.5;
  float level = clamp(floor(t * 3.999 + dither) + shade - shadow, 0.0, 3.0);
  int i = top * 4 + int(level);
  return uTileRamp[i];
}
`;

export const TILE_FRAGMENT_MAP = /* glsl */ `#include <map_fragment>
  diffuseColor.rgb = tileAlbedo();`;
