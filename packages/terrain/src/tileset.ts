// A creator's own TILESET driving the ground: a PNG atlas (decoded to RGBA)
// and a rules file, in one of the layouts pixel artists already draw:
//
//   blob47        47 tiles per material, 8 to a row, in BLOB47 order (the
//                 reduced 8-neighbour masks, ascending): the full Wang blob set
//   wang16        16 tiles per material, 4 x 4, indexed by corners
//                 (NE 1, SE 2, SW 4, NW 8: a corner is "in" when the tile and
//                 its three neighbours round that corner are the material)
//   rpgmaker-a2   RPG Maker's A2 autotile: a 2 x 3 tile block of quarter
//                 tiles (a preview, the inner corners, a frame) from which the
//                 47 blob tiles are composed quarter by quarter
//
// importTileset() cuts and composes every material's 47 tiles and quantises
// the colours into ONE ramp (every distinct colour, dark to light), so the
// result stays palette-true: tilesetPalette() adds that ramp to a ground
// palette, tilesetStyle() is a custom ground style whose painter answers each
// top texel of a tileset material with the tile its neighbours pick
// (auto-tiling's blob mask) -- the same baker, the same chunk layers, depth,
// water and cliffs, the creator's art on the tops.

import type { RGB } from "@keel-engine/core";
import { BLOB47, blobIndex } from "./autotile.ts";
import { DX8, DZ8 } from "./types.ts";
import type { Terrain } from "./grid.ts";
import type { GroundPainter, GroundStyle } from "./ground.ts";
import type { GroundPalette } from "./palette.ts";

export type TilesetLayout = "blob47" | "wang16" | "rpgmaker-a2";

export interface TilesetRules {
  readonly id: string;
  readonly layout: TilesetLayout;
  /** A tile's size in pixels (square). */
  readonly tile: number;
  /** Per terrain type: where its block starts in the atlas (in tiles), and optional variant blocks to its right. */
  readonly materials: ReadonlyArray<{ readonly type: string; readonly at: readonly [number, number]; readonly over?: string; readonly variants?: number }>;
}

export interface TilesetImage { readonly width: number; readonly height: number; readonly rgba: Uint8Array }

export interface Tileset {
  readonly rules: TilesetRules;
  readonly tile: number;
  /** Every distinct opaque colour, dark to light: the tileset's ramp. */
  readonly colours: readonly RGB[];
  /** The ramp's name in a palette (tilesetPalette). */
  readonly ramp: string;
  /** A material's composed tile for a raw 8-bit neighbour mask (bit d = dir8 d) and a variant: tile x tile ramp positions (255: see-through). */
  tileFor(type: string, mask: number, variant?: number): Uint8Array | null;
  readonly materials: readonly string[];
}

const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Which blob47 variant a blob index is, as its reduced mask. */
const maskOfBlob = (index: number): number => BLOB47[index]!;

/**
 * The RPG Maker A2 quarter a quadrant takes, in minitiles (columns 0..3, rows 0..5 of the block), from the
 * quadrant's two edges and its diagonal (true: the same material there). Quadrants: 0 TL, 1 TR, 2 BL, 3 BR.
 */
export function a2Quarter(q: number, edgeV: boolean, edgeH: boolean, diag: boolean): [number, number] {
  // (edgeV: the neighbour above or below the quadrant; edgeH: beside it.)
  const T: ReadonlyArray<{ outer: [number, number]; vEdge: [number, number]; hEdge: [number, number]; inner: [number, number]; centre: [number, number] }> = [
    { outer: [0, 2], vEdge: [2, 2], hEdge: [0, 4], inner: [2, 0], centre: [2, 4] }, // TL
    { outer: [3, 2], vEdge: [1, 2], hEdge: [3, 4], inner: [3, 0], centre: [1, 4] }, // TR
    { outer: [0, 5], vEdge: [2, 5], hEdge: [0, 3], inner: [2, 1], centre: [2, 3] }, // BL
    { outer: [3, 5], vEdge: [1, 5], hEdge: [3, 3], inner: [3, 1], centre: [1, 3] }, // BR
  ];
  const t = T[q]!;
  // (vEdge: the piece whose open side runs horizontally -- the material continues beside, not above.)
  if (!edgeV && !edgeH) return t.outer;
  if (!edgeV && edgeH) return t.vEdge;
  if (edgeV && !edgeH) return t.hEdge;
  return diag ? t.centre : t.inner;
}

