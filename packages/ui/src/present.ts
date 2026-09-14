// Getting the UI layer on screen. The UI composes its own pixel layer (the
// screen over a whole UI scale), so showing it is one of two small things:
//
//   createCanvasPresenter(canvas, ui)   a 2D canvas above the game's: the layer's changed rectangles are
//                                       put into it (putImageData), and the browser scales it up nearest-
//                                       neighbour (CSS image-rendering: pixelated) -- a static HUD puts
//                                       nothing and costs nothing.
//   createGlPresenter(gl, ui)           into the game's own WebGL2 context, after the game has drawn:
//                                       changed rectangles go up with texSubImage2D, and one textured quad
//                                       at the whole UI scale draws the layer -- one texture, one draw call.
//
// (Why not a keel/render pass: keel/render is the raymarched pixel renderer and bake draws the sprites; neither
// has a compositing hook, and the UI shouldn't need either loaded. A WebGL2 context is the seam: any game that
// draws with GL -- keel/render, bake's sprites, terrain -- hands its context to createGlPresenter.)

import { bytesOf } from "./bitmap.ts";
import type { Rect } from "./bitmap.ts";
import type { Ui } from "./ui.ts";

interface CanvasLike {
  width: number;
  height: number;
  style: { width: string; height: string; imageRendering: string };
  getContext(kind: "2d"): { putImageData(img: unknown, dx: number, dy: number, sx: number, sy: number, sw: number, sh: number): void; clearRect(x: number, y: number, w: number, h: number): void } | null;
}

export interface Presenter {
  /** Show what render() redrew (its rectangles); cheap when there are none. */
  present(rects: readonly Rect[]): void;
  /** Bytes uploaded so far (a benchmark reads it). */
  readonly uploaded: number;
}

/** A 2D canvas the size of the UI layer, scaled up by CSS. `dpr`: the device pixel ratio the UI's screen size was measured in. */
export function createCanvasPresenter(canvas: CanvasLike, ui: Ui, dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1): Presenter {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas.");
  let img: unknown = null;
  let layer = ui.layer;
  let uploaded = 0;
  const fit = () => {
    layer = ui.layer;
    canvas.width = layer.w; canvas.height = layer.h;
    canvas.style.width = `${(layer.w * ui.scale) / dpr}px`;
    canvas.style.height = `${(layer.h * ui.scale) / dpr}px`;
    canvas.style.imageRendering = "pixelated";
    const ID = (globalThis as unknown as { ImageData: new (d: Uint8ClampedArray, w: number, h: number) => unknown }).ImageData;
    img = new ID(bytesOf(layer), layer.w, layer.h);
  };
  fit();
  return {
    present(rects) {
      if (ui.layer !== layer) { fit(); rects = [{ x: 0, y: 0, w: layer.w, h: layer.h }]; }
      for (const r of rects) { ctx.putImageData(img, 0, 0, r.x, r.y, r.w, r.h); uploaded += r.w * r.h * 4; }
    },
    get uploaded() { return uploaded; },
  };
}

const VS = `#version 300 es
in vec2 p; uniform vec2 size; uniform vec2 view; out vec2 uv;
void main() { uv = p; vec2 px = p * size; gl_Position = vec4(px / view * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; }`;
const FS = `#version 300 es
precision mediump float; in vec2 uv; uniform sampler2D layer; out vec4 o;
void main() { o = texture(layer, uv); if (o.a < 0.5) discard; }`;

export interface GlPresenter extends Presenter {
  /** Draw the layer (call every frame, after the game's frame). */
  draw(): void;
  dispose(): void;
}

/** Draw the UI into a WebGL2 context: one texture, one quad, at the whole UI scale, top-left at (0, 0). */
export function createGlPresenter(gl: WebGL2RenderingContext, ui: Ui): GlPresenter {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const tex = gl.createTexture()!;
  const uSize = gl.getUniformLocation(prog, "size"), uView = gl.getUniformLocation(prog, "view"), uLayer = gl.getUniformLocation(prog, "layer");
  let layer = ui.layer;
  let uploaded = 0;
  const alloc = () => {
    layer = ui.layer;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, layer.w, layer.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(layer.px.buffer, layer.px.byteOffset, layer.px.byteLength));
    uploaded += layer.w * layer.h * 4;
  };
  alloc();
  return {
    present(rects) {
      if (ui.layer !== layer) { alloc(); return; }
      if (!rects.length) return;
      const bytes = new Uint8Array(layer.px.buffer, layer.px.byteOffset, layer.px.byteLength);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, layer.w);
      for (const r of rects) {
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        uploaded += r.w * r.h * 4;
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    },
    draw() {
      // (Only what it changes is put back: program, VAO, texture 0, viewport and blending.)
      const prevProg = gl.getParameter(gl.CURRENT_PROGRAM), prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING), prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const prevView = gl.getParameter(gl.VIEWPORT) as Int32Array, blend = gl.isEnabled(gl.BLEND), depth = gl.isEnabled(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uLayer, 0);
      gl.uniform2f(uSize, layer.w * ui.scale, layer.h * ui.scale);
      gl.uniform2f(uView, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(prevVao);
      gl.useProgram(prevProg);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.viewport(prevView[0]!, prevView[1]!, prevView[2]!, prevView[3]!);
      if (blend) gl.enable(gl.BLEND);
      if (depth) gl.enable(gl.DEPTH_TEST);
    },
    dispose() { gl.deleteTexture(tex); gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); gl.deleteProgram(prog); },
    get uploaded() { return uploaded; },
  };
}
