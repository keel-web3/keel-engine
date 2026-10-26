// A tile grid drawn by keel/lit: one mesh (flat, or on a height per grid
// vertex), one LitMaterial whose albedo the tile shader writes. Each material
// picks its own system, pattern and ramp, so a grid can blend grass into dirt
// organically, lay a blob-tiled path over both and ripple a dual-grid pond in
// the same draw.

import { Attribute, Color, DataTexture, Geometry, LitMaterial, Mesh, Vector4 } from "@keel-engine/lit";
import type { ColorRepresentation } from "@keel-engine/lit";
import type { TileAtlas } from "./atlas.ts";
import type { TileGrid } from "./grid.ts";
import { MAX_TILE_MATERIALS, TILE_FRAGMENT_HEAD, TILE_FRAGMENT_MAP, TILE_VERTEX_BEGIN, TILE_VERTEX_HEAD } from "./glsl.ts";
import { BLOB_LUT, SYSTEM_CODE, SYSTEM_TILES } from "./systems.ts";
import type { TileSystem } from "./systems.ts";

export type TilePattern = "flat" | "noise" | "speckle" | "cobble" | "ripple" | "tufts" | "stripes";
export const PATTERN_CODE: Readonly<Record<TilePattern, number>> = { flat: 0, noise: 1, speckle: 2, cobble: 3, ripple: 4, tufts: 5, stripes: 6 };

export interface TileMaterialSpec {
  /** Four colours, dark to light: the pattern and the edge shading step along them. */
  readonly ramp: readonly [ColorRepresentation, ColorRepresentation, ColorRepresentation, ColorRepresentation];
  /** How the material's edge is found (the base material's is never drawn). Default blend. */
  readonly system?: TileSystem;
  /** The atlas for a tiled system (paintTileAtlas or importTileAtlas). */
  readonly atlas?: TileAtlas;
  readonly pattern?: TilePattern;
  /** Pattern features per cell. */
  readonly scale?: number;
  /** Blend only: how far the edge wanders (0..0.5). */
  readonly rough?: number;
  /** Blend only: a lit rim and dark lip along the edge. */
  readonly rim?: boolean;
  /** Blend only: the drop shadow on the material beneath, in texels (0..3). */
  readonly shadow?: number;
}

export interface TileSurfaceSpec {
  /** Per material name (every grid material needs one). */
  readonly materials: Readonly<Record<string, TileMaterialSpec>>;
  /** A cell's size in world units. */
  readonly cell?: number;
  /** The world x, z of the grid's (0, 0) corner. */
  readonly origin?: readonly [number, number];
  /** Texels to a cell: the pixel-art grid every edge and pattern snaps to. */
  readonly texels?: number;
  /** The surface's height: one number, or one per grid vertex ((width + 1) * (depth + 1), row by row). */
  readonly height?: number | Float32Array;
  /** Keeps only the texels whose world x, z it accepts (a round plot, a coastline). */
  readonly clip?: (x: number, z: number) => boolean;
  readonly roughness?: number;
}

export interface TileSurface {
  readonly mesh: Mesh;
  readonly material: LitMaterial;
  readonly grid: TileGrid;
  /** Uploads the grid when it changed since the last call (cheap to call every frame). */
  update(): void;
  setRamp(material: string, ramp: TileMaterialSpec["ramp"]): void;
  /** The clock for animated patterns (ripple), in seconds. */
  setTime(seconds: number): void;
  /** The material name of the cell under world x, z (null off the grid). */
  materialAt(x: number, z: number): string | null;
  /** The cell under world x, z, or null off the grid. */
  cellAt(x: number, z: number): readonly [number, number] | null;
  /** Whether world x, z is on the drawn surface (inside the grid and the clip). */
  covers(x: number, z: number): boolean;
  dispose(): void;
}

const blank = (): DataTexture => {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, "rgba", "u8");
  t.needsUpdate = true;
  return t;
};

function atlasTexture(atlas: TileAtlas): DataTexture {
  const t = new DataTexture(atlas.rgba, atlas.width, atlas.height, "rgba", "u8");
  t.needsUpdate = true;
  return t;
}

