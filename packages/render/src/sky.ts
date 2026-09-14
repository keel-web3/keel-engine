// A pixel-art sky for perspective views (engine): a gradient from a pale
// horizon to a deeper zenith, and flat pixel clouds -- lit tops, shaded
// bellies -- on a cloud deck, each cloud texel a fixed patch of sky so they
// hold their shape as the camera turns (no crawling dither), drifting with
// time. Drawn from a raster hook after everything else (keel/render's
// RasterFrame.draw): only where pass 1 still shows the sky (depth 1), as
// DIRECT_MAT palette indices on one ramp -- the fog's ramp, so distant ground
// fades into the very colours the sky is made of.
//
//   const sky = createSkyPass(gl);
//   px.render({ ..., raster: { ..., draw: (ctx) => { ground.drawPerspective(ctx); sky.draw(ctx, { ramp: [base, len] }); } } });

import { DIRECT_MAT } from "./raster.ts";
import type { RasterContext } from "./raster.ts";

export interface SkyOptions {
  /** The sky's ramp: [base, length] in the palette (dark .. light, at most 15 long). */
  readonly ramp: readonly [number, number];
  /** Cloud cover 0..1 (default 0.45). */
  readonly cover?: number;
  /** Where the zenith sits on the ramp and where the horizon does (0..1; defaults 0.38, 0.86). */
  readonly zenith?: number;
  readonly horizon?: number;
  /** The cloud deck's height (m) and a cloud texel's size on it (m) -- bigger: chunkier clouds (defaults 90, 3). */
  readonly deck?: number;
  readonly texel?: number;
  /** Drift, m/s along x and z (default [2.2, 0.8]). */
  readonly wind?: readonly [number, number];
  readonly seed?: number;
}

export interface SkyPass {
  draw(ctx: RasterContext, opts: SkyOptions): void;
}

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos; gl_Position = vec4(aPos, 1.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform vec3 uEye, uFwd, uRight, uUp;
uniform float uTan, uAspect, uTime, uCover, uZenith, uHorizon, uDeck, uTexel;
uniform vec2 uWind;
uniform ivec2 uRamp;
uniform int uSeed;
layout(location = 0) out vec4 outData;
layout(location = 1) out vec4 outData2;
uint hashU(int x, int y, int s) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u) ^ (uint(s) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu; h ^= h >> 13u; h *= 0xc2b2ae35u; h ^= h >> 16u;
  return h;
}
float hash2(int x, int y, int s) { return float(hashU(x, y, s) >> 8u) / 16777216.0; }
float vnoise(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  return mix(mix(hash2(x, y, s), hash2(x + 1, y, s), f.x), mix(hash2(x, y + 1, s), hash2(x + 1, y + 1, s), f.x), f.y);
}
float fbm(vec2 p, int s) { return vnoise(p, s) * 0.55 + vnoise(p * 2.07 + 13.1, s + 7) * 0.3 + vnoise(p * 4.3 + 5.7, s + 13) * 0.15; }
float bayer4(ivec2 p) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
void main() {
  vec3 rd = normalize(uFwd + vUv.x * uTan * uAspect * uRight + vUv.y * uTan * uUp);
  float up = clamp(rd.y, -0.2, 1.0);
  int len = max(1, uRamp.y);
  // The gradient: pale at the horizon, deeper overhead (a little light under the horizon line too).
  float g = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  // Clouds on a deck: a cloud texel is a fixed patch of it, so a cloud keeps its pixels as the camera turns.
  float shade = -1.0;
  ivec2 cell = ivec2(0);
  if (rd.y > 0.02) {
    vec2 p = (uEye.xz + rd.xz / rd.y * (uDeck - uEye.y) + uWind * uTime) / uTexel;
    cell = ivec2(floor(p));
    vec2 c = (vec2(cell) + 0.5) * 0.045;
    float n = fbm(c, uSeed);
    float edge = 1.0 - uCover;
    if (n > edge) {
      // (Lit on top, shaded below: the texel toward the sun side of the cloud's own noise is brighter.)
      float below = fbm(c + vec2(0.0, -0.09), uSeed);
      shade = n - below > 0.0 ? 1.0 : n > edge + 0.07 ? 0.78 : 0.62;
      // (Far clouds thin toward the horizon into the haze.)
      if (rd.y < 0.12 && bayer4(cell) > (rd.y - 0.02) / 0.1) shade = -1.0;
    }
  }
  float x = (shade >= 0.0 ? mix(g, 1.0, shade * 0.9) : g) * float(len - 1);
  // (The gradient's steps are broken by a screen anchored to the SKY -- the cloud deck's texels -- not the glass.)
  ivec2 sp = rd.y > 0.02 ? cell : ivec2(gl_FragCoord.xy);
  if (shade < 0.0) x += (bayer4(sp) - 0.5) * 0.9;
  int pos = clamp(int(floor(x + 0.5)), 0, len - 1);
  int idx = uRamp.x + pos;
  outData = vec4(float(idx & 255) / 255.0, float((idx >> 8) & 255) / 255.0, float(${DIRECT_MAT}) / 255.0, 1.0);
  outData2 = vec4(0.0, 1.0, float(pos) / float(max(1, len - 1)), float(pos | (min(len, 15) << 4)) / 255.0);
}`;

/** The sky pass (compiled once; draws one full-screen triangle behind everything). */
export function createSkyPass(gl: WebGL2RenderingContext): SkyPass {
  const sh = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Sky: ${gl.getShaderInfoLog(s) ?? "?"}`);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Sky: ${gl.getProgramInfoLog(prog) ?? "?"}`);
  const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return {
    draw(ctx, o) {
      gl.useProgram(prog);
      // (Only where nothing nearer was drawn: the depth pass 1 leaves for the sky is 1.)
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.uniform3f(u("uEye"), ctx.eye[0], ctx.eye[1], ctx.eye[2]);
      gl.uniform3f(u("uFwd"), ctx.forward[0], ctx.forward[1], ctx.forward[2]);
      gl.uniform3f(u("uRight"), ctx.right[0], ctx.right[1], ctx.right[2]);
      gl.uniform3f(u("uUp"), ctx.up[0], ctx.up[1], ctx.up[2]);
      gl.uniform1f(u("uTan"), ctx.tan);
      gl.uniform1f(u("uAspect"), ctx.width / ctx.height);
      gl.uniform1f(u("uTime"), ctx.time);
      gl.uniform1f(u("uCover"), o.cover ?? 0.45);
      gl.uniform1f(u("uZenith"), o.zenith ?? 0.38);
      gl.uniform1f(u("uHorizon"), o.horizon ?? 0.86);
      gl.uniform1f(u("uDeck"), o.deck ?? 90);
      gl.uniform1f(u("uTexel"), o.texel ?? 3);
      gl.uniform2f(u("uWind"), o.wind?.[0] ?? 2.2, o.wind?.[1] ?? 0.8);
      gl.uniform2i(u("uRamp"), o.ramp[0], o.ramp[1]);
      gl.uniform1i(u("uSeed"), o.seed ?? 7);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.depthMask(true);
    },
  };
}
