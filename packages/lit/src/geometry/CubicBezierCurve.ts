// Ported from Three.js r180's extras/curves/CubicBezierCurve.js (MIT, see packages/lit/NOTICE).

import { Curve } from "./Curve.ts";
import { CubicBezier } from "./Interpolations.ts";
import { Vector2 } from "../math/Vector2.ts";

/** A cubic Bezier from v0 to v3, with control points v1 and v2. */
export class CubicBezierCurve extends Curve<Vector2> {
  readonly isCubicBezierCurve = true;

  v0: Vector2;
  v1: Vector2;
  v2: Vector2;
  v3: Vector2;

  constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2(), v3 = new Vector2()) {
    super();

    this.type = "CubicBezierCurve";

    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
  }

  getPoint(t: number, optionalTarget = new Vector2()): Vector2 {
    const point = optionalTarget;

    const v0 = this.v0, v1 = this.v1, v2 = this.v2, v3 = this.v3;

    point.set(
      CubicBezier(t, v0.x, v1.x, v2.x, v3.x),
      CubicBezier(t, v0.y, v1.y, v2.y, v3.y),
    );

    return point;
  }

  override copy(source: CubicBezierCurve): this {
    super.copy(source);

    this.v0.copy(source.v0);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);
    this.v3.copy(source.v3);

    return this;
  }
}
