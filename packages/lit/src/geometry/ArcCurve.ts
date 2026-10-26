// Ported from Three.js r180's extras/curves/ArcCurve.js (MIT, see packages/lit/NOTICE).

import { EllipseCurve } from "./EllipseCurve.ts";

/** A circular arc: an EllipseCurve with one radius. */
export class ArcCurve extends EllipseCurve {
  readonly isArcCurve = true;

  constructor(aX?: number, aY?: number, aRadius?: number, aStartAngle?: number, aEndAngle?: number, aClockwise?: boolean) {
    super(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise);

    this.type = "ArcCurve";
  }
}
