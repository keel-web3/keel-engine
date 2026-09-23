// Painters: each widget drawn into the layer, clipped to the dirty rectangle
// being redrawn, from the theme's frames, the atlas's glyphs and icons, and
// the palette's ramps. Everything lands on whole pixels in palette colours;
// dimming a disabled or cooling-down button is a dither; a modal's scrim
// darkens what's under it solidly (scrim below), never a checker over text.

import { blit, fillRect, intersect, isEmpty, plot, strokeRect } from "./bitmap.ts";
import type { Bitmap, Clip } from "./bitmap.ts";
import { contrast, fromOklch, oklab } from "./color.ts";
import type { Rgba } from "./color.ts";
import type { AtlasSprite, UiAtlas } from "./atlas.ts";
import type { PixelFont } from "./font.ts";
import { drawFrame } from "./frames.ts";
import type { IconFamily } from "./iconfamily.ts";
import { carveTop, drawTrim, edgeDepth } from "./silhouette.ts";
import type { FrameColours, FrameKind, FrameState, FrameTemplate } from "./frames.ts";
import { rampOf } from "./icons.ts";
import { defaultIcon, frameOf, headerHeight, padOf } from "./layout.ts";
import type { LayoutContext } from "./layout.ts";
import { stateOf } from "./node.ts";
import type { FontRole, UiNode } from "./node.ts";
import { drawText, layoutText, parseRich } from "./text.ts";
import type { TextLayout } from "./text.ts";
import type { Theme } from "./theme.ts";

export interface PaintContext extends LayoutContext {
  readonly layer: Bitmap;
  readonly atlas: UiAtlas;
  readonly theme: Theme;
  clip: Clip;
  /** Seconds since the UI started (spinners). */
  readonly time: number;
  readonly focusVisible: boolean;
  frame(kind: FrameKind, state: FrameState): { t: FrameTemplate; c: FrameColours };
  /** A themed icon's sprite in the atlas (size x size), in the culture's family or the one given; `on`: what it's drawn over (its colours kept 3:1 off it). */
  icon(name: string, size: number, tone?: string, family?: IconFamily, on?: Rgba): AtlasSprite | null;
  /** Text colour for a tone name. */
  tone(name: string | undefined): Rgba;
  /** Cached text layouts (by node, content and width). */
  text(n: UiNode, src: string, font: FontRole, width: number | undefined, opts?: { align?: "left" | "center" | "right"; caps?: boolean; maxLines?: number; wrap?: boolean }): TextLayout;
}

const inset = (n: UiNode, ctx: PaintContext) => {
  const p = padOf(n, ctx);
  return { x: n.rect.x + p.l, y: n.rect.y + p.t, w: Math.max(0, n.rect.w - p.l - p.r), h: Math.max(0, n.rect.h - p.t - p.b) };
};

function frameRect(n: UiNode, ctx: PaintContext, kind: FrameKind | "none", state: FrameState, opts: { mesh?: boolean } = {}) {
  // (A frameless node -- a HUD's bare picture -- draws no frame, but still answers with the panel's colours.)
  if (kind === "none") return ctx.frame("panel", state);
  const f = ctx.frame(kind, state);
  drawFrame(ctx.layer, n.rect.x, n.rect.y, n.rect.w, n.rect.h, f.t, f.c, ctx.clip, opts.mesh ? { mesh: true } : {});
  return f;
}

function drawIconAt(ctx: PaintContext, name: string, x: number, y: number, size: number, tone?: string, family?: IconFamily, on?: Rgba): void {
  const s = ctx.icon(name, size, tone, family, on);
  // (A registered icon baked at another size sits centred in the room it was given.)
  if (s) blit(ctx.layer, ctx.atlas.page, s.x, s.y, s.w, s.h, x + Math.floor((size - s.w) / 2), y + Math.floor((size - s.h) / 2), ctx.clip);
}

