// Ported from Three.js r180's geometries/LatheGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Vector2 } from "../math/Vector2.ts";
import type { Vector2Like } from "../math/Vector2.ts";
import { clamp } from "../math/mathUtils.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface LatheParameters {
  points: readonly Vector2Like[];
  segments: number;
  phiStart: number;
  phiLength: number;
}

/** A profile (x the radius, y the height) turned about y (r180's LatheGeometry; type "lathe"). */
export function lathe(points: readonly Vector2Like[] = [new Vector2(0, -0.5), new Vector2(0.5, 0), new Vector2(0, 0.5)], segments = 12, phiStart = 0, phiLength = Math.PI * 2): Generated<LatheParameters> {
  const geometry = generated<LatheParameters>("lathe", {
    points: points,
    segments: segments,
    phiStart: phiStart,
    phiLength: phiLength,
  });

  segments = Math.floor(segments);

  // (phiLength into [0, 2 PI])
  phiLength = clamp(phiLength, 0, Math.PI * 2);

  // (buffers)
  const indices: number[] = [];
  const vertices: number[] = [];
  const uvs: number[] = [];
  const initNormals: number[] = [];
  const normals: number[] = [];

  const inverseSegments = 1.0 / segments;
  const vertex = new Vector3();
  const uv = new Vector2();
  const normal = new Vector3();
  const curNormal = new Vector3();
  const prevNormal = new Vector3();
  let dx = 0;
  let dy = 0;

  // (the normals of the first meridian)
  for (let j = 0; j <= (points.length - 1); j++) {
    switch (j) {
      case 0: // (the first vertex)
        dx = points[j + 1]!.x - points[j]!.x;
        dy = points[j + 1]!.y - points[j]!.y;

        normal.x = dy * 1.0;
        normal.y = -dx;
        normal.z = dy * 0.0;

        prevNormal.copy(normal);

        normal.normalize();

        initNormals.push(normal.x, normal.y, normal.z);

        break;

      case (points.length - 1): // (the last)
        initNormals.push(prevNormal.x, prevNormal.y, prevNormal.z);

        break;

      default: // (those between)
        dx = points[j + 1]!.x - points[j]!.x;
        dy = points[j + 1]!.y - points[j]!.y;

        normal.x = dy * 1.0;
        normal.y = -dx;
        normal.z = dy * 0.0;

        curNormal.copy(normal);

        normal.x += prevNormal.x;
        normal.y += prevNormal.y;
        normal.z += prevNormal.z;

        normal.normalize();

        initNormals.push(normal.x, normal.y, normal.z);

        prevNormal.copy(curNormal);
    }
  }

  // (vertices, uvs and normals)
  for (let i = 0; i <= segments; i++) {
    const phi = phiStart + i * inverseSegments * phiLength;

    const sin = Math.sin(phi);
    const cos = Math.cos(phi);

    for (let j = 0; j <= (points.length - 1); j++) {
      vertex.x = points[j]!.x * sin;
      vertex.y = points[j]!.y;
      vertex.z = points[j]!.x * cos;

      vertices.push(vertex.x, vertex.y, vertex.z);

      uv.x = i / segments;
      uv.y = j / (points.length - 1);

      uvs.push(uv.x, uv.y);

      const x = initNormals[3 * j + 0]! * sin;
      const y = initNormals[3 * j + 1]!;
      const z = initNormals[3 * j + 0]! * cos;

      normals.push(x, y, z);
    }
  }

  // (indices)
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < (points.length - 1); j++) {
      const base = j + i * points.length;

      const a = base;
      const b = base + points.length;
      const c = base + points.length + 1;
      const d = base + 1;

      indices.push(a, b, d);
      indices.push(c, d, b);
    }
  }

  geometry.setIndex(indices);
  geometry.setAttribute("position", new Attribute(new Float32Array(vertices), 3));
  geometry.setAttribute("uv", new Attribute(new Float32Array(uvs), 2));
  geometry.setAttribute("normal", new Attribute(new Float32Array(normals), 3));

  return geometry;
}
