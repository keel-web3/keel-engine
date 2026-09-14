// Layout: anchors for free placement, flex rows and columns, grids -- all in
// whole layer pixels. Sizes are pixels, "fit" (the content's), "fill" (what's
// left, shared by `grow`), or a share of the parent ("40%"). Leftover pixels
// that don't divide go to the first children, so nothing is ever half a
// pixel and nothing jitters when a sibling's size changes by one.

import type { Rect } from "./bitmap.ts";
import type { PixelFont } from "./font.ts";
import { frameShape, frameTemplate } from "./frames.ts";
import type { FrameKind } from "./frames.ts";
import { layoutText, parseRich } from "./text.ts";
import type { TextLayout } from "./text.ts";
import type { Theme } from "./theme.ts";
import type { FontRole, Size, UiNode } from "./node.ts";

export interface LayoutContext {
  readonly theme: Theme;
  font(role: FontRole): PixelFont;
  /** Cached text layouts (the Ui has one); without it, layouts are made fresh. */
  text?(n: UiNode, src: string, role: FontRole, width: number | undefined, opts?: { align?: "left" | "center" | "right"; caps?: boolean; maxLines?: number; wrap?: boolean }): TextLayout;
}

/** The frame a node draws by default. */
export function frameOf(n: UiNode): FrameKind | "none" {
  if (n.props.frame) return n.props.frame;
  switch (n.type) {
    case "panel": return "panel";
    case "button": return "button";
    case "bar": case "minimap": case "portrait": case "list": case "slider": return "inset";
    case "tooltip": case "toast": return "tooltip";
    default: return "none";
  }
}

/** Padding inside a node: its own, or its frame's band plus the theme's spacing. */
export function padOf(n: UiNode, ctx: LayoutContext): { t: number; r: number; b: number; l: number } {
  const f = frameOf(n);
  const band = f === "none" ? 0 : frameTemplate(frameShape(ctx.theme, f)).band;
  const s = ctx.theme.space;
  let p = n.props.pad ?? (f === "none" ? 0 : n.type === "button" ? band + (n.props.text ? Math.max(1, s.unit - 1) : 0) : n.type === "bar" || n.type === "minimap" || n.type === "portrait" ? band : band + s.unit);
  if (n.type === "tabs") p = 0;
  const t = p + (n.props.title && n.type === "panel" ? headerHeight(ctx) : 0);
  return { t, r: p, b: p, l: p };
}
export const headerHeight = (ctx: LayoutContext): number => ctx.font("body").lineHeight + 3;

export const defaultIcon = (ctx: LayoutContext): number => Math.max(10, ctx.theme.type.body * 2);

function textOf(n: UiNode, ctx: LayoutContext, width?: number) {
  const role = n.props.font ?? "body";
  const caps = n.props.caps ?? (n.type === "button" && ctx.theme.type.caps);
  const align = n.props.textAlign ?? "left";
  if (ctx.text) return ctx.text(n, n.props.text ?? "", role, width, { align, caps, ...(n.props.maxLines !== undefined ? { maxLines: n.props.maxLines } : {}), ...(n.props.wrap === false ? { wrap: false } : {}) });
  const font = ctx.font(role);
  return layoutText(parseRich(n.props.text ?? ""), {
    font, ...(width !== undefined ? { width } : {}), ...(n.props.maxLines !== undefined ? { maxLines: n.props.maxLines } : {}),
    align: n.props.textAlign ?? "left", caps, ...(n.props.wrap === false ? { wrap: false } : {}),
  });
}

