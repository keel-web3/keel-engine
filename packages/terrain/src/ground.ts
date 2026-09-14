// The ground baker: a chunk of terrain drawn ONCE into a static layer --
// orthographic, from the game's pixel view (its yaw and pitch, at a pixel
// scale) -- palette-true, dithered, outlined at silhouettes; then every frame
// only draws the layers as big sprites under the units.
//
// Why not through @keel-engine/render's raymarcher (as sprites are): the bake
// camera there is a perspective stand-in (a chunk 64 m across would be off by
// tens of per cent at its edges, and neighbouring chunks wouldn't meet), and a
// scene holds 256 boxes / 128 wedges. The ground is a heightfield of boxes and
// wedges seen from one fixed direction, which rasterises EXACTLY: each tile's
// top, each camera-facing cliff face, each water surface is a flat polygon;
// every texel is a ray through its pixel meeting the nearest one. The pixel
// model is the renderer's: a material's ramp, a light from the face's normal,
// a texture, a Bayer screen breaking the step between two entries, the
// outline a few entries darker where the thing behind is far behind. The
// solids are the same boxes and wedges the colliders are.
//
// PIXELS ARE GLOBAL. Texel (gx, gy) is world point P's pixel gx = P.right x k,
// gy = -P.up x k -- the same grid for every chunk, so chunks meet without a
// seam, the dither screen is anchored to the world (it doesn't crawl when the
// camera pans) and a chunk is placed by a whole-pixel offset.
//
// DEPTH, per texel (the decision -- README "Depth at cliffs"): each texel
// carries its GROUND-PLANE depth, the distance along the view's heading of
// the point it shows, height ignored (P.x sin yaw + P.z cos yaw, x cos pitch).
// A heightfield seen from above is ordered by exactly that (along a pixel's
// ray the ground only gets further), and so is a standing sprite on it (its
// ground point): a unit behind a cliff's top edge is hidden by it, a unit in
// front of a cliff face stands before it, whatever their heights -- per texel,
// no height bands, no sorting. Units are given the same depth by
// spritePosition() (a shift along the view's forward: same pixel, that depth).
//
// A texel is 4 bytes: the palette index + 1 (16 bits: 0 is empty) and the
// depth (16 bits, chunk-relative). A chunk bakes in slices (a job stepped a
// few milliseconds a frame) or in one go (bakeChunk).

import { fbm2, hash2, vnoise2 } from "@keel-engine/core";
import type { Vec3Like } from "@keel-engine/core";
import { DX4, DZ4, FLAG, WATER_NONE } from "./types.ts";
import type { TextureKind } from "./types.ts";
import { cliffFace, cornerLevels } from "./cliffs.ts";
import type { Terrain } from "./grid.ts";
import type { AutoTiles } from "./autotile.ts";
import type { GroundPalette } from "./palette.ts";
import { createSurfaceShader } from "./surface.ts";
import type { GroundSurface, SurfaceTexel } from "./surface.ts";

// ---------------------------------------------------------------- the view

export interface GroundView {
  /** The camera's heading (frame convention: 0 looks along +z). */
  readonly yaw: number;
  /** Radians below horizontal. */
  readonly pitch: number;
  readonly pixelsPerMetre: number;
}

export interface ViewAxes {
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly k: number;
  /** sin/cos of yaw and pitch. */
  readonly sy: number;
  readonly cy: number;
  readonly sp: number;
  readonly cp: number;
}

/** The pixel view's axes (exactly @keel-engine/bake pixelView's). */
export function viewAxes({ yaw, pitch, pixelsPerMetre: k }: GroundView): ViewAxes {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return { right: [cy, 0, -sy], up: [sp * sy, cp, sp * cy], forward: [sy * cp, -sp, cy * cp], k, sy, cy, sp, cp };
}

/** A world point's global pixel (x right, y down; not rounded). */
export function globalPixel(a: ViewAxes, p: Vec3Like): [number, number] {
  return [(p[0] * a.right[0] + p[2] * a.right[2]) * a.k, -(p[0] * a.up[0] + p[1] * a.up[1] + p[2] * a.up[2]) * a.k];
}

/** A point's ground-plane depth (metres along the view's heading, height ignored). */
export const groundDepth = (a: ViewAxes, x: number, z: number): number => (x * a.sy + z * a.cy) * a.cp;

/**
 * Where to put a sprite standing at `p` so the sprite renderer (depth from its
 * position along forward) gives it the ground's depth rule: the same pixel,
 * shifted along forward by its height x sin(pitch).
 *
 * `footprint` (m, default 0): how far its base reaches toward the camera from
 * `p` -- a building's, a big rock's (footprintToward gives it for a turned
 * rectangle). Its depth is then its footprint's FRONT edge's: the ground under
 * its own footprint (nearer the camera than its middle) never hides its base,
 * and ground in front of it -- a cliff's edge -- still does. (A sprite is one
 * depth: at its middle, the front half of a wide base sank into the floor.)
 * The pixel doesn't move: the shift is along the view's forward.
 */
export function spritePosition(a: ViewAxes, p: Vec3Like, out: [number, number, number] = [0, 0, 0], footprint = 0): [number, number, number] {
  // (A footprint's front edge falls between two rows of pixels: a row's worth more, so its bottom row's ground never wins.)
  const s = p[1] * a.sp - (footprint > 0 ? footprint + 1 / (a.k * Math.max(0.1, a.sp)) : 0) * a.cp;
  out[0] = p[0] + a.forward[0] * s; out[1] = p[1] + a.forward[1] * s; out[2] = p[2] + a.forward[2] * s;
  return out;
}

/** How far a rectangle (half-extents hx along its x, hz along its z, turned by `yaw`) reaches toward the camera from its middle, along the view's heading. */
export function footprintToward(a: ViewAxes, hx: number, hz: number, yaw = 0): number {
  // (The heading in the thing's own frame: its x and z axes' shares of it.)
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ax = c * a.sy - s * a.cy, az = s * a.sy + c * a.cy;
  return Math.abs(hx * ax) + Math.abs(hz * az);
}

// ---------------------------------------------------------------- style

export type GroundStyleName = "pixel" | "voxel" | "custom";

/** What a custom painter is told about a texel. */
export interface TexelInfo {
  readonly kind: "top" | "side" | "water" | "fall" | "extra";
  /** The terrain type's name (tops, sides) or the material (extras, "water"). */
  readonly material: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The face's light, 0..1. */
  readonly light: number;
  /** The tile it belongs to (-1: an extra). */
  readonly tile: number;
  /** The pixel style's own answer: the ramp and the position on it. */
  readonly ramp: string;
  readonly t: number;
}
/** A custom style: a ramp and a position on it (0..1) for a texel, or null to keep the pixel style's. */
export type GroundPainter = (texel: TexelInfo) => { readonly ramp: string; readonly t: number } | null;

