// Imported icons: a PNG (decoded to a bitmap) or an SVG (parsed here --
// path, rect, circle, ellipse, polygon, polyline, with their fills, a
// viewBox, and translate/scale transforms; arcs are drawn as chords) drawn
// at the icon size, then SNAPPED to the theme's palette so it sits in the UI
// like a generated one -- optionally with the theme's outline round it.
//
//   ui.registerIcon("logo", iconFromSvg(svgText, 16, { palette: themeColours(theme), outline: theme.palette.outline }));

import { createBitmap } from "../bitmap.ts";
import type { Bitmap } from "../bitmap.ts";
import { fromHex, nearest, rgba } from "../color.ts";
import type { Rgba } from "../color.ts";
import { crisp, cubicTo, ellipse, quadTo, rasterize } from "../raster.ts";
import type { Contour } from "../raster.ts";
import type { Theme } from "../theme.ts";

export interface IconImport {
  /** Colours to snap to (default: the colours as they are). */
  readonly palette?: readonly Rgba[];
  /** Draw this colour one pixel round the shape. */
  readonly outline?: Rgba;
  /** Coverage that counts as the shape (default 0.5). */
  readonly threshold?: number;
}

/** Every colour of a theme (its ramps), for snapping. */
export function themeColours(t: Theme): Rgba[] {
  const p = t.palette;
  return [...new Set([...p.surface, ...p.ink, ...p.accent, ...p.good, ...p.warn, ...p.bad, ...p.team.flat(), p.outline])];
}

function finish(b: Bitmap, o: IconImport): Bitmap {
  if (o.palette?.length) {
    const cache = new Map<Rgba, Rgba>();
    for (let i = 0; i < b.px.length; i += 1) {
      const c = b.px[i]!;
      if (!c) continue;
      let s = cache.get(c);
      if (s === undefined) { s = nearest(c | 0xff000000, o.palette); cache.set(c, s); }
      b.px[i] = s;
    }
  }
  if (o.outline === undefined) return b;
  const out = createBitmap(b.w + 2, b.h + 2);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.px[y * b.w + x]! : 0);
  for (let y = -1; y <= b.h; y += 1) for (let x = -1; x <= b.w; x += 1) {
    const c = at(x, y);
    out.px[(y + 1) * out.w + x + 1] = c || (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) ? o.outline : 0);
  }
  return out;
}

/** A picture (a decoded PNG) as an icon `size` px square: box-filtered down if bigger, alpha cut at half, snapped. */
export function iconFromImage(img: Bitmap, size: number, o: IconImport = {}): Bitmap {
  const out = createBitmap(size, size);
  const sx = img.w / size, sy = img.h / size;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) {
      const c = img.px[yy * img.w + xx]!;
      const al = c >>> 24;
      r += (c & 255) * al; g += ((c >>> 8) & 255) * al; b += ((c >>> 16) & 255) * al; a += al; n += 1;
    }
    if (a / n >= 128 * (o.threshold ?? 0.5) * 2) out.px[y * size + x] = rgba(Math.round(r / a), Math.round(g / a), Math.round(b / a));
  }
  return finish(out, o);
}

// --- SVG ---------------------------------------------------------------------

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** An SVG path's d attribute as contours (arcs as chords). */
export function svgPath(d: string): Contour[] {
  const out: Contour[] = [];
  let cur: number[] = [];
  let x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lastCmd = "";
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  const num = (): number => Number(toks[i++]);
  const close = () => { if (cur.length >= 6) out.push(cur); cur = []; };
  let cmd = "";
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) cmd = toks[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (C) {
      case "M": close(); x = ox + num(); y = oy + num(); sx = x; sy = y; cur.push(x, y); cmd = rel ? "l" : "L"; break;
      case "L": x = ox + num(); y = oy + num(); cur.push(x, y); break;
      case "H": x = ox + num(); cur.push(x, y); break;
      case "V": y = oy + num(); cur.push(x, y); break;
      case "C": { const a = ox + num(), b = oy + num(), c = ox + num(), e = oy + num(), fx = ox + num(), fy = oy + num(); cubicTo(cur, x, y, a, b, c, e, fx, fy); lcx = c; lcy = e; x = fx; y = fy; break; }
      case "S": { const a = /[CS]/i.test(lastCmd) ? 2 * x - lcx : x, b = /[CS]/i.test(lastCmd) ? 2 * y - lcy : y; const c = ox + num(), e = oy + num(), fx = ox + num(), fy = oy + num(); cubicTo(cur, x, y, a, b, c, e, fx, fy); lcx = c; lcy = e; x = fx; y = fy; break; }
      case "Q": { const a = ox + num(), b = oy + num(), fx = ox + num(), fy = oy + num(); quadTo(cur, x, y, a, b, fx, fy); lcx = a; lcy = b; x = fx; y = fy; break; }
      case "T": { const a = /[QT]/i.test(lastCmd) ? 2 * x - lcx : x, b = /[QT]/i.test(lastCmd) ? 2 * y - lcy : y; const fx = ox + num(), fy = oy + num(); quadTo(cur, x, y, a, b, fx, fy); lcx = a; lcy = b; x = fx; y = fy; break; }
      case "A": { num(); num(); num(); num(); num(); x = ox + num(); y = oy + num(); cur.push(x, y); break; }
      case "Z": x = sx; y = sy; close(); cur = []; cmd = ""; break;
      default: i += 1;
    }
    lastCmd = C;
    if (C === "Z" && i < toks.length && !/[a-zA-Z]/.test(toks[i]!)) cmd = "L";
  }
  close();
  return out;
}

interface Shape { contours: Contour[]; fill: Rgba | null; rule: "nonzero" | "evenodd" }

