// Ported from Three.js r180's extras/core/CurvePath.js (MIT, see packages/lit/NOTICE).
// toJSON and fromJSON are not ported.

import { Curve } from "./Curve.ts";
import type { CurveVector } from "./Curve.ts";
import { LineCurve } from "./LineCurve.ts";
import { LineCurve3 } from "./LineCurve3.ts";
import type { Vector2 } from "../math/Vector2.ts";
import type { Vector3 } from "../math/Vector3.ts";

// (what getPoints reads off each curve to pick its resolution)
interface CurveFlags {
  isEllipseCurve?: boolean;
  isLineCurve?: boolean;
  isLineCurve3?: boolean;
  isSplineCurve?: boolean;
  points?: readonly unknown[];
}

/** Curves joined end to end (r180's CurvePath). */
export class CurvePath<V extends CurveVector = CurveVector> extends Curve<V> {
  curves: Curve<V>[];
  autoClose: boolean;
  cacheLengths: number[] | null = null;

  constructor() {
    super();

    this.type = "CurvePath";

    this.curves = [];

    this.autoClose = false;
  }

  add(curve: Curve<V>): void {
    this.curves.push(curve);
  }

  /** Adds a line back to the start if the ends don't meet. */
  closePath(): this {
    const startPoint = this.curves[0]!.getPoint(0);
    const endPoint = this.curves[this.curves.length - 1]!.getPoint(1);

    if (!(startPoint as Vector3).equals(endPoint as Vector3)) {
      const line = (startPoint as { isVector2?: boolean }).isVector2 === true
        ? new LineCurve(endPoint as Vector2, startPoint as Vector2)
        : new LineCurve3(endPoint as Vector3, startPoint as Vector3);
      this.curves.push(line as unknown as Curve<V>);
    }

    return this;
  }

  /** The point at t of the whole path's length (r180 returns null past the end, as here). */
  getPoint(t: number, optionalTarget?: V): V {
    // (the curve that holds distance t * length, and the point at the matching
    // fraction of its own arc length)
    const d = t * this.getLength();
    const curveLengths = this.getCurveLengths();
    let i = 0;

    while (i < curveLengths.length) {
      if (curveLengths[i]! >= d) {
        const diff = curveLengths[i]! - d;
        const curve = this.curves[i]!;

        const segmentLength = curve.getLength();
        const u = segmentLength === 0 ? 0 : 1 - diff / segmentLength;

        return curve.getPointAt(u, optionalTarget);
      }

      i++;
    }

    return null as unknown as V;
  }

  // (not Curve's: there getLength depends on getPoint, which here depends on getLength)
  override getLength(): number {
    const lens = this.getCurveLengths();
    return lens[lens.length - 1]!;
  }

  override updateArcLengths(): void {
    // (the cached lengths are recomputed)
    this.needsUpdate = true;
    this.cacheLengths = null;
    this.getCurveLengths();
  }

  /** Cumulative lengths of the curves (cached while the curve count holds). */
  getCurveLengths(): number[] {
    // (not getLengths, which the u-to-t mapping uses)
    if (this.cacheLengths && this.cacheLengths.length === this.curves.length) {
      return this.cacheLengths;
    }

    const lengths: number[] = [];
    let sums = 0;

    for (let i = 0, l = this.curves.length; i < l; i++) {
      sums += this.curves[i]!.getLength();
      lengths.push(sums);
    }

    this.cacheLengths = lengths;

    return lengths;
  }

  override getSpacedPoints(divisions = 40): V[] {
    const points: V[] = [];

    for (let i = 0; i <= divisions; i++) {
      points.push(this.getPoint(i / divisions));
    }

    if (this.autoClose) {
      points.push(points[0]!);
    }

    return points;
  }

  override getPoints(divisions = 12): V[] {
    const points: V[] = [];
    let last: V | undefined;

    for (let i = 0, curves = this.curves; i < curves.length; i++) {
      const curve = curves[i]!;
      const flags = curve as unknown as CurveFlags;
      const resolution = flags.isEllipseCurve ? divisions * 2
        : (flags.isLineCurve || flags.isLineCurve3) ? 1
          : flags.isSplineCurve ? divisions * flags.points!.length
            : divisions;

      const pts = curve.getPoints(resolution);

      for (let j = 0; j < pts.length; j++) {
        const point = pts[j]!;

        // (no consecutive duplicates)
        if (last && (last as Vector3).equals(point as Vector3)) continue;

        points.push(point);
        last = point;
      }
    }

    if (this.autoClose && points.length > 1 && !(points[points.length - 1] as Vector3).equals(points[0] as Vector3)) {
      points.push(points[0]!);
    }

    return points;
  }

  override copy(source: CurvePath<V>): this {
    super.copy(source);

    this.curves = [];

    for (let i = 0, l = source.curves.length; i < l; i++) {
      const curve = source.curves[i]!;

      this.curves.push(curve.clone());
    }

    this.autoClose = source.autoClose;

    return this;
  }
}
