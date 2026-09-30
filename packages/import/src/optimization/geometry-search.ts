/** Deterministic triangle BVH for finite surface-correspondence measurements. */
export interface SurfacePoint { vertices: [number, number, number]; weights: [number, number, number] }
interface Branch { min: number[]; max: number[]; left?: Branch; right?: Branch; triangles?: number[] }
const xyz = (p: Float32Array, i: number): number[] => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
export function surfacePosition(p: Float32Array, point: SurfacePoint): number[] {
  return [0, 1, 2].map(k => point.vertices.reduce((s, v, i) => s + p[v * 3 + k]! * point.weights[i]!, 0));
}
// Ericson's closest point regions; nondegenerate triangles are checked by caller.
function barycentric(p: number[], a: number[], b: number[], c: number[]): [number, number, number] {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); return [0, 1 - w, w]; }
  const inv = 1 / (va + vb + vc), v = vb * inv, w = vc * inv;
  return [1 - v - w, v, w];
}
export function surfaceBVH(positions: Float32Array, indices: Uint32Array) {
  const vertex = (triangle: number, k: number) => indices[triangle * 3 + k]!;
  function build(triangles: number[]): Branch {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const t of triangles) for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) {
      const x = positions[vertex(t, k) * 3 + d]!; min[d] = Math.min(min[d]!, x); max[d] = Math.max(max[d]!, x);
    }
    if (triangles.length <= 12) return { min, max, triangles };
    let axis = 0; for (let d = 1; d < 3; d++) if (max[d]! - min[d]! > max[axis]! - min[axis]!) axis = d;
    const center = (t: number) => positions[vertex(t, 0) * 3 + axis]! + positions[vertex(t, 1) * 3 + axis]! + positions[vertex(t, 2) * 3 + axis]!;
    triangles.sort((a, b) => center(a) - center(b) || a - b);
    const mid = Math.floor(triangles.length / 2);
    return { min, max, left: build(triangles.slice(0, mid)), right: build(triangles.slice(mid)) };
  }
  const root = build(Array.from({ length: indices.length / 3 }, (_, i) => i));
  return (p: number[]): SurfacePoint => {
    let best = Infinity, result: SurfacePoint | undefined;
    const box = (b: Branch) => p.reduce((s, x, d) => s + Math.max(b.min[d]! - x, 0, x - b.max[d]!) ** 2, 0);
    function visit(b: Branch): void {
      if (box(b) > best) return;
      if (b.triangles) {
        for (const t of b.triangles) {
          const vertices: [number, number, number] = [vertex(t, 0), vertex(t, 1), vertex(t, 2)];
          const weights = barycentric(p, xyz(positions, vertices[0]), xyz(positions, vertices[1]), xyz(positions, vertices[2]));
          const candidate = { vertices, weights }, q = surfacePosition(positions, candidate), distance = dot(sub(p, q), sub(p, q));
          if (distance < best) { best = distance; result = candidate; }
        }
      } else {
        const a = b.left!, c = b.right!; if (box(a) <= box(c)) { visit(a); visit(c); } else { visit(c); visit(a); }
      }
    }
    visit(root);
    if (!result) throw Error('Geometry correspondence has no finite nondegenerate triangle');
    return result;
  };
}
export function surfaceSamples(indices: Uint32Array, maxSamples: number): SurfacePoint[] {
  const unique = [...new Set(indices)].sort((a, b) => a - b), count = indices.length / 3, result: SurfacePoint[] = [];
  const vertices = Math.min(unique.length, Math.ceil(maxSamples * .75)), triangles = Math.min(count, maxSamples - vertices);
  for (let i = 0; i < vertices; i++) { const v = unique[Math.floor(i * unique.length / vertices)]!; result.push({ vertices: [v, v, v], weights: [1, 0, 0] }); }
  for (let i = 0; i < triangles; i++) { const t = Math.floor(i * count / triangles) * 3; result.push({ vertices: [indices[t]!, indices[t + 1]!, indices[t + 2]!], weights: [1 / 3, 1 / 3, 1 / 3] }); }
  return result;
}
