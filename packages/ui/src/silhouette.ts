// Console silhouettes: the shapes a culture raises along the top edge of the
// classic console -- organic lobes and scallops, industrial stepped and bolted
// plates, crystalline facets and spikes, arcane arches, brutal toothed slabs,
// clean thin rails. A trim is a panel node with `trim: "<kind> <rise>"`: the
// node's rectangle is the same for every culture (so is every hit area); what
// it paints inside is the culture's outline against the world. The mask is
// made once per kind and size, shaded like a frame (outline, lit and shaded
// band, the panel's own fill in layer coordinates, the kind's details: bolts,
// facet lines, an arch's inner line), and drawn behind the console, whose top
// edge hides its foot.
//
//   { type: "panel", id: "trim.0", anchor: "bl", x: 0, y: 86, w: 87, h: 22, trim: "lobe 18" }

import type { Bitmap, Clip } from "./bitmap.ts";
import type { FrameColours } from "./frames.ts";
import { screenTile } from "./frames.ts";

export const TRIM_KINDS = ["lobe", "scallop", "plate", "facet", "spikes", "arch", "teeth", "rail"] as const;
export type TrimKind = (typeof TRIM_KINDS)[number];

// Roles in a trim's map.
const NONE = 0, OUTLINE = 1, LIGHT = 2, DARK = 3, FILL = 4, DETAIL_LIGHT = 5, DETAIL_DARK = 6, BOLT_LIGHT = 7, BOLT_MID = 8, BOLT_DARK = 9;

const cache = new Map<string, Uint8Array>();

/**
 * A trim's role map (w x h): its shape, band, fill and details. `spec` is "<kind> <rise> [foot]": the shape stands on a
 * line `foot` px above the node's bottom (default: h - rise) and rises at most `rise` px over it; the foot is solid.
 */
