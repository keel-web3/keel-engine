import type { LookMesh } from './mesh.ts';
export interface MeshCost { readonly triangles: number; readonly vertices: number; readonly geometryBytes: number }
export interface MeshDetailReport {
  readonly full: MeshCost;
  readonly shader?: { readonly candidate: MeshCost; readonly triangleSaving: number; readonly localError: number; readonly maxPixels: number; readonly capsules: number };
}
/** Preparation/residency costs only. GPU timers and frame percentiles decide whether a representation helps. */
export function meshDetailReport(mesh: LookMesh): MeshDetailReport {
  const cost = (m: LookMesh): MeshCost => ({ triangles: m.indices.length / 3, vertices: m.positions.length / 3,
    geometryBytes: m.positions.byteLength + m.normals.byteLength + m.attrs.byteLength + m.bodies.byteLength + m.indices.byteLength
      + (m.facade?.byteLength ?? 0) + (m.capsuleShader ? m.capsuleShader.a.byteLength + m.capsuleShader.b.byteLength : 0) });
  const full = cost(mesh), d = mesh.shaderDetail;
  return { full, ...(d ? { shader: { candidate: cost(d.mesh), triangleSaving: full.triangles ? 1 - d.mesh.indices.length / mesh.indices.length : 0,
    localError: d.error, maxPixels: d.maxPixels, capsules: d.mesh.capsuleShader?.capsules ?? 0 } } : {}) };
}
