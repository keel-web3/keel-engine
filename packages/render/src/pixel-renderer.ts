// The realtime pixel renderer (WebGL2) -- ported from the proof of concept's
// src/gpu/pixel-renderer.js. A world of boxes, wedges (ramps) and capsules
// (and the water and the sky), drawn at a TARGET size -- 32×32 to 256×256 or
// any W×H -- then quantized to a palette, dithered and outlined, and shown
// pixel-sharp at whatever size the canvas is on the page. The same world
// reads at every target: the palette's ramps and the screen do the work a
// bigger picture's detail would.
//
//   const px = createPixelRenderer(canvas, { width: 128, height: 128 });
//   px.setPalette(colours, ramps);            // [[r,g,b]...] (up to 65536), { name: [base, length] } (up to 256 ramps)
//   px.setMaterials([{ ramp, light, pattern, glow }, ...]);   // up to 255 materials
//   px.setWorld({ boxes, wedges, capsules }); // boxes/wedges: {c, h, yaw, mat} (a wedge: + lo); capsules: {a, b, r, mat}
//   px.setFx([{ name: "glow" }, { name: "vignette" }]);   // fx.ts: all on the ramps, all at the target size
//   px.render({ eye, target, fov, time, sun, particles });
//
// Nothing here is sized for a GIF or an art piece: palettes of thousands of
// colours, 256 ramps, 255 materials. Every pixel is still a palette entry
// (there is no full-colour path: palette ramps through a screen is the model).

import { cameraBasis } from "@keel-engine/core";
import type { Palette, RGB, Vec3, Vec3Like } from "@keel-engine/core";
import { ALL_FX, fxUniforms, resolveFx, screenTile, toggleFx } from "./fx.ts";
import type { FxEntry, FxList, FxName, FxResolved, FxUniforms, RenderStyle } from "./fx.ts";
import {
  FAR, FULLSCREEN_VS, MAX_BOXES, MAX_CAPS, MAX_COLOURS, MAX_MATERIALS, MAX_RAMPS, MAX_WEDGES, PALETTE_WIDTH,
  PIXEL_FS, POINTS_FS, POINTS_VS, SCREEN_TILE, SKY_MAT, WORLD_FS,
} from "./shaders.ts";
import { BAKE_WORLD_FS, DEPTH_FS, HEIGHT_FS, INDEX_FS, unpackDepth } from "./indexed.ts";
import { DEPTH_OUT_FS, DIRECT_PIXEL_FS, RASTER_FLOATS, RASTER_FS, RASTER_VS, boxTemplate, capsuleTemplate } from "./raster.ts";
import type { DepthOut, RasterFrame, RasterMesh, RasterTemplate } from "./raster.ts";

// ---------------------------------------------------------------- types

/** A box turned about y (core frame): centre, half-extents, material. `kind: "wedge"` makes it a wedge. */
export interface RenderBox {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number | undefined;
  readonly mat?: number | undefined;
  readonly kind?: "box" | "wedge" | (string & {}) | undefined;
  /** A wedge's foot height, as a fraction of its height (0..0.98); read only when `kind` is "wedge". */
  readonly lo?: number | undefined;
}
/** A wedge (a ramp): its cross-section rises from the foot at local +z (`lo` × its height) to full height at -z. */
export interface RenderWedge {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number | undefined;
  readonly lo?: number | undefined;
  readonly mat?: number | undefined;
}
export interface RenderCapsule {
  readonly a: Vec3Like;
  readonly b: Vec3Like;
  readonly r: number;
  readonly mat?: number | undefined;
}
/** The world's solids. */
export interface RenderWorld {
  readonly boxes?: readonly RenderBox[] | undefined;
  readonly wedges?: readonly RenderWedge[] | undefined;
  readonly capsules?: readonly RenderCapsule[] | undefined;
}
/** What setWorld took, and how many past the limits it dropped. */
export interface WorldCounts {
  boxes: number;
  wedges: number;
  capsules: number;
  dropped: number;
}

/** Ramps by name, in order (index 0..255): [base, length] in the palette. */
export type Ramps = Readonly<Record<string, readonly [number, number]>>;
/** A colour: [r, g, b] bytes (core's RGB, or anything indexable like it). */
export type Colour = Readonly<RGB> | ArrayLike<number>;

/**
 * A material: its ramp (by name), a lightness scale, a pattern (0 none, 1
 * checker) and a glow (added lightness; the glow fx's emissive).
 * (Material 4 lights the water and 5 the sky; 255 is the particles'.)
 */
export interface Material {
  readonly ramp: string;
  readonly light?: number | undefined;
  readonly pattern?: number | undefined;
  readonly glow?: number | undefined;
}

export interface StyleInput {
  readonly screen?: RenderStyle["screen"] | undefined;
  readonly dither?: number | undefined;
  readonly outline?: number | boolean | undefined;
}

/** A speck in the world: where, how big, how light, on which ramp, how much it glows (0..1). */
export interface RenderParticle {
  readonly p: Vec3Like;
  readonly size?: number | undefined;
  readonly light?: number | undefined;
  readonly ramp?: string | undefined;
  readonly glow?: number | undefined;
}

