// Ported from Three.js r180's geometries/SphereGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector3 } from "../math/Vector3.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface SphereParameters {
  radius: number;
  widthSegments: number;
  heightSegments: number;
  phiStart: number;
  phiLength: number;
  thetaStart: number;
  thetaLength: number;
}

/** A UV sphere (or a band or wedge of one) (r180's SphereGeometry; type "sphere"). */
export function sphere(radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI): Generated<SphereParameters> {
  const geometry = generated<SphereParameters>("sphere", {
    radius: radius,
    widthSegments: widthSegments,
    heightSegments: heightSegments,
    phiStart: phiStart,
    phiLength: phiLength,
    thetaStart: thetaStart,
    thetaLength: thetaLength,
  });

  widthSegments = Math.max(3, Math.floor(widthSegments));
  heightSegments = Math.max(2, Math.floor(heightSegments));

  const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);

  let index = 0;
  const grid: number[][] = [];

  const vertex = new Vector3();
  const normal = new Vector3();

  // (buffers)
  const indices: number[] = [];
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  // (vertices, normals and uvs)
  for (let iy = 0; iy <= heightSegments; iy++) {
    const verticesRow: number[] = [];

    const v = iy / heightSegments;

    // (the poles' uvs sit mid-segment)
    let uOffset = 0;

    if (iy === 0 && thetaStart === 0) {
      uOffset = 0.5 / widthSegments;
    } else if (iy === heightSegments && thetaEnd === Math.PI) {
      uOffset = -0.5 / widthSegments;
    }

    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;

      vertex.x = -radius * Math.cos(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);
      vertex.y = radius * Math.cos(thetaStart + v * thetaLength);
      vertex.z = radius * Math.sin(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);

      vertices.push(vertex.x, vertex.y, vertex.z);

      normal.copy(vertex).normalize();
      normals.push(normal.x, normal.y, normal.z);

      uvs.push(u + uOffset, 1 - v);

      verticesRow.push(index++);
    }

    grid.push(verticesRow);
  }

  // (indices)
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = grid[iy]![ix + 1]!;
      const b = grid[iy]![ix]!;
      const c = grid[iy + 1]![ix]!;
      const d = grid[iy + 1]![ix + 1]!;

      if (iy !== 0 || thetaStart > 0) indices.push(a, b, d);
      if (iy !== heightSegments - 1 || thetaEnd < Math.PI) indices.push(b, c, d);
    }
  }

  geometry.setIndex(indices);
  geometry.setAttribute("position", new Attribute(new Float32Array(vertices), 3));
  geometry.setAttribute("normal", new Attribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new Attribute(new Float32Array(uvs), 2));

  return geometry;
}
