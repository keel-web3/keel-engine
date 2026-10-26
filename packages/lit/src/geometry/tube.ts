// Ported from Three.js r180's geometries/TubeGeometry.js (MIT, see packages/lit/NOTICE).

import { Attribute } from "../core/Attribute.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { Curve, FrenetFrames } from "./Curve.ts";
import { QuadraticBezierCurve3 } from "./QuadraticBezierCurve3.ts";
import { generated } from "./generated.ts";
import type { Generated } from "./generated.ts";

export interface TubeParameters {
  path: Curve<Vector3>;
  tubularSegments: number;
  radius: number;
  radialSegments: number;
  closed: boolean;
}

/** A tube's geometry, with the path's frames exposed as r180 exposes them. */
export type TubeGeometry = Generated<TubeParameters> & FrenetFrames;

/** A tube along a 3D curve (r180's TubeGeometry; type "tube"). */
export function tube(path: Curve<Vector3> = new QuadraticBezierCurve3(new Vector3(-1, -1, 0), new Vector3(-1, 1, 0), new Vector3(1, 1, 0)), tubularSegments = 64, radius = 1, radialSegments = 8, closed = false): TubeGeometry {
  const geometry = generated<TubeParameters>("tube", {
    path: path,
    tubularSegments: tubularSegments,
    radius: radius,
    radialSegments: radialSegments,
    closed: closed,
  }) as TubeGeometry;

  const frames = path.computeFrenetFrames(tubularSegments, closed);

  // (the internals, exposed)
  geometry.tangents = frames.tangents;
  geometry.normals = frames.normals;
  geometry.binormals = frames.binormals;

  const vertex = new Vector3();
  const normal = new Vector3();
  const uv = new Vector2();
  let P = new Vector3();

  // (buffers)
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  generateBufferData();

  geometry.setIndex(indices);
  geometry.setAttribute("position", new Attribute(new Float32Array(vertices), 3));
  geometry.setAttribute("normal", new Attribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new Attribute(new Float32Array(uvs), 2));

  return geometry;

  function generateBufferData(): void {
    for (let i = 0; i < tubularSegments; i++) {
      generateSegment(i);
    }

    // (open: the last ring at the path's end; closed: the first ring again,
    // with its own uvs)
    generateSegment((closed === false) ? tubularSegments : 0);

    // (uvs apart, so closed tubes get them right)
    generateUVs();

    generateIndices();
  }

  function generateSegment(i: number): void {
    // (evenly spaced along the path)
    P = path.getPointAt(i / tubularSegments, P);

    const N = frames.normals[i]!;
    const B = frames.binormals[i]!;

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments * Math.PI * 2;

      const sin = Math.sin(v);
      const cos = -Math.cos(v);

      normal.x = (cos * N.x + sin * B.x);
      normal.y = (cos * N.y + sin * B.y);
      normal.z = (cos * N.z + sin * B.z);
      normal.normalize();

      normals.push(normal.x, normal.y, normal.z);

      vertex.x = P.x + radius * normal.x;
      vertex.y = P.y + radius * normal.y;
      vertex.z = P.z + radius * normal.z;

      vertices.push(vertex.x, vertex.y, vertex.z);
    }
  }

  function generateIndices(): void {
    for (let j = 1; j <= tubularSegments; j++) {
      for (let i = 1; i <= radialSegments; i++) {
        const a = (radialSegments + 1) * (j - 1) + (i - 1);
        const b = (radialSegments + 1) * j + (i - 1);
        const c = (radialSegments + 1) * j + i;
        const d = (radialSegments + 1) * (j - 1) + i;

        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
  }

  function generateUVs(): void {
    for (let i = 0; i <= tubularSegments; i++) {
      for (let j = 0; j <= radialSegments; j++) {
        uv.x = i / tubularSegments;
        uv.y = j / radialSegments;

        uvs.push(uv.x, uv.y);
      }
    }
  }
}
