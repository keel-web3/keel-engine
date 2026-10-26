// Surface materials as pixel art, painted from a seed: bark plates, summer
// leaves, autumn leaves, blossom and snow, each a block of cells lit from the
// upper left. One seed paints one atlas; every cell is its own variant of its
// family's look, with the plates, leaves and drifts placed anew.
//
// A family's block is painted as one light field at art resolution (`pixels`
// art pixels per cell side), so bark plates run across cells and leaves spill
// into their neighbours. The field is then read through the family's ramp by
// rank: a ramp's colours each cover an equal share of the block, darkest
// first. However a seed or the variance moves the shapes, the block keeps its
// family's palette and balance of light and shade. The art is scaled up,
// nearest, to the atlas size. Rows run top-down, as an image's do.

import type { Raster } from "./raster.ts";

export const MATERIAL_FAMILIES = ["bark", "foliage", "autumn", "blossom", "snow"] as const;
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];

/**
 * A family's colours, darkest first, each covering an equal share of its
 * block. An accent ramp is a second hue that some cells lean to (autumn's
 * reds), blended per cell.
 */
export interface MaterialPalette {
  readonly ramp: readonly string[];
  readonly accent?: readonly string[];
}

// Measured from the grove's hand-painted atlas: each ramp is the mean colour
// of twelve equal shares of a family's pixels, by brightness.
export const MATERIAL_PALETTES: Readonly<Record<MaterialFamily, MaterialPalette>> = {
  bark: { ramp: ["#0d0c0d", "#171412", "#1d1815", "#221c18", "#271f1a", "#2c231d", "#322720", "#392c23", "#413227", "#4b392c", "#584233", "#6c513e"] },
  foliage: {
    ramp: ["#0e220b", "#1b310d", "#243b0e", "#2c4410", "#344e12", "#3d5815", "#476319", "#516f1d", "#5d7b20", "#6b8923", "#7b9727", "#92ab31"],
    accent: ["#081a0c", "#102610", "#152d13", "#193315", "#1e3a18", "#24411c", "#2b4a20", "#325425", "#3b5e2b", "#446930", "#53782e", "#7b982d"],
  },
  autumn: {
    ramp: ["#301406", "#481d07", "#572406", "#642a08", "#712f08", "#7d3609", "#8c3e0b", "#9c480d", "#ae5310", "#be5f12", "#d06c14", "#e2821c"],
    accent: ["#2b1009", "#3b140c", "#46170e", "#50190f", "#5b1b11", "#661e13", "#732315", "#812619", "#8f2a1b", "#9f2f1d", "#ac3521", "#c04226"],
  },
  blossom: {
    ramp: ["#2a0f1a", "#3d1626", "#4e1e31", "#5f283d", "#70334a", "#823f58", "#944c67", "#a65b77", "#b86c88", "#c97f9a", "#d995ad", "#e8b0c4"],
    accent: ["#2c1424", "#401d33", "#522741", "#63324f", "#743e5e", "#864b6d", "#98597d", "#aa698e", "#bb7a9f", "#cb8eb1", "#dba4c3", "#ebc0d7"],
  },
  snow: { ramp: ["#1f3140", "#3a5165", "#546c82", "#6e879e", "#8a9fb5", "#a2b3c5", "#b6c3d1", "#c7d0dc", "#d4dae3", "#dee2e8", "#e5e7ec", "#ededf0"] },
};

export interface MaterialAtlas {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** The families' names, in block order. */
  readonly families: readonly string[];
  /** Cells per block side: each family is a block of columns x columns cells. */
  readonly columns: number;
  /** Family blocks per atlas row. */
  readonly blocks: number;
  /** Art pixels per cell side. */
  readonly pixels: number;
  /** The atlas at art resolution, one pixel per art pixel. */
  readonly art: Raster;
}

