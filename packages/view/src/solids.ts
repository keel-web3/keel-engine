// Things as solids for a perspective view: a design's boxes, wedges and
// capsules (a posed body, a tree, a house's ground extras -- the same worlds
// the baker draws sprites from) placed in the world at a position, heading and
// size, into keel/render's instanced RasterSolids.
//
//   pushWorld(solids, tree.pose("still", 0), { pos, yaw, scale: 1.2, mat: (m) => m, look: { id: 120 } });

import type { RasterLook, RasterSolids, RenderWorld } from "@keel-engine/render";

export interface Placement {
  readonly pos: readonly [number, number, number];
  /** Its heading (frame convention: the design's +z turns to [sin, 0, cos]). */
  readonly yaw?: number;
  readonly scale?: number;
  /** A design's material -> the renderer's (default: as it is). */
  readonly mat?: (m: number) => number;
  /** Per part (by its material): a ramp override, lightness, id, fade, glow -- or one look for all. */
  readonly look?: RasterLook | ((m: number) => RasterLook);
}

/** Put a design's solids into `into` at a placement: its own frame turned by yaw, scaled, moved to pos. Returns how many. */
export function pushWorld(into: RasterSolids, world: RenderWorld, p: Placement): number {
  const [px, py, pz] = p.pos;
  const yaw = p.yaw ?? 0, s = p.scale ?? 1;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const mat = p.mat ?? ((m: number) => m);
  const lookOf = typeof p.look === "function" ? p.look : (() => (p.look as RasterLook | undefined) ?? {});
  // (Own frame -> world: x = c x' + s z', z = -s x' + c z' -- the inverse of the renderer's world -> box turn.)
  const at = (q: ArrayLike<number>): [number, number, number] => { const x = q[0]! * s, z = q[2]! * s; return [px + c * x + sn * z, py + q[1]! * s, pz - sn * x + c * z]; };
  let n = 0;
  for (const b of world.boxes ?? []) {
    const m = b.mat ?? 0;
    const h: [number, number, number] = [b.h[0] * s, b.h[1] * s, b.h[2] * s];
    if (b.kind === "wedge") into.wedge(at(b.c), h, (b.yaw ?? 0) + yaw, b.lo ?? 0, mat(m), lookOf(m));
    else into.box(at(b.c), h, (b.yaw ?? 0) + yaw, mat(m), lookOf(m));
    n += 1;
  }
  for (const w of world.wedges ?? []) { const m = w.mat ?? 0; into.wedge(at(w.c), [w.h[0] * s, w.h[1] * s, w.h[2] * s], (w.yaw ?? 0) + yaw, w.lo ?? 0, mat(m), lookOf(m)); n += 1; }
  for (const k of world.capsules ?? []) { const m = k.mat ?? 0; into.capsule(at(k.a), at(k.b), k.r * s, mat(m), lookOf(m)); n += 1; }
  return n;
}

/** A design's bounding radius about its origin on the ground plane and its height (for culling solids): [radius, height]. */
export function worldExtent(world: RenderWorld): [number, number] {
  let r = 0, h = 0;
  for (const b of [...(world.boxes ?? []), ...(world.wedges ?? [])]) { const e = Math.hypot(b.h[0], b.h[1], b.h[2]); r = Math.max(r, Math.hypot(b.c[0], b.c[2]) + e); h = Math.max(h, b.c[1] + e); }
  for (const k of world.capsules ?? []) for (const q of [k.a, k.b]) { r = Math.max(r, Math.hypot(q[0], q[2]) + k.r); h = Math.max(h, q[1] + k.r); }
  return [r, h];
}
