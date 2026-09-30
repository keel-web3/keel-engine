// Making ground: hills from a seed, then the shaping built worlds are made of
// -- a road cut and filled to a gentle grade along its line, a junction or a
// plaza levelled flat, a building's pad levelled into the slope -- each blended
// into the land round it, so the surface stays one continuous piece. All in
// place on a HeightGrid, all deterministic (arithmetic, square roots, core's
// value noise), applied in order: what's shaped later wins where they overlap.

import { dcos, dsin, fbm2, smooth } from "@keel-engine/core";
import { cellX, cellZ, sample } from "./grid.ts";
import type { HeightGrid } from "./grid.ts";

/** A seed as the noise's integer. */
const seedInt = (seed: string | number): number => {
  if (typeof seed === "number") return seed | 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return h | 0;
};

export interface HillOptions {
  /** Metres from the lowest to the highest ground (or a function of place: flat old town, rolling suburbs). */
  readonly amplitude: number | ((x: number, z: number) => number);
  /** The hills' size: metres from one crest to the next, roughly (default 300). */
  readonly scale?: number;
  readonly octaves?: number;
}

/** Add rolling hills to a grid (centred on 0: as much below as above). */
export function addHills(g: HeightGrid, seed: string | number, o: HillOptions): HeightGrid {
  const s = seedInt(seed), k = 1 / (o.scale ?? 300), oct = o.octaves ?? 4;
  for (let j = 0; j < g.h; j += 1) {
    for (let i = 0; i < g.w; i += 1) {
      const x = cellX(g, i), z = cellZ(g, j), amp = typeof o.amplitude === "number" ? o.amplitude : o.amplitude(x, z);
      g.data[j * g.w + i]! += (fbm2(x * k, z * k, s, oct) - 0.5) * 2 * amp;
    }
  }
  return g;
}

/** How much a shape owns a cell `d` metres past its edge (1 inside, easing to 0 over `blend`). */
const own = (d: number, blend: number): number => (d <= 0 ? 1 : blend <= 0 ? 0 : 1 - smooth(0, blend, d));

export interface CorridorOptions {
  /** Half the flat width (m): the road and its pavements. */
  readonly half: number;
  /** Metres past that over which it blends into the land (the embankment). */
  readonly blend: number;
  /** The steepest grade along it (rise over run: 0.08 for a highway, 0.12 for a street). */
  readonly maxGrade: number;
  /** Metres of its line the land's own undulation is smoothed over (default 40). */
  readonly smoothing?: number;
  /** Heights the ends must meet (a junction already levelled), or undefined to leave an end free. */
  readonly ends?: readonly [number | undefined, number | undefined];
  /**
   * Metres at each end held level at that end's height (a junction's pad: the road arrives flat across it, so nothing
   * steps at the pad's edge). Needs `ends`.
   */
  readonly endFlat?: readonly [number, number];
  /** Cells already made flat by earlier shaping (1: leave alone): see `lockGrid`. This corridor's own flat width is added. */
  readonly lock?: Uint8Array;
}

/**
 * A lock for a grid: what's been levelled flat so far -- a road's width, a junction, a pad. Pass it to every shaping
 * call in turn and each one blends round what came before instead of cutting across it (a street's embankment never
 * digs into the arterial it meets), and adds its own flat part for the ones after.
 */
export const lockGrid = (g: HeightGrid): Uint8Array => new Uint8Array(g.w * g.h);

/**
 * The locked surface's height at a point: the bilinear sample over only the locked cells round it (a point at a flat
 * surface's edge reads that surface, not a blend of it and the unshaped land past it). Needs a locked cell round it.
 */
function lockedAt(g: HeightGrid, lock: Uint8Array, x: number, z: number): number {
  const u = Math.max(0, Math.min(g.w - 1, (x - g.x0) / g.cell)), v = Math.max(0, Math.min(g.h - 1, (z - g.z0) / g.cell));
  const i = Math.min(g.w - 2, Math.floor(u)), j = Math.min(g.h - 2, Math.floor(v)), fu = u - i, fv = v - j;
  let sum = 0, wt = 0;
  for (const [di, dj, w] of [[0, 0, (1 - fu) * (1 - fv)], [1, 0, fu * (1 - fv)], [0, 1, (1 - fu) * fv], [1, 1, fu * fv]] as const) {
    const k = (j + dj) * g.w + i + di;
    if (lock[k]) { sum += g.data[k]! * w; wt += w; }
  }
  return wt > 0 ? sum / wt : sample(g, x, z);
}

