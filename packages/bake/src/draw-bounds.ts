import type { LookMesh } from "./mesh.ts";

export type Bounds = readonly [number, number, number, number, number, number];
const empty = (): [number, number, number, number, number, number] => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

/** Rest bounds per part, measured once at upload, not by walking vertices every animation frame. */
export function partBounds(mesh: LookMesh): ReadonlyMap<number, Bounds> {
  const parts = new Map<number, ReturnType<typeof empty>>();
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const id = Math.round(mesh.attrs[v * 4 + 3]!);
    let b = parts.get(id);
    if (!b) { b = empty(); parts.set(id, b); }
    for (let a = 0; a < 3; a++) {
      const p = mesh.positions[v * 3 + a]!;
      b[a] = Math.min(b[a]!, p); b[a + 3] = Math.max(b[a + 3]!, p);
    }
  }
  return parts;
}

/** Exact AABB of an affine-transformed box, by center and support radius (also scale, reflection and shear). */
export function transformedBounds(b: Bounds, m: ArrayLike<number>, out = empty(), offset = 0): Bounds {
  const x = (b[0] + b[3]) * .5, y = (b[1] + b[4]) * .5, z = (b[2] + b[5]) * .5;
  const hx = (b[3] - b[0]) * .5, hy = (b[4] - b[1]) * .5, hz = (b[5] - b[2]) * .5;
  for (let a = 0; a < 3; a++) {
    const i = offset + a, center = m[i]! * x + m[i + 4]! * y + m[i + 8]! * z + m[i + 12]!;
    const radius = Math.abs(m[i]!) * hx + Math.abs(m[i + 4]!) * hy + Math.abs(m[i + 8]!) * hz;
    out[a] = center - radius; out[a + 3] = center + radius;
  }
  return out;
}

/** Bound the actual pose. In-place changes to the caller's matrices are deliberately read each frame. */
export function posedBounds(parts: ReadonlyMap<number, Bounds>, matrices: Float32Array): Bounds {
  const result = empty(), scratch = empty();
  for (const [id, b] of parts) {
    const p = transformedBounds(b, matrices, scratch, id * 16);
    for (let a = 0; a < 3; a++) { result[a] = Math.min(result[a]!, p[a]!); result[a + 3] = Math.max(result[a + 3]!, p[a + 3]!); }
  }
  return result;
}
