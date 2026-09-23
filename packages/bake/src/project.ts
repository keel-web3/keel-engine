// The engine's ONE projection contract, shared by every pass that composites:
// the mesh pass, billboards, the volumes, keel/terrain's ground. Two shots --
// the orthographic pixel view games are built on, and a perspective camera for
// a chase or over-the-hood view -- and one meaning for depth:
//
//   DEPTH IS NORMALISED LINEAR FORWARD DISTANCE FROM THE VIEW ORIGIN.
//
//   depth = clamp(0.5 + dot(point - origin, forward) / range, 0, 1)
//
// which is what the mesh pass already writes (mesh.ts MESH_VS). That reading
// holds under both projections, so PERSPECTIVE CHANGES THE CLIP POSITION AND
// NOTHING ELSE: the G-buffer, the paint pass, the outline, the fog and the
// depth a later draw tests against are all untouched. Anything that mixes with
// the picture -- a sprite, a puff of smoke, the ground -- reads depth the same
// way, so nothing sorts differently when the camera changes.
//
//   const p = projectionOf({ kind: "persp", eye, target, fov }, W, H);
//   gl.uniformMatrix4fv(uClip, false, p.clip);
//
// The orthographic branch reproduces pixelView's own arithmetic operation for
// operation, so turning this on moves no pixel of an existing game.

import { dcos, dsin } from "@keel-engine/core";
import type { PixelView, Vec3 } from "./view.ts";

