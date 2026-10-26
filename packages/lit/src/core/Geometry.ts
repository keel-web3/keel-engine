// Ported from Three.js r180's core/BufferGeometry.js (MIT, see packages/lit/NOTICE).
// computeTangents, setIndirect and toJSON are not ported; there are no
// interleaved or GL attributes here, so those branches go too.

import { Vector3 } from "../math/Vector3.ts";
import { Box3 } from "../math/Box3.ts";
import { Sphere } from "../math/Sphere.ts";
import { Matrix4 } from "../math/Matrix4.ts";
import { Matrix3 } from "../math/Matrix3.ts";
import type { Quaternion } from "../math/Quaternion.ts";
import { generateUUID } from "../math/mathUtils.ts";
import { Emitter } from "./Emitter.ts";
import { Attribute } from "./Attribute.ts";
import type { AttributeArray } from "./Attribute.ts";
import { Node } from "./Node.ts";

/** A run of indices (or vertices) drawn with one of a mesh's materials. */
export interface GeometryGroup {
  start: number;
  count: number;
  materialIndex: number;
}

export interface DrawRange {
  start: number;
  count: number;
}

/** r180's arrayNeedsUint32: any index at or over 65535 (the primitive-restart index, #24565). */
function arrayNeedsUint32(array: ArrayLike<number>): boolean {
  // (larger values usually come last)
  for (let i = array.length - 1; i >= 0; --i) {
    if (array[i]! >= 65535) return true;
  }

  return false;
}

let _id = 0;

const _m1 = /*@__PURE__*/ new Matrix4();
const _obj = /*@__PURE__*/ new Node();
const _offset = /*@__PURE__*/ new Vector3();
const _box = /*@__PURE__*/ new Box3();
const _boxMorphTargets = /*@__PURE__*/ new Box3();
const _vector = /*@__PURE__*/ new Vector3();

/** Vertex data for a mesh: attributes, an optional index, groups and bounds (r180's BufferGeometry). */
export class Geometry extends Emitter {
  readonly isBufferGeometry = true;
  // (KEEL's name for the same flag)
  readonly isGeometry = true;

  declare readonly id: number;

  uuid: string;
  name: string;
  type: string;
  index: Attribute | null;
  indirect: Attribute | null;
  attributes: Record<string, Attribute>;
  morphAttributes: Record<string, Attribute[]>;
  morphTargetsRelative: boolean;
  groups: GeometryGroup[];
  boundingBox: Box3 | null;
  boundingSphere: Sphere | null;
  drawRange: DrawRange;
  userData: Record<string, unknown>;

  constructor() {
    super();

    Object.defineProperty(this, "id", { value: _id++ });

    this.uuid = generateUUID();
    this.name = "";
    this.type = "Geometry";
    this.index = null;
    this.indirect = null;
    this.attributes = {};
    this.morphAttributes = {};
    this.morphTargetsRelative = false;
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;
    this.drawRange = { start: 0, count: Infinity };
    this.userData = {};
  }

  getIndex(): Attribute | null {
    return this.index;
  }

  /** An attribute, or a plain array (Uint32 when an index reaches 65535, else Uint16). */
  setIndex(index: Attribute | readonly number[] | null): this {
    if (Array.isArray(index)) {
      const list = index as readonly number[];
      this.index = new Attribute(arrayNeedsUint32(list) ? new Uint32Array(list) : new Uint16Array(list), 1);
    } else {
      this.index = index as Attribute | null;
    }

    return this;
  }

  getAttribute(name: string): Attribute | undefined {
    return this.attributes[name];
  }

  setAttribute(name: string, attribute: Attribute): this {
    this.attributes[name] = attribute;
    return this;
  }

  deleteAttribute(name: string): this {
    delete this.attributes[name];
    return this;
  }

  hasAttribute(name: string): boolean {
    return this.attributes[name] !== undefined;
  }

  addGroup(start: number, count: number, materialIndex = 0): void {
    this.groups.push({
      start: start,
      count: count,
      materialIndex: materialIndex,
    });
  }

  clearGroups(): void {
    this.groups = [];
  }

  setDrawRange(start: number, count: number): void {
    this.drawRange.start = start;
    this.drawRange.count = count;
  }

