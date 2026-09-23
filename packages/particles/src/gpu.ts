// The particle renderer for the sprite path: every live particle in one
// instanced draw, through the same pixel view as @keel-engine/bake's sprite
// renderer and into the same framebuffer after it. Each particle is a quad
// snapped to whole pixels (a speck, a round blob, a baked sprite at a
// whole-number scale, or a streak along its velocity), its depth from its
// ground point exactly as a sprite's comes from its anchor -- so dust behind
// a unit is hidden by it and dust in front covers it, with no sorting.
// Colour is a palette entry: lightness walks the style's ramp with an
// ordered dither between two entries, and fade is dither density against a
// screen-anchored Bayer matrix (never a blend).
//
// The integrator is here, on the GPU: the vertex shader evaluates the pool's
// closed-form motion (pool.ts motionAt, MOTION_GLSL below) from each slot's
// birth state at the frame's own time -- so particles move smoothly at any
// frame rate, between fixed steps. The birth states live in four float
// textures (a texel a slot); each frame the pool hands over the slots that
// changed (births, bounces) and a scatter pass writes just those, as points.
// Nothing per live particle crosses the bus.
//
//   const sprites = createSpriteRenderer(canvas, { width, height });      // @keel-engine/bake
//   const parts = createParticleRenderer(sprites.gl, { capacity: pool.capacity });
//   parts.setPalette(colours, ramps);                                     // particlePalette(), or a game's own
//   sprites.draw(view, instances); parts.draw(view, pool, { ahead });     // same view, same depth buffer

import type { PixelView } from "@keel-engine/bake";
import { CURVE_SAMPLES, MAX_STYLES, STYLE_WIDTH } from "./pool.ts";
import type { ParticlePool } from "./pool.ts";
import { particleSpriteAtlas, SPRITE_CELL } from "./palette.ts";
import { PARTICLE_SPRITES } from "./recipe.ts";

const PUFF = PARTICLE_SPRITES.indexOf("puff");

