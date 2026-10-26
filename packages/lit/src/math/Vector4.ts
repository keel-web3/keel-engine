// Ported from Three.js r180's math/Vector4.js (MIT, see packages/lit/NOTICE).

import { clamp, random } from "./mathUtils.ts";
import type { Matrix4 } from "./Matrix4.ts";
import type { Quaternion } from "./Quaternion.ts";
import type { AttributeLike, NumberArray } from "./types.ts";

/** Anything with an x, y, z and w (a Vector4 fits). */
export interface Vector4Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export class Vector4 {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  // (on the prototype, as r180 sets it: other code checks it)
  get isVector4(): true {
    return true;
  }

  get width(): number {
    return this.z;
  }

  set width(value: number) {
    this.z = value;
  }

  get height(): number {
    return this.w;
  }

  set height(value: number) {
    this.w = value;
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  setScalar(scalar: number): this {
    this.x = scalar;
    this.y = scalar;
    this.z = scalar;
    this.w = scalar;
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

  setW(w: number): this {
    this.w = w;
    return this;
  }

  setComponent(index: number, value: number): this {
    switch (index) {
      case 0: this.x = value; break;
      case 1: this.y = value; break;
      case 2: this.z = value; break;
      case 3: this.w = value; break;
      default: throw new Error("index is out of range: " + index);
    }
    return this;
  }

  getComponent(index: number): number {
    switch (index) {
      case 0: return this.x;
      case 1: return this.y;
      case 2: return this.z;
      case 3: return this.w;
      default: throw new Error("index is out of range: " + index);
    }
  }

  clone(): this {
    return new (this.constructor as new (x: number, y: number, z: number, w: number) => this)(this.x, this.y, this.z, this.w);
  }

  copy(v: { readonly x: number; readonly y: number; readonly z: number; readonly w?: number }): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    // (a Vector3 copies in with w = 1)
    this.w = v.w !== undefined ? v.w : 1;
    return this;
  }

  add(v: Vector4Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.w += v.w;
    return this;
  }

  addScalar(s: number): this {
    this.x += s;
    this.y += s;
    this.z += s;
    this.w += s;
    return this;
  }

  addVectors(a: Vector4Like, b: Vector4Like): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    this.w = a.w + b.w;
    return this;
  }

  addScaledVector(v: Vector4Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    this.w += v.w * s;
    return this;
  }

  sub(v: Vector4Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.w -= v.w;
    return this;
  }

  subScalar(s: number): this {
    this.x -= s;
    this.y -= s;
    this.z -= s;
    this.w -= s;
    return this;
  }

