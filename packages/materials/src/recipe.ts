// Recombines a material exemplar into a new atlas from a seed, then finishes
// it as pixel art. Every recipe step moves whole pieces of the exemplar's
// layers (plates, cells, the halves of two cells joined along a dark seam),
// recolours them inside a palette, or repaints one layer of a cell from a
// procedural painter; the layers then composite by their blends, and the
// finish snaps the result to the family's palette through an ordered dither.

import { paintMaterialField } from "./atlas.ts";
import type { MaterialAtlas } from "./atlas.ts";
import { checkExemplar, samplesPerSide } from "./exemplar.ts";
import type { Composite, DitherScreen, ExemplarFamily, ExemplarLayer, Finish, MaterialExemplar, MaterialLayer } from "./exemplar.ts";
import { luminance } from "./raster.ts";

export interface ExemplarAtlasOptions {
  readonly exemplar: MaterialExemplar;
  /** The atlas width in texels (its height follows the block rows). Default: 512. */
  readonly size?: number;
  readonly seed?: number;
  /** How far the atlas moves from the exemplar, 0..1: it scales every step's share. 0 keeps the exemplar's own arrangement. */
  readonly variance?: number;
  /** Skip the pixel-art finish (to read the composite itself). */
  readonly unfinished?: boolean;
}

function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const nameSeed = (name: string): number => [...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193), 0x811c9dc5);
const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

// A layer while a recipe works on it, at art resolution: palette indices, or
// a scalar layer's values read up to one per art pixel.
interface Plane {
  readonly layer: ExemplarLayer;
  readonly source: Uint8Array;
  readonly out: Uint8Array;
}

class Work {
  readonly n: number;
  readonly columns: number;
  readonly side: number;
  readonly planes: Map<string, Plane>;
  /** The exemplar cell each generated cell came from. */
  readonly from: Int32Array;
  constructor(exemplar: MaterialExemplar, family: ExemplarFamily) {
    this.n = exemplar.pixels;
    this.columns = exemplar.columns;
    this.side = this.n * this.columns;
    this.planes = new Map(family.layers.map((layer) => {
      const source = layer.kind === "palette" ? layer.indices : upsample(layer.values, samplesPerSide(this.side, layer.scale), layer.scale, this.side);
      return [layer.name, { layer, source, out: source.slice() }];
    }));
    this.from = Int32Array.from({ length: this.columns * this.columns }, (_, i) => i);
  }
  /** The planes a move applies to: those named, else all. */
  moved(names: readonly string[] | undefined): Plane[] {
    return names === undefined ? [...this.planes.values()] : names.map((n) => this.planes.get(n)!);
  }
  /** A palette plane's light per index, for the planes that have one. */
  light(plane: Plane): Float32Array {
    if (plane.layer.kind !== "palette") return Float32Array.from({ length: 256 }, (_, i) => i);
    const p = plane.layer.palette;
    return Float32Array.from({ length: p.length / 4 }, (_, i) => luminance(p[i * 4]!, p[i * 4 + 1]!, p[i * 4 + 2]!));
  }
  /** The plane that shows the shapes: the base layer. */
  base(compose: readonly Composite[]): Plane {
    return this.planes.get(compose[0]!.layer)!;
  }
}

/** A scalar layer's samples, read bilinearly up to one value per art pixel. */
export function upsample(values: Uint8Array, samples: number, scale: number, side: number): Uint8Array {
  const out = new Uint8Array(side * side);
  for (let y = 0; y < side; y += 1) {
    const gy = (y + 0.5) / scale - 0.5, iy = Math.max(0, Math.min(samples - 2, Math.floor(gy))), fy = Math.max(0, Math.min(1, gy - iy));
    for (let x = 0; x < side; x += 1) {
      const gx = (x + 0.5) / scale - 0.5, ix = Math.max(0, Math.min(samples - 2, Math.floor(gx))), fx = Math.max(0, Math.min(1, gx - ix));
      const at = (i: number, j: number): number => values[j * samples + i]!;
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx, bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
      out[y * side + x] = Math.round(top + (bottom - top) * fy);
    }
  }
  return out;
}

