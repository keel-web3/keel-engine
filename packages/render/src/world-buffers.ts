// Canonical solid packing/uploader, reused by realtime and indexed-only renderers.
import { MAX_BOXES, MAX_WEDGES, MAX_CAPS } from './shaders.ts';
import type { RenderBox, RenderWedge, RenderWorld, WorldCounts } from './pixel-renderer.ts';
export interface WorldBlock { data: Float32Array; buf: WebGLBuffer; i: number }
export function uploadWorld(gl: WebGL2RenderingContext, blocks: readonly WorldBlock[], { boxes = [], wedges = [], capsules = [] }: RenderWorld): WorldCounts {
  const [boxBlock, wedgeBlock, capBlock] = blocks as [WorldBlock, WorldBlock, WorldBlock];
  let nBoxes = 0, nWedges = 0, nCaps = 0;
      const bx: RenderBox[] = [];
      const wd: RenderWedge[] = [...wedges];
      for (const b of boxes) (b.kind === "wedge" ? wd : bx).push(b);
      nBoxes = Math.min(MAX_BOXES, bx.length);
      for (let i = 0; i < nBoxes; i += 1) { const b = bx[i]!; boxBlock.data.set([b.c[0], b.c[1], b.c[2], b.mat ?? 0, b.h[0], b.h[1], b.h[2], b.yaw ?? 0], i * 8); }
      nWedges = Math.min(MAX_WEDGES, wd.length);
      for (let i = 0; i < nWedges; i += 1) { const w = wd[i]!; wedgeBlock.data.set([w.c[0], w.c[1], w.c[2], w.mat ?? 0, w.h[0], w.h[1], w.h[2], w.yaw ?? 0, Math.max(0, Math.min(0.98, w.lo ?? 0)), Math.max(0, w.skin ?? 0), Math.max(-1, Math.min(1, w.top?.[0] ?? -1)), Math.max(-1, Math.min(1, w.top?.[1] ?? 1))], i * 12); }
      nCaps = Math.min(MAX_CAPS, capsules.length);
      for (let i = 0; i < nCaps; i += 1) { const c = capsules[i]!; capBlock.data.set([c.a[0], c.a[1], c.a[2], c.r, c.b[0], c.b[1], c.b[2], c.mat ?? 0], i * 8); }
      // (Only the used parts go up: a few KB a frame.)
      for (const [blk, n] of [[boxBlock, nBoxes * 8], [wedgeBlock, nWedges * 12], [capBlock, nCaps * 8]] as const) {
        gl.bindBuffer(gl.UNIFORM_BUFFER, blk.buf);
        if (n) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, blk.data, 0, n);
      }
      return { boxes: nBoxes, wedges: nWedges, capsules: nCaps, dropped: bx.length - nBoxes + wd.length - nWedges + capsules.length - nCaps };
}
