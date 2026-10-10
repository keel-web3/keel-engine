import type { LookMesh } from './mesh.ts';
import { meshDetailReport } from './mesh-detail.ts';

/** One geometry key can serve many transforms and looks. Appearance is not part of geometry identity. */
export interface MeshPool {
  acquire(key: string, make: () => LookMesh): string;
  release(key: string): void;
  clear(): void;
  /** Preparation buffer sizes; the pool does not retain recipes or measure live JavaScript heap. */
  readonly stats: { meshes: number; references: number; preparedGeometryBytes: number; shaderCandidates: number };
}
/** Owner-controlled pooling: no eviction of valid visible content, and no generation on cache hits.
 * `upload` is SpriteRenderer.setMesh; candidates are uploaded/released with their reference automatically. */
export function createMeshPool(upload: (key: string, mesh: LookMesh | null) => void): MeshPool {
  const held = new Map<string, { references: number; bytes: number; shader: boolean }>();
  return {
    acquire(key, make) {
      const old = held.get(key);
      if (old) { old.references++; return key; }
      const mesh = make(), report = meshDetailReport(mesh);
      upload(key, mesh);
      held.set(key, { references: 1, bytes: report.full.geometryBytes + (report.shader?.candidate.geometryBytes ?? 0), shader: !!report.shader });
      return key;
    },
    release(key) {
      const entry = held.get(key);
      if (!entry) throw new Error(`Mesh pool release without acquire: ${key}`);
      if (entry.references > 1) { entry.references--; return; }
      upload(key, null); held.delete(key);
    },
    clear() { for (const key of held.keys()) { upload(key, null); held.delete(key); } },
    get stats() {
      let references = 0, preparedGeometryBytes = 0, shaderCandidates = 0;
      for (const h of held.values()) { references += h.references; preparedGeometryBytes += h.bytes; shaderCandidates += Number(h.shader); }
      return { meshes: held.size, references, preparedGeometryBytes, shaderCandidates };
    },
  };
}