/** Cut and compose a tileset: every material's 47 blob tiles (and variants), its colours as one ramp. */
export function importTileset(image: TilesetImage, rules: TilesetRules): Tileset {
  const T = rules.tile;
  if (!Number.isInteger(T) || T < 2 || T % 2) throw new RangeError("A tileset's tile size is an even number of pixels.");
  const px = (x: number, y: number): [number, number, number, number] => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw new RangeError(`Tileset ${rules.id}: pixel ${x},${y} is outside the ${image.width} x ${image.height} image.`);
    const o = (y * image.width + x) * 4;
    return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!, image.rgba[o + 3]!];
  };
  // Tiles as RGBA first (composed), then quantised to the shared ramp.
  const raw = new Map<string, Array<Array<[number, number, number, number]>>>(); // `${type}` -> per variant*47 tile pixels
  const cut = (tx: number, ty: number): Array<[number, number, number, number]> => { const out: Array<[number, number, number, number]> = []; for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) out.push(px(tx * T + x, ty * T + y)); return out; };
  for (const m of rules.materials) {
    const list: Array<Array<[number, number, number, number]>> = [];
    for (let v = 0; v < Math.max(1, m.variants ?? 1); v += 1) {
      if (rules.layout === "blob47") {
        const bx = m.at[0] + v * 8;
        for (let i = 0; i < 47; i += 1) list.push(cut(bx + (i % 8), m.at[1] + Math.floor(i / 8)));
      } else if (rules.layout === "wang16") {
        const bx = m.at[0] + v * 4;
        const wang = Array.from({ length: 16 }, (_, c) => cut(bx + (c % 4), m.at[1] + Math.floor(c / 4)));
        for (let i = 0; i < 47; i += 1) list.push(wang[wangIndex(maskOfBlob(i))]!);
      } else {
        // A2: minitiles of T/2 in a 4 x 6 grid from the block's corner.
        const H = T / 2, bx = (m.at[0] + v * 2) * T, by = m.at[1] * T;
        for (let i = 0; i < 47; i += 1) {
          const mask = maskOfBlob(i);
          const N = (mask & 1) !== 0, NE = (mask & 2) !== 0, E = (mask & 4) !== 0, SE = (mask & 8) !== 0, S = (mask & 16) !== 0, SW = (mask & 32) !== 0, W = (mask & 64) !== 0, NW = (mask & 128) !== 0;
          // (Quadrants in picture terms: top is north.)
          const quads = [a2Quarter(0, N, W, NW), a2Quarter(1, N, E, NE), a2Quarter(2, S, W, SW), a2Quarter(3, S, E, SE)];
          const tile: Array<[number, number, number, number]> = [];
          for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) {
            const q = (y >= H ? 2 : 0) + (x >= H ? 1 : 0);
            const [mx, my] = quads[q]!;
            tile.push(px(bx + mx * H + (x % H), by + my * H + (y % H)));
          }
          list.push(tile);
        }
      }
    }
    raw.set(m.type, list);
  }
  // The ramp: every distinct opaque colour, dark to light.
  const key = (c: readonly number[]): number => (c[0]! << 16) | (c[1]! << 8) | c[2]!;
  const seen = new Map<number, RGB>();
  for (const list of raw.values()) for (const tile of list) for (const p of tile) if (p[3] >= 128) seen.set(key(p), [p[0], p[1], p[2]]);
  const colours = [...seen.values()].sort((a, b) => luma(a) - luma(b) || key(a) - key(b));
  if (colours.length > 4096) throw new RangeError(`Tileset ${rules.id}: ${colours.length} colours; pixel art keeps it under 4096.`);
  const index = new Map(colours.map((c, i) => [key(c), i] as const));
  const tiles = new Map<string, Uint8Array[]>();
  const wide = colours.length > 255;
  for (const [type, list] of raw) tiles.set(type, list.map((tile) => { const out = wide ? new Uint16Array(T * T) : new Uint8Array(T * T); tile.forEach((p, n) => { out[n] = p[3] < 128 ? (wide ? 65535 : 255) : index.get(key(p))!; }); return out as unknown as Uint8Array; }));
  return {
    rules, tile: T, colours, ramp: `tileset:${rules.id}`, materials: rules.materials.map((m) => m.type),
    tileFor(type, mask, variant = 0) {
      const list = tiles.get(type);
      if (!list) return null;
      const v = Math.abs(variant) % Math.max(1, list.length / 47);
      return list[v * 47 + blobIndex(mask)] ?? null;
    },
  };
}

