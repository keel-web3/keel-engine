// The ground on the GPU: chunk layers drawn as big quads, one texture each,
// texel for pixel (or scaled whole-texel while another scale's bake stands
// in). Each texel is a palette index and a depth: the shader looks the colour
// up (cycling ramps -- water, foam, lava -- rotate with time: palette
// cycling, no rebake) and writes the texel's depth by the sprite renderer's
// own formula, so units drawn after it (@keel-engine/bake drawLayers with
// clear: null) hide behind cliffs and stand in front of them per texel.
//
//   const ground = createGroundRenderer(sprites.gl);   // the sprite renderer's context
//   ground.setPalette(palette);
//   ground.draw(view, baker.layers(), { time, clear });
//   sprites.drawLayers(view, units, { clear: null });  // depth kept
//
// The depth formula is keel/bake's sprite shader's (depth = 0.5 + (P - centre)
// . forward / range, range = max(W, H) / k x 4): the two must agree (README
// "Integration").

import type { GroundPalette } from "./palette.ts";
import type { LayerToDraw } from "./ground-bake.ts";

/** The view as the sprite renderer's PixelView has it. */
export interface GroundDrawView {
  readonly center: readonly [number, number, number];
  readonly pixelsPerMetre: number;
  readonly width: number;
  readonly height: number;
  readonly axes: { readonly right: readonly [number, number, number]; readonly up: readonly [number, number, number]; readonly forward: readonly [number, number, number] };
}

