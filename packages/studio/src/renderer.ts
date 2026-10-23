// The studio renderer: one WebGL2 context drawing lit product shots into any number of targets.
//
//   quality "solo": 4x MSAA, real parts behind clear plastic (two refraction layers: the walls' backs, then their
//                   fronts), bloom from the screen alone, the contact shadow, specular AA and bead-blast grain.
//   quality "grid": the same materials and environment on a cheaper path -- clear plastic shows a baked impostor of
//                   the parts inside (one front layer), no bloom, no grain. Many targets, one context.
//
// Both tiers share the meshes, textures and the prefiltered studio; a frame names its quality, so a handheld can
// leave the grid and come up to full quality in the same context without reloading anything.

import { type Mat4, type Vec3, identity, invert, lookAt, multiply, normalMatrix, orthographic, transformPoint } from "./math.ts";
import type { MeshData } from "./mesh.ts";
import {
  AO_POINTS_FS, AO_POINTS_VS, BLUR_FS, CASTER_FS, CLEAR_FS, COMPOSITE_FS, DEPTH_FS, EMISSIVE_FS, FLOOR_FS, FLOOR_VS, FULLSCREEN_VS, GLASS_FS,
  HEIGHT_BAKE_FS, IMPOSTOR_DEPTH_FS, MAIN_VS, STANDARD_FS, prefilterFs,
} from "./shaders.ts";
import { STUDIO, type Studio } from "./env.ts";

export type Quality = "grid" | "solo";
export type Rgb = Vec3;

export interface GpuMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly buffers: readonly WebGLBuffer[];
  readonly count: number;
  readonly source: MeshData;
  readonly aoBuffer: WebGLBuffer;
}

export interface StudioTexture {
  readonly tex: WebGLTexture;
  width: number;
  height: number;
}

export interface Ink {
  /** sRGB 0..1 */
  readonly colour: Rgb;
  readonly rough: number;
  readonly metal?: number;
}

export interface StandardMaterial {
  readonly kind: "standard";
  /** sRGB 0..1 */
  readonly base: Rgb;
  readonly metal: number;
  readonly rough: number;
  readonly emissive?: Rgb;
  /** Bead-blast: [scale per unit, amount 0..1]. */
  readonly grain?: readonly [number, number];
  readonly masks?: StudioTexture;
  readonly inks?: readonly [Ink, Ink, Ink];
  readonly normalMap?: StudioTexture;
  readonly normalScale?: number;
  /** How much the normal map's occlusion applies (0..1, default 1). */
  readonly aoMap?: number;
  /** The darkest the vertex AO may make it (default 0.25). */
  readonly aoFloor?: number;
  readonly doubleSided?: boolean;
  /** Albedo map (sRGB; its alpha mixes it over the base). */
  readonly map?: StudioTexture;
  /** A polished front chamfer: its roughness, how much lighter, and the object z above which it applies. */
  readonly edge?: readonly [number, number, number];
}

export interface GlassMaterial {
  readonly kind: "glass";
  readonly print: StudioTexture;
  readonly screen: StudioTexture | null;
  /** The screen's rectangle in the glass's uv: u0, v0, u1, v1. */
  readonly screenRect: readonly [number, number, number, number];
  readonly screenGain?: number;
  readonly rough?: number;
}

export interface ClearMaterial {
  readonly kind: "clear";
  /** sRGB colour of light after one unit of wall. */
  readonly tint: Rgb;
  readonly thickness: number;
  readonly rough?: number;
  readonly refract?: number;
  readonly haze?: number;
  readonly masks?: StudioTexture;
  readonly inks?: readonly [Ink, Ink, Ink];
  readonly normalMap?: StudioTexture;
  readonly normalScale?: number;
  /** Grid tier: the parts inside, baked (bakeImpostor). */
  readonly impostor?: Impostor;
}

export type Material = StandardMaterial | GlassMaterial | ClearMaterial;

export interface DrawItem {
  readonly mesh: GpuMesh;
  readonly model: Mat4;
  readonly material: Material;
}

export interface Floor {
  /** World y of the floor. */
  readonly y: number;
  /** The shadow's square on the floor: centre (x, z) and size (x, z). */
  readonly centre: readonly [number, number];
  readonly size: readonly [number, number];
  readonly opacity?: number;
  /** Height above the floor at which a caster no longer darkens it. */
  readonly falloff?: number;
  readonly blur?: number;
  readonly casters: readonly DrawItem[];
}

/** Optional world-space light projection. Black mask pixels cast no light. */
export interface ProjectedLight {
  readonly matrix: Mat4;
  readonly direction: Vec3;
  readonly colour: Rgb;
  readonly strength: number;
  readonly mask?: StudioTexture;
}
export interface StudioFrame {
  readonly projectedLight?: ProjectedLight;
  readonly quality: Quality;
  readonly view: Mat4;
  readonly proj: Mat4;
  readonly eye: Vec3;
  /** sRGB 0..1 */
  readonly background: Rgb;
  readonly exposure?: number;
  readonly items: readonly DrawItem[];
  readonly floor?: Floor;
  /** Bloom from these items' screens (glass materials) alone. */
  readonly bloom?: { readonly items: readonly DrawItem[]; readonly strength: number };
}

export interface Impostor {
  readonly colour: StudioTexture;
  readonly depth: StudioTexture;
  /** Object-space x0, y0, x1, y1 the bake covers, and z near (front) and far. */
  readonly rect: readonly [number, number, number, number];
  readonly z: readonly [number, number];
  /** What shows where nothing was baked (sRGB). */
  readonly behind: Rgb;
}

export interface TextureOptions {
  readonly filter?: "nearest" | "linear" | "mipmap";
  readonly wrap?: "clamp" | "repeat";
  readonly anisotropy?: number;
}

export interface RendererStats { draws: number; frames: number; lastMs: number }

