// The GPU ground's data: what a fragment shader needs to paint a chunk's
// ground at ANY scale, packed per chunk on the CPU once (and again only when
// its tiles change) -- instead of a bitmap per scale.
//
//   the MESH    the chunk's faces as the ground baker builds them: tops (ramps
//               sloped), cliff faces toward lower neighbours, water surfaces,
//               waterfalls, bridge decks and rails, and the extras baked in
//               (houses): triangles, local to the chunk's corner, each vertex
//               carrying its face's kind, tile and material
//   the TILES   one RGBA32UI texture: per tile round the chunk (a 2-tile
//               apron) its type, flags, biome, light, height, top, the
//               auto-tiling masks the baker reads (shore, foam, deep, road,
//               path, the overlay), contact-shade bits, variant, the step up to
//               its west; per tile CORNER the biome shares (the surface's
//               wide biome border: three biomes and their weights)
//
// A biome swap or creep paint changes the tiles, never the mesh: re-pack the
// tiles (gpuTileData) and upload one small texture. A season is the palette.

import { DX4, DZ4, FLAG, WATER_NONE } from "./types.ts";
import type { TextureKind } from "./types.ts";
import type { Terrain } from "./grid.ts";
import { autoTile } from "./autotile.ts";
import type { AutoTiles } from "./autotile.ts";
import { cliffFace, cornerLevels } from "./cliffs.ts";
import type { GroundExtra } from "./ground.ts";
import { tileVariant } from "./surface.ts";
import type { GroundSurface } from "./surface.ts";

/** Face kinds (the ground baker's). */
export const GPU_KIND = { top: 1, side: 2, water: 3, fall: 4, extra: 5 } as const;

/** Texture kinds in the order the shader's switch knows them. */
export const GPU_TEXTURES: readonly TextureKind[] = ["grass", "dirt", "sand", "rock", "snow", "crystal", "lava", "ash", "mud", "cobble", "path", "ice", "plain", "flagstone", "gravel", "moss", "clay", "litter", "brick", "creep"];

/** The tiles round a chunk its texture carries (the surface reads two tiles out: warp, corners, contact shade). */
export const GPU_APRON = 2;

/** What a chunk is made from (as the ground baker's ChunkBakeInput). */
export interface GpuChunkInput {
  readonly terrain: Terrain;
  /** The auto-tiling (autoTile over at least the chunk and two tiles round it; default: computed for the terrain). */
  readonly auto?: AutoTiles;
  /** The chunk (default 0); its rectangle unless `rect` is given. */
  readonly chunk?: number;
  /** Tiles [i0, j0, i1, j1) in the terrain (a world chunk's own tiles inside its apron). */
  readonly rect?: readonly [number, number, number, number];
  /** The world tile at the terrain's (0, 0) (default [0, 0]). */
  readonly origin?: readonly [number, number];
  /** The surface (blended materials, biomes); null: the classic look. */
  readonly surface?: GroundSurface | null;
  /** Boxes and wedges baked in with it (houses). */
  readonly extras?: readonly GroundExtra[];
  /** Bridge decks and rails (default true: GroundStyle.decks). */
  readonly decks?: boolean;
  /** The seed (variants follow it: ChunkBakeInput.seed). */
  readonly seed?: number;
}

/** A chunk's tiles, packed. */
export interface GpuTileData {
  /** RGBA32UI texels, `tw` x `th`: block A rows [0, dd), block B rows [dd, 2 dd), corners rows [2 dd, 3 dd + 1). */
  readonly texels: Uint32Array;
  readonly tw: number;
  readonly th: number;
  /** Tiles a block row, and rows a block. */
  readonly dw: number;
  readonly dd: number;
  /** The terrain tile at texel (0, 0). */
  readonly i0: number;
  readonly j0: number;
  /** A hash of what was packed (a data upload is skipped when it's the same). */
  readonly hash: number;
}

