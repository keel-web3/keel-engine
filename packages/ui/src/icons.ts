// Generative pixel icons. An icon is a semantic NAME (attack, move, stop,
// build, upgrade, supply, mass, energy...) drawn from a small shape grammar:
// primitives (bars, discs, rings, polygons, strokes, stars, gears, arrows)
// composed by per-name recipes with a few seeded choices each (which sword,
// how long the blade, which way it faces, a crossed pair or one). The mask is
// rasterised crisp at the exact pixel size, then shaded like pixel art --
// outline outside, highlight on the top-left edges, shade on the bottom-right
// -- and painted in the theme's ramps in its icon style (solid, outline or
// duotone). A theme's seed picks the variants, so one race's icons are a set.
//
//   iconBitmap("attack", 16, theme)                 // themed, cached by the UI atlas
//   ICON_NAMES                                      // what the grammar knows

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import { createBitmap } from "./bitmap.ts";
import type { Bitmap } from "./bitmap.ts";
import { contrast, fromOklch, luminance, oklab, rgba } from "./color.ts";
import type { Rgba } from "./color.ts";
import { familyMask } from "./iconfamily.ts";
import type { IconFamily } from "./iconfamily.ts";
import { ellipse } from "./raster.ts";
import type { Contour } from "./raster.ts";
import type { Ramp, Theme } from "./theme.ts";

type P = readonly [number, number];
/** One step of a recipe: add a shape's pixels, or cut them away. */
interface Op { readonly cut?: boolean; readonly shape: Contour[] }
type Recipe = (S: Stream, w: number) => Op[];

