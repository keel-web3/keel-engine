// Ported from Three.js r180's geometries/ExtrudeGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import type { Geometry } from "../core/Geometry.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { Curve, FrenetFrames } from "./Curve.ts";
import { Shape } from "./Shape.ts";
import { shapeUtils } from "./shapeUtils.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

/** Makes the uvs of extrude()'s caps and side walls (r180's UVGenerator). */
export interface UVGenerator {
  generateTopUV(geometry: Geometry, vertices: readonly number[], indexA: number, indexB: number, indexC: number): Vector2[];
  generateSideWallUV(geometry: Geometry, vertices: readonly number[], indexA: number, indexB: number, indexC: number, indexD: number): Vector2[];
}

/** extrude()'s options, r180's names and defaults. */
export interface ExtrudeOptions {
  /** Points on each curve of the shapes (12). */
  curveSegments?: number | undefined;
  /** Steps along the depth or the path (1). */
  steps?: number | undefined;
  /** How deep, along z (1). */
  depth?: number | undefined;
  bevelEnabled?: boolean | undefined;
  /** How deep the bevel goes into the shape (0.2). */
  bevelThickness?: number | undefined;
  /** How far the bevel reaches out from the outline (bevelThickness - 0.1). */
  bevelSize?: number | undefined;
  bevelOffset?: number | undefined;
  bevelSegments?: number | undefined;
  /** A 3D path to extrude along, instead of z (bevels then off). */
  extrudePath?: Curve<Vector3> | undefined;
  UVGenerator?: UVGenerator | undefined;
}

export interface ExtrudeParameters {
  shapes: Shape | Shape[];
  options: ExtrudeOptions;
}

/** The default uvs: world x, y on the caps; x or y against 1 - z on the walls. */
export const worldUVGenerator: UVGenerator = {
  generateTopUV: function (_geometry, vertices, indexA, indexB, indexC) {
    const a_x = vertices[indexA * 3]!;
    const a_y = vertices[indexA * 3 + 1]!;
    const b_x = vertices[indexB * 3]!;
    const b_y = vertices[indexB * 3 + 1]!;
    const c_x = vertices[indexC * 3]!;
    const c_y = vertices[indexC * 3 + 1]!;

    return [
      new Vector2(a_x, a_y),
      new Vector2(b_x, b_y),
      new Vector2(c_x, c_y),
    ];
  },

  generateSideWallUV: function (_geometry, vertices, indexA, indexB, indexC, indexD) {
    const a_x = vertices[indexA * 3]!;
    const a_y = vertices[indexA * 3 + 1]!;
    const a_z = vertices[indexA * 3 + 2]!;
    const b_x = vertices[indexB * 3]!;
    const b_y = vertices[indexB * 3 + 1]!;
    const b_z = vertices[indexB * 3 + 2]!;
    const c_x = vertices[indexC * 3]!;
    const c_y = vertices[indexC * 3 + 1]!;
    const c_z = vertices[indexC * 3 + 2]!;
    const d_x = vertices[indexD * 3]!;
    const d_y = vertices[indexD * 3 + 1]!;
    const d_z = vertices[indexD * 3 + 2]!;

    if (Math.abs(a_y - b_y) < Math.abs(a_x - b_x)) {
      return [
        new Vector2(a_x, 1 - a_z),
        new Vector2(b_x, 1 - b_z),
        new Vector2(c_x, 1 - c_z),
        new Vector2(d_x, 1 - d_z),
      ];
    } else {
      return [
        new Vector2(a_y, 1 - a_z),
        new Vector2(b_y, 1 - b_z),
        new Vector2(c_y, 1 - c_z),
        new Vector2(d_y, 1 - d_z),
      ];
    }
  },
};

/**
 * Shapes extruded along z (or along a path), with optional bevels: non-indexed,
 * group 0 the caps, 1 the walls, per shape (r180's ExtrudeGeometry; type "extrude").
 */