export interface StudioRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly samples: number;
  readonly stats: RendererStats;
  upload(mesh: MeshData): GpuMesh;
  /** Free a mesh's buffers. */
  release(mesh: GpuMesh): void;
  /** Free a texture. */
  releaseTexture(t: StudioTexture): void;
  /** Replace a mesh's AO channel (after bakeAO). */
  setAO(mesh: GpuMesh, ao: Float32Array): void;
  texture(source: TexImageSource | { width: number; height: number; data: Uint8Array }, o?: TextureOptions): StudioTexture;
  update(t: StudioTexture, source: TexImageSource | { width: number; height: number; data: Uint8Array }, o?: TextureOptions): void;
  /** A grey height map (r) to normal (rg) + occlusion (b) + height (a), mipmapped. depth: height 1 in texels. */
  bakeHeight(height: StudioTexture, o: { depth: number; aoRadius: number; aoStrength: number }): StudioTexture;
  /** Per-vertex ambient visibility of `receiver` (placed by `model`) against `occluders`, from `directions` directions. */
  bakeAO(receiver: GpuMesh, model: Mat4, occluders: readonly { mesh: GpuMesh; model: Mat4 }[], o?: { directions?: number; size?: number; bias?: number }): Float32Array;
  /** The parts inside a clear shell, seen from the front, as a colour + depth height field (grid tier). */
  bakeImpostor(items: readonly DrawItem[], o: { rect: readonly [number, number, number, number]; z: readonly [number, number]; behind: Rgb; size: readonly [number, number] }): Impostor;
  /** Draw a frame at width x height into the context's canvas (resized to fit; with `shareCanvas`, grown only, the
   *  frame in its corner). Returns where the picture is in the canvas's image (top-left origin), for drawImage. */
  /** Update vertex positions/normals without changing topology or GPU ownership. */
  deform(mesh: GpuMesh, positions: Float32Array, normals: Float32Array): void;
  render(frame: StudioFrame, width: number, height: number): Blit;
  /**
   * Get ready ahead of time, so no frame pays for it later: every program compiled (in parallel where
   * KHR_parallel_shader_compile is, each finished on a later tick once it's done) and, with a size, the render targets
   * (and a shared canvas) grown to it. Opt-in; resolves when all is built. Call it while the page is idle.
   */
  prepare(o?: { width?: number; height?: number }): Promise<void>;
  readonly lost: boolean;
  dispose(): void;
}

interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation> }

