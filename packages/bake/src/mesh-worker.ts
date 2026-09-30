// Geometry only: no renderer, DOM, world generation or game bundle in this worker.
import { layeredMesh } from './lod-mesh.ts';
import type { LayeredMesh } from './lod-mesh.ts';
import type { BakeWorld } from './bake.ts';
import type { LookMeshOptions } from './mesh.ts';
export interface MeshWorker {
  readonly available: boolean;
  readonly pending: number;
  /** Null means busy/unavailable. The caller keeps its coarse geometry and tries on a later frame. */
  request(runs: readonly BakeWorld[], options?: LookMeshOptions): Promise<LayeredMesh> | null;
  dispose(): void;
}
/** Bounded backpressure: at most two cloned recipes and returned meshes can be in flight. */
export function createMeshWorker(url: string, limit = 2): MeshWorker {
  let worker: Worker | null = null, serial = 0;
  const pending = new Map<number, { resolve(mesh: LayeredMesh): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const stop = () => {
    worker?.terminate(); worker = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Geometry worker unavailable')); }
    pending.clear();
  };
  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(url, { type: 'module', name: 'keel-geometry' });
      worker.onerror = stop;
      worker.onmessageerror = stop;
      worker.onmessage = ({data}: MessageEvent<{ id: number; mesh?: LayeredMesh; error?: string }>) => {
        const p = pending.get(data.id); if (!p) return;
        pending.delete(data.id); clearTimeout(p.timer);
        if (data.mesh) p.resolve(data.mesh); else { p.reject(new Error(data.error ?? 'Mesh build failed')); stop(); }
      };
    }
  } catch { stop(); }
  return {
    get available() { return worker !== null; }, get pending() { return pending.size; },
    request(runs, options = {}) {
      if (!worker || pending.size >= limit) return null;
      const id = ++serial;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(stop, 15_000);
        pending.set(id, { resolve, reject, timer });
        try { worker!.postMessage({ id, runs, options }); } catch { stop(); }
      });
    },
    dispose: stop,
  };
}
/** Entry point for a dedicated bundle. Transfers typed-array ownership instead of cloning generated geometry. */
export function serveMeshWorker(): void {
  const scope = globalThis as unknown as { onmessage: (e: MessageEvent) => void; postMessage(data: unknown, transfer?: Transferable[]): void };
  scope.onmessage = ({data}: MessageEvent<{id: number; runs: BakeWorld[]; options: LookMeshOptions}>) => {
    try {
      const mesh = layeredMesh(data.runs, data.options);
      const transfer = [mesh.positions, mesh.normals, mesh.attrs, mesh.bodies, mesh.indices, ...(mesh.facade ? [mesh.facade] : [])].map(a => a.buffer as ArrayBuffer);
      scope.postMessage({id:data.id, mesh}, [...new Set(transfer)]);
    } catch(error) { scope.postMessage({id:data.id, error:String(error)}); }
  };
}
