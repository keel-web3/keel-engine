// The engine's one frame convention -- ported from the proof of concept's
// src/core/frame.js. Every system -- renderer, physics, entities, objects,
// cameras, input -- uses this, and only this.
//
//   world: y up. An entity's (or object's, or camera's) own frame:
//     +z  FRONT   (where a face looks, where a screen shows, where a runner runs)
//     +x  RIGHT   (its right hand, as it sees it)
//     +y  UP
//
//   yaw (heading) turns the front about +y:  front(yaw) = [sin yaw, 0, cos yaw]
//                                            right(yaw) = [cos yaw, 0, -sin yaw]
//   so yaw = atan2(dx, dz) is "facing along (dx, dz)", and yaw 0 faces +z.
//
//   A camera looking along +z has +x on the RIGHT of the screen. So a thing
//   seen from behind shows its right hand on the screen's right, and a thing
//   seen from the front shows its right hand on the screen's left -- as in a
//   mirror, as in life.
//
// (NOCTURNES turns its instances the other way -- its front(yaw) is
// [-sin yaw, 0, cos yaw] -- so its yaws come in through fromNocturnesYaw.)

import type { Vec3, Vec3Like } from "./math.ts";
import { datan2, dcos, dhypot, dsin } from "./dmath.ts";

export const FRONT: Vec3Like = Object.freeze([0, 0, 1] as const);
export const RIGHT: Vec3Like = Object.freeze([1, 0, 0] as const);
export const UP: Vec3Like = Object.freeze([0, 1, 0] as const);

/** A camera's basis: where it looks, and the screen's right and up. */
export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export const wrapAngle = (a: number): number => datan2(dsin(a), dcos(a));

/** The world direction a yaw faces. */
export const frontOf = (yaw: number): Vec3 => [dsin(yaw), 0, dcos(yaw)];
/** The world direction of the right hand at a yaw. */
export const rightOf = (yaw: number): Vec3 => [dcos(yaw), 0, -dsin(yaw)];
/** The yaw that faces along a direction (its horizontal part). */
export const yawOf = (dir: Vec3Like): number => datan2(dir[0], dir[2]);
/** The yaw that faces from `from` toward `to`. */
export const yawTo = (from: Vec3Like, to: Vec3Like): number => datan2(to[0] - from[0], to[2] - from[2]);

/** Local [x right, y up, z front] -> world, for a thing at `pos` turned by `yaw`. */
export function localToWorld(pos: Vec3Like, yaw: number, [x, y, z]: Vec3Like): Vec3 {
  const c = dcos(yaw);
  const s = dsin(yaw);
  return [pos[0] + x * c + z * s, pos[1] + y, pos[2] - x * s + z * c];
}
/** World -> local, the inverse of localToWorld. */
export function worldToLocal(pos: Vec3Like, yaw: number, p: Vec3Like): Vec3 {
  const c = dcos(yaw);
  const s = dsin(yaw);
  const dx = p[0] - pos[0];
  const dz = p[2] - pos[2];
  return [dx * c - dz * s, p[1] - pos[1], dx * s + dz * c];
}

/**
 * A camera's basis from where it is and what it looks at: forward, right
 * (screen right) and up. Right = up x forward, so looking along +z, +x is right.
 */
export function cameraBasis(eye: Vec3Like, target: Vec3Like): CameraBasis {
  let f: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = dhypot(f[0], f[1], f[2]) || 1;
  f = [f[0] / fl, f[1] / fl, f[2] / fl];
  let r: Vec3 = [f[2], 0, -f[0]]; // UP x f
  const rl = dhypot(r[0], r[1], r[2]) || 1;
  r = rl < 1e-6 ? [1, 0, 0] : [r[0] / rl, r[1] / rl, r[2] / rl];
  const u: Vec3 = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]; // f x r
  return { forward: f, right: r, up: u };
}

/**
 * Movement intent on the ground from a stick or keys, relative to a view yaw:
 * forward 1 goes where the view faces, strafe 1 goes to the view's right.
 * Returns a horizontal world direction [x, z] (length <= 1).
 */
export function moveFromView(viewYaw: number, forward: number, strafe: number): [number, number] {
  const f = frontOf(viewYaw);
  const r = rightOf(viewYaw);
  let x = f[0] * forward + r[0] * strafe;
  let z = f[2] * forward + r[2] * strafe;
  const l = dhypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  return [x, z];
}

/** NOCTURNES instance yaw -> engine yaw (NOCTURNES turns the other way). */
export const fromNocturnesYaw = (y: number): number => -y;
export const toNocturnesYaw = (y: number): number => -y;
