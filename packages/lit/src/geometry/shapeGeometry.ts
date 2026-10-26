// Ported from Three.js r180's geometries/ShapeGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Shape } from "./Shape.ts";
import { shapeUtils } from "./shapeUtils.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface ShapeParameters {
  shapes: Shape | Shape[];
  curveSegments: number;
}

/** Flat shapes with holes, filled in xy facing +z, world uvs; a group per shape when given a list (r180's ShapeGeometry; type "shape"). */
export function shape(shapes: Shape | Shape[] = new Shape([new Vector2(0, 0.5), new Vector2(-0.5, -0.5), new Vector2(0.5, -0.5)]), curveSegments = 12): Generated<ShapeParameters> {
  const geometry = generated<ShapeParameters>("shape", {
    shapes: shapes,
    curveSegments: curveSegments,
  });

  // (buffers)
  const indices: number[] = [];
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  let groupStart = 0;
  let groupCount = 0;

  // (one shape or a list)
  if (Array.isArray(shapes) === false) {
    addShape(shapes as Shape);
  } else {
    const list = shapes as Shape[];
    for (let i = 0; i < list.length; i++) {
      addShape(list[i]!);

      // (multi-material)
      geometry.addGroup(groupStart, groupCount, i);

      groupStart += groupCount;
      groupCount = 0;
    }
  }

  geometry.setIndex(indices);
  geometry.setAttribute("position", new Attribute(new Float32Array(vertices), 3));
  geometry.setAttribute("normal", new Attribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new Attribute(new Float32Array(uvs), 2));

  return geometry;

  function addShape(shape: Shape): void {
    const indexOffset = vertices.length / 3;
    const points = shape.extractPoints(curveSegments);

    let shapeVertices = points.shape;
    const shapeHoles = points.holes;

    // (the outline clockwise, the holes not)
    if (shapeUtils.isClockWise(shapeVertices) === false) {
      shapeVertices = shapeVertices.reverse();
    }

    for (let i = 0, l = shapeHoles.length; i < l; i++) {
      const shapeHole = shapeHoles[i]!;

      if (shapeUtils.isClockWise(shapeHole) === true) {
        shapeHoles[i] = shapeHole.reverse();
      }
    }

    const faces = shapeUtils.triangulateShape(shapeVertices, shapeHoles);

    // (outline and holes into one list)
    for (let i = 0, l = shapeHoles.length; i < l; i++) {
      const shapeHole = shapeHoles[i]!;
      shapeVertices = shapeVertices.concat(shapeHole);
    }

    // (vertices, normals, uvs)
    for (let i = 0, l = shapeVertices.length; i < l; i++) {
      const vertex = shapeVertices[i]!;

      vertices.push(vertex.x, vertex.y, 0);
      normals.push(0, 0, 1);
      // (world uvs)
      uvs.push(vertex.x, vertex.y);
    }

    // (indices)
    for (let i = 0, l = faces.length; i < l; i++) {
      const face = faces[i]!;

      const a = face[0]! + indexOffset;
      const b = face[1]! + indexOffset;
      const c = face[2]! + indexOffset;

      indices.push(a, b, c);
      groupCount += 3;
    }
  }
}
