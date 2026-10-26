// Ported from Three.js r180's extras/curves/CubicBezierCurve3.js (MIT, see packages/lit/NOTICE).

import { Curve } from "./Curve.ts";
import { CubicBezier } from "./Interpolations.ts";
import { Vector3 } from "../math/Vector3.ts";

/** A cubic Bezier from v0 to v3, with control points v1 and v2. */
export class CubicBezierCurve3 extends Curve<Vector3> {
  readonly isCubicBezierCurve3 = true;

  v0: Vector3;
  v1: Vector3;
  v2: Vector3;
  v3: Vector3;

  constructor(v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3()) {
    super();

    this.type = "CubicBezierCurve3";

    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
  }

  getPoint(t: number, optionalTarget = new Vector3()): Vector3 {
    const point = optionalTarget;

    const v0 = this.v0, v1 = this.v1, v2 = this.v2, v3 = this.v3;

    point.set(
      CubicBezier(t, v0.x, v1.x, v2.x, v3.x),
      CubicBezier(t, v0.y, v1.y, v2.y, v3.y),
      CubicBezier(t, v0.z, v1.z, v2.z, v3.z),
    );

    return point;
  }

  override copy(source: CubicBezierCurve3): this {
    super.copy(source);

    this.v0.copy(source.v0);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);
    this.v3.copy(source.v3);

    return this;
  }
}
