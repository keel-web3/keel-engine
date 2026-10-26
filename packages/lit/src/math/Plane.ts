// Ported from Three.js r180's math/Plane.js (MIT, see packages/lit/NOTICE).

import { Matrix3 } from "./Matrix3.ts";
import { Vector3 } from "./Vector3.ts";
import type { Vector3Like } from "./Vector3.ts";
import type { Box3 } from "./Box3.ts";
import type { Matrix4 } from "./Matrix4.ts";
import type { Sphere } from "./Sphere.ts";

/** A line segment, as intersectLine reads it (r180's Line3 fits). */
export interface LineLike {
  readonly start: Vector3;
  readonly end: Vector3Like;
  delta(target: Vector3): Vector3;
}

const _vector1 = /*@__PURE__*/ new Vector3();
const _vector2 = /*@__PURE__*/ new Vector3();
const _normalMatrix = /*@__PURE__*/ new Matrix3();

export class Plane {
  readonly isPlane = true;

  // (normal . p + constant = 0; normal is taken to be unit length)
  normal: Vector3;
  constant: number;

  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal;
    this.constant = constant;
  }

  set(normal: Vector3Like, constant: number): this {
    this.normal.copy(normal);
    this.constant = constant;

    return this;
  }

  setComponents(x: number, y: number, z: number, w: number): this {
    this.normal.set(x, y, z);
    this.constant = w;

    return this;
  }

  setFromNormalAndCoplanarPoint(normal: Vector3Like, point: Vector3): this {
    this.normal.copy(normal);
    this.constant = - point.dot(this.normal);

    return this;
  }

  setFromCoplanarPoints(a: Vector3, b: Vector3Like, c: Vector3Like): this {
    // (counter-clockwise winding faces the normal)
    const normal = _vector1.subVectors(c, b).cross(_vector2.subVectors(a, b)).normalize();

    this.setFromNormalAndCoplanarPoint(normal, a);

    return this;
  }

  copy(plane: Plane): this {
    this.normal.copy(plane.normal);
    this.constant = plane.constant;

    return this;
  }

  normalize(): this {
    const inverseNormalLength = 1.0 / this.normal.length();
    this.normal.multiplyScalar(inverseNormalLength);
    this.constant *= inverseNormalLength;

    return this;
  }

  negate(): this {
    this.constant *= - 1;
    this.normal.negate();

    return this;
  }

  distanceToPoint(point: Vector3Like): number {
    return this.normal.dot(point) + this.constant;
  }

  distanceToSphere(sphere: Sphere): number {
    return this.distanceToPoint(sphere.center) - sphere.radius;
  }

  projectPoint<T extends Vector3>(point: Vector3Like, target: T): T {
    return target.copy(point).addScaledVector(this.normal, - this.distanceToPoint(point));
  }

  intersectLine<T extends Vector3>(line: LineLike, target: T): T | null {
    const direction = line.delta(_vector1);

    const denominator = this.normal.dot(direction);

    if (denominator === 0) {
      // (the line lies in the plane)
      if (this.distanceToPoint(line.start) === 0) {
        return target.copy(line.start);
      }

      // (r180 notes that the unsolvable case returns null too)
      return null;
    }

    const t = - (line.start.dot(this.normal) + this.constant) / denominator;

    if (t < 0 || t > 1) {
      return null;
    }

    return target.copy(line.start).addScaledVector(direction, t);
  }

  intersectsLine(line: LineLike): boolean {
    // (the ends either side of the plane)
    const startSign = this.distanceToPoint(line.start);
    const endSign = this.distanceToPoint(line.end);

    return (startSign < 0 && endSign > 0) || (endSign < 0 && startSign > 0);
  }

  intersectsBox(box: Box3): boolean {
    return box.intersectsPlane(this);
  }

  intersectsSphere(sphere: Sphere): boolean {
    return sphere.intersectsPlane(this);
  }

  coplanarPoint<T extends Vector3>(target: T): T {
    return target.copy(this.normal).multiplyScalar(- this.constant);
  }

  applyMatrix4(matrix: Matrix4, optionalNormalMatrix?: Matrix3): this {
    // (pass the normal matrix when you have it: it saves an inversion)
    const normalMatrix = optionalNormalMatrix || _normalMatrix.getNormalMatrix(matrix);

    const referencePoint = this.coplanarPoint(_vector1).applyMatrix4(matrix);

    const normal = this.normal.applyMatrix3(normalMatrix).normalize();

    this.constant = - referencePoint.dot(normal);

    return this;
  }

  translate(offset: Vector3): this {
    this.constant -= offset.dot(this.normal);

    return this;
  }

  equals(plane: Plane): boolean {
    return plane.normal.equals(this.normal) && (plane.constant === this.constant);
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }
}
