// Ported from Three.js r180's geometries/RingGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface RingParameters {
  innerRadius: number;
  outerRadius: number;
  thetaSegments: number;
  phiSegments: number;
  thetaStart: number;
  thetaLength: number;
}

/** A flat annulus (or an arc of one) in xy facing +z (r180's RingGeometry; type "ring"). */
export function ring(innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, phiSegments = 1, thetaStart = 0, thetaLength = Math.PI * 2): Generated<RingParameters> {
  const geometry = generated<RingParameters>("ring", {
    innerRadius: innerRadius,
    outerRadius: outerRadius,
    thetaSegments: thetaSegments,
    phiSegments: phiSegments,
    thetaStart: thetaStart,
    thetaLength: thetaLength,
  });

  // (not floored: r180 doesn't)
  thetaSegments = Math.max(3, thetaSegments);
  phiSegments = Math.max(1, phiSegments);

  // (buffers)
  const indices: number[] = [];
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  let radius = innerRadius;
  const radiusStep = ((outerRadius - innerRadius) / phiSegments);
  const vertex = new Vector3();
  const uv = new Vector2();

  // (vertices, normals and uvs, from the inside out)
  for (let j = 0; j <= phiSegments; j++) {
    for (let i = 0; i <= thetaSegments; i++) {
      const segment = thetaStart + i / thetaSegments * thetaLength;

      vertex.x = radius * Math.cos(segment);
      vertex.y = radius * Math.sin(segment);

      vertices.push(vertex.x, vertex.y, vertex.z);

      normals.push(0, 0, 1);

      uv.x = (vertex.x / outerRadius + 1) / 2;
      uv.y = (vertex.y / outerRadius + 1) / 2;

      uvs.push(uv.x, uv.y);
    }

    // (the next row out)
    radius += radiusStep;
  }

  // (indices)
  for (let j = 0; j < phiSegments; j++) {
    const thetaSegmentLevel = j * (thetaSegments + 1);

    for (let i = 0; i < thetaSegments; i++) {
      const segment = i + thetaSegmentLevel;

      const a = segment;
      const b = segment + thetaSegments + 1;
      const c = segment + thetaSegments + 2;
      const d = segment + 1;

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