function attrs(tag: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g)) a[m[1] ?? m[3]!] = m[2] ?? m[4]!;
  const style = a.style;
  if (style) for (const part of style.split(";")) { const [k, v] = part.split(":").map((s) => s.trim()); if (k && v) a[k] = v; }
  return a;
}
const NAMED: Record<string, string> = { black: "#000", white: "#fff", red: "#f00", green: "#008000", blue: "#00f", yellow: "#ff0", orange: "#ffa500", gray: "#808080", grey: "#808080", purple: "#800080", cyan: "#0ff", magenta: "#f0f" };
function colourOf(v: string | undefined, inherited: Rgba | null): Rgba | null {
  if (v === undefined || v === "currentColor") return inherited;
  if (v === "none" || v === "transparent") return null;
  const s = NAMED[v] ?? v;
  if (s.startsWith("#")) return fromHex(s);
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) { const [r, g, b] = m[1]!.split(",").map((t) => Number.parseFloat(t)); return rgba(r ?? 0, g ?? 0, b ?? 0); }
  return inherited;
}
function transformOf(v: string | undefined): (c: Contour) => Contour {
  if (!v) return (c) => c;
  let m = [1, 0, 0, 1, 0, 0];
  for (const t of v.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const n = (t[2]!.match(NUM) ?? []).map(Number);
    let k = [1, 0, 0, 1, 0, 0];
    if (t[1] === "translate") k = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (t[1] === "scale") k = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (t[1] === "matrix" && n.length === 6) k = n;
    else if (t[1] === "rotate") { const a = ((n[0] ?? 0) * Math.PI) / 180; k = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]; }
    m = [m[0]! * k[0]! + m[2]! * k[1]!, m[1]! * k[0]! + m[3]! * k[1]!, m[0]! * k[2]! + m[2]! * k[3]!, m[1]! * k[2]! + m[3]! * k[3]!, m[0]! * k[4]! + m[2]! * k[5]! + m[4]!, m[1]! * k[4]! + m[3]! * k[5]! + m[5]!];
  }
  return (c) => { const o: number[] = []; for (let i = 0; i < c.length; i += 2) o.push(m[0]! * c[i]! + m[2]! * c[i + 1]! + m[4]!, m[1]! * c[i]! + m[3]! * c[i + 1]! + m[5]!); return o; };
}

/** Parse an SVG's shapes (document order, fills resolved, transforms applied), in its own units, and its viewBox. */
export function parseSvg(src: string): { shapes: Shape[]; view: [number, number, number, number] } {
  const svgTag = /<svg\b[^>]*>/i.exec(src)?.[0] ?? "";
  const sa = attrs(svgTag);
  const vb = (sa.viewBox ?? "").match(NUM)?.map(Number);
  const view: [number, number, number, number] = vb && vb.length === 4 ? [vb[0]!, vb[1]!, vb[2]!, vb[3]!] : [0, 0, Number.parseFloat(sa.width ?? "24") || 24, Number.parseFloat(sa.height ?? "24") || 24];
  const shapes: Shape[] = [];
  const stack: Array<{ fill: Rgba | null; tf: (c: Contour) => Contour }> = [{ fill: colourOf(sa.fill, rgba(0, 0, 0)), tf: (c) => c }];
  for (const m of src.matchAll(/<(\/?)(\w+)\b([^>]*?)(\/?)>/g)) {
    const [, closing, name, body, self] = m;
    const top = stack[stack.length - 1]!;
    if (closing) { if (name === "g" && stack.length > 1) stack.pop(); continue; }
    const a = attrs(body ?? "");
    const fill = colourOf(a.fill, top.fill);
    const own = transformOf(a.transform);
    const tf = (c: Contour) => top.tf(own(c));
    if (name === "g") { if (!self) stack.push({ fill, tf }); continue; }
    const n = (k: string, d = 0) => Number.parseFloat(a[k] ?? "") || d;
    let cs: Contour[] = [];
    if (name === "path" && a.d) cs = svgPath(a.d);
    else if (name === "rect") { const x = n("x"), y = n("y"), w = n("width"), h = n("height"); cs = [[x, y, x + w, y, x + w, y + h, x, y + h]]; }
    else if (name === "circle") cs = [ellipse(n("cx"), n("cy"), n("r"))];
    else if (name === "ellipse") cs = [ellipse(n("cx"), n("cy"), n("rx"), n("ry"))];
    else if (name === "polygon" || name === "polyline") cs = [(a.points?.match(NUM) ?? []).map(Number)];
    else continue;
    if (cs.length) shapes.push({ contours: cs.map(tf), fill, rule: a["fill-rule"] === "evenodd" ? "evenodd" : "nonzero" });
  }
  return { shapes, view };
}

/** An SVG drawn crisp at `size` px square, each shape in its fill (snapped), later shapes over earlier ones. */
export function iconFromSvg(src: string, size: number, o: IconImport = {}): Bitmap {
  const { shapes, view } = parseSvg(src);
  const [vx, vy, vw, vh] = view;
  const s = size / Math.max(vw, vh);
  const dx = (size - vw * s) / 2, dy = (size - vh * s) / 2;
  const out = createBitmap(size, size);
  for (const sh of shapes) {
    if (sh.fill === null) continue;
    const cs = sh.contours.map((c) => c.map((v, i) => (i % 2 ? (v - vy) * s + dy : (v - vx) * s + dx)));
    const on = crisp(rasterize(cs, size, size, { rule: sh.rule }), size, size, { threshold: o.threshold ?? 0.5 });
    for (let i = 0; i < on.length; i += 1) if (on[i]) out.px[i] = sh.fill;
  }
  return finish(out, o);
}