function copyCell(work: Work, planes: readonly Plane[], to: number, from: number): void {
  const { n, side, columns } = work;
  const tx = (to % columns) * n, ty = Math.floor(to / columns) * n, fx = (from % columns) * n, fy = Math.floor(from / columns) * n;
  for (const plane of planes) for (let y = 0; y < n; y += 1) plane.out.set(plane.source.subarray((fy + y) * side + fx, (fy + y) * side + fx + n), (ty + y) * side + tx);
  work.from[to] = from;
}

// The plates of each column of cells: runs of rows between gap rows, the rows
// whose middle is much darker than the column's usual light.
function plates(work: Work, base: Plane): { readonly x: number; readonly y: number; readonly length: number }[] {
  const { n, side, columns } = work;
  const light = work.light(base);
  const found: { x: number; y: number; length: number }[] = [];
  for (let c = 0; c < columns; c += 1) {
    const x0 = c * n, inner = Math.max(1, Math.floor(n / 8));
    const rows = Array.from({ length: side }, (_, y) => {
      let s = 0;
      for (let x = x0 + inner; x < x0 + n - inner; x += 1) s += light[base.source[y * side + x]!]!;
      return s / (n - 2 * inner);
    });
    const median = [...rows].sort((a, b) => a - b)[side >> 1]!;
    const cuts = [0];
    for (let y = 1; y < side; y += 1) {
      const gap = rows[y]! < median * 0.6 && rows[y - 1]! >= median * 0.6;
      // A plate is at least half a cell long; darker rows nearer than that are its own shading.
      if (gap && y - cuts[cuts.length - 1]! >= n / 2 && side - y >= n / 2) cuts.push(y);
    }
    cuts.push(side);
    for (let i = 0; i + 1 < cuts.length; i += 1) found.push({ x: x0, y: cuts[i]!, length: cuts[i + 1]! - cuts[i]! });
  }
  return found;
}

function strips(work: Work, base: Plane, planes: readonly Plane[], rand: () => number, band: number): void {
  const { n, side, columns } = work;
  const pool = plates(work, base);
  for (let c = 0; c < columns; c += 1) {
    const tx = c * n;
    let y = 0, last = -1, first = true;
    while (y < side) {
      const near = pool.filter((p, i) => i !== last && Math.abs(p.y - y) <= band * n + n / 2);
      const index = pool.indexOf(near.length > 0 ? pick(rand, near) : pick(rand, pool));
      const plate = pool[index]!;
      // Start partway into a plate, so the breaks stagger anew in every column.
      const skip = first ? Math.floor(rand() * plate.length * 0.7) : 0;
      first = false;
      for (let r = skip; r < plate.length && y < side; r += 1, y += 1) {
        for (const plane of planes) plane.out.set(plane.source.subarray((plate.y + r) * side + plate.x, (plate.y + r) * side + plate.x + n), y * side + tx);
      }
      last = index;
    }
  }
}

function cells(work: Work, planes: readonly Plane[], rand: () => number, band: number | undefined): void {
  const { columns } = work;
  for (let to = 0; to < columns * columns; to += 1) {
    const row = Math.floor(to / columns);
    const near = Array.from({ length: columns * columns }, (_, i) => i).filter((i) => band === undefined || Math.abs(Math.floor(i / columns) - row) <= band);
    copyCell(work, planes, to, pick(rand, near));
  }
}

