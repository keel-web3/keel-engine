// Ported from Three.js r180's math/Vector2.js (MIT, see packages/lit/NOTICE).

import { clamp, random } from "./mathUtils.ts";
import type { Matrix3 } from "./Matrix3.ts";
import type { AttributeLike, NumberArray } from "./types.ts";

/** Anything with an x and a y (a Vector2 fits). */
export interface Vector2Like {
  readonly x: number;
  readonly y: number;
}

export class Vector2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // (on the prototype, as r180 sets it: other code checks it)
  get isVector2(): true {
    return true;
  }

  get width(): number {
    return this.x;
  }

  set width(value: number) {
    this.x = value;
  }

  get height(): number {
    return this.y;
  }

  set height(value: number) {
    this.y = value;
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setScalar(scalar: number): this {
    this.x = scalar;
    this.y = scalar;
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

  setComponent(index: number, value: number): this {
    switch (index) {
      case 0: this.x = value; break;
      case 1: this.y = value; break;
      default: throw new Error("index is out of range: " + index);
    }
    return this;
  }

  getComponent(index: number): number {
    switch (index) {
      case 0: return this.x;
      case 1: return this.y;
      default: throw new Error("index is out of range: " + index);
    }
  }

  clone(): this {
    return new (this.constructor as new (x: number, y: number) => this)(this.x, this.y);
  }

  copy(v: Vector2Like): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  add(v: Vector2Like): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  addScalar(s: number): this {
    this.x += s;
    this.y += s;
    return this;
  }

  addVectors(a: Vector2Like, b: Vector2Like): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    return this;
  }

  addScaledVector(v: Vector2Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  sub(v: Vector2Like): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  subScalar(s: number): this {
    this.x -= s;
    this.y -= s;
    return this;
  }

  subVectors(a: Vector2Like, b: Vector2Like): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    return this;
  }

  multiply(v: Vector2Like): this {
    this.x *= v.x;
    this.y *= v.y;
    return this;
  }

  multiplyScalar(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  divide(v: Vector2Like): this {
    this.x /= v.x;
    this.y /= v.y;
    return this;
  }

  divideScalar(scalar: number): this {
    return this.multiplyScalar(1 / scalar);
  }

  applyMatrix3(m: Matrix3): this {
    const x = this.x, y = this.y;
    const e = m.elements;

    this.x = e[0] * x + e[3] * y + e[6];
    this.y = e[1] * x + e[4] * y + e[7];

    return this;
  }

  min(v: Vector2Like): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    return this;
  }

  max(v: Vector2Like): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    return this;
  }

  clamp(min: Vector2Like, max: Vector2Like): this {
    // (assumes min < max, componentwise)
    this.x = clamp(this.x, min.x, max.x);
    this.y = clamp(this.y, min.y, max.y);
    return this;
  }

  clampScalar(minVal: number, maxVal: number): this {
    this.x = clamp(this.x, minVal, maxVal);
    this.y = clamp(this.y, minVal, maxVal);
    return this;
  }

  clampLength(min: number, max: number): this {
    const length = this.length();
    return this.divideScalar(length || 1).multiplyScalar(clamp(length, min, max));
  }

  floor(): this {
    this.x = Math.floor(this.x);
    this.y = Math.floor(this.y);
    return this;
  }

  ceil(): this {
    this.x = Math.ceil(this.x);
    this.y = Math.ceil(this.y);
    return this;
  }

  round(): this {
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    return this;
  }

  roundToZero(): this {
    this.x = Math.trunc(this.x);
    this.y = Math.trunc(this.y);
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  }

  dot(v: Vector2Like): number {
    return this.x * v.x + this.y * v.y;
  }

  cross(v: Vector2Like): number {
    return this.x * v.y - this.y * v.x;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  manhattanLength(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }

  normalize(): this {
    return this.divideScalar(this.length() || 1);
  }

  angle(): number {
    // (the angle from +x, in [0, 2pi))
    const angle = Math.atan2(-this.y, -this.x) + Math.PI;
    return angle;
  }

  angleTo(v: Vector2): number {
    const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (denominator === 0) return Math.PI / 2;
    const theta = this.dot(v) / denominator;
    // (clamped: rounding can take it just past +-1)
    return Math.acos(clamp(theta, -1, 1));
  }

  distanceTo(v: Vector2Like): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v: Vector2Like): number {
    const dx = this.x - v.x, dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  manhattanDistanceTo(v: Vector2Like): number {
    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y);
  }

  setLength(length: number): this {
    return this.normalize().multiplyScalar(length);
  }

  lerp(v: Vector2Like, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    return this;
  }

  lerpVectors(v1: Vector2Like, v2: Vector2Like, alpha: number): this {
    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;
    return this;
  }

  equals(v: Vector2Like): boolean {
    return v.x === this.x && v.y === this.y;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.x = array[offset]!;
    this.y = array[offset + 1]!;
    return this;
  }

  toArray<T extends NumberArray = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    return array;
  }

  fromBufferAttribute(attribute: Pick<AttributeLike, "getX" | "getY">, index: number): this {
    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    return this;
  }

  rotateAround(center: Vector2Like, angle: number): this {
    const c = Math.cos(angle), s = Math.sin(angle);

    const x = this.x - center.x;
    const y = this.y - center.y;

    this.x = x * c - y * s + center.x;
    this.y = x * s + y * c + center.y;

    return this;
  }

  random(): this {
    // (mathUtils' seeded stream, not Math.random)
    this.x = random();
    this.y = random();
    return this;
  }

  *[Symbol.iterator](): Generator<number, void, unknown> {
    yield this.x;
    yield this.y;
  }
}