export function extrude(shapes: Shape | Shape[] = new Shape([new Vector2(0.5, 0.5), new Vector2(-0.5, 0.5), new Vector2(-0.5, -0.5), new Vector2(0.5, -0.5)]), options: ExtrudeOptions = {}): Generated<ExtrudeParameters> {
  const scope = generated<ExtrudeParameters>("extrude", {
    shapes: shapes,
    options: options,
  });

  const list = Array.isArray(shapes) ? shapes : [shapes];

  const verticesArray: number[] = [];
  const uvArray: number[] = [];

  for (let i = 0, l = list.length; i < l; i++) {
    const shape = list[i]!;
    addShape(shape);
  }

  scope.setAttribute("position", new Attribute(new Float32Array(verticesArray), 3));
  scope.setAttribute("uv", new Attribute(new Float32Array(uvArray), 2));

  scope.computeVertexNormals();

  return scope;

  function addShape(shape: Shape): void {
    const placeholder: number[] = [];

    // (options)
    const curveSegments = options.curveSegments !== undefined ? options.curveSegments : 12;
    const steps = options.steps !== undefined ? options.steps : 1;
    const depth = options.depth !== undefined ? options.depth : 1;

    let bevelEnabled = options.bevelEnabled !== undefined ? options.bevelEnabled : true;
    let bevelThickness = options.bevelThickness !== undefined ? options.bevelThickness : 0.2;
    let bevelSize = options.bevelSize !== undefined ? options.bevelSize : bevelThickness - 0.1;
    let bevelOffset = options.bevelOffset !== undefined ? options.bevelOffset : 0;
    let bevelSegments = options.bevelSegments !== undefined ? options.bevelSegments : 3;

    const extrudePath = options.extrudePath;

    const uvgen = options.UVGenerator !== undefined ? options.UVGenerator : worldUVGenerator;

    let extrudePts: Vector3[] = [], extrudeByPath = false;
    let splineTube: FrenetFrames = { tangents: [], normals: [], binormals: [] };
    let binormal = new Vector3(), normal = new Vector3(), position2 = new Vector3();

    if (extrudePath) {
      extrudePts = extrudePath.getSpacedPoints(steps);

      extrudeByPath = true;
      // (no bevels along a path)
      bevelEnabled = false;

      // (the path's frames: tangents, normals, binormals)
      splineTube = extrudePath.computeFrenetFrames(steps, false);

      binormal = new Vector3();
      normal = new Vector3();
      position2 = new Vector3();
    }

    // (no bevel: none of its parameters)
    if (!bevelEnabled) {
      bevelSegments = 0;
      bevelThickness = 0;
      bevelSize = 0;
      bevelOffset = 0;
    }

    // (the shape's points)
    const shapePoints = shape.extractPoints(curveSegments);

    let vertices = shapePoints.shape;
    const holes = shapePoints.holes;

    const reverse = !shapeUtils.isClockWise(vertices);

    if (reverse) {
      vertices = vertices.reverse();

      // (holes the other way round from the outline)
      for (let h = 0, hl = holes.length; h < hl; h++) {
        const ahole = holes[h]!;

        if (shapeUtils.isClockWise(ahole)) {
          holes[h] = ahole.reverse();
        }
      }
    }

    // (points closer than a threshold, scaled to their size, merged)
    function mergeOverlappingPoints(points: Vector2[]): void {
      const THRESHOLD = 1e-10;
      const THRESHOLD_SQ = THRESHOLD * THRESHOLD;
      let prevPos = points[0]!;
      for (let i = 1; i <= points.length; i++) {
        const currentIndex = i % points.length;
        const currentPos = points[currentIndex]!;
        const dx = currentPos.x - prevPos.x;
        const dy = currentPos.y - prevPos.y;
        const distSq = dx * dx + dy * dy;

        const scalingFactorSqrt = Math.max(
          Math.abs(currentPos.x),
          Math.abs(currentPos.y),
          Math.abs(prevPos.x),
          Math.abs(prevPos.y),
        );
        const thresholdSqScaled = THRESHOLD_SQ * scalingFactorSqrt * scalingFactorSqrt;
        if (distSq <= thresholdSqScaled) {
          points.splice(currentIndex, 1);
          i--;
          continue;
        }

        prevPos = currentPos;
      }
    }

    mergeOverlappingPoints(vertices);
    holes.forEach(mergeOverlappingPoints);

    const numHoles = holes.length;

    // (vertices holds every point, contour only the outline's)
    const contour = vertices;

    for (let h = 0; h < numHoles; h++) {
      const ahole = holes[h]!;

      vertices = vertices.concat(ahole);
    }

    function scalePt2(pt: Vector2, vec: Vector2, size: number): Vector2 {
      if (!vec) console.error("keel/lit extrude: vec does not exist");

      return pt.clone().addScaledVector(vec, size);
    }

    const vlen = vertices.length;

    // (where a point moves to bevel: inward along the bisector of its two edges)
    function getBevelVec(inPt: Vector2, inPrev: Vector2, inNext: Vector2): Vector2 {
      // (the translation, and how much to shrink it)
      let v_trans_x: number, v_trans_y: number, shrink_by: number;

      // (the edges in and out; their cross product tells collinear)
      const v_prev_x = inPt.x - inPrev.x,
        v_prev_y = inPt.y - inPrev.y;
      const v_next_x = inNext.x - inPt.x,
        v_next_y = inNext.y - inPt.y;

      const v_prev_lensq = (v_prev_x * v_prev_x + v_prev_y * v_prev_y);

      const collinear0 = (v_prev_x * v_next_y - v_prev_y * v_next_x);

      if (Math.abs(collinear0) > Number.EPSILON) {
        // (not collinear: the edges, shifted left, meet at the new point)
        const v_prev_len = Math.sqrt(v_prev_lensq);
        const v_next_len = Math.sqrt(v_next_x * v_next_x + v_next_y * v_next_y);

        const ptPrevShift_x = (inPrev.x - v_prev_y / v_prev_len);
        const ptPrevShift_y = (inPrev.y + v_prev_x / v_prev_len);

        const ptNextShift_x = (inNext.x - v_next_y / v_next_len);
        const ptNextShift_y = (inNext.y + v_next_x / v_next_len);

        const sf = ((ptNextShift_x - ptPrevShift_x) * v_next_y -
          (ptNextShift_y - ptPrevShift_y) * v_next_x) /
          (v_prev_x * v_next_y - v_prev_y * v_next_x);

        v_trans_x = (ptPrevShift_x + v_prev_x * sf - inPt.x);
        v_trans_y = (ptPrevShift_y + v_prev_y * sf - inPt.y);

        // (short enough: not normalized)
        const v_trans_lensq = (v_trans_x * v_trans_x + v_trans_y * v_trans_y);
        if (v_trans_lensq <= 2) {
          return new Vector2(v_trans_x, v_trans_y);
        } else {
          shrink_by = Math.sqrt(v_trans_lensq / 2);
        }
      } else {
        // (collinear or folded back)
        let direction_eq = false; // (assume opposite)

        if (v_prev_x > Number.EPSILON) {
          if (v_next_x > Number.EPSILON) {
            direction_eq = true;
          }
        } else {
          if (v_prev_x < -Number.EPSILON) {
            if (v_next_x < -Number.EPSILON) {
              direction_eq = true;
            }
          } else {
            if (Math.sign(v_prev_y) === Math.sign(v_next_y)) {
              direction_eq = true;
            }
          }
        }

        if (direction_eq) {
          // (same direction: perpendicular to it)
          v_trans_x = -v_prev_y;
          v_trans_y = v_prev_x;
          shrink_by = Math.sqrt(v_prev_lensq);
        } else {
          // (opposite: along it)
          v_trans_x = v_prev_x;
          v_trans_y = v_prev_y;
          shrink_by = Math.sqrt(v_prev_lensq / 2);
        }
      }

      return new Vector2(v_trans_x / shrink_by, v_trans_y / shrink_by);
    }

    const contourMovements: Vector2[] = [];

    for (let i = 0, il = contour.length, j = il - 1, k = i + 1; i < il; i++, j++, k++) {
      if (j === il) j = 0;
      if (k === il) k = 0;

      contourMovements[i] = getBevelVec(contour[i]!, contour[j]!, contour[k]!);
    }

    const holesMovements: Vector2[][] = [];
    let oneHoleMovements: Vector2[], verticesMovements = contourMovements.concat();

    for (let h = 0, hl = numHoles; h < hl; h++) {
      const ahole = holes[h]!;

      oneHoleMovements = [];

      for (let i = 0, il = ahole.length, j = il - 1, k = i + 1; i < il; i++, j++, k++) {
        if (j === il) j = 0;
        if (k === il) k = 0;

        oneHoleMovements[i] = getBevelVec(ahole[i]!, ahole[j]!, ahole[k]!);
      }

      holesMovements.push(oneHoleMovements);
      verticesMovements = verticesMovements.concat(oneHoleMovements);
    }

    let faces: number[][];

    if (bevelSegments === 0) {
      faces = shapeUtils.triangulateShape(contour, holes);
    } else {
      const contractedContourVertices: Vector2[] = [];
      const expandedHoleVertices: Vector2[][] = [];

      // (the front bevel's layers, and the cap triangulated from its first)
      for (let b = 0; b < bevelSegments; b++) {
        const t = b / bevelSegments;
        const z = bevelThickness * Math.cos(t * Math.PI / 2);
        const bs = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;

        // (the outline contracted)
        for (let i = 0, il = contour.length; i < il; i++) {
          const vert = scalePt2(contour[i]!, contourMovements[i]!, bs);

          v(vert.x, vert.y, -z);
          if (t === 0) contractedContourVertices.push(vert);
        }

        // (the holes expanded)
        for (let h = 0, hl = numHoles; h < hl; h++) {
          const ahole = holes[h]!;
          oneHoleMovements = holesMovements[h]!;
          const oneHoleVertices: Vector2[] = [];
          for (let i = 0, il = ahole.length; i < il; i++) {
            const vert = scalePt2(ahole[i]!, oneHoleMovements[i]!, bs);

            v(vert.x, vert.y, -z);
            if (t === 0) oneHoleVertices.push(vert);
          }

          if (t === 0) expandedHoleVertices.push(oneHoleVertices);
        }
      }

      faces = shapeUtils.triangulateShape(contractedContourVertices, expandedHoleVertices);
    }

    const flen = faces.length;

    const bs = bevelSize + bevelOffset;

    // (the back cap's layer)
    for (let i = 0; i < vlen; i++) {
      const vert = bevelEnabled ? scalePt2(vertices[i]!, verticesMovements[i]!, bs) : vertices[i]!;

      if (!extrudeByPath) {
        v(vert.x, vert.y, 0);
      } else {
        normal.copy(splineTube.normals[0]!).multiplyScalar(vert.x);
        binormal.copy(splineTube.binormals[0]!).multiplyScalar(vert.y);

        position2.copy(extrudePts[0]!).add(normal).add(binormal);

        v(position2.x, position2.y, position2.z);
      }
    }

    // (the steps' layers)
    for (let s = 1; s <= steps; s++) {
      for (let i = 0; i < vlen; i++) {
        const vert = bevelEnabled ? scalePt2(vertices[i]!, verticesMovements[i]!, bs) : vertices[i]!;

        if (!extrudeByPath) {
          v(vert.x, vert.y, depth / steps * s);
        } else {
          normal.copy(splineTube.normals[s]!).multiplyScalar(vert.x);
          binormal.copy(splineTube.binormals[s]!).multiplyScalar(vert.y);

          position2.copy(extrudePts[s]!).add(normal).add(binormal);

          v(position2.x, position2.y, position2.z);
        }
      }
    }

    // (the far bevel's layers)
    for (let b = bevelSegments - 1; b >= 0; b--) {
      const t = b / bevelSegments;
      const z = bevelThickness * Math.cos(t * Math.PI / 2);
      const bs = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;

      // (the outline contracted)
      for (let i = 0, il = contour.length; i < il; i++) {
        const vert = scalePt2(contour[i]!, contourMovements[i]!, bs);
        v(vert.x, vert.y, depth + z);
      }

      // (the holes expanded)
      for (let h = 0, hl = holes.length; h < hl; h++) {
        const ahole = holes[h]!;
        oneHoleMovements = holesMovements[h]!;

        for (let i = 0, il = ahole.length; i < il; i++) {
          const vert = scalePt2(ahole[i]!, oneHoleMovements[i]!, bs);

          if (!extrudeByPath) {
            v(vert.x, vert.y, depth + z);
          } else {
            v(vert.x, vert.y + extrudePts[steps - 1]!.y, extrudePts[steps - 1]!.x + z);
          }
        }
      }
    }

    // (faces)
    buildLidFaces();

    buildSideFaces();

    function buildLidFaces(): void {
      const start = verticesArray.length / 3;

      if (bevelEnabled) {
        // (the bottom layer, then the top: steps + bevelSegments * 2 up)
        let layer = 0;
        let offset = vlen * layer;

        for (let i = 0; i < flen; i++) {
          const face = faces[i]!;
          f3(face[2]! + offset, face[1]! + offset, face[0]! + offset);
        }

        layer = steps + bevelSegments * 2;
        offset = vlen * layer;

        for (let i = 0; i < flen; i++) {
          const face = faces[i]!;
          f3(face[0]! + offset, face[1]! + offset, face[2]! + offset);
        }
      } else {
        // (the bottom)
        for (let i = 0; i < flen; i++) {
          const face = faces[i]!;
          f3(face[2]!, face[1]!, face[0]!);
        }

        // (the top)
        for (let i = 0; i < flen; i++) {
          const face = faces[i]!;
          f3(face[0]! + vlen * steps, face[1]! + vlen * steps, face[2]! + vlen * steps);
        }
      }

      scope.addGroup(start, verticesArray.length / 3 - start, 0);
    }

    // (the walls: the outline's and each hole's)
    function buildSideFaces(): void {
      const start = verticesArray.length / 3;
      let layeroffset = 0;
      sidewalls(contour, layeroffset);
      layeroffset += contour.length;

      for (let h = 0, hl = holes.length; h < hl; h++) {
        const ahole = holes[h]!;
        sidewalls(ahole, layeroffset);

        layeroffset += ahole.length;
      }

      scope.addGroup(start, verticesArray.length / 3 - start, 1);
    }

    function sidewalls(contour: readonly Vector2[], layeroffset: number): void {
      let i = contour.length;

      while (--i >= 0) {
        const j = i;
        let k = i - 1;
        if (k < 0) k = contour.length - 1;

        for (let s = 0, sl = (steps + bevelSegments * 2); s < sl; s++) {
          const slen1 = vlen * s;
          const slen2 = vlen * (s + 1);

          const a = layeroffset + j + slen1,
            b = layeroffset + k + slen1,
            c = layeroffset + k + slen2,
            d = layeroffset + j + slen2;

          f4(a, b, c, d);
        }
      }
    }

    function v(x: number, y: number, z: number): void {
      placeholder.push(x);
      placeholder.push(y);
      placeholder.push(z);
    }

    function f3(a: number, b: number, c: number): void {
      addVertex(a);
      addVertex(b);
      addVertex(c);

      const nextIndex = verticesArray.length / 3;
      const uvs = uvgen.generateTopUV(scope, verticesArray, nextIndex - 3, nextIndex - 2, nextIndex - 1);

      addUV(uvs[0]!);
      addUV(uvs[1]!);
      addUV(uvs[2]!);
    }

    function f4(a: number, b: number, c: number, d: number): void {
      addVertex(a);
      addVertex(b);
      addVertex(d);

      addVertex(b);
      addVertex(c);
      addVertex(d);

      const nextIndex = verticesArray.length / 3;
      const uvs = uvgen.generateSideWallUV(scope, verticesArray, nextIndex - 6, nextIndex - 3, nextIndex - 2, nextIndex - 1);

      addUV(uvs[0]!);
      addUV(uvs[1]!);
      addUV(uvs[3]!);

      addUV(uvs[1]!);
      addUV(uvs[2]!);
      addUV(uvs[3]!);
    }

    function addVertex(index: number): void {
      verticesArray.push(placeholder[index * 3 + 0]!);
      verticesArray.push(placeholder[index * 3 + 1]!);
      verticesArray.push(placeholder[index * 3 + 2]!);
    }

    function addUV(vector2: Vector2): void {
      uvArray.push(vector2.x);
      uvArray.push(vector2.y);
    }
  }
}