/** A health strip's height in a button whose content is `h` tall: 2 px at least, about a twelfth of it. */
export const hpStrip = (h: number): number => Math.max(2, Math.round(h / 12));

/**
 * Where a button draws its content -- inside its frame, less a keycap and a health strip -- and the size its icon is
 * drawn at there (`iconFill`: as big as that room allows). What `ui.iconSizeOf(id)` reports.
 */
export function buttonContent(n: UiNode, ctx: LayoutContext & { text?: PaintContext["text"] }): { box: { x: number; y: number; w: number; h: number }; icon: number; strip: number } {
  const p = n.props;
  const pad = padOf(n, ctx);
  const inr = { x: n.rect.x + pad.l, y: n.rect.y + pad.t, w: Math.max(0, n.rect.w - pad.l - pad.r), h: Math.max(0, n.rect.h - pad.t - pad.b) };
  const strip = p.hp !== undefined && p.hp !== null ? hpStrip(inr.h) : 0;
  if (strip) inr.h = Math.max(1, inr.h - strip - 1);
  const cap = p.hotkey && p.text ? keycapWidth(n, ctx) : 0;
  const box = cap ? { x: inr.x + cap, y: inr.y, w: Math.max(1, inr.w - cap), h: inr.h } : inr;
  const avail = Math.min(box.w, box.h);
  const icon = p.icon ? Math.max(6, p.iconFill ? avail : Math.min(p.iconSize ?? defaultIcon(ctx), avail)) : 0;
  return { box, icon, strip };
}

function textAt(ctx: PaintContext, t: TextLayout, x: number, y: number, tone?: string, shadow?: Rgba, outline?: Rgba): void {
  drawText(ctx.layer, ctx.atlas, t, x, y, ctx.clip, {
    tone: (tn) => ctx.tone(tn ?? tone),
    ...(shadow !== undefined ? { shadow } : {}),
    ...(outline !== undefined ? { outline } : {}),
    icon: (name, ix, iy, size) => drawIconAt(ctx, name, ix, iy, size),
  });
}

// Checker-dither a rectangle with one colour: dimming without alpha.
function dim(ctx: PaintContext, x: number, y: number, w: number, h: number, c: Rgba, parity = 0): void {
  const cl = intersect(ctx.clip, { x0: x, y0: y, x1: x + w, y1: y + h });
  if (isEmpty(cl)) return;
  const L = ctx.layer;
  for (let py = Math.max(cl.y0, 0); py < Math.min(cl.y1, L.h); py += 1) {
    let px = Math.max(cl.x0, 0);
    if (((px + py + parity) & 1) === 1) px += 1;
    for (; px < Math.min(cl.x1, L.w); px += 2) L.px[py * L.w + px] = c;
  }
}

// A modal's scrim. Under it the UI is darkened SOLIDLY -- every drawn pixel becomes a darker shade of itself (the
// same hue, lower lightness), so text under a menu keeps every pixel of its shape, only dimmer -- and where the game
// shows through (nothing drawn), one flat very dark colour (the deepest surface, darkened): a blackout behind the
// menu, no pattern anywhere. (`scrim: "dither"` keeps the old even checker there, the world half showing.)
const DARKER = new Map<Rgba, Rgba>();
export function darkerShade(c: Rgba): Rgba {
  let d = DARKER.get(c);
  if (d === undefined) {
    const [L, a, b] = oklab(c);
    d = fromOklch(L * 0.52, Math.hypot(a, b) * 0.75, (Math.atan2(b, a) * 180) / Math.PI);
    if (DARKER.size > 4096) DARKER.clear();
    DARKER.set(c, d);
  }
  return d;
}
function scrim(ctx: PaintContext, x: number, y: number, w: number, h: number, deep: Rgba, kind: "solid" | "dither"): void {
  const cl = intersect(ctx.clip, { x0: x, y0: y, x1: x + w, y1: y + h });
  if (isEmpty(cl)) return;
  const L = ctx.layer;
  const fill = kind === "solid" ? darkerShade(deep) : deep;
  let last = -1, lastD = 0;
  for (let py = Math.max(cl.y0, 0); py < Math.min(cl.y1, L.h); py += 1) for (let px = Math.max(cl.x0, 0), o = py * L.w + px; px < Math.min(cl.x1, L.w); px += 1, o += 1) {
    const c = L.px[o]!;
    if (c === 0) { if (kind === "solid" || ((px + py) & 1) === 0) L.px[o] = fill; continue; }
    if (c !== last) { last = c; lastD = darkerShade(c); }
    L.px[o] = lastD;
  }
}