// Joins a cell to a second one from its own rows along the vertical seam that
// runs through the darkest, best-matched pixels of the base layer.
function quilt(work: Work, base: Plane, planes: readonly Plane[], rand: () => number, share: number): void {
  const { n, side, columns } = work;
  const light = work.light(base);
  for (let to = 0; to < columns * columns; to += 1) {
    if (rand() >= share) continue;
    const row = Math.floor(work.from[to]! / columns);
    const other = pick(rand, Array.from({ length: columns * columns }, (_, i) => i).filter((i) => Math.abs(Math.floor(i / columns) - row) <= 1 && i !== work.from[to]));
    const tx = (to % columns) * n, ty = Math.floor(to / columns) * n, ox = (other % columns) * n, oy = Math.floor(other / columns) * n;
    const lo = Math.max(1, Math.floor(n / 5)), hi = n - 1 - lo, span = hi - lo + 1;
    const cost = (x: number, y: number): number => {
      const a = light[base.out[(ty + y) * side + tx + x]!]!, b = light[base.source[(oy + y) * side + ox + x]!]!;
      return a + b + 2 * Math.abs(a - b);
    };
    const total = new Float64Array(n * span), step = new Int8Array(n * span);
    for (let x = 0; x < span; x += 1) total[x] = cost(lo + x, 0);
    for (let y = 1; y < n; y += 1) {
      for (let x = 0; x < span; x += 1) {
        let best = Infinity, move = 0;
        for (let d = -1; d <= 1; d += 1) {
          const px = x + d;
          if (px < 0 || px >= span) continue;
          if (total[(y - 1) * span + px]! < best) { best = total[(y - 1) * span + px]!; move = d; }
        }
        total[y * span + x] = best + cost(lo + x, y);
        step[y * span + x] = move;
      }
    }
    let x = 0;
    for (let i = 1; i < span; i += 1) if (total[(n - 1) * span + i]! < total[(n - 1) * span + x]!) x = i;
    for (let y = n - 1; y >= 0; y -= 1) {
      const seam = lo + x;
      for (const plane of planes) plane.out.set(plane.source.subarray((oy + y) * side + ox + seam, (oy + y) * side + ox + n), (ty + y) * side + tx + seam);
      x += step[y * span + x]!;
    }
  }
}

// A palette layer's two hues, found from its cells (each cell's mean chroma
// less its row's, so banding down a block isn't read as a hue): each colour
// belongs to the side that uses it most, and a leaning cell trades each colour
// for the other side's of nearest light.
function lean(work: Work, plane: Plane, rand: () => number, share: number): void {
  if (plane.layer.kind !== "palette") return;
  const { n, side, columns } = work;
  const p = plane.layer.palette, light = work.light(plane), colours = light.length, cellCount = columns * columns;
  const raw = Array.from({ length: cellCount }, (_, c) => {
    let a = 0, b = 0;
    const cx = (c % columns) * n, cy = Math.floor(c / columns) * n;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
      const i = plane.source[(cy + y) * side + cx + x]! * 4;
      a += p[i]! - p[i + 1]!; b += p[i + 1]! - p[i + 2]!;
    }
    return [a / (n * n), b / (n * n)] as const;
  });
  const chroma = raw.map((c, i) => {
    const row = raw.filter((_, j) => Math.floor(j / columns) === Math.floor(i / columns));
    return [c[0] - row.reduce((t, r) => t + r[0], 0) / row.length, c[1] - row.reduce((t, r) => t + r[1], 0) / row.length] as const;
  });
  let centres = [chroma.reduce((m, c) => (c[1] < m[1] ? c : m)), chroma.reduce((m, c) => (c[1] > m[1] ? c : m))];
  const sideOf = new Uint8Array(cellCount);
  for (let round = 0; round < 8; round += 1) {
    chroma.forEach((c, i) => { sideOf[i] = Math.hypot(c[0] - centres[1]![0], c[1] - centres[1]![1]) < Math.hypot(c[0] - centres[0]![0], c[1] - centres[0]![1]) ? 1 : 0; });
    centres = [0, 1].map((s) => {
      const members = chroma.filter((_, i) => sideOf[i] === s);
      return members.length === 0 ? centres[s]! : ([members.reduce((t, m) => t + m[0], 0) / members.length, members.reduce((t, m) => t + m[1], 0) / members.length] as const);
    });
  }
  // Two hues only when the sides sit well apart; one hue has nothing to lean to.
  if (Math.hypot(centres[0]![0] - centres[1]![0], centres[0]![1] - centres[1]![1]) < 12) return;
  const use = Array.from({ length: colours }, () => [0, 0]);
  for (let c = 0; c < cellCount; c += 1) {
    const cx = (c % columns) * n, cy = Math.floor(c / columns) * n;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) use[plane.source[(cy + y) * side + cx + x]!]![sideOf[c]!]! += 1;
  }
  const group = use.map(([a, b]) => (b! > a! ? 1 : 0));
  // A colour leans only to one its side really paints with (a stray rim colour
  // would show as a dash), of nearest light and saturation.
  const total = [0, 1].map((s) => use.reduce((t, u) => t + u[s]!, 0));
  const saturation = Float32Array.from({ length: colours }, (_, i) => Math.max(p[i * 4]!, p[i * 4 + 1]!, p[i * 4 + 2]!) - Math.min(p[i * 4]!, p[i * 4 + 1]!, p[i * 4 + 2]!));
  const swap = Array.from({ length: colours }, (_, i) => {
    let best = i, bestD = Infinity;
    for (let j = 0; j < colours; j += 1) {
      if (group[j] === group[i] || p[j * 4 + 3] !== p[i * 4 + 3] || use[j]![group[j]!]! < total[group[j]!]! * 0.004) continue;
      const d = Math.abs(light[j]! - light[i]!) + 0.5 * Math.abs(saturation[j]! - saturation[i]!);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  });
  for (let to = 0; to < cellCount; to += 1) {
    if (rand() >= share) continue;
    const tx = (to % columns) * n, ty = Math.floor(to / columns) * n;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) plane.out[(ty + y) * side + tx + x] = swap[plane.out[(ty + y) * side + tx + x]!]!;
  }
}

