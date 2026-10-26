// Ported from Three.js r180's extras/curves/QuadraticBezierCurve3.js (MIT, see packages/lit/NOTICE).

import { Curve } from "./Curve.ts";
import { QuadraticBezier } from "./Interpolations.ts";
import { Vector3 } from "../math/Vector3.ts";

/** A quadratic Bezier from v0 to v2, pulled toward v1. */
export class QuadraticBezierCurve3 extends Curve<Vector3> {
  readonly isQuadraticBezierCurve3 = true;

  v0: Vector3;
  v1: Vector3;
  v2: Vector3;

  constructor(v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3()) {
    super();

    this.type = "QuadraticBezierCurve3";

    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
  }

  getPoint(t: number, optionalTarget = new Vector3()): Vector3 {
    const point = optionalTarget;

    const v0 = this.v0, v1 = this.v1, v2 = this.v2;

    point.set(
      QuadraticBezier(t, v0.x, v1.x, v2.x),
      QuadraticBezier(t, v0.y, v1.y, v2.y),
      QuadraticBezier(t, v0.z, v1.z, v2.z),
    );

    return point;
  }

  override copy(source: QuadraticBezierCurve3): this {
    super.copy(source);

    this.v0.copy(source.v0);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);

    return this;
  }
}
