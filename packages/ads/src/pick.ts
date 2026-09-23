// Which ad slot is under a pointer: a ray from the camera through the pixel,
// against each slot's face (a rectangle standing on the ground plane's normal),
// the nearest one it meets from the front.

import type { AdSlot } from "./types.ts";

type V3 = readonly [number, number, number];
/** What a ray needs of a camera: keel/bake's Projection has all of it. */
export interface RayCamera {
  readonly kind: "ortho" | "persp";
  readonly origin: V3;
  readonly right: V3;
  readonly up: V3;
  readonly forward: V3;
  /** Pixels a metre (ortho), and the tangent of half the vertical field of view (persp). */
  readonly k: number;
  readonly tanHalfFov: number;
  readonly width: number;
  readonly height: number;
}
export interface Ray { readonly origin: V3; readonly dir: V3 }

/** The ray through a point of the picture: x, y 0..1 from its top left. */
export function rayOf(cam: RayCamera, x: number, y: number): Ray {
  const nx = x * 2 - 1, ny = 1 - y * 2;
  const { right: r, up: u, forward: f } = cam;
  // (Orthographic: parallel rays, started 200 m back toward the viewer from the view's centre.)
  if (cam.kind === "ortho") {
    const ox = (nx * cam.width) / 2 / cam.k, oy = (ny * cam.height) / 2 / cam.k;
    return { origin: [cam.origin[0] + r[0] * ox + u[0] * oy - f[0] * 200, cam.origin[1] + r[1] * ox + u[1] * oy - f[1] * 200, cam.origin[2] + r[2] * ox + u[2] * oy - f[2] * 200], dir: f };
  }
  const sx = nx * cam.tanHalfFov * (cam.width / cam.height), sy = ny * cam.tanHalfFov;
  const d: [number, number, number] = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy];
  const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
  return { origin: cam.origin, dir: [d[0] / len, d[1] / len, d[2] / len] };
}

/** The nearest slot the ray meets on its face (within `reach` metres), and where along the ray. */
export function pickSlot<S extends AdSlot>(slots: readonly S[], ray: Ray, reach = 400): { slot: S; t: number } | null {
  let best: { slot: S; t: number } | null = null;
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.dir;
  for (const s of slots) {
    const [nx, nz] = s.normal, nl = Math.sqrt(nx * nx + nz * nz) || 1, ux = nx / nl, uz = nz / nl;
    const facing = dx * ux + dz * uz;
    if (facing >= -1e-6) continue; // (seen from behind, or edge on)
    const t = ((s.pos[0] - ox) * ux + (s.pos[2] - oz) * uz) / facing;
    if (t <= 0 || t > reach || (best && t >= best.t)) continue;
    const px = ox + dx * t - s.pos[0], py = oy + dy * t - s.pos[1], pz = oz + dz * t - s.pos[2];
    // (Across the face: the ground-plane direction square to its normal.)
    const across = px * uz - pz * ux;
    if (Math.abs(across) <= s.size[0] / 2 && Math.abs(py) <= s.size[1] / 2) best = { slot: s, t };
  }
  return best;
}
