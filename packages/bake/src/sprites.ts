// The sprite renderer: every visible sprite in one instanced draw. Baked
// sprites live in a texture array (one layer per atlas page); each instance
// is a world position, an atlas rectangle, its anchor and a layer; the vertex
// shader projects the position through the pixel view and snaps the quad to
// whole pixels, so sprites land texel for pixel; depth comes from the
// position (nearer the camera draws over), so there is no sorting on the CPU.
// Draw at the target resolution into the canvas; the page scales it up
// nearest-neighbour.
//
// drawLayers() is the same draw for INDEXED sprites (indexed.ts): each
// instance names a look (looks.ts), and the fragment shader turns a texel's
// slot, shade and surface coordinate into a palette entry through it -- the
// finish, the pattern, a screen-anchored dither, the outline. One baked shape,
// any number of looks, still one instanced draw (plain RGBA sprites ride
// along with look -1). An instance's depth bias puts an attribute a hair in
// front of its own body, or behind it.
//
//   const sr = createSpriteRenderer(canvas, { width, height, capacity: 8192 });
//   sr.setPages(pages);                    // [{ width, height, rgba }] -- the baked atlas
//   sr.draw(view, instances, count);       // instances: a SpriteInstances buffer you fill each frame

import type { PixelView } from "./view.ts";
import { PALETTE_ROW } from "./looks.ts";
import { SWAY_INSTANCE_FLOATS, SWAY_VS } from "./sway.ts";
import { depthKappa } from "./depth.ts";
import { LAYER_FS } from "./paint-shader.ts";
import { createMeshPass } from "./draw-mesh.ts";
import type { MeshPass, MeshStats } from "./draw-mesh.ts";
import type { Projection } from "./project.ts";
import { projectionOf, shotOfView } from "./project.ts";
import type { SwayInstances, WindStyle } from "./sway.ts";
import { MESH_GFS, MESH_LIGHTS, MESH_SHADOW_FS, MESH_VS } from "./mesh.ts";
import { VOLUME_FLOATS, VOLUME_FS, VOLUME_VS } from "./volumes.ts";
import type { VolumeInstances, VolumeStyle } from "./volumes.ts";
import type { LookMesh } from "./mesh.ts";
import { BILLBOARD_FS, BILLBOARD_VS, FS, FX_FS, FX_VS, LAYER_VS, SWAY_FS, VS } from "./sprite-shaders.ts";
import type { AtlasPage, BillboardCamera, BillboardStyle, LayerStyle, LookTextures, MeshDraw, MeshStyle } from "./sprite-shaders.ts";
export type { AtlasPage, BillboardCamera, BillboardStyle, LayerStyle, LookTextures, MeshDraw, MeshFog, MeshGBuffer, MeshLight, MeshStyle, MeshWeather } from "./sprite-shaders.ts";

/** Floats per instance: x, y, z, u0, v0, w, h (atlas pixels), ax, ay (anchor, pixels from the sprite's top-left), layer, flags, scale. */
export const INSTANCE_FLOATS = 12;

export class SpriteInstances {
  readonly capacity: number;
  readonly data: Float32Array;
  count = 0;
  constructor(capacity: number) { this.capacity = capacity; this.data = new Float32Array(capacity * INSTANCE_FLOATS); }
  /**
   * Add one: world position, atlas rect, anchor, page layer. `scale` draws it bigger or smaller (texels
   * per picture pixel; 1 is texel for pixel -- a bake made at another scale shows at its right size
   * while the new one bakes). Returns false when full.
   */
  push(x: number, y: number, z: number, u0: number, v0: number, w: number, h: number, ax: number, ay: number, layer: number, flags = 0, scale = 1): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count * INSTANCE_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u0; d[o + 4] = v0; d[o + 5] = w; d[o + 6] = h; d[o + 7] = ax; d[o + 8] = ay; d[o + 9] = layer; d[o + 10] = flags; d[o + 11] = scale;
    this.count += 1;
    return true;
  }
  clear(): void { this.count = 0; }
}

