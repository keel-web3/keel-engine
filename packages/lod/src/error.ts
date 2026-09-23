// Screen-space error: how many picture pixels a coarser level's missing solids
// would cover, from where the view is. Measured to the NEAREST point of the
// node's box along the true (radial) distance, so turning the camera never
// changes a level -- only moving does. Weighted by the view angle: rooftop kit
// can't be seen from under the parapet, a wall sign is a sliver from above.
//
//   perspective:  px = error * H / (2 * d * tanHalfFov)
//   orthographic: px = error * k

import type { Facing, LodNode, LodPick, LodRange, LodStep, LodTerm, LodView, Vec3 } from "./types.ts";

/** The point of a box nearest a point (the point itself when inside). */
export function nearestPoint(p: Vec3, lo: Vec3, hi: Vec3): [number, number, number] {
  return [Math.max(lo[0], Math.min(hi[0], p[0])), Math.max(lo[1], Math.min(hi[1], p[1])), Math.max(lo[2], Math.min(hi[2], p[2]))];
}

/** Radial distance from a point to a box (0 inside it). */
export function boxDistance(p: Vec3, lo: Vec3, hi: Vec3): number {
  const q = nearestPoint(p, lo, hi);
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * How much of a solid facing this way shows from the view (0..1). `down` is the sine of the angle the eye looks DOWN
 * at the node by (1 straight above, 0 level, negative from below); `eyeY` the eye's height.
 */
export function facingVisibility(facing: Facing | undefined, down: number, eyeY: number, roofY?: number): number {
  if (facing === "roof") {
    if (roofY !== undefined && eyeY < roofY - 0.5) return 0;
    return Math.max(0, down);
  }
  if (facing === "wall") return Math.max(0.2, Math.sqrt(Math.max(0, 1 - down * down)));
  return 1;
}

/** How the view sees a node: its radial distance, and the sine of the angle it looks down at it by. */
export function viewOf(view: LodView, node: Pick<LodNode, "lo" | "hi">): { distance: number; down: number } {
  if (view.kind === "ortho") return { distance: boxDistance(view.origin, node.lo, node.hi), down: -view.forward[1] };
  const q = nearestPoint(view.origin, node.lo, node.hi);
  const dx = q[0] - view.origin[0], dy = q[1] - view.origin[1], dz = q[2] - view.origin[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { distance: d, down: d > 1e-6 ? -dy / d : 1 };
}

/** Picture pixels one metre covers at a radial distance (orthographic: everywhere the same). */
export function pixelsPerMetre(view: LodView, distance: number): number {
  if (view.kind === "ortho") return view.k;
  return view.height / (2 * Math.max(distance, 1e-3) * Math.max(view.tanHalfFov, 1e-6));
}

/** The pixel error of one term (exported for tests and tools). */
export function termError(view: LodView, term: LodTerm, distance: number, down: number): number {
  return term.error * facingVisibility(term.facing, down, view.origin[1], term.roofY) * pixelsPerMetre(view, distance);
}

/** The pixel error of a step: its worst term. */
export function pixelError(view: LodView, node: Pick<LodNode, "lo" | "hi">, step: LodStep): number {
  const { distance, down } = viewOf(view, node);
  let worst = 0;
  for (const t of step.terms) worst = Math.max(worst, termError(view, t, distance, down));
  return worst;
}

/** The coarsest level whose every dropped step is under `limit` pixels. */
export function coarsestUnder(errors: readonly number[], limit: number): number {
  let level = 0;
  while (level < errors.length && errors[level]! < limit) level += 1;
  return level;
}

/**
 * The index ranges a pick draws in the node's one buffer: its level's prefix whole, and when fading the delta to the
 * other level (the finer one's extra indices) dithered. Nested levels mean no index is ever drawn twice.
 */
export function rangesOf(pick: Pick<LodPick, "level" | "fading">, node: Pick<LodNode, "levels">): LodRange[] {
  const count = (l: number): number => node.levels[Math.max(0, Math.min(node.levels.length - 1, l))] ?? 0;
  if (!pick.fading || pick.fading.to === pick.level) return count(pick.level) > 0 ? [{ offset: 0, count: count(pick.level), fade: 1 }] : [];
  const coarse = Math.max(pick.level, pick.fading.to), fine = Math.min(pick.level, pick.fading.to);
  const out: LodRange[] = [];
  if (count(coarse) > 0) out.push({ offset: 0, count: count(coarse), fade: 1 });
  const t = Math.max(0, Math.min(1, pick.fading.t));
  if (t > 0 && count(fine) > count(coarse)) out.push({ offset: count(coarse), count: count(fine) - count(coarse), fade: t });
  return out;
}