export interface MaterialAtlasOptions {
  readonly families?: readonly MaterialFamily[];
  readonly columns?: number;
  readonly pixels?: number;
  /** The atlas width in texels (its height follows the block rows). */
  readonly size?: number;
  readonly seed?: number;
  readonly palettes?: Readonly<Partial<Record<MaterialFamily, MaterialPalette>>>;
  /** How far cells wander from their family's look, 0..1: brightness, hue, leaf size and spill, plate lengths. */
  readonly variance?: number;
}

type RGB = readonly [number, number, number];

function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex: string): RGB {
  const m = /^#([0-9a-f]{6})$/iu.exec(hex);
  if (m === null) throw new TypeError(`A material colour is #rrggbb, not ${hex}.`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (a: number, b: number, t: number): number => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const fract = (t: number): number => t - Math.floor(t);

// Piecewise-linear through [at, value] knots, at ascending in 0..1.
function knots(table: readonly (readonly [number, number])[], t: number): number {
  let i = 1;
  while (i < table.length - 1 && t > table[i]![0]) i += 1;
  const [a, va] = table[i - 1]!, [b, vb] = table[i]!;
  return va + (vb - va) * clamp01((t - a) / (b - a));
}

// Smooth value noise over a lattice of `size` squares across 0..1.
function noise(rand: () => number, size: number): (x: number, y: number) => number {
  const grid = Array.from({ length: (size + 1) * (size + 1) }, () => rand());
  return (x, y) => {
    const gx = clamp01(x) * size, gy = clamp01(y) * size;
    const ix = Math.min(size - 1, Math.floor(gx)), iy = Math.min(size - 1, Math.floor(gy));
    const fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number): number => grid[j * (size + 1) + i]!;
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

// A family's block at art resolution: its light field and, per pixel, how far
// it leans to the accent hue.
class Block {
  readonly n: number;
  readonly columns: number;
  readonly side: number;
  readonly field: Float32Array;
  readonly lean: Float32Array;
  constructor(n: number, columns: number) {
    this.n = n;
    this.columns = columns;
    this.side = n * columns;
    this.field = new Float32Array(this.side * this.side);
    this.lean = new Float32Array(this.side * this.side);
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.side && y < this.side;
  }
}

type Painter = (block: Block, rand: () => number, variance: number) => void;

// How the light falls across a bark plate, left edge to right: a shadowed
// edge, a lit face, a darker right shoulder and a black gutter.
const PLATE: readonly (readonly [number, number])[] = [[0, 0.34], [0.07, 0.6], [0.28, 0.86], [0.6, 0.74], [0.72, 0.52], [0.92, 0.4], [1, 0.06]];

// One plate of bark per column of cells, broken into lengths at staggered
// heights. Furrows split each length into raised ridges, lit on their left;
// a furrow runs down from the top of its length or up from its foot and
// ends in a point, where its ridges merge.
function bark(block: Block, rand: () => number, variance: number): void {
  const { n, side, field } = block;
  const grain = noise(rand, 24);
  for (let c = 0; c < block.columns; c += 1) {
    const x0 = c * n;
    let y0 = -Math.floor(rand() * n * 1.4);
    while (y0 < side) {
      const length = Math.round(n * (1 + rand() * (1 + variance)));
      const y1 = y0 + length;
      const gain = 1 + (rand() - 0.5) * 0.24 * (0.5 + variance);
      const furrows: { x: number; from: number; to: number }[] = [];
      const count = 2 + Math.floor(rand() * 2.2);
      for (let k = 0; k < count; k += 1) {
        const x = 2 + Math.round(((k + 0.5 + (rand() - 0.5) * 0.6) / count) * (n - 5));
        const reach = Math.round(length * (0.45 + rand() * 0.55));
        furrows.push(rand() < 0.6 ? { x, from: y0 + 1, to: y0 + 1 + reach } : { x, from: y1 - 1 - reach, to: y1 - 1 });
      }
      for (let y = Math.max(0, y0); y < Math.min(side, y1); y += 1) {
        const along = (y - y0) / length;
        // The furrows open at this height, sorted left to right, between the plate's edges.
        const open = furrows.filter((f) => y >= f.from && y < f.to).map((f) => f.x).sort((a, b) => a - b);
        const walls = [0, ...open, n - 1];
        for (let x = 0; x < n; x += 1) {
          let t = knots(PLATE, x / (n - 1)) * gain;
          if (open.includes(x)) t *= 0.42;
          else {
            let w = 0;
            while (x > walls[w + 1]!) w += 1;
            const a = walls[w]!, b = walls[w + 1]!, r = (x - a) / Math.max(1, b - a);
            t *= 0.82 + 0.36 * Math.sin(Math.PI * Math.min(1, r * 1.25)) * (1 - 0.35 * r);
          }
          if (y === y0) t *= 0.15;
          else if (y === y0 + 1) t *= x > 0 && x < n - 1 ? 1.12 : 0.6;
          else if (y === y1 - 1) t *= 0.72;
          t *= 1 - 0.12 * along;
          t += (grain((x0 + x) / side, (y / side) * 0.35) - 0.5) * 0.14;
          field[y * side + x0 + x] = t;
        }
      }
      y0 = y1;
    }
  }
  shadeRows(block, [[0, 1.16], [0.17, 1], [0.8, 1], [1, 0.8]]);
}

// A lobed leaflet, as the distance from its outline (negative inside) in
// units of its own length, with its light from the upper left.
interface Leaflet {
  readonly x: number;
  readonly y: number;
  readonly along: number;
  readonly across: number;
  readonly angle: number;
  readonly lobes: number;
  readonly tone: number;
}
function leaflet(l: Leaflet, x: number, y: number): { readonly edge: number; readonly lit: number; readonly rib: number } {
  const dx = x - l.x, dy = y - l.y;
  const c = Math.cos(l.angle), s = Math.sin(l.angle);
  const a = (dx * c + dy * s) / l.along, b = (-dx * s + dy * c) / l.across;
  const r = Math.hypot(a, b), theta = Math.atan2(b, a);
  const outline = 1 + 0.1 * Math.cos(theta * l.lobes) - 0.12 * Math.max(0, -a);
  return { edge: r - outline, lit: clamp01(0.5 - ((dx + dy) / (l.along + l.across)) * 0.9), rib: Math.abs(b * l.across) < 0.55 && a < 0.7 ? 1 : 0 };
}

// A rounded mound of ground in each cell carrying a rosette of five to seven
// lobed leaflets around a point in its upper middle; some rosettes sit across
// a seam and spill over into the next cell. Lower leaflets lie over upper ones
// and cast a soft shadow down and to the right.
function leaves(block: Block, rand: () => number, variance: number, size: number, lean: (rand: () => number) => number): void {
  const { n, side, field } = block;
  const cover = new Uint8Array(side * side);
  const ground = noise(rand, block.columns * 3);
  const cellLean: number[] = [];
  for (let cell = 0; cell < block.columns * block.columns; cell += 1) cellLean.push(lean(rand));
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const u = (x % n + 0.5) / n, v = (y % n + 0.5) / n;
      const edge = Math.min(x % n, y % n, n - 1 - (x % n), n - 1 - (y % n));
      const rim = 0.25 + 0.75 * smooth(-0.5, 2.5, edge);
      field[y * side + x] = rim * (0.4 + 0.08 * (1 - v) + (ground(x / side, y / side) - 0.5) * 0.16);
      block.lean[y * side + x] = cellLean[Math.floor(y / n) * block.columns + Math.floor(x / n)]!;
    }
  }
  const rosettes: { x: number; y: number; r: number; lean: number }[] = [];
  for (let cell = 0; cell < block.columns * block.columns; cell += 1) {
    const cx = (cell % block.columns) * n, cy = Math.floor(cell / block.columns) * n;
    const r = n * size * (1 + (rand() - 0.5) * 0.3 * (0.5 + variance));
    rosettes.push({ x: cx + n * (0.5 + (rand() - 0.5) * 0.2), y: cy + n * (0.46 + (rand() - 0.5) * 0.14), r, lean: cellLean[cell]! });
    if (rand() < 0.12 + variance * 0.2) {
      // A smaller rosette astride a seam, in its cell's hue.
      const right = rand() < 0.5;
      rosettes.push({ x: cx + (right ? n : n * (0.3 + rand() * 0.4)), y: cy + (right ? n * (0.3 + rand() * 0.5) : n), r: r * 0.62, lean: cellLean[cell]! });
    }
  }
  for (const rosette of rosettes) {
    const count = 5 + Math.floor(rand() * 3);
    const turn = rand() * Math.PI * 2;
    const list: Leaflet[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = turn + (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const reach = rosette.r * (0.52 + rand() * 0.12);
      list.push({
        x: rosette.x + Math.cos(angle) * reach,
        y: rosette.y + Math.sin(angle) * reach,
        along: rosette.r * (0.52 + rand() * 0.1),
        across: rosette.r * (0.42 + rand() * 0.08),
        angle,
        lobes: 5 + Math.floor(rand() * 2),
        tone: 0.84 + rand() * 0.16,
      });
    }
    list.sort((a, b) => a.y - b.y);
    const reachMax = rosette.r * 1.3;
    for (const l of [...list, { x: rosette.x, y: rosette.y, along: rosette.r * 0.32, across: rosette.r * 0.32, angle: 0, lobes: 5, tone: 0.95 }]) {
      for (let y = Math.floor(rosette.y - reachMax); y <= rosette.y + reachMax; y += 1) {
        for (let x = Math.floor(rosette.x - reachMax); x <= rosette.x + reachMax; x += 1) {
          if (!block.inside(x, y)) continue;
          const { edge, lit, rib } = leaflet(l, x + 0.5, y + 0.5);
          if (edge > 0) continue;
          const i = y * side + x;
          const outline = edge > -0.2 ? 0.7 : 1;
          field[i] = (0.6 + 0.4 * lit) * l.tone * outline * (rib ? 0.88 : 1) + 0.25;
          block.lean[i] = rosette.lean;
          cover[i] = 1;
        }
      }
    }
  }
  // Leaves shade the ground just below and right of them.
  for (let y = side - 1; y > 0; y -= 1) {
    for (let x = side - 1; x > 0; x -= 1) {
      const i = y * side + x;
      if (cover[i] === 0 && cover[i - side - 1] === 1) field[i] = field[i]! * 0.7;
    }
  }
}

// A pillow of snow in each cell, brightest a little up and left of centre,
// crossed by faint wind creases rising to the right; the bank's lower rows sit
// in deeper, bluer shade.
function snow(block: Block, rand: () => number, variance: number): void {
  const { n, side, field } = block;
  const drift = noise(rand, block.columns * 2);
  for (let cell = 0; cell < block.columns * block.columns; cell += 1) {
    const cx = (cell % block.columns) * n, cy = Math.floor(cell / block.columns) * n;
    const hx = 0.5 + (rand() - 0.5) * 0.1 * (0.5 + variance), hy = 0.42 + (rand() - 0.5) * 0.1;
    const gain = 1 + (rand() - 0.5) * 0.1 * (0.5 + variance);
    const phase = rand() * 6, spacing = 4.5 + rand() * 1.5;
    const lumps = Array.from({ length: 4 }, () => [rand() * Math.PI * 2, 0.025 + rand() * 0.035 * (0.5 + variance)] as const);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const u = (x + 0.5) / n, v = (y + 0.5) / n;
        const angle = Math.atan2(v - hy, u - hx);
        const lump = lumps.reduce((sum, [p, a], k) => sum + a * Math.sin(angle * (k + 2) + p), 0);
        const d = (Math.abs(u - hx) / 0.6) ** 2.4 + (Math.abs(v - hy) / (v < hy ? 0.55 : 0.92)) ** 2.4 + lump;
        // The bulge of the row above shades this cell's top.
        const pillow = (0.36 + 0.64 * smooth(0, 1, 1 - d) ** 0.85) * (0.86 + 0.14 * smooth(0, 0.3, v)) * (1 - 0.2 * smooth(0.35, 1, v));
        const crease = fract((x * 0.6 - (n - y) + phase) / spacing);
        const wind = crease < 0.2 ? -0.05 : crease < 0.4 ? 0.02 : 0;
        const X = cx + x, Y = cy + y;
        field[Y * side + X] = (pillow + wind * smooth(0.3, 0.7, pillow)) * gain + (drift(X / side, Y / side) - 0.5) * 0.06;
      }
    }
  }
  shadeRows(block, [[0, 1], [0.3, 0.98], [0.6, 0.9], [0.72, 0.62], [1, 0.48]]);
}

