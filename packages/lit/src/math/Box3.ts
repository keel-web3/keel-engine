// Ported from Three.js r180's math/Box3.js (MIT, see packages/lit/NOTICE).

import { Vector3 } from "./Vector3.ts";
import type { Vector3Like } from "./Vector3.ts";
import type { Matrix4 } from "./Matrix4.ts";
import type { Plane } from "./Plane.ts";
import type { Sphere } from "./Sphere.ts";
import type { AttributeLike } from "./types.ts";

/** A geometry, as setFromObject and expandByObject read it (core's Geometry fits). */
export interface BoundsGeometry {
  getAttribute(name: "position"): AttributeLike | undefined;
  boundingBox: Box3 | null;
  computeBoundingBox(): void;
}

/** A node, as setFromObject and expandByObject read it (core's Node and the meshes fit). */
export interface BoundsSource {
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void;
  readonly matrixWorld: Matrix4;
  readonly children: readonly BoundsSource[];
  readonly geometry?: BoundsGeometry | undefined;
  // (an instanced mesh or batch keeps its own box)
  boundingBox?: Box3 | null;
  computeBoundingBox?(): void;
  readonly isMesh?: boolean;
  readonly isInstancedMesh?: boolean;
  getVertexPosition?(index: number, target: Vector3): Vector3;
}

/** A triangle's corners (r180's Triangle fits). */
export interface TriangleLike {
  readonly a: Vector3Like;
  readonly b: Vector3Like;
  readonly c: Vector3Like;
}

export class Box3 {
  readonly isBox3 = true;

  min: Vector3;
  max: Vector3;

  // (empty by default: min at +Infinity, max at -Infinity)
  constructor(min = new Vector3(+ Infinity, + Infinity, + Infinity), max = new Vector3(- Infinity, - Infinity, - Infinity)) {
    this.min = min;
    this.max = max;
  }

  set(min: Vector3Like, max: Vector3Like): this {
    this.min.copy(min);
    this.max.copy(max);

    return this;
  }

  setFromArray(array: ArrayLike<number>): this {
    this.makeEmpty();

    for (let i = 0, il = array.length; i < il; i += 3) {
      this.expandByPoint(_vector.fromArray(array, i));
    }

    return this;
  }

  setFromBufferAttribute(attribute: Pick<AttributeLike, "count" | "getX" | "getY" | "getZ">): this {
    this.makeEmpty();

    for (let i = 0, il = attribute.count; i < il; i++) {
      this.expandByPoint(_vector.fromBufferAttribute(attribute, i));
    }

    return this;
  }

  setFromPoints(points: readonly Vector3Like[]): this {
    this.makeEmpty();

    for (let i = 0, il = points.length; i < il; i++) {
      this.expandByPoint(points[i]!);
    }

    return this;
  }

  setFromCenterAndSize(center: Vector3Like, size: Vector3Like): this {
    const halfSize = _vector.copy(size).multiplyScalar(0.5);

    this.min.copy(center).sub(halfSize);
    this.max.copy(center).add(halfSize);

    return this;
  }

  setFromObject(object: BoundsSource, precise = false): this {
    this.makeEmpty();

    return this.expandByObject(object, precise);
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  copy(box: Box3): this {
    this.min.copy(box.min);
    this.max.copy(box.max);

    return this;
  }

  makeEmpty(): this {
    this.min.x = this.min.y = this.min.z = + Infinity;
    this.max.x = this.max.y = this.max.z = - Infinity;

    return this;
  }

  isEmpty(): boolean {
    // (a box with min = max holds one point, and is not empty)
    return (this.max.x < this.min.x) || (this.max.y < this.min.y) || (this.max.z < this.min.z);
  }

  getCenter<T extends Vector3>(target: T): T {
    return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }

  getSize<T extends Vector3>(target: T): T {
    return this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min);
  }

  expandByPoint(point: Vector3Like): this {
    this.min.min(point);
    this.max.max(point);

    return this;
  }

  expandByVector(vector: Vector3Like): this {
    this.min.sub(vector);
    this.max.add(vector);

    return this;
  }

  expandByScalar(scalar: number): this {
    this.min.addScalar(- scalar);
    this.max.addScalar(scalar);

    return this;
  }

