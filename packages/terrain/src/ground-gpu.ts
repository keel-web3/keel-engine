// The ground on the GPU, at ANY scale: instead of a bitmap baked per chunk
// per scale (ground.ts, ground-bake.ts), each chunk uploads its mesh and a
// small tile texture ONCE (ground-gpu-data.ts), and a fragment shader paints
// the ground's pixel art where it's drawn (ground-gpu-glsl.ts) -- palette-true,
// on the global pixel grid, 2 px/m or 128, the same picture the CPU baker
// makes (the parity tool measures it) without its cost: a 64 m chunk at
// 64 px/m took the baker 6 s and 24 MB; here it's the same ~1 ms upload at
// every scale and a frame's fragment work.
//
//   const gpu = createGpuGround(gl, { palette });
//   gpu.setChunk("c3", { terrain, chunk: 3, auto, surface, extras });   // once (and on an edit)
//   gpu.updateTiles("c3", { terrain, chunk: 3, auto, surface });        // a biome paint: tiles only
//   gpu.setPalette(seasonPalette(...));                                 // a season: nothing else
//   gpu.draw(view, { time, clear });                                    // the overview (ground-gl's view)
//   sprites.drawLayers(view, units, { clear: null });                   // depth kept, as with the layers
//
// For perspective (chase, first person) `drawPerspective` paints the same
// surface into keel/render's pass-1 buffers from its raster hook (texels in
// texture space, direct palette indices: render's DIRECT_MAT), so the ground
// in 3D is the overview's ground, seen from the ground.
//
// The CPU bake stays: the reference the GPU is measured against, the path for
// custom and voxel styles (a painter is a JS function), and a fallback where
// there's no WebGL2.

import type { GroundPalette } from "./palette.ts";
import type { GroundExtra, GroundStyle, GroundView } from "./ground.ts";
import type { Terrain } from "./grid.ts";
import { autoTile } from "./autotile.ts";
import type { AutoTiles } from "./autotile.ts";
import { groundRectFor } from "./ground-bake.ts";
import type { TerrainTable } from "./types.ts";
import type { GroundSurface, SurfaceBiome } from "./surface.ts";
import { DECAL_KINDS, TEXTURE_TRAITS } from "./surface.ts";
import { GPU_TEXTURES, gpuChunkData, gpuTileData } from "./ground-gpu-data.ts";
import type { GpuChunkData, GpuChunkInput, GpuTileData } from "./ground-gpu-data.ts";
import { GPU_FS_ORTHO, GPU_FS_PERSP, GPU_FS_PRE, GPU_FS_RESOLVE, GPU_VS } from "./ground-gpu-glsl.ts";

/** The orthographic view (ground-gl's GroundDrawView: the sprite renderer's PixelView). */
export interface GpuGroundView {
  readonly center: readonly [number, number, number];
  readonly pixelsPerMetre: number;
  readonly width: number;
  readonly height: number;
  readonly axes: { readonly right: readonly [number, number, number]; readonly up: readonly [number, number, number]; readonly forward: readonly [number, number, number] };
}

/** A perspective camera (keel/render's raster hook gives these). */
export interface GpuGroundCamera {
  readonly eye: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  /** tan(fov / 2). */
  readonly tan: number;
  readonly width: number;
  readonly height: number;
  /** keel/render's FAR (depth = distance / far). */
  readonly far: number;
}

export interface GpuGroundOptions {
  readonly palette: GroundPalette;
  /** The pixel style's knobs (screen, dither, outline, gap); voxel and custom styles stay on the CPU baker. */
  readonly style?: GroundStyle;
  /** The seed the chunks' textures follow (ChunkBakeInput.seed; default 0). */
  readonly seed?: number;
}

export interface GpuDrawOptions {
  /** Seconds, for the cycling ramps. */
  readonly time?: number;
  /** Clear colour and depth first (default a dark ground colour); null draws over what's there. */
  readonly clear?: readonly [number, number, number] | null;
  /** The chunks to draw (default: all, culled to the view). */
  readonly keys?: Iterable<string>;
  /** Where the picture goes (default: the canvas). */
  readonly framebuffer?: WebGLFramebuffer | null;
  /**
   * The art's largest scale (px/m; default none: the ground is painted at the view's own scale, an art pixel a picture
   * pixel). Closer than this, an art pixel is a whole number of picture pixels -- n x n, n = ceil(k / artScale), the
   * art at k / n -- aligned to the global grid: the fixed-density look (and a pass 1 n^2 times smaller).
   */
  readonly artScale?: number;
}

export interface GpuPerspectiveOptions {
  readonly time?: number;
  readonly keys?: Iterable<string>;
  /** Texels a metre on the ground seen from the ground (default 16: a 2 m tile is 32 art pixels). */
  readonly art?: number;
  /** The world's sun (default the overview's: upper left, toward the camera). */
  readonly sun?: readonly [number, number, number];
  /** Nothing past this (m; default 150). */
  readonly cull?: number;
}