// Cooldown sweep: the part still cooling, clockwise from twelve o'clock, dimmed; its leading edge lit.
const SWEEPS = new Map<string, Float32Array>();
function sweepTable(w: number, h: number): Float32Array {
  const key = `${w}x${h}`;
  let t = SWEEPS.get(key);
  if (!t) {
    t = new Float32Array(w * h);
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const a = Math.atan2(x - cx, -(y - cy));
      t[y * w + x] = (a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2);
    }
    SWEEPS.set(key, t);
  }
  return t;
}
function cooldown(ctx: PaintContext, x: number, y: number, w: number, h: number, left: number): void {
  if (left <= 0 || w <= 0 || h <= 0) return;
  const done = 1 - Math.min(1, left);
  const t = sweepTable(w, h);
  const L = ctx.layer, cl = ctx.clip;
  const shade = ctx.theme.palette.surface[0]!, edge = ctx.theme.palette.accent[3]!;
  const step = 1 / Math.max(w, h);
  for (let yy = 0; yy < h; yy += 1) {
    const py = y + yy;
    if (py < cl.y0 || py >= cl.y1 || py < 0 || py >= L.h) continue;
    for (let xx = 0; xx < w; xx += 1) {
      const px = x + xx;
      if (px < cl.x0 || px >= cl.x1 || px < 0 || px >= L.w) continue;
      const a = t[yy * w + xx]!;
      if (a < done) continue;
      if (a - done < step * 1.2 && done > 0) L.px[py * L.w + px] = edge;
      else if (((px + py) & 1) === 0) L.px[py * L.w + px] = shade;
    }
  }
}