// One bounded scratch window, shared by synchronous corridor calls. The city
// grid itself can have millions of cells; only the corridor's bounding window
// is indexed here, and windows over this cap use the original Map path.
const MAX_CORRIDOR_CELLS = 1 << 18;
interface CorridorScratch {
  readonly seen: Uint32Array;
  readonly d: Float64Array;
  readonly y: Float64Array;
  readonly local: Int32Array;
  readonly global: Float64Array;
  epoch: number;
  busy: boolean;
}
let corridorScratch: CorridorScratch | null = null;
function borrowCorridorScratch(cells: number): CorridorScratch | null {
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > MAX_CORRIDOR_CELLS || corridorScratch?.busy) return null;
  if (!corridorScratch || corridorScratch.seen.length < cells) {
    const capacity = Math.min(MAX_CORRIDOR_CELLS, Math.max(cells, (corridorScratch?.seen.length ?? 512) * 2));
    corridorScratch = { seen: new Uint32Array(capacity), d: new Float64Array(capacity), y: new Float64Array(capacity),
      local: new Int32Array(capacity), global: new Float64Array(capacity), epoch: 0, busy: false };
  }
  const scratch = corridorScratch;
  scratch.busy = true;
  scratch.epoch = (scratch.epoch + 1) >>> 0;
  if (scratch.epoch === 0) { scratch.seen.fill(0); scratch.epoch = 1; }
  return scratch;
}

/**
 * Grade a corridor along a polyline (a road): its height follows the land, smoothed along the line and limited to
 * `maxGrade`, flat across its width, cut and filled into the land either side. Returns the line's graded profile
 * (metres along it and the height there), what a road renderer or a car's route reads.
 */
