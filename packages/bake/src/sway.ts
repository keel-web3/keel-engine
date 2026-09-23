// Wind in the sprite shader: foliage sways, thousands at once, with no bake
// per frame and no sprite per pose. drawSway() is drawLayers() plus two
// floats an instance: its SWAY (packed: amplitude in pixels, where on its
// height the bend starts, how the bend curves, its frequency) and a LEAN (a
// static push in pixels). Per texel ROW the shader shifts the sprite
// sideways by WHOLE pixels -- shift(row) = round(amp x s(t) x w(row)) with
// w = ((row / height - from) / (1 - from)) ^ bend and s(t) the sway signal
// (object/sway.ts: a sway with a gust riding it) -- so it stays pixel art
// (no smear), and the quad is widened by the reach. On top:
//
//   GUSTS     a wave rolling across the map along the wind (40 m long, at the
//             wind's speed) lifts the amplitude where it passes: a meadow
//             ripples instead of every tuft nodding alone
//   PHASE     from the instance's ground position (object/sway.ts phaseAt):
//             neighbours sway nearly together
//   BENDERS   up to 8 points (units walking through) push what's near them
//             away along the screen, fading with distance
//
// swayShiftPacked() is the CPU reference the shader matches (tested against
// object/sway.ts's swayShift).

/** Floats per sway instance: the 14 of a layer instance, then the packed sway and a lean (pixels). */
export const SWAY_INSTANCE_FLOATS = 16;

export class SwayInstances {
  readonly capacity: number;
  readonly data: Float32Array;
  count = 0;
  constructor(capacity: number) { this.capacity = capacity; this.data = new Float32Array(capacity * SWAY_INSTANCE_FLOATS); }
  /** Add one: a layer instance's fields, then its packed sway (packSway; 0: still) and a lean in picture pixels. */
  push(x: number, y: number, z: number, u0: number, v0: number, w: number, h: number, ax: number, ay: number, layer: number, look: number, bias = 0, scale = 1, sway = 0, lean = 0): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count * SWAY_INSTANCE_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u0; d[o + 4] = v0; d[o + 5] = w; d[o + 6] = h; d[o + 7] = ax; d[o + 8] = ay; d[o + 9] = layer; d[o + 10] = look; d[o + 11] = bias; d[o + 12] = scale; d[o + 13] = 0;
    d[o + 14] = sway; d[o + 15] = lean;
    this.count += 1;
    return true;
  }
  clear(): void { this.count = 0; }
}

/** A sway as object/sway.ts's SwaySpec has it: amp (a share of the height), hz, bend, from (metres). */
export interface SwayLike { readonly amp: number; readonly hz: number; readonly bend: number; readonly from: number }

/**
 * A sway packed into one float for a sprite `heightPx` tall (the thing's height in picture pixels at the scale it's
 * drawn at): amplitude in quarter pixels (8 bits, up to 63.75 px), where the bend starts as a share of the height
 * (5 bits), the bend's curve in quarters (4 bits, up to 3.75), the frequency in 32nds of a hertz (7 bits, up to
 * 3.97 Hz) -- 24 bits, exact in a float.
 */
export function packSway(sway: SwayLike, heightPx: number, pxPerMetre: number): number {
  const top = heightPx / pxPerMetre;
  const amp = Math.max(0, Math.min(255, Math.round(sway.amp * heightPx * 4)));
  const from = Math.max(0, Math.min(31, Math.round((top > 0 ? Math.min(1, sway.from / top) : 0) * 31)));
  const bend = Math.max(0, Math.min(15, Math.round(sway.bend * 4)));
  const hz = Math.max(0, Math.min(127, Math.round(sway.hz * 32)));
  return amp + from * 256 + bend * 8192 + hz * 131072;
}
export function unpackSway(p: number): { ampPx: number; from: number; bend: number; hz: number } {
  return { ampPx: (p % 256) / 4, from: (Math.floor(p / 256) % 32) / 31, bend: (Math.floor(p / 8192) % 16) / 4, hz: Math.floor(p / 131072) / 32 };
}

/** The sway signal (object/sway.ts swaySignal). */
export const swaySignalOf = (t: number, hz: number, phase: number): number => Math.sin(2 * Math.PI * (hz * t + phase)) + 0.35 * Math.sin(2 * Math.PI * (2.3 * hz * t + 1.7 * phase));

/** The shader's shift for a row `rowUp` pixels above the anchor of a sprite `heightPx` tall (whole pixels). */
export function swayShiftPacked(rowUp: number, heightPx: number, packed: number, t: number, phase: number, gust = 1, lean = 0): number {
  const { ampPx, from, bend, hz } = unpackSway(packed);
  const f = heightPx > 0 ? rowUp / heightPx : 0;
  const w = f <= from || from >= 1 ? 0 : Math.min(1, (f - from) / (1 - from)) ** bend;
  return Math.round((ampPx * swaySignalOf(t, hz, phase) * gust + lean) * w) || 0;
}

/** How drawSway moves things: the time, the wind (a yaw, a speed in m/s), gusts (0..1), and what's walking through. */
export interface WindStyle {
  readonly time: number;
  /** The wind's heading (frame convention: 0 blows along +z; default 0.6). */
  readonly wind?: number;
  /** m/s (default 3). */
  readonly speed?: number;
  /** 0..1: how much a gust lifts the sway (default 0.6). */
  readonly gust?: number;
  /** Up to 8 benders: [x, z, radius (m), strength (px)]. */
  readonly benders?: ReadonlyArray<readonly [number, number, number, number]>;
}