// Procedural cells in one layer. In a palette layer, the painter's field is
// read by rank through the layer's own share of each colour; in a scalar
// layer, it is fitted to the cell's own range (relighting it).
function paint(work: Work, plane: Plane, rand: () => number, painter: Extract<MaterialLayer, { layer: "paint" }>["painter"], share: number, variance: number): void {
  const { n, side, columns } = work;
  const field = paintMaterialField(painter, n, columns, rand, variance);
  const light = work.light(plane);
  const order = Array.from({ length: light.length }, (_, i) => i).sort((a, b) => light[a]! - light[b]!);
  const counts = new Float64Array(light.length);
  if (plane.layer.kind === "palette") for (const i of plane.source) counts[i]! += 1;
  const quantiles: number[] = [];
  let acc = 0;
  for (const i of order) { acc += counts[i]! / plane.source.length; quantiles.push(acc); }
  for (let to = 0; to < columns * columns; to += 1) {
    if (rand() >= share) continue;
    const tx = (to % columns) * n, ty = Math.floor(to / columns) * n;
    const pixels = Array.from({ length: n * n }, (_, p) => (ty + Math.floor(p / n)) * side + tx + (p % n));
    if (plane.layer.kind === "palette") {
      pixels.sort((a, b) => field[a]! - field[b]!);
      let k = 0;
      pixels.forEach((at, rank) => {
        while (k < order.length - 1 && (rank + 0.5) / pixels.length > quantiles[k]!) k += 1;
        plane.out[at] = order[k]!;
      });
    } else {
      let lo = 255, hi = 0, flo = Infinity, fhi = -Infinity;
      for (const at of pixels) { lo = Math.min(lo, plane.out[at]!); hi = Math.max(hi, plane.out[at]!); flo = Math.min(flo, field[at]!); fhi = Math.max(fhi, field[at]!); }
      for (const at of pixels) plane.out[at] = Math.round(lo + ((field[at]! - flo) / Math.max(1e-6, fhi - flo)) * (hi - lo));
    }
  }
}