export interface GroundStyle {
  readonly name: GroundStyleName;
  /** The Bayer screen (0 none, 2, 4, 8; default 4). */
  readonly screen?: 0 | 2 | 4 | 8;
  /** How far the screen reaches between entries (default 0.9). */
  readonly dither?: number;
  /** Entries darker at a silhouette (default 2; 0 off). */
  readonly outline?: number;
  /** How far behind (metres) the next texel must be for an outline (default 0.45). */
  readonly gap?: number;
  /** Voxel style: voxels a tile side (default 4). */
  readonly voxels?: number;
  /** Custom style: the painter. */
  readonly paint?: GroundPainter;
  /** Draw bridge decks and their rails (default true). */
  readonly decks?: boolean;
  /** A custom style's name in bake keys (default "custom"). */
  readonly id?: string;
}

/** The part of a bake key a style makes. */
export function groundStyleKey(s: GroundStyle): string {
  const base = `${s.name}.${s.screen ?? 4}.${s.dither ?? 0.9}.${s.outline ?? 2}.${s.gap ?? 0.45}.${s.decks ?? true ? 1 : 0}`;
  return s.name === "voxel" ? `${base}.v${s.voxels ?? 4}` : s.name === "custom" ? `${base}.${s.id ?? "custom"}` : base;
}

// ---------------------------------------------------------------- what's drawn

/** A box (or wedge) baked into the ground: a bridge's deck and rails, a building (per-texel depth, like the ground). */
export interface GroundExtra {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number;
  readonly kind?: "box" | "wedge";
  /** A wedge's foot height as a share of its height (physics' lo). */
  readonly lo?: number;
  /** A ramp name in the ground palette (wood, stone, roof, ... or a terrain type). */
  readonly mat: string;
}

const K_TOP = 1, K_SIDE = 2, K_WATER = 3, K_FALL = 4, K_EXTRA = 5;

interface Face {
  kind: number;
  /** Tile index (tops, sides, water) or -1. */
  tile: number;
  /** An extra's ramp name. */
  mat: string | null;
  xs: number[]; ys: number[]; zs: number[];
  nx: number; ny: number; nz: number; d: number;
  light: number;
  /** Only for occlusion and outlines (a neighbour's). */
  apron: boolean;
  /** A side face: its tile's dir. */
  dir: number;
}

export interface GroundLayer {
  readonly chunk: number;
  /** The bitmap's size and its top-left's global pixel. */
  readonly w: number;
  readonly h: number;
  readonly gx0: number;
  readonly gy0: number;
  /** Per texel: palette index + 1 (u16 little-endian; 0 empty), depth code (u16). */
  readonly data: Uint8Array;
  /** Ground-plane depth at code 32768, and metres a code step. */
  readonly depthRef: number;
  readonly depthStep: number;
  readonly stats: { readonly faces: number; readonly texels: number; readonly covered: number; readonly ms: number };
}

export interface ChunkBakeInput {
  readonly terrain: Terrain;
  /** The auto-tiling (autoTile over at least the chunk and a tile round it). */
  readonly auto: AutoTiles;
  readonly chunk: number;
  readonly view: GroundView;
  readonly palette: GroundPalette;
  readonly style: GroundStyle;
  /** Boxes and wedges baked in with it. */
  readonly extras?: readonly GroundExtra[];
  /** Varies textures between maps (default 0). */
  readonly seed?: number;
  /**
   * The surface (surface.ts): corner-blended materials, biome ramps, macro
   * variation, variants, decals, AO. Without it, the classic look (a fringe of
   * the overlay type along each masked edge). Its palette must be a
   * surfacePalette.
   */
  readonly surface?: GroundSurface;
  /**
   * The world tile at the terrain's (0, 0) (default [0, 0]): a world chunk
   * baked from its own small terrain (the chunk and an apron round it) lands
   * on the same global pixels as it would in one big terrain.
   */
  readonly origin?: readonly [number, number];
  /** The tiles to bake, [i0, j0, i1, j1) in the terrain (default: the chunk's rectangle). */
  readonly rect?: readonly [number, number, number, number];
}

export interface ChunkBakeJob {
  /** Work for up to `ms` milliseconds (or `faces` faces / rows when counting); true when done. */
  step(ms?: number): boolean;
  readonly done: boolean;
  /** The layer (after done). */
  result(): GroundLayer;
  /** 0..1. */
  readonly progress: number;
}

/** The depth step a terrain's layers use (metres a code; covers a chunk's extent with room). */
export const depthStepOf = (t: Terrain): number => Math.max(1 / 256, (t.chunk * t.tileSize * 2.5) / 60000);
/** A chunk's reference depth: the ground-plane depth at its middle. */
export function depthRefOf(t: Terrain, chunk: number, a: ViewAxes): number {
  const [i0, j0, i1, j1] = t.chunkRect(chunk);
  return groundDepth(a, ((i0 + i1) / 2) * t.tileSize, ((j0 + j1) / 2) * t.tileSize);
}

