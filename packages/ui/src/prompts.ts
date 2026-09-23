// Input prompts drawn as the device's own glyphs: a keycap for a key, a
// coloured face button for a pad (Xbox letters, PlayStation's cross, circle,
// square and triangle drawn as shapes -- no font needed), a pill for a bumper,
// a trigger's tab, a stick, a d-pad with its arm lit. Takes the shape a
// controls layer describes (keel/controls' Glyph fits: label, shape, colour).

import { blendRect } from "./chrome.ts";
import { fromHex, rgba } from "./color.ts";
import type { Rgba } from "./color.ts";
import type { Bitmap } from "./bitmap.ts";
import { discInto, textInto, textWidth } from "./gauges.ts";
import type { PixelFont } from "./font.ts";
import { line, plot } from "./bitmap.ts";

export interface PromptGlyph {
  readonly label: string;
  readonly shape: "round" | "pill" | "trigger" | "key" | "stick" | "dpad";
  /** A face button's colour ("#3fbf3f"). */
  readonly colour?: string;
}

export interface PromptStyle {
  /** The cap's face, its rim, its label. */
  readonly face: Rgba;
  readonly rim: Rgba;
  readonly ink: Rgba;
  /** A lit colour (the d-pad's arm, a pressed look). */
  readonly lit: Rgba;
}

const DEFAULT: PromptStyle = { face: rgba(26, 32, 52), rim: rgba(150, 170, 210), ink: rgba(240, 244, 255), lit: rgba(255, 190, 70) };

/** How wide a prompt draws (px) at a font's size. */
export function promptWidth(g: PromptGlyph, font: PixelFont): number {
  const h = font.lineHeight + 3;
  if (g.shape === "round" || g.shape === "stick" || g.shape === "dpad") return h;
  return Math.max(h, textWidth(font, g.label) + 6);
}

/** One prompt with its top-left at (x, y); returns its width. */
export function promptInto(b: Bitmap, g: PromptGlyph, font: PixelFont, x: number, y: number, style: Partial<PromptStyle> = {}): number {
  const s = { ...DEFAULT, ...style };
  const h = font.lineHeight + 3, w = promptWidth(g, font);
  const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2), r = Math.floor(h / 2);
  const label = (c: Rgba): void => textInto(b, font, g.label, cx + 1, y + Math.floor((h - font.lineHeight) / 2) + 1, c, { align: "center" });
  switch (g.shape) {
    case "key": {
      blendRect(b, x, y, w, h, s.rim);
      blendRect(b, x + 1, y + 1, w - 2, h - 3, s.face);
      blendRect(b, x + 1, y + h - 2, w - 2, 1, mixDark(s.rim));
      label(s.ink);
      break;
    }
    case "pill": case "trigger": {
      const top = g.shape === "trigger" ? 3 : Math.min(3, r);
      for (let row = 0; row < h; row += 1) {
        const inset = g.shape === "trigger" ? Math.max(0, top - row) : Math.max(0, Math.abs(row - (h - 1) / 2) > h / 2 - 2 ? 1 : 0);
        blendRect(b, x + inset, y + row, w - inset * 2, 1, row === 0 || row === h - 1 ? s.rim : s.face);
        plot(b, x + inset, y + row, s.rim); plot(b, x + w - 1 - inset, y + row, s.rim);
      }
      label(s.ink);
      break;
    }
    case "round": {
      const face = g.colour ? fromHex(g.colour) : s.face;
      const ps = PS_SHAPES[g.label];
      discInto(b, cx, cy, r, s.rim);
      discInto(b, cx, cy, r - 1, ps ? s.face : face);
      if (ps) ps(b, cx, cy, Math.max(2, r - 3), face);
      else label(g.colour ? rgba(12, 14, 22) : s.ink);
      break;
    }
    case "stick": {
      discInto(b, cx, cy, r, s.rim);
      discInto(b, cx, cy, r - 1, s.face);
      discInto(b, cx, cy, Math.max(1, r - 3), mixDark(s.rim));
      label(s.ink);
      break;
    }
    case "dpad": {
      const t = Math.max(1, Math.floor(h / 3));
      blendRect(b, cx - Math.floor(t / 2), y, t, h, s.rim);
      blendRect(b, x, cy - Math.floor(t / 2), w, t, s.rim);
      const arm = DPAD_ARMS[g.label];
      if (arm) {
        const [dx, dy] = arm;
        blendRect(b, cx - Math.floor(t / 2) + dx * (r - 1), cy - Math.floor(t / 2) + dy * (r - 1), t, t, s.lit);
      }
      break;
    }
  }
  return w;
}

const mixDark = (c: Rgba): Rgba => rgba(Math.round((c & 255) * 0.45), Math.round(((c >>> 8) & 255) * 0.45), Math.round(((c >>> 16) & 255) * 0.45));

const DPAD_ARMS: Readonly<Record<string, readonly [number, number]>> = { "↑": [0, -1], "↓": [0, 1], "←": [-1, 0], "→": [1, 0] };

type Shape = (b: Bitmap, cx: number, cy: number, r: number, c: Rgba) => void;
/** PlayStation's face symbols as shapes. */
const PS_SHAPES: Readonly<Record<string, Shape>> = {
  "✕": (b, cx, cy, r, c) => { line(b, cx - r, cy - r, cx + r, cy + r, c); line(b, cx - r, cy + r, cx + r, cy - r, c); line(b, cx - r + 1, cy - r, cx + r, cy + r - 1, c); line(b, cx - r + 1, cy + r, cx + r, cy - r + 1, c); },
  "○": (b, cx, cy, r, c) => { for (let a = 0; a < 64; a += 1) { const t = (a / 64) * Math.PI * 2; plot(b, Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), c); } },
  "□": (b, cx, cy, r, c) => { line(b, cx - r, cy - r, cx + r, cy - r, c); line(b, cx - r, cy + r, cx + r, cy + r, c); line(b, cx - r, cy - r, cx - r, cy + r, c); line(b, cx + r, cy - r, cx + r, cy + r, c); },
  "△": (b, cx, cy, r, c) => { line(b, cx, cy - r, cx - r, cy + r - 1, c); line(b, cx, cy - r, cx + r, cy + r - 1, c); line(b, cx - r, cy + r - 1, cx + r, cy + r - 1, c); },
};

/** A row of prompts with their captions ("[A] SELECT  [B] BACK"), right- or left-aligned from x; returns its width. */
export function promptBarInto(b: Bitmap, items: readonly { readonly glyphs: readonly PromptGlyph[]; readonly text: string }[], font: PixelFont, x: number, y: number, o: { readonly align?: "left" | "right"; readonly ink?: Rgba; readonly outline?: Rgba; readonly style?: Partial<PromptStyle> } = {}): number {
  const ink = o.ink ?? rgba(220, 228, 245);
  const widthOf = (it: (typeof items)[number]): number => it.glyphs.reduce((a, g) => a + promptWidth(g, font) + 1, 0) + 3 + textWidth(font, it.text);
  const total = items.reduce((a, it) => a + widthOf(it), 0) + Math.max(0, items.length - 1) * 10;
  let pen = o.align === "right" ? x - total : x;
  for (const it of items) {
    for (const g of it.glyphs) pen += promptInto(b, g, font, pen, y, o.style) + 1;
    pen += 3;
    textInto(b, font, it.text, pen, y + 2, ink, o.outline !== undefined ? { outline: o.outline } : {});
    pen += textWidth(font, it.text) + 10;
  }
  return total;
}