function paintButton(n: UiNode, ctx: PaintContext): void {
  const st = stateOf(n);
  const p = n.props;
  frameRect(n, ctx, frameOf(n) as FrameKind, st);
  const sink = n.press ? ctx.theme.motion.press : 0;
  const pal = ctx.theme.palette;
  // (Disabled: the face is dithered first and the icon drawn over it in the dim ink -- its shape still reads.)
  if (p.disabled) { dim(ctx, n.rect.x + 1, n.rect.y + 1, n.rect.w - 2, n.rect.h - 2, pal.surface[0]!); }
  const tone = p.disabled ? "dim" : st === "primary" ? "onAccent" : p.tone ?? "ink";
  // (A labelled button keeps its hotkey in a keycap at the left, and centres its content in the rest: never over the text.)
  const cap = p.hotkey && p.text ? keycapWidth(n, ctx) : 0;
  const { box, icon: iconSize, strip } = buttonContent(n, ctx);
  const inr = cap ? { ...box, x: box.x - cap, w: box.w + cap } : box;
  const face = ctx.frame(frameOf(n) as FrameKind, st).c.fill;
  const t = p.text ? ctx.text(n, p.text, p.font ?? "body", Math.max(1, box.w - (iconSize ? iconSize + ctx.theme.space.gap : 0)), { caps: p.caps ?? ctx.theme.type.caps, maxLines: p.maxLines ?? 1 }) : null;
  const cw = iconSize + (t ? t.w + (iconSize ? ctx.theme.space.gap : 0) : 0);
  let cx = box.x + Math.floor((box.w - cw) / 2);
  if (p.icon) {
    drawIconAt(ctx, p.icon, cx, inr.y + Math.floor((inr.h - iconSize) / 2) + sink, iconSize, p.disabled ? "dim" : p.tone, undefined, p.disabled ? undefined : face);
    cx += iconSize + ctx.theme.space.gap;
  }
  if (t) textAt(ctx, t, cx, inr.y + Math.floor((inr.h - t.h) / 2) + sink, tone);
  // The health strip along the bottom: the tone's ramp for what's left, the deepest surface for what's gone.
  if (strip) {
    const hp = Math.max(0, Math.min(1, p.hp!)), sy = inr.y + inr.h + 1, sw = inr.w;
    const r = rampOf(ctx.theme, hp > 0.66 ? "good" : hp > 0.33 ? "warn" : "bad");
    const fw = hp > 0 ? Math.max(1, Math.round(hp * sw)) : 0;
    fillRect(ctx.layer, inr.x, sy, sw, strip, pal.surface[0]!, ctx.clip);
    if (fw) { fillRect(ctx.layer, inr.x, sy, fw, strip, r[2]!, ctx.clip); fillRect(ctx.layer, inr.x, sy, fw, 1, r[3]!, ctx.clip); }
  }
  // Cooldown over the face, inside the border.
  if (p.cooldown && p.cooldown > 0) {
    const b = ctx.frame("button", st).t.band;
    cooldown(ctx, n.rect.x + b, n.rect.y + b, n.rect.w - 2 * b, n.rect.h - 2 * b, p.cooldown);
  }
  const small = ctx.font("small");
  // Hotkey badge, top-left (a labelled button's keycap, left and centred); a count, bottom-right.
  if (p.hotkey && cap) {
    const kt = ctx.text(n, p.hotkey.toUpperCase(), "small", undefined);
    const f = ctx.frame("badge", "normal");
    const bh = small.size + 3;
    drawFrame(ctx.layer, inr.x, n.rect.y + Math.floor((n.rect.h - bh) / 2), kt.w + 3, bh, f.t, f.c, ctx.clip);
    textAt(ctx, kt, inr.x + 2, n.rect.y + Math.floor((n.rect.h - bh) / 2) + 2, "warn");
  } else if (p.hotkey) {
    // (A badge when the button has room for one; on a small button, the letter itself, shadowed, over the icon's corner.)
    const kt = ctx.text(n, p.hotkey.toUpperCase(), "small", undefined);
    if (Math.min(n.rect.w, n.rect.h) >= 28 || !p.icon) {
      const f = ctx.frame("badge", "normal");
      drawFrame(ctx.layer, n.rect.x + 1, n.rect.y + 1, kt.w + 3, small.size + 3, f.t, f.c, ctx.clip);
      textAt(ctx, kt, n.rect.x + 3, n.rect.y + 3, "warn");
    } else if (kt.w <= n.rect.w / 2) textAt(ctx, kt, n.rect.x + 2, n.rect.y + 2, "warn", pal.surface[0]!);
  }
  if (p.count !== undefined && p.count > 0) {
    const ct = ctx.text(n, String(p.count), "small", undefined);
    textAt(ctx, ct, n.rect.x + n.rect.w - ct.w - 2, n.rect.y + n.rect.h - small.size - 2, "bright", pal.surface[0]!);
  }
}

/** How much room a labelled button's keycap takes (its badge and a gap). */
export function keycapWidth(n: UiNode, ctx: LayoutContext & { text?: PaintContext["text"] }): number {
  const kt = ctx.text ? ctx.text(n, (n.props.hotkey ?? "").toUpperCase(), "small", undefined) : layoutText(parseRich((n.props.hotkey ?? "").toUpperCase()), { font: ctx.font("small") });
  return kt.w + 3 + Math.max(1, ctx.theme.space.gap);
}

/**
 * A bar's label: the bright ink, outlined in whichever of the theme's darkest and lightest colours stands furthest
 * from it (a light theme's dark ink gets a light outline) -- 4.5:1 or more, whatever the fill under it.
 */