// Scratch buffers kept between bakes (a bake runs at a time).
let scratch = { n: 0, td: new Float32Array(0), wx: new Float32Array(0), wy: new Float32Array(0), wz: new Float32Array(0), face: new Int32Array(0) };
function scratchOf(n: number): typeof scratch {
  if (scratch.n < n) scratch = { n, td: new Float32Array(n), wx: new Float32Array(n), wy: new Float32Array(n), wz: new Float32Array(n), face: new Int32Array(n) };
  return scratch;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER2 = [0, 2, 3, 1];
function bayer(gx: number, gy: number, n: number): number {
  if (n === 0) return 0.5;
  if (n === 2) return (BAYER2[(gy & 1) * 2 + (gx & 1)]! + 0.5) / 4;
  if (n === 4) return (BAYER4[(gy & 3) * 4 + (gx & 3)]! + 0.5) / 16;
  const a = BAYER4[(gy & 3) * 4 + (gx & 3)]!, b = BAYER4[((gy >> 2) & 1) * 4 + ((gx >> 2) & 1)]!;
  return (a * 4 + (b & 3) + 0.5) / 64;
}

/** Bake a chunk in one go. */
export function bakeChunk(input: ChunkBakeInput): GroundLayer {
  const job = chunkBakeJob(input);
  while (!job.step(Infinity));
  return job.result();
}

/** A chunk bake to step a slice at a time. */
export function chunkBakeJob(input: ChunkBakeInput): ChunkBakeJob {
  const { terrain: t, auto, chunk, view, palette, style, extras = [], seed = 0, surface = null, origin = [0, 0] } = input;
  const a = viewAxes(view);
  const k = a.k;
  const ts = t.tileSize, sh = t.stepHeight;
  const [ci0, cj0, ci1, cj1] = input.rect ?? t.chunkRect(chunk);
  // (World metres of the terrain's origin: a world chunk's own terrain sits there.)
  const OX = origin[0] * ts, OZ = origin[1] * ts;
  const t0 = performance.now();
  let spent = 0;
  const voxel = style.name === "voxel";
  const vox = voxel ? ts / Math.max(1, style.voxels ?? 4) : 0;
  const screen = voxel ? 0 : style.screen ?? 4;
  const dither = style.dither ?? 0.9;
  const outline = style.outline ?? 2;
  const gap = style.gap ?? 0.45;
  const decks = style.decks ?? true;

  // The light: from the picture's upper left, a little toward the camera (the renderer's "sun" convention).
  const sunRaw = [-a.right[0] * 0.5 - a.sy * 0.35, 0.85, -a.right[2] * 0.5 - a.cy * 0.35];
  const sl = Math.hypot(sunRaw[0]!, sunRaw[1]!, sunRaw[2]!);
  const sun = [sunRaw[0]! / sl, sunRaw[1]! / sl, sunRaw[2]! / sl] as const;
  const lightOf = (nx: number, ny: number, nz: number): number => 0.3 + 0.7 * Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]);

  // ------------------------------------------------ faces
  const faces: Face[] = [];
  const floorLv = (() => { let m = Infinity; for (let kk = 0; kk < t.height.length; kk += 1) m = Math.min(m, t.height[kk]!); return m - 2; })();
  const face = (kind: number, tile: number, mat: string | null, pts: number[][], apron: boolean, dir = -1): void => {
    // (A planar polygon, counter-clockwise about its outward normal: Newell's normal, robust to a repeated corner.)
    const p0 = pts[0]!;
    let nx = 0, ny = 0, nz = 0;
    for (let v = 0; v < pts.length; v += 1) {
      const p = pts[v]!, q = pts[(v + 1) % pts.length]!;
      nx += (p[1]! - q[1]!) * (p[2]! + q[2]!); ny += (p[2]! - q[2]!) * (p[0]! + q[0]!); nz += (p[0]! - q[0]!) * (p[1]! + q[1]!);
    }
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) return;
    nx /= L; ny /= L; nz /= L;
    // (Every face here is built with its outward normal from this winding; one looking away is never seen.)
    const nf = nx * a.forward[0] + ny * a.forward[1] + nz * a.forward[2];
    if (nf > -1e-6) return;
    faces.push({ kind, tile, mat, xs: pts.map((p) => p[0]!), ys: pts.map((p) => p[1]!), zs: pts.map((p) => p[2]!), nx, ny, nz, d: nx * p0[0]! + ny * p0[1]! + nz * p0[2]!, light: lightOf(nx, ny, nz), apron, dir });
  };
  // A tile's faces: its top, its camera-facing cliff sides, its water.
  const tileFaces = (i: number, j: number, apron: boolean): void => {
    const kk = t.index(i, j);
    const c = cornerLevels(t, i, j);
    const x0 = i * ts + OX, x1 = (i + 1) * ts + OX, z0 = j * ts + OZ, z1 = (j + 1) * ts + OZ;
    // Top: counter-clockwise seen from above (normal up).
    face(K_TOP, kk, null, [[x0, c[0] * sh, z0], [x0, c[2] * sh, z1], [x1, c[3] * sh, z1], [x1, c[1] * sh, z0]], apron);
    for (let d = 0; d < 4; d += 1) {
      const f = cliffFace(t, i, j, d, floorLv);
      if (!f) continue;
      // (The edge's two ends in world order, low and high: an outward-facing quad.)
      const E = d === 0 ? [[x0, z1], [x1, z1]] : d === 1 ? [[x1, z0], [x1, z1]] : d === 2 ? [[x0, z0], [x1, z0]] : [[x0, z0], [x0, z1]];
      const [e0, e1] = E as [[number, number], [number, number]];
      const q = [[e0[0], f.low[0] * sh, e0[1]], [e1[0], f.low[1] * sh, e1[1]], [e1[0], f.high[1] * sh, e1[1]], [e0[0], f.high[0] * sh, e0[1]]];
      // Winding: outward normal = +dir. For N and W edges (listed along +x / +z) the order above faces -dir; flip.
      face(K_SIDE, kk, null, d === 0 || d === 3 ? q : q.slice().reverse(), apron, d);
    }
    const w = t.water[kk]!;
    if (w !== WATER_NONE && w > t.height[kk]!) {
      const y = w * sh;
      face(K_WATER, kk, null, [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], apron);
      // Falls: where the neighbour's water (or ground) is lower, a sheet of water down to it.
      for (let d = 0; d < 4; d += 1) {
        const ni = i + DX4[d]!, nj = j + DZ4[d]!;
        if (!t.inside(ni, nj)) continue;
        const nk = t.index(ni, nj);
        const nw = t.water[nk]!;
        const below = nw !== WATER_NONE && nw > t.height[nk]! ? nw : Math.max(...cornerLevels(t, ni, nj));
        if (below >= w) continue;
        const E = d === 0 ? [[x0, z1], [x1, z1]] : d === 1 ? [[x1, z0], [x1, z1]] : d === 2 ? [[x0, z0], [x1, z0]] : [[x0, z0], [x0, z1]];
        const [e0, e1] = E as [[number, number], [number, number]];
        const q = [[e0[0], below * sh, e0[1]], [e1[0], below * sh, e1[1]], [e1[0], y, e1[1]], [e0[0], y, e0[1]]];
        face(K_FALL, kk, null, d === 0 || d === 3 ? q : q.slice().reverse(), apron, d);
      }
    }
  };
  // Boxes and wedges (extras, decks): their faces, outward.
  const solidFaces = (s: GroundExtra, apron: boolean): void => {
    const yaw = s.yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw);
    // (Local -> world: the inverse of physics' world -> local x' = c x - s z, z' = s x + c z.)
    const W = (lx: number, ly: number, lz: number): number[] => [s.c[0] + c * lx + sn * lz, s.c[1] + ly, s.c[2] - sn * lx + c * lz];
    const [hx, hy, hz] = [s.h[0], s.h[1], s.h[2]];
    if (s.kind === "wedge") {
      const lo = Math.max(0, Math.min(0.98, s.lo ?? 0));
      const yf = -hy + 2 * hy * lo; // (the foot's top, at local +z)
      face(K_EXTRA, -1, s.mat, [W(-hx, yf, hz), W(hx, yf, hz), W(hx, hy, -hz), W(-hx, hy, -hz)], apron); // the slope
      face(K_EXTRA, -1, s.mat, [W(-hx, -hy, -hz), W(-hx, hy, -hz), W(hx, hy, -hz), W(hx, -hy, -hz)], apron); // back (-z)
      if (lo > 0) face(K_EXTRA, -1, s.mat, [W(-hx, -hy, hz), W(hx, -hy, hz), W(hx, yf, hz), W(-hx, yf, hz)], apron); // foot (+z)
      face(K_EXTRA, -1, s.mat, [W(hx, -hy, hz), W(hx, -hy, -hz), W(hx, hy, -hz), W(hx, yf, hz)], apron); // +x side
      face(K_EXTRA, -1, s.mat, [W(-hx, -hy, hz), W(-hx, yf, hz), W(-hx, hy, -hz), W(-hx, -hy, -hz)], apron); // -x side
      return;
    }
    const P = (sx: number, sy: number, sz: number): number[] => W(sx * hx, sy * hy, sz * hz);
    face(K_EXTRA, -1, s.mat, [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)], apron); // +y
    face(K_EXTRA, -1, s.mat, [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], apron); // +z
    face(K_EXTRA, -1, s.mat, [P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)], apron); // -z
    face(K_EXTRA, -1, s.mat, [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)], apron); // +x
    face(K_EXTRA, -1, s.mat, [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)], apron); // -x
  };
  const deckExtras = (i: number, j: number): GroundExtra[] => {
    const kk = t.index(i, j);
    if (!decks || !(t.flags[kk]! & FLAG.BRIDGE)) return [];
    const y = t.deck[kk]! * sh, cx = (i + 0.5) * ts + OX, cz = (j + 0.5) * ts + OZ, alongX = t.dir[kk] === 1;
    const out: GroundExtra[] = [{ c: [cx, y - 0.14, cz], h: [ts / 2, 0.14, ts / 2], mat: "deck" }];
    for (const side of [-1, 1]) out.push(alongX ? { c: [cx, y + 0.3, cz + side * (ts / 2 - 0.08)], h: [ts / 2, 0.06, 0.06], mat: "wood" } : { c: [cx + side * (ts / 2 - 0.08), y + 0.3, cz], h: [0.06, 0.06, ts / 2], mat: "wood" });
    for (const side of [-1, 1]) out.push(alongX ? { c: [cx - ts / 2 + 0.1, y + 0.18, cz + side * (ts / 2 - 0.08)], h: [0.07, 0.2, 0.07], mat: "wood" } : { c: [cx + side * (ts / 2 - 0.08), y + 0.18, cz - ts / 2 + 0.1], h: [0.07, 0.2, 0.07], mat: "wood" });
    return out;
  };
  const own = (i: number, j: number): boolean => i >= ci0 && i < ci1 && j >= cj0 && j < cj1;
  for (let j = cj0 - 1; j <= cj1; j += 1) for (let i = ci0 - 1; i <= ci1; i += 1) {
    if (!t.inside(i, j)) continue;
    const ap = !own(i, j);
    tileFaces(i, j, ap);
    for (const e of deckExtras(i, j)) solidFaces(e, ap);
  }
  for (const e of extras) solidFaces(e, false);

  // ------------------------------------------------ the bitmap's rectangle: every own face, a pixel of room
  let gxMin = Infinity, gyMin = Infinity, gxMax = -Infinity, gyMax = -Infinity;
  const proj = (f: Face): { px: number[]; py: number[] } => {
    const px: number[] = [], py: number[] = [];
    for (let v = 0; v < f.xs.length; v += 1) { const g = globalPixel(a, [f.xs[v]!, f.ys[v]!, f.zs[v]!]); px.push(g[0]); py.push(g[1]); }
    return { px, py };
  };
  const projected = faces.map(proj);
  faces.forEach((f, n) => {
    if (f.apron) return;
    const p = projected[n]!;
    gxMin = Math.min(gxMin, ...p.px); gxMax = Math.max(gxMax, ...p.px); gyMin = Math.min(gyMin, ...p.py); gyMax = Math.max(gyMax, ...p.py);
  });
  const gx0 = Math.floor(gxMin) - 1, gy0 = Math.floor(gyMin) - 1;
  const w = Math.max(1, Math.ceil(gxMax) + 1 - gx0), h = Math.max(1, Math.ceil(gyMax) + 1 - gy0);
  const N = w * h;
  const S = scratchOf(N);
  const { td, wx, wy, wz, face: fid } = S;
  td.fill(Infinity, 0, N);
  fid.fill(-1, 0, N);
  const data = new Uint8Array(N * 4);
  const depthStep = depthStepOf(t);
  const depthRef = input.rect || origin[0] || origin[1] ? groundDepth(a, ((ci0 + ci1) / 2) * ts + OX, ((cj0 + cj1) / 2) * ts + OZ) : depthRefOf(t, chunk, a);

  // ------------------------------------------------ rasterising
  const R = a.right, U = a.up, F = a.forward;
  function raster(n: number): void {
    const f = faces[n]!;
    const { px, py } = projected[n]!;
    const m = px.length;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let v = 0; v < m; v += 1) { x0 = Math.min(x0, px[v]!); x1 = Math.max(x1, px[v]!); y0 = Math.min(y0, py[v]!); y1 = Math.max(y1, py[v]!); }
    const bx0 = Math.max(0, Math.floor(x0 - gx0 - 0.5)), bx1 = Math.min(w - 1, Math.ceil(x1 - gx0));
    const by0 = Math.max(0, Math.floor(y0 - gy0 - 0.5)), by1 = Math.min(h - 1, Math.ceil(y1 - gy0));
    if (bx0 > bx1 || by0 > by1) return;
    // (Area sign: which side of each edge is inside.)
    let area = 0;
    for (let v = 0; v < m; v += 1) { const q = (v + 1) % m; area += px[v]! * py[q]! - px[q]! * py[v]!; }
    const sgn = area > 0 ? 1 : -1;
    // The ray through global pixel (GX, GY) meets the face's plane at depth t = (d - nr GX + nu GY) / nf.
    const nr = (f.nx * R[0] + f.ny * R[1] + f.nz * R[2]) / k, nu = (f.nx * U[0] + f.ny * U[1] + f.nz * U[2]) / k, nf = f.nx * F[0] + f.ny * F[1] + f.nz * F[2];
    for (let yy = by0; yy <= by1; yy += 1) {
      const GY = gy0 + yy + 0.5;
      for (let xx = bx0; xx <= bx1; xx += 1) {
        const GX = gx0 + xx + 0.5;
        let inside = true;
        for (let v = 0; v < m; v += 1) {
          const q = (v + 1) % m;
          const e = (px[q]! - px[v]!) * (GY - py[v]!) - (py[q]! - py[v]!) * (GX - px[v]!);
          if (e * sgn < -1e-9) { inside = false; break; }
        }
        if (!inside) continue;
        const tt = (f.d - nr * GX + nu * GY) / nf;
        const o = yy * w + xx;
        if (tt >= td[o]! - 1e-6) continue;
        td[o] = tt;
        const ox = GX / k, oy = -GY / k;
        wx[o] = R[0] * ox + U[0] * oy + F[0] * tt;
        wy[o] = U[1] * oy + F[1] * tt;
        wz[o] = R[2] * ox + U[2] * oy + F[2] * tt;
        fid[o] = n;
      }
    }
  }

  // ------------------------------------------------ shading
  const pal = palette;
  const typeName = t.types.list.map((ty) => ty.name);
  const texOf = t.types.list.map((ty) => ty.texture);
  const faceTypeId = t.types.list.map((ty) => t.types.id(ty.face));
  const cycling = new Set(palette.cycles.map((c) => c.name));
  const glowOf = t.types.list.map((ty) => ty.glow);
  const rOverlay = auto.rule("overlay"), rShore = auto.rule("shore"), rFoam = auto.rule("foam"), rDeep = auto.rule("deep"), rRoad = auto.rule("road"), rPath = auto.rule("path");
  const maskOf = (r: number, kk: number): number => (r < 0 ? 0 : auto.masks[r]![kk]!);
  // Each tile's highest corner, round the chunk (shadows read it per texel).
  const TI0 = Math.max(0, ci0 - 2), TJ0 = Math.max(0, cj0 - 2), TW = Math.min(t.width, ci1 + 2) - TI0, TD = Math.min(t.depth, cj1 + 2) - TJ0;
  const tops = new Int16Array(TW * TD);
  for (let j = 0; j < TD; j += 1) for (let i = 0; i < TW; i += 1) tops[j * TW + i] = Math.max(...cornerLevels(t, TI0 + i, TJ0 + j));
  const topOf = (i: number, j: number): number => (i >= TI0 && j >= TJ0 && i < TI0 + TW && j < TJ0 + TD ? tops[(j - TJ0) * TW + i - TI0]! : Math.max(...cornerLevels(t, i, j)));
  const sd = seed * 7919;
  const lava = t.types.has("lava") ? t.types.id("lava") : -1;
  // The surface: created below, once texture() exists.
  let surf: ReturnType<typeof createSurfaceShader> | null = null;
  const sOut: SurfaceTexel = { base: 0, len: 1, tv: 0, exact: false, material: 0, biome: 0 };
  const topRamp: [number, number] = [0, 1];
  // A texture's lift at a point (-0.5..0.5, mostly small).
  function texture(tex: TextureKind, x: number, z: number, y: number): number {
    switch (tex) {
      case "grass": { const n = vnoise2(x * 0.9, z * 0.9, sd + 1) - 0.5; const b = hash2(Math.floor(x * 6), Math.floor(z * 6), sd + 2); return n * 0.3 + (b > 0.93 ? 0.22 : b < 0.07 ? -0.16 : 0); }
      case "dirt": { const n = fbm2(x * 0.7, z * 0.7, sd + 3, 2) - 0.5; const b = hash2(Math.floor(x * 5), Math.floor(z * 5), sd + 4); return n * 0.35 + (b > 0.95 ? 0.18 : 0); }
      case "sand": return Math.sin((x * 0.5 + z * 1.3 + vnoise2(x * 0.4, z * 0.4, sd + 5) * 3) * 3) * 0.06 + (vnoise2(x * 1.5, z * 1.5, sd + 6) - 0.5) * 0.12;
      case "rock": { const n = fbm2(x * 0.6 + y * 0.4, z * 0.6, sd + 7, 2); const c = Math.abs(vnoise2(x * 1.4, z * 1.4 + y, sd + 8) - 0.5); return (n - 0.5) * 0.45 - (c < 0.03 ? 0.25 : 0); }
      case "snow": return (vnoise2(x * 0.5, z * 0.5, sd + 9) - 0.5) * 0.12 + 0.06;
      case "crystal": { const cx = Math.floor(x * 1.2), cz = Math.floor(z * 1.2); const hsh = hash2(cx, cz, sd + 10); const fx = x * 1.2 - cx, fz = z * 1.2 - cz; return (hsh - 0.5) * 0.3 + (fx + fz < 0.25 ? 0.2 : 0) + (fx > 0.9 || fz > 0.9 ? -0.2 : 0); }
      case "ash": return (fbm2(x * 0.8, z * 0.8, sd + 11, 2) - 0.5) * 0.3 + (hash2(Math.floor(x * 4), Math.floor(z * 4), sd + 12) > 0.96 ? 0.25 : 0);
      case "mud": return (vnoise2(x * 0.6, z * 0.6, sd + 13) - 0.5) * 0.25 + (vnoise2(x * 2, z * 2, sd + 14) > 0.8 ? 0.15 : 0);
      case "cobble": {
        // (Stones in offset rows, 0.5 m; mortar between them darker; each stone its own shade.)
        const rz = Math.floor(z * 2), off = rz & 1 ? 0.25 : 0, rx = Math.floor(x * 2 + off);
        const fx = x * 2 + off - rx, fz = z * 2 - rz;
        const mortar = fx < 0.12 || fz < 0.14;
        return mortar ? -0.3 : (hash2(rx, rz, sd + 15) - 0.5) * 0.3 + (fx < 0.35 && fz < 0.4 ? 0.1 : 0);
      }
      case "path": return (fbm2(x * 0.8, z * 0.8, sd + 16, 2) - 0.5) * 0.3 + (hash2(Math.floor(x * 7), Math.floor(z * 7), sd + 17) > 0.94 ? -0.15 : 0);
      case "ice": { const c = Math.abs(vnoise2(x * 0.9, z * 0.9, sd + 18) - 0.5); return 0.08 - (c < 0.02 ? 0.3 : 0) + (vnoise2(x * 3, z * 3, sd + 19) - 0.5) * 0.08; }
      case "flagstone": {
        // (Big irregular slabs in offset rows, 0.9 m; dark joints; each slab its own shade and a lit top-left.)
        const rz = Math.floor(z * 1.1), off = hash2(rz, 0, sd + 50) * 0.8, rx = Math.floor(x * 1.1 + off);
        const fx = x * 1.1 + off - rx, fz = z * 1.1 - rz;
        if (fx < 0.07 || fz < 0.09) return -0.34;
        return (hash2(rx, rz, sd + 51) - 0.5) * 0.24 + (fx < 0.2 || fz < 0.22 ? 0.08 : 0) + (vnoise2(x * 3, z * 3, sd + 52) - 0.5) * 0.08;
      }
      case "brick": {
        const rz = Math.floor(z * 3 + y * 3), off = rz & 1 ? 0.5 : 0, rx = Math.floor(x * 1.6 + off);
        const fx = x * 1.6 + off - rx, fz = z * 3 + y * 3 - rz;
        return fx < 0.08 || fz < 0.14 ? -0.3 : (hash2(rx, rz, sd + 53) - 0.5) * 0.2;
      }
      case "gravel": { const b = hash2(Math.floor(x * 9), Math.floor(z * 9), sd + 54); return (b - 0.5) * 0.36 + (fbm2(x * 0.8, z * 0.8, sd + 55, 2) - 0.5) * 0.18; }
      case "moss": { const n = fbm2(x * 1.3, z * 1.3, sd + 56, 2) - 0.5; const b = hash2(Math.floor(x * 7), Math.floor(z * 7), sd + 57); return n * 0.4 + (b > 0.92 ? 0.2 : 0); }
      case "clay": return (fbm2(x * 0.5, z * 0.5, sd + 58, 2) - 0.5) * 0.22 + (vnoise2(x * 2.2, z * 2.2, sd + 59) - 0.5) * 0.08;
      case "litter": { const n = fbm2(x * 1.1, z * 1.1, sd + 60, 2) - 0.5; const b = hash2(Math.floor(x * 5), Math.floor(z * 5), sd + 61); return n * 0.36 + (b > 0.9 ? 0.18 : b < 0.1 ? -0.18 : 0); }
      case "creep": { const v = vnoise2(x * 1.4, z * 1.4, sd + 62); const c = Math.abs(v - 0.5); return (v - 0.5) * 0.3 + (c < 0.04 ? 0.28 : 0) + (hash2(Math.floor(x * 6), Math.floor(z * 6), sd + 63) > 0.95 ? 0.3 : 0); }
      default: return (vnoise2(x, z, sd + 20) - 0.5) * 0.1;
    }
  }
  const put = (o: number, ramp: readonly [number, number], tIn: number, gx: number, gy: number, shift = 0, exact = false): void => {
    const len = ramp[1];
    let x = Math.max(0, Math.min(1, tIn)) * (len - 1);
    if (screen && !exact) x += (bayer(gx, gy, screen) - 0.5) * dither;
    const idx = Math.max(0, Math.min(len - 1, Math.round(x) + shift));
    const code = ramp[0] + idx + 1;
    const q = o * 4;
    data[q] = code & 255; data[q + 1] = code >>> 8;
  };
  const putCycle = (o: number, ramp: readonly [number, number], phase: number): void => {
    const code = ramp[0] + (((Math.floor(phase) % ramp[1]) + ramp[1]) % ramp[1]) + 1;
    data[o * 4] = code & 255; data[o * 4 + 1] = code >>> 8;
  };
  // A fringe test: is (u, v) (0..1 across the tile) within `th` of a masked edge or corner?
  const fringe = (mask: number, u: number, v: number, th: number): boolean => {
    if (!mask) return false;
    if (mask & 1 && 1 - v < th) return true;
    if (mask & 4 && 1 - u < th) return true;
    if (mask & 16 && v < th) return true;
    if (mask & 64 && u < th) return true;
    if (mask & 2 && Math.max(1 - u, 1 - v) < th) return true;
    if (mask & 8 && Math.max(1 - u, v) < th) return true;
    if (mask & 32 && Math.max(u, v) < th) return true;
    if (mask & 128 && Math.max(u, 1 - v) < th) return true;
    return false;
  };
  if (surface) surf = createSurfaceShader({ terrain: t, surface, palette, origin, seed, k, texture, topOf });
  // Where a texel samples textures and fringes: itself, or (voxel style) its voxel's middle.
  const snap = (v: number): number => (vox ? (Math.floor(v / vox) + 0.5) * vox : v);

  function shadeRow(yy: number): void {
    const gy = gy0 + yy;
    for (let xx = 0; xx < w; xx += 1) {
      const o = yy * w + xx;
      const n = fid[o]!;
      if (n < 0) continue;
      const f = faces[n]!;
      if (f.apron) continue;
      const gx = gx0 + xx;
      const X = wx[o]!, Y = wy[o]!, Z = wz[o]!;
      // Depth: ground-plane, chunk-relative.
      const gd = groundDepth(a, X, Z);
      const dc = Math.max(1, Math.min(65535, Math.round((gd - depthRef) / depthStep) + 32768));
      data[o * 4 + 2] = dc & 255; data[o * 4 + 3] = dc >>> 8;
      const sx = snap(X), sz = snap(Z), sy = snap(Y);
      // Outline: a neighbouring texel far behind (or nothing there) makes this one a silhouette.
      let edge = false, lip = false;
      if (outline && f.kind !== K_WATER && f.kind !== K_FALL) {
        const here = td[o]!;
        for (let q = 0; q < 4; q += 1) {
          const ax2 = xx + (q === 0 ? 1 : q === 1 ? -1 : 0), ay2 = yy + (q === 2 ? 1 : q === 3 ? -1 : 0);
          if (ax2 < 0 || ay2 < 0 || ax2 >= w || ay2 >= h) continue;
          const oo = ay2 * w + ax2;
          if (fid[oo]! < 0) continue;
          if (td[oo]! - here > gap) { edge = true; break; }
        }
        // (The top's front lip: the texel below on screen is a cliff face under it.)
        if (f.kind === K_TOP && yy + 1 < h) { const nb = fid[o + w]!; if (nb >= 0 && faces[nb]!.kind === K_SIDE && faces[nb]!.tile === f.tile) lip = true; }
      }
      let ramp: string;
      let tv: number;
      let cyclePhase: number | null = null;
      let direct: readonly [number, number] | null = null;
      let exact = false;
      const kk = f.tile;
      if (f.kind === K_TOP && surf) {
        // The surface: blended materials in their biome's ramps (surface.ts), then the ground's own lines over them.
        const i = kk % t.width, j = (kk - i) / t.width;
        const u = (X - OX) / ts - i, v = (Z - OZ) / ts - j;
        surf.top(kk, voxel ? sx : X, Y, voxel ? sz : Z, gx, gy, f.light, sOut);
        const ty = sOut.material;
        topRamp[0] = sOut.base; topRamp[1] = sOut.len;
        direct = topRamp;
        exact = sOut.exact;
        ramp = typeName[ty]!;
        tv = sOut.tv;
        if (ty === lava) cyclePhase = (sx * 0.7 + sz * 0.4 + fbm2(sx * 0.3, sz * 0.3, sd + 31, 2) * 5) * 1.5;
        if (fringe(maskOf(rShore, kk), u, v, 0.14 + 0.14 * vnoise2(sx * 2.3, sz * 2.3, sd + 32))) tv -= 0.16;
        if ((texOf[ty] === "cobble" && rRoad >= 0) || (texOf[ty] === "path" && rPath >= 0 && t.type[kk] === ty)) {
          const m = maskOf(texOf[ty] === "cobble" ? rRoad : rPath, kk);
          const kerb = 0.07;
          if (((m & 1) === 0 && 1 - v < kerb) || ((m & 4) === 0 && 1 - u < kerb) || ((m & 16) === 0 && v < kerb) || ((m & 64) === 0 && u < kerb)) tv -= texOf[ty] === "cobble" ? 0.22 : 0.08;
        }
        if (voxel && ((X - OX) / vox - Math.floor((X - OX) / vox) < 1 / (vox * k) || (Z - OZ) / vox - Math.floor((Z - OZ) / vox) < 1.2 / (vox * k * a.sp))) tv -= 0.09;
        if (lip) tv += 0.16;
        if (i > 0) {
          const wl = topOf(i - 1, j) - topOf(i, j);
          if (wl > 0 && u < Math.min(0.9, 0.3 * wl) + 0.06 * vnoise2(sz * 3, 0, sd + 43)) tv -= 0.16;
        }
      } else if (f.kind === K_TOP) {
        let ty = t.type[kk]!;
        const i = kk % t.width, j = (kk - i) / t.width;
        const u = (X - OX) / ts - i, v = (Z - OZ) / ts - j;
        const su = voxel ? (snap(X) - OX) / ts - i : u, sv = voxel ? (snap(Z) - OZ) / ts - j : v;
        // The edge that lies over this tile (auto-tiling's overlay): a noisy fringe of the neighbour's type.
        const ov = auto.overlay[kk]!;
        if (ov !== 255 && texOf[ov] !== "cobble") {
          const th = 0.2 + 0.26 * vnoise2(sx * 1.7, sz * 1.7, sd + 30);
          if (fringe(maskOf(rOverlay, kk), su, sv, th)) ty = ov;
        }
        ramp = typeName[ty]!;
        tv = 0.12 + f.light * 0.7 + texture(texOf[ty]!, sx, sz, sy) + glowOf[ty]!;
        if (ty === lava) cyclePhase = (sx * 0.7 + sz * 0.4 + fbm2(sx * 0.3, sz * 0.3, sd + 31, 2) * 5) * 1.5;
        // Shores: the land darkens toward the water (wet).
        if (fringe(maskOf(rShore, kk), su, sv, 0.12 + 0.12 * vnoise2(sx * 2.3, sz * 2.3, sd + 32))) tv -= 0.14;
        // Roads' and paths' kerbs: an edge with no road beyond is a darker line.
        if ((texOf[ty] === "cobble" && rRoad >= 0) || (texOf[ty] === "path" && rPath >= 0)) {
          const m = maskOf(texOf[ty] === "cobble" ? rRoad : rPath, kk);
          const kerb = 0.07;
          if (((m & 1) === 0 && 1 - v < kerb) || ((m & 4) === 0 && 1 - u < kerb) || ((m & 16) === 0 && v < kerb) || ((m & 64) === 0 && u < kerb)) tv -= 0.22;
        }
        if (voxel && ((X - OX) / vox - Math.floor((X - OX) / vox) < 1 / (vox * k) || (Z - OZ) / vox - Math.floor((Z - OZ) / vox) < 1.2 / (vox * k * a.sp))) tv -= 0.09;
        if (lip) tv += 0.16;
        // (A cliff's shadow: the light comes from the picture's left, so ground at the foot of a higher tile to its west lies in shade.)
        if (i > 0) {
          const wl = topOf(i - 1, j) - topOf(i, j);
          if (wl > 0 && su < Math.min(0.9, 0.3 * wl) + 0.06 * vnoise2(sz * 3, 0, sd + 43)) tv -= 0.16;
        }
      } else if (f.kind === K_SIDE) {
        const ty = faceTypeId[t.type[kk]!]!;
        ramp = typeName[ty]!;
        // (Strata: a darker line at every step; streaks down the face.)
        const step = Y / sh - Math.floor(Y / sh);
        tv = 0.02 + f.light * 0.62 + texture(texOf[ty] === "grass" ? "dirt" : texOf[ty]!, sx + sz, sy * 1.7, 0) * 0.8 - (step > 0.9 ? 0.12 : 0) + (vnoise2((sx + sz) * 3, sy * 0.3, sd + 33) - 0.5) * 0.1;
        if (voxel && Y / vox - Math.floor(Y / vox) < 1 / (vox * k * a.cp)) tv -= 0.12;
        // (A grassy top hangs over its face a little: the face's top row wears the top's type.)
        const top = cornerLevels(t, kk % t.width, Math.floor(kk / t.width));
        const topY = Math.max(top[0], top[1], top[2], top[3]) * sh;
        if (surf) direct = surf.side(kk, ty, X, Z, gx, gy);
        if (topY - Y < 0.12 + 0.1 * vnoise2(sx * 4 + sz * 4, 0, sd + 34) && (texOf[t.type[kk]!] === "grass" || texOf[t.type[kk]!] === "moss")) { ramp = typeName[t.type[kk]!]!; tv = 0.3 + f.light * 0.35; if (surf) direct = surf.side(kk, t.type[kk]!, X, Z, gx, gy); }
      } else if (f.kind === K_WATER) {
        const depthSteps = t.water[kk]! - t.height[kk]!;
        const i = kk % t.width, j = (kk - i) / t.width;
        const u = (sx - OX) / ts - i, v = (sz - OZ) / ts - j;
        let deep = depthSteps >= 2;
        if (deep && fringe(maskOf(rDeep, kk), u, v, 0.3 + 0.3 * vnoise2(sx, sz, sd + 35))) deep = false;
        ramp = deep ? "water.deep" : "water.shallow";
        tv = 0;
        cyclePhase = (sx * 0.55 + sz * 0.9 + fbm2(sx * 0.35, sz * 0.35, sd + 36, 2) * 6) * 1.2;
        if (fringe(maskOf(rFoam, kk), u, v, 0.1 + 0.16 * vnoise2(sx * 2.1, sz * 2.1, sd + 37))) { ramp = "foam"; cyclePhase = (sx + sz) * 2 + vnoise2(sx * 3, sz * 3, sd + 38) * 4; }
      } else if (f.kind === K_FALL) {
        ramp = "foam";
        tv = 0;
        cyclePhase = -Y * 5 + vnoise2((sx + sz) * 2, 0, sd + 39) * 6;
      } else {
        ramp = f.mat ?? "stone";
        const m = f.mat ?? "";
        const grain = m === "wood" || m === "deck" ? (vnoise2(sx * 0.6 + sz * 8, sy * 8, sd + 40) - 0.5) * 0.2 + ((sx + sz) * 4 - Math.floor((sx + sz) * 4) < 0.08 ? -0.15 : 0)
          : m === "roof" ? ((sy * 5) - Math.floor(sy * 5) < 0.2 ? -0.14 : 0) + (hash2(Math.floor(sx * 3), Math.floor(sy * 5), sd + 41) - 0.5) * 0.12
            : (vnoise2(sx * 1.3 + sz, sy * 1.3, sd + 42) - 0.5) * 0.15;
        tv = 0.08 + f.light * 0.72 + grain;
        if (voxel && (X / vox - Math.floor(X / vox) < 1 / (vox * k) || Y / vox - Math.floor(Y / vox) < 1 / (vox * k))) tv -= 0.09;
      }
      // (The surface's light layer darkens faces and extras too: walls between the torches.)
      if (surf && f.kind !== K_TOP && f.kind !== K_WATER && f.kind !== K_FALL) { const lt = surf.lightAt(X, Z); if (lt < 1) tv = tv * (0.25 + 0.75 * lt) - (1 - lt) * 0.18; }
      if (style.name === "custom" && style.paint) {
        const r = style.paint({ kind: f.kind === K_TOP ? "top" : f.kind === K_SIDE ? "side" : f.kind === K_WATER ? "water" : f.kind === K_FALL ? "fall" : "extra", material: f.kind === K_EXTRA ? f.mat ?? "" : f.kind === K_WATER || f.kind === K_FALL ? "water" : typeName[t.type[kk]!]!, x: X, y: Y, z: Z, light: f.light, tile: kk, ramp, t: tv });
        if (r) { ramp = r.ramp; tv = r.t; cyclePhase = null; direct = null; }
      }
      const rr = direct ?? pal.ramps[ramp] ?? pal.ramps["stone"]!;
      if (cyclePhase !== null && cycling.has(ramp)) putCycle(o, rr, cyclePhase);
      else if (cyclePhase !== null && ramp === typeName[lava]) putCycle(o, pal.ramps["lava.flow"] ?? rr, cyclePhase);
      else put(o, rr, tv, gx, gy, edge ? -outline : 0, exact);
    }
  }

  // ------------------------------------------------ the job
  let nextFace = 0;
  let nextRow = 0;
  let done = false;
  const total = faces.length + h;
  return {
    step(ms = 4) {
      if (done) return true;
      const start = performance.now();
      const until = start + ms;
      while (nextFace < faces.length) {
        raster(nextFace++);
        if ((nextFace & 15) === 0 && performance.now() > until) { spent += performance.now() - start; return false; }
      }
      while (nextRow < h) {
        shadeRow(nextRow++);
        if ((nextRow & 7) === 0 && performance.now() > until) { spent += performance.now() - start; return false; }
      }
      spent += performance.now() - start;
      done = true;
      return true;
    },
    get done() { return done; },
    get progress() { return (nextFace + nextRow) / total; },
    result() {
      if (!done) throw new Error("The chunk isn't baked yet: step() until it is.");
      let covered = 0;
      for (let o = 0; o < N; o += 1) if (data[o * 4] || data[o * 4 + 1]) covered += 1;
      return { chunk, w, h, gx0, gy0, data, depthRef, depthStep, stats: { faces: faces.length, texels: N, covered, ms: spent || performance.now() - t0 } };
    },
  };
}

