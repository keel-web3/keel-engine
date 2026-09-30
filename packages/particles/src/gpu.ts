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
// closed-form motion (pool.ts motionAt, gpu-shaders.ts MOTION_GLSL) from each slot's
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
import { particleSpriteAtlas } from "./palette.ts";
import { PARTICLE_FS, PARTICLE_VS, SCATTER_FS, SCATTER_VS, STATE_WIDTH } from "./gpu-shaders.ts";
export { MOTION_GLSL, PARTICLE_FS, PARTICLE_VS, STATE_WIDTH } from "./gpu-shaders.ts";
const RECORD_FLOATS = 17; // slot, then the four texels
const BATCH = 16384;

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
