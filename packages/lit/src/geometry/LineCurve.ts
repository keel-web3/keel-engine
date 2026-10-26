// Ported from Three.js r180's extras/curves/LineCurve.js (MIT, see packages/lit/NOTICE).

import { Vector2 } from "../math/Vector2.ts";
import { Curve } from "./Curve.ts";

/** A straight line from v1 to v2. */
export class LineCurve extends Curve<Vector2> {
  readonly isLineCurve = true;

  v1: Vector2;
  v2: Vector2;

  constructor(v1 = new Vector2(), v2 = new Vector2()) {
    super();

    this.type = "LineCurve";

    this.v1 = v1;
    this.v2 = v2;
  }

  getPoint(t: number, optionalTarget = new Vector2()): Vector2 {
    const point = optionalTarget;

    if (t === 1) {
      point.copy(this.v2);
    } else {
      point.copy(this.v2).sub(this.v1);
      point.multiplyScalar(t).add(this.v1);
    }

    return point;
  }

  // (linear, so u is t)
  override getPointAt(u: number, optionalTarget?: Vector2): Vector2 {
    return this.getPoint(u, optionalTarget);
  }

  override getTangent(_t: number, optionalTarget = new Vector2()): Vector2 {
    return optionalTarget.subVectors(this.v2, this.v1).normalize();
  }

  override getTangentAt(u: number, optionalTarget?: Vector2): Vector2 {
    return this.getTangent(u, optionalTarget);
  }

  override copy(source: LineCurve): this {
    super.copy(source);

    this.v1.copy(source.v1);
    this.v2.copy(source.v2);

    return this;
  }
}
