// Decals: the Pixel Marine's sprays, on a car. A decal is a small picture of
// INKS (up to four of the car's colours, never raw RGB) and tones, its alpha
// already dithered -- every texel is ink or nothing -- stamped on a PANEL at a
// rect of that panel's surface coordinate (keel/bake looks.ts: SlotDecal), so
// it rides the door through every direction, lit by the door's own shade.
//
// Each kind is PAINTED from its seed (a race number's roundel and digits, a
// sponsor's made-up wordmark, flame tongues, shark teeth, a bolt, a starburst,
// a checkered fade, a skull, stars, tribal strokes, a graffiti tag), so no two
// are the same. WHERE it goes is scored the way the marine picks a wall for its
// spray: how much of the panel the camera sees, how the ink stands off the
// panel's paint, how calm the panel is (no livery, no rust under it) -- the
// best free panel (or left-right pair) wins. And an IMAGE -- the token owner's
// own spray -- comes in the same way the marine's does: sized down, alpha
// dithered by Bayer, each texel the nearest ink by OKLab.

import { dcbrt, dcos, dhypot, dpow, dsin, oklch } from "@keel-engine/core";
import type { Decal } from "@keel-engine/bake";
import { clamp } from "./draws.ts";
import { drawsOf } from "./draws.ts";
import type { Car, CarDecal, Colour, Panel } from "./car.ts";
import { panelFace } from "./shapes.ts";

/** A decal placed on a panel: its picture, where on the panel's surface, flips, and the colours of its inks. */
export interface PlacedDecal {
  readonly kind: CarDecal["kind"] | "spray";
  readonly panel: Panel;
  readonly decal: Decal;
  readonly rect: readonly [number, number, number, number];
  readonly flipU: boolean;
  readonly flipV: boolean;
  readonly inks: readonly Colour[];
}

// ---------------------------------------------------------------- a canvas of inks

export interface Canvas { readonly w: number; readonly h: number; readonly t: Uint8Array }
export const canvas = (w: number, h: number): Canvas => ({ w, h, t: new Uint8Array(w * h * 4) });
/** Set a texel: ink 1..4 (0 clears), tone in 16ths of an entry, lit 0..255. */
export function put(c: Canvas, x: number, y: number, ink: number, tone = 0, lit = 230): void {
  const X = Math.floor(x), Y = Math.floor(y);
  if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) return;
  const o = (Y * c.w + X) * 4;
  c.t[o] = ink; c.t[o + 1] = clamp(128 + tone, 0, 255); c.t[o + 2] = lit; c.t[o + 3] = 255;
}
export const fillRect = (c: Canvas, x0: number, y0: number, x1: number, y1: number, ink: number, tone = 0): void => { for (let y = Math.floor(y0); y < y1; y += 1) for (let x = Math.floor(x0); x < x1; x += 1) put(c, x, y, ink, tone); };
function fillCircle(c: Canvas, cx: number, cy: number, r: number, ink: number, tone = 0): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y += 1) for (let x = Math.floor(cx - r); x <= cx + r; x += 1) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) put(c, x, y, ink, tone);
}
/** A filled polygon (even-odd scanline). */
function fillPoly(c: Canvas, pts: readonly (readonly [number, number])[], ink: number, tone = 0): void {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y += 1) {
    const yc = y + 0.5, xs: number[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]! - 0.5); x < xs[k + 1]! - 0.5; x += 1) put(c, x, y, ink, tone);
  }
}
/** A thick line (a disc stamped along it). */
function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, r: number, ink: number, tone = 0): void {
  const n = Math.max(1, Math.ceil(dhypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i += 1) fillCircle(c, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, ink, tone);
}
/** Grow every inked texel's neighbours by `ink` where they're clear (an outline). */
function outline(c: Canvas, ink: number, tone = 0): void {
  const had = c.t.slice();
  for (let y = 0; y < c.h; y += 1) for (let x = 0; x < c.w; x += 1) {
    if (had[(y * c.w + x) * 4]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < c.w && Y < c.h && had[(Y * c.w + X) * 4]) { put(c, x, y, ink, tone); break; }
    }
  }
}