  expandByObject(object: BoundsSource, precise = false): this {
    // (the world-space box of the object and its children; the world matrices are brought up to date first)
    object.updateWorldMatrix(false, false);

    const geometry = object.geometry;

    if (geometry !== undefined) {
      const positionAttribute = geometry.getAttribute("position");

      // (precise: every vertex, through the world matrix; skipped for instanced meshes)
      if (precise === true && positionAttribute !== undefined && object.isInstancedMesh !== true) {
        for (let i = 0, l = positionAttribute.count; i < l; i++) {
          if (object.isMesh === true) {
            object.getVertexPosition!(i, _vector);
          } else {
            _vector.fromBufferAttribute(positionAttribute, i);
          }

          _vector.applyMatrix4(object.matrixWorld);
          this.expandByPoint(_vector);
        }
      } else {
        if (object.boundingBox !== undefined) {
          // (an object with its own box: instanced meshes, batches)
          if (object.boundingBox === null) {
            object.computeBoundingBox!();
          }

          _box.copy(object.boundingBox!);
        } else {
          // (the geometry's box)
          if (geometry.boundingBox === null) {
            geometry.computeBoundingBox();
          }

          _box.copy(geometry.boundingBox!);
        }

        _box.applyMatrix4(object.matrixWorld);

        this.union(_box);
      }
    }

    const children = object.children;

    for (let i = 0, l = children.length; i < l; i++) {
      this.expandByObject(children[i]!, precise);
    }

    return this;
  }

  containsPoint(point: Vector3Like): boolean {
    return point.x >= this.min.x && point.x <= this.max.x &&
      point.y >= this.min.y && point.y <= this.max.y &&
      point.z >= this.min.z && point.z <= this.max.z;
  }

  containsBox(box: Box3): boolean {
    return this.min.x <= box.min.x && box.max.x <= this.max.x &&
      this.min.y <= box.min.y && box.max.y <= this.max.y &&
      this.min.z <= box.min.z && box.max.z <= this.max.z;
  }

  getParameter<T extends Vector3>(point: Vector3Like, target: T): T {
    // (where the point sits in the box, 0 to 1 per axis)
    return target.set(
      (point.x - this.min.x) / (this.max.x - this.min.x),
      (point.y - this.min.y) / (this.max.y - this.min.y),
      (point.z - this.min.z) / (this.max.z - this.min.z),
    );
  }

  intersectsBox(box: Box3): boolean {
    // (separating axes: six planes)
    return box.max.x >= this.min.x && box.min.x <= this.max.x &&
      box.max.y >= this.min.y && box.min.y <= this.max.y &&
      box.max.z >= this.min.z && box.min.z <= this.max.z;
  }

  intersectsSphere(sphere: Sphere): boolean {
    // (the box point nearest the sphere's centre)
    this.clampPoint(sphere.center, _vector);

    // (inside the sphere, then they meet)
    return _vector.distanceToSquared(sphere.center) <= (sphere.radius * sphere.radius);
  }

  intersectsPlane(plane: Plane): boolean {
    // (the box's nearest and farthest corners along the normal, then are they either side of the plane:
    // http://www.gamedev.net/topic/646404-box-vs-plane-collision-detection/)
    let min: number, max: number;

    if (plane.normal.x > 0) {
      min = plane.normal.x * this.min.x;
      max = plane.normal.x * this.max.x;
    } else {
      min = plane.normal.x * this.max.x;
      max = plane.normal.x * this.min.x;
    }

    if (plane.normal.y > 0) {
      min += plane.normal.y * this.min.y;
      max += plane.normal.y * this.max.y;
    } else {
      min += plane.normal.y * this.max.y;
      max += plane.normal.y * this.min.y;
    }

    if (plane.normal.z > 0) {
      min += plane.normal.z * this.min.z;
      max += plane.normal.z * this.max.z;
    } else {
      min += plane.normal.z * this.max.z;
      max += plane.normal.z * this.min.z;
    }

    return (min <= - plane.constant && max >= - plane.constant);
  }

  intersectsTriangle(triangle: TriangleLike): boolean {
    if (this.isEmpty()) {
      return false;
    }

    // (the box's centre and half-extents)
    this.getCenter(_center);
    _extents.subVectors(this.max, _center);

    // (the triangle, moved so the box sits at the origin)
    _v0.subVectors(triangle.a, _center);
    _v1.subVectors(triangle.b, _center);
    _v2.subVectors(triangle.c, _center);

    // (its edges)
    _f0.subVectors(_v1, _v0);
    _f1.subVectors(_v2, _v1);
    _f2.subVectors(_v0, _v2);

    // (the nine axes from the box's axes crossed with the edges, then the box's three, then the triangle's normal)
    let axes = [
      0, - _f0.z, _f0.y, 0, - _f1.z, _f1.y, 0, - _f2.z, _f2.y,
      _f0.z, 0, - _f0.x, _f1.z, 0, - _f1.x, _f2.z, 0, - _f2.x,
      - _f0.y, _f0.x, 0, - _f1.y, _f1.x, 0, - _f2.y, _f2.x, 0,
    ];
    if (!satForAxes(axes, _v0, _v1, _v2, _extents)) {
      return false;
    }

    axes = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (!satForAxes(axes, _v0, _v1, _v2, _extents)) {
      return false;
    }

    _triangleNormal.crossVectors(_f0, _f1);
    axes = [_triangleNormal.x, _triangleNormal.y, _triangleNormal.z];

    return satForAxes(axes, _v0, _v1, _v2, _extents);
  }