export interface GpuGround {
  setPalette(p: GroundPalette): void;
  readonly palette: GroundPalette;
  style: GroundStyle;
  /** Build (or rebuild) a chunk's mesh and tiles and upload them: ms spent (packing and upload). */
  setChunk(key: string, input: GpuChunkInput | GpuChunkData): number;
  /** Re-pack and upload only a chunk's tiles (a biome swap, creep, a re-skin: the mesh is the same): ms. */
  updateTiles(key: string, input: GpuChunkInput): number;
  has(key: string): boolean;
  drop(key: string): void;
  keys(): IterableIterator<string>;
  /** The chunk's world bounds [x0, y0, z0, x1, y1, z1]. */
  bounds(key: string): readonly [number, number, number, number, number, number] | null;
  /** The overview: the chunks through an orthographic pixel view, depth for the sprites after it. */
  draw(view: GpuGroundView, opts?: GpuDrawOptions): void;
  /** Perspective, into the bound framebuffer (keel/render's pass 1 in its raster hook). */
  drawPerspective(cam: GpuGroundCamera, opts?: GpuPerspectiveOptions): void;
  /** Blob shadows for perspective: [x, z, radius, strength] per caster (a world-space map round `center`, `size` m across, default 64). */
  setShadows(casters: Float32Array, count: number, center: readonly [number, number], size?: number): void;
  readonly stats: { readonly chunks: number; readonly bytes: number; readonly draws: number; readonly triangles: number; readonly uploads: number; readonly uploadMs: number; readonly lastUploadMs: number };
  /**
   * The last overview draw's pass 1 (tools, checks): per art pixel, rows bottom first, RGBA32UI -- x: ramp base | length
   * << 16 | flags << 24 (bit 0 exact, 1 cycling, bits 2-4 the face kind: GPU_KIND); y: its position on the ramp (float
   * bits); z: its ray depth; w: its world tile (i & 0xffff | j << 16; all ones for an extra).
   */
  readPass(): { readonly data: Uint32Array; readonly width: number; readonly height: number } | null;
  dispose(): void;
}

interface Chunk {
  data: GpuChunkData;
  vao: WebGLVertexArrayObject;
  bufs: WebGLBuffer[];
  tex: WebGLTexture;
  tiles: GpuTileData;
  surface: GroundSurface | null;
  types: TerrainTable;
  ts: number;
  sh: number;
  bytes: number;
  lava: number;
}

// (The surface's knobs, with its defaults: surface.ts createSurfaceShader.)
const knobs = (S: GroundSurface | null) => {
  const blend = S?.blend ?? {};
  return {
    jitter: blend.jitter ?? 0.34, precedence: blend.precedence ?? 0.09, dither: blend.dither ?? 1, warp: blend.warp ?? 0.42, rim: blend.rim ?? 0.16,
    bJitter: blend.biomeJitter ?? 0.8, bDither: blend.biomeDither ?? 4, macroF: 1 / (S?.macro?.size ?? 55), macroAmt: S?.macro?.amount ?? 0.2, lush: S?.macro?.lush ?? 0.3,
    ao: S?.ao ?? 0.3, aoR: S?.aoReach ?? 0.3, hShade: S?.heightShade ?? 0.022, decals: S?.decals ?? true, variants: Math.max(1, S?.variants ?? 4),
  };
};

const NAMED = ["stone", "water.shallow", "water.deep", "foam", "lava.flow", "leaf.fall", "bone"];