/** Where a rendered frame sits in the canvas's image (CSS/2D coordinates: origin top left). */
export interface Blit { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface RendererOptions {
  /** One context drawing many views (a gallery of cards): the canvas only grows, each frame is drawn into its
   *  bottom-left corner and copied out with drawImage by the caller. Off by default (the canvas is the view). */
  readonly shareCanvas?: boolean;
  readonly studio?: Studio;
  /** MSAA samples for solo (grid uses min(4, this)). Default 4. */
  readonly samples?: number;
  /** Environment cube face size (default 128). */
  readonly envSize?: number;
}

export function createStudioRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, o: RendererOptions = {}): StudioRenderer {
  const gl = (canvas as HTMLCanvasElement).getContext("webgl2", { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("studio: WebGL2 is not available");
  const g = gl;
  let lost = false;
  (canvas as HTMLCanvasElement).addEventListener?.("webglcontextlost", (e: Event) => { e.preventDefault(); lost = true; });

  const aniso = g.getExtension("EXT_texture_filter_anisotropic");
  const maxAniso = aniso ? (g.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 1;
  const maxSamples = g.getParameter(g.MAX_SAMPLES) as number;
  const samples = Math.max(1, Math.min(o.samples ?? 4, maxSamples));
  const floatTex = true; // (RGBA32F sampling with texelFetch is core in WebGL2; only rendering to it needs an extension)
  void floatTex;

  // ---- programs
  // Programs are built in two steps: begin (compile + link requested; the GPU process works on it while the page
  // carries on) and finish (the status read, which waits for it). Each is begun the first time it's used, or ahead
  // of time by prepare(), which finishes them only once KHR_parallel_shader_compile says they're done.
  interface Pending { p: WebGLProgram; a: WebGLShader; b: WebGLShader; fs: string }
  const parallel = g.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  const shader = (type: number, src: string): WebGLShader => { const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s); return s; };
  const begin = (vs: string, fs: string): Pending => {
    const p = g.createProgram()!, a = shader(g.VERTEX_SHADER, vs), b = shader(g.FRAGMENT_SHADER, fs);
    g.attachShader(p, a); g.attachShader(p, b); g.linkProgram(p);
    return { p, a, b, fs };
  };
  const finish = ({ p, a, b, fs }: Pending): Prog => {
    if (!g.getProgramParameter(p, g.LINK_STATUS) && !g.isContextLost()) {
      for (const [s, src] of [[a, "(vertex)"], [b, fs]] as const) {
        if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error("studio shader: " + g.getShaderInfoLog(s) + "\n" + src.split("\n").slice(0, 3).join("\n"));
      }
      throw new Error("studio link: " + g.getProgramInfoLog(p));
    }
    g.deleteShader(a); g.deleteShader(b);
    const u = new Map<string, WebGLUniformLocation>();
    const n = g.getProgramParameter(p, g.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i += 1) { const info = g.getActiveUniform(p, i); if (!info) continue; const loc = g.getUniformLocation(p, info.name); if (loc) u.set(info.name.replace(/\[0\]$/, ""), loc); }
    return { p, u };
  };
  const program = (vs: string, fs: string): Prog => finish(begin(vs, fs));
  const lowFs = (fs: string): string => fs.replace("#version 300 es\n", "#version 300 es\n#define LOW 1\n");
  interface Lazy { (): Prog; start(): void; ready(): boolean; built(): boolean }
  const lazy = (vs: string, fs: string): Lazy => {
    let v: Prog | undefined, pending: Pending | undefined;
    const get = (() => { if (!v) { const x = pending ?? begin(vs, fs); pending = undefined; v = finish(x); } return v; }) as Lazy;
    get.start = () => { if (!v && !pending) pending = begin(vs, fs); };
    get.ready = () => !!v || !pending || !parallel || g.isContextLost() || !!g.getProgramParameter(pending.p, parallel.COMPLETION_STATUS_KHR);
    get.built = () => !!v;
    return get;
  };
  const P = {
    standard: lazy(MAIN_VS, STANDARD_FS),
    standardLow: lazy(MAIN_VS, lowFs(STANDARD_FS)),
    glass: lazy(MAIN_VS, GLASS_FS),
    emissive: lazy(MAIN_VS, EMISSIVE_FS),
    clear: lazy(MAIN_VS, CLEAR_FS),
    floor: lazy(FLOOR_VS, FLOOR_FS),
    caster: lazy(MAIN_VS, CASTER_FS),
    blur: lazy(FULLSCREEN_VS, BLUR_FS),
    composite: lazy(FULLSCREEN_VS, COMPOSITE_FS),
    height: lazy(FULLSCREEN_VS, HEIGHT_BAKE_FS),
    depth: lazy(MAIN_VS, DEPTH_FS),
    impDepth: lazy(MAIN_VS, IMPOSTOR_DEPTH_FS),
    aoPoints: lazy(AO_POINTS_VS, AO_POINTS_FS),
  };
  let current: Prog | null = null;
  const use = (p: Prog): Prog => { if (current !== p) { g.useProgram(p.p); current = p; } return p; };
  const U = {
    f: (p: Prog, n: string, v: number) => { const l = p.u.get(n); if (l) g.uniform1f(l, v); },
    i: (p: Prog, n: string, v: number) => { const l = p.u.get(n); if (l) g.uniform1i(l, v); },
    v2: (p: Prog, n: string, a: number, b: number) => { const l = p.u.get(n); if (l) g.uniform2f(l, a, b); },
    v3: (p: Prog, n: string, v: Vec3) => { const l = p.u.get(n); if (l) g.uniform3f(l, v[0], v[1], v[2]); },
    v4: (p: Prog, n: string, a: number, b: number, c: number, d: number) => { const l = p.u.get(n); if (l) g.uniform4f(l, a, b, c, d); },
    m4: (p: Prog, n: string, m: Mat4) => { const l = p.u.get(n); if (l) g.uniformMatrix4fv(l, false, m); },
    m3: (p: Prog, n: string, m: Float32Array) => { const l = p.u.get(n); if (l) g.uniformMatrix3fv(l, false, m); },
  };
  const lin = (c: Rgb): [number, number, number] => [c[0], c[1], c[2]].map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [number, number, number];

  // ---- the fullscreen triangle's (empty) vertex array
  const emptyVao = g.createVertexArray()!;
  const unitQuadVao = g.createVertexArray()!;
  {
    g.bindVertexArray(unitQuadVao);
    const b = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
    g.bindVertexArray(null);
  }

  // ---- textures
  const setParams = (target: number, o: TextureOptions = {}, mips = false): void => {
    const f = o.filter ?? "mipmap";
    g.texParameteri(target, g.TEXTURE_MAG_FILTER, f === "nearest" ? g.NEAREST : g.LINEAR);
    g.texParameteri(target, g.TEXTURE_MIN_FILTER, f === "nearest" ? g.NEAREST : f === "linear" || !mips ? g.LINEAR : g.LINEAR_MIPMAP_LINEAR);
    const w = o.wrap === "repeat" ? g.REPEAT : g.CLAMP_TO_EDGE;
    g.texParameteri(target, g.TEXTURE_WRAP_S, w); g.texParameteri(target, g.TEXTURE_WRAP_T, w);
    if (aniso && f === "mipmap" && mips) g.texParameterf(target, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(maxAniso, o.anisotropy ?? 8));
  };
  const upload = (t: StudioTexture, source: TexImageSource | { width: number; height: number; data: Uint8Array }, o: TextureOptions = {}): void => {
    g.bindTexture(g.TEXTURE_2D, t.tex);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if ("data" in source) {
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, source.width, source.height, 0, g.RGBA, g.UNSIGNED_BYTE, source.data);
      t.width = source.width; t.height = source.height;
    } else {
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, source);
      const s = source as { width: number; height: number };
      t.width = s.width; t.height = s.height;
    }
    const mips = (o.filter ?? "mipmap") === "mipmap";
    if (mips) g.generateMipmap(g.TEXTURE_2D);
    setParams(g.TEXTURE_2D, o, mips);
  };
  const texture = (source: TexImageSource | { width: number; height: number; data: Uint8Array }, o: TextureOptions = {}): StudioTexture => {
    const t: StudioTexture = { tex: g.createTexture()!, width: 0, height: 0 };
    upload(t, source, o);
    return t;
  };
  const emptyTex = (w: number, h: number, internal: number = g.RGBA8, format: number = g.RGBA, type: number = g.UNSIGNED_BYTE, filter: number = g.LINEAR): WebGLTexture => {
    const t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filter);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  };
  const fboFor = (tex: WebGLTexture, depth?: WebGLRenderbuffer | WebGLTexture, depthIsTex = false): WebGLFramebuffer => {
    const f = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, f);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    if (depth) {
      if (depthIsTex) g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, depth as WebGLTexture, 0);
      else g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, depth as WebGLRenderbuffer);
    }
    return f;
  };
  const white = texture({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) }, { filter: "nearest" });
  const black = texture({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }, { filter: "nearest" });

  // ---- the prefiltered studio (RGBM cube, one mip per roughness step)
  const envSize = o.envSize ?? 128;
  const envLevels = Math.round(Math.log2(envSize)) - 1; // down to 4 x 4
  const env = g.createTexture()!;
  {
    g.bindTexture(g.TEXTURE_CUBE_MAP, env);
    g.texStorage2D(g.TEXTURE_CUBE_MAP, envLevels, g.RGBA8, envSize, envSize);
    g.texParameteri(g.TEXTURE_CUBE_MAP, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_CUBE_MAP, g.TEXTURE_MAG_FILTER, g.LINEAR);
    for (const w of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T, g.TEXTURE_WRAP_R]) g.texParameteri(g.TEXTURE_CUBE_MAP, w, g.CLAMP_TO_EDGE);
    const pf = program(FULLSCREEN_VS, prefilterFs(o.studio ?? STUDIO));
    use(pf);
    const f = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, f);
    g.disable(g.DEPTH_TEST); g.disable(g.BLEND); g.disable(g.CULL_FACE);
    g.bindVertexArray(emptyVao);
    for (let level = 0; level < envLevels; level += 1) {
      const size = envSize >> level;
      U.f(pf, "uRough", level / (envLevels - 1));
      for (let face = 0; face < 6; face += 1) {
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_CUBE_MAP_POSITIVE_X + face, env, level);
        g.viewport(0, 0, size, size);
        U.i(pf, "uFace", face);
        g.drawArrays(g.TRIANGLES, 0, 3);
      }
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.deleteFramebuffer(f);
    g.deleteProgram(pf.p); current = null;
  }

  // ---- render targets (grown to the largest asked; a frame uses its corner)
  interface Targets {
    w: number; h: number; samples: number;
    msaa: WebGLFramebuffer; colourRb: WebGLRenderbuffer; depthRb: WebGLRenderbuffer;
    scene: WebGLTexture; sceneFbo: WebGLFramebuffer;
    bloomA: WebGLTexture; bloomB: WebGLTexture; bloomFboA: WebGLFramebuffer; bloomFboB: WebGLFramebuffer; bw: number; bh: number;
  }
  let T: Targets | null = null;
  const targets = (w: number, h: number, s: number): Targets => {
    if (T && T.w >= w && T.h >= h && T.samples === s) return T;
    const W = Math.max(w, T?.w ?? 0, 64), H = Math.max(h, T?.h ?? 0, 64);
    const rw = Math.ceil(W / 64) * 64, rh = Math.ceil(H / 64) * 64;
    if (T) for (const x of [T.msaa, T.sceneFbo, T.bloomFboA, T.bloomFboB]) g.deleteFramebuffer(x);
    if (T) { g.deleteRenderbuffer(T.colourRb); g.deleteRenderbuffer(T.depthRb); for (const x of [T.scene, T.bloomA, T.bloomB]) g.deleteTexture(x); }
    const colourRb = g.createRenderbuffer()!, depthRb = g.createRenderbuffer()!;
    g.bindRenderbuffer(g.RENDERBUFFER, colourRb);
    g.renderbufferStorageMultisample(g.RENDERBUFFER, s, g.RGBA8, rw, rh);
    g.bindRenderbuffer(g.RENDERBUFFER, depthRb);
    g.renderbufferStorageMultisample(g.RENDERBUFFER, s, g.DEPTH_COMPONENT24, rw, rh);
    const msaa = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, msaa);
    g.framebufferRenderbuffer(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.RENDERBUFFER, colourRb);
    g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, depthRb);
    const scene = emptyTex(rw, rh), sceneFbo = fboFor(scene);
    const bw = Math.max(16, rw >> 2), bh = Math.max(16, rh >> 2);
    const bloomA = emptyTex(bw, bh), bloomB = emptyTex(bw, bh);
    T = { w: rw, h: rh, samples: s, msaa, colourRb, depthRb, scene, sceneFbo, bloomA, bloomB, bloomFboA: fboFor(bloomA), bloomFboB: fboFor(bloomB), bw, bh };
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return T;
  };

  // ---- contact shadow targets
  const SH = 256;
  const shadowA = emptyTex(SH, SH), shadowB = emptyTex(SH, SH);
  const shadowFboA = fboFor(shadowA), shadowFboB = fboFor(shadowB);
  g.bindFramebuffer(g.FRAMEBUFFER, null);

  // ---- meshes
  const meshes = new Set<GpuMesh>();
  const uploadMesh = (m: MeshData): GpuMesh => {
    const vao = g.createVertexArray()!;
    g.bindVertexArray(vao);
    const bufs: WebGLBuffer[] = [];
    const attr = (loc: number, data: Float32Array, size: number): WebGLBuffer => {
      const b = g.createBuffer()!; bufs.push(b);
      g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
      g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, size, g.FLOAT, false, 0, 0);
      return b;
    };
    attr(0, m.positions, 3); attr(1, m.normals, 3); attr(2, m.uvs, 2);
    const aoBuffer = attr(3, m.ao, 1);
    const ib = g.createBuffer()!;
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ib); g.bufferData(g.ELEMENT_ARRAY_BUFFER, m.indices, g.STATIC_DRAW);
    g.bindVertexArray(null);
    const gm: GpuMesh = { vao, count: m.indices.length, source: m, aoBuffer, buffers: [...bufs, ib] } as GpuMesh;
    meshes.add(gm);
    return gm;
  };
  const deform = (m: GpuMesh, positions: Float32Array, normals: Float32Array): void => {
    if (!meshes.has(m)) throw new Error("Mesh does not belong to this renderer");
    if (positions.length !== m.source.positions.length || normals.length !== m.source.normals.length) throw new Error("Mesh deformation must preserve vertex count");
    const previous = g.getParameter(g.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    g.bindBuffer(g.ARRAY_BUFFER, m.buffers[0]!); g.bufferSubData(g.ARRAY_BUFFER, 0, positions);
    g.bindBuffer(g.ARRAY_BUFFER, m.buffers[1]!); g.bufferSubData(g.ARRAY_BUFFER, 0, normals);
    m.source.positions.set(positions); m.source.normals.set(normals);
    g.bindBuffer(g.ARRAY_BUFFER, previous);
  };
  const setAO = (m: GpuMesh, ao: Float32Array): void => {
    g.bindBuffer(g.ARRAY_BUFFER, m.aoBuffer); g.bufferData(g.ARRAY_BUFFER, ao, g.STATIC_DRAW);
    m.source.ao.set(ao);
  };

  const stats: RendererStats = { draws: 0, frames: 0, lastMs: 0 };
  const drawMesh = (m: GpuMesh): void => { g.bindVertexArray(m.vao); g.drawElements(g.TRIANGLES, m.count, g.UNSIGNED_INT, 0); stats.draws += 1; };
  const bindTex = (unit: number, t: WebGLTexture, target: number = g.TEXTURE_2D): void => { g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(target, t); };

  const setCommon = (p: Prog, frame: StudioFrame, viewProj: Mat4): void => {
    U.m4(p, "uViewProj", viewProj);
    U.v3(p, "uEye", frame.eye);
    U.f(p, "uExposure", frame.exposure ?? 1);
    U.f(p, "uEnvLod", envLevels - 1);
    const light=frame.projectedLight;
    U.f(p,"uProjectedStrength",light?.strength??0);
    bindTex(7,light?.mask?.tex??white.tex);U.i(p,"uProjectedMask",7);
    if(light){U.m4(p,"uProjectedMatrix",light.matrix);U.v3(p,"uProjectedDirection",light.direction);U.v3(p,"uProjectedColour",light.colour);}
    bindTex(0, env, g.TEXTURE_CUBE_MAP); U.i(p, "uEnv", 0);
  };
  const setModel = (p: Prog, m: Mat4): void => { U.m4(p, "uModel", m); U.m3(p, "uNormalMat", normalMatrix(m)); };
  const setInks = (p: Prog, inks: readonly [Ink, Ink, Ink] | undefined): void => {
    const k = inks ?? [{ colour: [0, 0, 0], rough: 0.5 }, { colour: [0, 0, 0], rough: 0.5 }, { colour: [0, 0, 0], rough: 0.5 }];
    k.forEach((ink, i) => { const c = lin(ink.colour); U.v4(p, `uInk${i}`, c[0], c[1], c[2], ink.rough); });
    U.v3(p, "uInkMetal", [k[0].metal ?? 0, k[1].metal ?? 0, k[2].metal ?? 0]);
  };

  const drawStandard = (frame: StudioFrame, viewProj: Mat4, it: DrawItem, mat: StandardMaterial): void => {
    const p = use(frame.quality === "grid" ? P.standardLow() : P.standard());
    setCommon(p, frame, viewProj); setModel(p, it.model);
    U.v3(p, "uBase", lin(mat.base)); U.f(p, "uMetal", mat.metal); U.f(p, "uRough", mat.rough);
    U.v3(p, "uEmissive", mat.emissive ? lin(mat.emissive) : [0, 0, 0]);
    U.v2(p, "uGrain", mat.grain?.[0] ?? 0, mat.grain?.[1] ?? 0);
    U.f(p, "uAoFloor", mat.aoFloor ?? 0.25); U.f(p, "uOpacity", 1);
    U.i(p, "uUseMasks", mat.masks ? 1 : 0); bindTex(1, mat.masks?.tex ?? black.tex); U.i(p, "uMasks", 1); setInks(p, mat.inks);
    U.i(p, "uUseNormal", mat.normalMap ? 1 : 0); bindTex(2, mat.normalMap?.tex ?? white.tex); U.i(p, "uNormalMap", 2);
    U.f(p, "uNormalScale", mat.normalScale ?? 1); U.f(p, "uAoMap", mat.aoMap ?? 1);
    U.i(p, "uUseMap", mat.map ? 1 : 0); bindTex(3, mat.map?.tex ?? white.tex); U.i(p, "uMap", 3);
    U.v4(p, "uEdge", mat.edge?.[0] ?? 0, mat.edge?.[1] ?? 0, mat.edge?.[2] ?? -1e9, 0);
    if (mat.doubleSided) g.disable(g.CULL_FACE); else g.enable(g.CULL_FACE);
    drawMesh(it.mesh);
  };
  const drawGlass = (frame: StudioFrame, viewProj: Mat4, it: DrawItem, mat: GlassMaterial): void => {
    const p = use(P.glass());
    setCommon(p, frame, viewProj); setModel(p, it.model);
    bindTex(1, mat.print.tex); U.i(p, "uPrint", 1);
    bindTex(2, mat.screen?.tex ?? black.tex); U.i(p, "uScreen", 2);
    U.i(p, "uHasScreen", mat.screen ? 1 : 0);
    U.v4(p, "uScreenRect", mat.screenRect[0], mat.screenRect[1], mat.screenRect[2], mat.screenRect[3]);
    U.v2(p, "uScreenTexels", mat.screen?.width ?? 1, mat.screen?.height ?? 1);
    U.f(p, "uScreenGain", mat.screenGain ?? 1.15); U.f(p, "uRough", mat.rough ?? 0.035);
    U.v3(p, "uLcdBlack", [0.004, 0.004, 0.005]);
    g.enable(g.CULL_FACE);
    drawMesh(it.mesh);
  };
  const drawClear = (frame: StudioFrame, viewProj: Mat4, it: DrawItem, mat: ClearMaterial, w: number, h: number, impostor: boolean): void => {
    const p = use(P.clear());
    setCommon(p, frame, viewProj); setModel(p, it.model);
    bindTex(3, T!.scene); U.i(p, "uScene", 3);
    U.v2(p, "uViewport", T!.w, T!.h);
    void w; void h;
    U.v3(p, "uTint", lin(mat.tint)); U.f(p, "uThickness", mat.thickness); U.f(p, "uRough", mat.rough ?? 0.06);
    U.f(p, "uRefract", mat.refract ?? 0.02); U.f(p, "uHaze", mat.haze ?? 0.25);
    U.i(p, "uUseMasks", mat.masks ? 1 : 0); bindTex(1, mat.masks?.tex ?? black.tex); U.i(p, "uMasks", 1); setInks(p, mat.inks);
    U.i(p, "uUseNormal", mat.normalMap ? 1 : 0); bindTex(2, mat.normalMap?.tex ?? white.tex); U.i(p, "uNormalMap", 2); U.f(p, "uNormalScale", mat.normalScale ?? 1);
    U.m4(p, "uViewMat", frame.view);
    const imp = impostor && mat.impostor ? mat.impostor : null;
    U.i(p, "uImpostor", imp ? 1 : 0);
    if (imp) {
      bindTex(4, imp.colour.tex); U.i(p, "uImpColour", 4);
      bindTex(5, imp.depth.tex); U.i(p, "uImpDepth", 5);
      U.v4(p, "uImpRect", imp.rect[0], imp.rect[1], imp.rect[2], imp.rect[3]);
      U.v2(p, "uImpZ", imp.z[0], imp.z[1]);
      U.v3(p, "uBehind", imp.behind);
      const inv = invert(it.model);
      U.v3(p, "uEyeObj", transformPoint(inv, frame.eye));
    } else { bindTex(4, black.tex); U.i(p, "uImpColour", 4); bindTex(5, white.tex); U.i(p, "uImpDepth", 5); }
    drawMesh(it.mesh);
  };

  const resolve = (w: number, h: number): void => {
    const t = T!;
    g.bindFramebuffer(g.READ_FRAMEBUFFER, t.msaa);
    g.bindFramebuffer(g.DRAW_FRAMEBUFFER, t.sceneFbo);
    g.blitFramebuffer(0, 0, w, h, 0, 0, w, h, g.COLOR_BUFFER_BIT, g.NEAREST);
    g.bindFramebuffer(g.FRAMEBUFFER, t.msaa);
  };

  const blur = (src: WebGLTexture, dstFbo: WebGLFramebuffer, w: number, h: number, dx: number, dy: number, scaleX = 1, scaleY = 1): void => {
    const p = use(P.blur());
    g.bindFramebuffer(g.FRAMEBUFFER, dstFbo); g.viewport(0, 0, w, h);
    bindTex(0, src); U.i(p, "uSrc", 0); U.v2(p, "uStep", dx, dy); U.v2(p, "uScale", scaleX, scaleY);
    g.bindVertexArray(emptyVao); g.drawArrays(g.TRIANGLES, 0, 3);
  };

  const contactShadow = (frame: StudioFrame, f: Floor): void => {
    // Casters seen from below, looking up: x right, z toward the viewer flipped so the texture lies on the floor's uv.
    const [cx, cz] = f.centre, [sx, sz] = f.size, falloff = f.falloff ?? 0.5;
    const view = lookAt([cx, f.y - 0.001, cz], [cx, f.y + 1, cz], [0, 0, 1]);
    const proj = orthographic(-sx / 2, sx / 2, -sz / 2, sz / 2, 0, falloff + 0.002);
    // (Looking up flips x: mirror it back so the texture's u runs with world x.)
    const flip = identity(); flip[0] = -1;
    const vp = multiply(flip, multiply(proj, view));
    const p = use(P.caster());
    g.bindFramebuffer(g.FRAMEBUFFER, shadowFboA); g.viewport(0, 0, SH, SH);
    g.clearColor(0, 0, 0, 1); g.clear(g.COLOR_BUFFER_BIT);
    g.disable(g.DEPTH_TEST); g.disable(g.CULL_FACE);
    g.enable(g.BLEND); g.blendEquation(g.MAX); g.blendFunc(g.ONE, g.ONE);
    U.m4(p, "uViewProj", vp); U.f(p, "uFloorY", f.y); U.f(p, "uFalloff", falloff);
    for (const c of f.casters) { setModel(p, c.model); drawMesh(c.mesh); }
    g.disable(g.BLEND); g.blendEquation(g.FUNC_ADD);
    const r = (f.blur ?? 1.5) / SH;
    blur(shadowA, shadowFboB, SH, SH, r, 0); blur(shadowB, shadowFboA, SH, SH, 0, r);
    blur(shadowA, shadowFboB, SH, SH, r * 2.2, 0); blur(shadowB, shadowFboA, SH, SH, 0, r * 2.2);
    void frame;
  };

  const render = (frame: StudioFrame, width: number, height: number): Blit => {
    if (lost || g.isContextLost()) return { x: 0, y: 0, width: 0, height: 0 };
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const solo = frame.quality === "solo";
    const t = targets(w, h, samples);
    if (frame.floor) contactShadow(frame, frame.floor);
    const viewProj = multiply(frame.proj, frame.view);
    const bg = frame.background;

    g.bindFramebuffer(g.FRAMEBUFFER, t.msaa);
    g.viewport(0, 0, w, h);
    g.clearColor(bg[0], bg[1], bg[2], 1); g.clearDepth(1);
    g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    g.enable(g.DEPTH_TEST); g.depthFunc(g.LEQUAL); g.depthMask(true);
    g.disable(g.BLEND); g.enable(g.CULL_FACE); g.cullFace(g.BACK);

    // Floor first (it writes depth so nothing shows through it from above).
    if (frame.floor) {
      const p = use(P.floor()), f = frame.floor;
      U.m4(p, "uViewProj", viewProj);
      U.v4(p, "uRect", f.centre[0] - f.size[0] / 2, f.centre[1] - f.size[1] / 2, f.centre[0] + f.size[0] / 2, f.centre[1] + f.size[1] / 2);
      U.f(p, "uY", f.y); U.v3(p, "uBackground", bg); U.f(p, "uOpacity", f.opacity ?? 0.85);
      bindTex(0, shadowA); U.i(p, "uShadow", 0);
      g.disable(g.CULL_FACE); g.depthMask(false);
      g.bindVertexArray(unitQuadVao); g.drawArrays(g.TRIANGLES, 0, 6);
      g.depthMask(true); g.enable(g.CULL_FACE);
    }

    const clear: DrawItem[] = [];
    for (const it of frame.items) {
      const m = it.material;
      if (m.kind === "standard") drawStandard(frame, viewProj, it, m);
      else if (m.kind === "glass") drawGlass(frame, viewProj, it, m);
      else clear.push(it);
    }

    if (clear.length) {
      g.depthMask(false);
      if (solo) {
        // The walls' insides (back faces) refract what's behind them, then the outsides refract that.
        resolve(w, h); g.cullFace(g.FRONT);
        for (const it of clear) drawClear(frame, viewProj, it, it.material as ClearMaterial, w, h, false);
        resolve(w, h); g.cullFace(g.BACK);
        for (const it of clear) drawClear(frame, viewProj, it, it.material as ClearMaterial, w, h, false);
      } else {
        resolve(w, h); g.cullFace(g.BACK);
        for (const it of clear) drawClear(frame, viewProj, it, it.material as ClearMaterial, w, h, true);
      }
      g.depthMask(true);
    }

    resolve(w, h);

    // Bloom: the screens alone, a quarter size, blurred twice.
    let bloomOn = false;
    if (solo && frame.bloom && frame.bloom.items.length && frame.bloom.strength > 0) {
      bloomOn = true;
      const bw = Math.max(4, w >> 2), bh = Math.max(4, h >> 2);
      g.bindFramebuffer(g.FRAMEBUFFER, t.bloomFboA); g.viewport(0, 0, bw, bh);
      g.clearColor(0, 0, 0, 1); g.clear(g.COLOR_BUFFER_BIT);
      g.disable(g.DEPTH_TEST);
      const p = use(P.emissive());
      U.m4(p, "uViewProj", viewProj);
      for (const it of frame.bloom.items) {
        const m = it.material; if (m.kind !== "glass" || !m.screen) continue;
        setModel(p, it.model);
        bindTex(1, m.print.tex); U.i(p, "uPrint", 1); bindTex(2, m.screen.tex); U.i(p, "uScreen", 2);
        U.v4(p, "uScreenRect", m.screenRect[0], m.screenRect[1], m.screenRect[2], m.screenRect[3]); U.f(p, "uScreenGain", m.screenGain ?? 1.15);
        drawMesh(it.mesh);
      }
      // (The blur steps are in the bloom texture's own texels; the scene's corner maps to its corner.)
      const sx = 1 / t.bw, sy = 1 / t.bh, kx = bw / t.bw, ky = bh / t.bh;
      for (const k of [1, 2.5]) { blur(t.bloomA, t.bloomFboB, bw, bh, sx * k, 0, kx, ky); blur(t.bloomB, t.bloomFboA, bw, bh, 0, sy * k, kx, ky); }
      g.enable(g.DEPTH_TEST);
    }

    // Composite into the canvas.
    const cv = canvas as { width: number; height: number };
    if (o.shareCanvas) {
      if (cv.width < w || cv.height < h) { cv.width = Math.max(cv.width, Math.ceil(w / 64) * 64); cv.height = Math.max(cv.height, Math.ceil(h / 64) * 64); }
    } else if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, w, h);
    g.disable(g.DEPTH_TEST); g.disable(g.CULL_FACE);
    const p = use(P.composite());
    bindTex(0, t.scene); U.i(p, "uScene", 0);
    bindTex(1, t.bloomA); U.i(p, "uBloom", 1);
    U.f(p, "uBloomStrength", bloomOn ? frame.bloom!.strength : 0);
    U.v2(p, "uScale", w / t.w, h / t.h);
    U.v2(p, "uBloomScale", Math.max(4, w >> 2) / t.bw, Math.max(4, h >> 2) / t.bh);
    g.bindVertexArray(emptyVao); g.drawArrays(g.TRIANGLES, 0, 3);
    stats.frames += 1;
    stats.lastMs = typeof performance !== "undefined" ? performance.now() - t0 : 0;
    return { x: 0, y: cv.height - h, width: w, height: h };
  };

  // ---- bakes
  const bakeHeight = (height: StudioTexture, o: { depth: number; aoRadius: number; aoStrength: number }): StudioTexture => {
    const W = height.width, H = height.height;
    const out: StudioTexture = { tex: g.createTexture()!, width: W, height: H };
    g.bindTexture(g.TEXTURE_2D, out.tex);
    const levels = Math.floor(Math.log2(Math.max(W, H))) + 1;
    g.texStorage2D(g.TEXTURE_2D, levels, g.RGBA8, W, H);
    const f = fboFor(out.tex);
    const p = use(P.height());
    g.viewport(0, 0, W, H);
    g.disable(g.DEPTH_TEST); g.disable(g.BLEND); g.disable(g.CULL_FACE);
    bindTex(0, height.tex); U.i(p, "uHeight", 0);
    U.v2(p, "uTexel", 1 / W, 1 / H); U.f(p, "uDepth", o.depth); U.f(p, "uAoRadius", o.aoRadius); U.f(p, "uAoStrength", o.aoStrength);
    g.bindVertexArray(emptyVao); g.drawArrays(g.TRIANGLES, 0, 3);
    g.bindFramebuffer(g.FRAMEBUFFER, null); g.deleteFramebuffer(f);
    g.bindTexture(g.TEXTURE_2D, out.tex); g.generateMipmap(g.TEXTURE_2D);
    setParams(g.TEXTURE_2D, { filter: "mipmap", anisotropy: 8 }, true);
    return out;
  };

  const bakeAO = (receiver: GpuMesh, model: Mat4, occluders: readonly { mesh: GpuMesh; model: Mat4 }[], o: { directions?: number; size?: number; bias?: number } = {}): Float32Array => {
    const src = receiver.source, n = src.positions.length / 3;
    const width = Math.min(1024, Math.max(1, n)), rows = Math.ceil(n / width);
    // World-space positions and normals of the receiver, as float textures fetched by vertex id.
    const pos = new Float32Array(width * rows * 4), nor = new Float32Array(width * rows * 4);
    const nm = normalMatrix(model);
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const all: { mesh: GpuMesh; model: Mat4 }[] = [...occluders];
    for (const oc of all) {
      const P3 = oc.mesh.source.positions;
      for (let k = 0; k < P3.length; k += 3) { const q = transformPoint(oc.model, [P3[k]!, P3[k + 1]!, P3[k + 2]!]); for (let a = 0; a < 3; a += 1) { min[a] = Math.min(min[a]!, q[a]!); max[a] = Math.max(max[a]!, q[a]!); } }
    }
    for (let i = 0; i < n; i += 1) {
      const q = transformPoint(model, [src.positions[i * 3]!, src.positions[i * 3 + 1]!, src.positions[i * 3 + 2]!]);
      pos.set([q[0], q[1], q[2], 1], i * 4);
      const x = src.normals[i * 3]!, y = src.normals[i * 3 + 1]!, z = src.normals[i * 3 + 2]!;
      const nx = nm[0]! * x + nm[3]! * y + nm[6]! * z, ny = nm[1]! * x + nm[4]! * y + nm[7]! * z, nz = nm[2]! * x + nm[5]! * y + nm[8]! * z, l = Math.hypot(nx, ny, nz) || 1;
      nor.set([nx / l, ny / l, nz / l, 0], i * 4);
      for (let a = 0; a < 3; a += 1) { min[a] = Math.min(min[a]!, q[a]!); max[a] = Math.max(max[a]!, q[a]!); }
    }
    if (!isFinite(min[0]!)) { min = [0, 0, 0]; max = [0, 0, 0]; }
    const centre: [number, number, number] = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
    const radius = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2 + 1e-3;
    const fTex = (data: Float32Array): WebGLTexture => {
      const t = g.createTexture()!; g.bindTexture(g.TEXTURE_2D, t);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA32F, width, rows, 0, g.RGBA, g.FLOAT, data);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      return t;
    };
    const posTex = fTex(pos), norTex = fTex(nor);
    const size = o.size ?? 1024;
    const depthTex = emptyTex(size, size, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, g.NEAREST);
    const depthRb = g.createRenderbuffer()!; g.bindRenderbuffer(g.RENDERBUFFER, depthRb); g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT24, size, size);
    // (Depth as a colour, 24 bits packed in rgb; the near and far planes hug the scene's bounding sphere.)
    const depthFbo = fboFor(depthTex, depthRb);
    const outTex = emptyTex(width, rows, g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, g.NEAREST), outFbo = fboFor(outTex);
    const seen = new Float64Array(n), weight = new Float64Array(n);
    const dirs = o.directions ?? 96, buf = new Uint8Array(width * rows * 4);
    const bias = o.bias ?? radius * 0.004;
    for (let k = 0; k < dirs; k += 1) {
      // Fibonacci sphere: every direction, both hemispheres (a vertex weighs those it faces).
      const y = 1 - (2 * (k + 0.5)) / dirs, r = Math.sqrt(1 - y * y), phi = k * 2.399963229728653;
      const d: [number, number, number] = [Math.cos(phi) * r, y, Math.sin(phi) * r];
      const eye: [number, number, number] = [centre[0] + d[0] * radius * 2, centre[1] + d[1] * radius * 2, centre[2] + d[2] * radius * 2];
      const up: Vec3 = Math.abs(d[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
      const vp = multiply(orthographic(-radius, radius, -radius, radius, radius * 0.9, radius * 3.1), lookAt(eye, centre, up));
      // Depth of the occluders.
      g.bindFramebuffer(g.FRAMEBUFFER, depthFbo); g.viewport(0, 0, size, size);
      g.clearColor(1, 1, 1, 1); g.clearDepth(1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      g.enable(g.DEPTH_TEST); g.depthFunc(g.LESS); g.disable(g.CULL_FACE); g.disable(g.BLEND); g.depthMask(true);
      const dp = use(P.depth()); U.m4(dp, "uViewProj", vp);
      for (const oc of all) { setModel(dp, oc.model); drawMesh(oc.mesh); }
      // The receiver's vertices against it.
      g.bindFramebuffer(g.FRAMEBUFFER, outFbo); g.viewport(0, 0, width, rows);
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.disable(g.DEPTH_TEST);
      const ap = use(P.aoPoints());
      bindTex(0, posTex); U.i(ap, "uPositions", 0); bindTex(1, norTex); U.i(ap, "uNormals", 1); bindTex(2, depthTex); U.i(ap, "uDepthMap", 2);
      U.m4(ap, "uDirViewProj", vp); U.v3(ap, "uDir", d); U.i(ap, "uWidth", width); U.f(ap, "uBias", bias);
      g.bindVertexArray(emptyVao); g.drawArrays(g.POINTS, 0, n);
      g.readPixels(0, 0, width, rows, g.RGBA, g.UNSIGNED_BYTE, buf);
      for (let i = 0; i < n; i += 1) { seen[i] = seen[i]! + buf[i * 4]! / 255; weight[i] = weight[i]! + buf[i * 4 + 1]! / 255; }
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    for (const x of [posTex, norTex, depthTex, outTex]) g.deleteTexture(x);
    g.deleteFramebuffer(depthFbo); g.deleteFramebuffer(outFbo); g.deleteRenderbuffer(depthRb);
    const ao = new Float32Array(n);
    for (let i = 0; i < n; i += 1) ao[i] = weight[i]! > 1e-6 ? seen[i]! / weight[i]! : 1;
    return ao;
  };

  const bakeImpostor = (items: readonly DrawItem[], o: { rect: readonly [number, number, number, number]; z: readonly [number, number]; behind: Rgb; size: readonly [number, number] }): Impostor => {
    const [W, H] = o.size;
    const [x0, y0, x1, y1] = o.rect, [zn, zf] = o.z;
    // Front orthographic camera in the items' space: looking down -z from zn.
    const view = lookAt([0, 0, zn], [0, 0, zn - 1], [0, 1, 0]);
    const proj = orthographic(x0, x1, y0, y1, 0, zn - zf);
    const colourTex = g.createTexture()!, depthTexC = g.createTexture()!;
    for (const tx of [colourTex, depthTexC]) {
      g.bindTexture(g.TEXTURE_2D, tx);
      g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8, W, H);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    }
    // Colour through the MSAA path (solo materials), then resolved into the colour texture.
    const t = targets(W, H, samples);
    const eye: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, zn + 3];
    const frame: StudioFrame = { quality: "solo", view, proj, eye, background: o.behind, items };
    const viewProj = multiply(proj, view);
    g.bindFramebuffer(g.FRAMEBUFFER, t.msaa); g.viewport(0, 0, W, H);
    g.clearColor(o.behind[0], o.behind[1], o.behind[2], 0); g.clearDepth(1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    g.enable(g.DEPTH_TEST); g.depthFunc(g.LEQUAL); g.depthMask(true); g.disable(g.BLEND); g.enable(g.CULL_FACE); g.cullFace(g.BACK);
    for (const it of items) { if (it.material.kind === "standard") drawStandard(frame, viewProj, it, it.material); else if (it.material.kind === "glass") drawGlass(frame, viewProj, it, it.material); }
    const cf = fboFor(colourTex);
    g.bindFramebuffer(g.READ_FRAMEBUFFER, t.msaa); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, cf);
    g.blitFramebuffer(0, 0, W, H, 0, 0, W, H, g.COLOR_BUFFER_BIT, g.LINEAR);
    // Depth: the nearest surface's depth, written as colour.
    const depthRb = g.createRenderbuffer()!; g.bindRenderbuffer(g.RENDERBUFFER, depthRb); g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT24, W, H);
    const df = fboFor(depthTexC, depthRb);
    g.viewport(0, 0, W, H); g.clearColor(1, 1, 1, 1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    g.enable(g.DEPTH_TEST); g.depthFunc(g.LESS); g.disable(g.CULL_FACE);
    const dp = use(P.impDepth()); U.m4(dp, "uViewProj", viewProj);
    for (const it of items) { setModel(dp, it.model); drawMesh(it.mesh); }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.deleteFramebuffer(cf); g.deleteFramebuffer(df); g.deleteRenderbuffer(depthRb);
    return { colour: { tex: colourTex, width: W, height: H }, depth: { tex: depthTexC, width: W, height: H }, rect: o.rect, z: o.z, behind: o.behind };
  };

  const dispose = (): void => {
    for (const m of meshes) g.deleteVertexArray(m.vao);
    meshes.clear();
    g.getExtension("WEBGL_lose_context")?.loseContext();
  };

  const prepare = (po: { width?: number; height?: number } = {}): Promise<void> => {
    const all = Object.values(P);
    for (const x of all) x.start();
    if (po.width && po.height && !lost) {
      targets(po.width, po.height, samples);
      const cv = canvas as { width: number; height: number };
      if (o.shareCanvas && (cv.width < po.width || cv.height < po.height)) { cv.width = Math.max(cv.width, Math.ceil(po.width / 64) * 64); cv.height = Math.max(cv.height, Math.ceil(po.height / 64) * 64); }
    }
    // One program finished per tick, and only once it's compiled: no tick waits on the GPU process.
    return new Promise<void>((done) => {
      const todo = all.filter((x) => !x.built());
      const step = () => {
        if (lost || g.isContextLost()) { done(); return; }
        const next = todo[0];
        if (!next) { done(); return; }
        if (!next.built() && !next.ready()) { setTimeout(step, 16); return; }
        todo.shift();
        try { next(); } catch { /* (it throws again, with its log, where it's used) */ }
        setTimeout(step, 0);
      };
      setTimeout(step, 0);
    });
  };

  return {
    gl: g, samples, stats, prepare,
    upload: uploadMesh, setAO,
    release: (m: GpuMesh) => { g.deleteVertexArray(m.vao); for (const b of m.buffers) g.deleteBuffer(b); meshes.delete(m); },
    releaseTexture: (t: StudioTexture) => { g.deleteTexture(t.tex); },
    texture, update: upload, deform,
    bakeHeight, bakeAO, bakeImpostor,
    render,
    get lost() { return lost || g.isContextLost(); },
    dispose,
  };
}