  subVectors(a: Vector4Like, b: Vector4Like): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    this.w = a.w - b.w;
    return this;
  }

  multiply(v: Vector4Like): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    this.w *= v.w;
    return this;
  }

  multiplyScalar(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    this.w *= scalar;
    return this;
  }

  applyMatrix4(m: Matrix4): this {
    const x = this.x, y = this.y, z = this.z, w = this.w;
    const e = m.elements;

    this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
    this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;

    return this;
  }

  divide(v: Vector4Like): this {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    this.w /= v.w;
    return this;
  }

  divideScalar(scalar: number): this {
    return this.multiplyScalar(1 / scalar);
  }

  setAxisAngleFromQuaternion(q: Quaternion): this {
    // (q is taken to be normalized)
    this.w = 2 * Math.acos(q.w);

    const s = Math.sqrt(1 - q.w * q.w);

    if (s < 0.0001) {
      this.x = 1;
      this.y = 0;
      this.z = 0;
    } else {
      this.x = q.x / s;
      this.y = q.y / s;
      this.z = q.z / s;
    }

    return this;
  }

  setAxisAngleFromRotationMatrix(m: Matrix4): this {
    // (the upper 3x3 is taken to be a pure rotation)
    let angle: number, x: number, y: number, z: number;
    const epsilon = 0.01, // (margin for rounding errors)
      epsilon2 = 0.1, // (margin to tell 0 degrees from 180)
      te = m.elements,
      m11 = te[0], m12 = te[4], m13 = te[8],
      m21 = te[1], m22 = te[5], m23 = te[9],
      m31 = te[2], m32 = te[6], m33 = te[10];

    if (
      Math.abs(m12 - m21) < epsilon &&
      Math.abs(m13 - m31) < epsilon &&
      Math.abs(m23 - m32) < epsilon
    ) {
      // (symmetric: an angle of 0 or 180 degrees)
      if (
        Math.abs(m12 + m21) < epsilon2 &&
        Math.abs(m13 + m31) < epsilon2 &&
        Math.abs(m23 + m32) < epsilon2 &&
        Math.abs(m11 + m22 + m33 - 3) < epsilon2
      ) {
        this.set(1, 0, 0, 0);
        return this; // (zero angle, any axis)
      }

      angle = Math.PI;

      const xx = (m11 + 1) / 2;
      const yy = (m22 + 1) / 2;
      const zz = (m33 + 1) / 2;
      const xy = (m12 + m21) / 4;
      const xz = (m13 + m31) / 4;
      const yz = (m23 + m32) / 4;

      if (xx > yy && xx > zz) {
        if (xx < epsilon) {
          x = 0;
          y = 0.707106781;
          z = 0.707106781;
        } else {
          x = Math.sqrt(xx);
          y = xy / x;
          z = xz / x;
        }
      } else if (yy > zz) {
        if (yy < epsilon) {
          x = 0.707106781;
          y = 0;
          z = 0.707106781;
        } else {
          y = Math.sqrt(yy);
          x = xy / y;
          z = yz / y;
        }
      } else {
        if (zz < epsilon) {
          x = 0.707106781;
          y = 0.707106781;
          z = 0;
        } else {
          z = Math.sqrt(zz);
          x = xz / z;
          y = yz / z;
        }
      }

      this.set(x, y, z, angle);
      return this; // (a 180 degree turn)
    }

    let s = Math.sqrt(
      (m32 - m23) * (m32 - m23) +
      (m13 - m31) * (m13 - m31) +
      (m21 - m12) * (m21 - m12),
    ); // (to normalize)

    if (Math.abs(s) < 0.001) s = 1;

    // (no 0 or 180 degree singularity left: the plain formula)
    this.x = (m32 - m23) / s;
    this.y = (m13 - m31) / s;
    this.z = (m21 - m12) / s;
    this.w = Math.acos((m11 + m22 + m33 - 1) / 2);

    return this;
  }

  setFromMatrixPosition(m: Matrix4): this {
    const e = m.elements;

    this.x = e[12];
    this.y = e[13];
    this.z = e[14];
    this.w = e[15];

    return this;
  }

  min(v: Vector4Like): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    this.w = Math.min(this.w, v.w);
    return this;
  }

  max(v: Vector4Like): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    this.w = Math.max(this.w, v.w);
    return this;
  }

  clamp(min: Vector4Like, max: Vector4Like): this {
    // (assumes min < max, componentwise)
    this.x = clamp(this.x, min.x, max.x);
    this.y = clamp(this.y, min.y, max.y);
    this.z = clamp(this.z, min.z, max.z);
    this.w = clamp(this.w, min.w, max.w);
    return this;
  }

  clampScalar(minVal: number, maxVal: number): this {
    this.x = clamp(this.x, minVal, maxVal);
    this.y = clamp(this.y, minVal, maxVal);
    this.z = clamp(this.z, minVal, maxVal);
    this.w = clamp(this.w, minVal, maxVal);
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
    this.w = Math.floor(this.w);
    return this;
  }

  ceil(): this {
    this.x = Math.ceil(this.x);
    this.y = Math.ceil(this.y);
    this.z = Math.ceil(this.z);
    this.w = Math.ceil(this.w);
    return this;
  }

  round(): this {
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    this.z = Math.round(this.z);
    this.w = Math.round(this.w);
    return this;
  }

  roundToZero(): this {
    this.x = Math.trunc(this.x);
    this.y = Math.trunc(this.y);
    this.z = Math.trunc(this.z);
    this.w = Math.trunc(this.w);
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.w = -this.w;
    return this;
  }

  dot(v: Vector4Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }

  manhattanLength(): number {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);
  }

  normalize(): this {
    return this.divideScalar(this.length() || 1);
  }

  setLength(length: number): this {
    return this.normalize().multiplyScalar(length);
  }

  lerp(v: Vector4Like, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    this.w += (v.w - this.w) * alpha;
    return this;
  }

  lerpVectors(v1: Vector4Like, v2: Vector4Like, alpha: number): this {
    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;
    this.z = v1.z + (v2.z - v1.z) * alpha;
    this.w = v1.w + (v2.w - v1.w) * alpha;
    return this;
  }

  equals(v: Vector4Like): boolean {
    return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.x = array[offset]!;
    this.y = array[offset + 1]!;
    this.z = array[offset + 2]!;
    this.w = array[offset + 3]!;
    return this;
  }

  toArray<T extends NumberArray = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    array[offset + 3] = this.w;
    return array;
  }

  fromBufferAttribute(attribute: Pick<AttributeLike, "getX" | "getY" | "getZ" | "getW">, index: number): this {
    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    this.z = attribute.getZ(index);
    this.w = attribute.getW(index);
    return this;
  }

  random(): this {
    // (mathUtils' seeded stream, not Math.random)
    this.x = random();
    this.y = random();
    this.z = random();
    this.w = random();
    return this;
  }

  *[Symbol.iterator](): Generator<number, void, unknown> {
    yield this.x;
    yield this.y;
    yield this.z;
    yield this.w;
  }
}