export function barLabel(theme: Theme): { text: Rgba; outline: Rgba } {
  const p = theme.palette, text = p.ink[2]!;
  const outline = [p.outline, p.surface[0]!, p.surface[5]!].reduce((b, c) => (contrast(c, text) > contrast(b, text) ? c : b));
  return { text, outline };
}

function barRamp(ctx: PaintContext, tone: string | undefined, frac: number) {
  if (tone === "health") return rampOf(ctx.theme, frac > 0.6 ? "good" : frac > 0.3 ? "warn" : "bad");
  return rampOf(ctx.theme, tone ?? "accent");
}

function paintBar(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  frameRect(n, ctx, frameOf(n) as FrameKind, "normal");
  const inr = inset(n, ctx);
  const max = p.max && p.max > 0 ? p.max : 1;
  const frac = Math.max(0, Math.min(1, (p.value ?? 0) / max));
  const fw = Math.round(frac * inr.w);
  const r = barRamp(ctx, p.tone, frac);
  const L = ctx.layer;
  if (p.trail !== undefined && p.trail > (p.value ?? 0)) {
    const tw = Math.round(Math.min(1, p.trail / max) * inr.w);
    fillRect(L, inr.x + fw, inr.y, tw - fw, inr.h, r[4]!, ctx.clip);
  }
  if (fw > 0) {
    fillRect(L, inr.x, inr.y, fw, inr.h, r[2]!, ctx.clip);
    if (inr.h >= 3) { fillRect(L, inr.x, inr.y, fw, 1, r[3]!, ctx.clip); fillRect(L, inr.x, inr.y + inr.h - 1, fw, 1, r[1]!, ctx.clip); }
  }
  // (The label: outlined, over the fill; the segment ticks stop short of it so no divider cuts a digit.)
  const t = p.text ? ctx.text(n, p.text, p.font ?? "small", inr.w, { align: "center", maxLines: 1 }) : null;
  const tx0 = t ? inr.x + Math.floor((inr.w - t.w) / 2) - 2 : 0, tx1 = t ? tx0 + t.w + 4 : 0;
  const seg = p.segments ?? 0;
  if (seg > 1) for (let k = 1; k < seg; k += 1) { const sx = inr.x + Math.round((k * inr.w) / seg); if (!t || sx < tx0 || sx >= tx1) fillRect(L, sx, inr.y, 1, inr.h, ctx.theme.palette.surface[0]!, ctx.clip); }
  if (t) { const lc = barLabel(ctx.theme); textAt(ctx, t, inr.x, inr.y + Math.floor((inr.h - t.h) / 2), "bright", undefined, lc.outline); }
}

function paintLabel(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  const kind = frameOf(n);
  if (kind !== "none") frameRect(n, ctx, kind, "normal", p.mesh ? { mesh: true } : {});
  const inr = inset(n, ctx);
  const t = ctx.text(n, p.text ?? "", p.font ?? "body", inr.w, { align: p.textAlign ?? "left", caps: p.caps ?? false, ...(p.maxLines !== undefined ? { maxLines: p.maxLines } : {}), ...(p.wrap === false ? { wrap: false } : {}) });
  textAt(ctx, t, inr.x, inr.y + Math.max(0, Math.floor((inr.h - t.h) / 2)), p.tone ?? "ink", p.shadow ? ctx.theme.palette.surface[0]! : undefined);
}

