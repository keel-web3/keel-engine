// Ported from Three.js r180's geometries/CylinderGeometry.js and ConeGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Vector2 } from "../math/Vector2.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface CylinderParameters {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  radialSegments: number;
  heightSegments: number;
  openEnded: boolean;
  thetaStart: number;
  thetaLength: number;
}

export interface ConeParameters {
  radius: number;
  height: number;
  radialSegments: number;
  heightSegments: number;
  openEnded: boolean;
  thetaStart: number;
  thetaLength: number;
}

/** A cylinder (or frustum) about y: groups 0 the side, 1 the top cap, 2 the bottom (r180's CylinderGeometry; type "cylinder"). */
export function cylinder(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2): Generated<CylinderParameters> {
  const scope = generated<CylinderParameters>("cylinder", {
    radiusTop: radiusTop,
    radiusBottom: radiusBottom,
    height: height,
    radialSegments: radialSegments,
    heightSegments: heightSegments,
    openEnded: openEnded,
    thetaStart: thetaStart,
    thetaLength: thetaLength,
  });

  radialSegments = Math.floor(radialSegments);
  heightSegments = Math.floor(heightSegments);

  // (buffers)
  const indices: number[] = [];
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  let index = 0;
  const indexArray: number[][] = [];
  const halfHeight = height / 2;
  let groupStart = 0;

  generateTorso();

  if (openEnded === false) {
    if (radiusTop > 0) generateCap(true);
    if (radiusBottom > 0) generateCap(false);
  }

  scope.setIndex(indices);
  scope.setAttribute("position", new Attribute(new Float32Array(vertices), 3));
  scope.setAttribute("normal", new Attribute(new Float32Array(normals), 3));
  scope.setAttribute("uv", new Attribute(new Float32Array(uvs), 2));

  return scope;

  function generateTorso(): void {
    const normal = new Vector3();
    const vertex = new Vector3();

    let groupCount = 0;

    // (for the normal)
    const slope = (radiusBottom - radiusTop) / height;

    // (vertices, normals and uvs)
    for (let y = 0; y <= heightSegments; y++) {
      const indexRow: number[] = [];

      const v = y / heightSegments;

      // (this row's radius)
      const radius = v * (radiusBottom - radiusTop) + radiusTop;

      for (let x = 0; x <= radialSegments; x++) {
        const u = x / radialSegments;

        const theta = u * thetaLength + thetaStart;

        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        vertex.x = radius * sinTheta;
        vertex.y = -v * height + halfHeight;
        vertex.z = radius * cosTheta;
        vertices.push(vertex.x, vertex.y, vertex.z);

        normal.set(sinTheta, slope, cosTheta).normalize();
        normals.push(normal.x, normal.y, normal.z);

        uvs.push(u, 1 - v);

        indexRow.push(index++);
      }

      indexArray.push(indexRow);
    }

    // (indices)
    for (let x = 0; x < radialSegments; x++) {
      for (let y = 0; y < heightSegments; y++) {
        const a = indexArray[y]![x]!;
        const b = indexArray[y + 1]![x]!;
        const c = indexArray[y + 1]![x + 1]!;
        const d = indexArray[y]![x + 1]!;

        if (radiusTop > 0 || y !== 0) {
          indices.push(a, b, d);
          groupCount += 3;
        }

        if (radiusBottom > 0 || y !== heightSegments - 1) {
          indices.push(b, c, d);
          groupCount += 3;
        }
      }
    }

    scope.addGroup(groupStart, groupCount, 0);

    groupStart += groupCount;
  }

  function generateCap(top: boolean): void {
    // (the first centre vertex)
    const centerIndexStart = index;

    const uv = new Vector2();
    const vertex = new Vector3();

    let groupCount = 0;

    const radius = top === true ? radiusTop : radiusBottom;
    const sign = top === true ? 1 : -1;

    // (a centre vertex per segment: one set of uvs per face)
    for (let x = 1; x <= radialSegments; x++) {
      vertices.push(0, halfHeight * sign, 0);

      normals.push(0, sign, 0);

      uvs.push(0.5, 0.5);

      index++;
    }

    // (the last centre vertex)
    const centerIndexEnd = index;

    // (then the rim)
    for (let x = 0; x <= radialSegments; x++) {
      const u = x / radialSegments;
      const theta = u * thetaLength + thetaStart;

      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      vertex.x = radius * sinTheta;
      vertex.y = halfHeight * sign;
      vertex.z = radius * cosTheta;
      vertices.push(vertex.x, vertex.y, vertex.z);

      normals.push(0, sign, 0);

      uv.x = (cosTheta * 0.5) + 0.5;
      uv.y = (sinTheta * 0.5 * sign) + 0.5;
      uvs.push(uv.x, uv.y);

      index++;
    }

    // (indices)
    for (let x = 0; x < radialSegments; x++) {
      const c = centerIndexStart + x;
      const i = centerIndexEnd + x;

      if (top === true) {
        indices.push(i, i + 1, c);
      } else {
        indices.push(i + 1, i, c);
      }

      groupCount += 3;
    }

    scope.addGroup(groupStart, groupCount, top === true ? 1 : 2);

    groupStart += groupCount;
  }
}

/** A cone: a cylinder with no top radius (r180's ConeGeometry; type "cone"). */
export function cone(radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2): Generated<ConeParameters> {
  const geometry = cylinder(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength) as unknown as Generated<ConeParameters>;

  geometry.type = "cone";

  geometry.parameters = {
    radius: radius,
    height: height,
    radialSegments: radialSegments,
    heightSegments: heightSegments,
    openEnded: openEnded,
    thetaStart: thetaStart,
    thetaLength: thetaLength,
  };

  return geometry;
}
