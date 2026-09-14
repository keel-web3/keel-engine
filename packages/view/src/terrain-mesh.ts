// The terrain as triangles, for a view from the ground: a chunk at a time,
// straight from @keel-engine/terrain's public data -- every tile's top at its
// corner levels (a ramp's slope included), every cliff face between a tile and
// a lower neighbour, the water's surface over wet tiles, and a skirt down the
// map's edge so it isn't hollow from outside. What the overview bakes into
// chunk layers (the ground baker), a perspective view draws as meshes on
// keel/render's raster mode: the same palette ramps, dithered and outlined.
//
// Chunks meet without seams: a tile's geometry is decided by the tile and its
// neighbours alone (never by which chunk it's in), and a cliff belongs to its
// HIGH side -- so the union of the chunks is exactly the whole map's mesh.
//
//   const m = terrainChunkMesh(terrain, chunk, { material: (type, part) => ..., water: WATER_MAT });
//   px.setMesh(`terrain:${chunk}`, m);

import { DX4, DZ4, FLAG, WATER_NONE, cliffFace, cornerLevels } from "@keel-engine/terrain";
import type { Terrain } from "@keel-engine/terrain";

export interface TerrainMeshOptions {
  /** The renderer material for a terrain type's top or its cliff face. */
  readonly material: (type: number, part: "top" | "face") => number;
  /** The water surface's material (keel/render's WATER_MAT, 4, by default). */
  readonly water?: number;
  /** Per tile, a lightness offset (default: a little seeded noise, so big fields of one type don't read flat). */
  readonly shade?: (i: number, j: number) => number;
  /** How far under its level the water's surface sits (m, default 0.08: the shore's lip shows). */
  readonly waterDrop?: number;
  /** Skirt the map's edge down to this level (steps; default: the lowest tile less two). null: no skirt. */
  readonly floor?: number | null;
}

/** A chunk's mesh: keel/render's RasterMesh (non-indexed triangles) plus what it covers. */
export interface TerrainMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** [material, ramp (-1), shade, id] per vertex. */
  readonly looks: Float32Array;
  readonly triangles: number;
  /** [x0, y0, z0, x1, y1, z1]. */
  readonly bounds: readonly [number, number, number, number, number, number];
  /** Tops, cliff faces, water quads, skirt quads. */
  readonly counts: { readonly tops: number; readonly faces: number; readonly water: number; readonly skirts: number };
}

// (A tile's noise: an integer hash, -1..1.)
const noise = (i: number, j: number): number => { let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; return ((h ^ (h >>> 15)) & 0xffff) / 32767.5 - 1; };
/** A tile's outline id: by its level, so a cliff's top edge outlines against the ground below it and a plain doesn't. */
export const terrainId = (level: number): number => 1 + (((level % 40) + 40) % 40);

/** The lowest tile level on the map (and its water). */
export function lowestLevel(t: Terrain): number {
  let lo = Infinity;
  for (let k = 0; k < t.height.length; k += 1) lo = Math.min(lo, t.height[k]!);
  return lo;
}

/** One chunk of the terrain as triangles (see the top). */
export function terrainChunkMesh(t: Terrain, chunk: number, o: TerrainMeshOptions): TerrainMesh {
  return terrainRectMesh(t, t.chunkRect(chunk), o);
}

