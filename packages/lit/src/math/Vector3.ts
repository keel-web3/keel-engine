// Ported from Three.js r180's math/Vector3.js (MIT, see packages/lit/NOTICE).

import { clamp, random } from "./mathUtils.ts";
import { Quaternion } from "./Quaternion.ts";
import type { Euler } from "./Euler.ts";
import type { Matrix3 } from "./Matrix3.ts";
import type { Matrix4 } from "./Matrix4.ts";
import type { AttributeLike, NumberArray } from "./types.ts";

/** Anything with an x, a y and a z (a Vector3 fits). */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The camera matrices project and unproject read (the cameras fit it). */
export interface ProjectionCamera {
  readonly matrixWorld: Matrix4;
  readonly matrixWorldInverse: Matrix4;
  readonly projectionMatrix: Matrix4;
  readonly projectionMatrixInverse: Matrix4;
}

/** r180's Spherical (radius, polar phi from +y, azimuth theta about +y). */
export interface SphericalLike {
  readonly radius: number;
  readonly phi: number;
  readonly theta: number;
}

/** r180's Cylindrical. */
export interface CylindricalLike {
  readonly radius: number;
  readonly theta: number;
  readonly y: number;
}

/** Anything with an r, a g and a b (a Color fits). */
export interface RgbLike {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // (on the prototype, as r180 sets it: other code checks it)
  get isVector3(): true {
    return true;
  }

  set(x: number, y: number, z?: number): this {
    if (z === undefined) z = this.z; // (sprite.scale.set(x, y))

    this.x = x;
    this.y = y;
    this.z = z;

    return this;
  }

  setScalar(scalar: number): this {
    this.x = scalar;
    this.y = scalar;
    this.z = scalar;
    return this;
  }

  setX(x: number): this {
    this.x = x;
    return this;
  }

  setY(y: number): this {
    this.y = y;
    return this;
  }

  setZ(z: number): this {
    this.z = z;
    return this;
  }

  setComponent(index: number, value: number): this {
    switch (index) {
      case 0: this.x = value; break;
      case 1: this.y = value; break;
      case 2: this.z = value; break;
      default: throw new Error("index is out of range: " + index);
    }
    return this;
  }

  getComponent(index: number): number {
    switch (index) {
      case 0: return this.x;
      case 1: return this.y;
      case 2: return this.z;
      default: throw new Error("index is out of range: " + index);
    }
  }

  clone(): this {
    return new (this.constructor as new (x: number, y: number, z: number) => this)(this.x, this.y, this.z);
  }

  copy(v: Vector3Like): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v: Vector3Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addScalar(s: number): this {
    this.x += s;
    this.y += s;
    this.z += s;
    return this;
  }

