// Analytic capsule LOD from the same procedural recipe. This is a render representation,
// never a collision or identity replacement. Preparation is outside the frame loop.
import type { BakeWorld, BakeCapsule } from './bake.ts';
import { lookMesh, worldsBounds, bodySpace, meshBounds } from './mesh.ts';
import type { LookMesh, LookMeshOptions } from './mesh.ts';
import { dcos, dhypot } from '@keel-engine/core/dmath';

export interface CapsuleShaderData {
  /** Per vertex: local endpoint A and radius; zero radius means ordinary geometry. */
  readonly a: Float32Array;
  /** Per vertex: local endpoint B (four floats, last reserved). */
  readonly b: Float32Array;
  readonly bounds: readonly [number, number, number, number, number, number];
  readonly capsules: number;
}

/** Conservative distance from the reference inscribed capsule polygons to the analytic surface. */
export function capsuleSurfaceError(radius: number, around = 12, rings = 3): number {
  if (!(radius >= 0) || !Number.isFinite(radius) || !Number.isInteger(around) || around < 4 || !Number.isInteger(rings) || rings < 1) return Infinity;
  return radius * (2 - dcos(Math.PI / around) - dcos(Math.PI / (4 * rings)));
}

// Both the reference vertices and the analytic endpoints are uploaded as Float32.
// Account for that rounding too, particularly for procedural recipes far from the origin.
export function capsuleReferenceError(c: BakeCapsule, around: number, rings: number): number {
  const endpoint = (p: ArrayLike<number>) => Math.hypot(...[0,1,2].map(i => Math.fround(p[i] ?? 0) - (p[i] ?? 0)));
  const vertexRound = Math.hypot(...[0,1,2].map(i => {
    const extent = Math.max(Math.abs(c.a[i] ?? 0), Math.abs(c.b[i] ?? 0)) + c.r;
    return extent > 0 ? Math.max(2 ** -150, 2 ** (Math.floor(Math.log2(extent)) - 24)) : 0;
  }));
  return capsuleSurfaceError(c.r, around, rings) + Math.max(endpoint(c.a), endpoint(c.b))
    + Math.abs(Math.fround(c.r) - c.r) + vertexRound;
}

/** Infer eligible rounded solids; retain boxes, wedges and larger/invalid capsules as their original meshes.
 * maxError limits analytic-vs-reference silhouette displacement in local metres. No texture bake or raymarch. */