export function createGpuGround(gl: WebGL2RenderingContext, { palette: palette0, style: style0 = { name: "pixel" }, seed = 0 }: GpuGroundOptions): GpuGround {
  const compile = (type: number, src: string, what: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`GPU ground ${what}: ${gl.getShaderInfoLog(s) ?? "?"}`);
    return s;
  };
  const link = (vs: string, fs: string, what: string): { p: WebGLProgram; u: (n: string) => WebGLUniformLocation | null } => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, `${what} vertex`));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, `${what} fragment`));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`GPU ground ${what}: ${gl.getProgramInfoLog(p) ?? "?"}`);
    const cache = new Map<string, WebGLUniformLocation | null>();
    return { p, u: (n) => { let l = cache.get(n); if (l === undefined) { l = gl.getUniformLocation(p, n); cache.set(n, l); } return l; } };
  };
  const FULL_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  let orthoP: ReturnType<typeof link> | null = null, resolveP: ReturnType<typeof link> | null = null, perspP: ReturnType<typeof link> | null = null, preP: ReturnType<typeof link> | null = null;
  const ortho = () => (orthoP ??= link(GPU_VS, GPU_FS_ORTHO, "ortho"));
  const resolve = () => (resolveP ??= link(FULL_VS, GPU_FS_RESOLVE, "resolve"));
  const persp = () => (perspP ??= link(GPU_VS, GPU_FS_PERSP, "perspective"));
  const pre = () => (preP ??= link(GPU_VS, GPU_FS_PRE, "pre-pass"));

  const fullVao = gl.createVertexArray()!;
  gl.bindVertexArray(fullVao);
  const fullBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, fullBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const nearestTex = (): void => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  // ---- the palette, and the tables made from it, the types and the biomes
  let palette = palette0;
  let paletteTex: WebGLTexture | null = null;
  let cycles = new Int32Array(32), cycleCount = 0;
  const uploadPalette = (): void => {
    const rows = Math.max(1, Math.ceil(palette.colours.length / 1024));
    const px = new Uint8Array(1024 * rows * 4);
    palette.colours.forEach((c, i) => { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; });
    if (paletteTex) gl.deleteTexture(paletteTex);
    paletteTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    nearestTex();
    cycles = new Int32Array(32);
    cycleCount = Math.min(8, palette.cycles.length);
    palette.cycles.slice(0, 8).forEach((c, i) => { cycles[i * 4] = c.base; cycles[i * 4 + 1] = c.length; cycles[i * 4 + 2] = Math.round(c.speed * 1000); });
  };
  uploadPalette();

  // Extras' materials: one list for every chunk (a vertex's material is an index into it).
  const matList: string[] = [];
  const matIdx = new Map<string, number>();
  const matOf = (name: string): number => { let m = matIdx.get(name); if (m === undefined) { m = matList.length; matList.push(name); matIdx.set(name, m); tablesKey = ""; } return m; };

  interface Tables { table: WebGLTexture; ramps: WebGLTexture; nT: number; nB: number; rowClassic: number; rowPetal: number; rowNamed: number; rowMat: number }
  let tables: Tables | null = null;
  let tablesKey = "";
  let tableTypes: TerrainTable | null = null, tableBiomes: readonly SurfaceBiome[] = [];
  const tablesFor = (types: TerrainTable, biomes: readonly SurfaceBiome[]): Tables => {
    const key = `${palette.key}|${palette.colours.length}|${types.list.map((t) => t.name).join(",")}|${biomes.length}|${JSON.stringify(biomes.map((b) => b.decals ?? null))}|${matList.length}`;
    if (tables && key === tablesKey && tableTypes === types) return tables;
    tablesKey = key; tableTypes = types; tableBiomes = biomes;
    const list = types.list, nT = list.length, nB = Math.max(1, biomes.length);
    // Traits: [prio, freq, octaves, blocky], [amp, crisp, wear, glow], [texture, face type, cycle, 0], then per biome decals.
    const tw = nT, th = 3 + 2 * nB;
    const T = new Float32Array(tw * th * 4);
    const set = (x: number, y: number, v: readonly number[]): void => { T.set(v, (y * tw + x) * 4); };
    list.forEach((ty, id) => {
      const tr = TEXTURE_TRAITS[ty.texture] ?? TEXTURE_TRAITS.plain;
      const wear = tr.wear && types.has(tr.wear) ? types.id(tr.wear) : id;
      set(id, 0, [ty.priority, tr.freq, tr.octaves, tr.blocky]);
      set(id, 1, [tr.amp, tr.crisp ? 1 : 0, wear, ty.glow]);
      set(id, 2, [Math.max(0, GPU_TEXTURES.indexOf(ty.texture)), types.id(ty.face), ty.cycle ? 1 : 0, 0]);
      for (let b = 0; b < nB; b += 1) {
        const scale = biomes[b]?.decals ?? {};
        const cum: number[] = [];
        let acc = 0;
        DECAL_KINDS.forEach((name) => { if (name !== "cracks") acc += (tr.decals[name] ?? 0) * (scale[name] ?? 1) * 0.5; cum.push(acc); });
        set(id, 3 + 2 * b, cum.slice(0, 4));
        set(id, 4 + 2 * b, [cum[4]!, cum[5]!, (tr.decals.cracks ?? 0) * (scale.cracks ?? 1), 0]);
      }
    });
    // Ramps: rows 0..nB-1 per biome [base, len, lush base, lush len]; classic; petals; named; extras.
    const RW = Math.max(nT, 3 * nB, NAMED.length, matList.length, 1);
    const rowClassic = nB, rowPetal = nB + 1, rowNamed = nB + 2, rowMat = nB + 3, RH = nB + 4;
    const R = new Int32Array(RW * RH * 4);
    const rp = (name: string): readonly [number, number] => palette.ramps[name] ?? palette.ramps["stone"] ?? [0, 1];
    const put = (x: number, y: number, v: readonly number[]): void => { R.set(v, (y * RW + x) * 4); };
    for (let b = 0; b < nB; b += 1) list.forEach((ty, id) => {
      const a = palette.ramps[`${ty.name}@${b}`] ?? rp(ty.name), l = palette.ramps[`${ty.name}@${b}+`] ?? rp(ty.name);
      put(id, b, [a[0], a[1], l[0], l[1]]);
    });
    list.forEach((ty, id) => { const a = rp(ty.name); put(id, rowClassic, [a[0], a[1], 0, 0]); });
    for (let b = 0; b < nB; b += 1) for (let p = 0; p < 3; p += 1) { const a = palette.ramps[`petal@${b}.${p}`] ?? rp("glass"); put(b * 3 + p, rowPetal, [a[0], a[1], 0, 0]); }
    NAMED.forEach((n, i) => { const a = rp(n); put(i, rowNamed, [a[0], a[1], 0, 0]); });
    matList.forEach((n, i) => { const a = rp(n); put(i, rowMat, [a[0], a[1], n === "wood" || n === "deck" ? 1 : n === "roof" ? 2 : 0, 0]); });
    if (tables) { gl.deleteTexture(tables.table); gl.deleteTexture(tables.ramps); }
    const table = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, table);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, tw, th, 0, gl.RGBA, gl.FLOAT, T);
    nearestTex();
    const ramps = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, ramps);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32I, RW, RH, 0, gl.RGBA_INTEGER, gl.INT, R);
    nearestTex();
    tables = { table, ramps, nT, nB, rowClassic, rowPetal, rowNamed, rowMat };
    return tables;
  };

  // ---- chunks
  const chunks = new Map<string, Chunk>();
  let bytes = 0, uploads = 0, uploadMs = 0, lastUploadMs = 0, draws = 0, triangles = 0;
  const uploadTiles = (tex: WebGLTexture, t: GpuTileData): void => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, t.tw, t.th, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, t.texels);
    nearestTex();
  };
  const isData = (x: GpuChunkInput | GpuChunkData): x is GpuChunkData => (x as GpuChunkData).vertices !== undefined;

  const api: GpuGround = {
    get palette() { return palette; },
    setPalette(p) { palette = p; uploadPalette(); tablesKey = ""; },
    style: style0,
    setChunk(key, input) {
      const t0 = performance.now();
      const data = isData(input) ? input : gpuChunkData({ ...input, decks: input.decks ?? (api.style.decks ?? true), seed: input.seed ?? seed });
      const src = isData(input) ? null : input;
      api.drop(key);
      // (Chunk-local material indices to the shared list.)
      const info = data.info.slice();
      if (data.materials.length) {
        const remap = data.materials.map(matOf);
        for (let v = 0; v < data.count; v += 1) { const x = info[v * 2]!; if ((x & 15) === 5) info[v * 2] = (x & 0xff) | (remap[x >>> 8]! << 8); }
      }
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      const ib = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      gl.bufferData(gl.ARRAY_BUFFER, info, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_INT, 8, 0);
      gl.bindVertexArray(null);
      const tex = gl.createTexture()!;
      uploadTiles(tex, data.tiles);
      const b = data.vertices.byteLength + info.byteLength + data.tiles.texels.byteLength;
      const terrain = src?.terrain;
      const types = terrain?.types ?? tableTypes;
      if (!types) throw new Error("GPU ground: the first chunk must come from a terrain (its types).");
      chunks.set(key, {
        data, vao, bufs: [vb, ib], tex, tiles: data.tiles, surface: src?.surface ?? null, types,
        ts: terrain?.tileSize ?? 2, sh: terrain?.stepHeight ?? 1, bytes: b, lava: types.has("lava") ? types.id("lava") : -1,
      });
      bytes += b;
      const ms = performance.now() - t0;
      uploads += 1; uploadMs += ms; lastUploadMs = ms;
      return ms;
    },
    updateTiles(key, input) {
      const c = chunks.get(key);
      if (!c) return api.setChunk(key, input);
      const t0 = performance.now();
      const tiles = gpuTileData({ ...input, seed: input.seed ?? seed });
      if (tiles.hash !== c.tiles.hash || tiles.tw !== c.tiles.tw) {
        gl.bindTexture(gl.TEXTURE_2D, c.tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tiles.tw, tiles.th, gl.RGBA_INTEGER, gl.UNSIGNED_INT, tiles.texels);
        c.tiles = tiles;
      }
      c.surface = input.surface ?? null;
      const ms = performance.now() - t0;
      uploads += 1; uploadMs += ms; lastUploadMs = ms;
      return ms;
    },
    has: (key) => chunks.has(key),
    drop(key) {
      const c = chunks.get(key);
      if (!c) return;
      for (const b of c.bufs) gl.deleteBuffer(b);
      gl.deleteVertexArray(c.vao);
      gl.deleteTexture(c.tex);
      bytes -= c.bytes;
      chunks.delete(key);
    },
    keys: () => chunks.keys(),
    bounds: (key) => chunks.get(key)?.data.bounds ?? null,
    draw(view, { time = 0, clear = [0.05, 0.05, 0.07], keys, framebuffer = null, artScale } = {}) {
      const W = view.width, H = view.height, kF = view.pixelsPerMetre;
      const { right: R, up: U, forward: F } = view.axes;
      const C = view.center;
      // (The picture's offset at its own scale; the art's at k / n, its pixels n x n picture pixels on the global grid.)
      const n = artScale && kF > artScale ? Math.max(1, Math.ceil(kF / artScale - 1e-9)) : 1;
      const k = kF / n;
      const fdiv = (a: number, b: number): number => Math.floor(a / b);
      const offFX = Math.floor(W / 2 - (C[0] * R[0] + C[1] * R[1] + C[2] * R[2]) * kF + 0.5), offFY = Math.floor(H / 2 + (C[0] * U[0] + C[1] * U[1] + C[2] * U[2]) * kF + 0.5);
      const ax0 = fdiv(-offFX, n), ay0 = fdiv(-offFY, n);
      const WA = fdiv(W - 1 - offFX, n) - ax0 + 1, HA = fdiv(H - 1 - offFY, n) - ay0 + 1;
      const cgy = -(C[0] * U[0] + C[1] * U[1] + C[2] * U[2]) * k;
      const offX = -ax0, offY = -ay0;
      const cf = C[0] * F[0] + C[1] * F[1] + C[2] * F[2];
      const sp = -F[1], cp = Math.hypot(F[0], F[2]);
      const sy = cp > 1e-9 ? F[0] / cp : 0, cy = cp > 1e-9 ? F[2] / cp : 1;
      const gdC = (C[0] * sy + C[2] * cy) * cp;
      const target = passTarget(WA, HA);
      // Pass 1: the faces, each pixel its texel's ramp, position, kind, tile and ray depth (art pixels).
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, WA, HA);
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array(4));
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      const P = ortho();
      gl.useProgram(P.p);
      const u = P.u;
      gl.uniform1i(u("uPersp"), 0);
      gl.uniform3f(u("uRk"), R[0] * k, R[1] * k, R[2] * k);
      gl.uniform3f(u("uUk"), U[0] * k, U[1] * k, U[2] * k);
      gl.uniform2f(u("uPicture"), WA, HA);
      gl.uniform3f(u("uFwd"), F[0], F[1], F[2]);
      gl.uniform3f(u("uFwdF"), F[0], F[1], F[2]);
      gl.uniform2i(u("uOff"), offX, offY);
      gl.uniform1i(u("uRows"), HA);
      gl.uniform1f(u("uK"), k);
      // (The overview's sun: from the picture's upper left, a little toward the camera -- ground.ts.)
      const sr = [-R[0] * 0.5 - sy * 0.35, 0.85, -R[2] * 0.5 - cy * 0.35], sl = Math.hypot(sr[0]!, sr[1]!, sr[2]!);
      gl.uniform3f(u("uSun"), sr[0]! / sl, sr[1]! / sl, sr[2]! / sl);
      draws = 0; triangles = 0;
      const want = keys ? new Set(keys) : null;
      // (Nearest the camera first: the early depth test then skips what's hidden behind a chunk already drawn.)
      const order = [...chunks.entries()].filter(([key]) => !want || want.has(key));
      const depthOf = (c: Chunk): number => { const b = c.data.bounds; return ((b[0] + b[3]) / 2) * F[0] + ((b[1] + b[4]) / 2) * F[1] + ((b[2] + b[5]) / 2) * F[2]; };
      order.sort((a, b) => depthOf(a[1]) - depthOf(b[1]));
      for (const [, c] of order) {
        // (Off the picture: its bounds' corners all to one side.)
        const b = c.data.bounds;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let q = 0; q < 8; q += 1) {
          const x = q & 1 ? b[3] : b[0], y = q & 2 ? b[4] : b[1], z = q & 4 ? b[5] : b[2];
          const px = (x * R[0] + y * R[1] + z * R[2]) * k + offX, py = -(x * U[0] + y * U[1] + z * U[2]) * k + offY;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        if (x1 < -1 || y1 < -1 || x0 > WA + 1 || y0 > HA + 1) continue;
        const A = c.data.anchor;
        gl.uniform2f(u("uBase"), (A[0] * R[0] + A[1] * R[1] + A[2] * R[2]) * k + offX, -(A[0] * U[0] + A[1] * U[1] + A[2] * U[2]) * k + offY);
        gl.uniform1f(u("uTdBase"), (A[0] - C[0]) * F[0] + (A[1] - C[1]) * F[1] + (A[2] - C[2]) * F[2]);
        chunkUniforms(u, c, k);
        gl.bindVertexArray(c.vao);
        gl.drawArrays(gl.TRIANGLES, 0, c.data.count);
        draws += 1; triangles += c.data.count / 3;
      }
      gl.bindVertexArray(null);
      // Pass 2: into the picture -- neighbours, the screen, the palette, the sprites' depth.
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, W, H);
      if (clear) { gl.clearColor(clear[0], clear[1], clear[2], 1); gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      const Q = resolve();
      gl.useProgram(Q.p);
      const v = Q.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.tex); gl.uniform1i(v("uPass"), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paletteTex); gl.uniform1i(v("uPalette"), 1);
      const st = api.style;
      gl.uniform1i(v("uScreen"), st.screen ?? 4);
      gl.uniform1f(v("uDither"), st.dither ?? 0.9);
      gl.uniform1i(v("uOutline"), st.outline ?? 2);
      gl.uniform1f(v("uGap"), st.gap ?? 0.45);
      gl.uniform1i(v("uN"), n);
      gl.uniform2i(v("uOffF"), offFX, offFY);
      gl.uniform2i(v("uA0"), ax0, ay0);
      gl.uniform1i(v("uRowsF"), H);
      gl.uniform1i(v("uRowsA"), HA);
      gl.uniform4iv(v("uCycles"), cycles);
      gl.uniform1i(v("uCycleCount"), cycleCount);
      gl.uniform1f(v("uTime"), time);
      gl.uniform1f(v("uK"), k);
      gl.uniform1f(v("uSp"), sp);
      gl.uniform1f(v("uCp"), cp);
      gl.uniform1f(v("uCgy"), cgy);
      gl.uniform1f(v("uDepthC"), gdC - cf);
      gl.uniform1f(v("uRange"), (Math.max(W, H) / kF) * 4); // (keel/bake sprites.ts: uDepthRange -- the picture's own scale)
      gl.bindVertexArray(fullVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
    drawPerspective(cam, { time = 0, keys, art = 16, sun, cull = 150 } = {}) {
      const E = cam.eye;
      // The chunks in the frustum (and inside `cull`).
      const want = keys ? new Set(keys) : null;
      const tanH = cam.tan, aspect = cam.width / cam.height;
      const list: Chunk[] = [];
      for (const [key, c] of chunks) {
        if (want && !want.has(key)) continue;
        const b = c.data.bounds;
        const cx = (b[0] + b[3]) / 2 - E[0], cy = (b[1] + b[4]) / 2 - E[1], cz = (b[2] + b[5]) / 2 - E[2];
        const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
        const zz = cx * cam.forward[0] + cy * cam.forward[1] + cz * cam.forward[2];
        if (zz < -r || zz > cull + r) continue;
        const lim = Math.max(zz, 0) * tanH + r * 1.5;
        if (Math.abs(cx * cam.up[0] + cy * cam.up[1] + cz * cam.up[2]) > lim || Math.abs(cx * cam.right[0] + cy * cam.right[1] + cz * cam.right[2]) > lim * aspect + r * 0.5) continue;
        list.push(c);
      }
      // (Nearest first: the pre-pass's early depth test does the rest.)
      const dOf = (c: Chunk): number => { const b = c.data.bounds; return Math.hypot((b[0] + b[3]) / 2 - E[0], (b[2] + b[5]) / 2 - E[2]); };
      list.sort((a, b) => dOf(a) - dOf(b));
      const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const setCamera = (u: (n: string) => WebGLUniformLocation | null): void => {
        gl.uniform1i(u("uPersp"), 1);
        gl.uniform3f(u("uEyeF"), cam.forward[0], cam.forward[1], cam.forward[2]);
        gl.uniform3f(u("uEyeR"), cam.right[0], cam.right[1], cam.right[2]);
        gl.uniform3f(u("uEyeU"), cam.up[0], cam.up[1], cam.up[2]);
        gl.uniform1f(u("uTan"), cam.tan);
        gl.uniform1f(u("uAspect"), aspect);
        gl.uniform3f(u("uEyeW"), E[0], E[1], E[2]);
      };
      // Pass A (its own target): rasterised depth, early-Z, each pixel's nearest ground distance -- a trivial shader.
      const T = preTarget(cam.width, cam.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.viewport(0, 0, cam.width, cam.height);
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([0x7f7fffff, 0, 0, 0]));
      gl.depthMask(true);
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      const A = pre();
      gl.useProgram(A.p);
      setCamera(A.u);
      for (const c of list) {
        const An = c.data.anchor;
        gl.uniform3f(A.u("uRel"), An[0] - E[0], An[1] - E[1], An[2] - E[2]);
        gl.uniform3f(A.u("uAnchor"), An[0], An[1], An[2]);
        gl.bindVertexArray(c.vao);
        gl.drawArrays(gl.TRIANGLES, 0, c.data.count);
      }
      // Pass B (keel/render's pass 1): the surface, shaded only where it's the nearest ground.
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, cam.width, cam.height);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      const P = persp();
      gl.useProgram(P.p);
      const u = P.u;
      setCamera(u);
      gl.uniform1f(u("uFar"), cam.far);
      gl.uniform1f(u("uTime"), time);
      gl.uniform1f(u("uPxAtOne"), cam.height / (2 * cam.tan));
      gl.uniform1f(u("uArt"), art);
      const st = api.style;
      gl.uniform1i(u("uScreenP"), st.screen ?? 4);
      gl.uniform1f(u("uDitherP"), st.dither ?? 0.9);
      gl.uniform4iv(u("uCyclesP"), cycles);
      gl.uniform1i(u("uCycleCountP"), cycleCount);
      const s = sun ?? [-0.5, 0.75, -0.45];
      const sl = Math.hypot(s[0], s[1], s[2]) || 1;
      gl.uniform3f(u("uSun"), s[0] / sl, s[1] / sl, s[2] / sl);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, shadow.tex);
      gl.uniform1i(u("uShadow"), 4);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, T.tex);
      gl.uniform1i(u("uPre"), 5);
      gl.uniform4f(u("uShadowRect"), shadow.x0, shadow.z0, 1 / shadow.size, 1 / shadow.size);
      gl.uniform1f(u("uShadowOn"), shadow.on ? 1 : 0);
      draws = 0; triangles = 0;
      for (const c of list) {
        const An = c.data.anchor;
        gl.uniform3f(u("uRel"), An[0] - E[0], An[1] - E[1], An[2] - E[2]);
        chunkUniforms(u, c, art);
        gl.bindVertexArray(c.vao);
        gl.drawArrays(gl.TRIANGLES, 0, c.data.count);
        draws += 1; triangles += c.data.count / 3;
      }
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
    setShadows(casters, count, center, size = 64) {
      shadowSplat(casters, count, center, size);
    },
    get stats() { return { chunks: chunks.size, bytes, draws, triangles, uploads, uploadMs, lastUploadMs }; },
    readPass() {
      if (!passT) return null;
      const data = new Uint32Array(passT.w * passT.h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, passT.fb);
      gl.readPixels(0, 0, passT.w, passT.h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { data, width: passT.w, height: passT.h };
    },
    dispose() {
      for (const k of [...chunks.keys()]) api.drop(k);
      if (passT) { gl.deleteFramebuffer(passT.fb); gl.deleteTexture(passT.tex); gl.deleteRenderbuffer(passT.depth); passT = null; }
      if (preT) { gl.deleteFramebuffer(preT.fb); gl.deleteTexture(preT.tex); gl.deleteRenderbuffer(preT.depth); preT = null; }
      if (tables) { gl.deleteTexture(tables.table); gl.deleteTexture(tables.ramps); tables = null; }
      if (paletteTex) gl.deleteTexture(paletteTex);
      gl.deleteTexture(shadow.tex);
    },
  };

  // Per chunk: its tables, tiles and the surface's knobs (textures 1-3; the pass's own 0).
  function chunkUniforms(u: (n: string) => WebGLUniformLocation | null, c: Chunk, kpx: number): void {
    const S = c.surface;
    const T = tablesFor(c.types, S?.biomes ?? tableBiomes);
    const kn = knobs(S);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, c.tex); gl.uniform1i(u("uTiles"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.table); gl.uniform1i(u("uTable"), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, T.ramps); gl.uniform1i(u("uRamps"), 3);
    gl.uniform1i(u("uNT"), T.nT); gl.uniform1i(u("uNB"), T.nB);
    gl.uniform1i(u("uRowClassic"), T.rowClassic); gl.uniform1i(u("uRowPetal"), T.rowPetal); gl.uniform1i(u("uRowNamed"), T.rowNamed); gl.uniform1i(u("uRowMat"), T.rowMat);
    gl.uniform1i(u("uSurface"), S ? 1 : 0);
    gl.uniform1i(u("uBiomeOn"), S?.biome ? 1 : 0);
    gl.uniform1i(u("uLightOn"), S?.light ? 1 : 0);
    gl.uniform1i(u("uDecals"), kn.decals ? 1 : 0);
    gl.uniform1i(u("uNVar"), kn.variants);
    gl.uniform1i(u("uSdG"), (seed * 7919) | 0);
    gl.uniform1i(u("uSdS"), (seed * 7919 + 101) | 0);
    gl.uniform1f(u("uJitter"), kn.jitter); gl.uniform1f(u("uPrecedence"), kn.precedence); gl.uniform1f(u("uDitherPx"), kn.dither);
    gl.uniform1f(u("uWarp"), kn.warp); gl.uniform1f(u("uRim"), kn.rim); gl.uniform1f(u("uBJitter"), kn.bJitter); gl.uniform1f(u("uBDitherPx"), kn.bDither);
    gl.uniform1f(u("uMacroF"), kn.macroF); gl.uniform1f(u("uMacroAmt"), kn.macroAmt); gl.uniform1f(u("uLush"), kn.lush);
    gl.uniform1f(u("uAoS"), kn.ao); gl.uniform1f(u("uAoR"), kn.aoR); gl.uniform1f(u("uHShade"), kn.hShade);
    gl.uniform1f(u("uTs"), c.ts); gl.uniform1f(u("uSh"), c.sh);
    const A = c.data.anchor;
    gl.uniform3f(u("uAnchor"), A[0], A[1], A[2]);
    gl.uniform2i(u("uData0"), c.tiles.i0, c.tiles.j0);
    gl.uniform2i(u("uOrigin"), c.data.origin[0], c.data.origin[1]);
    gl.uniform2i(u("uSize"), c.data.size[0], c.data.size[1]);
    gl.uniform1i(u("uDD"), c.tiles.dd);
    gl.uniform1i(u("uLava"), c.lava);
    void kpx;
  }

  // The pass-1 target: RGBA32UI + depth, the picture's size.
  let passT: { fb: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number } | null = null;
  function passTarget(w: number, h: number): NonNullable<typeof passT> {
    if (passT && passT.w === w && passT.h === h) return passT;
    if (passT) { gl.deleteFramebuffer(passT.fb); gl.deleteTexture(passT.tex); gl.deleteRenderbuffer(passT.depth); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, w, h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null);
    nearestTex();
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    passT = { fb, tex, depth, w, h };
    return passT;
  }

  // The perspective pre-pass's target: R32UI (a distance's bits) + depth, the picture's size.
  let preT: { fb: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number } | null = null;
  function preTarget(w: number, h: number): NonNullable<typeof preT> {
    if (preT && preT.w === w && preT.h === h) return preT;
    if (preT) { gl.deleteFramebuffer(preT.fb); gl.deleteTexture(preT.tex); gl.deleteRenderbuffer(preT.depth); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, null);
    nearestTex();
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    preT = { fb, tex, depth, w, h };
    return preT;
  }

  // Blob shadows: a world-space map (256 x 256 texels) round a point, soft discs splatted on the CPU (a few hundred casters).
  const SHADOW_N = 256;
  const shadow = { tex: gl.createTexture()!, x0: 0, z0: 0, size: 64, on: false, px: new Uint8Array(SHADOW_N * SHADOW_N) };
  gl.bindTexture(gl.TEXTURE_2D, shadow.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SHADOW_N, SHADOW_N, 0, gl.RED, gl.UNSIGNED_BYTE, shadow.px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  function shadowSplat(casters: Float32Array, count: number, center: readonly [number, number], size: number): void {
    const px = shadow.px;
    px.fill(0);
    shadow.size = size; shadow.x0 = center[0] - size / 2; shadow.z0 = center[1] - size / 2;
    const s = SHADOW_N / size;
    for (let n = 0; n < count; n += 1) {
      const x = (casters[n * 4]! - shadow.x0) * s, z = (casters[n * 4 + 1]! - shadow.z0) * s, r = casters[n * 4 + 2]! * s, a = casters[n * 4 + 3]!;
      const i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(SHADOW_N - 1, Math.ceil(x + r)), j0 = Math.max(0, Math.floor(z - r)), j1 = Math.min(SHADOW_N - 1, Math.ceil(z + r));
      for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) {
        const d = Math.hypot(i + 0.5 - x, j + 0.5 - z) / Math.max(r, 1e-3);
        if (d >= 1) continue;
        const v = Math.round(255 * a * (1 - d * d));
        const o = j * SHADOW_N + i;
        if (v > px[o]!) px[o] = v;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, shadow.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADOW_N, SHADOW_N, gl.RED, gl.UNSIGNED_BYTE, px);
    shadow.on = count > 0;
  }

  return api;
}