export function gradeCorridor(g: HeightGrid, xs: ArrayLike<number>, zs: ArrayLike<number>, o: CorridorOptions): { s: Float64Array; y: Float64Array } {
  // The line, resampled every cell: its length along, and the land's height under it.
  const px: number[] = [], pz: number[] = [], ps: number[] = [];
  let run = 0;
  for (let n = 0; n < xs.length; n += 1) {
    if (n > 0) {
      const dx = xs[n]! - xs[n - 1]!, dz = zs[n]! - zs[n - 1]!, l = Math.sqrt(dx * dx + dz * dz), steps = Math.max(1, Math.ceil(l / g.cell));
      for (let k = 1; k <= steps; k += 1) { px.push(xs[n - 1]! + (dx * k) / steps); pz.push(zs[n - 1]! + (dz * k) / steps); ps.push(run + (l * k) / steps); }
      run += l;
    } else { px.push(xs[0]!); pz.push(zs[0]!); ps.push(0); }
  }
  const m = px.length, y = new Float64Array(m), s = Float64Array.from(ps);
  for (let n = 0; n < m; n += 1) y[n] = sample(g, px[n]!, pz[n]!);
  // Where the line runs over ground already levelled (another road it merges with or crosses, a junction), it meets that
  // surface there: those points are held, like pinned ends, and the grade eases away from them.
  const held: number[] = [], heldY: number[] = [];
  if (o.lock) {
    for (let n = 0; n < m; n += 1) {
      const i = Math.round((px[n]! - g.x0) / g.cell), j = Math.round((pz[n]! - g.z0) / g.cell);
      if (i >= 0 && j >= 0 && i < g.w && j < g.h && o.lock[j * g.w + i]) { held.push(n); heldY.push(lockedAt(g, o.lock, px[n]!, pz[n]!)); }
    }
  }
  // Smoothed along the line (a running mean over `smoothing` metres, both ways)...
  const win = Math.max(1, Math.round((o.smoothing ?? 40) / g.cell / 2)), raw = Float64Array.from(y);
  for (let n = 0; n < m; n += 1) {
    let sum = 0, c = 0;
    for (let k = Math.max(0, n - win); k <= Math.min(m - 1, n + win); k += 1) { sum += raw[k]!; c += 1; }
    y[n] = sum / c;
  }
  // ...pinned at its ends if they're set, and held under the grade: a forward and a backward pass each cap the change
  // from the neighbour, which together make the smallest correction that meets the limit both ways.
  const [a, b] = o.ends ?? [undefined, undefined];
  if (a !== undefined) y[0] = a;
  if (b !== undefined) y[m - 1] = b;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let n = 1; n < m; n += 1) { const lim = o.maxGrade * (s[n]! - s[n - 1]!); y[n] = Math.max(y[n - 1]! - lim, Math.min(y[n - 1]! + lim, y[n]!)); }
    for (let n = m - 2; n >= 0; n -= 1) { const lim = o.maxGrade * (s[n + 1]! - s[n]!); y[n] = Math.max(y[n + 1]! - lim, Math.min(y[n + 1]! + lim, y[n]!)); }
  }
  // (The pinned ends as cones: within maxGrade of each pinned end, by distance along. Clamping a line already within the
  // grade into cones that are too keeps it within the grade -- and meets both ends exactly when they can be met.)
  // The fixed points along it -- each end over its flat, and every held point -- in order. Between each neighbouring
  // pair the line keeps its graded shape clamped into the cones the limit allows from both; where the two ask for more
  // than the grade can give (an old surface and a far junction too far apart in height), it runs straight between
  // them: a steeper ramp, never a step.
  const L = s[m - 1]!, [fa, fb] = o.endFlat ?? [0, 0], fixed: { s: number; y: number }[] = [];
  if (a !== undefined) fixed.push({ s: fa, y: a });
  for (let k = 0; k < held.length; k += 1) fixed.push({ s: s[held[k]!]!, y: heldY[k]! });
  if (b !== undefined) fixed.push({ s: L - fb, y: b });
  fixed.sort((p, q) => p.s - q.s);
  if (fixed.length) {
    let k = 0;
    for (let n = 0; n < m; n += 1) {
      const sn = s[n]!;
      while (k < fixed.length && fixed[k]!.s < sn) k += 1;
      const p = k > 0 ? fixed[k - 1]! : null, q = k < fixed.length ? fixed[k]! : null;
      if (a !== undefined && sn <= fa) { y[n] = a; continue; }
      if (b !== undefined && sn >= L - fb) { y[n] = b; continue; }
      let lo = -Infinity, hi = Infinity;
      if (p) { lo = Math.max(lo, p.y - o.maxGrade * (sn - p.s)); hi = Math.min(hi, p.y + o.maxGrade * (sn - p.s)); }
      if (q) { lo = Math.max(lo, q.y - o.maxGrade * (q.s - sn)); hi = Math.min(hi, q.y + o.maxGrade * (q.s - sn)); }
      if (lo <= hi) y[n] = Math.max(lo, Math.min(hi, y[n]!));
      else if (p && q) y[n] = p.y + ((q.y - p.y) * (sn - p.s)) / Math.max(1e-9, q.s - p.s);
    }
  }
  // Onto the grid: each cell near the line takes the height of its nearest point on it, as much as the corridor owns it.
  const reach = o.half + o.blend;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let n = 0; n < m; n += 1) {
    minX = Math.min(minX, px[n]!); maxX = Math.max(maxX, px[n]!);
    minZ = Math.min(minZ, pz[n]!); maxZ = Math.max(maxZ, pz[n]!);
  }
  const wi0 = Math.max(0, Math.floor((minX - reach - g.x0) / g.cell)), wi1 = Math.min(g.w - 1, Math.ceil((maxX + reach - g.x0) / g.cell));
  const wj0 = Math.max(0, Math.floor((minZ - reach - g.z0) / g.cell)), wj1 = Math.min(g.h - 1, Math.ceil((maxZ + reach - g.z0) / g.cell));
  const ww = wi1 - wi0 + 1, wh = wj1 - wj0 + 1;
  const scratch = Number.isFinite(reach) && reach >= 0 && ww > 0 && wh > 0 ? borrowCorridorScratch(ww * wh) : null;
  const best = scratch ? null : new Map<number, { d: number; y: number }>();
  let count = 0;
  try {
    for (let n = 1; n < m; n += 1) {
      const ax = px[n - 1]!, az = pz[n - 1]!, dx = px[n]! - ax, dz = pz[n]! - az, l2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, px[n]!) - reach - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.ceil((Math.max(ax, px[n]!) + reach - g.x0) / g.cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, pz[n]!) - reach - g.z0) / g.cell)), j1 = Math.min(g.h - 1, Math.ceil((Math.max(az, pz[n]!) + reach - g.z0) / g.cell));
      for (let j = j0; j <= j1; j += 1) {
        const row = (j - wj0) * ww;
        for (let i = i0; i <= i1; i += 1) {
          const cx = cellX(g, i), cz = cellZ(g, j), t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / l2));
          const ex = ax + dx * t - cx, ez = az + dz * t - cz, d = Math.sqrt(ex * ex + ez * ez);
          if (d > reach) continue;
          if (scratch) {
            const at = row + i - wi0, was = scratch.seen[at] === scratch.epoch;
            if (!was || d < scratch.d[at]!) {
              const height = y[n - 1]! + (y[n]! - y[n - 1]!) * t;
              if (!was) { scratch.seen[at] = scratch.epoch; scratch.local[count] = at; scratch.global[count] = j * g.w + i; count += 1; }
              scratch.d[at] = d; scratch.y[at] = height;
            }
          } else {
            const k = j * g.w + i, was = best!.get(k);
            if (!was || d < was.d) {
              const height = y[n - 1]! + (y[n]! - y[n - 1]!) * t;
              if (was) { was.d = d; was.y = height; }
              else best!.set(k, { d, y: height });
            }
          }
        }
      }
    }
    const lock = o.lock;
    if (scratch) {
      for (let p = 0; p < count; p += 1) {
        const k = scratch.global[p]!, at = scratch.local[p]!;
        if (lock && lock[k]) continue;
        const w = own(scratch.d[at]! - o.half, o.blend);
        g.data[k] = g.data[k]! + (scratch.y[at]! - g.data[k]!) * w;
      }
      if (lock) for (let p = 0; p < count; p += 1) if (scratch.d[scratch.local[p]!]! <= o.half) lock[scratch.global[p]!] = 1;
    } else {
      for (const [k, v] of best!) {
        if (lock && lock[k]) continue;
        const w = own(v.d - o.half, o.blend);
        g.data[k] = g.data[k]! + (v.y - g.data[k]!) * w;
      }
      if (lock) for (const [k, v] of best!) if (v.d <= o.half) lock[k] = 1;
    }
  } finally { if (scratch) scratch.busy = false; }
  return { s, y };
}

