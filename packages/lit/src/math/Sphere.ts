// Ported from Three.js r180's math/Sphere.js (MIT, see packages/lit/NOTICE).

import { Box3 } from "./Box3.ts";
import { Vector3 } from "./Vector3.ts";
import type { Vector3Like } from "./Vector3.ts";
import type { Matrix4 } from "./Matrix4.ts";
import type { Plane } from "./Plane.ts";

const _box = /*@__PURE__*/ new Box3();
const _v1 = /*@__PURE__*/ new Vector3();
const _v2 = /*@__PURE__*/ new Vector3();

export class Sphere {
  readonly isSphere = true;

  center: Vector3;
  radius: number;

  // (empty by default: a negative radius)
  constructor(center = new Vector3(), radius = - 1) {
    this.center = center;
    this.radius = radius;
  }

  set(center: Vector3Like, radius: number): this {
    this.center.copy(center);
    this.radius = radius;

    return this;
  }

  setFromPoints(points: readonly Vector3Like[], optionalCenter?: Vector3Like): this {
    const center = this.center;

    if (optionalCenter !== undefined) {
      center.copy(optionalCenter);
    } else {
      _box.setFromPoints(points).getCenter(center);
    }

    let maxRadiusSq = 0;

    for (let i = 0, il = points.length; i < il; i++) {
      maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(points[i]!));
    }

    this.radius = Math.sqrt(maxRadiusSq);

    return this;
  }

  copy(sphere: Sphere): this {
    this.center.copy(sphere.center);
    this.radius = sphere.radius;

    return this;
  }

  isEmpty(): boolean {
    return (this.radius < 0);
  }

  makeEmpty(): this {
    this.center.set(0, 0, 0);
    this.radius = - 1;

    return this;
  }

  containsPoint(point: Vector3): boolean {
    return (point.distanceToSquared(this.center) <= (this.radius * this.radius));
  }

  distanceToPoint(point: Vector3): number {
    return (point.distanceTo(this.center) - this.radius);
  }

  intersectsSphere(sphere: Sphere): boolean {
    const radiusSum = this.radius + sphere.radius;

    return sphere.center.distanceToSquared(this.center) <= (radiusSum * radiusSum);
  }

  intersectsBox(box: Box3): boolean {
    return box.intersectsSphere(this);
  }

  intersectsPlane(plane: Plane): boolean {
    return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
  }

  clampPoint<T extends Vector3>(point: Vector3Like, target: T): T {
    const deltaLengthSq = this.center.distanceToSquared(point);

    target.copy(point);

    if (deltaLengthSq > (this.radius * this.radius)) {
      target.sub(this.center).normalize();
      target.multiplyScalar(this.radius).add(this.center);
    }

    return target;
  }

  getBoundingBox<T extends Box3>(target: T): T {
    if (this.isEmpty()) {
      // (empty sphere, empty box)
      target.makeEmpty();
      return target;
    }

    target.set(this.center, this.center);
    target.expandByScalar(this.radius);

    return target;
  }

  applyMatrix4(matrix: Matrix4): this {
    this.center.applyMatrix4(matrix);
    this.radius = this.radius * matrix.getMaxScaleOnAxis();

    return this;
  }

  translate(offset: Vector3Like): this {
    this.center.add(offset);

    return this;
  }

  expandByPoint(point: Vector3Like): this {
    if (this.isEmpty()) {
      this.center.copy(point);

      this.radius = 0;

      return this;
    }

    _v1.subVectors(point, this.center);

    const lengthSq = _v1.lengthSq();

    if (lengthSq > (this.radius * this.radius)) {
      // (grow just enough: half the overshoot on the radius, the centre moved the other half)
      const length = Math.sqrt(lengthSq);

      const delta = (length - this.radius) * 0.5;

      this.center.addScaledVector(_v1, delta / length);

      this.radius += delta;
    }

    return this;
  }

  union(sphere: Sphere): this {
    if (sphere.isEmpty()) {
      return this;
    }

    if (this.isEmpty()) {
      this.copy(sphere);

      return this;
    }

    if (this.center.equals(sphere.center) === true) {
      this.radius = Math.max(this.radius, sphere.radius);
    } else {
      // (the two far points of the other sphere along the line between centres)
      _v2.subVectors(sphere.center, this.center).setLength(sphere.radius);

      this.expandByPoint(_v1.copy(sphere.center).add(_v2));

      this.expandByPoint(_v1.copy(sphere.center).sub(_v2));
    }

    return this;
  }

  equals(sphere: Sphere): boolean {
    return sphere.center.equals(this.center) && (sphere.radius === this.radius);
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  toJSON(): { radius: number; center: number[] } {
    return {
      radius: this.radius,
      center: this.center.toArray(),
    };
  }

  fromJSON(json: { radius: number; center: ArrayLike<number> }): this {
    this.radius = json.radius;
    this.center.fromArray(json.center);
    return this;
  }
}