/** Slots a row of the state textures holds. */
export const STATE_WIDTH = 1024;
const RECORD_FLOATS = 17; // slot, then the four texels
const BATCH = 16384;

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
const SCATTER_VS = `#version 300 es
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
const SCATTER_FS = `#version 300 es
precision highp float;
flat in vec4 v0, v1, v2, v3;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
layout(location=3) out vec4 o3;
void main() { o0 = v0; o1 = v1; o2 = v2; o3 = v3; }`;

export interface ParticleRendererOptions {
  /** Particles it can draw (the pool's capacity). */
  readonly capacity: number;
}

export interface ParticleDrawOptions {
  /** Seconds past the pool's time to draw at: the fraction of a step since the last one (default 0). */
  readonly ahead?: number;
}

export interface ParticleRenderer {
  /** Colours ([[r,g,b],...] 0-255) and ramps ({ name: [base, length] }), as the pixel renderer's setPalette. */
  setPalette(colours: readonly (readonly number[])[], ramps: Readonly<Record<string, readonly [number, number]>>): void;
  /** Draw the pool's live particles through `view` into what's bound (after the sprites: same depth buffer). */
  /** Through a pixel view -- or, with `eye` (keel/worldgen's DungeonDrawView perspective), through a perspective camera. */
  /**
   * `contract`: under perspective, write depth by keel/bake's one contract (project.ts: linear forward distance from the
   * eye over `far`, 0.5 at the eye) -- so particles sort with a live mesh scene. Off, the dungeon renderer's near..far.
   */
  draw(view: Pick<PixelView, "center" | "axes" | "pixelsPerMetre" | "width" | "height"> & { readonly eye?: readonly [number, number, number]; readonly fov?: number; readonly near?: number; readonly far?: number; readonly contract?: boolean }, pool: ParticlePool, options?: ParticleDrawOptions): void;
  /** Ramps the pool's styles name that the palette hasn't got (drawn on ramp 0). */
  readonly missingRamps: readonly string[];
  /** Slots written to the GPU by the last draw, and bytes uploaded for them. */
  readonly written: number;
  readonly uploaded: number;
  /** How changed slots reach the GPU: "scatter" (float render targets) or "rows" (re-uploading texture rows; slower). */
  readonly path: "scatter" | "rows";
  dispose(): void;
}

export function createParticleRenderer(gl: WebGL2RenderingContext, { capacity }: ParticleRendererOptions): ParticleRenderer {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Particle shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const link = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Particle program: ${gl.getProgramInfoLog(p)}`);
    return p;
  };
  const prog = link(PARTICLE_VS, PARTICLE_FS);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const U = {
    persp: u("uPersp"), eye: u("uEye"), tan: u("uTan"), clip: u("uClip"), contract: u("uContract"),
    center: u("uCenter"), right: u("uRight"), up: u("uUp"), forward: u("uForward"), k: u("uK"), size: u("uSize"), depth: u("uDepthRange"), now: u("uNow"),
    styles: u("uStyles"), palette: u("uPalette"), sprites: u("uSprites"), t: [u("uT0"), u("uT1"), u("uT2"), u("uT3")],
  };
  const scatter = link(SCATTER_VS, SCATTER_FS);
  const uState = gl.getUniformLocation(scatter, "uState");

  // The quad.
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // The scatter's records.
  const records = new Float32Array(BATCH * RECORD_FLOATS);
  const rvao = gl.createVertexArray()!;
  gl.bindVertexArray(rvao);
  const rbuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
  gl.bufferData(gl.ARRAY_BUFFER, records.byteLength, gl.DYNAMIC_DRAW);
  const stride = RECORD_FLOATS * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 1, gl.FLOAT, false, stride, 0);
  for (let k = 0; k < 4; k += 1) { gl.enableVertexAttribArray(1 + k); gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, stride, (1 + k * 4) * 4); }
  gl.bindVertexArray(null);

  const texture = (unit: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // The state: four RGBA32F textures, a texel a slot.
  const SH = Math.max(1, Math.ceil(capacity / STATE_WIDTH));
  const state = [0, 1, 2, 3].map((k) => {
    const t = texture(4 + k);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, STATE_WIDTH, SH);
    return t;
  });
  const floatTargets = !!gl.getExtension("EXT_color_buffer_float");
  const fbo = gl.createFramebuffer()!;
  let path: "scatter" | "rows" = "rows";
  if (floatTargets) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    state.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) path = "scatter";
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // (Without float render targets: a CPU copy of the state, its changed rows re-uploaded.)
  const mirror = path === "rows" ? [0, 1, 2, 3].map(() => new Float32Array(STATE_WIDTH * SH * 4)) : [];

  const styleTex = texture(1);
  const styleRows = new Float32Array(MAX_STYLES * STYLE_WIDTH * 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, STYLE_WIDTH, MAX_STYLES, 0, gl.RGBA, gl.FLOAT, styleRows);
  const paletteTex = texture(2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(256 * 4));
  const spriteTex = texture(3);
  const atlas = particleSpriteAtlas();
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, atlas.width, atlas.height, 0, gl.RED, gl.UNSIGNED_BYTE, atlas.data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.activeTexture(gl.TEXTURE0);

  let ramps = new Map<string, readonly [number, number]>();
  let styleVersion = -1;
  let stylePool: ParticlePool | null = null;
  let statePool: ParticlePool | null = null;
  let paletteDirty = false;
  const missing: string[] = [];
  let written = 0;
  let uploaded = 0;
  let base = 0; // (the time base: state times are stored from it, so float32 keeps them to the microsecond)
  let drawnHigh = 0;
  const changes = new Int32Array(capacity);

  // The pool's style table, with each style's ramp filled in from the palette.
  function syncStyles(pool: ParticlePool) {
    const { data, ramps: names, count, version } = pool.styles;
    if (version === styleVersion && pool === stylePool && !paletteDirty) return;
    styleVersion = version;
    stylePool = pool;
    paletteDirty = false;
    styleRows.set(data);
    missing.length = 0;
    for (let s = 0; s < count; s += 1) {
      const name = names[s]!;
      const r = ramps.get(name);
      if (!r && !missing.includes(name)) missing.push(name);
      const o = (s * STYLE_WIDTH + CURVE_SAMPLES + 1) * 4;
      styleRows[o] = r?.[0] ?? 0;
      styleRows[o + 1] = Math.max(1, r?.[1] ?? 1);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, styleTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STYLE_WIDTH, MAX_STYLES, gl.RGBA, gl.FLOAT, styleRows);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Slot s's four texels into records[r].
  function record(pool: ParticlePool, s: number, r: number) {
    const { p0, v0, vinf, tSeg, tStop, tBirth, life, style, rnd, lod } = pool.slots;
    const o = r * RECORD_FLOATS;
    const q = s * 3;
    const R = records;
    R[o] = s;
    R[o + 1] = p0[q]!; R[o + 2] = p0[q + 1]!; R[o + 3] = p0[q + 2]!; R[o + 4] = tSeg[s]! - base;
    R[o + 5] = v0[q]!; R[o + 6] = v0[q + 1]!; R[o + 7] = v0[q + 2]!; R[o + 8] = pool.isLive(s) ? life[s]! : 0;
    R[o + 9] = vinf[q]!; R[o + 10] = vinf[q + 1]!; R[o + 11] = vinf[q + 2]!; R[o + 12] = tStop[s]!;
    R[o + 13] = style[s]!; R[o + 14] = rnd[s]!; R[o + 15] = lod[s]!; R[o + 16] = tBirth[s]! - base;
  }

  // Write records[0..n) to the state: the scatter (points into the four textures), or the rows fallback.
  function flush(n: number) {
    if (n === 0) return;
    written += n;
    uploaded += n * RECORD_FLOATS * 4;
    if (path === "scatter") {
      gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, records, 0, n * RECORD_FLOATS);
      gl.drawArrays(gl.POINTS, 0, n);
      return;
    }
    let lo = Infinity, hi = -1;
    for (let r = 0; r < n; r += 1) {
      const o = r * RECORD_FLOATS;
      const s = records[o]!;
      for (let k = 0; k < 4; k += 1) mirror[k]!.set(records.subarray(o + 1 + k * 4, o + 5 + k * 4), s * 4);
      const row = Math.floor(s / STATE_WIDTH);
      if (row < lo) lo = row;
      if (row > hi) hi = row;
    }
    for (let k = 0; k < 4; k += 1) {
      gl.activeTexture(gl.TEXTURE4 + k);
      gl.bindTexture(gl.TEXTURE_2D, state[k]!);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, lo, STATE_WIDTH, hi - lo + 1, gl.RGBA, gl.FLOAT, mirror[k]!, lo * STATE_WIDTH * 4);
    }
    gl.activeTexture(gl.TEXTURE0);
    uploaded += (hi - lo + 1) * STATE_WIDTH * 64;
  }

  // Bring the GPU's state up to the pool's: the changed slots, or every slot (a load, a clear, a new time base).
  function syncState(pool: ParticlePool) {
    written = 0;
    uploaded = 0;
    let n = pool.takeChanges(changes);
    let all = n < 0 || pool !== statePool;
    if (pool.time - base > 1024) { base = Math.floor(pool.time); all = true; }
    statePool = pool;
    const high = Math.max(pool.highWater, drawnHigh);
    if (all) n = high;
    if (n === 0) return;
    let prevFb: WebGLFramebuffer | null = null;
    if (path === "scatter") {
      // (The draw sets its own viewport after this; the framebuffer goes back to whatever the game had bound.)
      prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, STATE_WIDTH, SH);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(scatter);
      gl.uniform2f(uState, STATE_WIDTH, SH);
      gl.bindVertexArray(rvao);
    }
    let r = 0;
    for (let k = 0; k < n; k += 1) {
      record(pool, all ? k : changes[k]!, r);
      r += 1;
      if (r === BATCH) { flush(r); r = 0; }
    }
    flush(r);
    if (path === "scatter") {
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    }
  }

  return {
    get missingRamps() { return missing; },
    get written() { return written; },
    get uploaded() { return uploaded; },
    path,
    setPalette(colours, rampTable) {
      const rows = Math.max(1, Math.ceil(colours.length / 256));
      const bytes = new Uint8Array(256 * rows * 4);
      colours.forEach((c, i) => { bytes[i * 4] = c[0] ?? 0; bytes[i * 4 + 1] = c[1] ?? 0; bytes[i * 4 + 2] = c[2] ?? 0; bytes[i * 4 + 3] = 255; });
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, paletteTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      gl.activeTexture(gl.TEXTURE0);
      ramps = new Map(Object.entries(rampTable));
      paletteDirty = true;
    },
    draw(view, pool, { ahead = 0 } = {}) {
      if (pool.capacity > capacity) throw new RangeError(`This renderer draws ${capacity} particles; the pool holds ${pool.capacity}.`);
      syncStyles(pool);
      syncState(pool);
      drawnHigh = pool.highWater;
      if (pool.highWater === 0) return;
      const W = view.width;
      const H = view.height;
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.useProgram(prog);
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      const eye = view.eye ?? view.center;
      gl.uniform1f(U.persp, view.eye ? 1 : 0);
      gl.uniform3f(U.eye, eye[0], eye[1], eye[2]);
      gl.uniform1f(U.tan, Math.tan((view.fov ?? 1.0) / 2));
      gl.uniform2f(U.clip, view.near ?? 0.3, view.far ?? 90);
      gl.uniform1f(U.contract, view.contract ? 1 : 0);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4); // (the sprite renderer's depth range: the two share a depth buffer)
      gl.uniform1f(U.now, pool.time + ahead - base);
      gl.uniform1i(U.styles, 1);
      gl.uniform1i(U.palette, 2);
      gl.uniform1i(U.sprites, 3);
      for (let k = 0; k < 4; k += 1) gl.uniform1i(U.t[k]!, 4 + k);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, styleTex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, paletteTex);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, spriteTex);
      for (let k = 0; k < 4; k += 1) { gl.activeTexture(gl.TEXTURE4 + k); gl.bindTexture(gl.TEXTURE_2D, state[k]!); }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pool.highWater);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteProgram(prog);
      gl.deleteProgram(scatter);
      for (const b of [corners, rbuf]) gl.deleteBuffer(b);
      for (const t of [styleTex, paletteTex, spriteTex, ...state]) gl.deleteTexture(t);
      gl.deleteFramebuffer(fbo);
      gl.deleteVertexArray(vao);
      gl.deleteVertexArray(rvao);
    },
  };
}