/** An orthographic pixel view (keel/bake's pixelView), as a shot. */
export interface OrthoShot { readonly kind: "ortho"; readonly center: Vec3; readonly yaw: number; readonly pitch: number; readonly k: number }
/** A perspective camera (keel/render's): where it is, what it looks at, its vertical field of view. */
export interface PerspShot { readonly kind: "persp"; readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export type Shot = OrthoShot | PerspShot;

/** The far plane the depth is measured against, when a shot doesn't name one. */
export const DEPTH_RANGE = 140;
/** How close a perspective camera can see (metres). */
export const NEAR = 0.05;

/** A shot resolved for a picture: its axes, the matrix that puts a world point on screen, and how depth is read. */
export interface Projection {
  readonly kind: "ortho" | "persp";
  /** Where depth is measured from: the view's centre (ortho) or the eye (perspective). */
  readonly origin: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  /**
   * World -> clip, column-major, for gl.uniformMatrix4fv. Its z is the HARDWARE depth (what the depth test sorts by),
   * which under perspective cannot also be linear -- so a pass carries the contract's depth as a varying and writes it
   * to gl_FragDepth, exactly as the mesh pass already does. `project()` returns the contract's depth, not the clip's.
   */
  readonly clip: Float32Array;
  /** Metres of forward distance mapped onto 0..1. */
  readonly depthRange: number;
  /**
   * The HARDWARE planes, apart from the contract (projectionOf's `clip`): perspective, the near and far forward
   * distances the picture is cut at; orthographic, `clipFar` is the depth span the rasteriser sorts over (centred on the
   * view). Default: NEAR and depthRange -- the same as ever. A far pass is a second projection of the same shot whose
   * planes start where the near one's stop.
   */
  readonly clipNear?: number;
  readonly clipFar?: number;
  /** Picture pixels a metre -- at the focal distance, under perspective. */
  readonly k: number;
  /** tan(fov / 2) of a perspective camera (0 for orthographic): what a pass needs to build a pixel's own ray. */
  readonly tanHalfFov: number;
  readonly width: number;
  readonly height: number;
  /** Where a world point lands: picture pixels (x right, y DOWN from the top-left) and its depth 0..1. */
  project(p: Vec3): [number, number, number];
  /** The whole-pixel the point snaps to (what a draw anchors its dither and its pixel grid to). */
  anchorPixel(p: Vec3): [number, number];
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** The axes of a shot: right, up the picture, and forward into it (the pixel view's own convention). */
export function axesOf(shot: Shot): { right: Vec3; up: Vec3; forward: Vec3 } {
  if (shot.kind === "ortho") {
    const cy = dcos(shot.yaw), sy = dsin(shot.yaw), cp = dcos(shot.pitch), sp = dsin(shot.pitch);
    const forward: Vec3 = [sy * cp, -sp, cy * cp];
    const right: Vec3 = [cy, 0, -sy];
    return { right, up: cross(forward, right), forward };
  }
  const delta: Vec3 = [shot.target[0] - shot.eye[0], shot.target[1] - shot.eye[1], shot.target[2] - shot.eye[2]];
  const forward = Math.hypot(...delta) > 1e-12 ? norm(delta) : [0, 0, 1] as Vec3;
  // (Right is world up x forward -- the pixel view's own handedness, [cos yaw, 0, -sin yaw] when level. The other
  // order negates it, and a negated right flips up too: the picture comes out upside down and mirrored.)
  const referenceUp: Vec3 = Math.hypot(forward[0], forward[2]) < 1e-8 ? [0, 0, 1] : [0, 1, 0];
  const right = norm(cross(referenceUp, forward));
  return { right, up: cross(forward, right), forward };
}

/** The hardware planes of a projection, apart from its depth contract (Projection.clipNear / clipFar). */
export interface ClipPlanes { readonly near?: number; readonly far?: number }

/** The mesh renderer's default sun, shared with streaming/culling before geometry exists. */
export function defaultMeshSun(view: Projection, yaw = Math.atan2(view.forward[0], view.forward[2])): Vec3 {
  return [view.right[0] * -.5 - Math.sin(yaw) * .45, .75, view.right[2] * -.5 - Math.cos(yaw) * .45];
}

/**
 * Resolve a shot for a W x H picture. `far` is the depth range (default DEPTH_RANGE); under perspective the picture's
 * pixel scale is quoted at `focal` metres (default: the distance to what the camera is looking at), which is what a
 * draw uses to pick its detail and to snap its pixel grid. `clip` moves the hardware planes without touching the
 * depth contract: a near pass cut at 230 m, a far pass from 210 m to the horizon, an orthographic view deep enough
 * for the tallest tower (orthoDepthRange).
 */
export function projectionOf(shot: Shot, width: number, height: number, far = DEPTH_RANGE, focal?: number, clip?: ClipPlanes): Projection {
  const { right, up, forward } = axesOf(shot);
  const persp = shot.kind === "persp";
  const origin: Vec3 = persp ? shot.eye : shot.center;
  const dist = persp ? focal ?? Math.max(1, Math.hypot(shot.target[0] - shot.eye[0], shot.target[1] - shot.eye[1], shot.target[2] - shot.eye[2])) : 0;
  const tan = persp ? Math.tan(shot.fov / 2) : 0;
  const k = persp ? height / 2 / (tan * dist) : shot.k;
  const m = new Float32Array(16);
  if (!persp) {
    // Orthographic: pixelView's own arithmetic. px = W/2 + dot(d, right) * k, py = H/2 - dot(d, up) * k, and
    // depth = 0.5 + dot(d, forward) / far -- written as a matrix so every pass can use the same uniform.
    // (z maps the contract straight onto the hardware's 0..1 after the viewport: 0.5 + fd / far.)
    const sx = (2 * k) / width, sy = (2 * k) / height, sz = 2 / (clip?.far ?? far);
    for (let c = 0; c < 3; c += 1) { m[c * 4] = right[c]! * sx; m[c * 4 + 1] = up[c]! * sy; m[c * 4 + 2] = forward[c]! * sz; m[c * 4 + 3] = 0; }
    m[12] = -dot(origin, right) * sx; m[13] = -dot(origin, up) * sy; m[14] = -dot(origin, forward) * sz;
    m[15] = 1;
  } else {
    // Perspective: the usual frustum, built on the same axes. Clip z carries the LINEAR forward distance (times w),
    // so after the divide the depth still reads as distance / far -- the contract, unchanged.
    const aspect = width / height;
    const fx = 1 / (tan * aspect), fy = 1 / tan;
    // (The usual near/far mapping for the hardware's depth test; the contract's own depth rides a varying.)
    const near = clip?.near ?? NEAR, hw = clip?.far ?? far;
    const fz = (hw + near) / (hw - near), fw = (-2 * hw * near) / (hw - near);
    for (let c = 0; c < 3; c += 1) {
      m[c * 4] = right[c]! * fx;
      m[c * 4 + 1] = up[c]! * fy;
      m[c * 4 + 2] = forward[c]! * fz;
      m[c * 4 + 3] = forward[c]!;
    }
    m[12] = -dot(origin, right) * fx; m[13] = -dot(origin, up) * fy; m[14] = -dot(origin, forward) * fz + fw; m[15] = -dot(origin, forward);
  }
  const depthOf = (p: Vec3): number => {
    const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    return Math.max(0, Math.min(1, 0.5 + dot(d, forward) / far));
  };
  const project = (p: Vec3): [number, number, number] => {
    const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    const fd = dot(d, forward);
    if (!persp) return [width / 2 + dot(d, right) * k, height / 2 - dot(d, up) * k, depthOf(p)];
    const z = Math.max(1e-4, fd);
    return [width / 2 + (dot(d, right) / (z * tan * (width / height))) * (width / 2), height / 2 - (dot(d, up) / (z * tan)) * (height / 2), depthOf(p)];
  };
  return {
    ...(clip?.near !== undefined && persp ? { clipNear: clip.near } : {}), ...(clip?.far !== undefined ? { clipFar: clip.far } : {}),
    kind: shot.kind, origin, right, up, forward, clip: m, depthRange: far, k, tanHalfFov: tan, width, height, project,
    anchorPixel: (p) => { const [x, y] = project(p); return [Math.floor(x + 0.5), Math.floor(y + 0.5)]; },
  };
}

/** The pixel view a game already has, as a shot (so an orthographic game reaches the same contract). */
export const shotOfView = (view: PixelView): OrthoShot => ({ kind: "ortho", center: view.center, yaw: view.yaw, pitch: view.pitch, k: view.pixelsPerMetre });

/**
 * An orthographic view's depth span deep enough for the scene's tallest point (metres, for projectionOf's clip.far).
 * The pixel view's own span is 4 x the picture's width in metres -- 80 m at the default zoom -- and a point `h` up sits
 * h * sin(pitch) nearer along the view, so anything above ~55 m clamped to one depth and a tower's far faces painted
 * over its roof. This covers the top, and the ground a picture's height below the centre, with a margin.
 */
export function orthoDepthRange(view: PixelView, sceneTop: number, margin = 20): number {
  const span = Math.max(view.width, view.height) / view.pixelsPerMetre;
  const sp = Math.abs(dsin(view.pitch)), cp = Math.max(0.05, Math.abs(dcos(view.pitch)));
  return Math.max(4 * span, 2 * (Math.max(0, sceneTop) * sp + (span * cp) / Math.max(0.05, sp)) + margin);
}