/** A wang-16 corner index from a raw 8-bit mask: NE 1, SE 2, SW 4, NW 8 (a corner in when its two edges and diagonal are). */
export function wangIndex(mask: number): number {
  const on = (a: number, b: number, c: number): boolean => (mask & (1 << a)) !== 0 && (mask & (1 << b)) !== 0 && (mask & (1 << c)) !== 0;
  return (on(0, 1, 2) ? 1 : 0) | (on(2, 3, 4) ? 2 : 0) | (on(4, 5, 6) ? 4 : 0) | (on(6, 7, 0) ? 8 : 0);
}

/** A ground palette with the tileset's ramp added (indices of everything else unchanged). */
export function tilesetPalette(base: GroundPalette, ts: Tileset): GroundPalette {
  const colours = base.colours.slice();
  const ramps: Record<string, readonly [number, number]> = { ...base.ramps, [ts.ramp]: [colours.length, ts.colours.length] };
  colours.push(...ts.colours.map((c) => [c[0], c[1], c[2]] as RGB));
  return { colours, ramps, cycles: base.cycles, key: `${base.key}+${ts.ramp}.${ts.colours.length}`, ramp(name) { const r = ramps[name]; if (!r) throw new RangeError(`No ground ramp "${name}".`); return r; } };
}

/**
 * The painter for a tileset: a top texel of a tileset material takes its
 * tile's pixel (the tile its same-type neighbours pick; a variant by place);
 * anything else keeps the pixel style's answer. `origin` is the terrain's
 * world tile at (0, 0) (a world chunk's own terrain).
 */
export function tilesetPainter(ts: Tileset, t: Terrain, origin: readonly [number, number] = [0, 0]): GroundPainter {
  const len = ts.colours.length;
  const materials = new Set(ts.materials);
  const masks = new Int16Array(t.width * t.depth).fill(-1);
  const maskOf = (k: number): number => {
    let m = masks[k]!;
    if (m >= 0) return m;
    const i = k % t.width, j = (k - i) / t.width, ty = t.type[k];
    m = 0;
    for (let d = 0; d < 8; d += 1) {
      const ni = i + DX8[d]!, nj = j + DZ8[d]!;
      // (Off the terrain counts as the same: an edge tile doesn't draw a border into nothing.)
      if (!t.inside(ni, nj) || (t.type[t.index(ni, nj)] === ty && t.height[t.index(ni, nj)] === t.height[k])) m |= 1 << d;
    }
    masks[k] = m;
    return m;
  };
  return (texel) => {
    if (texel.kind !== "top" || texel.tile < 0 || !materials.has(texel.material)) return null;
    const k = texel.tile;
    const i = k % t.width, j = (k - i) / t.width;
    const u = texel.x / t.tileSize - (i + origin[0]), v = texel.z / t.tileSize - (j + origin[1]);
    const T = ts.tile;
    const x = Math.max(0, Math.min(T - 1, Math.floor(u * T))), y = Math.max(0, Math.min(T - 1, Math.floor((1 - v) * T)));
    const variant = ((i + origin[0]) * 7 + (j + origin[1]) * 13) & 3;
    const tile = ts.tileFor(texel.material, maskOf(k), variant);
    if (!tile) return null;
    const p = tile[y * T + x]!;
    if (p === 255 || p === 65535) return null;
    return { ramp: ts.ramp, t: len > 1 ? p / (len - 1) : 0 };
  };
}

/** A ground style drawing a tileset's materials exactly (no screen, no dither: the art's own pixels). */
export function tilesetStyle(ts: Tileset, t: Terrain, origin: readonly [number, number] = [0, 0]): GroundStyle {
  return { name: "custom", id: `tileset.${ts.rules.id}`, screen: 0, dither: 0, outline: 2, paint: tilesetPainter(ts, t, origin) };
}
