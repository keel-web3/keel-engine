// The solids a car is built from, as keel/bake takes them: boxes, wedges (a box
// whose top slopes) and capsules, each with the slot it wears -- and the little
// helpers that place them between two corners, the way a body is drawn up.

import { dhypot } from "@keel-engine/core";
import type { BakeBox, BakeCapsule } from "@keel-engine/bake";

export interface Solids { boxes: BakeBox[]; wedges: BakeBox[]; capsules: BakeCapsule[]; components?: Map<object, string> }
export const solids = (): Solids => ({ boxes: [], wedges: [], capsules: [], components: new Map() });
/** Assembly ownership is independent of paint: a radiator can wear metal, rubber and grille finishes. */
export function component(S: Solids, name: string, build: () => void): void {
  const b = S.boxes.length, w = S.wedges.length, c = S.capsules.length;
  build();
  const names = S.components ??= new Map();
  for (const solid of [...S.boxes.slice(b), ...S.wedges.slice(w), ...S.capsules.slice(c)]) if (!names.has(solid)) names.set(solid, name);
}
/** Thin sloping sheet, using the same wedges as the body instead of filling the entire engine bay. */
export function sheet(S: Solids, mat: number, half: number, z0: number, z1: number, top: (z: number) => number): void {
  if (z1 <= z0) return;
  const ya = top(z0), yb = top(z1), low = Math.min(ya, yb) - 0.028, high = Math.max(ya, yb);
  wedge(S, mat, -half, low, z0, half, high, z1, (Math.min(ya, yb) - low) / (high - low), ya > yb ? "front" : "rear");
  const panel = S.wedges.at(-1)!;
  S.wedges[S.wedges.length - 1] = { ...panel, skin: 0.028 };
}
export type V3 = readonly [number, number, number];
/** A box between two corners. */
export const box = (S: Solids, mat: number, xa: number, ya: number, za: number, xb: number, yb: number, zb: number): void => {
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = Math.min(ya, yb), y1 = Math.max(ya, yb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
  S.boxes.push({ c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], mat });
};
/** A wedge between two corners: its foot (lo x its height) at the `foot` end (+z "front", -z "rear"), full height at the other. */
export const wedge = (S: Solids, mat: number, xa: number, ya: number, za: number, xb: number, yb: number, zb: number, lo: number, foot: "front" | "rear"): void => {
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = Math.min(ya, yb), y1 = Math.max(ya, yb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
  S.wedges.push({ c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], yaw: foot === "front" ? 0 : Math.PI, lo: Math.max(0, Math.min(0.98, lo)), mat, kind: "wedge" });
};
/** A wedge whose slope runs across the car: full height at x = xFull, its foot (lo x its height) at x = xFoot (side glass leaning in). */
export const wedgeX = (S: Solids, mat: number, xFull: number, xFoot: number, ya: number, yb: number, za: number, zb: number, lo: number): void => {
  const x0 = Math.min(xFull, xFoot), x1 = Math.max(xFull, xFoot), y0 = Math.min(ya, yb), y1 = Math.max(ya, yb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
  // (Turned a quarter: its local z runs along world x -- the foot at +x for yaw pi/2, at -x for -pi/2 -- and its local x along world z.)
  S.wedges.push({ c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h: [(z1 - z0) / 2, (y1 - y0) / 2, (x1 - x0) / 2], yaw: xFoot > xFull ? Math.PI / 2 : -Math.PI / 2, lo: Math.max(0, Math.min(0.98, lo)), mat, kind: "wedge" });
};
export const cap = (S: Solids, mat: number, a: V3, b: V3, r: number): void => {
  if (r < 1e-3) return;
  S.capsules.push({ a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], r, mat });
};
/** Both sides: f(+1) and f(-1). */
export const both = (f: (s: 1 | -1) => void): void => { f(1); f(-1); };
/**
 * A pane of glass (glass.ts GlassPane) as one thin solid: a wedge skinned `thickness` through -- its slope the pane's
 * outer face, from the foot edge up to the top edge -- tapered so its sides are the pane's own edges (the pillars'
 * lines). A screen (its foot and top edges across the car) or a side window (along it). The box runs one skin below the
 * foot, buried in the body under the belt, so the pane is the same thickness right down to where it disappears.
 */
export function pane(S: Solids, mat: number, p: { readonly name: string; readonly corners: readonly (readonly number[])[]; readonly thickness: number }): void {
  const [f0, f1, t0, t1] = p.corners as readonly (readonly [number, number, number])[] as [V3, V3, V3, V3];
  const yFoot = f0[1], yTop = t0[1], rise = yTop - yFoot;
  const across = Math.abs(f0[2] - f1[2]) < 1e-6;   // (the foot edge runs across the car: a screen)
  const n = S.wedges.length;
  if (across) {
    // Local x = world x (turned a half round for a rear screen: its foot at -z).
    const zFoot = f0[2], zTop = t0[2], run = Math.abs(zFoot - zTop), skin = p.thickness * dhypot(rise, run) / Math.max(1e-3, run);
    const xa = Math.min(f0[0], f1[0]), xb = Math.max(f0[0], f1[0]), cx = (xa + xb) / 2, half = (xb - xa) / 2;
    const y0 = yFoot - skin, front = zFoot > zTop;
    wedge(S, mat, xa, y0, zTop, xb, yTop, zFoot, skin / (yTop - y0), front ? "front" : "rear");
    if (S.wedges.length === n) return;
    const ta = (Math.min(t0[0], t1[0]) - cx) / half, tb = (Math.max(t0[0], t1[0]) - cx) / half;
    S.wedges[n] = { ...S.wedges[n]!, skin, top: front ? [ta, tb] : [-tb, -ta] };
  } else {
    // A side window: the foot edge along the car at x = f0's, the top edge further in; local x runs along world z.
    const xFoot = f0[0], xTop = t0[0], run = Math.abs(xFoot - xTop), skin = p.thickness * dhypot(rise, run) / Math.max(1e-3, run);
    const za = Math.min(f0[2], f1[2]), zb = Math.max(f0[2], f1[2]), cz = (za + zb) / 2, half = (zb - za) / 2;
    const y0 = yFoot - skin;
    wedgeX(S, mat, xTop, xFoot, y0, yTop, za, zb, skin / (yTop - y0));
    if (S.wedges.length === n) return;
    const ta = (Math.min(t0[2], t1[2]) - cz) / half, tb = (Math.max(t0[2], t1[2]) - cz) / half;
    // (Turned a quarter: world z = cz - local x with the foot at +x, cz + local x with it at -x -- wedgeX's yaw.)
    S.wedges[n] = { ...S.wedges[n]!, skin, top: xFoot > xTop ? [-tb, -ta] : [ta, tb] };
  }
}