export interface LevelOptions {
  /** The level to set (default: the land's mean height over the shape). */
  readonly height?: number;
  /** Metres past the edge it blends into the land over. */
  readonly blend: number;
  /** Cells already made flat (see `lockGrid`): left alone; this shape's own flat part is added. */
  readonly lock?: Uint8Array;
}

/** Level a disc flat (a junction, a roundabout, a plaza). Returns the height it was levelled to. */
export function levelDisc(g: HeightGrid, x: number, z: number, r: number, o: LevelOptions): number {
  return level(g, x - r - o.blend, z - r - o.blend, x + r + o.blend, z + r + o.blend, (cx, cz) => Math.sqrt((cx - x) * (cx - x) + (cz - z) * (cz - z)) - r, o);
}

/** Level a rectangle (a building's pad, a car park): centre, width along its yaw and depth across it. */
export function levelRect(g: HeightGrid, x: number, z: number, width: number, depth: number, yaw: number, o: LevelOptions): number {
  const c = dcos(yaw), sn = dsin(yaw), hw = width / 2, hd = depth / 2, reach = Math.sqrt(hw * hw + hd * hd) + o.blend;
  return level(g, x - reach, z - reach, x + reach, z + reach, (cx, cz) => {
    const lx = (cx - x) * c - (cz - z) * sn, lz = (cx - x) * sn + (cz - z) * c;
    const qx = Math.abs(lx) - hw, qz = Math.abs(lz) - hd;
    const ox = Math.max(qx, 0), oz = Math.max(qz, 0);
    return Math.max(qx, qz) <= 0 ? Math.max(qx, qz) : Math.sqrt(ox * ox + oz * oz);
  }, o);
}

/** Level whatever `dist` (signed metres outside the shape) says is inside, over a world box. */
function level(g: HeightGrid, xa: number, za: number, xb: number, zb: number, dist: (x: number, z: number) => number, o: LevelOptions): number {
  const i0 = Math.max(0, Math.floor((xa - g.x0) / g.cell)), i1 = Math.min(g.w - 1, Math.ceil((xb - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((za - g.z0) / g.cell)), j1 = Math.min(g.h - 1, Math.ceil((zb - g.z0) / g.cell));
  let target = o.height;
  if (target === undefined) {
    let sum = 0, n = 0;
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) if (dist(cellX(g, i), cellZ(g, j)) <= 0) { sum += g.data[j * g.w + i]!; n += 1; }
    target = n ? sum / n : sample(g, (xa + xb) / 2, (za + zb) / 2);
  }
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const d = dist(cellX(g, i), cellZ(g, j)), w = own(d, o.blend), k = j * g.w + i;
      if (o.lock && o.lock[k]) continue;
      if (w > 0) g.data[k] = g.data[k]! + (target - g.data[k]!) * w;
      if (o.lock && d <= 0) o.lock[k] = 1;
    }
  }
  return target;
}