function paintPicture(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  frameRect(n, ctx, frameOf(n) as FrameKind, "normal");
  const inr = inset(n, ctx);
  if (p.hole) fillRect(ctx.layer, inr.x, inr.y, inr.w, inr.h, 0, ctx.clip);
  else if (p.image) blit(ctx.layer, p.image, 0, 0, p.image.w, p.image.h, inr.x + Math.floor((inr.w - p.image.w) / 2), inr.y + Math.floor((inr.h - p.image.h) / 2), intersect(ctx.clip, { x0: inr.x, y0: inr.y, x1: inr.x + inr.w, y1: inr.y + inr.h }));
  else if (n.type === "portrait") {
    const s = Math.min(inr.w, inr.h) - 4;
    // (The stand-in until the game gives a portrait: a plain figure, not a command icon in the race's hand.)
    if (s >= 8) drawIconAt(ctx, "train", inr.x + Math.floor((inr.w - s) / 2), inr.y + Math.floor((inr.h - s) / 2), s, "dim", "plain");
  }
  if (n.type === "minimap" && p.view) {
    const [vx, vy, vw, vh] = p.view;
    strokeRect(ctx.layer, inr.x + Math.round(vx * inr.w), inr.y + Math.round(vy * inr.h), Math.max(2, Math.round(vw * inr.w)), Math.max(2, Math.round(vh * inr.h)), ctx.theme.palette.ink[2]!, intersect(ctx.clip, { x0: inr.x, y0: inr.y, x1: inr.x + inr.w, y1: inr.y + inr.h }));
  }
}

function paintList(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  frameRect(n, ctx, frameOf(n) as FrameKind, "normal");
  const inr = inset(n, ctx);
  const f = ctx.font(p.font ?? "body");
  const lh = f.lineHeight + 2;
  const first = Math.max(0, Math.floor(p.value ?? 0));
  const items = p.items ?? [];
  const pal = ctx.theme.palette;
  const cl = intersect(ctx.clip, { x0: inr.x, y0: inr.y, x1: inr.x + inr.w, y1: inr.y + inr.h });
  const saved = ctx.clip;
  ctx.clip = cl;
  for (let i = first, row = 0; i < items.length && row * lh < inr.h; i += 1, row += 1) {
    const y = inr.y + row * lh;
    if (i === p.selected) fillRect(ctx.layer, inr.x, y, inr.w, lh, pal.accent[1]!, cl);
    else if (n.hover && n.anim === i) fillRect(ctx.layer, inr.x, y, inr.w, lh, pal.surface[2]!, cl);
    const t = ctx.text(n, items[i]!, p.font ?? "body", inr.w - 4, { maxLines: 1 });
    textAt(ctx, t, inr.x + 2, y + 1, i === p.selected ? "onAccent" : "ink");
  }
  ctx.clip = saved;
}

function paintTabs(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  const f = ctx.frame("tab", "normal");
  let x = n.rect.x;
  (p.items ?? []).forEach((it, i) => {
    const t = ctx.text(n, it, p.font ?? "body", undefined, { caps: ctx.theme.type.caps });
    const w = t.w + 2 * (f.t.band + ctx.theme.space.unit);
    const st: FrameState = i === p.selected ? "active" : n.hover && n.anim === i ? "hover" : "normal";
    const fr = ctx.frame("tab", st);
    drawFrame(ctx.layer, x, n.rect.y + (i === p.selected ? 0 : 1), w, n.rect.h - (i === p.selected ? 0 : 1), fr.t, fr.c, ctx.clip);
    textAt(ctx, t, x + Math.floor((w - t.w) / 2), n.rect.y + Math.floor((n.rect.h - t.h) / 2), i === p.selected ? "bright" : "dim");
    x += w + 1;
  });
}

/** Where each tab of a tabs node sits (hit-testing uses the painter's own widths). */
export function tabRects(n: UiNode, ctx: PaintContext | LayoutContext & { text: PaintContext["text"]; frame: PaintContext["frame"] }): Array<{ x: number; w: number }> {
  const f = ctx.frame("tab", "normal");
  let x = n.rect.x;
  return (n.props.items ?? []).map((it) => {
    const t = ctx.text(n, it, n.props.font ?? "body", undefined, { caps: ctx.theme.type.caps });
    const w = t.w + 2 * (f.t.band + ctx.theme.space.unit);
    const r = { x, w };
    x += w + 1;
    return r;
  });
}

