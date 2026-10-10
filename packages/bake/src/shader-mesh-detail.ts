import type { BakeWorld } from './bake.ts';
import type { LookMeshOptions } from './mesh.ts';
import type { MeshDetail, MeshHolder } from './lod-mesh.ts';
import { prepareMeshDetail } from './lod-mesh.ts';
import { capsuleShaderMesh } from './capsule-shader-mesh.ts';
/** Automatic generator preparation: full mesh, existing polygon LOD, and an analytic candidate.
 * Caller owns/refcounts ALL three keys. The renderer checks residency, pixel error and actual triangle savings. */
export function prepareShaderMeshDetail(key: string, world: () => BakeWorld, hold: MeshHolder, chordError: number, options: Omit<LookMeshOptions, 'chordError'> = {}): MeshDetail {
  let recipe: BakeWorld | undefined;
  const pose = () => recipe ??= world();
  const detail = prepareMeshDetail(key, pose, hold, chordError, { ...options, shaderLod: false });
  const shader = hold(`${key}:capsule-shader1:${options.around ?? 12}:${options.rings ?? 3}:${chordError}`, () => capsuleShaderMesh(pose(), chordError, options));
  return { ...detail, lod: { ...detail.lod, shader: { mesh: shader, error: chordError, maxPixels: 24 } } };
}
