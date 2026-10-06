// Indexed sprite baking only: the same solid packing, shaders and passes as createPixelRenderer.
import { MAX_BOXES, MAX_WEDGES, MAX_CAPS, MAX_COLOURS, MAX_RAMPS, MAX_MATERIALS } from './shaders.ts';
import { createIndexedPass } from './indexed-pass.ts';
import { uploadWorld } from './world-buffers.ts';
import type { WorldBlock } from './world-buffers.ts';
import type { PixelRenderer, RenderCanvas } from './pixel-renderer.ts';

export type IndexedRenderer = Pick<PixelRenderer, 'gl' | 'width' | 'height' | 'limits' | 'setTarget' | 'setPalette' | 'setMaterials' | 'setWorld' | 'renderIndexed' | 'readIndexed' | 'renderIndexedHeights'> & { dispose(): void };

/** Include this backend when a game only needs indexed sprites, surface coordinates and height masks. */
export function createIndexedRenderer(canvas: RenderCanvas, { width = 128, height = 128 }: { width?: number; height?: number } = {}): IndexedRenderer {
  const ctx = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!ctx) throw new Error('WebGL2 is not available');
  const gl: WebGL2RenderingContext = ctx;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const nearest = () => {
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
  };
  const blocks: WorldBlock[] = ([['Boxes', 2 * MAX_BOXES], ['Wedges', 3 * MAX_WEDGES], ['Capsules', 2 * MAX_CAPS]] as const).map(([, vecs], i) => {
    const data = new Float32Array(vecs * 4), buf = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
    gl.bufferData(gl.UNIFORM_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    return { data, buf, i };
  });
  const matRows = new Float32Array(256 * 4), matTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, matTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 1, 0, gl.RGBA, gl.FLOAT, matRows);
  nearest();
  let W = width, H = height, fbo: WebGLFramebuffer | null = null;
  let dataTex: WebGLTexture | null = null, data2Tex: WebGLTexture | null = null, depthTex: WebGLTexture | null = null;
  let counts = { boxes: 0, wedges: 0, capsules: 0, dropped: 0 }, rampIndex = new Map<string, number>();
  function target(w: number, h: number) {
    W = w; H = h; canvas.width = W; canvas.height = H;
    for (const texture of [dataTex, data2Tex, depthTex]) if (texture) gl.deleteTexture(texture);
    if (fbo) gl.deleteFramebuffer(fbo);
    const rgba8 = () => {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); nearest(); return texture;
    };
    dataTex = rgba8(); data2Tex = rgba8(); depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, W, H, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null); nearest();
    fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dataTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, data2Tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  }
  const indexed = createIndexedPass({ gl, quad, matTex, blocks,
    get width() { return W; }, get height() { return H; },
    get fbo() { return fbo; }, get dataTex() { return dataTex; }, get data2Tex() { return data2Tex; }, get depthTex() { return depthTex; },
    get counts() { return counts; },
  });
  target(W, H);
  return {
    gl, get width() { return W; }, get height() { return H; },
    limits: { boxes: MAX_BOXES, wedges: MAX_WEDGES, capsules: MAX_CAPS, ramps: MAX_RAMPS, materials: MAX_MATERIALS, colours: MAX_COLOURS,
      fragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) },
    setTarget(w, h) {
      w = Math.max(8, w | 0); h = Math.max(8, h | 0);
      if (w !== W || h !== H || canvas.width !== w || canvas.height !== h) target(w, h);
    },
    setPalette(colours, ramps) {
      if (colours.length > MAX_COLOURS) throw new RangeError(`${colours.length} colours: at most ${MAX_COLOURS}`);
      const entries = Object.keys(ramps);
      if (entries.length > MAX_RAMPS) throw new RangeError(`${entries.length} ramps: at most ${MAX_RAMPS}`);
      rampIndex = new Map(entries.map((name, index) => [name, index]));
    },
    setMaterials(list) {
      if (list.length > MAX_MATERIALS) throw new RangeError(`${list.length} materials: at most ${MAX_MATERIALS}`);
      matRows.fill(0);
      list.forEach((m, i) => matRows.set([rampIndex.get(m.ramp) ?? 0, m.light ?? 1, m.pattern ?? 0, m.glow ?? 0], i * 4));
      gl.bindTexture(gl.TEXTURE_2D, matTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, matRows);
    },
    setWorld(world) { return counts = uploadWorld(gl, blocks, world); },
    renderIndexed: indexed.renderIndexed, readIndexed: indexed.readIndexed, renderIndexedHeights: indexed.renderIndexedHeights,
    dispose() {
      indexed.dispose();
      for (const block of blocks) gl.deleteBuffer(block.buf);
      gl.deleteBuffer(quad); gl.deleteTexture(matTex);
      for (const texture of [dataTex, data2Tex, depthTex]) if (texture) gl.deleteTexture(texture);
      if (fbo) gl.deleteFramebuffer(fbo);
    },
  };
}
