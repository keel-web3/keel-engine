// Ported from Three.js r180's extras/ShapeUtils.js (MIT, see packages/lit/NOTICE).

import { Earcut } from "./earcut.ts";
import type { Vector2 } from "../math/Vector2.ts";
import type { Vector2Like } from "../math/Vector2.ts";

/** A contour's signed area (positive counterclockwise). */
function area(contour: readonly Vector2Like[]): number {
  const n = contour.length;
  let a = 0.0;

  for (let p = n - 1, q = 0; q < n; p = q++) {
    a += contour[p]!.x * contour[q]!.y - contour[q]!.x * contour[p]!.y;
  }

  return a * 0.5;
}

function isClockWise(pts: readonly Vector2Like[]): boolean {
  return area(pts) < 0;
}

/**
 * Triangles of a contour with holes, as index triples into the contour's
 * points then each hole's. Drops a contour's closing point if it repeats the
 * first (in place, as r180 does).
 */
function triangulateShape(contour: Vector2[], holes: Vector2[][]): number[][] {
  // (flat [x0, y0, x1, y1, ...], where each hole starts, and the triangles)
  const vertices: number[] = [];
  const holeIndices: number[] = [];
  const faces: number[][] = [];

  removeDupEndPts(contour);
  addContour(vertices, contour);

  let holeIndex = contour.length;

  holes.forEach(removeDupEndPts);

  for (let i = 0; i < holes.length; i++) {
    holeIndices.push(holeIndex);
    holeIndex += holes[i]!.length;
    addContour(vertices, holes[i]!);
  }

  const triangles = Earcut.triangulate(vertices, holeIndices);

  for (let i = 0; i < triangles.length; i += 3) {
    faces.push(triangles.slice(i, i + 3));
  }

  return faces;
}

function removeDupEndPts(points: Vector2[]): void {
  const l = points.length;

  if (l > 2 && points[l - 1]!.equals(points[0]!)) {
    points.pop();
  }
}

function addContour(vertices: number[], contour: readonly Vector2Like[]): void {
  for (let i = 0; i < contour.length; i++) {
    vertices.push(contour[i]!.x);
    vertices.push(contour[i]!.y);
  }
}

/** r180's ShapeUtils: area, isClockWise, triangulateShape. */
export const shapeUtils = {
  area,
  isClockWise,
  triangulateShape,
};