/** One frame: the camera (eye, target, fov in radians), the time, the sun, the water, the fog, the particles. */
export interface RenderOptions {
  readonly eye: Vec3Like;
  readonly target: Vec3Like;
  readonly fov?: number | undefined;
  readonly time?: number | undefined;
  readonly sun?: Vec3Like | undefined;
  readonly waterY?: number | undefined;
  readonly fogNear?: number | undefined;
  readonly fogFar?: number | undefined;
  readonly particles?: readonly RenderParticle[] | undefined;
  /** Engine: solids and meshes rasterised into the same buffers (raster.ts). */
  readonly raster?: RasterFrame | undefined;
  /** Engine: after the picture, its depth into the canvas's depth buffer (true: as it is, dist / FAR). */
  readonly depthOut?: DepthOut | boolean | undefined;
}

/** What this renderer holds at most, and what the GPU says it can. */
export interface RendererLimits {
  readonly boxes: number;
  readonly wedges: number;
  readonly capsules: number;
  readonly ramps: number;
  readonly materials: number;
  readonly colours: number;
  readonly fragmentUniformVectors: number;
  readonly maxTexture: number;
}

/** Anything with a WebGL2 context: an HTMLCanvasElement or an OffscreenCanvas. */
export interface RenderCanvas {
  width: number;
  height: number;
  getContext(contextId: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

export interface PixelRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly width: number;
  readonly height: number;
  readonly limits: RendererLimits;
  /** The target size (the picture's own pixels; at least 8). */
  setTarget(width: number, height: number): void;
  /** Colours ([[r,g,b],...] 0-255) and ramps ({ name: [base, length] }), ramps in order 0..255. */
  setPalette(colours: readonly Colour[], ramps: Ramps): void;
  /** The palette as set: what a palette-true frame's pixels must all be. */
  readonly palette: RGB[];
  /** A ramp's index (0 for a name it doesn't know). */
  ramp(name: string): number;
  /** Materials 0..254. */
  setMaterials(list: readonly Material[]): void;
  /** The dither screen (0 none, 2, 4, 8, or a core screen id such as "stipple"), how far it reaches, and the outline. */
  setStyle(style?: StyleInput): void;
  /** The world's solids: boxes and wedges turned about y (a box with `kind: "wedge"` is a wedge too), and capsules. */
  setWorld(world: RenderWorld): WorldCounts;
  /** The fx list: [{ name, on?, ...params }]. Resolved for the target now and on every setTarget. */
  setFx(list?: FxList): void;
  /** Turn one pass on or off by name (added with its defaults if it wasn't listed). */
  toggleFx(name: FxName, on: boolean): void;
  /** The list as given. */
  readonly fx: FxEntry[];
  /** The list as resolved for the current target. */
  readonly fxResolved: FxResolved[];
  readonly allFx: () => FxEntry[];
  /** The last measured GPU time of a frame in ms (EXT_disjoint_timer_query_webgl2), or null where there is none. */
  readonly gpuMs: number | null;
  render(options: RenderOptions): void;
  /** The last frame's pixels (RGBA, bottom row first). */
  read(): Uint8Array;
  /** How many of the frame's pixels are NOT palette entries (0 for a palette-true frame). */
  offPalette(pixels?: ArrayLike<number>): number;
  /**
   * The last frame's pass-1 buffers, as they are: `data` (RGBA8: lightness, ramp, material, id -- each /255),
   * `data2` (glow, facing, and after renderIndexed the surface coordinate), `depth` (0..1, the ray's length over
   * FAR; 1 for the sky). Rows bottom first, as GL reads them. (A bake-time call: it compiles a small program the
   * first time, and reads back -- never in a frame loop.)
   */
  readData(): RenderData;
  /**
   * A bake's frame: pass 1 with surface coordinates (indexed.ts BAKE_WORLD_FS), then INDEX_FS instead of the
   * palette -- per pixel the material, an outline-edge flag, the shade and where on its part it is, into a
   * framebuffer of its own (returned: copy or read from it). The palette, style and fx aren't used; the materials'
   * `light` and `glow` still shade it. `gap`: the outline's depth gap in metres (default 0.56, the classic).
   * `split`: a point; every pixel then also says whether what it shows is behind that point from the camera.
   */
  renderIndexed(options: RenderOptions & { readonly gap?: number | undefined; readonly split?: Vec3Like | undefined }): WebGLFramebuffer;
  /** The last renderIndexed picture (RGBA8, bottom row first): see indexed.ts's readIndexedPixel. */
  readIndexed(): Uint8Array;
  /**
   * Engine (depth sprites): right after renderIndexed, with the same camera, the height above the ground (y = 0) of
   * the point each pixel shows, in sixteenths of a texel (`pixelsPerMetre` a metre) + 1 over R and G (indexed.ts HEIGHT_FS,
   * unpackHeight), into the bake framebuffer (returned) -- over the index picture, so copy that first.
   */
  renderIndexedHeights(options: { readonly eye: Vec3Like; readonly target: Vec3Like; readonly fov?: number | undefined; readonly pixelsPerMetre: number; readonly eps?: number | undefined }): WebGLFramebuffer;
  /** Engine (raster.ts): a static mesh under a key, uploaded once (null removes it); a frame draws it by `raster.meshes`. */
  setMesh(key: string, mesh: RasterMesh | null): void;
  /** Engine: what the last frame rasterised. */
  readonly rasterStats: { readonly meshes: number; readonly triangles: number; readonly instances: number; readonly meshBytes: number };
}

/** What readData() gives back. */
export interface RenderData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly data2: Uint8Array;
  readonly depth: Float32Array;
}

