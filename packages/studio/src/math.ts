// Small column-major 4x4 and vector maths for the studio renderer (presentation: Math is fine here).

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Mat4 = Float32Array;

export const identity = (): Mat4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

/** a * b (apply b first). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    let s = 0;
    for (let k = 0; k < 4; k += 1) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

export const translation = (x: number, y: number, z: number): Mat4 => { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; };
export const scaling = (x: number, y: number, z: number): Mat4 => { const m = identity(); m[0] = x; m[5] = y; m[10] = z; return m; };
export function rotationX(a: number): Mat4 { const m = identity(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
export function rotationY(a: number): Mat4 { const m = identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
export function rotationZ(a: number): Mat4 { const m = identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
/** Rotation by `a` about the unit axis through `p`. */
export function rotationAbout(axis: Vec3, a: number, p: Vec3 = [0, 0, 0]): Mat4 {
  const [x, y, z] = axis, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const r = identity();
  r[0] = t * x * x + c; r[1] = t * x * y + s * z; r[2] = t * x * z - s * y;
  r[4] = t * x * y - s * z; r[5] = t * y * y + c; r[6] = t * y * z + s * x;
  r[8] = t * x * z + s * y; r[9] = t * y * z - s * x; r[10] = t * z * z + c;
  return multiply(translation(p[0], p[1], p[2]), multiply(r, translation(-p[0], -p[1], -p[2])));
}

/** Chain: compose(a, b, c) = a * b * c. */
export const compose = (...ms: Mat4[]): Mat4 => ms.reduce((a, b) => multiply(a, b), identity());

export function transformPoint(m: Mat4, p: Vec3): [number, number, number] {
  const [x, y, z] = p, w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return [(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w, (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w, (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w];
}
export function transformDir(m: Mat4, d: Vec3): [number, number, number] {
  const [x, y, z] = d;
  return [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z];
}

export function invert(m: Mat4): Mat4 {
  const a = m, o = new Float32Array(16);
  const b00 = a[0]! * a[5]! - a[1]! * a[4]!, b01 = a[0]! * a[6]! - a[2]! * a[4]!, b02 = a[0]! * a[7]! - a[3]! * a[4]!;
  const b03 = a[1]! * a[6]! - a[2]! * a[5]!, b04 = a[1]! * a[7]! - a[3]! * a[5]!, b05 = a[2]! * a[7]! - a[3]! * a[6]!;
  const b06 = a[8]! * a[13]! - a[9]! * a[12]!, b07 = a[8]! * a[14]! - a[10]! * a[12]!, b08 = a[8]! * a[15]! - a[11]! * a[12]!;
  const b09 = a[9]! * a[14]! - a[10]! * a[13]!, b10 = a[9]! * a[15]! - a[11]! * a[13]!, b11 = a[10]! * a[15]! - a[11]! * a[14]!;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return identity();
  const d = 1 / det;
  o[0] = (a[5]! * b11 - a[6]! * b10 + a[7]! * b09) * d; o[1] = (a[2]! * b10 - a[1]! * b11 - a[3]! * b09) * d;
  o[2] = (a[13]! * b05 - a[14]! * b04 + a[15]! * b03) * d; o[3] = (a[10]! * b04 - a[9]! * b05 - a[11]! * b03) * d;
  o[4] = (a[6]! * b08 - a[4]! * b11 - a[7]! * b07) * d; o[5] = (a[0]! * b11 - a[2]! * b08 + a[3]! * b07) * d;
  o[6] = (a[14]! * b02 - a[12]! * b05 - a[15]! * b01) * d; o[7] = (a[8]! * b05 - a[10]! * b02 + a[11]! * b01) * d;
  o[8] = (a[4]! * b10 - a[5]! * b08 + a[7]! * b06) * d; o[9] = (a[1]! * b08 - a[0]! * b10 - a[3]! * b06) * d;
  o[10] = (a[12]! * b04 - a[13]! * b02 + a[15]! * b00) * d; o[11] = (a[9]! * b02 - a[8]! * b04 - a[11]! * b00) * d;
  o[12] = (a[5]! * b07 - a[4]! * b09 - a[6]! * b06) * d; o[13] = (a[0]! * b09 - a[1]! * b07 + a[2]! * b06) * d;
  o[14] = (a[13]! * b01 - a[12]! * b03 - a[14]! * b00) * d; o[15] = (a[8]! * b03 - a[9]! * b01 + a[10]! * b00) * d;
  return o;
}

/** The normal matrix (inverse transpose of the upper 3x3), as a mat3 in a Float32Array(9). */
export function normalMatrix(m: Mat4): Float32Array {
  const i = invert(m), o = new Float32Array(9);
  o[0] = i[0]!; o[1] = i[4]!; o[2] = i[8]!; o[3] = i[1]!; o[4] = i[5]!; o[5] = i[9]!; o[6] = i[2]!; o[7] = i[6]!; o[8] = i[10]!;
  return o;
}

export interface Lens {
  /** Vertical field of view (radians). */
  readonly fovy: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
  /** Lens shift in NDC units (moves the picture without turning the camera: a card's off-centre framing). */
  readonly shiftX?: number;
  readonly shiftY?: number;
}

export function perspective(l: Lens): Mat4 {
  const f = 1 / Math.tan(l.fovy / 2), m = new Float32Array(16);
  m[0] = f / l.aspect; m[5] = f;
  m[8] = -(l.shiftX ?? 0); m[9] = -(l.shiftY ?? 0);
  m[10] = (l.far + l.near) / (l.near - l.far); m[11] = -1;
  m[14] = (2 * l.far * l.near) / (l.near - l.far);
  return m;
}

export function orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const m = identity();
  m[0] = 2 / (right - left); m[5] = 2 / (top - bottom); m[10] = -2 / (far - near);
  m[12] = -(right + left) / (right - left); m[13] = -(top + bottom) / (top - bottom); m[14] = -(far + near) / (far - near);
  return m;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = identity();
  m[0] = xx; m[4] = xy; m[8] = xz; m[1] = yx; m[5] = yy; m[9] = yz; m[2] = zx; m[6] = zy; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  return m;
}

export const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function normalize(a: Vec3): [number, number, number] { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
