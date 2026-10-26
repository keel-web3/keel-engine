// Ported from Three.js r180's math/Ray.js (MIT, see packages/lit/NOTICE).

import { Vector3 } from "./Vector3.ts";
import type { Vector3Like } from "./Vector3.ts";
import type { Box3 } from "./Box3.ts";
import type { Matrix4 } from "./Matrix4.ts";
import type { Plane } from "./Plane.ts";
import type { Sphere } from "./Sphere.ts";

const _vector = /*@__PURE__*/ new Vector3();
const _segCenter = /*@__PURE__*/ new Vector3();
const _segDir = /*@__PURE__*/ new Vector3();
const _diff = /*@__PURE__*/ new Vector3();

const _edge1 = /*@__PURE__*/ new Vector3();
const _edge2 = /*@__PURE__*/ new Vector3();
const _normal = /*@__PURE__*/ new Vector3();

export class Ray {
  origin: Vector3;
  // (taken to be unit length)
  direction: Vector3;

  constructor(origin = new Vector3(), direction = new Vector3(0, 0, - 1)) {
    this.origin = origin;
    this.direction = direction;
  }

  set(origin: Vector3Like, direction: Vector3Like): this {
    this.origin.copy(origin);
    this.direction.copy(direction);

    return this;
  }

  copy(ray: Ray): this {
    this.origin.copy(ray.origin);
    this.direction.copy(ray.direction);

    return this;
  }

  at<T extends Vector3>(t: number, target: T): T {
    return target.copy(this.origin).addScaledVector(this.direction, t);
  }

  lookAt(v: Vector3Like): this {
    this.direction.copy(v).sub(this.origin).normalize();

    return this;
  }

  recast(t: number): this {
    this.origin.copy(this.at(t, _vector));

    return this;
  }

  closestPointToPoint<T extends Vector3>(point: Vector3Like, target: T): T {
    target.subVectors(point, this.origin);

    const directionDistance = target.dot(this.direction);

    if (directionDistance < 0) {
      return target.copy(this.origin);
    }

    return target.copy(this.origin).addScaledVector(this.direction, directionDistance);
  }

  distanceToPoint(point: Vector3Like): number {
    return Math.sqrt(this.distanceSqToPoint(point));
  }

  distanceSqToPoint(point: Vector3Like): number {
    const directionDistance = _vector.subVectors(point, this.origin).dot(this.direction);

    // (behind the origin: the origin is the nearest point)
    if (directionDistance < 0) {
      return this.origin.distanceToSquared(point);
    }

    _vector.copy(this.origin).addScaledVector(this.direction, directionDistance);

    return _vector.distanceToSquared(point);
  }

