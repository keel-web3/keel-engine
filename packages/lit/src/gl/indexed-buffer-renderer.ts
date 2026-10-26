// Ported from Three.js r180's renderers/webgl/WebGLIndexedBufferRenderer.js
// (MIT, see packages/lit/NOTICE): indexed draws, plain and instanced.
//
// Dropped, as keel/lit has no BatchedMesh: renderMultiDraw and
// renderMultiDrawInstances (WEBGL_multi_draw, or one instanced draw per range).

import type { Extensions } from "./extensions.ts";
import type { Info } from "./info.ts";

/** r180's WebGLIndexedBufferRenderer. */
export interface IndexedBufferRenderer {
  setMode(value: number): void;
  setIndex(value: { type: number; bytesPerElement: number }): void;
  render(start: number, count: number): void;
  renderInstances(start: number, count: number, primcount: number): void;
}

export function createIndexedBufferRenderer(gl: WebGL2RenderingContext, extensions: Extensions, info: Pick<Info, "update">): IndexedBufferRenderer {
  // (r180 reads extensions only for multi-draw)
  void extensions;

  let mode: number;

  function setMode(value: number): void {
    mode = value;
  }

  let type: number, bytesPerElement: number;

  function setIndex(value: { type: number; bytesPerElement: number }): void {
    type = value.type;
    bytesPerElement = value.bytesPerElement;
  }

  function render(start: number, count: number): void {
    gl.drawElements(mode, count, type, start * bytesPerElement);

    info.update(count, mode, 1);
  }

  function renderInstances(start: number, count: number, primcount: number): void {
    if (primcount === 0) return;

    gl.drawElementsInstanced(mode, count, type, start * bytesPerElement, primcount);

    info.update(count, mode, primcount);
  }

  // (r180: renderMultiDraw, renderMultiDrawInstances)

  return {
    setMode: setMode,
    setIndex: setIndex,
    render: render,
    renderInstances: renderInstances,
  };
}