  clampPoint<T extends Vector3>(point: Vector3Like, target: T): T {
    return target.copy(point).clamp(this.min, this.max);
  }

  distanceToPoint(point: Vector3Like): number {
    return this.clampPoint(point, _vector).distanceTo(point);
  }

  getBoundingSphere<T extends Sphere>(target: T): T {
    if (this.isEmpty()) {
      target.makeEmpty();
    } else {
      this.getCenter(target.center);

      target.radius = this.getSize(_vector).length() * 0.5;
    }

    return target;
  }

  intersect(box: Box3): this {
    this.min.max(box.min);
    this.max.min(box.max);

    // (no overlap: empty, rather than inside out)
    if (this.isEmpty()) this.makeEmpty();

    return this;
  }

  union(box: Box3): this {
    this.min.min(box.min);
    this.max.max(box.max);

    return this;
  }

  applyMatrix4(matrix: Matrix4): this {
    // (an empty box stays empty)
    if (this.isEmpty()) return this;

    // (all eight corners through the matrix, then the box round them)
    _points[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(matrix); // 000
    _points[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(matrix); // 001
    _points[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(matrix); // 010
    _points[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(matrix); // 011
    _points[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(matrix); // 100
    _points[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(matrix); // 101
    _points[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(matrix); // 110
    _points[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(matrix); // 111

    this.setFromPoints(_points);

    return this;
  }

  translate(offset: Vector3Like): this {
    this.min.add(offset);
    this.max.add(offset);

    return this;
  }

  equals(box: Box3): boolean {
    return box.min.equals(this.min) && box.max.equals(this.max);
  }

  toJSON(): { min: number[]; max: number[] } {
    return {
      min: this.min.toArray(),
      max: this.max.toArray(),
    };
  }

  fromJSON(json: { min: ArrayLike<number>; max: ArrayLike<number> }): this {
    this.min.fromArray(json.min);
    this.max.fromArray(json.max);
    return this;
  }
}

const _points: [Vector3, Vector3, Vector3, Vector3, Vector3, Vector3, Vector3, Vector3] = [
  /*@__PURE__*/ new Vector3(),
  /*@__PURE__*/ new Vector3(),
  /*@__PURE__*/ new Vector3(),
  /*@__PURE__*/ new Vector3(),
  /*@__PURE__*/ new Vector3(),
  /*@__PURE__*/ new Vector3(),
  /*@__PURE__*/ new Vector3(),
  /*@__PURE__*/ new Vector3(),
];

const _vector = /*@__PURE__*/ new Vector3();

const _box = /*@__PURE__*/ new Box3();

// (the triangle's corners)
const _v0 = /*@__PURE__*/ new Vector3();
const _v1 = /*@__PURE__*/ new Vector3();
const _v2 = /*@__PURE__*/ new Vector3();

// (its edges)
const _f0 = /*@__PURE__*/ new Vector3();
const _f1 = /*@__PURE__*/ new Vector3();
const _f2 = /*@__PURE__*/ new Vector3();

const _center = /*@__PURE__*/ new Vector3();
const _extents = /*@__PURE__*/ new Vector3();
const _triangleNormal = /*@__PURE__*/ new Vector3();
const _testAxis = /*@__PURE__*/ new Vector3();

function satForAxes(axes: readonly number[], v0: Vector3, v1: Vector3, v2: Vector3, extents: Vector3): boolean {
  for (let i = 0, j = axes.length - 3; i <= j; i += 3) {
    _testAxis.fromArray(axes, i);
    // (the box's projected radius on the axis)
    const r = extents.x * Math.abs(_testAxis.x) + extents.y * Math.abs(_testAxis.y) + extents.z * Math.abs(_testAxis.z);
    // (the triangle's projection)
    const p0 = v0.dot(_testAxis);
    const p1 = v1.dot(_testAxis);
    const p2 = v2.dot(_testAxis);
    // (apart on this axis: the projections don't overlap)
    if (Math.max(- Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r) {
      return false;
    }
  }

  return true;
}
