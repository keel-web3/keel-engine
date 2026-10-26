// Ported from Three.js r180's extras/core/Curve.js (MIT, see packages/lit/NOTICE).
// toJSON and fromJSON are not ported.

import { clamp } from "../math/mathUtils.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Matrix4 } from "../math/Matrix4.ts";

/** The points a curve gives: Vector2 for the flat curves, Vector3 for the 3D ones. */
export type CurveVector = Vector2 | Vector3;

/** Tangent, normal and binormal at each of a curve's segments (computeFrenetFrames). */
export interface FrenetFrames {
  tangents: Vector3[];
  normals: Vector3[];
  binormals: Vector3[];
}

/** A parametric curve, t from 0 to 1 (r180's Curve). Subclasses give getPoint. */
export abstract class Curve<V extends CurveVector = CurveVector> {
  type: string;
  arcLengthDivisions: number;
  needsUpdate: boolean;
  cacheArcLengths: number[] | null;

  constructor() {
    this.type = "Curve";

    this.arcLengthDivisions = 200;

    this.needsUpdate = false;

    this.cacheArcLengths = null;
  }

  /** The point at t (a new vector, or optionalTarget filled). */
  abstract getPoint(t: number, optionalTarget?: V): V;

  /** The point at u, a fraction of the arc length. */
  getPointAt(u: number, optionalTarget?: V): V {
    const t = this.getUtoTmapping(u);
    return this.getPoint(t, optionalTarget);
  }

  getPoints(divisions = 5): V[] {
    const points: V[] = [];

    for (let d = 0; d <= divisions; d++) {
      points.push(this.getPoint(d / divisions));
    }

    return points;
  }

  /** Points evenly spaced along the arc (getPointAt). */
  getSpacedPoints(divisions = 5): V[] {
    const points: V[] = [];

    for (let d = 0; d <= divisions; d++) {
      points.push(this.getPointAt(d / divisions));
    }

    return points;
  }

  getLength(): number {
    const lengths = this.getLengths();
    return lengths[lengths.length - 1]!;
  }

  /** Cumulative chord lengths at divisions + 1 samples (cached). */
  getLengths(divisions = this.arcLengthDivisions): number[] {
    if (this.cacheArcLengths && this.cacheArcLengths.length === divisions + 1 && !this.needsUpdate) {
      return this.cacheArcLengths;
    }

    this.needsUpdate = false;

    const cache: number[] = [];
    let current: V, last = this.getPoint(0);
    let sum = 0;

    cache.push(0);

    for (let p = 1; p <= divisions; p++) {
      current = this.getPoint(p / divisions);
      sum += (current as Vector3).distanceTo(last as Vector3);
      cache.push(sum);
      last = current;
    }

    this.cacheArcLengths = cache;

    // (the sum is the last element)
    return cache;
  }

  updateArcLengths(): void {
    this.needsUpdate = true;
    this.getLengths();
  }

  /** The t at a fraction u of the arc length (or at a distance along it). */
  getUtoTmapping(u: number, distance: number | null = null): number {
    const arcLengths = this.getLengths();

    let i = 0;
    const il = arcLengths.length;

    // (the targeted arc length)
    let targetArcLength: number;

    if (distance) {
      targetArcLength = distance;
    } else {
      targetArcLength = u * arcLengths[il - 1]!;
    }

    // (binary search for the index with the largest value smaller than the target)
    let low = 0, high = il - 1, comparison: number;

    while (low <= high) {
      i = Math.floor(low + (high - low) / 2);

      comparison = arcLengths[i]! - targetArcLength;

      if (comparison < 0) {
        low = i + 1;
      } else if (comparison > 0) {
        high = i - 1;
      } else {
        high = i;
        break;
      }
    }

    i = high;

    if (arcLengths[i] === targetArcLength) {
      return i / (il - 1);
    }

    // (interpolated between the samples either side)
    const lengthBefore = arcLengths[i]!;
    const lengthAfter = arcLengths[i + 1]!;

    const segmentLength = lengthAfter - lengthBefore;

    const segmentFraction = (targetArcLength - lengthBefore) / segmentLength;

    const t = (i + segmentFraction) / (il - 1);

    return t;
  }