// ---------------------------------------------------------------- a whole terrain's chunks

export interface GpuTerrainOptions {
  readonly terrain: Terrain;
  /** The auto-tiling (default: computed with `seed`, and refreshed round edits). */
  readonly auto?: AutoTiles;
  /** The surface (default: none -- the classic look). Set `surface` later for a biome swap: tiles only. */
  readonly surface?: GroundSurface | null;
  /** Boxes and wedges baked into a chunk (houses), and a key that changes when they do. */
  readonly extras?: ((chunk: number) => readonly GroundExtra[]) | null;
  readonly extrasKey?: (chunk: number) => string;
  /** Chunks round the view uploaded ahead (default 1). */
  readonly prefetch?: number;
  readonly seed?: number;
}

export interface GpuTerrain {
  readonly gpu: GpuGround;
  /** The surface: a new one (a biome swap, a re-skin) re-packs every chunk's tiles, nothing else. */
  surface: GroundSurface | null;
  /** Plan for an orthographic view (or a perspective eye and reach): the chunks it needs, visible ones first. Returns their keys. */
  plan(view: GroundView & { readonly center: readonly [number, number, number]; readonly width: number; readonly height: number }): string[];
  planAround(eye: readonly [number, number, number], reach: number): string[];
  /**
   * Upload what's missing or stale: EVERY visible chunk, whatever the budget (the ground is never missing from a
   * frame -- a fast zoom out costs that frame an upload or two instead of a blank), then the prefetch ring for up to
   * `ms` (and at most `max`). Returns chunks uploaded.
   */
  upload(ms: number, max?: number): number;
  /** Upload every chunk of the terrain now (a finite map at load: ~1.5 ms a 32 x 32 chunk -- then no zoom or pan ever uploads). */
  preload(): number;
  /** Every visible chunk uploaded? */
  readonly ready: boolean;
  /** The planned chunks' keys (what draw() wants). */
  readonly visible: readonly string[];
  /** A chunk's key. */
  keyOf(chunk: number): string;
  /** Re-pack chunks' tiles now (tiles changed but not heights -- creep, a paint). */
  touch(chunks: Iterable<number>): void;
  dispose(): void;
}

