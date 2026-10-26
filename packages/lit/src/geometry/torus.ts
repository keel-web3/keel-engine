// Ported from Three.js r180's geometries/TorusGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector3 } from "../math/Vector3.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface TorusParameters {
  radius: number;
  tube: number;
  radialSegments: number;
  tubularSegments: number;
  arc: number;
}

/** A torus (or an arc of one) about z (r180's TorusGeometry; type "torus"). */
export function torus(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2): Generated<TorusParameters> {
  const geometry = generated<TorusParameters>("torus", {
    radius: radius,
    tube: tube,
    radialSegments: radialSegments,
    tubularSegments: tubularSegments,
    arc: arc,
  });

  radialSegments = Math.floor(radialSegments);
  tubularSegments = Math.floor(tubularSegments);

  // (buffers)
  const indices: number[] = [];
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const center = new Vector3();
  const vertex = new Vector3();
  const normal = new Vector3();

  // (vertices, normals and uvs)
  for (let j = 0; j <= radialSegments; j++) {
    for (let i = 0; i <= tubularSegments; i++) {
      const u = i / tubularSegments * arc;
      const v = j / radialSegments * Math.PI * 2;

      vertex.x = (radius + tube * Math.cos(v)) * Math.cos(u);
      vertex.y = (radius + tube * Math.cos(v)) * Math.sin(u);
      vertex.z = tube * Math.sin(v);

      vertices.push(vertex.x, vertex.y, vertex.z);

      center.x = radius * Math.cos(u);
      center.y = radius * Math.sin(u);
      normal.subVectors(vertex, center).normalize();

      normals.push(normal.x, normal.y, normal.z);

      uvs.push(i / tubularSegments);
      uvs.push(j / radialSegments);
    }
  }

  // (indices)
  for (let j = 1; j <= radialSegments; j++) {
    for (let i = 1; i <= tubularSegments; i++) {
      const a = (tubularSegments + 1) * j + i - 1;
      const b = (tubularSegments + 1) * (j - 1) + i - 1;
      const c = (tubularSegments + 1) * (j - 1) + i;
      const d = (tubularSegments + 1) * j + i;

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  geometry.setIndex(indices);
  geometry.setAttribute("position", new Attribute(new Float32Array(vertices), 3));
  geometry.setAttribute("normal", new Attribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new Attribute(new Float32Array(uvs), 2));

  return geometry;
}
