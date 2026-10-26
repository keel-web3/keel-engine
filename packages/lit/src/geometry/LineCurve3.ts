// Ported from Three.js r180's extras/curves/LineCurve3.js (MIT, see packages/lit/NOTICE).

import { Vector3 } from "../math/Vector3.ts";
import { Curve } from "./Curve.ts";

/** A straight line from v1 to v2. */
export class LineCurve3 extends Curve<Vector3> {
  readonly isLineCurve3 = true;

  v1: Vector3;
  v2: Vector3;

  constructor(v1 = new Vector3(), v2 = new Vector3()) {
    super();

    this.type = "LineCurve3";

    this.v1 = v1;
    this.v2 = v2;
  }

  getPoint(t: number, optionalTarget = new Vector3()): Vector3 {
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
  override getPointAt(u: number, optionalTarget?: Vector3): Vector3 {
    return this.getPoint(u, optionalTarget);
  }

  override getTangent(_t: number, optionalTarget = new Vector3()): Vector3 {
    return optionalTarget.subVectors(this.v2, this.v1).normalize();
  }

  override getTangentAt(u: number, optionalTarget?: Vector3): Vector3 {
    return this.getTangent(u, optionalTarget);
  }

  override copy(source: LineCurve3): this {
    super.copy(source);

    this.v1.copy(source.v1);
    this.v2.copy(source.v2);

    return this;
  }
}
