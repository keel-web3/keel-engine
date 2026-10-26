// Ported from Three.js r180's core/BufferAttribute.js (MIT, see packages/lit/NOTICE).
// One class for r180's BufferAttribute and its typed subclasses: the array's
// type is the attribute's type (`new Attribute(new Float32Array(data), 3)` is
// r180's `new Float32BufferAttribute(data, 3)`). Float16BufferAttribute is not ported.

import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import { denormalize, normalize } from "../math/mathUtils.ts";
import type { Matrix3 } from "../math/Matrix3.ts";
import type { Matrix4 } from "../math/Matrix4.ts";
import type { TextureType, Usage } from "../constants.ts";

/** The typed arrays an attribute holds (the ones r180's normalize reads). */
export type AttributeArray = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array;

export interface UpdateRange {
  start: number;
  count: number;
}

const _vector = /*@__PURE__*/ new Vector3();
const _vector2 = /*@__PURE__*/ new Vector2();

let _id = 0;

export class Attribute<A extends AttributeArray = AttributeArray> {
  readonly isBufferAttribute = true;
  // (KEEL's name for the same flag)
  readonly isAttribute = true;

  declare readonly id: number;

  name: string;
  array: A;
  itemSize: number;
  count: number;
  normalized: boolean;
  usage: Usage;
  updateRanges: UpdateRange[];
  /** The type the GPU reads integer data as ("float" or "int"; r180's FloatType / IntType). */
  gpuType: TextureType;
  version: number;

  constructor(array: A, itemSize: number, normalized = false) {
    if (Array.isArray(array)) {
      throw new TypeError("keel/lit Attribute: array should be a Typed Array.");
    }

    Object.defineProperty(this, "id", { value: _id++ });

    this.name = "";
    this.array = array;
    this.itemSize = itemSize;
    this.count = array !== undefined ? array.length / itemSize : 0;
    this.normalized = normalized;
    this.usage = "static";
    this.updateRanges = [];
    this.gpuType = "float";
    this.version = 0;
  }

  onUploadCallback(): void {}

  set needsUpdate(value: boolean) {
    if (value === true) this.version++;
  }

  setUsage(value: Usage): this {
    this.usage = value;
    return this;
  }

  addUpdateRange(start: number, count: number): void {
    this.updateRanges.push({ start, count });
  }

  clearUpdateRanges(): void {
    this.updateRanges.length = 0;
  }

  copy(source: Attribute): this {
    this.name = source.name;
    this.array = new (source.array.constructor as new (a: ArrayLike<number>) => A)(source.array);
    this.itemSize = source.itemSize;
    this.count = source.count;
    this.normalized = source.normalized;

    this.usage = source.usage;
    this.gpuType = source.gpuType;

    return this;
  }

  copyAt(index1: number, attribute: Attribute, index2: number): this {
    index1 *= this.itemSize;
    index2 *= attribute.itemSize;

    for (let i = 0, l = this.itemSize; i < l; i++) {
      this.array[index1 + i] = attribute.array[index2 + i]!;
    }

    return this;
  }

  copyArray(array: ArrayLike<number>): this {
    this.array.set(array);
    return this;
  }

  applyMatrix3(m: Matrix3): this {
    if (this.itemSize === 2) {
      for (let i = 0, l = this.count; i < l; i++) {
        _vector2.fromBufferAttribute(this, i);
        _vector2.applyMatrix3(m);

        this.setXY(i, _vector2.x, _vector2.y);
      }
    } else if (this.itemSize === 3) {
      for (let i = 0, l = this.count; i < l; i++) {
        _vector.fromBufferAttribute(this, i);
        _vector.applyMatrix3(m);

        this.setXYZ(i, _vector.x, _vector.y, _vector.z);
      }
    }

    return this;
  }

  applyMatrix4(m: Matrix4): this {
    for (let i = 0, l = this.count; i < l; i++) {
      _vector.fromBufferAttribute(this, i);
      _vector.applyMatrix4(m);

      this.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }

    return this;
  }

  applyNormalMatrix(m: Matrix3): this {
    for (let i = 0, l = this.count; i < l; i++) {
      _vector.fromBufferAttribute(this, i);
      _vector.applyNormalMatrix(m);

      this.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }

    return this;
  }