export const SWAY_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in vec4 aRect;
layout(location=3) in vec2 aAnchor;
layout(location=4) in vec4 aExtra;            // page layer, look, depth bias (m), scale
layout(location=5) in vec2 aSway;             // packed sway, lean (px)
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK;
uniform vec2 uSize;
uniform float uDepthRange;
uniform float uTime;
uniform vec4 uWind;                           // wind dir x, dir z, speed, gust
uniform vec4 uBend[8];
uniform int uBendCount;
out vec3 vUv;
flat out int vLook;
flat out vec2 vDepth;
flat out vec4 vSway;                          // shift at the top (texels), bend start, bend curve, the anchor's atlas row
flat out vec4 vRect;
flat out vec4 vDS;                            // depth sprites (sprites.ts LAYER_VS)
flat out int vId;
flat out vec2 vAnchor;
void main() {
  vId = gl_InstanceID;
  vec3 d = aPos - uCenter;
  vec2 anchor = floor(vec2(uSize.x * 0.5 + dot(d, uRight) * uK, uSize.y * 0.5 - dot(d, uUp) * uK) + 0.5);
  vAnchor = anchor;
  float s = aExtra.w;
  float p = aSway.x;
  float ampPx = mod(p, 256.0) / 4.0;
  float from = mod(floor(p / 256.0), 32.0) / 31.0;
  float bend = mod(floor(p / 8192.0), 16.0) / 4.0;
  float hz = floor(p / 131072.0) / 32.0;
  // (object/sway.ts phaseAt: a wave along the wind, a little hash across it.)
  float along = aPos.x * uWind.x + aPos.z * uWind.y;
  float across = -aPos.x * uWind.y + aPos.z * uWind.x;
  float jitter = fract(sin(across * 12.9898 + along * 0.3) * 43758.5453);
  float phase = fract(-along * hz / max(uWind.z, 0.01) + jitter * 0.15);
  float sig = sin(6.2831853 * (hz * uTime + phase)) + 0.35 * sin(6.2831853 * (2.3 * hz * uTime + 1.7 * phase));
  float gust = 1.0 + uWind.w * max(0.0, sin(6.2831853 * (along - uWind.z * uTime) / 40.0));
  float lean = aSway.y;
  for (int b = 0; b < 8; b += 1) {
    if (b >= uBendCount) break;
    vec4 B = uBend[b];
    vec2 dd = aPos.xz - B.xy;
    float dist = length(dd);
    if (dist < B.z) lean += (dot(vec3(dd.x, 0.0, dd.y), uRight) >= 0.0 ? 1.0 : -1.0) * B.w * (1.0 - dist / B.z);
  }
  float reach = ampPx * 1.35 * (1.0 + uWind.w) + abs(lean);
  float pad = ceil(reach + 1.0);                // (picture pixels each side)
  float w = floor(aRect.z * s + 0.5), h = floor(aRect.w * s + 0.5);
  vec2 px = anchor - floor(aAnchor * s + 0.5) + vec2(aCorner.x * (w + 2.0 * pad) - pad, aCorner.y * h);
  vec2 ndc = vec2(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0);
  float depth = clamp(0.5 + dot(d, uForward) / uDepthRange, 0.0, 1.0);
  gl_Position = vec4(ndc, depth * 2.0 - 1.0, 1.0);
  vUv = vec3(aRect.x + (aCorner.x * (w + 2.0 * pad) - pad) / s, aRect.y + aCorner.y * aRect.w, aExtra.x);
  vLook = int(floor(aExtra.y + 0.5));
  vDepth = vec2(depth, abs(aExtra.z) / uDepthRange);
  vSway = vec4((ampPx * sig * gust + lean) / s, from, bend, aRect.y + aAnchor.y);
  vRect = aRect;
  vDS = vec4(dot(d, uForward), dot(d, uUp), aRect.w, s);
}`;

const FETCH = "void main() {\n  vec4 c = texelFetch(uPages, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0);";

/** The sway fragment shader from the layer one: the texel fetched from its row's shifted column. */
export function swayFragment(layerFs: string): string {
  const out = layerFs
    .replace("in vec3 vUv;", "in vec3 vUv;\nflat in vec4 vSway;\nflat in vec4 vRect;")
    .replace(FETCH, `void main() {
  vec2 uv = vUv.xy;
  // (The row's height above the anchor, as a share of the sprite's: the bend's weight there, a whole-texel shift.)
  float height = max(1.0, vSway.w - vRect.y);
  float f = (vSway.w - floor(uv.y) - 0.5) / height;
  float wgt = f <= vSway.y || vSway.y >= 1.0 ? 0.0 : pow(min(1.0, (f - vSway.y) / (1.0 - vSway.y)), vSway.z);
  uv.x -= floor(vSway.x * wgt + 0.5);
  if (uv.x < vRect.x || uv.x >= vRect.x + vRect.z) discard;
  vec4 c = texelFetch(uPages, ivec3(ivec2(uv), int(vUv.z + 0.5)), 0);`)
    // (Depth sprites: the height from the same shifted texel.)
    .replace("  ivec3 hAt = ivec3(ivec2(vUv.xy), int(vUv.z + 0.5));", "  ivec3 hAt = ivec3(ivec2(uv), int(vUv.z + 0.5));");
  if (out === layerFs || !out.includes("vSway.x * wgt")) throw new Error("swayFragment: the layer shader changed under its edits.");
  return out;
}
