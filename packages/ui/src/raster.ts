// A small polygon rasteriser: outlines (flattened to polylines) to a coverage
// map, then to crisp pixels. Imported vector fonts, SVG icons and the icon
// grammar's shapes all come through here.
//
// Coverage is exact across each sub-scanline (the span's ends are fractional)
// and sampled `sub` times down each pixel; `crisp` thresholds it with
// dropout control -- a thin stem or bar whose pixels all fall under the
// threshold keeps its strongest pixel -- so small text reads as pixel art, not
// blur and not broken strokes.

/** A closed outline as a flat list [x0, y0, x1, y1, ...] in pixels, y down. */
export type Contour = number[];

export interface RasterOptions {
  /** "nonzero" (fonts, SVG's default) or "evenodd". */
  readonly rule?: "nonzero" | "evenodd";
  /** Sub-scanlines per pixel (default 5). */
  readonly sub?: number;
}

interface Edge { x0: number; y0: number; x1: number; y1: number; dir: number }

export function rasterize(contours: readonly Contour[], w: number, h: number, { rule = "nonzero", sub = 5 }: RasterOptions = {}): Float32Array {
  const cov = new Float32Array(w * h);
  const edges: Edge[] = [];
  for (const c of contours) {
    const n = c.length >> 1;
    for (let i = 0; i < n; i += 1) {
      const ax = c[i * 2]!, ay = c[i * 2 + 1]!;
      const j = (i + 1) % n;
      const bx = c[j * 2]!, by = c[j * 2 + 1]!;
      if (ay === by) continue;
      edges.push(ay < by ? { x0: ax, y0: ay, x1: bx, y1: by, dir: 1 } : { x0: bx, y0: by, x1: ax, y1: ay, dir: -1 });
    }
  }
  if (!edges.length) return cov;
  const xs: number[] = [];
  const ds: number[] = [];
  const order: number[] = [];
  const share = 1 / sub;
  for (let py = 0; py < h; py += 1) {
    for (let s = 0; s < sub; s += 1) {
      const y = py + (s + 0.5) * share;
      xs.length = 0; ds.length = 0;
      for (const e of edges) {
        if (y < e.y0 || y >= e.y1) continue;
        xs.push(e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0));
        ds.push(e.dir);
      }
      if (xs.length < 2) continue;
      order.length = 0;
      for (let i = 0; i < xs.length; i += 1) order.push(i);
      order.sort((a, b) => xs[a]! - xs[b]!);
      let wind = 0;
      for (let k = 0; k < order.length - 1; k += 1) {
        const i = order[k]!;
        wind = rule === "evenodd" ? wind ^ 1 : wind + ds[i]!;
        if (wind === 0) continue;
        span(cov, w, py, xs[i]!, xs[order[k + 1]!]!, share);
      }
    }
  }
  for (let i = 0; i < cov.length; i += 1) if (cov[i]! > 1) cov[i] = 1;
  return cov;
}

// (Add one sub-scanline's span [a, b) to a row: whole pixels get the share, the end pixels their fraction of it.)
function span(cov: Float32Array, w: number, py: number, a: number, b: number, share: number): void {
  if (b <= 0 || a >= w) return;
  a = Math.max(a, 0);
  b = Math.min(b, w);
  const ia = Math.floor(a), ib = Math.floor(b);
  const row = py * w;
  if (ia === ib) { cov[row + ia]! += (b - a) * share; return; }
  cov[row + ia]! += (ia + 1 - a) * share;
  for (let x = ia + 1; x < ib; x += 1) cov[row + x]! += share;
  if (ib < w) cov[row + ib]! += (b - ib) * share;
}

/**
 * Coverage to pixels (1 on, 0 off): on at `threshold`, and dropout control -- along every row and column, a
 * run of touched pixels (coverage over `touch`) with none on keeps its strongest pixel when that is at least
 * `keep`. A hairline stem survives; a smear of grey doesn't.
 */
export function crisp(cov: Float32Array, w: number, h: number, { threshold = 0.5, touch = 0.08, keep = 0.22 }: { threshold?: number; touch?: number; keep?: number } = {}): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < cov.length; i += 1) out[i] = cov[i]! >= threshold ? 1 : 0;
  const pass = (count: number, len: number, at: (line: number, k: number) => number) => {
    for (let l = 0; l < count; l += 1) {
      let k = 0;
      while (k < len) {
        if (cov[at(l, k)]! <= touch) { k += 1; continue; }
        let best = -1, bestCov = 0, any = false, run = 0;
        while (k < len && cov[at(l, k)]! > touch) {
          const i = at(l, k);
          if (out[i]) any = true;
          if (cov[i]! > bestCov) { bestCov = cov[i]!; best = i; }
          k += 1;
          run += 1;
        }
        // (Only a short run is a thin stroke crossing this line; a long one is the soft side of a stroke along it.)
        if (!any && run <= 2 && best >= 0 && bestCov >= keep) out[best] = 1;
      }
    }
  };
  pass(h, w, (y, x) => y * w + x);
  pass(w, h, (x, y) => y * w + x);
  return out;
}

/** Flatten a quadratic Bézier into `out` (the start point is already there). */
export function quadTo(out: number[], x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, tol = 0.2): void {
  const d = Math.abs(x0 - 2 * cx + x1) + Math.abs(y0 - 2 * cy + y1);
  const n = Math.max(1, Math.min(32, Math.ceil(Math.sqrt(d / tol))));
  for (let i = 1; i <= n; i += 1) {
    const t = i / n, u = 1 - t;
    out.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
  }
}
/** Flatten a cubic Bézier into `out` (the start point is already there). */
export function cubicTo(out: number[], x0: number, y0: number, c1x: number, c1y: number, c2x: number, c2y: number, x1: number, y1: number, tol = 0.2): void {
  const d = Math.abs(x0 - 2 * c1x + c2x) + Math.abs(y0 - 2 * c1y + c2y) + Math.abs(c1x - 2 * c2x + x1) + Math.abs(c1y - 2 * c2y + y1);
  const n = Math.max(1, Math.min(48, Math.ceil(Math.sqrt(d / tol))));
  for (let i = 1; i <= n; i += 1) {
    const t = i / n, u = 1 - t;
    out.push(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1);
  }
}
/** A circle (or ellipse) as a contour. */
export function ellipse(cx: number, cy: number, rx: number, ry = rx, segments = 0): Contour {
  const n = segments || Math.max(12, Math.ceil(Math.max(rx, ry) * 4));
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}