/** A core palette's ramps ({ key: { base, len }, ... }) as setPalette takes them ({ key: [base, len] }). */
export function paletteRamps(palette: Pick<Palette, "ramps">): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const [name, slot] of Object.entries(palette.ramps)) if (slot) out[name] = [slot.base, slot.len];
  return out;
}

// ---------------------------------------------------------------- GL plumbing

// (The plain uniforms each program's code sets, by name.)
type WorldUniform = "uRes" | "uEye" | "uFwd" | "uRight" | "uUp" | "uTan" | "uTime" | "uBoxes" | "uWedges" | "uCaps" | "uMats" | "uSun" | "uWaterY" | "uFogNear" | "uFogFar";
type PointsUniform = "uEye" | "uFwd" | "uRight" | "uUp" | "uTan" | "uAspect" | "uH";
type PixelUniform =
  | "uData" | "uData2" | "uDepth" | "uPalette" | "uRamps" | "uScreenTex" | "uScreen" | "uDither" | "uTime" | "uOutline" | "uOutlineInk" | "uFog" | "uFogLook"
  | "uGlow" | "uGlowK" | "uVig" | "uScan" | "uCrt" | "uRim" | "uRimDir" | "uFlash" | "uFlashMats" | "uGrade" | "uCycle";
type IndexUniform = "uData" | "uData2" | "uDepth" | "uGap";
type HeightUniform = WorldUniform | "uData" | "uDepth" | "uScale" | "uEps";

interface Program<N extends string> {
  p: WebGLProgram;
  /** Uniform locations by name (an inactive one is absent: GL ignores a null location). */
  loc: Record<N, WebGLUniformLocation | null>;
}

function program<N extends string>(gl: WebGL2RenderingContext, vs: string, fs: string): Program<N> {
  const make = (type: GLenum, src: string): WebGLShader => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i += 1) {
    const u = gl.getActiveUniform(p, i);
    if (u) loc[u.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, u.name);
  }
  return { p, loc: loc as Record<N, WebGLUniformLocation | null> };
}

const norm = (a: Vec3Like): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface TimerQuery {
  readonly TIME_ELAPSED_EXT: GLenum;
  readonly GPU_DISJOINT_EXT: GLenum;
}
interface Block {
  data: Float32Array;
  buf: WebGLBuffer;
  i: number;
}

// ---------------------------------------------------------------- the renderer

