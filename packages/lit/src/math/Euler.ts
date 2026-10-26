// Ported from Three.js r180's math/Euler.js (MIT, see packages/lit/NOTICE).

import { Quaternion } from "./Quaternion.ts";
import { Matrix4 } from "./Matrix4.ts";
import { clamp } from "./mathUtils.ts";
import type { Vector3Like } from "./Vector3.ts";
import type { EulerOrder } from "./types.ts";

export class Euler {
  // (the order the axes turn in, intrinsic: "XYZ" turns about x, then the new y, then the new z)
  static DEFAULT_ORDER: EulerOrder = "XYZ";

  readonly isEuler = true;

  // (the angles in radians: set through x, y, z and order to fire the change callback)
  _x: number;
  _y: number;
  _z: number;
  _order: EulerOrder;

  constructor(x = 0, y = 0, z = 0, order: EulerOrder = Euler.DEFAULT_ORDER) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;
  }

  get x(): number {
    return this._x;
  }

  set x(value: number) {
    this._x = value;
    this._onChangeCallback();
  }

  get y(): number {
    return this._y;
  }

  set y(value: number) {
    this._y = value;
    this._onChangeCallback();
  }

  get z(): number {
    return this._z;
  }

  set z(value: number) {
    this._z = value;
    this._onChangeCallback();
  }

  get order(): EulerOrder {
    return this._order;
  }

  set order(value: EulerOrder) {
    this._order = value;
    this._onChangeCallback();
  }

  set(x: number, y: number, z: number, order: EulerOrder = this._order): this {
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;

    this._onChangeCallback();

    return this;
  }

  clone(): this {
    return new (this.constructor as new (x: number, y: number, z: number, order: EulerOrder) => this)(this._x, this._y, this._z, this._order);
  }

  copy(euler: Euler): this {
    this._x = euler._x;
    this._y = euler._y;
    this._z = euler._z;
    this._order = euler._order;

    this._onChangeCallback();

    return this;
  }

  setFromRotationMatrix(m: Matrix4, order: EulerOrder = this._order, update = true): this {
    // (the upper 3x3 is taken to be a pure, unscaled rotation)
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];

    switch (order) {
      case "XYZ":
        this._y = Math.asin(clamp(m13, - 1, 1));

        if (Math.abs(m13) < 0.9999999) {
          this._x = Math.atan2(- m23, m33);
          this._z = Math.atan2(- m12, m11);
        } else {
          this._x = Math.atan2(m32, m22);
          this._z = 0;
        }

        break;

      case "YXZ":
        this._x = Math.asin(- clamp(m23, - 1, 1));

        if (Math.abs(m23) < 0.9999999) {
          this._y = Math.atan2(m13, m33);
          this._z = Math.atan2(m21, m22);
        } else {
          this._y = Math.atan2(- m31, m11);
          this._z = 0;
        }

        break;

      case "ZXY":
        this._x = Math.asin(clamp(m32, - 1, 1));

        if (Math.abs(m32) < 0.9999999) {
          this._y = Math.atan2(- m31, m33);
          this._z = Math.atan2(- m12, m22);
        } else {
          this._y = 0;
          this._z = Math.atan2(m21, m11);
        }

        break;

      case "ZYX":
        this._y = Math.asin(- clamp(m31, - 1, 1));

        if (Math.abs(m31) < 0.9999999) {
          this._x = Math.atan2(m32, m33);
          this._z = Math.atan2(m21, m11);
        } else {
          this._x = 0;
          this._z = Math.atan2(- m12, m22);
        }

        break;

      case "YZX":
        this._z = Math.asin(clamp(m21, - 1, 1));

        if (Math.abs(m21) < 0.9999999) {
          this._x = Math.atan2(- m23, m22);
          this._y = Math.atan2(- m31, m11);
        } else {
          this._x = 0;
          this._y = Math.atan2(m13, m33);
        }

        break;

      case "XZY":
        this._z = Math.asin(- clamp(m12, - 1, 1));

        if (Math.abs(m12) < 0.9999999) {
          this._x = Math.atan2(m32, m22);
          this._y = Math.atan2(m13, m11);
        } else {
          this._x = Math.atan2(- m23, m33);
          this._y = 0;
        }

        break;

      default:
        console.warn("keel/lit Euler: setFromRotationMatrix() met an unknown order: " + String(order));
    }

    this._order = order;

    if (update === true) this._onChangeCallback();

    return this;
  }

  setFromQuaternion(q: Quaternion, order?: EulerOrder, update?: boolean): this {
    _matrix.makeRotationFromQuaternion(q);

    // (undefined order and update fall to their defaults, as in r180)
    return this.setFromRotationMatrix(_matrix, order, update);
  }

  setFromVector3(v: Vector3Like, order: EulerOrder = this._order): this {
    return this.set(v.x, v.y, v.z, order);
  }

  reorder(newOrder: EulerOrder): this {
    // (through a quaternion: the change discards revolution information, as r180 warns)
    _quaternion.setFromEuler(this);

    return this.setFromQuaternion(_quaternion, newOrder);
  }

  equals(euler: Euler): boolean {
    return (euler._x === this._x) && (euler._y === this._y) && (euler._z === this._z) && (euler._order === this._order);
  }

  fromArray(array: readonly [number, number, number, EulerOrder?] | ArrayLike<number | EulerOrder | undefined>): this {
    this._x = array[0] as number;
    this._y = array[1] as number;
    this._z = array[2] as number;
    if (array[3] !== undefined) this._order = array[3] as EulerOrder;

    this._onChangeCallback();

    return this;
  }

  toArray<T extends { [index: number]: number | string } = Array<number | string>>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this._x;
    array[offset + 1] = this._y;
    array[offset + 2] = this._z;
    array[offset + 3] = this._order;

    return array;
  }

  _onChange(callback: () => void): this {
    this._onChangeCallback = callback;

    return this;
  }

  _onChangeCallback(): void {}

  *[Symbol.iterator](): Generator<number | EulerOrder, void, unknown> {
    yield this._x;
    yield this._y;
    yield this._z;
    yield this._order;
  }
}

const _matrix = /*@__PURE__*/ new Matrix4();
const _quaternion = /*@__PURE__*/ new Quaternion();
