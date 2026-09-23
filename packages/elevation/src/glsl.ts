// The ground's height for a shader: the grid as a float texture and the GLSL
// that reads it -- `elevationAt(xz)`, bilinear exactly as the CPU's sample(),
// and `elevationMarch(ro, rd, t, far, grain)`, the same stepping as raycast() -- so a
// renderer draws the ground where the physics drives on it. Include
// ELEVATION_GLSL in a fragment shader and bind with bindElevation.

import type { Elevation } from "./grid.ts";

export const ELEVATION_GLSL = `
uniform highp sampler2D uElevation;   // metres, one float a cell
uniform vec4 uElevationInfo;          // x0, z0, cells a metre, 1 when there is ground shaping at all
uniform vec2 uElevationRange;         // the lowest and highest ground
uniform float uElevationSlope;        // the steepest rise between cells (m per m)
float elevationAt(vec2 xz) {
  if (uElevationInfo.w < 0.5) return 0.0;
  ivec2 size = textureSize(uElevation, 0);
  vec2 t = clamp((xz - uElevationInfo.xy) * uElevationInfo.z, vec2(0.0), vec2(size - 1));
  ivec2 i = min(ivec2(floor(t)), size - 2); vec2 f = t - vec2(i);
  float a = texelFetch(uElevation, i, 0).r, b = texelFetch(uElevation, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uElevation, i + ivec2(0, 1), 0).r, d = texelFetch(uElevation, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Distance along the ray to the ground, or -1 within far (see keel/elevation raycast). \`grain\`: how near counts as
// on it, per metre out -- a perspective picture's pixel there (tan(fov/2) / its height is half of one), so a ray
// skimming distant ground stops within a pixel of it rather than creeping on toward it; 0 finds the ground exactly.
float elevationMarch(vec3 ro, vec3 rd, float t, float far, float grain) {
  // (The slope bound is relaxed a little -- the steepest cell is rare, and a pixel-art ground forgives a centimetre;
  // only a ray past \`far\` misses.)
  float close = max(0.0, -rd.y) + 0.7 * uElevationSlope * length(rd.xz) + 1e-6, prev = t;
  for (int k = 0; k < 256; k++) {
    vec3 q = ro + rd * t;
    float h = q.y - elevationAt(q.xz);
    if (h < 0.0) {
      float lo = prev, hi = t;
      for (int r = 0; r < 7; r++) { float m = 0.5 * (lo + hi); vec3 w = ro + rd * m; if (w.y - elevationAt(w.xz) < 0.0) hi = m; else lo = m; }
      return hi;
    }
    if (h < grain * t) return t;
    if (t >= far) return -1.0;
    prev = t;
    t = min(far, t + max(0.08 + abs(t) * 0.004, h / close));
  }
  // (Out of steps and still over the ground, a long way out: it's met where the ground's height here would put it --
  // not in the air where the count ran out, in front of everything standing on the ground beyond.)
  vec3 q = ro + rd * t;
  return rd.y < -1e-4 ? min(far, t + (q.y - elevationAt(q.xz)) / -rd.y) : t;
}
`;

/** An elevation on the GPU. */
export interface ElevationTexture {
  readonly texture: WebGLTexture | null;
  readonly on: boolean;
  /** Set the uniforms (and bind the texture to `unit`) on the program in use. */
  bind(gl: WebGL2RenderingContext, program: WebGLProgram, unit: number): void;
  dispose(gl: WebGL2RenderingContext): void;
}

/** Upload an elevation (null: flat ground, no texture). */
export function uploadElevation(gl: WebGL2RenderingContext, e: Elevation | null): ElevationTexture {
  let texture: WebGLTexture | null = null;
  if (e) {
    texture = gl.createTexture();
    const was = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, e.grid.w, e.grid.h, 0, gl.RED, gl.FLOAT, e.grid.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(was);
  }
  const uniforms = new WeakMap<WebGLProgram, Record<string, WebGLUniformLocation | null>>();
  return {
    texture, on: !!e,
    bind(gl2, program, unit) {
      let u = uniforms.get(program);
      if (!u) uniforms.set(program, (u = Object.fromEntries(["uElevation", "uElevationInfo", "uElevationRange", "uElevationSlope"].map((n) => [n, gl2.getUniformLocation(program, n)]))));
      gl2.uniform4f(u.uElevationInfo!, e ? e.grid.x0 : 0, e ? e.grid.z0 : 0, e ? 1 / e.grid.cell : 1, e ? 1 : 0);
      gl2.uniform2f(u.uElevationRange!, e ? e.min : 0, e ? e.max : 0);
      gl2.uniform1f(u.uElevationSlope!, e ? e.slope : 0);
      if (texture) { gl2.activeTexture(gl2.TEXTURE0 + unit); gl2.bindTexture(gl2.TEXTURE_2D, texture); gl2.uniform1i(u.uElevation!, unit); }
    },
    dispose(gl2) { if (texture) gl2.deleteTexture(texture); },
  };
}