export function capsuleShaderMesh(world: BakeWorld, maxError: number, options: LookMeshOptions = {}): LookMesh {
  if (!(maxError > 0) || !Number.isFinite(maxError)) throw new RangeError('maxError must be finite and positive');
  if (options.chordError !== undefined) throw new Error('shader reference must use the full tessellation');
  const caps = world.capsules ?? [], around = options.around ?? 12, rings = options.rings ?? 3;
  const eligible = caps.map(c => c.r > 0 && Math.fround(c.r) >= 2 ** -126 && [c.r, ...Array.from(c.a), ...Array.from(c.b)].every(Number.isFinite)
    && capsuleReferenceError(c, around, rings) <= maxError);
  if (!eligible.some(Boolean)) return lookMesh(world, { ...options, shaderLod: false });
  const referenceBounds = options.bounds ?? worldsBounds([world], options);
  const retained = caps.flatMap((c, i) => eligible[i] ? [] : [i]);
  const base = lookMesh({ ...world, capsules: retained.map(i => caps[i]!) }, { ...options, bounds: referenceBounds, shaderLod: false });
  const firstCap = (world.boxes?.length ?? 0) + (world.wedges?.length ?? 0);
  const count = eligible.filter(Boolean).length, bv = base.positions.length / 3, nv = bv + count * 8;
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), attrs = new Float32Array(nv * 4);
  const a = new Float32Array(nv * 4), b = new Float32Array(nv * 4), indices = new Uint32Array(base.indices.length + count * 36);
  positions.set(base.positions); normals.set(base.normals); attrs.set(base.attrs); indices.set(base.indices);
  for (let v = 0; v < bv; v++) {
    const part = attrs[v * 4 + 3]!;
    if (part >= firstCap) attrs[v * 4 + 3] = firstCap + retained[part - firstCap]!;
  }
  // Outward faces of an eight-vertex prism. Axis-aligned in capsule space, keeping thin tilted tubes' coverage small.
  const cube = [0,2,1, 1,2,3, 4,5,6, 5,7,6, 0,1,4, 1,5,4, 2,6,3, 3,6,7, 0,4,2, 2,4,6, 1,3,5, 3,7,5];
  let at = bv, ii = base.indices.length;
  caps.forEach((c, ci) => {
    if (!eligible[ci]) return;
    const A = [c.a[0] ?? 0, c.a[1] ?? 0, c.a[2] ?? 0], B = [c.b[0] ?? 0, c.b[1] ?? 0, c.b[2] ?? 0];
    const delta = B.map((x, j) => x - A[j]!), len = dhypot(delta[0]!, delta[1]!, delta[2]!);
    const axis = len > 1e-6 ? delta.map(x => x / len) : [0,1,0];
    const cross = (p: number[], q: number[]) => [p[1]! * q[2]! - p[2]! * q[1]!, p[2]! * q[0]! - p[0]! * q[2]!, p[0]! * q[1]! - p[1]! * q[0]!];
    const e = cross(axis, Math.abs(axis[1]!) < .9 ? [0,1,0] : [1,0,0]), el = dhypot(e[0]!, e[1]!, e[2]!);
    const xAxis = e.map(x => x / el), zAxis = cross(xAxis, axis), start = at;
    // Expand by Float32 rounding slack, so the proxy never clips a valid analytic surface.
    const pad = Math.max(1e-6, ...A.map(Math.abs), ...B.map(Math.abs), c.r) * 2e-6;
    for (let k = 0; k < 8; k++, at++) {
      const x = (k & 1 ? 1 : -1) * (c.r + pad), y = (k & 2 ? 1 : -1) * (len / 2 + c.r + pad), z = (k & 4 ? 1 : -1) * (c.r + pad);
      for (let j = 0; j < 3; j++) positions[at * 3 + j] = (A[j]! + B[j]!) / 2 + xAxis[j]! * x + axis[j]! * y + zAxis[j]! * z;
      attrs.set([c.mat ?? 0, 0, 0, firstCap + ci], at * 4);
      a.set([...A, c.r], at * 4); b.set([...B, 0], at * 4);
    }
    for (const index of cube) indices[ii++] = start + index;
  });
  const facade = base.facade ? new Float32Array(nv).fill(-1) : undefined;
  if (facade) facade.set(base.facade!);
  return { positions, normals, attrs, bodies: bodySpace(positions, referenceBounds), indices,
    ...(facade ? { facade } : {}), capsuleShader: { a, b, bounds: referenceBounds, capsules: count } };
}

/** Worker-safe candidate prepared once with the canonical mesh; no closures or generation at draw time. */
export function automaticShaderDetail(world: BakeWorld, mesh: LookMesh, options: LookMeshOptions): LookMesh {
  if (options.shaderLod === false || options.chordError !== undefined || !world.capsules?.length) return mesh;
  // Small polygon templates are already cheaper than analytic fragment work in measured fixtures.
  if ((options.around ?? 12) * (4 * (options.rings ?? 3) + 2) <= 48) return mesh;
  let error = 0;
  for (const c of world.capsules) {
    if (!(c.r > 0) || !(Math.fround(c.r) >= 2 ** -126) || ![c.r, ...Array.from(c.a), ...Array.from(c.b)].every(Number.isFinite)) continue;
    const e = capsuleReferenceError(c, options.around ?? 12, options.rings ?? 3);
    if (Number.isFinite(e)) error = Math.max(error, e);
  }
  if (!(error > 0)) return mesh;
  const candidate = capsuleShaderMesh(world, error, { ...options, bounds: options.bounds ?? meshBounds(mesh.positions), shaderLod: false });
  // Avoid extra GPU residency and fragment work for recipes dominated by already-cheap polygon solids.
  if (!candidate.capsuleShader || candidate.indices.length >= mesh.indices.length * .25) return mesh;
  return { ...mesh, shaderDetail: { mesh: candidate, error, maxPixels: 24 } };
}