// Scales the field by height down the block, as [v, factor] knots.
function shadeRows(block: Block, table: readonly (readonly [number, number])[]): void {
  for (let y = 0; y < block.side; y += 1) {
    const f = knots(table, (y + 0.5) / block.side);
    for (let x = 0; x < block.side; x += 1) block.field[y * block.side + x] = block.field[y * block.side + x]! * f;
  }
}

// Most cells keep the family's hue; some lean, by a cell, to the accent.
const leaning = (share: number) => (rand: () => number): number => (rand() < share ? 0.7 + rand() * 0.3 : rand() * 0.3);

const PAINTERS: Readonly<Record<MaterialFamily, Painter>> = {
  bark,
  foliage: (block, rand, variance) => leaves(block, rand, variance, 0.44, leaning(0.4)),
  autumn: (block, rand, variance) => leaves(block, rand, variance, 0.47, leaning(0.25 + variance * 0.1)),
  blossom: (block, rand, variance) => leaves(block, rand, variance, 0.42, leaning(0.35)),
  snow,
};

// Reads the block's field through its ramps by rank, into art pixels.
function colour(block: Block, ramp: readonly RGB[], accent: readonly RGB[], out: Uint8Array, width: number, ox: number, oy: number, cellGain: Float32Array): void {
  const { side, field, lean } = block;
  const count = side * side;
  const order = new Uint32Array(count).map((_, i) => i);
  const value = field.map((t, i) => t * cellGain[Math.floor(Math.floor(i / side) / block.n) * block.columns + Math.floor((i % side) / block.n)]!);
  order.sort((a, b) => value[a]! - value[b]! || a - b);
  const at = (r: readonly RGB[], pos: number, k: number): number => {
    const p = clamp01(pos) * r.length - 0.5;
    const i = Math.max(0, Math.min(r.length - 2, Math.floor(p))), f = clamp01(p - i);
    return r[i]![k]! + (r[i + 1]![k]! - r[i]![k]!) * f;
  };
  for (let rank = 0; rank < count; rank += 1) {
    const i = order[rank]!, pos = (rank + 0.5) / count, w = lean[i]!;
    const o = ((oy + Math.floor(i / side)) * width + ox + (i % side)) * 3;
    for (let k = 0; k < 3; k += 1) out[o + k] = Math.round(at(ramp, pos, k) * (1 - w) + at(accent, pos, k) * w);
  }
}