/** A node's content size when it fits its content (its frame and padding included). */
export function measure(n: UiNode, ctx: LayoutContext, cache: Map<UiNode, { w: number; h: number }>): { w: number; h: number } {
  const hit = cache.get(n);
  if (hit) return hit;
  const pad = padOf(n, ctx);
  const px = pad.l + pad.r, py = pad.t + pad.b;
  const p = n.props;
  const gap = p.gap ?? (n.type === "row" || n.type === "col" || n.type === "grid" || n.type === "panel" ? ctx.theme.space.gap : 0);
  const kids = n.children.filter((c) => !c.props.hidden);
  const fixed = (s: Size | undefined, m: number): number => (typeof s === "number" ? s : m);
  const size = (c: UiNode) => { const m = measure(c, ctx, cache); return { w: fixed(c.props.w, typeof c.props.w === "string" && c.props.w !== "fit" ? c.props.minW ?? 0 : m.w), h: fixed(c.props.h, typeof c.props.h === "string" && c.props.h !== "fit" ? c.props.minH ?? 0 : m.h) }; };
  let w = 0, h = 0;
  const dir = p.dir ?? defaultDir(n);
  if (kids.length && dir === "row") { for (const c of kids) { const s = size(c); w += s.w; h = Math.max(h, s.h); } w += gap * (kids.length - 1); }
  else if (kids.length && dir === "col") { for (const c of kids) { const s = size(c); h += s.h; w = Math.max(w, s.w); } h += gap * (kids.length - 1); }
  else if (kids.length && dir === "grid") {
    const cols = Math.max(1, p.cols ?? 3);
    let cw = 0, ch = 0;
    for (const c of kids) { const s = size(c); cw = Math.max(cw, s.w); ch = Math.max(ch, s.h); }
    const rows = Math.ceil(kids.length / cols);
    w = cols * cw + gap * (cols - 1);
    h = rows * (p.cellH ?? Math.max(ch, cw)) + gap * (rows - 1);
  } else if (kids.length) { for (const c of kids) { const s = size(c); w = Math.max(w, s.w + Math.abs(c.props.x ?? 0)); h = Math.max(h, s.h + Math.abs(c.props.y ?? 0)); } }
  // Content of the leaf widgets.
  switch (n.type) {
    case "label": case "toast": case "tooltip": {
      const t = textOf(n, ctx, n.type === "label" ? (typeof p.w === "number" ? p.w - px : p.maxW !== undefined ? p.maxW - px : undefined) : (p.maxW ?? 160) - px);
      w = Math.max(w, t.w); h = Math.max(h, t.h);
      break;
    }
    case "button": {
      const ic = p.icon ? p.iconSize ?? defaultIcon(ctx) : 0;
      const t = p.text ? textOf(n, ctx) : null;
      // (A labelled button with a hotkey has its keycap beside the label: see paint.ts.)
      const cap = p.text && p.hotkey ? layoutText(parseRich(p.hotkey.toUpperCase()), { font: ctx.font("small") }).w + 3 + Math.max(1, ctx.theme.space.gap) : 0;
      w = Math.max(w, cap + ic + (t ? t.w + (ic ? ctx.theme.space.gap : 0) : 0));
      h = Math.max(h, ic, t ? t.h : 0);
      break;
    }
    case "icon": { const s = p.iconSize ?? defaultIcon(ctx); w = Math.max(w, s); h = Math.max(h, s); break; }
    case "bar": { w = Math.max(w, 48); h = Math.max(h, p.text ? ctx.font(p.font ?? "small").lineHeight + 1 : 4); break; }
    case "slider": { w = Math.max(w, 64); h = Math.max(h, ctx.theme.type.body + 3); break; }
    case "toggle": { const t = p.text ? textOf(n, ctx) : null; w = Math.max(w, ctx.theme.type.body + 4 + (t ? ctx.theme.space.gap + t.w : 0)); h = Math.max(h, ctx.theme.type.body + 4, t?.h ?? 0); break; }
    case "spinner": { const s = p.iconSize ?? 12; w = Math.max(w, s); h = Math.max(h, s); break; }
    case "minimap": case "portrait": { w = Math.max(w, p.image?.w ?? 48); h = Math.max(h, p.image?.h ?? 48); break; }
    case "list": {
      const f = ctx.font(p.font ?? "body");
      for (const it of p.items ?? []) w = Math.max(w, layoutText(parseRich(it), { font: f }).w + 4);
      h = Math.max(h, (p.items?.length ?? 0) * (f.lineHeight + 2));
      break;
    }
    case "tabs": {
      const f = ctx.font(p.font ?? "body");
      const band = frameTemplate(frameShape(ctx.theme, "tab")).band;
      for (const it of p.items ?? []) w += layoutText(it, { font: f, caps: ctx.theme.type.caps }).w + 2 * (band + ctx.theme.space.unit) + 1;
      h = Math.max(h, f.lineHeight + 2 * band + 2);
      break;
    }
    case "panel": if (p.title) w = Math.max(w, layoutText(p.title, { font: ctx.font("body"), caps: ctx.theme.type.caps }).w + 4); break;
    default: break;
  }
  const out = { w: clampTo(w + px, p.minW, p.maxW), h: clampTo(h + py, p.minH, p.maxH) };
  cache.set(n, out);
  return out;
}

