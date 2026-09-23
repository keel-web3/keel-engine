// The little vector and quaternion maths a rigid body needs -- plain arrays, no
// classes, deterministic (square roots and arithmetic only: IEEE-exact on every
// machine). Frame convention, as the rest of the engine: +x right, +y up, +z
// forward; a yaw of 0 faces +z.

export type V3 = [number, number, number];
/** A unit quaternion [x, y, z, w]: the body's orientation. */
export type Quat = [number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const norm = (a: V3): V3 => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };
/** a += b * s, in place. */
export const addScaled = (a: V3, b: V3, s: number): void => { a[0] += b[0] * s; a[1] += b[1] * s; a[2] += b[2] * s; };

/** Rotate a vector by a unit quaternion. */
export function rotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  // (t = 2 q.xyz x v;  v' = v + w t + q.xyz x t)
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
/** Rotate by the inverse (world -> body). */
export const unrotate = (q: Quat, v: V3): V3 => rotate([-q[0], -q[1], -q[2], q[3]], v);

/** q + 0.5 * (w, 0) * q * dt, renormalised: an angular velocity (world) applied for dt. */
export function integrateQuat(q: Quat, w: V3, dt: number): Quat {
  const [x, y, z, s] = q;
  const h = 0.5 * dt;
  const nx = x + h * (w[0] * s + w[1] * z - w[2] * y);
  const ny = y + h * (w[1] * s + w[2] * x - w[0] * z);
  const nz = z + h * (w[2] * s + w[0] * y - w[1] * x);
  const ns = s + h * (-w[0] * x - w[1] * y - w[2] * z);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz + ns * ns) || 1;
  return [nx / l, ny / l, nz / l, ns / l];
}

/** A yaw (about +y) as a quaternion. `c`/`s` are cos and sin of HALF the yaw (the caller's dmath). */
export const yawQuat = (cHalf: number, sHalf: number): Quat => [0, sHalf, 0, cHalf];

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * The column-major 4x4 of a pose: rotate by q, then move to p, after an offset in the body's own frame (`local`) --
 * the matrix a renderer draws a body with (its mesh's origin need not be the centre of mass).
 */
export function matrixOf(p: V3, q: Quat, local: V3 = [0, 0, 0]): Float32Array {
  const x = rotate(q, [1, 0, 0]), y = rotate(q, [0, 1, 0]), z = rotate(q, [0, 0, 1]), o = add(p, rotate(q, local));
  return Float32Array.from([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]);
}