// The layers composited, bottom first, as linear-ish RGBA floats 0..255.
function composite(work: Work, compose: readonly Composite[]): Float32Array {
  const count = work.side * work.side, out = new Float32Array(count * 4);
  for (const step of compose) {
    const plane = work.planes.get(step.layer)!, k = step.strength ?? 1;
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      let r: number, g: number, b: number, a: number;
      if (plane.layer.kind === "palette") {
        const c = plane.out[i]! * 4, p = plane.layer.palette;
        r = p[c]!; g = p[c + 1]!; b = p[c + 2]!; a = p[c + 3]! / 255;
      } else {
        r = g = b = plane.out[i]!; a = 1;
      }
      if (step.blend === "base") { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a * 255; continue; }
      const mix = (from: number, to: number): number => from + (to - from) * k * a;
      if (step.blend === "multiply") {
        // A scalar multiplies by value/128 (128 is x1, so light can brighten); a colour by colour/255.
        const unit = plane.layer.kind === "scalar" ? 128 : 255;
        out[o] = mix(out[o]!, (out[o]! * r) / unit); out[o + 1] = mix(out[o + 1]!, (out[o + 1]! * g) / unit); out[o + 2] = mix(out[o + 2]!, (out[o + 2]! * b) / unit);
      } else if (step.blend === "screen") {
        out[o] = mix(out[o]!, 255 - ((255 - out[o]!) * (255 - r)) / 255); out[o + 1] = mix(out[o + 1]!, 255 - ((255 - out[o + 1]!) * (255 - g)) / 255); out[o + 2] = mix(out[o + 2]!, 255 - ((255 - out[o + 2]!) * (255 - b)) / 255);
      } else if (step.blend === "add") {
        out[o] = mix(out[o]!, out[o]! + r); out[o + 1] = mix(out[o + 1]!, out[o + 1]! + g); out[o + 2] = mix(out[o + 2]!, out[o + 2]! + b);
      } else {
        out[o] = mix(out[o]!, r); out[o + 1] = mix(out[o + 1]!, g); out[o + 2] = mix(out[o + 2]!, b); out[o + 3] = Math.max(out[o + 3]!, a * k * 255);
      }
    }
  }
  return out;
}

// Ordered-dither threshold maps, 0..1, as keel/voxel-dither numbers them.
function bayer(size: number): Float32Array {
  let m = [0];
  for (let n = 1; n < size; n *= 2) {
    const next = new Array<number>(4 * n * n);
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
      const v = 4 * m[y * n + x]!;
      next[y * 2 * n + x] = v; next[y * 2 * n + x + n] = v + 2; next[(y + n) * 2 * n + x] = v + 3; next[(y + n) * 2 * n + x + n] = v + 1;
    }
    m = next;
  }
  return Float32Array.from(m, (v) => (v + 0.5) / (size * size));
}
const SCREEN_SIZE: Readonly<Record<DitherScreen, number>> = { none: 0, bayer2: 2, bayer4: 4, bayer8: 8 };

// Snaps every pixel to the finish palette: the nearest colour to the pixel
// pushed along by the screen's threshold (a spread of `amount` of the gap
// between neighbouring palette colours), so a tone between two colours
// becomes a fixed pattern of both, never a blend. Then a lone pixel, whose
// four neighbours all share another colour, takes theirs.
function finish(work: Work, rgba: Float32Array, f: Finish): Uint8Array {
  const { side } = work, count = side * side, colours = f.palette.length / 4, p = f.palette;
  let gap = 0;
  for (let i = 0; i < colours; i += 1) {
    let near = Infinity;
    for (let j = 0; j < colours; j += 1) if (j !== i) near = Math.min(near, Math.hypot(p[i * 4]! - p[j * 4]!, p[i * 4 + 1]! - p[j * 4 + 1]!, p[i * 4 + 2]! - p[j * 4 + 2]!));
    gap += near / colours;
  }
  const size = SCREEN_SIZE[f.dither], map = size > 0 ? bayer(size) : new Float32Array([0.5]);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = i % side, y = Math.floor(i / side);
    const push = size > 0 ? (map[(y % size) * size + (x % size)]! - 0.5) * gap * f.amount : 0;
    let best = 0, bestD = Infinity;
    for (let c = 0; c < colours; c += 1) {
      if ((p[c * 4 + 3]! >= 128) !== (rgba[i * 4 + 3]! >= 128)) continue;
      const d = (rgba[i * 4]! + push - p[c * 4]!) ** 2 + (rgba[i * 4 + 1]! + push - p[c * 4 + 1]!) ** 2 + (rgba[i * 4 + 2]! + push - p[c * 4 + 2]!) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    out[i] = best;
  }
  if (!f.clean) return out;
  const cleaned = out.slice();
  for (let y = 1; y < side - 1; y += 1) for (let x = 1; x < side - 1; x += 1) {
    const i = y * side + x, l = out[i - 1]!, r = out[i + 1]!, u = out[i - side]!, d = out[i + side]!;
    if (l === r && r === u && u === d && l !== out[i]) cleaned[i] = l;
  }
  return cleaned;
}