export function createPixelRenderer(canvas: RenderCanvas, { width = 128, height = 128, bakeOnly = false }: { width?: number; height?: number; bakeOnly?: boolean } = {}): PixelRenderer {
  const ctx = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  if (!ctx) throw new Error("WebGL2 is not available");
  const gl: WebGL2RenderingContext = ctx;
  // (bakeOnly: the colour programs compile the first time render() is called, so a renderer that only bakes indexed
  // sprites -- a bake worker's -- never pays for them; compiling a raymarcher is most of a cold start. Otherwise
  // they compile here, as ever: the GL calls the proof of concept makes, call for call.)
  let worldP: Program<WorldUniform> | null = null, pixelP: Program<PixelUniform> | null = null, pointsP: Program<PointsUniform> | null = null;
  // (Engine: pass 2 for frames with a raster hook -- raster.ts DIRECT_PIXEL_FS -- compiled the first time one asks.)
  let directPixelP: Program<PixelUniform> | null = null;
  const colourPrograms = (): { world: Program<WorldUniform>; pixel: Program<PixelUniform>; points: Program<PointsUniform> } => {
    if (!worldP) {
      const w = program<WorldUniform>(gl, FULLSCREEN_VS, WORLD_FS);
      // (Compiled late, its uniform blocks are bound here; compiled at once, they're bound as the blocks are made, below.)
      if (bakeOnly) (["Boxes", "Wedges", "Capsules"] as const).forEach((name, i) => gl.uniformBlockBinding(w.p, gl.getUniformBlockIndex(w.p, name), i));
      worldP = w;
      pixelP = program<PixelUniform>(gl, FULLSCREEN_VS, PIXEL_FS);
      pointsP = program<PointsUniform>(gl, POINTS_VS, POINTS_FS);
    }
    return { world: worldP, pixel: pixelP!, points: pointsP! };
  };
  if (!bakeOnly) colourPrograms();
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pbuf = gl.createBuffer();
  const nearest = (): void => {
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
  };
  const floatTex = (w: number, h: number, data: Float32Array | null = null): WebGLTexture => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    nearest();
    return t;
  };

  let W = width;
  let H = height;
  let fbo: WebGLFramebuffer | null = null;
  let dataTex: WebGLTexture | null = null;
  let data2Tex: WebGLTexture | null = null;
  let depthTex: WebGLTexture | null = null;
  function target(w: number, h: number): void {
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    for (const t of [dataTex, data2Tex, depthTex]) if (t) gl.deleteTexture(t);
    if (fbo) gl.deleteFramebuffer(fbo);
    const rgba8 = (): WebGLTexture => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); nearest(); return t; };
    dataTex = rgba8();
    data2Tex = rgba8();
    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, W, H, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    nearest();
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dataTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, data2Tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    fxDirty = true;
  }

  // The world's solids: three uniform blocks; the ramps and the materials: float textures (see shaders.ts).
  const blocks: Block[] = ([["Boxes", 2 * MAX_BOXES], ["Wedges", 3 * MAX_WEDGES], ["Capsules", 2 * MAX_CAPS]] as const).map(([name, vecs], i) => {
    const data = new Float32Array(vecs * 4);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
    gl.bufferData(gl.UNIFORM_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    if (worldP) gl.uniformBlockBinding(worldP.p, gl.getUniformBlockIndex(worldP.p, name), i);
    return { data, buf, i };
  });
  const [boxBlock, wedgeBlock, capBlock] = blocks as [Block, Block, Block];
  const rampRows = new Float32Array(MAX_RAMPS * 2 * 4);
  const rampTex = floatTex(MAX_RAMPS, 2, rampRows);
  const matRows = new Float32Array(256 * 4);
  const matTex = floatTex(256, 1, matRows);
  const screenTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, screenTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SCREEN_TILE, SCREEN_TILE, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(SCREEN_TILE * SCREEN_TILE));
  nearest();
  let screenLoaded: string | null = null;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQuery | null;
  let query: WebGLQuery | null = null;
  let gpuMs: number | null = null;

  let palTex: WebGLTexture | null = null;
  let palette: RGB[] = [];
  let rampIndex = new Map<string, number>();
  let rampList: [number, number][] = [];
  let nBoxes = 0;
  let nWedges = 0;
  let nCaps = 0;
  let style: RenderStyle = { screen: 4, dither: 0.9, outline: 1 };
  let fxList: FxEntry[] = [];
  let fxResolved: FxResolved[] = [];
  let fxU: FxUniforms | null = null;
  let fxDirty = true;

  function uploadRamps(): void {
    rampRows.fill(0);
    rampList.forEach(([base, len], i) => { rampRows.set([base, len, 0, 0], i * 4); });
    for (let i = 0; i < MAX_RAMPS; i += 1) rampRows[(MAX_RAMPS + i) * 4] = -1; // (row 1: graded twin, -1 = itself)
    if (fxU) {
      for (const [r, from, speed] of fxU.ramps.cycle) { rampRows[r * 4 + 2] = from; rampRows[r * 4 + 3] = speed; }
      for (const [r, to] of fxU.ramps.grade) rampRows[(MAX_RAMPS + r) * 4] = to;
    }
    gl.bindTexture(gl.TEXTURE_2D, rampTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_RAMPS, 2, gl.RGBA, gl.FLOAT, rampRows);
  }
  function refreshFx(): FxUniforms {
    fxResolved = resolveFx(fxList, { width: W, height: H });
    const u = fxUniforms(fxResolved, { ramp: (n) => rampIndex.get(n) ?? -1, rampOf: (i) => rampList[i] ?? [0, 1], style, far: FAR });
    fxU = u;
    if (u.screen && u.screen !== screenLoaded) {
      gl.bindTexture(gl.TEXTURE_2D, screenTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_TILE, SCREEN_TILE, gl.RED, gl.UNSIGNED_BYTE, screenTile(u.screen, SCREEN_TILE));
      screenLoaded = u.screen;
    }
    uploadRamps();
    fxDirty = false;
    return u;
  }
  target(W, H);

  // ---- bake mode (indexed.ts): compiled the first time a bake asks, so a normal frame's GL calls never change.
  interface Extra { world: Program<WorldUniform | "uSplit">; index: Program<IndexUniform>; depth: Program<"uDepth">; height: Program<HeightUniform> | null; fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }
  let extra: Extra | null = null;
  function bakeMode(): Extra {
    if (!extra) {
      const bw = program<WorldUniform | "uSplit">(gl, FULLSCREEN_VS, BAKE_WORLD_FS);
      (["Boxes", "Wedges", "Capsules"] as const).forEach((name, i) => gl.uniformBlockBinding(bw.p, gl.getUniformBlockIndex(bw.p, name), i));
      extra = { world: bw, index: program<IndexUniform>(gl, FULLSCREEN_VS, INDEX_FS), depth: program<"uDepth">(gl, FULLSCREEN_VS, DEPTH_FS), height: null, fb: gl.createFramebuffer(), tex: gl.createTexture(), w: 0, h: 0 };
    }
    // (Its own picture, sized to the target: an RGBA8 texture the index and depth passes draw into.)
    if (extra.w !== W || extra.h !== H) {
      gl.bindTexture(gl.TEXTURE_2D, extra.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      nearest();
      gl.bindFramebuffer(gl.FRAMEBUFFER, extra.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, extra.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      extra.w = W; extra.h = H;
    }
    return extra;
  }
  // Draw a fullscreen pass with `prog` into `fb`, its textures bound first.
  function pass(prog: WebGLProgram, fb: WebGLFramebuffer | null, textures: ReadonlyArray<readonly [WebGLTexture | null, WebGLUniformLocation | null]>): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    textures.forEach(([t, loc], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, i); });
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const a = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function readTarget(fb: WebGLFramebuffer | null, attachment: number): Uint8Array {
    const out = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (fb) gl.readBuffer(attachment);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    if (fb) gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  // ---- raster mode (raster.ts): compiled the first time a frame rasterises or a mesh is set.
  type RasterUniform = "uKind" | "uEye" | "uFwd" | "uRight" | "uUp" | "uTan" | "uAspect" | "uMats" | "uSun" | "uWaterY" | "uFogNear" | "uFogFar" | "uRes" | "uTime";
  interface Kind { vao: WebGLVertexArrayObject; inst: WebGLBuffer; cap: number; count: number }
  interface MeshGpu { vao: WebGLVertexArrayObject; bufs: WebGLBuffer[]; count: number; indexed: boolean; bytes: number }
  interface Raster { prog: Program<RasterUniform>; depthOut: Program<"uDepth" | "uMap">; box: Kind; wedge: Kind; capsule: Kind; meshes: Map<string, MeshGpu> }
  let rasterState: Raster | null = null;
  const rasterStats = { meshes: 0, triangles: 0, instances: 0, meshBytes: 0 };
  function rasterMode(): Raster {
    if (rasterState) return rasterState;
    const prog = program<RasterUniform>(gl, RASTER_VS, RASTER_FS);
    const depthOut = program<"uDepth" | "uMap">(gl, FULLSCREEN_VS, DEPTH_OUT_FS);
    const kind = (t: RasterTemplate): Kind => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, t.verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, t.norms, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, t.index, gl.STATIC_DRAW);
      const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, 1024 * RASTER_FLOATS * 4, gl.DYNAMIC_DRAW);
      for (let k = 0; k < 4; k += 1) { gl.enableVertexAttribArray(2 + k); gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, RASTER_FLOATS * 4, k * 16); gl.vertexAttribDivisor(2 + k, 1); }
      gl.bindVertexArray(null);
      return { vao, inst, cap: 1024, count: t.index.length };
    };
    const box = kind(boxTemplate());
    rasterState = { prog, depthOut, box, wedge: kind(boxTemplate()), capsule: kind(capsuleTemplate(8, 2)), meshes: new Map() };
    return rasterState;
  }
  function drawRaster(frame: RasterFrame, eye: Vec3Like, fwd: Vec3, right: Vec3, up: Vec3, tanF: number, sunN: Vec3, waterY: number, fogNear: number, fogFar: number, time: number): void {
    const R = rasterMode();
    const RU = R.prog.loc;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.useProgram(R.prog.p);
    gl.uniform3fv(RU.uEye, eye as unknown as Float32List); gl.uniform3fv(RU.uFwd, fwd); gl.uniform3fv(RU.uRight, right); gl.uniform3fv(RU.uUp, up);
    gl.uniform1f(RU.uTan, tanF); gl.uniform1f(RU.uAspect, W / H);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, matTex); gl.uniform1i(RU.uMats, 1);
    gl.uniform3fv(RU.uSun, sunN);
    gl.uniform1f(RU.uWaterY, frame.waterY ?? waterY); gl.uniform1f(RU.uFogNear, fogNear); gl.uniform1f(RU.uFogFar, fogFar);
    gl.uniform2f(RU.uRes, W, H); gl.uniform1f(RU.uTime, time);
    let tris = 0, insts = 0, meshes = 0;
    for (const key of frame.meshes ?? []) {
      const m = R.meshes.get(key);
      if (!m || !m.count) continue;
      gl.uniform1i(RU.uKind, 0);
      gl.bindVertexArray(m.vao);
      if (m.indexed) gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); else gl.drawArrays(gl.TRIANGLES, 0, m.count);
      tris += m.count / 3; meshes += 1;
    }
    const solids = frame.solids;
    if (solids) {
      for (const [k, buf, id] of [[R.box, solids.boxes, 1], [R.wedge, solids.wedges, 2], [R.capsule, solids.capsules, 3]] as const) {
        if (!buf.count) continue;
        gl.bindVertexArray(k.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, k.inst);
        if (buf.count > k.cap) { k.cap = Math.max(buf.count, k.cap * 2); gl.bufferData(gl.ARRAY_BUFFER, k.cap * RASTER_FLOATS * 4, gl.DYNAMIC_DRAW); }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.data, 0, buf.count * RASTER_FLOATS);
        gl.uniform1i(RU.uKind, id);
        gl.drawElementsInstanced(gl.TRIANGLES, k.count, gl.UNSIGNED_SHORT, 0, buf.count);
        tris += (k.count / 3) * buf.count; insts += buf.count;
      }
    }
    gl.bindVertexArray(null);
    rasterStats.meshes = meshes; rasterStats.triangles = tris; rasterStats.instances = insts;
    // (Engine: a hook's own draws into the same buffers -- the GPU ground, a sky -- then this renderer's state again.)
    if (frame.draw) {
      frame.draw({ gl, eye: [eye[0], eye[1], eye[2]], forward: fwd, right, up, tan: tanF, width: W, height: H, far: FAR, time, sun: sunN });
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
    }
  }
  function writeDepthOut(map: DepthOut | true): void {
    const R = rasterMode();
    const scale = map === true ? 1 : map.scale ?? 1, bias = map === true ? 0 : map.bias ?? 0;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    gl.useProgram(R.depthOut.p);
    gl.uniform2f(R.depthOut.loc.uMap, scale, bias);
    pass(R.depthOut.p, null, [[depthTex, R.depthOut.loc.uDepth]]);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.DEPTH_TEST);
  }

  const api: PixelRenderer = {
    gl,
    get width() { return W; },
    get height() { return H; },
    limits: {
      boxes: MAX_BOXES, wedges: MAX_WEDGES, capsules: MAX_CAPS, ramps: MAX_RAMPS, materials: MAX_MATERIALS, colours: MAX_COLOURS,
      fragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    },
    setTarget(w, h) { target(Math.max(8, w | 0), Math.max(8, h | 0)); },
    setPalette(colours, ramps) {
      if (colours.length > MAX_COLOURS) throw new RangeError(`${colours.length} colours: at most ${MAX_COLOURS}`);
      palette = colours.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0]);
      const rows = Math.max(1, Math.ceil(colours.length / PALETTE_WIDTH));
      const bytes = new Uint8Array(PALETTE_WIDTH * rows * 4);
      colours.forEach((c, i) => { bytes[i * 4] = c[0] ?? 0; bytes[i * 4 + 1] = c[1] ?? 0; bytes[i * 4 + 2] = c[2] ?? 0; bytes[i * 4 + 3] = 255; });
      if (palTex) gl.deleteTexture(palTex);
      palTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PALETTE_WIDTH, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      nearest();
      const entries = Object.entries(ramps);
      if (entries.length > MAX_RAMPS) throw new RangeError(`${entries.length} ramps: at most ${MAX_RAMPS}`);
      rampIndex = new Map();
      rampList = entries.map(([name, [base, len]], i) => { rampIndex.set(name, i); return [base, len]; });
      fxDirty = true;
    },
    get palette() { return palette; },
    ramp: (name) => rampIndex.get(name) ?? 0,
    setMaterials(list) {
      if (list.length > MAX_MATERIALS) throw new RangeError(`${list.length} materials: at most ${MAX_MATERIALS}`);
      matRows.fill(0);
      list.forEach((m, i) => { matRows.set([rampIndex.get(m.ramp) ?? 0, m.light ?? 1, m.pattern ?? 0, m.glow ?? 0], i * 4); });
      gl.bindTexture(gl.TEXTURE_2D, matTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, matRows);
    },
    setStyle({ screen: s = style.screen, dither: d = style.dither, outline: o = style.outline } = {}) {
      style = { screen: s, dither: d, outline: o ? 1 : 0 };
      fxDirty = true;
    },
    setWorld({ boxes = [], wedges = [], capsules = [] }) {
      const bx: RenderBox[] = [];
      const wd: RenderWedge[] = [...wedges];
      for (const b of boxes) (b.kind === "wedge" ? wd : bx).push(b);
      nBoxes = Math.min(MAX_BOXES, bx.length);
      for (let i = 0; i < nBoxes; i += 1) { const b = bx[i]!; boxBlock.data.set([b.c[0], b.c[1], b.c[2], b.mat ?? 0, b.h[0], b.h[1], b.h[2], b.yaw ?? 0], i * 8); }
      nWedges = Math.min(MAX_WEDGES, wd.length);
      for (let i = 0; i < nWedges; i += 1) { const w = wd[i]!; wedgeBlock.data.set([w.c[0], w.c[1], w.c[2], w.mat ?? 0, w.h[0], w.h[1], w.h[2], w.yaw ?? 0, Math.max(0, Math.min(0.98, w.lo ?? 0)), 0, 0, 0], i * 12); }
      nCaps = Math.min(MAX_CAPS, capsules.length);
      for (let i = 0; i < nCaps; i += 1) { const c = capsules[i]!; capBlock.data.set([c.a[0], c.a[1], c.a[2], c.r, c.b[0], c.b[1], c.b[2], c.mat ?? 0], i * 8); }
      // (Only the used parts go up: a few KB a frame.)
      for (const [blk, n] of [[boxBlock, nBoxes * 8], [wedgeBlock, nWedges * 12], [capBlock, nCaps * 8]] as const) {
        gl.bindBuffer(gl.UNIFORM_BUFFER, blk.buf);
        if (n) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, blk.data, 0, n);
      }
      return { boxes: nBoxes, wedges: nWedges, capsules: nCaps, dropped: bx.length - nBoxes + wd.length - nWedges + capsules.length - nCaps };
    },
    setFx(list = []) { fxList = list.map((e) => ({ ...e })); resolveFx(fxList, { width: W, height: H }); fxDirty = true; },
    toggleFx(name, on) { fxList = toggleFx(fxList, name, on); fxDirty = true; },
    get fx() { return fxList.map((e) => ({ ...e })); },
    get fxResolved() { if (fxDirty) refreshFx(); return fxResolved; },
    allFx: ALL_FX,
    get gpuMs() { return gpuMs; },
    render({ eye, target: look, fov = 1.2, time = 0, sun = [0.4, 0.8, 0.3], waterY = 0, fogNear = 25, fogFar = 110, particles = [], raster, depthOut }) {
      const { world, pixel, points } = colourPrograms();
      const fx = fxDirty || !fxU ? refreshFx() : fxU;
      // (GPU time, where the timer query exists: one query in flight, read back a frame or two later.)
      let timing = false;
      if (timer) {
        if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
          gl.deleteQuery(query); query = null;
        }
        if (!query) { query = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, query); timing = true; }
      }
      // (core's frame: right = up x forward, so looking along +z, +x is on the screen's right.)
      const { forward: fwd, right, up } = cameraBasis(eye, look);
      const tanF = Math.tan(fov / 2);
      const sunN = norm(sun);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const U = world.loc;
      gl.useProgram(world.p);
      gl.uniform2f(U.uRes, W, H);
      gl.uniform3fv(U.uEye, eye as unknown as Float32List); gl.uniform3fv(U.uFwd, fwd); gl.uniform3fv(U.uRight, right); gl.uniform3fv(U.uUp, up);
      gl.uniform1f(U.uTan, tanF); gl.uniform1f(U.uTime, time);
      gl.uniform1i(U.uBoxes, nBoxes); gl.uniform1i(U.uWedges, nWedges); gl.uniform1i(U.uCaps, nCaps);
      for (const blk of blocks) gl.bindBufferBase(gl.UNIFORM_BUFFER, blk.i, blk.buf);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, matTex); gl.uniform1i(U.uMats, 1);
      gl.uniform3fv(U.uSun, sunN);
      gl.uniform1f(U.uWaterY, waterY); gl.uniform1f(U.uFogNear, fogNear); gl.uniform1f(U.uFogFar, fogFar);
      if (raster?.world === false) {
        // (Engine: no march -- pass 1 is the sky at depth 1 (cleared above) for the raster and its hook to paint over.)
        gl.clearBufferfv(gl.COLOR, 0, [0.5, (matRows[SKY_MAT * 4] ?? 0) / 255, SKY_MAT / 255, 1]);
        gl.clearBufferfv(gl.COLOR, 1, [0, 1, 0, 0]);
      } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const aw = gl.getAttribLocation(world.p, "aPos");
      gl.enableVertexAttribArray(aw);
      gl.vertexAttribPointer(aw, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // Particles into the same buffers, behind or in front of what's there.
      if (particles.length) {
        gl.depthFunc(gl.LESS);
        const data = new Float32Array(particles.length * 7);
        particles.forEach((q, i) => data.set([q.p[0], q.p[1], q.p[2], q.size ?? 1, q.light ?? 0.8, (q.ramp === undefined ? undefined : rampIndex.get(q.ramp)) ?? 0, q.glow ?? 0], i * 7));
        gl.useProgram(points.p);
        const P = points.loc;
        gl.uniform3fv(P.uEye, eye as unknown as Float32List); gl.uniform3fv(P.uFwd, fwd); gl.uniform3fv(P.uRight, right); gl.uniform3fv(P.uUp, up);
        gl.uniform1f(P.uTan, tanF); gl.uniform1f(P.uAspect, W / H); gl.uniform1f(P.uH, H);
        gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        const a0 = gl.getAttribLocation(points.p, "aPos");
        const a1 = gl.getAttribLocation(points.p, "aLook");
        gl.enableVertexAttribArray(a0); gl.vertexAttribPointer(a0, 4, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 3, gl.FLOAT, false, 28, 16);
        gl.drawArrays(gl.POINTS, 0, particles.length);
        gl.disableVertexAttribArray(a1);
      }
      // (Engine: rasterised solids and meshes into the same buffers, depth-tested against what's there.)
      if (raster) drawRaster(raster, eye, fwd, right, up, tanF, sunN, waterY, fogNear, fogFar, time);
      gl.disable(gl.DEPTH_TEST);
      // Pass 2: the palette, the screen, the fx, the outline. (A frame with a raster hook: the same pass, plus DIRECT_MAT pixels.)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      const pass2 = raster?.draw ? (directPixelP ??= program<PixelUniform>(gl, FULLSCREEN_VS, DIRECT_PIXEL_FS)) : pixel;
      gl.useProgram(pass2.p);
      const X = pass2.loc;
      const T = [[dataTex, "uData"], [data2Tex, "uData2"], [depthTex, "uDepth"], [palTex, "uPalette"], [rampTex, "uRamps"], [screenTex, "uScreenTex"]] as const;
      T.forEach(([t, name], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(X[name], i); });
      const u = fx.u;
      gl.uniform1i(X.uScreen, u.uScreen); gl.uniform1f(X.uDither, u.uDither);
      gl.uniform1f(X.uTime, time);
      gl.uniform3fv(X.uOutline, u.uOutline); gl.uniform1i(X.uOutlineInk, u.uOutlineInk);
      gl.uniform4fv(X.uFog, u.uFog); gl.uniform2fv(X.uFogLook, u.uFogLook);
      gl.uniform4fv(X.uGlow, u.uGlow); gl.uniform2fv(X.uGlowK, u.uGlowK);
      gl.uniform4fv(X.uVig, u.uVig); gl.uniform4fv(X.uScan, u.uScan); gl.uniform4fv(X.uCrt, u.uCrt);
      gl.uniform4fv(X.uRim, u.uRim);
      // (The rim light comes from the sun's side of the screen, unless the pass names a direction.)
      let rd = u.uRimDir;
      if (!rd) { const sx = dot(sunN, right); const sy = dot(sunN, up); const l = Math.hypot(sx, sy); rd = l > 1e-3 ? [sx / l, sy / l] : [0, 1]; }
      gl.uniform2fv(X.uRimDir, rd as unknown as Float32List);
      gl.uniform4fv(X.uFlash, u.uFlash); gl.uniform4iv(X.uFlashMats, u.uFlashMats);
      gl.uniform2fv(X.uGrade, u.uGrade); gl.uniform1i(X.uCycle, u.uCycle);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const ap = gl.getAttribLocation(pass2.p, "aPos");
      gl.enableVertexAttribArray(ap);
      gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (depthOut) writeDepthOut(depthOut);
      if (timing && timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
    },
    read() { const out = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; },
    readData() {
      const x = bakeMode();
      const data = readTarget(fbo, gl.COLOR_ATTACHMENT0);
      const data2 = readTarget(fbo, gl.COLOR_ATTACHMENT1);
      gl.disable(gl.DEPTH_TEST);
      pass(x.depth.p, x.fb, [[depthTex, x.depth.loc.uDepth]]);
      const packed = readTarget(x.fb, gl.COLOR_ATTACHMENT0);
      const depth = new Float32Array(W * H);
      for (let i = 0; i < depth.length; i += 1) depth[i] = unpackDepth(packed[i * 4]!, packed[i * 4 + 1]!, packed[i * 4 + 2]!);
      return { width: W, height: H, data, data2, depth };
    },
    renderIndexed({ eye, target: look, fov = 1.2, time = 0, sun = [0.4, 0.8, 0.3], waterY = 0, fogNear = 25, fogFar = 110, gap = 0.56, split }) {
      const x = bakeMode();
      const { forward: fwd, right, up } = cameraBasis(eye, look);
      // Pass 1, as render()'s (no particles: a bake draws solids), with the surface coordinate.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const BW = x.world.loc; // (the bake world's uniforms: WORLD_FS's, and uSplit)
      gl.useProgram(x.world.p);
      gl.uniform2f(BW.uRes, W, H);
      gl.uniform3fv(BW.uEye, eye as unknown as Float32List); gl.uniform3fv(BW.uFwd, fwd); gl.uniform3fv(BW.uRight, right); gl.uniform3fv(BW.uUp, up);
      gl.uniform1f(BW.uTan, Math.tan(fov / 2)); gl.uniform1f(BW.uTime, time);
      gl.uniform1i(BW.uBoxes, nBoxes); gl.uniform1i(BW.uWedges, nWedges); gl.uniform1i(BW.uCaps, nCaps);
      for (const blk of blocks) gl.bindBufferBase(gl.UNIFORM_BUFFER, blk.i, blk.buf);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, matTex); gl.uniform1i(BW.uMats, 1);
      gl.uniform3fv(BW.uSun, norm(sun));
      gl.uniform1f(BW.uWaterY, waterY); gl.uniform1f(BW.uFogNear, fogNear); gl.uniform1f(BW.uFogFar, fogFar);
      gl.uniform4f(BW.uSplit, split?.[0] ?? 0, split?.[1] ?? 0, split?.[2] ?? 0, split ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const aw = gl.getAttribLocation(x.world.p, "aPos");
      gl.enableVertexAttribArray(aw);
      gl.vertexAttribPointer(aw, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.DEPTH_TEST);
      // Pass 2: the index, into its own picture.
      gl.useProgram(x.index.p);
      gl.uniform1f(x.index.loc.uGap, gap / FAR);
      pass(x.index.p, x.fb, [[dataTex, x.index.loc.uData], [data2Tex, x.index.loc.uData2], [depthTex, x.index.loc.uDepth]]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return x.fb;
    },
    readIndexed() { return readTarget(bakeMode().fb, gl.COLOR_ATTACHMENT0); },
    renderIndexedHeights({ eye, target: look, fov = 1.2, pixelsPerMetre, eps = 0 }) {
      const x = bakeMode();
      // (Compiled the first time a bake asks for heights: a bake without them never builds it. It marches the world's
      // solids again -- pass 1's uniform blocks, still bound.)
      if (!x.height) {
        x.height = program<HeightUniform>(gl, FULLSCREEN_VS, HEIGHT_FS);
        (["Boxes", "Wedges", "Capsules"] as const).forEach((name, i) => gl.uniformBlockBinding(x.height!.p, gl.getUniformBlockIndex(x.height!.p, name), i));
      }
      const hp = x.height;
      const { forward: fwd, right, up } = cameraBasis(eye, look);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(hp.p);
      const L = hp.loc;
      gl.uniform2f(L.uRes, W, H);
      gl.uniform3fv(L.uEye, eye as unknown as Float32List); gl.uniform3fv(L.uFwd, fwd); gl.uniform3fv(L.uRight, right); gl.uniform3fv(L.uUp, up);
      gl.uniform1f(L.uTan, Math.tan(fov / 2)); gl.uniform1f(L.uScale, pixelsPerMetre); gl.uniform1f(L.uEps, eps);
      gl.uniform1i(L.uBoxes, nBoxes); gl.uniform1i(L.uWedges, nWedges); gl.uniform1i(L.uCaps, nCaps);
      for (const blk of blocks) gl.bindBufferBase(gl.UNIFORM_BUFFER, blk.i, blk.buf);
      pass(hp.p, x.fb, [[dataTex, L.uData], [depthTex, L.uDepth]]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return x.fb;
    },
    setMesh(key, mesh) {
      const R = rasterMode();
      const old = R.meshes.get(key);
      if (old) { for (const b of old.bufs) gl.deleteBuffer(b); gl.deleteVertexArray(old.vao); R.meshes.delete(key); rasterStats.meshBytes -= old.bytes; }
      if (!mesh) return;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const bufs: WebGLBuffer[] = [];
      const attr = (loc: number, data: Float32Array, size: number) => {
        const b = gl.createBuffer(); bufs.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      attr(0, mesh.positions, 3); attr(1, mesh.normals, 3); attr(2, mesh.looks, 4);
      for (let k = 3; k < 6; k += 1) { gl.disableVertexAttribArray(k); gl.vertexAttrib4f(k, 0, 0, 0, 0); }
      let bytes = mesh.positions.byteLength + mesh.normals.byteLength + mesh.looks.byteLength;
      if (mesh.indices) { const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW); bytes += mesh.indices.byteLength; }
      gl.bindVertexArray(null);
      R.meshes.set(key, { vao, bufs, count: mesh.indices ? mesh.indices.length : mesh.positions.length / 3, indexed: !!mesh.indices, bytes });
      rasterStats.meshBytes += bytes;
    },
    get rasterStats() { return { ...rasterStats }; },
    offPalette(pixels = api.read()) {
      const set = new Set(palette.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]));
      let off = 0;
      for (let i = 0; i < pixels.length; i += 4) if (!set.has(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0))) off += 1;
      return off;
    },
  };
  return api;
}