// ---------------------------------------------------------------- composing on the CPU

export interface ComposeOptions {
  /** The picture and the global pixel at its top-left. */
  readonly width: number;
  readonly height: number;
  readonly gx: number;
  readonly gy: number;
  /** Seconds, for the cycling ramps (default 0). */
  readonly time?: number;
  /** A colour where nothing is (default [0, 0, 0]). */
  readonly clear?: readonly [number, number, number];
}

/**
 * Layers composed into an RGBA picture on the CPU, depth-tested per texel as
 * the ground shader does (tests, screenshots in Node, a fallback). Returns the
 * picture and its per-pixel depth (ground-plane metres; Infinity where empty).
 */
export function composeGround(layers: readonly GroundLayer[], palette: GroundPalette, { width, height, gx, gy, time = 0, clear = [0, 0, 0] }: ComposeOptions): { rgba: Uint8Array; depth: Float32Array; index: Int32Array } {
  const rgba = new Uint8Array(width * height * 4);
  const depth = new Float32Array(width * height).fill(Infinity);
  const index = new Int32Array(width * height).fill(-1);
  for (let o = 0; o < width * height; o += 1) { rgba[o * 4] = clear[0]; rgba[o * 4 + 1] = clear[1]; rgba[o * 4 + 2] = clear[2]; rgba[o * 4 + 3] = 255; }
  const cycleOf = (idx: number): number => {
    for (const c of palette.cycles) if (idx >= c.base && idx < c.base + c.length) return c.base + ((idx - c.base + Math.floor(time * c.speed)) % c.length);
    return idx;
  };
  for (const L of layers) {
    for (let y = 0; y < L.h; y += 1) {
      const py = L.gy0 + y - gy;
      if (py < 0 || py >= height) continue;
      for (let x = 0; x < L.w; x += 1) {
        const px = L.gx0 + x - gx;
        if (px < 0 || px >= width) continue;
        const q = (y * L.w + x) * 4;
        const code = L.data[q]! | (L.data[q + 1]! << 8);
        if (!code) continue;
        const d = L.depthRef + ((L.data[q + 2]! | (L.data[q + 3]! << 8)) - 32768) * L.depthStep;
        const o = py * width + px;
        if (d > depth[o]!) continue;
        depth[o] = d;
        const idx = cycleOf(code - 1);
        index[o] = idx;
        const c = palette.colours[idx]!;
        rgba[o * 4] = c[0]; rgba[o * 4 + 1] = c[1]; rgba[o * 4 + 2] = c[2];
      }
    }
  }
  return { rgba, depth, index };
}