  distanceSqToSegment(v0: Vector3, v1: Vector3Like, optionalPointOnRay?: Vector3, optionalPointOnSegment?: Vector3): number {
    // (Geometric Tools' DistRaySegment: https://github.com/pmjoniak/GeometricTools/blob/master/GTEngine/Include/Mathematics/GteDistRaySegment.h
    // The segment is centre, direction and extent; the ray is origin and direction.)
    _segCenter.copy(v0).add(v1).multiplyScalar(0.5);
    _segDir.copy(v1).sub(v0).normalize();
    _diff.copy(this.origin).sub(_segCenter);

    const segExtent = v0.distanceTo(v1) * 0.5;
    const a01 = - this.direction.dot(_segDir);
    const b0 = _diff.dot(this.direction);
    const b1 = - _diff.dot(_segDir);
    const c = _diff.lengthSq();
    const det = Math.abs(1 - a01 * a01);
    let s0: number, s1: number, sqrDist: number, extDet: number;

    if (det > 0) {
      // (not parallel)
      s0 = a01 * b1 - b0;
      s1 = a01 * b0 - b1;
      extDet = segExtent * det;

      if (s0 >= 0) {
        if (s1 >= - extDet) {
          if (s1 <= extDet) {
            // (region 0: the minimum is at interior points of both)
            const invDet = 1 / det;
            s0 *= invDet;
            s1 *= invDet;
            sqrDist = s0 * (s0 + a01 * s1 + 2 * b0) + s1 * (a01 * s0 + s1 + 2 * b1) + c;
          } else {
            // (region 1)
            s1 = segExtent;
            s0 = Math.max(0, - (a01 * s1 + b0));
            sqrDist = - s0 * s0 + s1 * (s1 + 2 * b1) + c;
          }
        } else {
          // (region 5)
          s1 = - segExtent;
          s0 = Math.max(0, - (a01 * s1 + b0));
          sqrDist = - s0 * s0 + s1 * (s1 + 2 * b1) + c;
        }
      } else {
        if (s1 <= - extDet) {
          // (region 4)
          s0 = Math.max(0, - (- a01 * segExtent + b0));
          s1 = (s0 > 0) ? - segExtent : Math.min(Math.max(- segExtent, - b1), segExtent);
          sqrDist = - s0 * s0 + s1 * (s1 + 2 * b1) + c;
        } else if (s1 <= extDet) {
          // (region 3)
          s0 = 0;
          s1 = Math.min(Math.max(- segExtent, - b1), segExtent);
          sqrDist = s1 * (s1 + 2 * b1) + c;
        } else {
          // (region 2)
          s0 = Math.max(0, - (a01 * segExtent + b0));
          s1 = (s0 > 0) ? segExtent : Math.min(Math.max(- segExtent, - b1), segExtent);
          sqrDist = - s0 * s0 + s1 * (s1 + 2 * b1) + c;
        }
      }
    } else {
      // (parallel)
      s1 = (a01 > 0) ? - segExtent : segExtent;
      s0 = Math.max(0, - (a01 * s1 + b0));
      sqrDist = - s0 * s0 + s1 * (s1 + 2 * b1) + c;
    }

    if (optionalPointOnRay) {
      optionalPointOnRay.copy(this.origin).addScaledVector(this.direction, s0);
    }

    if (optionalPointOnSegment) {
      optionalPointOnSegment.copy(_segCenter).addScaledVector(_segDir, s1);
    }

    return sqrDist;
  }

  intersectSphere<T extends Vector3>(sphere: Sphere, target: T): T | null {
    _vector.subVectors(sphere.center, this.origin);
    const tca = _vector.dot(this.direction);
    const d2 = _vector.dot(_vector) - tca * tca;
    const radius2 = sphere.radius * sphere.radius;

    if (d2 > radius2) return null;

    const thc = Math.sqrt(radius2 - d2);

    // (the near and far hits)
    const t0 = tca - thc;
    const t1 = tca + thc;

    // (both behind the origin)
    if (t1 < 0) return null;

    // (the origin is inside: the far hit)
    if (t0 < 0) return this.at(t1, target);

    return this.at(t0, target);
  }

  intersectsSphere(sphere: Sphere): boolean {
    if (sphere.radius < 0) return false; // (an empty sphere, three.js #31187)

    return this.distanceSqToPoint(sphere.center) <= (sphere.radius * sphere.radius);
  }

  distanceToPlane(plane: Plane): number | null {
    const denominator = plane.normal.dot(this.direction);

    if (denominator === 0) {
      // (in the plane)
      if (plane.distanceToPoint(this.origin) === 0) {
        return 0;
      }

      // (parallel and apart)
      return null;
    }

    const t = - (this.origin.dot(plane.normal) + plane.constant) / denominator;

    // (behind the origin: no hit)
    return t >= 0 ? t : null;
  }

  intersectPlane<T extends Vector3>(plane: Plane, target: T): T | null {
    const t = this.distanceToPlane(plane);

    if (t === null) {
      return null;
    }

    return this.at(t, target);
  }

  intersectsPlane(plane: Plane): boolean {
    // (the origin on the plane, or heading towards it)
    const distToPoint = plane.distanceToPoint(this.origin);

    if (distToPoint === 0) {
      return true;
    }

    const denominator = plane.normal.dot(this.direction);

    if (denominator * distToPoint < 0) {
      return true;
    }

    return false;
  }

