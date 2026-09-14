// Icon families: every culture draws the same semantic icon in its own hand.
// The grammar (icons.ts) gives a name's shape as ops -- shapes added and cut
// in a unit square; a family redraws them:
//
//   industrial   a stencil: an angular plate, gear-notched and bolted, the symbol cut through it
//   organic      grown: the symbol swollen and rounded, its ends knobbed like bone
//   crystalline  faceted: every curve cut to straight facets, the symbol cracked, shards at the corners
//   arcane       a seal: a ring with rune marks, the symbol small inside it
//   brutal       heavy: the symbol in doubled pixels standing on a slab, a hard shadow under it
//   clean        thin: the symbol as a one-pixel line over a thin rule
//
// The symbol stays the symbol in every family (the same name reads the same
// within a race's set); what changes is the drawing, so two races' command
// cards look like two races, not a recolour.

import { crisp, ellipse, rasterize } from "./raster.ts";
import type { Contour } from "./raster.ts";

export const ICON_FAMILIES = ["plain", "industrial", "organic", "crystalline", "arcane", "brutal", "clean"] as const;
export type IconFamily = (typeof ICON_FAMILIES)[number];

/** One step of a recipe: add a shape's pixels, or cut them away (unit square, y down). */
export interface IconOp { readonly cut?: boolean; readonly shape: Contour[] }

type P = readonly [number, number];
const poly = (...pts: P[]): Contour => pts.flatMap(([x, y]) => [x, y]);
const rect = (x0: number, y0: number, x1: number, y1: number): Contour => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const disc = (cx: number, cy: number, r: number): Contour => ellipse(cx, cy, r, r, 40);
function seg(x0: number, y0: number, x1: number, y1: number, w: number): Contour {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
  return poly([x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]);
}
const mapOps = (ops: readonly IconOp[], f: (x: number, y: number) => P): IconOp[] =>
  ops.map((o) => ({ ...o, shape: o.shape.map((c) => { const out: number[] = []; for (let i = 0; i < c.length; i += 2) { const [x, y] = f(c[i]!, c[i + 1]!); out.push(x, y); } return out; }) }));
const scaled = (ops: readonly IconOp[], k: number, cx = 0.5, cy = 0.5): IconOp[] => mapOps(ops, (x, y) => [cx + (x - 0.5) * k, cy + (y - 0.5) * k]);

/** Rasterise ops into an n x n mask, in order (add sets, cut clears). */
export function rasterOps(ops: readonly IconOp[], n: number, threshold = 0.45): Uint8Array {
  const mask = new Uint8Array(n * n);
  for (const op of ops) {
    const cov = rasterize(op.shape.map((c) => c.map((v) => v * n)), n, n);
    const on = crisp(cov, n, n, { threshold });
    for (let i = 0; i < mask.length; i += 1) if (on[i]) mask[i] = op.cut ? 0 : 1;
  }
  return mask;
}

// Morphology on a mask.
function dilate(m: Uint8Array, n: number, r: number, square = false): Uint8Array {
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    let on = 0;
    for (let dy = -r; dy <= r && !on; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (!square && dx * dx + dy * dy > r * r + r * 0.6) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n && m[yy * n + xx]) { on = 1; break; }
    }
    out[y * n + x] = on;
  }
  return out;
}
function blurThreshold(m: Uint8Array, n: number, r: number, t: number): Uint8Array {
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const xx = x + dx, yy = y + dy;
      c += 1;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n) s += m[yy * n + xx]!;
    }
    out[y * n + x] = s / c >= t ? 1 : 0;
  }
  return out;
}
/** Down to an n x n mask from a k-times supersampled one (a pixel is on when at least `share` of its samples are). */
function downsample(m: Uint8Array, N: number, k: number, share = 0.5): Uint8Array {
  const n = N / k, out = new Uint8Array(n * n);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    let s = 0;
    for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) s += m[(y * k + dy) * N + x * k + dx]!;
    out[y * n + x] = s >= share * k * k ? 1 : 0;
  }
  return out;
}
/** A mask's line: its pixels that touch the outside (4-neighbours). */
function contourOf(m: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n * n);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < n && y < n ? m[y * n + x]! : 0);
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (at(x, y) && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1))) out[y * n + x] = 1;
  return out;
}
/** The farthest-apart pair of a mask's pixels (a stroke's two ends, near enough), as unit coordinates. */
function extremes(m: Uint8Array, n: number): [P, P] | null {
  const pts: P[] = [];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (m[y * n + x]) pts.push([x, y]);
  if (pts.length < 2) return null;
  // (Two sweeps from an arbitrary pixel: a good approximation of the diameter.)
  const far = (p: P): P => { let b = p, bd = -1; for (const q of pts) { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d > bd) { bd = d; b = q; } } return b; };
  const a = far(pts[0]!), b = far(a);
  return [[(a[0] + 0.5) / n, (a[1] + 0.5) / n], [(b[0] + 0.5) / n, (b[1] + 0.5) / n]];
}
/** More points along long sides (so a warp bends them): every edge split to pieces at most `step` long. */
function dense(ops: readonly IconOp[], step: number): IconOp[] {
  return ops.map((o) => ({ ...o, shape: o.shape.map((c) => {
    const n = c.length >> 1, out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const x0 = c[i * 2]!, y0 = c[i * 2 + 1]!, x1 = c[((i + 1) % n) * 2]!, y1 = c[((i + 1) % n) * 2 + 1]!;
      const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let j = 0; j < k; j += 1) out.push(x0 + ((x1 - x0) * j) / k, y0 + ((y1 - y0) * j) / k);
    }
    return out;
  }) }));
}
/** Cut round contours (many vertices: discs, rings, round caps) down to a few straight facets. */
function facet(ops: readonly IconOp[], sides: number): IconOp[] {
  return ops.map((o) => ({ ...o, shape: o.shape.map((c) => {
    const n = c.length >> 1;
    if (n < 12) return c;
    const out: number[] = [];
    for (let k = 0; k < sides; k += 1) { const i = Math.floor((k * n) / sides + n / (sides * 2)) % n; out.push(c[i * 2]!, c[i * 2 + 1]!); }
    return out;
  }) }));
}