  /** The unit tangent at t, by a central difference (0.0001 either side, capped to [0, 1]). */
  getTangent(t: number, optionalTarget?: V): V {
    const delta = 0.0001;
    let t1 = t - delta;
    let t2 = t + delta;

    // (capping in case of danger)
    if (t1 < 0) t1 = 0;
    if (t2 > 1) t2 = 1;

    const pt1 = this.getPoint(t1);
    const pt2 = this.getPoint(t2);

    const tangent = optionalTarget || ((pt1 as { isVector2?: boolean }).isVector2 ? new Vector2() : new Vector3()) as V;

    (tangent as Vector3).copy(pt2 as Vector3).sub(pt1 as Vector3).normalize();

    return tangent;
  }

  getTangentAt(u: number, optionalTarget?: V): V {
    const t = this.getUtoTmapping(u);
    return this.getTangent(t, optionalTarget);
  }

  /** Parallel-transported frames at segments + 1 points (http://www.cs.indiana.edu/pub/techreports/TR425.pdf). */
  computeFrenetFrames(segments: number, closed = false): FrenetFrames {
    const normal = new Vector3();

    const tangents: Vector3[] = [];
    const normals: Vector3[] = [];
    const binormals: Vector3[] = [];

    const vec = new Vector3();
    const mat = new Matrix4();

    // (the tangent at each segment)
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;

      tangents[i] = this.getTangentAt(u, new Vector3() as V) as Vector3;
    }

    // (a first normal perpendicular to the first tangent, toward its smallest component)
    normals[0] = new Vector3();
    binormals[0] = new Vector3();
    let min = Number.MAX_VALUE;
    const tx = Math.abs(tangents[0]!.x);
    const ty = Math.abs(tangents[0]!.y);
    const tz = Math.abs(tangents[0]!.z);

    if (tx <= min) {
      min = tx;
      normal.set(1, 0, 0);
    }

    if (ty <= min) {
      min = ty;
      normal.set(0, 1, 0);
    }

    if (tz <= min) {
      normal.set(0, 0, 1);
    }

    vec.crossVectors(tangents[0]!, normal).normalize();

    normals[0].crossVectors(tangents[0]!, vec);
    binormals[0].crossVectors(tangents[0]!, normals[0]);

    // (then the slowly varying normal and binormal along the curve)
    for (let i = 1; i <= segments; i++) {
      normals[i] = normals[i - 1]!.clone();

      binormals[i] = binormals[i - 1]!.clone();

      vec.crossVectors(tangents[i - 1]!, tangents[i]!);

      if (vec.length() > Number.EPSILON) {
        vec.normalize();

        // (clamped for floating point error)
        const theta = Math.acos(clamp(tangents[i - 1]!.dot(tangents[i]!), -1, 1));

        normals[i]!.applyMatrix4(mat.makeRotationAxis(vec, theta));
      }

      binormals[i]!.crossVectors(tangents[i]!, normals[i]!);
    }

    // (closed: twist them so the first and last normals agree)
    if (closed === true) {
      let theta = Math.acos(clamp(normals[0].dot(normals[segments]!), -1, 1));
      theta /= segments;

      if (tangents[0]!.dot(vec.crossVectors(normals[0], normals[segments]!)) > 0) {
        theta = -theta;
      }

      for (let i = 1; i <= segments; i++) {
        // (a little twist each)
        normals[i]!.applyMatrix4(mat.makeRotationAxis(tangents[i]!, theta * i));
        binormals[i]!.crossVectors(tangents[i]!, normals[i]!);
      }
    }

    return {
      tangents: tangents,
      normals: normals,
      binormals: binormals,
    };
  }

  clone(): this {
    return new (this.constructor as new () => this)().copy(this);
  }

  copy(source: Curve<V>): this {
    this.arcLengthDivisions = source.arcLengthDivisions;

    return this;
  }
}
