// Ported from Three.js r180's geometries/BoxGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector3 } from "../math/Vector3.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface BoxParameters {
  width: number;
  height: number;
  depth: number;
  widthSegments: number;
  heightSegments: number;
  depthSegments: number;
}

type Axis = "x" | "y" | "z";

/** A box centred on the origin, six faces in six groups (r180's BoxGeometry; type "box"). */
export function box(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1): Generated<BoxParameters> {
  const scope = generated<BoxParameters>("box", {
    width: width,
    height: height,
    depth: depth,
    widthSegments: widthSegments,
    heightSegments: heightSegments,
    depthSegments: depthSegments,
  });

  // (segments)
  widthSegments = Math.floor(widthSegments);
  heightSegments = Math.floor(heightSegments);
  depthSegments = Math.floor(depthSegments);

  // (buffers)
  const indices: number[] = [];
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  let numberOfVertices = 0;
  let groupStart = 0;

  // (each side)
  buildPlane("z", "y", "x", -1, -1, depth, height, width, depthSegments, heightSegments, 0); // px
  buildPlane("z", "y", "x", 1, -1, depth, height, -width, depthSegments, heightSegments, 1); // nx
  buildPlane("x", "z", "y", 1, 1, width, depth, height, widthSegments, depthSegments, 2); // py
  buildPlane("x", "z", "y", 1, -1, width, depth, -height, widthSegments, depthSegments, 3); // ny
  buildPlane("x", "y", "z", 1, -1, width, height, depth, widthSegments, heightSegments, 4); // pz
  buildPlane("x", "y", "z", -1, -1, width, height, -depth, widthSegments, heightSegments, 5); // nz

  scope.setIndex(indices);
  scope.setAttribute("position", new Attribute(new Float32Array(vertices), 3));
  scope.setAttribute("normal", new Attribute(new Float32Array(normals), 3));
  scope.setAttribute("uv", new Attribute(new Float32Array(uvs), 2));

  return scope;

  function buildPlane(u: Axis, v: Axis, w: Axis, udir: number, vdir: number, width: number, height: number, depth: number, gridX: number, gridY: number, materialIndex: number): void {
    const segmentWidth = width / gridX;
    const segmentHeight = height / gridY;

    const widthHalf = width / 2;
    const heightHalf = height / 2;
    const depthHalf = depth / 2;

    const gridX1 = gridX + 1;
    const gridY1 = gridY + 1;

    let vertexCounter = 0;
    let groupCount = 0;

    const vector = new Vector3();

    // (vertices, normals and uvs)
    for (let iy = 0; iy < gridY1; iy++) {
      const y = iy * segmentHeight - heightHalf;

      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segmentWidth - widthHalf;

        vector[u] = x * udir;
        vector[v] = y * vdir;
        vector[w] = depthHalf;

        vertices.push(vector.x, vector.y, vector.z);

        vector[u] = 0;
        vector[v] = 0;
        vector[w] = depth > 0 ? 1 : -1;

        normals.push(vector.x, vector.y, vector.z);

        uvs.push(ix / gridX);
        uvs.push(1 - (iy / gridY));

        vertexCounter += 1;
      }
    }

    // (two triangles a segment)
    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = numberOfVertices + ix + gridX1 * iy;
        const b = numberOfVertices + ix + gridX1 * (iy + 1);
        const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
        const d = numberOfVertices + (ix + 1) + gridX1 * iy;

        indices.push(a, b, d);
        indices.push(b, c, d);

        groupCount += 6;
      }
    }

    // (a group a side, for multi-material)
    scope.addGroup(groupStart, groupCount, materialIndex);

    groupStart += groupCount;

    numberOfVertices += vertexCounter;
  }
}