/**
 * An icon's mask in a family, n x n. `base(k)` draws the grammar's ops for the name at stroke weight k (the recipe is
 * the same, only heavier or lighter).
 */
export function familyMask(family: IconFamily, base: (weight: number) => IconOp[], n: number, w: number): Uint8Array {
  // (Families need room to show: below 10 px an icon is drawn plain, whatever the culture.)
  if (family === "plain" || n < 10) return rasterOps(base(1), n);
  const px = 1 / n;
  // (Small: under 18 px a family keeps its hand but gives the symbol more of the square.)
  const small = n < 18;
  switch (family) {
    case "industrial": {
      // A stencil plate: chamfered (an octagon), notched at the middle of each side like a gear, bolted in the
      // corners; the symbol, a little smaller, cut clean through it.
      const c = 0.17, m = 0.01;
      const plate = poly([m + c, m], [1 - m - c, m], [1 - m, m + c], [1 - m, 1 - m - c], [1 - m - c, 1 - m], [m + c, 1 - m], [m, 1 - m - c], [m, m + c]);
      const notch = Math.max(px * 1.1, 0.06), deep = Math.max(px * 1.1, 0.06);
      const bolt = Math.max(px * 1.2, 0.07), bo = m + c * 0.42;
      // (Small, the notches and bolts would eat the symbol: a plain plate, the symbol cut bigger and bolder.)
      const sym = scaled(base(small ? 1.3 : 1.5), small ? 0.86 : 0.76);
      const ops: IconOp[] = [
        { shape: [plate] },
        ...(small ? [] : [{ cut: true, shape: [rect(0.5 - notch, 0, 0.5 + notch, m + deep), rect(0.5 - notch, 1 - m - deep, 0.5 + notch, 1), rect(0, 0.5 - notch, m + deep, 0.5 + notch), rect(1 - m - deep, 0.5 - notch, 1, 0.5 + notch)] }]),
        ...sym.map((o) => ({ ...o, cut: !o.cut })),
        ...(small ? [] : [{ cut: true, shape: [rect(bo, bo, bo + bolt, bo + bolt), rect(1 - bo - bolt, bo, 1 - bo, bo + bolt), rect(bo, 1 - bo - bolt, bo + bolt, 1 - bo), rect(1 - bo - bolt, 1 - bo - bolt, 1 - bo, 1 - bo)] }]),
      ];
      return rasterOps(ops, n);
    }
    case "organic": {
      // Grown, like bone: drawn 3x fine and melted round (a blur, thresholded) -- no corners left -- its stroke's two
      // ends swollen into knobs.
      const k = 3, N = n * k;
      // (A slight bow first -- everything bent the same gentle way, like a claw or a rib -- so straight strokes come
      // out curved, grown rather than cut; long sides carry more points so they bend too.)
      const swirl = mapOps(dense(scaled(base(0.8), 0.86), 0.04), (x, y) => [x + 0.06 * (1 - (2 * y - 1) ** 2) - 0.03, y - 0.03 * (1 - (2 * x - 1) ** 2)]);
      const fine = rasterOps(swirl, N);
      const ends = extremes(downsample(fine, N, k, 0.5), n);
      const blob = blurThreshold(fine, N, Math.max(2, Math.round(N * 0.06)), 0.45);
      if (ends) {
        const r = Math.max(1.5 * k, N * 0.11);
        for (const [ex, ey] of ends) {
          const cx = ex * N, cy = ey * N;
          for (let y = Math.floor(cy - r); y <= cy + r; y += 1) for (let x = Math.floor(cx - r); x <= cx + r; x += 1) if (x >= 0 && y >= 0 && x < N && y < N && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) blob[y * N + x] = 1;
        }
      }
      return downsample(blob, N, k, 0.45);
    }
    case "crystalline": {
      // Faceted: every curve cut to a hexagon's facets, the symbol cracked on a slant, a shard in each corner.
      const sym = facet(scaled(base(1), small ? 0.86 : 0.8), 6);
      const crack = Math.max(px * 0.9, 0.05);
      const s = 0.3;
      const ops: IconOp[] = [
        ...sym,
        ...(small ? [] : [{ cut: true, shape: [poly([0.18, 0.62 - crack], [0.82, 0.3 - crack], [0.82, 0.3 + crack], [0.18, 0.62 + crack])] }]),
        // (Shards in the corners -- only where there's room for them.)
        ...(small ? [] : [{ shape: [poly([0, 0], [s, 0.08], [0.08, s]), poly([1, 0], [1 - 0.08, s], [1 - s, 0.08]), poly([0, 1], [0.08, 1 - s], [s, 1 - 0.08]), poly([1, 1], [1 - s, 1 - 0.08], [1 - 0.08, 1 - s])] }]),
      ];
      return rasterOps(ops, n, small ? 0.4 : 0.5);
    }
    case "arcane": {
      // A seal: a ring with four rune marks standing out of it, the symbol small inside.
      const rw = px * (small ? 1.05 : 1.2), R = 0.47;
      const rune = small ? px * 0.9 : Math.max(px * 1.1, 0.06);
      const ops: IconOp[] = [
        { shape: [disc(0.5, 0.5, R)] },
        { cut: true, shape: [disc(0.5, 0.5, R - rw)] },
        // (Rune marks: short bars across the ring, pointing in, at the four diagonals.)
        ...[0, 1, 2, 3].map((i): IconOp => { const a = Math.PI / 4 + (i * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a); return { shape: [seg(0.5 + c * (R - rw - rune * 1.6), 0.5 + s * (R - rw - rune * 1.6), 0.5 + c * R, 0.5 + s * R, rune * 1.6)] }; }),
        ...scaled(base(1), small ? 0.68 : 0.6),
      ];
      return rasterOps(ops, n);
    }
    case "brutal": {
      // Heavy and blocky: the symbol drawn at half size and set in doubled pixels -- two-pixel strokes, square
      // steps -- standing on a slab, over a hard shadow cast down and right.
      // (Under 18 px there's no room for doubled pixels: the strokes are just drawn heavy.)
      const k = small ? 1 : 2, h = Math.floor(n / k), sh = 1;
      const sym = rasterOps(scaled(base(small ? 1.35 : 0.8), small ? 0.8 : 0.76, 0.47, small ? 0.43 : 0.42), h, 0.5);
      // (On a slab: a heavy bar across the bottom, a row clear of the symbol.)
      const slab = small ? 2 : 1;
      for (let y = h - 1 - slab - 1; y < h; y += 1) for (let x = 0; x < h; x += 1) sym[y * h + x] = y >= h - 1 - slab && y < h - 1 && x < h - 1 ? 1 : 0;
      const out = new Uint8Array(n * n);
      for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
        const at = (xx: number, yy: number) => { const sx = Math.floor(xx / k), sy = Math.floor(yy / k); return xx >= 0 && yy >= 0 && sx < h && sy < h && sym[sy * h + sx] === 1; };
        if (at(x, y) || at(x - sh, y - sh)) out[y * n + x] = 1;
      }
      return out;
    }
    case "clean": {
      // Thin: the symbol drawn light, then only its line kept -- one pixel, geometric -- over a thin rule.
      const line = contourOf(rasterOps(scaled(base(0.8), 0.84, 0.5, 0.45), n), n);
      for (let x = Math.round(n * 0.12); x < n - Math.round(n * 0.12); x += 1) line[(n - 1) * n + x] = 1;
      return line;
    }
  }
}
