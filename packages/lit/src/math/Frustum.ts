// Ported from Three.js r180's math/Frustum.js (MIT, see packages/lit/NOTICE).

import { Vector2 } from "./Vector2.ts";
import type { Vector2Like } from "./Vector2.ts";
import { Vector3 } from "./Vector3.ts";
import type { Vector3Like } from "./Vector3.ts";
import { Sphere } from "./Sphere.ts";
import { Plane } from "./Plane.ts";
import type { Box3 } from "./Box3.ts";
import type { Matrix4 } from "./Matrix4.ts";
import type { CoordinateSystem } from "./types.ts";

/** A geometry, as intersectsObject reads it (core's Geometry fits). */
export interface CullGeometry {
  boundingSphere: Sphere | null;
  computeBoundingSphere(): void;
}

/** A node, as intersectsObject reads it (the meshes fit). */
export interface CullObject {
  readonly matrixWorld: Matrix4;
  // (an instanced mesh or batch keeps its own sphere; otherwise the geometry's)
  boundingSphere?: Sphere | null;
  computeBoundingSphere?(): void;
  readonly geometry?: CullGeometry;
}

/** A billboard, as intersectsSprite reads it. */
export interface CullSprite {
  readonly matrixWorld: Matrix4;
  readonly center: Vector2Like;
}

export type FrustumPlanes = [Plane, Plane, Plane, Plane, Plane, Plane];

const _sphere = /*@__PURE__*/ new Sphere();
const _defaultSpriteCenter = /*@__PURE__*/ new Vector2(0.5, 0.5);
const _vector = /*@__PURE__*/ new Vector3();

export class Frustum {
  // (left, right, bottom, top, far, near: the normals point in)
  planes: FrustumPlanes;

  constructor(p0 = new Plane(), p1 = new Plane(), p2 = new Plane(), p3 = new Plane(), p4 = new Plane(), p5 = new Plane()) {
    this.planes = [p0, p1, p2, p3, p4, p5];
  }

  set(p0: Plane, p1: Plane, p2: Plane, p3: Plane, p4: Plane, p5: Plane): this {
    const planes = this.planes;

    planes[0].copy(p0);
    planes[1].copy(p1);
    planes[2].copy(p2);
    planes[3].copy(p3);
    planes[4].copy(p4);
    planes[5].copy(p5);

    return this;
  }

  copy(frustum: Frustum): this {
    const planes = this.planes;

    for (let i = 0; i < 6; i++) {
      planes[i]!.copy(frustum.planes[i]!);
    }

    return this;
  }

  setFromProjectionMatrix(m: Matrix4, coordinateSystem: CoordinateSystem = "webgl", reversedDepth = false): this {
    const planes = this.planes;
    const me = m.elements;
    const me0 = me[0], me1 = me[1], me2 = me[2], me3 = me[3];
    const me4 = me[4], me5 = me[5], me6 = me[6], me7 = me[7];
    const me8 = me[8], me9 = me[9], me10 = me[10], me11 = me[11];
    const me12 = me[12], me13 = me[13], me14 = me[14], me15 = me[15];

    planes[0].setComponents(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize();
    planes[1].setComponents(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize();
    planes[2].setComponents(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize();
    planes[3].setComponents(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize();

    if (reversedDepth) {
      planes[4].setComponents(me2, me6, me10, me14).normalize(); // (far)
      planes[5].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize(); // (near)
    } else {
      planes[4].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize(); // (far)

      if (coordinateSystem === "webgl") {
        planes[5].setComponents(me3 + me2, me7 + me6, me11 + me10, me15 + me14).normalize(); // (near)
      } else if (coordinateSystem === "webgpu") {
        planes[5].setComponents(me2, me6, me10, me14).normalize(); // (near)
      } else {
        throw new Error("Frustum.setFromProjectionMatrix(): Invalid coordinate system: " + String(coordinateSystem));
      }
    }

    return this;
  }

  intersectsObject(object: CullObject): boolean {
    if (object.boundingSphere !== undefined) {
      if (object.boundingSphere === null) object.computeBoundingSphere!();

      _sphere.copy(object.boundingSphere!).applyMatrix4(object.matrixWorld);
    } else {
      const geometry = object.geometry!;

      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();

      _sphere.copy(geometry.boundingSphere!).applyMatrix4(object.matrixWorld);
    }

    return this.intersectsSphere(_sphere);
  }

  intersectsSprite(sprite: CullSprite): boolean {
    _sphere.center.set(0, 0, 0);

    const offset = _defaultSpriteCenter.distanceTo(sprite.center);

    _sphere.radius = 0.7071067811865476 + offset;
    _sphere.applyMatrix4(sprite.matrixWorld);

    return this.intersectsSphere(_sphere);
  }

  intersectsSphere(sphere: Sphere): boolean {
    const planes = this.planes;
    const center = sphere.center;
    const negRadius = - sphere.radius;

    for (let i = 0; i < 6; i++) {
      const distance = planes[i]!.distanceToPoint(center);

      if (distance < negRadius) {
        return false;
      }
    }

    return true;
  }

  intersectsBox(box: Box3): boolean {
    const planes = this.planes;

    for (let i = 0; i < 6; i++) {
      const plane = planes[i]!;

      // (the corner farthest along the plane's normal)
      _vector.x = plane.normal.x > 0 ? box.max.x : box.min.x;
      _vector.y = plane.normal.y > 0 ? box.max.y : box.min.y;
      _vector.z = plane.normal.z > 0 ? box.max.z : box.min.z;

      if (plane.distanceToPoint(_vector) < 0) {
        return false;
      }
    }

    return true;
  }

  containsPoint(point: Vector3Like): boolean {
    const planes = this.planes;

    for (let i = 0; i < 6; i++) {
      if (planes[i]!.distanceToPoint(point) < 0) {
        return false;
      }
    }

    return true;
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }
}