  addVectors(a: Vector3Like, b: Vector3Like): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }

  addScaledVector(v: Vector3Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v: Vector3Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  subScalar(s: number): this {
    this.x -= s;
    this.y -= s;
    this.z -= s;
    return this;
  }

  subVectors(a: Vector3Like, b: Vector3Like): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  multiply(v: Vector3Like): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }

  multiplyScalar(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  multiplyVectors(a: Vector3Like, b: Vector3Like): this {
    this.x = a.x * b.x;
    this.y = a.y * b.y;
    this.z = a.z * b.z;
    return this;
  }

  applyEuler(euler: Euler): this {
    return this.applyQuaternion(_quaternion.setFromEuler(euler));
  }

  applyAxisAngle(axis: Vector3Like, angle: number): this {
    return this.applyQuaternion(_quaternion.setFromAxisAngle(axis, angle));
  }

  applyMatrix3(m: Matrix3): this {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;

    this.x = e[0] * x + e[3] * y + e[6] * z;
    this.y = e[1] * x + e[4] * y + e[7] * z;
    this.z = e[2] * x + e[5] * y + e[8] * z;

    return this;
  }

  applyNormalMatrix(m: Matrix3): this {
    return this.applyMatrix3(m).normalize();
  }

  applyMatrix4(m: Matrix4): this {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;

    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);

    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;

    return this;
  }

  applyQuaternion(q: Quaternion): this {
    // (the quaternion-vector product, done as t = 2q x v; v' = v + w t + q x t)
    const vx = this.x, vy = this.y, vz = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;

    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);

    this.x = vx + qw * tx + qy * tz - qz * ty;
    this.y = vy + qw * ty + qz * tx - qx * tz;
    this.z = vz + qw * tz + qx * ty - qy * tx;

    return this;
  }

  project(camera: ProjectionCamera): this {
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  }

  unproject(camera: ProjectionCamera): this {
    return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
  }

  transformDirection(m: Matrix4): this {
    // (the upper 3x3 only, then normalized: m is taken to be affine)
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;

    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;

    return this.normalize();
  }

  divide(v: Vector3Like): this {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    return this;
  }

  divideScalar(scalar: number): this {
    return this.multiplyScalar(1 / scalar);
  }

  min(v: Vector3Like): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    return this;
  }

  max(v: Vector3Like): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    return this;
  }

  clamp(min: Vector3Like, max: Vector3Like): this {
    // (assumes min < max, componentwise)
    this.x = clamp(this.x, min.x, max.x);
    this.y = clamp(this.y, min.y, max.y);
    this.z = clamp(this.z, min.z, max.z);
    return this;
  }

  clampScalar(minVal: number, maxVal: number): this {
    this.x = clamp(this.x, minVal, maxVal);
    this.y = clamp(this.y, minVal, maxVal);
    this.z = clamp(this.z, minVal, maxVal);
    return this;
  }

  clampLength(min: number, max: number): this {
    const length = this.length();
    return this.divideScalar(length || 1).multiplyScalar(clamp(length, min, max));
  }

  floor(): this {
    this.x = Math.floor(this.x);
    this.y = Math.floor(this.y);
    this.z = Math.floor(this.z);
    return this;
  }

  ceil(): this {
    this.x = Math.ceil(this.x);
    this.y = Math.ceil(this.y);
    this.z = Math.ceil(this.z);
    return this;
  }

  round(): this {
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    this.z = Math.round(this.z);
    return this;
  }

  roundToZero(): this {
    this.x = Math.trunc(this.x);
    this.y = Math.trunc(this.y);
    this.z = Math.trunc(this.z);
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  dot(v: Vector3Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  manhattanLength(): number {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
  }

  normalize(): this {
    return this.divideScalar(this.length() || 1);
  }

  setLength(length: number): this {
    return this.normalize().multiplyScalar(length);
  }

  lerp(v: Vector3Like, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    return this;
  }

  lerpVectors(v1: Vector3Like, v2: Vector3Like, alpha: number): this {
    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;
    this.z = v1.z + (v2.z - v1.z) * alpha;
    return this;
  }

  cross(v: Vector3Like): this {
    return this.crossVectors(this, v);
  }

  crossVectors(a: Vector3Like, b: Vector3Like): this {
    const ax = a.x, ay = a.y, az = a.z;
    const bx = b.x, by = b.y, bz = b.z;

    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;

    return this;
  }

  projectOnVector(v: Vector3): this {
    const denominator = v.lengthSq();

    if (denominator === 0) return this.set(0, 0, 0);

    const scalar = v.dot(this) / denominator;

    return this.copy(v).multiplyScalar(scalar);
  }

  projectOnPlane(planeNormal: Vector3): this {
    _vector.copy(this).projectOnVector(planeNormal);
    return this.sub(_vector);
  }

  reflect(normal: Vector3Like): this {
    // (normal is taken to be unit length)
    return this.sub(_vector.copy(normal).multiplyScalar(2 * this.dot(normal)));
  }

  angleTo(v: Vector3): number {
    const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());

    if (denominator === 0) return Math.PI / 2;

    const theta = this.dot(v) / denominator;

    // (clamped: rounding can take it just past +-1)
    return Math.acos(clamp(theta, -1, 1));
  }

  distanceTo(v: Vector3Like): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v: Vector3Like): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  manhattanDistanceTo(v: Vector3Like): number {
    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z);
  }

  setFromSpherical(s: SphericalLike): this {
    return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
  }

  setFromSphericalCoords(radius: number, phi: number, theta: number): this {
    const sinPhiRadius = Math.sin(phi) * radius;

    this.x = sinPhiRadius * Math.sin(theta);
    this.y = Math.cos(phi) * radius;
    this.z = sinPhiRadius * Math.cos(theta);

    return this;
  }

  setFromCylindrical(c: CylindricalLike): this {
    return this.setFromCylindricalCoords(c.radius, c.theta, c.y);
  }

  setFromCylindricalCoords(radius: number, theta: number, y: number): this {
    this.x = radius * Math.sin(theta);
    this.y = y;
    this.z = radius * Math.cos(theta);

    return this;
  }

  setFromMatrixPosition(m: Matrix4): this {
    const e = m.elements;

    this.x = e[12];
    this.y = e[13];
    this.z = e[14];

    return this;
  }

  setFromMatrixScale(m: Matrix4): this {
    const sx = this.setFromMatrixColumn(m, 0).length();
    const sy = this.setFromMatrixColumn(m, 1).length();
    const sz = this.setFromMatrixColumn(m, 2).length();

    this.x = sx;
    this.y = sy;
    this.z = sz;

    return this;
  }

  setFromMatrixColumn(m: Matrix4, index: number): this {
    return this.fromArray(m.elements, index * 4);
  }

  setFromMatrix3Column(m: Matrix3, index: number): this {
    return this.fromArray(m.elements, index * 3);
  }

  setFromEuler(e: Euler): this {
    this.x = e._x;
    this.y = e._y;
    this.z = e._z;

    return this;
  }

  setFromColor(c: RgbLike): this {
    this.x = c.r;
    this.y = c.g;
    this.z = c.b;

    return this;
  }

  equals(v: Vector3Like): boolean {
    return v.x === this.x && v.y === this.y && v.z === this.z;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.x = array[offset]!;
    this.y = array[offset + 1]!;
    this.z = array[offset + 2]!;

    return this;
  }

  toArray<T extends NumberArray = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;

    return array;
  }

  fromBufferAttribute(attribute: Pick<AttributeLike, "getX" | "getY" | "getZ">, index: number): this {
    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    this.z = attribute.getZ(index);

    return this;
  }

  random(): this {
    // (mathUtils' seeded stream, not Math.random)
    this.x = random();
    this.y = random();
    this.z = random();

    return this;
  }

  randomDirection(): this {
    // (uniform on the sphere: https://mathworld.wolfram.com/SpherePointPicking.html)
    const theta = random() * Math.PI * 2;
    const u = random() * 2 - 1;
    const c = Math.sqrt(1 - u * u);

    this.x = c * Math.cos(theta);
    this.y = u;
    this.z = c * Math.sin(theta);

    return this;
  }

  *[Symbol.iterator](): Generator<number, void, unknown> {
    yield this.x;
    yield this.y;
    yield this.z;
  }
}

const _vector = /*@__PURE__*/ new Vector3();
const _quaternion = /*@__PURE__*/ new Quaternion();
