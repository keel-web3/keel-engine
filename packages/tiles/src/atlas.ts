// Tile atlases: every tile of one system, in index order, `cols` to a row,
// variants stacked below as whole blocks. Row 0 of a tile is its north edge.
//
// A painted atlas ("shade" mode) holds no colours, only where the material is
// and how each texel shades, so one atlas serves every material and season:
//   alpha 255  the material covers the texel; red is its shade step:
//              0 one darker (the south lip), 128 as the pattern, 255 one
//              lighter (the lit north rim)
//   alpha 0    it does not; red 0 marks the drop shadow the edge casts on
//              the material beneath, 128 leaves it alone
// An imported atlas ("color" mode) is a pixel artist's own sheet, drawn as is.

import { BLOB47, SYSTEM_TILES, tileNeighbourhood } from "./systems.ts";
import type { TileSystem } from "./systems.ts";

export type AtlasSystem = Exclude<TileSystem, "blend">;

export interface TileAtlas {
  readonly system: AtlasSystem;
  /** A tile's size in texels (square). */
  readonly tile: number;
  readonly cols: number;
  readonly rows: number;
  readonly variants: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly mode: "shade" | "color";
}

export interface PaintOptions {
  /** Texels to a tile (4..64). */
  readonly tile?: number;
  readonly seed?: number;
  /** How far the edge wanders, in tiles (0..0.4). */
  readonly rough?: number;
  /** Grows (+) or shrinks (-) the material past the cell edge, in tiles. */
  readonly grow?: number;
  /** How round the corners are: 0 square, 1 round. */
  readonly round?: number;
  /** A lit rim and a dark lip (pixel-art edge shading). */
  readonly rim?: boolean;
  /** The drop shadow's depth in texels (0: none). */
  readonly shadow?: number;
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A wandering edge that repeats every tile, so tiles side by side meet texel
 * for texel along their shared edge whichever tiles they are.
 */
function edgeNoise(seed: number): (u: number, w: number) => number {
  const waves = Array.from({ length: 3 }, (_, k) => ({ a: 1 / (k + 1.5), fu: k + 1, fw: (k % 2) + 1, pu: hash(seed * 7 + k) * Math.PI * 2, pw: hash(seed * 13 + k + 5) * Math.PI * 2 }));
  const norm = waves.reduce((s, w) => s + w.a, 0);
  return (u, w) => waves.reduce((s, v) => s + v.a * Math.sin(Math.PI * 2 * v.fu * u + v.pu) * Math.cos(Math.PI * 2 * v.fw * w + v.pw), 0) / norm;
}

/** The coverage field of one tile at (u, w) in tile units (w north): above 0.5 is in. */
function tileField(system: AtlasSystem, index: number, round: number): (u: number, w: number) => number {
  if (system === "dual16") {
    // Corners on the tile's four corners: NE (1,1), SE (1,0), SW (0,0), NW (0,1).
    const c = [(index & 4) !== 0, (index & 2) !== 0, (index & 8) !== 0, (index & 1) !== 0].map(Number) as [number, number, number, number];
    return (u, w) => {
      const x = Math.min(1, Math.max(0, u)), y = Math.min(1, Math.max(0, w));
      const sx = x * x * (3 - 2 * x) * round + x * (1 - round), sy = y * y * (3 - 2 * y) * round + y * (1 - round);
      return (c[0] * (1 - sx) + c[1] * sx) * (1 - sy) + (c[2] * (1 - sx) + c[3] * sx) * sy;
    };
  }
  const nb = tileNeighbourhood(system, index).map(Number);
  // Cell centres sit at -0.5, 0.5 and 1.5; the field is the blend of the four round the point.
  return (u, w) => {
    const cx = Math.min(1.999, Math.max(0, u + 0.5)), cz = Math.min(1.999, Math.max(0, w + 0.5));
    const i = Math.floor(cx), j = Math.floor(cz);
    let fx = cx - i, fz = cz - j;
    fx = fx * fx * (3 - 2 * fx) * round + fx * (1 - round);
    fz = fz * fz * (3 - 2 * fz) * round + fz * (1 - round);
    const m = (col: number, rowFromSouth: number): number => nb[(2 - rowFromSouth) * 3 + col]!;
    return (m(i, j) * (1 - fx) + m(i + 1, j) * fx) * (1 - fz) + (m(i, j + 1) * (1 - fx) + m(i + 1, j + 1) * fx) * fz;
  };
}

/** Paints an atlas for a system: the transition shapes as pixel art, ready for any material's ramp. */
export function paintTileAtlas(system: AtlasSystem, { tile = 16, seed = 1, rough = 0.12, grow = 0, round = 0.7, rim = true, shadow = 1 }: PaintOptions = {}): TileAtlas {
  if (!Number.isInteger(tile) || tile < 4 || tile > 64) throw new RangeError("A painted tile is 4..64 texels.");
  const { count, cols } = SYSTEM_TILES[system];
  const rows = Math.ceil(count / cols);
  const width = cols * tile, height = rows * tile;
  const rgba = new Uint8Array(width * height * 4);
  const noise = edgeNoise(seed);
  for (let index = 0; index < count; index += 1) {
    const field = tileField(system, index, round);
    const inside = (px: number, py: number): boolean => {
      const u = (px + 0.5) / tile, w = 1 - (py + 0.5) / tile;
      return field(u, w) + noise(u, w) * rough + grow > 0.5;
    };
    const ox = (index % cols) * tile, oy = Math.floor(index / cols) * tile;
    for (let py = 0; py < tile; py += 1) {
      for (let px = 0; px < tile; px += 1) {
        const o = ((oy + py) * width + ox + px) * 4;
        if (inside(px, py)) {
          // Lit from the north: the rim facing it lightens, the lip facing away darkens.
          const shade = !rim ? 128 : !inside(px, py - 1) ? 255 : !inside(px, py + 1) ? 0 : 128;
          rgba[o] = shade; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 255;
        } else {
          let shaded = false;
          for (let d = 1; d <= shadow && !shaded; d += 1) shaded = inside(px, py - d);
          rgba[o] = shaded ? 0 : 128; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 0;
        }
      }
    }
  }
  return { system, tile, cols, rows, variants: 1, width, height, rgba, mode: "shade" };
}

// ---------------------------------------------------------------- creator sheets

export interface AtlasImage { readonly width: number; readonly height: number; readonly rgba: Uint8Array }

export type SheetLayout = AtlasSystem | "rpgmaker-a2";

export interface SheetSpec {
  readonly layout: SheetLayout;
  /** A tile's size in texels. */
  readonly tile: number;
  /** Where the block starts, in tiles. */
  readonly at?: readonly [number, number];
  /** Variant blocks to the block's right (each a whole block). */
  readonly variants?: number;
  /** The sheet's tile for each of the system's indices, when the artist drew them in another order. */
  readonly order?: readonly number[];
}

/**
 * RPG Maker A2's quarter pieces (in half tiles, inside its 2 x 3 tile block)
 * for one quadrant (0 TL, 1 TR, 2 BL, 3 BR), from the quadrant's vertical and
 * horizontal neighbours and its diagonal. (The same pieces as keel/terrain's
 * a2Quarter.)
 */
export function a2Quarter(q: number, edgeV: boolean, edgeH: boolean, diag: boolean): [number, number] {
  const T: ReadonlyArray<{ outer: [number, number]; vEdge: [number, number]; hEdge: [number, number]; inner: [number, number]; centre: [number, number] }> = [
    { outer: [0, 2], vEdge: [2, 2], hEdge: [0, 4], inner: [2, 0], centre: [2, 4] },
    { outer: [3, 2], vEdge: [1, 2], hEdge: [3, 4], inner: [3, 0], centre: [1, 4] },
    { outer: [0, 5], vEdge: [2, 5], hEdge: [0, 3], inner: [2, 1], centre: [2, 3] },
    { outer: [3, 5], vEdge: [1, 5], hEdge: [3, 3], inner: [3, 1], centre: [1, 3] },
  ];
  const t = T[q]!;
  if (!edgeV && !edgeH) return t.outer;
  if (!edgeV && edgeH) return t.vEdge;
  if (edgeV && !edgeH) return t.hEdge;
  return diag ? t.centre : t.inner;
}

/** Cuts a creator's sheet into an atlas; an RPG Maker A2 block is composed into the 47 blob tiles quarter by quarter. */
export function importTileAtlas(image: AtlasImage, spec: SheetSpec): TileAtlas {
  const T = spec.tile;
  if (!Number.isInteger(T) || T < 2 || T > 256) throw new RangeError("A sheet tile is 2..256 texels.");
  if (image.rgba.length !== image.width * image.height * 4) throw new Error("The sheet's pixels do not match its size.");
  const system: AtlasSystem = spec.layout === "rpgmaker-a2" ? "blob47" : spec.layout;
  const { count, cols } = SYSTEM_TILES[system];
  const rows = Math.ceil(count / cols);
  const variants = Math.max(1, Math.floor(spec.variants ?? 1));
  const [ax, ay] = spec.at ?? [0, 0];
  const width = cols * T, height = rows * T * variants;
  const rgba = new Uint8Array(width * height * 4);
  const copy = (sx: number, sy: number, dx: number, dy: number, w: number, h: number): void => {
    if (sx < 0 || sy < 0 || sx + w > image.width || sy + h > image.height) throw new RangeError("The sheet is too small for its layout.");
    for (let y = 0; y < h; y += 1) rgba.set(image.rgba.subarray(((sy + y) * image.width + sx) * 4, ((sy + y) * image.width + sx + w) * 4), ((dy + y) * width + dx) * 4);
  };
  const blockW = spec.layout === "rpgmaker-a2" ? 2 : cols;
  for (let v = 0; v < variants; v += 1) {
    const bx = (ax + v * blockW) * T, by = ay * T;
    for (let index = 0; index < count; index += 1) {
      const dx = (index % cols) * T, dy = (Math.floor(index / cols) + v * rows) * T;
      if (spec.layout === "rpgmaker-a2") {
        const m = BLOB47[index]!;
        const bit = (k: number): boolean => (m & (1 << k)) !== 0;
        const h = T / 2;
        const quads: ReadonlyArray<readonly [boolean, boolean, boolean]> = [[bit(0), bit(6), bit(7)], [bit(0), bit(2), bit(1)], [bit(4), bit(6), bit(5)], [bit(4), bit(2), bit(3)]];
        quads.forEach(([ev, eh, dg], q) => {
          const [qx, qy] = a2Quarter(q, ev, eh, dg);
          copy(bx + qx * h, by + qy * h, dx + (q % 2) * h, dy + Math.floor(q / 2) * h, h, h);
        });
      } else {
        const from = spec.order?.[index] ?? index;
        copy(bx + (from % cols) * T, by + Math.floor(from / cols) * T, dx, dy, T, T);
      }
    }
  }
  return { system, tile: T, cols, rows, variants, width, height, rgba, mode: "color" };
}