/** A new atlas from an exemplar: its recipes recombine every family's layers from the seed; the layers composite; the finish makes pixel art of them. */
export function recombineMaterialAtlas({ exemplar, size = 512, seed = 1, variance = 0.5, unfinished = false }: ExemplarAtlasOptions): MaterialAtlas {
  checkExemplar(exemplar);
  if (!Number.isInteger(size) || size < 16 || size > 4096) throw new RangeError("A material atlas is 16..4096 texels wide.");
  if (!(variance >= 0 && variance <= 1)) throw new RangeError("Variance is 0..1.");
  const { pixels, columns, blocks, families } = exemplar;
  const side = pixels * columns, rows = Math.ceil(families.length / blocks);
  const artW = blocks * side, artH = rows * side;
  const art = new Uint8Array(artW * artH * 4);
  const amount = (share: number): number => Math.min(1, share * variance * 2);
  families.forEach((family, f) => {
    const rand = random(Math.imul(seed >>> 0, 0x9e3779b1) ^ nameSeed(family.name));
    const work = new Work(exemplar, family);
    const base = work.base(family.compose);
    if (variance > 0) {
      for (const step of family.recipe) {
        if (step.layer === "strips") strips(work, base, work.moved(step.layers), rand, step.band ?? 1);
        else if (step.layer === "cells") cells(work, work.moved(step.layers), rand, step.band);
        else if (step.layer === "quilt") quilt(work, base, work.moved(step.layers), rand, amount(step.share));
        else if (step.layer === "lean") lean(work, step.target === undefined ? base : work.planes.get(step.target)!, rand, amount(step.share));
        else paint(work, step.target === undefined ? base : work.planes.get(step.target)!, rand, step.painter, amount(step.share), variance);
      }
    }
    const rgba = composite(work, family.compose);
    const bx = (f % blocks) * side, by = Math.floor(f / blocks) * side;
    const snapped = family.finish !== undefined && !unfinished ? finish(work, rgba, family.finish) : undefined;
    for (let i = 0; i < side * side; i += 1) {
      const o = ((by + Math.floor(i / side)) * artW + bx + (i % side)) * 4;
      if (snapped !== undefined) art.set(family.finish!.palette.subarray(snapped[i]! * 4, snapped[i]! * 4 + 4), o);
      else for (let k = 0; k < 4; k += 1) art[o + k] = Math.max(0, Math.min(255, Math.round(rgba[i * 4 + k]!)));
    }
  });
  const width = size, height = Math.round((size * artH) / artW);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const ay = Math.min(artH - 1, Math.floor((y * artH) / height));
    for (let x = 0; x < width; x += 1) {
      const ax = Math.min(artW - 1, Math.floor((x * artW) / width));
      rgba.set(art.subarray((ay * artW + ax) * 4, (ay * artW + ax) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { width, height, rgba, families: families.map((f) => f.name), columns, blocks, pixels, art: { width: artW, height: artH, rgba: art } };
}