function surfaceGeometry(grid: TileGrid, cell: number, origin: readonly [number, number], height: number | Float32Array): Geometry {
  const W = grid.width, D = grid.depth;
  const positions = new Float32Array((W + 1) * (D + 1) * 3);
  if (typeof height !== "number" && height.length !== (W + 1) * (D + 1)) throw new Error("A tile surface needs one height per grid vertex.");
  for (let j = 0; j <= D; j += 1) {
    for (let i = 0; i <= W; i += 1) {
      const v = j * (W + 1) + i;
      positions[v * 3] = origin[0] + i * cell;
      positions[v * 3 + 1] = typeof height === "number" ? height : height[v]!;
      positions[v * 3 + 2] = origin[1] + j * cell;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < D; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const a = j * (W + 1) + i, b = a + 1, c = a + W + 1, d = c + 1;
      // Counter-clockwise seen from above.
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new Geometry();
  geometry.setAttribute("position", new Attribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export function createTileSurface(grid: TileGrid, spec: TileSurfaceSpec): TileSurface {
  const cell = spec.cell ?? 1;
  const origin = spec.origin ?? [0, 0];
  const texels = Math.max(1, Math.round(spec.texels ?? 16));
  const count = grid.materials.length;
  if (count > MAX_TILE_MATERIALS) throw new RangeError(`A tile surface draws up to ${String(MAX_TILE_MATERIALS)} materials.`);

  const cellData = new Uint8Array(grid.width * grid.depth);
  const cells = new DataTexture(cellData, grid.width, grid.depth, "red", "u8");
  // (Single-channel rows of any width: no row padding.)
  cells.unpackAlignment = 1;
  const lut = new DataTexture(BLOB_LUT.slice(), 256, 1, "red", "u8");
  lut.unpackAlignment = 1;
  lut.needsUpdate = true;
  const atlases: DataTexture[] = [];
  const A = Array.from({ length: MAX_TILE_MATERIALS }, () => new Vector4(0, 0, 0, 0));
  const B = Array.from({ length: MAX_TILE_MATERIALS }, () => new Vector4(0, 0, 0, 0));
  const C = Array.from({ length: MAX_TILE_MATERIALS }, () => new Vector4(1, 1, 1, 1));
  const ramp = Array.from({ length: MAX_TILE_MATERIALS * 4 }, () => new Color());
  grid.materials.forEach((name, i) => {
    const m = spec.materials[name];
    if (m === undefined) throw new Error(`Tile material ${name} has no look.`);
    const system = i === 0 ? "blend" : m.system ?? "blend";
    let slot = -1;
    if (system !== "blend") {
      const atlas = m.atlas;
      if (atlas === undefined || atlas.system !== system) throw new Error(`Tile material ${name} needs a ${system} atlas.`);
      slot = atlases.length;
      if (slot >= 4) throw new RangeError("A tile surface holds up to 4 atlases.");
      atlases.push(atlasTexture(atlas));
      const { cols } = SYSTEM_TILES[system];
      C[i]!.set(atlas.tile, cols, atlas.rows, atlas.variants);
      B[i]!.w = atlas.mode === "color" ? 1 : 0;
    }
    A[i]!.set(SYSTEM_CODE[system], PATTERN_CODE[m.pattern ?? "noise"], m.scale ?? 1, Math.min(0.5, Math.max(0, m.rough ?? 0.22)));
    B[i]!.x = m.rim === false ? 0 : 1;
    B[i]!.y = Math.min(3, Math.max(0, m.shadow ?? 1));
    B[i]!.z = slot;
    m.ramp.forEach((c, k) => ramp[i * 4 + k]!.set(c));
  });

  let mask: DataTexture | null = null;
  if (spec.clip) {
    const w = grid.width * texels, h = grid.depth * texels;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) data[y * w + x] = spec.clip(origin[0] + ((x + 0.5) / texels) * cell, origin[1] + ((y + 0.5) / texels) * cell) ? 255 : 0;
    mask = new DataTexture(data, w, h, "red", "u8");
    mask.unpackAlignment = 1;
    mask.needsUpdate = true;
  }

  const fill = blank();
  const uniforms = {
    uTileFrame: { value: new Vector4(origin[0], origin[1], cell, 0) },
    uTileCells: { value: cells },
    uTileMask: { value: mask ?? fill },
    uTileLut: { value: lut },
    uTileAtlas0: { value: atlases[0] ?? fill },
    uTileAtlas1: { value: atlases[1] ?? fill },
    uTileAtlas2: { value: atlases[2] ?? fill },
    uTileAtlas3: { value: atlases[3] ?? fill },
    uTileGrid: { value: new Vector4(grid.width, grid.depth, texels, 0) },
    uTileA: { value: A },
    uTileB: { value: B },
    uTileC: { value: C },
    uTileRamp: { value: ramp },
    uTileCount: { value: count },
    uTileMasked: { value: mask ? 1 : 0 },
  };

  const material = new LitMaterial({ color: "#ffffff", roughness: spec.roughness ?? 0.95, metalness: 0 });
  material.onCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = TILE_VERTEX_HEAD + shader.vertexShader.replace("#include <begin_vertex>", TILE_VERTEX_BEGIN);
    shader.fragmentShader = TILE_FRAGMENT_HEAD + shader.fragmentShader.replace("#include <map_fragment>", TILE_FRAGMENT_MAP);
  };
  material.customProgramCacheKey = () => "keel-tiles";
  // (A look that swaps materials must keep this one: the tiles live in its shader.)
  material.userData.voxelDitherKeep = true;

  const mesh = new Mesh(surfaceGeometry(grid, cell, origin, spec.height ?? 0), material);
  mesh.receiveShadow = true;
  mesh.name = "keel-tiles";

  let uploaded = -1;
  const upload = (): void => {
    if (uploaded === grid.version) return;
    cellData.set(grid.cells);
    cells.needsUpdate = true;
    uploaded = grid.version;
  };
  upload();

  const cellAt = (x: number, z: number): readonly [number, number] | null => {
    const i = Math.floor((x - origin[0]) / cell), j = Math.floor((z - origin[1]) / cell);
    return i < 0 || j < 0 || i >= grid.width || j >= grid.depth ? null : [i, j];
  };
  return {
    mesh, material, grid,
    update: upload,
    setRamp(name, colors) {
      const i = grid.index(name);
      colors.forEach((c, k) => ramp[i * 4 + k]!.set(c));
    },
    setTime(seconds) { uniforms.uTileGrid.value.w = seconds; },
    materialAt(x, z) {
      const c = cellAt(x, z);
      return c === null ? null : grid.materials[grid.at(c[0], c[1])]!;
    },
    cellAt,
    covers(x, z) { return cellAt(x, z) !== null && (spec.clip?.(x, z) ?? true); },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      cells.dispose();
      lut.dispose();
      mask?.dispose();
      fill.dispose();
      for (const t of atlases) t.dispose();
    },
  };
}