function paintSlider(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  const pal = ctx.theme.palette;
  const max = p.max && p.max > 0 ? p.max : 1;
  const frac = Math.max(0, Math.min(1, (p.value ?? 0) / max));
  const th = 4, ty = n.rect.y + Math.floor((n.rect.h - th) / 2);
  const inset = ctx.frame("inset", "normal");
  drawFrame(ctx.layer, n.rect.x, ty, n.rect.w, th, inset.t, inset.c, ctx.clip);
  const kw = Math.max(5, ctx.theme.type.body - 1);
  const kx = n.rect.x + Math.round(frac * (n.rect.w - kw));
  fillRect(ctx.layer, n.rect.x + 1, ty + 1, Math.max(0, kx - n.rect.x), th - 2, pal.accent[2]!, ctx.clip);
  const knob = ctx.frame("button", n.press ? "press" : n.hover || n.focus ? "hover" : "normal");
  drawFrame(ctx.layer, kx, n.rect.y, kw, n.rect.h, knob.t, knob.c, ctx.clip);
}

function paintToggle(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  const s = ctx.theme.type.body + 4;
  const y = n.rect.y + Math.floor((n.rect.h - s) / 2);
  const box = ctx.frame("inset", "normal");
  drawFrame(ctx.layer, n.rect.x, y, s, s, box.t, box.c, ctx.clip);
  if ((p.value ?? 0) > 0) {
    const c = ctx.theme.palette.accent[3]!;
    const m = 3;
    // (A tick drawn in pixels: down-right then up-right.)
    const x0 = n.rect.x + m, y0 = y + Math.floor(s / 2), mid = n.rect.x + Math.floor(s / 2) - 1;
    for (let k = 0; k <= mid - x0; k += 1) { plot(ctx.layer, x0 + k, y0 + k, c, ctx.clip); plot(ctx.layer, x0 + k, y0 + k - 1, c, ctx.clip); }
    for (let k = 0; mid + k < n.rect.x + s - m; k += 1) { plot(ctx.layer, mid + k, y0 + mid - x0 - k, c, ctx.clip); plot(ctx.layer, mid + k, y0 + mid - x0 - k - 1, c, ctx.clip); }
  }
  if (n.hover || n.focus) strokeRect(ctx.layer, n.rect.x, y, s, s, ctx.theme.palette.accent[2]!, ctx.clip);
  if (p.text) {
    const t = ctx.text(n, p.text, p.font ?? "body", undefined);
    textAt(ctx, t, n.rect.x + s + ctx.theme.space.gap, n.rect.y + Math.floor((n.rect.h - t.h) / 2), p.tone ?? "ink");
  }
}

function paintSpinner(n: UiNode, ctx: PaintContext): void {
  const s = Math.min(n.rect.w, n.rect.h);
  const cx = n.rect.x + (s - 1) / 2, cy = n.rect.y + (s - 1) / 2;
  const r = rampOf(ctx.theme, n.props.tone ?? "accent");
  const frame = Math.floor(ctx.time * 10) % 8;
  const rad = s / 2 - 1.5;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const age = (frame - i + 8) % 8;
    if (age > 4) continue;
    const c = r[Math.max(0, 4 - age)]!;
    const x = Math.round(cx + Math.sin(a) * rad), y = Math.round(cy - Math.cos(a) * rad);
    plot(ctx.layer, x, y, c, ctx.clip);
    if (s >= 12) { plot(ctx.layer, x + 1, y, c, ctx.clip); plot(ctx.layer, x, y + 1, c, ctx.clip); plot(ctx.layer, x + 1, y + 1, c, ctx.clip); }
  }
}