/** One family's block as a light field (0 shade to 1 light), side x side art pixels, row-major. */
export function paintMaterialField(family: MaterialFamily, pixels: number, columns: number, rand: () => number, variance: number): Float32Array {
  const painter = PAINTERS[family];
  if (painter === undefined) throw new Error(`Unknown material family ${family}.`);
  const block = new Block(pixels, columns);
  painter(block, rand, variance);
  return block.field;
}

/** Paints a block of `columns` x `columns` cells for each family from one seed, with no exemplar. */
export function paintProceduralAtlas({
  families = ["bark", "foliage", "autumn", "snow"],
  columns = 6,
  pixels = 16,
  size = 512,
  seed = 1,
  palettes = {},
  variance = 0.5,
}: MaterialAtlasOptions = {}): MaterialAtlas {
  if (families.length === 0) throw new RangeError("A material atlas paints at least one family.");
  const unknown = families.find((f) => !(f in PAINTERS));
  if (unknown !== undefined) throw new Error(`Unknown material family ${unknown}.`);
  if (!Number.isInteger(columns) || columns < 1 || columns > 16) throw new RangeError("A family block is 1..16 cells a side.");
  if (!Number.isInteger(pixels) || pixels < 8 || pixels > 64) throw new RangeError("A cell is 8..64 art pixels a side.");
  if (!Number.isInteger(size) || size < 16 || size > 4096) throw new RangeError("A material atlas is 16..4096 texels wide.");
  if (!(variance >= 0 && variance <= 1)) throw new RangeError("Variance is 0..1.");
  const blocks = Math.ceil(Math.sqrt(families.length));
  const rows = Math.ceil(families.length / blocks);
  const artW = blocks * columns * pixels, artH = rows * columns * pixels;
  const width = size, height = Math.round((size * artH) / artW);
  const art = new Uint8Array(artW * artH * 3);
  const artRGBA = new Uint8Array(artW * artH * 4);
  families.forEach((family, f) => {
    const palette = palettes[family] ?? MATERIAL_PALETTES[family];
    if (palette.ramp.length < 2) throw new RangeError(`The ${family} ramp needs 2 or more colours.`);
    const ramp = palette.ramp.map(rgb), accent = (palette.accent ?? palette.ramp).map(rgb);
    const rand = random(Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(f + 1, 0x85ebca6b));
    const block = new Block(pixels, columns);
    PAINTERS[family](block, rand, variance);
    // Some cells sit a little lighter or darker than the rest.
    const cellGain = new Float32Array(columns * columns).map(() => 1 + (rand() - 0.5) * 0.16 * variance);
    colour(block, ramp, accent, art, artW, (f % blocks) * block.side, Math.floor(f / blocks) * block.side, cellGain);
  });
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const ay = Math.min(artH - 1, Math.floor((y * artH) / height));
    for (let x = 0; x < width; x += 1) {
      const ax = Math.min(artW - 1, Math.floor((x * artW) / width));
      const a = (ay * artW + ax) * 3, o = (y * width + x) * 4;
      rgba[o] = art[a]!; rgba[o + 1] = art[a + 1]!; rgba[o + 2] = art[a + 2]!; rgba[o + 3] = 255;
    }
  }
  for (let i = 0; i < artW * artH; i += 1) { artRGBA.set(art.subarray(i * 3, i * 3 + 3), i * 4); artRGBA[i * 4 + 3] = 255; }
  return { width, height, rgba, families, columns, blocks, pixels, art: { width: artW, height: artH, rgba: artRGBA } };
}

/** A family's cell (variants wrap) as a texture region, x and y from the top left in 0..1. */
export function materialCell(atlas: MaterialAtlas, family: string, variant = 0): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const f = atlas.families.indexOf(family);
  if (f < 0) throw new Error(`The material atlas has no ${family}.`);
  const cells = atlas.columns * atlas.columns;
  const slot = ((Math.floor(variant) % cells) + cells) % cells;
  const rows = Math.ceil(atlas.families.length / atlas.blocks);
  const w = 1 / (atlas.blocks * atlas.columns), h = 1 / (rows * atlas.columns);
  return {
    x: ((f % atlas.blocks) * atlas.columns + (slot % atlas.columns)) * w,
    y: (Math.floor(f / atlas.blocks) * atlas.columns + Math.floor(slot / atlas.columns)) * h,
    w,
    h,
  };
}