  intersectBox<T extends Vector3>(box: Box3, target: T): T | null {
    let tmin: number, tmax: number, tymin: number, tymax: number, tzmin: number, tzmax: number;

    const invdirx = 1 / this.direction.x,
      invdiry = 1 / this.direction.y,
      invdirz = 1 / this.direction.z;

    const origin = this.origin;

    if (invdirx >= 0) {
      tmin = (box.min.x - origin.x) * invdirx;
      tmax = (box.max.x - origin.x) * invdirx;
    } else {
      tmin = (box.max.x - origin.x) * invdirx;
      tmax = (box.min.x - origin.x) * invdirx;
    }

    if (invdiry >= 0) {
      tymin = (box.min.y - origin.y) * invdiry;
      tymax = (box.max.y - origin.y) * invdiry;
    } else {
      tymin = (box.max.y - origin.y) * invdiry;
      tymax = (box.min.y - origin.y) * invdiry;
    }

    if ((tmin > tymax) || (tymin > tmax)) return null;

    if (tymin > tmin || isNaN(tmin)) tmin = tymin;

    if (tymax < tmax || isNaN(tmax)) tmax = tymax;

    if (invdirz >= 0) {
      tzmin = (box.min.z - origin.z) * invdirz;
      tzmax = (box.max.z - origin.z) * invdirz;
    } else {
      tzmin = (box.max.z - origin.z) * invdirz;
      tzmax = (box.min.z - origin.z) * invdirz;
    }

    if ((tmin > tzmax) || (tzmin > tmax)) return null;

    if (tzmin > tmin || tmin !== tmin) tmin = tzmin;

    if (tzmax < tmax || tmax !== tmax) tmax = tzmax;

    // (the box is behind the ray)
    if (tmax < 0) return null;

    return this.at(tmin >= 0 ? tmin : tmax, target);
  }

  intersectsBox(box: Box3): boolean {
    return this.intersectBox(box, _vector) !== null;
  }

  intersectTriangle<T extends Vector3>(a: Vector3Like, b: Vector3Like, c: Vector3Like, backfaceCulling: boolean, target: T): T | null {
    // (Geometric Tools' IntrRay3Triangle3: https://github.com/pmjoniak/GeometricTools/blob/master/GTEngine/Include/Mathematics/GteIntrRay3Triangle3.h)
    _edge1.subVectors(b, a);
    _edge2.subVectors(c, a);
    _normal.crossVectors(_edge1, _edge2);

    // (Q = origin, D = direction, E1, E2 the edges, N = E1 x E2: solve Q + t D = b1 E1 + b2 E2)
    let DdN = this.direction.dot(_normal);
    let sign: number;

    if (DdN > 0) {
      if (backfaceCulling) return null;
      sign = 1;
    } else if (DdN < 0) {
      sign = - 1;
      DdN = - DdN;
    } else {
      return null;
    }

    _diff.subVectors(this.origin, a);
    const DdQxE2 = sign * this.direction.dot(_edge2.crossVectors(_diff, _edge2));

    // (b1 < 0: no hit)
    if (DdQxE2 < 0) {
      return null;
    }

    const DdE1xQ = sign * this.direction.dot(_edge1.cross(_diff));

    // (b2 < 0: no hit)
    if (DdE1xQ < 0) {
      return null;
    }

    // (b1 + b2 > 1: no hit)
    if (DdQxE2 + DdE1xQ > DdN) {
      return null;
    }

    // (the line hits; does the ray?)
    const QdN = - sign * _diff.dot(_normal);

    // (t < 0: no hit)
    if (QdN < 0) {
      return null;
    }

    return this.at(QdN / DdN, target);
  }

  applyMatrix4(matrix4: Matrix4): this {
    this.origin.applyMatrix4(matrix4);
    this.direction.transformDirection(matrix4);

    return this;
  }

  equals(ray: Ray): boolean {
    return ray.origin.equals(this.origin) && ray.direction.equals(this.direction);
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }
}