  applyMatrix4(matrix: Matrix4): this {
    const position = this.attributes["position"];

    if (position !== undefined) {
      position.applyMatrix4(matrix);
      position.needsUpdate = true;
    }

    const normal = this.attributes["normal"];

    if (normal !== undefined) {
      const normalMatrix = new Matrix3().getNormalMatrix(matrix);

      normal.applyNormalMatrix(normalMatrix);
      normal.needsUpdate = true;
    }

    const tangent = this.attributes["tangent"];

    if (tangent !== undefined) {
      tangent.transformDirection(matrix);
      tangent.needsUpdate = true;
    }

    if (this.boundingBox !== null) {
      this.computeBoundingBox();
    }

    if (this.boundingSphere !== null) {
      this.computeBoundingSphere();
    }

    return this;
  }

  applyQuaternion(q: Quaternion): this {
    _m1.makeRotationFromQuaternion(q);
    this.applyMatrix4(_m1);
    return this;
  }

  rotateX(angle: number): this {
    _m1.makeRotationX(angle);
    this.applyMatrix4(_m1);
    return this;
  }

  rotateY(angle: number): this {
    _m1.makeRotationY(angle);
    this.applyMatrix4(_m1);
    return this;
  }

  rotateZ(angle: number): this {
    _m1.makeRotationZ(angle);
    this.applyMatrix4(_m1);
    return this;
  }

  translate(x: number, y: number, z: number): this {
    _m1.makeTranslation(x, y, z);
    this.applyMatrix4(_m1);
    return this;
  }

  scale(x: number, y: number, z: number): this {
    _m1.makeScale(x, y, z);
    this.applyMatrix4(_m1);
    return this;
  }

  lookAt(vector: Vector3): this {
    _obj.lookAt(vector);
    _obj.updateMatrix();
    this.applyMatrix4(_obj.matrix);
    return this;
  }

  center(): this {
    this.computeBoundingBox();

    this.boundingBox!.getCenter(_offset).negate();

    this.translate(_offset.x, _offset.y, _offset.z);

    return this;
  }

  setFromPoints(points: readonly { x: number; y: number; z?: number }[]): this {
    const positionAttribute = this.getAttribute("position");

    if (positionAttribute === undefined) {
      const position: number[] = [];

      for (let i = 0, l = points.length; i < l; i++) {
        const point = points[i]!;
        position.push(point.x, point.y, point.z || 0);
      }

      this.setAttribute("position", new Attribute(new Float32Array(position), 3));
    } else {
      // (no more points than the buffer holds)
      const l = Math.min(points.length, positionAttribute.count);

      for (let i = 0; i < l; i++) {
        const point = points[i]!;
        positionAttribute.setXYZ(i, point.x, point.y, point.z || 0);
      }

      if (points.length > positionAttribute.count) {
        console.warn("keel/lit Geometry: Buffer size too small for points data. Use .dispose() and create a new geometry.");
      }

      positionAttribute.needsUpdate = true;
    }

    return this;
  }

  computeBoundingBox(): void {
    if (this.boundingBox === null) {
      this.boundingBox = new Box3();
    }

    const position = this.attributes["position"];
    const morphAttributesPosition = this.morphAttributes["position"];

    if (position !== undefined) {
      this.boundingBox.setFromBufferAttribute(position);

      // (the morph targets stretch it)
      if (morphAttributesPosition) {
        for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
          const morphAttribute = morphAttributesPosition[i]!;
          _box.setFromBufferAttribute(morphAttribute);

          if (this.morphTargetsRelative) {
            _vector.addVectors(this.boundingBox.min, _box.min);
            this.boundingBox.expandByPoint(_vector);

            _vector.addVectors(this.boundingBox.max, _box.max);
            this.boundingBox.expandByPoint(_vector);
          } else {
            this.boundingBox.expandByPoint(_box.min);
            this.boundingBox.expandByPoint(_box.max);
          }
        }
      }
    } else {
      this.boundingBox.makeEmpty();
    }

