// Ported from Three.js r180's extras/core/Path.js (MIT, see packages/lit/NOTICE).
// toJSON and fromJSON are not ported.

import { Vector2 } from "../math/Vector2.ts";
import type { Vector2Like } from "../math/Vector2.ts";
import { CurvePath } from "./CurvePath.ts";
import { EllipseCurve } from "./EllipseCurve.ts";
import { SplineCurve } from "./SplineCurve.ts";
import { CubicBezierCurve } from "./CubicBezierCurve.ts";
import { QuadraticBezierCurve } from "./QuadraticBezierCurve.ts";
import { LineCurve } from "./LineCurve.ts";

/** A 2D path drawn like a canvas path: moveTo, lineTo, curves and arcs. */
export class Path extends CurvePath<Vector2> {
  currentPoint: Vector2;

  constructor(points?: readonly Vector2Like[]) {
    super();

    this.type = "Path";

    this.currentPoint = new Vector2();

    if (points) {
      this.setFromPoints(points);
    }
  }

  setFromPoints(points: readonly Vector2Like[]): this {
    this.moveTo(points[0]!.x, points[0]!.y);

    for (let i = 1, l = points.length; i < l; i++) {
      this.lineTo(points[i]!.x, points[i]!.y);
    }

    return this;
  }

  moveTo(x: number, y: number): this {
    // (copied, not referenced)
    this.currentPoint.set(x, y);

    return this;
  }

  lineTo(x: number, y: number): this {
    const curve = new LineCurve(this.currentPoint.clone(), new Vector2(x, y));
    this.curves.push(curve);

    this.currentPoint.set(x, y);

    return this;
  }

  quadraticCurveTo(aCPx: number, aCPy: number, aX: number, aY: number): this {
    const curve = new QuadraticBezierCurve(this.currentPoint.clone(), new Vector2(aCPx, aCPy), new Vector2(aX, aY));

    this.curves.push(curve);

    this.currentPoint.set(aX, aY);

    return this;
  }

  bezierCurveTo(aCP1x: number, aCP1y: number, aCP2x: number, aCP2y: number, aX: number, aY: number): this {
    const curve = new CubicBezierCurve(this.currentPoint.clone(), new Vector2(aCP1x, aCP1y), new Vector2(aCP2x, aCP2y), new Vector2(aX, aY));

    this.curves.push(curve);

    this.currentPoint.set(aX, aY);

    return this;
  }

  splineThru(pts: readonly Vector2[]): this {
    const npts = [this.currentPoint.clone()].concat(pts);

    const curve = new SplineCurve(npts);
    this.curves.push(curve);

    this.currentPoint.copy(pts[pts.length - 1]!);

    return this;
  }

  arc(aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean): this {
    const x0 = this.currentPoint.x;
    const y0 = this.currentPoint.y;

    this.absarc(aX + x0, aY + y0, aRadius, aStartAngle, aEndAngle, aClockwise);

    return this;
  }

  absarc(aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean): this {
    this.absellipse(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise);

    return this;
  }

  ellipse(aX: number, aY: number, xRadius: number, yRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean, aRotation?: number): this {
    const x0 = this.currentPoint.x;
    const y0 = this.currentPoint.y;

    this.absellipse(aX + x0, aY + y0, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation);

    return this;
  }

  absellipse(aX: number, aY: number, xRadius: number, yRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean, aRotation?: number): this {
    const curve = new EllipseCurve(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation);

    if (this.curves.length > 0) {
      // (joined to the previous curve by a line, if it doesn't start there)
      const firstPoint = curve.getPoint(0);

      if (!firstPoint.equals(this.currentPoint)) {
        this.lineTo(firstPoint.x, firstPoint.y);
      }
    }

    this.curves.push(curve);

    const lastPoint = curve.getPoint(1);
    this.currentPoint.copy(lastPoint);

    return this;
  }

  override copy(source: Path): this {
    super.copy(source);

    this.currentPoint.copy(source.currentPoint);

    return this;
  }
}