/** A chunk's mesh and tiles. */
export interface GpuChunkData {
  readonly tiles: GpuTileData;
  /** Per vertex: x y z (metres from `anchor`), nx ny nz. */
  readonly vertices: Float32Array;
  /** Per vertex: kind | dir << 4 | material << 8, and the tile (texel coordinates: i | j << 16). */
  readonly info: Uint32Array;
  readonly count: number;
  /** World metres of the chunk's corner (its rect's (i0, j0)) at height 0. */
  readonly anchor: readonly [number, number, number];
  /** The extras' materials, by the index a vertex carries. */
  readonly materials: readonly string[];
  /** The terrain's size (tiles) and origin (world tile of its (0, 0)). */
  readonly size: readonly [number, number];
  readonly origin: readonly [number, number];
  readonly rect: readonly [number, number, number, number];
  /** World bounds [x0, y0, z0, x1, y1, z1]. */
  readonly bounds: readonly [number, number, number, number, number, number];
  readonly ms: number;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const bitsOf = (v: number): number => { f32[0] = v; return u32[0]!; };

/**
 * Pack a chunk's tiles (block A: type flags biome light / height top / shore
 * foam deep road / path overlay-mask overlay-type valid; block B: contact
 * shade bits and steps / variant, west step, cliff edges, ramp dir / water
 * deck; corners: three biomes and their shares).
 */
export function gpuTileData(input: GpuChunkInput, auto: AutoTiles = input.auto ?? autoTile(input.terrain)): GpuTileData {
  const t = input.terrain;
  const [ci0, cj0, ci1, cj1] = input.rect ?? t.chunkRect(input.chunk ?? 0);
  const [oi, oj] = input.origin ?? [0, 0];
  const surface = input.surface ?? null;
  const A = GPU_APRON;
  const i0 = ci0 - A, j0 = cj0 - A, dw = ci1 - ci0 + 2 * A, dd = cj1 - cj0 + 2 * A;
  const tw = dw + 1, th = 3 * dd + 1;
  const texels = new Uint32Array(tw * th * 4);
  const W = t.width, D = t.depth;
  const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < W && j < D;
  // Corner levels of every tile in the window and a ring round it (cliffs.ts cornerLevels, without its arrays):
  // [x0z0, x1z0, x0z1, x1z1] a tile, and its highest.
  const RW = dw + 2, RD = dd + 2;
  const lv = new Int16Array(RW * RD * 4), top = new Int16Array(RW * RD);
  for (let rj = 0; rj < RD; rj += 1) for (let ri = 0; ri < RW; ri += 1) {
    const i = i0 - 1 + ri, j = j0 - 1 + rj;
    if (!inside(i, j)) continue;
    const k = j * W + i, h = t.height[k]!, q = (rj * RW + ri) * 4;
    let a = h, b = h, c = h, d = h;
    if (t.flags[k]! & FLAG.RAMP) {
      const dir = t.dir[k];
      if (dir === 0) { c = h + 1; d = h + 1; } else if (dir === 1) { b = h + 1; d = h + 1; } else if (dir === 2) { a = h + 1; b = h + 1; } else { a = h + 1; c = h + 1; }
    }
    lv[q] = a; lv[q + 1] = b; lv[q + 2] = c; lv[q + 3] = d;
    top[rj * RW + ri] = Math.max(a, b, c, d);
  }
  const at = (i: number, j: number): number => (j - j0 + 1) * RW + (i - i0 + 1);
  const topOf = (i: number, j: number): number => top[at(i, j)]!;
  // (An edge's corners, world order: N [2, 3], E [1, 3], S [0, 1], W [0, 2] -- cliffs.ts EDGE_CORNERS.)
  const EA = [2, 1, 0, 0], EB = [3, 3, 1, 2];
  // Is there a cliff face on (i, j)'s edge toward d (cliffs.ts cliffFace, the neighbour on the map)?
  const cliffToward = (i: number, j: number, d: number): boolean => {
    const ni = i + DX4[d]!, nj = j + DZ4[d]!;
    if (!inside(ni, nj)) return false;
    const q = at(i, j) * 4, o = at(ni, nj) * 4, od = (d + 2) & 3;
    const h0 = lv[q + EA[d]!]!, h1 = lv[q + EB[d]!]!, l0 = lv[o + EA[od]!]!, l1 = lv[o + EB[od]!]!;
    return !(h0 < l0 || h1 < l1) && Math.max(h0 - l0, h1 - l1) > 0;
  };
  const rule = (name: string): number => auto.rule(name);
  const rOverlay = rule("overlay"), rShore = rule("shore"), rFoam = rule("foam"), rDeep = rule("deep"), rRoad = rule("road"), rPath = rule("path");
  const maskOf = (r: number, k: number): number => (r < 0 ? 0 : auto.masks[r]![k]!);
  const biome = surface?.biome ?? null, light = surface?.light ?? null;
  const sdS = ((input.seed ?? 0) * 7919 + 101) | 0;
  const nVar = Math.max(1, surface?.variants ?? 4);
  const DI = [0, 1, 0, -1, -1, 1, -1, 1], DJ = [1, 0, -1, 0, -1, -1, 1, 1];
  let hash = 0x811c9dc5;
  const mix = (v: number): void => { hash = Math.imul(hash ^ v, 0x01000193); };
  for (let lj = 0; lj < dd; lj += 1) for (let li = 0; li < dw; li += 1) {
    const i = i0 + li, j = j0 + lj;
    const oA = (lj * tw + li) * 4, oB = ((lj + dd) * tw + li) * 4;
    if (!inside(i, j)) continue; // (all zero: not a tile -- valid bit off)
    const k = j * W + i;
    const tp = topOf(i, j), h = t.height[k]!;
    texels[oA] = t.type[k]! | (t.flags[k]! << 8) | ((biome ? biome[k]! : 0) << 16) | ((light ? light[k]! : 255) << 24);
    texels[oA + 1] = ((h + 32768) & 0xffff) | (((tp + 32768) & 0xffff) << 16);
    texels[oA + 2] = maskOf(rShore, k) | (maskOf(rFoam, k) << 8) | (maskOf(rDeep, k) << 16) | (maskOf(rRoad, k) << 24);
    texels[oA + 3] = maskOf(rPath, k) | (maskOf(rOverlay, k) << 8) | (auto.overlay[k]! << 16) | (1 << 24);
    // Contact shade (surface.ts aoMask): which of the 8 neighbours stand higher, and by how many steps (the 4 edges).
    let ao = 0, up0 = 0, up1 = 0, up2 = 0, up3 = 0;
    for (let d = 0; d < 8; d += 1) {
      const ni = i + DI[d]!, nj = j + DJ[d]!;
      if (!inside(ni, nj)) continue;
      const u = topOf(ni, nj) - tp;
      if (u > 0) { ao |= 1 << d; const v = Math.min(255, u); if (d === 0) up0 = v; else if (d === 1) up1 = v; else if (d === 2) up2 = v; else if (d === 3) up3 = v; }
    }
    const west = i > 0 ? Math.max(0, Math.min(255, topOf(i - 1, j) - tp)) : 0;
    let cliffs = 0;
    for (let d = 0; d < 4; d += 1) if (cliffToward(i, j, d)) cliffs |= 1 << d;
    const variant = nVar > 1 ? tileVariant(i + oi, j + oj, sdS, nVar) : 0;
    texels[oB] = ao | (up0 << 8) | (up1 << 16) | (up2 << 24);
    texels[oB + 1] = up3 | (variant << 8) | (west << 16) | (cliffs << 24) | ((t.dir[k]! & 3) << 28);
    const w = t.water[k]!;
    texels[oB + 2] = (w === WATER_NONE ? 0 : (w + 32768) & 0xffff) | (((t.deck[k]! + 32768) & 0xffff) << 16);
    texels[oB + 3] = 0;
    mix(texels[oA]!); mix(texels[oA + 1]!); mix(texels[oA + 2]!); mix(texels[oA + 3]!); mix(texels[oB]!); mix(texels[oB + 1]!); mix(texels[oB + 2]!);
  }
  // Biome corners (surface.ts cornerOf: the 2R x 2R tiles round a corner, clamped to the map, nearer ones counting more;
  // at most three biomes kept, the heaviest first). (Most corners see one biome: no lists, no sort.)
  const R = 2;
  const ids = [0, 0, 0, 0, 0, 0, 0, 0], ws = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let cj = 0; cj <= dd; cj += 1) for (let cI = 0; cI <= dw; cI += 1) {
    const o = ((2 * dd + cj) * tw + cI) * 4;
    const ci = i0 + cI, cjj = j0 + cj;
    if (!biome) { texels[o] = 0 | (255 << 8) | (255 << 16); texels[o + 1] = bitsOf(1); continue; }
    let n = 0, total = 0;
    for (let jj = cjj - R; jj < cjj + R; jj += 1) {
      const b = jj < 0 ? 0 : jj >= D ? D - 1 : jj;
      const wz = R + 0.5 - Math.abs(jj + 0.5 - cjj);
      for (let ii = ci - R; ii < ci + R; ii += 1) {
        const a = ii < 0 ? 0 : ii >= W ? W - 1 : ii;
        const bi = biome[b * W + a]!;
        const w = (R + 0.5 - Math.abs(ii + 0.5 - ci)) * wz;
        let m = 0;
        while (m < n && ids[m] !== bi) m += 1;
        if (m === n) { ids[n] = bi; ws[n] = w; n += 1; } else ws[m] = ws[m]! + w;
        total += w;
      }
    }
    // (The three heaviest, in order -- a stable pick, as the sort did: ties keep their first-seen order.)
    let packed = 0xffffff;
    for (let s0 = 0; s0 < Math.min(3, n); s0 += 1) {
      let best = -1;
      for (let m = 0; m < n; m += 1) if (ws[m]! >= 0 && (best < 0 || ws[m]! > ws[best]!)) best = m;
      packed = (packed & ~(0xff << (8 * s0))) | (ids[best]! << (8 * s0));
      texels[o + 1 + s0] = bitsOf(ws[best]! / total);
      ws[best] = -1;
    }
    texels[o] = packed;
    mix(packed); mix(texels[o + 1]!);
  }
  return { texels, tw, th, dw, dd, i0, j0, hash: hash >>> 0 };
}

