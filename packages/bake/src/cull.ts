// Culling: what a frame can skip. A mesh is kept on the GPU with the box it
// fits in (setMesh works it out once); this decides, per frame and on the CPU,
// whether that box can be seen. Directional shadow casters are selected separately
// in shadow-view.ts: a box behind the camera can still shade visible receivers.
//
//   const planes = frustumOf(projection);
//   if (visible(planes, mesh.lo, mesh.hi, draw.matrix)) draw it
//
// Conservative: it tests the box's support against each plane, so it never hides something
// that should be drawn, and it may keep something that turns out not to show.

import type { Projection } from "./project.ts";

/** Six planes (nx, ny, nz, d): a point is inside when nx*x + ny*y + nz*z + d >= 0 for all of them. */
export type Planes = Float32Array;

/** The frustum of a projection, straight off its clip matrix (the standard Gribb/Hartmann extraction). */
export function frustumOf(p: Projection): Planes {
  const m = p.clip;
  const out = new Float32Array(24);
  // Column-major: m[col * 4 + row]. Row r of the matrix is (m[0*4+r], m[1*4+r], m[2*4+r], m[3*4+r]).
  const row = (r: number): [number, number, number, number] => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!];
  const [x0, x1, x2, x3] = row(0), [y0, y1, y2, y3] = row(1), [z0, z1, z2, z3] = row(2), [w0, w1, w2, w3] = row(3);
  const set = (i: number, a: number, b: number, c: number, d: number): void => {
    const l = Math.hypot(a, b, c) || 1;
    out[i * 4] = a / l; out[i * 4 + 1] = b / l; out[i * 4 + 2] = c / l; out[i * 4 + 3] = d / l;
  };
  set(0, w0 + x0, w1 + x1, w2 + x2, w3 + x3); // left
  set(1, w0 - x0, w1 - x1, w2 - x2, w3 - x3); // right
  set(2, w0 + y0, w1 + y1, w2 + y2, w3 + y3); // bottom
  set(3, w0 - y0, w1 - y1, w2 - y2, w3 - y3); // top
  // Near: clip z runs -w .. w (the GL convention both our projections write), so the plane is w + z -- NOT z alone,
  // which would cull everything nearer than the view's own centre: half the picture, in an orthographic shot.
  set(4, w0 + z0, w1 + z1, w2 + z2, w3 + z3);
  set(5, w0 - z0, w1 - z1, w2 - z2, w3 - z3); // far
  return out;
}

/** A mesh's box through its model matrix, as the eight world corners it occupies (into `out`, 24 floats). */
export function boxCorners(lo: ArrayLike<number>, hi: ArrayLike<number>, m: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let c = 0; c < 8; c += 1) {
    const x = (c & 1 ? hi : lo)[0]!, y = (c & 2 ? hi : lo)[1]!, z = (c & 4 ? hi : lo)[2]!;
    out[c * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    out[c * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    out[c * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  }
  return out;
}

const SCRATCH = new Float32Array(24);

/** Can this mesh, placed by this matrix, be seen? Conservative: false only when every corner is outside one plane. */
export function visible(planes: Planes, lo: ArrayLike<number>, hi: ArrayLike<number>, m: ArrayLike<number>, pad = 0): boolean {
  const x = (lo[0]! + hi[0]!) * 0.5, y = (lo[1]! + hi[1]!) * 0.5, z = (lo[2]! + hi[2]!) * 0.5;
  const hx = (hi[0]! - lo[0]!) * 0.5, hy = (hi[1]! - lo[1]!) * 0.5, hz = (hi[2]! - lo[2]!) * 0.5;
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  for (let p = 0; p < 6; p += 1) {
    const a = planes[p * 4]!, b = planes[p * 4 + 1]!, cc = planes[p * 4 + 2]!, d = planes[p * 4 + 3]! + pad;
    // Project the oriented half-axes onto the plane. This is the maximum of the eight corner distances,
    // also for nonuniform/negative scale and shear, without transforming and retesting eight corners.
    const radius = Math.abs(a * m[0]! + b * m[1]! + cc * m[2]!) * hx
      + Math.abs(a * m[4]! + b * m[5]! + cc * m[6]!) * hy
      + Math.abs(a * m[8]! + b * m[9]! + cc * m[10]!) * hz;
    const margin = 1e-6 * (1 + Math.abs(cx) + Math.abs(cy) + Math.abs(cz) + radius);
    if (a * cx + b * cy + cc * cz + d + radius < -margin) return false;
  }
  return true;
}

/** The world box a set of placed meshes fills: [minX, minY, minZ, maxX, maxY, maxZ] (empty: all Infinity). */
export function boundsOf(items: ReadonlyArray<{ lo: ArrayLike<number>; hi: ArrayLike<number>; m: ArrayLike<number> }>): Float32Array {
  const b = Float32Array.from([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (const it of items) {
    const c = boxCorners(it.lo, it.hi, it.m, SCRATCH);
    for (let i = 0; i < 8; i += 1) for (let a = 0; a < 3; a += 1) {
      const v = c[i * 3 + a]!;
      if (v < b[a]!) b[a] = v;
      if (v > b[a + 3]!) b[a + 3] = v;
    }
  }
  return b;
}
