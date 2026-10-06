// The canonical indexed/height GPU pass, shared by the complete renderer and the small baking backend.
import { cameraBasis } from '@keel-engine/core/frame';
import type { Vec3Like } from '@keel-engine/core';
import { FAR, FULLSCREEN_VS } from './shaders.ts';
import { BAKE_WORLD_FS, HEIGHT_FS, INDEX_FS } from './indexed.ts';
import { program } from './program.ts';
import type { Program } from './program.ts';
import type { PixelRenderer } from './pixel-renderer.ts';
import type { WorldBlock } from './world-buffers.ts';
type WorldUniform = 'uRes' | 'uEye' | 'uFwd' | 'uRight' | 'uUp' | 'uTan' | 'uTime' | 'uBoxes' | 'uWedges' | 'uCaps' | 'uMats' | 'uSun' | 'uWaterY' | 'uFogNear' | 'uFogFar';
type IndexUniform = 'uData' | 'uData2' | 'uDepth' | 'uGap';
type HeightUniform = WorldUniform | 'uData' | 'uDepth' | 'uScale' | 'uEps' | 'uOrthoH';
export interface IndexedPassContext {
  readonly gl: WebGL2RenderingContext;
  readonly width: number; readonly height: number;
  readonly quad: WebGLBuffer | null;
  readonly fbo: WebGLFramebuffer | null;
  readonly dataTex: WebGLTexture | null; readonly data2Tex: WebGLTexture | null; readonly depthTex: WebGLTexture | null;
  readonly matTex: WebGLTexture;
  readonly blocks: readonly WorldBlock[];
  readonly counts: { readonly boxes: number; readonly wedges: number; readonly capsules: number };
}
const norm = (a: Vec3Like) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
interface IndexedTargets { world: Program<WorldUniform | "uSplit" | "uOrthoH">; index: Program<IndexUniform>; depth: Program<"uDepth"> | null; height: Program<HeightUniform> | null; fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }
export function createIndexedPass(env: IndexedPassContext, createDepth?: () => Program<"uDepth">) {
  const gl = env.gl;
  const nearest = () => {
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
  };
  // ---- bake mode (indexed.ts): compiled the first time a bake asks, so a normal frame's GL calls never change.

  let extra: IndexedTargets | null = null;
  function bakeMode(): IndexedTargets {
    if (!extra) {
      const bw = program<WorldUniform | "uSplit" | "uOrthoH">(gl, FULLSCREEN_VS, BAKE_WORLD_FS);
      (["Boxes", "Wedges", "Capsules"] as const).forEach((name, i) => gl.uniformBlockBinding(bw.p, gl.getUniformBlockIndex(bw.p, name), i));
      extra = { world: bw, index: program<IndexUniform>(gl, FULLSCREEN_VS, INDEX_FS), depth: createDepth?.() ?? null, height: null, fb: gl.createFramebuffer(), tex: gl.createTexture(), w: 0, h: 0 };
    }
    // (Its own picture, sized to the target: an RGBA8 texture the index and depth passes draw into.)
    if (extra.w !== env.width || extra.h !== env.height) {
      gl.bindTexture(gl.TEXTURE_2D, extra.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, env.width, env.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      nearest();
      gl.bindFramebuffer(gl.FRAMEBUFFER, extra.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, extra.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      extra.w = env.width; extra.h = env.height;
    }
    return extra;
  }
  // Draw a fullscreen pass with `prog` into `fb`, its textures bound first.
  function pass(prog: WebGLProgram, fb: WebGLFramebuffer | null, textures: ReadonlyArray<readonly [WebGLTexture | null, WebGLUniformLocation | null]>): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, env.width, env.height);
    gl.useProgram(prog);
    textures.forEach(([t, loc], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, i); });
    gl.bindBuffer(gl.ARRAY_BUFFER, env.quad);
    const a = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function readTarget(fb: WebGLFramebuffer | null, attachment: number): Uint8Array {
    const out = new Uint8Array(env.width * env.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (fb) gl.readBuffer(attachment);
    gl.readPixels(0, 0, env.width, env.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    if (fb) gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  const api: Pick<PixelRenderer, 'renderIndexed' | 'readIndexed' | 'renderIndexedHeights'> = {
    renderIndexed({ eye, target: look, fov = 1.2, time = 0, sun = [0.4, 0.8, 0.3], waterY = 0, fogNear = 25, fogFar = 110, gap = 0.56, split, ortho = 0 }) {
      const x = bakeMode();
      const { forward: fwd, right, up } = cameraBasis(eye, look);
      // Pass 1, as render()'s (no particles: a bake draws solids), with the surface coordinate.
      gl.bindFramebuffer(gl.FRAMEBUFFER, env.fbo);
      gl.viewport(0, 0, env.width, env.height);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const BW = x.world.loc; // (the bake world's uniforms: WORLD_FS's, and uSplit)
      gl.useProgram(x.world.p);
      gl.uniform2f(BW.uRes, env.width, env.height);
      gl.uniform3fv(BW.uEye, eye as unknown as Float32List); gl.uniform3fv(BW.uFwd, fwd); gl.uniform3fv(BW.uRight, right); gl.uniform3fv(BW.uUp, up);
      gl.uniform1f(BW.uTan, Math.tan(fov / 2)); gl.uniform1f(BW.uTime, time);
      gl.uniform1i(BW.uBoxes, env.counts.boxes); gl.uniform1i(BW.uWedges, env.counts.wedges); gl.uniform1i(BW.uCaps, env.counts.capsules);
      for (const blk of env.blocks) gl.bindBufferBase(gl.UNIFORM_BUFFER, blk.i, blk.buf);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, env.matTex); gl.uniform1i(BW.uMats, 1);
      gl.uniform3fv(BW.uSun, norm(sun));
      gl.uniform1f(BW.uWaterY, waterY); gl.uniform1f(BW.uFogNear, fogNear); gl.uniform1f(BW.uFogFar, fogFar);
      gl.uniform4f(BW.uSplit, split?.[0] ?? 0, split?.[1] ?? 0, split?.[2] ?? 0, split ? 1 : 0);
      gl.uniform1f(BW.uOrthoH, ortho);
      gl.bindBuffer(gl.ARRAY_BUFFER, env.quad);
      const aw = gl.getAttribLocation(x.world.p, "aPos");
      gl.enableVertexAttribArray(aw);
      gl.vertexAttribPointer(aw, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.DEPTH_TEST);
      // Pass 2: the index, into its own picture.
      gl.useProgram(x.index.p);
      gl.uniform1f(x.index.loc.uGap, gap / FAR);
      pass(x.index.p, x.fb, [[env.dataTex, x.index.loc.uData], [env.data2Tex, x.index.loc.uData2], [env.depthTex, x.index.loc.uDepth]]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return x.fb;
    },
    readIndexed() { return readTarget(bakeMode().fb, gl.COLOR_ATTACHMENT0); },
    renderIndexedHeights({ eye, target: look, fov = 1.2, pixelsPerMetre, eps = 0, ortho = 0 }) {
      const x = bakeMode();
      // (Compiled the first time a bake asks for heights: a bake without them never builds it. It marches the world's
      // solids again -- pass 1's uniform env.blocks, still bound.)
      if (!x.height) {
        x.height = program<HeightUniform>(gl, FULLSCREEN_VS, HEIGHT_FS);
        (["Boxes", "Wedges", "Capsules"] as const).forEach((name, i) => gl.uniformBlockBinding(x.height!.p, gl.getUniformBlockIndex(x.height!.p, name), i));
      }
      const hp = x.height;
      const { forward: fwd, right, up } = cameraBasis(eye, look);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(hp.p);
      const L = hp.loc;
      gl.uniform2f(L.uRes, env.width, env.height);
      gl.uniform3fv(L.uEye, eye as unknown as Float32List); gl.uniform3fv(L.uFwd, fwd); gl.uniform3fv(L.uRight, right); gl.uniform3fv(L.uUp, up);
      gl.uniform1f(L.uTan, Math.tan(fov / 2)); gl.uniform1f(L.uScale, pixelsPerMetre); gl.uniform1f(L.uEps, eps); gl.uniform1f(L.uOrthoH, ortho);
      gl.uniform1i(L.uBoxes, env.counts.boxes); gl.uniform1i(L.uWedges, env.counts.wedges); gl.uniform1i(L.uCaps, env.counts.capsules);
      for (const blk of env.blocks) gl.bindBufferBase(gl.UNIFORM_BUFFER, blk.i, blk.buf);
      pass(hp.p, x.fb, [[env.dataTex, L.uData], [env.depthTex, L.uDepth]]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return x.fb;
    },

  };
  return { ...api, mode: bakeMode, pass, readTarget,
    dispose() {
      if (!extra) return;
      for (const p of [extra.world, extra.index, extra.depth, extra.height]) if (p) gl.deleteProgram(p.p);
      gl.deleteTexture(extra.tex); gl.deleteFramebuffer(extra.fb); extra = null;
    },
  };
}