/** Build a chunk's mesh and tiles (the ground baker's faces, as triangles). */
export function gpuChunkData(input: GpuChunkInput): GpuChunkData {
  const t0 = performance.now();
  const t = input.terrain;
  const auto = input.auto ?? autoTile(t);
  const tiles = gpuTileData(input, auto);
  const [ci0, cj0, ci1, cj1] = input.rect ?? t.chunkRect(input.chunk ?? 0);
  const [oi, oj] = input.origin ?? [0, 0];
  const ts = t.tileSize, sh = t.stepHeight;
  const OX = oi * ts, OZ = oj * ts;
  const ax = ci0 * ts + OX, az = cj0 * ts + OZ;
  const decks = input.decks ?? true;
  const floorLv = (() => { let m = Infinity; for (let kk = 0; kk < t.height.length; kk += 1) m = Math.min(m, t.height[kk]!); return m - 2; })();
  const V: number[] = [], I: number[] = [];
  const materials: string[] = [];
  const matIndex = new Map<string, number>();
  let x0b = Infinity, y0b = Infinity, z0b = Infinity, x1b = -Infinity, y1b = -Infinity, z1b = -Infinity;
  const face = (kind: number, li: number, lj: number, dir: number, mat: number, pts: number[][]): void => {
    // (Newell's normal, as the baker: robust to a repeated corner.)
    let nx = 0, ny = 0, nz = 0;
    for (let v = 0; v < pts.length; v += 1) {
      const p = pts[v]!, q = pts[(v + 1) % pts.length]!;
      nx += (p[1]! - q[1]!) * (p[2]! + q[2]!); ny += (p[2]! - q[2]!) * (p[0]! + q[0]!); nz += (p[0]! - q[0]!) * (p[1]! + q[1]!);
    }
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) return;
    nx /= L; ny /= L; nz /= L;
    const info0 = kind | (dir << 4) | (mat << 8), info1 = (li & 0xffff) | ((lj & 0xffff) << 16);
    for (let v = 1; v + 1 < pts.length; v += 1) for (const p of [pts[0]!, pts[v]!, pts[v + 1]!]) {
      V.push(p[0]! - ax, p[1]!, p[2]! - az, nx, ny, nz);
      I.push(info0, info1);
      x0b = Math.min(x0b, p[0]!); y0b = Math.min(y0b, p[1]!); z0b = Math.min(z0b, p[2]!);
      x1b = Math.max(x1b, p[0]!); y1b = Math.max(y1b, p[1]!); z1b = Math.max(z1b, p[2]!);
    }
  };
  const matOf = (name: string): number => {
    let m = matIndex.get(name);
    if (m === undefined) { m = materials.length; materials.push(name); matIndex.set(name, m); }
    return m;
  };
  const solid = (s: GroundExtra, li: number, lj: number): void => {
    const yaw = s.yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw);
    const Wp = (lx: number, ly: number, lz: number): number[] => [s.c[0] + c * lx + sn * lz, s.c[1] + ly, s.c[2] - sn * lx + c * lz];
    const [hx, hy, hz] = [s.h[0], s.h[1], s.h[2]];
    const m = matOf(s.mat);
    const E = GPU_KIND.extra;
    if (s.kind === "wedge") {
      const lo = Math.max(0, Math.min(0.98, s.lo ?? 0));
      const yf = -hy + 2 * hy * lo;
      face(E, li, lj, 0, m, [Wp(-hx, yf, hz), Wp(hx, yf, hz), Wp(hx, hy, -hz), Wp(-hx, hy, -hz)]);
      face(E, li, lj, 0, m, [Wp(-hx, -hy, -hz), Wp(-hx, hy, -hz), Wp(hx, hy, -hz), Wp(hx, -hy, -hz)]);
      if (lo > 0) face(E, li, lj, 0, m, [Wp(-hx, -hy, hz), Wp(hx, -hy, hz), Wp(hx, yf, hz), Wp(-hx, yf, hz)]);
      face(E, li, lj, 0, m, [Wp(hx, -hy, hz), Wp(hx, -hy, -hz), Wp(hx, hy, -hz), Wp(hx, yf, hz)]);
      face(E, li, lj, 0, m, [Wp(-hx, -hy, hz), Wp(-hx, yf, hz), Wp(-hx, hy, -hz), Wp(-hx, -hy, -hz)]);
      return;
    }
    const P = (a: number, b: number, d: number): number[] => Wp(a * hx, b * hy, d * hz);
    face(E, li, lj, 0, m, [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)]);
    face(E, li, lj, 0, m, [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]);
    face(E, li, lj, 0, m, [P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)]);
    face(E, li, lj, 0, m, [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)]);
    face(E, li, lj, 0, m, [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)]);
    face(E, li, lj, 0, m, [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)]);
  };
  const li0 = tiles.i0, lj0 = tiles.j0;
  for (let j = cj0; j < cj1; j += 1) for (let i = ci0; i < ci1; i += 1) {
    if (!t.inside(i, j)) continue;
    const kk = t.index(i, j);
    const li = i - li0, lj = j - lj0;
    const c = cornerLevels(t, i, j);
    const x0 = i * ts + OX, x1 = (i + 1) * ts + OX, z0 = j * ts + OZ, z1 = (j + 1) * ts + OZ;
    face(GPU_KIND.top, li, lj, 0, 0, [[x0, c[0] * sh, z0], [x0, c[2] * sh, z1], [x1, c[3] * sh, z1], [x1, c[1] * sh, z0]]);
    for (let d = 0; d < 4; d += 1) {
      const f = cliffFace(t, i, j, d, floorLv);
      if (!f) continue;
      const E = d === 0 ? [[x0, z1], [x1, z1]] : d === 1 ? [[x1, z0], [x1, z1]] : d === 2 ? [[x0, z0], [x1, z0]] : [[x0, z0], [x0, z1]];
      const [e0, e1] = E as [[number, number], [number, number]];
      const q = [[e0[0], f.low[0] * sh, e0[1]], [e1[0], f.low[1] * sh, e1[1]], [e1[0], f.high[1] * sh, e1[1]], [e0[0], f.high[0] * sh, e0[1]]];
      face(GPU_KIND.side, li, lj, d, 0, d === 0 || d === 3 ? q : q.slice().reverse());
    }
    const w = t.water[kk]!;
    if (w !== WATER_NONE && w > t.height[kk]!) {
      const y = w * sh;
      face(GPU_KIND.water, li, lj, 0, 0, [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]]);
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
        face(GPU_KIND.fall, li, lj, d, 0, d === 0 || d === 3 ? q : q.slice().reverse());
      }
    }
    if (decks && t.flags[kk]! & FLAG.BRIDGE) {
      const y = t.deck[kk]! * sh, cx = (i + 0.5) * ts + OX, cz = (j + 0.5) * ts + OZ, alongX = t.dir[kk] === 1;
      solid({ c: [cx, y - 0.14, cz], h: [ts / 2, 0.14, ts / 2], mat: "deck" }, li, lj);
      for (const side of [-1, 1]) solid(alongX ? { c: [cx, y + 0.3, cz + side * (ts / 2 - 0.08)], h: [ts / 2, 0.06, 0.06], mat: "wood" } : { c: [cx + side * (ts / 2 - 0.08), y + 0.3, cz], h: [0.06, 0.06, ts / 2], mat: "wood" }, li, lj);
      for (const side of [-1, 1]) solid(alongX ? { c: [cx - ts / 2 + 0.1, y + 0.18, cz + side * (ts / 2 - 0.08)], h: [0.07, 0.2, 0.07], mat: "wood" } : { c: [cx + side * (ts / 2 - 0.08), y + 0.18, cz - ts / 2 + 0.1], h: [0.07, 0.2, 0.07], mat: "wood" }, li, lj);
    }
  }
  // Extras: each one's nearest tile inside the chunk carries its light (the light layer), as the baker reads by position.
  for (const e of input.extras ?? []) {
    const i = Math.max(ci0, Math.min(ci1 - 1, Math.floor((e.c[0] - OX) / ts))), j = Math.max(cj0, Math.min(cj1 - 1, Math.floor((e.c[2] - OZ) / ts)));
    solid(e, i - li0, j - lj0);
  }
  const vertices = Float32Array.from(V);
  return {
    tiles, vertices, info: Uint32Array.from(I), count: V.length / 6, anchor: [ax, 0, az], materials,
    size: [t.width, t.depth], origin: [oi, oj], rect: [ci0, cj0, ci1, cj1],
    bounds: Number.isFinite(x0b) ? [x0b, y0b, z0b, x1b, y1b, z1b] : [ax, 0, az, ax, 0, az],
    ms: performance.now() - t0,
  };
}
