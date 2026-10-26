// Ported from Three.js r180's renderers/webgl/WebGLBufferRenderer.js (MIT, see
// packages/lit/NOTICE): non-indexed draws, plain and instanced.
//
// Dropped, as keel/lit has no BatchedMesh: renderMultiDraw and
// renderMultiDrawInstances (WEBGL_multi_draw, or one instanced draw per range).

import type { Extensions } from "./extensions.ts";
import type { Info } from "./info.ts";

/** r180's WebGLBufferRenderer. */
export interface BufferRenderer {
  setMode(value: number): void;
  render(start: number, count: number): void;
  renderInstances(start: number, count: number, primcount: number): void;
}

export function createBufferRenderer(gl: WebGL2RenderingContext, extensions: Extensions, info: Pick<Info, "update">): BufferRenderer {
  // (r180 reads extensions only for multi-draw)
  void extensions;

  let mode: number;

  function setMode(value: number): void {
    mode = value;
  }

  function render(start: number, count: number): void {
    gl.drawArrays(mode, start, count);

    info.update(count, mode, 1);
  }

  function renderInstances(start: number, count: number, primcount: number): void {
    if (primcount === 0) return;

    gl.drawArraysInstanced(mode, start, count, primcount);

    info.update(count, mode, primcount);
  }

  // (r180: renderMultiDraw, renderMultiDrawInstances)

  return {
    setMode: setMode,
    render: render,
    renderInstances: renderInstances,
  };
}
