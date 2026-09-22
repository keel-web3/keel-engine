// The solids a car is built from, as keel/bake takes them: boxes, wedges (a box
// whose top slopes) and capsules, each with the slot it wears -- and the little
// helpers that place them between two corners, the way a body is drawn up.

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