/**
 * Floats per LAYER instance (drawLayers): x, y, z, u0, v0, w, h, ax, ay, layer, look, bias, scale, spare. `look` is
 * the look table's index for an indexed sprite (-1: the texels are plain RGBA, as draw() takes them); `bias` is how
 * far (metres) its texels sit from its position's depth: those behind its split point that far behind, the rest that
 * far in front -- an attribute on its own body (0 for a body).
 */
export const LAYER_INSTANCE_FLOATS = 14;

export class LayerInstances {
  readonly capacity: number;
  readonly data: Float32Array;
  count = 0;
  constructor(capacity: number) { this.capacity = capacity; this.data = new Float32Array(capacity * LAYER_INSTANCE_FLOATS); }
  /** Add one: world position, atlas rect, anchor, page layer, look (-1 plain), depth bias (m, see above), scale. Returns false when full. */
  push(x: number, y: number, z: number, u0: number, v0: number, w: number, h: number, ax: number, ay: number, layer: number, look: number, bias = 0, scale = 1): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count * LAYER_INSTANCE_FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u0; d[o + 4] = v0; d[o + 5] = w; d[o + 6] = h; d[o + 7] = ax; d[o + 8] = ay; d[o + 9] = layer; d[o + 10] = look; d[o + 11] = bias; d[o + 12] = scale; d[o + 13] = 0;
    this.count += 1;
    return true;
  }
  clear(): void { this.count = 0; }
}

export interface SpriteRenderer {
  /**
   * Engine, the default for a 3D game: a real 3D object -- a design's solids as one mesh (lookMesh) -- kept on the GPU
   * under a key (null removes it). Drawn by drawMeshes at any position, heading and pose, every frame, no bake.
   */
  setMesh(key: string, mesh: LookMesh | null): void;
  /**
   * Engine: smoke, fire, dust and nitro as SHADER volumes (volumes.ts) -- each puff a ball marched through animated
   * noise, lit, and cut to the palette through the dither screen. Depth-tested against what's drawn, so what stands in
   * front of a cloud stays in front of it. Never clears.
   */
  drawVolumes(view: PixelView | Projection, volumes: VolumeInstances, style?: VolumeStyle): void;
  /**
   * Draw live meshes through their looks: pass 1 rasterises them (lit by the sun and the lights) into a G-buffer, pass 2
   * paints every pixel through the look table exactly as drawLayers paints an indexed texel -- outlines between parts,
   * depth in the layers' convention, so they sort with sprites, ground and particles. Never clears (style.clear aside).
   */
  drawMeshes(view: PixelView | Projection, draws: readonly MeshDraw[], style?: MeshStyle): void;
  /** What the last mesh frame cost: meshes held, drawn, culled, triangles. */
  readonly meshStats: MeshStats;

  setPages(pages: readonly AtlasPage[]): void;
  /**
   * A live atlas (a streaming bake's): at least `count` pages of `size`² -- grown on the GPU, what's on them kept --
   * that writeSprite() fills a sprite at a time. (Replaces pages setPages gave.)
   */
  reservePages(count: number, size: number, options?: { readonly heights?: boolean }): void;
  /** Put one sprite's texels on a reserved page (and its heights: depth sprites, pages reserved with heights). */
  writeSprite(page: number, x: number, y: number, w: number, h: number, rgba: Uint8Array, heights?: Uint8Array): void;
  /** Depth sprites: whether the pages carry heights, and the bytes they take on the GPU (the height planes alone). */
  readonly heightBytes: number;
  /** Layers the page texture has now. */
  readonly pageCount: number;
  setTarget(width: number, height: number): void;
  /** Draw into a smaller region of the bound target without resizing the canvas; restores renderer dimensions. */
  withTargetSize<T>(width: number, height: number, draw: () => T): T;
  /** Draw `instances.count` sprites through `view`; clears to `clear` first (RGB 0..1) unless null. */
  draw(view: PixelView, instances: SpriteInstances, clear?: readonly [number, number, number] | null): void;
  /** The look table's textures (a LookTable's palette() and texture()): what drawLayers paints indexed sprites with. */
  setLooks(textures: LookTextures): void;
  /** Draw layer instances (indexed sprites through their looks, plain ones alongside): one instanced draw. */
  drawLayers(view: PixelView, instances: LayerInstances, style?: LayerStyle): void;
  /**
   * Engine: the same layers through a perspective camera (see BILLBOARD_VS): anchors projected, sprites at their
   * instance's scale, depth by distance over `far`, the spare float a dissolve. Never clears: it draws over (and is
   * hidden by) what's there.
   */
  drawBillboards(camera: BillboardCamera, instances: LayerInstances, style?: BillboardStyle): void;
  /**
   * Layers that sway in the wind (sway.ts): drawLayers' instances plus a packed sway and a lean each -- texel rows
   * shifted by whole pixels, gust waves across the map, benders pushing what's near them. One instanced draw.
   */
  drawSway(view: PixelView, instances: SwayInstances, style?: LayerStyle & WindStyle): void;
  /**
   * drawLayers with per-instance effects (fx.ts): each instance's spare float is packFx(flash, dissolve) -- a hit's
   * flash up the ramps, a death's or a warp-in's dissolve. 0 draws exactly as drawLayers. One instanced draw.
   */
  drawLayersFx(view: PixelView, instances: LayerInstances, style?: LayerStyle): void;
  readonly gl: WebGL2RenderingContext;
}

