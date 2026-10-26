// Ported from Three.js r180's extras/curves/CatmullRomCurve3.js (MIT, see packages/lit/NOTICE).

import { Vector3 } from "../math/Vector3.ts";
import { Curve } from "./Curve.ts";

/** "centripetal" (the default), "chordal" or uniform "catmullrom" (which reads tension). */
export type CatmullRomCurveType = "centripetal" | "chordal" | "catmullrom";

// (a cubic p(s) = c0 + c1*s + c2*s^2 + c3*s^3 with p(0) = x0, p(1) = x1,
// p'(0) = t0, p'(1) = t1; after http://stackoverflow.com/questions/9489736/)
interface CubicPoly {
  initCatmullRom(x0: number, x1: number, x2: number, x3: number, tension: number): void;
  initNonuniformCatmullRom(x0: number, x1: number, x2: number, x3: number, dt0: number, dt1: number, dt2: number): void;
  calc(t: number): number;
}

function CubicPoly(): CubicPoly {
  let c0 = 0, c1 = 0, c2 = 0, c3 = 0;

  function init(x0: number, x1: number, t0: number, t1: number): void {
    c0 = x0;
    c1 = t0;
    c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
    c3 = 2 * x0 - 2 * x1 + t0 + t1;
  }

  return {
    initCatmullRom: function (x0, x1, x2, x3, tension) {
      init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
    },

    initNonuniformCatmullRom: function (x0, x1, x2, x3, dt0, dt1, dt2) {
      // (tangents parameterized in [t1, t2])
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
      let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;

      // (rescaled for [0, 1])
      t1 *= dt1;
      t2 *= dt1;

      init(x1, x2, t1, t2);
    },

    calc: function (t) {
      const t2 = t * t;
      const t3 = t2 * t;
      return c0 + c1 * t + c2 * t2 + c3 * t3;
    },
  };
}

const tmp = /*@__PURE__*/ new Vector3();
const px = /*@__PURE__*/ CubicPoly();
const py = /*@__PURE__*/ CubicPoly();
const pz = /*@__PURE__*/ CubicPoly();

/** A smooth 3D spline through points, open or closed. */
export class CatmullRomCurve3 extends Curve<Vector3> {
  readonly isCatmullRomCurve3 = true;

  points: Vector3[];
  closed: boolean;
  curveType: CatmullRomCurveType;
  tension: number;

  constructor(points: Vector3[] = [], closed = false, curveType: CatmullRomCurveType = "centripetal", tension = 0.5) {
    super();

    this.type = "CatmullRomCurve3";

    this.points = points;
    this.closed = closed;
    this.curveType = curveType;
    this.tension = tension;
  }

  getPoint(t: number, optionalTarget = new Vector3()): Vector3 {
    const point = optionalTarget;

    const points = this.points;
    const l = points.length;

    const p = (l - (this.closed ? 0 : 1)) * t;
    let intPoint = Math.floor(p);
    let weight = p - intPoint;

    if (this.closed) {
      intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
    } else if (weight === 0 && intPoint === l - 1) {
      intPoint = l - 2;
      weight = 1;
    }

    // (four points: p1 and p2 below)
    let p0: Vector3, p3: Vector3;

    if (this.closed || intPoint > 0) {
      p0 = points[(intPoint - 1) % l]!;
    } else {
      // (the first point extrapolated)
      tmp.subVectors(points[0]!, points[1]!).add(points[0]!);
      p0 = tmp;
    }

    const p1 = points[intPoint % l]!;
    const p2 = points[(intPoint + 1) % l]!;

    if (this.closed || intPoint + 2 < l) {
      p3 = points[(intPoint + 2) % l]!;
    } else {
      // (the last point extrapolated)
      tmp.subVectors(points[l - 1]!, points[l - 2]!).add(points[l - 1]!);
      p3 = tmp;
    }

    if (this.curveType === "centripetal" || this.curveType === "chordal") {
      // (centripetal or chordal Catmull-Rom)
      const pow = this.curveType === "chordal" ? 0.5 : 0.25;
      let dt0 = Math.pow(p0.distanceToSquared(p1), pow);
      let dt1 = Math.pow(p1.distanceToSquared(p2), pow);
      let dt2 = Math.pow(p2.distanceToSquared(p3), pow);

      // (safety check for repeated points)
      if (dt1 < 1e-4) dt1 = 1.0;
      if (dt0 < 1e-4) dt0 = dt1;
      if (dt2 < 1e-4) dt2 = dt1;

      px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
      py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
      pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
    } else if (this.curveType === "catmullrom") {
      px.initCatmullRom(p0.x, p1.x, p2.x, p3.x, this.tension);
      py.initCatmullRom(p0.y, p1.y, p2.y, p3.y, this.tension);
      pz.initCatmullRom(p0.z, p1.z, p2.z, p3.z, this.tension);
    }

    point.set(px.calc(weight), py.calc(weight), pz.calc(weight));

    return point;
  }

  override copy(source: CatmullRomCurve3): this {
    super.copy(source);

    this.points = [];

    for (let i = 0, l = source.points.length; i < l; i++) {
      const point = source.points[i]!;

      this.points.push(point.clone());
    }

    this.closed = source.closed;
    this.curveType = source.curveType;
    this.tension = source.tension;

    return this;
  }
}