export interface GroundRenderer {
  setPalette(p: GroundPalette): void;
  /** Draw the layers (depth-tested against each other), clearing colour and depth first unless `clear` is null. */
  draw(view: GroundDrawView, layers: readonly LayerToDraw[], opts?: { readonly time?: number; readonly clear?: readonly [number, number, number] | null }): void;
  /** Forget textures of keys not in `keep` (the baker's live layers). */
  prune(keep: ReadonlySet<string>): number;
  readonly stats: { readonly textures: number; readonly bytes: number; readonly draws: number };
}

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform vec2 uOrigin;    // the layer's top-left, picture pixels
uniform vec2 uSize;      // its size, picture pixels
uniform vec2 uPicture;
void main() {
  vec2 px = uOrigin + aCorner * uSize;
  gl_Position = vec4(px.x / uPicture.x * 2.0 - 1.0, 1.0 - px.y / uPicture.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uLayer;
uniform sampler2D uPalette;
uniform vec2 uPic0;            // picture pixel of global texel (0, 0) at this layer's scale (unrounded: shared by every layer)
uniform ivec2 uG0;             // the layer's top-left global texel
uniform vec2 uPicture;
uniform float uScale;          // picture pixels a texel
uniform float uDepthBase;      // (depthRef - centre . forward) / range + 0.5
uniform float uDepthStep;      // depthStep / range
uniform ivec4 uCycles[8];      // base, length, speed x 1000, 0
uniform int uCycleCount;
uniform float uTime;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uPicture.y - gl_FragCoord.y);
  // (The global texel under this pixel, by one mapping every layer shares -- a stand-in drawn at 1.5x has no seams
  // between chunks where their rounded corners disagreed -- then this layer's own, or nothing.)
  ivec2 tx = ivec2(floor((p - uPic0) / uScale)) - uG0;
  if (tx.x < 0 || tx.y < 0 || tx.x >= textureSize(uLayer, 0).x || tx.y >= textureSize(uLayer, 0).y) discard;
  uvec4 t = texelFetch(uLayer, tx, 0);
  int code = int(t.r) | (int(t.g) << 8);
  if (code == 0) discard;
  int idx = code - 1;
  for (int c = 0; c < 8; c += 1) {
    if (c >= uCycleCount) break;
    ivec4 cy = uCycles[c];
    if (idx >= cy.x && idx < cy.x + cy.y) { idx = cy.x + (idx - cy.x + int(floor(uTime * float(cy.z) / 1000.0))) % cy.y; break; }
  }
  outColor = vec4(texelFetch(uPalette, ivec2(idx % 1024, idx / 1024), 0).rgb, 1.0);
  float dc = float(int(t.b) | (int(t.a) << 8)) - 32768.0;
  gl_FragDepth = clamp(uDepthBase + dc * uDepthStep, 0.0, 1.0);
}`;

export function createGroundRenderer(gl: WebGL2RenderingContext): GroundRenderer {
  const sh = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Ground shader: ${gl.getShaderInfoLog(s) ?? "?"}`);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Ground program: ${gl.getProgramInfoLog(prog) ?? "?"}`);
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name);
  const U = { origin: u("uOrigin"), size: u("uSize"), pic0: u("uPic0"), g0: u("uG0"), picture: u("uPicture"), layer: u("uLayer"), palette: u("uPalette"), scale: u("uScale"), depthBase: u("uDepthBase"), depthStep: u("uDepthStep"), cycles: u("uCycles"), cycleCount: u("uCycleCount"), time: u("uTime") };
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  let paletteTex: WebGLTexture | null = null;
  let cycles = new Int32Array(32);
  let cycleCount = 0;
  const textures = new Map<string, { tex: WebGLTexture; bytes: number }>();
  let bytes = 0, draws = 0;

  const upload = (key: string, L: LayerToDraw["layer"]): WebGLTexture => {
    const have = textures.get(key);
    if (have) return have.tex;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, L.w, L.h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, L.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.set(key, { tex, bytes: L.data.byteLength });
    bytes += L.data.byteLength;
    return tex;
  };

  return {
    setPalette(p) {
      const rows = Math.ceil(p.colours.length / 1024);
      const px = new Uint8Array(1024 * rows * 4);
      p.colours.forEach((c, i) => { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; });
      if (paletteTex) gl.deleteTexture(paletteTex);
      paletteTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, paletteTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      cycles = new Int32Array(32);
      cycleCount = Math.min(8, p.cycles.length);
      p.cycles.slice(0, 8).forEach((c, i) => { cycles[i * 4] = c.base; cycles[i * 4 + 1] = c.length; cycles[i * 4 + 2] = Math.round(c.speed * 1000); });
    },
    draw(view, layers, { time = 0, clear = [0.05, 0.05, 0.07] } = {}) {
      if (!paletteTex) throw new Error("setPalette first.");
      const W = view.width, H = view.height, k = view.pixelsPerMetre;
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform2f(U.picture, W, H);
      gl.uniform4iv(U.cycles, cycles);
      gl.uniform1i(U.cycleCount, cycleCount);
      gl.uniform1f(U.time, time);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, paletteTex);
      gl.uniform1i(U.palette, 1);
      gl.uniform1i(U.layer, 0);
      const { right, up, forward } = view.axes;
      const c = view.center;
      const range = (Math.max(W, H) / k) * 4; // (keel/bake sprites.ts: uDepthRange)
      const cf = c[0] * forward[0] + c[1] * forward[1] + c[2] * forward[2];
      // The centre's global pixel at the view's scale (the picture's middle).
      const cgx = (c[0] * right[0] + c[1] * right[1] + c[2] * right[2]) * k;
      const cgy = -(c[0] * up[0] + c[1] * up[1] + c[2] * up[2]) * k;
      draws = 0;
      for (const d of layers) {
        const L = d.layer;
        const s = k / d.k;
        // (The picture pixel of global texel (0, 0) at this scale, as the sprite renderer places things -- unrounded;
        // the quad a pixel wider all round, the shader deciding each pixel's texel.)
        const px0 = Math.floor(-cgx + W / 2 + 0.5), py0 = Math.floor(-cgy + H / 2 + 0.5);
        const ox = Math.floor(L.gx0 * s + px0) - 1, oy = Math.floor(L.gy0 * s + py0) - 1;
        const sw = L.w * s + 2, shh = L.h * s + 2;
        if (ox > W || oy > H || ox + sw < 0 || oy + shh < 0) continue;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, upload(d.key, L));
        gl.uniform2f(U.origin, ox, oy);
        gl.uniform2f(U.size, sw, shh);
        gl.uniform1f(U.scale, s);
        gl.uniform2f(U.pic0, px0, py0);
        gl.uniform2i(U.g0, L.gx0, L.gy0);
        // (A stand-in drawn bigger than it was baked: each texel a block whose depth is its middle's -- half a texel row's
        // ground further back, so a sprite standing at the block's front edge isn't sunk into it.)
        const sp = -forward[1], cpv = Math.hypot(forward[0], forward[2]);
        const slack = s > 1 ? (0.5 * cpv) / (d.k * Math.max(0.1, sp)) : 0;
        gl.uniform1f(U.depthBase, 0.5 + (L.depthRef + slack - cf) / range);
        gl.uniform1f(U.depthStep, L.depthStep / range);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        draws += 1;
      }
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
    prune(keep) {
      let n = 0;
      for (const [key, v] of textures) if (!keep.has(key)) { gl.deleteTexture(v.tex); bytes -= v.bytes; textures.delete(key); n += 1; }
      return n;
    },
    get stats() { return { textures: textures.size, bytes, draws }; },
  };
}