/** A finite terrain on the GPU ground: its chunks uploaded as views need them, re-uploaded when edits reach them. */
export function createGpuTerrain(gpu: GpuGround, { terrain: t, auto: auto0, surface: surface0 = null, extras = null, extrasKey = () => "", prefetch = 1, seed = 0 }: GpuTerrainOptions): GpuTerrain {
  const id = `${t.id}#${gpuTerrains++}`;
  let auto = auto0 ?? autoTile(t, { seed });
  let surface = surface0;
  const state = new Map<number, { version: number; extras: string; surface: number; heights: number }>();
  const heightVersion = new Uint32Array(t.chunksX * t.chunksZ);
  const tileVersion = new Uint32Array(t.chunksX * t.chunksZ);
  let surfaceGen = 0;
  let wanted: Array<{ chunk: number; ring: number; dist: number }> = [];
  let visible: string[] = [];
  let lo = 0, hi = 0;
  const bounds = (): void => { let a = Infinity, b = -Infinity; for (let k = 0; k < t.height.length; k += 1) { const h = t.height[k]!; if (h < a) a = h; if (h > b) b = h; } lo = (a - 2) * t.stepHeight; hi = (b + 2) * t.stepHeight + 12; };
  bounds();
  const keyOf = (c: number): string => `${id}:${c}`;
  // (An edit: its chunks and, since tiles read two round them, their neighbours -- the mesh too, heights may have moved.)
  const off = t.onChange((ch) => {
    const r = ch.rect;
    autoTile(t, { rect: [r[0] - 2, r[1] - 2, r[2] + 3, r[3] + 3], into: auto, seed });
    bounds();
    const c0 = Math.max(0, Math.floor((r[0] - 2) / t.chunk)), c1 = Math.min(t.chunksX - 1, Math.floor((r[2] + 2) / t.chunk));
    const d0 = Math.max(0, Math.floor((r[1] - 2) / t.chunk)), d1 = Math.min(t.chunksZ - 1, Math.floor((r[3] + 2) / t.chunk));
    for (let cj = d0; cj <= d1; cj += 1) for (let ci = c0; ci <= c1; ci += 1) heightVersion[cj * t.chunksX + ci]! += 1;
  });
  const input = (c: number): GpuChunkInput => ({ terrain: t, auto, chunk: c, surface, extras: extras ? extras(c) : [], seed });
  const stale = (c: number): 0 | 1 | 2 => {
    const s = state.get(c);
    if (!s || !gpu.has(keyOf(c))) return 2;
    if (s.heights !== heightVersion[c] || s.extras !== extrasKey(c)) return 2;
    if (s.surface !== surfaceGen || s.version !== tileVersion[c]) return 1;
    return 0;
  };
  const api: GpuTerrain = {
    gpu,
    get surface() { return surface; },
    set surface(s) { surface = s; surfaceGen += 1; },
    plan(v) {
      const rect = groundRectFor(v, lo, hi);
      const cs = t.chunk * t.tileSize;
      const a0 = Math.floor(rect[0] / cs), a1 = Math.floor(rect[2] / cs), b0 = Math.floor(rect[1] / cs), b1 = Math.floor(rect[3] / cs);
      wanted = [];
      for (let cj = Math.max(0, b0 - prefetch); cj <= Math.min(t.chunksZ - 1, b1 + prefetch); cj += 1) for (let ci = Math.max(0, a0 - prefetch); ci <= Math.min(t.chunksX - 1, a1 + prefetch); ci += 1) {
        const ring = Math.max(0, a0 - ci, ci - a1, b0 - cj, cj - b1);
        wanted.push({ chunk: cj * t.chunksX + ci, ring, dist: Math.hypot((ci + 0.5) * cs - v.center[0], (cj + 0.5) * cs - v.center[2]) });
      }
      wanted.sort((x, y) => x.ring - y.ring || x.dist - y.dist);
      visible = wanted.filter((w) => w.ring === 0).map((w) => keyOf(w.chunk));
      return visible;
    },
    planAround(eye, reach) {
      const cs = t.chunk * t.tileSize;
      wanted = [];
      for (let cj = 0; cj < t.chunksZ; cj += 1) for (let ci = 0; ci < t.chunksX; ci += 1) {
        const dx = Math.max(0, Math.abs((ci + 0.5) * cs - eye[0]) - cs / 2), dz = Math.max(0, Math.abs((cj + 0.5) * cs - eye[2]) - cs / 2);
        const d = Math.hypot(dx, dz);
        if (d <= reach + cs * prefetch) wanted.push({ chunk: cj * t.chunksX + ci, ring: d <= reach ? 0 : 1, dist: d });
      }
      wanted.sort((x, y) => x.ring - y.ring || x.dist - y.dist);
      visible = wanted.filter((w) => w.ring === 0).map((w) => keyOf(w.chunk));
      return visible;
    },
    upload(ms, max = Infinity) {
      const until = performance.now() + ms;
      let n = 0;
      for (const w of wanted) {
        const s = stale(w.chunk);
        if (!s) continue;
        // (What's on the picture always -- the list is visible first; the ring only inside the budget.)
        if (w.ring > 0 && (n >= max || performance.now() >= until)) break;
        const k = keyOf(w.chunk);
        if (s === 1) gpu.updateTiles(k, input(w.chunk)); else gpu.setChunk(k, input(w.chunk));
        state.set(w.chunk, { version: tileVersion[w.chunk]!, extras: extrasKey(w.chunk), surface: surfaceGen, heights: heightVersion[w.chunk]! });
        n += 1;
      }
      return n;
    },
    preload() {
      const was = wanted;
      wanted = Array.from({ length: t.chunksX * t.chunksZ }, (_, c) => ({ chunk: c, ring: 0, dist: 0 }));
      const n = api.upload(Infinity);
      wanted = was;
      return n;
    },
    get ready() { return wanted.every((w) => w.ring > 0 || !stale(w.chunk)); },
    get visible() { return visible; },
    keyOf,
    touch(chunks) { for (const c of chunks) if (c >= 0 && c < tileVersion.length) tileVersion[c]! += 1; },
    dispose() { off(); for (const c of state.keys()) gpu.drop(keyOf(c)); state.clear(); },
  };
  return api;
}
let gpuTerrains = 0;