// A 5x7 pixel font: digits and capitals (rows top to bottom, bits left to right).
export const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31], "3": [30, 1, 1, 14, 1, 1, 30], "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14], "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8], "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
};
/** Text in the pixel font at a scale; returns its width. `measure` only measures. */
export function text(c: Canvas | null, s: string, x: number, y: number, scale: number, ink: number, tone = 0, slant = 0): number {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch];
    if (g && c) g.forEach((row, ry) => { for (let rx = 0; rx < 5; rx += 1) if (row & (16 >> rx)) fillRect(c, cx + rx * scale + (6 - ry) * slant, y + ry * scale, cx + (rx + 1) * scale + (6 - ry) * slant, y + (ry + 1) * scale, ink, tone); });
    cx += 6 * scale;
  }
  return cx - x - scale;
}

// ---------------------------------------------------------------- the kinds, painted

type Painter = (c: Canvas, D: ReturnType<typeof drawsOf>, d: CarDecal) => void;
const PAINTERS: Readonly<Record<CarDecal["kind"], { aspect: number; directional: boolean; paint: Painter }>> = {
  number: { aspect: 1.25, directional: false, paint: (c, D, d) => {
    const cx = c.w / 2, cy = c.h / 2, r = c.h * 0.46;
    const shape = D.u("roundel");
    if (shape < 0.5) fillCircle(c, cx, cy, r, 1); else if (shape < 0.85) fillRect(c, cx - r * 1.15, cy - r, cx + r * 1.15, cy + r, 1); else { fillRect(c, cx - r * 1.2, cy - r * 0.9, cx + r * 1.2, cy + r * 0.9, 1); outline(c, 3); }
    const num = d.text.slice(1);
    const scale = Math.max(1, Math.floor((c.h * 0.62) / 7));
    const w = text(null, num, 0, 0, scale, 2);
    text(c, num, Math.round(cx - w / 2), Math.round(cy - 3.5 * scale), scale, 2, 0, D.u("italic") < 0.3 ? Math.max(1, scale / 3) : 0);
  } },
  sponsors: { aspect: 3.2, directional: false, paint: (c, D, d) => {
    const names = d.text.split(", ");
    const rows = names.length;
    const rowH = c.h / rows;
    names.forEach((name, i) => {
      const scale = Math.max(1, Math.floor((rowH * 0.72) / 7));
      const w = text(null, name, 0, 0, scale, 1);
      const x = Math.round((c.w - w) / 2), y = Math.round(i * rowH + (rowH - 7 * scale) / 2);
      if (D.u(`plate${i}`) < 0.5) { fillRect(c, x - scale * 2, y - scale, x + w + scale * 2, y + 8 * scale, 2); text(c, name, x, y, scale, 1); }
      else { text(c, name, x, y, scale, 1, 0, D.u(`slant${i}`) < 0.5 ? 1 : 0); fillRect(c, x, y + 7.5 * scale, x + w, y + 8.5 * scale, 2); }
    });
  } },
  flames: { aspect: 3, directional: true, paint: (c, D) => {
    // Tongues licking back from the front edge (x = w), their colour cooling with length.
    const tongues = 4 + Math.floor(D.u("n") * 4);
    for (let i = 0; i < tongues; i += 1) {
      const y0 = ((i + 0.5) / tongues) * c.h, len = c.w * (0.45 + D.u(`len${i}`) * 0.55), th = (c.h / tongues) * (0.8 + D.u(`th${i}`) * 0.6);
      for (let x = 0; x < len; x += 1) {
        const f = x / len, half = th * (1 - f) * 0.9 + 0.6;
        const y = y0 + dsin(f * 5 + D.u(`ph${i}`) * 6) * th * 0.6 * f;
        for (let dy = -half; dy <= half; dy += 1) put(c, c.w - 1 - x, y + dy, f < 0.3 ? 1 : f < 0.65 ? 2 : 3, 0, 180);
      }
    }
  } },
  teeth: { aspect: 2.2, directional: true, paint: (c, D) => {
    // A shark's mouth at the front edge: a dark jaw, white teeth top and bottom.
    const jaw: [number, number][] = [];
    for (let i = 0; i <= 16; i += 1) { const a = Math.PI * (0.5 + i / 16); jaw.push([c.w + c.w * 0.95 * dcos(a), c.h / 2 - c.h * 0.42 * dsin(a)]); }
    fillPoly(c, jaw, 2);
    const n = 5 + Math.floor(D.u("teeth") * 4);
    for (let i = 0; i < n; i += 1) {
      const x0 = c.w - ((i + 0.2) / n) * c.w * 0.9, x1 = c.w - ((i + 1) / n) * c.w * 0.9, len = c.h * (0.22 - i * 0.012);
      const top = (x: number) => c.h / 2 - c.h * 0.42 * Math.sqrt(Math.max(0, 1 - ((c.w - x) / (c.w * 0.95)) ** 2));
      fillPoly(c, [[x0, top(x0) - 1], [x1, top(x1) - 1], [(x0 + x1) / 2, top((x0 + x1) / 2) + len]], 1);
      fillPoly(c, [[x0, c.h - top(x0) + 1], [x1, c.h - top(x1) + 1], [(x0 + x1) / 2, c.h - top((x0 + x1) / 2) - len]], 1);
    }
    if (D.u("eye") < 0.6) fillCircle(c, c.w * 0.06 + 2, c.h * 0.2, c.h * 0.08, 2);
  } },
  bolt: { aspect: 3, directional: true, paint: (c, D) => {
    const j = (k: string) => (D.u(k) - 0.5) * c.h * 0.2;
    const pts: [number, number][] = [[0, c.h * 0.45 + j("a")], [c.w * 0.45, c.h * 0.2 + j("b")], [c.w * 0.42, c.h * 0.45], [c.w, c.h * 0.1 + j("c")], [c.w * 0.55, c.h * 0.8 + j("d")], [c.w * 0.58, c.h * 0.55], [0, c.h * 0.9]];
    fillPoly(c, pts, 1);
    outline(c, 2);
  } },
  starburst: { aspect: 1, directional: false, paint: (c, D) => {
    const cx = c.w / 2, cy = c.h * (0.5 + (D.u("cy") - 0.5) * 0.3), rays = 10 + 2 * Math.floor(D.u("rays") * 5);
    for (let i = 0; i < rays; i += 2) {
      const a0 = (i / rays) * Math.PI * 2, a1 = ((i + 1) / rays) * Math.PI * 2, R = c.w;
      fillPoly(c, [[cx, cy], [cx + R * dcos(a0), cy + R * dsin(a0)], [cx + R * dcos(a1), cy + R * dsin(a1)]], 1);
    }
    fillCircle(c, cx, cy, c.h * 0.16, 2);
  } },
  checkered: { aspect: 2.6, directional: true, paint: (c, D) => {
    // A checkered flag that breaks up toward the back: whole squares at the front, scattered at the rear.
    const sq = Math.max(2, Math.round(c.h / (3 + Math.floor(D.u("rows") * 3))));
    for (let gy = 0; gy * sq < c.h; gy += 1) for (let gx = 0; gx * sq < c.w; gx += 1) {
      const f = (gx * sq) / c.w;
      if (D.u(`k${gx}.${gy}`) > f * 1.3) fillRect(c, gx * sq, gy * sq, (gx + 1) * sq, (gy + 1) * sq, (gx + gy) % 2 ? 1 : 2);
    }
  } },
  skull: { aspect: 1.1, directional: false, paint: (c) => {
    const cx = c.w / 2, r = c.h * 0.34;
    fillCircle(c, cx, c.h * 0.4, r, 1);
    fillRect(c, cx - r * 0.6, c.h * 0.55, cx + r * 0.6, c.h * 0.88, 1);
    fillCircle(c, cx - r * 0.42, c.h * 0.42, r * 0.28, 2); fillCircle(c, cx + r * 0.42, c.h * 0.42, r * 0.28, 2);
    fillPoly(c, [[cx, c.h * 0.55], [cx - r * 0.15, c.h * 0.68], [cx + r * 0.15, c.h * 0.68]], 2);
    for (let i = -2; i <= 2; i += 1) fillRect(c, cx + i * r * 0.24 - 0.5, c.h * 0.76, cx + i * r * 0.24 + 0.5, c.h * 0.88, 2);
  } },
  stars: { aspect: 2, directional: false, paint: (c, D) => {
    const n = 3 + Math.floor(D.u("n") * 3);
    for (let i = 0; i < n; i += 1) {
      const cx = ((i + 0.5) / n) * c.w, cy = c.h * (0.3 + D.u(`y${i}`) * 0.4), R = c.h * (0.2 + D.u(`r${i}`) * 0.22), rot = D.u(`a${i}`);
      const pts: [number, number][] = [];
      for (let k = 0; k < 10; k += 1) { const a = rot + (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? R * 0.42 : R; pts.push([cx + rr * dcos(a), cy + rr * dsin(a)]); }
      fillPoly(c, pts, 1 + (i % 3));
    }
  } },
  tribal: { aspect: 3, directional: true, paint: (c, D) => {
    const strokes = 3 + Math.floor(D.u("n") * 3);
    for (let i = 0; i < strokes; i += 1) {
      const y = c.h * (0.2 + 0.6 * D.u(`y${i}`)), bend = (D.u(`b${i}`) - 0.5) * c.h * 0.9, len = c.w * (0.5 + D.u(`l${i}`) * 0.5);
      for (let x = 0; x < len; x += 1) { const f = x / len; line(c, c.w - x, y + bend * f * f, c.w - x - 1, y + bend * f * f, Math.max(0.5, (1 - f) * c.h * 0.09), 1); }
    }
  } },
  tag: { aspect: 2.8, directional: false, paint: (c, D, d) => {
    // Bubble letters, fat and bouncing, an outline, a highlight, drips.
    const scale = Math.max(1, Math.floor((c.h * 0.55) / 7));
    const w = text(null, d.text, 0, 0, scale, 1);
    const x0 = Math.round((c.w - w) / 2), y0 = Math.round(c.h * 0.2);
    [...d.text].forEach((ch, i) => { const bob = Math.round((D.u(`bob${i}`) - 0.5) * scale * 2); text(c, ch, x0 + i * 6 * scale, y0 + bob, scale, 1, 0, 1); text(c, ch, x0 + i * 6 * scale, y0 + bob + scale, scale, 1, 0, 1); });
    outline(c, 3); outline(c, 3);
    for (let i = 0; i < 4; i += 1) { const x = x0 + D.u(`drip${i}`) * w; for (let y = y0 + 8 * scale; y < y0 + 8 * scale + D.u(`dl${i}`) * c.h * 0.3; y += 1) put(c, x, y, 1); }
    for (let x = x0; x < x0 + w; x += 3) put(c, x, y0 + scale, 2);
  } },
};

// ---------------------------------------------------------------- placement, scored like a spray

const INK_COLOURS = (car: Car, name: CarDecal["inks"][number]): Colour[] => {
  const P = car.paints;
  switch (name) {
    case "accent": return [P.accent];
    case "alt": return [P.alt];
    case "body": return [P.body];
    case "white": return [{ light: 0.94, chroma: 0.01, hue: 90 }];
    case "black": return [{ light: 0.16, chroma: 0.01, hue: 260 }];
    case "gold": return [{ light: 0.78, chroma: 0.13, hue: 85 }];
    case "fire": return [{ light: 0.9, chroma: 0.16, hue: 95 }, { light: 0.7, chroma: 0.2, hue: 55 }, { light: 0.55, chroma: 0.21, hue: 30 }];
  }
};
const colourOfPanel = (car: Car, panel: Panel): Colour => car.paints.panels.find((p) => p.panel === panel)?.colour ?? car.paints.body;
/** What of a panel's face a decal may use (u0, v0, u1, v1): above the sill, clear of the wheel arches, the bonnet's flat. */
const USABLE: Readonly<Record<Panel, readonly [number, number, number, number]>> = {
  doorL: [0.08, 0.28, 0.92, 0.9], doorR: [0.08, 0.28, 0.92, 0.9], fenderFL: [0.12, 0.12, 0.88, 0.9], fenderFR: [0.12, 0.12, 0.88, 0.9],
  quarterL: [0.12, 0.12, 0.88, 0.9], quarterR: [0.12, 0.12, 0.88, 0.9], hood: [0.15, 0.12, 0.85, 0.55], trunk: [0.15, 0.1, 0.85, 0.6], roof: [0.1, 0.1, 0.9, 0.9],
  bumperF: [0.12, 0.15, 0.88, 0.85], bumperR: [0.12, 0.15, 0.88, 0.85],
};
const PAIRS: Readonly<Partial<Record<Panel, Panel>>> = { doorL: "doorR", doorR: "doorL", fenderFL: "fenderFR", fenderFR: "fenderFL", quarterL: "quarterR", quarterR: "quarterL" };

/** Every decal the car wears, painted and placed. */
/** A decal made elsewhere (a registered on-chain decal, an owner's or a sponsor's): its texels, its own inks, the panels it may go on. */
export interface ExtraDecal { readonly decal: Decal; readonly inks: readonly Colour[]; readonly panels?: readonly Panel[] }

const EXTRA_PANELS: readonly Panel[] = ["doorL", "doorR", "hood", "trunk"];

export function carDecals(car: Car, { pitch = 0.8, texelsPerMetre = 72, extra = [] }: { pitch?: number; texelsPerMetre?: number; extra?: readonly ExtraDecal[] } = {}): PlacedDecal[] {
  const used = new Set<Panel>();
  const out: PlacedDecal[] = [];
  // Extras first -- they were chosen by a person (and a sponsor paid for theirs) -- then the car's own kinds fill what's left.
  const items = [
    ...extra.map((x, i) => ({ kind: "spray" as const, seed: `${car.seed}|extra|${i}`, panels: x.panels ?? EXTRA_PANELS, extra: x })),
    ...car.decals.map((d) => ({ ...d, extra: null })),
  ];
  for (const d of items) {
    const art = d.extra ? { aspect: d.extra.decal.width / Math.max(1, d.extra.decal.height), directional: false, paint: null } : PAINTERS[d.kind as CarDecal["kind"]];
    const D = drawsOf(d.seed);
    const inks = d.extra ? d.extra.inks.slice(0, 4) : (d as CarDecal).inks.flatMap((n) => INK_COLOURS(car, n)).slice(0, 4);
    // The candidate groups: each panel with its pair, in the car's order of preference.
    const groups: Panel[][] = [];
    for (const p of d.panels) { if (groups.some((g) => g.includes(p))) continue; const q = PAIRS[p]; groups.push(q && d.panels.includes(q) ? [p, q] : [p]); }
    let best: Panel[] | null = null, bestScore = -1;
    groups.forEach((g, i) => {
      if (g.some((p) => used.has(p))) return;
      // (No roof to stick to on an open top, or a glass one; no boot lid on a pickup's tailgate for the sideways kinds.)
      if (g.includes("roof") && (car.parts.roof === "open" || car.parts.roof === "glass" || car.archetype === "buggy")) return;
      const f = panelFace(car, g[0]!);
      const u = USABLE[g[0]!];
      const seen = f.u * (u[2] - u[0]) * f.v * (u[3] - u[1]) * (f.face === "side" ? 1 : f.face === "top" ? dsin(pitch) : 0.35);
      const contrast = Math.min(1, Math.abs(colourOfPanel(car, g[0]!).light - (inks[0]?.light ?? 0.5)) / 0.4);
      const calm = (car.paints.livery !== "none" ? 0.7 : 1) * (car.paints.panels.some((pp) => g.includes(pp.panel) && pp.kind === "rust") ? 0.5 : 1);
      // (The car's own order breaks near ties: the first-listed panel is where this kind usually goes.)
      const score = seen * (0.35 + 0.65 * contrast) * (0.4 + 0.6 * calm) * (1 - i * 0.08) * (0.9 + 0.2 * D.u(`coin${i}`));
      if (score > bestScore) { bestScore = score; best = g; }
    });
    if (!best) continue;
    for (const panel of best as Panel[]) {
      const f = panelFace(car, panel);
      const u = USABLE[panel];
      // The rect: the kind's aspect fitted into the usable box (in metres), centred -- or pushed to the front for directional art.
      const boxW = f.u * (u[2] - u[0]), boxH = f.v * (u[3] - u[1]);
      const scale = d.kind === "flames" || d.kind === "checkered" || d.kind === "tribal" ? 1 : d.kind === "sponsors" ? 0.7 : 0.85;
      let w = boxW * scale, h = w / art.aspect;
      if (h > boxH * scale) { h = boxH * scale; w = h * art.aspect; }
      let picture: Decal;
      if (d.extra) picture = d.extra.decal;
      else {
        const tw = Math.max(12, Math.min(128, Math.round(w * texelsPerMetre))), th = Math.max(8, Math.min(96, Math.round(h * texelsPerMetre)));
        const c = canvas(tw, th);
        art.paint!(c, D, d as CarDecal);
        picture = { width: tw, height: th, texels: c.t };
      }
      const cu = art.directional && f.face === "side" ? u[2] - w / f.u / 2 - 0.02 : (u[0] + u[2]) / 2;
      const cv = (u[1] + u[3]) / 2;
      const hu = w / f.u / 2, hv = h / f.v / 2;
      // (Directional art runs toward the front on both sides; everything else reads from outside.)
      const flipU = art.directional && f.face === "side" ? !f.uFront : f.readU;
      const rect: [number, number, number, number] = [clamp(cu - hu, 0, 1), clamp(cv - hv, 0, 1), clamp(cu + hu, 0, 1), clamp(cv + hv, 0, 1)];
      // (A flipped u mirrors the rect too: the shader flips the coordinate before it looks the rect up.)
      const r: [number, number, number, number] = flipU ? [1 - rect[2], rect[1], 1 - rect[0], rect[3]] : rect;
      out.push({ kind: d.kind, panel, decal: picture, rect: f.readV ? [r[0], 1 - r[3], r[2], 1 - r[1]] : r, flipU, flipV: f.readV, inks });
      used.add(panel);
    }
  }
  return out;
}

/**
 * The owner's spray as a decal, the marine's way (keel-pixel-pfps src/pack/spray-decal.js): the picture sized down
 * to at most `size` texels, alpha dithered by a 4x4 Bayer screen (never smoothed), each kept texel the nearest of
 * `inks` in OKLab, its tone the lightness left over. rgba is w x h x 4.
 */
export function sprayDecal(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, inks: readonly Colour[], size = 64): Decal {
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const s = Math.min(1, size / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  const c = canvas(tw, th);
  const lab = inks.map((k) => { const [r, g, b] = oklch(k.light, k.chroma, k.hue); return toLab(r, g, b); });
  for (let y = 0; y < th; y += 1) for (let x = 0; x < tw; x += 1) {
    const from = (Math.floor((y * h) / th) * w + Math.floor((x * w) / tw)) * 4;
    if (rgba[from + 3]! <= BAYER[(y % 4) * 4 + (x % 4)]! * 16) continue;
    const p = toLab(rgba[from]!, rgba[from + 1]!, rgba[from + 2]!);
    let bi = 0, bd = Infinity;
    lab.forEach((q, i) => { const e = (p[0] - q[0]) ** 2 * 0.5 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (e < bd) { bd = e; bi = i; } });
    put(c, x, y, bi + 1, Math.round((p[0] - lab[bi]![0]) * 40), 150);
  }
  return { width: tw, height: th, texels: c.t };
}
function toLab(r8: number, g8: number, b8: number): [number, number, number] {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : dpow((c + 0.055) / 1.055, 2.4); };
  const r = lin(r8), g = lin(g8), b = lin(b8);
  const l = dcbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = dcbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = dcbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