  transformDirection(m: Matrix4): this {
    for (let i = 0, l = this.count; i < l; i++) {
      _vector.fromBufferAttribute(this, i);
      _vector.transformDirection(m);

      this.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }

    return this;
  }

  set(value: ArrayLike<number>, offset = 0): this {
    // (as the constructor: the array is not normalized)
    this.array.set(value, offset);
    return this;
  }

  getComponent(index: number, component: number): number {
    let value = this.array[index * this.itemSize + component]!;
    if (this.normalized) value = denormalize(value, this.array);
    return value;
  }

  setComponent(index: number, component: number, value: number): this {
    if (this.normalized) value = normalize(value, this.array);
    this.array[index * this.itemSize + component] = value;
    return this;
  }

  getX(index: number): number {
    let x = this.array[index * this.itemSize]!;
    if (this.normalized) x = denormalize(x, this.array);
    return x;
  }

  setX(index: number, x: number): this {
    if (this.normalized) x = normalize(x, this.array);
    this.array[index * this.itemSize] = x;
    return this;
  }

  getY(index: number): number {
    let y = this.array[index * this.itemSize + 1]!;
    if (this.normalized) y = denormalize(y, this.array);
    return y;
  }

  setY(index: number, y: number): this {
    if (this.normalized) y = normalize(y, this.array);
    this.array[index * this.itemSize + 1] = y;
    return this;
  }

  getZ(index: number): number {
    let z = this.array[index * this.itemSize + 2]!;
    if (this.normalized) z = denormalize(z, this.array);
    return z;
  }

  setZ(index: number, z: number): this {
    if (this.normalized) z = normalize(z, this.array);
    this.array[index * this.itemSize + 2] = z;
    return this;
  }

  getW(index: number): number {
    let w = this.array[index * this.itemSize + 3]!;
    if (this.normalized) w = denormalize(w, this.array);
    return w;
  }

  setW(index: number, w: number): this {
    if (this.normalized) w = normalize(w, this.array);
    this.array[index * this.itemSize + 3] = w;
    return this;
  }

  setXY(index: number, x: number, y: number): this {
    index *= this.itemSize;

    if (this.normalized) {
      x = normalize(x, this.array);
      y = normalize(y, this.array);
    }

    this.array[index + 0] = x;
    this.array[index + 1] = y;

    return this;
  }

  setXYZ(index: number, x: number, y: number, z: number): this {
    index *= this.itemSize;

    if (this.normalized) {
      x = normalize(x, this.array);
      y = normalize(y, this.array);
      z = normalize(z, this.array);
    }

    this.array[index + 0] = x;
    this.array[index + 1] = y;
    this.array[index + 2] = z;

    return this;
  }

  setXYZW(index: number, x: number, y: number, z: number, w: number): this {
    index *= this.itemSize;

    if (this.normalized) {
      x = normalize(x, this.array);
      y = normalize(y, this.array);
      z = normalize(z, this.array);
      w = normalize(w, this.array);
    }

    this.array[index + 0] = x;
    this.array[index + 1] = y;
    this.array[index + 2] = z;
    this.array[index + 3] = w;

    return this;
  }

  onUpload(callback: () => void): this {
    this.onUploadCallback = callback;
    return this;
  }

  clone(): this {
    return new (this.constructor as new (array: A, itemSize: number) => this)(this.array, this.itemSize).copy(this);
  }
}

/** Per-instance data (r180's InstancedBufferAttribute): one item per `meshPerAttribute` instances. */
export class InstanceAttribute<A extends AttributeArray = AttributeArray> extends Attribute<A> {
  readonly isInstancedBufferAttribute = true;
  // (KEEL's name for the same flag)
  readonly isInstanceAttribute = true;

  meshPerAttribute: number;

  constructor(array: A, itemSize: number, normalized?: boolean, meshPerAttribute = 1) {
    super(array, itemSize, normalized);
    this.meshPerAttribute = meshPerAttribute;
  }

  override copy(source: Attribute): this {
    super.copy(source);
    this.meshPerAttribute = (source as InstanceAttribute).meshPerAttribute;
    return this;
  }
}
