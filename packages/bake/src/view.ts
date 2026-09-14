// The pixel view: an orthographic camera at a fixed pitch over the ground,
// turned by a yaw, with a real pixel scale -- pixels per metre -- so every
// baked sprite lands texel for pixel at any picture size. (Perspective would
// scale sprites with distance and smear the pixel grid; pixel-art strategy
// games look down orthographically.) Pure maths: the sprite renderer, the
// culler and picking all use the same projection.
//
//   const v = pixelView({ center: [x, 0, z], yaw, pitch: 0.6, pixelsPerMetre: 24, width: 480, height: 270 });
//   v.project([x, y, z]) -> [px, py, depth]      (pixels from the picture's top-left)
//   v.ground(px, py)     -> [x, 0, z]            (where a pixel hits the ground: picking)
//   v.groundRect()       -> the ground rectangle (x0, z0, x1, z1) the picture covers, for culling

import { dcos, dsin } from "@keel-engine/core";

export type Vec3 = readonly [number, number, number];

export interface PixelViewSpec {
  /** The ground point at the picture's centre. */
  readonly center: Vec3;
  /** The camera's heading (frame convention: 0 looks along +z). */
  readonly yaw: number;
  /** Radians below horizontal the camera looks down (0.6 ≈ 34°: a classic 3/4 view). */
  readonly pitch: number;
  readonly pixelsPerMetre: number;
  readonly width: number;
  readonly height: number;
}

export interface PixelView extends PixelViewSpec {
  /** World -> picture pixels (x right, y down from the top-left) and a depth (larger is nearer the camera). */
  project(p: Vec3): [number, number, number];
  /** A picture pixel -> the ground point (y = 0) under it. */
  ground(px: number, py: number): [number, number, number];
  /** The ground area the picture shows (a rectangle in x/z covering it, for culling), padded by `pad` metres. */
  groundRect(pad?: number): [number, number, number, number];
  /** The camera axes in the world: right, up (on screen), forward (into the screen). */
  readonly axes: { readonly right: Vec3; readonly up: Vec3; readonly forward: Vec3 };
}

export function pixelView(spec: PixelViewSpec): PixelView {
  const { center, yaw, pitch, pixelsPerMetre: k, width, height } = spec;
  const cy = dcos(yaw);
  const sy = dsin(yaw);
  const cp = dcos(pitch);
  const sp = dsin(pitch);
  // Forward: along the heading, tipped down by the pitch. Right: the heading's right (frame convention: [cos, 0, -sin]).
  const forward: Vec3 = [sy * cp, -sp, cy * cp];
  const right: Vec3 = [cy, 0, -sy];
  // Up on screen = forward × right: up in the world, and away from the camera along the ground (up the picture).
  const up: Vec3 = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const project = (p: Vec3): [number, number, number] => {
    const d: Vec3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    return [width / 2 + dot(d, right) * k, height / 2 - dot(d, up) * k, -dot(d, forward)];
  };
  const ground = (px: number, py: number): [number, number, number] => {
    // The ray through the pixel runs along `forward` from the point (px, py) on the view plane through the centre.
    const a = (px - width / 2) / k;
    const b = (height / 2 - py) / k;
    const o: Vec3 = [center[0] + right[0] * a + up[0] * b, center[1] + right[1] * a + up[1] * b, center[2] + right[2] * a + up[2] * b];
    const t = forward[1] === 0 ? 0 : -o[1] / forward[1];
    return [o[0] + forward[0] * t, 0, o[2] + forward[2] * t];
  };
  const groundRect = (pad = 0): [number, number, number, number] => {
    const corners = [ground(0, 0), ground(width, 0), ground(0, height), ground(width, height)];
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[2]);
    return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
  };
  return { ...spec, project, ground, groundRect, axes: { right, up, forward } };
}