export function trimRoles(spec: string, w: number, h: number): Uint8Array {
  const key = `${spec}/${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [kindRaw, riseRaw, footRaw] = spec.trim().split(/\s+/);
  const kind = (TRIM_KINDS as readonly string[]).includes(kindRaw ?? "") ? (kindRaw as TrimKind) : "plate";
  const r0 = Math.round(Number(riseRaw ?? h)) || h;
  const foot = footRaw === undefined ? Math.max(0, h - r0) : Math.max(0, Math.min(h - 2, Math.round(Number(footRaw)) || 0));
  const rise = Math.max(2, Math.min(h - foot, r0));
  const mask = new Uint8Array(w * h);
  const detail = new Uint8Array(w * h);
  // (Heights count up from the foot: the rows at the bottom, behind the console.)
  const up = (x: number, v: number) => { for (let y = Math.max(0, h - foot - Math.round(v)); y < h; y += 1) mask[y * w + x] = 1; };
  const u = (x: number) => (w <= 1 ? 0.5 : x / (w - 1));
  switch (kind) {
    case "lobe": {
      // Organic: lumps of different sizes, run together -- a swelling, never a rectangle.
      const bumps = [[0.46, 0.44, 1], [0.84, 0.18, 0.62], [0.13, 0.15, 0.5]] as const;
      for (let x = 0; x < w; x += 1) {
        let v = 0;
        for (const [c, hw, r] of bumps) { const d = (u(x) - c) / hw; if (Math.abs(d) < 1) v = Math.max(v, rise * r * Math.sqrt(1 - d * d)); }
        up(x, v);
      }
      break;
    }
    case "scallop": {
      // Organic: a row of round bites along the edge.
      const R = Math.max(3, rise * 1.1), period = Math.max(6, Math.round(R * 2));
      for (let x = 0; x < w; x += 1) { const d = ((x % period) + 0.5 - period / 2) / (period / 2); up(x, rise * Math.sqrt(Math.max(0, 1 - d * d))); }
      break;
    }
    case "plate": {
      // Industrial: a plate with stepped chamfers at both ends, bolted along its top.
      const s = Math.max(2, Math.round(rise / 3));
      for (let x = 0; x < w; x += 1) { const d = Math.min(x, w - 1 - x); up(x, d < s ? rise / 3 : d < 2 * s ? (2 * rise) / 3 : rise); }
      const by = h - foot - rise + Math.max(2, Math.round(rise / 4));
      for (let x = 2 * s + 3; x < w - 2 * s - 4; x += Math.max(8, rise + 2)) bolt(detail, w, h, x, by);
      bolt(detail, w, h, Math.max(1, Math.round(s / 2)), h - foot - Math.round(rise / 3) + 1);
      bolt(detail, w, h, w - 2 - Math.max(1, Math.round(s / 2)), h - foot - Math.round(rise / 3) + 1);
      break;
    }
    case "facet": {
      // Crystalline: a cut crest -- straight facets rising to a point, with the cuts between them drawn in.
      const pts = [[0, 0.18], [0.16, 0.5], [0.3, 0.62], [0.47, 1], [0.6, 0.78], [0.78, 0.66], [0.9, 0.34], [1, 0.12]] as const;
      const at = (t: number): number => { for (let i = 1; i < pts.length; i += 1) { const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!; if (t <= x1) return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0); } return pts[pts.length - 1]![1]; };
      for (let x = 0; x < w; x += 1) up(x, rise * at(u(x)));
      for (const [px, py] of pts.slice(1, -1)) {
        const x0 = Math.round(px * (w - 1)), y0 = h - foot - Math.round(rise * py) + 1;
        for (let y = y0; y < h - foot; y += 1) if (x0 >= 0 && x0 < w) detail[y * w + x0] = px <= 0.47 ? DETAIL_LIGHT : DETAIL_DARK;
      }
      break;
    }
    case "spikes": {
      // Crystalline: shards standing up off a low base.
      const period = Math.max(6, Math.round(rise * 0.9));
      for (let x = 0; x < w; x += 1) { const d = Math.abs((x % period) + 0.5 - period / 2) / (period / 2); up(x, Math.max(rise * 0.22, rise * (1 - d))); }
      break;
    }
    case "arch": {
      // Arcane: a pointed arch across the span, an inner arch line inside it, a keystone at its crown.
      const prof = (t: number) => { const a = Math.abs(2 * t - 1); return Math.max(0, Math.sqrt(Math.max(0, 1 - a * a)) * 0.62 + (1 - a) * 0.38); };
      for (let x = 0; x < w; x += 1) up(x, rise * prof(u(x)));
      const inset = Math.max(3, Math.round(rise / 4));
      for (let x = inset; x < w - inset; x += 1) {
        const t = (x - inset) / Math.max(1, w - 1 - 2 * inset);
        const y = h - foot - Math.round((rise - inset) * prof(t));
        if (y >= 0 && y < h - foot) detail[y * w + x] = DETAIL_DARK;
      }
      const cx = Math.round((w - 1) / 2), ky = h - foot - rise + 2;
      for (let k = -1; k <= 1; k += 1) if (ky >= 0) detail[ky * w + cx + k] = DETAIL_LIGHT;
      break;
    }
    case "teeth": {
      // Brutal: a heavy slab, crenellated -- square teeth along its whole top.
      const t = Math.max(3, Math.round(rise * 0.5));
      for (let x = 0; x < w; x += 1) { const d = Math.min(x, w - 1 - x); up(x, d < 2 ? rise * 0.5 : Math.floor(x / t) % 2 === 0 ? rise : rise * 0.5); }
      break;
    }
    case "rail": {
      // Clean: a thin flat line held a little over the console on thin posts.
      const y0 = h - foot - rise;
      for (let x = 0; x < w; x += 1) for (let y = y0; y < y0 + 2; y += 1) mask[y * w + x] = 1;
      const posts = Math.max(2, Math.round(w / 60));
      for (let i = 0; i <= posts; i += 1) { const x = Math.min(w - 2, Math.round((i * (w - 2)) / posts)); for (let y = y0; y < h; y += 1) { mask[y * w + x] = 1; mask[y * w + x + 1] = 1; } }
      for (let x = 0; x < w; x += 1) for (let y = h - foot; y < h; y += 1) mask[y * w + x] = 1;
      break;
    }
  }
  // Shade: outline where it meets the world, a lit band on the faces turned up (and left), a shaded one on the others,
  // then the fill -- and the details over it.
  const roles = new Uint8Array(w * h);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (!mask[y * w + x]) continue;
    const i = y * w + x;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1)) { roles[i] = OUTLINE; continue; }
    const lit = !inside(x, y - 2) || !inside(x - 2, y) || !inside(x - 1, y - 1);
    const shade = !inside(x + 2, y) || !inside(x + 1, y - 1);
    roles[i] = lit ? LIGHT : shade ? DARK : FILL;
  }
  for (let i = 0; i < roles.length; i += 1) if (detail[i] && roles[i] !== NONE && roles[i] !== OUTLINE) roles[i] = detail[i]!;
  cache.set(key, roles);
  return roles;
}

// A bolt: a 2x2 rivet (light, mid, mid, dark), in the detail map.
function bolt(d: Uint8Array, w: number, h: number, x: number, y: number): void {
  const put = (xx: number, yy: number, r: number) => { if (xx >= 0 && yy >= 0 && xx < w && yy < h) d[yy * w + xx] = r; };
  put(x, y, BOLT_LIGHT); put(x + 1, y, BOLT_MID); put(x, y + 1, BOLT_MID); put(x + 1, y + 1, BOLT_DARK);
}

/** Paint a trim into the layer at (x, y, w, h) with a panel's colours (its fill textured in layer coordinates, like the panel's). */
export function drawTrim(dst: Bitmap, x: number, y: number, w: number, h: number, spec: string, c: FrameColours, clip: Clip, mesh = false): void {
  if (w <= 0 || h <= 0) return;
  const roles = trimRoles(spec, w, h);
  const x0 = Math.max(x, clip.x0, 0), y0 = Math.max(y, clip.y0, 0), x1 = Math.min(x + w, clip.x1, dst.w), y1 = Math.min(y + h, clip.y1, dst.h);
  const tile = c.fillKind === "dither" || c.fillKind === "gradient" ? screenTile(c.screen) : null;
  const table = [0, c.outline, c.bevelLight === c.fill ? c.borderLight : c.bevelLight, c.bevelDark, c.fill, c.borderLight, c.inner, c.rivet[0], c.rivet[1], c.rivet[2]];
  for (let py = y0; py < y1; py += 1) for (let px = x0; px < x1; px += 1) {
    const r = roles[(py - y) * w + (px - x)]!;
    if (r === NONE) continue;
    const o = py * dst.w + px;
    if (r !== FILL) { dst.px[o] = table[r]!; continue; }
    if (mesh && ((px + py) & 1)) continue;
    if (c.fillKind === "scan") dst.px[o] = (py & 1) ? c.fillAlt : c.fill;
    else if (tile) dst.px[o] = tile[(py & 63) * 64 + (px & 63)]! < (c.fillKind === "gradient" ? 0.2 : c.level) ? c.fillAlt : c.fill;
    else dst.px[o] = c.fill;
  }
}

// --- The console's own top edge, carved. ------------------------------------------------------------------------

export const EDGE_KINDS = ["bites", "steps", "vees", "arcs", "crenel", "flat"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

const edges = new Map<string, Uint8Array>();

/**
 * How deep a panel's top edge is cut at each column (0: not at all): "<kind> <depth>" -- round bites (organic), stepped
 * corners and vent slots (industrial), V notches and cut corners (crystalline), shallow arcs (arcane), square
 * crenels (brutal), or flat (clean).
 */
export function edgeProfile(spec: string, w: number): Uint8Array {
  const key = `${spec}/${w}`;
  const hit = edges.get(key);
  if (hit) return hit;
  const [kindRaw, depthRaw] = spec.trim().split(/\s+/);
  const kind = (EDGE_KINDS as readonly string[]).includes(kindRaw ?? "") ? (kindRaw as EdgeKind) : "flat";
  const D = Math.max(1, Math.round(Number(depthRaw ?? 4)) || 4);
  const d = new Uint8Array(w);
  const put = (x: number, v: number) => { if (x >= 0 && x < w) d[x] = Math.max(d[x]!, Math.max(0, Math.min(D, Math.round(v)))); };
  switch (kind) {
    case "bites": {
      const P = Math.max(8, D * 5);
      for (let x = 0; x < w; x += 1) { const t = ((x % P) + 0.5 - P / 2) / (P * 0.38); if (Math.abs(t) < 1) put(x, D * Math.sqrt(1 - t * t)); }
      break;
    }
    case "steps": {
      const s = Math.max(3, D * 2);
      for (let x = 0; x < w; x += 1) { const e = Math.min(x, w - 1 - x); put(x, e < s ? D : e < 2 * s ? D / 2 : 0); }
      const P = Math.max(16, D * 8);
      for (let x0 = 3 * s; x0 + s < w - 3 * s; x0 += P) for (let x = x0; x < x0 + s; x += 1) put(x, D / 2);
      break;
    }
    case "vees": {
      const c = D * 3;
      for (let x = 0; x < w; x += 1) { const e = Math.min(x, w - 1 - x); if (e < c) put(x, D * (1 - e / c) + 0.5); }
      const P = Math.max(10, D * 6);
      for (let x = 0; x < w; x += 1) { const t = Math.abs((x % P) + 0.5 - P / 2) / (D * 1.2); if (t < 1) put(x, D * (1 - t)); }
      break;
    }
    case "arcs": {
      const P = Math.max(24, D * 14);
      for (let x = 0; x < w; x += 1) { const t = ((x % P) + 0.5) / P; put(x, D * (1 - Math.sin(Math.PI * t)) * 0.9); }
      break;
    }
    case "crenel": {
      const t = Math.max(3, D * 2);
      for (let x = 0; x < w; x += 1) put(x, Math.floor(x / t) % 2 === 1 ? D : 0);
      break;
    }
    case "flat": break;
  }
  edges.set(key, d);
  return d;
}

/**
 * Carve a panel's top edge: what was under its top rows (a trim, the world) comes back where the profile cuts, and the
 * cut is outlined and lit. Call with the layer's pixels from before the panel was drawn (`under`: its top `depth` rows).
 */
export function carveTop(dst: Bitmap, x: number, y: number, w: number, spec: string, under: Uint32Array, c: FrameColours, clip: Clip): void {
  const d = edgeProfile(spec, w);
  let D = 0;
  for (const v of d) D = Math.max(D, v);
  if (!D) return;
  const x0 = Math.max(x, clip.x0, 0), x1 = Math.min(x + w, clip.x1, dst.w);
  const cut = (cx: number, r: number) => cx >= 0 && cx < w && r < d[cx]!;
  for (let r = 0; r <= D + 1; r += 1) {
    const py = y + r;
    if (py < clip.y0 || py >= clip.y1 || py < 0 || py >= dst.h) continue;
    for (let px = x0; px < x1; px += 1) {
      const cx = px - x, o = py * dst.w + px;
      if (cut(cx, r)) { dst.px[o] = under[r * w + cx]!; continue; }
      if (!d[cx] && !cut(cx - 1, r) && !cut(cx + 1, r)) continue;
      // (On the cut: its outline; just inside it, the lit band.)
      if (cut(cx, r - 1) || cut(cx - 1, r) || cut(cx + 1, r)) dst.px[o] = c.outline;
      else if (cut(cx, r - 2) || cut(cx - 1, r - 1) || cut(cx + 1, r - 1)) dst.px[o] = c.bevelLight === c.fill ? c.borderLight : c.bevelLight;
    }
  }
}

/** The deepest a spec cuts. */
export const edgeDepth = (spec: string): number => Math.max(0, Math.round(Number(spec.trim().split(/\s+/)[1] ?? 0)) || 0);