    if (isNaN(this.boundingBox.min.x) || isNaN(this.boundingBox.min.y) || isNaN(this.boundingBox.min.z)) {
      console.error('keel/lit Geometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.', this);
    }
  }

  computeBoundingSphere(): void {
    if (this.boundingSphere === null) {
      this.boundingSphere = new Sphere();
    }

    const position = this.attributes["position"];
    const morphAttributesPosition = this.morphAttributes["position"];

    if (position) {
      // (first the centre: the box's)
      const center = this.boundingSphere.center;

      _box.setFromBufferAttribute(position);

      if (morphAttributesPosition) {
        for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
          const morphAttribute = morphAttributesPosition[i]!;
          _boxMorphTargets.setFromBufferAttribute(morphAttribute);

          if (this.morphTargetsRelative) {
            _vector.addVectors(_box.min, _boxMorphTargets.min);
            _box.expandByPoint(_vector);

            _vector.addVectors(_box.max, _boxMorphTargets.max);
            _box.expandByPoint(_vector);
          } else {
            _box.expandByPoint(_boxMorphTargets.min);
            _box.expandByPoint(_boxMorphTargets.max);
          }
        }
      }

      _box.getCenter(center);

      // (then the radius: the farthest vertex from it, which may be tighter than the box's)
      let maxRadiusSq = 0;

      for (let i = 0, il = position.count; i < il; i++) {
        _vector.fromBufferAttribute(position, i);
        maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
      }

      if (morphAttributesPosition) {
        for (let i = 0, il = morphAttributesPosition.length; i < il; i++) {
          const morphAttribute = morphAttributesPosition[i]!;
          const morphTargetsRelative = this.morphTargetsRelative;

          for (let j = 0, jl = morphAttribute.count; j < jl; j++) {
            _vector.fromBufferAttribute(morphAttribute, j);

            if (morphTargetsRelative) {
              _offset.fromBufferAttribute(position, j);
              _vector.add(_offset);
            }

            maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
          }
        }
      }

      this.boundingSphere.radius = Math.sqrt(maxRadiusSq);

      if (isNaN(this.boundingSphere.radius)) {
        console.error('keel/lit Geometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', this);
      }
    }
  }

  computeVertexNormals(): void {
    const index = this.index;
    const positionAttribute = this.getAttribute("position");

    if (positionAttribute !== undefined) {
      let normalAttribute = this.getAttribute("normal");

      if (normalAttribute === undefined) {
        normalAttribute = new Attribute(new Float32Array(positionAttribute.count * 3), 3);
        this.setAttribute("normal", normalAttribute);
      } else {
        // (reset existing normals to zero)
        for (let i = 0, il = normalAttribute.count; i < il; i++) {
          normalAttribute.setXYZ(i, 0, 0, 0);
        }
      }

      const pA = new Vector3(), pB = new Vector3(), pC = new Vector3();
      const nA = new Vector3(), nB = new Vector3(), nC = new Vector3();
      const cb = new Vector3(), ab = new Vector3();

      if (index) {
        // (indexed: face normals summed into each vertex)
        for (let i = 0, il = index.count; i < il; i += 3) {
          const vA = index.getX(i + 0);
          const vB = index.getX(i + 1);
          const vC = index.getX(i + 2);

          pA.fromBufferAttribute(positionAttribute, vA);
          pB.fromBufferAttribute(positionAttribute, vB);
          pC.fromBufferAttribute(positionAttribute, vC);

          cb.subVectors(pC, pB);
          ab.subVectors(pA, pB);
          cb.cross(ab);

          nA.fromBufferAttribute(normalAttribute, vA);
          nB.fromBufferAttribute(normalAttribute, vB);
          nC.fromBufferAttribute(normalAttribute, vC);

          nA.add(cb);
          nB.add(cb);
          nC.add(cb);

          normalAttribute.setXYZ(vA, nA.x, nA.y, nA.z);
          normalAttribute.setXYZ(vB, nB.x, nB.y, nB.z);
          normalAttribute.setXYZ(vC, nC.x, nC.y, nC.z);
        }
      } else {
        // (non-indexed: each triangle's own face normal)
        for (let i = 0, il = positionAttribute.count; i < il; i += 3) {
          pA.fromBufferAttribute(positionAttribute, i + 0);
          pB.fromBufferAttribute(positionAttribute, i + 1);
          pC.fromBufferAttribute(positionAttribute, i + 2);

          cb.subVectors(pC, pB);
          ab.subVectors(pA, pB);
          cb.cross(ab);

          normalAttribute.setXYZ(i + 0, cb.x, cb.y, cb.z);
          normalAttribute.setXYZ(i + 1, cb.x, cb.y, cb.z);
          normalAttribute.setXYZ(i + 2, cb.x, cb.y, cb.z);
        }
      }

      this.normalizeNormals();

      normalAttribute.needsUpdate = true;
    }
  }

  normalizeNormals(): void {
    const normals = this.attributes["normal"]!;

    for (let i = 0, il = normals.count; i < il; i++) {
      _vector.fromBufferAttribute(normals, i);
      _vector.normalize();
      normals.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }
  }

  /** A copy with every indexed vertex written out (or this, if it has no index). */
  toNonIndexed(): Geometry {
    function convertBufferAttribute(attribute: Attribute, indices: AttributeArray): Attribute {
      const array = attribute.array;
      const itemSize = attribute.itemSize;
      const normalized = attribute.normalized;

      const array2 = new (array.constructor as new (length: number) => AttributeArray)(indices.length * itemSize);

      let index = 0, index2 = 0;

      for (let i = 0, l = indices.length; i < l; i++) {
        index = indices[i]! * itemSize;

        for (let j = 0; j < itemSize; j++) {
          array2[index2++] = array[index++]!;
        }
      }

      return new Attribute(array2, itemSize, normalized);
    }

    if (this.index === null) {
      console.warn("keel/lit Geometry.toNonIndexed(): Geometry is already non-indexed.");
      return this;
    }

    const geometry2 = new Geometry();

    const indices = this.index.array;
    const attributes = this.attributes;

    for (const name in attributes) {
      const attribute = attributes[name]!;
      const newAttribute = convertBufferAttribute(attribute, indices);
      geometry2.setAttribute(name, newAttribute);
    }

    const morphAttributes = this.morphAttributes;

    for (const name in morphAttributes) {
      const morphArray: Attribute[] = [];
      const morphAttribute = morphAttributes[name]!;

      for (let i = 0, il = morphAttribute.length; i < il; i++) {
        const attribute = morphAttribute[i]!;
        const newAttribute = convertBufferAttribute(attribute, indices);
        morphArray.push(newAttribute);
      }

      geometry2.morphAttributes[name] = morphArray;
    }

    geometry2.morphTargetsRelative = this.morphTargetsRelative;

    const groups = this.groups;

    for (let i = 0, l = groups.length; i < l; i++) {
      const group = groups[i]!;
      geometry2.addGroup(group.start, group.count, group.materialIndex);
    }

    return geometry2;
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  copy(source: Geometry): this {
    // (reset)
    this.index = null;
    this.attributes = {};
    this.morphAttributes = {};
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;

    this.name = source.name;

    const index = source.index;

    if (index !== null) {
      this.setIndex(index.clone());
    }

    const attributes = source.attributes;

    for (const name in attributes) {
      const attribute = attributes[name]!;
      this.setAttribute(name, attribute.clone());
    }

    const morphAttributes = source.morphAttributes;

    for (const name in morphAttributes) {
      const array: Attribute[] = [];
      const morphAttribute = morphAttributes[name]!;

      for (let i = 0, l = morphAttribute.length; i < l; i++) {
        array.push(morphAttribute[i]!.clone());
      }

      this.morphAttributes[name] = array;
    }

    this.morphTargetsRelative = source.morphTargetsRelative;

    const groups = source.groups;

    for (let i = 0, l = groups.length; i < l; i++) {
      const group = groups[i]!;
      this.addGroup(group.start, group.count, group.materialIndex);
    }

    const boundingBox = source.boundingBox;

    if (boundingBox !== null) {
      this.boundingBox = boundingBox.clone();
    }

    const boundingSphere = source.boundingSphere;

    if (boundingSphere !== null) {
      this.boundingSphere = boundingSphere.clone();
    }

    this.drawRange.start = source.drawRange.start;
    this.drawRange.count = source.drawRange.count;

    this.userData = source.userData;

    return this;
  }

  dispose(): void {
    this.dispatchEvent({ type: "dispose" });
  }
}
