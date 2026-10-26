// Ported from Three.js r180's extras/curves/QuadraticBezierCurve.js (MIT, see packages/lit/NOTICE).

import { Curve } from "./Curve.ts";
import { QuadraticBezier } from "./Interpolations.ts";
import { Vector2 } from "../math/Vector2.ts";

/** A quadratic Bezier from v0 to v2, pulled toward v1. */
export class QuadraticBezierCurve extends Curve<Vector2> {
  readonly isQuadraticBezierCurve = true;

  v0: Vector2;
  v1: Vector2;
  v2: Vector2;

  constructor(v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2()) {
    super();

    this.type = "QuadraticBezierCurve";

    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
  }

  getPoint(t: number, optionalTarget = new Vector2()): Vector2 {
    const point = optionalTarget;

    const v0 = this.v0, v1 = this.v1, v2 = this.v2;

    point.set(
      QuadraticBezier(t, v0.x, v1.x, v2.x),
      QuadraticBezier(t, v0.y, v1.y, v2.y),
    );

    return point;
  }

  override copy(source: QuadraticBezierCurve): this {
    super.copy(source);

    this.v0.copy(source.v0);
    this.v1.copy(source.v1);
    this.v2.copy(source.v2);

    return this;
  }
}