export function createSpriteRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, { width, height, capacity = 8192 }: { width: number; height: number; capacity?: number }): SpriteRenderer {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("WebGL2 isn't available.");
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Sprite shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Sprite program: ${gl.getProgramInfoLog(prog)}`);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const U = { center: u("uCenter"), right: u("uRight"), up: u("uUp"), forward: u("uForward"), k: u("uK"), size: u("uSize"), depth: u("uDepthRange"), pages: u("uPages") };

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
  const stride = INSTANCE_FLOATS * 4;
  const attrib = (loc: number, size: number, offset: number) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    gl.vertexAttribDivisor(loc, 1);
  };
  attrib(1, 3, 0); attrib(2, 4, 3); attrib(3, 2, 7); attrib(4, 3, 9);
  gl.bindVertexArray(null);

  // The layer program and its buffers: built the first time drawLayers or setLooks is called.
  type LayerUniform = "center" | "right" | "up" | "forward" | "k" | "size" | "depth" | "pages" | "looks" | "paints" | "palette" | "places" | "decals" | "anchorDither" | "screen" | "dither" | "outline" | "heights" | "heightOn" | "ds" | "ids" | "idBase";
  interface Layers { prog: WebGLProgram; u: Record<LayerUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number; palette: WebGLTexture | null; looks: WebGLTexture | null; paints: WebGLTexture | null; places: WebGLTexture | null; decals: WebGLTexture | null }
  let layerState: Layers | null = null;
  const layers = (): Layers => {
    if (layerState) return layerState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, LAYER_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, LAYER_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Layer program: ${gl.getProgramInfoLog(p)}`);
    const lu = (name: string) => gl.getUniformLocation(p, name);
    const u = { center: lu("uCenter"), right: lu("uRight"), up: lu("uUp"), forward: lu("uForward"), k: lu("uK"), size: lu("uSize"), depth: lu("uDepthRange"), pages: lu("uPages"), looks: lu("uLooks"), paints: lu("uPaints"), palette: lu("uPalette"), places: lu("uPlaces"), anchorDither: lu("uDitherAnchor"), decals: lu("uDecals"), screen: lu("uScreen"), dither: lu("uDither"), outline: lu("uOutline"), heights: lu("uHeights"), heightOn: lu("uHeightOn"), ds: lu("uDS"), ids: lu("uIds"), idBase: lu("uIdBase") };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = LAYER_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9);
    gl.bindVertexArray(null);
    layerState = { prog: p, u, vao: v, inst: b, capacity, palette: null, looks: null, paints: null, places: null, decals: null };
    return layerState;
  };

  // The billboard program: built the first time drawBillboards is called (it shares the layer program's textures).
  type BoardUniform = "eye" | "right" | "up" | "forward" | "tan" | "aspect" | "far" | "lift" | "contract" | "size" | "pages" | "looks" | "paints" | "palette" | "places" | "decals" | "screen" | "dither" | "outline";
  let boardState: { prog: WebGLProgram; u: Record<BoardUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number } | null = null;
  const boards = () => {
    if (boardState) return boardState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, BILLBOARD_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, BILLBOARD_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Billboard program: ${gl.getProgramInfoLog(p)}`);
    const bu = (name: string) => gl.getUniformLocation(p, name);
    const u = { eye: bu("uEye"), right: bu("uRight"), up: bu("uUp"), forward: bu("uForward"), tan: bu("uTan"), aspect: bu("uAspect"), far: bu("uFar"), lift: bu("uLift"), contract: bu("uContract"), size: bu("uSize"), pages: bu("uPages"), looks: bu("uLooks"), paints: bu("uPaints"), palette: bu("uPalette"), places: bu("uPlaces"), decals: bu("uDecals"), screen: bu("uScreen"), dither: bu("uDither"), outline: bu("uOutline") };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = LAYER_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9); at(5, 1, 13);
    gl.bindVertexArray(null);
    boardState = { prog: p, u, vao: v, inst: b, capacity };
    return boardState;
  };

  // The sway program: built the first time drawSway is called (it shares the layer program's textures).
  type SwayUniform = "center" | "right" | "up" | "forward" | "k" | "size" | "depth" | "pages" | "looks" | "paints" | "palette" | "places" | "decals" | "anchorDither" | "screen" | "dither" | "outline" | "time" | "wind" | "bend" | "bendCount" | "heights" | "heightOn" | "ds" | "ids" | "idBase";
  let swayState: { prog: WebGLProgram; u: Record<SwayUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number } | null = null;
  const sways = () => {
    if (swayState) return swayState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, SWAY_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, SWAY_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Sway program: ${gl.getProgramInfoLog(p)}`);
    const su = (name: string) => gl.getUniformLocation(p, name);
    const u = {
      center: su("uCenter"), right: su("uRight"), up: su("uUp"), forward: su("uForward"), k: su("uK"), size: su("uSize"), depth: su("uDepthRange"), pages: su("uPages"), looks: su("uLooks"), paints: su("uPaints"), palette: su("uPalette"), places: su("uPlaces"), anchorDither: su("uDitherAnchor"), decals: su("uDecals"),
      screen: su("uScreen"), dither: su("uDither"), outline: su("uOutline"), time: su("uTime"), wind: su("uWind"), bend: su("uBend"), bendCount: su("uBendCount"),
      heights: su("uHeights"), heightOn: su("uHeightOn"), ds: su("uDS"), ids: su("uIds"), idBase: su("uIdBase"),
    };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * SWAY_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = SWAY_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9); at(5, 2, 14);
    gl.bindVertexArray(null);
    swayState = { prog: p, u, vao: v, inst: b, capacity };
    return swayState;
  };

  // The fx program: built the first time drawLayersFx is called (it shares the layer program's textures).
  let fxState: { prog: WebGLProgram; u: Record<LayerUniform, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number } | null = null;
  const fxs = () => {
    if (fxState) return fxState;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, FX_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FX_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Fx program: ${gl.getProgramInfoLog(p)}`);
    const fu = (name: string) => gl.getUniformLocation(p, name);
    const u = { center: fu("uCenter"), right: fu("uRight"), up: fu("uUp"), forward: fu("uForward"), k: fu("uK"), size: fu("uSize"), depth: fu("uDepthRange"), pages: fu("uPages"), looks: fu("uLooks"), paints: fu("uPaints"), palette: fu("uPalette"), places: fu("uPlaces"), anchorDither: fu("uDitherAnchor"), decals: fu("uDecals"), screen: fu("uScreen"), dither: fu("uDither"), outline: fu("uOutline"), heights: fu("uHeights"), heightOn: fu("uHeightOn"), ds: fu("uDS"), ids: fu("uIds"), idBase: fu("uIdBase") };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = LAYER_INSTANCE_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 3, 0); at(2, 4, 3); at(3, 2, 7); at(4, 4, 9); at(5, 1, 13);
    gl.bindVertexArray(null);
    fxState = { prog: p, u, vao: v, inst: b, capacity };
    return fxState;
  };

  let tex: WebGLTexture | null = null;
  let texLayers = 0, texSize = 0, live = false;
  // Depth sprites: the pages' height planes, an RG8 array beside the pages (null: no heights -- every draw as before).
  let htex: WebGLTexture | null = null, hW = 0, hH = 0;
  const heightArray = (w: number, h: number, layers: number): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, w, h, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };
  // The depth-sprite uniforms of a layer draw: on when the pages carry heights (and the style doesn't turn them off).
  const depthSprites = (U: { heights: WebGLUniformLocation | null; heightOn: WebGLUniformLocation | null; ds: WebGLUniformLocation | null; ids: WebGLUniformLocation | null; idBase: WebGLUniformLocation | null }, view: PixelView, style: LayerStyle): void => {
    const on = !!htex && style.heights !== false;
    gl.uniform1i(U.ids, style.ids ? 1 : 0); gl.uniform1i(U.idBase, style.idBase ?? 0);
    gl.uniform1i(U.heightOn, on ? 1 : 0);
    const cp = view.axes.up[1], sp = -view.axes.forward[1];
    gl.uniform4f(U.ds, cp, sp, depthKappa(style.depth ?? "ground", cp), style.tie ?? 0.005);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, on ? htex : null); gl.uniform1i(U.heights, 4);
    gl.activeTexture(gl.TEXTURE0);
  };
  /** Link a program the renderer's own way, so a shader error reads the same wherever it came from. */
  const link = (vs: string, fs: string, what: string): WebGLProgram => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${what} program: ${gl.getProgramInfoLog(p)}`);
    return p;
  };

  // The live mesh pass (draw-mesh.ts): made the first time a mesh is set or drawn; it shares the look textures.
  let meshState2: MeshPass | null = null;
  const meshPass = (): MeshPass => (meshState2 ??= createMeshPass({
    gl,
    link,
    looks: () => { const L = layers(); return { palette: L.palette, looks: L.looks, paints: L.paints, places: L.places, decals: L.decals }; },
    size: () => [W, H] as const,
    pages: () => [tex, htex] as const,
  }));

  // The volume program (volumes.ts): built the first time drawVolumes is called.
  type VolU = "center" | "right" | "up" | "forward" | "sun" | "k" | "depth" | "tie" | "size" | "ground" | "time" | "density" | "screen" | "steps" | "palette" | "paletteRow" | "persp" | "proj" | "tanH";
  let volState: { prog: WebGLProgram; u: Record<VolU, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject; inst: WebGLBuffer; capacity: number } | null = null;
  const vols = () => {
    if (volState) return volState;
    const p = link(VOLUME_VS, VOLUME_FS, "Volume");
    const q = (n: string) => gl.getUniformLocation(p, n);
    const u = { center: q("uCenter"), right: q("uRight"), up: q("uUp"), forward: q("uForward"), sun: q("uSun"), k: q("uK"), depth: q("uDepthRange"), tie: q("uTie"), size: q("uSize"), ground: q("uGround"), time: q("uTime"), density: q("uDensity"), screen: q("uScreen"), steps: q("uSteps"), palette: q("uPalette"), paletteRow: q("uPaletteRow"), persp: q("uPersp"), proj: q("uProj"), tanH: q("uTanH") };
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, 512 * VOLUME_FLOATS * 4, gl.DYNAMIC_DRAW);
    const st = VOLUME_FLOATS * 4;
    const at = (loc: number, size: number, offset: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, offset * 4); gl.vertexAttribDivisor(loc, 1); };
    at(1, 4, 0); at(2, 4, 4); at(3, 2, 8);
    gl.bindVertexArray(null);
    volState = { prog: p, u, vao: v, inst: b, capacity: 512 };
    return volState;
  };

  let W = width;
  let H = height;
  const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  const api: SpriteRenderer = {
    gl,
    get pageCount() { return texLayers; },
    get heightBytes() { return htex ? hW * hH * texLayers * 2 : 0; },
    reservePages(count, size, options = {}) {
      if (live && tex && texSize === size && texLayers >= count && (!options.heights || htex)) return;
      // (Grow by doubling, up to what the GPU allows: each growth copies the old layers across on the GPU.)
      const layers = Math.min(maxLayers, Math.max(count, live && texSize === size ? texLayers * 2 : count));
      if (layers < count) throw new RangeError(`${count} atlas pages: this GPU allows ${maxLayers}.`);
      const next = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, next);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (tex && live && texSize === size) {
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
        for (let i = 0; i < texLayers; i += 1) {
          gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, i);
          gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 0, 0, size, size);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
      }
      if (options.heights || htex) {
        // (The height planes grow with the pages, copied across the same way.)
        const hn = heightArray(size, size, layers);
        if (htex && hW === size && hH === size) {
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
          for (let i = 0; i < texLayers; i += 1) {
            gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, htex, 0, i);
            gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 0, 0, size, size);
          }
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.deleteFramebuffer(fb);
        }
        if (htex) gl.deleteTexture(htex);
        htex = hn; hW = size; hH = size;
      }
      if (tex) gl.deleteTexture(tex);
      tex = next; texLayers = layers; texSize = size; live = true;
    },
    writeSprite(page, x, y, w, h, rgba, heights) {
      if (!tex || !live) throw new Error("reservePages first.");
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, page, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      if (htex) {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, htex);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, page, w, h, 1, gl.RG, gl.UNSIGNED_BYTE, heights ?? new Uint8Array(w * h * 2));
      }
    },
    setPages(pages) {
      live = false;
      if (!pages.length) throw new Error("No atlas pages.");
      const pw = Math.max(...pages.map((p) => p.width));
      const ph = Math.max(...pages.map((p) => p.height));
      if (tex) gl.deleteTexture(tex);
      tex = gl.createTexture();
      texLayers = pages.length; texSize = Math.max(pw, ph);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, pw, ph, pages.length);
      pages.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.rgba));
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (htex) { gl.deleteTexture(htex); htex = null; }
      if (pages.some((p) => p.heights)) {
        htex = heightArray(pw, ph, pages.length); hW = pw; hH = ph;
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        pages.forEach((p, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, gl.RG, gl.UNSIGNED_BYTE, p.heights ?? new Uint8Array(p.width * p.height * 2)));
      }
    },
    setTarget(w, h) { W = w; H = h; canvas.width = w; canvas.height = h; },
    withTargetSize(w, h, draw) {
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new RangeError("Invalid render size");
      const oldW = W, oldH = H;
      W = w; H = h;
      try { return draw(); }
      finally { W = oldW; H = oldH; gl.viewport(0, 0, W, H); }
    },
    draw(view, instances, clear = [0.05, 0.05, 0.07]) {
      if (!tex) throw new Error("setPages first.");
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } else gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.uniform1i(U.pages, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * INSTANCE_FLOATS);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    setLooks({ palette, paints, looks, places, decals }) {
      const L = layers();
      gl.activeTexture(gl.TEXTURE1);
      if (L.palette) gl.deleteTexture(L.palette);
      L.palette = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, L.palette);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, palette.width, palette.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const uint = (unit: number, old: WebGLTexture | null, t: { width: number; height: number; data: Uint32Array }): WebGLTexture => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        if (old) gl.deleteTexture(old);
        const tx = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, t.width, t.height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, t.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return tx;
      };
      L.looks = uint(2, L.looks, looks);
      L.paints = uint(3, L.paints, paints);
      // (No decals: a placement and a decal texel of nothing, so the samplers are always complete.)
      L.places = uint(5, L.places, places ?? { width: 4, height: 1, data: new Uint32Array(16) });
      gl.activeTexture(gl.TEXTURE6);
      if (L.decals) gl.deleteTexture(L.decals);
      L.decals = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, L.decals);
      const d = decals ?? { width: 1, height: 1, rgba: new Uint8Array(4) };
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, d.width, d.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, d.rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.activeTexture(gl.TEXTURE0);
    },
    setMesh(key, mesh) { meshPass().setMesh(key, mesh); },
    drawMeshes(view, draws, style = {}) { meshPass().draw(view, draws, style); },
    get meshStats() { return meshPass().stats; },
    drawVolumes(view, volumes, style = {}) {
      if (!volumes.count) return;
      const L = layers();
      if (!L.palette) throw new Error("setLooks first.");
      const V = vols();
      // (A pixel view, or a projection -- the chase or hood cam -- through the same depth contract as the meshes.)
      const proj: Projection = "clip" in view ? view : projectionOf(shotOfView(view), W, H, Math.max(W, H) / view.pixelsPerMetre * 4);
      const persp = proj.kind === "persp";
      const { right, up, forward } = proj, ctr = proj.origin, k = proj.k;
      const range = proj.depthRange;
      const viewYaw = "clip" in view ? Math.atan2(forward[0], forward[2]) : view.yaw;
      const s0 = style.sun ?? (() => { const sy = Math.sin(viewYaw), cy = Math.cos(viewYaw); const sv = [-0.5, 0.75, 0.45]; return [right[0] * sv[0]! - sy * sv[2]!, sv[1]!, right[2] * sv[0]! - cy * sv[2]!] as const; })();
      const sl = Math.hypot(s0[0], s0[1], s0[2]) || 1;
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.CULL_FACE);
      gl.useProgram(V.prog);
      const U = V.u;
      gl.uniform3f(U.center, ctr[0], ctr[1], ctr[2]);
      gl.uniform3f(U.right, right[0], right[1], right[2]);
      gl.uniform3f(U.up, up[0], up[1], up[2]);
      gl.uniform3f(U.forward, forward[0], forward[1], forward[2]);
      gl.uniform3f(U.sun, s0[0] / sl, s0[1] / sl, s0[2] / sl);
      gl.uniform1f(U.k, k); gl.uniform1f(U.depth, range); gl.uniform1f(U.tie, style.tie ?? 0.005);
      gl.uniform2f(U.size, W, H);
      gl.uniform1i(U.ground, !persp && (style.depth ?? "ground") === "ground" ? 1 : 0);
      gl.uniform1i(U.persp, persp ? 1 : 0);
      gl.uniformMatrix4fv(U.proj, false, proj.clip);
      gl.uniform1f(U.tanH, proj.tanHalfFov);
      gl.uniform1f(U.time, style.time ?? 0);
      gl.uniform1f(U.density, style.density ?? 0.5);
      gl.uniform1i(U.screen, style.screen ?? 4);
      gl.uniform1i(U.steps, Math.max(2, Math.min(16, style.steps ?? 8)));
      gl.uniform1i(U.paletteRow, PALETTE_ROW);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindBuffer(gl.ARRAY_BUFFER, V.inst);
      if (volumes.capacity > V.capacity) { gl.bufferData(gl.ARRAY_BUFFER, volumes.capacity * VOLUME_FLOATS * 4, gl.DYNAMIC_DRAW); V.capacity = volumes.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, volumes.data, 0, volumes.count * VOLUME_FLOATS);
      gl.bindVertexArray(V.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, volumes.count);
      gl.bindVertexArray(null);
    },
    drawLayers(view, instances, style = {}) {
      const { screen = 4, dither = 0.9, outline = 3, clear = [0.05, 0.05, 0.07] } = style;
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(L.prog);
      const U = L.u;
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.uniform1i(U.anchorDither, style.ditherAnchor === "sprite" ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, L.places); gl.uniform1i(U.places, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, L.decals); gl.uniform1i(U.decals, 6);
      gl.activeTexture(gl.TEXTURE0);
      depthSprites(U, view, style);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.inst);
      if (instances.capacity > L.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); L.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * LAYER_INSTANCE_FLOATS);
      gl.bindVertexArray(L.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    drawLayersFx(view, instances, style = {}) {
      const { screen = 4, dither = 0.9, outline = 3, clear = [0.05, 0.05, 0.07] } = style;
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      const F = fxs();
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(F.prog);
      const U = F.u;
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.uniform1i(U.anchorDither, style.ditherAnchor === "sprite" ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, L.places); gl.uniform1i(U.places, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, L.decals); gl.uniform1i(U.decals, 6);
      gl.activeTexture(gl.TEXTURE0);
      depthSprites(U, view, style);
      gl.bindBuffer(gl.ARRAY_BUFFER, F.inst);
      if (instances.capacity > F.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); F.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * LAYER_INSTANCE_FLOATS);
      gl.bindVertexArray(F.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    drawBillboards(camera, instances, { screen = 4, dither = 0.9, outline = 3, far = 140, lift = 0.6, depthMode = "radial" } = {}) {
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      const B = boards();
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.useProgram(B.prog);
      const U = B.u;
      gl.uniform3f(U.eye, camera.eye[0], camera.eye[1], camera.eye[2]);
      gl.uniform3f(U.right, camera.right[0], camera.right[1], camera.right[2]);
      gl.uniform3f(U.up, camera.up[0], camera.up[1], camera.up[2]);
      gl.uniform3f(U.forward, camera.forward[0], camera.forward[1], camera.forward[2]);
      gl.uniform1f(U.tan, Math.tan(camera.fov / 2)); gl.uniform1f(U.aspect, W / H); gl.uniform1f(U.far, far); gl.uniform1f(U.lift, lift);
      gl.uniform1i(U.contract, depthMode === "contract" ? 1 : 0);
      gl.uniform2f(U.size, W, H);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, L.places); gl.uniform1i(U.places, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, L.decals); gl.uniform1i(U.decals, 6);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindBuffer(gl.ARRAY_BUFFER, B.inst);
      if (instances.capacity > B.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * LAYER_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); B.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * LAYER_INSTANCE_FLOATS);
      gl.bindVertexArray(B.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
    drawSway(view, instances, style = { time: 0 }) {
      const { screen = 4, dither = 0.9, outline = 3, clear = null, time, wind = 0.6, speed = 3, gust = 0.6, benders = [] } = style;
      if (!tex) throw new Error("setPages first.");
      const L = layers();
      if (!L.palette || !L.looks || !L.paints) throw new Error("setLooks first.");
      const S = sways();
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.useProgram(S.prog);
      const U = S.u;
      gl.uniform3f(U.center, view.center[0], view.center[1], view.center[2]);
      gl.uniform3f(U.right, view.axes.right[0], view.axes.right[1], view.axes.right[2]);
      gl.uniform3f(U.up, view.axes.up[0], view.axes.up[1], view.axes.up[2]);
      gl.uniform3f(U.forward, view.axes.forward[0], view.axes.forward[1], view.axes.forward[2]);
      gl.uniform1f(U.k, view.pixelsPerMetre);
      gl.uniform2f(U.size, W, H);
      gl.uniform1f(U.depth, Math.max(W, H) / view.pixelsPerMetre * 4);
      gl.uniform1i(U.screen, screen); gl.uniform1f(U.dither, dither); gl.uniform1i(U.outline, outline);
      gl.uniform1i(U.anchorDither, style.ditherAnchor === "sprite" ? 1 : 0);
      gl.uniform1f(U.time, time);
      gl.uniform4f(U.wind, Math.sin(wind), Math.cos(wind), speed, gust);
      const bend = new Float32Array(32);
      benders.slice(0, 8).forEach((b, i) => bend.set(b, i * 4));
      gl.uniform4fv(U.bend, bend); gl.uniform1i(U.bendCount, Math.min(8, benders.length));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); gl.uniform1i(U.pages, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.palette); gl.uniform1i(U.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L.looks); gl.uniform1i(U.looks, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L.paints); gl.uniform1i(U.paints, 3);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, L.places); gl.uniform1i(U.places, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, L.decals); gl.uniform1i(U.decals, 6);
      gl.activeTexture(gl.TEXTURE0);
      depthSprites(U, view, style);
      gl.bindBuffer(gl.ARRAY_BUFFER, S.inst);
      if (instances.capacity > S.capacity) { gl.bufferData(gl.ARRAY_BUFFER, instances.capacity * SWAY_INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW); S.capacity = instances.capacity; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.data, 0, instances.count * SWAY_INSTANCE_FLOATS);
      gl.bindVertexArray(S.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.count);
      gl.bindVertexArray(null);
    },
  };
  api.setTarget(width, height);
  return api;
}
