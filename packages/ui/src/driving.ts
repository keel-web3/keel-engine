// Maintained driving controls/instruments: canonical recipe nodes, painted straight
// into the retained UI layer. No state-, size- or viewport-indexed bitmap cache.
import type { Rgba } from "./color.ts";
import { overrideDoc } from "./doc.ts";
import type { NodeDoc } from "./doc.ts";
import { glyphOf } from "./font.ts";
import type { PixelFont } from "./font.ts";
import type { Generated, GenerateOptions } from "./generate.ts";
import { DRIVING_KINDS, DRIVING_VARIANTS } from "./node.ts";
import type { DrivingKind, DrivingVariant, NodeProps, UiNode } from "./node.ts";
import type { PaintContext } from "./paint.ts";
import { cultureOf, generateTheme } from "./theme.ts";

export const DRIVING_GENERATOR = "keel/ui/driving@1";

export interface DrivingPart extends Omit<NodeProps, "x" | "y" | "w" | "h" | "image" | "drivingKind" | "drivingVariant"> {
  readonly id: string;
  readonly kind: DrivingKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface DrivingHudOptions extends GenerateOptions {
  readonly variant?: DrivingVariant;
  readonly parts: readonly DrivingPart[];
  /** Ordinary canonical labels, icons, panels and menu buttons; painted after the instruments. */
  readonly chrome?: readonly NodeDoc[];
}

/**
 * A driving HUD as UI_SCREEN data. Wheel value is -1..1; pedals/boost use
 * value/max (default max 1). Dials use absolute value/max; a combined dial's
 * secondaryValue/secondaryMax carry RPM. Every choice lives in the screen or
 * its theme recipe, so decoding and loading it needs no game-local artwork.
 */
export function generateDrivingHud(o: DrivingHudOptions): Generated {
  const W = o.width ?? 640, H = o.height ?? 360;
  const dimension = (v: number): boolean => Number.isInteger(v) && v > 0 && v <= 8192;
  if (!dimension(W) || !dimension(H)) throw new RangeError("A driving HUD has whole dimensions in 1..8192.");
  const variant = o.variant ?? "touring";
  if (!(DRIVING_VARIANTS as readonly string[]).includes(variant)) throw new RangeError("Unknown driving variant.");
  if (o.parts.length > 128) throw new RangeError("A driving HUD has at most 128 parts.");
  const ids = new Set<string>();
  const children: NodeDoc[] = o.parts.map((part) => {
    const { kind, id, x, y, w, h, ...props } = part;
    if (!id || ids.has(id)) throw new RangeError("Driving part ids are nonempty and unique.");
    ids.add(id);
    if (!(DRIVING_KINDS as readonly string[]).includes(kind)) throw new RangeError("Unknown driving kind.");
    if (![x, y].every((v) => Number.isInteger(v) && Math.abs(v) <= 8192) || !dimension(w) || !dimension(h)) throw new RangeError("A driving part has a bounded whole-pixel rectangle.");
    // Display-only instruments don't intercept input; controls use the normal UI action path.
    const instrument = kind === "speedometer" || kind === "tachometer" || kind === "combined";
    return { ...props, type: "driving", id, x, y, w, h, drivingKind: kind, drivingVariant: variant,
      ...(!instrument && props.action === undefined ? { action: id } : {}) };
  });
  const culture = cultureOf(String(o.culture ?? o.theme?.culture ?? "clean"));
  const theme = o.theme ?? generateTheme({ seed: o.seed ?? 1, culture, pins: o.pins ?? {} });
  const root: NodeDoc = { type: "canvas", id: "driving", w: W, h: H, children: [...children, ...(o.chrome ?? [])] };
  return { theme, screen: { screen: DRIVING_GENERATOR, theme: theme.recipe, root: o.overrides ? overrideDoc(root, o.overrides) : root } };
}

const finite = (v: number | undefined, fallback = 0): number => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const clamp = (v: number, low = 0, high = 1): number => Math.max(low, Math.min(high, v));
const maximum = (v: number | undefined, fallback: number): number => finite(v) > 0 ? v! : fallback;
const TAU = Math.PI * 2;

/** The normal paintNode path calls this; all loops are bounded by the visible dirty clip. */
export function paintDriving(n: UiNode, ctx: PaintContext): void {
  const { x, y, w, h } = n.rect;
  // Malformed manually-authored nodes cannot send the raster loops to infinity.
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || w > 16384 || h > 16384) return;
  const x0 = Math.max(0, Math.ceil(x), Math.ceil(ctx.clip.x0)), y0 = Math.max(0, Math.ceil(y), Math.ceil(ctx.clip.y0));
  const x1 = Math.min(ctx.layer.w, Math.ceil(x + w), Math.ceil(ctx.clip.x1)), y1 = Math.min(ctx.layer.h, Math.ceil(y + h), Math.ceil(ctx.clip.y1));
  if (x0 >= x1 || y0 >= y1) return;
  const p = n.props, pal = ctx.theme.palette, track = p.drivingVariant === "track", kind = p.drivingKind ?? "wheel";
  let seed = 2166136261;
  for (const c of `${ctx.theme.recipe.seed}/${n.id}`) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  const down = n.press || p.active || (kind === "wheel" ? Math.abs(finite(p.value)) > 0 : finite(p.value) > 0);
  const ink = p.disabled ? pal.ink[0]! : pal.ink[2]!, metal = pal.surface[track ? 4 : 3]!, shade = pal.surface[1]!;
  const accent = p.disabled ? pal.ink[0]! : pal.accent[2 + seed % 2]!, edge = pal.surface[5]!, dark = pal.surface[0]!;
  const lit = p.disabled ? shade : down ? accent : n.hover || n.focus ? pal.surface[4]! : metal, unit = Math.min(w, h);
  const pixel = (xx: number, yy: number, c: Rgba): void => { if (xx >= x0 && yy >= y0 && xx < x1 && yy < y1) ctx.layer.px[yy * ctx.layer.w + xx] = c; };
  const region = (a: number, b: number, ww: number, hh: number, paint: (xx: number, yy: number) => void): void => {
    for (let yy = Math.max(y0, Math.floor(b)); yy < Math.min(y1, Math.ceil(b + hh)); yy++)
      for (let xx = Math.max(x0, Math.floor(a)); xx < Math.min(x1, Math.ceil(a + ww)); xx++) paint(xx, yy);
  };
  const box = (a: number, b: number, ww: number, hh: number, r: number, c: Rgba): void => {
    if (ww <= 0 || hh <= 0) return;
    r = Math.max(0, Math.min(r, ww / 2, hh / 2));
    region(a, b, ww, hh, (xx, yy) => {
      const dx = Math.max(a + r - xx - 0.5, 0, xx + 0.5 - (a + ww - r));
      const dy = Math.max(b + r - yy - 0.5, 0, yy + 0.5 - (b + hh - r));
      if (dx * dx + dy * dy <= r * r) pixel(xx, yy, c);
    });
  };
  const ring = (cx: number, cy: number, outer: number, inner: number, c: Rgba, flatAngle?: number): void => {
    if (outer <= 0) return;
    region(cx - outer, cy - outer, outer * 2 + 1, outer * 2 + 1, (xx, yy) => {
      const dx = xx - cx, dy = yy - cy, d = dx * dx + dy * dy;
      if (d <= outer * outer && d >= inner * inner && (flatAngle === undefined || -dx * Math.sin(flatAngle) + dy * Math.cos(flatAngle) < outer * 0.79)) pixel(xx, yy, c);
    });
  };
  // A clipped distance-to-segment stroke, including huge/offscreen endpoints.
  const stroke = (a: number, b: number, c: number, d: number, width: number, colour: Rgba): void => {
    const r = Math.max(0.6, width / 2), dx = c - a, dy = d - b, length = dx * dx + dy * dy;
    region(Math.min(a, c) - r, Math.min(b, d) - r, Math.abs(dx) + r * 2 + 1, Math.abs(dy) + r * 2 + 1, (xx, yy) => {
      const t = length ? clamp(((xx - a) * dx + (yy - b) * dy) / length) : 0;
      if ((xx - a - t * dx) ** 2 + (yy - b - t * dy) ** 2 <= r * r) pixel(xx, yy, colour);
    });
  };
  const font = ctx.font(p.font ?? "small");
  // Direct immutable glyph coverage: no numeric-string layout or bitmap cache.
  const label = (text: string, cx: number, top: number, colour = ink, f: PixelFont = font, backing = false): void => {
    const s = text.slice(0, 40);
    let width = 0;
    for (const c of s) width += glyphOf(f, c.charCodeAt(0))?.adv ?? Math.ceil(f.size / 2);
    if (backing && s) box(cx - width / 2 - 2, top - 1, width + 4, f.lineHeight + 2, 1, dark);
    let pen = Math.round(cx - width / 2);
    for (const c of s) {
      const g = glyphOf(f, c.charCodeAt(0));
      if (!g) { pen += Math.ceil(f.size / 2); continue; }
      const topY = Math.round(top + f.ascent + g.oy), left = Math.round(pen + g.ox);
      for (let gy = Math.max(0, y0 - topY); gy < Math.min(g.h, y1 - topY); gy++)
        for (let gx = Math.max(0, x0 - left); gx < Math.min(g.w, x1 - left); gx++) if (g.bits[gy * g.w + gx]) pixel(left + gx, topY + gy, colour);
      pen += g.adv;
    }
  };
  const disc = (cx: number, cy: number, r: number, c: Rgba): void => ring(cx, cy, r, 0, c);
  const dial = (cx: number, cy: number, r: number, value: number, max: number, rpm: boolean, caption?: string, readout = true): void => {
    if (r < 2) return;
    disc(cx, cy, r, dark); ring(cx, cy, r - 1, Math.max(0, r - (track ? 3 : 2)), edge);
    disc(cx, cy, Math.max(0, r - 4), pal.surface[1]!);
    const from = Math.PI * 0.75, sweep = Math.PI * 1.5, red = clamp(finite(p.drivingRedline, 0.82));
    const v = clamp(value / max), ticks = rpm ? 8 : 6;
    ring(cx, cy, r - 5, Math.max(0, r - 7), shade);
    for (let i = 0; i <= ticks * 3; i++) {
      const share = i / (ticks * 3), a = from + sweep * share, major = i % 3 === 0;
      const outer = r - 5, inner = r - (major ? 10 : 7), c = rpm && share >= red ? pal.bad[3]! : major ? ink : metal;
      stroke(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner, cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, 1, c);
      if (r >= 40 && (i === 0 || i === ticks * 1.5 || i === ticks * 3)) label(String(Math.round(share * max / (rpm ? 1000 : 1))), cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14) - font.lineHeight / 2, c);
    }
    const a = from + sweep * v;
    stroke(cx - Math.cos(a) * r * 0.13, cy - Math.sin(a) * r * 0.13, cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72, track ? 2 : 1.5, rpm && v >= red ? pal.bad[3]! : accent);
    disc(cx, cy, Math.max(1, r * 0.07), ink);
    if (r >= 18) {
      label(caption ?? (rpm ? "RPM" : "KM/H"), cx, cy - r * 0.35, p.disabled ? ink : pal.ink[1]!);
      // The open bottom of the sweep keeps the digital readout off the scale labels.
      if (readout) label(rpm ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)), cx, cy + r * (r >= 40 ? 0.52 : 0.20), ink, ctx.font(p.font ?? (r >= 40 ? "title" : "body")), true);
    }
    if (track && r >= 25) for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) disc(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3), 1, dark);
  };
  if (kind === "wheel") {
    const cx = x + w / 2, cy = y + h / 2, r = unit * 0.46, a = clamp(finite(p.value), -1, 1) * 2.15;
    ring(cx, cy, r, r * 0.69, dark, track ? a : undefined);
    ring(cx, cy - 0.5, r - 1, r * 0.77, lit, track ? a : undefined);
    ring(cx, cy, r * 0.91, r * 0.84, shade, track ? a : undefined);
    for (const angle of [-Math.PI * 0.16, Math.PI * 1.16, Math.PI * 0.5]) {
      stroke(cx, cy, cx + Math.cos(angle + a) * r * 0.76, cy + Math.sin(angle + a) * r * 0.76, Math.max(2, r * 0.15), dark);
      stroke(cx, cy, cx + Math.cos(angle + a) * r * 0.72, cy + Math.sin(angle + a) * r * 0.72, Math.max(1, r * 0.08), metal);
    }
    if (track) {
      const c = Math.cos(a), s = Math.sin(a), by = r * 0.78;
      stroke(cx - r * 0.6 * c - by * s, cy - r * 0.6 * s + by * c, cx + r * 0.6 * c - by * s, cy + r * 0.6 * s + by * c, r * 0.18, lit);
    }
    disc(cx, cy, r * 0.25, dark); disc(cx, cy, r * 0.20, shade);
    stroke(cx - r * 0.1, cy, cx + r * 0.1, cy, Math.max(1, r * 0.05), accent);
    const mark = a - Math.PI / 2;
    stroke(cx + Math.cos(mark) * r * 0.79, cy + Math.sin(mark) * r * 0.79, cx + Math.cos(mark) * (r - 1), cy + Math.sin(mark) * (r - 1), Math.max(1, r * 0.05), accent);
  } else if (kind === "speedometer" || kind === "tachometer") {
    const rpm = kind === "tachometer", max = maximum(p.max, rpm ? 8000 : 240);
    dial(x + w / 2, y + h / 2, unit * 0.48, clamp(finite(p.value), 0, max), max, rpm, p.text);
  } else if (kind === "combined") {
    const speedMax = maximum(p.max, 240), rpmMax = maximum(p.secondaryMax, 8000);
    if (!track && w >= h * 1.5 && Math.min(h * 0.47, w * 0.245) >= 23) {
      const r = Math.min(h * 0.47, w * 0.245);
      dial(x + w * 0.25, y + h / 2, r, clamp(finite(p.value), 0, speedMax), speedMax, false, p.text);
      dial(x + w * 0.75, y + h / 2, r, clamp(finite(p.secondaryValue), 0, rpmMax), rpmMax, true, p.title);
    } else {
      const cx = x + w / 2, cy = y + h / 2, r = unit * 0.48;
      const rpm = clamp(finite(p.secondaryValue), 0, rpmMax);
      dial(cx, cy, r, rpm, rpmMax, true, "", false);
      const v = clamp(finite(p.value) / speedMax), from = Math.PI * 0.75;
      for (let i = 0; i < 32; i++) {
        const a = from + Math.PI * 1.5 * i / 31;
        stroke(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, cx + Math.cos(a) * r * 0.49, cy + Math.sin(a) * r * 0.49, 1, i / 31 <= v ? accent : dark);
      }
      if (r >= 18) {
        label(String(Math.round(clamp(finite(p.value), 0, speedMax))), cx, cy - r * 0.55, ink, ctx.font(p.font ?? (r >= 40 ? "title" : "body")), true);
        label(p.text ?? "KM/H", cx, cy - r * 0.02, pal.ink[1]!, font, true);
        label(`${p.title ?? "RPM"} ${(rpm / 1000).toFixed(1)}k`, cx, cy + r * 0.36, ink, font, true);
      }
    }
  } else if (kind === "accelerator" || kind === "brake") {
    const gas = kind === "accelerator", v = clamp(finite(p.value) / maximum(p.max, 1)), sink = v * Math.min(3, h * 0.06);
    const ww = w * (gas ? 0.46 : 0.84), hh = h * (gas ? 0.83 : 0.48), xx = x + (w - ww) / 2, yy = y + h * (gas ? 0.06 : 0.18) + sink;
    box(x + w * 0.43, yy + hh * 0.6, w * 0.14, h * 0.30, 1, shade);
    box(xx, yy + 2, ww, hh, track ? 2 : unit * 0.08, dark);
    box(xx, yy, ww, hh, track ? 2 : unit * 0.08, edge);
    box(xx + 1, yy + 1, ww - 2, hh - 2, track ? 1 : unit * 0.06, p.disabled ? shade : lit);
    if (gas) for (let i = 1; i <= 3; i++) box(xx + ww * i / 4 - 1, yy + hh * 0.14, Math.max(1, ww * 0.05), hh * 0.70, 1, dark);
    else for (let i = 1; i <= 4; i++) box(xx + ww * 0.1, yy + hh * i / 5, ww * 0.8, Math.max(1, hh * 0.045), 0, dark);
    if (track) for (let i = 0; i < 4; i++) disc(xx + ww * (i % 2 ? 0.84 : 0.16), yy + hh * (i < 2 ? 0.1 : 0.9), 1, dark);
  } else if (kind === "handbrake") {
    const bx = x + w * 0.35, by = y + h * 0.78, v = clamp(finite(p.value) / maximum(p.max, 1));
    const tx = x + w * (0.78 - v * 0.18), ty = y + h * (0.22 - v * 0.05);
    const baseY = y + h * 0.65, baseH = Math.max(font.lineHeight + 2, h * 0.28);
    box(x + w * 0.13, baseY, w * 0.74, baseH, unit * 0.06, edge);
    box(x + w * 0.13 + 1, baseY + 1, w * 0.74 - 2, baseH - 2, unit * 0.04, dark);
    stroke(bx, by, tx, ty, unit * 0.16, edge); stroke(bx, by, tx, ty, unit * 0.09, metal);
    stroke(tx, ty, tx - w * 0.20, ty + h * 0.15, unit * 0.28, dark);
    stroke(tx, ty, tx - w * 0.20, ty + h * 0.15, unit * 0.20, down ? accent : metal);
    if (unit >= 24) label("(P)", x + w * 0.5, baseY + (baseH - font.lineHeight) / 2, ink);
  } else if (kind === "boost") {
    box(x + w * 0.34, y + h * 0.06, w * 0.32, h * 0.12, 1, edge);
    box(x + w * 0.21, y + h * 0.18, w * 0.58, h * 0.70, unit * (track ? 0.06 : 0.16), dark);
    box(x + w * 0.24, y + h * 0.2, w * 0.52, h * 0.65, unit * (track ? 0.04 : 0.14), lit);
    stroke(x + w * 0.59, y + h * 0.29, x + w * 0.4, y + h * 0.5, unit * 0.06, ink);
    stroke(x + w * 0.4, y + h * 0.5, x + w * 0.60, y + h * 0.5, unit * 0.06, ink);
    stroke(x + w * 0.60, y + h * 0.5, x + w * 0.41, y + h * 0.70, unit * 0.06, ink);
    if (unit >= 28) label(p.text ?? "N2O", x + w / 2, y + h * 0.71, dark);
  } else {
    box(x + w * 0.16, y + h * 0.05, w * 0.68, h * 0.9, track ? unit * 0.04 : unit * 0.17, dark);
    box(x + w * 0.18, y + h * 0.06, w * 0.64, h * 0.86, track ? unit * 0.03 : unit * 0.15, edge);
    box(x + w * 0.22, y + h * 0.08, w * 0.56, h * 0.82, track ? unit * 0.02 : unit * 0.13, lit);
    const up = kind === "shift-up", cx = x + w / 2, cy = y + h * 0.42;
    stroke(cx - unit * 0.16, cy, cx + unit * 0.16, cy, Math.max(1, unit * 0.07), ink);
    if (up) stroke(cx, cy - unit * 0.16, cx, cy + unit * 0.16, Math.max(1, unit * 0.07), ink);
    if (unit >= 32) label(up ? "UP" : "DN", cx, y + h * 0.67, ink);
  }
}