const clampTo = (v: number, lo = 0, hi = Infinity): number => Math.max(lo, Math.min(hi, v));
export const defaultDir = (n: UiNode): "free" | "row" | "col" | "grid" =>
  n.type === "row" || n.type === "tabs" ? "row" : n.type === "col" || n.type === "panel" || n.type === "list" ? "col" : n.type === "grid" ? "grid" : "free";

function resolve(s: Size | undefined, avail: number, fit: number, stretch: boolean): number {
  if (typeof s === "number") return s;
  if (s === "fill") return avail;
  if (typeof s === "string" && s.endsWith("%")) return Math.floor((Number(s.slice(0, -1)) / 100) * avail);
  return stretch ? avail : Math.min(fit, avail);
}

/** `total` split into `n` whole sizes with `gap` between them, the leftover pixels to the first. */
function split(total: number, n: number, gap: number): number[] {
  const room = Math.max(0, total - gap * (n - 1)), base = Math.floor(room / n);
  return Array.from({ length: n }, (_, i) => base + (i < room - base * n ? 1 : 0));
}

/** Lay a node out in `r`, then its children. */
export function arrange(n: UiNode, r: Rect, ctx: LayoutContext, cache: Map<UiNode, { w: number; h: number }>): void {
  n.rect = { x: r.x, y: r.y, w: Math.max(0, r.w), h: Math.max(0, r.h) };
  const pad = padOf(n, ctx);
  const inner = { x: r.x + pad.l, y: r.y + pad.t, w: Math.max(0, r.w - pad.l - pad.r), h: Math.max(0, r.h - pad.t - pad.b) };
  const p = n.props;
  const kids = n.children.filter((c) => !c.props.hidden);
  for (const c of n.children) if (c.props.hidden) c.rect = { x: 0, y: 0, w: 0, h: 0 };
  if (!kids.length) return;
  const gap = p.gap ?? (n.type === "row" || n.type === "col" || n.type === "grid" || n.type === "panel" ? ctx.theme.space.gap : 0);
  const dir = p.dir ?? defaultDir(n);
  if (dir === "row" || dir === "col") {
    const row = dir === "row";
    const main = row ? inner.w : inner.h, cross = row ? inner.h : inner.w;
    const avail = main - gap * (kids.length - 1);
    const sizes: number[] = [];
    const grows: number[] = [];
    for (const c of kids) {
      const m = measure(c, ctx, cache);
      const s = row ? c.props.w : c.props.h;
      const lo = row ? c.props.minW : c.props.minH, hi = row ? c.props.maxW : c.props.maxH;
      const g = s === "fill" ? c.props.grow ?? 1 : c.props.grow ?? 0;
      grows.push(g);
      sizes.push(s === "fill" ? clampTo(0, lo, hi) : clampTo(resolve(s, main, row ? m.w : m.h, false), lo, hi));
    }
    let left = avail - sizes.reduce((a, b) => a + b, 0);
    const totalGrow = grows.reduce((a, b) => a + b, 0);
    if (totalGrow > 0 && left > 0) {
      const share = left;
      let given = 0;
      kids.forEach((c, i) => {
        if (!grows[i]) return;
        const add = Math.floor((share * grows[i]!) / totalGrow);
        const hi = row ? c.props.maxW : c.props.maxH;
        const nv = clampTo(sizes[i]! + add, 0, hi);
        given += nv - sizes[i]!;
        sizes[i] = nv;
      });
      // (What didn't divide, a pixel each to the first growers.)
      let rest = share - given;
      for (let i = 0; i < kids.length && rest > 0; i += 1) if (grows[i]) { sizes[i]! += 1; rest -= 1; }
      left = 0;
    }
    const just = p.justify ?? "start";
    let pos = (row ? inner.x : inner.y) + (left > 0 ? (just === "center" ? Math.floor(left / 2) : just === "end" ? left : 0) : 0);
    const between = just === "between" && kids.length > 1 && left > 0 ? left / (kids.length - 1) : 0;
    kids.forEach((c, i) => {
      const m = measure(c, ctx, cache);
      const al = p.align ?? (n.type === "panel" || n.type === "list" ? "stretch" : "start");
      const cs = row ? c.props.h : c.props.w;
      const lo = row ? c.props.minH : c.props.minW, hi = row ? c.props.maxH : c.props.maxW;
      const csz = clampTo(resolve(cs, cross, row ? m.h : m.w, al === "stretch" && cs === undefined), lo, hi);
      const off = al === "center" ? Math.floor((cross - csz) / 2) : al === "end" ? cross - csz : 0;
      const at = Math.round(pos + between * i);
      const rr = row ? { x: at, y: inner.y + off, w: sizes[i]!, h: csz } : { x: inner.x + off, y: at, w: csz, h: sizes[i]! };
      arrange(c, rr, ctx, cache);
      pos += sizes[i]! + gap;
    });
    return;
  }
  if (dir === "grid" && p.reflow) {
    // Reflow: rows and columns from how many children show -- the fewest rows that keep a cell at least 0.7 as wide as
    // it is tall -- and the cells fill the grid's whole box, a short last row's cells wider, every leftover pixel given
    // to the first ones. Whole pixels, and only the count and the box decide it.
    const n = kids.length;
    let rows = 1;
    for (let r = 1; r <= n; r += 1) { rows = r; const per = Math.ceil(n / r); if ((inner.w - gap * (per - 1)) / per >= 0.7 * ((inner.h - gap * (r - 1)) / r)) break; }
    const hs = split(inner.h, rows, gap);
    let i = 0, y = inner.y;
    for (let r = 0; r < rows; r += 1) {
      const inRow = Math.floor(n / rows) + (r < n % rows ? 1 : 0);
      const ws = split(inner.w, inRow, gap);
      let x = inner.x;
      for (let c = 0; c < inRow; c += 1, i += 1) { arrange(kids[i]!, { x, y, w: ws[c]!, h: hs[r]! }, ctx, cache); x += ws[c]! + gap; }
      y += hs[r]! + gap;
    }
    return;
  }
  if (dir === "grid") {
    const cols = Math.max(1, p.cols ?? 3);
    const cw = Math.floor((inner.w - gap * (cols - 1)) / cols);
    const ch = p.cellH ?? cw;
    kids.forEach((c, i) => arrange(c, { x: inner.x + (i % cols) * (cw + gap), y: inner.y + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }, ctx, cache));
    return;
  }
  // Free: each child by its anchor, offset inward.
  for (const c of kids) {
    const m = measure(c, ctx, cache);
    const cp = c.props;
    const w = clampTo(resolve(cp.w, inner.w, m.w, false), cp.minW, cp.maxW);
    const h = clampTo(resolve(cp.h, inner.h, m.h, false), cp.minH, cp.maxH);
    const a = cp.anchor ?? "tl";
    const ax = a.endsWith("l") ? 0 : a.endsWith("r") ? 1 : 0.5;
    const ay = a.startsWith("t") ? 0 : a.startsWith("b") ? 1 : 0.5;
    const ox = cp.x ?? 0, oy = cp.y ?? 0;
    const x = inner.x + Math.floor(ax * (inner.w - w)) + (ax === 1 ? -ox : ox);
    const y = inner.y + Math.floor(ay * (inner.h - h)) + (ay === 1 ? -oy : oy);
    arrange(c, { x, y, w, h }, ctx, cache);
  }
}