// Primitives, in a unit square (y down).
const poly = (...pts: P[]): Contour => pts.flatMap(([x, y]) => [x, y]);
const rect = (x0: number, y0: number, x1: number, y1: number): Contour => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const disc = (cx: number, cy: number, r: number, ry = r): Contour => ellipse(cx, cy, r, ry, 40);
function seg(x0: number, y0: number, x1: number, y1: number, w: number): Contour {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
  return poly([x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]);
}
const strokes = (pts: readonly P[], w: number, closed = false): Contour[] => {
  const out: Contour[] = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) { const a = pts[i]!, b = pts[(i + 1) % n]!; out.push(seg(a[0], a[1], b[0], b[1], w)); }
  for (const p of pts) out.push(disc(p[0], p[1], w / 2));
  return out;
};
function star(cx: number, cy: number, r0: number, r1: number, n: number, rot = -Math.PI / 2): Contour {
  const pts: P[] = [];
  for (let i = 0; i < n * 2; i += 1) { const a = rot + (i * Math.PI) / n; const r = i % 2 ? r1 : r0; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return poly(...pts);
}
function gear(cx: number, cy: number, r: number, teeth: number, depth: number): Contour {
  const pts: P[] = [];
  const steps = teeth * 4;
  for (let i = 0; i < steps; i += 1) { const a = (i / steps) * Math.PI * 2; const rr = i % 4 < 2 ? r : r - depth; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
  return poly(...pts);
}
const arrowHead = (tipX: number, tipY: number, dirX: number, dirY: number, size: number): Contour => {
  const l = Math.hypot(dirX, dirY) || 1, ux = dirX / l, uy = dirY / l;
  return poly([tipX, tipY], [tipX - ux * size - uy * size * 0.8, tipY - uy * size + ux * size * 0.8], [tipX - ux * size + uy * size * 0.8, tipY - uy * size - ux * size * 0.8]);
};
const add = (...shape: Contour[]): Op => ({ shape });
const cut = (...shape: Contour[]): Op => ({ cut: true, shape });
const mirror = (ops: Op[]): Op[] => ops.map((o) => ({ ...o, shape: o.shape.map((c) => c.map((v, i) => (i % 2 ? v : 1 - v))) }));

function sword(S: Stream, w: number, flip: boolean): Op[] {
  const len = S.between(0.62, 0.78);
  const bw = w * S.between(1.2, 1.6);
  const tip: P = [0.86, 0.14];
  const hilt: P = [tip[0] - len * 0.7071, tip[1] + len * 0.7071];
  const guard = S.between(0.14, 0.22);
  const ops = [
    add(seg(hilt[0], hilt[1], tip[0] - 0.03, tip[1] + 0.03, bw), poly([tip[0], tip[1]], [tip[0] - 0.12, tip[1] + 0.03], [tip[0] - 0.03, tip[1] + 0.12])),
    add(seg(hilt[0] - guard * 0.7071, hilt[1] - guard * 0.7071, hilt[0] + guard * 0.7071, hilt[1] + guard * 0.7071, w * 1.3)),
    add(seg(hilt[0], hilt[1], hilt[0] - 0.16, hilt[1] + 0.16, w * 1.1), disc(hilt[0] - 0.18, hilt[1] + 0.18, w * 0.9)),
  ];
  return flip ? mirror(ops) : ops;
}

/** The grammar: each name's variants, and the ramp it is painted in. */
export const ICON_RECIPES: Readonly<Record<string, { readonly tone: string; readonly variants: readonly Recipe[] }>> = {
  attack: { tone: "bad", variants: [
    (S, w) => sword(S, w, S.chance(0.5)),
    (S, w) => [...sword(S, w, false), ...sword(S, w, true)],
    (S, w) => { const r = S.between(0.28, 0.34); return [add(...strokes([[0.5, 0.08], [0.5, 0.3]], w), ...strokes([[0.5, 0.7], [0.5, 0.92]], w), ...strokes([[0.08, 0.5], [0.3, 0.5]], w), ...strokes([[0.7, 0.5], [0.92, 0.5]], w), disc(0.5, 0.5, r)), cut(disc(0.5, 0.5, r - w)), add(disc(0.5, 0.5, w * 0.7))]; },
  ] },
  move: { tone: "good", variants: [
    (S, w) => { const t = S.between(0.2, 0.3); return [add(seg(0.18, 0.82, 0.72, 0.28, w * 1.4), arrowHead(0.86, 0.14, 1, -1, t + 0.1))]; },
    (S, w) => [add(...strokes([[0.18, 0.2], [0.46, 0.5], [0.18, 0.8]], w * 1.4)), add(...strokes([[0.5, 0.2], [0.78, 0.5], [0.5, 0.8]], w * 1.4))],
    (S, w) => { const h = S.between(0.14, 0.2); return [add(seg(0.5, 0.18, 0.5, 0.82, w * 1.2), seg(0.18, 0.5, 0.82, 0.5, w * 1.2), arrowHead(0.5, 0.06, 0, -1, h), arrowHead(0.5, 0.94, 0, 1, h), arrowHead(0.06, 0.5, -1, 0, h), arrowHead(0.94, 0.5, 1, 0, h))]; },
  ] },
  stop: { tone: "bad", variants: [
    (S) => { const r = S.between(0.4, 0.44); return [add(star(0.5, 0.5, r, r, 4, Math.PI / 8))]; },
    (S) => { const m = S.between(0.14, 0.2); return [add(rect(m, m, 1 - m, 1 - m))]; },
  ] },
  hold: { tone: "accent", variants: [
    (S) => { const n = S.between(0.62, 0.72); return [add(poly([0.14, 0.14], [0.86, 0.14], [0.86, n - 0.1], [0.5, 0.92], [0.14, n - 0.1]))]; },
    (S, w) => [add(rect(0.2, 0.44, 0.8, 0.88), ...strokes([[0.32, 0.46], [0.32, 0.28], [0.5, 0.12], [0.68, 0.28], [0.68, 0.46]], w * 1.2))],
  ] },
  patrol: { tone: "accent", variants: [
    (S, w) => [add(seg(0.14, 0.34, 0.74, 0.34, w * 1.3), arrowHead(0.9, 0.34, 1, 0, 0.2), seg(0.26, 0.68, 0.86, 0.68, w * 1.3), arrowHead(0.1, 0.68, -1, 0, 0.2))],
    (S, w) => [add(disc(0.5, 0.5, 0.38)), cut(disc(0.5, 0.5, 0.38 - w * 1.4), rect(0.5, 0, 1, 0.5)), add(arrowHead(0.5 + 0.38 - w * 0.7, 0.62, 0, -1, 0.22))],
  ] },
  build: { tone: "warn", variants: [
    (S, w) => { const h = S.between(0.18, 0.24); return [add(seg(0.24, 0.86, 0.62, 0.36, w * 1.4)), add(poly([0.38, 0.28], [0.62, 0.06], [0.94, 0.38], [0.72, 0.6]), seg(0.46, 0.2, 0.46 - h, 0.2 - h * 0.2, w))]; },
    (S, w) => [add(seg(0.2, 0.82, 0.6, 0.42, w * 1.6), disc(0.68, 0.32, 0.22)), cut(poly([0.68, 0.32], [0.95, 0.1], [0.95, 0.4]), disc(0.2, 0.82, w * 0.4))],
    () => [add(rect(0.08, 0.2, 0.46, 0.44), rect(0.54, 0.2, 0.92, 0.44), rect(0.08, 0.52, 0.28, 0.76), rect(0.36, 0.52, 0.64, 0.76), rect(0.72, 0.52, 0.92, 0.76))],
  ] },
  upgrade: { tone: "good", variants: [
    (S, w) => [add(rect(0.36, 0.44, 0.64, 0.9), poly([0.5, 0.08], [0.9, 0.5], [0.1, 0.5]))],
    (S, w) => [add(...strokes([[0.16, 0.5], [0.5, 0.2], [0.84, 0.5]], w * 1.6)), add(...strokes([[0.16, 0.82], [0.5, 0.52], [0.84, 0.82]], w * 1.6))],
    (S, w) => [add(star(0.44, 0.52, 0.4, 0.18, 5)), add(seg(0.8, 0.08, 0.8, 0.34, w), seg(0.67, 0.21, 0.93, 0.21, w))],
  ] },
  supply: { tone: "warn", variants: [
    (S) => { const r = S.between(0.4, 0.5); return [add(poly([0.5, 0.08], [0.92, r], [0.8, r], [0.8, 0.9], [0.2, 0.9], [0.2, r], [0.08, r])), cut(rect(0.42, 0.62, 0.58, 0.9))]; },
    () => [add(disc(0.5, 0.28, 0.18), poly([0.16, 0.92], [0.2, 0.6], [0.36, 0.5], [0.64, 0.5], [0.8, 0.6], [0.84, 0.92]))],
    (S, w) => [add(rect(0.12, 0.18, 0.88, 0.86)), cut(rect(0.12 + w, 0.18 + w, 0.88 - w, 0.86 - w)), add(seg(0.12, 0.18, 0.88, 0.86, w), seg(0.88, 0.18, 0.12, 0.86, w))],
  ] },
  resource: { tone: "accent", variants: [
    (S) => { const t = S.between(0.3, 0.4); return [add(poly([0.5, 0.06], [0.88, t], [0.5, 0.94], [0.12, t]))]; },
    () => [add(poly([0.3, 0.9], [0.22, 0.4], [0.36, 0.12], [0.5, 0.4], [0.46, 0.9]), poly([0.5, 0.9], [0.56, 0.3], [0.7, 0.06], [0.82, 0.32], [0.76, 0.9]))],
  ] },
  mass: { tone: "accent", variants: [
    () => [add(poly([0.5, 0.08], [0.9, 0.28], [0.9, 0.72], [0.5, 0.92], [0.1, 0.72], [0.1, 0.28]))],
    () => [add(poly([0.2, 0.36], [0.8, 0.36], [0.94, 0.76], [0.06, 0.76]))],
  ] },
  energy: { tone: "warn", variants: [
    (S) => { const k = S.between(0.44, 0.54); return [add(poly([0.62, 0.04], [0.2, k + 0.06], [0.48, k + 0.06], [0.36, 0.96], [0.82, k - 0.08], [0.54, k - 0.08]))]; },
    (S, w) => [add(disc(0.5, 0.5, 0.22), disc(0.5, 0.5, 0.44, 0.2)), cut(disc(0.5, 0.5, 0.44 - w, 0.2 - w)), add(disc(0.5, 0.5, 0.22))],
  ] },
  biomass: { tone: "good", variants: [
    (S, w) => [add(poly([0.14, 0.86], [0.2, 0.4], [0.5, 0.14], [0.9, 0.1], [0.84, 0.5], [0.6, 0.8])), cut(seg(0.2, 0.8, 0.7, 0.3, w * 0.8))],
    () => [add(poly([0.5, 0.06], [0.78, 0.5], [0.7, 0.8], [0.5, 0.92], [0.3, 0.8], [0.22, 0.5]), disc(0.5, 0.64, 0.28))],
  ] },
  salvage: { tone: "ink", variants: [
    (S, w) => { const t = S.pick([6, 7, 8]); return [add(gear(0.5, 0.5, 0.46, t, 0.12)), cut(disc(0.5, 0.5, 0.14))]; },
    () => [add(star(0.5, 0.5, 0.44, 0.44, 3, Math.PI / 2)), cut(disc(0.5, 0.5, 0.14))],
  ] },
  gather: { tone: "warn", variants: [
    (S, w) => [add(seg(0.22, 0.88, 0.62, 0.36, w * 1.3)), add(...strokes([[0.18, 0.3], [0.48, 0.14], [0.66, 0.2], [0.84, 0.44]], w * 1.5))],
  ] },
  repair: { tone: "good", variants: [
    (S, w) => [add(seg(0.2, 0.82, 0.6, 0.42, w * 1.6), disc(0.68, 0.32, 0.22)), cut(poly([0.68, 0.32], [0.95, 0.1], [0.95, 0.4]))],
    (S) => { const t = S.between(0.14, 0.18); return [add(rect(0.5 - t, 0.12, 0.5 + t, 0.88), rect(0.12, 0.5 - t, 0.88, 0.5 + t))]; },
  ] },
  cancel: { tone: "bad", variants: [(S, w) => [add(seg(0.16, 0.16, 0.84, 0.84, w * 1.8), seg(0.84, 0.16, 0.16, 0.84, w * 1.8))]] },
  rally: { tone: "accent", variants: [
    (S, w) => [add(seg(0.24, 0.08, 0.24, 0.94, w * 1.2), poly([0.24, 0.1], [0.86, 0.26], [0.24, 0.5]))],
    (S, w) => [add(seg(0.24, 0.08, 0.24, 0.94, w * 1.2), poly([0.24, 0.1], [0.84, 0.1], [0.7, 0.28], [0.84, 0.46], [0.24, 0.46]))],
  ] },
  research: { tone: "accent", variants: [
    () => [add(poly([0.38, 0.08], [0.62, 0.08], [0.62, 0.36], [0.9, 0.9], [0.1, 0.9], [0.38, 0.36]))],
    (S, w) => [add(rect(0.14, 0.14, 0.86, 0.86)), cut(seg(0.5, 0.2, 0.5, 0.86, w)), cut(rect(0.14 + w, 0.26, 0.44, 0.3), rect(0.56, 0.26, 0.86 - w, 0.3))],
  ] },
  train: { tone: "ink", variants: [
    () => [add(disc(0.5, 0.26, 0.18), poly([0.18, 0.92], [0.24, 0.56], [0.5, 0.46], [0.76, 0.56], [0.82, 0.92]))],
    (S, w) => [add(disc(0.5, 0.56, 0.36), rect(0.1, 0.56, 0.9, 0.7)), cut(rect(0, 0.7, 1, 1), rect(0.34, 0.5, 0.66, 0.6))],
  ] },
  ability: { tone: "accent", variants: [
    (S) => { const n = S.pick([4, 5, 6]); return [add(star(0.5, 0.5, 0.46, S.between(0.16, 0.24), n))]; },
    (S, w) => [add(poly([0.5, 0.06], [0.9, 0.5], [0.5, 0.94], [0.1, 0.5])), cut(poly([0.5, 0.06 + w * 2], [0.9 - w * 2, 0.5], [0.5, 0.94 - w * 2], [0.1 + w * 2, 0.5])), add(seg(0.5, 0.26, 0.5, 0.74, w))],
  ] },
  vision: { tone: "ink", variants: [
    (S, w) => [add(disc(0.5, 0.5, 0.46, 0.26)), cut(disc(0.5, 0.5, 0.46 - w, 0.26 - w)), add(disc(0.5, 0.5, 0.14))],
  ] },
  cloak: { tone: "dim", variants: [
    (S, w) => [add(disc(0.5, 0.5, 0.46, 0.26)), cut(disc(0.5, 0.5, 0.46 - w, 0.26 - w)), add(disc(0.5, 0.5, 0.14), seg(0.14, 0.86, 0.86, 0.14, w))],
  ] },
  scan: { tone: "good", variants: [
    (S, w) => [add(disc(0.5, 0.5, 0.44)), cut(disc(0.5, 0.5, 0.44 - w)), add(disc(0.5, 0.5, 0.22)), cut(disc(0.5, 0.5, 0.22 - w)), add(seg(0.5, 0.5, 0.82, 0.2, w), disc(0.5, 0.5, w))],
  ] },
  armor: { tone: "ink", variants: [
    () => [add(poly([0.14, 0.14], [0.86, 0.14], [0.86, 0.52], [0.5, 0.92], [0.14, 0.52]))],
    (S, w) => [add(poly([0.14, 0.14], [0.86, 0.14], [0.86, 0.52], [0.5, 0.92], [0.14, 0.52])), cut(seg(0.5, 0.14, 0.5, 0.92, w * 0.8))],
  ] },
  damage: { tone: "bad", variants: [
    (S) => { const n = S.pick([7, 8, 9]); return [add(star(0.5, 0.5, 0.48, S.between(0.2, 0.28), n, S.between(0, 1)))]; },
  ] },
  speed: { tone: "good", variants: [
    (S, w) => [add(poly([0.08, 0.16], [0.46, 0.5], [0.08, 0.84], [0.22, 0.5])), add(poly([0.46, 0.16], [0.9, 0.5], [0.46, 0.84], [0.6, 0.5]))],
  ] },
  range: { tone: "accent", variants: [
    (S, w) => [add(disc(0.5, 0.5, 0.46)), cut(disc(0.5, 0.5, 0.46 - w)), add(disc(0.5, 0.5, 0.3)), cut(disc(0.5, 0.5, 0.3 - w)), add(disc(0.5, 0.5, 0.12))],
  ] },
  health: { tone: "good", variants: [
    () => [add(poly([0.5, 0.9], [0.08, 0.46], [0.08, 0.26], [0.26, 0.1], [0.5, 0.26], [0.74, 0.1], [0.92, 0.26], [0.92, 0.46]))],
    (S) => { const t = S.between(0.14, 0.18); return [add(rect(0.5 - t, 0.12, 0.5 + t, 0.88), rect(0.12, 0.5 - t, 0.88, 0.5 + t))]; },
  ] },
  timer: { tone: "ink", variants: [
    (S, w) => [add(disc(0.5, 0.54, 0.4)), cut(disc(0.5, 0.54, 0.4 - w)), add(seg(0.5, 0.54, 0.5, 0.3, w), seg(0.5, 0.54, 0.68, 0.62, w), rect(0.4, 0.04, 0.6, 0.12))],
  ] },
  // (Three bars, never so heavy they run together: each at most a sixth of the square.)
  menu: { tone: "ink", variants: [(S, w0) => { const w = Math.min(w0, 0.12); return [add(rect(0.14, 0.16, 0.86, 0.16 + w * 1.4), rect(0.14, 0.5 - w * 0.7, 0.86, 0.5 + w * 0.7), rect(0.14, 0.84 - w * 1.4, 0.86, 0.84))]; }] },
  settings: { tone: "ink", variants: [(S, w) => [add(gear(0.5, 0.5, 0.46, 8, 0.12)), cut(disc(0.5, 0.5, 0.16))]] },
  alert: { tone: "warn", variants: [(S, w) => [add(poly([0.5, 0.06], [0.95, 0.9], [0.05, 0.9])), cut(seg(0.5, 0.34, 0.5, 0.62, w * 1.2), disc(0.5, 0.76, w * 0.7))]] },
  worker: { tone: "warn", variants: [
    (S) => [add(disc(0.5, 0.6, 0.38)), cut(rect(0, 0.62, 1, 1)), add(rect(0.06, 0.58, 0.94, 0.7), rect(0.42, 0.14, 0.58, 0.26))],
    (S, w) => [add(seg(0.22, 0.88, 0.62, 0.36, w * 1.3)), add(...strokes([[0.18, 0.3], [0.48, 0.14], [0.66, 0.2], [0.84, 0.44]], w * 1.5))],
  ] },
  unload: { tone: "ink", variants: [(S, w) => [add(rect(0.12, 0.62, 0.88, 0.9), seg(0.5, 0.08, 0.5, 0.44, w * 1.5), arrowHead(0.5, 0.58, 0, 1, 0.22))]] },
  load: { tone: "ink", variants: [(S, w) => [add(rect(0.12, 0.62, 0.88, 0.9), seg(0.5, 0.22, 0.5, 0.58, w * 1.5), arrowHead(0.5, 0.06, 0, -1, 0.22))]] },
  "attack-move": { tone: "bad", variants: [
    (S, w) => [...sword(S, w * 0.9, false).map((o) => ({ ...o, shape: o.shape.map((c) => c.map((v, i) => (i % 2 ? v * 0.72 : v * 0.72 + 0.28))) })), add(seg(0.1, 0.9, 0.34, 0.66, w * 1.2), arrowHead(0.08, 0.92, -1, 1, 0.16))],
  ] },
  crystal: { tone: "accent", variants: [
    () => [add(poly([0.3, 0.9], [0.22, 0.4], [0.36, 0.12], [0.5, 0.4], [0.46, 0.9]), poly([0.5, 0.9], [0.56, 0.3], [0.7, 0.06], [0.82, 0.32], [0.76, 0.9]))],
  ] },
  flux: { tone: "accent", variants: [
    (S, w) => [add(disc(0.5, 0.5, 0.24), disc(0.5, 0.5, 0.46, 0.18)), cut(disc(0.5, 0.5, 0.46 - w, 0.18 - w)), add(disc(0.5, 0.5, 0.24))],
  ] },
  pause: { tone: "ink", variants: [(S) => [add(rect(0.2, 0.14, 0.42, 0.86), rect(0.58, 0.14, 0.8, 0.86))]] },
  play: { tone: "ink", variants: [() => [add(poly([0.2, 0.1], [0.86, 0.5], [0.2, 0.9]))]] },
  close: { tone: "ink", variants: [(S, w) => [add(seg(0.2, 0.2, 0.8, 0.8, w * 1.5), seg(0.8, 0.2, 0.2, 0.8, w * 1.5))]] },
  check: { tone: "good", variants: [(S, w) => [add(...strokes([[0.14, 0.52], [0.4, 0.78], [0.86, 0.22]], w * 1.6))]] },
  chat: { tone: "ink", variants: [() => [add(rect(0.1, 0.14, 0.9, 0.66), poly([0.26, 0.6], [0.5, 0.6], [0.22, 0.9]))]] },
  ping: { tone: "warn", variants: [(S, w) => [add(disc(0.5, 0.4, 0.3), poly([0.24, 0.5], [0.5, 0.94], [0.76, 0.5])), cut(disc(0.5, 0.4, 0.12))]] },
};

export const ICON_NAMES: readonly string[] = Object.keys(ICON_RECIPES);

export interface IconOptions {
  /** Picks each name's variant and its small choices (default: the theme's seed). */
  readonly seed?: string | number;
  /** A ramp name ("accent", "good", "team2"...) instead of the name's own. */
  readonly tone?: string;
  /** Force the variant. */
  readonly variant?: number;
  readonly style?: "solid" | "outline" | "duotone";
  /** The family it's drawn in (default: the theme's culture; "plain" for the grammar's own drawing). */
  readonly family?: IconFamily;
  /** What it's drawn over (a button's face): every colour of its shape is kept at least 3:1 off it. */
  readonly on?: Rgba;
}

/** A colour moved in lightness (same hue) until it is `min`:1 off `on` -- away from it first, then the other way. */
export function awayFrom(c: Rgba, on: Rgba, min = 3): Rgba {
  if (contrast(c, on) >= min) return c;
  const [L, a, b] = oklab(c);
  const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180) / Math.PI;
  const go = (dir: number): Rgba | null => { for (let l = L + dir * 0.01; l >= 0 && l <= 1; l += dir * 0.01) { const x = fromOklch(l, C * (1 - Math.abs(l - L)), h); if (contrast(x, on) >= min) return x; } return null; };
  const up = luminance(c) >= luminance(on);
  return go(up ? 1 : -1) ?? go(up ? -1 : 1) ?? (luminance(on) > 0.18 ? rgba(0, 0, 0) : rgba(255, 255, 255));
}

/**
 * An icon's 1-bit mask at `size` (no outline room: the shape spans the square), drawn in a `family` (iconfamily.ts:
 * "plain" -- the grammar's own drawing -- or a culture's: industrial, organic, crystalline, arcane, brutal, clean).
 */
export function iconMask(name: string, size: number, seed: string | number = 0, variant?: number, strokeScale = 1, family: IconFamily = "plain"): Uint8Array {
  const r = ICON_RECIPES[name];
  if (!r) throw new RangeError(`No icon "${name}" (known: ${ICON_NAMES.join(", ")}).`);
  // (The same stream for every weight a family asks for: the same choices -- which sword, how long -- every time.)
  const draw = (k: number): Op[] => {
    const S = stream(createRoll(deriveSeed(String(seed), `ui/icon/${name}`)), 0);
    const v = variant ?? S.int(0, r.variants.length - 1);
    return r.variants[v % r.variants.length]!(S, w * k);
  };
  const w = Math.max(1.1 / size, (strokeScale * Math.max(1, Math.round(size / 10))) / size);
  return familyMask(family, draw, size, w);
}

/** A ramp of the theme by name: accent, good, warn, bad, ink, dim, surface, teamN. */
export function rampOf(theme: Theme, tone: string): Ramp {
  const p = theme.palette;
  if (tone.startsWith("team")) return p.team[Number(tone.slice(4)) % p.team.length] ?? p.accent;
  switch (tone) {
    case "good": return p.good;
    case "warn": return p.warn;
    case "bad": return p.bad;
    case "ink": return [p.surface[1]!, p.surface[3]!, p.ink[0]!, p.ink[1]!, p.ink[2]!];
    case "dim": return [p.surface[0]!, p.surface[2]!, p.surface[4]!, p.ink[0]!, p.ink[1]!];
    case "surface": return p.surface.slice(1);
    default: return p.accent;
  }
}

/** An icon, drawn and themed: a (size + 2)-square bitmap (1 px of outline round the shape). */
export function iconBitmap(name: string, size: number, theme: Theme, o: IconOptions = {}): Bitmap {
  const inner = Math.max(4, size - 2);
  const mask = iconMask(name, inner, o.seed ?? theme.recipe.seed, o.variant, theme.icon.stroke, o.family ?? theme.culture);
  const base = rampOf(theme, o.tone ?? ICON_RECIPES[name]!.tone);
  const ramp = o.on === undefined ? base : base.map((c) => awayFrom(c, o.on!));
  return shadeIcon(mask, inner, ramp, theme.palette.outline, o.style ?? theme.icon.style);
}

/** Shade a mask like pixel art and paint it in a ramp: outline, shade, base, light, shine. */
export function shadeIcon(mask: Uint8Array, n: number, ramp: Ramp, outline: Rgba, style: "solid" | "outline" | "duotone" = "solid"): Bitmap {
  const S = n + 2;
  const b = createBitmap(S, S);
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < n && y < n ? mask[y * n + x]! : 0);
  const [r0, r1, r2, r3, r4] = [ramp[0]!, ramp[1]!, ramp[2]!, ramp[3]!, ramp[4]!];
  let shine = -1;
  for (let y = -1; y <= n; y += 1) for (let x = -1; x <= n; x += 1) {
    const o = (y + 1) * S + (x + 1);
    if (!at(x, y)) {
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) b.px[o] = outline;
      continue;
    }
    const edgeTL = !at(x - 1, y) || !at(x, y - 1);
    const edgeBR = !at(x + 1, y) || !at(x, y + 1);
    const edge = edgeTL || edgeBR;
    if (style === "outline") { b.px[o] = edge ? r3 : 0; if (!edge) b.px[o] = 0; continue; }
    let c = r2;
    if (style === "duotone" && x + y >= n) c = r1;
    // (A pixel that is both -- a one-pixel line -- is lit, never the shade: a thin icon never sinks into its face.)
    if (edgeBR && edgeTL) c = r3;
    else if (edgeBR) c = style === "duotone" ? r0 : r1;
    else if (edgeTL) c = r3;
    b.px[o] = c;
    if (shine < 0 && edgeTL && !edgeBR && at(x + 1, y) && at(x, y + 1)) shine = o;
  }
  if (style !== "outline" && shine >= 0 && n >= 10) b.px[shine] = r4;
  if (style === "outline") {
    // (Hollow: the ring in the light ink, the outline outside it -- and inside it, so it reads on any fill.)
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
      const o = (y + 1) * S + (x + 1);
      if (at(x, y) && b.px[o] === 0 && (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) === 4) {
        const nearEdge = !at(x - 2, y) || !at(x + 2, y) || !at(x, y - 2) || !at(x, y + 2);
        b.px[o] = nearEdge ? outline : 0;
      }
    }
  }
  return b;
}