function paintPanel(n: UiNode, ctx: PaintContext): void {
  const p = n.props;
  if (p.trim) { drawTrim(ctx.layer, n.rect.x, n.rect.y, n.rect.w, n.rect.h, p.trim, ctx.frame("panel", "normal").c, ctx.clip, !!p.mesh); return; }
  const kind = frameOf(n);
  // (A carved top edge: keep what's under the top rows, draw the frame, then cut the profile back out of it.)
  const depth = p.edge && kind !== "none" ? edgeDepth(p.edge) + 2 : 0;
  let under: Uint32Array | null = null;
  if (depth) {
    const { x, y, w } = n.rect, L = ctx.layer;
    under = new Uint32Array(w * depth);
    for (let r = 0; r < depth; r += 1) if (y + r >= 0 && y + r < L.h) for (let cx = Math.max(0, -x); cx < w && x + cx < L.w; cx += 1) under[r * w + cx] = L.px[(y + r) * L.w + x + cx]!;
  }
  if (kind !== "none") frameRect(n, ctx, kind, p.active ? "active" : "normal", p.mesh ? { mesh: true } : {});
  if (under) carveTop(ctx.layer, n.rect.x, n.rect.y, n.rect.w, p.edge!, under, ctx.frame(kind as FrameKind, "normal").c, ctx.clip);
  if (p.title) {
    const f = ctx.frame("header", "normal");
    const band = ctx.frame(kind === "none" ? "panel" : kind, "normal").t.band;
    const hh = headerHeight(ctx);
    drawFrame(ctx.layer, n.rect.x + band, n.rect.y + band, n.rect.w - 2 * band, hh, f.t, f.c, ctx.clip);
    const t = ctx.text(n, p.title, "body", n.rect.w - 2 * band - 4, { caps: ctx.theme.type.caps, maxLines: 1 });
    textAt(ctx, t, n.rect.x + band + 2 + ctx.theme.space.unit + (p.textAlign === "center" ? Math.floor((n.rect.w - 2 * band - 4 - t.w) / 2) : 0), n.rect.y + band + Math.floor((hh - t.h) / 2) + 1, p.tone ?? "bright");
  }
}

/** Paint one node (not its children). */
export function paintNode(n: UiNode, ctx: PaintContext): void {
  switch (n.type) {
    case "panel": paintPanel(n, ctx); break;
    case "button": paintButton(n, ctx); break;
    case "label": paintLabel(n, ctx); break;
    case "icon": {
      const s = Math.min(n.rect.w, n.rect.h, n.props.iconSize ?? 999);
      if (n.props.icon) drawIconAt(ctx, n.props.icon, n.rect.x + Math.floor((n.rect.w - s) / 2), n.rect.y + Math.floor((n.rect.h - s) / 2), s, n.props.tone);
      break;
    }
    case "bar": paintBar(n, ctx); break;
    case "minimap": case "portrait": case "image": paintPicture(n, ctx); break;
    case "list": paintList(n, ctx); break;
    case "tabs": paintTabs(n, ctx); break;
    case "slider": paintSlider(n, ctx); break;
    case "toggle": paintToggle(n, ctx); break;
    case "spinner": paintSpinner(n, ctx); break;
    case "tooltip": case "toast": paintLabel(n, ctx); break;
    case "modal": scrim(ctx, n.rect.x, n.rect.y, n.rect.w, n.rect.h, ctx.theme.palette.surface[0]!, n.props.scrim ?? "solid"); break;
    default: if (n.props.frame && n.props.frame !== "none") frameRect(n, ctx, n.props.frame, n.props.active ? "active" : "normal", n.props.mesh ? { mesh: true } : {});
  }
  if (n.focus && ctx.focusVisible && n.type !== "button") strokeRect(ctx.layer, n.rect.x - 1, n.rect.y - 1, n.rect.w + 2, n.rect.h + 2, ctx.theme.palette.accent[3]!, ctx.clip);
}

/** How far outside its rectangle a node may paint (glow, shadow, focus ring). */
export function marginOf(n: UiNode, ctx: PaintContext): number {
  const f = frameOf(n);
  const m = f === "none" ? 0 : ctx.frame(f, "hover").t.margin;
  return Math.max(1, m, n.props.frame ? ctx.frame(n.props.frame === "none" ? "panel" : n.props.frame, "normal").t.margin : 0);
}

export { layoutText, parseRich };
export type { PixelFont };