/** A rectangle of tiles [i0, j0, i1, j1) as triangles: the whole map is terrainRectMesh(t, [0, 0, width, depth]). */
export function terrainRectMesh(t: Terrain, rect: readonly [number, number, number, number], o: TerrainMeshOptions): TerrainMesh {
  const [i0, j0, i1, j1] = rect;
  const ts = t.tileSize, sh = t.stepHeight;
  const water = o.water ?? 4;
  const drop = o.waterDrop ?? 0.08;
  const shadeOf = o.shade ?? ((i: number, j: number) => noise(i, j) * 0.035);
  const floor = o.floor === null ? null : o.floor ?? lowestLevel(t) - 2;
  const P: number[] = [], N: number[] = [], L: number[] = [];
  const counts = { tops: 0, faces: 0, water: 0, skirts: 0 };
  let y0 = Infinity, y1 = -Infinity;
  const tri = (a: readonly number[], b: readonly number[], c: readonly number[], look: readonly number[], n?: readonly number[], shades?: readonly [number, number, number]) => {
    let nx: number, ny: number, nz: number;
    if (n) { nx = n[0]!; ny = n[1]!; nz = n[2]!; } else {
      const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!, vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    }
    [a, b, c].forEach((p, v) => {
      P.push(p[0]!, p[1]!, p[2]!); N.push(nx, ny, nz);
      L.push(look[0]!, look[1]!, look[2]! + (shades ? shades[v]! : 0), look[3]!);
      y0 = Math.min(y0, p[1]!); y1 = Math.max(y1, p[1]!);
    });
  };
  const quad = (p0: readonly number[], p1: readonly number[], p2: readonly number[], p3: readonly number[], look: readonly number[], n?: readonly number[], sh4?: readonly [number, number, number, number]) => {
    tri(p0, p1, p2, look, n, sh4 ? [sh4[0], sh4[1], sh4[2]] : undefined);
    tri(p0, p2, p3, look, n, sh4 ? [sh4[0], sh4[2], sh4[3]] : undefined);
  };
  // (A tile edge's two corners in world order -- lower x or z first -- as cliffs.ts lists them.)
  const edgeXZ = (i: number, j: number, d: number): [[number, number], [number, number]] => {
    const x0 = i * ts, x1 = (i + 1) * ts, z0 = j * ts, z1 = (j + 1) * ts;
    return d === 0 ? [[x0, z1], [x1, z1]] : d === 1 ? [[x1, z0], [x1, z1]] : d === 2 ? [[x0, z0], [x1, z0]] : [[x0, z0], [x0, z1]];
  };
  for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) {
    const k = t.index(i, j);
    const type = t.type[k]!;
    const c = cornerLevels(t, i, j);
    const x0 = i * ts, x1 = (i + 1) * ts, z0 = j * ts, z1 = (j + 1) * ts;
    const shade = shadeOf(i, j);
    const id = terrainId(t.height[k]!);
    const top = [o.material(type, "top"), -1, shade, id];
    // The top: corners c0 (x0, z0), c1 (x1, z0), c2 (x0, z1), c3 (x1, z1).
    const a: number[] = [x0, c[0] * sh, z0], b: number[] = [x1, c[1] * sh, z0], cc: number[] = [x0, c[2] * sh, z1], d: number[] = [x1, c[3] * sh, z1];
    tri(a, cc, b, top); tri(b, cc, d, top);
    counts.tops += 1;
    // Cliff faces toward lower neighbours (this tile is the high side: it owns them); skirts down the map's edge.
    for (let dir = 0; dir < 4; dir += 1) {
      const inside = t.inside(i + DX4[dir]!, j + DZ4[dir]!);
      if (!inside && floor === null) continue;
      const f = cliffFace(t, i, j, dir, inside ? -Infinity : floor!);
      if (!f) continue;
      const [e0, e1] = edgeXZ(i, j, dir);
      const faceLook = [o.material(type, "face"), -1, shade * 0.5 - 0.04, id];
      const n = [DX4[dir]!, 0, DZ4[dir]!];
      // (Darker toward the foot: the light a cliff's base doesn't get.)
      quad([e0[0], f.low[0] * sh, e0[1]], [e1[0], f.low[1] * sh, e1[1]], [e1[0], f.high[1] * sh, e1[1]], [e0[0], f.high[0] * sh, e0[1]], faceLook, n, [-0.07, -0.07, 0.02, 0.02]);
      if (inside) counts.faces += 1; else counts.skirts += 1;
    }
    // Water over a wet tile (a bridge's deck is the bridge object's).
    const wl = t.water[k]!;
    if (wl !== WATER_NONE && !(t.flags[k]! & FLAG.BLOCKED)) {
      const y = wl * sh - drop;
      const wlook = [water, -1, noise(j, i) * 0.02, 45];
      tri([x0, y, z0], [x0, y, z1], [x1, y, z0], wlook, [0, 1, 0]); tri([x1, y, z0], [x0, y, z1], [x1, y, z1], wlook, [0, 1, 0]);
      counts.water += 1;
    }
  }
  const positions = Float32Array.from(P);
  return {
    positions, normals: Float32Array.from(N), looks: Float32Array.from(L), triangles: positions.length / 9,
    bounds: [i0 * ts, Number.isFinite(y0) ? y0 : 0, j0 * ts, i1 * ts, Number.isFinite(y1) ? y1 : 0, j1 * ts], counts,
  };
}

/**
 * The terrain as a camera's world (keel/camera's CameraWorld.distance): how far a point is above the ground under it
 * (x `step`, less `margin`). Exact over flat ground; beside a cliff an overestimate, so the arm -- which sweeps in steps
 * no longer than the distance -- finds the cliff one step late, on the first step that lands under its top. (Never the
 * ground a stride round, nor a margin or step that shrinks it: the camera casts from a small subject's middle, 0.28 m up
 * on a fox, with a 0.2 m ball, and a start that reads "inside" folds its arm to nothing.)
 */
export function terrainDistance(t: Terrain, margin = 0, step = 1): (p: ArrayLike<number>) => number {
  return (p) => (p[1]! - t.heightAt(p[0]!, p[2]!)) * step - margin;
}
